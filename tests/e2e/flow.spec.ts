import { openPrefill } from "./helpers/prefill";
import { expect, test, type Page, type Request } from "@playwright/test";

/** 입력 상황 값이 네트워크로 나가지 않는지 확인하기 위한 표식 */
const PROFILE_MARKERS = ["75-79", "basic_pension", "daily", "single", "householdSize", "bn.profile", "bn.facts", "incomeManwon"];

function pick(page: Page, legend: string | RegExp, option: string) {
  return page.getByRole("group", { name: legend }).getByText(option, { exact: true }).click();
}
const num = async (page: Page, id: string) => Number((await page.getByTestId(id).locator(".n").innerText()).replace(/,/g, ""));
function expectPrivate(requests: Request[], extra: (url: string) => boolean = () => false) {
  for (const r of requests) {
    const url = decodeURIComponent(r.url());
    expect(r.method(), url).toBe("GET");
    for (const m of PROFILE_MARKERS) expect(url.includes(m), `${m} in ${url}`).toBeFalsy();
    expect(extra(url), url).toBeFalsy();
    expect(r.postData() ?? "").toBe("");
  }
}
async function regionsReady(page: Page) {
  await expect(page.locator("#sido option")).not.toHaveCount(1, { timeout: 20_000 });
}

test.describe("로그인 없는 전체 흐름 (상황 먼저 · 기본)", () => {
  test("홈 → 내 상황 입력(어르신) → 결과 → 상세(내 답 비교) → 기기에서 지우기", async ({ page }) => {
    const requests: Request[] = [];
    page.on("request", (r) => requests.push(r));

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("여기서 찾으세요");
    await expect(page.locator("input[type=password]")).toHaveCount(0);
    await expect(page.getByText("로그인 준비 중")).toHaveCount(0); // QA 2차 L3

    // 홈은 찾는 방법 두 갈래 (2026-10-16) — 말로 찾기는 한 문장 바로 찾기(2026-10-20 jinwoo), 한 화면 입력은 ?details=1
    await expect(page.getByTestId("start-guided")).toBeVisible();
    await page.getByTestId("start-talk").click();
    await expect(page).toHaveURL(/\/situation$/);
    await expect(page.getByTestId("quick-situation")).toBeVisible();
    await page.goto("/situation?details=1");
    await expect(page.getByTestId("v2-situation")).toHaveAttribute("data-mode", "self");
    await expect(page.getByText("시험판")).toHaveCount(0);
    await regionsReady(page);

    // 사는 곳만 필수
    await page.getByTestId("v2-submit").click();
    await expect(page.getByRole("alert").filter({ hasText: "시·군·구를 골라" })).toBeVisible();
    await page.getByLabel(/^사는 시·도/).selectOption({ label: "경기도 (시범 지역)" });
    await page.getByLabel(/^시·군·구/).selectOption({ label: "수원시" });
    // 60세 이상이 아니면 기초연금·장기요양 대신 자녀·한부모를 묻는다
    await expect(page.getByTestId("sit-family")).toBeVisible();
    await expect(page.getByRole("group", { name: "기초연금을 받고 계신가요?" })).toHaveCount(0);
    await page.getByLabel("나이 (만)").selectOption("75-79");
    await expect(page.getByTestId("sit-family")).toHaveCount(0);
    await page.getByLabel("함께 사는 가족 (본인 포함)").selectOption("1");
    await pick(page, "주민센터에서 받고 있는 지원이 있나요?", "없어요 (받지 않아요)");
    await pick(page, "기초연금을 받고 계신가요?", "예");
    await pick(page, /식사·거동·외출/, "예");
    await expect(page.getByRole("group", { name: /장기요양등급/ })).toBeVisible();
    await page.getByTestId("v2-submit").click();

    // 결과 (기본 = 상황 먼저)
    await expect(page).toHaveURL(/\/results$/);
    await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("수원시");
    await expect(page.getByTestId("v2-chips")).toContainText("기초연금 받음");
    expect(await num(page, "v2-n-fit")).toBeGreaterThan(0);
    expect(await num(page, "v2-n-no")).toBeGreaterThan(0);
    const picks = page.getByTestId("top-picks");
    await expect(picks.locator("ol > li")).toHaveCount(5);
    // (2026-10-22) '기초연금 받음'으로 답했으니 기초연금은 추천이 아니라 '이미 받고 있는 혜택'에
    await expect(picks.getByRole("link", { name: "기초연금", exact: true })).toHaveCount(0);
    const recv = page.getByTestId("receiving-section");
    await expect(recv.getByRole("link", { name: "기초연금", exact: true })).toBeVisible();
    await expect(picks.locator("[data-bucket=fit]").first()).toBeVisible();
    await expect(page.getByText("시험판")).toHaveCount(0);

    // 상세: 결과와 같은 판단 + 내 답과 비교
    await recv.getByRole("link", { name: "기초연금", exact: true }).click();
    await expect(page).toHaveURL(/\/p\//);
    await expect(page.getByTestId("detail-judge")).toHaveAttribute("data-bucket", "fit");
    await expect(page.getByTestId("detail-judge")).toContainText("받으실 수 있어요");
    await expect(page.getByTestId("explain-matched")).toContainText("내 답");
    await expect(page.getByTestId("explain-matched")).toContainText("기초연금 받음");
    await expect(page.getByTestId("sources")).toContainText("수집일");

    expectPrivate(requests);
    expect(requests.filter((r) => r.url().includes("/bundles/v1/")).length).toBeGreaterThan(0);

    // 기기에서 지우기
    await page.goto("/results");
    await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /이 기기에서 지우기/ }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(await page.evaluate(() => localStorage.getItem("bn.profile.v1"))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("bn.facts.v1"))).toBeNull();
    await page.goto("/results");
    await expect(page.getByText("아직 입력한 정보가 없어요")).toBeVisible();
  });

  test("내 복지(청년·자녀): 자녀 수·나이·임신·한부모·구직을 묻고, 추가 질문은 3개까지 @mobile", async ({ page }) => {
    await page.goto("/situation?for=self&new=1&details=1");
    await regionsReady(page);
    await page.getByLabel(/^사는 시·도/).selectOption({ label: "경기도 (시범 지역)" });
    await page.getByLabel(/^시·군·구/).selectOption({ label: "성남시" });
    await page.getByLabel("나이 (만)").selectOption("30-34");
    await page.getByLabel("함께 사는 가족 (본인 포함)").selectOption("2");
    await pick(page, "함께 사는(키우는) 자녀는 몇 명인가요?", "1명");
    await page.getByTestId("child-ages").getByText("6~12세", { exact: true }).click();
    await pick(page, "혼자 자녀를 키우는 한부모 가구인가요?", "예");
    await pick(page, "지금 하고 있는 일은요?", "일자리를 찾고 있어요");
    await page.getByTestId("v2-income").fill("200");
    await expect(page.getByTestId("v2-income-band")).toContainText("2인 가구 기준 중위소득");
    // 60세 미만 본인 → 기초연금·장기요양은 묻지 않는다
    await expect(page.getByRole("group", { name: "기초연금을 받고 계신가요?" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: /장기요양등급/ })).toHaveCount(0);
    await page.getByTestId("v2-submit").click();
    await expect(page).toHaveURL(/\/results$/);
    await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("성남시");
    await expect(page.getByTestId("top-picks").locator("ol > li")).toHaveCount(5);
    await expect(page.getByTestId("top-picks")).toContainText(/한부모|아동|양육/);
    expect(await page.getByTestId("v2-followup").locator(".v2-q").count()).toBeLessThanOrEqual(3);
    // 본인 찾기 추가 질문에는 기초연금·장기요양이 나오지 않는다
    await expect(page.getByTestId("v2-q-basicPension")).toHaveCount(0);
    await expect(page.getByTestId("v2-q-ltcGrade")).toHaveCount(0);
    // 다시 고치기: 저장된 답이 그대로 (주소에는 싣지 않음)
    await page.getByTestId("edit-situation").click();
    await expect(page).toHaveURL(/\/situation/);
    await expect(page.getByTestId("v2-income")).toHaveValue("200");
    await expect(page.getByRole("group", { name: "혼자 자녀를 키우는 한부모 가구인가요?" }).getByRole("radio", { name: "예" })).toBeChecked();
    expect(page.url()).not.toContain("200");
  });

  test("모름만으로도 결과 + 예전 주소(/check, v=2) 호환 + 검색 + 큰 글씨", async ({ page }) => {
    await page.goto("/check");
    await expect(page).toHaveURL(/\/situation\?details=1$/);
    await regionsReady(page);
    await page.getByLabel(/^사는 시·도/).selectOption({ label: "서울특별시" });
    await page.getByLabel(/^시·군·구/).selectOption({ label: "종로구" });
    await page.getByTestId("v2-submit").click();
    await expect(page.getByTestId("v2-followup")).toBeVisible({ timeout: 20_000 });
    expect(await page.getByTestId("v2-followup").locator(".v2-q").count()).toBeLessThanOrEqual(3);
    await page.goto("/results?v=2");
    await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/results$/);

    await page.goto("/search?q=에너지바우처");
    await expect(page.getByText(/검색 결과 \d+개/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("program-card").first()).toContainText("에너지");

    await page.getByTestId("large-text").click();
    await expect(page.locator("html")).toHaveAttribute("data-large", "1");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-large", "1");
  });

  test("예전 화면은 v=1 로만 (비교용): 단계 입력 · 3단계 결과·필터", async ({ page }) => {
    await page.goto("/results?v=1&example=suwon-senior");
    await expect(page.getByTestId("tab-eligible")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/results\?v=1$/);
    await expect(page.getByTestId("top-picks").locator("ol > li")).toHaveCount(5);
    const l0 = await num(page, "tab-likely");
    await page.getByTestId("tab-likely").click();
    await page.getByTestId("filter-toggle").click();
    await page.getByLabel("기관 유형").selectOption("local");
    expect(await num(page, "tab-likely")).toBeLessThan(l0);
    await page.goto("/check?v=1");
    await expect(page.getByTestId("next")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/check\?v=1/);
  });

  test("상세 페이지: API 신청방법·연락처와 출처(정부24·복지로) 표시 @mobile", async ({ page }) => {
    await page.goto("/p/n.gov24-SSE000000170");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("기초연금");
    await expect(page.getByRole("heading", { name: "신청 방법", exact: true })).toBeVisible();
    await expect(page.locator("#h-apply").locator("..")).toContainText("129");
    await expect(page.getByTestId("apply-fallback")).toHaveCount(0);
    await expect(page.getByTestId("sources")).toContainText("정부24 공공서비스");
    await expect(page.getByTestId("sources")).toContainText("복지로 복지서비스 정보");
    await expect(page.getByText("검수 규칙(1차)").first()).toBeVisible();
  });

  test("상세 페이지: 신청처 정보가 없으면 주민센터·시군구청 안내로 대체 @mobile", async ({ page }) => {
    await page.goto("/p/g41110.icare-0085-1489588-1-1-30");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("가정간호제도");
    await expect(page.getByTestId("apply-fallback")).toContainText("행정복지센터");
    await expect(page.getByTestId("apply-fallback")).toContainText("129");
    await expect(page.getByTestId("official-link")).toHaveAttribute("href", /mohw\.go\.kr/);
    await expect(page.getByRole("link", { name: /내 상황으로 지원 조건 확인하기/ })).toHaveAttribute("href", "/situation");
  });

  test("홈의 예시 상황: 한 번에 결과 + 예시 안내 + 먼저 확인할 5가지 @mobile", async ({ page }) => {
    const cases: [string, RegExp, string][] = [
      ["suwon-senior", /수원시/, "기초연금"],
      ["parent-care", /수원시/, "노인장기요양보험"],
      ["seongnam-single-parent", /성남시/, "아동양육비"],
      // (QA 8차) 면접수당은 '취업면접에 참여한 청년' 조건을 확인하지 않아 '신청할 때 확인'으로 — 5가지에서 빠짐
      ["goyang-youth", /고양시/, "구직자 취업역량강화"],
      ["bucheon-disability", /부천시/, "일상돌봄"],
    ];
    for (const [id, region, top] of cases) {
      await page.goto("/");
      await page.getByTestId(`preset-${id}`).click();
      await expect(page).toHaveURL(id === "parent-care" ? /\/results\?for=parent$/ : /\/results$/);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(region, { timeout: 20_000 });
      await expect(page.getByTestId("example-banner")).toContainText("예시 결과");
      await expect(page.getByTestId("top-picks").locator("ol > li")).toHaveCount(5);
      await expect(page.getByTestId("top-picks")).toContainText(top);
      if (id === "parent-care") {
        await expect(page.getByTestId("parent-results-banner")).toBeVisible();
        await expect(page.getByTestId("proxy-apply-note")).toBeVisible();
      }
    }
    // 직접 입력(저장)하면 예시 표시가 사라진다
    await page.goto("/situation?details=1");
    await regionsReady(page);
    await page.getByTestId("v2-submit").click();
    await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("example-banner")).toHaveCount(0);
  });

  test("자동으로 받는 혜택: 본문·추천과 분리된 접힌 영역, 개수 = 카드 수 @mobile", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("preset-seongnam-single-parent").click();
    await expect(page.getByTestId("top-picks")).toBeVisible({ timeout: 20_000 });
    const sec = page.getByTestId("auto-section");
    await expect(sec).toBeVisible();
    await expect(sec).not.toHaveAttribute("open", "");
    await expect(sec.getByTestId("v2-card")).toHaveCount(0);
    await expect(page.getByTestId("top-picks").getByText("자동 제공")).toHaveCount(0);
    for (const b of ["v2-fit", "v2-office"]) await expect(page.getByTestId(b).getByTestId("apply-badge").filter({ hasText: /자동 제공|기관 추천/ })).toHaveCount(0);
    const n = Number((await page.getByTestId("auto-count").innerText()).replace(/[^0-9]/g, ""));
    expect(n).toBeGreaterThan(0);
    await page.getByTestId("auto-toggle").click();
    await expect(sec).toHaveAttribute("open", "");
    const cards = sec.getByTestId("v2-card");
    await expect(cards).toHaveCount(Math.min(n, 10));
    while (await page.getByTestId("auto-more").count()) await page.getByTestId("auto-more").click();
    await expect(cards).toHaveCount(n);
    await expect(sec.getByTestId("apply-badge").filter({ hasText: /자동 제공|기관 추천/ })).toHaveCount(n);
    await page.getByTestId("auto-toggle").click();
    await expect(sec.getByTestId("v2-card")).toHaveCount(0);
  });

  test("부모님 복지 찾기: 홈 말로 찾기 → 부모님 복지로 바꾸기 → 부모님 상황 입력 → 결과(대리 신청 안내) @mobile", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("start-guided")).toBeVisible();
    await page.getByTestId("start-talk").click();
    await expect(page).toHaveURL(/\/situation$/);
    await expect(page.getByTestId("quick-situation")).toBeVisible();
    await page.goto("/situation?details=1");
    await page.getByTestId("mode-parent").click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("부모님 상황");
    await expect(page.getByTestId("mode-parent")).toHaveAttribute("aria-pressed", "true");
    await regionsReady(page);
    await page.getByLabel(/^부모님이 사는 시·도/).selectOption({ label: "경기도 (시범 지역)" });
    await page.getByLabel(/^시·군·구/).selectOption({ label: "수원시" });
    // 부모님 찾기: 자녀 질문 대신 기초연금·장기요양 (나이를 몰라도)
    await expect(page.getByTestId("sit-family")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "부모님이 기초연금을 받고 계신가요?" })).toBeVisible();
    await page.getByLabel("부모님 나이 (만)").selectOption("70-74");
    await page.getByLabel("함께 사는 가족 (본인 포함)").selectOption("2");
    await pick(page, /식사·거동·외출/, "예");
    await page.getByTestId("v2-submit").click();
    await expect(page).toHaveURL(/\/results\?for=parent$/);
    await expect(page.getByTestId("parent-results-banner")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("부모님께 맞는 혜택");
    await expect(page.getByTestId("top-picks")).toBeVisible();
    await expect(page.getByTestId("proxy-apply-note")).toContainText("주민센터");
    await expect(page.getByTestId("proxy-apply-note")).toContainText("법률 자문이 아닙니다");
    await expect(page.getByTestId("couple-note")).toContainText("기초연금");
    // URL 예시로도 열림 (예전 링크)
    await page.goto("/results?for=parent&example=parent-care");
    await expect(page.getByTestId("example-banner")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("parent-results-banner")).toBeVisible();
    await expect(page.getByTestId("top-picks").locator("ol > li")).toHaveCount(5);
  });

  test("운영자 문장: 홈 검색창 → 이해 확인 → 결과 → 추가 질문(소득 300만원) → 상세에서 남은 질문 @mobile", async ({ page }) => {
    const requests: Request[] = [];
    page.on("request", (r) => requests.push(r));
    const sentence = "수원시 소재에 계시고 59년생 부모님 두분이 계신다";
    await openPrefill(page, sentence);
    await expect(page).toHaveURL(/\/situation\?for=parent&prefill=1/);
    const box = page.getByTestId("prefill-banner");
    await expect(box).toBeVisible({ timeout: 20_000 });
    await expect(box).toContainText("이렇게 이해했어요");
    await expect(page.getByTestId("prefill-line")).toContainText("경기 수원시");
    await expect(page.getByTestId("prefill-line")).toContainText("만 66~67세");
    await expect(page.getByTestId("prefill-line")).toContainText("부부 2인");
    await expect(page.getByTestId("prefill-line")).toContainText("부모님 대신 찾기");
    await page.getByTestId("prefill-confirm").click();
    await expect(page).toHaveURL(/\/results\?for=parent$/);
    await expect(page.getByTestId("parent-results-banner")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("수원시");
    const picks = page.getByTestId("top-picks");
    await expect(picks.locator("ol > li")).toHaveCount(5);
    await expect(picks).toContainText("폐렴구균");
    await expect(page.getByTestId("couple-note")).toContainText("기초연금");

    const follow = page.getByTestId("v2-followup");
    await expect(follow).toContainText("추가 질문");
    expect(await follow.locator(".v2-q").count()).toBeLessThanOrEqual(3);
    await expect(page.getByTestId("v2-q-income")).toBeVisible();
    const fitBefore = await num(page, "v2-n-fit");
    const noBefore = await num(page, "v2-n-no");
    await page.getByTestId("v2-a-income-input").fill("300");
    await page.getByTestId("v2-a-income-ok").click();
    await expect(page.getByTestId("v2-inferred")).toBeVisible();
    await expect(page.getByTestId("v2-chips")).toContainText("소득 월 300만원");
    await expect(page.getByTestId("v2-q-income")).toHaveCount(0);
    expect(await num(page, "v2-n-fit")).toBeGreaterThan(fitBefore);
    expect(await num(page, "v2-n-no")).toBeGreaterThan(noBefore);

    // 상세: '답하면 정해져요' 혜택은 남은 질문을 상세에서 바로 답할 수 있다
    await page.getByTestId("v2-ask").locator(":scope > summary").click();
    await page.getByTestId("v2-ask").getByTestId("v2-card").first().locator("h3 a").click();
    await expect(page).toHaveURL(/\/p\//);
    await expect(page.getByTestId("detail-judge")).toHaveAttribute("data-bucket", "ask");
    const q = page.getByTestId("detail-questions").locator("[data-testid^=detail-q-]").first();
    await expect(q).toBeVisible();
    const qid = await q.getAttribute("data-testid");
    await q.locator("button").first().click();
    await expect(page.getByTestId(qid!)).toHaveCount(0);
    await expect(page.getByTestId("explain")).toContainText("부모님 답");

    expectPrivate(requests, (url) => url.includes("59년생") || url.includes("소재") || url.includes("65-69") || url.includes("만원") || /[?&=]300\b/.test(url));
  });

  test("사용자 문장: 용인 86년생 자녀 2명 세후 400 → 소득·가구 채움, 배우자 없이 바꾸기, 다시 묻지 않음", async ({ page }) => {
    const requests: Request[] = [];
    page.on("request", (r) => requests.push(r));
    await openPrefill(page, "용인시에 사는 86년생이야, 자녀는 2명이 있어. 월급은 세후 400정도되");
    await expect(page).toHaveURL(/\/situation\?for=self&prefill=1/);
    await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
    const line = page.getByTestId("prefill-line");
    await expect(line).toContainText("경기 용인시");
    await expect(line).toContainText("1986년생");
    await expect(page.getByTestId("prefill-household")).toContainText("같이 사는 사람: 본인 포함 4명 (배우자 포함으로 봤어요");
    await expect(page.getByTestId("prefill-income")).toContainText("월 소득 약 400만원 (세후)");
    // 한 번에 '배우자 없이 3명' ↔ 되돌리기
    await page.getByTestId("prefill-hh-alt").click();
    await expect(page.getByTestId("prefill-household")).toContainText("본인 포함 3명 (배우자 없이");
    await expect(page.getByLabel("함께 사는 가족 (본인 포함)")).toHaveValue("3");
    await page.getByTestId("prefill-hh-alt").click();
    await expect(page.getByTestId("prefill-household")).toContainText("본인 포함 4명");
    await expect(page.getByLabel("함께 사는 가족 (본인 포함)")).toHaveValue("4");
    await expect(page.getByTestId("v2-income")).toHaveValue("400");
    await page.getByTestId("prefill-confirm").click();
    await expect(page).toHaveURL(/\/results(\?for=self)?$/);
    await expect(page.getByTestId("v2-chips")).toContainText("소득 월 400만원", { timeout: 20_000 });
    await expect(page.getByTestId("v2-chips")).toContainText("4명 가구");
    await expect(page.getByTestId("v2-q-income")).toHaveCount(0);
    await expect(page.getByTestId("v2-q-alone")).toHaveCount(0);
    await expect(page.getByTestId("v2-q-activity")).toHaveCount(0);
    await expect(page.getByTestId("v2-a-children-none")).toHaveCount(0);
    expectPrivate(requests, (url) => url.includes("86") && url.includes("년생") || url.includes("만원") || /[?&=]400\b/.test(url));
  });

  test("문장 해석 → 아래에서 더 답하기: 해석값이 채워진 채로 한 화면 입력", async ({ page }) => {
    await openPrefill(page, "분당 사시는 어머니 혼자 사세요 1950년생");
    await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("prefill-edit").click();
    await expect(page.getByTestId("prefill-banner")).toHaveCount(0);
    await regionsReady(page);
    await expect(page.getByLabel(/^시·군·구/)).toHaveValue("41130");
    await expect(page.getByLabel("부모님 나이 (만)")).toHaveValue("75-79");
    await expect(page.getByLabel("함께 사는 가족 (본인 포함)")).toHaveValue("1");
  });

  test("검색: 서비스 이름은 그대로 검색, 지역 낱말은 그 지역까지, 상황 문장은 맞춤 찾기 제안", async ({ page }) => {
    await openPrefill(page, "기초연금");
    await expect(page).toHaveURL(/\/search\?q=/);
    await expect(page.getByText(/검색 결과 \d+개/)).toBeVisible({ timeout: 20_000 });
    await page.goto("/search?q=" + encodeURIComponent("수원 어르신 교통비"));
    await expect(page.getByTestId("search-auto-region")).toContainText("수원시", { timeout: 20_000 });
    await expect(page.getByTestId("program-card").filter({ hasText: "수원시 어르신 교통비 지원" })).toHaveCount(1);
    await expect(page.getByTestId("manual-badge").first()).toBeVisible();
    await page.goto("/search?q=" + encodeURIComponent("부모님 59년생 틀니"));
    await expect(page.getByTestId("search-situation")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("program-card").filter({ hasText: "건강보험 틀니" })).toHaveCount(1);
  });
});

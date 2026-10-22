/** 질문 따라 찾기 (2026-10-16): 홈 두 갈래 → 누구 → 사는 곳(현재 위치/직접) → 질문 5개 → 드문 사항 → 결과 */
import { expect, test, type Page, type Request } from "@playwright/test";

const MARKERS = ["37.26", "127.02", "incomeManwon", "bn.profile", "householdSize", "75-79", "70-79", "35-39"];
function expectPrivate(requests: Request[], origin: string) {
  for (const r of requests) {
    const url = decodeURIComponent(r.url());
    expect(r.method(), url).toBe("GET");
    expect(url.startsWith(origin) || url.startsWith("data:"), `외부 요청 ${url}`).toBeTruthy();
    for (const m of MARKERS) expect(url.includes(m), `${m} in ${url}`).toBeFalsy();
  }
}

/** 질문마다 첫 보기로 답하며 끝 화면까지 (질문 수를 돌려준다) */
async function answerAll(page: Page): Promise<number> {
  let n = 0;
  for (let i = 0; i < 12; i++) {
    const phase = await page.getByTestId("guided").getAttribute("data-phase");
    if (phase === "rare") {
      await page.getByTestId("gq-rare-ok").click();
      await expect(page.getByTestId("guided")).toHaveAttribute("data-phase", "done", { timeout: 20_000 });
    } else if (phase === "done") return n;
    else {
      const q = page.getByTestId("gq-question");
      await expect(q).toBeVisible();
      const before = await q.getAttribute("data-dim");
      await q.locator(".gq-opt").first().click();
      n++;
      // 같은 질문이 화면에서 사라질 때까지 (다음 질문 또는 드문 사항·끝 화면)
      await expect(page.locator(`[data-testid="gq-question"][data-dim="${before}"]`)).toHaveCount(0, { timeout: 20_000 });
    }
  }
  return n;
}

test.describe("질문 따라 찾기", () => {
  test("홈 → 부모님 → GPS 실패 후 직접 고르기 → 질문 5개 → 해당 없음 → 결과 (입력·위치는 기기 밖으로 안 나감) @mobile", async ({ page, baseURL }) => {
    const requests: Request[] = [];
    page.on("request", (r) => requests.push(r));
    await page.goto("/");
    await page.getByTestId("start-guided").click();
    await expect(page).toHaveURL(/\/ask$/);
    await page.getByTestId("gq-parent").click();
    await expect(page.getByTestId("gq-loc-error")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText("부모님이 사는 지역을 골라 주세요");
    await expect(page.getByTestId("gq-sido").locator("option")).not.toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("gq-sido").selectOption("41000");
    await page.getByTestId("gq-sigungu").selectOption({ label: "수원시" });
    await page.getByTestId("gq-region-ok").click();

    // 첫 질문은 나이, 부모님 찾기에는 '18세 이하'가 없다
    const q = page.getByTestId("gq-question");
    await expect(q).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
    await expect(page.getByTestId("gq-a-0-18")).toHaveCount(0);
    await expect(page.getByText("질문 1 / 5")).toBeVisible();
    await page.getByText("현재 혜택 후보 보기", { exact: true }).click();
    await expect(page.getByTestId("gq-ask")).toBeVisible();
    const ask0 = Number(await page.getByTestId("gq-ask").innerText());
    await page.getByTestId("gq-a-70-79").click();
    await expect(page.getByText("질문 2 / 5")).toBeVisible({ timeout: 20_000 });
    expect(Number(await page.getByTestId("gq-ask").innerText())).toBeLessThan(ask0);

    // 이전 → 같은 나이 질문으로
    await page.getByTestId("gq-back").click();
    await expect(q).toHaveAttribute("data-dim", "age");
    await page.getByTestId("gq-a-70-79").click();
    await expect(page.getByText("질문 2 / 5")).toBeVisible({ timeout: 20_000 });

    const n = await answerAll(page);
    expect(n).toBe(4);
    await expect(page.getByTestId("gq-done")).toBeVisible();
    await page.getByTestId("gq-results").click();
    await expect(page).toHaveURL(/\/results\?for=parent$/);
    await expect(page.getByTestId("parent-results-banner")).toBeVisible({ timeout: 20_000 });
    expectPrivate(requests, baseURL!);
  });

  test("끝 화면·'질문 더 답하기'에서 '이전'을 눌러도 화면이 비지 않는다 @mobile", async ({ page }) => {
    await page.goto("/ask");
    await page.getByTestId("gq-parent").click();
    await expect(page.getByTestId("gq-pick")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("gq-sido").locator("option")).not.toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("gq-sido").selectOption("41000");
    await page.getByTestId("gq-sigungu").selectOption({ label: "수원시" });
    await page.getByTestId("gq-region-ok").click();
    await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
    await answerAll(page);
    const guided = page.getByTestId("guided");
    await expect(guided).toHaveAttribute("data-phase", "done");
    // 끝 → 이전 = 드문 사항 고르기 → 이전 = 마지막 질문
    await page.getByTestId("gq-back").click();
    await expect(guided).toHaveAttribute("data-phase", "rare");
    await expect(page.getByTestId("gq-rare")).toBeVisible();
    await page.getByTestId("gq-back").click();
    await expect(guided).toHaveAttribute("data-phase", "ask");
    await expect(page.getByTestId("gq-question")).toBeVisible();
    // 다시 끝까지 → 질문 더 답하기 → 이전 = 끝 화면
    await answerAll(page);
    await expect(guided).toHaveAttribute("data-phase", "done");
    await expect(page.getByTestId("gq-more")).toBeVisible();
    await page.getByTestId("gq-more").click();
    await expect(page.getByTestId("gq-question")).toBeVisible();
    await page.getByTestId("gq-back").click();
    await expect(guided).toHaveAttribute("data-phase", "done");
    await expect(page.getByTestId("gq-done")).toBeVisible();
    // 어느 화면이든 내용이 비어 있지 않다
    await expect(page.locator("#gq-h")).toBeVisible();
  });

  test.describe("가구 확인 후 자녀 질문", () => {
    async function familyStep(page: Page) {
      await page.goto("/ask");
      await page.getByTestId("gq-self").click();
      await expect(page.getByTestId("gq-pick")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("gq-sido").locator("option")).not.toHaveCount(1);
      await page.getByTestId("gq-sido").selectOption("41000");
      await page.getByTestId("gq-sigungu").selectOption({ label: "수원시" });
      await page.getByTestId("gq-region-ok").click();
      await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
      await page.getByTestId("gq-a-35-39").click();
      await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "alone");
      await expect(page.getByTestId("gq-a-pregnant")).toHaveCount(0);
      await page.getByTestId("gq-a-3").click();
      await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "family");
      await expect(page.getByTestId("gq-a-0-1")).toHaveCount(0);
    }

    test("가구원 수 → 자녀 유무 → 나이, 이전에서 해당 없음으로 고치면 자녀 질문 생략 @mobile", async ({ page }, testInfo) => {
      await familyStep(page);
      await page.screenshot({ path: `logs/family-step-${testInfo.project.name}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.getByTestId("gq-a-children").click();
      await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "children");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("함께 사는 자녀의 나이를 모두 골라 주세요");
      await expect(page.getByTestId("gq-child-pregnant")).toHaveCount(0);
      await expect(page.getByTestId("gq-child-none")).toHaveCount(0);
      await page.getByTestId("gq-back").click();
      await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "family");
      await page.getByTestId("gq-a-none").click();
      await expect(page.getByTestId("gq-question")).not.toHaveAttribute("data-dim", /family|children|daycare|singleParent/);
      await answerAll(page);
      await expect(page.getByTestId("gq-done")).toBeVisible();
      await page.getByTestId("gq-results").click();
      await expect(page).toHaveURL(/\/results$/);
      const stored = await page.evaluate(() => ({
        profile: JSON.parse(localStorage.getItem("bn.profile.v1") ?? sessionStorage.getItem("bn.profile.v1") ?? "null"),
        facts: JSON.parse(localStorage.getItem("bn.facts.v1") ?? sessionStorage.getItem("bn.facts.v1") ?? "null"),
      }));
      expect(stored.profile.householdSize).toBe(3);
      expect(stored.profile.children).toEqual([]);
      expect(stored.facts.family).toBe("none");
    });

    test("자녀·출산 예정 두 조건 저장, 자녀 나이에서 임신을 다시 묻지 않음 @mobile", async ({ page }) => {
      await familyStep(page);
      await page.getByTestId("gq-a-both").click();
      await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "children");
      await expect(page.getByTestId("gq-child-pregnant")).toHaveCount(0);
      await page.getByTestId("gq-child-2-5").check();
      await page.getByTestId("gq-child-count-1").click();
      await page.getByTestId("gq-child-ok").click();
      await expect(page.getByTestId("gq-question")).not.toHaveAttribute("data-dim", "children");
      await page.getByTestId("gq-now").click();
      await expect(page).toHaveURL(/\/results$/);
      const children = await page.evaluate(() => JSON.parse(localStorage.getItem("bn.profile.v1") ?? sessionStorage.getItem("bn.profile.v1") ?? "null").children);
      expect(children).toEqual(["pregnant", "2-5"]);
    });

    test("해당 여부를 건너뛰면 자녀 나이를 묻거나 없음으로 저장하지 않음", async ({ page }) => {
      await familyStep(page);
      await page.getByTestId("gq-a-unknown").click();
      await expect(page.getByTestId("gq-question")).not.toHaveAttribute("data-dim", /family|children|daycare|singleParent/);
      await page.getByTestId("gq-now").click();
      await expect(page).toHaveURL(/\/results$/);
      const stored = await page.evaluate(() => ({
        profile: JSON.parse(localStorage.getItem("bn.profile.v1") ?? sessionStorage.getItem("bn.profile.v1") ?? "null"),
        facts: JSON.parse(localStorage.getItem("bn.facts.v1") ?? sessionStorage.getItem("bn.facts.v1") ?? "null"),
      }));
      expect(stored.profile.children).toBeNull();
      expect(stored.facts.childCount).toBeUndefined();
      expect(stored.facts.family).toBeUndefined();
    });
  });

  test.describe("현재 위치", () => {
    test.use({ geolocation: { latitude: 37.2636, longitude: 127.0286 }, permissions: ["geolocation"] });
    test("홈·예시·질문이 위치를 한 번만 조회하고 거주지만 확인한다 @mobile", async ({ page }) => {
      await page.addInitScript(() => {
        const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
        Object.assign(window, { gpsCalls: 0 });
        navigator.geolocation.getCurrentPosition = (...args) => {
          const count = window as Window & { gpsCalls?: number };
          count.gpsCalls = (count.gpsCalls ?? 0) + 1;
          return original(...args);
        };
      });
      const boundaries = page.waitForResponse("**/geo/sgg-20260701.json");
      await page.goto("/");
      await boundaries;
      await expect.poll(() => page.evaluate(() => (window as Window & { gpsCalls?: number }).gpsCalls)).toBe(1);
      await page.getByTestId("preset-locate").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("locate-status")).toContainText("경기 수원시 기준", { timeout: 30_000 });
      expect(await page.evaluate(() => (window as Window & { gpsCalls?: number }).gpsCalls)).toBe(1);
      await page.getByTestId("start-guided").click();
      await expect(page.getByTestId("guided")).toHaveAttribute("data-phase", "who");
      await expect(page.locator("header nav")).toHaveCount(0);
      await expect(page.locator("main").getByRole("link", { name: "말로 찾기", exact: true })).toHaveCount(0);
      await page.getByTestId("gq-parent").click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(/수원.*부모님 주소가 여기 맞나요\?/);
      expect(await page.evaluate(() => (window as Window & { gpsCalls?: number }).gpsCalls)).toBe(1);
      await expect(page.getByTestId("gq-question")).toHaveCount(0);
      await page.getByTestId("gq-here").click();
      await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
      expect(await page.evaluate(() => (window as Window & { gpsCalls?: number }).gpsCalls)).toBe(1);
    });
    test("부모님도 GPS 먼저 → 주소 확인 → 아니면 직접 선택 → 다시 GPS 확인 @mobile", async ({ page }) => {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/geo/sgg-20260701.json", async (route) => { await pending; await route.continue(); });
      const started = page.waitForRequest("**/geo/sgg-20260701.json");
      await page.goto("/ask");
      await started;
      await expect(page.getByTestId("guided")).toHaveAttribute("data-phase", "who");
      await page.getByTestId("gq-parent").click();
      await expect(page.getByTestId("gq-locating")).toBeVisible();
      await expect(page.getByTestId("gq-pick")).toHaveCount(0);
      release();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(/수원.*부모님 주소가 여기 맞나요\?/, { timeout: 30_000 });
      await expect(page.getByTestId("gq-pick")).toHaveCount(0);
      await expect(page.getByTestId("gq-question")).toHaveCount(0);
      await page.getByTestId("gq-elsewhere").click();
      await expect(page.getByTestId("gq-pick")).toBeVisible();
      await expect(page.getByTestId("gq-here")).toHaveCount(0);
      await page.getByTestId("gq-sido").selectOption("50000");
      await page.getByTestId("gq-sigungu").selectOption({ label: "서귀포시" });
      await expect(page.getByTestId("gq-region-ok")).toBeEnabled();
      await page.getByTestId("gq-locate").click();
      await expect(page.getByTestId("gq-here")).toBeVisible();
      await expect(page.getByTestId("gq-pick")).toHaveCount(0);
      await page.getByTestId("gq-here").click();
      await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
      await expect(page.getByTestId("guided")).toHaveAttribute("data-mode", "parent");
      await expect(page.getByTestId("gq-a-0-18")).toHaveCount(0);
    });
    test("위치를 기다리다 직접 선택해도 늦은 응답이 선택과 초점을 바꾸지 않는다", async ({ page }) => {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/geo/sgg-20260701.json", async (route) => { await pending; await route.continue(); });
      await page.goto("/ask");
      await page.getByTestId("gq-self").click();
      await page.getByTestId("gq-manual").click();
      await expect(page.locator("#gq-h")).toBeFocused();
      await page.getByTestId("gq-sido").selectOption("50000");
      await page.getByTestId("gq-sigungu").selectOption({ label: "서귀포시" });
      const response = page.waitForResponse("**/geo/sgg-20260701.json");
      release();
      await response;
      await expect(page.getByTestId("gq-pick")).toBeVisible();
      await expect(page.getByTestId("gq-here")).toHaveCount(0);
      await expect(page.getByTestId("gq-sigungu")).toHaveValue("50130");
      // 상위 지역을 바꾸면 이전 시·군·구로 진행할 수 없어야 한다.
      await page.getByTestId("gq-sido").selectOption("26000");
      await expect(page.getByTestId("gq-sigungu")).toHaveValue("");
      await expect(page.getByTestId("gq-region-ok")).toBeDisabled();
    });
    test("나 → 현재 위치(수원)를 확인 → 10대 보기 → 지금 결과 보기 @mobile", async ({ page }) => {
      await page.goto("/ask");
      await page.getByTestId("gq-self").click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(/수원.*여기 맞나요\?/, { timeout: 30_000 });
      await expect(page.getByTestId("gq-pick")).toHaveCount(0);
      await page.getByTestId("gq-here").click();
      await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
      await expect(page.getByTestId("gq-a-0-18")).toBeVisible();
      await page.getByTestId("gq-a-35-39").click();
      await expect(page.getByText("질문 2 / 5")).toBeVisible({ timeout: 20_000 });
      await page.getByTestId("gq-now").click();
      await expect(page).toHaveURL(/\/results$/);
      await expect(page.getByTestId("top-picks")).toBeVisible({ timeout: 20_000 });
    });
  });

  test.describe("위치 권한 거절", () => {
    test.use({ permissions: [] });
    test("현재 위치를 못 쓰면 직접 고르기로", async ({ page }) => {
      await page.goto("/ask");
      await page.getByTestId("gq-self").click();
      await expect(page.getByTestId("gq-loc-error")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("gq-pick")).toBeVisible();
    });
  });

  test("위치 API가 응답하지 않아도 직접 선택할 수 있다", async ({ page }) => {
    await page.clock.install();
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = () => {};
    });
    await page.goto("/ask");
    await page.getByTestId("gq-self").click();
    await expect(page.getByTestId("gq-locating")).toBeVisible();
    await page.clock.fastForward(15_100);
    await expect(page.getByTestId("gq-pick")).toBeVisible();
    await expect(page.getByTestId("gq-locating")).toHaveCount(0);
  });
});

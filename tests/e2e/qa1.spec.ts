import { openPrefill } from "./helpers/prefill";
import { expect, test, type Page, type Request } from "@playwright/test";

/** QA 1차 수정 확인 (리뷰 보고서 항목 ID를 제목에 표기) */

async function fromSentence(page: Page, sentence: string) {
  await openPrefill(page, sentence);
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
}

test.describe("QA 1차", () => {
  test("C3·H1·M3: 73세 혼자 월 90만원 → 기초연금이 먼저, 생계급여는 '맞아요'가 아님, 공유 글에 입력값 없음 @mobile", async ({ page }) => {
    await page.addInitScript(() => {
      // 공유 시트 대신 복사 경로로 보내 내용을 확인
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: async (t: string) => ((window as unknown as { __copied: string }).__copied = t) },
        configurable: true,
      });
    });
    const requests: Request[] = [];
    page.on("request", (r) => requests.push(r));
    await fromSentence(page, "수원에 사는 73세 혼자 살아요 한 달 소득 90만원");
    await page.getByTestId("prefill-confirm").click();
    const picks = page.getByTestId("top-picks");
    await expect(picks.locator("ol > li").first()).toContainText("기초연금", { timeout: 20_000 });
    await expect(page.getByTestId("non-pilot-note")).toHaveCount(0);
    // 생계급여는 '맞아요' 목록에 없어야 함 (재산·부양 조사 → 많아야 '신청할 때 확인')
    await expect(page.getByTestId("v2-fit").locator("h3").filter({ hasText: /^\s*생계급여/ })).toHaveCount(0);
    await page.getByTestId("share").click();
    const copied = await page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? "");
    expect(copied).toContain("/p/");
    expect(copied).not.toMatch(/73|90만|혼자|1인/);
    for (const r of requests) expect(decodeURIComponent(r.url())).not.toMatch(/73세|90만/);
  });

  test("H4: '광주'만 쓰면 광주광역시·경기 광주시 중 고르기, 바로 고칠 수 있음 @mobile", async ({ page }) => {
    await fromSentence(page, "광주 사시는 어머니 70세");
    const choices = page.getByTestId("prefill-region-choice");
    await expect(choices).toHaveCount(2);
    await choices.filter({ hasText: "경기" }).click();
    await expect(choices.filter({ hasText: "경기" })).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("prefill-edit").click();
    await expect(page.getByLabel(/^시·군·구/)).toHaveValue("41610");
  });

  test("M6: 시범 지역(경기도) 밖이면 결과에 안내", async ({ page }) => {
    await fromSentence(page, "부산 해운대구에 사는 70세 혼자 살아요");
    await page.getByTestId("prefill-confirm").click();
    await expect(page.getByTestId("non-pilot-note")).toBeVisible({ timeout: 20_000 });
  });

  test("M4: 비슷한 말·알아볼 수 없는 검색어·위기 문장 @mobile", async ({ page }) => {
    await page.goto("/search?q=" + encodeURIComponent("ㅁㄴㅇㄹ"));
    await expect(page.getByTestId("search-gibberish")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("program-card")).toHaveCount(0);
    await page.goto("/search?q=" + encodeURIComponent("출산지원금"));
    await expect(page.getByTestId("program-card").first()).toBeVisible({ timeout: 20_000 });
    await page.goto("/search?q=" + encodeURIComponent("요즘 죽고 싶어요"));
    await expect(page.getByTestId("crisis-109")).toBeVisible({ timeout: 20_000 });
  });

  test("M5: 공개 메타데이터(설명·OG), 색인 허용, 없는 상세는 404", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /icons\/icon-512\.png/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /상황/);
    expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBe(0);
    const r = await request.get("/p/n.gov24-NOPE0000000");
    expect(r.status()).toBe(404);
  });
});

test("신청 창구 정보가 없는 사업은 빈 괄호 '()' 없이 표시", async ({ page }) => {
  await page.goto("/p/n.manual-nhis-senior-implant");
  await expect(page.locator("main")).toContainText("국민건강보험공단", { timeout: 20_000 });
  expect(await page.locator("main").innerText()).not.toContain("()");
});

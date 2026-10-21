/** (2026-10-16 회의) 질문 따라 찾기 끝 화면: 고른 답 요약 + 항목별 고치기, 질문 번호 옆 질문 이름 */
import { expect, test } from "@playwright/test";

test("끝 화면에 내가 고른 답이 모이고, '고치기'로 그 질문에 돌아간다 @mobile", async ({ page }) => {
  await page.goto("/ask");
  await page.getByTestId("gq-parent").click();
  await expect(page.getByTestId("gq-sido").locator("option")).not.toHaveCount(1, { timeout: 20_000 });
  await page.getByTestId("gq-sido").selectOption("41000");
  await page.getByTestId("gq-sigungu").selectOption({ label: "수원시" });
  await page.getByTestId("gq-region-ok").click();

  const q = page.getByTestId("gq-question");
  await expect(q).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
  await expect(page.getByTestId("gq-step")).toHaveText("질문 1 / 5 · 나이");
  await page.getByTestId("gq-a-70-79").click();
  await expect(page.locator('[data-testid="gq-question"][data-dim="age"]')).toHaveCount(0, { timeout: 20_000 });
  for (let i = 0; i < 10; i++) {
    const phase = await page.getByTestId("guided").getAttribute("data-phase");
    if (phase === "done") break;
    if (phase === "rare") {
      await page.getByTestId("gq-rare-ok").click();
      await expect(page.getByTestId("guided")).toHaveAttribute("data-phase", "done", { timeout: 20_000 });
      break;
    }
    const before = await q.getAttribute("data-dim");
    await expect(page.getByTestId("gq-a-unknown")).toBeEnabled();
    await page.getByTestId("gq-a-unknown").click();
    await expect(page.locator(`[data-testid="gq-question"][data-dim="${before}"]`)).toHaveCount(0, { timeout: 20_000 });
  }
  const sum = page.getByTestId("gq-summary");
  await expect(sum).toBeVisible();
  await expect(sum).toContainText("부모님");
  await expect(sum).toContainText("경기 수원시");
  await expect(sum.getByTestId("gq-pick-age")).toContainText("70~79세");
  await expect(sum.locator("[data-testid^=gq-pick-]")).not.toHaveCount(1);
  await expect(sum).toContainText("건너뛰기");

  await sum.getByTestId("gq-fix-age").click();
  await expect(q).toHaveAttribute("data-dim", "age");
  await expect(page.getByTestId("gq-step")).toHaveText("질문 1 / 5 · 나이");
  await page.getByTestId("gq-a-65-69").click();
  await expect(page.getByTestId("gq-step")).toContainText("질문 2 / 5", { timeout: 20_000 });
});

test("나이 '70~79세'로 답하면 결과와 상황 고치기 화면에 그대로 (70~74·75~79 따로 없음)", async ({ page }) => {
  await page.goto("/ask");
  await page.getByTestId("gq-parent").click();
  await expect(page.getByTestId("gq-sido").locator("option")).not.toHaveCount(1, { timeout: 20_000 });
  await page.getByTestId("gq-sido").selectOption("41000");
  await page.getByTestId("gq-sigungu").selectOption({ label: "수원시" });
  await page.getByTestId("gq-region-ok").click();
  await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
  await expect(page.getByTestId("gq-a-70-74")).toHaveCount(0);
  await expect(page.getByTestId("gq-a-75-79")).toHaveCount(0);
  await page.getByTestId("gq-a-70-79").click();
  await expect(page.locator('[data-testid="gq-question"][data-dim="age"]')).toHaveCount(0, { timeout: 20_000 });
  await page.getByTestId("gq-now").click();
  await expect(page.getByTestId("top-picks")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("v2-results")).toContainText("만 70~79세");
  await expect(page.getByTestId("top-picks")).toContainText("기초연금");
  await page.goto("/situation?for=parent&details=1");
  await expect(page.getByLabel("부모님 나이 (만)")).toHaveValue("70-79");
});

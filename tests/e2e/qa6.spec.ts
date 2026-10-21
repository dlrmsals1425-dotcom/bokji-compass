import { openPrefill } from "./helpers/prefill";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** QA 6차 후속: 청소년 본인(학교 밖) · 자녀 둔 부모 문장 · 카드 안내 */

async function toResults(page: Page, sentence: string) {
  await openPrefill(page, sentence);
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("prefill-confirm").click();
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
}

test.describe("QA 6차 후속", () => {
  test("자퇴한 열일곱 → 본인, 학교 밖 청소년 지원이 맨 위, 1388·꿈드림 안내, 무상교육 없음 @mobile", async ({ page }) => {
    await toResults(page, "고등학교 자퇴한 열일곱살이에요 수원");
    const note = page.getByTestId("teen-note");
    await expect(note).toBeVisible();
    await expect(note).toContainText("1388");
    await expect(note).toContainText("꿈드림");
    await expect(note).toContainText("www.kdream.or.kr");
    const picks = page.getByTestId("pick");
    await expect(picks.first()).toBeVisible({ timeout: 20_000 });
    await expect(picks.nth(0).locator("h3")).toContainText(/학교\s*밖|꿈드림|학업\s*중단/);
    await expect(page.getByTestId("top-picks")).not.toContainText("고등학교 무상교육");
    await expect(page.getByTestId("top-picks")).not.toContainText(/자녀/);
    expect(page.url()).not.toMatch(/자퇴|열일곱|%EC%9E%90|age/);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  });

  test("학교 안 다니는 열여섯 → 학교 밖 청소년 지원 @mobile", async ({ page }) => {
    await toResults(page, "학교 안 다니는 열여섯살 안산");
    await expect(page.getByTestId("teen-note")).toBeVisible();
    await expect(page.getByTestId("pick").first().locator("h3")).toContainText(/학교\s*밖|꿈드림|학업\s*중단/, { timeout: 20_000 });
  });

  test("고등학생 딸 키우는 엄마 → 본인 찾기, 청소년 안내 없음, 자녀 혜택 @mobile", async ({ page }) => {
    await toResults(page, "고등학생 딸 키우는 엄마 안산");
    await expect(page.getByTestId("pick").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("teen-note")).toHaveCount(0);
    await expect(page.getByTestId("top-picks")).toContainText("내 상황에");
    await expect(page.getByTestId("top-picks")).toContainText(/자녀/);
    await expect(page.getByTestId("top-picks")).not.toContainText(/학교\s*밖/);
  });

  test("부모 동의: 원문에 적힌 경우만, 나이 한정도 그대로 (열세살 ○ · 열다섯살 ×)", async ({ page }) => {
    await toResults(page, "학교 안 다니는 열세살 의왕");
    await expect(page.getByTestId("pick").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("note-consent").first()).toContainText("만 14세 미만은 부모(보호자) 동의 필요", { timeout: 20_000 });
    await toResults(page, "학교 안 다니는 열다섯살 의왕");
    await expect(page.getByTestId("pick").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("note-consent")).toHaveCount(0);
  });
});

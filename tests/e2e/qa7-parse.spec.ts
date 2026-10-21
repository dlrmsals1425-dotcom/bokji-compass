import { openPrefill } from "./helpers/prefill";
import { expect, test } from "@playwright/test";

/** 6차 프로덕션 검증 후속 (claude-code-fixes) P1·P2: 10대 문장 해석 */
test("P1: '중학생인데 부모님이 안 계셔요' → 본인 찾기, 부모님 질문 없음, 10대 안내 @mobile", async ({ page }) => {
  await openPrefill(page, "중학생인데 부모님이 안 계셔요 수원");
  const banner = page.getByTestId("prefill-banner");
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(banner).not.toContainText("대신 찾기");
  await expect(banner).not.toContainText("부모님 나이");
  await expect(banner).toContainText("만 12~15세");
  await page.getByTestId("prefill-confirm").click();
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("teen-note")).toBeVisible();
  await expect(page.getByTestId("money-summary")).not.toContainText("부모님이 받으실");
  expect(page.url()).not.toMatch(/중학생|부모|%EC%A4%91/);
});

test("P2: '열여덟살 고삼 딸 엄마예요' → 엄마 본인은 10대가 아님 @mobile", async ({ page }) => {
  await openPrefill(page, "열여덟살 고삼 딸 엄마예요 수원");
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("prefill-banner")).not.toContainText("만 18세");
  await page.getByTestId("prefill-confirm").click();
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("teen-note")).toHaveCount(0);
});

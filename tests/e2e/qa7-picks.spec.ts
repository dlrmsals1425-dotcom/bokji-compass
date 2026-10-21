import { openPrefill } from "./helpers/prefill";
import { expect, test } from "@playwright/test";

/** 6차 프로덕션 검증 후속 (claude-code-fixes) P4: 부모 화면 먼저 확인할 5가지 */
test("P4: '고등학생 딸 키우는 엄마 안산' — 청소년회복지원시설·비즈쿨 없음, 교통비·무상교육 유지 @mobile", async ({ page }) => {
  await openPrefill(page, "고등학생 딸 키우는 엄마 안산");
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("prefill-confirm").click();
  const picks = page.getByTestId("top-picks");
  await expect(picks).toBeVisible({ timeout: 20_000 });
  await expect(picks).not.toContainText(/청소년회복지원시설|비즈쿨|대지급금/);
  await expect(picks).toContainText("교통비");
  await expect(picks).toContainText("고등학교 무상교육");
});

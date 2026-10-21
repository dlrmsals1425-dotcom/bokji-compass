import { openPrefill } from "./helpers/prefill";
import { expect, test } from "@playwright/test";

/** 결정 2b: '아이 키우는 엄마 안산' — 자녀 나이부터 묻고, 답하면 먼저 확인할 것이 채워짐 */
test("자녀 나이를 먼저 묻고, 답하면 먼저 확인할 5가지가 나옴 @mobile", async ({ page }) => {
  await openPrefill(page, "아이 키우는 엄마 안산");
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("prefill-confirm").click();
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".v2-q").first()).toHaveAttribute("data-testid", "v2-q-children");
  await expect(page.getByTestId("picks-need-age")).toContainText("자녀 나이");
  await page.getByTestId("v2-a-children-6-12").click();
  await expect(page.getByTestId("pick").first()).toBeVisible({ timeout: 10_000 });
});

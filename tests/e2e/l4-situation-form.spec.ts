import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** 결정 5b (2026-10-09): 입력 화면 — 드문 신분(보훈·다문화)은 '더 답하기'로 접고 글자를 한 단계 키움 */
test("보훈·다문화는 접혀 있고 펼치면 답할 수 있음, 선택지 글자 17px 이상 @mobile", async ({ page }) => {
  await page.goto("/situation?for=self&new=1&details=1");
  const more = page.getByTestId("sf-more");
  await expect(more).toBeVisible({ timeout: 20_000 });
  await expect(more).not.toHaveAttribute("open", "");
  await expect(page.locator('input[name="veteran"]').first()).toBeHidden();
  await more.locator("summary").click();
  await expect(page.locator('input[name="veteran"]').first()).toBeVisible();
  const px = await page.locator(".opt span").first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(px).toBeGreaterThanOrEqual(17);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

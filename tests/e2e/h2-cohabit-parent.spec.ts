import { openPrefill } from "./helpers/prefill";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** 결정 1b: '장인어른 모시고 삽니다 부천' — 함께 사는 부모님 혜택을 같은 화면에서 */
test("함께 사시는 분 나이대를 고르면 그분 기준 혜택이 나옴, 주소에 나이 없음 @mobile", async ({ page }) => {
  await openPrefill(page, "장인어른 모시고 삽니다 부천");
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("prefill-confirm").click();
  const panel = page.getByTestId("cohab-parent");
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await panel.getByTestId("cohab-age-70-74").click();
  const cards = panel.getByTestId("cohab-picks").getByTestId("v2-card");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThanOrEqual(3);
  await expect(panel.getByTestId("cohab-picks")).toContainText(/기초연금|노인|어르신/);
  expect(page.url()).not.toMatch(/70|age|장인/);
  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
});

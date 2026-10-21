import { openPrefill } from "./helpers/prefill";
import { expect, test } from "@playwright/test";

/** byHh: 가구원 수별 금액 — 원문 표에서 내 가구원 수 칸 */
test("혼자 사는 어르신 예시: 기초연금은 단독가구 금액 @mobile", async ({ page }) => {
  await page.goto("/results?example=suwon-senior");
  const fit = page.getByTestId("sum-fit");
  await expect(fit).toContainText("단독가구 월 최대 34만 9,700원", { timeout: 20_000 });
  await expect(fit).not.toContainText("55만 9,520원");
});

test("'안산 사는 73살 혼자 살아요': 생계급여·긴급복지는 1인 가구 금액 @mobile", async ({ page }) => {
  await openPrefill(page, "안산 사는 73살 혼자 살아요");
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("prefill-confirm").click();
  const next = page.getByTestId("sum-next-money");
  await expect(next).toContainText("생계급여 1인 가구 월 최대 82만 556원", { timeout: 20_000 });
  await expect(next).toContainText("긴급복지 생계지원 1인 가구 최대 78만 3,000원");
  await expect(next).not.toContainText("241만");
});

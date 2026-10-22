import { openPrefill } from "./helpers/prefill";
import { expect, test } from "@playwright/test";

/**
 * byHh: 가구원 수별 금액 — 원문 표에서 내 가구원 수 칸 (기초연금 단독가구 금액은 단위 테스트 money-household.test.ts)
 * (2026-10-22) 혼자 사는 어르신 예시는 '기초연금 받음'이라 기초연금이 한눈에 보기에서 빠지고 '이미 받고 있는 혜택'으로 간다
 */
test("혼자 사는 어르신 예시: 이미 받는 기초연금은 한눈에 보기 금액에 없음 @mobile", async ({ page }) => {
  await page.goto("/results?example=suwon-senior");
  await expect(page.getByTestId("money-summary")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("money-summary")).not.toContainText("34만 9,700원");
  await expect(page.getByTestId("receiving-section")).toContainText("기초연금");
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

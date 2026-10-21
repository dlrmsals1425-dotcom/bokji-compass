import { openPrefill } from "./helpers/prefill";
import { expect, test } from "@playwright/test";

/** 운영자 피드백 2026-10-09: 신청 기간이 끝난 사업, '질문에 답하면 정해지는 혜택'에서 답하는 곳 */
test("상세: 신청 기간이 끝난 사업은 끝났다고 알림 @mobile", async ({ page }) => {
  await page.goto("/p/s41000.gov24-641000000111");
  await expect(page.getByTestId("detail-closed")).toContainText("2026년 9월 18일에 끝났어요");
});

test("결과: 끝난 사업은 따로, '질문에 답하러 가기'로 질문 위치로 이동 @mobile", async ({ page }) => {
  await openPrefill(page, "수원 사는 5살 아이 엄마예요");
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("prefill-confirm").click();
  await expect(page.getByTestId("pick").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("v2-fit")).not.toContainText("경기도 어린이 건강과일 공급");
  const closed = page.getByTestId("v2-closed");
  await closed.locator(":scope > summary").click();
  await expect(closed).toContainText("경기도 어린이 건강과일 공급");
  await expect(closed.getByTestId("closed-note").first()).toContainText("끝났어요");
  const go = page.getByTestId("v2-ask-go");
  await expect(go).toBeVisible();
  await go.click();
  await expect(page.locator("#v2-followup")).toBeInViewport();
});

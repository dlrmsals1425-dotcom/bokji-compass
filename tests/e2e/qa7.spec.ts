import { openPrefill } from "./helpers/prefill";
import { expect, test, type Page } from "@playwright/test";

/** 6차 프로덕션 검증 후속 (claude-code-fixes): 한눈에 보기 금액 M2·M3 */

async function toResults(page: Page, sentence: string) {
  await openPrefill(page, sentence);
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("prefill-confirm").click();
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
}

test.describe("QA 7차: 한눈에 보기 금액", () => {
  test("M2: 혼자 사는 어르신 예시 — 기초연금에 부부가구 금액을 쓰지 않음 @mobile", async ({ page }) => {
    await page.goto("/results?example=suwon-senior");
    const sum = page.getByTestId("money-summary");
    await expect(sum).toBeVisible({ timeout: 20_000 });
    await expect(sum).not.toContainText("55만 9,520원");
  });

  test("M2: '안산 사는 73살 혼자 살아요' — 생계급여·긴급복지에 5·6인 가구 금액 없음 @mobile", async ({ page }) => {
    await toResults(page, "안산 사는 73살 혼자 살아요");
    const sum = page.getByTestId("money-summary");
    await expect(sum).toBeVisible({ timeout: 20_000 });
    await expect(sum).not.toContainText("241만 8,150원");
    await expect(sum).not.toContainText("263만 6,700원");
    await expect(sum).not.toContainText("66만 2,500원");
  });

  test("M3: 임금·보험 보장액·시간당 단가는 혜택 금액으로 쓰지 않음", async ({ page }) => {
    await toResults(page, "안양 스물여덟 구직 중이에요");
    await expect(page.getByTestId("money-summary")).not.toContainText("290만 7,000원", { timeout: 20_000 });
    await toResults(page, "고등학교 자퇴한 열일곱살이에요 수원");
    await expect(page.getByTestId("money-summary")).not.toContainText("2,000만원", { timeout: 20_000 });
    await toResults(page, "학교 안 다니는 열여섯살 안산");
    await expect(page.getByTestId("money-summary")).not.toContainText("최대 3,000원", { timeout: 20_000 });
  });
});

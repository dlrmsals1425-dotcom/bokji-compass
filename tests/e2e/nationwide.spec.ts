import { openPrefill } from "./helpers/prefill";
import { expect, test } from "@playwright/test";

/** 전국 확대 (2026-10-10): 경기도 밖 지역도 '받으실 수 있어요'까지 판정, 통합시 옛 지역, 인천 개편 문장 */

async function fromSentence(page: import("@playwright/test").Page, text: string) {
  await openPrefill(page, text);
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
}

test("서울 광진구 70대 혼자 → 지역 사업도 '받으실 수 있어요', 경기도 밖 안내 @mobile", async ({ page }) => {
  await fromSentence(page, "서울 광진구에 사는 76세 혼자 살아요 기초연금 받아요");
  await page.getByTestId("prefill-confirm").click();
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("non-pilot-note")).toContainText("지역 조건 확인 중");
  await expect(page.getByText("어르신복지카드 발급").first()).toBeVisible();
});

test("영암군 청년에게 옛 광주광역시 사업(광주청년구직활동수당)이 나오지 않음", async ({ page }) => {
  await page.goto("/search?q=" + encodeURIComponent("광주청년구직활동수당"));
  await page.locator("#s-sido").selectOption("12000");
  await page.locator("#s-sigungu").selectOption({ label: "영암군" });
  await expect(page.locator(".search-count h2")).toContainText("검색 결과", { timeout: 20_000 });
  await expect(page.locator(".prow h3", { hasText: "광주청년구직활동수당" })).toHaveCount(0);
  await page.locator("#s-sigungu").selectOption({ label: "광산구" });
  await expect(page.locator(".prow h3", { hasText: "광주청년구직활동수당" }).first()).toBeVisible({ timeout: 20_000 });
});

test("'인천 중구 살아요' → 2026년 7월 개편 안내와 제물포구·영종구 고르기", async ({ page }) => {
  await fromSentence(page, "인천 중구 살아요 70세");
  await expect(page.getByTestId("prefill-banner")).toContainText("2026년 7월");
  await expect(page.getByText("인천 제물포구").first()).toBeVisible();
  await expect(page.getByText("인천 영종구").first()).toBeVisible();
});

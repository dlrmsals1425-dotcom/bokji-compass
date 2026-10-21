import { openPrefill } from "./helpers/prefill";
import { expect, test, type Page } from "@playwright/test";

/** QA 2차 수정 확인 (리뷰 보고서 항목 ID를 제목에 표기, 재현 문장 그대로) */

async function fromHome(page: Page, sentence: string) {
  await openPrefill(page, sentence);
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
}

test.describe("QA 2차", () => {
  test("N1·N2: '저는 엄마고 우리 엄마는 일흔이세요' → 부모님 찾기, 70세 @mobile", async ({ page }) => {
    await fromHome(page, "저는 엄마고 우리 엄마는 일흔이세요");
    await expect(page).toHaveURL(/for=parent/);
    await expect(page.getByTestId("prefill-line")).toContainText("70");
    await expect(page.getByTestId("prefill-line")).not.toContainText("72");
    await expect(page.getByTestId("prefill-region")).toBeVisible();
  });

  test("N5: 지역 없는 상황 문장은 검색이 아니라 맞춤 찾기(지역 묻기)로 @mobile", async ({ page }) => {
    for (const s of ["기초연금 못 받고 계세요", "치매 진단 받으셨어요"]) {
      await fromHome(page, s);
      await expect(page).toHaveURL(/\/situation\?for=parent/);
      await expect(page.getByTestId("prefill-region")).toBeVisible();
    }
    // 서비스 이름은 그대로 검색, 정확히 맞는 이름이 1위
    await openPrefill(page, "기초연금");
    await expect(page).toHaveURL(/\/search\?q=/);
    await expect(page.getByTestId("program-card").first()).toContainText("기초연금", { timeout: 20_000 });
  });

  test("N3·H2·M1: 30대 맞벌이 + 돌 안 된 아기 → 부모급여·첫만남이용권, '신청할 때 확인'은 상위 20개 먼저 @mobile", async ({ page }) => {
    await page.goto("/situation?for=self");
    await expect(page.locator("#sido option")).not.toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("v2-text").fill("용인 수지 사는 30대 맞벌이 부부고 돌 안 된 아기 하나 있어요");
    await page.getByTestId("v2-fill").click();
    await expect(page.getByTestId("v2-understood")).toContainText("30대", { timeout: 20_000 });
    await page.getByTestId("v2-submit").click();
    const picks = page.getByTestId("top-picks");
    await expect(picks).toContainText(/부모\s*급여/, { timeout: 20_000 });
    await expect(picks).toContainText(/첫\s*만남/);
    await expect(picks).not.toContainText(/정신건강복지센터|보호대상아동|누리과정/);
    await expect(page.getByTestId("v2-chips")).toContainText("30대");
    await expect(page.getByTestId("v2-office-top-note")).toContainText("20개");
    await expect(page.getByTestId("v2-office").locator(".v2-list > *")).toHaveCount(20);
  });

  test("M7: 부모님 두 분 나이가 다르면 '다른 분 기준으로 보기'", async ({ page }) => {
    await page.goto("/situation?for=parent");
    await expect(page.locator("#sido option")).not.toHaveCount(1, { timeout: 20_000 });
    await page.getByTestId("v2-text").fill("아버지 59년생 어머니 63년생 두 분이 수원 영통에 사세요. 기초연금 받으시는지 모르겠어요");
    await page.getByTestId("v2-fill").click();
    await expect(page.getByTestId("v2-understood")).toContainText("수원", { timeout: 20_000 });
    await page.getByTestId("v2-submit").click();
    const btn = page.getByTestId("other-parent-btn");
    await expect(btn).toBeVisible({ timeout: 20_000 });
    const before = await page.getByTestId("v2-chips").innerText();
    await btn.click();
    await expect(page.getByTestId("v2-chips")).not.toHaveText(before);
  });

  test("N4: 실업급여 신청처는 고용센터, 수동 보강 출처·확인일 표시", async ({ page }) => {
    await page.goto("/p/n.welfare100-unemployment-benefit");
    await expect(page.locator("#sec-apply")).toContainText("고용센터", { timeout: 20_000 });
    await expect(page.getByTestId("apply-note")).toContainText("수동 보강");
    await expect(page.getByTestId("apply-note")).toContainText("2026-10-07");
  });

  test("N8·L3: 없는 서비스의 문서 제목, 머리글에 '로그인 준비 중' 없음", async ({ page }) => {
    const r = await page.goto("/p/n.does-not-exist");
    expect(r?.status()).toBe(404);
    await expect(page).toHaveTitle(/찾을 수 없는 페이지/);
    await expect(page.getByText("로그인 준비 중")).toHaveCount(0);
  });
});

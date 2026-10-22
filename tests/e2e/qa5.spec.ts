import { openPrefill } from "./helpers/prefill";
import { expect, test, type Page } from "@playwright/test";

/** QA 5차 수정 확인 (리뷰 보고서 항목 ID를 제목에 표기, 재현 문장 그대로, 390×844는 @mobile) */

async function fromHome(page: Page, sentence: string) {
  await openPrefill(page, sentence);
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
}
async function toResults(page: Page, sentence: string) {
  await fromHome(page, sentence);
  await page.getByTestId("prefill-confirm").click();
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("pick").first()).toBeVisible({ timeout: 20_000 });
}
const SPECIAL_YOUTH = /학교\s*밖|가정\s*밖|학업\s*중단|미취학|청소년동반자|청소년 상담|은둔/;

test.describe("QA 5차", () => {
  test("C3b·U1: '스물두살 대학생이에요 수원 살아요' → 하는 일 학생, 장학금 먼저, 학교 밖·가정 밖 사업 없음 @mobile", async ({ page }) => {
    await fromHome(page, "스물두살 대학생이에요 수원 살아요");
    await expect(page.getByTestId("prefill-banner")).toContainText("대학생");
    await page.getByTestId("prefill-confirm").click();
    const picks = page.getByTestId("top-picks");
    await expect(picks).toContainText("국가장학금", { timeout: 20_000 });
    await expect(page.getByTestId("pick")).toHaveCount(5);
    await expect(picks).not.toContainText(SPECIAL_YOUTH);
    await expect(picks).not.toContainText("청년도전지원");
  });

  test("U1: '이십대 중반 대학생이고 용인 살아요' → 장학금·학자금 5가지 @mobile", async ({ page }) => {
    await toResults(page, "이십대 중반 대학생이고 용인 살아요");
    const picks = page.getByTestId("top-picks");
    await expect(picks).toContainText("국가장학금");
    await expect(page.getByTestId("pick")).toHaveCount(5);
    await expect(picks).not.toContainText(SPECIAL_YOUTH);
    await expect(picks).not.toContainText("청년도전지원");
  });

  test("Q1: '화성 동탄 살아요 실직했어요' → 산림보호지원단 없음, 실업급여·국민취업지원제도 @mobile", async ({ page }) => {
    await toResults(page, "화성 동탄 살아요 실직했어요");
    const picks = page.getByTestId("top-picks");
    await expect(picks).toContainText("국민취업지원제도");
    await expect(picks).toContainText("실업급여");
    await expect(picks).not.toContainText(/산림|주차장|장애학생/);
  });

  test("Q1: '사십대 후반 가장이에요 화성' → 광업 종사 근로자 건강진단 없음 @mobile", async ({ page }) => {
    await toResults(page, "사십대 후반 가장이에요 화성");
    await expect(page.getByTestId("top-picks")).not.toContainText(/광업|교직원|도서민/);
  });

  test("L1: '신청할 때 확인' 배지 뒤 문장이 '신청할 때 확인:'으로 시작하지 않음 (P5a)", async ({ page }) => {
    await toResults(page, "고양시 사는 52살 엄마예요 지적장애 있는 딸이랑 셋이 살아요");
    const picks = page.getByTestId("top-picks");
    await expect(picks).toContainText("확인할 것:");
    await expect(picks).not.toContainText("신청할 때 확인:");
  });

  // (2026-10-20 디자인 개편) 머리 안내 줄(.util)과 홈 그림(hero-art)은 지도·나침반 머리글로 바뀌었다 — 같은 뜻을 새 화면에서 확인
  test("U2: 390px '글자 크게'에서 머리글이 한 줄, 화면 밖으로 넘치지 않음 @mobile", async ({ page }) => {
    await page.goto("/");
    const header = page.locator("header.site-header");
    await expect(header).toContainText("복지나침반");
    const h0 = (await header.boundingBox())!.height;
    await page.getByTestId("large-text").click();
    await expect(page.getByTestId("large-text")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("large-text")).toHaveText(/글자 크게/);
    await expect.poll(async () => (await header.boundingBox())!.height).toBeLessThan(h0 * 1.3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  test("H1: 홈 그림은 지도·나침반, 머리글에 나침반 상징", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("welfare-map")).toBeVisible();
    await expect(page.locator('header img.logo-symbol')).toHaveAttribute("src", /\/brand\/logo-symbol\.svg/);
    const ok = await page.evaluate(async () => (await fetch("/brand/logo-symbol.svg")).ok);
    expect(ok).toBe(true);
  });

  // 기존 사례의 '먼저 확인할 5가지'가 바뀌지 않았는지 (5차 수정 전 결과와 같은 항목)
  test("기존 사례 유지: 부모님 기초연금·임산부·군 제대·한부모·신혼부부 @mobile", async ({ page }) => {
    await toResults(page, "울엄마 칠순 넘으셨고 혼자 사심 화성");
    await expect(page.getByTestId("pick").first()).toContainText("기초연금");
    await toResults(page, "임산부인데 평택 살아요");
    await expect(page.getByTestId("top-picks")).toContainText("국민행복카드");
    await toResults(page, "스물일곱 군 제대한 청년이에요 김포");
    await expect(page.getByTestId("top-picks")).toContainText("국민취업지원제도");
    await toResults(page, "시흥에서 아이 둘 혼자 키우는 엄마예요 월 180 벌어요");
    await expect(page.getByTestId("pick").first()).toContainText("한부모가족 아동양육비");
    await toResults(page, "고양 일산 사는 신혼부부");
    const picks = page.getByTestId("top-picks");
    await expect(picks).toContainText("디딤돌");
    await expect(picks).toContainText("버팀목");
  });
});

import { openPrefill } from "./helpers/prefill";
import { expect, test, type Page } from "@playwright/test";

/** QA 4차 수정 확인 (리뷰 보고서 항목 ID를 제목에 표기, 재현 문장 그대로) */

async function fromHome(page: Page, sentence: string) {
  await openPrefill(page, sentence);
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
}
async function toResults(page: Page, sentence: string) {
  await fromHome(page, sentence);
  await page.getByTestId("prefill-confirm").click();
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
}

test.describe("QA 4차", () => {
  test("S1: '임산부인데 평택 살아요' → 먼저 확인할 5가지에 임신·출산 지원 @mobile", async ({ page }) => {
    await toResults(page, "임산부인데 평택 살아요");
    const picks = page.getByTestId("top-picks");
    await expect(picks).toContainText("국민행복카드", { timeout: 20_000 });
    await expect(picks).toContainText("산모");
    await expect(page.getByTestId("pick")).toHaveCount(5);
    await expect(picks).not.toContainText("부모급여");
  });

  test("S2: '임신 7개월이에요 평택' → 0~1세 자녀·가구원으로 세지 않음", async ({ page }) => {
    await fromHome(page, "임신 7개월이에요 평택");
    const banner = page.getByTestId("prefill-banner");
    await expect(banner).toContainText("임신 중");
    await expect(banner).not.toContainText("0~1세");
    await expect(banner).not.toContainText("7세");
  });

  test("R1: '이십대 중반 대학생이고 용인 살아요' → 조사 '중반은', 5가지가 채워짐 @mobile", async ({ page }) => {
    await fromHome(page, "이십대 중반 대학생이고 용인 살아요");
    await expect(page.getByTestId("prefill-banner")).not.toContainText("중반는");
    await page.getByTestId("prefill-confirm").click();
    await expect(page.getByTestId("pick")).toHaveCount(5, { timeout: 20_000 });
  });

  test("N3: '장인어른 모시고 삽니다 부천' → 부모님 기준으로 따로 찾기 안내 @mobile", async ({ page }) => {
    await toResults(page, "장인어른 모시고 삽니다 부천");
    await expect(page.getByTestId("eldercare-note")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("eldercare-parent-link")).toHaveAttribute("href", /for=parent/);
  });

  test("S4: '군 제대하고 취업 준비 중이에요 김포 스물일곱' → 청년 구직 지원, 성별 한정 사업 없음", async ({ page }) => {
    await fromHome(page, "군 제대하고 취업 준비 중이에요 김포 스물일곱");
    await expect(page.getByTestId("prefill-banner")).toContainText("군 제대");
    await page.getByTestId("prefill-confirm").click();
    const picks = page.getByTestId("top-picks");
    await expect(picks).toContainText("국민취업지원제도", { timeout: 20_000 });
    await expect(picks).not.toContainText("여성");
  });

  test("S7: '사십대 후반 가장이에요 화성' → 가구원 수에 '1명'을 고를 수 없음", async ({ page }) => {
    await fromHome(page, "사십대 후반 가장이에요 화성");
    await expect(page.getByTestId("prefill-banner")).toContainText("가장");
    const chips = page.getByTestId("prefill-hh").getByRole("button");
    await expect(chips).toHaveCount(5);
  });
});

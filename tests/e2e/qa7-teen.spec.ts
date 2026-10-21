import { openPrefill } from "./helpers/prefill";
import { expect, test, type Page } from "@playwright/test";

/** 6차 프로덕션 검증 후속 (claude-code-fixes) P3 신청 기한 줄 · T1 10대 본인 화면 */
async function toResults(page: Page, sentence: string) {
  await openPrefill(page, sentence);
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("prefill-confirm").click();
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("pick").first()).toBeVisible({ timeout: 20_000 });
}

test("T1: 학교 안 다니는 열여섯 — 보호자 포함 소득 질문, 자녀 질문·자녀 금액 예시·대학생 기한 없음, 준비물 한 장 안내 @mobile", async ({ page }) => {
  await toResults(page, "학교 안 다니는 열여섯살 안산");
  const sum = page.getByTestId("money-summary");
  await expect(sum).toBeVisible();
  await expect(sum).not.toContainText("자녀가 있나요");
  await expect(sum).not.toContainText(/부모급여|가정양육수당|기저귀/);
  await expect(sum).not.toContainText("대학생 청소년교육지원장학금");
  const next = sum.getByTestId("sum-next");
  if (await next.count()) await expect(next).toContainText("보호자");
  await page.getByTestId("sheet-open").click();
  await expect(page.getByTestId("vs-teen")).toContainText("부모님이나 선생님께");
});

test("P3: '장인어른 모시고 삽니다 부천' — 청소년자문단 기한 없음 @mobile", async ({ page }) => {
  await toResults(page, "장인어른 모시고 삽니다 부천");
  await expect(page.getByTestId("v2-results")).not.toContainText("청소년자문단 운영 지원 매년");
});

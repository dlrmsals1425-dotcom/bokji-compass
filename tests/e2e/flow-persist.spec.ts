/** (2026-10-23 외부 재점검 P3) 골라서·쉬운 찾기: 새로고침해도 진행 유지, 브라우저 뒤로가기는 질문 하나씩 (이 탭에만 저장) */
import { expect, test, type Page } from "@playwright/test";

async function toFirstQuestion(page: Page, path = "/ask") {
  await page.goto(path);
  await page.getByTestId("gq-parent").click();
  await expect(page.getByTestId("gq-loc-error")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("gq-sido").locator("option")).not.toHaveCount(1, { timeout: 20_000 });
  await page.getByTestId("gq-sido").selectOption("41000");
  await page.getByTestId("gq-sigungu").selectOption({ label: "수원시" });
  await page.getByTestId("gq-region-ok").click();
}

test("골라서 찾기: 질문 2에서 새로고침해도 질문 2, 고른 답도 그대로 @mobile", async ({ page }) => {
  await toFirstQuestion(page);
  await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
  await page.getByTestId("gq-a-70-79").click();
  await expect(page.getByText("질문 2 / 5")).toBeVisible({ timeout: 20_000 });
  const dim = await page.getByTestId("gq-question").getAttribute("data-dim");
  await page.reload();
  await expect(page.getByText("질문 2 / 5")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", dim!);
  // 이전으로 가면 첫 질문, 고른 답 표시
  await page.getByTestId("gq-back").click();
  await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age");
  await expect(page.getByTestId("gq-a-70-79")).toHaveAttribute("aria-pressed", "true");
});

test("골라서 찾기: 브라우저 뒤로가기는 질문 하나씩 → 지역 고르기 @mobile", async ({ page }) => {
  await toFirstQuestion(page);
  await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
  await page.getByTestId("gq-a-70-79").click();
  await expect(page.getByText("질문 2 / 5")).toBeVisible({ timeout: 20_000 });
  await page.goBack();
  await expect(page).toHaveURL(/\/ask$/);
  await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age");
  await expect(page.getByTestId("gq-a-70-79")).toHaveAttribute("aria-pressed", "true");
  await page.goBack();
  await expect(page).toHaveURL(/\/ask$/);
  await expect(page.getByTestId("gq-region-ok")).toBeVisible({ timeout: 20_000 });
});

test("쉬운 찾기: 새로고침해도 진행 유지 @mobile", async ({ page }) => {
  await toFirstQuestion(page, "/easy");
  const q = page.getByTestId("gq-question");
  await expect(q).toBeVisible({ timeout: 30_000 });
  const first = await q.getAttribute("data-dim");
  // 첫 질문이 끝날 때까지 '예'
  for (let i = 0; i < 8 && (await q.getAttribute("data-dim")) === first; i++) {
    await page.getByTestId("gq-yes").click();
    await page.waitForTimeout(300);
  }
  const dim = await q.getAttribute("data-dim");
  expect(dim).not.toBe(first);
  await page.reload();
  await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", dim!, { timeout: 30_000 });
});

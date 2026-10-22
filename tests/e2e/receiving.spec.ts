/** (2026-10-16 소유자) 이미 받고 있는 혜택(예: 보육료)은 표시하면 먼저 확인할 5가지·준비물 한 장에서 빠진다 */
import { expect, test } from "@playwright/test";

test("'이미 받고 있어요' → 5가지·준비물에서 빠지고 아래에 모임, 다시 열어도 유지, '다시 보이기'로 되돌림 @mobile", async ({ page }) => {
  await page.goto("/results?example=suwon-senior");
  const picks = page.getByTestId("top-picks");
  await expect(picks.getByTestId("pick")).toHaveCount(5, { timeout: 20_000 });
  const first = (await picks.getByTestId("pick").first().locator("h3").innerText()).trim();
  const firstCard = picks.getByTestId("pick").first();
  await expect(firstCard.locator(".v2-why")).toBeHidden();
  const more = firstCard.getByTestId("benefit-more").locator("summary");
  await more.focus();
  await more.press("Enter");
  await expect(firstCard.locator(".v2-why")).toBeVisible();
  await picks.getByTestId("pick").first().getByTestId("receiving-toggle").click();
  // 5가지는 다음 혜택으로 채워지고, 표시한 혜택은 없다
  await expect(picks.getByTestId("pick")).toHaveCount(5);
  await expect(picks.locator("h3", { hasText: first })).toHaveCount(0);
  const recv = page.getByTestId("receiving-section");
  await expect(recv).toContainText(first);
  await expect(page.getByTestId("sheet-cta")).toContainText("담은 혜택 5개");
  // 기기에만 저장 (주소에는 없음)
  expect(page.url()).not.toMatch(/receiv|받고/);
  expect(await page.evaluate(() => localStorage.getItem("bn.receiving.v1"))).toContain("self");
  // 준비물 한 장에도 없음
  await page.getByTestId("sheet-open").click();
  await expect(page.getByTestId("vs-place").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("visit-sheet").locator("strong", { hasText: first })).toHaveCount(0);
  // 다시 열어도 유지, '다시 보이기'로 되돌림
  await page.reload();
  await expect(page.getByTestId("receiving-section")).toContainText(first, { timeout: 20_000 });
  await page.getByTestId("receiving-undo").first().click();
  // 직접 표시한 것만 되돌아감 (답한 상황 '기초연금 받음'으로 빠진 기초연금은 그대로)
  await expect(page.getByTestId("receiving-undo")).toHaveCount(0);
  await expect(page.getByTestId("receiving-section")).not.toContainText(first);
  await expect(page.getByTestId("top-picks").locator("h3", { hasText: first })).toHaveCount(1);
});

test("목록 카드에서도 표시할 수 있다", async ({ page }) => {
  await page.goto("/results?example=suwon-senior");
  const card = page.locator("#v2-fit [data-testid=v2-card]").first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  const name = (await card.locator("h3").innerText()).trim();
  await card.getByTestId("benefit-more").locator("summary").click();
  await card.getByTestId("receiving-toggle").click();
  await expect(page.locator("#v2-fit h3", { hasText: name })).toHaveCount(0);
  await expect(page.getByTestId("receiving-section")).toContainText(name);
});

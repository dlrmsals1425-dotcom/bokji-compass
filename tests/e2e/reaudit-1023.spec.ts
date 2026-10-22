/** (2026-10-23 외부 재점검) 담기·빼기 위치 · 상세 화면 담기 · 검색 카드 읽기 구분 · 이전 답 표시 */
import { expect, test } from "@playwright/test";

test("결과: '빼기'는 '조건·신청 정보'를 펼치지 않아도 보임 @mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preset-suwon-senior").click();
  const first = page.getByTestId("top-picks").getByTestId("pick").first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  await expect(first.getByTestId("benefit-more")).not.toHaveAttribute("open", "");
  await expect(first.getByTestId("sheet-toggle")).toBeVisible();
  await expect(first.getByTestId("sheet-toggle")).toHaveText("빼기");
});

test("상세 화면에서도 신청 서류 모음에 담기·빼기 — 결과 화면과 같은 상태 @mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preset-suwon-senior").click();
  const picks = page.getByTestId("top-picks");
  await expect(picks.getByTestId("pick").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/담은 혜택 5개/)).toBeVisible();
  await picks.getByTestId("pick").first().locator("h3 a").click();
  const toggle = page.getByTestId("detail-sheet-toggle").first();
  await expect(toggle).toHaveText("빼기", { timeout: 20_000 });
  await toggle.click();
  await expect(toggle).toHaveText(/신청 서류 모음에 담기/);
  await page.goBack();
  await expect(page.getByText(/담은 혜택 4개/)).toBeVisible({ timeout: 20_000 });
});

test("검색 카드: 판정 배지와 사유, 기관·분야 칸이 글자로도 나뉨 (읽기 프로그램)", async ({ page }) => {
  await page.goto("/search?q=" + encodeURIComponent("국가건강검진"));
  const card = page.getByTestId("program-card").first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  const meta = (await card.locator(".meta").textContent()) ?? "";
  expect(meta).toMatch(/\S, \S/);
});

test("골라서 찾기: '이전'으로 돌아가면 고른 답이 표시됨 @mobile", async ({ page }) => {
  await page.goto("/ask");
  await page.getByTestId("gq-parent").click();
  await expect(page.getByTestId("gq-loc-error")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("gq-sido").locator("option")).not.toHaveCount(1, { timeout: 20_000 });
  await page.getByTestId("gq-sido").selectOption("41000");
  await page.getByTestId("gq-sigungu").selectOption({ label: "수원시" });
  await page.getByTestId("gq-region-ok").click();
  await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
  await expect(page.getByTestId("gq-a-70-79")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("gq-a-70-79").click();
  await expect(page.getByText("질문 2 / 5")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("gq-back").click();
  await expect(page.getByTestId("gq-a-70-79")).toHaveAttribute("aria-pressed", "true");
});

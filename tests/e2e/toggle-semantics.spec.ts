/**
 * (2026-10-22 팀 피드백 → 전체 점검) 상태와 누를 동작이 뒤바뀌어 읽히는 단추가 없게.
 * 원칙: 켜고 끄는 단추(aria-pressed)는 이름이 늘 같고 상태는 눌림 표시로 / 동작 단추는 글자가 '누르면 일어날 일'이고 aria-pressed 없음.
 */
import { expect, test, type Page } from "@playwright/test";
import { openPrefill } from "./helpers/prefill";

/** 눌림 상태 단추의 이름에 '반대 동작' 말이 있으면 결함 (예: 켜진 채 '글자 보통', 담긴 채 '빼기') */
const UNDO_WORDS = /보통|해제|빼기|되돌리기|접기|취소|끄기/;
async function scanPressed(page: Page, where: string) {
  const bad = await page.locator("button[aria-pressed]").evaluateAll((els, re) => {
    const rx = new RegExp(re);
    return els.map((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").trim()).filter((n) => rx.test(n));
  }, UNDO_WORDS.source);
  expect(bad, `${where}: 눌림 상태 단추 이름에 반대 동작 말`).toEqual([]);
}

test("주요 화면의 켜고 끄는 단추 이름에 반대 동작 말이 없다 @mobile", async ({ page }) => {
  await page.goto("/");
  await scanPressed(page, "홈");
  await page.getByTestId("large-text").click();
  await scanPressed(page, "홈(글자 크게 켬)");
  await page.getByText("가상 예시 보기", { exact: true }).click();
  await page.getByTestId("preset-suwon-senior").click();
  await expect(page.getByTestId("top-picks")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("pick").first().getByTestId("benefit-more").locator(":scope > summary").click();
  await scanPressed(page, "결과");
  await page.goto("/situation?for=self&details=1");
  await expect(page.locator("#sido option")).not.toHaveCount(1, { timeout: 20_000 });
  await scanPressed(page, "한 화면 입력");
  await page.goto("/kiosk");
  await scanPressed(page, "키오스크 설정");
});

test("글자 크게: 이름은 늘 '글자 크게', 켜면 눌림(✓), 다시 누르면 꺼짐 @mobile", async ({ page }) => {
  await page.goto("/");
  const b = page.getByTestId("large-text");
  await expect(b).toHaveText(/^\s*글자 크게\s*$/);
  await expect(b).toHaveAttribute("aria-pressed", "false");
  await b.click();
  await expect(b).toHaveAttribute("aria-pressed", "true");
  await expect(b).toHaveText(/글자 크게/);
  await expect(page.locator("html")).toHaveAttribute("data-large", "1");
  await b.click();
  await expect(b).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("html")).not.toHaveAttribute("data-large", "1");
});

test("결과 카드: 서류 모음 '빼기'·'이미 받고 있어요'는 동작 단추 (눌림 상태·체크 표시 없음) @mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByText("가상 예시 보기", { exact: true }).click();
  await page.getByTestId("preset-suwon-senior").click();
  const first = page.getByTestId("pick").first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  await first.getByTestId("benefit-more").locator(":scope > summary").click();
  await expect(first.getByTestId("sheet-toggle")).not.toHaveAttribute("aria-pressed", /.*/);
  const recv = first.getByTestId("receiving-toggle");
  await expect(recv).toHaveText("이미 받고 있어요");
  await expect(recv.locator("svg")).toHaveCount(0);
});

test("말로 찾기 해석 확인: 가구 단추는 '…으로 바꾸기' ↔ '…으로 되돌리기', 지금 값은 굵은 글씨 @mobile", async ({ page }) => {
  await openPrefill(page, "용인시에 사는 86년생이야, 자녀는 2명이 있어. 월급은 세후 400정도되");
  const hh = page.getByTestId("prefill-household");
  await expect(hh).toBeVisible({ timeout: 20_000 });
  const alt = page.getByTestId("prefill-hh-alt");
  await expect(alt).not.toHaveAttribute("aria-pressed", /.*/);
  await expect(alt).toHaveText("배우자 없이 3명으로 바꾸기");
  await expect(hh.locator("strong")).toContainText("4명");
  await alt.click();
  await expect(hh.locator("strong")).toContainText("3명");
  await expect(alt).toHaveText("배우자 포함 4명으로 되돌리기");
});

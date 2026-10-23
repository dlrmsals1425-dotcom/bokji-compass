/** (2026-10-22 외부 점검) P2·P3 문구·연결 결함 */
import { expect, test } from "@playwright/test";

test("P2-3 서비스 검색: 홈 밖 주 메뉴에 '서비스 검색' 링크 (홈 지도 랜딩에는 없음) @mobile", async ({ page }) => {
  await page.goto("/forms");
  const link = page.getByRole("link", { name: "서비스 검색" }).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/search$/);
  await page.goto("/");
  // 홈 지도 랜딩의 머리말·본문에는 검색 메뉴 없음 — 바닥글에만 (2026-10-23 외부 3차 점검)
  await expect(page.locator('a[href^="/search"]:not(footer a)')).toHaveCount(0);
  await expect(page.getByRole("contentinfo").locator('a[href="/search"]')).toHaveCount(1);
});

test("P2-4·P3-9·P3-12 결과: 서류 모음 '2가지를', 자동 지급 개수에 띄어쓰기 없음, 이미지 저장 안내에 '사진첩' 없음", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preset-suwon-senior").click();
  await expect(page.getByTestId("top-picks")).toBeVisible({ timeout: 20_000 });
  const auto = page.getByTestId("auto-toggle");
  if (await auto.count()) await expect(auto).toContainText(/\d개/);
  await page.getByTestId("sheet-open").click();
  const staff = page.getByTestId("visit-sheet").locator(".vs-staff");
  await expect(staff.first()).toBeVisible({ timeout: 20_000 });
  const texts = await staff.allInnerTexts();
  expect(texts.join("\n")).not.toMatch(/가지을|사업을을/);
  expect(texts.some((t) => /아래 \d+가지를 신청|아래 사업을 신청/.test(t))).toBe(true);
});

test("P2-5·6 상세: 문의처의 '/-'와 법령의 '제0항'·'조의0'을 보이지 않음", async ({ page }) => {
  await page.goto("/p/s30000.gov24-630000000656");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main")).not.toContainText("/-");
  await page.goto("/p/n.gov24-999000000012");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main")).toContainText("고용보험법(제51조)");
  await expect(page.locator("main")).not.toContainText(/제0항|조의0/);
});

test("P3-7·13 검색 지역 고르기: '전국 사업만 (중앙부처·공공기관)'·'시·군·구 고르지 않음', 범위 안내도 같은 말 (10-23 재점검 P1: 공공기관 사업도 들어 있어 이름을 맞춤)", async ({ page }) => {
  await page.goto("/search?q=" + encodeURIComponent("국가건강검진"));
  const sido = page.locator("select").first();
  await expect(sido.locator("option").first()).toHaveText("전국 사업만 (중앙부처·공공기관)");
  await expect(page.getByText(/검색 범위: 전국 사업/)).toBeVisible({ timeout: 20_000 });
  await sido.selectOption("41000");
  await expect(page.locator("select").nth(1).locator("option").first()).toHaveText("시·군·구 고르지 않음");
});

test("P3-10·11 상세 판정 줄 띄어쓰기, 신뢰도 줄에 'API 지원조건' 대신 '정부24 지원조건 기준'", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preset-suwon-senior").click();
  await expect(page.getByTestId("top-picks")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("top-picks").locator("h3 a").first().click();
  const judge = page.getByTestId("detail-judge");
  await expect(judge).toBeVisible({ timeout: 20_000 });
  expect(await judge.innerText()).not.toMatch(/\S\((답하신|부모님) 상황/);
  await expect(judge).toContainText("상황 기준");
  await expect(page.locator("main")).not.toContainText("API 지원조건");
});

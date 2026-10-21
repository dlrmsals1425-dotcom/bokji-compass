/** (2026-10-16 회의) 주민센터 태블릿 키오스크 모드: 지역 고정, 터치만, 손대지 않으면 지우고 처음으로 */
import { expect, test } from "@playwright/test";

test.use({ permissions: [] });

test("키오스크 켜기 → 질문 따라 찾기, 지역은 고정(위치 안 물음), 메뉴 숨김, 큰 글씨 @mobile", async ({ page }) => {
  await page.goto("/kiosk");
  await expect(page.getByTestId("kiosk-sido").locator("option")).not.toHaveCount(1, { timeout: 20_000 });
  await page.getByTestId("kiosk-sido").selectOption("41000");
  await page.getByTestId("kiosk-sigungu").selectOption({ label: "수원시" });
  await page.getByTestId("kiosk-start").click();
  await expect(page).toHaveURL(/\/ask$/);
  await expect(page.locator("html")).toHaveAttribute("data-kiosk", "1");
  await expect(page.locator("html")).toHaveAttribute("data-large", "1");
  await expect(page.locator(".header-nav")).toBeHidden();
  await expect(page.locator(".site-footer")).toBeHidden();

  await page.getByTestId("gq-self").click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("경기 수원시여기 맞나요?");
  await page.getByTestId("gq-here").click();
  await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age", { timeout: 30_000 });

  // 홈으로 가도 키오스크 첫 화면(질문 따라 찾기)
  await page.goto("/");
  await expect(page).toHaveURL(/\/ask$/);

  // 다시 켜 둔 기기: 설정 화면에서 끄기
  await page.goto("/kiosk");
  await page.getByTestId("kiosk-stop").click();
  await expect(page.locator("html")).not.toHaveAttribute("data-kiosk", "1");
});

test("손대지 않으면 안내 후 답을 지우고 처음으로, '계속하기'를 누르면 그대로", async ({ page }) => {
  await page.clock.install();
  await page.goto("/kiosk");
  await expect(page.getByTestId("kiosk-sido").locator("option")).not.toHaveCount(1, { timeout: 20_000 });
  await page.getByTestId("kiosk-sido").selectOption("41000");
  await page.getByTestId("kiosk-sigungu").selectOption({ label: "수원시" });
  await page.getByTestId("kiosk-start").click();
  await expect(page).toHaveURL(/\/ask$/);
  await page.getByTestId("gq-self").click();
  await page.getByTestId("gq-here").click();
  await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age", { timeout: 30_000 });

  await page.clock.fastForward("02:05");
  const warn = page.getByTestId("kiosk-idle");
  await expect(warn).toBeVisible();
  await page.getByTestId("kiosk-continue").click();
  await expect(warn).toBeHidden();
  await expect(page.getByTestId("gq-question")).toBeVisible();

  await page.clock.fastForward("02:05");
  await expect(warn).toBeVisible();
  await page.clock.runFor(25_000);
  await expect(page.getByTestId("guided")).toHaveAttribute("data-phase", "who", { timeout: 10_000 });
  // 기기에 남은 답이 없다
  const left = await page.evaluate(() => [localStorage.getItem("bn.profile.v1"), sessionStorage.getItem("bn.profile.v1"), sessionStorage.getItem("bn.facts.v1")]);
  expect(left).toEqual([null, null, null]);
});

test("'처음으로' 단추는 답을 지우고 처음 화면", async ({ page }) => {
  await page.goto("/kiosk");
  await expect(page.getByTestId("kiosk-sido").locator("option")).not.toHaveCount(1, { timeout: 20_000 });
  await page.getByTestId("kiosk-sido").selectOption("41000");
  await page.getByTestId("kiosk-sigungu").selectOption({ label: "수원시" });
  await page.getByTestId("kiosk-start").click();
  await page.getByTestId("gq-self").click();
  await page.getByTestId("gq-here").click();
  await expect(page.getByTestId("gq-question")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("kiosk-reset").click();
  await expect(page.getByTestId("guided")).toHaveAttribute("data-phase", "who", { timeout: 10_000 });
});

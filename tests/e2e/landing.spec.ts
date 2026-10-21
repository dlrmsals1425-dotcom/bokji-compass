import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openPrefill } from "./helpers/prefill";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __landingGps: 0 });
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition(_ok: unknown, fail: (error: object) => void) {
        (window as unknown as { __landingGps: number }).__landingGps++;
        fail({ code: 1 });
      } },
    });
  });
  await page.route("**/api/voice/**", route => route.fulfill({ json: { available: true } }));
});

test("지도 랜딩: 유한 모션·검색 메뉴 제거·GPS 공유·두 입력 진입 @mobile", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("내게 맞는 복지,여기서 찾으세요.");
  await expect(page.getByRole("search")).toHaveCount(0);
  await expect(page.locator('a[href^="/search"]')).toHaveCount(0);
  await expect(page.getByTestId("start-guided")).toBeVisible();
  await expect(page.getByTestId("start-talk")).toBeVisible();
  const guidedBox = await page.getByTestId("start-guided").boundingBox();
  const talkBox = await page.getByTestId("start-talk").boundingBox();
  expect(guidedBox!.height).toBeGreaterThanOrEqual(110);
  expect(talkBox!.height).toBeGreaterThanOrEqual(110);
  expect(guidedBox!.width).toBeGreaterThanOrEqual(140);
  expect(Math.abs(guidedBox!.width - talkBox!.width)).toBeLessThan(1);
  const animations = () => page.evaluate(() => document.getAnimations().filter(a => a.playState === "running" || a.pending).length);
  expect(await page.evaluate(() => document.getAnimations().every(a => a.effect?.getTiming().iterations !== Infinity))).toBe(true);
  await expect.poll(animations, { timeout: 8_000 }).toBe(0);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
  await page.screenshot({ path: `logs/landing-${info.project.name}.png`, fullPage: true });
  await page.getByTestId("start-guided").click();
  await expect(page).toHaveURL(/\/ask$/);
  await expect(page.getByTestId("gq-parent")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __landingGps: number }).__landingGps)).toBe(1);
  await page.getByRole("link", { name: "복지나침반 홈" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByTestId("start-talk").click();
  await expect(page).toHaveURL(/\/situation$/);
  await expect(page.getByTestId("live-start")).toBeVisible();
});

test("모션 감소·320px 큰 글자에서도 바로 시작 가능 @mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.addInitScript(() => localStorage.setItem("bn.settings.v1", JSON.stringify({ large: true })));
  await page.goto("/");
  await expect(page.getByTestId("welfare-map")).toBeVisible();
  await expect(page.getByTestId("large-text")).toHaveText("글자 보통");
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  for (const id of ["start-guided", "start-talk"]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  await page.getByTestId("start-guided").click();
  await expect(page.getByTestId("gq-parent")).toBeVisible();
});

test("기존 해석 확인 검사는 홈 검색창 없이 진입 데이터를 사용", async ({ page }) => {
  await openPrefill(page, "수원에 사시는 75세 어머니 혼자 살아요");
  await expect(page.getByTestId("prefill-banner")).toBeVisible();
  await expect(page.getByTestId("prefill-line")).toContainText("수원");
  await expect(page).toHaveURL(/for=parent&prefill=1/);
});

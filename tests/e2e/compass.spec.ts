import { expect, test, type Locator } from "@playwright/test";

const heading = (needle: Locator) => needle.evaluate(element => {
  const matrix = new DOMMatrix(getComputedStyle(element).transform);
  return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition(_ok: unknown, fail: (error: object) => void) { fail({ code: 1 }); } },
    });
  });
});

test("첫 회전 후 커서 추적·짧은 방향 전환·정지·화면 이탈", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const needle = page.getByTestId("compass-needle");
  await expect(needle).toHaveAttribute("data-motion", "intro");
  const box = await needle.locator("..").boundingBox();
  expect(box).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x + 120, y);
  await expect(needle).toHaveAttribute("data-motion", "intro");
  expect(await needle.evaluate(element => (element as SVGGElement).style.transform)).toBe("");
  await expect(needle).toHaveAttribute("data-motion", "idle", { timeout: 8_000 });
  expect(await heading(needle)).toBeCloseTo(90, 1);

  // 180도 경계에서 반대 방향으로 한 바퀴 돌지 않고 가까운 쪽으로 넘어간다.
  await page.mouse.move(x + 2, y + 120);
  await expect.poll(() => heading(needle)).toBeGreaterThan(175);
  await expect(needle).toHaveAttribute("data-motion", "idle");
  await page.mouse.move(x - 2, y + 120);
  const samples = await needle.evaluate(async element => {
    const values: number[] = [];
    for (let i = 0; i < 30; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const matrix = new DOMMatrix(getComputedStyle(element).transform);
      values.push(Math.atan2(matrix.b, matrix.a) * 180 / Math.PI);
    }
    return values;
  });
  expect(samples.every(value => Math.abs(value) > 170)).toBe(true);
  await expect(needle).toHaveAttribute("data-motion", "idle");
  expect(await heading(needle)).toBeLessThan(-175);

  // 멈춘 커서 주위에서 무한 떨림이나 DOM 갱신을 계속하지 않는다.
  const changes = await needle.evaluate(async element => {
    let count = 0;
    const observer = new MutationObserver(records => { count += records.length; });
    observer.observe(element, { attributes: true });
    await new Promise(resolve => setTimeout(resolve, 300));
    observer.disconnect();
    return count;
  });
  expect(changes).toBe(0);
  await page.mouse.move(x - 120, y);
  await expect(needle).toHaveAttribute("data-motion", "tracking");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(needle).toHaveAttribute("data-motion", "idle");

  await page.mouse.move(x + 120, y - 60);
  await expect(needle).toHaveAttribute("data-motion", "idle");
  await page.screenshot({ path: "logs/compass-cursor.png", fullPage: true });
  await page.getByTestId("start-talk").click();
  await expect(page).toHaveURL(/\/situation$/);
  await expect(needle).toHaveCount(0);
  await expect(page.getByTestId("live-start")).toBeVisible();
});

test("모션 감소 설정은 커서 반응도 끄고 다시 켜도 도입을 반복하지 않는다 @mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const needle = page.getByTestId("compass-needle");
  await expect(needle).toHaveAttribute("data-motion", "idle");
  await page.mouse.move(100, 100);
  expect(await heading(needle)).toBeCloseTo(-47, 1);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.mouse.move(110, 100);
  await expect(needle).toHaveAttribute("data-motion", "idle");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => heading(needle)).toBeCloseTo(-47, 1);
  await expect(needle).toHaveAttribute("data-motion", "idle");
});

test("터치 입력은 도입 이후 바늘을 움직이지 않는다 @mobile", async ({ page, isMobile }) => {
  test.skip(!isMobile, "터치 기기에서 확인");
  await page.goto("/");
  const needle = page.getByTestId("compass-needle");
  await expect(needle).toHaveAttribute("data-motion", "idle", { timeout: 8_000 });
  await page.getByTestId("welfare-map").tap();
  expect(await heading(needle)).toBeCloseTo(-47, 1);
  await expect(needle).toHaveAttribute("data-motion", "idle");
});

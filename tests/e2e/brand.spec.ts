import { expect, test } from "@playwright/test";

/** 머리글과 같은 초록 나침반을 탭·앱·공유 이미지에도 사용한다. */
const ASSETS: [string, RegExp][] = [
  ["/favicon.ico", /image\/(x-icon|vnd\.microsoft\.icon)/],
  ["/icon.svg", /image\/svg\+xml/],
  ["/apple-icon.png", /image\/png/],
  ["/manifest.webmanifest", /application\/manifest\+json/],
  ["/og.png", /image\/png/],
  ["/icons/icon-192.png", /image\/png/],
  ["/icons/icon-512.png", /image\/png/],
  ["/icons/icon-maskable-512.png", /image\/png/],
  ["/brand/app-icon-b.svg", /image\/svg\+xml/],
  ["/brand/logo-symbol.svg", /image\/svg\+xml/],
];

test.describe("브랜드", () => {
  test("아이콘·매니페스트·공유 이미지가 올바른 형식으로 제공됨", async ({ request }) => {
    for (const [path, type] of ASSETS) {
      const r = await request.get(path);
      expect(r.status(), path).toBe(200);
      expect(r.headers()["content-type"], path).toMatch(type);
    }
    const m = await (await request.get("/manifest.webmanifest")).json();
    expect(m.theme_color).toBe("#fbfcf8");
    expect(m.background_color).toBe("#fbfcf8");
    expect(m.icons.map((i: { src: string }) => i.src)).toEqual(["/icons/icon-192.png?v=compass-1", "/icons/icon-512.png?v=compass-1", "/icons/icon-maskable-512.png?v=compass-1"]);
    expect(m.icons[2].purpose).toBe("maskable");
    for (const { src } of m.icons) expect((await request.get(src)).status()).toBe(200);
    const svg = await (await request.get("/icon.svg")).text();
    expect(svg).toContain("#1b3b28");
    expect(svg).not.toContain("#1D4ED8");
  });

  test("머리글 로고: 이름 '복지나침반', 홈 링크, 아이콘·테마 색 태그, '글자 크게'에서 함께 커짐 @mobile", async ({ page }) => {
    await page.goto("/");
    const logo = page.locator("header.site-header a.logo img");
    await expect(logo).toHaveAttribute("alt", "");
    await expect(logo).toHaveAttribute("aria-hidden", "true");
    await expect(logo).toHaveAttribute("src", "/brand/logo-symbol.svg?v=compass-1");
    await expect(page.locator("header.site-header a.logo")).toHaveAttribute("href", "/");
    await expect(page.getByRole("link", { name: "복지나침반 홈" })).toBeVisible();
    expect(await logo.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#fbfcf8");
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
    await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    const h0 = (await logo.boundingBox())!.height;
    expect(Math.round(h0)).toBe(27);
    await page.getByTestId("large-text").click();
    await expect.poll(async () => Math.round((await logo.boundingBox())!.height)).toBe(34);
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "신청 서식" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/icons\/icon-512\.png\?v=compass-1$/);
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", /\/icons\/icon-512\.png\?v=compass-1$/);
    await expect(page.locator("footer")).toContainText("복지나침반");
  });
});

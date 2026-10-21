import { openPrefill } from "./helpers/prefill";
import { expect, test, type Page } from "@playwright/test";

/** 6차 프로덕션 검증 후속 (claude-code-fixes) V2 준비물 한 장 진입점 · V3 인쇄하면 실제 A4 1쪽 → (2026-10-16) 곳마다 A4 1쪽 */

const PRESETS = ["suwon-senior", "parent-care", "seongnam-single-parent", "goyang-youth", "bucheon-disability"];
const SENTENCES = ["임신 5개월이에요 성남", "고등학교 자퇴한 열일곱살이에요 수원", "일흔둘 혼자 사시는 아버지 부천", "시흥 한부모 아이 둘", "용인 사는 8개월 아기 엄마예요"];

async function open(page: Page, target: string) {
  if (PRESETS.includes(target)) await page.goto(`/results?example=${target}`);
  else {
    await openPrefill(page, target);
    await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("prefill-confirm").click();
  }
  await expect(page.getByTestId("pick").first()).toBeVisible({ timeout: 20_000 });
}

test("V2: 한눈에 보기 바로 아래에서 준비물 한 장을 열 수 있음 (결과 첫 두 화면 안) @mobile", async ({ page }) => {
  await open(page, "suwon-senior");
  const btn = page.getByTestId("sum-sheet-open");
  await expect(btn).toBeVisible();
  const box = await btn.boundingBox();
  const vh = page.viewportSize()!.height;
  expect(box!.y).toBeLessThan(vh * 2);
  await btn.click();
  await expect(page.getByTestId("visit-sheet")).toBeVisible();
  await expect(page.getByTestId("vs-place").first()).toBeVisible({ timeout: 20_000 });
});

for (const target of [...PRESETS, ...SENTENCES]) {
  test(`V3: '${target}' 준비물을 모두 인쇄하면 신청하러 갈 곳마다 A4 1쪽`, async ({ page, browserName }, info) => {
    test.skip(info.project.name !== "desktop-chromium" || browserName !== "chromium", "PDF는 데스크톱 Chromium에서만");
    await page.addInitScript(() => {
      window.print = () => {};
    });
    await open(page, target);
    await page.getByTestId("sheet-open").click();
    await expect(page.getByTestId("vs-place").first()).toBeVisible({ timeout: 20_000 });
    const places = await page.getByTestId("vs-place").count();
    await page.getByTestId("vs-print").click();
    await expect(page.locator("html")).toHaveAttribute("data-print", "sheet");
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({ format: "A4" });
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    expect(pages).toBe(places);
  });
}

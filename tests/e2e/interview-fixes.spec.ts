/** (2026-10-21 사용자 인터뷰) 판정 태그 색 구분 · '신청 서류 모음' 이름과 설명 · 재산을 묻지 않았다는 안내 */
import { expect, test } from "@playwright/test";

const luminance = (rgb: string) => {
  const [r, g, b] = rgb.match(/\d+/g)!.slice(0, 3).map((n) => {
    const c = Number(n) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

test("결과: '받으실 수 있어요'는 진한 채움, 다른 단계와 바탕색이 확실히 다름 @mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByText("가상 예시 보기", { exact: true }).click();
  await page.getByTestId("preset-suwon-senior").click();
  await expect(page.getByTestId("top-picks")).toBeVisible({ timeout: 20_000 });
  const fit = page.locator(".v2-badge.b-fit").first();
  await expect(fit).toBeVisible();
  const fitStyle = await fit.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color }));
  // 글자 대비 4.5:1 이상 (WCAG AA)
  expect(contrast(fitStyle.bg, fitStyle.fg)).toBeGreaterThanOrEqual(4.5);
  // 다른 단계 태그(흰 바탕·옅은 바탕)와 바탕 대비가 3:1 이상 — 색 차이가 눈에 띄게
  for (const b of ["ask", "office", "no"]) {
    const other = page.locator(`.v2-badge.b-${b}`).first();
    if (!(await other.count())) continue;
    const bg = await other.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(contrast(fitStyle.bg, bg), b).toBeGreaterThanOrEqual(3);
  }
  // 재산은 묻지 않았다는 안내
  await expect(page.getByTestId("property-note")).toContainText("재산");
  // 신청 서류 모음: 무엇인지 한 줄 설명
  await expect(page.getByTestId("sheet-cta")).toContainText("신청 서류 모음");
  await expect(page.getByTestId("sheet-explain")).toContainText("가져갈 서류");
  await expect(page.getByTestId("sheet-open")).toHaveText(/신청 서류 모음 보기/);
});

test("(2026-10-22 팀 피드백) 서류 모음: 담겨 있으면 '서류 모음에 있음 · 빼기', 빼면 '서류 모음에 담기' @mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByText("가상 예시 보기", { exact: true }).click();
  await page.getByTestId("preset-suwon-senior").click();
  const first = page.getByTestId("pick").first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  await first.getByTestId("benefit-more").locator(":scope > summary").click();
  const state = first.getByTestId("sheet-state");
  await expect(state).toHaveAttribute("data-on", "1");
  await expect(state).toContainText("서류 모음에 있음");
  await expect(first.getByTestId("sheet-toggle")).toHaveText("빼기");
  await expect(first.getByTestId("sheet-toggle")).toHaveAccessibleName(/신청 서류 모음에서 빼기$/);
  await first.getByTestId("sheet-toggle").click();
  await expect(state).toHaveAttribute("data-on", "0");
  await expect(state).not.toContainText("서류 모음에 있음");
  await expect(first.getByTestId("sheet-toggle")).toHaveText(/서류 모음에 담기/);
  await expect(page.getByTestId("sheet-explain")).toContainText("미리 담아 두었고");
});

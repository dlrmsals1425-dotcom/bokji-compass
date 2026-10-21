import { openPrefill } from "./helpers/prefill";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** 기능: 결과 맨 위 '한눈에 보기'(금액·기한 요약) · '방문처별 준비물 한 장'(인쇄·이미지·보내기) */

async function toResults(page: Page, sentence: string) {
  await openPrefill(page, sentence);
  await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("prefill-confirm").click();
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("pick").first()).toBeVisible({ timeout: 20_000 });
}
async function openSheet(page: Page) {
  await page.getByTestId("sheet-open").click();
  const sheet = page.getByTestId("visit-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByTestId("vs-place").first()).toBeVisible({ timeout: 20_000 });
  return sheet;
}
const BABY = "용인 사는 8개월 아기 엄마예요";
const DAD = "일흔둘 혼자 사시는 아버지 부천";

test.describe("한눈에 보기 (금액·기한)", () => {
  test("받으실 수 있어요 N개 + 원문 금액(최대, 더하지 않음) + 기한, 주소에 상황 없음 @mobile", async ({ page }) => {
    await toResults(page, BABY);
    const sum = page.getByTestId("money-summary");
    await expect(sum).toBeVisible();
    await expect(sum.getByTestId("sum-fit")).toContainText(/받으실 수 있어요 \d+개/);
    await expect(sum.getByTestId("sum-fit")).toContainText("부모급여");
    await expect(sum.getByTestId("sum-fit")).toContainText("월 최대 100만원");
    await expect(sum).toContainText("실제 금액과 중복 수급 여부는 조건에 따라 달라요");
    await expect(sum).not.toContainText(/합계|총\s*\d/);
    await expect(sum.getByTestId("sum-due")).toContainText("출생 후 1년 이내");
    expect(page.url()).not.toMatch(/용인|%EC%9A%A9|8개월|엄마|age|income/);
  });

  test("한 가지만 더 답하시면 N개가 정해져요 → 그 자리에서 소득을 답하면 결과가 바뀜", async ({ page }) => {
    await toResults(page, DAD);
    const next = page.getByTestId("sum-next");
    await expect(next).toContainText(/추가 확인 \d+개/);
    await expect(next).toContainText("소득");
    // 생계급여·긴급복지는 원문이 가구원 수별 표라 큰 가구 금액 대신 '가구원 수에 따라 달라요' (QA 7차 M2)
    await expect(next.getByTestId("sum-next-money")).toContainText(/최대|가구원 수에 따라 달라요/);
    await expect(next.getByTestId("sum-next-money")).not.toContainText("241만 8,150원");
    const before = await page.getByTestId("sum-fit").innerText();
    await next.getByTestId("sum-a-income-input").fill("80");
    await next.getByTestId("sum-a-income-ok").click();
    await expect(page.getByTestId("sum-fit")).not.toHaveText(before, { timeout: 10_000 });
    expect(page.url()).not.toMatch(/80|income|소득/);
  });
});

test.describe("방문처별 준비물 한 장", () => {
  test("신청하는 곳별로 묶고, 가져갈 것은 한 번씩, 서류가 없으면 '창구에 문의', 지역만 표시 @mobile", async ({ page }) => {
    await toResults(page, DAD);
    await expect(page.getByTestId("sheet-cta")).toContainText("담은 혜택 5개");
    const sheet = await openSheet(page);
    const places = sheet.getByTestId("vs-place");
    expect(await places.count()).toBeGreaterThanOrEqual(2);
    await expect(sheet).toContainText("주소지 행정복지센터(주민센터)");
    await expect(sheet).toContainText("가까운 보건소");
    const health = places.filter({ hasText: "가까운 보건소" });
    await expect(health.getByTestId("vs-bring")).toContainText("신분증 (모두)");
    await expect(health.getByTestId("vs-bring").locator("li", { hasText: "신분증" })).toHaveCount(1);
    // 원문에 서류가 없으면 '가기 전에 전화로 물어볼 것' (QA 7차 V1 표시)
    await expect(sheet.getByTestId("vs-ask").first()).toContainText("전화로 물어볼 것");
    await expect(sheet.getByTestId("vs-phones").locator("a[href^='tel:']").first()).toBeVisible();
    await expect(sheet).toContainText("경기도 부천시 기준");
    for (const meta of await sheet.locator(".vs-page > .vs-meta").allInnerTexts()) expect(meta).not.toMatch(/72|일흔|세 |만원|소득|혼자/);
  });

  test("곳마다 한 장 + 담당자께 칸: 무엇을 신청하러 왔는지, 서비스 번호·대상·근거 (원문에 있는 것만) @mobile", async ({ page }) => {
    await toResults(page, DAD);
    const sheet = await openSheet(page);
    const places = sheet.getByTestId("vs-place");
    const n = await places.count();
    await expect(sheet.getByRole("heading", { level: 2 })).toContainText(`${n}곳, 곳마다 한 장`);
    // 각 장에 몇 번째 곳인지, 곳 이름 + '에 가져갈 한 장'
    await expect(places.first().locator(".vs-meta")).toContainText(`1/${n}`);
    const center = places.filter({ hasText: "주소지 행정복지센터(주민센터)에 가져갈 한 장" });
    await expect(center).toHaveCount(1);
    await expect(center.getByTestId("vs-staff")).toContainText("담당자께");
    await expect(center.getByTestId("vs-staff")).toContainText("신청(자격 확인 포함)하러 오셨어요");
    // 서비스 번호(정부24·복지로)와 원문 대상·근거가 혜택마다
    await expect(sheet.locator(".vs-ref").filter({ hasText: /(정부24|복지로) 서비스 [A-Z0-9]+/ }).first()).toBeVisible();
    await expect(sheet.locator(".vs-line").filter({ hasText: /^대상\(원문\): / }).first()).toBeVisible();
    await expect(sheet.locator(".vs-line").filter({ hasText: /소관 / }).first()).toBeVisible();
    // 다른 곳(보건소)의 혜택은 주민센터 장에 섞이지 않는다
    const health = places.filter({ hasText: "가까운 보건소" });
    const healthNames = await health.getByTestId("vs-prog").locator("strong").allInnerTexts();
    for (const name of healthNames) await expect(center.getByTestId("vs-prog").filter({ hasText: name })).toHaveCount(0);
  });

  test("5가지에서 빼기·목록에서 담기가 한 장에 반영 (이 탭에만, 주소에 없음)", async ({ page }) => {
    await toResults(page, DAD);
    const cta = page.getByTestId("sheet-cta");
    await expect(cta).toContainText("담은 혜택 5개");
    await page.getByTestId("pick").first().getByTestId("benefit-more").locator("summary").click();
    await page.getByTestId("pick").first().getByTestId("sheet-toggle").click();
    await expect(cta).toContainText("담은 혜택 4개");
    const extra = page.locator("#v2-fit [data-testid=v2-card]").filter({ has: page.getByRole("button", { name: /신청 서류 모음에 담기$/, includeHidden: true }) }).first();
    await extra.getByTestId("benefit-more").locator("summary").click();
    await extra.getByTestId("sheet-toggle").click();
    await expect(cta).toContainText("담은 혜택 5개");
    const stored = await page.evaluate(() => sessionStorage.getItem("bn.sheet.v1"));
    expect(JSON.parse(stored!)).toEqual({ add: [expect.any(String)], remove: [expect.any(String)] });
    expect(stored).not.toMatch(/부천|72|소득/);
    const sheet = await openSheet(page);
    await expect(sheet).toContainText("직접 담은 1개");
  });

  test("이미지로 저장: PNG(가로 1080) 내려받기 @mobile", async ({ page }) => {
    await toResults(page, DAD);
    const sheet = await openSheet(page);
    const [dl] = await Promise.all([page.waitForEvent("download"), sheet.getByTestId("vs-png").first().click()]);
    expect(dl.suggestedFilename()).toBe("복지나침반-준비물-1.png");
    const buf = readFileSync((await dl.path())!);
    expect(buf.subarray(1, 4).toString()).toBe("PNG");
    expect(buf.readUInt32BE(16)).toBe(1080);
    expect(buf.readUInt32BE(20)).toBeGreaterThan(800);
    await expect(page.getByTestId("vs-msg")).toContainText("저장했어요");
  });

  test("인쇄: 곳마다 한 쪽씩(각 A4 한 장 안), '이 곳 한 장 인쇄'는 그 곳만, 끝나면 원래대로 @mobile", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __printed: number }).__printed = 0;
      window.print = () => {
        (window as unknown as { __printed: number }).__printed++;
      };
    });
    await toResults(page, DAD);
    const sheet = await openSheet(page);
    const n = await sheet.getByTestId("vs-place").count();
    await page.getByTestId("vs-print").click();
    expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
    await expect(page.locator("html")).toHaveAttribute("data-print", "sheet");
    await page.emulateMedia({ media: "print" });
    const root = page.locator(".sheet-print-root");
    await expect(root).toBeVisible();
    await expect(root).toContainText("신청 서류 모음");
    await expect(root).toContainText("가까운 보건소");
    await expect(page.getByTestId("v2-results")).toBeHidden();
    await expect(page.locator("header").first()).toBeHidden();
    // 곳마다 한 쪽, 각 쪽은 A4 한 장 높이(297mm ≈ 1123px) 안
    const pages = root.locator(".vs-page");
    await expect(pages).toHaveCount(n);
    for (const h of await pages.evaluateAll((es) => es.map((e) => e.getBoundingClientRect().height))) expect(h).toBeLessThan(1123 * 1.05);
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    // 이 곳 한 장만
    await page.emulateMedia({ media: "screen" });
    await sheet.getByTestId("vs-place").filter({ hasText: "가까운 보건소" }).getByTestId("vs-print-place").click();
    await page.emulateMedia({ media: "print" });
    await expect(pages).toHaveCount(1);
    await expect(root).toContainText("가까운 보건소");
    await expect(root).not.toContainText("주소지 행정복지센터(주민센터)에 가져갈 한 장");
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await expect(page.locator("html")).not.toHaveAttribute("data-print", "sheet");
    // 평소 인쇄(결과 전체)에서는 한 장 복사본이 숨겨짐
    await expect(root).toBeHidden();
    await expect(page.getByTestId("v2-results")).toBeVisible();
  });

  test("axe: 한눈에 보기 + 준비물 한 장을 연 결과 화면 serious/critical 0건 @mobile", async ({ page }) => {
    await toResults(page, BABY);
    await openSheet(page);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.impact}) ${v.help}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
    expect(bad).toEqual([]);
  });
});

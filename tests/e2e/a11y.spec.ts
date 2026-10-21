import { openPrefill } from "./helpers/prefill";
import fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** 접근성 점검 (axe-core, WCAG 2.1 A/AA): serious·critical 위반 0건이어야 한다 */
const PAGES: { name: string; path: string; preset?: string; sentence?: string }[] = [
  { name: "홈", path: "/" },
  { name: "골라서 찾기", path: "/ask" },
  { name: "상황 입력(내 복지)", path: "/situation?for=self&new=1" },
  { name: "결과(예시: 수원 어르신)", path: "/results", preset: "suwon-senior" },
  { name: "상황 입력(부모님)", path: "/situation?for=parent&new=1" },
  { name: "입력(문장 해석 확인)", path: "/", sentence: "수원시 소재에 계시고 59년생 부모님 두분이 계신다" },
  { name: "결과(부모님 돌보기)", path: "/results", preset: "parent-care" },
  { name: "상세(기초연금)", path: "/p/n.gov24-SSE000000170" },
  { name: "상세(대체 안내)", path: "/p/g41110.icare-0085-1489588-1-1-30" },
  { name: "검색", path: "/search?q=기초연금" },
  { name: "데이터·판정 기준", path: "/about" },
];

/**
 * axe 실행 전: 클라이언트 이동 직후에는 Next.js가 새 화면의 <title>을 비동기로 넣는다 (스트리밍 메타데이터).
 * 그 사이에 검사하면 document-title 위반이 간헐적으로 잡힌다(예전 간헐 실패의 원인) → 제목이 채워질 때까지 기다린다.
 */
async function settle(page: import("@playwright/test").Page) {
  await expect(page).toHaveTitle(/복지나침반/, { timeout: 20_000 });
}

test("axe 접근성: 주요 화면 serious/critical 0건 @mobile", async ({ page }, info) => {
  test.setTimeout(120_000);
  const summary: Record<string, { violations: { id: string; impact: string | null | undefined; nodes: number; help: string }[] }> = {};
  for (const pg of PAGES) {
    if (pg.sentence) {
      await openPrefill(page, pg.sentence);
      await expect(page.getByTestId("prefill-banner")).toBeVisible({ timeout: 20_000 });
    } else if (pg.preset) {
      await page.goto("/");
      await page.getByText("가상 예시 보기", { exact: false }).click();
      await page.getByTestId(`preset-${pg.preset}`).click();
      await expect(page.getByTestId("top-picks")).toBeVisible({ timeout: 20_000 });
    } else {
      await page.goto(pg.path);
      await page.waitForLoadState("networkidle");
    }
    await settle(page);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    summary[pg.name] = { violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })) };
  }
  // 큰 글씨 모드의 결과 화면
  await page.goto("/");
  await page.getByText("가상 예시 보기", { exact: false }).click();
  await page.getByTestId("preset-bucheon-disability").click();
  await expect(page.getByTestId("top-picks")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("large-text").click();
  await settle(page);
  const rl = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  summary["결과(큰 글씨, 부천 장애인 가구)"] = { violations: rl.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })) };
  await page.getByTestId("large-text").click();
  // 자동으로 받는 혜택 영역을 펼친 상태
  await page.getByTestId("auto-toggle").click();
  await expect(page.getByTestId("auto-section").getByTestId("v2-card").first()).toBeVisible();
  await settle(page);
  const ra = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  summary["결과(자동으로 받는 혜택 펼침)"] = { violations: ra.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })) };
  // 맞지 않아 뺀 혜택 · 답하면 정해져요 펼침
  await page.getByTestId("v2-no").locator(":scope > summary").click();
  if (await page.getByTestId("v2-ask").count()) await page.getByTestId("v2-ask").locator(":scope > summary").click();
  await settle(page);
  const rv = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  summary["결과(부천, 뺀 혜택 펼침)"] = { violations: rv.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })) };
  // 상세: 내 답과 비교 (저장된 상황 있음)
  await page.goto("/p/n.gov24-SSE000000170");
  await expect(page.getByTestId("explain")).toBeVisible({ timeout: 20_000 });
  await settle(page);
  const rd = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  summary["상세(내 답 비교)"] = { violations: rd.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })) };
  // 예전 화면 (v=1, 비교용)
  await page.goto("/results?v=1");
  await expect(page.getByTestId("tab-eligible")).toBeVisible({ timeout: 20_000 });
  await settle(page);
  const r1 = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  summary["예전 결과(v=1)"] = { violations: r1.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })) };
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(`test-results/axe-${info.project.name}.json`, JSON.stringify(summary, null, 2));
  const bad = Object.entries(summary).flatMap(([n, s]) => s.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${n}: ${v.id} (${v.impact}, ${v.nodes}) ${v.help}`));
  expect(bad, bad.join("\n")).toEqual([]);
});

/** (2026-10-22) 데이터 현황: 매일 자동 확인 결과(data 브랜치 _report·_history)를 보여 주고, 결과 화면에 데이터 기준일 */
import { expect, test } from "@playwright/test";

const RAW = "https://raw.githubusercontent.com/yonghwan86/bokji-compass/data";
const report = {
  checkedAt: "2026-10-23T15:12:00Z", date: "2026-10-24", mode: "daily",
  gate: { ok: false, warnings: ["bokjiro-local: 건수가 12% 줄었어요 (4,820 → 4,242)"] },
  sources: [
    { source: "gov24", status: "ok", total: 10972, previous: 10970, added: 3, removed: 1, changed: 7 },
    { source: "bokjiro-central", status: "held", detail: "일일 호출 예산 소진 (central 95)", total: 461, previous: 461, added: 0, removed: 0, changed: 2 },
    { source: "bokjiro-local", status: "ok", total: 4242, previous: 4820, added: 0, removed: 578, changed: 0 },
    { source: "mohw", status: "error", detail: "실행 실패: ingest.ts", total: 230, previous: 230, added: 0, removed: 0, changed: 0 },
  ],
  bokjiroDetail: { central: { fetched: 2, cached: 459, remaining: 0 }, local: { fetched: 0, cached: 4242, remaining: 0 } },
  moneyChanged: { count: 1, items: [{ source: "gov24", id: "X1", name: "가상 수당", before: { per: "month", won: 100000, quote: "월 10만원" }, after: { per: "month", won: 120000, quote: "월 12만원 지급" } }] },
};
const history = [
  { date: "2026-10-22", mode: "baseline", gateOk: true, sources: [] },
  { date: "2026-10-24", mode: "daily", gateOk: false, sources: report.sources.map(({ source, status, total, added, removed, changed }) => ({ source, status, total, added, removed, changed })) },
];

test("데이터 현황: 원천별 오늘 변경, 점검 경고, 최근 기록, 사이트 기준일 @mobile", async ({ page }) => {
  const asked: string[] = [];
  await page.route(`${RAW}/**`, (route) => {
    asked.push(route.request().url());
    const f = route.request().url().split("/").pop();
    return route.fulfill({ json: f === "_report.json" ? report : history });
  });
  await page.goto("/data");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("데이터 현황");
  await expect(page.getByTestId("ds-site")).toContainText("개 사업");
  await expect(page.getByTestId("ds-gate")).toContainText("점검 경고");
  await expect(page.getByText("건수가 12% 줄었어요")).toBeVisible();
  const gov = page.getByTestId("ds-src-gov24");
  await expect(gov).toContainText("정부24 공공서비스(혜택)");
  await expect(gov).toContainText("10,972");
  await expect(page.getByTestId("ds-src-mohw")).toContainText("오류");
  // 호출 한도로 못 받은 날은 '오류'가 아니라 '보류'
  await expect(page.getByTestId("ds-src-bokjiro-central")).toContainText("보류(호출 한도)");
  await expect(page.getByTestId("ds-history")).toContainText("바뀐 사업 591건");
  await expect(page.getByTestId("ds-history")).toContainText("기준 기록");
  // 읽는 것은 공개 원천 기록 두 파일뿐
  expect(asked.every((u) => /\/_(report|history)\.json$/.test(u))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("데이터 현황: 금액이 바뀐 사업은 전후 금액과 원문 구절, 확인이 36시간 넘게 없으면 '확인 지연' @mobile", async ({ page }) => {
  const old = { ...report, checkedAt: "2020-01-01T00:00:00Z" };
  await page.route(`${RAW}/**`, (route) => route.fulfill({ json: route.request().url().endsWith("_report.json") ? old : history }));
  await page.goto("/data");
  const money = page.getByTestId("ds-money");
  await expect(money).toContainText("가상 수당");
  await expect(money).toContainText("월 100,000원");
  await expect(money).toContainText("월 120,000원");
  await expect(money).toContainText("월 12만원 지급");
  await expect(page.getByTestId("ds-stale")).toContainText("확인이 늦어지고 있어요");
});

test("데이터 현황: 최근에 확인했으면 '확인 지연' 없음", async ({ page }) => {
  const fresh = { ...report, checkedAt: new Date().toISOString(), moneyChanged: { count: 0, items: [] } };
  await page.route(`${RAW}/**`, (route) => route.fulfill({ json: route.request().url().endsWith("_report.json") ? fresh : history }));
  await page.goto("/data");
  await expect(page.getByTestId("ds-gate")).toBeVisible();
  await expect(page.getByTestId("ds-stale")).toHaveCount(0);
  await expect(page.getByTestId("ds-money")).toHaveCount(0);
});

test("데이터 현황: 기록을 못 불러오면 안내와 수집 기록 링크", async ({ page }) => {
  await page.route(`${RAW}/**`, (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/data");
  await expect(page.getByTestId("ds-error")).toBeVisible();
  await expect(page.getByTestId("ds-error").getByRole("link", { name: "수집 기록" })).toHaveAttribute("href", /commits\/data$/);
});

test("결과 화면·바닥글: 데이터 기준일과 데이터 현황 링크 @mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preset-suwon-senior").click();
  await expect(page.getByTestId("top-picks")).toBeVisible({ timeout: 20_000 });
  const asof = page.getByTestId("data-asof");
  await expect(asof).toContainText("데이터 기준");
  await expect(asof.getByRole("link", { name: "데이터 현황" })).toHaveAttribute("href", "/data");
  await expect(page.locator("footer").getByRole("link", { name: "데이터 현황" })).toHaveAttribute("href", "/data");
});

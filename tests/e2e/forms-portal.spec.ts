import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { detailBucket } from "../../src/lib/data/bucket";
import type { ApplicationForm, FormsCatalog, FormsCoverage, FormsRegion, FormsRegionBundle, ProgramFormEntry } from "../../src/lib/data/forms";

/** 전국 수집이 끝나기 전에도 돌 수 있게, 공개 JSON 만 흉내 내어 로더·화면 규칙을 검사한다. */
const PROGRAM = "g41280.gov24-394000000111";
const REGION_KEY = "g41280";
const AT = "2026-10-16T00:00:00.000Z";
const localForm: ApplicationForm = (JSON.parse(readFileSync("public/forms/v1/catalog.json", "utf8")) as FormsCatalog).forms["ordin-19969911"];

const region: FormsRegion = { key: REGION_KEY, label: "경기도 고양시", scope: "sigungu", total: 1, counts: { available: 0, online: 0, review: 0, missing: 0 } };
const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

function entry(patch: Partial<ProgramFormEntry> = {}): ProgramFormEntry {
  return { id: PROGRAM, name: "장수축하금", areaKey: REGION_KEY, status: "missing", links: [], candidateFormIds: [], ...patch };
}
function bundle(programs: ProgramFormEntry[], sharded?: true): FormsRegionBundle {
  return { schema: 1, generatedAt: AT, region: { ...region, total: programs.length }, programs, catalogSharded: sharded };
}
function form(id: string, patch: Partial<ApplicationForm> = {}): ApplicationForm {
  return {
    id, title: "[별지 제1호서식] 신청서", role: "application", lawTitle: "고양시 복지 조례", lawId: "1", annexId: "1", annexNumber: "1",
    regionCode: REGION_KEY, regionLabel: "경기도 고양시", effectiveDate: "2026-01-02",
    sourceUrl: "https://www.law.go.kr/LSW/flDownload.do?flSeq=1", lawUrl: "https://www.law.go.kr/ordinInfoP.do?ordinSeq=1", fetchedAt: AT, ...patch,
  };
}
const catalog = (forms: ApplicationForm[]): FormsCatalog => ({ schema: 1, generatedAt: AT, forms: Object.fromEntries(forms.map(item => [item.id, item])) });
const link = (formId: string, patch: Partial<ProgramFormEntry["links"][number]> = {}) =>
  ({ formId, use: "main" as const, evidenceUrl: "https://www.law.go.kr/ordinInfoP.do?ordinSeq=1", evidenceNote: "조례 제5조 신청 서식", checkedAt: "2026-10-16", ...patch });

/** 지역 번들 + 샤드/통짜 카탈로그를 깔고, 어떤 공개 파일을 요청했는지 돌려준다. */
async function serve(page: Page, options: { bundle: FormsRegionBundle; shards?: Record<string, FormsCatalog>; catalog?: FormsCatalog; broken?: string[] }) {
  const asked: string[] = [];
  await page.route("**/forms/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    asked.push(path);
    if (path.endsWith(`/programs/${REGION_KEY}.json`)) return json(route, options.bundle);
    if (path.endsWith("/catalog.json")) return options.catalog ? json(route, options.catalog) : route.fulfill({ status: 503, body: "offline" });
    const bucket = /\/catalog\/([0-9a-f]{2})\.json$/.exec(path)?.[1];
    if (bucket && options.shards?.[bucket] && !options.broken?.includes(bucket)) return json(route, options.shards[bucket]);
    return route.fulfill({ status: 404, body: "missing" });
  });
  return asked;
}
const panel = (page: Page) => page.getByTestId("application-forms");

test("a combined original shows the part selected for this benefit @mobile",async({page})=>{
  const original=form("ordin-90002",{title:"별지",displayTitle:"다른 혜택의 신청서",
    file:{hwp:"/forms/files/ordin-90002-012345abcdef.hwp",format:"hwp",bytes:123,sha256:"a".repeat(64)}});
  await serve(page,{bundle:bundle([entry({status:"available",links:[link(original.id,{displayTitle:"장수축하금 지급 신청서"})]})]),catalog:catalog([original])});
  await page.goto(`/p/${PROGRAM}`);
  await expect(panel(page).getByRole("heading",{name:"장수축하금 지급 신청서",exact:true})).toBeVisible();
  await expect(panel(page).getByText("다른 혜택의 신청서",{exact:true})).toHaveCount(0);
  await expect(panel(page).getByRole("link",{name:/한글 원본 받기/})).toHaveAttribute("download","장수축하금 지급 신청서.hwp");
});

for (const format of ["hwp", "hwpx"] as const) test(`stored ${format} preserves its actual download extension @mobile`, async ({page}) => {
  const original=form("ordin-90001",{title:"[별지 제1호서식] 지원 신청서",file:{hwp:`/forms/files/ordin-90001-012345abcdef.${format}`,format,bytes:123,sha256:"a".repeat(64)}});
  await serve(page,{bundle:bundle([entry({status:"available",links:[link(original.id)]})]),catalog:catalog([original])});
  await page.goto(`/p/${PROGRAM}`);
  const download=panel(page).getByRole('link',{name:/한글 원본 받기/});
  await expect(download).toHaveAttribute('href',original.file!.hwp);
  await expect(download).toHaveAttribute('download',`지원 신청서.${format}`);
  await expect(download).toContainText(`(${format.toUpperCase()})`);
  await expect(panel(page).getByRole('link',{name:/법령포털 원본 받기/})).toHaveCount(0);
});

test("sharded catalog fetches only the buckets a benefit needs @mobile", async ({ page }) => {
  const bucket = detailBucket(localForm.id);
  const asked = await serve(page, { bundle: bundle([entry({ status: "available", links: [link(localForm.id)] })], true), shards: { [bucket]: catalog([localForm]) } });
  await page.goto(`/p/${PROGRAM}`);
  await expect(panel(page).getByRole("link", { name: /한글 원본 받기/ })).toHaveAttribute("href", localForm.file!.hwp);
  await expect(panel(page).getByRole("link", { name: /서식 보기·인쇄/ })).toHaveAttribute("href", localForm.file!.pdf!);
  expect(asked.filter(path => path.includes("/catalog/"))).toEqual([`/forms/v1/catalog/${bucket}.json`]);
  expect(asked).not.toContain("/forms/v1/catalog.json");
});

test("approved form without a stored file offers the law portal original and its own date kind", async ({ page }) => {
  const source = form("law-55", {
    title: "[별지 제2호서식] 돌봄 지원 신청서", lawTitle: "노인복지법 시행규칙", sourceKind: "law", dateKind: "promulgated",
    sourceUrl: "https://www.law.go.kr/LSW/flDownload.do/sample.hwp", officialPdfUrl: "https://law.go.kr/LSW/flDownloadPdf.do/sample.pdf",
  });
  await serve(page, { bundle: bundle([entry({ status: "available", links: [link(source.id)] })]), catalog: catalog([source]) });
  await page.goto(`/p/${PROGRAM}`);
  const section = panel(page);
  await expect(section.getByRole("link", { name: /법령포털 원본 받기 \(HWP\)/ })).toHaveAttribute("href", source.sourceUrl);
  await expect(section.getByRole("link", { name: /서식 보기·인쇄/ })).toHaveAttribute("href", source.officialPdfUrl!);
  await expect(section.getByRole("link", { name: /한글 원본 받기/ })).toHaveCount(0);
  await expect(section).toContainText("근거 법령 공포일 2026-01-02");
  await expect(section).not.toContainText("시행일");
});

test("portal candidates stay collapsed, keep the real count and never become downloads", async ({ page }) => {
  const first = form("ordin-7001", { title: "[별지 제1호서식] 효도수당 지급신청서" });
  const second = form("ordin-7002", { title: "[별지 제2호서식] 효도수당 위임장", role: "delegation", lawUrl: "https://www.law.go.kr/ordinInfoP.do?ordinSeq=2" });
  const register = form("ordin-7003", { title: "[별지 제3호서식] 효도수당 지급대장", role: "administrative" });
  const candidates = [first, second, register];
  const shards: Record<string, FormsCatalog> = {};
  for (const item of candidates) {
    const bucket = detailBucket(item.id);
    shards[bucket] = catalog([...Object.values(shards[bucket]?.forms ?? {}), item]);
  }
  await serve(page, {
    bundle: bundle([entry({
      status: "review", candidateFormIds: candidates.map(item => item.id),
      portalSearch: { outcome: "candidate", checkedAt: "2026-10-15", candidateCount: 12, method: "full-index" },
    })], true),
    shards,
  });
  await page.goto(`/p/${PROGRAM}`);
  const section = panel(page);
  await expect(section).toContainText("연결 검토 중");
  await expect(section).toContainText("법령포털 확인일 2026-10-15");
  const details = section.getByTestId("forms-candidates");
  await expect(details.locator("summary")).toHaveText("법령포털에서 찾은 관련 서식 12개 · 적용 여부 확인 중");
  await expect(details.getByRole("heading", { name: "효도수당 지급신청서" })).toBeHidden(); // 기본은 접힌 상태
  await details.locator("summary").click();
  await expect(details).toContainText("12개 가운데 관련 서식 앞 2개를 보여요");
  await expect(details.getByRole("heading", { name: "효도수당 지급신청서" })).toBeVisible();
  await expect(details).not.toContainText("지급대장");
  await expect(details.getByRole("link", { name: /법령 원문 보기/ })).toHaveCount(2);
  await expect(details.getByRole("link", { name: /법령 원문 보기/ }).first()).toHaveAttribute("href", first.lawUrl);
  await expect(section.getByRole("link", { name: /받기|서식 보기/ })).toHaveCount(0);
});

test("unreadable candidate shard is admitted instead of looking like no forms", async ({ page }) => {
  const candidate = form("ordin-8001", { title: "[별지 제1호서식] 청년 월세 신청서" });
  const bucket = detailBucket(candidate.id);
  await serve(page, {
    bundle: bundle([entry({
      status: "review", candidateFormIds: [candidate.id],
      portalSearch: { outcome: "candidate", checkedAt: "2026-10-15", candidateCount: 3, method: "full-index" },
    })], true),
    shards: { [bucket]: catalog([candidate]) }, broken: [bucket],
  });
  await page.goto(`/p/${PROGRAM}`);
  const section = panel(page);
  await expect(section).toContainText("연결 검토 중");
  const details = section.getByTestId("forms-candidates");
  await expect(details).toContainText("법령포털에서 찾은 관련 서식 3개");
  await details.locator("summary").click();
  await expect(details).toContainText("후보 서식 정보를 일부 불러오지 못했어요. 아래 목록이 전부가 아닐 수 있어요.");
  await expect(details).not.toContainText("모두 기관 내부 서류로 보여");
  await expect(section.getByRole("link", { name: /받기|서식 보기/ })).toHaveCount(0);
});

test("portal not_found and incomplete say what was searched without closing the door", async ({ page }) => {
  await serve(page, { bundle: bundle([entry({ portalSearch: { outcome: "not_found", checkedAt: "2026-10-14", candidateCount: 0, method: "full-index" } })], true) });
  await page.goto(`/p/${PROGRAM}`);
  await expect(panel(page).getByTestId("forms-portal-search")).toContainText("법령포털 서식 목록을 사업명·근거 법규와 대조했지만 연결 후보를 찾지 못했어요");
  await expect(panel(page).getByTestId("forms-portal-search")).toContainText("모든 본문과 파일을 확인했다는 뜻은 아니며, 담당기관 공고에 서식이 따로 있을 수 있어요. (법령포털 확인일 2026-10-14)");
  await expect(panel(page).getByTestId("forms-candidates")).toHaveCount(0);

  await page.unrouteAll();
  await serve(page, { bundle: bundle([entry({ portalSearch: { outcome: "incomplete", checkedAt: "2026-10-16", candidateCount: 0, method: "full-index" } })], true) });
  await page.goto(`/p/${PROGRAM}`);
  await expect(panel(page).getByTestId("forms-portal-search")).toContainText("법령포털 서식을 아직 모두 확인하지 못했어요. 서식이 없다는 뜻은 아니에요.");
});

test("credentialed or off-portal links are never published, and lookups carry no query @mobile", async ({ page }) => {
  const requests: { url: string; body: string | null }[] = [];
  page.on("request", request => { if (request.url().includes("/forms/")) requests.push({ url: request.url(), body: request.postData() }); });
  const keyed = form("law-91", { sourceUrl: "https://www.law.go.kr/LSW/flDownload.do?flSeq=9&OC=secret-account" });
  await serve(page, { bundle: bundle([entry({ status: "available", links: [link(keyed.id)] })]), catalog: catalog([keyed]) });
  await page.goto(`/p/${PROGRAM}`);
  // 인증 키가 붙은 원문만 가진 서식은 연결을 공개하지 않고, 받을 수 있는 것처럼 보여서도 안 된다.
  await expect(panel(page)).toContainText("서식 연결 정보를 불러오지 못했어요");
  await expect(panel(page).getByRole("link", { name: /받기|서식 보기/ })).toHaveCount(0);

  await page.unrouteAll();
  const outside = form("law-92", { title: "[별지 제1호서식] 외부 보관 신청서", lawUrl: "https://example.go.kr/law" });
  const credentialed = form("law-93", { title: "[별지 제2호서식] 관련 신청서", lawUrl: "https://www.law.go.kr/lsInfoP.do?lsiSeq=3&key=secret" });
  await serve(page, {
    bundle: bundle([entry({ status: "review", candidateFormIds: [outside.id, credentialed.id] })]),
    catalog: catalog([outside, credentialed]),
  });
  await page.goto(`/p/${PROGRAM}`);
  const details = panel(page).getByTestId("forms-candidates");
  await details.locator("summary").click();
  // 후보는 이름만 알려 주고, 법령포털 밖이거나 인증 정보가 붙은 주소는 링크로 걸지 않는다.
  await expect(details.getByRole("heading", { name: "외부 보관 신청서" })).toBeVisible();
  await expect(details.getByRole("link")).toHaveCount(0);
  expect(await page.locator("a[href*='OC='], a[href*='key=secret'], a[href*='example.go.kr']").count()).toBe(0);
  for (const request of requests) { expect(new URL(request.url).search).toBe(""); expect(request.body).toBeNull(); }
});

test("overview reports what the portal scan actually covered @mobile", async ({ page }) => {
  const coverage: FormsCoverage = {
    schema: 1, generatedAt: AT, totalPrograms: 23578,
    counts: { available: 42, online: 1971, review: 311, missing: 21254 },
    totalForms: 408271, publishedForms: 42, excludedForms: 76,
    sourceNote: "전국 사업 목록의 연결 상태를 집계합니다.",
    regions: [{ ...region, scope: "national", key: "national", label: "전국 공통", total: 1 }, { ...region, total: 2, counts: { available: 0, online: 0, review: 1, missing: 1 } }],
    portalScan: {
      status: "incomplete", indexedForms: 408271, checkedPrograms: 23578, checkedAt: "2026-10-16T07:30:00.000Z",
      sources: [{ kind: "licbyl", total: 40036, collected: 40036 }, { kind: "ordinbyl", total: 283751, collected: 35100 }, { kind: "admbyl", total: 84484, collected: 100 }],
    },
  };
  await page.route("**/forms/v1/coverage.json", route => json(route, coverage));
  await page.route(`**/forms/v1/programs/${REGION_KEY}.json`, route => json(route, bundle([
    entry({ id: `${REGION_KEY}.a`, name: "검토 중 사업", status: "review", candidateFormIds: ["ordin-1"] }),
    entry({ id: `${REGION_KEY}.b`, name: "미확보 사업", portalSearch: { outcome: "not_found", checkedAt: "2026-10-16", candidateCount: 0, method: "full-index" } }),
  ], true)));
  await page.goto("/forms");
  const scan = page.getByTestId("forms-portal-scan");
  await expect(scan).toContainText("법령포털 서식 408,271개를 받아 수록 사업 23,578건까지 맞춰 봤어요");
  await expect(scan).toContainText("전수 확인은 아직 끝나지 않았어요(확인일 2026-10-16)");
  await expect(scan).toContainText("수록 사업 모두에 내려받을 신청서가 있는 것은 아니에요");
  await page.getByText("수집 현황·출처", { exact: true }).click();
  await expect(page.getByText("법령포털 수집 법령 서식 40,036/40,036 · 자치법규 서식 35,100/283,751 · 행정규칙 서식 100/84,484")).toBeVisible();
  await expect(page.getByText("경기도 고양시 수록 2건 중 현재 조건 2건")).toBeVisible();
  await expect(page.getByText("자동으로 찾은 후보 서식의 적용 여부를 확인 중입니다.")).toBeVisible();
  await expect(page.getByText("법령포털 서식 목록 대조에서 연결 후보를 찾지 못했습니다. 신청서가 없거나 지원 대상이 아니라는 뜻은 아닙니다.")).toBeVisible();
});

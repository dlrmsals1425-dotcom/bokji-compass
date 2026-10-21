import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import type {
  ApplicationForm, FormsCatalog, FormsCoverage, FormsRegion, FormsRegionBundle,
  FormStatus, Investigation, InvestigationState, ProgramFormEntry,
} from "../../src/lib/data/forms";

/** 수집 중인 실제 census/catalog 대신 공개 JSON을 모킹해 화면의 출처 구분을 검사한다. */
const PROGRAM = "g41280.gov24-394000000111";
const REGION = "g41280";
const AT = "2026-10-16T00:00:00.000Z";
const DAY = "2026-10-16";
const OFFICIAL_PAGE = "https://www.goyang.go.kr/notice/view.do?sn=census-fixture";
const ATTACHMENT = "https://www.goyang.go.kr/files/census-guide.pdf";
const STAGES: { key: InvestigationState; label: string; count: number }[] = [
  { key: "confirmed", label: "신청 서류 원문 확인", count: 1 },
  { key: "attachment_found", label: "공식 안내 첨부자료 확인", count: 2 },
  { key: "candidate", label: "관련 서식 검토 중", count: 3 },
  { key: "document_mentioned", label: "준비서류 안내 확인", count: 4 },
  { key: "automatic", label: "자동 지원 방식 — 확인 필요", count: 5 },
  { key: "institution", label: "기관 추천 방식 — 확인 필요", count: 6 },
  { key: "needs_source", label: "출처 찾는 중", count: 7 },
];
const approved: ApplicationForm = {
  id: "ordin-census-approved", title: "[별지 제1호서식] 원문 확인된 신청서", role: "application",
  lawTitle: "고양시 복지 지원 조례", lawId: "1", annexId: "1", annexNumber: "000100",
  regionCode: "41280", regionLabel: "경기도 고양시", effectiveDate: "2026-01-02",
  sourceKind: "ordin", dateKind: "effective", fetchedAt: AT,
  sourceUrl: "https://www.law.go.kr/LSW/flDownload.do/census-form.hwp",
  lawUrl: "https://www.law.go.kr/ordinInfoP.do?ordinSeq=1",
};
const approvedLink = {
  formId: approved.id, use: "main" as const, evidenceUrl: approved.lawUrl,
  evidenceNote: "신청 조항과 별지 원문을 대조한 시험 자료", checkedAt: DAY,
};
const json = (route: Route, value: unknown) => route.fulfill({
  status: 200, contentType: "application/json", body: JSON.stringify(value),
});
const panel = (page: Page) => page.getByTestId("application-forms");

function investigation(patch: Partial<Investigation> = {}): Investigation {
  return {
    state: "needs_source", checkedAt: DAY, applicationMentioned: false, documentNames: [],
    lawChecks: { searched: 0, read: 0, failed: 0 },
    pageChecks: { attempted: 0, read: 0, failed: 0, unattempted: 0 },
    sourceLinks: [], ...patch,
  };
}
function entry(patch: Partial<ProgramFormEntry> = {}): ProgramFormEntry {
  return { id: PROGRAM, name: "시험 혜택", areaKey: REGION, status: "missing", links: [], candidateFormIds: [], ...patch };
}
function attachmentInvestigation(patch: Partial<Investigation> = {}): Investigation {
  return investigation({
    state: "attachment_found", applicationMentioned: true,
    pageChecks: { attempted: 1, read: 1, failed: 0 },
    sourceLinks: [
      { kind: "attachment", title: "공식 안내자료.pdf", url: ATTACHMENT },
      { kind: "official_page", title: "담당기관 사업 안내", url: OFFICIAL_PAGE },
    ], ...patch,
  });
}
function counts(programs: ProgramFormEntry[]): Record<FormStatus, number> {
  const result = { available: 0, online: 0, review: 0, missing: 0 };
  for (const program of programs) result[program.status]++;
  return result;
}
function region(programs: ProgramFormEntry[]): FormsRegion {
  return { key: REGION, label: "경기도 고양시", scope: "sigungu", total: programs.length, counts: counts(programs) };
}
function coverage(programs: ProgramFormEntry[], census = true): FormsCoverage {
  const tally = Object.fromEntries(STAGES.map(({ key }) => [key, programs.filter(p => p.investigation?.state === key).length])) as Record<InvestigationState, number>;
  const attachmentCount = new Set(programs.flatMap(p => p.investigation?.sourceLinks.filter(link => link.kind === "attachment").map(link => link.url) ?? [])).size;
  return {
    schema: 1, generatedAt: AT, totalPrograms: programs.length, counts: counts(programs),
    totalForms: 1, publishedForms: programs.some(p => p.links.length) ? 1 : 0, excludedForms: 0,
    sourceNote: "공개 사업 자료의 연결 상태와 실제 원문 조사 횟수를 구분한 시험 자료입니다.",
    regions: [region(programs)],
    portalScan: { status: "complete", indexedForms: 408267, checkedPrograms: programs.length, checkedAt: AT, sources: [] },
    ...(census ? { investigationSummary: {
      checkedAt: DAY, totalPrograms: programs.length, counts: tally,
      lawQueries: 100, lawBodiesRead: 7, lawFailures: 93,
      pageUrls: 40, pagesRead: 12, pageFailures: 28, officialAttachments: attachmentCount,
    } } : {}),
  };
}
async function serve(page: Page, programs: ProgramFormEntry[], options: { census?: boolean; forms?: ApplicationForm[] } = {}) {
  const bundle: FormsRegionBundle = { schema: 1, generatedAt: AT, region: region(programs), programs };
  const catalog: FormsCatalog = { schema: 1, generatedAt: AT, forms: Object.fromEntries((options.forms ?? []).map(form => [form.id, form])) };
  await page.route("**/forms/v1/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/programs/${REGION}.json`)) return json(route, bundle);
    if (path.endsWith("/coverage.json")) return json(route, coverage(programs, options.census !== false));
    if (path.endsWith("/catalog.json")) return json(route, catalog);
    return route.fulfill({ status: 404, body: "fixture not found" });
  });
}
async function noHorizontalOverflow(page: Page, section?: Locator) {
  await page.evaluate(async () => { await document.fonts.ready; });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  if (section) await expect.poll(() => section.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}

test("official source attachments stay materials, not approved application downloads @mobile", async ({ page }) => {
  await serve(page, [entry({ investigation: attachmentInvestigation({ sourceLinks: [
    { kind: "attachment", title: "공식 안내자료.pdf", url: ATTACHMENT, note:"이전 연도 양식이므로 최신 모집공고를 확인해 주세요." },
    { kind: "attachment", title: "근거 조례.pdf", url: "https://www.goyang.go.kr/files/census-ordinance.pdf" },
    { kind: "official_page", title: "담당기관 사업 안내", url: OFFICIAL_PAGE },
  ] }) })]);
  await page.goto(`/p/${PROGRAM}`);
  const section = panel(page);
  const sources = section.getByTestId("forms-source-attachments");
  await expect(section).toContainText("신청서 찾는 중");
  await expect(sources).toContainText("연결을 확인한 신청서로는 올리지 않았어요");
  await expect(sources.getByRole("link")).toHaveCount(2);
  await expect(sources).toContainText("확인 메모: 이전 연도 양식이므로 최신 모집공고를 확인해 주세요.");
  const material = sources.getByRole("link", { name: /공식 안내자료\.pdf/ });
  await expect(material).toHaveAttribute("href", ATTACHMENT);
  await expect(material).toHaveAttribute("target", "_blank");
  expect(await material.getAttribute("download")).toBeNull();
  await expect(section.getByRole("link", { name: /한글 원본 받기|법령포털 원본 받기|서식 보기·인쇄/ })).toHaveCount(0);
  await expect(section.getByTestId("forms-investigation-detail").getByRole("link", { name: /담당기관 사업 안내/ })).toBeHidden();
});

test("a confirmed application keeps its approved action separate from census material", async ({ page }) => {
  await serve(page, [entry({
    status: "available", links: [approvedLink],
    investigation: attachmentInvestigation({ state: "confirmed", lawChecks: { searched: 1, read: 1, failed: 0 } }),
  })], { forms: [approved] });
  await page.goto(`/p/${PROGRAM}`);
  const section = panel(page);
  await expect(section.getByRole("heading", { name: "원문 확인된 신청서" })).toBeVisible();
  await expect(section.getByRole("link", { name: /법령포털 원본 받기/ })).toHaveAttribute("href", approved.sourceUrl);
  await expect(section.getByTestId("forms-investigation")).toContainText("신청 서류 원문 확인");
  const materials = section.getByTestId("forms-source-attachments");
  await expect(materials.getByRole("link", { name: /공식 안내자료\.pdf/ })).toHaveAttribute("href", ATTACHMENT);
  await expect(materials.getByRole("link", { name: /원본 받기|서식 보기/ })).toHaveCount(0);
  await expect(materials).toContainText("다른 서류가 더 필요한지는 확인 중");
});

test("detail distinguishes attempted, unread, and unattempted sources without inventing absence", async ({ page }) => {
  await serve(page, [entry({ investigation: investigation({
    lawChecks: { searched: 5, read: 2, failed: 3 },
    pageChecks: { attempted: 3, read: 1, failed: 4, unattempted: 2 },
    sourceLinks: [{ kind: "official_page", title: "재확인할 공식 페이지", url: OFFICIAL_PAGE }],
    note: "조회 제한으로 남은 원문은 추가 확인 대상입니다.",
  }) })]);
  await page.goto(`/p/${PROGRAM}`);
  const census = panel(page).getByTestId("forms-investigation");
  const detail = census.getByTestId("forms-investigation-detail");
  await expect(census).toContainText("신청서가 없다는 뜻은 아니에요");
  await expect(detail.getByRole("link", { name: /재확인할 공식 페이지/ })).toBeHidden();
  await detail.locator("summary").click();
  await expect(detail).toContainText("5건을 찾아보고 2건을 실제로 열어 읽었어요. 3건은 확인을 마치지 못했어요.");
  await expect(detail).toContainText("3곳에 조회를 시도해 1곳을 읽었어요.");
  await expect(detail).toContainText("2곳은 접근 제한이나 주소 확인 문제로 조회하지 못했어요.");
  await expect(detail).toContainText("총 4곳은 추가 확인이 필요해요.");
  await expect(detail).toContainText("아직 찾지 못했어요(없다는 뜻은 아니에요).");
  await expect(detail).not.toContainText("열지 못한 본문은 없어요");
  await expect(detail).not.toContainText("열지 못한 페이지는 없어요");
  await expect(detail.getByRole("link", { name: /재확인할 공식 페이지/ })).toHaveAttribute("href", OFFICIAL_PAGE);
});

test("a supporting document alone does not claim the main application is ready", async ({page}) => {
  const supporting={...approved,title:"담당의사 처방전",role:"supporting" as const};
  await serve(page,[entry({status:"available",links:[{...approvedLink,use:"additional"}],
    investigation:investigation({state:"confirmed"})})],{forms:[supporting]});
  await page.goto(`/p/${PROGRAM}`);
  await expect(panel(page)).toContainText("현재 연결한 것은 함께 준비하거나 해당되는 경우에 내는 서류예요");
  await expect(panel(page)).toContainText("주신청서와 전체 구비서류는 공식 신청 안내에서 확인해 주세요");
  await expect(panel(page).getByRole("heading",{name:"담당의사 처방전"})).toBeVisible();
});

test("an application address with a verified changed operator is withheld", async ({page}) => {
  await page.goto('/p/s51000.bokjiro-WLF00001885');
  await expect(page.locator('a[href*="hwandonghae.gangwon.kr"]')).toHaveCount(0);
  await expect(page.getByText(/기존 기관 주소가 현재 복지사업과 무관한 생활 블로그/).first()).toBeVisible();
  await expect(page.getByTestId('official-link')).toHaveAttribute('href',/bokjiro\.go\.kr/);
});

test("overview reports real read counts and filters all seven investigation states @mobile", async ({ page }) => {
  const programs = STAGES.flatMap(stage => Array.from({ length: stage.count }, (_, index) => entry({
    id: `${REGION}.census-${stage.key}-${index}`, name: `${stage.label} 표본 ${index + 1}`,
    status: stage.key === "confirmed" ? "available" : stage.key === "candidate" ? "review" : "missing",
    links: stage.key === "confirmed" ? [approvedLink] : [],
    investigation: stage.key === "attachment_found"
      ? attachmentInvestigation({ sourceLinks: [{ kind: "attachment", title: "사업 안내자료.pdf", url: `${ATTACHMENT}?fixture=${index}` }] })
      : investigation({ state: stage.key, applicationMentioned: stage.key === "document_mentioned", documentNames: stage.key === "document_mentioned" ? ["지원 신청서"] : [] }),
  })));
  await serve(page, programs, { forms: [approved] });
  await page.goto("/forms");
  const summary = page.getByTestId("forms-investigation-summary");
  await expect(summary).toContainText("사업 자료 28건의 조사 상태를 집계했어요");
  await expect(summary).toContainText("100건을 찾아보고 7건을 실제로 열어 읽었어요. 93건은 열지 못했어요.");
  await expect(summary).toContainText("주소 40곳을 조사 대상으로 정하고 12곳의 본문을 읽었어요. 28건은 열지 못했어요.");
  await expect(summary).toContainText("첨부자료 2건");
  await expect(summary).toContainText("전국 법령 본문을 모두 읽었다는 뜻이 아니에요");
  await expect(page.getByTestId("forms-portal-scan")).toContainText("목록 대조 완료");
  const filter = page.getByLabel("확인 단계", { exact: true });
  await expect(filter.locator("option")).toHaveCount(8);
  for (const stage of STAGES) {
    await expect(summary.getByText(stage.label, { exact: true }).locator("..").locator("dd")).toHaveText(`${stage.count}건`);
    await expect(filter.locator(`option[value="${stage.key}"]`)).toHaveText(`${stage.label} ${stage.count}건`);
    await filter.selectOption(stage.key);
    await expect(page.getByText(`경기도 고양시 수록 28건 중 현재 조건 ${stage.count}건`)).toBeVisible();
    const rows = page.getByTestId("forms-row-stage");
    await expect(rows).toHaveCount(stage.count);
    for (const row of await rows.all()) await expect(row).toContainText(`확인 단계 · ${stage.label}`);
  }
  // 두 필터의 교집합을 확인해 단계 선택이 연결 상태를 덮어쓰지 않게 한다.
  await page.getByLabel("연결 상태", { exact: true }).selectOption("available");
  await expect(page.getByTestId("forms-row-stage")).toHaveCount(0);
  await filter.selectOption("confirmed");
  await expect(page.getByTestId("forms-row-stage")).toHaveCount(1);
});

test("unsafe source URLs never become links while numeric municipal menu keys survive", async ({ page }) => {
  const menu = "https://www.jongno.go.kr/page.do?key=1234";
  await serve(page, [entry({ investigation: attachmentInvestigation({ sourceLinks: [
    { kind: "attachment", title: "공식 안내자료.pdf", url: ATTACHMENT },
    { kind: "official_page", title: "숫자 메뉴번호 안내", url: menu },
    { kind: "attachment", title: "토큰 첨부", url: "https://www.bokjiro.go.kr/file.hwp?token=e2e-secret-token" },
    { kind: "official_page", title: "인증 법령 조회", url: "https://www.law.go.kr/DRF/lawService.do?OC=e2e-secret-account" },
    { kind: "attachment", title: "비공개 호스트", url: "http://127.0.0.1/private.hwp" },
    { kind: "attachment", title: "계정 포함 주소", url: "https://user:password@www.gov.kr/file.pdf" },
    { kind: "attachment", title: "실행 주소", url: "javascript:alert('census-fixture')" },
  ] }) })]);
  await page.goto(`/p/${PROGRAM}`);
  const census = panel(page).getByTestId("forms-investigation");
  await census.getByTestId("forms-investigation-detail").locator("summary").click();
  await expect(census.getByRole("link")).toHaveCount(2);
  await expect(census.getByRole("link", { name: /숫자 메뉴번호 안내/ })).toHaveAttribute("href", menu);
  const hrefs = await census.getByRole("link").evaluateAll(links => links.map(link => link.getAttribute("href")));
  expect(hrefs.sort()).toEqual([ATTACHMENT, menu].sort());
  await expect(census).not.toContainText("토큰 첨부");
  await expect(census).not.toContainText("인증 법령 조회");
  expect(await census.innerHTML()).not.toMatch(/e2e-secret|127\.0\.0\.1|user:password|javascript:/);
});

test("legacy records do not acquire invented census counts or completion claims", async ({ page }) => {
  await serve(page, [entry({ portalSearch: { outcome: "not_found", checkedAt: DAY, candidateCount: 0, method: "full-index" } })], { census: false });
  await page.goto(`/p/${PROGRAM}`);
  await expect(panel(page)).toContainText("신청서 찾는 중");
  await expect(panel(page).getByTestId("forms-portal-search")).toContainText("담당기관 공고에 서식이 따로 있을 수 있어요");
  await expect(panel(page).getByTestId("forms-investigation")).toHaveCount(0);
  await expect(panel(page).getByRole("link", { name: /원본 받기|서식 보기·인쇄/ })).toHaveCount(0);
  await page.goto("/forms");
  await expect(page.getByText("경기도 고양시 수록 1건 중 현재 조건 1건")).toBeVisible();
  await expect(page.getByTestId("forms-investigation-summary")).toHaveCount(0);
  await expect(page.getByTestId("forms-stage-filter")).toHaveCount(0);
  await expect(page.getByTestId("forms-row-stage")).toHaveCount(0);
  await expect(page.getByText("법령포털 서식 목록 대조에서 연결 후보를 찾지 못했습니다. 신청서가 없거나 지원 대상이 아니라는 뜻은 아닙니다.")).toBeVisible();
});

test("automatic and institution stages keep the need to check application procedures explicit", async ({ page }) => {
  for (const state of ["automatic", "institution"] as const) {
    await page.unrouteAll();
    await serve(page, [entry({ applyType: state === "automatic" ? "auto" : "institution", investigation: investigation({ state }) })]);
    await page.goto(`/p/${PROGRAM}`);
    const census = panel(page).getByTestId("forms-investigation");
    await expect(census.getByRole("heading")).toContainText(state === "automatic" ? "자동 지원 방식 — 확인 필요" : "기관 추천 방식 — 확인 필요");
    await expect(census).toContainText("신청서가 필요 없다는 뜻은 아니며");
    await expect(census).toContainText(state === "automatic" ? "별도 신청이 필요한지 담당기관에 확인" : "추천 절차와 서류를 담당기관에 확인");
    await expect(panel(page).getByRole("link", { name: /원본 받기|서식 보기·인쇄/ })).toHaveCount(0);
  }
});

test("long material names and expanded investigation stay within a narrow mobile viewport @mobile", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const filename = `신청서_${"ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(5)}.hwpx`;
  const documentName = `준비서류_${"1234567890".repeat(14)}`;
  await serve(page, [entry({ name: `공식첨부자료_${"아주긴혜택이름".repeat(20)}`, investigation: attachmentInvestigation({
    documentNames: [documentName], documentNameTotal: 23, sourceLinkTotal: 35,
    sourceLinks: [
      { kind: "attachment", title: filename, url: ATTACHMENT },
      { kind: "official_page", title: "담당기관 사업 안내", url: OFFICIAL_PAGE },
    ],
  }) })]);
  await page.goto("/forms");
  await expect(page.getByTestId("forms-investigation-summary")).toBeVisible();
  await page.getByLabel("확인 단계", { exact: true }).selectOption("attachment_found");
  await expect(page.getByTestId("forms-row-stage")).toHaveCount(1);
  await noHorizontalOverflow(page);
  await page.goto(`/p/${PROGRAM}`);
  const section = panel(page);
  await expect(section.getByRole("link", { name: new RegExp(filename.replace(".", "\\.")) })).toBeVisible();
  await section.getByTestId("forms-investigation-detail").locator("summary").click();
  await expect(section.getByTestId("forms-source-attachments")).toContainText("모두 35건이고, 그중 2건");
  await expect(section.getByTestId("forms-document-names")).toContainText("모두 23건 중 1건");
  await noHorizontalOverflow(page, section);
});

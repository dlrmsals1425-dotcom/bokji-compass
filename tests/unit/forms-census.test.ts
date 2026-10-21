import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  CENSUS_LIMITS, FORM_STATUS_LABEL, INVESTIGATION_LABEL, INVESTIGATION_NOTE, INVESTIGATION_STATES,
  censusLinkConflict, countInvestigationStates, investigationProgressLines, normalizeCensus, publicSourceUrl,
  type CensusSummary, type FormsRegionBundle, type Investigation, type ProgramFormEntry,
} from "@/lib/data/forms";

const PAGE = "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00004751";
const FILE = "https://www.goyang.go.kr/www/selectBbsNttFile.do?nttSn=4211";
const ids = ["g41280.gov24-394000000111", "n.gov24-135200005031"];

function investigation(patch: Partial<Investigation> = {}): Investigation {
  return {
    state: "needs_source", checkedAt: "2026-10-16", applicationMentioned: false, documentNames: [],
    lawChecks: { searched: 2, read: 1, failed: 1 }, pageChecks: { attempted: 1, read: 1, failed: 0 },
    sourceLinks: [{ title: "사업 안내", url: PAGE, kind: "official_page" }], ...patch,
  };
}
/** 조사 입력 한 벌 — summary 는 programs 와 맞아떨어지게 계산하고, 검사하려는 값만 patch 로 흔든다. */
function doc(programs: Record<string, Investigation>, patch: Partial<CensusSummary> & { schema?: unknown; checkedAt?: unknown } = {}) {
  const rows = Object.values(programs);
  const sum = (pick: (row: Investigation) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const { schema = 1, checkedAt = "2026-10-16", ...summary } = patch;
  return {
    schema, checkedAt, programs,
    summary: {
      totalPrograms: rows.length,
      counts: Object.fromEntries(INVESTIGATION_STATES.map(state => [state, rows.filter(row => row.state === state).length])) as CensusSummary["counts"],
      lawQueries: sum(row => row.lawChecks.searched), lawBodiesRead: sum(row => row.lawChecks.read), lawFailures: sum(row => row.lawChecks.failed),
      pageUrls: sum(row => row.pageChecks.attempted + (row.pageChecks.unattempted ?? 0)), pagesRead: sum(row => row.pageChecks.read), pageFailures: sum(row => row.pageChecks.failed),
      officialAttachments: new Set(rows.flatMap(row => row.sourceLinks.filter(link => link.kind === "attachment").map(link => link.url))).size,
      ...summary,
    },
  };
}
const both = (patch: Partial<Investigation> = {}) => Object.fromEntries(ids.map(id => [id, investigation(patch)]));

describe("census input covers every program record or fails", () => {
  it("keeps every record and the supplied summary when the input is complete", () => {
    const census = normalizeCensus(doc(both()), ids);
    expect(census.checkedAt).toBe("2026-10-16");
    expect([...census.programs.keys()].sort()).toEqual([...ids].sort());
    expect(census.summary.totalPrograms).toBe(2);
    expect(census.summary.counts.needs_source).toBe(2);
  });
  it("refuses an input that drops, duplicates or invents a program record", () => {
    expect(() => normalizeCensus(doc({ [ids[0]]: investigation() }, { totalPrograms: 2 }), ids)).toThrow(/covers 1 of 2/);
    // 같은 ID 가 두 번 적힌 JSON 은 한 건으로 합쳐지므로 건수 부족으로 걸린다.
    const duplicated = JSON.parse(`{"schema":1,"checkedAt":"2026-10-16","summary":${JSON.stringify(doc(both()).summary)},
      "programs":{"${ids[0]}":${JSON.stringify(investigation())},"${ids[0]}":${JSON.stringify(investigation())}}}`);
    expect(() => normalizeCensus(duplicated, ids)).toThrow(/every record must be present exactly once/);
    expect(() => normalizeCensus(doc({ ...both(), "g99999.unknown-1": investigation() }, { totalPrograms: 2 }), ids)).toThrow(/not published/);
    expect(() => normalizeCensus(doc(both(), { totalPrograms: 3 }), ids)).toThrow(/does not match the 2 published program records/);
  });
  it("refuses a summary that disagrees with the rows it claims to count", () => {
    expect(() => normalizeCensus(doc(both(), { counts: { ...doc(both()).summary.counts, needs_source: 1, confirmed: 1 } }), ids)).toThrow(/summary.counts.confirmed is 1 but 0 programs/);
    expect(() => normalizeCensus(doc(both(), { officialAttachments: 5 }), ids)).toThrow(/officialAttachments is 5 but 0 distinct attachment source URLs/);
    expect(() => normalizeCensus(doc(both(), { schema: 2 }), ids)).toThrow(/schema must be 1/);
    expect(() => normalizeCensus(doc(both(), { checkedAt: "2026-10" }), ids)).toThrow(/checkedAt must be a YYYY-MM-DD date/);
  });
});

describe("failed reads stay counted and never turn into an absence claim", () => {
  it("keeps unidentifiable citations separate from queried law bodies", () => {
    const rows=both({lawChecks:{searched:0,read:0,failed:0,unresolvedCitations:2}});
    const census=normalizeCensus(doc(rows,{lawUnresolvedCitations:4}),ids);
    expect(census.summary.lawQueries).toBe(0);
    expect(investigationProgressLines({...census.summary,checkedAt:census.checkedAt}).join(" ")).toContain("인용 4건은 법규명을 특정하지 못했어요");
    expect(()=>normalizeCensus(doc(rows,{lawUnresolvedCitations:0}),ids)).toThrow(/citation issues/);
  });
  it("keeps per-program law and page failure counters", () => {
    const census = normalizeCensus(doc(both({ lawChecks: { searched: 7, read: 2, failed: 5 }, pageChecks: { attempted: 4, read: 1, failed: 3 } })), ids);
    const row = census.programs.get(ids[0])!;
    expect(row.lawChecks).toEqual({ searched: 7, read: 2, failed: 5 });
    expect(row.pageChecks).toEqual({ attempted: 4, read: 1, failed: 3, unattempted: 0 });
    expect(census.summary.lawFailures).toBe(10);
    expect(census.summary.pageFailures).toBe(6);
  });
  it("rejects counters that claim more reads or failures than attempts", () => {
    expect(() => normalizeCensus(doc(both({ lawChecks: { searched: 1, read: 2, failed: 0 } })), ids)).toThrow(/exceed/);
    expect(() => normalizeCensus(doc(both({ pageChecks: { attempted: 1, read: 0, failed: 9 } })), ids)).toThrow(/exceed/);
    expect(() => normalizeCensus(doc(both(), { lawBodiesRead: 99 }), ids)).toThrow(/summary law reads\/failures exceed/);
    expect(() => normalizeCensus(doc(both(), { pagesRead: 99 }), ids)).toThrow(/summary page reads\/failures exceed/);
    expect(() => normalizeCensus(doc(both(), { lawQueries: -1 }), ids)).toThrow(/non-negative integer/);
  });
  it("host-blocked unattempted addresses remain accounted for without fake requests", () => {
    const census = normalizeCensus(doc(both({ pageChecks: { attempted: 0, read: 0, failed: 1, unattempted: 1 } })), ids);
    expect(census.programs.get(ids[0])!.pageChecks).toEqual({ attempted: 0, read: 0, failed: 1, unattempted: 1 });
    expect(census.summary.pageFailures).toBe(2);
  });
  it("says what was actually read, separates index matching from body reads, and shows failures", () => {
    const lines = investigationProgressLines({ ...doc(both()).summary as CensusSummary, lawQueries: 23578, lawBodiesRead: 4120, lawFailures: 311, pageUrls: 9000, pagesRead: 8400, pageFailures: 600, officialAttachments: 120, checkedAt: "2026-10-16" });
    const text = lines.join(" ");
    expect(text).toContain("4,120건을 실제로 열어 읽었어요");
    expect(text).toContain("311건은 열지 못했어요");
    expect(text).toContain("600건은 열지 못했어요");
    expect(text).toContain("목록만 맞춰 본 것과, 본문을 실제로 열어 읽은 것을 나누어 적어요");
    expect(text).not.toMatch(/모두 읽었|전수 확인 완료|신청서가 없/);
    // 실패가 0 일 때도 '없다'가 아니라 '열지 못한 자료는 없어요'로만 적는다.
    expect(investigationProgressLines({ ...doc(both()).summary as CensusSummary, lawFailures: 0, pageFailures: 0, checkedAt: "2026-10-16" }).join(" ")).toContain("열지 못한 자료는 없어요");
  });
});

describe("investigation states say what was found, not that nothing exists", () => {
  it("document_mentioned is evidence of paperwork, not its absence", () => {
    expect(() => normalizeCensus(doc(both({ state: "document_mentioned" })), ids)).toThrow(/document_mentioned without any mentioned document/);
    const census = normalizeCensus(doc(both({ state: "document_mentioned", applicationMentioned: true, documentNames: ["신청서", "주민등록등본"] })), ids);
    expect(census.programs.get(ids[0])!.documentNames).toEqual(["신청서", "주민등록등본"]);
    expect(INVESTIGATION_NOTE.document_mentioned).toContain("적혀 있어요");
    expect(INVESTIGATION_NOTE.document_mentioned).not.toContain("없");
    expect(INVESTIGATION_LABEL.document_mentioned).not.toContain("없");
  });
  it("automatic and institution are their own states and never mean no form is needed", () => {
    for (const state of ["automatic", "institution"] as const) {
      expect(INVESTIGATION_NOTE[state]).toContain("신청서가 필요 없다는 뜻은 아니며");
      expect(INVESTIGATION_LABEL[state]).toContain("확인 필요");
      const census = normalizeCensus(doc(both({ state })), ids);
      expect(census.summary.counts[state]).toBe(2);
      expect(census.summary.counts.needs_source).toBe(0);
    }
    expect(new Set(Object.values(INVESTIGATION_LABEL)).size).toBe(INVESTIGATION_STATES.length);
  });
  it("every label and note keeps the door open and 'missing' now reads as pending", () => {
    expect(Object.keys(FORM_STATUS_LABEL)).toEqual(["available", "online", "review", "missing"]);
    expect(FORM_STATUS_LABEL.missing).toBe("신청서 찾는 중");
    expect(FORM_STATUS_LABEL.missing).not.toMatch(/미확보|없/);
    for (const state of INVESTIGATION_STATES) {
      expect(INVESTIGATION_NOTE[state]).not.toMatch(/신청서가 없(어요|습니다|다)[.!。]|서식이 없(어요|습니다|다)[.!。]|해당 없음/);
      expect(INVESTIGATION_LABEL[state].length).toBeLessThanOrEqual(16);
    }
    expect(INVESTIGATION_NOTE.needs_source).toContain("신청서가 없다는 뜻은 아니에요");
  });
});

describe("official attachments stay separate from approved applications", () => {
  it("attachment_found needs a real attachment on the same official page and keeps it first", () => {
    expect(() => normalizeCensus(doc(both({ state: "attachment_found" })), ids)).toThrow(/attachment_found without an attachment source link/);
    const links = [{ title: "사업 안내", url: PAGE, kind: "official_page" as const }, { title: "2026년 신청서(한글).hwp", url: FILE, kind: "attachment" as const }];
    const census = normalizeCensus(doc(both({ state: "attachment_found", sourceLinks: links })), ids);
    const row = census.programs.get(ids[0])!;
    expect(row.sourceLinks[0]).toEqual({ title: "2026년 신청서(한글).hwp", url: FILE, kind: "attachment" });
    expect(census.summary.officialAttachments).toBe(1);
    // 첨부자료는 승인된 FormLink 가 아니다 — 연결 확인(confirmed)으로 올라가지 않는다.
    expect(row.state).toBe("attachment_found");
    expect(censusLinkConflict(ids[0], row, false)).toBeNull();
    expect(INVESTIGATION_NOTE.attachment_found).toContain("확인 중");
  });
  it("an approved link and a census state cannot contradict each other", () => {
    expect(censusLinkConflict(ids[0], investigation({ state: "needs_source" }), true)).toMatch(/approved application links but census state is needs_source/);
    expect(censusLinkConflict(ids[0], investigation({ state: "attachment_found", sourceLinks: [{ title: "서식", url: FILE, kind: "attachment" }] }), true)).toMatch(/census state is attachment_found/);
    expect(censusLinkConflict(ids[0], investigation({ state: "confirmed" }), false)).toMatch(/census-confirmed but has no approved application link/);
    expect(censusLinkConflict(ids[0], investigation({ state: "confirmed" }), true)).toBeNull();
  });
  it("only credential-free public http(s) sources are published", () => {
    expect(publicSourceUrl(PAGE)).toBe(PAGE);
    expect(publicSourceUrl("http://www.goyang.go.kr/board.do")).toBe("http://www.goyang.go.kr/board.do");
    expect(publicSourceUrl("https://www.goyang.go.kr/page?key=123")).toBe("https://www.goyang.go.kr/page?key=123");
    expect(publicSourceUrl("https://www.cbfc.or.kr/home/sub.php?menukey=6441")).toBe("https://www.cbfc.or.kr/home/sub.php?menukey=6441");
    for (const bad of ["javascript:alert(1)", "file:///C:/forms/a.hwp", "ftp://law.go.kr/a.hwp", "https://user:pw@law.go.kr/a.hwp",
      "https://www.law.go.kr/flDownload.do?OC=secret", "https://example.go.kr/a.do?serviceKey=abc", "https://example.go.kr/a.do?resident=900101", "http://127.0.0.1/file", "https://localhost./x", "https://intranet.local/x", "https://www.goyang.go.kr/page?key=secret", "/forms/files/ordin-1.hwp", 42, null]) {
      expect(publicSourceUrl(bad)).toBeNull();
    }
    expect(() => normalizeCensus(doc(both({ sourceLinks: [{ title: "안내", url: "https://www.law.go.kr/x.do?OC=secret", kind: "official_page" }] })), ids))
      .toThrow(/not a public credential-free http\(s\) source/);
  });
  it("long titles and long lists are clamped but their real size is kept", () => {
    const many = [
      ...Array.from({ length: 4 }, (_, index) => ({ title: `첨부 ${index}`, url: `${FILE}&i=${index}`, kind: "attachment" as const })),
      ...Array.from({ length: CENSUS_LIMITS.sourceLinks + 5 }, (_, index) => ({ title: `안내 ${index}`, url: `${PAGE}&i=${index}`, kind: "official_page" as const })),
    ];
    const row = normalizeCensus(doc(both({
      state: "attachment_found", sourceLinks: many, note: "가".repeat(CENSUS_LIMITS.note + 50),
      documentNames: Array.from({ length: CENSUS_LIMITS.documentNames + 3 }, (_, index) => `서류${index} ${"나".repeat(CENSUS_LIMITS.documentName + 20)}`),
    })), ids).programs.get(ids[0])!;
    expect(row.sourceLinks).toHaveLength(CENSUS_LIMITS.sourceLinks);
    expect(row.sourceLinkTotal).toBe(many.length);
    expect(row.sourceLinks.filter(link => link.kind === "attachment")).toHaveLength(4);
    expect(row.documentNames).toHaveLength(CENSUS_LIMITS.documentNames);
    expect(row.documentNameTotal).toBe(CENSUS_LIMITS.documentNames + 3);
    expect(row.documentNames[0]).toHaveLength(CENSUS_LIMITS.documentName);
    expect(row.documentNames[0].endsWith("…")).toBe(true);
    expect(row.note).toHaveLength(CENSUS_LIMITS.note);
  });
});

describe("page totals, stage filtering and old fixtures", () => {
  const entry = (patch: Partial<ProgramFormEntry>): ProgramFormEntry =>
    ({ id: "g41280.a", name: "사업", areaKey: "g41280", status: "missing", links: [], candidateFormIds: [], ...patch });
  it("counts stages only for records that were actually investigated", () => {
    const counted = countInvestigationStates([
      entry({ investigation: investigation({ state: "confirmed" }) }),
      entry({ investigation: investigation({ state: "needs_source" }) }),
      entry({ investigation: investigation({ state: "needs_source" }) }),
      entry({}),
    ]);
    expect(counted.investigated).toBe(3);
    expect(counted.tally.needs_source).toBe(2);
    expect(counted.tally.confirmed).toBe(1);
    expect(counted.tally.candidate).toBe(0);
    expect(Object.keys(counted.tally)).toEqual(INVESTIGATION_STATES);
    expect(countInvestigationStates([entry({}), entry({})]).investigated).toBe(0);
  });
  it("entries and coverage without census data stay valid and claim no inspection", () => {
    const old = entry({ status: "online", applyUrl: "https://www.gov.kr/apply" });
    expect(old.investigation).toBeUndefined();
    expect(countInvestigationStates([old]).investigated).toBe(0);
    const bundle: FormsRegionBundle = JSON.parse(readFileSync(path.join(process.cwd(), "public/forms/v1/programs/g41280.json"), "utf8"));
    for (const program of bundle.programs) {
      expect(FORM_STATUS_LABEL[program.status]).toBeTruthy();
      if (program.investigation) expect(INVESTIGATION_STATES).toContain(program.investigation.state);
    }
    expect(countInvestigationStates(bundle.programs).investigated).toBe(bundle.programs.filter(program => program.investigation).length);
  });
});

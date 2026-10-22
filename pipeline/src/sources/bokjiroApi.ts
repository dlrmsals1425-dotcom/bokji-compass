import type { SourceRecord } from "./record";
import { financialBadge, isEupmyeondongLevel } from "./record";
import { cleanName, cleanOrg, cleanText, nameKey } from "../normalize/names";
import { asCategory } from "../normalize/categories";
import type { RegionIndex, Sido, Sigungu } from "../normalize/regions";
import { householdCond, lifecycleCond } from "../rules/fromTags";
import { extractFromText } from "../rules/fromText";
import { all } from "../rules/helpers";
import { listFetchedAt, readDetail, readList, type Kind } from "../bokjiro/ingest";
import type { Cond } from "../../../src/lib/engine/types";

/**
 * 복지로 OpenAPI(중앙부처 15090532 · 지자체 15108347) 캐시 → 복지로 색인 레코드 보강 + 색인에 없는 신규 서비스 추가.
 * - 같은 WLF ID: 지원대상·선정기준·지원내용·신청방법·문의처·근거법령·최종수정일을 API 값으로 채운다.
 * - 생애주기·가구상황 배열이 있으면 태그 규칙을 다시 만든다.
 */
const arr = (v: unknown): string[] =>
  String(v ?? "").split(/,\s*/).map((x) => x.replace(/\s*·\s*/g, "·").trim()).filter(Boolean);
const ymd = (v: unknown) => {
  const s = String(v ?? "");
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : undefined;
};
type Item = { nm?: string; val?: string };
function items(list: unknown): Item[] {
  return ((list as Record<string, string>[]) ?? []).map((x) => ({
    nm: cleanText(x.servSeDetailNm ?? x.wlfareInfoReldNm)?.trim(),
    val: cleanText(x.servSeDetailLink ?? x.wlfareInfoReldCn)?.trim(),
  }));
}

export interface BokjiroApiStats {
  list: Record<Kind, number>;
  detail: Record<Kind, number>;
  enriched: number;
  added: number;
  indexOnly: number;
}

/**
 * 담당 부서 이름('경기도 가평군 평생교육사업소')에 든 시군구 — 목록에 시군구(sggNm) 칸이 빈 지자체 사업용 (2026-10-22).
 * 시·도 다음 낱말이 시·군·구로 끝나고 그 시·도의 시군구일 때만. 시·도 본청 부서('서울특별시 복지실 …')는 빈 배열.
 */
export function sigunguFromDept(regions: RegionIndex, sidoName: string, dept: string): Sigungu[] {
  const sido = regions.sido(sidoName);
  if (!sido) return [];
  const toks = dept.trim().split(/\s+/);
  const rest = regions.sido(toks[0] ?? "")?.code === sido.code ? toks.slice(1) : toks;
  const [a, b] = rest;
  if (!a || !/(시|군|구)$/.test(a)) return [];
  if (b && /구$/.test(b)) {
    const both = regions.resolveSigungu(sido.name, `${a} ${b}`);
    if (both.length) return both;
  }
  return regions.resolveSigungu(sido.name, a);
}

/**
 * 지자체 사업의 지역 범위: 시군구 칸 → (비면) 담당 부서 이름의 시군구 → 시·도 사업.
 * 시군구 칸에 시·도 교육청처럼 시·도 이름으로 시작하는 기관명이나 '○○교육청'이 오면 시·도 사업, '-'는 빈 칸. 모르는 시군구 이름이면 null.
 */
export function localScope(regions: RegionIndex, sido: Sido, sggNm: string, dept: string):
  { scope: SourceRecord["scope"]; orgType: SourceRecord["orgType"]; sigunguCodes?: string[]; regionLabel: string } | null {
  const sg = sggNm.trim().replace(/^-+$/, "");
  const sgg = (list: Sigungu[]) => ({ scope: "sigungu" as const, orgType: "local" as const, sigunguCodes: list.map((s) => s.code), regionLabel: `${sido.short} ${list.map((s) => s.name).join("·")}` });
  const whole = { scope: "sido" as const, orgType: "metro" as const, regionLabel: sido.name };
  if (!sg) {
    if (sido.code === "36000") return { scope: "sigungu", orgType: "metro", sigunguCodes: ["36110"], regionLabel: "세종" };
    const fromDept = sigunguFromDept(regions, sido.name, dept);
    return fromDept.length ? sgg(fromDept) : whole;
  }
  const sggs = regions.resolveSigungu(sido.name, sg);
  if (sggs.length) return sgg(sggs);
  if (sg.startsWith(sido.name) || sg.startsWith(sido.short) || /교육청$/.test(sg)) return whole;
  return null;
}

export function applyBokjiroApi(index: SourceRecord[], regions: RegionIndex, log: (m: string) => void): { records: SourceRecord[]; stats: BokjiroApiStats } {
  const stats: BokjiroApiStats = { list: { central: 0, local: 0 }, detail: { central: 0, local: 0 }, enriched: 0, added: 0, indexOnly: 0 };
  const byId = new Map(index.filter((r) => r.source === "bokjiro").map((r) => [r.sourceId, r]));
  const out = [...index];
  const seen = new Set<string>();
  for (const kind of ["central", "local"] as Kind[]) {
    const list = readList(kind);
    stats.list[kind] = list.length;
    const fetchedAt = listFetchedAt(kind) ?? new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
    for (const row of list) {
      const id = String(row.servId);
      if (seen.has(id)) continue;
      seen.add(id);
      const d = readDetail(kind, id) ?? {};
      if (Object.keys(d).length) stats.detail[kind]++;
      const get = (k: string) => cleanText((d[k] ?? (row as Record<string, unknown>)[k]) as string | undefined);
      const life = arr(d.lifeArray ?? d.lifeNmArray ?? row.lifeNmArray);
      const hh = arr(d.trgterIndvdlArray ?? d.trgterIndvdlNmArray ?? row.trgterIndvdlNmArray);
      const themes = arr(d.intrsThemaArray ?? d.intrsThemaNmArray ?? row.intrsThemaArray ?? row.intrsThemaNmArray);
      const applyLines = items(d.applmetList).map((x) => x.val).filter(Boolean) as string[];
      const applyMethod = [get("aplyMtdCn"), ...applyLines].filter(Boolean).join("\n") || (get("aplyMtdNm") ? `신청 방법: ${get("aplyMtdNm")}` : undefined);
      const contacts = items(d.inqplCtadrList).filter((x) => x.val).map((x) => (x.nm ? `${x.nm} ${x.val}` : x.val!));
      const rprs = get("rprsCtadr");
      if (rprs && !contacts.some((c) => c.includes(rprs))) contacts.unshift(`대표 문의 ${rprs}`);
      const homepages = items(d.inqplHmpgReldList).filter((x) => x.val && /^https?:/.test(x.val));
      const laws = items(d.baslawList).map((x) => x.nm).filter(Boolean) as string[];
      const forms = items(d.basfrmList).map((x) => x.nm).filter(Boolean) as string[];
      const patch: Partial<SourceRecord> = {
        target: get("tgtrDtlCn") ?? get("sprtTrgtCn"),
        criteria: get("slctCritCn"),
        benefit: get("alwServCn"),
        applyMethod,
        applyChannel: get("aplyMtdNm"),
        supportType: cleanText(String(d.srvPvsnNm ?? row.srvPvsnNm ?? "")) || undefined,
        contact: contacts.length ? contacts.join("\n") : undefined,
        documents: forms.length ? `관련 서식·안내: ${forms.join(", ")}` : undefined,
        applyUrl: homepages[0]?.val,
        laws: laws.length ? laws : undefined,
        updatedAt: ymd(d.lastModYmd ?? row.lastModYmd) ?? (d.crtrYr ? `${d.crtrYr}` : undefined),
        fetchedAt,
        url: cleanText(row.servDtlLink)?.replace(/&amp;/g, "&"),
      };
      // 생애주기·가구상황 태그 규칙 (+ 이름에 드러난 대상)
      const lc = lifecycleCond(life);
      const hc = householdCond(hh);
      const name = cleanName(String(row.servNm ?? ""));
      const fromName = extractFromText(name);
      const parts = [lc, hc, fromName.matched.length ? fromName.logic : null].filter(Boolean) as Cond[];
      const tagLogic = parts.length ? (parts.length === 1 ? parts[0] : all(...parts)) : null;

      const existing = byId.get(id);
      if (existing) {
        for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== "") (existing as unknown as Record<string, unknown>)[k] = v;
        existing.owner = cleanOrg(get("jurMnofNm") ?? get("bizChrDeptNm")) ?? existing.owner;
        existing.tags = [...new Set([...existing.tags, ...themes, ...life, ...hh])];
        if (tagLogic && (existing.draft.origin === "none" || existing.draft.origin === "text_extract")) {
          existing.draft = { origin: "bokjiro_tags", logic: tagLogic, unstructured: [], core: false };
        }
        existing.trust = "A";
        stats.enriched++;
        continue;
      }
      // 색인에 없는 신규 서비스
      let scope: SourceRecord["scope"] = "national";
      let orgType: SourceRecord["orgType"] = "central";
      let sidoCode: string | undefined, sigunguCodes: string[] | undefined, regionLabel: string | undefined;
      if (kind === "local") {
        const sido = regions.sido(String(row.ctpvNm ?? ""));
        if (!sido) { log(`[bokjiro-api] 시도 매핑 실패: ${row.ctpvNm} (${id})`); continue; }
        sidoCode = sido.code;
        const loc = localScope(regions, sido, String(row.sggNm ?? ""), String(row.bizChrDeptNm ?? ""));
        if (!loc) { log(`[bokjiro-api] 시군구 매핑 실패: ${row.ctpvNm} ${row.sggNm} (${id})`); continue; }
        ({ scope, orgType, sigunguCodes, regionLabel } = loc);
      }
      const summary = cleanText(row.servDgst ?? d.wlfareInfoOutlCn) ?? "";
      let draft: SourceRecord["draft"] = { origin: "none", logic: null, unstructured: [], core: false };
      if (tagLogic) draft = { origin: "bokjiro_tags", logic: tagLogic, unstructured: [], core: false };
      else {
        const tx = extractFromText(patch.target ?? summary);
        if (tx.logic) draft = { origin: "text_extract", logic: tx.logic, unstructured: tx.unstructured, core: tx.core };
      }
      const provision = arr(row.srvPvsnNm);
      const rec: SourceRecord = {
        source: "bokjiro", sourceId: id, name, key: nameKey(name), summary,
        orgType, scope, sidoCode, sigunguCodes, regionLabel,
        owner: cleanOrg(get("jurMnofNm") ?? get("bizChrDeptNm")) ?? regionLabel,
        category: asCategory(themes[0] ?? ""),
        tags: [...new Set([...themes, ...life, ...hh])],
        provision,
        trust: "A",
        badges: financialBadge(name, provision) ? ["financial"] : [],
        draft,
        ...(patch as Pick<SourceRecord, "fetchedAt">),
      };
      if (kind === "local" && isEupmyeondongLevel(name, String(row.sggNm ?? ""))) rec.excluded = "eupmyeondong_level";
      out.push(rec);
      stats.added++;
    }
  }
  stats.indexOnly = [...byId.keys()].filter((id) => !seen.has(id)).length;
  return { records: out, stats };
}

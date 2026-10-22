import type { SourceRecord } from "./sources/record";
import type { LocalOperation } from "../../src/lib/data/types";
import { nameKey, nameQualifier } from "./normalize/names";

/**
 * 중복 제거·교차 원천 병합 (설계서 5.5·5.6).
 *  D1 완전 중복 / D2 실질 중복 (통합돌봄 내부)
 *  M2 강한 후보 자동 병합: 명칭 키(+괄호 부가설명) 일치 + 기관 수준 일치 + 지역 일치
 *  차단: 기관 수준(중앙 vs 지자체)이 다르거나 지역이 다르면 병합 금지
 *  통합돌봄 '전국' 행이 전국 사업과 같은 명칭이면 별도 카드 대신 '우리 지역 운영 정보'로 붙인다
 */

export interface DedupStats {
  d1Exact: number;
  d2Substantive: number;
  crossMerged: { pair: string; count: number }[];
  absorbedAsLocalOps: number;
  /** 검토표에서 묶기로 정한 전국 사업이 이번 데이터에 없어 지역 사업으로 둔 메뉴판 행 */
  menuTargetMissing?: string[];
  blockedByLevel: number;
  /** 정부24·복지로 시군구 등록분 중 전국 사업의 지역 집행분으로 흡수한 수 */
  absorbedRegionalCopies?: number;
  /** 이름·법령은 같지만 지역 추가사업 표지·설명 차이로 흡수하지 않고 별도 사업으로 둔 수 */
  keptRegionalAddons?: number;
  /** 점검용 표본: 흡수/유지 판단 (사유·유사도) */
  regionalCopySamples?: { decision: "absorb" | "keep"; reason: string; sim: number; nat: string; local: string; region?: string }[];
}

/* ---------- 지역 집행분(복사본) vs 지역 추가사업 판별 ---------- */

/** 이름에 붙으면 '지자체가 따로 얹은 사업'임을 뜻하는 표지 */
const ADDON_NAME_RE = /(추가|지자체|자체|특화|확대|가산|소득무관|도비|시비|군비|구비|본인부담|차액|플러스|\+|[가-힣]{2,}형(?=\s|\(|$))/;
/** 설명문에서 지역 추가사업을 뜻하는 표현 */
const ADDON_TEXT_RE = /(자체\s*(사업|예산|재원|지원)|(시|군|구|도)\s*자체|추가\s*(지원|지급|급여|제공)|추가로\s*(지원|지급)|별도\s*(지원|지급)|도비|시비|군비|구비|특화\s*사업|차액\s*지원|본인부담(금)?\s*(지원|경감))/;

/** 설명문에 흔한 서술어·기능어 — 유사도를 부풀리지 않게 뺀다 */
const FILLER_RE = /(합니다|됩니다|입니다|습니다|있는|하는|위한|위하여|대상|지원|사업|서비스|제공|및|등|또는|경우|으로|에게)/g;
function bigrams(s: string): Map<string, number> {
  const t = s.replace(FILLER_RE, " ").replace(/[^0-9A-Za-z가-힣]/g, "");
  const m = new Map<string, number>();
  for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
}
/** 글자 2-gram Dice 유사도 (0~1) */
export function textSimilarity(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b);
  let inter = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  if (!na || !nb) return 0;
  for (const [g, v] of A) inter += Math.min(v, B.get(g) ?? 0);
  return (2 * inter) / (na + nb);
}

export function lawsOverlap(a?: string[], b?: string[]): boolean {
  const norm = (x: string) => x.replace(/\s+/g, "").replace(/[(（].*$/, "").replace(/\|\|.*$/, "");
  const A = new Set((a ?? []).flatMap((x) => x.split("||")).map(norm).filter((x) => x.length > 3));
  return (b ?? []).flatMap((x) => x.split("||")).map(norm).some((x) => A.has(x));
}

const descOf = (r: SourceRecord, tokens: string[] = []) => {
  let t = [r.summary, r.target, r.benefit].filter(Boolean).join(" ").slice(0, 700);
  for (const k of tokens) t = t.split(k).join(" ");
  return t;
};

/** 설명 유사도 하한: 이보다 낮으면 같은 사업의 지역 집행분으로 보지 않는다 (전국 236쌍 표본으로 보정: 같은 사업도 지역 설명은 표현이 크게 달라 낮게 둔다 — 추가사업은 주로 이름·설명 표지로 거른다) */
export const COPY_SIM_MIN = 0.06;

/**
 * 시군구 등록분 r 이 전국 사업 nat 의 '지역 집행분(같은 사업)'인지 판별.
 * 조건: 이름 정규화 일치 + 근거 법령 겹침 + 이름·설명에 지역 추가사업 표지 없음 + 설명 유사도 ≥ COPY_SIM_MIN.
 * 하나라도 어긋나면 별도의 지역 사업으로 남긴다 (예: '장애인 활동지원(추가)').
 */
export function regionalCopyCheck(nat: SourceRecord, r: SourceRecord, tokens: string[] = []): { ok: boolean; reason: string; sim: number } {
  const rk = regionlessKey(r.name, tokens);
  if (r.key !== nat.key && rk !== nat.key) return { ok: false, reason: "이름 불일치", sim: 0 };
  if (!lawsOverlap(nat.laws, r.laws)) return { ok: false, reason: "근거 법령 불일치", sim: 0 };
  const strip = (s: string) => s.replace(/\s+/g, "");
  const nm = r.name.match(ADDON_NAME_RE);
  if (nm && !strip(nat.name).includes(strip(nm[0]))) return { ok: false, reason: `이름 표지 '${nm[0]}'`, sim: 0 };
  const natText = [nat.summary, nat.target, nat.benefit].filter(Boolean).join(" ");
  const rText = [r.summary, r.target, r.benefit].filter(Boolean).join(" ");
  const tm = rText.match(ADDON_TEXT_RE);
  if (tm && !ADDON_TEXT_RE.test(natText)) return { ok: false, reason: `설명 표지 '${tm[0]}'`, sim: 0 };
  const da = descOf(nat), db = descOf(r, tokens);
  // 설명이 비어 있으면 이름·법령만으로 판단 (집행분 등록은 흔히 설명이 짧다)
  if (!db.trim() || !da.trim()) return { ok: true, reason: "설명 없음(이름·법령 일치)", sim: 0 };
  const sim = textSimilarity(da, db);
  if (sim < COPY_SIM_MIN) return { ok: false, reason: "설명 유사도 낮음", sim };
  return { ok: true, reason: "이름·법령·설명 일치", sim };
}

export const mergeKey = (r: SourceRecord) => `${r.key}|${nameQualifier(r.name) ?? ""}`;

const regionKey = (r: SourceRecord) => (r.sigunguCodes?.length ? `g:${[...r.sigunguCodes].sort().join(",")}` : r.sidoCode ? `s:${r.sidoCode}` : "n");

const LEVEL: Record<string, string> = { central: "N", public_inst: "N", metro: "R", local: "R", edu_office: "E", other: "O" };
const level = (r: SourceRecord) => (r.orgType === "public_inst" && r.scope !== "national" ? "P" : LEVEL[r.orgType]);

/**
 * 지역 사업 비교용 이름 키: 앞머리 지역명('수원시 ', '(수원시 권선구) ', '수원형 ')과 지역명만 든 괄호를 떼고,
 * 흔한 꼬리말('지급', '운영', '안내', '지원금')까지 정리한다. 같은 시군구 안에서만 비교하므로 충돌 위험이 낮다.
 */
/** 표시용 이름: 지역명만 든 괄호('(수원시)', '(수원시 장안구)', '(장안구)')를 뗀다 — 지역은 배지로 보여 준다 */
export function regionDisplayName(name: string, tokens: string[]): string {
  const isRegionTok = (t: string) => tokens.includes(t) || /^[가-힣]{1,4}구$/.test(t) || (/^[가-힣]{1,5}(시|군)$/.test(t) && tokens.some((x) => t.startsWith(x)));
  const out = name
    .replace(/\s*[(（]([^)）]*)[)）]\s*/g, (m, inner: string) => {
      const parts = inner.trim().split(/\s+/).filter(Boolean);
      return parts.length && parts.every(isRegionTok) ? " " : m;
    })
    .replace(/\s+/g, " ")
    .trim();
  return out.length >= 2 ? out : name;
}

export function regionlessKey(name: string, tokens: string[]): string {
  const isRegionTok = (t: string) => tokens.includes(t) || /^[가-힣]{1,5}(시|군|구|읍|면|동)$/.test(t) && tokens.some((x) => t.startsWith(x));
  let s = name.replace(/[(（[]([^)）\]]*)[)）\]]/g, (m, inner: string) => {
    const parts = inner.trim().split(/\s+/).filter(Boolean);
    return parts.length && parts.every((t) => isRegionTok(t) || /^[가-힣]{1,4}구$/.test(t)) ? " " : m;
  });
  for (let i = 0; i < 4; i++) {
    s = s.trimStart();
    const t = [...tokens].sort((a, b) => b.length - a.length).find((x) => s.startsWith(x));
    if (!t) break;
    s = s.slice(t.length);
  }
  s = s.replace(/^\s*형\s+/, "");
  let k = nameKey(s);
  for (let i = 0; i < 3; i++) {
    const before = k;
    k = k.replace(/(지원금지급|지원금|지급|운영|안내|지원사업|사업|서비스|지원)$/u, "");
    if (k === before) break;
  }
  return k || nameKey(name);
}

export function mergeInto(primary: SourceRecord, other: SourceRecord): void {
  primary.merged = [...(primary.merged ?? []), other, ...(other.merged ?? [])];
  other.merged = undefined;
  const fill = <K extends keyof SourceRecord>(k: K) => {
    if (primary[k] === undefined || primary[k] === "" || (Array.isArray(primary[k]) && (primary[k] as unknown[]).length === 0)) {
      (primary as unknown as Record<string, unknown>)[k] = other[k];
    }
  };
  (["summary", "target", "criteria", "benefit", "applyMethod", "documents", "contact", "deadline", "owner", "provider", "url", "applyUrl", "laws", "provision"] as const).forEach(fill);
  primary.tags = [...new Set([...primary.tags, ...other.tags])];
  primary.badges = [...new Set([...primary.badges, ...other.badges])];
  if (other.name !== primary.name) primary.aliases = [...new Set([...(primary.aliases ?? []), other.name])];
}

/** D1·D2: 통합돌봄 내부 중복 */
export function dedupWithinIcare(records: SourceRecord[], stats: DedupStats): SourceRecord[] {
  const out: SourceRecord[] = [];
  const exact = new Map<string, SourceRecord>();
  const subst = new Map<string, SourceRecord>();
  for (const r of records) {
    if (r.source !== "icare") { out.push(r); continue; }
    const e = JSON.stringify([regionKey(r), r.name, r.summary, r.target, r.provider, r.category, r.tags, r.icareType, r.url]);
    const ex = exact.get(e);
    if (ex) { mergeInto(ex, r); stats.d1Exact++; continue; }
    exact.set(e, r);
    const s = JSON.stringify([regionKey(r), r.key, r.target ?? "", r.summary]);
    const sb = subst.get(s);
    if (sb) { mergeInto(sb, r); stats.d2Substantive++; continue; }
    subst.set(s, r);
    out.push(r);
  }
  return out;
}

/**
 * 교차 원천 병합. 우선순위: gov24 > bokjiro > welfare100 > icare (대표 필드는 상위 원천).
 * 반환: 남은 레코드 + 전국 사업 키 → 시군구별 운영 정보
 */
export function mergeAcrossSources(records: SourceRecord[], stats: DedupStats, tokensFor: (r: SourceRecord) => string[] = () => []): {
  records: SourceRecord[];
  localOps: Map<SourceRecord, Map<string, LocalOperation[]>>;
} {
  const rank: Record<string, number> = { gov24: 0, bokjiro: 1, welfare100: 2, icare: 3 };
  const sorted = [...records].sort((a, b) => rank[a.source] - rank[b.source]);
  // 1차: 전국 사업끼리, 2차: 지역 사업 (전국 사업 목록이 먼저 확정되어야 지역 운영분을 붙일 수 있다)
  const passes = [sorted.filter((r) => r.scope === "national"), sorted.filter((r) => r.scope !== "national")];
  const byKey = new Map<string, SourceRecord[]>();
  const result: SourceRecord[] = [];
  const pairCount = new Map<string, number>();
  const localOps = new Map<SourceRecord, Map<string, LocalOperation[]>>();
  const nationalByKey = new Map<string, SourceRecord>();
  const addOp = (nat: SourceRecord, r: SourceRecord) => {
    let m = localOps.get(nat);
    if (!m) { m = new Map(); localOps.set(nat, m); }
    for (const code of r.sigunguCodes ?? []) {
      const list = m.get(code) ?? [];
      list.push({
        name: r.name, provider: r.provider ?? r.owner, description: r.summary || undefined, target: r.target, url: r.url, updatedAt: r.updatedAt,
        contact: r.contact, applyMethod: r.applyMethod, source: r.source,
      });
      m.set(code, list);
    }
  };
  // 전국 사업 원천:ID(병합된 원천 포함) → 대표 레코드 — 검토표 결정으로 묶을 때 쓴다 (전국 사업이 다 정해진 뒤 만든다)
  const natBySource = new Map<string, SourceRecord>();
  const indexNational = () => {
    const add = (nat: SourceRecord, m: SourceRecord) => {
      natBySource.set(`${m.source}:${m.sourceId}`, nat);
      for (const x of m.merged ?? []) add(nat, x);
    };
    for (const r of result) if (r.scope === "national") add(r, r);
  };
  for (const [pi, pass] of passes.entries()) {
    if (pi === 1) indexNational();
    for (const r of pass) {
      // 검토표에서 정한 전국 사업으로 묶기 (이름이 달라도)
      if (r.source === "icare" && r.menuTarget) {
        const nat = natBySource.get(r.menuTarget);
        if (!nat) (stats.menuTargetMissing ??= []).push(`${r.name} → ${r.menuTarget}`);
        else if (r.sigunguCodes?.length) {
          addOp(nat, r);
          stats.absorbedAsLocalOps += 1 + (r.merged?.length ?? 0);
          continue;
        }
      }
      // 통합돌봄 '전국' 행 → 같은 이름의 전국 사업에 지역 운영 정보로 흡수
      // '미분류' 행도 이름이 전국 사업과 같고 지역 추가사업 표지가 없으면 같은 사업의 지역 운영분으로 본다 (예: 장애인활동지원)
      if (r.source === "icare" && (r.icareType === "전국" || (r.icareType === "미분류" && !ADDON_NAME_RE.test(r.name)))) {
        const nat = nationalByKey.get(r.key) ?? nationalByKey.get(mergeKey(r)) ?? nationalByKey.get(regionlessKey(r.name, tokensFor(r)));
        if (nat && r.sigunguCodes?.length) {
          if (r.icareType === "미분류") (stats.regionalCopySamples ??= []).push({ decision: "absorb", reason: "통합돌봄 미분류 행: 전국 사업과 이름 일치", sim: 0, nat: nat.name, local: r.name, region: r.regionLabel });
          addOp(nat, r);
          stats.absorbedAsLocalOps += 1 + (r.merged?.length ?? 0);
          continue;
        }
      }
      // 정부24·복지로의 시군구 등록분이 전국 사업의 지역 집행분이면(같은 이름 + 같은 근거 법령) 지역 운영 정보로 흡수
      if ((r.source === "gov24" || r.source === "bokjiro") && r.scope === "sigungu" && level(r) === "R") {
        const toks = tokensFor(r);
        const nat = nationalByKey.get(r.key) ?? nationalByKey.get(regionlessKey(r.name, toks));
        if (nat) {
          const chk = regionalCopyCheck(nat, r, toks);
          if (chk.reason !== "근거 법령 불일치" && chk.reason !== "이름 불일치") {
            (stats.regionalCopySamples ??= []).push({ decision: chk.ok ? "absorb" : "keep", reason: chk.reason, sim: Math.round(chk.sim * 100) / 100, nat: nat.name, local: r.name, region: r.regionLabel });
          }
          if (chk.ok) {
            addOp(nat, r);
            stats.absorbedAsLocalOps += 1 + (r.merged?.length ?? 0);
            stats.absorbedRegionalCopies = (stats.absorbedRegionalCopies ?? 0) + 1;
            continue;
          }
          if (chk.reason !== "근거 법령 불일치" && chk.reason !== "이름 불일치") stats.keptRegionalAddons = (stats.keptRegionalAddons ?? 0) + 1;
        }
      }
      const regional = r.scope !== "national";
      const mk = regional ? `R|${regionKey(r)}|${level(r)}|${regionlessKey(r.name, tokensFor(r))}` : mergeKey(r);
      const candidates = byKey.get(mk) ?? [];
      let merged = false;
      for (const c of candidates) {
        // 같은 원천끼리는: 지역 사업의 구(區)·표기 변형만 병합 (전국 사업은 D1·D2 에서 처리)
        if (c.source === r.source && r.source !== "welfare100") {
          if (!regional || c.name === r.name || r.source === "icare") continue;
        }
        if (level(c) !== level(r)) { stats.blockedByLevel++; continue; }
        if (regionKey(c) !== regionKey(r)) continue;
        if (level(c) === "N" && c.owner && r.owner && !ownersCompatible(c.owner, r.owner)) continue;
        mergeInto(c, r);
        const pair = `${c.source}+${r.source}`;
        pairCount.set(pair, (pairCount.get(pair) ?? 0) + 1);
        merged = true;
        break;
      }
      if (merged) continue;
      // 지역 키가 겹치지 않아도 기존 전체 키로 수준 차단 통계를 낸다
      if (regional) {
        const nat = nationalByKey.get(r.key);
        if (nat && level(nat) !== level(r)) stats.blockedByLevel++;
      }
      candidates.push(r);
      byKey.set(mk, candidates);
      result.push(r);
      if (r.scope === "national") {
        if (!nationalByKey.has(r.key)) nationalByKey.set(r.key, r);
        nationalByKey.set(mergeKey(r), r);
      }
    }
  }
  stats.crossMerged = [...pairCount.entries()].map(([pair, count]) => ({ pair, count }));
  return { records: result, localOps };
}

function ownersCompatible(a: string, b: string): boolean {
  const n = (s: string) => s.replace(/\s+/g, "").replace(/(장관|청장)$/, "");
  const x = n(a), y = n(b);
  return x === y || x.includes(y) || y.includes(x);
}

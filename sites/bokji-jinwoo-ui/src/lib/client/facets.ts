/**
 * 검색 필터(생애주기·가구상황·관심주제)와 지원형태 표시.
 * 원천 분류 태그(정부24·복지로 대상 특성·지원 유형)를 먼저 보고, 태그가 없는 사업은 이름·요약·대상 문구로 보완한다.
 */
import { CATEGORIES, type Category, type Program } from "../data/types";

export interface Facet {
  id: string;
  label: string;
  /** 원천 태그 중 하나라도 있으면 해당 */
  tags: string[];
  /** 태그가 없을 때 이름·요약·대상 문구로 보완 */
  text?: RegExp;
}

export const LIFE: Facet[] = [
  { id: "pregnancy", label: "임신·출산", tags: ["임신·출산"], text: /임신|출산|산모|산후|난임|임산부/ },
  { id: "infant", label: "영유아", tags: ["영유아", "보육"], text: /영유아|영아|유아|어린이집/ },
  { id: "child", label: "아동", tags: ["아동"], text: /아동|초등/ },
  { id: "teen", label: "청소년", tags: ["청소년"], text: /청소년|중학생|고등학생/ },
  { id: "youth", label: "청년", tags: ["청년"], text: /청년/ },
  { id: "middle", label: "중장년", tags: ["중장년"], text: /중장년|신중년/ },
  { id: "senior", label: "어르신", tags: ["노년"], text: /노인|어르신|경로|65세 이상/ },
];

export const HOUSEHOLD: Facet[] = [
  { id: "lowincome", label: "저소득", tags: ["저소득"], text: /저소득|기초생활|수급자|차상위/ },
  { id: "disabled", label: "장애인", tags: ["장애인"], text: /장애/ },
  { id: "singleparent", label: "한부모·조손", tags: ["한부모·조손"], text: /한부모|조손/ },
  { id: "multichild", label: "다자녀", tags: ["다자녀"], text: /다자녀/ },
  { id: "multicultural", label: "다문화·탈북민", tags: ["다문화·탈북민"], text: /다문화|결혼이민|북한이탈/ },
  { id: "veteran", label: "보훈대상자", tags: ["보훈대상자"], text: /보훈|국가유공/ },
];

export const TOPICS: Category[] = [...CATEGORIES];

const tagsOf = (p: Program) => (p.tags ?? []).flatMap((t) => t.split("||"));

export function matchesFacet(p: Program, f: Facet): boolean {
  const tags = tagsOf(p);
  if (f.tags.some((t) => tags.includes(t))) return true;
  if (!f.text) return false;
  return f.text.test(`${p.name} ${p.summary ?? ""} ${p.target ?? ""}`);
}

export interface FacetSelection {
  life: string[];
  house: string[];
  topic: string[];
}

export const EMPTY_SELECTION: FacetSelection = { life: [], house: [], topic: [] };

/** 같은 묶음 안에서는 하나라도(또는), 묶음끼리는 모두(그리고) */
export function matchesSelection(p: Program, s: FacetSelection): boolean {
  if (s.life.length && !LIFE.filter((f) => s.life.includes(f.id)).some((f) => matchesFacet(p, f))) return false;
  if (s.house.length && !HOUSEHOLD.filter((f) => s.house.includes(f.id)).some((f) => matchesFacet(p, f))) return false;
  if (s.topic.length && !s.topic.some((c) => p.category === c || tagsOf(p).includes(c))) return false;
  return true;
}

export const selectionSize = (s: FacetSelection) => s.life.length + s.house.length + s.topic.length;

export function parseSelection(params: URLSearchParams): FacetSelection {
  const list = (k: string) => (params.get(k) ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return {
    life: list("life").filter((x) => LIFE.some((f) => f.id === x)),
    house: list("house").filter((x) => HOUSEHOLD.some((f) => f.id === x)),
    topic: list("topic").filter((x) => (TOPICS as string[]).includes(x)),
  };
}

export function selectionQuery(q: string, s: FacetSelection): string {
  const sp = new URLSearchParams();
  if (q.trim()) sp.set("q", q.trim());
  if (s.life.length) sp.set("life", s.life.join(","));
  if (s.house.length) sp.set("house", s.house.join(","));
  if (s.topic.length) sp.set("topic", s.topic.join(","));
  const str = sp.toString();
  return str ? `?${str}` : "";
}

/** 지원형태 (현금·감면·융자·현물·이용권·서비스·시설이용) — 원천 지원 유형 태그에서, 최대 2개 */
export function supportTypes(p: Program): string[] {
  const out: string[] = [];
  for (const t of tagsOf(p)) {
    const v = /^현금\(감면\)/.test(t)
      ? "감면"
      : /^현금\(융자\)/.test(t)
        ? "융자"
        : /^현금/.test(t)
          ? "현금"
          : t === "현물"
            ? "현물"
            : t === "이용권"
              ? "이용권"
              : /^서비스|^의료지원$|^상담\/법률지원$/.test(t)
                ? "서비스"
                : t === "시설이용"
                  ? "시설이용"
                  : null;
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, 2);
}

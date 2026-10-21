import type { Program } from "../data/types";

/**
 * 카드에 붙이는 짧은 안내 (QA 5차 검증 N2 · 6차 후속)
 * — 원문에 그렇게 적혀 있을 때만 붙인다. 추측해서 붙이지 않는다.
 */

/** 원문에 '보호자·부모·법정대리인 동의'가 적혀 있는지 (보호자동의서, 법정 대리인 동의서 포함) */
export const PARENT_CONSENT = /(?:부모|보호자|법정\s*대리인|친권자)\s*(?:의|등의)?\s*(?:서면\s*)?동의/;

const clean = (t?: string) => (t ?? "").replace(/&#13;/g, "\n");

/** 원문(대상·기준·내용·신청방법·구비서류)에서 부모 동의 문구를 찾는다 — 없으면 null */
export function parentConsent(p: Pick<Program, "target" | "criteria" | "benefit" | "applyMethod" | "documents" | "summary">): string | null {
  for (const f of [p.target, p.criteria, p.applyMethod, p.documents, p.benefit, p.summary]) {
    const t = clean(f);
    const m = PARENT_CONSENT.exec(t);
    if (m) return t.slice(Math.max(0, m.index - 20), m.index + m[0].length + 12).replace(/\s+/g, " ").trim();
  }
  return null;
}

/** 청소년상담1388·청소년동반자처럼 이름은 '청소년'이지만 원문상 만 24세까지 이용하는 사업 */
const YOUTH_COUNSEL_NAME = /청소년\s*(?:전화\s*)?1388|청소년\s*상담|청소년\s*동반자|1388/;
const UP_TO_24 = /(?<!\d)(?:9|아홉)\s*세?\s*(?:이상|부터)?\s*[~∼～\-–]?\s*(?:만\s*)?24\s*세|24\s*세\s*(?:이하|까지)/;

export function youthUpTo24(p: Pick<Program, "name" | "target" | "summary" | "criteria">): boolean {
  if (!YOUTH_COUNSEL_NAME.test(p.name)) return false;
  return UP_TO_24.test([p.target, p.criteria, p.summary].map(clean).join("\n"));
}

/** 동의 문구 앞의 나이 한정 ('만14세 미만 청소년 법정대리인 동의 필요') — 없으면 null */
export function consentUnderAge(snippet: string): number | null {
  const m = /만\s*(\d{1,2})\s*세\s*미만/.exec(snippet);
  return m ? Number(m[1]) : null;
}

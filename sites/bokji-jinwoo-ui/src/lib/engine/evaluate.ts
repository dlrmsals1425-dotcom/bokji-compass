import {
  ACTIVITY_LABEL, AGE_LABEL, BENEFIT_LABEL, CAR_LABEL, CARE_LABEL, CHILD_LABEL, DISABILITY_LABEL,
  HOUSING_LABEL, INCOME_LABEL, SEVERITY_LABEL, TRAIT_LABEL,
  ageRange, childRange, incomeRange,
  type Profile,
} from "./profile";
import type { Cond, EvalOptions, Evaluation, Leaf, Reason, Rule, Tier, Tri } from "./types";

/* ---------------- 3값 논리 ---------------- */

export function triAll(values: Tri[]): Tri {
  if (values.includes("F")) return "F";
  if (values.every((v) => v === "T")) return "T";
  return "U";
}

export function triAny(values: Tri[]): Tri {
  if (values.includes("T")) return "T";
  if (values.length > 0 && values.every((v) => v === "F")) return "F";
  return "U";
}

/** 사용자 구간 [a,b] 와 조건 구간 [min,max] (양끝 포함) 비교 */
export function compareRange(user: [number, number], min = -Infinity, max = Infinity): Tri {
  const [a, b] = user;
  if (a >= min && b <= max) return "T";
  if (b < min || a > max) return "F";
  return "U";
}

/** 소득: 사용자 구간 (lo, hi] 가 '중위 X% 이하'를 만족하는지 */
export function compareIncomeLte(user: [number, number], lte: number): Tri {
  const [lo, hi] = user;
  if (hi <= lte) return "T";
  if (lo >= lte) return "F";
  return "U";
}

/** 소득: 사용자 구간 (lo, hi] 가 구간들 (a, b] 의 합집합에 들어가는지 */
export function compareIncomeBands(user: [number, number], bands: [number, number][]): Tri {
  // JSON 에서 Infinity 는 null 로 저장됨 ('200% 초과' = [200, null])
  const merged = mergeIntervals(bands.map(([a, b]) => [a, b ?? Infinity] as [number, number]));
  const [lo, hi] = user;
  if (merged.some(([a, b]) => lo >= a && hi <= b)) return "T";
  if (!merged.some(([a, b]) => lo < b && hi > a)) return "F";
  return "U";
}

function mergeIntervals(bands: [number, number][]): [number, number][] {
  const sorted = [...bands].sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/* ---------------- 잎 조건 평가 ---------------- */

interface LeafResult {
  tri: Tri;
  reason: Reason;
}

/** 입력 안내용 목적어 (조사 포함) */
const FIELD_ASK: Record<Leaf["field"], string> = {
  age: "나이대를",
  childAge: "자녀 나이대를",
  children: "자녀 정보를",
  income: "소득 구간을",
  incomeBands: "소득 구간을",
  householdSize: "가구원 수를",
  trait: "가구 특성을",
  benefit: "수급·자격 상태를",
  housing: "주거 형태를",
  car: "차량 보유 여부를",
  activity: "취업·활동 상태를",
  care: "돌봄 필요 여부를",
  disability: "장애 정보를",
  unasked: "",
  resident: "거주지를",
};

function joinLabels<T extends string>(vals: readonly T[], labels: Record<T, string>): string {
  return vals.length ? vals.map((v) => labels[v]).join(", ") : "해당 없음";
}

/** 잎 조건을 평가하고, 사용자 입력값 설명(display)을 함께 돌려준다 */
function rawLeaf(leaf: Leaf, p: Profile, opts?: EvalOptions): { tri: Tri; missing: boolean; display?: string; proxy?: boolean } {
  // 월 소득을 원으로 알면 구간 대신 정확한 % 로 비교
  if ((leaf.field === "income" || leaf.field === "incomeBands") && opts?.incomePct !== undefined) {
    const pct = opts.incomePct;
    const display = `기준 중위소득의 약 ${Math.round(pct)}%`;
    // 구간 표기 (a, b] — '0~50, 51~75' 처럼 1%p 틈이 있는 표기는 이어 붙여 본다
    const hit = leaf.field === "income" ? pct <= leaf.lte : leaf.bands.some(([a, b]) => pct > (a > 0 ? a - 1 : -1) && pct <= (b ?? Infinity));
    return { tri: hit ? "T" : "F", missing: false, display };
  }
  switch (leaf.field) {
    case "age": {
      if (p.age === "unknown") return { tri: "U", missing: true };
      const [lo, hi] = ageRange(p.age);
      // 나이 범위(예: '30대' → 30-39)는 AGE_LABEL 에 없으므로 직접 적는다
      return { tri: compareRange([lo, hi], leaf.min, leaf.max), missing: false, display: AGE_LABEL[p.age] ?? (hi >= 120 ? `만 ${lo}세 이상` : `만 ${lo}~${hi}세`) };
    }
    case "childAge": {
      if (p.children === null) return { tri: "U", missing: true };
      const kids = p.children.filter((c) => c !== "pregnant");
      const display = joinLabels(p.children, CHILD_LABEL);
      if (kids.length === 0) return { tri: "F", missing: false, display: p.children.length ? display : "자녀 없음" };
      const tris = kids.map((k) => compareRange(childRange(k), leaf.min, leaf.max));
      return { tri: triAny(tris), missing: false, display };
    }
    case "children": {
      if (p.children === null) return { tri: "U", missing: true };
      const hit = p.children.some((c) => leaf.anyOf.includes(c));
      return { tri: hit ? "T" : "F", missing: false, display: p.children.length ? joinLabels(p.children, CHILD_LABEL) : "자녀 없음" };
    }
    case "income": {
      if (p.income === "unknown") return { tri: "U", missing: true };
      return { tri: compareIncomeLte(incomeRange(p.income), leaf.lte), missing: false, display: `중위소득 ${INCOME_LABEL[p.income]}` };
    }
    case "incomeBands": {
      if (p.income === "unknown") return { tri: "U", missing: true };
      return { tri: compareIncomeBands(incomeRange(p.income), leaf.bands), missing: false, display: `중위소득 ${INCOME_LABEL[p.income]}` };
    }
    case "householdSize": {
      if (p.householdSize === "unknown") return { tri: "U", missing: true };
      const r: [number, number] = p.householdSize === 6 ? [6, 99] : [p.householdSize, p.householdSize];
      return { tri: compareRange(r, leaf.min, leaf.max), missing: false, display: p.householdSize === 6 ? "6명 이상" : `${p.householdSize}명` };
    }
    case "trait": {
      const single = p.householdSize === 1 && leaf.anyOf.includes("single");
      if (single) return { tri: "T", missing: false, display: "1인 가구" };
      if (p.traits === null) return { tri: "U", missing: true };
      const hit = p.traits.some((t) => leaf.anyOf.includes(t));
      return { tri: hit ? "T" : "F", missing: false, display: joinLabels(p.traits, TRAIT_LABEL) };
    }
    case "benefit": {
      if (p.benefits === null) return { tri: "U", missing: true };
      const hit = p.benefits.some((b) => leaf.anyOf.includes(b));
      return { tri: hit ? "T" : "F", missing: false, display: joinLabels(p.benefits, BENEFIT_LABEL) };
    }
    case "housing": {
      if (p.housing === "unknown") return { tri: "U", missing: true };
      return { tri: leaf.anyOf.includes(p.housing) ? "T" : "F", missing: false, display: HOUSING_LABEL[p.housing] };
    }
    case "car": {
      if (p.car === "unknown") return { tri: "U", missing: true };
      return { tri: leaf.anyOf.includes(p.car) ? "T" : "F", missing: false, display: `차량 ${CAR_LABEL[p.car]}` };
    }
    case "activity": {
      if (p.activity === "unknown") return { tri: "U", missing: true };
      return { tri: leaf.anyOf.includes(p.activity) ? "T" : "F", missing: false, display: ACTIVITY_LABEL[p.activity] };
    }
    case "care": {
      if (p.care === null) return { tri: "U", missing: true };
      const hit = p.care.some((c) => leaf.anyOf.includes(c));
      return { tri: hit ? "T" : "F", missing: false, display: joinLabels(p.care, CARE_LABEL) };
    }
    case "disability": {
      if (p.disability === "unknown") return { tri: "U", missing: true };
      const display = DISABILITY_LABEL[p.disability];
      if (p.disability === "none") return { tri: "F", missing: false, display };
      // '장애인 본인' 대상 사업이라도 장애가 있는 가구원(예: 성인 자녀) 이름으로 신청할 수 있다 → 확인 필요로 둔다
      if (p.disability === "member" && leaf.anyOf.includes("self") && !leaf.anyOf.includes("member")) {
        if (leaf.severity && p.disabilitySeverity !== "unknown" && p.disabilitySeverity !== leaf.severity) return { tri: "F", missing: false, display: `${display} · ${SEVERITY_LABEL[p.disabilitySeverity]}` };
        return { tri: "U", missing: false, display, proxy: true };
      }
      if (!leaf.anyOf.includes(p.disability)) return { tri: "F", missing: false, display };
      if (!leaf.severity) return { tri: "T", missing: false, display };
      if (p.disabilitySeverity === "unknown") return { tri: "U", missing: true, display };
      return {
        tri: p.disabilitySeverity === leaf.severity ? "T" : "F",
        missing: false,
        display: `${display} · ${SEVERITY_LABEL[p.disabilitySeverity]}`,
      };
    }
    case "unasked":
      return { tri: "U", missing: false };
    case "resident":
      return { tri: "T", missing: false };
  }
}

export function evaluateLeaf(leaf: Leaf, p: Profile, opts?: EvalOptions): LeafResult {
  const r = evaluateLeafBase(leaf, p, opts);
  if (opts?.withLeaf) r.reason = { ...r.reason, leaf };
  return r;
}

function evaluateLeafBase(leaf: Leaf, p: Profile, opts?: EvalOptions): LeafResult {
  // 간편 입력 밖 사실에 대한 사용자 답 (예: 장기요양등급 '있음')
  if (leaf.field === "unasked" && opts?.facts && opts.factPatterns) {
    for (const [k, re] of Object.entries(opts.factPatterns)) {
      if (!(k in opts.facts) || !re.test(leaf.label)) continue;
      return opts.facts[k]
        ? { tri: "T", reason: { kind: "met", text: leaf.label, field: "unasked" } }
        : { tri: "F", reason: { kind: "unmet", text: `${leaf.label} (답: 해당 없음)` } };
    }
  }
  const raw = rawLeaf(leaf, p, opts);
  // 수급·가구 특성 중 일부만 답한 경우: 맞는 항목이 없고 '모름'인 항목이 걸려 있으면 UNKNOWN
  if (raw.tri === "F" && leaf.field === "benefit" && opts?.unknownBenefits?.some((b) => leaf.anyOf.includes(b))) {
    raw.tri = "U";
    raw.missing = true;
  }
  if (raw.tri === "F" && leaf.field === "trait" && opts?.unknownTraits?.some((t) => leaf.anyOf.includes(t))) {
    raw.tri = "U";
    raw.missing = true;
  }
  let tri = raw.tri;
  let text: string;
  if (leaf.field === "unasked") {
    return { tri: "U", reason: { kind: "unknown", text: `${leaf.label} — ${leaf.hint ?? "간편 입력에서는 묻지 않는 조건이에요. 신청처에서 확인하세요."}` } };
  }
  if (tri === "F" && leaf.soft && !opts?.strictSoft) {
    return { tri: "U", reason: { kind: "unknown", text: `${leaf.label} — 해당 여부는 신청처에서 확인하세요`, ...(opts ? { softNo: true } : {}) } };
  }
  if (tri === "T" && leaf.capU) {
    return { tri: "U", reason: { kind: "unknown", text: `${leaf.label} — 해당될 수 있어요 (세부 기준 확인)` } };
  }
  if (tri === "T") {
    text = leaf.label;
    return { tri, reason: { kind: "met", text, field: leaf.field } };
  }
  if (tri === "F") {
    text = raw.display ? `${leaf.label} (입력: ${raw.display})` : leaf.label;
    return { tri, reason: { kind: "unmet", text } };
  }
  tri = "U";
  if (raw.proxy) {
    return { tri, reason: { kind: "unknown", field: "disability", text: `${leaf.label} — 장애가 있는 가구원 본인 이름으로 신청할 수 있어요. 그 가구원의 나이·소득 기준을 확인하세요` } };
  }
  text = raw.missing
    ? `${leaf.label} — ${FIELD_ASK[leaf.field]} 입력하면 확인할 수 있어요`
    : `${leaf.label} — 선택한 구간(${raw.display})이 기준에 걸쳐 있어요`;
  return { tri, reason: { kind: "unknown", text } };
}

/* ---------------- 조건 트리 평가 ---------------- */

export interface CondResult {
  tri: Tri;
  reasons: Reason[];
}

export function evaluateCond(c: Cond, p: Profile, opts?: EvalOptions): CondResult {
  if ("all" in c) {
    const rs = c.all.map((x) => evaluateCond(x, p, opts));
    const tri = triAll(rs.map((r) => r.tri));
    return { tri, reasons: rs.flatMap((r) => r.reasons) };
  }
  if ("any" in c) {
    const rs = c.any.map((x) => evaluateCond(x, p, opts));
    const tri = triAny(rs.map((r) => r.tri));
    let reasons: Reason[];
    if (tri === "T") {
      reasons = rs.filter((r) => r.tri === "T").flatMap((r) => r.reasons.filter((x) => x.kind === "met"));
    } else if (tri === "U") {
      reasons = c.label
        ? [{ kind: "unknown", text: `${c.label} 중 하나에 해당하는지 확인이 필요해요` }]
        : rs.filter((r) => r.tri === "U").flatMap((r) => r.reasons);
    } else {
      reasons = c.label
        ? [{ kind: "unmet", text: `${c.label} 중 해당하는 항목이 없어요` }]
        : rs.flatMap((r) => r.reasons);
    }
    return { tri, reasons: dedupeReasons(reasons) };
  }
  const r = evaluateLeaf(c, p, opts);
  return { tri: r.tri, reasons: [r.reason] };
}

function dedupeReasons(rs: Reason[]): Reason[] {
  const seen = new Set<string>();
  return rs.filter((r) => {
    const k = r.kind + r.text;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ---------------- 최종 판정 (설계서 6.1·6.2) ---------------- */

export function isApproved(rule: Rule): boolean {
  return rule.review === "verified" || rule.review === "curated" || rule.review === "structured";
}

export function evaluateRule(rule: Rule, p: Profile, opts?: EvalOptions): Evaluation {
  const notes: Reason[] = rule.unstructured.map((t) => ({
    kind: "note" as const,
    text: rule.unstructuredCore ? `상담으로 판단하는 조건: ${t}` : `추가로 확인할 조건: ${t}`,
  }));

  if (!rule.logic) {
    const reasons: Reason[] = [
      { kind: "note", text: "구조화된 자격 조건이 아직 없어요. 원문과 신청처에서 대상 여부를 확인하세요." },
      ...notes,
    ];
    return { tier: "check", reasons, headline: headlineFor("check", reasons, rule) };
  }

  const res = evaluateCond(rule.logic, p, opts);
  const reasons = dedupeReasons([...res.reasons, ...notes]);
  let tier: Tier;
  if (res.tri === "F") tier = "ineligible";
  else if (rule.unstructuredCore) tier = "check";
  else if (isApproved(rule)) tier = res.tri === "T" ? "eligible" : "likely";
  else tier = reasons.some((r) => r.kind === "met") ? "likely" : "check";

  return { tier, reasons, headline: headlineFor(tier, reasons, rule) };
}

function headlineFor(tier: Tier, reasons: Reason[], rule: Rule): string {
  const met = reasons.filter((r) => r.kind === "met").map((r) => r.text);
  const unknown = reasons.find((r) => r.kind === "unknown");
  const unmet = reasons.find((r) => r.kind === "unmet");
  switch (tier) {
    case "ineligible":
      return unmet ? `맞지 않는 조건: ${unmet.text}` : "조건이 맞지 않아요";
    case "eligible":
      return met.length ? met.slice(0, 3).map((m) => `✓ ${m}`).join("  ") : "입력하신 정보로 모든 조건을 충족해요";
    case "likely": {
      const head = met.length ? met.slice(0, 2).map((m) => `✓ ${m}`).join("  ") : "";
      const tail = unknown ? `? ${unknown.text}` : "";
      return [head, tail].filter(Boolean).join("  ") || "일부 조건을 더 확인해야 해요";
    }
    case "check": {
      if (rule.unstructuredCore && rule.unstructured[0]) return `'${truncate(rule.unstructured[0], 40)}' 여부는 상담으로 판단해요`;
      if (met.length) return `✓ ${met[0]}  · 세부 자격은 원문에서 확인하세요`;
      return "자격 조건을 원문·신청처에서 확인하세요";
    }
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/**
 * v2 시험판 (운영자 피드백 2026-10-07): '내 상황'을 먼저 받고, 답한 사실과 맞지 않는 혜택은 본문에서 빼고,
 * '모름'으로 남은 조건은 짧은 추가 질문(예/아니오/모름)으로 바로 다시 거른다.
 * 순수 함수 (브라우저·스크립트 공용). 프로필은 기기 밖으로 보내지 않는다.
 */
import { evaluateCond, evaluateRule } from "../engine/evaluate";
import {
  AGE_BANDS, AGE_LABEL, BASIC_PENSION_THRESHOLD_2026, EMPTY_PROFILE, type AgeBand, BENEFITS, CHILD_LABEL, HOUSEHOLD_TRAITS, INCOME_BANDS, ageRange, incomeBandFor, incomeRange, medianWon,
  type Benefit, type HouseholdTrait, type IncomeBand, type Profile,
} from "../engine/profile";
import type { Cond, EvalOptions, Evaluation, Leaf, Reason } from "../engine/types";
import type { Program } from "../data/types";
import { closedSince } from "./period";
import { isSameProgram, autoLike, familyKey, groupVariants, hiddenByDefault, scoreAll, type Filters, type Group, type Scored } from "./results";
import type { FindMode } from "./mode";
import { TOPICS, programTopics, type TopicId } from "./topics";

/* ---------------- 입력 (12개 항목 + 항목별 '모름') ---------------- */

/** 간편 입력 밖의 사실 — 원문 '묻지 않는 조건'과 이름으로 이어 붙인다 */
export const FACT_PATTERNS = {
  ltcGrade: /장기\s*요양\s*(등급|인정|수급)|요양\s*등급|등급\s*판정/,
  pension70: /소득\s*하위\s*70|선정\s*기준액/,
  illness: /질병|질환|환자|투병|희귀|난치|중증\s*환자/,
  /** (QA 8차) 어린이집·유치원 이용 — 보육료·유아학비는 다닐 때, 가정양육수당은 다니지 않을 때 (한 질문으로 둘 다 정함) */
  daycare: /어린이집·유치원에 다님/,
  homeCare: /어린이집·유치원에 다니지 않음/,
} as const;
export type FactId = keyof typeof FACT_PATTERNS;

export interface Extras {
  /** 골라서 찾기에서 확인한 자녀·출산 상황. 미선택은 미확인이며 가구원 수로 추정하지 않는다. */
  family?: "children" | "expecting" | "both" | "none";
  /** 자녀 수 (0·1·2·3=3명 이상). 없음 = 모름 — 다자녀 판단·입력 화면 복원용 */
  childCount?: 0 | 1 | 2 | 3 | null;
  /** 수급·자격 항목별 답 (키 없음 = 모름) */
  benefits: Partial<Record<Benefit, boolean>>;
  /** 가구 특성 항목별 답 (키 없음 = 모름) */
  traits: Partial<Record<HouseholdTrait, boolean>>;
  /** 월 가구 소득(만원). null = 모름 → 프로필의 소득 구간을 그대로 쓴다 */
  incomeManwon: number | null;
  facts: Partial<Record<FactId, boolean>>;
  /** 정확한 나이를 모를 때 말한 나이 범위 (예: '30대' → [30, 39]) — 범위 전체에서 맞는 혜택만 '받으실 수 있어요' (QA 2차 H2) */
  ageSpan?: [number, number] | null;
  /** 문장에서 말한 관심 주제 (예: '기초연금 받고 싶어요' → basic_pension) — 순위만 올린다 (QA 2차 H1·N3) */
  interests?: TopicId[];
  /** 부모님 두 분의 나이대가 다를 때 다른 분 (결과 화면 '다른 분 기준으로 보기' — QA 2차 M7) */
  otherAge?: { band: Exclude<Profile["age"], "unknown">; label: string } | null;
}

export interface Situation {
  profile: Profile;
  x: Extras;
  /** 본인/부모님 — 추가 질문 고르기·말투 (없으면 부모님 기준 질문 모두) */
  mode?: FindMode;
}

export const EMPTY_EXTRAS: Extras = { benefits: {}, traits: {}, incomeManwon: null, facts: {} };

/** 기존 프로필(12개 항목)에서 v2 입력을 만든다 — 다중 선택 항목은 '답함'이면 모든 하위 항목을 예/아니오로 */
export function extrasFromProfile(p: Profile): Extras {
  const benefits: Extras["benefits"] = {};
  if (p.benefits) for (const b of BENEFITS) benefits[b] = p.benefits.includes(b);
  const traits: Extras["traits"] = {};
  if (p.traits) for (const t of HOUSEHOLD_TRAITS) traits[t] = p.traits.includes(t);
  return { benefits, traits, incomeManwon: null, facts: {} };
}

const sizeOf = (p: Profile) => (p.householdSize === "unknown" ? null : p.householdSize);

/** 월 소득(만원)·가구원 수를 알면 기준 중위소득 대비 % (모르면 null) */
export function incomePctOf(s: Situation): number | null {
  const size = sizeOf(s.profile);
  return s.x.incomeManwon !== null && size !== null ? (s.x.incomeManwon * 1e6) / medianWon(100, size) : null;
}

/** 소득 구간 (월 소득 입력이 있으면 그것으로) */
export function incomeOf(s: Situation): Profile["income"] {
  const size = sizeOf(s.profile);
  return s.x.incomeManwon !== null && size !== null ? incomeBandFor(s.x.incomeManwon * 10000, size) : s.profile.income;
}

/**
 * 답에서 미루어 아는 것: 소득이 기준 중위소득 60%를 넘으면 기초생활보장(생계·의료·주거·교육급여, 50% 이하)·차상위(50% 이하)는 아님.
 * (소득인정액에는 재산 환산액이 더해지므로 소득만 보면 실제보다 낮게 잡힐 수는 있어도 높게 잡히지는 않는다는 가정 — 근로소득 공제가 큰 경우는 예외 → 60%로 여유)
 */
export function inferExtras(s: Situation): Extras {
  const inc = incomeOf(s);
  if (inc === "unknown" || incomeRange(inc)[0] < LOW_INCOME_PCT) return s.x;
  const b = { ...s.x.benefits };
  let changed = false;
  for (const k of RECIPIENT_KINDS) {
    if (b[k] !== undefined) continue;
    b[k] = false;
    changed = true;
  }
  return changed ? { ...s.x, benefits: b } : s.x;
}

/** 미루어 본 답이 있는지 (화면 안내용) */
export const inferredNoRecipient = (s: Situation) => RECIPIENT_KINDS.some((k) => s.x.benefits[k] === undefined) && inferExtras(s) !== s.x;

/**
 * 나이를 정확히 모를 때 판정에 쓰는 나이 범위 (QA 2차 H2·N3)
 *  - 말한 범위 ('30대' → 30~39), 없으면 본인 찾기는 성인(19세 이상), 부모님 찾기는 40세 이상
 *  - 범위 전체에서 맞는 조건은 맞음, 범위에 걸치는 조건은 '답하면 정해져요', 범위 밖은 맞지 않음
 */
export function ageSpanOf(s: Situation): [number, number] | null {
  // '18세 이하' 구간은 넓어서(0~18) 말한 정확한 나이가 있으면 그것으로 (QA 5차 검증 N2: 열일곱 → 만 9~24세 사업에 '확인할 것: 나이')
  if (s.profile.age === "0-18" && s.x.ageSpan && s.x.ageSpan[1] <= 18) return s.x.ageSpan;
  if (s.profile.age !== "unknown") return null;
  if (s.x.ageSpan) return s.x.ageSpan;
  return s.mode === "self" ? [19, 120] : s.mode === "parent" ? [40, 120] : null;
}

/** 나이(정확한 구간 또는 범위) → [하한, 상한] (모르면 null) */
export function ageBoundsOf(s: Situation): [number, number] | null {
  return s.profile.age !== "unknown" ? ageRange(s.profile.age) : ageSpanOf(s);
}

/** v2 입력 → 판정용 프로필 + 판정 선택 사항 */
export function toEval(s: Situation, strict = false): { profile: Profile; opts: EvalOptions } {
  const span = ageSpanOf(s);
  // 나이 범위는 'a-b' 구간으로 판정 (엔진의 ageRange 가 그대로 읽음)
  const p: Profile = span ? { ...s.profile, age: `${span[0]}-${span[1]}` as Profile["age"] } : s.profile;
  const x = inferExtras(s);
  const bKnown = BENEFITS.filter((b) => x.benefits[b] !== undefined);
  const size = sizeOf(p);
  const traitsMap = { ...x.traits };
  if (size !== null) traitsMap.single = size === 1;
  if (traitsMap.single_parent === undefined && noChildSelf(s)) traitsMap.single_parent = false;
  // 자녀 수 → 다자녀 (3명 이상은 다자녀, 0·1명은 아님, 2명은 사업마다 달라 모름으로 둔다)
  if (traitsMap.multi_child === undefined && x.childCount !== undefined && x.childCount !== null && x.childCount !== 2) traitsMap.multi_child = x.childCount === 3;
  const tKnown = HOUSEHOLD_TRAITS.filter((t) => traitsMap[t] !== undefined);
  const income = incomeOf(s);
  const facts: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(x.facts)) if (v !== undefined) facts[k] = v;
  // 기초연금을 받고 있으면 '소득 하위 70%' 조건은 이미 맞음 (안 받는다고 아니라고 볼 수는 없음)
  if (x.benefits.basic_pension === true) facts.pension70 = true;
  const pct = incomePctOf(s);
  return {
    profile: {
      ...p,
      income,
      benefits: bKnown.length ? BENEFITS.filter((b) => x.benefits[b] === true) : null,
      traits: tKnown.length ? HOUSEHOLD_TRAITS.filter((t) => traitsMap[t] === true) : null,
    },
    opts: {
      facts, factPatterns: FACT_PATTERNS, withLeaf: true, strictSoft: strict,
      ...(pct !== null ? { incomePct: pct } : {}),
      unknownBenefits: bKnown.length ? BENEFITS.filter((b) => x.benefits[b] === undefined) : undefined,
      unknownTraits: tKnown.length ? HOUSEHOLD_TRAITS.filter((t) => traitsMap[t] === undefined) : undefined,
    },
  };
}

/* ---------------- 원문 문구의 소득·수급 관문 ---------------- */

export type Gate =
  | { kind: "recipient"; text: string }
  | { kind: "low"; text: string }
  | { kind: "median"; pct: number; text: string }
  | { kind: "basicPension"; text: string };

const RECIPIENT_KINDS: Benefit[] = ["livelihood", "medical", "housing", "education", "near_poverty"];
const PRIORITY = /(저소득|기초\s*생활\s*수급자?|수급자|차상위\s*(계층)?|취약\s*계층|의료\s*급여\s*수급자|기초\s*연금\s*수급자)[^.。\n]{0,15}우선/g;
const EXCLUDED = /(수급자|차상위|의료\s*급여)[^.。\n]{0,8}(은|는)?\s*제외/;
const RECIPIENT_RE = /(기초\s*생활\s*(보장\s*)?수급|생계\s*급여|의료\s*급여|주거\s*급여|수급자|수급권자|차상위|(?:생계|의료|주거|교육)(?:\s*[·,ㆍ]\s*(?:생계|의료|주거|교육))*\s*수급\s*(?:가구|세대))/;
const LOW_RE = /(저소득|취약\s*계층|형편이?\s*어려운|생계가?\s*어려운|경제적(으로)?\s*어려운|소외\s*계층|빈곤)/;
const MEDIAN_RE = /중위\s*(?:소득\s*)?(?:의\s*)?(\d{2,3})\s*%\s*(이하|이내|미만)/;
const RECIPIENT_PAREN = new RegExp(`${RECIPIENT_RE.source}\\s*\\(\\s*(?:기준\\s*)?중위`);
const DEFINED_LOW = /(저소득\s*층?|소외\s*계층|취약\s*계층)[^()\n]{0,6}\(([^()]*)\)/g;
const BASIC_PENSION_RE = /기초\s*연금\s*(수급|대상|받)/;

/** 기초생활보장이 아닌 다른 제도의 '수급자' (기초연금은 따로 기초연금 관문으로) */
const OTHER_RECIPIENT = /((?:\d\s*[~∼-]\s*)?\d\s*등급(?:을\s*받은)?|등급을\s*받은|장기\s*요양(?:\s*보험)?(?:\s*급여)?|활동\s*지원(?:\s*급여)?|기초\s*연금|장애인\s*연금|국민\s*연금|공무원\s*연금|실업\s*급여|구직\s*급여|산재\s*보험|보훈\s*급여|연금)\s*(?:수급권자|수급자|수급)/g;
/** '소득 기준과 무관하게 신청 가능' — 소득·수급 관문 없음 */
const INCOME_FREE = /소득\s*(기준|수준)[과와]?\s*(무관|관계\s*없)/;
const ANY_GATE = new RegExp(`${RECIPIENT_RE.source}|${LOW_RE.source}|${MEDIAN_RE.source}|기초\\s*연금`);

function leavesOf(c: Cond | null, out: Leaf[] = []): Leaf[] {
  if (!c) return out;
  if ("all" in c) c.all.forEach((x) => leavesOf(x, out));
  else if ("any" in c) c.any.forEach((x) => leavesOf(x, out));
  else out.push(c);
  return out;
}

/**
 * '수급·차상위 또는 저소득(추정 비율)' 묶음 (QA 3차 R3: 디딤씨앗통장·드림스타트 수기 규칙) — 소득 잎이 soft(원문에 비율 없음)이면
 * 수급 여부를 모르는 채 소득만으로 '받으실 수 있어요'로 두지 않는다.
 */
const RECIPIENT_GROUP = /수급|차상위|보호대상|취약계층/;
export function recipientOrGuessedIncome(c: Cond | null): boolean {
  if (!c || !("all" in c || "any" in c)) return false;
  if ("any" in c) {
    const ls = c.any.filter((x): x is Leaf => !("all" in x || "any" in x));
    const rec = ls.some((l) => l.field === "benefit" && "anyOf" in l && (l.anyOf as string[]).some((k) => (RECIPIENT_KINDS as string[]).includes(k)));
    // 묶음 이름이 수급·차상위·보호대상·취약계층인 경우만 (그냥 '저소득 가구'는 소득 기준 사업도 많아 그대로)
    if (rec && ls.some((l) => l.field === "income" && l.soft && RECIPIENT_GROUP.test(l.label))) return true;
    return c.any.some(recipientOrGuessedIncome);
  }
  return c.all.some(recipientOrGuessedIncome);
}

type GateInfo = { gate: Gate | null; priority: boolean; partial: boolean; partialRec?: boolean };
const gateCache = new WeakMap<Program, GateInfo>();

/**
 * 규칙이 소득·수급을 다루지 않는데 원문에 소득·수급 대상이 적힌 경우의 관문.
 *  - 읽는 곳: 이름 + 지원 대상(앞 300자). 대상이 비어 있으면 요약의 앞부분(20자 안)만
 *  - '…우선' 은 관문이 아님 (priority 로 따로 알림)
 *  - 대상이 여러 유형(○ 줄)으로 나뉘고 소득·수급 조건이 없는 유형이 있으면 관문 없음 (partial)
 */
/** 수급·차상위와 나란히 적히는 다른 대상 집단 (한 줄 목록에서 '수급자 전용'이 아님을 알아보려고) */
// (나이·노인·청년은 '65세 이상 의료급여 수급권자'처럼 함께 맞아야 하는 조건으로 쓰여서 넣지 않음)
const OTHER_GROUP = /장애|유공|보훈|한부모|조손|다문화|탈북|북한\s*이탈|다자녀|임산부|독립|5\s*[.·]\s*18|의사자|의상자/;
const RECIPIENT_RE_G = new RegExp(RECIPIENT_RE.source, "g");
/** 수급자를 빼는 줄 ('생계 및 의료급여 대상자가 아닌 자') */
const NEG_REC_LINE = /[^\n]*(?:수급|급여|차상위)[^\n]*(?:아닌\s*(?:자|사람|분|가구)|아니어야)[^\n]*/g;
const NEG_REC = new RegExp(NEG_REC_LINE.source);
export function textGate(p: Program): GateInfo {
  const hit = gateCache.get(p);
  if (hit) return hit;
  const target = (p.target ?? "").replace(/&#13;/g, "\n").slice(0, 300);
  const summary = p.summary ?? "";
  const lead = target.trim() ? target : summary.slice(0, 20);
  const raw = `${p.name}\n${lead}`;
  const text = raw.replace(PRIORITY, " ");
  const priority = text !== raw || PRIORITY.test(summary);
  PRIORITY.lastIndex = 0;
  let gate: Gate | null = null;
  let partial = false;
  let partialRec = false;
  // 규칙이 수급을 '확정 조건'으로 다루면 관문을 따로 두지 않는다 (soft = 원천 태그처럼 배타적이지 않은 신호는 제외).
  // 소득 조건(API 코드)이 있어도 원문 대상이 '수급자·차상위'뿐이면 그 문구가 더 좁으므로 관문으로 본다
  //   예) 문화누리카드: 코드는 '중위 75% 이하', 원문은 '기초생활수급자 및 차상위계층' → 수급·차상위 아님이면 뺀다
  const leaves = leavesOf(p.rule.logic);
  const benefitHandled = leaves.some((l) => !l.soft && l.field === "benefit");
  const incomeMax = leaves
    .filter((l) => !l.soft && (l.field === "income" || l.field === "incomeBands"))
    .reduce((m, l) => Math.max(m, l.field === "income" ? l.lte : l.field === "incomeBands" ? Math.max(...l.bands.map((x) => x[1] ?? Infinity)) : 0), -1);
  const hasIncome = incomeMax >= 0;
  // 규칙의 '묻지 않는 조건'에 저소득이 적힌 경우 (예: '부모와 따로 사는 저소득 청년')
  const unaskedLow = leaves.find((l) => l.field === "unasked" && !l.soft && LOW_RE.test(l.label));
  if (!benefitHandled && !EXCLUDED.test(text)) {
    // 대상 문구의 유형 줄(○·• 등)만 센다 — 이름 줄과 '*', '※' 로 시작하는 덧붙임 줄은 빼고
    const nameGate = ANY_GATE.test(p.name);
    const lead2 = text.slice(text.indexOf("\n") + 1).replace(/[※*]/g, "\n$&");
    const lines0 = lead2.split(/\n|○|•|·\s(?=\S)/).map((l) => l.trim()).filter((l) => l.length > 4 && !/^[※*]/.test(l));
    // 시설·기관 유형 줄(예: '사회복지시설')은 개인 판정에서 뺀다 — 개인은 나머지 유형으로 (QA 2차 C3: 고효율조명기기)
    const personLines = lines0.filter((l) => !FACILITY_LINE.test(l));
    const lines = personLines.length ? personLines : lines0;
    const gated = lines.filter((l) => ANY_GATE.test(l));
    // 관문 낱말은 이름과 유형 줄에서만 찾는다 (덧붙임 줄의 '활동지원 수급자였다가' 같은 말은 대상 조건이 아님)
    // '장기요양 수급자'·'활동지원 수급자'·'기초연금 수급자' 같은 말의 '수급자'는 기초생활수급이 아님
    const core = `${p.name}\n${lines.join("\n")}`.replace(OTHER_RECIPIENT, (_m, w: string) => (/기초\s*연금/.test(w) ? "기초연금 받는 분" : " ")).replace(/(건강\s*보험\s*적용자\s*\+?\s*)?의료\s*급여\s*적용자/g, " ");
    // 장기요양·활동지원 사업 안에서 홀로 쓰인 '수급자'는 그 제도의 수급자 (예: '시설급여 가능한 수급자')
    const coreX0 = /장기\s*요양|요양\s*등급|활동\s*지원/.test(core) ? core.replace(/(?<!기초\s*생활\s*)(?<!급여\s*)수급(?:권)?자/g, " ") : core;
    // (QA 9차) '생계 및 의료급여 대상자가 아닌 자'처럼 수급자를 빼는 줄은 수급 관문이 아님 (한부모가정 의료보험)
    const coreX = coreX0.replace(NEG_REC_LINE, " ");
    if (INCOME_FREE.test(text)) partial = false;
    else if (!nameGate && lines.length >= 2 && gated.length && gated.length < lines.length) {
      partial = true;
      // 유형 중 하나가 수급·차상위 (예: 장제급여 — 수급자 사망 / 의사자) → 수급·차상위가 아니면 다른 유형인지 확인해야 함
      partialRec = gated.some((l) => { const x = l.replace(/^(저소득\s*층?|취약\s*계층)\s*[:：]/, ""); return RECIPIENT_RE.test(x.replace(OTHER_RECIPIENT, " ")) && !LOW_RE.test(x) && !MEDIAN_RE.test(x); });
    }
    else {
      const m = MEDIAN_RE.exec(coreX);
      const rec = RECIPIENT_RE.exec(coreX);
      // 이름의 '취약계층'·'저소득' 같은 넓은 말은 대상 문구가 수급·차상위로 좁혀 두었으면 보지 않는다
      //   예) '경기도 취약계층 주택화재 안심보험' — 대상: 기초생활보장수급자와 차상위계층
      // '경제적 소외계층(기초생활수급자, 차상위계층)' 처럼 괄호로 풀어 쓴 넓은 말도 (괄호 안에 '등'이 없으면) 수급·차상위
      const linesX = coreX.slice(coreX.indexOf("\n") + 1).replace(DEFINED_LOW, (all, _w: string, inner: string) => (RECIPIENT_RE.test(inner) && !/등|포함|중위|소득/.test(inner) ? inner : all));
      const low = rec && !RECIPIENT_RE.test(p.name) ? LOW_RE.exec(linesX) : LOW_RE.exec(coreX);
      if (rec && RECIPIENT_PAREN.test(coreX)) {
        // '생계·의료수급가구(중위 40% 이하)' — 괄호의 비율은 수급 가구 설명일 뿐, 대상은 수급 가구
        gate = { kind: "recipient", text: rec[0] };
      } else if (m) {
        // 원문 비율이 소득 코드보다 좁을 때만 관문 (넓히지 않음 — QA 1차 C3: 원문 120%인데 코드는 200%까지)
        const pct = Number(m[1]);
        if (!hasIncome || pct < incomeMax) gate = { kind: "median", pct, text: m[0] };
      } else if (rec) {
        // 원문 대상이 '수급자·차상위'뿐이면 소득 코드(0~50%)가 있어도 수급·차상위 여부로 정한다
        //   (QA 1차 C3: 소득 구간만 맞는 비수급자에게 '의료급여 틀니'가 '받으실 수 있어요'로 나옴)
        // '저소득' 같은 넓은 말이 함께 있으면 소득 코드가 50% 이하일 때 코드로 충분
        if (low) {
          if (!hasIncome || incomeMax > 50) gate = { kind: "low", text: low[0] };
        } else if (OTHER_GROUP.test(linesX.replace(RECIPIENT_RE_G, " ").replace(OTHER_RECIPIENT, " "))) {
          // (QA 9차 검토) '기초생활수급자, 차상위계층, 장애인, 국가유공자'처럼 한 줄에 다른 대상 집단이 함께 있음 → 수급·차상위가 아니면 다른 유형인지 확인
          partial = true;
          partialRec = true;
        } else gate = { kind: "recipient", text: rec[0] };
      } else if (low) {
        if (!hasIncome) gate = { kind: "low", text: low[0] };
      } else if (BASIC_PENSION_RE.test(coreX) && !hasIncome) gate = { kind: "basicPension", text: "기초연금 수급" };
    }
    if (!gate && !partial && !hasIncome && unaskedLow) gate = { kind: "low", text: LOW_RE.exec(unaskedLow.label)![0] };
  }
  // (QA 2차 C3) 원문(선정기준 전문 포함)이 수급·차상위인데 규칙은 소득 코드 0~50%뿐 (refine.ts recBand)
  //  → 소득 구간만 맞는 비수급자는 '신청할 때 확인' (수급·차상위면 그대로)
  // ('생계 및 의료급여 대상자가 아닌 자'처럼 수급자를 빼는 원문은 제외)
  if (p.rule.recBand && gate?.kind !== "recipient" && !NEG_REC.test(p.target ?? "")) partialRec = true;
  const out: GateInfo = { gate, priority, partial, ...(partialRec ? { partialRec } : {}) };
  gateCache.set(p, out);
  return out;
}

/** 이름에 숫자가 없는 '저소득'의 기준으로 보는 선 (차상위 50% + 여유) */
export const LOW_INCOME_PCT = 60;

type GateState = "met" | "no" | "unknown";

function incomeTri(prof: Profile, pct: number, exact: number | null = null): GateState {
  if (exact !== null) return exact <= pct ? "met" : "no";
  if (prof.income === "unknown") return "unknown";
  const [lo, hi] = incomeRange(prof.income);
  if (hi <= pct) return "met";
  if (lo >= pct) return "no";
  return "unknown";
}

export function gateState(g: Gate, s: Situation, prof: Profile): GateState {
  const b = inferExtras(s).benefits;
  const anyRec = RECIPIENT_KINDS.some((k) => b[k] === true);
  const noRec = RECIPIENT_KINDS.every((k) => b[k] === false);
  switch (g.kind) {
    case "recipient":
      return anyRec ? "met" : noRec ? "no" : "unknown";
    case "low": {
      if (anyRec) return "met";
      return incomeTri(prof, LOW_INCOME_PCT, incomePctOf(s));
    }
    case "median": {
      if (anyRec && g.pct >= 50) return "met";
      return incomeTri(prof, g.pct, incomePctOf(s));
    }
    case "basicPension":
      return b.basic_pension === true ? "met" : b.basic_pension === false ? "no" : "unknown";
  }
}

/* ---------------- 추가 질문 (차원) ---------------- */

export type DimId = "age" | "support" | "basicPension" | "income" | "disability" | "care" | "ltcGrade" | "alone" | "veteran" | "singleParent" | "multicultural" | "housing" | "activity" | "illness" | "children" | "daycare";

export interface Answer {
  key: string;
  label: string;
  apply: (s: Situation) => Situation;
}

export interface Dim {
  id: DimId;
  /** 질문 (부모님/본인 말투 · 이미 아는 답에 맞춰) */
  q: (mode: FindMode, s?: Situation) => string;
  help?: string;
  answers: Answer[];
  isUnknown: (s: Situation) => boolean;
  /** 이 상황(본인/부모님·나이)에서 물을 수 있는 질문인지 (없으면 언제나) */
  avail?: (s: Situation) => boolean;
  /** 이미 아는 답과 어긋나는 보기를 뺀다 (예: 자녀 수를 알면 '자녀 없음') */
  hide?: (a: Answer, s: Situation) => boolean;
}

/** 이 상황에서 보여줄 보기 */
export const answersFor = (d: Dim, s: Situation) => (d.hide ? d.answers.filter((a) => !d.hide!(a, s)) : d.answers);

/** 60세 이상인지: 'yes' | 'no' | 'unknown' (나이 범위를 말했으면 범위로 — '30대'는 'no') */
const seniorOf = (s: Situation) => {
  if (s.profile.age !== "unknown") return ageRange(s.profile.age)[1] >= 60 ? "yes" : "no";
  const sp = s.x.ageSpan;
  if (!sp) return "unknown";
  return sp[0] >= 60 ? "yes" : sp[1] < 60 ? "no" : "unknown";
};
/** 기초연금·장기요양 질문: 부모님 찾기는 나이를 모를 때도, 본인 찾기는 60세 이상이라고 답했을 때만 */
const seniorQuestion = (s: Situation) => (s.mode === "self" ? seniorOf(s) === "yes" : seniorOf(s) !== "no");
/** 자녀·임신 질문: 본인 찾기에서 60세 미만(또는 나이 모름)일 때만 */
/** 만 19세 미만 본인 (QA 5차 검증 N2, 7차 T1) */
export const teenSelf = (s: Situation) => s.mode === "self" && (ageBoundsOf(s)?.[1] ?? 120) <= 18;
/**
 * (QA 8차) 본인 찾기에서 자녀가 없다고 답함 (임신 중 아님, 10대 본인 아님) → '혼자 자녀를 키우는 한부모 가구'는 아님.
 * 입력 화면도 자녀 없음이면 한부모를 묻지 않는다 — 결과 화면에서 다시 묻지 않게.
 */
export const noChildSelf = (s: Situation) =>
  s.mode === "self" && !teenSelf(s) && (s.x.childCount === 0 || (Array.isArray(s.profile.children) && s.profile.children.length === 0)) && !(s.profile.children ?? []).includes("pregnant");
/** 자녀가 있어야 받는 사업 (자녀·자녀 나이 조건) — 10대 본인 화면의 금액 예시에서 뺀다 (QA 7차 T1) */
export const needsChildren = (p: Program) =>
  leavesOf(p.rule.logic).some((l) => !l.soft && (l.field === "children" || l.field === "childAge")) && evaluateRule(p.rule, { ...EMPTY_PROFILE, children: [] }).tier === "ineligible";
// 10대 본인에게는 자녀 질문을 하지 않는다 (QA 7차 T1: '학교 안 다니는 열여섯살'에 '함께 사는 자녀가 있나요?')
const childQuestion = (s: Situation) => s.mode === "self" && seniorOf(s) !== "yes" && !teenSelf(s);

/** 자녀가 있다고 했지만 자녀 나이·본인 나이를 모름 ('아이 키우는 엄마 안산') → 자녀 나이부터 묻는다 (결정 2b, 인수 문서 K1) */
export const childAgeFirst = (s: Situation) => s.mode === "self" && s.profile.children === null && (s.x.childCount ?? 0) > 0 && s.profile.age === "unknown";
export const dimAvailable = (d: Dim, s: Situation) => !d.avail || d.avail(s);

const withX = (s: Situation, patch: Partial<Extras>): Situation => ({ ...s, x: { ...s.x, ...patch } });
const withP = (s: Situation, patch: Partial<Profile>): Situation => ({ ...s, profile: { ...s.profile, ...patch } });
const setBenefits = (s: Situation, on: Benefit[], off: Benefit[]): Situation => {
  const b = { ...s.x.benefits };
  on.forEach((k) => (b[k] = true));
  off.forEach((k) => (b[k] = false));
  return withX(s, { benefits: b });
};
const subj = (mode: FindMode, self: string, parent: string) => (mode === "parent" ? parent : self);

/** 기초생활보장 급여는 소득 기준이 겹친다 (생계 32% ⊂ 의료 40% ⊂ 주거 48% ⊂ 교육 50%) → '가장 높은 단계 하나'만 고르면 된다 */
export const SUPPORT_LEVELS: { key: string; label: string; plain: string; on: Benefit[] }[] = [
  { key: "livelihood", label: "생계급여", plain: "매달 생활비", on: ["livelihood", "medical", "housing"] },
  { key: "medical", label: "의료급여", plain: "병원비를 의료급여증으로", on: ["medical", "housing"] },
  { key: "housing", label: "주거급여만", plain: "월세·집수리 지원만", on: ["housing"] },
  { key: "near_poverty", label: "차상위계층", plain: "차상위 확인서 있음", on: ["near_poverty"] },
];

export const DIMS: Dim[] = [
  {
    id: "support",
    q: (m) => subj(m, "주민센터에서 기초생활보장(생계·의료·주거급여)이나 차상위 지원을 받고 계신가요?", "부모님이 주민센터에서 기초생활보장(생계·의료·주거급여)이나 차상위 지원을 받고 계신가요?"),
    help: "‘수급자’, ‘차상위’라고 적힌 혜택은 이 답 하나로 정해져요.",
    // 이미 '기초수급자'·'차상위'라고 말했으면 다시 묻지 않는다 (QA 3차 M2) — 아니라고 했으면 모두 false라 묻지 않음
    isUnknown: (s) => {
      const b = inferExtras(s).benefits;
      return !RECIPIENT_KINDS.some((k) => b[k] === true) && RECIPIENT_KINDS.some((k) => b[k] === undefined);
    },
    answers: [
      { key: "none", label: "아니요, 받지 않아요", apply: (s) => setBenefits(s, [], RECIPIENT_KINDS) },
      ...SUPPORT_LEVELS.map((l) => ({
        key: l.key, label: `예 — ${l.label}`,
        apply: (s: Situation) => setBenefits(s, l.on, RECIPIENT_KINDS.filter((k) => !l.on.includes(k))),
      })),
    ],
  },
  {
    id: "basicPension",
    q: (m) => subj(m, "기초연금을 받고 계신가요?", "부모님이 기초연금을 받고 계신가요?"),
    help: "만 65세 이상 중 소득·재산이 적은 70%가 받는 연금이에요 (국민연금과 달라요).",
    isUnknown: (s) => s.x.benefits.basic_pension === undefined && (ageBoundsOf(s)?.[1] ?? 120) >= 65,
    avail: seniorQuestion,
    answers: [
      { key: "yes", label: "예", apply: (s) => setBenefits(s, ["basic_pension"], []) },
      { key: "no", label: "아니요", apply: (s) => setBenefits(s, [], ["basic_pension"]) },
    ],
  },
  {
    id: "income",
    q: (m, s) =>
      s && teenSelf(s)
        ? "집 전체(부모님·보호자 포함) 한 달 소득은 얼마쯤인가요? 잘 모르면 '모름'을 눌러도 돼요."
        : subj(m, "가구 전체의 한 달 소득은 얼마쯤인가요?", "부모님 가구의 한 달 소득은 얼마쯤인가요?"),
    help: "일해서 버는 돈·연금·임대료 등을 모두 더한 금액이에요. 대략이면 충분해요.",
    isUnknown: (s) => s.x.incomeManwon === null && s.profile.income === "unknown",
    answers: INCOME_BANDS.map((b) => ({ key: b, label: b, apply: (s: Situation) => withP(withX(s, { incomeManwon: null }), { income: b }) })),
  },
  {
    id: "disability",
    q: (m) => subj(m, "장애인으로 등록되어 있나요?", "부모님 중 장애인으로 등록된 분이 있나요?"),
    isUnknown: (s) => s.profile.disability === "unknown",
    answers: [
      { key: "none", label: "아니요", apply: (s) => withP(s, { disability: "none", disabilitySeverity: "unknown" }) },
      { key: "severe", label: "예 — 심한 장애", apply: (s) => withP(s, { disability: "self", disabilitySeverity: "severe" }) },
      { key: "mild", label: "예 — 심하지 않은 장애", apply: (s) => withP(s, { disability: "self", disabilitySeverity: "mild" }) },
    ],
  },
  {
    id: "care",
    q: (m) => subj(m, "식사·거동·외출 같은 일상생활에 다른 사람의 도움이 필요한가요?", "부모님이 식사·거동·외출 같은 일상생활에 도움이 필요하신가요?"),
    isUnknown: (s) => s.profile.care === null,
    answers: [
      { key: "yes", label: "예", apply: (s) => withP(s, { care: ["daily"] }) },
      { key: "no", label: "아니요", apply: (s) => withP(s, { care: [] }) },
    ],
  },
  {
    id: "ltcGrade",
    q: (m) => subj(m, "건강보험공단에서 장기요양등급(1~5등급·인지지원등급)을 받으셨나요?", "부모님이 건강보험공단에서 장기요양등급(1~5등급·인지지원등급)을 받으셨나요?"),
    isUnknown: (s) => s.x.facts.ltcGrade === undefined,
    avail: seniorQuestion,
    answers: [
      { key: "yes", label: "예", apply: (s) => withX(s, { facts: { ...s.x.facts, ltcGrade: true } }) },
      { key: "no", label: "아니요", apply: (s) => withX(s, { facts: { ...s.x.facts, ltcGrade: false } }) },
    ],
  },
  {
    // 가구원 수 (QA 1차 H2·M2: 소득 기준·1인 가구 혜택이 이 답으로 정해짐) — id 는 예전 '혼자 사세요?' 질문과 같게 둔다
    id: "alone",
    q: (m) => subj(m, "함께 사는 가족은 본인 포함 몇 명인가요?", "부모님 댁에는 부모님 포함 몇 분이 사시나요?"),
    help: "소득 기준(기준 중위소득)과 1인 가구 혜택이 이 답으로 정해져요.",
    isUnknown: (s) => s.profile.householdSize === "unknown",
    answers: [
      { key: "yes", label: "1명 (혼자)", apply: (s) => withP(s, { householdSize: 1 }) },
      ...([2, 3, 4, 5] as const).map((n) => ({ key: String(n), label: `${n}명`, apply: (s: Situation) => withP(s, { householdSize: n }) })),
      { key: "6", label: "6명 이상", apply: (s) => withP(s, { householdSize: 6 }) },
    ],
  },
  {
    // 나이 (QA 1차 H2: 나이를 모르면 나이로 정해지는 혜택이 많아 가장 먼저 묻는다)
    id: "age",
    q: (m) => subj(m, "나이(만)가 어떻게 되세요?", "부모님 나이(만)가 어떻게 되세요?"),
    isUnknown: (s) => s.profile.age === "unknown",
    hide: (a, s) => {
      if (s.mode === "parent" && ["0-18", "19-24", "25-29", "30-34", "35-39"].includes(a.key)) return true;
      // '30대'처럼 범위를 말했으면 그 범위 안의 보기만
      const sp = s.x.ageSpan;
      if (!sp) return false;
      const [lo, hi] = ageRange(a.key as Exclude<Profile["age"], "unknown">);
      return hi < sp[0] || lo > sp[1];
    },
    answers: AGE_BANDS.filter((b) => b !== "0-18").map((b) => ({ key: b, label: AGE_LABEL[b], apply: (s: Situation) => withP(s, { age: b }) })),
  },
  {
    id: "veteran",
    q: (m) => subj(m, "국가유공자·참전유공자 등 보훈 대상이신가요?", "부모님이 국가유공자·참전유공자 등 보훈 대상이신가요?"),
    isUnknown: (s) => s.x.traits.veteran === undefined,
    answers: [
      { key: "yes", label: "예", apply: (s) => withX(s, { traits: { ...s.x.traits, veteran: true } }) },
      { key: "no", label: "아니요", apply: (s) => withX(s, { traits: { ...s.x.traits, veteran: false } }) },
    ],
  },
  {
    id: "singleParent",
    q: (m) => subj(m, "혼자 자녀를 키우는 한부모 가구인가요? (조부모가 손주를 키우는 조손 가구 포함)", "부모님이 손주를 키우고 계신가요 (조손 가구)?"),
    isUnknown: (s) => s.x.traits.single_parent === undefined && !noChildSelf(s),
    answers: [
      { key: "yes", label: "예", apply: (s) => withX(s, { traits: { ...s.x.traits, single_parent: true } }) },
      { key: "no", label: "아니요", apply: (s) => withX(s, { traits: { ...s.x.traits, single_parent: false } }) },
    ],
  },
  {
    id: "multicultural",
    q: (m) => subj(m, "다문화 가족(결혼이민)이거나 북한이탈주민인가요?", "부모님이 다문화 가족이거나 북한이탈주민이신가요?"),
    isUnknown: (s) => s.x.traits.multicultural === undefined,
    answers: [
      { key: "yes", label: "예", apply: (s) => withX(s, { traits: { ...s.x.traits, multicultural: true } }) },
      { key: "no", label: "아니요", apply: (s) => withX(s, { traits: { ...s.x.traits, multicultural: false } }) },
    ],
  },
  {
    id: "housing",
    q: (m) => subj(m, "사는 집은 어떤 형태인가요?", "부모님 댁은 어떤 형태인가요?"),
    isUnknown: (s) => s.profile.housing === "unknown",
    answers: (["own", "jeonse", "monthly", "public_rental"] as const).map((h) => ({
      key: h, label: { own: "자가", jeonse: "전세", monthly: "월세", public_rental: "공공임대" }[h], apply: (s: Situation) => withP(s, { housing: h }),
    })),
  },
  {
    id: "activity",
    q: (m) => subj(m, "지금 일을 하고 계신가요?", "부모님이 지금 일을 하고 계신가요?"),
    isUnknown: (s) => s.profile.activity === "unknown",
    answers: [
      { key: "employed", label: "예, 직장에 다녀요", apply: (s) => withP(s, { activity: "employed" }) },
      { key: "self_employed", label: "자영업", apply: (s) => withP(s, { activity: "self_employed" }) },
      { key: "job_seeking", label: "일자리를 찾고 있어요", apply: (s) => withP(s, { activity: "job_seeking" }) },
      { key: "student", label: "학생", apply: (s) => withP(s, { activity: "student" }) },
      { key: "none", label: "아니요", apply: (s) => withP(s, { activity: "none" }) },
    ],
  },
  {
    id: "illness",
    q: (m) => subj(m, "치매·암·희귀질환 등 진단받고 치료 중인 병이 있나요?", "부모님 중 치매·암·희귀질환 등 진단받고 치료 중인 병이 있으신가요?"),
    isUnknown: (s) => s.x.facts.illness === undefined,
    answers: [
      { key: "yes", label: "예", apply: (s) => withX(s, { facts: { ...s.x.facts, illness: true } }) },
      { key: "no", label: "아니요", apply: (s) => withX(s, { facts: { ...s.x.facts, illness: false } }) },
    ],
  },
  {
    // (QA 8차) 보육료(어린이집 이용)와 가정양육수당(이용 안 함)은 함께 받을 수 없어 이 답으로 정해진다
    id: "daycare",
    q: (m) => subj(m, "자녀가 어린이집이나 유치원에 다니나요?", "손주가 어린이집이나 유치원에 다니나요?"),
    help: "어린이집·유치원에 다니면 보육료·유아학비를, 집에서 키우면 가정양육수당을 받아요 (둘 다 받을 수는 없어요).",
    isUnknown: (s) => s.x.facts.daycare === undefined && s.x.facts.homeCare === undefined,
    answers: [
      { key: "yes", label: "예, 다녀요", apply: (s) => withX(s, { facts: { ...s.x.facts, daycare: true, homeCare: false } }) },
      { key: "no", label: "아니요, 집에서 키워요", apply: (s) => withX(s, { facts: { ...s.x.facts, daycare: false, homeCare: true } }) },
      { key: "both", label: "다니는 아이도, 집에 있는 아이도 있어요", apply: (s) => withX(s, { facts: { ...s.x.facts, daycare: true, homeCare: true } }) },
    ],
  },
  {
    id: "children",
    q: (_m, s) =>
      s?.x.family === "children" || s?.x.family === "both" ? "가장 어린 자녀는 몇 살인가요?" :
      s?.x.childCount ? `자녀${s.x.childCount === 3 ? "(3명 이상)" : ` ${s.x.childCount}명`}의 나이는요? (여럿이면 가장 어린 자녀)` : "함께 사는 자녀가 있나요? (임신 중이면 '임신 중')",
    help: "자녀가 여럿이면 가장 어린 자녀를 고르고, '상황 고치기'에서 모두 고를 수 있어요.",
    isUnknown: (s) => s.profile.children === null,
    avail: childQuestion,
    hide: (a, s) => (s.x.family === "children" || s.x.family === "both")
      ? a.key === "none" || a.key === "pregnant"
      : a.key === "none" && !!s.x.childCount,
    answers: [
      { key: "none", label: "자녀 없음", apply: (s) => withX(withP(s, { children: [] }), { childCount: 0 }) },
      ...(["pregnant", "0-1", "2-5", "6-12", "13-18", "19+"] as const).map((c) => ({
        key: c,
        label: CHILD_LABEL[c],
        apply: (s: Situation) => withP(s, { children: s.x.family === "both" && c !== "pregnant" ? [c, "pregnant"] : [c] }),
      })),
    ],
  },
];
export const DIM_BY_ID = Object.fromEntries(DIMS.map((d) => [d.id, d])) as Record<DimId, Dim>;

/** 이 사업의 판정에 영향을 줄 수 있는 질문 (규칙의 잎 조건 + 원문 관문) */
export function dimsFor(p: Program): DimId[] {
  const out = new Set<DimId>();
  for (const l of leavesOf(p.rule.logic)) {
    switch (l.field) {
      case "benefit":
        if (l.anyOf.some((b) => RECIPIENT_KINDS.includes(b))) out.add("support");
        if (l.anyOf.includes("basic_pension")) out.add("basicPension");
        break;
      case "age": out.add("age"); break;
      case "income": case "incomeBands": out.add("income"); out.add("alone"); break;
      case "disability": out.add("disability"); break;
      case "care": out.add("care"); break;
      case "trait":
        if (l.anyOf.includes("veteran")) out.add("veteran");
        if (l.anyOf.includes("single")) out.add("alone");
        if (l.anyOf.includes("single_parent")) out.add("singleParent");
        if (l.anyOf.includes("multicultural")) out.add("multicultural");
        break;
      case "householdSize": out.add("alone"); break;
      case "housing": out.add("housing"); break;
      case "activity": out.add("activity"); break;
      case "children": case "childAge": out.add("children"); break;
      case "unasked":
        for (const [k, re] of Object.entries(FACT_PATTERNS)) {
          if (!re.test(l.label)) continue;
          out.add(k === "pension70" ? "basicPension" : k === "homeCare" ? "daycare" : (k as DimId));
        }
        break;
    }
  }
  const { gate } = textGate(p);
  if (gate?.kind === "recipient") out.add("support");
  if (gate?.kind === "low" || gate?.kind === "median") {
    out.add("support");
    out.add("income");
    out.add("alone");
  }
  if (gate?.kind === "basicPension") out.add("basicPension");
  return [...out];
}

/* ---------------- 분류 ---------------- */

/** fit: 답한 내용으로 조건이 모두 맞음 / open: 아직 정해지지 않음 / no: 답한 내용과 맞지 않음 */
export type Base = "fit" | "autoFit" | "open" | "no";

export interface BaseResult {
  base: Base;
  ev: Evaluation;
  gate: Gate | null;
  gateState?: GateState;
  priority: boolean;
  /** 간편 입력으로 묻지 않는 대상 집단이라 '신청할 때 확인'으로 둔 이유 (예: 장애 유형) */
  why?: string;
  /** 신청하면 그 과정에서 정해지는 조건 (예: 장기요양등급 판정) — 미리 갖출 필요 없음 */
  process?: string;
}

/** 장기요양 '인정 신청' 자체 (등급은 신청하면 공단이 판정) — 등급을 받은 뒤의 급여·용구 사업은 제외 */
const LTC_APPLY = /^노인\s*장기\s*요양\s*보험$|장기\s*요양\s*(인정|등급\s*(신청|판정))/;
const LTC_AFTER = /(급여|용구|재가|시설|가족|요양보호사|본인\s*부담|감경)/;
const LTC_PROCESS = "신청하면 국민건강보험공단이 방문 조사로 장기요양등급을 정해요 (미리 등급이 없어도 돼요).";

/** 간편 입력이 묻지 않는 대상 집단 (이름에 적힘) → 조건이 다 맞아도 '신청할 때 확인' */
const OFFICE_GROUPS: [RegExp, string][] = [
  [/(발달\s*장애|지적\s*장애|자폐|시각\s*장애|중도\s*시각|청각\s*장애|언어\s*장애|지체\s*장애|뇌병변|척수\s*장애|정신\s*장애|신장\s*장애|농아|점자|수어|보조견)/, "장애 유형은 묻지 않았어요 — 이 유형에 해당하는지 신청할 때 확인"],
  [/(창업농|영농|후계농|교직원|공무원|광업|광산|탄광|진폐|분진\s*사업장|종사\s*근로자|간호사|간호조무사|요양보호사|건설\s*기능|건설\s*근로|건설\s*노동|농업인|어업인|임업인|농어업인|예술인|선원|해녀|장병|제대\s*군인|소방관|택시|화물)/, "직업·신분 조건이 있어요 — 해당하는지 신청할 때 확인"],
  [/(운영\s*지원|기관\s*지원|대관|설치\s*운영)/, "기관·시설을 지원하는 사업이에요 — 이용할 수 있는지 문의"],
  [/(도서민|섬\s*주민|도서\s*지역\s*주민)/, "사는 곳 조건(섬 지역)이 있어요 — 해당하는지 신청할 때 확인"],
];

/**
 * 직업·자격·추천이 있어야 하는 사업 (QA 2차 C3): 간편 입력은 직업·자격을 묻지 않으므로 '받으실 수 있어요'로 두지 않는다.
 * 이름이나 대상 문구 앞부분에서 찾는다 — 예) KPF 디플로마(언론인·추천), 대한민국명장(15년 이상 숙련기술자), 국제심판 양성
 */
// '기관·학교장 추천'은 선정 절차라 직업 조건이 아님 (일상돌봄·학비 지원 등 오탐) — 넣지 않는다.
// 공무원·교사·법인·종사자·재직은 '○○ 제외'·'시설 종사자'·'재직 중인 직장인'처럼 직업 조건이 아닌 쓰임이 많아 넣지 않는다 (직장 여부는 '하고 있는 일' 질문이 맡음).
export const OCCUPATION_RE = /(언론인|숙련\s*기술|명장|(?:국제|생활|전문)\s*심판|변리사|교원(?!\s*자녀)|체육인|운동\s*선수|선수\s*(?:출신|경력|등록)|(?:전문|생활)\s*체육\s*지도자|예술인|농업인|어업인|임업인|농어업인|어선원|소상공인|자영업자|개인\s*사업자|사업자\s*등록|창업(?:자|기업|\s*\d)|(?:중소|벤처|사회적)\s*기업\s*대표|기업\s*대표|자격증\s*(?:소지|보유|취득)|면허\s*(?:소지|보유)|\d+\s*년\s*이상\s*(?:종사|경력|숙련))/g;
const OCCUPATION_WHY = "직업·자격 조건이 있어요 (간편 입력으로는 묻지 않아요) — 해당하는지 신청할 때 확인";
/** 같은 줄에 이런 말이 있으면 직업 낱말은 조건이 아님: 제외 문구, 또는 일반 개인 유형과 나란히 적힌 경우 ('청년 근로자, 소상공인') */
const OCC_EXCLUDE = /(제외|아닌|불가|해당\s*없|해당하지|미해당)/;
const OCC_ORDINARY = /(근로자|노동자|피보험|고용보험|국민|주민|가구|주택|학생(?!\s*모집)|아동|청소년|노인|어르신|장애인|누구나|구직자|취업\s*준비생|사회\s*초년생|임산부|부모|다자녀|한부모|수급자|차상위|유공자|보훈)/;
/** 소득·관문 판정 전에 보는 대상 문구 앞부분 (유형 줄 몇 개) */
const leadText = (p: Program) => `${p.name}\n${(p.target ?? "").replace(/&#13;/g, "\n").slice(0, 250)}`;
export function needsOccupation(p: Program): boolean {
  if (leavesOf(p.rule.logic).some((l) => !l.soft && l.field === "activity")) return false;
  const text = leadText(p);
  // 대상 문구에 일반 개인 유형(근로자·주민·학생 등)이 함께 있으면 직업은 여러 대상 중 하나이거나 제외 대상 → 이름에 있을 때만
  const ordinary = OCC_ORDINARY.test(text.slice(p.name.length));
  for (const m of text.matchAll(OCCUPATION_RE)) {
    const idx = m.index ?? 0;
    if (idx < p.name.length) return true; // 이름에 있으면 (예: 대한민국명장, 언론인 금고)
    if (ordinary) continue;
    const start = Math.max(text.lastIndexOf("\n", idx), text.slice(0, idx).search(/[○ㅇ•□][^○ㅇ•□]*$/)) + 1;
    const endN = text.indexOf("\n", idx);
    const line = text.slice(start, endN < 0 ? undefined : endN);
    if (OCC_EXCLUDE.test(line) || OCC_ORDINARY.test(line)) continue;
    return true;
  }
  return false;
}
/**
 * 말하지 않은 신분·활동이 있어야 하는 사업 (QA 3차 C3 잔여·R2): 육아휴직·근로시간 단축 사용, 재직 기간, 자격 취득·응시,
 * 종사자·전문인력, 특정 분야 구직자, 대학 재학. 나이 코드만 맞는다고 '받으실 수 있어요'로 두지 않는다.
 * strong: 대상 문구 어디에 있어도 조건 (일반 개인 낱말이 함께 있어도). weak: 이름에 있거나, 대상에 일반 개인 유형이 없을 때만.
 */
/** 학교 밖·가정 밖·학업중단·고립은둔·위기 청소년 (QA 5차 C3b). '(위기)청소년'처럼 괄호로 덧붙인 말은 누구나 이용하는 상담이라 아님 */
export const YOUTH_STATUS_RE = /학교\s*밖|가정\s*밖|학업\s*(?:을\s*)?중단|미취학\s*[·ㆍ]?\s*학업|은둔\s*(?:형\s*)?(?:청년|청소년|고립)|고립\s*[·ㆍ]?\s*(?:은둔|운둔)|(?<!\()위기\s*청소년|가출\s*청소년|청소년\s*쉼터/;
/** 학교에 다니지 않는다는 처지 (학생이면 맞지 않음) */
export const OUT_OF_SCHOOL_RE = /학교\s*밖|학업\s*(?:을\s*)?중단|미취학\s*[·ㆍ]?\s*학업/;
function youthStatusLabel(m: string): string {
  if (/학교\s*밖/.test(m)) return "학교 밖 청소년";
  if (/가정\s*밖|가출|쉼터/.test(m)) return "가정 밖 청소년";
  if (/학업|미취학/.test(m)) return "학업 중단·미취학";
  if (/은둔|고립|운둔/.test(m)) return "고립·은둔 청년";
  return "위기 청소년";
}
type StatusKind = { re: RegExp; label: string; strong: boolean; lead?: number; skip?: (s: Situation) => boolean; coveredBy?: string; labelOf?: (m: string) => string; inclusive?: RegExp };
const STATUS_KINDS: StatusKind[] = [
  { re: /(육아기\s*근로\s*시간\s*단축|육아\s*휴직)[^\n]{0,30}(실시|사용|중인|한\s*(?:근로자|사람|자))|근로\s*시간\s*단축\s*급여|육아\s*휴직\s*등?\s*급여/, label: "육아휴직·근로시간 단축 사용", strong: true, lead: 160 },
  { re: /(산업체|기업)\s*재직\s*(?:기간|경력|요건)|재직\s*(?:기간|경력)\s*(?:이\s*)?\d|\d+\s*년\s*이상\s*재직|재직\s*요건/, label: "재직 기간·소속", strong: true },
  { re: /자격(?:증)?(?:을|의)?\s*취득(?:자|한\s*(?:사람|자|분))|자격증?\s*소지자|검정을\s*받으려는|시험\s*응시(?:자|료)|응시\s*(?:료|수수료)/, label: "자격 취득·시험 응시", strong: true },
  { re: /(?<![가-힣])(?:종사자|전문\s*인력|현장\s*교사|실습생을\s*지도|교원|강사|담당자|실무자)(?!\s*(?:제외|자녀))/, label: "종사자·전문인력", strong: false },
  { re: /\S+\s*분야\s*(?:구직자|취업\s*준비생)/, label: "특정 분야 구직·종사", strong: true },
  // (QA 3차 P5) 기능 판정 점수 — 장애인 대소변흡수용품 '수정바델지수 배뇨조절 2점 이하'
  { re: /바델\s*지수|배뇨\s*(?:·|,|및)?\s*(?:배변\s*)?조절|배변\s*(?:·|,|및)?\s*(?:배뇨\s*)?조절|일상\s*생활\s*(?:수행\s*)?능력\s*(?:평가|점수)|ADL\s*(?:평가|점수)/, label: "건강·기능 판정 (배뇨 조절 등)", strong: true },
  // (QA 4차 C3·S3) 특수 신분·사건 당사자 — 자녀·본인 나이 코드만으로 '받으실 수 있어요'가 되던 사업
  { re: /출생\s*(?:미등록|신고\s*(?:가\s*)?(?:되지|안\s*된|못\s*한))|출생\s*등록(?:을|이)?\s*(?:되지|못|안)|가족\s*관계\s*미등록/, label: "출생 등록이 안 된 아동", strong: true },
  { re: /소년\s*[·ㆍ]?\s*소녀\s*가장|소년\s*[·ㆍ]?\s*소녀\s*가정/, label: "소년·소녀가장 가정", strong: true, lead: 1 },
  // (QA 7차 P4) 소년법 보호처분 등 — 처분 여부는 간편 입력으로 묻지 않음 ('청소년회복지원시설운영' 대상: 제1호 보호자 감호위탁)
  { re: /소년법|보호\s*처분|감호\s*위탁|소년원|보호\s*관찰\s*(?:대상|청소년|중)/, label: "보호처분 등 법원 처분을 받은 청소년", strong: true },
  { re: /(?:특허\s*)?심판\s*(?:사건\s*)?(?:의\s*)?당사자|(?:소송|사건|재판|심판|분쟁)\s*(?:의\s*)?당사자|심판\s*청구인|구술\s*심리/, label: "심판·소송 사건 당사자", strong: true },
  { re: /대학(?:원)?\s*재학|대학(?:원)?생(?!\s*자녀)|사업\s*참여\s*대학/, label: "대학 재학", strong: false, skip: (s) => s.profile.activity === "student", coveredBy: "student" },
  // (QA 5차 C3b) 학교 밖·가정 밖·학업중단·고립은둔·위기 청소년 — 나이 코드(9~24세)만으로 '받으실 수 있어요'가 되던 사업.
  // 대상 문구에서는 그 처지만 적힌 줄일 때만 조건 ('중고생 및 학교 밖 청소년', '학교 밖 청소년 포함'처럼 일반 학생과 함께면 조건 아님)
  // (QA 5차) 이름에 특별한 처지(시설 보호·위탁·자립준비·출소 등)가 적힌 사업 — 이름만 본다 (lead 1)
  { re: /(출소|자살\s*(?:시도|유족)|보호\s*대상\s*아동|유기\s*(?:및|·)?\s*위기\s*아동|가정\s*위탁|위탁\s*(?:아동|가정|부모)|아동\s*복지\s*시설|시설\s*(?:보호|입소|퇴소)|자립\s*준비|보호\s*종료|요보호|그룹\s*홈|공동\s*생활\s*가정)/, label: "특별한 처지", strong: true, lead: 1, labelOf: (m) => m.replace(/\s+/g, " ") },
  // (QA 5차 검증 N5) 청년도전지원사업: 대상이 구직단념청년(6개월간 취업·교육·훈련 이력 없음)·자립준비청년 등 — '다문화·북한이탈'이 아님
  // (QA 8차) 원문 대상이 '취업면접에 참여한 청년'·'훈련을 이수한 자'처럼 이미 한 일을 요구 — 간편 입력으로는 알 수 없음 (면접수당이 '받으실 수 있어요'였음)
  {
    re: /[가-힣]{0,6}(?:면접|시험|교육|훈련|과정|프로그램)(?:에|을|를)?\s*(?:참여|참가|응시|수료|이수)한(?:\s*(?:자|사람|청년|분|학생))?/,
    label: "원문에 적힌 참여·이수 조건",
    strong: true,
    labelOf: (m) => `${m.replace(/\s*(?:자|사람|분)$/, "").trim()} 분`.replace(/(청년|학생) 분$/, "$1"),
  },
  { re: /구직\s*단념\s*청년/, label: "구직단념 청년(6개월간 취업·교육·훈련 없음)·자립준비청년 등", strong: true },
  { re: YOUTH_STATUS_RE, label: "학교 밖·가정 밖 청소년 등", strong: true, labelOf: youthStatusLabel, inclusive: /(및|또는|포함|[,，、]|우선|\S\s*등\s|도\s*(?:지원|신청|가능|포함|참여)|해당\s*연령|중\s)/ },
];
const STATUS_ORDINARY = new RegExp(`${OCC_ORDINARY.source}|시민|도민|청년|신혼|고령자|노인가족|취업\\s*준비|재직자|자녀`);
export function needsStatus(p: Program, s?: Situation): string | null {
  // 하는 일 질문(학생 등)이 이미 정하는 조건은 빼고 — 육아휴직 사용·재직 기간·특정 분야는 '직장인·구직자' 답만으로 알 수 없음
  const act = leavesOf(p.rule.logic).filter((l) => !l.soft && l.field === "activity").flatMap((l) => ("anyOf" in l && Array.isArray(l.anyOf) ? (l.anyOf as string[]) : []));
  const text = `${p.name}\n${(p.target ?? "").replace(/&#13;/g, "\n").slice(0, 400)}`;
  const ordinary = STATUS_ORDINARY.test(text.slice(p.name.length));
  for (const k of STATUS_KINDS) {
    if (s && k.skip?.(s)) continue;
    if (k.coveredBy && act.includes(k.coveredBy)) continue;
    const scope = k.lead ? text.slice(0, p.name.length + 1 + k.lead) : text;
    for (const m of scope.matchAll(new RegExp(k.re.source, "g"))) {
      const idx = m.index ?? 0;
      const label = k.labelOf ? k.labelOf(m[0]) : k.label;
      if (idx < p.name.length) return label;
      const start = text.lastIndexOf("\n", idx) + 1;
      const endN = text.indexOf("\n", idx);
      const line = text.slice(start, endN < 0 ? undefined : endN);
      if (OCC_EXCLUDE.test(line)) continue;
      if (k.inclusive?.test(line)) continue;
      // '○ 수급 청소년 ○ 한부모 ○ 다문화 ○ 학교 밖 청소년'처럼 대상 집단을 여러 줄로 나열한 것 중 하나 (QA 5차 C3b: 청소년 성장 지원 서비스)
      if (k.inclusive && GROUP_BULLETS(text) >= 3) continue;
      if (!k.strong && (ordinary || STATUS_ORDINARY.test(line))) continue;
      return label;
    }
  }
  return null;
}
const GROUP_BULLETS = (text: string) => text.split("\n").filter((l) => /^\s*[-○ㅇ·•*□]/.test(l) && /(청소년|가정|가족|계층|가장|아동|자녀)\s*(?:\([^)]*\))?\s*$/.test(l)).length;
/** 학교에 다니는 학생만 받는 사업 (학교 밖 청소년에게는 맞지 않음) — 대안교육기관 학생 사업은 제외 */
export const IN_SCHOOL_ONLY = /고등\s*학교\s*무상\s*교육|무상\s*교육|(?<!대안\s*교육[^\n]{0,10})교복|수업료|입학\s*(?:준비금|축하금)|학교\s*(?:급식|우유)|방과\s*후\s*(?:학교|돌봄)|교육\s*급여/;
const IN_SCHOOL_NO_WHY = "학교에 다니는 학생 대상이라, 학교에 다니지 않는다고 하셔서 맞지 않아요.";
/** 이름에 장애인 대상이 적힌 사업 (QA 5차 검증 N4: '중증장애인직업재활 지원'이 장애 언급 없이 '받으실 수 있어요') */
export const DISABILITY_PERSON_NAME = /장애인|중증\s*장애|장애\s*(?:아동|학생|영유아|청소년|청년)|발달\s*장애/;
const DISABILITY_NO_WHY = "장애인 대상 사업이라, 장애가 없다고 하셔서 맞지 않아요.";
const DISABILITY_ASK_WHY = "장애인 대상 사업이에요 — 장애가 있으면(등록 장애인 등) 신청할 때 확인";
/** 반드시 맞아야 하는 잎 ('또는' 묶음 안의 잎은 뺌) */
function requiredLeaves(c: Cond | null): Leaf[] {
  if (!c) return [];
  if ("all" in c) return c.all.flatMap(requiredLeaves);
  if ("any" in c) return c.any.length === 1 ? requiredLeaves(c.any[0]) : [];
  return [c];
}
/** 규칙에 장애 조건(잎)이 없고 이름이 장애인 대상일 때만: 장애 없음 → no, 모름 → open, 있음(본인·가족) → 원래 판정 */
export function disabilityNameGate(p: Program, s: Situation): "no" | "open" | null {
  if (!DISABILITY_PERSON_NAME.test(p.name)) return null;
  // 장애 잎이 '구직자 또는 장애인'처럼 '또는' 안에만 있으면 장애 조건이 없는 것과 같음 (원문 이름은 장애인 대상)
  if (requiredLeaves(p.rule.logic).some((l) => l.field === "disability" && !l.soft)) return null;
  const d = s.profile.disability;
  if (d === "none") return "no";
  if (d === "unknown") return "open";
  return null;
}
const STUDENT_NO_WHY = "학교에 다니지 않는 청소년(학교 밖·학업 중단) 대상이라, 학생이라고 하셔서 맞지 않아요.";
export const statusWhy = (label: string) => `따로 조건(${label})이 있어요 — 말씀하신 내용으로는 알 수 없어 신청할 때 확인`;
/** 세부 서비스·대상을 지자체가 정하는 묶음 사업 (지역사회서비스투자사업, 청년성장프로젝트 등) */
const BUNDLE_RE = /자율적으로\s*(?:설정|정|선정)|지역사회서비스\s*투자|지역사회서비스\s*청년\s*사업단|서비스\s*(?:별|에\s*따라)\s*상이/;
const BUNDLE_WHY = "서비스마다 대상(소득·필요 등)을 지자체가 따로 정해요 — 신청할 때 확인";

/** 원문 대상에 시설·기관 유형 줄이 함께 있음 (예: '수급·차상위 가구 / 사회복지시설') — 개인은 다른 줄로 판정 */
const FACILITY_LINE = /^(?:[-○ㅇ·•*□]\s*)?(?:\S+\s*)?(?:사회\s*)?복지\s*시설|^(?:[-○ㅇ·•*□]\s*)?(?:\S+\s*)?(?:시설|기관|단체|법인)(?:\s|$|[,·(])/;
export const NOT_FOR_PERSON_WHY = "개인이 신청해 받는 혜택이 아니에요 (기관·단체 대상, 행사·모금 사업) — 자세한 내용은 원문 확인";

/** 출처 태그에서 온 soft 조건이 이 사업 이름·대상 문구와 무관하면 화면 문구에서 뺀다 (QA 2차 N6: 장기요양인정에 '등록 장애인') */
const SOFT_TOPIC: Partial<Record<Leaf["field"], RegExp>> = {
  disability: /장애/,
  care: /(돌봄|요양|거동|간병|수발|보호가\s*필요|도움이\s*필요|일상\s*생활)/,
  householdSize: /(1인|독거|홀몸|혼자|단독)/,
  trait: /(보훈|유공|한부모|조손|다문화|결혼\s*이민|북한|다자녀|1인|독거|홀몸)/,
  benefit: /(수급|차상위|기초\s*연금|생계|의료\s*급여|주거\s*급여)/,
  // 원문에 소득 이야기가 없는데 정부24 코드에서 온 '저소득' soft 잎 (예: 장기요양인정 '가구 소득이 월 128만원 이하는 맞아요')
  income: /(소득|중위|수급|차상위|저소득|기초\s*생활|생계|의료\s*급여|취약|빈곤|형편)/,
  incomeBands: /(소득|중위|수급|차상위|저소득|기초\s*생활|생계|의료\s*급여|취약|빈곤|형편)/,
};
/** 가구 특성별 낱말 (QA 3차 L1: 생계급여의 '북한이탈주민' 제외 문구 때문에 '1인 가구' soft 조건이 남던 문제) */
const SOFT_TRAIT: Record<string, RegExp> = {
  single: /(1인|독거|홀몸|혼자|단독)/,
  single_parent: /(한부모|조손|미혼\s*[모부])/,
  multi_child: /다자녀/,
  veteran: /(보훈|유공|참전)/,
  multicultural: /(다문화|결혼\s*이민|북한|탈북)/,
};
export function softIrrelevant(r: Reason, p: Program): boolean {
  const l = r.leaf;
  if (!l?.soft) return false;
  // (QA 5차 검증 N5) 대상 집단을 여럿 나열한 것 중 하나(북한이탈청년)일 뿐인 출처 태그 — 화면에 '다문화·북한이탈 조건'으로 쓰지 않음
  if (l.field === "trait" && /구직\s*단념\s*청년/.test(p.target ?? "")) return true;
  const tv = l.field === "trait" && "anyOf" in l ? (l.anyOf as string[]).map((k) => SOFT_TRAIT[k]).filter(Boolean) : [];
  const re = tv.length ? new RegExp(tv.map((x) => x.source).join("|")) : SOFT_TOPIC[l.field];
  if (!re) return false;
  // 금액표('1인 가구 : 820,556원')와 예시 줄('(예) 독거노인')은 조건이 아님 (QA 3차 L1)
  const body = (p.target ?? "")
    .replace(/&#13;/g, "\n")
    .replace(/\d\s*인\s*가구\s*[:：]?\s*[\d,.]+\s*(?:원|만\s*원)?/g, " ")
    .replace(/^[\s\-·•*]*(?:\(예\)|예\)|예시|예:)[^\n]*$/gm, " ");
  if (!re.test(`${p.name}\n${body}`)) return true;
  // 우선 공급·가점 항목에만 나오면 자격 조건이 아님 (QA 3차 N6: 국민임대 '우선 공급 - 장애인 등') — 소득은 제외
  return l.field !== "income" && !re.test(p.name) && onlyInPriority(p.target ?? "", re);
}
const PRIORITY_WORD = /우선\s*(?:공급|선정|지원|순위|입주|배정|대상)?|특별\s*공급|가점|우대|배점|순위/;
/** 주제 낱말이 모두 '우선 공급'류 소제목 아래나 우선·가점 문구가 있는 줄에만 나오는지 */
export function onlyInPriority(target: string, re: RegExp): boolean {
  const lines = target.replace(/&#13;/g, "\n").split("\n");
  let inPri = false;
  let seen = false;
  for (const line of lines) {
    const head = /^\s*(?:[○●□■◎◆▶]|\d+[.)]|[가-하][.)])/.test(line);
    if (head) inPri = PRIORITY_WORD.test(line);
    if (!re.test(line)) continue;
    seen = true;
    if (!(inPri || PRIORITY_WORD.test(line))) return false;
  }
  return seen;
}

/** 이름에 가족·보호자가 대상이라고 적힌 장애 관련 사업 (부모 교육·가족 지원 등) — 나이 조건은 신청하는 가족 기준 */
const FAMILY_TARGET = /(가족|부모|보호자|양육|가정|가구|배우자|돌보는|간병인)/;
const memberCache = new WeakMap<Program, Program>();
const MEMBER_AGE = " (장애가 있는 가족의 나이)";
/**
 * 대상 사람 정하기 (QA 4차 S3): 장애가 있는 사람이 '가족'인데 사업이 장애인 본인 대상이면, 나이 조건은 내 나이가 아니라 그 가족 나이로 본다.
 * 예) 52세 엄마 + 지적장애 딸 → '장애인 온라인 직업심리검사(만 18~64세)'를 엄마 나이로 '해당돼요'라고 하지 않음.
 * 규칙을 바꿔: 장애 잎은 '그 가족 이름으로 신청'(대리), 나이 잎은 '그 가족 나이로 확인'(묻지 않는 조건).
 */
export function forDisabledMember(p: Program, s: Situation): Program {
  if (s.profile.disability !== "member" || !p.rule.logic || FAMILY_TARGET.test(p.name)) return p;
  const ls = leavesOf(p.rule.logic);
  if (!ls.some((l) => l.field === "disability" && l.anyOf.includes("self"))) return p;
  if (!ls.some((l) => l.field === "age" && !l.soft)) return p;
  const hit = memberCache.get(p);
  if (hit) return hit;
  const map = (c: Cond): Cond => {
    if ("all" in c) return { ...c, all: c.all.map(map) };
    if ("any" in c) return { ...c, any: c.any.map(map) };
    if (c.field === "disability") return { ...c, anyOf: c.anyOf.filter((k) => k !== "member") };
    if (c.field === "age" && !c.soft) return { field: "unasked", label: `${c.label}${MEMBER_AGE}`, hint: "장애가 있는 가족 본인의 나이로 확인하세요" };
    return c;
  };
  const out = { ...p, rule: { ...p.rule, logic: map(p.rule.logic) } };
  memberCache.set(p, out);
  return out;
}

export function classifyBase(p0: Program, s: Situation): BaseResult {
  // soft 조건(원천 태그 등)은 답과 달라도 빼지 않는다 — 배타적이지 않은 신호라서 (감사 2026-10-07: 장애인연금·장기요양 등이 잘못 빠짐)
  // 다만 (QA 9차) 답으로 '아님'이 정해진 soft 조건은 확인할 것에서 빼고, 복지로 대상 특성 태그가 모두 '아님'이면 맞지 않음 (answeredSoft)
  const t = toEval(s, false);
  const profile = t.profile;
  const ans = answeredSoft(forDisabledMember(p0, s), profile, t.opts);
  const p = ans.p;
  const proc = LTC_APPLY.test(p.name) && !LTC_AFTER.test(p.name);
  const opts = proc ? { ...t.opts, facts: { ...t.opts.facts, ltcGrade: true } } : t.opts;
  const process = proc ? LTC_PROCESS : undefined;
  const ev0 = evaluateRule(p.rule, profile, opts);
  // 사업과 무관한 soft 조건(출처 태그)은 화면 문구에서 뺀다 — 판정 등급은 그대로 (N6)
  const dropReason = (x: Reason) => softIrrelevant(x, p) || (!!x.leaf && ans.hide.has(x.leaf as Leaf));
  const ev = ev0.reasons.some(dropReason) ? { ...ev0, reasons: ev0.reasons.filter((x) => !dropReason(x)) } : ev0;
  const tg = textGate(p);
  // 생계·의료·주거급여 등 제도 자체는 신청해서 수급자가 되는 것 — '수급자 대상' 관문은 순환 설명이라 쓰지 않음 (QA 3차 R7: 소득 90 > 82만원을 먼저)
  const gate = p.rule.meansTest && tg.gate?.kind === "recipient" ? null : tg.gate;
  const { priority, partialRec } = tg;
  const gs = gate ? gateState(gate, s, profile) : undefined;
  const r = { ev, gate, gateState: gs, priority, process };
  if (ans.no && ev.tier !== "ineligible") return { base: "no", ...r, why: `대상 특성(${ans.no}) 중 해당하는 것이 없다고 답하셨어요 — 맞지 않아요` };
  const ansNo = ev.tier !== "ineligible" ? answeredNoOf(p, s) : null;
  if (ansNo) return { base: "no", ...r, why: ansNo };
  const recMet = RECIPIENT_KINDS.some((k) => inferExtras(s).benefits[k] === true);
  if (ev.tier === "ineligible") return { base: "no", ...r };
  if (gs === "no") return { base: "no", ...r };
  // (QA 5차 검증 N2) 학교에 다니지 않는다고 했으면: 재학생 대상(무상교육·교복·입학준비금 등)은 맞지 않음 (교육급여처럼 재산 조사 제도도 재학생 대상이라 먼저 거름), 학교 밖·학업 중단 조건은 말한 처지와 같음
  const outOfSchool = !!s.x.interests?.includes("out_of_school");
  if (outOfSchool && IN_SCHOOL_ONLY.test(p.name)) return { base: "no", ...r, why: IN_SCHOOL_NO_WHY };
  // (2026-10-16) 입양·가정위탁·학대피해아동 보호 가정, 보호가 끝난 자립준비청년 대상 — 일반 가정에는 그 조건을 분명히 (빼지 않음 — 해당하면 받을 수 있음)
  const prot = protectionWhy(p);
  if (prot) return { base: "open", ...r, why: prot };
  if (notForPersons(p)) return { base: "open", ...r, why: NOT_FOR_PERSON_WHY };
  const meal = mealWhy(p, s);
  if (meal) return { base: "open", ...r, why: meal };
  if (!p.rule.logic || p.rule.unstructuredCore) return { base: "open", ...r };
  // 생계·의료·주거·교육급여, 차상위 확인: 소득이 기준 안이어도 재산·부양 조사를 거쳐 정해짐 → 최대 '신청할 때 확인'
  if (p.rule.meansTest) return { base: "open", ...r, why: evaluateCond(p.rule.logic, profile, opts).tri === "T" && gs !== "unknown" ? MEANS_WHY : "재산·부양 조사를 거쳐 정해져요 — 신청할 때 확인" };
  // 긴급지원은 소득 기준이 맞아도 '갑작스러운 위기'가 있어야 함 → 신청할 때 확인
  if (CRISIS.test(p.name) || NAMED_GROUP.test(p.name)) return { base: "open", ...r };
  const og = OFFICE_GROUPS.find(([re]) => re.test(p.name));
  if (og) return { base: "open", ...r, why: og[1] };
  if (needsOccupation(p)) return { base: "open", ...r, why: OCCUPATION_WHY };
  // 학생이라고 했으면 '학교 밖 청소년'·'학업 중단' 대상은 맞지 않음 (QA 5차 U1)
  if (s.profile.activity === "student" && (OUT_OF_SCHOOL_RE.test(p.name) || (!!needsStatus(p) && /학교 밖|학업 중단/.test(needsStatus(p) ?? "")))) return { base: "no", ...r, why: STUDENT_NO_WHY };
  // (QA 5차 검증 N4) 이름이 장애인 대상인데 규칙에 장애 조건이 없음 — 장애가 없다고 했으면 맞지 않음, 모르면 신청할 때 확인
  const dg = disabilityNameGate(p, s);
  if (dg) return { base: dg, ...r, why: dg === "no" ? DISABILITY_NO_WHY : DISABILITY_ASK_WHY };
  const st0 = needsStatus(p, s);
  const st = st0 && outOfSchool && /학교 밖 청소년|학업 중단/.test(st0) ? null : st0;
  if (st) return { base: "open", ...r, why: statusWhy(st) };
  // (전국 확대 ②) 원문이 요구하는 사건·이미 한 일·묻지 않은 자격 — 나이·소득이 맞아도 '신청할 때 확인'
  const pre = preconditionOf(p, s);
  if (pre) return { base: "open", ...r, why: pre };
  if (BUNDLE_RE.test(`${p.name}\n${(p.target ?? "").slice(0, 400)}`)) return { base: "open", ...r, why: BUNDLE_WHY };
  if (EQUIP_RE.test((p.target ?? "").slice(0, 600))) return { base: "open", ...r, why: EQUIP_WHY };
  if (isBasicPension(p) && pensionLikely(s)) return { base: "open", ...r, why: PENSION_WHY };
  if (!recMet && recipientOrGuessedIncome(p.rule.logic)) return { base: "open", ...r, why: RECBAND_WHY };
  if (partialRec && !recMet) return { base: "open", ...r, why: p.rule.recBand ? RECBAND_WHY : "대상 유형이 여럿이에요 — 수급·차상위가 아니면 다른 유형(원문)에 해당하는지 신청할 때 확인" };
  if (ev.reasons.some((x) => x.kind === "note" && /법인·시설·단체/.test(x.text))) return { base: "open", ...r, why: "법인·시설·단체 대상 조건이 있어요 — 개인이 받을 수 있는지 문의" };
  const tri = evaluateCond(p.rule.logic, profile, opts).tri;
  if (tri === "T" && gs !== "unknown") return { base: p.rule.review === "auto" ? "autoFit" : "fit", ...r };
  return { base: "open", ...r };
}

/**
 * (2026-10-16 소유자: '아동용품구입비 지원 — 위기아동 가정보호 및 전문가정위탁…'이 무슨 사업인지, 내가 해당되는지 안 보임)
 * 입양·가정위탁·학대피해아동 보호처럼 아이를 맡아 보호하는 가정, 보호가 끝난 자립준비청년 대상 사업.
 * 간편 입력으로 묻지 않는 처지라 '신청할 때 확인'에 두되, 이유를 그 조건으로 분명히 적는다 (복지로 생애주기 태그만 보여 주던 문제).
 * 이름 + 지원대상 첫 줄만 보고, 출산·출생 가구나 수급·저소득 등 다른 대상과 함께 적힌 것은 빼다 (첫만남이용권 '출생·입양', 디딤씨앗통장).
 */
const PROTECT_FAMILY = /가정\s*위탁|위탁\s*(?:가정|아동|부모|보호|양육)|입양|학대\s*피해|보호\s*대상\s*아동|위기\s*아동|소년\s*소녀\s*가정|전문\s*아동\s*보호/;
const CARE_LEAVER = /자립\s*준비\s*청년|보호\s*종료/;
/** 다른 대상과 함께 적혔거나(출생·입양, 수급·저소득) 아이 보호 가정이 아닌 것 (유기동물 입양, 학대피해 노인, 가정폭력, 다자녀 '입양아 포함') */
const PROTECT_OTHER = /출산|출생|임신|임산|산모|신생아|수급|차상위|저소득|한부모|다자녀|셋째|동물|반려|노인|가정\s*폭력/;
/** 이름에 없고 대상 첫 줄에만 있을 때: 여러 대상 중 하나로 적힌 것 ('자녀 또는 위탁가정', '…, 자립준비청년 등', '장애인, 노인, 가정위탁아동') */
const PROTECT_LISTED = /또는|포함|장애인|구직|미혼|등\s|등$|,[^,\n]*,/;
export function protectionWhy(p: Program): string | null {
  const first = targetFirst(p).slice(0, 220);
  const text = `${p.name}\n${first}`;
  if (PROTECT_OTHER.test(text)) return null;
  const inName = (re: RegExp) => re.test(p.name) || (re.test(first) && !PROTECT_LISTED.test(first));
  if (inName(CARE_LEAVER)) return "아동복지시설·가정위탁 보호가 끝난 자립준비청년(보호종료아동) 대상이에요 — 해당하면 신청할 때 확인";
  if (inName(PROTECT_FAMILY)) return "입양·가정위탁·학대피해아동 보호처럼 아이를 맡아 보호하는 가정 대상이에요 — 해당하지 않으면 신청 대상이 아니에요";
  return null;
}

/**
 * (전국 확대 ②, 2026-10-10) 원문 대상이 간편 입력으로 알 수 없는 사건·이미 한 일·자격을 요구하는지.
 * 경기도 밖 정부24 지원조건을 'API 지원조건'으로 올리면서 142개 '받으실 수 있어요'를 원문과 대조(다른 모델 검토 포함)해
 * 71개가 과대 판정이었던 유형을 모았다. 맞으면 '신청할 때 확인'으로만 바꾼다 (빼지 않음 — 해당하면 받을 수 있음).
 * 이름 + 지원대상 앞부분만 본다 (선정기준·제외 문구까지 보면 너무 넓어짐).
 */
const PRECONDITIONS: [RegExp, string, RegExp?][] = [
  [/화재|재해|재난|수해|위기\s*(?:상황|가정|가구)|긴급\s*(?:주거|복지)|주거\s*상실|행려|무연고|실종/, "갑작스러운 위기·재해를 겪은 경우", /보험|진화대|예방|대비|안전\s*점검/],
  [/혼인\s*신고|결혼\s*축하|입학\s*축하|생애\s*최초\s*입학|최초\s*(?:로\s*)?입학/, "결혼·입학 같은 일이 있을 때"],
  [/자진\s*반납|면접\s*(?:에\s*)?(?:참여|참가|자)|변경\s*신청|(?:서비스|어린이집)\s*(?:를|을)?\s*이용\s*(?:하는|중인)|운전\s*면허\s*(?:를\s*)?취득|(?<!수)수료(?:한|자|생|증|\s*후)|어린이집\s*(?:을\s*)?이용/, "이미 한 일(면허 반납·면접·수료·서비스 이용 등)"],
  [/상담자|상담사|예술가|예술인|분양\s*계약|매도\s*신청|보육\s*교사|의료인|구급\s*대원|입소\s*아동|시설\s*입소|탈\s*시설/, "직업·신분·시설 이용 조건", /제외|응시자|근로자\s*[,·]|노무\s*제공자/],
  [/보장구|기능\s*제한|등급\s*외|추가\s*(?:지원|시간)\s*이?\s*필요|신체\s*변형|활동\s*지원[^\n]{0,4}\(?\s*추가|추가\s*사업/, "장애·돌봄 판정 조건"],
  [/농번기|농업인|농가|어업인/, "농어업인 가구 조건"],
  [/자녀\s*(?:가\s*)?[2-9]\s*명\s*이상|[2-9]\s*\(?\s*손?\s*\)?\s*자녀\s*이상/, "자녀 수 조건", /\([^)]*[2-9]\s*자녀[^)]*\)|우대|금리/],
  // '부 또는 모 및 조부모', '한부모 및 조손'처럼 한부모와 함께 적힌 것은 조건이 아님
  [/(?:외\s*\)?\s*)?조부모|손\s*(?:자녀|주)\s*(?:를|을)?\s*(?:돌보|돌봄|양육|키우)|조손/, "조부모가 손자녀를 돌보는 가정", /부\s*또는\s*모\s*(?:및|또는)\s*조부모|한부모\s*(?:및|또는)\s*조손|한부모\s*[·,]\s*조손|한부모\s*가족\s*\(|유공자|보상금/],
  [/카드\s*\)?\s*(?:를\s*)?소지|(?:중소|중견)\s*(?:[·,]\s*중견\s*)?기업\s*(?:에\s*)?(?:\d+\s*개월\s*이상\s*)?(?:재직|근무)|재직\s*중|미혼\s*(?:청년|남녀|인|자)/, "재직·미혼·카드 소지 같은 조건", /^(?![\s\S]*통행료)[\s\S]*장애인\s*(?:통합\s*)?복지\s*카드|(?:구직|취업)\s*(?:또는|및|·)\s*재직|재직\s*(?:또는|및)/],
  [/사례\s*관리\s*대상|장학생\s*선발|선정\s*(?:된|하여)|추천\s*(?:을\s*)?받은|추천(?:한|하는)\s*(?:자|사람|분)/, "기관이 선정·추천하는 경우"],
  // (2차 표본) 재직·가입, 질병 위험, 설비, 기관 이용, 모임, 정신적 장애
  [/정규직|재직자|(?<!보험\s*)(?<!연금\s*)가입자|공제\s*가입/, "재직·가입 조건"],
  [/가족력|고위험|의심(?:되는|자)|심화\s*평가|(?:검진|검사|평가)\s*결과/, "질병 위험·진단 조건", /우선/],
  [/설치(?:한|하여|하고)|설치\s*(?:가구|세대|자)/, "설비 설치 조건", /제외/],
  [/(?:센터|드림\s*스타트|시설|기관)\s*(?:을|를)?\s*이용(?:하는|하거나|\s*중인|\s*아동|자)|(?:시설|기관)에\s*(?:거주|입소)/, "기관·시설 이용 조건"],
  [/자조\s*모임|모임\s*(?:을|를)?\s*(?:구성|결성)|\d\s*~\s*\d\s*가구/, "모임·단체 조건"],
  [/정신(?:적)?\s*장애/, "장애 유형 조건(정신적 장애)", /제외|[·,]\s*정신|정신\s*장애\s*[·,]/],
  // (QA 9차, 남은 과대판정 34건 원문 확인) 취업·졸업·모집 시기·건강보험료·다른 서비스 이용·부양의무자·처방·기기 수리·재산
  [/취직한|취업한\s*(?:자|사람|중장년|청년|분)|졸업\s*후\s*\d+\s*년\s*이내/, "취업·졸업 시기 조건"],
  [/(?:건강\s*)?보험료\s*(?:부과\s*)?(?:금액|액)?\s*(?:이|가)?\s*최저|최저\s*보험료/, "건강보험료 기준"],
  [/맞춤\s*돌봄\s*서비스\s*(?:내|대상자|이용자|지원\s*대상)|(?:아이\s*)?돌봄\s*(?:서비스\s*)?본인\s*부담금?\s*(?:추가\s*)?지원/, "다른 돌봄 서비스를 이용하는 경우"],
  [/부양\s*의무자/, "부양의무자 기준"],
  [/처방전|진료\s*(?:를\s*)?받은/, "진료·처방 조건"],
  [/이동\s*기기|보조\s*기기|휠체어/, "장애·돌봄 판정 조건", /렌탈|대여/],
  [/재산\s*(?:이|가)?\s*\d|참여\s*조건에\s*부합|훈련\s*비\s*지원/, "재산 기준·참여 조건(간편 입력으로는 묻지 않음)"],
];
/** 소득 하한 ('중위소득 120% 초과 ~ 180% 이하') — 대상 문구 어디에 있어도 */
const INCOME_FLOOR = /중위\s*소득\s*\d{2,3}\s*%\s*초과\s*(?:[~∼\-]|부터)?\s*(?:기준\s*중위\s*소득\s*)?\d{2,3}\s*%\s*이하|중위\s*소득\s*\d{2,3}\s*%\s*초과\s*(?:인|하는)\s*(?:가구|세대|자|사람)/;
/** 지원대상 첫 줄 (첫 줄이 '아래 기준을 모두 충족'·'(기업) …'처럼 머리말이면 둘째 줄까지) */
function targetFirst(p: Program): string {
  const lines = (p.target ?? "").replace(/&#13;/g, "\n").split(/\n|\s\/\s/).map((l) => l.trim()).filter((l) => l.replace(/^[○◦·•❍〇ㅇ\-\s]+/, "").length > 0);
  const head = lines[0] ?? "";
  return /아래|다음|동시에|모두\s*충족|선정\s*기준|^\(\S+\)|^\[[^\]]*\]$|:\s*$/.test(head) ? `${head}\n${lines[1] ?? ""}` : head;
}
/**
 * (QA 9차) 답으로 맞지 않음이 분명한 원문 대상 → '맞지 않아요'
 *  - 지원대상 첫 줄이 기초생활 수급·차상위'뿐'인데 수급·차상위가 아니라고 답함(또는 소득으로 아님이 분명) — 다른 대상 집단이 함께 적혔으면 아님
 */
export function answeredNoOf(p: Program, s: Situation): string | null {
  // '[저소득층 노인 의치 지원]' 같은 머리말은 빼고 본다
  // '65세 이상 노인 중 의료급여수급자…'처럼 '… 중' 앞은 함께 맞아야 하는 조건이라 뒤만 본다
  const first0 = targetFirst(p).replace(/^\[[^\]]*\]\s*/, "");
  const first = /\s중\s+(.+)$/.exec(first0)?.[1] ?? first0;
  const ls = leavesOf(p.rule.logic);
  const notRec = RECIPIENT_KINDS.every((k) => inferExtras(s).benefits[k] === false);
  if (!notRec || ls.some((l) => l.field === "benefit" && !l.soft)) return null;
  const REC = /기초\s*생활\s*(?:보장\s*)?수급(?:자|권자|가구)?|(?:생계|의료|주거|교육)\s*급여\s*수급(?:자|권자|가구)?|차상위\s*(?:계층|본인\s*부담\s*경감\s*(?:대상)?자?)?|국민\s*기초\s*생활\s*(?:보장\s*)?(?:법|수급자)?/g;
  if (!REC.test(first)) return null;
  // 수급·차상위 낱말을 지운 뒤에도 다른 대상 집단(장애인·유공자·한부모·노인 등)이나 '등·소외·취약·또는'이 남으면 목록 중 하나라 맞지 않음으로 보내지 않는다
  // (이름의 '소외·취약계층'도 열린 목록 — 이름의 '노인·저소득층'은 함께 맞아야 하는 조건이라 보지 않음)
  // 여러 줄 목록('○ 수급자 ○ 한부모가족 ○ 다자녀 …')의 첫 줄만 보지 않게 지원대상 전체(앞 500자)를 본다
  // ('[…]' 머리말과 줄마다 '… 중' 앞의 함께 맞아야 하는 조건은 빼고)
  const rest = (p.target ?? "").replace(/&#13;/g, "\n").replace(/^\[[^\]]*\]\s*/, "").split("\n").map((l) => /\s중\s+(.+)$/.exec(l)?.[1] ?? l).join("\n").slice(0, 500).replace(REC, " ");
  if (/소외|취약/.test(p.name) || /제외|저소득|소외|취약|등\s*\)|등\s|등\s*$|우선|하위\s*\d|중위\s*소득|건강\s*보험|또는|이거나|장애|유공|보훈|한부모|조손|다문화|탈북|북한|미혼|다자녀|고령|노인|어르신|청년|대학생|학생|임산부|소년|가장|독거|아동|청소년|자녀|기초\s*연금|시설|주민|가구원\s*중|1\s*인\s*가구|외국인|근로자|기증|의사자|의상자|희생|공헌/.test(rest)) return null;
  return "원문 대상이 기초생활 수급자·차상위예요 — 해당하지 않는다고 하셔서 맞지 않아요";
}

/** (QA 9차) 결식 우려 아동 급식: 수급·차상위·한부모 가구가 아니면 담임교사·사회복지사 추천 등 별도 경로로만 — 소득이 기준 중위소득 60%를 넘으면 그 이유를 적는다 */
function mealWhy(p: Program, s: Situation): string | null {
  const t = `${p.name} ${targetFirst(p)}`;
  if (!/결식/.test(t) || /노인|어르신/.test(t) || (incomePctOf(s) ?? 0) <= LOW_INCOME_PCT || !RECIPIENT_KINDS.every((k) => inferExtras(s).benefits[k] === false)) return null;
  return "결식 우려 아동 대상이에요 — 수급·차상위·한부모 가구가 아니면 담임교사·사회복지사 등의 추천이 있어야 해요";
}

export function preconditionOf(p: Program, s: Situation, now: Date = new Date()): string | null {
  // 이름 + 지원대상 첫 줄만 — 여러 대상 집단을 줄줄이 적은 원문('수급자 / 다자녀 / 조손가족 …')의 한 줄을 조건으로 보지 않게
  const first = targetFirst(p);
  // 지난해 모집 공고 ('2025년 모집내용 (2026년 지원완료 예정)') — 올해 새로 받는지 확인
  const ym = /(20\d\d)\s*년\s*모집/.exec(first);
  if (ym && Number(ym[1]) < now.getFullYear()) return `원문이 ${ym[1]}년 모집 내용이에요 — 올해 새로 받는지 신청처에 확인`;
  // 취약·소외계층·저소득층 대상(원문에 소득 기준 숫자 없음)인데 규칙에 수급 조건이 없고, 소득이 기준 중위소득 60%를 넘음
  if (/취약\s*계층|소외\s*계층|저소득\s*층/.test(first) && !/제외|우선|중위\s*소득\s*\d/.test(first) && !leavesOf(p.rule.logic).some((l) => l.field === "benefit" && !l.soft) && (incomePctOf(s) ?? 0) > LOW_INCOME_PCT)
    return "저소득·취약계층 대상이에요 — 소득으로 보아 해당하는지 신청할 때 확인";
  const text = `${p.name}\n${first.slice(0, 220)}`;
  if (INCOME_FLOOR.test((p.target ?? "").slice(0, 400))) return "원문 조건(소득이 일정 기준을 넘는 경우 — 소득 하한)이 있어요 — 해당하는지 신청할 때 확인";
  for (const [re, label, unless] of PRECONDITIONS) if (re.test(text) && !unless?.test(text)) return `원문 조건(${label})이 있어요 — 해당하는지 신청할 때 확인`;
  // 원문 대상 나이('60세 이상')인데 규칙에 나이 조건이 없고, 말한 나이가 그보다 어림
  const ls = leavesOf(p.rule.logic);
  const ageM = /(?:만\s*)?(\d{2})\s*세\s*이상/.exec(first);
  const b = ageBoundsOf(s);
  if (ageM && b && !ls.some((l) => l.field === "age") && b[1] < Number(ageM[1])) return `원문 대상 나이(만 ${ageM[1]}세 이상) — 나이 조건을 신청할 때 확인`;
  // 원문 첫 줄이 1인 가구·독거 대상인데 규칙에 가구 조건이 없고, 함께 사는 사람이 있다고 답함
  if (/1\s*인\s*(?:\([^)]*\))?\s*(?:관내\s*)?(?:취약\s*)?가구|독거|홀몸|홀로\s*사는/.test(first) && !ls.some((l) => l.field === "householdSize" || (l.field === "trait" && "anyOf" in l && (l.anyOf as string[]).includes("single"))) && typeof s.profile.householdSize === "number" && s.profile.householdSize > 1)
    return "1인 가구 대상이에요 — 함께 사는 가족이 있다고 하셔서 신청할 때 확인";
  // 원문이 노인·어르신 대상인데 규칙에 나이 조건이 없고, 말한 나이가 60세 미만
  if (/노인|어르신/.test(first) && b && !ls.some((l) => l.field === "age") && b[1] < 60) return "노인 대상이에요 — 나이 조건을 신청할 때 확인";
  // 원문이 'N~M개월' 아이 대상인데 규칙에 자녀 나이 조건이 없음 (서울형 아이돌봄비 '24~36개월 영아')
  const kidLeaf = ls.some((l) => l.field === "children" || l.field === "childAge");
  if (!kidLeaf && /\d+\s*~\s*\d+\s*개월/.test((p.target ?? "").slice(0, 200))) return "원문 조건(자녀 나이·개월 수)이 있어요 — 해당하는지 신청할 때 확인";
  // 원문이 영아·아동·자녀 대상인데 규칙에 자녀 조건이 없고, 자녀가 없다고 답함
  if (/영아|영유아|(?<!청소년\s*및\s*)아동|자녀/.test((p.target ?? "").slice(0, 120)) && !ls.some((l) => l.field === "children" || l.field === "childAge") && Array.isArray(s.profile.children) && s.profile.children.length === 0)
    return "자녀(아동) 대상이에요 — 자녀가 없다고 하셔서 신청할 때 확인";
  return null;
}

/**
 * (QA 9차, 2026-10-11) 답으로 '아님'이 정해진 soft 조건 정리.
 *  - soft 조건을 단단한 조건으로 봤을 때 답과 어긋나면(예: 장애 없음 ↔ '장애 관련 조건', 소득 100% ↔ '저소득') 화면 문구에서 뺀다
 *    → '확인할 것: 등록 장애인'처럼 답과 다른 말이 남지 않음 (판정 등급은 그대로 — 이 때문에 맞음·맞지 않음이 바뀌지 않음)
 *  - 복지로 대상 특성 태그는 대상 목록 전체가 아니라 부분 신호라('저소득 가구' 태그 하나뿐인 긴급복지·근로장려금 등) 이것만으로 맞지 않음으로 보내지 않는다
 */
const SOFT_GROUP: ReadonlySet<Leaf["field"]> = new Set(["benefit", "disability", "trait", "income", "incomeBands"]);
function answeredSoft(p: Program, profile: Profile, opts: EvalOptions): { p: Program; no: string | null; hide: Set<Leaf> } {
  const logic = p.rule.logic;
  const none = { p, no: null, hide: new Set<Leaf>() };
  if (!logic) return none;
  const soft = leavesOf(logic).filter((l) => l.soft && SOFT_GROUP.has(l.field));
  if (!soft.length) return none;
  const isF = (l: Leaf) => evaluateCond({ ...l, soft: undefined } as Cond, profile, opts).tri === "F";
  const hide = new Set(soft.filter(isF));
  if (!hide.size) return none;
  // 판정 등급은 그대로 두고(빼면 독거노인 등 대상 집단이 사라져 '받으실 수 있어요'가 됨), 화면 문구에서만 뺀다
  return { p, no: null, hide };
}

/** 집 설비 조건 (QA 2차 5-2: 서민층 가스시설 개선 — LPG 호스를 쓰는 가구만) — 간편 입력으로는 묻지 않음 */
const EQUIP_RE = /(LPG|엘피지|액화\s*석유\s*가스|고무\s*호스|가스\s*호스)/;
const EQUIP_WHY = "집 설비 조건(LPG 가스 호스 사용 등)이 있어요 — 해당하는지 신청할 때 확인";
const RECBAND_WHY = "원문 대상이 수급·차상위(또는 그에 준하는 저소득층)예요 — 소득만으로 정하지 않고 신청할 때 확인";
const MEANS_WHY = "재산·부양 조사를 거쳐 정해져요 — 소득만 보면 신청해 볼 만해요";
const CRISIS = /긴급\s*(복지|지원|생계)|위기\s*가구/;
/** 이름 괄호 안에 따로 정한 대상 집단 — 예) 무료 소송대리 서비스(가족관계미등록자), (미혼모·부), (장애인1~3급) */
const NAMED_GROUP = /\(([^()]*(?:자|인|가족|민|대상|모|부|급|사건[^()]*))\)\s*$/;

/** 화면 분류: fit 받을 수 있어요 / ask 질문 하나로 정해져요 / office 신청할 때 확인 / no 맞지 않아 뺐어요 */
export type Bucket = "fit" | "ask" | "office" | "no";
export const BUCKET_LABEL: Record<Bucket, string> = { fit: "받으실 수 있어요", office: "신청할 때 확인", ask: "답하면 정해져요", no: "맞지 않아요" };

export interface V2Item {
  s: Scored;
  /** 사람 검수(또는 공식 구조화) 규칙인지 — 아니면 '자동 정리 조건' 표시 */
  reviewed: boolean;
  bucket: Bucket;
  base: BaseResult;
  /** ask: 이 사업을 정할 수 있는 질문 */
  dims: DimId[];
}

/** 이 사업을 정할 수 있는 '모름' 질문 (답 하나만 바꿔 보는 반사실 검사) */
export function decidingDims(p: Program, s: Situation, cur: Base): DimId[] {
  const out: DimId[] = [];
  for (const id of dimsFor(p)) {
    const d = DIM_BY_ID[id];
    if (!dimAvailable(d, s) || !d.isUnknown(s)) continue;
    if (answersFor(d, s).some((a) => classifyBase(p, a.apply(s)).base !== cur)) out.push(id);
  }
  return out;
}

export function classify(s: Scored, sit: Situation): V2Item {
  const base = classifyBase(s.program, sit);
  const reviewed = s.program.rule.review !== "auto";
  // 자동 정리 규칙은 조건이 다 맞아도 '신청할 때 확인' (원문 대조 전이라 '받을 수 있어요'라고 하지 않음)
  if (base.base === "autoFit") return { s, reviewed, bucket: "office", base, dims: [] };
  if (base.base !== "open") return { s, reviewed, bucket: base.base, base, dims: [] };
  // 이름으로 건 장애 조건(N4)은 '신청할 때 확인'에 둔다 (장애 여부만 묻는 질문 목록을 늘리지 않음)
  if (base.why === DISABILITY_ASK_WHY) return { s, reviewed, bucket: "office", base, dims: [] };
  const dims = decidingDims(s.program, sit, "open");
  return { s, reviewed, bucket: dims.length ? "ask" : "office", base, dims };
}

/* ---------------- 순위 보정 (QA 1차 H1) ---------------- */

/** 기초연금 사업 자체 */
export const isBasicPension = (p: Program) => /^기초\s*연금$/.test(p.name.trim());
/**
 * 기초연금을 받을 가능성이 높음: 만 65세 이상, 아직 안 받음(또는 모름), 월 소득을 알고 선정기준액의 70% 이하
 * (소득인정액에는 재산 환산액이 더해지므로 '확정'이 아니라 '가능성 높음')
 */
export function pensionLikely(s: Situation): boolean {
  if (s.profile.age === "unknown" || ageRange(s.profile.age)[0] < 65) return false;
  if (inferExtras(s).benefits.basic_pension === true) return false;
  if (s.x.incomeManwon === null) return false;
  const t = s.profile.householdSize === "unknown" || s.profile.householdSize === 1 ? BASIC_PENSION_THRESHOLD_2026.single : BASIC_PENSION_THRESHOLD_2026.couple;
  return s.x.incomeManwon * 10000 <= t * 0.7;
}
/**
 * 기초연금을 받으실 수도 있음 (QA 2차 H1): 만 65세 이상, 아직 안 받음(또는 모름), 소득을 모르거나 선정기준액 이하.
 * 이때 기초연금은 '답하면 정해져요'에 접어 두지 않고 먼저 확인할 것의 맨 앞에 둔다 (어르신에게 가장 큰 현금 급여).
 */
export function pensionPossible(s: Situation): boolean {
  const b = ageBoundsOf(s);
  if (!b || b[0] < 65) return false;
  if (inferExtras(s).benefits.basic_pension === true) return false;
  if (s.x.incomeManwon === null) return s.profile.income === "unknown" || incomeRange(s.profile.income)[0] < 100;
  const t = s.profile.householdSize === "unknown" || s.profile.householdSize === 1 ? BASIC_PENSION_THRESHOLD_2026.single : BASIC_PENSION_THRESHOLD_2026.couple;
  return s.x.incomeManwon * 10000 <= t;
}
/** 기초연금을 말함 ('기초연금 받고 싶어요') + 아직 안 받음 + 65세 미만이 아님 */
const pensionWanted = (s: Situation) => !!s.x.interests?.includes("basic_pension") && inferExtras(s).benefits.basic_pension !== true && (ageBoundsOf(s)?.[1] ?? 120) >= 65;
/** 간편 입력이 묻지 않는 특별한 신분·처지 대상 (시설 보호아동·가정위탁·자립준비청년 등) — 목록에는 두되 먼저 확인할 것에는 넣지 않음 */
export const SPECIAL_STATUS = /(회복\s*지원\s*시설|보호\s*처분|소년원|감호\s*위탁|출소|자살\s*(?:시도|유족)|출생\s*미등록|소년\s*[·ㆍ]?\s*소녀\s*가장|보호\s*대상\s*아동|유기\s*(?:및|·)?\s*위기\s*아동|가정\s*위탁|위탁\s*(?:아동|가정|부모)|아동\s*복지\s*시설|시설\s*(?:보호|입소|퇴소|아동)|자립\s*준비|보호\s*종료|입양|요보호|소년\s*소녀\s*가정|그룹\s*홈|공동\s*생활\s*가정|학교\s*밖|가정\s*밖|학업\s*(?:을\s*)?중단|은둔|고립\s*[·ㆍ]?\s*(?:청년|청소년|은둔)|위기\s*청소년|가출|청소년\s*쉼터|자립\s*지원관)/;
/** 추천에서 뺄 이유가 적힌 '신청할 때 확인' (법인·시설·단체·직업 조건) */
const PREG_CORE = /(행복\s*카드|건강\s*보험\s*임신\s*[·ㆍ]?\s*출산\s*진료비|산모\s*[·ㆍ]?\s*신생아\s*건강\s*관리|모자\s*보건\s*수첩|외래\s*진료비\s*본인\s*부담률|엽산제|첫\s*만남|산후\s*조리비)/;
const OUT_OF_SCHOOL_CORE = /(학교\s*밖\s*청소년\s*(?:지원|건강\s*검진|자립|교통비|교육|급식)|꿈드림|검정\s*고시)/;
/** 복지로 생애주기 태그 규칙 (자동 변환) — 이름과 무관하게 '청소년 자녀'·'성인' 같은 넓은 태그만 있음 */
const LIFECYCLE_TAG = /^복지로 생애주기/;
const CHILD_NAME = /(아동|아이|어린이|청소년|자녀|학생|학교|교육|교복|급식|가족|양육|보육|출산|임신|영유아|청년)/;
const metOnlyByChild = (i: V2Item) => {
  const met = i.base.ev.reasons.filter((r) => r.kind === "met");
  // '성인(만 19세 이상)' 같은 넓은 태그로 맞은 나이는 내 상황과 이어진 근거가 아님
  return met.some((r) => r.field === "childAge" || r.field === "children") && met.filter((r) => r.field === "age").every((r) => /성인|19세\s*이상/.test(r.text));
};
/** 체험·견학 행사 (관람료·체험활동비 '지원'은 혜택이라 뺌) */
const EXPERIENCE_NAME = /(견학|탐방|투어|캠프|체험\s*(?:학습|행사|프로그램|교실|마당)|(?<!건강)체험(?!\s*활동비|.*(?:지원|할인|비)))/;
/** 선발형 장학금 (QA 7차 N6) */
const SELECTIVE_SCHOLARSHIP = /(?=.*(?:장학|학자금))(?=.*(?:우수|성적|이공계|인문\s*100|특기|인재|수석|영재|전공))/;
/** 자녀 본인이 참여하는 체험·창업·캠프·참여기구 (QA 7차 P4) */
const KID_SELF_ACTIVITY = /(비즈쿨|창업|체험|캠프|동아리|자문단|참여\s*기구|어울림\s*마당|축제|경진\s*대회|공모전|봉사\s*활동)/;
const STUDENT_CORE = /(국가\s*장학금\s*(?:Ⅰ|I|1)\s*유형|국가\s*근로\s*장학|취업\s*후\s*상환\s*학자금|학자금\s*(?:대출\s*)?이자)/;
const PREG_SPECIAL = /(위기\s*임신|보호\s*출산|청소년\s*산모|고위험|분만\s*취약)/;
/** 임신·출산·여성 대상 사업 — 성별·임신 신호가 없으면 먼저 확인할 것에 두지 않는다 (QA 4차 S4: '군 제대' 청년 1위 '임신 사전건강관리') */
const GENDERED_NAME = /(임신|임산부|난임|불임|난자|정자|산모|산전|출산|모성|여성|경력\s*(?:단절|보유)\s*여성)/;
const GENDERED_WHY = /(여성\s*대상|임신을\s*준비|예비\s*부모|난임|임산부)/;
export function familySignal(sit: Situation): boolean {
  const t = sit.x.interests ?? [];
  return t.includes("pregnancy") || t.includes("baby") || t.includes("newlywed") || !!sit.profile.children?.some((c) => c === "pregnant" || c === "0-1");
}
const OCC_QUOTE = /원문의 대상 요건 확인 \('(?:폐업|소상공인|종사자|교직원|교사|교원|선수|강사|임직원|직원|사업자|대표|소속|회원|단체|기관|재직|경력)/;
const TRAIT_NAME: [RegExp, HouseholdTraitKey, TopicId?][] = [
  [/(한부모|조손|미혼\s*[모부]|양육비\s*이행)/, "single_parent", "single_parent"],
  [/다자녀/, "multi_child"],
  [/(국가\s*유공|보훈|참전|제대\s*군인)/, "veteran"],
  [/(다문화|결혼\s*이민|북한\s*이탈|탈북|북향민)/, "multicultural"],
];
type HouseholdTraitKey = "single_parent" | "multi_child" | "veteran" | "multicultural";
export function traitGatedWithoutSignal(name: string, sit: Situation): boolean {
  for (const [re, k, topic] of TRAIT_NAME) {
    if (!re.test(name)) continue;
    if (inferExtras(sit).traits[k] === true || (sit.profile.traits ?? []).includes(k)) return false;
    if (topic && sit.x.interests?.includes(topic)) return false;
    return true;
  }
  return false;
}
const MALE_ONLY_NAME = /사회\s*복무\s*요원|병역\s*(?:판정|의무)|입영|현역\s*(?:병|장병)|예비군|군\s*복무\s*(?:중|장병)/;
const MALE_ONLY_WHY = /남성\s*(?:대상|만)|남자\s*(?:대상|만)/;
const FEE_DISCOUNT = /(주차|입장료|관람료|(?:이용|사용)\s*(?:요금|료)\s*(?:감면|할인|면제))/;
const GROUP_DIMS: DimId[] = ["support", "disability", "singleParent", "veteran", "multicultural"];
const DISABILITY_NAME = /장애(?!\s*(?:물|없는|예방))|발달\s*지연/;
/**
 * 말한 주제에 해당하는 사업: 이름, 또는 대상 문구 앞부분 — 단 대상 문구의 그 줄이 '우선 선발·가점'이면 주제 사업이 아님
 * (QA 5차 Q1: '실직했어요' → 산림보호지원단 '장기실업자 등 취업취약계층 우선선발')
 */
const TOPIC_PRIORITY = /우선\s*(?:선발|선정|순위|대상|지원|배정|공급|입주)?|가점|우대|배점/;
export function topicalOf(p: Program, sit: Situation): TopicId[] {
  const byName = programTopics(p.name, sit.x.interests);
  const all = programTopics(p.name, sit.x.interests, p.target);
  return all.filter((k) => {
    if (byName.includes(k)) return true;
    const tgt = (TOPICS[k] as { tgt?: RegExp }).tgt;
    const lines = (p.target ?? "").slice(0, 200).replace(/&#13;/g, "\n").split("\n").filter((l) => !!tgt && tgt.test(l));
    // '장기실업자 … 우선선발'처럼 우선·가점만 주는 줄은 주제 사업으로 보지 않음 ('신혼부부 특별공급'은 전용 물량이라 주제 사업)
    return lines.some((l) => !TOPIC_PRIORITY.test(l));
  });
}
/** 청년 사업이 아닌 청소년 사업 이름 */
const YOUTH_NAME = /청소년(?!\s*(?:자녀|부모|가정|가족))/;
const TRAIT_KEYS = ["single_parent", "multi_child", "veteran", "multicultural"] as const;
/** 판정 이유에 아직 정해지지 않은 가구 특성 조건이 있고 그 특성을 말하지 않았음 */
export function traitReasonWithoutSignal(i: V2Item, sit: Situation): boolean {
  const tr = inferExtras(sit).traits;
  return i.base.ev.reasons.some((r) => {
    if (r.kind === "met" || r.leaf?.field !== "trait" || !("anyOf" in r.leaf)) return false;
    const keys = (r.leaf.anyOf as string[]).filter((k) => (TRAIT_KEYS as readonly string[]).includes(k));
    return keys.length > 0 && !keys.some((k) => tr[k as (typeof TRAIT_KEYS)[number]] === true || (sit.profile.traits ?? []).includes(k as (typeof TRAIT_KEYS)[number]));
  });
}
const PICK_BLOCK_WHY = /(사는 곳 조건|법인·시설·단체|기관·시설|직업·신분|직업·자격|개인이 신청해 받는 혜택이 아니에요|따로 조건\(|지자체가 따로 정해요)/;
export const PENSION_WHY = "소득만 보면 받으실 가능성이 높아요 — 재산(소득인정액)에 따라 달라요";
/** 누구나 받거나 안내 위주인 보편 서비스 (예방접종·검진·할인·상담 창구) — 앞자리를 핵심 급여에 양보 */
const UNIVERSAL_LOW = /(예방\s*접종|건강\s*검진|검진비|철도|공공\s*할인|생활\s*체육|스포츠\s*강좌|말벗|정신\s*건강\s*복지\s*센터|방문\s*건강\s*관리|안부)/;
const ILLNESS_NAME = /(상병|수술|질환|치료비|환자|투병|난치|희귀|암\s*검진|치매|당뇨|투석|혈우)/;
export function rankAdj(i: V2Item, sit: Situation): number {
  const p = i.s.program;
  if (VICTIM_RE.test(p.name)) return -6;
  // 체험·견학·탐방·캠프 사업은 받는 혜택이 아니라 행사 참여 — 목록 맨 뒤로, 먼저 확인할 것에는 두지 않음 (결정 3b, 2026-10-09: '발전소 시설 견학')
  if (EXPERIENCE_NAME.test(p.name)) return -6;
  if (isBasicPension(p) && (pensionLikely(sit) || pensionWanted(sit))) return 6;
  if (isBasicPension(p) && pensionPossible(sit)) return 4;
  // 임신: 누구나 받는 기본 사업(행복카드·산모신생아·모자보건수첩 등)을 앞에, 위기·고위험·청소년 산모 사업은 뒤에 (QA 4차 S1)
  if (sit.x.interests?.includes("pregnancy")) {
    if (PREG_CORE.test(p.name)) return 5;
    if (PREG_SPECIAL.test(p.name)) return 0;
  } else if (PREG_SPECIAL.test(p.name)) return -4;
  // 대학생: 누구나 신청하는 국가장학금·근로장학금·학자금 대출(이자 지원)을 앞에 (QA 5차 U1)
  if (sit.x.interests?.includes("student")) {
    if (STUDENT_CORE.test(p.name)) return 5;
  } // 위기·고위험 임신 신호 없이 영아 가구 1위가 되던 문제 (QA 5차 P2b)
  // 학교 밖 청소년: 학교밖청소년지원센터(꿈드림) 지원·건강검진·검정고시를 앞에 (QA 5차 검증 N2)
  if (sit.x.interests?.includes("out_of_school") && OUT_OF_SCHOOL_CORE.test(p.name)) return 6;
  // 성적·전공·분야로 뽑는 장학금(이공계 우수학생 등)은 그 신호가 없으니 일반 장학금보다 뒤로 (QA 7차 N6)
  if (SELECTIVE_SCHOLARSHIP.test(p.name)) return -2;
  // 부모(자녀) 화면: 자녀 본인이 참여하는 체험·창업·캠프 사업은 뒤로 (QA 7차 P4: '고등학생 딸 키우는 엄마'에 '청소년비즈쿨')
  const teen = sit.mode === "self" && (ageBoundsOf(sit)?.[1] ?? 120) <= 18;
  if (!teen && KID_SELF_ACTIVITY.test(p.name) && (sit.profile.children ?? []).some((c) => c === "6-12" || c === "13-18")) return -3;
  // 문장에서 말한 주제(신혼·실직·아기·치매·월세·대학생 등)의 사업은 앞으로 — 이름에 주제가 있으면 +3, 대상 문구에만 있으면 +1 (QA 5차 Q1)
  if (topicalOf(p, sit).length) return 3;
  if (SPECIAL_STATUS.test(p.name)) return -4;
  if (i.base.why === MEANS_WHY) return 2;
  if (UNIVERSAL_LOW.test(p.name)) return -2;
  // 병·수술이 있어야 하는 사업은 병을 말하지 않았으면 뒤로 (예: '노인 무릎인공관절 수술'이 1순위가 되던 문제)
  if (sit.x.facts.illness !== true && (ILLNESS_NAME.test(p.name) || leavesOf(p.rule.logic).some((l) => l.field === "unasked" && FACT_PATTERNS.illness.test(l.label)))) return -2;
  return 0;
}

const MAIN: Filters = { tier: "eligible", category: null, org: null, q: "" };
/** 본문 대상: 자동 제공·기관 선정·기본 숨김(교육청·복지 외 분야·기관 운영) 제외 */
export const inMain = (p: Program) => !autoLike(p) && !hiddenByDefault(p, MAIN) && !notForPersons(p);

/** 개인이 받는 혜택이 아닌 사업 (QA 1차 C3·M1): 언론사·사회적기업·단체 대상, 공공기관 시설 체험 행사 */
const ORG_TARGET = /^[\s○ㅇ\-·•*]*(?:지원\s*대상\s*[:：]?\s*)?(?:신문|인터넷\s*신문|인터넷\s*뉴스|잡지|방송사|언론사|정기\s*간행물|사회적\s*기업|예비\s*사회적\s*기업|지원\s*대상\s*단체)(?=[\s,·、(]|사|$)/;
const ORG_NAME = /(기획\s*취재|언론사|신문사|방송사|렛츠런\s*파크|경마)/;
/** 기부·후원·모금 캠페인 (받는 혜택이 아니라 내는 사업 — QA 2차 C3: 사랑나눔 1인1나눔 계좌갖기) */
export const DONATION_RE = /(나눔\s*계좌|1\s*인\s*1\s*나눔|계좌\s*갖기|정기\s*후원|후원\s*(?:신청|회원|계좌|자\s*모집)|기부\s*(?:캠페인|신청|참여|약정)|모금\s*(?:캠페인|운동)|성금\s*모금|나눔\s*캠페인)/;
export const notForPersons = (p: Program) => ORG_NAME.test(p.name) || DONATION_RE.test(p.name) || ORG_TARGET.test((p.target ?? "").replace(/&#13;/g, "\n"));
/** 피해자·특정 사건 대상 사업 — 숨기지는 않되(필요한 분이 있음) 먼저 확인할 것·목록 앞에는 두지 않는다 (QA 1차 M1) */
export const VICTIM_RE = /(피해\s*아동|피해자|피해\s*청소년|학대|성착취|성매매|가정\s*폭력|성폭력|보호\s*전문\s*기관|범죄|유가족|참사|사건)/;

export function scoreV2(programs: Program[], sit: Situation): Scored[] {
  const { profile, opts } = toEval(sit, false);
  return scoreAll(programs.filter(inMain), profile, (p) => evaluateRule(p.rule, profile, opts));
}

export interface V2View {
  fit: V2Item[][];
  ask: V2Item[][];
  office: V2Item[][];
  no: V2Item[][];
  /** 추가 질문 (정할 수 있는 혜택 수 순) */
  questions: { dim: Dim; groups: number; keys: string[] }[];
  /** 위 질문 몇 개로 정해지는 혜택 수 (묶음) */
  unlock: number;
  /** 원문 신청기간이 끝난 혜택 (받으실 수 있어요·확인·답하면에서 뺀 것 — 다음 접수는 공고 확인) */
  closed?: V2Item[][];
}

const ORDER: Bucket[] = ["fit", "ask", "office", "no"];
const SAME_ORDER: Bucket[] = ["fit", "office", "ask", "no"];

/** 판정·분류·묶음. 같은 사업의 지역 변형은 가장 좋은 분류 하나로 */
/**
 * 질문 답으로 혜택이 '열릴' 가능성 (대략의 사전 확률). 보훈·다문화처럼 드문 신분은 대부분 '아니요'라
 * 답해도 찾는 혜택이 늘지 않으므로 뒤로 (QA 2차 M2). 부모님 찾기에서는 돌봄·장기요양을 높게.
 */
export const RARE_DIMS: ReadonlySet<DimId> = new Set<DimId>(["veteran", "multicultural"]);

export function questionPrior(id: DimId, sit: Situation): number {
  const parent = sit.mode === "parent";
  switch (id) {
    case "veteran":
    case "multicultural":
      return 0.1;
    case "singleParent":
      return 0.25;
    case "illness":
    case "disability":
      return parent ? 0.5 : 0.3;
    case "care":
    case "ltcGrade":
      return parent ? 1 : 0.3;
    default:
      return 1;
  }
}

export function buildView(scored: Scored[], sit: Situation, maxQuestions = 3, now: Date = new Date()): V2View {
  const items = scored.map((x) => classify(x, sit));
  const seen = new Set<string>();
  const out: Record<Bucket, V2Item[][]> = { fit: [], ask: [], office: [], no: [] };
  // 출처마다 이름이 다른 것으로 확인한 전국 제도는 판정이 갈리면 조건이 이미 맞은 쪽('신청할 때 확인')을
  // '답하면 정해져요'보다 앞에 둔다 (2026-10-16: 복지로 '건강보험 임신출산 진료비'는 맞았는데 정부24 이름이 성별·나이를 물어 뒤로 밀림)
  const sameAt = new Map<string, Bucket>();
  // 비슷한 이름의 지역 사업이 섞이면 기존 순서를 유지해 그 사업의 미응답 조건을 숨기지 않는다.
  const otherKeys = new Set(items.filter((i) => !isSameProgram(i.s.program)).map((i) => i.s.group));
  for (const b of SAME_ORDER) for (const i of items) if (i.bucket === b && !otherKeys.has(i.s.group) && !sameAt.has(i.s.group)) sameAt.set(i.s.group, b);
  for (const b of ORDER) {
    const list = items.filter((i) => i.bucket === b);
    const groups = groupVariants(list.map((i) => i.s));
    const byScored = new Map(list.map((i) => [i.s, i]));
    for (const g of groups) {
      if (seen.has(g.key) || (sameAt.has(g.key) && sameAt.get(g.key) !== b)) continue;
      seen.add(g.key);
      out[b].push([g.lead, ...g.variants].map((x) => byScored.get(x)!));
    }
  }
  // 신청 기간이 끝난 사업은 받으실 수 있어요·확인·답하면에서 빼서 따로 (운영자 피드백 2026-10-09)
  const closed: V2Item[][] = [];
  for (const b of ["fit", "office", "ask"] as const) {
    out[b] = out[b].filter((g) => (closedSince(g[0].s.program, now) ? (closed.push(g), false) : true));
  }
  // 정렬: 관련도 + '나를 콕 집은' 사업 먼저
  const key = (g: V2Item[]) => g[0].s.score + (g[0].s.specific ? 1 : 0) + rankAdj(g[0], sit);
  // 체험·견학 행사는 각 목록 맨 뒤 (결정 3b)
  const exp = (g: V2Item[]) => (EXPERIENCE_NAME.test(g[0].s.program.name) ? 1 : 0);
  for (const b of ORDER) out[b].sort((a, c) => exp(a) - exp(c) || key(c) - key(a));
  // 질문 순서: 정해지는 혜택의 관련도 제곱 합 — 관련 높은 혜택(기초연금·돌봄 등)을 정하는 질문 먼저, 그다음 많이 정하는 질문
  const count = new Map<DimId, Set<string>>();
  const weight = new Map<DimId, number>();
  for (const g of out.ask) for (const id of g[0].dims) {
    if (!count.has(id)) count.set(id, new Set());
    count.get(id)!.add(g[0].s.group);
    const sc = Math.max(0, key(g));
    weight.set(id, (weight.get(id) ?? 0) + sc * sc + 0.01);
  }
  // QA 2차 M2: 질문의 '값' = 정해지는 혜택의 관련도 × 그 답으로 혜택이 열릴 가능성(드문 신분은 낮게).
  // 나이를 모르면 나이부터 (QA 1차 H2). 가구원 수는 소득을 말했을 때만 앞에 둔다.
  // 월 소득을 말했는데 가구원 수를 모르면 소득 판단에 가구원 수가 꼭 필요하므로 나이 다음으로 (QA 1차 M2)
  const incomeKnown = sit.x.incomeManwon != null;
  // (결정 2b) 자녀 나이를 모르는 부모 문장은 자녀 나이부터 — 아동 혜택은 부모 나이 없이도 정해져 먼저 확인할 것이 바로 채워짐
  const childFirst = childAgeFirst(sit);
  const first = (id: DimId) => (id === "children" && childFirst ? 3 : id === "age" ? 2 : id === "alone" && incomeKnown ? 1 : 0);
  const value = (id: DimId) => (weight.get(id) ?? 0) * questionPrior(id, sit);
  // 보훈·다문화처럼 드문 신분은 먼저 묻지 않는다 (입력 화면에서는 언제든 답할 수 있음)
  const ranked = [...count]
    .filter(([id]) => !RARE_DIMS.has(id))
    .sort((a, b) => first(b[0]) - first(a[0]) || value(b[0]) - value(a[0]))
    .slice(0, maxQuestions);
  const union = new Set(ranked.flatMap(([, v]) => [...v]));
  return {
    ...out,
    questions: ranked.map(([id, v]) => ({ dim: DIM_BY_ID[id], groups: v.size, keys: [...v] })),
    unlock: union.size,
    closed,
  };
}

/* ---------------- 쉬운 말 ---------------- */

const manwon = (won: number) => `${Math.floor(won / 10000).toLocaleString("ko-KR")}만원`;

const BENEFIT_PLAIN: Record<Benefit, string> = {
  livelihood: "생계급여(매달 생활비)를 받는 분",
  medical: "의료급여(병원비 지원)를 받는 분",
  housing: "주거급여(월세·집수리)를 받는 분",
  education: "교육급여를 받는 분",
  near_poverty: "차상위계층 확인을 받은 분",
  basic_pension: "기초연금을 받는 분",
};

/** 수급 조건 → 짧은 쉬운 말 (생계·의료·주거·교육급여 중 3개 이상이면 '기초생활수급자') */
export function benefitPlain(any: Benefit[]): string {
  if (any.length === 1) return BENEFIT_PLAIN[any[0]];
  const basic = any.filter((b) => b !== "near_poverty" && b !== "basic_pension");
  const parts: string[] = [];
  if (basic.length >= 3) parts.push("기초생활수급자");
  else basic.forEach((b) => parts.push(`${BENEFIT_PLAIN[b].replace(/\(.*\)를 받는 분$/, "")} 수급자`));
  if (any.includes("near_poverty")) parts.push("차상위계층");
  if (any.includes("basic_pension")) parts.push("기초연금 수급자");
  return `${parts.join("·")}인 분`;
}

/** 2026 기초연금 선정기준액 (소득인정액) */
export function pensionLine(prof: Profile): string {
  const t = BASIC_PENSION_THRESHOLD_2026;
  if (prof.householdSize === 1) return `소득인정액이 월 ${manwon(t.single)} 이하 (혼자 사는 어르신)`;
  if (prof.householdSize !== "unknown") return `부부 소득인정액이 월 395만 2천원 이하`;
  return `소득인정액이 월 ${manwon(t.single)}(혼자)·395만 2천원(부부) 이하`;
}

function incomeLine(pct: number, prof: Profile): string {
  const size = sizeOf(prof);
  if (size) return `가구 소득이 월 ${manwon(medianWon(pct, size))} 이하 (${size}인 가구 기준)`;
  return `가구 소득이 월 ${manwon(medianWon(pct, 1))}(1인)·${manwon(medianWon(pct, 2))}(2인) 이하`;
}

/** 잎 조건 → 쉬운 말 한 줄 */
export function plainLeaf(leaf: Leaf, prof: Profile): string {
  switch (leaf.field) {
    case "age":
      if (leaf.min !== undefined && leaf.max !== undefined) return `만 ${leaf.min}~${leaf.max}세`;
      if (leaf.min !== undefined) return `만 ${leaf.min}세 이상`;
      if (leaf.max !== undefined) return `만 ${leaf.max}세 이하`;
      return leaf.label;
    case "income":
      return incomeLine(leaf.lte, prof);
    case "incomeBands": {
      const hi = Math.max(...leaf.bands.map((b) => b[1] ?? Infinity));
      return Number.isFinite(hi) && hi < 1000 ? incomeLine(hi, prof) : leaf.label;
    }
    case "benefit":
      return benefitPlain(leaf.anyOf);
    case "care":
      return leaf.anyOf.includes("daily") ? "일상생활에 도움이 필요한 분" : "최근 퇴원한 분";
    case "disability":
      return leaf.severity === "severe" ? "심한 장애로 등록된 분" : leaf.severity === "mild" ? "심하지 않은 장애로 등록된 분" : "등록 장애인";
    case "householdSize":
      return leaf.max === 1 ? "혼자 사는 분" : leaf.label;
    case "resident":
      return "이 지역에 사는 분";
    case "unasked":
      if (FACT_PATTERNS.pension70.test(leaf.label)) return pensionLine(prof);
      return leaf.label.replace(/\s*\(원문 확인\)/, "");
    default:
      return leaf.label.replace(/\s*\(원문 확인\)/, "");
  }
}

function gateLine(g: Gate, prof: Profile): string {
  switch (g.kind) {
    case "recipient": return "기초생활수급자·차상위계층인 분";
    case "low": return `${incomeLine(LOW_INCOME_PCT, prof)}인 저소득 가구 (기준이 숫자로 없어 중위소득 ${LOW_INCOME_PCT}%로 봤어요)`;
    case "median": return incomeLine(g.pct, prof);
    case "basicPension": return "기초연금을 받는 분";
  }
}

const PROXY = /가구원 본인 이름으로 신청/;
const reasonPlain = (r: Reason, prof: Profile) => {
  // 장애가 있는 가족(가구원) 이름으로 신청하는 경우
  if (r.kind === "unknown" && r.field === "disability" && PROXY.test(r.text)) return `${r.leaf ? plainLeaf(r.leaf, prof) : "장애인 본인"} — 장애가 있는 가족 이름으로 신청 (그 가족 기준으로 확인)`;
  if (r.leaf) return r.kind === "unknown" && r.leaf.capU ? `${r.leaf.label} (세부 기준)` : plainLeaf(r.leaf, prof);
  return r.text.replace(/\s+—\s.*$/, "").replace(/^(추가로 확인할 조건|상담으로 판단하는 조건):\s*/, "");
};
/** 신청 과정에서 정해지는 잎 조건 (장기요양등급) — 카드의 '맞은 조건'에서 뺀다 */
const isProcessLeaf = (r: Reason) => r.leaf?.field === "unasked" && FACT_PATTERNS.ltcGrade.test(r.leaf.label);
/** 받침에 맞춘 '은/는' (예: '만 6~64세는', '혼자 사는 분은') */
export function withTopic(t: string): string {
  const m = /([가-힣])[^가-힣]*$/.exec(t);
  if (!m) return /[0-9]$/.test(t) ? `${t}은` : `${t}은`;
  const code = m[1].charCodeAt(0) - 0xac00;
  // 끝 글자 뒤에 괄호·숫자 등이 붙어 있으면 끝 한글 기준
  return `${t}${code % 28 === 0 ? "는" : "은"}`;
}
const short = (t: string, n = 70) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

/** 카드 한 줄: 사용자 말로 */
export function plainLine(i: V2Item, sit: Situation, mode: FindMode): string {
  const { profile } = toEval(sit);
  const ev = i.base.ev;
  const met = ev.reasons.filter((r) => r.kind === "met" && r.leaf?.field !== "resident" && !(i.base.process && isProcessLeaf(r))).map((r) => reasonPlain(r, profile));
  const who = mode === "parent" ? "부모님이" : "";
  switch (i.bucket) {
    case "fit": {
      // 원문 소득 관문(저소득·중위 N%)이 맞았으면 소득 코드 줄은 빼고 관문 한 줄만 (소득 문구 중복 — QA 2차 L1)
      const gateIncome = i.base.gate && i.base.gateState === "met" && (i.base.gate.kind === "low" || i.base.gate.kind === "median");
      const parts = gateIncome ? ev.reasons.filter((r) => r.kind === "met" && r.leaf?.field !== "resident" && r.leaf?.field !== "income" && r.leaf?.field !== "incomeBands" && !(i.base.process && isProcessLeaf(r))).map((r) => reasonPlain(r, profile)) : [...met];
      if (i.base.gate && i.base.gateState === "met") parts.push(gateLine(i.base.gate, profile));
      const head = parts.length ? `${[...new Set(parts)].slice(0, 3).join(" · ")} — ${who ? who + " " : ""}해당돼요.` : "입력하신 상황으로 조건이 맞아요.";
      if (i.base.process) return `${head} ${i.base.process}`;
      const note = ev.reasons.find((r) => r.kind === "note" && !/재산·세부 요건은 원문/.test(r.text));
      const tail = [i.base.priority ? "저소득층 우선 선정" : "", note ? `참고: ${short(reasonPlain(note, profile), 50)}` : ""].filter(Boolean).join(" · ");
      return tail ? `${head} (${tail})` : head;
    }
    case "ask": {
      const g = i.base.gate && i.base.gateState === "unknown" ? gateLine(i.base.gate, profile) : null;
      const unks = ev.reasons.filter((r) => r.kind === "unknown" && r.leaf);
      const unk = unks.find((r) => r.leaf?.field === "unasked" && FACT_PATTERNS.pension70.test(r.leaf.label)) ?? unks[0];
      const cond = g ?? (unk ? reasonPlain(unk, profile) : null);
      return cond ? `${short(cond)}이면 받을 수 있어요.` : "위 질문에 답하시면 바로 알려드려요.";
    }
    case "office": {
      // 개인 대상이 아닌 사업은 '맞은 조건'을 앞에 쓰지 않는다
      const metLead = met.length && i.base.why !== NOT_FOR_PERSON_WHY ? `${withTopic([...new Set(met)].slice(0, 2).join(" · "))} 맞아요. ` : "";
      const named = NAMED_GROUP.exec(i.s.program.name);
      if (named) return `${metLead}확인할 것: '${named[1]}'에 해당하는 분만 받을 수 있어요.`;
      if (CRISIS.test(i.s.program.name)) return `${metLead}갑작스러운 위기(실직·질병·사고 등)가 생겼을 때 받는 지원이에요.`;
      if (i.base.why) return `${metLead}확인할 것: ${i.base.why.replace(/ — /, ". ")}`;
      if (i.base.base === "autoFit") return `${metLead}확인할 것: 세부 자격 (조건을 원문에서 자동으로 정리했어요)`;
      // 장애가 있는 가족 이름으로 신청 — 나이도 그 가족 기준 (QA 4차 S3)
      const proxy = ev.reasons.find((r) => r.kind === "unknown" && r.field === "disability" && PROXY.test(r.text));
      if (proxy) {
        const ageL = ev.reasons.find((r) => r.leaf?.field === "unasked" && r.leaf.label.endsWith(MEMBER_AGE));
        const who = proxy.leaf ? plainLeaf(proxy.leaf, profile) : "장애인 본인";
        return `${metLead}확인할 것: ${who} — 장애가 있는 가족 이름으로 신청 (${ageL ? `그 가족이 ${ageL.leaf!.label.slice(0, -MEMBER_AGE.length).trim()}인지 확인` : "그 가족 기준으로 확인"})`;
      }
      const unk = ev.reasons.find((r) => r.kind === "unknown") ?? ev.reasons.find((r) => r.kind === "note");
      return `${metLead}확인할 것: ${unk ? short(reasonPlain(unk, profile), 60) : "세부 자격(원문)"}`;
    }
    case "no": {
      if (i.base.why === STUDENT_NO_WHY) return STUDENT_NO_WHY;
      if (i.base.gate && i.base.gateState === "no") return `${gateLine(i.base.gate, profile)} 대상이라 맞지 않아요.`;
      const un = ev.reasons.find((r) => r.kind === "unmet");
      if (un && !un.leaf && /중 해당하는 항목이 없어요$/.test(un.text)) return `${short(un.text.replace(/없어요$/, "없어"))} 맞지 않아요.`;
      // 소득 초과는 숫자를 먼저 (QA 3차 R7: '월 90만원 > 기준 82만원')
      if (un && (un.leaf?.field === "income" || un.leaf?.field === "incomeBands") && sit.x.incomeManwon != null)
        return `입력하신 소득 월 ${sit.x.incomeManwon.toLocaleString("ko-KR")}만원이 기준(${short(reasonPlain(un, profile)).replace(/^가구 소득이 /, "").replace(/\s*\((\d+인 가구) 기준\)/, ", $1")})보다 많아 맞지 않아요.`;
      return un ? `${short(reasonPlain(un, profile))} 대상이라 맞지 않아요.` : "입력하신 상황과 맞지 않아요.";
    }
  }
}

/** 소득 입력 → 쉬운 말 구간 설명 */
export function incomeExplain(manwonValue: number, size: 1 | 2 | 3 | 4 | 5 | 6): { band: IncomeBand; pct: number; line: string } {
  const won = manwonValue * 10000;
  const band = incomeBandFor(won, size);
  const pct = Math.round((won / medianWon(100, size)) * 1000) / 10;
  const marks: [number, string][] = [[32, "생계급여"], [40, "의료급여"], [48, "주거급여"], [50, "차상위·교육급여"]];
  const under = marks.filter(([m]) => pct <= m).map(([, l]) => l);
  const line = under.length
    ? `${size}인 가구 기준중위소득의 약 ${pct}% — ${under.join("·")} 소득 기준 안이에요.`
    : `${size}인 가구 기준중위소득의 약 ${pct}% — 기초생활보장·차상위 소득 기준(50%)보다 높아요.`;
  return { band, pct, line };
}

/** v1 화면과 함께 쓰는 저장용 프로필 (다중 항목은 하나라도 '모름'이면 v1에는 답한 '예'만 남긴다) */
export function profileForStorage(s: Situation): Profile {
  const x = inferExtras(s);
  const pick = <K extends string>(keys: readonly K[], m: Partial<Record<K, boolean>>): K[] | null =>
    keys.some((k) => m[k] !== undefined) ? keys.filter((k) => m[k] === true) : null;
  return { ...s.profile, income: incomeOf(s), benefits: pick(BENEFITS, x.benefits), traits: pick(HOUSEHOLD_TRAITS, x.traits) ?? s.profile.traits };
}

/** 머리글 요약 (지역 제외) */
export function situationChips(s: Situation): string[] {
  const p = s.profile;
  const out: string[] = [];
  if (p.age !== "unknown") {
    const [a, b] = ageRange(p.age);
    out.push(b >= 120 ? `만 ${a}세 이상` : `만 ${a}~${b}세`);
  } else if (s.x.ageSpan) {
    // 말한 나이 범위 (예: '30대') — 정확한 나이는 아래 질문으로
    const [a, b] = s.x.ageSpan;
    out.push(a % 10 === 0 && b === a + 9 ? `${a}대 (정확한 나이 모름)` : b >= 100 ? `만 ${a}세 이상 (정확한 나이 모름)` : `만 ${a}~${b}세 (정확한 나이 모름)`);
  }
  if (p.householdSize !== "unknown") out.push(p.householdSize === 1 ? "혼자 사심" : `${p.householdSize}명 가구`);
  const size = sizeOf(p);
  if (s.x.incomeManwon !== null) {
    out.push(size ? `소득 월 ${s.x.incomeManwon.toLocaleString("ko-KR")}만원 (중위소득의 약 ${Math.round((s.x.incomeManwon * 1e6) / medianWon(100, size))}%)` : `소득 월 ${s.x.incomeManwon}만원`);
  } else if (p.income !== "unknown") out.push(`소득 중위 ${p.income}% 이하`);
  const x = inferExtras(s);
  const rec = RECIPIENT_KINDS.filter((k) => x.benefits[k] === true);
  if (rec.length) out.push(rec.map((k) => BENEFIT_PLAIN[k].replace(/\(.*$/, "")).join("·") + " 수급");
  else if (RECIPIENT_KINDS.every((k) => x.benefits[k] === false)) out.push("수급·차상위 아님");
  // 기초연금은 60세 이상(또는 나이 모름)일 때만 보여 준다 (청년·중년 화면에 '기초연금 안 받음'이 뜨지 않게)
  const seniorish = p.age === "unknown" || ageRange(p.age)[1] >= 60;
  if (x.benefits.basic_pension === true) out.push("기초연금 받음");
  else if (x.benefits.basic_pension === false && seniorish) out.push("기초연금 안 받음");
  if (p.care?.length) out.push("일상생활 도움 필요");
  if (p.disability === "none") out.push("장애 없음");
  else if (p.disability === "member") out.push("가족 중 장애 있음");
  else if (p.disability !== "unknown") out.push("장애 있음");
  return out;
}

/* ---------------- 먼저 확인할 5가지 · 자동으로 받는 혜택 ---------------- */

/**
 * 먼저 확인할 n개: '받으실 수 있어요'(가산 +3)와 '신청할 때 확인' 중 관련도 순.
 * 내 상황을 콕 집은 사업(specific)을 먼저 채우고, 같은 계열(양육비 이행 원스톱/지원 등)은 하나만.
 * '답하면 정해져요'·'뺐어요'는 넣지 않는다 (애매한 것을 맨 위에 올리지 않음).
 */
/**
 * 함께 사는 부모님(장인·장모·시부모님 포함)께 맞는 혜택 (결정 1b, 인수 문서 H2): 같은 지역, 고른 나이대만으로 부모님 찾기 기준 먼저 확인할 것.
 * 본인 답(나이·소득·가구)은 그분 상황이 아니라 쓰지 않는다. 더 정확히는 '부모님 기준으로 따로 찾기'.
 */
export const cohabitParentSit = (sit: Situation, band: AgeBand): Situation => ({ profile: { ...EMPTY_PROFILE, sido: sit.profile.sido, sigungu: sit.profile.sigungu, age: band }, x: { ...EMPTY_EXTRAS }, mode: "parent" });
export function cohabitParentPicks(programs: Program[], sit: Situation, band: AgeBand, n = 5): V2Item[][] {
  const ps = cohabitParentSit(sit, band);
  return topPicksV2(buildView(scoreV2(programs, ps), ps, 12), n, ps);
}
export function topPicksV2(view: Pick<V2View, "fit" | "office"> & Partial<Pick<V2View, "ask">>, n = 5, sit?: Situation): V2Item[][] {
  // '받으실 수 있어요'에 +2 (v1 추천의 '조건 충족' 가산과 같게) — 관련도가 확실히 높은 '신청할 때 확인'(장애인 활동지원 등)은 앞설 수 있다
  // 순위 보정: 기초연금 가능성 높음 +4, 소득 기준 안의 공공부조 +2, 보편 서비스(예방접종 등) −2
  const key = (g: V2Item[]) => g[0].s.score + (g[0].bucket === "fit" ? 2 : 0) + (g[0].reviewed ? 0.5 : 0) + (sit ? rankAdj(g[0], sit) : 0);
  // 기초연금은 '이미 받고 계신지'·소득만 남아 '답하면 정해져요'여도 65세 이상이면 먼저 확인할 것에 넣는다 (QA 1차 H1, 2차 H1)
  const pensionFirst = !!sit && (pensionLikely(sit) || pensionPossible(sit) || pensionWanted(sit));
  const pension = pensionFirst ? (view.ask ?? []).filter((g) => isBasicPension(g[0].s.program)) : [];
  // 문장에서 말한 주제의 사업은 '답하면 정해져요'여도 후보로 (예: '실직했어요' → 실업급여, '돌 안 된 아기' → 부모급여)
  // (대상 문구에만 주제 낱말이 있는 '답하면 정해져요'는 넣지 않음 — QA 5차 Q1: '실직했어요'에 대상 '장기실업자 우선'인 산림보호지원단)
  const topical = sit?.x.interests?.length ? (view.ask ?? []).filter((g) => topicalOf(g[0].s.program, sit).length && !isBasicPension(g[0].s.program)) : [];
  const pool = [...view.fit, ...view.office, ...pension, ...topical].sort((a, b) => key(b) - key(a) || a[0].s.program.name.localeCompare(b[0].s.program.name, "ko"));
  // 나이를 정확히 모르면 나이로 정해지는 혜택은 앞에 두지 않는다 (범위에 걸치는 것은 '답하면 정해져요')
  const ageUnknown = !!sit && sit.profile.age === "unknown";
  const spanKnown = !!sit?.x.ageSpan;
  const out: V2Item[][] = [];
  const fams = new Set<string>();
  for (const pass of [true, false]) {
    for (const g of pool) {
      if (out.length >= n) break;
      if (out.includes(g)) continue;
      const p = g[0].s.program;
      const forced = pension.includes(g);
      const onTopic = forced || (!!sit && topicalOf(p, sit).length > 0);
      if (pass && g[0].s.specific === false && !onTopic) continue;
      // 내 상황과 이어지는 근거가 있는 것만 (QA 2차 N3: 조건 없이 누구나 맞는 상담 창구·나이만 걸친 자동 정리 사업이 1~5위를 채우던 문제)
      if (!onTopic && sit && !hasSubstance(g[0], sit)) continue;
      if (VICTIM_RE.test(p.name) || (SPECIAL_STATUS.test(p.name) && !(onTopic && sit?.x.interests?.includes("out_of_school") && OUT_OF_SCHOOL_RE.test(p.name)))) continue;
      // 남성만·병역 대상(사회복무요원 등)은 성별을 모르면 먼저 확인할 것에 두지 않음 (QA 5차 검증 N3)
      if (!onTopic && (MALE_ONLY_NAME.test(p.name) || g[0].base.ev.reasons.some((r) => r.kind !== "met" && MALE_ONLY_WHY.test(r.text)))) continue;
      // 복지로 생애주기 태그가 자녀 나이로만 맞은 사업은 이름이 아동·청소년·교육·가족 사업일 때만 (QA 7차 P4: 고등학생 딸 엄마에 '대지급금')
      if (sit && !onTopic && LIFECYCLE_TAG.test((p.rule.logic as { label?: string } | null)?.label ?? "") && !CHILD_NAME.test(p.name) && metOnlyByChild(g[0])) continue;
      // '법인·시설·단체 대상', '직업·자격 조건'이 적힌 항목은 추천하지 않는다 (QA 2차 M1·N3)
      if (g[0].base.why && PICK_BLOCK_WHY.test(g[0].base.why)) continue;
      // 이름에 대상 집단(한부모·다자녀·보훈·다문화·북한이탈)이 있는데 그 신호가 없으면 먼저 확인할 것에 두지 않는다 (QA 4차 S7: 월세 문장에 '한부모가족 임대주택')
      if (sit && !forced && traitGatedWithoutSignal(p.name, sit)) continue;
      // 조건 문구에 가구 특성(다문화·북한이탈·한부모 등)이 남아 있는데 그 신호가 없으면 넣지 않음 (QA 5차 Q1: 대학생 문장에 '청년도전지원사업(다문화·북한이탈 조건)')
      if (sit && !forced && traitReasonWithoutSignal(g[0], sit)) continue;
      // 대상 집단(수급·장애·한부모 등) 질문으로만 정해지는 '답하면 정해져요'는 이름이 주제와 맞을 때만 (QA 5차 Q1: '실직했어요'에 산림보호지원단·공공산림가꾸기)
      if (sit && !forced && g[0].bucket === "ask" && g[0].dims.length > 0 && g[0].dims.every((d) => GROUP_DIMS.includes(d)) && !programTopics(p.name, sit.x.interests).length) continue;
      // 주차·입장·관람 요금 감면은 먼저 확인할 것에 두지 않음 (QA 5차 Q1: '실직했어요' 5번째 '아트센터 주차장 이용요금 감면')
      if (!onTopic && FEE_DISCOUNT.test(p.name)) continue;
      // 이름에 장애가 적힌 사업은 장애를 말하지 않았으면 넣지 않음 (QA 5차 Q1: '실직했어요'에 '장애학생 취업지원')
      if (sit && !forced && DISABILITY_NAME.test(p.name) && sit.profile.disability !== "self" && sit.profile.disability !== "member") continue;
      // '청소년'(9~24세) 사업은 성인(만 19세 이상)에게 나이만 맞은 것 — 먼저 확인할 것에는 두지 않음 (QA 5차 C3b: 22세 대학생에게 청소년 상담·동반자)
      // 10대 본인에게 대학생 사업은 먼저 확인할 것에 두지 않음 (QA 7차: 중학생에게 '대학생 청소년교육지원장학금')
      if (sit && !onTopic && teenSelf(sit) && /대학(?:생|교)|대학원/.test(p.name)) continue;
      if (sit && !onTopic && YOUTH_NAME.test(p.name) && (ageBoundsOf(sit)?.[0] ?? 0) >= 19 && !(sit.profile.children ?? []).some((c) => c === "6-12" || c === "13-18")) continue;
      if (sit && !forced && !familySignal(sit) && (GENDERED_NAME.test(p.name) || g[0].base.ev.reasons.some((r) => r.kind !== "met" && GENDERED_WHY.test(r.text)))) continue;
      // '30대 중반'처럼 범위로 말했으면 범위 전체가 맞는 사업은 둔다 (QA 4차 R1: 두 나이대에 걸치면 추천이 1개뿐이던 문제)
      if (ageUnknown && !forced && ((!spanKnown && g[0].dims.includes("age")) || g[0].base.ev.reasons.some((r) => r.kind === "unknown" && r.field === "age"))) continue;
      // 원문 대상 낱말이 직업·소속인 자동 정리 항목 ('종사자'·'교직원'·'선수' 등)은 말하지 않았으면 먼저 확인할 것에 두지 않는다 (QA 4차 S4)
      if (!onTopic && g[0].base.ev.reasons.some((r) => r.kind !== "met" && OCC_QUOTE.test(r.text))) continue;
      const fk = familyKey(p.name);
      if (fams.has(fk)) continue;
      fams.add(fk);
      out.push(g);
    }
  }
  const sorted = out.sort((a, b) => pool.indexOf(a) - pool.indexOf(b));
  // 기초연금은 맨 앞 (65세 이상이고 아직 안 받는 분에게 가장 큰 현금 급여 — 말했으면 더욱)
  const pi = sorted.findIndex((g) => isBasicPension(g[0].s.program));
  if (pensionFirst && pi > 0) sorted.unshift(...sorted.splice(pi, 1));
  return sorted;
}

/**
 * 추천 근거: 맞은 조건 중 사는 곳 말고 내 상황(수급·소득·가구·자녀·장애·돌봄·주거·일 등)이 하나라도 있음.
 * 나이만 맞은 경우는 나이를 정확히 알 때만 (예: 73세 → 노인일자리), 나이 범위로 맞은 것은 근거로 보지 않음.
 */
function hasSubstance(i: V2Item, sit: Situation): boolean {
  const met = i.base.ev.reasons.filter((r) => r.kind === "met" && r.field !== "resident");
  if (met.some((r) => r.field !== "age")) return true;
  // 장애가 있는 가족 이름으로 신청하는 사업 (QA 4차 S3) — 가족의 장애가 근거
  if (i.base.ev.reasons.some((r) => r.kind === "unknown" && r.field === "disability" && PROXY.test(r.text))) return true;
  if (i.base.gate && i.base.gateState === "met") return true;
  return met.length > 0 && (sit.profile.age !== "unknown" || !!sit.x.ageSpan);
}

/**
 * 신청하지 않아도 받는(자동 제공·기관 선정) 사업 중 답한 상황과 어긋나지 않고 관련 있는 것 (본문과 따로 접어 둔다).
 * 기본 숨김(교육청·복지 외 분야·기관 운영)은 뺀다.
 */
export function autoV2(programs: Program[], sit: Situation): Group[] {
  const { profile, opts } = toEval(sit, false);
  const pool = programs.filter((p) => autoLike(p) && !hiddenByDefault(p, MAIN));
  const scored = scoreAll(pool, profile, (p) => evaluateRule(p.rule, profile, opts)).filter((x) => x.score > 0 && classifyBase(x.program, sit).base !== "no");
  const key = (x: Scored) => x.score + (x.ev.tier === "eligible" ? 2 : 0);
  return groupVariants([...scored].sort((a, b) => key(b) - key(a) || a.program.name.localeCompare(b.program.name, "ko")));
}

/** 한 사업 판정 (상세 화면용) — 관련도 없이 */
export function classifyOne(p: Program, sit: Situation): V2Item {
  const { profile, opts } = toEval(sit, false);
  const ev = evaluateRule(p.rule, profile, opts);
  const s: Scored = { program: p, ev, met: 0, score: 0, group: p.name };
  return classify(s, sit);
}

/* ---------------- 상세: 내 답과 맞은 것·어긋난 것·남은 질문 ---------------- */

export interface ExplainLine {
  /** 조건 (쉬운 말) */
  cond: string;
  /** 내 답 (쉬운 말). 없으면 답하지 않음 */
  answer?: string;
}

export interface Explain {
  matched: ExplainLine[];
  failed: ExplainLine[];
  unknown: ExplainLine[];
  /** 신청할 때 확인할 원문 조건 (간편 입력으로 묻지 않는 것) */
  notes: string[];
}

const ACTIVITY_PLAIN: Record<string, string> = { employed: "직장에 다님", self_employed: "자영업", job_seeking: "일자리를 찾는 중", student: "학생", none: "일하지 않음" };
const HOUSING_PLAIN: Record<string, string> = { own: "자가", jeonse: "전세", monthly: "월세", public_rental: "공공임대", other: "기타" };

/** 이 조건에 대해 사용자가 한 답 (쉬운 말). 답하지 않았으면 undefined */
export function answerText(field: Leaf["field"] | "gate", sit: Situation, leaf?: Leaf): string | undefined {
  const p = sit.profile;
  const x = inferExtras(sit);
  const size = sizeOf(p);
  const income = () => {
    if (sit.x.incomeManwon !== null) return `월 ${sit.x.incomeManwon.toLocaleString("ko-KR")}만원${size ? ` (${size}인 가구 기준중위소득의 약 ${Math.round((sit.x.incomeManwon * 1e6) / medianWon(100, size))}%)` : ""}`;
    return p.income === "unknown" ? undefined : `기준중위소득 ${p.income}% 이하 구간`;
  };
  const support = () => {
    const rec = RECIPIENT_KINDS.filter((k) => x.benefits[k] === true);
    if (rec.length) return rec.map((k) => BENEFIT_PLAIN[k].replace(/\(.*$/, "")).join("·") + " 받음";
    if (RECIPIENT_KINDS.every((k) => x.benefits[k] === false)) return sit.x.benefits.livelihood === undefined ? "수급·차상위 아님 (소득으로 추정)" : "수급·차상위 아님";
    return undefined;
  };
  switch (field) {
    case "age":
      return p.age === "unknown" ? undefined : situationChips({ ...sit, profile: { ...EMPTY_AGE_ONLY, age: p.age } })[0];
    case "income": case "incomeBands":
      return income() ?? support();
    case "gate":
      return [support(), income()].filter(Boolean).join(" · ") || undefined;
    case "benefit": {
      if (leaf?.field === "benefit" && leaf.anyOf.length === 1 && leaf.anyOf[0] === "basic_pension") {
        return x.benefits.basic_pension === undefined ? undefined : x.benefits.basic_pension ? "기초연금 받음" : "기초연금 안 받음";
      }
      const parts = [support(), x.benefits.basic_pension === true ? "기초연금 받음" : undefined].filter(Boolean);
      return parts.length ? parts.join(" · ") : undefined;
    }
    case "care":
      return p.care === null ? undefined : p.care.includes("daily") ? "일상생활 도움 필요" : p.care.includes("discharged") ? "최근 퇴원" : "도움 필요 없음";
    case "disability":
      if (p.disability === "unknown") return undefined;
      if (p.disability === "none") return "장애 없음";
      return `${p.disability === "member" ? "가족 중 " : ""}${p.disabilitySeverity === "severe" ? "심한 장애" : p.disabilitySeverity === "mild" ? "심하지 않은 장애" : "장애 있음"}`;
    case "householdSize":
      return size === null ? undefined : size === 1 ? "혼자 삶" : `${size}명 가구`;
    case "trait": {
      const t = { ...x.traits, ...(size !== null ? { single: size === 1 } : {}) };
      const on = (Object.keys(t) as HouseholdTrait[]).filter((k) => t[k] === true);
      const known = (Object.keys(t) as HouseholdTrait[]).filter((k) => t[k] !== undefined);
      if (leaf?.field === "trait") {
        const hit = leaf.anyOf.filter((k) => t[k] === true);
        if (hit.length) return hit.map((k) => TRAIT_PLAIN[k]).join("·");
        if (leaf.anyOf.every((k) => t[k] === false)) return leaf.anyOf.map((k) => `${TRAIT_PLAIN[k]} 아님`).join(" · ");
        return undefined;
      }
      return known.length ? (on.length ? on.map((k) => TRAIT_PLAIN[k]).join("·") : "해당 없음") : undefined;
    }
    case "housing":
      return p.housing === "unknown" ? undefined : HOUSING_PLAIN[p.housing];
    case "activity":
      return p.activity === "unknown" ? undefined : ACTIVITY_PLAIN[p.activity];
    case "children": case "childAge":
      if (p.children === null) return undefined;
      return p.children.length ? p.children.map((c) => CHILD_LABEL[c]).join(", ") : "자녀 없음";
    case "unasked": {
      if (!leaf) return undefined;
      for (const [k, re] of Object.entries(FACT_PATTERNS)) {
        if (!re.test(leaf.label)) continue;
        if (k === "pension70" && x.benefits.basic_pension === true) return "기초연금 받음";
        const v = x.facts[k as FactId];
        if (v === undefined) return undefined;
        return {
          ltcGrade: v ? "장기요양등급 있음" : "장기요양등급 없음", pension70: v ? "해당" : "해당 없음", illness: v ? "치료 중인 병 있음" : "치료 중인 병 없음",
          daycare: v ? "어린이집·유치원에 다님" : "어린이집·유치원에 다니지 않음", homeCare: v ? "집에서 키움" : "어린이집·유치원에 다님",
        }[k as FactId];
      }
      return undefined;
    }
    default:
      return undefined;
  }
}

const EMPTY_AGE_ONLY: Profile = { sido: null, sigungu: null, age: "unknown", householdSize: "unknown", traits: null, children: null, income: "unknown", benefits: null, housing: "unknown", car: "unknown", activity: "unknown", care: null, disability: "unknown", disabilitySeverity: "unknown" };
const TRAIT_PLAIN: Record<HouseholdTrait, string> = { single: "1인 가구", single_parent: "한부모·조손 가구", multi_child: "다자녀 가구", multicultural: "다문화·북한이탈 가구", veteran: "보훈 대상" };

/** 상세 화면: 조건마다 내 답과 맞았는지 */
export function explainItem(i: V2Item, sit: Situation): Explain {
  const { profile } = toEval(sit);
  const out: Explain = { matched: [], failed: [], unknown: [], notes: [] };
  const seen = new Set<string>();
  const push = (list: ExplainLine[], line: ExplainLine) => {
    const k = line.cond;
    if (seen.has(k)) return;
    seen.add(k);
    list.push(line);
  };
  for (const r of i.base.ev.reasons) {
    if (r.leaf?.field === "resident") {
      push(out.matched, { cond: "이 지역에 사는 분", answer: "사는 곳" });
      continue;
    }
    if (r.kind === "note") {
      const t = reasonPlain(r, profile);
      if (!/재산·세부 요건은 원문|구조화된 자격 조건이 아직 없어요/.test(t)) out.notes.push(short(t, 140));
      continue;
    }
    const cond = r.leaf ? reasonPlain(r, profile) : short(reasonPlain(r, profile), 120);
    const answer = r.leaf ? answerText(r.leaf.field, sit, r.leaf) : undefined;
    if (r.kind === "met") push(out.matched, { cond, answer });
    else if (r.kind === "unmet") push(out.failed, { cond, answer: answer ?? r.text.match(/\(입력: (.*)\)$/)?.[1] });
    else if (r.softNo) push(out.unknown, { cond: `${cond} (원문 분류상 대상 — 신청처에서 확인)`, answer });
    else if (r.leaf?.field === "unasked" && !answer) out.notes.push(short(cond, 140));
    else push(out.unknown, { cond, answer });
  }
  const g = i.base.gate;
  if (g) {
    const line = { cond: gateLine(g, profile), answer: answerText("gate", sit) };
    if (i.base.gateState === "met") push(out.matched, line);
    else if (i.base.gateState === "no") push(out.failed, line);
    else push(out.unknown, line);
  }
  const named = NAMED_GROUP.exec(i.s.program.name);
  if (named) out.notes.unshift(`'${named[1]}'에 해당하는 분만 받을 수 있어요.`);
  if (CRISIS.test(i.s.program.name)) out.notes.unshift("갑작스러운 위기(실직·질병·사고 등)가 생겼을 때 받는 지원이에요.");
  if (i.base.priority) out.notes.push("저소득층을 먼저 뽑아요 (우선 선정).");
  return out;
}

export type { Group };

/**
 * 질문 따라 찾기 (2026-10-16): 사는 곳을 확인한 뒤 한 화면에 한 질문씩.
 * 나이 → 가구원 수 → 자녀·출산 상황을 먼저 확인하고, 이후 필요한 질문만 혜택 판정 기댓값으로 고른다.
 * 판정은 결과 화면과 같은 규칙(v2.ts)을 그대로 쓰고, 이미 '해당하지 않아요'로 정해진 사업은 다음 계산에서 뺀다(소거).
 * 기본 질문은 5개까지, 나머지 조건은 결과에서 더 확인할 수 있다.
 * 답은 이 기기 안에서만 쓰고 주소에는 싣지 않는다.
 */
import type { Program } from "../data/types";
import { AGE_LABEL, CHILD_BUCKETS, EMPTY_PROFILE, INCOME_BANDS, medianWon, type ChildBucket } from "../engine/profile";
import type { FindMode } from "./mode";
import {
  DIMS, DIM_BY_ID, EMPTY_EXTRAS, answersFor, buildView, classifyBase, dimAvailable, scoreV2,
  type Answer, type Dim, type DimId, type Situation, type V2View,
} from "./v2";

/** 질문 수 (위치 확인 다음) */
export const FLOW_LIMIT = 5;
/**
 * 질문 이름 — 질문 순서는 답에 따라 사람마다 달라 '3번 질문'만으로는 같은 질문을 가리키지 못한다
 * (2026-10-16 회의: 콜센터·발표 질의응답). 화면에 '질문 3 / 5 · 소득'처럼 함께 쓴다.
 */
export const QUESTION_NAME: Record<FlowQuestionId, string> = {
  family: "자녀·출산",
  age: "나이", alone: "가구원 수", income: "소득", support: "수급", basicPension: "기초연금",
  disability: "장애", care: "돌봄", ltcGrade: "장기요양", veteran: "보훈", singleParent: "한부모",
  multicultural: "다문화", housing: "집", activity: "일", illness: "질병", children: "자녀", daycare: "어린이집",
};

/** 하나씩 묻지 않고 마지막 '해당하는 것 모두 고르기'로만 묻는 드문 사항 */
export const RARE_DIMS_FLOW: ReadonlySet<DimId> = new Set<DimId>(["veteran", "multicultural"]);

export type FlowQuestionId = DimId | "family";
type FlowDim = Omit<Dim, "id"> & { id: FlowQuestionId };

const hasChildren = (s: Situation) => s.x.family === "children" || s.x.family === "both" ||
  (s.x.childCount ?? 0) > 0 || !!s.profile.children?.some((c) => c !== "pregnant");

const familyAnswer = (s: Situation, family: NonNullable<Situation["x"]["family"]>): Situation => {
  const x = { ...s.x, family };
  // 자녀가 있다는 답만으로 자녀 수·나이를 추정하지 않는다.
  if (family === "none" || family === "expecting") x.childCount = 0;
  else delete x.childCount;
  return { ...s, x, profile: { ...s.profile, children: family === "none" ? [] : family === "expecting" ? ["pregnant"] : null } };
};

export const FLOW_DIM_BY_ID: Record<FlowQuestionId, FlowDim> = {
  ...DIM_BY_ID,
  family: {
    id: "family",
    q: () => "자녀·출산 상황은 어떤가요?",
    isUnknown: (s) => s.x.family === undefined && s.x.childCount == null && s.profile.children === null,
    answers: [
      { key: "children", label: "자녀가 있어요", apply: (s) => familyAnswer(s, "children") },
      { key: "expecting", label: "출산 예정이에요", apply: (s) => familyAnswer(s, "expecting") },
      { key: "both", label: "자녀가 있고, 출산 예정이에요", apply: (s) => familyAnswer(s, "both") },
      { key: "none", label: "둘 다 해당 없어요", apply: (s) => familyAnswer(s, "none") },
    ],
  },
};

/** 자녀 관련 세부 질문은 해당한다고 답한 뒤에만 묻는다. 건너뛰기는 부정으로 해석하지 않는다. */
function flowAvailable(d: Dim, s: Situation): boolean {
  if (!dimAvailable(d, s)) return false;
  if (d.id === "children") return hasChildren(s);
  if (d.id === "singleParent" && s.mode === "self") return hasChildren(s);
  if (d.id === "daycare") return !!s.profile.children?.some((c) => c === "0-1" || c === "2-5");
  return true;
}

export function blankSituation(sido: string, sigungu: string, mode: FindMode): Situation {
  return { profile: { ...EMPTY_PROFILE, sido, sigungu }, x: { ...EMPTY_EXTRAS, benefits: {}, traits: {}, facts: {} }, mode };
}

const withAge = (s: Situation, age: Situation["profile"]["age"]): Situation => ({ ...s, profile: { ...s.profile, age } });
const manwon = (won: number) => Math.floor(won / 10000).toLocaleString("ko-KR");

/**
 * 질문 따라 찾기에서 보여 줄 보기.
 * - 나이: 본인 찾기는 '18세 이하'도 (10대 본인이 나이에 답하지 못하던 문제 — 시뮬레이션에서 확인)
 * - 소득: 가구원 수에 맞춘 기준 중위소득 금액 구간 (구간 자체는 결과 화면 소득 질문과 같음)
 */
/** 70~74세·75~79세는 한 보기로 (넓은 구간 — 엔진 profile.ts WIDE_AGE_BANDS) */
const SEVENTIES: Answer = { key: "70-79", label: AGE_LABEL["70-79"], apply: (x: Situation) => withAge(x, "70-79") };
function mergeSeventies(list: Answer[]): Answer[] {
  const i = list.findIndex((a) => a.key === "70-74");
  if (i < 0 || !list.some((a) => a.key === "75-79")) return list;
  return [...list.slice(0, i), SEVENTIES, ...list.slice(i).filter((a) => a.key !== "70-74" && a.key !== "75-79")];
}

export function flowAnswers(d: FlowDim, s: Situation): Answer[] {
  if (d.id === "family") return d.answers;
  const base = d.id === "age" ? mergeSeventies(answersFor(DIM_BY_ID[d.id], s)) : answersFor(DIM_BY_ID[d.id], s);
  if (d.id === "age" && s.mode !== "parent") {
    return [{ key: "0-18", label: AGE_LABEL["0-18"], apply: (x: Situation) => withAge(x, "0-18") }, ...base];
  }
  if (d.id === "income") {
    const size = s.profile.householdSize;
    if (size === "unknown") return base;
    return INCOME_BANDS.map((b, i) => {
      const a = base.find((x) => x.key === b)!;
      const hi = b === "200+" ? null : medianWon(Number(b), size);
      const lo = i === 0 ? null : medianWon(Number(INCOME_BANDS[i - 1]), size);
      const label = hi === null ? `월 ${manwon(lo!)}만원 넘음` : lo === null ? `월 ${manwon(hi)}만원 이하` : `월 ${manwon(lo)}~${manwon(hi)}만원`;
      return { ...a, label };
    });
  }
  return base;
}

/** '예'가 나올 대략의 가능성 — 드문 '예'보다 흔한 '아니요'로 정해지는 혜택을 더 크게 센다 */
function yesShare(id: DimId, s: Situation): number | null {
  const parent = s.mode === "parent";
  switch (id) {
    case "disability":
      return 0.1;
    case "illness":
      return parent ? 0.3 : 0.15;
    case "care":
      return parent ? 0.4 : 0.1;
    case "ltcGrade":
      return parent ? 0.2 : 0.05;
    case "singleParent":
      return 0.1;
    case "support":
      return 0.1;
    case "basicPension":
      return 0.6;
    default:
      return null;
  }
}
const NO_KEYS = new Set(["no", "none"]);
function weights(d: Dim, answers: Answer[], s: Situation): number[] {
  const y = yesShare(d.id, s);
  const noIdx = answers.findIndex((a) => NO_KEYS.has(a.key));
  if (y === null || noIdx < 0 || answers.length < 2) return answers.map(() => 1 / answers.length);
  const each = y / (answers.length - 1);
  return answers.map((_, i) => (i === noIdx ? 1 - y : each));
}

export interface FlowStep {
  view: V2View;
  /** 다음 계산에 쓸 사업 ('해당하지 않아요'로 정해진 묶음은 뺌) */
  pool: Program[];
  counts: { fit: number; ask: number; office: number; no: number };
}

/** 판정 + 소거. prev를 주면 지금까지 '해당하지 않아요'로 정해진 수를 이어서 센다 */
export function flowStep(pool: Program[], s: Situation, prev?: FlowStep): FlowStep {
  const view = buildView(scoreV2(pool, s), s, 0);
  const gone = new Set<Program>(view.no.flatMap((g) => g.map((i) => i.s.program)));
  return {
    view,
    pool: pool.filter((p) => !gone.has(p)),
    counts: { fit: view.fit.length, ask: view.ask.length, office: view.office.length, no: (prev?.counts.no ?? 0) + view.no.length },
  };
}

/** 다음 질문: 그 답으로 '답하면 정해져요'에서 빠지는 혜택 묶음 수의 기댓값이 가장 큰 질문 */
export function nextQuestion(st: FlowStep, s: Situation, asked: readonly FlowQuestionId[]): { id: FlowQuestionId; gain: number } | null {
  // 통계상 소거 효과가 크더라도 기본 가구 정보보다 자녀·임신 질문을 먼저 내지 않는다.
  for (const id of ["age", "alone"] as const) {
    if (!asked.includes(id) && DIM_BY_ID[id].isUnknown(s)) return { id, gain: 0 };
  }
  if (!asked.includes("family") && dimAvailable(DIM_BY_ID.children, s) && FLOW_DIM_BY_ID.family.isUnknown(s))
    return { id: "family", gain: 0 };
  if (!asked.includes("children") && DIM_BY_ID.children.isUnknown(s) && flowAvailable(DIM_BY_ID.children, s))
    return { id: "children", gain: 0 };

  let best: { id: DimId; gain: number } | null = null;
  for (const d of DIMS) {
    if (asked.includes(d.id) || RARE_DIMS_FLOW.has(d.id) || !d.isUnknown(s) || !flowAvailable(d, s)) continue;
    const groups = st.view.ask.filter((g) => g.some((i) => i.dims.includes(d.id)));
    if (!groups.length) continue;
    const answers = flowAnswers(d, s);
    const w = weights(d, answers, s);
    let gain = 0;
    answers.forEach((a, k) => {
      const next = a.apply(s);
      const decided = groups.filter((g) => g.some((i) => classifyBase(i.s.program, next).base !== "open")).length;
      gain += w[k] * decided;
    });
    if (!best || gain > best.gain) best = { id: d.id, gain };
  }
  if (!best || best.gain <= 0) return null;
  // 소득 보기는 가구원 수에 맞춘 금액이라, 가구원 수를 모르면 그것부터
  if (best.id === "income" && s.profile.householdSize === "unknown" && !asked.includes("alone")) return { id: "alone", gain: best.gain };
  return best;
}

/**
 * 자녀 질문 (2026-10-16 회의): 한 화면에서 임신 여부 + 자녀 나이 모두 고르기 + 자녀 수.
 * 결과 화면의 자녀 질문(가장 어린 자녀 하나)으로는 '아이 1명 + 임신 중'을 함께 답할 수 없었다.
 * count = 태어난 자녀 수(0·1·2·3=3명 이상) — 3명 이상이면 다자녀, 2명은 사업마다 달라 모름 (v2 inferExtras 그대로)
 */
export function childrenApply(s: Situation, buckets: readonly ChildBucket[], count: 0 | 1 | 2 | 3 | null): Situation {
  const children = CHILD_BUCKETS.filter((c) => buckets.includes(c));
  return { ...s, profile: { ...s.profile, children }, x: { ...s.x, childCount: count } };
}

export interface RarePick {
  key: DimId;
  label: string;
}

const RARE_LABEL: Partial<Record<DimId, [string, string]>> = {
  disability: ["장애인으로 등록되어 있어요", "부모님 중 장애인으로 등록된 분이 있어요"],
  veteran: ["국가유공자·참전유공자 등 보훈 대상이에요", "부모님이 국가유공자·참전유공자 등 보훈 대상이에요"],
  multicultural: ["다문화 가족(결혼이민)이거나 북한이탈주민이에요", "부모님이 다문화 가족이거나 북한이탈주민이에요"],
  singleParent: ["혼자 자녀를 키워요 (한부모·조손 가구)", "부모님이 손주를 키우고 계세요 (조손 가구)"],
  illness: ["치매·암·희귀질환 등으로 치료 중이에요", "부모님 중 치매·암·희귀질환 등으로 치료 중인 분이 있어요"],
};

/** 마지막 '해당하는 것 모두 고르기' — 아직 모르는 드문 사항만 */
export function rarePicks(s: Situation): RarePick[] {
  const out: RarePick[] = [];
  for (const id of Object.keys(RARE_LABEL) as DimId[]) {
    const d = DIM_BY_ID[id];
    if (!d.isUnknown(s) || !flowAvailable(d, s)) continue;
    out.push({ key: id, label: RARE_LABEL[id]![s.mode === "parent" ? 1 : 0] });
  }
  return out;
}

/** 고른 것은 '예', 보였지만 고르지 않은 것은 '아니요' (장애는 정도를 모르므로 정도 '모름') */
export function rareApply(s: Situation, on: readonly DimId[]): Situation {
  let out = s;
  for (const { key } of rarePicks(s)) {
    const d = DIM_BY_ID[key];
    if (key === "disability") {
      out = on.includes(key)
        ? { ...out, profile: { ...out.profile, disability: "self", disabilitySeverity: "unknown" } }
        : d.answers.find((a) => a.key === "none")!.apply(out);
      continue;
    }
    out = d.answers.find((a) => a.key === (on.includes(key) ? "yes" : "no"))!.apply(out);
  }
  return out;
}

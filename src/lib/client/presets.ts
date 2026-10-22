/** 홈 화면 '예시 상황' 원클릭 프리셋 (실제 개인 정보가 아닌 데모용 가상 상황) */
import { EMPTY_PROFILE, type Profile } from "../engine/profile";
import type { FindMode } from "./mode";
import type { Extras } from "./v2";

export interface Preset {
  id: string;
  title: string;
  desc: string;
  /** v1 간편 입력 프로필 (기존 결과·비교용) */
  profile: Profile;
  /** v2 '상황 먼저' 답 — 예시가 알려 주는 것만 채우고 나머지는 모름 (소득은 원/월로) */
  x: Extras;
  /** 부모님 복지(대리 효도) 경로 — 프로필은 부모님 상황 */
  mode?: FindMode;
}

const base = (p: Partial<Profile>): Profile => ({ ...EMPTY_PROFILE, sido: "41000", ...p });
const NO_RECIPIENT = { livelihood: false, medical: false, housing: false, education: false, near_poverty: false } as const;
const NO_TRAITS = { single_parent: false, multi_child: false, multicultural: false, veteran: false } as const;

export const PRESETS: Preset[] = [
  {
    id: "suwon-senior",
    title: "수원시 1인 어르신",
    desc: "75~79세 · 혼자 거주 · 기초연금 수급 · 월 소득 약 100만원 · 일상생활 도움 필요",
    profile: base({
      sigungu: "41110", age: "75-79", householdSize: 1, traits: ["single"], children: [], income: "unknown",
      benefits: ["basic_pension"], housing: "own", car: "0", activity: "none", care: ["daily"], disability: "none",
    }),
    // 기초연금(단독 소득인정액 247만원 이하)을 받고, 자가라 수급·차상위는 아님. 장기요양등급은 모름 → 추가 질문
    x: { benefits: { ...NO_RECIPIENT, basic_pension: true }, traits: NO_TRAITS, incomeManwon: 100, facts: {}, childCount: null },
  },
  {
    id: "parent-care",
    title: "부모님 돌보기",
    desc: "50대 자녀가 수원 70대 부모님(두 분, 월 소득 약 300만원) 돌봄 · 일상 도움 필요 · 기초연금은 받는지 모름",
    mode: "parent",
    profile: base({
      sigungu: "41110", age: "70-74", householdSize: 2, traits: [], children: [], income: "100",
      benefits: [], housing: "own", car: "0", activity: "none", care: ["daily"], disability: "none",
    }),
    // 연금 등 월 300만원(2인 중위소득의 약 71%) → 수급·차상위 아님. 기초연금은 '관심'이라 모름 → 추가 질문
    x: { benefits: { ...NO_RECIPIENT }, traits: NO_TRAITS, incomeManwon: 300, facts: {}, childCount: null, spouse: true },
  },
  {
    id: "seongnam-single-parent",
    title: "성남시 한부모 가정",
    desc: "30대 · 한부모 · 2~5세 자녀 1명 · 월 소득 약 205만원(중위소득 50% 이하) · 월세",
    profile: base({
      sigungu: "41130", age: "30-34", householdSize: 2, traits: ["single_parent"], children: ["2-5"], income: "50",
      benefits: [], housing: "monthly", car: "0", activity: "employed", care: [], disability: "none",
    }),
    // 월 205만원 = 2인 중위소득의 약 49%. 수급·차상위 등록 여부는 예시가 말하지 않음 → 모름 (추가 질문)
    x: { benefits: { basic_pension: false }, traits: { ...NO_TRAITS, single_parent: true }, incomeManwon: 205, facts: {}, childCount: 1 },
  },
  {
    id: "goyang-youth",
    title: "고양시 구직 청년",
    desc: "20대 후반 · 1인 가구 · 무주택(월세) · 구직 중 · 월 소득 약 180만원",
    profile: base({
      sigungu: "41280", age: "25-29", householdSize: 1, traits: ["single"], children: [], income: "100",
      benefits: [], housing: "monthly", car: "0", activity: "job_seeking", care: [], disability: "none",
    }),
    // 월 180만원 = 1인 중위소득의 약 70% → 수급·차상위 아님
    x: { benefits: { ...NO_RECIPIENT, basic_pension: false }, traits: NO_TRAITS, incomeManwon: 180, facts: { illness: false }, childCount: 0 },
  },
  {
    id: "bucheon-disability",
    title: "부천시 장애인 가구",
    desc: "50대 부모 · 성인 자녀가 심한 장애 · 3인 가구 · 월 소득 약 400만원 · 돌봄 필요",
    profile: base({
      sigungu: "41190", age: "50-59", householdSize: 3, traits: [], children: ["19+"], income: "100",
      benefits: [], housing: "jeonse", car: "1", activity: "employed", care: ["daily"], disability: "member", disabilitySeverity: "severe",
    }),
    // 맞벌이 등 월 400만원 = 3인 중위소득의 약 75% → 수급·차상위 아님
    x: { benefits: { ...NO_RECIPIENT, basic_pension: false }, traits: NO_TRAITS, incomeManwon: 400, facts: {}, childCount: 1 },
  },
];

/** 예시 제목·설명에 들어간 원래 지역 이름 (현위치로 옮길 때 바꿔 끼움) */
const PLACE: Record<string, [string, string]> = {
  "suwon-senior": ["수원시", "수원"],
  "parent-care": ["수원시", "수원"],
  "seongnam-single-parent": ["성남시", "성남"],
  "goyang-youth": ["고양시", "고양"],
  "bucheon-disability": ["부천시", "부천"],
};

/** 현위치 예시 id: '<예시 id>@<시·군·구 코드>@<지역 이름>' (지역 이름은 화면 안내용 — 사람 정보 아님) */
export const placedId = (id: string, sigungu: string, label: string) => `${id}@${sigungu}@${label}`;

/**
 * (전국 확대 ③) 같은 예시 상황을 다른 시·군·구로 옮긴다 — 상황(나이·가구·소득 등)은 그대로, 지역만.
 * label 예: '경기 용인시', '서울 광진구'. 제목·설명의 원래 지역 이름을 바꿔 끼운다.
 */
export function presetAt(p: Preset, sido: string, sigungu: string, label: string): Preset {
  const [full, short] = PLACE[p.id] ?? ["", ""];
  const name = label.split(" ").pop() ?? label;
  return {
    ...p,
    id: placedId(p.id, sigungu, label),
    title: full && p.title.includes(full) ? p.title.replace(full, label) : `${p.title} (${label})`,
    desc: short ? p.desc.replace(short, name) : p.desc,
    profile: { ...p.profile, sido, sigungu },
  };
}

/** 저장된 예시 id → 예시 (현위치 예시면 그 지역으로 옮긴 것) */
export function presetById(id: string | null | undefined): Preset | undefined {
  if (!id) return undefined;
  const [base, sigungu, label] = id.split("@");
  const p = PRESETS.find((x) => x.id === base);
  // 저장소 값이 손상됐으면(시·군·구 코드가 아님) 원래 예시로
  if (!p || !sigungu || !label || !/^\d{5}$/.test(sigungu)) return p;
  return presetAt(p, `${sigungu.slice(0, 2)}000`, sigungu, label.slice(0, 30));
}

import type {
  Activity, Benefit, Car, CareNeed, ChildBucket, Disability, DisabilitySeverity, HouseholdTrait, Housing,
} from "./profile";

/** 3값 논리 (설계서 6.2) */
export type Tri = "T" | "F" | "U";

interface LeafBase {
  /** 사람이 읽는 조건 문구. 예: "만 65세 이상" */
  label: string;
  /**
   * soft: 원천 태그처럼 '배타적이지 않은' 신호. FALSE를 UNKNOWN으로 낮춘다 (해당 사업을 숨기지 않음).
   */
  soft?: boolean;
  /** capU: TRUE여도 UNKNOWN으로 낮춘다 (예: '임신 중'이면 출산 후 대상이 될 수 있음). */
  capU?: boolean;
}

export type Leaf =
  | (LeafBase & { field: "age"; min?: number; max?: number })
  | (LeafBase & { field: "childAge"; min?: number; max?: number })
  | (LeafBase & { field: "children"; anyOf: ChildBucket[] })
  | (LeafBase & { field: "income"; lte: number })
  /** S3 지원조건의 중위소득 구간 합집합 (예: 0~50, 51~75) */
  | (LeafBase & { field: "incomeBands"; bands: [number, number][] })
  | (LeafBase & { field: "householdSize"; min?: number; max?: number })
  | (LeafBase & { field: "trait"; anyOf: HouseholdTrait[] })
  | (LeafBase & { field: "benefit"; anyOf: Benefit[] })
  | (LeafBase & { field: "housing"; anyOf: Housing[] })
  | (LeafBase & { field: "car"; anyOf: Car[] })
  | (LeafBase & { field: "activity"; anyOf: Activity[] })
  | (LeafBase & { field: "care"; anyOf: CareNeed[] })
  | (LeafBase & { field: "disability"; anyOf: Exclude<Disability, "none">[]; severity?: DisabilitySeverity })
  /** 익명 단계에서 묻지 않는 조건 (성별, 소득하위 70%, 등급 판정 등) → 항상 UNKNOWN */
  | (LeafBase & { field: "unasked"; hint?: string })
  /** 지역 주민 누구나 (번들 선택 단계에서 거주지가 이미 맞음) → 항상 TRUE */
  | (LeafBase & { field: "resident" });

export type Cond = Leaf | { all: Cond[]; label?: string } | { any: Cond[]; label?: string };

export type ReviewStatus =
  /** 사람 검수 완료 (검수 원장에 검수자·일자 기록) */
  | "verified"
  /** 원문 근거 구절과 대조해 작성한 규칙 (1차 검수). 최종 사람 검수 대기 */
  | "curated"
  /** 공공서비스(혜택) API 구조화 지원조건 코드에서 변환 (전국·시범 지역). '조건 충족' 판정 허용 */
  | "structured"
  /** 구조화 조건·태그·문구에서 자동 변환한 초안. 판정 상한 '가능성 있음' */
  | "auto";

export type RuleOrigin = "curated" | "gov24_conditions" | "bokjiro_tags" | "text_extract" | "none";

export interface Rule {
  id: string;
  origin: RuleOrigin;
  review: ReviewStatus;
  logic: Cond | null;
  /** 구조화하지 못한 조건 문구 */
  unstructured: string[];
  /** 비정형 조건이 핵심(예: '돌봄이 필요하다고 판단되는 자') → 판정 상한 '확인 필요' */
  unstructuredCore: boolean;
  /** 규칙의 원문 근거 구절 */
  evidence?: string;
  reviewer?: string;
  reviewedAt?: string;
  /** 공공부조 관문 제도 자체 (재산·부양 조사가 따로 있음) → 조건이 맞아도 '신청할 때 확인' */
  meansTest?: boolean;
  /** 원문 대상이 수급·차상위인데 규칙은 소득 코드(0~50%)뿐 → 소득 구간만으로 '받으실 수 있어요' 금지 (refine.ts) */
  recBand?: boolean;
  /** src/lib/data/refine.ts 를 이미 적용함 (판 번호 — 예전 번들은 true) */
  refined?: boolean | number;
}

export type Tier = "eligible" | "likely" | "check" | "ineligible";

export type ReasonKind = "met" | "unmet" | "unknown" | "note";

export interface Reason {
  kind: ReasonKind;
  text: string;
  /** 판정에 쓴 입력 항목 (관련도 정렬용) */
  field?: Leaf["field"];
  /** (선택) 이 사유를 만든 잎 조건 — 쉬운 말 다시 쓰기·추가 질문 고르기용 (EvalOptions.withLeaf) */
  leaf?: Leaf;
  /** (선택) 입력값으로는 맞지 않지만 '참고(soft)' 조건이라 확인으로 낮춘 경우 */
  softNo?: boolean;
}

/**
 * 판정 선택 사항 (기본값이면 기존 판정과 같다).
 *  - facts: 간편 입력 12개 밖의 사실(예: 장기요양등급 있음)에 대한 사용자 답. 키 = FACT 패턴 id → 'unasked' 조건을 참·거짓으로
 *  - withLeaf: 사유에 잎 조건을 붙인다
 */
export interface EvalOptions {
  facts?: Record<string, boolean>;
  /** facts 키 → '묻지 않는 조건' 이름 패턴 */
  factPatterns?: Record<string, RegExp>;
  withLeaf?: boolean;
  /** 프로필 benefits 가 답해졌어도 이 항목들은 '모름' (예: 수급 아님 + 기초연금 모름) */
  unknownBenefits?: Benefit[];
  /** 프로필 traits 가 답해졌어도 이 항목들은 '모름' */
  unknownTraits?: HouseholdTrait[];
  /** soft 조건도 FALSE 그대로 (v2: 답한 사실과 맞지 않는 사업을 본문에서 뺄 때) */
  strictSoft?: boolean;
  /** 월 소득(원)·가구원 수로 계산한 기준 중위소득 대비 % (구간 대신 정확한 값으로 소득 조건 비교) */
  incomePct?: number;
}

export interface Evaluation {
  tier: Tier;
  reasons: Reason[];
  /** 카드에 보여줄 한 줄 근거 */
  headline: string;
}

export const TIER_LABEL: Record<Tier, string> = {
  eligible: "조건 충족",
  likely: "가능성 있음",
  check: "확인 필요",
  ineligible: "조건 불일치",
};

/**
 * 찾기 대상 모드: 본인(self) vs 부모님(parent, "대리 효도").
 * 프로필 필드는 동일 — parent 모드에서는 입력·결과 문구만 부모님 기준으로 바꾸고,
 * 매칭 엔진에는 부모님 상황을 그대로 넣는다.
 */
import { ageRange, type Profile } from "../engine/profile";
import {
  ACTIVITY_LABEL, AGE_LABEL, BENEFIT_LABEL, CARE_LABEL, DISABILITY_LABEL, HOUSING_LABEL,
  type Activity, type AgeBand, type Benefit, type CareNeed, type Disability, type Housing,
} from "../engine/profile";

export type FindMode = "self" | "parent";

export function parseFindMode(v: string | null | undefined): FindMode | null {
  if (v === "parent" || v === "self") return v;
  return null;
}

/** 작성자(자녀 등) — 카피용, 매칭에 쓰지 않음 */
export type FillerRole = "child" | "relative" | "other";

export const FILLER_LABEL: Record<FillerRole, string> = {
  child: "자녀",
  relative: "가족·친척",
  other: "그 외 (지인·돌봄 등)",
};

/**
 * 조부모님·어르신 가족 (2026-10-21 인터뷰: 어머니가 100세 넘은 할머니를 모심) — 판정은 부모님 찾기와 같고 문구만 바꾼다.
 * '부모님께'·'부모님이' 처럼 붙은 말도 그대로 '어르신께'·'어르신이'.
 */
export const elderText = (t: string) => t.replace(/부모님/g, "어르신");

export function isParentMode(mode: FindMode | null | undefined): boolean {
  return mode === "parent";
}

/** 홈·빈 결과 진입 CTA */
export const MODE_ENTRY = {
  self: {
    title: "내 복지 찾기",
    desc: "내 나이·가구·소득으로 받을 수 있는 혜택",
    href: "/situation?for=self",
    testId: "start-self",
  },
  parent: {
    title: "부모님 복지 찾기",
    desc: "부모님이 받을 수 있는 정부·지자체 지원을 대신 알아보기",
    href: "/situation?for=parent",
    testId: "start-parent",
  },
} as const;

/**
 * 홈의 찾는 방법 두 갈래 (2026-10-16). '누구를 위해'(나/부모님)는 각 방법 안에서 정한다:
 * 말로 찾기는 문장에서('어머니', '부모님'), 질문 따라 찾기는 첫 질문에서.
 */
export const METHOD_ENTRY = {
  talk: {
    title: "말로 찾기",
    desc: "상황을 말하면 바로 찾아요. 나·부모님 모두",
    example: "예: 수원에 사시는 75세 어머니, 혼자 사세요",
    meta: "말한 내용으로 먼저 찾고, 필요하면 더 자세히",
    href: "/situation",
    testId: "start-talk",
  },
  guided: {
    title: "골라서 찾기",
    desc: "한 화면에 한 질문, 버튼만 누르면 돼요. 사는 곳은 현재 위치로 확인해요",
    example: "누구의 복지를 찾으세요? 나 / 부모님",
    meta: "질문 5개 안팎 · 나·부모님 모두",
    href: "/ask",
    testId: "start-guided",
  },
} as const;

/** 상황 입력 화면 (기본: '상황 먼저' 한 화면 입력) */
export function checkPath(mode: FindMode): string {
  return mode === "parent" ? "/situation?for=parent&details=1" : "/situation?for=self&details=1";
}

/** 예전 단계별 입력·결과(v1)를 비교용으로 열 때 붙이는 숨은 표시 */
export function withV1(path: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}v=1`;
}

export function resultsPath(mode: FindMode, exampleId?: string): string {
  const q = new URLSearchParams();
  if (mode === "parent") q.set("for", "parent");
  if (exampleId) q.set("example", exampleId);
  const s = q.toString();
  return s ? `/results?${s}` : "/results";
}

/** 입력 마법사 단계·질문 문구 */
export function wizardCopy(mode: FindMode) {
  if (mode === "parent") {
    return {
      pageTitle: "부모님 복지 찾기",
      crumb: "부모님 복지",
      progressHint: "부모님 기준으로 12개 중",
      banner:
        "자녀·가족이 부모님 상황을 대신 입력하고 있어요. 판정은 부모님 조건을 기준으로 합니다. 입력값은 이 기기에만 저장됩니다.",
      steps: ["사는 곳", "부모님과 가구", "자녀(손자녀)", "소득·주거", "활동·돌봄·장애"] as const,
      questions: [
        "부모님은 어디에 사시나요?",
        "부모님과 함께 사는 가구를 알려 주세요",
        "부모님 가구에 자녀(손자녀)가 있나요?",
        "부모님 가구의 소득과 주거는 어떤가요?",
        "부모님의 활동과 돌봄이 필요한 상황",
      ] as const,
      regionBody:
        "부모님의 주민등록상 주소지를 골라 주세요. 그 지역에서만 하는 서비스와 신청하는 곳을 알려 드리는 데 씁니다.",
      ageLegend: "부모님 나이",
      hhLegend: "함께 사는 가구원 수 (부모님 포함)",
      traitsLegend: "가구 특성",
      childrenLegend: "자녀·손자녀(또는 임신) 나이대",
      childrenHint: "부모님과 함께 사는 자녀·손자녀가 있으면 모두 골라 주세요.",
      childrenNone: "해당 없음",
      incomeLegend: "가구 소득 (기준 중위소득 대비)",
      incomeHint: "정확히 몰라도 괜찮아요. 수급 중이면 아래 ‘수급·자격’만 골라도 돼요.",
      benefitsLegend: "받고 있는 수급·자격",
      housingLegend: "주거 형태",
      carLegend: "가구 차량",
      activityLegend: "취업·활동 상태",
      careLegend: "돌봄이 필요한 상황",
      disabilityLegend: "장애",
      severityLegend: "장애 정도",
      disabilityLabels: {
        self: "부모님 본인",
        member: "부모님 가구원 중 있음",
        none: "해당 없음",
      } as Record<Disability, string>,
      finishEarly: "지금까지 입력으로 결과 보기",
      finish: "부모님 복지 결과 보기",
    };
  }
  return {
    pageTitle: "맞춤 찾기",
    crumb: "맞춤 찾기",
    progressHint: "12개 중",
    banner: null as string | null,
    steps: ["사는 곳", "나와 가구", "자녀", "소득·주거", "활동·돌봄·장애"] as const,
    questions: [
      "어디에 사시나요?",
      "나와 함께 사는 가구에 대해 알려 주세요",
      "자녀가 있나요?",
      "소득과 주거 형편은 어떤가요?",
      "지금 하시는 일과 돌봄이 필요한 상황",
    ] as const,
    regionBody:
      "주민등록상 주소지를 골라 주세요. 그 지역에서만 하는 서비스와 신청하는 곳을 알려 드리는 데 씁니다.",
    ageLegend: "본인 나이",
    hhLegend: "함께 사는 가구원 수 (본인 포함)",
    traitsLegend: "가구 특성",
    childrenLegend: "자녀(또는 임신) 나이대",
    childrenHint: "가구 안에 자녀가 있으면 모두 골라 주세요.",
    childrenNone: "자녀 없음",
    incomeLegend: "가구 소득 (기준 중위소득 대비)",
    incomeHint: "정확히 몰라도 괜찮아요. 수급 중이면 아래 ‘수급·자격’만 골라도 돼요.",
    benefitsLegend: "받고 있는 수급·자격",
    housingLegend: "주거 형태",
    carLegend: "가구 차량",
    activityLegend: "취업·활동 상태",
    careLegend: "돌봄이 필요한 상황",
    disabilityLegend: "장애",
    severityLegend: "장애 정도",
    disabilityLabels: DISABILITY_LABEL,
    finishEarly: "지금까지 입력으로 결과 보기",
    finish: "결과 보기",
  };
}

/** 결과 화면 문구 */
export function resultsCopy(mode: FindMode) {
  if (mode === "parent") {
    return {
      crumbCheck: "부모님 복지",
      checkHref: "/situation?for=parent",
      h1Suffix: "에서 부모님께 신청해 드릴 수 있는 복지",
      situationPrefix: "부모님 상황",
      editLabel: "부모님 정보 수정",
      reenterLabel: "부모님 상황으로 다시 입력",
      emptyTitle: "아직 부모님 정보가 없어요",
      emptyLead:
        "부모님 나이·사는 곳·돌봄·장애 등을 알려 주시면, 정부·지자체에서 받으실 수 있는 지원을 대신 찾아 드려요.",
      emptySelf: "내 복지 찾기",
      emptyParent: "부모님 복지 찾기",
      picksTitle: (n: number) => `부모님께 먼저 신청해 드릴 서비스 ${n}가지`,
      picksLead: "부모님 상황과 가장 관련 깊은 순서입니다. 직접 신청해야 받을 수 있는 혜택 위주예요.",
      listTitle: (hasPicks: boolean) => (hasPicks ? "그 밖에 신청해 드릴 수 있는 서비스" : "신청해 드릴 수 있는 서비스"),
      listLead: (n: string) => `모두 ${n}개를 판단 결과에 따라 나누었습니다.`,
      sparseWarn: "입력한 항목이 적어 ‘확인 필요’가 많습니다. 부모님 정보를 더 입력하면 더 정확해집니다.",
      proxyNote:
        "많은 복지 서비스는 주민센터(행정복지센터) 방문 시 가족이 서류를 대신 제출할 수 있는 경우가 많습니다. 대리 신청 가능 여부·필요 서류(가족관계증명서·위임장 등)는 서비스와 기관마다 다르니, 신청 전에 해당 주민센터나 보건복지상담센터(☎129)에 확인해 주세요. 이 안내는 일반적인 참고이며 법률 자문이 아닙니다.",
      shareLead: (place: string, e: number, l: number, c: number) =>
        `복지나침반에서 ${place} 기준(부모님)으로 찾아본 결과: 조건 충족 ${e}개, 가능성 있음 ${l}개, 확인 필요 ${c}개`,
    };
  }
  return {
    crumbCheck: "맞춤 찾기",
    checkHref: "/situation?for=self",
    h1Suffix: "에서 신청할 수 있는 복지 서비스",
    situationPrefix: null as string | null,
    editLabel: "입력 수정",
    reenterLabel: "내 상황으로 다시 입력",
    emptyTitle: "아직 입력한 정보가 없어요",
    emptyLead: "사는 곳과 몇 가지 상황만 알려주시면 받을 수 있는 혜택을 골라 드려요. 로그인은 필요 없어요.",
    emptySelf: "내 복지 찾기",
    emptyParent: "부모님 복지 찾기",
    picksTitle: (n: number) => `먼저 확인할 서비스 ${n}가지`,
    picksLead: "내 상황과 가장 관련 깊은 순서입니다. 모두 직접 신청해야 받을 수 있어요.",
    listTitle: (hasPicks: boolean) => (hasPicks ? "그 밖에 신청할 수 있는 서비스" : "신청할 수 있는 서비스"),
    listLead: (n: string) => `모두 ${n}개를 판단 결과에 따라 나누었습니다.`,
    sparseWarn: "입력한 항목이 적어 ‘확인 필요’가 많습니다. 항목을 더 입력하면 더 정확해집니다.",
    proxyNote: null as string | null,
    shareLead: (place: string, e: number, l: number, c: number) =>
      `복지나침반에서 ${place} 기준으로 찾아본 결과: 조건 충족 ${e}개, 가능성 있음 ${l}개, 확인 필요 ${c}개`,
  };
}

/** 라벨 재사용 (테스트·요약용) */
export const PARENT_AGE = AGE_LABEL;
export const PARENT_ACTIVITY = ACTIVITY_LABEL;
export const PARENT_BENEFIT = BENEFIT_LABEL;
export const PARENT_CARE = CARE_LABEL;
export const PARENT_HOUSING = HOUSING_LABEL;
export type { Activity, AgeBand, Benefit, CareNeed, Housing };

/** 가구원 수 선택지 이름 (부모님 모드: 1명 '혼자 사심', 2명 '부부 두 분 등') */
export function householdLabel(mode: FindMode, n: number): string {
  if (n === 6) return "6명 이상";
  if (mode === "parent" && n === 1) return "1명 (혼자 사심)";
  if (mode === "parent" && n === 2) return "2명 (부부 두 분 등)";
  return `${n}명`;
}

/**
 * 부모님 두 분(2인 가구, 60세 이상) 안내: 결과는 입력한 한 분 기준이고, 기초연금은 한 분씩 판정·부부 감액.
 * 근거: 기초연금법 제8조 제1항 (본인과 배우자가 모두 수급권자이면 각각 100분의 20 감액) — 국가법령정보센터 2026-10-07 확인
 */
export function coupleNote(mode: FindMode, p: Pick<Profile, "householdSize" | "age">): string | null {
  if (mode !== "parent" || p.householdSize !== 2 || p.age === "unknown") return null;
  if (ageRange(p.age)[0] < 60) return null;
  return "결과는 입력한 한 분의 나이 기준이에요. 두 분 나이가 다르면 다른 한 분도 따로 확인해 보세요. 기초연금은 한 분씩 각각 신청·판정하며, 두 분 모두 받으시면 각각 20%가 감액돼요(기초연금법 제8조, 부부 감액).";
}

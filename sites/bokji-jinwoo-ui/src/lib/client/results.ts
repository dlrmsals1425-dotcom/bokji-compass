/** 판정 결과 계산·관련도 정렬·묶음·필터 (순수 함수 — 단위 테스트 대상) */
import { evaluateRule } from "../engine/evaluate";
import { ageRange, type Profile } from "../engine/profile";
import type { Evaluation, Reason, Tier } from "../engine/types";
import { isAutoLike, type Category, type OrgType, type Program } from "../data/types";
import { queryTokens, tokenHit } from "./query";

export interface Scored {
  program: Program;
  ev: Evaluation;
  met: number;
  /** 관련도 점수 (높을수록 먼저) */
  score: number;
  /** 지역 변형 묶음 키 (같은 이름의 시도·시군구·구 사업을 한 카드로) */
  group: string;
  /** 내 특별한 상황(구직·청년·장애·한부모·수급 등)을 콕 집어 맞은 사업인지 — 추천 5개 자격 */
  specific?: boolean;
}

/* ---------------- 관련도 ---------------- */

/** 맞은 조건의 무게: 내 상황을 구체적으로 가리키는 조건일수록 크게 */
const FIELD_WEIGHT: Record<string, number> = {
  benefit: 4, care: 4, disability: 4, trait: 3, children: 3, childAge: 3, activity: 3,
  housing: 2, income: 2, incomeBands: 2, age: 1.5, householdSize: 1, car: 0.5, resident: 0,
};
const REVIEW_BONUS = { verified: 3, curated: 3, structured: 2, auto: 0 } as const;
const SCOPE_BONUS = { sigungu: 1, sido: 0.5, national: 0.5 } as const;

/** 이름·대상 문구가 가리키는 집단과 내 상황의 일치도 (규칙이 잡지 못한 대상 집단 보정) */
export function affinity(p: Program, pr: Profile): number {
  const text = `${p.name} ${(p.target ?? "").slice(0, 80)}`;
  const name = p.name;
  const age = pr.age === "unknown" ? null : ageRange(pr.age);
  const kids = pr.children;
  const hasKid = (b: string[]) => !!kids?.some((k) => b.includes(k));
  let s = 0;
  const rule = (re: RegExp, on: boolean | null, plus: number, minus: number, src = name) => {
    if (!re.test(src)) return;
    if (on === true) s += plus;
    else if (on === false) s -= minus;
  };
  // 나이 범위(예: 나이 모름 → 19세 이상)가 청년 구간에 걸치기만 하면 판단하지 않음
  rule(/청년/, age ? (age[0] >= 19 && age[1] <= 39 ? true : age[1] < 19 || age[0] > 39 ? false : null) : null, 2, 4);
  rule(/(노인|어르신|경로|노년|치매|장수|효도|실버|65세)/, age ? (age[0] >= 65 ? true : age[1] < 60 ? false : null) : null, 2, 4);
  rule(/(임신|임산부|산모|산후|출산|난임|신생아|태아)/, kids === null ? null : hasKid(["pregnant", "0-1"]), 2, 3);
  rule(/(영유아|유아|어린이집|보육|아이돌봄|육아|양육|아동)/, kids === null ? null : hasKid(["0-1", "2-5", "6-12"]) || (age ? age[1] <= 18 : false), 2, 3);
  rule(/(청소년|중학|고등학|학생|장학|수학여행|입학|교복)/, kids === null && pr.activity === "unknown" ? null : hasKid(["6-12", "13-18"]) || pr.activity === "student" || (age ? age[1] <= 24 : false), 1.5, 2.5);
  rule(/장애/, pr.disability === "unknown" ? null : pr.disability !== "none", 3, 4, text);
  // 장애 여부를 '모름'으로 두면 장애인 전용 사업은 목록에 남기되 뒤로 (위에 올라오지 않게)
  if (pr.disability === "unknown" && /장애/.test(name)) s -= 3;
  rule(/(한부모|조손|미혼모|미혼부)/, pr.traits === null ? null : pr.traits.includes("single_parent"), 3, 4, text);
  rule(/(다문화|북한이탈|새터민|결혼이민)/, pr.traits === null ? null : pr.traits.includes("multicultural"), 3, 4, text);
  rule(/(보훈|참전|국가유공|독립유공|고엽제|제대군인|무공수훈)/, pr.traits === null ? null : pr.traits.includes("veteran"), 3, 4, text);
  rule(/(다자녀|셋째|넷째)/, pr.traits === null ? null : pr.traits.includes("multi_child"), 2, 3);
  rule(/(구직|취업|일자리|면접|직업훈련|취창업|구인)/, pr.activity === "unknown" ? null : pr.activity === "job_seeking" ? true : null, 2.5, 0);
  rule(/(월세|전세|임차|주거비|임대)/, pr.housing === "unknown" ? null : ["monthly", "jeonse", "public_rental"].includes(pr.housing) ? true : pr.housing === "own" ? false : null, 2, 1.5);
  rule(/(돌봄|간병|요양|방문|가사|식사|도시락|안부|병원동행|이동지원)/, pr.care === null ? null : pr.care.length > 0 ? true : null, 2, 0);
  rule(/(1인\s*가구|독거|고독사|홀몸)/, pr.householdSize === 1 || pr.traits?.includes("single") ? true : pr.householdSize === "unknown" ? null : false, 2, 2);
  const low = pr.benefits?.length || (pr.income !== "unknown" && Number(pr.income) <= 50);
  rule(/(저소득|기초생활|수급자|차상위|취약계층)/, low ? true : pr.benefits?.length === 0 && pr.income !== "unknown" && Number(pr.income) >= 100 ? false : null, 1.5, 1);
  rule(/(장병|군인|예비군|전역|입영)/, age ? (age[0] <= 29 ? null : false) : null, 0, 3);
  // 간편 입력으로 묻지 않는 특정 신분 대상 (산재·피해자·자립준비청년 등) → 뒤로
  if (/(산재|피해자|피해\s*지원|유족|귀환|귀국|난민|노숙|출소|보호관찰|가정폭력|성폭력|학대|자립준비|보호종료|위기청소년|이주배경|외국인|탈북)/.test(name)) s -= 3;
  // 법률·행정 절차 등 생활 지원과 거리가 먼 틈새 서비스 → 약간 뒤로
  // 간편 입력에 없는 직업 신분 (농어업인 등) → 뒤로 (농림 생산 지원은 이미 기본 숨김)
  if (/(농업인|어업인|농어업인|임업인|농가|어가|해녀)/.test(name)) s -= 3;
  // 장애 유형을 묻지 않으므로 특정 유형 대상은 약간 뒤로
  if (/(발달장애|시각장애|청각장애|지체장애|뇌병변|정신장애|자폐)/.test(name) && pr.disability !== "none") s -= 1.5;
  if (/(소송|구술심리|법률|변호|심판|공증|우편물|통역센터|민원)/.test(name)) s -= 2;
  return s;
}

/** 내 상황을 특정하는 항목 (이 항목으로 맞은 사업이 '나를 위한' 사업) */
const SALIENT = new Set(["benefit", "care", "disability", "trait", "children", "childAge", "housing"]);

/** 사용자가 특별한 상황(수급·돌봄·장애·가구 특성·자녀·구직·고령)을 입력했는지 */
function hasSalient(pr: Profile): boolean {
  return !!(pr.benefits?.length || pr.care?.length || (pr.disability !== "unknown" && pr.disability !== "none") || pr.traits?.length ||
    pr.children?.some((c) => c !== "19+") || pr.activity === "job_seeking" || (pr.age !== "unknown" && ageRange(pr.age)[0] >= 65));
}

/**
 * 추천 5개 자격: 넓은 조건(나이·근로 상태·거주)만 맞은 사업이 아니라 내 특별한 상황을 콕 집은 사업인지.
 *  - 상황 항목(수급·돌봄·장애·가구 특성·자녀·주거)으로 맞았거나, 65세 이상이 나이로 맞았거나, 장애 가구원 대리 신청
 *  - 또는 이름·대상 문구 앞부분이 내 집단(청년·구직자·어르신·장애인·한부모·아동·저소득·1인 가구·월세·돌봄 등)을 직접 가리킴
 * 예) 청년 구직자에게 '구직자 취업지원 서비스'(대상: 구직자)는 해당, '산림보호지원단 일자리'(대상: 만 18세 이상)는 해당 없음
 */
export function specificMatch(p: Program, ev: Evaluation, pr: Profile): boolean {
  if (!hasSalient(pr)) return true;
  const met = ev.reasons.filter((r) => r.kind === "met");
  const age = pr.age === "unknown" ? null : ageRange(pr.age);
  const senior = !!age && age[0] >= 65;
  if (met.some((r) => SALIENT.has(r.field ?? "") || (senior && r.field === "age"))) return true;
  // 장애가 있는 가구원(member)이 있을 때만: '장애인 본인' 대상 사업을 가구원 이름으로 신청 가능 (모름이면 해당 없음)
  if (pr.disability === "member" && ev.reasons.some((r) => r.kind === "unknown" && r.field === "disability")) return true;
  const text = `${p.name} ${(p.target ?? "").slice(0, 80)}`;
  const kids = pr.children ?? [];
  const groups: [boolean, RegExp][] = [
    [!!age && age[0] >= 19 && age[1] <= 39, /청년/],
    [pr.activity === "job_seeking", /(구직|미취업|실업)/],
    [senior, /(노인|어르신|65세|고령)/],
    [pr.disability !== "unknown" && pr.disability !== "none", /장애/],
    [!!pr.traits?.includes("single_parent"), /(한부모|조손|미혼모|미혼부)/],
    [!!pr.traits?.includes("multicultural"), /(다문화|결혼이민)/],
    [!!pr.traits?.includes("veteran"), /(보훈|국가유공|참전)/],
    [!!pr.traits?.includes("multi_child"), /(다자녀|셋째)/],
    [kids.some((k) => k !== "19+"), /(아동|영유아|유아|자녀|양육|출산|임신|임산부)/],
    [!!pr.benefits?.length || (pr.income !== "unknown" && Number(pr.income) <= 50), /(저소득|수급|차상위|취약계층)/],
    [pr.householdSize === 1 || !!pr.traits?.includes("single"), /(1인\s*가구|독거|홀몸)/],
    [["monthly", "jeonse", "public_rental"].includes(pr.housing), /(월세|전세|임차|주거비)/],
    [!!pr.care?.length, /(돌봄|간병|요양)/],
  ];
  return groups.some(([on, re]) => on && re.test(text));
}

export function relevance(p: Program, ev: Evaluation, pr: Profile): number {
  const met = ev.reasons.filter((r) => r.kind === "met");
  const metW = met.reduce((n, r) => n + (FIELD_WEIGHT[r.field ?? ""] ?? 1), 0);
  const aff = affinity(p, pr);
  // '장애인 본인' 대상인데 장애가 있는 가구원이 있는 경우: 가구원 이름으로 신청 가능 → 부분 일치로 가산
  const proxy = pr.disability === "member" && ev.reasons.some((r) => r.kind === "unknown" && r.field === "disability") ? 3 : 0;
  // 나이·근로 상태처럼 넓은 조건만 맞고 내 특별한 상황과는 무관한 사업은 뒤로 (예: 장애인 가구에 '건설노동자 휴양소')
  const senior = pr.age !== "unknown" && ageRange(pr.age)[0] >= 65;
  const generic = hasSalient(pr) && !proxy && !met.some((r) => SALIENT.has(r.field ?? "") || (senior && r.field === "age")) && aff <= 0 && !(pr.activity === "job_seeking" && met.some((r) => r.field === "activity")) ? -3 : 0;
  const unknown = Math.min(4, ev.reasons.filter((r) => r.kind === "unknown").length);
  const actionable = p.hasApply || p.applyMethod || p.contact ? 0.5 : 0;
  // 대출·융자·보증은 받는 혜택이 아니라 빌리는 돈 → 같은 조건이면 뒤로
  const loan = p.badges?.includes("financial") ? -1.5 : 0;
  // 핵심 복지 100선에 든 사업, 여러 원천에 함께 실린 사업은 대표성이 높다
  const core = (p.sources.some((s) => s.source === "welfare100") ? 2 : 0) + ((p.mergedCount ?? 1) > 1 ? 0.5 : 0);
  return metW - unknown * 0.5 + REVIEW_BONUS[p.rule.review] + SCOPE_BONUS[p.scope] + aff + proxy + generic + actionable + core + loan;
}

/* ---------------- 지역 변형 묶음 ---------------- */

const REGION_HEAD = /^(?:(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)(?:특별시|광역시|특별자치시|특별자치도|도)?|[가-힣]{1,4}(?:특례시|시|군|구))\s+/;

/** 같은 사업의 지역 변형(경기도 ○○ / 수원시 ○○ / (장안구) ○○)을 한데 묶는 키 */
/**
 * 출처마다 이름이 조금 다른 같은 제도 (QA 8차: 복지로·백과의 '노인장기요양보험'과 정부24의 '노인장기요양보험(장기요양인정)'이 따로 나옴).
 * 괄호 안을 모두 지우면 다른 사업이 묶이므로(예: '건강백세운동교실(건보)') 확인한 것만 적는다.
 * (2026-10-16 소유자: '보육료 지원'·'영유아보육료 지원'이 두 카드) 전국 데이터에서 대상·담당 기관·내용을 원문으로 맞춰 본 것만 —
 * 같은 이름 아래 따로 신청하는 세부 항목(의료급여 요양비, 긴급복지 생계지원 등)은 넣지 않는다.
 */
const SAME_SETS: string[][] = [
  ["노인장기요양보험", "노인장기요양보험(장기요양인정)"],
  ["보육료 지원", "영유아보육료 지원"],
  ["그 밖의 연장형 보육료 지원", "그 밖의 연장형 보육료 등 지원"],
  ["유아학비 (누리과정) 지원", "유아학비 지원(3~5세 누리과정 지원)"],
  ["생계급여", "국민기초생활보장 생계급여", "생계급여(맞춤형 급여)"],
  ["주거급여", "주거급여 (맞춤형 급여)"],
  ["교육급여", "교육급여(맞춤형 급여)"],
  ["의료급여", "의료급여 (의료급여)"],
  ["자활근로", "자활근로(기초, 차상위)"],
  ["자립준비청년 자립수당", "자립준비청년(보호종료아동) 자립수당 지급", "자립준비청년 자립수당 지급"],
  ["통합문화이용권(문화누리카드)", "통합문화이용권(문화누리카드) 서비스", "통합문화이용권"],
  ["매입임대주택", "기존주택 매입임대주택 지원사업", "기존주택등 매입임대주택 지원사업"],
  ["북향민 정착금 지원", "(북한이탈주민)정착금 지원"],
  ["북한이탈주민 자산형성 지원 (미래행복통장)", "북한이탈주민 자산형성지원제도(미래행복통장)"],
  ["건강보험 임신·출산 진료비 지원", "건강보험 임신출산 진료비(국민행복카드)"],
  ["실종아동 보호 및 지원", "실종아동 등 보호 및 지원"],
  ["예술활동준비금 지원", "예술활동준비금 지원 사업(舊 창작준비금 지원 사업)"],
  ["산림복지서비스이용권", "산림복지서비스이용권(바우처) 지급"],
  ["사회보험사각지대해소", "사회보험사각지대해소 사업(두루누리 사회보험료 지원사업)"],
  ["디지털미디어 피해 청소년 회복 지원", "디지털미디어 피해 청소년 회복 지원 사업(청소년 인터넷·스마트폰 과의존 치료비 지원)"],
  ["기부식품 등 제공사업(푸드뱅크)", "기부식품등 제공사업(푸드뱅크·푸드마켓)"],
  ["희망복지지원단 통합사례관리", "통합사례관리(희망복지지원단)"],
  ["법률구조", "법률구조 제도"],
  ["무료법률상담", "무료 법률상담 서비스(국민)"],
  ["발달장애인 주간활동서비스", "성인 발달장애인 주간활동서비스"],
  ["독거노인·장애인 응급안전안심서비스", "응급안전안심서비스"],
  ["차상위 본인부담 경감대상자 지원", "차상위 본인부담경감"],
  ["보건소 방문건강관리 서비스", "방문건강관리"],
  ["의료급여본인부담면제", "의료급여 본인부담 면제(외래)"],
  ["중증장애인직업재활지원", "중증장애인직업재활 지원(훈련수당)"],
  ["경남동행론", "경남동행론(직접대출)"],
  ["희망저축계좌(Ⅰ·Ⅱ)", "자산형성지원사업(희망저축계좌Ⅰ, Ⅱ)"],
];
const SAME_PROGRAM: Record<string, string> = Object.fromEntries(SAME_SETS.flatMap(([head, ...rest]) => rest.map((n) => [n, head])));
const SAME_PROGRAM_NAMES: ReadonlySet<string> = new Set(SAME_SETS.flat());
/** 원문을 대조한 전국 사업 이름에만 별칭 판정 우선순위를 적용한다. */
export const isSameProgram = (p: Program): boolean => p.scope === "national" && SAME_PROGRAM_NAMES.has(p.name.trim());

export function variantKey(name: string): string {
  let s = (SAME_PROGRAM[name.trim()] ?? name).normalize("NFC");
  s = s.replace(/[(（[]\s*[가-힣\s]*(?:특례시|시|군|구|도|본청)\s*[)）\]]/g, " ");
  for (let i = 0; i < 3; i++) s = s.trimStart().replace(REGION_HEAD, "");
  s = s.replace(/[^0-9A-Za-z가-힣()]/g, "").toLowerCase();
  for (let i = 0; i < 3; i++) s = s.replace(/(지원사업|사업|서비스|지원|지급|운영)$/u, "");
  return s || name;
}

/**
 * 사업 '계열' 키: 지역 변형 키에서 괄호 내용과 일반어(원스톱·종합·지원·서비스·사업·제공·프로그램·운영)를 뺀 핵심 이름.
 * 예) 양육비 이행 원스톱 종합서비스 / 양육비 이행 지원 서비스 → 양육비이행
 */
export function familyKey(name: string): string {
  const k = variantKey(name)
    .replace(/\([^)]*\)/g, "")
    .replace(/(원스톱|종합|지원|서비스|사업|제공|프로그램|운영|및|등)/g, "");
  return k || variantKey(name);
}
/** 같은 계열인지: 핵심 이름이 같을 때만 (앞부분만 같은 '구직자 취업지원'·'구직자 취업역량강화'는 다른 사업으로 본다) */
export function sameFamily(a: string, b: string): boolean {
  return a === b;
}

/* ---------------- 판정 보정 ---------------- */

/** 원문이 저소득·수급·차상위를 대상으로 한다고 적은 사업 (예: '저소득층 백내장 수술비') */
const LOW_INCOME_TARGET = /(저소득|기초생활\s*수급|수급자|수급권자|차상위|의료급여|취약계층)/;
const LOW_INCOME_EXCLUDED = /(수급자|차상위|의료급여)[^.。\n]{0,8}(은|는)?\s*제외/;
const isLowIncomeProfile = (pr: Profile) => !!pr.benefits?.length || (pr.income !== "unknown" && Number(pr.income) <= 50);

/**
 * 규칙 판정 뒤 보정 (화면 어디서나 같은 판정을 쓰도록 결과·검색·상세가 모두 이 함수를 쓴다).
 *  - 나이만 맞아 '조건 충족'이 됐지만 원문은 저소득·수급·차상위 대상인 사업 → '가능성 있음' + '소득 확인' 사유
 */
export function adjustEvaluation(p: Program, ev: Evaluation, pr: Profile): Evaluation {
  if (ev.tier !== "eligible") return ev;
  const text = `${p.name} ${p.summary ?? ""} ${(p.target ?? "").slice(0, 300)}`;
  if (!LOW_INCOME_TARGET.test(text) || LOW_INCOME_EXCLUDED.test(text)) return ev;
  const incomeMet = ev.reasons.some((r) => r.kind === "met" && (r.field === "benefit" || r.field === "income" || r.field === "incomeBands"));
  if (incomeMet || isLowIncomeProfile(pr)) return ev;
  const reason: Reason = { kind: "unknown", field: "income", text: "소득 확인 — 원문에 저소득·수급·차상위 대상(또는 일부 지원이 저소득층 한정)이라고 되어 있어요. 소득·수급 상태를 확인하세요." };
  const met = ev.reasons.filter((r) => r.kind === "met").slice(0, 2).map((r) => `✓ ${r.text}`);
  return { ...ev, tier: "likely", reasons: [...ev.reasons, reason], headline: [...met, "? 소득 확인"].join("  ") };
}

/** 결과·검색·상세 공통 판정 */
export function evaluateProgram(p: Program, pr: Profile): Evaluation {
  return adjustEvaluation(p, evaluateRule(p.rule, pr), pr);
}

/**
 * 만 65세가 되면 생기는 핵심 혜택 (나이가 맞으면 위로).
 * ID를 박아 두지 않고 이름 규칙으로 찾는다 — 규칙마다 '전국 사업 중 관련도가 가장 높은 하나'에만 가산점.
 */
export const SENIOR_CORE: { key: string; re: RegExp }[] = [
  { key: "기초연금", re: /^기초연금$|^기초연금\s*(지급|신청)?$/ },
  { key: "독감", re: /(인플루엔자|독감).*(예방접종|접종)/ },
  { key: "폐렴구균", re: /폐렴구균/ },
  { key: "대상포진", re: /대상포진/ },
  { key: "치매검진", re: /치매.*검진|치매\s*조기\s*검진/ },
  { key: "노인일자리", re: /노인\s*일자리/ },
  { key: "노인맞춤돌봄", re: /노인\s*맞춤\s*돌봄/ },
  { key: "장기요양", re: /^노인\s*장기요양\s*보험$|장기요양\s*(등급|인정)/ },
  { key: "틀니·임플란트", re: /(틀니|임플란트)/ },
];
const SENIOR_CORE_BONUS = 4;

function seniorCoreBoost(out: Scored[], pr: Profile) {
  if (pr.age === "unknown" || ageRange(pr.age)[0] < 65) return;
  for (const { re } of SENIOR_CORE) {
    const cands = out.filter((s) => s.ev.tier !== "ineligible" && re.test(s.program.name) && !s.program.badges?.includes("financial"));
    if (!cands.length) continue;
    // 전국 사업을 먼저 (없으면 지역 사업), 그 안에서 관련도가 가장 높은 것 하나
    const pool = cands.some((s) => s.program.scope === "national") ? cands.filter((s) => s.program.scope === "national") : cands;
    const best = pool.reduce((a, b) => (b.score > a.score ? b : a));
    best.score += SENIOR_CORE_BONUS;
    best.specific = true;
  }
}

/** evalFn: 판정 함수를 바꿔 끼울 때 (v2 시험판 — 답한 사실·수급 항목별 '모름' 반영) */
export function scoreAll(programs: Program[], profile: Profile, evalFn: (p: Program) => Evaluation = (p) => evaluateProgram(p, profile)): Scored[] {
  const out: Scored[] = programs.map((program) => {
    const ev = evalFn(program);
    return {
      program, ev,
      met: ev.reasons.filter((r) => r.kind === "met").length,
      score: relevance(program, ev, profile),
      group: variantKey(program.name),
      specific: specificMatch(program, ev, profile),
    };
  });
  seniorCoreBoost(out, profile);
  out.sort((a, b) => b.score - a.score || a.program.name.localeCompare(b.program.name, "ko"));
  return out;
}

/* ---------------- 필터 ---------------- */

export interface Filters {
  tier: Tier;
  category: Category | null;
  org: OrgType | null;
  q: string;
  /** 교육청 서비스 포함 여부 (기본 숨김 — 노출 범위는 운영자 결정 대기) */
  includeEdu?: boolean;
  /** 농림축산어업·사업자 대상 서비스 포함 여부 (기본 숨김) */
  includeIndustry?: boolean;
  /** 기관·시설 운영 지원 사업 포함 여부 (기본 숨김, 운영자 방향 2026-10-02) */
  includeOperator?: boolean;
}

/** 자동 제공·기관 선정 사업: 추천·탭 목록에서는 빼고 '자동으로 받는 혜택' 접힌 영역에만 (운영자 방향 2026-10-02) */
export const autoLike = (p: Program) => isAutoLike(p);
const eduHidden = (p: Program, f: Filters) => p.orgType === "edu_office" && !f.includeEdu && f.org !== "edu_office";
const isIndustry = (p: Program) => p.sector === "agri" || p.sector === "business";
const industryHidden = (p: Program, f: Filters) => isIndustry(p) && !f.includeIndustry;
const operatorHidden = (p: Program, f: Filters) => p.sector === "operator" && !f.includeOperator;
/** 기본 숨김 대상인지 (교육청·복지 외 분야·기관·시설 운영 지원) */
export const hiddenByDefault = (p: Program, f: Filters) => eduHidden(p, f) || industryHidden(p, f) || operatorHidden(p, f);
/** 본문(추천·탭 목록)에 보이지 않는 사업: 기본 숨김 + 자동 제공·기관 선정 */
const offMain = (p: Program, f: Filters) => autoLike(p) || hiddenByDefault(p, f);

export function normalizeQuery(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

export function programHay(p: Program): string {
  return normalizeQuery([p.name, p.summary, p.target ?? "", p.owner ?? "", p.provider ?? "", (p.tags ?? []).join(" "), (p.aliases ?? []).join(" ")].join(" "));
}

/**
 * 검색어 일치: 쉼표 묶음마다 (1) 띄어쓰기를 뺀 전체가 들어 있거나 (2) 낱말(조사·불용어 제외, 비슷한 말 포함)이 모두 들어 있으면 일치.
 * exclude: 검색어에서 뺄 낱말 (지역으로 읽은 낱말 등)
 */
export function matchesQuery(p: Program, q: string, exclude: string[] = []): boolean {
  if (!q) return true;
  const hay = programHay(p);
  const groups = q.split(",");
  const tokens = queryTokens(q, exclude);
  return groups.every((g, i) => {
    if (!g.trim()) return true;
    const whole = normalizeQuery(g);
    if (whole && hay.includes(whole)) return true;
    const t = tokens[i];
    return !!t && t.every((tok) => tokenHit(hay, tok));
  });
}

/** 낱말 중 몇 개가 맞는지 (모두 맞는 결과가 없을 때 일부 일치로 보여 줄 때 정렬용) */
export function queryHitCount(p: Program, q: string, exclude: string[] = []): number {
  const hay = programHay(p);
  return queryTokens(q, exclude).flat().filter((tok) => tokenHit(hay, tok)).length;
}

/**
 * 이름 쪽 일치 점수 (QA 2차 N5: '기초연금 못 받고 계세요' 검색에서 사업명이 '기초연금'인 결과가 1위).
 * 이름이 검색 낱말과 같으면 가장 높고, 이름에 든 낱말 수가 많을수록·이름이 짧을수록 앞.
 */
export function nameHitScore(p: Program, q: string, exclude: string[] = []): number {
  const name = normalizeQuery([p.name, ...(p.aliases ?? [])].join(" "));
  const bare = normalizeQuery(p.name);
  const toks = queryTokens(q, exclude).flat();
  let n = 0;
  for (const t of toks) {
    if (bare === normalizeQuery(t)) n += 10;
    else if (tokenHit(name, t)) n += 3;
  }
  return n ? n - Math.min(bare.length, 40) / 100 : 0;
}

/**
 * 각 축의 개수는 '다른 축의 필터'를 적용한 상태에서, 화면에 보이는 카드(지역 변형 묶음) 수로 센다
 * → 탭·분야·기관 개수와 목록 길이가 항상 일치한다.
 */
export function facetCounts(items: Scored[], f: Filters) {
  const tiers: Record<Tier, Set<string>> = { eligible: new Set(), likely: new Set(), check: new Set(), ineligible: new Set() };
  const cats = new Map<Category, Set<string>>();
  const orgs = new Map<OrgType, Set<string>>();
  const add = <K,>(m: Map<K, Set<string>>, k: K, g: string) => {
    let s = m.get(k);
    if (!s) m.set(k, (s = new Set()));
    s.add(g);
  };
  for (const s of items) {
    const p = s.program;
    if (!matchesQuery(p, f.q) || offMain(p, f)) continue;
    const okCat = !f.category || p.category === f.category;
    const okOrg = !f.org || p.orgType === f.org;
    const okTier = s.ev.tier === f.tier;
    if (okCat && okOrg) tiers[s.ev.tier].add(s.group);
    if (okTier && okOrg) add(cats, p.category, s.group);
    if (okTier && okCat) add(orgs, p.orgType, s.group);
  }
  const size = <K,>(m: Map<K, Set<string>>) => new Map([...m].map(([k, v]) => [k, v.size] as [K, number]));
  return {
    tiers: { eligible: tiers.eligible.size, likely: tiers.likely.size, check: tiers.check.size, ineligible: tiers.ineligible.size } as Record<Tier, number>,
    cats: size(cats),
    orgs: size(orgs),
  };
}

export function applyFilters(items: Scored[], f: Filters): Scored[] {
  return items.filter(
    (s) =>
      s.ev.tier === f.tier &&
      !offMain(s.program, f) &&
      (!f.category || s.program.category === f.category) &&
      (!f.org || s.program.orgType === f.org) &&
      matchesQuery(s.program, f.q),
  );
}

export interface Group {
  key: string;
  lead: Scored;
  /** 같은 사업의 다른 지역 변형 (관련도 순) */
  variants: Scored[];
}

/** 이미 정렬된 목록을 지역 변형 묶음으로 접는다. 대표는 묶음에서 관련도가 가장 높은 항목 */
export function groupVariants(list: Scored[]): Group[] {
  const map = new Map<string, Group>();
  const out: Group[] = [];
  for (const s of list) {
    const g = map.get(s.group);
    if (g) g.variants.push(s);
    else {
      const ng = { key: s.group, lead: s, variants: [] };
      map.set(s.group, ng);
      out.push(ng);
    }
  }
  return out;
}

/** 숨겨진 교육청 서비스 묶음 수 (현재 탭·검색어 기준) */
export function eduCount(items: Scored[], f: Filters): number {
  return new Set(items.filter((s) => s.program.orgType === "edu_office" && !autoLike(s.program) && s.ev.tier === f.tier && matchesQuery(s.program, f.q) && !industryHidden(s.program, f) && !operatorHidden(s.program, f)).map((s) => s.group)).size;
}

/** 숨겨진 복지 외 분야(농림·사업자) 묶음 수 (현재 탭·검색어 기준) */
export function industryCount(items: Scored[], f: Filters): number {
  return new Set(items.filter((s) => isIndustry(s.program) && !autoLike(s.program) && s.ev.tier === f.tier && matchesQuery(s.program, f.q) && !eduHidden(s.program, f) && !operatorHidden(s.program, f)).map((s) => s.group)).size;
}

/**
 * 숨겨진 기관·시설 운영 지원 묶음 수 — 체크하면 화면에 새로 나타나는 카드 수
 * (현재 탭 목록에 들어갈 것 + 아래 '자동으로 받는 혜택'에 들어갈 것)
 */
export function operatorCount(items: Scored[], f: Filters): number {
  const on: Filters = { ...f, includeOperator: true };
  const ops = items.filter((s) => s.program.sector === "operator");
  const main = groupVariants(applyFilters(ops, on));
  const autos = autoGroups(ops, on);
  return new Set([...main, ...autos].map((g) => g.key)).size;
}

const TIER_RANK: Record<Tier, number> = { eligible: 0, likely: 1, check: 2, ineligible: 3 };

/**
 * '자동으로 받는 혜택' 영역: 자동 제공·기관 선정 사업 중 조건이 맞지 않는 것을 뺀 묶음 (판정 단계 → 관련도 순).
 * 분야·기관·검색어·기본 숨김(교육청·복지 외 분야) 필터는 본문과 똑같이 적용한다. 개수 = 화면 카드(묶음) 수.
 */
export function autoGroups(items: Scored[], f: Filters): Group[] {
  const list = items.filter(
    (s) =>
      autoLike(s.program) &&
      s.ev.tier !== "ineligible" &&
      // 직접 신청할 일이 없는 보조 안내라서 내 상황과 관련 있는 것(관련도 > 0)만 — 교원 연수·기관 운영비 같은 무관한 항목 제외
      s.score > 0 &&
      !hiddenByDefault(s.program, f) &&
      (!f.category || s.program.category === f.category) &&
      (!f.org || s.program.orgType === f.org) &&
      matchesQuery(s.program, f.q),
  );
  // 추천과 같은 기준(관련도 + 조건 충족 가산점)으로 정렬하고, 같은 점수면 판정 단계 순
  const key = (s: Scored) => s.score + (s.ev.tier === "eligible" ? 2 : 0);
  const sorted = [...list].sort((a, b) => key(b) - key(a) || TIER_RANK[a.ev.tier] - TIER_RANK[b.ev.tier] || a.program.name.localeCompare(b.program.name, "ko"));
  return groupVariants(sorted);
}

/** 맞춤 추천: 조건 충족 → 가능성 있음 순으로 관련도 상위 n개 묶음 (숨김 대상 제외) */
export function topPicks(items: Scored[], f: Pick<Filters, "includeEdu" | "includeIndustry" | "includeOperator">, n = 5): Group[] {
  const base: Filters = { tier: "eligible", category: null, org: null, q: "", ...f };
  const pool = items.filter((s) => (s.ev.tier === "eligible" || s.ev.tier === "likely") && !offMain(s.program, base));
  // '조건 충족'에 가산점(+2)을 주되, 관련도가 확실히 높은 '가능성 있음'은 앞설 수 있다
  const key = (s: Scored) => s.score + (s.ev.tier === "eligible" ? 2 : 0);
  const sorted = [...pool].sort((a, b) => key(b) - key(a) || a.program.name.localeCompare(b.program.name, "ko"));
  // 같은 계열(양육비 이행 원스톱 / 양육비 이행 지원 서비스 등)은 추천 5개에 하나만 — 높은 쪽을 남기고 다음 다른 사업이 자리를 채운다 (탭 목록은 그대로)
  // 내 특별한 상황을 콕 집은 사업(specific)을 먼저 채우고, 모자라면 넓은 조건만 맞은 사업으로 채운다
  const out: Group[] = [];
  const fams: string[] = [];
  const groups = groupVariants(sorted);
  for (const pass of [true, false]) {
    for (const g of groups) {
      if (out.length >= n) break;
      if (pass && g.lead.specific === false) continue;
      if (out.includes(g)) continue;
      const fk = familyKey(g.lead.program.name);
      if (fams.some((x) => sameFamily(x, fk))) continue;
      fams.push(fk);
      out.push(g);
    }
  }
  // 화면 순서는 관련도 순 그대로
  return out.sort((a, b) => groups.indexOf(a) - groups.indexOf(b));
}

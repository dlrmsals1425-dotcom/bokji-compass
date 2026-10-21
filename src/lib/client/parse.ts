/**
 * 상황 문장 해석기 (규칙 기반, LLM 없음 · 기기 안에서만 실행).
 * 예) "수원시 소재에 계시고 59년생 부모님 두분이 계신다"
 *   → 지역 경기 수원시 · 1959년생 만 66~67세(65~69세) · 부모님 두 분(2인 가구) · 부모님 대신 찾기
 * 해석 결과는 URL에 싣지 않는다 (sessionStorage로만 입력 화면에 넘김 — 개인 정보 원칙).
 */
import type { RegionIndex } from "../data/types";
import {
  AGE_BANDS, AGE_LABEL, BENEFIT_LABEL, EMPTY_PROFILE, HOUSING_LABEL,
  ageRange, type AgeBand, type Benefit, type HouseholdTrait, type Housing, type Profile,
} from "../engine/profile";
import type { FindMode } from "./mode";
import { TOPICS, topicsIn, PREGNANT_RE, type TopicId } from "./topics";
export { PREGNANT_RE };
import type { ChildBucket } from "../engine/profile";

export interface Understood {
  /** 항목 이름 (지역·나이·가구·소득·자녀·대상·상황) */
  key: "region" | "age" | "household" | "income" | "children" | "target" | "signal";
  label: string;
}

/** 문장에서 읽은 소득 (만원/월) */
export interface ParsedIncome {
  /** 월 소득 (만원) */
  manwon: number;
  /** 연봉·연 소득을 12로 나눈 경우 원래 연 금액 (만원) */
  annual?: number;
  /** 문장 속 원래 표현 (예: '세후 400정도') */
  raw: string;
}

/** 가구원 수를 미루어 본 경우의 다른 선택지 (배우자 포함으로 가정 → 한부모) */
export interface HouseholdAlt {
  size: 1 | 2 | 3 | 4 | 5 | 6;
  /** 한 번에 바꾸는 단추 문구 (예: '배우자 없이 3명') */
  button: string;
  /** 바꾼 뒤 보여줄 문구 */
  label: string;
  /** 바꾸면 한부모 가구로 본다 */
  singleParent: boolean;
}

export interface ParsedSituation {
  mode: FindMode | null;
  /** 해석으로 채운 프로필 (나머지는 '모름') */
  profile: Profile;
  understood: Understood[];
  /** 확인이 필요한 점 (나이 경계, 지역 여러 곳 등) */
  notes: string[];
  /** 지역·나이·가족 낱말 중 하나라도 있으면 '상황 문장'으로 본다 */
  looksLikeSituation: boolean;
  /** 문장에서 지역으로 읽은 낱말 (검색어에서 뺄 때 사용) */
  regionTerms: string[];
  /** 만 나이 범위 (해석했을 때) */
  ageRange?: [number, number];
  /** 확인 화면에서 제안할 뿐, 실제로 말한 나이는 아닌 친족·학년 기반 추정. */
  ageAssumed?: boolean;
  /** 월 소득 (입력 화면의 '한 달 소득' 칸으로) */
  income?: ParsedIncome;
  /** 자녀 수 (실제 수, 0 = 없음) */
  childCount?: number;
  /** 가구원 수를 가정했을 때: 원래 문구와 다른 선택지 */
  householdAlt?: HouseholdAlt & { mainSize: number; mainLabel: string };
  /** 지역 이름이 두 곳으로 읽힐 때 (예: '광주' → 광주광역시 / 경기 광주시) 고를 수 있는 후보 */
  regionChoices?: { sido: string; sigungu: string | null; label: string }[];
  /** 나이를 나이대 하나로 정하지 못했을 때 고를 수 있는 나이대 (예: '30대' → 30~34세 / 35~39세) */
  ageChoices?: AgeBand[];
  /** 문장에서 '받지 않는다'고 한 수급·연금 (예: '기초연금 안 받아요') */
  benefitsNo?: Benefit[];
  /** 문장으로 '아님'이 정해진 가구 특성 (예: 남편·아내를 말함 → 한부모 아님) */
  traitsNo?: HouseholdTrait[];
  /** 문장에서 말한 관심 주제 (예: '기초연금 받고 싶어요' → basic_pension) — 먼저 확인할 것의 순서에만 쓴다 */
  interests?: TopicId[];
  /** 문장에서 읽은 자녀 나이대 (예: '돌 안 된 아기' → 0~1세) */
  childAges?: ChildBucket[];
  /** 부모님 두 분 나이가 다를 때 다른 한 분 (M7: 그분 기준으로 바로 다시 보기) */
  otherAge?: { band: AgeBand; label: string; range: [number, number] };
  /** 가구원 수를 모르지만 이보다 적지는 않음 (예: '가장이에요' → 2명 이상) — 확인 화면 선택지에서 1명을 뺀다 */
  minHousehold?: number;
}

/** 자녀 수·나이를 셀 때 지우는 임신 표현 ('임신 7개월'의 '7개월'은 아이 나이가 아님 — QA 4차 S2) */
/** 자녀·동생 등 다른 가족이 대학생 (QA 5차 U1) — 본인 학생 신호가 아님 */
const CHILD_STUDENT = /(?:아들|딸|자녀|아이|애|동생|손자|손녀|조카)\S{0,2}\s*(?:\S+\s*)?(?:(?:대학(?:교)?|대학원)\s*(?:생|신입생|새내기)|대학원생|휴학|재학|복학)|(?:(?:대학(?:교)?|대학원)\s*(?:생|신입생|새내기)|대학원생)\s*(?:인\s*)?(?:아들|딸|자녀|아이|애|동생|손자|손녀|조카)/;
/** 학교 낱말 (자녀 나이로 읽는 말 — 본인이 10대면 본인 이야기) */
const SCHOOL_WORDS = /초등\s*(?:학생|학교|생)?|초딩|중학생|중학교|고등학생|고등학교|고딩|중딩|고교생?|유치원|(?<![가-힣])(?:고|중)\s*[1-3](?!\d)(?!\s*(?:명|개|살|세|시|월|일|번|회|층|년|주|분))|(?<![가-힣])고삼(?![가-힣]*차)/g;
/**
 * 학년 (QA 7차): '고3·고삼·중2·고등학교 2학년' → 만 나이 범위. '구직 중 3개월'처럼 단위가 붙으면 학년이 아님.
 * 중학생 만 12~15세, 고등학생 만 15~18세 (학년을 말하면 그 학년의 만 나이 두 해)
 */
const GRADE_RE = /(?<![가-힣])(?:(고|중)\s*([1-3])(?!\d)(?!\s*(?:명|개|살|세|시|월|일|번|회|층|년|주|분))|(고)(삼)(?![가-힣]*차)|(고등|중)학교\s*([1-3])\s*학년)|(중학생|중딩|고등학생|고딩|고교생)/;
function gradeAge(m: RegExpMatchArray): { r: [number, number]; word: string } {
  if (m[7]) return /중/.test(m[7]) ? { r: [12, 15], word: "중학생" } : { r: [15, 18], word: "고등학생" };
  const lvl = m[1] ?? m[3] ?? (m[5] === "중" ? "중" : "고");
  const g = Number(m[2] ?? (m[4] ? 3 : m[6]));
  const lo = (lvl === "중" ? 11 : 14) + g;
  return { r: [lo, lo + 1], word: `${lvl === "중" ? "중" : "고"}${g}` };
}
/** 학교·학년 낱말이 자녀·손주 이야기인지 ('고3 아들', '딸이 중학생') */
const KIN_NEAR_BEFORE = /(?:아들|딸|자녀|아이|애|동생|손자|손녀|조카)\S{0,2}\s*$/;
const KIN_NEAR_AFTER = /^\s*(?:인\s*)?(?:아들|딸|자녀|아이|애|동생|손자|손녀|조카)/;
/** '부모님이 안 계셔요', '엄마 아빠 다 돌아가셨어요' — 부모님 대신 찾기가 아니라 보호자가 없는 본인 (QA 7차 P1) */
const NO_PARENTS_RE = /(?:부모(?:님)?|엄마\s*(?:랑|와|하고)?\s*아빠|어머니\s*(?:랑|와|하고)?\s*아버지)(?:\s*(?:이|가|은|는|께서|도|두\s*분|모두|다|둘\s*다))*\s*(?:안\s*계|없|돌아가)/g;
/** 대학생 자녀 (QA 5차 검증 N7: '대학생 아들 둔 50대 엄마' → 자녀 19세 이상) — 동생·손자·조카는 자녀가 아님 */
const CHILD_COLLEGE = /(?:아들|딸|자녀|아이|애)\S{0,2}\s*(?:\S+\s*)?(?:(?:대학(?:교)?|대학원)\s*(?:생|신입생|새내기)|대학원생)|(?:(?:대학(?:교)?|대학원)\s*(?:생|신입생|새내기)|대학원생)\s*(?:인\s*)?(?:아들|딸|자녀|아이|애)/;
const PREGNANT_STRIP = /(?:임신|임산부|임부)\s*(?:한\s*지\s*)?(?:중\s*)?(?:이고\s*|이에요\s*|예요\s*)?\d{1,2}\s*(?:주|개월)(?:\s*(?:차|째))?|(?:배|뱃)\s*속\s*(?:에\s*)?(?:있는\s*)?(?:아기|애기|아이|애)|태아|출산\s*(?:을\s*)?(?:예정|앞두|앞둔)(?:인|이에요|이고)?\s*(?:아기|애기|아이)?/g;

export interface ParseOptions {
  /** 사용자가 고른 탭 (부모님 복지 탭에서 시작했으면, 분명히 본인 이야기가 아닌 한 부모님 찾기로) */
  hint?: FindMode;
  /** 빠른 검색에서 문맥 또는 사용자 확인으로 정한 대상. 낱말 추정보다 우선한다. */
  target?: FindMode;
}

/* ---------------- 지역 ---------------- */

/** 시도 별칭 (번들 지역 코드 기준) */
const SIDO_ALIAS: Record<string, string[]> = {
  "11000": ["서울", "서울시", "서울특별시"],
  "12000": ["광주", "광주광역시", "전남", "전라남도", "전남광주"],
  "26000": ["부산", "부산시", "부산광역시"],
  "27000": ["대구", "대구시", "대구광역시"],
  "28000": ["인천", "인천시", "인천광역시"],
  "30000": ["대전", "대전시", "대전광역시"],
  "31000": ["울산", "울산시", "울산광역시"],
  "36000": ["세종", "세종시"],
  "41000": ["경기", "경기도"],
  "43000": ["충북", "충청북도"],
  "44000": ["충남", "충청남도"],
  "47000": ["경북", "경상북도"],
  "48000": ["경남", "경상남도"],
  "50000": ["제주", "제주도"],
  "51000": ["강원", "강원도"],
  "52000": ["전북", "전라북도"],
};

/** 일반구·생활권 이름 → 시 (번들은 시 단위). [시도 코드, 시 이름, 낱말들] */
const GU_TO_CITY: [string, string, string[]][] = [
  ["41000", "수원시", ["장안구", "권선구", "팔달구", "영통구", "광교"]],
  ["41000", "성남시", ["수정구", "중원구", "분당구", "분당", "판교"]],
  ["41000", "안양시", ["만안구", "동안구", "평촌"]],
  ["41000", "안산시", ["상록구", "단원구"]],
  ["41000", "고양시", ["덕양구", "일산동구", "일산서구", "일산"]],
  ["41000", "용인시", ["처인구", "기흥구", "수지구", "수지", "기흥"]],
  ["41000", "부천시", ["원미구", "소사구", "오정구"]],
  ["41000", "화성시", ["동탄"]],
  ["43000", "청주시", ["상당구", "서원구", "흥덕구", "청원구"]],
  ["44000", "천안시", ["동남구", "서북구"]],
  ["52000", "전주시", ["완산구", "덕진구"]],
  ["48000", "창원시", ["의창구", "성산구", "마산합포구", "마산회원구", "진해구", "마산", "진해"]],
  // (전국 확대 ②) 인천 2026-07-01 개편: 영종도 → 영종구, 검단 → 검단구 (구 이름이 아닌 생활권 낱말)
  ["28000", "영종구", ["영종도", "용유도", "운서동"]],
  ["28000", "검단구", ["검단신도시"]],
];

/** 시군구 이름에서 '시·군·구'를 뗀 낱말 중 흔한 일반 낱말과 겹치는 것 (예: 고령자, 장수, 음성) → 줄임말로는 읽지 않음 */
const STEM_BLOCK = new Set([
  "고령", "장수", "음성", "예산", "영광", "보은", "수영", "연수", "고양", "동해", "공주", "진주", "상주", "구리", "화성",
  "이천", "진도", "고성", "인제", "신안", "강서", "보성", "금산", "청도", "성주", "중", "동", "서", "남", "북", "광산",
  "영동", "옥천", "괴산", "단양", "증평", "양구", "남해", "부안", "광주", "세종", "영도", "사상", "동래", "금정", "기장",
  "달성", "군위", "검단", "영종", "강화", "옹진", "서해", "제물포", "남동", "계양", "부평", "미추홀",
]);

/** 막아 둔 줄임말이라도 바로 뒤에 사는 곳 표현이 오면 지역으로 읽는다 (예: '화성 사는', '고양에서', '구리 사심') — 흔한 낱말과 너무 겹치는 것은 제외 */
const STEM_NEVER = new Set(["고령", "장수", "예산", "영광", "음성", "수영", "연수", "서해", "보은", "광주", "세종"]);
const RESIDE_AFTER = /^\s*(?:(?:에서|에|쪽|에\s*있는)\s*)?(?:사는|사시|사심|사셔|살아|살고|살며|살구|삽니다|살아요|살거든|거주|시민|에서|$)|^(?:에서|에\s|시\s|쪽)/;

interface RegionHit {
  start: number;
  end: number;
  term: string;
  sido?: string;
  /** 시군구 후보 (같은 이름이 여러 시도에 있을 수 있음) */
  sigungus?: { code: string; sido: string }[];
}

const HANGUL = /[가-힣]/;
/** 줄임말(예: 수원) 뒤에 올 수 있는 말 */
const AFTER_STEM = /^(?:$|[^가-힣]|에서|에|쪽|지역|사|살|거주|소재|시민|도민|군민|구민|으로|로|인근|근처|은|는|의|이고|이며|이에요|입니다|이랑|하고|권)/;

function findAll(text: string, term: string): number[] {
  const out: number[] = [];
  let i = text.indexOf(term);
  while (i >= 0) {
    out.push(i);
    i = text.indexOf(term, i + 1);
  }
  return out;
}

function regionHits(text: string, regions: RegionIndex): RegionHit[] {
  const hits: RegionHit[] = [];
  const push = (term: string, mk: (i: number) => RegionHit | null, stem: boolean) => {
    for (const i of findAll(text, term)) {
      const prev = i > 0 ? text[i - 1] : "";
      const after = text.slice(i + term.length);
      // 앞 글자가 한글이면 다른 낱말의 일부 (예: '동수원' 같은 경우는 드묾) — 시도 이름 바로 뒤('경기도수원시')는 허용
      if (prev && HANGUL.test(prev) && !/[도시]$/.test(prev)) continue;
      if (stem && !AFTER_STEM.test(after)) continue;
      if (!stem && term.length <= 2 && after && HANGUL.test(after[0]) && !AFTER_STEM.test(after)) continue;
      const h = mk(i);
      if (h) hits.push(h);
    }
  };
  for (const s of regions.sidos) {
    const names = new Set([s.name, s.short, ...(SIDO_ALIAS[s.code] ?? [])]);
    for (const n of names) push(n, (i) => ({ start: i, end: i + n.length, term: n, sido: s.code }), n.length <= 2);
  }
  const byName = new Map<string, { code: string; sido: string }[]>();
  for (const s of regions.sidos) for (const g of s.sigungus) {
    const arr = byName.get(g.name) ?? [];
    arr.push({ code: g.code, sido: s.code });
    byName.set(g.name, arr);
  }
  for (const [name, cands] of byName) {
    if (name === "세종특별자치시") continue;
    push(name, (i) => ({ start: i, end: i + name.length, term: name, sigungus: cands }), false);
    const stem = name.replace(/(시|군|구)$/, "");
    if (name.length >= 3 && stem.length >= 2 && !STEM_BLOCK.has(stem)) {
      push(stem, (i) => ({ start: i, end: i + stem.length, term: stem, sigungus: cands }), true);
    } else if (name.length >= 3 && stem.length >= 2 && !STEM_NEVER.has(stem)) {
      // QA 1차 H4: 화성·고양·구리·이천 등 — 뒤에 '사는·에서·거주' 등이 올 때만, 또는 바로 앞에 그 시·도 이름이 있을 때 ('대구 군위', '인천 영종')
      const sidoBefore = (i: number) => cands.some((c) => (SIDO_ALIAS[c.sido] ?? []).some((a) => new RegExp(`${a}\\s*$`).test(text.slice(Math.max(0, i - 8), i))));
      push(stem, (i) => (RESIDE_AFTER.test(text.slice(i + stem.length)) || sidoBefore(i) ? { start: i, end: i + stem.length, term: stem, sigungus: cands } : null), true);
    }
  }
  for (const [sido, city, words] of GU_TO_CITY) {
    const s = regions.sidos.find((x) => x.code === sido);
    const g = s?.sigungus.find((x) => x.name === city);
    if (!g) continue;
    for (const w of words) push(w, (i) => ({ start: i, end: i + w.length, term: w, sigungus: [{ code: g.code, sido }] }), !/구$/.test(w));
  }
  // 긴 낱말 안에 든 짧은 일치는 버린다 (수원시 ⊃ 수원)
  return hits.filter((h) => !hits.some((o) => o !== h && o.start <= h.start && o.end >= h.end && o.end - o.start > h.end - h.start));
}

/** '광주'만 쓴 경우: 광주광역시(전남광주통합특별시)인지 경기 광주시인지 모름 → 둘 중 고르게 */
function gwangjuChoice(text: string, regions: RegionIndex, hits: RegionHit[]) {
  const gg = regions.sidos.find((x) => x.code === "41000")?.sigungus.find((g) => g.name === "광주시");
  const gj = regions.sidos.find((x) => x.code === "12000");
  if (!gg || !gj) return null;
  const at = hits.filter((h) => h.term === "광주" || h.term === "광주시");
  if (!at.length) return null;
  // 다른 시군구 낱말이 있거나 '광역시·전남·경기' 같은 말이 있으면 그쪽으로 정해짐
  if (hits.some((h) => h.sigungus && h.term !== "광주" && h.term !== "광주시")) return null;
  if (/광주\s*광역시|전남|전라남도|광주\s*시내/.test(text)) return null;
  if (/경기\s*(?:도)?\s*광주/.test(text)) return { sido: "41000", sigungu: gg.code, choices: null };
  return {
    sido: null, sigungu: null,
    choices: [
      { sido: "12000", sigungu: null, label: `광주광역시 (${gj.name})` },
      { sido: "41000", sigungu: gg.code, label: "경기 광주시" },
    ],
  };
}

/**
 * (전국 확대 ②) 2026-07-01 인천 개편으로 없어진 구 이름: 동구 → 제물포구, 중구 → 제물포구(내륙)·영종구(영종도), 서구 → 서해구·검단구.
 * 행정표준코드 pipeline/data/sigungu_codes_20260701.tsv · 경계 자료(vuski/admdongkor ver20260701)의 개편 내용.
 */
function incheonOld(text: string, regions: RegionIndex) {
  const m = /인천\s*(?:광역\s*)?시?\s*(중구|동구|서구)/.exec(text);
  const ic = regions.sidos.find((x) => x.code === "28000");
  if (!m || !ic) return null;
  const code = (n: string) => ic.sigungus.find((g) => g.name === n)?.code ?? null;
  const pick = (names: string[]) => names.map((n) => ({ sido: "28000", sigungu: code(n), label: `인천 ${n}` })).filter((c) => c.sigungu);
  if (m[1] === "동구") return { sido: "28000", sigungu: code("제물포구"), note: "인천 동구는 2026년 7월부터 제물포구예요.", choices: undefined };
  if (m[1] === "중구") return { sido: "28000", sigungu: null, note: "인천 중구는 2026년 7월부터 제물포구(내륙)와 영종구(영종도)로 나뉘었어요. 사는 곳을 골라 주세요.", choices: pick(["제물포구", "영종구"]) };
  if (/검단/.test(text)) return { sido: "28000", sigungu: code("검단구"), note: "인천 서구 검단은 2026년 7월부터 검단구예요.", choices: undefined };
  return { sido: "28000", sigungu: null, note: "인천 서구는 2026년 7월부터 서해구와 검단구로 나뉘었어요. 사는 곳을 골라 주세요.", choices: pick(["서해구", "검단구"]) };
}

function resolveRegion(text: string, regions: RegionIndex) {
  const io = incheonOld(text, regions);
  if (io) return { sido: io.sido, sigungu: io.sigungu, notes: [io.note], terms: ["인천", "인천시", "인천광역시"].filter((t) => text.includes(t)), any: true, choices: io.choices as { sido: string; sigungu: string | null; label: string }[] | undefined };
  const hits = regionHits(text, regions);
  const gw = gwangjuChoice(text, regions, hits);
  if (gw) {
    const notes = gw.choices ? ["'광주'가 광주광역시인지 경기 광주시인지 골라 주세요."] : [];
    return { sido: gw.sido, sigungu: gw.sigungu, notes, terms: ["광주", "경기", "경기도"].filter((t) => text.includes(t)), any: true, choices: gw.choices ?? undefined };
  }
  const sidoHits = hits.filter((h) => h.sido);
  const sggHits = hits.filter((h) => h.sigungus);
  const sidoSet = new Set(sidoHits.map((h) => h.sido!));
  let sigungu: string | null = null;
  let sido: string | null = null;
  const notes: string[] = [];
  let cands = sggHits.flatMap((h) => h.sigungus!.map((c) => ({ ...c, h })));
  // 같은 자리에서 시도 이름과 겹치는 시군구 줄임말(예: '광주' → 경기 광주시, '제주' → 제주시)은
  // 다른 시군구 낱말이 있으면 버리고, 없으면 그 시도가 다른 자리에서 언급될 때만 시군구로 본다
  const sameSpan = (c: (typeof cands)[number]) => sidoHits.some((s) => s.start === c.h.start && s.end === c.h.end);
  const otherSido = (c: (typeof cands)[number]) => sidoHits.some((s) => s.sido === c.sido && !(s.start === c.h.start && s.end === c.h.end));
  cands = cands.some((c) => !sameSpan(c)) ? cands.filter((c) => !sameSpan(c)) : cands.filter(otherSido);
  if (sidoSet.size) {
    const inSido = cands.filter((c) => sidoSet.has(c.sido));
    if (inSido.length) cands = inSido;
  }
  const codes = [...new Set(cands.map((c) => c.code))];
  if (codes.length === 1) {
    sigungu = codes[0];
    sido = cands[0].sido;
  } else if (codes.length > 1) {
    const sidos = [...new Set(cands.map((c) => c.sido))];
    if (sidos.length === 1) sido = sidos[0];
    const labels = codes.slice(0, 4).map((code) => labelFor(regions, cands.find((c) => c.code === code)!.sido, code));
    notes.push(`지역이 여러 곳으로 읽혀요 (${labels.join(", ")}${codes.length > 4 ? " 등" : ""}). 시·군·구를 골라 주세요.`);
  } else if (sidoSet.size === 1) {
    sido = [...sidoSet][0];
  } else if (sidoSet.size > 1) {
    notes.push("시·도가 여러 곳으로 읽혀요. 지역을 골라 주세요.");
  }
  // 시·군·구가 하나뿐인 시·도 (세종특별자치시) → 그 시·군·구로
  if (sido && !sigungu) {
    const only = regions.sidos.find((x) => x.code === sido)?.sigungus;
    if (only?.length === 1) sigungu = only[0].code;
  }
  const used = sigungu ? cands.filter((c) => c.code === sigungu).map((c) => c.h.term) : [];
  const usedSido = sido ? sidoHits.filter((h) => h.sido === sido).map((h) => h.term) : [];
  return { sido, sigungu, notes, terms: [...new Set([...used, ...usedSido])], any: hits.length > 0, choices: undefined as { sido: string; sigungu: string | null; label: string }[] | undefined };
}

function labelFor(regions: RegionIndex, sido: string, sigungu?: string | null): string {
  const s = regions.sidos.find((x) => x.code === sido);
  if (!s) return "";
  const g = sigungu ? s.sigungus.find((x) => x.code === sigungu) : undefined;
  return g ? (g.name === s.name ? s.name : `${s.short} ${g.name}`) : s.name;
}

/* ---------------- 나이 ---------------- */

export interface Today {
  year: number;
  month: number;
  day: number;
}

export const todayInSeoul = (d = new Date()): Today => {
  const [y, m, dd] = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }).split("-").map(Number);
  return { year: y, month: m, day: dd };
};

/** 출생연도(·월) → 만 나이 범위 */
export function ageFromBirth(year: number, today: Today, month?: number): [number, number] {
  const full = today.year - year;
  if (!month) return [full - 1, full];
  if (month < today.month) return [full, full];
  if (month > today.month) return [full - 1, full - 1];
  return [full - 1, full];
}

const CHILD_AGE_LABEL: Record<ChildBucket, string> = { pregnant: "임신 중", "0-1": "0~1세", "2-5": "2~5세", "6-12": "6~12세", "13-18": "13~18세", "19+": "19세 이상" };
const bandOf = (age: number): AgeBand | null => {
  if (age < 0) return null;
  return AGE_BANDS.find((b) => {
    const [lo, hi] = ageRange(b);
    return age >= lo && age <= hi;
  }) ?? null;
};

const KOR_NUM: Record<string, number> = { 한: 1, 혼: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6 };
const KOR_TENS: Record<string, number> = { 스물: 20, 서른: 30, 마흔: 40, 쉰: 50, 예순: 60, 일흔: 70, 여든: 80, 아흔: 90, 이십: 20, 삼십: 30, 사십: 40, 오십: 50, 육십: 60, 칠십: 70, 팔십: 80, 구십: 90 };
const KOR_ONES: Record<string, number> = { 하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
const TENS_W = "스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔|이십|삼십|사십|오십|육십|칠십|팔십|구십";
const NATIVE_TENS = "스물|스무|서른|마흔|쉰|예순|일흔|여든|아흔";
const SINO_TENS = "이십|삼십|사십|오십|육십|칠십|팔십|구십";
/** 서술격 조사 '이세요·이신·이에요'의 '이'는 숫자 2가 아님 (QA 2차 N2: '일흔이세요' → 72세로 읽던 문제) */
const COPULA_AFTER = "(?!세요|셔|신|심|시고|시며|에요|예요|야|고|라|니|던|었|여서|어서)";
const NATIVE_ONES = `하나|한|둘|두|셋|세(?!\\s*살|$|요)|넷|네|다섯|여섯|일곱|여덟|아홉`;
const SINO_ONES = `일|이${COPULA_AFTER}|삼|사|오|육|칠|팔|구`;
const AGE_SUFFIX = "(?:세|살|이신|이세요|이셔|이심|이시고|이에요|이예요|이야|이고|이라|되셨|되신|되었|됐|드신|잡수)";
/**
 * '육십오세', '일흔 두 살', '여든이신', '예순다섯이세요' — 고유어 십 단위(일흔)에는 고유어 일 단위(둘)만, 한자어(칠십)에는 한자어(이)만.
 * 한자어 십 단위는 '세·살'이 붙을 때만 (예: '오십견' 제외)
 */
const KOR_AGE_RE = new RegExp(`(?<![가-힣])(?:(${NATIVE_TENS})\\s*(${NATIVE_ONES})?|(${SINO_TENS})\\s*(${SINO_ONES})?)\\s*${AGE_SUFFIX}`, "g");
const OVER_RE = new RegExp(`(?<![\\d가-힣])([2-9]0|${TENS_W})\\s*(?:세|살)?\\s*(?:이|가|이\\s*)?\\s*(?:넘|훌쩍\\s*넘|넘으|넘은|넘었|넘긴|이상\\s*되)`, "g");
const BARE_NATIVE_RE = new RegExp(`(?<![가-힣])(스물|서른|마흔|쉰|예순|일흔|여든|아흔)(하나|둘|셋|넷|다섯|여섯|일곱|여덟|아홉)?(?=\\s|$|[,.!?~]|이고|이며|인데|이신데|이셔서|이시고)`, "g");
const TEEN_ONES: Record<string, number> = { 하나: 1, 한: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
/** '열일곱살', '열여섯 살', '십칠세' — '살·세'가 붙을 때만 ('열 명' 등 제외) */
const TEEN_AGE_RE = /(?<![가-힣])(열|십)\s*(하나|한|둘|두|셋|세|넷|네|다섯|여섯|일곱|여덟|아홉|일|이|삼|사|오|육|칠|팔|구)?\s*(?:살|세)(?!\s*(?:이상|이하|미만|초과|부터|까지|넘|이후|요))/g;
function korAge(tens: string, ones?: string): number | null {
  const t = KOR_TENS[tens] ?? (tens === "스무" ? 20 : undefined);
  if (!t) return null;
  return t + (ones ? KOR_ONES[ones] ?? 0 : 0);
}

function parseAge(text: string, today: Today, self = false) {
  const notes: string[] = [];
  const ranges: { r: [number, number]; label: string; birth?: number; decade?: boolean }[] = [];
  // 1959년생 · 59년생 · 59년 3월생 · '59년생
  const re = /(?:^|[^0-9])'?((?:19|20)?\d{2})\s*년(?:도)?\s*(?:(\d{1,2})\s*월\s*)?(?:생|출생|에\s*태어)/g;
  for (const m of text.matchAll(re)) {
    let y = Number(m[1]);
    if (m[1].length === 2) y = y > today.year % 100 ? 1900 + y : 2000 + y;
    if (y < 1900 || y > today.year) continue;
    const mon = m[2] ? Number(m[2]) : undefined;
    const r = ageFromBirth(y, today, mon && mon >= 1 && mon <= 12 ? mon : undefined);
    ranges.push({ r, birth: y, label: `${y}년생 → 만 ${r[0] === r[1] ? r[0] : `${r[0]}~${r[1]}`}세` });
  }
  // 만 66세 · 66세 · 66살 (단, '65세 이상' 같은 조건 표현은 제외)
  for (const m of text.matchAll(/(?:만\s*)?(\d{1,3})\s*(?:세|살)(?!\s*(?:이상|이하|미만|초과|부터|까지|넘|이후))/g)) {
    // '아이 3살', '첫째 7살' — 자녀 나이는 본인 나이가 아님
    if (/(?:아이|애|애기|아기|자녀|아들|딸|첫째|둘째|셋째|막내|큰애|작은애|쌍둥이)(?:들|는|은|가|이)?\s*(?:\d+\s*명\s*)?(?:(?:하나|둘|셋)\s*)?$/.test(text.slice(Math.max(0, m.index! - 10), m.index!))) continue;
    if (/^\s*(?:짜리\s*)?(?:된\s*)?(?:(?:고|중)\s*[1-3]\s*|고삼\s*|(?:중|고등|초등|대)학생\s*)?(?:첫째|둘째|셋째|막내|큰애|작은애|아이|애기|아기|애|아들|딸|손자|손녀|쌍둥이)/.test(text.slice(m.index! + m[0].length))) continue;
    const a = Number(m[1]);
    if (a > 0 && a < 120) ranges.push({ r: [a, a], label: `만 ${a}세` });
  }
  // 10대 고유어·한자어 나이: '열일곱살', '열여섯 살', '십칠세' (QA 5차 검증 N2) — 자녀 나이('아들 열살')는 위와 같이 뺀다
  for (const m of text.matchAll(TEEN_AGE_RE)) {
    if (/(?:아이|애|애기|아기|자녀|아들|딸|첫째|둘째|셋째|막내|큰애|작은애|쌍둥이|동생|손자|손녀|조카)(?:들|는|은|가|이)?\s*$/.test(text.slice(Math.max(0, m.index! - 10), m.index!))) continue;
    if (/^\s*(?:짜리\s*)?(?:된\s*)?(?:(?:고|중)\s*[1-3]\s*|고삼\s*|(?:중|고등|초등|대)학생\s*)?(?:첫째|둘째|셋째|막내|큰애|작은애|아이|애기|아기|애|아들|딸|손자|손녀|쌍둥이|동생|조카)/.test(text.slice(m.index! + m[0].length))) continue;
    const a = 10 + (m[2] ? TEEN_ONES[m[2]] ?? 0 : 0);
    if (a >= 10 && a <= 19) ranges.push({ r: [a, a], label: `만 ${a}세` });
  }
  // 60대 · 70대 후반
  for (const m of text.matchAll(/([2-9]0)\s*대\s*(초반|중반|후반)?/g)) {
    const d = Number(m[1]);
    const r: [number, number] = m[2] === "초반" ? [d, d + 3] : m[2] === "중반" ? [d + 3, d + 6] : m[2] === "후반" ? [d + 6, d + 9] : [d, d + 9];
    ranges.push({ r, label: `${d}대${m[2] ? ` ${m[2]}` : ""}`, decade: true });
  }
  // '이십대 후반', '삼십대 초반' (QA 3차 R1)
  for (const m of text.matchAll(/(?<![가-힣])(이십|삼십|사십|오십|육십|칠십|팔십|구십)\s*대\s*(초반|중반|후반)?/g)) {
    const d = KOR_TENS[m[1]];
    const r: [number, number] = m[2] === "초반" ? [d, d + 3] : m[2] === "중반" ? [d + 3, d + 6] : m[2] === "후반" ? [d + 6, d + 9] : [d, d + 9];
    ranges.push({ r, label: `${d}대${m[2] ? ` ${m[2]}` : ""}`, decade: true });
  }
  // 조사 없이 끝나는 고유어 나이: '아빠는 예순다섯 평택 사세요', '엄마 일흔둘' (QA 3차 R1)
  for (const m of text.matchAll(BARE_NATIVE_RE)) {
    if (m[1] === "쉰" && !m[2]) continue; // '쉰'은 '쉬다'일 수 있음
    const after = text.slice(m.index! + m[0].length);
    if (/^\s*(?:(?:명|개|번|가지|마리|권|장|대|채|군데|시간|분|년|달|평|살|세)(?![가-힣])|넘|이상|이하|미만)/.test(after)) continue;
    const a = korAge(m[1], m[2]);
    if (a && a >= 20 && a < 110) ranges.push({ r: [a, a], label: `만 ${a}세` });
  }
  for (const [w, a] of [["칠순", 70], ["팔순", 80], ["구순", 90], ["망구", 81]] as const) {
    if (text.includes(w)) ranges.push({ r: [a, a + 1], label: `${w} (만 ${a}세 안팎)` });
  }
  // 한글 숫자 나이: '육십오세', '일흔둘', '예순 다섯 살', '여든' (QA 1차 C1)
  for (const m of text.matchAll(KOR_AGE_RE)) {
    const a = m[1] ? korAge(m[1], m[2]) : korAge(m[3], m[4]);
    if (a && a >= 20 && a < 110 && !/(?:이상|이하|미만|넘)/.test(text.slice(m.index! + m[0].length, m.index! + m[0].length + 4))) ranges.push({ r: [a, a], label: `만 ${a}세` });
  }
  // '80 넘으심', '칠십 넘', '일흔 넘으셨' → 그 나이대 (QA 1차 H2)
  for (const m of text.matchAll(OVER_RE)) {
    const d = /^\d/.test(m[1]) ? Number(m[1]) : KOR_TENS[m[1]];
    if (!d || d < 20) continue;
    ranges.push({ r: [d, d + 9], label: `${d}세 넘음`, decade: true });
  }
  if (!ranges.length) return null;
  // 여러 분이면 연세가 가장 많은 분 기준
  const pick = ranges.reduce((a, b) => (b.r[1] > a.r[1] ? b : a));
  const multi = new Set(ranges.map((x) => x.label)).size > 1;
  let band: AgeBand | "unknown" = "unknown";
  const lo = bandOf(pick.r[0]);
  const hi = bandOf(pick.r[1]);
  if (lo && lo === hi) band = lo;
  else if (!pick.decade && hi) {
    // 출생연도만 알면 생일 전후로 1살 차이 → 위쪽 나이대로 보고 확인 문구
    band = hi;
    notes.push(`${self ? "생일이 지나지 않았다면" : "생신이 지나지 않으셨다면"} 만 ${pick.r[0]}세예요 (${AGE_LABEL[lo ?? hi]} 기준이 될 수 있어요).`);
  } else {
    notes.push(`${topicJosa(pick.label)} 나이대가 둘 이상에 걸쳐요. 아래에서 나이대를 골라 주세요.`);
  }
  // 나이대가 정해지지 않으면 걸친 나이대를 고를 수 있게 (예: '30대' → 30~34세 / 35~39세)
  const choices = band === "unknown" ? AGE_BANDS.filter((b) => {
    const [a, z] = ageRange(b);
    return z >= pick.r[0] && a <= pick.r[1];
  }) : undefined;
  // 다른 한 분 (나이대가 다를 때만 — M7 '그분 기준으로 다시 보기')
  let other: { band: AgeBand; label: string; range: [number, number] } | undefined;
  if (multi) {
    const rest = ranges.filter((x) => x.label !== pick.label).reduce<(typeof ranges)[number] | null>((a, b) => (!a || b.r[1] < a.r[1] ? b : a), null);
    const ob = rest ? bandOf(rest.r[1]) : null;
    if (rest && ob && ob !== band) other = { band: ob, label: rest.label, range: rest.r };
    notes.push(other ? `나이가 여러 개 있어 연세가 가장 많은 분 기준으로 찾았어요. 결과 화면에서 다른 분(${rest!.label}) 기준으로도 바로 볼 수 있어요.` : "나이가 여러 개 있어 연세가 가장 많은 분 기준으로 찾았어요. 다른 분도 따로 확인해 보세요.");
  }
  const ageLabel = band === "unknown" ? `${pick.label} (나이대 확인 필요)` : `${pick.label}${pick.decade ? "" : ` (${AGE_LABEL[band]})`}`;
  return { band, range: pick.r, label: ageLabel, notes, choices: choices?.length ? choices : undefined, other };
}

/* ---------------- 소득 ---------------- */

/** 소득 낱말 (금액 앞) — 연 소득은 12로 나눈다 */
const INCOME_KW = /(월급|급여|봉급|월\s*소득|월\s*수입|소득|수입|세후|세전|실수령액?|연봉|연\s*소득|연\s*수입|1\s*년에|일\s*년에|한\s*달(?:에|에\s*약)?|(?<![\d가-힣])월(?=\s*\d)|버는\s*돈|벌이|맞벌이|외벌이|연금)/g;
const ANNUAL_KW = /^(연봉|연\s*소득|연\s*수입|1\s*년에|일\s*년에)$/;
/** 금액 앞에 이 낱말이 더 가까이 있으면 소득이 아님 (월세 50만원, 보증금 5000 등) */
const NOT_INCOME_KW = /(월세|보증금|전세금?|대출|빚|부채|재산|예금|적금|집값|관리비|병원비|등록금|용돈|생활비|학원비|하위|상위|중위|기준|구간|분위)/;
/** 금액 뒤 낱말 (예: '300 벌어요') */
const INCOME_AFTER = /^\s*(?:만\s*원|만|원)?\s*(?:정도|쯤|가량|좀|조금|넘게|넘|이상|안팎|남짓|대)?\s*(?:을|를|씩|은|는)?\s*(?:벌|번다|버는|들어와|나와|받아요|받아|받고)/;
/** 숫자 뒤에 오면 금액이 아님 (나이·연도·사람 수 등) */
const NOT_AMOUNT_AFTER = /^\s*(?:년|살|세(?!후)|명|인|개월|월(?!급)|일|평|대(?!략)|시|kg|키로|cm|%|퍼센트|등급|번|층|호|동|차|위|째|개|분|시간|주|학년|남|녀|식구)/;
const AMOUNT_RE = /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(억|천\s*만|천|백\s*만|백|만)?\s*(원)?/g;

function parseIncome(text: string): { income: ParsedIncome; kw: string; notes: string[] } | null {
  const notes: string[] = [];
  if (/(?:소득|수입|벌이|월급)\s*(?:이|은|는|가|도)?\s*(?:전혀|하나도|거의)?\s*(?:없|0\s*원)|무소득/.test(text)) {
    return { income: { manwon: 0, raw: "소득 없음" }, kw: "소득", notes };
  }
  const kws = [...text.matchAll(INCOME_KW)].map((m) => ({ start: m.index!, end: m.index! + m[0].length, w: m[0].replace(/\s+/g, "") }));
  const found: { income: ParsedIncome; kw: string; at: number }[] = [];
  for (const m of text.matchAll(AMOUNT_RE)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (start > 0 && /[\d.,]/.test(text[start - 1])) continue;
    const after = text.slice(end);
    if (NOT_AMOUNT_AFTER.test(after)) continue;
    // '86년생'처럼 숫자 바로 뒤가 년·살 등이면 위에서 걸러짐. 단위 없는 2자리 이하 숫자는 '4백'처럼 단위가 있어야 함
    let n = Number(m[1].replace(/,/g, ""));
    const unit = (m[2] ?? "").replace(/\s+/g, "");
    const won = !!m[3];
    let v: number;
    if (unit === "억") {
      v = n * 10000;
      const more = after.match(/^\s*(\d+)\s*천/);
      if (more) v += Number(more[1]) * 1000;
    } else if (unit === "천만" || unit === "천") v = n * 1000;
    else if (unit === "백만" || unit === "백") v = n * 100;
    else if (unit === "만") v = n;
    else if (won) {
      if (n < 10000) continue;
      v = n / 10000;
    } else v = n;
    const hasUnit = !!unit || won;
    if (!hasUnit && n < 10 && n !== 0) continue;
    // 가까운 소득 낱말 (앞)
    const before = kws.filter((k) => k.end <= start && start - k.end <= (hasUnit ? 15 : 10)).pop();
    let kw: string | null = null;
    if (before) {
      const between = text.slice(before.end, start);
      if (!/[.!?\n]/.test(between) && !NOT_INCOME_KW.test(between) && !(before.w === "연금" && !hasUnit)) kw = before.w;
    }
    if (!kw && INCOME_AFTER.test(after)) {
      const lead = text.slice(Math.max(0, start - 6), start);
      if (!NOT_INCOME_KW.test(lead)) kw = "벌이";
    }
    if (!kw) continue;
    const annual = ANNUAL_KW.test(kw);
    // 월 금액은 소수 첫째 자리까지 그대로 (QA 8차: '100.5만원'이 101로 바뀌던 문제) — 연봉은 12로 나눠 만원 단위로
    const monthly = annual ? Math.round(v / 12) : Math.round(v * 10) / 10;
    if (monthly < 0 || monthly > 99999) continue;
    n = v;
    const tail = after.match(/^\s*(?:정도|쯤|가량|안팎|남짓|좀|조금)?/)?.[0] ?? "";
    found.push({ income: { manwon: monthly, ...(annual ? { annual: Math.round(n) } : {}), raw: (text.slice(before && kw === before.w ? before.start : start, end) + tail).trim() }, kw, at: start });
  }
  if (!found.length) return null;
  const distinct = [...new Set(found.map((f) => f.income.manwon))];
  if (distinct.length > 1) notes.push(`금액이 여러 개 있어 처음 금액(월 ${found[0].income.manwon.toLocaleString("ko-KR")}만원)으로 봤어요. 가구 전체 소득을 아래 소득 칸에서 고쳐 주세요.`);
  return { income: found[0].income, kw: found[0].kw, notes };
}

/* ---------------- 자녀·배우자·함께 사는 부모님 ---------------- */

const KN_COUNT: Record<string, number> = { 한: 1, 하나: 1, 둘: 2, 두: 2, 셋: 3, 세: 3, 넷: 4, 네: 4, 다섯: 5, 여섯: 6 };
// (QA 8차 후속) '여자아이 2명'·'남자아이 하나'·'딸아이' — 긴 낱말을 먼저 (앞 글자 검사 때문에 '아이'만으로는 못 읽음)
const CHILD_WORD = "(?:여자\\s*아이|남자\\s*아이|여자\\s*애|남자\\s*애|딸아이|아들아이|딸래미|아들래미|여아|남아|자녀|아이|애기|애|아기|자식|아들|딸|쌍둥이)";
const NUMW = "(\\d+|하나|둘|셋|넷|다섯|여섯|한|두|세|네)";
/** '자녀는 2명', '아이 둘', '아들 하나' */
const CHILD_AFTER = new RegExp(`(?<![가-힣])(${CHILD_WORD})(?:들)?\\s*(?:은|는|이|가|도)?\\s*(?:\\d+\\s*(?:살|세|개월)\\s*(?:짜리)?\\s*)?${NUMW}\\s*(명|분)?`, "g");
/** '두 아이', '2명의 자녀', '아이 셋' */
const CHILD_BEFORE = new RegExp(`(?<![가-힣\\d])${NUMW}\\s*(명의?|명인)?\\s*(${CHILD_WORD})`, "g");
const NO_CHILD_RE = /(?<![가-힣])(?:자녀|아이|애|자식)\s*(?:는|가|도|은)?\s*(?:없|안\s*키)|무자녀|딩크/;
const SPOUSE_RE = /(아내|와이프|남편|신랑|배우자|부부|맞벌이|외벌이|집사람|기혼|결혼\s*(?:했|해서|한|하고))/;
/** 함께 사는 배우자를 말함 ('부부'·'맞벌이' 포함, '외벌이' 하나만으로는 아님) */
const SPOUSE_PERSON = /(아내|와이프|남편|신랑|배우자|집사람|맞벌이|부부)/;
/** 버는 사람이 배우자 ('남편 외벌이', '남편이 벌어요', '아내 월급') — 월급 낱말이 있어도 본인 직장으로 보지 않음 */
const SPOUSE_EARNER = /(남편|아내|와이프|신랑|배우자|집사람)\s*(?:이|가|은|는|만|혼자|혼자서)?\s*(?:외벌이|벌어|벌고|버는|월급|급여|직장|회사)/;
const SINGLE_PARENT_RE = /(한부모|이혼|사별|돌싱|미혼모|미혼부|싱글\s*(?:맘|대디)|(?:혼자|홀로)\s*(?:서\s*)?(?:(?:애|아이|자녀|아들|딸|애기)\s*(?:들)?\s*(?:을|를|은|는)?\s*(?:\d+\s*명|하나|둘|셋|넷|한\s*명|두\s*명|세\s*명)?\s*)?(?:키우|키워|키운|기르|길러|양육))/;
/** '두 아이 엄마', '애 아빠', '한부모' — 부모님 대신 찾기가 아님 (말하는 사람이 부모) */
const NOT_PARENT_TARGET = /(?:(?:\d+|한|두|세|네)\s*)?(?:아이|애|애기|아기|자녀|아들|딸|쌍둥이)(?:들)?\s*(?:둘|셋|넷|하나)?\s*(?:의\s*)?(?:엄마|아빠)|한부모|학부모/g;
const LIVE_PARENT_RE = /(양가\s*부모님|시부모님|부모님|어머니|어머님|엄마|아버지|아버님|아빠|시어머니|시어머님|시아버지|시아버님|장모님|장인어른|장모|장인|친정\s*엄마)\s*(?:을|를|과|와|이랑|랑|하고|도)?\s*(모시고|모셔|같이\s*살|함께\s*살|한\s*집|같이\s*지내|함께\s*지내)/;

/** 자녀 나이 (QA 2차 N3): '돌 안 된 아기', '갓난아기', '생후 5개월', '첫째 7살', '3살 딸', '초등학생 아들' */
const KN_AGE: Record<string, number> = { 한: 1, 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 };
const childBucketOf = (age: number): ChildBucket | null => (age < 0 ? null : age <= 1 ? "0-1" : age <= 5 ? "2-5" : age <= 12 ? "6-12" : age <= 18 ? "13-18" : "19+");
const KID = "(?:첫째|둘째|셋째|막내|큰애|작은애|큰아이|작은아이|여자\\s*아이|남자\\s*아이|아이|애기|아기|애|아들|딸|딸아이|손자|손녀|쌍둥이)";
function childAges(text: string): ChildBucket[] {
  const out: ChildBucket[] = [];
  const add = (b: ChildBucket | null) => b && out.push(b);
  if (/돌\s*(?:도\s*)?(?:안|못)\s*(?:된|지난|됐)|갓\s*난|신생아|생후\s*\d+\s*(?:개월|일|주)|(?<![\d])\d{1,2}\s*개월\s*(?:된|짜리|아기|애기|아이|딸|아들|이에요|예요|입니다)?|백일|첫\s*돌|(?<![두세네])\s*돌\s*(?:된|지난|쟁이)/.test(text)) add("0-1");
  if (/두\s*돌/.test(text)) add("2-5");
  const kidAge = new RegExp(`${KID}(?:들)?\\s*(?:는|은|이|가)?\\s*(?:만\\s*)?(\\d{1,2}|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\\s*(?:살|세)(?!\\s*(?:이상|이하|미만))`, "g");
  for (const m of text.matchAll(kidAge)) add(childBucketOf(/^\d+$/.test(m[1]) ? Number(m[1]) : KN_AGE[m[1]] ?? -1));
  const ageKid = new RegExp(`(?<![\\d가-힣])(\\d{1,2}|한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)\\s*(?:살|세)\\s*(?:짜리\\s*)?(?:된\\s*)?${KID}`, "g");
  for (const m of text.matchAll(ageKid)) add(childBucketOf(/^\d+$/.test(m[1]) ? Number(m[1]) : KN_AGE[m[1]] ?? -1));
  if (/초등\s*(?:학생|학교|생)?|초딩/.test(text)) add("6-12");
  if (/중학생|중학교|고등학생|고등학교|고딩|중딩/.test(text) || GRADE_RE.test(text)) add("13-18");
  if (/유치원/.test(text)) add("2-5");
  if (CHILD_COLLEGE.test(text)) add("19+");
  return [...new Set(out)];
}

function countChildren(text: string): number | null {
  if (NO_CHILD_RE.test(text)) return 0;
  const general: number[] = [];
  const sons: number[] = [];
  const spans: [number, number][] = [];
  const toN = (w: string) => (/^\d+$/.test(w) ? Number(w) : KN_COUNT[w] ?? 0);
  for (const m of text.matchAll(CHILD_AFTER)) {
    const w = m[2];
    const after = text.slice(m.index! + m[0].length);
    // 숫자만 오면 나이일 수 있음 ('아이 3살') · '한/두/세/네'는 '명'이 붙을 때만
    if (/^\d+$/.test(w) && !m[3] && /^\s*(?:살|세|개월|년|학년|kg)/.test(after)) continue;
    if (/^(한|두|세|네)$/.test(w) && !m[3]) continue;
    const n = m[1] === "쌍둥이" ? 2 : toN(w);
    if (n < 1 || n > 12) continue;
    spans.push([m.index!, m.index! + m[0].length]);
    (/^(아들|딸)$/.test(m[1]) ? sons : general).push(n);
  }
  for (const m of text.matchAll(CHILD_BEFORE)) {
    if (spans.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
    const n = toN(m[1]);
    if (n < 1 || n > 12) continue;
    (/^(아들|딸)$/.test(m[3]) ? sons : general).push(n);
  }
  if (general.length) return Math.max(...general);
  if (sons.length) return sons.reduce((a, b) => a + b, 0);
  if (/쌍둥이/.test(text)) return 2;
  if (/외동/.test(text)) return 1;
  return null;
}

/* ---------------- 대상·가구·상황 ---------------- */

const PARENT_RE = /(부모|어머니|어머님|엄마|아버지|아버님|아빠|아부지|아버이|엄니|어무이|어머이|모친|부친|시부모|시어머니|시어머님|시아버지|시아버님|장인|장모|친정|시댁|양친|할머니|할아버지|할매|할배|조부모|노모|노부)/g;
/** 부모 낱말 바로 앞에 붙어도 되는 말 (그 밖의 한글이 붙으면 다른 낱말: '직장인'의 '장인', '학부모') */
const PARENT_PREFIX_OK = /(?:울|우리|저희|내|제|친정|시|홀|늙으신|연로하신|편찮으신)$/;
/** 말하는 사람이 엄마·아빠 (예: '아이 둘 키우는 엄마예요', '52살 엄마인데') — 부모님 대신 찾기가 아님 */
const SELF_PARENT_RE = /(?<!(?:우리|울|저희|제|내|친정|시)\s?)(?:엄마|아빠|애엄마|애아빠)(?:예요|에요|이에요|입니다|인데요?|이고|고요?|라서|로서|임|이야|야|랍니다)(?=[\s.,!?~]|$)/;
/**
 * '(자녀 낱말) 키우는/둔/있는 엄마·아빠' — 어미('예요')가 없어도 말하는 사람이 엄마·아빠 (QA 5차 검증 N1: '고등학생 딸 키우는 엄마 안산'을 부모님 대신 찾기로 읽던 문제).
 * '우리 엄마'처럼 소유 낱말이 바로 앞에 있으면 아님.
 */
const KID_RAISING_PARENT = /(?:아이|애|애기|아기|자녀|아들|딸|쌍둥이|자식|애들|아이들|남매|형제|자매)(?:들)?\s*(?:(?:\d+|하나|둘|셋|넷|한|두|세)\s*(?:명)?\s*)?(?:을|를)?\s*(?:키우는|키우고\s*있는|기르는|둔|두고\s*있는|있는|가진|낳은|양육하는)\s*(?:(?:\d+\s*대|[2-6]0\s*대|(?:이|삼|사|오)십\s*대|워킹|직장인|전업|싱글|평범한|초보)\s*)?(?<!(?:우리|울|저희|제|내|친정|시)\s?)(?:엄마|아빠|애엄마|애아빠|맘|대디|부모)(?![가-힣]*(?:께서|님))/;
/**
 * 부정·바람·모름 (QA 1차 C2): 낱말 바로 뒤에 이런 말이 오면 '그렇다'로 읽지 않는다.
 *   '기초연금 받고 싶어요', '받으시는지 모르겠어요', '치매는 없으심', '장애는 아니고', '받을 수 있나요'
 */
const NEG_AFTER = /^[^.,!?\n]{0,6}?(?:없|아니|아냐|않|안\s*(?:받|해|돼|되|계|하)|못\s|싶|모르|몰라|는지|런지|ㄴ지|나요|을까|ㄹ까|까요|수\s*있|궁금|여부|되나|될까|인지|대상인지|가능|신청\s*(?:하고|하려|할))/;
/** 앞에 붙는 부정 ('안 받아요', '못 받으세요', '기초연금은 안') */
const NEG_BEFORE = /(?:안|못|않)\s*$/;
/** 문장에서 re 가 '그렇다'는 뜻으로 한 번이라도 쓰였는지 */
/** 일하지 않음 ('매일·생일'의 '일'은 아님, '일자리'는 아님) */
const NOT_WORKING_RE = /무직|은퇴(?:했|하셨|하고|한|해서|후)|(?<![가-힣])일\s*(?:을|은|도|는)?\s*(?:안\s*(?:해|하|함)|하지\s*(?:않|못)|못\s*(?:해|하)|쉬고|그만\s*두)|직장\s*(?:이|은)?\s*없/;
function affirmed(text: string, re: RegExp): boolean {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const m of text.matchAll(g)) {
    const end = m.index! + m[0].length;
    if (NEG_AFTER.test(text.slice(end, end + 16))) continue;
    if (NEG_BEFORE.test(text.slice(Math.max(0, m.index! - 3), m.index!))) continue;
    return true;
  }
  return false;
}
/** 부모 낱말 찾기 (낱말 경계 확인) */
function findParentWord(text: string, possessiveOnly = false): string | undefined {
  for (const m of text.matchAll(PARENT_RE)) {
    const prev = text.slice(Math.max(0, m.index! - 6), m.index!);
    if (/[가-힣]$/.test(prev) && !PARENT_PREFIX_OK.test(prev)) continue;
    if (possessiveOnly && !POSSESSIVE.test(prev)) continue;
    return m[1];
  }
  return undefined;
}
/** 부모 낱말 앞의 '우리·울·저희·제·내·친정·시' (말하는 사람의 부모님) */
const POSSESSIVE = /(?:울|우리|저희|내|제|친정|시)\s?$/;
/** 주체 높임 (남의 상황): '계세요', '받으셨어요', '사세요', '이세요' — '하세요'(명령)는 제외 */
const HONORIFIC = /(계세요|계시|계셔|받으셨|받으시|받으세요|사세요|사시|사셔|드셨|이세요|이셔|이신|으셨|셨어요|셔요)/;
/** 서술로 끝나는 문장 ('…했어요', '…예요', '…입니다') — 서비스 이름만 쓴 검색어와 구별 */
const VERB_END = /(?:어요|아요|해요|예요|이에요|에요|습니다|었어|았어|했어|해|돼|나요|까요)[.!?~\s]*$/;
const SELF_RE = /(?:^|\s)(?:나는|내가|난|저는|제가|본인은|본인이|저희\s*집)(?=\s|$)|저\s*혼자|나\s*혼자/;
const COUPLE_RE = /(두\s*분|부부|내외|양친|두\s*사람|(?<![가-힣])둘이서?(?!\s*(?:세요|에요|예요|이세요|십))|노부모?부부|노부부)/;
const ALONE_RE = /((?:혼자|홀로)\s*(?:(?:서|월세|전세|자취|원룸|집에서|단칸방|임대|에)\s*)?(?:사|살|계|지내|되|자취)|독거|홀몸|1\s*인\s*가구|자취\s*(?:해|하고|중|생))/;

/** 받침에 맞춘 '은/는' (QA 4차 S6: '30대 중반는' → '30대 중반은') */
function topicJosa(t: string): string {
  const m = /([가-힣])[^가-힣]*$/.exec(t);
  if (!m) return `${t}은`;
  return `${t}${(m[1].charCodeAt(0) - 0xac00) % 28 === 0 ? "는" : "은"}`;
}

export function parseSituation(raw: string, regions: RegionIndex | null, today: Today = todayInSeoul(), opt: ParseOptions = {}): ParsedSituation {
  const text = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  const p: Profile = { ...EMPTY_PROFILE };
  const understood: Understood[] = [];
  const notes: string[] = [];
  const signals: string[] = [];

  // 지역
  let regionTerms: string[] = [];
  let regionFound = false;
  let regionChoices: ParsedSituation["regionChoices"];
  if (regions) {
    const r = resolveRegion(text, regions);
    p.sido = r.sido;
    p.sigungu = r.sigungu;
    notes.push(...r.notes);
    regionTerms = r.terms;
    regionFound = r.any;
    regionChoices = r.choices;
    if (r.sido) understood.push({ key: "region", label: labelFor(regions, r.sido, r.sigungu) });
  }

  // 자녀 수·소득·함께 사는 부모님 (대상 판단에도 씀)
  // 아직 태어나지 않은 아이는 자녀 수·나이·가구원에 넣지 않는다 (QA 4차 S2)
  const pregnant = affirmed(text, PREGNANT_RE);
  const kidText = pregnant ? text.replace(PREGNANT_STRIP, " ") : text;
  let childN = countChildren(kidText);
  let childAssumed = false;
  let kidAges = childAges(kidText);
  // 나이만 말한 자녀 ('돌 안 된 아기 있어요', '첫째 7살 둘째 3살') → 그 수만큼
  if (childN === null && kidAges.length) childN = kidAges.length;
  const inc = parseIncome(text);
  const SALARY_RE = /(월급|급여|봉급|실수령|세후|세전|연봉|맞벌이|외벌이)/;
  const lpM = text.match(LIVE_PARENT_RE);
  // 말하는 사람이 엄마·아빠인 표현('…엄마예요', '엄마 혼자 애 키워요')은 부모님 대신 찾기가 아님 (QA 1차 C1)
  // '싱글맘·싱글대디·미혼모' — 말하는 사람이 자녀를 키우는 한부모 (QA 3차 R1)
  const singleMom = /(싱글\s*(?:맘|대디|파파)|미혼\s*(?:모|부)(?!\s*(?:시설|센터|보호)))/.test(text);
  const selfParent = SELF_PARENT_RE.test(text) || KID_RAISING_PARENT.test(text) || singleMom || /(?:^|\s)(?:엄마|아빠)\s*(?:혼자|홀로)\s*(?:서\s*)?(?:애|아이|자녀|아들|딸|애기|애들)/.test(text);

  const noParents = new RegExp(NO_PARENTS_RE.source).test(text);
  const selfHint =
    selfParent || noParents ||
    pregnant || SELF_RE.test(text) || (childN !== null && childN > 0) || (!!inc && SALARY_RE.test(text)) || /(아내|와이프|남편|신랑|배우자|집사람|자영업|프리랜서|회사원|직장인)/.test(text);
  // '부모님 모시고 살아요' — 부모님은 함께 사는 가족이고 찾는 사람은 본인
  const livesWithParent = !!lpM && (/모시|모셔/.test(lpM[2]) || selfHint);
  // 말하는 사람이 엄마·아빠이고 자녀 낱말만 있으면(수 없음) 자녀 1명으로 본다 ('지적장애 있는 딸', '혼자 애 키워요')
  if (selfParent && childN === null && (singleMom || /(?<![가-힣])(?:딸|아들|아이|애|애기|아기)(?:이|가|이랑|랑|하고|과|와|을|를|은|는|\s|$)/.test(kidText))) {
    childN = 1;
    childAssumed = true;
  }

  // 대상 (부모님 / 본인)
  // '저는 엄마고 우리 엄마는 일흔이세요' — 말하는 사람이 엄마여도 '우리 엄마·저희 어머니'가 따로 있으면 그분을 찾는다 (QA 2차 N1)
  const parentText = text.replace(NOT_PARENT_TARGET, " ").replace(NO_PARENTS_RE, " ");
  const parentWord = selfParent ? findParentWord(parentText, true) : findParentWord(parentText);
  let mode: FindMode | null = null;
  if (parentWord && !livesWithParent) {
    mode = "parent";
  } else if (SELF_RE.test(text) || livesWithParent || selfHint) {
    mode = "self";
  }
  // 부모님 복지 탭에서 시작했으면, 분명히 본인 이야기('저는·제가'·'…엄마예요'·'부모님 모시고')가 아닌 한 부모님 찾기 (QA 2차 N1)
  const clearlySelf = SELF_RE.test(text) || selfParent || livesWithParent || noParents;
  if (opt.hint === "parent" && mode === "self" && !clearlySelf) mode = "parent";
  if (opt.target) mode = opt.target;
  if (mode === "parent") {
    const gp = /(할머니|할매)/.test(parentWord ?? "") ? "할머니" : /(할아버지|할배)/.test(parentWord ?? "") ? "할아버지" : /조부모/.test(parentWord ?? "") ? "조부모" : null;
    understood.push({ key: "target", label: `${gp ?? "부모님"} 대신 찾기` });
  }
  if (mode === "self") understood.push({ key: "target", label: "내 복지 찾기" });

  // 나이
  let age = parseAge(text, today, mode === "self");
  let ageAssumed = false;
  // 할아버지·할머니를 대신 찾는데 나이를 말하지 않았으면 만 65세 이상으로 보고 확인 화면에 보여 준다 (QA 3차 R1)
  if (!age && mode === "parent" && parentWord && /(할머니|할아버지|할매|할배|조부모)/.test(parentWord)) {
    ageAssumed = true;
    age = {
      band: "unknown",
      range: [65, 120],
      label: "나이를 말하지 않아 만 65세 이상으로 봤어요 (나이대 확인 필요)",
      notes: [],
      choices: ["65-69", "70-74", "75-79", "80+"],
      other: undefined,
    };
  }
  // 나이를 말하지 않은 본인 중·고등학생 ('중학생인데…', '고3인데…') → 학년의 만 나이 (QA 7차 P1)
  if (!age && mode !== "parent" && !selfParent) {
    const g = text.match(GRADE_RE);
    const i = g?.index ?? 0;
    if (g && !KIN_NEAR_BEFORE.test(text.slice(Math.max(0, i - 8), i)) && !KIN_NEAR_AFTER.test(text.slice(i + g[0].length))) {
      const { r, word } = gradeAge(g);
      ageAssumed = true;
      age = { band: "0-18", range: r, label: `만 ${r[0]}~${r[1]}세 (${word})`, notes: [], choices: undefined, other: undefined };
    }
  }
  if (age) {
    p.age = age.band;
    understood.push({ key: "age", label: age.label });
    notes.push(...age.notes);
  }
  // (QA 5차 검증 N2) 말하는 사람 본인이 만 19세 미만 ('고등학교 자퇴한 열일곱살이에요') — 본인 이야기로 본다.
  // '고등학교·중학생' 같은 학교 낱말은 본인 이야기라 자녀·3인 가구로 바꾸지 않는다 (자녀 수를 직접 말한 경우만 자녀)
  const teenSelf = !!age && age.range[1] <= 18 && mode !== "parent" && !selfParent;
  if (teenSelf) {
    if (mode !== "self") {
      mode = "self";
      understood.push({ key: "target", label: "내 복지 찾기" });
    }
    const noSchool = kidText.replace(SCHOOL_WORDS, " ");
    kidAges = childAges(noSchool);
    childN = countChildren(noSchool);
    if (childN === null && kidAges.length) childN = kidAges.length;
    childAssumed = false;
  }

  // 가구
  const nIn = text.match(/(\d)\s*인\s*가구|가족\s*(?:이\s*)?(\d)\s*명|(\d)\s*식구|(한|두|세|네|다섯|여섯)\s*식구|(?<![가-힣])(둘|셋|넷|다섯|여섯)(?:이서|이|서)\s*(?:살|사|지내)|(\d)\s*명이(?:서)?\s*(?:살|사|지내)/);
  const cap = (n: number) => Math.max(1, Math.min(6, n)) as 1 | 2 | 3 | 4 | 5 | 6;
  const ppl = (n: number) => `본인 포함 ${n}명`;
  const lpN = livesWithParent ? (/부모님/.test(lpM![1]) ? 2 : 1) : 0;
  const lpTxt = lpN === 2 ? " · 부모님 두 분" : lpN === 1 ? ` · ${lpM![1].replace(/\s+/g, "")}` : "";
  const hasKids = childN !== null && childN > 0;
  let householdAlt: ParsedSituation["householdAlt"];
  let singleParentInferred = false;
  let hhFromKids = false;
  if (ALONE_RE.test(text) && !hasKids && !livesWithParent) {
    p.householdSize = 1;
    p.traits = ["single"];
    understood.push({ key: "household", label: "혼자 사심 (1인 가구)" });
  } else if (nIn) {
    const n = Number(nIn[1] ?? nIn[2] ?? nIn[3] ?? nIn[6]) || KOR_NUM[nIn[4]] || ({ 둘: 2, 셋: 3, 넷: 4, 다섯: 5, 여섯: 6 } as Record<string, number>)[nIn[5]] || 0;
    if (n >= 1) {
      p.householdSize = Math.min(6, n) as Profile["householdSize"];
      understood.push({ key: "household", label: n >= 6 ? "6명 이상 가구" : `${n}인 가구` });
    }
  } else if (mode !== "parent" && childN !== null && (hasKids || SPOUSE_RE.test(text))) {
    // 본인 + 자녀 N명 (+ 배우자) (+ 함께 사는 부모님)
    hhFromKids = true;
    const kids = hasKids ? ` · 자녀 ${childN}명` : "";
    const base = 1 + childN + lpN;
    if (hasKids && (SINGLE_PARENT_RE.test(text) || ALONE_RE.test(text))) {
      p.householdSize = cap(base);
      singleParentInferred = true;
      understood.push({ key: "household", label: `같이 사는 사람: ${ppl(base)} (한부모${kids}${lpTxt})` });
    } else if (SPOUSE_RE.test(text)) {
      p.householdSize = cap(base + 1);
      understood.push({ key: "household", label: `같이 사는 사람: ${ppl(base + 1)} (배우자${kids}${lpTxt})` });
    } else {
      // 배우자 여부를 말하지 않음 → 배우자 포함으로 보고, 확인 화면에서 한 번에 바꿀 수 있게
      const mainLabel = `같이 사는 사람: ${ppl(base + 1)} (배우자 포함으로 봤어요${kids}${lpTxt})`;
      p.householdSize = cap(base + 1);
      understood.push({ key: "household", label: mainLabel });
      householdAlt = {
        size: cap(base),
        button: `배우자 없이 ${base}명`,
        label: `같이 사는 사람: ${ppl(base)} (배우자 없이${kids}${lpTxt})`,
        singleParent: true,
        mainSize: cap(base + 1),
        mainLabel,
      };
    }
  } else if (livesWithParent && mode !== "parent") {
    // '장인어른 모시고 삽니다' — 장인·장모·시부모는 배우자가 있다는 뜻 (QA 2차 N3)
    const inLaw = /(장인|장모|시부모|시어머|시아버)/.test(lpM![1]);
    const spouse = inLaw || SPOUSE_RE.test(text) ? 1 : 0;
    const kidsN = hasKids ? childN! : 0;
    const n = 1 + spouse + lpN + kidsN;
    p.householdSize = cap(n);
    const who = [spouse ? "배우자" : "", lpTxt.replace(/^ · /, ""), kidsN ? `자녀 ${kidsN}명` : ""].filter(Boolean).join(" · ");
    understood.push({ key: "household", label: `같이 사는 사람: ${ppl(n)} (${who}${spouse && !SPOUSE_RE.test(text) ? " — 배우자도 함께 산다고 봤어요" : ""})` });
    hhFromKids = true;
  } else if (COUPLE_RE.test(text)) {
    p.householdSize = 2;
    understood.push({ key: "household", label: mode === "parent" ? "부모님 두 분 (부부 2인 가구)" : "부부 2인 가구" });
  }
  // '가장이에요' — 부양하는 가족이 있다는 뜻 (QA 4차 S5: 1명으로 보이던 문제). 수는 모르니 2명 이상에서 고르게
  let minHousehold: number | undefined;
  if (p.householdSize === "unknown" && mode !== "parent" && /(?<![가-힣])(?:집안\s*)?가장(?:이에요|이예요|입니다|이고|이라|인데|이에|임|으로|이죠)/.test(text)) {
    minHousehold = 2;
    understood.push({ key: "household", label: "가장 (부양하는 가족 있음 · 가족 수는 아래에서 골라 주세요)" });
  }
  if (mode !== "parent" && childN !== null && !hhFromKids) {
    understood.push({ key: "children", label: childN === 0 ? "자녀 없음" : `자녀 ${childN}명` });
  }
  if (mode !== "parent" && kidAges.length) {
    p.children = kidAges;
    understood.push({ key: "children", label: `자녀 나이 ${kidAges.map((c) => CHILD_AGE_LABEL[c]).join(", ")}` });
  }

  if (childAssumed) notes.push("자녀 수를 말하지 않아 1명으로 봤어요. 다르면 아래 자녀 칸에서 고쳐 주세요.");

  // 소득 (만원/월)
  if (inc) {
    const i = inc.income;
    const won = (n: number) => n.toLocaleString("ko-KR");
    const approx = /(정도|쯤|가량|안팎|남짓|좀|조금)/.test(i.raw) ? "약 " : "";
    const label =
      i.manwon === 0
        ? "소득 없음"
        : i.annual !== undefined
          ? `연봉 ${won(i.annual)}만원 → 월 약 ${won(i.manwon)}만원으로 계산`
          : `월 소득 ${approx}${won(i.manwon)}만원${/세후|실수령/.test(i.raw) ? " (세후)" : /세전/.test(i.raw) ? " (세전)" : ""}`;
    understood.push({ key: "income", label });
    notes.push(...inc.notes);
    if (i.manwon > 0 && SALARY_RE.test(text) && p.householdSize !== 1) {
      notes.push("적어 주신 금액을 가구 전체 소득으로 봤어요. 함께 사는 가족의 다른 소득(배우자 소득 등)이 있으면 아래 소득 칸에서 더해 주세요.");
    }
  }

  // 그 밖의 상황 신호
  const care: Profile["care"] = [];
  // 부정·바람·모름은 '그렇다'로 읽지 않음 ('치매는 없으심', '장기요양 등급 받을 수 있나요')
  const careDeny = /(?:치매|거동|일상\s*생활|돌봄)[^.,]{0,6}(?:없|아니|괜찮|문제\s*없|멀쩡|정정)/.test(text) || /(?:정정하|건강하|멀쩡하)/.test(text);
  if (affirmed(text, /치매/)) { care.push("daily"); signals.push("치매 (돌봄 필요)"); }
  if (affirmed(text, /(요양\s*등급|장기\s*요양|거동\s*(?:이|을|도)?\s*(?:불편|못|힘들|어려)|못\s*걸|누워\s*(?:계|지내)|와상|(?:일상\s*생활|식사|거동).{0,6}(?:어려|힘들|도움))/) && !care.includes("daily")) {
    care.push("daily");
    signals.push("일상생활 도움 필요");
  } else if (affirmed(text, /요양\s*등급|장기\s*요양/)) signals.push("장기요양 등급");
  if (affirmed(text, /퇴원/)) { care.push("discharged"); signals.push("최근 퇴원"); }
  if (!care.length && careDeny) p.care = [];
  if (care.length) p.care = care;

  if (/장애/.test(text)) {
    if (!affirmed(text, /장애/)) {
      if (/장애\s*(?:는|가|도)?\s*(?:없|아니)/.test(text)) p.disability = "none";
    } else {
      // 가족의 장애: '딸이 지적장애', '지적장애 있는 딸', '장애가 있는 아들' (어느 순서든) — QA 1차 C1
      const FAM = "(?:아들|딸|동생|형|누나|언니|오빠|자녀|아이|애|손자|손녀|남편|아내|와이프|가족\\s*중|가구원)";
      const member = new RegExp(`${FAM}[^.]{0,8}장애|장애[^.]{0,10}(?:있는|인|가진|를\\s*가진)\\s*${FAM}`).test(text) && !/(?:저는|제가|본인이|본인은|내가|나는)[^.]{0,8}장애/.test(text);
      p.disability = member ? "member" : "self";
      if (/(중증|심한\s*장애|장애\s*정도가\s*심한)/.test(text)) p.disabilitySeverity = "severe";
      else if (/(경증|심하지\s*않은)/.test(text)) p.disabilitySeverity = "mild";
      signals.push(member ? "장애가 있는 가족" : mode === "parent" ? "장애 (부모님 본인)" : "장애 (본인)");
    }
  }

  const benefits: Benefit[] = [];
  const benefitsNo: Benefit[] = [];
  // '…받을 수 있나요', '…받고 싶어요', '…받으시는지 모르겠어요' 는 받는 중이 아님 (QA 1차 C2)
  const has = (re: RegExp) => affirmed(text, new RegExp(`${re.source}(?:\\s*(?:을|를|이|가|은|는)?\\s*(?:받고|받으시|받는|받으심|받아|받습니다|받음|받았|받으세요|수급\\s*중|타고|타시|대상자?(?:예요|이에요|입니다|이고|이라|임)?|이에요|에요|예요|입니다|이고|이라서|이라|임|이세요|이심|이신))?`));
  if (has(/기초\s*연금/) && /기초\s*연금\s*(?:을|를|은|는)?\s*(?:받고|받으시|받는|받으심|받아|받습니다|받음|받았|받으세요|수급\s*중|타고|타시|수급자)/.test(text)) benefits.push("basic_pension");
  else if (/기초\s*연금\s*(?:을|를|은|는|도)?\s*(?:안|못)\s*(?:받|타)|기초\s*연금\s*(?:을|를|은|는|도)?\s*(?:받지|타지)\s*(?:않|못)/.test(text)) benefitsNo.push("basic_pension");
  if (has(/(?:기초\s*(?:생활\s*)?수급|생계\s*급여|수급자)/)) benefits.push("livelihood");
  if (has(/의료\s*급여/)) benefits.push("medical");
  if (has(/주거\s*급여/)) benefits.push("housing");
  if (has(/차상위/)) benefits.push("near_poverty");
  if (!benefits.some((b) => b !== "basic_pension") && /(?:수급|수급자|기초\s*생활\s*수급)\s*(?:은|는|도|이|가)?\s*(?:아니|아녜|아닙|안\s*받|못\s*받|받지\s*(?:않|못))/.test(text)) {
    benefitsNo.push("livelihood", "medical", "housing", "education", "near_poverty");
  }
  if (benefits.length) {
    p.benefits = benefits;
    signals.push(benefits.map((b) => BENEFIT_LABEL[b]).join("·"));
  }
  // 아니라고 말한 것도 확인 화면에 보여 준다 (QA 3차 R7: '기초연금 못 받고 계세요' → '알아들은 내용이 없어요'인데 답은 채워지던 문제)
  if (benefitsNo.includes("basic_pension")) signals.push(mode === "parent" ? "기초연금 안 받으심" : "기초연금 안 받음");
  if (benefitsNo.includes("livelihood")) signals.push("기초생활수급·차상위 아님");

  let housing: Housing | null = null;
  if (/월세/.test(text)) housing = "monthly";
  else if (/전세/.test(text)) housing = "jeonse";
  else if (/(영구\s*임대|국민\s*임대|공공\s*임대|임대\s*아파트|행복\s*주택|LH)/.test(text)) housing = "public_rental";
  else if (/(자가|자기\s*집|본인\s*집|집\s*(?:이|은)\s*있)/.test(text)) housing = "own";
  if (housing) {
    p.housing = housing;
    signals.push(HOUSING_LABEL[housing]);
  }

  const traits: HouseholdTrait[] = [...(p.traits ?? [])];
  if (/(한부모|조손)/.test(text) || singleParentInferred || (mode === "self" && SINGLE_PARENT_RE.test(text) && !/사별하고\s*혼자\s*(?:사|살)/.test(text))) traits.push("single_parent");
  if (/다자녀/.test(text)) traits.push("multi_child");
  if (affirmed(text, /(국가\s*유공자|보훈|참전)/)) traits.push("veteran");
  if (affirmed(text, /(다문화|결혼\s*이민|북한\s*이탈|탈북)/)) traits.push("multicultural");
  if (traits.length) p.traits = [...new Set(traits)];
  // (QA 8차 후속) 남편·아내와 산다고 했으면 한부모 아님 — 입력·결과 화면에서 다시 묻지 않게 ('이혼·사별'을 말했으면 정하지 않음)
  const traitsNo: HouseholdTrait[] = [];
  if (mode !== "parent" && SPOUSE_PERSON.test(text) && !SINGLE_PARENT_RE.test(text) && !traits.includes("single_parent")) traitsNo.push("single_parent");
  // 가구 문구에 이미 '한부모'가 들어가면 신호로 다시 쓰지 않는다
  const sigTraits = traits.filter((t) => t !== "single" && !(t === "single_parent" && singleParentInferred));
  if (sigTraits.length) signals.push(sigTraits.map((t) => ({ single_parent: "한부모·조손", multi_child: "다자녀", veteran: "보훈", multicultural: "다문화·북한이탈" })[t as Exclude<HouseholdTrait, "single">]).join("·"));

  if (affirmed(text, /(구직|실직|일자리\s*(?:를|을)?\s*(?:찾|구하))/) && !/노인\s*일자리/.test(text)) {
    p.activity = "job_seeking";
    signals.push("구직 중");
  }
  // '월급·연봉·직장' → 직장에 다님, '자영업·장사' → 자영업 (부모님 대신 찾기에서는 누구 일인지 몰라 두지 않음)
  else if (mode === "self" && /(자영업|장사\s*(?:해|하고|를)|가게\s*(?:를\s*)?(?:해|운영)|프리랜서)/.test(text)) {
    p.activity = "self_employed";
    signals.push("자영업·프리랜서");
  } else if (mode !== "parent" && TOPICS.student.say.test(text) && !CHILD_STUDENT.test(text)) {
    // QA 5차 U1: '대학생·대학원생·휴학생·재학 중·복학' → 하는 일 '학생' (자녀·동생이 대학생인 문장은 제외)
    p.activity = "student";
    signals.push("대학생 (하는 일: 학생)");
  } else if (mode === "self" && SPOUSE_EARNER.test(text) && /외벌이/.test(text)) {
    // (QA 8차 후속) '남편 외벌이, 월급 400' — 버는 사람은 배우자 한 명 → 본인은 일하지 않음 (월급은 가구 소득으로)
    p.activity = "none";
    signals.push("배우자 외벌이 (본인은 일하지 않음)");
  } else if (mode === "self" && /(월급|급여|봉급|연봉|맞벌이|직장\s*(?:에|을|다니|다녀|인)|회사\s*(?:에\s*)?(?:다니|다녀)|회사원|직장인)/.test(text) && !/(퇴사|그만두|실직|휴직)/.test(text) && !SPOUSE_EARNER.test(text)) {
    p.activity = "employed";
    signals.push("직장에 다님");
  } else if (NOT_WORKING_RE.test(text)) {
    // (QA 8차) '일하지 않아요·일 안 해요·무직·은퇴했어요' → 하는 일 '일하지 않음' (예전 답의 '구직 중'이 남지 않게)
    p.activity = "none";
    signals.push("일하지 않음");
  }
  // 10대 본인이 '학생·중학생·고3' (학교 밖이 아니면) → 하는 일 학생 (QA 7차: '열일곱살 알바하는 학생')
  if (teenSelf && p.activity === "unknown" && !TOPICS.out_of_school.say.test(text) && (/(?<![가-힣대원])학생/.test(text) || GRADE_RE.test(text))) {
    p.activity = "student";
    signals.push("중·고등학생 (하는 일: 학생)");
  }
  if (mode === "self" && noParents) signals.push("부모님이 안 계심");
  // (QA 5차 검증 N2) 자퇴·학교 안 다님·학업 중단 → 학교 밖 청소년 (본인 이야기일 때만)
  if (mode !== "parent" && !selfParent && TOPICS.out_of_school.say.test(text) && p.activity !== "student") signals.push("학교에 다니지 않음 (학교 밖 청소년)");
  if (mode !== "parent" && pregnant) {
    p.children = ["pregnant", ...kidAges];
    signals.push("임신 중");
  }
  // '군 제대했어요·전역했어요' → 제대한 청년 (QA 4차 S4) — 일자리·구직 주제로 (장기복무 제대군인 사업과는 다름)
  if (mode !== "parent" && /(?:군\s*(?:에서\s*)?)?(?:제대|전역)(?:\s*(?:했|한|하고|해서|후|하자마자|한\s*지)|\s*군인|\s*장병|했어요)/.test(text)) signals.push("군 제대 (청년 일자리·구직)");
  if (/(저소득|형편이?\s*어려|어렵게\s*사)/.test(text)) notes.push("소득이 낮다고 하셨어요. 소득 구간을 입력하면 더 정확해져요.");

  for (const s of signals) understood.push({ key: "signal", label: s });

  const familyWord = !!parentWord || ALONE_RE.test(text) || COUPLE_RE.test(text) || !!nIn || hasKids || livesWithParent;
  // 대학생 주제는 본인이 학생일 때만 (자녀가 대학생·부모님 대신 찾기 문장은 아님)
  const interests = topicsIn(text).filter((k) => (k !== "student" || p.activity === "student") && (k !== "out_of_school" || (mode !== "parent" && !selfParent && p.activity !== "student")));
  // 지역·나이가 없어도 상황을 말한 문장 ('기초연금 못 받고 계세요', '치매 진단 받으셨어요', '실직했어요') → 맞춤 찾기로 (QA 2차 N5)
  const signalish = signals.length > 0 || benefitsNo.length > 0 || interests.length > 0 || p.activity !== "unknown" || p.care !== null || p.disability !== "unknown";
  const sentence = HONORIFIC.test(text) || SELF_RE.test(text) || VERB_END.test(text);
  if (mode === null && HONORIFIC.test(text) && (signalish || regionFound || !!age || familyWord)) {
    // 높임말로 남의 상황을 말함 → 부모님 대신 찾기
    mode = opt.hint ?? "parent";
    understood.push({ key: "target", label: mode === "parent" ? "부모님 대신 찾기" : "내 복지 찾기" });
  }
  return {
    mode,
    profile: p,
    understood,
    notes,
    looksLikeSituation: regionFound || !!age || familyWord || !!inc || (signalish && sentence),
    regionTerms,
    ageRange: age?.range,
    ...(ageAssumed ? { ageAssumed: true } : {}),
    ...(inc ? { income: inc.income } : {}),
    ...(childN !== null && mode !== "parent" ? { childCount: childN } : {}),
    ...(householdAlt ? { householdAlt } : {}),
    ...(regionChoices ? { regionChoices } : {}),
    ...(age?.choices ? { ageChoices: age.choices } : {}),
    ...(benefitsNo.length ? { benefitsNo } : {}),
    ...(traitsNo.length ? { traitsNo } : {}),
    ...(interests.length ? { interests } : {}),
    ...(kidAges.length && mode !== "parent" ? { childAges: kidAges } : {}),
    ...(age?.other && mode === "parent" ? { otherAge: age.other } : {}),
    ...(minHousehold ? { minHousehold } : {}),
  };
}

/** 확인 배너 한 줄 (예: "경기 수원시 · 1959년생 → 만 66~67세 (65~69세) · 부모님 두 분 (부부 2인 가구)") */
export function understoodLine(ps: ParsedSituation, skip: Understood["key"][] = []): string {
  const order: Understood["key"][] = ["region", "age", "household", "children", "income", "signal"];
  return order.filter((k) => !skip.includes(k)).flatMap((k) => ps.understood.filter((u) => u.key === k).map((u) => u.label)).join(" · ");
}

/** 해석 결과 → 입력 화면의 v2 입력 (소득·자녀 수). 자녀 수 3 = 3명 이상 */
export function parsedExtras(ps: ParsedSituation): {
  incomeManwon?: number; childCount?: 0 | 1 | 2 | 3; ageSpan?: [number, number]; interests?: TopicId[];
  otherAge?: { band: AgeBand; label: string };
} {
  return {
    ...(ps.income ? { incomeManwon: ps.income.manwon } : {}),
    ...(ps.childCount !== undefined ? { childCount: Math.min(3, ps.childCount) as 0 | 1 | 2 | 3 } : {}),
    // '30대'처럼 범위만 말했으면 그 범위로 판정 (정확한 나이대를 알면 그것으로)
    ...((ps.profile.age === "unknown" || (ps.profile.age === "0-18" && ps.ageRange && ps.ageRange[1] <= 18)) && ps.ageRange ? { ageSpan: ps.ageRange } : {}),
    ...(ps.interests?.length ? { interests: ps.interests } : {}),
    ...(ps.otherAge ? { otherAge: { band: ps.otherAge.band, label: ps.otherAge.label } } : {}),
  };
}

/* ---------------- 입력 화면으로 넘기기 (sessionStorage, URL에 싣지 않음) ---------------- */

export const PREFILL_KEY = "bn.prefill.v1";

export interface Prefill {
  text: string;
  parsed: ParsedSituation;
  at: number;
}

export function savePrefill(text: string, parsed: ParsedSituation) {
  try {
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ text, parsed, at: Date.now() } satisfies Prefill));
  } catch {}
}

export function readPrefill(): Prefill | null {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Prefill;
    // 30분 지난 해석은 버린다
    if (!v?.parsed || Date.now() - v.at > 30 * 60 * 1000) return null;
    return v;
  } catch {
    return null;
  }
}

export function clearPrefill() {
  try {
    sessionStorage.removeItem(PREFILL_KEY);
  } catch {}
}

/** 해석 결과로 갈 입력 화면 주소 (해석 내용은 싣지 않음) */
export function prefillPath(ps: ParsedSituation): string {
  return `/situation?for=${ps.mode ?? "self"}&prefill=1`;
}

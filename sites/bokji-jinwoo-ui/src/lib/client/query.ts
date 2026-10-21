/**
 * 너그러운 검색어 처리: 띄어쓰기·조사·불용어·비슷한 말.
 * 예) "수원시 소재 59년생 부모님 틀니 지원" → [틀니(의치·임플란트)] (지역·나이·가족 낱말은 검색어에서 빠짐)
 */

/** 검색에 쓰지 않는 말 (서비스 문구와 무관한 서술·가족 호칭) */
const STOP = new Set([
  "복지", "혜택", "지원", "서비스", "정책", "제도", "사업", "프로그램", "정보", "관련", "대한", "위한", "대해", "대하여",
  "찾아", "찾아줘", "찾아봐", "찾아봐줘", "찾아주세요", "찾기", "찾고", "알려줘", "알려주세요", "알려", "궁금", "궁금해", "궁금해요",
  "있는", "있나요", "있어요", "있을까요", "있는지", "받을", "받을수", "받는", "받고", "받으실", "받으시는", "수", "좀", "뭐", "뭐가", "무엇", "어떤", "어떻게",
  "계신다", "계시고", "계세요", "계신", "계시는", "계심", "살고", "사는", "사시는", "사세요", "살아요", "산다", "소재", "거주", "거주하는", "거주하시는",
  "및", "등", "그리고", "또는", "우리", "저희", "제", "내", "나", "저", "님", "두", "분", "두분", "할", "해주세요", "싶어요", "싶은데",
  "부모", "부모님", "어머니", "어머님", "엄마", "아버지", "아버님", "아빠", "시부모", "시부모님", "할머니", "할아버지", "가족", "본인",
  "이신", "이신데", "이고", "인데", "입니다", "이에요", "예요",
]);

/** 뒤에 붙는 조사·어미 (긴 것부터) */
const PARTICLES = ["에서는", "이라도", "께서는", "에게는", "에서", "에게", "한테", "께서", "으로", "이랑", "하고", "부터", "까지", "처럼", "이신", "이고", "은", "는", "이", "가", "을", "를", "에", "의", "도", "만", "와", "과", "랑", "로", "께"];

/** 같은 뜻으로 함께 찾을 말 */
const SYNONYMS: string[][] = [
  ["어르신", "노인", "노년", "경로", "고령"],
  ["독감", "인플루엔자"],
  ["틀니", "의치"],
  ["임플란트", "치과임플란트"],
  ["치매", "인지"],
  ["교통비", "버스비", "버스요금", "교통"],
  ["장애인", "장애"],
  ["아기", "영아", "영유아"],
  ["임산부", "임신부", "임신"],
  ["월세", "임차", "주거비"],
  // QA 1차 M4: '출산지원금' 0건 → 지역마다 다른 이름
  ["출산지원금", "출산장려금", "출산축하금", "출생축하금", "출산양육지원금", "출산지원", "첫만남이용권", "출산축하"],
  ["육아수당", "양육수당", "아동수당", "부모급여"],
  ["생활비", "생계비", "생계급여"],
];

/** 알아볼 수 있는 글자(한글 음절·영문·숫자)가 하나도 없는 검색어 (예: 'ㅁㄴㅇㄹ', '???') — 전체 목록 대신 0건 */
export function isGibberish(q: string): boolean {
  const t = q.normalize("NFC").trim();
  return !!t && !/[0-9A-Za-z가-힣]/.test(t);
}

/** 위기 신호 (QA 1차 M4): 자살·자해 생각 → 109 먼저, 생계 위기 → 129·긴급복지 */
const SUICIDE_RE = /(죽고\s*싶|죽을\s*(?:것\s*같|까)|자살|목숨을?\s*끊|살기\s*싫|살고\s*싶지\s*않|사라지고\s*싶|극단적\s*(?:선택|생각)|생을\s*마감|자해)/;
const DISTRESS_RE = /(도와\s*주세요|살려\s*주세요|돈이\s*(?:너무\s*|하나도\s*|전혀\s*)?없|먹을\s*(?:게|것이?)\s*없|굶고|굶어|쫓겨나|길에서\s*자|노숙|월세를?\s*못\s*내|전기가?\s*끊|가스가?\s*끊|너무\s*힘들|막막)/;
export function crisisOf(q: string): "suicide" | "distress" | null {
  const t = q.normalize("NFC");
  if (SUICIDE_RE.test(t)) return "suicide";
  if (DISTRESS_RE.test(t)) return "distress";
  return null;
}

export const compact = (s: string) => s.replace(/\s+/g, "").toLowerCase();

function stripParticle(t: string): string {
  for (const p of PARTICLES) if (t.length - p.length >= 2 && t.endsWith(p)) return t.slice(0, -p.length);
  return t;
}

/** 낱말 하나에 대해 찾을 형태들 (원형·조사 뗀 형태·비슷한 말) */
export function variants(token: string): string[] {
  const base = token.toLowerCase();
  const stripped = stripParticle(base);
  const out = new Set([base, stripped]);
  for (const g of SYNONYMS) if (g.some((w) => w === base || w === stripped)) g.forEach((w) => out.add(w));
  return [...out];
}

/**
 * 검색 낱말 (쉼표 묶음마다 낱말 목록). 불용어·숫자 나이 표현·지역 낱말(exclude)은 뺀다.
 * 모두 빠지면: 지역 낱말이 빠진 경우 빈 목록(그 지역 전체), 아니면 원래 낱말 그대로.
 */
export function queryTokens(q: string, exclude: string[] = []): string[][] {
  const ex = new Set(exclude.flatMap((e) => [e, compact(e)]));
  return q
    .normalize("NFC")
    .split(",")
    .map((grp) => {
      const raw = grp.split(/[\s·/]+/).map((t) => t.replace(/[^0-9A-Za-z가-힣]/g, "")).filter(Boolean);
      let excluded = false;
      const kept = raw.filter((t) => {
        const s = stripParticle(t);
        if (ex.has(t) || ex.has(s) || exclude.some((e) => t.startsWith(e) && e.length >= 2)) return (excluded = true) && false;
        if (STOP.has(t) || STOP.has(s)) return false;
        if (/^\d+(년생|년도?\s*생|세|살|대)/.test(t) || /^\d+(명|인)$/.test(t)) return false;
        return true;
      });
      // 지역 낱말을 빼고 나니 서술어만 남았으면 '그 지역 사업 전체', 아니면(예: '복지' 한 낱말) 원래 낱말 그대로
      return kept.length ? kept : excluded ? [] : raw;
    });
}

export const tokenHit = (hay: string, token: string) => variants(token).some((v) => hay.includes(v));

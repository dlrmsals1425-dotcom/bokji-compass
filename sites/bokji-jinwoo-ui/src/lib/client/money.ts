/**
 * 금액·기한 요약 (결과 화면 맨 위): 파이프라인이 원문에서 뽑은 money·due 를 쉬운 말로.
 * - 금액은 '원문 기준 최대'로만 쓰고, 함께 받을 수 없는 것이 섞여 있을 수 있어 더하지 않는다.
 * - 기한은 지난 것은 빼고 가까운 순서. 사건 뒤 n일 이내(출생 후 60일 등)는 날짜와 무관하게 맨 앞.
 */
import type { Due, Money, Program } from "../data/types";
import type { ChildBucket } from "../engine/profile";

/** 349700 → '34만 9,700원', 1000000 → '100만원', 9500 → '9,500원' */
export function formatWon(won: number): string {
  const man = Math.floor(won / 10000);
  const rest = won % 10000;
  if (!man) return `${rest.toLocaleString("ko-KR")}원`;
  return rest ? `${man.toLocaleString("ko-KR")}만 ${rest.toLocaleString("ko-KR")}원` : `${man.toLocaleString("ko-KR")}만원`;
}

export const MONEY_PER_LABEL: Record<Money["per"], string> = { month: "월", year: "연", once: "한 번", max: "" };

/** '월 최대 100만원' · '최대 300만원' */
export function moneyLabel(m: Money): string {
  const per = MONEY_PER_LABEL[m.per];
  return `${per ? per + " " : ""}최대 ${formatWon(m.won)}`;
}

export interface DueView {
  text: string;
  /** 정렬 키: 남은 날 (사건 기준은 -1) */
  days: number;
  /** 보조 문구 (예: '41일 남음', '지금 접수 기간', '다음 접수 2027년 3월') */
  note: string;
}

const DAY = 86_400_000;
const at = (s: string) => new Date(`${s}T00:00:00+09:00`).getTime();
const kstToday = (now: Date) => at(new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10));
const kstYM = (now: Date) => {
  const d = new Date(now.getTime() + 9 * 3600_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
};
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** 기한 → 화면 문구·정렬 키. 이미 지난 접수 기간은 null */
export function dueView(d: Due, now: Date = new Date()): DueView | null {
  const today = kstToday(now);
  if (d.kind === "after") return { text: d.text, days: -1, note: "해당 날짜부터 세어요" };
  if (d.kind === "period") {
    if (!d.to) return null;
    const end = at(d.to);
    if (end < today) return null;
    const left = Math.round((end - today) / DAY);
    if (d.from && at(d.from) > today) {
      const until = Math.round((at(d.from) - today) / DAY);
      return { text: d.text, days: left, note: `${until}일 뒤 접수 시작` };
    }
    return { text: d.text, days: left, note: left === 0 ? "오늘 마감" : `${left}일 남음` };
  }
  if (d.kind === "annual" && d.months?.length) {
    const { y, m } = kstYM(now);
    if (d.months.includes(m)) {
      // 지금 달부터 이어지는 접수 달의 끝
      let end = m;
      let yy = y;
      while (d.months.includes((end % 12) + 1) && (end % 12) + 1 !== m) {
        end = (end % 12) + 1;
        if (end === 1) yy++;
      }
      const left = Math.round((at(ymd(yy, end, lastDay(yy, end))) - today) / DAY);
      return { text: d.text, days: left, note: "지금 접수하는 달이에요" };
    }
    const next = [...d.months].map((k) => (k > m ? { y, m: k } : { y: y + 1, m: k })).sort((a, b) => a.y - b.y || a.m - b.m)[0];
    const days = Math.round((at(ymd(next.y, next.m, 1)) - today) / DAY);
    return { text: d.text, days, note: `다음 접수 ${next.y}년 ${next.m}월` };
  }
  return null;
}

export interface DueRow {
  program: Program;
  due: DueView;
}
/** 기한이 있는 사업을 가까운 순으로 (지난 것·모르는 것은 뺌) */
/** 출생·출산 뒤 기한 ('출생 후 1년 이내') — 아기(0~1세)나 임신이 있을 때만 맞는 기한 */
const BIRTH_DUE = /출생|출산|태어/;
export function dueRows(programs: Program[], now: Date = new Date(), limit = 4, opts: { children?: ChildBucket[] | null } = {}): DueRow[] {
  const seen = new Set<string>();
  const rows: DueRow[] = [];
  for (const p of programs) {
    if (!p.due || seen.has(p.id)) continue;
    seen.add(p.id);
    // 대출·대부는 금액처럼 요약에서 뺀다. '사망 후 N개월'은 장제·유족 사업이 아니면 맨 위 요약에 두지 않는다
    if (/대출|대부|융자|보증/.test(p.name)) continue;
    if (p.due.kind === "after" && /사망/.test(p.due.text) && !/장제|장례|유족|사망|상조/.test(p.name)) continue;
    // (QA 7차 P3) 열두 달 내내 접수 = 사실상 상시 ('매년 3~2월'), '출생 후 N'은 아기·임신이 있을 때만
    if (p.due.kind === "annual" && new Set(p.due.months ?? []).size >= 12) continue;
    if (p.due.kind === "after" && BIRTH_DUE.test(p.due.text) && !(opts.children ?? []).some((c) => c === "0-1" || c === "pregnant")) continue;
    const v = dueView(p.due, now);
    if (v) rows.push({ program: p, due: v });
  }
  // 날짜가 있는 것(가까운 순) 먼저, '출생 후 1년 이내'처럼 사건 기준인 것은 그다음
  const rank = (d: DueRow) => (d.due.days < 0 ? Number.MAX_SAFE_INTEGER : d.due.days);
  return rows.sort((a, b) => rank(a) - rank(b)).slice(0, limit);
}

/*
 * 요약 금액 안전장치 (6차 검증 M2·M3): 번들의 money 는 원문에서 '가장 큰 값'을 뽑은 것이라
 * 가구원 수별 표의 가장 큰 칸이나 임금·보험 보장액·단가가 섞여 들어온다. 번들을 다시 만들지 않고 화면에서 거른다.
 */
/** 가구원 수에 따라 금액이 다른 표 ('5인 가구 : …', '부부가구 최고 …', '1인 70만원 / 2인 100만원') */
const HH_TABLE = /\d\s*인\s*(?:이상\s*)?(?:가구|세대)|(?:부부|단독)\s*(?:가구|세대)|가구원\s*수\s*(?:별|에\s*따라)|[2-9]\s*인\s*(?:이상\s*)?(?:기준\s*)?[:：]|[(（]\s*[2-9]\s*인\s*(?:이상)?\s*[)）]\s*(?:월\s*)?\d/;
/** 'N인 (이상) (:) (월·연) 금액' 쌍 — 서로 다른 N이 둘 이상이면 가구원 수별 표 */
const HH_PAIR = /(\d)\s*인(?!\s*당)\s*(?:이상\s*)?[:：]?\s*(?:월|연)?\s*[\d,]+\s*(?:만|천)?\s*원/g;
const HH_ANY = /가구원\s*수\s*(?:구분|관계)\s*없이/;
/** 금액 바로 앞: 임금·인건비 ('중개보수 지원'은 혜택) */
const WAGE_BEFORE = /(?:임금|(?<!중개\s?)보수|월\s*급여|급여\s*[:：]|일당|일급|시급|인건비)[^\d]{0,8}$/;
/** 보험 사업의 보장액 (사망·후유장해·진단비 등). 유족에게 주는 위로금·장제비는 보험 사업이 아니라 그대로 둔다 */
const INSURANCE_NAME = /보험/;
const PREMIUM_BEFORE = /보험료/;
/** 보험 사업의 금액 중 보장액만 (PR #1 리뷰: '건강보험 임신·출산 진료비'의 140만원·'고용보험 미적용자 출산급여'의 150만원은 혜택) */
/** 이름이 보험 상품 자체(시민안전보험·상해보험·화재보험·배상책임보험 등) — 금액은 보장액 (보험료 지원 금액만 혜택) */
const INSURANCE_PRODUCT = /(?:안전|상해|화재|배상\s*책임|안심|농기계|자전거|단체)\s*보험(?!\s*료)/;
/** 그 밖의 '보험' 이름(건강보험 진료비·고용보험 출산급여·보험료 지원)은 금액 앞뒤에 보장 낱말이 있을 때만 */
const COVER_BEFORE = /(?:사망|후유\s*장[해애]|상해|보장|보험금|진단비|장례비|배상\s*책임|부상)[^\n]{0,24}$/;
const COVER_AFTER = /^\s*(?:보장|한도)/;
/** 금액 바로 뒤 '이하인' — 대상 기준값 ('22,800원(…2,640원) 이하인 노인') */
const CRITERION_AFTER = /^[\s)）]*이하\s*인/;
/** '총 … 지원한도액 : 15,800천원' — 사업 전체 한도 */
const BUDGET_BEFORE = /총[^\d]{0,16}한도\s*액?\s*[:：]?\s*$/;
/** 가구원 수가 기준값을 설명하는 말 ('2인 가구 기준 중위소득의 475/1000') — 금액 표가 아님 */
const HH_BENCHMARK = /[(（]?\s*\d\s*인\s*가구\s*기준\s*중위\s*소득[^)）]*[)）]?/g;
/** 금액 바로 앞뒤의 단가 ('시간당 5천원 중 3천원', '9,000원(1식)', '1박 1만원'). '임신·출산 1회당'은 한 번 주는 돈이라 뺌 */
const UNIT_BEFORE = /(?:시간\s*당|(?<![임출][신산]\s?)(?<!\d)1?\s*회\s*당|건\s*당|(?<!\d)1\s*식|(?<!\d)1\s*일\s*당?|(?<!\d)1\s*박|30\s*분\s*당)[^\d]{0,8}(?:[\d,.]+\s*(?:만|천)?\s*원\s*중\s*)?$/;
const UNIT_AFTER = /^\s*(?:\/\s*(?:1\s*인\s*[·,]\s*)?(?:1\s*식|1\s*박|1\s*일|1?\s*회|1?\s*시간)|\(\s*(?:1\s*식|1\s*박|1?\s*회\s*당|시간\s*당)\s*\))/;
/** 작은 금액인데 원문 구절에 단가 낱말이 있으면 단가로 본다 ('A형 시간당 10,354원, B형 9,136원') */
const UNIT_WORD = /시간\s*당|회\s*당|건\s*당|(?<!\d)1\s*식|(?<!\d)1\s*박|(?<!\d)1\s*일|일\s*당|단가/;
const SMALL_WON = 50_000;
const WON_RE = /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(억|천만|만|천)?\s*(?:(\d+(?:,\d{3})*)\s*(천)?)?\s*원/g;
const WON_UNIT: Record<string, number> = { 억: 1e8, 천만: 1e7, 만: 1e4, 천: 1e3 };

/** 인용 안에서 이 금액이 적힌 자리의 앞뒤 (못 찾으면 인용 전체를 앞으로 본다). fullBefore: 인용 처음부터 금액 앞까지 */
function around(m: Money): { before: string; after: string; fullBefore: string } {
  let hit: { before: string; after: string; fullBefore: string } | null = null;
  for (const x of m.quote.matchAll(WON_RE)) {
    const v = Math.round(Number(x[1].replace(/,/g, "")) * (x[2] ? WON_UNIT[x[2]] : 1) + (x[3] ? Number(x[3].replace(/,/g, "")) * (x[4] ? 1e3 : 1) : 0));
    if (v !== m.won) continue;
    const i = x.index ?? 0;
    hit = { before: m.quote.slice(Math.max(0, i - 24), i), after: m.quote.slice(i + x[0].length, i + x[0].length + 12), fullBefore: m.quote.slice(0, i) };
  }
  return hit ?? { before: m.quote, after: "", fullBefore: m.quote };
}

/** 가구원 수별 표에서 뽑은 금액의 기본 문구 (상세 원문 표를 읽으면 householdLabel 로 바꾼다) */
export const HH_LABEL = "가구원 수에 따라 달라요";

/*
 * byHh: 가구원 수별 금액 표 (원문 지원내용 — 상세 샤드의 benefit). 번들을 다시 만들지 않고 화면에서 읽는다.
 * 표로 보려면 두 칸 이상이고, 요약에 뽑힌 금액이 표 안에 있어야 한다 (다른 표·예시 한 줄을 잘못 읽지 않게).
 */
export interface HhTable {
  /** 가구원 수 → 금액(원) */
  rows: Partial<Record<number, number>>;
  /** 'N인 이상' 칸 (그보다 큰 가구에도 같은 금액) */
  openTop?: number;
  /** 기초연금처럼 단독·부부 가구 */
  single?: number;
  couple?: number;
}
const HH_ROW = /(?:[(（]\s*)?(\d)\s*인\s*(이상\s*)?(?:가구|세대)?\s*(?:기준\s*)?[)）]?\s*[:：]?\s*(?:최고\s*|최대\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(억|천만|만|천)?\s*원/g;
const HH_SINGLE = /단독\s*(?:가구|세대)\s*(?:최고|최대)?\s*(\d+(?:,\d{3})*)\s*(만|천)?\s*원/;
const HH_COUPLE = /부부\s*(?:가구|세대)\s*(?:최고|최대)?\s*(\d+(?:,\d{3})*)\s*(만|천)?\s*원/;
const hhWon = (n: string, u?: string) => Math.round(Number(n.replace(/,/g, "")) * (u ? WON_UNIT[u] : 1));

export function householdTable(benefit: string, m: Money): HhTable | null {
  const text = benefit.replace(/&#13;|\r/g, "\n").replace(/\s+/g, " ");
  const s1 = text.match(HH_SINGLE);
  const s2 = text.match(HH_COUPLE);
  if (s1 && s2) {
    const single = hhWon(s1[1], s1[2]);
    const couple = hhWon(s2[1], s2[2]);
    if (single === m.won || couple === m.won) return { rows: {}, single, couple };
  }
  const rows: Partial<Record<number, number>> = {};
  let openTop: number | undefined;
  // '1인 5만원, 2인 7만원'처럼 가구·세대 낱말 없는 줄은 원문이 가구원 수 이야기일 때만 (봉양수당의 1인·2인은 모시는 어르신 수)
  const aboutHousehold = /가구원|가구\s*구성원|세대원|가구\s*수|세대\s*수/.test(text);
  for (const x of text.matchAll(HH_ROW)) {
    const n = Number(x[1]);
    if (n < 1 || rows[n] !== undefined) continue;
    if (!/가구|세대|[(（]/.test(x[0]) && !aboutHousehold) continue;
    rows[n] = hhWon(x[3], x[4]);
    if (x[2]) openTop = n;
  }
  const vals = Object.values(rows);
  if (vals.length < 2 || !vals.includes(m.won)) return null;
  return { rows, ...(openTop ? { openTop } : {}) };
}

/** 원문 표로 만든 문구: 가구원 수를 알면 그 칸, 모르면 범위. 맞는 칸이 없으면 null (지어내지 않음) */
export function householdLabel(m: Money, benefit: string | undefined, size: 1 | 2 | 3 | 4 | 5 | 6 | "unknown"): string | null {
  const t = benefit ? householdTable(benefit, m) : null;
  if (!t) return null;
  const per = MONEY_PER_LABEL[m.per];
  const pre = per ? `${per} ` : "";
  if (t.single !== undefined && t.couple !== undefined) {
    return size === 1 ? `단독가구 ${pre}최대 ${formatWon(t.single)}` : `${pre}최대 단독 ${formatWon(t.single)} · 부부 ${formatWon(t.couple)}`;
  }
  if (size !== "unknown") {
    const v = t.rows[size] ?? (t.openTop && size >= t.openTop ? t.rows[t.openTop] : undefined);
    return v === undefined ? null : `${size}인 가구 ${pre}최대 ${formatWon(v)}`;
  }
  const ns = Object.keys(t.rows).map(Number).sort((a, b) => a - b);
  const lo = ns[0];
  const hi = ns[ns.length - 1];
  return `${pre}${lo}인 ${formatWon(t.rows[lo]!)} ~ ${hi}인${t.openTop === hi ? " 이상" : ""} ${formatWon(t.rows[hi]!)}`;
}

export interface MoneyView {
  money: Money;
  /** 화면 문구: '월 최대 100만원' 또는 '가구원 수에 따라 달라요' */
  label: string;
}
/** 요약에 쓸 금액 문구. 혜택이 아닌 금액(임금·보험 보장액·단가)이면 null */
export function moneyView(m: Money, name = ""): MoneyView | null {
  const { before, after, fullBefore } = around(m);
  if (WAGE_BEFORE.test(before)) return null;
  if (INSURANCE_NAME.test(name) && !PREMIUM_BEFORE.test(before) && (INSURANCE_PRODUCT.test(name) || COVER_BEFORE.test(before) || COVER_AFTER.test(after))) return null;
  if (CRITERION_AFTER.test(after) || BUDGET_BEFORE.test(before)) return null;
  if (UNIT_BEFORE.test(before) || UNIT_AFTER.test(after)) return null;
  // 작은 금액: 그 금액 자리 앞뒤에 단가 낱말이 있으면 단가. 바로 앞이 '월·연'이면 기간 합계라 그대로 ('1일 1식 500원 지원(월 10,000원)')
  const tail = before.split(/\d[\d,.]*\s*(?:만|천)?\s*원/).pop() ?? before;
  if (m.won < SMALL_WON && UNIT_WORD.test(fullBefore + after) && !/(?:월|연|매월|매달)\s*$/.test(tail)) return null;
  const hhText = m.quote.replace(HH_BENCHMARK, " ");
  const distinctN = new Set([...hhText.matchAll(HH_PAIR)].map((x) => x[1])).size;
  if (!HH_ANY.test(hhText) && (HH_TABLE.test(hhText) || distinctN >= 2)) return { money: m, label: HH_LABEL };
  return { money: m, label: wording(m, before, after) };
}

/*
 * 금액 표현을 원문 그대로 (6차 검증 낮음): '600만원 내외' → 약, '자녀 1인당', 수급·차상위와 일반이 다르면 범위, 품목별 금액은 품목마다.
 * 모두 인용 원문에 그 말이 있을 때만 바꾼다.
 */
/** 두 품목이 가운뎃점으로 이어진 경우만 ('기저귀(월 9만원) · 조제분유(월 11만원)') — 낱말 앞은 띄어쓰기·문장부호 */
const ITEM_PAIR = /(?<![가-힣\d])([가-힣]{2,6})\s*\(\s*(?:(월|연)\s*)?(\d+(?:,\d{3})*)\s*(만|천)?\s*원\s*\)\s*[·ㆍ]\s*([가-힣]{2,6})\s*\(\s*(?:(월|연)\s*)?(\d+(?:,\d{3})*)\s*(만|천)?\s*원\s*\)/;
const ITEM_STOP = /^(?:이상|이하|미만|만원|천원|시간|학년|않은|심한)$/;
const GENERAL_RE = /(?:일반|그\s*외|그\s*밖)[^\d]{0,24}(\d+(?:,\d{3})*(?:\.\d+)?)\s*(억|천만|만|천)?\s*원/;
const APPROX_AFTER = /^\s*(?:내외|정도|안팎|가량|상당)/;
const APPROX_BEFORE = /약\s*$/;
/** 금액 바로 앞의 '자녀(아동) 1인당' — 사이에 다른 금액이 있으면 아님 ('1명당 연 100만원, 연 최대 500만원') */
const PER_CHILD = /(자녀|아동|아이)\s*(?:1|한)\s*(?:인|명)\s*당(?![^\d]*\d[\d,]*\s*(?:만|천)?\s*원)[^\d]*$/;
const wonOf = (n: string, unit?: string) => Math.round(Number(n.replace(/,/g, "")) * (unit ? WON_UNIT[unit] : 1));

function wording(m: Money, before: string, after: string): string {
  const per = MONEY_PER_LABEL[m.per];
  const ip = m.quote.match(ITEM_PAIR);
  const items = ip ? [{ name: ip[1], per: ip[2], won: wonOf(ip[3], ip[4]) }, { name: ip[5], per: ip[6], won: wonOf(ip[7], ip[8]) }] : [];
  if (items.length && items.some((x) => x.won === m.won) && !items.some((x) => ITEM_STOP.test(x.name))) return items.map((x) => `${x.name} ${x.per ? `${x.per} ` : ""}${formatWon(x.won)}`).join(" · ");
  const g = /(수급|차상위)/.test(m.quote) ? m.quote.match(GENERAL_RE) : null;
  const lo = g ? wonOf(g[1], g[2]) : 0;
  if (lo > 0 && lo < m.won) {
    const range = lo % 10000 === 0 && m.won % 10000 === 0 ? `${(lo / 10000).toLocaleString("ko-KR")}~${formatWon(m.won)}` : `${formatWon(lo)}~${formatWon(m.won)}`;
    return `${per ? `${per} ` : ""}${range}`;
  }
  const base = APPROX_AFTER.test(after) || APPROX_BEFORE.test(before) ? `${per ? `${per} ` : ""}약 ${formatWon(m.won)}` : moneyLabel(m);
  const pc = before.match(PER_CHILD);
  return pc ? `${base} (${pc[1] === "아동" ? "아동" : "자녀"} 1인당)` : base;
}

/**
 * 한눈에 보기의 '신청 기한이 있는 것' (QA 7차 P3): 먼저 확인할 5가지 + 받으실 수 있어요에서만.
 * '신청할 때 확인'은 먼저 확인할 5가지에 든 것만 (상황과 무관한 '청소년자문단 운영 지원' 같은 줄이 섞이던 문제) — 출생 뒤 기한은 예외.
 */
export function summaryDueRows(picks: Program[], fit: Program[], office: Program[], children: ChildBucket[] | null | undefined, now: Date = new Date(), limit = 4): DueRow[] {
  const inPicks = new Set(picks.map((p) => p.id));
  // 출생 뒤 기한은 아기·임신이 있으면 '신청할 때 확인'이어도 둔다 (dueRows 가 아기·임신일 때만 남김)
  const officeDue = office.filter((p) => inPicks.has(p.id) || (p.due?.kind === "after" && BIRTH_DUE.test(p.due.text)));
  return dueRows([...picks, ...fit, ...officeDue], now, limit, { children });
}

/** 금액이 원문에 있는 사업 (순서는 넘겨준 관련도 순서 그대로, 혜택이 아닌 금액은 건너뜀) */
export function moneyRows(programs: Program[], limit = 4): ({ program: Program } & MoneyView)[] {
  const seen = new Set<string>();
  const out: ({ program: Program } & MoneyView)[] = [];
  for (const p of programs) {
    if (!p.money || seen.has(p.id)) continue;
    seen.add(p.id);
    const v = moneyView(p.money, p.name);
    if (!v) continue;
    out.push({ program: p, ...v });
    if (out.length >= limit) break;
  }
  return out;
}

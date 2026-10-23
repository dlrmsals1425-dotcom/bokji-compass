/**
 * 결과 화면 문구 도우미: 판정 이유를 사람 말 한 줄로, 신청 방법 원문을 '어디서·어떻게·무엇을 가져가서'로 요약한다.
 * 원문에 신청 정보가 없으면 주민센터·☎129 일반 안내로 대신한다 (상세 화면의 대체 안내와 같은 원칙).
 */
import type { Program } from "../data/types";
import { normalizeText } from "../data/text";
import type { Evaluation, Tier } from "../engine/types";

const clean = (s: string) =>
  s
    .replace(/\s+—\s.*$/, "")
    .replace(/\s*\(입력:.*\)$/, "")
    .replace(/\s*\((?:원문 확인|무료 상담)\)/g, "")
    .replace(/관련 조건/g, "")
    .trim();

/** 맞은 조건 (최대 n개, 조건 이름만) */
export function metReasons(ev: Evaluation, n = 3): string[] {
  return ev.reasons.filter((r) => r.kind === "met").slice(0, n).map((r) => clean(r.text));
}

/** 더 확인할 조건 한 가지 (가능성 있음·확인 필요일 때) */
export function toCheck(ev: Evaluation): string | undefined {
  const r = ev.reasons.find((x) => x.kind === "unknown") ?? ev.reasons.find((x) => x.kind === "note");
  if (!r) return undefined;
  return clean(r.text.replace(/^(추가로 확인할 조건|상담으로 판단하는 조건):\s*/, ""));
}

/** 맞지 않는 조건 한 가지 */
export function unmetReason(ev: Evaluation): string | undefined {
  const r = ev.reasons.find((x) => x.kind === "unmet");
  return r ? clean(r.text) : undefined;
}

/** 판정 단계의 뜻 (공식 용어 옆에 붙이는 사람 말) */
export const TIER_PLAIN: Record<Tier, string> = {
  eligible: "입력하신 내용이 공개된 지원 조건에 맞습니다.",
  likely: "조건에 맞을 수 있습니다. 신청할 때 한두 가지를 더 확인합니다.",
  check: "공개된 정보만으로는 판단하기 어렵습니다. 담당 기관에 물어보세요.",
  ineligible: "입력하신 내용과 지원 조건이 맞지 않습니다.",
};

const shorten = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

/** 카드·목록용 판단 이유 한 문장 */
export function reasonSentence(ev: Evaluation): string {
  const met = metReasons(ev, 3).map((x) => shorten(x, 40));
  if (ev.tier === "ineligible") {
    const u = unmetReason(ev);
    return u ? `맞지 않는 조건: ${shorten(u, 60)}` : ev.headline;
  }
  const check = ev.tier !== "eligible" ? toCheck(ev) : undefined;
  const parts: string[] = [];
  if (met.length) parts.push(`${met.join(", ")}에 해당합니다.`);
  if (check) parts.push(`확인할 것: ${shorten(check, 56)}`);
  return parts.join(" ") || ev.headline;
}

export type Channel = "visit" | "online" | "phone";
export const CHANNEL_LABEL: Record<Channel, string> = { visit: "방문", online: "온라인", phone: "전화" };

export interface HowTo {
  channels: Channel[];
  /** 신청하러 갈 곳 */
  place: string;
  /** 전화 문의 (첫 줄) */
  phone?: string;
  /** 가져갈 것 (짧게 최대 4개) */
  bring: string[];
  /** 원문에 신청 정보가 없어 일반 안내로 대신했는지 */
  fallback: boolean;
  /** 다른 시·도 지방 공사를 뺀 담당기관 (지역에 맞게 바꾼 경우만) */
  agency?: string;
}

const CENTER = "주소지 행정복지센터(주민센터)";
const CENTER_RE = /(행정복지센터|주민센터|읍[･·ㆍ]?\s*면[･·ㆍ]?\s*동|(?:읍|면|동|읍[･·ㆍ,]?\s*면)\s*사무소)/;
/** 원문 신청 방법에 자주 나오는 창구 (QA 1차 H3: 원문이 다른 곳을 가리키는데 주민센터로 바뀌던 문제) */
const KNOWN_PLACES: [RegExp, string][] = [
  [/건강\s*보험\s*공단|건보\s*공단/, "국민건강보험공단 지사"],
  [/국민\s*연금\s*공단/, "국민연금공단 지사"],
  [/보훈\s*(?:지\s*\(?\s*방\s*\)?\s*)?청|보훈\s*지청/, "관할 보훈(지)청"],
  [/고용\s*(?:복지\s*(?:\+|플러스)?\s*)?센터/, "가까운 고용센터"],
  [/법률\s*구조\s*공단/, "대한법률구조공단"],
  [/근로\s*복지\s*공단/, "근로복지공단"],
  [/서민\s*금융\s*진흥원|서민금융\s*통합\s*지원\s*센터/, "서민금융통합지원센터"],
  [/(?:수탁|취급)\s*은행[^.。\n]{0,16}?\)|(?:수탁|취급)\s*은행/, "수탁은행 창구"],
  [/(?:LH|한국\s*토지\s*주택\s*공사)/, "LH(한국토지주택공사)"],
];
/** 그 밖의 기관 이름 (공단·재단·진흥원·공사·협회) — 상담·콜센터는 빼고 */
const ORG_RE = /([가-힣A-Za-z]{2,18}(?:공단|재단|진흥원|공사|협회))/;
/** 이름으로 정해지는 창구 (원문에 신청 방법이 비어 있을 때) */
const BY_NAME: [RegExp, string, string][] = [
  [/장기\s*요양/, "국민건강보험공단 지사", "국민건강보험공단 1577-1000"],
  [/국민\s*연금/, "국민연금공단 지사", "국민연금공단 1355"],
];

/** 신청하러 갈 곳 (원문 신청 방법 → 접수기관 → 문의처 순, 모르면 '원문에 적힌 곳') */
export function placeOf(p: Pick<Program, "name" | "applyMethod" | "provider" | "contact" | "applyUrl" | "applyPlace">, channels: Channel[] = []): string {
  // 수동 보강한 창구가 있으면 그대로 (QA 2차 N4: 실업급여 → 고용센터 등)
  if (p.applyPlace) return p.applyPlace;
  const apply = (p.applyMethod ?? "").replace(/\s+/g, " ").trim();
  if (/(신청\s*(?:이|은)?\s*없이|별도\s*(?:신청|가입)\s*(?:사항|절차)?\s*(?:없|불필요|불요)|신청\s*불필요|직접\s*신청하지\s*않아도|자동(?:적)?으로\s*(?:제공|지급|지원))/.test(apply)) {
    const c = (p.contact ?? "").split(/\n/)[0]?.split(/☎/)[0]?.trim();
    return c && c.length < 24 ? `따로 신청하지 않아도 돼요 (문의: ${c})` : "따로 신청하지 않아도 돼요";
  }
  if (/(보건소|보건\s*의료원|보건\s*지소)/.test(apply) && !CENTER_RE.test(apply)) return /보건\s*의료원/.test(apply) ? "보건의료원(보건소)" : "가까운 보건소";
  const known = KNOWN_PLACES.find(([re]) => re.test(apply))?.[1];
  const org = known ?? ORG_RE.exec(apply.replace(/[가-힣A-Za-z]*(?:콜\s*센터|상담\s*센터)/g, " "))?.[1];
  if (CENTER_RE.test(apply)) return known ? `${CENTER} 또는 ${known}` : /보건소/.test(apply) ? `${CENTER} 또는 보건소` : CENTER;
  const visit = channels.includes("visit");
  if (!visit && channels.includes("online") && (apply || p.applyUrl)) return org ? `온라인 신청 (${org})` : "온라인 신청";
  if (org) return org;
  const hall = /(시청|군청|구청|시·군·구청|시군구청|도청|시군구\s*:|해당\s*(?:시군|시·군|구·군|시|군|구)\s)/.exec(apply);
  if (hall) return hall[1] === "도청" ? "도청 담당 부서" : "시·군·구청 담당 부서";
  const welfare = /([가-힣]{2,14}(?:복지관|복지센터|지원센터|가족센터))/.exec(apply.replace(/(?:콜|상담)\s*센터/g, " "));
  if (welfare) return welfare[1];
  if (/(유치원|어린이집|학교)(?:에서|에\s*(?:방문|신청)|\s*(?:방문|통해|통하여))/.test(apply)) return "다니는 학교·유치원·어린이집";
  if (p.provider && p.provider !== "주민센터" && p.provider.length < 24) return p.provider;
  if (p.provider === "주민센터") return CENTER;
  const contactOrg = (p.contact ?? "").split(/\n/)[0]?.split(/☎/)[0]?.trim();
  if (apply) return contactOrg && contactOrg.length < 24 ? `원문에 적힌 곳 (문의: ${contactOrg})` : "원문에 적힌 곳 (문의 ☎129)";
  const byName = BY_NAME.find(([re]) => re.test(p.name));
  if (byName) return byName[1];
  // 원문에 신청 정보가 전혀 없을 때: 주민센터가 접수하는 공공부조·돌봄·수당 계열만 주민센터, 그 밖에는 담당 기관 (QA 2차 N4)
  return CENTER_OK.test(p.name) ? CENTER : "담당 기관에 문의 (☎129 안내)";
}
/** 읍·면·동 주민센터가 신청을 받는 계열 (원문 신청방법이 비어 있을 때만 쓰는 기본값) */
const CENTER_OK = /((?:생계|의료|주거|교육|해산|장제)\s*급여|수급|차상위|기초\s*생활|기초\s*연금|긴급\s*(?:복지|지원)|자활|희망\s*저축|바우처|수당|돌봄|장애인\s*등록|장애\s*정도|급식|보육료|드림\s*스타트|디딤\s*씨앗|응급\s*안전|고독사|사례\s*관리|찾아가는|요금\s*감면|주간\s*활동|방과\s*후\s*활동|자립\s*수당|정착금|경로당|장례)/;

/** 한 시·도만 맡는 지방 공사 (QA 3차 R6: 남양주 사용자에게 장기전세 '문의: 서울주택도시공사') */
const REGIONAL_ORGS: [RegExp, string][] = [
  [/서울\s*주택\s*도시\s*공사|SH\s*(?:공사|콜센터)|i-sh\.co\.kr/i, "11000"],
  [/경기\s*주택\s*도시\s*공사|경기\s*도시\s*공사|GH\s*(?:공사|콜센터)|gh\.or\.kr/i, "41000"],
  [/부산\s*도시\s*공사/, "26000"],
  [/대구\s*도시\s*(?:개발\s*)?공사/, "27000"],
  [/인천\s*도시\s*공사|iH\s*공사|ih\.co\.kr/i, "28000"],
  // 광주광역시는 2026-07-01 전남광주통합특별시(12000)로 통합 — 옛 이름의 공사도 통합시로
  [/광주\s*도시\s*공사|전남광주통합특별시\s*도시\s*공사|전남\s*개발\s*공사/, "12000"],
  [/대전\s*도시\s*공사/, "30000"],
  [/울산\s*도시\s*공사/, "31000"],
  // (전국 확대 ②) 원문 문의처에 나오는 도 단위 개발공사
  [/충북\s*개발\s*공사/, "43000"],
  [/경남\s*개발\s*공사/, "48000"],
  [/제주\s*개발\s*공사/, "50000"],
  [/전북\s*개발\s*공사/, "52000"],
];
const regionalSido = (t: string | undefined) => (t ? REGIONAL_ORGS.find(([re]) => re.test(t))?.[1] : undefined);
/** 다른 시·도의 지방 공사가 문의처면, 접수기관 목록에서 전국 기관(예: LH)으로 바꾼다 */
function localizeContact(p: Program, sido?: string | null): Program {
  if (!sido) return p;
  const first = (p.contact ?? "").split(/\n/)[0];
  const cs = regionalSido(first) ?? regionalSido(p.applyUrl);
  if (!cs || cs === sido.slice(0, 2) + "000") return p;
  const entries = (p.provider ?? "").split(/\s*[,/]\s*/).map((e) => e.split(/[;:]/).map((x) => x.trim()));
  const alt = entries.find(([name, phone]) => name && phone && /\d{3,4}-\d{4}/.test(phone) && !regionalSido(name) && !/콜\s*센터|홈페이지/.test(name));
  const contact = alt ? `${alt[0]} ☎ ${alt[1]}` : undefined;
  const agencies = [...new Set(entries.map(([name]) => name).filter((n) => n && !regionalSido(n) && !/콜\s*센터|홈페이지/.test(n)))];
  const altPlace = alt ? KNOWN_PLACES.find(([re]) => re.test(alt[0]))?.[1] ?? alt[0] : undefined;
  return { ...p, contact, provider: agencies.length ? agencies.join(", ") : alt?.[0], applyUrl: regionalSido(p.applyUrl) ? undefined : p.applyUrl, applyPlace: p.applyPlace ?? (altPlace ? `${altPlace} (사는 지역 공고 확인)` : "사는 지역 주택 공급 기관 공고 확인") };
}

export function howTo(detail: Program | undefined | null, lead: Program, sido?: string | null): HowTo {
  const p = localizeContact(detail ?? lead, sido);
  const apply = (p.applyMethod ?? "").replace(/\s+/g, " ").trim();
  const contact = (p.contact ?? "").split(/\n/)[0]?.replace(/☎\s*/g, "").trim() || undefined;
  const channels: Channel[] = [];
  if (/(행정복지센터|주민센터|읍[･·ㆍ]?\s*면[･·ㆍ]?\s*동|보건소|방문|창구|지사|지청|은행|센터)/.test(apply.replace(/(?:콜|상담)\s*센터/g, " "))) channels.push("visit");
  if (/(온라인|복지로|정부24|고용24|홈페이지|누리집|인터넷|https?:|www\.|플랫폼|앱|어플)/.test(apply) || p.applyUrl) channels.push("online");
  if (/(전화|유선)/.test(apply) || contact) channels.push("phone");
  const byName = BY_NAME.find(([re]) => re.test(p.name));
  const fallback = !apply && !contact && !p.applyUrl;
  if (fallback) channels.push("visit", "phone");
  return {
    channels: [...new Set(channels)],
    place: placeOf(p, channels),
    phone: contact ?? (fallback ? (byName?.[2] ?? "보건복지상담센터 129") : undefined),
    bring: parseDocs(p.documents, p.name),
    fallback,
    agency: p !== (detail ?? lead) ? p.provider : undefined,
  };
}

/** 구비 서류 원문 → 짧은 항목 최대 max개 (카드는 4개, 준비물 한 장은 전부) */
export function parseDocs(s?: string, name?: string, max = 4): string[] {
  if (!s) return [];
  // (QA 8차) 정부24 '본인 확인 필요' 서류(예: 주민등록등본 또는 초본)도 원문 서류라 뒤에 붙인다 — 빠뜨리면 준비물 요약을 믿고 신청할 때 빠짐
  const self = /본인 확인 필요:\s*([^\n]*)/.exec(s)?.[1];
  const main = parseDocsMain(s, name, max);
  const extra = self ? parseDocsMain(self, name, max).filter((x) => !main.includes(x)) : [];
  return [...main, ...extra].slice(0, max);
}
function parseDocsMain(s: string, name: string | undefined, max: number): string[] {
  // 괄호 안 쉼표로는 나누지 않는다 (QA 3차 L1: '임신 여부 확인 서류(임신확인서, 임신진단서 …)'의 예시가 따로 '가져갈 것'이 되던 문제)
  const t = s
    .replace(/본인 확인 필요:[\s\S]*$/, "")
    .replace(/담당 공무원이 확인:[\s\S]*$/, "")
    .replace(/관련 서식·안내:[\s\S]*$/, "")
    .replace(/\(([^()]*)\)/g, (_m, inner: string) => `(${inner.replace(/[,·]/g, "\u2063")})`);
  const parts = t
    .split(/\s*(?:○|ㅇ|(?<![A-Za-z])-(?![A-Za-z])|·|•|\n|,)\s*/)
    .map((x) => x.replace(/[*※].*$/, "").replace(/^\d+[.)]\s*/, "").replace(/^\(\s*필수\s*\)\s*/, "").trim())
    .map((x) => x.replace(/\u2063/g, ","))
    // 괄호 속 대체 서류가 길면 괄호를 줄인다 (QA 8차: '면접확인서(또는 면접확인서 대체서약서, 면접증빙서류)'가 길어서 빠지던 문제)
    .map((x) => (x.length > 28 ? x.replace(/^([^()]{2,20})\((?:또는|혹은)[^()]*\)$/, "$1(또는 대체 서류)") : x))
    // 여러 대상 중 임신부만 내는 서류는 빼고 (예: 인플루엔자 접종 — 어르신 카드에 '임신진단서'), 임신·출산 사업이면 그대로
    .filter((x) => !name || /(임신|임산부|산모|출산|태아|난임)/.test(name) || !/(임신|산모|임산부)/.test(x))
    .filter((x) => x && !/^(해당\s*없음|본인\s*신청|대리\s*신청|없음)$/.test(x) && x.length <= 28);
  return [...new Set(parts)].slice(0, max);
}

/** 긴 원문에서 첫 문장만 짧게 */
export function firstLine(s: string | undefined, max = 60): string {
  if (!s) return "";
  const t = normalizeText(s).replace(/^[\s○●□■◆ㅇ\-·•*]+/, "").split(/\n|(?<=다\.)\s|(?<=요\.)\s/)[0].replace(/\s+/g, " ").trim();
  return shorten(t, max);
}

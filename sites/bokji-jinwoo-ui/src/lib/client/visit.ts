/**
 * 방문처별 준비물 한 장: 담은 혜택을 '신청하러 갈 곳'별로 묶고, 가져갈 것을 합쳐 한 번씩만 적는다.
 * 기기 안에서만 만든다 (상황·입력값은 넣지 않음). 원문에 구비서류가 없으면 지어내지 않고 '창구에 문의'.
 */
import type { Program } from "../data/types";
import { firstLine, howTo } from "./howto";
import type { Bucket } from "./v2";

export interface SheetEntry {
  /** 상세 묶음 (신청방법·구비서류·문의) — 아직 못 받았으면 목록 번들의 사업 */
  program: Program;
  bucket: Bucket;
}
export interface SheetProgram {
  id: string;
  name: string;
  bucket: Bucket;
  /** 같은 곳 말고도 신청할 수 있는 곳 (예: '국민연금공단 지사', '온라인: 복지로') */
  also: string[];
  /** listed 원문에 서류 있음 · none 원문에 '해당 없음' · missing 원문에 서류 정보 없음 */
  docs: "listed" | "none" | "missing";
  /** 한 장에 다 못 적은 서류 수 (상세 페이지·창구에서 확인) */
  more: number;
  /** 담당자 확인용 (원문에 있는 것만) */
  staff: StaffInfo;
}
/**
 * 담당자 확인용 (2026-10-16 소유자): 창구 담당자가 이 한 장만 보고 무엇을 신청하러 왔는지 알고 원문을 찾아볼 수 있게.
 * 원천 서비스 번호·원문 요약 첫 문장·지원대상 첫 줄·근거 법령·소관(복지로는 담당 부서까지). 원문에 없으면 빈 칸 — 지어내지 않는다.
 */
export interface StaffInfo {
  /** '정부24 서비스 SSE000000170' · '복지로 서비스 WLF00005606' (보건복지부 게시판 내부 번호는 쓰지 않음) */
  ref: string | null;
  what: string;
  target: string;
  /** '근거 기초연금법(제3조) · 소관 보건복지부' */
  basis: string;
}
const REF_SOURCES: [string, string][] = [
  ["gov24", "정부24"],
  ["bokjiro", "복지로"],
];
export function staffInfo(p: Pick<Program, "summary" | "target" | "laws" | "owner" | "sources">): StaffInfo {
  let ref: string | null = null;
  for (const [src, label] of REF_SOURCES) {
    const s = p.sources?.find((x) => x.source === src && x.id);
    if (s) {
      ref = `${label} 서비스 ${s.id}`;
      break;
    }
  }
  const what = firstLine(p.summary, 70);
  const target = firstLine(p.target, 70);
  const laws = (p.laws ?? []).map((l) => l.trim()).filter(Boolean).slice(0, 2);
  const owner = p.owner && !/전국\s*공통|^중앙부처$/.test(p.owner) ? p.owner.trim() : "";
  const basis = [laws.length ? `근거 ${laws.join(", ")}` : "", owner ? `소관 ${owner}` : ""].filter(Boolean).join(" · ");
  return { ref, what, target: target === what ? "" : target, basis };
}
export interface SheetPlace {
  key: string;
  label: string;
  programs: SheetProgram[];
  /** 합친 가져갈 것 (많이 필요한 것부터) */
  bring: { item: string; for: string[] }[];
  /** 해당하는 분만 가져갈 것 */
  cond: { item: string; for: string[] }[];
  /** 가족이 대신 신청할 때 */
  proxy: string[];
  /** 원문에 첨부된 신청 서식 (파일 이름에서, 창구에도 비치) */
  forms: { item: string; for: string[] }[];
  /** 한 장에 다 못 적은 서류 수 (가져갈 것·해당하는 분만) */
  trimmed: number;
  /** 문의 전화 (중복 없이) */
  phones: { phone: string; for: string[] }[];
}

const CENTER_LABEL = "주소지 행정복지센터(주민센터)";
/** 묶는 곳의 순서 (주민센터 → 공단·고용센터·보건소 → 그 밖의 기관 → 온라인 → 문의 → 신청 필요 없음) */
const PLACE_ORDER = [
  "center",
  "nps",
  "nhis",
  "work",
  "health",
  "mpva",
  "other",
  "online",
  "agency",
  "none",
];

/** 온라인 신청처 이름 (원문 신청방법·신청 링크) */
export function onlineSite(
  p: Pick<Program, "applyMethod" | "applyUrl">,
): string | null {
  const t = `${p.applyMethod ?? ""} ${p.applyUrl ?? ""}`;
  if (/복지로|bokjiro/i.test(t)) return "복지로";
  if (/정부\s*24|gov\.kr/i.test(t)) return "정부24";
  if (/홈택스|hometax/i.test(t)) return "홈택스";
  if (/고용\s*24|work24|워크넷|work\.go\.kr/i.test(t)) return "고용24";
  if (p.applyUrl) {
    try {
      return new URL(p.applyUrl).hostname.replace(/^www\./, "");
    } catch {}
  }
  return null;
}

/** howTo().place → 묶음 열쇠·이름 (+ '또는'으로 함께 적힌 다른 곳) */
export function placeGroup(place: string): {
  key: string;
  label: string;
  also?: string;
} {
  if (/따로 신청하지 않아도/.test(place))
    return { key: "none", label: "따로 신청하지 않아도 되는 것" };
  if (/행정복지센터\(주민센터\)/.test(place)) {
    const also = place
      .split(/\s+또는\s+/)
      .slice(1)
      .join(", ")
      .replace(/\s*\(.*$/, "")
      .trim();
    return { key: "center", label: CENTER_LABEL, also: also || undefined };
  }
  if (/^온라인 신청/.test(place))
    return { key: "online", label: "온라인 신청" };
  if (/국민연금공단/.test(place))
    return { key: "nps", label: "국민연금공단 지사" };
  if (/건강보험공단/.test(place))
    return { key: "nhis", label: "국민건강보험공단 지사" };
  if (/고용센터/.test(place)) return { key: "work", label: "가까운 고용센터" };
  if (/보건소|보건의료원/.test(place))
    return { key: "health", label: "가까운 보건소" };
  if (/보훈/.test(place)) return { key: "mpva", label: "관할 보훈(지)청" };
  if (/^원문에 적힌 곳|^담당 기관에 문의/.test(place))
    return { key: "agency", label: "담당 기관에 먼저 문의" };
  const label = place.replace(/\s*\(사는 지역 공고 확인\)$/, "").trim();
  return { key: `other:${label}`, label };
}

/** 같은 서류를 한 번만 적으려고 이름을 맞춘다 */
export function canonicalDoc(s: string): { key: string; item: string } {
  const t = s.replace(/\s+/g, " ").trim();
  const rules: [RegExp, string][] = [
    [
      /^(?:본인|신청자의?|신청인의?)?\s*(?:신분증|주민\s*등록증|신분\s*확인)/,
      "신분증",
    ],
    [/통장\s*사본|계좌\s*사본|통장/, "통장 사본"],
    [
      /사회\s*복지\s*서비스\s*및\s*급여\s*제공.*신청서|사회\s*보장\s*급여.*신청/,
      "사회보장급여 신청서",
    ],
    [/소득\s*[·ㆍ,]?\s*재산\s*신고서/, "소득·재산 신고서"],
    [/금융\s*정보.*동의서/, "금융정보 제공 동의서"],
    [/개인\s*정보.*동의서/, "개인정보 수집·이용 동의서"],
    [/가족\s*관계\s*증명(?:서|원)/, "가족관계증명서"],
    [/주민\s*등록\s*등\s*\(\s*초\s*\)\s*본|주민\s*등록\s*등본\s*(?:또는|혹은|,|\/)\s*(?:주민\s*등록\s*)?초본/, "주민등록등본 또는 초본"],
    [/주민\s*등록\s*등본/, "주민등록등본"],
    [/임대차\s*계약서/, "임대차계약서"],
  ];
  for (const [re, item] of rules) if (re.test(t)) return { key: item, item };
  return { key: t.replace(/[\s()·,]/g, ""), item: t };
}

export interface SheetDocs {
  /** 모두 가져갈 것 */
  core: string[];
  /** 해당하는 분만 (예: 전·월세계약서, 장애인 증명서) */
  cond: string[];
  /** 가족이 대신 신청할 때 (위임장·대리인 신분증) */
  proxy: string[];
  /** 원문 '관련 서식' 파일 중 신청서·신고서·동의서 (확장자 뺌) */
  forms: string[];
  /** listed 원문에 서류 있음 · none 원문에 '해당 없음·구비서류 없음' · missing 원문에 서류 정보 없음 */
  state: "listed" | "none" | "missing";
  /** 너무 많아 한 장에 못 적은 서류 수 */
  more: number;
}
const DOC_CAP = 6;
const PLACE_BRING_CAP = 10;
const PLACE_COND_CAP = 8;
/** '관련 서식·안내: a.pdf, 사회보장급여 신청(변경)서.hwpx' → 신청 서식 이름만 */
export function formNames(documents?: string): string[] {
  const m = /관련 서식·안내:\s*([\s\S]*)$/.exec(documents ?? "");
  if (!m) return [];
  const out: string[] = [];
  for (const f of m[1].split(/\s*,\s*/)) {
    const n = f
      .replace(/\.(hwpx?|pdf|docx?|xlsx?|zip|jpg|png)\s*$/i, "")
      .replace(/^[\d\s.\-_[\]()]+/, "")
      .replace(/[_\s]+/g, " ")
      .trim();
    if (
      !n ||
      n.length > 30 ||
      /안내|지침|사업|매뉴얼|모음|공고|홍보|리플렛|Q&A|FAQ/i.test(n)
    )
      continue;
    if (
      !/(신청|신고|동의|위임|확인)[^ ]*서$|신청서|동의서|신고서|위임장/.test(n)
    )
      continue;
    const item = canonicalDoc(n).item;
    if (!out.includes(item)) out.push(item);
  }
  return out.slice(0, 3);
}
/** 서류 이름으로 끝나는지 (문장·안내는 빼려고) */
const DOC_NOUN =
  /(서|증|위임장|본|사본|증명|확인|계약|통장|신분|사진|카드|명세|영수증|자료|서류|진단|소견|수첩|판결문|공고문|등본|초본|원)$/;
const COND_HEAD =
  /(선택\s*서류|해당자|해당하는\s*경우|경우에\s*따라|불일치|필요\s*시|필요한\s*경우)/;

/** 원문 구비서류 → 모두 가져갈 것 / 해당하는 분만 / 대리 신청할 때 (지어내지 않음, 문장·안내는 뺌) */
export function sheetDocs(documents?: string, name = ""): SheetDocs {
  const pregnancyProgram = /(임신|임산부|산모|출산|태아|난임)/.test(name);
  const forms = formNames(documents);
  const raw = (documents ?? "")
    .replace(/관련 서식·안내:[\s\S]*$/, "")
    .replace(/본인 확인 필요:[\s\S]*$/, "")
    .replace(/담당 공무원이 확인:[\s\S]*$/, "")
    .trim();
  // (QA 8차) 정부24 '본인 확인 필요' 서류도 원문에 적힌 서류라 '모두 가져갈 것'에 함께 적는다 (빼면 '원문에 없어요'가 되던 문제)
  const selfLine = /본인 확인 필요:\s*([^\n]*)/.exec(documents ?? "")?.[1]?.trim();
  const selfDocs = selfLine && !/^해당\s*없음$/.test(selfLine) ? sheetDocs(selfLine, name) : null;
  const selfItems = selfDocs ? [...selfDocs.core, ...selfDocs.cond] : [];
  if (!raw)
    return { core: selfItems, cond: [], proxy: [], forms, state: selfItems.length ? "listed" : "missing", more: 0 };
  if (/^해당\s*없음$/.test(raw))
    return { core: selfItems, cond: [], proxy: [], forms, state: selfItems.length ? "listed" : "none", more: 0 };
  const core: string[] = [];
  const cond: string[] = [];
  const proxy: string[] = [];
  let condMode = false;
  let noneSaid = false;
  const lines = raw
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^※/.test(l));
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // '- 임대차계약서' 다음 줄이 '…하는 경우 …'면 해당하는 분만 내는 서류
    const nextIsCase = /^[-·•]/.test(line) && /경우/.test(lines[i + 1] ?? "");
    // 머리 줄: '○ 필수서류' · '○ 선택서류' · '3. 선택서류 : …'
    if (/^[○ㅇ●□■]\s*/.test(line) || /^\d+[.)]\s*선택/.test(line)) {
      if (/필수\s*서류/.test(line)) condMode = false;
      if (COND_HEAD.test(line)) condMode = true;
      if (
        /^[○ㅇ●□■]\s*(?:필수\s*서류|선택\s*서류|방문|온라인|우편|팩스)\s*$/.test(
          line,
        )
      )
        continue;
    }
    // '(필요시 추가서류)' 같은 머리 줄 → 이후는 해당하는 분만, '(필수) …' → 모두
    if (/^\(\s*(?:필요\s*시|선택|해당자|해당\s*시)[^)]*\)$/.test(line)) {
      condMode = true;
      continue;
    }
    if (/^[○ㅇ●□■\-·•\s]*\(\s*필수\s*\)/.test(line)) {
      condMode = false;
      line = line.replace(/^[○ㅇ●□■\-·•\s]*\(\s*필수\s*\)\s*/, "");
    }
    // '- 가구단위 증빙서류: 가족관계증명원, …' · '④ 보호 종료된 자립 준비 청년: …' → 이름표 뒤만
    // (공통·필수가 아닌 대상별 이름표면 해당하는 분만)
    let labelCond = false;
    const lab = /^[-·•‒–\s]*(?:[①-⑳]\s*)?([^:,()]{1,24}?)\s*:\s*(?=\S)/.exec(
      line,
    );
    if (lab) {
      if (!/공통|필수|서류|자료|증빙/.test(lab[1])) labelCond = true;
      if (/필수/.test(lab[1])) condMode = false;
      line = line.slice(lab[0].length);
    }
    if (/구비\s*서류\s*없음|제출\s*서류는\s*없|^-?\s*없음$/.test(line)) {
      if (!condMode) noneSaid = true;
      continue;
    }
    const isProxy = /대리|위임/.test(line);
    let lineCond =
      condMode ||
      labelCond ||
      nextIsCase ||
      /\((?:해당자|해당\s*시|해당자에\s*한함|제출\s*대상자에\s*한함|필요\s*시)[^)]*\)\s*$/.test(
        line,
      );
    // '…경우, 해당 전·월세계약서' → 해당하는 분만 + 서류 이름만
    const caseM = /경우[,\s]*(?:해당\s*)?(.+)$/.exec(line);
    if (caseM && !isProxy) {
      line = caseM[1];
      lineCond = true;
    }
    if (/^\d+[.)]\s*선택\s*서류|선택\s*서류\s*:/.test(line)) {
      condMode = true;
      continue;
    }
    // 괄호 밖 쉼표로만 나눔 ('전·월세'의 가운뎃점은 나누지 않음)
    const parts = line
      .replace(
        /\(([^()]*)\)/g,
        (_m, x: string) => `(${x.replace(/,/g, "\u2063")})`,
      )
      .split(/\s*,\s*/);
    // '개인정보 수집, 이용 및 제공 동의서'처럼 서류 이름 안의 쉼표는 다시 붙이고, 'A서 및 B서'는 나눈다
    const merged: string[] = [];
    for (const part of parts) {
      const prev = merged[merged.length - 1];
      if (
        prev !== undefined &&
        !DOC_NOUN.test(
          prev.replace(/\s*\([^)]*\)$/, "").replace(/\s*(?:등|제출)$/, ""),
        ) &&
        !/^[-○ㅇ·•]/.test(part)
      )
        merged[merged.length - 1] = `${prev}, ${part}`;
      else merged.push(part);
    }
    const items = merged.flatMap((x) => {
      const m = /^(.{2,20}?(?:서|증|본))\s+및\s+(.+)$/.exec(x);
      return m && DOC_NOUN.test(m[2]) ? [m[1], m[2]] : [x];
    });
    for (let it of items) {
      it = it
        .replace(/\u2063/g, ",")
        .replace(/^[-○ㅇ·•*‒–\s]+/, "")
        .replace(/^[①-⑳]\s*/, "")
        .replace(/^[*):\s]+/, "")
        .replace(/^\d+[.)]\s*/, "")
        .replace(/^\([^)]*\)\s*/, "")
        .replace(/\[[^\]]*\]/g, "")
        .replace(/^(?:는|은|또는|및)\s+/, "")
        .trim();
      let c = lineCond;
      it = it.replace(/^대리\s*신청(?:의|하는)?\s*경우\s*|^대리\s*신청\s*시\s*/, "");
      if (/^(?:필요하면|필요\s*시|해당\s*시)\s*/.test(it)) {
        c = true;
        it = it.replace(/^(?:필요하면|필요\s*시|해당\s*시)\s*/, "");
      }
      // 서류 이름이 아닌 안내 ('공고문 확인', '공통서류', '신청인 제출 서류', '기타 …')
      if (
        /^(?:공고문|공통\s*서류|신청인\s*제출\s*서류|신청인\s*미제출|공무원\s*확인|기타|추가\s*서류)|(?:추가\s*서류|제출\s*서류|필요\s*서류)$/.test(
          it,
        )
      )
        continue;
      if (
        /\((?:해당자|해당\s*시|해당자에\s*한함|제출\s*대상자에\s*한함|필요\s*시)[^)]*\)/.test(
          it,
        )
      )
        c = true;
      it = it
        .replace(
          /\s*\((?:해당자|해당\s*시|해당자에\s*한함|제출\s*대상자에\s*한함|필요\s*시)[^)]*\)/g,
          "",
        )
        .replace(/\s*등$/, "")
        .replace(/\s*제출$/, "")
        .trim();
      // 이름만으로는 무엇인지 모르는 것 ('확인서', '관련 추천서', '관련 증빙자료')
      if (
        /^(?:관련\s*)?(?:추천서|확인서|증빙\s*자료|증빙\s*서류|서류|자료)$|^관련\s|관련\s*증빙/.test(
          it,
        )
      )
        continue;
      const known = canonicalDoc(it).item !== it.replace(/\s+/g, " ").trim();
      if (
        !it ||
        (!known &&
          (it.length > 30 ||
            !DOC_NOUN.test(it.replace(/\s*\([^)]*\)$/, "")))) ||
        /안내$|면담|상담/.test(it)
      )
        continue;
      // 여러 대상 중 임신부만 내는 서류 (예: 인플루엔자 접종의 '임신확인서')
      if (!pregnancyProgram && /(임신|산모|임산부)/.test(it)) c = true;
      const list = isProxy ? proxy : c ? cond : core;
      if (!list.includes(it)) list.push(it);
    }
  }
  for (const d of selfItems) if (!core.includes(d) && !cond.includes(d)) core.push(d);
  const state =
    core.length || cond.length || proxy.length
      ? "listed"
      : noneSaid
        ? "none"
        : "missing";
  // 한 사업의 서류가 너무 많으면 앞의 것만 (나머지는 상세 페이지·창구에서 확인)
  const more =
    Math.max(0, core.length - DOC_CAP) + Math.max(0, cond.length - DOC_CAP);
  return {
    core: core.slice(0, DOC_CAP),
    cond: cond.slice(0, DOC_CAP),
    proxy: proxy.slice(0, 4),
    forms,
    state,
    more,
  };
}

export function buildVisitSheet(
  entries: SheetEntry[],
  sido?: string | null,
): SheetPlace[] {
  type Doc = { item: string; for: string[] };
  const places = new Map<
    string,
    SheetPlace & {
      bringMap: Map<string, Doc>;
      condMap: Map<string, Doc>;
      formMap: Map<string, Doc>;
      proxySet: Set<string>;
      phoneMap: Map<string, { phone: string; for: string[] }>;
    }
  >();
  const seen = new Set<string>();
  for (const { program: p, bucket } of entries) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const how = howTo(p, p, sido);
    const g = placeGroup(how.place);
    let pl = places.get(g.key);
    if (!pl) {
      pl = {
        key: g.key,
        label: g.label,
        programs: [],
        bring: [],
        cond: [],
        proxy: [],
        forms: [],
        trimmed: 0,
        phones: [],
        bringMap: new Map(),
        condMap: new Map(),
        formMap: new Map(),
        proxySet: new Set(),
        phoneMap: new Map(),
      };
      places.set(g.key, pl);
    }
    const also: string[] = [];
    if (g.also) also.push(g.also);
    const site =
      how.channels.includes("online") && g.key !== "online"
        ? onlineSite(p)
        : null;
    if (site && !also.some((a) => a.includes(site)))
      also.push(`온라인: ${site}`);
    if (g.key === "online") {
      const s = onlineSite(p);
      if (s) also.push(s);
    }
    const docs =
      g.key === "none"
        ? {
            core: [],
            cond: [],
            proxy: [],
            forms: [],
            state: "none" as const,
            more: 0,
          }
        : sheetDocs(p.documents, p.name);
    pl.programs.push({
      id: p.id,
      name: p.name,
      bucket,
      also: [...new Set(also)],
      docs: docs.state,
      more: docs.more,
      staff: staffInfo(p),
    });
    const add = (
      map: Map<string, { item: string; for: string[] }>,
      d: string,
    ) => {
      const c = canonicalDoc(d);
      const cur = map.get(c.key) ?? { item: c.item, for: [] };
      if (!cur.for.includes(p.name)) cur.for.push(p.name);
      map.set(c.key, cur);
    };
    docs.core.forEach((d) => add(pl!.bringMap, d));
    docs.cond.forEach((d) => add(pl!.condMap, d));
    docs.proxy.forEach((d) => pl!.proxySet.add(canonicalDoc(d).item));
    docs.forms.forEach((d) => add(pl!.formMap, d));
    if (how.phone) {
      const phone = how.phone.replace(/\s+/g, " ").trim();
      // 같은 번호는 한 번만 ('보건복지상담센터 129'와 '보건복지부상담센터 129')
      const num =
        /(\d{2,4}-\d{3,4}-\d{4}|\d{4}-\d{4}|(?<!\d)1\d{2,3}(?!\d))\s*$/.exec(
          phone,
        )?.[1] ?? phone;
      const cur = pl.phoneMap.get(num) ?? { phone, for: [] };
      cur.for.push(p.name);
      pl.phoneMap.set(num, cur);
    }
  }
  const out: SheetPlace[] = [...places.values()].map(
    ({ bringMap, condMap, formMap, proxySet, phoneMap, ...pl }) => {
      const bring = [...bringMap.values()].sort(
        (a, b) => b.for.length - a.for.length,
      );
      // 모두 가져갈 것에 이미 있으면 '해당하는 분만'에서 뺌
      const cond = [...condMap.entries()]
        .filter(([k]) => !bringMap.has(k))
        .map(([, v]) => v);
      return {
        ...pl,
        bring: bring.slice(0, PLACE_BRING_CAP),
        cond: cond.slice(0, PLACE_COND_CAP),
        trimmed:
          Math.max(0, bring.length - PLACE_BRING_CAP) +
          Math.max(0, cond.length - PLACE_COND_CAP),
        proxy: [...proxySet],
        // 가져갈 것에 이미 적힌 서식은 다시 적지 않음
        forms: [...formMap.entries()]
          .filter(([k]) => !bringMap.has(k) && !condMap.has(k))
          .map(([, v]) => v),
        phones: [...phoneMap.values()].slice(0, 4),
      };
    },
  );
  const rank = (k: string) => {
    const i = PLACE_ORDER.indexOf(k.startsWith("other:") ? "other" : k);
    return i < 0 ? PLACE_ORDER.length : i;
  };
  return out.sort(
    (a, b) =>
      rank(a.key) - rank(b.key) || b.programs.length - a.programs.length,
  );
}

/** 카드에 쓰는 쉬운 말 상태 (배지 대신) */
export const SHEET_STATUS: Record<Bucket, string> = {
  fit: "조건이 맞아요",
  office: "창구에서 자격 확인",
  ask: "소득 등 확인 후 결정",
  no: "조건이 맞지 않아요",
};

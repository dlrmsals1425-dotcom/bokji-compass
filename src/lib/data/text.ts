/**
 * 공공데이터 원문 글자 정리 (번들 만들 때 + 화면에 그릴 때 한 번 더).
 * - HTML 엔티티 풀기: &#13; &#10; &#xD; &amp; &lt; &gt; &quot; &nbsp; &rsquo; &#9312;(①) …
 * - 줄바꿈 통일(CR/CRLF → LF), 빈 줄은 한 줄까지만, 줄 앞뒤 공백 정리
 * - 깨진 글자: 한글·워드 문서의 기호 글꼴(Wingdings·Symbol)이 사용자 영역(U+F0xx)으로 들어온 것을 같은 모양의 보통 글자로,
 *   제어문자·소프트 하이픈·BOM·폭 없는 공백·U+FFFD는 지움
 * - 원본 API가 가운뎃점 등을 '?'로 바꿔 보낸 경우('중?고등학생')만 조심스럽게 되살림 (한글 사이 '?'·'？'·'˚' → '·', 줄 앞 '?' → '•')
 * - 글꼴에 없는 경우가 많은 가운뎃점 변형(･ ・ ⸱ ‧ ․)은 보통 가운뎃점(·)으로 — 모양만 바꾸고 뜻은 같음
 * 낱말은 바꾸지 않는다. 「」·①·※ 같은 정상 글자는 그대로 둔다.
 */

const NAMED: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  middot: "·", bull: "•", hellip: "…", ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  sbquo: "‚", bdquo: "„", laquo: "«", raquo: "»", lsaquo: "‹", rsaquo: "›", sim: "~", tilde: "~",
  rarr: "→", larr: "←", uarr: "↑", darr: "↓", harr: "↔", rArr: "⇒", lArr: "⇐", hArr: "⇔",
  times: "×", divide: "÷", plusmn: "±", le: "≤", ge: "≥", ne: "≠", deg: "°", sect: "§", para: "¶",
  copy: "©", reg: "®", trade: "™", micro: "µ", frac12: "½", frac14: "¼", frac34: "¾", sup2: "²", sup3: "³",
  prime: "′", Prime: "″", lowast: "∗", minus: "−", cent: "¢", pound: "£", yen: "¥", euro: "€", shy: "",
  zwj: "", zwnj: "", lrm: "", rlm: "",
};

/** 기호 글꼴(Wingdings) 글자 → 보통 글자. 목록에 없는 사용자 영역 글자는 지운다. */
const PUA: Record<number, string> = {
  0x2a: "✉", 0x46: "☞", 0x6c: "●", 0x6d: "○", 0x6e: "■", 0x6f: "□", 0x70: "□", 0x71: "□", 0x72: "□",
  0x73: "◆", 0x74: "◆", 0x75: "◆", 0x76: "◆", 0x77: "◆", 0x9e: "·", 0x9f: "•", 0xa0: "·", 0xa1: "○",
  0xa2: "○", 0xa7: "▪", 0xa8: "□", 0xb7: "•", 0xd8: "➢", 0xdc: "→", 0xe0: "→", 0xe8: "→", 0xf0: "→",
  0xfb: "✗", 0xfc: "✓", 0xfd: "☒", 0xfe: "☑",
};
// 0x80 ⓪, 0x81~0x89 ①~⑨
PUA[0x80] = "⓪";
for (let i = 1; i <= 9; i++) PUA[0x80 + i] = String.fromCodePoint(0x2460 + i - 1);

function decodeEntities(s: string): string {
  return s.replace(/&(#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,8});/g, (m, body: string) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (cp === 13 || cp === 10) return "\n";
      if (cp === 9 || cp === 160) return " ";
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "";
      return String.fromCodePoint(cp);
    }
    return NAMED[body] ?? m;
  });
}

const isUrl = (s: string) => /^\s*(?:https?:\/\/|www\.)\S*\s*$/i.test(s);

/** 원문 글자 정리 (낱말은 그대로) */
export function normalizeText(input: string): string {
  if (!input) return input;
  let s = input;
  // 두 번 인코딩된 것('&amp;#13;')까지
  for (let i = 0; i < 2 && /&(#\d|#x|[a-zA-Z]+;)/i.test(s); i++) s = decodeEntities(s);
  if (isUrl(s)) return s.trim();
  s = s
    .replace(/\r\n?/g, "\n")
    .replace(/[\uE000-\uF8FF]/g, (ch) => {
      const cp = ch.codePointAt(0)!;
      return cp >= 0xf000 && cp <= 0xf0ff ? (PUA[cp - 0xf000] ?? "") : "";
    })
    .replace(/\t/g, " ")
    // 제어문자(줄바꿈 빼고)·C1 제어문자·소프트 하이픈·폭 없는 공백·BOM·U+FFFD
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u200B-\u200D\u2060\uFEFF\uFFFD]/g, "")
    .replace(/[\u00A0\u2002-\u200A\u202F\u3000]/g, " ")
    // 글꼴에 없는 경우가 많은 가운뎃점 변형(･ ・ ⸱ ‧ ․ ·) → '·', 'Z 기호 점'(⦁) → '•'
    .replace(/[\uFF65\u30FB\u2E31\u2027\u2024\u0387]/g, "·")
    .replace(/\u2981/g, "•")
    // 원본 API가 '·'·글머리표를 '?'(또는 '？', '˚')로 보낸 것
    .replace(/([가-힣])[?？˚](?=[가-힣])/g, "$1·")
    .replace(/(^|\n)[ ]*\?[ ]*(?=[가-힣])/g, "$1• ")
    .replace(/([ ])\?[ ]*(?=[가-힣])/g, "$1• ")
    // 공백·빈 줄
    .replace(/[ ]{2,}/g, " ")
    .replace(/[ ]*\n[ ]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

/** JSON 안의 모든 문자열을 정리 (키는 그대로) */
export function normalizeDeep<T>(v: T): T {
  if (typeof v === "string") return normalizeText(v) as T;
  if (Array.isArray(v)) return v.map((x) => normalizeDeep(x)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = normalizeDeep(x);
    return out as T;
  }
  return v;
}

/* ---------------- 원문의 빈 자리 표시 (2026-10-22 외부 점검 P2-5·6) ---------------- */

/**
 * 법령 조항: 정부24 원문은 비어 있는 '조의'·'항'을 0으로 적는다 ('(제1조의0, 제0항)') — 없는 조항처럼 보이므로 0만 지운다.
 * 조·항이 모두 0이면 괄호째 지운다. 원문에 있는 번호는 그대로.
 */
export function tidyLaw(s: string): string {
  return s
    .replace(/(제\d+조)의0(?!\d)/g, "$1")
    .replace(/,\s*제0항/g, "")
    .replace(/\s*\(\s*제0조(?:의0)?\s*\)/g, "")
    .trim();
}

/**
 * 문의처: 원문의 '/-'(전화번호 없음 표시)를 지운다. 전화번호 안의 '-'는 그대로.
 * 부서명 자리에 같은 번호가 들어가 '1644-6621 ☎ 1644-6621'처럼 겹치면 하나만 (2026-10-23 외부 재점검)
 */
export function tidyContact(s: string): string {
  return s
    .split("\n")
    .map((line) =>
      line
        .replace(/\s*\/\s*-\s*(?=$|\/)/g, "")
        .replace(/^\s*-\s*$/, "")
        .replace(/^\s*([\d-]{4,})\s*☎\s*\1\s*$/, "☎ $1")
        .trim(),
    )
    .join("\n")
    .trim();
}

/** 관련 주제: '보육·교육'처럼 묶은 주제가 있으면 그 부분('보육'·'교육')은 다시 쓰지 않는다 (2026-10-23 외부 재점검) */
export function relatedTags(tags: readonly string[]): string[] {
  const all = [...new Set(tags.flatMap((x) => x.split("||")).map((x) => x.trim()).filter(Boolean))];
  const parts = new Set(all.filter((t) => t.includes("·")).flatMap((t) => t.split("·")));
  return all.filter((t) => t.includes("·") || !parts.has(t));
}

/** 원문 인용 한 줄: 글머리표('○' 등)를 가운뎃점으로 (맨 앞은 지움) — 원문 낱말은 그대로 (2026-10-23 외부 재점검) */
export function tidyQuote(s: string): string {
  return s
    .replace(/\s*[○●◦❍□■▪◆◇•]\s*/g, " · ")
    .replace(/:\s*·\s*/g, ": ")
    .replace(/^\s*·\s*/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

type Tidy = { laws?: string[]; contact?: string };
/** 법령·문의처만 다듬는다 (번들을 만들 때와 읽을 때 같은 결과, 멱등) */
export function tidyProgram<T extends Tidy>(p: T): T {
  const out = { ...p };
  if (Array.isArray(p.laws)) out.laws = p.laws.map(tidyLaw).filter(Boolean);
  if (typeof p.contact === "string") out.contact = tidyContact(p.contact);
  return out;
}

/* ---------------- 화면용: 문단·목록으로 나누기 ---------------- */

export type TextBlock = { kind: "p"; text: string } | { kind: "ul"; items: { marker: string; text: string; level: 1 | 2 }[] };

/** 줄 앞 글머리표 ('- ', '* ', '· '는 뒤에 띄어쓰기가 있을 때만) */
const MARKER = /^([○●◦❍□■▪◆◇•∙‣✓☑☞➢▶▸▷◎◯〇]|[-*·](?=\s))\s*/;
/** 한 줄 안에 이어 붙은 글머리표 (앞이 공백이면 새 줄로) — 가운뎃점·하이픈은 낱말 사이에도 쓰여서 제외 */
const INLINE_MARKER = /\s+(?=[○●❍□■◆☑✓]\s?\S)/g;

export function textBlocks(input: string): TextBlock[] {
  const text = normalizeText(input);
  const lines = text
    .split("\n")
    .flatMap((l) => l.replace(INLINE_MARKER, "\n").split("\n"))
    .map((l) => l.trim());
  const out: TextBlock[] = [];
  let list: Extract<TextBlock, { kind: "ul" }> | null = null;
  let first = "";
  for (const line of lines) {
    if (!line) {
      list = null;
      continue;
    }
    const m = line.match(MARKER);
    const rest = m ? line.slice(m[0].length).trim() : line;
    if (m && rest) {
      if (!list) {
        list = { kind: "ul", items: [] };
        first = m[1];
        out.push(list);
      }
      list.items.push({ marker: m[1], text: rest, level: m[1] === first ? 1 : 2 });
    } else {
      list = null;
      out.push({ kind: "p", text: line });
    }
  }
  return out;
}

export const blocksLength = (b: TextBlock[]) => b.reduce((n, x) => n + (x.kind === "p" ? x.text.length : x.items.reduce((k, i) => k + i.text.length, 0)), 0);

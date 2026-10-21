import type { ApplicationForm, FormRole } from "./forms";
import type { Program } from "./types";

/**
 * 서식 역할과 검토 후보. 맞다고 확정하거나 꼭 제출할 서류로 올리지 않는다.
 * 지역이 같고, 법령명 전체 또는 사업명 고유어가 같을 때만 후보로 낸다.
 */

const BLOCKED: ReadonlySet<FormRole> = new Set(["deleted", "administrative", "reference"]);

/** 단독으로는 사업을 가리지 못하는 말. 복합어 안의 '지원'까지 지우지는 않는다. */
const GENERIC = new Set([
  "지원", "사업", "신청", "서비스", "고양시", "경기도", "경기",
  "지급", "신청서", "지원신청서", "지급신청서", "서식", "별지", "별표",
  "관련", "위한", "대한", "관한", "및", "등", "또는", "대상", "제공", "안내",
  "조례", "시행규칙", "시행령", "법률", "규정", "규칙",
]);

const TRAILING = ["지원신청서", "지급신청서", "신청서", "지원사업", "지원금", "서비스", "지원", "사업", "신청", "지급"];

export function classifyFormRole(title: string, declaredKind: string): FormRole {
  const kind = declaredKind.trim().toLowerCase();
  const raw = title.normalize("NFKC");
  if (isDeleted(raw, kind)) return "deleted";
  if (isAnnex(raw, kind)) return "reference";
  const body = raw.replace(/^\s*\[[^\]]*\]\s*/, "").trim();
  if (body.includes("위임장")) return "delegation";
  if (/동의서|서약서/.test(body)) return "consent";
  if (isInstitution(body)) return "administrative";
  if (body.includes("신청서")) return "application";
  if (/확인서|증명서|진단서|소견서|사유서|진술서/.test(body)) return "supporting";
  return "reference";
}

export function findFormCandidates(
  program: Program,
  forms: ApplicationForm[],
): { formId: string; reason: string }[] {
  const out: { formId: string; reason: string }[] = [];
  const seen = new Set<string>();
  for (const form of forms) {
    if (seen.has(form.id)) continue;
    if (!samePlace(program, form)) continue;
    if (BLOCKED.has(form.role)) continue;
    if (BLOCKED.has(classifyFormRole(form.title, ""))) continue;
    const reason = matchReason(program, form);
    if (!reason) continue;
    seen.add(form.id);
    out.push({ formId: form.id, reason });
  }
  return out;
}

function isDeleted(raw: string, kind: string): boolean {
  if (kind === "삭제" || kind === "deleted" || kind === "폐지") return true;
  if (/[<〈]\s*삭제/.test(raw) || /삭제\s*\d{4}/.test(raw)) return true;
  const body = raw.replace(/\[[^\]]*\]/g, "").replace(/[\s<>〈〉().]/g, "");
  return body.startsWith("삭제") && body.length <= 24;
}

function isAnnex(raw: string, kind: string): boolean {
  if (kind === "별표" || kind === "reference" || kind === "annex") return true;
  return /^\s*\[?\s*별표(?:\s|\d|\]|$)/.test(raw);
}

/** 제목에 신청서가 있어도 기관·회계 서식이면 시민 신청서가 아니다. */
function isInstitution(body: string): boolean {
  const t = body.replace(/\s+/g, "");
  return /수탁운영|수리업체지정|학교용|교육지원청용|교부|정산|출납|대장|명부|통지|통보|지정서|점검표|심사기준|관리대장|관리카드|관리부/.test(t);
}

function samePlace(program: Program, form: ApplicationForm): boolean {
  const code = form.regionCode.trim();
  if (code === "national") return program.scope === "national";
  // 시·도 코드(41000). 그 도 안의 시군구 사업이나 전국 사업에는 붙이지 않는다.
  if (/^\d{2}000$/.test(code)) return program.scope === "sido" && program.region?.sido === code;
  if (!/^\d{5}$/.test(code)) return false;
  return program.scope === "sigungu" && program.region?.sigungu === code;
}

function matchReason(program: Program, form: ApplicationForm): string | null {
  const law = matchedLaw(program, form);
  if (law) return `검토 후보. 법령명이 같습니다: ${law}`;
  const words = matchedWords(program, form);
  if (!words) return null;
  return `검토 후보. 사업명 고유어가 같습니다: ${words.join(", ")}`;
}

function matchedLaw(program: Program, form: ApplicationForm): string | null {
  const want = normLaw(form.lawTitle);
  if (want.length < 4) return null;
  for (const entry of program.laws ?? []) {
    for (const part of entry.split("||")) {
      if (normLaw(part) === want) return form.lawTitle.trim();
    }
  }
  return null;
}

/** 조문 표시만 빼고 법령명 전체를 비교한다. 시행규칙과 모법은 다르게 둔다. */
function normLaw(input: string): string {
  let t = input.normalize("NFKC").toLowerCase();
  t = t.replace(/[「」『』"'“”]/g, "");
  t = t.replace(/[·ㆍ・･‧․]/g, "");
  t = t.replace(/\s+/g, "");
  for (let i = 0; i < 4; i++) {
    const next = t
      .replace(/[(（][^()（）]*제\d+조[^()（）]*[)）]$/u, "")
      .replace(/제\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?$/u, "");
    if (next === t) break;
    t = next;
  }
  return t;
}

function matchedWords(program: Program, form: ApplicationForm): string[] | null {
  const skip = regionWords(program, form);
  const tokens = dropContained(unique([
    ...contentTokens(program.name, skip),
    ...(program.aliases ?? []).flatMap((name) => contentTokens(name, skip)),
  ]));
  if (tokens.length === 0) return null;
  const formTokens = new Set(contentTokens(form.title, skip));
  const compact = compactText(form.title);
  const hits = tokens.filter((t) => formTokens.has(t) || (t.length >= 4 && compact.includes(t)));
  if (tokens.length === 1) return hits.length === 1 && hits[0].length >= 4 ? hits : null;
  if (hits.length >= 2) return hits;
  const glued = tokens.join("");
  if (glued.length >= 4 && compact.includes(glued)) return tokens;
  return null;
}

function regionWords(program: Program, form: ApplicationForm): Set<string> {
  const skip = new Set<string>();
  for (const label of [program.region?.label, form.regionLabel]) {
    if (!label) continue;
    for (const part of label.normalize("NFKC").toLowerCase().split(/[^0-9a-z가-힣]+/)) {
      if (part.length >= 2) skip.add(part);
      const stem = part.replace(/(특별자치시|특별자치도|특별시|광역시|시|도|군|구)$/u, "");
      if (stem.length >= 2) skip.add(stem);
    }
  }
  return skip;
}

function contentTokens(text: string, skip: Set<string>): string[] {
  const plain = text.normalize("NFKC").replace(/^\s*\[[^\]]*\]\s*/, "").replace(/[(（][^)）]*[)）]/g, " ");
  const out: string[] = [];
  for (const part of plain.toLowerCase().split(/[^0-9a-z가-힣]+/)) {
    const token = contentToken(part, skip);
    if (token) out.push(token);
  }
  return out;
}

function contentToken(part: string, skip: Set<string>): string | null {
  if (part.length < 2 || GENERIC.has(part) || skip.has(part) || /^\d+$/.test(part)) return null;
  let peeled = part;
  for (let i = 0; i < 4; i++) {
    const suf = TRAILING.find((s) => peeled.endsWith(s) && peeled.length > s.length);
    if (!suf) break;
    peeled = peeled.slice(0, -suf.length);
  }
  if (peeled.length < 2 || GENERIC.has(peeled) || skip.has(peeled)) return null;
  return part;
}

function compactText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/^\s*\[[^\]]*\]\s*/, "").replace(/[^0-9a-z가-힣]/g, "");
}

/** 더 긴 고유어에 이미 들어 있는 짧은 말은 두 번째 조건으로 세지 않는다. */
function dropContained(tokens: string[]): string[] {
  return tokens.filter((token) => !tokens.some((other) => other !== token && other.length > token.length && other.includes(token)));
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/**
 * 신청 기간이 끝난 사업 (운영자 피드백 2026-10-09: '경기도 어린이 건강과일 공급' 2026.8.18~9.18이 10월에 '받으실 수 있어요').
 * 원문 신청기간 문구에서 가장 늦은 날짜가 오늘(서울)보다 앞이면 '이번 접수는 끝남'. 상시·수시는 끝나지 않음, 매년·학기마다처럼 되풀이되면 목록에 두고 안내만.
 * 1차·2차처럼 여러 차례면 마지막 차례 날짜로 본다. 날짜를 못 읽으면 끝났다고 보지 않는다 (지어내지 않음).
 */
import type { Program } from "../data/types";

/** 늘 접수 — 끝났다고 보지 않음 */
const ALWAYS = /상시|연중|수시|선착순\s*마감\s*시까지/;
/** 되풀이 접수(해마다·학기마다) — 이번 접수가 끝났어도 목록에 두고 '다음 접수 확인'만 알림 (국가장학금 '2026년 2학기 1차·2차') */
const RECURRING = /매년|매월|매달|분기|반기|학기/;
const DATE = /(20\d{2})\s*(?:[.\-/]|년)\s*(\d{1,2})\s*(?:[.\-/]|월)\s*(\d{1,2})|(\d{1,2})\s*월\s*(\d{1,2})\s*일|[~∼]\s*(\d{1,2})\s*[./]\s*(\d{1,2})(?![\d.]*\s*[./]\s*\d)/g;

/** 문구에서 가장 늦은 날짜 (YYYY-MM-DD). 연도 없는 '9월 30일'·'~ 11. 30.'은 바로 앞에 나온 연도로 */
export function lastDateIn(text: string): string | null {
  let year: number | null = null;
  let best: number | null = null;
  for (const m of text.matchAll(DATE)) {
    let d: [number, number, number] | null = null;
    if (m[1]) d = [(year = Number(m[1])), Number(m[2]), Number(m[3])];
    else if (year && m[4]) d = [year, Number(m[4]), Number(m[5])];
    else if (year && m[6]) d = [year, Number(m[6]), Number(m[7])];
    if (!d || d[1] < 1 || d[1] > 12 || d[2] < 1 || d[2] > 31) continue;
    const n = d[0] * 10000 + d[1] * 100 + d[2];
    if (best === null || n > best) best = n;
  }
  if (best === null) return null;
  const s = String(best);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

const seoulToday = (now: Date) => new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

const textOf = (p: Pick<Program, "due" | "deadline">) => `${p.deadline ?? ""}\n${p.due?.quote ?? ""}`;

/** 원문에 적힌 이번 접수가 끝났으면 마지막 날짜(YYYY-MM-DD) — 되풀이 사업 포함 (카드·상세 안내용) */
export function periodEnded(p: Pick<Program, "due" | "deadline">, now: Date = new Date()): string | null {
  if (p.due?.kind !== "period") return null;
  const text = textOf(p);
  if (ALWAYS.test(text)) return null;
  const last = lastDateIn(text) ?? p.due.to ?? null;
  return last && last < seoulToday(now) ? last : null;
}

/** 이번 접수가 끝났고 되풀이 문구도 없음 → 결과 목록에서 '신청 기간이 지난 혜택'으로 뺀다 */
export function closedSince(p: Pick<Program, "due" | "deadline">, now: Date = new Date()): string | null {
  return RECURRING.test(textOf(p)) ? null : periodEnded(p, now);
}

/** '2026-09-18' → '2026년 9월 18일' */
export const dateLabel = (d: string) => `${Number(d.slice(0, 4))}년 ${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;

/** 오늘 날짜를 한국 시간으로 ('2026. 10. 23.') — 보는 기기의 시간대와 상관없이 (2026-10-23 외부 재점검: 서류 모음 날짜가 하루 어긋남) */
export const kstDate = (d: Date = new Date()) => d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });

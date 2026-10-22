/**
 * 신청 서류 모음에 담은 혜택 (이 탭에만, sessionStorage — 사업 id만, 입력한 상황은 담지 않음).
 * 먼저 확인할 5가지는 미리 담기고 '빼기'로 뺀 것만 기억, 나머지는 '담기'로 담은 것만 기억한다.
 * 결과 화면과 상세 화면이 같은 상태를 쓴다 (2026-10-23 외부 재점검: 상세 화면에 담기 단추가 없음).
 */
export const SHEET_KEY = "bn.sheet.v1";
/** 결과 화면의 먼저 확인할 5가지 (상세 화면에서 담김 여부를 알려고) */
export const SHEET_PICKS_KEY = "bn.sheet.picks.v1";

export type Marks = { add: string[]; remove: string[] };
const EMPTY: Marks = { add: [], remove: [] };

export function inSheet(id: string, m: Marks, picks: readonly string[]): boolean {
  return picks.includes(id) ? !m.remove.includes(id) : m.add.includes(id);
}

export function toggleMark(m: Marks, id: string, on: boolean, picks: readonly string[]): Marks {
  return picks.includes(id)
    ? { ...m, remove: on ? m.remove.filter((x) => x !== id) : [...m.remove.filter((x) => x !== id), id] }
    : { ...m, add: on ? [...m.add.filter((x) => x !== id), id] : m.add.filter((x) => x !== id) };
}

function read<T>(key: string, ok: (v: unknown) => v is T, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const v = JSON.parse(window.sessionStorage.getItem(key) ?? "null");
    return ok(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(v));
  } catch {}
}

const isMarks = (v: unknown): v is Marks => !!v && Array.isArray((v as Marks).add) && Array.isArray((v as Marks).remove);
const isIds = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

export const readMarks = (): Marks => read(SHEET_KEY, isMarks, EMPTY);
export const writeMarks = (m: Marks) => write(SHEET_KEY, m);
export const readPicks = (): string[] | null => read<string[] | null>(SHEET_PICKS_KEY, (v): v is string[] | null => isIds(v), null);
export const writePicks = (ids: string[]) => write(SHEET_PICKS_KEY, ids);

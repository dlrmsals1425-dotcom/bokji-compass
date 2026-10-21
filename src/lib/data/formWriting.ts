/**
 * 화면에서 작성할 수 있는 서식 등록부.
 *
 * 여기 등록한 서식만 화면 작성을 쓸 수 있다. 각 항목은 공개된 원본 파일의 바이트 수·SHA-256과,
 * 원본 표/칸/줄의 정확한 위치, 그리고 그 자리에 지금 적혀 있어야 하는 원문을 함께 들고 있다.
 * 원본이 조금이라도 다르면 비슷한 자리를 찾지 않고 작성 자체를 막는다.
 *
 * 글귀(라벨·안내·동의문)는 모두 원본 서식에 인쇄된 문장을 그대로 옮긴 것이고,
 * 없는 법적 요건을 새로 만들지 않는다.
 */
import { cellWidthBudget, textWidth } from "./formWritingWidth";
import { entryEnabled, WRITING_EXCLUSIONS } from "./formWritingRules";

export { textWidth };
export { entryEnabled };

export interface SlotAt {
  /** section0.xml 안에서 표가 나오는 차례 (0부터) */
  table: number;
  rowAddr: number;
  colAddr: number;
  /** 그 칸 안에서 문단 차례 (0부터) */
  p: number;
}

export type Slot =
  /** 빈 칸에 글자를 넣는다. 원본 글자(expect)가 다르면 멈춘다. */
  | { kind: "text"; at: SlotAt; expect: string }
  /** 원본에 인쇄된 글자 앞에 붙여 쓴다(예: 칸에 '의'가 인쇄된 경우). */
  | { kind: "prefix"; at: SlotAt; expect: string }
  /** 문장 가운데 비워 둔 자리(공백/밑줄)에만 써 넣는다. 자리 길이는 그대로 둔다. */
  | { kind: "inline"; at: SlotAt; expect: string; from: number; to: number; pad: " " | "_"; align?: "right"; max?: number }
  /** `[  ]` 표시칸에 √를 넣는다. box는 그 문단에서 몇 번째 표시칸인지. */
  | { kind: "check"; at: SlotAt; expect: string; box: number };

export interface WriteField {
  key: string;
  /** 원본 서식에 인쇄된 항목 이름 */
  label: string;
  hint?: string;
  slot: Slot;
  input?: "text" | "tel" | "email";
}

export interface WriteCheck {
  key: string;
  /** 원본 서식에 인쇄된 선택지 문구 */
  label: string;
  slot: Extract<Slot, { kind: "check" }>;
}

export interface WriteRow {
  label: string;
  fields: WriteField[];
}

export interface WriteGroup {
  id: string;
  title: string;
  note?: string;
  /** 이 항목을 고른 사람에게만 아래 세부 입력을 보여 준다. */
  lead?: WriteCheck;
  /** 원본이 명시한 적용 조건에 해당하는 보조 항목만 표시한다. */
  whenAny?: string[];
  /** 원본이 "1개 선택"이라고 적어 둔 묶음 — 이 묶음의 선택칸은 하나만 고를 수 있다. */
  exclusive?: string[][];
  checks?: WriteCheck[];
  fields?: WriteField[];
  rows?: WriteRow[];
  groups?: WriteGroup[];
}

export interface WriteStep {
  id: string;
  title: string;
  description?: string;
  groups: WriteGroup[];
}

export interface WritingTemplate {
  formId: string;
  title: string;
  lawTitle: string;
  /** 공개 자료에 적힌 원본 파일 — 이 값과 다르면 작성하지 않는다. */
  asset: { path: string; bytes: number; sha256: string };
  pageCount: number;
  tableCount: number;
  paragraphCount: number;
  previewTextLimit: number;
  steps: WriteStep[];
  /** 화면에서 채울 수 없어 본인이 직접 적거나 서명해야 하는 것 */
  manual: string[];
}

export type WriteValues = Record<string, string>;
export type WriteChecks = Record<string, boolean>;

/* ── 등록부를 짧게 적기 위한 도우미 ───────────────────────────────── */

export const at = (table: number, rowAddr: number, colAddr: number, p = 0): SlotAt => ({ table, rowAddr, colAddr, p });

export function text(key: string, label: string, place: SlotAt,
  extra: Partial<WriteField> & { expect?: string } = {}): WriteField {
  const { expect = "", ...rest } = extra;
  return { key, label, slot: { kind: "text", at: place, expect }, ...rest };
}

export function prefix(key: string, label: string, place: SlotAt, expect: string, extra: Partial<WriteField> = {}): WriteField {
  return { key, label, slot: { kind: "prefix", at: place, expect }, ...extra };
}

export function inline(key: string, label: string, place: SlotAt, expect: string, from: number, to: number,
  options: { pad?: " " | "_"; align?: "right"; max?: number } & Partial<WriteField> = {}): WriteField {
  const { pad = " ", align, max, ...rest } = options;
  return { key, label, slot: { kind: "inline", at: place, expect, from, to, pad, align, max }, ...rest };
}

export function check(key: string, label: string, place: SlotAt, expect: string, box = 0): WriteCheck {
  return { key, label, slot: { kind: "check", at: place, expect, box } };
}

/**
 * 그 자리에 들어갈 수 있는 너비(반각 칸 수).
 * - 빈 칸: 원본 칸 너비·여백·글자 크기에서 뽑아 둔 값
 * - 문장 가운데 빈자리: 원본이 비워 둔 자리의 너비 그대로 (채워도 줄 길이가 변하지 않는다)
 */
export function slotBudget(formId: string, slot: Slot): number {
  if (slot.kind === "check") return 0;
  if (slot.kind === "inline") return Math.min(slot.max ?? slot.to - slot.from, slot.to - slot.from);
  return cellWidthBudget(formId, `${slot.at.table}/${slot.at.rowAddr}/${slot.at.colAddr}/${slot.at.p}`);
}

/** 사람에게 보여 줄 한도 안내 — 한글 글자 수와 영문·숫자 글자 수로 풀어 쓴다. */
export function budgetLabel(units: number): string {
  return `한글 ${Math.floor(units / 2)}자(영문·숫자 ${units}자)까지`;
}

/** 단계·묶음을 평탄화해 모든 입력칸과 선택칸을 모은다. */
export function allFields(template: WritingTemplate): WriteField[] {
  const out: WriteField[] = [];
  const walk = (group: WriteGroup) => {
    out.push(...(group.fields ?? []));
    for (const row of group.rows ?? []) out.push(...row.fields);
    for (const nested of group.groups ?? []) walk(nested);
  };
  for (const step of template.steps) for (const group of step.groups) walk(group);
  return out;
}

export function allChecks(template: WritingTemplate): WriteCheck[] {
  const out: WriteCheck[] = [];
  const walk = (group: WriteGroup) => {
    if (group.lead) out.push(group.lead);
    out.push(...(group.checks ?? []));
    for (const nested of group.groups ?? []) walk(nested);
  };
  for (const step of template.steps) for (const group of step.groups) walk(group);
  return out;
}

/** 하나만 고를 수 있는 선택칸 → 같은 묶음의 다른 선택칸들 */
export function exclusiveSets(template: WritingTemplate): string[][] {
  const sets = [...(WRITING_EXCLUSIONS[template.formId] ?? [])];
  const walk = (group: WriteGroup) => {
    sets.push(...(group.exclusive ?? []));
    for (const nested of group.groups ?? []) walk(nested);
  };
  for (const step of template.steps) for (const group of step.groups) walk(group);
  return [...new Map(sets.map(set => [JSON.stringify([...set].sort()), set])).values()];
}

export function exclusiveSiblings(template: WritingTemplate): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const set of exclusiveSets(template)) {
    for (const key of set) out.set(key, [...new Set([...(out.get(key) ?? []), ...set.filter(other => other !== key)])]);
  }
  return out;
}

/** 지금 고른 내용에서 실제로 쓰이는 입력칸·선택칸만. 접힌 묶음 안의 값은 빠진다. */
export function activeEntries(template: WritingTemplate, checks: WriteChecks): { fields: WriteField[]; checks: WriteCheck[] } {
  const fields: WriteField[] = [];
  const items: WriteCheck[] = [];
  const walk = (group: WriteGroup) => {
    if (group.whenAny && !group.whenAny.some(key => checks[key])) return;
    if (group.lead) {
      items.push(group.lead);
      if (checks[group.lead.key] !== true) return;
    }
    fields.push(...(group.fields ?? []).filter(field => entryEnabled(template.formId, field.key, checks)));
    for (const row of group.rows ?? []) fields.push(...row.fields.filter(field => entryEnabled(template.formId, field.key, checks)));
    items.push(...(group.checks ?? []).filter(item => entryEnabled(template.formId, item.key, checks)));
    for (const nested of group.groups ?? []) walk(nested);
  };
  for (const step of template.steps) for (const group of step.groups) walk(group);
  return { fields, checks: items };
}

/**
 * 실제로 문서에 들어갈 값만 남긴다.
 * - 접힌(고르지 않은) 묶음 안에 적어 둔 값과 선택은 버린다.
 * - 원본이 "1개 선택"이라고 적어 둔 묶음에서 두 개 이상 골랐으면 문서를 만들지 않는다.
 */
export function normalizeInput(template: WritingTemplate, values: WriteValues, checks: WriteChecks): {
  values: WriteValues; checks: WriteChecks; conflicts: string[];
} {
  const active = activeEntries(template, checks);
  const nextValues: WriteValues = {};
  for (const field of active.fields) {
    const value = (values[field.key] ?? "").trim();
    if (value) nextValues[field.key] = value;
  }
  const nextChecks: WriteChecks = {};
  for (const item of active.checks) if (checks[item.key]) nextChecks[item.key] = true;

  const conflicts: string[] = [];
  const labelOf = (key: string) => active.checks.find(item => item.key === key)?.label ?? key;
  for (const set of exclusiveSets(template)) {
    const chosen = set.filter(key => nextChecks[key]);
    if (chosen.length > 1) conflicts.push(`같은 항목에서는 하나만 고를 수 있어요: ${chosen.map(labelOf).join(", ")}`);
  }

  return { values: nextValues, checks: nextChecks, conflicts };
}

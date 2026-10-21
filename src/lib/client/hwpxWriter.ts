/**
 * 화면에서 받은 값으로 원본 HWPX의 정해진 칸만 채워 새 파일을 만든다.
 *
 * - 원본 파일은 절대 덮어쓰지 않는다. 새 이름(*_작성본.hwpx)으로 내려받게만 한다.
 * - 원본을 읽기 전에 바이트 수와 SHA-256을 등록부 값과 맞춰 본다. 다르면 작성하지 않는다.
 * - 정해 둔 자리의 원문이 다르면 비슷한 자리를 찾지 않고 바로 멈춘다.
 * - 값은 브라우저 메모리에서만 쓰인다. 어디에도 보내지 않는다.
 */
import { buildPreviewText } from "./hwpxPreview";
import { HwpxMismatchError, applyEdits, findParagraph, indexSection, replaceParagraphRanges, type ParagraphOp, type SourceEdit } from "./hwpxXml";
import { decodeUtf8, encodeUtf8, readHwpx, writeHwpx } from "./hwpxZip";
import { activeEntries, budgetLabel, normalizeInput, slotBudget, textWidth, type Slot, type WriteChecks, type WriteField, type WriteValues, type WritingTemplate } from "../data/formWriting";

const SECTION = "Contents/section0.xml";
const PREVIEW = "Preview/PrvText.txt";
/** 표시칸 `[  ]` 안을 √로 바꿀 때, 원래 폭을 지키려고 공백 두 칸을 √ 한 글자로 바꾼다. */
const TICK = "√";

export interface FilledDocument {
  bytes: Uint8Array;
  fileName: string;
}

export function filledFileName(template: WritingTemplate): string {
  return `${template.title}_작성본.hwpx`;
}

/** 한글 문서(XML)에 넣을 수 없는 글자인지 본다. */
function badCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    // 짝이 맞지 않는 대리쌍(lone surrogate)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return true;
  }
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) return true;                       // 제어문자
    if (code >= 0x80 && code <= 0x9f) return true;                        // C1 제어문자
    if (code === 0xfffe || code === 0xffff) return true;                  // XML에 쓸 수 없는 값
    if ((code & 0xfffe) === 0xfffe) return true;                          // 각 평면의 비문자
    if (code >= 0xfdd0 && code <= 0xfdef) return true;                    // 비문자 구간
    if (code > 0xffff) return true;                                       // 한글 서식 글꼴 밖(보조 평면)
  }
  return false;
}

/**
 * 적은 값이 원본 칸에 실제로 들어가는지 본다.
 * 글자 수가 아니라 너비로 재서, 한글이 칸을 넘으면 한글 문서가 글자를 눌러 그리는 일을 막는다.
 */
export function fieldError(template: WritingTemplate, field: WriteField, raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (badCharacter(value)) return `${field.label}에 한글 문서로 옮길 수 없는 문자가 있어요. 한글·영문·숫자·기호로 적어 주세요.`;
  // These original cells are explicitly intended for a full registration number.
  // Narrow numeric glyphs are verified separately in the real Hancom render, rather
  // than allowing the same count of wide Korean glyphs to overlap.
  if (registrationField(field)) {
    return /^\d{6}-?\d{7}$/.test(value) ? null : `${field.label}은(는) 숫자 13자리로 적어 주세요. 가운데 -는 넣어도 돼요.`;
  }
  const budget = slotBudget(template.formId, field.slot);
  const used = textWidth(value);
  if (field.input === "tel" && value.length <= 13 && /^[0-9()+ -]+$/.test(value)) return null;
  if (used > budget) {
    return `${field.label}은(는) 원본 서식 칸에 들어가는 만큼만 적을 수 있어요. ${budgetLabel(budget)} 적어 주세요.`;
  }
  return null;
}

export function registrationField(field: WriteField): boolean {
  return field.key.endsWith(".rrn") || field.key === "d.phoneRrn";
}

function checkMark(expect: string, box: number): { from: number; to: number; value: string } {
  const matches = [...expect.matchAll(/\[ *\]/g)];
  const found = matches[box];
  if (!found) throw new HwpxMismatchError("원본 서식에서 표시칸을 찾지 못했습니다.");
  const inner = found[0].length - 2;
  return { from: found.index!, to: found.index! + found[0].length, value: `[${TICK}${" ".repeat(Math.max(0, inner - 2))}]` };
}

function slotOp(slot: Slot, value: string): ParagraphOp {
  if (slot.kind === "text") return { from: 0, to: slot.expect.length, value };
  if (slot.kind === "prefix") return { from: 0, to: 0, value };
  if (slot.kind === "check") {
    const mark = checkMark(slot.expect, slot.box);
    return { from: mark.from, to: mark.to, value: mark.value };
  }
  const room = slot.to - slot.from;
  const blank = slot.expect.slice(slot.from, slot.to);
  if (blank.length !== room || [...blank].some(char => char !== slot.pad)) {
    throw new HwpxMismatchError("원본 서식의 빈칸 자리가 등록해 둔 것과 다릅니다.");
  }
  // 원본이 비워 둔 자리의 너비를 그대로 지킨다. 채움 문자(공백·밑줄)는 반각 한 칸,
  // 한글은 두 칸이므로 넣은 글자의 너비만큼 채움 문자를 덜어 낸다.
  const used = textWidth(value);
  if (used > room) throw new HwpxMismatchError("적은 내용이 원본 빈칸보다 넓습니다.");
  const fill = slot.pad.repeat(room - used);
  return { from: slot.from, to: slot.to, value: slot.align === "right" ? fill + value : value + fill };
}

export interface WriteInput {
  values: WriteValues;
  checks: WriteChecks;
}

export function buildFilledSection(template: WritingTemplate, sectionXml: string, raw: WriteInput): string {
  // 고르지 않은 묶음 안에 남아 있는 값·선택은 여기서 떨어져 나간다.
  const { values, checks, conflicts } = normalizeInput(template, raw.values, raw.checks);
  if (conflicts.length) throw new HwpxMismatchError(conflicts[0]);
  const active = activeEntries(template, raw.checks);
  const index = indexSection(sectionXml);
  if (index.tableCount !== template.tableCount || index.paragraphCount !== template.paragraphCount) {
    throw new HwpxMismatchError("원본 서식의 구성이 등록해 둔 것과 달라 작성을 멈췄습니다.");
  }
  // 같은 문단을 여러 번 고치는 경우가 있어 문단별로 모아 한꺼번에 처리한다.
  const byParagraph = new Map<string, { slot: Slot; ops: ParagraphOp[] }>();
  const collect = (slot: Slot, op: ParagraphOp) => {
    const paragraph = findParagraph(index, slot.at.table, slot.at.rowAddr, slot.at.colAddr, slot.at.p);
    if (paragraph.text !== slot.expect) {
      throw new HwpxMismatchError("원본 서식의 내용이 등록해 둔 것과 달라 작성을 멈췄습니다.");
    }
    const key = `${slot.at.table}/${slot.at.rowAddr}/${slot.at.colAddr}/${slot.at.p}`;
    const bucket = byParagraph.get(key) ?? { slot, ops: [] };
    bucket.ops.push(op);
    byParagraph.set(key, bucket);
  };
  for (const field of active.fields) {
    const value = values[field.key];
    if (!value) continue;
    const problem = fieldError(template, field, value);
    if (problem) throw new HwpxMismatchError(problem);
    collect(field.slot, slotOp(field.slot, value));
  }
  for (const item of active.checks) {
    if (!checks[item.key]) continue;
    collect(item.slot, slotOp(item.slot, ""));
  }
  const edits: SourceEdit[] = [];
  for (const { slot, ops } of byParagraph.values()) {
    edits.push(...replaceParagraphRanges(findParagraph(index, slot.at.table, slot.at.rowAddr, slot.at.colAddr, slot.at.p), ops));
  }
  const filled = applyEdits(sectionXml, edits);
  const after = indexSection(filled);
  if (after.tableCount !== template.tableCount || after.paragraphCount !== template.paragraphCount) {
    throw new HwpxMismatchError("작성 결과의 문단·표 수가 원본과 달라 저장하지 않았습니다.");
  }
  return filled;
}

/** 꾸러미를 열기 전에 바이트 수와 SHA-256을 등록해 둔 원본과 맞춰 본다. */
export async function buildFilledHwpx(template: WritingTemplate, templateBytes: Uint8Array, input: WriteInput): Promise<FilledDocument> {
  if (templateBytes.byteLength !== template.asset.bytes) {
    throw new HwpxMismatchError("받아 온 원본 서식의 크기가 공개된 값과 다릅니다.");
  }
  if ((await sha256Hex(templateBytes)) !== template.asset.sha256) {
    throw new HwpxMismatchError("받아 온 원본 서식이 공개된 원본과 다릅니다.");
  }
  const pkg = readHwpx(templateBytes);
  const sectionXml = decodeUtf8(pkg.files[SECTION]);
  const filled = buildFilledSection(template, sectionXml, input);
  pkg.files[SECTION] = encodeUtf8(filled);
  if (pkg.files[PREVIEW]) {
    pkg.files[PREVIEW] = encodeUtf8(buildPreviewText(indexSection(filled), template.previewTextLimit));
  }
  return { bytes: writeHwpx(pkg), fileName: filledFileName(template) };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", source);
  return [...new Uint8Array(digest)].map(part => part.toString(16).padStart(2, "0")).join("");
}

/** 원본 서식만 받아 온다. 작성한 값은 이 요청에 들어가지 않는다. */
export async function fetchTemplateBytes(template: WritingTemplate): Promise<Uint8Array> {
  const response = await fetch(template.asset.path, { cache: "force-cache" });
  if (!response.ok) throw new Error("원본 서식을 받지 못했습니다.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== template.asset.bytes) throw new HwpxMismatchError("받아 온 원본 서식의 크기가 공개된 값과 다릅니다.");
  if ((await sha256Hex(bytes)) !== template.asset.sha256) throw new HwpxMismatchError("받아 온 원본 서식이 공개된 원본과 다릅니다.");
  return bytes;
}

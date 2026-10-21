/**
 * HWPX 본문(section0.xml)을 바이트 위치 기준으로 훑어보고, 정해 둔 칸의 글자만 바꾼다.
 *
 * 원본 XML을 다시 만들어 내지 않는다. 바꾸기로 한 글자 구간만 잘라 끼우므로
 * 네임스페이스·속성 순서·스타일·표 구조·문단 수는 원본 바이트 그대로 남는다.
 * 브라우저와 테스트 양쪽에서 같은 코드를 쓰려고 DOM API에 기대지 않는다.
 */

/** `<hp:t>` 안쪽 글자 한 토막 (XML 원본에서의 위치와, 실체 참조를 푼 글자). */
export interface TextSegment {
  /** `<hp:t>` 여는 태그 바로 뒤 */
  start: number;
  /** `</hp:t>` 여는 꺾쇠 자리 */
  end: number;
  text: string;
  /** `<hp:t/>`처럼 빈 태그면, 글자를 넣을 때 닫는 태그까지 다시 써야 한다. */
  selfClosingAt: number | null;
}

export interface ParagraphIndex {
  segments: TextSegment[];
  /** 문단 전체 글자 (토막을 이어 붙인 것) */
  text: string;
  /** 글자가 하나도 없는 문단에 글자를 넣을 자리 */
  emptyRun: { contentStart: number; selfClosingAt: number | null } | null;
}

export interface CellIndex {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  paragraphs: ParagraphIndex[];
}

export interface TableIndex {
  /** `<hp:tr>` 차례대로, 그 줄에 적힌 칸들 */
  rows: CellIndex[][];
}

export interface SectionIndex {
  tables: TableIndex[];
  /** 전체 `<hp:p>` 수 (문단 수가 그대로인지 확인할 때 쓴다) */
  paragraphCount: number;
  /** 전체 `<hp:tbl>` 수 */
  tableCount: number;
}

export class HwpxMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HwpxMismatchError";
  }
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** XML 실체 참조를 푼다. 서식 본문에는 수치 참조도 드물게 쓰여 함께 처리한다. */
export function decodeXmlText(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITY[name] ?? whole;
  });
}

/** 입력 글자를 XML 본문에 넣을 수 있게 바꾼다. 넣을 수 없는 글자는 받지 않는다. */
export function escapeXmlText(value: string): string {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 && char !== "\t") throw new HwpxMismatchError("문서에 넣을 수 없는 문자가 있습니다.");
    if (code >= 0xd800 && code <= 0xdfff) throw new HwpxMismatchError("문서에 넣을 수 없는 문자가 있습니다.");
  }
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface StackEntry {
  name: string;
  /** 여는 태그 바로 뒤 */
  contentStart: number;
  node?: unknown;
}

const ATTR = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR.exec(tag))) out[match[1]] = match[2];
  return out;
}

/**
 * section0.xml을 한 번 훑어 표·칸·문단·글자 토막의 위치를 모은다.
 * 표 안의 표가 있어도 안쪽 칸의 문단이 바깥 칸에 섞이지 않도록 부모 관계로 가른다.
 */
export function indexSection(xml: string): SectionIndex {
  const tables: TableIndex[] = [];
  const stack: StackEntry[] = [];
  let paragraphCount = 0;
  let cursor = 0;

  const parentOf = (name: string): StackEntry | undefined => {
    const top = stack[stack.length - 1];
    return top && top.name === name ? top : undefined;
  };

  while (cursor < xml.length) {
    const open = xml.indexOf("<", cursor);
    if (open < 0) break;
    if (xml.startsWith("<!--", open)) {
      cursor = xml.indexOf("-->", open) + 3;
      continue;
    }
    if (xml.startsWith("<?", open)) {
      cursor = xml.indexOf("?>", open) + 2;
      continue;
    }
    const close = xml.indexOf(">", open);
    if (close < 0) break;
    const tag = xml.slice(open, close + 1);
    cursor = close + 1;

    if (tag[1] === "/") {
      const name = tag.slice(2, -1).trim();
      while (stack.length && stack[stack.length - 1].name !== name) stack.pop();
      stack.pop();
      continue;
    }

    const selfClosing = tag.endsWith("/>");
    const nameEnd = tag.search(/[\s/>]/);
    const name = tag.slice(1, nameEnd < 0 ? tag.length - 1 : nameEnd);
    let node: unknown;

    if (name === "hp:tbl") {
      node = { rows: [] } as TableIndex;
      tables.push(node as TableIndex);
    } else if (name === "hp:tr") {
      const table = parentOf("hp:tbl")?.node as TableIndex | undefined;
      if (table) {
        node = [] as CellIndex[];
        table.rows.push(node as CellIndex[]);
      }
    } else if (name === "hp:tc") {
      const row = parentOf("hp:tr")?.node as CellIndex[] | undefined;
      if (row) {
        node = { row: -1, col: -1, rowSpan: 1, colSpan: 1, paragraphs: [] } as CellIndex;
        row.push(node as CellIndex);
      }
    } else if (name === "hp:cellAddr" || name === "hp:cellSpan") {
      const cell = parentOf("hp:tc")?.node as CellIndex | undefined;
      if (cell) {
        const attrs = attributes(tag);
        if (name === "hp:cellAddr") {
          cell.row = Number(attrs.rowAddr);
          cell.col = Number(attrs.colAddr);
        } else {
          cell.rowSpan = Number(attrs.rowSpan) || 1;
          cell.colSpan = Number(attrs.colSpan) || 1;
        }
      }
    } else if (name === "hp:p") {
      paragraphCount += 1;
      const subList = parentOf("hp:subList");
      const cell = subList && stack[stack.length - 2]?.name === "hp:tc"
        ? (stack[stack.length - 2].node as CellIndex | undefined)
        : undefined;
      if (cell) {
        node = { segments: [], text: "", emptyRun: null } as ParagraphIndex;
        cell.paragraphs.push(node as ParagraphIndex);
      }
    } else if (name === "hp:run") {
      const paragraph = parentOf("hp:p")?.node as ParagraphIndex | undefined;
      if (paragraph && !paragraph.emptyRun) {
        paragraph.emptyRun = { contentStart: close + 1, selfClosingAt: selfClosing ? close - 1 : null };
      }
    } else if (name === "hp:t") {
      const paragraph = stack[stack.length - 2]?.name === "hp:p" && parentOf("hp:run")
        ? (stack[stack.length - 2].node as ParagraphIndex | undefined)
        : undefined;
      if (paragraph) {
        if (selfClosing) {
          paragraph.segments.push({ start: close, end: close, text: "", selfClosingAt: close - 1 });
        } else {
          const end = xml.indexOf("</hp:t>", close);
          if (end < 0) throw new HwpxMismatchError("본문 XML을 읽지 못했습니다.");
          // `<hp:t>` 안에는 줄바꿈(`<hp:lineBreak/>`)·탭 같은 요소가 섞여 있을 수 있다.
          // 그 요소는 건드리지 않고, 사이사이의 글자만 토막으로 잡는다.
          let found = false;
          let pos = close + 1;
          while (pos < end) {
            const mark = xml.indexOf("<", pos);
            const stop = mark < 0 || mark > end ? end : mark;
            if (stop > pos) {
              paragraph.segments.push({ start: pos, end: stop, text: decodeXmlText(xml.slice(pos, stop)), selfClosingAt: null });
              found = true;
            }
            if (stop >= end) break;
            const inner = xml.indexOf(">", stop);
            if (inner < 0 || inner > end) throw new HwpxMismatchError("본문 XML을 읽지 못했습니다.");
            pos = inner + 1;
          }
          if (!found) paragraph.segments.push({ start: close + 1, end: close + 1, text: "", selfClosingAt: null });
        }
      }
    }

    if (!selfClosing) stack.push({ name, contentStart: close + 1, node });
  }

  for (const table of tables) {
    for (const row of table.rows) {
      for (const cell of row) {
        for (const paragraph of cell.paragraphs) paragraph.text = paragraph.segments.map(s => s.text).join("");
      }
    }
  }
  return { tables, paragraphCount, tableCount: tables.length };
}

export function findCell(index: SectionIndex, table: number, row: number, col: number): CellIndex {
  const target = index.tables[table];
  if (!target) throw new HwpxMismatchError(`원본 서식의 표 ${table}을(를) 찾지 못했습니다.`);
  for (const line of target.rows) for (const cell of line) if (cell.row === row && cell.col === col) return cell;
  throw new HwpxMismatchError(`원본 서식의 칸 ${table}/${row}/${col}을(를) 찾지 못했습니다.`);
}

export function findParagraph(index: SectionIndex, table: number, row: number, col: number, p: number): ParagraphIndex {
  const cell = findCell(index, table, row, col);
  const paragraph = cell.paragraphs[p];
  if (!paragraph) throw new HwpxMismatchError(`원본 서식의 칸 ${table}/${row}/${col}의 ${p}번째 줄을 찾지 못했습니다.`);
  return paragraph;
}

/** 원본에서 잘라 끼울 한 조각. */
export interface SourceEdit {
  start: number;
  end: number;
  xml: string;
}

/** 문단 글자 중 [from, to) 구간을 value로 바꾸라는 요청. */
export interface ParagraphOp {
  from: number;
  to: number;
  value: string;
}

/**
 * 한 문단에 대한 바꾸기 요청을 모아 한 번에 처리한다.
 * 문단은 여러 `<hp:t>`로 쪼개져 있을 수 있어, 요청이 걸친 토막마다 조각을 만든다.
 * 한 문단을 여러 번 고치는 경우(표시칸 여러 개 + 빈칸 채우기)를 한꺼번에 다뤄야
 * 같은 토막을 두 번 덮어쓰는 일이 생기지 않는다.
 */
export function replaceParagraphRanges(paragraph: ParagraphIndex, ops: ParagraphOp[]): SourceEdit[] {
  const sorted = [...ops].sort((a, b) => a.from - b.from || a.to - b.to);
  let previousEnd = -1;
  for (const op of sorted) {
    if (op.from < 0 || op.to < op.from || op.to > paragraph.text.length) throw new HwpxMismatchError("바꿀 위치가 원본 범위를 벗어났습니다.");
    if (op.from < previousEnd) throw new HwpxMismatchError("바꿀 자리가 서로 겹칩니다.");
    previousEnd = op.to;
  }

  if (paragraph.segments.length === 0) {
    const value = sorted.map(op => op.value).join("");
    if (sorted.some(op => op.from !== 0 || op.to !== 0)) throw new HwpxMismatchError("빈 칸에서 바꿀 글자를 찾지 못했습니다.");
    if (!value) return [];
    const run = paragraph.emptyRun;
    if (!run) throw new HwpxMismatchError("글자를 넣을 수 있는 자리를 찾지 못했습니다.");
    const escaped = escapeXmlText(value);
    if (run.selfClosingAt !== null) {
      return [{ start: run.selfClosingAt, end: run.selfClosingAt + 2, xml: `><hp:t>${escaped}</hp:t></hp:run>` }];
    }
    return [{ start: run.contentStart, end: run.contentStart, xml: `<hp:t>${escaped}</hp:t>` }];
  }

  const edits: SourceEdit[] = [];
  const placed = new Set<ParagraphOp>();
  let offset = 0;
  for (const segment of paragraph.segments) {
    const segFrom = offset;
    const segTo = offset + segment.text.length;
    offset = segTo;
    const touching = sorted.filter(op => op.to >= segFrom && op.from <= segTo);
    if (!touching.length) continue;
    let cursor = segFrom;
    let content = "";
    for (const op of touching) {
      const cut = Math.max(op.from, cursor);
      if (cut > cursor) content += escapeXmlText(paragraph.text.slice(cursor, cut));
      if (!placed.has(op)) {
        content += escapeXmlText(op.value);
        placed.add(op);
      }
      cursor = Math.max(cursor, Math.min(op.to, segTo));
    }
    if (cursor < segTo) content += escapeXmlText(paragraph.text.slice(cursor, segTo));
    if (segment.selfClosingAt !== null) {
      if (!content) continue;
      edits.push({ start: segment.selfClosingAt, end: segment.selfClosingAt + 2, xml: `>${content}</hp:t>` });
      continue;
    }
    edits.push({ start: segment.start, end: segment.end, xml: content });
  }
  if (placed.size !== sorted.length) throw new HwpxMismatchError("바꿀 글자 자리를 찾지 못했습니다.");
  return edits;
}

/** 조각들을 뒤에서부터 끼워 넣는다. 겹치는 조각이 있으면 바꾸지 않고 멈춘다. */
export function applyEdits(xml: string, edits: SourceEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let previousStart = Number.POSITIVE_INFINITY;
  let out = xml;
  for (const edit of sorted) {
    if (edit.end > previousStart) throw new HwpxMismatchError("바꿀 자리가 서로 겹칩니다.");
    out = out.slice(0, edit.start) + edit.xml + out.slice(edit.end);
    previousStart = edit.start;
  }
  return out;
}

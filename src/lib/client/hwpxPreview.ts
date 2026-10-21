/**
 * Preview/PrvText.txt 다시 만들기.
 *
 * 한글이 넣어 둔 미리보기 글은 본문의 표를 줄 단위로 풀어 쓴 것이다.
 * 규칙: 표의 각 줄에서 칸 글자를 `<...>`로 감싸 이어 붙이고, 세로로 합쳐진 칸이
 * 끝나는 줄에서 줄바꿈한다. 한 칸에 여러 문단이 있으면 공백 하나로 잇는다.
 * 마지막에는 원본과 같은 길이에서 끊고, 칸이 닫히지 않았으면 `>`로 닫는다.
 * (원본 두 서식에서 이 규칙으로 원본 미리보기 글이 그대로 다시 만들어지는 것을 시험으로 확인한다.)
 */
import type { SectionIndex } from "./hwpxXml";

export function buildPreviewText(index: SectionIndex, limit: number): string {
  const lines: string[] = [];
  for (const table of index.tables) {
    let buffer = "";
    let groupEnd = 0;
    table.rows.forEach((row, rowIndex) => {
      let span = 1;
      for (const cell of row) {
        span = Math.max(span, cell.rowSpan);
        buffer += `<${cell.paragraphs.map(p => p.text).join(" ")}>`;
      }
      groupEnd = Math.max(groupEnd, rowIndex + span);
      if (rowIndex + 1 >= groupEnd) {
        lines.push(buffer);
        buffer = "";
      }
    });
    if (buffer) lines.push(buffer);
  }
  const full = lines.join("\r\n");
  if (full.length <= limit) return full;
  const cut = full.slice(0, limit);
  const lastOpen = cut.lastIndexOf("<");
  const lastClose = cut.lastIndexOf(">");
  return lastOpen > lastClose ? cut.slice(0, -1) + ">" : cut;
}

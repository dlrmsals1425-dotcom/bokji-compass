import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { writingDisclosure, WRITING_DISCLOSURE_SOURCES } from "@/lib/data/formWritingDisclosures";

type XmlNode = Record<string, unknown>;
type Cell = readonly [table: number, row: number, col: number];

// 독립적으로 정한 전체 셀 범위다. 등록부의 sourceId를 기대값으로 재사용하지 않는다.
// 각 셀의 모든 hp:p를 원본 ZIP에서 읽으므로 문단 하나라도 빠지면 비교가 실패한다.
const GROUP_CELLS: Record<string, Record<string, Cell[]>> = {
  "rule-3211495": {
    "c-required": [[1, 25, 0], [1, 26, 0]],
    "c-third": [[2, 1, 0], [2, 2, 0]],
    "c-notice": [
      [2, 14, 0], [2, 15, 0], [2, 15, 1], [2, 16, 1], [2, 17, 1],
      [2, 18, 1], [2, 19, 0], [2, 19, 1], [2, 20, 1], [2, 21, 0],
      [2, 21, 1], [2, 22, 0], [2, 22, 1], [2, 23, 1],
    ],
  },
  "rule-3211501": {
    "c-privacy": [[2, 1, 0], [2, 2, 0]],
    "c-notice": [[2, 3, 0], [2, 4, 0], [2, 5, 0], [2, 6, 0], [2, 7, 0]],
  },
};

function children(node: XmlNode, tag: string): XmlNode[] {
  return (node[tag] as XmlNode[] | undefined) ?? [];
}

function descendants(nodes: XmlNode[], tag: string): XmlNode[] {
  const result: XmlNode[] = [];
  for (const node of nodes) {
    if (tag in node) result.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) result.push(...descendants(value as XmlNode[], tag));
    }
  }
  return result;
}

function direct(nodes: XmlNode[], tag: string): XmlNode {
  const found = nodes.find(node => tag in node);
  if (!found) throw new Error(`원본 XML에 ${tag}가 없습니다.`);
  return found;
}

/** XML 순서를 보존하므로 hp:t 안의 lineBreak 뒤 텍스트도 빠지지 않는다. */
function textContent(nodes: XmlNode[]): string {
  return nodes.map(node => {
    if ("#text" in node) return String(node["#text"]);
    if ("hp:lineBreak" in node) return "\n";
    if ("hp:tab" in node) return "\t";
    return Object.values(node)
      .filter(Array.isArray)
      .map(value => textContent(value as XmlNode[]))
      .join("");
  }).join("");
}

function original(formId: string) {
  const path = `pipeline/forms/originals/${formId}.hwpx`;
  const bytes = readFileSync(path);
  const xml = strFromU8(unzipSync(bytes)["Contents/section0.xml"]);
  const tree = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    trimValues: false,
    parseTagValue: false,
    processEntities: true,
  }).parse(xml) as XmlNode[];
  const tables = descendants(tree, "hp:tbl");

  function paragraphs([table, row, col]: Cell) {
    const tableChildren = children(tables[table], "hp:tbl");
    const cells = tableChildren
      .filter(node => "hp:tr" in node)
      .flatMap(node => children(node, "hp:tr"))
      .filter(node => "hp:tc" in node);
    const cell = cells.find(node => {
      const address = direct(children(node, "hp:tc"), "hp:cellAddr");
      const attributes = address[":@"] as Record<string, string>;
      return Number(attributes["@_rowAddr"]) === row && Number(attributes["@_colAddr"]) === col;
    });
    if (!cell) throw new Error(`원본 셀이 없습니다: T${table}r${row}c${col}`);
    const subList = direct(children(cell, "hp:tc"), "hp:subList");
    return children(subList, "hp:subList")
      .filter(node => "hp:p" in node)
      .map((paragraph, index) => ({
        sourceId: `T${table}r${row}c${col}p${index}`,
        text: descendants(children(paragraph, "hp:p"), "hp:t")
          .map(node => textContent(children(node, "hp:t")))
          .join(""),
      }));
  }

  return { path, bytes, paragraphs };
}

describe("작성기 동의·유의사항 원문 등록부", () => {
  for (const [formId, groups] of Object.entries(GROUP_CELLS)) {
    const source = original(formId);
    const registry = WRITING_DISCLOSURE_SOURCES[formId];

    it(`${formId}: 실제 원본 SHA와 법령 출처 문구가 일치한다`, () => {
      expect(registry.sourcePath).toBe(source.path);
      expect(registry.sourceSHA256).toBe(createHash("sha256").update(source.bytes).digest("hex"));
      expect(registry.section).toBe("Contents/section0.xml");
      expect(registry.sourceTitleId).toBe("T0r0c0p0");
      expect(registry.sourceTitle).toBe(source.paragraphs([0, 0, 0])[0].text);
      expect(Object.keys(registry.groups).sort()).toEqual(Object.keys(groups).sort());
    });

    for (const [groupId, cells] of Object.entries(groups)) {
      it(`${formId}/${groupId}: 대상 셀의 모든 원문 문단·법률 인용·출처가 빠짐없이 같다`, () => {
        const paragraphs = cells.flatMap(cell => source.paragraphs(cell));
        expect(registry.groups[groupId]).toEqual(paragraphs);
        expect(writingDisclosure(formId, groupId)).toEqual([
          source.paragraphs([0, 0, 0])[0].text,
          ...paragraphs.map(paragraph => paragraph.text),
        ]);
      });
    }
  }

  it("일반 유의사항의 줄바꿈 뒤 기관명과 복지멤버십 안내도 보존한다", () => {
    const source = original("rule-3211495");
    const paragraph = source.paragraphs([2, 21, 1])[1].text;
    expect(paragraph).toContain("\n");
    expect(paragraph).toContain("지역난방비감면: 지역난방공사");
    expect(writingDisclosure("rule-3211495", "c-notice")).toContain(paragraph);
    expect(writingDisclosure("rule-3211495", "c-notice").join("\n"))
      .toContain("맞춤형 급여 안내를 신청한 것으로 간주");
  });

  it("알 수 없는 서식·그룹 및 별도 원문 고지가 필요 없는 선택동의는 빈 배열이다", () => {
    expect(writingDisclosure("unknown", "c-notice")).toEqual([]);
    expect(writingDisclosure("rule-3211495", "unknown")).toEqual([]);
    expect(writingDisclosure("rule-3211495", "c-optional")).toEqual([]);
    expect(writingDisclosure("__proto__", "c-notice")).toEqual([]);
    expect(writingDisclosure("rule-3211495", "__proto__")).toEqual([]);
  });

  it("호출자가 반환 배열을 바꿔도 다음 호출의 고지 문구는 보존된다", () => {
    const expected = writingDisclosure("rule-3211501", "c-privacy");
    const changed = writingDisclosure("rule-3211501", "c-privacy");
    changed.splice(0, changed.length, "변경");
    expect(writingDisclosure("rule-3211501", "c-privacy")).toEqual(expected);
  });
});

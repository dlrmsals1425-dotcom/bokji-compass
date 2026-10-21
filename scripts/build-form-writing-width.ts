/**
 * src/lib/data/formWritingWidth.ts 를 원본 HWPX의 실제 칸 너비에서 뽑아 만든다.
 *
 * 한글은 칸보다 긴 글을 넣으면 글자를 눌러서(장평 축소) 그려 버려 읽을 수 없게 된다.
 * 그래서 "몇 글자"가 아니라 "원본 칸에 실제로 들어가는 너비"로 한도를 정한다.
 * 너비 단위는 반각 한 칸(=글자 높이의 1/2). 한글 한 글자 = 2, 영문·숫자·공백 = 1.
 *
 *   npx tsx scripts/build-form-writing-width.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";

const OUT = "src/lib/data/formWritingWidth.ts";
const SOURCES = [
  { id: "rule-3211495", path: "pipeline/forms/originals/rule-3211495.hwpx", sha256: "05a5fb88ab3199783d66d5fc77af32f425c07ba34552203d9ca4a2546e3bc1be" },
  { id: "rule-3211501", path: "pipeline/forms/originals/rule-3211501.hwpx", sha256: "f922a89ff89c09bfb6325d493d03104bdc23c123fc1c4b469bfc77bb1597bde1" },
];
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", isArray: () => true });
const list = <T,>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const node = (parent: Record<string, unknown>, name: string) => list(parent[name] as Record<string, unknown>[])[0];
const num = (value: unknown, fallback = 0) => (value === undefined ? fallback : Number(value));

interface CharStyle { height: number; ratioHangul: number; ratioLatin: number; spacingHangul: number; spacingLatin: number }

/** 반각 칸 수: 한글 등 전각 글자는 2, 영문·숫자·공백은 1 */
const width = (value: string) => [...value].reduce((sum, char) => sum + (char.codePointAt(0)! < 0x100 ? 1 : 2), 0);

function styles(headerXml: string) {
  const header = parser.parse(headerXml);
  const head = node(node(list(header["hh:head"])[0] as Record<string, unknown>, "hh:refList") as Record<string, unknown>, "hh:charProperties");
  const chars = new Map<number, CharStyle>();
  for (const item of list((head as Record<string, unknown>)["hh:charPr"] as Record<string, unknown>[])) {
    const ratio = node(item, "hh:ratio");
    const spacing = node(item, "hh:spacing");
    chars.set(num(item["@id"]), {
      height: num(item["@height"], 1000),
      ratioHangul: num(ratio?.["@hangul"], 100),
      ratioLatin: num(ratio?.["@latin"], 100),
      spacingHangul: num(spacing?.["@hangul"], 0),
      spacingLatin: num(spacing?.["@latin"], 0),
    });
  }
  const paraRoot = node(node(list(parser.parse(headerXml)["hh:head"])[0] as Record<string, unknown>, "hh:refList") as Record<string, unknown>, "hh:paraProperties");
  const paras = new Map<number, { left: number; right: number; indent: number; lineSpacing: number }>();
  for (const item of list((paraRoot as Record<string, unknown>)["hh:paraPr"] as Record<string, unknown>[])) {
    const margin = node(item, "hh:margin");
    const pick = (name: string) => {
      const entry = node(margin ?? {}, name);
      const inner = entry && (node(entry, "hc:switch") ?? entry);
      const cases = inner && list((inner as Record<string, unknown>)["hc:case"] as Record<string, unknown>[])[0];
      return num((cases ?? entry)?.["@value"], 0);
    };
    const spacingNode = node(item, "hh:lineSpacing");
    const spacingCase = spacingNode && (list((node(spacingNode, "hc:switch") ?? {})["hc:case"] as Record<string, unknown>[])[0]);
    const spacing = spacingCase ?? spacingNode;
    paras.set(num(item["@id"]), {
      left: pick("hh:left"),
      right: pick("hh:right"),
      indent: pick("hh:intent"),
      lineSpacing: spacing?.["@type"] === "PERCENT" ? num(spacing["@value"], 130) : 130,
    });
  }
  return { chars, paras };
}

interface CellGeometry {
  width: number;
  height: number;
  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  paragraphs: { paraPrIDRef: number; charPrIDRef: number; text: string }[];
}

function geometry(sectionXml: string) {
  const section = parser.parse(sectionXml);
  const cells = new Map<string, CellGeometry>();
  let tableIndex = -1;
  const walk = (value: unknown, inTable: number | null) => {
    if (!value || typeof value !== "object") return;
    for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
      if (name.startsWith("@")) continue;
      for (const child of list(raw as Record<string, unknown>[])) {
        if (name === "hp:tbl") {
          tableIndex += 1;
          const current = tableIndex;
          for (const tr of list(child["hp:tr"] as Record<string, unknown>[])) {
            for (const tc of list(tr["hp:tc"] as Record<string, unknown>[])) {
              const addr = node(tc, "hp:cellAddr")!;
              const size = node(tc, "hp:cellSz")!;
              const margin = node(tc, "hp:cellMargin")!;
              const subList = node(tc, "hp:subList")!;
              const paragraphs = list(subList["hp:p"] as Record<string, unknown>[]).map(p => ({
                paraPrIDRef: num(p["@paraPrIDRef"]),
                charPrIDRef: num(list(p["hp:run"] as Record<string, unknown>[])[0]?.["@charPrIDRef"]),
                text: list(p["hp:run"] as Record<string, unknown>[])
                  .flatMap(run => list(run["hp:t"] as unknown[]))
                  .map(t => (typeof t === "object" && t ? String((t as Record<string, unknown>)["#text"] ?? "") : String(t ?? "")))
                  .join(""),
              }));
              cells.set(`T${current}r${num(addr["@rowAddr"])}c${num(addr["@colAddr"])}`, {
                width: num(size["@width"]),
                height: num(size["@height"]),
                marginLeft: num(margin["@left"]),
                marginRight: num(margin["@right"]),
                marginTop: num(margin["@top"]),
                marginBottom: num(margin["@bottom"]),
                paragraphs,
              });
              walk(tc, current);
            }
          }
          continue;
        }
        walk(child, inTable);
      }
    }
  };
  walk(section, null);
  return cells;
}

async function main() {
  const { allFields } = await import("../src/lib/data/formWriting");
  const { SOCIAL_SECURITY_TEMPLATE } = await import("../src/lib/data/formWritingSocialSecurity");
  const { VOUCHER_TEMPLATE } = await import("../src/lib/data/formWritingVoucher");
  const templates = { "rule-3211495": SOCIAL_SECURITY_TEMPLATE, "rule-3211501": VOUCHER_TEMPLATE } as const;

  const out: Record<string, Record<string, number>> = {};
  for (const source of SOURCES) {
    const original = readFileSync(source.path);
    if (createHash("sha256").update(original).digest("hex") !== source.sha256) throw new Error("Unreviewed original SHA");
    const files = unzipSync(original);
    const { chars, paras } = styles(strFromU8(files["Contents/header.xml"]));
    const cells = geometry(strFromU8(files["Contents/section0.xml"]));
    const budgets: Record<string, number> = {};
    for (const field of allFields(templates[source.id as keyof typeof templates])) {
      const slot = field.slot;
      if (slot.kind !== "text" && slot.kind !== "prefix") continue;
      const cellKey = `T${slot.at.table}r${slot.at.rowAddr}c${slot.at.colAddr}`;
      const cell = cells.get(cellKey);
      if (!cell) throw new Error(`칸을 찾지 못했습니다: ${source.id} ${cellKey}`);
      const paragraph = cell.paragraphs[slot.at.p];
      if (!paragraph) throw new Error(`줄을 찾지 못했습니다: ${source.id} ${cellKey}p${slot.at.p}`);
      const style = chars.get(paragraph.charPrIDRef);
      const para = paras.get(paragraph.paraPrIDRef) ?? { left: 0, right: 0, indent: 0, lineSpacing: 130 };
      if (!style) throw new Error(`글자 모양을 찾지 못했습니다: ${source.id} ${cellKey}`);
      const usable = cell.width - cell.marginLeft - cell.marginRight - para.left - para.right - Math.max(0, para.indent);
      // 반각 한 칸의 너비 = 글자 높이 × 장평 ÷ 2 (자간이 음수면 글자가 더 좁아지지만 여유로 남긴다)
      const unit = (style.height * style.ratioHangul) / 100 / 2;
      const perLine = Math.floor(usable / unit);
      // 칸 높이가 허용하는 줄 수에서, 같은 칸의 다른 줄이 이미 쓰는 만큼을 뺀다.
      const usableHeight = cell.height - cell.marginTop - cell.marginBottom;
      const lineHeight = (style.height * para.lineSpacing) / 100;
      const others = cell.paragraphs.reduce((sum, other, index) => {
        if (index === slot.at.p) return sum;
        const otherStyle = chars.get(other.charPrIDRef) ?? style;
        const otherPerLine = Math.max(1, Math.floor(usable / ((otherStyle.height * otherStyle.ratioHangul) / 100 / 2)));
        return sum + Math.max(1, Math.ceil(width(other.text) / otherPerLine));
      }, 0);
      const lines = Math.max(1, Math.floor(usableHeight / lineHeight) - others);
      const printed = width(slot.expect);
      const units = Math.max(0, perLine - printed);
      budgets[`${slot.at.table}/${slot.at.rowAddr}/${slot.at.colAddr}/${slot.at.p}`] = units;
      console.log(`${source.id} ${cellKey}p${slot.at.p} ${field.key} perLine=${perLine} lines=${lines} units=${units} (등록부 ${field.slot.kind === "check" ? 0 : (field.slot as { max?: number }).max})`);
    }
    out[source.id] = budgets;
  }

  const body = Object.entries(out).map(([id, map]) => {
    const rows = Object.entries(map).map(([key, value]) => `    ${JSON.stringify(key)}: ${value},`);
    return `  ${JSON.stringify(id)}: {\n${rows.join("\n")}\n  },`;
  }).join("\n");
  writeFileSync(OUT, `/**
 * 원본 서식 칸에 실제로 들어가는 너비 (자동 생성 — 손으로 고치지 않는다).
 *
 * scripts/build-form-writing-width.ts 가 원본 HWPX의 표 칸 너비·여백과
 * 그 칸 글자 모양(글자 높이·장평)에서 계산한다. 값은 반각 칸 수로,
 * 한글 한 글자가 2, 영문·숫자·공백이 1이다. 글자 크기와 칸 크기는 바꾸지 않는다.
 */
const WIDTH: Record<string, Record<string, number>> = {
${body}
};

/** 글자의 너비를 반각 칸 수로 센다. */
export function textWidth(value: string): number {
  let total = 0;
  for (const char of value) total += char.codePointAt(0)! < 0x100 ? 1 : 2;
  return total;
}

export function cellWidthBudget(formId: string, key: string): number {
  const value = WIDTH[formId]?.[key];
  if (value === undefined) throw new Error(\`칸 너비를 찾지 못했습니다: \${formId} \${key}\`);
  return value;
}
`, "utf8");
}

main();

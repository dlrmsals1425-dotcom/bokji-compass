/**
 * src/lib/data/formWritingSource.ts 를 원본 HWPX에서 그대로 떠서 만든다.
 *
 * 1단계: 두 원본의 모든 표/칸/줄 글자를 담은 전체 스냅샷을 쓴다.
 * 2단계: 등록부가 실제로 쓰는 자리만 남기고 다시 쓴다.
 *
 *   npx tsx scripts/build-form-writing-source.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { indexSection } from "../src/lib/client/hwpxXml";

const OUT = "src/lib/data/formWritingSource.ts";
const SOURCES = [
  { id: "rule-3211495", path: "pipeline/forms/originals/rule-3211495.hwpx", sha256: "05a5fb88ab3199783d66d5fc77af32f425c07ba34552203d9ca4a2546e3bc1be" },
  { id: "rule-3211501", path: "pipeline/forms/originals/rule-3211501.hwpx", sha256: "f922a89ff89c09bfb6325d493d03104bdc23c123fc1c4b469bfc77bb1597bde1" },
];

function snapshot(path: string) {
  const original = readFileSync(path);
  const approved = SOURCES.find(source => source.path === path);
  if (!approved || createHash("sha256").update(original).digest("hex") !== approved.sha256) throw new Error("Unreviewed original SHA");
  const files = unzipSync(original);
  const index = indexSection(strFromU8(files["Contents/section0.xml"]));
  const out: Record<string, string> = {};
  index.tables.forEach((table, t) => {
    for (const row of table.rows) {
      for (const cell of row) {
        cell.paragraphs.forEach((paragraph, p) => {
          out[`T${t}r${cell.row}c${cell.col}p${p}`] = paragraph.text;
        });
      }
    }
  });
  return { map: out, paragraphCount: index.paragraphCount, tableCount: index.tableCount };
}

function emit(maps: Record<string, Record<string, string>>) {
  const body = Object.entries(maps).map(([id, map]) => {
    const rows = Object.entries(map).map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
    return `  ${JSON.stringify(id)}: {\n${rows.join("\n")}\n  },`;
  }).join("\n");
  writeFileSync(OUT, `/**
 * 원본 서식에 지금 적혀 있는 글자 (자동 생성 — 손으로 고치지 않는다).
 *
 * scripts/build-form-writing-source.ts 가 공개된 원본 HWPX에서 그대로 떠 온다.
 * 등록부는 이 글자와 원본이 같을 때만 그 자리에 값을 써 넣는다.
 */
const SOURCE: Record<string, Record<string, string>> = {
${body}
};

export function sourceText(formId: string, key: string): string {
  const value = SOURCE[formId]?.[key];
  if (value === undefined) throw new Error(\`원본 글자를 찾지 못했습니다: \${formId} \${key}\`);
  return value;
}
`, "utf8");
}

const full: Record<string, Record<string, string>> = {};
for (const source of SOURCES) {
  const result = snapshot(source.path);
  full[source.id] = result.map;
  console.log(`${source.id}: tables=${result.tableCount} paragraphs=${result.paragraphCount} cells=${Object.keys(result.map).length}`);
}
emit(full);

async function prune() {
const { allChecks, allFields } = await import("../src/lib/data/formWriting");
const { SOCIAL_SECURITY_TEMPLATE } = await import("../src/lib/data/formWritingSocialSecurity");
const { VOUCHER_TEMPLATE } = await import("../src/lib/data/formWritingVoucher");

const pruned: Record<string, Record<string, string>> = {};
for (const template of [SOCIAL_SECURITY_TEMPLATE, VOUCHER_TEMPLATE]) {
  const keep: Record<string, string> = {};
  const slots = [...allFields(template).map(f => f.slot), ...allChecks(template).map(c => c.slot)];
  for (const slot of slots) {
    const key = `T${slot.at.table}r${slot.at.rowAddr}c${slot.at.colAddr}p${slot.at.p}`;
    const value = full[template.formId][key];
    if (value === undefined) throw new Error(`등록부가 가리키는 자리가 원본에 없습니다: ${template.formId} ${key}`);
    keep[key] = value;
  }
  pruned[template.formId] = keep;
  console.log(`${template.formId}: 쓰는 자리 ${Object.keys(keep).length}곳`);
}
emit(pruned);
}
prune();

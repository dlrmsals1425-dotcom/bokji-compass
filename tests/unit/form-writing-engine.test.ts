import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { unzipSync, strFromU8 } from "fflate";
import { WRITING_TEMPLATES, writingTemplate } from "@/lib/data/formWritingRegistry";
import { allChecks, allFields, exclusiveSets, slotBudget, textWidth, type WritingTemplate } from "@/lib/data/formWriting";
import { buildFilledHwpx, buildFilledSection, fieldError, registrationField } from "@/lib/client/hwpxWriter";
import { buildPreviewText } from "@/lib/client/hwpxPreview";
import { findParagraph, indexSection } from "@/lib/client/hwpxXml";

const ORIGINAL = (id: string) => `pipeline/forms/originals/${id}.hwpx`;
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const read = (path: string) => new Uint8Array(readFileSync(path));
const section = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)["Contents/section0.xml"]);

/** ZIP 첫 항목의 지역 헤더를 직접 읽어 mimetype이 압축 없이 맨 앞에 있는지 본다. */
function firstZipEntry(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  const method = view.getUint16(8, true);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const name = strFromU8(bytes.slice(30, 30 + nameLength));
  return { method, name, extraLength };
}

/** 모든 칸을 글자 수 한도까지 채우고 모든 표시칸을 고른 입력 (최대 입력 시험용) */
function maximumInput(template: WritingTemplate) {
  const values: Record<string, string> = {};
  for (const field of allFields(template)) {
    const budget = slotBudget(template.formId, field.slot);
    // 한글로 꽉 채우고, 남는 반각 한 칸은 숫자로 메워 실제 최대 너비를 만든다.
    values[field.key] = registrationField(field) ? "000000-0000000" : field.input === "tel" ? "010-0000-0000" : "가".repeat(Math.floor(budget / 2)) + (budget % 2 ? "1" : "");
  }
  const checks: Record<string, boolean> = {};
  for (const item of allChecks(template)) checks[item.key] = true;
  for (const set of exclusiveSets(template)) for (const key of set.slice(1)) checks[key] = false;
  return { values, checks };
}

describe.each(WRITING_TEMPLATES)("$formId 원본과 매핑", template => {
  const bytes = read(ORIGINAL(template.formId));
  const published = read(`public${template.asset.path}`);

  it("등록해 둔 바이트 수·SHA-256이 공개된 원본과 같다", () => {
    expect(bytes.byteLength).toBe(template.asset.bytes);
    expect(sha256(bytes)).toBe(template.asset.sha256);
    expect(published.byteLength).toBe(template.asset.bytes);
    expect(sha256(published)).toBe(template.asset.sha256);
  });

  it("표 수와 문단 수가 등록해 둔 값과 같다", () => {
    const index = indexSection(section(bytes));
    expect(index.tableCount).toBe(template.tableCount);
    expect(index.paragraphCount).toBe(template.paragraphCount);
  });

  it("모든 입력칸·표시칸이 원본의 실제 글자와 맞는다", () => {
    const index = indexSection(section(bytes));
    const slots = [...allFields(template).map(f => f.slot), ...allChecks(template).map(c => c.slot)];
    expect(slots.length).toBeGreaterThan(80);
    for (const slot of slots) {
      const paragraph = findParagraph(index, slot.at.table, slot.at.rowAddr, slot.at.colAddr, slot.at.p);
      expect(paragraph.text, JSON.stringify(slot.at)).toBe(slot.expect);
      if (slot.kind === "inline") {
        const blank = slot.expect.slice(slot.from, slot.to);
        expect(blank, `${JSON.stringify(slot.at)} ${slot.from}-${slot.to}`).toBe(slot.pad.repeat(slot.to - slot.from));
      }
      if (slot.kind === "check") {
        expect([...slot.expect.matchAll(/\[ *\]/g)].length, JSON.stringify(slot.at)).toBeGreaterThan(slot.box);
      }
    }
  });

  it("입력칸 이름(key)이 겹치지 않는다", () => {
    const keys = [...allFields(template).map(f => f.key), ...allChecks(template).map(c => c.key)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("원본 그대로 미리보기 글을 다시 만들면 원본 미리보기와 똑같다", () => {
    const files = unzipSync(bytes);
    const original = strFromU8(files["Preview/PrvText.txt"]);
    expect(buildPreviewText(indexSection(section(bytes)), template.previewTextLimit)).toBe(original);
  });

  it("모든 칸을 최대 길이로 채우고 모든 표시칸을 골라도 문단·표 수가 그대로다", () => {
    const after = indexSection(buildFilledSection(template, section(bytes), maximumInput(template)));
    expect(after.paragraphCount).toBe(template.paragraphCount);
    expect(after.tableCount).toBe(template.tableCount);
  });

  it("문장 가운데 빈칸을 끝까지 채워도 그 줄의 길이가 늘지 않는다", () => {
    const input = maximumInput(template);
    const after = indexSection(buildFilledSection(template, section(bytes), { values: input.values, checks: {} }));
    for (const field of allFields(template)) {
      if (field.slot.kind !== "inline") continue;
      const paragraph = findParagraph(after, field.slot.at.table, field.slot.at.rowAddr, field.slot.at.colAddr, field.slot.at.p);
      expect(textWidth(paragraph.text), field.key).toBe(textWidth(field.slot.expect));
    }
  });
});

describe("사회보장급여 신청(변경)서 채우기", () => {
  const template = writingTemplate("rule-3211495")!;
  const bytes = read(ORIGINAL(template.formId));
  const input = {
    values: {
      "a.name": "홍길동",
      "a.rrn": "000000-0000000",
      "a.house": "본인",
      "a.tel": "010-0000-0000",
      "a.addr": "서울특별시 종로구 세종대로 000",
      "a.addr2": "서울특별시 종로구 사직로 000",
      "a.mobile": "010-0000-0000",
      "a.email": "a@b.invalid",
      "fam0.name": "홍길순",
      "fam0.rel": "배우자",
      "sup0.rel": "아들",
      "sup0.name": "홍길서",
      "acc0.bank": "○○은행",
      "acc0.number": "000-00-0000000",
      "nt.otherText": "방문 수령",
      "nat.passport1": "홍길남",
      "b.childAllowance.1": "홍길북",
      "s.year": "2026",
      "s.month": "10",
      "s.day": "20",
      "s.name": "홍길동",
    },
    checks: { "sp.legal": true, "nt.sms": true, "nt.other": true, "b.living": true, "b.childAllowance": true, "c.privacy": true, "c.notice": true },
  };
  let result: Awaited<ReturnType<typeof buildFilledHwpx>>;
  let files: Record<string, Uint8Array>;
  let filledSection: string;
  let index: ReturnType<typeof indexSection>;
  beforeAll(async () => {
    result = await buildFilledHwpx(template, bytes, input);
    files = unzipSync(result.bytes);
    filledSection = strFromU8(files["Contents/section0.xml"]);
    index = indexSection(filledSection);
  });
  const cell = (t: number, r: number, c: number, p = 0) => findParagraph(index, t, r, c, p).text;

  it("새 이름으로 내보내고 원본 파일은 그대로다", () => {
    expect(result.fileName).toBe("사회보장급여 신청(변경)서_작성본.hwpx");
    expect(sha256(read(ORIGINAL(template.formId)))).toBe(template.asset.sha256);
    expect(result.bytes).not.toEqual(bytes);
  });

  it("mimetype이 압축 없이 맨 앞에 있고 내용이 한글 꾸러미다", () => {
    const first = firstZipEntry(result.bytes);
    expect(first.name).toBe("mimetype");
    expect(first.method).toBe(0);
    expect(strFromU8(files["mimetype"])).toBe("application/hwp+zip");
    expect(Object.keys(files)[0]).toBe("mimetype");
  });

  it("본문 XML을 그대로 읽을 수 있다", () => {
    const parser = new XMLParser({ ignoreAttributes: false });
    expect(() => parser.parse(filledSection)).not.toThrow();
    for (const name of Object.keys(files)) {
      if (!name.endsWith(".xml") && !name.endsWith(".hpf") && !name.endsWith(".rdf")) continue;
      expect(() => parser.parse(strFromU8(files[name])), name).not.toThrow();
    }
  });

  it("적은 값이 원본의 정확한 칸에 들어간다", () => {
    expect(cell(0, 5, 2)).toBe("홍길동");
    expect(cell(0, 5, 5)).toBe("000000-0000000");
    expect(cell(0, 5, 8)).toBe("본인");
    expect(cell(0, 5, 10)).toBe("010-0000-0000");
    expect(cell(0, 6, 2)).toBe("서울특별시 종로구 세종대로 000");
    expect(cell(0, 6, 10)).toBe("010-0000-0000");
    expect(cell(0, 7, 10)).toBe("a@b.invalid");
    expect(cell(0, 11, 3)).toBe("홍길순");
    expect(cell(0, 11, 1)).toBe("배우자");
    expect(cell(0, 24, 4)).toBe("○○은행");
    expect(cell(0, 24, 6)).toBe("000-00-0000000");
  });

  it("문장 가운데 빈칸은 길이를 지킨 채 채운다", () => {
    const live = cell(0, 6, 2, 2);
    const original = indexSection(section(bytes));
    expect(live.startsWith("(실거주지 주소1):서울특별시 종로구 사직로 000")).toBe(true);
    expect(live.endsWith(")")).toBe(true);
    expect(textWidth(live)).toBe(textWidth(findParagraph(original, 0, 6, 2, 2).text));
    expect(cell(0, 15, 1, 0)).toContain("홍길남");
  });

  it("작성일은 '년·월·일' 바로 앞에 붙는다", () => {
    expect(cell(2, 24, 0, 2)).toMatch(/2026년\s+10월\s+20일$/);
    expect(cell(2, 24, 0, 4)).toMatch(/성명:홍길동\s+\(서명 또는 인\)/);
  });

  it("고른 표시칸만 √로 바뀐다 (공백 두 칸이 √ 한 글자로 — 한글 글꼴에서 폭이 같다)", () => {
    expect(cell(0, 15, 1, 0)).toContain("([√]법률혼  [  ]사실혼  [  ]사실상 이혼)");
    expect(cell(0, 26, 3)).toContain("[  ] 서면   [  ] 전자우편(E-mail)   [√] 문자메시지서비스(SMS)");
    expect(cell(1, 2, 2)).toContain("[√] 생계급여   [  ] 의료급여");
    expect(cell(1, 26, 9)).toBe("[√ ]");
    expect(cell(2, 15, 2)).toBe("[√ ]");
    expect(cell(2, 2, 2)).toBe("[   ]");
  });

  it("같은 문단의 다른 표시칸과 안내 문구는 그대로 남는다", () => {
    expect(cell(1, 5, 2)).toMatch(/\[√\] 지급대상아동이름: ①홍길북\s+②\s+③/);
    expect(cell(0, 2, 0)).toContain("※ [  ]에는 해당되는 곳에 √ 표시를 합니다.");
  });

  it("법령 문구·작성방법·안내사항은 한 글자도 바뀌지 않는다", () => {
    const before = indexSection(section(bytes));
    const texts = (idx: ReturnType<typeof indexSection>, t: number, r: number, c: number) =>
      idx.tables[t].rows.flat().find(cell => cell.row === r && cell.col === c)!.paragraphs.map(p => p.text);
    expect(texts(index, 0, 29, 0)).toEqual(texts(before, 0, 29, 0));
    expect(texts(index, 2, 26, 0)).toEqual(texts(before, 2, 26, 0));
    expect(texts(index, 3, 13, 3)).toEqual(texts(before, 3, 13, 3));
    expect(texts(index, 1, 26, 0)).toEqual(texts(before, 1, 26, 0));
  });

  it("스타일·꾸러미 구성 파일은 원본 그대로다", () => {
    const original = unzipSync(bytes);
    for (const name of ["Contents/header.xml", "Contents/content.hpf", "META-INF/manifest.xml", "META-INF/container.xml", "META-INF/container.rdf", "settings.xml", "version.xml"]) {
      expect(files[name], name).toEqual(original[name]);
    }
    expect(Object.keys(files)).toEqual(Object.keys(original));
  });

  it("미리보기 글이 새 내용으로 바뀐다", () => {
    const preview = strFromU8(files["Preview/PrvText.txt"]);
    const original = strFromU8(unzipSync(bytes)["Preview/PrvText.txt"]);
    expect(preview).not.toBe(original);
    expect(preview).toContain("홍길동");
    expect(preview.length).toBeLessThanOrEqual(template.previewTextLimit);
  });
});

describe("사회보장급여(사회서비스이용권) 신청(변경)서 채우기", () => {
  const template = writingTemplate("rule-3211501")!;
  const bytes = read(ORIGINAL(template.formId));
  let result: Awaited<ReturnType<typeof buildFilledHwpx>>;
  let files: Record<string, Uint8Array>;
  let index: ReturnType<typeof indexSection>;
  const input = {
    values: {
      "a.name": "홍길동",
      "a.rrn": "000000-0000000",
      "a.addr": "서울특별시 종로구 세종대로 000",
      "acc.bank": "○○은행",
      "acc.number": "000-00-0000000",
      "cc0.name": "홍길동아",
      "pp.year": "2026",
      "pp.month": "10",
      "pp.day": "20",
      "s.year": "2026",
      "s.month": "10",
      "s.day": "20",
      "s.name": "홍길동",
      "s.rel": "모",
    },
    checks: { "s.childcare": true, "s.postpartum": true, "cc0.basic": true, "cc0.kinder": true, "c.privacy": true, "c.n1": true },
  };
  beforeAll(async () => {
    result = await buildFilledHwpx(template, bytes, input);
    files = unzipSync(result.bytes);
    index = indexSection(strFromU8(files["Contents/section0.xml"]));
  });
  const cell = (t: number, r: number, c: number, p = 0) => findParagraph(index, t, r, c, p).text;

  it("mimetype이 압축 없이 맨 앞에 있다", () => {
    const first = firstZipEntry(result.bytes);
    expect(first.name).toBe("mimetype");
    expect(first.method).toBe(0);
  });

  it("적은 값이 정확한 칸에 들어간다", () => {
    expect(result.fileName).toBe("사회보장급여(사회서비스이용권) 신청(변경)서_작성본.hwpx");
    expect(cell(0, 3, 3)).toBe("홍길동");
    expect(cell(0, 3, 9)).toBe("000000-0000000");
    expect(cell(0, 4, 3)).toBe("서울특별시 종로구 세종대로 000");
    expect(cell(0, 13, 10)).toBe("○○은행");
    expect(cell(0, 16, 5)).toBe("홍길동아");
  });

  it("같은 문구가 여러 줄에 반복돼도 고른 줄만 바뀐다", () => {
    expect(cell(0, 16, 8)).toContain("[√] 어린이집(0∼2세) 기본");
    expect(cell(0, 17, 8)).toContain("[  ] 어린이집(0∼2세) 기본");
    expect(cell(0, 18, 8)).toContain("[  ] 어린이집(0∼2세) 기본");
    expect(cell(0, 16, 8, 1)).toContain("[√] 유치원 유아학비(3∼5세)");
    expect(cell(0, 15, 2)).toBe("[√]");
  });

  it("두 군데 날짜가 각각 들어간다", () => {
    expect(cell(1, 34, 8)).toMatch(/2026년\s+10월\s+20일$/);
    expect(cell(2, 10, 0, 1)).toMatch(/2026년\s+10월\s+20일$/);
    expect(cell(2, 10, 0, 3)).toMatch(/성명 :홍길동\s+\(서명 또는 인\)/);
    expect(cell(2, 10, 0, 4)).toMatch(/신청인과의 관계 :모\s+\(대리 신청의 경우\)/);
  });

  it("동의·유의사항은 고른 것만 체크된다", () => {
    expect(cell(2, 2, 2)).toBe("[√ ]");
    expect(cell(2, 4, 2)).toBe("[√]");
    expect(cell(2, 5, 2)).toBe("[  ]");
  });
});

describe("안전장치", () => {
  const template = writingTemplate("rule-3211495")!;
  const bytes = read(ORIGINAL(template.formId));

  it("등록부에 없는 서식은 작성할 수 없다", () => {
    expect(writingTemplate("ordin-19970267")).toBeNull();
    expect(writingTemplate(undefined)).toBeNull();
  });

  it("쓰기로 한 자리의 원문이 달라지면 비슷한 자리를 찾지 않고 멈춘다", () => {
    // 이미 다른 내용이 적혀 있는(= 등록해 둔 원문과 다른) 원본을 흉내 낸다.
    const tampered = buildFilledSection(template, section(bytes), { values: { "a.name": "다른 값" }, checks: {} });
    expect(tampered).not.toBe(section(bytes));
    expect(() => buildFilledSection(template, tampered, { values: { "a.name": "홍길동" }, checks: {} }))
      .toThrowError(/원본 서식/);
  });

  it("문단 수가 달라진 원본은 작성하지 않는다", () => {
    const extra = section(bytes).replace("</hs:sec>", '<hp:p id="1" paraPrIDRef="0" styleIDRef="0"><hp:run charPrIDRef="0"><hp:t/></hp:run></hp:p></hs:sec>');
    expect(() => buildFilledSection(template, extra, { values: { "a.name": "홍길동" }, checks: {} }))
      .toThrowError(/구성/);
  });

  it("원본 크기가 공개된 값과 다르면 작성하지 않는다", async () => {
    const shorter = bytes.slice(0, bytes.byteLength - 1);
    await expect(buildFilledHwpx(template, shorter, { values: {}, checks: {} })).rejects.toThrowError(/크기/);
  });

  it("칸 길이를 넘는 값은 잘라내지 않고 막는다", () => {
    const field = allFields(template).find(item => item.key === "a.name")!;
    const max = Math.floor(slotBudget(template.formId, field.slot) / 2);
    expect(fieldError(template, field, "가".repeat(max))).toBeNull();
    expect(fieldError(template, field, "가".repeat(max + 1))).toMatch(/원본 서식 칸/);
    expect(() => buildFilledSection(template, section(bytes), { values: { "a.name": "가".repeat(99) }, checks: {} }))
      .toThrowError(/원본 서식 칸/);
  });

  it("XML에 쓰이는 글자를 넣어도 문서가 깨지지 않는다", () => {
    const filled = buildFilledSection(template, section(bytes), { values: { "a.name": "<&>\"'" }, checks: {} });
    expect(filled).toContain("&lt;&amp;&gt;");
    expect(findParagraph(indexSection(filled), 0, 5, 2, 0).text).toBe("<&>\"'");
  });

  it("아무것도 적지 않으면 본문이 원본과 똑같다", () => {
    expect(buildFilledSection(template, section(bytes), { values: {}, checks: {} })).toBe(section(bytes));
  });
});

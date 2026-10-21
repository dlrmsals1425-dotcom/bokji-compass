import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WRITING_TEMPLATES, canWriteForm, writingTemplate } from "@/lib/data/formWritingRegistry";
import { formAssetUrl } from "@/lib/data/formPublication";
import type { ApplicationForm, FormsRegionBundle } from "@/lib/data/forms";

const catalog = JSON.parse(readFileSync("public/forms/v1/catalog.json", "utf8")) as { forms: Record<string, ApplicationForm> };
const bundles = readdirSync("public/forms/v1/programs")
  .map(name => JSON.parse(readFileSync(`public/forms/v1/programs/${name}`, "utf8")) as FormsRegionBundle);

describe.each(WRITING_TEMPLATES)("$formId 공개 자료와의 연결", template => {
  const form = catalog.forms[template.formId];

  it("공개 목록의 원본 파일 정보와 등록부가 완전히 같다", () => {
    expect(form).toBeTruthy();
    expect(form.role).toBe("application");
    expect(form.file?.format).toBe("hwpx");
    expect(form.file?.bytes).toBe(template.asset.bytes);
    expect(form.file?.sha256).toBe(template.asset.sha256);
    expect(formAssetUrl(form.file?.hwp)).toBe(template.asset.path);
    expect(form.title).toBe(template.title);
    expect(form.lawTitle).toBe(template.lawTitle);
  });

  it("이 서식을 쓰는 공개된 사업이 실제로 있다", () => {
    const linked = bundles.flatMap(bundle => bundle.programs)
      .filter(program => program.links.some(link => link.formId === template.formId));
    expect(linked.length).toBeGreaterThan(0);
    for (const program of linked) expect(program.status).toBe("available");
  });
});

describe("작성 가능 여부 판단", () => {
  it("등록부에 없는 서식은 작성 대상이 아니다", () => {
    const others = Object.values(catalog.forms).filter(form => !canWriteForm(form.id));
    expect(others.length).toBeGreaterThan(100);
    expect(canWriteForm("ordin-19970267")).toBe(false);
    expect(writingTemplate("rule-3211495")).toBeTruthy();
  });

  it("한글 원본(HWPX)이 아닌 서식은 등록부에 없다", () => {
    for (const template of WRITING_TEMPLATES) {
      expect(template.asset.path.endsWith(".hwpx")).toBe(true);
      expect(catalog.forms[template.formId].file?.format).toBe("hwpx");
    }
    const hwpOnly = Object.values(catalog.forms).filter(form => form.file?.format === "hwp");
    expect(hwpOnly.some(form => canWriteForm(form.id))).toBe(false);
  });
});

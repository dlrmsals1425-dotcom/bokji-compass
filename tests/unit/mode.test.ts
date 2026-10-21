import { describe, expect, it } from "vitest";
import {
  METHOD_ENTRY, MODE_ENTRY, checkPath, isParentMode, parseFindMode, resultsCopy, resultsPath, withV1, wizardCopy,
} from "@/lib/client/mode";
import { PRESETS } from "@/lib/client/presets";

describe("찾기 모드 (본인 / 부모님)", () => {
  it("parseFindMode는 parent|self만 인정", () => {
    expect(parseFindMode("parent")).toBe("parent");
    expect(parseFindMode("self")).toBe("self");
    expect(parseFindMode("other")).toBeNull();
    expect(parseFindMode(null)).toBeNull();
  });

  it("경로 헬퍼가 for=parent를 붙인다", () => {
    expect(checkPath("parent")).toBe("/situation?for=parent&details=1");
    expect(checkPath("self")).toBe("/situation?for=self&details=1");
    expect(withV1("/results?for=parent")).toBe("/results?for=parent&v=1");
    expect(withV1("/check")).toBe("/check?v=1");
    expect(resultsPath("parent")).toBe("/results?for=parent");
    expect(resultsPath("self", "suwon-senior")).toBe("/results?example=suwon-senior");
    expect(resultsPath("parent", "parent-care")).toBe("/results?for=parent&example=parent-care");
  });

  it("부모님 모드 입력 문구는 부모님 기준이고 장애 라벨이 바뀐다", () => {
    const w = wizardCopy("parent");
    expect(w.pageTitle).toContain("부모님");
    expect(w.ageLegend).toBe("부모님 나이");
    expect(w.disabilityLabels.self).toBe("부모님 본인");
    expect(wizardCopy("self").ageLegend).toBe("본인 나이");
  });

  it("부모님 모드 결과 문구·대리 신청 안내", () => {
    const r = resultsCopy("parent");
    expect(r.h1Suffix).toContain("부모님께 신청해 드릴 수 있는");
    expect(r.picksTitle(5)).toContain("부모님께");
    expect(r.proxyNote).toMatch(/주민센터|129/);
    expect(r.proxyNote).toMatch(/법률 자문이 아닙니다/);
    expect(resultsCopy("self").proxyNote).toBeNull();
  });

  it("홈 CTA와 parent-care 프리셋", () => {
    expect(MODE_ENTRY.parent.href).toBe("/situation?for=parent");
    expect(MODE_ENTRY.self.href).toBe("/situation?for=self");
    // 홈 두 갈래 (2026-10-16): 누구를 위해는 각 방법 안에서 — 주소에 입력을 싣지 않는다
    expect(METHOD_ENTRY.talk.href).toBe("/situation");
    expect(METHOD_ENTRY.guided.href).toBe("/ask");
    expect(isParentMode("parent")).toBe(true);
    const pc = PRESETS.find((p) => p.id === "parent-care");
    expect(pc?.mode).toBe("parent");
    expect(pc?.profile.age).toBe("70-74");
    expect(pc?.profile.care).toEqual(["daily"]);
    expect(pc?.profile.sigungu).toBe("41110");
  });
});

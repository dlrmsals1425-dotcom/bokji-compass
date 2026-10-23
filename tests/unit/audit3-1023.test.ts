/** (2026-10-23 외부 3차 점검) 문의처 번호 안내 · 잘린 인용 · '답하면 정해져요' 문장 · 검색 묶기 · 예시 제목 */
import { describe, expect, it } from "vitest";
import { clipText, contactNote, quoteEdge, tidyQuote } from "@/lib/data/text";
import { askLine } from "@/lib/client/v2";
import { groupByName } from "@/lib/client/results";
import { PRESETS, presetAt } from "@/lib/client/presets";
import type { Program } from "@/lib/data/types";

describe("문의처: 보건복지상담센터 번호가 129가 아니면 알림 (원문은 그대로)", () => {
  it("정부24 원문 '보건복지상담센터 ☎ 139'", () => {
    expect(contactNote("한국실명예방재단 ☎ 02-718-1102\n보건복지상담센터 ☎ 139")).toBe("보건복지상담센터 번호는 129예요. 원문에는 139번으로 적혀 있어요.");
  });
  it("129면 알리지 않음", () => {
    expect(contactNote("보건복지상담센터 ☎ 129")).toBeNull();
    expect(contactNote("보건복지부 상담센터 129")).toBeNull();
    expect(contactNote(undefined)).toBeNull();
  });
});

describe("잘린 원문 인용은 낱말 단위로", () => {
  it("'수도권(서울·경기·인…' → 닫히지 않은 괄호 앞에서", () => {
    const q = "…연간 최대 28만원(분기별 7만원) 버스비 지원 · 수도권(서울·경기·인…";
    expect(quoteEdge(q)).toBe("…연간 최대 28만원(분기별 7만원) 버스비 지원 · 수도권…");
  });
  it("잘리지 않은 인용은 그대로", () => {
    expect(quoteEdge("월 10만원 지원")).toBe("월 10만원 지원");
  });
  it("긴 근거 구절: 글머리표 정리 후 띄어쓰기에서 끊음", () => {
    const s = tidyQuote("○ 노인 안검진 사업 지원대상 : 만 60세 이상 모든 노령자(저소득층 우선) ○ 검진대상자 우선순위");
    expect(s.startsWith("노인 안검진")).toBe(true);
    expect(s).not.toContain("○");
    const c = clipText("가나다 라마바 사아자 차카타 파하", 14);
    expect(c).toBe("가나다 라마바 사아자…");
  });
});

describe("'답하면 정해져요' 한 줄", () => {
  it("원문 대상 요건 확인은 '…에 해당하면'", () => {
    expect(askLine("원문의 대상 요건 확인 ('학대' 등)")).toBe("원문의 대상 요건('학대' 등)에 해당하면 받을 수 있어요.");
  });
  it("보통 조건은 그대로 '…이면'", () => {
    expect(askLine("만 65세 이상")).toBe("만 65세 이상이면 받을 수 있어요.");
  });
});

describe("검색: 같은 제도를 여러 곳이 안내하면 한 카드로", () => {
  const P = (id: string, name: string, scope: "national" | "local" = "national") => ({ id, name, scope }) as unknown as Program;
  it("햇살론일반(정부24) · 햇살론일반(복지로), 노인 안검진 및 개안수술 · 노인 안검진·개안수술", () => {
    const g = groupByName([P("g1", "햇살론일반"), P("g2", "햇살론카드"), P("b1", "햇살론일반"), P("g3", "노인 안검진 및 개안수술"), P("w1", "노인 안검진·개안수술")]);
    expect(g.map((x) => [x.lead.id, x.variants.map((v) => v.id)])).toEqual([["g1", ["b1"]], ["g2", []], ["g3", ["w1"]]]);
  });
  it("전국 사업과 지역 사업은 이름이 같아도 따로", () => {
    expect(groupByName([P("n", "교통비 지원"), P("l", "교통비 지원", "local")])).toHaveLength(2);
  });
});

describe("예시 제목: 모두 '지역 + 상황'", () => {
  it("부모님 돌보기도 지역이 앞에", () => {
    const p0 = PRESETS.find((p) => p.id === "parent-care")!;
    expect(presetAt(p0, "41000", "41110", "경기 수원시").title).toBe("경기 수원시 부모님 돌보기");
  });
});

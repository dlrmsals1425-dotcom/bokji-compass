import { describe, expect, it } from "vitest";
import { firstLine, howTo, parseDocs } from "../../src/lib/client/howto";
import type { Program } from "../../src/lib/data/types";

const base = { id: "x", name: "테스트", summary: "", category: "기타", orgType: "central", scope: "national", sources: [], trust: "A", rule: { all: [] } } as unknown as Program;

describe("howTo: 신청 방법 요약", () => {
  it("주민센터 방문·온라인 신청을 알아본다", () => {
    const h = howTo({ ...base, applyMethod: "주소지 읍면동 행정복지센터 방문 또는 복지로 온라인 신청", contact: "보건복지상담센터 ☎ 129\n기타" }, base);
    expect(h.place).toBe("주소지 행정복지센터(주민센터)");
    expect(h.channels).toEqual(["visit", "online", "phone"]);
    expect(h.phone).toBe("보건복지상담센터 129");
    expect(h.fallback).toBe(false);
  });
  it("신청 정보가 없으면 주민센터(공공부조 계열)·담당 기관과 129 안내로 대신한다", () => {
    const h = howTo(undefined, base);
    expect(h.fallback).toBe(true);
    expect(h.place).toMatch(/주민센터|담당 기관/);
    expect(h.phone).toContain("129");
    expect(howTo(undefined, { ...base, name: "주거급여", applyMethod: undefined, contact: undefined, applyUrl: undefined }).place).toContain("주민센터");
  });
  it("구비 서류는 짧은 항목 4개까지", () => {
    expect(parseDocs("○ 신청서\n○ 신분증\n○ 통장 사본\n○ 가족관계증명서\n○ 임대차계약서")).toEqual(["신청서", "신분증", "통장 사본", "가족관계증명서"]);
    expect(parseDocs("해당없음")).toEqual([]);
  });
  it("첫 문장만 자른다", () => {
    expect(firstLine("어르신께 식사를 드립니다. 그리고 다른 것도 합니다.")).toBe("어르신께 식사를 드립니다.");
  });
});

/* QA 1차 H3: 원문이 다른 창구를 가리키면 주민센터로 바꾸지 않는다 */
import { placeOf } from "@/lib/client/howto";
describe("신청처 (QA 1차 H3)", () => {
  const P = (name: string, applyMethod: string, extra: Record<string, string> = {}) => placeOf({ name, applyMethod, ...extra }, applyMethod.includes("방문") ? ["visit"] : /온라인|홈페이지/.test(applyMethod) ? ["online"] : []);
  it.each([
    ["노인장기요양 재가급여 지원", "○ 방문 신청: 건강보험공단 관할 지사 방문", "국민건강보험공단 지사"],
    ["재해보상금", "○ 방문신청 : 주소지 관할 보훈지(방) 청", "관할 보훈(지)청"],
    ["공유형모기지 융자", "수탁은행(우리, 국민, 신한) 방문 신청", "수탁은행 창구"],
    ["예술인 출산전후급여", "가까운 고용센터를 방문하거나 온라인(고용24) 신청", "가까운 고용센터"],
    ["기획취재 지원", "한국언론진흥재단 미디어아카데미 온라인 접수 통해 신청", "온라인 신청 (한국언론진흥재단)"],
    ["기초연금", "읍면동 행정복지센터(주민센터), 국민연금공단지사 방문 또는 복지로 온라인 신청", "주소지 행정복지센터(주민센터) 또는 국민연금공단 지사"],
    ["청년 주거자금", "○ 방문 신청 - 주민등록지 읍면사무소 방문 신청", "주소지 행정복지센터(주민센터)"],
    ["무상교복", "별도 신청 절차 없음", "따로 신청하지 않아도 돼요"],
  ])("%s", (name, apply, want) => expect(P(name, apply)).toBe(want));
  it("원문에 신청 방법이 있지만 창구를 모르면 '원문에 적힌 곳', 비어 있으면 주민센터·이름으로", () => {
    expect(P("EM 발효액 배부", "방문 신청", { contact: "자원순환과 ☎ 031-000-0000" })).toBe("원문에 적힌 곳 (문의: 자원순환과)");
    expect(placeOf({ name: "노인장기요양보험", applyMethod: "" })).toBe("국민건강보험공단 지사");
    // QA 2차 N4: 신청 정보가 전혀 없으면 공공부조·돌봄·수당 계열만 주민센터, 그 밖에는 담당 기관
    expect(placeOf({ name: "어떤 사업", applyMethod: "" })).toBe("담당 기관에 문의 (☎129 안내)");
    expect(placeOf({ name: "국민기초생활보장 생계급여", applyMethod: "" })).toBe("주소지 행정복지센터(주민센터)");
    // 수동 보강 창구가 있으면 그대로
    expect(placeOf({ name: "실업급여", applyMethod: "고용24 …", applyPlace: "가까운 고용센터 (고용24에서 구직 등록 후 방문)" })).toContain("고용센터");
  });
});

describe("placeOf: '고용복지플러스센터'도 고용센터로 (준비물 한 장 묶음)", () => {
  it("국민내일배움카드 원문 그대로", () => {
    const apply = "거주지 읍/면/동 주민센터, 고용노동부 소속기관(관할 고용복지플러스센터) 에서 ‘서비스 신청’";
    expect(placeOf({ name: "국민내일배움카드제 직업훈련지원", applyMethod: apply })).toBe("주소지 행정복지센터(주민센터) 또는 가까운 고용센터");
    expect(placeOf({ name: "x", applyMethod: "가까운 고용복지+센터 방문" }, ["visit"])).toBe("가까운 고용센터");
  });
});

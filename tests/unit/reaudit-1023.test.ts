/** (2026-10-23 외부 재점검) 문의처 번호 중복 · 관련 주제 중복 · 근거 구절 글머리표 · 같은 제도 두 카드 · 서류 모음 담기 상태 · 시트 날짜 · 용어 */
import { describe, expect, it } from "vitest";
import { relatedTags, tidyContact, tidyQuote } from "@/lib/data/text";
import { variantKey } from "@/lib/client/results";
import { inSheet, toggleMark } from "@/lib/client/sheetMarks";
import { kstDate } from "@/lib/client/period";
import { incomeExplain } from "@/lib/client/v2";

describe("문의처: 같은 번호가 두 번 ('1644-6621 ☎ 1644-6621')", () => {
  it("부서명 자리에 번호가 들어가 같은 번호가 겹치면 하나만", () => {
    expect(tidyContact("1644-6621 ☎ 1644-6621")).toBe("☎ 1644-6621");
  });
  it("그대로: 부서명 ☎ 번호", () => {
    expect(tidyContact("한부모상담전화 ☎ 1577-4206")).toBe("한부모상담전화 ☎ 1577-4206");
  });
});

describe("관련 주제: '보육·교육'이 있으면 '보육'·'교육'은 다시 쓰지 않음", () => {
  it("묶음 주제의 부분은 빼고 나머지는 순서대로", () => {
    expect(relatedTags(["보육·교육", "현금", "보육", "교육", "생활지원||한부모·조손"])).toEqual(["보육·교육", "현금", "생활지원", "한부모·조손"]);
  });
});

describe("근거 구절: 원문 글머리표('○')는 가운뎃점으로", () => {
  it("○ 를 · 로, 맨 앞은 지움", () => {
    expect(tidyQuote("신청방법: ○ 읍면동 주민센터에 방문하거나 온라인으로 신청 ○ 신청 절차 - 소득재산조사 (시군구)")).toBe(
      "신청방법: 읍면동 주민센터에 방문하거나 온라인으로 신청 · 신청 절차 - 소득재산조사 (시군구)",
    );
    expect(tidyQuote("○ 대상: 만 65세 이상")).toBe("대상: 만 65세 이상");
  });
});

describe("같은 제도 ('노인 안검진 및 개안수술' 정부24 · '노인 안검진·개안수술' 복지제도100)", () => {
  it("한 묶음으로 보임", () => {
    expect(variantKey("노인 안검진 및 개안수술")).toBe(variantKey("노인 안검진·개안수술"));
  });
});

describe("신청 서류 모음 담기 상태 (상세 화면에서도 결과 화면과 같게)", () => {
  const picks = ["a", "b"];
  it("먼저 확인할 5가지는 빼지 않았으면 담김, 나머지는 직접 담았을 때만", () => {
    expect(inSheet("a", { add: [], remove: [] }, picks)).toBe(true);
    expect(inSheet("a", { add: [], remove: ["a"] }, picks)).toBe(false);
    expect(inSheet("c", { add: [], remove: [] }, picks)).toBe(false);
    expect(inSheet("c", { add: ["c"], remove: [] }, picks)).toBe(true);
  });
  it("담기·빼기", () => {
    expect(toggleMark({ add: [], remove: [] }, "a", false, picks)).toEqual({ add: [], remove: ["a"] });
    expect(toggleMark({ add: [], remove: ["a"] }, "a", true, picks)).toEqual({ add: [], remove: [] });
    expect(toggleMark({ add: [], remove: [] }, "c", true, picks)).toEqual({ add: ["c"], remove: [] });
    expect(toggleMark({ add: ["c"], remove: [] }, "c", false, picks)).toEqual({ add: [], remove: [] });
  });
});

describe("서류 모음 날짜는 한국 시간", () => {
  it("UTC 2026-10-22 15:30 = 한국 10월 23일 00:30", () => {
    expect(kstDate(new Date("2026-10-22T15:30:00Z"))).toBe("2026. 10. 23.");
    expect(kstDate(new Date("2026-10-22T14:30:00Z"))).toBe("2026. 10. 22.");
  });
});

describe("용어: '기준 중위소득' (띄어 씀)", () => {
  it("소득 설명 문구", () => {
    expect(incomeExplain(200, 2)!.line).toContain("기준 중위소득");
  });
});

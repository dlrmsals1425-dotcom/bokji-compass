/** (2026-10-22 외부 점검 P2-5·6) 원문의 빈 자리 표시를 화면에 그대로 내지 않는다 — 원문에 없는 내용은 만들지 않음 */
import { describe, expect, it } from "vitest";
import { tidyContact, tidyLaw, tidyProgram } from "@/lib/data/text";

describe("법령 조항: 정부24의 '0'은 빈 칸", () => {
  it("조의0·제0항을 지운다", () => {
    expect(tidyLaw("의사상자 등 예우 및 지원에 관한 법률(제1조의0, 제0항)")).toBe("의사상자 등 예우 및 지원에 관한 법률(제1조)");
    expect(tidyLaw("고용보험법(제51조의0, 제0항)")).toBe("고용보험법(제51조)");
    expect(tidyLaw("국민기초생활 보장법(제64조의0, 제1항)")).toBe("국민기초생활 보장법(제64조, 제1항)");
    expect(tidyLaw("노인복지법(제39조의4, 제0항)")).toBe("노인복지법(제39조의4)");
  });
  it("조항이 모두 0이면 괄호째 지운다", () => {
    expect(tidyLaw("어느 법률(제0조의0, 제0항)")).toBe("어느 법률");
  });
  it("정상 표기는 그대로", () => {
    expect(tidyLaw("장애인복지법 제49조")).toBe("장애인복지법 제49조");
    expect(tidyLaw("영유아보육법(제34조, 제2항)")).toBe("영유아보육법(제34조, 제2항)");
    expect(tidyLaw("제10조의2")).toBe("제10조의2");
  });
});

describe("문의처: '/-'(전화번호 없음 표시)를 지운다", () => {
  it("끝의 /- 와 가운데 /- ", () => {
    expect(tidyContact("해당지역 주민센터/-")).toBe("해당지역 주민센터");
    expect(tidyContact("대전전세피해지원센터(042-270-6520~22)/-")).toBe("대전전세피해지원센터(042-270-6520~22)");
    expect(tidyContact("주민센터 / - \n보건소/031-000-0000")).toBe("주민센터\n보건소/031-000-0000");
  });
  it("전화번호의 - 는 그대로", () => {
    expect(tidyContact("복지정책과/031-228-2045")).toBe("복지정책과/031-228-2045");
    expect(tidyContact("-")).toBe("");
  });
});

describe("tidyProgram: 법령·문의처·지역 운영 문의처만 다듬고 다른 값은 그대로", () => {
  it("필드별로", () => {
    const p = { id: "x", name: "이름/-", laws: ["고용보험법(제51조의0, 제0항)"], contact: "해당지역 주민센터/-" };
    expect(tidyProgram(p)).toEqual({ id: "x", name: "이름/-", laws: ["고용보험법(제51조)"], contact: "해당지역 주민센터" });
  });
});

import { describe, expect, it } from "vitest";
import { situationTarget } from "@/lib/client/situationTarget";
import { quickSituation } from "@/lib/client/quickSituation";

describe("빠른 검색 대상: 요청·가족 배경·불명확 구분", () => {
  it.each([
    "부모님과 같이 살고 25살 취업 준비 중이에요",
    "부모님이랑 살아요. 저는 25살이고 월세 지원을 찾고 싶어요",
    "부모님께 용돈을 받는 대학생이에요",
    "부모님 소득이 낮아서 제 장학금을 찾고 있어요",
    "부모님 말고 제 복지를 찾아주세요",
    "어머니는 70세고 제가 받을 지원금을 찾고 있어요",
    "부모님을 모시고 살아요",
    "부모님이 안 계세요. 저는 19살이에요",
    "아이 둘 키우는 엄마예요",
    "한부모 지원이 필요해요",
    "부모급여 신청하고 싶어요",
  ])("본인: %s", text => expect(situationTarget(text)).toBe("self"));
  it.each([
    "부모님 복지를 찾아주세요",
    "제가 어머니가 받을 지원을 찾고 있어요",
    "제가 부모님을 대신 찾아요",
    "부모님과 같이 살지만 어머니 돌봄 지원이 필요해요",
    "제 복지 말고 부모님 복지를 찾아주세요",
    "수원에 사시는 75세 어머니 혼자 살고 기초연금 안 받아요",
    "할머니 주거 지원",
    "1959년생 어머니",
  ])("부모님: %s", text => expect(situationTarget(text)).toBe("parent"));
  it.each([
    "부모님",
    "저는 25살이고 어머니는 70세예요",
    "부모님은 70세고 저는 25살이에요",
    "제 복지와 부모님 복지를 같이 찾아줘요",
  ])("확인 필요: %s", text => {
    expect(situationTarget(text)).toBeNull();
    expect(() => quickSituation(text, null)).toThrow("target_required");
  });
});

describe("선택한 사람의 조건만 빠른 검색에 전달", () => {
  const mixed = "어머니는 75세이고 월 소득 80만원, 저는 25세이고 월 소득 200만원이에요";
  it("본인을 선택하면 부모님 나이·소득을 가져오지 않음", () => {
    const s = quickSituation(mixed, null, "self", "self");
    expect(s.mode).toBe("self");
    expect(s.profile.age).toBe("25-29");
    expect(s.x.incomeManwon).toBe(200);
    expect(s.x.otherAge).toBeUndefined();
  });
  it("부모님을 선택하면 내 소득을 가져오지 않음", () => {
    const s = quickSituation(mixed, null, "self", "parent");
    expect(s.mode).toBe("parent");
    expect(s.profile.age).toBe("75-79");
    expect(s.x.incomeManwon).toBe(80);
  });
  it("부모님의 수급을 내 수급으로 저장하지 않음", () => {
    const s = quickSituation("어머니는 기초연금 받고 있어요. 저는 25살이고 제 월세 지원을 찾고 있어요", null);
    expect(s.mode).toBe("self");
    expect(s.profile.age).toBe("25-29");
    expect(s.x.benefits.basic_pension).toBeUndefined();
  });
  it("함께 사는 부모님의 나이는 본인 나이로 사용하지 않음", () => {
    const s = quickSituation("75세 부모님과 같이 살아요. 저는 25세예요", null);
    expect(s.mode).toBe("self");
    expect(s.profile.age).toBe("25-29");
  });
  it("부모님의 소득을 배경으로 말해도 본인 소득으로 저장하지 않음", () => {
    const s = quickSituation("부모님 소득은 월 80만원이에요. 제 장학금을 찾고 있어요", null);
    expect(s.mode).toBe("self");
    expect(s.x.incomeManwon).toBeNull();
  });
  it("소수와 천 단위 쉼표를 문장 경계로 자르지 않음", () => {
    const s = quickSituation("저는 25세이고 월 소득 200.5만원이에요", null);
    expect(s.x.incomeManwon).toBe(200.5);
    expect(quickSituation("저는 25세이고 연봉 3,600만원이에요", null).x.incomeManwon).toBe(300);
  });
  it("본인이 엄마인 상황의 자녀 수·나이는 유지", () => {
    const s = quickSituation("아이 둘 키우는 35세 엄마예요", null);
    expect(s.mode).toBe("self");
    expect(s.profile.age).toBe("35-39");
    expect(s.x.childCount).toBe(2);
  });
  it("부모님 소득 뒤의 내 요청을 버리지 않음", () => {
    const s = quickSituation("부모님 소득은 월 80만원이고 제 월세 지원을 찾고 있어요", null);
    expect(s.mode).toBe("self");
    expect(s.x.incomeManwon).toBeNull();
    expect(s.x.interests?.length).toBeGreaterThan(0);
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { quickSituation } from "@/lib/client/quickSituation";
import type { RegionIndex } from "@/lib/data/types";

const regions: RegionIndex = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/bundles/v1/regions.json"), "utf8"));
describe("말한 내용으로 바로 찾기", () => {
  it("주소를 말하지 않아도 전국 후보를 조회할 수 있고 누락한 사실은 모름", () => {
    const s = quickSituation("월세 지원을 찾고 있어요", regions);
    expect(s.profile.sigungu).toBeNull();
    expect(s.profile.age).toBe("unknown");
    expect(s.x.benefits).toEqual({});
    expect(s.x.traits).toEqual({});
    expect(s.x.interests).toBeDefined();
  });
  it("부모님 대상과 명시된 부정 사실을 보존하고 다른 수급은 단정하지 않음", () => {
    const s = quickSituation("수원에 사시는 75세 어머니 혼자 살고 기초연금 안 받아요", regions);
    expect(s.mode).toBe("parent");
    expect(s.profile.sigungu).toBe("41110");
    expect(s.profile.householdSize).toBe(1);
    expect(s.x.benefits.basic_pension).toBe(false);
    expect(s.x.benefits.medical).toBeUndefined();
  });
  it("새 문장에 이전 사람의 나이·소득을 이어붙이지 않음", () => {
    quickSituation("수원시 75세 어머니 혼자 살아요 월 소득 80만원", regions);
    const s = quickSituation("제 월세 지원을 찾고 싶어요", regions);
    expect(s.mode).toBe("self");
    expect(s.profile.age).toBe("unknown");
    expect(s.profile.householdSize).toBe("unknown");
    expect(s.x.incomeManwon).toBeNull();
  });
  it("광주처럼 모호한 지역은 임의로 선택하지 않음", () => {
    const s = quickSituation("광주에 사시는 어머니", regions);
    expect(s.profile.sigungu).toBeNull();
  });
  it("배우자 포함 여부가 불명확한 가구원 수를 확정하지 않음", () => {
    const s = quickSituation("아이 둘을 키우는 가장이에요", regions);
    expect(s.profile.householdSize).toBe("unknown");
    expect(s.x.childCount).toBe(2);
  });
  it("호칭만으로 65세 이상을 가정하지 않음", () => {
    const s = quickSituation("할머니 주거 지원", regions);
    expect(s.profile.age).toBe("unknown");
    expect(s.x.ageSpan).toBeNull();
  });
  it("생일 전후가 65세 경계를 걸치면 전체 나이 범위를 보존", () => {
    const year = new Date().getFullYear() - 65;
    const s = quickSituation(`${year}년생 어머니`, regions);
    expect(s.profile.age).toBe("unknown");
    expect(s.x.ageSpan).toEqual([64, 65]);
  });
});

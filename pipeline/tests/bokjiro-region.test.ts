/**
 * (2026-10-22 재생성) 복지로 지자체 목록 730건은 시군구(sggNm) 칸이 비어 있다. 예전에는 선행 색인이 지역을 채웠는데 그 원천을 더 못 써서,
 * 재생성하자 가평군·군포시 사업이 '경기도 전체' 사업이 되어 수원·안산 결과에 섞였다. 담당 부서 이름에 든 시군구로 지역을 정한다.
 */
import { describe, expect, it } from "vitest";
import { localScope, sigunguFromDept } from "../src/sources/bokjiroApi";
import { RegionIndex } from "../src/normalize/regions";

const regions = RegionIndex.load();
const names = (sido: string, dept: string) => sigunguFromDept(regions, sido, dept).map((s) => s.name);

describe("담당 부서 이름에서 시군구", () => {
  it("시·도 다음 낱말이 그 시·도의 시군구면 그 시군구", () => {
    expect(names("경기도", "경기도 가평군 평생교육사업소")).toEqual(["가평군"]);
    expect(names("경기도", "경기도 군포시 행정지원국 교육체육과")).toEqual(["군포시"]);
    expect(names("경기도", "경기도 구리시 보건소 지역보건과")).toEqual(["구리시"]);
  });
  it("시·도 본청 부서는 시군구 없음 (그대로 시·도 사업)", () => {
    expect(names("서울특별시", "서울특별시 복지실 복지기획관 장애인복지과")).toEqual([]);
    expect(names("부산광역시", "부산광역시 사회복지국 돌봄복지과")).toEqual([]);
  });
  it("일반구가 붙어도 시 단위로 (지역 목록은 수원시처럼 시 단위 — 시군구 칸이 있을 때와 같게)", () => {
    expect(names("경기도", "경기도 수원시 장안구 사회복지과")).toEqual(["수원시"]);
  });
  it("다른 시·도의 시군구 이름은 쓰지 않음", () => {
    expect(names("경기도", "경기도 중구 복지과")).toEqual([]);
  });
});

describe("지자체 사업의 지역 범위", () => {
  const sc = (sido: string, sgg: string, dept: string) => {
    const r = localScope(regions, regions.sido(sido)!, sgg, dept);
    return r && { scope: r.scope, orgType: r.orgType, sgg: r.sigunguCodes?.map((c) => regions.sigunguByCode(c)!.name) };
  };
  it("시군구 칸이 있으면 그 시군구", () => {
    expect(sc("경기도", "수원시", "경기도 수원시 노인복지과")).toEqual({ scope: "sigungu", orgType: "local", sgg: ["수원시"] });
  });
  it("시군구 칸이 비면 담당 부서 이름에서, 그것도 없으면 시·도 사업", () => {
    expect(sc("경기도", "", "경기도 가평군 평생교육사업소")).toEqual({ scope: "sigungu", orgType: "local", sgg: ["가평군"] });
    expect(sc("서울특별시", "", "서울특별시 복지실 장애인복지과")).toEqual({ scope: "sido", orgType: "metro", sgg: undefined });
  });
  it("시군구 칸에 시·도 교육청 이름이 오면 시·도 사업 (예전처럼 — 2026-10-22 재생성 때 49건이 빠졌음)", () => {
    expect(sc("울산광역시", "울산광역시교육청", "울산광역시교육청 교육국")).toEqual({ scope: "sido", orgType: "metro", sgg: undefined });
  });
  it("시군구 칸이 '-'이면 빈 칸처럼, 통합 전 시·도 이름의 교육청도 시·도 사업", () => {
    expect(sc("경상남도", "-", "경상남도 아동청소년과")).toEqual({ scope: "sido", orgType: "metro", sgg: undefined });
    expect(sc("전남광주통합특별시", "광주광역시교육청", "광주광역시교육청 교육복지과")).toEqual({ scope: "sido", orgType: "metro", sgg: undefined });
  });
  it("모르는 시군구 이름이면 null (건너뛰고 기록)", () => {
    expect(sc("경기도", "없는시", "경기도 없는시 복지과")).toBeNull();
  });
});

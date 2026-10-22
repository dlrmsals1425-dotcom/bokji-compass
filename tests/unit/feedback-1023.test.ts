/**
 * (2026-10-23 외부 의견: 가상 입력 18개) 문장 해석·소득·배우자 판정
 * 1. '수급자가 아닙니다'·'수급자 아님'을 수급자로 읽음
 * 3. 모순된 소득('소득은 없고 월 200만원 벌어요')을 경고 없이 0원으로, '300만원인데'의 금액을 못 읽음
 * 4. 성인 자녀와 사는 2인 가구를 부부로 — 기초연금은 본인·배우자 소득만, 부부 기준은 배우자가 있을 때만
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSituation, parsedExtras } from "@/lib/client/parse";
import { PRESETS } from "@/lib/client/presets";
import { DIM_BY_ID, EMPTY_EXTRAS, pensionLikely, pensionLine, pensionPossible, type Situation } from "@/lib/client/v2";
import { EMPTY_PROFILE, type Profile } from "@/lib/engine/profile";
import type { RegionIndex } from "@/lib/data/types";

const regions = JSON.parse(readFileSync("public/bundles/v1/regions.json", "utf8")) as RegionIndex;
const P = (s: string) => parseSituation(s, regions, { year: 2026, month: 10, day: 23 });

describe("1. 수급·차상위를 '아니다'라고 한 문장", () => {
  it("'아닙니다'·'아님'은 수급자가 아님", () => {
    for (const t of ["수원 사는 70세, 기초생활 수급자가 아닙니다", "수급자가 아닙니다", "수급자 아님"]) {
      const r = P(t);
      expect(r.profile.benefits ?? [], t).not.toContain("livelihood");
      expect(r.benefitsNo ?? [], t).toContain("livelihood");
    }
  });
  it("'차상위가 아닙니다'는 차상위가 아님", () => {
    const r = P("차상위가 아닙니다");
    expect(r.profile.benefits ?? []).not.toContain("near_poverty");
    expect(r.benefitsNo ?? []).toContain("near_poverty");
  });
  it("'생계급여 받지 않아요'는 생계급여 안 받음", () => {
    expect(P("생계급여 받지 않아요").benefitsNo ?? []).toContain("livelihood");
  });
  it("그대로: '수급자예요'·'수급자는 아니에요'", () => {
    expect(P("수급자예요").profile.benefits).toContain("livelihood");
    expect(P("수급자는 아니에요").benefitsNo).toContain("livelihood");
  });
});

describe("3. 소득 문장", () => {
  it("'소득 없음'과 금액이 함께 있으면 0원으로 정하지 않고 확인을 부탁", () => {
    for (const t of ["수원 70세 혼자, 소득은 없고 월 200만원 벌어요", "소득 없음, 연봉 4000", "수원 40대 부부, 월 소득 0원 연 소득 5000만원"]) {
      const r = P(t);
      expect(r.income, t).toBeUndefined();
      expect(r.notes.join(" "), t).toContain("소득이 없다는 말과 금액");
    }
  });
  it("그대로: '소득은 없어요'는 0원", () => {
    expect(P("수원 70세 혼자 사세요, 소득은 없어요").income?.manwon).toBe(0);
  });
  it("'300만원인데'의 금액을 읽음 ('인'은 사람 수가 아님), '3인 가구'는 그대로 사람 수", () => {
    expect(P("월급 300만원인데 기초생활수급자예요").income?.manwon).toBe(300);
    const r = P("수원 3인 가구 월 200 벌어요");
    expect(r.profile.householdSize).toBe(3);
    expect(r.income?.manwon).toBe(200);
  });
  it("수급자라고 했는데 소득이 기준보다 크게 읽히면 확인 안내", () => {
    expect(P("수원 혼자 살아요 월급 300만원인데 기초생활수급자예요").notes.join(" ")).toContain("수급자라고 하셨는데");
    expect(P("수원 혼자 살아요 월 50만원 받는 기초생활수급자예요").notes.join(" ")).not.toContain("수급자라고 하셨는데");
  });
});

describe("4. 배우자 (함께 사는 사람이 부부인지)", () => {
  it("'아들이랑 둘이'는 부부가 아닌 2인 가구", () => {
    const r = P("수원 사는 72세 어머니, 아들이랑 둘이 사세요");
    expect(r.profile.householdSize).toBe(2);
    expect(parsedExtras(r).spouse).toBe(false);
    expect(r.understood.map((u) => u.label).join(" ")).not.toContain("부부");
  });
  it("'부모님 두 분'·'남편이랑 둘이'는 배우자와 함께", () => {
    expect(parsedExtras(P("수원 사는 59년생 부모님 두 분")).spouse).toBe(true);
    const r = P("66세예요 남편이랑 둘이 살아요 수원");
    expect(r.profile.householdSize).toBe(2);
    expect(parsedExtras(r).spouse).toBe(true);
  });
  it("'남편과 사별'은 배우자 없음", () => {
    expect(parsedExtras(P("70세 남편과 사별하고 딸과 둘이 살아요 수원")).spouse).toBe(false);
  });
});

const senior = (householdSize: Profile["householdSize"], incomeManwon: number | null, spouse?: boolean): Situation => ({
  profile: { ...EMPTY_PROFILE, sido: "41000", sigungu: "41110", age: "70-74", householdSize },
  x: { ...EMPTY_EXTRAS, incomeManwon, ...(spouse !== undefined ? { spouse } : {}) },
  mode: "parent",
});

describe("4. 기초연금: 부부 기준은 배우자가 있을 때만, 가구 소득에 자녀 소득이 섞이면 소득으로 정하지 않음", () => {
  it("혼자: 단독 기준(월 247만원)", () => {
    expect(pensionLikely(senior(1, 150))).toBe(true);
    expect(pensionPossible(senior(1, 250))).toBe(false);
  });
  it("배우자와 둘: 부부 기준(월 395만 2천원)", () => {
    expect(pensionLikely(senior(2, 200, true))).toBe(true);
    expect(pensionLikely(senior(2, 300, true))).toBe(false);
    expect(pensionPossible(senior(2, 300, true))).toBe(true);
    expect(pensionPossible(senior(2, 400, true))).toBe(false);
  });
  it("자녀 등과 둘이거나 배우자 여부를 모르면 가구 소득으로 정하지 않음 (가능성은 열어 둠)", () => {
    for (const s of [senior(2, 600, false), senior(2, 600), senior(3, 600, true)]) {
      expect(pensionLikely(s)).toBe(false);
      expect(pensionPossible(s)).toBe(true);
    }
  });
  it("기준 문구: 배우자 여부에 따라, 자녀 소득은 보지 않는다고", () => {
    expect(pensionLine(senior(1, null).profile)).toContain("247");
    expect(pensionLine(senior(2, null, true).profile, true)).toContain("부부");
    const other = pensionLine(senior(2, null, false).profile, false);
    expect(other).toContain("247");
    expect(other).toContain("자녀");
  });
  it("가구원 수 질문: 2명은 '배우자와'·'배우자 아닌 가족과'로 나눠 배우자 여부도 정함", () => {
    const answers = DIM_BY_ID.alone.answers;
    const s2 = answers.find((a) => a.key === "2s")!.apply(senior("unknown", null));
    const o2 = answers.find((a) => a.key === "2o")!.apply(senior("unknown", null));
    expect([s2.profile.householdSize, s2.x.spouse]).toEqual([2, true]);
    expect([o2.profile.householdSize, o2.x.spouse]).toEqual([2, false]);
    expect(answers.find((a) => a.key === "1" || a.key === "yes")!.apply(senior("unknown", null)).x.spouse).toBe(false);
  });
  it("예시 '부모님 돌보기'(두 분)는 배우자와 함께", () => {
    expect(PRESETS.find((p) => p.id === "parent-care")!.x.spouse).toBe(true);
  });
});

/** (2026-10-22 소유자 화면 확인) '기초연금 받음'이라고 답했는데 추천 1번이 기초연금 — 이미 받는다고 답한 급여는 추천에서 빼고 '이미 받고 있는 혜택'으로 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { autoReceivingKeys, splitReceiving } from "@/lib/client/receiving";
import { EMPTY_EXTRAS, buildView, scoreV2, topPicksV2, type Situation } from "@/lib/client/v2";
import { refineProgram } from "@/lib/data/refine";
import { EMPTY_PROFILE } from "@/lib/engine/profile";
import type { Program } from "@/lib/data/types";

const load = (f: string): Program[] => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).programs : []);
const progs = [...load("public/bundles/v1/sigungu/41110.json"), ...load("public/bundles/v1/sido/41000.json"), ...load("public/bundles/v1/national.json")].map(refineProgram);
const parent = (benefits: Situation["x"]["benefits"]): Situation => ({
  profile: { ...EMPTY_PROFILE, sido: "41000", sigungu: "41110", age: "65-69", householdSize: 2, income: "50", disability: "none" },
  x: { ...EMPTY_EXTRAS, benefits, traits: {}, facts: {} },
  mode: "parent",
});
const names = (view: ReturnType<typeof buildView>, keys: string[]) =>
  [...view.fit, ...view.office, ...view.ask, ...view.no].filter((g) => keys.includes(g[0].s.group)).map((g) => g[0].s.program.name);

describe("이미 받는다고 답한 급여", () => {
  it("기초연금 받음 → 기초연금이 자동으로 '이미 받고 있음', 추천 5개에 없음", () => {
    const sit = parent({ livelihood: false, medical: false, housing: false, education: false, near_poverty: false, basic_pension: true });
    const view = buildView(scoreV2(progs, sit), sit, 12);
    const keys = autoReceivingKeys(view, sit);
    expect(names(view, keys)).toContain("기초연금");
    // 기초연금 수급자 확인서처럼 이름만 비슷한 다른 사업은 빼지 않음
    expect(names(view, keys)).not.toContain("기초연금 수급자 확인서");
    const { view: v2, receiving } = splitReceiving(view, keys);
    expect(receiving.map((g) => g[0].s.program.name)).toContain("기초연금");
    expect(topPicksV2(v2, 5, sit).map((g) => g[0].s.program.name)).not.toContain("기초연금");
  });
  it("기초연금 모름·안 받음 → 빼지 않음", () => {
    for (const bp of [undefined, false]) {
      const sit = parent({ basic_pension: bp });
      const view = buildView(scoreV2(progs, sit), sit, 12);
      expect(names(view, autoReceivingKeys(view, sit))).not.toContain("기초연금");
    }
  });
  it("생계급여 받음 → 생계급여가 빠짐 (차상위계층 확인은 '차상위'라고 답했을 때만)", () => {
    const sit = parent({ livelihood: true, medical: true, housing: true, near_poverty: false, basic_pension: false });
    const view = buildView(scoreV2(progs, sit), sit, 12);
    const got = names(view, autoReceivingKeys(view, sit));
    // 묶음 대표 이름은 데이터 순서에 따라 '생계급여(맞춤형 급여)'·'국민기초생활보장 생계급여' 등 (2026-10-22 재생성)
    expect(got.some((n) => n.includes("생계급여"))).toBe(true);
    expect(got).not.toContain("차상위계층 확인");
  });
});

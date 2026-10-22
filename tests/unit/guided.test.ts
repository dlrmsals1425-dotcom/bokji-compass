/** 질문 따라 찾기 (2026-10-16): 위치 확인 → 정해지는 혜택이 많은 질문 5개 → 드문 사항 한 번에 고르기 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FLOW_LIMIT, FLOW_DIM_BY_ID, RARE_DIMS_FLOW, blankSituation, flowAnswers, flowStep, nextQuestion, rareApply, rarePicks, type FlowStep, type FlowQuestionId,
} from "@/lib/client/guided";
import { DIM_BY_ID, buildView, scoreV2, type DimId, type Situation } from "@/lib/client/v2";
import { refineProgram } from "@/lib/data/refine";
import { medianWon } from "@/lib/engine/profile";
import type { Program } from "@/lib/data/types";

const load = (f: string): Program[] => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).programs : []);
const cache = new Map<string, Program[]>();
const progsFor = (sido: string, sigungu: string) => {
  const k = `${sido}/${sigungu}`;
  if (!cache.has(k)) cache.set(k, [...load(`public/bundles/v1/sigungu/${sigungu}.json`), ...load(`public/bundles/v1/sido/${sido}.json`), ...load("public/bundles/v1/national.json")].map(refineProgram));
  return cache.get(k)!;
};
const SUWON = { sido: "41000", sigungu: "41110" };
const answer = (s: Situation, id: FlowQuestionId, key: string) => {
  const a = flowAnswers(FLOW_DIM_BY_ID[id], s).find((x) => x.key === key);
  if (!a) throw new Error(`${id}:${key} 보기 없음`);
  return a.apply(s);
};

describe("다음 질문 고르기", () => {
  it("위치만 아는 본인 찾기 → 첫 질문은 나이", () => {
    const s = blankSituation(SUWON.sido, SUWON.sigungu, "self");
    const st = flowStep(progsFor(SUWON.sido, SUWON.sigungu), s);
    expect(nextQuestion(st, s, [])?.id).toBe("age");
  });

  it("보훈·다문화는 하나씩 묻지 않는다 (마지막 '해당하는 것 모두 고르기'로)", () => {
    let s = blankSituation(SUWON.sido, SUWON.sigungu, "self");
    const asked: FlowQuestionId[] = [];
    const progs = progsFor(SUWON.sido, SUWON.sigungu);
    for (let i = 0; i < 10; i++) {
      const q = nextQuestion(flowStep(progs, s), s, asked);
      if (!q) break;
      expect(q.id === "family" || !RARE_DIMS_FLOW.has(q.id)).toBe(true);
      asked.push(q.id);
      s = flowAnswers(FLOW_DIM_BY_ID[q.id], s)[0].apply(s);
    }
    expect(asked.length).toBeGreaterThanOrEqual(FLOW_LIMIT);
  });

  it("소득은 가구원 수를 안 다음에만 — 모르면 가구원 수를 먼저 묻는다", () => {
    let s = blankSituation(SUWON.sido, SUWON.sigungu, "self");
    s = answer(s, "age", "35-39");
    const progs = progsFor(SUWON.sido, SUWON.sigungu);
    const asked: FlowQuestionId[] = ["age"];
    for (let i = 0; i < 6; i++) {
      const q = nextQuestion(flowStep(progs, s), s, asked);
      if (!q) break;
      if (q.id === "income") expect(s.profile.householdSize).not.toBe("unknown");
      asked.push(q.id);
      s = flowAnswers(FLOW_DIM_BY_ID[q.id], s)[0].apply(s);
    }
    expect(asked).toContain("alone");
    expect(asked.indexOf("alone")).toBeLessThan(asked.indexOf("income") === -1 ? 99 : asked.indexOf("income"));
  });
});

describe("가구 확인 뒤 자녀 질문 분기", () => {
  const next = (s: Situation, asked: FlowQuestionId[]) => nextQuestion(flowStep(progsFor(SUWON.sido, SUWON.sigungu), s), s, asked)?.id;
  const adult = () => answer(blankSituation(SUWON.sido, SUWON.sigungu, "self"), "age", "35-39");

  it("나이 다음은 가구원 수, 이후 해당 여부, 자녀가 있을 때만 나이", () => {
    let s = adult();
    expect(next(s, ["age"])).toBe("alone");
    s = answer(s, "alone", "4");
    expect(next(s, ["age", "alone"])).toBe("family");
    s = answer(s, "family", "children");
    expect(s.x.childCount).toBeUndefined();
    expect(s.profile.children).toBeNull();
    expect(next(s, ["age", "alone", "family"])).toBe("children");
    expect(flowAnswers(DIM_BY_ID.children, s).map((a) => a.key)).toEqual(["0-1", "2-5", "6-12", "13-18", "19+"]);
  });

  it.each(["none", "expecting", "skip"])("%s: 자녀 나이·보육·한부모 질문을 하지 않는다", (choice) => {
    let s = answer(adult(), "alone", "yes");
    if (choice !== "skip") s = answer(s, "family", choice);
    const asked: FlowQuestionId[] = ["age", "alone", "family"];
    for (let i = 0; i < 15; i++) {
      const q = next(s, asked);
      if (!q) break;
      expect(["children", "daycare", "singleParent", "family"]).not.toContain(q);
      asked.push(q);
    }
    expect(rarePicks(s).map((r) => r.key)).not.toContain("singleParent");
    const r = rareApply(s, []);
    expect(r.profile.children).toEqual(choice === "none" ? [] : choice === "expecting" ? ["pregnant"] : null);
    if (choice === "skip") {
      expect(r.x.childCount).toBeUndefined();
      expect(r.x.family).toBeUndefined();
      expect(r.x.traits.single_parent).toBeUndefined();
    }
  });

  it("혼자 살아도 자녀·임신 유무는 추정하지 않는다", () => {
    const s = answer(adult(), "alone", "yes");
    expect(s.profile.children).toBeNull();
    expect(s.x.childCount).toBeUndefined();
    expect(next(s, ["age", "alone"])).toBe("family");
  });

  it("자녀가 있고 출산 예정인 가구는 두 정보를 함께 보존한다", () => {
    let s = answer(answer(adult(), "alone", "3"), "family", "both");
    s = answer(s, "children", "2-5");
    expect(s.profile.children).toEqual(["2-5", "pregnant"]);
    expect(s.x.childCount).toBeUndefined();
  });

  it("가구원 수를 건너뛰면 재질문하지 않고 모름을 보존한다", () => {
    const s = adult();
    expect(next(s, ["age", "alone"])).toBe("family");
    expect(s.profile.householdSize).toBe("unknown");
  });

  it.each(["0-18", "65-69"])("%s 본인에게는 자녀·출산 질문을 내지 않는다", (age) => {
    let s = answer(blankSituation(SUWON.sido, SUWON.sigungu, "self"), "age", age);
    expect(next(s, ["age"])).toBe("alone");
    s = answer(s, "alone", "2s");
    expect(["family", "children", "daycare", "singleParent"]).not.toContain(next(s, ["age", "alone"]));
  });
});

describe("질문 보기", () => {
  it("본인 찾기 나이에는 '18세 이하'가 있고, 부모님 찾기에는 없다", () => {
    const self = flowAnswers(DIM_BY_ID.age, blankSituation(SUWON.sido, SUWON.sigungu, "self")).map((a) => a.key);
    const parent = flowAnswers(DIM_BY_ID.age, blankSituation(SUWON.sido, SUWON.sigungu, "parent")).map((a) => a.key);
    expect(self[0]).toBe("0-18");
    expect(parent).not.toContain("0-18");
    const teen = answer(blankSituation(SUWON.sido, SUWON.sigungu, "self"), "age", "0-18");
    expect(teen.profile.age).toBe("0-18");
  });

  it("소득 보기는 가구원 수에 맞춘 원문 기준 중위소득 금액 (4인 60% = medianWon(60, 4))", () => {
    let s = blankSituation(SUWON.sido, SUWON.sigungu, "self");
    s = answer(s, "alone", "4");
    const opts = flowAnswers(DIM_BY_ID.income, s);
    const b60 = opts.find((a) => a.key === "60")!;
    expect(b60.label).toContain(`${Math.floor(medianWon(60, 4) / 10000).toLocaleString("ko-KR")}만원`);
    expect(b60.apply(s).profile.income).toBe("60");
    expect(opts.map((a) => a.key)).toEqual(["32", "40", "48", "50", "60", "100", "120", "150", "200", "200+"]);
  });
});

describe("드문 사항 한 번에 고르기", () => {
  it("'해당 없음' → 보인 항목 모두 아니요", () => {
    const s = answer(blankSituation(SUWON.sido, SUWON.sigungu, "self"), "age", "35-39");
    const picks = rarePicks(s);
    expect(picks.map((p) => p.key)).toEqual(expect.arrayContaining(["veteran", "multicultural", "disability"]));
    const r = rareApply(s, []);
    expect(r.x.traits.veteran).toBe(false);
    expect(r.x.traits.multicultural).toBe(false);
    expect(r.profile.disability).toBe("none");
  });
  it("고른 것만 예, 나머지는 아니요", () => {
    const s = answer(blankSituation(SUWON.sido, SUWON.sigungu, "self"), "age", "35-39");
    const r = rareApply(s, ["veteran"]);
    expect(r.x.traits.veteran).toBe(true);
    expect(r.x.traits.multicultural).toBe(false);
  });
  it("자녀 없다고 답한 본인에게는 한부모를 보이지 않는다", () => {
    let s = answer(blankSituation(SUWON.sido, SUWON.sigungu, "self"), "age", "35-39");
    s = answer(s, "children", "none");
    expect(rarePicks(s).map((p) => p.key)).not.toContain("singleParent");
  });
});

describe("소거해서 계산한 결과 = 처음부터 전부 계산한 결과", () => {
  const PATHS: { mode: "self" | "parent"; region: { sido: string; sigungu: string }; answers: [DimId, string][] }[] = [
    { mode: "self", region: SUWON, answers: [["age", "35-39"], ["alone", "yes"], ["income", "100"], ["children", "none"], ["activity", "job_seeking"], ["disability", "none"]] },
    { mode: "self", region: SUWON, answers: [["age", "40-49"], ["children", "6-12"], ["alone", "4"], ["income", "60"], ["activity", "employed"]] },
    { mode: "self", region: { sido: "41000", sigungu: "41270" }, answers: [["age", "0-18"], ["alone", "3"], ["income", "50"], ["activity", "none"]] },
    { mode: "parent", region: { sido: "41000", sigungu: "41190" }, answers: [["age", "70-79"], ["alone", "yes"], ["income", "32"], ["disability", "none"], ["ltcGrade", "no"], ["care", "yes"]] },
    { mode: "parent", region: { sido: "11000", sigungu: "11215" }, answers: [["age", "65-69"], ["alone", "2s"], ["income", "100"], ["basicPension", "yes"]] },
  ];
  for (const [i, path] of PATHS.entries()) {
    it(`경로 ${i + 1} (${path.mode} ${path.region.sigungu})`, () => {
      const progs = progsFor(path.region.sido, path.region.sigungu);
      let s = blankSituation(path.region.sido, path.region.sigungu, path.mode);
      let st: FlowStep = flowStep(progs, s);
      for (const [id, key] of path.answers) {
        s = answer(s, id, key);
        st = flowStep(st.pool, s, st);
        const full = buildView(scoreV2(progs, s), s, 0);
        const keys = (gs: { s: { group: string } }[][]) => gs.map((g) => g[0].s.group).sort();
        expect(keys(st.view.fit)).toEqual(keys(full.fit));
        expect(keys(st.view.ask)).toEqual(keys(full.ask));
        expect(keys(st.view.office)).toEqual(keys(full.office));
        expect(st.counts.no).toBe(full.no.length);
      }
    });
  }
});

describe("질문 이름 (2026-10-16 회의: 상담·발표에서 '3번 질문'은 사람마다 내용이 달라 질문 이름을 함께)", () => {
  it("모든 질문에 짧은 이름이 있고 겹치지 않는다", async () => {
    const { QUESTION_NAME } = await import("@/lib/client/guided");
    const { DIMS } = await import("@/lib/client/v2");
    const names = DIMS.map((d) => QUESTION_NAME[d.id]);
    for (const [i, n] of names.entries()) expect(n, DIMS[i].id).toMatch(/^\S.{0,7}$/);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("자녀 질문: 임신 + 자녀 나이 여러 개 + 자녀 수 (2026-10-16 회의: 아이 1명에 임신 중이면 둘다 반영돼야)", () => {
  const base = () => {
    const s0 = blankSituation(SUWON.sido, SUWON.sigungu, "self");
    return answer(s0, "age", "30-34");
  };
  const bucketOf = (s: Situation, re: RegExp) => {
    const v = buildView(scoreV2(progsFor(SUWON.sido, SUWON.sigungu), s), s, 0);
    for (const b of ["fit", "office", "ask", "no"] as const) if (v[b].some((g) => g.some((i) => re.test(i.s.program.name)))) return b;
    return null;
  };
  it("임신 중 + 2~5세 자녀 1명 → 임신·출산 사업과 영유아 사업이 함께 '해당하지 않아요'가 아님", async () => {
    const { childrenApply } = await import("@/lib/client/guided");
    const s = childrenApply(base(), ["pregnant", "2-5"], 1);
    expect(s.profile.children).toEqual(["pregnant", "2-5"]);
    expect(s.x.childCount).toBe(1);
    expect(bucketOf(s, /^건강보험 임신출산 진료비/)).not.toBe("no");
    expect(bucketOf(s, /^영유아보육료 지원$/)).not.toBe("no");
    // 예전 한 개만 고르기(임신 중)로는 영유아 사업이 '해당하지 않아요'였다
    expect(bucketOf(answer(base(), "children", "pregnant"), /^영유아보육료 지원$/)).toBe("no");
  });
  it("자녀 3명 이상 → 다자녀로 보고, 2명은 사업마다 달라 모름", async () => {
    const { childrenApply } = await import("@/lib/client/guided");
    expect(bucketOf(childrenApply(base(), ["6-12", "13-18"], 3), /^다자녀가구 자동차취득세 감면$/)).not.toBe("no");
    expect(bucketOf(childrenApply(base(), ["6-12"], 1), /^다자녀가구 자동차취득세 감면$/)).toBe("no");
  });
  it("자녀 없음 / 임신만", async () => {
    const { childrenApply } = await import("@/lib/client/guided");
    const none = childrenApply(base(), [], 0);
    expect(none.profile.children).toEqual([]);
    expect(none.x.childCount).toBe(0);
    const preg = childrenApply(base(), ["pregnant"], 0);
    expect(preg.profile.children).toEqual(["pregnant"]);
    expect(bucketOf(preg, /^건강보험 임신출산 진료비/)).not.toBe("no");
  });
});

describe("나이 보기 70~79세 하나로 (2026-10-16 시뮬레이션: 전국 230곳에서 74/75세 경계로 갈리는 혜택 중앙값 0, 최대 3)", () => {
  it("본인 11개·부모님 6개 보기, 70~74·75~79 대신 70~79", () => {
    const self = flowAnswers(DIM_BY_ID.age, blankSituation(SUWON.sido, SUWON.sigungu, "self")).map((a) => a.key);
    const parent = flowAnswers(DIM_BY_ID.age, blankSituation(SUWON.sido, SUWON.sigungu, "parent")).map((a) => a.key);
    expect(self).toHaveLength(11);
    expect(parent).toEqual(["40-49", "50-59", "60-64", "65-69", "70-79", "80+"]);
    expect(self).not.toContain("70-74");
    expect(flowAnswers(DIM_BY_ID.age, blankSituation(SUWON.sido, SUWON.sigungu, "self")).find((a) => a.key === "70-79")?.label).toBe("70~79세");
  });
  it("70~79세로 답한 결과는 70~74세로 답한 결과와 거의 같다 (어르신 혜택·기초연금 그대로)", () => {
    const s0 = blankSituation(SUWON.sido, SUWON.sigungu, "parent");
    const a = answer(s0, "age", "70-79");
    expect(a.profile.age).toBe("70-79");
    const b = { ...s0, profile: { ...s0.profile, age: "70-74" as const } };
    const progs = progsFor(SUWON.sido, SUWON.sigungu);
    const va = buildView(scoreV2(progs, a), a, 0);
    const vb = buildView(scoreV2(progs, b), b, 0);
    const bucketOf = (v: typeof va) => new Map((["fit", "office", "ask", "no"] as const).flatMap((k) => v[k].map((g) => [g[0].s.group, k] as const)));
    const ma = bucketOf(va), mb = bucketOf(vb);
    const diff = [...mb].filter(([k, v]) => ma.get(k) !== v);
    expect(diff.length).toBeLessThanOrEqual(5);
    expect(ma.get(mb.has("기초연금") ? "기초연금" : "")).toBe(mb.get("기초연금"));
  });
});

/** 쉬운 찾기 (2026-10-21 인터뷰): 보기가 여럿인 질문을 예/아니요로 나눠 물어도 질문 따라 찾기와 같은 값으로 정해진다 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EASY_TAPS, easyMaxTaps, easyNext, easyResolve, type EasyResolve } from "@/lib/client/easy";
import { FLOW_DIM_BY_ID, blankSituation, flowAnswers, flowStep, type FlowQuestionId } from "@/lib/client/guided";
import type { Situation } from "@/lib/client/v2";
import { refineProgram } from "@/lib/data/refine";
import type { Program } from "@/lib/data/types";

const SUWON = { sido: "41000", sigungu: "41110" };
const self = () => blankSituation(SUWON.sido, SUWON.sigungu, "self");
const parent = () => blankSituation(SUWON.sido, SUWON.sigungu, "parent");

/** 끝까지 가 보기: 모든 예/아니요 갈래의 끝 → { 정해진 값 보기 key, 질문 수 } */
function leaves(id: FlowQuestionId, s: Situation): { label: string; depth: number; sit: Situation | null }[] {
  const out: { label: string; depth: number; sit: Situation | null }[] = [];
  const walk = (trail: boolean[]) => {
    const r: EasyResolve = easyResolve(id, s, trail);
    if (r.kind === "ask") {
      expect(r.q.length).toBeGreaterThan(0);
      walk([...trail, true]);
      walk([...trail, false]);
    } else if (r.kind === "done") out.push({ label: r.label, depth: trail.length, sit: r.apply(s) });
    else out.push({ label: "(skip)", depth: trail.length, sit: null });
  };
  walk([]);
  return out;
}
const labels = (id: FlowQuestionId, s: Situation) => flowAnswers(FLOW_DIM_BY_ID[id], s).map((a) => a.label);

describe("반으로 나눠 묻기 — 나이·소득", () => {
  it("부모님 나이: 첫 질문은 '만 65세 이상', 모든 보기에 닿고 3번 안에 정해짐", () => {
    const s = parent();
    const first = easyResolve("age", s, []);
    expect(first.kind === "ask" && first.q).toContain("만 65세 이상");
    const ls = leaves("age", s);
    expect(new Set(ls.map((l) => l.label))).toEqual(new Set(labels("age", s)));
    expect(Math.max(...ls.map((l) => l.depth))).toBeLessThanOrEqual(3);
  });
  it("본인 나이: 18세 이하부터 80세 이상까지 모두 닿고 4번 안에", () => {
    const s = self();
    const ls = leaves("age", s);
    expect(new Set(ls.map((l) => l.label))).toEqual(new Set(labels("age", s)));
    expect(Math.max(...ls.map((l) => l.depth))).toBeLessThanOrEqual(4);
    // 예·예 … → 가장 높은 구간
    const top = ls.reduce((a, b) => (a.sit!.profile.age > b.sit!.profile.age ? a : b));
    expect(top.sit!.profile.age).toBe("80+");
  });
  it("소득: 가구원 수를 알면 금액(만원)으로 묻고 10개 구간 모두 닿음, 4번 안에", () => {
    const s = { ...self(), profile: { ...self().profile, householdSize: 1 as const } };
    const first = easyResolve("income", s, []);
    expect(first.kind === "ask" && first.q).toMatch(/\d[\d,]*만원보다 많은가요/);
    const ls = leaves("income", s);
    expect(new Set(ls.map((l) => l.sit!.profile.income))).toEqual(new Set(["32", "40", "48", "50", "60", "100", "120", "150", "200", "200+"]));
    expect(Math.max(...ls.map((l) => l.depth))).toBeLessThanOrEqual(4);
  });
  it("소득: 가구원 수를 모르면 묻지 않음 (금액을 정할 수 없음)", () => {
    expect(easyResolve("income", self(), []).kind).toBe("skip");
  });
});

describe("차례로 묻기", () => {
  it("가구원 수: 혼자? → 2명? … → 모두 아니면 6명 이상", () => {
    const s = parent();
    const at = (t: boolean[]) => {
      const r = easyResolve("alone", s, t);
      return r.kind === "done" ? r.apply(s).profile.householdSize : r.kind === "ask" ? r.q : null;
    };
    expect(at([])).toBe("부모님이 혼자 사세요?");
    expect(at([true])).toBe(1);
    expect(at([false, true])).toBe(2);
    expect(at([false, false, false, false, false])).toBe(6);
  });
  it("수급: 아니요면 모두 아님, 예 → 생계 → 의료 → 주거 → 모두 아니면 차상위", () => {
    const s = self();
    const end = (t: boolean[]) => {
      const r = easyResolve("support", s, t);
      if (r.kind !== "done") throw new Error("not done");
      return r.apply(s).x.benefits;
    };
    expect(end([false])).toMatchObject({ livelihood: false, medical: false, housing: false, near_poverty: false });
    expect(end([true, true])).toMatchObject({ livelihood: true, medical: true, housing: true });
    expect(end([true, false, true])).toMatchObject({ livelihood: false, medical: true });
    expect(end([true, false, false, false])).toMatchObject({ near_poverty: true, livelihood: false });
  });
  it("자녀·출산: 두 질문 → 자녀 나이대마다 있나요? (출산 예정은 임신으로 함께 저장)", () => {
    let s = self();
    const fam = easyResolve("family", s, [true, true]);
    if (fam.kind !== "done") throw new Error("family not done");
    s = fam.apply(s);
    expect(s.x.family).toBe("both");
    const kids = easyResolve("children", s, [false, true, true, false, false]);
    if (kids.kind !== "done") throw new Error("children not done");
    expect(kids.apply(s).profile.children).toEqual(["pregnant", "2-5", "6-12"]);
    expect(kids.label).toBe("2~5세, 6~12세");
  });
  it("하는 일: 부모님 찾기는 '학생인가요?'를 묻지 않음 — 아니요·아니요면 일하지 않음", () => {
    const s = parent();
    const second = easyResolve("activity", s, [false]);
    expect(second.kind === "ask" && second.q).toBe("일자리를 찾고 계세요?");
    const end = easyResolve("activity", s, [false, false]);
    if (end.kind !== "done") throw new Error("activity not done");
    expect(end.apply(s).profile.activity).toBe("none");
    // 본인 20대는 학생도 묻는다
    const young = { ...self(), profile: { ...self().profile, age: "19-24" as const } };
    const q3 = easyResolve("activity", young, [false, false]);
    expect(q3.kind === "ask" && q3.q).toBe("학생인가요?");
  });
  it("예/아니요 질문은 그대로 (돌봄)", () => {
    const s = parent();
    const r = easyResolve("care", s, [true]);
    if (r.kind !== "done") throw new Error("care not done");
    expect(r.apply(s).profile.care).toEqual(["daily"]);
  });
});

describe("질문 순서", () => {
  const load = (f: string): Program[] => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).programs : []);
  const progs = [...load(`public/bundles/v1/sigungu/${SUWON.sigungu}.json`), ...load(`public/bundles/v1/sido/${SUWON.sido}.json`), ...load("public/bundles/v1/national.json")].map(refineProgram);
  it("나이부터, 그 뒤 질문 따라 찾기 순서 · 드문 사항도 하나씩 물음", () => {
    const s = parent();
    const st = flowStep(progs, s);
    expect(easyNext(st, s, [])).toBe("age");
    // 질문 따라 찾기가 고를 질문을 모두 물은 뒤에는 보훈·다문화 같은 드문 사항을 하나씩
    const asked: FlowQuestionId[] = [];
    let q = easyNext(st, s, asked);
    for (let i = 0; q && i < 40; i++) {
      asked.push(q);
      q = easyNext(st, s, asked);
    }
    expect(asked).toEqual(expect.arrayContaining(["veteran", "multicultural"]));
  });
});

describe("누르는 횟수 (인터뷰: 18~19번)", () => {
  const load = (f: string): Program[] => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).programs : []);
  const progs = [...load(`public/bundles/v1/sigungu/${SUWON.sigungu}.json`), ...load(`public/bundles/v1/sido/${SUWON.sido}.json`), ...load("public/bundles/v1/national.json")].map(refineProgram);
  /** 화면과 같은 순서로 끝까지: answer(질문, 몇 번째) → 예/아니요 */
  const run = (start: Situation, answer: (q: string, i: number) => boolean) => {
    let s = start;
    let st = flowStep(progs, s);
    const asked: FlowQuestionId[] = [];
    let taps = 0;
    for (let q = easyNext(st, s, asked, EASY_TAPS - taps); q; q = easyNext(st, s, asked, EASY_TAPS - taps)) {
      const trail: boolean[] = [];
      for (let r = easyResolve(q, s, trail); ; r = easyResolve(q, s, trail)) {
        if (r.kind === "ask") { trail.push(answer(r.q, taps + trail.length)); continue; }
        if (r.kind === "done") { s = r.apply(s); st = flowStep(st.pool, s, st); }
        break;
      }
      taps += trail.length;
      asked.push(q);
    }
    return { taps, asked };
  };
  it("질문마다 끝까지 답할 때 가장 많이 누르는 횟수", () => {
    expect(easyMaxTaps("age", parent())).toBe(3);
    expect(easyMaxTaps("alone", parent())).toBe(5);
    expect(easyMaxTaps("care", parent())).toBe(1);
    expect(easyMaxTaps("income", self())).toBe(0);
  });
  const rand = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) < 0.5;
  for (const [who, start] of [["부모님", parent], ["본인", self]] as const) {
    it(`${who}: 모두 예·모두 아니요·번갈아·무작위 어떤 답이든 ${EASY_TAPS}번을 넘지 않고, 나이·가구원 수는 물음`, () => {
      const answers: ((q: string, i: number) => boolean)[] = [() => true, () => false, (_q, i) => i % 2 === 0, ...[1, 2, 3, 4, 5].map((k) => { const r = rand(k); return () => r(); })];
      for (const a of answers) {
        const { taps, asked } = run(start(), a);
        expect(taps).toBeLessThanOrEqual(EASY_TAPS);
        expect(asked).toEqual(expect.arrayContaining(["age", "alone"]));
      }
    }, 120_000);
  }
});

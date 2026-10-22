/** (2026-10-22) 매일 변경 감지: 어제·오늘 원천을 비교해 추가·변경·삭제를 세고, 이상하면 경고 (배포 전 점검) */
import { describe, expect, it } from "vitest";
import { compareSnapshots, fingerprint, gateCheck, summarize, type SourceReport } from "../src/refresh/diff";

describe("fingerprint: 같은 내용이면 같은 지문, 조회수 같은 잡음은 무시", () => {
  it("키 순서와 무관", () => {
    expect(fingerprint({ a: 1, b: "x" })).toBe(fingerprint({ b: "x", a: 1 }));
  });
  it("무시할 필드는 빼고 계산", () => {
    const a = { servId: "W1", servNm: "기초연금", inqNum: "120" };
    const b = { servId: "W1", servNm: "기초연금", inqNum: "999" };
    expect(fingerprint(a, ["inqNum"])).toBe(fingerprint(b, ["inqNum"]));
    expect(fingerprint({ ...a, servNm: "기초연금 지원" }, ["inqNum"])).not.toBe(fingerprint(a, ["inqNum"]));
  });
});

describe("compareSnapshots", () => {
  it("추가·삭제·변경을 id로 센다", () => {
    const before = new Map([["1", "f1"], ["2", "f2"], ["3", "f3"]]);
    const after = new Map([["1", "f1"], ["2", "f2b"], ["4", "f4"]]);
    const d = compareSnapshots(before, after);
    expect(d).toEqual({ total: 3, previous: 3, added: ["4"], removed: ["3"], changed: ["2"] });
  });
  it("처음 수집이면 모두 추가", () => {
    const d = compareSnapshots(new Map(), new Map([["1", "a"]]));
    expect(d.added).toEqual(["1"]);
    expect(d.previous).toBe(0);
  });
});

describe("gateCheck: 배포 전 점검", () => {
  const ok: SourceReport = { source: "gov24", status: "ok", total: 10_000, previous: 10_050, added: [], removed: [], changed: [] };
  it("정상이면 경고 없음", () => {
    expect(gateCheck([ok])).toEqual({ ok: true, warnings: [] });
  });
  it("건수가 10% 넘게 줄면 경고", () => {
    const g = gateCheck([{ ...ok, total: 8_900 }]);
    expect(g.ok).toBe(false);
    expect(g.warnings[0]).toContain("gov24");
    expect(g.warnings[0]).toContain("11%");
  });
  it("수집 오류면 경고", () => {
    const g = gateCheck([{ ...ok, status: "error", detail: "HTTP 500" }]);
    expect(g.ok).toBe(false);
    expect(g.warnings[0]).toContain("HTTP 500");
  });
  it("처음 수집(이전 0건)은 감소로 보지 않음", () => {
    expect(gateCheck([{ ...ok, previous: 0 }]).ok).toBe(true);
  });
});

describe("summarize: 하루 기록 한 줄 (목록은 앞 50개만)", () => {
  it("개수와 표본", () => {
    const r: SourceReport = { source: "bokjiro", status: "ok", total: 5, previous: 4, added: Array.from({ length: 60 }, (_, i) => String(i)), removed: [], changed: ["x"] };
    const s = summarize(r);
    expect(s).toMatchObject({ source: "bokjiro", total: 5, added: 60, removed: 0, changed: 1 });
    expect(s.sample.added).toHaveLength(50);
  });
});

/** (2026-10-22 첫 매일 확인 뒤 보완) 복지로: 바뀐 상세를 지우지 않고 '다시 받을 것'으로 표시, 목록 호출 몫 남기기, 한도 소진은 '보류' */
import { describe, expect, it } from "vitest";
import { detailQueue, errorStatus, listReserve, nextStale } from "../src/bokjiro/ingest";

describe("바뀐 상세는 지우지 않고 다시 받을 것으로 표시", () => {
  it("목록 내용이 바뀐 서비스 중 상세가 있는 것만 표시, 예전 표시는 아직 목록에 있으면 유지", () => {
    const before = new Map([["A", "a1"], ["B", "b1"], ["C", "c1"]]);
    const after = new Map([["A", "a2"], ["B", "b1"], ["D", "d1"], ["E", "e1"]]);
    const has = (id: string) => ["A", "B", "E"].includes(id);
    // A: 바뀜·상세 있음 → 표시 / D: 새로 생김(상세 없음 → 어차피 받음) / C: 목록에서 빠져 예전 표시도 지움 / E: 예전 표시 유지
    expect([...nextStale(before, after, has, new Set(["C", "E"]))].sort()).toEqual(["A", "E"]);
  });
  it("받을 순서: 바뀐 상세 먼저, 그다음 아직 없는 상세 (목록 순서대로)", () => {
    const has = (id: string) => ["A", "B", "C"].includes(id);
    const q = detailQueue(["A", "B", "C", "D", "E"], has, new Set(["C"]));
    expect(q).toEqual({ queue: ["C", "D", "E"], cached: 2 });
  });
});

describe("목록 호출 몫", () => {
  it("지난번 목록 쪽수만큼 남기되 최소 1번", () => {
    expect(listReserve(0)).toBe(1);
    expect(listReserve(10)).toBe(10);
  });
});

describe("오류 상태", () => {
  it("우리 하루 호출 예산 소진은 '보류', 그 밖은 '오류'", () => {
    expect(errorStatus("BUDGET")).toBe("held");
    expect(errorStatus("30")).toBe("error");
    expect(errorStatus("RETRY")).toBe("error");
  });
});

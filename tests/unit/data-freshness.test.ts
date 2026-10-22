/** (2026-10-22 보완대책 9) 매일 확인이 멈추면 데이터 현황에 '확인 지연'을 보인다 — 36시간 넘게 새 확인이 없을 때 */
import { describe, expect, it } from "vitest";
import { STALE_HOURS, staleHours } from "@/lib/data/freshness";

describe("확인 지연", () => {
  const now = new Date("2026-10-24T03:00:00Z");
  it("36시간 이내면 지연 아님", () => {
    expect(STALE_HOURS).toBe(36);
    expect(staleHours("2026-10-23T15:12:00Z", now)).toBeNull();
  });
  it("36시간을 넘으면 몇 시간 지났는지", () => {
    expect(staleHours("2026-10-22T13:00:00Z", now)).toBe(38);
  });
  it("날짜를 못 읽으면 지연으로 보지 않음 (오류 표시는 따로)", () => {
    expect(staleHours("abc", now)).toBeNull();
  });
});

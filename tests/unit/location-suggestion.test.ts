import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRegions } from "@/lib/client/bundles";
import { currentPosition, loadBoundaries, sigunguAt } from "@/lib/client/locate";

vi.mock("@/lib/client/bundles", () => ({ loadRegions: vi.fn() }));
vi.mock("@/lib/client/locate", () => ({ currentPosition: vi.fn(), loadBoundaries: vi.fn(), sigunguAt: vi.fn() }));
const expected = { sido: "41000", sigungu: "41110", label: "경기 수원시" };

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.mocked(currentPosition).mockResolvedValue({ lat: 37.2636, lng: 127.0286 });
  vi.mocked(loadBoundaries).mockResolvedValue([]);
  vi.mocked(sigunguAt).mockReturnValue("41110");
  vi.mocked(loadRegions).mockResolvedValue({ schema: 1, generatedAt: "2026-10-17", sidos: [{ code: "41000", name: "경기도", short: "경기", pilot: true, count: 1, sigungus: [{ code: "41110", name: "수원시", count: 1 }] }] });
});
afterEach(() => vi.useRealTimers());

describe("첫 진입 위치 준비", () => {
  it("홈과 질문이 진행 중 조회와 완료한 시군구 결과를 공유한다", async () => {
    const { suggestLocation } = await import("@/lib/client/locationSuggestion");
    const home = suggestLocation();
    expect(suggestLocation()).toBe(home);
    await expect(home).resolves.toEqual(expected);
    await expect(suggestLocation()).resolves.toEqual(expected);
    expect(currentPosition).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("권한 거절을 재요청하지 않고, 명시적 재시도에서 새 위치를 조회한다", async () => {
    vi.mocked(currentPosition).mockRejectedValueOnce(new Error("denied"));
    const { suggestLocation } = await import("@/lib/client/locationSuggestion");
    await expect(suggestLocation()).resolves.toBeNull();
    await expect(suggestLocation()).resolves.toBeNull();
    expect(currentPosition).toHaveBeenCalledTimes(1);
    await expect(suggestLocation(true)).resolves.toEqual(expected);
    expect(currentPosition).toHaveBeenCalledTimes(2);
  });
  it("권한 대기 무응답도 15초 안에 끝내고 늦은 응답으로 캐시를 덮지 않는다", async () => {
    let resolve!: (pos: { lat: number; lng: number }) => void;
    vi.mocked(currentPosition).mockReturnValue(new Promise((done) => { resolve = done; }));
    const { suggestLocation } = await import("@/lib/client/locationSuggestion");
    const result = suggestLocation();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(result).resolves.toBeNull();
    resolve({ lat: 37.2636, lng: 127.0286 });
    await expect(suggestLocation()).resolves.toBeNull();
    expect(currentPosition).toHaveBeenCalledTimes(1);
  });
  it("지역 자료 응답이 없을 때도 대기가 끝난다", async () => {
    vi.mocked(loadBoundaries).mockReturnValue(new Promise(() => {}));
    const { suggestLocation } = await import("@/lib/client/locationSuggestion");
    const result = suggestLocation();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(result).resolves.toBeNull();
  });
  it("탐색 중 시간이 지나도 자동 재요청하지 않고 명시적 재시도만 허용한다", async () => {
    const { suggestLocation } = await import("@/lib/client/locationSuggestion");
    await suggestLocation();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await suggestLocation();
    expect(currentPosition).toHaveBeenCalledTimes(1);
    await expect(suggestLocation(true)).resolves.toEqual(expected);
    expect(currentPosition).toHaveBeenCalledTimes(2);
  });
  it("국내 지역을 확인하지 못하면 주소를 임의 지정하지 않는다", async () => {
    vi.mocked(sigunguAt).mockReturnValue(null);
    const { suggestLocation } = await import("@/lib/client/locationSuggestion");
    await expect(suggestLocation()).resolves.toBeNull();
  });
});

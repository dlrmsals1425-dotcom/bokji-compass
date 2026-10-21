import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearProfile, readExampleRegion, readQuickResults, saveExampleRegion, saveProfile, setReceiving, setSettings } from "@/lib/client/storage";
import { EMPTY_PROFILE } from "@/lib/engine/profile";

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

describe("이미 받는 혜택과 홈 예시 지역을 함께 보존", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
    setSettings({ shared: false });
    clearProfile();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("새 음성 검색은 이전 수급 표시와 분리하고 새 검색에서만 초기화", () => {
    setReceiving("parent", "old-normal", true);
    saveProfile(EMPTY_PROFILE, undefined, "parent", undefined, true, true);
    expect(readQuickResults()).toBe(true);
    setReceiving("parent", "quick-one", true);
    expect(localStorage.getItem("bn.receiving.v1")).toContain("old-normal");
    expect(localStorage.getItem("bn.quickReceiving.v1")).toContain("quick-one");
    saveProfile(EMPTY_PROFILE, undefined, "parent", undefined, true);
    expect(localStorage.getItem("bn.quickReceiving.v1")).toContain("quick-one");
    saveProfile(EMPTY_PROFILE, undefined, "parent", undefined, true, true);
    expect(localStorage.getItem("bn.quickReceiving.v1")).toBeNull();
    saveProfile(EMPTY_PROFILE, undefined, "parent");
    expect(readQuickResults()).toBe(false);
    expect(localStorage.getItem("bn.receiving.v1")).toContain("old-normal");
  });

  it("공용 기기 모드를 켜고 꺼도 본인·부모님 표시와 예시 지역이 함께 옮겨진다", () => {
    setReceiving("self", "보육료", true);
    setReceiving("parent", "기초연금", true);
    saveExampleRegion("41460");
    const marked = JSON.stringify({ self: ["보육료"], parent: ["기초연금"] });

    setSettings({ shared: true });
    expect(localStorage.getItem("bn.receiving.v1")).toBeNull();
    expect(localStorage.getItem("bn.exampleRegion.v1")).toBeNull();
    expect(sessionStorage.getItem("bn.receiving.v1")).toBe(marked);
    expect(readExampleRegion()).toBe("41460");
    setReceiving("self", "보육료", false);
    expect(JSON.parse(sessionStorage.getItem("bn.receiving.v1")!)).toEqual({ self: [], parent: ["기초연금"] });

    setSettings({ shared: false });
    expect(sessionStorage.getItem("bn.receiving.v1")).toBeNull();
    expect(sessionStorage.getItem("bn.exampleRegion.v1")).toBeNull();
    expect(JSON.parse(localStorage.getItem("bn.receiving.v1")!)).toEqual({ self: [], parent: ["기초연금"] });
    expect(readExampleRegion()).toBe("41460");
  });

  it("이 기기에서 지우기는 두 저장소의 표시와 예시 지역을 모두 지운다", () => {
    for (const store of [localStorage, sessionStorage]) {
      store.setItem("bn.receiving.v1", JSON.stringify({ self: [], parent: ["기초연금"] }));
      store.setItem("bn.exampleRegion.v1", "41460");
    }
    clearProfile();
    for (const store of [localStorage, sessionStorage]) {
      expect(store.getItem("bn.receiving.v1")).toBeNull();
      expect(store.getItem("bn.exampleRegion.v1")).toBeNull();
    }
  });
});

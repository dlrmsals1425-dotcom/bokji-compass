"use client";
/**
 * 기기 저장소 (설계서 6.4): 프로필은 서버로 보내지 않고 이 기기에만 저장한다.
 * - 기본: localStorage (다음 방문 때 이어서 보기)
 * - 공용 기기 모드: sessionStorage (브라우저를 닫으면 사라짐)
 * useSyncExternalStore 로 구독 → SSR 에서는 undefined(로딩), 클라이언트에서는 Profile | null.
 */
import { useSyncExternalStore } from "react";
import { EMPTY_PROFILE, type Profile } from "../engine/profile";
import type { FindMode, FillerRole } from "./mode";
import type { Extras } from "./v2";

const PROFILE_KEY = "bn.profile.v1";
const SETTINGS_KEY = "bn.settings.v1";
const EXAMPLE_KEY = "bn.example.v1";
const MODE_KEY = "bn.mode.v1";
const FILLER_KEY = "bn.filler.v1";
/** (2026-10-21) 부모님 찾기를 조부모님·어르신 가족으로 — 문구만 '어르신' (판정은 같음, 기기에만 저장) */
const ELDER_KEY = "bn.elder.v1";
/** v2 시험판: 항목별 '모름'까지 담은 상황 답 (기기에만 저장) */
const EXTRAS_KEY = "bn.facts.v1";
/** (QA 8차) 본인·부모님 답을 따로 — 대상을 바꿔도 다른 사람의 나이·소득·하는 일이 넘어가지 않게 (기기에만 저장) */
const DRAFT_KEY = "bn.drafts.v1";
/** (QA 8차) 서비스 검색에서 고른 시·도/시·군·구 — 새로고침해도 유지 (주소에는 싣지 않음) */
const SEARCH_REGION_KEY = "bn.searchRegion.v1";
/** 이미 받고 있는 혜택 (대상별: 본인 / 부모님, 사업 묶음 이름만) */
const RECEIVING_KEY = "bn.receiving.v1";
const QUICK_RECEIVING_KEY = "bn.quickReceiving.v1";
/** 홈 예시를 옮겨 보여 줄 시·군·구 (현재 위치나 직접 고른 곳, 코드만) */
const EXAMPLE_REGION_KEY = "bn.exampleRegion.v1";

/** 주민센터 등 키오스크(태블릿) 모드 (2026-10-16 회의): 그 기관이 있는 시·군·구로 고정, 손대지 않으면 지우고 처음으로 */
export interface KioskSettings {
  sido: string;
  sigungu: string;
  label: string;
  /** 손대지 않은 뒤 안내까지 (초) */
  idleSec: number;
}
export interface Settings {
  large: boolean;
  shared: boolean;
  kiosk: KioskSettings | null;
}
const DEFAULT_SETTINGS: Settings = { large: false, shared: false, kiosk: null };

const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === PROFILE_KEY || e.key === SETTINGS_KEY || e.key === EXAMPLE_KEY || e.key === MODE_KEY || e.key === FILLER_KEY || e.key === ELDER_KEY || e.key === EXTRAS_KEY || e.key === DRAFT_KEY || e.key === SEARCH_REGION_KEY || e.key === RECEIVING_KEY || e.key === QUICK_RECEIVING_KEY) emit();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function safeGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

/* ---------- settings ---------- */
let settingsCache: { raw: string | null; value: Settings } = { raw: null, value: DEFAULT_SETTINGS };
function readSettings(): Settings {
  const raw = safeGet(localStorage, SETTINGS_KEY);
  if (raw !== settingsCache.raw) {
    let value = DEFAULT_SETTINGS;
    try {
      value = { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
    } catch {}
    settingsCache = { raw, value };
  }
  return settingsCache.value;
}

export function setSettings(patch: Partial<Settings>) {
  const prev = readSettings();
  const next = { ...prev, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {}
  document.documentElement.dataset.large = next.large ? "1" : "0";
  if (next.kiosk) document.documentElement.dataset.kiosk = "1";
  else delete document.documentElement.dataset.kiosk;
  // 공용 기기 모드 전환 시 프로필 저장 위치를 옮긴다
  if (prev.shared !== next.shared) {
    const from = prev.shared ? sessionStorage : localStorage;
    const to = next.shared ? sessionStorage : localStorage;
    for (const key of [PROFILE_KEY, EXAMPLE_KEY, MODE_KEY, FILLER_KEY, ELDER_KEY, EXTRAS_KEY, DRAFT_KEY, SEARCH_REGION_KEY, RECEIVING_KEY, QUICK_RECEIVING_KEY, EXAMPLE_REGION_KEY]) {
      const raw = safeGet(from, key);
      try {
        from.removeItem(key);
        if (raw) to.setItem(key, raw);
      } catch {}
    }
  }
  emit();
}

export function useSettings(): Settings | undefined {
  return useSyncExternalStore(subscribe, readSettings, () => undefined);
}

/** 키오스크 켜기: 공용 기기(브라우저를 닫으면 지워짐) + 큰 글씨. 끄면 공용 기기 설정은 그대로 둔다 */
export function setKiosk(k: KioskSettings | null) {
  if (k) setSettings({ kiosk: k, shared: true, large: true });
  else setSettings({ kiosk: null });
}

/* ---------- profile ---------- */
let profileCache: { raw: string | null; value: Profile | null } = { raw: null, value: null };
function profileStore(): Storage {
  return readSettings().shared ? sessionStorage : localStorage;
}
function readProfile(): Profile | null {
  const raw = safeGet(profileStore(), PROFILE_KEY);
  if (raw !== profileCache.raw) {
    let value: Profile | null = null;
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && (parsed.sigungu || (parsed.__quick === true && typeof parsed.age === "string"))) {
        const { __quick, ...fields } = parsed;
        void __quick;
        value = { ...EMPTY_PROFILE, ...fields };
      }
    } catch {}
    profileCache = { raw, value };
  }
  return profileCache.value;
}

/**
 * exampleId: 홈의 '예시 상황'으로 채운 경우 그 id. mode: 본인/부모님 찾기.
 * x: '상황 먼저' 답(항목별 모름·월 소득). 주지 않으면 지난 답을 지운다 — 프로필과 어긋난 답이 남지 않게.
 */
export function saveProfile(p: Profile, exampleId?: string, mode?: FindMode, x?: Extras, quick = false, resetQuickReceiving = false) {
  try {
    profileStore().setItem(PROFILE_KEY, JSON.stringify({ ...p, __quick: quick }));
    if (resetQuickReceiving) profileStore().removeItem(QUICK_RECEIVING_KEY);
    if (x) profileStore().setItem(EXTRAS_KEY, JSON.stringify(x));
    else {
      localStorage.removeItem(EXTRAS_KEY);
      sessionStorage.removeItem(EXTRAS_KEY);
    }
    if (exampleId) profileStore().setItem(EXAMPLE_KEY, exampleId);
    else {
      localStorage.removeItem(EXAMPLE_KEY);
      sessionStorage.removeItem(EXAMPLE_KEY);
    }
    if (mode) {
      profileStore().setItem(MODE_KEY, mode);
      modeCache = { raw: mode, value: mode };
      if (x) writeDraft(mode, { profile: p, x });
    }
  } catch {}
  emit();
}

/** Keep optional-question behavior when returning from a detail page or reloading. */
export function readQuickResults(): boolean {
  try { return JSON.parse(safeGet(profileStore(), PROFILE_KEY) ?? "null")?.__quick === true; }
  catch { return false; }
}
export function useQuickResults(): boolean | undefined {
  return useSyncExternalStore(subscribe, readQuickResults, () => undefined);
}

/* ---------- 서비스 검색 지역 ---------- */
export interface SearchRegion {
  sido: string | null;
  sigungu: string | null;
}
let searchRegionCache: { raw: string | null; value: SearchRegion | null } = { raw: null, value: null };
function readSearchRegion(): SearchRegion | null {
  const raw = safeGet(profileStore(), SEARCH_REGION_KEY);
  if (raw !== searchRegionCache.raw) {
    let value: SearchRegion | null = null;
    try {
      const v = JSON.parse(raw ?? "null");
      const ok = (x: unknown) => x === null || (typeof x === "string" && /^\d{5}$/.test(x));
      if (v && typeof v === "object" && ok(v.sido) && ok(v.sigungu)) value = { sido: v.sido, sigungu: v.sigungu };
    } catch {}
    searchRegionCache = { raw, value };
  }
  return searchRegionCache.value;
}
export function saveSearchRegion(r: SearchRegion) {
  try {
    profileStore().setItem(SEARCH_REGION_KEY, JSON.stringify(r));
  } catch {}
  emit();
}
/** undefined = 확인 전(SSR), null = 고른 적 없음 */
export function useSearchRegion(): SearchRegion | null | undefined {
  return useSyncExternalStore(subscribe, readSearchRegion, () => undefined);
}

/* ---------- 이미 받고 있는 혜택 (2026-10-16) ---------- */
type Receiving = Record<FindMode, string[]>;
const EMPTY_RECEIVING: Receiving = { self: [], parent: [] };
let receivingCache: { raw: string | null; value: Receiving } = { raw: null, value: EMPTY_RECEIVING };
function readReceiving(): Receiving {
  const raw = safeGet(profileStore(), readQuickResults() ? QUICK_RECEIVING_KEY : RECEIVING_KEY);
  if (raw !== receivingCache.raw) {
    let value = EMPTY_RECEIVING;
    try {
      const v = JSON.parse(raw ?? "null");
      const list = (x: unknown) => (Array.isArray(x) ? x.filter((k): k is string => typeof k === "string").slice(0, 200) : []);
      if (v && typeof v === "object") value = { self: list(v.self), parent: list(v.parent) };
    } catch {}
    receivingCache = { raw, value };
  }
  return receivingCache.value;
}
export function setReceiving(mode: FindMode, key: string, on: boolean) {
  const cur = readReceiving();
  const list = cur[mode].filter((k) => k !== key);
  const next = { ...cur, [mode]: on ? [...list, key] : list };
  try {
    profileStore().setItem(readQuickResults() ? QUICK_RECEIVING_KEY : RECEIVING_KEY, JSON.stringify(next));
  } catch {}
  emit();
}
/** undefined = 확인 전(SSR) */
export function useReceiving(): Receiving | undefined {
  return useSyncExternalStore(subscribe, readReceiving, () => undefined);
}

/* ---------- 홈 예시 지역 (2026-10-16: 다음 방문에는 위치를 다시 묻지 않고 이 지역으로) ---------- */
export function readExampleRegion(): string | null {
  const raw = safeGet(profileStore(), EXAMPLE_REGION_KEY);
  return raw && /^\d{5}$/.test(raw) ? raw : null;
}
export function saveExampleRegion(sigungu: string | null) {
  try {
    if (sigungu) profileStore().setItem(EXAMPLE_REGION_KEY, sigungu);
    else profileStore().removeItem(EXAMPLE_REGION_KEY);
  } catch {}
}

/* ---------- 대상별 답 (본인 / 부모님) ---------- */
export interface Draft {
  profile: Profile;
  x: Extras;
}
function readDrafts(): Partial<Record<FindMode, Draft>> {
  try {
    const v = JSON.parse(safeGet(profileStore(), DRAFT_KEY) ?? "null");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function writeDraft(mode: FindMode, d: Draft) {
  try {
    profileStore().setItem(DRAFT_KEY, JSON.stringify({ ...readDrafts(), [mode]: d }));
  } catch {}
}
/** 이 대상(본인/부모님)으로 마지막에 저장한 답 (없으면 null — 다른 대상의 답을 대신 쓰지 않는다) */
export function readDraft(mode: FindMode): Draft | null {
  const d = readDrafts()[mode];
  if (!d || typeof d !== "object" || !d.profile || !d.x) return null;
  return { profile: { ...EMPTY_PROFILE, ...d.profile }, x: d.x };
}

function readExample(): string | null {
  return safeGet(profileStore(), EXAMPLE_KEY);
}

/** 지금 결과가 예시 상황인지 (예시 id) */
export function useExample(): string | null | undefined {
  return useSyncExternalStore(subscribe, readExample, () => undefined);
}

/* ---------- find mode (self | parent) ---------- */
let modeCache: { raw: string | null; value: FindMode } = { raw: null, value: "self" };
function readMode(): FindMode {
  const raw = safeGet(profileStore(), MODE_KEY);
  if (raw !== modeCache.raw) {
    modeCache = { raw, value: raw === "parent" ? "parent" : "self" };
  }
  return modeCache.value;
}

export function saveMode(mode: FindMode) {
  try {
    profileStore().setItem(MODE_KEY, mode);
    modeCache = { raw: mode, value: mode };
  } catch {}
  emit();
}

export function useMode(): FindMode | undefined {
  return useSyncExternalStore(subscribe, readMode, () => undefined);
}

/* ---------- filler role (copy only) ---------- */
let fillerCache: { raw: string | null; value: FillerRole } = { raw: null, value: "child" };
function readFiller(): FillerRole {
  const raw = safeGet(profileStore(), FILLER_KEY);
  if (raw !== fillerCache.raw) {
    const v = raw === "relative" || raw === "other" || raw === "child" ? raw : "child";
    fillerCache = { raw, value: v };
  }
  return fillerCache.value;
}

export function saveFiller(role: FillerRole) {
  try {
    profileStore().setItem(FILLER_KEY, role);
    fillerCache = { raw: role, value: role };
  } catch {}
  emit();
}

export function useFiller(): FillerRole | undefined {
  return useSyncExternalStore(subscribe, readFiller, () => undefined);
}

/* ---------- 조부모님·어르신 가족 (문구만) ---------- */
const readElder = (): boolean => safeGet(profileStore(), ELDER_KEY) === "1";

export function setElder(on: boolean) {
  try {
    if (on) profileStore().setItem(ELDER_KEY, "1");
    else profileStore().removeItem(ELDER_KEY);
  } catch {}
  emit();
}

export function useElder(): boolean | undefined {
  return useSyncExternalStore(subscribe, readElder, () => undefined);
}

/** '이 기기에서 지우기' — 두 저장소 모두에서 삭제 */
export function clearProfile() {
  try {
    for (const store of [localStorage, sessionStorage]) {
      store.removeItem(PROFILE_KEY);
      store.removeItem(EXAMPLE_KEY);
      store.removeItem(MODE_KEY);
      store.removeItem(FILLER_KEY);
      store.removeItem(ELDER_KEY);
      store.removeItem(EXTRAS_KEY);
      store.removeItem(DRAFT_KEY);
      store.removeItem(SEARCH_REGION_KEY);
      store.removeItem(RECEIVING_KEY);
      store.removeItem(QUICK_RECEIVING_KEY);
      store.removeItem(EXAMPLE_REGION_KEY);
    }
  } catch {}
  extrasCache = { raw: null, value: null };
  profileCache = { raw: null, value: null };
  modeCache = { raw: null, value: "self" };
  fillerCache = { raw: null, value: "child" };
  emit();
}

/** undefined = 아직 확인 전(SSR/하이드레이션), null = 저장된 입력 없음 */
export function useProfile(): Profile | null | undefined {
  return useSyncExternalStore(subscribe, readProfile, () => undefined);
}

/* ---------- 상황 답 (항목별 '모름'·월 소득) ---------- */
const EMPTY_EXTRAS: Extras = { benefits: {}, traits: {}, incomeManwon: null, facts: {} };
let extrasCache: { raw: string | null; value: Extras | null } = { raw: null, value: null };
function readExtras(): Extras | null {
  const raw = safeGet(profileStore(), EXTRAS_KEY);
  if (raw !== extrasCache.raw) {
    let value: Extras | null = null;
    try {
      const v = raw ? JSON.parse(raw) : null;
      if (v && typeof v === "object") value = { ...EMPTY_EXTRAS, ...v };
    } catch {}
    extrasCache = { raw, value };
  }
  return extrasCache.value;
}

/** 상황 답 (null = 저장된 답 없음 → 프로필에서 만든다) */
export function useExtras(): Extras | null | undefined {
  return useSyncExternalStore(subscribe, readExtras, () => undefined);
}

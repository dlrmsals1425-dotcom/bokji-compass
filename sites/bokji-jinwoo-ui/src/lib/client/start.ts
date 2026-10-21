/**
 * 상황 저장·예시 시작 (홈 예시 버튼, /results?example=, 상황 입력, 추가 질문이 함께 쓴다).
 * 프로필·답은 이 기기(localStorage/sessionStorage)에만 저장하고 주소에는 싣지 않는다.
 */
import type { Profile } from "../engine/profile";
import type { FindMode } from "./mode";
import type { Preset } from "./presets";
import { saveFiller, saveProfile } from "./storage";
import { extrasFromProfile, profileForStorage, type Extras, type Situation } from "./v2";

/** 저장된 프로필 + 답 → 판정용 상황 (답이 없으면 프로필에서 만든다: 예전 입력·v1 입력과 호환) */
export function situationOf(profile: Profile, x: Extras | null, mode: FindMode): Situation {
  return { profile, x: x ?? extrasFromProfile(profile), mode };
}

/** 상황 저장 (프로필은 v1 화면과 같이 쓰는 형태로, 항목별 답은 따로) */
export function saveSituation(s: Situation, mode: FindMode, exampleId?: string, quick = false, resetQuickReceiving = false) {
  saveProfile(profileForStorage(s), exampleId, mode, s.x, quick, resetQuickReceiving);
}

/** 예시 상황으로 시작 */
export function startPreset(p: Preset, modeOverride?: FindMode) {
  const mode = modeOverride ?? p.mode ?? "self";
  saveSituation({ profile: p.profile, x: p.x, mode }, mode, p.id);
  if (mode === "parent") saveFiller("child");
}

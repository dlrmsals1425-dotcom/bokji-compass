"use client";
import { loadRegions } from "./bundles";
import { currentPosition, loadBoundaries, sigunguAt } from "./locate";

export type LocationSuggestion = { sido: string; sigungu: string; label: string };
const MAX_WAIT = 15_000;
let cached: Promise<LocationSuggestion | null> | null = null;

/** 홈·예시·질문이 탭 안에서 같은 조회를 공유한다. 재시도 버튼을 눌렀을 때만 새로 조회한다. 좌표나 결과는 영구 저장하지 않는다. */
export function suggestLocation(refresh = false): Promise<LocationSuggestion | null> {
  if (!refresh && cached) return cached;

  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), MAX_WAIT); });
  const lookup = Promise.all([currentPosition(), loadBoundaries(), loadRegions()]).then(([pos, boundaries, regions]) => {
    const code = sigunguAt(boundaries, pos.lat, pos.lng);
    for (const sido of regions?.sidos ?? []) {
      const sigungu = sido.sigungus.find((region) => region.code === code);
      if (sigungu) return { sido: sido.code, sigungu: sigungu.code, label: `${sido.short ?? sido.name} ${sigungu.name}` };
    }
    return null;
  });
  // 브라우저가 권한 응답을 기다리는 동안 자체 timeout을 시작하지 않아도 UI는 멈추지 않는다.
  const result = Promise.race([lookup, timeout]).catch(() => null).finally(() => clearTimeout(timer));
  cached = result;
  return result;
}

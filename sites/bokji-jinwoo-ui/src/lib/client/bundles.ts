"use client";
/** 번들 로더: 전국 + 시도 + 시군구 번들을 받아 브라우저에서만 판정한다 (프로필은 전송하지 않음). */
import type { Bundle, LocalOperation, Program, RegionIndex } from "../data/types";
import { detailBucket } from "../data/bucket";
import { normalizeDeep } from "../data/text";
import { inLegacyArea } from "../data/legacyArea";
import { refineProgram } from "../data/refine";

export const BUNDLE_BASE = "/bundles/v1";
const cache = new Map<string, Promise<unknown>>();

function getJSON<T>(path: string): Promise<T | null> {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(`${BUNDLE_BASE}/${path}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return cache.get(path) as Promise<T | null>;
}

export function loadRegions() {
  return getJSON<RegionIndex>("regions.json");
}

export interface Loaded {
  programs: Program[];
  localOps: Record<string, LocalOperation[]>;
  label: string;
}

export async function loadForRegion(sido: string | null, sigungu: string | null): Promise<Loaded> {
  const [nat, sd, sg] = await Promise.all([
    getJSON<Bundle>("national.json"),
    sido ? getJSON<Bundle>(`sido/${sido}.json`) : Promise.resolve(null),
    sigungu ? getJSON<Bundle>(`sigungu/${sigungu}.json`) : Promise.resolve(null),
  ]);
  // 규칙 다듬기(refine.ts)는 번들을 만들 때도 적용되지만, 이전에 만든 번들에도 같은 결과가 나오게 읽을 때 한 번 더 (멱등)
  // 전남광주통합특별시: 옛 광주시·옛 전남도 사업은 그 옛 지역 주민에게만 (legacyArea.ts)
  const sdPrograms = (sd?.programs ?? []).filter((p) => inLegacyArea(p, sigungu));
  const programs = [...(sg?.programs ?? []), ...sdPrograms, ...(nat?.programs ?? [])].map(refineFor);
  const localOps = { ...(sd?.localOps ?? {}), ...(sg?.localOps ?? {}) };
  return { programs, localOps, label: sg?.label ?? sd?.label ?? "전국" };
}

const refined = new WeakMap<Program, Program>();
function refineFor(p: Program): Program {
  let r = refined.get(p);
  if (!r) refined.set(p, (r = refineProgram(p)));
  return r;
}

/** id 접두어로 번들 위치를 찾는다: n.… 전국, s41000.… 시도, g41110.… 시군구 */
export function bundlePathForId(id: string): string | null {
  if (id.startsWith("n.")) return "national.json";
  const m = /^([sg])(\d{5})\./.exec(id);
  if (!m) return null;
  return `${m[1] === "s" ? "sido" : "sigungu"}/${m[2]}.json`;
}

/** 상세: id 해시 샤드(details/{bucket}.json)에서 전체 필드를 읽는다 */
export async function loadProgram(id: string): Promise<Program | null> {
  if (!bundlePathForId(id)) return null;
  const shard = await getJSON<Record<string, Program>>(`details/${detailBucket(id)}.json`);
  // 번들은 만들 때 정리되지만, 예전 캐시·새 원문에 남은 엔티티·깨진 글자를 한 번 더 정리 (한 건이라 가벼움)
  const p = shard?.[id];
  return p ? refineProgram(normalizeDeep(p)) : null;
}

export async function loadLocalOps(id: string, sido: string | null, sigungu: string | null): Promise<LocalOperation[]> {
  const [sd, sg] = await Promise.all([
    sido ? getJSON<Bundle>(`sido/${sido}.json`) : Promise.resolve(null),
    sigungu ? getJSON<Bundle>(`sigungu/${sigungu}.json`) : Promise.resolve(null),
  ]);
  return [...(sg?.localOps?.[id] ?? []), ...(sd?.localOps?.[id] ?? [])];
}

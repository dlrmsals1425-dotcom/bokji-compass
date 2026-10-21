/**
 * (전국 확대 ②, 2026-10-10) 전남광주통합특별시(12000)는 2026-07-01 광주광역시(29000)·전라남도(46000)가 합쳐진 곳이다
 * (행정표준코드 pipeline/data/sigungu_codes_20260701.tsv). 원천 데이터의 시·도 단위 사업은 대부분 옛 광주시·옛 전남도가 등록한 것이라
 * 통합시 전체로 두면 영암군 주민에게 '광주청년구직활동수당'이 나오는 식이 된다 → 옛 지역 안에서만 보여 준다.
 * 판단 근거(지어내지 않음): 정부24 서비스 ID의 기관 코드(6290000 광주광역시, 6460000 전라남도)와 이름·기관에 적힌 옛 지역 이름.
 * 어느 쪽인지 알 수 없는 사업(통합시 이름으로 새로 등록, 교육청 등)은 통합시 전체에 그대로 둔다.
 */
import type { Program } from "./types";

export const MERGED_SIDO = "12000";
/** 옛 광주광역시 자치구 (통합 뒤 코드) */
export const FORMER_GWANGJU_SIGUNGU = new Set(["12210", "12240", "12270", "12300", "12330"]);

type Area = "gwangju" | "jeonnam";

export function legacyAreas(p: Pick<Program, "name" | "owner" | "sources">): Set<Area> | null {
  const out = new Set<Area>();
  for (const s of p.sources) {
    if (s.source !== "gov24") continue;
    const id = String(s.id);
    if (id.startsWith("6290000")) out.add("gwangju");
    else if (id.startsWith("6460000")) out.add("jeonnam");
  }
  if (out.size) return out;
  // 이름·기관에 적힌 옛 지역 ('전남광주통합특별시'라는 새 이름은 빼고 본다)
  const text = `${p.name} ${p.owner ?? ""}`.replace(/전남광주통합특별시/g, " ");
  if (/\(\s*구\s*광주\s*\)|광주\s*광역시|광주형|광주다움|광주\s*청년|빛고을/.test(text)) out.add("gwangju");
  if (/\(\s*구\s*전남\s*\)|전라\s*남도|전남(?!광주)/.test(text)) out.add("jeonnam");
  return out.size ? out : null;
}

/** 이 시·군·구 주민에게 보여 줄 통합시 시·도 단위 사업인지 */
export function inLegacyArea(p: Pick<Program, "name" | "owner" | "sources" | "scope" | "region">, sigungu: string | null): boolean {
  if (p.scope !== "sido" || p.region?.sido !== MERGED_SIDO || !sigungu) return true;
  const areas = legacyAreas(p);
  if (!areas) return true;
  return areas.has(FORMER_GWANGJU_SIGUNGU.has(sigungu) ? "gwangju" : "jeonnam");
}

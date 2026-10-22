/**
 * 판정·분류 표시. 색깔 알약 배지 대신 굵은 글자/회색 글자로만 보여 준다.
 * (이름은 예전 컴포넌트와 같게 유지)
 */
import type { Tier } from "@/lib/engine/types";
import { TIER_LABEL } from "@/lib/engine/types";
import { APPLY_TYPE_LABEL, ORG_TYPE_LABEL, SECTOR_LABEL, type Program } from "@/lib/data/types";

export function TierBadge({ tier }: { tier: Tier }) {
  return <strong className={`status tier-${tier}`}>{TIER_LABEL[tier]}</strong>;
}

/** 기관 단계 · 지역 (예: 시군구 · 경기도 수원시) */
/** 통합돌봄 메뉴판 등 지역 목록에 실린 전국 공통 사업의 소관 표시 */
export const NATIONAL_OWNER = /^중앙부처\s*\(전국 공통 사업\)$/;

export function orgText(p: Program): string {
  const where = p.scope === "national" ? "전국" : (p.region?.label ?? "");
  // (QA 8차) 지역 목록에 실린 중앙부처 사업(국가건강검진 등)을 그 지역 사업처럼 보이지 않게.
  // (2026-10-16) '전국 공통'은 어디서나 받을 수 있다고 읽혀 쓰지 않음 — 메뉴판의 '전국'은 중앙부처 사업이라는 뜻이고 시범사업처럼 일부 지역만 하는 것도 있음
  if (p.scope !== "national" && NATIONAL_OWNER.test(p.owner ?? "")) return `중앙부처 사업${where ? ` · ${where} 안내` : ""}`;
  return `${ORG_TYPE_LABEL[p.orgType]}${where ? ` · ${where}` : ""}`;
}

/** 소관기관 표시 — 통합돌봄 메뉴판의 '중앙부처 (전국 공통 사업)'은 어느 지역 안내에 실린 것인지로 */
export function ownerText(p: Pick<Program, "owner" | "region">): string | undefined {
  if (!p.owner) return undefined;
  if (NATIONAL_OWNER.test(p.owner)) return `중앙부처 (${p.region?.label ? `${p.region.label} ` : ""}통합돌봄 안내에 실린 사업)`;
  return p.owner;
}

/** 기관 표시에서 이미 적은 지역 이름을 빼고 부서만 (QA 8차: '경기 용인시 · 경기도 용인시 복지여성국…' 중복) */
export function orgWhere(p: Program): string | undefined {
  const raw = (p.provider || p.owner || "").trim();
  if (!raw || NATIONAL_OWNER.test(raw)) return undefined;
  const sgg = p.region?.label?.split(" ").pop();
  if (!sgg) return raw;
  const m = new RegExp(`^(?:\\S+(?:도|특별시|광역시|특별자치시|특별자치도|통합특별시)\\s+)?${sgg}(?:\\s+|$)`).exec(raw);
  const rest = m ? raw.slice(m[0].length).trim() : raw;
  return rest || undefined;
}

export function reviewText(p: Program): string | null {
  if (p.rule.review === "verified") return "검수 규칙";
  if (p.rule.review === "curated") return "검수 규칙(1차)";
  // (2026-10-22 외부 점검 P3-11) 'API 지원조건'은 뜻이 안 와닿음 → 어디의 조건인지
  if (p.rule.review === "structured") return "정부24 지원조건 기준";
  return null;
}

/** 수동 보강 사업인지 (원천 데이터에 없어 기관 공식 누리집에서 직접 옮긴 정보) */
export const isManual = (p: Program) => p.sources.some((s) => s.source === "manual");
export const MANUAL_TITLE = "원천 데이터(정부24·복지로·통합돌봄)에 없어 기관 공식 누리집에서 직접 확인해 옮긴 정보예요. 원문 링크에서 최신 내용을 확인하세요.";

/** 복지 외 분야·운영 지원 표시 (기본 숨김 대상) */
export function sectorText(p: Program): string | null {
  if (!p.sector) return null;
  return p.sector === "operator" ? SECTOR_LABEL[p.sector] : `${SECTOR_LABEL[p.sector]} 대상`;
}

const APPLY_TITLE = {
  self: "본인이나 가족이 직접 신청해야 받을 수 있어요",
  auto: "대상이 되면 따로 신청하지 않아도 자동으로 지급·연계되는 경우가 많아요",
  institution: "기관·학교·시설이 대상자를 추천하거나 선정하는 사업이에요",
  unknown: "",
} as const;

/** 신청 유형 표시: 자동 제공 / 기관 추천·선정만 글자로 (직접 신청이 기본이라 따로 표시하지 않음) */
export function ApplyBadge({ p, showSelf = false, long = false }: { p: Program; showSelf?: boolean; long?: boolean }) {
  const t = p.applyType;
  if (!t || t === "unknown" || (t === "self" && !showSelf)) return null;
  return (
    <span title={APPLY_TITLE[t]} data-testid="apply-badge" data-apply={t}>
      {APPLY_TYPE_LABEL[t]}
      {/* (QA 8차) 목록에서도 직접 신청이 어려울 수 있음을 글로 (마우스를 올려야만 보이던 설명) */}
      {long && t === "institution" ? " — 직접 신청이 어려울 수 있어요" : ""}
    </span>
  );
}

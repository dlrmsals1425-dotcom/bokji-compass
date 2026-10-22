import type { Cond } from "../../../src/lib/engine/types";
import type { Badge, Category, OrgType, Scope, SourceId, Trust } from "../../../src/lib/data/types";

/** 원천 레코드를 정규화한 중간 형식 */
export interface SourceRecord {
  source: SourceId;
  sourceId: string;
  name: string;
  key: string;
  summary: string;
  target?: string;
  criteria?: string;
  benefit?: string;
  applyMethod?: string;
  /** 신청 경로 구분 (정부24 목록 '신청방법' 코드, 복지로 aplyMtdNm) */
  applyChannel?: string;
  /** 지원·제공 유형 (정부24 지원유형, 복지로 제공유형) */
  supportType?: string;
  documents?: string;
  contact?: string;
  deadline?: string;
  orgType: OrgType;
  scope: Scope;
  sidoCode?: string;
  sigunguCodes?: string[];
  regionLabel?: string;
  owner?: string;
  provider?: string;
  category: Category;
  tags: string[];
  url?: string;
  applyUrl?: string;
  provision?: string[];
  laws?: string[];
  updatedAt?: string;
  fetchedAt: string;
  trust: Trust;
  badges: Badge[];
  /** 규칙 초안 재료 */
  draft: {
    origin: "curated" | "gov24_conditions" | "bokjiro_tags" | "text_extract" | "none";
    logic: Cond | null;
    unstructured: string[];
    core: boolean;
  };
  /** 통합돌봄 원 type (전국/광역/지역특화/미분류) */
  icareType?: string;
  /** 메뉴판 '전국' 행을 묶을 전국 사업 (원천:ID) — 소유자 검토표 결정 (menuNational.ts) */
  menuTarget?: string;
  /** 노출 제외 사유 (읍면동 단독 사업, 개인 대상 아님 등) */
  excluded?: string;
  aliases?: string[];
  /** 복지 외 분야 (산업·농림) — 기본 숨김 */
  sector?: "agri" | "business" | "operator";
  /** 병합된 원천 레코드 */
  merged?: SourceRecord[];
}

/**
 * 읍면동 단독 사업 감지 (설계서 4.2 '읍면동 처리').
 * 이름이 특정 읍·면·동으로 시작하고(예: '온양4동 …'), 읍면동 협의체·추진단 사업이거나 동 번호가 붙은 경우만 제외한다.
 * '읍면동 맞춤형 통합서비스'처럼 시군구 전체 사업을 읍면동이 접수하는 경우, 특정 동에 있는 시군구 시설은 제외하지 않는다.
 */
export function isEupmyeondongLevel(name: string, sigunguName?: string): boolean {
  const m = name.match(/^([가-힣]{1,4}\d{1,2}동|[가-힣]{1,4}(?:읍|면|동))(?:\s|\(|$)/);
  if (!m) return false;
  const tok = m[1];
  if (tok === "읍면동" || tok === sigunguName) return false;
  if (sigunguName && sigunguName.replace(/(시|군|구)$/, "") === tok) return false;
  if (/(아동|노동|활동|운동|이동|행동|공동|협동|자동|연동|합동|출동|감동|가동|대면|비대면|화면|장면|정면)$/.test(tok)) return false;
  return /\d동$/.test(tok) || /(행복키움|협의체|주민자치|추진단|특화사업|자생단체)/.test(name);
}

export function financialBadge(name: string, provision: string[] = []): boolean {
  return provision.some((p) => p.includes("융자") || p.includes("대여")) || /(대출|융자|적금|보증|이자\s?지원|햇살론)/.test(name);
}

/** Public blank application documents only. No applicant data enters this catalogue. */
export type FormStatus = "available" | "online" | "review" | "missing";
export const FORM_STATUS_LABEL: Record<FormStatus, string> = {
  available: "신청서 연결 확인", online: "온라인 신청 안내", review: "연결 검토 중", missing: "서식 미확보",
};
export type FormRole = "application" | "consent" | "delegation" | "supporting" | "reference" | "administrative" | "deleted" | "unclassified";
export interface ApplicationForm {
  id: string;
  title: string;
  role: FormRole;
  lawTitle: string;
  lawId: string;
  annexId: string;
  annexNumber: string;
  regionCode: string;
  regionLabel: string;
  effectiveDate: string;
  sourceUrl: string;
  lawUrl: string;
  fetchedAt: string;
  sourceKind?: "ordin" | "law" | "rule";
  dateKind?: "effective" | "promulgated" | "issued";
  officialPdfUrl?: string;
  file?: { hwp: string; pdf?: string; bytes: number; sha256: string };
}
export interface FormLink {
  formId: string;
  use: "main" | "additional" | "conditional";
  condition?: string;
  evidenceUrl: string;
  evidenceNote: string;
  checkedAt: string;
  scopeBasis?: "provincial-law-reference" | "national-law-reference";
}
export interface ProgramFormEntry {
  id: string;
  name: string;
  areaKey: string;
  status: FormStatus;
  links: FormLink[];
  candidateFormIds: string[];
  applyUrl?: string;
  applyType?: "self" | "auto" | "institution" | "unknown";
  note?: string;
  portalSearch?: {
    outcome: "linked" | "candidate" | "not_found" | "incomplete";
    checkedAt: string;
    candidateCount: number;
    method: "full-index";
  };
}
export interface FormsRegion {
  key: string;
  label: string;
  scope: "national" | "sido" | "sigungu";
  total: number;
  counts: Record<FormStatus, number>;
}
export interface FormsCoverage {
  schema: 1;
  generatedAt: string;
  totalPrograms: number;
  counts: Record<FormStatus, number>;
  totalForms: number;
  publishedForms: number;
  excludedForms: number;
  sourceNote: string;
  regions: FormsRegion[];
  portalScan?: {
    status: "complete" | "incomplete";
    indexedForms: number;
    checkedPrograms: number;
    checkedAt: string;
    sources: { kind: string; total: number; collected: number }[];
  };
}
export interface FormsCatalog {
  schema: 1;
  generatedAt: string;
  forms: Record<string, ApplicationForm>;
}
export interface FormsRegionBundle {
  schema: 1;
  generatedAt: string;
  region: FormsRegion;
  programs: ProgramFormEntry[];
  catalogSharded?: boolean;
}

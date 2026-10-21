import type { Program } from "./types";
import type { ApplicationForm, FormLink, FormStatus } from "./forms";

export function externalFormUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function formAssetUrl(value: unknown): string | null {
  return typeof value === "string" && /^\/forms\/files\/(ordin|law|rule)-\d+-[a-f0-9]{12}\.(hwp|hwpx|pdf)$/.test(value) ? value : null;
}

/** Official external annex links must never carry an API credential. */
export function officialFormUrl(value: unknown): string | null {
  const safe = externalFormUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.protocol !== "https:" || !["www.law.go.kr", "law.go.kr"].includes(url.hostname)) return null;
  if ([...url.searchParams.keys()].some(key => /^oc$|key|token|secret|password|auth|login|email|phone|resident/i.test(key))) return null;
  return safe;
}

function referencedFormLaw(program: Program, form: ApplicationForm): boolean {
  const normalize = (text: string) => text.normalize("NFKC").replace(/[「」『』\s·ㆍ]/g, "").replace(/\(제[^)]*\)/g, "").replace(/제\d+조.*$/, "").replace(/시행규칙$|시행령$/, "");
  return (program.laws || []).some(law => law.split("||").some(part => normalize(part) === normalize(form.lawTitle)));
}

export function sameFormJurisdiction(program: Pick<Program, "scope" | "region">, form: ApplicationForm): boolean {
  if (form.regionCode === "national") return program.scope === "national";
  if (program.scope === "sigungu") return form.regionCode === program.region?.sigungu;
  if (program.scope === "sido") return form.regionCode === program.region?.sido;
  return false;
}

/** Fail a publication build instead of silently accepting an invalid reviewed link. */
export function validateFormLink(program: Program, form: ApplicationForm | undefined, link: FormLink): void {
  if (!form || form.id !== link.formId) throw new Error("Unknown form in reviewed association");
  if (!sameFormJurisdiction(program, form)) {
    const sameProvince = link.scopeBasis === "provincial-law-reference" && program.scope === "sigungu" && program.region?.sido === form.regionCode;
    const nationalReference = link.scopeBasis === "national-law-reference" && form.regionCode === "national";
    if ((!sameProvince && !nationalReference) || !referencedFormLaw(program, form)) throw new Error("Form jurisdiction does not match program");
  }
  if (!["application", "consent", "delegation", "supporting"].includes(form.role)) throw new Error("Non-applicant form cannot be published as an application");
  if (!externalFormUrl(link.evidenceUrl) || link.evidenceNote.trim().length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(link.checkedAt)) throw new Error("Reviewed association needs dated source evidence");
  if (!["main", "additional", "conditional"].includes(link.use)) throw new Error("Unknown document use");
  if ((form.role === "delegation" || link.use === "conditional") && (!link.condition?.trim() || link.use !== "conditional")) throw new Error("Conditional form needs an explicit condition");
}

export function applicationRoute(program: Pick<Program, "applyUrl" | "applyType">): string | undefined {
  if (program.applyType === "auto" || program.applyType === "institution") return undefined;
  return externalFormUrl(program.applyUrl) || undefined;
}

export function formStatus(links: FormLink[], candidates: string[], onlineUrl?: string): FormStatus {
  if (links.length) return "available";
  if (onlineUrl) return "online";
  return candidates.length ? "review" : "missing";
}

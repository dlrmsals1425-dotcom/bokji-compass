import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, it, expect } from "vitest";
import type { FormsCatalog, FormsCoverage, FormsRegionBundle } from "@/lib/data/forms";
import { validateFormLink, officialFormUrl } from "@/lib/data/formPublication";
import { detailBucket } from "@/lib/data/bucket";
import type { Program } from "@/lib/data/types";
import { validateDownloadManifest, validateOriginalFile, type DownloadManifest } from "../../scripts/build-forms";
const read = <T>(file: string): T => JSON.parse(readFileSync(path.join(process.cwd(), file), "utf8"));
const coverage = read<FormsCoverage>("public/forms/v1/coverage.json");
const catalog = read<FormsCatalog>("public/forms/v1/catalog.json");
const regions = coverage.regions.map(region => read<FormsRegionBundle>(`public/forms/v1/programs/${region.key}.json`));
const programs = regions.flatMap(region => region.programs);
const downloads: DownloadManifest | null = existsSync("pipeline/forms/download-manifest.json") ? validateDownloadManifest(read("pipeline/forms/download-manifest.json")) : null;
const pdfChecks = read<Record<string, { verified: boolean; pdfSha256: string }>>("pipeline/forms/pdf-checks.json");

describe("generated national forms catalogue", () => {
  it("keeps each newly attached fixed-scope original bound to the current listed edition",()=>{
    const scope=read<{forms:{formId:string;lawId:string}[]}>("pipeline/forms/reviews/unmatched-originals-scope.json");
    const currency=read<{pendingLaws:number;laws:Record<string,{state:string;currentLawId?:string;forms?:Record<string,{binding:string;officialFlSeq:string;officialAnnexDeleted:boolean}>}>}>("pipeline/forms/source-law-currency.json");
    expect(currency.pendingLaws).toBe(0);
    for(const original of scope.forms.filter(row=>catalog.forms[row.formId]?.file)) {
      const law=currency.laws[original.lawId],binding=law?.forms?.[original.formId];
      expect(law?.state,original.formId).toBe("source_current");
      expect(law.currentLawId).toBe(original.lawId);
      expect(binding?.binding).toBe("bound");
      expect(binding?.officialAnnexDeleted).toBe(false);
      expect(binding?.officialFlSeq).toBe(new URL(catalog.forms[original.formId].sourceUrl).searchParams.get("flSeq"));
    }
  });
  it("accounts for every unique existing welfare program exactly once", () => {
    const originals = ["national.json", ...["sido", "sigungu"].flatMap(scope => readdirSync(`public/bundles/v1/${scope}`).filter(name => name.endsWith(".json")).map(name => `${scope}/${name}`))];
    const sourceIds = new Set(originals.flatMap(file => read<{ programs: Program[] }>(`public/bundles/v1/${file}`).programs.map(program => program.id)));
    expect(coverage.totalPrograms).toBe(sourceIds.size);
    expect(programs).toHaveLength(sourceIds.size);
    expect(programs.every(program => sourceIds.has(program.id))).toBe(true);
    expect(new Set(programs.map(program => program.id)).size).toBe(programs.length);
    expect(Object.values(coverage.counts).reduce((a, b) => a + b, 0)).toBe(programs.length);
    for (const region of regions) {
      expect(region.programs).toHaveLength(region.region.total);
      for (const [status, count] of Object.entries(region.region.counts)) expect(region.programs.filter(program => program.status === status)).toHaveLength(count);
    }
  });
  // These checks walk every published association and original, not a small fixture.
  it("publishes only dated, evidence-backed, same-jurisdiction applicant associations", () => {
    for (const row of programs.filter(program => program.links.length)) {
      expect(row.status).toBe("available");
      const original = read<Record<string, Program>>(`public/bundles/v1/details/${detailBucket(row.id)}.json`)[row.id];
      for (const link of row.links) expect(() => validateFormLink(original, catalog.forms[link.formId], link)).not.toThrow();
    }
    expect(programs.filter(program => program.status === "available")).toHaveLength(coverage.counts.available);
  }, 30_000);
  it("approved downloads retain exact original bytes and available checked PDFs", () => {
    const published = Object.values(catalog.forms).filter(form => form.file);
    const linkedIds = new Set(programs.flatMap(program => program.links.map(link => link.formId)));
    expect(linkedIds.size).toBe(coverage.publishedForms);
    for (const id of linkedIds) {
      const form = catalog.forms[id];
      expect(form).toBeTruthy();
      if (downloads) expect(form.file, `approved ${id} needs a local original`).toBeTruthy();
      if (!form.file) {
        expect(officialFormUrl(form.sourceUrl)).toBeTruthy();
        expect(new URL(form.sourceUrl).pathname).toMatch(/\/flDownload\.do$/);
        if (form.officialPdfUrl) expect(officialFormUrl(form.officialPdfUrl)).toBeTruthy();
      }
    }
    const expectedAssets = new Set<string>();
    for (const form of published) {
      expect(typeof form.regionLabel,form.id).toBe("string");
      expect(form.regionLabel?.trim().length,form.id).toBeGreaterThan(0);
      expect(linkedIds.has(form.id), "unapproved candidates cannot publish local files").toBe(true);
      const bytes = readFileSync(path.join(process.cwd(), "public", form.file!.hwp));
      const entry = downloads?.forms[form.id], format = form.file!.format || "hwp";
      const source = readFileSync(path.join(process.cwd(), "pipeline/forms", entry?.path || `originals/${form.id}.hwp`));
      expect(bytes.equals(source)).toBe(true);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(form.file!.sha256);
      expect(form.file!.bytes).toBe(bytes.length);
      expect(form.file!.hwp).toBe(`/forms/files/${form.id}-${form.file!.sha256.slice(0, 12)}.${format}`);
      if (entry) expect(format).toBe(entry.format);
      validateOriginalFile(bytes, format);
      expectedAssets.add(path.basename(form.file!.hwp));
      if (entry?.pdf || pdfChecks[form.id]?.verified) expect(form.file!.pdf).toBeTruthy();
      if (form.file!.pdf) {
        const pdf = readFileSync(path.join(process.cwd(), "public", form.file!.pdf));
        expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
        expect(createHash("sha256").update(pdf).digest("hex")).toBe(format==="pdf" ? form.file!.sha256 : entry?.pdf?.sha256 || pdfChecks[form.id]?.pdfSha256);
        expect(form.file!.pdf).toBe(`/forms/files/${form.id}-${form.file!.sha256.slice(0, 12)}.pdf`);
        expectedAssets.add(path.basename(form.file!.pdf));
      }
    }
    expect(new Set(readdirSync("public/forms/files"))).toEqual(expectedAssets);
  }, 30_000);
  it("deleted/administrative records do not publish files and unrelated Goyang forms do not leak to other areas", () => {
    for (const form of Object.values(catalog.forms)) {
      if (["administrative", "deleted", "reference"].includes(form.role)) expect(form.file).toBeUndefined();
    }
    for(const program of programs.filter(program=>program.areaKey!=="g41280")) for(const link of program.links.filter(link=>catalog.forms[link.formId].regionCode==="41280")) {
      expect(link.scopeBasis).toBe("municipal-application-reference");
      expect(link.municipalApplicationReference?.sigungu).toBe("41280");
    }
    const sickLeave = programs.find(program => program.id === "g41280.bokjiro-WLF00004751")!;
    expect(sickLeave.links.filter(link=>link.use==="main").map(link=>link.formId)).toEqual(["ordin-19996047"]);
    const proxy=sickLeave.links.find(link=>link.formId==="ordin-19996049");
    expect(proxy?.use).toBe("conditional");
    expect(proxy?.condition).toContain("위임");
    expect(catalog.forms["ordin-19996049"].role).toBe("delegation");
    expect(sickLeave.status).toBe("available");
    expect(catalog.forms["ordin-19996047"].lawTitle).toContain("유급병가");
  });
  it("holds a current annex whose printed allowance rates conflict with current official rates",()=>{
    const fid="ordin-22706053";
    for(const pid of ["s47000.gov24-647000000122","s47000.bokjiro-WLF00004401"]) expect(programs.find(program=>program.id===pid)?.links.some(link=>link.formId===fid)).toBe(false);
    expect(catalog.forms[fid].file).toBeUndefined();
  });
  it("excludes source-reviewed purpose mismatches even when the law and application heading match",()=>{
    for (const [programId,wrongForm] of [
      ["g52130.gov24-O00029000001","ordin-20138809"], // Rainwater facilities are not low-income household relief.
      ["g11440.gov24-313000000117","ordin-22518041"], // Death compensation is not a monthly veterans allowance.
      ["g51820.bokjiro-WLF00000445","ordin-20082747"], // Multi-child relief is not the recipient program.
      ["g12820.gov24-496000000123","ordin-20286251"], // Uniforms are not schoolbags/school trips.
    ]) {
      const row=programs.find(program=>program.id===programId);
      expect(row,programId).toBeTruthy();
      expect(row!.links.some(link=>link.formId===wrongForm),programId).toBe(false);
      expect(row!.candidateFormIds.includes(wrongForm),programId).toBe(false);
    }
  });
  it("a completed portal scan covers every program and each shard preserves its form records", () => {
    expect(coverage.portalScan?.status).toBe("complete");
    expect(coverage.portalScan?.checkedPrograms).toBe(programs.length);
    expect(programs.every(program => program.portalSearch && program.portalSearch.outcome !== "incomplete")).toBe(true);
    const sharded = new Map<string, string>();
    for (const file of readdirSync("public/forms/v1/catalog").filter(name => name.endsWith(".json"))) {
      for (const form of Object.values(read<FormsCatalog>(`public/forms/v1/catalog/${file}`).forms)) {
        expect(detailBucket(form.id) + ".json").toBe(file);
        expect(sharded.has(form.id)).toBe(false);
        sharded.set(form.id, JSON.stringify(form));
      }
    }
    expect(sharded.size).toBe(Object.keys(catalog.forms).length);
    for (const form of Object.values(catalog.forms)) expect(sharded.get(form.id)).toBe(JSON.stringify(form));
    expect(programs.every(program => program.candidateFormIds.every(id => !!catalog.forms[id]))).toBe(true);
  });
});

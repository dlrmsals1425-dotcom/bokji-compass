import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgencyAuthorityBasis, AgencyVisualReview, ApplicationForm } from "@/lib/data/forms";
import registry from "@/lib/data/verifiedAgencyForms.json";
import { formAssetUrl, registeredAgencyForm, validateAgencyForm } from "@/lib/data/formPublication";
import { jpegFrame, loadDownloadedOriginals, validateDownloadManifest, validateOriginalFile, type DownloadManifest } from "../../scripts/build-forms";

const SHA = "8ae64f84823eadcfd2cbe87a917625d34e97fcbc64170a4e2cc987ee3417f395";
const ZERO = "0".repeat(64);
const JPG = path.resolve("tests/fixtures/forms/bucheon-school-uniform-application.jpg");
const HWP = path.resolve("tests/fixtures/forms/agency-44250-36032.hwp");
const HWP_ID = "agency-44250-36032";
const packet = JSON.parse(readFileSync(path.resolve("tests/fixtures/forms/bucheon-school-uniform-image-review.json"), "utf8")) as {
  entry: Record<string, unknown>;
};
const entry = packet.entry;
const id = String(entry.id);
const forms = registry.forms as unknown as Record<string, Record<string, unknown>>;
const visual = () => entry.visualReview as AgencyVisualReview;

function sourceEntry(): Record<string, unknown> {
  return structuredClone(entry);
}

async function withEntry<T>(value: Record<string, unknown>, run: () => Promise<T> | T): Promise<T> {
  const previous = forms[id];
  forms[id] = value;
  try { return await run(); }
  finally {
    if (previous === undefined) delete forms[id];
    else forms[id] = previous;
  }
}

function imageForm(source: Record<string, unknown> = entry): ApplicationForm {
  const sha256 = String(source.sha256);
  const checkedAt = String(source.checkedAt);
  const publishedAt = typeof source.publishedAt === "string" ? source.publishedAt : undefined;
  const file = `/forms/files/${source.id}-${sha256.slice(0, 12)}.jpg`;
  const basis = source.authorityBasis as AgencyAuthorityBasis;
  return {
    id: String(source.id),
    title: String(source.title),
    role: source.role as ApplicationForm["role"],
    sourceKind: "agency",
    regionCode: String(source.regionCode),
    regionLabel: String(source.regionLabel),
    lawId: String(source.lawId),
    lawTitle: String(source.lawTitle),
    lawUrl: String(source.lawEvidenceUrl),
    annexId: "",
    annexNumber: "",
    sourceUrl: String(source.sourceUrl),
    fetchedAt: checkedAt,
    dateKind: publishedAt ? "published" : "checked",
    effectiveDate: publishedAt ?? checkedAt,
    agency: {
      agencyName: String(source.agencyName),
      sourcePageUrl: String(source.sourcePageUrl),
      finalUrl: String(source.finalUrl),
      attachmentId: String(source.attachmentId),
      sha256,
      bytes: Number(source.bytes),
      format: "jpg",
      checkedAt,
      authorityEvidenceUrl: String(source.authorityEvidenceUrl),
      authorityBasis: basis,
      visualReview: source.visualReview as AgencyVisualReview,
    },
    file: { hwp: file, format: "jpg", bytes: Number(source.bytes), sha256 },
  };
}

function manifest(source: Record<string, unknown> = entry, sha256 = String(source.sha256), bytes = Number(source.bytes)): DownloadManifest {
  const formId = String(source.id);
  return { schema: 1, forms: { [formId]: {
    format: "jpg", path: `originals/${formId}.jpg`, bytes, sha256,
    sourceUrl: String(source.sourceUrl), finalUrl: String(source.finalUrl), downloadedAt: "2026-10-19T00:00:00.000Z",
  } } };
}

describe("curated whole-image agency JPEG", () => {
  it("accepts the public Bucheon original and serves only its registered file identity", async () => {
    const bytes = await readFile(JPG);
    expect(bytes.length).toBe(101647);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(SHA);
    expect(String(entry.sha256)).toBe(SHA);
    expect(Number(entry.bytes)).toBe(101647);
    const asset = `/forms/files/${id}-${SHA.slice(0, 12)}.jpg`;
    await withEntry(sourceEntry(), async () => {
      const form = imageForm();
      expect(form.lawId).toBe("");
      expect(form.lawTitle).toBe("");
      expect(form.lawUrl).toBe("");
      expect(registeredAgencyForm(id)?.visualReview).toEqual(visual());
      expect(() => validateAgencyForm(form)).not.toThrow();
      expect(formAssetUrl(asset)).toBe(asset);
      expect(formAssetUrl(asset.replace(/\.jpg$/, ".jpeg"))).toBeNull();
      expect(formAssetUrl(asset.replace(SHA.slice(0, 12), "000000000000"))).toBeNull();
      expect(() => validateDownloadManifest(manifest())).not.toThrow();
      const temporary = await mkdtemp(path.join(tmpdir(), "agency-image-"));
      try {
        await mkdir(path.join(temporary, "originals"));
        await writeFile(path.join(temporary, "originals", `${id}.jpg`), bytes);
        const loaded = await loadDownloadedOriginals(temporary, manifest(), { [id]: form });
        expect(loaded.get(id)?.format).toBe("jpg");
        expect(loaded.get(id)?.bytes.equals(bytes)).toBe(true);
      } finally {
        if (path.dirname(path.resolve(temporary)) !== path.resolve(tmpdir()) || !path.basename(temporary).startsWith("agency-image-")) throw new Error("Unexpected cleanup target");
        await rm(temporary, { recursive: true, force: true });
      }
    });
  });

  it("rejects a visual review that is false, unbound, oversized, or claimed by a non-image", async () => {
    const previous = forms[HWP_ID];
    expect(registeredAgencyForm(HWP_ID)?.format).toBe("hwp");
    try {
      forms[HWP_ID] = { ...previous, visualReview: structuredClone(visual()) };
      expect(registeredAgencyForm(HWP_ID)).toBeNull();
      forms[HWP_ID] = { ...previous, visualReview: null };
      expect(registeredAgencyForm(HWP_ID)).toBeNull();
    } finally { forms[HWP_ID] = previous; }
    expect(registeredAgencyForm(HWP_ID)?.format).toBe("hwp");

    for (const changes of [
      { blankApplicantForm: false }, { noFilledPersonalData: false }, { checkedAt: "2026-10-18" },
      { sha256: "ab".repeat(32) }, { frames: 2 },
      { width: 10000, height: 5001 }, { kind: "preview" }, { evidenceNote: "원본을 봤다" },
    ]) {
      const next = sourceEntry();
      next.visualReview = { ...(next.visualReview as object), ...changes };
      await withEntry(next, () => expect(registeredAgencyForm(id)).toBeNull());
    }
    const extra = sourceEntry();
    (extra.visualReview as Record<string, unknown>).viewer = "person";
    await withEntry(extra, () => expect(registeredAgencyForm(id)).toBeNull());
    for (const [key, value] of [["textScope", "all_body_sections_or_pages"], ["sectionsRead", ["frame-2"]], ["sectionsRead", ["frame-1", "frame-2"]]] as const) {
      await withEntry({ ...sourceEntry(), [key]: value }, () => expect(registeredAgencyForm(id)).toBeNull());
    }
    const missing = sourceEntry();
    delete missing.visualReview;
    await withEntry(missing, () => expect(registeredAgencyForm(id)).toBeNull());
    await withEntry({ ...sourceEntry(), visualReview: null }, () => expect(registeredAgencyForm(id)).toBeNull());

    await withEntry(sourceEntry(), () => {
      const form = imageForm();
      const agency = { ...form.agency! };
      delete agency.visualReview;
      expect(() => validateAgencyForm({ ...form, agency })).toThrow(/identity mismatch/);
      expect(() => validateAgencyForm({ ...form, agency: { ...form.agency!, visualReview: { ...visual(), blankApplicantForm: false as true } } })).toThrow(/identity mismatch/);
      expect(() => validateAgencyForm({ ...form, agency: { ...form.agency!, visualReview: { ...visual(), viewer: "person" } as AgencyVisualReview } })).toThrow(/identity mismatch/);
      expect(() => validateAgencyForm({ ...form, file: { ...form.file!, sha256: ZERO } })).toThrow(/identity mismatch/);
    });
  });

  it("keeps a 64-zero hash loadable and catches it on the real file identity", async () => {
    const zeroEntry = sourceEntry();
    zeroEntry.sha256 = ZERO;
    zeroEntry.visualReview = { ...(zeroEntry.visualReview as object), sha256: ZERO };
    const realAsset = `/forms/files/${id}-${SHA.slice(0, 12)}.jpg`;
    const zeroAsset = `/forms/files/${id}-${ZERO.slice(0, 12)}.jpg`;
    const bytes = await readFile(JPG);
    const temporary = await mkdtemp(path.join(tmpdir(), "agency-image-"));
    try {
      await mkdir(path.join(temporary, "originals"));
      await writeFile(path.join(temporary, "originals", `${id}.jpg`), bytes);
      await withEntry(zeroEntry, async () => {
        expect(registeredAgencyForm(id)?.sha256).toBe(ZERO);
        expect(formAssetUrl(zeroAsset)).toBe(zeroAsset);
        expect(formAssetUrl(realAsset)).toBeNull();
        expect(() => validateAgencyForm(imageForm())).toThrow(/identity mismatch/);
        const claimed = imageForm(zeroEntry);
        expect(() => validateAgencyForm(claimed)).not.toThrow();
        await expect(loadDownloadedOriginals(temporary, manifest(zeroEntry), { [id]: claimed })).rejects.toThrow(/hash\/length/);
      });
    } finally {
      if (path.dirname(path.resolve(temporary)) !== path.resolve(tmpdir()) || !path.basename(temporary).startsWith("agency-image-")) throw new Error("Unexpected cleanup target");
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it("rejects a malformed or foreign-portal JPEG manifest and changed or differently sized bytes", async () => {
    const bytes = await readFile(JPG);
    expect(() => validateDownloadManifest({ schema: 1, forms: { "ordin-17575933": {
      format: "jpg", path: "originals/ordin-17575933.jpg", bytes: bytes.length, sha256: SHA,
      sourceUrl: "https://www.law.go.kr/LSW/flDownload.do?flSeq=17575933", downloadedAt: "2026-10-19T00:00:00.000Z",
    } } })).toThrow(/id\/format/);
    await withEntry(sourceEntry(), async () => {
      const foreign = manifest();
      foreign.forms[id].finalUrl = "https://evil.example/uniform.jpg";
      expect(() => validateDownloadManifest(foreign)).toThrow(/identity mismatch/);
      const preview = manifest();
      preview.forms[id].pdf = { path: "previews/x.pdf", bytes: 10, sha256: SHA, sourceUrl: "https://www.law.go.kr/LSW/flDownload.do?flSeq=1" };
      expect(() => validateDownloadManifest(preview)).toThrow(/identity mismatch/);
      const broken = manifest();
      broken.forms[id].path = `originals/${id}.jpeg`;
      broken.forms[id].sha256 = "zz".repeat(32);
      expect(() => validateDownloadManifest(broken)).toThrow();

      const temporary = await mkdtemp(path.join(tmpdir(), "agency-image-"));
      try {
        await mkdir(path.join(temporary, "originals"));
        const target = path.join(temporary, "originals", `${id}.jpg`);
        await writeFile(target, Buffer.concat([bytes, Buffer.from("changed")]));
        await expect(loadDownloadedOriginals(temporary, manifest(), { [id]: imageForm() })).rejects.toThrow(/hash\/length/);
        await writeFile(target, bytes);
        for (const [key, value] of [["width", 588], ["height", 834]] as const) {
          const changed = sourceEntry();
          (changed.visualReview as Record<string, unknown>)[key] = value;
          await withEntry(changed, async () => {
            await expect(loadDownloadedOriginals(temporary, manifest(changed), { [id]: imageForm(changed) })).rejects.toThrow(/differs from the reviewed whole image/);
          });
        }
      } finally {
        if (path.dirname(path.resolve(temporary)) !== path.resolve(tmpdir()) || !path.basename(temporary).startsWith("agency-image-")) throw new Error("Unexpected cleanup target");
        await rm(temporary, { recursive: true, force: true });
      }
    });
  });

  it("reads 589x835 from the actual JPEG and rejects PNG, HWP, and truncation", async () => {
    const bytes = await readFile(JPG);
    expect(jpegFrame(bytes)).toEqual({ width: 589, height: 835 });
    expect(() => validateOriginalFile(bytes, "jpg")).not.toThrow();
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    const hwp = await readFile(HWP);
    for (const sample of [png, hwp, bytes.subarray(0, 32), bytes.subarray(0, bytes.length - 1)]) {
      expect(() => jpegFrame(sample)).toThrow(/Invalid JPEG/);
      expect(() => validateOriginalFile(sample, "jpg")).toThrow(/Invalid JPEG/);
    }
  });
});

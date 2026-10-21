import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgencyAuthorityBasis, AgencyOriginalReview, AgencyPdfReview, ApplicationForm } from "@/lib/data/forms";
import registry from "@/lib/data/verifiedAgencyForms.json";
import { formAssetUrl, registeredAgencyForm, validateAgencyForm } from "@/lib/data/formPublication";
import { loadDownloadedOriginals, pdfPageCount, validateDownloadManifest, validateOriginalFile, type DownloadManifest } from "../../scripts/build-forms";

/**
 * 평택시 송탄 행려자 귀향여비 신청서(신청·동의·영수증 3쪽, 글자층 없는 스캔)가 이 관문이
 * 필요한 실제 자료다. 여기서는 구조 검증용 빈 PDF 바이트만 생성하며, 실제 공개 원본은
 * 별도 SHA와 시각 검토로 등록하고 브라우저에서 다운로드를 검사한다. 테스트 바이트로 원본을 대체하지 않는다.
 */
const PAGE_URL = "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00000783&wlfareInfoReldBztpCd=02";
const ATTACHMENT = "20230525UUWBM1328390036214748";
const FILE_URL = `https://www.bokjiro.go.kr/ssis-tbu/twata/CmmFileUtil/getDownload.do?atcflId=${ATTACHMENT}&atcflSn=1&wlfareInfoId=WLF00000783`;
const NOTE = "구조 검증 테스트용 빈 PDF의 검토 메타데이터이며 실제 공개 승인 근거가 아니다. 실제 송탄 원본의 1쪽 동의서·2쪽 신청서·3쪽 영수증은 별도의 원본 SHA와 전체 시각 검토로 확인한다.";
const ID = "agency-41220-songtan-return-fare-pdf";
const IMAGE_ID = "agency-41190-school-uniform-jpg";
const HWP_ID = "agency-44250-36032";
const PAGES = ["page-1", "page-2", "page-3"];
const forms = registry.forms as unknown as Record<string, Record<string, unknown>>;

/** 구조 검증용으로만 만드는 최소 빈 PDF 바이트 — 공개 원본이 될 수 없다. */
function generatedPdf(pages: number, text?: string): Buffer {
  const stream = text === undefined ? undefined : `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const extra = stream ? ` /Contents ${pages + 3} 0 R /Resources << /Font << /F1 ${pages + 4} 0 R >> >>` : "";
  const kids = Array.from({ length: pages }, (value, index) => `${index + 3} 0 R`).join(" ");
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    ...Array.from({ length: pages }, () => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]${extra} >>`)];
  if (stream) objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((content, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${content}\nendobj\n`;
  });
  const start = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

const BLANK = generatedPdf(3);
const SHA = createHash("sha256").update(BLANK).digest("hex");
const PAGE_SHA = createHash("sha256").update("generated-structural-sample-page").digest("hex");

function review(): AgencyPdfReview {
  return { kind: "whole-original-pdf", checkedAt: "2026-10-19", sha256: SHA, pageCount: 3,
    pagesRead: [...PAGES], blankApplicantForm: true, noFilledPersonalData: true, evidenceNote: NOTE };
}

function sourceEntry(): Record<string, unknown> {
  return {
    id: ID, sourceKind: "agency", title: "행려자 귀향여비 신청서 및 동의서", role: "application", use: "main",
    regionCode: "41220", regionLabel: "경기도 평택시", agencyName: "경기도 평택시 송탄출장소(복지로 공식 배포)",
    authorityKind: "government", authorityEvidenceKind: "government", authorityEvidenceUrl: PAGE_URL,
    authorityEvidenceNote: NOTE, sourcePageUrl: PAGE_URL, sourceUrl: FILE_URL, finalUrl: FILE_URL,
    attachmentId: ATTACHMENT, attachmentIdentifier: { queryParam: "atcflId", value: ATTACHMENT },
    checkedAt: "2026-10-19", sha256: SHA, bytes: BLANK.length,
    lawId: "", lawTitle: "", lawEvidenceUrl: "", lawEffectiveDate: "", lawCurrentCheckedAt: "",
    sectionsRead: [...PAGES], textScope: "all_body_sections_or_pages",
    selectedParts: [{ number: "1", title: "행려자 귀향여비 신청서", use: "main", author: "신청인 본인" },
      { number: "2", title: "개인정보 수집·이용 동의서", use: "additional", author: "신청인 본인" },
      { number: "3", title: "귀향여비 수령 영수증", use: "additional", author: "신청인 본인" }],
    applicant: "신청인 본인",
    authorityBasis: { kind: "official-program", title: "행려자 귀향여비 지원", evidenceUrl: PAGE_URL,
      checkedAt: "2026-10-19", evidenceNote: NOTE, pageSHA256: PAGE_SHA },
    visualReview: review(),
    format: "pdf", programs: [{ id: "g41220.bokjiro-WLF00000783", url: PAGE_URL }],
  };
}

async function withEntry<T>(value: Record<string, unknown>, run: () => Promise<T> | T, id = ID): Promise<T> {
  const previous = forms[id];
  forms[id] = value;
  try { return await run(); }
  finally {
    if (previous === undefined) delete forms[id];
    else forms[id] = previous;
  }
}

function pdfForm(source: Record<string, unknown> = sourceEntry()): ApplicationForm {
  const sha256 = String(source.sha256), checkedAt = String(source.checkedAt);
  const file = `/forms/files/${source.id}-${sha256.slice(0, 12)}.pdf`;
  return {
    id: String(source.id), title: String(source.title), role: source.role as ApplicationForm["role"], sourceKind: "agency",
    regionCode: String(source.regionCode), regionLabel: String(source.regionLabel),
    lawId: "", lawTitle: "", lawUrl: "", annexId: "", annexNumber: "",
    sourceUrl: String(source.sourceUrl), fetchedAt: checkedAt, dateKind: "checked", effectiveDate: checkedAt,
    agency: {
      agencyName: String(source.agencyName), sourcePageUrl: String(source.sourcePageUrl), finalUrl: String(source.finalUrl),
      attachmentId: String(source.attachmentId), sha256, bytes: Number(source.bytes), format: "pdf", checkedAt,
      authorityEvidenceUrl: String(source.authorityEvidenceUrl),
      authorityBasis: source.authorityBasis as AgencyAuthorityBasis,
      visualReview: source.visualReview as AgencyOriginalReview,
    },
    file: { hwp: file, pdf: file, format: "pdf", bytes: Number(source.bytes), sha256 },
  };
}

function manifest(source: Record<string, unknown> = sourceEntry()): DownloadManifest {
  const formId = String(source.id);
  return { schema: 1, forms: { [formId]: {
    format: "pdf", path: `originals/${formId}.pdf`, bytes: Number(source.bytes), sha256: String(source.sha256),
    sourceUrl: String(source.sourceUrl), finalUrl: String(source.finalUrl), downloadedAt: "2026-10-19T00:00:00.000Z",
  } } };
}

async function withOriginal<T>(bytes: Buffer, run: (directory: string) => Promise<T>): Promise<T> {
  const temporary = await mkdtemp(path.join(tmpdir(), "agency-scanned-pdf-"));
  try {
    await mkdir(path.join(temporary, "originals"));
    await writeFile(path.join(temporary, "originals", `${ID}.pdf`), bytes);
    return await run(temporary);
  } finally {
    if (path.dirname(path.resolve(temporary)) !== path.resolve(tmpdir()) || !path.basename(temporary).startsWith("agency-scanned-pdf-")) throw new Error("Unexpected cleanup target");
    await rm(temporary, { recursive: true, force: true });
  }
}

describe("curated whole-original scanned agency PDF", () => {
  it("accepts a fully page-read blank scan and serves only its registered file identity", async () => {
    const asset = `/forms/files/${ID}-${SHA.slice(0, 12)}.pdf`;
    await withEntry(sourceEntry(), async () => {
      const entry = registeredAgencyForm(ID);
      expect(entry?.visualReview).toEqual(review());
      expect(entry?.textScope).toBe("all_body_sections_or_pages");
      expect(entry?.sectionsRead).toEqual(PAGES);
      expect(() => validateAgencyForm(pdfForm())).not.toThrow();
      expect(formAssetUrl(asset)).toBe(asset);
      expect(formAssetUrl(asset.replace(/\.pdf$/, ".jpg"))).toBeNull();
      expect(() => validateDownloadManifest(manifest())).not.toThrow();
      await withOriginal(BLANK, async directory => {
        const loaded = await loadDownloadedOriginals(directory, manifest(), { [ID]: pdfForm() });
        expect(loaded.get(ID)?.format).toBe("pdf");
        expect(loaded.get(ID)?.bytes.equals(BLANK)).toBe(true);
      });
    });
  });

  it("rejects a page review that is partial, false, unbound, or wrongly shaped", async () => {
    for (const changes of [
      { pagesRead: ["page-1", "page-2"] }, { pagesRead: ["page-1", "page-2", "page-4"] },
      { pagesRead: ["page-2", "page-1", "page-3"] }, { pagesRead: ["page-1", "page-1", "page-1"] },
      { pagesRead: [...PAGES, "page-4"] }, { pageCount: 0 }, { pageCount: 3.5 }, { pageCount: "3" },
      { pageCount: 2, pagesRead: ["page-1", "page-2"] }, { blankApplicantForm: false }, { noFilledPersonalData: false },
      { checkedAt: "2026-10-18" }, { sha256: "ab".repeat(64 / 2) }, { kind: "preview" }, { evidenceNote: "모든 쪽을 봤다" },
      { frames: 1 }, { width: 589 },
    ]) {
      const next = sourceEntry();
      next.visualReview = { ...review(), ...changes };
      await withEntry(next, () => expect(registeredAgencyForm(ID)).toBeNull());
    }
    for (const key of ["pagesRead", "pageCount", "sha256", "evidenceNote"] as const) {
      const next = sourceEntry(), partial = { ...review() } as Record<string, unknown>;
      delete partial[key];
      next.visualReview = partial;
      await withEntry(next, () => expect(registeredAgencyForm(ID)).toBeNull());
    }
    for (const value of [null, [], "read every page"]) {
      await withEntry({ ...sourceEntry(), visualReview: value }, () => expect(registeredAgencyForm(ID)).toBeNull());
    }
    for (const [key, value] of [["textScope", "all_original_image_frames"], ["sectionsRead", ["page-1", "page-2"]],
      ["sectionsRead", [...PAGES, "page-4"]], ["sectionsRead", ["frame-1"]]] as const) {
      await withEntry({ ...sourceEntry(), [key]: value }, () => expect(registeredAgencyForm(ID)).toBeNull());
    }
    await withEntry(sourceEntry(), () => {
      const form = pdfForm(), agency = { ...form.agency! };
      delete agency.visualReview;
      expect(() => validateAgencyForm({ ...form, agency })).toThrow(/identity mismatch/);
      expect(() => validateAgencyForm({ ...form, agency: { ...form.agency!, visualReview: { ...review(), pageCount: 2 } } })).toThrow(/identity mismatch/);
      expect(() => validateAgencyForm({ ...form, agency: { ...form.agency!, visualReview: { ...review(), pagesRead: ["page-1", "page-2"] } } })).toThrow(/identity mismatch/);
      expect(() => validateAgencyForm({ ...form, agency: { ...form.agency!, visualReview: { ...review(), reader: "person" } as AgencyPdfReview } })).toThrow(/identity mismatch/);
    });
  });

  it("keeps each scanned format to its own kind of whole-original review", async () => {
    expect(registeredAgencyForm(IMAGE_ID)?.visualReview?.kind).toBe("whole-original-image");
    for (const id of [IMAGE_ID, HWP_ID]) {
      const previous = forms[id];
      await withEntry({ ...previous, visualReview: review() }, () => expect(registeredAgencyForm(id)).toBeNull(), id);
      expect(forms[id]).toBe(previous);
    }
    expect(registeredAgencyForm(IMAGE_ID)?.visualReview?.kind).toBe("whole-original-image");
    expect(registeredAgencyForm(HWP_ID)?.visualReview).toBeUndefined();
    const framed = sourceEntry();
    framed.visualReview = { ...(forms[IMAGE_ID].visualReview as object), sha256: SHA, checkedAt: "2026-10-19" };
    await withEntry(framed, () => expect(registeredAgencyForm(ID)).toBeNull());
  });

  it("counts the actual pages and refuses a document that is not the reviewed one", async () => {
    expect(pdfPageCount(BLANK)).toBe(3);
    expect(pdfPageCount(generatedPdf(1))).toBe(1);
    expect(pdfPageCount(generatedPdf(3, "blank sample body line"))).toBe(3);
    for (const sample of [Buffer.from("%PDF-1.4\n"), BLANK.subarray(0, 120),
      Buffer.from(BLANK.toString("latin1").replace("/Count 3", "/Count 2"), "latin1"),
      Buffer.from(BLANK.toString("latin1").replace("/Kids [3 0 R 4 0 R 5 0 R]", "/Kids [3 0 R 4 0 R 9 0 R]"), "latin1")]) {
      expect(() => pdfPageCount(sample)).toThrow(/Invalid PDF page structure/);
    }
    await withEntry(sourceEntry(), async () => {
      await withOriginal(Buffer.concat([BLANK, Buffer.from("changed")]), async directory => {
        await expect(loadDownloadedOriginals(directory, manifest(), { [ID]: pdfForm() })).rejects.toThrow(/hash\/length/);
      });
      // Four actual pages cannot answer the registered three-page review.
      const four = generatedPdf(4);
      const claimed = sourceEntry();
      claimed.sha256 = createHash("sha256").update(four).digest("hex");
      claimed.bytes = four.length;
      claimed.visualReview = { ...review(), sha256: String(claimed.sha256) };
      await withOriginal(four, async directory => {
        await withEntry(claimed, async () => {
          await expect(loadDownloadedOriginals(directory, manifest(claimed), { [ID]: pdfForm(claimed) }))
            .rejects.toThrow(/differs from the reviewed whole original/);
        });
      });
    });
    expect(() => validateOriginalFile(BLANK, "pdf")).not.toThrow();
    expect(() => validateOriginalFile(Buffer.from("not a pdf"), "pdf")).toThrow(/Invalid PDF original/);
  });
});

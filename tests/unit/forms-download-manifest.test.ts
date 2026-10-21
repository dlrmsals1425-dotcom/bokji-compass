import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import type { ApplicationForm, FormFileFormat } from "@/lib/data/forms";
import { loadDownloadedOriginals, requireApprovedOriginals, validateDownloadManifest, validateOriginalFile, type DownloadManifest } from "../../scripts/build-forms";

const id = "ordin-123", sourceUrl = "https://www.law.go.kr/LSW/flDownload.do?gubun=ELIS&flSeq=456";
const pdfSourceUrl="https://www.law.go.kr/LSW/flDownloadPdf.do?flSeq=789";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const hwp = Buffer.concat([Buffer.from("d0cf11e0a1b11ae1", "hex"), Buffer.alloc(504), Buffer.from("HWP Document File\0"), Buffer.alloc(128)]);
const forms = { [id]: { id, sourceUrl, officialPdfUrl:pdfSourceUrl } as ApplicationForm };
function manifest(bytes: Buffer = hwp, format: FormFileFormat = "hwp"): DownloadManifest {
  return { schema: 1, forms: { [id]: { format, path: `originals/${id}.${format}`, bytes: bytes.length, sha256: hash(bytes), sourceUrl, downloadedAt: "2026-10-17T00:00:00Z" } } };
}
// Small stored ZIP fixtures; no corpus files or public assets are generated.
function zip(entries: Record<string, string | Buffer>): Buffer {
  const local: Buffer[] = [], central: Buffer[] = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const filename = Buffer.from(name), data = Buffer.isBuffer(text) ? text : Buffer.from(text);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30), directory = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(filename.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(directory, filename); offset += header.length + filename.length + data.length;
  }
  const body = Buffer.concat(local), directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, directory, end]);
}
const hwpx = () => zip({ mimetype: "application/hwp+zip", "Contents/section0.xml": "<?xml version='1.0'?><section/>" });

describe("downloaded original manifest", () => {
  let temporary: string;
  beforeEach(async () => {
    temporary = await mkdtemp(path.join(tmpdir(), "bokji-form-manifest-"));
    await mkdir(path.join(temporary, "originals")); await mkdir(path.join(temporary, "previews"));
  });
  afterEach(async () => {
    if (path.dirname(path.resolve(temporary)) !== path.resolve(tmpdir()) || !path.basename(temporary).startsWith("bokji-form-manifest-")) throw new Error("Unexpected test cleanup target");
    await rm(temporary, { recursive: true, force: true });
  });
  it("loads exact HWP bytes and rejects missing approved files when the manifest exists", async () => {
    await writeFile(path.join(temporary, "originals", id + ".hwp"), hwp);
    const loaded = await loadDownloadedOriginals(temporary, manifest(), forms);
    expect(loaded.get(id)?.bytes.equals(hwp)).toBe(true);
    expect(loaded.get(id)?.format).toBe("hwp");
    expect(() => requireApprovedOriginals(new Set([id]), loaded, true)).not.toThrow();
    expect(() => requireApprovedOriginals(new Set(["law-999"]), loaded, true)).toThrow(/no downloaded original/);
    expect(() => requireApprovedOriginals(new Set(["law-999"]), loaded, false)).not.toThrow();
    expect(forms[id].file).toBeUndefined(); // Loading an original does not publish it.
  });
  it("recognizes HWPX containers and keeps their real extension", async () => {
    const bytes = hwpx();
    await writeFile(path.join(temporary, "originals", id + ".hwpx"), bytes);
    const loaded = await loadDownloadedOriginals(temporary, manifest(bytes, "hwpx"), forms);
    expect(loaded.get(id)?.format).toBe("hwpx");
    expect(() => validateOriginalFile(bytes, "hwp")).toThrow(/HWP signature/);
    expect(() => validateOriginalFile(hwp, "hwpx")).toThrow(/HWPX/);
    expect(() => validateOriginalFile(Buffer.from("<html>error</html>"), "hwp")).toThrow();
    expect(() => validateOriginalFile(zip({ "Contents/section0.xml": "<section/>" }), "hwpx")).toThrow();
    expect(() => validateOriginalFile(zip({ mimetype: "application/zip", "Contents/section0.xml": "<section/>" }), "hwpx")).toThrow();
    expect(() => validateOriginalFile(zip({ mimetype: "application/hwp+zip", "document.xml": "<section/>" }), "hwpx")).toThrow();
  });
  it("keeps official PDF, text, image and legacy HWP formats without relabeling them as modern HWP",async()=>{
    const gif=Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64');
    for(const [format,bytes] of [
      ['pdf',Buffer.from('%PDF-1.7\n%%EOF')],
      ['txt',Buffer.from('장학금 지급 신청서\n신청인 성명:       서명:')],
      ['gif',gif],
      ['hwp',Buffer.concat([Buffer.from('HWP Document File V3.00 '),Buffer.alloc(140)])],
    ] as const){
      await writeFile(path.join(temporary,'originals',id+'.'+format),bytes);
      const loaded=await loadDownloadedOriginals(temporary,manifest(bytes,format),forms);
      expect(loaded.get(id)?.format).toBe(format);
      expect(loaded.get(id)?.bytes.equals(bytes)).toBe(true);
    }
    for(const format of ['pdf','txt','gif'] as const)expect(()=>validateOriginalFile(Buffer.from('<html>error page</html>'),format)).toThrow();
    expect(()=>validateOriginalFile(gif,'hwp')).toThrow();
  });
  it("rejects path traversal, wrong IDs, credential URLs and invalid file metadata", () => {
    for (const changes of [{ path: "../outside.hwp" }, { path: "originals/law-999.hwp" }, { path: `originals/${id}.hwpx` }, { bytes: 0 }, { sha256: "bad" }, { downloadedAt: "yesterday" }, { sourceUrl: sourceUrl + "&OC=example" }, { sourceUrl: "https://example.org/file.hwp" }]) {
      const invalid = manifest(); Object.assign(invalid.forms[id], changes);
      expect(() => validateDownloadManifest(invalid)).toThrow();
    }
    const invalid = manifest(); invalid.forms["../bad"] = invalid.forms[id];
    expect(() => validateDownloadManifest(invalid)).toThrow();
  });
  it("rejects changed bytes, missing files and mismatched official attachment identity", async () => {
    await expect(loadDownloadedOriginals(temporary, manifest(), forms)).rejects.toThrow();
    await writeFile(path.join(temporary, "originals", id + ".hwp"), hwp);
    const invalid = manifest(); invalid.forms[id].sha256 = "0".repeat(64);
    await expect(loadDownloadedOriginals(temporary, invalid, forms)).rejects.toThrow(/hash\/length/);
    const wrongUrl = manifest(); wrongUrl.forms[id].sourceUrl = sourceUrl.replace("456", "999");
    await expect(loadDownloadedOriginals(temporary, wrongUrl, forms)).rejects.toThrow(/metadata/);
    await expect(loadDownloadedOriginals(temporary, manifest(), {})).rejects.toThrow(/metadata/);
  });
  it("checks optional PDF bytes/hash/header without requiring a PDF for every original", async () => {
    await writeFile(path.join(temporary, "originals", id + ".hwp"), hwp);
    const pdf = Buffer.from("%PDF-1.7\nblank fixture\n%%EOF");
    await writeFile(path.join(temporary, "previews", id + ".pdf"), pdf);
    const entry = manifest(); entry.forms[id].pdf = { path: `previews/${id}.pdf`, bytes: pdf.length, sha256: hash(pdf), sourceUrl:pdfSourceUrl };
    expect((await loadDownloadedOriginals(temporary, entry, forms)).get(id)?.pdf?.equals(pdf)).toBe(true);
    entry.forms[id].pdf!.sha256 = "0".repeat(64);
    await expect(loadDownloadedOriginals(temporary, entry, forms)).rejects.toThrow(/hash\/length/);
    const html = Buffer.from("<html>not PDF</html>"); await writeFile(path.join(temporary, "previews", id + ".pdf"), html);
    entry.forms[id].pdf = { path: `previews/${id}.pdf`, bytes: html.length, sha256: hash(html), sourceUrl:pdfSourceUrl };
    await expect(loadDownloadedOriginals(temporary, entry, forms)).rejects.toThrow(/PDF header/);
    entry.forms[id].pdf!.path = "previews/law-999.pdf";
    expect(() => validateDownloadManifest(entry)).toThrow(/path\/id/);
  });
  it("accepts official endpoint aliases but rejects nested paths and ambiguous attachment IDs at each boundary", async () => {
    await writeFile(path.join(temporary,"originals",id+".hwp"),hwp);
    const alias=manifest();alias.forms[id].sourceUrl=sourceUrl.replace("/LSW/","/");
    expect((await loadDownloadedOriginals(temporary,alias,forms)).get(id)?.bytes.equals(hwp)).toBe(true);
    for(const invalidUrl of [sourceUrl.replace("/LSW/","/other/"),sourceUrl+"&flSeq=999",sourceUrl+"&flSeq=456"]){
      const invalid=manifest();invalid.forms[id].sourceUrl=invalidUrl;
      expect(()=>validateDownloadManifest(invalid)).toThrow(/official attachment/);
      await expect(loadDownloadedOriginals(temporary,manifest(),{[id]:{...forms[id],sourceUrl:invalidUrl}})).rejects.toThrow(/metadata/);
    }
    const pdf=Buffer.from("%PDF-1.7\n%%EOF");await writeFile(path.join(temporary,"previews",id+".pdf"),pdf);
    for(const invalidUrl of [pdfSourceUrl.replace("/LSW/","/other/"),pdfSourceUrl+"&flSeq=789"]){
      const invalid=manifest();invalid.forms[id].pdf={path:`previews/${id}.pdf`,bytes:pdf.length,sha256:hash(pdf),sourceUrl:invalidUrl};
      expect(()=>validateDownloadManifest(invalid)).toThrow(/official PDF/);
      invalid.forms[id].pdf!.sourceUrl=pdfSourceUrl;
      await expect(loadDownloadedOriginals(temporary,invalid,{[id]:{...forms[id],officialPdfUrl:invalidUrl}})).rejects.toThrow(/PDF source/);
    }
  });
  it("rejects an originals directory redirected outside the manifest root", async () => {
    const input = path.join(temporary, "input"), outside = path.join(temporary, "outside");
    await mkdir(input); await mkdir(outside); await writeFile(path.join(outside, id + ".hwp"), hwp);
    await symlink(outside, path.join(input, "originals"), "junction");
    await expect(loadDownloadedOriginals(input, manifest(), forms)).rejects.toThrow(/escapes/);
  });
  it("rechecks that an extracted Hangul original is the exact selected member of its official ZIP", async () => {
    await writeFile(path.join(temporary, "originals", id + ".hwp"), hwp);
    await mkdir(path.join(temporary,"source-archives"));
    const source=zip({"application.hwp":hwp,"other.hwp":"not the reviewed original"});
    const entry=manifest();entry.forms[id].archive={path:`source-archives/${id}.zip`,member:"application.hwp",bytes:source.length,sha256:hash(source)};
    await writeFile(path.join(temporary,"source-archives",id+".zip"),source);
    expect((await loadDownloadedOriginals(temporary,entry,forms)).get(id)?.bytes.equals(hwp)).toBe(true);
    entry.forms[id].archive!.member="other.hwp";
    await expect(loadDownloadedOriginals(temporary,entry,forms)).rejects.toThrow(/differs from reviewed/);
    entry.forms[id].archive!.member="missing.hwp";
    await expect(loadDownloadedOriginals(temporary,entry,forms)).rejects.toThrow(/Missing or ambiguous/);
    entry.forms[id].archive!.path="../source.zip";
    expect(()=>validateDownloadManifest(entry)).toThrow(/archive/);
  });
});

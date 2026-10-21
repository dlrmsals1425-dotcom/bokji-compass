import { readFile, mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgencyAuthorityBasis, ApplicationForm, FormLink } from "@/lib/data/forms";
import type { Program } from "@/lib/data/types";
import registry from "@/lib/data/verifiedAgencyForms.json";
import { agencyFormUrl, agencyProgramGuideUrl, agencyProgramLinkMatches, formAssetUrl, officialFormUrl, registeredAgencyForm, safeAgencyUrl, validateAgencyForm, validateFormLink } from "@/lib/data/formPublication";
import { loadDownloadedOriginals, requireApprovedOriginals, validateDownloadManifest, type DownloadManifest } from "../../scripts/build-forms";
import { basisText } from "@/components/ApplicationForms";

const e=registry.forms["agency-44250-36032"], id=e.id;
const file=`/forms/files/${id}-${e.sha256.slice(0,12)}.${e.format}`;
const form=(): ApplicationForm => ({ id, title:e.title, role:"application", sourceKind:"agency", regionCode:e.regionCode, regionLabel:e.regionLabel,
  lawId:e.lawId, lawTitle:e.lawTitle, lawUrl:e.lawEvidenceUrl, annexId:"", annexNumber:"", sourceUrl:e.sourceUrl,
  fetchedAt:e.checkedAt, dateKind:"published", effectiveDate:e.publishedAt,
  agency:{agencyName:e.agencyName,sourcePageUrl:e.sourcePageUrl,finalUrl:e.finalUrl,attachmentId:e.attachmentId,sha256:e.sha256,bytes:e.bytes,format:"hwp",checkedAt:e.checkedAt,authorityEvidenceUrl:e.authorityEvidenceUrl} });
const link=(): FormLink => ({formId:id,use:"main",condition:e.condition,evidenceUrl:e.sourcePageUrl,evidenceNote:"공식 시청 배포 원문 전체를 확인하여 이 사업과 대조한 신청서입니다.",checkedAt:e.checkedAt,programEvidenceUrl:e.programs[0].url});
const program=(): Program => ({id:e.programs[0].id,name:"화장장려금 지원",scope:"sigungu",region:{sido:"44000",sigungu:"44250"},url:e.programs[0].url,laws:[e.lawTitle]} as Program);
const manifest=(): DownloadManifest => ({schema:1,forms:{[id]:{format:"hwp",path:`originals/${id}.hwp`,bytes:e.bytes,sha256:e.sha256,sourceUrl:e.sourceUrl,finalUrl:e.finalUrl,downloadedAt:"2026-10-19T00:00:00Z"}}});

describe("exact curated agency originals",()=>{
  afterEach(()=>{vi.unstubAllGlobals();vi.resetModules();});
  it("accepts the registered official case and retains actual publication and law dates separately",()=>{
    expect(registeredAgencyForm(id)?.sha256).toBe(e.sha256);
    expect(()=>validateFormLink(program(),form(),link())).not.toThrow();
    expect(validateAgencyForm(form()).lawEffectiveDate).toBe("2024-05-20");
    expect(basisText(form())).toBe("기관 공식 배포 · 게시일 2026-05-12");
    expect(basisText({...form(),dateKind:"checked",effectiveDate:"2026-10-19"})).toContain("공식배포 확인일 2026-10-19");
    expect(formAssetUrl(file)).toBe(file);
    expect(agencyFormUrl(id,e.sourceUrl)).toBe(e.sourceUrl);
  });
  it("keeps law portal URL policy unchanged and rejects unregistered agency endpoints",()=>{
    expect(officialFormUrl(e.sourceUrl)).toBeNull();
    expect(officialFormUrl("https://www.law.go.kr/LSW/flDownload.do?flSeq=123")).toBeTruthy();
    for(const url of [e.sourceUrl+"&extra=1",e.sourceUrl.replace("36032","999"),"https://gyeryong.go.kr/other.hwp","https://private.org/file.hwp"])
      expect(agencyFormUrl(id,url)).toBeNull();
    expect(agencyFormUrl("agency-44250-999",e.sourceUrl)).toBeNull();
    expect(formAssetUrl(file.replace("36032","999"))).toBeNull();
    expect(formAssetUrl(file.replace(e.sha256.slice(0,12),"000000000000"))).toBeNull();
  });
  it("distinguishes public routing and attachment identifiers from credentials and unsafe paths",()=>{
    expect(safeAgencyUrl("https://public.or.kr/file?key=123&fileKey=PUBLIC&atchFileId=FILE_123")).toBeTruthy();
    for(const url of ["https://user:pass@public.or.kr/file","https://public.or.kr/a/%252e%252e/b.hwp","https://public.or.kr/a/%5c../b.hwp","https://public.or.kr/file?key=secret","https://public.or.kr/file?%2561piKey=secret",
      ...["apiKey","serviceKey","access_token","Authorization","password","session","OC"].map(k=>`https://public.or.kr/file?${k}=secret`)]) expect(safeAgencyUrl(url)).toBeNull();
  });
  it("supports an exact delegated fixed path, requiring authority proof and one identifier mode",()=>{
    const forms=registry.forms as unknown as Record<string,Record<string,unknown>>, previous=forms[id];
    const pathname="/userNew/custom/SP/%EC%8B%A0%EC%B2%AD.hwp", url="https://public.or.kr"+pathname;
    try {
      forms[id]={...previous,sourceUrl:url,finalUrl:url,authorityKind:"delegated",attachmentIdentifier:{path:pathname}};
      expect(agencyFormUrl(id,url)).toBe(url);
      expect(agencyFormUrl(id,"https://public.or.kr/other.hwp")).toBeNull();
      forms[id].attachmentIdentifier={path:pathname,queryParam:"file_id",value:e.attachmentId};
      expect(registeredAgencyForm(id)).toBeNull();
      forms[id].attachmentIdentifier={path:pathname};forms[id].authorityEvidenceUrl=url;
      expect(registeredAgencyForm(id)).toBeNull();
    } finally { forms[id]=previous; }
  });
  it("rejects source identity, original SHA, jurisdiction and target program mismatches",()=>{
    for(const changes of [{sourceUrl:e.sourceUrl+"&x=1"},{lawId:"999"},{sourceKind:"ordin"},{annexId:"17575933"},{annexNumber:"1"},{regionCode:"44230"},
      {agency:{...form().agency!,sha256:"0".repeat(64)}},{agency:{...form().agency!,finalUrl:"https://other.go.kr/file.hwp"}}])
      expect(()=>validateAgencyForm({...form(),...changes} as ApplicationForm)).toThrow();
    expect(()=>validateFormLink({...program(),id:"g44250.gov24-wrong"},form(),link())).toThrow();
    expect(()=>validateFormLink({...program(),region:{sido:"44000",sigungu:"44230",label:"다른 시"}},form(),link())).toThrow();
    expect(()=>validateFormLink({...program(),url:"https://www.bokjiro.go.kr/"},form(),link())).toThrow();
    expect(()=>validateFormLink(program(),form(),{...link(),condition:"제한 없이 사용"})).toThrow();
    expect(agencyProgramLinkMatches("g44250.gov24-wrong",form(),link())).toBe(false);
  });
  it("checks exact manifest identity, final URL, hash and storage paths",()=>{
    expect(()=>validateDownloadManifest(manifest())).not.toThrow();
    for(const changes of [{path:"../outside.hwp"},{path:`originals/${id}.hwpx`},{sha256:"0".repeat(64)},{bytes:1},{format:"pdf"},
      {sourceUrl:e.sourceUrl+"&x=1"},{finalUrl:"https://example.org/file.hwp"},{finalUrl:undefined},{pdf:{path:"previews/x.pdf"}}]){
      const invalid=manifest();Object.assign(invalid.forms[id],changes);
      expect(()=>validateDownloadManifest(invalid)).toThrow();
    }
    expect(()=>requireApprovedOriginals(new Set([id]),new Map(),false)).toThrow(/no downloaded original/);
  });
  it("loads the actual blank HWP fixture and refuses changed bytes",async()=>{
    const temporary=await mkdtemp(path.join(tmpdir(),"agency-original-"));
    try {
      await mkdir(path.join(temporary,"originals"));
      const bytes=await readFile(path.resolve("tests/fixtures/forms/agency-44250-36032.hwp"));
      await writeFile(path.join(temporary,"originals",id+".hwp"),bytes);
      expect((await loadDownloadedOriginals(temporary,manifest(),{[id]:form()})).get(id)?.bytes.equals(bytes)).toBe(true);
      await expect(loadDownloadedOriginals(temporary,manifest(),{[id]:{...form(),sourceUrl:e.sourceUrl+"&other=1"}})).rejects.toThrow();
      await writeFile(path.join(temporary,"originals",id+".hwp"),Buffer.concat([bytes,Buffer.from("changed")]));
      await expect(loadDownloadedOriginals(temporary,manifest(),{[id]:form()})).rejects.toThrow(/hash\/length/);
    } finally {
      if(path.dirname(path.resolve(temporary))!==path.resolve(tmpdir()) || !path.basename(temporary).startsWith("agency-original-"))throw new Error("Unexpected cleanup target");
      await rm(temporary,{recursive:true,force:true});
    }
  });
  it("accepts a PDF original's own print alias but rejects another PDF or a Hangul preview",()=>{
    const forms=registry.forms as unknown as Record<string,Record<string,unknown>>, previous=forms[id];
    const pdfPath=file.replace(/\.hwp$/,".pdf");
    try {
      forms[id]={...previous,format:"pdf"};
      const pdfForm=form();
      pdfForm.agency={...pdfForm.agency!,format:"pdf"};
      pdfForm.file={hwp:pdfPath,pdf:pdfPath,format:"pdf",bytes:e.bytes,sha256:e.sha256};
      expect(()=>validateAgencyForm(pdfForm)).not.toThrow();
      expect(()=>validateAgencyForm({...pdfForm,file:{...pdfForm.file!,pdf:"/forms/files/other.pdf"}})).toThrow();
    } finally { forms[id]=previous; }
    expect(()=>validateAgencyForm({...form(),file:{hwp:file,pdf:pdfPath,format:"hwp",bytes:e.bytes,sha256:e.sha256}})).toThrow();
  });
  it("client loader rejects wrong SHA or programme even when asset spelling looks valid",async()=>{
    for(const mutation of ["valid","sha","program"]){
      vi.resetModules();
      const f=form();f.file={hwp:file,format:"hwp",bytes:e.bytes,sha256:mutation==="sha"?"0".repeat(64):e.sha256};
      const pid=mutation==="program"?"g44250.gov24-wrong":program().id;
      vi.stubGlobal("fetch",vi.fn(async(url:string)=>({ok:true,json:async()=>url.includes("/programs/")
        ? {schema:1,programs:[{id:pid,links:[link()],candidateFormIds:[]}]}
        : {schema:1,forms:{[id]:f}}})));
      const loader=await import("@/lib/client/forms");
      const result=await loader.loadProgramForms(pid);
      if(mutation==="valid")expect(result?.forms[0].id).toBe(id);else expect(result).toBeNull();
    }
  });
  it("retry fetches corrected source metadata after a rejected flat or sharded catalogue",async()=>{
    for(const sharded of [false,true]){
      vi.resetModules();
      let invalid=true;
      const fetcher=vi.fn(async(url:string)=>({ok:true,json:async()=>{
        const f=form();f.file={hwp:file,format:"hwp",bytes:e.bytes,sha256:invalid?"0".repeat(64):e.sha256};
        return url.includes("/programs/")
          ? {schema:1,catalogSharded:sharded,programs:[{id:program().id,links:[link()],candidateFormIds:[]}]}
          : {schema:1,forms:{[id]:f}};
      }}));
      vi.stubGlobal("fetch",fetcher);
      const loader=await import("@/lib/client/forms");
      expect(await loader.loadProgramForms(program().id)).toBeNull();
      invalid=false;
      expect((await loader.loadProgramForms(program().id))?.forms[0].id).toBe(id);
      expect(fetcher).toHaveBeenCalledTimes(4);
    }
  });
});

/* 공식 신청 안내를 근거로 등록한 경우. 시험 동안만 등록분을 끼워 넣고 자료로 남기지 않는다. */
const BASIS_ID="agency-44250-36032-notice";
const BASIS={kind:"official-program",title:"계룡시 화장장려금 지원 신청 안내",evidenceUrl:e.sourcePageUrl,checkedAt:e.checkedAt,
  evidenceNote:"안내문의 처리절차는 신청인이 이 첨부 서식을 작성해 가족돌봄과에 제출하는 단계이며, 첨부 36032는 그 신청에 쓰는 신청서다.",
  pageSHA256:"a".repeat(64)} as const satisfies AgencyAuthorityBasis;
const EMPTY_LAW={lawId:"",lawTitle:"",lawEvidenceUrl:"",lawEffectiveDate:"",lawCurrentCheckedAt:""} as const;
type Row=Record<string,unknown>;
const registered=registry.forms as unknown as Record<string,Row>;
const officialEntry=():Row & {authorityBasis:Row}=>({...structuredClone(registered[id]),id:BASIS_ID,...EMPTY_LAW,authorityBasis:{...BASIS}});
const officialForm=():ApplicationForm=>({...form(),id:BASIS_ID,lawId:"",lawTitle:"",lawUrl:"",
  agency:{...form().agency!,authorityBasis:{...BASIS}}});
const withBasis=(value:unknown):ApplicationForm=>({...officialForm(),
  agency:{...officialForm().agency!,authorityBasis:value as AgencyAuthorityBasis|undefined}});
function withOfficial<T>(entry:Row,run:()=>T):T {
  registered[BASIS_ID]=entry;
  try { return run(); } finally { delete registered[BASIS_ID]; }
}

describe("curated agency form authorised by its benefit's official application guidance",()=>{
  it("accepts the reviewed programme basis and publishes no law source",()=>{
    withOfficial(officialEntry(),()=>{
      const f=officialForm();
      expect(registeredAgencyForm(BASIS_ID)?.sha256).toBe(e.sha256);
      expect(()=>validateAgencyForm(f)).not.toThrow();
      expect(f.lawUrl).toBe("");
      expect(agencyProgramGuideUrl(f)).toBe(e.sourcePageUrl);
      expect(()=>validateFormLink(program(),f,{...link(),formId:BASIS_ID})).not.toThrow();
      expect(agencyFormUrl(BASIS_ID,e.sourceUrl)).toBe(e.sourceUrl);
      expect(basisText(f)).toBe("기관 공식 배포 · 게시일 2026-05-12");
    });
    // 기존 조례 등록분은 그대로 '근거 법령'을 쓰고 공식 안내 링크를 얻지 않는다.
    expect(registeredAgencyForm(id)?.lawEvidenceUrl).toBe(e.lawEvidenceUrl);
    expect(()=>validateAgencyForm(form())).not.toThrow();
    expect(agencyProgramGuideUrl(form())).toBeNull();
    expect(agencyProgramGuideUrl({...form(),lawUrl:""})).toBeNull();
  });
  it("rejects a basis that does not match the reviewed page, day, note or hash",()=>{
    for(const changes of [{kind:"official-law"},{kind:"ordinance"},{title:"   "},{title:42},{evidenceUrl:e.sourceUrl},
      {evidenceUrl:e.sourcePageUrl+"&x=1"},{checkedAt:"2026-10-18"},{checkedAt:"2026-10-20"},{evidenceNote:"안내 확인함"},
      {pageSHA256:"A".repeat(64)},{pageSHA256:"a".repeat(63)},{pageSHA256:""},{lawId:e.lawId}]){
      const entry=officialEntry();Object.assign(entry.authorityBasis,changes);
      withOfficial(entry,()=>expect(registeredAgencyForm(BASIS_ID)).toBeNull());
    }
    for(const basis of [null,[{...BASIS}],{},"official-program",{...BASIS,pageSHA256:undefined},
      (()=>{const row:Row={...BASIS};delete row.evidenceNote;return row;})()]){
      withOfficial({...officialEntry(),authorityBasis:basis},()=>expect(registeredAgencyForm(BASIS_ID)).toBeNull());
    }
    // 근거가 없으면 법령 칸을 비운 것만으로는 등록되지 않는다.
    const bare:Row=officialEntry();delete bare.authorityBasis;
    withOfficial(bare,()=>expect(registeredAgencyForm(BASIS_ID)).toBeNull());
  });
  it("refuses any coexisting law or annex identity in either direction",()=>{
    for(const changes of [{lawId:e.lawId},{lawTitle:e.lawTitle},{lawEvidenceUrl:e.lawEvidenceUrl},
      {lawEffectiveDate:e.lawEffectiveDate},{lawCurrentCheckedAt:e.checkedAt},{annexId:"17575933"},{annexNumber:"1"},
      {annexId:null},{annexNumber:0},{annexId:false}])
      withOfficial({...officialEntry(),...changes},()=>expect(registeredAgencyForm(BASIS_ID)).toBeNull());
    const previous=registered[id];
    try {
      registered[id]={...previous,authorityBasis:{...BASIS}};
      expect(registeredAgencyForm(id)).toBeNull();
      registered[id]={...previous,authorityBasis:null};
      expect(registeredAgencyForm(id)).toBeNull();
    } finally { registered[id]=previous; }
    expect(()=>validateAgencyForm({...form(),agency:{...form().agency!,authorityBasis:{...BASIS}}})).toThrow();
  });
  it("never lets the published form or its metadata show a law it does not have",()=>{
    withOfficial(officialEntry(),()=>{
      for(const changes of [{lawUrl:e.lawEvidenceUrl},{lawId:e.lawId},{lawTitle:e.lawTitle},{annexId:"1"}])
        expect(()=>validateAgencyForm({...officialForm(),...changes})).toThrow();
      for(const basis of [undefined,{...BASIS,title:"다른 사업 안내"},{...BASIS,evidenceUrl:e.sourceUrl},
        {...BASIS,checkedAt:"2026-10-18"},{...BASIS,extra:"x"},{kind:"official-program"}])
        expect(()=>validateAgencyForm(withBasis(basis))).toThrow();
      expect(agencyProgramGuideUrl({...officialForm(),lawUrl:e.lawEvidenceUrl})).toBeNull();
      expect(agencyProgramGuideUrl(withBasis({...BASIS,evidenceUrl:e.sourceUrl}))).toBeNull();
    });
  });
  it("keeps exact source gates and opens no extra host in programme mode",()=>{
    for(const changes of [{sourceUrl:e.sourceUrl+"&session=secret"},{sha256:"0".repeat(12)},{authorityEvidenceNote:""},
      {authorityEvidenceUrl:"https://private.example.org/notice"},{attachmentId:"999"}])
      withOfficial({...officialEntry(),...changes},()=>expect(registeredAgencyForm(BASIS_ID)).toBeNull());
    // 바뀐 원문 해시는 등록 문법이 아니라 실제 파일·공개 메타데이터가 어긋나는 자리에서 걸린다.
    withOfficial({...officialEntry(),sha256:"0".repeat(64)},()=>{
      expect(registeredAgencyForm(BASIS_ID)?.sha256).toBe("0".repeat(64));
      expect(()=>validateAgencyForm(officialForm())).toThrow();
      expect(formAssetUrl(`/forms/files/${BASIS_ID}-${e.sha256.slice(0,12)}.hwp`)).toBeNull();
      const f=officialForm();
      f.agency={...f.agency!,sha256:"0".repeat(64)};
      f.file={hwp:`/forms/files/${BASIS_ID}-${e.sha256.slice(0,12)}.hwp`,format:"hwp",bytes:e.bytes,sha256:e.sha256};
      expect(()=>validateAgencyForm(f)).toThrow();
    });
    for(const page of ["http://gyeryong.go.kr/kr/html/sub01/0102.html",e.sourcePageUrl+"#top",e.sourcePageUrl+"&session=secret"]){
      const entry=officialEntry();entry.sourcePageUrl=page;entry.authorityBasis.evidenceUrl=page;
      withOfficial(entry,()=>expect(registeredAgencyForm(BASIS_ID)).toBeNull());
    }
    withOfficial(officialEntry(),()=>{
      for(const url of ["https://gyeryong.go.kr/other.hwp",e.sourcePageUrl,e.sourceUrl+"&x=1"])
        expect(agencyFormUrl(BASIS_ID,url)).toBeNull();
      expect(agencyProgramGuideUrl({...officialForm(),agency:{...officialForm().agency!,sourcePageUrl:"https://example.org/notice"}})).toBeNull();
    });
    // 시험이 끝나면 끼워 넣은 등록분은 남지 않는다.
    expect(registeredAgencyForm(BASIS_ID)).toBeNull();
    expect(registered[BASIS_ID]).toBeUndefined();
  });
});

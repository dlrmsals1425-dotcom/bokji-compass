import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {unzipSync,strFromU8} from "fflate";
import {writingTemplate} from "@/lib/data/formWritingRegistry";
import {allChecks,allFields,exclusiveSets,normalizeInput} from "@/lib/data/formWriting";
import {buildFilledHwpx,buildFilledSection,fieldError} from "@/lib/client/hwpxWriter";
import {indexSection,findParagraph} from "@/lib/client/hwpxXml";

const regular=writingTemplate("rule-3211495")!,voucher=writingTemplate("rule-3211501")!;
const bytes=(id:string)=>new Uint8Array(readFileSync(`pipeline/forms/originals/${id}.hwpx`));
const xml=(id:string)=>strFromU8(unzipSync(bytes(id))["Contents/section0.xml"]);
describe("작성한 의사와 실제 문서의 일치",()=>{
 it("급여 선택을 취소하면 숨겨진 대상자와 하위 표시도 빠진다",()=>{
  const input={values:{"cc0.name":"홍길동"},checks:{"s.childcare":false,"cc0.basic":true}};
  expect(normalizeInput(voucher,input.values,input.checks)).toEqual({values:{},checks:{},conflicts:[]});
  expect(buildFilledSection(voucher,xml(voucher.formId),input)).toBe(xml(voucher.formId));
 });
 it("일반 신청서의 같은 줄 대상자도 해당 급여를 선택한 경우만 적힌다",()=>{
  const raw=xml(regular.formId),values={"b.parentCash.name":"홍길동","nt.otherText":"방문"};
  expect(buildFilledSection(regular,raw,{values,checks:{}})).toBe(raw);
  const filled=buildFilledSection(regular,raw,{values,checks:{"b.parentCash":true}});
  expect(filled.includes("홍길동")).toBe(true);
  const slot=allFields(regular).find(f=>f.key==="nt.otherText")!.slot.at;
  expect(findParagraph(indexSection(filled),slot.table,slot.rowAddr,slot.colAddr,slot.p).text)
   .toBe(findParagraph(indexSection(raw),slot.table,slot.rowAddr,slot.colAddr,slot.p).text);
 });
 it("갱신 신청에 신규 전용 긴급활동지원이 남지 않는다",()=>{
  const normalized=normalizeInput(voucher,{}, {"s.activity":true,"ac.renew":true,"ac.urgent":true});
  expect(normalized.checks["ac.renew"]).toBe(true);expect(normalized.checks["ac.urgent"]).toBeUndefined();
 });
 it("원문상 하나만 고르는 신청요건과 PC 신청/미신청의 모순을 막는다",()=>{
  expect(()=>buildFilledSection(voucher,xml(voucher.formId),{values:{},checks:{"s.homecare":true,"hc.req1":true,"hc.req2":true}})).toThrow(/하나만/);
  expect(()=>buildFilledSection(regular,xml(regular.formId),{values:{},checks:{"b.schoolCost":true,"b.pc.apply":true,"b.pc.none":true}})).toThrow(/하나만/);
 });
 it("본인·배우자 동시신청과 서로 다른 급여는 함께 고를 수 있다",()=>{
  const result=normalizeInput(regular,{}, {"b.pension":true,"b.pension.spouse":true,"b.living":true});
  expect(result.conflicts).toEqual([]);expect(Object.keys(result.checks)).toHaveLength(3);
 });
 it("관계명은 불필요한 접속문자가 붙지 않고 실제 관계 칸에 적힌다",()=>{
  const out=indexSection(buildFilledSection(regular,xml(regular.formId),{values:{"sup0.rel":"아들"},checks:{}}));
  expect(findParagraph(out,0,18,1,0).text).toBe("아들");
 });
 it("필수 길이의 숫자는 보존하고 좁은 칸의 과도한 한글과 잘못된 XML 문자는 거부한다",()=>{
  const id=allFields(regular).find(f=>f.key==="a.rrn")!,name=allFields(regular).find(f=>f.key==="a.name")!;
  expect(fieldError(regular,id,"000000-0000000")).toBeNull();
  expect(fieldError(regular,id,"가나다라마바사")).not.toBeNull();
  expect(fieldError(regular,name,"가".repeat(6))).toMatch(/원본 서식 칸/);
  for(const value of ["\ud800","\ufffe","\uffff","a\nb"] ) expect(fieldError(regular,name,value)).not.toBeNull();
 });
 it("같은 길이의 손상된 원본도 압축을 열기 전에 SHA 오류로 막는다",async()=>{
  const corrupted=bytes(regular.formId);corrupted[0]^=255;
  await expect(buildFilledHwpx(regular,corrupted,{values:{},checks:{}})).rejects.toThrow(/공개된 원본/);
 });
 it("각 선택 제약은 실제 등록된 원본 체크칸들에만 적용한다",()=>{
  for(const template of [regular,voucher]){
   const keys=new Set(allChecks(template).map(c=>c.key));
   for(const set of exclusiveSets(template)) for(const key of set) expect(keys.has(key),key).toBe(true);
  }
 });
 it("휴대전화 감면을 취소하면 가구원 전용 칸과 통신사도 작성본에서 빠진다",()=>{
  const raw=xml(regular.formId),values={"disc0.name":"홍길순","disc0.mobile":"010-0000-0000"};
  expect(buildFilledSection(regular,raw,{values,checks:{"disc0.carrier0":true}})).toBe(raw);
  const positive=buildFilledSection(regular,raw,{values,checks:{"d.mobile":true,"disc0.carrier0":true}});
  expect(findParagraph(indexSection(positive),1,21,2,0).text).toBe("홍길순");
 });
 it("서비스 유형과 카드사를 바꾸면 이전 유형의 부속 이름이 남지 않는다",()=>{
  const input={"dl.basicName":"가나","dl.specialName1":"다라","fm.bcBank":"가나","fm.kbBank":"다라"};
  const normalized=normalizeInput(voucher,input,{"s.daily":true,"dl.special":true,"s.firstMeet":true,"fm.card4":true});
  expect(normalized.values).toEqual({"dl.specialName1":"다라","fm.kbBank":"다라"});
  const filled=buildFilledSection(voucher,xml(voucher.formId),{values:input,checks:normalized.checks});
  expect(findParagraph(indexSection(filled),1,28,3,0).text.includes("가나")).toBe(false);
  expect(findParagraph(indexSection(filled),1,28,3,0).text.includes("다라")).toBe(true);
 });
 it("괄호 안 하위 선택은 그 원래 신청 항목을 고른 경우에만 남는다",()=>{
  expect(normalizeInput(voucher,{}, {"s.childcare":true,"cc0.basic.disabled":true}).checks["cc0.basic.disabled"]).toBeUndefined();
  expect(normalizeInput(voucher,{}, {"s.childcare":true,"cc0.basic":true,"cc0.basic.disabled":true}).checks["cc0.basic.disabled"]).toBe(true);
  expect(normalizeInput(voucher,{}, {"s.diaper":true,"dp.x2":true}).checks["dp.x2"]).toBeUndefined();
  expect(normalizeInput(regular,{}, {"d.basic.living":true}).checks["d.basic.living"]).toBeUndefined();
 });
});

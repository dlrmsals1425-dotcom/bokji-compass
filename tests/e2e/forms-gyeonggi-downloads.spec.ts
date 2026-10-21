import {expect,test} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import agencyRegistry from '../../src/lib/data/verifiedAgencyForms.json';
import type {FormsCatalog} from '../../src/lib/data/forms';

const catalog=JSON.parse(readFileSync('public/forms/v1/catalog.json','utf8')) as FormsCatalog;
const entries=Object.values(agencyRegistry.forms).filter(entry=>entry.regionCode.startsWith('41'));
const portalRows=readdirSync('pipeline/forms/reviews').filter(name=>/^municipal-reviewed-round81\d\d\.json$/.test(name))
  .flatMap(name=>JSON.parse(readFileSync(`pipeline/forms/reviews/${name}`,'utf8')).rows) as {formId:string;sha256:string;bytes:number;programIds:string[]}[];

test('every reviewed Gyeonggi original is served with the approved bytes and programme associations',async({request})=>{
  expect(entries.length).toBeGreaterThanOrEqual(31);
  for(const entry of entries){
    const form=catalog.forms[entry.id];
    expect(form,entry.id).toBeTruthy();
    expect(form.file,entry.id).toBeTruthy();
    const response=await request.get(form.file!.hwp);
    expect(response.status(),entry.id).toBe(200);
    const body=await response.body();
    expect(body.byteLength,entry.id).toBe(entry.bytes);
    expect(createHash('sha256').update(body).digest('hex'),entry.id).toBe(entry.sha256);
    for(const programme of entry.programs){
      const region=programme.id.split('.')[0];
      const response=await request.get(`/forms/v1/programs/${region}.json`);
      const data=await response.json();
      const record=data.programs.find((row:{id:string})=>row.id===programme.id);
      expect(record?.status,programme.id).toBe('available');
      expect(record.links.some((link:{formId:string;programEvidenceUrl?:string})=>link.formId===entry.id && link.programEvidenceUrl===programme.url),programme.id).toBe(true);
    }
  }
});

test('additional portal originals and reused forms keep their exact bytes and benefit links',async({request})=>{
  expect(portalRows.length).toBeGreaterThanOrEqual(8);
  for(const row of portalRows){
    const form=catalog.forms[row.formId];
    const response=await request.get(form.file!.hwp),body=await response.body();
    expect(response.status(),row.formId).toBe(200);
    expect(body.byteLength,row.formId).toBe(row.bytes);
    expect(createHash('sha256').update(body).digest('hex'),row.formId).toBe(row.sha256);
    for(const pid of row.programIds){
      const response=await request.get(`/forms/v1/programs/${pid.split('.')[0]}.json`);
      const record=(await response.json()).programs.find((entry:{id:string})=>entry.id===pid);
      expect(record.status,pid).toBe('available');
      expect(record.links.some((link:{formId:string})=>link.formId===row.formId),pid).toBe(true);
    }
  }
});

test('province-wide benefits show the chosen municipality forms with their common form @mobile',async({page})=>{
  await page.goto('/p/s41000.gov24-641000000171');
  const panel=page.getByTestId('application-forms');
  const local=catalog.forms['ordin-20872019'],other=catalog.forms['ordin-21777279'];
  const common=catalog.forms['agency-41000-child-meal-2026-00688'];
  await expect(panel.locator(`a[download][href="${common.file!.hwp}"]`)).toBeVisible();
  await expect(panel.getByTestId('forms-source-attachments').locator(`a[href="${common.sourceUrl}"]`)).toHaveCount(0);
  await expect(panel.locator(`a[download][href="${local.file!.hwp}"]`)).toHaveCount(0);
  await panel.getByLabel('신청할 시·군').selectOption({label:'고양시'});
  await expect(panel.locator(`a[download][href="${local.file!.hwp}"]`)).toBeVisible();
  await expect(panel.locator(`a[download][href="${other.file!.hwp}"]`)).toHaveCount(0);
  await panel.getByLabel('신청할 시·군').selectOption({label:'가평군'});
  await expect(panel.locator(`a[download][href="${other.file!.hwp}"]`)).toBeVisible();
  await expect(panel.locator(`a[download][href="${local.file!.hwp}"]`)).toHaveCount(0);
  await expect(panel.locator(`a[download][href="${common.file!.hwp}"]`)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

for(const sample of [
  {programme:'g41610.gov24-554000000205',id:'agency-41610-bokjiro-WLF00006471-20260625UUWBM1731370198695083',instruction:'한 번의 다태임신당'},
  {programme:'s41000.bokjiro-WLF00006330',id:'agency-41000-goe-diabetes-20260904',instruction:'10월20일 우체국 소인'},
  {programme:'s41000.gov24-641000000147',id:'agency-41000-disability-medical-06696',instruction:'퇴원일로부터1년이내'},
  {programme:'g41150.bokjiro-WLF00000714',id:'agency-41150-bok-20260820UUWBM1619330205556340-1',instruction:'11쪽'},
  {programme:'g41820.bokjiro-WLF00005976',id:'agency-41820-96972',instruction:'정책홍보 동의는 별도 선택'},
  {programme:'g41830.bokjiro-WLF00006105',id:'agency-41830-bokjiro-WLF00006105-20250527UUWBM1446200139571761',instruction:'동의하지 않으면'},
  {programme:'g41190.bokjiro-WLF00000001',id:'agency-41190-school-uniform-jpg',instruction:'이미지 원본'},
  {programme:'g41820.bokjiro-WLF00002656',id:'ordin-20406127',instruction:'가평'},
  {programme:'g41670.gov24-570000000123',id:'ordin-22185907',instruction:'재발급'},
  {programme:'g41390.gov24-401000000489',id:'ordin-21605505',instruction:'시흥시 자체 산후조리비'},
  {programme:'g41480.bokjiro-WLF00003882',id:'rule-3211501',instruction:'산모신생아'},
  {programme:'g41220.bokjiro-WLF00000783',id:'agency-41220-bokjiro-WLF00000783-20230525UUWBM1328390036214748',instruction:'북부권역'},
])test(`Gyeonggi ${sample.id} has the correct source, instructions and download @mobile`,async({page})=>{
  await page.goto(`/p/${sample.programme}`);
  const panel=page.getByTestId('application-forms'),form=catalog.forms[sample.id];
  const button=panel.locator(`a[download][href="${form.file!.hwp}"]`);
  await expect(button).toBeVisible();
  const row=button.locator('xpath=ancestor::li[1]');
  await expect(row).toContainText(sample.instruction);
  await expect(row.getByRole('link',{name:'공식 서식 원본'})).toHaveAttribute('href',form.sourceUrl);
  if(form.agency?.authorityBasis){
    expect(form.lawId).toBe('');expect(form.lawUrl).toBe('');
    await expect(row.getByRole('link',{name:'공식 신청 안내'})).toHaveAttribute('href',form.agency.authorityBasis.evidenceUrl);
    await expect(row.getByRole('link',{name:'근거 조례 원문'})).toHaveCount(0);
  }else if(form.sourceKind==='agency'){
    await expect(row.getByRole('link',{name:'근거 조례 원문'})).toHaveAttribute('href',form.lawUrl);
  }
  const [download]=await Promise.all([page.waitForEvent('download'),button.click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${form.file!.format}$`));
  expect(createHash('sha256').update(readFileSync((await download.path())!)).digest('hex')).toBe(form.file!.sha256);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('known filled and wrong-jurisdiction attachments do not reappear in public lists',async({request})=>{
  const source=JSON.parse(readFileSync('pipeline/forms/reviews/gyeonggi-official-attachments-scope-20261019.json','utf8'));
  for(const id of ['page-594b327bda354859350e','page-a7d6c964a3ecc4646dfe','page-de36c64cc033ba1e7711','page-b6156e072d2090d623b0','page-e802e696af258bcd22e3']){
    const sample=source.files.find((row:{candidateId:string})=>row.candidateId===id);
    expect(sample,id).toBeTruthy();
    const response=await request.get(`/forms/v1/programs/${sample.programIds[0].split('.')[0]}.json`);
    expect(response.status()).toBe(200);
    const attachment=new URL(sample.sourceUrl).searchParams.get('atcflId');
    expect(attachment).toBeTruthy();
    expect(await response.text()).not.toContain(attachment!);
  }
});

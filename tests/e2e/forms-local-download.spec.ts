import {expect,test} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import type {FormsCatalog} from '../../src/lib/data/forms';

const catalog=JSON.parse(readFileSync('public/forms/v1/catalog.json','utf8')) as FormsCatalog;
for(const sample of [
  {program:'g41280.gov24-394000000111',form:'ordin-19969911',format:'hwp'},
  {program:'g11440.gov24-313000000145',form:'ordin-22517767',format:'hwpx'},
  {program:'g48240.gov24-O00013000002',form:'ordin-22140033',format:'hwp'},
  {program:'g26110.gov24-325000000249',form:'ordin-22750737',format:'hwpx'},
  {program:'g11350.gov24-310000000120',form:'ordin-21271589',format:'pdf'},
  {program:'g48270.gov24-O00012600001',form:'ordin-20291905',format:'gif'},
  {program:'g51720.bokjiro-WLF00002975',form:'ordin-19878599',format:'txt'},
  {program:'g47210.bokjiro-WLF00002245',form:'ordin-20973493',format:'hwp'},
  {program:'g52790.gov24-478000000120',form:'ordin-22409877',format:'hwp'},
  {program:'g51230.bokjiro-WLF00005579',form:'ordin-19201333',format:'hwp',title:'위임장(전입장려금 신청)'},
  {program:'s41000.gov24-641000000129',form:'ordin-20191135',format:'hwp',municipality:'안양시'},
  {program:'g41280.bokjiro-WLF00004751',form:'ordin-19996049',format:'hwp'},
  {program:'s27000.gov24-627000000108',form:'ordin-18151309',format:'hwp',municipality:'남구'},
  {program:'g51110.gov24-418000000243',form:'ordin-18422495',format:'hwp'},
  {program:'g41590.gov24-O00058400003',form:'ordin-21451325',format:'hwp',title:'입사원서 · 개인정보 수집·이용 동의서',instructions:'별지 제1호 입사원서와 제4호 개인정보 동의서만 작성합니다.'},
  {program:'g52190.bokjiro-WLF00003477',form:'ordin-20097253',format:'hwp',title:'임대보증금 무이자지원 신청서',instructions:'국민임대주택 입주 대상자가 남원시장에게 신규 지원을 신청할 때 사용합니다.'},
  {program:'g44800.gov24-460000000141',form:'ordin-21772917',format:'hwp',title:'(참전, 보훈)수당지급대상자 등록신청서',instructions:'홍성 참전명예·보훈명예 또는 해당 배우자수당 등록신청 항목에 사용. 사망위로금은 별도 별지4.'},
  {program:'g11740.gov24-324000000106',form:'ordin-20804835',format:'hwpx',title:'입학축하금 신청서',instructions:'파일 중 별지4 입학축하금 신청서만 사용합니다.'},
  {program:'g28200.gov24-353000000108',form:'ordin-22713591',format:'hwpx',title:'참전유공자 배우자수당 지급신청서',instructions:'사망한 참전유공자의 65세 이상 법률상 배우자가 남동구에 거주하며 배우자 월수당을 신청하는 경우만 사용합니다.'},
  {program:'g44250.bokjiro-WLF00002098',form:'agency-44250-36032',format:'hwp',title:'화장장려금 지원 신청서',dateText:'기관 공식 배포 · 게시일 2026-05-12'},
  {program:'g31710.gov24-373000000113',form:'agency-31710-61699-1',format:'hwp',title:'2026년 울주군 청소년 성장지원금 신청서 및 위임장',dateText:'기관 공식 배포 · 게시일 2026-01-13',instructions:'붙임2 위임장은 공고가 허용한 대리신청인인 경우에만 작성합니다.'},
  {program:'s30000.gov24-O00019800003',form:'ordin-22618057',format:'hwp',title:'장사시설 사용(기간연장) 신고서',instructions:'묶음 첫 부분인 별지 제1호를 작성합니다.'},
  {program:'g44270.gov24-568000000117',form:'ordin-21685387',format:'hwp',instructions:'일반 전입세대용 공통 신청서가 아닙니다.'},
  {program:'g44270.gov24-568000000117',form:'ordin-21685389',format:'hwp',instructions:'회사 대표의 확인을 받아 제출합니다.'},
  {program:'g11710.gov24-O00023700005',form:'agency-11710-park119-exclusive-application',format:'hwp',title:'전용주차구획 이용 신청서',dateText:'기관 공식 배포 · 공식배포 확인일 2026-10-19'},
  {program:'s43000.gov24-O00113600007',form:'agency-43000-cbfc-2026-youth-grant',format:'hwp',title:'2026 청년예술지원사업 교부(변경)신청서',instructions:'청구서에 인쇄된 500만원 두 칸도 실제 결정액으로 기입해야 합니다.'},
  {program:'s43000.gov24-O00113600003',form:'agency-43000-cbfc-2026-art-grant',format:'hwp',title:'2026 예술창작활동지원사업 등 교부(변경)신청서',instructions:'B유형 문학·시각예술은 개인 선정자만 해당'},
  {program:'g44210.bokjiro-WLF00006505',form:'agency-44210-health-cts2394-refund-proxy',format:'hwp',title:'산후조리도우미 본인부담금 지원 신청 위임장',dateText:'기관 공식 배포 · 공식배포 확인일 2026-10-19',instructions:'주신청서가 아닙니다.'},
  {program:'g26290.bokjiro-WLF00005693',form:'agency-26290-health-postpartum-339544',format:'hwp',title:'산후조리경비 지원 신청 위임장',dateText:'기관 공식 배포 · 공식배포 확인일 2026-10-19'},
  {program:'g26290.bokjiro-WLF00005693',form:'agency-26290-health-postpartum-339545',format:'hwp',title:'사실상 혼인 관계 당사자의 본인 진술서',instructions:'두 당사자가 작성합니다.'},
  {program:'g26290.bokjiro-WLF00005693',form:'agency-26290-health-postpartum-339546',format:'hwp',title:'사실혼 확인보증서',instructions:'대리 작성·서명은 불가합니다.'},
  {program:'g27710.gov24-O00019700004',form:'ordin-22569973',format:'hwp',instructions:'이 신청서를 모든 숙박자에게 요구하지 않습니다.'},
  {program:'g27710.gov24-O00019700004',form:'ordin-22569979',format:'hwp',instructions:'자연휴양림·캠핑장·전기차 등 다른 시설 감면에는 사용하지 않습니다.'},
  {program:'g30200.gov24-367000000117',form:'ordin-22377331',format:'hwp',instructions:'장수축하금이나 매월 참전명예수당 신청용이 아닙니다.'},
]) test(`real ${sample.form} ${sample.format} downloads with original bytes @mobile`,async({page})=>{
  await page.goto(`/p/${sample.program}`);
  if(sample.municipality){
    const panel=page.getByTestId('application-forms');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('status')).toHaveCount(0);
    const chooser=panel.getByLabel('신청할 시·군');
    if(await chooser.count()) await chooser.selectOption({label:sample.municipality});
  }
  const button=page.getByTestId('application-forms').locator(`a[download][href="${catalog.forms[sample.form].file!.hwp}"]`);
  await expect(button).toContainText(sample.format.toUpperCase());
  await expect(button).toHaveAttribute('href',catalog.forms[sample.form].file!.hwp);
  if(sample.title) await expect(button).toHaveAttribute('download',sample.title+'.'+sample.format);
  if(sample.municipality) await expect(page.getByTestId('application-forms').getByText(sample.municipality+' 방문 접수용',{exact:true})).toBeVisible();
  if(sample.instructions) await expect(page.getByTestId('application-forms')).toContainText(sample.instructions);
  if(sample.dateText) await expect(page.getByTestId('application-forms')).toContainText(sample.dateText);
  if(sample.form.startsWith('agency-')){
    const row=button.locator('xpath=ancestor::li[1]');
    await expect(row.getByRole('link',{name:'공식 서식 원본'})).toHaveAttribute('href',catalog.forms[sample.form].sourceUrl);
    await expect(row.getByRole('link',{name:'근거 조례 원문'})).toHaveAttribute('href',catalog.forms[sample.form].lawUrl);
    await expect(page.getByTestId('forms-portal-search')).toContainText('출처 확인일 '+catalog.forms[sample.form].fetchedAt);
  }
  if(sample.form==='agency-44250-36032'){
    await expect(page.getByTestId('application-forms').locator('a[href*="20230519UUWBM1000170035340573"]')).toHaveCount(0);
    await expect(page.getByTestId('application-forms').locator('a[href*="20250613UUWBM1503090141957978"]')).toHaveCount(1);
  }
  const [download]=await Promise.all([page.waitForEvent('download'),button.click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${sample.format}$`));
  const file=await download.path();expect(file).toBeTruthy();
  expect(createHash('sha256').update(readFileSync(file!)).digest('hex')).toBe(catalog.forms[sample.form].file!.sha256);
});

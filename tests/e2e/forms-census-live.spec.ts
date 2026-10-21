import {expect,test} from "@playwright/test";

test("종로의 이름 없는 별지는 검증한 신청서 이름과 원본으로 연결한다 @mobile",async({page})=>{
  await page.goto('/p/g11110.bokjiro-WLF00004832');
  const panel=page.getByTestId('application-forms');
  await expect(panel.getByRole('heading',{name:'입학준비금 지원신청서',exact:true}).first()).toBeVisible();
  await expect(panel.getByRole('link',{name:/한글 원본 받기/}).first()).toHaveAttribute('href',/^\/forms\/files\/ordin-17191599-/);
  await expect(panel.getByTestId('forms-investigation')).toContainText('신청 서류 원문 확인');
});

test("옹진 암환자 신청서와 군수 작성부분을 구분하고 잘못 첨부된 희귀질환 서식은 제공하지 않는다",async({page})=>{
  await page.goto('/p/g28720.bokjiro-WLF00005720');
  const panel=page.getByTestId('application-forms');
  await expect(panel.getByRole('heading',{name:'암환자 의료비 등록·지원 신청서(통합 서식)',exact:true})).toBeVisible();
  await expect(panel).toContainText('군수 작성 서류이므로 신청인이 작성하지 않음');
  await expect(panel.getByRole('link',{name:/한글 원본 받기/}).first()).toHaveAttribute('href',/^\/forms\/files\/ordin-19399661-/);
  await expect(panel.getByTestId('forms-source-attachments').getByRole('link',{name:/희귀질환/})).toHaveCount(0);
});

test("동해 구비서류가 지정한 전국 처방전은 의료인 발급서류로 보이고 주신청서 확보로 오해시키지 않는다",async({page})=>{
  await page.goto('/p/g51170.gov24-421000000630');
  const panel=page.getByTestId('application-forms');
  await expect(panel.getByRole('heading',{name:/보조기기.*처방전/}).first()).toBeVisible();
  await expect(panel).toContainText('담당의사 발급 처방전');
  await expect(panel).toContainText('주신청서와 전체 구비서류는 공식 신청 안내에서 확인해 주세요');
  await expect(panel.getByRole('link',{name:/한글 원본 받기/}).first()).toHaveAttribute('href',/^\/forms\/files\/law-18284323-/);
});

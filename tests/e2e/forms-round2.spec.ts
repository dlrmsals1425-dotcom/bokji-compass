import { expect, test } from "@playwright/test";

test("장기요양 감경은 자동 제공 안내와 별도 신청 조건을 함께 보인다 @mobile", async ({ page }) => {
  await page.goto("/p/n.gov24-135200005031");
  const section = page.getByTestId("application-forms");
  await expect(section).toContainText("본인부담금 감경신청서");
  await expect(section).toContainText("해당하는 경우");
  await expect(section).toContainText("공단이 보험료·재산 기준에 따른 감경대상 여부를 확인할 수 없어 별도 신청이 필요한 경우");
  await expect(section).toContainText("자료상 자동 제공 방식인 사업이에요");
  await expect(section.getByRole("link", { name: /한글 원본 받기/ })).toHaveCount(1);
});

test("틀니와 임플란트 서식은 각 치료별 적용 조건을 보이고 사업주 확인서는 조건부로 표시한다", async ({ page }) => {
  await page.goto("/p/n.gov24-135200000002");
  const section = page.getByTestId("application-forms");
  const denture = section.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "의료급여 틀니 대상자 등록 신청서", exact: true }) });
  const implant = section.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "의료급여 치과임플란트 대상자 등록 신청서(신규, 재등록)", exact: true }) });
  await expect(denture).toContainText("의료급여 틀니 대상자 등록을 신청하는 경우");
  await expect(implant).toContainText("의료급여 치과임플란트 대상자 등록을 신청하는 경우");
  await page.goto("/p/n.gov24-999000000008");
  const employer = section.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "(육아휴직, 육아기 근로시간 단축) 확인서", exact: true }) });
  await expect(employer).toContainText("해당하는 경우");
  await expect(employer).toContainText("최초 신청 시 필요한 사업주 작성 확인서");
});

test("자동 검색에서 놓쳤던 구리 신청서는 원문 대조 후 연결된 원본으로 보인다 @mobile", async ({ page }) => {
  await page.goto("/p/g41310.gov24-398000000114");
  const section = page.getByTestId("application-forms");
  await expect(section.getByText("신청 서류 연결 확인", { exact: true })).toBeVisible();
  await expect(section.getByRole("heading", { level: 4 }).first()).toContainText("장애인 휠체어 등 수리 신청서");
  await expect(section.getByRole("link", { name: /한글 원본 받기/ }).first()).toHaveAttribute("href", /^\/forms\/files\/ordin-/);
  await expect(section.getByTestId("forms-portal-search")).toContainText("원문과 대조해 연결했어요");
});

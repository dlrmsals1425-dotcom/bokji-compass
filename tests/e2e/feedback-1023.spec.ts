/** (2026-10-23 외부 의견: 가상 입력 18개) 수급 부정 문장 · 지운 소득이 남음 · 모순 소득 · 배우자(부부 기준) */
import { expect, test, type Page } from "@playwright/test";

const region = async (page: Page, sidoLabel = /^사는 시·도/, sggLabel = /^시·군·구/) => {
  await expect(page.locator("#sido option")).not.toHaveCount(1, { timeout: 20_000 });
  await page.getByLabel(sidoLabel).selectOption({ label: "경기도 (시범 지역)" });
  await page.getByLabel(sggLabel).selectOption({ label: "수원시" });
};

test("소득을 지우고 다시 찾으면 지난 소득이 판정에 남지 않음 @mobile", async ({ page }) => {
  await page.goto("/situation?for=self&new=1&details=1");
  await region(page);
  await page.getByLabel("나이 (만)").selectOption("30-34");
  await page.getByLabel("함께 사는 가족 (본인 포함)").selectOption("2");
  await page.getByTestId("v2-income").fill("300");
  await page.getByTestId("v2-submit").click();
  await expect(page.getByTestId("v2-chips")).toContainText("소득 월 300만원", { timeout: 20_000 });
  await page.goto("/situation?for=self&details=1");
  await expect(page.getByTestId("v2-income")).toHaveValue("300", { timeout: 20_000 });
  await page.getByTestId("v2-income").fill("");
  await page.getByTestId("v2-submit").click();
  await expect(page.getByTestId("top-picks")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("v2-chips")).toContainText("2명 가구");
  await expect(page.getByTestId("v2-chips")).not.toContainText("소득");
});

test("'수급자가 아닙니다'는 수급 아님, '소득은 없고 월 200만원'은 소득을 정하지 않고 확인 안내 @mobile", async ({ page }) => {
  await page.goto("/situation?for=self&new=1&details=1");
  await expect(page.getByTestId("v2-text")).toBeVisible({ timeout: 20_000 });
  await page.getByTestId("v2-text").fill("수원 사는 70세, 기초생활 수급자가 아닙니다. 소득은 없고 월 200만원 벌어요");
  await page.getByTestId("v2-fill").click();
  const understood = page.getByTestId("v2-understood");
  await expect(understood).toContainText("기초생활수급·차상위 아님");
  await expect(understood).toContainText("소득이 없다는 말과 금액");
  await expect(page.getByTestId("v2-income")).toHaveValue("");
});

test("부모님 두 분이 아니라 자녀와 둘이면 '배우자와 함께' 아니요 — 2명 이상일 때만 묻고, 다시 열어도 그대로 @mobile", async ({ page }) => {
  await page.goto("/situation?for=parent&new=1&details=1");
  await region(page, /^부모님이 사는 시·도/);
  await page.getByLabel("부모님 나이 (만)").selectOption("70-74");
  const spouse = page.getByRole("group", { name: /배우자분과 함께 사시나요/ });
  await page.getByLabel(/함께 사는 가족/).selectOption("1");
  await expect(spouse).toHaveCount(0);
  await page.getByLabel(/함께 사는 가족/).selectOption("2");
  await expect(spouse).toBeVisible();
  await expect(spouse).toContainText("함께 사는 자녀 소득은");
  await spouse.getByText("아니요", { exact: true }).click();
  await page.getByTestId("v2-submit").click();
  await expect(page.getByTestId("top-picks")).toBeVisible({ timeout: 20_000 });
  await page.goto("/situation?for=parent&details=1");
  await expect(page.getByRole("group", { name: /배우자분과 함께 사시나요/ }).getByRole("radio", { name: "아니요" })).toBeChecked({ timeout: 20_000 });
});

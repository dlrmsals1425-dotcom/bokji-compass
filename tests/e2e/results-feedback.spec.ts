/** (2026-10-22 소유자 화면 확인) 기초연금 받음 → 추천에서 빼기 · 한눈에 보기 금액 줄바꿈 · 예시·상담 연락처 처음부터 펼침 */
import { expect, test } from "@playwright/test";

test("홈 '가상 예시 보기'와 바닥글 '서비스 안내·상담 연락처'는 처음부터 펼쳐져 있음 @mobile", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("preset-suwon-senior")).toBeVisible();
  await expect(page.locator("footer details")).toHaveAttribute("open", "");
  await expect(page.locator("footer")).toContainText("보건복지상담센터");
});

test("부모님 기초연금 '예' → 기초연금은 추천 5개가 아니라 '이미 받고 있는 혜택'에 @mobile", async ({ page }) => {
  await page.goto("/situation?for=parent&details=1");
  await expect(page.locator("#sido option")).not.toHaveCount(1, { timeout: 20_000 });
  await page.getByLabel(/^부모님이 사는 시·도/).selectOption({ label: "경기도 (시범 지역)" });
  await page.getByLabel(/^시·군·구/).selectOption({ label: "수원시" });
  await page.getByLabel("부모님 나이 (만)").selectOption("65-69");
  await page.getByRole("group", { name: "부모님이 기초연금을 받고 계신가요?" }).getByText("예", { exact: true }).click();
  await page.getByTestId("v2-submit").click();
  await expect(page.getByTestId("top-picks")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("v2-chips")).toContainText("기초연금 받음");
  await expect(page.getByTestId("top-picks").getByRole("link", { name: "기초연금", exact: true })).toHaveCount(0);
  const recv = page.getByTestId("receiving-section");
  await expect(recv).toContainText("기초연금");
  await expect(recv.getByTestId("receiving-auto").first()).toContainText("상황 고치기");
});

test("한눈에 보기: 금액 줄이 상자 밖으로 넘치지 않음 (데스크톱 좁은 왼쪽 칸)", async ({ page }) => {
  await page.setViewportSize({ width: 2000, height: 1100 });
  await page.goto("/");
  await page.getByTestId("preset-parent-care").click();
  await expect(page.getByTestId("money-summary")).toBeVisible({ timeout: 20_000 });
  // 기초연금처럼 긴 금액 문구(화면 확인 때 넘친 그 문구)를 넣어 본다
  await page.locator(".sum-amt").first().evaluate((e) => (e.textContent = "월 최대 단독 34만 9,700원 · 부부 55만 9,520원"));
  // 흰 칸이 바깥 '한눈에 보기' 상자 오른쪽 끝을 넘지 않는다 (화면 확인 때 넘친 모양)
  const over = await page.getByTestId("money-summary").evaluate((box) => {
    const edge = box.getBoundingClientRect().right;
    return [...box.querySelectorAll(".sum-rows > li, .sum-amt")].filter((e) => e.getBoundingClientRect().right > edge + 1).length;
  });
  expect(over).toBe(0);
});

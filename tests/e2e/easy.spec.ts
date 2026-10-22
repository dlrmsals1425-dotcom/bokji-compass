/** (2026-10-21 인터뷰) 쉬운 찾기: 예/아니요로만 끝까지 → 받으실 수 있는 혜택과 신청하는 곳 · 조부모님·어르신 가족 */
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ permissions: [] });

async function pickSuwon(page: Page) {
  await expect(page.getByTestId("gq-pick")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("gq-sido").locator("option")).not.toHaveCount(1);
  await page.getByTestId("gq-sido").selectOption("41000");
  await page.getByTestId("gq-sigungu").selectOption({ label: "수원시" });
  await page.getByTestId("gq-region-ok").click();
}

test("홈 → 쉬운 찾기: 부모님, 예/아니요만 눌러 끝까지 → 쉬운 결과 → 자세한 결과 @mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("start-easy").click();
  await expect(page).toHaveURL(/\/easy$/);
  await page.getByTestId("gq-parent").click();
  await pickSuwon(page);
  const q = page.getByTestId("gq-question");
  await expect(q).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
  await expect(q).toHaveAttribute("data-easy", "1");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("만 65세 이상");
  // 보기 단추 없이 예/아니요 두 개만
  await expect(page.locator("[data-testid^=gq-a-]:not([data-testid=gq-a-unknown])")).toHaveCount(0);
  await expect(page.getByTestId("gq-yes")).toBeVisible();
  await expect(page.getByTestId("gq-no")).toBeVisible();
  const yes = await page.getByTestId("gq-yes").boundingBox();
  expect(yes!.height).toBeGreaterThanOrEqual(64);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(audit.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);

  // 나이는 '예'(65세 이상) 한 번, 나머지는 모두 '아니요'
  await page.getByTestId("gq-yes").click();
  let clicks = 1;
  for (; clicks < 60; clicks++) {
    const phase = await page.getByTestId("guided").getAttribute("data-phase");
    if (phase === "done") break;
    const before = await page.locator("#gq-h").innerText();
    await expect(page.getByTestId("gq-no")).toBeEnabled();
    await page.getByTestId("gq-no").click();
    await expect.poll(async () => (await page.getByTestId("guided").getAttribute("data-phase")) === "done" || (await page.locator("#gq-h").innerText()) !== before, { timeout: 20_000 }).toBe(true);
  }
  expect(clicks).toBeLessThanOrEqual(19);
  await expect(page.getByTestId("gq-done")).toBeVisible();
  await expect(page.getByTestId("gq-pick-age")).toBeVisible();
  await page.getByTestId("gq-results").click();
  await expect(page).toHaveURL(/\/easy\/results\?for=parent$/);
  const res = page.getByTestId("easy-results");
  await expect(res).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("property-note")).toContainText("재산");
  const n = Number(await page.getByTestId("easy-fit-count").innerText());
  if (n > 0) {
    await expect(page.getByTestId("easy-fit-card")).toHaveCount(n);
    await expect(page.getByTestId("easy-where").first()).toContainText("신청:");
  }
  await page.getByTestId("easy-more").click();
  await expect(page).toHaveURL(/\/results\?for=parent$/);
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
});

test("쉬운 찾기: '앞 질문 다시'로 나이 경계 질문을 되돌림, '잘 모르겠어요'는 그 질문을 건너뜀", async ({ page }) => {
  await page.goto("/easy");
  await page.getByTestId("gq-self").click();
  await pickSuwon(page);
  await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
  const first = await page.locator("#gq-h").innerText();
  await page.getByTestId("gq-no").click();
  await expect(page.locator("#gq-h")).not.toHaveText(first);
  await page.getByTestId("gq-easy-back").click();
  await expect(page.locator("#gq-h")).toHaveText(first);
  await page.getByTestId("gq-a-unknown").click();
  await expect(page.locator('[data-testid="gq-question"][data-dim="age"]')).toHaveCount(0, { timeout: 20_000 });
});

test("조부모님·어르신 가족: 질문은 '어르신', 결과에 '조부모님·어르신 기준' @mobile", async ({ page }) => {
  await page.goto("/ask");
  await expect(page.getByTestId("gq-elder")).toContainText("조부모님·다른 어르신 가족");
  await page.getByTestId("gq-elder").click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("어르신이 사는 지역", { timeout: 30_000 });
  await pickSuwon(page);
  await expect(page.getByTestId("gq-question")).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("어르신");
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText("부모님");
  await page.getByTestId("gq-now").click();
  await expect(page).toHaveURL(/\/results\?for=parent$/);
  await expect(page.getByTestId("parent-results-banner")).toContainText("조부모님·어르신 기준", { timeout: 20_000 });
  // 다른 방법으로 새로 찾으면(예시) 어르신 표시는 사라진다
  await page.goto("/");
  await page.getByTestId("preset-parent-care").click();
  await expect(page.getByTestId("parent-results-banner")).toContainText("부모님 기준", { timeout: 20_000 });
  await expect(page.getByTestId("parent-results-banner")).not.toContainText("어르신");
});

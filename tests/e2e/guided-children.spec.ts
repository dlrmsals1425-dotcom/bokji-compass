/** (2026-10-16 회의) 질문 따라 찾기 자녀 질문: 임신 중 + 자녀 나이 모두 고르기 + 태어난 자녀 수
 *  (2026-10-20 jinwoo) 자녀·출산 상황을 먼저 묻고, 자녀가 있을 때만 나이를 묻는다 — 임신은 그 답을 따른다 */
import { expect, test } from "@playwright/test";

test.use({ geolocation: { latitude: 37.2636, longitude: 127.0286 }, permissions: ["geolocation"] });

test("자녀 있고 출산 예정 → 아이 1명(2~5세), 끝 화면 요약에 둘 다 @mobile", async ({ page }) => {
  await page.goto("/ask");
  await page.getByTestId("gq-self").click();
  await page.getByTestId("gq-here").click({ timeout: 30_000 });
  const q = page.getByTestId("gq-question");
  await expect(q).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
  await page.getByTestId("gq-a-30-34").click();
  await expect(page.locator('[data-testid="gq-question"][data-dim="age"]')).toHaveCount(0, { timeout: 20_000 });

  let found = false;
  for (let i = 0; i < 16 && !found; i++) {
    const phase = await page.getByTestId("guided").getAttribute("data-phase");
    if (phase === "done") {
      await page.getByTestId("gq-more").click();
      continue;
    }
    if (phase === "rare") {
      await page.getByTestId("gq-rare-skip").click();
      continue;
    }
    const dim = await q.getAttribute("data-dim");
    if (dim === "children") {
      found = true;
      break;
    }
    if (dim === "family") {
      await page.getByTestId("gq-a-both").click();
      await expect(page.locator('[data-testid="gq-question"][data-dim="family"]')).toHaveCount(0, { timeout: 20_000 });
      continue;
    }
    await expect(page.getByTestId("gq-a-unknown")).toBeEnabled();
    await page.getByTestId("gq-a-unknown").click();
    await expect(page.locator(`[data-testid="gq-question"][data-dim="${dim}"]`)).toHaveCount(0, { timeout: 20_000 });
  }
  expect(found, "자녀 질문이 나와야 함").toBe(true);

  await expect(page.getByTestId("gq-step")).toContainText("· 자녀");
  await expect(page.getByTestId("gq-child-ok")).toBeDisabled();
  await expect(page.getByTestId("gq-child-pregnant")).toHaveCount(0);
  await page.getByTestId("gq-child-2-5").check();
  // 태어난 자녀가 있으면 몇 명인지 골라야 다음
  await expect(page.getByTestId("gq-child-ok")).toBeDisabled();
  await page.getByTestId("gq-child-count-1").click();
  await expect(page.getByTestId("gq-child-count-1")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("gq-child-ok").click();
  await expect(page.locator('[data-testid="gq-question"][data-dim="children"]')).toHaveCount(0, { timeout: 20_000 });

  for (let i = 0; i < 16; i++) {
    const phase = await page.getByTestId("guided").getAttribute("data-phase");
    if (phase === "done") break;
    if (phase === "rare") {
      await page.getByTestId("gq-rare-skip").click();
      await expect(page.getByTestId("guided")).toHaveAttribute("data-phase", "done", { timeout: 20_000 });
      break;
    }
    const dim = await q.getAttribute("data-dim");
    await expect(page.getByTestId("gq-a-unknown")).toBeEnabled();
    await page.getByTestId("gq-a-unknown").click();
    await expect(page.locator(`[data-testid="gq-question"][data-dim="${dim}"]`)).toHaveCount(0, { timeout: 20_000 });
  }
  await expect(page.getByTestId("gq-pick-family")).toContainText("출산 예정");
  await expect(page.getByTestId("gq-pick-children")).toContainText("2~5세 · 자녀 1명");
});

test("두 나이대를 고르면 '1명'은 고를 수 없다", async ({ page }) => {
  await page.goto("/ask");
  await page.getByTestId("gq-self").click();
  await page.getByTestId("gq-here").click({ timeout: 30_000 });
  const q = page.getByTestId("gq-question");
  await expect(q).toHaveAttribute("data-dim", "age", { timeout: 30_000 });
  await page.getByTestId("gq-a-30-34").click();
  await expect(page.locator('[data-testid="gq-question"][data-dim="age"]')).toHaveCount(0, { timeout: 20_000 });
  for (let i = 0; i < 16; i++) {
    const phase = await page.getByTestId("guided").getAttribute("data-phase");
    if (phase === "done") {
      await page.getByTestId("gq-more").click();
      continue;
    }
    if (phase === "rare") {
      await page.getByTestId("gq-rare-skip").click();
      continue;
    }
    const dim = await q.getAttribute("data-dim");
    if (dim === "children") break;
    if (dim === "family") {
      await page.getByTestId("gq-a-children").click();
      await expect(page.locator('[data-testid="gq-question"][data-dim="family"]')).toHaveCount(0, { timeout: 20_000 });
      continue;
    }
    await expect(page.getByTestId("gq-a-unknown")).toBeEnabled();
    await page.getByTestId("gq-a-unknown").click();
    await expect(page.locator(`[data-testid="gq-question"][data-dim="${dim}"]`)).toHaveCount(0, { timeout: 20_000 });
  }
  await page.getByTestId("gq-child-0-1").check();
  await page.getByTestId("gq-child-6-12").check();
  await expect(page.getByTestId("gq-child-count-1")).toBeDisabled();
  await expect(page.getByTestId("gq-child-count-2")).toBeEnabled();
});

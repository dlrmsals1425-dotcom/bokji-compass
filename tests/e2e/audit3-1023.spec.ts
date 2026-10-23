/** (2026-10-23 외부 3차 점검) 탭·목록 개수 · 검색 같은 제도 묶기 · 문의처 번호 안내 · 존댓말 · 바닥글 검색 · 상세 위쪽 담기 */
import { expect, test } from "@playwright/test";

test("결과: 분류 개수(탭)와 목록 개수가 맞아 보임 — 추천 혜택으로 올라간 것은 목록 제목에 함께 적음 @mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preset-suwon-senior").click();
  await expect(page.getByTestId("top-picks")).toBeVisible({ timeout: 30_000 });
  for (const [tab, sec] of [["v2-n-fit", "v2-fit"], ["v2-n-office", "v2-office"], ["v2-n-ask", "v2-ask"]] as const) {
    const n = Number((await page.getByTestId(tab).locator(".n").textContent())!.replace(/,/g, ""));
    const box = page.getByTestId(sec);
    if (!(await box.count())) continue;
    const head = (await box.locator("h2, summary").first().textContent()) ?? "";
    const listed = Number(/([\d,]+)개/.exec(head)![1].replace(/,/g, ""));
    const above = Number(/위 ‘추천 혜택’에 (\d+)개 더/.exec(head)?.[1] ?? 0);
    expect(listed + above, `${tab}: ${head}`).toBe(n);
  }
});

test("검색: 정부24·복지로가 따로 안내한 같은 제도는 한 카드로 (햇살론일반)", async ({ page }) => {
  await page.goto("/search?q=" + encodeURIComponent("햇살론"));
  await expect(page.getByTestId("program-card").first()).toBeVisible({ timeout: 30_000 });
  const names = await page.getByTestId("program-card").locator("h3").allTextContents();
  expect(names.filter((n) => n.trim() === "햇살론일반")).toHaveLength(1);
  const card = page.getByTestId("program-card").filter({ has: page.locator("h3", { hasText: /^햇살론일반$/ }) });
  await expect(card.getByTestId("variants-toggle")).toContainText("같은 사업의 다른 안내 1개");
});

test("상세: 원문 문의처의 '보건복지상담센터 ☎ 139' 옆에 129 안내, 존댓말", async ({ page }) => {
  await page.goto("/p/" + encodeURIComponent("n.gov24-135200005034"));
  await expect(page.getByTestId("contact-note")).toContainText("보건복지상담센터 번호는 129예요. 원문에는 139번으로 적혀 있어요.", { timeout: 30_000 });
  await expect(page.getByText("궁금하시면 보건복지상담센터(☎129)에 물어보세요")).toBeVisible();
  await expect(page.getByText("잘 모르겠으면")).toHaveCount(0);
  await expect(page.locator(".rule-note")).not.toContainText("○");
});

test("홈 바닥글에 '서비스 검색' @mobile", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "서비스 검색" })).toBeVisible();
});

test("상세: 제목 아래에도 신청 서류 모음 담기·빼기 @mobile", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("preset-suwon-senior").click();
  const picks = page.getByTestId("top-picks");
  await expect(picks.getByTestId("pick").first()).toBeVisible({ timeout: 30_000 });
  await picks.getByTestId("pick").first().locator("h3 a").click();
  const top = page.getByTestId("detail-sheet-top");
  await expect(top.getByTestId("detail-sheet-toggle")).toHaveText("빼기", { timeout: 20_000 });
  await top.getByTestId("detail-sheet-toggle").click();
  await expect(page.getByTestId("detail-sheet-toggle")).toHaveText([/신청 서류 모음에 담기/, /신청 서류 모음에 담기/]);
});

import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { FormsCoverage, FormsRegionBundle, FormsCatalog } from "../../src/lib/data/forms";
const coverage: FormsCoverage = JSON.parse(readFileSync("public/forms/v1/coverage.json", "utf8"));
const goyang: FormsRegionBundle = JSON.parse(readFileSync("public/forms/v1/programs/g41280.json", "utf8"));
const catalog: FormsCatalog = JSON.parse(readFileSync("public/forms/v1/catalog.json", "utf8"));
const seniorId = "g41280.gov24-394000000111";

test("confirmed application exposes exact original and real PDF preview @mobile", async ({ page, request }) => {
  await page.goto(`/p/${seniorId}`);
  const section = page.getByTestId("application-forms");
  await expect(section.getByText("신청 서류 연결 확인", { exact: true })).toBeVisible();
  const hwp = section.getByRole("link", { name: /한글 원본 받기/ });
  const pdf = section.getByRole("link", { name: /서식 보기·인쇄/ });
  const form = catalog.forms["ordin-19969911"];
  await expect(hwp).toHaveAttribute("href", form.file!.hwp);
  await expect(pdf).toHaveAttribute("href", form.file!.pdf!);
  const source = await request.get(form.file!.hwp);
  expect(source.status()).toBe(200);
  expect(createHash("sha256").update(await source.body()).digest("hex")).toBe(form.file!.sha256);
  const preview = await request.get(form.file!.pdf!);
  expect(preview.headers()["content-type"]).toContain("application/pdf");
  expect((await preview.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await expect(section).toContainText("2023-05-23");
  await expect(section).toContainText("2026-10-16");
});

test("consent is attached to its own benefit; registers never become downloads", async ({ page }) => {
  await page.goto("/p/g41280.bokjiro-WLF00004191");
  const section = page.getByTestId("application-forms");
  await expect(section.getByRole("link", { name: /한글 원본 받기/ })).toHaveCount(2);
  await expect(section).toContainText("개인정보 수집");
  await expect(section).not.toContainText("지급대장");
});

test("candidate or missing forms are explicit and never expose candidate downloads", async ({ page }) => {
  const review = goyang.programs.find(program => program.status === "review")!;
  expect(review).toBeTruthy();
  await page.goto(`/p/${review.id}`);
  let section = page.getByTestId("application-forms");
  await expect(section).toContainText("연결 검토 중");
  await expect(section.getByRole("link", { name: /한글 원본 받기|서식 보기/ })).toHaveCount(0);
  const other: FormsRegionBundle = JSON.parse(readFileSync("public/forms/v1/programs/g41110.json", "utf8"));
  const missing = other.programs.find(program => program.status === "missing" && (!program.investigation || program.investigation.state === "needs_source"))!;
  await page.goto(`/p/${missing.id}`);
  section = page.getByTestId("application-forms");
  await expect(section).toContainText("아직 연결을 확인한 신청서가 없어요");
  await expect(section.getByRole("link", { name: /한글 원본 받기/ })).toHaveCount(0);
});

test("source online route is separate from a confirmed application file", async ({ page }) => {
  const online = goyang.programs.find(program => program.status === "online")!;
  expect(online).toBeTruthy();
  await page.goto(`/p/${online.id}`);
  const section = page.getByTestId("application-forms");
  await expect(section).toContainText("온라인 신청 안내");
  await expect(section.getByRole("link", { name: /공식 신청 안내 열기/ })).toHaveAttribute("href", online.applyUrl!);
  await expect(section.getByRole("link", { name: /한글 원본 받기/ })).toHaveCount(0);
});

test("coverage filters agree with rows and region switching cannot retain Goyang downloads @mobile", async ({ page }) => {
  await page.goto("/forms");
  await expect(page.getByRole("heading", { name: `수록된 사업 자료 ${coverage.totalPrograms.toLocaleString("ko-KR")}건의 연결 상태` })).toBeVisible();
  await page.getByLabel("연결 상태", { exact: true }).selectOption("available");
  await expect(page.getByTestId("forms-results").locator(":scope > li")).toHaveCount(goyang.region.counts.available);
  await page.getByLabel("혜택 이름 검색").fill("장수");
  await expect(page.getByTestId("forms-results").locator(":scope > li")).toHaveCount(1);
  await page.getByLabel("혜택 이름 검색").fill("");
  await page.getByLabel("찾을 지역").selectOption("g41110");
  const suwon:FormsRegionBundle=JSON.parse(readFileSync("public/forms/v1/programs/g41110.json","utf8"));
  if (!suwon.region.counts.available) await expect(page.getByText("현재 검색 조건에 맞는 자료가 없어요.", { exact: false })).toBeVisible();
  await expect(page.getByTestId("forms-results").locator(":scope > li")).toHaveCount(Math.min(20,suwon.region.counts.available));
  for (const href of await page.getByTestId("forms-results").locator('a[href^="/p/"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')!))) expect(href).toMatch(/^\/p\/g41110\./);
  await page.getByLabel("연결 상태", { exact: true }).selectOption("all");
  await expect(page.getByTestId("forms-results").locator(":scope > li")).toHaveCount(20);
});

test("failed form metadata can retry without erasing the benefit page", async ({ page }) => {
  let fail = true;
  await page.route(/\/forms\/v1\/catalog(?:\/[0-9a-f]{2})?\.json$/, route => fail ? route.fulfill({ status: 503, body: "offline" }) : route.continue());
  await page.goto(`/p/${seniorId}`);
  const section = page.getByTestId("application-forms");
  await expect(section).toContainText("불러오지 못했어요");
  fail = false;
  await section.getByRole("button", { name: "다시 확인하기" }).click();
  await expect(section.getByRole("link", { name: /한글 원본 받기/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("장수축하금");
});

test("new forms views keep large-text accessibility and static-only public requests @mobile", async ({ page }) => {
  const requests: { url: string; body: string | null }[] = [];
  page.on("request", request => { if (request.url().includes("/forms/")) requests.push({ url: request.url(), body: request.postData() }); });
  await page.goto("/forms");
  await page.getByLabel("연결 상태", { exact: true }).selectOption("available");
  await expect(page.getByTestId("forms-results").locator(":scope > li")).toHaveCount(goyang.region.counts.available);
  await page.getByTestId("large-text").click();
  for (const route of ["/forms", `/p/${seniorId}`]) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveTitle(/복지나침반/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations).toEqual([]);
  }
  for (const request of requests) { expect(new URL(request.url).search).toBe(""); expect(request.body).toBeNull(); }
});

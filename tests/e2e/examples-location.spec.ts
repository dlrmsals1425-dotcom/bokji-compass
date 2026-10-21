/** (2026-10-16 소유자) 홈 '예시 상황으로 먼저 보기'는 처음부터 내 위치 기준 — 누르지 않아도, 다음 방문에는 위치를 다시 묻지 않고 기억한 지역으로 */
import { expect, test } from "@playwright/test";

test.describe("예시는 내 위치 기준", () => {
  test.use({ geolocation: { latitude: 37.2411, longitude: 127.1776 }, permissions: ["geolocation"] });
  test("예시 칸이 보이면 단추를 누르지 않아도 현재 위치(용인) 예시로, 다시 열면 기억한 지역으로 @mobile", async ({ page, context }) => {
    await page.goto("/");
    await page.getByText("가상 예시 보기", { exact: true }).click();
    await page.getByTestId("preset-locate").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("locate-status")).toContainText("경기 용인시 기준", { timeout: 30_000 });
    await expect(page.getByTestId("preset-fit")).toHaveCount(5);
    // 기기에만 시·군·구 코드 저장 (좌표·주소에는 없음)
    expect(await page.evaluate(() => localStorage.getItem("bn.exampleRegion.v1"))).toBe("41460");
    expect(page.url()).not.toMatch(/41460|용인|lat|lng/);
    // 위치 권한을 거둬도 다음 방문에는 기억한 지역
    await context.clearPermissions();
    await page.reload();
    await page.getByText("가상 예시 보기", { exact: true }).click();
    await page.getByTestId("preset-locate").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("locate-status")).toContainText("경기 용인시 기준", { timeout: 30_000 });
    // '처음 예시로'를 누르면 잊는다
    await page.getByTestId("locate-reset").click();
    expect(await page.evaluate(() => localStorage.getItem("bn.exampleRegion.v1"))).toBeNull();
    await expect(page.getByTestId("preset-fit")).toHaveCount(0);
  });
});

test.describe("위치를 쓸 수 없을 때", () => {
  test.use({ permissions: [] });
  test("경기도 예시 그대로 + 지역 직접 고르기 (고른 지역도 기억)", async ({ page }) => {
    await page.goto("/");
    await page.getByText("가상 예시 보기", { exact: true }).click();
    await page.getByTestId("preset-locate").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("locate-status")).toContainText("지역을 직접 선택", { timeout: 20_000 });
    await expect(page.getByTestId("preset-suwon-senior")).toBeVisible();
    await page.locator("#pp-sido").selectOption("11000");
    await page.getByTestId("locate-sigungu").selectOption({ label: "광진구" });
    await expect(page.getByTestId("locate-status")).toContainText("서울 광진구 기준", { timeout: 30_000 });
    expect(await page.evaluate(() => localStorage.getItem("bn.exampleRegion.v1"))).toBe("11215");
  });
});

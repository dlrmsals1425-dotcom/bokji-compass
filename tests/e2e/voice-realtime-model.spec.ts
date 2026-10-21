import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

// Opt-in, billable integration. Use the project synthetic fixture, not personal audio.
const fixture = process.env.STT_TEST_WAV;
test.use({
  permissions: ["microphone"],
  launchOptions: { args: fixture ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-audio-capture=${resolve(fixture)}`] : [] },
});
test("합성 한국어 음성이 완료 전 실시간으로 표시되고 바로 결과로 이동", async ({ page }) => {
  test.skip(!fixture, "STT_TEST_WAV is opt-in.");
  test.setTimeout(90_000);
  await page.goto("/situation");
  await page.getByTestId("live-start").click();
  await expect(page.getByTestId("live-stop")).toBeEnabled({ timeout: 30_000 });
  const partial = page.getByTestId("live-transcript");
  await expect(partial).toContainText("수원", { timeout: 30_000 });
  await expect(partial).toContainText("월세", { timeout: 20_000 });
  await expect(partial).toContainText("일자리", { timeout: 20_000 });
  await expect(page).toHaveURL(/situation/);
  await page.screenshot({ path: "logs/voice-live-synthetic.png" });
  await page.getByTestId("live-stop").click();
  await expect(page).toHaveURL(/results.*quick=1/, { timeout: 25_000 });
  await expect(page.getByTestId("v2-chips")).toContainText("수원");
  await expect(page.getByTestId("v2-followup")).toHaveCount(0);
});

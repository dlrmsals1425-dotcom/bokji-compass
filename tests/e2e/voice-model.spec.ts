import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

// Opt-in real browser encoder → Next gateway → OpenAI integration (billable).
// Supply a synthetic Korean WAV containing 수원 / 일자리 / 월세, never private audio.
const fixture = process.env.STT_TEST_WAV;
test.use({
  permissions: ["microphone"],
  launchOptions: { args: fixture ? [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=${resolve(fixture)}`,
  ] : [] },
});

function wavDuration(path: string) {
  const data = readFileSync(path);
  let bytesPerSecond = 0;
  for (let offset = 12; offset + 8 <= data.length;) {
    const name = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    if (name === "fmt ") bytesPerSecond = data.readUInt32LE(offset + 16);
    if (name === "data" && bytesPerSecond) return size / bytesPerSecond * 1000;
    offset += 8 + size + (size % 2);
  }
  throw new Error("Expected a PCM WAV fixture");
}

test("실제 MediaRecorder와 OpenAI 모델로 합성 한국어 음성 변환", async ({ page }) => {
  test.skip(!fixture, "Set STT_TEST_WAV and configure OPENAI_API_KEY on the web server.");
  test.setTimeout(150_000);
  const duration = wavDuration(fixture!);
  expect(duration).toBeLessThan(55_000);
  await page.goto("/situation?for=self&new=1&details=1");
  await page.getByTestId("voice-consent").check();
  await page.getByTestId("voice-start").click();
  await expect(page.getByTestId("voice-stop")).toBeEnabled();
  // Let the fake audio device play the entire WAV, including its silent pause.
  await page.waitForTimeout(duration + 250);
  await expect(page.getByTestId("voice-stop")).toBeEnabled();
  await page.getByTestId("voice-stop").click();
  const draft = page.getByTestId("voice-transcript");
  await expect(draft).toBeVisible({ timeout: 120_000 });
  for (const word of ["수원", "일자리", "월세"]) expect(await draft.inputValue()).toContain(word);
  await expect(page.getByTestId("v2-text")).toHaveValue("");
  await page.getByTestId("voice-confirm").click();
  await expect(page.getByTestId("v2-text")).toHaveValue(/수원/);
  await expect(page.getByTestId("v2-understood")).toHaveCount(0);
});

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3218);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL, headless: true, locale: "ko-KR", timezoneId: "Asia/Seoul", trace: "retain-on-failure", channel: process.env.E2E_BROWSER_CHANNEL === "chrome" ? "chrome" : undefined },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } }, grep: /@mobile/ },
  ],
  // 빌드된 앱을 직접 띄운다 (npm run build 선행). E2E_BASE_URL 을 주면 기존 서버 사용.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: `env -i PATH="$PATH" HOME="$HOME" npx next start -p ${PORT}`, url: baseURL, reuseExistingServer: true, timeout: 60_000 },
});

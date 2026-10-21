import { expect, test, type Page } from "@playwright/test";

// Fake microphone/MediaRecorder + intercepted HTTP; real model checked separately.
type Snapshot = { starts: number; stops: number; trackStops: number };
type VoiceWindow = Window & { __voiceMock: {
  snapshots: () => Snapshot[]; deny: boolean; late: (index: number) => void;
} };
type ApiControl = { text: string; status: number; health: number; uploads: number; hold?: Promise<void> };

async function openSituation(page: Page, supported = true): Promise<ApiControl> {
  await page.addInitScript(({ enabled }) => {
    const records: FakeRecorder[] = [];
    class FakeRecorder {
      static isTypeSupported() { return true; }
      state = "inactive";
      mimeType = "audio/webm;codecs=opus";
      starts = 0; stops = 0;
      onstart: (() => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      capturedStop: (() => void) | null = null;
      capturedError: (() => void) | null = null;
      constructor(public stream: { trackStops: number }) { records.push(this); }
      start() {
        this.starts++; this.state = "recording";
        this.capturedStop = this.onstop; this.capturedError = this.onerror;
        queueMicrotask(() => this.onstart?.());
      }
      stop() {
        this.stops++; this.state = "inactive";
        queueMicrotask(() => {
          this.ondataavailable?.({ data: new Blob(["synthetic audio"], { type: this.mimeType }) });
          this.onstop?.();
        });
      }
    }
    const mock = {
      snapshots: () => records.map((r) => ({ starts: r.starts, stops: r.stops, trackStops: r.stream.trackStops })),
      deny: false,
      late: (index: number) => { records[index]?.capturedStop?.(); records[index]?.capturedError?.(); },
    };
    Object.defineProperty(window, "__voiceMock", { configurable: true, value: mock });
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: enabled ? FakeRecorder : undefined });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: async () => {
        if (mock.deny) throw new DOMException("synthetic denial", "NotAllowedError");
        const stream = { trackStops: 0, getTracks: () => [{ stop: () => { stream.trackStops++; } }] };
        return stream;
      },
    } });
  }, { enabled: supported });
  const api: ApiControl = { text: "수원시에 살고 있어요.", status: 200, health: 200, uploads: 0 };
  await page.route("**/api/voice/transcribe", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: api.health, json: { available: api.health === 200 } }); return;
    }
    api.uploads++;
    await api.hold;
    await route.fulfill({ status: api.status, json: api.status === 200 ? { text: api.text } : { error: "test_error" } });
  });
  await page.goto("/situation?for=self&new=1");
  await expect(page.getByTestId("v2-text")).toBeVisible();
  await expect(page.getByTestId("voice-choice")).toBeVisible();
  return api;
}
const snapshots = (page: Page) => page.evaluate(() => (window as unknown as VoiceWindow).__voiceMock.snapshots());
const late = (page: Page, index: number) => page.evaluate((index) => (window as unknown as VoiceWindow).__voiceMock.late(index), index);
async function startVoice(page: Page) {
  const index = (await snapshots(page)).length;
  await page.getByTestId("voice-consent").check();
  await page.getByTestId("voice-start").click();
  await expect(page.getByTestId("voice-stop")).toBeEnabled();
  expect((await snapshots(page))[index].starts).toBe(1);
  return index;
}
async function finishVoice(page: Page, api: ApiControl, text: string) {
  api.text = text;
  await page.getByTestId("voice-stop").click();
  await expect(page.getByTestId("voice-transcript")).toHaveValue(text);
}
async function noProposal(page: Page) { await expect(page.getByTestId("voice-confirm")).toHaveCount(0); }

test.describe("jinwoo 녹음 후 OpenAI STT API", () => {
  test("쉬었다 말해도 60초까지 녹음하고 완료 때 한 번만 전송 @mobile", async ({ page }) => {
    const api = await openSituation(page);
    await page.clock.install();
    const index = await startVoice(page);
    await page.clock.fastForward(15_000);
    expect(api.uploads).toBe(0);
    expect((await snapshots(page))[index].stops).toBe(0);
    await expect(page.getByTestId("voice-stop")).toBeEnabled();
    await noProposal(page);
    await finishVoice(page, api, "수원시에 살고 있어요. 일자리를 찾고 있어요.");
    expect(api.uploads).toBe(1);
    expect((await snapshots(page))[index].trackStops).toBe(1);
    await expect(page.getByTestId("v2-text")).toHaveValue("");
  });
  test("60초 제한에서도 녹음한 내용을 변환하고 자동 제출하지 않음", async ({ page }) => {
    const api = await openSituation(page);
    await page.clock.install();
    await startVoice(page);
    await page.clock.fastForward(60_000);
    await expect(page.getByTestId("voice-transcript")).toHaveValue(api.text);
    expect(api.uploads).toBe(1);
    await expect(page.getByTestId("v2-text")).toHaveValue("");
  });
  test("동의·시작·문장 확인 후 입력칸에만 반영 @mobile", async ({ page }) => {
    const api = await openSituation(page);
    expect(await snapshots(page)).toHaveLength(0);
    await expect(page.getByTestId("voice-start")).toBeDisabled();
    await page.getByTestId("voice-consent").check();
    expect(await snapshots(page)).toHaveLength(0);
    await startVoice(page);
    const ageBefore = await page.locator("#age").inputValue();
    await finishVoice(page, api, "수원시에 사는 만 35세입니다.");
    await expect(page.getByTestId("v2-text")).toHaveValue("");
    await page.getByTestId("voice-transcript").fill("수원시에 사는 만 36세입니다.");
    await page.getByTestId("voice-confirm").click();
    await expect(page.getByTestId("v2-text")).toHaveValue("수원시에 사는 만 36세입니다.");
    await expect(page.locator("#age")).toHaveValue(ageBefore);
    await expect(page.getByTestId("v2-understood")).toHaveCount(0);
    await expect(page).toHaveURL(/\/situation\?for=self&new=1$/);
  });
  test("기존 문장 뒤 한 번만 추가하고 늦은 이벤트는 무시 @mobile", async ({ page }) => {
    const api = await openSituation(page);
    await page.getByTestId("v2-text").fill("기존 문장");
    const index = await startVoice(page);
    await finishVoice(page, api, "추가 문장");
    await page.getByTestId("voice-confirm").evaluate((element) => {
      (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click();
    });
    await late(page, index);
    await expect(page.getByTestId("v2-text")).toHaveValue("기존 문장 추가 문장");
    expect(api.uploads).toBe(1);
    await noProposal(page);
  });
  test("미지원 환경에서도 직접 입력과 문장 해석 가능", async ({ page }) => {
    await openSituation(page, false);
    await expect(page.getByTestId("voice-status")).toContainText("지원하지");
    await page.getByTestId("v2-text").fill("수원시에 사는 만 35세입니다.");
    await page.getByTestId("v2-fill").click();
    await expect(page.getByTestId("v2-understood")).toBeVisible();
    expect(await snapshots(page)).toHaveLength(0);
  });
  test("서버가 준비되지 않으면 마이크를 열지 않음", async ({ page }) => {
    const api = await openSituation(page); api.health = 503;
    await page.getByTestId("voice-consent").check();
    await page.getByTestId("voice-start").click();
    await expect(page.getByTestId("voice-status")).toContainText("서버에 연결할 수 없");
    expect(await snapshots(page)).toHaveLength(0);
  });
  test("마이크 권한 거절 후 기존 입력 보존", async ({ page }) => {
    await openSituation(page);
    await page.getByTestId("v2-text").fill("보존할 문장");
    await page.evaluate(() => { (window as unknown as VoiceWindow).__voiceMock.deny = true; });
    await page.getByTestId("voice-consent").check();
    await page.getByTestId("voice-start").click();
    await expect(page.getByTestId("voice-status")).toContainText("허용되지");
    await expect(page.getByTestId("v2-text")).toHaveValue("보존할 문장");
  });
  for (const action of ["cancel", "revoke", "typing", "mode", "fill", "hidden", "navigate"] as const) {
    test(`${action}: 녹음과 마이크를 종료하고 늦은 이벤트 폐기`, async ({ page }) => {
      const api = await openSituation(page);
      await page.getByTestId("v2-text").fill("수원시에 사는 만 35세입니다.");
      const index = await startVoice(page);
      if (action === "cancel") await page.getByTestId("voice-cancel").click();
      if (action === "revoke") await page.getByTestId("voice-consent").uncheck();
      if (action === "typing") await page.getByTestId("v2-text").fill("직접 고친 문장");
      if (action === "mode") await page.getByTestId("mode-parent").click();
      if (action === "fill") await page.getByTestId("v2-fill").click();
      if (action === "hidden") await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, value: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      if (action === "navigate") await page.locator(".crumbs a").first().click();
      await expect.poll(async () => (await snapshots(page))[index].trackStops).toBe(1);
      await late(page, index);
      await noProposal(page);
      expect(api.uploads).toBe(0);
      if (action === "navigate") await expect(page).toHaveURL(/\/$/);
      else if (action === "typing") await expect(page.getByTestId("v2-text")).toHaveValue("직접 고친 문장");
      else if (action !== "mode") await expect(page.getByTestId("v2-text")).toHaveValue("수원시에 사는 만 35세입니다.");
    });
  }
  test("변환 중 취소 후 늦은 HTTP 응답은 버림 @mobile", async ({ page }) => {
    const api = await openSituation(page);
    let release!: () => void;
    api.hold = new Promise((resolve) => { release = resolve; });
    await startVoice(page);
    await page.getByTestId("voice-stop").click();
    await expect.poll(() => api.uploads).toBe(1);
    await expect(page.getByTestId("voice-status")).toContainText("글로 바꾸고");
    await page.getByTestId("voice-cancel").click();
    release();
    await noProposal(page);
    await expect(page.getByTestId("v2-text")).toHaveValue("");
  });
  test("확인 전 직접 수정하면 이전 초안을 폐기하고 다시 녹음 가능", async ({ page }) => {
    const api = await openSituation(page);
    const old = await startVoice(page);
    await finishVoice(page, api, "첫 번째 초안");
    await page.getByTestId("v2-text").fill("직접 고친 문장");
    await noProposal(page);
    await startVoice(page);
    await finishVoice(page, api, "두 번째 초안");
    await late(page, old);
    await expect(page.getByTestId("voice-transcript")).toHaveValue("두 번째 초안");
  });
  test("무음과 서버 혼잡 오류에서 기존 입력 유지", async ({ page }) => {
    const api = await openSituation(page);
    await page.getByTestId("v2-text").fill("기존 문장");
    for (const status of [422, 429]) {
      api.status = status;
      await startVoice(page);
      await page.getByTestId("voice-stop").click();
      await expect(page.getByTestId("voice-status")).toContainText(status === 422 ? "인식할 음성이 없" : "이용 한도");
      await noProposal(page);
      await expect(page.getByTestId("v2-text")).toHaveValue("기존 문장");
    }
  });
  test("500자 넘는 발화나 합산 문장을 자동으로 자르지 않음", async ({ page }) => {
    const api = await openSituation(page);
    api.text = "가".repeat(501);
    await startVoice(page); await page.getByTestId("voice-stop").click();
    await expect(page.getByTestId("voice-status")).toContainText("500자");
    await noProposal(page);
    await page.getByTestId("v2-text").fill("나".repeat(490));
    await startVoice(page); await finishVoice(page, api, "다".repeat(20));
    await expect(page.getByTestId("voice-confirm")).toBeDisabled();
    await expect(page.getByTestId("voice-choice")).toContainText("500");
    await expect(page.getByTestId("v2-text")).toHaveValue("나".repeat(490));
  });
});

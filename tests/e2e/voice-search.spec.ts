import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function setup(page: Page, deny = false) {
  await page.addInitScript(({ deny }) => {
    const stats = { stops: 0, closed: 0, commits: 0, text: "수원시에 살고 월세 지원이 필요해요.", emit: (event: object) => { void event; } };
    Object.assign(window, { __live: stats });
    const track = { enabled: true, onended: null, stop: () => { stats.stops++; } };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => {
      if (deny) throw new DOMException("test", "NotAllowedError");
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    } } });
    class Peer {
      connectionState = "connected";
      onconnectionstatechange = null;
      channel = { readyState: "connecting", onopen: null as null | (() => void), onmessage: null as null | ((e: { data: string }) => void), onerror: null, onclose: null,
        close() { this.readyState = "closed"; },
        send(data: string) {
          if (JSON.parse(data).type !== "input_audio_buffer.commit") return;
          stats.commits++;
          stats.emit({ type: "input_audio_buffer.committed", item_id: "i1", previous_item_id: null });
          stats.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "i1", content_index: 0, transcript: stats.text });
        },
      };
      addTrack() {}
      createDataChannel() { stats.emit = (event) => this.channel.onmessage?.({ data: JSON.stringify(event) }); return this.channel; }
      async createOffer() { return { type: "offer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" }; }
      async setLocalDescription() {}
      async setRemoteDescription() { this.channel.readyState = "open"; this.channel.onopen?.(); }
      close() { stats.closed++; }
    }
    Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: Peer });
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition(_ok: unknown, fail: (e: object) => void) { fail({ code: 1 }); } } });
  }, { deny });
  await page.route("**/api/voice/realtime", (route) => route.fulfill(route.request().method() === "GET" ? { json: { available: true } } : { contentType: "application/sdp", body: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" }));
  await page.goto("/situation");
}

type MockWindow = Window & { __live: { stops: number; closed: number; commits: number; text: string; emit(event: object): void } };
const stats = (page: Page) => page.evaluate(() => { const { stops, closed, commits } = (window as unknown as MockWindow).__live; return { stops, closed, commits }; });
async function emit(page: Page, event: object) { await page.evaluate((event) => (window as unknown as MockWindow).__live.emit(event), event); }

test("한 번 시작 → 실시간 글 표시 → 완료 → 결과, 추가 질문은 선택한 뒤만 @mobile", async ({ page }) => {
  await setup(page);
  await expect(page.getByTestId("v2-situation")).toHaveCount(0);
  await expect(page.getByTestId("voice-consent")).toHaveCount(0);
  await page.getByTestId("live-start").click();
  await expect(page.getByTestId("live-stop")).toBeEnabled();
  await emit(page, { type: "conversation.item.input_audio_transcription.delta", item_id: "i1", content_index: 0, delta: "수원시에 살고" });
  await expect(page.getByTestId("live-transcript")).toContainText("수원시에 살고");
  await expect(page).toHaveURL(/situation/);
  await page.getByTestId("live-stop").click();
  await expect(page).toHaveURL(/results\?quick=1/);
  // 지역 번들 해석과 첫 추천 계산이 끝난 뒤 문구·질문 상태를 확인한다.
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("v2-chips")).toContainText("수원");
  await expect(page.getByTestId("v2-followup")).toHaveCount(0);
  await expect(page.getByTestId("sum-next")).toHaveCount(0);
  expect(await stats(page)).toMatchObject({ stops: 1, closed: 1, commits: 1 });
  await page.getByTestId("refine-open").click();
  await expect(page.getByTestId("v2-followup")).toBeVisible();
  await expect(page.locator(".v2-qs > li")).toHaveCount(1);
  await page.locator('[data-testid^="v2-skip-"]').click();
  await expect(page.locator(".v2-qs > li")).toHaveCount(1);
  await expect(page.locator("#fq-h")).toBeFocused();
});

test("취소하면 마이크를 닫고 늦은 전사로 결과 이동하지 않음 @mobile", async ({ page }) => {
  await setup(page);
  await page.getByTestId("live-start").click();
  await expect(page.getByTestId("live-stop")).toBeEnabled();
  await page.getByTestId("live-cancel").click();
  await emit(page, { type: "conversation.item.input_audio_transcription.completed", item_id: "i1", content_index: 0, transcript: "수원시 어머니" });
  await expect(page.getByTestId("live-start")).toBeEnabled();
  await expect(page).toHaveURL(/situation/);
  expect(await stats(page)).toMatchObject({ stops: 1, closed: 1, commits: 0 });
});

test("마이크 거절은 글 입력으로, 지역 없어도 결과 먼저 @mobile", async ({ page }) => {
  await setup(page, true);
  await page.getByTestId("live-start").click();
  await expect(page.getByTestId("live-status")).toContainText("마이크 사용을 허용");
  await page.getByText("직접 적을게요", { exact: true }).click();
  await page.getByTestId("quick-text").fill("월세 지원을 찾고 있어요");
  await page.getByTestId("quick-submit").click();
  await expect(page).toHaveURL(/results\?quick=1/);
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("quick-region-note")).toContainText("전국 공통");
  await expect(page.getByTestId("quick-region")).toHaveCount(0);
  await page.getByTestId("refine-open").click();
  await expect(page.getByTestId("quick-region")).toBeVisible();
  await page.locator("#quick-sido").selectOption("41000");
  await page.locator("#quick-sigungu").selectOption("41110");
  await page.getByRole("button", { name: "이 지역으로 찾기" }).click();
  await expect(page.getByTestId("v2-chips")).toContainText("수원");
  await expect(page.getByTestId("v2-followup")).toBeVisible();
  await expect(page.locator("#fq-h")).toBeFocused();
});

test("부모님 상황이 명확하면 바로 해당 대상으로 찾고 접근성 유지 @mobile", async ({ page }) => {
  await setup(page);
  let audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
  await page.getByText("직접 적을게요", { exact: true }).click();
  await page.getByTestId("quick-text").fill("수원에 사시는 75세 어머니 혼자 살아요");
  await page.getByTestId("quick-submit").click();
  await expect(page).toHaveURL(/results\?for=parent&quick=1/);
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("v2-chips")).toContainText("75");
  await page.getByTestId("refine-open").click();
  await expect(page.getByTestId("v2-followup")).toBeVisible();
  audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? ""))).toEqual([]);
  await page.getByTestId("top-picks").locator('a[href^="/p/"]').first().click();
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.getByTestId("v2-results")).toHaveCount(0);
  await page.getByRole("banner").getByRole("link", { name: "내 결과", exact: true }).click();
  await expect(page).toHaveURL(/\/results/);
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("refine-open")).toBeVisible();
  await expect(page.getByTestId("v2-followup")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("refine-open")).toBeVisible();
  await expect(page.getByTestId("v2-followup")).toHaveCount(0);
  await page.getByTestId("edit-situation").click();
  await expect(page.getByTestId("v2-situation")).toBeVisible();
  await page.getByTestId("v2-submit").click();
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("refine-open")).toBeVisible();
  await expect(page.getByTestId("v2-followup")).toHaveCount(0);
});

for (const target of ["self", "parent"] as const) {
  test(`대상 혼합 음성은 한 번 확인한 뒤 ${target} 조건으로 검색 @mobile`, async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
      (window as unknown as MockWindow).__live.text = "어머니는 75세이고 월 소득 80만원, 저는 25세이고 월 소득 200만원이에요";
    });
    await page.getByTestId("live-start").click();
    await expect(page.getByTestId("live-stop")).toBeEnabled();
    await page.getByTestId("live-stop").click();
    await expect(page.getByTestId("quick-target")).toBeVisible();
    await expect(page.locator("#target-h")).toBeFocused();
    await expect(page).toHaveURL(/\/situation$/);
    expect(await page.evaluate(() => localStorage.getItem("bn.profile.v1"))).toBeNull();
    expect(await stats(page)).toMatchObject({ stops: 1, closed: 1 });
    await page.getByTestId(`target-${target}`).click();
    await expect(page).toHaveURL(target === "self" ? /results\?quick=1/ : /results\?for=parent&quick=1/);
    await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("v2-chips")).toContainText(target === "self" ? "25" : "75");
    await expect(page.getByTestId("v2-chips")).not.toContainText(target === "self" ? "75" : "25");
  });
}

test("대상 확인에서 말을 고치면 가족 언급만으로 부모님에 연결하지 않음 @mobile", async ({ page }) => {
  await setup(page);
  await page.getByText("직접 적을게요", { exact: true }).click();
  await page.getByTestId("quick-text").fill("부모님");
  await page.getByTestId("quick-submit").click();
  await expect(page.getByTestId("quick-target")).toBeVisible();
  await page.getByRole("button", { name: "말한 내용 고치기", exact: true }).click();
  await expect(page.getByTestId("quick-text")).toHaveValue("부모님");
  await page.getByTestId("quick-text").fill("부모님과 같이 살고 저는 25살이에요. 제 월세 지원을 찾고 싶어요");
  await page.getByTestId("quick-submit").click();
  await expect(page).toHaveURL(/results\?quick=1/);
  await expect(page.getByTestId("v2-results")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("v2-chips")).toContainText("25");
});

test("최종 전사 뒤 자료 대기 중 취소하면 늦은 검색을 저장하지 않음", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/bundles/v1/regions.json", async (route) => { await gate; await route.continue(); });
  await setup(page);
  await page.getByTestId("live-start").click();
  await expect(page.getByTestId("live-stop")).toBeEnabled();
  await page.getByTestId("live-stop").click();
  await expect(page.getByTestId("live-status")).toContainText("찾는 중");
  await page.getByTestId("live-cancel").click();
  const loaded = page.waitForResponse("**/bundles/v1/regions.json");
  release();
  await loaded;
  await expect(page.getByTestId("live-start")).toBeEnabled();
  await expect(page).toHaveURL(/situation/);
  expect(await page.evaluate(() => localStorage.getItem("bn.profile.v1"))).toBeNull();
});

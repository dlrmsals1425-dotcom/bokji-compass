import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRealtimeSession, isRealtimeSupported } from "@/lib/voice/realtime";

const sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
class FakeChannel {
  readyState = "connecting";
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = "closed"; });
  open() { this.readyState = "open"; this.onopen?.(); }
  event(event: unknown) { this.onmessage?.({ data: JSON.stringify(event) }); }
}
class FakePeer {
  static instances: FakePeer[] = [];
  channel = new FakeChannel();
  connectionState = "connected";
  onconnectionstatechange: (() => void) | null = null;
  addTrack = vi.fn();
  createDataChannel = vi.fn(() => this.channel);
  createOffer = vi.fn(async () => ({ type: "offer", sdp }));
  setLocalDescription = vi.fn(async () => {});
  setRemoteDescription = vi.fn(async () => {});
  close = vi.fn();
  constructor() { FakePeer.instances.push(this); }
}
const track = { enabled: true, stop: vi.fn(), onended: null as (() => void) | null };
const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
const microphone = vi.fn();
const fetchMock = vi.fn();
const callbacks = () => ({ onStart: vi.fn(), onPartial: vi.fn(), onProcessing: vi.fn(), onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const delta = (item_id: string, text: string, extra = {}) => ({ type: "conversation.item.input_audio_transcription.delta", item_id, content_index: 0, delta: text, ...extra });
const final = (item_id: string, text: string, extra = {}) => ({ type: "conversation.item.input_audio_transcription.completed", item_id, content_index: 0, transcript: text, ...extra });
const ack = (item_id: string, previous_item_id: string | null = null) => ({ type: "input_audio_buffer.committed", item_id, previous_item_id });

beforeEach(() => {
  vi.useFakeTimers();
  FakePeer.instances = [];
  track.enabled = true; track.onended = null; track.stop.mockClear();
  microphone.mockReset().mockResolvedValue(stream);
  fetchMock.mockReset().mockImplementation(async (_url, init) => init?.method === "POST" ? new Response(sdp) : Response.json({ available: true }));
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: microphone } });
  vi.stubGlobal("RTCPeerConnection", FakePeer);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function started() {
  const cb = callbacks();
  const session = createRealtimeSession(cb);
  session.start();
  await flush();
  const peer = FakePeer.instances[0];
  peer.channel.open();
  return { cb, session, peer, channel: peer.channel };
}

describe("realtime transcription session", () => {
  it("detects secure WebRTC/microphone support and is safe during SSR", () => {
    expect(isRealtimeSupported()).toBe(true);
    vi.stubGlobal("window", undefined);
    expect(isRealtimeSupported()).toBe(false);
    vi.stubGlobal("window", { isSecureContext: false });
    expect(isRealtimeSupported()).toBe(false);
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("RTCPeerConnection", undefined);
    expect(isRealtimeSupported()).toBe(false);
  });
  it("reports unsupported browsers once without acquiring audio", () => {
    vi.stubGlobal("window", undefined);
    const cb = callbacks(); const session = createRealtimeSession(cb);
    session.start(); session.start();
    expect(cb.onError).toHaveBeenCalledOnce(); expect(cb.onEnd).toHaveBeenCalledOnce();
    expect(microphone).not.toHaveBeenCalled();
  });
  it("signals only to the local gateway and enables audio only when the channel opens", async () => {
    const cb = callbacks(); const session = createRealtimeSession(cb);
    session.start(); session.start(); await flush();
    const peer = FakePeer.instances[0];
    expect(track.enabled).toBe(false); expect(cb.onStart).not.toHaveBeenCalled();
    expect(peer.createDataChannel).toHaveBeenCalledWith("oai-events");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]).toEqual(["/api/voice/realtime", expect.objectContaining({ method: "POST", body: sdp, headers: { "Content-Type": "application/sdp" } })]);
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp });
    peer.channel.open(); peer.channel.open();
    expect(track.enabled).toBe(true); expect(cb.onStart).toHaveBeenCalledOnce();
    session.cancel();
  });
  it("emits cumulative partial text and replaces it with final text only after stop+ack", async () => {
    const { cb, session, channel, peer } = await started();
    channel.event(delta("a", "수원")); channel.event(delta("a", "에 살아요"));
    expect(cb.onPartial.mock.calls.map(([text]) => text)).toEqual(["수원", "수원에 살아요"]);
    session.stop(); session.stop();
    expect(track.stop).toHaveBeenCalledOnce(); expect(cb.onProcessing).toHaveBeenCalledOnce();
    expect(channel.send).not.toHaveBeenCalled(); expect(peer.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(channel.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ type: "input_audio_buffer.commit" }));
    channel.event(final("a", "수원에 살아요."));
    expect(cb.onTranscript).not.toHaveBeenCalled();
    channel.event(ack("a"));
    expect(cb.onTranscript).toHaveBeenCalledExactlyOnceWith("수원에 살아요.");
    expect(cb.onEnd).toHaveBeenCalledOnce(); expect(peer.close).toHaveBeenCalledOnce(); expect(channel.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("drains all items in predecessor order when finals arrive out of order", async () => {
    const { cb, session, channel } = await started();
    channel.event(delta("b", "둘째")); channel.event(ack("a")); channel.event(delta("a", "첫째"));
    session.stop(); await vi.advanceTimersByTimeAsync(500);
    channel.event(ack("b", "a")); channel.event(final("b", "두 번째."));
    expect(cb.onTranscript).not.toHaveBeenCalled();
    channel.event(final("a", "첫 번째."));
    expect(cb.onTranscript).toHaveBeenCalledExactlyOnceWith("첫 번째. 두 번째.");
  });
  it("never publishes an early finalized item as the final session result", async () => {
    const { cb, session, channel } = await started();
    channel.event(ack("a")); channel.event(final("a", "이른 내용"));
    expect(cb.onTranscript).not.toHaveBeenCalled();
    session.stop(); await vi.advanceTimersByTimeAsync(500);
    channel.event(ack("a")); // duplicate prior ack cannot satisfy stop
    expect(cb.onTranscript).not.toHaveBeenCalled();
    channel.event(ack("b", "a")); channel.event(final("b", "마지막 내용"));
    expect(cb.onTranscript).toHaveBeenCalledExactlyOnceWith("이른 내용 마지막 내용");
  });
  it("waits for a referenced predecessor even before its transcription has arrived", async () => {
    const { cb, session, channel } = await started();
    session.stop(); await vi.advanceTimersByTimeAsync(500);
    channel.event(ack("b", "a")); channel.event(final("b", "뒤"));
    expect(cb.onTranscript).not.toHaveBeenCalled();
    channel.event(ack("a")); channel.event(final("a", "앞"));
    expect(cb.onTranscript).toHaveBeenCalledExactlyOnceWith("앞 뒤");
  });
  it("deduplicates event IDs and ignores stale deltas after finalization", async () => {
    const { cb, session, channel } = await started();
    channel.event(delta("a", "한 번", { event_id: "e1" })); channel.event(delta("a", "한 번", { event_id: "e1" }));
    channel.event(final("a", "확정")); channel.event(delta("a", "무시"));
    expect(cb.onPartial.mock.calls.map(([text]) => text)).toEqual(["한 번", "확정"]);
    session.stop(); await vi.advanceTimersByTimeAsync(500); channel.event(ack("a"));
    expect(cb.onTranscript).toHaveBeenCalledExactlyOnceWith("확정");
  });
  it("orders content parts and waits for every final part", async () => {
    const { cb, session, channel } = await started();
    channel.event(delta("a", "뒤", { content_index: 1 })); channel.event(delta("a", "앞", { content_index: 0 }));
    session.stop(); await vi.advanceTimersByTimeAsync(500); channel.event(ack("a"));
    channel.event(final("a", "앞", { content_index: 0 }));
    expect(cb.onTranscript).not.toHaveBeenCalled();
    channel.event(final("a", "뒤", { content_index: 1 }));
    expect(cb.onTranscript).toHaveBeenCalledWith("앞뒤");
  });
  it.each(["", "   "])("reports no speech for an empty completed transcript %j", async (text) => {
    const { cb, session, channel } = await started();
    session.stop(); await vi.advanceTimersByTimeAsync(500); channel.event(ack("a")); channel.event(final("a", text));
    expect(cb.onError).toHaveBeenCalledWith(expect.stringContaining("말소리"));
    expect(cb.onTranscript).not.toHaveBeenCalled(); expect(cb.onEnd).toHaveBeenCalledOnce();
  });
  it("sanitizes upstream error messages including empty-buffer commits", async () => {
    const { cb, session, channel } = await started();
    session.stop(); await vi.advanceTimersByTimeAsync(500);
    channel.event({ type: "error", error: { code: "input_audio_buffer_commit_empty", message: "private-token" } });
    expect(cb.onError).toHaveBeenCalledWith(expect.stringContaining("말소리"));
    expect(JSON.stringify(cb.onError.mock.calls)).not.toContain("private-token");
  });
  it("stops at 60 seconds and waits for the last confirmed transcript", async () => {
    const { cb, channel } = await started();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cb.onProcessing).toHaveBeenCalledOnce(); expect(track.stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(500); channel.event(ack("a")); channel.event(final("a", "자동 종료"));
    expect(cb.onTranscript).toHaveBeenCalledWith("자동 종료");
  });
  it("errors rather than returning unfinished partial text after final timeout", async () => {
    const { cb, session, channel, peer } = await started();
    channel.event(delta("a", "미완성")); session.stop(); await vi.advanceTimersByTimeAsync(20_000);
    expect(cb.onTranscript).not.toHaveBeenCalled(); expect(cb.onError).toHaveBeenCalledOnce();
    expect(cb.onEnd).toHaveBeenCalledOnce(); expect(peer.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("silently cancels during recording and ignores late events", async () => {
    const { cb, session, peer, channel } = await started();
    const lateHandler = channel.onmessage!;
    session.cancel(); session.cancel(); session.stop(); session.start();
    lateHandler({ data: JSON.stringify(final("a", "늦은 응답")) });
    await vi.advanceTimersByTimeAsync(100_000);
    expect(track.stop).toHaveBeenCalledOnce(); expect(peer.close).toHaveBeenCalledOnce();
    expect(cb.onTranscript).not.toHaveBeenCalled(); expect(cb.onError).not.toHaveBeenCalled(); expect(cb.onEnd).not.toHaveBeenCalled();
  });
  it("cancels final drain without sending a commit", async () => {
    const { cb, session, channel } = await started();
    session.stop(); session.cancel(); await vi.advanceTimersByTimeAsync(30_000);
    expect(channel.send).not.toHaveBeenCalled(); expect(cb.onEnd).not.toHaveBeenCalled();
  });
  it.each(["cancel", "timeout", "stop"] as const)("cleans a late microphone acquisition after %s during startup", async (action) => {
    let resolve!: (value: typeof stream) => void;
    microphone.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const cb = callbacks(); const session = createRealtimeSession(cb); session.start(); await flush();
    if (action === "cancel") session.cancel();
    else if (action === "stop") session.stop();
    else await vi.advanceTimersByTimeAsync(25_000);
    resolve(stream); await flush();
    expect(track.stop).toHaveBeenCalledOnce(); expect(FakePeer.instances).toHaveLength(0);
    expect(cb.onEnd).toHaveBeenCalledTimes(action === "cancel" ? 0 : 1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts in-flight signaling and never applies a late answer after cancellation", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementation(async (_url, init) => init?.method === "POST" ? new Promise<Response>((done) => { resolve = done; }) : Response.json({ available: true }));
    const cb = callbacks(); const session = createRealtimeSession(cb); session.start(); await flush();
    const peer = FakePeer.instances[0]; const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    session.cancel(); resolve(new Response(sdp)); await flush();
    expect(signal.aborted).toBe(true); expect(peer.setRemoteDescription).not.toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalledOnce(); expect(track.stop).toHaveBeenCalledOnce(); expect(cb.onEnd).not.toHaveBeenCalled();
  });
  it("bounds startup while the data channel never opens", async () => {
    const cb = callbacks(); const session = createRealtimeSession(cb); session.start(); await flush();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(cb.onStart).not.toHaveBeenCalled(); expect(cb.onError).toHaveBeenCalledOnce();
    expect(FakePeer.instances[0].close).toHaveBeenCalledOnce(); expect(track.stop).toHaveBeenCalledOnce();
  });
  it.each(["serverError", "invalidSdp", "rejectedAnswer"])("releases microphone and peer after signaling failure: %s", async (failure) => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementation(async (_url, init) => init?.method === "POST" ? new Promise<Response>((done) => { resolve = done; }) : Response.json({ available: true }));
    const cb = callbacks(); createRealtimeSession(cb).start(); await flush();
    const peer = FakePeer.instances[0];
    if (failure === "rejectedAnswer") peer.setRemoteDescription.mockRejectedValue(new Error("private"));
    resolve(new Response(failure === "invalidSdp" ? "invalid" : sdp, { status: failure === "serverError" ? 503 : 200 }));
    await flush();
    expect(cb.onStart).not.toHaveBeenCalled(); expect(cb.onError).toHaveBeenCalledOnce(); expect(cb.onEnd).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce(); expect(peer.close).toHaveBeenCalledOnce(); expect(peer.channel.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not acquire a microphone when the gateway is unavailable", async () => {
    fetchMock.mockResolvedValue(new Response("private", { status: 503 }));
    const cb = callbacks(); createRealtimeSession(cb).start(); await flush();
    expect(microphone).not.toHaveBeenCalled(); expect(cb.onError).toHaveBeenCalledOnce(); expect(cb.onEnd).toHaveBeenCalledOnce();
  });
  it("handles permission denial without leaking browser error details", async () => {
    microphone.mockRejectedValue(new DOMException("private", "NotAllowedError"));
    const cb = callbacks(); createRealtimeSession(cb).start(); await flush();
    expect(cb.onError).toHaveBeenCalledWith(expect.stringContaining("허용")); expect(cb.onEnd).toHaveBeenCalledOnce();
  });
  it.each(["disconnect", "channelClose", "channelError", "trackEnd", "transcriptionFailed", "malformed", "oversized"])("cleans resources on %s", async (failure) => {
    const { cb, peer, channel } = await started();
    if (failure === "disconnect") { peer.connectionState = "disconnected"; peer.onconnectionstatechange?.(); }
    if (failure === "channelClose") channel.onclose?.();
    if (failure === "channelError") channel.onerror?.();
    if (failure === "trackEnd") track.onended?.();
    if (failure === "transcriptionFailed") channel.event({ type: "conversation.item.input_audio_transcription.failed" });
    if (failure === "malformed") channel.onmessage?.({ data: "bad-json" });
    if (failure === "oversized") channel.event(delta("a", " ".repeat(10_001)));
    expect(cb.onError).toHaveBeenCalledOnce(); expect(cb.onEnd).toHaveBeenCalledOnce();
    expect(peer.close).toHaveBeenCalledOnce(); expect(track.stop).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});

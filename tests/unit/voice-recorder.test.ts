import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRecordingSession, isRecordingSupported, MAX_AUDIO_BYTES, RECORD_LIMIT_MS } from "@/lib/voice/recorder";
import type { SpeechSession } from "@/lib/voice/types";

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = () => true;
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  onstart: (() => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  constructor() { FakeRecorder.instances.push(this); }
  start = vi.fn(() => { this.state = "recording"; this.onstart?.(); });
  stop = vi.fn(() => { this.state = "inactive"; this.onstop?.(); });
  chunk(text = "audio") { this.ondataavailable?.({ data: new Blob([text], { type: this.mimeType }) }); }
}

const sessions: SpeechSession[] = [];
const trackStop = vi.fn();
const stream = { getTracks: () => [{ stop: trackStop }] };
const getUserMedia = vi.fn();
const fetchMock = vi.fn();
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function setup() {
  const callbacks = { onStart: vi.fn(), onProcessing: vi.fn(), onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() };
  const session = createRecordingSession(callbacks);
  sessions.push(session);
  return { callbacks, session };
}
async function recording() {
  const context = setup();
  context.session.start();
  await flush();
  return { ...context, recorder: FakeRecorder.instances.at(-1)! };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecorder.instances = [];
  trackStop.mockReset();
  getUserMedia.mockReset().mockResolvedValue(stream);
  fetchMock.mockReset().mockImplementation(async (_url: string, init?: RequestInit) =>
    Response.json(init?.method === "POST" ? { text: " 수원시에 살고 있어요. " } : { available: true }));
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  sessions.splice(0).forEach((session) => session.cancel());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("recording and server STT session", () => {
  it("detects support without acquiring a microphone and is safe during SSR", () => {
    expect(isRecordingSupported()).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    vi.stubGlobal("window", undefined);
    expect(isRecordingSupported()).toBe(false);
  });
  it("does not start before explicit action or restart a closed session", () => {
    const { session, callbacks } = setup();
    session.stop();
    session.cancel();
    session.start();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });
  it("checks service before microphone permission, starts once and records through pauses", async () => {
    const { session, recorder, callbacks } = await recording();
    session.start();
    recorder.chunk("first phrase");
    await vi.advanceTimersByTimeAsync(15_000);
    recorder.chunk("second phrase");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    session.stop();
    session.stop();
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await (fetchMock.mock.calls[1][1].body as Blob).text()).toBe("first phrasesecond phrase");
    expect(callbacks.onTranscript).toHaveBeenCalledExactlyOnceWith("수원시에 살고 있어요.");
    expect(callbacks.onProcessing).toHaveBeenCalledTimes(1);
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1);
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("gives the recording a full 60 seconds after permission resolves", async () => {
    let resolve!: (value: typeof stream) => void;
    getUserMedia.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { session, callbacks } = setup();
    session.start(); await flush();
    await vi.advanceTimersByTimeAsync(10_000);
    resolve(stream); await flush();
    const recorder = FakeRecorder.instances[0];
    recorder.chunk();
    await vi.advanceTimersByTimeAsync(RECORD_LIMIT_MS - 1);
    expect(recorder.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(recorder.stop).toHaveBeenCalledTimes(1);
    expect(callbacks.onTranscript).toHaveBeenCalledTimes(1);
  });
  it("closes a microphone that resolves after cancellation", async () => {
    let resolve!: (value: typeof stream) => void;
    getUserMedia.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { session, callbacks } = setup();
    session.start(); await flush();
    session.cancel(); resolve(stream); await flush();
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.instances).toHaveLength(0);
    for (const fn of Object.values(callbacks)) expect(fn).not.toHaveBeenCalled();
  });
  it("times out permission and closes a late stream without beginning a recording", async () => {
    let resolve!: (value: typeof stream) => void;
    getUserMedia.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { session, callbacks } = setup();
    session.start(); await flush();
    await vi.advanceTimersByTimeAsync(20_000);
    resolve(stream); await flush();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("준비 시간이 초과"));
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(FakeRecorder.instances).toHaveLength(0);
  });
  it("cancel aborts upload and ignores a response arriving afterwards", async () => {
    let resolve!: (value: Response) => void;
    const { session, recorder, callbacks } = await recording();
    fetchMock.mockImplementation(() => new Promise((done) => { resolve = done; }));
    recorder.chunk(); session.stop(); await flush();
    const signal = fetchMock.mock.calls[1][1].signal as AbortSignal;
    expect(trackStop).toHaveBeenCalledTimes(1);
    session.cancel(); resolve(Response.json({ text: "오래된 발화" })); await flush();
    expect(signal.aborted).toBe(true);
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onEnd).not.toHaveBeenCalled();
  });
  it("cancel while recording detaches events and never uploads saved audio", async () => {
    const { session, recorder, callbacks } = await recording();
    const lateStop = recorder.onstop!;
    const lateData = recorder.ondataavailable!;
    recorder.chunk(); session.cancel();
    lateData({ data: new Blob(["late"]) }); lateStop(); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
  });
  it("does not request a microphone when the worker is unavailable", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    const { session, callbacks } = setup(); session.start(); await flush();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("서버"));
  });
  it("reports microphone refusal without exposing the underlying error", async () => {
    getUserMedia.mockRejectedValue(new DOMException("private error", "NotAllowedError"));
    const { session, callbacks } = setup(); session.start(); await flush();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("허용되지"));
    expect(callbacks.onError.mock.calls.flat().join()).not.toContain("private error");
    expect(callbacks.onEnd).toHaveBeenCalledTimes(1);
  });
  it.each([413, 422, 429, 503, 502])("handles HTTP %i and releases the microphone", async (status) => {
    const { session, recorder, callbacks } = await recording();
    fetchMock.mockResolvedValue(new Response("private upstream error", { status }));
    recorder.chunk(); session.stop(); await flush();
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError.mock.calls.flat().join()).not.toContain("private upstream");
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalledTimes(1);
  });
  it("rejects empty audio without uploading", async () => {
    const { session, callbacks } = await recording(); session.stop(); await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("녹음된 음성이 없"));
  });
  it("rejects oversized recording chunks and stops the microphone", async () => {
    const { recorder, callbacks } = await recording();
    recorder.ondataavailable?.({ data: new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)]) });
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("용량"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(trackStop).toHaveBeenCalledTimes(1);
  });
  it("times out an upload and ignores its eventual success", async () => {
    const { session, recorder, callbacks } = await recording();
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementation(() => new Promise((done) => { resolve = done; }));
    recorder.chunk(); session.stop(); await flush();
    await vi.advanceTimersByTimeAsync(120_000);
    resolve(Response.json({ text: "too late" })); await flush();
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("변환 시간이 초과"));
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
  });
  it("reports a missing stop event and never leaves the microphone running", async () => {
    const { session, recorder, callbacks } = await recording();
    recorder.stop.mockImplementation(() => { recorder.state = "inactive"; });
    recorder.chunk(); session.stop(); await vi.advanceTimersByTimeAsync(3_000);
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("마무리하지"));
    expect(trackStop).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { text: " " }, { text: 42 }])("rejects malformed or blank server output %j", async (body) => {
    const { session, recorder, callbacks } = await recording();
    fetchMock.mockResolvedValue(Response.json(body)); recorder.chunk(); session.stop(); await flush();
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
  });
});

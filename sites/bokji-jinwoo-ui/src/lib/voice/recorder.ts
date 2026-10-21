import type { SpeechCallbacks, SpeechSession } from "./types";

export const RECORD_LIMIT_MS = 60_000;
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];

export function isRecordingSupported(): boolean {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined"
    && typeof navigator.mediaDevices?.getUserMedia === "function";
}

/** Record until explicit stop/deadline, then transcribe through our server's STT API. */
export function createRecordingSession(callbacks: SpeechCallbacks): SpeechSession {
  let state: "idle" | "starting" | "recording" | "stopping" | "transcribing" | "closed" = "idle";
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chunks: Blob[] = [];
  let bytes = 0;
  let cancelled = false;
  const controller = new AbortController();
  const live = () => state !== "closed";

  function releaseTracks() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  function release() {
    clearTimeout(timer);
    controller.abort();
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstart = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") {
        try { recorder.stop(); } catch { /* Track may already have ended. */ }
      }
    }
    releaseTracks();
    chunks = [];
  }
  function finish(result: { text: string } | { error: string }) {
    if (!live()) return;
    state = "closed";
    release();
    try {
      if ("text" in result) callbacks.onTranscript(result.text);
      else callbacks.onError(result.error);
    } finally {
      if (!cancelled) callbacks.onEnd();
    }
  }
  const fail = (error: string) => finish({ error });

  async function transcribe() {
    if (!live() || state === "transcribing") return;
    const wasStopping = state === "stopping";
    state = "transcribing";
    clearTimeout(timer);
    releaseTracks();
    if (!wasStopping) callbacks.onProcessing?.();
    if (!live()) return;
    const audio = new Blob(chunks, { type: recorder?.mimeType || chunks[0]?.type || "audio/webm" });
    chunks = [];
    if (!audio.size) return fail("녹음된 음성이 없어요. 다시 말하거나 직접 입력해 주세요.");
    timer = setTimeout(() => fail("음성 변환 시간이 초과됐어요. 다시 시도하거나 직접 입력해 주세요."), 120_000);
    try {
      const response = await fetch("/api/voice/transcribe", {
        method: "POST", body: audio, signal: controller.signal,
        headers: { "Content-Type": audio.type }, redirect: "error",
      });
      if (!live()) return;
      if (!response.ok) {
        const messages: Record<number, string> = {
          413: "녹음이 너무 길거나 커요. 60초 안으로 다시 말해 주세요.",
          422: "인식할 음성이 없거나 녹음을 읽지 못했어요. 다시 말하거나 직접 입력해 주세요.",
          429: "음성 인식 요청이 많거나 이용 한도에 도달했어요. 잠시 뒤 다시 시도하거나 직접 입력해 주세요.",
          503: "음성 인식 서버에 연결할 수 없어요. 잠시 뒤 다시 시도하거나 직접 입력해 주세요.",
        };
        return fail(messages[response.status] ?? "음성을 글로 바꾸지 못했어요. 다시 시도하거나 직접 입력해 주세요.");
      }
      const data: unknown = await response.json();
      if (!live()) return;
      if (!data || typeof data !== "object" || !("text" in data) || typeof data.text !== "string" || !data.text.trim()) {
        return fail("인식된 음성이 없어요. 다시 말하거나 직접 입력해 주세요.");
      }
      finish({ text: data.text.trim() });
    } catch {
      if (live()) fail("음성 인식 서버에 연결하지 못했어요. 다시 시도하거나 직접 입력해 주세요.");
    }
  }

  function stop() {
    if (state !== "recording" || !recorder) return;
    state = "stopping";
    clearTimeout(timer);
    callbacks.onProcessing?.();
    if (!live()) return;
    timer = setTimeout(() => fail("녹음을 마무리하지 못했어요. 다시 시도해 주세요."), 3_000);
    try {
      recorder.stop();
      releaseTracks();
    } catch { fail("녹음을 마무리하지 못했어요. 다시 시도해 주세요."); }
  }

  async function begin() {
    try {
      // Check service availability before opening a microphone.
      const health = await fetch("/api/voice/transcribe", { signal: controller.signal, cache: "no-store" });
      if (!live()) return;
      if (!health.ok) return fail("음성 인식 서버에 연결할 수 없어요. 잠시 뒤 다시 시도하거나 직접 입력해 주세요.");
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!live()) { acquired.getTracks().forEach((track) => track.stop()); return; }
      stream = acquired;
      const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 64_000 });
      recorder.ondataavailable = (event) => {
        if ((state !== "recording" && state !== "stopping") || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > MAX_AUDIO_BYTES) return fail("녹음 용량을 초과했어요. 짧게 나눠 말해 주세요.");
        chunks.push(event.data);
      };
      recorder.onstart = () => {
        if (state !== "starting") return;
        state = "recording";
        clearTimeout(timer);
        timer = setTimeout(stop, RECORD_LIMIT_MS);
        callbacks.onStart();
      };
      recorder.onstop = () => { void transcribe(); };
      recorder.onerror = () => fail("마이크 녹음이 중단됐어요. 다시 시도하거나 직접 입력해 주세요.");
      recorder.start(1_000);
    } catch (error: unknown) {
      if (!live()) return;
      const name = error instanceof Error ? error.name : "";
      fail(name === "NotAllowedError" || name === "SecurityError"
        ? "마이크 사용이 허용되지 않았어요. 권한을 확인하거나 직접 입력해 주세요."
        : "마이크 또는 음성 인식 서버를 사용할 수 없어요. 연결을 확인하거나 직접 입력해 주세요.");
    }
  }

  return {
    start() {
      if (state !== "idle") return;
      state = "starting";
      if (!isRecordingSupported()) return fail("이 브라우저는 음성 녹음을 지원하지 않아요. 직접 입력해 주세요.");
      timer = setTimeout(() => fail("마이크 준비 시간이 초과됐어요. 권한을 확인하고 다시 시도해 주세요."), 20_000);
      void begin();
    },
    stop,
    cancel() {
      cancelled = true;
      state = "closed";
      release();
    },
  };
}

import type { SpeechCallbacks, SpeechSession } from "./types";

export interface RealtimeCallbacks extends SpeechCallbacks {
  /** Entire current transcript, including finalized earlier items. */
  onPartial: (text: string) => void;
}

const START_TIMEOUT_MS = 25_000;
const RECORD_LIMIT_MS = 60_000;
const FINAL_TIMEOUT_MS = 20_000;
// RTP audio and data-channel events have separate ordering. Allow in-flight
// audio to arrive before committing; keep the peer alive until all finals arrive.
// This grace period is not a network delivery guarantee.
const AUDIO_DRAIN_MS = 500;
const MAX_TEXT_LENGTH = 10_000;
const NO_SPEECH = "말소리를 확인하지 못했어요. 다시 말씀해 주세요.";

type State = "idle" | "starting" | "recording" | "stopping" | "closed";
type Part = { text: string; final: boolean };
type Item = { previous?: string | null; committed: boolean; parts: Map<number, Part> };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRealtimeSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === true &&
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof RTCPeerConnection === "function";
}

/** Single-use session. Call cancel() on unmount; cancellation emits no callbacks. */
export function createRealtimeSession(callbacks: RealtimeCallbacks): SpeechSession {
  let state: State = "idle";
  let cancelled = false;
  let stream: MediaStream | null = null;
  let peer: RTCPeerConnection | null = null;
  let channel: RTCDataChannel | null = null;
  let controller: AbortController | null = null;
  let startTimer: ReturnType<typeof setTimeout> | undefined;
  let recordTimer: ReturnType<typeof setTimeout> | undefined;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  let finalTimer: ReturnType<typeof setTimeout> | undefined;
  let commitSent = false;
  let finalItemId: string | null = null;
  let lastPartial = "";
  const items = new Map<string, Item>();
  const events = new Set<string>();
  const isClosed = () => state === "closed";

  function stopTracks() {
    for (const track of stream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    stream = null;
  }

  function release() {
    clearTimeout(startTimer); clearTimeout(recordTimer); clearTimeout(drainTimer); clearTimeout(finalTimer);
    controller?.abort(); controller = null;
    stopTracks();
    if (channel) {
      channel.onopen = null; channel.onmessage = null; channel.onerror = null; channel.onclose = null;
      channel.close(); channel = null;
    }
    if (peer) {
      peer.onconnectionstatechange = null;
      peer.close(); peer = null;
    }
    items.clear(); events.clear(); lastPartial = "";
  }

  function finish(result: { text: string } | { error: string }) {
    if (isClosed()) return;
    state = "closed";
    release();
    if (cancelled) return;
    try {
      if ("text" in result) callbacks.onTranscript(result.text);
      else callbacks.onError(result.error);
    } finally {
      if (!cancelled) callbacks.onEnd();
    }
  }
  const fail = (message = "음성 연결이 끊겼어요. 다시 시도해 주세요.") => finish({ error: message });

  function orderedItems(): Item[] {
    const ordered: Item[] = [];
    const visited = new Set<string>();
    function visit(id: string) {
      if (visited.has(id)) return;
      visited.add(id);
      const item = items.get(id);
      if (!item) return;
      if (item.previous) visit(item.previous);
      ordered.push(item);
    }
    for (const id of items.keys()) visit(id);
    return ordered;
  }

  function textFor(item: Item) {
    return [...item.parts].sort(([a], [b]) => a - b).map(([, part]) => part.text).join("").trim();
  }

  function publish() {
    const ordered = orderedItems();
    const rawLength = ordered.reduce((total, item) => total + [...item.parts.values()].reduce((sum, part) => sum + part.text.length, 0), 0);
    const text = ordered.map(textFor).filter(Boolean).join(" ");
    if (rawLength > MAX_TEXT_LENGTH || text.length > MAX_TEXT_LENGTH) { fail("말씀하신 내용이 너무 길어요. 나누어 말씀해 주세요."); return; }
    if (text !== lastPartial) { lastPartial = text; callbacks.onPartial(text); }
    if (isClosed() || state !== "stopping" || !finalItemId) return;
    // A completed event alone is not a stop barrier. Require the commit ack,
    // every known item, and any predecessor referenced by the server.
    if (ordered.some((item) => !item.committed || !item.parts.size ||
      (item.previous && !items.has(item.previous)) || [...item.parts.values()].some((part) => !part.final))) return;
    if (text) finish({ text });
    else fail(NO_SPEECH);
  }

  function handleMessage(message: MessageEvent) {
    if (isClosed() || typeof message.data !== "string") return;
    if (message.data.length > 128 * 1024) { fail(); return; }
    let event: unknown;
    try { event = JSON.parse(message.data); } catch { fail(); return; }
    if (!record(event) || typeof event.type !== "string") { fail(); return; }
    if (typeof event.event_id === "string") {
      if (events.has(event.event_id)) return;
      if (events.size >= 4096) { fail(); return; }
      events.add(event.event_id);
    }
    if (event.type === "error" || event.type === "conversation.item.input_audio_transcription.failed") {
      const empty = record(event.error) && event.error.code === "input_audio_buffer_commit_empty";
      fail(empty ? NO_SPEECH : "음성을 글로 바꾸지 못했어요. 다시 말씀해 주세요.");
      return;
    }
    const committed = event.type === "input_audio_buffer.committed";
    const delta = event.type === "conversation.item.input_audio_transcription.delta";
    const completed = event.type === "conversation.item.input_audio_transcription.completed";
    if (!committed && !delta && !completed) return;
    if (typeof event.item_id !== "string" || !event.item_id) { fail(); return; }
    let item = items.get(event.item_id);
    if (!item) {
      if (items.size >= 128) { fail(); return; }
      item = { committed: false, parts: new Map() };
      items.set(event.item_id, item);
    }
    if (committed) {
      // Duplicate acks cannot replace the final barrier.
      if (item.committed) return;
      item.committed = true;
      if (typeof event.previous_item_id === "string" || event.previous_item_id === null) item.previous = event.previous_item_id;
      if (state === "stopping" && commitSent) finalItemId = event.item_id;
    } else {
      const index = event.content_index ?? 0;
      const text = completed ? event.transcript : event.delta;
      if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 127 || typeof text !== "string") { fail(); return; }
      const part = item.parts.get(index) ?? { text: "", final: false };
      if (part.final) return;
      part.text = completed ? text : part.text + text;
      part.final = completed;
      item.parts.set(index, part);
    }
    publish();
  }

  function stop() {
    if (state === "starting") { fail(NO_SPEECH); return; }
    if (state !== "recording") return;
    state = "stopping";
    clearTimeout(recordTimer);
    stopTracks();
    // Install timers before callbacks so cancel() inside a callback clears them.
    finalTimer = setTimeout(() => fail("말씀하신 내용을 확인하는 데 시간이 걸리고 있어요. 다시 시도해 주세요."), FINAL_TIMEOUT_MS);
    drainTimer = setTimeout(() => {
      if (state !== "stopping") return;
      try {
        if (channel?.readyState !== "open") { fail(); return; }
        commitSent = true;
        channel.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      } catch { fail(); }
    }, AUDIO_DRAIN_MS);
    callbacks.onProcessing?.();
  }

  async function begin() {
    try {
      controller = new AbortController();
      const activeController = controller;
      const availability = await fetch("/api/voice/realtime", { signal: activeController.signal, cache: "no-store" });
      if (isClosed()) return;
      if (!availability.ok) { fail("음성 입력 연결이 아직 준비되지 않았어요."); return; }
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (isClosed()) { acquired.getTracks().forEach((track) => track.stop()); return; }
      stream = acquired;
      const tracks = stream.getAudioTracks();
      if (!tracks.length) { fail("마이크를 찾지 못했어요. 연결을 확인해 주세요."); return; }
      const activePeer = new RTCPeerConnection();
      peer = activePeer;
      for (const track of tracks) {
        track.enabled = false;
        track.onended = () => fail("마이크 연결이 끊겼어요. 다시 시도해 주세요.");
        activePeer.addTrack(track, stream);
      }
      activePeer.onconnectionstatechange = () => {
        if (["failed", "disconnected", "closed"].includes(activePeer.connectionState)) fail();
      };
      const activeChannel = activePeer.createDataChannel("oai-events");
      channel = activeChannel;
      activeChannel.onmessage = handleMessage;
      activeChannel.onerror = () => fail();
      activeChannel.onclose = () => fail();
      activeChannel.onopen = () => {
        if (state !== "starting") return;
        clearTimeout(startTimer);
        state = "recording";
        tracks.forEach((track) => { track.enabled = true; });
        recordTimer = setTimeout(stop, RECORD_LIMIT_MS);
        callbacks.onStart();
      };
      const offer = await activePeer.createOffer();
      if (isClosed()) return;
      await activePeer.setLocalDescription(offer);
      if (isClosed()) return;
      if (!offer.sdp) { fail(); return; }
      const response = await fetch("/api/voice/realtime", {
        method: "POST", headers: { "Content-Type": "application/sdp" }, body: offer.sdp,
        signal: activeController.signal, cache: "no-store",
      });
      if (isClosed()) return;
      if (!response.ok) { fail("음성 연결을 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요."); return; }
      const answer = await response.text();
      if (isClosed()) return;
      if (answer.length > 64 * 1024 || !/^v=0\r?\n/.test(answer)) { fail(); return; }
      await activePeer.setRemoteDescription({ type: "answer", sdp: answer });
    } catch (cause) {
      if (isClosed()) return;
      if (cause instanceof DOMException && ["NotAllowedError", "SecurityError"].includes(cause.name)) {
        fail("마이크 사용을 허용한 뒤 다시 시도해 주세요.");
      } else { fail("마이크나 음성 연결을 시작하지 못했어요. 다시 시도해 주세요."); }
    }
  }

  return {
    start() {
      if (state !== "idle") return;
      state = "starting";
      if (!isRealtimeSupported()) { fail("이 브라우저에서는 음성 입력을 사용할 수 없어요. 글로 입력해 주세요."); return; }
      startTimer = setTimeout(() => fail("마이크 연결 시간이 초과되었어요. 다시 시도해 주세요."), START_TIMEOUT_MS);
      void begin();
    },
    stop,
    cancel() { cancelled = true; state = "closed"; release(); },
  };
}

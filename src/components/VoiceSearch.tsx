"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createRealtimeSession, isRealtimeSupported } from "@/lib/voice/realtime";
import { createRecordingSession, isRecordingSupported } from "@/lib/voice/recorder";
import type { SpeechSession } from "@/lib/voice/types";
import styles from "./VoiceSearch.module.css";

const subscribe = () => () => {};
const serverSupport = () => false;
type Props = { onComplete: (text: string) => Promise<void>; onCancel: () => void; disabled?: boolean };

export function VoiceSearch({ onComplete, onCancel, disabled = false }: Props) {
  const realtime = useSyncExternalStore(subscribe, isRealtimeSupported, serverSupport);
  const recording = useSyncExternalStore(subscribe, isRecordingSupported, serverSupport);
  const [phase, setPhase] = useState<"idle" | "starting" | "listening" | "processing" | "error">("idle");
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [fallback, setFallback] = useState(false);
  const current = useRef<SpeechSession | null>(null);
  const generation = useRef(0);
  const active = phase === "starting" || phase === "listening" || phase === "processing";

  useEffect(() => {
    const stop = () => {
      generation.current++;
      current.current?.cancel();
      current.current = null;
      onCancel();
    };
    const hidden = () => {
      if (!document.hidden) return;
      stop();
      setPhase("idle");
      setText("");
      setMessage("음성 입력을 멈췄어요. 다시 시작해 주세요.");
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", stop);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", stop);
    };
  }, [onCancel]);

  const cancel = () => {
    generation.current++;
    current.current?.cancel();
    current.current = null;
    onCancel();
    setText("");
    setPhase("idle");
    setMessage("취소했어요.");
  };
  const start = (recordOnly = false) => {
    if (active || disabled || (!realtime && !recording)) return;
    current.current?.cancel();
    const token = ++generation.current;
    let done = false;
    const valid = () => generation.current === token;
    const buffered = recordOnly || !realtime;
    setFallback(buffered);
    setText("");
    setPhase("starting");
    setMessage("마이크를 연결하고 있어요.");
    const callbacks = {
      onStart: () => {
        if (!valid() || done) return;
        setPhase("listening");
        setMessage(buffered ? "녹음 중 · 완료 후 받아써요" : "듣는 중…");
      },
      onPartial: (value: string) => { if (valid() && !done) setText(value); },
      onProcessing: () => { if (valid() && !done) { setPhase("processing"); setMessage("마지막 말을 확인하고 있어요."); } },
      onTranscript: (value: string) => {
        if (!valid() || done) return;
        done = true;
        current.current?.cancel();
        current.current = null;
        setText(value);
        if (!value.trim() || value.length > 500) {
          setPhase("error");
          setMessage(value.trim() ? "조금 짧게, 500자 안으로 말해 주세요." : "들린 말이 없어요. 다시 말해 주세요.");
          return;
        }
        setPhase("processing");
        setMessage("찾는 중…");
        void onComplete(value.trim()).catch(() => {
          if (valid()) { setPhase("error"); setMessage("찾지 못했어요. 다시 시도해 주세요."); }
        });
      },
      onError: (value: string) => {
        if (!valid() || done) return;
        done = true;
        current.current?.cancel();
        current.current = null;
        setPhase("error");
        setMessage(value);
      },
      onEnd: () => {},
    };
    current.current = buffered ? createRecordingSession(callbacks) : createRealtimeSession(callbacks);
    current.current.start();
  };

  return <section className={styles.voice} aria-label="음성으로 찾기" data-testid="voice-search">
    {(active || text) && <div className={styles.transcript} data-testid="live-transcript" role="log" aria-label="받아쓴 내용" aria-live="polite">
      {text || (phase === "starting" ? "연결 중…" : fallback ? "녹음하고 있어요…" : "말씀해 주세요…")}
    </div>}
    {!active ? <button type="button" className={`btn btn-primary ${styles.start}`} onClick={() => start()} disabled={disabled || (!realtime && !recording)} data-testid="live-start">
      <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>
      {phase === "error" ? "다시 말하기" : "음성 입력 시작"}
    </button> : <button type="button" className={`btn btn-primary ${styles.start}`} disabled={phase !== "listening"} onClick={() => current.current?.stop()} data-testid="live-stop">
      {phase === "listening" ? "말하기 완료 · 바로 찾기" : phase === "starting" ? "연결 중…" : "찾는 중…"}
    </button>}
    {active && <button type="button" className="btn-quiet" onClick={cancel} data-testid="live-cancel">취소</button>}
    <p className={styles.status} role="status" data-testid="live-status">{message || (!realtime && !recording ? "음성 입력을 지원하지 않는 브라우저예요. 아래에서 직접 적을 수 있어요." : "예: 수원에 살고, 월세 지원을 찾고 있어요.")}</p>
    {phase === "error" && !fallback && recording && <button type="button" className="btn-quiet" onClick={() => start(true)}>실시간 연결 대신 녹음해서 찾기</button>}
    <p className={styles.notice}>시작하면 음성을 OpenAI로 보내 받아써요. 최대 60초. <a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noopener noreferrer">음성 처리 안내</a></p>
  </section>;
}

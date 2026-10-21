"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createRecordingSession, isRecordingSupported } from "@/lib/voice/recorder";
import { appendVoiceTranscript, MAX_VOICE_TEXT_LENGTH } from "@/lib/voice/text";
import type { SpeechSession } from "@/lib/voice/types";
import styles from "./VoiceInput.module.css";

interface Props {
  contextKey: string;
  value: string;
  onApply: (text: string) => void;
}

const subscribe = () => () => {};
const serverSupport = () => false;

/** Typed edits or a new target discard the old recording and its pending draft. */
export function VoiceInput(props: Props) {
  return <SpeechDraft key={`${props.contextKey}:${props.value}`} {...props} />;
}

function SpeechDraft({ value, onApply }: Props) {
  const supported = useSyncExternalStore(subscribe, isRecordingSupported, serverSupport);
  const consentId = useId();
  const draftId = useId();
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<"idle" | "starting" | "listening" | "processing" | "review" | "error">("idle");
  const [message, setMessage] = useState("");
  const [transcript, setTranscript] = useState("");
  const session = useRef<SpeechSession | null>(null);
  const generation = useRef(0);
  const consumed = useRef(false);
  const terminal = useRef(false);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const active = phase === "starting" || phase === "listening" || phase === "processing";
  const proposal = appendVoiceTranscript(value, transcript);

  useEffect(() => {
    const cancelForPage = () => {
      generation.current++;
      session.current?.cancel();
      session.current = null;
      setTranscript("");
      setPhase("idle");
      setMessage("음성 입력을 취소했어요. 적어 둔 내용은 그대로예요.");
    };
    const hidden = () => { if (document.hidden) cancelForPage(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", cancelForPage);
    return () => {
      // A request counter, not a DOM ref: invalidate the latest generation on unmount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      session.current?.cancel();
      session.current = null;
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", cancelForPage);
    };
  }, []);

  useEffect(() => {
    if (phase === "review") draftRef.current?.focus();
  }, [phase]);

  const cancel = () => {
    generation.current++;
    session.current?.cancel();
    session.current = null;
    setTranscript("");
    setPhase("idle");
    setMessage("음성 입력을 취소했어요. 적어 둔 내용은 그대로예요.");
  };

  const start = () => {
    if (!supported || !consent || active || consumed.current) return;
    session.current?.cancel();
    const token = ++generation.current;
    terminal.current = false;
    setTranscript("");
    setPhase("starting");
    setMessage("마이크를 준비하고 있어요. 권한을 요청하면 허용해 주세요.");
    const current = () => generation.current === token && !consumed.current;
    const next = createRecordingSession({
      onStart: () => {
        if (!current() || terminal.current) return;
        setPhase("listening");
        setMessage("녹음하고 있어요. 쉬었다가 이어 말해도 돼요. 다 말했으면 ‘말하기 완료’를 눌러 주세요.");
      },
      onProcessing: () => {
        if (!current() || terminal.current) return;
        setPhase("processing");
        setMessage("녹음한 음성을 글로 바꾸고 있어요. 잠시 기다려 주세요.");
      },
      onTranscript: (text) => {
        if (!current() || terminal.current) return;
        terminal.current = true;
        if (!text.trim() || text.length > MAX_VOICE_TEXT_LENGTH) {
          setPhase("error");
          setMessage(text.trim() ? "인식한 문장이 너무 길어요. 500자 안으로 짧게 나눠 말해 주세요." : "음성이 들리지 않았어요. 다시 말하거나 직접 입력해 주세요.");
          return;
        }
        setTranscript(text.trim());
        setPhase("review");
        setMessage("인식한 내용을 확인하거나 고쳐 주세요. 아직 상황 입력칸에 넣지 않았어요.");
      },
      onError: (text) => {
        if (!current() || terminal.current) return;
        terminal.current = true;
        setPhase("error");
        setMessage(text);
      },
      onEnd: () => {
        if (!current() || terminal.current) return;
        terminal.current = true;
        setPhase("error");
        setMessage("인식된 음성이 없어요. 다시 말하거나 직접 입력해 주세요.");
      },
    });
    session.current = next;
    next.start();
  };

  const confirm = () => {
    if (consumed.current || phase !== "review" || !proposal.ok) return;
    consumed.current = true;
    generation.current++;
    session.current?.cancel();
    session.current = null;
    onApply(proposal.text);
  };

  return (
    <div className={styles.panel} data-testid="voice-choice" aria-label="음성으로 상황 입력">
      <p className={styles.title}>말로 입력하기</p>
      {!supported ? (
        <p className={styles.help} data-testid="voice-status" role="status">이 브라우저는 음성 입력을 지원하지 않아요. 상황 입력칸에 직접 적어 주세요.</p>
      ) : (
        <>
          <p className={styles.help}>사는 곳과 상황을 말하면 글로 바꿔 드려요. 내용을 확인한 뒤 입력칸에 넣을 수 있어요.</p>
          <p className={styles.notice}>녹음한 음성을 OpenAI로 보내 글로 바꿔요. 이 앱은 녹음 파일과 인식 문장을 따로 보관하지 않아요. 외부 음성 처리는 <a href="https://developers.openai.com/api/docs/guides/your-data" target="_blank" rel="noopener noreferrer">OpenAI 데이터 정책</a>을 따라요.</p>
          <label className={styles.consent} htmlFor={consentId}>
            <input id={consentId} type="checkbox" checked={consent} data-testid="voice-consent"
              onChange={(event) => { setConsent(event.target.checked); if (!event.target.checked) cancel(); }} />
            음성 처리 안내를 확인했고, 음성 입력을 사용할게요.
          </label>
          <div className={styles.actions}>
            {!active && <button type="button" className="btn btn-ghost" onClick={start} disabled={!consent} data-testid="voice-start">{phase === "idle" ? "음성 입력 시작" : "다시 말하기"}</button>}
            {active && <button type="button" className="btn btn-ghost" disabled={phase !== "listening"} data-testid="voice-stop"
              onClick={() => session.current?.stop()}>말하기 완료</button>}
            {(active || phase === "review" || phase === "error") && <button type="button" className="btn-quiet" onClick={cancel} data-testid="voice-cancel">취소</button>}
          </div>
          <p className={styles.status} role="status" aria-live="polite" data-testid="voice-status">{message || "시작 버튼을 눌렀을 때만 마이크를 사용해요. 완료 버튼을 누를 때까지, 한 번에 최대 60초 동안 녹음해요."}</p>
          {phase === "review" && <div className={styles.confirm}>
            <label htmlFor={draftId} className="label">인식한 내용 — 틀린 부분은 고칠 수 있어요</label>
            <textarea id={draftId} className="input" rows={3} ref={draftRef} value={transcript} data-testid="voice-transcript"
              onChange={(event) => setTranscript(event.target.value)} />
            <p className={styles.help}>{value.trim() ? "이미 적은 내용 뒤에 이어 붙여요. " : ""}입력칸에 넣은 뒤 ‘이 문장으로 아래 칸 채우기’를 눌러 주세요.</p>
            {!proposal.ok && <p className="error" role="alert">{proposal.message}</p>}
            <button type="button" className="btn btn-primary" disabled={!proposal.ok} onClick={confirm} data-testid="voice-confirm">입력칸에 넣기</button>
          </div>}
        </>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceSearch } from "@/components/VoiceSearch";
import { loadRegions } from "@/lib/client/bundles";
import { parseFindMode, resultsPath, type FindMode } from "@/lib/client/mode";
import { clearPrefill } from "@/lib/client/parse";
import { quickSituation, readQuickText, rememberQuickText } from "@/lib/client/quickSituation";
import { situationTarget } from "@/lib/client/situationTarget";
import { saveSituation } from "@/lib/client/start";
import { saveFiller } from "@/lib/client/storage";
import { SituationForm } from "./SituationForm";
import styles from "@/components/VoiceSearch.module.css";

export function SituationEntry() {
  const params = useSearchParams();
  // Existing explicit edit and home text-prefill workflows remain available.
  if (params.get("details") === "1" || params.get("prefill") === "1") return <SituationForm />;
  return <QuickEntry key={`${params.get("for")}:${params.get("edit")}`} />;
}

function QuickEntry() {
  const params = useSearchParams();
  const mode = parseFindMode(params.get("for")) ?? "self";
  const router = useRouter();
  const [text, setText] = useState(() => params.get("edit") === "1" ? readQuickText() : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pendingTarget, setPendingTarget] = useState<string | null>(null);
  const [editText, setEditText] = useState(false);
  const targetHeading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  const submitting = useRef(false);
  const generation = useRef(0);
  const cancelSearch = useCallback(() => {
    generation.current++;
    submitting.current = false;
    setBusy(false);
  }, []);
  useEffect(() => { alive.current = true; void loadRegions(); return () => { alive.current = false; }; }, []);
  useEffect(() => { if (pendingTarget) targetHeading.current?.focus(); }, [pendingTarget]);
  const search = async (value: string, chosen?: FindMode) => {
    if (submitting.current || !value.trim()) return;
    if (value.length > 500) { setError("500자 안으로 적어 주세요."); return; }
    submitting.current = true;
    const token = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const target = chosen ?? situationTarget(value, mode);
      if (!target) {
        setText(value);
        setPendingTarget(value);
        submitting.current = false;
        setBusy(false);
        return;
      }
      const regions = await loadRegions();
      if (!alive.current || generation.current !== token) return;
      const sit = quickSituation(value.trim(), regions, mode, target);
      clearPrefill();
      rememberQuickText(value.trim());
      saveSituation(sit, target, undefined, true, true);
      if (target === "parent") saveFiller("child");
      const path = resultsPath(target);
      router.push(`${path}${path.includes("?") ? "&" : "?"}quick=1`);
    } catch {
      submitting.current = false;
      setBusy(false);
      setError("잠시 후 다시 찾아 주세요.");
      throw new Error("search_failed");
    }
  };
  return <div className={styles.page} data-testid="quick-situation">
    <ol className="crumbs" aria-label="현재 위치"><li><Link href="/">홈</Link></li><li><span aria-current="page">말로 찾기</span></li></ol>
    <h1 className={styles.heading}>{mode === "parent" ? "부모님 상황을 말해 주세요" : "어떤 도움이 필요하세요?"}</h1>
    {pendingTarget ? <section className={styles.target} aria-labelledby="target-h" data-testid="quick-target">
      <h2 id="target-h" ref={targetHeading} tabIndex={-1}>누구의 복지를 찾을까요?</h2>
      <p className={styles.targetText}>{pendingTarget}</p>
      <div className={styles.targetChoices}>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { void search(pendingTarget, "self").catch(() => {}); }} data-testid="target-self">내 복지</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { void search(pendingTarget, "parent").catch(() => {}); }} data-testid="target-parent">부모님 복지</button>
      </div>
      <button type="button" className="btn-quiet" disabled={busy} onClick={() => { setPendingTarget(null); setEditText(true); setError(""); }}>말한 내용 고치기</button>
    </section> : <>
    <VoiceSearch onComplete={search} onCancel={cancelSearch} disabled={busy} />
    <details className={styles.typed} open={editText || params.get("edit") === "1" ? true : undefined}>
      <summary>직접 적을게요</summary>
      <label className="label" htmlFor="quick-text">사는 곳과 필요한 도움</label>
      <textarea id="quick-text" className="input" value={text} onChange={(event) => setText(event.target.value)} maxLength={500} disabled={busy} data-testid="quick-text" />
      <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => { void search(text).catch(() => {}); }} data-testid="quick-submit">{busy ? "찾는 중…" : "바로 찾기"}</button>
    </details>
    </>}
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}

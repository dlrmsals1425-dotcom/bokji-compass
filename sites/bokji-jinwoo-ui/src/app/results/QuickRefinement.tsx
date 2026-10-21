"use client";
import Link from "@/components/SiteLink";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CrisisHelp } from "@/components/CrisisHelp";
import { loadRegions } from "@/lib/client/bundles";
import { suggestLocation, type LocationSuggestion } from "@/lib/client/locationSuggestion";
import { readQuickText } from "@/lib/client/quickSituation";
import type { Situation } from "@/lib/client/v2";
import type { RegionIndex } from "@/lib/data/types";
import styles from "@/components/VoiceSearch.module.css";

export function QuickSearchNote({ sit }: { sit: Situation }) {
  return <>
    <CrisisHelp text={readQuickText()} />
    {!sit.profile.sigungu && <p className="notice" data-testid="quick-region-note">{sit.profile.sido ? "시·도와 전국 공통 혜택만 표시 중." : "지역 미입력 · 전국 공통 혜택만 표시 중."} ‘더 자세히 찾기’에서 지역을 추가하세요.</p>}
  </>;
}

export function QuickRefinement({ sit, onApply, children, questionKey }: { sit: Situation; onApply: (sit: Situation) => void; children: ReactNode; questionKey: string }) {
  const [open, setOpen] = useState(false);
  const [skipRegion, setSkipRegion] = useState(false);
  const questionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) questionsRef.current?.querySelector<HTMLElement>("[data-question-focus], h2")?.focus();
  }, [open, skipRegion, sit.profile, sit.x, questionKey]);
  return <section className={styles.refine} data-testid="quick-refine">
    <button type="button" className="btn btn-primary" aria-expanded={open} aria-controls="quick-questions" onClick={() => setOpen(!open)} data-testid="refine-open">{open ? "질문 접기" : "더 자세히 찾기"}</button>
    <Link href={`/situation?edit=1${sit.mode === "parent" ? "&for=parent" : ""}`} className="btn btn-quiet">말한 내용 고치기</Link>
    {open && <div id="quick-questions" ref={questionsRef}>
      {!sit.profile.sigungu && !skipRegion ? <RegionQuestion sit={sit} onApply={onApply} onSkip={() => setSkipRegion(true)} /> : children}
    </div>}
  </section>;
}

function RegionQuestion({ sit, onApply, onSkip }: { sit: Situation; onApply: (sit: Situation) => void; onSkip: () => void }) {
  const [regions, setRegions] = useState<RegionIndex | null>(null);
  const [location, setLocation] = useState<LocationSuggestion | null>(null);
  const [loading, setLoading] = useState(true);
  const [manual, setManual] = useState(false);
  const [sido, setSido] = useState(sit.profile.sido ?? "");
  const [sigungu, setSigungu] = useState("");
  const regionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (manual) regionRef.current?.querySelector<HTMLElement>("select")?.focus();
  }, [manual]);
  useEffect(() => {
    if (!manual && !loading) regionRef.current?.querySelector<HTMLElement>(!location ? "select" : "h2")?.focus();
  }, [manual, loading, location]);
  useEffect(() => {
    let alive = true;
    void loadRegions().then((value) => { if (alive) setRegions(value); });
    void suggestLocation().then((value) => { if (alive) { setLocation(value); setLoading(false); } });
    return () => { alive = false; };
  }, []);
  const apply = (sd: string, sg: string) => onApply({ ...sit, profile: { ...sit.profile, sido: sd, sigungu: sg } });
  const group = regions?.sidos.find((value) => value.code === sido);
  return <div className={styles.region} data-testid="quick-region" ref={regionRef}>
    <h2 className="h3" tabIndex={-1}>{sit.mode === "parent" ? "부모님이 사는 지역" : "사는 지역"}</h2>
    {!manual && loading ? <><p role="status">위치 확인 중…</p><button className="btn btn-ghost" onClick={() => setManual(true)}>직접 고르기</button></> : !manual && location ? <>
      <p>{location.label} · {sit.mode === "parent" ? "부모님 주소가 여기 맞나요?" : "여기 사시나요?"}</p>
      <div className="btn-row"><button className="btn btn-primary" onClick={() => apply(location.sido, location.sigungu)}>맞아요</button><button className="btn btn-ghost" onClick={() => setManual(true)}>다른 지역이에요</button></div>
    </> : <>
      <div className="select-row">
        <div><label className="label" htmlFor="quick-sido">시·도</label><select id="quick-sido" className="select" value={sido} onChange={(e) => { setSido(e.target.value); setSigungu(""); }}><option value="">선택하세요</option>{regions?.sidos.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="quick-sigungu">시·군·구</label><select id="quick-sigungu" className="select" value={sigungu} disabled={!group} onChange={(e) => setSigungu(e.target.value)}><option value="">선택하세요</option>{group?.sigungus.map((g) => <option key={g.code} value={g.code}>{g.name}</option>)}</select></div>
      </div>
      <button className="btn btn-primary" disabled={!sido || !sigungu} onClick={() => apply(sido, sigungu)}>이 지역으로 찾기</button>
    </>}
    <button className="btn btn-quiet" onClick={onSkip}>건너뛰기</button>
  </div>;
}

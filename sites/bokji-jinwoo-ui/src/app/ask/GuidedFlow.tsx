"use client";
/**
 * 누구 → 사는 곳 확인 → 나이·가구 확인 → 해당하는 후속 질문 → 드문 사항 한 번에 → 결과.
 * 한 화면에 한 질문. 판정은 이 기기에서, 답은 이 기기에만 저장하고 주소에는 싣지 않는다. 위치(좌표)는 시·군·구로만 바꾸고 버린다.
 */
import { useEffect, useRef, useState } from "react";
import Link from "@/components/SiteLink";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { loadForRegion, loadRegions } from "@/lib/client/bundles";
import { suggestLocation } from "@/lib/client/locationSuggestion";
import { FLOW_LIMIT, FLOW_DIM_BY_ID, blankSituation, flowAnswers, flowStep, nextQuestion, rareApply, rarePicks, type FlowStep, type FlowQuestionId } from "@/lib/client/guided";
import { resultsPath, type FindMode } from "@/lib/client/mode";
import { sidoOptionLabel } from "@/lib/client/regionLabel";
import { saveSituation } from "@/lib/client/start";
import { saveFiller } from "@/lib/client/storage";
import { type DimId, type Situation } from "@/lib/client/v2";
import type { Program, RegionIndex } from "@/lib/data/types";
import styles from "../finder.module.css";

type Where = { sido: string; sigungu: string; label: string };
type LocStatus = { kind: "idle" } | { kind: "busy" } | { kind: "found"; where: Where } | { kind: "error"; text: string };
/** 질문 단계 하나 (이전으로 돌아갈 때 그대로 되돌린다) */
type Snap = { sit: Situation; st: FlowStep; asked: FlowQuestionId[]; q: FlowQuestionId | null };
type Phase = "who" | "where" | "loading" | "ask" | "rare" | "done";
/** 지나온 화면 — 어느 화면(질문·드문 사항·끝)이었는지도 함께 (끝·더 답하기에서 '이전'을 누르면 질문 칸이 비던 문제) */
type Past = { snap: Snap; phase: Phase };

function whereOf(regions: RegionIndex, sigungu: string): Where | null {
  for (const s of regions.sidos) {
    const g = s.sigungus.find((x) => x.code === sigungu);
    if (g) return { sido: s.code, sigungu, label: `${s.short ?? s.name} ${g.name}` };
  }
  return null;
}

/** 무거운 계산 전에 '계산 중' 화면이 먼저 그려지게 */
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

export function GuidedFlow() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("who");
  const [mode, setMode] = useState<FindMode>("self");
  const [regions, setRegions] = useState<RegionIndex | null>(null);
  const [loc, setLoc] = useState<LocStatus>({ kind: "idle" });
  const [manual, setManual] = useState(false);
  const [pickSido, setPickSido] = useState("");
  const [pickSgg, setPickSgg] = useState("");
  const [where, setWhere] = useState<Where | null>(null);
  const [cur, setCur] = useState<Snap | null>(null);
  const [history, setHistory] = useState<Past[]>([]);
  // '질문 더 답하기'를 누르면 5개를 넘겨 정해지는 혜택이 남는 동안 계속 묻는다
  const [extra, setExtra] = useState(false);
  const [rareOn, setRareOn] = useState<DimId[]>([]);
  const [busy, setBusy] = useState(false);
  // 끝 화면의 '질문 더 답하기' — 남은 질문이 있는지는 끝 화면에 들어갈 때 한 번만 계산
  const [canMore, setCanMore] = useState(false);
  const seq = useRef(0);
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    loadRegions().then(setRegions, () => setRegions(null));
    // /ask로 바로 들어와도 대상을 고르는 동안 위치를 준비한다.
    void suggestLocation();
    return () => {
      // A request generation counter, not a DOM ref: invalidate outstanding work on unmount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      seq.current++;
    };
  }, []);
  // 화면(질문)이 바뀌면 제목으로 초점을 옮겨 화면낭독기가 새 질문부터 읽게
  useEffect(() => {
    headRef.current?.focus();
  }, [phase, cur?.q, manual, loc.kind]);

  const parent = mode === "parent";
  const locate = async (refresh = false) => {
    const my = ++seq.current;
    setManual(false);
    setLoc({ kind: "busy" });
    try {
      const w = await suggestLocation(refresh);
      if (my !== seq.current) return;
      if (!w) {
        setLoc({ kind: "error", text: "현재 위치로 지역을 확인하지 못했어요. 직접 골라 주세요." });
        setManual(true);
        return;
      }
      setLoc({ kind: "found", where: w });
    } catch {
      if (my !== seq.current) return;
      setLoc({ kind: "error", text: "현재 위치로 지역을 확인하지 못했어요. 직접 골라 주세요." });
      setManual(true);
    }
  };

  const chooseManual = () => {
    // 직접 선택으로 바꾼 뒤 도착하는 위치 응답은 화면에 반영하지 않는다.
    seq.current++;
    setLoc({ kind: "idle" });
    setManual(true);
  };

  const chooseWho = (m: FindMode) => {
    setMode(m);
    setPhase("where");
    // 두 대상 모두 GPS를 먼저 제안하고, 실제 주소지는 사용자가 확인한다.
    void locate();
  };

  const start = async (w: Where) => {
    const my = ++seq.current;
    setWhere(w);
    setPhase("loading");
    let programs: Program[];
    try {
      programs = (await loadForRegion(w.sido, w.sigungu)).programs;
    } catch {
      if (my !== seq.current) return;
      setLoc({ kind: "error", text: "이 지역 복지 정보를 불러오지 못했어요. 잠시 뒤 다시 골라 주세요." });
      setManual(true);
      setPhase("where");
      return;
    }
    await nextFrame();
    if (my !== seq.current) return;
    const sit = blankSituation(w.sido, w.sigungu, mode);
    const st = flowStep(programs, sit);
    setHistory([]);
    setExtra(false);
    setRareOn([]);
    advance({ sit, st, asked: [], q: null }, false);
  };

  /** 다음 질문을 고르고, 다 물었으면 드문 사항 → 끝 */
  const advance = (snap: Snap, more: boolean) => {
    const limitHit = !more && snap.asked.length >= FLOW_LIMIT;
    const q = limitHit ? null : (nextQuestion(snap.st, snap.sit, snap.asked)?.id ?? null);
    const next: Snap = { ...snap, q };
    setCur(next);
    if (q) setPhase("ask");
    else if (rarePicks(snap.sit).length) setPhase("rare");
    else toDone(snap);
  };

  const toDone = (snap: Pick<Snap, "sit" | "st" | "asked">) => {
    setCanMore(snap.st.counts.ask > 0 && !!nextQuestion(snap.st, snap.sit, snap.asked));
    setPhase("done");
  };

  /** 답(또는 건너뛰기)을 반영하고 다시 계산 */
  const answer = async (sit2: Situation | null) => {
    if (!cur || !cur.q || busy) return;
    setBusy(true);
    await nextFrame();
    const asked = [...cur.asked, cur.q];
    const sit = sit2 ?? cur.sit;
    const st = sit2 ? flowStep(cur.st.pool, sit, cur.st) : cur.st;
    setHistory((h) => [...h, { snap: cur, phase: "ask" }]);
    advance({ sit, st, asked, q: null }, extra);
    setBusy(false);
  };

  const back = () => {
    const prev = history[history.length - 1];
    if (!prev) {
      setPhase("where");
      return;
    }
    setHistory((h) => h.slice(0, -1));
    setCur(prev.snap);
    // 지나온 화면 그대로 — 질문이 없는 단계를 질문 화면으로 열지 않는다
    const ph = prev.phase === "ask" && !prev.snap.q ? (rarePicks(prev.snap.sit).length ? "rare" : "done") : prev.phase;
    if (ph === "done") {
      setExtra(false);
      toDone(prev.snap);
    } else setPhase(ph);
  };

  const finishRare = async (on: DimId[] | null) => {
    if (!cur || busy) return;
    setBusy(true);
    await nextFrame();
    const sit = on === null ? cur.sit : rareApply(cur.sit, on);
    const st = on === null ? cur.st : flowStep(cur.st.pool, sit, cur.st);
    setHistory((h) => [...h, { snap: cur, phase: "rare" }]);
    setCur({ sit, st, asked: cur.asked, q: null });
    toDone({ sit, st, asked: cur.asked });
    setBusy(false);
  };

  const more = () => {
    if (!cur) return;
    setExtra(true);
    const q = nextQuestion(cur.st, cur.sit, cur.asked)?.id ?? null;
    if (!q) return;
    setHistory((h) => [...h, { snap: cur, phase: "done" }]);
    setCur({ ...cur, q });
    setPhase("ask");
  };

  const showResults = () => {
    if (!cur) return;
    saveSituation(cur.sit, mode);
    if (parent) saveFiller("child");
    router.push(resultsPath(mode));
  };

  const asked = cur?.asked.length ?? 0;
  const counts = cur?.st.counts;
  const progress = phase === "who" ? 0 : phase === "where" || phase === "loading" ? 8 : phase === "done" ? 100 : phase === "rare" ? 92 : Math.min(90, 15 + (asked / FLOW_LIMIT) * 75);
  const sidoObj = regions?.sidos.find((s) => s.code === pickSido);

  return (
    <div className={`${styles.finder} ${styles.guided}`}>
      <div className="form-head">
        <div className="narrow">
          <div className={styles.routeRow}>
          <ol className="crumbs" aria-label="현재 위치">
            <li>
              <Link href="/">
                <Icon name="home" size={14} /> 홈
              </Link>
            </li>
            <li>
              <span aria-current="page">골라서 찾기</span>
            </li>
          </ol>
          </div>
          <div className="gq-bar" aria-hidden="true">
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
      <div className="form-body">
        <div className="narrow">
          <div className="form-panel gq" data-testid="guided" data-phase={phase} data-mode={mode}>
            {phase === "who" && (
              <section aria-labelledby="gq-h" className={styles.questionLayout}>
                <div className={styles.questionIntro}>
                <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
                  누구의 혜택을 찾나요?
                </h1>
                </div>
                <div className="gq-opts">
                  <button type="button" className="gq-opt" onClick={() => chooseWho("self")} data-testid="gq-self">
                    나 <Icon name="arrowRight" size={22} />
                  </button>
                  <button type="button" className="gq-opt" onClick={() => chooseWho("parent")} data-testid="gq-parent">
                    부모님 <Icon name="arrowRight" size={22} />
                  </button>
                </div>
              </section>
            )}

            {phase === "where" && (
              <section aria-labelledby="gq-h" className={styles.questionLayout}>
                <div className={styles.questionIntro}>
                <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
                  {loc.kind === "busy" ? "현재 위치를 찾고 있어요" : loc.kind === "found" && !manual ? (
                    <>{loc.where.label}<br />{parent ? "부모님 주소가 여기 맞나요?" : "여기 맞나요?"}</>
                  ) : parent ? "부모님이 사는 지역을 골라 주세요" : "사는 지역을 골라 주세요"}
                </h1>
                {loc.kind === "found" && !manual && (
                  <p className="small muted">{parent ? "부모님 주민등록상 주소를 확인해 주세요." : "주민등록상 주소를 확인해 주세요."}</p>
                )}
                </div>
                <div className={styles.questionControls}>
                {loc.kind === "busy" && (
                  <>
                    <p className="sr-only" role="status" data-testid="gq-locating">위치 확인 중…</p>
                    <button type="button" className={styles.skipAnswer} onClick={chooseManual} data-testid="gq-manual">직접 고르기</button>
                  </>
                )}
                {loc.kind === "found" && !manual && (
                  <>
                    <div className="gq-opts">
                      <button type="button" className="gq-opt gq-here" onClick={() => start(loc.where)} data-testid="gq-here">
                        여기 맞아요 <Icon name="arrowRight" size={22} />
                      </button>
                      <button type="button" className="gq-opt" onClick={chooseManual} data-testid="gq-elsewhere">
                        아니요, 다른 곳이에요
                      </button>
                    </div>
                  </>
                )}
                {loc.kind === "error" && (
                  <p className="error" role="alert" data-testid="gq-loc-error">
                    {loc.text}
                  </p>
                )}
                {manual && (
                  <div className="gq-pick" data-testid="gq-pick">
                    <div className="select-row">
                      <div>
                        <label className="hint" htmlFor="gq-sido">
                          시·도
                        </label>
                        <select
                          id="gq-sido"
                          className="select"
                          value={pickSido}
                          disabled={!regions}
                          onChange={(e) => {
                            setPickSido(e.target.value);
                            setPickSgg("");
                          }}
                          data-testid="gq-sido"
                        >
                          <option value="">시·도 고르기</option>
                          {regions?.sidos.map((s) => (
                            <option key={s.code} value={s.code}>
                              {sidoOptionLabel({ code: s.code, name: s.name })}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="hint" htmlFor="gq-sgg">
                          시·군·구
                        </label>
                        <select id="gq-sgg" className="select" value={pickSgg} disabled={!sidoObj} onChange={(e) => setPickSgg(e.target.value)} data-testid="gq-sigungu">
                          <option value="">{sidoObj ? "시·군·구 고르기" : "시·도 먼저"}</option>
                          {sidoObj?.sigungus.map((g) => (
                            <option key={g.code} value={g.code}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="btn-row" style={{ marginTop: "1rem" }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={!pickSgg || !regions}
                        onClick={() => {
                          const w = regions && whereOf(regions, pickSgg);
                          if (w) void start(w);
                        }}
                        data-testid="gq-region-ok"
                      >
                        이 지역으로 계속 <Icon name="arrowRight" size={18} />
                      </button>
                      {loc.kind !== "busy" && (
                        <button type="button" className="btn btn-ghost" onClick={() => void locate(true)} data-testid="gq-locate">
                          <Icon name="mapPin" size={18} /> 현재 위치로 다시 찾기
                        </button>
                      )}
                    </div>
                  </div>
                )}
                </div>
                <div className={styles.locationFoot}>
                <button type="button" className="btn-quiet" onClick={() => { seq.current++; setPhase("who"); }}>
                  <Icon name="arrowLeft" size={16} /> 이전
                </button>
                </div>
              </section>
            )}

            {phase === "loading" && (
              <p className="muted" role="status" data-testid="gq-loading">
                {where?.label} 혜택을 찾는 중…
              </p>
            )}

            {phase === "ask" && cur?.q && (
              <Question key={`${cur.q}-${asked}`} id={cur.q} sit={cur.sit} mode={mode} n={asked + 1} extra={extra} busy={busy} headRef={headRef} onAnswer={answer} />
            )}

            {phase === "rare" && cur && (
              <section aria-labelledby="gq-h" data-testid="gq-rare">
                <p className="gq-step">마지막 · 해당하는 것만</p>
                <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
                  {parent ? "부모님께 해당하는 것을 모두 골라 주세요" : "해당하는 것을 모두 골라 주세요"}
                </h1>
                <div className="opts gq-checks">
                  {rarePicks(cur.sit).map((r) => (
                    <label className="opt" key={r.key}>
                      <input
                        type="checkbox"
                        checked={rareOn.includes(r.key)}
                        onChange={() => setRareOn((v) => (v.includes(r.key) ? v.filter((k) => k !== r.key) : [...v, r.key]))}
                        data-testid={`gq-rare-${r.key}`}
                      />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
                <div className="btn-row" style={{ marginTop: "1.25rem" }}>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => finishRare(rareOn)} data-testid="gq-rare-ok">
                    {rareOn.length ? "다음" : "해당 없음"}
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => finishRare(null)} data-testid="gq-rare-skip">
                    건너뛰기
                  </button>
                </div>
              </section>
            )}

            {phase === "done" && cur && (
              <section aria-labelledby="gq-h" data-testid="gq-done">
                <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
                  답변을 마쳤어요
                </h1>
                <div className="btn-row">
                  <button type="button" className="btn btn-primary" onClick={showResults} data-testid="gq-results">
                    결과 보기 <Icon name="arrowRight" size={18} />
                  </button>
                  {canMore && (
                    <button type="button" className="btn btn-ghost" onClick={more} data-testid="gq-more">
                      질문 더 답하기
                    </button>
                  )}
                </div>
              </section>
            )}

            {counts && (phase === "ask" || phase === "rare" || phase === "done") && (
              <details className={styles.countDetails}>
                <summary>현재 혜택 후보 보기</summary>
                <div className="gq-counts" data-testid="gq-counts">
                  <div><span>입력 조건에 맞는 후보</span><b data-testid="gq-fit">{counts.fit}</b></div>
                  <div><span>추가 답변 필요</span><b data-testid="gq-ask">{counts.ask}</b></div>
                  <div><span>신청처 확인 필요</span><b>{counts.office}</b></div>
                </div>
              </details>
            )}

            {(phase === "ask" || phase === "rare" || phase === "done") && (
              <div className="gq-foot">
                <button type="button" className="btn-quiet" onClick={back} disabled={busy} data-testid="gq-back">
                  <Icon name="arrowLeft" size={16} /> 이전
                </button>
                {phase !== "done" && (
                  <button type="button" className="link-btn" onClick={showResults} disabled={busy} data-testid="gq-now">
                    지금 결과 보기
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Question(props: {
  id: FlowQuestionId;
  sit: Situation;
  mode: FindMode;
  n: number;
  extra: boolean;
  busy: boolean;
  headRef: React.RefObject<HTMLHeadingElement | null>;
  onAnswer: (s: Situation | null) => void;
}) {
  const { id, sit, mode, n, extra, busy, headRef, onAnswer } = props;
  const d = FLOW_DIM_BY_ID[id];
  const opts = flowAnswers(d, sit);
  return (
    <section aria-labelledby="gq-h" data-testid="gq-question" data-dim={id} className={styles.questionLayout}>
      <div className={styles.questionIntro}>
      <p className="gq-step">{extra && n > FLOW_LIMIT ? `더 답하기 · 질문 ${n}` : `질문 ${n} / ${FLOW_LIMIT}`}</p>
      <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
        {d.q(mode, sit)}
      </h1>
      {d.help && <details className={styles.questionHelp}><summary>선택 도움말</summary><p>{d.help}</p></details>}
      {id === "income" && sit.profile.householdSize !== "unknown" && (
        <p className="small muted">{sit.profile.householdSize === 6 ? "6명 이상" : `${sit.profile.householdSize}인`} 가구 · 세전 월소득 기준</p>
      )}
      </div>
      <div className={styles.questionControls}>
      <div className="gq-opts" role="group" aria-label="답">
        {opts.map((a) => (
          <button type="button" className="gq-opt" key={a.key} disabled={busy} onClick={() => onAnswer(a.apply(sit))} data-testid={`gq-a-${a.key}`}>
            {a.label}
          </button>
        ))}
      </div>
      <button type="button" className={styles.skipAnswer} disabled={busy} onClick={() => onAnswer(null)} data-testid="gq-a-unknown">건너뛰기</button>
      {busy && (
        <p className="small muted" role="status">
          반영 중…
        </p>
      )}
      </div>
    </section>
  );
}

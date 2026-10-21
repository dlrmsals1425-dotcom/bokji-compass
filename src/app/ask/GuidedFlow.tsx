"use client";
/**
 * 누구 → 사는 곳 확인 → 나이·가구 확인 → 해당하는 후속 질문 → 드문 사항 한 번에 → 결과.
 * 한 화면에 한 질문. 판정은 이 기기에서, 답은 이 기기에만 저장하고 주소에는 싣지 않는다. 위치(좌표)는 시·군·구로만 바꾸고 버린다.
 * easy (쉬운 찾기, 2026-10-21 인터뷰): 같은 질문·같은 판정을 '예/아니요'로만 나눠 묻는다 (lib/client/easy.ts).
 * '조부모님·어르신'(같은 날 인터뷰: 어머니가 100세 넘은 할머니를 모심)은 부모님 찾기와 같은 판정, 문구만 '어르신'.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "../finder.module.css";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { loadForRegion, loadRegions } from "@/lib/client/bundles";
import { suggestLocation } from "@/lib/client/locationSuggestion";
import { FLOW_LIMIT, FLOW_DIM_BY_ID, QUESTION_NAME, blankSituation, childrenApply, flowAnswers, flowStep, nextQuestion, rareApply, rarePicks, type FlowStep, type FlowQuestionId } from "@/lib/client/guided";
import { EASY_TAPS, easyNext, easyResolve } from "@/lib/client/easy";
import { elderText, resultsPath, type FindMode } from "@/lib/client/mode";
import { sidoOptionLabel } from "@/lib/client/regionLabel";
import { saveSituation } from "@/lib/client/start";
import { saveFiller, setElder, useSettings } from "@/lib/client/storage";
import { type DimId, type Situation } from "@/lib/client/v2";
import type { Program, RegionIndex } from "@/lib/data/types";
import { CHILD_BUCKETS, CHILD_LABEL, type ChildBucket } from "@/lib/engine/profile";

type Where = { sido: string; sigungu: string; label: string };
type LocStatus = { kind: "idle" } | { kind: "busy" } | { kind: "found"; where: Where } | { kind: "error"; text: string };
/** 질문 단계 하나 (이전으로 돌아갈 때 그대로 되돌린다) */
type Snap = { sit: Situation; st: FlowStep; asked: FlowQuestionId[]; q: FlowQuestionId | null; picks: Picked[]; taps: number };
/** 고른 답 (끝 화면 요약·고치기 — 2026-10-16 회의) */
type Picked = { q: FlowQuestionId | "rare"; label: string };
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

export function GuidedFlow({ easy = false }: { easy?: boolean } = {}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("who");
  const [mode, setMode] = useState<FindMode>("self");
  // 조부모님·어르신 — 판정은 부모님 찾기, 문구만 '어르신'
  const [elder, setElderPick] = useState(false);
  const say = (t: string) => (elder ? elderText(t) : t);
  // 쉬운 찾기는 누르는 횟수(EASY_TAPS)로, 골라서 찾기는 질문 수(FLOW_LIMIT)로 끊는다
  const pickNext = (st: FlowStep, sit: Situation, asked: FlowQuestionId[], tapsLeft = Infinity) =>
    easy ? easyNext(st, sit, asked, tapsLeft) : (nextQuestion(st, sit, asked)?.id ?? null);
  const overLimit = (snap: Pick<Snap, "asked" | "taps">) => (easy ? snap.taps >= EASY_TAPS : snap.asked.length >= FLOW_LIMIT);
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
  const [total, setTotal] = useState(0);
  // 끝 화면의 '질문 더 답하기' — 남은 질문이 있는지는 끝 화면에 들어갈 때 한 번만 계산
  const [canMore, setCanMore] = useState(false);
  const seq = useRef(0);
  // 키오스크(기관 태블릿)는 그 기관이 있는 시·군·구로 묻고 위치는 쓰지 않는다
  const kiosk = useSettings()?.kiosk ?? null;
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

  const chooseWho = (m: FindMode, old = false) => {
    setMode(m);
    setElderPick(old);
    setPhase("where");
    if (kiosk) {
      seq.current++;
      setManual(false);
      setLoc({ kind: "found", where: { sido: kiosk.sido, sigungu: kiosk.sigungu, label: kiosk.label } });
      return;
    }
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
    setTotal(programs.length);
    const sit = blankSituation(w.sido, w.sigungu, mode);
    const st = flowStep(programs, sit);
    setHistory([]);
    setExtra(false);
    setRareOn([]);
    advance({ sit, st, asked: [], q: null, picks: [], taps: 0 }, false);
  };

  /** 다음 질문을 고르고, 다 물었으면 드문 사항 → 끝 */
  const advance = (snap: Snap, more: boolean) => {
    const limitHit = !more && !easy && overLimit(snap);
    const q = limitHit ? null : pickNext(snap.st, snap.sit, snap.asked, more ? Infinity : EASY_TAPS - snap.taps);
    const next: Snap = { ...snap, q };
    setCur(next);
    if (q) setPhase("ask");
    // 쉬운 찾기는 드문 사항도 하나씩 물었으므로 고르기 화면 없이 끝으로
    else if (!easy && rarePicks(snap.sit).length) setPhase("rare");
    else toDone(snap);
  };

  const toDone = (snap: Pick<Snap, "sit" | "st" | "asked">) => {
    setCanMore(snap.st.counts.ask > 0 && !!pickNext(snap.st, snap.sit, snap.asked));
    setPhase("done");
  };

  /** 답(또는 건너뛰기)을 반영하고 다시 계산 */
  const answer = async (sit2: Situation | null, label: string, used = 1) => {
    if (!cur || !cur.q || busy) return;
    setBusy(true);
    await nextFrame();
    const asked = [...cur.asked, cur.q];
    const sit = sit2 ?? cur.sit;
    const st = sit2 ? flowStep(cur.st.pool, sit, cur.st) : cur.st;
    setHistory((h) => [...h, { snap: cur, phase: "ask" }]);
    advance({ sit, st, asked, q: null, picks: [...cur.picks, { q: cur.q, label }], taps: cur.taps + used }, extra);
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
    const ph = prev.phase === "ask" && !prev.snap.q ? (!easy && rarePicks(prev.snap.sit).length ? "rare" : "done") : prev.phase;
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
    const shown = rarePicks(cur.sit);
    const label = on === null ? "건너뛰기" : on.length ? shown.filter((r) => on.includes(r.key)).map((r) => r.label).join(", ") : "해당 없음";
    setHistory((h) => [...h, { snap: cur, phase: "rare" }]);
    setCur({ sit, st, asked: cur.asked, q: null, picks: [...cur.picks, { q: "rare", label }], taps: cur.taps + 1 });
    toDone({ sit, st, asked: cur.asked });
    setBusy(false);
  };

  const more = () => {
    if (!cur) return;
    setExtra(true);
    const q = pickNext(cur.st, cur.sit, cur.asked);
    if (!q) return;
    setHistory((h) => [...h, { snap: cur, phase: "done" }]);
    setCur({ ...cur, q });
    setPhase("ask");
  };

  /** 끝 화면 '고치기': 그 질문(또는 드문 사항) 화면으로 돌아가 거기서부터 다시 (뒤 질문은 새 답에 맞춰 다시 고른다) */
  const fix = (q: Picked["q"]) => {
    const i = history.findIndex((p) => (q === "rare" ? p.phase === "rare" : p.phase === "ask" && p.snap.q === q));
    if (i < 0) return;
    const past = history[i];
    setHistory(history.slice(0, i));
    setCur(past.snap);
    setExtra(overLimit(past.snap));
    setRareOn([]);
    setPhase(past.phase);
  };

  const showResults = () => {
    if (!cur) return;
    saveSituation(cur.sit, mode);
    if (parent) saveFiller(elder ? "relative" : "child");
    setElder(parent && elder);
    router.push(easy ? (parent ? "/easy/results?for=parent" : "/easy/results") : resultsPath(mode));
  };

  const asked = cur?.asked.length ?? 0;
  const counts = cur?.st.counts;
  const progress = phase === "who" ? 0 : phase === "where" || phase === "loading" ? 8 : phase === "done" ? 100 : phase === "rare" ? 92 : Math.min(90, 15 + ((easy ? (cur?.taps ?? 0) / EASY_TAPS : asked / FLOW_LIMIT)) * 75);
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
              <span aria-current="page">{easy ? "쉬운 찾기" : "골라서 찾기"}</span>
            </li>
          </ol>
          <p className="small muted" style={{ margin: 0 }}>
            답과 위치는 이 기기 안에서만 써요
          </p>
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
                  <button type="button" className="gq-opt gq-elder" onClick={() => chooseWho("parent", true)} data-testid="gq-elder">
                    <span>
                      조부모님·다른 어르신 가족
                      <small className="gq-sub">그분 기준으로 물어요</small>
                    </span>
                    <Icon name="arrowRight" size={22} />
                  </button>
                </div>
              </section>
            )}

            {phase === "where" && (
              <section aria-labelledby="gq-h" className={styles.questionLayout}>
                <div className={styles.questionIntro}>
                <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
                  {loc.kind === "busy" ? "현재 위치를 찾고 있어요" : loc.kind === "found" && !manual ? (
                    <>{loc.where.label}<br />{parent ? say("부모님 주소가 여기 맞나요?") : "여기 맞나요?"}</>
                  ) : parent ? say("부모님이 사는 지역을 골라 주세요") : "사는 지역을 골라 주세요"}
                </h1>
                {loc.kind === "found" && !manual && (
                  <p className="small muted">{parent ? say("부모님 주민등록상 주소를 확인해 주세요.") : "주민등록상 주소를 확인해 주세요."}</p>
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
                    {kiosk && (
                      <p className="small muted">
                        <Icon name="mapPin" size={16} /> 이 기관이 있는 곳이에요.
                      </p>
                    )}
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
              easy ? (
                <EasyQuestion key={`${cur.q}-${asked}`} id={cur.q} sit={cur.sit} n={asked + 1} extra={extra} busy={busy} headRef={headRef} onAnswer={answer} say={say} />
              ) : (
                <Question key={`${cur.q}-${asked}`} id={cur.q} sit={cur.sit} mode={mode} n={asked + 1} extra={extra} busy={busy} headRef={headRef} onAnswer={answer} say={say} />
              )
            )}

            {phase === "rare" && cur && (
              <section aria-labelledby="gq-h" data-testid="gq-rare">
                <p className="gq-step">마지막 · 해당하는 것만</p>
                <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
                  {parent ? say("부모님께 해당하는 것을 모두 골라 주세요") : "해당하는 것을 모두 골라 주세요"}
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
                      <span>{say(r.label)}</span>
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
                <p className="body">
                  {where?.label} 복지 {total.toLocaleString("ko-KR")}개 가운데 해당하지 않는 {cur.st.counts.no.toLocaleString("ko-KR")}개는 이유와 함께 결과 화면 맨 아래에 모아 둬요.
                  {cur.st.counts.ask > 0 && ` 아직 ${cur.st.counts.ask}개는 답에 따라 갈려요.`}
                </p>
                <p className="small muted" data-testid="gq-property-note">
                  재산(집·땅·자동차·예금)은 묻지 않았어요. 먼저 넓게 줄여 보고, 재산 기준이 있는 혜택은 신청하는 곳에서 소득과 재산을 함께 보고 정해요.
                </p>
                <div className="gq-summary" data-testid="gq-summary">
                  <h2 className="h3">내가 고른 답</h2>
                  <ul>
                    <li>
                      <span>누구</span>
                      <b>{parent ? (elder ? "조부모님·어르신" : "부모님") : "나"}</b>
                    </li>
                    <li>
                      <span>사는 곳</span>
                      <b>{where?.label}</b>
                    </li>
                    {cur.picks.map((p, i) => (
                      <li key={`${p.q}-${i}`} data-testid={`gq-pick-${p.q}`}>
                        <span>{p.q === "rare" ? "해당하는 것" : `${i + 1}. ${QUESTION_NAME[p.q]}`}</span>
                        <b>{p.label}</b>
                        <button type="button" className="link-btn" onClick={() => fix(p.q)} data-testid={`gq-fix-${p.q}`} aria-label={`${p.q === "rare" ? "해당하는 것" : QUESTION_NAME[p.q]} 답 고치기`}>
                          고치기
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
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
  onAnswer: (s: Situation | null, label: string) => void;
  say: (t: string) => string;
}) {
  const { id, sit, mode, n, extra, busy, headRef, onAnswer, say } = props;
  const d = FLOW_DIM_BY_ID[id];
  const opts = flowAnswers(d, sit);
  return (
    <section aria-labelledby="gq-h" data-testid="gq-question" data-dim={id} className={styles.questionLayout}>
      {id === "children" ? (
        <div className={styles.questionIntro}>
          <p className="gq-step" data-testid="gq-step">
            {extra && n > FLOW_LIMIT ? `더 답하기 · 질문 ${n}` : `질문 ${n} / ${FLOW_LIMIT}`} · {QUESTION_NAME[id]}
          </p>
          <ChildrenPick sit={sit} busy={busy} headRef={headRef} onAnswer={onAnswer} />
        </div>
      ) : (
        <>
          <div className={styles.questionIntro}>
            <p className="gq-step" data-testid="gq-step">
              {extra && n > FLOW_LIMIT ? `더 답하기 · 질문 ${n}` : `질문 ${n} / ${FLOW_LIMIT}`} · {QUESTION_NAME[id]}
            </p>
            <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
              {say(d.q(mode, sit))}
            </h1>
            {d.help && <details className={styles.questionHelp}><summary>선택 도움말</summary><p>{d.help}</p></details>}
            {id === "income" && sit.profile.householdSize !== "unknown" && (
              <p className="small muted">{sit.profile.householdSize === 6 ? "6명 이상" : `${sit.profile.householdSize}인`} 가구 · 세전 월소득 기준</p>
            )}
          </div>
          <div className={styles.questionControls}>
            <div className="gq-opts" role="group" aria-label="답">
              {opts.map((a) => (
                <button type="button" className="gq-opt" key={a.key} disabled={busy} onClick={() => onAnswer(a.apply(sit), a.label)} data-testid={`gq-a-${a.key}`}>
                  {a.label}
                </button>
              ))}
            </div>
            <button type="button" className={styles.skipAnswer} disabled={busy} onClick={() => onAnswer(null, "건너뛰기")} data-testid="gq-a-unknown">건너뛰기</button>
            {busy && (
              <p className="small muted" role="status">
                반영 중…
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/**
 * 쉬운 찾기 한 질문: 보기가 여럿이면 예/아니요를 여러 번 (lib/client/easy.ts). '잘 모르겠어요'는 그 질문 전체를 건너뛴다.
 * 큰 두 단추만 — 2026-10-21 인터뷰("4지선다도 아니고 2지선다로").
 */
function EasyQuestion(props: {
  id: FlowQuestionId;
  sit: Situation;
  n: number;
  extra: boolean;
  busy: boolean;
  headRef: React.RefObject<HTMLHeadingElement | null>;
  onAnswer: (s: Situation | null, label: string, used?: number) => void;
  say: (t: string) => string;
}) {
  const { id, sit, n, extra, busy, headRef, onAnswer, say } = props;
  const [trail, setTrail] = useState<boolean[]>([]);
  const r = easyResolve(id, sit, trail);
  // 이 상황에서 예/아니요로 물을 수 없는 질문(예: 가구원 수를 몰라 소득 금액을 정할 수 없음)은 건너뛴다
  useEffect(() => {
    if (r.kind === "skip" && trail.length === 0) onAnswer(null, "건너뛰기", 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 질문이 바뀔 때(key) 한 번만
  }, []);
  useEffect(() => {
    headRef.current?.focus();
  }, [trail.length, headRef]);
  const pick = (yes: boolean) => {
    const t = [...trail, yes];
    const next = easyResolve(id, sit, t);
    if (next.kind === "ask") setTrail(t);
    else if (next.kind === "done") onAnswer(next.apply(sit), next.label, t.length);
    else onAnswer(null, "건너뛰기", t.length);
  };
  if (r.kind !== "ask") return <p className="muted" role="status">다음 질문으로 넘어가는 중…</p>;
  return (
    <section aria-labelledby="gq-h" data-testid="gq-question" data-dim={id} data-easy="1" className="gq-easy">
      <p className="gq-step" data-testid="gq-step">
        {extra ? `더 답하기 · 질문 ${n}` : `질문 ${n}`} · {QUESTION_NAME[id]}
      </p>
      <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
        {say(r.q)}
      </h1>
      {r.help && <p className="small muted">{r.help}</p>}
      <div className="gq-yn" role="group" aria-label="답">
        <button type="button" className="gq-yes" disabled={busy} onClick={() => pick(true)} data-testid="gq-yes">
          예
        </button>
        <button type="button" className="gq-no" disabled={busy} onClick={() => pick(false)} data-testid="gq-no">
          아니요
        </button>
      </div>
      <div className="gq-yn-more">
        <button type="button" className="link-btn" disabled={busy} onClick={() => onAnswer(null, "잘 모르겠어요", trail.length + 1)} data-testid="gq-a-unknown">
          잘 모르겠어요
        </button>
        {trail.length > 0 && (
          <button type="button" className="link-btn" disabled={busy} onClick={() => setTrail(trail.slice(0, -1))} data-testid="gq-easy-back">
            앞 질문 다시
          </button>
        )}
      </div>
      {busy && (
        <p className="small muted" role="status">
          반영 중…
        </p>
      )}
    </section>
  );
}

const COUNTS = [
  { n: 1, label: "1명" },
  { n: 2, label: "2명" },
  { n: 3, label: "3명 이상" },
] as const;

/**
 * 자녀 질문 (2026-10-16 회의): 임신 중 + 자녀 나이를 모두 고르고, 태어난 자녀가 있으면 몇 명인지.
 * 한 개만 고르던 보기로는 '아이 1명 + 임신 중'을 함께 답할 수 없었다.
 * 앞 질문 '자녀·출산 상황'(2026-10-20 jinwoo)에 답했으면 자녀가 있는 것은 정해졌으니 임신·자녀 없음은 다시 묻지 않는다.
 */
function ChildrenPick(props: {
  sit: Situation;
  busy: boolean;
  headRef: React.RefObject<HTMLHeadingElement | null>;
  onAnswer: (s: Situation | null, label: string) => void;
}) {
  const { sit, busy, headRef, onAnswer } = props;
  // 자녀·출산 질문에서 '자녀가 있어요'/'자녀가 있고, 출산 예정' — 임신 여부는 그 답을 따른다
  const familyKnown = sit.x.family === "children" || sit.x.family === "both";
  const expecting = sit.x.family === "both";
  const buckets = familyKnown ? CHILD_BUCKETS.filter((c) => c !== "pregnant") : CHILD_BUCKETS;
  const [on, setOn] = useState<ChildBucket[]>([]);
  const [count, setCount] = useState<1 | 2 | 3 | null>(null);
  const born = on.filter((c) => c !== "pregnant").length;
  const min = Math.min(3, born);
  const ready = on.length > 0 && (born === 0 || (count !== null && count >= min));
  const withPregnant = (list: ChildBucket[]) => (expecting && !list.includes("pregnant") ? [...list, "pregnant" as const] : list);
  const toggle = (c: ChildBucket) => {
    const next = on.includes(c) ? on.filter((k) => k !== c) : [...on, c];
    setOn(next);
    const b = next.filter((k) => k !== "pregnant").length;
    if (b === 0) setCount(null);
    else if (count !== null && count < Math.min(3, b)) setCount(Math.min(3, b) as 1 | 2 | 3);
  };
  return (
    <>
      <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
        {familyKnown ? "함께 사는 자녀의 나이를 모두 골라 주세요" : "임신 중이거나 함께 사는 자녀가 있나요?"}
      </h1>
      <p className="small muted">{familyKnown ? "자녀가 여럿이면 나이대를 모두 골라요." : "해당하는 것을 모두 골라 주세요. 자녀가 여럿이면 나이대를 모두 골라요."}</p>
      <div className="opts gq-checks" role="group" aria-label={familyKnown ? "자녀 나이" : "임신·자녀 나이"}>
        {buckets.map((c) => (
          <label className="opt" key={c}>
            <input type="checkbox" checked={on.includes(c)} disabled={busy} onChange={() => toggle(c)} data-testid={`gq-child-${c}`} />
            <span>{c === "pregnant" ? "임신 중 (뱃속 아기)" : CHILD_LABEL[c]}</span>
          </label>
        ))}
      </div>
      {born > 0 && (
        <div className="gq-count" role="group" aria-labelledby="gq-count-h">
          <p className="body" id="gq-count-h" style={{ margin: "1rem 0 0.5rem", fontWeight: 700 }}>
            태어난 자녀는 모두 몇 명인가요?
          </p>
          <div className="seg">
            {COUNTS.map((c) => (
              <button
                type="button"
                key={c.n}
                className={`gq-opt${count === c.n ? " on" : ""}`}
                aria-pressed={count === c.n}
                disabled={busy || c.n < min}
                onClick={() => setCount(c.n)}
                data-testid={`gq-child-count-${c.n}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="btn-row" style={{ marginTop: "1.25rem" }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !ready}
          onClick={() => {
            const picked = CHILD_BUCKETS.filter((c) => on.includes(c)).map((c) => CHILD_LABEL[c]).join(", ");
            onAnswer(childrenApply(sit, withPregnant(on), born ? count : 0), born && count ? `${picked} · 자녀 ${COUNTS[count - 1].label}` : picked);
          }}
          data-testid="gq-child-ok"
        >
          고른 것으로 다음
        </button>
        {!familyKnown && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onAnswer(childrenApply(sit, [], 0), "자녀 없음")} data-testid="gq-child-none">
            자녀 없음
          </button>
        )}
        <button type="button" className={styles.skipAnswer} disabled={busy} onClick={() => onAnswer(null, "건너뛰기")} data-testid="gq-a-unknown">
          건너뛰기
        </button>
      </div>
    </>
  );
}

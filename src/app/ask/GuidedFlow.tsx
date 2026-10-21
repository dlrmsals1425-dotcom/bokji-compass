"use client";
/**
 * 질문 따라 찾기 (2026-10-16): 누구 → 사는 곳 확인(현재 위치) → 정해지는 혜택이 많은 질문 5개 → 드문 사항 한 번에 → 결과.
 * 한 화면에 한 질문. 판정은 이 기기에서, 답은 이 기기에만 저장하고 주소에는 싣지 않는다. 위치(좌표)는 시·군·구로만 바꾸고 버린다.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "../finder.module.css";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { loadForRegion, loadRegions } from "@/lib/client/bundles";
import { currentPosition, loadBoundaries, sigunguAt } from "@/lib/client/locate";
import { FLOW_LIMIT, QUESTION_NAME, blankSituation, childrenApply, flowAnswers, flowStep, nextQuestion, rareApply, rarePicks, type FlowStep } from "@/lib/client/guided";
import { resultsPath, type FindMode } from "@/lib/client/mode";
import { sidoOptionLabel } from "@/lib/client/regionLabel";
import { saveSituation } from "@/lib/client/start";
import { saveFiller, useSettings } from "@/lib/client/storage";
import { DIM_BY_ID, type DimId, type Situation } from "@/lib/client/v2";
import type { Program, RegionIndex } from "@/lib/data/types";
import { CHILD_BUCKETS, CHILD_LABEL, type ChildBucket } from "@/lib/engine/profile";

type Where = { sido: string; sigungu: string; label: string };
type LocStatus = { kind: "idle" } | { kind: "busy" } | { kind: "found"; where: Where } | { kind: "error"; text: string };
/** 질문 단계 하나 (이전으로 돌아갈 때 그대로 되돌린다) */
type Snap = { sit: Situation; st: FlowStep; asked: DimId[]; q: DimId | null; picks: Picked[] };
/** 고른 답 (끝 화면 요약·고치기 — 2026-10-16 회의) */
type Picked = { q: DimId | "rare"; label: string };
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
  const [total, setTotal] = useState(0);
  const [cur, setCur] = useState<Snap | null>(null);
  const [history, setHistory] = useState<Past[]>([]);
  // '질문 더 답하기'를 누르면 5개를 넘겨 정해지는 혜택이 남는 동안 계속 묻는다
  const [extra, setExtra] = useState(false);
  const [rareOn, setRareOn] = useState<DimId[]>([]);
  const [busy, setBusy] = useState(false);
  // 끝 화면의 '질문 더 답하기' — 남은 질문이 있는지는 끝 화면에 들어갈 때 한 번만 계산
  const [canMore, setCanMore] = useState(false);
  const seq = useRef(0);
  // 키오스크(기관 태블릿)는 그 기관이 있는 시·군·구로 묻고 위치는 쓰지 않는다
  const kiosk = useSettings()?.kiosk ?? null;
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    loadRegions().then(setRegions, () => setRegions(null));
  }, []);
  // 화면(질문)이 바뀌면 제목으로 초점을 옮겨 화면낭독기가 새 질문부터 읽게
  useEffect(() => {
    headRef.current?.focus();
  }, [phase, cur?.q]);

  const parent = mode === "parent";
  const regionsOrLoad = async () => regions ?? (await loadRegions().catch(() => null));

  const locate = async () => {
    const my = ++seq.current;
    setManual(false);
    setLoc({ kind: "busy" });
    try {
      const [pos, b, rg] = await Promise.all([currentPosition(), loadBoundaries(), regionsOrLoad()]);
      if (my !== seq.current) return;
      const sgg = sigunguAt(b, pos.lat, pos.lng);
      const w = sgg && rg ? whereOf(rg, sgg) : null;
      if (!w) {
        setLoc({ kind: "error", text: "국내 시·군·구 안의 위치가 아니에요. 아래에서 직접 골라 주세요." });
        setManual(true);
        return;
      }
      setLoc({ kind: "found", where: w });
    } catch {
      if (my !== seq.current) return;
      setLoc({ kind: "error", text: "위치를 확인하지 못했어요(권한을 허용하지 않았거나 기기가 위치를 지원하지 않아요). 아래에서 직접 골라 주세요." });
      setManual(true);
    }
  };

  const chooseWho = (m: FindMode) => {
    setMode(m);
    setPhase("where");
    if (kiosk) {
      seq.current++;
      setManual(false);
      setLoc({ kind: "found", where: { sido: kiosk.sido, sigungu: kiosk.sigungu, label: kiosk.label } });
      return;
    }
    // 본인 찾기는 바로 현재 위치부터 — 부모님 찾기는 부모님이 사시는 곳이라 직접 고르기부터
    if (m === "self") void locate();
    else {
      seq.current++;
      setLoc({ kind: "idle" });
      setManual(true);
    }
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
    setTotal(programs.length);
    setHistory([]);
    setExtra(false);
    setRareOn([]);
    advance({ sit, st, asked: [], q: null, picks: [] }, false);
  };

  /** 다음 질문을 고르고, 다 물었으면 드문 사항 → 끝 */
  const advance = (snap: Omit<Snap, "q"> & { q: DimId | null }, more: boolean) => {
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

  /** 답(또는 '잘 모르겠어요')을 반영하고 다시 계산 */
  const answer = async (sit2: Situation | null, label: string) => {
    if (!cur || !cur.q || busy) return;
    setBusy(true);
    await nextFrame();
    const asked = [...cur.asked, cur.q];
    const sit = sit2 ?? cur.sit;
    const st = sit2 ? flowStep(cur.st.pool, sit, cur.st) : cur.st;
    setHistory((h) => [...h, { snap: cur, phase: "ask" }]);
    advance({ sit, st, asked, q: null, picks: [...cur.picks, { q: cur.q, label }] }, extra);
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
    const shown = rarePicks(cur.sit);
    const label = on === null ? "잘 모르겠어요" : on.length ? shown.filter((r) => on.includes(r.key)).map((r) => r.label).join(", ") : "해당 없음";
    setHistory((h) => [...h, { snap: cur, phase: "rare" }]);
    setCur({ sit, st, asked: cur.asked, q: null, picks: [...cur.picks, { q: "rare", label }] });
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

  /** 끝 화면 '고치기': 그 질문(또는 드문 사항) 화면으로 돌아가 거기서부터 다시 (뒤 질문은 새 답에 맞춰 다시 고른다) */
  const fix = (q: Picked["q"]) => {
    const i = history.findIndex((p) => (q === "rare" ? p.phase === "rare" : p.phase === "ask" && p.snap.q === q));
    if (i < 0) return;
    const past = history[i];
    setHistory(history.slice(0, i));
    setCur(past.snap);
    setExtra(past.snap.asked.length >= FLOW_LIMIT);
    setRareOn([]);
    setPhase(past.phase);
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
          <ol className="crumbs" aria-label="현재 위치">
            <li>
              <Link href="/">
                <Icon name="home" size={14} /> 홈
              </Link>
            </li>
            <li>
              <span aria-current="page">질문 따라 찾기</span>
            </li>
          </ol>
          <p className="small muted" style={{ margin: 0 }}>
            답과 위치는 이 기기 안에서만 써요
          </p>
          <div className="gq-bar" aria-hidden="true">
            <i style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
      <div className="form-body">
        <div className="narrow">
          <div className="form-panel gq" data-testid="guided" data-phase={phase} data-mode={mode}>
            {counts && (phase === "ask" || phase === "rare" || phase === "done") && (
              <div className="gq-counts" aria-live="polite" data-testid="gq-counts">
                <div>
                  <span>받으실 수 있어요</span>
                  <b data-testid="gq-fit">{counts.fit}</b>
                </div>
                <div>
                  <span>답하면 정해져요</span>
                  <b data-testid="gq-ask">{counts.ask}</b>
                </div>
                <div>
                  <span>신청할 때 확인</span>
                  <b>{counts.office}</b>
                </div>
              </div>
            )}

            {phase === "who" && (
              <section aria-labelledby="gq-h" className={styles.questionLayout}>
                <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
                  누구의 복지를 찾으세요?
                </h1>
                <div className="gq-opts">
                  <button type="button" className="gq-opt" onClick={() => chooseWho("self")} data-testid="gq-self">
                    <Icon name="users" size={22} /> 나
                  </button>
                  <button type="button" className="gq-opt" onClick={() => chooseWho("parent")} data-testid="gq-parent">
                    <Icon name="heart" size={22} /> 부모님 (대신 알아보기)
                  </button>
                </div>
              </section>
            )}

            {phase === "where" && (
              <section aria-labelledby="gq-h" className={styles.questionLayout}>
                <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
                  {loc.kind === "found"
                    ? `${loc.where.label}에서 복지를 받으시나요?`
                    : parent
                      ? "부모님은 어디에 사세요?"
                      : "어디에 사세요?"}
                </h1>
                {loc.kind === "busy" && (
                  <p className="small muted" role="status" data-testid="gq-locating">
                    현재 위치를 확인하고 있어요…
                  </p>
                )}
                {loc.kind === "found" && (
                  <>
                    <p className="small muted">
                      <Icon name="mapPin" size={16} /> {kiosk ? "이 기관이 있는 곳이에요." : "현재 위치로 찾았어요."} {parent ? "부모님이 사시는 곳과 같은지 확인해 주세요." : "주소지(주민등록) 기준이에요."}
                    </p>
                    <div className="gq-opts">
                      <button type="button" className="gq-opt" onClick={() => start(loc.where)} data-testid="gq-here">
                        네, 여기예요
                      </button>
                      <button type="button" className="gq-opt gq-unknown" onClick={() => setManual(true)} data-testid="gq-elsewhere">
                        다른 곳이에요 (직접 고르기)
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
                        이 지역으로 <Icon name="arrowRight" size={18} />
                      </button>
                      {loc.kind !== "busy" && (
                        <button type="button" className="btn btn-ghost" onClick={locate} data-testid="gq-locate">
                          <Icon name="mapPin" size={18} /> {parent ? "부모님과 같이 살아요 — 현재 위치로" : "현재 위치로 다시 찾기"}
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <p className="small muted" style={{ marginTop: "1rem" }}>
                  위치는 이 기기 안에서만 시·군·구로 바꾸고, 어디에도 보내거나 저장하지 않아요.
                </p>
                <button type="button" className="btn-quiet" onClick={() => setPhase("who")}>
                  <Icon name="arrowLeft" size={16} /> 이전
                </button>
              </section>
            )}

            {phase === "loading" && (
              <p className="muted" role="status" data-testid="gq-loading">
                {where?.label} 복지를 불러와 판정하고 있어요…
              </p>
            )}

            {phase === "ask" && cur?.q && (
              <Question key={`${cur.q}-${asked}`} id={cur.q} sit={cur.sit} mode={mode} n={asked + 1} extra={extra} busy={busy} headRef={headRef} onAnswer={answer} />
            )}

            {phase === "rare" && cur && (
              <section aria-labelledby="gq-h" data-testid="gq-rare">
                <p className="gq-step">마지막 · 해당하는 것만</p>
                <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
                  {parent ? "부모님께 해당하는 것이 있으면 모두 골라 주세요" : "해당하는 것이 있으면 모두 골라 주세요"}
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
                    {rareOn.length ? "고른 것으로 다음" : "해당 없음"}
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => finishRare(null)} data-testid="gq-rare-skip">
                    잘 모르겠어요
                  </button>
                </div>
              </section>
            )}

            {phase === "done" && cur && (
              <section aria-labelledby="gq-h" data-testid="gq-done">
                <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
                  이렇게 정리됐어요
                </h1>
                <p className="body">
                  {where?.label} 복지 {total.toLocaleString("ko-KR")}개 가운데 해당하지 않는 {cur.st.counts.no.toLocaleString("ko-KR")}개는 이유와 함께 결과 화면 맨 아래에 모아 둬요.
                  {cur.st.counts.ask > 0 && ` 아직 ${cur.st.counts.ask}개는 답에 따라 갈려요.`}
                </p>
                <div className="gq-summary" data-testid="gq-summary">
                  <h2 className="h3">내가 고른 답</h2>
                  <ul>
                    <li>
                      <span>누구</span>
                      <b>{parent ? "부모님" : "나"}</b>
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
  id: DimId;
  sit: Situation;
  mode: FindMode;
  n: number;
  extra: boolean;
  busy: boolean;
  headRef: React.RefObject<HTMLHeadingElement | null>;
  onAnswer: (s: Situation | null, label: string) => void;
}) {
  const { id, sit, mode, n, extra, busy, headRef, onAnswer } = props;
  const d = DIM_BY_ID[id];
  const opts = flowAnswers(d, sit);
  return (
    <section aria-labelledby="gq-h" data-testid="gq-question" data-dim={id}>
      <p className="gq-step" data-testid="gq-step">
        {extra && n > FLOW_LIMIT ? `더 답하기 · 질문 ${n}` : `질문 ${n} / ${FLOW_LIMIT}`} · {QUESTION_NAME[id]}
      </p>
      {id === "children" ? (
        <ChildrenPick sit={sit} busy={busy} headRef={headRef} onAnswer={onAnswer} />
      ) : (
        <>
      <h1 className="h2 gq-q" id="gq-h" tabIndex={-1} ref={headRef}>
        {d.q(mode, sit)}
      </h1>
      {d.help && <p className="small muted">{d.help}</p>}
      {id === "income" && sit.profile.householdSize !== "unknown" && (
        <p className="small muted">{sit.profile.householdSize === 6 ? "6명 이상" : `${sit.profile.householdSize}인`} 가구 기준 중위소득 구간이에요. 세금 떼기 전 금액으로 골라 주세요.</p>
      )}
      <div className="gq-opts" role="group" aria-label="답">
        {opts.map((a) => (
          <button type="button" className="gq-opt" key={a.key} disabled={busy} onClick={() => onAnswer(a.apply(sit), a.label)} data-testid={`gq-a-${a.key}`}>
            {a.label}
          </button>
        ))}
        <button type="button" className="gq-opt gq-unknown" disabled={busy} onClick={() => onAnswer(null, "잘 모르겠어요")} data-testid="gq-a-unknown">
          잘 모르겠어요
        </button>
      </div>
        </>
      )}
      {busy && (
        <p className="small muted" role="status">
          다시 판정하고 있어요…
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
 */
function ChildrenPick(props: {
  sit: Situation;
  busy: boolean;
  headRef: React.RefObject<HTMLHeadingElement | null>;
  onAnswer: (s: Situation | null, label: string) => void;
}) {
  const { sit, busy, headRef, onAnswer } = props;
  const [on, setOn] = useState<ChildBucket[]>([]);
  const [count, setCount] = useState<1 | 2 | 3 | null>(null);
  const born = on.filter((c) => c !== "pregnant").length;
  const min = Math.min(3, born);
  const ready = on.length > 0 && (born === 0 || (count !== null && count >= min));
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
        임신 중이거나 함께 사는 자녀가 있나요?
      </h1>
      <p className="small muted">해당하는 것을 모두 골라 주세요. 자녀가 여럿이면 나이대를 모두 골라요.</p>
      <div className="opts gq-checks" role="group" aria-label="임신·자녀 나이">
        {CHILD_BUCKETS.map((c) => (
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
            onAnswer(childrenApply(sit, on, born ? count : 0), born && count ? `${picked} · 자녀 ${COUNTS[count - 1].label}` : picked);
          }}
          data-testid="gq-child-ok"
        >
          고른 것으로 다음
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onAnswer(childrenApply(sit, [], 0), "자녀 없음")} data-testid="gq-child-none">
          자녀 없음
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onAnswer(null, "잘 모르겠어요")} data-testid="gq-a-unknown">
          잘 모르겠어요
        </button>
      </div>
    </>
  );
}

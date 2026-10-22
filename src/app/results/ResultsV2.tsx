"use client";
/**
 * 결과 (기본 화면): 답한 상황과 맞지 않는 혜택은 본문에서 빼고, '모름'으로 남은 조건은 맨 위 짧은 질문(최대 3개)으로 다시 거른다.
 * 답하면 바로 다시 계산 (기기 안에서만). 예전 결과 화면은 /results?v=1 (비교용).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { readMarks, toggleMark, writeMarks, writePicks, type Marks } from "@/lib/client/sheetMarks";
import { Icon } from "@/components/Icon";
import styles from "./results.module.css";
import { SupportTags } from "@/components/ProgramCard";
import { ApplyBadge, orgText, ownerText } from "@/components/Badges";
import { IncomeAsk } from "./IncomeAsk";
import { QuickRefinement, QuickSearchNote } from "./QuickRefinement";
import { Summary } from "./Summary";
import { VisitSheet } from "./VisitSheet";
import { loadForRegion, loadProgram, loadRegions, type Loaded } from "@/lib/client/bundles";
import { CHANNEL_LABEL, firstLine, howTo } from "@/lib/client/howto";
import { clearProfile, setReceiving, useElder, useExample, useExtras, useReceiving } from "@/lib/client/storage";
import { autoReceivingKeys, splitReceiving } from "@/lib/client/receiving";
import { saveSituation, situationOf } from "@/lib/client/start";
import { presetById } from "@/lib/client/presets";
import { checkPath, coupleNote, resultsCopy, type FindMode } from "@/lib/client/mode";
import {
  BUCKET_LABEL, LOW_INCOME_PCT, cohabitParentPicks, cohabitParentSit, ageBoundsOf, ageSpanOf, answersFor, autoV2, buildView, classify, inferredNoRecipient, plainLine, scoreV2, situationChips, topPicksV2,
  type Bucket, type DimId, type Situation, type V2Item,
} from "@/lib/client/v2";
import { consentUnderAge, parentConsent, youthUpTo24 } from "@/lib/client/cardNotes";
import type { Program } from "@/lib/data/types";
import { dateLabel, periodEnded } from "@/lib/client/period";
import { AGE_LABEL, ageRange, type Profile } from "@/lib/engine/profile";
import meta from "../../../public/bundles/v1/meta.json";

const FIRST = 10;
const MORE = 20;
/** QA 2차 M1: '신청할 때 확인'은 상위 20개를 먼저 */
const OFFICE_TOP = 20;
/** '이것을 알려 주시면' 한 줄용 짧은 이름 (QA 5차 검증 N8) */
const DIM_INFO: Partial<Record<DimId, string>> = {
  support: "기초생활수급·차상위 여부", basicPension: "기초연금 수급 여부", income: "가구 소득", disability: "장애 여부", care: "돌봄이 필요한지",
  ltcGrade: "장기요양등급", alone: "혼자 사는지", age: "나이", veteran: "보훈대상 여부", singleParent: "한부모 여부", multicultural: "다문화가족 여부",
  housing: "사는 집 형태", activity: "하는 일(학생·구직 등)", illness: "앓는 병", children: "자녀", daycare: "어린이집·유치원 이용",
};

export function ResultsV2({ profile, mode, quick = false }: { profile: Profile; mode: FindMode; quick?: boolean }) {
  const extras = useExtras();
  const example = useExample();
  const elder = useElder() ?? false;
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [skipped, setSkipped] = useState<DimId[]>([]);
  const [details, setDetails] = useState<Record<string, Program>>({});
  /** 상세 묶음을 다 받아 온 '먼저 확인할 5가지' 목록 (QA 3차 R5: 받기 전에는 신청처를 '불러오는 중'으로) */
  const [detailsFor, setDetailsFor] = useState<string>("");
  const [toast, setToast] = useState<string | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoLimit, setAutoLimit] = useState(FIRST);
  const [pilotSidos, setPilotSidos] = useState<string[] | null>(null);
  /** 준비물 한 장: 먼저 확인할 5가지에서 뺀 것·직접 담은 것 (사업 id만, 이 탭에만) */
  const [marks, setMarksRaw] = useState<Marks>(() => readMarks());
  const setMarks = (f: (m: Marks) => Marks) =>
    setMarksRaw((m) => {
      const v = f(m);
      writeMarks(v);
      return v;
    });
  const [sheetOpen, setSheetOpen] = useState(false);
  useEffect(() => {
    loadRegions().then((r) => setPilotSidos(r ? r.sidos.filter((x) => x.pilot).map((x) => x.code) : null));
  }, []);
  useEffect(() => {
    let alive = true;
    loadForRegion(profile.sido, profile.sigungu).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [profile.sido, profile.sigungu]);

  const sit: Situation = useMemo(() => situationOf(profile, extras ?? null, mode), [profile, extras, mode]);
  const scored = useMemo(() => (data ? scoreV2(data.programs, sit) : []), [data, sit]);
  const view0 = useMemo(() => buildView(scored, sit, 12), [scored, sit]);
  // 이미 받고 있다고 표시한 혜택은 먼저 확인할 5가지·목록·준비물 한 장에서 빼고 따로 (2026-10-16, 이 기기에만 저장)
  const recvAll = useReceiving();
  const recvKeys = (recvAll?.[mode] ?? []).join("\u0001");
  // (2026-10-22) '기초연금 받음'처럼 이미 받는다고 답한 급여 자체도 같은 곳으로 (답을 고치면 다시 보임)
  const autoRecv = useMemo(() => autoReceivingKeys(view0, sit), [view0, sit]);
  const { view, receiving } = useMemo(
    () => splitReceiving(view0, [...new Set([...(recvKeys ? recvKeys.split("\u0001") : []), ...autoRecv])]),
    [view0, recvKeys, autoRecv],
  );
  const picks = useMemo(() => topPicksV2(view, 5, sit), [view, sit]);
  const autos = useMemo(() => (data ? autoV2(data.programs, sit) : []), [data, sit]);

  // 먼저 확인할 5가지는 신청 방법(어디서·무엇을 가져가서)을 보여 주려고 상세 묶음을 따로 불러온다
  const pickIds = picks.map((g) => g[0].s.program.id).join("|");
  // 준비물 한 장에 담긴 혜택: 먼저 확인할 5가지(뺀 것 제외) + 직접 담은 것 (지금 결과에 있는 것만)
  const itemById = useMemo(() => {
    const m = new Map<string, V2Item>();
    for (const b of ["fit", "office", "ask"] as const) for (const g of view[b]) m.set(g[0].s.program.id, g[0]);
    return m;
  }, [view]);
  const sheetItems = useMemo(() => {
    const ids = [...picks.map((g) => g[0].s.program.id).filter((id) => !marks.remove.includes(id)), ...marks.add.filter((id) => !pickIds.split("|").includes(id))];
    return [...new Set(ids)].map((id) => itemById.get(id)).filter((x): x is V2Item => !!x);
  }, [picks, marks, itemById, pickIds]);
  const sheetIds = sheetItems.map((i) => i.s.program.id).join("|");
  // 상세 화면에서도 담김 여부를 알도록 먼저 확인할 5가지를 이 탭에 적어 둔다 (사업 id만)
  useEffect(() => {
    if (pickIds) writePicks(pickIds.split("|"));
  }, [pickIds]);
  const wantIds = sheetOpen ? [...new Set([...pickIds.split("|"), ...sheetIds.split("|")])].filter(Boolean).join("|") : pickIds;
  useEffect(() => {
    if (!wantIds) return;
    let alive = true;
    Promise.all(wantIds.split("|").map((id) => loadProgram(id))).then((ps) => {
      if (!alive) return;
      const out: Record<string, Program> = {};
      ps.forEach((p) => p && (out[p.id] = p));
      setDetails((d) => ({ ...d, ...out }));
      setDetailsFor(wantIds);
    }).catch(() => alive && setDetailsFor(wantIds));
    return () => {
      alive = false;
    };
  }, [wantIds]);

  if (!data || extras === undefined) {
    return (
      <div className="wrap page results-root" aria-busy="true" aria-live="polite">
        <p className="muted">혜택을 불러오는 중…</p>
        <div className="skeleton" aria-hidden="true">
          <div className="sk" />
          <div className="sk" />
          <div className="sk" />
        </div>
      </div>
    );
  }

  const parent = mode === "parent";
  const copy = resultsCopy(mode);
  const markReceiving = (key: string, on: boolean) => setReceiving(mode, key, on);
  const sheetCtl: SheetCtl = {
    receive: (key) => markReceiving(key, true),
    has: (id) => sheetIds.split("|").includes(id),
    toggle: (id, on) => setMarks((m) => toggleMark(m, id, on, pickIds.split("|"))),
  };
  const preset = presetById(example);
  const place = data.label.split(" ").pop();
  const questions = view.questions.filter((q) => !skipped.includes(q.dim.id)).slice(0, quick ? 1 : 3);
  const apply = (next: Situation) => saveSituation(next, mode, undefined, quick);
  const editHref = checkPath(mode);
  const picked = new Set(picks);
  const couple = coupleNote(mode, profile);
  // 부모님 두 분의 나이대가 다르면 다른 분 기준 결과로 바꿔 보는 단추 (QA 2차 M7) — 바꾸면 지금 분이 '다른 분'이 된다
  const other = sit.x.otherAge && profile.age !== "unknown" && sit.x.otherAge.band !== profile.age ? sit.x.otherAge : null;
  const showOther = () => {
    if (!other || profile.age === "unknown") return;
    const [a, b] = ageRange(profile.age);
    const cur = { band: profile.age, label: b >= 120 ? `만 ${a}세 이상` : `만 ${a}~${b}세` };
    apply({ ...sit, profile: { ...sit.profile, age: other.band }, x: { ...sit.x, otherAge: cur } });
    window.scrollTo({ top: 0 });
  };

  // 나이를 모르면 먼저 확인할 것이 크게 달라지므로 질문을 위에, 아니면 '먼저 확인할 것'을 맨 위에 (QA 1차 H5)
  const askFirst = questions.some((q) => q.dim.id === "age");
  const teen = isTeenSelf(sit, mode);
  // 먼저 확인할 것이 5개보다 적을 때 — 무엇을 알려 주면 더 고를 수 있는지 한 줄 (QA 5차 검증 N8)
  const moreInfo = questions.map((q) => DIM_INFO[q.dim.id]).filter(Boolean).slice(0, 2);
  const moreHint =
    picks.length > 0 && picks.length < 5 && !(picks.length < 3 && askFirst)
      ? moreInfo.length
        ? `추가 확인: ${moreInfo.join(", ")}`
        : null
      : null;
  const followUp = (
    <section className="v2-follow no-print" id="v2-followup" aria-labelledby="fq-h" data-testid="v2-followup">
            {questions.length > 0 ? (
              <>
                <h2 className="h2" id="fq-h" tabIndex={-1}>
                  추가 질문
                </h2>
                <ol className="v2-qs">
                  {questions.map((q) => (
                    <li key={q.dim.id} className="v2-q" data-testid={`v2-q-${q.dim.id}`}>
                      <p className="v2-q-t">
                        <strong>{q.dim.q(mode, sit)}</strong>
                      </p>
                      {q.dim.help && <details className="small muted"><summary>선택 도움말</summary><p>{q.dim.help}</p></details>}
                      {q.dim.id === "income" ? (
                        <IncomeAsk sit={sit} onApply={apply} onSkip={() => setSkipped((s) => [...s, "income"])} skipLabel={quick ? "건너뛰기" : undefined} />
                      ) : (
                        <div className="btn-row v2-answers">
                          {answersFor(q.dim, sit).map((a) => (
                            <button key={a.key} type="button" className="btn btn-ghost btn-sm" onClick={() => apply(a.apply(sit))} data-testid={`v2-a-${q.dim.id}-${a.key}`}>
                              {a.label}
                            </button>
                          ))}
                          <button type="button" className="btn btn-quiet" onClick={() => setSkipped((s) => [...s, q.dim.id])} data-testid={`v2-skip-${q.dim.id}`}>
                            {quick ? "건너뛰기" : "모름"}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              </>
            ) : (
              <p className="notice" id="fq-h" tabIndex={-1} data-question-focus>
                <Icon name="check" size={18} />
                <span>추가 질문이 없어요.</span>
              </p>
            )}
            {inferredNoRecipient(sit) && (
              <p className="small muted" style={{ marginTop: "0.75rem" }} data-testid="v2-inferred">
                소득이 기준 중위소득 {LOW_INCOME_PCT}%를 넘어서 기초생활수급(생계·의료·주거·교육급여)·차상위는 아닌 것으로 보고 골랐어요.
              </p>
            )}
          </section>
  );

  // 공유 (QA 1차 M3): 상황(나이·소득 등)은 주소에 싣지 않는다 — 받는 사람이 바로 열어 볼 수 있게
  // 먼저 확인할 혜택마다 공개 상세 주소(/p/…)를 붙이고, 자기 상황으로 다시 찾는 시작 주소를 덧붙인다
  const share = async () => {
    const origin = window.location.origin;
    const text = [
      `복지나침반에서 ${data.label} 기준${parent ? "으로 부모님께" : "으로"} 먼저 확인해 볼 혜택이에요.`,
      ...picks.map((g) => `· ${g[0].s.program.name} — ${origin}/p/${encodeURIComponent(g[0].s.program.id)}`),
      `내 상황으로 다시 찾기: ${origin}/situation${parent ? "?for=parent" : ""}`,
      "(나이·소득 등 입력한 정보는 들어 있지 않아요)",
    ].join("\n");
    try {
      if (navigator.share) await navigator.share({ title: "복지나침반 — 먼저 확인할 혜택", text });
      else {
        await navigator.clipboard.writeText(text);
        setToast("먼저 확인할 혜택과 상세 주소를 복사했어요 (입력값은 들어 있지 않아요)");
        setTimeout(() => setToast(null), 2500);
      }
    } catch {}
  };

  return (
    <div className={`results-root v2 ${styles.results}`} data-testid="v2-results">
      <div className="print-only wrap">
        <strong>복지나침반 결과 요약</strong> — 출력일 {new Date().toLocaleDateString("ko-KR")}
      </div>
      <section className="res-head" aria-labelledby="res-h">
        <div className={`wrap ${styles.frame}`}>
          <ol className="crumbs no-print" aria-label="현재 위치">
            <li>
              <Link href="/">
                <Icon name="home" size={14} /> 홈
              </Link>
            </li>
            <li>
              <Link href={editHref}>{parent ? "부모님 상황" : "내 상황"}</Link>
            </li>
            <li>
              <span aria-current="page">결과</span>
            </li>
          </ol>
          {parent && (
            <p className={styles.note} data-testid="parent-results-banner" role="note">
              <Icon name="heart" size={18} />
              <span>
                <strong>{elder ? "조부모님·어르신 기준" : "부모님 기준"}</strong>
              </span>
            </p>
          )}
          {couple && (
            <details className="notice couple-fold" data-testid="couple-note">
              <summary>
                <Icon name="info" size={18} /> <strong>부모님 두 분이 함께 사시면</strong>
              </summary>
              <p>{couple}</p>
            </details>
          )}
          {parent && other && (
            <p className="notice" data-testid="other-parent-note" role="note">
              <Icon name="info" size={18} />
              <span>
                다른 한 분: {other.label}{" "}
                <button type="button" className="btn btn-ghost btn-sm" onClick={showOther} data-testid="other-parent-btn">
                  다른 분 기준으로 보기
                </button>
              </span>
            </p>
          )}
          {pilotSidos && profile.sido && !pilotSidos.includes(profile.sido) && (
            <p className={styles.note} data-testid="non-pilot-note" role="note">
              <Icon name="info" size={18} />
              <span>
                지역 조건 확인 중 · 신청 전 공식 안내를 확인하세요.
              </span>
            </p>
          )}
          {preset && (
            <p className={styles.example} data-testid="example-banner" role="note">
              <span>예시 결과</span>
              <Link href={`${editHref}&new=1`}>내 상황으로 찾기</Link>
            </p>
          )}
          <h1 className="h1" id="res-h">
            {quick ? "검색 결과" : `${place} ${parent ? "부모님께 맞는 혜택" : "나에게 맞는 혜택"}`}
          </h1>
          <div className={styles.conditions}>
            <details className={styles.profile}>
              <summary>입력한 조건 <Icon name="chevronDown" size={16} /></summary>
              <p className="situation" data-testid="v2-chips">
                {[data.label, ...situationChips(sit)].join(" · ")}
              </p>
            </details>
            <Link href={editHref} className="no-print" data-testid="edit-situation">
              상황 고치기
            </Link>
          </div>
          {/* 큰 숫자 타일 대신 한 줄 개수 (QA 1차 H5: 모바일 첫 화면에 할 일이 보이게) */}
          <ul className="v2-counts" aria-label="분류별 개수">
            <Count href="#v2-fit" cls="t-eligible" label="받으실 수 있어요" n={view.fit.length} testId="v2-n-fit" />
            <Count href="#v2-office" cls="t-likely" label="신청할 때 확인" n={view.office.length} testId="v2-n-office" />
            <Count href="#v2-ask" cls="t-check" label="답하면 정해져요" n={view.ask.length} testId="v2-n-ask" />
            <Count href="#v2-no" cls="t-none" label="맞지 않아 뺀 것" n={view.no.length} testId="v2-n-no" />
          </ul>
        </div>
      </section>

      <div className={`wrap page ${styles.frame}`}>
        <div className={`v2-main ${styles.layout}`}>
          <div className={styles.overview} data-testid="results-overview">
            {quick && <QuickSearchNote sit={sit} />}
            {teen && <TeenNote />}
            {data && (
              <p className="small muted no-print" data-testid="property-note">
                재산(집·땅·자동차·예금)은 묻지 않고 찾은 결과예요. 재산 기준이 있는 혜택은 신청하는 곳에서 소득과 재산을 함께 보고 정해요.
              </p>
            )}
            {data && (
              <Summary
                view={view}
                picks={picks}
                sit={sit}
                mode={mode}
                question={quick || askFirst ? undefined : questions[0]}
                onApply={apply}
                onSkip={(d) => setSkipped((s) => [...s, d])}
              />
            )}
            {/* 한눈에 보기 바로 아래 준비물 한 장 (QA 7차 V2: 모바일에서 기존 버튼이 y≈4,000px 아래) */}
            {data && sheetItems.length > 0 && !sheetOpen && (
              <p className="sum-sheet no-print">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setSheetOpen(true);
                    setTimeout(() => document.getElementById("visit-sheet")?.scrollIntoView({ block: "start" }), 50);
                  }}
                  data-testid="sum-sheet-open"
                >
                  <Icon name="listChecks" size={18} /> 신청 서류 모음 보기
                </button>
              </p>
            )}
          </div>
          <div className={styles.content} data-testid="results-content">
            {!quick && askFirst && followUp}

            {picks.length > 0 && (
              <section aria-labelledby="picks-h" data-testid="top-picks" className="v2-sec">
                <h2 className="h2" id="picks-h">
                  추천 혜택 {picks.length}
                </h2>
                {moreHint && (
                  <p className="body muted" data-testid="picks-more-hint">
                    {moreHint}
                  </p>
                )}
                <ol className="picks">
                  {picks.map((g, i) => (
                    <Pick
                      key={g[0].s.program.id}
                      item={g[0]}
                      i={i}
                      detail={details[g[0].s.program.id]}
                      loading={!detailsFor.split("|").includes(g[0].s.program.id) && !details[g[0].s.program.id]}
                      sit={sit}
                      mode={mode}
                      inSheet={!marks.remove.includes(g[0].s.program.id)}
                      onSheet={(on) => setMarks((m) => ({ ...m, remove: on ? m.remove.filter((x) => x !== g[0].s.program.id) : [...m.remove, g[0].s.program.id] }))}
                      onReceiving={() => markReceiving(g[0].s.group, true)}
                    />
                  ))}
                </ol>
              </section>
            )}

            {sheetItems.length > 0 && (
              <div className="sheet-cta no-print" data-testid="sheet-cta">
                <p>
                  <b>신청 서류 모음</b> · 담은 혜택 {sheetItems.length}개
                  <span className="small muted" data-testid="sheet-explain"> — 담은 혜택을 신청할 때 가져갈 서류를 신청하는 곳별로 한 장에 모아 드려요. 먼저 확인할 5가지는 미리 담아 두었고, 각 혜택의 ‘빼기’·‘서류 모음에 담기’로 바꿀 수 있어요.</span>
                </p>
                <button
                  type="button"
                  className="btn btn-tonal btn-sm"
                  aria-expanded={sheetOpen}
                  aria-controls="visit-sheet"
                  onClick={() => {
                    setSheetOpen((o) => !o);
                    if (!sheetOpen) setTimeout(() => document.getElementById("visit-sheet")?.scrollIntoView({ block: "start" }), 50);
                  }}
                  data-testid="sheet-open"
                >
                  <Icon name="listChecks" size={18} /> {sheetOpen ? "신청 서류 모음 접기" : "신청 서류 모음 보기"}
                </button>
              </div>
            )}
            {sheetOpen && sheetItems.length > 0 && (
              <VisitSheet
                entries={sheetItems.map((i) => ({ program: details[i.s.program.id] ?? i.s.program, bucket: i.bucket }))}
                region={data.label}
                sido={profile.sido}
                loading={!sheetIds.split("|").every((id) => detailsFor.split("|").includes(id) || details[id])}
                extra={sheetItems.filter((i) => !pickIds.split("|").includes(i.s.program.id)).length}
                teen={isTeenSelf(sit, mode)}
                onClose={() => setSheetOpen(false)}
              />
            )}

            {/* '장인어른 모시고 삽니다' — 모시는 분께 맞는 혜택은 그분 기준으로 따로 찾아야 정확함 (QA 4차 N3) */}
            {!parent && sit.x.interests?.includes("eldercare") && (
              <p className="notice" data-testid="eldercare-note" role="note">
                <Icon name="info" size={18} />
                <span>
                  부모님 혜택은 부모님의 나이·상황으로 확인하세요.{" "}
                  <Link href="/situation?for=parent&new=1" className="btn btn-ghost btn-sm" data-testid="eldercare-parent-link">
                    부모님 기준으로 따로 찾기
                  </Link>
                </span>
              </p>
            )}
            {!quick && !parent && sit.x.interests?.includes("eldercare") && data && <CohabitParent programs={data.programs} sit={sit} />}

            {!quick && picks.length < 3 && askFirst && (
              <p className="notice" data-testid="picks-need-age" role="note">
                <Icon name="info" size={18} />
                <span>
                  {questions[0]?.dim.id === "children"
                    ? "아동 혜택을 찾으려면 자녀 나이를 확인해 주세요."
                    : `${parent ? "부모님 나이" : "나이"} 미입력으로 연령별 혜택을 아직 고르지 않았어요.`}
                </span>
              </p>
            )}

            {quick ? <QuickRefinement sit={sit} onApply={apply} questionKey={questions.map((q) => q.dim.id).join(",")}>
              {followUp}
              {!parent && sit.x.interests?.includes("eldercare") && data && <CohabitParent programs={data.programs} sit={sit} />}
            </QuickRefinement> : !askFirst && followUp}

            <BucketList sheet={sheetCtl} id="v2-fit" bucket="fit" title={picks.some((g) => g[0].bucket === "fit") ? `그 밖에 받으실 수 있는 혜택` : "받으실 수 있는 혜택"} lead="답하신 상황으로 공개된 지원 조건이 모두 맞아요." groups={view.fit.filter((g) => !picked.has(g))} sit={sit} mode={mode} />
            <BucketList
              sheet={sheetCtl}
              id="v2-office"
              bucket="office"
              title="신청할 때 확인이 필요한 혜택"
              lead="입력한 조건은 맞지만, 세부 요건은 신청처 확인이 필요해요."
              groups={view.office.filter((g) => !picked.has(g))}
              top={OFFICE_TOP}
              sit={sit}
              mode={mode}
            />
            <BucketList
              id="v2-ask"
              bucket="ask"
              title="질문에 답하면 정해지는 혜택"
              lead="아직 답하지 않은 지원 조건이 있어요."
              groups={view.ask.filter((g) => !picked.has(g))}
              sit={sit}
              mode={mode}
              collapsed
              action={
                // 질문이 멀리 위에 있어 어디서 답하는지 안 보이던 문제 (운영자 피드백 2026-10-09)
                questions.length > 0 ? (
                  <a href="#v2-followup" className="btn btn-tonal btn-sm" data-testid="v2-ask-go">
                    <Icon name="listChecks" size={18} /> 질문에 답하러 가기
                  </a>
                ) : skipped.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-tonal btn-sm"
                    onClick={() => {
                      setSkipped([]);
                      setTimeout(() => document.getElementById("v2-followup")?.scrollIntoView({ block: "start" }), 50);
                    }}
                    data-testid="v2-ask-go"
                  >
                    <Icon name="listChecks" size={18} /> 건너뛴 질문 다시 답하기
                  </button>
                ) : null
              }
            />
            <BucketList
              id="v2-closed"
              bucket="no"
              title="신청 기간이 지난 혜택"
              lead="다음 접수 일정은 담당 기관에 확인하세요."
              groups={view.closed ?? []}
              sit={sit}
              mode={mode}
              collapsed
            />
            <BucketList
              id="v2-no"
              bucket="no"
              title="답하신 상황과 맞지 않아 뺀 혜택"
              lead="입력한 내용과 지원 조건이 달라요. 달라진 답변은 ‘상황 고치기’에서 수정하세요."
              groups={view.no}
              sit={sit}
              mode={mode}
              collapsed
            />

            {receiving.length > 0 && (
              <section className="v2-sec receiving" aria-labelledby="recv-h" data-testid="receiving-section">
                <h2 className="h2" id="recv-h">
                  이미 받고 있는 혜택 {receiving.length}개
                </h2>
                <p className="body">추천·신청 서류 모음에서 뺐어요.</p>
                <ul className="recv-list">
                  {receiving.map((g) => (
                    <li key={g[0].s.group}>
                      <Link href={`/p/${encodeURIComponent(g[0].s.program.id)}`}>{g[0].s.program.name}</Link>
                      {autoRecv.includes(g[0].s.group) ? (
                        <span className="small muted" data-testid="receiving-auto">답하신 상황(받고 있음)으로 뺐어요 · <Link href={editHref}>상황 고치기</Link></span>
                      ) : (
                        <button type="button" className="link-btn no-print" onClick={() => markReceiving(g[0].s.group, false)} data-testid="receiving-undo">
                          다시 보이기
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {autos.length > 0 && (
              <details className="details auto-panel" data-testid="auto-section" open={autoOpen} onToggle={(e) => setAutoOpen((e.currentTarget as HTMLDetailsElement).open)}>
                <summary data-testid="auto-toggle">
                  <span>
                    자동 지급·기관 선정 혜택
                  </span>
                  <span className="c">
                    <span><span data-testid="auto-count">{autos.length.toLocaleString("ko-KR")}</span>개</span> <Icon name="chevronDown" size={18} />
                  </span>
                </summary>
                {autoOpen && (
                  <div className="details-body">
                    <p className="body">
                      기관이 대상자를 선정하거나 지급하는 혜택이에요. 해당 여부는 담당 기관에 확인하세요.
                    </p>
                    <div className="v2-list">
                      {autos.slice(0, autoLimit).map((g) => (
                        <V2Card key={g.key} item={classify(g.lead, sit)} more={g.variants.length} sit={sit} mode={mode} />
                      ))}
                    </div>
                    {autos.length > autoLimit && (
                      <div className="more-row no-print">
                        <button type="button" className="btn btn-ghost" onClick={() => setAutoLimit((l) => l + MORE)} data-testid="auto-more">
                          더 보기 ({(autos.length - autoLimit).toLocaleString("ko-KR")}개 남음)
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </details>
            )}

            {copy.proxyNote && (
              <p className="notice" data-testid="proxy-apply-note" role="note" style={{ marginTop: "1.5rem" }}>
                <Icon name="info" size={18} />
                <span>
                  <strong>가족이 대신 신청할 때</strong> — {copy.proxyNote}
                </span>
              </p>
            )}

            <div className="v2-actions no-print" role="group" aria-label="이 결과로 할 수 있는 일">
              <button type="button" className="link-btn" onClick={() => window.print()}>
                <Icon name="printer" size={18} /> 인쇄하거나 PDF로 저장
              </button>
              {sheetItems.length > 0 && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    setSheetOpen(true);
                    setTimeout(() => document.getElementById("visit-sheet")?.scrollIntoView({ block: "start" }), 50);
                  }}
                  data-testid="sheet-open-2"
                >
                  <Icon name="listChecks" size={18} /> 신청 서류 모음 (곳별로 한 장)
                </button>
              )}
              <button type="button" className="link-btn" onClick={share} data-testid="share">
                <Icon name="share" size={18} /> 가족에게 보내기 (입력값 제외)
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  clearProfile();
                  router.push("/");
                }}
                data-testid="clear"
              >
                <Icon name="trash" size={18} /> 이 기기에서 지우기
              </button>
              <span className="small muted">
                <Icon name="phone" size={16} /> 상담: 보건복지상담센터 <strong>129</strong> (평일 9~18시)
              </span>
            </div>

            <p className="small muted v2-foot">
              기준: 2026년 기준 중위소득·기초연금 선정기준액(보건복지부). 숫자 기준이 없는 &lsquo;저소득&rsquo;은 기준 중위소득 {LOW_INCOME_PCT}% 이하로 봤어요. 실제 선정은 재산을
              포함한 소득인정액으로 신청처에서 정해요. <Link href="/about#v2">판단 기준 자세히 보기</Link>
            </p>
            <p className="small muted v2-foot" data-testid="data-asof">
              데이터 기준 {new Date(meta.generatedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} · 공식 원천은 매일 자동으로 확인해요. <Link href="/data">데이터 현황</Link>
            </p>
          </div>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function Count({ href, cls, label, n, testId }: { href: string; cls: string; label: string; n: number; testId: string }) {
  return (
    <li>
      <a href={href} className={`v2-count ${cls}`} data-testid={testId}>
        <span className="l">{label}</span> <span className="n">{n.toLocaleString("ko-KR")}</span>
      </a>
    </li>
  );
}

const BUCKET_ICON: Record<Bucket, "check" | "info" | "alert" | "x"> = { fit: "check", office: "info", ask: "alert", no: "x" };

/** 혜택 이름·짧은 요약을 먼저 보여주고, 근거와 신청 정보는 펼쳐서 확인한다. */
type SheetCtl = { has: (id: string) => boolean; toggle: (id: string, on: boolean) => void; receive?: (group: string) => void };

/** '이미 받고 있어요' — 누르면 먼저 확인할 5가지·목록·준비물 한 장에서 빠지고 아래 '이미 받고 있는 혜택'으로 */
function ReceivingButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" className="link-btn sheet-toggle no-print" aria-label={`${name} — 이미 받고 있어요 (목록과 신청 서류 모음에서 빼기)`} onClick={onClick} data-testid="receiving-toggle">
      이미 받고 있어요
    </button>
  );
}

/**
 * 신청 서류 모음 담기/빼기. (2026-10-22 팀 피드백: '담김'을 누를 단추 이름으로 읽어 반대로 보였음)
 * 단추 글자는 누르면 일어날 일, 지금 상태는 앞에 따로 — 담겨 있으면 '✓ 서류 모음에 있음 · 빼기', 아니면 '서류 모음에 담기'.
 */
function SheetToggle({ on, name, onChange }: { on: boolean; name: string; onChange: (on: boolean) => void }) {
  return (
    <span className="sheet-toggle-wrap no-print" data-testid="sheet-state" data-on={on ? "1" : "0"}>
      {on && (
        <span className="sheet-in">
          <Icon name="check" size={16} /> 서류 모음에 있음 ·
        </span>
      )}
      <button type="button" className="link-btn sheet-toggle" aria-label={`${name} — ${on ? "신청 서류 모음에서 빼기" : "신청 서류 모음에 담기"}`} onClick={() => onChange(!on)} data-testid="sheet-toggle">
        {on ? "빼기" : <><Icon name="listChecks" size={16} /> 서류 모음에 담기</>}
      </button>
    </span>
  );
}

function Pick({ item, i, detail, loading, sit, mode, inSheet, onSheet, onReceiving }: { item: V2Item; i: number; detail?: Program; loading?: boolean; sit: Situation; mode: FindMode; inSheet: boolean; onSheet: (on: boolean) => void; onReceiving?: () => void }) {
  const p = item.s.program;
  const how = howTo(detail, p, sit.profile.sido);
  const href = `/p/${encodeURIComponent(p.id)}`;
  return (
    <li className={`card pick ${styles.benefit}`} data-testid="pick" data-bucket={item.bucket}>
      <div className={styles.benefitMain}>
        <div className={styles.benefitText}>
          <div className={styles.benefitTitle}>
            <span className={styles.number} aria-hidden="true">{i + 1}</span>
            <h3><Link href={href}>{p.name}</Link></h3>
            <span className={`v2-badge b-${item.bucket}`}>{BUCKET_LABEL[item.bucket]}</span>
          </div>
          <p className="sum">{firstLine(p.summary, 90)}</p>
          <CardNotes p={detail ?? p} sit={sit} mode={mode} />
        </div>
        <Link href={href} className={`btn btn-tonal btn-sm no-print ${styles.detailLink}`}>자세히 보기 <Icon name="chevronRight" size={16} /></Link>
      </div>
      {/* (2026-10-23 외부 재점검) '빼기'·'이미 받고 있어요'를 접힌 '조건·신청 정보' 밖으로 — 펼치지 않아도 보이게 */}
      <div className="pick-foot pick-actions no-print">
        <SheetToggle on={inSheet} name={p.name} onChange={onSheet} />
        {onReceiving && <ReceivingButton name={p.name} onClick={onReceiving} />}
      </div>
      <details className={styles.cardDetails} data-testid="benefit-more">
        <summary>조건·신청 정보 <Icon name="chevronDown" size={16} /></summary>
        <div className={styles.detailBody}>
          <p className={`v2-why w-${item.bucket}`}>
            <Icon name={BUCKET_ICON[item.bucket]} size={16} /> <span>{plainLine(item, sit, mode)}</span>
          </p>
          <SupportTags p={detail ?? p} />
          <ul className="rows">
            <li>
              <span className="k">신청방법</span>
              <span className="v" data-testid="pick-place">
                {loading ? (
                  <span className="muted" aria-live="polite">
                    신청처 불러오는 중…
                  </span>
                ) : (
                  <>
                    {how.place}
                    {how.channels.length > 0 && ` (${how.channels.map((c) => CHANNEL_LABEL[c]).join(", ")})`}
                  </>
                )}
              </span>
            </li>
            <li>
              <span className="k">담당기관</span>
              <span className="v">{how.agency || p.provider || ownerText(p) || orgText(p)}</span>
            </li>
            {how.phone && !loading && (
              <li>
                <span className="k">문의</span>
                <span className="v">{how.phone}</span>
              </li>
            )}
            {how.bring.length > 0 && !loading && (
              <li>
                <span className="k">가져갈 것</span>
                <span className="v">{how.bring.join(", ")}</span>
              </li>
            )}
          </ul>
          <div className="pick-foot no-print">
            <Link href={`${href}#sec-apply`} className="btn btn-ghost btn-sm">신청 방법 보기</Link>
          </div>
        </div>
      </details>
    </li>
  );
}

function BucketList({
  id, title, lead, groups, sit, mode, collapsed, top, sheet, action,
}: {
  id: string; bucket: Bucket; title: string; lead: string; groups: V2Item[][]; sit: Situation; mode: FindMode; collapsed?: boolean; top?: number; sheet?: SheetCtl; action?: ReactNode;
}) {
  // 뒤로 가기로 돌아와도 펼친 '더 보기'를 유지 (QA 3차 M3) — 이 탭 안에서만, 목록 길이만 기억
  const memKey = `bokji-v2-limit-${id}-${groups.length}`;
  const [limit, setLimitRaw] = useState(() => {
    if (typeof window === "undefined") return top ?? FIRST;
    const n = Number(window.sessionStorage.getItem(memKey));
    return Number.isFinite(n) && n > (top ?? FIRST) ? n : (top ?? FIRST);
  });
  const setLimit = (f: (l: number) => number) =>
    setLimitRaw((l) => {
      const v = f(l);
      try {
        window.sessionStorage.setItem(memKey, String(v));
      } catch {}
      return v;
    });
  if (!groups.length) return null;
  const head = `${title} ${groups.length.toLocaleString("ko-KR")}개`;
  // QA 2차 M1: 수백 개를 한꺼번에 늘어놓지 않고 관련 높은 순 상위 top개를 먼저 보여 준다
  const topNote = top && groups.length > top ? `관련도순 · ${limit}개 표시` : null;
  const body = (
    <>
      <p className="body">{lead}</p>
      {topNote && (
        <p className="body muted" data-testid={`${id}-top-note`}>
          {topNote}
        </p>
      )}
      <div className="v2-list">
        {groups.slice(0, limit).map((g) => (
          <V2Card key={g[0].s.program.id} item={g[0]} more={g.length - 1} sit={sit} mode={mode} sheet={sheet} />
        ))}
      </div>
      {groups.length > limit && (
        <button type="button" className="btn btn-ghost no-print" onClick={() => setLimit((l) => l + MORE)} style={{ marginTop: "1rem" }} data-testid={`${id}-more`}>
          {Math.min(MORE, groups.length - limit)}개 더 보기 ({limit}/{groups.length})
        </button>
      )}
    </>
  );
  if (collapsed) {
    return (
      <div className="v2-sec">
        <details className="details" id={id} data-testid={id}>
          <summary>
            <span className="h3">{head}</span> <Icon name="chevronDown" size={18} />
          </summary>
          <div className="details-body">{body}</div>
        </details>
        {action && <p className="bucket-action no-print">{action}</p>}
      </div>
    );
  }
  return (
    <section className="v2-sec" id={id} aria-labelledby={`${id}-h`} data-testid={id}>
      <h2 className="h2" id={`${id}-h`}>
        {head}
      </h2>
      {body}
    </section>
  );
}

function V2Card({ item, more, sit, mode, sheet }: { item: V2Item; more: number; sit: Situation; mode: FindMode; sheet?: SheetCtl }) {
  const p = item.s.program;
  const where = p.provider || ownerText(p);
  return (
    <article className={`prow v2-card b-${item.bucket} ${styles.benefit}`} data-testid="v2-card" data-bucket={item.bucket}>
      <div className={styles.benefitMain}>
        <div className={styles.benefitText}>
          <div className={styles.benefitTitle}>
            <h3><Link href={`/p/${encodeURIComponent(p.id)}`}>{p.name}</Link></h3>
            <span className={`v2-badge b-${item.bucket}`}>{BUCKET_LABEL[item.bucket]}</span>
          </div>
          {p.summary && <p className="sum">{firstLine(p.summary, 90)}</p>}
          <CardNotes p={p} sit={sit} mode={mode} />
          <ClosedNote p={p} />
        </div>
        <Link href={`/p/${encodeURIComponent(p.id)}`} className={`btn btn-tonal btn-sm no-print ${styles.detailLink}`}>자세히 보기 <Icon name="chevronRight" size={16} /></Link>
      </div>
      {sheet && (
        <div className="pick-foot pick-actions no-print">
          <SheetToggle on={sheet.has(p.id)} name={p.name} onChange={(on) => sheet.toggle(p.id, on)} />
          {sheet.receive && <ReceivingButton name={p.name} onClick={() => sheet.receive!(item.s.group)} />}
        </div>
      )}
      <details className={styles.cardDetails} data-testid="benefit-more">
        <summary>조건·신청 정보 <Icon name="chevronDown" size={16} /></summary>
        <div className={styles.detailBody}>
          <p className={`v2-why w-${item.bucket}`}>
            <Icon name={BUCKET_ICON[item.bucket]} size={16} /> <span>{plainLine(item, sit, mode)}</span>
          </p>
          <SupportTags p={p} />
          <p className="meta">
            <span>{orgText(p)}</span>
            {where && <span>{where.length > 30 ? where.slice(0, 29) + "…" : where}</span>}
            <ApplyBadge p={p} />
            {!item.reviewed && <span title="원문에서 자동으로 정리한 조건이에요">자동 정리 조건</span>}
            {more > 0 && <span>다른 기관 같은 사업 {more}개</span>}
          </p>
        </div>
      </details>
    </article>
  );
}

/** 만 19세 미만 본인 (QA 5차 검증 N2) */
function isTeenSelf(sit: Situation, mode: FindMode): boolean {
  if (mode !== "self") return false;
  const b = ageBoundsOf(sit);
  return !!b && b[1] <= 18;
}

/** 함께 사는 부모님께 맞는 혜택 (결정 1b): 그분 나이대를 고르면 같은 지역 부모님 찾기 기준 먼저 확인할 5가지. 고른 나이는 이 화면에서만 씀(저장·전송 안 함) */
const COHAB_BANDS = ["60-64", "65-69", "70-74", "75-79", "80+"] as const;
function CohabitParent({ programs, sit }: { programs: Program[]; sit: Situation }) {
  const [band, setBand] = useState<(typeof COHAB_BANDS)[number] | null>(null);
  const picks = useMemo(() => (band ? cohabitParentPicks(programs, sit, band) : []), [programs, sit, band]);
  const ps = band ? cohabitParentSit(sit, band) : null;
  return (
    <section className="v2-sec cohab no-print" aria-labelledby="cohab-h" data-testid="cohab-parent">
      <h2 className="h2" id="cohab-h">
        함께 사시는 부모님께 맞는 혜택
      </h2>
      <p className="body">함께 사는 부모님의 나이대를 선택하세요.</p>
      <div className="btn-row v2-answers" role="group" aria-label="함께 사시는 분 나이대">
        {COHAB_BANDS.map((b) => (
          <button key={b} type="button" className={`btn btn-sm ${band === b ? "btn-primary" : "btn-ghost"}`} aria-pressed={band === b} onClick={() => setBand(b)} data-testid={`cohab-age-${b}`}>
            {AGE_LABEL[b]}
          </button>
        ))}
      </div>
      {band && ps && (
        <>
          {picks.length > 0 ? (
            <div className="v2-list" data-testid="cohab-picks">
              {picks.map((g) => (
                <V2Card key={g[0].s.program.id} item={g[0]} more={g.length - 1} sit={ps} mode="parent" />
              ))}
            </div>
          ) : (
            <p className="muted">이 나이대로 먼저 확인할 혜택을 고르지 못했어요.</p>
          )}
          <p className="small muted">그분 나이대만으로 고른 것이에요. 소득·건강·장기요양 등을 더 답하시려면 &lsquo;부모님 기준으로 따로 찾기&rsquo;를 이용하세요.</p>
        </>
      )}
    </section>
  );
}

/** 원문 신청기간이 끝난 사업 */
function ClosedNote({ p }: { p: Program }) {
  const d = periodEnded(p);
  if (!d) return null;
  return (
    <p className="small closed-note" data-testid="closed-note">
      <Icon name="info" size={16} /> 이번 신청 기간이 {dateLabel(d)}에 끝났어요 (원문 기준). 다음 접수는 문의처에서 확인하세요.
    </p>
  );
}

/** 카드 안내 — 원문에 적힌 경우에만 (추측해서 붙이지 않음) */
function CardNotes({ p, sit, mode }: { p: Program; sit: Situation; mode: FindMode }) {
  const teen = isTeenSelf(sit, mode);
  const consent0 = teen ? parentConsent(p) : null;
  // '만 14세 미만은 동의' 처럼 나이가 한정돼 있으면 그 나이 이상인 사람에게는 붙이지 않음
  const under = consent0 ? consentUnderAge(consent0) : null;
  const span = ageSpanOf(sit) ?? ageBoundsOf(sit);
  const consent = consent0 && !(under !== null && span && span[0] >= under) ? consent0 : null;
  // 이름은 '청소년'이지만 원문상 만 24세까지 — 19~24세 성인도 이용 가능 (QA 5차 검증)
  const upTo24 = !teen && mode !== "parent" && youthUpTo24(p);
  if (!consent && !upTo24) return null;
  return (
    <p className="card-notes">
      {consent && (
        <span className="note-chip" data-testid="note-consent" title={`원문: “…${consent}…”`}>
          {under !== null ? `만 ${under}세 미만은 부모(보호자) 동의 필요` : "부모(보호자) 동의 필요"} — 원문에 적혀 있어요
        </span>
      )}
      {upTo24 && (
        <span className="note-chip" data-testid="note-upto24">
          만 24세까지 이용할 수 있어요
        </span>
      )}
    </p>
  );
}

/**
 * 만 19세 미만 본인에게 — 연락처는 우리 데이터의 원문에서만 옮김:
 * 청소년전화1388 운영 지원(n.gov24-WII000000790): 유선 1388 / 휴대전화 지역번호+1388
 * 학교 밖 청소년 지원센터 운영(n.gov24-WII000000810): 문자 #1388, ☎ 1388
 * 학교 밖 청소년 건강검진 지원(n.gov24-138300000033): 꿈드림 누리집 www.kdream.or.kr
 */
function TeenNote() {
  return (
    <aside className="notice teen-note" data-testid="teen-note" aria-label="청소년 상담 안내">
      <Icon name="info" size={18} />
      <span>
        <strong>혼자 고민하지 않아도 돼요.</strong> 청소년전화 <strong>1388</strong>(휴대전화는 지역번호+1388, 문자 #1388)에서 상담할 수 있어요. 학교에 다니지 않는다면 가까운{" "}
        <strong>학교밖청소년지원센터 ‘꿈드림’</strong>(☎ 1388 · www.kdream.or.kr)이 상담·검정고시·건강검진을 도와줘요. 출처:{" "}
        <Link href={`/p/${encodeURIComponent("n.gov24-WII000000790")}`}>청소년전화1388 운영 지원</Link>,{" "}
        <Link href={`/p/${encodeURIComponent("n.gov24-WII000000810")}`}>학교 밖 청소년 지원센터 운영</Link>,{" "}
        <Link href={`/p/${encodeURIComponent("n.gov24-138300000033")}`}>학교 밖 청소년 건강검진 지원</Link> 원문
      </span>
    </aside>
  );
}

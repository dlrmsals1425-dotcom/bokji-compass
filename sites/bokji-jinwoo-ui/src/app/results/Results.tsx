"use client";
import { replaceUrl } from "@/lib/client/url";
import { useEffect, useMemo, useState } from "react";
import Link from "@/components/SiteLink";
import { useRouter, useSearchParams } from "next/navigation";
import { ProgramCard, SupportTags } from "@/components/ProgramCard";
import { TierBadge, orgText, ownerText } from "@/components/Badges";
import { Icon } from "@/components/Icon";
import { CHANNEL_LABEL, TIER_PLAIN, firstLine, howTo, metReasons, toCheck } from "@/lib/client/howto";
import type { Program } from "@/lib/data/types";
import { clearProfile, saveMode, useExample, useMode, useProfile, useQuickResults } from "@/lib/client/storage";
import { startPreset } from "@/lib/client/start";
import { loadForRegion, loadProgram, type Loaded } from "@/lib/client/bundles";
import { applyFilters, autoGroups, eduCount, facetCounts, groupVariants, industryCount, operatorCount, scoreAll, topPicks, type Filters, type Group } from "@/lib/client/results";
import { PRESETS, presetById } from "@/lib/client/presets";
import { MODE_ENTRY, coupleNote, parseFindMode, resultsCopy, resultsPath, withV1, type FindMode } from "@/lib/client/mode";
import { profileChips } from "@/lib/client/summary";
import { CATEGORIES, ORG_TYPE_LABEL, type Category, type OrgType } from "@/lib/data/types";
import { TIER_LABEL, type Tier } from "@/lib/engine/types";
import { answeredCount, type Profile } from "@/lib/engine/profile";
import { ResultsV2 } from "./ResultsV2";

const TABS: Tier[] = ["eligible", "likely", "check"];
const ORGS: OrgType[] = ["central", "metro", "local", "public_inst"];
/** 처음에는 관련도 상위 10개만 크게 보여 주고, '더 보기'로 20개씩 */
const FIRST = 10;
const PAGE = 20;

function Skeleton({ label }: { label: string }) {
  return (
    <div className="wrap page results-root" aria-busy="true" aria-live="polite">
      <p className="muted">{label}</p>
      <div className="skeleton" aria-hidden="true">
        <div className="sk" />
        <div className="sk" />
        <div className="sk" />
      </div>
    </div>
  );
}

export function Results() {
  const profile = useProfile();
  const mode = useMode();
  const savedQuick = useQuickResults();
  // 기본은 '상황 먼저' 결과. ?v=1 은 예전 결과 화면 (비교용 숨은 표시, 주소 정리 때도 유지)
  const v1 = useSearchParams().get("v") === "1";
  const quick = useSearchParams().get("quick") === "1" || savedQuick === true;
  const keepV1 = (path: string) => v1 ? withV1(path) : quick ? `${path}${path.includes("?") ? "&" : "?"}quick=1` : path;
  // /results?example=<id>&for=parent 링크로 예시·모드를 바로 연다
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("example");
    const forParam = parseFindMode(params.get("for"));
    const preset = PRESETS.find((x) => x.id === id);
    if (preset) {
      const m = forParam ?? preset.mode ?? "self";
      startPreset(preset, m);
      replaceUrl(keepV1(resultsPath(m)));
    } else if (forParam) {
      saveMode(forParam);
      replaceUrl(keepV1(resultsPath(forParam)));
    } else if (params.get("v") === "2") {
      // 예전 시험판 주소 (/results?v=2) → 기본 화면
      replaceUrl("/results");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only URL bootstrap
  }, []);
  if (profile === undefined || mode === undefined || savedQuick === undefined) return <Skeleton label="불러오는 중…" />;
  if (profile === null) {
    const copy = resultsCopy(mode);
    return (
      <div className="narrow page">
        <h1 className="h1">{copy.emptyTitle}</h1>
        <p className="lead">{copy.emptyLead}</p>
        <div className="path-choice path-choice-compact" role="group" aria-label="찾기 대상 고르기">
          <Link href={MODE_ENTRY.self.href} className="path-card" data-testid="empty-start-self">
            <span className="path-t">{copy.emptySelf}</span>
            <span className="path-d">{MODE_ENTRY.self.desc}</span>
          </Link>
          <Link href={MODE_ENTRY.parent.href} className="path-card path-parent" data-testid="empty-start-parent">
            <span className="path-t">{copy.emptyParent}</span>
            <span className="path-d">{MODE_ENTRY.parent.desc}</span>
          </Link>
        </div>
      </div>
    );
  }
  if (v1) return <ResultsInner profile={profile} mode={mode} key={JSON.stringify(profile) + mode} />;
  return <ResultsV2 profile={profile} mode={mode} quick={quick} />;
}

function ResultsInner({ profile, mode }: { profile: Profile; mode: FindMode }) {
  const copy = resultsCopy(mode);
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [f, setF] = useState<Filters>({ tier: "eligible", category: null, org: null, q: "" });
  const [limit, setLimit] = useState(FIRST);
  const example = useExample();
  const preset = presetById(example);
  const [toast, setToast] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [details, setDetails] = useState<Record<string, Program>>({});
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoLimit, setAutoLimit] = useState(FIRST);

  useEffect(() => {
    let alive = true;
    loadForRegion(profile.sido, profile.sigungu).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [profile.sido, profile.sigungu]);

  const scored = useMemo(() => (data ? scoreAll(data.programs, profile) : []), [data, profile]);
  const counts = useMemo(() => facetCounts(scored, f), [scored, f]);
  const groups = useMemo(() => groupVariants(applyFilters(scored, f)), [scored, f]);
  const edu = useMemo(() => eduCount(scored, f), [scored, f]);
  const industry = useMemo(() => industryCount(scored, f), [scored, f]);
  const operator = useMemo(() => operatorCount(scored, f), [scored, f]);
  // 자동 제공·기관 선정 사업 (본문에서 빼고 아래 접힌 영역에) — 분야·기관·검색·기본 숨김 필터는 본문과 같게
  const autos = useMemo(() => autoGroups(scored, f), [scored, f]);
  // 머리글 합계: 분야·기관·검색 필터는 빼고, 기본 숨김(교육청·복지 외 분야) 설정만 반영한 카드 수
  const total = useMemo(
    () => facetCounts(scored, { tier: "eligible", category: null, org: null, q: "", includeEdu: f.includeEdu, includeIndustry: f.includeIndustry, includeOperator: f.includeOperator }).tiers,
    [scored, f.includeEdu, f.includeIndustry, f.includeOperator],
  );
  const picks = useMemo(
    () => topPicks(scored, { includeEdu: f.includeEdu, includeIndustry: f.includeIndustry, includeOperator: f.includeOperator }, 5),
    [scored, f.includeEdu, f.includeIndustry, f.includeOperator],
  );

  // 추천 5개는 신청 방법(어디서·무엇을 가져가서)을 보여 주려고 상세 묶음을 따로 불러온다
  const pickIds = picks.map((g) => g.lead.program.id).join("|");
  useEffect(() => {
    if (!pickIds) return;
    let alive = true;
    Promise.all(pickIds.split("|").map((id) => loadProgram(id))).then((ps) => {
      if (!alive) return;
      const out: Record<string, Program> = {};
      ps.forEach((p) => p && (out[p.id] = p));
      setDetails(out);
    });
    return () => {
      alive = false;
    };
  }, [pickIds]);

  const update = (patch: Partial<Filters>) => {
    setF((prev) => ({ ...prev, ...patch }));
    setLimit(FIRST);
    setAutoLimit(FIRST);
  };

  // 처음 열었을 때 '조건 충족'이 0개면 '가능성 있음' 탭부터 보여준다
  const [autoTabDone, setAutoTabDone] = useState(false);
  if (data && !autoTabDone) {
    setAutoTabDone(true);
    if (total.eligible === 0) setF((prev) => ({ ...prev, tier: total.likely ? "likely" : "check" }));
  }

  if (!data) return <Skeleton label="내 지역 서비스를 불러와 이 기기에서 판정하고 있어요…" />;

  const chips = profileChips(profile, data.label);
  const answered = answeredCount(profile);
  const filtered = !!(f.category || f.org || f.q);
  const share = async () => {
    const top = picks.map((g) => `· ${g.lead.program.name}`);
    const text = [
      copy.shareLead(data.label, total.eligible, total.likely, total.check),
      ...top,
      "(입력한 개인 정보는 공유되지 않아요. 직접 확인해 보세요)",
    ].join("\n");
    const url = window.location.origin;
    try {
      if (navigator.share) await navigator.share({ title: "복지나침반", text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setToast("결과 요약을 복사했어요 (입력값은 포함되지 않아요)");
        setTimeout(() => setToast(null), 2500);
      }
    } catch {}
  };
  const place = data.label.split(" ").pop();

  const TILE_DESC: Record<Tier, string> = { eligible: "지금 신청해 볼 수 있어요", likely: "한두 가지만 더 확인해요", check: "기관에 물어봐야 알아요", ineligible: "" };
  const pickTier = (tier: Tier) => {
    update({ tier });
    document.getElementById("list-h")?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="results-root">
      <div className="print-only wrap">
        <strong>복지나침반 결과 요약</strong> — 출력일 {new Date().toLocaleDateString("ko-KR")}
      </div>
      <section className="res-head" aria-labelledby="res-h">
        <div className="wrap">
          <ol className="crumbs no-print" aria-label="현재 위치">
            <li>
              <Link href="/">
                <Icon name="home" size={14} /> 홈
              </Link>
            </li>
            <li>
              <Link href={copy.checkHref}>{copy.crumbCheck}</Link>
            </li>
            <li>
              <span aria-current="page">결과</span>
            </li>
          </ol>
          {mode === "parent" && (
            <p className="notice warm" data-testid="parent-results-banner" role="note">
              <Icon name="heart" size={18} />
              <span>
                <strong>부모님 복지 찾기</strong> — 자녀·가족이 대신 알아본 결과입니다. 판정은 부모님 상황을 기준으로 했습니다.
              </span>
            </p>
          )}
          {coupleNote(mode, profile) && (
            <p className="notice" data-testid="couple-note" role="note">
              <Icon name="info" size={18} />
              <span>
                <strong>부모님 두 분이 함께 사시면</strong> — {coupleNote(mode, profile)}
              </span>
            </p>
          )}
          {preset && (
            <p className="notice warm" data-testid="example-banner" role="note">
              <Icon name="info" size={18} />
              <span>
                <strong>예시 상황으로 보는 중입니다.</strong> {preset.title}({preset.desc})인 경우로 계산했습니다. 실제 개인 정보가 아닙니다.{" "}
                <Link href={copy.checkHref}>{copy.reenterLabel}</Link>
              </span>
            </p>
          )}
          <h1 className="h1" id="res-h">
            {place}
            {copy.h1Suffix}
          </h1>
          <p className="situation">
            <span>
              <Icon name="mapPin" size={16} className="icon-inline" />{" "}
              {copy.situationPrefix ? `${copy.situationPrefix}: ` : ""}
              {chips.join(" · ")}
            </span>
            <span className="muted">(12개 중 {answered}개 입력)</span>
            <Link href={copy.checkHref} className="no-print">
              {copy.editLabel}
            </Link>
          </p>
          <div className="tiles no-print" aria-label="판정 결과별 개수">
            {TABS.map((tr) => (
              <button
                key={tr}
                type="button"
                className={`tile t-${tr}`}
                aria-pressed={f.tier === tr}
                aria-controls="result-list"
                onClick={() => pickTier(tr)}
                data-testid={`tab-${tr}`}
              >
                <span className="l">{TIER_LABEL[tr]}</span>
                <span className="n">{counts.tiers[tr].toLocaleString("ko-KR")}</span>
                <span className="d">{TILE_DESC[tr]}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="wrap page">
        <div className="layout">
          <div>
            {answered < 6 && (
              <p className="notice warm" style={{ marginBottom: "1.5rem" }}>
                <Icon name="alert" size={18} />
                <span>
                  {copy.sparseWarn} <Link href={copy.checkHref}>항목을 더 입력</Link>
                </span>
              </p>
            )}

            {picks.length > 0 && (
              <section aria-labelledby="picks-h" data-testid="top-picks" style={{ marginBottom: "3rem" }}>
                <div className="sec-head" style={{ marginBottom: "1rem" }}>
                  <div>
                    <h2 className="h2" id="picks-h">
                      {copy.picksTitle(picks.length)}
                    </h2>
                    <p>{copy.picksLead}</p>
                  </div>
                </div>
                <ol className="picks">
                  {picks.map((g, i) => (
                    <Pick key={g.key} g={g} i={i} detail={details[g.lead.program.id]} />
                  ))}
                </ol>
              </section>
            )}

            <h2 className="h2" id="list-h">
              {copy.listTitle(picks.length > 0)}
            </h2>
            <p className="body">{copy.listLead((total.eligible + total.likely + total.check).toLocaleString("ko-KR"))}</p>

            <div className="refine no-print">
              <div className="grow">
                <label htmlFor="rq" className="label">
                  결과 안에서 찾기
                </label>
                <input id="rq" type="search" className="input" placeholder="예: 돌봄, 의료비" value={f.q} onChange={(e) => update({ q: e.target.value })} />
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                aria-expanded={filtersOpen}
                aria-controls="filter-body"
                onClick={() => setFiltersOpen((o) => !o)}
                data-testid="filter-toggle"
                style={{ minHeight: "3rem" }}
              >
                <Icon name="sliders" size={18} /> 기관·분야로 좁히기{f.category || f.org ? " (적용 중)" : ""}
              </button>
            </div>
            <div id="filter-body" className={`filters ${filtersOpen ? "open" : ""}`} role="group" aria-label="결과 좁히기">
              <div className="select-row">
                <div>
                  <label htmlFor="f-org" className="label">
                    기관 유형
                  </label>
                  <select id="f-org" className="select" value={f.org ?? ""} onChange={(e) => update({ org: (e.target.value || null) as OrgType | null })}>
                    <option value="">전체</option>
                    {ORGS.filter((o) => (counts.orgs.get(o) ?? 0) > 0 || f.org === o).map((o) => (
                      <option key={o} value={o}>
                        {ORG_TYPE_LABEL[o]} ({counts.orgs.get(o) ?? 0})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="f-cat" className="label">
                    분야
                  </label>
                  <select id="f-cat" className="select" value={f.category ?? ""} onChange={(e) => update({ category: (e.target.value || null) as Category | null })}>
                    <option value="">전체</option>
                    {CATEGORIES.filter((c) => (counts.cats.get(c) ?? 0) > 0 || f.category === c).map((c) => (
                      <option key={c} value={c}>
                        {c} ({counts.cats.get(c) ?? 0})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <fieldset className="hidden-toggles">
                <legend>기본으로 숨긴 서비스</legend>
                <label>
                  <input type="checkbox" checked={!!f.includeIndustry} onChange={(e) => update({ includeIndustry: e.target.checked })} data-testid="include-industry" />
                  <span>
                    농림축산어업·사업자(창업·소상공인) 대상도 보기 <span className="muted">({industry.toLocaleString("ko-KR")}개)</span>
                  </span>
                </label>
                <label>
                  <input type="checkbox" checked={!!f.includeOperator} onChange={(e) => update({ includeOperator: e.target.checked })} data-testid="include-operator" />
                  <span>
                    기관·시설 운영 지원 사업도 보기 <span className="muted">({operator.toLocaleString("ko-KR")}개)</span>
                  </span>
                </label>
                <label>
                  <input type="checkbox" checked={!!f.includeEdu} onChange={(e) => update({ includeEdu: e.target.checked })} data-testid="include-edu" />
                  <span>
                    교육청 서비스도 보기 <span className="muted">({edu.toLocaleString("ko-KR")}개)</span>
                  </span>
                </label>
              </fieldset>
              {filtered && (
                <button type="button" className="btn btn-text" onClick={() => update({ category: null, org: null, q: "" })}>
                  조건 모두 지우기
                </button>
              )}
            </div>

            <div className="tabs" role="tablist" aria-label="판정 결과">
              {TABS.map((tr) => (
                <button
                  key={tr}
                  role="tab"
                  type="button"
                  className="tab"
                  aria-selected={f.tier === tr}
                  aria-controls="result-list"
                  onClick={() => update({ tier: tr })}
                  data-testid={`list-tab-${tr}`}
                >
                  {TIER_LABEL[tr]} <span className="c">{counts.tiers[tr].toLocaleString("ko-KR")}</span>
                </button>
              ))}
            </div>

            <section id="result-list" data-testid="result-list" role="tabpanel" aria-label={TIER_LABEL[f.tier]}>
              <p className="tier-note">{TIER_PLAIN[f.tier]}</p>
              <p className="list-head" aria-live="polite">
                {TIER_LABEL[f.tier]} {groups.length.toLocaleString("ko-KR")}개{filtered ? " (필터 적용)" : ""}
                {groups.length > limit ? ` · 관련 깊은 순으로 ${Math.min(limit, groups.length)}개` : ""}
              </p>
              {groups.length === 0 ? (
                <div className="empty">
                  <p>이 조건에 해당하는 서비스가 없습니다.</p>
                  {f.tier === "eligible" && (
                    <p className="small" style={{ marginTop: "0.375rem" }}>
                      &lsquo;조건 충족&rsquo;은 검수 규칙·API 지원조건이 있는 서비스만 해당합니다. &lsquo;가능성 있음&rsquo;도 확인해 보세요.
                    </p>
                  )}
                </div>
              ) : (
                <div className="list">
                  {groups.slice(0, limit).map((g) => (
                    <ProgramCard key={g.key} p={g.lead.program} ev={g.lead.ev} variants={g.variants.map((v) => ({ p: v.program, ev: v.ev }))} />
                  ))}
                </div>
              )}
              {groups.length > limit && (
                <div className="more-row no-print">
                  <button type="button" className="btn btn-ghost" onClick={() => setLimit((l) => l + PAGE)} data-testid="more">
                    더 보기 ({(groups.length - limit).toLocaleString("ko-KR")}개 남음) <Icon name="chevronDown" size={18} />
                  </button>
                </div>
              )}
              <div className="no-print" style={{ marginTop: "0.75rem", textAlign: "center" }}>
                {f.tier === "ineligible" ? (
                  <button type="button" className="btn btn-text" onClick={() => update({ tier: "eligible" })}>
                    판정 결과로 돌아가기
                  </button>
                ) : (
                  <button type="button" className="btn btn-text" onClick={() => update({ tier: "ineligible" })} data-testid="show-ineligible">
                    조건이 맞지 않는 서비스 {total.ineligible.toLocaleString("ko-KR")}개도 보기
                  </button>
                )}
              </div>
            </section>

            {autos.length > 0 && (
              <details className="details auto-panel" data-testid="auto-section" open={autoOpen} onToggle={(e) => setAutoOpen((e.currentTarget as HTMLDetailsElement).open)}>
                <summary data-testid="auto-toggle">
                  <span>
                    신청하지 않아도 받는 서비스 <span className="s">— 조건이 맞으면 기관이 알아서 제공해요</span>
                  </span>
                  <span className="c">
                    <span data-testid="auto-count">{autos.length.toLocaleString("ko-KR")}</span>개 <Icon name="chevronDown" size={18} />
                  </span>
                </summary>
                {autoOpen && (
                  <div className="details-body">
                    <p className="body">
                      대상이 되면 기관이 알아서 지급·연계하거나(공단 명단 통보, 수급자 선정 시 연계, 담당 공무원 직권 처리), 학교·시설·기관이 추천·선정하는
                      서비스입니다. 해당될 것 같은데 받고 있지 않다면 주민센터나 129에 물어보세요.
                    </p>
                    <div className="list">
                      {autos.slice(0, autoLimit).map((g) => (
                        <ProgramCard key={g.key} p={g.lead.program} ev={g.lead.ev} variants={g.variants.map((v) => ({ p: v.program, ev: v.ev }))} />
                      ))}
                    </div>
                    {autos.length > autoLimit && (
                      <div className="more-row no-print">
                        <button type="button" className="btn btn-ghost" onClick={() => setAutoLimit((l) => l + PAGE)} data-testid="auto-more">
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
            <p className="disclaimer">
              이 결과는 공개된 자격 조건과 입력하신 정보만으로 계산한 안내이며, 실제 선정은 소득·재산 조사 등 기관 심사로 결정됩니다. 검수 전인 자동 변환
              규칙은 최대 &lsquo;가능성 있음&rsquo;까지만 판정합니다. 신청 방법은 원문 문구로 분류한 것이니 정확한 절차는 기관에 확인하세요.
            </p>
          </div>

          <aside className="side" aria-label="이 결과에 대해">
            <section className="side-box">
              <h2>
                <Icon name="listChecks" size={18} /> 판단 방법
              </h2>
              <ul>
                <li>공개된 지원 대상 조건과 입력하신 내용을 비교했습니다.</li>
                <li>소득·재산처럼 입력하지 않은 조건은 &lsquo;확인&rsquo;으로 남겼습니다.</li>
                <li>최종 결정은 담당 기관이 합니다.</li>
              </ul>
              <Link href="/about">판정 기준 자세히 보기</Link>
            </section>
            <section className="side-box no-print">
              <h2>
                <Icon name="fileText" size={18} /> 이 결과로 할 수 있는 일
              </h2>
              <ul className="link-list">
                <li>
                  <button type="button" className="link-btn" onClick={() => window.print()}>
                    <Icon name="printer" size={18} /> 인쇄하거나 PDF로 저장
                  </button>
                </li>
                <li>
                  <button type="button" className="link-btn" onClick={share}>
                    <Icon name="share" size={18} /> 결과 공유
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      clearProfile();
                      router.push("/");
                    }}
                  >
                    <Icon name="trash" size={18} /> 이 기기에서 지우기
                  </button>
                </li>
              </ul>
            </section>
            <section className="side-box">
              <h2>
                <Icon name="phone" size={18} /> 상담이 필요하면
              </h2>
              <p>
                보건복지상담센터 <strong>129</strong>
                <br />
                <span className="muted">평일 9시~18시, 긴급 24시간</span>
              </p>
            </section>
          </aside>
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

/** 먼저 확인할 서비스 카드: 번호 · 지원형태 · 이름 · 판단 · 신청방법/기관/문의/가져갈 것 */
function Pick({ g, i, detail }: { g: Group; i: number; detail?: Program }) {
  const p = g.lead.program;
  const ev = g.lead.ev;
  const how = howTo(detail, p);
  const met = metReasons(ev, 2);
  const check = ev.tier !== "eligible" ? toCheck(ev) : undefined;
  const href = `/p/${encodeURIComponent(p.id)}`;
  return (
    <li className="card pick">
      <div className="pick-top">
        <span className="pick-no" aria-hidden="true">
          {i + 1}
        </span>
        <SupportTags p={detail ?? p} />
      </div>
      <h3>
        <Link href={href}>{p.name}</Link>
      </h3>
      <p className="sum">{firstLine(p.summary, 90)}</p>
      <p className="judge">
        <TierBadge tier={ev.tier} />
        {met.length > 0 && <> — {met.join(", ")}에 해당합니다.</>}
        {check && <> 신청할 때 확인할 것: {check}</>}
      </p>
      <ul className="rows">
        <li>
          <span className="k">신청방법</span>
          <span className="v">
            {how.place}
            {how.channels.length > 0 && ` (${how.channels.map((c) => CHANNEL_LABEL[c]).join(", ")})`}
          </span>
        </li>
        <li>
          <span className="k">담당기관</span>
          <span className="v">{p.provider || ownerText(p) || orgText(p)}</span>
        </li>
        {how.phone && (
          <li>
            <span className="k">문의</span>
            <span className="v">{how.phone}</span>
          </li>
        )}
        {how.bring.length > 0 && (
          <li>
            <span className="k">가져갈 것</span>
            <span className="v">{how.bring.join(", ")}</span>
          </li>
        )}
      </ul>
      <div className="pick-foot no-print">
        <Link href={href} className="btn btn-tonal btn-sm">
          자세히 보기
        </Link>
        <Link href={`${href}#sec-apply`} className="btn btn-ghost btn-sm">
          신청 방법 보기
        </Link>
      </div>
    </li>
  );
}

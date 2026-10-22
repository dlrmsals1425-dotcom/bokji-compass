"use client";
import { sidoOptionLabel } from "@/lib/client/regionLabel";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ProgramCard } from "@/components/ProgramCard";
import { Icon } from "@/components/Icon";
import { EMPTY_SELECTION, HOUSEHOLD, LIFE, TOPICS, matchesSelection, parseSelection, selectionQuery, selectionSize, type FacetSelection } from "@/lib/client/facets";
import { loadForRegion, loadRegions, type Loaded } from "@/lib/client/bundles";
import { saveSearchRegion, useExtras, useMode, useProfile, useSearchRegion } from "@/lib/client/storage";
import { situationOf } from "@/lib/client/start";
import { classifyOne, plainLine } from "@/lib/client/v2";
import { evaluateProgram, matchesQuery, nameHitScore, queryHitCount } from "@/lib/client/results";
import { isGibberish, queryTokens } from "@/lib/client/query";
import { CrisisHelp } from "@/components/CrisisHelp";
import { parseSituation, prefillPath, savePrefill, understoodLine } from "@/lib/client/parse";
import type { Program, RegionIndex } from "@/lib/data/types";
import type { Situation } from "@/lib/client/v2";

const PAGE = 30;

function judgeOf(p: Program, sit: Situation) {
  const it = classifyOne(p, sit);
  return { bucket: it.bucket, line: plainLine(it, sit, sit.mode ?? "self") };
}

export function Search() {
  const params = useSearchParams();
  const router = useRouter();
  const profile = useProfile();
  const extras = useExtras();
  const storedMode = useMode();
  // (QA 8차) 저장된 상황이 있으면 맞춤 결과·상세와 같은 판정(받으실 수 있어요·신청할 때 확인 …)으로 보여 준다
  const sit = useMemo(() => (profile ? situationOf(profile, extras ?? null, storedMode ?? "self") : null), [profile, extras, storedMode]);
  const q = params.get("q") ?? "";
  const [input, setInput] = useState(q);
  const [regions, setRegions] = useState<RegionIndex | null>(null);
  // (QA 8차) 고른 검색 지역은 이 기기에 기억 — 새로고침·다시 열기에도 유지 (주소에는 싣지 않음)
  const pick = useSearchRegion() ?? null;
  // 받은 데이터와 그 지역 — 지역을 바꾸면 새 데이터가 올 때까지 이전 지역 목록을 새 지역 이름으로 보여 주지 않게
  const [loaded, setLoaded] = useState<{ key: string; data: Loaded } | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const chosenSido = pick ? pick.sido : (profile?.sido ?? null);
  const chosenSigungu = pick ? pick.sigungu : (profile?.sigungu ?? null);
  // 검색어를 상황 문장으로도 읽어 본다 (기기 안에서만)
  const parsed = useMemo(() => (q.trim() && regions ? parseSituation(q, regions) : null), [q, regions]);
  // 시·도를 고르지 않았는데 검색어에 지역 낱말이 있으면 그 지역 사업까지 포함
  const autoRegion = !chosenSido && !!parsed?.profile.sido;
  const sido = autoRegion ? parsed!.profile.sido : chosenSido;
  const sigungu = autoRegion ? parsed!.profile.sigungu : chosenSigungu;
  const exclude = useMemo(() => (parsed && parsed.profile.sido && parsed.profile.sido === sido ? parsed.regionTerms : []), [parsed, sido]);
  const situation = !!parsed?.looksLikeSituation && parsed.understood.some((u) => u.key !== "region");

  useEffect(() => {
    loadRegions().then(setRegions);
  }, []);
  const choose = (r: { sido: string | null; sigungu: string | null }) => saveSearchRegion(r);
  useEffect(() => {
    let alive = true;
    loadForRegion(sido, sigungu).then((d) => alive && setLoaded({ key: `${sido}/${sigungu}`, data: d }));
    return () => {
      alive = false;
    };
  }, [sido, sigungu]);

  const data = loaded && loaded.key === `${sido}/${sigungu}` ? loaded.data : null;
  const sel = useMemo(() => parseSelection(new URLSearchParams(params.toString())), [params]);
  const active = !!q.trim() || selectionSize(sel) > 0;
  const apply = (nq: string, ns: FacetSelection) => {
    setLimit(PAGE);
    router.replace(`/search${selectionQuery(nq, ns)}`, { scroll: false });
  };
  const toggle = (group: keyof FacetSelection, id: string) => {
    const cur = sel[group];
    apply(q, { ...sel, [group]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  const { hits, partial } = useMemo(() => {
    if (!data || !active) return { hits: [], partial: false };
    // 'ㅁㄴㅇㄹ' 처럼 알아볼 글자가 없으면 전체 목록 대신 0건 (QA 1차 M4)
    if (isGibberish(q) && selectionSize(sel) === 0) return { hits: [], partial: false };
    const inSel = data.programs.filter((p) => matchesSelection(p, sel));
    const byName = <T extends { n: number; p: (typeof inSel)[number] }>(xs: T[]) =>
      xs.map((x) => ({ ...x, s: nameHitScore(x.p, q, exclude) })).sort((a, b) => b.n - a.n || b.s - a.s);
    const all = byName(inSel.filter((p) => !q.trim() || matchesQuery(p, q, exclude)).map((p) => ({ p, n: 0 }))).map((x) => x.p);
    // 모든 낱말이 들어간 결과가 없으면 일부 낱말이 맞는 결과를 많이 맞는 순으로
    if (all.length || !q.trim() || queryTokens(q, exclude).flat().length < 2) return { hits: all, partial: false };
    const scored = byName(inSel.map((p) => ({ p, n: queryHitCount(p, q, exclude) })).filter((x) => x.n > 0));
    return { hits: scored.map((x) => x.p), partial: scored.length > 0 };
  }, [data, q, sel, active, exclude]);

  const sidoObj = regions?.sidos.find((s) => s.code === sido);
  const chosen = [
    ...LIFE.filter((f) => sel.life.includes(f.id)).map((f) => ({ group: "life" as const, id: f.id, label: f.label })),
    ...HOUSEHOLD.filter((f) => sel.house.includes(f.id)).map((f) => ({ group: "house" as const, id: f.id, label: f.label })),
    ...sel.topic.map((c) => ({ group: "topic" as const, id: c, label: c })),
  ];
  // (2026-10-23 외부 재점검 P1) 지역을 고르지 않으면 전국 사업(중앙부처·공공기관) — '중앙부처'만이라고 하면 공공기관 사업(건설근로자공제회 등)과 어긋남
  const scope = `전국 사업${sido ? ` + ${sidoObj?.name ?? ""}` : ""}${sigungu ? ` + ${sidoObj?.sigungus.find((g) => g.code === sigungu)?.name ?? ""}` : ""}`;

  return (
    <div className="wrap page">
      <ol className="crumbs" aria-label="현재 위치">
        <li>
          <Link href="/">
            <Icon name="home" size={14} /> 홈
          </Link>
        </li>
        <li>
          <span aria-current="page">서비스 찾기</span>
        </li>
      </ol>
      <h1 className="h1">서비스 찾기</h1>

      <form
        role="search"
        aria-label="복지 서비스 찾기"
        className="fbox"
        onSubmit={(e) => {
          e.preventDefault();
          apply(input, sel);
        }}
      >
        <div className="fgrid">
          <fieldset>
            <legend>생애주기</legend>
            <div className="fchecks">
              {LIFE.map((f) => (
                <label key={f.id}>
                  <input type="checkbox" checked={sel.life.includes(f.id)} onChange={() => toggle("life", f.id)} />
                  {f.label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>가구상황</legend>
            <div className="fchecks">
              {HOUSEHOLD.map((f) => (
                <label key={f.id}>
                  <input type="checkbox" checked={sel.house.includes(f.id)} onChange={() => toggle("house", f.id)} />
                  {f.label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>관심주제</legend>
            <div className="fchecks">
              {TOPICS.map((c) => (
                <label key={c}>
                  <input type="checkbox" checked={sel.topic.includes(c)} onChange={() => toggle("topic", c)} />
                  {c}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="fbar">
          <div className="grow">
            <label htmlFor="sq" className="label">
              검색어
            </label>
            <input id="sq" type="search" className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="예: 기초연금, 에너지바우처, 산후조리" />
          </div>
          <div className="sel">
            <label htmlFor="s-sido" className="label">
              시·도
            </label>
            <select id="s-sido" className="select" value={chosenSido ?? ""} onChange={(e) => choose({ sido: e.target.value || null, sigungu: null })}>
              <option value="">전국 사업만 (중앙부처·공공기관)</option>
              {regions?.sidos.map((s) => (
                <option key={s.code} value={s.code}>
                  {sidoOptionLabel({ code: s.code, name: s.name })}
                </option>
              ))}
            </select>
          </div>
          <div className="sel">
            <label htmlFor="s-sigungu" className="label">
              시·군·구
            </label>
            <select id="s-sigungu" className="select" value={autoRegion ? "" : (sigungu ?? "")} disabled={!sidoObj || autoRegion} onChange={(e) => choose({ sido, sigungu: e.target.value || null })}>
              <option value="">{sidoObj ? "시·군·구 고르지 않음" : "시·도 먼저"}</option>
              {sidoObj?.sigungus.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            title="검색어와 고른 조건을 지워요. 시·도·시·군·구는 그대로 둬요"
            onClick={() => {
              setInput("");
              apply("", EMPTY_SELECTION);
            }}
            data-testid="search-reset"
          >
            검색 조건 초기화
          </button>
          <button type="submit" className="btn btn-primary">
            <Icon name="search" size={18} /> 검색
          </button>
        </div>
        {chosen.length > 0 && (
          <div className="chosen">
            <span>선택한 조건</span>
            {chosen.map((c) => (
              <button key={`${c.group}-${c.id}`} type="button" className="chip-x" onClick={() => toggle(c.group, c.id)} aria-label={`${c.label} 조건 빼기`}>
                {c.label} <Icon name="x" size={14} />
              </button>
            ))}
          </div>
        )}
      </form>
      <p className="small muted" style={{ marginTop: "0.625rem" }}>
        검색 범위: {scope}
      </p>

      {q.trim() && <CrisisHelp text={q} />}
      {q.trim() && !sido && regions && (
        <p className="notice search-hint" data-testid="search-no-region" role="note">
          <Icon name="mapPin" size={18} />
          <span>
            지역 혜택도 찾으려면 시·도를 선택하세요.
          </span>
        </p>
      )}
      {autoRegion && (
        <p className="notice search-hint" data-testid="search-auto-region" role="note">
          <Icon name="mapPin" size={18} />
          <span>
            검색어에서 찾은 지역: <strong>{scope.replace(/^전국 사업 \+ /, "")}</strong>
          </span>
        </p>
      )}
      {situation && parsed && (
        <div className="notice warm search-hint" data-testid="search-situation" role="note">
          <Icon name="info" size={18} />
          <span>
            <strong>{understoodLine(parsed)}</strong>
            {parsed.mode === "parent" ? " · 부모님" : ""}{" "}
            <button
              type="button"
              className="linklike"
              data-testid="search-to-check"
              onClick={() => {
                savePrefill(q, parsed);
                router.push(prefillPath(parsed));
              }}
            >
              이 내용으로 맞춤 찾기
            </button>
          </span>
        </div>
      )}
      {!active ? (
        <p className="empty" style={{ marginTop: "2rem" }}>
          대상·주제를 고르거나 검색어를 입력하세요.
        </p>
      ) : !data ? (
        <p className="muted" style={{ marginTop: "2rem" }}>
          검색 중…
        </p>
      ) : (
        <>
          <div className="search-count" aria-live="polite">
            <h2>
              {q.trim() ? <>&lsquo;{q}&rsquo; </> : null}검색 결과 <b>{hits.length.toLocaleString("ko-KR")}</b>개
            </h2>
            <span className="small muted">{scope}</span>
          </div>
          {partial && (
            <p className="small muted" data-testid="search-partial">
              전체 검색어와 일치하는 결과가 없어 일부 일치한 혜택을 표시했어요.
            </p>
          )}
          {hits.length === 0 ? (
            isGibberish(q) ? (
              <p className="empty" data-testid="search-gibberish">
                검색어를 확인해 주세요. 예: <Link href="/search?q=기초연금">기초연금</Link>, <Link href="/search?q=출산">출산</Link>, <Link href="/search?q=월세">월세</Link>.{" "}
                <Link href="/situation">말로 찾기</Link>
              </p>
            ) : (
              <p className="empty" data-testid="search-empty">
                검색 결과가 없어요. 검색어나 지역을 바꿔 보세요.{" "}
                <Link href="/situation">말로 찾기</Link>
              </p>
            )
          ) : (
            <div className="list">
              {hits.slice(0, limit).map((p) => (
                <ProgramCard key={p.id} p={p} judge={sit ? judgeOf(p, sit) : undefined} ev={!sit && profile ? evaluateProgram(p, profile) : undefined} />
              ))}
            </div>
          )}
          {hits.length > limit && (
            <div className="more-row">
              <button type="button" className="btn btn-ghost" onClick={() => setLimit((l) => l + PAGE)}>
                더 보기 ({(hits.length - limit).toLocaleString("ko-KR")}개 남음) <Icon name="chevronDown" size={18} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

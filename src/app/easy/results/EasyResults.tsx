"use client";
/**
 * 쉬운 찾기 결과 (2026-10-21 인터뷰: "마지막에 뭘 받을 수 있는지, 어떻게 신청하는지만").
 * 판정은 결과 화면과 같다(scoreV2·buildView). 여기서는 '받으실 수 있어요'만 크게, 신청하는 곳과 함께 보여 주고
 * 확인이 더 필요한 혜택은 자세한 결과(/results)로 넘긴다. 답은 이 기기에만 있고 주소에는 싣지 않는다.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icon";
import { loadForRegion, loadProgram, type Loaded } from "@/lib/client/bundles";
import { CHANNEL_LABEL, firstLine, howTo } from "@/lib/client/howto";
import { elderText, parseFindMode, resultsPath } from "@/lib/client/mode";
import { situationOf } from "@/lib/client/start";
import { useElder, useExtras, useMode, useProfile } from "@/lib/client/storage";
import { BUCKET_LABEL, buildView, scoreV2 } from "@/lib/client/v2";
import type { Program } from "@/lib/data/types";

/** 신청하는 곳을 미리 불러올 개수 (나머지는 '자세히 보기'에서) */
const DETAIL_MAX = 30;

export function EasyResults() {
  const params = useSearchParams();
  const profile = useProfile();
  const extras = useExtras();
  const saved = useMode();
  const elder = useElder() ?? false;
  const mode = parseFindMode(params.get("for")) ?? saved ?? "self";
  const parent = mode === "parent";
  const say = (t: string) => (elder ? elderText(t) : t);
  const [data, setData] = useState<Loaded | null>(null);
  const [details, setDetails] = useState<Record<string, Program>>({});

  useEffect(() => {
    if (!profile?.sigungu) return;
    let alive = true;
    loadForRegion(profile.sido, profile.sigungu).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [profile?.sido, profile?.sigungu]);

  const view = useMemo(() => {
    if (!data || !profile) return null;
    const sit = situationOf(profile, extras ?? null, mode);
    return buildView(scoreV2(data.programs, sit), sit, 12);
  }, [data, profile, extras, mode]);
  const fit = useMemo(() => (view ? view.fit.map((g) => g[0]) : []), [view]);
  const ids = fit.slice(0, DETAIL_MAX).map((i) => i.s.program.id).join("|");
  useEffect(() => {
    if (!ids) return;
    let alive = true;
    Promise.all(ids.split("|").map((id) => loadProgram(id).catch(() => null))).then((ps) => {
      if (!alive) return;
      const out: Record<string, Program> = {};
      ps.forEach((p) => p && (out[p.id] = p));
      setDetails(out);
    });
    return () => {
      alive = false;
    };
  }, [ids]);

  if (profile === undefined || extras === undefined) return <div className="wrap page muted">불러오는 중…</div>;
  if (!profile?.sigungu) {
    return (
      <div className="narrow page easy-results" data-testid="easy-results">
        <h1 className="h2">아직 답한 내용이 없어요</h1>
        <p className="body">예/아니요로 몇 가지만 답하면 받으실 수 있는 혜택을 찾아 드려요.</p>
        <Link href="/easy" className="btn btn-primary">쉬운 찾기 시작 <Icon name="arrowRight" size={18} /></Link>
      </div>
    );
  }
  if (!view) return <div className="wrap page muted" role="status">결과를 계산하는 중…</div>;

  const later = view.office.length + view.ask.length;
  const who = parent ? say("부모님께서 ") : "";
  return (
    <div className="narrow page easy-results" data-testid="easy-results" data-mode={mode}>
      <ol className="crumbs" aria-label="현재 위치">
        <li><Link href="/"><Icon name="home" size={14} /> 홈</Link></li>
        <li><Link href="/easy">쉬운 찾기</Link></li>
        <li><span aria-current="page">결과</span></li>
      </ol>
      <h1 className="h1 easy-h">
        {who}받으실 수 있는 혜택 <span data-testid="easy-fit-count">{fit.length}</span>개
      </h1>
      <p className="small muted" data-testid="property-note">
        재산(집·땅·자동차·예금)은 묻지 않고 찾은 결과예요. 실제 선정은 신청하는 곳에서 소득과 재산을 함께 보고 정해요.
      </p>
      {elder && parent && (
        <p className="small muted" data-testid="elder-note">조부모님·어르신 기준으로 찾은 결과예요.</p>
      )}
      {fit.length === 0 ? (
        <p className="body" data-testid="easy-none">
          답만으로 받으실 수 있다고 정해진 혜택은 아직 없어요. 확인이 더 필요한 혜택 {later.toLocaleString("ko-KR")}개는 자세한 결과에서 볼 수 있어요.
        </p>
      ) : (
        <ol className="easy-list">
          {fit.map((item) => {
            const p = item.s.program;
            const d = details[p.id];
            const how = d ? howTo(d, p, profile.sido) : null;
            return (
              <li key={p.id} className="easy-card" data-testid="easy-fit-card">
                <span className="v2-badge b-fit">{BUCKET_LABEL.fit}</span>
                <h2 className="easy-name"><Link href={`/p/${encodeURIComponent(p.id)}`}>{p.name}</Link></h2>
                {p.summary && <p className="body">{firstLine(p.summary, 70)}</p>}
                <p className="easy-where" data-testid="easy-where">
                  <Icon name="mapPin" size={18} />
                  <span>
                    <b>신청: </b>
                    {how ? <>{how.place}{how.channels.length > 0 && ` (${how.channels.map((c) => CHANNEL_LABEL[c]).join(", ")})`}</> : "자세히 보기에서 확인"}
                  </span>
                </p>
              </li>
            );
          })}
        </ol>
      )}
      <div className="easy-actions">
        <Link href={resultsPath(mode)} className="btn btn-primary" data-testid="easy-more">
          자세한 결과 보기{later > 0 ? ` (확인이 더 필요한 혜택 ${later.toLocaleString("ko-KR")}개)` : ""}
        </Link>
        <Link href="/easy" className="btn btn-ghost">처음부터 다시</Link>
      </div>
    </div>
  );
}

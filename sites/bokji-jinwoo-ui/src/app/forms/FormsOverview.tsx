"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "@/components/SiteLink";
import { loadFormsCoverage, loadFormsRegion } from "@/lib/client/forms";
import { FORM_STATUS_LABEL, type FormsCoverage, type FormsRegionBundle, type FormStatus } from "@/lib/data/forms";
import styles from "./forms.module.css";

const statuses: FormStatus[] = ["available", "online", "review", "missing"];
const number = (value: number) => value.toLocaleString("ko-KR");
/** 법령포털 수집 구분(법령·자치법규·행정규칙 별표서식) 이름 */
const SCAN_SOURCE_LABEL: Record<string, string> = {
  law: "법령 서식", licbyl: "법령 서식",
  ordin: "자치법규 서식", ordinbyl: "자치법규 서식",
  rule: "행정규칙 서식", admbyl: "행정규칙 서식",
};
export function FormsOverview() {
  const [coverage, setCoverage] = useState<FormsCoverage | null | undefined>();
  const [areaKey, setAreaKey] = useState("g41280");
  const [region, setRegion] = useState<{ key: string; bundle: FormsRegionBundle | null } | null>(null);
  const [status, setStatus] = useState<FormStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(20);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadFormsCoverage().then(result => { if (alive) setCoverage(result); });
    return () => { alive = false; };
  }, [attempt]);
  useEffect(() => {
    let alive = true;
    loadFormsRegion(areaKey).then(bundle => { if (alive) setRegion({ key: areaKey, bundle }); });
    return () => { alive = false; };
  }, [areaKey, attempt]);
  const loading = !region || region.key !== areaKey;
  const bundle = loading ? null : region.bundle;
  const filtered = useMemo(() => (bundle?.programs ?? []).filter(program =>
    (status === "all" || program.status === status) &&
    (program.name + " " + program.id).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [bundle, status, query]);
  const retry = () => { setRegion(null); setAttempt(value => value + 1); };
  return <div className={`wrap page ${styles.page}`}>
    <Link href="/about" className={styles.back}>← 데이터·판정 기준</Link>
    <header className={styles.header}>
      <h1 className="h1">신청 서식</h1>
      <p className="lead">서식이 없는 사업은 담당 기관에서 확인하세요.</p>
    </header>
    {coverage === undefined ? <p role="status">전국 연결 현황을 불러오고 있어요.</p> : coverage === null ? <div role="status"><p>전국 현황을 불러오지 못했어요.</p><button className="btn btn-quiet" onClick={retry}>다시 확인하기</button></div> : <>
      <details className={styles.summary}>
        <summary>수집 현황·출처</summary>
        <h2 id="forms-national-title">수록 사업 {number(coverage.totalPrograms)}건의 연결 상태</h2>
        <dl className={styles.counts}>{statuses.map(key => <div key={key}><dt>{FORM_STATUS_LABEL[key]}</dt><dd>{number(coverage.counts[key])}<span>건</span></dd></div>)}</dl>
        <p className={styles.source}>{coverage.sourceNote}</p>
        {coverage.portalScan && <p className={styles.scan} data-testid="forms-portal-scan">
          {coverage.portalScan.status === "complete"
            ? `법령포털의 별표·서식 목록 ${number(coverage.portalScan.indexedForms)}건을 수집해 수록 사업 ${number(coverage.portalScan.checkedPrograms)}건과 대조했어요(목록 대조 완료, 확인일 ${coverage.portalScan.checkedAt.slice(0, 10)}).`
            : `법령포털 서식 ${number(coverage.portalScan.indexedForms)}개를 받아 수록 사업 ${number(coverage.portalScan.checkedPrograms)}건까지 맞춰 봤어요. 전수 확인은 아직 끝나지 않았어요(확인일 ${coverage.portalScan.checkedAt.slice(0, 10)}). 아직 찾지 못한 서식이 더 있을 수 있어요.`}
          {" "}서식을 찾아 확인한 사업만 연결하며, 수록 사업 모두에 내려받을 신청서가 있는 것은 아니에요.
        </p>}
        {!!coverage.portalScan?.sources.length && <p className="small muted">법령포털 수집 {coverage.portalScan.sources.map(source =>
          `${SCAN_SOURCE_LABEL[source.kind] ?? source.kind} ${number(source.collected)}/${number(source.total)}`).join(" · ")}</p>}
        <p className="small muted">등록한 서식 정보 {number(coverage.totalForms)}개 · 원문 연결 확인 {number(coverage.publishedForms)}개 · 현황 생성일 {coverage.generatedAt.slice(0, 10)}</p>
      </details>
      <section className={styles.browse} aria-labelledby="forms-area-title">
        <h2 id="forms-area-title">서식 찾기</h2>
        <div className={styles.filters}>
          <div><label htmlFor="forms-region">찾을 지역</label><select id="forms-region" value={areaKey} onChange={event => { setAreaKey(event.target.value); setLimit(20); }}>
            {(["national", "sido", "sigungu"] as const).map(scope => <optgroup key={scope} label={scope === "national" ? "전국 공통" : scope === "sido" ? "시·도 사업" : "시·군·구 사업"}>
              {coverage.regions.filter(item => item.scope === scope).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
            </optgroup>)}
          </select></div>
          <div><label htmlFor="forms-status">연결 상태</label><select id="forms-status" value={status} onChange={event => { setStatus(event.target.value as FormStatus | "all"); setLimit(20); }}><option value="all">전체 상태</option>{statuses.map(key => <option key={key} value={key}>{FORM_STATUS_LABEL[key]}</option>)}</select></div>
          <div className={styles.search}><label htmlFor="forms-query">혜택 이름 검색</label><input id="forms-query" type="search" value={query} maxLength={100} placeholder="예: 장수축하금, 돌봄" onChange={event => { setQuery(event.target.value); setLimit(20); }} /></div>
        </div>
        {loading ? <p role="status">선택한 지역을 확인하고 있어요.</p> : !bundle ? <div role="status"><p>이 지역의 연결 현황을 불러오지 못했어요.</p><button className="btn btn-quiet" onClick={retry}>다시 확인하기</button></div> : <>
          <p role="status" className={styles.resultCount}>{bundle.region.label} 수록 {number(bundle.programs.length)}건 중 현재 조건 {number(filtered.length)}건</p>
          {!filtered.length ? <p className={styles.empty}>현재 검색 조건에 맞는 자료가 없어요. 검색어나 연결 상태를 바꿔 보세요.</p> : <ul className={styles.results}>
            {filtered.slice(0, limit).map(program => <li key={program.id}>
              <div><p className={styles.state} data-status={program.status}>{FORM_STATUS_LABEL[program.status]}{program.links.length ? ` · 서식 ${program.links.length}개` : ""}</p><h3><Link href={`/p/${encodeURIComponent(program.id)}`}>{program.name}</Link></h3>
              {program.status === "review" ? <p className="small muted">이 사업에 적용되는 서식인지 확인 중</p>
                : program.portalSearch?.outcome === "not_found" ? <p className="small muted">법령포털에서 서식 미확인 · 담당 기관 문의</p>
                  : program.portalSearch?.outcome === "incomplete" ? <p className="small muted">서식 조사 중</p> : null}</div>
              <Link className={styles.detailLink} href={`/p/${encodeURIComponent(program.id)}`}>상세 보기 <span className="sr-only">{program.name}</span> →</Link>
            </li>)}
          </ul>}
          {filtered.length > limit && <button className="btn btn-quiet" onClick={() => setLimit(value => value + 20)}>20건 더 보기</button>}
        </>}
      </section>
    </>}
    <details className={styles.explain}>
      <summary>연결 상태는 어떻게 정하나요?</summary>
      <dl>
        <dt>신청서 연결 확인</dt><dd>사업·지역·서식 용도를 공식 원문과 대조해 연결한 자료입니다. 이름 유사도만으로는 여기에 넣지 않습니다. 접수기관의 최신 안내와 구비서류도 확인해 주세요.</dd>
        <dt>온라인 신청 안내</dt><dd>사업 자료에 온라인 신청 주소가 수록되어 있습니다. 현재 접수 여부와 조건은 해당 창구에서 확인해 주세요.</dd>
        <dt>연결 검토 중</dt><dd>법령포털 서식을 자동으로 훑어 후보를 찾았지만, 그 서식이 이 사업에 적용되는지는 확인 중입니다. 검토 중인 파일은 신청서로 제공하지 않습니다.</dd>
        <dt>서식 미확보</dt><dd>법령포털에 수록된 서식에서는 맞는 신청서를 찾지 못했고, 온라인 신청 주소도 없습니다. 지원 대상이 아니거나 신청서가 필요 없다는 뜻은 아니며, 담당기관이 해마다 내는 공고에 서식이 따로 있을 수 있습니다.</dd>
      </dl>
      <p>지급대장·기관 운영 서류·삭제된 서식은 시민용 신청서에서 제외합니다. 같은 이름의 서식도 적용 지역이 다르면 자동으로 연결하지 않습니다.</p>
    </details>
  </div>;
}

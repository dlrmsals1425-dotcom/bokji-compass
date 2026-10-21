"use client";
import { useEffect, useState } from "react";
import Link from "@/components/SiteLink";
import type { Program } from "@/lib/data/types";
import { lawPortalUrl, loadProgramForms, type LoadedProgramForms } from "@/lib/client/forms";
import { externalFormUrl, formAssetUrl } from "@/lib/data/formPublication";
import { FORM_STATUS_LABEL, type ApplicationForm } from "@/lib/data/forms";
import styles from "./ApplicationForms.module.css";

const SOURCE_LABEL = { ordin: "조례", law: "법령", rule: "행정규칙" } as const;
const DATE_LABEL = { effective: "시행일", promulgated: "공포일", issued: "발령일" } as const;
const FILE_TYPE = /\.(hwpx?|pdf|docx?|xlsx?|zip)(?:$|[?#])/i;
const number = (value: number) => value.toLocaleString("ko-KR");
const formTitle = (form: ApplicationForm) => form.title.replace(/^\[.*?\]\s*/, "").trim() || form.title;
/** 근거와 날짜는 자료 그대로 — 공포일·발령일을 시행일로 적지 않는다. */
function basisText(form: ApplicationForm) {
  const kind = SOURCE_LABEL[form.sourceKind ?? (form.regionCode === "national" ? "law" : "ordin")];
  return `근거 ${kind} ${DATE_LABEL[form.dateKind ?? "effective"]} ${form.effectiveDate}`;
}

export function ApplicationForms({ program, parentMode = false }: { program: Program; parentMode?: boolean }) {
  const [result, setResult] = useState<{ id: string; value: LoadedProgramForms | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadProgramForms(program.id).then(value => { if (alive) setResult({ id: program.id, value }); });
    return () => { alive = false; };
  }, [program.id, attempt]);
  const loading = !result || result.id !== program.id;
  const data = loading ? null : result.value;
  const official = externalFormUrl(program.url);
  const online = externalFormUrl(data?.entry.applyUrl);
  const portal = data?.entry.portalSearch;
  const portalDay = portal?.checkedAt.slice(0, 10);
  const candidates = data?.candidateForms ?? [];
  // 받지 못한 후보가 있어도 '없음'으로 보이지 않게, 자료에 적힌 전체 건수를 함께 쓴다.
  const candidateCount = Math.max(portal?.candidateCount ?? 0, (data?.entry.candidateFormIds ?? []).length, candidates.length);
  return (
    <div className={styles.panel} data-testid="application-forms" aria-labelledby="application-forms-title">
      <div className={styles.heading}>
        <h3 id="application-forms-title">신청서와 준비서류</h3>
        {data && <span className={styles.status} data-status={data.entry.status}>{FORM_STATUS_LABEL[data.entry.status]}</span>}
      </div>
      {loading ? <p role="status">신청서 연결 정보를 확인하고 있어요.</p> : !data ? (
        <div role="status"><p>서식 연결 정보를 불러오지 못했어요. 신청서가 없다는 뜻은 아니에요.</p><button type="button" className="btn btn-quiet" onClick={() => { setResult(null); setAttempt(value => value + 1); }}>다시 확인하기</button></div>
      ) : data.entry.status === "available" ? (
        <>
          <ul className={styles.files}>
            {data.entry.links.map(link => {
              const form = data.forms.find(item => item.id === link.formId)!;
              const hwp = formAssetUrl(form.file?.hwp), pdf = formAssetUrl(form.file?.pdf);
              // 받아 둔 파일이 없는 서식은 법령포털 원본을 그대로 연다 (후보가 아니라 연결을 확인한 서식만 여기 온다).
              const original = hwp ? null : lawPortalUrl(form.sourceUrl);
              const preview = pdf ?? (original ? lawPortalUrl(form.officialPdfUrl) : null);
              const originalType = original ? FILE_TYPE.exec(original)?.[1].toUpperCase() : undefined;
              return <li key={form.id}>
                <p className={styles.kind}>{link.use === "main" ? "신청서" : link.use === "conditional" ? "해당하는 경우" : "함께 확인할 서류"}</p>
                <h4>{formTitle(form)}</h4>
                {link.condition && <p>{link.condition}</p>}
                <div className={styles.actions}>
                  {preview && <a className="btn btn-primary" href={preview} target="_blank" rel="noopener noreferrer">서식 보기·인쇄 <span className="sr-only">(PDF, 새 창)</span></a>}
                  {hwp && <a className={`btn ${pdf ? "btn-quiet" : "btn-primary"}`} href={hwp} download={form.title + ".hwp"}>한글 원본 받기 <span className="sr-only">(HWP)</span></a>}
                  {original && <a className={`btn ${preview ? "btn-quiet" : "btn-primary"}`} href={original} target="_blank" rel="noopener noreferrer">법령포털 원본 받기{originalType ? ` (${originalType})` : ""}<span className="sr-only"> (새 창)</span></a>}
                </div>
                <p className={styles.dates}>{basisText(form)} · 연결 확인일 {link.checkedAt}</p>
                <p className={styles.source}><a href={original ? lawPortalUrl(form.lawUrl) ?? original : externalFormUrl(form.sourceUrl)!} target="_blank" rel="noopener noreferrer">{original ? "근거 법령 원문" : "공식 서식 원본"}<span className="sr-only"> (새 창)</span></a>{externalFormUrl(link.evidenceUrl) && <> · <a href={externalFormUrl(link.evidenceUrl)!} target="_blank" rel="noopener noreferrer">신청 근거 확인<span className="sr-only"> (새 창)</span></a></>}</p>
              </li>;
            })}
          </ul>
          <p className="small muted">작성한 서식은 신청처에 제출하세요. 추가 증빙은 공식 안내를 확인하세요.</p>
        </>
      ) : (
        <div className={styles.empty}>
          {data.entry.status !== "online" && <p>{data.entry.status === "review" ? "서식 검토 중입니다. 필요한 서류는 공식 안내를 확인하세요." : "확보한 서식이 없어요. 필요한 서류는 담당 기관에 확인하세요."}</p>}
          {online && <a className="btn btn-primary" href={online} target="_blank" rel="noopener noreferrer">공식 신청 안내 열기<span className="sr-only"> (새 창)</span></a>}
          {!online && official && <a className="btn btn-quiet" href={official} target="_blank" rel="noopener noreferrer">공식 사업 안내 확인<span className="sr-only"> (새 창)</span></a>}
        </div>
      )}
      {portal && <p className={styles.portal} data-testid="forms-portal-search">{
        portal.outcome === "not_found" ? `법령포털에 수록된 서식에서는 이 사업에 해당하는 신청서를 찾지 못했어요. 담당기관이 해마다 내는 공고에 서식이 따로 있을 수 있어요. (법령포털 확인일 ${portalDay})`
          : portal.outcome === "incomplete" ? `법령포털 서식을 아직 모두 확인하지 못했어요. 서식이 없다는 뜻은 아니에요. (법령포털 확인일 ${portalDay})`
            : portal.outcome === "candidate" ? `법령포털 서식에서 관련 서식 ${number(candidateCount)}개를 찾았고, 이 사업에 적용되는지 확인 중이에요. (법령포털 확인일 ${portalDay})`
              : `법령포털 서식 원문과 대조해 연결했어요. (법령포털 확인일 ${portalDay})`
      }</p>}
      {data && (!!candidates.length || data.candidatesIncomplete) && <details className={styles.candidates} data-testid="forms-candidates">
        <summary>법령포털에서 찾은 관련 서식 {number(candidateCount)}개 · 적용 여부 확인 중</summary>
        <p className="small">적용 여부가 확인되지 않아 신청서로 제공하지 않습니다.</p>
        {data.candidatesIncomplete ? <p className="small muted">후보 서식 정보를 일부 불러오지 못했어요. 아래 목록이 전부가 아닐 수 있어요.</p>
          : candidates.length < candidateCount ? <p className="small muted">{number(candidateCount)}개 가운데 관련 서식 앞 {number(candidates.length)}개를 보여요.</p> : null}
        {!!candidates.length && <ul className={styles.files}>
          {candidates.map(form => <li key={form.id}>
            <p className={styles.kind}>적용 여부 확인 중</p>
            <h4>{formTitle(form)}</h4>
            <p className={styles.dates}>{form.lawTitle} · {basisText(form)}</p>
            {lawPortalUrl(form.lawUrl) && <p className={styles.source}><a href={lawPortalUrl(form.lawUrl)!} target="_blank" rel="noopener noreferrer">법령 원문 보기<span className="sr-only"> (새 창)</span></a></p>}
          </li>)}
        </ul>}
      </details>}
      {(program.applyType === "auto" || program.applyType === "institution") && <p className={styles.note}>자료상 {program.applyType === "auto" ? "자동 제공" : "기관 추천·선정"} 방식인 사업이에요. 별도 신청이나 확인이 필요한지는 담당기관에 문의해 주세요.</p>}
      {parentMode && <p className={styles.note}>대리신청 가능 여부와 대리인 준비서류는 신청처에 확인하세요.</p>}
      {data?.entry.note && <p className="small muted">{data.entry.note}</p>}
      <Link className={styles.coverage} href="/forms">전체 신청 서식 →</Link>
    </div>
  );
}

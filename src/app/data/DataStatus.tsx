"use client";
/**
 * 데이터 현황 (2026-10-22): 공식 원천을 매일 자동으로 확인한 결과를 그대로 보여 준다.
 * 수집은 GitHub Actions(.github/workflows/data-refresh.yml)가 매일 0시 10분에 하고, 결과는 공개 저장소 data 브랜치의
 * _report.json(오늘)·_history.json(날짜별)에 남는다. 이 화면은 그 두 파일만 읽는다 (이용자 입력은 어디에도 보내지 않음).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";

const REPO = "yonghwan86/bokji-compass";
export const DATA_RAW = `https://raw.githubusercontent.com/${REPO}/data`;
const COMMITS = `https://github.com/${REPO}/commits/data`;

type Src = { source: string; status: string; detail?: string; total: number; previous: number; added: number; removed: number; changed: number };
type Report = { checkedAt: string; date: string; mode?: "daily" | "baseline"; gate: { ok: boolean; warnings: string[] }; sources: Src[]; bokjiroDetail?: Record<string, { fetched: number; cached: number; remaining: number } | null> };
type HistoryLine = { date: string; mode?: string; gateOk: boolean; sources: Omit<Src, "previous" | "detail">[] };

const SOURCE: Record<string, { name: string; org: string; how: string }> = {
  gov24: { name: "정부24 공공서비스(혜택)", org: "행정안전부", how: "공공데이터포털 OpenAPI · 매일 전체 다시 받기" },
  "bokjiro-central": { name: "복지로 중앙부처 복지서비스", org: "한국사회보장정보원", how: "공공데이터포털 OpenAPI · 목록 매일, 바뀐 상세만" },
  "bokjiro-local": { name: "복지로 지자체 복지서비스", org: "한국사회보장정보원", how: "공공데이터포털 OpenAPI · 목록 매일, 바뀐 상세만" },
  mohw: { name: "지방정부 서비스 메뉴판(통합돌봄)", org: "보건복지부", how: "누리집 게시 PDF · 바뀐 파일만 다시 받아 표 읽기" },
};
const STATUS: Record<string, string> = { ok: "정상", error: "오류", unavailable: "연결 안 됨", skipped: "건너뜀", held: "보류(호출 한도)" };
const fmtDate = (iso: string) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
const n = (x: number) => x.toLocaleString("ko-KR");

export function DataStatus({ siteGeneratedAt, sitePrograms }: { siteGeneratedAt: string; sitePrograms: number }) {
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<HistoryLine[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const get = (f: string) => fetch(`${DATA_RAW}/${f}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
    Promise.all([get("_report.json"), get("_history.json")])
      .then(([r, h]) => alive && (setReport(r), setHistory(h)))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const recent = (history ?? []).slice(-14).reverse();
  return (
    <div className="narrow page data-status" data-testid="data-status">
      <ol className="crumbs" aria-label="현재 위치">
        <li><Link href="/"><Icon name="home" size={14} /> 홈</Link></li>
        <li><span aria-current="page">데이터 현황</span></li>
      </ol>
      <h1 className="h1">데이터 현황</h1>
      <p className="body">
        공식 원천 네 곳을 <b>매일 0시 10분에 자동으로 확인</b>해 어제와 비교하고, 바뀐 것만 받아요. 확인 결과와 수집 기록은 모두 공개 저장소에 남아요.
      </p>

      <section className="ds-site" aria-labelledby="ds-site-h">
        <h2 className="h3" id="ds-site-h">지금 사이트에 반영된 데이터</h2>
        <p className="body" data-testid="ds-site">
          <b>{n(sitePrograms)}개</b> 사업 · 기준 <b>{fmtDate(siteGeneratedAt)}</b>
        </p>
        <p className="small muted">매일 확인한 변경은 점검을 거쳐 사이트 데이터에 반영돼요. 사업마다 원문 수집일과 기관의 최종 수정일은 상세 화면에 있어요.</p>
      </section>

      <section aria-labelledby="ds-today-h">
        <h2 className="h3" id="ds-today-h">원천별 매일 확인</h2>
        {failed && (
          <p className="notice" role="alert" data-testid="ds-error">
            현황을 불러오지 못했어요. 잠시 뒤 다시 열거나 <a href={COMMITS} target="_blank" rel="noopener noreferrer">수집 기록</a>에서 직접 확인해 주세요.
          </p>
        )}
        {!failed && !report && <p className="muted" role="status">현황을 불러오는 중…</p>}
        {report && (
          <>
            <p className={`ds-gate ${report.gate.ok ? "ok" : "warn"}`} data-testid="ds-gate">
              <Icon name={report.gate.ok ? "check" : "alert"} size={18} />
              <span>
                {report.gate.ok ? "점검 통과" : "점검 경고"} · 마지막 확인 {fmtDate(report.checkedAt)}
                {report.mode === "baseline" && " (첫 기준 기록 — 매일 비교는 다음 실행부터)"}
              </span>
            </p>
            {!report.gate.ok && (
              <ul className="ds-warn">
                {report.gate.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            <div className="ds-table-wrap">
              <table className="ds-table" data-testid="ds-sources">
                <thead>
                  <tr><th scope="col">원천</th><th scope="col">상태</th><th scope="col">건수</th><th scope="col">오늘 추가</th><th scope="col">오늘 변경</th><th scope="col">오늘 삭제</th></tr>
                </thead>
                <tbody>
                  {report.sources.map((s) => (
                    <tr key={s.source} data-testid={`ds-src-${s.source}`}>
                      <th scope="row">
                        {SOURCE[s.source]?.name ?? s.source}
                        <span className="small muted">{SOURCE[s.source]?.org} · {SOURCE[s.source]?.how}</span>
                      </th>
                      <td className={s.status === "ok" ? "ds-ok" : s.status === "held" ? undefined : "ds-bad"}>{STATUS[s.status] ?? s.status}{s.detail ? ` — ${s.detail}` : ""}</td>
                      <td className="num">{n(s.total)}</td>
                      <td className="num">{n(s.added)}</td>
                      <td className="num">{n(s.changed)}</td>
                      <td className="num">{n(s.removed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.bokjiroDetail && Object.values(report.bokjiroDetail).some((d) => d && d.remaining > 0) && (
              <p className="small muted" data-testid="ds-bokjiro-progress">
                복지로 상세는 하루 호출 한도가 있어 나눠 받는 중이에요 — 남은 상세: {Object.entries(report.bokjiroDetail).map(([k, d]) => `${k === "central" ? "중앙" : "지자체"} ${n(d?.remaining ?? 0)}건`).join(" · ")}
              </p>
            )}
          </>
        )}
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="ds-hist-h">
          <h2 className="h3" id="ds-hist-h">최근 확인 기록</h2>
          <ul className="ds-hist" data-testid="ds-history">
            {recent.map((h) => {
              const sum = h.sources.reduce((a, s) => a + s.added + s.changed + s.removed, 0);
              return (
                <li key={h.date}>
                  <span className="num">{h.date}</span>
                  <span>{h.mode === "baseline" ? "기준 기록" : sum ? `바뀐 사업 ${n(sum)}건` : "바뀐 것 없음"}</span>
                  <span className={h.gateOk ? "ds-ok" : "ds-bad"}>{h.gateOk ? "점검 통과" : "점검 경고"}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="ds-how-h">
        <h2 className="h3" id="ds-how-h">어떻게 관리하나요</h2>
        <ul className="body">
          <li><b>매일 자동 확인</b>: 사람이 손대지 않고 매일 원천을 다시 받아 어제와 비교해요.</li>
          <li><b>바뀐 것만 갱신</b>: 정부24는 전체를, 복지로는 목록을 다시 받아 내용이 바뀐 사업의 상세만, 메뉴판은 파일이 바뀐 것만 다시 받아요.</li>
          <li><b>배포 전 점검</b>: 수집이 실패하거나, 건수가 하루에 10% 넘게 줄거나, 30% 넘게 &lsquo;변경&rsquo;으로 잡히거나, 원천이 알려 준 건수와 받은 건수가 다르거나, 원천의 칸이 사라지면 경고를 내고 관리자에게 알림이 가요. 사이트에는 점검을 통과한 데이터만 반영해요.</li>
          <li><b>같은 원문은 같은 결과</b>: 메뉴판은 바뀐 PDF만 다시 읽고, 나머지는 어제 결과를 그대로 써요. 복지로 상세는 새로 받기 전까지 어제 것을 지우지 않아요.</li>
          <li><b>기록 공개</b>: 날마다의 수집 결과가 공개 저장소에 커밋으로 남아요. <a href={COMMITS} target="_blank" rel="noopener noreferrer">수집 기록 보기</a></li>
        </ul>
        <p className="small muted">원천의 이용 조건: 정부24·복지로 API는 공공데이터포털 &lsquo;이용허락범위 제한 없음&rsquo;, 메뉴판은 보건복지부 누리집 공표 자료예요. <Link href="/about">출처·판정 기준</Link></p>
      </section>
    </div>
  );
}

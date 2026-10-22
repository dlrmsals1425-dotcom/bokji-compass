/**
 * 매일 변경 감지 (2026-10-22): 원천 목록을 어제와 비교해 추가·변경·삭제를 세고, 배포 전에 멈출 이상을 찾는다.
 * 수집은 GitHub Actions(.github/workflows/data-refresh.yml)가 매일 자동으로, 결과는 data 브랜치의 _report.json·_history.json.
 */
import crypto from "node:crypto";

export type SourceId = "gov24" | "bokjiro-central" | "bokjiro-local" | "mohw";

export interface SourceReport {
  source: SourceId | string;
  status: "ok" | "error" | "unavailable" | "skipped";
  detail?: string;
  /** 오늘 목록 건수 */
  total: number;
  /** 어제(직전 수집) 목록 건수 — 처음이면 0 */
  previous: number;
  added: string[];
  removed: string[];
  changed: string[];
}

/** 지문: 키 순서와 무관한 내용 해시. ignore 필드(조회수 등 매번 바뀌는 잡음)는 뺀다 */
export function fingerprint(row: Record<string, unknown>, ignore: readonly string[] = []): string {
  const keys = Object.keys(row).filter((k) => !ignore.includes(k)).sort();
  const norm = JSON.stringify(keys.map((k) => [k, row[k]]));
  return crypto.createHash("sha1").update(norm).digest("hex").slice(0, 16);
}

/** id → 지문 두 묶음 비교 */
export function compareSnapshots(before: Map<string, string>, after: Map<string, string>): Omit<SourceReport, "source" | "status"> {
  const added: string[] = [];
  const changed: string[] = [];
  for (const [id, fp] of after) {
    const old = before.get(id);
    if (old === undefined) added.push(id);
    else if (old !== fp) changed.push(id);
  }
  const removed = [...before.keys()].filter((id) => !after.has(id));
  return { total: after.size, previous: before.size, added, removed, changed };
}

/** 이만큼 넘게 줄면 원천 오류로 보고 배포를 멈춘다 */
export const DROP_LIMIT = 0.1;

/** 배포 전 점검: 수집 오류, 건수 급감 */
export function gateCheck(reports: readonly SourceReport[]): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];
  for (const r of reports) {
    if (r.status === "error" || r.status === "unavailable") warnings.push(`${r.source}: 수집 실패 — ${r.detail ?? r.status}`);
    else if (r.previous > 0 && r.total < r.previous * (1 - DROP_LIMIT)) {
      const pct = Math.round((1 - r.total / r.previous) * 100);
      warnings.push(`${r.source}: 건수가 ${pct}% 줄었어요 (${r.previous.toLocaleString("ko-KR")} → ${r.total.toLocaleString("ko-KR")})`);
    }
  }
  return { ok: warnings.length === 0, warnings };
}

const SAMPLE = 50;
/** 하루 기록 한 줄: 개수 + 앞 50개 id */
export function summarize(r: SourceReport) {
  return {
    source: r.source,
    status: r.status,
    ...(r.detail ? { detail: r.detail } : {}),
    total: r.total,
    previous: r.previous,
    added: r.added.length,
    removed: r.removed.length,
    changed: r.changed.length,
    sample: { added: r.added.slice(0, SAMPLE), removed: r.removed.slice(0, SAMPLE), changed: r.changed.slice(0, SAMPLE) },
  };
}

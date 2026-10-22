/**
 * 매일 변경 감지 실행기 (2026-10-22) — GitHub Actions(.github/workflows/data-refresh.yml)가 매일 0시 10분(한국 시간)에 돌린다.
 *  1. 원천별 어제 목록의 지문을 뜬다 (pipeline/raw = data 브랜치)
 *  2. 수집: 정부24 전체 다시 받기(약 33번 호출) · 복지로 목록 새로 받기 + 바뀐 상세만 · 메뉴판 바뀐 PDF만 (+바뀌면 표 다시 읽기)
 *  3. 오늘 지문과 비교 → 추가·변경·삭제, 배포 전 점검(수집 실패·건수 10% 넘게 감소)
 *  4. pipeline/raw/_report.json(오늘) · _history.json(날짜별 한 줄, 최근 400일) — 사이트 '데이터 현황'(/data)이 읽는다
 * 점검에 걸리면 종료 코드 1 → Actions가 실패로 표시하고 저장소 주인에게 알림 메일.
 * 키(DATA_GO_KR_SERVICE_KEY)는 환경변수로만 쓰고 출력하지 않는다.
 *
 * 사용: npx tsx pipeline/src/refresh/run.ts [--skip-fetch]  (--skip-fetch: 수집 없이 지금 캐시로 보고서만)
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readCached } from "../gov24/ingest";
import { listFingerprints, type Kind } from "../bokjiro/ingest";
import { compareSnapshots, fingerprint, gateCheck, summarize, type SourceReport } from "./diff";

const ROOT = path.resolve(__dirname, "../../..");
const RAW = path.join(ROOT, "pipeline/raw");

function gov24Fingerprints(): Map<string, string> {
  const parts = new Map<string, string[]>();
  for (const ep of ["serviceList", "supportConditions", "serviceDetail"] as const) {
    for (const r of readCached(ep).rows) {
      const id = String(r["서비스ID"] ?? "");
      if (!id) continue;
      if (!parts.has(id)) parts.set(id, []);
      parts.get(id)!.push(fingerprint(r));
    }
  }
  return new Map([...parts].map(([id, fps]) => [id, fps.join(":")]));
}

function mohwFingerprints(): Map<string, string> {
  const f = path.join(RAW, "mohw/index.json");
  if (!fs.existsSync(f)) return new Map();
  const posts = JSON.parse(fs.readFileSync(f, "utf8")).posts as { bid: string; listNo: string; seq: string; sha256?: string; sizeLabel: string; title: string }[];
  return new Map(posts.map((p) => [`${p.bid}:${p.listNo}:${p.seq}`, p.sha256 ?? `${p.sizeLabel}|${p.title}`]));
}

const readJson = (rel: string) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(RAW, rel), "utf8"));
  } catch {
    return null;
  }
};

function run(script: string, args: string[] = []): string | null {
  try {
    execFileSync(script.endsWith(".py") ? "python3" : "npx", script.endsWith(".py") ? [script, ...args] : ["tsx", script, ...args], { cwd: ROOT, stdio: "inherit", env: process.env });
    return null;
  } catch (e) {
    return `실행 실패: ${path.basename(script)} (${(e as Error).message.split("\n")[0].slice(0, 120)})`;
  }
}

function main() {
  const skip = process.argv.includes("--skip-fetch");
  const kinds: Kind[] = ["central", "local"];
  const before = { gov24: gov24Fingerprints(), central: listFingerprints("central"), local: listFingerprints("local"), mohw: mohwFingerprints() };

  const errors: Record<string, string | null> = {};
  if (!skip) {
    errors.gov24 = run("pipeline/src/gov24/ingest.ts", ["--refresh"]);
    errors.bokjiro = run("pipeline/src/bokjiro/ingest.ts", ["--refresh-lists"]);
    errors.mohw = run("pipeline/src/mohw/ingest.ts");
  }
  const mohwAfter = mohwFingerprints();
  const mohwDiff = compareSnapshots(before.mohw, mohwAfter);
  if (!skip && (mohwDiff.added.length || mohwDiff.changed.length || !fs.existsSync(path.join(RAW, "mohw/policies.csv")))) {
    errors.mohwParse = run("pipeline/mohw/parse_menus.py");
  }

  const gov24Status = readJson("gov24/_status.json");
  const bokjiroStatus = readJson("bokjiro/_status.json") ?? {};
  const reports: SourceReport[] = [
    {
      source: "gov24",
      status: errors.gov24 ? "error" : gov24Status?.status ?? "error",
      detail: errors.gov24 ?? (gov24Status?.status !== "ok" ? gov24Status?.detail : undefined),
      ...compareSnapshots(before.gov24, gov24Fingerprints()),
    },
    ...kinds.map((k): SourceReport => {
      const st = bokjiroStatus[k] ?? {};
      return {
        source: `bokjiro-${k}`,
        status: errors.bokjiro ? "error" : st.status ?? "error",
        detail: errors.bokjiro ?? (st.status !== "ok" ? st.message ?? st.code : undefined),
        ...compareSnapshots(before[k], listFingerprints(k)),
      };
    }),
    { source: "mohw", status: errors.mohw || errors.mohwParse ? "error" : "ok", detail: errors.mohw ?? errors.mohwParse ?? undefined, ...mohwDiff },
  ];
  const gate = gateCheck(reports);
  const checkedAt = new Date().toISOString();
  const date = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const detailProgress = Object.fromEntries(kinds.map((k) => [k, bokjiroStatus[k]?.detail ?? null]));
  // mode: daily = 오늘 원천을 실제로 다시 받음 / baseline = 수집 없이 지금 캐시로 만든 기준 보고서
  const report = { checkedAt, date, mode: skip ? "baseline" : "daily", gate, sources: reports.map(summarize), bokjiroDetail: detailProgress };
  fs.writeFileSync(path.join(RAW, "_report.json"), JSON.stringify(report, null, 1));

  const history = (readJson("_history.json") as unknown[] | null) ?? [];
  const line = { date, checkedAt, mode: skip ? "baseline" : "daily", gateOk: gate.ok, sources: reports.map((r) => ({ source: r.source, status: r.status, total: r.total, added: r.added.length, removed: r.removed.length, changed: r.changed.length })) };
  const kept = (history as { date: string }[]).filter((h) => h.date !== date);
  fs.writeFileSync(path.join(RAW, "_history.json"), JSON.stringify([...kept, line].slice(-400), null, 1));

  for (const r of reports) console.log(`[refresh] ${r.source}: ${r.status} · ${r.total}건 (추가 ${r.added.length} · 변경 ${r.changed.length} · 삭제 ${r.removed.length})`);
  if (!gate.ok) {
    for (const w of gate.warnings) console.error(`[refresh] 경고: ${w}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

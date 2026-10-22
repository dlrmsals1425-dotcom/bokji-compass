/**
 * 행정안전부 '대한민국 공공서비스(혜택) 정보' API 수집기 (data.go.kr 15113968, api.odcloud.kr/api/gov24/v3).
 *
 * - 인증키: 환경변수 DATA_GO_KR_SERVICE_KEY. 키 값은 절대 출력·기록하지 않는다 (Authorization 헤더로만 전송, URL에 넣지 않음).
 * - 원본 응답은 pipeline/raw/gov24/ 에 캐시 (gitignore). 캐시가 있으면 다시 호출하지 않는다 (--refresh 로 강제).
 * - 하루 호출 예산(기본 2,000; 개발계정 한도 10,000)을 pipeline/raw/gov24/_budget.json 으로 관리.
 * - 키가 거부되면 응답의 오류 코드·메시지만 _status.json 에 남기고 종료 (빌드는 기존 로컬 데이터로 계속).
 *
 * 사용: npm run ingest:gov24 [-- --refresh] [--details=all|priority|none]
 */
import fs from "node:fs";
import path from "node:path";

const BASE = "https://api.odcloud.kr/api/gov24/v3";
const RAW = path.resolve(__dirname, "../../raw/gov24");
const PER_PAGE = 1000;
const DAILY_BUDGET = Number(process.env.GOV24_DAILY_BUDGET ?? 2000);
const DELAY_MS = 400;

type Endpoint = "serviceList" | "supportConditions" | "serviceDetail";

/** 매일 변경 감지에서 뺄 잡음: 조회수는 매일 바뀌어 거의 모든 사업이 '변경'으로 잡힘 (2026-10-22 첫 실행) */
export const GOV24_NOISE = ["조회수"] as const;

export interface IngestStatus {
  status: "ok" | "unavailable" | "error";
  detail: string;
  checkedAt: string;
  httpStatus?: number;
  apiCode?: number | string;
  counts?: Partial<Record<Endpoint, number>>;
  totalCount?: number;
}

function today(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

function readBudget(): { date: string; calls: number } {
  const f = path.join(RAW, "_budget.json");
  try {
    const b = JSON.parse(fs.readFileSync(f, "utf8"));
    if (b.date === today()) return b;
  } catch { /* 없음 */ }
  return { date: today(), calls: 0 };
}

function spend(): void {
  const b = readBudget();
  b.calls += 1;
  fs.writeFileSync(path.join(RAW, "_budget.json"), JSON.stringify(b));
  if (b.calls > DAILY_BUDGET) throw new Error(`일일 호출 예산 초과 (${DAILY_BUDGET})`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class ApiError extends Error {
  constructor(public httpStatus: number, public apiCode: number | string | undefined, message: string) {
    super(message);
  }
}

async function call(endpoint: Endpoint, page: number, key: string): Promise<{ totalCount: number; data: Record<string, unknown>[] }> {
  const url = `${BASE}/${endpoint}?page=${page}&perPage=${PER_PAGE}&returnType=JSON`;
  for (let attempt = 0; attempt < 4; attempt++) {
    spend();
    const res = await fetch(url, { headers: { Authorization: `Infuser ${key}`, Accept: "application/json" } });
    const text = await res.text();
    if (res.ok) {
      const json = JSON.parse(text);
      return { totalCount: Number(json.totalCount ?? json.matchCount ?? 0), data: json.data ?? [] };
    }
    let apiCode: number | string | undefined;
    let msg = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      apiCode = j.code;
      msg = j.msg ?? j.message ?? msg;
    } catch { /* XML 등 */ }
    // 키 문자열이 혹시 메시지에 들어 있으면 가린다
    msg = msg.split(key).join("[KEY]");
    if (res.status === 429 || res.status >= 500) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    throw new ApiError(res.status, apiCode, msg);
  }
  throw new ApiError(429, undefined, "재시도 후에도 응답 없음 (속도 제한 또는 서버 오류)");
}

async function fetchAll(endpoint: Endpoint, key: string, refresh: boolean): Promise<number> {
  const dir = path.join(RAW, endpoint);
  fs.mkdirSync(dir, { recursive: true });
  let page = 1;
  let total = Infinity;
  let rows = 0;
  while ((page - 1) * PER_PAGE < total) {
    const file = path.join(dir, `page-${String(page).padStart(4, "0")}.json`);
    let body: { totalCount: number; data: Record<string, unknown>[] };
    if (!refresh && fs.existsSync(file)) {
      body = JSON.parse(fs.readFileSync(file, "utf8"));
    } else {
      body = await call(endpoint, page, key);
      fs.writeFileSync(file, JSON.stringify({ ...body, fetchedAt: new Date().toISOString() }));
      await sleep(DELAY_MS);
    }
    total = body.totalCount;
    rows += body.data.length;
    if (body.data.length === 0) break;
    page++;
  }
  // 건수가 줄어 쪽수가 줄면 예전 마지막 쪽 파일이 남아 지난 행이 섞인다 → 이번에 안 받은 뒤쪽 파일은 지운다
  if (refresh) {
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^page-(\d+)\.json$/);
      if (m && Number(m[1]) >= page) fs.rmSync(path.join(dir, f));
    }
  }
  return rows;
}

export async function ingest(opts: { refresh?: boolean; details?: "all" | "none" } = {}): Promise<IngestStatus> {
  fs.mkdirSync(RAW, { recursive: true });
  const key = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  const write = (s: IngestStatus) => {
    fs.writeFileSync(path.join(RAW, "_status.json"), JSON.stringify(s, null, 2));
    return s;
  };
  if (!key) return write({ status: "unavailable", detail: "DATA_GO_KR_SERVICE_KEY 환경변수가 없음", checkedAt: new Date().toISOString() });

  const counts: Partial<Record<Endpoint, number>> = {};
  try {
    counts.serviceList = await fetchAll("serviceList", key, !!opts.refresh);
    counts.supportConditions = await fetchAll("supportConditions", key, !!opts.refresh);
    if (opts.details !== "none") counts.serviceDetail = await fetchAll("serviceDetail", key, !!opts.refresh);
    return write({ status: "ok", detail: "수집 완료", checkedAt: new Date().toISOString(), counts });
  } catch (e) {
    if (e instanceof ApiError) {
      return write({
        status: e.httpStatus === 401 || e.httpStatus === 403 ? "unavailable" : "error",
        detail: `HTTP ${e.httpStatus}${e.apiCode !== undefined ? ` code ${e.apiCode}` : ""}: ${e.message}`,
        httpStatus: e.httpStatus,
        apiCode: e.apiCode,
        checkedAt: new Date().toISOString(),
        counts,
      });
    }
    return write({ status: "error", detail: (e as Error).message.split(key).join("[KEY]"), checkedAt: new Date().toISOString(), counts });
  }
}

export function readCachedStatus(): IngestStatus | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(RAW, "_status.json"), "utf8"));
  } catch {
    return null;
  }
}

/** 원천이 알려 준 전체 건수 (캐시 첫 쪽) */
export function readTotalCount(endpoint: Endpoint): number | undefined {
  try {
    return Number(JSON.parse(fs.readFileSync(path.join(RAW, endpoint, "page-0001.json"), "utf8")).totalCount);
  } catch {
    return undefined;
  }
}

/** 캐시된 원본 행 읽기 */
export function readCached(endpoint: Endpoint): { rows: Record<string, unknown>[]; fetchedAt?: string } {
  const dir = path.join(RAW, endpoint);
  if (!fs.existsSync(dir)) return { rows: [] };
  const rows: Record<string, unknown>[] = [];
  let fetchedAt: string | undefined;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    rows.push(...(j.data ?? []));
    fetchedAt = fetchedAt ?? j.fetchedAt;
  }
  return { rows, fetchedAt };
}

if (require.main === module) {
  const refresh = process.argv.includes("--refresh");
  const details = process.argv.includes("--details=none") ? "none" : "all";
  ingest({ refresh, details }).then((s) => {
    // 상태만 출력 (키 값은 출력하지 않음)
    console.log(JSON.stringify(s, null, 2));
    console.log(`오늘 사용한 호출 수: ${readBudget().calls}`);
  });
}

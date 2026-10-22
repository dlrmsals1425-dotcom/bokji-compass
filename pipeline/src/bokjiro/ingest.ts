/**
 * 한국사회보장정보원(복지로) OpenAPI 수집기
 *  - 중앙부처복지서비스 (data.go.kr 15090532): NationalWelfareInformationsV001 / NationalWelfarelistV001 · NationalWelfaredetailedV001
 *  - 지자체복지서비스   (data.go.kr 15108347): LocalGovernmentWelfareInformations / LcgvWelfarelist · LcgvWelfaredetailed
 *
 * - 인증키: DATA_GO_KR_SERVICE_KEY (serviceKey 쿼리로만 전송, URL·키는 출력하지 않음, 오류 메시지에서 가림)
 * - XML 원본을 pipeline/raw/bokjiro/ 에 캐시 → 재실행 시 재호출하지 않음
 * - 일일 호출 예산(개발계정): 중앙 100, 지자체 1,000 → 기본 상한 중앙 95, 지자체 950 (_budget.json)
 * - 상세 우선순위: 지자체 = 경기도 → 정부24에 없는 서비스 → 나머지 / 중앙 = 정부24에 없는 서비스 → 나머지
 *
 * - --refresh-lists (매일 변경 감지, 2026-10-22): 목록을 새로 받아(중앙 1 · 지자체 약 10번 호출) 목록 내용이 바뀌었거나 새로 생긴
 *   서비스의 상세만 다시 받는다. 새 목록을 다 받은 뒤에만 바꿔 넣으므로 중간에 실패하면 어제 목록이 그대로 남는다.
 *
 * 사용: npx tsx pipeline/src/bokjiro/ingest.ts [--list-only] [--refresh-lists]
 */
import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { readCached } from "../gov24/ingest";
import { nameKey } from "../normalize/names";
import { fingerprint } from "../refresh/diff";

export const RAW = path.resolve(__dirname, "../../raw/bokjiro");
const API = {
  central: {
    base: "https://apis.data.go.kr/B554287/NationalWelfareInformationsV001",
    list: (p: number, n: number) => `NationalWelfarelistV001?callTp=L&pageNo=${p}&numOfRows=${n}&srchKeyCode=003`,
    detail: (id: string) => `NationalWelfaredetailedV001?callTp=D&servId=${id}`,
    budget: Number(process.env.BOKJIRO_CENTRAL_BUDGET ?? 95),
    perPage: 500,
  },
  local: {
    base: "https://apis.data.go.kr/B554287/LocalGovernmentWelfareInformations",
    list: (p: number, n: number) => `LcgvWelfarelist?pageNo=${p}&numOfRows=${n}`,
    detail: (id: string) => `LcgvWelfaredetailed?servId=${id}`,
    budget: Number(process.env.BOKJIRO_LOCAL_BUDGET ?? 950),
    perPage: 500,
  },
} as const;
export type Kind = keyof typeof API;

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true, isArray: (n) => ["servList", "applmetList", "inqplCtadrList", "inqplHmpgReldList", "basfrmList", "baslawList"].includes(n) });
/** 파싱된 XML 노드 (구조가 API마다 달라 느슨한 타입) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type XmlNode = Record<string, any>;
export const parseXml = (xml: string) => parser.parse(xml) as XmlNode;

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
type Budget = { date: string; central: number; local: number };
function readBudget(): Budget {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(RAW, "_budget.json"), "utf8"));
    if (b.date === today()) return { central: 0, local: 0, ...b };
  } catch { /* 없음 */ }
  return { date: today(), central: 0, local: 0 };
}
function canSpend(kind: Kind) {
  return readBudget()[kind] < API[kind].budget;
}
function spend(kind: Kind) {
  const b = readBudget();
  b[kind] += 1;
  fs.writeFileSync(path.join(RAW, "_budget.json"), JSON.stringify(b));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class ApiError extends Error {
  constructor(public httpStatus: number, public code: string, message: string) { super(message); }
}

async function call(kind: Kind, rel: string, key: string): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!canSpend(kind)) throw new ApiError(0, "BUDGET", `일일 호출 예산 소진 (${kind} ${API[kind].budget})`);
    spend(kind);
    const res = await fetch(`${API[kind].base}/${rel}&serviceKey=${encodeURIComponent(key)}`);
    const text = (await res.text()).split(key).join("[KEY]");
    const rc = text.match(/<resultCode>([^<]*)<\/resultCode>/)?.[1];
    const reason = text.match(/<returnReasonCode>([^<]*)<\/returnReasonCode>/)?.[1];
    const authMsg = text.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/)?.[1];
    if (res.ok && (rc === "0" || rc === "00" || rc === undefined) && !authMsg) return text;
    if (res.status === 429 || res.status >= 500 || reason === "22") { await sleep(3000 * (attempt + 1)); continue; }
    throw new ApiError(res.status, reason ?? rc ?? String(res.status), authMsg ?? text.match(/<resultMessage>([^<]*)/)?.[1] ?? text.slice(0, 160));
  }
  throw new ApiError(429, "RETRY", "재시도 후에도 실패");
}

/** 목록 한 줄의 지문 — 조회수(inqNum)는 매번 바뀌므로 뺀다 */
export const LIST_NOISE = ["inqNum"] as const;
export function listFingerprints(kind: Kind): Map<string, string> {
  return new Map(readList(kind).map((r) => [String(r.servId), fingerprint(r, LIST_NOISE)]));
}

async function fetchList(kind: Kind, key: string, fresh = false) {
  const final = path.join(RAW, kind, "list");
  // 새로 받을 때는 옆 폴더에 받고, 다 받은 뒤에 바꿔 넣는다 (중간 실패 시 어제 목록 유지)
  const dir = fresh ? path.join(RAW, kind, "list.new") : final;
  if (fresh) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const rows: Record<string, string>[] = [];
  let page = 1, total = Infinity;
  while ((page - 1) * API[kind].perPage < total) {
    const file = path.join(dir, `page-${String(page).padStart(4, "0")}.xml`);
    let xml: string;
    if (fs.existsSync(file)) xml = fs.readFileSync(file, "utf8");
    else {
      xml = await call(kind, API[kind].list(page, API[kind].perPage), key);
      fs.writeFileSync(file, xml);
      await sleep(300);
    }
    const j = parseXml(xml).wantedList ?? {};
    total = Number(j.totalCount ?? 0);
    const items = j.servList ?? [];
    rows.push(...items);
    if (!items.length) break;
    page++;
  }
  if (fresh) {
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(dir, final);
  }
  return rows;
}

async function fetchDetails(kind: Kind, ids: string[], key: string) {
  const dir = path.join(RAW, kind, "detail");
  fs.mkdirSync(dir, { recursive: true });
  let fetched = 0, cached = 0;
  for (const id of ids) {
    const file = path.join(dir, `${id}.xml`);
    if (fs.existsSync(file)) { cached++; continue; }
    if (!canSpend(kind)) break;
    const xml = await call(kind, API[kind].detail(id), key);
    fs.writeFileSync(file, xml);
    fetched++;
    await sleep(250);
  }
  return { fetched, cached, remaining: ids.length - fetched - cached };
}

export function readList(kind: Kind): Record<string, string>[] {
  const dir = path.join(RAW, kind, "list");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().flatMap((f) => parseXml(fs.readFileSync(path.join(dir, f), "utf8")).wantedList?.servList ?? []);
}
export function readDetail(kind: Kind, id: string): XmlNode | null {
  const f = path.join(RAW, kind, "detail", `${id}.xml`);
  if (!fs.existsSync(f)) return null;
  return parseXml(fs.readFileSync(f, "utf8")).wantedDtl ?? null;
}
export function listFetchedAt(kind: Kind): string | undefined {
  const f = path.join(RAW, kind, "list", "page-0001.xml");
  return fs.existsSync(f) ? fs.statSync(f).mtime.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }) : undefined;
}

async function main() {
  fs.mkdirSync(RAW, { recursive: true });
  const key = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  const status: Record<string, unknown> = { checkedAt: new Date().toISOString() };
  if (!key) { status.error = "DATA_GO_KR_SERVICE_KEY 없음"; fs.writeFileSync(path.join(RAW, "_status.json"), JSON.stringify(status, null, 2)); return status; }
  const gov24Keys = new Set(readCached("serviceList").rows.map((r) => nameKey(String(r["서비스명"] ?? ""))));
  for (const kind of ["central", "local"] as Kind[]) {
    try {
      const refresh = process.argv.includes("--refresh-lists");
      const before = refresh ? listFingerprints(kind) : null;
      const list = await fetchList(kind, key, refresh);
      const s: Record<string, unknown> = { list: list.length };
      if (before) {
        // 목록 내용이 바뀌었거나 새로 생긴 서비스는 상세를 다시 받는다 (캐시를 지우면 아래에서 예산 안에서 다시 받음)
        const after = listFingerprints(kind);
        const stale = [...after].filter(([id, fp]) => before.get(id) !== fp).map(([id]) => id);
        for (const id of stale) fs.rmSync(path.join(RAW, kind, "detail", `${id}.xml`), { force: true });
        s.refreshed = stale.length;
      }
      if (!process.argv.includes("--list-only")) {
        const prio = (r: Record<string, string>) =>
          (kind === "local" && String(r.ctpvNm ?? "").startsWith("경기") ? 0 : 2) + (gov24Keys.has(nameKey(r.servNm ?? "")) ? 1 : 0);
        const ids = [...list].sort((a, b) => prio(a) - prio(b)).map((r) => r.servId);
        s.detail = await fetchDetails(kind, ids, key);
      }
      status[kind] = { status: "ok", ...s };
    } catch (e) {
      const err = e as ApiError;
      status[kind] = { status: "error", httpStatus: err.httpStatus, code: err.code, message: String(err.message).split(key).join("[KEY]") };
    }
  }
  status.budget = readBudget();
  fs.writeFileSync(path.join(RAW, "_status.json"), JSON.stringify(status, null, 2));
  return status;
}

if (require.main === module) main().then((s) => console.log(JSON.stringify(s, null, 2)));

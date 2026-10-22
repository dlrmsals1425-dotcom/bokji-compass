/**
 * 보건복지부 지역사회 통합돌봄 누리집 '지방정부 서비스 메뉴판' 수집기 (2026-10-17 — 선행 대시보드 수집본(policies.csv)을 더 쓸 수 없어 원문에서 직접).
 * https://www.mohw.go.kr/menu.es?mid=a60600000000 → 시·도 게시판 17곳(mid a60601…a60617) → 글마다 시·군·구 메뉴판 PDF 1개.
 *
 * - 목록(index.json)과 PDF를 pipeline/raw/mohw/ 에 저장 (gitignore). 인증 필요 없음, 요청 사이 간격을 둔다.
 * - PDF는 없거나 목록의 파일 크기가 바뀌었을 때만 다시 받는다 (--refresh 로 모두 다시)
 * - 표 읽기는 pipeline/mohw/parse_menus.py (pdfplumber) → pipeline/raw/mohw/policies.csv (icare.ts 가 읽는 형식)
 *
 * 사용: npm run ingest:mohw [-- --refresh]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const BASE = "https://www.mohw.go.kr";
const RAW = path.resolve(__dirname, "../../raw/mohw");
const DELAY_MS = 700;
const BOARDS = Array.from({ length: 17 }, (_, i) => `a606${String(i + 1).padStart(2, "0")}000000`);

export interface MenuPost {
  mid: string;
  bid: string;
  listNo: string;
  seq: string;
  boardSido: string;
  title: string;
  postedAt: string;
  file: string;
  sizeLabel: string;
  viewUrl: string;
  downloadUrl: string;
  /** 받은 PDF의 sha256 (바뀌었는지 확인용) */
  sha256?: string;
  fetchedAt?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const text = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** 요청 (세 번까지): 응답 오류뿐 아니라 연결이 끊긴 경우('other side closed', 2026-10-23 매일 확인)도 기다렸다가 다시 시도 */
export async function get(url: string, f: typeof fetch = fetch, wait: (ms: number) => Promise<unknown> = sleep): Promise<Response> {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await f(url, { headers: { "User-Agent": "bokji-compass-pipeline (+https://github.com/yonghwan86/bokji-compass)" } });
      if (res.ok) return res;
    } catch {
      /* 연결 끊김 — 아래에서 기다렸다가 다시 */
    }
    await wait(2000 * (i + 1));
  }
  throw new Error(`요청 실패: ${url}`);
}

/** 목록 한 쪽의 글들. 글 하나 = <tr> 하나 (제목·작성일·첨부) */
export function parseList(html: string, mid: string, boardSido: string): { posts: MenuPost[]; pages: number } {
  const posts: MenuPost[] = [];
  for (const tr of html.split(/<tr[\s>]/).slice(1)) {
    const view = tr.match(/href="(\/board\.es\?mid=[^"]*act=view[^"]*list_no=(\d+)[^"]*)"/);
    const dl = tr.match(/href="(\/boardDownload\.es\?bid=(\d+)&amp;list_no=(\d+)&amp;seq=(\d+))"/);
    if (!view || !dl) continue;
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
    const title = text(tr.match(/<a[^>]*act=view[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "");
    const postedAt = cells.find((c) => /^\d{4}-\d{2}-\d{2}$/.test(c)) ?? "";
    const fm = text(tr).match(/([^\s[\]]+)\s*\[(pdf|hwp|hwpx|xlsx?)\s*,\s*([\d.,]+\s*[KMG]?B)\]/i);
    posts.push({
      mid, bid: dl[2], listNo: dl[3], seq: dl[4], boardSido, title, postedAt,
      file: fm ? `${fm[1]}.${fm[2].toLowerCase()}` : "", sizeLabel: fm ? fm[3].replace(/\s/g, "") : "",
      viewUrl: BASE + decode(view[1]), downloadUrl: BASE + decode(dl[1]),
    });
  }
  const pages = Number(text(html).match(/전체 페이지 수\s*(\d+)/)?.[1] ?? "1");
  return { posts, pages };
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  fs.mkdirSync(path.join(RAW, "pdf"), { recursive: true });
  const indexPath = path.join(RAW, "index.json");
  const prev: MenuPost[] = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, "utf8")).posts : [];
  const prevBy = new Map(prev.map((p) => [`${p.bid}:${p.listNo}:${p.seq}`, p]));
  const all: MenuPost[] = [];
  for (const mid of BOARDS) {
    let page = 1;
    let pages = 1;
    let bid = "";
    let boardSido = "";
    do {
      // 2쪽부터는 게시판 주소로 (menu.es 의 nPage 는 무시되어 1쪽이 되풀이됨)
      const url = page === 1 ? `${BASE}/menu.es?mid=${mid}` : `${BASE}/board.es?mid=${mid}&bid=${bid}&nPage=${page}`;
      const html = await (await get(url)).text();
      boardSido ||= text(html).match(/지방정부 서비스 메뉴판 (\S+) \1 지방정부 서비스 메뉴판/)?.[1] ?? "";
      const r = parseList(html, mid, boardSido);
      bid ||= r.posts[0]?.bid ?? "";
      for (const p of r.posts) if (!all.some((q) => q.bid === p.bid && q.listNo === p.listNo && q.seq === p.seq)) all.push(p);
      pages = r.pages;
      page++;
      await sleep(DELAY_MS);
    } while (page <= pages);
    console.log(`[mohw] ${mid} ${all.filter((p) => p.mid === mid)[0]?.boardSido ?? ""} ${all.filter((p) => p.mid === mid).length}건`);
  }
  let downloaded = 0;
  for (const p of all) {
    const key = `${p.bid}:${p.listNo}:${p.seq}`;
    const file = path.join(RAW, "pdf", `${p.bid}-${p.listNo}-${p.seq}.pdf`);
    const old = prevBy.get(key);
    if (!refresh && fs.existsSync(file) && old && old.sizeLabel === p.sizeLabel && old.title === p.title && old.sha256) {
      p.sha256 = old.sha256;
      p.fetchedAt = old.fetchedAt;
      continue;
    }
    const buf = Buffer.from(await (await get(p.downloadUrl)).arrayBuffer());
    if (buf.subarray(0, 4).toString() !== "%PDF") {
      console.warn(`[mohw] PDF 아님 — 건너뜀: ${p.title}`);
      continue;
    }
    fs.writeFileSync(file, buf);
    p.sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    p.fetchedAt = new Date().toISOString();
    if (old?.sha256 && old.sha256 !== p.sha256) console.log(`[mohw] 바뀜: ${p.title}`);
    downloaded++;
    await sleep(DELAY_MS);
  }
  fs.writeFileSync(indexPath, JSON.stringify({ checkedAt: new Date().toISOString(), source: `${BASE}/menu.es?mid=a60600000000`, posts: all }, null, 1));
  console.log(`[mohw] 글 ${all.length}건, 이번에 받은 PDF ${downloaded}개 → ${path.relative(process.cwd(), indexPath)}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

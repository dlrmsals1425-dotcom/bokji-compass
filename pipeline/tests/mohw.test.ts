/** (2026-10-17) 통합돌봄 메뉴판을 보건복지부 원문에서 직접 — 목록 읽기, 복지제도100 고정본 */
import { describe, expect, it } from "vitest";
import { get, parseList } from "../src/mohw/ingest";
import { loadWelfare100 } from "../src/sources/welfare100";
import { RegionIndex } from "../src/normalize/regions";

const ROW = `<table><tbody><tr>
<td>18</td>
<td class="ta_l"><a href="/board.es?mid=a60609000000&amp;bid=0083&amp;act=view&amp;list_no=1489637&amp;tag=&amp;nPage=1" onclick="goView('1489637'); return false;">강원도 양양군 통합돌봄 서비스 메뉴판(26년 4월 기준)</a></td>
<td>김진원</td><td>2026-03-20</td>
<td><a href="/boardDownload.es?bid=0083&amp;list_no=1489637&amp;seq=1">18. 양양군 [pdf, 237.74KB] 다운로드</a>
<a href="/attachPreview.es?bid=0083&amp;list_no=1489637&amp;seq=1">미리보기</a></td><td>160</td>
</tr></tbody></table><p>현재 페이지 1 / 전체 페이지 수 2</p>`;

describe("보건복지부 지방정부 서비스 메뉴판 목록", () => {
  it("글 하나: 제목·등록일·첨부 PDF·글번호, 전체 쪽수", () => {
    const r = parseList(ROW, "a60609000000", "강원특별자치도");
    expect(r.pages).toBe(2);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]).toMatchObject({
      bid: "0083", listNo: "1489637", seq: "1", boardSido: "강원특별자치도",
      title: "강원도 양양군 통합돌봄 서비스 메뉴판(26년 4월 기준)", postedAt: "2026-03-20", file: "양양군.pdf", sizeLabel: "237.74KB",
      downloadUrl: "https://www.mohw.go.kr/boardDownload.es?bid=0083&list_no=1489637&seq=1",
    });
  });
});

describe("복지제도100 고정본", () => {
  it("원 수집본이 없으면 고정본 100건 (welfare100 출처만)", () => {
    const recs = loadWelfare100("/nonexistent-icdash/data", RegionIndex.load(), () => {});
    expect(recs).toHaveLength(100);
    expect(new Set(recs.map((r) => r.source))).toEqual(new Set(["welfare100"]));
    expect(recs.find((r) => r.name === "보육료 지원")?.scope).toBe("national");
  });
});

describe("보건복지부 누리집 요청 다시 시도 (2026-10-23 매일 확인: 'other side closed'로 연결이 끊겨 전체 실패)", () => {
  const ok = () => new Response("ok", { status: 200 });
  it("연결이 끊기면(예외) 기다렸다가 다시 시도", async () => {
    let n = 0;
    const f = async () => { if (n++ < 2) throw new TypeError("fetch failed"); return ok(); };
    expect(await (await get("https://www.mohw.go.kr/x", f, async () => {})).text()).toBe("ok");
    expect(n).toBe(3);
  });
  it("세 번 모두 실패하면 오류", async () => {
    const f = async () => { throw new TypeError("fetch failed"); };
    await expect(get("https://www.mohw.go.kr/x", f, async () => {})).rejects.toThrow("요청 실패");
  });
});

/**
 * (2026-10-22 첫 매일 확인 뒤 보완) 메뉴판 표 읽기를 어디서 돌려도 같은 결과로.
 * 첫 실행에서 PDF는 1개만 바뀌었는데 표 약 2,400줄이 달라졌다 — 띄어쓰기 기준 문장을 모으는 번들 파일 순서가
 * 운영체제마다 달라서(glob 순서). 파일 순서를 고정하고, 바뀌지 않은 PDF의 행은 어제 결과를 그대로 쓴다.
 * 파이썬 함수는 pdfplumber 없이도 불러올 수 있다 (표 읽기 때만 필요).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MOD = path.resolve(__dirname, "../mohw");
const py = (code: string) =>
  JSON.parse(execFileSync("python3", ["-I", "-c", `import sys, json; sys.path.insert(0, ${JSON.stringify(MOD)}); import parse_menus as m\n${code}`], { encoding: "utf8" }));

describe("메뉴판 표 읽기: 순서와 무관하게 같은 결과", () => {
  it("번들 파일 목록은 이름순 (전국 → 시·도 → 시·군·구)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundles-"));
    for (const d of ["sido", "sigungu"]) fs.mkdirSync(path.join(dir, d));
    for (const f of ["sigungu/41110.json", "sido/41000.json", "sigungu/11110.json", "sido/11000.json"]) fs.writeFileSync(path.join(dir, f), "{}");
    const files: string[] = py(`print(json.dumps([p.replace(${JSON.stringify(dir)} + "/", "") for p in m.bundle_files(${JSON.stringify(dir)})]))`);
    expect(files).toEqual(["national.json", "sido/11000.json", "sido/41000.json", "sigungu/11110.json", "sigungu/41110.json"]);
  });
  it("행 ID에서 글 열쇠(게시판:글번호:첨부)", () => {
    expect(py(`print(json.dumps([m.post_key("0075:1489537:1:3:5"), m.post_key("0075:1489537:1:3:5:202604+")]))`)).toEqual(["0075:1489537:1", "0075:1489537:1"]);
  });
});

describe("바뀐 PDF만 다시 읽기", () => {
  const posts = `[{"bid":"0075","listNo":"1","seq":"1"},{"bid":"0075","listNo":"2","seq":"1"},{"bid":"0080","listNo":"3","seq":"1"}]`;
  it("다시 읽을 글: 바뀐 글 + 어제 결과에 없는 글", () => {
    const got = py(`print(json.dumps(sorted(m.posts_to_parse(json.loads('${posts}'), {"0075:1:1": [{}], "0075:2:1": [{}]}, {"0075:2:1"}))))`);
    expect(got).toEqual(["0075:2:1", "0080:3:1"]);
  });
  it("합치기: 글 순서대로, 안 바뀐 글은 어제 행 그대로, 목록에서 빠진 글의 행은 버림", () => {
    const got = py(`print(json.dumps(m.assemble(json.loads('${posts}'), {"0075:1:1": [{"n": "어제1"}], "0075:2:1": [{"n": "어제2"}], "0099:9:1": [{"n": "빠진 글"}]}, {"0075:2:1": [{"n": "오늘2a"}, {"n": "오늘2b"}], "0080:3:1": [{"n": "새 글"}]})))`);
    expect(got.map((r: { n: string }) => r.n)).toEqual(["어제1", "오늘2a", "오늘2b", "새 글"]);
  });
});

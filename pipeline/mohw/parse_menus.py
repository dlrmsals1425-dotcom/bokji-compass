"""
보건복지부 '지방정부 서비스 메뉴판' PDF → policies.csv (pipeline/src/sources/icare.ts 가 읽는 형식).

입력: pipeline/raw/mohw/index.json, pipeline/raw/mohw/pdf/*.pdf (npm run ingest:mohw)
출력: pipeline/raw/mohw/policies.csv, pipeline/raw/mohw/parse-report.json

- 표 칸: 대분류·중분류·사업명·사업내용·지원대상·제공기관·사업구분 (머리글 이름으로 칸을 찾는다)
- 쪽이 넘어가며 이어지는 줄(사업명이 빈 줄)은 앞 행에 붙이고 번호를 매기지 않는다
- 행 ID = 게시판:글번호:첨부:쪽:행 (선행 대시보드 수집본과 같은 규칙 — 상세 페이지 주소가 바뀌지 않게)
- 칸 안 줄바꿈: PDF에는 띄어쓰기 글자가 없어 줄 끝이 낱말 중간인지 알 수 없다.
  ① 지금 번들(public/bundles/v1)에 띄어쓰기만 다른 같은 문장이 있으면 그 문장을 쓰고
  ② 없으면 번들 문장으로 만든 낱말 빈도로 붙일지 띄울지 정한다
- (2026-10-22) 어디서 돌려도 같은 결과: 번들 파일을 이름순으로 읽는다 (예전엔 운영체제마다 순서가 달라 같은 PDF에서
  띄어쓰기·ID가 약 2,400줄 다르게 나왔다). --changed=글열쇠,… 를 주면 그 글과 어제 결과에 없는 글만 다시 읽고
  나머지 글의 행은 어제 policies.csv 그대로 쓴다 (매일 확인 pipeline/src/refresh/run.ts 가 바뀐 PDF만 넘긴다).
사용: python3 pipeline/mohw/parse_menus.py [--changed=게시판:글번호:첨부,…]   (pdfplumber 필요: pip install -r pipeline/mohw/requirements.txt)
"""
import csv
import glob
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
RAW = os.path.join(ROOT, "pipeline", "raw", "mohw")
BUNDLES = os.path.join(ROOT, "public", "bundles", "v1")

# 머리글 이름 (지역마다 표 모양이 달라 여러 이름을 받는다 — 앞의 것일수록 먼저, 같은 이름이 먼저, 그다음 포함)
COLS = {
    "category": ("대분류", "영역"),
    "subcategory": ("중분류",),
    "name": ("사업명", "서비스명"),
    "description": ("사업내용", "서비스내용", "내용"),
    "target": ("지원대상", "대상자범주", "세부대상자", "대상"),
    "detailTarget": ("지원대상(상세)", "세부대상자(우선순위)"),
    "provider": ("제공기관", "서비스제공기관", "제공주체", "담당부서(제공기관)", "수행기관", "기관"),
    "type": ("사업구분", "국가/지자체", "구분"),
}
# 위아래로 합친 칸 — 빈칸이면 윗줄 값을 이어받는다
FILL_DOWN = ("category", "subcategory", "type")
JUNK = re.compile(r"[\ue000-\uf8ff□■◆◇○●▶▷※]|^\d+")
SIDO_WORDS = re.compile(r"^(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충북|충청남도|충남|전북특별자치도|전라북도|전북|전라남도|전남|경상북도|경북|경상남도|경남|제주특별자치도|제주도)\s*")
HANGUL = re.compile(r"[가-힣]")
FIELDS = ["display_sido", "sido", "sigungu", "name", "program_key", "provider", "type", "target", "detailTarget", "description",
          "serviceId", "category", "service_concept", "service_concept_label", "subcategory", "detailUrl", "updatedDate"]


def nospace(s):
    return re.sub(r"\s+", "", s or "")


def bundle_files(bundles=BUNDLES):
    """읽을 번들 파일 — 이름순으로 고정 (같은 문장의 띄어쓰기가 번들마다 다를 때 먼저 읽은 것을 쓰므로 순서가 결과를 바꾼다)"""
    return [os.path.join(bundles, "national.json")] + sorted(glob.glob(os.path.join(bundles, "sido", "*.json"))) + sorted(glob.glob(os.path.join(bundles, "sigungu", "*.json")))


def post_key(row_id):
    """행 ID(게시판:글번호:첨부:쪽:행[:기준월][+]) → 글 열쇠(게시판:글번호:첨부)"""
    return ":".join(row_id.split(":")[:3])


def key_of(post):
    return f"{post['bid']}:{post['listNo']}:{post['seq']}"


def posts_to_parse(posts, prev_by_post, changed):
    """다시 읽을 글: 바뀐 글 + 어제 결과에 없는 글 (나머지는 어제 행을 그대로 쓴다)"""
    return {key_of(p) for p in posts if key_of(p) in changed or key_of(p) not in prev_by_post}


def assemble(posts, prev_by_post, parsed_by_post):
    """글 순서대로 합치기: 다시 읽은 글은 새 행, 아닌 글은 어제 행. 목록에서 빠진 글의 행은 버린다"""
    out = []
    for p in posts:
        k = key_of(p)
        out += parsed_by_post[k] if k in parsed_by_post else prev_by_post.get(k, [])
    return out


def read_prev():
    """어제 결과(policies.csv) → 글 열쇠별 행"""
    f = os.path.join(RAW, "policies.csv")
    by_post = {}
    if not os.path.exists(f):
        return by_post
    with open(f, encoding="utf-8", newline="") as fh:
        for r in csv.DictReader(fh):
            by_post.setdefault(post_key(r["serviceId"]), []).append(r)
    return by_post


def corpus(prev_rows=()):
    """띄어쓰기 기준 문장: 어제 결과(있으면 먼저) → 지금 번들. 띄어쓰기 없는 꼴 → 원래 문장, 낱말 빈도, 예전 ID → 이름"""
    spaced, vocab, old_ids = {}, Counter(), {}
    for r in prev_rows:
        old_ids[r["serviceId"]] = nospace(r["name"])
        for t in (r["name"], r["description"], r["target"], r["provider"], r["detailTarget"]):
            for piece in re.split(r"[\n/]", t or ""):
                piece = piece.strip()
                if len(piece) >= 2:
                    spaced.setdefault(nospace(piece), piece)
    for f in bundle_files():
        with open(f, encoding="utf-8") as fh:
            bundle = json.load(fh)
        items = [[p.get("name"), p.get("summary"), p.get("target"), p.get("provider")] for p in bundle["programs"]]
        for p in bundle["programs"]:
            for src in p.get("sources") or []:
                if src.get("source") == "icare":
                    old_ids.setdefault(src["id"], nospace(p["name"]))
        # 전국 사업의 '우리 지역 운영 정보'(메뉴판 행을 흡수한 것)
        for ops in (bundle.get("localOps") or {}).values():
            items += [[op.get("name"), op.get("description"), op.get("target"), op.get("provider")] for op in ops]
        for texts in items:
            for t in texts:
                if not t or not isinstance(t, str):
                    continue
                for piece in re.split(r"[\n/]", t):
                    piece = piece.strip()
                    if len(piece) >= 2:
                        spaced.setdefault(nospace(piece), piece)
                vocab.update(re.findall(r"[가-힣A-Za-z0-9]+", t))
    return spaced, vocab, old_ids


KEEP_ALONE = set("및 등 수 각 총 약 또는 그리고 및/또는".split())


def join_lines(lines, vocab):
    out = lines[0].strip()
    for nxt in lines[1:]:
        nxt = nxt.strip()
        if not nxt:
            continue
        a = re.findall(r"[가-힣A-Za-z0-9]+$", out)
        b = re.findall(r"^[가-힣A-Za-z0-9]+", nxt)
        glue = " "
        if a and b and HANGUL.search(a[0][-1]) and HANGUL.search(b[0][0]):
            A, B = a[0], b[0]
            AB = vocab.get(A + B, 0)
            if (len(A) == 1 and A not in KEEP_ALONE) or (len(B) == 1 and B not in KEEP_ALONE):
                glue = ""
            elif AB > 0 and (vocab.get(A, 0) == 0 or vocab.get(B, 0) == 0):
                glue = ""
            elif AB >= 3 and AB >= 0.2 * min(vocab.get(A, 0), vocab.get(B, 0)):
                glue = ""
        elif out.endswith("(") or nxt.startswith(")") or nxt.startswith(","):
            glue = ""
        out = out + glue + nxt
    return re.sub(r"\s+", " ", out).strip()


DOTS = str.maketrans({"・": "·", "․": "·", "ㆍ": "·", "∙": "·"})


def clean(cell, spaced, vocab, stats):
    if cell is None:
        return ""
    cell = str(cell).translate(DOTS)
    lines = [l for l in str(cell).split("\n")]
    if len(lines) == 1:
        return lines[0].strip()
    key = nospace(cell)
    if key in spaced:
        stats["reused"] += 1
        return spaced[key]
    stats["guessed"] += 1
    return join_lines(lines, vocab)


def header_map(row):
    cells = [nospace(c) for c in row]
    if not any(c in ("사업명", "서비스명") for c in cells):
        return None
    m = {}
    for field, names in COLS.items():
        hit = None
        for n in names:
            exact = [i for i, c in enumerate(cells) if c == n and i not in m.values()]
            if exact:
                hit = exact[0]
                break
        if hit is None and field not in ("detailTarget",):
            for n in names:
                part = [i for i, c in enumerate(cells) if len(n) > 2 and n in c and i not in m.values() and not (field == "target" and "상세" in c)]
                if part:
                    hit = part[0]
                    break
        if hit is not None:
            m[field] = hit
    return m


def norm_category(raw):
    c = JUNK.sub("", nospace(raw))
    if not c:
        return ""
    for key, val in (("일상", "일상생활돌봄"), ("생활", "일상생활돌봄"), ("건강", "건강관리예방"), ("예방", "건강관리예방"), ("보건", "보건의료"), ("의료", "보건의료"),
                     ("복약", "보건의료"), ("주거", "주거복지"), ("요양", "요양"), ("장애", "장애지원")):
        if key in c:
            return val
    return "기타"


def norm_type(raw):
    t = JUNK.sub("", nospace(raw))
    if re.search(r"전국|국가|중앙|공통", t):
        return "전국"
    if re.search(r"연계", t):
        return "연계"
    if not t or t == "-":
        return ""
    return "지역특화"


def stable_id(r, name, old_ids, old_by_name, used, stats):
    """예전 ID 유지: 같은 글에 같은 이름이 있으면 그 ID, 번호가 같은데 다른 사업이면 기준월을 붙인 새 ID"""
    rid = r["_id"]
    post_key = ":".join(rid.split(":")[:3])
    same = [i for i in old_by_name.get((post_key, nospace(name)), []) if i not in used]
    if same:
        pick = rid if rid in same else same[0]
        stats["id_kept" if pick == rid else "id_moved"] += 1
    elif rid in old_ids and rid not in used:
        pick = f"{rid}:{r['_updated'].replace('-', '')}"
        stats["id_new_version"] += 1
    else:
        pick = rid
        stats["id_new"] += 1
    while pick in used:
        pick += "+"
    used.add(pick)
    return pick


def sigungu_of(title, board_sido):
    t = SIDO_WORDS.sub("", title.strip())
    m = re.match(r"([가-힣]+(?:시|군|구))(?:\s+([가-힣]+구))?\s", t)
    if m and "통합돌봄" not in m.group(1):
        return m.group(1)
    return board_sido


def updated_of(title, posted):
    m = re.search(r"(\d{2})년\s*(\d{1,2})월\s*기준", title)
    return f"20{m.group(1)}-{int(m.group(2)):02d}" if m else posted[:7]


def main():
    import pdfplumber

    with open(os.path.join(RAW, "index.json"), encoding="utf-8") as fh:
        index = json.load(fh)
    arg = next((a for a in sys.argv[1:] if a.startswith("--changed=")), None)
    prev_by_post = read_prev() if arg is not None else {}
    changed = set(filter(None, arg.split("=", 1)[1].split(","))) if arg else set()
    todo = posts_to_parse(index["posts"], prev_by_post, changed)
    spaced, vocab, old_ids = corpus([r for rows in prev_by_post.values() for r in rows])
    # 글(게시판:글번호)별 예전 이름 → 예전 ID (메뉴판 파일이 새 판으로 바뀌어 쪽·행이 밀려도 같은 사업은 같은 ID)
    old_by_name = {}
    for oid, nm in old_ids.items():
        post_key = ":".join(oid.split(":")[:3])
        old_by_name.setdefault((post_key, nm), []).append(oid)
    stats = Counter()
    rows, per_post = [], []
    for post in index["posts"]:
        if key_of(post) not in todo:
            kept = prev_by_post.get(key_of(post), [])
            stats["kept_rows"] += len(kept)
            per_post.append({"title": post["title"], "sigungu": sigungu_of(post["title"], post["boardSido"]), "updated": updated_of(post["title"], post["postedAt"]), "rows": len(kept), "kept": True})
            continue
        pdf_path = os.path.join(RAW, "pdf", f"{post['bid']}-{post['listNo']}-{post['seq']}.pdf")
        if not os.path.exists(pdf_path):
            per_post.append({"title": post["title"], "rows": 0, "error": "PDF 없음"})
            continue
        sigungu = sigungu_of(post["title"], post["boardSido"])
        updated = updated_of(post["title"], post["postedAt"])
        n = 0
        hmap = None
        last = {}
        with pdfplumber.open(pdf_path) as pdf:
            for pi, page in enumerate(pdf.pages, start=1):
                ri = 0
                for table in page.extract_tables():
                    for row in table:
                        h = header_map(row)
                        if h:
                            hmap = h
                            continue
                        if not hmap or len(row) <= max(hmap.values()):
                            stats["skipped_rows"] += 1
                            continue
                        get = lambda f: row[hmap[f]] if f in hmap else ""
                        if not nospace(get("name")):
                            # 앞 쪽에서 이어지는 줄 → 앞 행에 붙인다
                            if rows and rows[-1]["_post"] == post["listNo"]:
                                prev = rows[-1]
                                for f in ("description", "target", "provider"):
                                    extra = (get(f) or "").strip()
                                    if extra:
                                        prev["_raw"][f] = (prev["_raw"][f] + "\n" + extra).strip()
                                stats["continued"] += 1
                            continue
                        ri += 1
                        n += 1
                        raw = {f: (get(f) or "") for f in COLS}
                        for f in FILL_DOWN:
                            if nospace(raw[f]):
                                last[f] = raw[f]
                            else:
                                raw[f] = last.get(f, "")
                        rows.append({"_key": key_of(post), "_post": post["listNo"], "_raw": raw, "_id": f"{post['bid']}:{post['listNo']}:{post['seq']}:{pi}:{ri}",
                                     "_sigungu": sigungu, "_board": post["boardSido"], "_updated": updated, "_url": post["viewUrl"]})
        per_post.append({"title": post["title"], "sigungu": sigungu, "updated": updated, "rows": n})
    parsed = {k: [] for k in todo}
    used = {r["serviceId"] for k, rs in prev_by_post.items() if k not in todo for r in rs}
    for r in rows:
        raw = r["_raw"]
        sub = JUNK.sub("", clean(raw["subcategory"], spaced, vocab, stats)).strip()
        name = clean(raw["name"], spaced, vocab, stats)
        concept_label = sub
        parsed[r["_key"]].append({
            "display_sido": r["_board"], "sido": r["_board"], "sigungu": r["_sigungu"],
            "name": name, "program_key": name, "provider": clean(raw["provider"], spaced, vocab, stats),
            "type": norm_type(raw["type"]) or "지역특화", "target": clean(raw["target"], spaced, vocab, stats), "detailTarget": clean(raw["detailTarget"], spaced, vocab, stats),
            "description": clean(raw["description"], spaced, vocab, stats), "serviceId": stable_id(r, name, old_ids, old_by_name, used, stats),
            "category": norm_category(raw["category"]) or "기타", "service_concept": "", "service_concept_label": concept_label,
            "subcategory": sub, "detailUrl": r["_url"], "updatedDate": r["_updated"],
        })
    out = assemble(index["posts"], prev_by_post, parsed)
    with open(os.path.join(RAW, "policies.csv"), "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(out)
    report = {"posts": len(index["posts"]), "parsed": len(todo), "rows": len(out), "stats": dict(stats),
              "byBoard": dict(Counter(r["display_sido"] for r in out)), "categories": dict(Counter(r["category"] for r in out)),
              "types": dict(Counter(r["type"] for r in out)), "perPost": per_post}
    with open(os.path.join(RAW, "parse-report.json"), "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=1)
    print(f"[mohw] 글 {report['posts']}건 (다시 읽음 {len(todo)}) → 행 {report['rows']}개 · 띄어쓰기 기존 문장 {stats['reused']} / 추정 {stats['guessed']} · 이어진 줄 {stats['continued']}")


if __name__ == "__main__":
    sys.exit(main())

"""Import the user's public blank HWP files without modifying their originals."""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import olefile

parser = argparse.ArgumentParser()
parser.add_argument("source", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source = args.source.resolve()
manifest_path = source / "목록.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
annex_manifest = json.loads((source / "all_annexes.json").read_text(encoding="utf-8-sig"))
annexes = {str(row["별표일련번호"]): row for row in annex_manifest["items"]}
destination = root / "pipeline" / "forms" / "originals"
destination.mkdir(parents=True, exist_ok=True)
log_dir = root / "logs" / "forms"
log_dir.mkdir(parents=True, exist_ok=True)
fetched = datetime.fromtimestamp(manifest_path.stat().st_mtime, timezone.utc).isoformat()
records, texts = [], {}
for entry in manifest["items"]:
    file_path = (source / entry["저장경로"]).resolve()
    if not file_path.is_relative_to(source / "files"):
        raise ValueError("File outside the provided forms directory")
    content = file_path.read_bytes()
    if content[:8] != bytes.fromhex("d0cf11e0a1b11ae1"):
        raise ValueError("Not an HWP compound document")
    annex = str(entry["별표일련번호"])
    if not annex.isdigit():
        raise ValueError("Unexpected annex id")
    official = annexes.get(annex)
    if not official or official.get("지자체기관명") != "고양시" or not entry["조례명"].startswith("고양시 "):
        raise ValueError("This source adapter requires explicitly confirmed Goyang jurisdiction")
    if str(official.get("관련자치법규일련번호")) != str(entry["조례일련번호"]):
        raise ValueError("Annex law does not match downloaded manifest")
    form_id = "ordin-" + annex
    digest = hashlib.sha256(content).hexdigest()
    (destination / (form_id + ".hwp")).write_bytes(content)
    with olefile.OleFileIO(content) as document:
        preview = document.openstream("PrvText").read().decode("utf-16le", errors="replace") if document.exists("PrvText") else ""
    texts[form_id] = {"title": entry["서식명"], "lawTitle": entry["조례명"], "previewText": preview}
    day = str(entry["시행일자"])
    effective = f"{day[:4]}-{day[4:6]}-{day[6:8]}" if len(day) == 8 else day
    records.append({"id": form_id, "title": entry["서식명"], "declaredKind": entry["구분"],
        "lawTitle": entry["조례명"], "lawId": str(entry["조례일련번호"]), "annexId": annex,
        "annexNumber": str(entry["별표번호"]), "regionCode": "41280", "regionLabel": "경기도 고양시",
        "effectiveDate": effective, "sourceUrl": entry["파일링크"],
        "lawUrl": "https://www.law.go.kr/ordinInfoP.do?ordinSeq=" + str(entry["조례일련번호"]),
        "fetchedAt": fetched, "sha256": digest, "bytes": len(content)})
if len({row["id"] for row in records}) != len(records):
    raise ValueError("Duplicate annex ids")
(root / "pipeline" / "forms" / "source-manifest.json").write_text(json.dumps({"schema": 1, "sourceNote": "고양시 자치법규에서 확보한 별표·서식. 전국 서식 수집 완료를 뜻하지 않습니다.", "forms": records}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(log_dir / "hwp-preview-text.json").write_text(json.dumps(texts, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps({"imported": len(records), "bytes": sum(row["bytes"] for row in records), "sourceChanged": False}))

"""미연결 원본 서식의 검토 대기열.

범위에 있는 서식을 빠뜨리지 않고 법령별로 묶는다.
후보와 검색 범위만 만들며, 승인·기각·검토완료는 표시하지 않는다.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BATCH_SIZE = 60
SOURCE_KINDS = frozenset({"ordin", "law", "rule"})
PORTAL_FIELDS = (
    "sourceKind", "declaredKind", "role", "annexId", "annexNumber", "regionLabel",
    "effectiveDate", "dateKind", "stableLawId", "lawUrl", "officialPdfUrl",
)
INPUTS = (
    "pipeline/forms/reviews/unmatched-originals-scope.json",
    "pipeline/forms/portal-forms.json",
    "pipeline/forms/portal-matches.json",
    "pipeline/forms/law-body-audit.json",
    "public/bundles/v1/regions.json",
)


def load_matcher():
    spec = importlib.util.spec_from_file_location("portal_match", REPO / "pipeline/forms/portal_match.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_hashed(path: Path):
    raw = path.read_bytes()
    return hashlib.sha256(raw).hexdigest(), len(raw), json.loads(raw.decode("utf-8-sig"))


def file_record(path: Path):
    digest, size, payload = read_hashed(path)
    return {"sha256": digest, "bytes": size}, payload


def combined_hash(rows: list[tuple[str, str]]) -> str:
    digest = hashlib.sha256()
    for name, file_hash in rows:
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(file_hash.encode("ascii"))
        digest.update(b"\n")
    return digest.hexdigest()


def require_schema(payload: dict, label: str):
    if not isinstance(payload, dict) or payload.get("schema") != 1:
        raise ValueError(f"{label} schema must be 1")
    return payload


def region_catalog(regions: dict) -> dict[str, dict]:
    found = {}
    for sido in regions.get("sidos") or []:
        if not isinstance(sido, dict):
            continue
        sido_code = str(sido.get("code") or "")
        sido_name = str(sido.get("name") or "")
        if sido_code:
            found[sido_code] = {"sido": sido_code, "sidoName": sido_name, "sigunguName": ""}
        for city in sido.get("sigungus") or []:
            if not isinstance(city, dict):
                continue
            code = str(city.get("code") or "")
            if code:
                found[code] = {"sido": sido_code, "sidoName": sido_name, "sigunguName": str(city.get("name") or "")}
    return found


def is_sigungu(code: str) -> bool:
    return len(code) == 5 and code.isdigit() and not code.endswith("000")


def geography_for(code: str, catalog: dict) -> dict | None:
    """시·군·구 공식 이름. law_aliases가 코드로 이름을 만들지 않도록 카탈로그 이름만 넘긴다."""
    if not is_sigungu(code):
        return None
    info = catalog.get(code)
    if not info:
        return None
    sido, sigungu = info.get("sidoName") or "", info.get("sigunguName") or ""
    if len(sido) < 2 or len(sigungu) < 2:
        return None
    return {"sido": sido, "sigungu": sigungu}


def program_region(program: dict) -> str:
    scope = str(program.get("scope") or "")
    region = program.get("region") if isinstance(program.get("region"), dict) else {}
    if scope == "national":
        return "national"
    if scope == "sido":
        return str(region.get("sido") or "")
    if scope == "sigungu":
        return str(region.get("sigungu") or "")
    return ""


def cited_norms(matcher, texts: list[str]) -> list[str]:
    found = []
    for entry in texts:
        for part in matcher.split_law_citations(entry):
            norm = matcher.normalize_law(part)
            if norm and norm not in found:
                found.append(norm)
    return found


def citation_sources(program_id: str, program: dict, audit_programs: dict, audit_laws: dict):
    texts = []
    raw = program.get("laws") or []
    if isinstance(raw, str):
        raw = [raw]
    if isinstance(raw, list):
        texts.extend(item for item in raw if isinstance(item, str))
    identities = []
    info = audit_programs.get(program_id)
    keys = info.get("lawKeys") if isinstance(info, dict) else None
    if isinstance(keys, list):
        for key in keys:
            record = audit_laws.get(key) if isinstance(key, str) else None
            if not isinstance(record, dict) or record.get("state") != "read":
                continue
            title = record.get("title")
            if isinstance(title, str) and title.strip():
                texts.append(title.strip())
            kind = str(record.get("kind") or "")
            law_id = str(record.get("id") or "")
            if kind in SOURCE_KINDS and law_id.isdigit():
                identities.append((kind, law_id))
    return texts, identities


class CitationIndex:
    """같은 지역 안에서 exact / family 제명만 연결한다. 부분 문자열 색인은 만들지 않는다."""

    def __init__(self):
        self.exact = defaultdict(set)
        self.family = defaultdict(set)
        self.raw = defaultdict(set)
        self.law_ids = defaultdict(set)

    def add(self, matcher, program_id: str, region: str, norms: list[str], geography, identities):
        for norm in norms:
            self.raw[(region, norm)].add(program_id)
            for alias in matcher.law_aliases(norm, geography):
                variants = matcher.law_variants(alias)
                if not variants:
                    continue
                self.exact[(region, variants[0])].add(program_id)
                for child in variants[1:]:
                    self.family[(region, child)].add(program_id)
        for kind, law_id in identities:
            self.law_ids[(region, kind, law_id)].add(program_id)

    def lookup(self, matcher, region: str, law_title: str, law_id: str, kind: str, geography):
        exact = set(self.law_ids.get((region, kind, str(law_id or "")), ()))
        family = set()
        for name in matcher.law_aliases(law_title, geography):
            exact.update(self.exact.get((region, name), ()))
            family.update(self.family.get((region, name), ()))
            for child in matcher.law_variants(name)[1:]:
                family.update(self.raw.get((region, child), ()))
        family -= exact
        return sorted(exact), sorted(family)


def source_kind(form_id: str, portal_row: dict | None) -> str:
    declared = str((portal_row or {}).get("sourceKind") or "")
    if declared in SOURCE_KINDS:
        return declared
    prefix = form_id.split("-", 1)[0]
    return prefix if prefix in SOURCE_KINDS else ""


def original_metadata(scope_row: dict, portal_row: dict | None) -> dict:
    form_id = str(scope_row["formId"])
    data = {
        "formId": form_id,
        "title": scope_row.get("title") or "",
        "lawId": str(scope_row.get("lawId") or ""),
        "lawTitle": scope_row.get("lawTitle") or "",
        "regionCode": str(scope_row.get("regionCode") or ""),
        "format": scope_row.get("format") or "",
        "sourceUrl": scope_row.get("sourceUrl") or "",
        "relativePath": scope_row.get("relativePath") or "",
        "sha256": str(scope_row.get("sha256") or ""),
        "sourceKind": source_kind(form_id, portal_row),
    }
    for key in PORTAL_FIELDS:
        if key == "sourceKind" or not portal_row or key not in portal_row:
            continue
        value = portal_row.get(key)
        if value not in (None, ""):
            data[key] = value
    return data


def source_reference(form_id: str, scope_row: dict, download: dict | None) -> dict:
    sections = []
    if isinstance((download or {}).get("sectionsRead"), list):
        sections = [item for item in download["sectionsRead"] if isinstance(item, str)]
    digest = str(scope_row.get("sha256") or "")
    return {
        "sha256": digest,
        "record": f"logs/law-downloads/{form_id}.json",
        "recordPresent": download is not None,
        "textScope": None if download is None else download.get("textScope"),
        "sectionsRead": sections,
        "textLength": download.get("textLength") if isinstance((download or {}).get("textLength"), int) else None,
        "bytes": download.get("bytes") if isinstance((download or {}).get("bytes"), int) else None,
        "format": (download or {}).get("format") or scope_row.get("format") or "",
        "sha256MatchesScope": bool(digest) and bool(download) and download.get("sha256") == digest,
    }


def portal_candidates(form_id: str, reverse: dict, current_ids: set[str]) -> tuple[list[dict], int]:
    chosen = {}
    ignored = 0
    for program_id, candidate in reverse.get(form_id, []):
        if program_id not in current_ids:
            ignored += 1
            continue
        previous = chosen.get(program_id)
        rank = (int(candidate.get("score") or 0), str(candidate.get("basis") or ""))
        if previous is None or rank > previous[0]:
            chosen[program_id] = (rank, candidate)
    entries = []
    for program_id in sorted(chosen):
        candidate = chosen[program_id][1]
        basis = str(candidate.get("basis") or "")
        entries.append({
            "programId": program_id,
            "basis": basis,
            "scopeBasis": str(candidate.get("scopeBasis") or ""),
            "approved": False,
            "disposition": "search_candidate" if basis == "law_family" else "pending_candidate",
        })
    return entries, ignored


def assign_batches(groups: list[tuple[str, list]], batch_size: int) -> list[list]:
    """한 법령은 batch_size를 넘을 때만 나눈다. 입력 순서를 유지한다."""
    if batch_size < 1:
        raise ValueError("batch_size must be positive")
    units = []
    for law_id, items in groups:
        if len(items) <= batch_size:
            units.append((law_id, list(items)))
        else:
            for start in range(0, len(items), batch_size):
                units.append((law_id, list(items[start:start + batch_size])))
    batches = []
    current = []
    for _law_id, unit in units:
        if current and len(current) + len(unit) > batch_size:
            batches.append(current)
            current = []
        current.extend(unit)
    if current:
        batches.append(current)
    check_batches(groups, batches, batch_size)
    return batches


def check_batches(groups, batches, batch_size: int):
    flat = [item for batch in batches for item in batch]
    expected = [item for _law_id, items in groups for item in items]
    if flat != expected:
        raise ValueError("Batch order changed the law grouping")
    batch_of = {}
    for index, batch in enumerate(batches):
        if not batch or len(batch) > batch_size:
            raise ValueError("Batch size is outside 1..batch_size")
        for item in batch:
            batch_of[item["formId"]] = index
    for law_id, items in groups:
        indexes = [batch_of[item["formId"]] for item in items]
        if indexes != sorted(indexes) or max(indexes) - min(indexes) != len(set(indexes)) - 1:
            raise ValueError(f"Law {law_id} is interleaved across batches")
        if len(items) <= batch_size and len(set(indexes)) != 1:
            raise ValueError(f"Law {law_id} was split without exceeding the batch size")


def load_inputs(data_root: Path):
    inputs = {}
    loaded = {}
    for relative in INPUTS:
        path = data_root / relative
        record, payload = file_record(path)
        inputs[relative] = record
        loaded[relative] = payload
    scope = require_schema(loaded[INPUTS[0]], "scope")
    forms = scope.get("forms")
    if not isinstance(forms, list):
        raise ValueError("Scope forms must be a list")
    if scope.get("formCount") not in (None, len(forms)):
        raise ValueError("Scope formCount does not match the form list")
    portal_forms = require_schema(loaded[INPUTS[1]], "portal-forms").get("forms")
    matches = require_schema(loaded[INPUTS[2]], "portal-matches").get("programs")
    audit = require_schema(loaded[INPUTS[3]], "law-body-audit")
    regions = require_schema(loaded[INPUTS[4]], "regions")
    if not isinstance(portal_forms, dict) or not isinstance(matches, dict):
        raise ValueError("Portal form and match indexes must be objects")
    if not isinstance(audit.get("laws"), dict) or not isinstance(audit.get("programs"), dict):
        raise ValueError("Law audit must contain laws and programs")
    for record in audit["laws"].values():
        if isinstance(record, dict):
            record.pop("applicationArticles", None)
            record.pop("annexes", None)

    programs = {}
    detail_rows = []
    for path in sorted((data_root / "public/bundles/v1/details").glob("*.json")):
        digest, _size, payload = read_hashed(path)
        if not isinstance(payload, dict):
            raise ValueError(f"Program detail is not an object: {path.name}")
        detail_rows.append((path.name, digest))
        for key, program in payload.items():
            if key in programs:
                raise ValueError(f"Duplicate program id: {key}")
            if isinstance(program, dict):
                programs[key] = program
    inputs["public/bundles/v1/details"] = {"sha256": combined_hash(detail_rows), "files": len(detail_rows)}

    downloads = {}
    download_rows = []
    missing = []
    for row in forms:
        form_id = str(row.get("formId") or "")
        path = data_root / "logs/law-downloads" / f"{form_id}.json"
        if not path.is_file():
            missing.append(form_id)
            continue
        digest, _size, payload = read_hashed(path)
        if not isinstance(payload, dict):
            raise ValueError(f"Download record is not an object: {form_id}")
        payload.pop("text", None)
        payload.pop("localPath", None)
        downloads[form_id] = payload
        download_rows.append((form_id, digest))
    inputs["logs/law-downloads"] = {
        "sha256": combined_hash(download_rows),
        "files": len(download_rows),
        "missing": len(missing),
    }
    return {
        "inputs": inputs,
        "scope": scope,
        "portalForms": portal_forms,
        "matches": matches,
        "auditLaws": audit["laws"],
        "auditPrograms": audit["programs"],
        "catalog": region_catalog(regions),
        "programs": programs,
        "downloads": downloads,
        "missingDownloads": missing,
    }


def build_queue(data_root: Path, batch_size: int = BATCH_SIZE) -> dict:
    matcher = load_matcher()
    loaded = load_inputs(data_root)
    programs = loaded["programs"]
    current_ids = set(programs)
    catalog = loaded["catalog"]
    index = CitationIndex()
    region_programs = defaultdict(list)
    for program_id in sorted(programs):
        program = programs[program_id]
        region = program_region(program)
        region_programs[region].append(program_id)
        texts, identities = citation_sources(program_id, program, loaded["auditPrograms"], loaded["auditLaws"])
        index.add(matcher, program_id, region, cited_norms(matcher, texts), geography_for(region, catalog), identities)

    reverse = defaultdict(list)
    for program_id, row in loaded["matches"].items():
        if not isinstance(row, dict):
            continue
        for candidate in row.get("candidates") or []:
            if isinstance(candidate, dict) and candidate.get("formId"):
                reverse[str(candidate["formId"])].append((str(program_id), candidate))

    items_by_law = defaultdict(list)
    ignored_portal = 0
    seen = set()
    for row in loaded["scope"]["forms"]:
        if not isinstance(row, dict) or not row.get("formId"):
            raise ValueError("Scope row is missing formId")
        form_id = str(row["formId"])
        if form_id in seen:
            raise ValueError(f"Duplicate scope form id: {form_id}")
        seen.add(form_id)
        portal_row = loaded["portalForms"].get(form_id)
        portal_row = portal_row if isinstance(portal_row, dict) else None
        original = original_metadata(row, portal_row)
        region = original["regionCode"]
        kind = original["sourceKind"]
        exact_ids, family_ids = index.lookup(
            matcher, region, original["lawTitle"], original["lawId"], kind, geography_for(region, catalog),
        )
        if any(program_id not in current_ids for program_id in exact_ids + family_ids):
            raise ValueError("Citation index emitted a program id that is not current")
        portal, ignored = portal_candidates(form_id, reverse, current_ids)
        ignored_portal += ignored
        family = [{
            "programId": program_id,
            "relation": "same_region_law_family",
            "approved": False,
            "disposition": "search_candidate",
        } for program_id in family_ids]
        examine = None
        if not portal and not exact_ids and not family:
            examine = {
                "regionCode": region,
                "programIdsRef": region,
                "programCount": len(region_programs.get(region, ())),
            }
        items_by_law[original["lawId"]].append({
            "formId": form_id,
            "reviewState": "pending",
            "approved": False,
            "lawId": original["lawId"],
            "original": original,
            "sourceRef": source_reference(form_id, row, loaded["downloads"].get(form_id)),
            "portalMatchCandidates": portal,
            "exactLawProgramIds": exact_ids,
            "familySearchCandidates": family,
            "sameRegionExamine": examine,
        })

    groups = []
    for law_id in sorted(items_by_law):
        forms = sorted(items_by_law[law_id], key=lambda item: item["formId"])
        titles = sorted({item["original"]["lawTitle"] for item in forms})
        regions = sorted({item["original"]["regionCode"] for item in forms})
        groups.append({
            "lawId": law_id,
            "lawTitle": titles[0] if len(titles) == 1 else "",
            "lawTitles": titles,
            "regionCode": regions[0] if len(regions) == 1 else "",
            "regionCodes": regions,
            "formCount": len(forms),
            "forms": forms,
        })
    batched = assign_batches([(group["lawId"], group["forms"]) for group in groups], batch_size)
    scope_ids = [str(row["formId"]) for row in loaded["scope"]["forms"]]
    queued = [item["formId"] for group in groups for item in group["forms"]]
    if len(queued) != len(scope_ids) or set(queued) != set(scope_ids):
        raise ValueError("Queue does not contain each scope id exactly once")
    if Counter(item["original"]["format"] for group in groups for item in group["forms"]) != Counter(
            (row.get("format") or "") for row in loaded["scope"]["forms"]):
        raise ValueError("Queue dropped or changed a source format")

    referenced_regions = sorted({
        item["sameRegionExamine"]["programIdsRef"]
        for group in groups for item in group["forms"] if item["sameRegionExamine"]
    })
    shared_regions = {code: region_programs.get(code, []) for code in referenced_regions}
    manifests = []
    for number, batch in enumerate(batched, start=1):
        batch_id = f"batch-{number:03d}"
        manifests.append({
            "batchId": batch_id,
            "file": f"batches/{batch_id}.json",
            "formCount": len(batch),
            "lawIds": list(dict.fromkeys(item["lawId"] for item in batch)),
            "formIds": [item["formId"] for item in batch],
        })
    items = [item for group in groups for item in group["forms"]]
    counts = queue_counts(items, groups, manifests, ignored_portal, loaded["missingDownloads"], batch_size)
    return {
        "schema": 1,
        "reviewState": "pending",
        "note": "대기열 구성만 한다. 이 파일만으로 서식을 승인·기각·검토완료로 표시하지 않는다.",
        "batchSize": batch_size,
        "scope": {
            "formCount": len(scope_ids),
            "baselineCommit": loaded["scope"].get("baselineCommit") or "",
            "statement": loaded["scope"].get("scope") or "",
        },
        "inputs": loaded["inputs"],
        "counts": counts,
        "regionPrograms": shared_regions,
        "batches": manifests,
        "lawGroups": groups,
    }


def queue_counts(items, groups, manifests, ignored_portal: int, missing_downloads: list[str], batch_size: int) -> dict:
    def has_family_approval(item):
        return any(row.get("approved") or row.get("disposition") != "search_candidate" for row in item["familySearchCandidates"])

    return {
        "scopeIds": len(items),
        "items": len(items),
        "lawGroups": len(groups),
        "batches": len(manifests),
        "batchFormCounts": [batch["formCount"] for batch in manifests],
        "pending": sum(item["reviewState"] == "pending" and item["approved"] is False for item in items),
        "markedApproved": sum(item["approved"] is True for item in items),
        "markedRejected": sum(item["reviewState"] == "rejected" for item in items),
        "markedReviewed": sum(item["reviewState"] == "reviewed" for item in items),
        "familyMarkedApproved": sum(has_family_approval(item) for item in items),
        "formats": dict(sorted(Counter(item["original"]["format"] for item in items).items())),
        "textScopes": dict(sorted(Counter(
            str(item["sourceRef"]["textScope"]) for item in items).items())),
        "withPortalCandidates": sum(bool(item["portalMatchCandidates"]) for item in items),
        "withExactLawCandidates": sum(bool(item["exactLawProgramIds"]) for item in items),
        "withFamilySearchCandidates": sum(bool(item["familySearchCandidates"]) for item in items),
        "withSameRegionExamine": sum(bool(item["sameRegionExamine"]) for item in items),
        "missingPortalMetadata": sum("role" not in item["original"] and "declaredKind" not in item["original"] for item in items),
        "missingDownloadRecords": len(missing_downloads),
        "ignoredUnknownPortalProgramIds": ignored_portal,
        "lawsSplit": sum(group["formCount"] > batch_size for group in groups),
    }


def dump(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def write_queue(queue: dict, output: Path, batch_dir: Path):
    output.parent.mkdir(parents=True, exist_ok=True)
    batch_dir.mkdir(parents=True, exist_ok=True)
    for stale in batch_dir.glob("batch-*.json"):
        stale.unlink()
    items = {item["formId"]: item for group in queue["lawGroups"] for item in group["forms"]}
    regions = queue["regionPrograms"]
    for manifest in queue["batches"]:
        batch_items = [items[form_id] for form_id in manifest["formIds"]]
        used = sorted({
            item["sameRegionExamine"]["programIdsRef"]
            for item in batch_items if item["sameRegionExamine"]
        })
        payload = {
            "schema": 1,
            "reviewState": "pending",
            "batchId": manifest["batchId"],
            "batchSize": queue["batchSize"],
            "formCount": len(batch_items),
            "lawIds": manifest["lawIds"],
            "inputs": queue["inputs"],
            "regionPrograms": {code: regions[code] for code in used},
            "forms": batch_items,
        }
        (batch_dir / f"{manifest['batchId']}.json").write_text(dump(payload), encoding="utf-8", newline="\n")
    output.write_text(dump(queue), encoding="utf-8", newline="\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description="미연결 원본 서식 검토 대기열을 만든다. 승인하지 않는다.")
    parser.add_argument("--data-root", type=Path, default=REPO)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    args = parser.parse_args(argv)
    output = args.output or (args.data_root / "logs/forms-completion/review-queue.json")
    queue = build_queue(args.data_root, batch_size=args.batch_size)
    write_queue(queue, output, output.parent / "batches")
    counts = queue["counts"]
    print(json.dumps({
        "items": counts["items"],
        "lawGroups": counts["lawGroups"],
        "batches": counts["batches"],
        "batchFormCounts": {
            "min": min(counts["batchFormCounts"]) if counts["batchFormCounts"] else 0,
            "max": max(counts["batchFormCounts"]) if counts["batchFormCounts"] else 0,
        },
        "pending": counts["pending"],
        "markedApproved": counts["markedApproved"],
        "markedRejected": counts["markedRejected"],
        "markedReviewed": counts["markedReviewed"],
        "formats": counts["formats"],
        "textScopes": counts["textScopes"],
        "withPortalCandidates": counts["withPortalCandidates"],
        "withExactLawCandidates": counts["withExactLawCandidates"],
        "withFamilySearchCandidates": counts["withFamilySearchCandidates"],
        "withSameRegionExamine": counts["withSameRegionExamine"],
        "ignoredUnknownPortalProgramIds": counts["ignoredUnknownPortalProgramIds"],
        "output": output.name,
        "batchFiles": counts["batches"],
    }, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

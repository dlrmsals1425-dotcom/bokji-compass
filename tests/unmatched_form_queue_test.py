"""검토 대기열은 범위의 서식을 빠뜨리지 않고, 법령 계열은 승인으로 올리지 않는다."""

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "unmatched_form_queue", ROOT / "scripts/prepare-unmatched-form-review.py")
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)

PARENT = "서울특별시 종로구 입학준비금 지원 조례"
RULE = PARENT + " 시행규칙"
LEAKS = ("SECRET_BODY", "PRIVATE_LOCAL_PATH_SENTINEL", "ARTICLE_BODY_LEAK", "PROGRAM_CORPUS_SUMMARY_LEAK")


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def program(program_id, region, laws=None, law_keys=None):
    return program_id, {
        "id": program_id,
        "name": program_id,
        "summary": "PROGRAM_CORPUS_SUMMARY_LEAK",
        "scope": "sigungu",
        "region": {"sido": "11000", "sigungu": region, "label": region},
        "laws": laws or [],
    }, law_keys or []


def form(form_id, law_id, law_title, region, fmt, title, role=None, declared=None):
    row = {
        "formId": form_id, "sha256": "ab" * 32, "format": fmt, "lawId": law_id,
        "lawTitle": law_title, "title": title, "regionCode": region,
        "sourceUrl": "https://www.law.go.kr/LSW/flDownload.do?flSeq=1",
        "relativePath": f"{form_id}.hwp",
    }
    portal = None
    if role or declared:
        portal = {
            "id": form_id, "sourceKind": "ordin", "title": title, "lawTitle": law_title,
            "lawId": law_id, "regionCode": region, "regionLabel": "서울특별시 종로구" if region == "11110" else "서울특별시 중구",
            "role": role, "declaredKind": declared or "서식",
        }
    return row, portal


def download(row, text_scope, sections):
    return {
        "formId": row["formId"], "state": "stored", "sha256": row["sha256"], "bytes": 12,
        "format": row["format"], "textScope": text_scope, "sectionsRead": sections,
        "textLength": 4, "text": f"SECRET_BODY {row['formId']}",
        "localPath": "PRIVATE_LOCAL_PATH_SENTINEL", "lawId": row["lawId"], "lawTitle": row["lawTitle"],
    }


def law_record(law_id, title):
    return {
        "state": "read", "kind": "ordin", "id": law_id, "title": title, "query": title,
        "url": "", "checkedAt": "2026-10-17",
        "applicationArticles": [{"number": "1", "text": "ARTICLE_BODY_LEAK"}],
        "annexes": [{"title": "ARTICLE_BODY_LEAK"}],
    }


class UnmatchedFormQueueTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.build_fixture()

    def tearDown(self):
        self.temporary.cleanup()

    def build_fixture(self):
        specs = [
            program("exact-program", "11110", [RULE], ["11110|rule"]),
            program("parent-program", "11110", [], ["11110|parent"]),
            program("text-family", "11110", ["종로구 입학준비금 지원 조례"]),
            program("rule-citer", "11110", [RULE]),
            program("decoy-short", "11110", ["입학준비금 지원 조례"]),
            program("decoy-decree", "11110", [PARENT + " 시행령"]),
            program("junggu-program", "11140", [PARENT], ["11140|parent-copy"]),
            program("junggu-plain", "11140"),
        ]
        details = {}
        audit_programs = {}
        for program_id, body, keys in specs:
            details[program_id] = body
            audit_programs[program_id] = {"lawKeys": keys}
        write_json(self.root / "public/bundles/v1/details/00.json", details)
        write_json(self.root / "public/bundles/v1/regions.json", {"schema": 1, "sidos": [{
            "code": "11000", "name": "서울특별시",
            "sigungus": [{"code": "11110", "name": "종로구"}, {"code": "11140", "name": "중구"}],
        }]})
        write_json(self.root / "pipeline/forms/law-body-audit.json", {
            "schema": 1,
            "laws": {
                "11110|parent": law_record("100", PARENT),
                "11110|rule": law_record("200", RULE),
                "11140|parent-copy": law_record("100", PARENT),
            },
            "programs": audit_programs,
        })
        rows = [
            form("ordin-1", "200", RULE, "11110", "hwp", "입학준비금 지원 신청서", "application"),
            form("ordin-2", "200", RULE, "11110", "gif", "[별표 1] 지급 기준", "reference", "별표"),
            form("ordin-3", "100", PARENT, "11110", "hwp3", "입학준비금 지원 신청서", "application"),
            form("ordin-9", "100", "다른 제명", "11110", "bin", "보관 파일"),
            form("ordin-5", "300", "중구 예시 조례", "11140", "txt", "예시 신청서", "application"),
            form("ordin-6", "400", "종로구 예시 조례", "11110", "pdf", "예시", "application"),
            form("ordin-7", "400", "종로구 예시 조례", "11110", "protected_hwp", "예시", "application"),
            form("ordin-8", "400", "종로구 예시 조례", "11110", "htm", "예시", "application"),
            form("ordin-4", "999", "이름 없는 서식", "11110", "zzz", "미상 형식"),
        ]
        scope_forms = []
        portal_forms = {}
        for row, portal in rows:
            scope_forms.append(row)
            if portal:
                portal_forms[row["formId"]] = portal
            scope_name = "archived" if row["format"] == "hwp3" else "all_body_sections_or_pages"
            sections = [] if row["format"] in {"hwp3", "gif", "zzz", "bin"} else ["BodyText/Section0"]
            write_json(self.root / "logs/law-downloads" / f"{row['formId']}.json", download(row, scope_name, sections))
        write_json(self.root / "pipeline/forms/reviews/unmatched-originals-scope.json", {
            "schema": 1, "formCount": len(scope_forms), "baselineCommit": "abc",
            "scope": "fixture", "forms": scope_forms,
        })
        write_json(self.root / "pipeline/forms/portal-forms.json", {"schema": 1, "forms": portal_forms})
        write_json(self.root / "pipeline/forms/portal-matches.json", {"schema": 1, "programs": {
            "exact-program": {"candidates": [
                {"formId": "ordin-1", "basis": "law_exact", "scopeBasis": "same_sigungu", "score": 86, "reason": "검토 후보"},
            ]},
            "fake-program-not-in-details": {"candidates": [
                {"formId": "ordin-1", "basis": "law_family", "scopeBasis": "same_sigungu", "score": 48, "reason": "검토 후보"},
            ]},
            "text-family": {"candidates": [
                {"formId": "ordin-2", "basis": "law_family", "scopeBasis": "same_sigungu", "score": 30, "reason": "검토 후보"},
            ]},
        }})

    def build(self):
        return queue.build_queue(self.root, batch_size=2)

    def by_id(self, built):
        return {item["formId"]: item for group in built["lawGroups"] for item in group["forms"]}

    def test_scope_ids_formats_and_pending_state_are_complete(self):
        built = self.build()
        items = self.by_id(built)
        self.assertEqual(set(items), {
            "ordin-1", "ordin-2", "ordin-3", "ordin-4", "ordin-5", "ordin-6", "ordin-7", "ordin-8", "ordin-9",
        })
        self.assertEqual(len(items), built["counts"]["items"])
        self.assertEqual(built["counts"]["formats"], {
            "bin": 1, "gif": 1, "htm": 1, "hwp": 1, "hwp3": 1, "pdf": 1, "protected_hwp": 1, "txt": 1, "zzz": 1,
        })
        reference = items["ordin-2"]
        self.assertEqual(reference["original"]["role"], "reference")
        self.assertEqual(reference["original"]["format"], "gif")
        self.assertEqual(reference["reviewState"], "pending")
        archived = items["ordin-3"]
        self.assertEqual(archived["original"]["format"], "hwp3")
        self.assertEqual(archived["sourceRef"]["textScope"], "archived")
        self.assertEqual(items["ordin-4"]["original"]["format"], "zzz")
        self.assertNotIn("role", items["ordin-4"]["original"])
        self.assertNotIn("role", items["ordin-9"]["original"])
        self.assertEqual(built["counts"]["pending"], 9)
        self.assertEqual(built["counts"]["markedApproved"], 0)
        self.assertEqual(built["counts"]["markedRejected"], 0)
        self.assertEqual(built["counts"]["markedReviewed"], 0)
        for item in items.values():
            self.assertEqual(item["reviewState"], "pending")
            self.assertIs(item["approved"], False)
            self.assertTrue(item["sourceRef"]["sha256MatchesScope"])
            self.assertNotIn("text", item["sourceRef"])
        self.assertEqual(items["ordin-1"]["sourceRef"]["sectionsRead"], ["BodyText/Section0"])
        self.assertEqual(items["ordin-1"]["sourceRef"]["textScope"], "all_body_sections_or_pages")
        self.assertEqual(archived["sourceRef"]["sectionsRead"], [])

    def test_family_candidates_stay_unapproved_and_ids_are_current(self):
        built = self.build()
        items = self.by_id(built)
        current = {
            "exact-program", "parent-program", "text-family", "rule-citer",
            "decoy-short", "decoy-decree", "junggu-program", "junggu-plain",
        }
        rule = items["ordin-1"]
        self.assertEqual(rule["exactLawProgramIds"], ["exact-program", "rule-citer"])
        self.assertEqual(
            [row["programId"] for row in rule["familySearchCandidates"]],
            ["parent-program", "text-family"],
        )
        for row in rule["familySearchCandidates"]:
            self.assertIs(row["approved"], False)
            self.assertEqual(row["disposition"], "search_candidate")
            self.assertEqual(row["relation"], "same_region_law_family")
        self.assertIsNone(rule["sameRegionExamine"])
        self.assertEqual([row["programId"] for row in rule["portalMatchCandidates"]], ["exact-program"])
        self.assertIs(rule["portalMatchCandidates"][0]["approved"], False)

        reference = items["ordin-2"]
        portal = reference["portalMatchCandidates"][0]
        self.assertEqual(portal["programId"], "text-family")
        self.assertEqual(portal["basis"], "law_family")
        self.assertIs(portal["approved"], False)
        self.assertEqual(portal["disposition"], "search_candidate")

        parent = items["ordin-3"]
        self.assertEqual(parent["exactLawProgramIds"], ["parent-program", "text-family"])
        self.assertEqual(
            [row["programId"] for row in parent["familySearchCandidates"]],
            ["exact-program", "rule-citer"],
        )
        self.assertNotIn("decoy-decree", parent["exactLawProgramIds"])
        self.assertNotIn("decoy-short", [row["programId"] for row in parent["familySearchCandidates"]])
        self.assertNotIn("junggu-program", parent["exactLawProgramIds"])

        drifted = items["ordin-9"]
        self.assertEqual(drifted["exactLawProgramIds"], ["parent-program"])
        self.assertEqual(drifted["familySearchCandidates"], [])
        self.assertNotIn("text-family", drifted["exactLawProgramIds"])

        examine = items["ordin-4"]["sameRegionExamine"]
        self.assertEqual(examine["regionCode"], "11110")
        examined = built["regionPrograms"][examine["programIdsRef"]]
        self.assertEqual(examined, [
            "decoy-decree", "decoy-short", "exact-program", "parent-program", "rule-citer", "text-family",
        ])
        self.assertEqual(built["regionPrograms"][items["ordin-5"]["sameRegionExamine"]["programIdsRef"]], [
            "junggu-plain", "junggu-program",
        ])
        self.assertEqual(built["counts"]["ignoredUnknownPortalProgramIds"], 1)
        self.assertEqual(built["counts"]["familyMarkedApproved"], 0)
        serialized = json.dumps(built, ensure_ascii=False)
        for program_id in set(queue_program_ids(built)):
            self.assertIn(program_id, current)
        self.assertNotIn("fake-program-not-in-details", serialized)
        for leak in LEAKS:
            self.assertNotIn(leak, serialized)

    def test_batches_are_deterministic_and_keep_small_laws_together(self):
        first = self.build()
        second = self.build()
        self.assertEqual(first, second)
        self.assertEqual([batch["formIds"] for batch in first["batches"]], [
            ["ordin-3", "ordin-9"],
            ["ordin-1", "ordin-2"],
            ["ordin-5"],
            ["ordin-6", "ordin-7"],
            ["ordin-8", "ordin-4"],
        ])
        self.assertEqual(first["counts"]["lawsSplit"], 1)
        output = self.root / "logs/forms-completion/review-queue.json"
        queue.write_queue(first, output, output.parent / "batches")
        again = self.root / "logs/forms-completion/review-queue-again.json"
        queue.write_queue(second, again, again.parent / "batches-again")
        self.assertEqual(output.read_text(encoding="utf-8"), again.read_text(encoding="utf-8"))
        saved = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual([batch["formIds"] for batch in saved["batches"]], [batch["formIds"] for batch in first["batches"]])
        for manifest in saved["batches"]:
            payload = json.loads((output.parent / manifest["file"]).read_text(encoding="utf-8"))
            self.assertEqual(payload["reviewState"], "pending")
            self.assertEqual([item["formId"] for item in payload["forms"]], manifest["formIds"])
            self.assertTrue(all(item["reviewState"] == "pending" and item["approved"] is False for item in payload["forms"]))
            text = json.dumps(payload, ensure_ascii=False)
            for leak in LEAKS:
                self.assertNotIn(leak, text)
        scope_hash = queue.file_record(self.root / "pipeline/forms/reviews/unmatched-originals-scope.json")[0]["sha256"]
        self.assertEqual(saved["inputs"]["pipeline/forms/reviews/unmatched-originals-scope.json"]["sha256"], scope_hash)

    def test_batch_target_splits_only_laws_over_the_target(self):
        def item(law, number):
            return {"formId": f"{law}-{number:02d}", "lawId": law}

        groups = [
            ("small", [item("small", 1)]),
            ("full", [item("full", index) for index in range(60)]),
            ("over", [item("over", index) for index in range(61)]),
            ("tail", [item("tail", index) for index in range(10)]),
        ]
        batches = queue.assign_batches(groups, 60)
        self.assertEqual([len(batch) for batch in batches], [1, 60, 60, 11])
        self.assertEqual({row["lawId"] for row in batches[1]}, {"full"})
        self.assertEqual(sum(row["lawId"] == "over" for row in batches[2]), 60)
        self.assertEqual(batches[3][0]["lawId"], "over")
        self.assertEqual({row["lawId"] for row in batches[3][1:]}, {"tail"})
        self.assertEqual(len({row["lawId"] for row in batches[0]}), 1)


def queue_program_ids(built):
    found = []
    for group in built["lawGroups"]:
        for item in group["forms"]:
            found.extend(row["programId"] for row in item["portalMatchCandidates"])
            found.extend(item["exactLawProgramIds"])
            found.extend(row["programId"] for row in item["familySearchCandidates"])
            if item["sameRegionExamine"]:
                found.extend(built["regionPrograms"][item["sameRegionExamine"]["programIdsRef"]])
    for program_ids in built["regionPrograms"].values():
        found.extend(program_ids)
    return found


if __name__ == "__main__":
    unittest.main()

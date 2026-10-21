"""Offline tests: python -B tests/official_page_audit_test.py."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("official_page_audit", ROOT / "scripts/audit-official-pages.py")
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class PageCensusTest(unittest.TestCase):
    def test_atomic_progress_write_retries_a_transient_windows_file_lock(self):
        original=Path.replace
        calls=[]
        def replace(path,target):
            calls.append(target)
            if len(calls)<3:raise PermissionError('temporary file lock')
            return original(path,target)
        target=self.cache/'progress.json'
        with patch.object(Path,'replace',replace):
            audit.atomic_json(target,{'complete':True})
        self.assertEqual(json.loads(target.read_text(encoding='utf-8')),{'complete':True})
        self.assertEqual(len(calls),3)

    def setUp(self):
        parent = ROOT / "logs/page-census/test-runs"
        parent.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.cache = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def plan(self, *records):
        return audit.prepare_plan({r["id"]: r for r in records})

    def run_plan(self, plan, fetcher, **options):
        defaults = {"workers": 1, "interval": 0, "retries": 0}
        defaults.update(options)
        return audit.run_plan(plan, self.cache, fetcher, **defaults)[0]

    def test_all_programs_and_explicit_source_fields_are_included_and_deduplicated(self):
        shared = "https://www.mohw.go.kr/board.es?bid=0085&list_no=1489590"
        plan = self.plan(
            {"id": "n.a", "url": shared, "applyUrl": "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/A1",
             "sources": [{"url": shared + "#part"}],
             "documents": "서류 https://www.goyang.go.kr/form.pdf.",
             "applyMethod": "방문 또는 https://www.gov.kr/portal/rcvfvrSvc/dtlEx/A1"},
            {"id": "g41280.b", "url": shared}, {"id": "n.no-url"})
        self.assertEqual(set(plan["programs"]), {"n.a", "g41280.b", "n.no-url"})
        self.assertEqual(plan["programs"]["n.no-url"], {"pageKeys": []})
        self.assertEqual(len(plan["jobs"]), 3)
        seen = []
        result = self.run_plan(plan, lambda p, timeout: seen.append(p["url"]) or {
            "status": "read", "url": p["url"], "attachments": [], "programSpecific": False})
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(result["summary"]["programs"], 3)
        self.assertEqual(result["summary"]["pending"], 0)

    def test_full_run_has_no_implicit_sample_cap_and_probe_resumes_remaining_jobs(self):
        plan = self.plan(*[{"id": f"n.{n}", "url": f"https://www.gov.kr/page/{n}"} for n in range(23)])
        seen = []
        fetch = lambda p, timeout: seen.append(p["url"]) or {"status": "read", "url": p["url"], "attachments": []}
        probe = self.run_plan(plan, fetch, max_jobs=3)
        self.assertEqual(probe["summary"]["read"], 3)
        self.assertEqual(probe["summary"]["pending"], 20)
        final = self.run_plan(plan, fetch)
        self.assertEqual(final["summary"]["read"], 23)
        self.assertEqual(len(seen), 23)
        self.assertEqual(final["summary"]["pending"], 0)

    def test_access_failure_is_distinct_from_success_without_attachments(self):
        plan = self.plan({"id": "n.denied", "url": "https://www.gov.kr/denied"},
                         {"id": "n.empty", "url": "https://www.gov.kr/empty"},
                         {"id": "n.failed", "url": "https://www.gov.kr/error"})
        def fetch(program, timeout):
            path = program["url"].rsplit("/", 1)[-1]
            return {"status": "blocked" if path == "denied" else "unavailable" if path == "error" else "read",
                    "errorCode": "http_403" if path == "denied" else "timeout" if path == "error" else None,
                    "url": program["url"], "attachments": []}
        result = self.run_plan(plan, fetch)
        self.assertEqual([result["summary"][k] for k in ("read", "blocked", "failed", "attachments")], [1, 1, 1, 0])
        self.assertTrue(all(p["requestAttempted"] for p in result["pages"].values()))
        self.assertNotIn("not_found", json.dumps(result))

    def test_shared_care_menu_remains_non_program_specific_with_attachment_context(self):
        url = "https://www.mohw.go.kr/board.es?bid=0085&list_no=1489590"
        plan = self.plan({"id": "g41280.icare-a", "url": url}, {"id": "g11110.icare-b", "url": url})
        result = self.run_plan(plan, lambda p, timeout: {"status": "read", "url": p["url"],
            "programSpecific": True, "attachments": [{"title": "전국 서비스 메뉴.pdf", "url": "https://www.mohw.go.kr/download/menu.pdf"}]})
        self.assertEqual(len(result["pages"]), 1)
        page = next(iter(result["pages"].values()))
        self.assertFalse(page["programSpecific"])
        self.assertFalse(page["attachments"][0]["programSpecific"])
        self.assertEqual(page["attachments"][0]["sourcePageUrl"], audit.public_url(url))
        self.assertEqual(result["programs"]["g41280.icare-a"]["pageKeys"], result["programs"]["g11110.icare-b"]["pageKeys"])

    def test_source_url_identity_not_first_catalog_id_is_passed_to_adapter(self):
        url = "https://www.bokjiro.go.kr/detail?wlfareInfoId=WLF00000001"
        plan = self.plan({"id": "n.gov24-OTHER", "url": url}, {"id": "n.bokjiro-WLF00000001", "url": url})
        seen = []
        def fetch(program, timeout):
            seen.append(program)
            return {"status": "read", "url": program["url"], "programSpecific": True, "attachments": []}
        result = self.run_plan(plan, fetch)
        self.assertEqual(len(seen), 1)
        self.assertEqual(seen[0]["id"], "n.bokjiro-WLF00000001")
        self.assertTrue(next(iter(result["pages"].values()))["programSpecific"])

    def test_credential_and_local_urls_are_never_stored_or_requested(self):
        unsafe = ["https://user:TOPSECRET@www.gov.kr/file", "https://www.gov.kr/file?serviceKey=TOPSECRET",
                  "https://www.gov.kr/file?OC=TOPSECRET", "http://127.0.0.1/a", "http://localhost/a",
                  "https://www.gov.kr/file?%2561piKey=TOPSECRET",
                  "http://10.1.2.3/a", "http://[::1]/a", "http://pc.local/a",
                  "https://www.gov.kr/file?next=http%3A%2F%2F192.168.0.1%2Fa",
                  "https://www.gov.kr/file?key=TOPSECRET"]
        plan = self.plan(*[{"id": f"n.{n}", "url": url} for n, url in enumerate(unsafe)])
        self.assertFalse(plan["jobs"])
        self.assertEqual(len(plan["programs"]), len(unsafe))
        self.assertNotIn("TOPSECRET", json.dumps(plan))
        self.assertTrue(audit.public_url("https://www.goyang.go.kr/contents.do?key=1234"))
        self.assertTrue(audit.public_url("https://www.goyang.go.kr/files/a%20b.pdf"))

    def test_returned_auth_urls_and_raw_exception_text_cannot_leak(self):
        plan = self.plan({"id": "n.a", "url": "https://www.gov.kr/page"})
        def raises(program, timeout):
            raise RuntimeError("Authorization: TOPSECRET https://user:TOPSECRET@example.com")
        result = self.run_plan(plan, raises)
        self.assertEqual(next(iter(result["pages"].values()))["errorCode"], "adapter_exception")
        self.assertNotIn("TOPSECRET", json.dumps(result))
        job = next(iter(plan["jobs"].values()))
        clean = audit.normalize_result({"status": "read", "url": job["url"],
            "title": "https://www.gov.kr/?token=TOPSECRET", "textExcerpt": 'Authorization: Bearer TOPSECRET "api_key": "TOPSECRET"',
            "attachments": [{"title": "bad", "url": "https://www.gov.kr/a?serviceKey=TOPSECRET"}]}, job)
        self.assertNotIn("TOPSECRET", json.dumps(clean))
        self.assertEqual(clean["attachments"], [])

    def test_cache_identity_and_adapter_version_must_match_before_reuse(self):
        plan = self.plan({"id": "n.a", "url": "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/A1"})
        calls = []
        fetch = lambda p, timeout: calls.append(p["url"]) or {"status": "read", "url": p["url"], "programSpecific": True}
        first = self.run_plan(plan, fetch, fingerprint="v1")
        again = self.run_plan(plan, fetch, fingerprint="v1")
        self.assertEqual(first["pages"], again["pages"])
        self.assertEqual(len(calls), 1)
        job = next(iter(plan["jobs"].values()))
        cache = audit.cache_path(self.cache, job["key"])
        wrong = json.loads(cache.read_text(encoding="utf-8"))
        wrong["sourceIdentity"]["programId"] = "OTHER"
        audit.atomic_json(cache, wrong)
        self.run_plan(plan, fetch, fingerprint="v1")
        self.assertEqual(len(calls), 2)
        wrong = json.loads(cache.read_text(encoding="utf-8"))
        wrong["result"]["url"] = "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/OTHER"
        audit.atomic_json(cache, wrong)
        self.run_plan(plan, fetch, fingerprint="v1")
        self.assertEqual(len(calls), 3)
        self.run_plan(plan, fetch, fingerprint="v2")
        self.assertEqual(len(calls), 4)

    def test_per_host_request_starts_obey_interval(self):
        elapsed = [0.0]
        def advance(seconds):
            elapsed[0] += seconds
        gate = audit.HostGate(interval=0.3)
        with patch.object(audit.time, "monotonic", side_effect=lambda: elapsed[0]), patch.object(audit.time, "sleep", side_effect=advance):
            self.assertIsNone(gate.before("www.gov.kr"))
            self.assertIsNone(gate.before("www.gov.kr"))
            self.assertGreaterEqual(elapsed[0], 0.3)
            before_other = elapsed[0]
            self.assertIsNone(gate.before("www.bokjiro.go.kr"))
            self.assertEqual(elapsed[0], before_other)

    def test_explicit_compatible_hash_reuses_only_successful_reads(self):
        plan=self.plan({'id':'n.a','url':'https://www.gov.kr/read'},
                       {'id':'n.b','url':'https://www.gov.kr/unsupported'})
        calls=[]
        def fetch(program,timeout):
            calls.append(program['url'])
            return {'status':'read' if program['url'].endswith('/read') else 'unsupported','url':program['url'],'attachments':[]}
        self.run_plan(plan,fetch,fingerprint='old')
        self.run_plan(plan,fetch,fingerprint='new',reuse_read_fingerprints=['old'])
        self.assertEqual(calls.count('https://www.gov.kr/read'),1)
        self.assertEqual(calls.count('https://www.gov.kr/unsupported'),2)
        self.run_plan(plan,fetch,fingerprint='newer')
        self.assertEqual(calls.count('https://www.gov.kr/read'),2)

    def test_circuit_breaker_marks_unsent_jobs_without_faking_reads(self):
        plan = self.plan(*[{"id": f"n.{n}", "url": f"https://www.gov.kr/page/{n}"} for n in range(5)])
        calls = []
        result = self.run_plan(plan, lambda p, timeout: calls.append(p["url"]) or {
            "status": "blocked", "url": p["url"], "errorCode": "http_403"}, block_threshold=2)
        self.assertEqual(len(calls), 2)
        self.assertEqual(result["summary"]["blocked"], 5)
        skipped = [p for p in result["pages"].values() if not p["requestAttempted"]]
        self.assertEqual(len(skipped), 3)
        self.assertTrue(all(p["errorCode"] == "blocked_by_host" for p in skipped))

    def test_long_retry_after_defers_host_and_explicit_retry_can_recover(self):
        plan = self.plan(*[{"id": f"n.{n}", "url": f"https://www.gov.kr/page/{n}"} for n in range(3)])
        calls = []
        result = self.run_plan(plan, lambda p, timeout: calls.append(p["url"]) or {
            "status": "blocked", "url": p["url"], "errorCode": "http_429", "retryAfterSeconds": 3600}, retries=1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(result["summary"]["attempted"], 1)
        self.assertEqual(sum(p.get("errorCode") == "blocked_by_retry_after" for p in result["pages"].values()), 2)
        unchanged = self.run_plan(plan, lambda *a, **kw: self.fail("resume must respect Retry-After"), retry_failed=True)
        self.assertEqual(unchanged["summary"]["blocked"], 3)
        future = audit.time.time() + 3601
        with patch.object(audit.time, "time", return_value=future):
            restored = self.run_plan(plan, lambda p, timeout: {"status": "read", "url": p["url"]}, retry_failed=True)
        self.assertEqual(restored["summary"]["read"], 3)

    def test_retry_is_bounded_and_non_supported_hosts_are_not_attempted(self):
        plan = self.plan({"id": "n.a", "url": "https://www.gov.kr/page"})
        calls = []
        with patch.object(audit.time, "sleep"):
            result = self.run_plan(plan, lambda p, timeout: calls.append(1) or {
                "status": "unavailable", "url": p["url"], "errorCode": "timeout"}, retries=2)
        self.assertEqual(len(calls), 3)
        self.assertEqual(next(iter(result["pages"].values()))["attempts"], 3)
        other = self.plan({"id": "n.b", "url": "https://www.nhis.or.kr/page"})
        result = self.run_plan(other, lambda *args, **kwargs: self.fail("must not request"), supported=lambda url: False)
        self.assertFalse(next(iter(result["pages"].values()))["requestAttempted"])

    def test_prepare_only_never_loads_adapter_or_writes_public_audit(self):
        details = self.cache / "public/bundles/v1/details"
        details.mkdir(parents=True)
        (details / "00.json").write_text(json.dumps({"n.a": {"id": "n.a"}, "n.b": {"id": "n.b", "url": "https://www.gov.kr/page"}}), encoding="utf-8")
        with patch.object(audit.importlib, "import_module", side_effect=AssertionError("no network adapter")):
            self.assertEqual(audit.main(["--root", str(self.cache), "--prepare-only"]), 0)
        self.assertTrue((self.cache / "logs/page-census/jobs.json").exists())
        self.assertFalse((self.cache / "pipeline/forms/official-page-audit.json").exists())


if __name__ == "__main__":
    unittest.main()

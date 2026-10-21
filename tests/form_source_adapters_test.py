"""Source identity, attachment provenance, and credential isolation boundaries."""

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.form_source_adapters import fetch_program_source, public_url, source_cache_key, source_identity


BOKJIRO = "https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00004832&wlfareInfoReldBztpCd=02"
GOV24 = "https://www.gov.kr/portal/rcvfvrSvc/dtlEx/318000000119"


class Response:
    def __init__(self, html="", status=200, headers=None):
        self.status_code = status
        self.headers = {"Content-Type": "text/html;charset=UTF-8", **(headers or {})}
        self.body = html.encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def iter_content(self, size):
        yield self.body


def bokjiro_html(rows, identity="WLF00004832", info_extra=None):
    info = {"wlfareInfoId": identity, "wlfareInfoNm": "입학준비금", "wlfareSprtBnftCn": "<p>입학생 지원</p>", **(info_extra or {})}
    init = {"initValue": {"dmWlfareInfo": json.dumps(info, ensure_ascii=False), "dsWlfareInfoDtl": json.dumps(rows, ensure_ascii=False)}}
    return '<html><meta charset="utf-8"><title>복지로</title><script>cpr.core.Platform.INSTANCE.initParameter(' + json.dumps(init, ensure_ascii=False) + ');</script></html>'


def attachment(**overrides):
    return {"wlfareInfoId": "WLF00004832", "wlfareInfoDtlCd": "040", "atcflId": "20260619UUWBM1608160197825539", "atcflSn": 1, "oriFileNm": "입학준비금 신청서.hwp", **overrides}


class BokjiroTest(unittest.TestCase):
    @patch("scripts.form_source_adapters.requests.get")
    def test_same_program_attachment_ids_only_and_no_approval(self, get):
        rows = [attachment(), attachment(), attachment(wlfareInfoId="WLF99999999"),
                attachment(wlfareInfoDtlCd="030"), attachment(atcflId="", oriFileNm="이름만 있는 신청서.hwp"),
                attachment(atcflId="guidance123", oriFileNm="사업안내.pdf")]
        get.return_value = Response(bokjiro_html(rows, info_extra={"frstCrtUsrIpadr": "10.0.0.1", "secret": "not-returned"}))
        result = fetch_program_source({"id": "g11110.bokjiro-WLF00004832", "url": BOKJIRO})
        self.assertEqual(result["status"], "read")
        self.assertTrue(result["programSpecific"])
        self.assertEqual(result["title"], "입학준비금")
        self.assertEqual(len(result["attachments"]), 2)
        self.assertEqual(result["errorCode"], "attachment_metadata_incomplete")
        self.assertIn("getDownload.do?atcflId=20260619UUWBM1608160197825539&atcflSn=1&wlfareInfoId=WLF00004832", result["attachments"][0]["url"])
        self.assertNotIn("not-returned", json.dumps(result))
        self.assertNotIn("10.0.0.1", json.dumps(result))
        self.assertNotIn("verified", result)
        self.assertFalse(get.call_args.kwargs["allow_redirects"])

    @patch("scripts.form_source_adapters.requests.get")
    def test_wrong_response_program_is_rejected(self, get):
        get.return_value = Response(bokjiro_html([attachment()], identity="WLF99999999"))
        result = fetch_program_source({"url": BOKJIRO})
        self.assertEqual(result["errorCode"], "source_id_mismatch")
        self.assertEqual(result["attachments"], [])

    @patch("scripts.form_source_adapters.requests.get")
    def test_catalog_id_cannot_silently_switch(self, get):
        get.return_value = Response(bokjiro_html([attachment()]))
        result = fetch_program_source({"id": "g11110.bokjiro-WLF00002778", "url": BOKJIRO})
        self.assertEqual(result["errorCode"], "source_id_mismatch")

    @patch("scripts.form_source_adapters.requests.get")
    def test_missing_metadata_is_not_no_attachments(self, get):
        get.return_value = Response('<html><title>복지로</title><script>startApp()</script></html>')
        result = fetch_program_source({"url": BOKJIRO})
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["errorCode"], "bokjiro_public_metadata_missing")

    @patch("scripts.form_source_adapters.requests.get")
    def test_null_attachment_list_is_read(self, get):
        get.return_value = Response(bokjiro_html(None))
        self.assertEqual(fetch_program_source({"url": BOKJIRO})["status"], "read")


class HtmlTest(unittest.TestCase):
    @patch("scripts.form_source_adapters.requests.get")
    def test_gov24_ignores_navigation_pdf(self, get):
        get.return_value = Response('<html><meta charset="utf-8"><nav><a href="/guide.pdf">안내</a></nav><div id="isRejectPage" style="display:none"><h3>서비스 접속이 차단 되었습니다.</h3></div><input id="svcId" value="318000000119"><div class="gov-subsidy"><h2 class="service-title">장애인 수리</h2><div class="detail-wrap"><a href="/files/application.hwp">신청서.hwp</a></div></div></html>')
        result = fetch_program_source({"id": "g11560.gov24-318000000119", "url": GOV24})
        self.assertEqual(result["status"], "read")
        self.assertTrue(result["programSpecific"])
        self.assertEqual(result["title"], "장애인 수리")
        self.assertEqual([x["url"] for x in result["attachments"]], ["https://www.gov.kr/files/application.hwp"])

    @patch("scripts.form_source_adapters.requests.get")
    def test_gov24_missing_identity_is_not_success(self, get):
        get.return_value = Response('<html><div class="gov-subsidy">공통 페이지</div></html>')
        self.assertEqual(fetch_program_source({"url": GOV24})["status"], "unavailable")

    @patch("scripts.form_source_adapters.requests.get")
    def test_municipal_links_literal_js_and_unsafe_links(self, get):
        get.return_value = Response('''<html><meta charset="utf-8"><title>지원 사업</title><header><a href="/guide.pdf">안내</a></header><article id="content">
        <a href="/component/resrce/file/ND_resrceFileDownload.do?resrceSn=868&amp;fileSn=1">신청서 다운로드</a>
        <button onclick="window.open('/files/consent.pdf')">동의서 다운로드</button>
        <a href="https://127.0.0.1/private.hwp">비공개.hwp</a>
        <a href="/files/a.pdf?token=do-not-output">서류.pdf</a>
        <button onclick="unknownDownload('123')">첨부파일 다운로드</button>
        </article></html>''')
        result = fetch_program_source({"url": "https://www.goyang.go.kr/page"})
        self.assertEqual(len(result["attachments"]), 2)
        self.assertFalse(result["programSpecific"])
        self.assertEqual(result["errorCode"], "unsupported_attachment_control")
        self.assertNotIn("do-not-output", json.dumps(result))


class BoundaryTest(unittest.TestCase):
    def test_reviewed_institution_hosts_are_exact_not_wildcards(self):
        with patch('scripts.form_source_adapters._PUBLIC_INSTITUTION_HOSTS',frozenset({'agency.or.kr'})):
            self.assertEqual(public_url('https://agency.or.kr/guide'),'https://agency.or.kr/guide')
            self.assertIsNone(public_url('https://other.agency.or.kr/guide'))
            self.assertIsNone(public_url('https://agency.or.kr/guide?token=secret'))
            self.assertIsNone(public_url('https://unknown.or.kr/guide'))
    def test_unsafe_and_credential_urls_are_removed(self):
        for url in ["https://localhost/test", "http://127.0.0.1/a.pdf", "https://u:p@www.gov.kr/a", "https://www.gov.kr/a?serviceKey=secret", "https://www.gov.kr/a?redirect=http://192.168.0.1/a", "https://www.gov.kr/a;jsessionid=private", "file:///C:/secret", "https://www.gov.kr.evil.example/a", "https://www.gov.kr/a?access_token=secret", "https://www.law.go.kr/DRF/lawService.do?OC=private", "https://www.gov.kr/a?key=api-secret"]:
            with self.subTest(url=url):
                self.assertIsNone(public_url(url))
        self.assertEqual(public_url("https://www.gov.kr/a#part"), "https://www.gov.kr/a")
        self.assertEqual(public_url("/files/form name.hwp", "https://www.goyang.go.kr/page"), "https://www.goyang.go.kr/files/form%20name.hwp")

    def test_numeric_cms_key_and_stable_cache_identity(self):
        url = "https://www.jongno.go.kr/page.do?key=1234&bbsNo=15"
        self.assertEqual(public_url(url), url)
        self.assertEqual(source_cache_key(url), source_cache_key("https://www.jongno.go.kr/page.do?bbsNo=15&key=1234#top"))
        self.assertEqual(source_identity(BOKJIRO), {"provider": "bokjiro", "programId": "WLF00004832", "kind": "program"})
        self.assertEqual(source_identity("https://www.bokjiro.go.kr/ssis-tbu/twata/CmmFileUtil/getDownload.do?wlfareInfoId=WLF00004832&atcflId=abc&atcflSn=1")["kind"], "attachment")
        self.assertIsNone(source_identity(url))

    @patch("scripts.form_source_adapters.requests.get")
    def test_shared_guide_is_not_program_specific(self, get):
        get.return_value = Response('<html><meta charset="utf-8"><body><main>공통 복지서비스 메뉴판<a href="/files/menu.pdf">메뉴판.pdf</a></main></body></html>')
        result = fetch_program_source({"id": "g11110.icare-shared", "url": "https://www.mohw.go.kr/board.es?mid=a10411010100&bid=0019"})
        self.assertEqual(result["status"], "read")
        self.assertFalse(result["programSpecific"])
        self.assertEqual(len(result["attachments"]), 1)

    @patch("scripts.form_source_adapters.requests.get")
    def test_bad_url_never_requested(self, get):
        result = fetch_program_source({"url": "https://www.gov.kr/a?serviceKey=secret"})
        self.assertEqual(result["status"], "unsupported")
        self.assertEqual(result["url"], "")
        get.assert_not_called()

    @patch("scripts.form_source_adapters.requests.get")
    def test_login_redirect_and_http_block_are_recorded(self, get):
        get.return_value = Response(status=302, headers={"Location": "/login?token=private"})
        self.assertEqual(fetch_program_source({"url": GOV24})["status"], "blocked")
        self.assertEqual(get.call_count, 1)
        get.return_value = Response(status=403)
        self.assertEqual(fetch_program_source({"url": GOV24})["errorCode"], "http_403")

    @patch("scripts.form_source_adapters.requests.get")
    def test_timeout_does_not_leak_exception(self, get):
        get.side_effect = requests.Timeout("URL contains secret=not-for-log")
        result = fetch_program_source({"url": GOV24}, timeout=3)
        self.assertEqual(result["errorCode"], "timeout")
        self.assertNotIn("secret", json.dumps(result))
        self.assertEqual(get.call_args.kwargs["timeout"], 3)

    @patch("scripts.form_source_adapters.requests.get")
    def test_real_challenge_not_library_name_is_blocked(self, get):
        get.return_value = Response('<html><meta charset="utf-8"><body>접근이 차단되었습니다</body></html>')
        self.assertEqual(fetch_program_source({"url": GOV24})["status"], "blocked")

    @patch("scripts.form_source_adapters.requests.get")
    def test_retry_after_is_numeric_bounded_metadata_only(self, get):
        get.return_value = Response(status=429, headers={"Retry-After": "120"})
        result = fetch_program_source({"url": GOV24})
        self.assertEqual(result["retryAfterSeconds"], 120)
        get.return_value = Response(status=503, headers={"Retry-After": "9999999"})
        self.assertEqual(fetch_program_source({"url": GOV24})["retryAfterSeconds"], 86400)
        get.return_value = Response(status=429, headers={"Retry-After": "secret=value"})
        self.assertNotIn("retryAfterSeconds", fetch_program_source({"url": GOV24}))


if __name__ == "__main__":
    unittest.main()

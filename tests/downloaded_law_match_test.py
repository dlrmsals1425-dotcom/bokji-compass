"""Actual original-byte, statute-binding and citizen-purpose boundaries."""
import copy
import hashlib
import importlib.util
import io
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("downloaded_law_match", ROOT / "scripts/match-downloaded-law-forms.py")
match = importlib.util.module_from_spec(spec); spec.loader.exec_module(match)

PID = "g41110.test-longevity"
LAW = "수원시 장수축하금 지급 조례"
KEY = "41110|수원시장수축하금지급조례"
URL = "https://www.law.go.kr/LSW/flDownload.do?gubun=ELIS&flSeq=4321"
CLAUSE = "제6조(지급신청) ① 장수축하금을 지급받고자 하는 사람은 별지 제1호서식의 신청서를 주소지 동장에게 제출하여야 한다."
BODY = """[별지 제1호서식] <개정 2020. 2. 3.>
장수축하금 지급 신청서
지급대상자
성명
생년월일
주소
지급계좌
예금주
계좌번호
「수원시 장수축하금 지급 조례」 제6조에 따라 장수축하금을 신청합니다.
년 월 일
신청인 (서명 또는 인)
수원시장 귀하
"""


def hwpx(*sections):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("mimetype", "application/hwp+zip")
        for index, text in enumerate(sections):
            archive.writestr(f"Contents/section{index}.xml", '<section xmlns="urn:hancom:test">' + "".join(f"<p><t>{escape(line)}</t></p>" for line in text.splitlines()) + "</section>")
    return stream.getvalue()


def fixture(body=BODY, title="[별지 제1호서식] 장수축하금 지급 신청서", clause=CLAUSE):
    program = {"id": PID, "name": "장수축하금 지원", "scope": "sigungu", "orgType": "local", "region": {"sido": "41000", "sigungu": "41110", "label": "경기 수원시"}, "laws": [LAW], "applyType": "self"}
    form = {"id": "ordin-123", "sourceKind": "ordin", "annexId": "123", "annexNumber": "000100", "lawId": "456", "lawTitle": LAW,
            "title": title, "role": "application", "regionCode": "41110", "regionLabel": "경기도 수원시", "sourceUrl": URL,
            "effectiveDate": "20260101", "dateKind": "effective"}
    law = {"id": "456", "kind": "ordin", "state": "read", "title": LAW, "query": LAW,
           "applicationArticles": [{"number": "제600조", "text": clause}],
           "annexes": [{"id": "123", "number": "100", "title": title, "url": URL}]}
    audit = {"laws": {KEY: law}, "programs": {PID: {"lawKeys": [KEY]}}}
    data = hwpx(body)
    record = {"state": "stored", "formId": form["id"], "lawId": form["lawId"], "lawTitle": form["lawTitle"], "title": title,
              "regionCode": form["regionCode"], "sourceUrl": URL, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "localPath": "fixture.hwpx",
              **match._reader.inspect_document(data)}
    return program, form, audit, record, data


def evaluate(parts, **kwargs):
    p, f, a, d, blob = parts
    return match.evaluate_association(p, f, a, d, original_bytes=blob, **kwargs)


def reset_identity(parts, *, law=LAW, region_code="41110", region_label="경기도 수원시"):
    p, f, a, d, blob = parts
    p["laws"] = [law]
    f.update(lawTitle=law, regionCode=region_code, regionLabel=region_label)
    d.update(lawTitle=law, regionCode=region_code)
    a["laws"][KEY].update(title=law, query=law)


class OriginalFileTest(unittest.TestCase):
    def test_actual_hwpx_is_reparsed_and_only_proposed(self):
        parts = fixture(); before = copy.deepcopy(parts[:-1]); result = evaluate(parts)
        self.assertEqual(result["decision"], "propose", result)
        self.assertTrue(result["possible"])
        self.assertEqual(result["proposal"]["verificationStatus"], "proposed")
        self.assertEqual(result["proposal"]["proposalStatus"], "requires_cross_review")
        self.assertEqual(result["proposal"]["sha256"], hashlib.sha256(parts[-1]).hexdigest())
        self.assertEqual(result["evidence"]["article"]["number"], "제6조")
        self.assertEqual(parts[:-1], before)

    def test_stored_record_without_real_bytes_is_not_enough(self):
        p, f, a, d, _ = fixture()
        result = match.evaluate_association(p, f, a, d)
        self.assertEqual(result["reasonCodes"], ["original_bytes_missing"])
        self.assertIsNone(result["proposal"])

    def test_changed_file_hash_and_html_disguised_as_original_are_rejected(self):
        parts = list(fixture()); parts[-1] += b"changed"
        self.assertIn("original_hash_mismatch", evaluate(parts)["reasonCodes"])
        parts = list(fixture()); parts[-1] = b"<html>Access denied</html>"
        parts[3].update(bytes=len(parts[-1]), sha256=hashlib.sha256(parts[-1]).hexdigest())
        self.assertIn("invalid_original", evaluate(parts)["reasonCodes"])

    def test_preview_only_or_partial_section_record_is_not_full_body(self):
        for alteration in [lambda d: d.update(textScope="PrvText"), lambda d: d.update(sectionsRead=[]), lambda d: d.update(text=d["text"][:60])]:
            with self.subTest(alteration=alteration):
                parts = fixture(); alteration(parts[3])
                self.assertIn("original_body_mismatch", evaluate(parts)["reasonCodes"])

    def test_extra_body_section_cannot_hide_an_unread_document(self):
        parts = list(fixture()); blob = hwpx(BODY, "기관용 정산서\n사업자명\n대표자")
        parts[-1] = blob; parts[3].update(bytes=len(blob), sha256=hashlib.sha256(blob).hexdigest())
        self.assertIn("original_body_mismatch", evaluate(parts)["reasonCodes"])

    def test_flseq_must_match_record_and_current_law_attachment(self):
        parts = fixture(); parts[3]["sourceUrl"] = URL.replace("4321", "9876")
        self.assertIn("download_url_mismatch", evaluate(parts)["reasonCodes"])
        parts = fixture(); parts[2]["laws"][KEY]["annexes"][0]["url"] = URL.replace("4321", "9876")
        self.assertIn("official_annex_conflict", evaluate(parts)["reasonCodes"])

    def test_credentials_and_non_law_download_hosts_fail(self):
        for bad in [URL + "&OC=test-only-secret", "https://example.go.kr/flDownload.do?flSeq=4321", URL + "&flSeq=9876"]:
            with self.subTest(url=bad):
                parts = fixture(); parts[1]["sourceUrl"] = parts[3]["sourceUrl"] = bad
                self.assertIn("download_url_mismatch", evaluate(parts)["reasonCodes"])


class ScopeAndLawTest(unittest.TestCase):
    def test_same_named_benefit_other_city_is_not_eligible(self):
        parts = fixture(); parts[0]["region"]["sigungu"] = "41280"; parts[0]["region"]["label"] = "경기 고양시"
        self.assertIn("jurisdiction_mismatch", evaluate(parts)["reasonCodes"])

    def test_legacy_renamed_city_is_not_inferred_from_code(self):
        parts = fixture(); reset_identity(parts, law="인천광역시 동구 장수축하금 지급 조례", region_code="28125", region_label="인천광역시 제물포구")
        parts[0]["region"] = {"sido": "28000", "sigungu": "28125", "label": "인천 제물포구"}
        self.assertIn("legacy_name_or_region_mismatch", evaluate(parts)["reasonCodes"])

    def test_ambiguous_gu_requires_full_province_in_law_title(self):
        parts = fixture(); reset_identity(parts, law="중구 장수축하금 조례", region_code="11140", region_label="서울특별시 중구")
        parts[0]["region"] = {"sido": "11000", "sigungu": "11140", "label": "서울 중구"}
        self.assertIn("legacy_name_or_region_mismatch", evaluate(parts)["reasonCodes"])

    def test_explicitly_cited_provincial_law_can_cover_constituent_city(self):
        parts = fixture(); reset_identity(parts, law="경기도 장수축하금 지급 조례", region_code="41000", region_label="경기도")
        result = evaluate(parts)
        self.assertEqual(result["decision"], "propose", result)
        self.assertEqual(result["proposal"]["scopeBasis"], "provincial-law-reference")

    def test_education_office_scope_is_separate(self):
        parts = fixture(body=BODY.replace("수원시장 귀하", "경기도교육감 귀하")); reset_identity(parts, law="경기도교육청 장수축하금 지급 조례", region_code="41000", region_label="경기도")
        self.assertIn("education_authority_mismatch", evaluate(parts)["reasonCodes"])
        parts[0].update(orgType="edu_office", scope="sido")
        self.assertEqual(evaluate(parts)["decision"], "propose")

    def test_only_the_actual_cited_and_read_law_id_qualifies(self):
        for change in [lambda a: a["programs"][PID].update(lawKeys=[]), lambda a: a["laws"][KEY].update(state="failed"), lambda a: a["laws"][KEY].update(id="999"), lambda a: a["laws"][KEY].update(kind="law")]:
            parts = fixture(); change(parts[2])
            self.assertIn("cited_law_not_read", evaluate(parts)["reasonCodes"])
        parts = fixture(); parts[0]["laws"] = ["수원시 다른 장려금 조례"]
        self.assertIn("citation_title_mismatch", evaluate(parts)["reasonCodes"])

    def test_inferred_implementation_rule_is_not_an_actual_citation(self):
        parts = fixture(); rule = LAW + " 시행규칙"
        parts[1]["lawTitle"] = parts[3]["lawTitle"] = parts[2]["laws"][KEY]["title"] = rule
        self.assertIn("citation_title_mismatch", evaluate(parts)["reasonCodes"])


class AnnexAndClauseTest(unittest.TestCase):
    def test_numeric_annex_metadata_is_not_trusted(self):
        parts = fixture(); parts[1]["annexNumber"] = "000900"; parts[2]["laws"][KEY]["annexes"][0]["number"] = "900"
        result = evaluate(parts)
        self.assertEqual(result["decision"], "propose", result)
        self.assertEqual(result["evidence"]["annexDesignation"], "1")

    def test_body_number_conflicting_with_official_title_is_rejected(self):
        parts = fixture(body=BODY.replace("제1호", "제2호"))
        self.assertIn("wrong_annex_designation", evaluate(parts)["reasonCodes"])

    def test_different_citizen_annex_is_not_substituted(self):
        parts = fixture(clause=CLAUSE.replace("제1호", "제2호"))
        self.assertIn("application_clause_missing", evaluate(parts)["reasonCodes"])

    def test_wrong_annex_id_cannot_be_replaced_by_matching_flseq(self):
        parts = fixture(); parts[2]["laws"][KEY]["annexes"][0]["id"] = "999"
        self.assertIn("official_annex_not_bound", evaluate(parts)["reasonCodes"])

    def test_admin_clause_does_not_become_citizen_clause_when_resident_is_mentioned(self):
        clauses = ["제6조(청구) 수리업체는 장애인 지원대상자의 자료를 확인하고 별지 제1호서식의 신청서를 시장에게 제출하여야 한다.",
                   "제6조(청구) 학교장은 신청인의 자격을 검토하고 별지 제1호서식의 신청서를 제출하여야 한다."]
        for clause in clauses:
            result = evaluate(fixture(clause=clause))
            self.assertIn("institution_application_clause", result["reasonCodes"])

    def test_dental_provider_participation_is_not_a_child_application(self):
        body = "[별지 제1호서식]\n아동 치과주치의 참여 신청서\n의료기관명\n요양기관번호\n성명\n신청인 (의료기관) (서명)"
        parts = fixture(body=body, title="[별지 제1호서식] 아동 치과주치의 참여 신청서", clause="제6조(참여신청) 참여를 희망하는 의료기관은 별지 제1호서식의 신청서를 제출해야 한다.")
        parts[0]["name"] = "아동 치과주치의 지원"
        self.assertFalse(evaluate(parts)["possible"])

    def test_truncated_clause_needs_full_cache_but_complete_previous_paragraph_can_pass(self):
        parts = fixture(clause=CLAUSE[:-1] + "…")
        self.assertIn("truncated_application_clause", evaluate(parts)["reasonCodes"])
        parts = fixture(clause=CLAUSE + "② 동장은 다음의 관련 내용을…")
        self.assertEqual(evaluate(parts)["decision"], "propose")

    def test_full_cache_recovers_unnumbered_annex_without_index_only_inference(self):
        body = BODY.replace("[별지 제1호서식]", "[별지 서식]")
        parts = fixture(body=body, title="별지", clause="")
        clause = CLAUSE.replace("별지 제1호서식", "별지 서식")
        cache = {"record": copy.deepcopy(parts[2]["laws"][KEY]), "raw": [{"payload": {"LawService": {
            "자치법규기본정보": {"자치법규일련번호": "456", "자치법규명": LAW},
            "조문": {"조": [{"조문번호": ["000600"], "조내용": clause}]},
            "별표": {"별표단위": {"별표키": "123", "별표제목": "별지", "별표첨부파일명": URL}},
        }}}]}
        result = evaluate(parts, law_cache=cache)
        self.assertEqual(result["decision"], "propose", result)
        self.assertEqual(result["evidence"]["lawMaterial"], "full-LawService")
        cache["raw"][0]["payload"]["LawService"]["자치법규기본정보"]["자치법규일련번호"] = "999"
        self.assertIn("law_cache_identity_mismatch", evaluate(parts, law_cache=cache)["reasonCodes"])

    def test_multiple_independent_annexes_are_not_automatically_selected(self):
        result = evaluate(fixture(body=BODY + "\n[별지 제2호서식]\n장학금 신청서\n성명\n신청인 (서명)"))
        self.assertIn("multiple_forms_in_original", result["reasonCodes"])

    def test_two_distinct_application_titles_without_two_annex_labels_are_deferred(self):
        result = evaluate(fixture(body=BODY + "\n효도수당 지급 신청서\n성명\n신청인 (서명)"))
        self.assertIn("multiple_forms_in_original", result["reasonCodes"])

    def test_clause_may_say_annex_form_without_repeating_application_word(self):
        result = evaluate(fixture(clause="제6조(지원신청) 지급대상자는 별지 제1호서식에 따라 동장에게 신청하여야 한다."))
        self.assertEqual(result["decision"], "propose", result)


class CitizenPurposeTest(unittest.TestCase):
    def test_broad_shared_law_does_not_bind_another_benefit(self):
        parts = fixture(); parts[0]["name"] = "효도수당 지원"; parts[0]["benefit"] = "효도수당 월 지급"
        self.assertFalse(evaluate(parts)["possible"])

    def test_distinct_financial_benefit_and_disability_qualifiers_are_preserved(self):
        for name in ["장수수당 지원", "장애인 장수축하금 지원"]:
            parts = fixture(); parts[0]["name"] = name
            self.assertIn("purpose_qualifier_mismatch", evaluate(parts)["reasonCodes"])

    def test_repair_title_and_explicit_device_fields_can_match(self):
        text = "[별지 제1호서식]\n장애인 보장구 수리 신청서\n성명\n주소\n보장구 유형 □ 휠체어 □ 전동휠체어 □ 전동스쿠터\n위와 같이 수리를 신청합니다.\n신청인 (서명 또는 인)"
        parts = fixture(body=text, title="[별지 제1호서식] 장애인 보장구 수리 신청서", clause="제6조(지원절차) 장애인이 별지 제1호서식의 신청서를 동장에게 제출하면 수리비용을 지원한다.")
        parts[0]["name"] = "장애인휠체어 등 수리비 지원"
        self.assertEqual(evaluate(parts)["decision"], "propose")

    def test_integrated_form_requires_the_local_support_item(self):
        text = "[별지 제1호서식]\n출산서비스 통합처리 신청서\n신청인\n성명\n주소\n수원시 자체 서비스\n출산장려금\n전국 공통 서비스\n아동수당\n위와 같이 신청합니다.\n신청인 (서명 또는 인)"
        parts = fixture(body=text, title="[별지 제1호서식] 출산서비스 통합처리 신청서", clause="제5조(신청) 출산장려금을 지원받으려는 보호자는 별지 제1호서식의 출산서비스 통합처리 신청서를 제출해야 한다.")
        parts[0]["name"] = "출산장려금 지원"
        self.assertEqual(evaluate(parts)["decision"], "propose")
        parts[0]["name"] = "아동수당 지원"
        self.assertFalse(evaluate(parts)["possible"])

    def test_first_child_is_not_covered_by_only_second_third_child_choices(self):
        text = "[별지 제1호서식]\n출산서비스 통합처리 신청서\n성명\n수원시 자체 서비스\n출산장려금 □둘째아 □셋째아 □넷째아\n전국 공통 서비스\n위와 같이 신청합니다.\n신청인 (서명)"
        parts = fixture(body=text, title="[별지 제1호서식] 출산서비스 통합처리 신청서", clause="제5조(신청) 지원받으려는 보호자는 별지 제1호서식의 신청서를 제출해야 한다.")
        parts[0]["name"] = "첫아이 출산장려금 꿈드림 지원"
        parts[0]["aliases"] = ["출산장려금 지원"]
        self.assertFalse(evaluate(parts)["possible"])

    def test_provider_payment_and_medical_institution_field_do_not_block_citizens(self):
        for purpose, actor in [("유품정리", "유족"), ("수술비", "지원대상자")]:
            body = f"[별지 제1호서식]\n{purpose} 지원 신청서\n성명\n생년월일\n주소\n신청인\n의료기관명\n서비스 제공기관\n위와 같이 신청합니다.\n신청인 (서명)\n비용은 용역기관에 지급합니다."
            parts = fixture(body=body, title=f"[별지 제1호서식] {purpose} 지원 신청서", clause=f"제6조(신청) {actor}는 별지 제1호서식의 신청서를 제출하여야 한다. 비용은 용역기관에 지급한다.")
            parts[0]["name"] = purpose + " 지원"
            result = evaluate(parts)
            self.assertNotIn("forbidden_form_role", result["reasonCodes"])
            self.assertNotIn("institution_application_clause", result["reasonCodes"])
            self.assertTrue(result["possible"], result)

    def test_institution_changes_litigation_and_deleted_forms_are_not_main_applications(self):
        for label in ["가맹점 지정 신청서", "수리업체 지정 신청서", "보조금 교부 신청서", "장수축하금 변경 신청서", "지급명령 신청서", "<삭제> 장수축하금 신청서"]:
            with self.subTest(title=label):
                parts = fixture(title="[별지 제1호서식] " + label, body=BODY.replace("장수축하금 지급 신청서", label))
                result = evaluate(parts)
                self.assertFalse(result["possible"])
                self.assertIsNone(result["proposal"])

    def test_old_annual_form_fails_but_old_amendment_note_is_not_expiration(self):
        self.assertEqual(evaluate(fixture())["decision"], "propose")
        result = evaluate(fixture(body=BODY.replace("장수축하금 지급 신청서", "2025년도 장수축하금 지급 신청서")))
        self.assertIn("outdated_annual_form", result["reasonCodes"])

    def test_filled_identity_is_rejected_without_echoing_private_values(self):
        for field in ["주민등록번호 900101-1234567", "계좌번호: 123-456789-01", "신청인 홍길동 (서명 또는 인)", "성명\n홍길동\n생년월일", "휴대전화: 010-1234-5678"]:
            with self.subTest(field=field):
                parts = fixture(body=BODY + "\n" + field)
                result = evaluate(parts)
                self.assertIn("filled_personal_data", result["reasonCodes"])
                self.assertNotIn(field, str(result))

    def test_empty_student_and_required_document_column_labels_are_not_person_names(self):
        result = evaluate(fixture(body=BODY + "\n성명\n학생\n신청인\n제출서류\n신청서 1부"))
        self.assertEqual(result["decision"], "propose", result)

    def test_original_recipient_cannot_be_another_city_despite_matching_metadata(self):
        result = evaluate(fixture(body=BODY.replace("수원시장 귀하", "고양시장 귀하")))
        self.assertIn("original_jurisdiction_mismatch", result["reasonCodes"])

    def test_combined_birth_and_childcare_heading_preserves_all_specific_words(self):
        body = BODY.replace("장수축하금 지급 신청서", "장애인가정 출산 및 영아 양육 지원금 신청서").replace("장수축하금", "장애인가정 출산 및 양육지원금")
        parts = fixture(body=body, title="[별지 제1호서식] 장애인가정 출산 및 영아 양육 지원금 신청서")
        parts[0]["name"] = "장애인가정 출산 및 양육 지원금 지원"
        self.assertEqual(evaluate(parts)["decision"], "propose")

    def test_future_law_missing_signature_and_automatic_program_are_deferred(self):
        parts = fixture(); parts[1]["effectiveDate"] = "20270101"
        self.assertIn("future_effective_form", evaluate(parts)["reasonCodes"])
        parts = fixture(body=BODY.replace("신청인 (서명 또는 인)", ""))
        self.assertIn("applicant_fields_missing", evaluate(parts)["reasonCodes"])
        parts = fixture(); parts[0]["applyType"] = "auto"
        self.assertIn("non_citizen_program", evaluate(parts)["reasonCodes"])


class FullEvaluationTest(unittest.TestCase):
    def test_all_programs_get_results_and_audit_bound_form_can_recover_search_miss(self):
        p, f, a, d, blob = fixture(); other = copy.deepcopy(p); other["id"] = "g41110.test-no-law"; other["laws"] = []
        result = match.build_proposals({PID: p, other["id"]: other}, {"forms": {f["id"]: f}}, {"programs": {PID: {"candidates": []}}}, a,
                                       {f["id"]: d}, original_bytes={f["id"]: blob})
        self.assertEqual(result["summary"]["programs"], 2)
        self.assertEqual(result["summary"]["originalsVerifiedOnce"], 1)
        self.assertEqual(len(result["rows"]), 1)
        self.assertEqual(result["programs"][other["id"]]["reasonCodes"], ["no_candidate_forms"])
        self.assertEqual(result["rows"][0]["verificationStatus"], "proposed")

    def test_shared_original_and_law_are_prepared_once_and_national_candidates_are_out_of_scope(self):
        p, f, a, d, blob = fixture(); other = copy.deepcopy(p); other["id"] = "g41110.test-duplicate"
        a["programs"][other["id"]] = {"lawKeys": [KEY]}
        progress = []
        result = match.build_proposals({PID: p, other["id"]: other}, {"forms": {f["id"]: f}},
                                      {"programs": {PID: {"candidates": [{"formId": "law-999"}]}}}, a,
                                      {f["id"]: d}, original_bytes={f["id"]: blob}, progress_callback=progress.append)
        self.assertEqual(len(result["rows"]), 2)
        self.assertEqual(result["summary"]["associationsEvaluated"], 2)
        self.assertEqual(result["summary"]["outOfScopeCandidatesSkipped"], 1)
        self.assertEqual(result["summary"]["originalsVerifiedOnce"], 1)
        self.assertEqual(result["summary"]["lawMaterialsPreparedOnce"], 1)
        self.assertEqual(progress[-1]["programsProcessed"], 2)
        self.assertEqual(progress[-1]["lawMaterialsPrepared"], 1)


if __name__ == "__main__":
    unittest.main()

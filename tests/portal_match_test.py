"""전국 법령 포털 서식 후보 점수. 게시 승인을 만들지 않는지 확인한다."""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline.forms.portal_match import (  # noqa: E402
    classify_role,
    evaluate_candidate,
    law_aliases,
    law_variants,
    normalize_law,
    program_tokens,
    split_law_citations,
)

GOYANG = {"sido": "41000", "sigungu": "41280", "label": "경기 고양시"}
SUWON = {"sido": "41000", "sigungu": "41110", "label": "경기 수원시"}
GYEONGGI = {"sido": "41000", "label": "경기도"}
SEOUL = {"sido": "11000", "label": "서울특별시"}
_FORBIDDEN = r"필수|확정|게시|검증|승인|자격"


def prog(**overrides):
    base = {
        "id": "p",
        "name": "테스트",
        "scope": "sigungu",
        "region": dict(GOYANG),
        "laws": [],
        "aliases": [],
    }
    base.update(overrides)
    return base


def form(**overrides):
    base = {
        "id": "f",
        "sourceKind": "ordin",
        "title": "신청서",
        "declaredKind": "서식",
        "lawTitle": "",
        "lawId": "1",
        "regionCode": "41280",
        "regionLabel": "경기도 고양시",
        "dateKind": "effective",
        "sourceUrl": "https://www.law.go.kr/example",
    }
    base.update(overrides)
    return base


class NormalizeLawTest(unittest.TestCase):
    def test_splits_complete_laws_at_and_without_splitting_title_words(self):
        first = "금산군 참전유공자 예우 및 지원에 관한 조례"
        second = "금산군 보훈명예수당 지급에 관한 조례"
        self.assertEqual(split_law_citations(first + " 및 " + second), [first, second])
        self.assertEqual(split_law_citations("아동복지법 및 아동복지법시행령"), ["아동복지법", "아동복지법시행령"])
        for single in ["재난 및 안전관리 기본법", "국가유공자 등 예우 및 지원에 관한 법률", "공유재산 및 물품 관리법"]:
            self.assertEqual(split_law_citations(single), [single])

    def test_splits_bulleted_citations_and_preserves_article_annotations(self):
        first = "청년기본법 제20조(청년 주거지원)"
        second = "울주군 청년 기본 조례 제12조(주거 및 생활안정 지원)"
        for bullet in ["○", "◦", "●", "□", "■"]:
            self.assertEqual(split_law_citations(f"{bullet} {first} {bullet} {second}"), [first, second])
        self.assertEqual(split_law_citations("○ 2026년 청년 지원계획 ○ 아동복지법"), ["2026년 청년 지원계획", "아동복지법"])

    def test_article_lists_are_not_new_law_citations(self):
        first = "아동복지법 제3조 및 제4조"
        self.assertEqual(split_law_citations(first + " 및 노인복지법 제2조"), [first, "노인복지법 제2조"])
        self.assertEqual(split_law_citations("아동복지법 제3조, 제4조"), ["아동복지법 제3조, 제4조"])
        self.assertEqual(split_law_citations("아동복지법 제4조 지원방법 및 대상"), ["아동복지법 제4조 지원방법 및 대상"])
        self.assertEqual(split_law_citations("종로구 음식물류 폐기물 발생억제, 수집·운반 조례, 노인복지법"),
                         ["종로구 음식물류 폐기물 발생억제, 수집·운반 조례", "노인복지법"])

    def test_quoted_titles_and_omnibus_amendment_titles_remain_whole(self):
        title = "지방자치법 및 같은 법 시행령 전부개정에 따른 대구광역시 수성구 동의 명칭 및 구역에 관한 조례 등 20개 조례의 일부개정을 위한 조례"
        self.assertEqual(split_law_citations(title), [title])
        self.assertEqual(split_law_citations("「" + title + "」 및 「아동복지법」"), ["「" + title + "」", "「아동복지법」"])
        self.assertEqual(split_law_citations("법 및 조례"), ["법 및 조례"])

    def test_strips_citations_and_keeps_decree_titles(self):
        self.assertEqual(normalize_law('청년기본법 제20조(청년 주거지원)'), '청년기본법')
        self.assertEqual(normalize_law('울주군 청년 기본 조례제12조(주거 및 생활안정 지원)'), '울주군청년기본조례')
        self.assertEqual(normalize_law("「아동복지법」(제3조, 제1항)"), "아동복지법")
        self.assertEqual(normalize_law("재난 및 안전관리 기본법(제66조, 제5항)"), "재난및안전관리기본법")
        self.assertEqual(normalize_law("재난 및 안전관리 기본법 시행령(제73조의2)"), "재난및안전관리기본법시행령")
        self.assertEqual(normalize_law("농어업재해보험법(제19조의0, 제0항)"), "농어업재해보험법")
        self.assertEqual(normalize_law("아동복지법 제4조의2 제1항"), "아동복지법")
        self.assertEqual(normalize_law("사회ㆍ복지법"), normalize_law("사회·복지법"))
        self.assertNotEqual(normalize_law("아동복지법"), normalize_law("아동복지법 시행령"))
        self.assertNotEqual(normalize_law("아동복지법 시행령"), normalize_law("아동복지법 시행규칙"))
        self.assertEqual(
            normalize_law("고양시 교복 지원 조례(제3조) || 다른 법".split("||")[0]),
            "고양시교복지원조례",
        )

    def test_empty_and_none(self):
        self.assertEqual(normalize_law(None), "")
        self.assertEqual(normalize_law(""), "")
        self.assertEqual(normalize_law("   "), "")


class LawVariantsTest(unittest.TestCase):
    def test_basic_law_and_ordinance_are_search_strings_only(self):
        self.assertEqual(law_variants("아동복지법"), ["아동복지법", "아동복지법시행령", "아동복지법시행규칙"])
        self.assertEqual(
            law_variants("사회복지사 등의 처우 및 지위 향상을 위한 법률"),
            [
                "사회복지사등의처우및지위향상을위한법률",
                "사회복지사등의처우및지위향상을위한법률시행령",
                "사회복지사등의처우및지위향상을위한법률시행규칙",
            ],
        )
        self.assertEqual(law_variants("고양시 교복 지원 조례"), ["고양시교복지원조례", "고양시교복지원조례시행규칙"])
        self.assertNotIn("고양시교복지원조례시행령", law_variants("고양시 교복 지원 조례"))

    def test_enforcement_titles_do_not_grow_again(self):
        self.assertEqual(law_variants("아동복지법 시행규칙"), ["아동복지법시행규칙"])
        self.assertEqual(law_variants("아동복지법 시행령"), ["아동복지법시행령"])
        self.assertEqual(law_variants("고양시 교복 지원 조례 시행규칙"), ["고양시교복지원조례시행규칙"])
        self.assertEqual(law_variants(None), [])
        self.assertEqual(law_variants(""), [])


class LawAliasTest(unittest.TestCase):
    JONGNO = {"sido": "서울특별시", "sigungu": "종로구"}
    SEOUL_JUNG = {"sido": "서울특별시", "sigungu": "중구"}
    BUSAN_JUNG = {"sido": "부산광역시", "sigungu": "중구"}
    GANGWON_GOSEONG = {"sido": "강원특별자치도", "sigungu": "고성군"}
    GYEONGNAM_GOSEONG = {"sido": "경상남도", "sigungu": "고성군"}

    def test_same_jurisdiction_prefix_is_the_only_added_alias(self):
        short = "종로구 입학준비금 지원 조례"
        official = "서울특별시 종로구 입학준비금 지원 조례"
        self.assertEqual(normalize_law(official), "서울특별시종로구입학준비금지원조례")
        self.assertNotEqual(normalize_law(official), normalize_law(short))
        self.assertEqual(
            law_aliases(short, self.JONGNO),
            ["종로구입학준비금지원조례", "서울특별시종로구입학준비금지원조례"],
        )
        self.assertEqual(law_aliases(official, self.JONGNO), ["서울특별시종로구입학준비금지원조례"])
        self.assertEqual(law_aliases(short), ["종로구입학준비금지원조례"])
        self.assertEqual(law_aliases(short, None), ["종로구입학준비금지원조례"])
        self.assertEqual(law_aliases(None, self.JONGNO), [])

    def test_does_not_cross_city_province_or_a_different_title(self):
        shared = "중구 입학준비금 지원 조례"
        seoul = law_aliases(shared, self.SEOUL_JUNG)
        busan = law_aliases(shared, self.BUSAN_JUNG)
        self.assertIn("서울특별시중구입학준비금지원조례", seoul)
        self.assertNotIn("부산광역시중구입학준비금지원조례", seoul)
        self.assertIn("부산광역시중구입학준비금지원조례", busan)
        self.assertNotIn("서울특별시중구입학준비금지원조례", busan)
        self.assertEqual(
            law_aliases("부산광역시 중구 입학준비금 지원 조례", self.SEOUL_JUNG),
            ["부산광역시중구입학준비금지원조례"],
        )
        self.assertEqual(
            law_aliases("중랑구 복지 조례", self.SEOUL_JUNG),
            ["중랑구복지조례"],
        )
        gangwon = law_aliases("고성군 입학준비금 지원 조례", self.GANGWON_GOSEONG)
        gyeongnam = law_aliases("고성군 입학준비금 지원 조례", self.GYEONGNAM_GOSEONG)
        self.assertIn("강원특별자치도고성군입학준비금지원조례", gangwon)
        self.assertNotIn("경상남도고성군입학준비금지원조례", gangwon)
        self.assertIn("경상남도고성군입학준비금지원조례", gyeongnam)
        self.assertNotIn("강원특별자치도고성군입학준비금지원조례", gyeongnam)
        sibling = normalize_law("서울특별시 종로구 입학준비금 추가 지원 조례")
        self.assertNotIn(sibling, law_aliases("종로구 입학준비금 지원 조례", self.JONGNO))
        self.assertEqual(
            law_aliases("경기도 입학준비금 지원 조례", {"sido": "경기도", "sigungu": ""}),
            ["경기도입학준비금지원조례"],
        )


class ClassifyRoleTest(unittest.TestCase):
    def test_deleted_wins(self):
        self.assertEqual(classify_role("[별지 제1호서식] <삭제 2017.11.14.>", "삭제"), "deleted")
        self.assertEqual(classify_role("[별지 제1호서식] <삭제 2017.11.14.> 동의서", "서식"), "deleted")
        self.assertEqual(classify_role("교복구입비 지원신청서", "deleted"), "deleted")
        self.assertEqual(classify_role("동의서", "폐지"), "deleted")

    def test_explicit_institution_before_consent(self):
        self.assertEqual(classify_role("[별지 제1호서식] 기관용 동의서", "서식"), "administrative")
        self.assertEqual(classify_role("기관용 개인정보 수집 이용 동의서", "서식"), "administrative")
        self.assertEqual(classify_role("학교용 서약서", "서식"), "administrative")
        self.assertEqual(classify_role("개인정보 수집ㆍ이용 동의서", "서식"), "consent")

    def test_operator_forms_are_not_applications(self):
        samples = [
            "노인복지시설 수탁운영 신청서",
            "장애인 이동용 보장구 수리업체 지정 신청서",
            "우수농산물 학교급식 지원신청서(학교용)",
            "학교급식 지원금 교부신청서",
            "현금출납부",
            "장수축하금 지급대장",
            "지급대상자 명부",
            "자활기금 지원 결정 통지서",
            "자활기금 정산 보고서",
        ]
        for title in samples:
            self.assertEqual(classify_role(title, "서식"), "administrative", title)

    def test_citizen_report_and_postpartum_care(self):
        self.assertEqual(classify_role("[별지 서식]사회재난 피해신고서", "서식"), "application")
        self.assertEqual(classify_role("피해 신고서", "서식"), "application")
        self.assertEqual(classify_role("야생동물에 의한 농작물 등 피해발생 신고서", "서식"), "application")
        self.assertEqual(classify_role("산후관리 서비스 신청서", "서식"), "application")
        self.assertEqual(classify_role("산후관리사 신청서", "서식"), "application")
        self.assertEqual(classify_role("자활기금 사용 신고서", "서식"), "reference")
        self.assertNotEqual(classify_role("산후관리 신청서", "서식"), "administrative")

    def test_bracket_spanning_the_title_keeps_the_application(self):
        citizen = "[별지 제1호서식 장애인 휠체어 등 수리 신청서]"
        self.assertEqual(classify_role(citizen, "서식"), "application")
        self.assertEqual(classify_role("[별지 제1호서식] 신청서", "서식"), "application")
        self.assertEqual(classify_role("[별지 제1호서식] 지급대상자 명부", "서식"), "administrative")
        self.assertEqual(classify_role("[별지 제1호서식 지급대상자 명부]", "서식"), "administrative")
        self.assertEqual(
            classify_role("[별지 제1호서식 장애인 이동용 보장구 수리업체 지정 신청서]", "서식"),
            "administrative",
        )
        self.assertEqual(classify_role("[별지 제1호서식] <삭제 2017.11.14.>", "서식"), "deleted")
        self.assertEqual(
            classify_role("[별지 제1호서식 장애인 휠체어 등 수리 신청서 <삭제 2017.11.14.>]", "서식"),
            "deleted",
        )
        self.assertEqual(classify_role(citizen, "삭제"), "deleted")

    def test_other_roles_and_annex(self):
        self.assertEqual(classify_role("[별표 1] 심사기준", "별표"), "reference")
        self.assertEqual(classify_role("노동취약계층 유급병가지원 신청 위임장", "서식"), "delegation")
        self.assertEqual(classify_role("서약서", "서식"), "consent")
        self.assertEqual(classify_role("교복구입비 지원신청서", "서식"), "application")
        self.assertEqual(classify_role("등록금 지급 확인서", "서식"), "supporting")
        self.assertEqual(classify_role(None, None), "reference")

    def test_application_word_inside_parentheses_keeps_precedence(self):
        self.assertEqual(classify_role("별지서식(신청서)", "서식"), "application")
        self.assertEqual(classify_role("별지 서식 (신청서)", "서식"), "application")
        self.assertEqual(classify_role("별지서식(피해신고서)", "서식"), "application")
        self.assertEqual(classify_role("사회보장급여 신청(변경)서", "서식"), "application")
        self.assertEqual(classify_role("사회서비스이용권 신청(변경)서", "서식"), "application")
        self.assertEqual(classify_role("별지서식(신고서)", "서식"), "reference")
        self.assertEqual(classify_role("별지서식(기관용 신청서)", "서식"), "administrative")
        self.assertEqual(classify_role("별지서식(학교용 신청서)", "서식"), "administrative")
        self.assertEqual(classify_role("별지서식(신청서)", "삭제"), "deleted")
        self.assertEqual(classify_role("별지서식(신청서)", "폐지"), "deleted")
        self.assertEqual(classify_role("별지서식(신청서) <삭제 2017.11.14.>", "서식"), "deleted")
        self.assertEqual(classify_role("[별지 제1호서식] <삭제 2017.11.14.> (신청서)", "서식"), "deleted")


class ProgramTokensTest(unittest.TestCase):
    def test_drops_place_and_generic_words_keeps_compounds(self):
        tokens = program_tokens(prog(
            name="경기도 고양시 교복구입비 지원 사업",
            aliases=["교복 지원", "산후관리 서비스", "복지관 운영"],
        ))
        self.assertEqual(tokens, ["교복구입비", "산후관리", "복지관"])
        self.assertNotIn("지원", tokens)
        self.assertNotIn("운영", tokens)
        self.assertNotIn("고양", tokens)
        self.assertNotIn("경기", tokens)

    def test_order_and_contained_alias(self):
        tokens = program_tokens(prog(name="한시적 양육비 지원", aliases=["양육비 긴급지원"]))
        self.assertEqual(tokens[0], "한시적")
        self.assertIn("양육비", tokens)
        self.assertIn("긴급지원", tokens)
        self.assertEqual(program_tokens(prog(name="교복구입비 지원", aliases=["교복 지원"])), ["교복구입비"])
        self.assertEqual(program_tokens(None), [])


class EvaluateCandidateTest(unittest.TestCase):
    def test_jurisdiction_collision(self):
        meal = form(
            id="meal",
            title="아동급식 신청서",
            lawTitle="고양시 아동급식지원에 관한 조례",
            regionCode="41280",
            regionLabel="경기도 고양시",
        )
        laws = ["고양시 아동급식지원에 관한 조례(제4조)"]
        goyang = prog(name="아동급식 지원", laws=laws, region=dict(GOYANG))
        self.assertEqual(evaluate_candidate(goyang, meal)["formId"], "meal")
        self.assertIsNone(evaluate_candidate(prog(name="아동급식 지원", laws=laws, region=dict(SUWON)), meal))
        self.assertIsNone(evaluate_candidate(prog(name="아동급식 지원", laws=laws, scope="national", region=None), meal))
        self.assertIsNone(evaluate_candidate(prog(name="아동급식 지원", laws=laws, scope="sido", region=dict(GYEONGGI)), meal))

    def test_province_form_only_same_province_record(self):
        province = form(
            id="gg",
            title="한시적 양육비 지원 신청서",
            lawTitle="경기도 양육비 지원 조례",
            regionCode="41000",
            regionLabel="경기도",
        )
        laws = ["경기도 양육비 지원 조례"]
        matched = evaluate_candidate(prog(
            name="한시적 양육비 지원", scope="sido", region=dict(GYEONGGI), laws=laws,
        ), province)
        self.assertEqual(matched["scopeBasis"], "same_sido")
        self.assertIsNone(evaluate_candidate(prog(
            name="한시적 양육비 지원", scope="sido", region=dict(SEOUL), laws=laws,
        ), province))
        self.assertIsNone(evaluate_candidate(prog(name="한시적 양육비 지원", laws=laws, region=dict(GOYANG)), province))
        self.assertIsNone(evaluate_candidate(prog(
            name="한시적 양육비 지원", scope="national", region=None, laws=laws,
        ), province))

    def test_unresolved_region_rejected(self):
        item = form(id="x", title="아동급식 신청서", lawTitle="아동급식 조례", regionCode="unresolved", regionLabel="고양시")
        program = prog(name="아동급식 지원", laws=["아동급식 조례"])
        self.assertIsNone(evaluate_candidate(program, item))
        self.assertIsNone(evaluate_candidate(program, form(id="y", regionCode="", lawTitle="아동급식 조례", title="아동급식 신청서")))
        self.assertIsNone(evaluate_candidate(program, form(id="z", regionCode="4128", lawTitle="아동급식 조례", title="아동급식 신청서")))
        self.assertIsNone(evaluate_candidate(program, form(
            id="nat-city", sourceKind="law", regionCode="41280", lawTitle="아동복지법", title="아동급식 신청서",
        )))

    def test_national_form_on_local_needs_cited_law(self):
        national_form = form(
            id="nat",
            sourceKind="law",
            title="아동급식 신청서",
            lawTitle="아동복지법",
            regionCode="national",
            regionLabel="전국 공통",
            dateKind="promulgated",
        )
        local = prog(name="아동급식 지원", laws=[], region=dict(GOYANG))
        self.assertIsNone(evaluate_candidate(local, national_form))
        cited = prog(name="아동급식 지원", laws=["아동복지법(제4조, 제1항)"], region=dict(GOYANG))
        found = evaluate_candidate(cited, national_form)
        self.assertEqual(found["basis"], "law_reference")
        self.assertEqual(found["scopeBasis"], "national_law_reference")
        self.assertNotIn("approved", found)
        self.assertIs(type(found["score"]), int)
        national_program = prog(name="아동급식 지원", scope="national", region=None, laws=["아동복지법"])
        direct = evaluate_candidate(national_program, national_form)
        self.assertEqual(direct["basis"], "law_exact")
        self.assertEqual(direct["scopeBasis"], "national")
        words_only = prog(name="아동급식 지원", scope="national", region=None, laws=[])
        by_title = evaluate_candidate(words_only, national_form)
        self.assertEqual(by_title["basis"], "title_overlap")
        self.assertEqual(by_title["scopeBasis"], "national")

    def test_parent_law_rule_stays_candidate(self):
        program = prog(name="아동급식 지원", scope="national", region=None, laws=["아동복지법(제4조)"])
        rule = form(
            id="rule",
            sourceKind="rule",
            title="아동급식 신청서",
            lawTitle="아동복지법 시행규칙",
            regionCode="national",
            regionLabel="전국 공통",
            dateKind="issued",
        )
        found = evaluate_candidate(program, rule)
        self.assertEqual(set(found), {"formId", "score", "reason", "basis", "scopeBasis"})
        self.assertEqual(found["basis"], "law_family")
        self.assertNotIn("approved", found)
        self.assertNotIn("verified", found)
        self.assertRegex(found["reason"], "검토 후보")
        self.assertNotRegex(found["reason"], _FORBIDDEN)
        exact = evaluate_candidate(program, form(
            id="law", sourceKind="law", title="아동급식 신청서", lawTitle="아동복지법",
            regionCode="national", regionLabel="전국 공통",
        ))
        self.assertGreater(exact["score"], found["score"])
        local = prog(name="아동급식 지원", laws=["아동복지법"], region=dict(GOYANG))
        linked = evaluate_candidate(local, rule)
        self.assertEqual(linked["basis"], "law_reference")
        self.assertEqual(linked["scopeBasis"], "national_law_reference")
        self.assertNotRegex(linked["reason"], _FORBIDDEN)
        sibling = form(
            id="sibling", sourceKind="law", title="급식비 신청서", lawTitle="아동복지법 시행령",
            regionCode="national", regionLabel="전국 공통",
        )
        only_rule = prog(name="교복구입비 지원", scope="national", region=None, laws=["아동복지법 시행규칙"])
        self.assertIsNone(evaluate_candidate(only_rule, sibling))

    def test_named_form_outranks_generic_and_unrelated(self):
        law = "고양시 복지 조례"
        program = prog(name="교복구입비 지원", laws=[law])
        named = evaluate_candidate(program, form(id="named", title="교복구입비 지원신청서", lawTitle=law))
        generic = evaluate_candidate(program, form(id="generic", title="개인정보 수집 이용 동의서", lawTitle=law, declaredKind="서식"))
        other = evaluate_candidate(program, form(id="other", title="급식비 지원신청서", lawTitle=law))
        self.assertEqual(classify_role("개인정보 수집 이용 동의서", "서식"), "consent")
        self.assertIsNotNone(named)
        self.assertIsNotNone(generic)
        self.assertIsNotNone(other)
        self.assertGreater(named["score"], generic["score"])
        self.assertGreater(generic["score"], other["score"])
        self.assertEqual(named["basis"], "law_exact")
        self.assertEqual(other["basis"], "law_exact")
        self.assertRegex(generic["reason"], "일반적")
        self.assertRegex(other["reason"], "다른 세부")
        for item in (named, generic, other):
            self.assertNotRegex(item["reason"], _FORBIDDEN)
            self.assertNotIn("approved", item)

    def test_generic_word_alone_is_not_enough(self):
        self.assertIsNone(evaluate_candidate(
            prog(name="고양시 지원 서비스 사업", laws=[]),
            form(id="generic", title="생활복지서비스 신청서", lawTitle=""),
        ))
        self.assertIsNone(evaluate_candidate(
            prog(name="양육비 지원", laws=[]),
            form(id="short", title="한시적 양육비 지원 신청서", lawTitle=""),
        ))
        self.assertIsNotNone(evaluate_candidate(
            prog(name="한시적 양육비 지원", laws=[]),
            form(id="care", title="한시적 양육비 지원 신청서", lawTitle=""),
        ))
        self.assertIsNotNone(evaluate_candidate(
            prog(name="장수 축하금 지급", laws=[]),
            form(id="long", title="장수축하금 지급 신청서", lawTitle=""),
        ))

    def test_whole_bracket_application_is_candidate_not_confirmation(self):
        title = "[별지 제1호서식 장애인 휠체어 등 수리 신청서]"
        law = "구리시 장애인 휠체어 등 수리 지원 조례"
        program = prog(name="장애인 휠체어 수리 지원", laws=[])
        found = evaluate_candidate(program, form(id="ordin-11128481", title=title, lawTitle=""))
        self.assertEqual(found["formId"], "ordin-11128481")
        self.assertEqual(found["basis"], "title_overlap")
        self.assertEqual(set(found), {"formId", "score", "reason", "basis", "scopeBasis"})
        self.assertRegex(found["reason"], "검토 후보")
        self.assertIn("휠체어", found["reason"])
        self.assertNotRegex(found["reason"], _FORBIDDEN)
        self.assertNotIn("approved", found)
        self.assertNotIn("verified", found)
        standard = evaluate_candidate(program, form(
            id="standard", title="[별지 제1호서식] 장애인 휠체어 등 수리 신청서", lawTitle="",
        ))
        self.assertEqual(standard["basis"], "title_overlap")
        self.assertNotIn("approved", standard)
        compound = evaluate_candidate(
            prog(name="장애인휠체어 지원", laws=[]),
            form(id="compound", title=title, lawTitle=""),
        )
        self.assertEqual(compound["basis"], "title_overlap")
        self.assertIn("장애인휠체어", compound["reason"])
        self.assertNotIn("approved", compound)
        cited = prog(name="장애인 휠체어 수리 지원", laws=[law])
        blocked = [
            form(id="register", title="[별지 제1호서식 지급대상자 명부]", lawTitle=law),
            form(id="header-register", title="[별지 제1호서식] 지급대상자 명부", lawTitle=law),
            form(
                id="vendor",
                title="[별지 제1호서식 장애인 이동용 보장구 수리업체 지정 신청서]",
                lawTitle=law,
            ),
            form(id="deleted-kind", title=title, declaredKind="삭제", lawTitle=law),
            form(
                id="deleted-title",
                title="[별지 제1호서식 장애인 휠체어 등 수리 신청서 <삭제 2017.11.14.>]",
                lawTitle=law,
            ),
        ]
        for item in blocked:
            self.assertIsNone(evaluate_candidate(cited, item), item["id"])

    def test_blocked_roles_never_returned(self):
        law = "고양시 노인복지 조례"
        program = prog(name="노인복지시설 수탁", laws=[law])
        blocked = [
            form(id="gone", title="교복구입비 지원신청서", declaredKind="삭제", lawTitle=law),
            form(id="annex", title="[별표 1] 심사기준", declaredKind="별표", lawTitle=law),
            form(id="office", title="기관용 동의서", lawTitle=law),
            form(id="ledger", title="현금출납부", lawTitle=law),
            form(id="operator", title="노인복지시설 수탁운영 신청서", lawTitle=law),
        ]
        for item in blocked:
            self.assertIsNone(evaluate_candidate(program, item), item["id"])
        report = evaluate_candidate(program, form(
            id="report", title="사회재난 피해신고서", lawTitle=law,
        ))
        self.assertEqual(report["formId"], "report")
        self.assertEqual(classify_role("사회재난 피해신고서", "서식"), "application")

    def test_parenthetical_application_is_a_candidate_admin_and_deleted_are_not(self):
        law = "고양시 교복 지원 조례"
        program = prog(name="교복 지원", laws=[law])
        found = evaluate_candidate(program, form(id="paren", title="별지서식(신청서)", lawTitle=law))
        self.assertEqual(found["formId"], "paren")
        self.assertEqual(found["basis"], "law_exact")
        self.assertNotIn("approved", found)
        self.assertNotRegex(found["reason"], _FORBIDDEN)
        self.assertIsNone(evaluate_candidate(program, form(
            id="admin", title="별지서식(기관용 신청서)", lawTitle=law,
        )))
        self.assertIsNone(evaluate_candidate(program, form(
            id="school", title="별지서식(학교용 신청서)", lawTitle=law,
        )))
        self.assertIsNone(evaluate_candidate(program, form(
            id="gone", title="별지서식(신청서)", declaredKind="삭제", lawTitle=law,
        )))
        self.assertIsNone(evaluate_candidate(program, form(
            id="struck", title="별지서식(신청서) <삭제 2017.11.14.>", lawTitle=law,
        )))

    def test_same_jurisdiction_alias_matches_only_that_ordinance(self):
        program = prog(
            name="입학준비금 지원",
            laws=["종로구 입학준비금 지원 조례(제4조)"],
            region={"sido": "11000", "sigungu": "11110", "label": "서울 종로구"},
        )
        found = evaluate_candidate(program, form(
            id="jongno",
            title="입학준비금 지원신청서",
            lawTitle="서울특별시 종로구 입학준비금 지원 조례",
            regionCode="11110",
            regionLabel="서울특별시 종로구",
        ))
        self.assertEqual(found["formId"], "jongno")
        self.assertEqual(found["basis"], "law_exact")
        self.assertEqual(found["scopeBasis"], "same_sigungu")
        self.assertNotIn("approved", found)
        self.assertNotRegex(found["reason"], _FORBIDDEN)
        self.assertIsNone(evaluate_candidate(program, form(
            id="bare",
            title="별지",
            lawTitle="서울특별시 종로구 입학준비금 지원 조례",
            regionCode="11110",
            regionLabel="서울특별시 종로구",
        )))
        self.assertIsNone(evaluate_candidate(prog(
            name="입학준비금 지원",
            laws=["중구 입학준비금 지원 조례"],
            region={"sido": "26000", "sigungu": "26110", "label": "부산 중구"},
        ), form(
            id="seoul-jung",
            title="입학준비금 지원신청서",
            lawTitle="서울특별시 중구 입학준비금 지원 조례",
            regionCode="11140",
            regionLabel="서울특별시 중구",
        )))
        self.assertIsNone(evaluate_candidate(prog(
            name="입학준비금 지원",
            laws=["고성군 입학준비금 지원 조례"],
            region={"sido": "51000", "sigungu": "51820", "label": "강원 고성군"},
        ), form(
            id="gyeongnam-goseong",
            title="입학준비금 지원신청서",
            lawTitle="경상남도 고성군 입학준비금 지원 조례",
            regionCode="48820",
            regionLabel="경상남도 고성군",
        )))
        self.assertIsNone(evaluate_candidate(program, form(
            id="sibling",
            title="전입학생 지원신청서",
            lawTitle="서울특별시 종로구 입학준비금 추가 지원 조례",
            regionCode="11110",
            regionLabel="서울특별시 종로구",
        )))

    def test_inputs_not_mutated_and_repeat_is_deterministic(self):
        program = prog(name="한시적 양육비 지원", laws=["고양시 한시적 양육비 지원 조례(제5조, 제1항) || 다른 법"], aliases=["양육비 지원"])
        item = form(id="z", title="한시적 양육비 지원 신청서", lawTitle="「고양시 한시적 양육비 지원 조례」")
        before_program = copy.deepcopy(program)
        before_form = copy.deepcopy(item)
        laws_id = id(program["laws"])
        aliases_id = id(program["aliases"])
        first = evaluate_candidate(program, item)
        second = evaluate_candidate(program, item)
        self.assertEqual(program_tokens(program), program_tokens(before_program))
        self.assertEqual(program, before_program)
        self.assertEqual(item, before_form)
        self.assertEqual(id(program["laws"]), laws_id)
        self.assertEqual(id(program["aliases"]), aliases_id)
        self.assertEqual(first, second)
        self.assertIsNot(first, second)
        again = evaluate_candidate(program, form(id="z", title="한시적 양육비 지원 신청서", lawTitle="「고양시 한시적 양육비 지원 조례」"))
        self.assertEqual(first["formId"], again["formId"])
        self.assertEqual(first["score"], again["score"])

    def test_missing_inputs_do_not_raise(self):
        self.assertIsNone(evaluate_candidate(None, form()))
        self.assertIsNone(evaluate_candidate(prog(), None))
        self.assertIsNone(evaluate_candidate(prog(), form(id="")))
        self.assertEqual(program_tokens({}), [])


if __name__ == "__main__":
    unittest.main()

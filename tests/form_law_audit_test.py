import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('law_audit', ROOT/'scripts/audit-form-laws.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class LawAuditTest(unittest.TestCase):
    def education_regions(self):
        return m.RegionIndex({'sidos': [
            {'code': '11000', 'name': '서울특별시', 'sigungus': [{'code': '11545', 'name': '금천구'}]},
            {'code': '26000', 'name': '부산광역시', 'sigungus': [{'code': '26410', 'name': '금정구'}]},
        ]})

    def test_explicit_education_authority_is_not_replaced_by_program_district(self):
        programs = {'p': {'id': 'p', 'region': {'sido': '11000', 'sigungu': '11545'},
                         'laws': ['서울특별시교육청 난치병 학생 치료비 지원에 관한 조례']}}
        jobs, _, _ = m.plan(programs, self.education_regions())
        job = next(iter(jobs.values()))
        self.assertEqual(job['regionCode'], '11000')
        self.assertEqual(job['regionLabel'], '서울특별시교육청')
        self.assertTrue(m.jurisdiction_ok(job, '서울특별시교육청'))
        for wrong in ['서울특별시', '서울특별시 금천구', '부산광역시교육청', '서울특별시교육청 서부교육지원청']:
            self.assertFalse(m.jurisdiction_ok(job, wrong))

    def test_education_spacing_and_city_alias_keep_exact_authority(self):
        for title in ['서울시교육청 다문화교육 진흥 조례', '서울특별시 교육청 다문화교육 진흥 조례']:
            jobs, _, _ = m.plan({'p': {'id': 'p', 'laws': [title]}}, self.education_regions())
            job = next(iter(jobs.values()))
            self.assertEqual(job['regionLabel'], '서울특별시교육청')
            self.assertIn('서울특별시교육청다문화교육진흥조례', m.title_keys(job))
            self.assertNotIn('부산광역시교육청다문화교육진흥조례', m.title_keys(job))
        jobs, _, _ = m.plan({'p': {'id': 'p', 'region': {'sido': '11000', 'sigungu': '11545'},
                                 'laws': ['광주광역시교육청 학생통학 지원 조례']}}, self.education_regions())
        job = next(iter(jobs.values()))
        self.assertEqual(job['regionCode'], 'unresolved')
        self.assertEqual(job['regionLabel'], '광주광역시교육청')
        self.assertTrue(m.jurisdiction_ok(job, '광주광역시교육청'))
        self.assertFalse(m.jurisdiction_ok(job, '서울특별시교육청'))

    def test_official_search_education_match_requires_the_same_issuing_authority(self):
        title = '서울특별시교육청 난치병 학생 치료비 지원에 관한 조례'
        jobs, _, _ = m.plan({'p': {'id': 'p', 'laws': [title]}}, self.education_regions())
        job = next(iter(jobs.values()))
        class Index:
            def identity(self, _): return None, 0
        class Portal:
            org = '서울특별시교육청'
            def search(self, *args):
                return {'OrdinSearch': {'totalCnt': '1', 'ordin': [{'자치법규명': title,
                    '자치법규일련번호': '1617657', '지자체기관명': self.org}]}}, 'https://www.law.go.kr/'
        portal = Portal()
        identity, reason = m.resolve(job, portal, Index(), [])
        self.assertEqual(identity['id'], '1617657')
        self.assertIsNone(reason)
        for org in ['서울특별시', '부산광역시교육청']:
            portal.org = org
            identity, _ = m.resolve(job, portal, Index(), [])
            self.assertIsNone(identity)

    def test_annex_index_does_not_confuse_education_office_with_city_government(self):
        jobs, _, _ = m.plan({'p': {'id': 'p', 'laws': ['서울특별시교육청 학생 지원 조례']}}, self.education_regions())
        job = next(iter(jobs.values()))
        class Connection:
            def execute(self, *args):
                return [(json.dumps({'regionLabel': authority, 'lawId': identifier}),)
                        for authority, identifier in [('서울특별시', 'wrong-city'),
                            ('부산광역시교육청', 'wrong-office'), ('서울특별시교육청', 'same-office')]]
        index = m.AnnexIndex(None)
        index.available = True
        index.loose_map = lambda: {}
        index.connection = lambda: Connection()
        self.assertEqual([r['lawId'] for r in index.rows(job)], ['same-office'])

    def test_national_statutes_are_not_regions_because_title_words_end_in_si(self):
        names = ['낚시 관리 및 육성법', '낚시 관리 및 육성법 시행규칙', '도시 및 주거환경정비법 시행령']
        jobs, _, _ = m.plan({'p': {'id': 'p', 'laws': names, 'region': {'sido': '11000', 'sigungu': '11545'}}}, self.education_regions())
        self.assertEqual(len(jobs), 3)
        self.assertTrue(all(j['regionCode'] == 'national' and j['kindGuess'] == 'law' for j in jobs.values()))

    def test_assemble_exposes_unidentified_citations_and_pending_queries(self):
        keys = {'a': ['national|가법'], 'b': ['national|나법'], 'no-law': []}
        laws = {'national|가법': {'state': 'read', 'id': '1'}}
        skipped = [{'programId': 'no-law', 'citation': '2026년 생활지원사업 추진계획', 'reason': 'NOT_LAW_SHAPED'},
                   {'programId': 'a', 'citation': '조례', 'reason': 'GENERIC_LAW_WORD_ONLY'}]
        out = m.assemble(keys, laws, '2026-10-16', skipped)
        self.assertEqual(out['summary']['plannedQueries'], 2)
        self.assertEqual(out['summary']['pendingQueries'], 1)
        self.assertEqual(out['summary']['unresolvedCitations'], 2)
        self.assertEqual(out['programs']['no-law']['unresolvedCitations'], [
            {'citation': '2026년 생활지원사업 추진계획', 'reason': 'NOT_LAW_SHAPED'}])
        self.assertNotIn('unresolvedCitations', out['programs']['b'])
        self.assertEqual(set(out['programs']), set(keys))
        complete = m.assemble(keys, {**laws, 'national|나법': {'state': 'not_found', 'id': ''}}, '2026-10-16')
        self.assertEqual(complete['summary']['pendingQueries'], 0)
        self.assertEqual(complete['summary']['unresolvedCitations'], 0)

    def test_aliases_add_only_known_jurisdiction_without_changing_program_words(self):
        job={'titleKey':'강북구아동청소년지원조례','query':'강북구 아동 청소년 지원 조례',
             'kindGuess':'ordin','regionCode':'11305','regionLabel':'서울특별시 강북구'}
        self.assertIn('서울특별시강북구아동청소년지원조례',m.title_keys(job))
        self.assertNotIn('부산광역시강북구아동청소년지원조례',m.title_keys(job))
        job['titleKey']='입학준비금지원조례';job['query']='입학준비금 지원 조례'
        self.assertIn('서울특별시강북구입학준비금지원조례',m.title_keys(job))
        job['regionCode']='unresolved'
        self.assertEqual(m.title_keys(job),{'입학준비금지원조례'})

    def test_citations_split_without_breaking_article_lists(self):
        parts = m.split_citations('「법률 A」(제1조, 제2조)||구례군 보훈 조례, 구례군 참전유공자 지원 조례')
        self.assertEqual(len(parts), 3)
        self.assertEqual(m.strip_articles(parts[0])[0], '법률 A')
        self.assertEqual(m.guess_kind('서울특별시 종로구 관광해설사 운영 조례 시행규칙', True), 'ordin')
        self.assertEqual(m.split_citations('종로구 음식물류 폐기물 발생억제, 수집·운반 조례, 노인복지법'),
                         ['종로구 음식물류 폐기물 발생억제, 수집·운반 조례', '노인복지법'])
        self.assertEqual(m.strip_articles('치매관리법 제3조 국가 등의 의무')[0], '치매관리법')
        self.assertEqual(m.strip_articles('중구 선택예방접종 지원 조례[조례 제1563호, 2022.11.14.]')[0], '중구 선택예방접종 지원 조례')

    def test_shared_splitter_recovers_each_bulleted_law_and_keeps_plans_unresolved(self):
        programs = {'p': {'id': 'p', 'region': {'sido': '11000', 'sigungu': '11545'},
                         'laws': ['○ 청년기본법 제20조(청년 주거지원) ○ 서울특별시 금천구 청년 기본 조례 제12조(예우 및 지원)',
                                  '아동복지법 및 노인복지법',
                                  '노인복지법 및 2026년 방문 지원계획']}}
        jobs, keys, skipped = m.plan(programs, self.education_regions())
        self.assertEqual({job['query'] for job in jobs.values()},
                         {'청년기본법', '서울특별시 금천구 청년 기본 조례', '아동복지법', '노인복지법'})
        self.assertEqual(len(keys['p']), 4)
        self.assertEqual([row['citation'] for row in skipped], ['2026년 방문 지원계획'])
        self.assertEqual(m.split_citations('국가유공자 등 예우 및 지원에 관한 법률'),
                         ['국가유공자 등 예우 및 지원에 관한 법률'])
        self.assertEqual(m.split_citations('아동복지법 제3조 및 제4조 및 노인복지법'),
                         ['아동복지법 제3조 및 제4조', '노인복지법'])

    def test_no_law_programs_remain_in_plan(self):
        regions = m.RegionIndex({'sidos': [{'code': '11000', 'name': '서울특별시', 'sigungus': [{'code': '11110', 'name': '종로구'}]}]})
        jobs, keys, _ = m.plan({'empty': {'id': 'empty'}, 'x': {'id': 'x', 'laws': ['서울특별시 종로구 지원 조례(제3조)'],
                            'region': {'sido': '11000', 'sigungu': '11110'}}}, regions)
        self.assertEqual(keys['empty'], [])
        self.assertEqual(len(jobs), 1)
        self.assertEqual(next(iter(jobs.values()))['regionCode'], '11110')

    def test_credentials_removed_from_nested_and_relative_response_urls(self):
        redactor = m.Redactor('TEST_CREDENTIAL_123')
        result = redactor.data({'OC': 'short', 'url': '/DRF/lawService.do?OC=TEST_CREDENTIAL_123&amp;target=ordin'})
        self.assertNotIn('TEST_CREDENTIAL_123', json.dumps(result))
        self.assertNotIn('short', json.dumps(result))
        self.assertNotIn('OC=', m.public_url('/DRF/lawService.do?OC=TEST_CREDENTIAL_123&target=ordin'))

    def test_toc_or_empty_html_is_not_a_body_read(self):
        self.assertFalse(m.real_body([{'조문내용': f'제{i}조(신청 방법)'} for i in range(1, 50)]))
        self.assertFalse(m.real_body(m.html_article_nodes('<html><h1>지원 조례</h1><script>load()</script></html>')))

    def test_html_preserves_citations_and_whole_application_article(self):
        html = '<div class="lawcon">제7조(지원신청) 제5조에 따른 지원을 받으려는 사람은 별지 신청서를 시장에게 제출하여야 한다.</div>'
        nodes = m.html_article_nodes(html)
        self.assertTrue(m.real_body(nodes))
        articles, total = m.application_articles(nodes)
        self.assertEqual(total, 1)
        self.assertEqual(articles[0]['number'], '제7조')
        self.assertIn('제5조', articles[0]['text'])

    def test_list_valued_api_body_keeps_article_identity_and_paragraphs(self):
        payload = {'조문': [{'조문번호': '7', '조문제목': '지원신청', '조문내용':
            ['제5조의 지원을 받으려는 주민은 구비서류를 작성하여 거주지 읍면장에게 제출하여야 한다.', '첨부 서류는 별지 서식에 따른다.']}]}
        nodes = m.article_nodes(payload)
        articles, total = m.application_articles(nodes)
        self.assertEqual(total, 1)
        self.assertEqual(articles[0]['number'], '제7조')
        self.assertIn('별지 서식', articles[0]['text'])
        self.assertIsNone(m.public_url('신청서.hwp'))

    def test_invalid_json_api_falls_back_to_public_body(self):
        class Portal:
            def body(self, *args): raise RuntimeError('PORTAL_INVALID_JSON')
            def public_body(self, *args):
                return '<div class="lawcon">제7조(지원신청) 지원받으려는 주민은 별지 신청서와 구비서류를 시장에게 제출하여야 한다.</div>', 'https://www.law.go.kr/LSW/ordinInfoR.do?ordinSeq=1'
        class Index:
            def rows(self, _): return []
        status, _, articles, _ = m.read_body({}, {'kind': 'ordin', 'id': '1'}, Portal(), Index(), [])
        self.assertEqual(status, 'read')
        self.assertEqual(articles[0]['number'], '제7조')

    def test_resume_cache_keeps_only_verified_read_records(self):
        with tempfile.TemporaryDirectory() as directory:
            key = '11110|조례'
            record = {'state': 'read', 'query': '조례', 'id': '1'}
            job = {k: '' for k in ('query', 'kindGuess', 'regionCode', 'regionLabel', 'citations', 'citedArticles')}
            m.write_cache(directory, key, job, record, [], m.Redactor('TEST_KEY'))
            self.assertEqual(m.read_cache(directory, key), record)
            record['state'] = 'failed'
            m.write_cache(directory, key, job, record, [], m.Redactor())
            self.assertIsNone(m.read_cache(directory, key))


if __name__ == '__main__': unittest.main()

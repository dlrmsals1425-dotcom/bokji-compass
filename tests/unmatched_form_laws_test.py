"""출처 증거 수집기의 경계: 법규 신원, 공식 별표·flSeq 결속, 없는 별표와 못 읽은 원문,
실패 재시도, 인증 값 유출. 망을 쓰지 않고 공식 응답 모양만 흉내 낸 입력으로 검사한다."""
import gzip
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('unmatched_form_laws', ROOT / 'scripts/collect-unmatched-form-laws.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

SECRET = 'oc-test-credential-9999'
LAW_ID = '1548535'
LAW_TITLE = '거창군 장애인보장구 수리비 지원 등에 관한 조례'
ANNEX_ID = '10071363'
FL_SEQ = '83424909'
SOURCE_URL = ('https://www.law.go.kr/LSW/flDownload.do?gubun=ELIS&flSeq=' + FL_SEQ +
              '&flNm=%EB%B3%84%EC%A7%80+%EC%A0%9C2%ED%98%B8%EC%84%9C%EC%8B%9D')
ARTICLE = ('제7조(수리비용의 청구) ③ 지정수리업체는 별지 제2호서식의 수리비용 청구서를 '
           '군수에게 제출하여야 한다.')


def annex(annex_id=ANNEX_ID, number='0002', fl_seq=FL_SEQ, title='별지 제2호서식(장애인보장구수리비용청구서)',
          host='www.law.go.kr'):
    url = ('http://' + host + '/flDownload.do?gubun=ELIS&flSeq=' + fl_seq) if fl_seq else ''
    return {'별표제목': title, '별표첨부파일구분': 'hwp', '별표첨부파일명': url, '별표번호': number,
            '별표키': annex_id, '별표내용': '', '별표구분': '서식', '별표가지번호': '00'}


def service(law_id=LAW_ID, title=LAW_TITLE, annexes=None, effective='20201125', container='별표',
            article=ARTICLE):
    payload = {'자치법규기본정보': {'자치법규ID': '2177756', '자치법규명': title, '자치법규일련번호': law_id,
                                   '지자체기관명': '경상남도 거창군', '시행일자': effective,
                                   '제개정정보': '일부개정', '자치법규종류': 'C0001',
                                   '공포번호': '2606', '공포일자': '20201125'},
               '조문': {'조': [{'조문번호': ['000700', '000700'], '조제목': '수리비용의 청구',
                                '조내용': article, '조문여부': 'Y'}]}}
    units = [annex()] if annexes is None else list(annexes)
    if units and container == '별표':
        payload['별표'] = {'별표단위': units}
    elif units:
        payload['별표단위'] = units
    return payload


def scope_form(form_id='ordin-' + ANNEX_ID, law_id=LAW_ID, url=SOURCE_URL, title='별지 제2호서식(장애인보장구수리비용청구서)'):
    return {'formId': form_id, 'sha256': 'a' * 64, 'format': 'hwp', 'lawId': law_id,
            'lawTitle': LAW_TITLE, 'title': title, 'regionCode': '48880', 'sourceUrl': url,
            'relativePath': form_id + '.hwp'}


def scope(forms):
    return m.load_scope({'schema': 1, 'baselineCommit': 'c' * 40, 'scope': '시험 범위',
                         'formCount': len(forms), 'forms': forms})


def audit(law_ids, key_prefix='48880|'):
    return {'laws': {key_prefix + 'law' + law_id: {'id': law_id, 'state': 'read', 'kind': 'ordin',
                                                   'title': LAW_TITLE}
                     for law_id in law_ids}}


def store_cache(cache_dir, key, payload, law_id=LAW_ID, stored_at='2026-10-16T00:00:00+00:00'):
    path = m.cache_file(cache_dir, key)
    path.parent.mkdir(parents=True, exist_ok=True)
    body = {'cacheVersion': 1, 'key': key, 'storedAt': stored_at,
            'record': {'id': law_id, 'state': 'read', 'title': LAW_TITLE},
            'raw': [{'step': 'search', 'payload': {'OrdinSearch': {'totalCnt': '1'}}},
                    {'step': 'body', 'target': 'ordin',
                     'url': 'https://www.law.go.kr/DRF/lawService.do?type=JSON&target=ordin&MST=' + law_id,
                     'payload': {'LawService': payload}}]}
    with gzip.open(path, 'wt', encoding='utf-8') as file:
        json.dump(body, file, ensure_ascii=False)
    return path


class StubPortal:
    """공식 조회를 흉내 낸다. 어떤 ID를 실제로 물었는지 기록한다."""

    def __init__(self, bodies=None, html=None, fail=(), authorization_failure=()):
        self.bodies = bodies or {}
        self.html = html or {}
        self.fail = set(fail)
        self.authorization_failure = set(authorization_failure)
        self.asked = []
        self.html_asked = []
        self.requests = 0

    def body(self, target, law_id):
        law_id = str(law_id)
        self.asked.append(law_id)
        self.requests += 1
        if law_id in self.authorization_failure:
            raise m.AuthorizationFailed('PORTAL_AUTHORIZATION_FAILED')
        if law_id in self.fail:
            raise RuntimeError('PORTAL_HTTP_503')
        safe = 'https://www.law.go.kr/DRF/lawService.do?type=JSON&target=ordin&MST=' + law_id
        return {'LawService': self.bodies[law_id]}, safe

    def public_body(self, kind, law_id):
        law_id = str(law_id)
        self.html_asked.append(law_id)
        self.requests += 1
        if law_id not in self.html:
            raise RuntimeError('PORTAL_PUBLIC_BODY_UNAVAILABLE')
        return self.html[law_id], m.law_public_url(law_id)


class IdentityTest(unittest.TestCase):
    def test_application_to_end_a_project_is_not_a_deleted_official_annex(self):
        for title in ['[별지 제8호서식] 사업변경(중단 폐지) 신청서',
                      '[별지 제3호] 공동주택관리 지원 사업 변경 중단 폐지 신청서',
                      '개인정보 삭제 신청서','사업 폐지 신고서']:
            with self.subTest(title=title):
                self.assertFalse(m.annex_rows(service(annexes=[annex(title=title)]))[0]['deleted'])
        for title in ['[별지 제7호서식] 생활용품비 지원 신청서 삭제<2023.6.30.>',
                      '[별지 제3호 서식] 삭제 _2017.12.29_',
                      '[별지 제2호서식] 삭제','[별지 제2호서식] 삭 제 <2025. 9. 15.>',
                      '[별지 제3호서식] 폐지 (2024. 1. 1.)']:
            with self.subTest(title=title):
                self.assertTrue(m.annex_rows(service(annexes=[annex(title=title)]))[0]['deleted'])
    def test_body_is_kept_only_for_the_exact_source_law_id(self):
        record, error = m.body_record(service(), LAW_ID, source='law-service')
        self.assertIsNone(error)
        self.assertEqual(record['lawId'], LAW_ID)
        self.assertEqual(record['lawTitle'], LAW_TITLE)
        self.assertEqual(record['stableLawId'], '2177756')
        self.assertEqual(record['effectiveDate'], '20201125')
        self.assertEqual(record['articles'][0]['number'], '제7조')
        self.assertEqual(record['annexes'][0]['annexId'], ANNEX_ID)
        self.assertEqual(record['annexCount'], 1)
        # 전체 원문은 공식 응답 그대로 보존한다.
        self.assertEqual(record['lawService']['조문']['조'][0]['조내용'], ARTICLE)
        self.assertEqual(m.body_record(service(), '999999', source='law-service'),
                         (None, 'LAW_IDENTITY_MISMATCH'))
        self.assertEqual(m.body_record({'자치법규기본정보': {'자치법규명': LAW_TITLE}}, LAW_ID, source='x'),
                         (None, 'LAW_METADATA_MISSING'))
        self.assertEqual(m.body_record('<html/>', LAW_ID, source='x'), (None, 'SOURCE_RESPONSE_UNREADABLE'))
        bare = {'자치법규기본정보': {'자치법규일련번호': LAW_ID, '자치법규명': LAW_TITLE}}
        self.assertEqual(m.body_record(bare, LAW_ID, source='x'), (None, 'EMPTY_BODY'))

    def test_branch_article_numbers_come_from_the_official_number_field(self):
        payload = service(article='① 별지 제1호서식에 따라 신청한다.')
        payload['조문']['조'][0]['조문번호'] = ['001002']
        record, error = m.body_record(payload, LAW_ID, source='x')
        self.assertIsNone(error)
        self.assertEqual(record['articles'][0]['number'], '제10조의2')

    def test_old_cache_is_reused_only_when_it_holds_that_exact_law_body(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder) / 'cache'
            law = {'lawId': LAW_ID, 'formIds': [], 'scopeTitles': [], 'cacheKeys': ['other', 'mine']}
            store_cache(cache, 'other', service(law_id='777777'), law_id='777777')
            self.assertEqual(m.reuse_body(law, cache), (None, 'LAW_CACHE_WITHOUT_EXACT_LAW_BODY'))
            store_cache(cache, 'mine', service())
            record, reason = m.reuse_body(law, cache)
            self.assertIsNone(reason)
            self.assertEqual((record['lawId'], record['lawCacheKey'], record['source']),
                             (LAW_ID, 'mine', 'law-census-cache'))
            self.assertEqual(record['fetchedAt'], '2026-10-16T00:00:00+00:00')
            missing = {'lawId': LAW_ID, 'formIds': [], 'scopeTitles': [], 'cacheKeys': []}
            self.assertEqual(m.reuse_body(missing, cache), (None, 'NO_REUSABLE_LAW_CACHE'))

    def test_annexes_are_found_in_both_official_container_shapes(self):
        for container in ('별표', '별표단위'):
            record, error = m.body_record(service(container=container), LAW_ID, source='x')
            self.assertIsNone(error)
            self.assertEqual([row['annexId'] for row in record['annexes']], [ANNEX_ID])
            self.assertEqual(record['annexes'][0]['flSeq'], FL_SEQ)
            self.assertTrue(record['annexes'][0]['url'].startswith('https://www.law.go.kr/flDownload.do?'))


class AttachmentIdentityTest(unittest.TestCase):
    def test_only_public_law_attachment_urls_give_a_file_identity(self):
        self.assertEqual(m.file_identity(SOURCE_URL), FL_SEQ)
        self.assertEqual(m.file_identity('http://www.law.go.kr/flDownload.do?gubun=ELIS&flSeq=1'), '1')
        for rejected in ['https://example.com/flDownload.do?flSeq=1',
                         'https://www.law.go.kr/LSW/flDownload.do?flSeq=abc',
                         'https://www.law.go.kr/LSW/flDownload.do?flSeq=1&flSeq=2',
                         'https://www.law.go.kr/DRF/lawService.do?MST=1',
                         'https://www.law.go.kr/LSW/flDownload.do?flSeq=1&OC=' + SECRET,
                         '', None]:
            self.assertIsNone(m.file_identity(rejected), rejected)

    def test_non_public_attachment_url_leaves_the_annex_without_a_file_identity(self):
        record, _ = m.body_record(service(annexes=[annex(host='mirror.example.com')]), LAW_ID, source='x')
        self.assertEqual(record['annexes'][0]['flSeq'], '')
        self.assertEqual(record['annexes'][0]['url'], '')


class BindingTest(unittest.TestCase):
    def form(self, **values):
        return scope([scope_form(**values)])['forms'][values.get('form_id', 'ordin-' + ANNEX_ID)]

    def bind(self, body_annexes, **values):
        body, error = m.body_record(service(annexes=body_annexes), LAW_ID, source='x')
        self.assertIsNone(error, error)
        return m.bind_annex(self.form(**values), body)

    def test_same_annex_id_and_same_official_file_is_bound(self):
        result = self.bind([annex()])
        self.assertEqual(result['binding'], 'bound')
        self.assertEqual(result['bindingReason'], 'OFFICIAL_ANNEX_BOUND_WITH_SAME_FILE')
        self.assertEqual((result['officialAnnexId'], result['officialFlSeq'], result['officialAnnexNumber']),
                         (ANNEX_ID, FL_SEQ, '2'))
        self.assertFalse(result['officialAnnexDeleted'])

    def test_same_annex_id_with_another_file_is_recorded_as_replaced(self):
        result = self.bind([annex(fl_seq='99999999')])
        self.assertEqual(result['binding'], 'file_replaced')
        self.assertEqual(result['officialFlSeq'], '99999999')
        self.assertEqual(result['bindingReason'], 'OFFICIAL_ANNEX_PRESENT_BUT_FILE_REPLACED')

    def test_annex_present_without_any_official_attachment(self):
        result = self.bind([annex(fl_seq='')])
        self.assertEqual(result['binding'], 'annex_without_attachment')

    def test_same_file_under_a_different_annex_id_is_renumbered_not_absent(self):
        result = self.bind([annex(annex_id='10071999', number='0003',
                                  title='별지 제3호서식(장애인보장구수리비용청구서)')])
        self.assertEqual(result['binding'], 'renumbered')
        self.assertEqual(result['officialAnnexId'], '10071999')
        self.assertEqual(result['officialAnnexNumber'], '3')

    def test_absent_annex_unread_source_and_missing_metadata_are_three_different_facts(self):
        absent = self.bind([annex(annex_id='22220000', number='0009', fl_seq='55555555',
                                  title='별지 제9호서식(다른 서식)')])
        self.assertEqual(absent['binding'], 'annex_absent')
        self.assertEqual(absent['bindingReason'], 'ANNEX_ABSENT_FROM_READ_SOURCE_BODY')
        body, error = m.body_record(service(annexes=[]), LAW_ID, source='x')
        self.assertIsNone(error)
        quiet = m.bind_annex(self.form(), body)
        self.assertEqual(quiet['binding'], 'annex_metadata_absent')
        self.assertIn('NOT_PROOF_OF_ABSENCE', quiet['bindingReason'])
        unread = m.bind_annex(self.form(), None)
        self.assertEqual(unread['binding'], 'source_unread')
        self.assertIn('NOT_PROOF_OF_ABSENCE', unread['bindingReason'])
        self.assertNotEqual(unread['binding'], absent['binding'])
        self.assertEqual(unread['officialAnnexId'], '')

    def test_deleted_annex_title_is_recorded_as_deleted(self):
        deleted = annex(title='별지 제2호서식 삭제')
        result = self.bind([deleted])
        self.assertTrue(result['officialAnnexDeleted'])
        self.assertEqual(result['binding'], 'bound')
        body, _ = m.body_record(service(annexes=[deleted]), LAW_ID, source='x')
        self.assertEqual(body['deletedAnnexCount'], 1)

    def test_public_page_attachment_is_evidence_only_about_the_file(self):
        body, _ = m.body_record(service(annexes=[]), LAW_ID, source='x')
        # 실제 공개 페이지는 '&amp;'로 적힌 상대 주소를 쓴다.
        body['htmlAnnexes'] = m.html_annex_rows(
            '<a href="flDownload.do?gubun=&amp;flSeq=' + FL_SEQ + '&amp;flNm=%EB%B3%84%EC%A7%80">x</a>',
            base='https://www.law.go.kr/LSW/ordinInfoR.do?ordinSeq=' + LAW_ID)
        self.assertEqual([row['flSeq'] for row in body['htmlAnnexes']], [FL_SEQ])
        self.assertEqual(body['htmlAnnexes'][0]['label'], '별지')
        found = m.bind_annex(self.form(), body)
        self.assertEqual(found['binding'], 'attachment_only_bound')
        self.assertEqual(found['officialFlSeq'], FL_SEQ)
        self.assertEqual(found['officialAnnexId'], '')
        body['htmlAnnexes'] = m.html_annex_rows('<a href="/LSW/flDownload.do?flSeq=1234">other</a>')
        self.assertEqual(m.bind_annex(self.form(), body)['binding'], 'attachment_absent')


class CollectTest(unittest.TestCase):
    def collect(self, folder, portal, forms, law_ids, **options):
        return m.collect(scope(forms), audit(law_ids), out_dir=Path(folder) / 'out', portal=portal,
                         redactor=m.Redactor(SECRET), cache_dir=Path(folder) / 'cache',
                         downloads_dir=Path(folder) / 'downloads', workers=2,
                         checked_at='2026-10-18', **options)

    def test_every_scope_id_is_accounted_with_an_explicit_state_and_reason(self):
        forms = [scope_form(), scope_form(form_id='ordin-20000001', law_id='2000001',
                                          url=SOURCE_URL.replace(FL_SEQ, '70000001')),
                 scope_form(form_id='not-an-ordin-id', law_id='2000002')]
        portal = StubPortal({LAW_ID: service(),
                             '2000001': service(law_id='2000001',
                                                annexes=[annex(annex_id='20000001', fl_seq='70000001')])})
        with tempfile.TemporaryDirectory() as folder:
            evidence, failures = self.collect(folder, portal, forms, [])
            self.assertEqual(evidence['summary']['scopeForms'], 3)
            states = {form_id: row['state'] for form_id, row in evidence['forms'].items()}
            self.assertEqual(states, {'ordin-' + ANNEX_ID: 'read', 'ordin-20000001': 'read',
                                      'not-an-ordin-id': 'failed'})
            self.assertEqual(evidence['forms']['not-an-ordin-id']['reason'], 'SCOPE_RECORD_INVALID')
            self.assertEqual(sum(evidence['summary']['formStates'].values()), 3)
            self.assertEqual(evidence['summary']['bindings']['bound'], 2)
            self.assertEqual(evidence['status'], 'complete')
            self.assertEqual(failures, {})
            for law_id in (LAW_ID, '2000001'):
                self.assertTrue(m.body_path(Path(folder) / 'out', law_id).exists())
            self.assertEqual(evidence['forms']['ordin-' + ANNEX_ID]['bodySource'], 'law-service')
            self.assertTrue(evidence['forms']['ordin-' + ANNEX_ID]['lawTitleMatchesScope'])

    def test_annex_binding_does_not_claim_missing_articles_were_read(self):
        payload=service();payload['조문']=''
        with tempfile.TemporaryDirectory() as folder:
            evidence,failures=self.collect(folder,StubPortal({LAW_ID:payload}),[scope_form()],[])
            self.assertEqual(failures,{})
            self.assertEqual(evidence['forms']['ordin-'+ANNEX_ID]['binding'],'bound')
            self.assertEqual(evidence['forms']['ordin-'+ANNEX_ID]['articleContentState'],'missing')
            self.assertEqual(evidence['summary']['laws']['articleContentMissing'],1)
            self.assertEqual(evidence['summary']['laws']['articleContentAvailable'],0)

    def test_max_laws_leaves_the_rest_pending_instead_of_absent(self):
        forms = [scope_form(), scope_form(form_id='ordin-20000001', law_id='2000001',
                                          url=SOURCE_URL.replace(FL_SEQ, '70000001'))]
        portal = StubPortal({LAW_ID: service(), '2000001': service(law_id='2000001')})
        with tempfile.TemporaryDirectory() as folder:
            evidence, failures = self.collect(folder, portal, forms, [], max_laws=1)
            self.assertEqual(len(portal.asked), 1)
            self.assertEqual(evidence['status'], 'partial')
            pending = [row for row in evidence['forms'].values() if row['state'] == 'pending']
            self.assertEqual(len(pending), 1)
            self.assertEqual(pending[0]['reason'], 'SOURCE_FETCH_NOT_ATTEMPTED_MAX_LAWS')
            self.assertEqual(pending[0]['binding'], 'source_unread')
            self.assertEqual(evidence['summary']['bindings']['annex_absent'], 0)
            self.assertIn('2000001', failures)

    def test_resume_retries_failed_sources_without_refetching_stored_bodies(self):
        forms = [scope_form(), scope_form(form_id='ordin-20000001', law_id='2000001',
                                          url=SOURCE_URL.replace(FL_SEQ, '70000001'))]
        bodies = {LAW_ID: service(),
                  '2000001': service(law_id='2000001',
                                     annexes=[annex(annex_id='20000001', fl_seq='70000001')])}
        with tempfile.TemporaryDirectory() as folder:
            first = StubPortal(bodies, fail=['2000001'])
            evidence, failures = self.collect(folder, first, forms, [])
            self.assertEqual(sorted(first.asked), [LAW_ID, '2000001'])
            self.assertEqual(evidence['laws']['2000001']['state'], 'failed')
            self.assertEqual(evidence['laws']['2000001']['reason'], 'PORTAL_HTTP_503')
            self.assertEqual(evidence['forms']['ordin-20000001']['binding'], 'source_unread')
            self.assertEqual(failures['2000001']['attempts'], 1)
            stored = m.body_path(Path(folder) / 'out', LAW_ID)
            marker = stored.stat().st_mtime_ns

            second = StubPortal(bodies)
            evidence, failures = self.collect(folder, second, forms, [], prior_failures=failures)
            self.assertEqual(second.asked, ['2000001'])
            self.assertEqual(stored.stat().st_mtime_ns, marker)
            self.assertEqual(evidence['laws'][LAW_ID]['reason'], 'SOURCE_BODY_ALREADY_STORED')
            self.assertEqual(evidence['forms']['ordin-20000001']['binding'], 'bound')
            self.assertEqual(evidence['summary']['formStates'], {'read': 2, 'failed': 0, 'pending': 0})
            self.assertEqual(failures, {})

    def test_failed_attempts_are_counted_across_runs(self):
        forms = [scope_form()]
        with tempfile.TemporaryDirectory() as folder:
            portal = StubPortal({}, fail=[LAW_ID])
            _, failures = self.collect(folder, portal, forms, [])
            self.assertEqual(failures[LAW_ID]['attempts'], 1)
            _, failures = self.collect(folder, portal, forms, [], prior_failures=failures)
            self.assertEqual(failures[LAW_ID]['attempts'], 2)

    def test_stored_cache_is_reused_instead_of_a_new_request(self):
        forms = [scope_form()]
        with tempfile.TemporaryDirectory() as folder:
            store_cache(Path(folder) / 'cache', '48880|law' + LAW_ID, service())
            portal = StubPortal({})
            evidence, failures = self.collect(folder, portal, forms, [LAW_ID])
            self.assertEqual(portal.asked, [])
            self.assertEqual(evidence['laws'][LAW_ID]['source'], 'law-census-cache')
            self.assertEqual(evidence['laws'][LAW_ID]['reason'],
                             'SOURCE_BODY_REUSED_FROM_LAW_CENSUS_CACHE')
            self.assertEqual(evidence['forms']['ordin-' + ANNEX_ID]['binding'], 'bound')
            self.assertEqual(failures, {})
            self.assertEqual(evidence['summary']['laws']['reusedFromCache'], 1)

    def test_only_missing_defers_reusable_laws_so_a_smoke_touches_new_laws_only(self):
        forms = [scope_form(), scope_form(form_id='ordin-20000001', law_id='2000001',
                                          url=SOURCE_URL.replace(FL_SEQ, '70000001'))]
        with tempfile.TemporaryDirectory() as folder:
            store_cache(Path(folder) / 'cache', '48880|law' + LAW_ID, service())
            portal = StubPortal({'2000001': service(law_id='2000001')})
            evidence, _ = self.collect(folder, portal, forms, [LAW_ID], only_missing=True)
            self.assertEqual(portal.asked, ['2000001'])
            self.assertEqual(evidence['laws'][LAW_ID]['reason'], 'SOURCE_REUSE_DEFERRED_ONLY_MISSING')
            self.assertEqual(evidence['laws'][LAW_ID]['state'], 'pending')
            self.assertFalse(m.body_path(Path(folder) / 'out', LAW_ID).exists())
            self.assertEqual(evidence['status'], 'partial')

    def test_only_missing_fetches_a_present_but_unusable_old_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            store_cache(Path(folder)/'cache','48880|law'+LAW_ID,service(law_id='999999'),law_id=LAW_ID)
            portal=StubPortal({LAW_ID:service()})
            evidence,_=self.collect(folder,portal,[scope_form()],[LAW_ID],only_missing=True)
            self.assertEqual(portal.asked,[LAW_ID])
            self.assertEqual(evidence['forms']['ordin-'+ANNEX_ID]['binding'],'bound')

    def test_refresh_bypasses_both_saved_and_old_census_caches(self):
        with tempfile.TemporaryDirectory() as folder:
            store_cache(Path(folder)/'cache','48880|law'+LAW_ID,service())
            first=StubPortal({LAW_ID:service()})
            self.collect(folder,first,[scope_form()],[LAW_ID])
            second=StubPortal({LAW_ID:service()})
            evidence,_=self.collect(folder,second,[scope_form()],[LAW_ID],refresh=True)
            self.assertEqual(second.asked,[LAW_ID])
            self.assertEqual(evidence['laws'][LAW_ID]['source'],'law-service')

    def test_resume_rejects_a_saved_body_with_a_different_inner_law_id(self):
        with tempfile.TemporaryDirectory() as folder:
            record,_=m.body_record(service(),LAW_ID,source='law-service')
            record['lawService']=service(law_id='999999')
            path=m.body_path(Path(folder)/'out',LAW_ID)
            m.write_gz(path,record,m.Redactor(SECRET))
            self.assertIsNone(m.read_body(path,LAW_ID))
            portal=StubPortal({LAW_ID:service()})
            evidence,_=self.collect(folder,portal,[scope_form()],[])
            self.assertEqual(portal.asked,[LAW_ID])
            self.assertEqual(evidence['forms']['ordin-'+ANNEX_ID]['binding'],'bound')

    def test_public_page_is_consulted_only_when_the_body_lists_no_annex(self):
        forms = [scope_form()]
        html = '<a href="/LSW/flDownload.do?gubun=ELIS&flSeq=' + FL_SEQ + '">별지 제2호서식</a>'
        with tempfile.TemporaryDirectory() as folder:
            portal = StubPortal({LAW_ID: service(annexes=[])}, html={LAW_ID: html})
            evidence, _ = self.collect(folder, portal, forms, [])
            self.assertEqual(portal.html_asked, [LAW_ID])
            self.assertEqual(evidence['forms']['ordin-' + ANNEX_ID]['binding'], 'attachment_only_bound')
            self.assertEqual(evidence['laws'][LAW_ID]['annexSource'], 'public-html')
        with tempfile.TemporaryDirectory() as folder:
            portal = StubPortal({LAW_ID: service()}, html={LAW_ID: html})
            self.collect(folder, portal, forms, [])
            self.assertEqual(portal.html_asked, [])

    def test_authorization_failure_stops_requests_and_leaves_the_rest_pending(self):
        forms = [scope_form(law_id=str(2000000 + index), form_id='ordin-2000000' + str(index),
                            url=SOURCE_URL.replace(FL_SEQ, '7000000' + str(index)))
                 for index in range(1, 5)]
        portal = StubPortal({}, authorization_failure=[str(2000000 + index) for index in range(1, 5)])
        with tempfile.TemporaryDirectory() as folder:
            evidence, failures = m.collect(scope(forms), audit([]), out_dir=Path(folder) / 'out',
                                           portal=portal, redactor=m.Redactor(SECRET),
                                           cache_dir=Path(folder) / 'cache',
                                           downloads_dir=Path(folder) / 'downloads', workers=1)
            self.assertEqual(evidence['status'], 'aborted')
            self.assertEqual(len(portal.asked), 1)
            self.assertEqual(evidence['summary']['formStates']['read'], 0)
            reasons = {row['reason'] for row in evidence['forms'].values()}
            self.assertEqual(reasons, {'PORTAL_AUTHORIZATION_FAILED',
                                       'PORTAL_AUTHORIZATION_FAILED_NOT_ATTEMPTED'})
            self.assertEqual(len(failures), 4)

    def test_downloaded_original_record_is_cross_checked_by_identity(self):
        forms = [scope_form()]
        with tempfile.TemporaryDirectory() as folder:
            downloads = Path(folder) / 'downloads'
            downloads.mkdir()
            (downloads / ('ordin-' + ANNEX_ID + '.json')).write_text(json.dumps(
                {'formId': 'ordin-' + ANNEX_ID, 'state': 'stored', 'sourceUrl': SOURCE_URL,
                 'lawId': LAW_ID, 'sha256': 'a' * 64, 'format': 'hwp', 'textLength': 326},
                ensure_ascii=False), encoding='utf-8')
            evidence, _ = self.collect(folder, StubPortal({LAW_ID: service()}), forms, [])
            original = evidence['forms']['ordin-' + ANNEX_ID]['original']
            self.assertEqual(original['record'], 'stored')
            self.assertTrue(original['sha256Match'] and original['flSeqMatch'] and original['lawIdMatch'])
        with tempfile.TemporaryDirectory() as folder:
            evidence, _ = self.collect(folder, StubPortal({LAW_ID: service()}), forms, [])
            self.assertEqual(evidence['forms']['ordin-' + ANNEX_ID]['original']['record'], 'missing')


class RedactionTest(unittest.TestCase):
    def test_no_written_file_can_carry_the_credential(self):
        leaking = service()
        leaking['자치법규기본정보']['담당부서명'] = '문의 OC=' + SECRET
        leaking['조문']['조'][0]['조내용'] = ARTICLE + ' 조회 키 ' + SECRET
        forms = [scope_form()]

        class Leaky(StubPortal):
            def body(self, target, law_id):
                payload, _ = super().body(target, law_id)
                # 응답이 인증 값을 되돌려 주는 상황. 저장 전에 반드시 가려져야 한다.
                return payload, ('https://www.law.go.kr/DRF/lawService.do?OC=' + SECRET +
                                 '&type=JSON&target=ordin&MST=' + str(law_id))

        with tempfile.TemporaryDirectory() as folder:
            out = Path(folder) / 'out'
            portal = Leaky({LAW_ID: leaking})
            redactor = m.Redactor(SECRET)
            evidence, failures = m.collect(scope(forms), audit([]), out_dir=out, portal=portal,
                                           redactor=redactor, cache_dir=Path(folder) / 'cache',
                                           downloads_dir=Path(folder) / 'downloads', workers=1)
            m.write_json(out / m.EVIDENCE_NAME, evidence, redactor)
            m.write_json(out / m.FAILURES_NAME, failures, redactor)
            body_file = m.body_path(out, LAW_ID)
            stored = gzip.decompress(body_file.read_bytes()).decode('utf-8')
            self.assertNotIn(SECRET, stored)
            self.assertIn('[redacted]', stored)
            self.assertIn(ARTICLE, stored)
            self.assertNotIn(SECRET, (out / m.EVIDENCE_NAME).read_text(encoding='utf-8'))
            self.assertNotIn(SECRET, (out / m.FAILURES_NAME).read_text(encoding='utf-8'))
            self.assertNotIn(SECRET, json.dumps(evidence, ensure_ascii=False))
            self.assertNotIn('OC=' + SECRET, stored)
            self.assertNotIn(SECRET, m.law_service_url(LAW_ID))

    def test_request_url_in_a_reused_cache_is_kept_public_only(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder) / 'cache'
            path = m.cache_file(cache, 'mine')
            path.parent.mkdir(parents=True, exist_ok=True)
            with gzip.open(path, 'wt', encoding='utf-8') as file:
                json.dump({'key': 'mine', 'storedAt': '2026-10-16T00:00:00+00:00',
                           'record': {'id': LAW_ID, 'state': 'read'},
                           'raw': [{'step': 'body',
                                    'url': 'https://private.example.com/x?OC=' + SECRET,
                                    'payload': {'LawService': service()}}]}, file, ensure_ascii=False)
            law = {'lawId': LAW_ID, 'formIds': [], 'scopeTitles': [], 'cacheKeys': ['mine']}
            record, reason = m.reuse_body(law, cache)
            self.assertIsNone(reason)
            self.assertEqual(record['requestUrl'], m.law_service_url(LAW_ID))
            self.assertNotIn(SECRET, json.dumps(record, ensure_ascii=False))


class ScopeTest(unittest.TestCase):
    def test_the_real_scope_file_is_read_whole_and_planned_by_source_law(self):
        data = m.load_scope(m.DEFAULT_SCOPE)
        self.assertEqual(len(data['forms']), data['declaredFormCount'])
        self.assertEqual(data['duplicateFormIds'], 0)
        self.assertTrue(all(form['valid'] for form in data['forms'].values()))
        plan = m.law_plan(data['forms'], {})
        self.assertEqual(sum(len(law['formIds']) for law in plan.values()), len(data['forms']))
        self.assertEqual(len(plan), len({form['lawId'] for form in data['forms'].values()}))

    def test_plan_uses_each_form_own_source_law_not_only_program_citations(self):
        forms = scope([scope_form(), scope_form(form_id='ordin-30000001', law_id='3000001',
                                                url=SOURCE_URL.replace(FL_SEQ, '70000003'))])['forms']
        plan = m.law_plan(forms, audit([LAW_ID]))
        self.assertEqual(sorted(plan), ['1548535', '3000001'])
        self.assertEqual(plan[LAW_ID]['cacheKeys'], ['48880|law' + LAW_ID])
        self.assertEqual(plan['3000001']['cacheKeys'], [])


if __name__ == '__main__':
    unittest.main()

import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('census', ROOT/'scripts/build-form-census.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CensusTest(unittest.TestCase):
    def setUp(self):
        self.programs = {'a': {'id': 'a', 'documents': '관련 서식·안내: 지원신청서.hwp', 'applyType': 'self'},
                         'b': {'id': 'b', 'applyType': 'auto'}, 'c': {'id': 'c', 'applyType': 'institution'}}
        self.matches = {k: {'candidates': []} for k in self.programs}
        self.laws = {'laws': {}, 'programs': {k: {'lawKeys': []} for k in self.programs}}
        self.pages = {'pages': {}, 'programs': {k: {'pageKeys': []} for k in self.programs}}

    def build(self, approved=()):
        return module.aggregate(self.programs, self.matches, set(approved), self.laws, self.pages, '2026-10-16')

    def test_every_record_is_counted_without_claiming_absence(self):
        out = self.build()
        self.assertEqual(set(out['programs']), set(self.programs))
        self.assertEqual(out['programs']['a']['state'], 'document_mentioned')
        self.assertEqual(out['programs']['a']['documentNames'], ['지원신청서.hwp'])
        self.assertEqual(out['programs']['b']['state'], 'automatic')
        self.assertIn('예외 신청', out['programs']['b']['note'])
        self.assertEqual(out['programs']['c']['state'], 'institution')
        self.assertEqual(sum(out['summary']['counts'].values()), 3)
        self.assertEqual(out['summary']['lawBodiesRead'], 0)

    def test_coverage_or_evidence_holes_fail_instead_of_disappearing(self):
        del self.pages['programs']['a']
        with self.assertRaises(ValueError): self.build()
        self.pages['programs']['a'] = {'pageKeys': ['missing']}
        with self.assertRaises(ValueError): self.build()

    def test_partial_network_runs_cannot_be_published_as_a_completed_census(self):
        self.laws['summary']={'pendingQueries':1}
        with self.assertRaisesRegex(ValueError,'pending queries'): self.build()
        self.laws['summary']['pendingQueries']=0
        self.pages['pages']['x']={'status':'pending'}
        with self.assertRaisesRegex(ValueError,'pending requests'): self.build()

    def test_unresolved_citations_are_counted_without_claiming_body_queries(self):
        self.laws['programs']['a']['unresolvedCitations']=[{'citation':'자체계획','reason':'NOT_LAW_SHAPED'}]
        result=self.build()
        self.assertEqual(result['summary']['lawUnresolvedCitations'],1)
        self.assertEqual(result['programs']['a']['lawChecks']['searched'],0)
        self.assertIn('법규명으로 특정하지 못했습니다',result['programs']['a']['note'])

    def test_shared_handbook_is_not_promoted_to_every_programs_application(self):
        self.pages['pages']['x'] = {'status': 'read', 'url': 'https://www.mohw.go.kr/board.es?list_no=1',
            'programSpecific': False, 'attachments': [{'title': '통합돌봄 메뉴판.pdf', 'url': 'https://www.mohw.go.kr/guide.pdf'}]}
        self.pages['programs']['a']['pageKeys'] = ['x']
        out = self.build()
        self.assertEqual(out['programs']['a']['state'], 'document_mentioned')
        self.assertEqual(out['summary']['officialAttachments'], 0)
        self.assertEqual(out['programs']['a']['pageChecks']['read'], 1)

    def test_exact_program_attachment_is_found_but_not_an_approved_form(self):
        self.programs['a']['sources'] = [{'source': 'bokjiro', 'id': 'WLF00000001'}]
        self.pages['pages']['x'] = {'status': 'read', 'url': 'https://www.bokjiro.go.kr/program?id=a',
            'programSpecific': True, 'sourceIdentity': {'provider': 'bokjiro', 'programId': 'WLF00000001', 'kind': 'program'},
            'attachments': [{'title': '지원신청서.hwp', 'url': 'https://www.bokjiro.go.kr/file?id=1'}]}
        self.pages['programs']['a']['pageKeys'] = ['x']
        out = self.build()
        self.assertEqual(out['programs']['a']['state'], 'attachment_found')
        self.assertEqual(out['summary']['officialAttachments'], 1)
        self.assertNotIn('links', out['programs']['a'])
        reviews={'rows':[{'programId':'a','urlHash':module.attachment_url_hash('https://www.bokjiro.go.kr/file?id=1'),
                          'note':'이전 연도 양식이므로 최신 공고 확인 필요.'}]}
        annotated=module.aggregate(self.programs,self.matches,set(),self.laws,self.pages,'2026-10-16',reviews)
        self.assertIn('이전 연도',annotated['programs']['a']['sourceLinks'][0]['note'])
        self.assertEqual(annotated['programs']['a']['state'],'attachment_found')
        self.assertEqual(self.build(['a'])['programs']['a']['state'], 'confirmed')
        self.programs['a']['sources'] = [{'source': 'bokjiro', 'id': 'WLF00000002'}]
        self.assertEqual(self.build()['programs']['a']['state'], 'document_mentioned')

    def test_blocked_host_does_not_claim_individual_request_or_missing_form(self):
        self.pages['pages']['x'] = {'status': 'blocked', 'requestAttempted': False,
            'url': 'https://www.gov.kr/program', 'errorCode': 'blocked_by_host'}
        self.pages['programs']['a']['pageKeys'] = ['x']
        out = self.build()
        self.assertEqual(out['programs']['a']['pageChecks'], {'attempted': 0, 'read': 0, 'failed': 1, 'unattempted': 1})
        self.assertEqual(out['programs']['a']['state'], 'document_mentioned')
        self.assertIn('서식이 없다고 판단한 결과가 아닙니다', out['programs']['a']['note'])

    def test_secret_and_local_links_are_never_public(self):
        for url in ('https://law.go.kr/file?OC=secret', 'http://127.0.0.1/a',
                    'https://user:password@example.go.kr/file', 'file:///private', 'https://localhost/a'):
            self.assertIsNone(module.public_url(url))
        self.assertEqual(module.public_url('https://www.city.go.kr/page?key=123'), 'https://www.city.go.kr/page?key=123')

    def test_no_inputs_mutated(self):
        before = copy.deepcopy((self.programs, self.matches, self.laws, self.pages))
        self.build()
        self.assertEqual(before, (self.programs, self.matches, self.laws, self.pages))

    def test_known_bad_attachment_is_removed_even_when_linked_as_a_source_page(self):
        bad = 'https://www.bokjiro.go.kr/file?atcflId=bad&atcflSn=1'
        good = 'https://www.bokjiro.go.kr/file?atcflId=blank&atcflSn=1'
        self.pages['pages'] = {'source': {'url': 'https://www.bokjiro.go.kr/page', 'status': 'read',
            'attachments': [{'title': '자료', 'url': bad}, {'title': '신청서', 'url': good}]},
            'direct': {'url': bad, 'requestedUrl': bad, 'attachments': []}}
        clean, removed = module.exclude_attachments(self.pages, {'rows': [{'urlHash': module.attachment_url_hash(bad)}]})
        self.assertEqual(removed, 2)
        self.assertNotIn(bad, str(clean))
        self.assertIn(good, str(clean))
        self.assertEqual(clean['pages']['source']['suppressedAttachments'], 1)
        self.assertIn(bad, str(self.pages))

    def test_excluded_redirect_target_is_scrubbed_without_erasing_actual_attempt(self):
        bad='https://www.bokjiro.go.kr/filled.pdf'
        audit={'pages':{'a':{'url':bad,'requestedUrl':'https://www.bokjiro.go.kr/alias',
               'status':'read','requestAttempted':True,'checkedAt':'2026-10-16','attachments':[]}}}
        clean,removed=module.exclude_attachments(audit,{'rows':[{'urlHash':module.attachment_url_hash(bad)}]})
        self.assertEqual(removed,1)
        self.assertNotIn(bad,str(clean))
        self.assertTrue(clean['pages']['a']['requestAttempted'])
        self.assertEqual(clean['pages']['a']['status'],'read')
        self.assertEqual(clean['pages']['a']['checkedAt'],'2026-10-16')

    def test_outdated_gyeryong_copy_is_hidden_while_its_current_law_pdf_remains(self):
        bad='https://www.bokjiro.go.kr/ssis-tbu/twata/CmmFileUtil/getDownload.do?atcflId=20230519UUWBM1000170035340573&atcflSn=1&wlfareInfoId=WLF00002098'
        law='https://www.bokjiro.go.kr/ssis-tbu/twata/CmmFileUtil/getDownload.do?atcflId=20250613UUWBM1503090141957978&atcflSn=1&wlfareInfoId=WLF00002098'
        policy=json.loads((ROOT/'pipeline/forms/attachment-exclusions.json').read_text(encoding='utf-8'))
        audit={'pages':{'p':{'url':'https://www.bokjiro.go.kr/official-page','status':'read',
            'attachments':[{'title':'옛 신청서.hwp','url':bad},{'title':'현행 조례.pdf','url':law}]}}}
        clean,removed=module.exclude_attachments(audit,policy)
        self.assertEqual(removed,1)
        self.assertEqual(clean['pages']['p']['attachments'],[{'title':'현행 조례.pdf','url':law}])
        self.assertEqual(len(audit['pages']['p']['attachments']),2)


if __name__ == '__main__': unittest.main()

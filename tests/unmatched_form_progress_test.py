import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('progress',ROOT/'scripts/update-unmatched-form-progress.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


class ProgressTest(unittest.TestCase):
    def test_a_fresh_checkout_retains_finalized_dispositions_without_private_logs(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);reviews=root/'pipeline/forms/reviews';reviews.mkdir(parents=True)
            path=reviews/'unmatched-dispositions-round1001.json'
            path.write_text(json.dumps({'items':[{'formId':'ordin-1','sha256':'1'*64,
                'disposition':'non_applicant','reason':'원문 전체가 담당자 조사대장으로 신청인 작성 서식이 아닙니다.'}]}),encoding='utf-8')
            reports=[(str(p),m.read(p)) for p in m.review_paths(root) if p.exists()]
            self.assertEqual(m.reconcile(self.scope(),reports,{})['counts'],{'reviewed_not_linked':1,'pending':2})
    def scope(self):
        return {'baselineCommit':'base','forms':[{'formId':f'ordin-{i}','sha256':str(i)*64,'lawId':'10','title':'신청서','format':'hwp'} for i in range(1,4)]}
    def test_download_queue_and_pending_reviews_do_not_become_completed(self):
        result=m.reconcile(self.scope(),[('queue',{'items':[{'formId':'ordin-1','disposition':'pending'}]})],{})
        self.assertEqual(result['counts'],{'pending':3});self.assertFalse(result['fullScopeMatchingComplete'])
    def test_supplemental_pending_originals_are_not_reported_as_reviewed(self):
        report={'items':[{'formId':'ordin-90','disposition':'pending'},
                         {'formId':'ordin-91','disposition':'non_applicant','reason':'별도 담당이 실제 본문을 읽은 기관용 관리대장입니다.'}]}
        result=m.reconcile(self.scope(),[('supplement',report)],{})
        self.assertEqual([x['formId'] for x in result['additionalReviewedIds']],['ordin-91'])
        self.assertEqual(result['counts'],{'pending':3})
    def test_coverage_requires_every_exact_replacement_and_program_to_be_published(self):
        row={'formId':'ordin-1','sha256':'1'*64,'disposition':'covered_by_existing',
             'reason':'같은 신청 목적을 확인한 개별 원본 두 개로 통합 원본의 주민용 부분을 대체합니다.','fullBodyReviewed':True,
             'existingCoverage':[{'formId':'ordin-90','sha256':'a'*64,'programId':'p1'},
                                 {'formId':'ordin-91','sha256':'b'*64,'programIds':['p2']}]}
        complete={'ordin-90':{'sha256':'a'*64,'programIds':['p1']},'ordin-91':{'sha256':'b'*64,'programIds':['p2']}}
        for published in [{},{'ordin-90':complete['ordin-90']},
                          {**complete,'ordin-91':{'sha256':'c'*64,'programIds':['p2']}},
                          {**complete,'ordin-91':{'sha256':'b'*64,'programIds':['different-benefit']}}]:
            result=m.reconcile(self.scope(),[('review',{'items':[row]})],published)
            self.assertEqual(result['forms'][0]['state'],'replacement_available')
            self.assertFalse(result['forms'][0]['review']['coveragePublicationConfirmed'])
        result=m.reconcile(self.scope(),[('review',{'items':[row]})],complete)
        self.assertEqual(result['forms'][0]['state'],'covered_by_existing')
        self.assertTrue(result['forms'][0]['review']['coveragePublicationConfirmed'])
        for changes in [{'existingCoverage':[]},{'fullBodyReviewed':False},{'fullBodyReviewed':'false'}]:
            self.assertEqual(m.reconcile(self.scope(),[('review',{'items':[{**row,**changes}]})],complete)['forms'][0]['state'],'replacement_available')
    def test_approved_requires_a_published_file_and_source_reasons_remain_visible(self):
        rows=[{'formId':'ordin-1','sha256':'1'*64,'disposition':'approved','reason':'해당 조문과 주민 신청서 전체를 읽고 일치함을 확인했다.','fullBodyReviewed':True},
              {'formId':'ordin-2','sha256':'2'*64,'disposition':'non_applicant','reason':'공무원이 보관하는 지급대장으로 대상 주민 신청서가 아니다.'}]
        result=m.reconcile(self.scope(),[('review',{'items':rows})],{})
        self.assertEqual(result['counts'],{'approved_pending_publication':1,'reviewed_not_linked':1,'pending':1})
        result=m.reconcile(self.scope(),[('review',{'items':rows})],{'ordin-1':{'sha256':'1'*64,'programIds':['p1']}})
        self.assertEqual(result['forms'][0]['state'],'linked');self.assertFalse(result['fullScopeMatchingComplete'])
    def test_changed_original_or_a_bare_rejection_does_not_clear_pending(self):
        row={'formId':'ordin-1','sha256':'9'*64,'disposition':'non_applicant','reason':'다른 원본의 조사 결과를 같은 ID로 덮어쓰지 않는다.'}
        with self.assertRaises(ValueError):m.reconcile(self.scope(),[('review',{'items':[row]})],{})
        with self.assertRaises(ValueError):m.reconcile(self.scope(),[('review',{'items':[{**row,'sha256':'1'*64,'reason':''}]})],{})


if __name__=='__main__':unittest.main()

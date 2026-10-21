"""A finalized batch cannot smuggle pending, unread or unapproved associations."""
import copy
import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('completion_import',ROOT/'scripts/import-completed-form-reviews.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class DecisionTest(unittest.TestCase):
    def setUp(self):
        self.assignment={'forms':[{'formId':'ordin-1'},{'formId':'ordin-2'}]}
        self.report={'status':'complete','items':[{'formId':'ordin-1','disposition':'approved','sha256':'a'*64,
            'reason':'실제 신청서 전체와 해당 사업의 제출 절차를 대조했습니다.',
            'fullBodyReviewed':True,'reviewedProgramPairs':[{'programId':'p1','disposition':'approved'}]},
            {'formId':'ordin-2','disposition':'non_applicant','reason':'기관이 작성하는 내부 조사서이며 신청인 작성란은 없습니다.'}]}
        self.review={'rows':[{'formId':'ordin-1','sha256':'a'*64,'programIds':['p1']}]}

    def test_accepts_only_the_reviewed_program_pair(self):
        module.validate_decisions(self.assignment,self.report,self.review)
        self.review['rows'][0]['programIds'].append('similar-program')
        with self.assertRaisesRegex(ValueError,'individually approved'):
            module.validate_decisions(self.assignment,self.report,self.review)

    def test_pending_or_missing_original_cannot_be_imported(self):
        for report in [dict(status='complete',items=self.report['items'][:1]),copy.deepcopy(self.report)]:
            if len(report['items'])==2:report['items'][1]['disposition']='pending'
            with self.assertRaises(ValueError):module.validate_decisions(self.assignment,report,self.review)

    def test_a_filled_draft_is_not_a_finalized_review(self):
        self.report['status']='in_progress'
        with self.assertRaisesRegex(ValueError,'not finalized'):
            module.validate_decisions(self.assignment,self.report,self.review)

    def test_full_body_and_exact_hash_are_required(self):
        for patch in [{'fullBodyReviewed':False},{'sha256':'b'*64}]:
            report=copy.deepcopy(self.report);report['items'][0].update(patch)
            with self.assertRaisesRegex(ValueError,'full-body evidence'):
                module.validate_decisions(self.assignment,report,self.review)

    def test_non_applicant_decision_cannot_become_a_download(self):
        self.review['rows'].append({'formId':'ordin-2','programIds':['p1']})
        with self.assertRaisesRegex(ValueError,'differ'):
            module.validate_decisions(self.assignment,self.report,self.review)

    def test_explicit_decision_label_is_supported_but_conflicts_fail(self):
        pair=self.report['items'][0]['reviewedProgramPairs'][0]
        pair['decision']=pair.pop('disposition')
        module.validate_decisions(self.assignment,self.report,self.review)
        pair['disposition']='pending'
        with self.assertRaisesRegex(ValueError,'Conflicting'):
            module.validate_decisions(self.assignment,self.report,self.review)

    def test_saved_historical_or_future_bodies_do_not_establish_current_forms(self):
        row={'formId':'ordin-1','lawId':'100','sourceUrl':'https://www.law.go.kr/LSW/flDownload.do?flSeq=10'}
        current={'pendingLaws':0,'laws':{'100':{'state':'source_current','currentLawId':'100',
            'forms':{'ordin-1':{'binding':'bound','officialFlSeq':'10','officialAnnexDeleted':False}}}}}
        module.validate_currency(row,current)
        for state in ['future_or_undated_current_result','newer_current_version','failed']:
            bad=copy.deepcopy(current);bad['laws']['100']['state']=state
            with self.subTest(state=state),self.assertRaises(ValueError):module.validate_currency(row,bad)
        for patch in [{'binding':'annex_absent'},{'officialAnnexDeleted':True},{'officialFlSeq':'11'}]:
            bad=copy.deepcopy(current);bad['laws']['100']['forms']['ordin-1'].update(patch)
            with self.subTest(patch=patch),self.assertRaises(ValueError):module.validate_currency(row,bad)


if __name__=='__main__':unittest.main()

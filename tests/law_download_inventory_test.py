import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('law_inventory', ROOT/'scripts/build-law-download-index.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class InventoryReviewTest(unittest.TestCase):
    def row(self, **changes):
        return dict({'sha256': 'a'*64, 'publishedPrograms': []}, **changes)

    def review(self, **changes):
        return dict({'sha256': 'a'*64, 'state': 'reviewed_not_linked',
                     'review': {'disposition': 'non_applicant', 'reason': '담당 공무원의 지급대장으로 주민이 작성하지 않습니다.'}}, **changes)

    def test_saved_and_approved_files_do_not_count_as_published(self):
        self.assertEqual(m.decorate_original(self.row(), None)['reviewState'], 'pending')
        result = m.decorate_original(self.row(), self.review(state='approved_pending_publication'))
        self.assertEqual(result['reviewState'], 'approved_pending_publication')
        self.assertNotEqual(result['reviewLabel'], '혜택에 연결')

    def test_individual_exclusion_reason_remains_visible(self):
        result = m.decorate_original(self.row(), self.review())
        self.assertEqual(result['reviewLabel'], '신청인이 작성하는 서류 아님')
        self.assertIn('지급대장', result['reviewReason'])

    def test_review_for_other_bytes_never_marks_this_original_reviewed(self):
        result = m.decorate_original(self.row(), self.review(sha256='b'*64))
        self.assertEqual(result['reviewState'], 'needs_confirmation')
        self.assertNotIn('지급대장', result['reviewReason'])
        result = m.decorate_original({'publishedPrograms': []}, {'state': 'reviewed_not_linked'})
        self.assertEqual(result['reviewState'], 'needs_confirmation')

    def test_actual_publication_does_not_display_a_stale_exclusion(self):
        result = m.decorate_original(self.row(publishedPrograms=[{'id': 'g1', 'name': '혜택'}]), self.review())
        self.assertEqual(result['reviewState'], 'linked')
        self.assertEqual(result['reviewReason'], '')

    def test_stale_linked_state_without_actual_links_requires_confirmation(self):
        result = m.decorate_original(self.row(), self.review(state='linked'))
        self.assertEqual(result['reviewState'], 'needs_confirmation')

    def test_all_frozen_scopes_retain_reasons_without_private_logs(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root/'scripts').mkdir()
            (root/'scripts/update-unmatched-form-progress.py').write_bytes((ROOT/'scripts/update-unmatched-form-progress.py').read_bytes())
            reviews = root/'pipeline/forms/reviews'
            reviews.mkdir(parents=True)
            for index, (scope_name, report_name) in enumerate([
                ('unmatched-originals-scope.json', 'unmatched-dispositions-round1001.json'),
                ('prior-edition-originals-scope.json', 'prior-edition-dispositions-team3.json'),
                ('current-replacement-originals-scope.json', 'current-replacement-dispositions-round2070.json'),
                ('agency-originals-scope.json', 'agency-dispositions-round7001.json'),
            ], 1):
                original = {'formId': 'agency-44250-36032' if index == 4 else f'ordin-{index}', 'sha256': str(index)*64,
                            'lawId': str(index), 'title': '공식 별지', 'format': 'hwp'}
                (reviews/scope_name).write_text(json.dumps({'baselineCommit': 'fixture', 'forms': [original]}), encoding='utf-8')
                (reviews/report_name).write_text(json.dumps({'items': [{**original,
                    'disposition': 'non_applicant', 'fullBodyReviewed': True,
                    'reason': f'기관 작성 대장으로 개별 검토한 원본{index}입니다.'}]}), encoding='utf-8')
            result = m.inventory_reviews(root, {})
            self.assertEqual(set(result), {'ordin-1', 'ordin-2', 'ordin-3', 'agency-44250-36032'})
            self.assertTrue(all(x['state'] == 'reviewed_not_linked' for x in result.values()))
            self.assertIn('원본3', result['ordin-3']['review']['reason'])
            self.assertIn('원본4', result['agency-44250-36032']['review']['reason'])


if __name__ == '__main__':
    unittest.main()

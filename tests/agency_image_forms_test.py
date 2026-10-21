"""A reviewed whole-image agency original is accepted only for these exact JPEG bytes."""
import copy
import hashlib
import importlib.util
import json
import unittest
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
IMAGE = ROOT/'tests/fixtures/forms/bucheon-school-uniform-application.jpg'
REVIEW = ROOT/'tests/fixtures/forms/bucheon-school-uniform-image-review.json'
SHA = '8ae64f84823eadcfd2cbe87a917625d34e97fcbc64170a4e2cc987ee3417f395'
HWP_ID = 'agency-44250-36032'


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/file)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


prepare = module('agency_image_prepare', 'prepare-portal-reviews.py')
download = module('agency_image_download', 'download-law-form-files.py')
PACKET = json.loads(REVIEW.read_text(encoding='utf-8'))
ENTRY = PACKET['entry']
ROW = PACKET['row']
FID = ENTRY['id']
BYTES = IMAGE.read_bytes()


@contextmanager
def registered(entry):
    """Patch every independently loaded agency registry, then put the previous id back."""
    stored = copy.deepcopy(entry)
    seen = []
    for reg in (prepare.agency.REGISTRY, download.agency.REGISTRY):
        if all(reg is not item for item in seen):seen.append(reg)
    with ExitStack() as stack:
        for reg in seen:stack.enter_context(patch.dict(reg, {FID: stored}))
        yield stored


def review(row):
    return prepare.agency.prepare_review(row, download.inspect_document)


class AgencyImageFormsTest(unittest.TestCase):
    def tearDown(self):
        self.assertEqual(IMAGE.stat().st_size, 101647)
        self.assertEqual(hashlib.sha256(IMAGE.read_bytes()).hexdigest(), SHA)

    def test_actual_blank_jpeg_is_accepted_with_empty_text_and_decoded_pixels(self):
        self.assertEqual(len(BYTES), 101647)
        self.assertEqual(hashlib.sha256(BYTES).hexdigest(), SHA)
        info = download.inspect_document(BYTES)
        self.assertEqual(info, {'format': 'jpg', 'sectionsRead': ['frame-1'], 'text': '', 'textLength': 0,
            'textScope': 'all_original_image_frames', 'imageWidth': 589, 'imageHeight': 835, 'imageFrames': 1})
        was = FID in prepare.agency.REGISTRY
        with registered(ENTRY):
            got, meta = review(copy.deepcopy(ROW))
        self.assertEqual(got['id'], FID)
        self.assertEqual(got['format'], 'jpg')
        self.assertEqual(got['sha256'], SHA)
        self.assertEqual((got['visualReview']['width'], got['visualReview']['height'], got['visualReview']['frames']), (589, 835, 1))
        self.assertIs(got['visualReview']['blankApplicantForm'], True)
        self.assertIs(got['visualReview']['noFilledPersonalData'], True)
        self.assertEqual(meta['sectionsRead'], ['frame-1'])
        self.assertEqual(meta['sha256'], SHA)
        self.assertTrue(meta['fullBodyReviewed'])
        self.assertEqual(FID in prepare.agency.REGISTRY, was)
        if not was:
            with self.assertRaisesRegex(ValueError, 'unregistered_agency_form'):review(copy.deepcopy(ROW))

    def test_missing_false_or_unbound_visual_review_is_rejected(self):
        missing = copy.deepcopy(ENTRY); del missing['visualReview']
        explicit_null = copy.deepcopy(ENTRY); explicit_null['visualReview'] = None
        cases = [('missing', missing, 'image_original_lacks_whole_image_review'),
                 ('null', explicit_null, 'invalid_whole_image_review')]
        for name, entry, pattern in cases:
            with self.subTest(name=name), registered(entry), self.assertRaisesRegex(ValueError, pattern):
                review(copy.deepcopy(ROW))
        for change in ({'blankApplicantForm': False}, {'noFilledPersonalData': False},
                       {'checkedAt': '2026-10-18'}, {'sha256': 'ab'*32}, {'frames': 2},
                       {'kind': 'preview'}, {'evidenceNote': '원본을 봤다'}, {'width': 10000, 'height': 5001}):
            entry = copy.deepcopy(ENTRY); entry['visualReview'].update(change)
            with self.subTest(change=sorted(change)), registered(entry), self.assertRaisesRegex(ValueError, 'invalid_whole_image_review'):
                review(copy.deepcopy(ROW))
        extra = copy.deepcopy(ENTRY); extra['visualReview']['viewer'] = 'person'
        with registered(extra), self.assertRaisesRegex(ValueError, 'invalid_whole_image_review'):
            review(copy.deepcopy(ROW))
        for key, value in (('textScope', 'all_body_sections_or_pages'), ('sectionsRead', ['frame-2']),
                           ('sectionsRead', ['frame-1', 'frame-2'])):
            entry = copy.deepcopy(ENTRY); entry[key] = value
            with self.subTest(key=key, value=value), registered(entry), self.assertRaisesRegex(ValueError, 'invalid_whole_image_review'):
                review(copy.deepcopy(ROW))
        with registered(ENTRY):
            for key, value in (('visualReview', None), ('sectionsRead', ['frame-2']), ('textScope', 'all_body_sections_or_pages')):
                row = copy.deepcopy(ROW)
                if key == 'visualReview':del row['visualReview']
                else:row[key] = value
                with self.subTest(row=key), self.assertRaisesRegex(ValueError, 'agency_review_lacks_exact_full_body_evidence'):
                    review(row)
            row = copy.deepcopy(ROW); row['visualReview']['blankApplicantForm'] = False
            with self.assertRaisesRegex(ValueError, 'agency_review_lacks_exact_full_body_evidence'):review(row)
            row = copy.deepcopy(ROW); row['visualReview']['noFilledPersonalData'] = False
            with self.assertRaisesRegex(ValueError, 'agency_review_lacks_exact_full_body_evidence'):review(row)

    def test_wrong_pixels_and_changed_bytes_fail_against_the_actual_jpeg(self):
        for key, value in (('width', 588), ('height', 834)):
            entry = copy.deepcopy(ENTRY); entry['visualReview'][key] = value
            row = copy.deepcopy(ROW); row['visualReview'] = copy.deepcopy(entry['visualReview'])
            with self.subTest(key=key), registered(entry), self.assertRaisesRegex(ValueError, 'agency_image_original_differs_from_whole_image_review'):
                review(row)
        real = prepare.agency.Path.read_bytes
        def tampered(path):
            data = real(path)
            return data+b'changed' if path.name == IMAGE.name else data
        with registered(ENTRY), patch.object(prepare.agency.Path, 'read_bytes', tampered):
            with self.assertRaisesRegex(ValueError, 'agency_original_bytes_or_full_body_mismatch'):
                review(copy.deepcopy(ROW))

    def test_zero_sha_is_registry_syntax_but_not_this_file(self):
        # 64 zeros are a legal hash spelling. The ban is the real JPEG, not the registry grammar.
        entry = copy.deepcopy(ENTRY)
        entry['sha256'] = '0'*64
        entry['visualReview']['sha256'] = '0'*64
        row = copy.deepcopy(ROW)
        row['sha256'] = '0'*64
        row['visualReview'] = copy.deepcopy(entry['visualReview'])
        with registered(entry):
            self.assertEqual(prepare.agency.registry_entry(FID)['sha256'], '0'*64)
            with self.assertRaisesRegex(ValueError, 'agency_original_bytes_or_full_body_mismatch'):review(row)

    def test_hwp_cannot_carry_a_visual_claim_and_unknown_id_is_refused(self):
        base = copy.deepcopy(prepare.agency.REGISTRY[HWP_ID])
        self.assertEqual(base.get('format'), 'hwp')
        self.assertNotIn('visualReview', base)
        for claim in (copy.deepcopy(ENTRY['visualReview']), None):
            entry = copy.deepcopy(base); entry['visualReview'] = claim
            row = copy.deepcopy(ROW); row['formId'] = HWP_ID
            with self.subTest(claim=claim is None), patch.dict(prepare.agency.REGISTRY, {HWP_ID: entry}):
                with self.assertRaisesRegex(ValueError, 'invalid_whole_image_review'):review(row)
        self.assertNotIn('visualReview', prepare.agency.REGISTRY[HWP_ID])
        row = copy.deepcopy(ROW); row['formId'] = 'agency-41190-not-registered'
        with self.assertRaisesRegex(ValueError, 'unregistered_agency_form'):review(row)

    def response(self, url, status=200, location=None, data=BYTES):
        response = Mock(); response.url = url; response.status_code = status
        response.headers = {'Location': location} if location else {}
        response.iter_content.return_value = [data]
        response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
        return response

    def test_get_agency_returns_the_actual_bytes_only_from_the_fixed_source(self):
        source = ENTRY['sourceUrl']
        foreign = 'https://evil.example/uniform.jpg'
        with registered(ENTRY):
            with patch.object(download.requests, 'get', return_value=self.response(source)) as get:
                self.assertEqual(download.Download(0, 1).get_agency(FID), BYTES)
                self.assertEqual(get.call_count, 1)
                self.assertEqual(get.call_args.args[0], source)
                self.assertFalse(get.call_args.kwargs['allow_redirects'])
            with patch.object(download.requests, 'get', return_value=self.response(source, 302, foreign)) as get:
                with self.assertRaisesRegex(ValueError, 'unregistered_agency_redirect'):
                    download.Download(0, 1).get_agency(FID)
                self.assertEqual(get.call_count, 1)
                self.assertEqual(get.call_args.args[0], source)
            with patch.object(download.requests, 'get', return_value=self.response(source, data=BYTES+b'changed')):
                with self.assertRaises(ValueError):download.Download(0, 1).get_agency(FID)
        with patch.object(download.requests, 'get') as get, self.assertRaisesRegex(ValueError, 'unregistered_agency_form'):
            download.Download(0, 1).get_agency('agency-41190-not-registered')
        get.assert_not_called()


if __name__ == '__main__':unittest.main()

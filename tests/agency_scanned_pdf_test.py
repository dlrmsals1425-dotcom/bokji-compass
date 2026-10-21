"""A reviewed whole-original scanned PDF is accepted only for exactly the pages that were read.

The case this gate exists for is the three-page Pyeongtaek Songtan 행려자 귀향여비
신청서 및 동의서 scan (the municipality's own blank application, consent and
receipt pages, no text layer at all). These tests build minimal blank PDF bytes
only to exercise the structural validation. The actual municipal original is
registered separately with its own SHA, byte length, page count and source
review, and its real download is checked by the browser tests. Test bytes never
replace a published original.
"""
import copy
import hashlib
import importlib.util
import shutil
import tempfile
import unittest
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
IMAGE_ID = 'agency-41190-school-uniform-jpg'
HWP_ID = 'agency-44250-36032'
PAGE_URL = 'https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=WLF00000783&wlfareInfoReldBztpCd=02'
ATTACHMENT = '20230525UUWBM1328390036214748'
FILE_URL = f'https://www.bokjiro.go.kr/ssis-tbu/twata/CmmFileUtil/getDownload.do?atcflId={ATTACHMENT}&atcflSn=1&wlfareInfoId=WLF00000783'
NOTE = ('구조 검증 테스트용으로 생성한 빈 PDF의 검토 메타데이터이며 실제 공개 승인 근거가 아니다. '
        '실제 송탄 원본의 1쪽 동의서·2쪽 신청서·3쪽 영수증은 별도의 원본 SHA와 전체 시각 검토로 확인한다.')


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/file)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


prepare = module('agency_pdf_prepare', 'prepare-portal-reviews.py')
download = module('agency_pdf_download', 'download-law-form-files.py')


def generated_pdf(pages, text=None):
    """Minimal blank PDF bytes for structural tests only — never a published original.

    Pages carry no content stream unless a text layer is asked for, so the real
    reader extracts nothing from them, exactly like a scan without a text layer.
    """
    stream = f'BT /F1 12 Tf 72 720 Td ({text}) Tj ET' if text is not None else None
    extra = f' /Contents {pages+3} 0 R /Resources << /Font << /F1 {pages+4} 0 R >> >>' if stream else ''
    objects = ['<< /Type /Catalog /Pages 2 0 R >>',
               '<< /Type /Pages /Kids [%s] /Count %d >>' % (' '.join(f'{i+3} 0 R' for i in range(pages)), pages)]
    objects += [f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]{extra} >>'] * pages
    if stream:
        objects.append(f'<< /Length {len(stream)} >>\nstream\n{stream}\nendstream')
        objects.append('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    out = bytearray(b'%PDF-1.4\n')
    offsets = []
    for number, content in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f'{number} 0 obj\n{content}\nendobj\n'.encode('latin-1')
    start = len(out)
    out += f'xref\n0 {len(objects)+1}\n'.encode() + b'0000000000 65535 f \n'
    for offset in offsets:out += b'%010d 00000 n \n' % offset
    out += f'trailer\n<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode()
    return bytes(out)


BLANK = generated_pdf(3)
BLANK_SHA = hashlib.sha256(BLANK).hexdigest()
TEXTFUL = generated_pdf(3, 'blank sample body line')
TEXTFUL_SHA = hashlib.sha256(TEXTFUL).hexdigest()
# A test-only placeholder for the reviewed page's hash. The real one belongs to
# the registered row that root adds, and is never guessed here.
PAGE_SHA = hashlib.sha256(b'generated-structural-sample-page').hexdigest()
FID = 'agency-41220-songtan-return-fare-pdf'
PAGES = ['page-1', 'page-2', 'page-3']
PARTS = [{'number': '1', 'title': '행려자 귀향여비 신청서', 'use': 'main', 'author': '신청인 본인'},
         {'number': '2', 'title': '개인정보 수집·이용 동의서', 'use': 'additional', 'author': '신청인 본인'},
         {'number': '3', 'title': '귀향여비 수령 영수증', 'use': 'additional', 'author': '신청인 본인'}]


def entry_for(data, sha):
    return {
        'id': FID, 'sourceKind': 'agency', 'title': '행려자 귀향여비 신청서 및 동의서', 'role': 'application', 'use': 'main',
        'regionCode': '41220', 'regionLabel': '경기도 평택시', 'agencyName': '경기도 평택시 송탄출장소(복지로 공식 배포)',
        'authorityKind': 'government', 'authorityEvidenceKind': 'government', 'authorityEvidenceUrl': PAGE_URL,
        'authorityEvidenceNote': NOTE, 'sourcePageUrl': PAGE_URL, 'sourceUrl': FILE_URL, 'finalUrl': FILE_URL,
        'attachmentId': ATTACHMENT, 'attachmentIdentifier': {'queryParam': 'atcflId', 'value': ATTACHMENT},
        'checkedAt': '2026-10-19', 'sha256': sha, 'bytes': len(data),
        'lawId': '', 'lawTitle': '', 'lawEvidenceUrl': '', 'lawEffectiveDate': '', 'lawCurrentCheckedAt': '',
        'sectionsRead': list(PAGES), 'textScope': 'all_body_sections_or_pages',
        'selectedParts': copy.deepcopy(PARTS), 'applicant': '신청인 본인',
        'authorityBasis': {'kind': 'official-program', 'title': '행려자 귀향여비 지원', 'evidenceUrl': PAGE_URL,
                           'checkedAt': '2026-10-19', 'evidenceNote': NOTE, 'pageSHA256': PAGE_SHA},
        'visualReview': {'kind': 'whole-original-pdf', 'checkedAt': '2026-10-19', 'sha256': sha,
                         'pageCount': 3, 'pagesRead': list(PAGES), 'blankApplicantForm': True,
                         'noFilledPersonalData': True, 'evidenceNote': NOTE},
        'format': 'pdf', 'programs': [{'id': 'g41220.bokjiro-WLF00000783', 'url': PAGE_URL}],
    }


def row_for(entry, path):
    row = {k: copy.deepcopy(entry[k]) for k in ('sourceKind', 'sourcePageUrl', 'sourceUrl', 'finalUrl', 'attachmentId',
        'agencyName', 'authorityKind', 'authorityEvidenceKind', 'authorityEvidenceUrl', 'authorityEvidenceNote',
        'lawId', 'lawTitle', 'lawEvidenceUrl', 'lawEffectiveDate', 'lawCurrentCheckedAt', 'regionCode', 'regionLabel',
        'sha256', 'bytes', 'checkedAt', 'textScope', 'sectionsRead', 'applicant', 'role', 'use',
        'authorityBasis', 'selectedParts')}
    row['visualReview'] = copy.deepcopy(entry.get('visualReview'))
    row.update(formId=entry['id'], formTitle=entry['title'], originalFormat=entry['format'], publishedAt=None,
               dateKind='checked', effectiveDate=entry['checkedAt'], reviewedParts=copy.deepcopy(entry['selectedParts']),
               annexId='', annexNumber='', lawUrl='', roleEvidenceUrl=entry['sourceUrl'], roleCheckedAt=entry['checkedAt'],
               verificationStatus='verified', officialAttachmentMatched=True, fullBodyReviewed=True,
               blankApplicantFormReviewed=True, roleBasis=NOTE, evidenceNote=NOTE,
               programIds=[p['id'] for p in entry['programs']], programEvidenceUrl=entry['programs'][0]['url'],
               originalPath=path)
    return row


@contextmanager
def registered(entry, form_id=FID):
    """Patch every independently loaded agency registry, then put the previous id back."""
    stored = copy.deepcopy(entry)
    seen = []
    for reg in (prepare.agency.REGISTRY, download.agency.REGISTRY):
        if all(reg is not item for item in seen):seen.append(reg)
    with ExitStack() as stack:
        for reg in seen:stack.enter_context(patch.dict(reg, {form_id: stored}))
        yield stored


class AgencyScannedPdfTest(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp(prefix='.agency-pdf-test-', dir=ROOT))
        self.addCleanup(self.clean)
        self.relative = f'{self.directory.name}/{FID}.pdf'
        self.write(BLANK)

    def clean(self):
        resolved = self.directory.resolve()
        if resolved.parent != ROOT.resolve() or not resolved.name.startswith('.agency-pdf-test-'):
            raise AssertionError('unexpected cleanup target')
        shutil.rmtree(resolved, ignore_errors=True)

    def write(self, data):
        (self.directory/f'{FID}.pdf').write_bytes(data)

    def review(self, row):
        return prepare.agency.prepare_review(row, download.inspect_document)

    def test_blank_three_page_scan_is_accepted_with_empty_text_and_every_page_read(self):
        info = download.inspect_document(BLANK)
        self.assertEqual(info, {'format': 'pdf', 'sectionsRead': PAGES, 'text': '', 'textLength': 0,
                                'textScope': 'all_body_sections_or_pages'})
        entry = entry_for(BLANK, BLANK_SHA)
        row = row_for(entry, self.relative)
        with registered(entry):
            got, meta = self.review(copy.deepcopy(row))
            metadata = prepare.agency.agency_metadata(prepare.agency.registry_entry(FID))
        self.assertEqual(got['format'], 'pdf')
        self.assertEqual(got['visualReview']['kind'], 'whole-original-pdf')
        self.assertEqual(got['visualReview']['pageCount'], 3)
        self.assertEqual(got['visualReview']['pagesRead'], PAGES)
        self.assertIs(got['visualReview']['blankApplicantForm'], True)
        self.assertIs(got['visualReview']['noFilledPersonalData'], True)
        self.assertEqual(got['textScope'], 'all_body_sections_or_pages')
        self.assertEqual(meta['sectionsRead'], PAGES)
        self.assertEqual(meta['sha256'], BLANK_SHA)
        self.assertTrue(meta['fullBodyReviewed'])
        # Only the page-based keys are published, and the frame keys never appear.
        self.assertEqual(set(metadata['visualReview']), set(prepare.agency.PDF_REVIEW_FIELDS))
        self.assertNotIn('width', metadata['visualReview'])
        self.assertNotIn(FID, prepare.agency.REGISTRY)

    def test_textful_pdf_still_proves_itself_by_its_own_body_text(self):
        plain = entry_for(TEXTFUL, TEXTFUL_SHA)
        del plain['visualReview']
        self.write(TEXTFUL)
        with registered(plain):
            got, meta = self.review(row_for(plain, self.relative))
        self.assertNotIn('visualReview', got)
        self.assertEqual(meta['sectionsRead'], PAGES)
        # The same textful PDF may not borrow the scanned-page exception.
        claimed = entry_for(TEXTFUL, TEXTFUL_SHA)
        with registered(claimed), self.assertRaisesRegex(ValueError, 'agency_pdf_original_differs_from_whole_pdf_review'):
            self.review(row_for(claimed, self.relative))

    def test_blank_scan_without_a_registered_page_review_is_not_published(self):
        bare = entry_for(BLANK, BLANK_SHA)
        del bare['visualReview']
        with registered(bare), self.assertRaisesRegex(ValueError, 'agency_original_bytes_or_full_body_mismatch'):
            self.review(row_for(bare, self.relative))

    def test_partial_false_or_unbound_page_review_is_rejected(self):
        entry = entry_for(BLANK, BLANK_SHA)
        row = row_for(entry, self.relative)
        for change in ({'pagesRead': ['page-1', 'page-2']}, {'pagesRead': ['page-1', 'page-2', 'page-4']},
                       {'pagesRead': ['page-2', 'page-1', 'page-3']}, {'pagesRead': ['page-1', 'page-1', 'page-1']},
                       {'pageCount': 0}, {'pageCount': 3.0}, {'pageCount': '3'}, {'pageCount': True},
                       {'pageCount': 2, 'pagesRead': ['page-1', 'page-2']},
                       {'blankApplicantForm': False}, {'noFilledPersonalData': False},
                       {'checkedAt': '2026-10-18'}, {'sha256': 'ab'*32}, {'kind': 'preview'},
                       {'evidenceNote': '모든 페이지를 봤다'}):
            changed = copy.deepcopy(entry); changed['visualReview'].update(change)
            with self.subTest(change=sorted(change)), registered(changed), self.assertRaises(ValueError) as caught:
                self.review(copy.deepcopy(row))
            self.assertRegex(str(caught.exception), 'invalid_whole_(pdf|image)_review')
        for change in ({'frames': 1}, {'width': 589}):
            extra = copy.deepcopy(entry); extra['visualReview'].update(change)
            with self.subTest(extra=sorted(change)), registered(extra), self.assertRaisesRegex(ValueError, 'invalid_whole_pdf_review'):
                self.review(copy.deepcopy(row))
        for key in ('pagesRead', 'pageCount', 'sha256', 'evidenceNote'):
            missing = copy.deepcopy(entry); del missing['visualReview'][key]
            with self.subTest(missing=key), registered(missing), self.assertRaisesRegex(ValueError, 'invalid_whole_pdf_review'):
                self.review(copy.deepcopy(row))
        for value in (None, [], 'read every page'):
            claim = copy.deepcopy(entry); claim['visualReview'] = value
            with self.subTest(claim=type(value).__name__), registered(claim), self.assertRaises(ValueError) as caught:
                self.review(copy.deepcopy(row))
            self.assertRegex(str(caught.exception), 'invalid_whole_(pdf|image)_review')
        for key, value in (('textScope', 'all_original_image_frames'), ('sectionsRead', ['page-1', 'page-2']),
                           ('sectionsRead', ['page-1', 'page-2', 'page-3', 'page-4']), ('sectionsRead', ['frame-1'])):
            changed = copy.deepcopy(entry); changed[key] = value
            with self.subTest(entry=key, value=value), registered(changed), self.assertRaisesRegex(ValueError, 'invalid_whole_pdf_review'):
                self.review(copy.deepcopy(row))
        with registered(entry):
            for key, value in (('visualReview', None), ('textScope', 'all_original_image_frames'),
                               ('sectionsRead', ['page-1', 'page-2'])):
                broken = copy.deepcopy(row)
                if key == 'visualReview':del broken['visualReview']
                else:broken[key] = value
                with self.subTest(row=key), self.assertRaisesRegex(ValueError, 'agency_review_lacks_exact_full_body_evidence'):
                    self.review(broken)
            for key in ('blankApplicantForm', 'noFilledPersonalData'):
                broken = copy.deepcopy(row); broken['visualReview'][key] = False
                with self.subTest(row_flag=key), self.assertRaisesRegex(ValueError, 'agency_review_lacks_exact_full_body_evidence'):
                    self.review(broken)

    def test_changed_bytes_and_a_different_page_count_fail_against_the_actual_pdf(self):
        entry = entry_for(BLANK, BLANK_SHA)
        row = row_for(entry, self.relative)
        self.write(BLANK + b'changed')
        with registered(entry), self.assertRaisesRegex(ValueError, 'agency_original_bytes_or_full_body_mismatch'):
            self.review(copy.deepcopy(row))
        two = generated_pdf(2)
        self.write(two)
        shifted = entry_for(two, hashlib.sha256(two).hexdigest())
        with registered(shifted), self.assertRaisesRegex(ValueError, 'agency_original_bytes_or_full_body_mismatch'):
            self.review(row_for(shifted, self.relative))
        # The actual two-page document cannot answer a three-page review.
        self.assertEqual(download.inspect_document(two)['sectionsRead'], ['page-1', 'page-2'])

    def test_neither_format_can_claim_the_other_kind_of_whole_original_review(self):
        image = copy.deepcopy(prepare.agency.REGISTRY[IMAGE_ID])
        self.assertEqual(image['format'], 'jpg')
        self.assertEqual(image['visualReview']['kind'], 'whole-original-image')
        page_claim = entry_for(BLANK, BLANK_SHA)['visualReview']
        for form_id, base in ((IMAGE_ID, image), (HWP_ID, copy.deepcopy(prepare.agency.REGISTRY[HWP_ID]))):
            claimed = copy.deepcopy(base); claimed['visualReview'] = copy.deepcopy(page_claim)
            with self.subTest(format=base['format']), registered(claimed, form_id), self.assertRaises(ValueError) as caught:
                prepare.agency.registry_entry(form_id)
            self.assertRegex(str(caught.exception), 'invalid_whole_(pdf|image)_review')
        frames = entry_for(BLANK, BLANK_SHA)
        frames['visualReview'] = copy.deepcopy(image['visualReview'])
        frames['visualReview'].update(sha256=BLANK_SHA, checkedAt=frames['checkedAt'])
        with registered(frames), self.assertRaisesRegex(ValueError, 'invalid_whole_image_review'):
            prepare.agency.registry_entry(FID)
        self.assertEqual(prepare.agency.REGISTRY[IMAGE_ID]['visualReview']['kind'], 'whole-original-image')
        self.assertNotIn('visualReview', prepare.agency.REGISTRY[HWP_ID])

    def response(self, url, data, status=200, location=None):
        response = Mock(); response.url = url; response.status_code = status
        response.headers = {'Location': location} if location else {}
        response.iter_content.return_value = [data]
        response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
        return response

    def test_get_agency_accepts_the_reviewed_scan_only_from_the_registered_source(self):
        entry = entry_for(BLANK, BLANK_SHA)
        with registered(entry):
            with patch.object(download.requests, 'get', return_value=self.response(FILE_URL, BLANK)) as get:
                self.assertEqual(download.Download(0, 1).get_agency(FID), BLANK)
                self.assertEqual(get.call_args.args[0], FILE_URL)
                self.assertFalse(get.call_args.kwargs['allow_redirects'])
            with patch.object(download.requests, 'get', return_value=self.response(FILE_URL, BLANK, 302, 'https://evil.example/fare.pdf')):
                with self.assertRaisesRegex(ValueError, 'unregistered_agency_redirect'):
                    download.Download(0, 1).get_agency(FID)
            with patch.object(download.requests, 'get', return_value=self.response(FILE_URL, TEXTFUL)):
                with self.assertRaises(ValueError):download.Download(0, 1).get_agency(FID)


if __name__ == '__main__':unittest.main()

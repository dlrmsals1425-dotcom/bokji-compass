"""Agency integration stays exact and never expands existing portal policies."""
import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/file)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


prepare = module('agency_test_prepare', 'prepare-portal-reviews.py')
download = module('agency_test_download', 'download-law-form-files.py')
FID = 'agency-44250-36032'
ROW = json.loads((ROOT/'tests/fixtures/forms/agency-44250-36032-review.json').read_text(encoding='utf-8'))['rows'][0]
BYTES = (ROOT/ROW['originalPath']).read_bytes()
PROGRAM = {'id': ROW['programIds'][0], 'name': '화장장려금 지원', 'scope': 'sigungu',
           'region': {'sido': '44000', 'sigungu': '44250'}, 'url': ROW['programEvidenceUrl'], 'laws': [ROW['lawTitle']]}
# 공식 신청 안내를 근거로 등록한 경우를 시험하는 합성 등록분. 실제 원문 바이트와 같은
# 첨부를 쓰고 자료로 공개하지 않는다(시험 중에만 REGISTRY에 끼워 넣는다).
BASIS_ID = 'agency-44250-36032-notice'
BASIS = {'kind': 'official-program', 'title': '계룡시 화장장려금 지원 신청 안내',
         'evidenceUrl': ROW['sourcePageUrl'], 'checkedAt': ROW['checkedAt'],
         'evidenceNote': '안내문의 처리절차는 신청인이 이 첨부 서식을 작성해 가족돌봄과에 제출하는 단계이며, 첨부 36032는 그 신청에 쓰는 신청서다.',
         'pageSHA256': 'a'*64}
EMPTY_LAW = {'lawId': '', 'lawTitle': '', 'lawEvidenceUrl': '', 'lawEffectiveDate': '', 'lawCurrentCheckedAt': ''}


def official_entry():
    entry = copy.deepcopy(prepare.agency.REGISTRY[FID])
    entry.update(id=BASIS_ID, authorityBasis=copy.deepcopy(BASIS), **EMPTY_LAW)
    return entry


def official_row():
    row = copy.deepcopy(ROW)
    row.update(formId=BASIS_ID, authorityBasis=copy.deepcopy(BASIS), **EMPTY_LAW)
    return row


class AgencyFormsTest(unittest.TestCase):
    def build(self, row=None, program=None):
        row = row or copy.deepcopy(ROW); program = program or copy.deepcopy(PROGRAM)
        with tempfile.TemporaryDirectory(prefix='agency-review-') as folder:
            file = Path(folder)/'review.json'; file.write_text(json.dumps({'rows': [row]}), encoding='utf-8')
            return prepare.build({program['id']: program}, [file])

    def build_official(self, entry=None, row=None):
        with patch.dict(prepare.agency.REGISTRY, {BASIS_ID: entry or official_entry()}):
            return self.build(row if row is not None else official_row())

    def test_actual_blank_original_passes_without_inventing_portal_annex(self):
        result = self.build(); form = result['forms'][FID]
        self.assertEqual(form['sourceKind'], 'agency')
        self.assertEqual(form['dateKind'], 'published')
        self.assertEqual(form['effectiveDate'], '2026-05-12')
        self.assertEqual(form['lawUrl'], ROW['lawEvidenceUrl'])
        self.assertEqual((form['annexId'], form['annexNumber']), ('', ''))
        self.assertEqual(result['auditedRoles'][FID]['sectionsRead'], ['BodyText/Section0'])
        download.agency.verify_original(FID, BYTES, download.inspect_document(BYTES))

    def test_source_identity_and_sha_cannot_be_swapped(self):
        for key, value in [('formId', 'agency-44250-999'), ('sourceUrl', ROW['sourceUrl']+'&other=1'),
                           ('finalUrl', 'https://example.org/file.hwp'), ('sha256', '0'*64), ('bytes', 1),
                           ('attachmentId', '999'), ('annexId', '17575933'), ('annexNumber', '1'),
                           ('lawId', '999'), ('publishedAt', '2026-01-01'), ('sourceKind', 'ordin')]:
            with self.subTest(key=key):
                row = copy.deepcopy(ROW); row[key] = value
                with self.assertRaises(ValueError):self.build(row)

    def test_exact_program_and_jurisdiction_are_required(self):
        for change in ['city', 'program', 'url', 'scope', 'condition']:
            row = copy.deepcopy(ROW); p = copy.deepcopy(PROGRAM)
            if change == 'city':p['region']['sigungu'] = '44230'
            elif change == 'program':p['id'] = 'g44250.bokjiro-WLF00000000'; row['programIds'] = [p['id']]
            elif change == 'url':p['url'] = 'https://www.bokjiro.go.kr/'
            elif change == 'scope':row['scopeBasis'] = 'provincial-law-reference'
            else:row['condition'] = '모든 장례 신청 가능'
            with self.subTest(change=change), self.assertRaises(ValueError):self.build(row, p)

    def test_full_body_actor_and_selected_parts_are_mandatory(self):
        for key, value in [('fullBodyReviewed', False), ('sectionsRead', []), ('selectedParts', []),
                           ('applicant', '시청 담당자'), ('roleBasis', ''), ('role', 'administrative'),
                           ('reviewedParts', [{'number': '2', 'title': '지급대장', 'use': 'main', 'author': '공무원'}]),
                           ('lawCurrentCheckedAt', '2025-01-01')]:
            row = copy.deepcopy(ROW); row[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):self.build(row)

    def test_official_program_guidance_passes_without_inventing_an_ordinance(self):
        form = self.build_official()['forms'][BASIS_ID]
        self.assertEqual(form['lawUrl'], '')
        self.assertEqual((form['lawId'], form['lawTitle']), ('', ''))
        self.assertEqual((form['annexId'], form['annexNumber']), ('', ''))
        self.assertEqual(form['agency']['authorityBasis'], BASIS)
        self.assertEqual((form['agency']['sha256'], form['agency']['sourcePageUrl']), (ROW['sha256'], ROW['sourcePageUrl']))
        self.assertEqual(self.build_official()['auditedRoles'][BASIS_ID]['sectionsRead'], ['BodyText/Section0'])
        # 기존 조례 등록분은 그대로 — 근거 법령과 날짜 의미가 바뀌지 않는다.
        ordinance = self.build()['forms'][FID]
        self.assertEqual(ordinance['lawUrl'], ROW['lawEvidenceUrl'])
        self.assertNotIn('authorityBasis', ordinance['agency'])

    def test_official_program_basis_must_match_the_reviewed_page_and_day(self):
        for key, value in [('kind', 'official-law'), ('kind', 'ordinance'), ('title', '   '), ('title', 42),
                           ('evidenceUrl', ROW['sourceUrl']), ('evidenceUrl', ROW['authorityEvidenceUrl']+'&x=1'),
                           ('checkedAt', '2026-10-18'), ('checkedAt', '2026-10-20'),
                           ('evidenceNote', '안내 확인함'), ('pageSHA256', 'A'*64), ('pageSHA256', 'a'*63),
                           ('pageSHA256', '')]:
            entry = official_entry(); entry['authorityBasis'][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):self.build_official(entry)
        # 근거가 없으면 법령 칸을 비운 것만으로는 등록되지 않는다.
        entry = official_entry(); del entry['authorityBasis']
        with self.assertRaises(ValueError):self.build_official(entry)
        for change in ['missing', 'extra', 'list', 'empty', 'text']:
            entry = official_entry()
            if change == 'missing':del entry['authorityBasis']['pageSHA256']
            elif change == 'extra':entry['authorityBasis']['lawId'] = ROW['lawId']
            elif change == 'list':entry['authorityBasis'] = [copy.deepcopy(BASIS)]
            elif change == 'empty':entry['authorityBasis'] = {}
            else:entry['authorityBasis'] = 'official-program'
            with self.subTest(change=change), self.assertRaises(ValueError):self.build_official(entry)

    def test_official_program_mode_refuses_any_law_or_annex_identity(self):
        for key, value in [('lawId', ROW['lawId']), ('lawTitle', ROW['lawTitle']),
                           ('lawEvidenceUrl', ROW['lawEvidenceUrl']), ('lawEffectiveDate', ROW['lawEffectiveDate']),
                           ('lawCurrentCheckedAt', ROW['checkedAt']), ('annexId', '17575933'), ('annexNumber', '1')]:
            entry = official_entry(); entry[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):self.build_official(entry)
        for key in EMPTY_LAW:
            entry = official_entry(); del entry[key]
            with self.subTest(missing=key), self.assertRaises(ValueError):self.build_official(entry)
        # 조례 등록분이 공식 안내 근거를 함께 들고 올 수는 없다.
        entry = copy.deepcopy(prepare.agency.REGISTRY[FID]); entry['authorityBasis'] = copy.deepcopy(BASIS)
        with patch.dict(prepare.agency.REGISTRY, {FID: entry}), self.assertRaises(ValueError):
            prepare.agency.registry_entry(FID)

    def test_official_program_review_row_is_bound_to_the_registered_basis(self):
        for change in ['missing', 'title', 'page', 'day', 'law']:
            row = official_row()
            if change == 'missing':del row['authorityBasis']
            elif change == 'title':row['authorityBasis']['title'] = '다른 사업 안내'
            elif change == 'page':row['authorityBasis']['evidenceUrl'] = ROW['sourceUrl']
            elif change == 'day':row['authorityBasis']['checkedAt'] = '2026-10-18'
            else:row.update(lawId=ROW['lawId'], lawTitle=ROW['lawTitle'], lawEvidenceUrl=ROW['lawEvidenceUrl'])
            with self.subTest(change=change), self.assertRaises(ValueError):self.build_official(row=row)
        # 조례 등록분의 검토 행에 공식 안내 근거를 더하는 것도 막는다.
        row = copy.deepcopy(ROW); row['authorityBasis'] = copy.deepcopy(BASIS)
        with self.assertRaises(ValueError):self.build(row)

    def test_official_program_mode_keeps_source_identity_and_host_gates(self):
        for key, value in [('sourceUrl', ROW['sourceUrl']+'&session=secret'), ('sha256', '0'*64),
                           ('authorityEvidenceNote', ''), ('authorityEvidenceUrl', 'https://private.example.org/notice'),
                           ('attachmentId', '999'), ('sourcePageUrl', 'http://gyeryong.go.kr/kr/html/sub01/0102.html')]:
            entry = official_entry(); entry[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):self.build_official(entry)
        with patch.dict(prepare.agency.REGISTRY, {BASIS_ID: official_entry()}):
            self.assertEqual(prepare.agency.registry_entry(BASIS_ID)['sourceUrl'], ROW['sourceUrl'])
            self.assertFalse(download.agency.safe_url(''))
        # 끼워 넣은 등록분은 시험이 끝나면 남지 않는다.
        with self.assertRaisesRegex(ValueError, 'unregistered_agency_form'):prepare.agency.registry_entry(BASIS_ID)

    def test_path_escape_is_rejected_before_reading(self):
        for target in ['../outside.hwp', str((ROOT.parent/'outside.hwp').resolve()), 'tests/fixtures/forms/../outside.hwp']:
            row = copy.deepcopy(ROW); row['originalPath'] = target
            with self.assertRaisesRegex(ValueError, 'path_escape'):self.build(row)

    def test_public_attachment_identifiers_do_not_open_credential_urls(self):
        self.assertTrue(download.agency.safe_url('https://public.or.kr/file?key=123&fileKey=public-file&atchFileId=FILE_123'))
        for value in ['https://user:pass@public.or.kr/file', 'https://public.or.kr/file?serviceKey=secret',
                      'https://public.or.kr/file?apiKey=secret', 'https://public.or.kr/file?access_token=secret',
                      'https://public.or.kr/file?Authorization=secret', 'https://public.or.kr/file?session=secret',
                      'https://public.or.kr/file?key=secret', 'https://public.or.kr/file?%2561piKey=secret']:
            self.assertFalse(download.agency.safe_url(value))
        self.assertFalse(download.official_download(ROW['sourceUrl']))
        self.assertTrue(download.official_download('https://www.law.go.kr/LSW/flDownload.do?flSeq=123'))
        with self.assertRaisesRegex(ValueError, 'not_public_law_download'):download.Download(0, 1).get(ROW['sourceUrl'])

    def response(self, url, status=200, location=None, data=BYTES):
        response = Mock(); response.url = url; response.status_code = status
        response.headers = {'Location': location} if location else {}
        response.iter_content.return_value = [data]
        response.__enter__ = Mock(return_value=response); response.__exit__ = Mock(return_value=False)
        return response

    def test_registered_get_checks_wire_final_url_and_actual_bytes(self):
        with patch.object(download.requests, 'get', return_value=self.response(ROW['sourceUrl'])) as get:
            self.assertEqual(download.Download(0, 1).get_agency(FID), BYTES)
            self.assertFalse(get.call_args.kwargs['allow_redirects'])
        for response in [self.response(ROW['sourceUrl'], data=BYTES+b'changed'),
                         self.response(ROW['sourceUrl']+'&changed=1'),
                         self.response(ROW['sourceUrl'], 302, 'https://example.org/file.hwp')]:
            with patch.object(download.requests, 'get', return_value=response) as get, self.assertRaises(ValueError):
                download.Download(0, 1).get_agency(FID)
            self.assertEqual(get.call_count, 1)

    def test_only_registered_final_redirect_is_followed(self):
        e = copy.deepcopy(download.agency.REGISTRY[FID]); e['finalUrl'] = e['sourceUrl']+'&delivery=1'
        with patch.dict(download.agency.REGISTRY, {FID: e}), patch.object(download.requests, 'get', side_effect=[
                self.response(e['sourceUrl'], 302, e['finalUrl']), self.response(e['finalUrl'])]) as get:
            self.assertEqual(download.Download(0, 1).get_agency(FID), BYTES)
            self.assertEqual(get.call_count, 2)

    def test_registry_still_rejects_credentials_and_requires_delegation_authority(self):
        for changes in [{'sourceUrl': ROW['sourceUrl']+'&session=secret'},
                        {'authorityKind': 'delegated'}, {'authorityEvidenceNote': ''}, {'authorityBasis': None}]:
            e = copy.deepcopy(download.agency.REGISTRY[FID]); e.update(changes)
            with patch.dict(download.agency.REGISTRY, {FID: e}), self.assertRaises(ValueError):
                download.agency.registry_entry(FID)

    def test_unknown_public_agency_id_never_triggers_network(self):
        with patch.object(download.requests, 'get') as get, self.assertRaises(ValueError):
            download.Download(0, 1).get_agency('agency-44250-999')
        get.assert_not_called()

    def test_fixed_path_attachment_has_one_exact_identifier_and_no_decoded_escape(self):
        e = copy.deepcopy(download.agency.REGISTRY[FID])
        e['sourceUrl'] = e['finalUrl'] = 'https://public.or.kr/userNew/custom/SP/%EC%8B%A0%EC%B2%AD.hwp'
        e['attachmentIdentifier'] = {'path': '/userNew/custom/SP/%EC%8B%A0%EC%B2%AD.hwp'}
        e['authorityKind'] = 'delegated'
        with patch.dict(download.agency.REGISTRY, {FID: e}):
            self.assertEqual(download.agency.registry_entry(FID)['sourceUrl'], e['sourceUrl'])
            e['attachmentIdentifier']['queryParam'] = 'file_id'
            with self.assertRaises(ValueError):download.agency.registry_entry(FID)
        for path in ['/a/../b.hwp', '/a/%2e%2e/b.hwp', '/a/%252e%252e/b.hwp', '/a/%5c../b.hwp']:
            self.assertFalse(download.agency.safe_url('https://public.or.kr'+path))


if __name__ == '__main__':unittest.main()

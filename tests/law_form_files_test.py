import importlib.util
import io
import base64
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('files',ROOT/'scripts/download-law-form-files.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class LawFormFilesTest(unittest.TestCase):
    def test_download_url_requires_official_attachment_identity_without_credentials(self):
        self.assertTrue(m.official_download('https://www.law.go.kr/LSW/flDownload.do?flSeq=123'))
        self.assertTrue(m.official_download('https://www.law.go.kr/flDownload.do?gubun=ELIS&flSeq=154783989'))
        for url in ['https://example.go.kr/flDownload.do?flSeq=123',
                    'https://www.law.go.kr/other/flDownload.do?flSeq=123',
                    'https://www.law.go.kr/flDownload.do?flSeq=1&flSeq=2',
                    'https://www.law.go.kr/flDownload.do?flSeq=1&OC=secret']:
            self.assertFalse(m.official_download(url))
        for url in ['https://example.com/file.hwp','https://www.law.go.kr/login','https://www.law.go.kr/LSW/flDownload.do?flSeq=1&OC=secret']:
            self.assertFalse(m.official_download(url))
    def test_extended_controls_are_skipped_as_eight_wchars(self):
        control=struct.pack('<8H',2,0x1234,0x3333,0,0,0,0,2)
        self.assertEqual(m.paragraph_text(control+'지원 신청서'.encode('utf-16-le')),'지원 신청서')
    def test_hwpx_reads_all_sections_and_rejects_generic_zip(self):
        data=io.BytesIO()
        with zipfile.ZipFile(data,'w') as z:
            z.writestr('mimetype','application/hwp+zip')
            for n,title in [(0,'지원 신청서'),(1,'동의서')]:
                z.writestr(f'Contents/section{n}.xml',f'<s xmlns:hp="urn:test"><hp:t>{title}</hp:t></s>')
        found=m.inspect_document(data.getvalue())
        self.assertEqual(found['format'],'hwpx');self.assertEqual(len(found['sectionsRead']),2)
        self.assertIn('신청서',found['text']);self.assertIn('동의서',found['text'])
        with self.assertRaises(ValueError):m.inspect_document(b'<html>error</html>')
    def test_existing_official_hwp_is_read_from_body_not_preview(self):
        found=m.inspect_document((ROOT/'pipeline/forms/originals/ordin-19969911.hwp').read_bytes())
        self.assertEqual(found['format'],'hwp')
        self.assertTrue(all(name.startswith('BodyText/') for name in found['sectionsRead']))
        self.assertIn('장수축하금',found['text'])
    def test_original_cache_does_not_relabel_old_bytes_with_a_new_source(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory);fid='ordin-123';original=folder/(fid+'.hwp')
            original.write_bytes(b'old original')
            record={'state':'stored','sourceUrl':'https://www.law.go.kr/LSW/flDownload.do?flSeq=1',
                    'localPath':str(original),'sha256':m.digest(original.read_bytes())}
            (folder/(fid+'.json')).write_text(json.dumps(record),encoding='utf-8')
            with patch.object(m,'LOG',folder),patch.object(m,'MANIFEST',folder/'absent.json'):
                self.assertEqual(m.cached_original({'id':fid,'sourceUrl':record['sourceUrl']},folder)[0],b'old original')
                self.assertEqual(m.cached_original({'id':fid,'sourceUrl':record['sourceUrl'].replace('=1','=2')},folder),(None,None))
                original.write_bytes(b'changed bytes')
                self.assertEqual(m.cached_original({'id':fid,'sourceUrl':record['sourceUrl']},folder),(None,None))
    def test_changed_portal_original_is_saved_without_overwriting_the_previous_one(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)
            first=m.save_original(folder,'ordin-123','hwp',b'first original')
            second=m.save_original(folder,'ordin-123','hwp',b'new original')
            self.assertNotEqual(first,second)
            self.assertEqual(first.read_bytes(),b'first original')
            self.assertEqual(second.read_bytes(),b'new original')
            self.assertEqual(m.save_original(folder,'ordin-123','hwp',b'new original'),second)
    def test_exact_reviewed_zip_member_is_preserved_byte_for_byte(self):
        original=(ROOT/'pipeline/forms/originals/ordin-19969911.hwp').read_bytes()
        content=io.BytesIO()
        with zipfile.ZipFile(content,'w',zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('신청서.hwp',original)
            archive.writestr('관리대장.hwp',b'not the selected document')
        container=content.getvalue();selection={'name':'신청서.hwp','containerSha256':m.digest(container),'sha256':m.digest(original)}
        self.assertEqual(m.extract_reviewed_member(container,selection),original)
        for change in ({'name':'missing.hwp'},{'sha256':'0'*64},{'containerSha256':'0'*64},{'name':'관리대장.hwp'}):
            with self.subTest(change=change),self.assertRaises(ValueError):m.extract_reviewed_member(container,{**selection,**change})
    def test_non_hangul_sources_keep_actual_formats_and_reading_limits(self):
        text='장학금 지급 신청서\n신청인 성명:          서명:\n주민등록번호:'.encode('cp949')
        found=m.inspect_document(text,'txt')
        self.assertEqual(found['format'],'txt');self.assertIn('장학금',found['text'])
        self.assertEqual(found['textScope'],'plain_text')
        with self.assertRaises(ValueError):m.inspect_document(b'<html>portal error</html>','txt')
        with self.assertRaises(ValueError):m.inspect_document(text)
        gif=base64.b64decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')
        found=m.inspect_document(gif)
        self.assertEqual(found['format'],'gif');self.assertEqual(found['sectionsRead'],['frame-1'])
        self.assertEqual(found['textScope'],'image_requires_visual_review')
        legacy=m.inspect_document(b'HWP Document File V3.00 '+bytes(140))
        self.assertEqual(legacy['format'],'hwp')
        self.assertEqual(legacy['textScope'],'legacy_hwp_requires_external_review')
        self.assertEqual(legacy['text'],'')

if __name__=='__main__':unittest.main()

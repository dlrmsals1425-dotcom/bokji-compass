import importlib.util
import copy
import json
import sqlite3
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('portal_index',ROOT/'scripts/match-law-forms.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class AuditedLawIdentityTest(unittest.TestCase):
    def audit(self, records, ids=('p',)):
        return {'schema':1,'laws':records,'programs':{pid:{'lawKeys':list(records)} for pid in ids}}

    def test_audit_requires_exact_program_coverage_and_valid_references(self):
        audit=self.audit({})
        for expected in (['p','missing'], ['different']):
            with self.assertRaises(ValueError):module.audited_laws(audit,expected)
        audit['programs']['p']['lawKeys']=['absent']
        with self.assertRaises(ValueError):module.audited_laws(audit,['p'])

    def test_only_read_complete_identities_are_used_and_source_program_is_unchanged(self):
        records={'ok':{'kind':'ordin','id':'1617657','title':'서울특별시교육청 난치병 학생 치료비 지원에 관한 조례','state':'read'}}
        for state in ['not_found','ambiguous','failed','UNKNOWN']:
            records[state]={**records['ok'],'id':'2','state':state}
        records['no-title']={**records['ok'],'title':''}
        records['no-id']={**records['ok'],'id':''}
        records['bad-kind']={**records['ok'],'kind':'unknown'}
        audit=self.audit(records);before=copy.deepcopy(audit)
        found=module.audited_laws(audit,['p'])['p']
        self.assertEqual([(r['kind'],r['id']) for r in found],[('ordin','1617657')])
        program={'id':'p','name':'난치병 치료비 지원','laws':['서울시교육청 난치병 학생 치료비 지원에 관한 조례'],
                 'scope':'sido','region':{'sido':'11000'}}
        original=copy.deepcopy(program)
        evaluation=module.program_with_audited_laws(program,found)
        self.assertIn(records['ok']['title'],evaluation['laws'])
        self.assertEqual(program,original)
        self.assertEqual(audit,before)
        evaluation['laws'].append('사후 변경')
        self.assertEqual(program,original)

    def make_form(self, **overrides):
        form={'id':'ordin-1','sourceKind':'ordin','lawId':'1617657',
              'title':'난치병 학생 치료비 지원 신청서','declaredKind':'서식',
              'lawTitle':'서울특별시교육청 난치병 학생 치료비 지원에 관한 조례',
              'regionCode':'11000','regionLabel':'서울특별시교육청','authorityType':'education'}
        form.update(overrides);form['role']=module.index_role(form);form['unnamed']=module.unnamed(form)
        return form

    def test_id_pool_uses_kind_and_id_index_and_keeps_existing_jurisdiction_guards(self):
        connection=sqlite3.connect(':memory:');module.create_match_tables(connection)
        forms=[self.make_form(), self.make_form(id='rule-1',sourceKind='rule'),
               self.make_form(id='ordin-2',lawId='999')]
        for form in forms:
            connection.execute('INSERT INTO forms VALUES(?,?,?,?,?,?,?)',
                (form['id'],form['regionCode'],module.matching.normalize_law(form['lawTitle']),form['role'],
                 form['sourceKind'],form['lawId'],json.dumps(form)))
        laws=[{'kind':'ordin','id':'1617657','title':forms[0]['lawTitle']}]
        pool=module.identity_form_pool(connection,laws,{})
        self.assertEqual(set(pool),{'ordin-1'})
        plan=connection.execute('EXPLAIN QUERY PLAN SELECT payload FROM forms WHERE source_kind=? AND law_id=?',('ordin','1617657')).fetchall()
        self.assertTrue(any('form_source_identity' in str(row) for row in plan))
        program={'id':'p','name':'난치병 학생 치료비 지원','orgType':'local','scope':'sigungu',
                 'region':{'sido':'11000','sigungu':'11545'},'laws':['서울시교육청 난치병 학생 치료비 지원에 관한 조례']}
        evaluation=module.program_with_audited_laws(program,laws)
        cited=set(module.cited_law_keys(evaluation,None))
        _,candidate=module.compare_form(evaluation,pool['ordin-1'],cited)
        self.assertIsNotNone(candidate)
        self.assertNotIn('approved',candidate)
        other={**evaluation,'region':{'sido':'26000','sigungu':'26410'}}
        _,candidate=module.compare_form(other,pool['ordin-1'],cited)
        self.assertIsNone(candidate)
        other_city=self.make_form(id='other-city',authorityType='local',regionCode='11110',regionLabel='서울특별시 종로구')
        _,candidate=module.compare_form(evaluation,other_city,cited)
        self.assertIsNone(candidate)
        connection.close()

    def test_verified_title_does_not_bypass_legacy_split_and_national_reference_checks(self):
        form=self.make_form(regionCode='12000',regionLabel='(구)광주광역시',authorityType='local',legacyArea='gwangju')
        laws=[{'kind':'ordin','id':form['lawId'],'title':form['lawTitle']}]
        program={'id':'p','name':'치료비 지원','scope':'sigungu','region':{'sido':'12000','sigungu':'12800'},'laws':[]}
        evaluation=module.program_with_audited_laws(program,laws)
        cited=set(module.cited_law_keys(evaluation,None))
        compared,candidate=module.compare_form(evaluation,form,cited)
        self.assertFalse(compared);self.assertIsNone(candidate)
        national=self.make_form(id='law-1',sourceKind='law',lawId='100',lawTitle='의료급여법 시행규칙',
                                regionCode='national',regionLabel='전국',authorityType='national')
        national_laws=[{'kind':'law','id':'100','title':national['lawTitle']}]
        evaluation=module.program_with_audited_laws(program,national_laws)
        _,candidate=module.compare_form(evaluation,national,set(module.cited_law_keys(evaluation,None)))
        self.assertIsNotNone(candidate)
        self.assertEqual(candidate['scopeBasis'],'national_law_reference')

class AuthorityTest(unittest.TestCase):
    def test_education_office_requires_education_program_or_cited_law(self):
        form=module.resolve_authority({'regionCode':'unresolved','regionLabel':'경기도교육청'},{'경기도':'41000'})
        self.assertEqual(form['regionCode'],'41000')
        self.assertFalse(module.authority_applies({'orgType':'metro'},form,False))
        self.assertTrue(module.authority_applies({'orgType':'edu_office'},form,False))
        self.assertTrue(module.authority_applies({'orgType':'local'},form,True))
    def test_legacy_province_form_never_leaks_to_other_half_of_merged_area(self):
        form=module.resolve_authority({'regionCode':'unresolved','regionLabel':'(구)광주광역시'}, {})
        self.assertEqual(form['regionCode'],'12000')
        gwangju={'scope':'sigungu','region':{'sido':'12000','sigungu':'12210'}}
        jeonnam={'scope':'sigungu','region':{'sido':'12000','sigungu':'12420'}}
        self.assertTrue(module.authority_applies(gwangju,form,False))
        self.assertFalse(module.authority_applies(jeonnam,form,True))
    def test_legacy_province_uses_existing_source_authority_convention(self):
        form={'legacyArea':'gwangju'}
        program={'scope':'sido','name':'지원','region':{'sido':'12000'},'sources':[{'source':'gov24','id':'646000000001'}]}
        self.assertFalse(module.authority_applies(program,form,True))
        program['sources']=[{'source':'gov24','id':'629000000001'}]
        self.assertTrue(module.authority_applies(program,form,False))
    def test_unknown_authority_stays_unresolved(self):
        form={'regionCode':'unresolved','regionLabel':'충청광역연합'}
        self.assertEqual(module.resolve_authority(form,{}),form)
    def test_parenthetical_common_application_is_an_application(self):
        self.assertEqual(module.matching.classify_role('사회보장급여 신청(변경)서','서식'),'application')
        self.assertEqual(module.matching.classify_role('사회서비스이용권 신청(변경)서','서식'),'application')
        self.assertEqual(module.matching.classify_role('기관용 동의서','서식'),'administrative')
    def test_unnamed_annex_is_not_claimed_to_be_an_application(self):
        self.assertTrue(module.unnamed({'title':'[별지 제1호서식]','declaredKind':'서식'}))
        self.assertFalse(module.unnamed({'title':'[별표 1] 요금표','declaredKind':'별표'}))
    def test_parenthetical_applicant_stays_behind_admin_and_deleted(self):
        self.assertEqual(module.matching.classify_role('보청기 구입비 지급청구서','서식'),'application')
        self.assertEqual(module.matching.classify_role('기관용 청구서','서식'),'administrative')
        self.assertEqual(module.matching.classify_role('별지서식(신청서)','서식'),'application')
        self.assertEqual(module.matching.classify_role('사회보장급여 신청(변경)서','서식'),'application')
        self.assertEqual(module.matching.classify_role('별지서식(기관용 신청서)','서식'),'administrative')
        self.assertEqual(module.matching.classify_role('별지서식(신청서)','삭제'),'deleted')
        self.assertEqual(module.matching.classify_role('별지서식(신청서) <삭제 2017.11.14.>','서식'),'deleted')
        self.assertEqual(module.index_role({'title':'별지','declaredKind':'서식'}),'unclassified')
        self.assertNotEqual(module.index_role({'title':'별지서식(신청서)','declaredKind':'서식'}),'unclassified')

class SameJurisdictionAliasTest(unittest.TestCase):
    def test_multiple_cited_laws_do_not_become_one_unmatchable_title(self):
        program={'laws':['노인복지법, 종로구 입학준비금 지원 조례||사회보장급여법 (제1조, 제2조)']}
        self.assertEqual(module.flatten_laws(program),['노인복지법','종로구 입학준비금 지원 조례','사회보장급여법 (제1조, 제2조)'])
        self.assertIn('종로구입학준비금지원조례',module.cited_law_keys(program,None))
        self.assertEqual(module.flatten_laws({'laws':['종로구 음식물류 폐기물 발생억제, 수집·운반 조례, 노인복지법']}),
                         ['종로구 음식물류 폐기물 발생억제, 수집·운반 조례','노인복지법'])
    @classmethod
    def setUpClass(cls):
        cls.catalog=module.region_catalog(module.read(ROOT/'public/bundles/v1/regions.json'))
    def keys(self,program):
        geography=module.program_geography(program,self.catalog)
        return module.cited_law_keys(program,geography)
    def test_pool_lookup_adds_only_this_districts_official_title(self):
        jongno={'name':'입학준비금 지원','scope':'sigungu','region':{'sido':'11000','sigungu':'11110','label':'서울 종로구'},'laws':['종로구 입학준비금 지원 조례']}
        self.assertEqual(module.program_geography(jongno,self.catalog),{'sido':'서울특별시','sigungu':'종로구'})
        found=self.keys(jongno)
        self.assertIn('종로구입학준비금지원조례',found)
        self.assertIn('서울특별시종로구입학준비금지원조례',found)
        self.assertIn('서울특별시종로구입학준비금지원조례시행규칙',found)
        self.assertNotIn('서울특별시종로구입학준비금지원조례시행령',found)
        self.assertNotIn('부산광역시종로구입학준비금지원조례',found)
        self.assertNotIn('서울특별시종로구입학준비금추가지원조례',found)
        busan={'name':'입학준비금 지원','scope':'sigungu','region':{'sido':'26000','sigungu':'26110','label':'부산 중구'},'laws':['중구 입학준비금 지원 조례']}
        busan_keys=self.keys(busan)
        self.assertIn('부산광역시중구입학준비금지원조례',busan_keys)
        self.assertNotIn('서울특별시중구입학준비금지원조례',busan_keys)
        gangwon={'name':'입학준비금 지원','scope':'sigungu','region':{'sido':'51000','sigungu':'51820','label':'강원 고성군'},'laws':['고성군 입학준비금 지원 조례']}
        gyeongnam={'name':'입학준비금 지원','scope':'sigungu','region':{'sido':'48000','sigungu':'48820','label':'경남 고성군'},'laws':['고성군 입학준비금 지원 조례']}
        self.assertNotIn('경상남도고성군입학준비금지원조례',self.keys(gangwon))
        self.assertNotIn('강원특별자치도고성군입학준비금지원조례',self.keys(gyeongnam))
        mismatched={'name':'입학준비금 지원','scope':'sigungu','region':{'sido':'11000','sigungu':'26110'},'laws':['중구 입학준비금 지원 조례']}
        self.assertIsNone(module.program_geography(mismatched,self.catalog))
        bare=module.cited_law_keys(mismatched,None)
        self.assertIn('중구입학준비금지원조례',bare)
        self.assertNotIn('서울특별시중구입학준비금지원조례',bare)
        self.assertNotIn('부산광역시중구입학준비금지원조례',bare)
    def annex(self,**overrides):
        form={'id':'byeolji','sourceKind':'ordin','title':'별지','declaredKind':'서식','lawTitle':'서울특별시 종로구 입학준비금 지원 조례','regionCode':'11110','regionLabel':'서울특별시 종로구'}
        form.update(overrides)
        form['role']=module.index_role(form)
        form['unnamed']=module.unnamed(form)
        return form
    def test_unnamed_same_jurisdiction_annex_is_review_candidate_only(self):
        program={'name':'입학준비금 지원','scope':'sigungu','region':{'sido':'11000','sigungu':'11110','label':'서울 종로구'},'laws':['종로구 입학준비금 지원 조례'],'owner':'서울특별시 종로구'}
        form=self.annex()
        self.assertEqual(form['role'],'unclassified')
        self.assertTrue(form['unnamed'])
        compared,candidate=module.compare_form(program,form,set(self.keys(program)))
        self.assertTrue(compared)
        self.assertEqual(form['role'],'unclassified')
        self.assertEqual(candidate['formId'],'byeolji')
        self.assertEqual(candidate['basis'],'unnamed_annex')
        self.assertEqual(candidate['score'],1)
        self.assertNotIn('approved',candidate)
        self.assertNotRegex(candidate['reason'],r'필수|확정|게시|검증|승인|자격')
        self.assertIsNone(module.matching.evaluate_candidate(program,form))
        other_city=self.annex(id='seoul-jung',regionCode='11140',regionLabel='서울특별시 중구',lawTitle='서울특별시 중구 입학준비금 지원 조례')
        busan={'name':'입학준비금 지원','scope':'sigungu','region':{'sido':'26000','sigungu':'26110','label':'부산 중구'},'laws':['중구 입학준비금 지원 조례']}
        _compared,blocked=module.compare_form(busan,other_city,set(self.keys(busan)))
        self.assertIsNone(blocked)
        other_province=self.annex(id='gyeongnam',regionCode='48820',regionLabel='경상남도 고성군',lawTitle='경상남도 고성군 입학준비금 지원 조례')
        gangwon={'name':'입학준비금 지원','scope':'sigungu','region':{'sido':'51000','sigungu':'51820','label':'강원 고성군'},'laws':['고성군 입학준비금 지원 조례']}
        _compared,blocked=module.compare_form(gangwon,other_province,set(self.keys(gangwon)))
        self.assertIsNone(blocked)
        sibling=self.annex(id='sibling',lawTitle='서울특별시 종로구 입학준비금 추가 지원 조례')
        _compared,blocked=module.compare_form(program,sibling,set(self.keys(program)))
        self.assertIsNone(blocked)
    def test_legacy_gwangju_form_still_does_not_match_jeonnam_program(self):
        program={'scope':'sigungu','name':'영암 입학준비금 지원','region':{'sido':'12000','sigungu':'12800'},'laws':['광주광역시 광산구 입학준비금 지원 조례'],'sources':[{'source':'gov24','id':'646000000001'}]}
        form={'id':'legacy','sourceKind':'ordin','title':'별지','declaredKind':'서식','lawTitle':'광주광역시 광산구 입학준비금 지원 조례','regionCode':'12000','regionLabel':'(구)광주광역시','legacyArea':'gwangju'}
        form['role']=module.index_role(form);form['unnamed']=module.unnamed(form)
        compared,candidate=module.compare_form(program,form,set(self.keys(program)))
        self.assertFalse(compared)
        self.assertIsNone(candidate)
        gwangju={'scope':'sigungu','name':'광산 입학준비금 지원','region':{'sido':'12000','sigungu':'12330'},'laws':['광주광역시 광산구 입학준비금 지원 조례']}
        self.assertTrue(module.authority_applies(gwangju,form,True))
        self.assertFalse(module.authority_applies(program,form,True))

if __name__=='__main__':unittest.main()

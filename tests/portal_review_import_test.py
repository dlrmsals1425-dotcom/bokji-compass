"""검토 원문을 공개 전 연결 자료로 옮기는 단계만 본다. 실제 파이프라인은 돌리지 않는다."""
import importlib.util
import copy
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('portal_review_import',ROOT/'scripts/prepare-portal-reviews.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
NATIONAL_LAW='사회보장급여의 이용·제공 및 수급권자 발굴에 관한 법률'
SEJONG_ORDINANCE='세종특별자치시 여성장애인 출산 및 양육 지원 조례'
EVIDENCE='https://www.law.go.kr/LSW/flDownload.do?flSeq=1'

def program(program_id,**extra):
    base={'id':program_id,'name':'출산 지원','scope':'national','laws':[NATIONAL_LAW]}
    base.update(extra);return base

def row(form_id,program_ids,**extra):
    base={'sourceKind':'rule','lawTitle':NATIONAL_LAW+' 시행규칙','lawId':'280315','annexId':form_id.split('-')[1],
        'annexNumber':'000100','sourceUrl':EVIDENCE,'dateKind':'effective','effectiveDate':'20250301',
        'programIds':list(program_ids),'formId':form_id,'use':'main','evidenceUrl':EVIDENCE,
        'evidenceNote':'원문 별지 제1호서식을 확인했다.','checkedAt':'2026-10-16','formTitle':'사회보장급여 신청(변경)서'}
    base.update(extra);return base

class ReviewFileTest(unittest.TestCase):
    def directory(self,**files):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        folder=Path(temp.name)
        for name,data in files.items():
            (folder/name.replace('__','-').replace('_json','.json')).write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
        return folder
    def test_numbered_rounds_import_after_the_base_files(self):
        folder=self.directory(
            national__reviewed_json=[row('rule-1',['p1'])],
            municipal__reviewed_json={'rows':[row('ordin-2',['p2'])]},
            national__reviewed__round2_json={'rows':[row('rule-3',['p3'])]},
            municipal__reviewed__round2_json={'rows':[row('ordin-4',['p4'])]},
            national__reviewed__round10_json={'rows':[row('rule-5',['p5'])]})
        self.assertEqual([file.name for file in module.review_files(folder)],
            ['national-reviewed.json','municipal-reviewed.json','national-reviewed-round2.json',
             'municipal-reviewed-round2.json','national-reviewed-round10.json'])
        programs={key:program(key) for key in ['p1','p2','p3','p4','p5']}
        output=module.build(programs,module.review_files(folder))
        self.assertEqual([link['formId'] for link in output['rows']],['rule-1','ordin-2','rule-3','ordin-4','rule-5'])
    def test_review_report_and_unrelated_files_are_left_out(self):
        folder=self.directory(
            national__reviewed_json=[row('rule-1',['p1'])],
            municipal__reviewed_json={'rows':[]},
            # 집계 보고서는 rows가 개수라서 함께 읽으면 바로 깨진다.
            national__reviewed__report_json={'checkedAt':'2026-10-16','rows':16,'forms':10},
            national__reviewed__draft_json=[row('rule-9',['p9'])],
            reviewed__links_json=[row('rule-8',['p8'])])
        self.assertEqual([file.name for file in module.review_files(folder)],
            ['national-reviewed.json','municipal-reviewed.json'])
        output=module.build({'p1':program('p1')},module.review_files(folder))
        self.assertEqual([link['formId'] for link in output['rows']],['rule-1'])
    def test_missing_base_audit_file_is_reported(self):
        folder=self.directory(municipal__reviewed_json={'rows':[]},national__reviewed__round2_json={'rows':[]})
        with self.assertRaises(FileNotFoundError) as caught:module.review_files(folder)
        self.assertIn('national-reviewed.json',str(caught.exception))
    def test_committed_review_folder_never_imports_the_report(self):
        names=[file.name for file in module.review_files(ROOT/'pipeline/forms/reviews')]
        self.assertNotIn('national-reviewed-report.json',names)
        for name in module.BASE_FILES:self.assertIn(name,names)
        for name in names:self.assertIsNotNone(module.REVIEW_FILE.fullmatch(name))

class BuildTest(unittest.TestCase):
    def test_official_application_reference_requires_exact_source_and_verified_original(self):
        p=program('g41280.p',scope='sigungu',region={'sido':'41000','sigungu':'41280'},laws=['고양시 지원 조례'],url='https://www.gov.kr/portal/rcvfvrSvc/dtlEx/EXACT')
        r=row('law-9',[p['id']],sourceKind='law',scopeBasis='official-application-reference',
              verificationStatus='verified',officialAttachmentMatched=True,sha256='a'*64,evidenceUrl=p['url'])
        r['scopeReference']={'kind':'program-documents','referencedLawTitle':r['lawTitle'],'annexNumber':r['annexNumber'],
                             'basis':'해당 사업 안내의 구비서류에서 특정한 별지 원문을 지정하는 내용을 정확히 대조한 근거입니다.'}
        out=self.build({p['id']:p},[r])
        self.assertEqual(out['rows'][0]['scopeReference'],r['scopeReference'])
        with self.assertRaises(ValueError):self.build({p['id']:p},[{**r,'evidenceUrl':p['url']+'OTHER'}])
        with self.assertRaises(ValueError):self.build({p['id']:p},[{**r,'sha256':''}])
        r['evidenceUrl']='https://www.law.go.kr/ordinInfoP.do?ordinSeq=88'
        r['scopeReference'].update(kind='cited-local-law',sourceLawTitle='고양시 지원 조례',sourceLawId='88',article='제6조')
        self.assertEqual(self.build({p['id']:p},[r])['rows'][0]['scopeBasis'],'official-application-reference')
        with self.assertRaises(ValueError):self.build({p['id']:{**p,'laws':[]}},[r])

    def build(self,programs,*rounds):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        folder=Path(temp.name);files=[]
        for index,rows in enumerate(rounds):
            name='national-reviewed.json' if index==0 else f'national-reviewed-round{index+1}.json'
            (folder/name).write_text(json.dumps({'rows':rows},ensure_ascii=False),encoding='utf-8')
            files.append(folder/name)
        return module.build(programs,files)
    def test_unknown_program_is_rejected(self):
        with self.assertRaises(ValueError) as caught:
            self.build({'p1':program('p1')},[row('rule-1',['p1'])],[row('rule-2',['p-gone'])])
        self.assertIn('p-gone',str(caught.exception))
    def test_selected_title_stays_with_each_benefit_of_a_combined_original(self):
        base=row('ordin-20002811',['p1'],sourceKind='ordin',lawId='1408662',formTitle='별지',
            role='application',roleBasis='현행 조례와 원본 전체에서 신청인 작성 부분과 제출 대상을 각각 확인했습니다.',
            roleEvidenceUrl='https://www.law.go.kr/ordinInfoP.do?ordinSeq=1408662',roleCheckedAt='2026-10-18',
            verificationStatus='verified',officialAttachmentMatched=True,sha256='a'*64,
            reviewedParts=[{'number':'1','title':'출산지원금 신청서','use':'main','author':'신청인'}],
            displayTitle='출산지원금 신청서')
        other={**base,'programIds':['p2'],'displayTitle':'양육지원금 신청서',
            'reviewedParts':[{'number':'2','title':'양육지원금 신청서','use':'main','author':'신청인'}]}
        output=self.build({'p1':program('p1'),'p2':program('p2')},[base,other])
        self.assertEqual([r['displayTitle'] for r in output['rows']],['출산지원금 신청서','양육지원금 신청서'])
        self.assertNotIn('displayTitle',output['forms'][base['formId']])
    def test_an_unnamed_delegation_requires_exact_original_and_conditional_part_evidence(self):
        audited=row('ordin-90001',['p1'],sourceKind='ordin',lawId='88',formTitle='별지 2호 서식',
            role='delegation',use='conditional',condition='해당 지원금 신청을 대리인에게 위임할 경우에만 사용한다.',
            roleBasis='현행 제2조제3항의 대리신청 지정과 전체 원문의 위임인·대리인·위임범위를 대조했습니다.',
            roleEvidenceUrl='https://www.law.go.kr/ordinInfoP.do?ordinSeq=88',roleCheckedAt='2026-10-18',
            verificationStatus='verified',officialAttachmentMatched=True,sha256='a'*64,
            reviewedParts=[{'number':'2','title':'지원금 신청 위임장','use':'conditional','author':'위임하는 신청인'}])
        with self.assertRaises(ValueError):self.build({'p1':program('p1')},[audited])
        with patch.dict(module.FULL_BODY_ROLE_OVERRIDES,{'ordin-90001':{'lawId':'88','role':'delegation','sha256':'a'*64}}):
            self.assertEqual(self.build({'p1':program('p1')},[audited])['forms'][audited['formId']]['role'],'delegation')
            for change in [{'sha256':'b'*64},{'condition':''},{'use':'main'},{'reviewedParts':[]}]:
                with self.subTest(change=change),self.assertRaises(ValueError):self.build({'p1':program('p1')},[{**audited,**change}])
    def test_a_full_body_pledge_can_remain_supporting_instead_of_personal_data_consent(self):
        audited=row('ordin-90003',['p1'],sourceKind='ordin',lawId='88',formTitle='주택 입주서약서',
            role='supporting',use='conditional',condition='입주자로 선정된 뒤 입주조건을 서약할 때 사용한다.',
            roleBasis='현행 제7조와 원본 전체의 거주비 부담·양도금지·퇴거 이행 서명란을 확인했습니다.',
            roleEvidenceUrl='https://www.law.go.kr/ordinInfoP.do?ordinSeq=88',roleCheckedAt='2026-10-18',
            verificationStatus='verified',officialAttachmentMatched=True,sha256='a'*64,
            reviewedParts=[{'number':'11','title':'주택 입주서약서','use':'conditional','author':'선정된 입주자'}])
        with patch.dict(module.FULL_BODY_ROLE_OVERRIDES,{'ordin-90003':{'lawId':'88','role':'supporting','sha256':'a'*64}}):
            self.assertEqual(self.build({'p1':program('p1')},[audited])['forms'][audited['formId']]['role'],'supporting')
            for change in [{'sha256':'b'*64},{'use':'main'},{'reviewedParts':[]}]:
                with self.subTest(change=change),self.assertRaises(ValueError):self.build({'p1':program('p1')},[{**audited,**change}])
    def test_duplicate_association_across_rounds_is_rejected(self):
        programs={'p1':program('p1')}
        with self.assertRaises(ValueError):
            self.build(programs,[row('rule-1',['p1'])],[row('rule-1',['p1'],use='additional')])
        # 같은 서식을 다른 사업에 다시 연결하는 것은 중복이 아니다.
        output=self.build({'p1':program('p1'),'p2':program('p2')},[row('rule-1',['p1'])],[row('rule-1',['p2'])])
        self.assertEqual(len(output['rows']),2)
    def test_audited_role_metadata_is_preserved(self):
        audited=row('ordin-11128481',['p1'],formTitle='[별지 제1호서식] 수리 내역 자료',use='conditional',
            condition='수리센터에 제출하는 경우',role='supporting',roleBasis='제6조제1항이 정한 신청인 작성 수리 내역 자료로 원문을 대조했다.',
            roleEvidenceUrl='https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=976785',roleCheckedAt='20261016')
        output=self.build({'p1':program('p1')},[audited])
        self.assertEqual(output['forms']['ordin-11128481']['role'],'supporting')
        self.assertEqual(output['auditedRoles']['ordin-11128481'],{'role':'supporting',
            'roleBasis':audited['roleBasis'],'roleEvidenceUrl':audited['roleEvidenceUrl'],'roleCheckedAt':'2026-10-16'})
        self.assertEqual(output['rows'][0]['condition'],'수리센터에 제출하는 경우')
        self.assertEqual(output['rows'][0]['use'],'conditional')
        self.assertEqual(output['rows'][0]['evidenceNote'],audited['evidenceNote'])
        self.assertEqual(output['rows'][0]['checkedAt'],'2026-10-16')
    def test_an_identifiable_delegation_still_requires_conditional_use(self):
        r=row('rule-90',['p1'],formTitle='지원 신청 위임장',use='additional',condition='대리 신청하는 경우')
        with self.assertRaisesRegex(ValueError,'Conditional form'):self.build({'p1':program('p1')},[r])
        self.assertEqual(self.build({'p1':program('p1')},[{**r,'use':'conditional'}])['rows'][0]['use'],'conditional')
    def test_audited_supporting_form_keeps_its_reviewed_role(self):
        audited=row('rule-7',['p1'],formTitle='[별지 제3호서식 사실확인 자료]',use='conditional',condition='필요한 경우',
            role='supporting',roleBasis='제5조제2항이 정한 신청인 작성 첨부서류임을 원문에서 확인했다.',
            roleEvidenceUrl='https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq=280315',roleCheckedAt='2026-10-16')
        output=self.build({'p1':program('p1')},[audited])
        self.assertEqual(output['forms']['rule-7']['role'],'supporting')
        self.assertEqual(output['auditedRoles']['rule-7']['role'],'supporting')
    def test_unidentified_title_without_complete_metadata_is_rejected(self):
        title='[별지 제1호서식] 수리 내역 자료'
        complete={'role':'supporting','roleBasis':'제6조제1항이 정한 신청인 작성 수리 내역 자료임을 확인했다.',
            'roleEvidenceUrl':'https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=976785','roleCheckedAt':'2026-10-16'}
        for drop,replace in [('role',None),('roleBasis',None),('roleEvidenceUrl',None),('roleCheckedAt',None),
                ('role','application'),('roleBasis','짧음'),('roleEvidenceUrl','https://example.com/form.hwp'),
                ('roleEvidenceUrl',EVIDENCE+'&OC=secret'),('roleCheckedAt','2026년 10월')]:
            metadata={key:value for key,value in complete.items() if key!=drop}
            if replace is not None:metadata[drop]=replace
            with self.subTest(field=drop,value=replace),self.assertRaises(ValueError) as caught:
                self.build({'p1':program('p1')},[row('ordin-11128481',['p1'],formTitle=title,**metadata)])
            self.assertIn('ordin-11128481',str(caught.exception))
        self.assertEqual(self.build({'p1':program('p1')},[row('ordin-11128481',['p1'],formTitle=title,**complete)])['rows'][0]['formId'],'ordin-11128481')
    def test_non_applicant_forms_stay_out(self):
        for label,record in [('기관용',row('rule-1',['p1'],formTitle='수리업체지정 신청서')),
                ('삭제',row('rule-2',['p1'],formTitle='삭제 2020. 3. 3.')),
                ('참고 선언',row('rule-3',['p1'],formTitle='[별지 제1호서식 수리 신청서]',role='reference',
                    roleBasis='원문을 확인했으나 신청인 작성 서식이 아니다.',roleEvidenceUrl=EVIDENCE,roleCheckedAt='2026-10-16')),
                ('기관 선언',row('rule-4',['p1'],formTitle='사회보장급여 신청(변경)서',role='administrative',
                    roleBasis='기관이 작성하는 서식으로 확인했다.',roleEvidenceUrl=EVIDENCE,roleCheckedAt='2026-10-16'))]:
            with self.subTest(case=label),self.assertRaises(ValueError):
                self.build({'p1':program('p1')},[record])
    def test_reference_annex_cannot_be_promoted_by_role_metadata(self):
        with self.assertRaises(ValueError):
            self.build({'p1':program('p1')},[row('rule-9',['p1'],formTitle='[별표 1] 지원 기준',role='supporting',
                roleBasis='검토 기록이 있어도 별표를 신청서로 제공하지 않는다.',roleEvidenceUrl=EVIDENCE,roleCheckedAt='2026-10-16')])
    def test_only_identified_full_body_exceptions_can_publish_selected_applicant_forms(self):
        audited=row('ordin-20002811',['p1'],sourceKind='ordin',lawId='1408662',formTitle='[별표 1] 장애인가정 출산지원금 지급 신청서',
            role='application',roleBasis='현행 조례 제5조제2항 및 실제 첨부 원본 전체 본문에서 신청인 작성 신청서임을 대조했다.',
            roleEvidenceUrl='https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=1408662',roleCheckedAt='2026-10-16',
            verificationStatus='verified',officialAttachmentMatched=True,sha256='a'*64,
            reviewedParts=[{'number':'별표 1','title':'출산지원금 지급 신청서','use':'main','author':'신청인'}])
        self.assertEqual(self.build({'p1':program('p1')},[audited])['forms'][audited['formId']]['role'],'application')
        for patch in ({'sha256':''},{'reviewedParts':[]},{'lawId':'999'},{'officialAttachmentMatched':False},{'verificationStatus':'candidate'}):
            with self.subTest(patch=patch),self.assertRaises(ValueError):self.build({'p1':program('p1')},[{**audited,**patch}])
        with self.assertRaises(ValueError):self.build({'p1':program('p1')},[{**audited,'formId':'ordin-999','annexId':'999'}])
    def test_audited_role_cannot_contradict_an_identified_title(self):
        with self.assertRaises(ValueError):
            self.build({'p1':program('p1')},[row('rule-1',['p1'],role='supporting',roleBasis='신청서가 아니라고 보았다.',
                roleEvidenceUrl=EVIDENCE,roleCheckedAt='2026-10-16')])
    def test_dormitory_entry_form_needs_the_same_full_body_hash_and_selected_parts_as_an_application(self):
        audited=row('ordin-90004',['p1'],sourceKind='ordin',lawId='88',formTitle='[별지 제1호서식] ~ [별지 제4호서식]',
            role='application',roleBasis='장학관 시행규칙 제7조와 원본 전체의 입사 지원자 및 보호자 서명을 대조했습니다.',
            roleEvidenceUrl='https://www.law.go.kr/ordinInfoP.do?ordinSeq=88',roleCheckedAt='2026-10-19',
            verificationStatus='verified',officialAttachmentMatched=True,sha256='a'*64,
            reviewedParts=[{'number':'1','title':'입사원서','use':'main','author':'입사를 지원하는 학생과 보호자'}])
        with self.assertRaises(ValueError):module.resolve_role(audited)
        with patch.dict(module.FULL_BODY_ROLE_OVERRIDES,{'ordin-90004':{'lawId':'88','role':'application','sha256':'a'*64}}):
            self.assertEqual(module.resolve_role(audited)[0],'application')
            for change in [{'sha256':'b'*64},{'lawId':'89'},{'officialAttachmentMatched':False},
                           {'reviewedParts':[{'number':'2','title':'입사생 관리대장','use':'main','author':'장학관 직원'}]}]:
                with self.subTest(change=change),self.assertRaises(ValueError):module.resolve_role({**audited,**change})
            for title in ['입사원서 접수대장','입사원서접수대장','신입사원서약서']:
                with self.subTest(title=title),self.assertRaises(ValueError):
                    module.resolve_role({**audited,'reviewedParts':[{'number':'2','title':title,'use':'main','author':'기관 직원'}]})
    def test_individually_read_reference_annex_can_be_a_consent_without_becoming_main_application(self):
        audited=row('ordin-19307191',['p1'],sourceKind='ordin',lawId='1872429',
            formTitle='[별표 1] 행정정보 공동이용 사전 동의서(제5조 관련)',role='consent',use='conditional',
            condition='행정정보 공동이용에 동의하는 경우에 작성한다.',
            roleBasis='제5조제3항의 별표1 지정과 실제 원본의 예방접종 이용사무 및 대상자 본인 서명란을 대조했다.',
            roleEvidenceUrl='https://www.law.go.kr/ordinInfoP.do?ordinSeq=1872429',roleCheckedAt='2026-10-17',
            verificationStatus='verified',officialAttachmentMatched=True,sha256='a'*64,
            reviewedParts=[{'number':'별표 1','title':'행정정보 공동이용 사전 동의서','use':'additional','author':'대상자 본인'}])
        output=self.build({'p1':program('p1')},[audited])
        self.assertEqual(output['forms'][audited['formId']]['role'],'consent')
        self.assertEqual(output['rows'][0]['use'],'conditional')
        for patch in ({'role':'application'},{'sha256':''},{'reviewedParts':[]},{'lawId':'999'}):
            with self.subTest(patch=patch),self.assertRaises(ValueError):self.build({'p1':program('p1')},[{**audited,**patch}])
    def test_agency_designation_form_is_excluded_with_a_program_note(self):
        output=self.build({'p1':program('p1')},[row('law-17831969',['p1'],sourceKind='law',formTitle='대리인 지정서',
            use='conditional',condition='대리 신청하는 경우')])
        self.assertEqual(output['rows'],[])
        self.assertEqual(output['forms'],{})
        self.assertEqual(output['excluded'][0]['formId'],'law-17831969')
        self.assertIn('대리인 지정서',output['programNotes']['p1'])
    def test_medical_opinion_form_keeps_its_reviewed_sentence(self):
        output=self.build({'p1':program('p1')},[row('law-17831955',['p1'],sourceKind='law',formTitle='의사소견서',
            use='conditional',condition='장기요양 인정 신청의 경우')])
        self.assertEqual(output['rows'][0]['condition'],'장기요양 인정 신청의 경우 의료인이 작성하는 서식으로, 본인이 임의 작성하지 않습니다.')
    def test_import_of_the_same_audit_is_reproducible(self):
        rounds=([row('rule-1',['p1'])],[row('ordin-2',['p2'],sourceKind='ordin',regionCode='36000',regionLabel='세종특별자치시')])
        programs={'p1':program('p1'),'p2':program('p2',scope='sigungu',region={'sido':'36000','sigungu':'36110'},laws=[SEJONG_ORDINANCE])}
        first=self.build(programs,*rounds);second=self.build(programs,*rounds)
        self.assertEqual(json.dumps(first,ensure_ascii=False),json.dumps(second,ensure_ascii=False))

class ScopeBasisTest(unittest.TestCase):
    def test_renamed_rule_reference_is_bound_to_one_program_and_official_history(self):
        prior='전라북도 저소득계층 임대보증금 지원조례 시행규칙'
        current='전북특별자치도 저소득계층과 청년 및 신혼부부 주거 지원 조례 시행규칙'
        p=program('g52190.p',scope='sigungu',region={'sido':'52000','sigungu':'52190'},laws=['전라북도 저소득계층 임대보증금 지원 조례'])
        ref={'kind':'exact-stable-ordinance-history','programId':p['id'],'formLawId':'2013333','stableLawId':'2143324',
             'priorLawId':'1043959','transitionLawId':'1903575','citedLawTitle':p['laws'][0],
             'priorRuleTitle':prior,'currentRuleTitle':current,'provinceCode':'52000','municipalityCode':'52190',
             'historyEvidenceUrl':'https://www.law.go.kr/ordinInfoP.do?ordinSeq=1043959',
             'transitionEvidenceUrl':'https://www.law.go.kr/ordinInfoP.do?ordinSeq=1903575',
             'currentEvidenceUrl':'https://www.law.go.kr/ordinInfoP.do?ordinSeq=2013333','checkedAt':'2026-10-19',
             'purposeArticleLink':'구 규칙 제1조의 상위 조례와 현행 규칙의 주민 신청 및 시장 접수 경로를 각각 전체 대조했습니다.',
             'transitionBasis':'공식 연혁에서 동일 자치법규ID를 가진 옛 판본, 명칭 변경 시점 판본, 현행 판본을 대조했습니다.',
             'scopeRestriction':'확인한 남원시 공공임대 보증금 무이자 지원 신청 및 연장 절차에만 이 법규 연혁을 적용합니다.'}
        r=row('ordin-90102',[p['id']],sourceKind='ordin',lawId='2013333',lawTitle=current,regionCode='52000',regionLabel='전북특별자치도',
              scopeBasis='provincial-law-reference',evidenceUrl=ref['currentEvidenceUrl'],checkedAt=ref['checkedAt'],
              verificationStatus='verified',officialAttachmentMatched=True,sha256='a'*64,renamedLawReference=ref)
        self.assertEqual(self.link(r,p)['renamedLawReference'],ref)
        for changes in [{'programId':'g52130.other'},{'formLawId':'99'},{'priorRuleTitle':'전라북도 다른 지원 조례'},
                        {'municipalityCode':'52130'},{'provinceCode':'41000'},{'stableLawId':''},{'stableLawId':'9999999'},{'checkedAt':'2026-10-18'},
                        {'historyEvidenceUrl':ref['historyEvidenceUrl']+'&OC=secret'},
                        {'historyEvidenceUrl':'https://www.law.go.kr/ordinInfoP.do?ordinSeq=999&ordinSeq=1043959'},
                        {'historyEvidenceUrl':ref['historyEvidenceUrl']+'&ordinSeq=999'},{'transitionBasis':''}]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):self.link({**r,'renamedLawReference':{**ref,**changes}},p)
        for changes in [{'laws':[]},{'id':'g52190.other'},{'region':{'sido':'41000','sigungu':'41280'}}]:
            with self.subTest(changes=changes),self.assertRaises(ValueError):self.link(r,{**p,**changes})
        with self.assertRaises(ValueError):self.link({**r,'renamedLawReference':None},p)
        with self.assertRaises(ValueError):self.link({**r,'verificationStatus':'candidate'},p)
        # Invalid history metadata must not be ignored even for a normal direct citation.
        with self.assertRaises(ValueError):self.link({**r,'renamedLawReference':{**ref,'programId':'different'}},{**p,'laws':[current]})
    def test_old_province_name_is_compared_only_within_the_same_province_code(self):
        r=row('ordin-90100',['g51110.p'],sourceKind='ordin',lawTitle='강원특별자치도 출산·양육 지원 조례 시행규칙',
            regionCode='51000',regionLabel='강원특별자치도',scopeBasis='provincial-law-reference')
        p=program('g51110.p',scope='sigungu',region={'sido':'51000','sigungu':'51110'},laws=['강원도 출산·양육 지원 조례(제13조, 제1항)'])
        self.assertEqual(self.link(r,p)['scopeBasis'],'provincial-law-reference')
        with self.assertRaises(ValueError):self.link(r,{**p,'region':{'sido':'52000','sigungu':'52110'}})
        with self.assertRaises(ValueError):self.link(r,{**p,'laws':['강원도 다른 지원 조례']})
        direct={**p,'scope':'sido','region':{'sido':'51000'}}
        self.assertNotIn('scopeBasis',self.link(r,direct))
    def test_a_municipal_form_for_a_provincial_benefit_requires_its_exact_local_route(self):
        p=program('s41000.test',scope='sido',region={'sido':'41000'},url='https://www.gov.kr/portal/rcvfvrSvc/dtlEx/EXACT')
        ref={'sido':'41000','sigungu':'41170','municipality':'안양시','programEvidenceUrl':p['url'],
            'checkedAt':'2026-10-16','httpStatus':200,'programSpecific':True,
            'reference':'공식 도 사업 안내는 안양시 담당부서와 거주지 시군 방문 신청 절차를 구체적으로 명시한다.',
            'municipalArticle':'안양시 학생복지 지원 조례 제7조',
            'formEvidence':'원본의 안양시 학생 주소와 신청인 서명 및 안양시장 수신 부분을 모두 확인했다.',
            'scopeRestriction':'안양시 거주자의 안양시 방문 접수 전용'}
        r=row('ordin-90002',[p['id']],sourceKind='ordin',lawTitle='안양시 학생복지 지원 조례',lawId='88',
            regionCode='41170',regionLabel='경기도 안양시',use='conditional',condition='안양시 거주자의 안양시 접수에만 사용한다.',
            verificationStatus='verified',officialAttachmentMatched=True,sha256='a'*64,
            programEvidenceUrl=p['url'],municipalApplicationReference=ref)
        out=self.link(r,p)
        self.assertEqual(out['scopeBasis'],'municipal-application-reference')
        self.assertEqual(out['municipalApplicationReference']['sigungu'],'41170')
        for change in [{'use':'main'},{'condition':'모든 도민 사용'},{'programEvidenceUrl':p['url']+'OTHER'},
                       {'verificationStatus':'candidate'},{'sha256':''}]:
            with self.subTest(change=change),self.assertRaises(ValueError):self.link({**r,**change},p)
        for change in [{'sido':'43000'},{'sigungu':'41280'},{'municipalArticle':'다른 시 학생복지 조례 제7조'},
                       {'scopeRestriction':'도내 모든 주민 사용'},{'programSpecific':False}]:
            bad=copy.deepcopy(r);bad['municipalApplicationReference'].update(change)
            with self.subTest(change=change),self.assertRaises(ValueError):self.link(bad,p)

    def link(self,record,program_record):
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        file=Path(temp.name)/'national-reviewed.json'
        file.write_text(json.dumps({'rows':[record]},ensure_ascii=False),encoding='utf-8')
        return module.build({program_record['id']:program_record},[file])['rows'][0]
    def sejong(self,**extra):
        return program('g36110.p',scope='sigungu',region={'sido':'36000','sigungu':'36110'},laws=[SEJONG_ORDINANCE],**extra)
    def ordinance(self,**extra):
        return row('ordin-19985959',['g36110.p'],sourceKind='ordin',lawTitle=SEJONG_ORDINANCE,regionCode='36000',
            regionLabel='세종특별자치시',formTitle='[별지 제1호서식] 여성장애인 출산 지원 신청서',**extra)
    def test_provincial_basis_is_derived_only_when_the_program_cites_the_form_law(self):
        self.assertEqual(self.link(self.ordinance(),self.sejong())['scopeBasis'],'provincial-law-reference')
        other=self.sejong();other['laws']=['세종특별자치시 아동수당 지원 조례']
        self.assertNotIn('scopeBasis',self.link(self.ordinance(),other))
    def test_audited_national_basis_is_preserved_when_region_and_law_support_it(self):
        program_record=program('g41310.p',scope='sigungu',region={'sido':'41000','sigungu':'41310'},laws=[NATIONAL_LAW])
        link=self.link(row('rule-3211495',['g41310.p'],scopeBasis='national-law-reference'),program_record)
        self.assertEqual(link['scopeBasis'],'national-law-reference')
    def test_audited_basis_without_a_cited_law_is_rejected(self):
        program_record=program('g41310.p',scope='sigungu',region={'sido':'41000','sigungu':'41310'},laws=['경기도 구리시 장애인 이동기기 수리 등에 관한 조례'])
        with self.assertRaises(ValueError) as caught:
            self.link(row('rule-3211495',['g41310.p'],scopeBasis='national-law-reference'),program_record)
        self.assertIn('rule-3211495',str(caught.exception))
    def test_audited_basis_against_the_wrong_region_is_rejected(self):
        # 전국 서식에 도 조례 근거를 적을 수는 없다.
        with self.assertRaises(ValueError):
            self.link(row('rule-3211495',['g41310.p'],scopeBasis='provincial-law-reference'),
                program('g41310.p',scope='sigungu',region={'sido':'41000','sigungu':'41310'},laws=[NATIONAL_LAW]))
        # 전국 사업에는 다른 관할 근거 자체가 성립하지 않는다.
        with self.assertRaises(ValueError):
            self.link(row('rule-3211495',['p1'],scopeBasis='national-law-reference'),program('p1'))
    def test_unknown_audited_basis_is_rejected(self):
        with self.assertRaises(ValueError) as caught:
            self.link(self.ordinance(scopeBasis='same-metropolitan-area'),self.sejong())
        self.assertIn('same-metropolitan-area',str(caught.exception))

if __name__=='__main__':unittest.main()

"""Match every published welfare record against the collected official annex index.

This produces review candidates, never automatic publication approvals.
"""
import argparse, importlib.util, json, re, sqlite3, sys, unicodedata
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('portal_match',ROOT/'pipeline/forms/portal_match.py')
matching=importlib.util.module_from_spec(spec);spec.loader.exec_module(matching)
ROLES={'application','consent','delegation','supporting'}
MERGED_SIDO='12000'  # Same dataset convention as src/lib/data/legacyArea.ts.
FORMER_GWANGJU={'12210','12240','12270','12300','12330'}

def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
def day(value):
    value=str(value or '')
    return f'{value[:4]}-{value[4:6]}-{value[6:8]}' if re.fullmatch(r'\d{8}',value) else value
def flatten_laws(program):
    return [part for value in program.get('laws',[]) for part in matching.split_law_citations(value)]
def unnamed(form):
    title=unicodedata.normalize('NFKC',form.get('title',''))
    return form.get('declaredKind')=='서식' and (not title.strip() or bool(re.fullmatch(r'[\s\[\]별지제호서식\d의~∼ㆍ·()<>-]+',title)))
def index_role(form):
    return 'unclassified' if unnamed(form) else matching.classify_role(form.get('title'),form.get('declaredKind'))

def resolve_authority(form,provinces):
    if form['regionCode']!='unresolved':return form
    resolved=dict(form);authority=form['regionLabel'].replace(' ','')
    education=authority.endswith('교육청')
    if education:authority=authority[:-3];resolved['authorityType']='education'
    legacy={'(구)광주광역시':'gwangju','(구)전라남도':'jeonnam'}.get(authority)
    if legacy:
        resolved['regionCode']=MERGED_SIDO;resolved['legacyArea']=legacy
    elif authority in provinces:resolved['regionCode']=provinces[authority]
    return resolved

def authority_applies(program,form,law_cited):
    if form.get('authorityType')=='education' and program.get('orgType')!='edu_office' and not law_cited:return False
    legacy=form.get('legacyArea')
    if not legacy:return True
    region=program.get('region',{})
    if region.get('sido')!=MERGED_SIDO:return False
    if program['scope']=='sigungu':return legacy==('gwangju' if region.get('sigungu') in FORMER_GWANGJU else 'jeonnam')
    areas=set()
    for source in program.get('sources',[]):
        if source.get('source')!='gov24':continue
        if str(source.get('id','')).startswith('6290000'):areas.add('gwangju')
        if str(source.get('id','')).startswith('6460000'):areas.add('jeonnam')
    if not areas:
        text=(program['name']+' '+str(program.get('owner',''))).replace('전남광주통합특별시',' ')
        if re.search(r'광주\s*광역시|광주형|광주다움|광주\s*청년|빛고을',text):areas.add('gwangju')
        if re.search(r'전라\s*남도|전남',text):areas.add('jeonnam')
    return legacy in areas if areas else law_cited

def region_catalog(regions):
    sigungus={}
    for row in regions['sidos']:
        sido_code=str(row['code'])
        for city in row.get('sigungus') or []:
            sigungus[str(city['code'])]=(sido_code,row['name'],city['name'])
    return sigungus
def program_geography(program,catalog):
    if not isinstance(program,dict) or not isinstance(catalog,dict):return None
    if program.get('scope')!='sigungu':return None
    region=program.get('region') or {}
    city=catalog.get(str(region.get('sigungu') or ''))
    if not city or city[0]!=str(region.get('sido') or ''):return None
    return {'sido':city[1],'sigungu':city[2]}
def cited_law_keys(program,geography):
    found=[]
    for law in flatten_laws(program):
        for alias in matching.law_aliases(law,geography):
            for variant in matching.law_variants(alias):
                if variant not in found:found.append(variant)
    return found
def compare_form(program,form,cited):
    law_cited=matching.normalize_law(form['lawTitle']) in cited
    if not authority_applies(program,form,law_cited):return False,None
    candidate=matching.evaluate_candidate(program,form)
    region=program.get('region') or {}
    scope=program['scope']
    code='national' if scope=='national' else region.get('sido' if scope=='sido' else 'sigungu')
    province_ref=scope=='sigungu' and form['regionCode']==region.get('sido') and law_cited
    exact_place=form['regionCode']==code
    national_ref=form['regionCode']=='national' and law_cited
    if not candidate and province_ref and form['role'] in ROLES:
        candidate={'formId':form['id'],'score':25,'reason':'사업이 인용한 같은 시·도 조례의 서식으로 적용 여부를 확인해야 합니다.','basis':'law_reference','scopeBasis':'provincial_law_reference'}
    if not candidate and form['unnamed'] and law_cited and (exact_place or province_ref or national_ref):
        candidate={'formId':form['id'],'score':1,'reason':'근거 법령에 명칭이 없는 서식이 있어 내용 확인이 필요합니다.','basis':'unnamed_annex','scopeBasis':'law_reference'}
    return True,candidate
def audited_laws(audit,program_ids):
    """Keep only complete, actually read law identities for their cited programs."""
    expected=set(program_ids)
    if not isinstance(audit,dict) or audit.get('schema')!=1:
        raise ValueError('Law audit schema must be 1')
    records=audit.get('laws');programs=audit.get('programs')
    if not isinstance(records,dict) or not isinstance(programs,dict) or set(programs)!=expected:
        raise ValueError('Law audit must account for every program ID exactly')
    found={}
    for program_id,item in programs.items():
        keys=item.get('lawKeys') if isinstance(item,dict) else None
        if not isinstance(keys,list) or any(not isinstance(key,str) for key in keys):
            raise ValueError('Law audit lawKeys must be a list of evidence keys')
        if len(keys)!=len(set(keys)) or any(key not in records for key in keys):
            raise ValueError('Law audit has duplicate or missing evidence keys')
        identities=[];seen=set()
        for key in keys:
            record=records[key]
            if not isinstance(record,dict) or record.get('state')!='read':continue
            kind=record.get('kind');identifier=str(record.get('id') or '')
            title=record.get('title')
            if kind not in {'ordin','law','rule'} or not re.fullmatch(r'[0-9]+',identifier):continue
            if not isinstance(title,str) or not title.strip():continue
            title=title.strip();identity=(kind,identifier,matching.normalize_law(title))
            if identity in seen:continue
            seen.add(identity);identities.append({'kind':kind,'id':identifier,'title':title})
        found[program_id]=identities
    return found

def program_with_audited_laws(program,laws):
    """Enrich an evaluation-only copy; original bundle data remains untouched."""
    evaluation=dict(program)
    original=program.get('laws') or []
    evaluation['laws']=[original] if isinstance(original,str) else list(original)
    titles={matching.normalize_law(title) for title in evaluation['laws']}
    for law in laws:
        title=law['title'];key=matching.normalize_law(title)
        if key not in titles:
            evaluation['laws'].append(title);titles.add(key)
    return evaluation

def identity_form_pool(index,laws,cache):
    """Use the same official-index pool, indexed by kind and law ID together."""
    pool={}
    for law in laws:
        identity=(law['kind'],law['id'])
        if identity not in cache:
            cache[identity]=[json.loads(row[0]) for row in index.execute(
                'SELECT payload FROM forms WHERE source_kind=? AND law_id=?',identity)]
        for form in cache[identity]:pool[form['id']]=form
    return pool

def create_match_tables(index):
    index.executescript('DROP TABLE IF EXISTS search; DROP TABLE IF EXISTS forms; '
        'CREATE TABLE forms(id TEXT PRIMARY KEY,region TEXT,law TEXT,role TEXT,source_kind TEXT,law_id TEXT,payload TEXT); '
        'CREATE INDEX form_law ON forms(law); CREATE INDEX form_region ON forms(region); '
        'CREATE INDEX form_source_identity ON forms(source_kind,law_id); '
        'CREATE VIRTUAL TABLE search USING fts5(id UNINDEXED,title,region UNINDEXED,tokenize="unicode61");')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--allow-incomplete',action='store_true')
    parser.add_argument('--source-dir',type=Path,default=ROOT/'logs/law-scan',help='Existing collected portal index (read only); match cache stays in this checkout')
    parser.add_argument('--law-audit',type=Path,default=None,help='Read law identity evidence; defaults to pipeline/forms/law-body-audit.json when present')
    args=parser.parse_args()
    programs={}
    for file in sorted((ROOT/'public/bundles/v1/details').glob('*.json')):programs.update(read(file))
    audit_path=args.law_audit or ROOT/'pipeline/forms/law-body-audit.json'
    # Validate before rebuilding the index. An absent optional default preserves
    # existing matching; a missing explicitly requested audit remains an error.
    audit_used=args.law_audit is not None or audit_path.exists()
    read_laws=audited_laws(read(audit_path),programs) if audit_used else {}
    folder=ROOT/'logs/law-scan';folder.mkdir(parents=True,exist_ok=True)
    source_folder=args.source_dir.resolve();state=read(source_folder/'collection-status.json')
    if state['status']!='complete' and not args.allow_incomplete:raise RuntimeError('Complete portal index required before final matching')
    state['status']='complete' if state['status']=='complete' else 'incomplete'
    regions=read(ROOT/'public/bundles/v1/regions.json');catalog=region_catalog(regions)
    provinces={row['name'].replace(' ',''):row['code'] for row in regions['sidos']}
    source=sqlite3.connect((source_folder/'annexes.sqlite').as_uri()+'?mode=ro',uri=True)
    index=sqlite3.connect(folder/'match-index.sqlite')
    create_match_tables(index)
    indexed=0;eligible=0;unknown=0
    for record_id,payload in source.execute('SELECT id,payload FROM annexes ORDER BY id'):
        form=resolve_authority(json.loads(payload),provinces);indexed+=1
        form['role']=index_role(form)
        is_unnamed=unnamed(form)
        if form['regionCode']=='unresolved':unknown+=1;continue
        if form['role'] not in ROLES and not is_unnamed:continue
        form['effectiveDate']=day(form.get('effectiveDate'));form['unnamed']=is_unnamed
        if not form.get('sourceUrl'):form['sourceUrl']=form.get('officialPdfUrl') or form['lawUrl']
        law=matching.normalize_law(form['lawTitle']);text=unicodedata.normalize('NFKC',form['title'])
        index.execute('INSERT INTO forms VALUES(?,?,?,?,?,?,?)',(record_id,form['regionCode'],law,form['role'],
            form.get('sourceKind',''),str(form.get('lawId') or ''),json.dumps(form,ensure_ascii=False)))
        index.execute('INSERT INTO search(id,title,region) VALUES(?,?,?)',(record_id,text,form['regionCode']))
        eligible+=1
        if indexed%10000==0:index.commit()
    index.commit();source.close()
    print(json.dumps({'event':'indexed','portalForms':indexed,'candidateEligibleForms':eligible,'unresolvedJurisdiction':unknown,
        'lawAuditUsed':audit_used,'programsWithReadLawEvidence':sum(bool(laws) for laws in read_laws.values())}),flush=True)
    existing=read(ROOT/'pipeline/forms/reviewed-links.json')['rows']
    additional=[]
    for path in sorted((ROOT/'pipeline/forms/reviews').iterdir()):
        if path.is_file() and re.fullmatch(r'(national|municipal)-reviewed(?:-round\d+)?\.json',path.name):
            data=read(path);additional.extend(data['rows'] if isinstance(data,dict) else data)
    reviewed_ids={row['formId'] for row in existing+additional}
    matched_ids=set(reviewed_ids);result={};law_cache={};identity_cache={};evaluated=0
    checked_at=datetime.now(timezone.utc).isoformat()
    for program_id,program in sorted(programs.items()):
        geography=program_geography(program,catalog)
        cited_keys=cited_law_keys(program,geography)
        identities=read_laws.get(program_id,[])
        program=program_with_audited_laws(program,identities)
        pool=identity_form_pool(index,identities,identity_cache)
        cited=set(cited_law_keys(program,geography))
        # Keep the original text-based pool unchanged. Newly resolved titles are
        # evaluation evidence; their additive pool comes only from exact IDs.
        for variant in cited_keys:
            if variant not in law_cache:law_cache[variant]=[json.loads(row[0]) for row in index.execute('SELECT payload FROM forms WHERE law=?',(variant,))]
            for form in law_cache[variant]:pool[form['id']]=form
        code='national' if program['scope']=='national' else program.get('region',{}).get('sido' if program['scope']=='sido' else 'sigungu')
        tokens=[re.sub(r'[^0-9a-zA-Z가-힣]','',token) for token in matching.program_tokens(program)]
        tokens=[token for token in tokens if len(token)>=2]
        if tokens and code:
            query=' OR '.join('"'+token+'"*' for token in tokens)
            for row in index.execute('SELECT forms.payload FROM search JOIN forms ON forms.id=search.id WHERE search MATCH ? AND forms.region=?',(query,code)):
                form=json.loads(row[0]);pool[form['id']]=form
        candidates={}
        for form in pool.values():
            compared,candidate=compare_form(program,form,cited)
            if not compared:continue
            evaluated+=1
            if candidate:candidates[form['id']]=candidate;matched_ids.add(form['id'])
        ordered=sorted(candidates.values(),key=lambda row:(-row['score'],row['formId']))
        result[program_id]={'checkedAt':checked_at,'outcome':'candidate' if ordered else 'not_found','candidateCount':len(ordered),'method':'full-index','candidates':ordered}
        if len(result)%2000==0:print(json.dumps({'event':'matched','programs':len(result),'withCandidates':sum(bool(r['candidates']) for r in result.values()),'candidateComparisons':evaluated}),flush=True)
    raw_source=sqlite3.connect((source_folder/'annexes.sqlite').as_uri()+'?mode=ro',uri=True)
    forms={}
    for form_id in sorted(matched_ids):
        record=raw_source.execute('SELECT payload FROM annexes WHERE id=?',(form_id,)).fetchone()
        if not record:continue
        form=resolve_authority(json.loads(record[0]),provinces);form['role']=index_role(form);form['effectiveDate']=day(form.get('effectiveDate'))
        if not form['title'].strip():form['title']=f"{form['lawTitle']} 별지 {form['annexNumber']} (명칭 미제공)"
        if not form.get('sourceUrl'):form['sourceUrl']=form.get('officialPdfUrl') or form['lawUrl']
        forms[form_id]=form
    raw_source.close();index.close()
    output=ROOT/'pipeline/forms'
    scan={'status':state['status'],'indexedForms':state['storedUnique'],'checkedPrograms':len(result),'checkedAt':checked_at,'sources':[{'kind':kind,'total':info['total'],'collected':info['rows']} for kind,info in state['sources'].items()], 'candidateEligibleForms':eligible,'unresolvedJurisdiction':unknown,'candidateComparisons':evaluated,'matchedPrograms':sum(bool(row['candidates']) for row in result.values()),'matchedForms':len(forms),'collectionStartedAt':state['startedAt'],'collectionFinishedAt':state.get('finishedAt'),'duplicateRows':state.get('duplicateRows',0)}
    for name,data in [('portal-scan.json',scan),('portal-matches.json',{'schema':1,'programs':result}),('portal-forms.json',{'schema':1,'forms':forms})]:
        (output/name).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    print(json.dumps({'event':'finished',**scan}),flush=True)

if __name__=='__main__':main()

"""Compare saved source editions with the official current-law list (nw=1).

An old MST body can still be downloaded. Its existence does not establish that
the same annex remains in the current edition. This audit records that distinction
without approving a benefit association or automatically deleting an old form.
Guide: https://open.law.go.kr/LSO/openApi/guideResult.do?htmlName=ordinListGuide
"""
import argparse
from collections import Counter,defaultdict
import concurrent.futures
from datetime import date
import importlib.util
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('source_laws',ROOT/'scripts/collect-unmatched-form-laws.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
a=c._audit


def classify(source,rows,as_of):
    matches={}
    for row in rows:
        title,lid,org,_,_=a.row_identity(row,'ordin')
        stable=a.pick(row,'자치법규ID')
        exact=(lid==source['lawId'] or (stable and stable==source.get('stableLawId'))
               or (a.loose_key(title)==a.loose_key(source['lawTitle']) and a.loose_key(org)==a.loose_key(source['orgName'])))
        if exact and lid:matches[lid]={'lawId':lid,'stableLawId':stable,'title':title,'org':org,'effectiveDate':a.pick(row,'시행일자')}
    if not matches:return {'state':'requires_current_law_lookup','candidates':[]}
    effective={lid:row for lid,row in matches.items() if len(row['effectiveDate'])==8 and row['effectiveDate']<=as_of.replace('-','')}
    if not effective:return {'state':'future_or_undated_current_result','candidates':list(matches.values())}
    if len(effective)!=1:return {'state':'ambiguous_current_result','candidates':list(matches.values())}
    current=next(iter(effective.values()))
    return {'state':'source_current' if current['lawId']==source['lawId'] else 'newer_current_version',
            'currentLawId':current['lawId'],'currentLaw':current,'candidates':list(matches.values())}


def search_query(portal,title):
    rows=[];raw=[];page=1
    while True:
        text,url=portal.fetch('lawSearch.do',{'type':'JSON','target':'ordin','nw':'1','query':title,
                                            'display':'100','page':str(page),'search':'1'})
        payload=a.parse_json(text);body=payload.get('OrdinSearch')
        if not isinstance(body,dict) or str(body.get('resultCode','')) not in ('00','0'):
            raise RuntimeError('CURRENT_SEARCH_RESPONSE_INVALID')
        try:total=int(body['totalCnt'])
        except (ValueError,TypeError,KeyError):raise RuntimeError('CURRENT_SEARCH_TOTAL_MISSING') from None
        part=a.search_rows(payload,'ordin');rows.extend(part);raw.append({'url':url,'payload':payload})
        if page*100>=total:break
        if not part or page>=20:raise RuntimeError('CURRENT_SEARCH_PAGINATION_INCOMPLETE')
        page+=1
    if len(rows)!=total:raise RuntimeError('CURRENT_SEARCH_RESULT_COUNT_MISMATCH')
    return rows,raw


def current_search(portal,title):
    rows,raw=search_query(portal,title)
    # NFKC turns the Korean middle dot ㆍ into the Jamo ᆞ. The official
    # search index does not consistently accept that equivalent character.
    # Change only the search spelling; identity matching remains strict.
    if not rows and 'ᆞ' in title:
        rows,extra=search_query(portal,title.replace('ᆞ','ㆍ'));raw.extend(extra)
    return rows,raw


def inspect(law_id,forms,portal,redactor,body_dir,out,as_of,refresh):
    path=out/'cache'/f'{law_id}.json.gz'
    if not refresh and path.exists():
        import gzip
        with gzip.open(path,'rt',encoding='utf-8') as f:cached=json.load(f)
        if (cached.get('checkedAt')==as_of and cached.get('state')!='failed'
            and (cached.get('state')!='requires_current_law_lookup' or cached.get('queryVariantsChecked'))):return cached
    source=c.read_body(body_dir/f'{law_id}.json.gz',law_id)
    if not source:return {'lawId':law_id,'state':'failed','reason':'SAVED_SOURCE_BODY_UNAVAILABLE','checkedAt':as_of}
    record={'lawId':law_id,'sourceTitle':source['lawTitle'],'checkedAt':as_of}
    try:
        rows,raw=current_search(portal,source['lawTitle']);record.update(classify(source,rows,as_of),rawSearch=raw,queryVariantsChecked=True)
        if record.get('currentLawId'):
            lid=record['currentLawId'];latest=c.read_body(body_dir/f'{lid}.json.gz',lid)
            if not latest:latest=c.read_body(out/'latest-law-bodies'/f'{lid}.json.gz',lid)
            if not latest:
                latest,error=c.fetch_body({'lawId':lid},portal)
                if not latest:raise RuntimeError(error or 'CURRENT_BODY_UNAVAILABLE')
                c.write_gz(out/'latest-law-bodies'/f'{lid}.json.gz',latest,redactor)
            record['currentBodyArticleState']='available' if latest['articles'] else 'missing'
            record['currentBodyUrl']=latest['publicUrl']
            record['forms']={form['formId']:c.bind_annex(form,latest) for form in forms}
    except Exception as error:
        record.update(state='failed',reason=redactor.text(str(error))[:200])
    c.write_gz(path,record,redactor)
    return record


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scope',type=Path,default=ROOT/'pipeline/forms/reviews/unmatched-originals-scope.json')
    parser.add_argument('--body-dir',type=Path,default=ROOT/'logs/forms-completion/law-bodies')
    parser.add_argument('--out-dir',type=Path,default=ROOT/'logs/forms-completion/currency')
    parser.add_argument('--output',type=Path,default=ROOT/'pipeline/forms/source-law-currency.json')
    parser.add_argument('--workers',type=int,default=4)
    parser.add_argument('--interval',type=float,default=.6)
    parser.add_argument('--max-laws',type=int,default=0)
    parser.add_argument('--refresh',action='store_true')
    args=parser.parse_args();scope=c.load_scope(args.scope);groups=defaultdict(list)
    for form in scope['forms'].values():groups[form['lawId']].append(form)
    as_of=date.today().isoformat();credential=c.load_credential();redactor=c.Redactor(credential)
    portal=c.Portal(credential,interval=max(.4,args.interval),redactor=redactor)
    laws=sorted(groups,key=int);selected=laws[:args.max_laws] if args.max_laws else laws;results={}
    def publish():
        compact={lid:{k:v for k,v in record.items() if k!='rawSearch'} for lid,record in results.items()}
        states=Counter(record['state'] for record in compact.values());bindings=Counter()
        for record in compact.values():bindings.update(v['binding'] for v in record.get('forms',{}).values())
        payload={'schema':1,'checkedAt':as_of,'scopeForms':len(scope['forms']),'scopeLaws':len(laws),
            'checkedLaws':len(results),'pendingLaws':len(laws)-len(results),'counts':dict(states),
            'currentAnnexBindings':dict(bindings),'note':'Current-list evidence only; no semantic approval. Not-found or changed editions require individual follow-up.',
            'laws':compact}
        c.write_json(args.output,payload,redactor,indent=1)
        print(json.dumps({k:v for k,v in payload.items() if k not in ('laws','note')},ensure_ascii=False),flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,args.workers)) as pool:
        tasks={pool.submit(inspect,lid,groups[lid],portal,redactor,args.body_dir,args.out_dir,as_of,args.refresh):lid for lid in selected}
        for future in concurrent.futures.as_completed(tasks):
            lid=tasks[future]
            try:results[lid]=future.result()
            except Exception as error:results[lid]={'lawId':lid,'checkedAt':as_of,'state':'failed','reason':redactor.text(str(error))[:200]}
            if len(results)%20==0:publish()
    publish()


if __name__=='__main__':main()

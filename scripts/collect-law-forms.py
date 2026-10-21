"""Resumeable official law.go.kr annex index. Credentials never enter cached files/logs."""
import argparse, concurrent.futures, gzip, json, math, os, sqlite3, threading, time, tomllib, unicodedata, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = {'licbyl': ('law', 'licbyl'), 'ordinbyl': ('ordin', 'ordinbyl'), 'admbyl': ('rule', 'admrulbyl')}

def now(): return datetime.now(timezone.utc).isoformat()
def normalized(text): return ''.join(unicodedata.normalize('NFKC', str(text or '')).split())
def public_url(value):
    if not value: return None
    url = urllib.parse.urlsplit(urllib.parse.urljoin('https://www.law.go.kr', str(value)))
    if url.hostname not in {'www.law.go.kr', 'law.go.kr'}: return None
    query = urllib.parse.urlencode([(k,v) for k,v in urllib.parse.parse_qsl(url.query, keep_blank_values=True) if k.lower() not in {'oc','key','token','servicekey'}])
    return urllib.parse.urlunsplit(('https',url.netloc,url.path,query,url.fragment))

class Portal:
    def __init__(self, interval):
        self.oc = os.environ.get('LAW_OC')
        if not self.oc:
            config = tomllib.loads((Path(os.environ['USERPROFILE'])/'.codex/config.toml').read_text(encoding='utf-8'))
            self.oc = config.get('mcp_servers',{}).get('korean-law',{}).get('env',{}).get('LAW_OC')
        if not self.oc: raise RuntimeError('Configured LAW_OC is not available')
        self.lock=threading.Lock();self.next_request=0;self.interval=interval
    def fetch(self,target,page):
        params={'OC':self.oc,'type':'JSON','target':target,'display':'100','page':str(page),'query':'*','search':'1'}
        for attempt in range(4):
            with self.lock:
                delay=max(0,self.next_request-time.monotonic())
                self.next_request=max(self.next_request,time.monotonic())+self.interval
            if delay: time.sleep(delay)
            request=urllib.request.Request('https://www.law.go.kr/DRF/lawSearch.do?'+urllib.parse.urlencode(params),headers={'User-Agent':'BokjiCompass/1.0 (public welfare form index)','Accept-Encoding':'gzip'})
            try:
                with urllib.request.urlopen(request,timeout=50) as response:
                    raw=response.read()
                    if response.headers.get('Content-Encoding')=='gzip':raw=gzip.decompress(raw)
                data=json.loads(raw.decode('utf-8'))
                body=next(value for value in data.values() if isinstance(value,dict) and 'totalCnt' in value)
                rows=body.get(TARGETS[target][1],[])
                if isinstance(rows,dict): rows=[rows]
                return int(body['totalCnt']),rows
            except urllib.error.HTTPError as error:
                if error.code in {401,403}: raise RuntimeError('PORTAL_AUTHORIZATION_FAILED') from None
                if error.code not in {429,500,502,503,504}: raise RuntimeError('PORTAL_HTTP_'+str(error.code)) from None
                pause=error.headers.get('Retry-After','')
                time.sleep(min(60,int(pause)) if pause.isdigit() else min(30,2**(attempt+1)))
            except (TimeoutError,OSError,ValueError,StopIteration):
                if attempt==3: break
                time.sleep(2**(attempt+1))
        raise RuntimeError('PORTAL_REQUEST_INCOMPLETE')

def region_map():
    data=json.loads((ROOT/'public/bundles/v1/regions.json').read_text(encoding='utf-8'))
    full={};unique={}
    for province in data['sidos']:
        full[normalized(province['name'])]=(province['code'],province['name'])
        for city in province['sigungus']:
            label=province['name']+' '+city['name']
            full[normalized(label)]=(city['code'],label)
            unique.setdefault(normalized(city['name']),[]).append((city['code'],label))
    return full,unique

def normalize_row(target,row,full,unique):
    prefix=TARGETS[target][0];annex=str(row.get('별표일련번호',''))
    if not annex.isdigit(): raise ValueError('Missing annex identifier')
    if target=='ordinbyl':
        law_title=row.get('관련자치법규명','');law_id=str(row.get('관련자치법규일련번호',''))
        authority=row.get('전체기관명') or row.get('지자체기관명') or ''
        region=full.get(normalized(authority))
        if not region and not row.get('전체기관명'):
            candidates=unique.get(normalized(row.get('지자체기관명','')),[])
            if len(candidates)==1:region=candidates[0]
        region_code,region_label=region or ('unresolved',authority)
        effective=str(row.get('자치법규시행일자',''))
        law_url='https://www.law.go.kr/ordinInfoP.do?ordinSeq='+law_id
    elif target=='licbyl':
        law_title=row.get('관련법령명','');law_id=str(row.get('관련법령일련번호',''))
        region_code,region_label='national','전국 공통'
        effective=str(row.get('공포일자',''))
        law_url='https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq='+law_id
    else:
        law_title=row.get('관련행정규칙명','');law_id=str(row.get('관련행정규칙일련번호',''))
        region_code,region_label='national','전국 공통'
        effective=str(row.get('발령일자',''))
        law_url='https://www.law.go.kr/LSW/admRulInfoP.do?admRulSeq='+law_id
    return {'id':prefix+'-'+annex,'sourceKind':prefix,'title':str(row.get('별표명','')),'declaredKind':str(row.get('별표종류','')),
        'lawTitle':str(law_title),'lawId':law_id,'stableLawId':str(row.get('관련법령ID','')),'annexId':annex,'annexNumber':str(row.get('별표번호','')),
        'regionCode':region_code,'regionLabel':region_label,'effectiveDate':effective,
        'dateKind':'effective' if target=='ordinbyl' else 'promulgated' if target=='licbyl' else 'issued',
        'sourceUrl':public_url(row.get('별표서식파일링크')),'officialPdfUrl':public_url(row.get('별표서식PDF파일링크')),
        'lawUrl':law_url,'fetchedAt':now()}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--workers',type=int,default=4);parser.add_argument('--interval',type=float,default=.4);args=parser.parse_args()
    folder=ROOT/'logs/law-scan';cache=folder/'pages';cache.mkdir(parents=True,exist_ok=True)
    portal=Portal(args.interval);full,unique=region_map()
    db=sqlite3.connect(folder/'annexes.sqlite');db.execute('PRAGMA journal_mode=WAL')
    db.execute('CREATE TABLE IF NOT EXISTS annexes (id TEXT PRIMARY KEY, source_kind TEXT, region_code TEXT, law_norm TEXT, title TEXT, payload TEXT)')
    db.execute('CREATE INDEX IF NOT EXISTS annex_law_idx ON annexes(law_norm)');db.execute('CREATE INDEX IF NOT EXISTS annex_region_idx ON annexes(region_code)')
    state={'startedAt':now(),'status':'running','sources':{},'errors':[],'duplicateRows':0,'requestsPerSecondMaximum':round(1/args.interval,2)}
    seen_ids=set()
    def write_state():
        state['updatedAt']=now();state['storedUnique']=db.execute('SELECT COUNT(*) FROM annexes').fetchone()[0]
        temp=folder/'collection-status.tmp';temp.write_text(json.dumps(state,ensure_ascii=False,indent=2),encoding='utf-8');temp.replace(folder/'collection-status.json')
    def page(target,number):
        filename=cache/f'{target}-{number:05}.json.gz'
        if filename.exists():
            with gzip.open(filename,'rt',encoding='utf-8') as file:return json.load(file)
        total,raw=portal.fetch(target,number)
        result={'target':target,'page':number,'total':total,'rows':[normalize_row(target,row,full,unique) for row in raw]}
        with gzip.open(filename,'wt',encoding='utf-8') as file:json.dump(result,file,ensure_ascii=False)
        return result
    def store(result):
        target=result['target'];summary=state['sources'][target]
        expected=100 if result['page']<summary['pages'] else summary['total']%100 or 100
        if result['total']!=summary['total'] or len(result['rows'])!=expected:
            state['errors'].append({'target':target,'page':result['page'],'error':'COUNT_CHANGED_OR_SHORT_PAGE'})
        for row in result['rows']:
            if row['id'] in seen_ids:
                previous=db.execute('SELECT payload FROM annexes WHERE id=?',(row['id'],)).fetchone()
                if previous:
                    old=json.loads(previous[0])
                    if any(old.get(key)!=value for key,value in row.items() if key!='fetchedAt'):
                        state['errors'].append({'target':target,'page':result['page'],'id':row['id'],'error':'CONFLICTING_DUPLICATE'})
                state['duplicateRows']+=1
            seen_ids.add(row['id'])
            db.execute('INSERT OR REPLACE INTO annexes VALUES (?,?,?,?,?,?)',(row['id'],row['sourceKind'],row['regionCode'],normalized(row['lawTitle']),row['title'],json.dumps(row,ensure_ascii=False)))
        db.commit();summary['completedPages']+=1;summary['rows']+=len(result['rows'])
    jobs=[]
    for target in TARGETS:
        first=page(target,1);total=first['total'];pages=math.ceil(total/100)
        state['sources'][target]={'total':total,'pages':pages,'completedPages':0,'rows':0}
        store(first);jobs.extend((target,n) for n in range(2,pages+1))
    write_state();print(json.dumps({'event':'start','sources':state['sources'],'remainingPages':len(jobs)}),flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures={pool.submit(page,target,n):(target,n) for target,n in jobs}
        for completed,future in enumerate(concurrent.futures.as_completed(futures),1):
            target,n=futures[future]
            try:store(future.result())
            except Exception as error:state['errors'].append({'target':target,'page':n,'error':type(error).__name__})
            if completed%25==0 or completed==len(jobs):
                write_state();print(json.dumps({'event':'progress','pagesDone':sum(v['completedPages'] for v in state['sources'].values()),'pagesTotal':sum(v['pages'] for v in state['sources'].values()),'unique':state['storedUnique'],'errors':len(state['errors'])}),flush=True)
    state['status']='complete' if not state['errors'] else 'incomplete'
    state['finishedAt']=now();write_state()
    if state['storedUnique']+state['duplicateRows']!=sum(v['total'] for v in state['sources'].values()) or state['storedUnique']!=len(seen_ids):
        state['status']='incomplete';state['errors'].append({'error':'UNIQUE_COUNT_MISMATCH'});write_state()
    print(json.dumps({'event':'finished','status':state['status'],'unique':state['storedUnique'],'errors':len(state['errors'])}),flush=True)
    db.close()
    if state['status']!='complete':raise SystemExit(1)

if __name__=='__main__':main()

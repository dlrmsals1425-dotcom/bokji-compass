"""Import finalized human/agent source reviews; never decide a match from a queue.

Each batch must account for every assigned original. Positive decisions are bound
to the archived bytes, current official annex and an explicitly reviewed program
pair before the existing publication gates are run over all reviews together.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
from urllib.parse import parse_qsl, urlsplit

ROOT=Path(__file__).resolve().parents[1]
REVIEWS=ROOT/'pipeline/forms/reviews'
spec=importlib.util.spec_from_file_location('portal_reviews',ROOT/'scripts/prepare-portal-reviews.py')
portal=importlib.util.module_from_spec(spec);spec.loader.exec_module(portal)
TERMINAL={'approved','non_applicant','obsolete','no_matching_site_program',
          'covered_by_existing','requires_external_confirmation','not_yet_effective'}


def read(path):return json.loads(Path(path).read_text(encoding='utf-8-sig'))
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def save(path,value):path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def flseq(url):return dict(parse_qsl(urlsplit(url).query)).get('flSeq')


def validate_decisions(assignment,report,review):
    if report.get('status')!='complete' and report.get('complete') is not True:
        raise ValueError('Batch is not finalized')
    expected={row['formId'] for row in assignment['forms']}
    items=report['items']
    decisions={row['formId']:row for row in items}
    if len(items)!=len(decisions) or set(decisions)!=expected:
        raise ValueError('Batch dispositions do not cover the exact assignment')
    if any(row.get('disposition') not in TERMINAL for row in items):
        raise ValueError('Batch still has unfinished decisions')
    if any(len(str(row.get('reason','')).strip())<10 for row in items):
        raise ValueError('Each decision needs an individual reason')
    approved={fid for fid,row in decisions.items() if row['disposition']=='approved'}
    rows=review['rows']
    if {row['formId'] for row in rows}!=approved:
        raise ValueError('Approved originals and association rows differ')
    for row in rows:
        decision=decisions[row['formId']]
        if decision.get('fullBodyReviewed') is not True or row.get('sha256')!=decision.get('sha256'):
            raise ValueError('Approved original lacks matching full-body evidence: '+row['formId'])
        reviewed_pairs=decision.get('reviewedProgramPairs',[])
        if any('decision' in p and 'disposition' in p and p['decision']!=p['disposition'] for p in reviewed_pairs):
            raise ValueError('Conflicting reviewed program decision: '+row['formId'])
        pairs={p['programId'] for p in reviewed_pairs if p.get('disposition',p.get('decision'))=='approved'}
        if not row.get('programIds') or not set(row['programIds'])<=pairs:
            raise ValueError('Association was not individually approved: '+row['formId'])
    return decisions


def validate_currency(row,currency):
    law=currency.get('laws',{}).get(row['lawId'],{})
    binding=law.get('forms',{}).get(row['formId'],{})
    if (currency.get('pendingLaws')!=0 or law.get('state')!='source_current'
        or law.get('currentLawId')!=row['lawId'] or binding.get('binding')!='bound'
        or binding.get('officialAnnexDeleted') or binding.get('officialFlSeq')!=flseq(row['sourceUrl'])):
        raise ValueError('Current-law edition or annex needs individual review: '+row['formId'])


def prepare_batch(name,archive,scope,evidence,currency,overrides):
    match=re.fullmatch(r'team([1234])-batch-(\d{3})',name)
    if not match:raise ValueError('Expected teamN-batch-NNN')
    source=ROOT/'logs/forms-completion/reviews'/f'{name}-reviewed.json'
    disposition=source.with_name(f'{name}-dispositions.json')
    assignment=ROOT/'logs/forms-completion/assignments'/f'{name}.json'
    review=read(source);report=read(disposition)
    decisions=validate_decisions(read(assignment),report,review)
    for key in ('reviewedFileSHA256','finalizedReviewSha256'):
        if report.get(key) and report[key]!=sha(source):raise ValueError('Finalized review changed: '+name)
    round_number=int(match[1])*1000+int(match[2])
    output=REVIEWS/f'municipal-reviewed-round{round_number}.json'
    for fid,decision in decisions.items():
        if fid not in scope or scope[fid]['sha256']!=decision['sha256']:
            raise ValueError('Disposition not bound to fixed-scope original: '+fid)
    for row in review['rows']:
        fid=row['formId'];original=scope[fid];binding=evidence['forms'][fid]
        if not isinstance(row.get('regionLabel'),str) or not row['regionLabel'].strip():
            raise ValueError('Reviewed original needs its official jurisdiction label: '+fid)
        if (row.get('verificationStatus')!='verified' or row.get('officialAttachmentMatched') is not True
            or binding.get('binding')!='bound' or binding.get('officialAnnexDeleted')
            or row.get('lawId')!=original['lawId'] or row.get('annexId')!=fid.split('-')[1]
            or row.get('sourceUrl')!=original['sourceUrl']
            or flseq(row['sourceUrl'])!=binding.get('officialFlSeq')):
            raise ValueError('Original is not bound to the official source: '+fid)
        validate_currency(row,currency)
        path=(archive/original['relativePath']).resolve()
        if not path.is_relative_to(archive.resolve()) or sha(path)!=original['sha256']:
            raise ValueError('Archived original bytes changed: '+fid)
        if row.get('bytes') is not None and path.stat().st_size!=row['bytes']:
            raise ValueError('Archived original size changed: '+fid)
        role_error=False
        try:_,metadata=portal.resolve_role(row)
        except ValueError:metadata=None;role_error=True
        # This is an explicit finalized full-body decision, not title promotion.
        # Existing exact SHA/law/part/author/condition gates still have to pass.
        if metadata is None and (role_error or row.get('displayTitle')):
            if row.get('role') not in ('application','consent','delegation','supporting'):
                portal.resolve_role(row)  # Fail with the existing gate's reason.
            entry={'lawId':row['lawId'],'role':row['role'],'sha256':row['sha256'],'reviewFile':output.name}
            previous=overrides.get(fid)
            if previous and any(previous[k]!=entry[k] for k in ('lawId','role','sha256')):
                raise ValueError('Conflicting exact role override: '+fid)
            overrides[fid]=previous or entry
            portal.FULL_BODY_ROLE_OVERRIDES=overrides
        _,metadata=portal.resolve_role(row)
        if metadata and not row.get('displayTitle'):
            titles=list(dict.fromkeys(p['title'] for p in row.get('reviewedParts',[])
                if p.get('use') in ('main','additional','conditional')))
            selected=' · '.join(titles)
            if 2<=len(selected)<=200:row['displayTitle']=selected
    review['sourceReview']={'file':source.relative_to(ROOT).as_posix(),'sha256':sha(source),
                            'dispositionsSHA256':sha(disposition),'assignmentSHA256':sha(assignment)}
    return output,review,report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('batches',nargs='+')
    parser.add_argument('--archive',type=Path,default=Path.home()/'goyang-welfare-forms/law-portal-attachments')
    args=parser.parse_args()
    scope={row['formId']:row for row in read(REVIEWS/'unmatched-originals-scope.json')['forms']}
    evidence=read(ROOT/'logs/forms-completion/source-evidence.json')
    currency=read(ROOT/'pipeline/forms/source-law-currency.json')
    override_doc=read(portal.OVERRIDE_FILE);overrides=dict(override_doc['forms'])
    prepared=[prepare_batch(name,args.archive,scope,evidence,currency,overrides) for name in args.batches]
    old={path:path.read_bytes() if path.exists() else None for path,_,_ in prepared}
    try:
        for path,review,_ in prepared:save(path,review)
        programs={}
        for path in (ROOT/'public/bundles/v1/details').glob('*.json'):programs.update(read(path))
        portal.FULL_BODY_ROLE_OVERRIDES=overrides
        portal.build(programs,portal.review_files(REVIEWS))
    except Exception:
        for path,data in old.items():
            if data is None:path.unlink(missing_ok=True)
            else:path.write_bytes(data)
        raise
    override_doc['forms']=overrides;save(portal.OVERRIDE_FILE,override_doc)
    for path,review,report in prepared:
        save(REVIEWS/path.name.replace('municipal-reviewed-','unmatched-dispositions-'),report)
        print(json.dumps({'file':path.name,'originals':len({r['formId'] for r in review['rows']}),
                          'associations':sum(len(r['programIds']) for r in review['rows'])}))


if __name__=='__main__':main()

"""Account for every source record without treating missing evidence as missing forms."""
import argparse
import copy
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit, urlencode, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
STATES = ('confirmed', 'candidate', 'attachment_found', 'document_mentioned', 'automatic', 'institution', 'needs_source')
SECRET = re.compile(r'^oc$|key|token|secret|password|auth|login|email|phone|resident|jumin', re.I)
SOURCE_EXCLUSIONS = {row['host']: row['reason'] for row in json.loads((ROOT/'src/lib/data/sourceExclusions.json').read_text(encoding='utf-8'))['hosts']}


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def public_url(value):
    if not isinstance(value, str) or re.search(r'[\x00-\x20]', value):
        return None
    try:
        u = urlsplit(value)
        host = (u.hostname or '').lower().rstrip('.')
        if host in SOURCE_EXCLUSIONS:
            return None
        if u.scheme not in ('https', 'http') or not host or u.username or u.password:
            return None
        if '.' not in host or host in ('localhost', '127.0.0.1', '::1') or host.endswith(('.local', '.localhost', '.internal', '.lan', '.test', '.invalid')):
            return None
        if re.fullmatch(r'[\d.]+', host) or ':' in host:
            return None
        if u.port not in (None, 80, 443):
            return None
        if any(SECRET.search(k) and not (k.lower() in ('key', 'menukey') and v.isdecimal()) for k, v in parse_qsl(u.query)):
            return None
        return value
    except ValueError:
        return None


def hints(program):
    documents = str(program.get('documents') or '')
    names = []
    for line in documents.splitlines():
        line = re.sub(r'^\s*관련\s*서식\s*[·ㆍ]?\s*안내\s*:\s*', '', line)
        for name in re.findall(r'[^\n,;]+?\.(?:hwpx?|pdf|docx?|xlsx?)(?=\s|[,;]|$)', line, re.I):
            name = name.strip(' ○ㅇ•-\t')
            if name and not name.startswith(('http:', 'https:')) and name not in names:
                names.append(name[:220])
    return bool(re.search(r'신청서|청구서|신고서|등록신청', documents)), names


def attachment_url_hash(url):
    parts = urlsplit(url)
    normalized = urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path,
                            urlencode(sorted(parse_qsl(parts.query, keep_blank_values=True))), ''))
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()


def exclude_attachments(audit, policy):
    """Do not republish known filled/private or wrong-purpose documents."""
    blocked = {row['urlHash'] for row in policy.get('rows', [])}
    out = copy.deepcopy(audit)
    removed = 0
    for page in out['pages'].values():
        own_urls = [page.get('requestedUrl'), page.get('url')]
        if any(url and attachment_url_hash(url) in blocked for url in own_urls):
            observed = {key: page[key] for key in ('status', 'requestAttempted', 'checkedAt') if key in page}
            page.clear()
            page.update(url='', requestedUrl='', title='내용 확인이 필요한 자료',
                        attachments=[], programSpecific=False, **observed,
                        errorCode='excluded_attachment', suppressedAttachments=1)
            removed += 1
            continue
        kept = []
        for attachment in page.get('attachments', []):
            if attachment_url_hash(attachment.get('url', '')) in blocked:
                removed += 1
                page['suppressedAttachments'] = page.get('suppressedAttachments', 0) + 1
            else:
                kept.append(attachment)
        page['attachments'] = kept
    if 'summary' in out:
        out['summary']['attachments'] = sum(len(p.get('attachments', [])) for p in out['pages'].values())
        out['summary']['suppressedAttachments'] = sum(p.get('suppressedAttachments', 0) for p in out['pages'].values())
    return out, removed


def exact_source_relation(program, page):
    """A linked page can mention another benefit; keep its identity attached."""
    identity = page.get('sourceIdentity') or {}
    provider, identifier = identity.get('provider'), identity.get('programId')
    if page.get('programSpecific') is not True or identity.get('kind') != 'program' or not provider or not identifier:
        return False
    if str(program.get('id', '')).endswith(f'.{provider}-{identifier}'):
        return True
    return any(source.get('source') == provider and str(source.get('id')) == str(identifier)
               for source in program.get('sources', []) if isinstance(source, dict))


def validate_coverage(programs, audit, collection):
    if collection == 'law' and audit.get('summary', {}).get('pendingQueries', 0):
        raise ValueError('Law audit still has pending queries')
    if collection == 'page' and any(row.get('status') == 'pending' for row in audit.get('pages', {}).values()):
        raise ValueError('Page audit still has pending requests')
    if set(audit.get('programs', {})) != set(programs):
        raise ValueError(f'{collection} audit must account for every program ID exactly')
    key_name, pool_name = ('lawKeys', 'laws') if collection == 'law' else ('pageKeys', 'pages')
    pool = audit.get(pool_name, {})
    for program_id, item in audit['programs'].items():
        keys = item.get(key_name, [])
        if len(keys) != len(set(keys)) or any(k not in pool for k in keys):
            raise ValueError(f'Invalid {collection} evidence keys for {program_id}')


def aggregate(programs, matches, approved_ids, law_audit, page_audit, checked_at, attachment_reviews=None):
    validate_coverage(programs, law_audit, 'law')
    validate_coverage(programs, page_audit, 'page')
    if set(matches) != set(programs):
        raise ValueError('Portal index matching must account for every program ID')
    laws, pages = law_audit['laws'], page_audit['pages']
    reviewed = {(r['programId'], r['urlHash']): r for r in (attachment_reviews or {}).get('rows', [])}
    out = {}
    for program_id, program in sorted(programs.items()):
        mention, names = hints(program)
        law_rows = [laws[k] for k in law_audit['programs'][program_id].get('lawKeys', [])]
        page_rows = [pages[k] for k in page_audit['programs'][program_id].get('pageKeys', [])]
        law_checks = {
            'searched': len(law_rows),
            'read': sum(r.get('state') == 'read' for r in law_rows),
            'failed': sum(r.get('state') != 'read' for r in law_rows),
        }
        unresolved = len(law_audit['programs'][program_id].get('unresolvedCitations', []))
        if unresolved:
            law_checks['unresolvedCitations'] = unresolved
        page_checks = {
            'attempted': sum(r.get('requestAttempted', True) is not False for r in page_rows),
            'read': sum(r.get('status') == 'read' for r in page_rows),
            'failed': sum(r.get('status') != 'read' for r in page_rows),
            'unattempted': sum(r.get('requestAttempted') is False for r in page_rows),
        }
        links, seen = [], set()

        def add(title, url, kind, note=None):
            safe = public_url(url)
            if safe and safe not in seen:
                links.append({'title': str(title or '원문 안내')[:220], 'url': safe, 'kind': kind,
                              **({'note': str(note)[:800]} if note else {})})
                seen.add(safe)

        attachment_count = 0
        for page in page_rows:
            # A shared ministry handbook is not an application form for every
            # care-menu row referring to it. Exact source association is required.
            if page.get('status') == 'read' and exact_source_relation(program, page):
                for attachment in page.get('attachments', []):
                    if public_url(attachment.get('url')):
                        review = reviewed.get((program_id, attachment_url_hash(attachment['url'])))
                        add(attachment.get('title'), attachment['url'], 'attachment', review.get('note') if review else None)
                        attachment_count += 1
            title = page.get('title') or '사업 자료가 안내한 주소'
            if page.get('status') != 'read': title += ' (본문 미확인)'
            add(title, page.get('url'), 'official_page')
        for law in law_rows:
            if law.get('state') == 'read':
                add(law.get('title'), law.get('url'), 'official_page')

        candidates = matches[program_id].get('candidates', [])
        state = ('confirmed' if program_id in approved_ids else
                 'attachment_found' if attachment_count else
                 'candidate' if candidates else
                 'document_mentioned' if mention or names else
                 'automatic' if program.get('applyType') == 'auto' else
                 'institution' if program.get('applyType') == 'institution' else 'needs_source')
        notes = []
        for source in page_rows:
            source_host = (urlsplit(source.get('url') or '').hostname or '').lower()
            if source_host in SOURCE_EXCLUSIONS:
                notes.append(SOURCE_EXCLUSIONS[source_host])
        if state == 'attachment_found':
            notes.append('이 사업의 공식 안내에 첨부된 자료를 찾았습니다. 자료의 용도와 제출 조건은 원문에서 확인해 주세요.')
        if state == 'document_mentioned':
            notes.append('원천 사업 자료에 신청 관련 서류가 적혀 있습니다. 현재 사용할 파일과 접수 안내를 추가 확인해야 합니다.')
        if program.get('applyType') == 'auto':
            notes.append('자료상 자동 제공 방식입니다. 예외 신청이나 확인 서류가 필요한 경우가 있을 수 있습니다.')
        elif program.get('applyType') == 'institution':
            notes.append('자료상 기관 추천·선정 방식입니다. 신청인 제출 서류가 전혀 없다는 뜻은 아닙니다.')
        if law_checks['failed'] or page_checks['failed']:
            notes.append('원문을 확인하지 못한 조회가 있습니다. 서식이 없다고 판단한 결과가 아닙니다.')
        if unresolved:
            notes.append(f'사업 자료의 인용 {unresolved}건은 법규명으로 특정하지 못했습니다. 사업계획·일반 지침명도 포함될 수 있습니다.')
        if any(r.get('suppressedAttachments') for r in page_rows):
            notes.append('공식 첨부 중 내용이나 용도 확인이 필요한 파일은 제공 대상에서 제외했습니다.')
        if not law_rows and not page_rows:
            notes.append('사업 자료에 추적할 근거 법규나 원문 주소가 부족합니다.')
        if page_rows and all(not exact_source_relation(program, r) for r in page_rows):
            notes.append('자료원만 확인되거나 본문 조회가 제한되어, 개별 사업의 신청서까지 확인하지 못했습니다.')
        out[program_id] = {
            'state': state, 'checkedAt': checked_at, 'applicationMentioned': mention,
            'documentNames': names, 'lawChecks': law_checks, 'pageChecks': page_checks,
            'sourceLinks': links,
            **({'note': ' '.join(notes)} if notes else {}),
        }
    counts = Counter(row['state'] for row in out.values())
    summary = {
        'totalPrograms': len(programs), 'counts': {s: counts[s] for s in STATES},
        'lawQueries': len(laws), 'lawBodiesRead': sum(v.get('state') == 'read' for v in laws.values()),
        'lawFailures': sum(v.get('state') != 'read' for v in laws.values()),
        'lawUnresolvedCitations': sum(len(v.get('unresolvedCitations', [])) for v in law_audit['programs'].values()),
        'pageUrls': len(pages), 'pagesRead': sum(v.get('status') == 'read' for v in pages.values()),
        'pageFailures': sum(v.get('status') != 'read' for v in pages.values()),
        'officialAttachments': len({link['url'] for p in out.values() for link in p['sourceLinks'] if link['kind'] == 'attachment'}),
    }
    return {'schema': 1, 'checkedAt': checked_at, 'summary': summary, 'programs': out}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--law-audit', type=Path, default=ROOT/'pipeline/forms/law-body-audit.json')
    parser.add_argument('--page-audit', type=Path, default=ROOT/'pipeline/forms/official-page-audit.json')
    args = parser.parse_args()
    programs = {}
    for path in sorted((ROOT/'public/bundles/v1/details').glob('*.json')):
        for key, program in read(path).items():
            if key != program['id'] or key in programs:
                raise ValueError('Duplicate/mismatched source record')
            programs[key] = program
    approved = set()
    for filename in ('reviewed-links.json', 'portal-reviewed-links.json'):
        for row in read(ROOT/'pipeline/forms'/filename)['rows']:
            approved.update(row['programIds'])
    policy_path = ROOT/'pipeline/forms/attachment-exclusions.json'
    pages, _ = exclude_attachments(read(args.page_audit), read(policy_path) if policy_path.exists() else {'rows': []})
    for page in pages['pages'].values():
        # The read result and source identity are public evidence; excerpts stay
        # in the ignored execution cache rather than duplicating source prose.
        page.pop('textExcerpt', None)
    # Persist only the screened audit, including when the input came from a raw cache.
    (ROOT/'pipeline/forms/official-page-audit.json').write_text(json.dumps(pages, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    review_path = ROOT/'pipeline/forms/attachment-reviews.json'
    matches=read(ROOT/'pipeline/forms/portal-matches.json')['programs']
    rejected_path=ROOT/'pipeline/forms/reviews/rejected-associations.json'
    if rejected_path.exists():
        excluded=read(rejected_path)
        if excluded.get('schema')!=1 or not isinstance(excluded.get('rows'),list):raise ValueError('Invalid rejected association audit')
        for row in excluded['rows']:
            if row['programId'] not in programs or len(row.get('reason',''))<10:raise ValueError('Invalid rejected association')
            match=matches[row['programId']]
            match['candidates']=[candidate for candidate in match.get('candidates',[]) if candidate['formId']!=row['formId']]
    result = aggregate(programs, matches, approved,
                       read(args.law_audit), pages, datetime.now(timezone.utc).date().isoformat(),
                       read(review_path) if review_path.exists() else None)
    (ROOT/'pipeline/forms/source-audit.json').write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    print(json.dumps(result['summary'], ensure_ascii=False))


if __name__ == '__main__':
    main()

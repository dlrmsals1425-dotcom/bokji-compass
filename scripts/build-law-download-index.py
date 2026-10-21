"""Inventory actual saved originals and separately count published benefit links.

The local archive index includes full local paths. The versioned audit excludes
local paths and extracted document text. Neither inventory approves a match.
"""
import argparse
import hashlib
import importlib.util
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
agency_spec = importlib.util.spec_from_file_location('inventory_agency', ROOT/'scripts/verified_agency_forms.py')
agency = importlib.util.module_from_spec(agency_spec); agency_spec.loader.exec_module(agency)


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def decorate_original(row, review):
    """Display actual publication and exact-byte review results (Grok, Codex reviewed)."""
    disposition_labels = {
        'non_applicant': '신청인이 작성하는 서류 아님',
        'obsolete': '이전·삭제 서식',
        'not_yet_effective': '아직 시행 전',
        'no_matching_site_program': '대응하는 수록 혜택 미확인',
        'excluded': '이 혜택에 제공하지 않는 서류',
    }
    state_labels = {
        'requires_external_confirmation': '공식 사용 확인 필요',
        'replacement_available': '대체 원본 확인 중',
        'covered_by_existing': '게시된 대체 서식으로 안내',
        'approved_pending_publication': '연결 검토 완료·반영 대기',
        'pending': '개별 검토 대기',
    }
    def pack(state, label, reason=''):
        return {'reviewState': state, 'reviewLabel': label, 'reviewReason': reason}
    same = (isinstance(review, dict) and isinstance(row.get('sha256'), str)
            and re.fullmatch(r'[a-f0-9]{64}', row['sha256']) and review.get('sha256') == row['sha256'])
    inner = (review or {}).get('review') or {}
    reason = inner.get('reason') or ''
    if row.get('publishedPrograms'):
        return pack('linked', '혜택에 연결', reason if same and inner.get('disposition') == 'approved' else '')
    if review is None:
        return pack('pending', state_labels['pending'])
    if not same:
        return pack('needs_confirmation', '확인 필요', '검토 기록의 SHA256이 원본과 달라 이 원본의 검토 결과로 볼 수 없습니다.')
    state = review.get('state') or ''
    if state == 'linked':
        return pack('needs_confirmation', '확인 필요', reason or '실제 게시된 혜택 연결을 확인할 수 없습니다.')
    if state == 'reviewed_not_linked' and inner.get('disposition') in disposition_labels:
        return pack(state, disposition_labels[inner['disposition']], reason)
    if state in state_labels:
        return pack(state, state_labels[state], reason)
    return pack('needs_confirmation', '확인 필요', reason or '검토 상태를 확인할 수 없습니다.')


def inventory_reviews(root, published):
    """Reuse the reconciliation gates; titles and download counts never approve a form."""
    spec = importlib.util.spec_from_file_location('inventory_progress', root/'scripts/update-unmatched-form-progress.py')
    progress = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(progress)
    directory = root/'pipeline/forms/reviews'
    scope = read(directory/'unmatched-originals-scope.json')
    for name in ('prior-edition-originals-scope.json', 'current-replacement-originals-scope.json', 'agency-originals-scope.json'):
        supplemental = directory/name
        if supplemental.exists():
            scope = dict(scope, forms=[*scope['forms'], *read(supplemental)['forms']])
    for supplemental in sorted(directory.glob('gyeonggi-portal-originals-scope-round*.json')):
        scope = dict(scope, forms=[*scope['forms'], *read(supplemental)['forms']])
    paths = (set(progress.review_paths(root)) | set(directory.glob('prior-edition-dispositions-*.json'))
             | set(directory.glob('current-replacement-dispositions-*.json')) | set(directory.glob('agency-dispositions-round*.json'))
             | set(directory.glob('gyeonggi-portal-dispositions-round*.json')))
    reports = [(p.relative_to(root).as_posix(), read(p)) for p in sorted(paths) if p.exists()]
    return {row['formId']: row for row in progress.reconcile(scope, reports, published)['forms']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive-dir', type=Path, default=Path.home()/'goyang-welfare-forms/law-portal-attachments')
    args = parser.parse_args()
    archive = args.archive_dir.resolve()
    details = {}
    for path in (ROOT/'public/bundles/v1/details').glob('*.json'):
        details.update(read(path))
    published = defaultdict(set)
    for path in (ROOT/'public/forms/v1/programs').glob('*.json'):
        for program in read(path)['programs']:
            for link in program['links']:
                published[link['formId']].add(program['id'])
    catalog = read(ROOT/'public/forms/v1/catalog.json')['forms']
    reviews = inventory_reviews(ROOT, {
        fid: {'sha256': form['file']['sha256'], 'programIds': sorted(published[fid])}
        for fid, form in catalog.items() if form.get('file') and published[fid]
    })
    records, issues, unavailable = [], [], []
    for path in sorted((ROOT/'logs/law-downloads').glob('*.json')):
        if not re.fullmatch(r'(?:ordin|law|rule)-\d+\.json', path.name) and not agency.AGENCY_ID.fullmatch(path.stem):
            continue
        record = read(path)
        if path.stem.startswith('agency-'):
            registered = agency.registry_entry(path.stem)
            if record.get('formId') != registered['id'] or record.get('sourceUrl') != registered['sourceUrl']:
                raise ValueError('agency_inventory_source_mismatch')
        if record.get('state') == 'unavailable':
            unavailable.append({key: record.get(key) for key in ('formId','lawTitle','title','sourceUrl','reason')})
        if record.get('state') != 'stored':
            continue
        local = Path(record.get('localPath', '')).resolve()
        if not local.is_relative_to(archive) or not local.is_file():
            issues.append({'id': record.get('formId'), 'reason': 'missing_archive_original'})
            continue
        data = local.read_bytes()
        if len(data) != record.get('bytes') or hashlib.sha256(data).hexdigest() != record.get('sha256'):
            issues.append({'id': record.get('formId'), 'reason': 'archive_original_changed'})
            continue
        fid = record['formId']
        if path.stem.startswith('agency-'):
            entry = agency.registry_entry(path.stem)
            if (fid != entry['id'] or any(record.get(k) != entry[k] for k in ('sourceUrl','finalUrl','sourcePageUrl','attachmentId','sourceKind','lawId','lawTitle','regionCode','sha256','bytes','format'))
                    or local.name != fid+'.'+entry['format']):
                raise ValueError('agency_inventory_identity_mismatch')
            reader_spec = importlib.util.spec_from_file_location('inventory_agency_reader', ROOT/'scripts/download-law-form-files.py')
            reader = importlib.util.module_from_spec(reader_spec); reader_spec.loader.exec_module(reader)
            agency.verify_original(fid, data, reader.inspect_document(data))
            if published[fid]:
                agency.validate_form(catalog[fid])
                if not published[fid].issubset({p['id'] for p in entry['programs']}):raise ValueError('agency_inventory_program_mismatch')
        public_file = catalog.get(fid, {}).get('file', {}).get('hwp')
        if published[fid] and (not public_file or not (ROOT/'public'/public_file.lstrip('/')).is_file()):
            issues.append({'id': fid, 'reason': 'published_original_missing'})
            continue
        row = {key: record.get(key) for key in ('formId', 'lawId', 'lawTitle', 'title', 'regionCode', 'format', 'bytes', 'sha256', 'sourceUrl', 'downloadedAt', 'textScope')}
        if fid.startswith('agency-'):row.update(sourceKind='agency',sourcePageUrl=entry['sourcePageUrl'],finalUrl=entry['finalUrl'],attachmentId=entry['attachmentId'])
        if catalog.get(fid,{}).get('displayTitle'):row['displayTitle']=catalog[fid]['displayTitle']
        row['relativePath'] = local.relative_to(archive).as_posix()
        if record.get('sourceArchive'):
            source=record['sourceArchive'];container=Path(source['localPath']).resolve()
            if not container.is_relative_to(archive) or hashlib.sha256(container.read_bytes()).hexdigest()!=source['sha256']:
                raise ValueError('Source archive missing or changed: '+fid)
            row['sourceArchive']={key:source[key] for key in ('member','sha256','bytes')}
            row['sourceArchive']['relativePath']=container.relative_to(archive).as_posix()
        row['usableHangul'] = record.get('format') in ('hwp', 'hwpx') and record.get('textScope') == 'all_body_sections_or_pages'
        row['publishedPrograms'] = [{'id': pid, 'name': details.get(pid, {}).get('name', pid)} for pid in sorted(published[fid])]
        row.update(decorate_original(row, reviews.get(fid)))
        records.append(row)
    if issues:
        raise ValueError(json.dumps(issues, ensure_ascii=False))
    summary = {'savedOriginals': len(records), 'uniqueOriginalContents':len({row['sha256'] for row in records}),
               'formats': dict(sorted(Counter(row['format'] for row in records).items())),
               'readableHangulOriginals': sum(row['usableHangul'] for row in records),
               'publishedOriginals': sum(bool(row['publishedPrograms']) for row in records),
               'publishedFormats':dict(Counter(row['format'] for row in records if row['publishedPrograms'])),
               'publishedPrograms': len({p['id'] for row in records for p in row['publishedPrograms']}),
               'publishedAssociations': sum(len(row['publishedPrograms']) for row in records),
               'reviewStates': dict(sorted(Counter(row['reviewState'] for row in records).items())),
               'unavailableSourceAttachments': len(unavailable),
               'unpublishedOriginals': sum(not row['publishedPrograms'] for row in records)}
    inventory = {'schema': 1, 'generatedAt': datetime.now(timezone.utc).isoformat(),
                 'scope': 'Actual downloaded originals; saved files are not automatically approved for a benefit.',
                 'summary': summary, 'forms': records, 'unavailable': unavailable}
    archive.mkdir(parents=True, exist_ok=True)
    (archive/'index.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=1)+'\n', encoding='utf-8')
    (ROOT/'pipeline/forms/download-audit.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=1)+'\n', encoding='utf-8')
    # A local, dependency-free directory lets the owner open the real files by
    # region/law/title without having to understand numeric source identifiers.
    payload = json.dumps(records, ensure_ascii=False).replace('<', '\\u003c')
    html = '''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>법령·지자체 공식 서식 원본</title>
<style>body{font:18px/1.6 system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;color:#172d3e}input{font:inherit;width:100%;box-sizing:border-box;padding:14px;border:1px solid #7b8994;border-radius:8px}article{padding:22px 0;border-bottom:1px solid #d9e0e4}h2{font-size:20px;margin:0}p{margin:6px 0}a{color:#075e88}small{color:#526470}button{font:inherit;padding:10px 24px;margin:20px 0}label{font-weight:600}</style>
<h1>법령·지자체 공식 서식 원본</h1><p>국가법령정보센터와 개별 검증한 지자체·공공기관 출처에서 내려받은 원본입니다. “혜택에 연결” 표시는 원본과 신청 목적을 확인해 페이지에 첨부한 파일에만 표시합니다.</p><p id="summary"></p><p>파일마다 검토 상태와 연결·보류 이유를 표시합니다. 아직 판단하지 않은 자료는 ‘개별 검토 대기’로 남겨 둡니다.</p>
<label for="search">지역·조례·신청서·혜택 이름 찾기</label><input id="search" type="search" placeholder="예: 고양시 장수축하금"><p id="count" aria-live="polite"></p><main id="list"></main><button id="more">더 보기</button>
<script>const rows=DATA;const input=document.getElementById('search'),list=document.getElementById('list'),count=document.getElementById('count'),more=document.getElementById('more');let limit=100;
document.getElementById('summary').textContent='보관 원본 '+rows.length.toLocaleString('ko-KR')+'개 · 혜택에 연결 '+rows.filter(r=>r.publishedPrograms.length).length.toLocaleString('ko-KR')+'개';
function render(){const terms=input.value.trim().toLowerCase().split(/\\s+/).filter(Boolean);const found=rows.filter(r=>{const text=[r.lawTitle,r.title,r.displayTitle,r.reviewLabel,r.reviewReason,...r.publishedPrograms.map(p=>p.name)].join(' ').toLowerCase();return terms.every(t=>text.includes(t));});count.textContent=found.length+'개 원본 · '+Math.min(limit,found.length)+'개 표시';list.replaceChildren();for(const r of found.slice(0,limit)){const a=document.createElement('article'),h=document.createElement('h2'),link=document.createElement('a'),p=document.createElement('p'),status=document.createElement('small');link.textContent=r.displayTitle||r.title||r.formId;link.href=r.relativePath.split('/').map(encodeURIComponent).join('/');link.setAttribute('download','');h.append(link);p.textContent=(r.lawTitle||'')+' · '+String(r.format).toUpperCase();status.textContent=r.publishedPrograms.length?'혜택에 연결: '+r.publishedPrograms.map(p=>p.name).join(' / '):r.reviewLabel;a.append(h,p,status);if(r.reviewReason){const detail=document.createElement('details'),caption=document.createElement('summary'),reason=document.createElement('p');caption.textContent='연결·보류 이유 보기';reason.textContent=r.reviewReason;detail.append(caption,reason);a.append(detail);}list.append(a);}more.hidden=limit>=found.length;}
input.addEventListener('input',()=>{limit=100;render();});more.addEventListener('click',()=>{limit+=100;render();});render();</script></html>'''.replace('DATA', payload)
    (archive/'index.html').write_text(html, encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == '__main__':
    main()

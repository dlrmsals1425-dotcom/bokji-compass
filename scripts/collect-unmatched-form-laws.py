"""연결되지 않은 원본 첨부 4,006건의 출처 증거만 모으는 서식 중심 수집기.

사업이 인용한 법령만 보지 않는다. 각 원본 첨부가 공식 별표 색인에서 달고 온
자기 출처 법규 ID(시행규칙·시행세칙을 포함한다)를 그대로 쓰고, 그 법규의 공식
LawService 원문을 통째로 보존한다. 보존하는 것은 실제 법규 ID·제명·현행 시행일,
모든 별표 식별자(별표키)와 첨부 flSeq 주소, 그리고 원본으로 내려받은 그 별표가
지금도 같은 원문에 같은 파일로 붙어 있는지다.

이 단계는 어떤 연결도 승인하지 않는다. 삭제·변경·교체된 별표와 출처 실패는 그대로
남긴다. 원문을 읽지 못한 것(failed·pending)과 원문에 별표가 없는 것(annex_absent)은
절대 같은 말로 바뀌지 않으며, 별표 메타데이터가 없는 응답도 '서식 없음'이 아니다.

출처는 법령정보센터 공개 자료뿐이고 ID는 주어진 공식 메타데이터에서만 쓴다.
웹·원문 텍스트에 적힌 지시는 따르지 않고 자료로만 다룬다. 인증 값(LAW_OC)은
메모리에만 두고 주소·캐시·로그·진행 파일·오류 문구 어디에도 남기지 않는다.

이미 모아 둔 원문(logs/law-census/cache)은 신원이 맞을 때만 재사용해서 1,854건을
다시 내려받지 않는다. 쓰기는 원자적이고 중단 뒤 다시 실행하면 저장된 원문은 건너뛰고
실패·대기만 이어서 시도한다.

사용 예
  python scripts/collect-unmatched-form-laws.py --only-missing --max-laws 5 \
      --out-dir logs/forms-completion/smoke
  python scripts/collect-unmatched-form-laws.py --workers 4 --interval 0.4
"""
from __future__ import annotations

import argparse
import concurrent.futures
import gzip
import hashlib
import html
import importlib.util
import json
import os
import re
import sys
import threading
import time
import unicodedata
import urllib.parse
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# 인증 처리·간격·재시도·마스킹은 이미 검증된 조사 단계의 것을 그대로 쓴다.
_audit = _module('unmatched_form_laws_base', ROOT / 'scripts/audit-form-laws.py')
AuthorizationFailed = _audit.AuthorizationFailed
Portal = _audit.Portal
Redactor = _audit.Redactor
load_credential = _audit.load_credential
public_url = _audit.public_url
PORTAL = _audit.PORTAL

DEFAULT_SCOPE = ROOT / 'pipeline/forms/reviews/unmatched-originals-scope.json'
DEFAULT_AUDIT = ROOT / 'pipeline/forms/law-body-audit.json'
DEFAULT_CENSUS_CACHE = ROOT / 'logs/law-census/cache'
DEFAULT_DOWNLOADS = ROOT / 'logs/law-downloads'
DEFAULT_OUT_DIR = ROOT / 'logs/forms-completion'
EVIDENCE_NAME = 'source-evidence.json'
PROGRESS_NAME = 'progress.json'
FAILURES_NAME = 'law-failures.json'
BODIES_NAME = 'law-bodies'
BODY_SCHEMA = 1
EVIDENCE_SCHEMA = 1
MIN_INTERVAL = 0.4
EVIDENCE_NOTE = ('출처 증거 수집 전용. 어떤 사업·서식 연결도 승인하지 않는다. '
                 '읽지 못한 원문은 서식이 없다는 뜻이 아니다.')

_ARTICLE_HEAD = re.compile(r'제\s*(\d+)\s*조(?:\s*의\s*(\d+))?')
# A dated/terminal deletion status is different from an application's purpose,
# such as 사업변경(중단 폐지) 신청서 or 개인정보 삭제 신청서.
_DELETED = re.compile(r'(?:^|[\s\[\]()<>【】〈〉])(?:삭제|삭 제|폐지)(?=$|[\s\[\]()<>【】〈〉_]*\d{4}|[\s\]>)】〉.,]*$)')
_FL_URL = re.compile(r'(?:https?://[^\s"\'<>]*?)?(?:/(?:LSW/)?)?flDownload\.do\?[^\s"\'<>]+')
_SECRET_IN_URL = re.compile(r'(?i)[?&](oc|key|token|servicekey|apikey|auth|secret|password|signature)=')
_CONTENT_KEY = re.compile(r'내용$')
_ANNEX_CONTAINER_KEYS = ('별표제목', '별표명')
_LAW_ID_FIELDS = ('자치법규일련번호', '법령일련번호', '행정규칙일련번호')
_STABLE_ID_FIELDS = ('자치법규ID', '법령ID', '행정규칙ID')
_TITLE_FIELDS = ('자치법규명', '법령명한글', '법령명', '행정규칙명')
_ORG_FIELDS = ('지자체기관명', '소관부처명')

# 서식 상태(state)와 별표 결속(binding)은 다른 사실이다. state는 출처 원문을 읽었는지,
# binding은 그 원문에 이 원본 별표가 붙어 있는지만 말한다.
_CORE_FORM_FIELDS = ('lawId', 'annexId', 'state', 'reason', 'binding', 'bindingReason',
                     'scopeFlSeq', 'scopeTitle', 'lawTitleScope', 'original')
BINDINGS = ('bound', 'file_replaced', 'annex_without_attachment', 'renumbered', 'annex_absent',
            'attachment_only_bound', 'attachment_absent', 'annex_metadata_absent', 'source_unread')
BINDING_REASON = {
    'bound': 'OFFICIAL_ANNEX_BOUND_WITH_SAME_FILE',
    'file_replaced': 'OFFICIAL_ANNEX_PRESENT_BUT_FILE_REPLACED',
    'annex_without_attachment': 'OFFICIAL_ANNEX_PRESENT_WITHOUT_ATTACHMENT',
    'renumbered': 'SAME_FILE_UNDER_DIFFERENT_ANNEX_ID',
    'annex_absent': 'ANNEX_ABSENT_FROM_READ_SOURCE_BODY',
    'attachment_only_bound': 'ATTACHMENT_PRESENT_IN_PUBLIC_PAGE_ANNEX_ID_UNVERIFIED',
    'attachment_absent': 'ATTACHMENT_ABSENT_FROM_PUBLIC_PAGE_ANNEX_ID_UNVERIFIED',
    'annex_metadata_absent': 'SOURCE_ANNEX_METADATA_MISSING_NOT_PROOF_OF_ABSENCE',
    'source_unread': 'SOURCE_BODY_NOT_READ_NOT_PROOF_OF_ABSENCE',
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def squeeze(value) -> str:
    text = unicodedata.normalize('NFKC', str(value or ''))
    return ' '.join(text.split())


def compact(value) -> str:
    """제명 대조용 키. 표기 차이만 지우고 글자는 남긴다."""
    text = unicodedata.normalize('NFKC', str(value or ''))
    return re.sub(r'[^0-9A-Za-z가-힣]', '', text).casefold()


def walk(node):
    """응답 구조는 대상마다 그릇 이름이 달라 마디를 직접 훑는다."""
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from walk(value)


def file_identity(value):
    """법령정보센터 공개 첨부 주소의 flSeq. 공개 주소가 아니면 쓰지 않는다."""
    if _SECRET_IN_URL.search(str(value or '')):
        # 공식 별표 첨부 주소에는 인증 값이 없다. 섞여 있으면 신원으로 쓰지 않는다.
        return None
    address = public_url(value)
    if not address:
        return None
    parts = urllib.parse.urlsplit(address)
    if parts.path not in ('/LSW/flDownload.do', '/flDownload.do'):
        return None
    values = [item for name, item in urllib.parse.parse_qsl(parts.query) if name == 'flSeq']
    return values[0] if len(values) == 1 and values[0].isdigit() else None


def law_public_url(law_id) -> str:
    return PORTAL + '/LSW/ordinInfoP.do?' + urllib.parse.urlencode({'ordinSeq': str(law_id)})


def law_service_url(law_id) -> str:
    """인증 값이 빠진 조회 주소. 어떤 ID로 무엇을 물었는지만 남는다."""
    return PORTAL + '/DRF/lawService.do?' + urllib.parse.urlencode(
        {'type': 'JSON', 'target': 'ordin', 'MST': str(law_id)})


def node_text(node) -> str:
    """조문 마디에 달린 항·호·목까지 순서대로 이어 붙인 본문."""
    parts = []

    def collect(value):
        if isinstance(value, str):
            text = value.strip()
            if text:
                parts.append(text)
        elif isinstance(value, list):
            for item in value:
                collect(item)
        elif isinstance(value, dict):
            for name, item in value.items():
                if _CONTENT_KEY.search(name) or name in ('항', '호', '목'):
                    collect(item)

    collect(node)
    return '\n'.join(parts)


def article_label(node, text) -> str:
    """조문 번호. 본문 머리말을 먼저 믿고, 없으면 번호 자리를 갈라 읽는다."""
    head = _ARTICLE_HEAD.match(str(text or '').strip())
    if head:
        return '제' + head.group(1) + '조' + ('의' + head.group(2) if head.group(2) else '')
    field = node.get('조문번호') or node.get('조번호') or ''
    if isinstance(field, list):
        field = field[0] if field else ''
    digits = re.sub(r'\D', '', str(field))
    if not digits:
        return ''
    # 공식 응답의 조문번호는 '000300'처럼 뒤 두 자리가 가지번호다.
    main, branch = (int(digits[:-2] or 0), int(digits[-2:])) if len(digits) >= 5 else (int(digits), 0)
    if not main:
        return ''
    return '제' + str(main) + '조' + ('의' + str(branch) if branch else '')


def article_rows(service):
    """조문 마디의 번호·제목·길이. 본문 전체는 lawService 그대로 보존한다."""
    rows = []
    for node in walk(service):
        if not any(isinstance(node.get(name), (str, list)) for name in ('조내용', '조문내용')):
            continue
        text = node_text(node)
        if not text:
            continue
        rows.append({'number': article_label(node, text),
                     'title': squeeze(node.get('조제목') or node.get('조문제목') or ''),
                     'charCount': len(text)})
    return rows


def annex_rows(service):
    """원문에 붙은 별표·별지 전부. 별표키와 첨부 flSeq를 그대로 남긴다."""
    rows, seen = [], set()
    for node in walk(service):
        title = next((node[name] for name in _ANNEX_CONTAINER_KEYS
                      if isinstance(node.get(name), str)), None)
        if title is None:
            continue
        annex_id = str(node.get('별표키') or node.get('별표일련번호') or '').strip().removeprefix('ordin-')
        number = str(node.get('별표번호') or '').strip().lstrip('0')
        branch = str(node.get('별표가지번호') or '').strip().lstrip('0')
        address = public_url(node.get('별표첨부파일명') or node.get('별표서식파일링크'))
        content = node.get('별표내용')
        row = {'annexId': annex_id,
               'number': (number + ('의' + branch if branch else '')) if number else '',
               'kind': squeeze(node.get('별표구분') or ''),
               'title': squeeze(title),
               'fileFormat': squeeze(node.get('별표첨부파일구분') or ''),
               'url': address or '',
               'flSeq': file_identity(address) or '',
               'pdfUrl': public_url(node.get('별표서식PDF파일링크')) or '',
               'contentChars': len(node_text({'별표내용': content})) if content else 0,
               'deleted': bool(_DELETED.search(squeeze(title)))}
        mark = (row['annexId'], row['number'], compact(row['title']), row['flSeq'])
        if mark in seen:
            continue
        seen.add(mark)
        rows.append(row)
    return rows


def html_annex_rows(raw, base=PORTAL + '/LSW/ordinInfoR.do'):
    """공개 본문 페이지에 걸린 공식 첨부. 별표키는 여기서 확인할 수 없다."""
    rows, seen = [], set()
    # 실제 페이지의 첨부 주소는 '&amp;'로 적힌 상대 주소다. 페이지 주소를 기준으로 푼다.
    for match in _FL_URL.finditer(html.unescape(str(raw or ''))):
        found = match.group(0)
        address = public_url(found if found.startswith('http') else urllib.parse.urljoin(base, found))
        identity = file_identity(address)
        if not identity or identity in seen:
            continue
        seen.add(identity)
        label = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(address).query)).get('flNm', '')
        rows.append({'flSeq': identity, 'url': address, 'label': squeeze(label),
                     'deleted': bool(_DELETED.search(squeeze(label)))})
    return rows


def basic_info(service):
    """법규 기본정보 마디. 실제 일련번호가 있는 마디만 신원으로 인정한다."""
    for node in walk(service):
        if any(str(node.get(name) or '').strip() for name in _LAW_ID_FIELDS):
            return node
    return None


def pick(node, names) -> str:
    for name in names:
        value = node.get(name)
        if isinstance(value, list):
            value = value[0] if value else ''
        if str(value or '').strip():
            return squeeze(value)
    return ''


def body_record(service, law_id, *, source, request_url=None, fetched_at=None, cache_key=None):
    """공식 응답 하나를 원문 기록으로 만든다. 신원이 어긋나면 쓰지 않는다."""
    if not isinstance(service, dict):
        return None, 'SOURCE_RESPONSE_UNREADABLE'
    basic = basic_info(service)
    if basic is None:
        return None, 'LAW_METADATA_MISSING'
    actual = pick(basic, _LAW_ID_FIELDS)
    if actual != str(law_id):
        return None, 'LAW_IDENTITY_MISMATCH'
    articles = article_rows(service)
    annexes = annex_rows(service)
    if not articles and not annexes:
        return None, 'EMPTY_BODY'
    record = {'schema': BODY_SCHEMA, 'lawId': str(law_id), 'stableLawId': pick(basic, _STABLE_ID_FIELDS),
              'lawTitle': pick(basic, _TITLE_FIELDS), 'orgName': pick(basic, _ORG_FIELDS),
              'lawTypeCode': pick(basic, ('자치법규종류', '법령구분명', '행정규칙종류')),
              'revisionKind': pick(basic, ('제개정정보',)),
              'effectiveDate': pick(basic, ('시행일자',)),
              'promulgationDate': pick(basic, ('공포일자', '발령일자')),
              'promulgationNumber': pick(basic, ('공포번호', '발령번호')),
              'source': source, 'annexSource': 'law-service-json' if annexes else 'none',
              'requestUrl': public_url(request_url) or law_service_url(law_id),
              'publicUrl': law_public_url(law_id),
              'fetchedAt': fetched_at or now(), 'storedAt': now(),
              'articleCount': len(articles), 'annexCount': len(annexes),
              'deletedAnnexCount': sum(1 for row in annexes if row['deleted']),
              'articles': articles, 'annexes': annexes, 'htmlAnnexes': [],
              'articleTextIn': 'lawService', 'lawService': service}
    if cache_key:
        record['lawCacheKey'] = cache_key
    return record, None


# ─── 저장 ──────────────────────────────────────────────────────────────────
def replace(temporary, path):
    """Windows에서 다른 공정이 읽는 중이면 교체가 잠시 막힌다."""
    for attempt in range(20):
        try:
            temporary.replace(path)
            return
        except PermissionError:
            if attempt == 19:
                raise
            time.sleep(0.05)


def write_gz(path, payload, redactor):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'{path.name}.{os.getpid()}.{time.time_ns()}.tmp')
    with gzip.open(temporary, 'wt', encoding='utf-8') as file:
        json.dump(redactor.data(payload), file, ensure_ascii=False)
    replace(temporary, path)


def write_json(path, payload, redactor, *, indent=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f'{path.name}.{os.getpid()}.{time.time_ns()}.tmp')
    temporary.write_text(json.dumps(redactor.data(payload), ensure_ascii=False, indent=indent,
                                    sort_keys=True) + '\n', encoding='utf-8')
    replace(temporary, path)


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8-sig'))
    except (OSError, ValueError):
        return None


def body_path(out_dir, law_id):
    return Path(out_dir) / BODIES_NAME / (str(law_id) + '.json.gz')


def read_body(path, law_id):
    """이미 저장한 원문. 스키마·법규 ID가 맞을 때만 재사용한다."""
    path = Path(path)
    if not path.exists():
        return None
    try:
        with gzip.open(path, 'rt', encoding='utf-8') as file:
            data = json.load(file)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get('schema') != BODY_SCHEMA or str(data.get('lawId')) != str(law_id):
        return None
    if not data.get('articles') and not data.get('annexes') and not data.get('htmlAnnexes'):
        return None
    verified, error = body_record(data.get('lawService'), law_id, source=data.get('source','stored-body'),
                                  request_url=data.get('requestUrl'), fetched_at=data.get('fetchedAt'),
                                  cache_key=data.get('lawCacheKey'))
    if error or verified is None or any(data.get(key) != verified.get(key) for key in ('lawTitle','articles','annexes')):
        return None
    return data


# ─── 범위와 계획 ────────────────────────────────────────────────────────────
def load_scope(path_or_data):
    """범위 파일의 모든 원본을 받아 든다. 한 건도 버리지 않는다."""
    data = path_or_data if isinstance(path_or_data, dict) else read_json(path_or_data)
    if not isinstance(data, dict) or not isinstance(data.get('forms'), list):
        raise ValueError('Scope file does not hold a form list')
    forms, duplicates, nameless = {}, 0, 0
    for item in data['forms']:
        form_id = str(item.get('formId') or '').strip()
        if not form_id:
            nameless += 1
            continue
        if form_id in forms:
            duplicates += 1
            continue
        match = re.fullmatch(r'ordin-(\d+)', form_id)
        law_id = str(item.get('lawId') or '').strip()
        forms[form_id] = {'formId': form_id, 'annexId': match.group(1) if match else '',
                          'lawId': law_id if law_id.isdigit() else '',
                          'lawTitle': squeeze(item.get('lawTitle')), 'title': squeeze(item.get('title')),
                          'regionCode': str(item.get('regionCode') or ''),
                          'sourceUrl': str(item.get('sourceUrl') or ''),
                          'flSeq': file_identity(item.get('sourceUrl')) or '',
                          'sha256': str(item.get('sha256') or ''), 'format': str(item.get('format') or ''),
                          'valid': bool(match) and (law_id.isdigit()) and bool(file_identity(item.get('sourceUrl')))}
    return {'baselineCommit': str(data.get('baselineCommit') or ''), 'scopeNote': str(data.get('scope') or ''),
            'declaredFormCount': data.get('formCount'), 'duplicateFormIds': duplicates,
            'recordsWithoutFormId': nameless, 'forms': forms}


def law_plan(forms, audit):
    """법규 단위 계획. 서식의 자기 출처 법규 ID만 쓰고 사업 인용으로 좁히지 않는다."""
    laws = {}
    cached_keys = {}
    for key, law in (audit or {}).get('laws', {}).items():
        if law.get('id'):
            cached_keys.setdefault(str(law['id']), []).append((0 if law.get('state') == 'read' else 1, key))
    for form in forms.values():
        if not form['valid']:
            continue
        law = laws.setdefault(form['lawId'], {'lawId': form['lawId'], 'formIds': [], 'scopeTitles': [],
                                              'cacheKeys': [key for _, key in sorted(cached_keys.get(form['lawId'], []))]})
        law['formIds'].append(form['formId'])
        if form['lawTitle'] and form['lawTitle'] not in law['scopeTitles']:
            law['scopeTitles'].append(form['lawTitle'])
    for law in laws.values():
        law['formIds'].sort()
    return {law_id: laws[law_id] for law_id in sorted(laws, key=lambda value: int(value))}


# ─── 이미 읽어 둔 원문 재사용 ────────────────────────────────────────────────
def cache_file(cache_dir, key):
    digest = hashlib.sha1(str(key).encode('utf-8')).hexdigest()
    return Path(cache_dir) / digest[:2] / (digest + '.json.gz')


def load_cache(cache_dir, key):
    path = cache_file(cache_dir, key)
    if not path.exists():
        return None
    try:
        with gzip.open(path, 'rt', encoding='utf-8') as file:
            data = json.load(file)
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get('key') != key:
        return None
    return data


def cache_services(cache_object, law_id):
    """캐시에 담긴 완전한 LawService 응답. 같은 법규 ID의 것만 돌려준다."""
    found = []
    for raw in (cache_object or {}).get('raw', []):
        payload = raw.get('payload') if isinstance(raw, dict) else None
        service = payload.get('LawService') if isinstance(payload, dict) else None
        if not isinstance(service, dict):
            continue
        basic = basic_info(service)
        if basic is None or pick(basic, _LAW_ID_FIELDS) != str(law_id):
            continue
        found.append((service, raw.get('url')))
    return found


def reuse_body(law, cache_dir):
    """옛 캐시의 완전한 원문을 신원 확인 뒤에만 재사용한다."""
    reasons = []
    for key in law['cacheKeys']:
        if not cache_file(cache_dir, key).exists():
            reasons.append('LAW_CACHE_FILE_ABSENT')
            continue
        cache_object = load_cache(cache_dir, key)
        if cache_object is None:
            reasons.append('LAW_CACHE_FILE_UNREADABLE')
            continue
        services = cache_services(cache_object, law['lawId'])
        if not services:
            reasons.append('LAW_CACHE_WITHOUT_EXACT_LAW_BODY')
            continue
        for service, url in services:
            record, error = body_record(service, law['lawId'], source='law-census-cache',
                                        request_url=url, fetched_at=cache_object.get('storedAt'),
                                        cache_key=key)
            if record:
                return record, None
            reasons.append(error)
    # 가장 구체적인 사유부터 남긴다. 캐시가 없다는 말이 원문이 없다는 뜻은 아니다.
    for reason in ('LAW_IDENTITY_MISMATCH', 'EMPTY_BODY', 'LAW_METADATA_MISSING',
                   'SOURCE_RESPONSE_UNREADABLE', 'LAW_CACHE_WITHOUT_EXACT_LAW_BODY',
                   'LAW_CACHE_FILE_UNREADABLE', 'LAW_CACHE_FILE_ABSENT'):
        if reason in reasons:
            return None, reason
    return None, 'NO_REUSABLE_LAW_CACHE'


# ─── 공식 조회 ──────────────────────────────────────────────────────────────
def fetch_body(law, portal, *, html_fallback=True):
    """정확한 출처 법규 ID로 공식 원문을 읽는다. 실패는 실패로 남긴다."""
    payload, safe = portal.body('ordin', law['lawId'])
    service = payload.get('LawService') if isinstance(payload, dict) else None
    if not isinstance(service, dict):
        service = payload if isinstance(payload, dict) else None
    record, error = body_record(service, law['lawId'], source='law-service', request_url=safe)
    if record is None:
        return None, error
    if not record['annexes'] and html_fallback:
        # 별표 마디가 없는 응답도 '서식 없음'이 아니다. 공개 본문의 공식 첨부로 한 번 더 본다.
        try:
            raw, address = portal.public_body('ordin', law['lawId'])
        except (ValueError, RuntimeError, OSError):
            record['annexSource'] = 'law-service-json-without-annex'
            record['htmlAnnexError'] = 'PORTAL_PUBLIC_BODY_UNAVAILABLE'
            return record, None
        rows = html_annex_rows(raw, base=address)
        record['htmlAnnexes'] = rows
        record['htmlAnnexUrl'] = public_url(address) or law_public_url(law['lawId'])
        record['annexSource'] = 'public-html' if rows else 'none'
    return record, None


# ─── 별표 결속 확인 ─────────────────────────────────────────────────────────
def bind_annex(form, body):
    """이 원본 별표가 지금도 그 원문에 같은 파일로 붙어 있는지. 추측하지 않는다."""
    result = {'binding': 'source_unread', 'bindingReason': BINDING_REASON['source_unread'],
              'officialAnnexId': '', 'officialAnnexNumber': '', 'officialAnnexTitle': '',
              'officialFlSeq': '', 'officialAnnexUrl': '', 'officialAnnexDeleted': False}
    if not body:
        return result
    annexes = body.get('annexes') or []
    scope_file = form['flSeq']

    def describe(row, binding):
        result.update(binding=binding, bindingReason=BINDING_REASON[binding],
                      officialAnnexId=row.get('annexId', ''), officialAnnexNumber=row.get('number', ''),
                      officialAnnexTitle=row.get('title', row.get('label', '')),
                      officialFlSeq=row.get('flSeq', ''), officialAnnexUrl=row.get('url', ''),
                      officialAnnexDeleted=bool(row.get('deleted')))
        return result

    exact = [row for row in annexes if row.get('annexId') and row['annexId'] == form['annexId']]
    if exact:
        same = [row for row in exact if row.get('flSeq') and row['flSeq'] == scope_file]
        if same:
            return describe(same[0], 'bound')
        replaced = [row for row in exact if row.get('flSeq')]
        if replaced:
            return describe(replaced[0], 'file_replaced')
        return describe(exact[0], 'annex_without_attachment')
    if scope_file:
        moved = [row for row in annexes if row.get('flSeq') == scope_file]
        if moved:
            return describe(moved[0], 'renumbered')
    if annexes:
        result.update(binding='annex_absent', bindingReason=BINDING_REASON['annex_absent'])
        return result
    attachments = body.get('htmlAnnexes') or []
    if attachments:
        found = [row for row in attachments if scope_file and row.get('flSeq') == scope_file]
        if found:
            return describe(found[0], 'attachment_only_bound')
        result.update(binding='attachment_absent', bindingReason=BINDING_REASON['attachment_absent'])
        return result
    result.update(binding='annex_metadata_absent', bindingReason=BINDING_REASON['annex_metadata_absent'])
    return result


def original_evidence(downloads_dir, form):
    """내려받아 둔 원본 기록과의 대조. 바이트를 다시 읽지 않고 신원만 본다."""
    if not downloads_dir:
        return {'record': 'not_checked'}
    path = Path(downloads_dir) / (form['formId'] + '.json')
    if not path.exists():
        error = Path(downloads_dir) / (form['formId'] + '.error.json')
        return {'record': 'error_record' if error.exists() else 'missing'}
    record = read_json(path)
    if not isinstance(record, dict):
        return {'record': 'unreadable'}
    return {'record': str(record.get('state') or 'unknown'),
            'sha256Match': bool(form['sha256']) and record.get('sha256') == form['sha256'],
            'flSeqMatch': bool(form['flSeq']) and file_identity(record.get('sourceUrl')) == form['flSeq'],
            'lawIdMatch': str(record.get('lawId') or '') == form['lawId'],
            'format': str(record.get('format') or ''),
            'textLength': record.get('textLength') if isinstance(record.get('textLength'), int) else None}


# ─── 수집 ──────────────────────────────────────────────────────────────────
def collect(scope, audit, *, out_dir, portal, redactor, cache_dir=DEFAULT_CENSUS_CACHE,
            downloads_dir=DEFAULT_DOWNLOADS, workers=4, max_laws=0, only_missing=False,
            refresh=False, html_fallback=True, progress=None, checked_at=None, prior_failures=None):
    """모든 범위 ID를 빠짐없이 설명하는 증거 묶음을 만든다. 승인은 하지 않는다."""
    out_dir = Path(out_dir)
    forms = scope['forms']
    laws = law_plan(forms, audit)
    stored, lock = {}, threading.Lock()
    states = {}
    counts = {'reusedFromBody': 0, 'reusedFromCache': 0, 'fetched': 0, 'failed': 0, 'pending': 0}
    aborted = threading.Event()
    history = {str(key): value for key, value in (prior_failures or {}).items() if isinstance(value, dict)}
    checked_at = checked_at or date.today().isoformat()

    def attempts(law_id, state):
        """이전 실행의 시도 횟수를 이어 센다. 읽어 낸 법규는 더 세지 않는다."""
        prior = history.get(str(law_id), {}).get('attempts')
        prior = int(prior) if isinstance(prior, int) else 0
        return 0 if state == 'read' else prior + 1 if state == 'failed' else prior

    def keep(law_id, record, state, reason, *, counted):
        with lock:
            if record is not None:
                stored[law_id] = record
            states[law_id] = {'state': state, 'reason': reason, 'attempts': attempts(law_id, state)}
            counts[counted] += 1

    def local(law_id, law):
        """망을 쓰지 않는 단계. 저장된 원문과 옛 캐시만 본다."""
        if not refresh:
            record = read_body(body_path(out_dir, law_id), law_id)
            if record:
                keep(law_id, record, 'read', 'SOURCE_BODY_ALREADY_STORED', counted='reusedFromBody')
                return True
        if refresh:
            return False
        record, reason = reuse_body(law, cache_dir)
        if record:
            if only_missing:
                keep(law_id, None, 'pending', 'SOURCE_REUSE_DEFERRED_ONLY_MISSING', counted='pending')
                return True
            write_gz(body_path(out_dir, law_id), record, redactor)
            keep(law_id, record, 'read', 'SOURCE_BODY_REUSED_FROM_LAW_CENSUS_CACHE', counted='reusedFromCache')
            return True
        with lock:
            history.setdefault(str(law_id), {}).setdefault('cacheReason', reason)
        return False

    def remote(law_id, law):
        if aborted.is_set():
            keep(law_id, None, 'pending', 'PORTAL_AUTHORIZATION_FAILED_NOT_ATTEMPTED', counted='pending')
            return
        try:
            record, reason = fetch_body(law, portal, html_fallback=html_fallback)
        except AuthorizationFailed:
            aborted.set()
            keep(law_id, None, 'failed', 'PORTAL_AUTHORIZATION_FAILED', counted='failed')
            return
        except Exception as error:  # 망·형식 오류는 실패로 남기고 다음 법규를 잇는다.
            code = str(error) if str(error).startswith('PORTAL_') else type(error).__name__
            keep(law_id, None, 'failed', redactor.text(code), counted='failed')
            return
        if record is None:
            keep(law_id, None, 'failed', reason, counted='failed')
            return
        write_gz(body_path(out_dir, law_id), record, redactor)
        keep(law_id, record, 'read', 'SOURCE_BODY_READ_FROM_LAW_SERVICE', counted='fetched')

    def report(phase, **values):
        if progress is None:
            return
        progress({'phase': phase, 'laws': len(laws), 'forms': len(forms), 'checkedAt': checked_at,
                  'done': len(states), **counts, 'requests': getattr(portal, 'requests', 0), **values})

    order = list(laws)
    report('planned', pending=len(order))
    missing = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(local, law_id, laws[law_id]): law_id for law_id in order}
        for position, future in enumerate(concurrent.futures.as_completed(futures), 1):
            law_id = futures[future]
            try:
                if not future.result():
                    missing.append(law_id)
            except Exception as error:
                keep(law_id, None, 'failed', redactor.text(type(error).__name__), counted='failed')
            if position % 200 == 0 or position == len(order):
                report('local-reuse', done=position, missingSoFar=len(missing))
    missing.sort(key=int)
    selected = missing[:max_laws] if max_laws and max_laws > 0 else list(missing)
    for law_id in missing[len(selected):]:
        keep(law_id, None, 'pending', 'SOURCE_FETCH_NOT_ATTEMPTED_MAX_LAWS', counted='pending')
    report('fetch-selected', selected=len(selected), missing=len(missing))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(remote, law_id, laws[law_id]): law_id for law_id in selected}
        for position, future in enumerate(concurrent.futures.as_completed(futures), 1):
            law_id = futures[future]
            try:
                future.result()
            except Exception as error:
                keep(law_id, None, 'failed', redactor.text(type(error).__name__), counted='failed')
            if position % 20 == 0 or position == len(selected):
                report('fetch', done=position, total=len(selected))
    status = 'aborted' if aborted.is_set() else ('partial' if counts['pending'] else 'complete')
    evidence = assemble(scope, laws, states, stored, downloads_dir=downloads_dir, counts=counts,
                        status=status, checked_at=checked_at, out_dir=out_dir,
                        requests=getattr(portal, 'requests', 0))
    failures = {law_id: {'reason': states[law_id]['reason'], 'attempts': states[law_id]['attempts'],
                         'lastTriedAt': now(),
                         **({'cacheReason': history[law_id]['cacheReason']}
                            if law_id in history and 'cacheReason' in history[law_id] else {})}
                for law_id in sorted(states, key=int) if states[law_id]['state'] != 'read'}
    report('assembled', status=status)
    return evidence, failures


def assemble(scope, laws, states, bodies, *, downloads_dir, counts, status, checked_at, out_dir, requests):
    """모든 범위 ID를 pending·read·failed와 이유로 남기는 압축 색인."""
    form_rows, law_rows = {}, {}
    binding_counts = {name: 0 for name in BINDINGS}
    state_counts = {'read': 0, 'failed': 0, 'pending': 0}
    for law_id, law in laws.items():
        state = states.get(law_id, {'state': 'pending', 'reason': 'SOURCE_BODY_PENDING', 'attempts': 0})
        body = bodies.get(law_id)
        row = {'state': state['state'], 'reason': state['reason'], 'formCount': len(law['formIds']),
               'scopeTitles': law['scopeTitles'], 'cacheKeys': law['cacheKeys'], 'attempts': state['attempts'],
               'articleContentState': 'available' if body and body.get('articles') else 'missing' if body else 'unread'}
        if body:
            row.update(title=body.get('lawTitle', ''), stableLawId=body.get('stableLawId', ''),
                       orgName=body.get('orgName', ''), effectiveDate=body.get('effectiveDate', ''),
                       promulgationDate=body.get('promulgationDate', ''),
                       revisionKind=body.get('revisionKind', ''), source=body.get('source', ''),
                       annexSource=body.get('annexSource', ''), articleCount=body.get('articleCount', 0),
                       annexCount=body.get('annexCount', 0), htmlAnnexCount=len(body.get('htmlAnnexes') or []),
                       deletedAnnexCount=body.get('deletedAnnexCount', 0),
                       fetchedAt=body.get('fetchedAt', ''),
                       bodyPath=str(Path(BODIES_NAME) / (law_id + '.json.gz')).replace('\\', '/'),
                       publicUrl=body.get('publicUrl', ''), requestUrl=body.get('requestUrl', ''))
        law_rows[law_id] = row
    for form_id in sorted(scope['forms']):
        form = scope['forms'][form_id]
        if not form['valid']:
            form_rows[form_id] = {'lawId': form['lawId'], 'annexId': form['annexId'], 'state': 'failed',
                                  'reason': 'SCOPE_RECORD_INVALID', 'binding': 'source_unread',
                                  'bindingReason': BINDING_REASON['source_unread'],
                                  'scopeFlSeq': form['flSeq'], 'scopeTitle': form['title'],
                                  'original': original_evidence(downloads_dir, form)}
            state_counts['failed'] += 1
            binding_counts['source_unread'] += 1
            continue
        law_state = law_rows.get(form['lawId'], {'state': 'pending', 'reason': 'SOURCE_BODY_PENDING'})
        body = bodies.get(form['lawId'])
        binding = bind_annex(form, body)
        official_title = body.get('lawTitle', '') if body else ''
        row = {'lawId': form['lawId'], 'annexId': form['annexId'], 'state': law_state['state'],
               'reason': law_state['reason'] if law_state['state'] != 'read' else binding['bindingReason'],
               'scopeFlSeq': form['flSeq'], 'scopeTitle': form['title'],
               'lawTitleScope': form['lawTitle'], 'lawTitleOfficial': official_title,
               'lawTitleMatchesScope': bool(official_title) and compact(official_title) == compact(form['lawTitle']),
               'effectiveDate': body.get('effectiveDate', '') if body else '',
               'bodySource': body.get('source', '') if body else '',
               'articleContentState': law_state.get('articleContentState','unread'),
               'original': original_evidence(downloads_dir, form), **binding}
        # 읽지 못한 서식 줄에는 공식 쪽에 대해 할 말이 없다. 빈 칸을 늘리지 않는다.
        form_rows[form_id] = row if row['state'] == 'read' else {
            name: value for name, value in row.items() if name in _CORE_FORM_FIELDS}
        state_counts[row['state']] += 1
        binding_counts[binding['binding']] += 1
    summary = {'scopeForms': len(scope['forms']), 'scopeLaws': len(laws),
               'declaredFormCount': scope['declaredFormCount'],
               'duplicateFormIds': scope.get('duplicateFormIds', 0),
               'recordsWithoutFormId': scope.get('recordsWithoutFormId', 0),
               'formStates': state_counts, 'bindings': binding_counts,
               'laws': {'read': sum(1 for row in law_rows.values() if row['state'] == 'read'),
                        'articleContentAvailable': sum(1 for row in law_rows.values() if row['articleContentState']=='available'),
                        'articleContentMissing': sum(1 for row in law_rows.values() if row['articleContentState']=='missing'),
                        'failed': sum(1 for row in law_rows.values() if row['state'] == 'failed'),
                        'pending': sum(1 for row in law_rows.values() if row['state'] == 'pending'),
                        **counts},
               'portalRequests': requests}
    return {'schema': EVIDENCE_SCHEMA, 'generatedAt': now(), 'checkedAt': checked_at, 'status': status,
            'note': EVIDENCE_NOTE, 'baselineCommit': scope['baselineCommit'], 'scopeNote': scope['scopeNote'],
            'declaredFormCount': scope['declaredFormCount'], 'bodyDir': BODIES_NAME,
            'summary': summary, 'laws': law_rows, 'forms': form_rows}


def main(argv=None):
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='연결되지 않은 원본 첨부의 출처 증거 수집')
    parser.add_argument('--scope', default=DEFAULT_SCOPE)
    parser.add_argument('--audit', default=DEFAULT_AUDIT)
    parser.add_argument('--cache-dir', default=DEFAULT_CENSUS_CACHE, help='이미 읽어 둔 원문 캐시(읽기 전용)')
    parser.add_argument('--downloads-dir', default=DEFAULT_DOWNLOADS, help='내려받은 원본 기록(읽기 전용)')
    parser.add_argument('--out-dir', default=DEFAULT_OUT_DIR)
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--interval', type=float, default=MIN_INTERVAL, help='전체 호출 간 최소 간격(초)')
    parser.add_argument('--timeout', type=float, default=30.0)
    parser.add_argument('--attempts', type=int, default=4, help='429·503 등에 대한 재시도 횟수')
    parser.add_argument('--max-laws', type=int, default=0, help='이번 실행에서 새로 조회할 법규 상한(검증용)')
    parser.add_argument('--only-missing', action='store_true', help='조회가 필요한 법규만 본다고 알린다')
    parser.add_argument('--refresh', action='store_true', help='저장된 원문을 무시하고 다시 모은다')
    parser.add_argument('--no-html-fallback', action='store_true', help='별표 마디가 없을 때 공개 본문을 보지 않는다')
    parser.add_argument('--checked-at', default=date.today().isoformat())
    args = parser.parse_args(argv)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    scope = load_scope(args.scope)
    audit = read_json(args.audit) or {}
    interval = max(MIN_INTERVAL, args.interval)
    credential = load_credential()
    redactor = Redactor(credential)
    portal = Portal(credential, interval=interval, timeout=args.timeout, attempts=args.attempts,
                    redactor=redactor)
    prior = read_json(out_dir / FAILURES_NAME)
    started = now()
    state = {'startedAt': started, 'status': 'running', 'scope': str(args.scope),
             'requestsPerSecondMaximum': round(1 / interval, 2), 'workers': max(1, args.workers),
             'maxLaws': args.max_laws, 'refresh': bool(args.refresh)}

    def progress(values):
        state.update(values)
        state['updatedAt'] = now()
        write_json(out_dir / PROGRESS_NAME, state, redactor, indent=1)
        print(json.dumps(redactor.data({'event': 'progress', **values}), ensure_ascii=False), flush=True)

    print(json.dumps({'event': 'start', 'forms': len(scope['forms']), 'outDir': str(out_dir),
                      'maxLaws': args.max_laws, 'interval': interval}, ensure_ascii=False), flush=True)
    evidence, failures = collect(scope, audit, out_dir=out_dir, portal=portal, redactor=redactor,
                                 cache_dir=args.cache_dir, downloads_dir=args.downloads_dir,
                                 workers=args.workers, max_laws=args.max_laws,
                                 only_missing=args.only_missing, refresh=args.refresh,
                                 html_fallback=not args.no_html_fallback, progress=progress,
                                 checked_at=args.checked_at,
                                 prior_failures=prior if isinstance(prior, dict) else None)
    write_json(out_dir / EVIDENCE_NAME, evidence, redactor)
    write_json(out_dir / FAILURES_NAME, failures, redactor, indent=1)
    state.update(status=evidence['status'], finishedAt=now(), summary=evidence['summary'],
                 evidence=str(out_dir / EVIDENCE_NAME))
    write_json(out_dir / PROGRESS_NAME, state, redactor, indent=1)
    print(json.dumps(redactor.data({'event': 'finished', 'status': evidence['status'],
                                    'evidence': str(out_dir / EVIDENCE_NAME),
                                    **evidence['summary']}), ensure_ascii=False), flush=True)
    return 2 if evidence['status'] == 'aborted' else 0


if __name__ == '__main__':
    raise SystemExit(main())

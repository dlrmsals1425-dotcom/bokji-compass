"""복지사업이 인용한 법령의 원문을 실제로 읽어 증거만 모으는 조사 단계.

이 단계는 서식과 사업의 연결을 승인하지 않는다. 어떤 법령을 어떤 신분으로
확인했고(resolved) 원문을 정말 읽었는지(read)만 남긴다. 신원을 가리지 못했거나
후보가 갈리거나 읽기에 실패한 경우는 각각 not_found·ambiguous·failed로 남고,
읽지 못한 사실이 "서식이 없다"는 말로 바뀌지 않는다.

출처는 법령정보센터 공개 자료뿐이다. 인증 값(LAW_OC)은 메모리에만 두고
주소·캐시·로그·오류 문구 어디에도 남기지 않는다. 별표 색인
(logs/law-scan/annexes.sqlite)은 읽기 전용으로만 쓰고, 색인에 없다는 것이
법령이 없다는 뜻은 아니므로 색인이 비어도 공식 검색으로 이어서 확인한다.

사용 예
  python scripts/audit-form-laws.py --prepare-only
  python scripts/audit-form-laws.py --max-jobs 20
  python scripts/audit-form-laws.py --workers 4 --interval 0.4
"""
from __future__ import annotations

import argparse
import concurrent.futures
import gzip
import hashlib
import html as html_module
import importlib.util
import json
import os
import re
import sqlite3
import sys
import threading
import time
import tomllib
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from bs4 import BeautifulSoup
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
_citation_spec = importlib.util.spec_from_file_location('law_citation_splitter', ROOT / 'pipeline/forms/portal_match.py')
_citation_splitter = importlib.util.module_from_spec(_citation_spec)
_citation_spec.loader.exec_module(_citation_splitter)
DEFAULT_SOURCE_DIR = ROOT / 'public/bundles/v1/details'
DEFAULT_REGIONS = ROOT / 'public/bundles/v1/regions.json'
# 별표 색인은 옆 작업공간에서 이미 수집한 공개 자료다. 읽기 전용으로만 연다.
DEFAULT_ANNEX_DB = ROOT.parent / 'bokji/logs/law-scan/annexes.sqlite'
DEFAULT_LOG_DIR = ROOT / 'logs/law-census'
DEFAULT_OUTPUT = ROOT / 'pipeline/forms/law-body-audit.json'
PARTIAL_OUTPUT_NAME = 'law-body-audit.partial.json'
CACHE_VERSION = 1
USER_AGENT = 'BokjiCompass/1.0 (public welfare law audit)'
PORTAL = 'https://www.law.go.kr'
# 공개 자료에 남기는 증거는 짧게 자른다. 자른 자리는 …로 보인다.
ARTICLE_LIMIT = 12
ARTICLE_TEXT_LIMIT = 400
ANNEX_LIMIT = 60
RETRY_CODES = frozenset({429, 500, 502, 503, 504})

# ─── 글자 다듬기 ────────────────────────────────────────────────────────────
_QUOTES = '「」『』“”‘’"\''
# ㆍ(U+318D)는 NFKC에서 ᆞ(U+119E)가 된다. 가운뎃점 종류를 한자리에 모아 둔다.
_DOTS = '·ㆍ・･‧․•∙⋅ᆞ.'
_ARTICLE_UNIT = r'(?:제\s*)?\d+\s*조(?:\s*의\s*\d+)?|(?:제\s*)?\d+\s*[항호목](?:\s*의\s*\d+)?'
_ARTICLE_NOTE = r'(?:\s*\([^()]*\))?'
_ARTICLE_JOIN = r'(?:\s*(?:,|，|및|또는|~|-|부터|까지|내지)\s*|\s+)'
_ARTICLE_TAIL = re.compile(
    r'(?:' + _ARTICLE_JOIN + r'?(?:' + _ARTICLE_UNIT + r')' + _ARTICLE_NOTE + r')+\s*$')
# 괄호 안이 통째로 조문 인용인 끝맺음. 「축산법(제3조)」 꼴을 떼어 낸다.
_PAREN_ARTICLES = re.compile(r'\((?=[^()]*\d+\s*[조항호])[^()]*\)\s*$')
_TRAILING_NOISE = re.compile(r'[\s,，.·ㆍ:：;；/(（]+$')
_TRAILING_NUMBERS = re.compile(r'\s\d+(?:\s*[,，]\s*\d+)*$')
_ARTICLE_HEAD = re.compile(r'제\s*(\d+)\s*조(?:\s*의\s*(\d+))?')
_FORM_IN_BODY = re.compile(r'별지\s*제?\s*\d+\s*호\s*(?:서식|양식)')
# 신청·청구·별지가 제목에 있는 조문만 모은다. 본문은 별지 서식을 가리킬 때만 본다.
_APPLICATION_WORDS = ('신청', '청구', '별지')
_LAW_SUFFIX = ('법', '법률', '특별법', '시행령', '시행규칙', '조례', '규칙', '규정',
               '준칙', '지침', '고시', '훈령', '예규', '요령', '기준')
# 이것만 남으면 어떤 법령인지 가리킬 수 없는 말이다.
_GENERIC_TITLE = frozenset({'법', '법률', '조례', '규칙', '시행령', '시행규칙', '규정',
                            '지침', '고시', '훈령', '예규', '요령', '기준', '준칙', '특별법'})
_SECRET_PARAM = re.compile(r'^(oc|key|token|servicekey|apikey|auth|secret|password|signature)$', re.I)
_SECRET_PAIR = re.compile(r'(?i)\b(oc|key|token|servicekey|apikey|auth|secret|password|signature)=[^&\s"\'<>]+')
_SCRIPT_BLOCK = re.compile(r'(?is)<(script|style|noscript|head)[^>]*>.*?</\1>')
_HTML_TAG = re.compile(r'<[^>]+>')


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def squeeze(value) -> str:
    """NFKC로 맞추고 따옴표를 떼고 공백을 한 칸으로 줄인다."""
    text = unicodedata.normalize('NFKC', str(value or ''))
    text = ''.join(' ' if character in _QUOTES else character for character in text)
    return ' '.join(text.split())


def index_key(value) -> str:
    """별표 색인(law_norm)과 같은 방식의 대조 키. NFKC 뒤 공백만 지운다."""
    return ''.join(unicodedata.normalize('NFKC', str(value or '')).split())


def loose_key(value) -> str:
    """가운뎃점·마침표 표기만 다른 제목을 맞추는 키. 글자 자체는 지우지 않는다."""
    return ''.join(character for character in index_key(value) if character not in _DOTS)


def public_url(value):
    """법령정보센터 공개 주소만 남기고 인증 값은 떼어 낸다."""
    if not value or not str(value).strip().startswith(('https://', 'http://', '/')):
        return None
    try:
        url = urllib.parse.urlsplit(urllib.parse.urljoin(PORTAL, str(value).strip()))
    except ValueError:
        return None
    if url.hostname not in {'www.law.go.kr', 'law.go.kr'} or url.username or url.password:
        return None
    query = urllib.parse.urlencode([(name, value) for name, value in
                                    urllib.parse.parse_qsl(url.query, keep_blank_values=True)
                                    if not _SECRET_PARAM.fullmatch(name)])
    return urllib.parse.urlunsplit(('https', 'www.law.go.kr', url.path, query, ''))


class Redactor:
    """인증 값을 가린다. 응답 본문이 OC를 되돌려 주므로 저장 전에 반드시 거친다."""

    def __init__(self, *secrets):
        self.secrets = sorted({str(secret) for secret in secrets if secret and len(str(secret)) >= 4},
                              key=len, reverse=True)

    def text(self, value) -> str:
        result = str(value)
        for secret in self.secrets:
            result = result.replace(secret, '[redacted]')
        return _SECRET_PAIR.sub(lambda match: match.group(1) + '=[redacted]', result)

    def data(self, value):
        if isinstance(value, dict):
            return {self.text(key): '[redacted]' if str(key).lower() != 'key' and _SECRET_PARAM.fullmatch(str(key)) else self.data(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [self.data(item) for item in value]
        if isinstance(value, str):
            return self.text(value)
        return value


# ─── 인용 문장 정리 ─────────────────────────────────────────────────────────
def split_citations(raw):
    """후보 매칭과 같은 경계를 사용한다. 따옴표 보호 후 표기만 정규화한다."""
    return [squeeze(part) for part in _citation_splitter.split_law_citations(raw)]


def strip_articles(citation):
    """뒤에 붙은 조·항·호를 떼어 법령 제목만 남긴다. 떼어 낸 조문도 돌려준다."""
    title = squeeze(citation)
    articles = []
    # Official citations often append promulgation metadata or an article title.
    title = re.sub(r'\[(?:법률|조례|규칙|대통령령|부령)\s*제[^\]]+\]\s*$', '', title).strip()
    title = re.sub(r'\(\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\.?\)\s*$', '', title).strip()
    head = _ARTICLE_HEAD.search(title)
    if head and law_shaped(title[:head.start()].strip()):
        return title[:head.start()].strip(), [title[head.start():]]
    while title:
        trimmed = _TRAILING_NOISE.sub('', title)
        paren = _PAREN_ARTICLES.search(trimmed)
        if paren:
            articles.insert(0, trimmed[paren.start():].strip('() '))
            title = trimmed[:paren.start()]
            continue
        match = _ARTICLE_TAIL.search(trimmed)
        if match and match.group(0).strip():
            articles.insert(0, match.group(0).strip(' ,，·'))
            title = trimmed[:match.start()]
            continue
        # 「제5조 1,2호」처럼 조문 뒤에 번호만 남은 꼬리. 가지번호(제104조의 2)는 남긴다.
        numbers = _TRAILING_NUMBERS.search(trimmed)
        if numbers and _ARTICLE_HEAD.search(trimmed[:numbers.start()]) \
                and not trimmed[:numbers.start()].rstrip().endswith('의'):
            title = trimmed[:numbers.start()]
            continue
        title = trimmed
        break
    return _TRAILING_NOISE.sub('', title).strip(), articles


def law_shaped(title) -> bool:
    """법령 제목으로 볼 수 있는 말인지. 계획·사업 이름은 여기서 걸러진다."""
    cleaned = squeeze(title)
    if not cleaned or index_key(cleaned) in _GENERIC_TITLE:
        return False
    return cleaned.endswith(_LAW_SUFFIX)


def guess_kind(title, has_region) -> str:
    """조회 대상 짐작. 확정은 신원 확인 뒤에 다시 정한다."""
    # '낚시', '도시' 같은 제목 단어를 지방자치단체 접두사로 오인하더라도
    # 법률의 시행령·시행규칙을 자치법규로 바꾸지 않는다.
    if re.search(r'(?:법|법률)\s*(?:시행령|시행규칙)$', title):
        return 'law'
    if title.endswith('조례'):
        return 'ordin'
    if (has_region or '조례' in title) and title.endswith('규칙'):
        return 'ordin'
    if title.endswith(('시행령', '시행규칙')):
        return 'law'
    if title.endswith('규칙'):
        return 'ordin' if has_region else 'law'
    if title.endswith(('법', '법률', '특별법')):
        return 'law'
    return 'rule'


# ─── 지역 ──────────────────────────────────────────────────────────────────
_EDUCATION_ALIASES = {
    short + '시교육청': official + '교육청'
    for short, official in (
        ('서울', '서울특별시'), ('부산', '부산광역시'), ('대구', '대구광역시'),
        ('인천', '인천광역시'), ('광주', '광주광역시'), ('대전', '대전광역시'),
        ('울산', '울산광역시'), ('세종', '세종특별자치시'),
    )
}


def education_authority(title):
    """명시된 교육청만 인식한다. 교육청과 시·도청/교육지원청을 합치지 않는다."""
    match = re.match(r'^(.+?교육청)', index_key(squeeze(title)))
    if not match or match[1] == '교육청':
        return None
    return _EDUCATION_ALIASES.get(match[1], match[1])


class RegionIndex:
    """지역 이름과 코드. 제목 앞머리의 지역명을 사업 지역과 함께 가린다."""

    def __init__(self, regions):
        self.sido = {}
        self.sigungu = {}
        self.label = {}
        for province in regions['sidos']:
            self.sido[index_key(province['name'])] = province['code']
            self.label[province['code']] = province['name']
            for city in province['sigungus']:
                self.sigungu.setdefault(index_key(city['name']), []).append((city['code'], province['code']))
                self.label[city['code']] = province['name'] + ' ' + city['name']

    @classmethod
    def load(cls, path):
        return cls(json.loads(Path(path).read_text(encoding='utf-8')))

    def prefix(self, title, program_region):
        """제목 앞의 지역 이름. 같은 이름이 여럿이면 사업 지역으로 가린다."""
        authority = education_authority(title)
        if authority:
            # 시군구 사업이 교육청 조례를 인용해도 소관 교육청을 유지한다.
            # 지역 목록에 없는 옛/미확정 교육청은 사업 지역으로 추정하지 않는다.
            code = self.sido.get(authority[:-len('교육청')])
            return code or 'unresolved', authority, bool(code)
        words = squeeze(title).split()
        if not words:
            return None
        head = index_key(words[0])
        pair = index_key(''.join(words[:2])) if len(words) > 1 else None
        province = self.sido.get(head)
        if province and pair:
            for code, parent in self.sigungu.get(index_key(words[1]), []):
                if parent == province:
                    return code, self.label[code], True
        if province:
            return province, self.label[province], True
        candidates = self.sigungu.get(head, [])
        if len(candidates) == 1:
            code = candidates[0][0]
            return code, self.label[code], True
        if candidates and program_region:
            own = program_region.get('sigungu')
            sido = program_region.get('sido')
            for code, parent in candidates:
                if code == own:
                    return code, self.label[code], True
            narrowed = [code for code, parent in candidates if parent == sido]
            if len(narrowed) == 1:
                return narrowed[0], self.label[narrowed[0]], True
        if candidates:
            # 같은 이름의 시·군·구가 여럿인데 사업 지역으로도 가릴 수 없다.
            return 'unresolved', words[0], False
        if re.fullmatch(r'.+(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구)', words[0]):
            # 통합·개칭으로 지역 목록에 없는 이름. 공식 검색의 기관명으로 확인한다.
            return 'unresolved', words[0], False
        return None


def jurisdiction(title, kind, program, regions):
    """이 인용이 어느 관할의 법령인지. 전국 법령은 national로 둔다."""
    if kind == 'law':
        return 'national', '전국 공통'
    program_region = program.get('region') if isinstance(program.get('region'), dict) else {}
    found = regions.prefix(title, program_region)
    if found:
        code, label, _resolved = found
        return code, label
    if kind == 'ordin':
        own = program_region.get('sigungu') or program_region.get('sido')
        if own:
            return own, regions.label.get(own, own)
        return 'unresolved', ''
    return 'national', '전국 공통'


def law_key(region_code, region_label, title) -> str:
    """결정적인 법령 키. 관할을 앞에 두어 출력에서도 관할이 드러난다."""
    token = region_code if region_code != 'unresolved' else 'at:' + (loose_key(region_label) or 'unknown')
    return token + '|' + index_key(title)


def title_keys(job):
    """Expand only the known jurisdiction prefix, never arbitrary title words."""
    keys = {job['titleKey']}
    authority = education_authority(job['regionLabel'])
    if authority:
        prefix = re.match(r'^(.+?교육청)', job['titleKey'])
        if prefix:
            keys.add(authority + job['titleKey'][prefix.end():])
        return keys
    if job['kindGuess'] != 'ordin' or job['regionCode'] in ('national', 'unresolved'):
        return keys
    words = squeeze(job['regionLabel']).split()
    query = job['titleKey']
    if len(words) == 2:
        province, district = map(index_key, words)
        if query.startswith(district):
            keys.add(province + query)
        # A generic local-law title is qualified by this program's jurisdiction.
        elif not re.match(r'.+?(?:시|도|군|구)(?:청|교육청)?', squeeze(job['query']).split()[0]):
            keys.add(province + district + query)
            keys.add(district + query)
    return keys


# ─── 계획 ──────────────────────────────────────────────────────────────────
def read_programs(source_dir):
    programs = {}
    for file in sorted(Path(source_dir).glob('*.json')):
        data = json.loads(file.read_text(encoding='utf-8-sig'))
        if not isinstance(data, dict):
            raise ValueError('Program file is not an object: ' + file.name)
        programs.update(data)
    return programs


def plan(programs, regions):
    """사업이 인용한 법령을 정규화·중복 제거해 조회 계획을 만든다."""
    jobs, program_keys, skipped = {}, {}, []
    for program_id in sorted(programs):
        program = programs[program_id]
        laws = program.get('laws')
        if isinstance(laws, str):
            laws = [laws]
        keys = []
        for raw in laws or []:
            for citation in split_citations(raw):
                title, articles = strip_articles(citation)
                if not law_shaped(title):
                    skipped.append({'programId': program_id, 'citation': citation,
                                    'title': title,
                                    'reason': 'GENERIC_LAW_WORD_ONLY' if index_key(title) in _GENERIC_TITLE
                                    else 'NOT_LAW_SHAPED'})
                    continue
                found = regions.prefix(title, program.get('region') if isinstance(program.get('region'), dict) else {})
                kind = guess_kind(title, bool(found))
                region_code, region_label = jurisdiction(title, kind, program, regions)
                key = law_key(region_code, region_label, title)
                job = jobs.get(key)
                if not job:
                    job = jobs[key] = {'key': key, 'query': title, 'titleKey': index_key(title),
                                       'looseKey': loose_key(title), 'kindGuess': kind,
                                       'regionCode': region_code, 'regionLabel': region_label,
                                       'citations': [], 'citedArticles': [], 'programIds': []}
                if citation not in job['citations']:
                    job['citations'].append(citation)
                for article in articles:
                    if article not in job['citedArticles']:
                        job['citedArticles'].append(article)
                if program_id not in job['programIds']:
                    job['programIds'].append(program_id)
                if key not in keys:
                    keys.append(key)
        program_keys[program_id] = sorted(keys)
    for job in jobs.values():
        job['citations'].sort()
        job['citedArticles'].sort()
        job['programIds'].sort()
    return jobs, program_keys, skipped


# ─── 별표 색인 ──────────────────────────────────────────────────────────────
class AnnexIndex:
    """이미 수집한 공식 별표 색인. 읽기 전용이고 없으면 공식 검색만 쓴다."""

    def __init__(self, path):
        self.path = Path(path) if path else None
        self.available = bool(self.path and self.path.exists())
        self.local = threading.local()
        self.lock = threading.Lock()
        self.loose = None

    def connection(self):
        connection = getattr(self.local, 'connection', None)
        if connection is None:
            connection = sqlite3.connect('file:' + self.path.as_posix() + '?mode=ro', uri=True, timeout=30)
            self.local.connection = connection
        return connection

    def loose_map(self):
        """점·공백 표기만 다른 제목을 잇는 보조 색인. 한 번만 만든다."""
        with self.lock:
            if self.loose is None:
                mapping = {}
                for (law_norm,) in self.connection().execute('SELECT DISTINCT law_norm FROM annexes'):
                    mapping.setdefault(loose_key(law_norm), set()).add(law_norm)
                self.loose = mapping
            return self.loose

    def rows(self, job):
        """같은 제목·같은 관할의 별표 행. 관할이 다르면 쓰지 않는다."""
        if not self.available:
            return []
        titles = title_keys(job)
        for candidate in tuple(titles):
            titles.update(self.loose_map().get(loose_key(candidate), set()))
        region = job['regionCode'] if job['regionCode'] != 'unresolved' else 'unresolved'
        found = []
        for title in sorted(titles):
            for (payload,) in self.connection().execute(
                    'SELECT payload FROM annexes WHERE law_norm=? AND region_code=?', (title, region)):
                row = json.loads(payload)
                if education_authority(job['regionLabel']) and not jurisdiction_ok(job, row.get('regionLabel')):
                    continue
                if region == 'unresolved' and not education_authority(job['regionLabel']):
                    label = loose_key(job['regionLabel'])
                    org = loose_key(row.get('regionLabel'))
                    if not label or not (org == label or org.endswith(label) or label.endswith(org)):
                        continue
                found.append(row)
        return found

    def identity(self, job):
        """색인만으로 신원이 하나로 좁혀질 때만 확정한다."""
        groups = {}
        for row in self.rows(job):
            groups.setdefault((row.get('sourceKind'), str(row.get('lawId') or '')), []).append(row)
        groups = {key: rows for key, rows in groups.items() if key[1]}
        if len(groups) != 1:
            return None, len(groups)
        (kind, law_id), rows = next(iter(groups.items()))
        return {'kind': kind, 'id': law_id, 'title': squeeze(rows[0].get('lawTitle')),
                'url': law_url(kind, law_id), 'org': rows[0].get('regionLabel') or '',
                'source': 'annex-index'}, 1

def law_url(kind, law_id):
    if not law_id:
        return ''
    if kind == 'ordin':
        return PORTAL + '/ordinInfoP.do?ordinSeq=' + str(law_id)
    if kind == 'rule':
        return PORTAL + '/LSW/admRulInfoP.do?admRulSeq=' + str(law_id)
    return PORTAL + '/LSW/lsInfoP.do?lsiSeq=' + str(law_id)


# ─── 공개 자료 호출 ─────────────────────────────────────────────────────────
def load_credential():
    """현재 설정된 법령정보센터 OC. 값은 돌려주기만 하고 어디에도 적지 않는다."""
    value = os.environ.get('LAW_OC')
    if value:
        return value.strip()
    profile = os.environ.get('USERPROFILE') or os.environ.get('HOME')
    config = Path(profile or '.') / '.codex/config.toml'
    if config.exists():
        data = tomllib.loads(config.read_text(encoding='utf-8'))
        value = data.get('mcp_servers', {}).get('korean-law', {}).get('env', {}).get('LAW_OC')
        if value:
            return str(value).strip()
    raise RuntimeError('Configured LAW_OC is not available')


class AuthorizationFailed(RuntimeError):
    pass


class Portal:
    """법령정보센터 공개 API. 전체 호출에 한 줄 간격을 두고 재시도한다."""

    def __init__(self, credential, interval=0.4, timeout=30, attempts=4, redactor=None):
        self.credential = credential
        self.interval = max(0.0, interval)
        self.timeout = timeout
        self.attempts = max(1, attempts)
        self.redactor = redactor or Redactor(credential)
        self.lock = threading.Lock()
        self.next_request = 0.0
        self.requests = 0

    def wait(self):
        with self.lock:
            delay = max(0.0, self.next_request - time.monotonic())
            self.next_request = max(self.next_request, time.monotonic()) + self.interval
            self.requests += 1
        if delay:
            time.sleep(delay)

    def fetch(self, path, params):
        """원문 문자열과 인증 값을 뺀 주소를 돌려준다."""
        query = urllib.parse.urlencode({'OC': self.credential, **params})
        address = PORTAL + '/DRF/' + path + '?' + query
        safe = public_url(address) or (PORTAL + '/DRF/' + path)
        last = 'PORTAL_REQUEST_INCOMPLETE'
        for attempt in range(self.attempts):
            self.wait()
            request = urllib.request.Request(address, headers={'User-Agent': USER_AGENT,
                                                               'Accept-Encoding': 'gzip'})
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    raw = response.read()
                    if response.headers.get('Content-Encoding') == 'gzip':
                        raw = gzip.decompress(raw)
                return raw.decode('utf-8', 'replace'), safe
            except urllib.error.HTTPError as error:
                if error.code in {401, 403}:
                    raise AuthorizationFailed('PORTAL_AUTHORIZATION_FAILED') from None
                if error.code not in RETRY_CODES:
                    raise RuntimeError('PORTAL_HTTP_' + str(error.code)) from None
                last = 'PORTAL_HTTP_' + str(error.code)
                pause = str(error.headers.get('Retry-After') or '')
                self.sleep(min(60, int(pause)) if pause.isdigit() else min(30, 2 ** (attempt + 1)))
            except (TimeoutError, urllib.error.URLError, OSError) as error:
                last = 'PORTAL_' + type(error).__name__.upper()
                if attempt + 1 < self.attempts:
                    self.sleep(min(30, 2 ** (attempt + 1)))
        raise RuntimeError(last)

    def sleep(self, seconds):
        time.sleep(seconds)

    def search(self, target, query, display=20):
        raw, safe = self.fetch('lawSearch.do', {'type': 'JSON', 'target': target, 'query': query,
                                                'display': str(display), 'page': '1', 'search': '1'})
        return parse_json(raw), safe

    def body(self, target, law_id, as_html=False):
        raw, safe = self.fetch('lawService.do', {'type': 'HTML' if as_html else 'JSON',
                                                 'target': target, 'MST': str(law_id)})
        return (raw if as_html else parse_json(raw)), safe

    def public_body(self, kind, law_id):
        if not str(law_id).isdigit():
            raise ValueError('Invalid law identity')
        path, parameter = {'ordin': ('ordinInfoR.do', 'ordinSeq'),
                           'law': ('lsInfoR.do', 'lsiSeq'),
                           'rule': ('admRulLsInfoR.do', 'admRulSeq')}[kind]
        address = PORTAL + '/LSW/' + path + '?' + urllib.parse.urlencode({parameter: law_id, 'chrClsCd': '010202'})
        self.wait()
        request = urllib.request.Request(address, headers={'User-Agent': USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return response.read(20 * 1024 * 1024).decode('utf-8', 'replace'), address
        except (OSError, urllib.error.URLError):
            raise RuntimeError('PORTAL_PUBLIC_BODY_UNAVAILABLE') from None


def parse_json(raw):
    try:
        data = json.loads(raw)
    except ValueError:
        raise RuntimeError('PORTAL_INVALID_JSON') from None
    if not isinstance(data, dict):
        raise RuntimeError('PORTAL_INVALID_JSON')
    return data


# ─── 응답 읽기 ──────────────────────────────────────────────────────────────
def search_rows(payload, target):
    """검색 응답에서 결과 줄만 꺼낸다. 대상마다 담는 이름이 다르다."""
    body = None
    for value in payload.values():
        if isinstance(value, dict) and ('totalCnt' in value or 'resultCode' in value):
            body = value
            break
    if body is None:
        return []
    names = {'law': ('law', 'Law'), 'ordin': ('ordin', 'law', 'Ordin'), 'admrul': ('admrul', 'law', 'AdmRul')}
    rows = None
    for name in names.get(target, (target,)):
        if name in body:
            rows = body[name]
            break
    if rows is None:
        rows = next((value for value in body.values() if isinstance(value, (list, dict))
                     and not isinstance(value, str)), None)
    if rows is None:
        return []
    if isinstance(rows, dict):
        rows = [rows]
    return [row for row in rows if isinstance(row, dict)]


def pick(row, *names):
    for name in names:
        if row.get(name):
            return str(row[name])
    return ''


def row_identity(row, target):
    """검색 결과 한 줄의 제목·식별자·기관."""
    if target == 'ordin':
        return (pick(row, '자치법규명'), pick(row, '자치법규일련번호'), pick(row, '지자체기관명'),
                pick(row, '자치법규종류'), '')
    if target == 'admrul':
        return (pick(row, '행정규칙명'), pick(row, '행정규칙일련번호'), pick(row, '소관부처명'),
                pick(row, '행정규칙종류'), pick(row, '현행연혁구분', '현행연혁코드'))
    return (pick(row, '법령명한글', '법령명'), pick(row, '법령일련번호'), pick(row, '소관부처명'),
            pick(row, '법령구분명'), pick(row, '현행연혁코드'))


def article_nodes(payload):
    """어느 대상이든 조문 마디를 찾아 낸다. 대상마다 그릇 이름이 다르다."""
    found = []

    def walk(node):
        if isinstance(node, dict):
            text = next((node[name] for name in ('조문내용', '조내용') if isinstance(node.get(name), (str, list))), None)
            if text is not None:
                found.append(node)
                return
            for key, value in node.items():
                if key in ('조문내용', '조내용') and isinstance(value, list):
                    found.extend({'조문내용': item} for item in value if isinstance(item, str))
                else:
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return found


def node_text(node):
    """조문 마디에 달린 항·호까지 이어 붙인 본문."""
    parts = []

    def walk(value):
        if isinstance(value, str):
            text = value.strip()
            if text:
                parts.append(text)
        elif isinstance(value, dict):
            for key in sorted(value, key=lambda name: (0 if name in ('조문내용', '조내용') else
                                                       1 if name.endswith('내용') else 2, name)):
                if key.endswith(('번호', '키', '여부', '일자', '구분')):
                    continue
                walk(value[key])
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(node)
    return ' '.join(' '.join(parts).split())


def article_number(node, text):
    number = str(node.get('조문번호') or '').lstrip('0') if isinstance(node, dict) else ''
    if isinstance(node, dict) and isinstance(node.get('조문번호'), list):
        number = str(node['조문번호'][0]).lstrip('0')
    branch = str(node.get('조문가지번호') or '').lstrip('0') if isinstance(node, dict) else ''
    if number.isdigit():
        return '제' + number + '조' + ('의' + branch if branch else '')
    match = _ARTICLE_HEAD.match(text.strip())
    if match:
        return '제' + match.group(1) + '조' + ('의' + match.group(2) if match.group(2) else '')
    return ''


def application_articles(nodes):
    """신청·청구·별지와 닿는 조문만 추린다. 전체 조문 수도 함께 돌려준다."""
    collected, total = [], 0
    for node in nodes:
        text = node_text(node)
        if not text:
            continue
        total += 1
        heading = str(node.get('조문제목') or node.get('조제목') or '') + ' ' + (text.split(')')[0] if text.startswith('제') else text[:60])
        hit = any(word in heading for word in _APPLICATION_WORDS) or bool(_FORM_IN_BODY.search(text))
        if not hit:
            continue
        number = article_number(node, text)
        if not number:
            continue
        body = text if len(text) <= ARTICLE_TEXT_LIMIT else text[:ARTICLE_TEXT_LIMIT].rstrip() + '…'
        collected.append({'number': number, 'text': body})
    seen, unique = set(), []
    for article in collected:
        if article['number'] in seen:
            continue
        seen.add(article['number'])
        unique.append(article)
    return unique[:ARTICLE_LIMIT], total


def body_annexes(payload):
    """원문에 붙은 별표·서식. 주소는 공개 주소만 남긴다."""
    found = []

    def walk(node):
        if isinstance(node, dict):
            title = next((node[name] for name in ('별표제목', '별표명') if isinstance(node.get(name), str)), None)
            if title:
                entry = {'title': squeeze(title)}
                number = str(node.get('별표번호') or '').strip()
                branch = str(node.get('별표가지번호') or '').strip().lstrip('0')
                if number:
                    entry['number'] = number.lstrip('0') + ('의' + branch if branch else '')
                key = str(node.get('별표키') or '').strip()
                if key:
                    entry['id'] = key
                url = public_url(node.get('별표첨부파일명') or node.get('별표서식파일링크'))
                pdf = public_url(node.get('별표서식PDF파일링크'))
                if url:
                    entry['url'] = url
                if pdf:
                    entry['pdfUrl'] = pdf
                found.append(entry)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return found


def merge_annexes(*groups):
    merged, seen = [], set()
    for group in groups:
        for entry in group:
            mark = (entry.get('number', ''), index_key(entry.get('title')))
            if mark in seen:
                continue
            seen.add(mark)
            merged.append(entry)
    return merged[:ANNEX_LIMIT]


def html_text(raw):
    text = _SCRIPT_BLOCK.sub(' ', str(raw or ''))
    text = _HTML_TAG.sub(' ', text)
    return ' '.join(html_module.unescape(text).split())


def empty_shell(text) -> bool:
    """HTTP 200이어도 본문이 없는 응답. 조문 한 줄과 최소 길이를 함께 본다."""
    cleaned = ' '.join(str(text or '').split())
    return len(cleaned) < 200 or not _ARTICLE_HEAD.search(cleaned)


def real_body(nodes):
    """A table of contents or article headings alone are not the law body."""
    return any(len(node_text(n)) >= 40 and re.search(r'다[.。]', node_text(n)) for n in nodes)


def html_article_nodes(raw):
    soup = BeautifulSoup(raw, 'html.parser')
    for element in soup.select('script,style,noscript,head'):
        element.decompose()
    blocks = soup.select('.lawcon')
    if blocks:
        return [{'조문내용': ' '.join(block.stripped_strings)} for block in blocks]
    # Preserve line boundaries so a citation inside an article cannot split it.
    plain = soup.get_text('\n', strip=True)
    marks = list(re.finditer(r'(?m)^\s*제\s*\d+\s*조(?:\s*의\s*\d+)?\s*[（(]', plain))
    return [{'조문내용': ' '.join(plain[m.start():marks[i + 1].start() if i + 1 < len(marks) else len(plain)].split())}
            for i, m in enumerate(marks)]


def text_articles(text):
    """HTML 대체 경로에서 조문을 끊어 읽는다."""
    cleaned = ' '.join(str(text or '').split())
    marks = [match.start() for match in _ARTICLE_HEAD.finditer(cleaned)]
    nodes = []
    for position, start in enumerate(marks):
        end = marks[position + 1] if position + 1 < len(marks) else len(cleaned)
        nodes.append({'조문내용': cleaned[start:end].strip()})
    return nodes


# ─── 신원 확인과 읽기 ───────────────────────────────────────────────────────
def jurisdiction_ok(job, org):
    """검색 결과의 기관이 이 인용의 관할과 같은 곳인지."""
    authority = education_authority(job['regionLabel'])
    if authority:
        found = index_key(squeeze(org))
        return _EDUCATION_ALIASES.get(found, found) == authority
    if job['kindGuess'] != 'ordin' and job['regionCode'] == 'national':
        return True
    label = loose_key(job['regionLabel'])
    found = loose_key(org)
    if not label:
        return False
    if not found:
        return False
    return found == label or found.endswith(label) or label.endswith(found)


def search_targets(job):
    if job['kindGuess'] == 'ordin':
        return ['ordin']
    if job['kindGuess'] == 'rule':
        return ['admrul', 'law']
    return ['law', 'admrul']


def resolve(job, portal, annexes, raw_log):
    """법령 신원 확인. 색인이 하나로 좁혀 주면 쓰고, 아니면 공식 검색을 한다."""
    identity, groups = annexes.identity(job)
    if identity:
        return identity, None
    index_note = 'INDEX_AMBIGUOUS_' + str(groups) if groups > 1 else None
    for target in search_targets(job):
        query = job['query']
        authority = education_authority(job['regionLabel'])
        if authority and '교육청' in query:
            query = authority + query[query.index('교육청') + len('교육청'):]
        payload, safe = portal.search(target, query)
        raw_log.append({'step': 'search', 'target': target, 'url': safe, 'payload': payload})
        matches = []
        for row in search_rows(payload, target):
            title, law_id, org, kind, status = row_identity(row, target)
            if not law_id:
                continue
            if index_key(title) not in title_keys(job) and loose_key(title) not in {loose_key(k) for k in title_keys(job)} \
                    and loose_key(pick(row, '법령약칭명')) != job['looseKey']:
                continue
            if (target == 'ordin' or authority) and not jurisdiction_ok(job, org):
                continue
            if target != 'ordin' and job['kindGuess'] == 'ordin':
                continue
            matches.append({'kind': {'ordin': 'ordin', 'admrul': 'rule'}.get(target, 'law'),
                            'id': law_id, 'title': squeeze(title), 'url': law_url(
                                {'ordin': 'ordin', 'admrul': 'rule'}.get(target, 'law'), law_id),
                            'org': org, 'status': status, 'source': 'law-search'})
        if len(matches) > 1:
            current = [match for match in matches if match['status'] in ('현행', '')]
            if len({match['id'] for match in current}) == 1:
                matches = current[:1]
        if len(matches) == 1:
            return matches[0], None
        if len(matches) > 1:
            return None, 'AMBIGUOUS_' + str(len({match['id'] for match in matches})) + '_CANDIDATES'
    return None, index_note or 'NOT_FOUND'


def read_body(job, identity, portal, index, raw_log):
    """원문을 실제로 읽는다. 본문이 비면 HTML 경로로 한 번 더 확인한다."""
    target = {'ordin': 'ordin', 'rule': 'admrul'}.get(identity['kind'], 'law')
    nodes, annexes = [], []
    try:
        payload, safe = portal.body(target, identity['id'])
        raw_log.append({'step': 'body', 'target': target, 'url': safe, 'payload': payload})
        nodes = article_nodes(payload)
        annexes = body_annexes(payload)
    except AuthorizationFailed:
        raise
    except (ValueError, RuntimeError):
        raw_log.append({'step': 'body', 'errorCode': 'BODY_API_UNREADABLE'})
    if not real_body(nodes):
        text, safe = portal.public_body(identity['kind'], identity['id'])
        raw_log.append({'step': 'body-html', 'target': target, 'url': safe, 'payload': text})
        nodes = html_article_nodes(text)
    if not real_body(nodes):
        return 'failed', 'EMPTY_BODY', [], annexes
    articles, _total = application_articles(nodes)
    indexed = [entry for entry in index_annexes(index, job, identity)]
    return 'read', None, articles, merge_annexes(annexes, indexed)


def index_annexes(index, job, identity):
    """색인이 가진 같은 법령의 별표. 공개 주소와 별표 식별자를 함께 남긴다."""
    found = []
    for row in index.rows(job):
        if str(row.get('lawId') or '') != str(identity['id']):
            continue
        entry = {'id': row.get('id'), 'title': squeeze(row.get('title'))}
        number = str(row.get('annexNumber') or '').strip().lstrip('0')
        if number:
            entry['number'] = number
        url = public_url(row.get('sourceUrl'))
        pdf = public_url(row.get('officialPdfUrl'))
        if url:
            entry['url'] = url
        if pdf:
            entry['pdfUrl'] = pdf
        found.append(entry)
    return found


def process(job, portal, index, checked_at):
    """법령 한 건의 조사. 돌려주는 기록은 계약된 모양 그대로다."""
    raw_log = []
    record = {'query': job['query'], 'kind': job['kindGuess'], 'id': '', 'title': '', 'url': '',
              'state': 'failed', 'checkedAt': checked_at, 'applicationArticles': [], 'annexes': []}
    try:
        identity, reason = resolve(job, portal, index, raw_log)
        if not identity:
            record['state'] = 'ambiguous' if str(reason).startswith(('AMBIGUOUS', 'INDEX_AMBIGUOUS')) else 'not_found'
            record['errorCode'] = reason
            return record, raw_log
        record.update({'kind': identity['kind'], 'id': str(identity['id']),
                       'title': identity['title'] or job['query'], 'url': identity['url']})
        state, error, articles, annexes = read_body(job, identity, portal, index, raw_log)
        record['state'] = state
        record['applicationArticles'] = articles
        record['annexes'] = annexes
        if error:
            record['errorCode'] = error
    except AuthorizationFailed:
        raise
    except Exception as error:  # 네트워크·형식 오류는 실패로 남기고 다음 건을 잇는다.
        record['state'] = 'failed'
        record['errorCode'] = str(error) if str(error).startswith('PORTAL_') else type(error).__name__
    return record, raw_log


# ─── 캐시 ──────────────────────────────────────────────────────────────────
def cache_path(folder, key):
    digest = hashlib.sha1(key.encode('utf-8')).hexdigest()
    return Path(folder) / digest[:2] / (digest + '.json.gz')


def read_cache(folder, key):
    path = cache_path(folder, key)
    if not path.exists():
        return None
    try:
        with gzip.open(path, 'rt', encoding='utf-8') as file:
            data = json.load(file)
    except (OSError, ValueError):
        return None
    if data.get('cacheVersion') != CACHE_VERSION or data.get('key') != key:
        return None
    record = data.get('record')
    if not isinstance(record, dict) or record.get('state') not in ('read', 'not_found', 'ambiguous'):
        # 실패는 다시 시도한다. 일시적인 막힘이 영구 기록이 되지 않게 한다.
        return None
    return record


def write_cache(folder, key, job, record, raw_log, redactor):
    path = cache_path(folder, key)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {'cacheVersion': CACHE_VERSION, 'key': key, 'storedAt': now(),
               'job': {name: job[name] for name in ('query', 'kindGuess', 'regionCode', 'regionLabel',
                                                    'citations', 'citedArticles')},
               'record': record, 'raw': raw_log}
    temporary = path.with_suffix('.tmp')
    with gzip.open(temporary, 'wt', encoding='utf-8') as file:
        json.dump(redactor.data(payload), file, ensure_ascii=False)
    temporary.replace(path)


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f'.{time.time_ns()}.tmp')
    temporary.write_text(data, encoding='utf-8')
    for attempt in range(20):
        try:
            temporary.replace(path)
            return
        except PermissionError:
            if attempt == 19: raise
            time.sleep(0.05)


# ─── 모으기 ────────────────────────────────────────────────────────────────
def assemble(program_keys, laws, checked_at, skipped=None):
    """계약된 모양의 결과. 법령이 없는 사업도 빈 목록으로 모두 담는다."""
    unidentified = {}
    for item in skipped or []:
        unidentified.setdefault(item['programId'], []).append(
            {'citation': item['citation'], 'reason': item['reason']})
    planned_keys = {key for keys in program_keys.values() for key in keys}
    states = [record['state'] for record in laws.values()]
    summary = {'programs': len(program_keys), 'queries': len(laws),
               'plannedQueries': len(planned_keys),
               'pendingQueries': len(planned_keys - laws.keys()),
               'unresolvedCitations': sum(len(items) for items in unidentified.values()),
               'resolved': sum(1 for record in laws.values() if record.get('id')),
               'read': states.count('read'),
               'unresolved': states.count('not_found') + states.count('ambiguous'),
               'failed': states.count('failed')}
    return {'schema': 1, 'checkedAt': checked_at, 'summary': summary,
            'laws': {key: laws[key] for key in sorted(laws)},
            'programs': {program: {'lawKeys': [key for key in program_keys[program] if key in laws],
                                  **({'unresolvedCitations': unidentified[program]} if program in unidentified else {})}
                         for program in sorted(program_keys)}}


def dump(data):
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n'


def main(argv=None):
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description='복지사업 인용 법령 원문 조사')
    parser.add_argument('--source-dir', default=DEFAULT_SOURCE_DIR)
    parser.add_argument('--regions', default=DEFAULT_REGIONS)
    parser.add_argument('--annex-db', default=DEFAULT_ANNEX_DB)
    parser.add_argument('--log-dir', default=DEFAULT_LOG_DIR)
    parser.add_argument('--output', default=None)
    parser.add_argument('--prepare-only', action='store_true', help='계획만 세우고 조회하지 않는다')
    parser.add_argument('--max-jobs', type=int, default=0, help='검증용 상한. 전체 실행에는 쓰지 않는다')
    parser.add_argument('--workers', type=int, default=4)
    parser.add_argument('--interval', type=float, default=0.4, help='전체 호출 간 최소 간격(초)')
    parser.add_argument('--timeout', type=float, default=30.0)
    parser.add_argument('--attempts', type=int, default=4)
    parser.add_argument('--refresh', action='store_true', help='캐시를 무시하고 다시 읽는다')
    parser.add_argument('--retry-unresolved', action='store_true', help='읽은 본문은 유지하고 법규를 특정하지 못한 조회만 다시 시도한다')
    parser.add_argument('--checked-at', default=date.today().isoformat())
    args = parser.parse_args(argv)

    log_dir = Path(args.log_dir)
    cache_dir = log_dir / 'cache'
    log_dir.mkdir(parents=True, exist_ok=True)
    programs = read_programs(args.source_dir)
    regions = RegionIndex.load(args.regions)
    jobs, program_keys, skipped = plan(programs, regions)
    order = sorted(jobs)
    write_json(log_dir / 'plan.json', json.dumps(
        {'schema': 1, 'plannedAt': now(), 'programs': len(program_keys), 'jobs': len(jobs),
         'skippedCitations': len(skipped),
         'byKind': {kind: sum(1 for job in jobs.values() if job['kindGuess'] == kind)
                    for kind in ('law', 'ordin', 'rule')},
         'jobs_detail': [jobs[key] for key in order], 'skipped': skipped[:5000],
         'programKeys': program_keys}, ensure_ascii=False, indent=1))
    if args.prepare_only:
        print(json.dumps({'event': 'prepared', 'programs': len(program_keys), 'jobs': len(jobs),
                          'programsWithLaws': sum(1 for keys in program_keys.values() if keys),
                          'skippedCitations': len(skipped),
                          'byKind': {kind: sum(1 for job in jobs.values() if job['kindGuess'] == kind)
                                     for kind in ('law', 'ordin', 'rule')},
                          'plan': str(log_dir / 'plan.json')}))
        return 0

    selected = order[:args.max_jobs] if args.max_jobs > 0 else order
    partial = len(selected) < len(order)
    output = Path(args.output) if args.output else (log_dir / PARTIAL_OUTPUT_NAME if partial else DEFAULT_OUTPUT)
    credential = load_credential()
    redactor = Redactor(credential)
    portal = Portal(credential, interval=args.interval, timeout=args.timeout,
                    attempts=args.attempts, redactor=redactor)
    index = AnnexIndex(args.annex_db)
    laws, done, lock, abort = {}, {'cached': 0, 'fetched': 0}, threading.Lock(), threading.Event()
    state = {'startedAt': now(), 'status': 'running', 'plannedJobs': len(order),
             'selectedJobs': len(selected), 'programs': len(program_keys),
             'annexIndex': 'available' if index.available else 'missing',
             'requestsPerSecondMaximum': round(1 / args.interval, 2) if args.interval else None,
             'counts': {}, 'errors': []}

    def write_state():
        state['updatedAt'] = now()
        state['counts'] = {name: sum(1 for record in laws.values() if record['state'] == name)
                           for name in ('read', 'not_found', 'ambiguous', 'failed')}
        state['counts'].update(done)
        write_json(log_dir / 'status.json', json.dumps(redactor.data(state), ensure_ascii=False, indent=1))

    def run(key):
        if abort.is_set():
            return key, {'query': jobs[key]['query'], 'kind': jobs[key]['kindGuess'], 'id': '', 'title': '',
                         'url': '', 'state': 'failed', 'checkedAt': args.checked_at,
                         'applicationArticles': [], 'annexes': [], 'errorCode': 'ABORTED'}
        if not args.refresh:
            cached = read_cache(cache_dir, key)
            if cached and not (args.retry_unresolved and cached['state'] != 'read'):
                with lock:
                    done['cached'] += 1
                return key, cached
        record, raw_log = process(jobs[key], portal, index, args.checked_at)
        write_cache(cache_dir, key, jobs[key], record, raw_log, redactor)
        with lock:
            done['fetched'] += 1
        return key, record

    write_state()
    print(json.dumps({'event': 'start', 'jobs': len(selected), 'planned': len(order),
                      'partial': partial, 'annexIndex': index.available,
                      'output': str(output)}), flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(run, key): key for key in selected}
        for position, future in enumerate(concurrent.futures.as_completed(futures), 1):
            key = futures[future]
            try:
                key, record = future.result()
                laws[key] = record
            except AuthorizationFailed:
                abort.set()
                state['errors'].append({'error': 'PORTAL_AUTHORIZATION_FAILED'})
            except Exception as error:
                state['errors'].append({'key': key, 'error': redactor.text(type(error).__name__)})
                laws[key] = {'query': jobs[key]['query'], 'kind': jobs[key]['kindGuess'], 'id': '',
                             'title': '', 'url': '', 'state': 'failed', 'checkedAt': args.checked_at,
                             'applicationArticles': [], 'annexes': [],
                             'errorCode': redactor.text(type(error).__name__)}
            if position % 25 == 0 or position == len(selected):
                write_state()
                print(json.dumps({'event': 'progress', 'done': position, 'total': len(selected),
                                  'read': sum(1 for record in laws.values() if record['state'] == 'read'),
                                  'cached': done['cached'], 'errors': len(state['errors'])}), flush=True)

    result = assemble(program_keys, laws, args.checked_at, skipped)
    if abort.is_set():
        state['status'] = 'aborted'
        write_state()
        print(json.dumps({'event': 'aborted', 'reason': 'PORTAL_AUTHORIZATION_FAILED',
                          'note': 'No audit file written.'}), flush=True)
        return 2
    write_json(output, dump(result))
    state['status'] = 'partial' if partial else 'complete'
    state['output'] = str(output)
    write_state()
    print(json.dumps({'event': 'finished', 'status': state['status'], 'output': str(output),
                      **result['summary'], 'cached': done['cached'], 'fetched': done['fetched'],
                      'requests': portal.requests}), flush=True)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

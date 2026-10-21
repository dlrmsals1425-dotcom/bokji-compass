"""Pure, conservative association proposals from actual downloaded Hangul files.

No network, source writes, eligibility edits, or publication. The caller supplies
original bytes and may supply decoded law-census cache objects. Every candidate
gets an outcome with explicit gates/reasons; passing rows STILL require a independent
source review. Candidate scores and numeric annexNumber fields are never proof.

The optional CLI only reads the existing repository/download/cache files and
writes explicitly named proposal/progress logs. Importable matching functions
perform no file or network I/O.
"""
from __future__ import annotations

import hashlib
import importlib.util
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]


def _module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_citations = _module("download_match_citations", ROOT / "pipeline/forms/portal_match.py")
_reader = _module("download_match_reader", ROOT / "scripts/download-law-form-files.py")

_NUMBER = re.compile(r"별지\s*(?:제\s*)?(\d+)\s*(?:호(?:\s*의\s*(\d+))?|의\s*(\d+)\s*호)(?:\s*서식)?")
_SINGLE = re.compile(r"별지\s*(?:서식|양식)(?!\s*제?\s*\d)")
_INSTITUTION = re.compile(r"기관용|업체용|학교용|가맹점|수탁|위탁운영|지정\s*신청|등록\s*신청|시설\s*설치|보조금\s*교부|정산|지급\s*대장|관리\s*대장|지원\s*대상자\s*명부|수리\s*내역|수리\s*의뢰서")
_ADMIN_ACTOR = re.compile(r"(?:학교장|학교|교육장|읍[ㆍ·]?면[ㆍ·]?동장|동장|읍장|면장|기관장|기관|의료기관|치과의원|병원|시설장|수탁자|수탁기관|수리업체|업체|사업자|가맹점|법인|단체|운영자)(?:은|는|이|가|의\s*장[은는])")
_CITIZEN_ACTOR = re.compile(r"신청인|신청자|지원대상자|지급대상자|장수노인|장수어르신|장애인|보호자|부모|부\s*또는\s*모|유족|학생|입주자|임차인|세대주|주민|지원\s*받[으고]|지원받[으고]|지급\s*받[으고]|지급받[으고]|받으려는\s*(?:사람|자)|받고자\s*하는\s*(?:사람|자)|신청하려는\s*(?:사람|자)|신청하고자\s*하는\s*(?:사람|자)|지원이\s*필요한\s*(?:사람|가구)|지원대상\s*가정|지급대상\s*가정")
_LITIGATION = re.compile(r"소장|지급명령\s*신청|심판\s*청구|소송\s*청구|소송비용\s*확정|청구취지|청구원인")
_QUALIFIERS = ("장애인", "한부모", "다자녀", "참전", "국가유공", "청년", "대학생", "초등학생", "중학생", "고등학생", "신혼부부")
_GENERIC_CORE = {"", "지원", "지원금", "신청", "청구", "복지", "수당", "장려금", "축하금", "신청서", "청구서", "사업", "보조금", "급여", "출산", "양육", "장애인", "노인", "어르신", "학생"}
_SHORT_PURPOSES = {"이사비", "교복비", "수술비", "간병비", "보청기", "장례비", "장제비"}
_FATAL = {"source_kind_not_ordin", "form_identity_mismatch", "jurisdiction_mismatch", "legacy_name_or_region_mismatch", "education_authority_mismatch", "download_identity_mismatch", "download_url_mismatch", "original_hash_mismatch", "original_body_mismatch", "invalid_original", "official_annex_conflict", "forbidden_form_role", "filled_personal_data", "deleted_form", "outdated_annual_form", "future_effective_form", "institution_application_clause", "wrong_annex_designation", "law_cache_identity_mismatch", "original_jurisdiction_mismatch"}
_MESSAGES = {
    "source_kind_not_ordin": "이 검증기는 현행 자치법규 서식만 처리합니다.",
    "form_identity_mismatch": "서식 ID·별표일련번호가 일치하지 않습니다.",
    "jurisdiction_mismatch": "사업 관할과 자치법규 서식 관할이 일치하지 않습니다.",
    "legacy_name_or_region_mismatch": "현재 지역명·법규 지역명이 충돌하거나 구 행정구역 관계를 확인하지 못했습니다.",
    "original_jurisdiction_mismatch": "실제 원본의 수신 지자체가 사업·법규 관할과 다릅니다.",
    "education_authority_mismatch": "교육청·교육감 법규와 사업 시행기관의 관할 관계가 맞지 않습니다.",
    "non_citizen_program": "자동 지급·기관 선정 사업의 주민 직접 신청 여부는 수동 확인이 필요합니다.",
    "cited_law_not_read": "해당 사업이 실제 인용한 동일 lawId의 자치법규 원문 읽기 기록이 없습니다.",
    "citation_title_mismatch": "사업의 실제 법규 인용과 원문에서 확인한 법규명이 일치하지 않습니다.",
    "law_cache_identity_mismatch": "전체 조문 캐시의 법규 ID·제명이 선택한 법규와 다릅니다.",
    "full_law_cache_unparsed": "캐시는 있으나 전체 LawService 조문 구조를 해석하지 못했습니다.",
    "download_not_stored": "정상 저장된 원본 다운로드 기록이 없습니다.",
    "download_identity_mismatch": "다운로드 기록의 서식·법규·지역·제명이 원천 서식과 다릅니다.",
    "download_url_mismatch": "공식 원본 다운로드 flSeq가 일치하지 않거나 공개 주소가 아닙니다.",
    "original_bytes_missing": "실제 원본 바이트가 없어 해시·전체 본문을 재검증하지 못했습니다.",
    "original_hash_mismatch": "실제 원본의 SHA256·길이가 다운로드 기록과 다릅니다.",
    "invalid_original": "정상 HWP/HWPX 전체 본문을 읽을 수 없습니다.",
    "original_body_mismatch": "전체 본문·섹션과 다운로드 추출 기록이 일치하지 않습니다.",
    "official_annex_not_bound": "법규 원문에서 같은 annexId와 flSeq의 별지를 확인하지 못했습니다.",
    "official_annex_conflict": "같은 별지 ID에 상충하는 원본 주소가 있습니다.",
    "annex_designation_missing": "원본 머리말과 공식 제목의 별지 지정을 확인하지 못했습니다.",
    "wrong_annex_designation": "원본·공식 제목·신청 조항의 별지 지정이 일치하지 않습니다.",
    "multiple_forms_in_original": "여러 독립 서식이 한 파일에 섞여 있어 선택 범위를 수동 확인해야 합니다.",
    "application_clause_missing": "해당 별지를 주민 신청서로 지정하는 완결된 신청 조항이 없습니다.",
    "institution_application_clause": "같은 별지를 제출하는 주체가 학교·기관·업체 등입니다.",
    "truncated_application_clause": "해당 별지의 신청 조항이 잘려 있어 전체 조문 확인이 필요합니다.",
    "application_heading_missing": "원본에서 주민 신청서·급여 청구서 제목을 확인하지 못했습니다.",
    "applicant_fields_missing": "원본에 신청인 인적사항과 서명·날인 작성란이 충분하지 않습니다.",
    "forbidden_form_role": "기관·업체·가맹점·지정·정산·변경 전용·소송 서식입니다.",
    "filled_personal_data": "본문에 작성된 개인 식별정보로 보이는 내용이 있어 자동 제안하지 않습니다.",
    "deleted_form": "삭제·폐지된 서식 표기가 있습니다.",
    "outdated_annual_form": "현재 신청 연도와 다른 연도 전용 서식입니다.",
    "future_effective_form": "검토일 현재 시행 전인 서식입니다.",
    "effective_date_missing": "현행성을 확인할 시행일 정보가 없습니다.",
    "purpose_not_specific": "사업 고유 목적이 원본 신청 제목·지원 선택항목과 충분히 일치하지 않습니다.",
    "purpose_qualifier_mismatch": "사업 대상·급여의 구별되는 표현이 원본 신청 목적에 없습니다.",
    "integrated_local_item_unclear": "통합 신청서에서 해당 지자체의 해당 지원 항목을 특정하지 못했습니다.",
    "no_candidate_forms": "같은 인용 법규에 연결된 내려받은 서식 후보가 없습니다.",
    "candidate_form_missing": "후보 ID의 공식 서식 메타데이터가 없습니다.",
}


def compact(value):
    return re.sub(r"[^가-힣A-Za-z0-9]", "", unicodedata.normalize("NFKC", str(value or ""))).casefold()


def _day(value):
    raw = re.sub(r"[^0-9]", "", str(value or ""))[:8]
    try:
        return date.fromisoformat(f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}") if len(raw) == 8 else None
    except ValueError:
        return None


def download_identity(url):
    """Public Law.go.kr attachment identity; harmless filename encoding may vary."""
    try:
        p = urlsplit(str(url or "")); query = parse_qsl(p.query)
        if p.scheme not in {"https", "http"} or p.hostname not in {"www.law.go.kr", "law.go.kr"} or p.username or p.password or p.port not in {None, 80, 443}:
            return None
        if p.path not in {"/LSW/flDownload.do", "/flDownload.do"}:
            return None
        if any(re.search(r"^oc$|key|token|auth|secret|password|session", key, re.I) for key, _ in query):
            return None
        values = [value for key, value in query if key == "flSeq"]
        return values[0] if len(values) == 1 and values[0].isdigit() else None
    except (ValueError, TypeError):
        return None


def _public_law_url(law_id):
    return "https://www.law.go.kr/LSW/ordinInfoP.do?" + urlencode({"ordinSeq": law_id})


def _scope(program, form):
    region = program.get("region") or {}; code = str(form.get("regionCode") or "")
    if not re.fullmatch(r"\d{5}", code):
        return None, "jurisdiction_mismatch"
    province = code.endswith("000")
    same = code == str(region.get("sido" if province else "sigungu") or "")
    if not same or program.get("scope") not in {"sido", "sigungu"}:
        return None, "jurisdiction_mismatch"
    parts = str(form.get("regionLabel") or "").split()
    law_title = compact(form.get("lawTitle"))
    place = parts[-1] if parts else ""
    if not place or compact(place) not in law_title:
        return None, "legacy_name_or_region_mismatch"
    if not province and place.endswith("구") and (len(parts) < 2 or compact(parts[0]) not in law_title):
        return None, "legacy_name_or_region_mismatch"
    program_place = str(region.get("label") or "").split()
    if not province and program_place and compact(program_place[-1]) != compact(place):
        return None, "legacy_name_or_region_mismatch"
    educational = bool(re.search(r"교육감|교육청|교육지원청", str(form.get("lawTitle"))))
    if educational != (program.get("orgType") == "edu_office"):
        return None, "education_authority_mismatch"
    return ("provincial-law-reference" if province and program.get("scope") == "sigungu" else "same-jurisdiction"), None


def _cited_law(program, form, audit):
    selected = []
    for key in audit.get("programs", {}).get(program["id"], {}).get("lawKeys", []):
        law = audit.get("laws", {}).get(key, {})
        if law.get("state") == "read" and law.get("kind") == "ordin" and str(law.get("id")) == str(form.get("lawId")):
            selected.append((key, law))
    if not selected:
        return None, None, "cited_law_not_read"
    parts = str(form.get("regionLabel") or "").split()
    geography = {"sido": parts[0], "sigungu": parts[-1]} if len(parts) == 2 else None
    cited = set()
    raw = program.get("laws") or []
    for item in [raw] if isinstance(raw, str) else raw:
        for citation in _citations.split_law_citations(item):
            cited.update(_citations.law_aliases(citation, geography))
    for key, law in selected:
        title = _citations.normalize_law(law.get("title"))
        if title in cited and title == _citations.normalize_law(form.get("lawTitle")):
            return key, law, None
    return None, None, "citation_title_mismatch"


def _walk(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from _walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk(item)


def _article_text(node):
    text = []
    for child in _walk(node):
        for key in ("조내용", "조문내용", "항내용", "호내용", "목내용"):
            value = child.get(key)
            if isinstance(value, str):
                text.append(value)
    return " ".join(dict.fromkeys(text))


def law_material(law, cache=None):
    """Decode a supplied complete cache object; never open a cache file here."""
    if cache is None:
        return {"articles": [item.get("text", "") for item in law.get("applicationArticles", [])], "annexes": law.get("annexes", []), "source": "audit-excerpts"}, None
    if str(cache.get("record", {}).get("id")) != str(law.get("id")) or cache.get("record", {}).get("state") != "read":
        return None, "law_cache_identity_mismatch"
    for raw in cache.get("raw", []):
        service = raw.get("payload", {}).get("LawService") if isinstance(raw.get("payload"), dict) else None
        if not isinstance(service, dict):
            continue
        basic = service.get("자치법규기본정보", {})
        if str(basic.get("자치법규일련번호")) != str(law.get("id")) or _citations.normalize_law(basic.get("자치법규명")) != _citations.normalize_law(law.get("title")):
            return None, "law_cache_identity_mismatch"
        articles = [_article_text(node) for node in _walk(service.get("조문", {})) if "조내용" in node or "조문내용" in node]
        annexes = [{"id": str(node.get("별표키") or node.get("별표일련번호") or ""), "title": node.get("별표제목", ""), "url": node.get("별표첨부파일명", "")} for node in _walk(service.get("별표", {})) if "별표제목" in node]
        return {"articles": list(dict.fromkeys(articles)), "annexes": annexes, "source": "full-LawService"}, None
    return None, "full_law_cache_unparsed"


def validate_original(form, record, original_bytes):
    """Re-inspect supplied bytes using the downloader's ALL-section reader."""
    if not isinstance(record, dict) or record.get("state") != "stored":
        return None, "download_not_stored"
    for expected, actual in [(form.get("id"), record.get("formId")), (str(form.get("lawId")), str(record.get("lawId"))), (str(form.get("regionCode")), str(record.get("regionCode")))]:
        if expected != actual:
            return None, "download_identity_mismatch"
    if compact(record.get("title")) != compact(form.get("title")) or _citations.normalize_law(record.get("lawTitle")) != _citations.normalize_law(form.get("lawTitle")):
        return None, "download_identity_mismatch"
    file_id = download_identity(form.get("sourceUrl"))
    if not file_id or file_id != download_identity(record.get("sourceUrl")):
        return None, "download_url_mismatch"
    if not isinstance(original_bytes, bytes):
        return None, "original_bytes_missing"
    if record.get("bytes") != len(original_bytes) or record.get("sha256") != hashlib.sha256(original_bytes).hexdigest():
        return None, "original_hash_mismatch"
    if record.get("format") not in {"hwp", "hwpx"}:
        return None, "invalid_original"
    try:
        inspected = _reader.inspect_document(original_bytes)
    except Exception:
        return None, "invalid_original"
    if inspected.get("format") not in {"hwp", "hwpx"}:
        return None, "invalid_original"
    if record.get("textScope") != "all_body_sections_or_pages" or any(record.get(k) != inspected.get(k) for k in ("format", "sectionsRead", "text", "textLength")):
        return None, "original_body_mismatch"
    return inspected, None


def _labels(text):
    found = {f"{int(m[1])}" + (f"-{int(m[2] or m[3])}" if m[2] or m[3] else "") for m in _NUMBER.finditer(text)}
    if _SINGLE.search(text):
        found.add("single")
    return found


def _header_labels(text):
    result = set()
    for index, line in enumerate(text.splitlines()):
        if index < 3 or re.match(r"\s*[■□\[<【(〈]\s*별지", line):
            result.update(_labels(line))
    return result


def _strip_label(text):
    text = re.sub(r"[<〈](?:개정|신설|전문개정)[^>〉]*[>〉]", "", text)
    text = _NUMBER.sub("", text); text = _SINGLE.sub("", text)
    return re.sub(r"^[\s■□\[\]()<>{}【】〈〉]+|[\s\[\]()<>{}【】〈〉]+$", "", text).strip()


def _heading(text):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for index, line in enumerate(lines[:35]):
        clean = _strip_label(line)
        if re.search(r"(?:신청|청구)(?:\([^)]*\))?서", compact(clean)) and len(clean) < 110 and not re.search(r"제출|작성|참고|구비|첨부|신청서를|신청서의", clean):
            if compact(clean) in {"신청서", "청구서"}:
                clean = " ".join(lines[max(0, index - 3):index + 1])
            return _strip_label(clean)
    return None


def _core(text, form):
    value = _strip_label(str(text or ""))
    for place in str(form.get("regionLabel") or "").split():
        value = value.replace(place, "")
    value = re.sub(r"\b(?:및|등|대상|관련)\b", "", value)
    value = compact(value)
    for suffix in ["지급신청서", "지원신청서", "신청서", "청구서", "지원사업", "지원", "지급", "사업"]:
        if value.endswith(suffix):
            value = value[:-len(suffix)]
    return value


def _purpose(program, form, heading, body):
    # Remove quoted law titles: citation to a broad law is not a purpose match.
    zone = re.sub(r"「[^」]*」|『[^』]*』", "", body)
    zone = re.split(r"신청합니다|청구합니다|신청하오니", zone, maxsplit=1)[0][:2200]
    name = str(program.get("name") or "")
    names = [name] + [alias for alias in program.get("aliases", []) if isinstance(alias, str)]
    if "통합" in heading:
        city = str(form.get("regionLabel") or "").split()[-1]
        flat = compact(zone)
        start = re.search(re.escape(compact(city)) + r"(?:자체)?서비스|지방자치단체서비스(?:부산|서울|인천|대전|광주|울산|대구|경기)?" + re.escape(compact(city)), flat)
        if not start:
            return None, "integrated_local_item_unclear"
        zone = flat[start.end():].split("전국공통", 1)[0][:1200]
    target = compact(heading + " " + zone)
    for alternatives in [("첫아이", "첫째", "첫아기"), ("둘째", "두번째"), ("셋째", "세번째"), ("넷째", "네번째"), ("다섯째", "다섯번째")]:
        if any(word in compact(name) for word in alternatives) and not any(word in compact(zone) for word in alternatives):
            return None, "purpose_qualifier_mismatch"
    for qualifier in _QUALIFIERS:
        if qualifier in compact(name) and qualifier not in target:
            return None, "purpose_qualifier_mismatch"
    for money in ("장려금", "축하금", "수당", "위로금", "장학금"):
        if money in compact(name) and money not in target:
            return None, "purpose_qualifier_mismatch"
    cores = [_core(value, form) for value in names]
    for core in cores:
        if (len(core) >= 4 or core in _SHORT_PURPOSES) and core not in _GENERIC_CORE and core in target:
            return {"basis": "named_application_or_item", "terms": [core], "heading": heading}, None
    form_core = _core(heading, form)
    context = compact(name + " " + str(program.get("benefit") or ""))
    if (len(form_core) >= 4 or form_core in _SHORT_PURPOSES) and form_core not in _GENERIC_CORE and form_core in context:
        return {"basis": "specific_form_purpose_in_program", "terms": [form_core], "heading": heading}, None
    # Exact meaningful name words may be separated by a more specific descriptor
    # (e.g. 장애인가정 출산 및 [영아] 양육). No similar-word score is used.
    words = [word for word in _citations.program_tokens(program) if word not in _GENERIC_CORE or word in {"출산", "양육", "장애인"}]
    if len(words) >= 2 and sum(map(len, words)) >= 6 and any(len(word) >= 4 for word in words) and all(compact(word) in compact(heading) for word in words):
        return {"basis": "all_specific_name_words_in_heading", "terms": words, "heading": heading}, None
    if "수리" in compact(name) and "수리" in compact(heading):
        devices = [word for word in ("휠체어", "보장구", "이동기기", "전동스쿠터") if word in compact(name) and word in target]
        if devices and "장애인" in target and "장애인" in compact(name):
            if "대여" in compact(name) and "대여" not in target:
                return None, "purpose_not_specific"
            return {"basis": "explicit_repair_device_fields", "terms": ["장애인", "수리"] + devices, "heading": heading}, None
    return None, "purpose_not_specific"


def _body_risk(form, body, heading, checked, program):
    title = str(form.get("title") or ""); head = "\n".join(body.splitlines()[:10])
    if form.get("role") == "deleted" or re.search(r"[<〈\[(【]\s*(?:삭제|폐지)|^\s*(?:삭제|폐지)\s*$", title + "\n" + head, re.M):
        return "deleted_form"
    if _INSTITUTION.search(title + " " + heading) or _LITIGATION.search(title + " " + heading):
        return "forbidden_form_role"
    if re.search(r"변경|중지|해지|철회", title + " " + heading):
        return "forbidden_form_role"  # Mixed initial/change forms need separate review too.
    if "청구취지" in body and ("원고" in body or "피고" in body):
        return "forbidden_form_role"
    if re.search(r"신[ \t]*청[ \t]*인[ \t]*[(（][ \t]*(?:의료기관|수탁기관|가맹점|기관장|업체|법인|단체)(?:장|대표)?[ \t]*[)）]", body):
        return "forbidden_form_role"
    annual = re.sub(r"[<〈][^>〉]*(?:개정|신설)[^>〉]*[>〉]", "", head)
    years = re.findall(r"(?<!\d)(20\d{2})\s*년(?:도)?", annual)
    years += re.findall(r"(?m)^\s*(20\d{2})[ \t]+(?=[가-힣][^\n]*(?:신청서|청구서))", annual)
    if any(int(year) != checked.year for year in years):
        return "outdated_annual_form"
    if re.search(r"\b\d{6}\s*-\s*[1-8]\d{6}\b|\b\d{13}\b", body):
        return "filled_personal_data"
    if re.search(r"계좌번호\s*[:：]\s*\d[\d-]{7,}|(?:휴대전화|휴대폰|전화번호)\s*[:：]\s*010[-\s]?\d{3,4}[-\s]?\d{4}", body):
        return "filled_personal_data"
    fields = {"성명", "서명", "날인", "주소", "생년월일", "신청인", "대리인", "보호자", "본인", "예금주", "담당자", "해당", "관계", "남여", "학생", "출생아", "제출서류", "신청서", "연락처", "전화번호", "휴대전화", "가족사항", "지원대상", "성별", "직업", "직급", "대표자", "계좌번호", "학생과의", "본인과의", "신청인과", "대상자와", "출산자", "배우자", "의료기관"}
    name_patterns = [
        r"(?:성[ \t]*명|신[ \t]*청[ \t]*인)[ \t]*[:：][ \t]*([가-힣]{2,4})(?=[ \t]*(?:$|[(（,]))",
        r"(?:성[ \t]*명|신[ \t]*청[ \t]*인)[ \t]+([가-힣]{2,4})[ \t]*[(（](?:서명|날인|인)",
        r"^[ \t]*(?:성명|신청인)[ \t]*\n([가-힣]{2,4})[ \t]*\n(?:생년월일|주민등록번호|휴대전화|주소|연락처)",
    ]
    for pattern in name_patterns:
        for match in re.finditer(pattern, body, re.M):
            if match[1] not in fields:
                return "filled_personal_data"
    place = compact(str(form.get("regionLabel") or "").split()[-1])
    places = {place}
    if str(form.get("regionCode", "")).endswith("000") and program.get("scope") == "sigungu":
        labels = str(program.get("region", {}).get("label") or "").split()
        if labels: places.add(compact(labels[-1]))
    for recipient in re.findall(r"([가-힣]+(?:시장|군수|구청장|도지사|교육감))\s*귀하", body):
        if recipient not in {"시장", "군수", "구청장", "도지사", "교육감", "시군구청장", "시장군수구청장"} and not any(p in compact(recipient) for p in places):
            return "original_jurisdiction_mismatch"
    return None


def _matching_clause(material, label):
    truncated = institutional = False
    for article in material["articles"]:
        # Number fields may be '제600조'; use the actual article text instead.
        number = re.search(r"제\s*\d+\s*조(?:\s*의\s*\d+)?", article)
        for clause in re.split(r"[①②③④⑤⑥⑦⑧⑨⑩]", article):
            if label not in _labels(clause):
                continue
            if "…" in clause or "..." in clause:
                truncated = True; continue
            if not re.search(r"제출|신청|청구", clause) or not re.search(r"신청서|청구서|별지\s*(?:제?\s*\d+\s*호)?\s*서식", clause):
                continue
            lead = re.split(r"별지", clause, maxsplit=1)[0]
            if _ADMIN_ACTOR.search(lead):
                institutional = True; continue
            if not _CITIZEN_ACTOR.search(lead):
                continue
            return {"number": re.sub(r"\s+", "", number[0]) if number else "", "text": clause.strip(), "designation": label}, None
    return None, "institution_application_clause" if institutional else "truncated_application_clause" if truncated else "application_clause_missing"


def evaluate_association(program, form, law_audit, download, *, original_bytes=None, law_cache=None, checked_at="2026-10-17", _verified=None, _material=None):
    """Return one deterministic proposal/rejection; inputs are never mutated."""
    result = {"programId": program.get("id"), "formId": form.get("id"), "decision": "needs_review", "possible": False,
              "gates": {}, "reasonCodes": [], "reasons": [], "proposal": None}

    def fail(gate, code):
        result["gates"][gate] = False; result["reasonCodes"].append(code)
        result["reasons"].append(_MESSAGES[code]); result["decision"] = "reject" if code in _FATAL else "needs_review"
        return result

    if form.get("sourceKind") != "ordin":
        return fail("municipal_source", "source_kind_not_ordin")
    if not re.fullmatch(r"ordin-\d+", str(form.get("id", ""))) or form["id"] != "ordin-" + str(form.get("annexId")):
        return fail("form_identity", "form_identity_mismatch")
    result["gates"]["form_identity"] = True
    scope, error = _scope(program, form)
    if error: return fail("jurisdiction", error)
    result["gates"]["jurisdiction"] = True
    if program.get("applyType") in {"auto", "institution"}:
        return fail("citizen_program", "non_citizen_program")
    law_key, law, error = _cited_law(program, form, law_audit)
    if error: return fail("cited_read_law", error)
    result["gates"]["cited_read_law"] = True
    material, error = _material if _material is not None else law_material(law, law_cache)
    if error: return fail("law_material", error)
    inspected, error = _verified if _verified is not None else validate_original(form, download, original_bytes)
    if error: return fail("actual_original", error)
    result["gates"]["actual_original"] = True
    checked, effective = _day(checked_at), _day(form.get("effectiveDate"))
    if not checked or not effective: return fail("current_source", "effective_date_missing")
    if effective > checked: return fail("current_source", "future_effective_form")
    body = inspected["text"]; heading = _heading(body)
    if not heading: return fail("application_heading", "application_heading_missing")
    error = _body_risk(form, body, heading, checked, program)
    if error: return fail("blank_citizen_form", error)
    if not (re.search(r"신\s*청\s*인|청\s*구\s*인", body) and re.search(r"서\s*명|날\s*인", body) and re.search(r"성\s*명|생년월일|주민등록", body)):
        return fail("applicant_fields", "applicant_fields_missing")
    result["gates"]["blank_citizen_form"] = True
    heads = _header_labels(body)
    independent_titles = set()
    for line in body.splitlines():
        cleaned = _strip_label(line)
        if len(cleaned) < 100 and not re.match(r"\s*(?:\d+[.)]|※)", cleaned) and re.search(r"(?:신청서|청구서)\s*$", cleaned):
            core = _core(cleaned, form)
            if len(core) >= 4: independent_titles.add(core)
    if len(heads) > 1 or len(independent_titles) > 1 or re.search(r"서식\s*모음|서식\s*일체|신청서\s*(?:및|와|과)\s*추천서", str(form.get("title"))):
        return fail("single_application", "multiple_forms_in_original")
    source_id = download_identity(form.get("sourceUrl")); annex_id = str(form["annexId"])
    bound = [annex for annex in material["annexes"] if str(annex.get("id", "")).removeprefix("ordin-") == annex_id]
    if any(download_identity(annex.get("url")) != source_id for annex in bound):
        return fail("official_annex_binding", "official_annex_conflict")
    if not bound: return fail("official_annex_binding", "official_annex_not_bound")
    label_set = set().union(*(_labels(str(annex.get("title", ""))) for annex in bound)) | _labels(str(form.get("title", "")))
    if not label_set and compact(form.get("title")) in {"별지", "별지서식"}:
        label_set = {"single"}
    if not heads or not label_set: return fail("annex_designation", "annex_designation_missing")
    if len(heads) != 1 or heads != label_set: return fail("annex_designation", "wrong_annex_designation")
    label = next(iter(heads))
    if label == "single" and len({str(a.get("id", "")).removeprefix("ordin-") for a in material["annexes"]}) != 1:
        return fail("annex_designation", "wrong_annex_designation")
    result["gates"]["official_annex_binding"] = True
    clause, error = _matching_clause(material, label)
    if error: return fail("citizen_application_article", error)
    result["gates"]["citizen_application_article"] = True
    purpose, error = _purpose(program, form, heading, body)
    if error: return fail("specific_program_purpose", error)
    result["gates"]["specific_program_purpose"] = True
    row = {key: form.get(key) for key in ["sourceKind", "lawTitle", "lawId", "annexId", "annexNumber", "sourceUrl", "officialPdfUrl", "dateKind", "effectiveDate", "regionCode", "regionLabel"]}
    row.update(programIds=[program["id"]], programNames=[program.get("name", "")], formId=form["id"], formTitle=form["title"], use="main",
               checkedAt=checked.isoformat(), evidenceUrl=_public_law_url(form["lawId"]),
               evidenceNote=f"{clause['number']}의 주민 신청 조항에서 원본 머리말의 별지 {label}을 지정한다. 같은 annexId·flSeq와 실제 {inspected['format'].upper()} 파일의 SHA256·전체 본문을 재검증했고 신청 제목/지원 항목에서 {', '.join(purpose['terms'])} 목적을 대조했다. 이 행은 교차검토용 제안이며 게시 승인 자료가 아니다.",
               verificationStatus="proposed", proposalStatus="requires_cross_review", officialAttachmentMatched=True,
               sha256=download["sha256"], bytes=download["bytes"], originalFormat=inspected["format"],
               originalTextScope=inspected["textScope"], sectionsRead=list(inspected["sectionsRead"]))
    if scope == "provincial-law-reference": row["scopeBasis"] = scope
    result.update(decision="propose", possible=True, proposal=row, evidence={"lawKey": law_key, "lawMaterial": material["source"], "article": clause, "purpose": purpose, "annexDesignation": label, "downloadFlSeq": source_id})
    return result


def _mapping(value, wrapper):
    if isinstance(value, dict) and wrapper in value: value = value[wrapper]
    if isinstance(value, list): return {item.get("id", item.get("formId")): item for item in value}
    return value or {}


def build_proposals(programs, portal_forms, portal_matches, law_audit, downloads, *, original_bytes=None, law_caches=None, checked_at="2026-10-17", progress_callback=None):
    """Evaluate ALL supplied program records; no hidden sample cap or score gate.

    originals map: formId -> bytes. law_caches map: audit lawKey -> decoded cache.
    Audit-bound forms are included even when the old title search missed them.
    """
    programs = _mapping(programs, "programs"); forms = _mapping(portal_forms, "forms")
    matches = _mapping(portal_matches, "programs"); downloads = _mapping(downloads, "forms")
    originals = original_bytes or {}; caches = law_caches or {}; by_law = defaultdict(set)
    for fid, form in forms.items():
        if form.get("sourceKind") == "ordin": by_law[str(form.get("lawId"))].add(fid)
    outcomes, rows, verified, materials = {}, [], {}, {}
    out_of_scope = associations = 0
    for index, (pid, program) in enumerate(programs.items(), 1):
        prior = {c["formId"] for c in matches.get(pid, {}).get("candidates", []) if isinstance(c, dict) and c.get("formId")}
        candidates = {fid for fid in prior if str(fid).startswith("ordin-") or forms.get(fid, {}).get("sourceKind") == "ordin"}
        out_of_scope += len(prior - candidates)
        keys = law_audit.get("programs", {}).get(pid, {}).get("lawKeys", [])
        for key in keys:
            law = law_audit.get("laws", {}).get(key, {})
            if law.get("kind") == "ordin" and law.get("state") == "read": candidates.update(by_law[str(law.get("id"))])
        results = []
        for fid in sorted(candidates):
            if fid not in forms:
                results.append({"programId": pid, "formId": fid, "decision": "needs_review", "possible": False, "reasonCodes": ["candidate_form_missing"], "reasons": [_MESSAGES["candidate_form_missing"]], "proposal": None}); continue
            form = forms[fid]; record = downloads.get(fid)
            if fid not in verified: verified[fid] = validate_original(form, record, originals.get(fid))
            law_key, selected_law, _ = _cited_law(program, form, law_audit)
            if law_key and law_key not in materials: materials[law_key] = law_material(selected_law, caches.get(law_key))
            outcome = evaluate_association(program, form, law_audit, record, law_cache=caches.get(law_key), checked_at=checked_at, _verified=verified[fid], _material=materials.get(law_key))
            results.append(outcome)
            if outcome["proposal"]: rows.append(outcome["proposal"])
        outcomes[pid] = {"candidateCount": len(candidates), "results": results, "reasonCodes": [] if candidates else ["no_candidate_forms"]}
        associations += len(results)
        if progress_callback is not None and (index % 250 == 0 or index == len(programs)):
            progress_callback({"programsProcessed": index, "totalPrograms": len(programs), "associationsEvaluated": associations, "proposals": len(rows), "originalRecordsChecked": len(verified), "lawMaterialsPrepared": len(materials)})
    counts = Counter(result["decision"] for item in outcomes.values() for result in item["results"])
    return {"schema": 1, "checkedAt": checked_at, "scope": "Downloaded municipal Hangul originals; proposals only, independent source review required.",
            "rows": rows, "programs": outcomes, "summary": {"programs": len(programs), "associationsEvaluated": sum(counts.values()), "outOfScopeCandidatesSkipped": out_of_scope, "originalsVerifiedOnce": sum(not error for _, error in verified.values()), "lawMaterialsPreparedOnce": len(materials), **counts},
            "unresolvedNotes": [{"programId": pid, "reasonCodes": item["reasonCodes"]} for pid, item in outcomes.items() if not item["results"]]}


def main(argv=None):
    """Reproducible local snapshot runner; no downloads or review-file writes."""
    import argparse
    import gzip
    import json
    from datetime import datetime, timezone

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=ROOT)
    parser.add_argument("--output", type=Path, required=True, help="Proposal JSON path under the repository logs directory")
    parser.add_argument("--progress", type=Path, help="Progress JSON path under the repository logs directory")
    parser.add_argument("--checked-at", default=date.today().isoformat())
    parser.add_argument("--cases", type=Path, help="Optional JSON list of {programId, formId}; only evaluate these actual cases")
    parser.add_argument("--additional-forms", type=Path, action="append", default=[], help="Explicit official annex metadata missed by the title index; may be repeated")
    args = parser.parse_args(argv)
    root = args.repo_root.resolve(); log_root = (root / "logs").resolve()
    outputs = []
    for value in (args.output, args.progress):
        if value is None:
            outputs.append(None); continue
        path = (root / value).resolve() if not value.is_absolute() else value.resolve()
        if not path.is_relative_to(log_root) or path.suffix != ".json":
            parser.error("Output and progress files must be JSON files inside this repository's logs directory")
        outputs.append(path)
    output, progress_file = outputs
    started = datetime.now(timezone.utc).isoformat()
    code_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()

    def load(path):
        return json.loads(path.read_text(encoding="utf-8"))

    def write(path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_suffix(path.suffix + ".tmp")
        temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(path)

    def progress(phase, **values):
        update = {"phase": phase, "startedAt": started, "updatedAt": datetime.now(timezone.utc).isoformat(), "matcherSha256": code_hash, **values}
        if progress_file: write(progress_file, update)
        print(json.dumps(update, ensure_ascii=False), flush=True)

    programs = {}
    for path in sorted((root / "public/bundles/v1/details").glob("*.json")):
        programs.update(load(path))
    forms = load(root / "pipeline/forms/portal-forms.json")
    for extra in args.additional_forms:
        supplied = load(extra)["forms"]
        for form in supplied.values() if isinstance(supplied, dict) else supplied:
            prior = forms["forms"].get(form["id"])
            if prior and (prior.get("lawId") != form.get("lawId") or download_identity(prior.get("sourceUrl")) != download_identity(form.get("sourceUrl"))):
                parser.error("Additional annex conflicts with the official indexed identity: " + form["id"])
            forms["forms"][form["id"]] = form
    matches = load(root / "pipeline/forms/portal-matches.json")
    audit = load(root / "pipeline/forms/law-body-audit.json")
    cases = load(args.cases) if args.cases else None
    if cases is not None:
        missing = [case for case in cases if case["programId"] not in programs or case["formId"] not in forms["forms"]]
        if missing: parser.error("A requested case is absent from the actual program or form corpus")
        programs = {case["programId"]: programs[case["programId"]] for case in cases}
    wanted_forms = {case["formId"] for case in cases} if cases is not None else {fid for fid, form in forms["forms"].items() if form.get("sourceKind") == "ordin"}
    records, originals, read_errors = {}, {}, Counter()
    files = sorted((root / "logs/law-downloads").glob("ordin-*.json"))
    progress("loading_originals", totalPrograms=len(programs), recordFiles=len(files))
    for index, path in enumerate(files, 1):
        if path.name.endswith(".error.json") or path.stem not in wanted_forms: continue
        try:
            record = load(path)
            if record.get("state") != "stored": continue
            fid = record["formId"]; records[fid] = record
            originals[fid] = Path(record["localPath"]).read_bytes()
        except (OSError, ValueError, KeyError):
            read_errors["record_or_original_unreadable"] += 1
        if index % 250 == 0: progress("loading_originals", filesProcessed=index, recordFiles=len(files), records=len(records), bytesAvailable=len(originals))
    ids = {str(forms["forms"][fid].get("lawId")) for fid in wanted_forms}
    keys = [key for key, law in audit["laws"].items() if law.get("kind") == "ordin" and law.get("state") == "read" and str(law.get("id")) in ids]
    caches = {}
    progress("loading_law_caches", records=len(records), bytesAvailable=len(originals), lawKeys=len(keys))
    for index, key in enumerate(keys, 1):
        digest = hashlib.sha1(key.encode("utf-8")).hexdigest()
        path = root / "logs/law-census/cache" / digest[:2] / (digest + ".json.gz")
        if path.exists():
            try: caches[key] = json.loads(gzip.decompress(path.read_bytes()))
            except (OSError, ValueError): read_errors["law_cache_unreadable"] += 1
        if index % 250 == 0: progress("loading_law_caches", lawKeysProcessed=index, lawKeys=len(keys), fullLawCaches=len(caches))
    progress("evaluating", totalPrograms=len(programs), records=len(records), fullLawCaches=len(caches))
    if cases is None:
        result = build_proposals(programs, forms, matches, audit, records, original_bytes=originals, law_caches=caches, checked_at=args.checked_at,
                                 progress_callback=lambda values: progress("evaluating", **values))
    else:
        outcomes = []
        for case in cases:
            program, form = programs[case["programId"]], forms["forms"][case["formId"]]
            key, _, _ = _cited_law(program, form, audit)
            outcomes.append(evaluate_association(program, form, audit, records.get(form["id"]), original_bytes=originals.get(form["id"]), law_cache=caches.get(key), checked_at=args.checked_at))
        result = {"schema": 1, "checkedAt": args.checked_at, "cases": outcomes, "rows": [item["proposal"] for item in outcomes if item["proposal"]], "summary": dict(Counter(item["decision"] for item in outcomes))}
    outcomes = result.get("cases") or [item for program in result.get("programs", {}).values() for item in program["results"]]
    result.update(snapshotAt=datetime.now(timezone.utc).isoformat(), matcherSha256=code_hash,
                  downloadSnapshot={"records": len(records), "bytesAvailable": len(originals), "fullLawCaches": len(caches), "readErrors": dict(read_errors)},
                  reasonCounts=dict(Counter(reason for item in outcomes for reason in item["reasonCodes"])))
    write(output, result)
    progress("complete", output=str(output.relative_to(root)), summary=result["summary"], reasonCounts=result["reasonCounts"], downloadSnapshot=result["downloadSnapshot"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

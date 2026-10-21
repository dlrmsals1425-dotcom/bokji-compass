"""Read public program pages and their explicitly attached file links.

No login, API credentials, POST requests, or form-approval decisions are made.
``read`` means the source was read, including when it has no attachments; it
does not mean any attachment is a citizen application or has been reviewed.
Dependencies: requests, beautifulsoup4.
"""

from __future__ import annotations

import ipaddress
import json
import re
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup

_HOST_POLICY = Path(__file__).resolve().parents[1]/'pipeline/forms/official-source-hosts.json'
_PUBLIC_INSTITUTION_HOSTS = frozenset(json.loads(_HOST_POLICY.read_text(encoding='utf-8'))['approvedHosts']) if _HOST_POLICY.exists() else frozenset()


_MAX_HTML = 6 * 1024 * 1024
_DOCUMENT = re.compile(r"\.(?:hwpx?|pdf|docx?|xlsx?|pptx?|zip|odt|rtf)(?:$|[?#\s])", re.I)
_DOWNLOAD = re.compile(r"download|filedown|atchfile|resrcefile", re.I)
_SECRET_QUERY = re.compile(
    r"^(?:.*(?:token|password|passwd|secret|authorization)|api[-_]?key|"
    r"service[-_]?key|access[-_]?key|oc|session(?:id)?|jsessionid|"
    r"signature|sig|credential|x-amz-.*)$", re.I
)
_AUTH_PATH = re.compile(r"/(?:login|signin|logout|mygov|mypage|private)(?:[/.?]|$)", re.I)
_INIT = re.compile(r"\binitParameter\s*\(\s*")
_CHALLENGE = re.compile(r"access denied|request blocked|접근이 차단|접속이 차단|비정상적인 접근|자동입력 방지문자|로봇이 아닙니다", re.I)


def _has_visible_challenge(soup):
    # Gov24 and municipal sites ship hidden rejection-dialog templates on normal
    # successful pages. Their text is not evidence of an active access block.
    for text in soup.find_all(string=_CHALLENGE):
        hidden = False
        for parent in text.parents:
            if (parent.name in {"script", "style", "template"} or parent.has_attr("hidden")
                    or parent.get("aria-hidden") == "true"
                    or re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", parent.get("style", ""), re.I)):
                hidden = True
                break
        if not hidden:
            return True
    return False


def public_url(value: str, base: str = "") -> str | None:
    """Government and individually reviewed public-institution HTTP(S) URLs."""
    if not isinstance(value, str) or not value.strip():
        return None
    if re.search(r"[\x00-\x1f\\]", value.strip()):
        return None
    try:
        parts = urlsplit(urljoin(base, value.strip().replace(" ", "%20")))
        host = (parts.hostname or "").lower()
        if parts.scheme not in {"http", "https"} or parts.username or parts.password:
            return None
        if not (host == "gov.kr" or host.endswith(".gov.kr") or host.endswith(".go.kr") or host in _PUBLIC_INSTITUTION_HOSTS):
            return None
        try:
            ipaddress.ip_address(host)
            return None
        except ValueError:
            pass
        if parts.port not in {None, 80, 443} or _AUTH_PATH.search(parts.path):
            return None
        if ";jsessionid" in parts.path.lower():
            return None
        query = parse_qsl(parts.query, keep_blank_values=True)
        if any(_SECRET_QUERY.match(key) or (key.lower() == "key" and not item.isdecimal())
               for key, item in query):
            return None
        # A redirect/download parameter must not hide a private or credential URL.
        for _, item in query:
            if re.match(r"(?:https?:)?//", item, re.I) and not public_url(item, base):
                return None
        return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))
    except (ValueError, RecursionError):
        return None


def _clean_text(value, limit=1400):
    text = BeautifulSoup(str(value or ""), "html.parser").get_text(" ", strip=True)
    text = re.sub(r"https?://[^\s<>]+", lambda m: public_url(m[0]) or "[URL omitted]", text)
    return re.sub(r"\s+", " ", text).strip()[:limit]


def _result(status, url, *, error=None, **values):
    result = {"status": status, "url": public_url(url) or "", "attachments": [], "programSpecific": False}
    if error:
        result["errorCode"] = error
    result.update(values)
    return result


def _get_html(url, timeout):
    """Follow only public official redirects; never log request/response secrets."""
    current = url
    for _ in range(6):
        try:
            with requests.get(current, timeout=timeout, allow_redirects=False, stream=True) as response:
                if response.status_code in {301, 302, 303, 307, 308}:
                    target = public_url(response.headers.get("Location", ""), current)
                    if not target:
                        return None, current, "blocked", "unsafe_or_login_redirect", None
                    current = target
                    continue
                retry = response.headers.get("Retry-After", "")
                retry = min(int(retry), 86400) if str(retry).isdecimal() and len(str(retry)) < 10 else None
                if response.status_code in {401, 403, 407, 429, 451}:
                    return None, current, "blocked", f"http_{response.status_code}", retry if response.status_code == 429 else None
                if response.status_code != 200:
                    return None, current, "unavailable", f"http_{response.status_code}", retry if response.status_code == 503 else None
                content_type = response.headers.get("Content-Type", "").lower()
                if content_type and not any(x in content_type for x in ["html", "text/plain"]):
                    return None, current, "unsupported", "non_html_source", None
                chunks, size = [], 0
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > _MAX_HTML:
                        return None, current, "unavailable", "source_too_large", None
                    chunks.append(chunk)
                # Let BeautifulSoup recognize the page's declared UTF-8/EUC-KR.
                return b"".join(chunks), current, None, None, None
        except requests.Timeout:
            return None, current, "unavailable", "timeout", None
        except requests.RequestException:
            return None, current, "unavailable", "network_error", None
    return None, current, "blocked", "redirect_limit", None


def _expected_id(program, source):
    suffix = re.search(rf"\.{source}-([A-Za-z0-9]+)$", str(program.get("id", "")))
    if suffix:
        return suffix[1]
    for item in program.get("sources", []) or []:
        if item.get("source") == source and item.get("id"):
            return str(item["id"])
    return None


def program_source_url(program):
    """Select the catalog's public source URL without guessing another page."""
    value = program.get("url") or next(
        (x.get("url") for x in program.get("sources", []) or [] if x.get("url")), ""
    )
    return public_url(value)


def source_identity(url):
    """Stable ID for supported program pages and Bokjiro attachment GET URLs."""
    safe = public_url(url)
    if not safe:
        return None
    parts = urlsplit(safe)
    query = dict(parse_qsl(parts.query))
    if parts.hostname in {"www.bokjiro.go.kr", "bokjiro.go.kr", "m.bokjiro.go.kr"}:
        identifier = query.get("wlfareInfoId", "")
        if re.fullmatch(r"WLF\d{8}", identifier):
            return {"provider": "bokjiro", "programId": identifier,
                    "kind": "attachment" if "/CmmFileUtil/" in parts.path else "program"}
    if parts.hostname in {"www.gov.kr", "gov.kr"}:
        match = re.search(r"/rcvfvrSvc/dtlEx/([A-Za-z0-9]+)/?$", parts.path)
        if match:
            return {"provider": "gov24", "programId": match[1], "kind": "program"}
    return None


def source_cache_key(program_or_url):
    """URL-level cache key: retain identity/menu parameters, normalize order."""
    url = program_source_url(program_or_url) if isinstance(program_or_url, dict) else public_url(program_or_url)
    if not url:
        return None
    parts = urlsplit(url)
    query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True)
             if not key.lower().startswith("utm_")]
    return urlunsplit((parts.scheme, parts.netloc.lower(), parts.path, urlencode(sorted(query)), ""))


def _json_value(value):
    return json.loads(value) if isinstance(value, str) else value


def _bokjiro(program, url, soup):
    source_id = dict(parse_qsl(urlsplit(url).query)).get("wlfareInfoId", "")
    expected = _expected_id(program, "bokjiro")
    if not re.fullmatch(r"WLF\d{8}", source_id) or (expected and expected != source_id):
        return _result("unavailable", url, error="source_id_mismatch")
    init = None
    for script in soup.find_all("script"):
        text = script.string or script.get_text()
        for match in _INIT.finditer(text):
            try:
                value, _ = json.JSONDecoder().raw_decode(text[match.end():])
                if isinstance(value, dict) and "initValue" in value:
                    init = _json_value(value["initValue"])
                    break
            except (ValueError, TypeError):
                continue
        if init is not None:
            break
    try:
        info = _json_value(init.get("dmWlfareInfo"))
        details = _json_value(init.get("dsWlfareInfoDtl", [])) or []
    except (AttributeError, ValueError, TypeError):
        return _result("unavailable", url, error="bokjiro_public_metadata_missing")
    if not isinstance(info, dict) or info.get("wlfareInfoId") != source_id:
        return _result("unavailable", url, error="source_id_mismatch")
    if not isinstance(details, list):
        return _result("unavailable", url, error="bokjiro_invalid_attachment_metadata")
    attachments, seen, incomplete = [], set(), False
    for row in details:
        if not isinstance(row, dict) or row.get("wlfareInfoDtlCd") != "040":
            continue
        if row.get("wlfareInfoId") != source_id:
            continue
        file_id, number = str(row.get("atcflId") or ""), str(row.get("atcflSn") or "")
        title = _clean_text(row.get("oriFileNm") or row.get("wlfareInfoReldNm"), 300)
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", file_id) or not re.fullmatch(r"[1-9]\d*", number) or not title:
            incomplete = True
            continue
        # Public GET route shipped in bokjiro ui/cpr-lib/udc.js ContentBar.
        # Unlike the desktop POST route, it needs no login, session or API key.
        download = "https://www.bokjiro.go.kr/ssis-tbu/twata/CmmFileUtil/getDownload.do?" + urlencode(
            {"atcflId": file_id, "atcflSn": number, "wlfareInfoId": source_id}
        )
        if download not in seen:
            attachments.append({"title": title, "url": download})
            seen.add(download)
    excerpt = " ".join(_clean_text(info.get(key)) for key in [
        "wlfareSprtTrgtCn", "wlfareSprtTrgtSlcrCn", "wlfareSprtBnftCn", "aplyMtdDc"
    ])
    return _result("read", url, title=_clean_text(info.get("wlfareInfoNm"), 300), programSpecific=True,
                   attachments=attachments, textExcerpt=_clean_text(excerpt),
                   error="attachment_metadata_incomplete" if incomplete else None)


def _attachment_links(root, url):
    attachments, seen, unresolved = [], set(), False
    for element in root.find_all(["a", "button"]):
        if element.find_parent(["nav", "header", "footer"]):
            continue
        label = _clean_text(element.get_text(" ", strip=True) or element.get("title") or element.get("download"), 300)
        href, onclick = element.get("href", ""), element.get("onclick", "")
        downloadish = bool(_DOCUMENT.search(label + " " + href) or _DOWNLOAD.search(href) or element.has_attr("download"))
        if not downloadish and not re.search(r"다운로드|첨부파일|서식.*받기", label):
            continue
        candidates = [href]
        # Only literal URL navigation, not arbitrary JS or function arguments.
        candidates += re.findall(r"(?:window\.open\s*\(|(?:window\.)?location(?:\.href)?\s*=)\s*['\"]([^'\"]+)['\"]", onclick)
        found = False
        for candidate in candidates:
            target = public_url(candidate, url)
            if not target or candidate.startswith("#") or target == url:
                continue
            if not (_DOCUMENT.search(target) or _DOWNLOAD.search(target) or element.has_attr("download")):
                continue
            found = True
            if target not in seen:
                attachments.append({"title": label or _clean_text(urlsplit(target).path.rsplit("/", 1)[-1], 300), "url": target})
                seen.add(target)
        if not found and onclick:
            unresolved = True
    return attachments, unresolved


def fetch_program_source(program, timeout=15):
    """Return read/blocked/unavailable/unsupported and same-page attachments.

    ``program`` is the existing catalog record. Its URL is authoritative input;
    no web search, cross-program attachment matching or filename approval occurs.
    Returned links are source attachments, which can include laws or guidance.
    """
    url = program_source_url(program)
    if not url:
        return _result("unsupported", "", error="unsafe_or_non_government_source_url")
    html, url, failure, error, retry = _get_html(url, timeout)
    if failure:
        extra = {"retryAfterSeconds": retry} if retry is not None else {}
        return _result(failure, url, error=error, **extra)
    soup = BeautifulSoup(html, "html.parser")
    page_title = _clean_text(soup.title.get_text() if soup.title else "", 300)
    if _has_visible_challenge(soup):
        return _result("blocked", url, error="access_challenge", title=page_title)
    host = urlsplit(url).hostname or ""
    specific = False
    if host in {"bokjiro.go.kr", "www.bokjiro.go.kr", "m.bokjiro.go.kr"}:
        return _bokjiro(program, url, soup)
    if host in {"gov.kr", "www.gov.kr"} and "/rcvfvrSvc/dtlEx/" in urlsplit(url).path:
        source_id = urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1]
        expected = _expected_id(program, "gov24")
        marker = soup.select_one("input#svcId")
        if (expected and expected != source_id) or not marker or marker.get("value") != source_id:
            return _result("unavailable", url, error="source_id_mismatch")
        root = soup.select_one(".gov-subsidy")
        heading = soup.select_one(".service-title")
        if not root or not heading or not root.select_one(".service-detail-inner, .detail-wrap"):
            return _result("unavailable", url, error="gov24_program_body_missing")
        page_title = _clean_text(heading.get_text(), 300)
        specific = True
    else:
        root = soup.select_one("main, article#content, #contents, #content, .board-view, .board_view") or soup.body
        if root is None:
            return _result("unsupported", url, error="html_program_body_missing", title=page_title)
    attachments, unresolved = _attachment_links(root, url)
    for node in root.find_all(["script", "style", "nav", "header", "footer"]):
        node.decompose()
    excerpt = _clean_text(root.get_text(" ", strip=True))
    if not excerpt and not attachments:
        return _result("unsupported", url, error="client_rendered_page", title=page_title)
    return _result("read", url, title=page_title, attachments=attachments, textExcerpt=excerpt,
                   programSpecific=specific,
                   error="unsupported_attachment_control" if unresolved else None)

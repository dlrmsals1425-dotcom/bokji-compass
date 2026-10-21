"""법령정보센터 별표·서식의 검토 후보 점수.

후보만 돌려준다. 게시 승인, 자격 충족, 필수 서류 여부는 정하지 않는다.
사람이 확인한 연결은 호출하는 쪽에서 따로 가른다.
"""

from __future__ import annotations

import re
import unicodedata

# 제목만으로 사업을 가리지 못하는 말. 복합어 안의 글자까지 지우지는 않는다.
_GENERIC = frozenset({
    "지원", "사업", "신청", "서비스", "운영", "지급", "신청서", "지원신청서",
    "지급신청서", "지원금", "지원사업", "서식", "별지", "별표", "관련", "위한",
    "대한", "관한", "및", "등", "또는", "대상", "제공", "안내", "조례", "시행규칙",
    "시행령", "법률", "규정", "규칙", "동의서", "서약서", "위임장", "확인서",
    "증명서", "진단서", "소견서", "사유서", "진술서", "신고서",
})
_TRAILING = tuple(sorted({
    "지원신청서", "지급신청서", "지원사업", "신청서", "지원금", "서비스",
    "지원", "사업", "신청", "지급", "운영",
}, key=len, reverse=True))
# 법령이 같을 때 이름만 일반적인 첨부·동의 문구. 이것뿐이면 낮은 순위다.
_BOILERPLATE = frozenset({
    "개인정보", "수집", "이용", "제3자", "동의", "서약", "위임", "대리", "대리인",
    "첨부", "구비", "서류", "제출", "작성", "해당", "경우", "기타", "참고", "본인",
    "세대", "가구", "주민등록", "서명", "날인", "고지", "수령", "청구", "정보",
    "성명", "주소", "연락처", "전화번호", "생년월일", "통장", "계좌", "예금",
})
_BLOCKED_ROLES = frozenset({"deleted", "administrative", "reference"})
_QUOTES = "「」『』\"'“”‘’"
# ㆍ(U+318D)는 NFKC에서 ᆞ(U+119E)가 된다. 둘 다 가운데점과 같이 뺀다.
_DOTS = "·ㆍ・･‧․•∙⋅ᆞ"
_ARTICLE_MORE = r"(?:제\d+조(?:의\d+)?|제\d+항|제\d+호|제\d+목)"
_TRAILING_ARTICLES = re.compile(
    r"(?:\s*제\d+조(?:의\d+)?(?:\s*제\d+항)?(?:\s*제\d+호)?(?:\s*제\d+목)?"
    r"(?:(?:\s*[,，、]\s*|\s*및\s*|\s*또는\s*)" + _ARTICLE_MORE + r")*)+\s*$"
)
_GLUED_ARTICLES = re.compile(r"(?:제\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?(?:제\d+목)?)+$")
_ATOM = re.compile(
    r"^(?:제\d+조(?:의\d+)?(?:제\d+항)?(?:제\d+호)?(?:제\d+목)?|제\d+(?:항|호|목))$"
)
_INSTITUTION = re.compile(
    r"기관용|학교용|교육지원청용|공무원용|담당자용|수탁운영|수리업체지정|교부|정산|"
    r"출납|접수부|대장|명부|통지|통보|지정서|점검표|심사기준|관리대장|관리카드|관리부"
)
# 닫는 괄호가 제목 끝이면 괄호 안이 서식명이다. 별지 번호만 떼고 그 글자는 남긴다.
_WHOLE_FORM_BRACKET = re.compile(r"^\s*\[([^\]]*)\]\s*$")
_LEADING_FORM_BRACKET = re.compile(r"^\s*\[[^\]]*\]\s*")
_ANNEX_LABEL = re.compile(r"^(?:별지|별표)\s*(?:제\s*\d+\s*호)?\s*(?:서식)?\s*")
_PARENS = re.compile(r"[（(]([^)）]*)[)）]")
_DIRECT_SCORE = {
    ("exact", "specific"): 86,
    ("exact", "generic"): 40,
    ("exact", "unrelated"): 22,
    ("family", "specific"): 48,
    ("family", "generic"): 30,
    ("family", "unrelated"): 16,
}
_REFERENCE_SCORE = {
    ("exact", "specific"): 74,
    ("exact", "generic"): 36,
    ("exact", "unrelated"): 20,
    ("family", "specific"): 34,
    ("family", "generic"): 24,
    ("family", "unrelated"): 14,
}
_TITLE_SCORE = 64


def normalize_law(text: str | None) -> str:
    """법령명 비교 키. 시행령·시행규칙은 남기고 조문 표기만 뺀다."""
    if text is None:
        return ""
    folded = unicodedata.normalize("NFKC", str(text))
    if not folded.strip():
        return ""
    folded = "".join(ch for ch in folded if ch not in _QUOTES and ch not in _DOTS)
    # Article headings are citation metadata, not part of the law's title.
    folded = re.sub(r'(제\s*\d+\s*조(?:\s*의\s*\d+)?)\s*\([^()]*\)(?=\s*(?:$|제\d+항|[,，、]|및\s*제))', r'\1', folded)
    for _ in range(4):
        nxt = _strip_article_parens(folded)
        nxt = _strip_trailing_articles(nxt)
        if nxt == folded:
            break
        folded = nxt
    compact = re.sub(r"\s+", "", folded)
    glued = _GLUED_ARTICLES.search(compact)
    if glued and glued.start() > 0:
        compact = compact[:glued.start()]
    return compact.casefold()


_CITATION_SUFFIXES = ('법', '법률', '특별법', '시행령', '시행규칙', '조례', '규칙',
                      '규정', '준칙', '지침', '고시', '훈령', '예규', '요령', '기준')


def _complete_law_citation(text: str) -> bool:
    """접속어 직전이 법규명 또는 법규명+조문인지 확인한다."""
    def named(value):
        key = normalize_law(value)
        return bool(key and key not in _CITATION_SUFFIXES and key.endswith(_CITATION_SUFFIXES))

    plain = unicodedata.normalize('NFKC', text)
    plain = ''.join(ch for ch in plain if ch not in _QUOTES)
    article = re.search(r'제\s*\d+\s*조', plain)
    if not article:
        return named(text)
    if not named(plain[:article.start()].rstrip(' ([{')):
        return False
    # 제20조(청년 주거지원) 같은 조문 제목은 인용의 일부다. 설명 문장
    # 중간의 '및'까지 새 법규 경계로 보지 않도록 조문 형식만 허용한다.
    tail = plain[article.start():]
    while re.search(r'\([^()]*\)', tail):
        tail = re.sub(r'\([^()]*\)', '', tail)
    tail = re.sub(r'(?:제\s*)?\d+\s*(?:조(?:\s*의\s*\d+)?|항|호|목)', '', tail)
    tail = re.sub(r'및|또는|부터|까지|내지|등', '', tail)
    return not tail.strip(' \t\r\n,，、()[]{}~-')


def split_law_citations(text: str) -> list[str]:
    """법명 안의 접속어·쉼표와 조문 목록은 보존하고 인용 경계만 나눈다.

    접속어 뒤의 생략 제명·계획은 보충하지 않는다. 다음 단계가 원문대로
    특정하거나 미확정 인용으로 남기도록 분리한 텍스트만 돌려준다.
    """
    text = str(text).replace('||', ';')
    parts, stack, buffer = [], [], ''
    pairs = dict(zip('([{（［｛「『“', ')]}）］｝」』”'))
    bullets = '○◦●□■▪▫'
    for position, character in enumerate(text):
        if character in ('"', "'"):
            if stack and stack[-1] == character:
                stack.pop()
            else:
                stack.append(character)
        elif character in pairs:
            stack.append(pairs[character])
        elif stack and character == stack[-1]:
            stack.pop()
        separator = False
        if not stack:
            if character in ';；/\n' + bullets:
                separator = True
            elif character in ',，、' or character == '및':
                right = text[position + 1:].lstrip(' \t\r\n「『“\"\'')
                next_article = re.match(r'(?:제\s*)?\d+\s*[조항호목]', right)
                # 실제 일괄개정 조례명 속 '법 및 같은 법 시행령 ... 개정에
                # 따른 ... 조례'는 두 인용으로 자르지 않는다.
                title_continuation = (character == '및' and re.match(
                    r'(?:같은\s*법|동법)\s*시행(?:령|규칙)\s*(?:전부|일부)?개정에\s*따른', right))
                separator = bool(right and not next_article and not title_continuation
                                 and _complete_law_citation(buffer))
        if separator:
            if buffer.strip():
                parts.append(buffer.strip())
            buffer = ''
        else:
            buffer += character
    if buffer.strip():
        parts.append(buffer.strip())
    return parts


def law_variants(text: str | None) -> list[str]:
    """검색용 제명. 기본 법·조례에 관례적 하위 제명을 더할 뿐 위임을 단정하지 않는다.

    법은 시행령·시행규칙, 조례는 시행규칙만 붙인다. 이미 시행령·시행규칙이면 그대로 둔다.
    """
    base = normalize_law(text)
    if not base:
        return []
    if base.endswith("시행령") or base.endswith("시행규칙"):
        return [base]
    # '법률'은 '법'으로 끝나지 않는다(률). 둘 다 기본 법령으로 본다.
    if base.endswith("법률") or base.endswith("법"):
        return [base, base + "시행령", base + "시행규칙"]
    if base.endswith("조례"):
        return [base, base + "시행규칙"]
    return [base]


def law_aliases(text: str | None, geography: dict | None = None) -> list[str]:
    """같은 시·군·구 조례 앞에 그 시·도 공식 이름만 붙인 제명.

    geography는 호출자가 이미 아는 이름이다. 예: {"sido": "서울특별시", "sigungu": "종로구"}.
    제목이 그 시·군·구로 시작할 때만 시·도를 앞에 붙인다. 다른 지역 이름은 빼지 않고,
    시·도만 있는 제명도 줄이지 않는다. 지역 코드로 이름을 만들지 않는다.
    """
    base = normalize_law(text)
    if not base:
        return []
    if not isinstance(geography, dict):
        return [base]
    sido = normalize_law(str(geography.get("sido") or ""))
    sigungu = normalize_law(str(geography.get("sigungu") or ""))
    if len(sido) < 2 or len(sigungu) < 2:
        return [base]
    if base.startswith(sigungu) and len(base) > len(sigungu) and not base.startswith(sido):
        return [base, sido + base]
    return [base]


def classify_role(title: str | None, declared_kind: str | None) -> str:
    """서식 역할. 삭제와 기관·회계 서식을 동의서·신청서보다 먼저 가른다."""
    kind = unicodedata.normalize("NFKC", str(declared_kind or "")).strip().casefold()
    raw = unicodedata.normalize("NFKC", str(title or ""))
    if _is_deleted(raw, kind):
        return "deleted"
    if _is_annex(raw, kind):
        return "reference"
    body = _strip_leading_form_bracket(raw).strip()
    compact = re.sub(r"\s+", "", body)
    if _INSTITUTION.search(compact):
        return "administrative"
    if "위임장" in compact:
        return "delegation"
    if re.search(r"동의서|서약서", compact):
        return "consent"
    # Join 신청(변경)서 into 신청서, but keep 신청서·피해신고서 that
    # appear only inside parentheses, as in 별지서식(신청서).
    joined = _PARENS.sub("", compact)
    visible = joined + "".join(_PARENS.findall(compact))
    if re.search(r'피해(?:발생)?신고서',visible) or any(word in visible for word in ('신청서','청구서')):
        return "application"
    if re.search(r"확인서|증명서|진단서|소견서|사유서|진술서", compact):
        return "supporting"
    return "reference"


def program_tokens(program: dict | None) -> list[str]:
    """사업명·별칭의 고유어. 지역 이름과 지원·사업·서비스·신청·운영은 빼되 복합어는 남긴다."""
    if not isinstance(program, dict):
        return []
    skip = _region_words(program, None)
    found: list[str] = []
    for text in _names(program):
        for token in _content_tokens(text, skip):
            if token not in found:
                found.append(token)
    return _drop_contained(found)


def evaluate_candidate(program: dict | None, form: dict | None) -> dict | None:
    """후보 하나. 중복 제거나 게시 승인은 하지 않는다. 없으면 None."""
    if not isinstance(program, dict) or not isinstance(form, dict):
        return None
    form_id = str(form.get("id") or "").strip()
    if not form_id:
        return None
    if classify_role(form.get("title"), form.get("declaredKind")) in _BLOCKED_ROLES:
        return None
    scope_basis = _scope_basis(program, form)
    if scope_basis is None:
        return None
    law_kind = _law_kind(program, form)
    if scope_basis == "national_law_reference":
        if law_kind is None:
            return None
        basis = "law_reference"
    elif law_kind == "exact":
        basis = "law_exact"
    elif law_kind == "family":
        basis = "law_family"
    else:
        basis = ""
    overlap = _title_overlap(program, form)
    if not basis:
        if not overlap:
            return None
        basis = "title_overlap"
        strength = "specific"
    else:
        strength = "specific" if overlap else _form_strength(program, form)
    score = _score(basis, law_kind or "exact", strength)
    return {
        "formId": form_id,
        "score": score,
        "reason": _reason(basis, law_kind, strength, overlap, form),
        "basis": basis,
        "scopeBasis": scope_basis,
    }


def _strip_article_parens(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        return "" if _is_article_paren(match.group(1)) else match.group(0)

    return re.sub(r"\(([^)]*)\)", repl, text)


def _is_article_paren(content: str) -> bool:
    compact = re.sub(r"\s+", "", content)
    if "조" not in compact:
        return False
    parts = re.split(r"\s*[,，、]\s*|\s*및\s*|\s*또는\s*", content.strip())
    return bool(parts) and all(_ATOM.match(re.sub(r"\s+", "", part)) for part in parts if part != "")


def _strip_trailing_articles(text: str) -> str:
    current = text
    for _ in range(4):
        match = _TRAILING_ARTICLES.search(current)
        if not match or match.start() == 0:
            break
        current = current[:match.start()].rstrip()
    return current


def _strip_leading_form_bracket(text: str) -> str:
    """앞의 [별지 …]만 뺀다. 괄호가 제목 전체이면 안의 서식명을 남긴다."""
    whole = _WHOLE_FORM_BRACKET.match(text)
    if whole:
        return _ANNEX_LABEL.sub("", whole.group(1).strip(), count=1).strip()
    return _LEADING_FORM_BRACKET.sub("", text, count=1)


def _is_deleted(raw: str, kind: str) -> bool:
    if kind in {"삭제", "deleted", "폐지"}:
        return True
    if re.search(r"[<〈]\s*삭제", raw) or re.search(r"삭제\s*\d{4}", raw):
        return True
    body = re.sub(r"\[[^\]]*\]", "", raw)
    body = re.sub(r"[\s<>〈〉().]", "", body)
    return body.startswith("삭제") and len(body) <= 24


def _is_annex(raw: str, kind: str) -> bool:
    if kind in {"별표", "reference", "annex"}:
        return True
    return re.match(r"^\s*\[?\s*별표(?:\s|\d|\]|$)", raw) is not None


def _names(program: dict) -> list[str]:
    names = [program.get("name") or ""]
    aliases = program.get("aliases") or []
    if isinstance(aliases, str):
        aliases = [aliases]
    if isinstance(aliases, list):
        names.extend(alias for alias in aliases if isinstance(alias, str))
    return [name for name in names if isinstance(name, str)]


def _region_words(program: dict | None, form: dict | None) -> set[str]:
    labels: list[str] = []
    region = program.get("region") if isinstance(program, dict) else None
    if isinstance(region, dict) and region.get("label"):
        labels.append(str(region["label"]))
    if isinstance(form, dict) and form.get("regionLabel"):
        labels.append(str(form["regionLabel"]))
    skip: set[str] = set()
    for label in labels:
        text = unicodedata.normalize("NFKC", label).casefold()
        for part in re.split(r"[^0-9a-z가-힣]+", text):
            if len(part) >= 2:
                skip.add(part)
            stem = re.sub(r"(특별자치시|특별자치도|특별시|광역시|시|도|군|구)$", "", part)
            if len(stem) >= 2 and stem != part:
                skip.add(stem)
    return skip


def _content_tokens(text: str, skip: set[str]) -> list[str]:
    plain = unicodedata.normalize("NFKC", str(text or ""))
    plain = _strip_leading_form_bracket(plain)
    plain = _unwrap_non_article_parens(plain)
    plain = plain.casefold()
    found: list[str] = []
    for part in re.split(r"[^0-9a-z가-힣]+", plain):
        token = _content_token(part, skip)
        if token and token not in found:
            found.append(token)
    return found


def _unwrap_non_article_parens(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        return " " if _is_article_paren(match.group(1)) else f" {match.group(1)} "

    return re.sub(r"[（(]([^)）]*)[)）]", repl, text)


def _is_place(part: str, skip: set[str]) -> bool:
    if part in skip:
        return True
    stem = re.sub(r"(특별자치시|특별자치도|특별시|광역시|시|도|군|구)$", "", part)
    return len(stem) >= 2 and stem in skip


def _content_token(part: str, skip: set[str]) -> str | None:
    if len(part) < 2 or part in _GENERIC or _is_place(part, skip) or part.isdigit():
        return None
    peeled = part
    for _ in range(4):
        suffix = next((item for item in _TRAILING if peeled.endswith(item) and len(peeled) > len(item)), None)
        if suffix is None:
            break
        peeled = peeled[:-len(suffix)]
    if len(peeled) < 2 or peeled in _GENERIC or _is_place(peeled, skip):
        return None
    return part


def _drop_contained(tokens: list[str]) -> list[str]:
    return [
        token for token in tokens
        if not any(token != other and len(other) > len(token) and token in other for other in tokens)
    ]


def _scope_basis(program: dict, form: dict) -> str | None:
    kind = str(form.get("sourceKind") or "").strip().casefold()
    code = str(form.get("regionCode") or "").strip()
    if code.casefold() in {"", "unresolved", "unknown", "none"}:
        return None
    if code.casefold() == "national":
        code = "national"
    scope = str(program.get("scope") or "").strip().casefold()
    region = program.get("region") if isinstance(program.get("region"), dict) else {}
    sido = str(region.get("sido") or "").strip()
    sigungu = str(region.get("sigungu") or "").strip()
    if kind == "ordin":
        if re.fullmatch(r"\d{2}000", code):
            return "same_sido" if scope == "sido" and sido == code else None
        if re.fullmatch(r"\d{5}", code):
            return "same_sigungu" if scope == "sigungu" and sigungu == code else None
        return None
    if kind in {"law", "rule"} and code == "national":
        if scope == "national":
            return "national"
        if scope in {"sido", "sigungu"}:
            return "national_law_reference"
    return None


def _cited_norms(program: dict) -> list[str]:
    raw = program.get("laws") or []
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    found: list[str] = []
    for entry in raw:
        if not isinstance(entry, str):
            continue
        for part in split_law_citations(entry):
            norm = normalize_law(part)
            if norm and norm not in found:
                found.append(norm)
    return found


def _pair_geography(form: dict) -> dict | None:
    """서식 표기에 적힌 시·도와 시·군·구. 코드로 이름을 만들지 않는다."""
    code = str(form.get("regionCode") or "").strip()
    if not re.fullmatch(r"\d{5}", code) or re.fullmatch(r"\d{2}000", code):
        return None
    parts = str(form.get("regionLabel") or "").split()
    if len(parts) != 2 or min(len(parts[0]), len(parts[1])) < 2:
        return None
    return {"sido": parts[0], "sigungu": parts[1]}


def _law_kind(program: dict, form: dict) -> str | None:
    form_norm = normalize_law(str(form.get("lawTitle") or ""))
    if not form_norm:
        return None
    geography = _pair_geography(form)
    exact = False
    family = False
    form_family = set(law_variants(form_norm)[1:])
    for cited in _cited_norms(program):
        cited_names = law_aliases(cited, geography)
        if form_norm in cited_names:
            exact = True
            break
        cited_family: list[str] = []
        for name in cited_names:
            cited_family.extend(law_variants(name)[1:])
        if form_norm in cited_family or cited in form_family:
            family = True
    if exact:
        return "exact"
    if family:
        return "family"
    return None


def _title_overlap(program: dict, form: dict) -> list[str] | None:
    tokens = program_tokens(program)
    if not tokens:
        return None
    skip = _region_words(program, form)
    form_tokens = set(_content_tokens(str(form.get("title") or ""), skip))
    compact = _compact_title(str(form.get("title") or ""))
    hits = [token for token in tokens if token in form_tokens or (len(token) >= 4 and token in compact)]
    if len(tokens) == 1:
        return hits if len(hits) == 1 and len(hits[0]) >= 4 else None
    if len(hits) >= 2:
        return hits
    glued = "".join(tokens)
    if len(glued) >= 4 and glued in compact:
        return list(tokens)
    return None


def _compact_title(text: str) -> str:
    plain = unicodedata.normalize("NFKC", text).casefold()
    plain = _strip_leading_form_bracket(plain)
    return re.sub(r"[^0-9a-z가-힣]", "", plain)


def _form_strength(program: dict, form: dict) -> str:
    skip = _region_words(program, form)
    distinctive = [
        token for token in _content_tokens(str(form.get("title") or ""), skip)
        if token not in _BOILERPLATE
    ]
    return "generic" if not distinctive else "unrelated"


def _score(basis: str, law_kind: str, strength: str) -> int:
    if basis == "title_overlap":
        return _TITLE_SCORE
    table = _REFERENCE_SCORE if basis == "law_reference" else _DIRECT_SCORE
    return table[(law_kind, strength)]


def _reason(basis: str, law_kind: str | None, strength: str, overlap: list[str] | None, form: dict) -> str:
    law_title = str(form.get("lawTitle") or "").strip() or "법령명 없음"
    if basis == "law_reference" and law_kind == "family":
        return f"검토 후보. 지역 사업이 인용한 법령과 같은 계열의 전국 서식입니다: {law_title}. 시행령·시행규칙 이름은 검색용이며 하위 관계까지 본 것은 아닙니다."
    if basis == "law_reference":
        return f"검토 후보. 지역 사업이 같은 전국 법령을 인용합니다: {law_title}. 같은 단어만으로는 올리지 않았습니다."
    if basis == "law_family":
        return f"검토 후보. 인용 법령과 시행령·시행규칙 이름이 같은 계열입니다: {law_title}. 하위 관계까지 본 것은 아닙니다."
    if basis == "law_exact" and strength == "generic":
        return f"검토 후보. 법령명이 같습니다: {law_title}. 서식 이름이 일반적이라 낮은 순위입니다."
    if basis == "law_exact" and strength == "unrelated":
        return f"검토 후보. 법령명이 같습니다: {law_title}. 서식 이름이 다른 세부 내용을 가리켜 낮은 순위입니다."
    if basis == "law_exact":
        return f"검토 후보. 법령명이 같습니다: {law_title}."
    words = ", ".join(overlap or [])
    return f"검토 후보. 사업명 고유어가 같습니다: {words}."

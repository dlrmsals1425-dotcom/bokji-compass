#!/usr/bin/env python3
"""Resumable URL census of committed public welfare records.

Prepare: python scripts/audit-official-pages.py --prepare-only
Probe:   python scripts/audit-official-pages.py --max-jobs 3
Run/resume: python scripts/audit-official-pages.py

No default sampling cap. A read page is source evidence, never an approved form.
Only compact, sanitized adapter results are cached; no HTML, credentials or raw
exception messages are persisted. --retry-failed explicitly retries cached
failures (including unattempted host-blocked jobs).
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime, timezone
import hashlib
import html
import importlib
import ipaddress
import json
from pathlib import Path
import re
import threading
import time
import traceback
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit, urlunsplit


SCHEMA = 1
URL_RE = re.compile(r"(?:https?://|www\.)[^\s<>\"'`]+", re.I)
SECRET_KEY = re.compile(
    r"(?:token|password|passwd|secret|authorization|credential|signature|"
    r"(?:api|service|access)[_-]?key|^oc$|^sig$|session|^x-amz-)", re.I
)
SAFE_ERRORS = {
    "unsafe_or_login_redirect", "source_too_large", "network_error", "timeout",
    "redirect_limit", "source_id_mismatch", "attachment_metadata_incomplete",
    "bokjiro_public_metadata_missing", "bokjiro_invalid_attachment_metadata",
    "gov24_program_body_missing", "html_program_body_missing", "client_rendered_page",
    "access_challenge", "unsupported_attachment_control",
    "unsafe_or_non_government_source_url", "unsupported_source_host",
    "adapter_exception", "adapter_error", "invalid_adapter_result",
    "blocked_by_host", "blocked_by_retry_after", "unsafe_result_url",
}
TRANSIENT = {"timeout", "network_error", "http_408", "http_429", "http_500", "http_502", "http_503", "http_504"}
ACCESS_BLOCKS = {"http_401", "http_403", "http_407", "http_451", "access_challenge"}


def now_iso():
    return datetime.fromtimestamp(time.time(), timezone.utc).isoformat()


def timestamp(value):
    try:
        return datetime.fromisoformat(value).timestamp() if isinstance(value, str) else 0
    except (ValueError, OverflowError):
        return 0


def public_url(value, depth=0):
    """Validate an explicitly supplied public URL; never construct search URLs."""
    if not isinstance(value, str) or depth > 3:
        return None
    value = html.unescape(value.strip())
    if value.lower().startswith("www."):
        value = "https://" + value
    if not value or re.search(r"[\x00-\x20\\]", value):
        return None
    try:
        parts = urlsplit(value)
        host = (parts.hostname or "").lower().rstrip(".")
        if parts.scheme.lower() not in {"http", "https"} or parts.username or parts.password:
            return None
        if parts.port not in {None, 80, 443} or not host or "%" in host:
            return None
        try:
            if not ipaddress.ip_address(host).is_global:
                return None
        except ValueError:
            if ("." not in host or not re.fullmatch(r"[a-z0-9.-]+", host)
                    or host.endswith((".localhost", ".local", ".internal", ".lan", ".test", ".invalid", ".example"))
                    or not re.search(r"\.[a-z]{2,}$", host)):
                return None
        decoded_path = unquote(parts.path)
        if re.search(r"[\x00-\x1f\x7f\\]", decoded_path) or re.search(r";jsessionid|/(login|signin|logout|mypage|mygov|private)(/|\.|$)", decoded_path, re.I):
            return None
        query = parse_qsl(parts.query, keep_blank_values=True)
        for key, item in query:
            inspected_key = unquote(unquote(key))
            if SECRET_KEY.search(inspected_key) or (inspected_key.lower() == "key" and not re.fullmatch(r"[0-9]+", item)):
                return None
            if re.search(r"[\x00-\x1f]", key + item):
                return None
            nested = item
            for _ in range(2):
                nested = unquote(nested)
            if re.match(r"(?:https?:)?//", nested, re.I):
                if not public_url("https:" + nested if nested.startswith("//") else nested, depth + 1):
                    return None
            if re.search(r"(?:serviceKey|api[_-]?key|access_token|authorization|password)\s*[:=]", nested, re.I):
                return None
        # Reordering distinct query keys is safe; duplicate keys retain their order.
        if len({key for key, _ in query}) == len(query):
            query.sort()
        netloc = "[" + host + "]" if ":" in host else host
        if parts.port and not ((parts.scheme.lower() == "https" and parts.port == 443) or (parts.scheme.lower() == "http" and parts.port == 80)):
            netloc += ":" + str(parts.port)
        return urlunsplit((parts.scheme.lower(), netloc, parts.path or "/", urlencode(query), ""))
    except (ValueError, UnicodeError, RecursionError):
        return None


def safe_text(value, limit=1400):
    if not isinstance(value, str):
        return ""
    value = html.unescape(re.sub(r"<[^>]*>", " ", value))
    value = URL_RE.sub(lambda match: public_url(match[0]) or "[URL omitted]", value)
    value = re.sub(r"(?i)\bauthorization[\"']?\s*[:=]\s*[\"']?(?:bearer|basic)\s+[^\s,;\"']+", "[credential omitted]", value)
    value = re.sub(r"(?i)\b(?:authorization|password|passwd|secret|(?:api|service|access)[_-]?key|access_token)[\"']?\s*[:=]\s*[\"']?[^\s,;\"']+", "[credential omitted]", value)
    return re.sub(r"\s+", " ", value).strip()[:limit]


def source_identity(url):
    parts = urlsplit(url)
    host = parts.hostname
    if host in {"www.gov.kr", "gov.kr"}:
        match = re.search(r"/rcvfvrSvc/dtlEx/([A-Za-z0-9]+)/?$", parts.path)
        if match:
            return {"provider": "gov24", "programId": match[1], "kind": "program"}
    if host in {"www.bokjiro.go.kr", "bokjiro.go.kr", "m.bokjiro.go.kr"}:
        identifier = dict(parse_qsl(parts.query)).get("wlfareInfoId", "")
        if re.fullmatch(r"WLF\d{8}", identifier):
            return {"provider": "bokjiro", "programId": identifier,
                    "kind": "attachment" if "/CmmFileUtil/" in parts.path else "program"}
    return None


def page_key(url):
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def load_programs(directory):
    programs = {}
    for file in sorted(Path(directory).glob("*.json")):
        if not re.fullmatch(r"[0-9a-f]{2}\.json", file.name):
            continue
        shard = json.loads(file.read_text(encoding="utf-8-sig"))
        for identifier, program in shard.items():
            if identifier in programs or not isinstance(program, dict) or program.get("id") != identifier:
                raise ValueError("duplicate_or_invalid_program_id")
            programs[identifier] = program
    if not programs:
        raise ValueError("no_program_records")
    return programs


def extract_sources(program):
    candidates = [("url", program.get("url")), ("applyUrl", program.get("applyUrl"))]
    for index, source in enumerate(program.get("sources", []) or []):
        if isinstance(source, dict):
            candidates.append((f"sources[{index}].url", source.get("url")))
    for field in ("documents", "applyMethod"):
        value = program.get(field)
        if isinstance(value, str):
            for match in URL_RE.finditer(value):
                # Common prose terminators are not part of a public URL.
                candidates.append((field, match[0].rstrip(".,;:!?)]}〉》>。")))
    accepted, rejected = [], 0
    for field, raw in candidates:
        if not raw:
            continue
        url = public_url(raw)
        if url:
            accepted.append((field, url))
        else:
            rejected += 1
    return accepted, rejected


def prepare_plan(programs):
    jobs, links, rejected = {}, {}, 0
    for identifier, program in sorted(programs.items()):
        sources, dropped = extract_sources(program)
        rejected += dropped
        keys = set()
        for field, url in sources:
            key = page_key(url)
            keys.add(key)
            job = jobs.setdefault(key, {"key": key, "url": url, "sourceIdentity": source_identity(url), "contexts": []})
            context = {"programId": identifier, "field": field}
            if context not in job["contexts"]:
                job["contexts"].append(context)
        links[identifier] = {"pageKeys": sorted(keys)}
    return {"schema": SCHEMA, "programs": links, "jobs": dict(sorted(jobs.items())), "rejectedUrlOccurrences": rejected}


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{time.time_ns()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    for attempt in range(20):
        try:
            temporary.replace(path)
            return
        except PermissionError:
            if attempt == 19:
                raise
            # Windows readers/virus scanners may briefly hold the old file.
            time.sleep(0.05)


def normalize_result(raw, job, attempted=True, attempts=1):
    if not isinstance(raw, dict) or raw.get("status") not in {"read", "blocked", "unavailable", "unsupported"}:
        raw = {"status": "unavailable", "errorCode": "invalid_adapter_result"}
    url = public_url(raw.get("url"))
    code = raw.get("errorCode")
    code = code if isinstance(code, str) and (code in SAFE_ERRORS or re.fullmatch(r"http_[1-5]\d{2}", code)) else ("adapter_error" if code else None)
    status = raw["status"]
    if raw.get("url") and not url:
        status, code = "blocked", "unsafe_result_url"
    identity = job["sourceIdentity"]
    if (status == "read" and identity and identity["kind"] == "program"
            and source_identity(url or job["url"]) != identity):
        status, code = "unavailable", "source_id_mismatch"
    specific = (status == "read" and raw.get("programSpecific") is True
                and bool(identity and identity["kind"] == "program")
                and source_identity(url or job["url"]) == identity)
    result = {"status": status, "url": url or job["url"], "requestedUrl": job["url"],
              "attachments": [], "programSpecific": specific, "sourceIdentity": identity,
              "attachmentContext": "exact_source_program" if specific else "shared_or_generic_source_page",
              "checkedAt": now_iso(), "requestAttempted": bool(attempted), "attempts": attempts}
    if code:
        result["errorCode"] = code
    for field, limit in (("title", 300), ("textExcerpt", 1400)):
        text = safe_text(raw.get(field), limit)
        if text:
            result[field] = text
    seen = set()
    if status == "read":
        attachments = raw.get("attachments", [])
        for attachment in attachments if isinstance(attachments, list) else []:
            if not isinstance(attachment, dict):
                continue
            target = public_url(attachment.get("url"))
            if target and target not in seen:
                seen.add(target)
                result["attachments"].append({"title": safe_text(attachment.get("title"), 300),
                                              "url": target, "sourcePageUrl": result["url"],
                                              "programSpecific": specific})
    retry = raw.get("retryAfterSeconds")
    if isinstance(retry, (int, float)) and not isinstance(retry, bool) and 0 <= retry <= 86400:
        result["retryAfterSeconds"] = int(retry)
        until = timestamp(raw.get("retryNotBefore")) or (time.time() + retry)
        result["retryNotBefore"] = datetime.fromtimestamp(until, timezone.utc).isoformat()
    elif timestamp(raw.get("retryNotBefore")):
        result["retryNotBefore"] = datetime.fromtimestamp(timestamp(raw["retryNotBefore"]), timezone.utc).isoformat()
    return result


def cache_path(directory, key):
    return Path(directory) / "results" / (key + ".json")


def read_cache(directory, job, fingerprint, reuse_read_fingerprints=()):
    try:
        cached = json.loads(cache_path(directory, job["key"]).read_text(encoding="utf-8"))
        if (cached.get("schema") != SCHEMA or cached.get("key") != job["key"]
                or cached.get("requestedUrl") != job["url"] or cached.get("sourceIdentity") != job["sourceIdentity"]):
            return None
        result = cached["result"]
        if cached.get("adapterFingerprint") != fingerprint and not (
                cached.get("adapterFingerprint") in reuse_read_fingerprints and result.get("status") == "read"):
            return None
        if (result.get("requestedUrl") != job["url"] or result.get("sourceIdentity") != job["sourceIdentity"]
                or not isinstance(result.get("requestAttempted"), bool)
                or not timestamp(result.get("checkedAt"))
                or result.get("status") not in {"read", "blocked", "unavailable", "unsupported"}):
            return None
        normalized = normalize_result(result, job, result["requestAttempted"], result.get("attempts", 0))
        normalized["checkedAt"] = result["checkedAt"]
        if normalized["status"] != result["status"]:
            return None
        return normalized
    except (OSError, ValueError, KeyError, TypeError):
        return None


def write_cache(directory, job, fingerprint, result):
    atomic_json(cache_path(directory, job["key"]), {"schema": SCHEMA, "key": job["key"],
                "requestedUrl": job["url"], "sourceIdentity": job["sourceIdentity"],
                "adapterFingerprint": fingerprint, "result": result})


class HostGate:
    def __init__(self, interval=0.3, block_threshold=12):
        self.interval, self.threshold = interval, block_threshold
        self.lock = threading.Lock()
        self.hosts = {}

    def state(self, host):
        return self.hosts.setdefault(host, {"next": 0, "blocked": 0, "read": 0, "deferred": False, "retryUntil": 0})

    def restore_cooldown(self, host, until):
        remaining = until - time.time()
        if remaining > 0:
            with self.lock:
                state = self.state(host)
                state["next"] = max(state["next"], time.monotonic() + remaining)
                state["retryUntil"] = max(state["retryUntil"], until)
                state["deferred"] = remaining > 30

    def retry_not_before(self, host):
        with self.lock:
            until = self.state(host)["retryUntil"]
            return datetime.fromtimestamp(until, timezone.utc).isoformat() if until else None

    def before(self, host):
        while True:
            with self.lock:
                state = self.state(host)
                if state["deferred"]:
                    return "blocked_by_retry_after"
                if self.threshold and state["blocked"] >= self.threshold and not state["read"]:
                    return "blocked_by_host"
                delay = state["next"] - time.monotonic()
                if delay <= 0:
                    state["next"] = time.monotonic() + self.interval
                    return None
            time.sleep(min(delay, 1))

    def record(self, host, result):
        with self.lock:
            state = self.hosts[host]
            if result["status"] == "read":
                state["read"] += 1
            elif result.get("errorCode") in ACCESS_BLOCKS:
                state["blocked"] += 1
            retry = result.get("retryAfterSeconds", 0)
            if retry:
                state["next"] = max(state["next"], time.monotonic() + retry)
                state["retryUntil"] = max(state["retryUntil"], timestamp(result.get("retryNotBefore")))
                # Do not hold every worker for an hours-long Retry-After. Defer
                # that host for this run and label every unsent URL explicitly.
                if retry > 30:
                    state["deferred"] = True


def fetch_job(job, fetcher, gate, timeout, retries, supported=None):
    if supported and not supported(job["url"]):
        return normalize_result({"status": "unsupported", "errorCode": "unsupported_source_host"}, job, False, 0)
    host = urlsplit(job["url"]).hostname
    identity = job["sourceIdentity"]
    program = {"url": job["url"], "sources": []}
    if identity and identity["kind"] == "program":
        program["id"] = f"n.{identity['provider']}-{identity['programId']}"
        program["sources"] = [{"source": identity["provider"], "id": identity["programId"], "url": job["url"]}]
    result = None
    for attempt in range(retries + 1):
        blocked = gate.before(host)
        if blocked:
            return result or normalize_result({"status": "blocked", "errorCode": blocked,
                "retryNotBefore": gate.retry_not_before(host)}, job, False, 0)
        try:
            raw = fetcher(program, timeout=timeout)
        except Exception:
            raw = {"status": "unavailable", "errorCode": "adapter_exception"}
        result = normalize_result(raw, job, True, attempt + 1)
        gate.record(host, result)
        if result.get("errorCode") not in TRANSIENT or attempt == retries or result.get("retryAfterSeconds", 0) > 30:
            break
        if not result.get("retryAfterSeconds"):
            time.sleep(min(2 ** attempt, 4))
    return result


def summarize(plan, pages):
    statuses = Counter(page["status"] for page in pages.values())
    return {"programs": len(plan["programs"]), "urls": len(plan["jobs"]),
            "read": statuses["read"], "blocked": statuses["blocked"],
            "failed": statuses["unavailable"] + statuses["unsupported"],
            "attachments": sum(len(page["attachments"]) for page in pages.values()),
            "attempted": sum(page["requestAttempted"] for page in pages.values()),
            "pending": len(plan["jobs"]) - len(pages), "unsupported": statuses["unsupported"],
            "unavailable": statuses["unavailable"], "rejectedUrlOccurrences": plan["rejectedUrlOccurrences"]}


def run_plan(plan, cache_dir, fetcher, *, fingerprint="test", workers=8, interval=0.3,
             timeout=15, retries=1, max_jobs=None, retry_failed=False, block_threshold=12, supported=None,
             reuse_read_fingerprints=()):
    pages, pending = {}, []
    gate = HostGate(interval, block_threshold)
    for key, job in plan["jobs"].items():
        cached = read_cache(cache_dir, job, fingerprint, reuse_read_fingerprints)
        until = timestamp(cached.get("retryNotBefore")) if cached else 0
        if until:
            gate.restore_cooldown(urlsplit(job["url"]).hostname, until)
        if cached and (until > time.time() or not (retry_failed and cached["status"] != "read")):
            pages[key] = cached
        else:
            pending.append(job)
    selected = pending if max_jobs is None else pending[:max_jobs]
    interrupted = False

    def progress():
        atomic_json(Path(cache_dir) / "progress.json", {"schema": 1, "updatedAt": now_iso(),
                    "summary": summarize(plan, pages), "selectedJobs": len(selected), "interrupted": interrupted})

    progress()
    iterator = iter(selected)
    executor = ThreadPoolExecutor(max_workers=workers)
    running = {}

    def submit():
        job = next(iterator, None)
        if job:
            running[executor.submit(fetch_job, job, fetcher, gate, timeout, retries, supported)] = job

    try:
        for _ in range(workers):
            submit()
        while running:
            done, _ = wait(running, return_when=FIRST_COMPLETED)
            for future in done:
                job = running.pop(future)
                result = future.result()
                write_cache(cache_dir, job, fingerprint, result)
                pages[job["key"]] = result
                submit()
            progress()
    except KeyboardInterrupt:
        interrupted = True
    finally:
        # At most `workers` jobs remain in flight. Preserve completed work before
        # exiting; never submit the remainder after interruption.
        executor.shutdown(wait=True, cancel_futures=True)
        for future, job in running.items():
            if not future.cancelled():
                result = future.result()
                write_cache(cache_dir, job, fingerprint, result)
                pages[job["key"]] = result
        progress()
    return {"schema": 1, "checkedAt": datetime.now(timezone.utc).date().isoformat(),
            "summary": summarize(plan, pages), "pages": pages, "programs": plan["programs"]}, interrupted


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--max-jobs", type=int, default=None, help="Explicit probe limit on uncached jobs; omitted means all")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--interval", type=float, default=0.3, help="Minimum seconds between starts on one host")
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--retries", type=int, default=1, help="Additional transient retries, 0 to 3")
    parser.add_argument("--retry-failed", action="store_true")
    parser.add_argument("--reuse-read-fingerprint", action="append", default=[],
                        help="Explicit old SHA256 whose successful reads remain valid after a host-allowlist-only change; never use after parser fixes")
    parser.add_argument("--host-block-threshold", type=int, default=12, help="Distinct denied jobs before skipping an unread host; 0 disables")
    args = parser.parse_args(argv)
    if any(not re.fullmatch(r'[a-f0-9]{64}', value) for value in args.reuse_read_fingerprint):
        parser.error("reuse-read-fingerprint must be a lowercase SHA256")
    if (args.workers < 1 or args.workers > 64 or args.interval < 0 or args.timeout <= 0
            or not 0 <= args.retries <= 3 or args.host_block_threshold < 0
            or (args.max_jobs is not None and args.max_jobs < 0)):
        parser.error("invalid numeric option")
    try:
        plan = prepare_plan(load_programs(args.root / "public/bundles/v1/details"))
        cache_dir = args.root / "logs/page-census"
        atomic_json(cache_dir / "jobs.json", plan)
        if args.prepare_only:
            progress = {"schema": 1, "updatedAt": now_iso(), "preparedOnly": True, "summary": summarize(plan, {})}
            atomic_json(cache_dir / "prepared.json", progress)
            print(json.dumps(progress["summary"]))
            return 0
        adapter = importlib.import_module("form_source_adapters")
        policy = args.root / 'pipeline/forms/official-source-hosts.json'
        fingerprint = hashlib.sha256(Path(adapter.__file__).read_bytes() + (policy.read_bytes() if policy.exists() else b'')).hexdigest()
        output, interrupted = run_plan(plan, cache_dir, adapter.fetch_program_source,
            fingerprint=fingerprint, workers=args.workers, interval=args.interval, timeout=args.timeout,
            retries=args.retries, max_jobs=args.max_jobs, retry_failed=args.retry_failed,
            block_threshold=args.host_block_threshold, supported=adapter.public_url,
            reuse_read_fingerprints=args.reuse_read_fingerprint)
        atomic_json(args.root / "pipeline/forms/official-page-audit.json", output)
        print(json.dumps(output["summary"]))
        return 130 if interrupted else 0
    except Exception as error:
        # The source adapter and URL gate must not put raw request/error data in logs.
        print(json.dumps({"errorCode": "page_census_failed", "errorType": type(error).__name__,
            "frames": [{"file": Path(frame.filename).name, "line": frame.lineno, "function": frame.name}
                       for frame in traceback.extract_tb(error.__traceback__)]}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

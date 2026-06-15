#!/usr/bin/env python3
"""
Canva media generation worker.
Called via subprocess from the Canva TypeScript provider.

Input (stdin JSON):
  { mode: "image"|"video"|"quota"|"pptx", prompt?: str, cookies: {...}, timeout?: int }

Output (stdout JSON):
  { ok: bool, media_url?, thumbnail_url?, width?, height?, size?, quota_used?, quota_limit?, error? }

For mode == "pptx":
  Input:
    {
      mode: "pptx",
      prompt: str,
      cookies: { CAZ, CAU, CUI, cf_clearance, ... legacy mirrors },
      headers: { authz, brand, active_user, build_sha },
      seed_design: { A, B, C, D, I },
      slide_count: int (1-50, default 5),
      format: "pptx"|"pdf"|"mp4" (default "pptx"),
      request_id?: str,
      dedupe_key?: str,
      save_local?: bool (default false)
    }
  Output (success):
    { ok: true, design_id, design_url, title, slide_count, download_url,
      s3_expires_at, local_path?, format, credits_used: 2 }
  Output (error):
    { ok: false, error: <code>, details: <msg> }
    error codes: quota_exceeded | auth_expired | cf_blocked |
                 seed_design_invalid | slide_cap_exceeded |
                 timeout | api_error | aborted

Requires: curl_cffi (for TLS fingerprint impersonation)
"""
import base64
import json
import os
import re
import signal
import sys
import time
import uuid
from urllib.parse import urlparse, parse_qs

CANVA_BASE = "https://www.canva.com"
POLL_INTERVAL = 3  # seconds
IMPERSONATE = "chrome131"
PPTX_IMPERSONATE = "chrome120"  # validated for PPTX pipeline
MAX_SLIDES = 50
ALLOWED_FORMATS = ("pptx", "pdf", "mp4")
FORMAT_OUTPUT_SPEC = {"pptx": "PPTX", "pdf": "PDF_STD", "mp4": "MP4"}
FORMAT_EXT = {"pptx": "pptx", "pdf": "pdf", "mp4": "mp4"}


def _mask_token(s, n=4):
    """Mask a sensitive string for stderr debug logging.

    Mirrors the behavior of canva-utils.ts maskToken: short strings collapse to
    "***" so we never leak the full value. Longer strings show only the
    head/tail.
    """
    if not isinstance(s, str) or not s:
        return "***"
    if len(s) <= n * 2:
        return "***"
    return s[:n] + "..." + s[-n:]


def _dbg(msg):
    """Stderr debug log. Stdout is reserved for the final JSON line."""
    try:
        sys.stderr.write(msg + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def _emit(result):
    """Emit a single JSON line to stdout and flush."""
    sys.stdout.write(json.dumps(result) + "\n")
    sys.stdout.flush()

# Aspect ratio codes for Canva Magic Media (g.A field).
# Discovered empirically by probing different g.A values.
ASPECT_RATIOS = {
    "1:1":   "A",  # 1200x1200 - Square
    "16:9":  "B",  # 1600x912  - Landscape
    "5:4":   "C",  # 1344x1088 - Landscape
    "4:3":   "D",  # 1392x1040 - Landscape
    "2:1":   "E",  # 1712x864  - Cinematic
    "9:16":  "F",  # 912x1600  - Portrait
    "4:5":   "G",  # 1088x1344 - Portrait
    "3:4":   "H",  # 1040x1392 - Portrait
}
DEFAULT_ASPECT = "1:1"


def build_session(cookies: dict):
    """Create a curl_cffi session with Chrome TLS impersonation and Canva cookies."""
    from curl_cffi import requests

    session = requests.Session(impersonate=IMPERSONATE)

    # Set cookies from all_cookies if available, otherwise individual fields
    all_cookies = {}
    if cookies.get("all_cookies"):
        try:
            all_cookies = json.loads(cookies["all_cookies"]) if isinstance(cookies["all_cookies"], str) else cookies["all_cookies"]
        except (json.JSONDecodeError, TypeError):
            pass

    for name, value in all_cookies.items():
        session.cookies.set(name, str(value), domain=".canva.com")

    # Always set core cookies explicitly (override if present)
    if cookies.get("caz"):
        session.cookies.set("CAZ", cookies["caz"], domain=".canva.com")
    if cookies.get("cb"):
        session.cookies.set("CB", cookies["cb"], domain=".canva.com")
    if cookies.get("cau"):
        session.cookies.set("CAU", cookies["cau"], domain=".canva.com")

    return session


def build_headers(cookies: dict) -> dict:
    """Build Canva API headers."""
    return {
        "Origin": CANVA_BASE,
        "Referer": f"{CANVA_BASE}/",
        "Content-Type": "application/json;charset=UTF-8",
        "x-canva-brand": cookies.get("cb", ""),
        "x-canva-locale": "id-ID",
        "x-canva-accept-prefix": "no-prefix",
        "x-canva-active-user": cookies.get("cau", ""),
        "x-canva-authz": cookies.get("caz", ""),
        "x-canva-user": cookies.get("user_id", ""),
        "x-canva-request": "ingredientgeneration",
        "x-canva-app": "editor",
    }


def generate_media(cookies: dict, prompt: str, mode: str = "image", timeout: int = 90, count: int = 1, aspect: str = DEFAULT_ASPECT) -> dict:
    """Generate image or video via Canva's ingredientgeneration API."""
    session = build_session(cookies)
    headers = build_headers(cookies)

    if not cookies.get("caz"):
        return {"ok": False, "error": "missing caz cookie"}

    # Determine media type
    media_type = "MAGIC_MEDIA" if mode == "image" else "MAGIC_MEDIA_VIDEO"
    aspect_code = ASPECT_RATIOS.get(aspect, ASPECT_RATIOS[DEFAULT_ASPECT])

    # Build request body
    # Always use batch mode (A?=O) for images — single mode (A?=F) generates
    # URLs without .png extension that often return 403
    if mode == "image":
        body = {
            "a": "B",
            "b": {"A": media_type},
            "A?": "O",
            "f": prompt,
            "g": {"A?": "A", "A": aspect_code},
            "k": min(count, 4),
            "BB": False,
        }
    else:
        body = {
            "a": "B",
            "b": {"A": media_type},
            "A?": "F",
            "A": prompt,
            "BB": False,
        }

    try:
        resp = session.post(f"{CANVA_BASE}/_ajax/ingredientgeneration", headers=headers, json=body)
    except Exception as e:
        return {"ok": False, "error": f"request failed: {e}"}

    if resp.status_code == 403:
        return {"ok": False, "error": "forbidden - cookies expired or invalid"}
    if resp.status_code == 429:
        return {"ok": False, "error": "rate limited / quota exhausted", "quota_exhausted": True}
    if resp.status_code != 200:
        return {"ok": False, "error": f"create job failed: HTTP {resp.status_code} {resp.text[:200]}"}

    data = resp.json()
    job_id = data.get("A", "")
    if not job_id:
        return {"ok": False, "error": f"no job_id in response: {resp.text[:200]}"}

    # Poll for completion
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(POLL_INTERVAL)

        try:
            r = session.get(f"{CANVA_BASE}/_ajax/ingredientgeneration?jobId={job_id}", headers=headers)
        except Exception:
            continue

        if r.status_code != 200:
            continue

        d = r.json()
        state = d.get("B", "")

        if state == "C":  # Done
            # Canva changed response structure: results moved from F.g to F.f
            # F.f contains dicts with B=url, G=thumbnail, J=width, K=height
            # F.g now contains plain media ID strings (not URLs)
            f_block = d.get("F", {})
            results = f_block.get("f", []) or f_block.get("g", [])
            if not results:
                return {"ok": False, "error": "generation completed but no results"}

            # Normalize: F.f items use J/K for dimensions, F.g items use I/H
            normalized = []
            for item in results:
                if isinstance(item, dict):
                    normalized.append({
                        "B": item.get("B", ""),
                        "G": item.get("G", ""),
                        "width": item.get("J") or item.get("I"),
                        "height": item.get("K") or item.get("H"),
                    })
                elif isinstance(item, str) and item.startswith("http"):
                    normalized.append({"B": item, "G": "", "width": None, "height": None})
                else:
                    continue

            if not normalized:
                return {"ok": False, "error": "generation completed but no usable results"}

            # Single result
            if len(normalized) == 1:
                item = normalized[0]
                return {
                    "ok": True,
                    "media_url": item["B"],
                    "thumbnail_url": item["G"],
                    "width": item["width"],
                    "height": item["height"],
                    "mode": mode,
                    "count": 1,
                }

            # Multiple results
            images = []
            for item in normalized:
                images.append({
                    "url": item["B"],
                    "thumbnail": item["G"],
                    "width": item["width"],
                    "height": item["height"],
                })
            return {
                "ok": True,
                "images": images,
                "media_url": images[0]["url"] if images else "",
                "thumbnail_url": images[0]["thumbnail"] if images else "",
                "mode": mode,
                "count": len(images),
            }

        if state == "E":  # Error
            return {"ok": False, "error": "generation failed (state=E)"}

        # state == "B" means still processing, continue polling

    return {"ok": False, "error": f"timeout after {timeout}s (state={state})"}


def fetch_quota(cookies: dict) -> dict:
    """Fetch Canva quota usage."""
    session = build_session(cookies)
    headers = build_headers(cookies)
    headers["x-canva-request"] = "getquota"

    cb = cookies.get("cb", "")
    user_id = cookies.get("user_id", "")

    try:
        resp = session.post(
            f"{CANVA_BASE}/_ajax/quota/quota/get",
            headers=headers,
            json={"A": "C", "B": cb, "C": user_id},
        )
    except Exception as e:
        return {"ok": False, "error": f"quota request failed: {e}"}

    if resp.status_code != 200:
        return {"ok": False, "error": f"quota HTTP {resp.status_code}"}

    q = resp.json().get("A", {})
    raw_used = q.get("C")
    raw_limit = q.get("D")

    if isinstance(raw_used, (int, float)) and isinstance(raw_limit, (int, float)) and raw_limit > 0:
        return {
            "ok": True,
            "quota_used": int(raw_used),
            "quota_limit": int(raw_limit),
            "quota_remaining": int(raw_limit) - int(raw_used),
        }

    return {"ok": False, "error": "could not parse quota response"}


# ─────────────────────────────────────────────────────────────────────────────
# PPTX pipeline (mode == "pptx")
#
# Translated 1:1 from C:/Users/Nazril/AppData/Local/Temp/opencode/test_canva_full_pptx.py
# (37s validated end-to-end). Differences from blueprint:
#   - inputs come from stdin JSON (cookies/headers/seed_design) instead of HAR file
#   - outputs go to stdout JSON (single line) instead of print()
#   - all sensitive logging passes through _mask_token
#   - structure leaves abort hooks for T7 (CHECK_ABORT between steps)
# ─────────────────────────────────────────────────────────────────────────────


# ─── Abort / progress / dedupe state (T7) ───────────────────────────────────
# Module-level flags so the SIGTERM/SIGINT handler can flip them without having
# to thread arguments through every pipeline call site.
_aborted = False
_active_session = None      # set in run_pptx_pipeline so the abort path can close it
_credits_committed = False  # flipped to True after step 4 (materialize_design)


def _install_signal_handlers():
    """Register SIGTERM (and SIGINT for dev) → set the global _aborted flag.

    The Bun parent sends SIGTERM when the user cancels a pptx job; we flip
    the flag and let the next `_check_abort(phase)` call surface it as a
    PipelineError("aborted", phase). We don't exit from the handler itself
    because we want the orchestrator's cleanup path (close session + emit
    final JSON) to run.
    """
    def _handler(signum, _frame):
        global _aborted
        _aborted = True
        # Best-effort breadcrumb to stderr (avoid stdout — reserved for final JSON).
        try:
            sys.stderr.write(f"[pptx] received signal {signum}, marking abort\n")
            sys.stderr.flush()
        except Exception:
            pass

    try:
        signal.signal(signal.SIGTERM, _handler)
    except Exception:
        # SIGTERM may be unavailable on some platforms (e.g. constrained Windows).
        pass
    try:
        signal.signal(signal.SIGINT, _handler)
    except Exception:
        pass


def _emit_progress(phase: str, progress: float, message: str):
    """Emit one NDJSON progress event to STDERR (one line, flushed).

    Stdout is reserved for the single final JSON; progress lives on stderr so
    parents can stream a progress bar without colliding with the final result.
    """
    try:
        line = json.dumps({"phase": phase, "progress": progress, "message": message})
        sys.stderr.write(line + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def _check_abort(phase: str = "unknown"):
    """If a SIGTERM/SIGINT was received, raise PipelineError("aborted", phase).

    Replaces T6's inert hook. Call sites already expect a truthy return → raise
    pattern: we keep that working by raising directly here so existing
    `if _check_abort(): raise PipelineError("aborted", ...)` blocks still
    short-circuit cleanly (the inner raise becomes unreachable, which is fine).
    Accepts an optional phase string so the final error JSON can report which
    phase we bailed in.
    """
    if _aborted:
        raise PipelineError("aborted", phase)
    return False


def _dedupe_lock_path(dedupe_key: str) -> str:
    """Return the absolute(ish) path for a dedupe lock file."""
    return os.path.join("data", "canva", "dedupe", f"{dedupe_key}.lock")


def _check_dedupe(dedupe_key: str, request_id: str):
    """Acquire-or-fail on a dedupe lock file.

    Returns:
      - ("acquired", lock_path) when we wrote/overwrote the lock and own it.
      - ("duplicate", existing_request_id) when a fresh (<60s) lock already exists.
      - ("skipped", None) when dedupe_key is missing/empty.

    Stale locks (>5min) cleaned by future sweep job (out of scope T7).
    """
    if not dedupe_key:
        return ("skipped", None)
    lock_dir = os.path.join("data", "canva", "dedupe")
    try:
        os.makedirs(lock_dir, exist_ok=True)
    except Exception:
        # If we can't even create the dir, skip dedupe rather than crash.
        return ("skipped", None)

    lock_path = _dedupe_lock_path(dedupe_key)
    now = int(time.time())
    if os.path.exists(lock_path):
        try:
            with open(lock_path, "r", encoding="utf-8") as f:
                existing = json.load(f)
            started_at = int(existing.get("started_at") or 0)
            existing_req = str(existing.get("request_id") or "")
        except Exception:
            existing = {}
            started_at = 0
            existing_req = ""
        # Fresh lock (<60s) → caller must report duplicate.
        if started_at and (now - started_at) < 60:
            return ("duplicate", existing_req)
        # Otherwise treat as stale and overwrite.

    try:
        with open(lock_path, "w", encoding="utf-8") as f:
            json.dump({"request_id": request_id or "", "started_at": now}, f)
    except Exception:
        # If we can't write the lock, skip dedupe — better to run than to fail.
        return ("skipped", None)
    return ("acquired", lock_path)


def _release_dedupe(lock_path):
    """Best-effort delete of a previously-acquired lock file."""
    if not lock_path:
        return
    try:
        os.remove(lock_path)
    except Exception:
        pass


class PipelineError(Exception):
    """Carries (error_code, details) for the orchestrator to translate to JSON."""

    def __init__(self, code, details):
        super().__init__(f"{code}: {details}")
        self.code = code
        self.details = details


def _pptx_pick_cookie(cookies, *names):
    """Read a cookie by canonical name, falling back to legacy lowercase mirrors.

    Mirrors getCookieValue from canva.ts: CAZ→caz, CAU→cau, CUI→user_id.
    """
    for n in names:
        v = cookies.get(n)
        if v:
            return v
    return None


def _pptx_build_session(cookies):
    """Create a curl_cffi session with chrome120 impersonation and Canva cookies.

    This is intentionally separate from build_session() above which targets
    chrome131 for the legacy image/video flow.
    """
    from curl_cffi import requests as _r

    s = _r.Session(impersonate=PPTX_IMPERSONATE)

    # Real UPPERCASE cookie names (with lowercase fallback for legacy accounts)
    caz = _pptx_pick_cookie(cookies, "CAZ", "caz")
    cau = _pptx_pick_cookie(cookies, "CAU", "cau")
    cui = _pptx_pick_cookie(cookies, "CUI", "user_id")
    cf_clearance = _pptx_pick_cookie(cookies, "cf_clearance")

    if caz:
        s.cookies.set("CAZ", caz, domain=".canva.com")
    if cau:
        s.cookies.set("CAU", cau, domain=".canva.com")
    if cui:
        s.cookies.set("CUI", cui, domain=".canva.com")
    if cf_clearance:
        s.cookies.set("cf_clearance", cf_clearance, domain=".canva.com")

    # Also flush any all_cookies blob (legacy accounts may rely on auxiliary
    # cookies like CB / CL / CS that aren't in the typed shape).
    raw = cookies.get("all_cookies")
    if raw:
        try:
            blob = json.loads(raw) if isinstance(raw, str) else raw
            if isinstance(blob, dict):
                for k, v in blob.items():
                    if k not in ("CAZ", "CAU", "CUI", "cf_clearance"):
                        try:
                            s.cookies.set(k, str(v), domain=".canva.com")
                        except Exception:
                            pass
        except Exception:
            pass

    return s


def _pptx_build_base_headers(headers, cookies):
    """Build the static header block reused across every PPTX request.

    Per-call headers add `X-Canva-Request: <op>` (and Content-Type for POSTs).
    """
    import base64 as _b64, json as _json
    authz = headers.get("authz") or ""
    brand = headers.get("brand") or _pptx_pick_cookie(cookies, "cb") or ""
    active_user = headers.get("active_user") or _pptx_pick_cookie(cookies, "cau") or ""
    build_sha = headers.get("build_sha") or ""

    # X-Canva-User must be the REAL user id (e.g. "UAHMiq51djY"), not the
    # CUI session cookie. Canva returns 403 on /_ajax/* endpoints if these
    # don't match. The real user_id is base64-decoded from active_user/CAU
    # under the "A" key. Fall back to cookies["user_id"] only as last resort
    # (legacy accounts that pre-date this fix may still have CUI in user_id).
    real_user_id = ""
    if active_user:
        try:
            decoded = _json.loads(_b64.b64decode(active_user + "==").decode("utf-8"))
            if isinstance(decoded, dict) and isinstance(decoded.get("A"), str):
                real_user_id = decoded["A"]
        except Exception:
            real_user_id = ""
    if not real_user_id:
        # Legacy fallback: only accept user_id if it looks like a real id (UA…/UB… 11-12 chars)
        legacy = cookies.get("user_id") or ""
        if legacy and len(legacy) <= 16 and legacy.startswith(("UA", "UB")):
            real_user_id = legacy

    h = {
        "Origin": CANVA_BASE,
        "Referer": f"{CANVA_BASE}/",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
        "X-Canva-Authz": authz,
        "X-Canva-Brand": brand,
        "X-Canva-Active-User": active_user,
    }
    if real_user_id:
        h["X-Canva-User"] = real_user_id
    if build_sha:
        h["X-Canva-Build-Sha"] = build_sha
    return h


def _pptx_h(base, op, ct=None):
    """Add the per-call X-Canva-Request op (and optional Content-Type)."""
    h = dict(base)
    h["X-Canva-Request"] = op
    if ct:
        h["Content-Type"] = ct
    return h


def _classify_http_error(resp, body_snippet=""):
    """Translate an HTTP response into a PipelineError code per spec.

    Cloudflare detection: status 403 with CF body markers, status 503 with
    cf-mitigated header, or __cf_chl_* cookies in response.
    """
    status = getattr(resp, "status_code", 0)
    headers = getattr(resp, "headers", {}) or {}
    cookies = getattr(resp, "cookies", None)

    cf_mitigated = False
    try:
        if any(k.lower() == "cf-mitigated" for k in (headers.keys() if hasattr(headers, "keys") else [])):
            cf_mitigated = True
    except Exception:
        pass

    cf_cookie_marker = False
    try:
        for c in (cookies or []):
            name = getattr(c, "name", str(c))
            if name and name.startswith("__cf_chl_"):
                cf_cookie_marker = True
                break
    except Exception:
        pass

    cf_body_marker = False
    if isinstance(body_snippet, str) and body_snippet:
        low = body_snippet.lower()
        if (
            "challenge-platform" in low
            or "cf-mitigated" in low
            or "attention required" in low
            or "cf_chl_" in low
            or "__cf_bm" in low
        ):
            cf_body_marker = True

    if (status == 403 and cf_body_marker) or (status == 503 and cf_mitigated) or cf_cookie_marker:
        return PipelineError("cf_blocked", f"Cloudflare challenge (HTTP {status})")

    if status in (401, 403):
        return PipelineError("auth_expired", f"HTTP {status}")
    if status == 402:
        return PipelineError("quota_exceeded", "HTTP 402")

    if isinstance(body_snippet, str) and "quota" in body_snippet.lower() and "exceed" in body_snippet.lower():
        return PipelineError("quota_exceeded", body_snippet[:200])

    return PipelineError("api_error", f"HTTP {status}: {body_snippet[:200]}")


def _request(session, method, url, headers, *, json_body=None, timeout=30, op="<op>"):
    """Wrap session.request with timeout/network → PipelineError translation.

    On HTTP non-2xx, raises PipelineError via _classify_http_error.
    """
    try:
        if method == "GET":
            resp = session.get(url, headers=headers, timeout=timeout)
        else:
            data = json.dumps(json_body) if json_body is not None else None
            resp = session.post(url, headers=headers, data=data, timeout=timeout)
    except Exception as e:
        msg = str(e).lower()
        if "timeout" in msg or "timed out" in msg:
            raise PipelineError("timeout", f"{op}: {e}") from e
        raise PipelineError("api_error", f"{op} request failed: {e}") from e
    return resp


# ─── Step 1 ──────────────────────────────────────────────────────────────────


def create_thread(session, base_headers, prompt, seed_design):
    """Step 1: POST /_ajax/assistant/threads → return threadId.

    Body shape per test_canva_full_pptx.py (validated 37s blueprint).
    """
    h = _pptx_h(base_headers, "createthread", "application/json;charset=UTF-8")
    body = {
        "A": str(uuid.uuid4()),
        "B": [{"A?": "A", "A": prompt}],
        "C": str(uuid.uuid4()),
        "D": {
            "A": seed_design,
            "D": "Q",  # mode: remix-from-existing (suggestDesigns_noPlanning)
            "G": {"A?": "A", "K": 1},
        },
        "E": True,
        "A?": "G",
    }
    resp = _request(
        session,
        "POST",
        f"{CANVA_BASE}/_ajax/assistant/threads",
        h,
        json_body=body,
        timeout=30,
        op="create_thread",
    )
    if resp.status_code != 200:
        raise _classify_http_error(resp, getattr(resp, "text", "") or "")
    try:
        data = resp.json()
    except Exception as e:
        raise PipelineError("api_error", f"create_thread non-JSON: {e}")
    thread_id = data.get("A")
    if not thread_id:
        raise PipelineError("api_error", "create_thread: no threadId in response")
    _dbg(f"[pptx] step1 thread_id={_mask_token(str(thread_id), 6)}")
    return thread_id


# ─── Step 2 ──────────────────────────────────────────────────────────────────


def _extract_results_token(body_text):
    """Find the design-generation results token in a thread response body.

    The token is a base64 blob that decodes to a dict whose key set is the
    9-key shape {A,B,F,H,C,J,E,D,I}. test_canva_full_pptx.py checks for the
    looser set {A,B} ∪ {F|C|H} but the spec calls for the full 9-key shape so
    we accept either: prefer 9-key, fall back to looser shape.
    """
    if not isinstance(body_text, str):
        return None
    candidates = re.findall(r'"(eyJ[A-Za-z0-9+/=]{30,})"', body_text)
    nine_key = {"A", "B", "F", "H", "C", "J", "E", "D", "I"}
    fallback = None
    for c in candidates:
        try:
            padded = c + "=" * ((4 - len(c) % 4) % 4)
            decoded = json.loads(base64.b64decode(padded).decode("utf-8"))
            if not isinstance(decoded, dict):
                continue
            keys = set(decoded.keys())
            if keys == nine_key:
                return c
            if "A" in keys and "B" in keys and ({"F", "C", "H"} & keys):
                fallback = fallback or c
        except Exception:
            continue
    return fallback


def poll_thread_for_results_token(session, base_headers, thread_id, max_seconds=15):
    """Step 2: GET thread until response carries a design-results token.

    Poll interval 1s. Timeout → PipelineError("timeout", "thread results token").
    """
    h = _pptx_h(base_headers, "getthread")
    url = f"{CANVA_BASE}/_ajax/assistant/threads/{thread_id}"
    deadline = time.time() + max_seconds
    poll_n = 0
    while time.time() < deadline:
        _check_abort("outline_wait")
        poll_n += 1
        try:
            resp = session.get(url, headers=h, timeout=20)
        except Exception:
            time.sleep(1)
            continue
        if resp.status_code == 200:
            tok = _extract_results_token(getattr(resp, "text", "") or "")
            if tok:
                _dbg(f"[pptx] step2 results_token={_mask_token(tok, 6)} polls={poll_n}")
                return tok
        elif resp.status_code in (401, 403, 402, 503):
            raise _classify_http_error(resp, getattr(resp, "text", "") or "")
        time.sleep(1)
    raise PipelineError("timeout", "thread results token")


# ─── Step 3 ──────────────────────────────────────────────────────────────────


def poll_design_results(session, base_headers, results_token, max_seconds=120):
    """Step 3: GET designgeneration/getResults until A?=='F' (finished).

    Poll interval 2s. Returns dict with design_gen_id/design_spec/page_count/title.
    """
    h = _pptx_h(base_headers, "getdesigngenerationresults")
    url = f"{CANVA_BASE}/_ajax/designgeneration/getResults?resultsToken={results_token}"
    deadline = time.time() + max_seconds
    poll_n = 0
    while time.time() < deadline:
        _check_abort("design_render")
        poll_n += 1
        try:
            resp = session.get(url, headers=h, timeout=20)
        except Exception:
            time.sleep(2)
            continue
        if resp.status_code != 200:
            if resp.status_code in (401, 403, 402, 503):
                raise _classify_http_error(resp, getattr(resp, "text", "") or "")
            time.sleep(2)
            continue
        try:
            data = resp.json()
        except Exception:
            time.sleep(2)
            continue
        status_a = data.get("A?")
        if status_a == "E":
            raise PipelineError("api_error", "design generation failed")
        if status_a == "F":
            m_arr = data.get("M") or []
            m0 = m_arr[0] if m_arr else {}
            design_gen_id = m0.get("A")
            design_spec = m0.get("C")
            if not design_spec:
                raise PipelineError("api_error", "design generation failed")
            pages = design_spec.get("A") or []
            page_count = len(pages)
            title = design_spec.get("D") or "untitled"
            _dbg(
                f"[pptx] step3 design_gen_id={_mask_token(str(design_gen_id), 6)} "
                f"pages={page_count} polls={poll_n}"
            )
            return {
                "design_gen_id": design_gen_id,
                "design_spec": design_spec,
                "page_count": page_count,
                "title": title,
            }
        time.sleep(2)
    raise PipelineError("timeout", "design results")


# ─── Step 4 ──────────────────────────────────────────────────────────────────


def materialize_design(session, base_headers, design_gen_id, design_spec):
    """Step 4: POST /_ajax/design → return design_id, extension, title."""
    h = _pptx_h(base_headers, "createdesign", "application/json;charset=UTF-8")
    body = {"I": design_gen_id, "A?": "k", "n": design_spec}
    resp = _request(
        session,
        "POST",
        f"{CANVA_BASE}/_ajax/design",
        h,
        json_body=body,
        timeout=60,
        op="materialize_design",
    )
    if resp.status_code != 200:
        raise _classify_http_error(resp, getattr(resp, "text", "") or "")
    try:
        data = resp.json()
    except Exception as e:
        raise PipelineError("api_error", f"materialize_design non-JSON: {e}")
    a_block = data.get("A") or {}
    design_id = a_block.get("A") if isinstance(a_block, dict) else None
    extension = data.get("D")
    title = data.get("C") or "untitled"
    if not design_id or not extension:
        raise PipelineError("api_error", "materialize_design: missing design_id or extension")
    _dbg(f"[pptx] step4 design_id={_mask_token(str(design_id), 6)}")
    return {"design_id": design_id, "extension": extension, "title": title}


# ─── Step 5 ──────────────────────────────────────────────────────────────────


def create_export(session, base_headers, design_id, extension, page_count, fmt):
    """Step 5: POST /_ajax/export?version=2&inline=false → return exportId.

    fmt is the user-facing format ("pptx"|"pdf"|"mp4"); the API needs the
    canonical outputSpec name from FORMAT_OUTPUT_SPEC.
    """
    output_spec = FORMAT_OUTPUT_SPEC.get(fmt)
    if not output_spec:
        raise PipelineError("api_error", f"unsupported format: {fmt}")

    h = _pptx_h(base_headers, "createexport2api", "application/json;charset=UTF-8")
    pages = list(range(1, page_count + 1))
    body = {
        "priority": "HIGH",
        "renderSpec": {
            "content": {
                "type": "DOCUMENT_REFERENCE",
                "id": design_id,
                "version": 1,
                "prefetch": True,
                "extension": extension,
            },
            "mediaQuality": "PRINT",
            "mediaDpi": 96,
            "preferWatermarkedMedia": True,
            "pages": pages,
        },
        "outputSpecs": [
            {
                "destination": {"type": "DOWNLOAD"},
                "pages": pages,
                "type": output_spec,
            }
        ],
        "pollable": True,
        "useSkiaRenderer": True,
    }
    resp = _request(
        session,
        "POST",
        f"{CANVA_BASE}/_ajax/export?version=2&inline=false",
        h,
        json_body=body,
        timeout=30,
        op="create_export",
    )
    if resp.status_code != 200:
        raise _classify_http_error(resp, getattr(resp, "text", "") or "")
    try:
        data = resp.json()
    except Exception as e:
        raise PipelineError("api_error", f"create_export non-JSON: {e}")
    export_id = (data.get("export") or {}).get("exportIdentifier")
    if not export_id:
        raise PipelineError("api_error", "create_export: no exportIdentifier")
    _dbg(f"[pptx] step5 export_id={_mask_token(str(export_id), 6)}")
    return export_id


# ─── Step 6 ──────────────────────────────────────────────────────────────────


def _parse_s3_expires(url):
    """Parse the unix expiry timestamp from a presigned S3 URL's `Expires` query.

    Falls back to now+3600 when absent or unparseable.
    """
    try:
        q = parse_qs(urlparse(url).query)
        v = q.get("Expires") or q.get("X-Amz-Expires")
        if v:
            n = int(v[0])
            # X-Amz-Expires is a duration in seconds, not an absolute timestamp.
            # Real Canva URLs use 'Expires' as absolute unix; if number is
            # smaller than now, treat it as a duration delta.
            now = int(time.time())
            if n < now:
                return now + n
            return n
    except Exception:
        pass
    return int(time.time()) + 3600


def poll_export(session, base_headers, export_id, max_seconds=60):
    """Step 6: GET /_ajax/export/{id} until output.exportBlobs[0].url is set.

    Poll interval 1s. Returns {download_url, title, s3_expires_at}.
    """
    h = _pptx_h(base_headers, "getexport2api")
    url = f"{CANVA_BASE}/_ajax/export/{export_id}"
    deadline = time.time() + max_seconds
    poll_n = 0
    while time.time() < deadline:
        _check_abort("export")
        poll_n += 1
        try:
            resp = session.get(url, headers=h, timeout=20)
        except Exception:
            time.sleep(1)
            continue
        if resp.status_code != 200:
            if resp.status_code in (401, 403, 402, 503):
                raise _classify_http_error(resp, getattr(resp, "text", "") or "")
            time.sleep(1)
            continue
        try:
            data = resp.json()
        except Exception:
            time.sleep(1)
            continue
        exp = data.get("export") or {}
        output = exp.get("output") or {}
        blobs = output.get("exportBlobs") or []
        if blobs and blobs[0].get("url"):
            download_url = blobs[0]["url"]
            title = output.get("title") or "untitled"
            s3_expires_at = _parse_s3_expires(download_url)
            _dbg(f"[pptx] step6 download_url={_mask_token(download_url, 8)} polls={poll_n}")
            return {
                "download_url": download_url,
                "title": title,
                "s3_expires_at": s3_expires_at,
            }
        time.sleep(1)
    raise PipelineError("timeout", "export download url")


# ─── Step 7 ──────────────────────────────────────────────────────────────────


def record_usage(session, base_headers, design_id):
    """Step 7: POST /_ajax/publish/usage?record. Best-effort — log + continue."""
    h = _pptx_h(base_headers, "recordusageapi", "application/json;charset=UTF-8")
    body = {"usageEvents": [{"A": design_id, "A?": "I", "J": "DOWNLOAD"}]}
    try:
        resp = session.post(
            f"{CANVA_BASE}/_ajax/publish/usage?record",
            headers=h,
            data=json.dumps(body),
            timeout=15,
        )
    except Exception as e:
        _dbg(f"[pptx] step7 record_usage failed (best-effort): {e}")
        return False
    if resp.status_code != 200:
        snippet = getattr(resp, "text", "") or ""
        _dbg(
            f"[pptx] step7 record_usage non-200 status={resp.status_code} "
            f"body={_mask_token(snippet[:200], 8)}"
        )
        return False
    return True


# ─── Step 8 ──────────────────────────────────────────────────────────────────


def download_local(session, url, design_id, fmt, account_id):
    """Step 8 (optional): stream-download the export to data/pptx/{account_id}/{design_id}.{ext}.

    account_id may be 0/empty if the worker wasn't told (defaults to "_").
    """
    ext = FORMAT_EXT.get(fmt, fmt)
    acct = str(account_id) if account_id else "_"
    out_dir = os.path.join("data", "pptx", acct)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{design_id}.{ext}")
    try:
        resp = session.get(url, timeout=120)
    except Exception as e:
        raise PipelineError("api_error", f"download_local fetch failed: {e}")
    if resp.status_code != 200:
        raise PipelineError(
            "api_error", f"download_local HTTP {resp.status_code}"
        )
    try:
        with open(out_path, "wb") as f:
            f.write(resp.content)
    except Exception as e:
        raise PipelineError("api_error", f"download_local write failed: {e}")
    _dbg(f"[pptx] step8 saved local_path={out_path} bytes={len(resp.content)}")
    return out_path


# ─── Re-export helper (T12) ──────────────────────────────────────────────────


def fetch_design_meta(session, base_headers, design_id):
    """T12: GET /_ajax/design/{design_id} → return {extension, page_count, title}.

    Used by the `skip_to_export` shortcut when the caller does not have the
    extension token cached. Mirrors materialize_design's response shape:
      data["D"]      -> extension
      data["A"]["A"] -> design_id (echo)
      data["C"]      -> title
      data["B"]      -> page list (best-effort; may be absent)
    Title and page_count are best-effort: the caller already passes
    slide_count from the stored row, so missing fields just fall through.
    """
    h = _pptx_h(base_headers, "getdesign", None)
    resp = _request(
        session,
        "GET",
        f"{CANVA_BASE}/_ajax/design/{design_id}",
        h,
        timeout=30,
        op="fetch_design_meta",
    )
    if resp.status_code != 200:
        raise _classify_http_error(resp, getattr(resp, "text", "") or "")
    try:
        data = resp.json()
    except Exception as e:
        raise PipelineError("api_error", f"fetch_design_meta non-JSON: {e}")
    extension = data.get("D")
    title = data.get("C") or "untitled"
    pages_raw = data.get("B")
    page_count = None
    if isinstance(pages_raw, list):
        page_count = len(pages_raw) or None
    if not extension:
        raise PipelineError("api_error", "fetch_design_meta: missing extension")
    _dbg(f"[pptx] reexport fetched extension={_mask_token(str(extension), 6)} title={title}")
    return {"extension": extension, "title": title, "page_count": page_count}


# ─── Orchestrator ────────────────────────────────────────────────────────────


def run_pptx_pipeline(stdin):
    """Execute the 8-step pipeline. Returns the final result dict.

    Pre-pipeline validation (no network):
      - slide_count in 1..50  → slide_cap_exceeded
      - format in ALLOWED_FORMATS → api_error("unsupported format")
      - prompt non-empty       → api_error
      - seed_design has all 5 keys → seed_design_invalid
      - cookies has CAZ        → auth_expired

    T12 shortcut: if stdin has `skip_to_export: true`, skip steps 1-4 and run
    only the export-tail (steps 5-8) using stdin-provided design_id /
    extension / slide_count / format. Required additional fields:
      - design_id   (from the stored row's design_url)
      - slide_count (used as page_count)
      - format      (pptx | pdf | mp4)
      - extension   (Canva export token; if absent the worker fetches it
                     inline via GET /_ajax/design/{design_id})
    `seed_design`, `prompt`, `dedupe_key` are NOT required in skip mode.
    """
    skip_to_export = bool(stdin.get("skip_to_export", False))

    if skip_to_export:
        return _run_pptx_reexport(stdin)

    prompt = stdin.get("prompt") or ""
    cookies = stdin.get("cookies") or {}
    headers = stdin.get("headers") or {}
    seed_design = stdin.get("seed_design") or {}
    slide_count = stdin.get("slide_count", 5)
    fmt = stdin.get("format", "pptx")
    save_local = bool(stdin.get("save_local", False))
    account_id = stdin.get("account_id") or stdin.get("accountId")

    # Validate slide_count
    if (
        not isinstance(slide_count, int)
        or isinstance(slide_count, bool)
        or slide_count < 1
        or slide_count > MAX_SLIDES
    ):
        return {
            "ok": False,
            "error": "slide_cap_exceeded",
            "details": "slide_count must be 1-50",
        }

    # Validate format
    if fmt not in ALLOWED_FORMATS:
        return {
            "ok": False,
            "error": "api_error",
            "details": "unsupported format",
        }

    if not prompt or not isinstance(prompt, str):
        return {"ok": False, "error": "api_error", "details": "prompt is required"}

    # Validate seed_design (5 required keys A,B,C,D,I)
    required_seed_keys = ("A", "B", "C", "D", "I")
    if not isinstance(seed_design, dict) or any(k not in seed_design for k in required_seed_keys):
        return {
            "ok": False,
            "error": "seed_design_invalid",
            "details": "seed_design must include A,B,C,D,I",
        }

    # Auth presence
    caz = _pptx_pick_cookie(cookies, "CAZ", "caz")
    if not caz:
        return {
            "ok": False,
            "error": "auth_expired",
            "details": "missing CAZ cookie",
        }
    if not headers.get("authz"):
        return {
            "ok": False,
            "error": "auth_expired",
            "details": "missing authz header",
        }

    # ─── Dedupe (T7) ─────────────────────────────────────────────────────────
    # Placed AFTER pre-validation so we don't take a lock on invalid input.
    dedupe_key = stdin.get("dedupe_key") or ""
    request_id = stdin.get("request_id") or ""
    dedupe_status, dedupe_info = _check_dedupe(dedupe_key, request_id)
    if dedupe_status == "duplicate":
        # Don't release the lock — the in-flight request still owns it.
        return {
            "ok": False,
            "error": "duplicate",
            "existing_request": dedupe_info or "",
        }
    lock_path = dedupe_info if dedupe_status == "acquired" else None

    # ─── Build session (tracked globally so the abort handler can close it) ──
    global _active_session, _credits_committed
    try:
        session = _pptx_build_session(cookies)
    except Exception as e:
        _release_dedupe(lock_path)
        return {"ok": False, "error": "api_error", "details": f"session build failed: {e}"}
    _active_session = session
    _credits_committed = False
    base_headers = _pptx_build_base_headers(headers, cookies)

    try:
        # Step 1
        _emit_progress("thread_create", 0.05, "Creating Canva thread...")
        thread_id = create_thread(session, base_headers, prompt, seed_design)
        _check_abort("thread_create")

        # Step 2
        _emit_progress("outline_wait", 0.10, "Waiting for AI to plan slides...")
        results_token = poll_thread_for_results_token(session, base_headers, thread_id, max_seconds=15)
        _check_abort("outline_wait")

        # Step 3
        _emit_progress("design_render", 0.40, f"Rendering {slide_count} slides...")
        gen = poll_design_results(session, base_headers, results_token, max_seconds=120)
        design_gen_id = gen["design_gen_id"]
        design_spec = gen["design_spec"]
        page_count = gen["page_count"]
        title_initial = gen["title"]
        _check_abort("design_render")

        # Step 4 — once this returns, Canva has spent the 2 credits.
        _emit_progress("materialize", 0.85, "Saving design to workspace...")
        mat = materialize_design(session, base_headers, design_gen_id, design_spec)
        design_id = mat["design_id"]
        extension = mat["extension"]
        title = mat.get("title") or title_initial
        _credits_committed = True
        _check_abort("materialize")

        # Step 5
        _emit_progress("export", 0.92, f"Exporting to {fmt.lower()}...")
        export_id = create_export(session, base_headers, design_id, extension, page_count, fmt)
        _check_abort("export")

        # Step 6
        _emit_progress("download", 0.98, "Downloading file...")
        exp_info = poll_export(session, base_headers, export_id, max_seconds=60)
        download_url = exp_info["download_url"]
        s3_expires_at = exp_info["s3_expires_at"]
        if exp_info.get("title"):
            title = exp_info["title"]
        _check_abort("download")

        # Step 7 — best-effort
        record_usage(session, base_headers, design_id)

        # Step 8 — optional local save (re-emit download phase if we hit the local-save path)
        local_path = None
        if save_local:
            _emit_progress("download", 0.98, "Downloading file...")
            try:
                local_path = download_local(session, download_url, design_id, fmt, account_id)
            except PipelineError as pe:
                _dbg(f"[pptx] step8 download_local failed: {pe.code}: {pe.details}")
                # Per spec: success of pipeline does not depend on local save.
                local_path = None

        _emit_progress("done", 1.0, "Complete")
        result = {
            "ok": True,
            "design_id": design_id,
            "design_url": f"https://canva.com/design/{design_id}/edit",
            "title": title,
            "slide_count": page_count,
            "download_url": download_url,
            "s3_expires_at": s3_expires_at,
            "format": fmt,
            "credits_used": 2,
        }
        if local_path:
            result["local_path"] = local_path
        _release_dedupe(lock_path)
        return result

    except PipelineError as pe:
        # Best-effort cleanup: drop the curl_cffi session before returning so we
        # don't leave sockets dangling when the parent reaps us on abort.
        if pe.code == "aborted":
            try:
                session.close()
            except Exception:
                pass
            _release_dedupe(lock_path)
            return {
                "ok": False,
                "error": "aborted",
                "phase": pe.details or "unknown",
                "credits_committed": _credits_committed,
            }
        _release_dedupe(lock_path)
        return {"ok": False, "error": pe.code, "details": pe.details}
    except Exception as e:
        _release_dedupe(lock_path)
        return {"ok": False, "error": "api_error", "details": f"unexpected: {e}"}
    finally:
        _active_session = None


def _run_pptx_reexport(stdin):
    """T12: skip-to-export shortcut. Runs steps 5-8 only.

    Required stdin fields:
      design_id, slide_count, format, cookies, headers
    Optional:
      extension   — if missing, fetched inline via GET /_ajax/design/{id}
      save_local  — defaults to False
      account_id  — used only by step 8 download path
      request_id  — for progress/diagnostics
    """
    cookies = stdin.get("cookies") or {}
    headers = stdin.get("headers") or {}
    design_id = stdin.get("design_id")
    extension = stdin.get("extension")
    slide_count = stdin.get("slide_count")
    fmt = stdin.get("format")
    save_local = bool(stdin.get("save_local", False))
    account_id = stdin.get("account_id") or stdin.get("accountId")

    # Pre-export validation (matches T12 spec error contract).
    missing = []
    if not design_id:
        missing.append("design_id")
    if not slide_count:
        missing.append("slide_count")
    if not fmt:
        missing.append("format")
    if missing or extension == "" or (extension is not None and not isinstance(extension, str)):
        # `extension` is allowed to be omitted (worker will fetch it), but if
        # provided as a non-string falsy/typed-wrong value, treat as missing.
        if extension == "" or (extension is not None and not isinstance(extension, str)):
            missing.append("extension")
    if missing:
        return {
            "ok": False,
            "error": "api_error",
            "details": "skip_to_export requires design_id+extension+slide_count+format",
        }

    # Validate slide_count and format (same rules as full pipeline).
    if (
        not isinstance(slide_count, int)
        or isinstance(slide_count, bool)
        or slide_count < 1
        or slide_count > MAX_SLIDES
    ):
        return {
            "ok": False,
            "error": "slide_cap_exceeded",
            "details": "slide_count must be 1-50",
        }
    if fmt not in ALLOWED_FORMATS:
        return {
            "ok": False,
            "error": "api_error",
            "details": "unsupported format",
        }

    # Auth presence — same fail-fast as full pipeline.
    caz = _pptx_pick_cookie(cookies, "CAZ", "caz")
    if not caz:
        return {
            "ok": False,
            "error": "auth_expired",
            "details": "missing CAZ cookie",
        }
    if not headers.get("authz"):
        return {
            "ok": False,
            "error": "auth_expired",
            "details": "missing authz header",
        }

    global _active_session, _credits_committed
    try:
        session = _pptx_build_session(cookies)
    except Exception as e:
        return {"ok": False, "error": "api_error", "details": f"session build failed: {e}"}
    _active_session = session
    # Re-export charges 1 credit; mark committed once create_export returns.
    _credits_committed = False
    base_headers = _pptx_build_base_headers(headers, cookies)

    try:
        # Optional: fetch extension inline if not provided.
        if not extension:
            _emit_progress("export", 0.10, "Fetching design metadata...")
            meta = fetch_design_meta(session, base_headers, design_id)
            extension = meta["extension"]
            _check_abort("fetch_design_meta")

        page_count = int(slide_count)
        title = "untitled"

        # Step 5
        _emit_progress("export", 0.30, f"Re-exporting to {fmt.lower()}...")
        export_id = create_export(session, base_headers, design_id, extension, page_count, fmt)
        _credits_committed = True
        _check_abort("export")

        # Step 6
        _emit_progress("download", 0.70, "Downloading file...")
        exp_info = poll_export(session, base_headers, export_id, max_seconds=60)
        download_url = exp_info["download_url"]
        s3_expires_at = exp_info["s3_expires_at"]
        if exp_info.get("title"):
            title = exp_info["title"]
        _check_abort("download")

        # Step 7 — best-effort
        record_usage(session, base_headers, design_id)

        # Step 8 — optional local save
        local_path = None
        if save_local:
            _emit_progress("download", 0.95, "Saving local copy...")
            try:
                local_path = download_local(session, download_url, design_id, fmt, account_id)
            except PipelineError as pe:
                _dbg(f"[pptx] reexport step8 download_local failed: {pe.code}: {pe.details}")
                local_path = None

        _emit_progress("done", 1.0, "Complete")
        result = {
            "ok": True,
            "design_id": design_id,
            "design_url": f"https://canva.com/design/{design_id}/edit",
            "title": title,
            "slide_count": page_count,
            "download_url": download_url,
            "s3_expires_at": s3_expires_at,
            "format": fmt,
            "credits_used": 1,
        }
        if local_path:
            result["local_path"] = local_path
        return result

    except PipelineError as pe:
        if pe.code == "aborted":
            try:
                session.close()
            except Exception:
                pass
            return {
                "ok": False,
                "error": "aborted",
                "phase": pe.details or "unknown",
                "credits_committed": _credits_committed,
            }
        return {"ok": False, "error": pe.code, "details": pe.details}
    except Exception as e:
        return {"ok": False, "error": "api_error", "details": f"unexpected: {e}"}
    finally:
        _active_session = None


def main():
    """Read input from stdin, execute, write output to stdout."""
    try:
        input_data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, EOFError) as e:
        _emit({"ok": False, "error": f"invalid input: {e}"})
        sys.exit(1)

    mode = input_data.get("mode", "image")
    cookies = input_data.get("cookies", {})
    prompt = input_data.get("prompt", "")
    timeout = input_data.get("timeout", 90)
    count = input_data.get("count", 1)
    aspect = input_data.get("aspect", DEFAULT_ASPECT)

    if mode == "quota":
        result = fetch_quota(cookies)
    elif mode in ("image", "video"):
        if not prompt:
            result = {"ok": False, "error": "prompt is required"}
        else:
            result = generate_media(cookies, prompt, mode, timeout, count, aspect)
    elif mode == "pptx":
        # Install SIGTERM/SIGINT handlers only for pptx — image/video flows are
        # short-lived and don't need the global abort plumbing.
        _install_signal_handlers()
        result = run_pptx_pipeline(input_data)
    else:
        result = {"ok": False, "error": f"unknown mode: {mode}"}

    _emit(result)
    # Aborted pptx runs exit 0 — Bun parent expects clean shutdown, not a crash.
    if not result.get("ok") and result.get("error") == "aborted":
        sys.exit(0)
    sys.exit(0 if result.get("ok") else 1)


if __name__ == "__main__":
    main()

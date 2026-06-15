from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import secrets
import string
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from app.errors.codes import ErrorCode
from app.errors.exceptions import NonRetryableBatcherError, RetryableBatcherError
from app.providers.base import NormalizedAccount, ProviderAdapter
from app.providers.kiro import (
    _fill_google_email_step,
    _fill_google_password_step,
    _handle_google_gaplustos,
    _handle_google_consent_continue,
    _detect_google_blocking_challenge,
    _is_email_step,
    _is_password_step,
    _click_continue_button,
)

_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

CANVA_HOME_URL = "https://www.canva.com"
CANVA_LOGIN_URL = "https://www.canva.com/login"
CANVA_QUOTA_URL = "https://www.canva.com/_ajax/quota/quota/get"

# NDJSON event names emitted to stdout by this provider (consumed by src/auth/runner.ts)
EVT_STARTED = "started"
EVT_LOGGED_IN = "logged_in"
EVT_TOKENS_CAPTURED = "tokens_captured"
EVT_SEED_DESIGN_CAPTURED = "seed_design_captured"
EVT_COMPLETE = "complete"
EVT_ERROR = "error"


# --------------------------------------------------------------------------- #
# NDJSON helpers
# --------------------------------------------------------------------------- #

def _emit(event: str, **fields: Any) -> None:
    """Emit a single NDJSON line to stdout. One JSON object per line, flushed."""
    payload: dict[str, Any] = {"event": event}
    payload.update(fields)
    try:
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    except BrokenPipeError:
        pass


def _mask(value: str | None, keep: int = 4) -> str:
    """Mask token values. Keeps first/last `keep` chars + ellipsis."""
    if not value:
        return ""
    if len(value) <= keep * 2:
        return "*" * len(value)
    return f"{value[:keep]}...{value[-keep:]}"


def _mask_tokens(tokens: dict[str, Any]) -> dict[str, Any]:
    """Return a shallow-masked summary of tokens for safe logging."""
    masked: dict[str, Any] = {}
    for k, v in tokens.items():
        if isinstance(v, str):
            masked[k] = _mask(v)
        elif isinstance(v, dict):
            # seed_design and similar - keep keys but mask string leaves
            masked[k] = {ik: _mask(iv) if isinstance(iv, str) else iv for ik, iv in v.items()}
        else:
            masked[k] = v
    return masked


# --------------------------------------------------------------------------- #
# Captcha detection
# --------------------------------------------------------------------------- #

_CAPTCHA_NEEDLES = (
    "captcha",
    "are you a robot",
    "verify you are human",
    "press and hold",
    "challenge-platform",  # Cloudflare Turnstile
    "h-captcha",
    "g-recaptcha",
)


async def _detect_captcha(page: Any) -> str | None:
    """Return a short reason if the page is currently showing a captcha, else None."""
    try:
        body_text = await page.evaluate(
            "() => (document.body && document.body.innerText || '').toLowerCase()"
        )
    except Exception:
        return None
    for needle in _CAPTCHA_NEEDLES:
        if needle in body_text:
            return f"captcha challenge detected: '{needle}'"
    try:
        # Iframe-based captchas
        frames = page.frames
    except Exception:
        frames = []
    for fr in frames:
        try:
            url = (fr.url or "").lower()
        except Exception:
            continue
        if "hcaptcha.com" in url or "recaptcha" in url or "challenges.cloudflare.com" in url:
            return f"captcha iframe detected: {url[:80]}"
    return None


# --------------------------------------------------------------------------- #
# Header capture
# --------------------------------------------------------------------------- #

_HEADER_KEYS = {
    "x-canva-authz": "authz",
    "x-canva-brand": "brand",
    "x-canva-active-user": "active_user",
    "x-canva-build-sha": "build_sha",
}


def _install_ajax_header_listener(page: Any, captured: dict[str, str]) -> None:
    """
    Wire a request listener to the page that grabs X-Canva-* headers from the
    first /_ajax/* request seen. Mutates `captured` in place.
    """

    def _on_request(request: Any) -> None:
        try:
            url = request.url
        except Exception:
            return
        if "/_ajax/" not in url:
            return
        try:
            headers = request.headers or {}
        except Exception:
            return
        # Headers in Playwright/Camoufox are already lower-cased keys
        for hk, target in _HEADER_KEYS.items():
            if target in captured and captured[target]:
                continue
            val = headers.get(hk) or headers.get(hk.title())
            if val:
                captured[target] = val

    page.on("request", _on_request)


# --------------------------------------------------------------------------- #
# Seed design capture
# --------------------------------------------------------------------------- #

# Canva design URL pattern (stable since 2022):
#   https://www.canva.com/design/<designId>/<extension>/edit
#   designId examples: DAFxxxxxxxx, DAHxxxxxxxx
_DESIGN_URL_RE = re.compile(
    r"https?://www\.canva\.com/design/(?P<id>[A-Za-z0-9_-]+)/(?P<ext>[A-Za-z0-9_-]+)"
)


# Default presentation template observed in production HAR (HTTPToolkit_2026-06-14_17-51).
# Used by the assistant/threads endpoint when seeding a remix-from-existing PPTX flow.
_DEFAULT_PRESENTATION_TEMPLATE = "tAExRLg81RI"

# Doctype echo for blank presentation creation (HAR-validated).
_PRESENTATION_DOCTYPE = "TACQ-gtv2Yk"


def _gen_page_id() -> str:
    """Generate a 16-char alnum pageId (matches Canva's observed 'a' field)."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(16))


async def _list_virtual_folder_via_page(
    page: Any,
    tokens: dict[str, Any],
) -> dict[str, str] | None:
    """
    Call POST /_ajax/vfolders/listvirtualfolder via the authenticated page to
    list the user's existing designs. Returns seed_design dict from the first
    presentation found, or None.

    Body shape (HAR-validated):
      {"A": "<brand>", "B": "<user>", "G": 25, "A?": "U"}
    """
    brand = tokens.get("brand", "") or ""
    authz = tokens.get("authz", "") or ""
    active_user = tokens.get("active_user", "") or ""
    build_sha = tokens.get("build_sha", "") or "dc26b9b"

    # Real user ID lives inside the base64-encoded active_user (or CAU cookie):
    #   {"A":"<userId>","B":"<brand>"}
    # The CUI cookie is a SESSION identifier, NOT the user ID — passing it as
    # user causes /_ajax/* endpoints to return 403.
    user_id = ""
    cau_or_active = active_user or tokens.get("CAU", "") or tokens.get("cau", "") or ""
    if cau_or_active:
        try:
            decoded = json.loads(base64.b64decode(cau_or_active + "=="))
            if isinstance(decoded, dict):
                u = decoded.get("A")
                if isinstance(u, str) and u:
                    user_id = u
        except Exception:
            pass

    if not (brand and user_id):
        sys.stderr.write(
            f"[canva][seed-http] listvfolder missing brand/user: "
            f"brand={'Y' if brand else 'N'} user_id={'Y' if user_id else 'N'}\n"
        )
        sys.stderr.flush()
        return None
    # Note: do NOT manually inject X-Canva-Authz/Brand/Active-User from outside
    # the SPA — Canva's bundle injects fresher per-request values internally and
    # ours can be stale. Just send the bare minimum (Content-Type) and let the
    # browser's cookie jar carry auth state.
    try:
        result = await page.evaluate(
            """async ({brand, user}) => {
                try {
                    const r = await fetch('/_ajax/vfolders/listvirtualfolder', {
                        method: 'POST',
                        credentials: 'include',
                        headers: {'Content-Type': 'application/json;charset=UTF-8'},
                        body: JSON.stringify({A: brand, B: user, G: 25, 'A?': 'U'}),
                    });
                    return {status: r.status, body: await r.text()};
                } catch (e) {
                    return {status: -1, body: String(e)};
                }
            }""",
            {"brand": brand, "user": user_id},
        )
    except Exception as exc:
        sys.stderr.write(f"[canva][seed-http] listvfolder evaluate failed: {exc}\n")
        sys.stderr.flush()
        return None
    if not isinstance(result, dict):
        return None
    status = int(result.get("status") or 0)
    body = str(result.get("body") or "")
    sys.stderr.write(
        f"[canva][seed-http] listvfolder status={status} body_len={len(body)} "
        f"body_repr={body[:400]!r}\n"
    )
    sys.stderr.flush()
    if status != 200:
        return None
    # Strip Canva's anti-XSSI JSON prefix if present.
    cleaned = body
    for prefix in (")]}',\n", ")]}'", "'\")]}while(1);</x>//"):
        if cleaned.startswith(prefix):
            cleaned = cleaned[len(prefix):]
            break
    # Some responses use a parametric while-loop guard; strip up to first '{' or '['.
    if cleaned and cleaned[0] not in "{[":
        idx_brace = cleaned.find("{")
        idx_brack = cleaned.find("[")
        candidates = [i for i in (idx_brace, idx_brack) if i >= 0]
        if candidates:
            cleaned = cleaned[min(candidates):]
    try:
        data = json.loads(cleaned)
    except Exception as exc:
        sys.stderr.write(f"[canva][seed-http] listvfolder parse failed: {exc} cleaned[:200]={cleaned[:200]}\n")
        sys.stderr.flush()
        return None
    items = data.get("A") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return None
    # Find the first presentation: docType.id:TACQ-gtv2Yk
    for it in items:
        if not isinstance(it, dict):
            continue
        L = it.get("L") or {}
        draft = (L.get("draft") or {}).get("content") or {}
        doctype = (draft.get("doctype") or {}).get("id") or ""
        if doctype != _PRESENTATION_DOCTYPE:
            continue
        design_id = it.get("B") or L.get("id") or ""
        version = L.get("version")
        extension = (L.get("extensions") or {}).get("default") or L.get("extension") or ""
        pages = draft.get("pages") or []
        page_id = ""
        if isinstance(pages, list) and pages:
            first = pages[0] if isinstance(pages[0], dict) else {}
            page_id = first.get("id") or ""
        if design_id and extension and page_id:
            return {
                "A": str(design_id),
                "B": str(version if version is not None else 1),
                "C": str(extension),
                "D": str(page_id),
                "I": _DEFAULT_PRESENTATION_TEMPLATE,
            }
    return None


async def _bootstrap_seed_design_http(
    tokens: dict[str, Any],
    page: Any | None = None,
) -> dict[str, str] | None:
    """
    Capture seed_design via authenticated HTTP calls. Two-phase strategy:
      1. List user's existing presentations via /_ajax/vfolders/listvirtualfolder.
         If at least one exists, extract seed_design from the first one — this
         is the cheap path and matches what the production browser flow does.
      2. Fallback: POST /_ajax/design to mint a new blank presentation.

    When `page` is provided, requests are dispatched FROM the page context
    so the browser's authenticated cookie jar + Cloudflare clearance state
    ride along automatically. Falls back to curl_cffi for the design POST
    if the page strategy fails.

    Returns a seed_design dict {A, B, C, D, I} on success, or None on failure.
    Failures are logged to stderr; never raises.
    """
    sys.stderr.write("[canva][seed-http] step=1 build_request\n")
    sys.stderr.flush()

    # Phase 1: try to grab seed_design from user's existing designs (cheap path).
    if page is not None:
        # Make sure we're on canva.com origin before calling fetch — otherwise
        # CORS/credentials policies block /_ajax/* calls.
        try:
            cur_url = page.url
            if "canva.com" not in (cur_url or ""):
                sys.stderr.write(f"[canva][seed-http] page on {cur_url}; navigating to canva.com\n")
                sys.stderr.flush()
                await page.goto("https://www.canva.com/", wait_until="domcontentloaded", timeout=15000)
                await asyncio.sleep(1)
            else:
                sys.stderr.write(f"[canva][seed-http] page on {cur_url}\n")
                sys.stderr.flush()
        except Exception as exc:
            sys.stderr.write(f"[canva][seed-http] page.url check failed: {exc}\n")
            sys.stderr.flush()

        # Diagnostic: probe quota endpoint with NO custom headers — same shape
        # the original tokens-capture code uses; this should always succeed
        # for an authenticated page.
        try:
            quota_diag = await page.evaluate(
                """async () => {
                    try {
                        const r = await fetch('/_ajax/quota/quota/get', {
                            method: 'POST', credentials: 'include',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({A:'C'})
                        });
                        return {status: r.status, body: (await r.text()).slice(0, 200)};
                    } catch (e) { return {status: -1, body: String(e)}; }
                }"""
            )
            sys.stderr.write(f"[canva][seed-http] quota probe: {quota_diag}\n")
            sys.stderr.flush()
        except Exception as exc:
            sys.stderr.write(f"[canva][seed-http] quota probe failed: {exc}\n")
            sys.stderr.flush()
        try:
            existing = await _list_virtual_folder_via_page(page, tokens)
        except Exception as exc:
            sys.stderr.write(f"[canva][seed-http] listvfolder unexpected: {exc}\n")
            sys.stderr.flush()
            existing = None
        if existing:
            sys.stderr.write(
                f"[canva][seed-http] step=1.OK from existing design "
                f"A={_mask(existing['A'])} B={existing['B']} C={_mask(existing['C'])} "
                f"D={_mask(existing['D'])} I={existing['I']}\n"
            )
            sys.stderr.flush()
            return existing
        sys.stderr.write(
            "[canva][seed-http] no existing presentations; will try mint via /_ajax/design\n"
        )
        sys.stderr.flush()

    # Required token fields
    authz = tokens.get("authz", "") or ""
    brand = tokens.get("brand", "") or ""
    active_user = tokens.get("active_user", "") or ""
    build_sha = tokens.get("build_sha", "") or "dc26b9b"

    # Decode real user ID from active_user (or CAU); the CUI cookie is a
    # session id, not a user id, so don't fall back to it for X-Canva-User.
    user_id = ""
    cau_or_active = active_user or tokens.get("CAU", "") or tokens.get("cau", "") or ""
    if cau_or_active:
        try:
            decoded = json.loads(base64.b64decode(cau_or_active + "=="))
            if isinstance(decoded, dict):
                u = decoded.get("A")
                if isinstance(u, str) and u:
                    user_id = u
        except Exception:
            pass

    caz = tokens.get("CAZ", "") or ""
    cau = tokens.get("CAU", "") or ""
    cui = tokens.get("CUI", "") or ""
    cf_clearance = tokens.get("cf_clearance", "") or ""

    if not (authz and brand and active_user and caz):
        sys.stderr.write(
            f"[canva][seed-http] missing required tokens: "
            f"authz={'Y' if authz else 'N'} brand={'Y' if brand else 'N'} "
            f"active_user={'Y' if active_user else 'N'} CAZ={'Y' if caz else 'N'}\n"
        )
        sys.stderr.flush()
        return None

    request_id = f"dg-{uuid.uuid4()}-Eseed"
    page_id = _gen_page_id()

    body = {
        "I": request_id,
        "A?": "k",
        "n": {
            "B": {"A?": "A", "A": _PRESENTATION_DOCTYPE, "B": 1},
            "C": {"A": 1920, "B": 1080, "C": "D"},
            "P": "id-ID",
            "D": "Untitled Presentation",
            "A": [
                {
                    "a": page_id,
                    "A?": "i",
                    "C": {"A": 1920, "B": 1080, "C": "D"},
                    "G": {"A": request_id},
                }
            ],
        },
    }

    cookies: dict[str, str] = {}
    # Prefer the full all_cookies blob captured during login (contains CPA, ASI,
    # __cf_bm, _cfuvid, etc. — Cloudflare bot-management cookies that the
    # /_ajax/design endpoint requires alongside CAZ).
    all_cookies_blob = tokens.get("all_cookies")
    if isinstance(all_cookies_blob, str) and all_cookies_blob:
        try:
            parsed = json.loads(all_cookies_blob)
            if isinstance(parsed, dict):
                for ck, cv in parsed.items():
                    if isinstance(ck, str) and isinstance(cv, str) and cv:
                        cookies[ck] = cv
        except Exception:
            pass

    # Top-level token fields override / fill in if all_cookies missing keys.
    if caz and "CAZ" not in cookies:
        cookies["CAZ"] = caz
    if cau and "CAU" not in cookies:
        cookies["CAU"] = cau
    if cui and "CUI" not in cookies:
        cookies["CUI"] = cui
    if cf_clearance and "cf_clearance" not in cookies:
        cookies["cf_clearance"] = cf_clearance
    for opt in ("CB", "CL", "CS", "CDI", "CID", "CUL"):
        v = tokens.get(opt) or tokens.get(opt.lower())
        if v and opt not in cookies:
            cookies[opt] = v

    sys.stderr.write(
        f"[canva][seed-http] cookie_count={len(cookies)} names={sorted(cookies.keys())}\n"
    )
    sys.stderr.flush()

    # Browser fingerprint headers (Cloudflare/Canva enforce these on /_ajax/design).
    headers = {
        "Accept": "*/*",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Content-Type": "application/json;charset=UTF-8",
        "Origin": "https://www.canva.com",
        "Referer": "https://www.canva.com/",
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/149.0.0.0 Safari/537.36"
        ),
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        "sec-ch-ua": '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "X-Canva-Accept-Prefix": "no-prefix",
        "X-Canva-Active-User": active_user,
        "X-Canva-App": "home",
        "X-Canva-Authz": authz,
        "X-Canva-Brand": brand,
        "X-Canva-Build-Sha": build_sha,
        "X-Canva-Locale": "id-ID",
        "X-Canva-Request": "createdesign",
    }
    if user_id:
        headers["X-Canva-User"] = user_id

    # X-Canva-Analytics is derived from the ASI cookie (analytics session id).
    asi = cookies.get("ASI")
    if isinstance(asi, str) and asi:
        # Canva packs ASI into a tagged binary envelope (HAR-validated):
        #   \x00\x04 \x00\x03 'WEB' \x00\x01 \x00<len> <asi-bytes>
        try:
            asi_bytes = asi.encode("ascii")
            envelope = (
                b"\x00\x04\x00\x03WEB\x00\x01"
                + bytes([0x00, len(asi_bytes) & 0xFF])
                + asi_bytes
            )
            headers["X-Canva-Analytics"] = base64.b64encode(envelope).decode("ascii")
        except Exception:
            pass

    sys.stderr.write(
        f"[canva][seed-http] step=2 send url=/_ajax/design "
        f"req_id={_mask(request_id)} page_id={_mask(page_id)} "
        f"authz={_mask(authz)} brand={_mask(brand)}\n"
    )
    sys.stderr.flush()

    status = 0
    body_text = ""

    # Strategy 1: dispatch via the authenticated browser page (preferred).
    # This uses the page's cookie jar + Cloudflare clearance state directly,
    # bypassing fingerprint-based 403s that hit pure curl_cffi calls.
    if page is not None:
        try:
            # Headers we still want explicitly set (X-Canva-* + content-type).
            # Other browser fingerprint headers are auto-injected by Camoufox.
            page_headers = {
                k: v
                for k, v in headers.items()
                if k.lower().startswith("x-canva-")
                or k.lower() in ("content-type", "accept")
            }
            sys.stderr.write("[canva][seed-http] step=2a try via page.evaluate(fetch)\n")
            sys.stderr.flush()
            page_result = await page.evaluate(
                """async ({url, body, headers}) => {
                    try {
                        const r = await fetch(url, {
                            method: 'POST',
                            credentials: 'include',
                            headers,
                            body: JSON.stringify(body),
                        });
                        const txt = await r.text();
                        return {status: r.status, body: txt};
                    } catch (e) {
                        return {status: -1, body: String(e)};
                    }
                }""",
                {
                    "url": "https://www.canva.com/_ajax/design",
                    "body": body,
                    "headers": page_headers,
                },
            )
            if isinstance(page_result, dict):
                status = int(page_result.get("status") or 0)
                body_text = str(page_result.get("body") or "")
                sys.stderr.write(
                    f"[canva][seed-http] step=2a page.evaluate status={status} body_len={len(body_text)}\n"
                )
                sys.stderr.flush()
        except Exception as exc:
            sys.stderr.write(
                f"[canva][seed-http] step=2a page.evaluate FAILED: {type(exc).__name__}: {exc}\n"
            )
            sys.stderr.flush()
            status = 0

    # Strategy 2: fallback to curl_cffi if no page or page strategy returned non-200.
    if status != 200:
        try:
            from curl_cffi import requests as _curl_requests  # type: ignore
        except Exception as exc:
            sys.stderr.write(f"[canva][seed-http] curl_cffi import failed: {exc}\n")
            sys.stderr.flush()
            return None

        sys.stderr.write("[canva][seed-http] step=2b try via curl_cffi.post\n")
        sys.stderr.flush()
        try:
            resp = _curl_requests.post(
                "https://www.canva.com/_ajax/design",
                headers=headers,
                cookies=cookies,
                json=body,
                impersonate="chrome131",
                timeout=30,
            )
            status = getattr(resp, "status_code", 0)
            try:
                body_text = resp.text or ""
            except Exception:
                body_text = ""
        except Exception as exc:
            sys.stderr.write(f"[canva][seed-http] step=2b SEND FAILED: {type(exc).__name__}: {exc}\n")
            sys.stderr.flush()
            return None

    sys.stderr.write(f"[canva][seed-http] step=3 response_status={status}\n")
    sys.stderr.flush()

    if status != 200:
        sys.stderr.write(
            f"[canva][seed-http] FAILED status={status} body={body_text[:500]}\n"
        )
        sys.stderr.flush()
        return None

    try:
        data = json.loads(body_text)
    except Exception as exc:
        sys.stderr.write(
            f"[canva][seed-http] step=4 parse FAILED: {type(exc).__name__}: {exc} "
            f"body[:200]={body_text[:200]}\n"
        )
        sys.stderr.flush()
        return None

    a_block = data.get("A") if isinstance(data, dict) else None
    if not isinstance(a_block, dict):
        sys.stderr.write(
            f"[canva][seed-http] step=4 missing A block; keys={list(data.keys()) if isinstance(data, dict) else type(data)}\n"
        )
        sys.stderr.flush()
        return None

    design_id = a_block.get("A")
    version = a_block.get("B")
    extension = data.get("D")

    if not (isinstance(design_id, str) and design_id and isinstance(extension, str) and extension):
        sys.stderr.write(
            f"[canva][seed-http] step=4 incomplete fields: "
            f"design_id={_mask(str(design_id))} version={version} ext={_mask(str(extension))}\n"
        )
        sys.stderr.flush()
        return None

    seed: dict[str, str] = {
        "A": design_id,
        "B": str(version if version is not None else 0),
        "C": extension,
        "D": page_id,
        "I": _DEFAULT_PRESENTATION_TEMPLATE,
    }

    sys.stderr.write(
        f"[canva][seed-http] step=5 OK A={_mask(seed['A'])} B={seed['B']} "
        f"C={_mask(seed['C'])} D={_mask(seed['D'])} I={seed['I']}\n"
    )
    sys.stderr.flush()
    return seed


async def _capture_seed_design_browser(page: Any, timeout_s: float = 25.0) -> dict[str, str] | None:
    """
    Browser-based fallback for seed_design capture (kept as backup path).

    Strategy:
      1. Open https://www.canva.com/create/presentations/ — this redirects to a
         freshly-minted presentation editor with a /design/<id>/<ext>/ URL.
      2. Read the resulting URL → A=designId, C=extension.
      3. Listen for the first design API response to extract B=version, D=pageId,
         I=templateId.
    Returns None if anything fails (seed_design is optional in the token shape).
    """
    seed: dict[str, str] = {}
    api_payload: dict[str, Any] | None = None
    # Capture design_id from any response body or URL (the editor often renders
    # before the address bar settles to /design/<id>/<ext>/).
    captured_id: str | None = None
    captured_ext: str | None = None

    async def _on_response(resp: Any) -> None:
        nonlocal api_payload, captured_id, captured_ext
        try:
            url = resp.url
        except Exception:
            return
        # Probe URL for /design/<id>/<ext>/ first — even a redirect chain
        # leaves the canonical path here.
        m = _DESIGN_URL_RE.search(url or "")
        if m and not captured_id:
            captured_id = m.group("id")
            captured_ext = m.group("ext")
            sys.stderr.write(f"[canva][seed] resp URL match: id={captured_id} ext={captured_ext}\n"); sys.stderr.flush()
        if api_payload is not None:
            return
        if "/_ajax/" not in url and "/api/" not in url:
            return
        if not any(tok in url for tok in ("design", "/edit/", "openDoc", "loadDoc", "presentation")):
            return
        try:
            data = await resp.json()
        except Exception:
            return
        if isinstance(data, dict):
            api_payload = data
            sys.stderr.write(f"[canva][seed] api_payload from {url[-80:]} keys={list(data.keys())[:8]}\n"); sys.stderr.flush()
            # Some responses carry designId / id at top level.
            if not captured_id:
                did = data.get("designId") or data.get("design_id") or data.get("A")
                if isinstance(did, str) and len(did) >= 6:
                    captured_id = did
                    sys.stderr.write(f"[canva][seed] api_payload designId={captured_id}\n"); sys.stderr.flush()

    page.on("response", _on_response)
    try:
        # Canva treats /create/presentations/ as a landing page (no auto-create).
        # The URL that *does* auto-mint a blank presentation editor is:
        #   /design?create&type=presentation
        # which redirects to /design/<id>/<ext>/edit once the design row is created.
        # We try this URL first; if it doesn't yield a design URL within the
        # window, we fall back to clicking the in-page "Create blank" button.
        seed_url = "https://www.canva.com/design?create&type=presentation"
        sys.stderr.write(f"[canva][seed] goto {seed_url}\n"); sys.stderr.flush()
        try:
            await page.goto(
                seed_url,
                wait_until="domcontentloaded",
                timeout=int(timeout_s * 1000),
            )
            try:
                landed = page.url
            except Exception:
                landed = "<unknown>"
            sys.stderr.write(f"[canva][seed] page.goto OK, landed at: {landed}\n"); sys.stderr.flush()
        except Exception as exc:
            sys.stderr.write(f"[canva][seed] page.goto FAILED: {type(exc).__name__}: {exc}\n"); sys.stderr.flush()
            return None

        # Wait for either (a) the URL to settle into /design/<id>/<ext>/, or
        # (b) the response listener to capture a designId from an API response.
        deadline = time.time() + timeout_s
        match: re.Match[str] | None = None
        last_url = ""
        loops = 0
        while time.time() < deadline:
            try:
                cur = page.url
            except Exception:
                cur = ""
            if cur != last_url:
                sys.stderr.write(f"[canva][seed] url tick {loops}: {cur}\n"); sys.stderr.flush()
                last_url = cur
            match = _DESIGN_URL_RE.search(cur or "")
            if match:
                sys.stderr.write(f"[canva][seed] URL matched design pattern after {loops} ticks\n"); sys.stderr.flush()
                break
            if captured_id:
                sys.stderr.write(f"[canva][seed] response listener captured id={captured_id} — stopping URL wait\n"); sys.stderr.flush()
                break
            loops += 1
            await asyncio.sleep(0.5)

        if match:
            seed["A"] = match.group("id")
            seed["C"] = match.group("ext")
        elif captured_id:
            seed["A"] = captured_id
            seed["C"] = captured_ext or ""
        else:
            sys.stderr.write(f"[canva][seed] timeout {timeout_s}s — final url: {last_url} (no captured_id either)\n"); sys.stderr.flush()
            return None

        # Wait a beat for the first design API response to land
        await asyncio.sleep(3)

        if isinstance(api_payload, dict):
            # Best-effort field discovery — keys vary by Canva rev
            seed["B"] = str(
                api_payload.get("version")
                or api_payload.get("B")
                or api_payload.get("revision")
                or ""
            )
            pages = api_payload.get("pages") or api_payload.get("D") or []
            if isinstance(pages, list) and pages:
                first = pages[0]
                if isinstance(first, dict):
                    seed["D"] = str(first.get("id") or first.get("pageId") or "")
            template = api_payload.get("templateId") or api_payload.get("I") or ""
            if template:
                seed["I"] = str(template)

        # Always include placeholders so the shape is consistent
        seed.setdefault("B", "")
        seed.setdefault("D", "")
        seed.setdefault("I", "")
        return seed
    finally:
        try:
            page.remove_listener("response", _on_response)
        except Exception:
            pass


# --------------------------------------------------------------------------- #
# Persistent profile path
# --------------------------------------------------------------------------- #

def _profile_dir(account_id: str) -> Path:
    """Return data/browsers/canva/{account_id}/ relative to repo root, ensuring it exists."""
    # repo root = three parents up from this file: providers -> app -> auth -> scripts -> repo
    here = Path(__file__).resolve()
    repo_root = here.parents[4]
    profile = repo_root / "data" / "browsers" / "canva" / str(account_id)
    profile.mkdir(parents=True, exist_ok=True)
    return profile


# --------------------------------------------------------------------------- #
# Provider adapter
# --------------------------------------------------------------------------- #

class CanvaProviderAdapter(ProviderAdapter):
    name = "canva"

    async def parse_account(self, raw_line: str) -> NormalizedAccount:
        parts = [p.strip() for p in raw_line.split("|")]
        if len(parts) != 2:
            raise NonRetryableBatcherError(
                ErrorCode.input_invalid_format,
                "canva account must be email|password",
            )
        email, password = parts
        if not email or not password:
            raise NonRetryableBatcherError(
                ErrorCode.input_missing_required_field,
                "canva account requires email and password",
            )
        if not _EMAIL_PATTERN.match(email):
            raise NonRetryableBatcherError(
                ErrorCode.input_invalid_format,
                "canva account email format is invalid",
            )
        return NormalizedAccount(
            provider=self.name, identifier=email, secret=password, raw=raw_line
        )

    async def bootstrap_session(self, account: NormalizedAccount) -> Any:
        """
        Launch Camoufox with a persistent profile under data/browsers/canva/{account_id}/.
        Honors CAMOUFOX_HEADLESS=1 (T4 contract) AND BATCHER_CAMOUFOX_HEADLESS (legacy).
        Emits NDJSON `started` event.
        """
        _emit(EVT_STARTED, provider=self.name, identifier=account.identifier)
        try:
            from browserforge.fingerprints import Screen
            from camoufox.async_api import AsyncCamoufox

            # Two env vars — T4 spec uses CAMOUFOX_HEADLESS, legacy uses BATCHER_CAMOUFOX_HEADLESS.
            headless_env = (
                os.getenv("CAMOUFOX_HEADLESS")
                or os.getenv("BATCHER_CAMOUFOX_HEADLESS")
                or "true"
            )
            headless = headless_env.lower() in ("1", "true", "yes", "on")

            account_id = (
                account.metadata.get("account_id")
                if isinstance(account.metadata, dict)
                else None
            ) or account.identifier
            profile = _profile_dir(account_id)

            camoufox_kwargs: dict[str, Any] = {
                "headless": headless,
                "os": "windows",
                "block_webrtc": True,
                "humanize": False,
                "screen": Screen(max_width=1920, max_height=1080),
                "persistent_context": True,
                "user_data_dir": str(profile),
            }
            proxy_url = os.getenv("BATCHER_PROXY_URL", "")
            if proxy_url:
                from urllib.parse import urlparse
                parsed = urlparse(proxy_url)
                proxy_cfg: dict[str, Any] = {
                    "server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
                }
                if parsed.username:
                    proxy_cfg["username"] = parsed.username
                if parsed.password:
                    proxy_cfg["password"] = parsed.password
                camoufox_kwargs["proxy"] = proxy_cfg
                camoufox_kwargs["geoip"] = True

            manager = AsyncCamoufox(**camoufox_kwargs)
            browser = await manager.__aenter__()
            # In persistent_context mode AsyncCamoufox returns a BrowserContext-like object
            try:
                page = await browser.new_page()
            except AttributeError:
                # Some Camoufox surfaces hand back a Browser; fall back to first context
                ctx = browser.contexts[0] if getattr(browser, "contexts", None) else None
                page = await ctx.new_page() if ctx else await browser.new_page()
            page.set_default_timeout(15000)

            return {
                "manager": manager,
                "browser": browser,
                "page": page,
                "popup": None,
                "cookies": None,
                "captured_headers": {},
                "profile_dir": str(profile),
            }
        except Exception as exc:
            _emit(
                EVT_ERROR,
                code="bootstrap_failed",
                message=str(exc) or "canva camoufox bootstrap failed",
            )
            raise RetryableBatcherError(
                ErrorCode.browser_start_failed,
                str(exc) or "canva camoufox bootstrap failed",
            ) from exc

    async def authenticate(self, account: NormalizedAccount, session: Any) -> dict[str, Any]:
        """
        Navigate to canva.com. If already logged in (cookie CAZ present), skip login.
        Otherwise perform Google OAuth login (existing behavior). Handles CAPTCHA
        detection and emits NDJSON `logged_in` on success.
        """
        if session is None or session.get("stub"):
            return {"authenticated": True}

        page = session["page"]
        captured_headers: dict[str, str] = session.setdefault("captured_headers", {})
        _install_ajax_header_listener(page, captured_headers)

        # Step 1: try the home URL — if already logged in we'll stay on / not get redirected to /login
        try:
            await page.goto(CANVA_HOME_URL, wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(2)
        except Exception:
            pass

        captcha = await _detect_captcha(page)
        if captcha:
            _emit(EVT_ERROR, code="captcha_required", message=captcha)
            raise NonRetryableBatcherError(
                ErrorCode.browser_challenge_blocked,
                f"canva: {captcha}",
            )

        # Already-logged-in fast path: check cookies
        try:
            existing_cookies = await page.context.cookies()
        except Exception:
            existing_cookies = []
        already_logged_in = any(
            c.get("name") == "CAZ" and "canva.com" in c.get("domain", "")
            for c in existing_cookies
        )

        if not already_logged_in:
            await self._login_flow(account, session)

        # Re-check captcha post-login
        captcha = await _detect_captcha(page)
        if captcha:
            _emit(EVT_ERROR, code="captcha_required", message=captcha)
            raise NonRetryableBatcherError(
                ErrorCode.browser_challenge_blocked,
                f"canva: {captcha}",
            )

        # Pull cookies again
        cookies = await page.context.cookies()
        canva_cookies: dict[str, str] = {}
        for c in cookies:
            if "canva.com" in c.get("domain", ""):
                canva_cookies[c["name"]] = c["value"]

        if not canva_cookies.get("CAZ"):
            # try one reload to coax cookies onto disk
            try:
                await page.reload()
                await asyncio.sleep(3)
                cookies = await page.context.cookies()
                for c in cookies:
                    if "canva.com" in c.get("domain", ""):
                        canva_cookies[c["name"]] = c["value"]
            except Exception:
                pass

        if not canva_cookies.get("CAZ"):
            _emit(
                EVT_ERROR,
                code="login_failed",
                message="no CAZ cookie after login flow",
            )
            raise NonRetryableBatcherError(
                ErrorCode.auth_invalid_credentials,
                "canva: login failed — no CAZ cookie after OAuth",
            )

        session["cookies"] = canva_cookies
        _emit(EVT_LOGGED_IN, provider=self.name)

        # Now: trigger an /_ajax/* request so the listener can grab the headers.
        # Hit the quota endpoint via the page (XHR from the canva origin) — guarantees
        # the X-Canva-* headers are emitted by Canva's bundle.
        try:
            await page.evaluate(
                "() => fetch('/_ajax/quota/quota/get', {method:'POST', credentials:'include',"
                "headers:{'Content-Type':'application/json'}, body: JSON.stringify({A:'C'})})"
                ".catch(()=>{})"
            )
            # Give the request listener time to fire
            for _ in range(10):
                if all(captured_headers.get(v) for v in _HEADER_KEYS.values()):
                    break
                await asyncio.sleep(0.5)
        except Exception:
            pass

        return {"authenticated": True, "cookies": canva_cookies}

    async def _login_flow(self, account: NormalizedAccount, session: Any) -> None:
        """The actual Google-OAuth login flow. Only runs if not already logged in."""
        page = session["page"]

        # If we landed on / (logged out) we still need to navigate to /login to get the OAuth button
        try:
            await page.goto(CANVA_LOGIN_URL, wait_until="domcontentloaded", timeout=20000)
            await asyncio.sleep(2)
        except Exception:
            pass

        # Headless mode: do automated Google OAuth.
        # Interactive mode (CAMOUFOX_HEADLESS=0): user can complete login themselves; we
        # just wait for the CAZ cookie to appear.
        headless_env = (
            os.getenv("CAMOUFOX_HEADLESS")
            or os.getenv("BATCHER_CAMOUFOX_HEADLESS")
            or "true"
        )
        headless = headless_env.lower() in ("1", "true", "yes", "on")

        if not headless:
            # Interactive: poll for the CAZ cookie up to ~5 minutes.
            sys.stderr.write(
                "[canva] Interactive mode: please complete login in the opened browser window.\n"
            )
            sys.stderr.flush()
            for _ in range(300):
                try:
                    cookies = await page.context.cookies()
                except Exception:
                    cookies = []
                if any(
                    c.get("name") == "CAZ" and "canva.com" in c.get("domain", "")
                    for c in cookies
                ):
                    return
                await asyncio.sleep(1)
            raise NonRetryableBatcherError(
                ErrorCode.auth_invalid_credentials,
                "canva: interactive login timed out (no CAZ cookie after 5 minutes)",
            )

        # Headless: Google OAuth automation
        async with page.expect_popup() as popup_info:
            await page.evaluate(
                """() => {
                    for (const el of document.querySelectorAll('button, a, div[role="button"]')) {
                        if ((el.textContent||'').toLowerCase().includes('google') && el.offsetParent) {
                            el.click(); return;
                        }
                    }
                }"""
            )
        popup = await popup_info.value
        session["popup"] = popup
        await asyncio.sleep(2)

        if "accounts.google.com" not in popup.url:
            raise RetryableBatcherError(
                ErrorCode.browser_unexpected_state,
                f"canva: expected Google OAuth, got {popup.url[:80]}",
            )

        email_done = False
        password_done = False

        for _ in range(60):
            try:
                current_url = popup.url
            except Exception:
                break

            if "accounts.google.com" not in current_url:
                break

            try:
                if await _handle_google_gaplustos(popup):
                    await asyncio.sleep(0.8)
                    continue

                if await _handle_google_consent_continue(popup):
                    await asyncio.sleep(0.8)
                    continue

                at_email = await _is_email_step(popup)
                at_password = await _is_password_step(popup)

                if at_email and not email_done:
                    if await _fill_google_email_step(popup, account.identifier):
                        email_done = True
                        await asyncio.sleep(1)
                        continue

                if at_password and not password_done:
                    if await _fill_google_password_step(popup, account.secret):
                        password_done = True
                        await asyncio.sleep(1)
                        continue

                if not at_email and not at_password:
                    challenge = await _detect_google_blocking_challenge(popup)
                    if challenge:
                        raise RetryableBatcherError(
                            ErrorCode.browser_challenge_blocked,
                            f"canva: Google challenge detected: {challenge}",
                        )

                await _click_continue_button(popup)
            except RetryableBatcherError:
                raise
            except NonRetryableBatcherError:
                raise
            except Exception:
                break

            await asyncio.sleep(1)

        for _ in range(10):
            try:
                _ = popup.url
                await asyncio.sleep(1)
            except Exception:
                break

        await asyncio.sleep(2)

        # Dismiss "skip onboarding" CTAs if Canva shows them
        try:
            await page.evaluate(
                """() => {
                    for (const el of document.querySelectorAll('button, a, div[role="button"]')) {
                        const txt = (el.textContent || '').toLowerCase().trim();
                        if ((txt.includes('skip') || txt.includes('lewati') || txt.includes('not now') || txt.includes('nanti')) && el.offsetParent !== null) {
                            el.click(); return;
                        }
                    }
                }"""
            )
            await asyncio.sleep(1)
        except Exception:
            pass

    async def fetch_tokens(
        self,
        account: NormalizedAccount,
        auth_state: dict[str, Any],
        session: Any,
    ) -> dict[str, str]:
        """
        Build the full token blob expected by T2's TypeScript provider:
            UPPERCASE cookies CAZ/CAU/CUI, cf_clearance,
            authz/brand/active_user/build_sha (from AJAX headers),
            legacy lowercase mirrors (caz/cau/user_id) for backward-compat,
            optional seed_design{A,B,C,D,I}, captured_at, refresh_count.
        Emits NDJSON `tokens_captured` (masked) and `seed_design_captured`.
        Final unmasked blob is emitted exactly once via `complete` from the
        runner (login.py). This method also writes a `complete` event itself
        for direct CLI usage of this provider script.
        """
        cookies: dict[str, str] = (
            auth_state.get("cookies") or (session or {}).get("cookies") or {}
        )
        if not cookies.get("CAZ"):
            raise NonRetryableBatcherError(
                ErrorCode.provider_unsupported_response,
                "canva: no CAZ cookie",
            )

        # Legacy: derive user_id from CAU base64 payload (used by image/video flow)
        cau = cookies.get("CAU", "")
        legacy_user_id = ""
        try:
            user_info = json.loads(base64.b64decode(cau + "=="))
            legacy_user_id = user_info.get("A", "") or ""
        except Exception:
            pass

        captured_headers: dict[str, str] = (session or {}).get("captured_headers") or {}

        tokens: dict[str, Any] = {
            # UPPERCASE cookie names (T2 contract)
            "CAZ": cookies.get("CAZ", ""),
            "CAU": cookies.get("CAU", ""),
            "CUI": cookies.get("CUI", ""),
            "cf_clearance": cookies.get("cf_clearance", ""),
            # AJAX header tokens (T2 contract)
            "authz": captured_headers.get("authz", ""),
            "brand": captured_headers.get("brand", ""),
            "active_user": captured_headers.get("active_user", ""),
            "build_sha": captured_headers.get("build_sha", ""),
            # Legacy lowercase mirrors (backward compat with image/video flow)
            "caz": cookies.get("CAZ", ""),
            "cau": cau,
            "user_id": cookies.get("CUI", "") or legacy_user_id,
            # Bookkeeping
            "captured_at": str(int(time.time() * 1000)),
            "refresh_count": "0",
            # Optional fields kept from previous shape (used by quota/image flow)
            "cb": cookies.get("CB", ""),
            "cl": cookies.get("CL", ""),
            "cs": cookies.get("CS", ""),
            "cdi": cookies.get("CDI", ""),
            "cid": cookies.get("CID", ""),
            "cui": cookies.get("CUI", ""),
            "cul": cookies.get("CUL", ""),
            "all_cookies": json.dumps(cookies),
        }

        # Emit the masked summary now (do not include all_cookies blob in the masked log)
        log_subset = {k: v for k, v in tokens.items() if k != "all_cookies"}
        _emit(EVT_TOKENS_CAPTURED, tokens=_mask_tokens(log_subset))

        # Try to capture a seed design — best-effort, log a warning on failure.
        # Strategy: HTTP-only bootstrap first (no page nav). Falls back to
        # browser-based capture if HTTP path fails for any reason.
        page = (session or {}).get("page")
        seed_design: dict[str, str] | None = None
        try:
            seed_design = await _bootstrap_seed_design_http(tokens, page=page)
        except Exception as exc:
            sys.stderr.write(f"[canva][seed-http] unexpected: {type(exc).__name__}: {exc}\n")
            sys.stderr.flush()
            seed_design = None

        if not seed_design and page is not None:
            sys.stderr.write("[canva][seed] HTTP path failed, attempting browser fallback\n")
            sys.stderr.flush()
            try:
                seed_design = await _capture_seed_design_browser(page)
            except Exception as exc:
                sys.stderr.write(f"[canva] seed_design browser fallback failed: {exc}\n")
                sys.stderr.flush()
                seed_design = None

        if seed_design:
            tokens["seed_design"] = seed_design
            _emit(EVT_SEED_DESIGN_CAPTURED, seed_design=_mask_tokens(seed_design))
        else:
            sys.stderr.write(
                "[canva] WARNING: seed_design not captured — proceeding without it (optional field).\n"
            )
            sys.stderr.flush()

        # Save Camoufox storage state to the profile dir for refresh-without-relogin.
        try:
            profile_dir = (session or {}).get("profile_dir")
            if profile_dir and page is not None:
                state_path = Path(profile_dir) / "storage_state.json"
                # context.storage_state() returns the state; persist as JSON
                state = await page.context.storage_state()
                state_path.write_text(json.dumps(state), encoding="utf-8")
        except Exception as exc:
            sys.stderr.write(f"[canva] storage_state save skipped: {exc}\n")
            sys.stderr.flush()

        # Stringify everything for the dict[str, str] contract from the base class.
        # seed_design (a dict) is serialized as JSON so the return type is satisfied;
        # the runner will JSON-parse it on the consumer side.
        out: dict[str, str] = {}
        for k, v in tokens.items():
            if isinstance(v, dict):
                out[k] = json.dumps(v)
            else:
                out[k] = "" if v is None else str(v)

        # Emit the final `complete` event with the FULL unmasked tokens (as a dict, not
        # stringified — the consumer expects an object). This is the only place
        # unmasked values are written.
        _emit(EVT_COMPLETE, tokens=tokens)

        return out

    async def fetch_quota(
        self,
        account: NormalizedAccount,
        tokens: dict[str, str],
        session: Any,
    ) -> dict[str, Any] | None:
        import aiohttp
        import ssl

        ssl_ctx = ssl.create_default_context()
        ssl_ctx.check_hostname = False
        ssl_ctx.verify_mode = ssl.CERT_NONE

        caz = tokens.get("caz", "") or tokens.get("CAZ", "")
        cb = tokens.get("cb", "")
        cau = tokens.get("cau", "") or tokens.get("CAU", "")
        user_id = tokens.get("user_id", "") or tokens.get("CUI", "")

        cookie_str = f"CAZ={caz}; CB={cb}; CAU={cau}"
        headers = {
            "Content-Type": "application/json;charset=UTF-8",
            "Origin": "https://www.canva.com",
            "Referer": "https://www.canva.com/ai",
            "Cookie": cookie_str,
            "x-canva-authz": tokens.get("authz") or caz,
            "x-canva-brand": tokens.get("brand") or cb,
            "x-canva-user": user_id,
            "x-canva-active-user": tokens.get("active_user") or cau,
            "x-canva-accept-prefix": "no-prefix",
            "x-canva-request": "getquota",
            "x-canva-app": "home",
        }

        try:
            timeout = aiohttp.ClientTimeout(total=15)
            async with aiohttp.ClientSession(timeout=timeout) as client:
                async with client.post(
                    CANVA_QUOTA_URL,
                    json={"A": "C", "B": cb, "C": user_id},
                    headers=headers,
                    ssl=ssl_ctx,
                ) as resp:
                    if resp.status != 200:
                        return {"limit": 100, "remaining": 100}
                    data = await resp.json()
                    q = data.get("A", {})
                    used = q.get("C", 0)
                    limit = q.get("D", 100)
                    return {
                        "limit": float(limit),
                        "remaining": float(limit - used),
                        "remaining_credits": float(limit - used),
                        "total_credits": float(limit),
                        "current_usage": float(used),
                    }
        except Exception:
            return {"limit": 100, "remaining": 100}

    async def cleanup_session(self, session: Any) -> None:
        if not isinstance(session, dict):
            return
        manager = session.get("manager")
        if manager:
            try:
                await manager.__aexit__(None, None, None)
            except Exception:
                pass

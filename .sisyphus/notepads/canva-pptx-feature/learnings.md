# Canva PPTX Feature - Learnings

## [2026-06-14] Initial Repo State Analysis

### Project Layout (verified)
- DB schema: `src/db/schema.ts` (13.5KB) - imageStudioResults table exists
- Provider: `src/proxy/providers/canva.ts` (10.5KB)
- Pool: `src/proxy/pool.ts` (14.7KB) - getNextAccount method exists
- Drizzle: `drizzle/` has only `0000_neat_skreet.sql` + `meta/`
- Drizzle config: `drizzle.config.ts` (237 bytes - tiny, simple config)

### Auth Scripts Structure (IMPORTANT - plan reference outdated)
- Plan says `scripts/auth/canva.py` and `scripts/auth/codebuddy.py`
- Reality: auth is modularized under `scripts/auth/app/providers/`:
  - `scripts/auth/app/providers/canva.py` (11.5KB, EXISTS - modify, don't create new)
  - `scripts/auth/app/providers/codebuddy.py` (125KB - reference for patterns)
  - `scripts/auth/login.py` (19.6KB) - main entry
- Plan instruction "Create/rewrite scripts/auth/canva.py" -> translate to: rewrite/extend `scripts/auth/app/providers/canva.py`

### Missing Research Artifact
- Plan references `.sisyphus/drafts/canva-provider-update.md` (does NOT exist)
- Subagents must trust plan's inline detail (cookie naming, header schema, etc.) which is comprehensive

### Working Tree State
- Main branch, lots of M files but they are CRLF/LF normalization noise (not real edits)
- Recent commits show combos-feature was just completed

## Conventions To Follow
- Drizzle migrations: `bun run drizzle-kit generate` produces `drizzle/{NNNN}_xxx.sql`
- Settings: `src/db/schema.ts` has settings table - use INSERT OR IGNORE for defaults
- Pattern: `codebuddy.ts` is the closest analog for hybrid auth

## Subagent Reminders
- All subagents MUST read this notepad before working
- All subagents MUST append findings (not overwrite)
- ALL TS changes must pass `bun run tsc --noEmit`

## [2026-06-14 18:55] T2 Notes — CanvaTokens type extension

### Files Touched
- `src/proxy/providers/canva.ts` (lines 14-87): Replaced `interface CanvaTokens` with exported `type CanvaTokens` + added exported `getCookieValue` helper.

### Decisions
- Existing fields preserved exactly: `caz` (required), `cb?`, `cau?`, `user_id?`, `cl?`, `cs?`, `cf_clearance?`, `all_cookies?`.
- `cf_clearance` was already legacy lowercase optional; kept under the UPPERCASE block since spec lists it there (semantically the same field, no rename needed).
- Switched `interface` -> `export type` per spec requirement that `CanvaTokens` be exported (codebuddy.ts uses `interface` un-exported, but the future worker stdin contract needs the export).
- Made `authz`, `brand`, `active_user`, `captured_at`, `refresh_count` REQUIRED per spec — old tokens flow through `JSON.parse ... as CanvaTokens` which is a non-validating cast, so old shapes still don't throw at runtime in `getTokens`.
- UPPERCASE cookie fields (`CAZ`, `CAU`, `CUI`) kept OPTIONAL — old accounts won't have them; `getCookieValue` provides the lowercase fallback.

### getCookieValue Helper
- Co-located right under the type.
- Three explicit fallbacks: CAZ→caz, CAU→cau, CUI→user_id.
- Generic name lookup via `Record<string, unknown>` cast (no `as any`); only returns string values, `undefined` otherwise.

### Verification
- `bun run tsc --noEmit` -> canva.ts has 0 errors (other unrelated files in repo have pre-existing errors not introduced by this change).
- `lsp_diagnostics` on canva.ts -> No diagnostics found.

### Notes for Downstream Tasks
- Worker stdin contract (next task) can now `import type { CanvaTokens, getCookieValue }`.
- `getTokens(account)` was NOT modified — it still returns `CanvaTokens | null` via JSON parse; old account rows lacking `authz/brand/active_user/captured_at/refresh_count` will type as `CanvaTokens` but be missing those fields at runtime. Consumers of new fields MUST guard with truthiness checks.
## [2026-06-14 18:55] T3 Notes

- Created `src/proxy/providers/canva-utils.ts` (72 LOC) with pure helpers: `maskToken`, `computeDedupeKey`, `validateSlideCount`, `validateFormat`.
- Constants: `MAX_SLIDES = 50`, `DEDUPE_WINDOW_MS = 60_000` (1-minute bucket).
- `computeDedupeKey` uses `createHash('sha256')` from `node:crypto` over `prompt|accountId|format|floor(now/60000)` -> 64-char lowercase hex.
- `maskToken`: returns `'***'` for short strings (`len <= visible*2`) to avoid leaking; otherwise `head...tail` form.
- `validateSlideCount` rejects non-finite, non-integer, `<1`, `>50` with error containing `'Canva'` and the cap.
- `validateFormat` allow-lists exactly `pptx | pdf | mp4` via a `readonly` tuple; exported `CanvaFormat` type alias for downstream consumers.
- Self-test: 10/10 PASS (all 9 spec assertions). LSP diagnostics clean. `tsc --noEmit` shows no errors in this file (pre-existing errors in unrelated files only).
- Pattern: dependency-free (only `node:crypto`); no imports from other providers, no I/O, no globals.


## [2026-06-14] T1 Notes — Schema extension for PPTX

### Files Modified
- `src/db/schema.ts` (lines 122-143): Added 8 NULL-able columns to `imageStudioResults` table

### Files Created
- `drizzle/0001_ambiguous_maginty.sql`: Auto-generated migration (drizzle-kit chose name; do not rename per spec)

### New Columns (all NULL-able for backward compat)
- `design_url` text
- `pptx_url` text
- `pptx_path` text
- `slide_count` integer
- `pptx_credits_used` integer  *(renamed from spec's `credits_used` to avoid collision — see below)*
- `s3_expires_at` integer (unix timestamp)
- `dedupe_key` text
- `format` text (allowed values pptx|pdf|mp4 — no DB-level CHECK; enforced at app layer)

### Decisions
- **Naming collision avoided**: Spec lists `credits_used integer` as a NEW column, but `credits_used real DEFAULT 0` already exists from the original schema. Adding a duplicate would error. Renamed the new PPTX-specific one to `pptx_credits_used` (Drizzle field: `pptxCreditsUsed`). Existing `creditsUsed: real` preserved untouched.
- **No `media_type` column existed** in the original table, so no enum/check to extend (spec's conditional clause "only if such a check exists" → skipped).
- **DB drift fix**: `combos` table existed in DB (from prior push) but not in migration journal. Running `bun run migrate` failed because the auto-generated 0001 included `CREATE TABLE combos`. Resolution: applied the 8 `ALTER TABLE image_studio_results ADD COLUMN` statements directly via bun:sqlite, then recorded the migration hash in `__drizzle_migrations` so future `bun run migrate` runs skip 0001 cleanly.
- All columns NULL-able — no `.notNull()`, no DB defaults beyond what Drizzle inferred.

### Verification
- DB file: `data/poolprox3.db` (path from drizzle.config.ts: `DATABASE_PATH || "./data/poolprox3.db"`)
- Backup created: `data/poolprox3.db.bak` (151904256 bytes)
- Row count before: **0**
- Row count after: **0** (preserved — table was empty)
- Final `.schema image_studio_results` shows all 9 original columns + 8 new columns = 17 total
- `lsp_diagnostics src/db/schema.ts` → **clean** (no errors)
- `bunx tsc --noEmit` → exit 2, but ALL errors are in `test/api/backup-restore.test.ts` (pre-existing, unrelated to my changes; no errors reference schema/imageStudio/pptx_/design_url)

### Migration Journal State
- `drizzle/meta/_journal.json` lists: `0000_neat_skreet`, `0001_ambiguous_maginty`
- `__drizzle_migrations` table contains: original hash + 0001 hash (just inserted)

### Gotchas For Next Tasks
- Drizzle field name for new credits col is `pptxCreditsUsed` (not `creditsUsed`) — important when writing inserts/updates in T3+
- Existing `creditsUsed` (real) remains the legitimate column for image-studio credit tracking; PPTX flow should write to `pptxCreditsUsed` only (or pick whichever the upstream task wants — clarify with Prometheus)
- `etteum-pool.db` (0 bytes) is a stub — real DB is `data/poolprox3.db`

## [2026-06-14 18:56] T5 Notes - Per-Provider Max-Concurrent Gate

### Cache Pattern (mirrored)
- Mirrored `lbMethodCache` shape: `{ perProvider: Map<string, number>; expiresAt: number } | null`
- 10s TTL via `now + 10000`
- Lazy populate on first read; on DB error, install empty cache for 10s window (same as lbMethodCache fallback)
- `invalidateLoadBalancingCache()` extended to clear BOTH `lbMethodCache` and `maxConcurrentCache` (no rename, avoids caller churn)

### Return Contract for "All Saturated"
- `getNextAccount` already returned `Promise<Account | null>` -> reused `null` sentinel for saturated case
- No type signature change; no caller updates needed
- Callers already handle `null` return ('no active accounts'); now `null` also means 'all at concurrency cap'

### Defaults Applied
- canva=1, kiro=2, codex=2, codebuddy=2, qoder=1
- Other providers: `Number.POSITIVE_INFINITY` (no regression to image/video flows, byok, etc.)
- Stored as static `DEFAULT_MAX_CONCURRENT` map on the class

### Settings Bootstrap
- No pre-existing seed path found; added `ensureMaxConcurrentDefaults()` lazy-once seeder
- Uses Drizzle `insert(settings).values(...).onConflictDoNothing()` (idempotent, INSERT OR IGNORE equivalent)
- Triggered fire-and-forget on first `getMaxConcurrentForProvider` call; `maxConcurrentSeeded` flag prevents re-runs
- On seed failure, flag is reset so a future call can retry; meanwhile in-code defaults still gate correctly

### Files & Lines Touched
- `src/proxy/pool.ts` only:
  - L26-65: added `maxConcurrentCache`, `maxConcurrentSeeded`, `DEFAULT_MAX_CONCURRENT`, `ensureMaxConcurrentDefaults()`
  - L96-99: extended `invalidateLoadBalancingCache()` to clear new cache
  - L101-134: new `getMaxConcurrentForProvider(provider)` method
  - L141-179 (approx): refactored `getNextAccount` round-robin + sequential loops to skip saturated accounts; returns `null` when no candidate under cap

### Verification
- `bun run tsc --noEmit`: zero errors in `src/proxy/pool.ts` (confirmed via grep filter and lsp_diagnostics)
- All other typecheck errors are pre-existing in unrelated files (scripts/sync-filter-rules.ts, src/index.ts, src/lib/tunnel/cloudflared.ts, test/api/*.test.ts) - not introduced by T5
- No pool tests exist under src/__tests__/ or tests/ for getNextAccount (smoke check skipped)
## [2026-06-14] T4 Canva Auth Provider — implementation notes

### File modified
- `scripts/auth/app/providers/canva.py` — extended in-place (820 LOC, 30.9KB)

### Class structure (verified)
- `CanvaProviderAdapter(ProviderAdapter)` from `app.providers.base`
- Implements all 5 ABC methods: `parse_account`, `bootstrap_session`, `authenticate`, `fetch_tokens`, `fetch_quota` + override of `cleanup_session`
- Internal helper: `_login_flow(account, session)` extracted from old `authenticate`
- Lifecycle is invoked by `scripts/auth/login.py` via `_run_provider_once` (bootstrap → authenticate → fetch_tokens → fetch_quota → cleanup)

### Module-level helpers (added)
- `_emit(event: str, **fields)` — single-line NDJSON to stdout, flushed, BrokenPipe-safe
- `_mask(value, keep=4)` — first/last 4 chars + "..." (full mask if shorter than 8 chars)
- `_mask_tokens(dict)` — recursive shallow mask for safe logging (handles nested seed_design)
- `_detect_captcha(page)` — body-text + iframe-URL scan, returns reason or None
- `_install_ajax_header_listener(page, captured)` — wires `page.on("request", ...)` to grab the four X-Canva-* headers from the first /_ajax/* request
- `_capture_seed_design(page, timeout_s=25)` — opens canva.com/create/presentations/, reads designId+extension from settled URL, listens for first design API response to fill version/pageId/templateId
- `_profile_dir(account_id)` — resolves to repo_root/data/browsers/canva/{account_id}/, mkdirs

### NDJSON contract emitted to stdout
Exactly six event types, mapped to module constants:
- `EVT_STARTED`        = "started"            (bootstrap_session entry)
- `EVT_LOGGED_IN`      = "logged_in"          (after CAZ cookie observed post-login)
- `EVT_TOKENS_CAPTURED`= "tokens_captured"    (MASKED summary; no full token values)
- `EVT_SEED_DESIGN_CAPTURED` = "seed_design_captured"  (MASKED; emitted only on success)
- `EVT_COMPLETE`       = "complete"           (FULL UNMASKED tokens — exactly once)
- `EVT_ERROR`          = "error"              (with code + message; precedes raise)

### Token shape (matches T2 TS contract)
- UPPERCASE cookies: `CAZ`, `CAU`, `CUI`, `cf_clearance`
- AJAX headers: `authz`, `brand`, `active_user`, `build_sha`
- Legacy lowercase mirrors: `caz`, `cau`, `user_id` (preserves image/video flow)
- Bookkeeping: `captured_at` (ms epoch string), `refresh_count` ("0" initial)
- Optional: `seed_design = {A: designId, B: version, C: extension, D: pageId, I: templateId}`
- Carry-over for quota: `cb`, `cl`, `cs`, `cdi`, `cid`, `cui`, `cul`, `all_cookies`
- `fetch_tokens()` returns `dict[str, str]` (base-class contract); seed_design is JSON-stringified when present, but the FULL `complete` NDJSON event uses the unstringified dict so consumers receive native JSON.

### CAPTCHA handling
- Detection runs once before login flow + once after, plus inside the early already-logged-in path.
- Needles checked: `captcha`, `are you a robot`, `verify you are human`, `press and hold`, `challenge-platform` (Cloudflare Turnstile), `h-captcha`, `g-recaptcha`
- Iframe URL scan covers hcaptcha.com, recaptcha, challenges.cloudflare.com
- On detection: emits `{"event":"error","code":"captcha_required","message":...}` then raises `NonRetryableBatcherError(browser_challenge_blocked)` — login.py's outer harness will exit non-zero.

### Persistent profile
- Camoufox launched with `persistent_context=True` + `user_data_dir=<profile>` (per Camoufox public API).
- Storage state additionally exported to `{profile}/storage_state.json` at end of `fetch_tokens` for refresh-without-relogin.
- Account-id resolution: `account.metadata["account_id"]` if present (set by login.py), else falls back to `account.identifier` (the email).

### Headless / interactive modes
- `CAMOUFOX_HEADLESS` (T4 spec) takes precedence; falls back to `BATCHER_CAMOUFOX_HEADLESS` (legacy). Default = headless on.
- Headless: full Google-OAuth automation reusing `kiro.py` step helpers.
- Interactive (`CAMOUFOX_HEADLESS=0`): polls cookies up to 5 minutes for the user to log in manually; stderr-only prompt (NDJSON stdout stays clean).

### Header capture mechanism
- `_install_ajax_header_listener` attaches before navigation so first `/_ajax/*` request from any pre-login `quota` poll is captured too.
- After cookies are confirmed, `authenticate()` actively kicks an XHR via `page.evaluate(fetch('/_ajax/quota/quota/get'))` to GUARANTEE Canva's bundle emits the X-Canva-* headers (Canva injects them via service-worker fetch). Then waits up to 5s for all four targets to populate.

### Deviations from plan / decisions
1. Plan said "create scripts/auth/canva.py" — followed prior notepad direction and modified `scripts/auth/app/providers/canva.py` instead (the modular layout used by all other providers).
2. Plan had no explicit `error` event in the schema; added `EVT_ERROR` because runner.ts needs to distinguish CAPTCHA/bootstrap failures from terminal `complete`. This is consistent with how the broader `login.py` framework already emits `{"type":"error",...}`.
3. Seed-design extraction is best-effort: if `/create/presentations/` does not redirect to a `/design/<id>/<ext>/` URL within 25s, we log a stderr warning and skip the field — the plan explicitly marks seed_design as optional.
4. `fetch_tokens` itself emits `EVT_COMPLETE`. login.py also emits its own structured response; T2 runner.ts must consume the LAST `event:"complete"` line (which carries the unmasked tokens dict). Documented the constraint in the docstring.
5. Did NOT touch requirements.txt — Camoufox 0.4.11 already pinned at line 1.

### Verification done
- `python -c "from app.providers.canva import *"` → IMPORT OK
- AST parse → PASS (820 LOC)
- `_emit` produces exactly one valid JSON line per call, terminated by `\n`
- `_mask` round-tripped on short/medium/long/empty/None inputs
- `_mask_tokens` correctly recurses into nested seed_design dict
- `_profile_dir("test_acct_42")` → resolves to `data/browsers/canva/test_acct_42/`, exists=True post-call
- `_DESIGN_URL_RE` on `https://www.canva.com/design/DAHxxYYY/abc123/edit` → `{id: "DAHxxYYY", ext: "abc123"}`
- `CanvaProviderAdapter()` instantiates (all ABC methods present) — no `TypeError: abstract methods`

## [CRITICAL DOWNSTREAM NOTE - T1 outcome]

T1 created **pptxCreditsUsed: integer("pptx_credits_used")** instead of credits_used because a creditsUsed: real("credits_used").default(0) column ALREADY existed on image_studio_results (lines 33/71/130 of schema.ts).

**Implication for T10 / T11 / T12 / worker contract**:
- When recording PPTX credit delta, write to **pptxCreditsUsed** (DB column pptx_credits_used).
- The original `credits_used (real) column is the legacy image/video credits field — leave it alone for PPTX rows OR set to 0.
- DoD line 90 says "credits_used = 2" — interpret as: pptxCreditsUsed === 2 for PPTX rows.

## [CRITICAL DOWNSTREAM NOTE - T1 DB drift]

T1 reports a DB drift workaround: combos table existed in DB without a recorded migration. T1's migration drizzle/0001_ambiguous_maginty.sql includes both:
1. CREATE TABLE combos (drift catch-up)
2. The 8 ALTER TABLE image_studio_results ADD ... statements (the actual T1 deliverable).

T1 manually applied via bun:sqlite + registered the migration hash. Future `bun run migrate` will treat 0001 as already applied. If a future task triggers a clean rebuild of the DB, the migration WILL run cleanly because both the CREATE TABLE and ALTER statements are idempotent for a fresh DB.

## Wave 1 Summary - All 5 Tasks Verified

| Task | File(s) | LSP Errors | Notes |
|---|---|---|---|
| T1 | src/db/schema.ts + drizzle/0001_ambiguous_maginty.sql | 0 | 8 columns added; migration applied; drift caught |
| T2 | src/proxy/providers/canva.ts (L14-87) | 0 | export type + getCookieValue helper |
| T3 | src/proxy/providers/canva-utils.ts (NEW, 72 LOC) | 0 | 4 fns + 2 consts; 10/10 self-tests pass |
| T4 | scripts/auth/app/providers/canva.py (extended to 820 LOC) | n/a (Python) | 6 NDJSON event types, CAPTCHA detection branch present |
| T5 | src/proxy/pool.ts (L26-179) | 0 | getMaxConcurrentForProvider + cap-aware getNextAccount |

Wave 2 can now proceed - T6 needs T2+T3 (both complete), T8 needs T2+T4+T6.


## [2026-06-14 19:11] T6 Notes — canva_worker.py PPTX mode

### Files Modified
- `src/proxy/providers/canva_worker.py` — extended (281 LOC -> 907 LOC). Existing image/video/quota dispatcher preserved untouched; added `mode == "pptx"` branch.

### Top-Level Functions Added (Python translation of test_canva_full_pptx.py)
- `_mask_token(s, n=4)` — mirrors canva-utils.ts `maskToken`: returns `"***"` for `len <= n*2`, else `head...tail`.
- `_dbg(msg)` / `_emit(result)` — strict separation: stderr is debug, stdout is reserved for the single final JSON line.
- `_check_abort()` — inert hook for T7 (returns False); orchestrator checks it between every step + inside every poll loop, so T7 only needs to flip its return value.
- `_pptx_pick_cookie(cookies, *names)` — UPPERCASE/lowercase fallback (CAZ→caz, CAU→cau, CUI→user_id). Mirrors `getCookieValue` in canva.ts.
- `_pptx_build_session(cookies)` — separate session builder using `chrome120` (not chrome131 used by legacy modes); also flushes `all_cookies` blob for legacy auxiliary cookies.
- `_pptx_build_base_headers(headers, cookies)` / `_pptx_h(base, op, ct=None)` — header layering: static block + per-call `X-Canva-Request: <op>` (`+ Content-Type` for POSTs).
- `_classify_http_error(resp, body)` — single source of truth for HTTP→error code mapping (cf_blocked/auth_expired/quota_exceeded/api_error). CF detection via 3 signals: 403+body markers, 503+`cf-mitigated` header, `__cf_chl_*` cookies.
- `_request(...)` — wraps session.request with timeout/network → `PipelineError`; `"timeout"`/`"timed out"` substring routes to `timeout` code, else `api_error`.
- 8 pipeline steps: `create_thread`, `poll_thread_for_results_token`, `poll_design_results`, `materialize_design`, `create_export`, `poll_export`, `record_usage`, `download_local`.
- `run_pptx_pipeline(stdin)` — orchestrator; pre-pipeline validation (slide_count/format/prompt/seed_design/CAZ/authz) before any network call.

### Byte-for-byte JSON Shapes Preserved from test_canva_full_pptx.py
- Step 1 body: `{A: uuid4, B:[{"A?":"A", A:prompt}], C: uuid4, D:{A:seed_design, D:"Q", G:{"A?":"A", K:1}}, E:true, "A?":"G"}` — exact same shape as blueprint line 87-99.
- Step 4 body: `{I:design_gen_id, "A?":"k", n:design_spec}` (blueprint line 270-274).
- Step 5 body: full renderSpec/outputSpecs payload preserved verbatim including `mediaQuality:"PRINT"`, `mediaDpi:96`, `preferWatermarkedMedia:true`, `priority:"HIGH"`, `pollable:true`, `useSkiaRenderer:true` (blueprint line 290-315).
- Step 7 body: `{usageEvents:[{A:design_id, "A?":"I", J:"DOWNLOAD"}]}` (blueprint line 351).

### Deviations From Blueprint (Intentional)
1. **Inputs**: stdin JSON instead of HAR file (load_auth/AUTH_FILE replaced by stdin parsing in orchestrator).
2. **Outputs**: single `_emit()` call to stdout instead of step-by-step `print()`; all step diagnostics go to stderr via `_dbg()`.
3. **Step 2 token shape**: spec asks for the strict 9-key shape `{A,B,F,H,C,J,E,D,I}`; blueprint uses a looser `{A,B} ∪ {F|C|H}` heuristic. Implementation prefers strict 9-key match first, falls back to looser shape — handles both empirically observed Canva response variants.
4. **Step 2 timeout**: spec says max=15s; blueprint uses 120s for `poll_for_results_token` after outline. Spec wins (T6 uses the noPlanning fast-path so 15s is sufficient).
5. **Step 3 timeout**: spec says max=120s; blueprint uses 180s. Spec wins.
6. **Step 6 timeout**: spec says max=60s; blueprint uses 60s — matches.
7. **Outline-approval planning steps (2b, 2c, 3a in blueprint)** are SKIPPED — spec calls for the noPlanning flow (D.D="Q") which produces the results_token directly from the first thread poll. This matches the validated 37s end-to-end run.
8. **download_local path**: spec says `data/pptx/{account_id}/{design_id}.{ext}`. `account_id` not in the documented stdin contract but accepted via `stdin.account_id` or `stdin.accountId`; defaults to `"_"` when absent so T6 works without T8's wiring.
9. **Step 7 best-effort failure**: logged via `_dbg` with masked body; pipeline continues. Returns `False` from `record_usage` but caller in orchestrator ignores the return value.

### Error Classification Edge Cases Handled
- `aborted` code emission is RESERVED for T7 (per spec MUST NOT do). The orchestrator checks `_check_abort()` between every step and in every poll loop — T7 only flips that helper.
- `seed_design_invalid` triggers when seed_design isn't a dict OR is missing any of the 5 required keys (A,B,C,D,I). Pre-pipeline so no credits burned.
- `auth_expired` pre-pipeline when CAZ cookie OR authz header missing (cheap fail-fast).
- `api_error("design generation failed")` triggers on EITHER `A?:"E"` OR empty/missing `design_spec` per spec.
- S3 expires_at parsing handles both `Expires` (absolute unix) and `X-Amz-Expires` (duration); converts duration to absolute when value < now.

### Verification
- `python -c "import ast; ast.parse(...)"` — **AST OK**.
- Smoke test 1: `slide_count=51` → `{"ok": false, "error": "slide_cap_exceeded", "details": "slide_count must be 1-50"}` ✓
- Smoke test 2: `format="docx"` → `{"ok": false, "error": "api_error", "details": "unsupported format"}` ✓
- Smoke test 3: legacy `mode="image"` no prompt → `{"ok": false, "error": "prompt is required"}` ✓ (no regression)
- Smoke test 4: unknown mode → `{"ok": false, "error": "unknown mode: unknownXYZ"}` ✓ (no regression)
- LSP basedpyright not installed in this environment; AST parse is the canonical Python validator per spec.

### LOC
- Before: 281
- After: 907
- Delta: +626 (PPTX pipeline + helpers)

### Notes for T7 (abort handling)
- Replace `_check_abort()` body so it returns True when the parent process signals abort (e.g., a sentinel file, a SIGINT handler, or a Unix pipe close on stdin). The orchestrator already raises `PipelineError("aborted", "...")` which translates to `{ok:false, error:"aborted", details:"..."}` in the final JSON. No structural changes needed.

### Notes for T8 (provider wiring)
- Stdin contract is exactly `{mode:"pptx", prompt, cookies:{...}, headers:{...}, seed_design:{A,B,C,D,I}, slide_count, format, save_local?, account_id?, request_id?, dedupe_key?}`. T4's `complete.tokens` payload + the request fields can be merged into this with a thin spread.
- Worker emits exactly ONE JSON line on stdout. Stderr is verbose debug (already masked).
- `credits_used: 2` is hardcoded per T1 empirical finding.

## [2026-06-14 19:18] T7 Notes — abort/dedupe/progress

### Phase strings (used both in NDJSON progress events on stderr AND in the abort error JSON)
- `thread_create`  (step 1, progress 0.05)
- `outline_wait`   (step 2, progress 0.10) — also passed to `_check_abort()` inside `poll_thread_for_results_token` loop
- `design_render`  (step 3, progress 0.40) — also passed to `_check_abort()` inside `poll_design_results` loop
- `materialize`    (step 4, progress 0.85) — credits commit boundary
- `export`         (step 5, progress 0.92) — also passed to `_check_abort()` inside `poll_export` loop
- `download`       (step 6, progress 0.98) — re-emitted at step 8 if save_local
- `done`           (final, progress 1.0)

The progress message for `export` uses the lowercase format string (`f"Exporting to {fmt.lower()}..."`).
The progress message for `design_render` substitutes the requested `slide_count` (Canva's actual page_count is unknown until step 3 returns; using slide_count is good enough for a progress hint).

### credits_committed boundary
- `_credits_committed = False` until step 4 returns successfully.
- Set to `True` *immediately after* `materialize_design()` returns. Rationale: per blueprint, Canva debits the 2 credits when the design is materialized into the user's workspace — anything before that is reversible.
- Aborts after `materialize_design()` (steps 5, 6) report `credits_committed: true` and the parent should NOT retry without warning the user.
- Aborts before step 4 (or during steps 1-3 poll loops) report `credits_committed: false` and the parent can safely retry.

### Abort error JSON shape (deviation from generic error shape!)
Generic errors: `{ok:false, error:<code>, details:<msg>}`
Abort error:    `{ok:false, error:"aborted", phase:<phase>, credits_committed:<bool>}` — no `details` key.
Exit code on abort = 0 (clean shutdown for Bun parent), unlike other errors which exit 1.

### Dedupe behavior
- Lock dir: `data/canva/dedupe/` (created with `os.makedirs(..., exist_ok=True)`).
- Lock filename: `{dedupe_key}.lock` containing `{"request_id":"<from stdin>","started_at":<unix_seconds>}`.
- Missing/empty `dedupe_key` → `("skipped", None)` — pipeline proceeds with no lock, no error.
- Lock < 60s old → return `{ok:false, error:"duplicate", existing_request:"<request_id from lock>"}` IMMEDIATELY (no exit 1, no `details` key). Do NOT release the lock — the in-flight peer still owns it.
- Lock >= 60s old → treated as stale, OVERWRITE and proceed. (No physical file removal — overwrite is atomic enough on local FS.)
- On final completion (success or any error other than `duplicate`): `_release_dedupe(lock_path)` deletes the lock best-effort.
- Stale-lock cleanup (>5min) is OUT OF SCOPE — left as a comment for a future sweep job.

### Order of operations (matters)
The dedupe block is intentionally placed AFTER pre-validation (slide_count / format / prompt / seed_design / CAZ / authz) and BEFORE `_pptx_build_session()`. Reason: don't write a lock for inputs we'd have rejected anyway, and don't waste a curl_cffi session if a fresh peer is already running.

### Signal handlers
- `signal.SIGTERM` (production: Bun parent sends this on cancel) and `signal.SIGINT` (dev: Ctrl-C) both flip the same `_aborted` flag.
- Handler is installed ONLY for `mode == "pptx"` — image/video flows are short-lived and don't need this plumbing. They keep Python's default SIGTERM behavior (immediate exit), which is fine.
- The handler does NOT exit/close anything itself. It just sets the flag and writes a stderr breadcrumb. The orchestrator's `except PipelineError` branch handles the actual cleanup (close session, release lock, emit final JSON).
- `signal.signal()` calls are wrapped in try/except so platforms without SIGTERM (constrained Windows) don't crash on import.

### Backward-compatible _check_abort signature
- Old call sites used `if _check_abort(): raise PipelineError("aborted", "...")`. New `_check_abort(phase)` raises directly when aborted, returns `False` otherwise — so the orchestrator-level call sites collapse to a single line `_check_abort("phase_name")`.
- Inside poll loops (`poll_thread_for_results_token`, `poll_design_results`, `poll_export`), the call is also a single line: `_check_abort("outline_wait")` etc.

### Verification outputs (smoke tests)
- AST parse: OK.
- `slide_count=51` → `{"ok":false,"error":"slide_cap_exceeded",...}` (T6 smoke still passes).
- `format="docx"` → `{"ok":false,"error":"api_error","details":"unsupported format"}` (T6 smoke still passes).
- Dedupe unit test (direct `_check_dedupe` calls): all 4 paths pass — acquired / duplicate / skipped / stale-overwrite.
- Dedupe E2E (stdin → orchestrator) with pre-written fresh lock: returns `{"ok":false,"error":"duplicate","existing_request":"req-1"}` exactly.
- Progress emit unit test: stderr-only, valid NDJSON, 3-key shape `{phase,progress,message}`.
- Abort raise unit test: `_check_abort("design_render")` after `_aborted=True` raises `PipelineError("aborted", "design_render")`.

### LOC delta
- Before: 907 lines (T6).
- After:  1234 lines.
- Net add: ~327 lines (signal handler + emit_progress + dedupe helpers + orchestrator rewires + finally block + main exit-code branch).


## [2026-06-14 T8] Provider chatCompletion + refresh wiring

### Files Modified
- `src/proxy/providers/canva.ts` only (extended 363 -> 958 LOC, +595)

### MODELS array
- Added `canva-pptx` entry alongside existing `canva-image` and `canva-video`.
- `ownsModel` already matched substring `canva` -> no change to routing.

### Progress streaming pattern chosen: instance-keyed subscriber Map
- Public `subscribeToProgress(requestId, cb)` returns an unsubscribe fn.
- Public `unsubscribeFromProgress(requestId, cb)` for explicit cleanup.
- Private `emitProgress(requestId, event)` fans out to subscribers (errors swallowed).
- `runWorker` now takes optional 3rd arg `progressRequestId`; when set, drains stderr line-by-line via `readStderrWithProgress`, parses `{phase, progress, message}` JSON lines, dispatches to subscribers. Non-progress lines are kept in the diagnostic buffer.
- Why this pattern: chatCompletion signature stays `Promise<ProviderResult>` (no async-iterator return type rework, no callback parameter on every provider). T11 (SSE) registers a subscriber before invoking chatCompletion and unregisters in a finally.
- New exported types: `CanvaPptxProgressEvent`, `CanvaPptxProgressCallback`, `CanvaPptxRequestExtras`.

### chatCompletion dispatch
- Top-level `chatCompletion` now dispatches: `canva-pptx` -> `chatCompletionPptx` (private), else -> `chatCompletionImageVideo` (private, content-identical to old method).
- `chatCompletionStream` unchanged (delegates to `chatCompletion`).

### chatCompletionPptx flow (10 steps from spec)
1. Extract last user message; HTTP 400 on empty.
2. Read sibling fields via single typed cast: `request as ChatCompletionRequest & CanvaPptxRequestExtras`. Defaults: slide_count=5, format=pptx, save_local=true, request_id=this.generateId().
3. `validateSlideCount` + `validateFormat` from canva-utils -> HTTP 400 on failure.
4. `hasPptxTokenFields` predicate checks CAZ + authz + brand + active_user + seed_design. If missing, attempts one `refreshToken(account)`; on success re-checks; on failure returns `auth_expired`.
5. Worker stdin built with `getCookieValue` for cookies (CAZ/CAU/CUI/cf_clearance) and direct headers (authz/brand/active_user/build_sha). `computeDedupeKey(prompt, account.id, format)` for dedupe_key.
6. `runWorker(workerInput, WORKER_TIMEOUT_PPTX=180000, requestId)` — same helper as image/video, but with the new progress-stream channel.
7. Progress events flow via subscriber Map (see above). Worker emits `{phase, progress, message}` on stderr; we route them to subscribers verbatim.
8. On `ok:false`, returns `{success:false, error: code+details}` and sets `quotaExhausted` flag for `quota_exceeded`, `rateLimited` for `cf_blocked`. Forwards refreshed tokens (if a mid-call refresh happened) on the result for caller persistence.
9. `formatPptxContent` builds the markdown reply per spec template (title + format/slides/credits line + design URL + download URL + relative-time expiry note).
10. Returns `{success:true, response, creditsUsed: result.credits_used ?? 2, creditSource:"fixed"}`. NO DB writes inside the provider — T10 API layer handles persistence.

### refreshToken implementation
- **CLI invoked:** `python <config.authScriptPath> --email <email> --password <password>` with env `ENOWX_ALLOWED_PROVIDERS=canva`. The plan's suggested `--account-id ... --refresh-only` flags do NOT exist on login.py (it only accepts --email/--password); the closest existing entry point is the standard login flow which T4's canva.py handles per-provider via the `ENOWX_ALLOWED_PROVIDERS` filter. Documented this deviation here.
- Decrypts `account.password` via `utils/crypto.decrypt`.
- 60s timeout; on timeout, `proc.kill()`.
- Parses NDJSON line-by-line. Two recognised shapes:
  - **Wrapper** (preferred): `{type:"result", canva:{success, credentials, error}}` from login.py.
  - **Direct** (fallback): `{event:"complete", tokens:{...}}` from T4's canva.py per-provider emit.
  - Errors: `{event:"error", code, message}` — captured and returned as the error code.
- On success builds merged `CanvaTokens`: required fields from new credentials with fallback to existing values, optional string fields carried over from existing if missing in new, `seed_design` preserved from existing if not refreshed (T4 marked seed_design as best-effort).
- Bumps `refresh_count`, sets `captured_at = Date.now()`.
- Invalidates `healthCheckCache.get(account.id)`.
- Returns `{success:true, tokens: JSON.stringify(merged)}` (matches BaseProvider contract — caller persists DB; mirrors qoder/codebuddy behavior). Plan said to update DB inside the provider, but no other provider does this and adding the dependency would risk cycles (canva.ts -> auth/runner.ts -> proxy/router.ts -> providers/registry.ts -> canva.ts). The standard contract delegates persistence to the caller.
- On failure returns `{success:false, error, message}` — does NOT throw (T13 retry-decision-friendly).

### validateAccount
- Now accepts EITHER:
  - **Old shape:** CAZ + CAU + CUI present (via `getCookieValue` -> covers lowercase legacy).
  - **New shape:** CAZ + CAU + CUI + authz + brand + active_user.
- Old image/video accounts still validate; new PPTX accounts also validate.

### healthCheck
- Now wrapped with a 5-minute per-account cache: `healthCheckCache: Map<accountId, {result, expiresAt}>`.
- Cache hit + not expired -> return cached.
- On miss/expired -> `runHealthCheck` (the original logic), persist result, return.
- `refreshToken` invalidates the cache entry to avoid stale `missing_tokens` reads after a successful refresh.

### Quota for PPTX — OMITTED (per plan instruction)
- No quota infra exists for canva PPTX yet. Worker emits `credits_used: 2` empirically; we forward it as `creditsUsed` in ProviderResult. The 5-min healthCheck cache is the closest thing to "fetchQuota cached 5 min via Layer 2 healthCheck" that the plan referenced.

### maskToken usage in logs
- Two log lines (one in chatCompletionPptx, one in refreshToken) call `maskToken` from canva-utils on CAZ and authz. cookies/seed_design are never logged in cleartext.

### Pattern source for worker spawn
- Reused the existing `runWorker` in this file (extended in-place to take optional progressRequestId). Spawn args, stdin tempfile pattern, stdout/stderr handling, kill timer all preserved from original. The only addition: stderr can be drained line-by-line concurrently with stdout when a request_id is given.
- For refreshToken's spawn of login.py, mirrored `src/auth/runner.ts` (line ~386): same `Bun.spawn([config.pythonPath, config.authScriptPath, "--email", e, "--password", p])` + `ENOWX_ALLOWED_PROVIDERS` env scoping.

### Verification
- `lsp_diagnostics` on canva.ts -> No diagnostics found.
- `bun run tsc --noEmit` -> 0 errors in canva.ts. All remaining errors (sync-filter-rules.ts, src/index.ts, src/lib/tunnel/cloudflared.ts, test/api/backup-restore.test.ts) are pre-existing per T5's notepad.

### Notes for downstream tasks
- **T9 (registry)**: `canva-pptx` is already exposed via `supportedModels` and `ownsModel` substring match. registry.ts probably needs no change unless T9 wants explicit model registration.
- **T10 (API)**: `ProviderResult` carries `creditsUsed` (worker's empirical 2) and `response` (markdown). The PPTX-specific fields (design_id, design_url, download_url, s3_expires_at, local_path, slide_count, format, account_id) live on the worker output but are NOT propagated through ProviderResult — T10 will need a way to surface them. Options: extend ProviderResult, or have T10 invoke the worker via a separate canva-pptx-only entry point. Recommend the latter to keep BaseProvider clean.
- **T11 (SSE)**: subscribe via `provider.subscribeToProgress(requestId, cb)` BEFORE awaiting chatCompletion; unsubscribe in a finally. Set `request_id` on the request via the `CanvaPptxRequestExtras` shape (or `metadata.request_id`).
- **T13 (auth queue)**: refreshToken returns `{success:false, error, message}` without throwing. Inspect `error` for retry classification (e.g. `timeout`, `decrypt_failed`, `spawn_failed`, `io_failed`, `refresh_failed`, or any code surfaced by canva.py).
## [2026-06-14 19:29] T9 Notes

**Verdict:** registry.ts NOT modified. T9 was a pure 0-LOC verification task — the existing pattern already routes `canva-pptx` correctly.

**Why it works:**
- `CanvaProvider.ownsModel` (canva.ts:190-192) overrides the base with `model.toLowerCase().includes("canva")` — `"canva-pptx".includes("canva")` is true.
- `CanvaProvider` is registered in `PROVIDER_ORDER` at registry.ts:36 as the FIRST entry, so it wins over later providers regardless of any overlapping pattern.
- T8 added `{ id: "canva-pptx", ... }` to `CanvaProvider.supportedModels` (canva.ts:260), so `getAllModels()` (which flat-maps each provider's `getModels()`) automatically includes it.

**Verification command + output:**
```
bun -e "import { getProviderForModel, getAllModels } from './src/proxy/providers/registry'; const p = getProviderForModel('canva-pptx'); console.log('provider name:', p); const inList = getAllModels().some(m => m.id === 'canva-pptx'); console.log('in /v1/models payload:', inList);"

provider name: canva
in /v1/models payload: true
```

**`/v1/models` payload composition path:**
- Route handler: `src/proxy/index.ts:607` (`proxyRouter.get("/v1/models", ...)`) → calls `getAllModels()` (re-exported via `src/proxy/router.ts:2`).
- Source: `src/proxy/providers/registry.ts:60` `getAllModels()` = `PROVIDER_ORDER.flatMap(p => p.getModels())`.
- `BaseProvider.getModels()` (base.ts:213-215) returns `this.supportedModels` — so any model added to `CanvaProvider.supportedModels` flows automatically into `/v1/models`.

**Typecheck:** `bun run tsc --noEmit` reports only pre-existing errors in `scripts/sync-filter-rules.ts`, `src/index.ts:181` (ip prop), `src/lib/tunnel/cloudflared.ts`, and various `test/` files. None in `registry.ts`, `canva.ts`, or `base.ts`.

**Inherited wisdom for downstream tasks:**
- Adding more canva sub-models (e.g. `canva-docx`, `canva-image`) is a 1-file change: just append to `CanvaProvider.supportedModels`. Routing + listing are automatic.
- The substring-match `ownsModel` is permissive — any future model id containing `"canva"` will route to this provider. Keep new model ids prefixed/scoped to avoid collision.

## [2026-06-14 19:33] T10 Notes — POST /api/image-studio/generate PPTX branch

### Files Modified
- src/api/image-studio.ts only (1-9 -> 1-9 imports extended, +60 LOC helpers near top, +20 LOC route dispatch, +160 LOC `handlePptxGenerate`).

### Line ranges modified
- L1 (import line): added `type Context` to hono import.
- L11-58 (NEW block): added imports from canva-utils + canva.ts, `StatusCode` type, `mapPptxErrorToStatus` helper, `parsePptxMarkdown` helper.
- L240-410 (NEW): `handlePptxGenerate` function inserted right after `VALID_ASPECTS`, before `imageStudioRouter.post("/generate", ...)`.
- L420-433: extended request body type to add `type:"pptx" | format | slideCount` and added early branch `if (body.type === "pptx") return handlePptxGenerate(c, ...)` BEFORE the existing image/video logic. Image/video paths are otherwise UNCHANGED.

### Dispatcher used
- `routeRequest(request, false)` from `../proxy/router` — same dispatcher the image/video branch uses. NO new dispatcher invented.

### T8 ProviderResult shape — observed and mirrored
- T8 `chatCompletionPptx` returns `{success, response, tokensUsed:0, creditsUsed: result.credits_used ?? 2, creditSource:"fixed", tokens?}`.
- Structured PPTX fields (design_id, design_url, download_url, s3_expires_at, local_path, slide_count, format, account_id, title) are NOT propagated through ProviderResult — they live on the worker's WorkerOutput which is internal to canva.ts.
- T10 recovery strategy: parse the markdown reply (`response.choices[0].message.content`) produced by `formatPptxContent` (canva.ts L624-662). Markdown shape:
  `# {title}\n**Format**: {fmt} | **Slides**: {N} | **Credits used**: {C}\n- 🎨 **Edit on Canva**: {designUrl}\n- ⬇️ **Download**: {downloadUrl}\n_Download link expires in ~{N} minute(s)._`
- Regex patterns used: `/^# (.+)\$/m` (title), `/\*\*Edit on Canva\*\*:\s*(\S+)/` (designUrl), `/\*\*Download\*\*:\s*(\S+)/` (downloadUrl).
- `s3_expires_at` and `local_path` are NOT recoverable from markdown (the markdown only shows the relative-time string, not the timestamp). T10 stores `null` for both. Per task spec ("do NOT invent fields it doesn't provide"), this is the correct behavior.

### Action item for T11/future
- If T11 (SSE) needs `s3_expires_at` or `local_path`, T8's ProviderResult must be extended OR canva.ts must expose a sibling `pptxOutput` field on the result. Keep this on the radar.

### DB Insert — exact camelCase columns written
`imageStudioResults` insert (Drizzle typed insert, no raw SQL):
- `chatId` (number | null), `prompt` (string), `type: "pptx"`, `aspectRatio: "1:1"` (column is NOT NULL with default — must supply), `n: 1`, `urls: [downloadUrl]` (or `[]` if missing), `creditsUsed: 0` (the legacy column kept at 0 for PPTX rows).
- T1 columns: `designUrl`, `pptxUrl` (= downloadUrl), `pptxPath` (always null — see above), `slideCount`, `pptxCreditsUsed` (= `result.creditsUsed` from worker — **NOT** `creditsUsed` per T1 notepad warning), `s3ExpiresAt` (always null — see above), `dedupeKey` (computed via `computeDedupeKey(prompt, account.id, format)`), `format`.

### HTTP status mapping (mapPptxErrorToStatus)
| Worker code prefix | HTTP status | Notes |
|---|---|---|
| `slide_cap_exceeded` / `unsupported_format` / msg contains `(HTTP 400)` | 400 | Zod-style validation |
| `auth_expired` | 401 | Response includes `retry: true` hint |
| `duplicate` | 409 | |
| `quota_exceeded` | 429 | |
| `cf_blocked` | 503 | |
| `timeout` / `aborted` | 504 | |
| `api_error` / unknown | 500 | |
| router throws (unreachable provider) | 502 | Top-level try/catch around routeRequest |

Pre-validation (slide_count / format) returns 400 directly before any dispatch — uses messages from canva-utils' `validateSlideCount` and `validateFormat` so the message matches the worker/UI exactly.

### Response envelope
PPTX success `200`: `{ id, design_url, pptx_url, pptx_path, slide_count, credits_used, format, title, s3_expires_at, account: { id, email } }` — mirrors the image branch's `account` shape (`{ id, email }`).
PPTX error: `{ error, code, retry? }`.

### Verification
- `bun run tsc --noEmit` — image-studio.ts produces 0 errors (pre-existing errors in scripts/, test/, index.ts, cloudflared.ts are out of scope).
- `lsp_diagnostics` on the file — clean (no diagnostics).

### MUST-NOT compliance check
- ✅ Image/video request/response shapes UNCHANGED.
- ✅ URLs persisted to DB BEFORE returned to client (insert happens before c.json).
- ✅ No tokens/cookies/authz logged or returned.
- ✅ No binary bytes cached (we only store presigned URLs as text).
- ✅ No per-user rate limits added.
- ✅ Zero `as any` (used typed cast `as ChatCompletionRequest & CanvaPptxRequestExtras` for the metadata sibling — same pattern T8 uses internally).
- ✅ SSE / /v1/chat/completions untouched (T11 scope).

## [2026-06-14 19:34] T13 Notes — Auth refresh wiring

### Files Modified
- `src/api/accounts.ts`: Added new endpoint `POST /api/accounts/:id/refresh` (lines 809-838). Fire-and-forget — calls `loginQueue.enqueue(id)` and returns `202 {accepted:true, accountId, provider}` immediately.

### Files NOT Modified (already correct)
- `src/auth/queue.ts`: Already provider-agnostic. `canva` is in the bulkAdd allowlist (line 93) and `bulkAddAllProviders` (line 133). The queue dedupes via `hasPendingOrActive` (lines 209-213) — covers concurrent refresh requests for same account. No change needed.
- `src/auth/runner.ts`: Already provider-agnostic. `loginAccount(account)` (line 353) spawns `python <config.authScriptPath> --email --password` with env `ENOWX_ALLOWED_PROVIDERS=<provider>` (line 400) — exactly matches T8's documented invocation. NDJSON parsed line-by-line via `readTextStream` (line 185-215), tokens persisted via drizzle update on `accounts.tokens` (line 603-615), status set to `"active"` (line 606), broadcasts `login_success` / `login_failed` WS events. Timeout via `waitForProcessExit` with `config.authProcessTimeoutMs`. Already credential-mask-safe (no plaintext logs). No change needed.

### POST /api/accounts/:id/refresh — design
- `loginQueue.enqueue(id)` is idempotent for already-pending/active accounts (queue dedupes), so repeated POSTs do not stack work.
- The endpoint does NOT block on the actual refresh — returns 202 immediately. The runner broadcasts `login_success` / `login_failed` WS events on completion.
- `status` enum from `schema.ts` line 8: `active | exhausted | error | pending`. Runner uses `"active"` on success, `"error"` via `markAccountError` on failure (line 783-791) — matched the existing convention.

### Optional auth_expired hook in canva.ts — SKIPPED
- **Reason:** Cycle risk. `canva.ts` -> `auth/queue.ts` -> `auth/runner.ts` -> `proxy/router.ts` -> `providers/registry.ts` -> `canva.ts`. T8's notepad documented this exact cycle as the reason DB writes were kept out of the provider.
- **Mitigation:** `chatCompletionPptx` already calls `this.refreshToken(account)` inline when PPTX token fields are missing (line 506-525). On THAT failure it returns `auth_expired`. Users / orchestrators can manually re-trigger via the new `POST /api/accounts/:id/refresh` endpoint, or wait for the queue's automatic retry path.
- **Future option:** Use a dynamic `await import("../../auth/queue")` from inside the `auth_expired` branch to break the static cycle. Deferred — not blocking T13.

### WS event helper used
- `broadcast` from `../ws/index` — same helper used throughout queue.ts and runner.ts. The runner already emits `{type:"login_success", data:{...}}` and `{type:"login_failed", data:{...}}` on every refresh outcome; no new event type added.

### Verification
- `lsp_diagnostics` on src/api/accounts.ts -> No diagnostics found.
- `bun run tsc --noEmit` -> 0 errors in modified files. All remaining errors (sync-filter-rules.ts, src/index.ts, cloudflared.ts, test/api/*) are pre-existing per T5/T8 notepads.

### Live refresh smoke
- Deferred to F3 per spec.

## [2026-06-14 19:42] T12 Notes — re-export endpoint + worker skip_to_export branch

### Files Modified
- `src/proxy/providers/canva_worker.py` — added `fetch_design_meta()` helper (GET `/_ajax/design/{id}`) and `_run_pptx_reexport()` orchestrator; new branch at the top of `run_pptx_pipeline` checks `stdin.skip_to_export` and dispatches.
- `src/proxy/providers/canva.ts` — extended `WorkerInput` with `skip_to_export`/`design_id`/`extension` fields; added public `CanvaProvider.reexport(account, params)` method (smallest-possible surface, mirrors how T8's chatCompletionPptx invokes runWorker).
- `src/api/image-studio.ts` — new `POST /results/:id/re-export` route (idempotent + credit-accumulating).

### Decision (a) — How extension is sourced
**Inline worker fetch chosen** (Option B in plan; recommended path). The route does NOT pass `extension` through stdin; the worker's `_run_pptx_reexport` calls `fetch_design_meta(session, base_headers, design_id)` which hits `GET https://www.canva.com/_ajax/design/{design_id}` to recover the extension token. Rationale: avoids a schema migration (T1 didn't add an extension column), keeps T12 contained to the worker + provider + API trio, and is robust if extension tokens rotate per design version.

### Decision (b) — Full code path (happy path)
1. `POST /api/image-studio/results/:id/re-export` looks up `imageStudioResults` by id.
2. 404 if row missing; 400 if neither `format` nor `pptxUrl` set; **idempotent 200 with existing URL** if `s3_expires_at` is null/future.
3. Parses `design_id` from `designUrl` via regex `\/design\/([^/?#]+)`.
4. Validates `format`/`slideCount` via `canva-utils.validateFormat`/`validateSlideCount`.
5. Calls `pool.getNextAccount("canva")`; if none active → checks for ANY canva account, returns **410 `account no longer available`** if none exist, **503** if all saturated.
6. Casts `providers.canva` to `CanvaProvider` and calls `reexport(account, {designId, format, slideCount, saveLocal:true})`.
7. Provider builds a narrow `WorkerInput` with `skip_to_export:true`, no prompt/seed_design/dedupe_key. Worker validates and runs `fetch_design_meta → create_export → poll_export → record_usage → download_local`.
8. On worker `ok:true`: API persists `pptxUrl/pptxPath/s3ExpiresAt` on the row, **accumulates** `pptxCreditsUsed = previous + result.credits_used` (worker reports 1 for re-export), decrements pool quota, logs via `recordRequest`, returns `200 {pptx_url, s3_expires_at}`.
9. On worker `ok:false`: maps via `workerErrorToHttpStatus` (auth_expired→401, quota_exceeded→429, cf_blocked→503, aborted/duplicate→409, timeout→504, else 500), returns `{error, code, retry?}`.

### Decision (c) — Auth middleware reused
The image-studio router (`apiRouter.route("/image-studio", imageStudioRouter)` in `src/api/index.ts`) has NO per-route middleware in the router itself or at the mount point. POST /generate, DELETE /results/:id etc. are all unprotected at the Hono layer. The new POST /results/:id/re-export follows the same surface — adding new auth here would diverge from the rest of the router. If future hardening adds a global gate (e.g. dashboard auth at apiRouter), this endpoint inherits it for free.

### Decision (d) — Credit accumulation
- Worker reports `credits_used: 1` for skip_to_export mode (vs 2 for full pipeline).
- API computes `accumulatedCredits = (row.pptxCreditsUsed ?? 0) + result.credits_used` and writes to `pptxCreditsUsed` (T1 column, NOT `credits_used`).
- Pool quota is decremented by **only the new delta** (not the accumulated total), so account-level tracking stays correct.

### Account-Selection Caveat (DOWNSTREAM)
- `imageStudioResults` has no `accountId` column (T1 didn't add one).
- T12 uses `pool.getNextAccount("canva")` → may pick a different account than the one that originally generated the design.
- Canva's `/_ajax/export` is ownership-scoped per design. If the chosen account does not own the design, Canva returns 403/404 → worker emits `auth_expired`/`api_error` → API returns 401/500. Caller (UI) can retry (pool may pick a different account next round) or re-generate.
- **Future work**: T1 could be amended to add `accountId` so re-export uses the original owner. Documented as DEFERRED — not blocking T12 per plan's "DO NOT add a new schema migration in this task UNLESS strictly necessary".

### Worker pre-export validation contract
- Empty `design_id`/`slide_count`/`format` → `api_error: skip_to_export requires design_id+extension+slide_count+format`.
- `slide_count` 51 → `slide_cap_exceeded` (same as full-pipeline).
- `format=docx` → `api_error: unsupported format` (same as full-pipeline).
- `CAZ` cookie missing → `auth_expired: missing CAZ cookie`.
- `authz` header missing → `auth_expired: missing authz header`.

### Verification (smokes)
- `python -c "import ast; ast.parse(...)"` → AST OK.
- `echo '{...skip_to_export:true, slide_count:5, format:pptx, cookies/headers}' | python worker` → `{ok:false, error:api_error, details:"skip_to_export requires design_id+extension+slide_count+format"}` ✓
- T6/T7 regression: `slide_count=51` → `slide_cap_exceeded` ✓
- T6/T7 regression: `format=docx` → `api_error` ✓
- Skip-mode all-fields-present test → reaches network, returns `{ok:false, error:auth_expired, details:"HTTP 403"}` (Canva rejecting the fake CAZ) — confirms wire-up is correct.
- `bun run tsc --noEmit` on `src/api/image-studio.ts`, `src/proxy/providers/canva.ts`, `src/proxy/providers/canva-utils.ts` → 0 NEW errors. (Pre-existing errors in unrelated files: scripts/sync-filter-rules.ts, src/index.ts, src/lib/tunnel/cloudflared.ts, test/api/backup-restore.test.ts.)
- `lsp_diagnostics` on both .ts files → No diagnostics found.

## [2026-06-14 19:58] T11 Notes — SSE streaming for canva-pptx

### Files Modified
- `src/proxy/index.ts`:
  - Imports (lines 1-22): added `validateSlideCount`, `validateFormat`, `CanvaFormat` from `./providers/canva-utils`; type-only imports of `CanvaProvider`, `CanvaPptxRequestExtras`, `CanvaPptxProgressEvent` from `./providers/canva`.
  - SSE helper block (lines 476-771): `PPTX_PHASE_EMOJI` map, `PPTX_HEARTBEAT_MS = 5_000`, `extractLastUserPromptForPptx`, `buildPptxChunk`, `handleCanvaPptxSseStream`.
  - Handler short-circuit (lines 994-1000): inside `POST /v1/chat/completions`, after `normalizeModelId` and `isStream` resolution, branch `if (body.model === "canva-pptx" && isStream) return handleCanvaPptxSseStream(body, c.req.raw.signal);`.
  - Net add: 326 lines.
- `src/proxy/providers/canva.ts`:
  - `activeWorkers` Map (line 207): `Map<string, ReturnType<typeof Bun.spawn>>` — tracks live worker subprocess per requestId.
  - `abortRequest(requestId): boolean` public method (lines 244-256): sends `SIGTERM` via `proc.kill("SIGTERM")`; returns true if found+signaled, false otherwise.
  - `runWorker` extension (lines 326-359): when `progressRequestId` is set, the spawned `Bun.Subprocess` is registered into `activeWorkers` and removed in `finally` (alongside the existing `clearTimeout` and tmpFile cleanup).
  - Net add: ~30 lines.

### Decisions

(a) **Line range modified in proxy/index.ts**: imports (1-22), helper block (476-771), handler short-circuit (994-1000).

(b) **abortRequest added on canva.ts**: YES.
   - Tracks `requestId → Bun.Subprocess` via a private `activeWorkers` Map.
   - Map is populated inside `runWorker` only when `progressRequestId` is provided (i.e. PPTX path); cleared in the same try/finally that handles the timeout timer.
   - `abortRequest` is a thin public wrapper — looks up the proc, calls `proc.kill("SIGTERM")` (Bun supports both signal-name string and number; string was chosen for readability and matches T7's python signal handler).
   - Returns `boolean` so the SSE caller can log/no-op without throwing.

(c) **Heartbeat strategy**: `setInterval(check, 5000)`. The check compares `Date.now() - lastEventAt` against `PPTX_HEARTBEAT_MS`; if quiet, writes `:keepalive\n\n` (SSE comment line — clients ignore it but proxies stay open). Independent of the dispatcher promise — never blocks awaiting the worker. Cleared in the `finally` block so it cannot leak even on early-return validation failures (those branches return before the timer is created).

(d) **Emoji map**:
   | phase           | emoji |
   |-----------------|-------|
   | thread_create   | 🧠    |
   | outline_wait    | 📋    |
   | design_render   | 🎨    |
   | materialize     | 💾    |
   | export          | 📤    |
   | download        | ⬇️    |
   | done            | ✅    |
   | (unknown)       | •     |

   Each progress event becomes one chat-completion-chunk with `delta.content = ${icon}  (%)\n`` where `pct` clamps `Math.round(progress * 100)` to `[0, 100]`. `finish_reason = null` on progress chunks, `"stop"` on the final chunk + after errors.

(e) **Disconnect-detection mechanism**: `c.req.raw.signal` (Hono passes through the underlying Request's `AbortSignal`). The handler:
   1. Adds an `"abort"` listener that calls `provider.abortRequest(requestId)` immediately when the client disconnects (so the worker can exit early instead of running to completion under a dead socket).
   2. In the `finally` block, additionally checks `abortSignal.aborted` and re-runs `abortRequest` defensively (idempotent — Map lookup returns false the second time).
   3. The listener is always removed in `finally` to avoid leaks.

### SSE response shape
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `Connection: keep-alive`, `X-Accel-Buffering: no`.
- First chunk: role `assistant` only (matches OpenAI's first-frame convention).
- Subsequent chunks: progress translation (one per progress event).
- Final chunk: full markdown from `result.response.choices[0].message.content` (T8's `formatPptxContent` output) + `finish_reason: "stop"`.
- Tail: `data: [DONE]\n\n`.

### Input validation paths (both documented inline)
- `body.metadata.slide_count` / `body.metadata.format` (preferred — matches T8/T10).
- `body.tools[0].function.parameters.slide_count` / `...format` (OpenAI tool-call convention fallback).
- Defaults: `slide_count=5`, `format="pptx"`.

### Non-streaming branch
- NO new code: existing `handleChatCompletion → routeRequest → provider.chatCompletion` path already routes `canva-pptx` to `chatCompletionPptx` (T8 dispatch). Verified by reading T8's `chatCompletion` switch on line 391 of canva.ts.

### GET /v1/models
- Verified existing entry shape includes `id:"canva-pptx", object:"model", owned_by:"canva"` (canva.ts lines 263-275). NO change required.

### Verification
- `bun run tsc --noEmit`: 0 new errors. Pre-existing errors only in `test/api/backup-restore.test.ts` (44), `scripts/sync-filter-rules.ts` (7), `src/index.ts` (1), `src/lib/tunnel/cloudflared.ts` (1).
- LSP diagnostics: clean for `src/proxy/index.ts` and `src/proxy/providers/canva.ts`.

### Notes for downstream tasks
- **F3 manual QA**: needs running server + real Canva account. Test path:
  1. `curl -N -X POST localhost:PORT/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"canva-pptx","stream":true,"messages":[{"role":"user","content":"Photosynthesis for kids, 5 slides"}],"metadata":{"slide_count":5,"format":"pptx"}}'`
  2. Expect: phase chunks (🧠 → 📋 → 🎨 → 💾 → 📤 → ⬇️ → ✅), occasional `:keepalive`, then final markdown chunk + `[DONE]`.
  3. Disconnect mid-stream (Ctrl+C) → server log should show worker SIGTERM and clean unsubscribe.
- **Streaming context window protection**: heartbeat keeps connection alive across nginx/CF proxies (X-Accel-Buffering:no + Cache-Control:no-transform).

## [2026-06-14 20:02] T17 Notes — README Opencode CLI Integration section

### Files Touched
- `README.md` lines 252-340 (added `## Opencode CLI Integration` section + 5 subsections + intro paragraph).

### Verified Facts Used
- **Canva models registered** in `src/proxy/providers/canva.ts:261-301` `supportedModels`: all three (`canva-image`, `canva-video`, `canva-pptx`). All three included in the JSON config snippet — none omitted.
- **Default API port**: `1930` (confirmed via `README.md:158` `PORT=1930` and `README.md:182` env table). `baseURL` in snippet uses `http://127.0.0.1:1930/v1`.
- **Default dashboard port**: `1931` (`README.md:159`, `DASHBOARD_PORT`). Used in ""Generating an API key"".
- **Emoji map** (T11 reference, learnings.md:656-662): 🧠 thread_create / 📋 outline_wait / 🎨 design_render / 💾 materialize / 📤 export / ⬇️ download / ✅ done. Reproduced as a table in the ""Streaming behavior"" subsection.

### Insertion Point Chosen
- Inserted between `## API Endpoints` (ends line 250) and `## Development` (now line 342). Rationale: it builds directly on the OpenAI-compatible endpoint documented above it, and precedes the deeper internals (Development, Troubleshooting). Matches the task's ""after Quick Start, before deeper internals"" guidance.

### Style Choices
- Matched existing README heading style: `##` for section, `###` for subsections.
- Used a markdown table for the emoji/stage map (consistent with the existing Environment Variables and Providers tables).
- All code blocks fenced with language tags (`json`, `bash`).
- No em dashes / en dashes (anti-AI-slop). Plain prose, contractions used naturally.

### Honest Caveats (per task spec)
- Did NOT promise PDF/MP4 selection via prompt-only — explicitly stated `metadata.format` is the supported path and PPTX is the CLI default.
- Did NOT promise per-user rate limiting — explicitly stated ""no per-user rate limiting"".
- API key field uses placeholder `<your-etteum-api-key>`.

## [2026-06-14 20:15] T14 Notes — pptxStudio namespace in dashboard/src/lib/api.ts

### Files Modified
- `dashboard/src/lib/api.ts` only. Appended at the end (after `restoreAccounts`):
  - L740-746: header comment block.
  - L748-762: `PptxFormat`, `PptxGenerateOptions`, `PptxResult` (mirrors T10's `handlePptxGenerate` envelope at src/api/image-studio.ts L399-410: `id`, `design_url`, `pptx_url`, `pptx_path`, `slide_count`, `credits_used`, `format`, `title`, `s3_expires_at`, `account: { id, email }`).
  - L764-770: `PptxResult` body (id is `number | undefined` because T10 uses `saved?.id` with try/catch fallback).
  - L772-794: `StoredPptxResult` (DB-row shape returned by GET /results — camelCase columns from imageStudioResults schema; distinct from `PptxResult`).
  - L796-800: `PptxStreamChunk = { content?, done?, error? }`.
  - L802-805: private `getStoredApiKey()` helper reading `localStorage["api_key"]`.
  - L807-942: `pptxStudio` const namespace exporting `generatePptx`, `listPptxResults`, `deletePptxResult`, `reExportPptx`, `streamPptxGenerate`.

### imageStudio patterns mirrored
- Existing dashboard image API is a flat function set, NOT an object namespace (`generateImage`, `fetchResults`, `deleteResult`, etc. — all top-level). I mirrored only the **fetchApi wrapper / error-handling** pattern, but bundled the new functions into a single `pptxStudio` object so the dashboard PPTX page can `import { pptxStudio }` cleanly. Existing `imageStudio`-style top-level functions are UNTOUCHED.
- All non-streaming calls go through `fetchApi` so they inherit the dashboard `Bearer dashboard_token` auth + `AbortController`+`timeoutMs` timeout machinery + `body.error` extraction on non-2xx.
- Long-running endpoints get high timeouts: `generatePptx` 600 s, `reExportPptx` 600 s (image generate uses 420 s; PPTX is heavier).

### /results?type=pptx — server-side or client-side?
**CLIENT-SIDE.** Verified at src/api/image-studio.ts L626-641: the GET /results handler reads only `limit` and `chatId` query params; `type` is NOT consulted. `listPptxResults` therefore fetches everything and filters with `r.type === "pptx"`. If the server is later extended to honor `?type=pptx` it's a one-line change here.

### SSE parser approach
- Hand-rolled inline (no dependency, no EventSource — EventSource cannot send POST headers / Authorization).
- `fetch(POST /v1/chat/completions, { stream: true })` -> `res.body.getReader()` -> `TextDecoder` accumulating into a string buffer.
- Frame split on `\n\n`; per frame, lines starting with `:` are skipped (heartbeats, including `:keepalive` from T11 at proxy/index.ts L651), lines starting with `data:` have the prefix + leading whitespace stripped, then joined.
- `data: [DONE]` -> `onChunk({ done: true })` then return.
- Otherwise JSON.parse the payload; surface `choices[0].delta.content` via `onChunk({ content })`. `parsed.error` (string or `{message}`) -> `onChunk({ error })` but does NOT abort the loop (server may still send [DONE]).
- Unparseable frames are silently skipped — protocol-level junk shouldn't kill the consumer.
- Trailing `onChunk({ done: true })` on natural stream end (in case server forgot the [DONE] marker).
- `signal` is forwarded straight to `fetch` so callers can cancel.

### API key resolution
- The dashboard already stores user API keys at `localStorage["api_key"]` (set by `dashboard/src/pages/ApiKey.tsx` L29). `getStoredApiKey()` reads that key.
- `streamPptxGenerate` THROWS BEFORE the request if no key is stored (clear error: "API key not set. Open the API Key page and save a key before streaming PPTX generation.").
- Non-streaming (`generatePptx`, `listPptxResults`, `deletePptxResult`, `reExportPptx`) go through `fetchApi` and use the dashboard token (`dashboard_token`) — NO API key needed, per spec ("DO NOT call /v1/chat/completions for the non-streaming generatePptx").

### Types — duplication avoidance
- `PptxResult` is the snake_case generate-envelope (mirrors T10 server response) — distinct from `StoredPptxResult` (camelCase DB row).
- I considered widening `StoredResult.type` to `"image" | "video" | "pptx"` but spec said do not modify imageStudio exports; `StoredPptxResult` is fully independent and additive.
- Zero `as any`. One `as unknown as StoredPptxResult[]` cast on the listPptxResults filtered result (necessary because `fetchApi` returns `Record<string, unknown>[]` for the unknown-shape listing — the explicit shape conversion is the safe alternative to `as any`).

### MUST-NOT compliance
- ✅ Existing `imageStudio`-style flat functions UNCHANGED.
- ✅ Streaming uses fetch + ReadableStream inline (no EventSource, no new dep).
- ✅ Non-streaming path uses `/api/image-studio/generate`, NOT `/v1/chat/completions`.
- ✅ No `as any`.

### Verification
- `cd dashboard && bun run tsc --noEmit` -> EXIT=0, zero errors.
- `lsp_diagnostics` on api.ts -> clean.

## [2026-06-14 20:14] T15 Notes — PptxStudio.tsx page

### File Created
- `dashboard/src/pages/PptxStudio.tsx` (NEW, 567 LOC).

### Generation flow chosen
- **Non-streaming** (`pptxStudio.generatePptx`). Reasoning:
  (a) `streamPptxGenerate` requires `localStorage["api_key"]` — fail closed if absent. The dashboard generation flow is session-authed via `Bearer dashboard_token`; mixing two auth modes here just to get a "🧠 Creating Canva thread…" status string isn't worth the code/UX cost in v1.
  (b) Spec explicitly says "If streaming is awkward in v1, fall back to `generatePptx` non-streaming". I took that exit cleanly.
  (c) Status text during the wait is shown in an inline `Alert` ("Generating PPTX… this may take 30–60s.") which gives the user a clear expectation without SSE plumbing.
- `streamPptxGenerate` remains available in the API namespace; a future T-task can wire it up behind a settings toggle once the API Key page is mainstream.

### State count: 10 `useState` slots (within budget)
1. `prompt` (string)
2. `mode` ("quick" | "advanced")
3. `slideCount` (number)
4. `format` (PptxFormat)
5. `locale` (string)
6. `style` (string)
7. `isGenerating` (bool)
8. `results` (StoredPptxResult[])
9. `loadingResults` (bool)
10. `status` (Status discriminated union — replaces toast)
- Plus 2 transient action-state slots: `deleteTarget` (StoredPptxResult | null), `reExportingId` (number | null). Spec allows ~8-10; 10 + 2 transient is fine — these are UI-action states, not domain state.

### LOC: 567
- Above the 400 soft target, **under** the hard ceiling (ImageStudio = 953). Reasons for landing at 567:
  (a) No shared `Toast` component exists — I implemented an inline `Status` discriminated union + `Alert` rendering (~30 LOC).
  (b) No `Slider` shadcn primitive — used styled native `<input type="range">` with explicit Tailwind/CSS-var classes.
  (c) Three subcomponents extracted (`PromptField`, `ResultsSkeleton`, `EmptyResults`, `ResultRow`) keep the main component readable; total spec-required UI surface is just larger than 400 lines could fit cleanly.
- LOC includes generous spacing, comments, and helper functions (`timeAgo`, `formatBadgeTone`, `isS3Expired`, `readableError`).

### "Toast helper" used
- **None.** Dashboard has no toast lib (`grep toast|sonner` in `dashboard/src` returns zero matches). Used the existing `Alert` primitive (`dashboard/src/components/ui/alert.tsx`, supports `variant: success | error | info`) as a top-of-page banner. Auto-dismisses success/info after 4s; errors stay until the user retries. This matches the lightweight feel of the rest of the dashboard, which uses inline error states throughout.

### shadcn primitives imported
- `Button`, `Card` + `CardContent` + `CardHeader` + `CardTitle`, `Badge`, `Textarea`, `Input`, `Select`, `Tabs` + `TabsList` + `TabsTrigger` + `TabsContent`, `Alert`, `Dialog` + `DialogContent` + `DialogDescription` + `DialogFooter` + `DialogHeader` + `DialogTitle`.
- Lucide icons: `Presentation`, `Loader2`, `Download`, `ExternalLink`, `RefreshCw`, `Trash2`, `Sparkles`, `CheckCircle2`, `AlertCircle`, `FileText`, `Inbox`.

### Deviations from spec
1. **Locale field is just appended to the prompt**, as spec said ("UI-only sweetener, concatenated into the prompt"). Same for `style`. `buildPrompt()` joins them with periods.
2. **No real `locale` field on the API**: `PptxGenerateOptions` (T14) only accepts `prompt`, `slideCount`, `format`, `saveLocal`. So locale/style cannot be passed structurally — I do the documented prompt-concat fallback.
3. **No live progress text** during generation (chose non-streaming, see above). Replaced with a static "Generating PPTX… this may take 30–60s." status banner + a `Loader2` spinner in the Generate button.
4. **`reExport` only shows when `s3_expires_at` is set AND in the past.** The download button hides when expired so the user doesn't get a 403. Spec wording ("only when `s3_expires_at` exists AND is in the past") implemented exactly.

### Verification
- `cd dashboard && bun run tsc --noEmit` → exit 0.
- `lsp_diagnostics` on `dashboard/src/pages/PptxStudio.tsx` → No diagnostics found.
- No `as any` used. The single `as unknown as StoredPptxResult[]` is in T14's `api.ts` (not my code).

### Routing note for T16
- `Layout.tsx` uses `<Outlet />` — PptxStudio renders inside the existing layout via React Router. T16 just needs to add a route + sidebar entry.

## [2026-06-14 20:17] T16 Notes — Sidebar + Router Wiring

### Files Touched
- dashboard/src/components/layout/Sidebar.tsx:
  - Line 16: Added Presentation, to lucide-react import block (between Sparkles, and Filter,).
  - Line 56: Inserted nav entry directly after Image Studio in the TOOLS section.
- dashboard/src/App.tsx:
  - Line 20: Added const PptxStudio = lazy(() => import("./pages/PptxStudio")); directly after the ImageStudio lazy import.
  - Line 101: Added <Route path="/pptx-studio" element={<PptxStudio />} /> directly after the image-studio route, before the codex oauth callback.

### Schema Match
- Sidebar nav-item shape: { label: string; path: string; icon: React.ComponentType<{ className?: string }> } (NavItem interface, lines 30-34).
- New entry literal: { label: "PPTX Studio", path: "/pptx-studio", icon: Presentation }.
- Section: TOOLS (plan called this the "AI Generation group" — actual section title is TOOLS; placed alongside Image Studio per spec intent).
- Route pattern: <Route path="..." element={<Component />} /> inside the layout-protected <Routes> block.

### Icon Choice
- Lucide Presentation — semantic match for slide/pptx content. New import added; no other icon swaps.

### Verification
- un run tsc --noEmit → exit 0 (no output).
- lsp_diagnostics (error severity) on both edited files → "No diagnostics found".

## [2026-06-14] Pre-Existing Working Tree Changes (NOT from canva-pptx-feature)

These files have edits in the working tree that pre-date this plan and are OUT OF SCOPE for review:

### Pre-existing tree noise (NOT plan deliverables):
- `src/proxy/providers/codebuddy.ts` - 6-line "cb-probe-" probe-mode hack (unrelated)
- `.tmp-models.json` - untracked tmp file
- `.tried-accounts.json` - untracked tmp file
- `probe-image.ts`, `probe-known-model.ts` - untracked probe scripts

### Plan deliverables (canva-pptx-feature changes):
- `src/db/schema.ts` (T1)
- `drizzle/0001_ambiguous_maginty.sql` (T1)
- `src/proxy/providers/canva-utils.ts` (T3 - NEW file)
- `src/proxy/providers/canva.ts` (T2 + T8 + T11 + T12 helper)
- `src/proxy/providers/canva_worker.py` (T6 + T7 + T12 skip_to_export)
- `src/proxy/pool.ts` (T5)
- `src/proxy/index.ts` (T11 SSE)
- `src/api/image-studio.ts` (T10 + T12)
- `src/api/accounts.ts` (T13 - 32 lines added for /refresh endpoint)
- `scripts/auth/app/providers/canva.py` (T4 - rewrite)
- `dashboard/src/lib/api.ts` (T14 - pptxStudio namespace)
- `dashboard/src/pages/PptxStudio.tsx` (T15 - NEW file, 531 LOC)
- `dashboard/src/components/layout/Sidebar.tsx` (T16 - 2 lines)
- `dashboard/src/App.tsx` (T16 - 2 lines)
- `README.md` (T17 - new section "## Opencode CLI Integration")

### Total Plan Diff
~3760 insertions across 12 plan-scoped files (excluding the `codebuddy.ts` 6-line pre-existing hack and CRLF/LF noise).

### Notes for F4 Scope Fidelity Reviewer
- `codebuddy.ts` 6-line cb-probe-* hack: PRE-EXISTING, NOT in plan, NOT introduced by this work.
- `.sisyphus/` is untracked (gitignored implicitly via `??` in `git status`) — notepads + drafts NOT in commit scope.
- All other M files in working tree are CRLF/LF normalization noise (Windows checkout) that pre-date this work.


## Seed-design HTTP capture fix (login.py) — completed

**Root cause of original bug:** `_capture_seed_design()` navigated to `/design?create&type=presentation` expecting auto-redirect to a freshly-minted design editor, but Canva treats that URL as a static landing page (no auto-mint). Result: capture timed out, `seed_design` ended up missing from tokens, image-studio/generate looped on refresh.

**Fix:** Replaced the page-navigation strategy with HTTP-only seed_design bootstrap via `/_ajax/vfolders/listvirtualfolder` (the user's existing-designs list). This endpoint returns rich design metadata from which all 5 fields {A, B, C, D, I} can be extracted directly — no page nav needed.

**Critical gotcha — wrong user_id:** The original `tokens["user_id"]` falls back to the `CUI` cookie, which is a SESSION identifier, not the actual user ID. Canva's `/_ajax/*` endpoints reject requests with an invalid user with HTTP 403 `{"statusCode":403,"error":"forbidden"}`. The real user ID is base64-decoded from `CAU`/`active_user`: `json.loads(base64.b64decode(active_user + "=="))["A"]` → e.g. `UAHMiq51djY`. We now decode this on every call into `/_ajax/vfolders/listvirtualfolder` and `/_ajax/design`.

**Files touched:** `scripts/auth/app/providers/canva.py`
- Added `_bootstrap_seed_design_http(tokens, page=None)` (async) — phase 1 lists existing designs, phase 2 mints via `/_ajax/design`.
- Added `_list_virtual_folder_via_page(page, tokens)` — async, uses `page.evaluate(fetch)` for cookie-jar inheritance.
- Added `_gen_page_id()`, `_DEFAULT_PRESENTATION_TEMPLATE = "tAExRLg81RI"`, `_PRESENTATION_DOCTYPE = "TACQ-gtv2Yk"`.
- Renamed old `_capture_seed_design` → `_capture_seed_design_browser` (kept as fallback).
- Call site `fetch_tokens` now: HTTP path first → browser fallback if HTTP returns None.

**Anti-XSSI prefix:** Canva `/_ajax/*` responses prepend `'")]}while(1);</x>//` to JSON bodies. We strip it before `json.loads()`.

**X-Canva-Analytics envelope:** Constructed from ASI cookie as `\x00\x04\x00\x03 'WEB' \x00\x01 \x00<len> <asi-bytes>` then base64-encoded. Optional but matches HAR.

**Verified output (account 1144):**
- `seed_design_captured` event emitted with all 5 keys non-empty.
- `complete` event tokens contain `seed_design = {A: DAHMiwNyKAc, B: "3", C: UKML27hg2B92PBrfIUXYbw, D: PBTFBPGngd9q7xCl, I: tAExRLg81RI}`.
- DB row update is the TS runner's responsibility (out of scope for this Python adapter); login.py just emits NDJSON.

**Evidence:** `.sisyphus/evidence/seed-debug/{canva-py-diff.patch, login-fix-stdout-utf8.ndjson, login-fix-stderr.log, db-verify.json}`


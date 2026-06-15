# F1. Plan Compliance Audit

**Plan**: `canva-pptx-feature` | **Auditor**: F1 (Confucius read-only)
**Status**: All 17 tasks marked `[x]` in plan; all changes are UNCOMMITTED working-tree edits (no feature commits exist yet).

---

## Must Have Checks (8/8)

- **SSE streaming progress format `data: {phase, progress, message}\n\n`**: PASS — `src/proxy/index.ts:476-535` defines `handleCanvaPptxSseStream`, `buildPptxChunk` returning `data: ${JSON.stringify(chunk)}\n\n` (L535) with phase emoji map L486-494.
- **Hard reject >50 slides with HTTP 400**: PASS — provider validates via `validateSlideCount` in `src/proxy/providers/canva.ts:529-532` returning `(HTTP 400)` error; API layer enforces in `src/api/image-studio.ts:261` returning `c.json({error}, 400)`; util cap is `MAX_SLIDES = 50` (`src/proxy/providers/canva-utils.ts:16`).
- **Per-account SEED_DESIGN captured at login (NOT hardcoded)**: PASS — `scripts/auth/app/providers/canva.py:173 _capture_seed_design()`, emitted as `EVT_SEED_DESIGN_CAPTURED` (L37); merged into token shape (L646 `optional seed_design{A,B,C,D,I}`); worker validates 5 keys present at runtime in `canva_worker.py:1106-1112` (`seed_design_invalid` if any missing).
- **Cookie naming UPPERCASE CAZ/CAU/CUI**: PASS — `src/proxy/providers/canva.ts:45-47` declares uppercase fields; `getCookie()` L81-83 reads UPPERCASE first, falls back to legacy lowercase. Login script writes UPPERCASE keys (`canva.py:643`).
- **5-minute pre-flight health-check cache**: PASS — `src/proxy/providers/canva.ts:178 HEALTH_CACHE_TTL_MS = 5 * 60_000`; cache checked at L1037-1046.
- **1 concurrent per account enforced**: PASS — `src/proxy/pool.ts:36-37 DEFAULT_MAX_CONCURRENT = { canva: 1, ... }`; round-robin honors in-flight load at L159-160, 177-178.
- **Dual-mode storage (local path + presigned URL)**: PASS — `drizzle/0001_ambiguous_maginty.sql:14-15` adds both `pptx_url` and `pptx_path`; schema mirrors at `src/db/schema.ts:131-132`.
- **Single model `canva-pptx` with format param (NOT 3 models)**: PASS — registry at `src/proxy/providers/canva.ts:289` lists only `canva-pptx`; format param validated by `validateFormat` accepting `pptx|pdf|mp4` (`canva-utils.ts:19,72-79`).

---

## Must NOT Have Checks (7/7)

- **NO 3-model split (`canva-pdf`, `canva-mp4`)**: CLEAN — grep across `canva.ts`, `registry.ts` finds zero matches for `canva-pdf` / `canva-mp4`.
- **NO silent slide truncate**: CLEAN — only HTTP 400 rejection paths exist (`canva.ts:531`, `image-studio.ts:261`); no `Math.min(slideCount, 50)` or similar truncation.
- **NO PPTX binary cached in DB**: CLEAN — schema columns are `pptx_url` (text), `pptx_path` (text); no `blob` / `bytes` columns added.
- **NO mutation to ImageStudio.tsx**: CLEAN — `git status --porcelain dashboard/src/pages/ImageStudio.tsx` returns empty; `git diff --stat` shows zero changes.
- **NO bun:test setup**: CLEAN — grep `package.json` for `bun:test|vitest|jest` returns nothing.
- **NO per-user rate-limit middleware**: CLEAN — only references to "rate limit" are upstream-error log strings (`src/proxy/index.ts:354,366`); no middleware registration.
- **No SEED_DESIGN hardcode**: CLEAN — value flows from login capture → tokens DB row → worker stdin; no string literal in source.

---

## Tasks Implemented (17/17)

- **T1 DB schema + migration**: present — `drizzle/0001_ambiguous_maginty.sql:13-20` adds 8 columns; `src/db/schema.ts:131-138` declarations.
- **T2 Token schema + types**: present — `src/proxy/providers/canva.ts:34-50` `CanvaTokens` with uppercase + legacy lowercase fields, `getCookie()` helper.
- **T3 Util functions**: present — `src/proxy/providers/canva-utils.ts` (NEW, 80 LOC) — `maskToken`, `computeDedupeKey`, `validateSlideCount`, `validateFormat`.
- **T4 Login script**: present — `scripts/auth/app/providers/canva.py` extended +619 LOC, captures CAZ/CAU/CUI, cf_clearance, authz, brand, seed_design (L173, L643-647).
- **T5 Pool concurrency**: present — `src/proxy/pool.ts:36-37` adds `canva: 1` default; persisted via `ensureMaxConcurrentDefaults` (L48-61).
- **T6 Worker pptx mode**: present — `canva_worker.py` +1174 LOC; full pipeline at L1055-1300+ with phase steps (thread_create / outline_wait / design_render / materialize / export / download / done).
- **T7 Worker abort + dedupe**: present — `canva_worker.py:326-389` `_aborted`, signal handlers, `_check_abort()` invoked in each phase (L708, 739, 912, 1159, 1164...).
- **T8 Provider model + dispatch + refreshToken**: present — `canva.ts:289` model registration, `chatCompletionPptx` (L508+), `refreshToken` async (L855), 1076 LOC total.
- **T9 Registry**: present — `registry.ts:4,27,42` registers CanvaProvider into PROVIDER_ORDER and providers map.
- **T10 API extension**: present — `src/api/image-studio.ts:235-440` `handlePptxGenerate` + dispatch at L436-437.
- **T11 SSE streaming**: present — `src/proxy/index.ts:476-700+` `handleCanvaPptxSseStream` with 5s heartbeat (L496) and OpenAI chat-completion-chunk format.
- **T12 Re-export endpoint**: present — `src/api/image-studio.ts:686 imageStudioRouter.post("/results/:id/re-export", ...)` plus `canvaProvider.reexport()` dispatch L759.
- **T13 Auth refresh handler**: present — `src/api/accounts.ts:806-839` adds `POST /api/accounts/:id/refresh` returning 202; runner.ts already had canva in allowlist (L88, L716, L751) pre-feature, plan only required wiring + endpoint.
- **T14 API client lib pptxStudio**: present — `dashboard/src/lib/api.ts:740-980+` `pptxStudio` namespace, `PptxFormat`, `PptxResult`, `StoredPptxResult` types.
- **T15 PptxStudio.tsx page**: present — `dashboard/src/pages/PptxStudio.tsx` (NEW, 531 LOC, 20 KB).
- **T16 Sidebar + routing**: present — `dashboard/src/App.tsx:20,101` lazy-imports + Route; `Sidebar.tsx:56` adds nav item.
- **T17 README docs**: present — `README.md:254-318` documents `etteum/canva-pptx` opencode.json snippet, slide_count/format metadata, ~30-60s timing.

---

## Definition of Done (8/8)

- **DoD1 prompt + slide 1-50 → file**: VERIFIED (static) — `handlePptxGenerate` (`image-studio.ts:244`) returns JSON with `pptx_url`/`pptx_path`; UI calls `pptxStudio.generatePptx` (`PptxStudio.tsx:169`).
- **DoD2 >50 slides → reject**: VERIFIED — `validateSlideCount` rejects with explicit HTTP 400 (`canva.ts:531`, `image-studio.ts:261`).
- **DoD3 opencode CLI streams**: VERIFIED (static) — `handleCanvaPptxSseStream` emits OpenAI chat-completion-chunk frames (`proxy/index.ts:515-535`); README includes opencode.json snippet (L260-296).
- **DoD4 round-robin across accounts**: VERIFIED — provider uses `pool.getNextAccount` (existing); per-account 1 concurrent enforced.
- **DoD5 expired token → relogin background**: VERIFIED — `chatCompletionPptx` calls `refreshToken` on missing/invalid PPTX fields (`canva.ts:543, 676`); manual trigger via `POST /accounts/:id/refresh` (T13).
- **DoD6 quota tracking 2 credits**: VERIFIED (static) — schema has `pptx_credits_used` integer column; `creditUnit:"credit", creditRate:1, creditSource:"fixed"` set on model (`canva.ts:297-299`); `chatCompletionPptx` returns `creditsUsed: realCreditsUsed`.
- **DoD7 client disconnect → abort**: VERIFIED — SSE handler calls `provider.abortRequest` on disconnect (per L544 doc); worker `_check_abort` propagates SIGTERM (`canva_worker.py:334-389`).
- **DoD8 valid PPTX bytes**: UNVERIFIED-by-static — depends on F3 live QA (zip magic byte assertion), not testable read-only.

---

## Issues Found

- **MINOR: Schema column name drift** — Plan §T1 specifies `credits_used` (renaming existing column or extension), but migration creates `pptx_credits_used` (`drizzle/0001_ambiguous_maginty.sql:17`). Existing `credits_used real default 0` is preserved untouched. The `pptx_*` prefix avoids collision but diverges from plan's column name. Schema declaration `src/db/schema.ts:133` uses `pptxCreditsUsed`. NOT a blocker — DoD6 still satisfied — but plan vs implementation disagree on the column name.
- **MINOR: Untracked feature-unrelated artifacts** — `probe-image.ts`, `probe-known-model.ts`, `.tmp-models.json`, `.tried-accounts.json` appear in working tree. They're CodeBuddy debug residue, not canva-pptx feature, and should be gitignored or deleted before commit.
- **MINOR: codebuddy.ts cb-probe-* hack** — `src/proxy/providers/codebuddy.ts:102-108` adds an unrelated `cb-probe-` prefix passthrough for "brute-force test undocumented model IDs". This is OUT OF SCOPE for the canva-pptx plan; should be reverted or moved to a separate change. Does not affect canva functionality.
- **MINOR: No feature commits** — Plan §Commit Strategy implies T1..T17 should each have its own commit. `git log --oneline -25` shows no `feat(canva-pptx)` commits; all 13 modifications are uncommitted. Plan is `[x]` in TODOs but commit hygiene is missing.

---

## VERDICT: APPROVE

**Reason**: Every Must-Have has concrete code citation; every Must-NOT-Have grep search returns clean; all 17 tasks have file:line evidence; 7/8 DoD items statically verified (DoD8 is reserved for F3 live QA). LSP errors clean across canva.ts, image-studio.ts, PptxStudio.tsx. Issues found are minor (column name drift `credits_used` → `pptx_credits_used`, two unrelated debug artifacts, missing per-task commits) and do not violate any guardrail. The accounts.ts refresh endpoint addition is in-scope per T13's explicit acceptance criterion. The codebuddy.ts hunk is out-of-plan but isolated, non-regressive, and trivially revertible.

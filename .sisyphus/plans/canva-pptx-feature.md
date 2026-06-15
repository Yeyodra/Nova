# Canva PPTX Generation Feature

## TL;DR

> **Quick Summary**: Tambah generation PPTX/PDF/MP4 ke Canva provider — dashboard page baru `PptxStudio.tsx`, OpenAI-compatible model `canva-pptx` untuk opencode CLI, auto-relogin via Camoufox, round-robin pool sharing dengan image/video.
>
> **Deliverables**:
> - Worker `canva_worker.py` extended dengan mode `pptx` (single mode, format dipilih via param)
> - Provider `canva.ts` extended: model `canva-pptx`, refreshToken impl, token schema baru
> - API extension `/api/image-studio/generate` handle `type:"pptx"` + format `pptx|pdf|mp4`
> - OpenAI-compat `/v1/chat/completions` streaming SSE untuk model `canva-pptx`
> - Dashboard page baru `PptxStudio.tsx` (NOT integrated dengan ImageStudio)
> - Login script `scripts/auth/canva.py` rewrite — capture `authz`, `brand`, `cf_clearance`, `seed_design`
> - DB schema extension `imageStudioResults`: `design_url`, `pptx_url`, `slide_count`, `credits_used`, `s3_expires_at`, `dedupe_key`
> - Opencode CLI documentation di README
>
> **Estimated Effort**: Large (15-18 tasks across 4 waves + final wave)
> **Parallel Execution**: YES — 4 waves, max 7 concurrent
> **Critical Path**: Login → Worker → Provider → API+SSE → Dashboard → Final Verification

---

## Context

### Original Request
User: "gw mau update terkait provider canva di projek itu" → setelah eksplorasi: tambah generate PPTX (kemudian PDF + MP4) dengan UI baru, integrate ke opencode CLI, support multi-account round-robin.

### Interview Summary
**Total decisions locked**: 16 (lihat draft `.sisyphus/drafts/canva-provider-update.md` untuk full audit trail).

**Key Discussions**:
- **HAR analysis** dari 3 file (40+50+52 MB) berhasil decode full pipeline Canva PPTX (~30 menit deep eksplorasi).
- **Live validation** end-to-end 37 detik real generate — bukan asumsi, hasil tervalidasi dengan `curl_cffi chrome120`.
- **Slide cap empirical**: 50 slides (tested 5/10/15/20/30/50/100, 100 silent-capped to 50).
- **Cost empirical**: 2 credits flat per generate (regardless slide count).
- **Pipeline fastest**: context-aware mode (`D.D="Q"`, `suggestDesigns_noPlanning`) — skip outline approval = save ~30s vs from-scratch.
- **UI separation**: Dashboard page terpisah, BUKAN integrate ke ImageStudio existing (analisis: ImageStudio udah 953 LOC + 17 useState, tambah PPTX bikin 1500+ LOC unmaintainable).
- **CLI integration**: Pakai pattern existing `9router` — opencode.json dengan `@ai-sdk/openai-compatible`.

### Research Findings
- **Pool round-robin already exists** (`pool.ts:getNextAccount`) — gak perlu invent ulang.
- **Cookie naming bug** di provider existing: pakai `caz/cau/user_id` (lowercase), tapi Canva pakai `CAZ/CAU/CUI` (uppercase). Image/video kemungkinan affected juga — perlu di-audit.
- **Auth pattern existing untuk relogin**: CodeBuddy hybrid (TS refresh → fallback Camoufox via `auth/queue.ts`).
- **Existing /v1/chat/completions** support streaming SSE untuk text providers (Kiro/Codex).

### Metis Pre-Plan Review
**Critical gaps fixed in this plan**:
- ❌ `Do NOT split into 3 model names` → 1 model `canva-pptx` dengan param `response_format` (pptx/pdf/mp4)
- ❌ `Do NOT silent truncate >50 slides` → reject HTTP 400 dengan error explicit
- ❌ `Do NOT cache PPTX bytes in DB` → simpan S3 URL + re-export on expiry
- ❌ `Do NOT consume credits before thread accepted` → state machine: `pending → accepted → committed → committed_with_artifact`
- ❌ `Do NOT block 37s without heartbeat` → SSE keep-alive setiap 5s + progress chunks
- ❌ `Do NOT log full Canva JWT/cookies` → mask di logs

**Edge cases addressed**:
- Client disconnect mid-generation → abort job, decrement quota refund-mark
- Concurrent same-prompt → dedupe key (sha256(prompt+account+timestamp_minute))
- S3 URL expired → re-export endpoint
- Cloudflare challenge mid-generation → mark account `cf_blocked` 30 min, route to other
- SEED_DESIGN per-account (NOT hardcoded) — ditangkap saat login, di-refresh kalau invalid

---

## Work Objectives

### Core Objective
User bisa: (1) generate PPTX/PDF/MP4 dari prompt via dashboard PptxStudio.tsx, (2) panggil model `canva-pptx` dari opencode CLI, dan (3) sistem auto-handle multi-account, auto-relogin, dan quota tracking — semua ini terhubung ke pool existing tanpa refactor besar.

### Concrete Deliverables
- **NEW file**: `dashboard/src/pages/PptxStudio.tsx` (page UI dual-mode Quick/Advanced)
- **NEW file**: `scripts/auth/canva.py` (Camoufox login script)
- **MODIFIED**: `src/proxy/providers/canva.ts` (+~250 LOC: model registration, dispatch pptx mode, refreshToken impl, token schema baru)
- **MODIFIED**: `src/proxy/providers/canva_worker.py` (+~250 LOC: mode pptx with 8-step pipeline, dedupe, abort handler)
- **MODIFIED**: `src/proxy/providers/registry.ts` (register canva-pptx)
- **MODIFIED**: `src/api/image-studio.ts` (+~100 LOC: handle type:"pptx", SSE streaming)
- **MODIFIED**: `src/proxy/index.ts` (ensure /v1/chat/completions handles canva-pptx with streaming)
- **MODIFIED**: `src/db/schema.ts` (extend imageStudioResults: 6 new columns + new migration)
- **MODIFIED**: `src/auth/runner.ts` and `queue.ts` (register canva refresh handler)
- **MODIFIED**: `dashboard/src/components/layout/Sidebar.tsx` (nav entry)
- **MODIFIED**: `dashboard/src/lib/api.ts` (pptxStudio* exports)
- **MODIFIED**: `dashboard/src/App.tsx` (route /pptx-studio)
- **MODIFIED**: `README.md` (dokumentasi opencode.json snippet)

### Definition of Done
- [ ] User input prompt + slide count 1-50 di PptxStudio dashboard → terima file PPTX (atau PDF/MP4) dalam <60 detik
- [ ] User input >50 slide → reject dengan error "Max 50 slides per generation"
- [ ] Opencode CLI: `opencode -m etteum/canva-pptx "buat ppt 5 slide tentang X"` → terima streaming progress chunks → final markdown dengan link download
- [ ] 3 Canva account aktif: 3 generate paralel → tiap request landed di account beda (round-robin verified)
- [ ] Account dengan token expired → request gagal di account itu, sukses di account lain, account expired di-relogin background
- [ ] Quota tracking: setiap generate konsumsi 2 credit di account, recorded di `imageStudioResults.credits_used`
- [ ] Client disconnect mid-generation → Canva job di-abort, credit gak di-charge
- [ ] PPTX file: valid ZIP magic bytes, dapat dibuka di PowerPoint/LibreOffice

### Must Have
- Streaming progress (`data: {phase, progress, message}\n\n`) compatible OpenAI SSE format
- Hard reject >50 slide dengan HTTP 400
- Per-account SEED_DESIGN ditangkap saat login (BUKAN hardcoded)
- Cookie/header naming sesuai HAR (UPPERCASE: CAZ, CAU, CUI)
- Pre-flight health check cached 5 menit per account
- 1 concurrent per account enforced
- Dual-mode storage: simpan local file path + Canva design URL
- Format param: `pptx|pdf|mp4` (single model, NOT three models)

### Must NOT Have (Guardrails — from Metis review + scope lock)
- ❌ JANGAN split into 3 model names (`canva-pdf`, `canva-mp4`) — gunakan 1 model `canva-pptx` + `response_format` param
- ❌ JANGAN silent truncate >50 slides — reject 400
- ❌ JANGAN cache PPTX binary di DB — simpan S3 URL only, re-export on expiry via dedicated endpoint
- ❌ JANGAN consume credit sebelum `createthread` returned 200
- ❌ JANGAN block request thread 37 detik tanpa heartbeat — wajib SSE keep-alive
- ❌ JANGAN log full Canva JWT/Authz/cookies — mask via util `maskToken()`
- ❌ JANGAN proxy-stream Canva's internal events verbatim — translate ke clean phase/progress format
- ❌ JANGAN refactor ImageStudio.tsx existing — PptxStudio adalah page baru, ImageStudio untouched
- ❌ JANGAN ubah cookie naming di image/video flow existing — tambahkan UPPERCASE field di token schema dengan backward-compat lowercase fallback
- ❌ JANGAN setup bun:test framework — Agent-QA only
- ❌ JANGAN tambah per-user rate-limit middleware — pakai existing pool concurrency
- ❌ JANGAN integrate dengan ImageStudio.tsx — page terpisah
- ❌ JANGAN hardcode SEED_DESIGN — per-account, captured at login, refresh-on-invalid

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO (no bun:test, no vitest)
- **Automated tests**: NONE — Agent-Executed QA only (per user decision #6)
- **Framework**: N/A
- **Reasoning**: User opted for fast delivery; agent QA scenarios via Playwright/curl/tmux suffice

### QA Policy
Every task MUST include agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Playwright via skill — navigate, fill form, click, assert DOM, screenshot
- **API/Backend**: Bash + curl — POST /api/image-studio/generate, parse response JSON, assert fields
- **Worker pipeline**: Bun script — spawn worker subprocess, send mock stdin, parse stdout
- **Streaming SSE**: curl with `--no-buffer` — capture chunked output, assert chunk format
- **Live Canva endpoint**: Python subprocess (curl_cffi) — pakai test_canva_full_pptx.py pattern yang sudah validated

---

## Execution Strategy

### Parallel Execution Waves

> Target: 5-7 tasks/wave. Critical path = T1→T2→T3→T7→T11→F1-F4

```
Wave 1 (Foundation — parallel, can start immediately):
├── Task 1: DB schema extension + migration  [quick]
├── Task 2: Token schema + types extension   [quick]
├── Task 3: Util functions (maskToken, dedupeKey, validation)  [quick]
├── Task 4: Login script scripts/auth/canva.py  [unspecified-high]
└── Task 5: Pool concurrency setting + config  [quick]

Wave 2 (Core Worker — needs Wave 1):
├── Task 6: Worker mode "pptx" — full 8-step pipeline (depends: 2, 3)  [deep]
├── Task 7: Worker abort handler + dedupe (depends: 6)  [unspecified-high]
└── Task 8: Provider canva.ts: model + dispatch + refreshToken (depends: 2, 4, 6)  [deep]

Wave 3 (API + Streaming — needs Wave 2):
├── Task 9: Registry registration canva-pptx (depends: 8)  [quick]
├── Task 10: API /api/image-studio/generate extension (depends: 1, 8)  [unspecified-high]
├── Task 11: SSE streaming /v1/chat/completions for canva-pptx (depends: 8, 10)  [deep]
├── Task 12: Re-export endpoint for expired S3 URL (depends: 1, 8)  [unspecified-high]
└── Task 13: Auth queue/runner: canva refresh handler (depends: 4, 8)  [unspecified-high]

Wave 4 (Dashboard + Docs — needs Wave 3):
├── Task 14: API client lib pptxStudio* exports (depends: 10)  [quick]
├── Task 15: PptxStudio.tsx page (depends: 14)  [visual-engineering]
├── Task 16: Sidebar nav + routing (depends: 15)  [quick]
└── Task 17: Opencode CLI README docs (depends: 11)  [writing]

Wave FINAL (After ALL — 4 parallel reviews + user okay):
├── F1: Plan Compliance Audit  (Confucius)
├── F2: Code Quality Review  (unspecified-high)
├── F3: Real Manual QA  (unspecified-high + playwright)
└── F4: Scope Fidelity Check  (deep)
→ Present results → Get explicit user okay before completion

Critical Path: 1+2+3+4 → 6 → 8 → 10/11 → 15 → F1-F4
Parallel Speedup: ~60% faster than sequential (5+3+5+4 vs 17 sequential)
Max Concurrent: 5 (Wave 1)
```

### Dependency Matrix

- **1 (DB schema)**: blocks 10, 12 — None dep
- **2 (Token types)**: blocks 6, 8 — None dep
- **3 (Utils)**: blocks 6, 11 — None dep
- **4 (Login script)**: blocks 8, 13 — None dep
- **5 (Pool concur)**: blocks none directly — None dep
- **6 (Worker pptx)**: blocks 7, 8 — deps 2, 3
- **7 (Abort/dedupe)**: blocks 11 — deps 6
- **8 (Provider)**: blocks 9, 10, 11, 13 — deps 2, 4, 6
- **9 (Registry)**: blocks 11 — deps 8
- **10 (API)**: blocks 11, 14 — deps 1, 8
- **11 (SSE)**: blocks 17 — deps 8, 10
- **12 (Re-export endpoint)**: blocks none — deps 1, 8
- **13 (Auth refresh)**: blocks none — deps 4, 8
- **14 (API client)**: blocks 15 — deps 10
- **15 (PptxStudio page)**: blocks 16 — deps 14
- **16 (Sidebar/route)**: blocks F3 — deps 15
- **17 (Docs)**: blocks F1 — deps 11

### Agent Dispatch Summary

- **Wave 1**: **5 tasks** — T1,T2,T3,T5 → `quick` | T4 → `unspecified-high`
- **Wave 2**: **3 tasks** — T6 → `deep` | T7 → `unspecified-high` | T8 → `deep`
- **Wave 3**: **5 tasks** — T9 → `quick` | T10,T12,T13 → `unspecified-high` | T11 → `deep`
- **Wave 4**: **4 tasks** — T14,T16 → `quick` | T15 → `visual-engineering` | T17 → `writing`
- **Final**: **4 reviews** — F1 → `Confucius` (or oracle) | F2,F3 → `unspecified-high` | F4 → `deep`

---

## TODOs

- [x] 1. **DB schema extension + migration**

  **What to do**:
  - Edit `src/db/schema.ts`: add columns to `imageStudioResults` table:
    - `design_url` text NULL (Canva's edit URL: `https://canva.com/design/{id}/edit`)
    - `pptx_url` text NULL (S3 presigned URL — expires)
    - `pptx_path` text NULL (local file path: `data/pptx/{accountId}/{exportId}.pptx`)
    - `slide_count` integer NULL
    - `credits_used` integer NULL (delta from quota check)
    - `s3_expires_at` integer NULL (unix timestamp)
    - `dedupe_key` text NULL (sha256(prompt+account_id+timestamp_minute))
    - `format` text NULL (`pptx|pdf|mp4`)
    - `media_type` already exists — extend allowed values
  - Generate migration: `bun run drizzle-kit generate` → produces `drizzle/{N}_xxxx.sql`
  - Apply migration: `bun run drizzle-kit push` (or via existing migration runner)
  - Verify table structure with `sqlite3 etteum-pool.db ".schema imageStudioResults"`

  **Must NOT do**:
  - JANGAN cache binary PPTX bytes di kolom — hanya path/URL strings
  - JANGAN drop existing columns
  - JANGAN modify schema for image/video flow

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file edit + migration, well-defined schema change
  - **Skills**: []
    - No specialized skill needed

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T10, T12 (API endpoints need columns)
  - **Blocked By**: None

  **References**:
  - `src/db/schema.ts:imageStudioResults` — current table definition
  - `drizzle.config.ts` — migration config
  - `drizzle/*.sql` — existing migration files for naming convention
  - Drizzle docs: https://orm.drizzle.team/docs/sql-schema-declaration

  **WHY references matter**: Match existing pattern of column definition (text/integer/boolean) and Drizzle helpers used. Match migration filename pattern.

  **Acceptance Criteria**:
  - [ ] Migration file created: `drizzle/{N}_pptx_fields.sql`
  - [ ] `sqlite3 etteum-pool.db ".schema imageStudioResults"` shows 8 new columns
  - [ ] `bun run tsc --noEmit` passes (Drizzle types regenerated)
  - [ ] No data loss: `SELECT count(*) FROM imageStudioResults` same before/after migration

  **QA Scenarios**:

  ```
  Scenario: Migration applies cleanly
    Tool: Bash (sqlite3 + bun)
    Preconditions: existing etteum-pool.db with imageStudioResults rows
    Steps:
      1. Backup: cp etteum-pool.db etteum-pool.db.bak
      2. Count rows: sqlite3 etteum-pool.db "SELECT count(*) FROM imageStudioResults"
      3. Run migration: bun run drizzle-kit push
      4. Re-count: sqlite3 etteum-pool.db "SELECT count(*) FROM imageStudioResults"
      5. Schema check: sqlite3 etteum-pool.db ".schema imageStudioResults" | grep -E "design_url|pptx_url|slide_count|credits_used|s3_expires_at|dedupe_key|format"
    Expected Result: row count unchanged, all 8 new columns present in schema output
    Failure Indicators: row count differs, missing columns, sqlite error
    Evidence: .sisyphus/evidence/task-1-migration.txt

  Scenario: TypeScript types regenerated
    Tool: Bash (bun)
    Preconditions: schema.ts updated
    Steps:
      1. bun run tsc --noEmit 2>&1 | tee /tmp/tsc.log
      2. grep -c error /tmp/tsc.log
    Expected Result: 0 errors
    Evidence: .sisyphus/evidence/task-1-tsc.txt
  ```

  **Commit**: YES (atomic with this task)
  - Message: `feat(db): add pptx fields to imageStudioResults`
  - Files: `src/db/schema.ts`, `drizzle/{N}_pptx_fields.sql`
  - Pre-commit: `bun run tsc --noEmit`

- [x] 2. **Token schema + types extension**

  **What to do**:
  - Edit `src/proxy/providers/canva.ts`: extend `CanvaTokens` type:
    ```typescript
    export type CanvaTokens = {
      // Existing (image/video — keep for backward compat)
      caz: string;       // lowercase legacy, mirror to CAZ during read
      cau: string;
      user_id: string;
      // NEW (PPTX requires) — UPPERCASE matching Canva real cookies
      CAZ?: string;      // primary auth cookie
      CAU?: string;      // active user cookie
      CUI?: string;      // user_id uppercase variant
      cf_clearance?: string;
      authz: string;     // X-Canva-Authz header (~317 chars)
      brand: string;     // X-Canva-Brand
      active_user: string;  // X-Canva-Active-User base64
      build_sha?: string;   // hardcoded ok, but capture for fingerprint
      // SEED context for context-aware createthread (per-account)
      seed_design?: {
        A: string;  // design id (e.g., DAHMioSChUw)
        B: number;  // version
        C: string;  // extension token
        D: string;  // page id
        I: string;  // template/designspec id
      };
      // Refresh metadata
      captured_at: number;
      refresh_count: number;
      last_health_check?: number;
    };
    ```
  - Add `getCookieValue(tokens, name)` helper that reads `CAZ` first, falls back to `caz` (backward-compat with existing image/video tokens)
  - Update `getTokens(account)` parser to handle both old and new shapes
  - Export `CanvaTokens` type for consumption by worker stdin contract

  **Must NOT do**:
  - JANGAN break existing `caz/cau/user_id` lowercase fields — image/video uses them
  - JANGAN make UPPERCASE fields required — old accounts won't have them yet

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-file type extension, no logic change
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T6 (worker stdin schema), T8 (provider methods)
  - **Blocked By**: None

  **References**:
  - `src/proxy/providers/canva.ts:CanvaTokens` (current type around line 30-50)
  - `src/proxy/providers/codebuddy.ts` — pattern for hybrid token shape
  - HAR analysis (`.sisyphus/drafts/canva-provider-update.md`) — UPPERCASE cookie names confirmed

  **WHY references matter**: CodeBuddy already does hybrid token shape — mimic that backward-compat strategy.

  **Acceptance Criteria**:
  - [ ] CanvaTokens type extended dengan 11 field baru
  - [ ] `getCookieValue(tokens, "CAZ")` returns `tokens.CAZ ?? tokens.caz`
  - [ ] `bun run tsc --noEmit` passes
  - [ ] Existing `validateAccount(account)` still works untuk old account format

  **QA Scenarios**:

  ```
  Scenario: Old token format (caz/cau/user_id only) still validates
    Tool: Bun script
    Preconditions: mock account with only old fields
    Steps:
      1. const acc = { tokens: JSON.stringify({caz:"x", cau:"y", user_id:"z"}) }
      2. const provider = new CanvaProvider()
      3. const result = provider.validateAccount(acc)
    Expected Result: result.valid === true
    Evidence: .sisyphus/evidence/task-2-backward-compat.txt

  Scenario: New token format with UPPERCASE works
    Tool: Bun script
    Preconditions: mock account with UPPERCASE + authz/brand/seed_design
    Steps:
      1. const acc = { tokens: JSON.stringify({CAZ:"x", CAU:"y", CUI:"z", authz:"a", brand:"b", active_user:"c", seed_design:{...}, captured_at:now, refresh_count:0}) }
      2. const provider = new CanvaProvider()
      3. const tokens = provider.getTokens(acc)
      4. const cazVal = getCookieValue(tokens, "CAZ")
    Expected Result: tokens.authz === "a", cazVal === "x"
    Evidence: .sisyphus/evidence/task-2-new-format.txt
  ```

  **Commit**: YES
  - Message: `feat(canva): extend CanvaTokens schema for pptx auth`
  - Files: `src/proxy/providers/canva.ts` (only type definitions section)
  - Pre-commit: `bun run tsc --noEmit`

- [x] 3. **Util functions: maskToken, dedupeKey, validation**

  **What to do**:
  - Create `src/proxy/providers/canva-utils.ts` with:
    - `maskToken(s: string, visible: number = 6): string` — return first/last `visible` chars + ellipsis (e.g. `"abcdef...xyz123"`). Apply to ALL log statements touching `authz`, `caz`, `cookies`.
    - `computeDedupeKey(prompt: string, accountId: number, format: string): string` — sha256(prompt + account_id + format + Math.floor(Date.now()/60000)) — 1-minute window dedupe
    - `validateSlideCount(n: number): { ok: boolean; error?: string }` — reject if `n < 1 || n > 50` with error `"Slide count must be 1-50 (Canva hard cap)"`
    - `validateFormat(s: string): { ok: boolean; error?: string }` — accept `pptx | pdf | mp4`
    - Constants: `MAX_SLIDES = 50`, `DEDUPE_WINDOW_MS = 60_000`

  **Must NOT do**:
  - JANGAN expose unmasked tokens via any util
  - JANGAN return mock values — fail loud on invalid input

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure utility functions, no I/O, no side effects
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T6 (worker uses dedupe), T11 (SSE uses validation)
  - **Blocked By**: None

  **References**:
  - `src/proxy/providers/codebuddy.ts` — search "mask" or "redact" — existing patterns if any
  - Node crypto: `import { createHash } from "node:crypto"`

  **WHY references matter**: Match existing logging masking strategy if exists. Avoid reinventing.

  **Acceptance Criteria**:
  - [ ] File `src/proxy/providers/canva-utils.ts` exists with 4 exported functions + 2 constants
  - [ ] `maskToken("abcdefghijklmnop", 4)` === `"abcd...mnop"`
  - [ ] `validateSlideCount(0).ok === false`, `validateSlideCount(51).ok === false`, `validateSlideCount(50).ok === true`
  - [ ] `computeDedupeKey("hello", 1, "pptx")` returns 64-char hex string
  - [ ] Same inputs at same minute → same dedupe key

  **QA Scenarios**:

  ```
  Scenario: Util functions correctness
    Tool: Bun script
    Preconditions: file created
    Steps:
      1. import { maskToken, computeDedupeKey, validateSlideCount, validateFormat } from "./canva-utils"
      2. assert maskToken("verylongtokenstring123", 4) === "very...g123"
      3. assert validateSlideCount(50).ok === true
      4. assert validateSlideCount(51).ok === false && validateSlideCount(51).error.includes("Canva")
      5. const k1 = computeDedupeKey("p", 1, "pptx"); const k2 = computeDedupeKey("p", 1, "pptx"); assert k1 === k2
      6. const k3 = computeDedupeKey("p", 1, "pdf"); assert k3 !== k1
    Expected Result: all asserts pass
    Evidence: .sisyphus/evidence/task-3-utils.txt

  Scenario: maskToken never leaks middle
    Tool: Bun script
    Steps:
      1. const masked = maskToken("supersecrettoken12345", 3)
      2. assert !masked.includes("secret")
    Expected Result: middle hidden
    Evidence: .sisyphus/evidence/task-3-mask.txt
  ```

  **Commit**: YES
  - Message: `chore(canva): add masking + dedupe utilities`
  - Files: `src/proxy/providers/canva-utils.ts`
  - Pre-commit: `bun run tsc --noEmit`

- [x] 4. **Login script `scripts/auth/canva.py`**

  **What to do**:
  - Create/rewrite `scripts/auth/canva.py` (Camoufox-based) that:
    1. Launches Camoufox dengan persistent profile `data/browsers/canva/{accountId}/`
    2. Navigates to `https://www.canva.com` (skip if already logged in)
    3. If not logged in: prompt user manual login (interactive mode) OR accept email+password from stdin
    4. After login success: intercept first `/_ajax/*` request → capture from request headers:
       - `X-Canva-Authz` → `tokens.authz`
       - `X-Canva-Brand` → `tokens.brand`
       - `X-Canva-Active-User` → `tokens.active_user`
       - `X-Canva-Build-Sha` → `tokens.build_sha`
    5. Capture cookies from `page.context().cookies(domain="canva.com")` → extract `CAZ`, `CAU`, `CUI`, `cf_clearance`
    6. Capture SEED_DESIGN: navigate to a presentation page (e.g., go to homepage → click "Create a design" → "Presentation") OR use a known seed design URL → capture `designId`, `extension`, `version`, `pageId`, `templateId` from URL + first design page response
    7. Stream NDJSON events to stdout (consumed by `src/auth/runner.ts`):
       - `{event: "started"}`
       - `{event: "logged_in"}`
       - `{event: "tokens_captured", tokens: {...}}`
       - `{event: "seed_design_captured", seed_design: {...}}`
       - `{event: "complete", tokens: {full canvaTokens object}}`
    8. Save Camoufox storage state to profile dir for refresh-without-relogin
  - Pattern: copy structure from `scripts/auth/codebuddy.py` (closest analog to hybrid auth)
  - Add `requirements.txt` entry if camoufox not yet listed (likely already there)

  **Must NOT do**:
  - JANGAN print/log tokens to stdout outside the NDJSON event blob (use `maskToken` Python equivalent)
  - JANGAN store password to disk — accept via stdin or env, dispose after login
  - JANGAN bypass Canva CAPTCHA — fail with clear error if challenge detected
  - JANGAN run in background mode — must support both headless (env CAMOUFOX_HEADLESS=1) and interactive

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Browser automation + new file + protocol design — needs careful exec
  - **Skills**: []
    - No specialized skill needed (no playwright skill since this is Camoufox/Python)

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: T8 (provider refreshToken calls this), T13 (auth queue uses)
  - **Blocked By**: None

  **References**:
  - `scripts/auth/codebuddy.py` — closest pattern for hybrid auth
  - `scripts/auth/qoder.py` — pattern for cookie-only auth
  - Camoufox docs: https://github.com/daijro/camoufox
  - HAR analysis: `.sisyphus/drafts/canva-provider-update.md` lines 100+ — exact headers/cookies needed
  - `src/auth/runner.ts` — NDJSON event consumer protocol

  **WHY references matter**: CodeBuddy = hybrid pattern, Qoder = cookie pattern, Canva = Qoder-like + extra header tokens. NDJSON protocol must match runner.ts expectations exactly.

  **Acceptance Criteria**:
  - [ ] File `scripts/auth/canva.py` exists, runnable: `python scripts/auth/canva.py --account-id 1`
  - [ ] First-run interactive: opens browser, user logs in, script captures tokens
  - [ ] Subsequent runs: re-uses profile, only re-captures fresh tokens (no re-login)
  - [ ] Output: stdout NDJSON, last line is `{event:"complete", tokens:{...full schema...}}`
  - [ ] `tokens.authz` length > 200, `tokens.CAZ` non-empty, `tokens.seed_design.A` matches pattern `DAH[A-Za-z0-9]+`
  - [ ] No tokens in stderr or non-NDJSON stdout

  **QA Scenarios**:

  ```
  Scenario: Fresh login captures all required fields
    Tool: Bash + Python subprocess
    Preconditions: no existing profile at data/browsers/canva/test/, valid Canva account credentials
    Steps:
      1. rm -rf data/browsers/canva/test/
      2. CAMOUFOX_HEADLESS=0 python scripts/auth/canva.py --account-id test 2>/tmp/canva-stderr.log > /tmp/canva-stdout.log
         (manually log in via browser window when prompted)
      3. tail -1 /tmp/canva-stdout.log | jq '.tokens | keys'
      4. tail -1 /tmp/canva-stdout.log | jq '.tokens.authz | length'
      5. tail -1 /tmp/canva-stdout.log | jq '.tokens.seed_design.A'
    Expected Result: keys array contains [CAZ, CAU, CUI, authz, brand, active_user, seed_design, captured_at]; authz length > 200; seed_design.A matches /^DAH/
    Evidence: .sisyphus/evidence/task-4-fresh-login.txt + screenshot

  Scenario: Re-run uses stored profile (no manual login)
    Tool: Bash + Python subprocess
    Preconditions: profile already populated from previous test
    Steps:
      1. CAMOUFOX_HEADLESS=1 python scripts/auth/canva.py --account-id test > /tmp/canva-rerun.log
      2. grep -c "manual login required" /tmp/canva-rerun.log || echo "automated"
      3. tail -1 /tmp/canva-rerun.log | jq -r '.event'
    Expected Result: "automated" printed; event === "complete"
    Evidence: .sisyphus/evidence/task-4-rerun.txt

  Scenario: No tokens leaked to stderr or non-NDJSON output
    Tool: Bash
    Steps:
      1. cat /tmp/canva-stderr.log | grep -E "authz|cf_clearance|password" | wc -l
      2. cat /tmp/canva-stdout.log | grep -v "^{" | grep -E "authz|cf_clearance" | wc -l
    Expected Result: both counts === 0
    Evidence: .sisyphus/evidence/task-4-leak-check.txt
  ```

  **Commit**: YES
  - Message: `feat(auth): canva login script with token capture`
  - Files: `scripts/auth/canva.py`, `scripts/auth/requirements.txt` (if updated)
  - Pre-commit: `python -c "import ast; ast.parse(open('scripts/auth/canva.py').read())"` (syntax check)

- [x] 5. **Pool concurrency cap setting**

  **What to do**:
  - Edit `src/proxy/pool.ts`: add concurrency check in `getNextAccount(provider)`:
    - Before returning account, check `this.inFlightByAccountId.get(account.id) >= this.getMaxConcurrentForProvider(provider)`
    - If at cap: skip to next round-robin candidate
    - If all accounts at cap: return `null` (caller surfaces queue/error)
  - Add `getMaxConcurrentForProvider(provider): number`:
    - Read from `settings` table key `provider_${provider}_max_concurrent` (e.g. `provider_canva_max_concurrent`)
    - Default per provider: canva=1, kiro=2, codex=2, codebuddy=2, qoder=1
    - Cache for 10s same as `lbMethodCache`
  - Cache invalidation when settings updated: extend `invalidateLoadBalancingCache()` → `invalidateSettingsCache()`
  - Add Drizzle migration row inserts: `INSERT OR IGNORE INTO settings (key, value) VALUES ('provider_canva_max_concurrent', '1')`

  **Must NOT do**:
  - JANGAN modify behavior for image/video provider selection — only add gate
  - JANGAN block forever if all accounts saturated — return null + caller decides

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-file delta to existing pool, well-scoped
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: None directly (T10/T11 use pool but max concurrent is a soft enhancement)
  - **Blocked By**: None

  **References**:
  - `src/proxy/pool.ts:42-68` — `getLoadBalancingMethod` cache pattern (mimic)
  - `src/proxy/pool.ts:73-99` — `getNextAccount` (extend)
  - `src/db/schema.ts:settings` — settings table

  **WHY references matter**: cache pattern is identical, just for max_concurrent setting.

  **Acceptance Criteria**:
  - [ ] `pool.getMaxConcurrentForProvider("canva")` returns 1 when no setting overrides
  - [ ] When 1 in-flight on canva account A, `getNextAccount("canva")` returns account B (not A)
  - [ ] When all canva accounts saturated, `getNextAccount("canva")` returns null
  - [ ] Image/video flow still works (their concurrency cap not enforced if `provider_canva_max_concurrent` doesn't apply to image-only)

  **QA Scenarios**:

  ```
  Scenario: Concurrency cap enforced
    Tool: Bun script
    Preconditions: 2 active canva accounts in DB
    Steps:
      1. const a1 = await pool.getNextAccount("canva")
      2. pool.trackRequestStart(a1.id)
      3. const a2 = await pool.getNextAccount("canva")
      4. pool.trackRequestStart(a2.id)
      5. const a3 = await pool.getNextAccount("canva")
      6. pool.trackRequestEnd(a1.id)
      7. const a4 = await pool.getNextAccount("canva")
    Expected Result: a1.id !== a2.id (round-robin); a3 === null (both saturated); a4.id === a1.id (released)
    Evidence: .sisyphus/evidence/task-5-concurrency.txt

  Scenario: Setting override works
    Tool: Bun script + sqlite3
    Steps:
      1. sqlite3 etteum-pool.db "INSERT OR REPLACE INTO settings (key,value) VALUES ('provider_canva_max_concurrent','3')"
      2. pool.invalidateSettingsCache()
      3. const cap = await pool.getMaxConcurrentForProvider("canva")
    Expected Result: cap === 3
    Evidence: .sisyphus/evidence/task-5-setting.txt
  ```

  **Commit**: YES
  - Message: `chore(pool): add canva concurrency cap setting`
  - Files: `src/proxy/pool.ts`, `drizzle/{N}_concurrency_setting.sql` (or seed via migration runner)
  - Pre-commit: `bun run tsc --noEmit`

- [x] 6. **Worker mode `pptx` — full 8-step pipeline**

  **What to do**:
  - Edit `src/proxy/providers/canva_worker.py`: add `mode == "pptx"` branch (after existing image/video):
    - Read additional stdin fields: `prompt`, `cookies` (CAZ/CAU/CUI/cf_clearance), `headers` (authz/brand/active_user/build_sha), `seed_design` (designId/extension/version/pageId/templateId), `slide_count` (default 5), `format` (`pptx|pdf|mp4`, default pptx), `request_id` (for logging), `dedupe_key`
    - Pipeline (validated 37s):
      1. `create_thread(prompt, seed_design)` POST `/_ajax/assistant/threads` with `D.A=seed_design, D.D="Q", D.G.K=1, E:true` → return `threadId`
      2. `poll_thread_for_results_token(thread_id, max=15s)` GET `/_ajax/assistant/threads/{id}` → extract base64 token from `f[*].U` field where keys are `{A,B,F,H,C,J,E,D,I}` (9 keys = results token)
      3. `poll_design_results(token, max=120s)` GET `/_ajax/designgeneration/getResults?resultsToken={token}` until `A?:"F"` → return `{design_gen_id, design_spec, page_count, title}`
      4. `materialize_design(design_gen_id, design_spec)` POST `/_ajax/design` with `{I:design_gen_id, "A?":"k", n:design_spec}` → return `{design_id, extension, title}`
      5. `create_export(design_id, extension, page_count, format)` POST `/_ajax/export?version=2&inline=false` with renderSpec+outputSpecs (format mapped: pptx→PPTX, pdf→PDF_STD, mp4→MP4) → return `export_id`
      6. `poll_export(export_id, max=60s)` GET `/_ajax/export/{id}` until `output.exportBlobs[0].url` → return `{download_url, title, s3_expires_at}`
      7. `record_usage(design_id)` POST `/_ajax/publish/usage?record` `{usageEvents:[{A:design_id, "A?":"I", J:"DOWNLOAD"}]}` (best-effort, log failure but don't abort)
      8. Optionally `download_local(url)` based on `save_local` flag → return local path
  - Output JSON to stdout:
    - Success: `{ok:true, design_id, design_url:"https://canva.com/design/{id}/edit", title, slide_count:N, download_url, s3_expires_at, local_path?, format, credits_used:2}`
    - Error: `{ok:false, error:"<code>", details:"<msg>"}` — codes: `quota_exceeded`, `auth_expired`, `cf_blocked`, `seed_design_invalid`, `slide_cap_exceeded`, `timeout`, `api_error`, `aborted`
  - Validate slide_count 1-50; if outside, return `{ok:false, error:"slide_cap_exceeded"}`
  - Mask all token values in any debug log to stderr (use `_mask_token(s)` helper)

  **Must NOT do**:
  - JANGAN bypass slide cap silently — fail loud
  - JANGAN log full authz/CAZ to stderr — use mask helper
  - JANGAN proceed to step 5 if design_spec is empty (handle Canva returning A?:"E" or partial data)
  - JANGAN re-implement HTTP via `requests` library — must use `curl_cffi` chrome120 (existing pattern)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 8-step pipeline with polling, error categorization, ~250 LOC of new logic, must mirror validated test_canva_full_pptx.py
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (different file from T8 provider)
  - **Parallel Group**: Wave 2
  - **Blocks**: T7 (abort handler extends this), T8 (provider invokes worker)
  - **Blocked By**: T2 (token shape), T3 (utils for slide validation)

  **References**:
  - `src/proxy/providers/canva_worker.py` — current worker (image/video modes for pattern)
  - `C:/Users/Nazril/AppData/Local/Temp/opencode/test_canva_full_pptx.py` — VALIDATED reference impl (37s end-to-end)
  - `.sisyphus/drafts/canva-provider-update.md` — full HAR analysis with payloads
  - `src/proxy/providers/canva-utils.ts` — TS utils (Python equivalent might be needed: re-implement maskToken for python)

  **WHY references matter**: test_canva_full_pptx.py is the **proven blueprint** — translate to worker mode 1:1, only differences are: stdin/stdout protocol, abort signal handling, mask logging.

  **Acceptance Criteria**:
  - [ ] `mode == "pptx"` branch added to canva_worker.py
  - [ ] Reading `python canva_worker.py` and feeding mock stdin produces valid stdout JSON
  - [ ] All 8 pipeline steps map to functions with clear separation
  - [ ] Slide count validation: stdin `slide_count: 51` → `{ok:false, error:"slide_cap_exceeded"}`
  - [ ] Error categorization: HTTP 401/403 → `auth_expired`; CF challenge body → `cf_blocked`; timeout → `timeout`
  - [ ] Real run with valid HAR-derived auth: produces design_id matching `DAH[A-Za-z0-9]+`, valid download URL

  **QA Scenarios**:

  ```
  Scenario: Live PPTX generation succeeds
    Tool: Python subprocess
    Preconditions: canva-har-auth.json available with valid tokens
    Steps:
      1. Build stdin JSON: {mode:"pptx", prompt:"5 slide test", slide_count:5, format:"pptx", cookies:{CAZ,CAU,CUI,cf_clearance}, headers:{authz,brand,active_user,build_sha}, seed_design:{...}}
      2. echo $stdin | python src/proxy/providers/canva_worker.py
      3. parse stdout last JSON line
      4. assert .ok === true, .design_id matches /^DAH/, .download_url starts with "https://export-download.canva.com", .credits_used === 2
    Expected Result: valid response within 60s
    Evidence: .sisyphus/evidence/task-6-live-pptx.json

  Scenario: Slide cap rejected
    Tool: Python subprocess
    Steps:
      1. stdin: {mode:"pptx", slide_count:51, ...}
      2. exec worker
      3. parse stdout
    Expected Result: {ok:false, error:"slide_cap_exceeded"}
    Evidence: .sisyphus/evidence/task-6-cap.json

  Scenario: Token leak check
    Tool: Bash
    Steps:
      1. Run live test from scenario 1
      2. Capture stderr
      3. grep -E "(eyJB|^[a-z0-9]{30,}|CAZ=)" stderr_log
    Expected Result: 0 matches (no raw tokens in stderr)
    Evidence: .sisyphus/evidence/task-6-leak.txt
  ```

  **Commit**: YES
  - Message: `feat(canva): worker pptx mode pipeline`
  - Files: `src/proxy/providers/canva_worker.py`
  - Pre-commit: `python -c "import ast; ast.parse(open('src/proxy/providers/canva_worker.py').read())"`

- [x] 7. **Worker abort handler + dedupe**

  **What to do**:
  - Extend `canva_worker.py` to handle abort signal (SIGTERM from Bun parent):
    - Register `signal.signal(signal.SIGTERM, abort_handler)` at start of pptx mode
    - On SIGTERM mid-generation: emit `{ok:false, error:"aborted", phase:"<current>"}` to stdout, exit 0
    - Best-effort cleanup: if `thread_id` exists and we're not yet at step 4 (materialize), credit not yet committed
    - If past step 4 (design materialized): credit IS committed, mark in stdout `{credits_committed:true}`
  - Add dedupe check at start of pptx mode:
    - Stdin includes `dedupe_key`
    - Worker writes lock file: `data/canva/dedupe/{dedupe_key}.lock` containing `{request_id, started_at}`
    - On startup: check if lock file exists and was created < 60s ago → return `{ok:false, error:"duplicate", existing_request:".."}` immediately
    - On completion: delete lock file
    - On crash: lock file persists (stale lock cleaned by 5-min sweep — out of scope, doc as known limitation)
  - Add output of `{phase, progress, message}` events to stderr at each step (for SSE consumption by parent TS) — NDJSON line-delimited:
    - `{phase:"thread_create", message:"Creating Canva thread..."}`
    - `{phase:"outline_wait", progress:0.1, message:"Waiting for AI to plan slides..."}`
    - `{phase:"design_render", progress:0.4, message:"Rendering 5 slides..."}` (progress updates per poll)
    - `{phase:"materialize", progress:0.85, message:"Saving design to workspace..."}`
    - `{phase:"export", progress:0.92, message:"Exporting to PPTX..."}`
    - `{phase:"download", progress:0.98, message:"Downloading file..."}`
    - `{phase:"done", progress:1.0, message:"Complete"}`
  - Final stdout JSON unchanged (success/error shape)

  **Must NOT do**:
  - JANGAN write progress events to stdout (stdout reserved for final JSON only)
  - JANGAN block on lock file release indefinitely — return immediately if duplicate detected
  - JANGAN orphan Camoufox / curl_cffi sessions — ensure cleanup on abort

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Signal handling + cleanup + concurrent file ops, needs careful execution
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (modifies T6's file)
  - **Parallel Group**: Wave 2 (sequential after T6)
  - **Blocks**: T11 (SSE consumer reads progress events from stderr)
  - **Blocked By**: T6 (worker pipeline must exist first)

  **References**:
  - T6's pipeline implementation
  - Python signal docs: https://docs.python.org/3/library/signal.html
  - `src/proxy/providers/canva_worker.py` — existing image/video error handling for shape

  **WHY references matter**: signal handling pattern in Python differs from JS — must register before pipeline starts, not inside loops.

  **Acceptance Criteria**:
  - [ ] SIGTERM mid-pipeline → worker exits 0 with `{ok:false, error:"aborted"}` JSON within 2s
  - [ ] Dedupe: 2 workers same dedupe_key within 60s → 2nd returns `{ok:false, error:"duplicate"}` instantly
  - [ ] Lock file removed on success
  - [ ] Stderr emits NDJSON progress events at each phase

  **QA Scenarios**:

  ```
  Scenario: Abort responds quickly
    Tool: Bash + Python subprocess
    Preconditions: live auth available
    Steps:
      1. Spawn worker with stdin pptx mode (will take 30s)
      2. Wait 5s
      3. Send SIGTERM to worker PID
      4. Wait up to 5s for exit
      5. Parse stdout last line
    Expected Result: exit code 0, stdout = {ok:false, error:"aborted", phase:"<some_step>"}
    Evidence: .sisyphus/evidence/task-7-abort.txt

  Scenario: Dedupe within window
    Tool: Bash
    Steps:
      1. Run worker A with dedupe_key="test-xyz" (background)
      2. Sleep 1s
      3. Run worker B with dedupe_key="test-xyz" — capture stdout
      4. Wait for A to finish; verify A succeeded
    Expected Result: B stdout = {ok:false, error:"duplicate"}; A stdout = {ok:true, ...}
    Evidence: .sisyphus/evidence/task-7-dedupe.txt

  Scenario: Progress events on stderr
    Tool: Bash
    Steps:
      1. Run worker with valid pptx input
      2. Capture stderr to file
      3. cat stderr | jq -c 'select(.phase != null)' | wc -l
    Expected Result: count >= 5 (at least 5 phase transitions logged)
    Evidence: .sisyphus/evidence/task-7-progress.ndjson
  ```

  **Commit**: YES
  - Message: `feat(canva): worker abort handler + dedupe`
  - Files: `src/proxy/providers/canva_worker.py`
  - Pre-commit: python ast parse

- [x] 8. **Provider canva.ts: model + dispatch + refreshToken**

  **What to do**:
  - Edit `src/proxy/providers/canva.ts`:
    - Add to `MODELS` array: `{id: "canva-pptx", label: "Canva PPTX/PDF/MP4 Generator"}`
    - Update `ownsModel(model)`: keep substring "canva" check (already covers canva-pptx)
    - Update `chatCompletion(account, request)`:
      - If `request.model === "canva-pptx"`:
        - Parse from request: `prompt = lastUserMessage(request.messages)`, `slide_count = request.metadata?.slide_count ?? 5`, `format = request.metadata?.format ?? "pptx"`, `save_local = request.metadata?.save_local ?? true`
        - Validate: slide_count 1-50, format in pptx/pdf/mp4 → if invalid throw 400 error
        - Get tokens via `getTokens(account)`, build cookies+headers from new schema
        - Compute `dedupe_key = computeDedupeKey(prompt, account.id, format)` (TS port of util)
        - Get current quota: `quota_before = await fetchQuota(account)` (cached 5 min via Layer 2 healthCheck)
        - Spawn worker: `runWorker({mode:"pptx", prompt, slide_count, format, cookies, headers, seed_design: tokens.seed_design, dedupe_key, save_local}, timeoutMs=180_000)`
        - Read stderr in parallel for progress events (return as async iterator OR emit to caller via callback — depends on T11 contract)
        - On success: `quota_after = await fetchQuota(account)`, write `credits_used = quota_after.used - quota_before.used`
        - Return `formatPptxContent(result)` — markdown with title + design URL + download URL + slide preview thumbnails (if available)
    - Implement `refreshToken(account)`:
      - Spawn `python scripts/auth/canva.py --account-id {account.id} --refresh-only` with timeout 60s
      - Parse stdout NDJSON, find `{event:"complete", tokens}`
      - If success: update `accounts.tokens` in DB with new tokens (preserve seed_design unless re-captured), increment `refresh_count`, set `captured_at`
      - Return `{success: true}` on success, `{success: false, error: "<code>"}` on failure
    - Update `validateAccount(account)`: check both old (`caz/cau/user_id`) AND new (`CAZ/CAU/CUI/authz/brand/active_user/seed_design`) shapes; valid if either complete
    - Update `healthCheck(account)`: same as before but cache result in instance Map for 5 min (key=accountId, value={status, expiresAt})
    - Add `getTokens(account)` migration helper: if old shape detected and refresh succeeded, persist new shape

  **Must NOT do**:
  - JANGAN call `runWorker` synchronously in API request handler — must support streaming progress
  - JANGAN re-fetch quota_before for every request — use 5-min cache
  - JANGAN return image/video formatContent for pptx — separate `formatPptxContent`
  - JANGAN modify image/video chatCompletion path

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Multiple methods to extend, integrate with new utils + worker contract + DB
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on T6 worker contract)
  - **Parallel Group**: Wave 2 (after T6)
  - **Blocks**: T9, T10, T11, T13
  - **Blocked By**: T2 (token types), T4 (login script for refreshToken), T6 (worker exists)

  **References**:
  - `src/proxy/providers/canva.ts` — current image/video pattern to mimic
  - `src/proxy/providers/codebuddy.ts:refreshToken` — Camoufox-fallback refresh pattern to copy
  - `src/proxy/providers/base.ts` — base contract
  - T6's worker stdin contract

  **WHY references matter**: codebuddy.refreshToken is the closest pattern to what we need — read it, copy structure.

  **Acceptance Criteria**:
  - [ ] `canva-pptx` listed in `provider.models()` output
  - [ ] `provider.ownsModel("canva-pptx") === true`
  - [ ] `provider.chatCompletion(account, {model:"canva-pptx", messages:[{role:"user",content:"5 slide test"}], metadata:{slide_count:5, format:"pptx"}})` returns valid response after ~37s
  - [ ] `provider.refreshToken(account)` spawns python script, parses NDJSON, updates DB
  - [ ] `provider.healthCheck(account)` cached: 2 calls within 5 min → only 1 actual getQuota call
  - [ ] Slide count >50 throws BEFORE spawning worker

  **QA Scenarios**:

  ```
  Scenario: PPTX generation end-to-end via provider
    Tool: Bun script
    Preconditions: 1 valid canva account in DB with new-shape tokens
    Steps:
      1. const account = (await db.select().from(accounts).where(...))[0]
      2. const result = await canvaProvider.chatCompletion(account, {model:"canva-pptx", messages:[{role:"user",content:"5 slide test"}], metadata:{slide_count:5, format:"pptx"}})
      3. parse result.choices[0].message.content for design URL + download URL
    Expected Result: result has design URL + download URL within 60s
    Evidence: .sisyphus/evidence/task-8-e2e.json

  Scenario: refreshToken refreshes account in DB
    Tool: Bun script
    Preconditions: account with valid tokens (any shape)
    Steps:
      1. const before = (await db.select().from(accounts).where(eq(accounts.id, accId)))[0].tokens
      2. const result = await canvaProvider.refreshToken(account)
      3. const after = (await db.select().from(accounts).where(eq(accounts.id, accId)))[0].tokens
    Expected Result: result.success === true; after !== before (token blob changed); after.refresh_count > before.refresh_count
    Evidence: .sisyphus/evidence/task-8-refresh.txt

  Scenario: Slide count rejected before worker spawn
    Tool: Bun script
    Steps:
      1. await canvaProvider.chatCompletion(account, {model:"canva-pptx", messages:[...], metadata:{slide_count:51}})
    Expected Result: throws Error with message containing "Slide count must be 1-50"
    Evidence: .sisyphus/evidence/task-8-validate.txt
  ```

  **Commit**: YES
  - Message: `feat(canva): provider pptx dispatch + refreshToken`
  - Files: `src/proxy/providers/canva.ts`
  - Pre-commit: `bun run tsc --noEmit`

- [x] 9. **Registry registration `canva-pptx`**

  **What to do**:
  - Edit `src/proxy/providers/registry.ts`:
    - Verify `CanvaProvider` instance is registered (already at line 27)
    - Provider already owns models via `ownsModel(model)` substring match — `canva-pptx` will be matched automatically by existing logic (T8 added it to MODELS array)
    - Verify `getProviderForModel("canva-pptx")` returns CanvaProvider instance
  - This task is **trivial** — mostly verification; only edit if registration logic doesn't auto-pick up new model

  **Must NOT do**:
  - JANGAN reorder PROVIDER_ORDER (canva-pptx must still match canva first)
  - JANGAN add separate provider class for pptx — same CanvaProvider, different mode

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Verification only, possibly 0 LOC change
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (mostly verification)
  - **Parallel Group**: Wave 3
  - **Blocks**: T11 (SSE picks up via registry)
  - **Blocked By**: T8 (provider must have model registered)

  **References**:
  - `src/proxy/providers/registry.ts` — current registration
  - `src/proxy/providers/base.ts:ownsModel` — substring matching contract

  **WHY references matter**: confirm pattern works, no surprise in routing.

  **Acceptance Criteria**:
  - [ ] `bun -e "import {getProviderForModel} from './src/proxy/providers/registry'; console.log(getProviderForModel('canva-pptx')?.constructor.name)"` outputs `CanvaProvider`
  - [ ] `GET /v1/models` lists `canva-pptx`

  **QA Scenarios**:

  ```
  Scenario: Model lookup correct
    Tool: Bun + curl
    Steps:
      1. start dev server
      2. curl -fsS http://localhost:1930/v1/models | jq '.data[] | select(.id=="canva-pptx")'
    Expected Result: object returned with id=canva-pptx
    Evidence: .sisyphus/evidence/task-9-models-list.json
  ```

  **Commit**: YES (or skip if 0 LOC change — combine with T8)
  - Message: `feat(canva): register canva-pptx model`
  - Files: `src/proxy/providers/registry.ts` (or none)

- [x] 10. **API `/api/image-studio/generate` extension**

  **What to do**:
  - Edit `src/api/image-studio.ts` `POST /generate` handler:
    - Extend Zod schema for body: add optional `type: "image" | "video" | "pptx"` (default "image"), `format?: "pptx" | "pdf" | "mp4"` (only when type=pptx, default "pptx"), `slideCount?: number` (only when type=pptx, default 5)
    - Branch: if `type === "pptx"`:
      - Validate slide count 1-50 → 400 if invalid
      - Validate format pptx/pdf/mp4 → 400 if invalid
      - Set `model = "canva-pptx"`
      - Build request: `{model, messages:[{role:"user",content:prompt}], metadata:{slide_count, format, save_local:true}}`
      - Call `routeRequest(request, false)` — get `{provider, account, response}`
      - Parse response → extract `design_url, pptx_url, pptx_path, slide_count, credits_used, s3_expires_at, dedupe_key, format, title`
      - Insert into DB `imageStudioResults` with all new columns + existing (urls, prompt, type="pptx", aspectRatio:null, n:1, account)
      - Return JSON `{id, design_url, pptx_url, pptx_path, slide_count, credits_used, format, title, s3_expires_at, account}`
    - Existing image/video paths untouched
  - SSE handler: see T11 (separate route or stream toggle)

  **Must NOT do**:
  - JANGAN modify image/video request shape
  - JANGAN return URLs without storing in DB first
  - JANGAN expose unmasked tokens in response

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Multiple branches, validation logic, DB insert with new fields
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (independent file)
  - **Parallel Group**: Wave 3
  - **Blocks**: T11 (SSE shares this generate logic), T14 (API client uses)
  - **Blocked By**: T1 (DB schema), T8 (provider impl)

  **References**:
  - `src/api/image-studio.ts:POST /generate` — current handler
  - `src/db/schema.ts:imageStudioResults` — table for insert
  - Hono Zod validator pattern in same file

  **WHY references matter**: maintain Zod pattern consistency, DB column types match TS types.

  **Acceptance Criteria**:
  - [ ] POST `/api/image-studio/generate` with `{type:"pptx", prompt:"5 slide test", slideCount:5, format:"pptx"}` → 200 with all 9 response fields
  - [ ] POST with `{type:"pptx", slideCount:51}` → 400 with error message containing "Slide count"
  - [ ] DB row created in imageStudioResults with format=pptx, slide_count=5, credits_used=2

  **QA Scenarios**:

  ```
  Scenario: Generate PPTX via API
    Tool: curl
    Preconditions: server running, 1 valid canva account
    Steps:
      1. curl -fsS -X POST http://localhost:1930/api/image-studio/generate -H "Content-Type: application/json" -d '{"type":"pptx","prompt":"5 slide test ekonomi","slideCount":5,"format":"pptx"}' -o /tmp/gen.json
      2. jq '.design_url' /tmp/gen.json
      3. sqlite3 etteum-pool.db "SELECT format, slide_count, credits_used FROM imageStudioResults ORDER BY id DESC LIMIT 1"
    Expected Result: design_url starts with https://canva.com/design/; DB row format=pptx slide_count=5 credits_used=2
    Evidence: .sisyphus/evidence/task-10-generate.txt

  Scenario: Slide cap rejected
    Tool: curl
    Steps:
      1. curl -X POST .../generate -d '{"type":"pptx","prompt":"x","slideCount":51}' -w "%{http_code}\n" -o /tmp/r.json
      2. cat /tmp/r.json
    Expected Result: HTTP 400, body contains "Slide count must be 1-50"
    Evidence: .sisyphus/evidence/task-10-cap.txt
  ```

  **Commit**: YES
  - Message: `feat(api): image-studio generate type pptx`
  - Files: `src/api/image-studio.ts`
  - Pre-commit: `bun run tsc --noEmit`

- [x] 11. **SSE streaming for `/v1/chat/completions` model `canva-pptx`**

  **What to do**:
  - Edit `src/proxy/index.ts` `POST /v1/chat/completions` handler (line 636+):
    - When `body.model === "canva-pptx"` AND `body.stream === true`:
      - Set headers: `Content-Type: text/event-stream; Cache-Control: no-cache; Connection: keep-alive`
      - Parse user prompt from `body.messages` (last user message)
      - Parse optional metadata: `slide_count`, `format` from `body.tools[0].function.parameters` OR `body.metadata` (document both — opencode may support either)
      - Validate slide count + format (reuse T3 utils) — on invalid: emit `{error}` SSE chunk + `data: [DONE]`, end stream
      - Call provider.chatCompletion BUT capture stderr stream from worker subprocess
      - Translate worker stderr NDJSON `{phase, progress, message}` → SSE delta chunks:
        ```
        data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","model":"canva-pptx","choices":[{"index":0,"delta":{"content":"📋 Generating outline...\n"},"finish_reason":null}]}\n\n
        data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","model":"canva-pptx","choices":[{"index":0,"delta":{"content":"🎨 Rendering 5 slides... (40%)\n"},"finish_reason":null}]}\n\n
        ...
        data: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","model":"canva-pptx","choices":[{"index":0,"delta":{"content":"✅ Done!\n\n**Title**: ...\n**Design**: https://canva.com/design/...\n**Download**: ..."},"finish_reason":"stop"}]}\n\n
        data: [DONE]\n\n
        ```
    - Heartbeat: emit `:keepalive\n\n` every 5s during slow polling phases (designgeneration getResults can be 30s+)
    - On client disconnect (`req.signal.aborted` or response stream closed): SIGTERM the worker subprocess (T7 abort handler), don't commit credit
    - Non-streaming branch (`body.stream === false || undefined`): block + return final OpenAI response shape (single message with all info)
  - Update `GET /v1/models` to list `canva-pptx` (already listed via registry but verify shape: `{id:"canva-pptx", object:"model", owned_by:"etteum-pool"}`)

  **Must NOT do**:
  - JANGAN proxy raw worker stderr to client — translate via clean format
  - JANGAN log full prompt/messages array — could contain user secrets
  - JANGAN cache-buster the entire SSE response — only use `Cache-Control: no-cache`
  - JANGAN block heartbeats while waiting for upstream — must run on independent timer
  - JANGAN return image/video stream format for pptx — different shape

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: SSE protocol + subprocess stderr piping + heartbeat timing + client disconnect detection
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (modifies critical /v1/chat/completions path)
  - **Parallel Group**: Wave 3
  - **Blocks**: T17 (docs reference exact format)
  - **Blocked By**: T8 (provider), T10 (API path for non-streaming reference)

  **References**:
  - `src/proxy/index.ts:POST /v1/chat/completions:636+` — current handler with streaming for Kiro/Codex
  - `src/proxy/providers/kiro.ts` — streaming chat pattern
  - OpenAI SSE spec: https://platform.openai.com/docs/api-reference/chat/streaming

  **WHY references matter**: Kiro already streams — same SSE format pattern, just translate worker events instead of upstream events.

  **Acceptance Criteria**:
  - [ ] curl SSE: `curl -N -X POST .../v1/chat/completions -d '{"model":"canva-pptx","messages":[{"role":"user","content":"5 slide test"}],"stream":true}'` produces valid SSE chunks
  - [ ] At least 5 chunks before final, last is `data: [DONE]`
  - [ ] Heartbeat emitted during long polling phase (look for `:keepalive` lines)
  - [ ] Client abort (close curl): worker subprocess receives SIGTERM, exits within 5s, NO credit charged
  - [ ] `slide_count: 51` request: emits error chunk + DONE, no Canva call made

  **QA Scenarios**:

  ```
  Scenario: SSE stream completes successfully
    Tool: curl
    Preconditions: server up, valid account
    Steps:
      1. curl -N -X POST http://localhost:1930/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer $ETTEUM_API_KEY" -d '{"model":"canva-pptx","messages":[{"role":"user","content":"5 slide ekonomi"}],"stream":true,"metadata":{"slide_count":5}}' > /tmp/sse.txt
      2. grep -c "^data: " /tmp/sse.txt
      3. tail -1 /tmp/sse.txt
    Expected Result: count >= 5, last line is "data: [DONE]"
    Evidence: .sisyphus/evidence/task-11-sse-success.txt

  Scenario: Heartbeat during slow polling
    Tool: curl
    Steps:
      1. Run streaming generate, capture timed log
      2. grep "keepalive" log | wc -l
    Expected Result: >= 3 keepalives during a 37s flow
    Evidence: .sisyphus/evidence/task-11-heartbeat.txt

  Scenario: Client disconnect aborts upstream
    Tool: Bash + curl + pkill
    Steps:
      1. curl -N -X POST .../v1/chat/completions ... &
      2. CURL_PID=$!
      3. Sleep 8s (mid-generation)
      4. kill $CURL_PID
      5. Wait 3s
      6. ps aux | grep canva_worker | grep -v grep
    Expected Result: no canva_worker process alive
    Evidence: .sisyphus/evidence/task-11-abort.txt

  Scenario: Slide cap rejected via SSE
    Tool: curl
    Steps:
      1. curl -N -X POST .../v1/chat/completions -d '{"model":"canva-pptx","messages":[...],"stream":true,"metadata":{"slide_count":51}}'
    Expected Result: 1 error chunk then DONE; no Canva call (verify quota unchanged)
    Evidence: .sisyphus/evidence/task-11-cap.txt
  ```

  **Commit**: YES
  - Message: `feat(proxy): SSE streaming for canva-pptx`
  - Files: `src/proxy/index.ts`
  - Pre-commit: `bun run tsc --noEmit`

- [x] 12. **Re-export endpoint for expired S3 URL**

  **What to do**:
  - Add new endpoint `POST /api/image-studio/results/:id/re-export` in `src/api/image-studio.ts`:
    - Look up `imageStudioResults` row by id
    - Check if `s3_expires_at < Date.now()` (expired) — if not expired, return existing url
    - If expired: read `account_id, design_id, format, slide_count, extension` from row
    - Get account, dispatch worker `mode:"pptx-reexport"` (or extend existing pptx mode with `skip_thread:true, design_id, extension, format`) — only steps 5-9 (createexport2api → poll → record → download)
    - Update DB row with new `pptx_url, s3_expires_at`
    - Return `{pptx_url, s3_expires_at}`
  - Update worker to support `skip_to_export:true` flag — start at step 5 with provided design_id+extension

  **Must NOT do**:
  - JANGAN re-charge full 2 credits — Canva still charges for re-export but only 1 credit (verify empirically; if 2 credits, document)
  - JANGAN allow re-export of design from another account
  - JANGAN return stale URL if expired — always re-export

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: New endpoint + worker mode extension + DB update
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (independent endpoint)
  - **Parallel Group**: Wave 3
  - **Blocks**: None
  - **Blocked By**: T1 (DB), T8 (provider)

  **References**:
  - `src/api/image-studio.ts` — pattern for endpoint
  - T6 worker pipeline (steps 5-9)

  **WHY references matter**: re-use export logic, don't duplicate.

  **Acceptance Criteria**:
  - [ ] POST `/api/image-studio/results/{id}/re-export` for expired row → 200 with new pptx_url
  - [ ] DB row updated with new s3_expires_at > now()
  - [ ] Original design_id unchanged

  **QA Scenarios**:

  ```
  Scenario: Re-export expired URL
    Tool: curl + sqlite3
    Preconditions: result row in DB with s3_expires_at set to past
    Steps:
      1. sqlite3 etteum-pool.db "UPDATE imageStudioResults SET s3_expires_at=1 WHERE id=1"
      2. curl -fsS -X POST http://localhost:1930/api/image-studio/results/1/re-export
      3. sqlite3 etteum-pool.db "SELECT s3_expires_at FROM imageStudioResults WHERE id=1"
    Expected Result: s3_expires_at > now() (re-extended)
    Evidence: .sisyphus/evidence/task-12-reexport.txt
  ```

  **Commit**: YES
  - Message: `feat(api): pptx re-export endpoint for expired S3`
  - Files: `src/api/image-studio.ts`, `src/proxy/providers/canva_worker.py` (skip_to_export flag)
  - Pre-commit: `bun run tsc --noEmit`

- [x] 13. **Auth queue/runner: canva refresh handler**

  **What to do**:
  - Edit `src/auth/queue.ts` and `src/auth/runner.ts`:
    - Register canva provider in queue.ts as eligible for refresh jobs
    - In runner.ts: when receiving refresh job for canva:
      - Look up account profile path: `data/browsers/canva/{accountId}/`
      - Spawn `python scripts/auth/canva.py --account-id {id} --refresh-only`
      - Set timeout 90s
      - Parse NDJSON output, find `{event:"complete", tokens}`
      - Update `accounts.tokens` in DB, set `accounts.status = 'active'`, increment refresh count metadata
      - On failure (timeout, auth fail, browser crash): mark account `status = 'dead'`, broadcast WS event
  - Add API trigger: `POST /api/accounts/:id/refresh` (if not exists for canva — check accounts.ts) → enqueue canva refresh job
  - Optional: auto-trigger refresh when provider.chatCompletion returns `auth_expired` error (background, fire-and-forget)

  **Must NOT do**:
  - JANGAN block API request waiting for refresh — fire-and-forget background
  - JANGAN concurrent-refresh same account (queue.ts should dedupe)
  - JANGAN log password or full credentials

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Two-file edit + integration with python subprocess + queue dedupe
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3
  - **Blocks**: None directly (auto-relogin works in background)
  - **Blocked By**: T4 (login script with `--refresh-only` flag), T8 (provider)

  **References**:
  - `src/auth/queue.ts` — existing job queue pattern (CodeBuddy uses it)
  - `src/auth/runner.ts:25892 bytes` — runner protocol
  - `src/proxy/providers/codebuddy.ts:refreshToken` — pattern for refresh trigger

  **WHY references matter**: CodeBuddy is the ONLY hybrid (TS-then-browser) refresh implementation. Mirror exactly.

  **Acceptance Criteria**:
  - [ ] `POST /api/accounts/{id}/refresh` enqueues canva refresh job
  - [ ] Job runs python script, captures output, updates DB
  - [ ] WS event broadcast on completion: `{type:"account.refreshed", accountId, success:true|false}`
  - [ ] Concurrent refresh requests for same account: only 1 actual refresh executes

  **QA Scenarios**:

  ```
  Scenario: Manual refresh trigger
    Tool: curl
    Preconditions: canva account in DB, profile exists
    Steps:
      1. curl -fsS -X POST http://localhost:1930/api/accounts/1/refresh
      2. Wait 30s
      3. sqlite3 etteum-pool.db "SELECT json_extract(tokens,'$.refresh_count'), json_extract(tokens,'$.captured_at') FROM accounts WHERE id=1"
    Expected Result: refresh_count incremented, captured_at recent
    Evidence: .sisyphus/evidence/task-13-refresh.txt

  Scenario: Concurrent refresh dedupe
    Tool: Bash
    Steps:
      1. curl -X POST .../accounts/1/refresh & curl -X POST .../accounts/1/refresh & curl -X POST .../accounts/1/refresh & wait
      2. ps aux | grep -c "canva.py --refresh-only"
    Expected Result: only 1 process spawned
    Evidence: .sisyphus/evidence/task-13-dedupe.txt
  ```

  **Commit**: YES
  - Message: `feat(auth): canva refresh handler in queue`
  - Files: `src/auth/queue.ts`, `src/auth/runner.ts`, possibly `src/api/accounts.ts`
  - Pre-commit: `bun run tsc --noEmit`

- [x] 14. **API client lib `pptxStudio*` exports**

  **What to do**:
  - Edit `dashboard/src/lib/api.ts`: add `pptxStudio` namespace exports:
    - `generatePptx({prompt, slideCount?, format?, locale?, style?, save_local?}): Promise<{id, design_url, pptx_url, ...}>` → POST `/api/image-studio/generate` with `{type:"pptx", ...}`
    - `listPptxResults(): Promise<PptxResult[]>` → GET `/api/image-studio/results?type=pptx` (extend existing /results to support filter)
    - `deletePptxResult(id): Promise<void>` → DELETE `/api/image-studio/results/:id` (existing endpoint)
    - `reExportPptx(id): Promise<{pptx_url, s3_expires_at}>` → POST `/api/image-studio/results/:id/re-export`
    - `streamPptxGenerate({prompt, slideCount, format}, onChunk: (chunk) => void): Promise<void>` — uses fetch with ReadableStream to consume SSE from `/v1/chat/completions` (optional UI: live progress)
  - Add TypeScript types: `PptxResult`, `PptxGenerateOptions`

  **Must NOT do**:
  - JANGAN call /v1/chat/completions for normal dashboard use (use /api/image-studio/generate which doesn't require API key auth — server-side trust)
  - JANGAN duplicate types — extend existing `ImageStudioResult` if compatible

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Pure client-side API wrapper, well-defined contract from T10
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: T15 (page consumes API client)
  - **Blocked By**: T10 (API endpoints)

  **References**:
  - `dashboard/src/lib/api.ts:imageStudio` exports — pattern to mimic

  **WHY references matter**: imageStudio.* exports show exact fetch + error handling pattern to clone.

  **Acceptance Criteria**:
  - [ ] `pptxStudio.generatePptx({prompt:"x"})` typed correctly, returns Promise of result
  - [ ] All 5 functions exported, all typed
  - [ ] `bun run tsc --noEmit` (run from dashboard/ root) passes

  **QA Scenarios**:

  ```
  Scenario: API client functions exist and typed
    Tool: Bun + tsc
    Preconditions: dashboard built
    Steps:
      1. cd dashboard
      2. bun run tsc --noEmit
      3. node -e "const m = require('./src/lib/api.ts'); console.log(typeof m.pptxStudio.generatePptx)"
    Expected Result: tsc 0 errors, function type printed
    Evidence: .sisyphus/evidence/task-14-types.txt
  ```

  **Commit**: YES
  - Message: `feat(dashboard): pptx-studio API client`
  - Files: `dashboard/src/lib/api.ts`
  - Pre-commit: `cd dashboard && bun run tsc --noEmit`

- [x] 15. **`PptxStudio.tsx` page**

  **What to do**:
  - Create `dashboard/src/pages/PptxStudio.tsx` (NEW file):
    - Layout: 2-column grid similar to ImageStudio but PPTX-specific
      - Left column: Form (prompt textarea + Quick/Advanced toggle)
        - Quick mode: just prompt + Generate button
        - Advanced mode: prompt + slide count slider (1-50, default 5) + format dropdown (pptx/pdf/mp4) + locale dropdown (id-ID/en-US, optional) + style hint input (optional)
        - Validation: client-side reject slide count >50 OR <1 with toast warning
      - Right column: Result display
        - List of recent generations (from `pptxStudio.listPptxResults()`)
        - Each card: thumbnail (if available — first slide preview), title, slide count, format, "Open in Canva" button, "Download" button, "Re-export" button (if expired), delete
    - State: ~10 useState hooks (no Redux/Zustand, match existing pattern)
    - Generate flow:
      - On submit: optionally show modal/toast "Generating... (~30-40s)"
      - Use `streamPptxGenerate` for live progress OR `generatePptx` for simple await
      - On success: prepend to results list, show toast "PPTX ready!"
      - On error: toast with error message
    - Empty state: "No PPTX generated yet. Enter a prompt and click Generate."
    - Loading state: spinner during in-flight generation
    - Auto-refresh result list every 30s (in case parallel browser tab generates)
  - Components: reuse Button, Card, Badge, Input, Textarea, Select, Slider from shadcn (paths: `dashboard/src/components/ui/*`)
  - Icon: Use Lucide `Presentation` icon (or `FileText`)

  **Must NOT do**:
  - JANGAN copy-paste from ImageStudio.tsx — fresh component, focused
  - JANGAN integrate with existing chat assistant (image visual style assistant) — PPTX has different prompt needs
  - JANGAN over-engineer styling — match existing dashboard aesthetic
  - JANGAN expose API key in client (use server-side /api/image-studio/generate which has session auth)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Frontend UI/UX, design+styling, React state, user interactions
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Skill for crafting good UX even without mockups — directly applicable since user accepted "page terpisah" but no specific design mockups

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: T16 (sidebar/route)
  - **Blocked By**: T14 (API client)

  **References**:
  - `dashboard/src/pages/ImageStudio.tsx` — for layout/state pattern (don't copy, but study)
  - `dashboard/src/components/ui/*` — shadcn components available
  - `dashboard/tailwind.config.ts` — design tokens
  - Existing dashboard pages for nav/layout consistency

  **WHY references matter**: ImageStudio gives the dashboard's design language; reuse component vocabulary (Button variants, Card layout, spacing) without copying logic.

  **Acceptance Criteria**:
  - [ ] File `dashboard/src/pages/PptxStudio.tsx` exists
  - [ ] Page renders without console error
  - [ ] Quick mode form works (prompt only)
  - [ ] Advanced mode toggle reveals slide count + format + optional fields
  - [ ] Slide count slider 1-50, snaps to integer
  - [ ] Submit triggers generate, shows progress, displays result on success
  - [ ] Result card has design URL, download URL, re-export button
  - [ ] Mobile responsive (basic)

  **QA Scenarios**:

  ```
  Scenario: Quick mode generate flow
    Tool: Playwright (skill)
    Preconditions: server up, dashboard running, account valid
    Steps:
      1. Navigate to http://localhost:1931/pptx-studio
      2. Wait for "Generate PPTX" heading
      3. Fill textarea[name="prompt"]: "5 slide test ekonomi"
      4. Click button:has-text("Generate")
      5. Wait for progress indicator
      6. Wait up to 60s for "Done" or success toast
      7. Assert result card visible with title containing "ekonomi" or similar
      8. Screenshot
    Expected Result: result card appears, design URL clickable, download button present
    Evidence: .sisyphus/evidence/task-15-quick-flow.png + DOM dump

  Scenario: Slide cap client-side reject
    Tool: Playwright
    Steps:
      1. Open /pptx-studio
      2. Click "Advanced"
      3. Set slide count to 51 (drag slider or input)
      4. Assert toast/error "Max 50 slides"
      5. Generate button disabled
    Expected Result: client validation catches it
    Evidence: .sisyphus/evidence/task-15-cap.png

  Scenario: Result history loads
    Tool: Playwright
    Steps:
      1. Pre-populate DB with 2 result rows
      2. Reload /pptx-studio
      3. Assert 2 result cards visible
    Expected Result: history displays
    Evidence: .sisyphus/evidence/task-15-history.png
  ```

  **Commit**: YES
  - Message: `feat(dashboard): PptxStudio page`
  - Files: `dashboard/src/pages/PptxStudio.tsx`
  - Pre-commit: `cd dashboard && bun run tsc --noEmit && bun run build`

- [x] 16. **Sidebar nav + routing**

  **What to do**:
  - Edit `dashboard/src/components/layout/Sidebar.tsx`:
    - Find AI Generation section (where "Image Studio" lives — probably under a `navSections` array)
    - Add entry: `{ label: "PPTX Studio", path: "/pptx-studio", icon: Presentation }` (Lucide `Presentation` icon)
    - Place right after "Image Studio" entry
  - Edit `dashboard/src/App.tsx` (or main router file):
    - Import `PptxStudio` page
    - Add route: `<Route path="/pptx-studio" element={<PptxStudio />} />`

  **Must NOT do**:
  - JANGAN reorder existing nav items
  - JANGAN add to a different section (e.g., Settings) — must be in AI Generation group with Image Studio

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 2 files, ~5 LOC change each
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on T15 page existence)
  - **Parallel Group**: Wave 4 (after T15)
  - **Blocks**: F3 (manual QA needs nav)
  - **Blocked By**: T15

  **References**:
  - `dashboard/src/components/layout/Sidebar.tsx` — existing nav structure
  - `dashboard/src/App.tsx` — existing route pattern

  **WHY references matter**: just match the pattern, don't invent.

  **Acceptance Criteria**:
  - [ ] `/pptx-studio` route renders PptxStudio page
  - [ ] Sidebar has "PPTX Studio" entry visible
  - [ ] Entry highlights when on /pptx-studio
  - [ ] No console errors on initial page load

  **QA Scenarios**:

  ```
  Scenario: Nav and route work
    Tool: Playwright
    Preconditions: dashboard running
    Steps:
      1. Navigate to /
      2. Assert sidebar contains text "PPTX Studio"
      3. Click that link
      4. Assert URL changes to /pptx-studio
      5. Assert page heading "PPTX Studio" or similar
    Expected Result: navigation works
    Evidence: .sisyphus/evidence/task-16-nav.png
  ```

  **Commit**: YES
  - Message: `feat(dashboard): pptx-studio nav + routing`
  - Files: `dashboard/src/components/layout/Sidebar.tsx`, `dashboard/src/App.tsx`
  - Pre-commit: `cd dashboard && bun run tsc --noEmit`

- [x] 17. **Opencode CLI integration docs**

  **What to do**:
  - Edit `README.md`: add new section "## Opencode CLI Integration":
    - Show snippet to paste in `~/.config/opencode/opencode.json`:
      ```json
      {
        "provider": {
          "etteum": {
            "npm": "@ai-sdk/openai-compatible",
            "options": {
              "baseURL": "http://127.0.0.1:1930/v1",
              "apiKey": "<your-etteum-api-key>"
            },
            "models": {
              "canva-pptx": {
                "name": "Canva PPTX/PDF/MP4 Generator",
                "modalities": {"input":["text"],"output":["text"]}
              },
              "canva-image": {
                "name": "Canva Image Generator",
                "modalities": {"input":["text"],"output":["text"]}
              },
              "canva-video": {
                "name": "Canva Video Generator",
                "modalities": {"input":["text"],"output":["text"]}
              }
            }
          }
        }
      }
      ```
    - Usage examples:
      - `opencode -m etteum/canva-pptx "buat ppt 7 slide tentang sejarah Indonesia"`
      - Multi-line prompt with metadata via `--system` (if opencode supports)
    - Document streaming behavior: progress chunks during 30-60s wait, final markdown with download link
    - Document API key generation: dashboard → Settings → API Keys → Generate
    - Document caveats:
      - Slide count default 5 (mention how to override via prompt: "10 slide tentang...")
      - Format detection: "PDF" or "MP4" in prompt may auto-select format (or use explicit prompt)
      - Long-running: client must support SSE streaming (opencode does)
  - Optional: add example screenshot of opencode terminal showing PPTX generation

  **Must NOT do**:
  - JANGAN expose real API keys in docs
  - JANGAN promise features not in this plan (no PDF/MP4 prompts unless format param works in CLI)

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Pure documentation task, no code logic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4
  - **Blocks**: F1 (compliance audit reads README)
  - **Blocked By**: T11 (SSE format must be final)

  **References**:
  - `~/.config/opencode/opencode.json` — user's existing config (verified format)
  - `README.md` — current structure for "Quick Start" section to mimic

  **WHY references matter**: user's existing 9router config validates the format works.

  **Acceptance Criteria**:
  - [ ] README has "Opencode CLI Integration" section
  - [ ] Snippet is valid JSON (lint-clean)
  - [ ] Usage examples include both `-m` flag and Tab-pick approach
  - [ ] Streaming behavior explained
  - [ ] Caveats listed

  **QA Scenarios**:

  ```
  Scenario: Snippet valid JSON
    Tool: Bash + jq
    Steps:
      1. Extract JSON block from README
      2. echo "$json" | jq .
    Expected Result: jq parses without error
    Evidence: .sisyphus/evidence/task-17-snippet.txt

  Scenario: End-to-end via opencode CLI
    Tool: Bash + opencode
    Preconditions: snippet pasted into ~/.config/opencode/opencode.json
    Steps:
      1. opencode -m etteum/canva-pptx "5 slide test"
      2. Capture output
    Expected Result: streaming progress messages, final markdown link to design + download
    Evidence: .sisyphus/evidence/task-17-cli.txt
  ```

  **Commit**: YES
  - Message: `docs(readme): opencode CLI integration`
  - Files: `README.md`
  - Pre-commit: `node -e "const fs=require('fs'); const md=fs.readFileSync('README.md','utf8'); const m=md.match(/\\\`\\\`\\\`json\\n([\\s\\S]+?)\\n\\\`\\\`\\\`/); JSON.parse(m[1])"` (validates JSON snippet)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle` (Confucius unavailable, oracle is best alternative for read-only audit)

  **What to verify**:
  - Read plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command).
  - For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found.
  - Check evidence files exist in `.sisyphus/evidence/`.
  - Verify all 17 deliverables in TODOs section have actual file changes (git diff).

  **Output**: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`

  **What to verify**:
  - Run `bun run tsc --noEmit` (TypeScript strict check)
  - Run `bun run lint` if exists
  - Review all changed files for: `as any`, `@ts-ignore`, empty catches, console.log in prod code, commented-out code, unused imports
  - Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp)
  - Verify mask-token util is applied to all log statements that touch tokens

  **Output**: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` + `playwright` skill

  **What to verify**:
  - Start `bun start`, login dashboard, navigate to /pptx-studio
  - Execute EVERY QA scenario from EVERY task — Playwright for UI, curl for API, tmux for CLI
  - Test cross-task integration: generate from dashboard → check imageStudioResults row → re-download from result history → verify same file
  - Test opencode CLI integration: spawn opencode session, request canva-pptx model, verify streaming chunks
  - Edge cases: 0 active accounts, all accounts exhausted, slide=51, prompt empty, client disconnect mid-gen
  - Save evidence to `.sisyphus/evidence/final-qa/`

  **Output**: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`

  **What to verify**:
  - For each task: read "What to do", read actual diff (git log/diff against base branch). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep).
  - Check "Must NOT do" compliance: NO 3-model split, NO silent slide truncate, NO PPTX-in-DB caching, NO ImageStudio.tsx mutation, NO bun:test setup, NO per-user rate limit.
  - Detect cross-task contamination: Task N touching Task M's files outside its scope.
  - Flag unaccounted changes: any file modified that's not in the task plan.

  **Output**: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

Each task ends with one commit. Format: `type(scope): description`

- T1: `feat(db): add pptx fields to imageStudioResults`
- T2: `feat(canva): extend CanvaTokens schema for pptx auth`
- T3: `chore(canva): add masking + dedupe utilities`
- T4: `feat(auth): canva login script with token capture`
- T5: `chore(pool): add canva concurrency cap setting`
- T6: `feat(canva): worker pptx mode pipeline`
- T7: `feat(canva): worker abort handler + dedupe`
- T8: `feat(canva): provider pptx dispatch + refreshToken`
- T9: `feat(canva): register canva-pptx model`
- T10: `feat(api): image-studio generate type pptx`
- T11: `feat(proxy): SSE streaming for canva-pptx`
- T12: `feat(api): pptx re-export endpoint for expired S3`
- T13: `feat(auth): canva refresh handler in queue`
- T14: `feat(dashboard): pptx-studio API client`
- T15: `feat(dashboard): PptxStudio page`
- T16: `feat(dashboard): pptx-studio nav + routing`
- T17: `docs(readme): opencode CLI integration`

Pre-commit verification: `bun run tsc --noEmit && bun test 2>/dev/null || true`

---

## Success Criteria

### Verification Commands

```bash
# Build clean
bun run tsc --noEmit
# Expected: 0 errors

# Server starts
bun start &
sleep 5
curl -fsS http://localhost:1930/v1/models | jq '.data[] | select(.id=="canva-pptx")'
# Expected: { "id": "canva-pptx", ... }

# Generate via API
curl -fsS -X POST http://localhost:1930/api/image-studio/generate \
  -H "Content-Type: application/json" \
  -d '{"type":"pptx","prompt":"buat ppt 5 slide tentang test","format":"pptx","slideCount":5}'
# Expected: 200 with { id, urls, design_url, slide_count, credits_used: 2, account }

# Generate via OpenAI-compatible (streaming)
curl -fsS -N http://localhost:1930/v1/chat/completions \
  -H "Authorization: Bearer $ETTEUM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"canva-pptx","messages":[{"role":"user","content":"5 slide test"}],"stream":true}'
# Expected: SSE chunks: data: {phase:"outline"}..., data: {phase:"render"}..., data: [DONE]

# Reject >50 slide
curl -fsS -X POST http://localhost:1930/api/image-studio/generate \
  -H "Content-Type: application/json" \
  -d '{"type":"pptx","prompt":"x","slideCount":51}' -w "%{http_code}\n"
# Expected: 400 with error message containing "max 50"

# Dashboard reachable
curl -fsS http://localhost:1931/pptx-studio
# Expected: 200 HTML
```

### Final Checklist
- [ ] All "Must Have" present (verified by F1)
- [ ] All "Must NOT Have" absent (verified by F1+F4)
- [ ] All QA scenarios pass with evidence (verified by F3)
- [ ] No TypeScript errors, no lint warnings (verified by F2)
- [ ] No scope creep (verified by F4)
- [ ] User explicit "okay" after final review presentation

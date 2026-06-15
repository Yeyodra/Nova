# F2. Code Quality Review

**Plan**: canva-pptx-feature
**Reviewer**: F2 Code Quality
**Wave**: Final Verification

---

## Build / Type Check

- `bun run tsc --noEmit`: **FAIL** (exit 2, 53 errors total)
- **Errors in canva-pptx scope: 0** (filtered against `canva|pptx|image-studio|canva-utils|PptxStudio` → 0 hits)
- All 53 errors live in pre-existing files outside this feature:
  - `scripts/sync-filter-rules.ts` (7 errors — `'rule' is possibly 'undefined'`)
  - `src/index.ts:181` (1 error — `Property 'ip'`)
  - `src/lib/tunnel/cloudflared.ts:308` (1 error — string|undefined)
  - `test/api/backup-restore.test.ts` (44 errors — `'json' is of type 'unknown'`)
- Full output: `.sisyphus/evidence/final-qa/F2-tsc-output.txt`

These are pre-existing tech debt from earlier features. The canva-pptx feature itself is type-clean.

## Lint

- `bun run lint`: **N/A** — no `lint` script in `package.json` (only `start`, `dev`, `build`, `migrate`, `setup`).
- Note saved to `.sisyphus/evidence/final-qa/F2-lint-output.txt`.

## File-by-File Review

### Production code

- **`src/db/schema.ts`** — clean. 8 nullable columns appended to `imageStudioResults` (designUrl, pptxUrl, pptxPath, slideCount, pptxCreditsUsed, s3ExpiresAt, dedupeKey, format). Types correct, sensible defaults. Comment notes intentional NULL for backward-compat.
- **`drizzle/0001_ambiguous_maginty.sql`** — clean. Adds 8 ALTER TABLE columns matching schema.ts exactly + creates new `combos` table (out of scope for this feature, leaks in from another branch — flag below).
- **`src/proxy/providers/canva-utils.ts`** — clean. Pure helpers, well-typed, single source of truth for `maskToken`, `computeDedupeKey`, `validateSlideCount`, `validateFormat`. No duplication elsewhere.
- **`src/proxy/providers/canva.ts`** — mostly clean, several issues:
  - **L322 `/tmp/canva_worker_${...}.json` — HARD ISSUE** (Windows-incompatible, see below).
  - L361, L364: empty catches `{ }` — file-cleanup best-effort, acceptable but inconsistent with codebase convention `{ /* ignore */ }`.
  - L446, L448: 3× `(request as any)` casts on legacy image/video extras — see ai-slop section.
- **`src/api/image-studio.ts`** — clean. Uses canva-utils helpers (validateSlideCount, validateFormat, computeDedupeKey). Mark-token cleanup verified — no token-touching logs. Error-code mapping (`mapPptxErrorToStatus`) is precise. Single `as unknown as CanvaProvider` narrow cast at L753 is documented and intentful.
- **`src/proxy/index.ts`** — clean. `[proxy:canva-pptx-sse]` log at L676 explicitly redacts (only req-id/account-id/slide-count/format/prompt_len). No raw token/cookie logging.
- **`src/proxy/pool.ts`** — clean. Adds per-provider `max_concurrent` cap with cached settings read; round-robin/sequential paths updated to skip saturated accounts. No anti-patterns.
- **`src/api/accounts.ts`** — clean. Adds `POST /api/accounts/:id/refresh` (202 Accepted, fire-and-forget queue enqueue). Tight, no logging of secrets.
- **`src/proxy/providers/canva_worker.py`** — mostly clean.
  - Stdout reserved for final JSON; stderr for debug + NDJSON progress.
  - All sensitive logs go through `_mask_token` (L662, 718, 770, 811, 873, 936, 967, 1041 audited).
  - 30 `except Exception:` blocks — sampled, all are intentional best-effort fallbacks (signal install, dir create, lock parse, breadcrumbs). Acceptable given subprocess constraints.
  - No `print(` calls, no bare `except:`, no hardcoded design IDs (DAG…), no SEED_DESIGN literals.
- **`scripts/auth/app/providers/canva.py`** — clean (sample). No `print`, no bare except, no hardcoded creds.
- **`src/proxy/providers/codebuddy.ts`** — **OUT-OF-SCOPE PROBE MODE** (see below).

### Dashboard

- **`dashboard/src/pages/PptxStudio.tsx`** — clean. No `as any`, no `@ts-ignore`. Single intentful `console.warn` at L140 in refetch error path (silent UI, log to console for debugging). All API calls go through typed `pptxStudio` namespace.
- **`dashboard/src/lib/api.ts`** — clean. Adds well-typed `pptxStudio` namespace (PptxFormat / PptxResult / StoredPptxResult / PptxStreamChunk). Streaming uses fetch+ReadableStream with proper cleanup. Safe `try/catch { /* already released */ }` on `releaseLock`.
- **`dashboard/src/App.tsx`** — clean. Lazy-loaded `PptxStudio` route.
- **`dashboard/src/components/layout/Sidebar.tsx`** — clean. Single `{ label: "PPTX Studio", path, icon }` nav entry.

### README.md
- 88 lines added documenting PPTX feature. No issues.

## AI-Slop Findings

- **`as any`** count in feature scope: **3** — all in `src/proxy/providers/canva.ts`:
  - `L446`: `(request as any).n` (legacy image/video flow)
  - `L448`: `(request as any).aspect_ratio || (request as any).size` (legacy image/video flow)
  - **Status**: pre-existing pattern for image/video extras; PPTX path correctly migrated to typed `CanvaPptxRequestExtras`. Should be migrated for consistency, but is NOT new slop introduced by this feature.
- **`@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`** in `src/`: **0** ✅
- **Empty catch blocks** in feature scope:
  - `canva.ts:361, 364`: 2× `} catch {}` for tmpfile cleanup. Best-effort, acceptable but stylistically inconsistent with the rest of the codebase which uses `{ /* ignore */ }`.
- **`console.log` in `src/`** (canva-pptx scope):
  - `canva.ts:581` — `[canva-pptx]` request log, **all secrets masked via maskToken** ✅
  - `canva.ts:709` — `[canva-pptx] reexport` log, masked ✅
  - `canva.ts:1004` — `[canva] refreshToken` log, masked (CAZ + authz + refresh_count + seed presence) ✅
  - `proxy/index.ts:676` — `[proxy:canva-pptx-sse]` log, only req-id/acct/slides/format/prompt_len (redacted) ✅
- **`console.error`** in feature scope:
  - `image-studio.ts:395, 534, 820` — error paths persisting DB row; logs `err` only (no token data). ✅
- **Commented-out code blocks**: none found.
- **Unused imports**: none flagged by tsc.
- **Generic names** (`data/result/item/temp/foo`): none in feature code; `result` used appropriately as ProviderResult/WorkerOutput.
- **Excessive comments / over-abstraction**: comments are explanatory and reference task IDs (T1/T7/T8/T11/T12). Not slop — they explain WHY.

## Mask-Token Coverage

Every audited log statement that touches token/cookie/CAZ/CAU/CUI/authz uses `maskToken` (TS) or `_mask_token` (Python):

| Location | Field(s) | Helper |
|---|---|---|
| `src/proxy/providers/canva.ts:583` | CAZ, authz | `maskToken` ✅ |
| `src/proxy/providers/canva.ts:711` | CAZ | `maskToken` ✅ |
| `src/proxy/providers/canva.ts:1005-1006` | CAZ, authz | `maskToken` ✅ |
| `src/proxy/providers/canva_worker.py:662` | thread_id | `_mask_token` ✅ |
| `src/proxy/providers/canva_worker.py:718` | results_token | `_mask_token` ✅ |
| `src/proxy/providers/canva_worker.py:770` | design_gen_id | `_mask_token` ✅ |
| `src/proxy/providers/canva_worker.py:811` | design_id | `_mask_token` ✅ |
| `src/proxy/providers/canva_worker.py:873` | export_id | `_mask_token` ✅ |
| `src/proxy/providers/canva_worker.py:936` | download_url | `_mask_token` ✅ |
| `src/proxy/providers/canva_worker.py:967` | response body snippet | `_mask_token` ✅ |
| `src/proxy/providers/canva_worker.py:1041` | extension | `_mask_token` ✅ |

`maskToken` and `computeDedupeKey` exist ONLY in `src/proxy/providers/canva-utils.ts` — no duplication detected.

## CRITICAL ISSUES (Reject Drivers)

1. **`/tmp/canva_worker_…json` hardcoded path — `src/proxy/providers/canva.ts:322`**
   The repo explicitly supports Windows (`install.ps1`, `etteum.ps1`, README "Windows (PowerShell)" install), but the worker subprocess writes `/tmp/canva_worker_${Date.now()}_…json`. On Windows there is no `/tmp` directory by default → `Bun.write` will either fail or write to `C:\tmp` if it exists. This breaks PPTX generation on Windows. Must use `os.tmpdir()` / `process.env.TMPDIR ?? "/tmp"` / Bun's tmp helpers.

2. **Untracked debug/probe stragglers WILL be committed accidentally**
   Four files at repo root that are NOT in `.gitignore`:
   - `probe-image.ts` (336 lines, brute-force probes Codebuddy with random active accounts, hardcodes `data/poolprox3.db` reads)
   - `probe-known-model.ts` (similar shape)
   - `.tmp-models.json` (test output: list of probed model IDs incl. `cb-enowx`, `cb-deepseek-v3-2`)
   - `.tried-accounts.json` (internal account IDs: `[971,970,969,70,968,92,967,59,966,101]`)
   `git check-ignore` returns exit=1 → these are NOT ignored. `.gitignore` ignores `scripts/probe-*.ts` but not root-level `probe-*.ts`. A casual `git add .` will leak account IDs and probe scripts to history.
   **Fix**: delete the four files OR move probes under `scripts/` and extend `.gitignore` to cover `probe-*.ts`, `.tmp-*.json`, `.tried-*.json`.

3. **Out-of-scope PROBE MODE in `src/proxy/providers/codebuddy.ts:106-110`**
   ```ts
   // PROBE MODE: cb-probe-<anything> -> <anything> (forward-as-is to upstream)
   // Used to brute-force test undocumented model IDs against CodeBuddy.
   if (base.toLowerCase().startsWith("cb-probe-")) {
     const raw = base.slice("cb-probe-".length);
     return isThinking ? `${raw}-thinking` : raw;
   }
   ```
   This is unrelated to the canva-pptx feature, exposes a brute-force back-door in production routing, and is co-introduced with the probe stragglers above. Belongs in a separate, gated change (or in dev-only code). Reject as a side-effect of feature scope.

## Minor Findings (Non-Blocking)

- `canva.ts:361, 364` empty catches → use `{ /* cleanup best-effort */ }` for grep-ability.
- `canva.ts:446, 448` `(request as any).n` / `aspect_ratio` — image/video legacy path could mirror the typed `CanvaPptxRequestExtras` pattern. Pre-existing, not a blocker.
- New `combos` table in `drizzle/0001_ambiguous_maginty.sql` is unrelated to PPTX feature (combos is its own feature in the recent commit log). Migration co-mingling means rolling back PPTX requires also dropping combos. Not a code-quality defect, but flag for reviewers: this migration should arguably be split.

---

## VERDICT: REJECT

**Reasons**:

1. **Cross-platform regression**: hardcoded `/tmp/` path in `canva.ts:322` breaks PPTX generation on Windows, which is a first-class supported platform.
2. **Production hygiene**: four untracked debug files (`probe-image.ts`, `probe-known-model.ts`, `.tmp-models.json`, `.tried-accounts.json`) live at repo root and will be committed by `git add .`; one of them (`.tried-accounts.json`) leaks internal account IDs.
3. **Scope contamination**: `cb-probe-*` brute-force mode added to `codebuddy.ts` is unrelated to the canva-pptx feature and ships a model-ID back-door into production routing.

The canva-pptx feature itself is well-engineered (clean type-flow, masked logging, validated input, proper SSE/abort handling, no `as any`/`@ts-ignore`/empty catches in feature code). Once the three issues above are addressed, this lane will pass.

**Required fixes before APPROVE**:
- Replace `/tmp/canva_worker_…json` with cross-platform tmp dir (`os.tmpdir()` via `node:os`).
- Delete or move + gitignore the four root-level probe stragglers.
- Either remove `cb-probe-*` mode from `codebuddy.ts` or move it behind a feature flag and out of this feature's PR.

---

## Re-Review (Fix-Cycle Pass 1) — 2026-06-14T20:52:50+07:00

### Fix 1 — Cross-platform tmp path
- Verified at: `src/proxy/providers/canva.ts:324`
- Imports: **PASS** — actual lines:
  - L21: `import { tmpdir } from "node:os";`
  - L22: `import { join } from "node:path";`
- Body: **PASS** — actual L324:
  `const tmpFile = join(tmpdir(), `+''+canva_worker_+''+_+''+.json+''+);`
- Residual `/tmp/` literals in canva.ts: **NONE** (grep `/tmp/|tmpdir` returned only the tmpdir import + use shown above)

### Fix 2 — Probe stragglers removed + gitignored
- `git status --porcelain` clean of probe files: **PASS**
  Output (no `probe-image.ts`, `probe-known-model.ts`, `.tmp-models.json`, `.tried-accounts.json`, `.datapoolprox3.db`):
  ```
   M .gitignore
   M README.md
   M dashboard/src/App.tsx
   M dashboard/src/components/layout/Sidebar.tsx
   M dashboard/src/lib/api.ts
   M scripts/auth/app/providers/canva.py
   M src/api/accounts.ts
   M src/api/image-studio.ts
   M src/db/schema.ts
   M src/proxy/index.ts
   M src/proxy/pool.ts
   M src/proxy/providers/canva.ts
   M src/proxy/providers/canva_worker.py
  ?? .sisyphus/
  ?? dashboard/src/pages/PptxStudio.tsx
  ?? src/proxy/providers/canva-utils.ts
  ```
- `.gitignore` rules present: **PASS** — block at L77-80:
  ```
  # Local reverse-engineering probes (root-level companions to scripts/probe-*.ts)
  /probe-*.ts
  /.tmp-*.json
  /.tried-*.json
  ```

### Fix 3 — `cb-probe-*` shim reverted
- grep `cb-probe` in codebuddy.ts: **NONE** (zero matches)
- `git diff src/proxy/providers/codebuddy.ts` shows: empty diff — file is in clean HEAD state, no working-tree mods

### Tsc Baseline
- New error count: **53** (== baseline 53, threshold ≤ 53 satisfied)
- Diff vs prior baseline: **identical** — same 4 files, same 53 errors:
  - `scripts/sync-filter-rules.ts`: 7
  - `src/index.ts:181`: 1
  - `src/lib/tunnel/cloudflared.ts:308`: 1
  - `test/api/backup-restore.test.ts`: 44
  - canva-pptx scope: **0**
- Full output: `.sisyphus/evidence/final-qa/F2-tsc-pass2.txt`

## VERDICT (Pass 2): APPROVE
Reason: All three pass-1 reject drivers are resolved with verified file content. Fix 1 replaces the hardcoded `/tmp/` write with `join(tmpdir(), ...)` (Windows-safe). Fix 2 removes the four probe stragglers from the working tree and adds explicit `.gitignore` rules (`/probe-*.ts`, `/.tmp-*.json`, `/.tried-*.json`) so they cannot leak via `git add .`. Fix 3 returns `codebuddy.ts` to a clean diff — no `cb-probe` brute-force shim. Tsc error count unchanged at 53 (all pre-existing tech debt outside this feature); zero new errors introduced. The canva-pptx feature remains type-clean.

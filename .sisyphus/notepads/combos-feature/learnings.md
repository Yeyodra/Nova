## Key Patterns

### Schema (src/db/schema.ts)
- Drizzle ORM, sqliteTable with integer PK autoIncrement
- Use `text("...", { mode: "json" })` for JSON columns
- Use `integer("...", { mode: "timestamp" }).$defaultFn(() => new Date())` for timestamps
- Indexes via array passed to second argument: `(table) => [uniqueIndex(...), index(...)]`
- Export inferred types: `export type Combo = typeof combos.$inferSelect; export type NewCombo = typeof combos.$inferInsert;`

### Runtime CREATE TABLE (model-mapping.ts:45-62)
- Use `client.exec(`CREATE TABLE IF NOT EXISTS combos (...)`)` for idempotent table guarantee
- Bypasses inconsistent drizzle migration journal

### Settings table
- Already exists: `settings { key TEXT PRIMARY KEY, value TEXT, updated_at }`
- Pattern: load-from-db into in-memory cache + invalidate on update

### API CRUD (src/api/filters.ts)
- Hono router with .get("/"), .post("/"), .patch("/:id"), .delete("/:id")
- Use `c.req.json<...>()` typed body, `c.json(result, 201)` returns
- Always invalidate cache on writes

### Routing
- handleChatCompletion (src/proxy/index.ts:454) calls resolveModelAlias then routeRequest
- Insertion point for combos: after resolveModelAlias (line 457), before routeRequest (line 459)
- routeRequest signature: (request: ChatCompletionRequest, stream: boolean) => Promise<RouteResult>

### Models
- getAllModels() returns ModelInfo[] from src/proxy/providers/registry.ts
- /v1/models in src/proxy/index.ts:568 — append combos with owned_by="combo"
- /api/models in src/api/index.ts:44 — same logic

### Server bootstrap (src/index.ts)
- Add ensureCombosTable + loadCombosCache + loadComboSettings calls between line 62 and line 70

## 9router reference paths (read-only references)
- C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\src\lib\db\repos\combosRepo.js
- C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\open-sse\services\combo.js (rotation algorithm + fallback loop)
- C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\src\app\api\combos\route.js
- C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\src\app\api\combos\[id]\route.js
- C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\src\sse\handlers\chat.js (combo detection in chat)
- C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\src\app\api\v1\models\route.js (combo injection)
- C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\src\shared\components\ComboFormModal.js

## [Task 3 Done] 2026-06-14 07:45:52
- Files: src/proxy/combos.ts (291 lines)
- Key decisions:
  - Cache keyed by raw combo.name (case-sensitive lookup matches the request hot path; case-insensitive collision check happens only at write-time in isValidComboName).
  - resolveCombo returns Promise<string[] | null> (async signature for forward-compat) but body is synchronous Map lookup. Sanity-guards combo.models shape since SQLite-backed JSON could in theory be corrupt.
  - getRotatedModels uses slice/concat instead of the source's shift/push loop — same output, cleaner, no array mutation. Verified with 4-call wrap test (a/b/c -> b/c/a -> c/a/b -> a/b/c).
  - normalizeStickyLimit floors any non-integer and clamps to >= 1 (per task spec).
  - In handleComboRequest the body is cloned per attempt via spread to avoid mutating the caller's request. Fall-through triggers on BOTH thrown errors and ProviderResult.success === false (mirrors 9router behavior).
  - Validation: regex /^[a-zA-Z0-9_.\-]+$/, length 1..100. Sub-models: array length 1..10, non-empty strings, no nested combos. Both rules verified in evidence.
  - Cache load wraps the DB call in try/catch and logs — if combos table doesn't exist yet (Task 1 race), the cache stays empty and validation/lookups still work (verified live).
- Evidence:
  - .sisyphus/evidence/task-3-fallback-order.txt (3 calls all return original order)
  - .sisyphus/evidence/task-3-roundrobin-rotation.txt (a/b/c rotation with stickyLimit=1, wraps on call 4)
  - .sisyphus/evidence/task-3-sticky-limit.txt (stickyLimit=3, advances every 3 calls)
  - .sisyphus/evidence/task-3-nested-rejected.txt (validation rules: empty array, oversize, empty string, non-array, nested combo logic)
- Notes for downstream tasks:
  - Task 5 (proxy integration) imports resolveCombo + handleComboRequest. The comboName parameter is the raw request model id (the cache key) — pass it through so request_logs can record it.
  - Task 4 (dashboard CRUD) calls invalidateCombosCache() after every write. resetComboRotation() should also be called when a combo is edited or deleted so stale rotation indices don't outlive the underlying model list.
  - getCombosCached() returns the raw Combo rows including the JSON-parsed models array — safe to expose to /v1/models.


## Task 2: Combo Settings Helpers (DONE)

### File created
- src/proxy/combo-settings.ts â€” six exports: loadComboSettings, getComboStrategy, getComboStickyLimit, getComboSpecificStrategy, updateComboSettings, invalidateComboSettingsCache

### Pattern decisions
- Module-level `let` cache vars (strategy, stickyLimit, perCombo) â€” not exported. Getters read them synchronously.
- `loadComboSettings()` does a single `db.select().from(settings)` then filters by VALID_KEYS set instead of three separate `where(eq(...))` round-trips. Slightly fewer queries, same correctness.
- `updateComboSettings()` mirrors `src/api/proxy-settings.ts:55-91` (select-then-update-or-insert). Coerces value: `JSON.stringify` for objects, `String(...)` otherwise. After write, calls `await loadComboSettings()` â€” synchronous from caller's perspective.
- `invalidateComboSettingsCache()` mirrors `invalidateModelMappingCache` (fire-and-forget reload, error logged).
- `combo_sticky_limit` parsing: `Number(rawLimit)`, then guard with `Number.isFinite && >= 1`. Floors to integer. Defaults to 1 on NaN/<1.
- `combo_strategies` JSON parse: try/catch + must be plain object (not array, not null). Falls back to `{}` on any parse error.

### Wiring
- `src/index.ts` line 19: import added below model-mapping import.
- `src/index.ts` line ~64-69: `await loadComboSettings()` block added directly below the model-mapping init try/catch.

### QA evidence
- `.sisyphus/evidence/task-2-default-settings.txt` â€” defaults: strategy=fallback, stickyLimit=1, perCombo[foo]=null.
- `.sisyphus/evidence/task-2-settings-update.txt` â€” updates round-trip through DB and cache; per-combo override roundtrips correctly; reset values restore defaults.

### Type-check
- `bunx tsc --noEmit` passes for new file (verified via lsp_diagnostics + grep on tsc output). Pre-existing unrelated errors in scripts/, src/index.ts:177, test/, lib/tunnel/cloudflared.ts remain (not introduced by this task).


## [Task 1 Done] 2026-06-14T07:47:02+07:00
- Files changed: src/db/schema.ts, src/index.ts
- Key decisions:
  - Placed ensureCombosTable() inside src/db/schema.ts as instructed.
  - **Gotcha (NEW LEARNING)**: a top-level import { client } from "./index" in
    schema.ts creates a circular module-init cycle: db/index.ts imports schema
    at construction time to feed drizzle(sqlite, { schema }), so the schema
    exports (e.g. ccounts) are still uninitialized when index.ts runs and
    drizzle's extractTablesRelationalConfig throws
    ReferenceError: Cannot access 'accounts' before initialization.
    Fix: import client lazily inside the function body via equire("./index").
    model-mapping.ts does not hit this because it lives outside src/db, so by
    the time it imports ../db/index the module graph has fully initialized.
  - models column uses 	ext("models", { mode: "json" }).notNull().\(() => [] as string[])
    so reads return a parsed array. Drizzle stores it as a JSON-encoded text blob
    in SQLite; raw SQL DDL therefore uses 	ext NOT NULL DEFAULT '[]' to match.
  - strategy and stickyLimit are nullable (no default) so that null = "use
    global default" without needing a magic sentinel.
  - Wired init as a separate try/catch block after model-mapping init in
    src/index.ts (preferred per task brief) so a combos-table failure does not
    take down model-mapping init or vice versa.
- Verification:
  - unx tsc --noEmit reports no errors in src/db/schema.ts.
    Pre-existing unrelated errors remain in scripts/, test/, and one line in
    src/index.ts (c.env?.ip) — not introduced by this task.
  - Bun script created the table on a throwaway DB; sqlite_master shows the
    expected table + UNIQUE INDEX combos_name_idx. Output saved to
    .sisyphus/evidence/task-1-schema-creation.txt.

## [Task 6 Done] 2026-06-14T07:54:34.2328873+07:00
- Files: src/proxy/index.ts (lines 19, 569-595), src/api/index.ts (lines 19, 44-66)
- Behavior: Both GET /v1/models and GET /api/models now append combos cache to the model list. Each combo becomes `{ id: combo.name, object: "model", created: <unix_seconds>, owned_by: "combo" }`. Combo entries are appended after provider models so existing clients see them at the tail.
- ModelInfo conformance: ModelInfo (src/proxy/providers/base.ts:101) only requires id/object/created/owned_by; combo-extra fields (vision/pricing/context_window) are optional. Object literal is structurally compatible with ModelInfo[] without a cast — TS accepts it as part of the heterogenous data array.
- createdAt handling: Drizzle returns Date in timestamp mode. Converted via combo.createdAt.getTime()/1000. Includes a Number() fallback for the unlikely raw-int case and a Date.now() fallback when null.
- Evidence:
  - .sisyphus/evidence/task-6-models-list.txt — in-process /v1/models call with one DB combo, shows the combo entry rendered correctly.
  - .sisyphus/evidence/task-6-no-combos.txt — empty DB ? 0 combo entries in /v1/models (against running server, confirms baseline).
- Pre-existing TS errors (scripts/sync-filter-rules.ts, src/api/combos.ts from Task 4, test/api/backup-restore.test.ts, etc.) are not in scope for Task 6 and remain untouched. lsp_diagnostics clean on both touched files.


## [Task 5 Done] 2026-06-14 07:57:56
- Files changed:
    - src/proxy/index.ts             (handleChatCompletion: combo branch + _poolprox.comboName)
    - src/index.ts                   (loadCombosCache() wired into startup)
    - src/proxy/combos.ts            (handleComboRequest now returns winningModel alongside RouteResult)
- Behavior:
    - resolveCombo() called immediately after alias resolution. If hit, the
      proxy fans out via handleComboRequest with rotated sub-models; otherwise
      the original routeRequest path runs untouched.
    - Strategy + stickyLimit precedence: per-combo override > combo row column >
      global settings default. Implemented inline in proxy/index.ts.
    - Combo name preserved in originalComboName BEFORE body.model is reassigned
      to the winning sub-model. Surfaces as _poolprox.comboName in request log.
    - body.model swap to winningModel ensures token tracking, quota decrement,
      and usage_summary record the actual upstream model (per plan: "log both
      combo name AND actual model used").
    - Stream flag propagates unchanged; existing wrapStreamWithUsageFinalizer
      picks up the result.stream just like before — RouteResult shape
      preserved (winningModel is an additive intersection).
- Type extension trick:
    - handleComboRequest signature: Promise<RouteResult & { winningModel: string }>.
      RouteResult itself is unchanged in router.ts; intersection is local to
      the combos function so consumers can keep destructuring as before.
- Startup order:
    - ensureCombosTable() then await loadCombosCache() inside the SAME try/catch
      block in src/index.ts (extending the existing combos init block, per
      plan guidance). Cache must be hot before the first request.
- Verification:
    - lsp_diagnostics clean on src/proxy/index.ts, src/index.ts, src/proxy/combos.ts.
    - bunx tsc --noEmit: no NEW errors in changed files. Pre-existing errors in
      scripts/sync-filter-rules.ts, src/api/combos.ts, src/lib/tunnel/cloudflared.ts,
      and test/api/* are unrelated to Task 5.
- Evidence:
    - .sisyphus/evidence/task-5-combo-routing.txt
    - .sisyphus/evidence/task-5-normal-routing.txt
    - .sisyphus/evidence/task-5-combo-stream.txt

## [Tasks 7+8 Done] 2026-06-14 08:25:20
- Files:
  - dashboard/src/components/ComboFormModal.tsx (new, 290 lines) - Radix Dialog form, 4 fields, inline validation, server-error banner
  - dashboard/src/pages/Combos.tsx (new, 240 lines) - list page with table, empty state, edit/delete actions, delete-confirm dialog
  - dashboard/src/App.tsx (+2 lines) - lazy import + route after /filter-rules
  - dashboard/src/components/layout/Sidebar.tsx (+2 lines) - Layers icon import + nav item between Filter Rules and Proxy Settings
- UX decisions:
  - Strategy dropdown empty string -> POST/PATCH sends null for "Use global default"
  - Sticky-limit input ONLY visible when strategy = round-robin (per requirement). Empty string -> null on submit.
  - Models list: text inputs + per-row remove button + "Add Model" button (disabled at 10). "N / 10 models" counter on the right.
  - Validation: name regex/length only on create (disabled on edit), per-model empty check, sticky-limit integer 1-1000.
  - Server-side 4xx errors surface in a red AlertCircle banner at top of modal (uses err.message from fetchApi which throws with body.error).
  - Empty state: centered icon-circle, friendly copy, prominent "Create Combo" CTA.
  - Table: 5 cols (Name, Models pill+preview, Strategy, Created, Actions). Models preview = first 2 + "+N more" with full title= tooltip.
  - Delete-confirm uses shadcn Dialog with destructive button variant.
  - Live refresh: useWsEvent("combos_updated") refetches on any backend mutation broadcast.
- Build: bun run build (with VITE_BACKEND_PORT=1931 for evidence capture against single-port server) -> Combos-Dp8UOuEf.js 12.03 kB. Clean.
- LSP: all four files clean.
- Evidence (5 PNGs in .sisyphus/evidence/):
  - task-7-create-modal.png (61 KB) - filled-out form with round-robin + sticky=5 + 2 models
  - task-7-validation-error.png (57 KB) - Name + Models inline errors after empty submit
  - task-8-page-load.png (44 KB) - one combo rendered with proper strategy formatting
  - task-8-delete-confirm.png (50 KB) - red-button confirmation dialog
  - task-8-empty-state.png (42 KB) - centered empty state with CTA
- Gotchas worth recording:
  - The dashboard's resolveApiBase() does (port - 1) by default. When server serves dashboard + API on the same port (1931), the build needs VITE_BACKEND_PORT=1931 OR VITE_API_BASE for production-vs-dev parity. Default vite-dev ergonomics assume vite-on-1931 + backend-on-1930.
  - The MCP playwright skill became unstable after browser_evaluate with multi-line function string. Fallback: globally-installed playwright + node script via NODE_PATH override worked reliably (capture.mjs in C:\Users\Nazril\AppData\Local\Temp\opencode\pw-evidence\).
  - Combo backend rejects empty strategy as null: ok. Sticky limit: integer 1-1000.

## [Task 9 Done] 2026-06-14 08:27:03
- Files: dashboard/src/pages/Settings.tsx, src/api/proxy-settings.ts, dashboard/src/lib/api.ts
- Behavior:
  - Added 4th 'Combo Settings' Card to Settings.tsx (matches existing Card / heading / select / Input style — native <select>, not shadcn Select, to mirror page convention).
  - Section is self-contained: its own state (comboStrategy / comboStickyLimit / comboDirty), its own Save button, its own toast via useTimedMessage. Does NOT pollute the global form/dirty state.
  - On mount: load() reads combo_strategy + combo_sticky_limit from GET /api/settings (single fetch shared with the rest of the page), falls back to 'fallback' / '1'.
  - Sticky Limit Input is conditionally rendered (only when strategy === 'round-robin'). Strict hidden, not just disabled — verified via screenshot diff.
  - Save: sequential per-key PUT /api/settings/:key for combo_strategy then combo_sticky_limit. Sticky is normalized to Math.max(1, floor(...)) before save.
  - Added new helper updateSetting(key, value) in dashboard/src/lib/api.ts (per-key PUT).
- Backend (src/api/proxy-settings.ts):
  - New isComboSettingKey(key) covering 'combo_strategy' | 'combo_sticky_limit' | 'combo_strategies'.
  - Added the hook to BOTH PUT /:key (single) and PUT / (bulk) handlers — mirrors isProxyPoolSettingKey/isAutoWarmupSettingKey pattern.
  - On hit: await loadComboSettings(); resetComboRotation(); — refreshes cache + clears all combo rotation state so the new strategy applies on next request.
- Verification:
  - lsp_diagnostics: clean on all 3 changed files
  - dashboard bun run build: OK (Settings-*.js bundle now 12.79 kB)
  - bunx tsc --noEmit (project root): zero new errors in changed files (pre-existing errors elsewhere unchanged)
  - Playwright: round-robin+sticky=3 saved, page reload preserved values; fallback save hides sticky input (count drops from 2 -> 1 number inputs). Screenshots in .sisyphus/evidence/.
- Gotchas:
  - Existing Settings.tsx uses native <select>, not the shadcn Select wrapper. Plan said shadcn but MUST DO 'match existing visual language' wins — used native select.
  - The page already has a global bulk-save (updateSettings(form)). Tempting to merge combo keys into form, but per the plan 'writes BOTH keys via PUT /api/settings/<key>' the per-key path is required — and keeping combo state separate avoids surprising the user about which Save button writes which fields.
  - Playwright MCP session sometimes drops the chrome process between tools — recovery is killing all chrome.exe whose CommandLine contains 'ms-playwright-mcp' then re-navigating. Don't try to remove the Singleton/lockfile manually; the running chrome holds it.
  - useTimedMessage success toast disappears after 3s. The first screenshot was taken after the timer fired; the toast wasn't on screen but persistence-after-reload is what the screenshot is meant to demonstrate, which it does.


## [Follow-up] Model selector UI - 2026-06-14 09:01:56
- Replaced text inputs with searchable selector
- Source: /api/models filtered by owned_by !== "combo"
- Implementation: self-contained ModelSelector component inside ComboFormModal.tsx (no new ui/ primitive — kept scope minimal)
- Features:
  - Click trigger button -> opens panel with search input + scrollable filtered list
  - Search filters by id OR provider (case-insensitive)
  - Options grouped by owned_by (kiro / kiro-pro / canva / qoder / codex / codebuddy)
  - Outside-click + Escape close the panel
  - Auto-focus search input on open
  - Preserves unknown values: if a row's value is not in /api/models, it gets prepended as an "(unknown)" entry instead of being silently dropped
  - Falls back to plain Input when /api/models fails or returns empty (so user is never blocked)
- State: /api/models fetched once when modal opens, shared across all rows via parent state
- No new dependencies; uses existing lucide-react icons (Check, ChevronDown, Search) + cn() helper
- Build: bun run build clean. LSP clean.
- Evidence: .sisyphus/evidence/task-7-model-selector.png (52 KB) — modal with row 1 = "cb-sonnet-4.6" selected, row 2 dropdown OPEN searching "kiro" with KIRO provider group visible

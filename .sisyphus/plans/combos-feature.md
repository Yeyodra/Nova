# Combos Feature — Virtual Model Groups with Fallback & Round-Robin

## TL;DR

> **Quick Summary**: Add a "combos" feature that lets users create virtual model names containing multiple real models. When a request targets a combo, the system tries sub-models using fallback (sequential) or round-robin (rotating) strategy.
> 
> **Deliverables**:
> - New `combos` DB table with Drizzle schema + migration
> - Combo resolution engine (in-memory rotation + fallback loop)
> - API CRUD endpoints at `/api/combos`
> - Combo settings (global + per-combo) in settings table
> - `/v1/models` integration (combos appear as available models)
> - Dashboard CRUD page at `/combos` with modal form
> - Dashboard settings section for combo strategy config
> 
> **Estimated Effort**: Medium (3-5 days)
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 (schema) → Task 3 (engine) → Task 5 (proxy integration) → Task 8 (dashboard page)

---

## Context

### Original Request
User wants to add a "combos" feature inspired by 9router_wyx0's implementation. A combo is a virtual model containing multiple real models — when requested, the system tries each sub-model with fallback or round-robin strategy.

### Interview Summary
**Key Discussions**:
- Strategy: Both fallback AND round-robin with configurable sticky limit
- Kind: No kind field — all combos are chat completion only
- Dashboard: Full CRUD page with dedicated route
- Settings: Global combo strategy + per-combo override, configurable from dashboard
- /v1/models: Combos appear as models with owned_by="combo"
- Tests: No automated tests — agent-executed QA scenarios only

**Research Findings** (4 sessions, 15+ explorer agents):
- 9router pattern: combos table, handleComboChat fallback loop, getRotatedModels with sticky counter, resetComboRotation on update
- Etteum-pool: Hono backend, Drizzle ORM, React+shadcn dashboard, provider registry with ownsModel(), pool with getNextAccount()
- Insertion point: proxy/index.ts between resolveModelAlias() (line 457) and routeRequest() (line 459)

### Sun Tzu Review
**Identified Gaps** (addressed):
- Nested combos: BLOCKED — validate combo cannot reference another combo name
- Model collision: Validate combo name doesn't collide with real model IDs
- Max sub-models: Cap at 10 models per combo
- Logging: Log both combo name AND actual model used (combo name in request_body metadata)
- All-fail behavior: Return 503 with "All combo models unavailable" message
- Rotation state: Ephemeral (resets on restart) — acceptable, documented

---

## Work Objectives

### Core Objective
Enable users to create virtual model groups (combos) that route requests to multiple real models with configurable fallback/round-robin strategy.

### Concrete Deliverables
- `src/db/schema.ts` — new `combos` table
- `src/proxy/combos.ts` — combo resolution engine (rotation + fallback)
- `src/api/combos.ts` — CRUD API endpoints
- `src/proxy/index.ts` — combo integration in request flow
- `dashboard/src/pages/Combos.tsx` — management page
- `dashboard/src/components/ComboFormModal.tsx` — create/edit form
- Settings integration for combo strategy config

### Definition of Done
- [ ] `curl /v1/models` shows combo names with owned_by="combo"
- [ ] `curl /v1/chat/completions -d '{"model":"my-combo",...}'` routes to sub-models
- [ ] Fallback: if first model fails, tries next model in combo
- [ ] Round-robin: rotates starting model across requests
- [ ] Dashboard: can create, edit, delete combos
- [ ] Settings: can change global strategy from dashboard

### Must Have
- Combo CRUD (create, read, update, delete)
- Fallback strategy (try models in order)
- Round-robin strategy (rotate with sticky limit)
- /v1/models integration
- Dashboard management page
- Validation: no nested combos, no name collision with real models, max 10 models

### Must NOT Have (Guardrails)
- ❌ Weighted routing / priority weights per model
- ❌ Per-model health checks within combo (use existing routeRequest retry)
- ❌ Combo-specific rate limits (use existing account-level limits)
- ❌ Combo analytics/stats page (log normally, analytics is separate feature)
- ❌ Import/export combos
- ❌ Combo-level API key restrictions
- ❌ Nested combos (combo referencing another combo)
- ❌ Kind field (all combos = chat)
- ❌ WebSocket real-time combo status updates
- ❌ Over-abstraction — keep code simple and direct

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun test available)
- **Automated tests**: NONE (user decision)
- **Framework**: N/A
- **QA Method**: Agent-executed scenarios using curl, dashboard interaction

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **API/Backend**: Use Bash (curl) — Send requests, assert status + response fields
- **Frontend/UI**: Use Playwright — Navigate, interact, assert DOM, screenshot
- **Engine Logic**: Use Bash (bun run) — Import module, call functions, verify output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — all independent, start immediately):
├── Task 1: DB schema + migration [quick]
├── Task 2: Combo settings schema + helpers [quick]
└── Task 3: Combo resolution engine (rotation + fallback) [deep]

Wave 2 (API + Integration — depends on Wave 1):
├── Task 4: API CRUD endpoints /api/combos [unspecified-high]
├── Task 5: Proxy integration (combo resolution in request flow) [deep]
└── Task 6: /v1/models integration [quick]

Wave 3 (Dashboard — depends on Wave 2 API):
├── Task 7: Dashboard ComboFormModal component [visual-engineering]
├── Task 8: Dashboard Combos page (list + CRUD) [visual-engineering]
└── Task 9: Dashboard Settings combo section [visual-engineering]

Wave FINAL (Verification — after ALL tasks):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real QA execution (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 3, 4, 5, 6 | 1 |
| 2 | — | 4, 5, 9 | 1 |
| 3 | — | 5 | 1 |
| 4 | 1, 2 | 6, 7, 8 | 2 |
| 5 | 1, 2, 3 | F1-F4 | 2 |
| 6 | 1, 4 | F1-F4 | 2 |
| 7 | 4 | 8 | 3 |
| 8 | 4, 7 | F1-F4 | 3 |
| 9 | 2, 4 | F1-F4 | 3 |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks — T1 → `quick`, T2 → `quick`, T3 → `deep`
- **Wave 2**: 3 tasks — T4 → `unspecified-high`, T5 → `deep`, T6 → `quick`
- **Wave 3**: 3 tasks — T7 → `visual-engineering`, T8 → `visual-engineering`, T9 → `visual-engineering`
- **FINAL**: 4 tasks — F1 → oracle, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Database Schema — Combos Table + Migration

  **What to do**:
  - Add `combos` table to `src/db/schema.ts` using Drizzle ORM:
    ```
    combos: id (integer PK autoincrement), name (text unique NOT NULL), models (text JSON mode), strategy (text nullable - "fallback"|"round-robin"|null for global default), stickyLimit (integer nullable - null for global default), createdAt (integer timestamp), updatedAt (integer timestamp)
    ```
  - Add unique index on `name`
  - Export `Combo` and `NewCombo` types (inferred from schema)
  - Create runtime table guarantee (same pattern as model-mapping.ts `ensureModelMappingTable()`) using `client.exec(CREATE TABLE IF NOT EXISTS ...)`
  - Generate Drizzle migration: `bunx drizzle-kit generate`

  **Must NOT do**:
  - No `kind` field
  - No foreign keys to other tables
  - No complex indexes beyond name uniqueness

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
    - Simple schema addition following existing patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 3, 4, 5, 6
  - **Blocked By**: None

  **References**:
  - `src/db/schema.ts:1-23` — Existing accounts table pattern (sqliteTable, integer PK, text fields, timestamps)
  - `src/proxy/model-mapping.ts:45-62` — `ensureModelMappingTable()` pattern for runtime CREATE TABLE IF NOT EXISTS
  - `src/db/index.ts` — Database connection exports (db, client)
  - `C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\src\lib\db\repos\combosRepo.js:5-15` — 9router combo data structure reference

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: Table creation on startup
    Tool: Bash (bun run)
    Preconditions: Fresh database or existing database without combos table
    Steps:
      1. Run: bun run src/db/index.ts (or import and call ensureCombosTable)
      2. Query: sqlite3 etteum-pool.db ".schema combos"
    Expected Result: Table exists with columns: id, name, models, strategy, sticky_limit, created_at, updated_at
    Evidence: .sisyphus/evidence/task-1-schema-creation.txt

  Scenario: TypeScript types compile
    Tool: Bash
    Steps:
      1. Run: bunx tsc --noEmit src/db/schema.ts
    Expected Result: Exit code 0, no type errors
    Evidence: .sisyphus/evidence/task-1-types-compile.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(combos): add schema, settings, and resolution engine`
  - Files: `src/db/schema.ts`

- [x] 2. Combo Settings Schema + Helpers

  **What to do**:
  - Add combo-related settings to the existing settings system:
    - `combo_strategy`: "fallback" | "round-robin" (default: "fallback")
    - `combo_sticky_limit`: number (default: 1)
    - `combo_strategies`: JSON object for per-combo overrides `{ "combo-name": { strategy: "round-robin", stickyLimit: 3 } }`
  - Create `src/proxy/combo-settings.ts` with helpers:
    ```typescript
    export function getComboStrategy(): "fallback" | "round-robin"
    export function getComboStickyLimit(): number
    export function getComboSpecificStrategy(comboName: string): { strategy?: string; stickyLimit?: number } | null
    export function loadComboSettings(): void  // load from DB into memory cache
    export function updateComboSettings(key: string, value: unknown): void  // update cache + DB
    ```
  - Use the existing `settings` table (key-value store) — same pattern as model_mapping_enabled
  - Cache settings in memory for hot-path performance (reload on update)

  **Must NOT do**:
  - No new table for settings (use existing settings table)
  - No complex validation beyond type checking

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 4, 5, 9
  - **Blocked By**: None

  **References**:
  - `src/proxy/model-mapping.ts:17-21` — Settings cache pattern (let cache, let masterEnabled, loadFromDB)
  - `src/db/schema.ts` — settings table definition (key text PK, value text)
  - `src/api/proxy-settings.ts` — How settings are read/written via API
  - `C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\src\lib\db\repos\settingsRepo.js:15-17` — 9router default combo settings reference

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: Default settings loaded
    Tool: Bash (bun run)
    Steps:
      1. Import and call loadComboSettings()
      2. Call getComboStrategy()
      3. Call getComboStickyLimit()
    Expected Result: Returns "fallback" and 1 respectively (defaults)
    Evidence: .sisyphus/evidence/task-2-default-settings.txt

  Scenario: Settings update persists
    Tool: Bash (bun run)
    Steps:
      1. Call updateComboSettings("combo_strategy", "round-robin")
      2. Call getComboStrategy()
    Expected Result: Returns "round-robin"
    Evidence: .sisyphus/evidence/task-2-settings-update.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(combos): add schema, settings, and resolution engine`
  - Files: `src/proxy/combo-settings.ts`

- [x] 3. Combo Resolution Engine (Rotation + Fallback)

  **What to do**:
  - Create `src/proxy/combos.ts` with the core combo engine:
    ```typescript
    // In-memory rotation state
    const comboRotationState = new Map<string, { index: number; consecutiveUseCount: number }>();

    // Get combo by name from DB (cached)
    export async function getComboByName(name: string): Promise<Combo | null>
    
    // Check if model string is a combo name
    export async function resolveCombo(modelStr: string): Promise<string[] | null>
    
    // Get rotated models based on strategy
    export function getRotatedModels(models: string[], comboName: string, strategy: string, stickyLimit: number): string[]
    
    // Reset rotation state (on combo update/delete)
    export function resetComboRotation(comboName?: string): void
    
    // Main combo handler — tries each model with fallback
    export async function handleComboRequest(
      body: ChatCompletionRequest,
      models: string[],
      comboName: string,
      stream: boolean
    ): Promise<RouteResult>
    
    // Load combos cache from DB
    export function loadCombosCache(): void
    export function invalidateCombosCache(): void
    ```
  - Implement rotation algorithm (same as 9router open-sse/services/combo.js):
    - fallback: return models in original order
    - round-robin: rotate from current index, advance after stickyLimit requests
  - Implement fallback loop:
    - For each model in rotated list: call `routeRequest({...body, model: subModel}, stream)`
    - On success (result.success): return immediately
    - On failure: log warning, try next model
    - All failed: throw Error("All combo models unavailable")
  - Validation helpers:
    - `isValidComboName(name)`: regex /^[a-zA-Z0-9_.\-]+$/, not in getAllModels()
    - `validateComboModels(models)`: max 10, no combo names in array (no nesting)
  - Cache combos in memory (Map<name, Combo>) for hot-path resolution

  **Must NOT do**:
  - No weighted routing
  - No per-model health checks
  - No nested combo support (validate and reject)
  - No complex error recovery beyond simple fallback

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
    - Core algorithmic logic requiring careful implementation

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 5
  - **Blocked By**: None (can use type stubs initially, wire to real DB in Task 5)

  **References**:
  - `C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\open-sse\services\combo.js:1-198` — FULL reference implementation (rotation algorithm lines 36-65, fallback loop lines 108-198, resetComboRotation lines 71-74)
  - `src/proxy/router.ts:88-230` — routeRequest() function signature and return type (RouteResult)
  - `src/proxy/providers/base.ts:11-24` — ChatCompletionRequest type definition
  - `src/proxy/model-mapping.ts:19-21` — Cache pattern (let cache, load from DB)
  - `src/proxy/providers/registry.ts:60-62` — getAllModels() for name collision check

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: Fallback strategy tries models in order
    Tool: Bash (bun run)
    Steps:
      1. Create test with mock routeRequest that fails for first model, succeeds for second
      2. Call handleComboRequest with models=["model-a", "model-b"], strategy="fallback"
    Expected Result: Returns result from "model-b", logs show "model-a" tried first and failed
    Evidence: .sisyphus/evidence/task-3-fallback-order.txt

  Scenario: Round-robin rotates across requests
    Tool: Bash (bun run)
    Steps:
      1. Call getRotatedModels(["a","b","c"], "test", "round-robin", 1) three times
      2. Check returned order each time
    Expected Result: First call starts with "a", second with "b", third with "c"
    Evidence: .sisyphus/evidence/task-3-roundrobin-rotation.txt

  Scenario: Sticky limit holds model for N requests
    Tool: Bash (bun run)
    Steps:
      1. Call getRotatedModels(["a","b"], "test", "round-robin", 3) six times
      2. Check first element each time
    Expected Result: First 3 calls start with "a", next 3 start with "b"
    Evidence: .sisyphus/evidence/task-3-sticky-limit.txt

  Scenario: Nested combo rejected
    Tool: Bash (bun run)
    Steps:
      1. Create combo "parent" with models=["child-combo"] where "child-combo" is also a combo name
      2. Call validateComboModels(["child-combo"])
    Expected Result: Throws validation error "Nested combos not allowed"
    Evidence: .sisyphus/evidence/task-3-nested-rejected.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(combos): add schema, settings, and resolution engine`
  - Files: `src/proxy/combos.ts`

- [x] 4. API CRUD Endpoints — /api/combos

  **What to do**:
  - Create `src/api/combos.ts` with Hono router:
    ```
    GET    /api/combos          — List all combos
    POST   /api/combos          — Create combo {name, models, strategy?, stickyLimit?}
    GET    /api/combos/:id      — Get combo by ID
    PATCH  /api/combos/:id      — Update combo (partial)
    DELETE /api/combos/:id      — Delete combo
    ```
  - Validation on create/update:
    - name: required, regex /^[a-zA-Z0-9_.\-]+$/, unique, not colliding with real model IDs
    - models: required array, 1-10 items, each string, no combo names (no nesting)
    - strategy: optional, must be "fallback" | "round-robin" | null
    - stickyLimit: optional, must be positive integer | null
  - On update/delete: call `resetComboRotation(combo.name)` and `invalidateCombosCache()`
  - Register in `src/api/index.ts`: `apiRouter.route("/combos", combosRouter)`

  **Must NOT do**:
  - No pagination (combos list will be small)
  - No filtering/search
  - No bulk operations

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6)
  - **Blocks**: Tasks 6, 7, 8
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `src/api/filters.ts` — CRUD API pattern reference (GET list, POST create, PATCH/:id, DELETE/:id)
  - `src/api/index.ts:22-42` — Route registration pattern
  - `C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\src\app\api\combos\route.js` — 9router combo API reference
  - `C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\src\app\api\combos\[id]\route.js` — 9router combo CRUD with resetComboRotation
  - `src/proxy/combos.ts` — resetComboRotation, invalidateCombosCache, isValidComboName, validateComboModels

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: Create combo successfully
    Tool: Bash (curl)
    Preconditions: Server running on localhost:1931
    Steps:
      1. curl -s -X POST http://localhost:1931/api/combos -H 'Content-Type: application/json' -d '{"name":"test-combo","models":["kiro/claude-sonnet-4-20250514","codebuddy/gpt-4.1"]}'
      2. Assert response status 201
      3. Assert response body has id, name="test-combo", models array with 2 items
    Expected Result: 201 with combo object containing id, name, models, createdAt
    Evidence: .sisyphus/evidence/task-4-create-combo.txt

  Scenario: Reject invalid combo name
    Tool: Bash (curl)
    Steps:
      1. curl -s -X POST http://localhost:1931/api/combos -H 'Content-Type: application/json' -d '{"name":"invalid name!","models":["kiro/model"]}'
      2. Assert response status 400
    Expected Result: 400 with error message about invalid name format
    Evidence: .sisyphus/evidence/task-4-invalid-name.txt

  Scenario: Reject duplicate name
    Tool: Bash (curl)
    Steps:
      1. Create combo "dup-test"
      2. Try to create another combo "dup-test"
      3. Assert second request returns 400
    Expected Result: 400 with "Combo name already exists" error
    Evidence: .sisyphus/evidence/task-4-duplicate-name.txt

  Scenario: Reject name colliding with real model
    Tool: Bash (curl)
    Steps:
      1. curl -s -X POST http://localhost:1931/api/combos -H 'Content-Type: application/json' -d '{"name":"claude-sonnet-4-20250514","models":["kiro/model"]}'
      2. Assert response status 400
    Expected Result: 400 with "Name collides with existing model" error
    Evidence: .sisyphus/evidence/task-4-name-collision.txt

  Scenario: Delete combo resets rotation
    Tool: Bash (curl)
    Steps:
      1. Create combo, note ID
      2. DELETE /api/combos/:id
      3. Assert 200 with success:true
    Expected Result: Combo deleted, rotation state cleared
    Evidence: .sisyphus/evidence/task-4-delete-combo.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(combos): add API endpoints and proxy integration`
  - Files: `src/api/combos.ts`, `src/api/index.ts`

- [x] 5. Proxy Integration — Combo Resolution in Request Flow

  **What to do**:
  - Modify `src/proxy/index.ts` `handleChatCompletion()` function:
    - After `resolveModelAlias()` (line 457), before `routeRequest()` (line 459)
    - Add combo resolution:
      ```typescript
      import { resolveCombo, handleComboRequest } from "./combos";
      
      // In handleChatCompletion():
      const comboModels = await resolveCombo(body.model);
      if (comboModels) {
        // Route through combo engine instead of normal routeRequest
        const comboResult = await handleComboRequest(body, comboModels, body.model, isStream);
        // ... handle result same as normal routeRequest result
      }
      ```
  - Ensure combo requests are logged with combo name in metadata (requestBody._poolprox.comboName)
  - Ensure credits/usage tracking works correctly for combo requests (track actual model used)
  - Handle stream vs non-stream for combo results (same wrapStreamWithUsageFinalizer pattern)
  - Call `loadCombosCache()` on server startup (in src/index.ts or proxy init)

  **Must NOT do**:
  - Don't change routeRequest() signature
  - Don't add combo logic inside routeRequest itself (keep it in handleChatCompletion)
  - Don't break existing non-combo request flow

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
    - Critical integration point, must not break existing functionality

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 6)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1, 2, 3

  **References**:
  - `src/proxy/index.ts:454-563` — handleChatCompletion() full function (insertion point at line 457-459)
  - `src/proxy/index.ts:239-452` — wrapStreamWithUsageFinalizer (for stream handling pattern)
  - `src/proxy/router.ts:88-100` — routeRequest() signature and RouteResult type
  - `src/proxy/combos.ts` — resolveCombo(), handleComboRequest() from Task 3
  - `C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\src\sse\handlers\chat.js:93-112` — 9router combo detection in chat handler

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: Combo model routes through sub-models
    Tool: Bash (curl)
    Preconditions: Server running, combo "test-combo" exists with models ["kiro/claude-sonnet-4-20250514"]
    Steps:
      1. curl -s -X POST http://localhost:1931/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"test-combo","messages":[{"role":"user","content":"say hi"}],"stream":false}'
      2. Assert response status 200
      3. Assert response has choices[0].message.content
    Expected Result: 200 with valid chat completion response
    Evidence: .sisyphus/evidence/task-5-combo-routing.txt

  Scenario: Non-combo models still work normally
    Tool: Bash (curl)
    Steps:
      1. curl -s -X POST http://localhost:1931/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"claude-sonnet-4-20250514","messages":[{"role":"user","content":"say hi"}],"stream":false}'
      2. Assert response status 200
    Expected Result: Normal routing unaffected by combo feature
    Evidence: .sisyphus/evidence/task-5-normal-routing.txt

  Scenario: Combo with stream=true works
    Tool: Bash (curl)
    Steps:
      1. curl -s -N -X POST http://localhost:1931/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"test-combo","messages":[{"role":"user","content":"say hi"}],"stream":true}'
      2. Assert SSE format (data: ... lines ending with data: [DONE])
    Expected Result: Streaming response with proper SSE format
    Evidence: .sisyphus/evidence/task-5-combo-stream.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(combos): add API endpoints and proxy integration`
  - Files: `src/proxy/index.ts`, `src/index.ts` (startup cache load)

- [x] 6. /v1/models Integration — Combos in Model List

  **What to do**:
  - Modify `src/proxy/index.ts` GET `/v1/models` handler (line 568-577):
    - After getting provider models via `getAllModels()`, append combo models
    - Each combo appears as: `{ id: combo.name, object: "model", created: combo.createdAt, owned_by: "combo" }`
  - Also update `src/api/index.ts` GET `/api/models` (line 44-48) with same logic
  - Import combo list from combos cache

  **Must NOT do**:
  - No filtering by kind (all combos shown)
  - No special metadata beyond owned_by="combo"

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 1, 4

  **References**:
  - `src/proxy/index.ts:568-577` — Current GET /v1/models handler
  - `src/api/index.ts:44-48` — Current GET /api/models handler
  - `src/proxy/providers/base.ts:101-113` — ModelInfo interface
  - `C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\src\app\api\v1\models\route.js:203-214` — 9router combo injection in /v1/models

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: Combos appear in /v1/models
    Tool: Bash (curl)
    Preconditions: Combo "test-combo" exists
    Steps:
      1. curl -s http://localhost:1931/v1/models | jq '.data[] | select(.owned_by=="combo")'
      2. Assert at least one result with id="test-combo"
    Expected Result: Combo model object with id, object="model", owned_by="combo"
    Evidence: .sisyphus/evidence/task-6-models-list.txt

  Scenario: No combos when none exist
    Tool: Bash (curl)
    Preconditions: No combos in database
    Steps:
      1. curl -s http://localhost:1931/v1/models | jq '[.data[] | select(.owned_by=="combo")] | length'
    Expected Result: 0
    Evidence: .sisyphus/evidence/task-6-no-combos.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(combos): add API endpoints and proxy integration`
  - Files: `src/proxy/index.ts`, `src/api/index.ts`

- [x] 7. Dashboard — ComboFormModal Component

  **What to do**:
  - Create `dashboard/src/components/ComboFormModal.tsx`:
    - Dialog modal (Radix Dialog) for creating/editing combos
    - Fields:
      - Name (text input, disabled on edit)
      - Models (dynamic list — add/remove model strings)
      - Strategy override (select: "Use global default" | "fallback" | "round-robin")
      - Sticky Limit override (number input, shown only when strategy = round-robin)
    - Model list UI: each model is a text input row with remove button, plus "Add Model" button
    - Validation: name format, at least 1 model, max 10 models
    - Submit: POST /api/combos (create) or PATCH /api/combos/:id (edit)
    - On success: close modal, refresh parent list

  **Must NOT do**:
  - No model autocomplete/dropdown (just text input — user types model name)
  - No drag-and-drop reordering (use simple up/down buttons or just order by input)
  - No complex validation UI beyond inline error messages

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 8, 9)
  - **Blocks**: Task 8
  - **Blocked By**: Task 4

  **References**:
  - `dashboard/src/pages/FilterRules.tsx` — CRUD modal pattern (Dialog, form state, fetchApi calls)
  - `dashboard/src/lib/api.ts` — fetchApi wrapper usage
  - `C:\Users\Nazril\Documents\Projek\Github\9router_wyx0\src\shared\components\ComboFormModal.js` — 9router combo form reference (fields, validation, model list UI)
  - `dashboard/src/components/` — Existing component patterns (ui/ directory with shadcn components)

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: Create combo via modal
    Tool: Playwright
    Preconditions: Dashboard open at /combos
    Steps:
      1. Click "Create Combo" button
      2. Fill name: "playwright-test"
      3. Add model: "kiro/claude-sonnet-4-20250514"
      4. Add model: "codebuddy/gpt-4.1"
      5. Click "Save"
      6. Assert modal closes
      7. Assert "playwright-test" appears in combo list
    Expected Result: Combo created and visible in list
    Evidence: .sisyphus/evidence/task-7-create-modal.png

  Scenario: Validation prevents empty name
    Tool: Playwright
    Steps:
      1. Open create modal
      2. Leave name empty, add one model
      3. Click "Save"
      4. Assert error message shown for name field
    Expected Result: Form shows validation error, does not submit
    Evidence: .sisyphus/evidence/task-7-validation-error.png
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(combos): add dashboard management page`
  - Files: `dashboard/src/components/ComboFormModal.tsx`

- [x] 8. Dashboard — Combos Page (List + CRUD)

  **What to do**:
  - Create `dashboard/src/pages/Combos.tsx`:
    - Page title "Combos" with description
    - "Create Combo" button (opens ComboFormModal)
    - Table/list showing all combos:
      - Columns: Name, Models (count + preview), Strategy, Created
      - Row actions: Edit (opens modal), Delete (confirm dialog)
    - Empty state when no combos exist
    - Loading state while fetching
    - Delete confirmation dialog
  - Register route in `dashboard/src/App.tsx`:
    - Add lazy import: `const Combos = lazy(() => import("./pages/Combos"))`
    - Add route: `<Route path="/combos" element={<Combos />} />`
  - Add navigation link in sidebar/nav (follow existing pattern)

  **Must NOT do**:
  - No pagination (combo list will be small)
  - No search/filter
  - No drag-and-drop reordering
  - No inline editing (use modal only)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 7, 9)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 4, 7

  **References**:
  - `dashboard/src/pages/FilterRules.tsx` — Full CRUD page pattern (table, modals, delete confirm, fetchApi)
  - `dashboard/src/pages/Models.tsx` — Model listing page pattern
  - `dashboard/src/App.tsx` — Route registration and lazy loading pattern
  - `dashboard/src/components/` — Sidebar/navigation component for adding link

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: Combos page loads with list
    Tool: Playwright
    Preconditions: At least one combo exists
    Steps:
      1. Navigate to http://localhost:1931/combos
      2. Assert page title "Combos" visible
      3. Assert table has at least one row
      4. Assert row shows combo name and model count
    Expected Result: Page renders with combo list
    Evidence: .sisyphus/evidence/task-8-page-load.png

  Scenario: Delete combo with confirmation
    Tool: Playwright
    Preconditions: Combo "delete-test" exists
    Steps:
      1. Navigate to /combos
      2. Click delete button on "delete-test" row
      3. Assert confirmation dialog appears
      4. Click "Confirm" / "Delete"
      5. Assert "delete-test" no longer in list
    Expected Result: Combo deleted after confirmation
    Evidence: .sisyphus/evidence/task-8-delete-confirm.png

  Scenario: Empty state shown when no combos
    Tool: Playwright
    Preconditions: No combos in database
    Steps:
      1. Navigate to /combos
      2. Assert empty state message visible (e.g. "No combos yet")
    Expected Result: Friendly empty state with create button
    Evidence: .sisyphus/evidence/task-8-empty-state.png
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(combos): add dashboard management page`
  - Files: `dashboard/src/pages/Combos.tsx`, `dashboard/src/App.tsx`

- [x] 9. Dashboard — Settings Combo Section

  **What to do**:
  - Add combo settings section to `dashboard/src/pages/Settings.tsx`:
    - Section title: "Combo Settings"
    - Fields:
      - Global Strategy: select dropdown ("fallback" | "round-robin")
      - Sticky Limit: number input (shown when strategy = round-robin)
    - Save button that PATCHes /api/settings with combo_strategy and combo_sticky_limit
  - Add API endpoint in `src/api/proxy-settings.ts` (or existing settings handler):
    - GET /api/settings should include combo_strategy, combo_sticky_limit
    - PATCH /api/settings should accept combo_strategy, combo_sticky_limit updates
    - On combo settings change: call resetComboRotation() to clear all rotation state

  **Must NOT do**:
  - No per-combo strategy override UI here (that's in the ComboFormModal per-combo fields)
  - No complex validation beyond type checking

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 7, 8)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 2, 4

  **References**:
  - `dashboard/src/pages/Settings.tsx` — Existing settings page (add section to it)
  - `src/api/proxy-settings.ts` — Settings API pattern (GET/PATCH)
  - `src/proxy/combo-settings.ts` — updateComboSettings(), loadComboSettings() from Task 2
  - `src/proxy/combos.ts` — resetComboRotation() from Task 3

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: Change global combo strategy
    Tool: Playwright
    Preconditions: Dashboard open at /settings
    Steps:
      1. Scroll to "Combo Settings" section
      2. Change strategy dropdown to "round-robin"
      3. Set sticky limit to 3
      4. Click Save
      5. Reload page
      6. Assert strategy shows "round-robin" and sticky limit shows 3
    Expected Result: Settings persisted and displayed correctly after reload
    Evidence: .sisyphus/evidence/task-9-settings-save.png

  Scenario: Sticky limit hidden when fallback selected
    Tool: Playwright
    Steps:
      1. Navigate to /settings
      2. Set strategy to "fallback"
      3. Assert sticky limit input is hidden or disabled
    Expected Result: Sticky limit not shown for fallback strategy
    Evidence: .sisyphus/evidence/task-9-sticky-hidden.png
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(combos): add dashboard management page`
  - Files: `dashboard/src/pages/Settings.tsx`, `src/api/proxy-settings.ts`

---

## Final Verification Wave

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `bunx tsc --noEmit`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real QA Execution** — `unspecified-high` (+ `playwright` skill for dashboard)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (create combo via API → use in chat → verify in dashboard). Test edge cases: empty combo, invalid name, all models fail.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Wave | Commit Message | Files |
|------|---------------|-------|
| 1 | `feat(combos): add schema, settings, and resolution engine` | src/db/schema.ts, src/proxy/combos.ts, drizzle migration |
| 2 | `feat(combos): add API endpoints and proxy integration` | src/api/combos.ts, src/api/index.ts, src/proxy/index.ts |
| 3 | `feat(combos): add dashboard management page` | dashboard/src/pages/Combos.tsx, dashboard/src/components/ComboFormModal.tsx, dashboard/src/App.tsx |

---

## Success Criteria

### Verification Commands
```bash
# API works
curl -s http://localhost:1931/api/combos | jq '.combos | length'  # Expected: 0 (empty initially)

# Create combo
curl -s -X POST http://localhost:1931/api/combos -H 'Content-Type: application/json' -d '{"name":"test-combo","models":["kiro/claude-sonnet-4-20250514","codebuddy/gpt-4.1"]}' | jq '.id'  # Expected: non-null UUID

# Combo appears in /v1/models
curl -s http://localhost:1931/v1/models | jq '.data[] | select(.id=="test-combo")'  # Expected: {id: "test-combo", owned_by: "combo"}

# Chat completion routes through combo
curl -s -X POST http://localhost:1931/v1/chat/completions -H 'Content-Type: application/json' -d '{"model":"test-combo","messages":[{"role":"user","content":"hi"}],"stream":false}'  # Expected: 200 with response from one of the sub-models
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] Combo CRUD works end-to-end
- [ ] Fallback strategy works (first model fails → tries next)
- [ ] Round-robin strategy works (rotates across requests)
- [ ] Dashboard page functional
- [ ] No TypeScript errors

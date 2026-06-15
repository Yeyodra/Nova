# Backup/Restore API — Account Credentials per Provider

## TL;DR

> **Quick Summary**: Tambah REST API endpoint untuk backup dan restore akun pool per provider. Export/import dalam format JSON dengan credentials tetap encrypted.
> 
> **Deliverables**:
> - `GET /api/backup` — Export akun (filter by provider optional)
> - `POST /api/restore` — Import akun dari JSON (skip/overwrite strategy)
> - Test file untuk verify behavior
> 
> **Estimated Effort**: Short (2-3 tasks)
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 (backup) → Task 2 (restore) → Task 3 (test + integration)

---

## Context

### Original Request
User mau fitur API backup/restore yang berfungsi backup/restore akun pool dari tiap provider, output dalam bentuk JSON.

### Interview Summary
**Key Discussions**:
- Scope: Credential account per provider saja (email, password, tokens, metadata)
- Per-provider filtering: User bisa backup hanya provider tertentu
- Security: Export tetap encrypted (tied ke ENCRYPTION_KEY)
- Conflict: Default skip, optional overwrite via query param
- Interface: REST API only

**Research Findings**:
- Provider tokens structure berbeda-beda (Kiro=OAuth, CodeBuddy=multi-token, Canva=cookies, Codex=OAuth, Qoder=PAT, BYOK=api_key)
- DB schema: `accounts` table dengan unique index `(provider, email)`
- Existing crypto: XOR cipher via `src/utils/crypto.ts`
- Password field = encrypted, email = plaintext, tokens = JSON (contains encrypted values internally)
- Existing bulk import: `POST /api/accounts` encrypts password on insert
- `data/backups/` directory exists for full DB backups

### Sun Tzu Review
**Identified Gaps** (addressed):
- Key mismatch detection: Include ENCRYPTION_KEY fingerprint in backup JSON → detect restore on wrong instance
- Schema validation: Validate JSON structure before any DB writes (fail-fast)
- Atomic restore: Wrap all inserts in transaction, rollback on any failure
- Restore inserts raw encrypted data (bypass encrypt layer) since backup exports already-encrypted blobs
- Body size limit: 10MB max on restore endpoint
- Foreign key consideration: `requestLogs` references `accounts.id` — overwrite strategy must handle this

---

## Work Objectives

### Core Objective
Implement REST API endpoints for backup/restore of pool account credentials per provider, with JSON output format and encrypted data preservation.

### Concrete Deliverables
- `src/api/backup.ts` — Backup & restore router
- Updated `src/api/index.ts` — Mount new router
- `test/api/backup-restore.test.ts` — Automated tests
- Pre-execution: DB backup safeguard

### Definition of Done
- [ ] `GET /api/backup` returns valid JSON with all accounts
- [ ] `GET /api/backup?provider=kiro` returns only kiro accounts
- [ ] `POST /api/restore` imports accounts, skips conflicts
- [ ] `POST /api/restore?strategy=overwrite` overwrites existing
- [ ] Key fingerprint mismatch detected and warned
- [ ] All tests pass: `bun test test/api/backup-restore.test.ts`

### Must Have
- Per-provider filtering on backup
- JSON output with version, timestamp, key fingerprint, accounts array
- Atomic restore (transaction-based)
- Schema validation before DB writes
- Skip/overwrite conflict strategy
- Encrypted data preserved as-is (no decrypt/re-encrypt)

### Must NOT Have (Guardrails)
- NO decrypt option on export — encrypted blobs only
- NO scheduled/automatic backups — manual API only
- NO backup of settings, logs, VCC, filter rules — accounts table only
- NO merge strategy — only skip and overwrite
- NO UI components — API only
- NO compression — plain JSON
- NO pagination on backup (accounts count is manageable)
- DO NOT delete or modify existing DB data without explicit user action (overwrite strategy)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (bun test, test/ directory with existing test files)
- **Automated tests**: YES (Tests-after)
- **Framework**: bun test (native)

### QA Policy
Every task includes agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **API/Backend**: Use Bash (curl) — Send requests, assert status + response fields

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — can run in parallel):
├── Task 0: DB Backup Safeguard [quick]
├── Task 1: Backup endpoint implementation [unspecified-high]
└── Task 2: Restore endpoint implementation [unspecified-high]

Wave 2 (After Wave 1):
├── Task 3: Mount router + integration wiring [quick]
└── Task 4: Automated tests [unspecified-high]

Critical Path: Task 0 → Task 1+2 (parallel) → Task 3 → Task 4
Parallel Speedup: ~40% faster than sequential
Max Concurrent: 2 (Wave 1, Task 1+2)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 0 | None | 1, 2 |
| 1 | 0 | 3 |
| 2 | 0 | 3 |
| 3 | 1, 2 | 4 |
| 4 | 3 | None |

### Agent Dispatch Summary

- **Wave 1**: T0 → `quick`, T1 → `unspecified-high`, T2 → `unspecified-high`
- **Wave 2**: T3 → `quick`, T4 → `unspecified-high`

---

## TODOs

- [x] 0. DB Backup Safeguard (Pre-execution Safety)

  **What to do**:
  - Copy `etteum-pool.db` to `data/backups/pre-backup-restore-feature-{timestamp}.db`
  - Verify copy is valid (file size > 0)

  **Must NOT do**:
  - Do NOT modify the original DB
  - Do NOT delete any existing backups

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (must complete before other tasks)
  - **Parallel Group**: Wave 1 prerequisite
  - **Blocks**: Tasks 1, 2, 3, 4
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `data/backups/` — Existing backup directory (already has .db backups)

  **Acceptance Criteria**:
  - [ ] Backup file exists at `data/backups/pre-backup-restore-feature-*.db`
  - [ ] File size matches original `etteum-pool.db`

  **QA Scenarios**:

  ```
  Scenario: DB backup created successfully
    Tool: Bash
    Preconditions: etteum-pool.db exists in project root
    Steps:
      1. Run: cp etteum-pool.db data/backups/pre-backup-restore-feature-$(date +%s).db
      2. Run: ls -la data/backups/pre-backup-restore-feature-*.db
      3. Compare file sizes: original vs backup
    Expected Result: Backup file exists, size matches original (within 0 bytes)
    Failure Indicators: File not found, size mismatch, permission error
    Evidence: .sisyphus/evidence/task-0-db-backup-verify.txt
  ```

  **Commit**: NO (infrastructure step, no code change)

---

- [x] 1. Backup Endpoint Implementation

  **What to do**:
  - Create `src/api/backup.ts` with Hono router
  - Implement `GET /` (maps to `/api/backup` when mounted):
    - Query param: `?provider=kiro` (optional, filter by provider)
    - Query all accounts from DB (or filtered by provider)
    - Generate ENCRYPTION_KEY fingerprint: first 8 chars of SHA-256 hash of the key
    - Return JSON structure:
      ```json
      {
        "version": 1,
        "timestamp": "2026-06-13T12:00:00.000Z",
        "keyFingerprint": "a1b2c3d4",
        "provider": "kiro" | "all",
        "accounts": [
          {
            "provider": "kiro",
            "email": "user@mail.com",
            "password": "<encrypted-hex>",
            "tokens": { ... },
            "metadata": { ... },
            "status": "active",
            "enabled": true,
            "quotaLimit": 100,
            "quotaRemaining": 50,
            "quotaResetAt": "2026-06-14T00:00:00.000Z",
            "createdAt": "2026-01-01T00:00:00.000Z"
          }
        ],
        "total": 5
      }
      ```
    - Password field: export as-is from DB (already encrypted)
    - Tokens field: export as-is from DB (JSON blob)
    - Exclude: `id`, `lastUsedAt`, `lastLoginAt`, `updatedAt`, `errorMessage` (runtime state, not portable)
  - Validate provider param against known list: `["kiro", "kiro-pro", "codebuddy", "canva", "codex", "qoder", "byok"]`
  - Return 400 if invalid provider specified

  **Must NOT do**:
  - Do NOT decrypt any fields
  - Do NOT include request logs or other tables
  - Do NOT add pagination (account count is manageable)
  - Do NOT add compression

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 3
  - **Blocked By**: Task 0

  **References**:

  **Pattern References**:
  - `src/api/accounts.ts:26-37` — GET list pattern (query all, sanitize, return `{ data: ... }`)
  - `src/api/stats.ts` — Query pattern with filters
  - `src/api/index.ts:34-36` — Provider list reference: `["kiro", "kiro-pro", "codebuddy", "canva", "codex", "qoder"]`

  **API/Type References**:
  - `src/db/schema.ts:3-23` — accounts table schema (all fields)
  - `src/db/index.ts` — DB instance import pattern

  **External References**:
  - Hono docs: `c.req.query("provider")` for query params
  - Bun crypto: `new Bun.CryptoHasher("sha256")` for key fingerprint

  **WHY Each Reference Matters**:
  - `accounts.ts:26-37`: Follow exact same pattern for querying + returning data
  - `schema.ts:3-23`: Know exact field names and types to include in export
  - `index.ts:34-36`: Canonical provider list to validate against

  **Acceptance Criteria**:
  - [ ] File `src/api/backup.ts` exists with `backupRouter` export
  - [ ] `GET /api/backup` returns JSON with version, timestamp, keyFingerprint, accounts array
  - [ ] `GET /api/backup?provider=kiro` returns only kiro accounts
  - [ ] `GET /api/backup?provider=invalid` returns 400 error
  - [ ] Password fields are encrypted hex strings (not plaintext)
  - [ ] Response excludes `id`, `lastUsedAt`, `lastLoginAt`, `updatedAt`, `errorMessage`

  **QA Scenarios**:

  ```
  Scenario: Backup all accounts
    Tool: Bash (curl)
    Preconditions: Server running on localhost:1931, at least 1 account exists in DB
    Steps:
      1. curl -s http://localhost:1931/api/backup | jq .
      2. Assert response has keys: version, timestamp, keyFingerprint, provider, accounts, total
      3. Assert .version == 1
      4. Assert .provider == "all"
      5. Assert .total > 0
      6. Assert .accounts[0] has keys: provider, email, password, tokens, metadata, status, enabled
      7. Assert .accounts[0] does NOT have keys: id, lastUsedAt, lastLoginAt, updatedAt, errorMessage
    Expected Result: Valid JSON with all accounts, encrypted passwords, no runtime fields
    Failure Indicators: 500 error, missing fields, plaintext passwords, id field present
    Evidence: .sisyphus/evidence/task-1-backup-all.json

  Scenario: Backup filtered by provider
    Tool: Bash (curl)
    Preconditions: Server running, accounts exist for multiple providers
    Steps:
      1. curl -s "http://localhost:1931/api/backup?provider=kiro" | jq .
      2. Assert .provider == "kiro"
      3. Assert all items in .accounts[] have .provider == "kiro"
      4. Assert .total matches count of kiro accounts
    Expected Result: Only kiro accounts returned
    Failure Indicators: Accounts from other providers present, wrong total count
    Evidence: .sisyphus/evidence/task-1-backup-filtered.json

  Scenario: Invalid provider returns 400
    Tool: Bash (curl)
    Preconditions: Server running
    Steps:
      1. curl -s -w "\n%{http_code}" "http://localhost:1931/api/backup?provider=fakeprovider"
      2. Assert HTTP status == 400
      3. Assert response body contains "error"
    Expected Result: 400 status with error message
    Failure Indicators: 200 status, 500 error, empty response
    Evidence: .sisyphus/evidence/task-1-backup-invalid-provider.txt
  ```

  **Commit**: YES
  - Message: `feat(api): add backup endpoint for account credentials export`
  - Files: `src/api/backup.ts`
  - Pre-commit: `bun run src/api/backup.ts` (syntax check)

---

- [x] 2. Restore Endpoint Implementation

  **What to do**:
  - Add restore handler to `src/api/backup.ts` (same file as backup):
  - Implement `POST /restore` (maps to `/api/restore` when mounted):
    - Query param: `?strategy=skip` (default) or `?strategy=overwrite`
    - Body: JSON matching backup format (version, accounts array)
    - Validation steps (fail-fast, before any DB writes):
      1. Check `Content-Type: application/json`
      2. Validate body size ≤ 10MB
      3. Check `version` field exists and equals 1
      4. Check `accounts` is non-empty array
      5. Each account has required fields: `provider`, `email`, `password`
      6. Each `provider` is in valid provider list
      7. Check `keyFingerprint` matches current instance (WARN if mismatch, don't block)
    - Restore logic (wrapped in DB transaction):
      - For each account in payload:
        - Check if (provider, email) exists in DB
        - If exists AND strategy=skip → add to skipped list
        - If exists AND strategy=overwrite → UPDATE row (password, tokens, metadata, status, enabled, quota fields)
        - If not exists → INSERT new row
      - On any DB error → rollback entire transaction
    - Return response:
      ```json
      {
        "success": true,
        "imported": 5,
        "skipped": 2,
        "overwritten": 0,
        "errors": [],
        "keyMismatch": false,
        "details": {
          "imported_accounts": ["kiro:new@mail.com", ...],
          "skipped_accounts": ["kiro:existing@mail.com", ...],
          "overwritten_accounts": []
        }
      }
      ```
  - On keyFingerprint mismatch: still proceed but set `keyMismatch: true` in response (warning, not blocking — user might intentionally restore from same-key different instance)

  **Must NOT do**:
  - Do NOT re-encrypt passwords (they're already encrypted from backup)
  - Do NOT decrypt tokens
  - Do NOT implement merge strategy
  - Do NOT touch requestLogs or other tables
  - Do NOT auto-trigger warmup/login after restore
  - Do NOT allow restore without version field

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 1)
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 3
  - **Blocked By**: Task 0

  **References**:

  **Pattern References**:
  - `src/api/accounts.ts:47-95` — POST handler pattern (parse body, validate, insert, return result)
  - `src/api/accounts.ts` (bulk import section) — How multiple accounts are created
  - `src/utils/crypto.ts` — encrypt/decrypt functions (to understand what's already encrypted)

  **API/Type References**:
  - `src/db/schema.ts:3-23` — accounts table schema, unique index on (provider, email)
  - `src/db/index.ts` — DB instance, transaction support via Drizzle

  **External References**:
  - Drizzle ORM transactions: `db.transaction(async (tx) => { ... })`
  - Drizzle `onConflictDoUpdate` / `onConflictDoNothing` for upsert patterns

  **WHY Each Reference Matters**:
  - `accounts.ts:47-95`: Follow same validation + insert pattern
  - `crypto.ts`: Understand that password is already encrypted — restore must NOT re-encrypt
  - `schema.ts:3-23`: Know the unique constraint for conflict detection
  - `db/index.ts`: Get transaction API for atomic operations

  **Acceptance Criteria**:
  - [ ] `POST /api/restore` with valid JSON → imports accounts
  - [ ] Default strategy=skip: existing accounts not modified
  - [ ] strategy=overwrite: existing accounts updated
  - [ ] Invalid JSON body → 400 with validation errors
  - [ ] Missing version field → 400 rejection
  - [ ] Key fingerprint mismatch → warning in response, not blocking
  - [ ] All operations atomic (transaction rollback on error)
  - [ ] Response includes imported/skipped/overwritten counts + details

  **QA Scenarios**:

  ```
  Scenario: Restore with skip strategy (default)
    Tool: Bash (curl)
    Preconditions: Server running, backup JSON file available from Task 1 evidence
    Steps:
      1. First backup: curl -s http://localhost:1931/api/backup > /tmp/backup.json
      2. Restore same data: curl -s -X POST -H "Content-Type: application/json" -d @/tmp/backup.json http://localhost:1931/api/restore
      3. Assert response .success == true
      4. Assert .skipped == .total from backup (all already exist)
      5. Assert .imported == 0
    Expected Result: All accounts skipped (already exist), zero imports
    Failure Indicators: Duplicate key errors, imported > 0, success=false
    Evidence: .sisyphus/evidence/task-2-restore-skip.json

  Scenario: Restore with overwrite strategy
    Tool: Bash (curl)
    Preconditions: Server running, backup JSON available
    Steps:
      1. curl -s http://localhost:1931/api/backup > /tmp/backup.json
      2. curl -s -X POST -H "Content-Type: application/json" -d @/tmp/backup.json "http://localhost:1931/api/restore?strategy=overwrite"
      3. Assert response .success == true
      4. Assert .overwritten > 0
      5. Assert .skipped == 0
    Expected Result: All existing accounts overwritten, counts match
    Failure Indicators: DB errors, overwritten=0 when accounts exist
    Evidence: .sisyphus/evidence/task-2-restore-overwrite.json

  Scenario: Invalid payload rejected
    Tool: Bash (curl)
    Preconditions: Server running
    Steps:
      1. curl -s -X POST -H "Content-Type: application/json" -d '{"bad":"data"}' http://localhost:1931/api/restore
      2. Assert HTTP status == 400
      3. Assert response contains error about missing version/accounts
    Expected Result: 400 with clear validation error message
    Failure Indicators: 200/500 status, partial import, no error message
    Evidence: .sisyphus/evidence/task-2-restore-invalid.txt

  Scenario: Key fingerprint mismatch warning
    Tool: Bash (curl)
    Preconditions: Server running
    Steps:
      1. Create modified backup with wrong keyFingerprint: jq '.keyFingerprint = "deadbeef"' /tmp/backup.json > /tmp/backup-wrong-key.json
      2. curl -s -X POST -H "Content-Type: application/json" -d @/tmp/backup-wrong-key.json http://localhost:1931/api/restore
      3. Assert response .keyMismatch == true
      4. Assert response .success == true (still proceeds)
    Expected Result: Warning flag set but restore still works
    Failure Indicators: Restore blocked, keyMismatch not in response
    Evidence: .sisyphus/evidence/task-2-restore-key-mismatch.json
  ```

  **Commit**: YES
  - Message: `feat(api): add restore endpoint with skip/overwrite strategy`
  - Files: `src/api/backup.ts`
  - Pre-commit: `bun run src/api/backup.ts` (syntax check)

---

- [x] 3. Router Mounting & Integration Wiring

  **What to do**:
  - Edit `src/api/index.ts`:
    - Add import: `import { backupRouter } from "./backup"`
    - Add route: `apiRouter.route("/backup", backupRouter)`
    - Add route: `apiRouter.route("/restore", restoreRouter)` (or handle within backup router)
  - Verify server starts without errors after mounting

  **Must NOT do**:
  - Do NOT modify any existing routes
  - Do NOT add middleware or auth changes
  - Do NOT touch other API files

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 4
  - **Blocked By**: Tasks 1, 2

  **References**:

  **Pattern References**:
  - `src/api/index.ts:1-45` — Exact pattern for importing and mounting routers

  **WHY Each Reference Matters**:
  - `index.ts:1-45`: Follow exact same import + `apiRouter.route()` pattern as all other routers

  **Acceptance Criteria**:
  - [ ] `src/api/index.ts` imports backupRouter
  - [ ] Routes mounted at `/backup` and `/restore`
  - [ ] Server starts without errors: `bun run dev` (no crash)

  **QA Scenarios**:

  ```
  Scenario: Server starts with new routes
    Tool: Bash
    Preconditions: All source files in place
    Steps:
      1. Start server: bun run dev (background, wait 3s)
      2. curl -s http://localhost:1931/api/backup → should return JSON (not 404)
      3. curl -s -X POST http://localhost:1931/api/restore → should return 400 (not 404)
      4. Kill server
    Expected Result: Both endpoints respond (not 404), server doesn't crash
    Failure Indicators: 404 on either endpoint, server crash on startup, import errors
    Evidence: .sisyphus/evidence/task-3-routes-mounted.txt
  ```

  **Commit**: YES
  - Message: `feat(api): mount backup/restore routes`
  - Files: `src/api/index.ts`
  - Pre-commit: `bun run dev` (verify startup)

---

- [x] 4. Automated Tests

  **What to do**:
  - Create `test/api/backup-restore.test.ts`
  - Test cases:
    1. **Backup all**: GET /api/backup → valid JSON structure, all fields present
    2. **Backup filtered**: GET /api/backup?provider=kiro → only kiro accounts
    3. **Backup invalid provider**: GET /api/backup?provider=fake → 400
    4. **Backup empty provider**: GET /api/backup?provider=kiro (no kiro accounts) → empty array, total=0
    5. **Restore valid (skip)**: POST /api/restore → imports new, skips existing
    6. **Restore valid (overwrite)**: POST /api/restore?strategy=overwrite → updates existing
    7. **Restore invalid JSON**: POST /api/restore with bad body → 400
    8. **Restore missing version**: POST /api/restore without version → 400
    9. **Restore key mismatch**: POST /api/restore with wrong fingerprint → warning flag
    10. **Round-trip**: Backup → Restore on clean DB → verify data matches
  - Use test DB (in-memory or temp file) to avoid touching production data
  - Follow existing test patterns from `test/proxy/*.test.ts`

  **Must NOT do**:
  - Do NOT test against production DB
  - Do NOT modify existing test files
  - Do NOT add test dependencies

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: None (final task)
  - **Blocked By**: Task 3

  **References**:

  **Pattern References**:
  - `test/proxy/routing.test.ts` — Test file structure, describe/it pattern, assertions
  - `test/proxy/byok-provider.test.ts` — Test setup with mock data

  **External References**:
  - Bun test docs: `describe`, `it`, `expect`, `beforeAll`, `afterAll`

  **WHY Each Reference Matters**:
  - `routing.test.ts`: Follow same test structure and assertion style
  - `byok-provider.test.ts`: See how mock account data is set up

  **Acceptance Criteria**:
  - [ ] Test file exists: `test/api/backup-restore.test.ts`
  - [ ] `bun test test/api/backup-restore.test.ts` → ALL PASS
  - [ ] Covers: backup all, backup filtered, backup invalid, restore skip, restore overwrite, restore invalid, round-trip

  **QA Scenarios**:

  ```
  Scenario: All tests pass
    Tool: Bash
    Preconditions: All implementation complete, server code compiles
    Steps:
      1. Run: bun test test/api/backup-restore.test.ts
      2. Assert exit code 0
      3. Assert output shows all tests passing (0 failures)
    Expected Result: All 10 test cases pass, 0 failures
    Failure Indicators: Non-zero exit code, any test failure, compilation error
    Evidence: .sisyphus/evidence/task-4-test-results.txt
  ```

  **Commit**: YES
  - Message: `test(api): add backup/restore endpoint tests`
  - Files: `test/api/backup-restore.test.ts`
  - Pre-commit: `bun test test/api/backup-restore.test.ts`

---

## Final Verification Wave

> After ALL implementation tasks, run these 4 reviews in PARALLEL. ALL must APPROVE.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `bun test`. Review `src/api/backup.ts` for: type safety, error handling, no `as any`, no empty catches, proper imports. Check no console.log in prod code.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real QA** — `unspecified-high`
  Start server. Execute ALL QA scenarios from Tasks 1-4. Capture evidence. Test edge cases: empty DB backup, restore 0 accounts, very large payload.
  Output: `Scenarios [N/N pass] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual code. Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Order | Message | Files | Pre-commit |
|-------|---------|-------|------------|
| 1 | `feat(api): add backup endpoint for account credentials export` | `src/api/backup.ts` | syntax check |
| 2 | `feat(api): add restore endpoint with skip/overwrite strategy` | `src/api/backup.ts` | syntax check |
| 3 | `feat(api): mount backup/restore routes` | `src/api/index.ts` | `bun run dev` |
| 4 | `test(api): add backup/restore endpoint tests` | `test/api/backup-restore.test.ts` | `bun test` |

Or squash into single commit: `feat(api): add backup/restore endpoints for account credentials`

---

## Success Criteria

### Verification Commands
```bash
# Server starts
bun run dev  # Expected: no crash, listening on :1931

# Backup works
curl -s http://localhost:1931/api/backup | jq .version  # Expected: 1
curl -s "http://localhost:1931/api/backup?provider=kiro" | jq .provider  # Expected: "kiro"

# Restore works
curl -s http://localhost:1931/api/backup > /tmp/test-backup.json
curl -s -X POST -H "Content-Type: application/json" -d @/tmp/test-backup.json http://localhost:1931/api/restore | jq .success  # Expected: true

# Tests pass
bun test test/api/backup-restore.test.ts  # Expected: all pass
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Server starts without errors
- [ ] Round-trip backup→restore works

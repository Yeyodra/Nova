# Dashboard Password Authentication — Separate from API Key

## TL;DR

> **Quick Summary**: Separate dashboard login (password-based + JWT session) from proxy authentication (API key stays as-is). Add first-time setup flow and env-var-based password reset.
> 
> **Deliverables**:
> - Backend auth endpoints (`/api/dashboard-auth/*`) for setup, login, status
> - JWT middleware for `/api/*` routes (replacing API key auth for dashboard)
> - Frontend Setup page (first-time password creation)
> - Frontend Login page (password input, replaces API key input)
> - Password reset mechanism via `RESET_PASSWORD=true` env var
> - API key remains unchanged for proxy (`/v1/*`)
> 
> **Estimated Effort**: Medium (8-12 tasks, ~4-6 hours execution)
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 (backend auth module) → Task 4 (middleware split) → Task 7 (frontend login)

---

## Context

### Original Request
User wants to separate authentication: API key for proxy clients (`/v1/*`) and a dedicated password for dashboard login. Currently both use the same API key, which is a security concern — anyone with the proxy key can access the admin dashboard.

### Interview Summary
**Key Discussions**:
- **User model**: Single admin only — no multi-user, no roles
- **Initial setup**: Force redirect to setup page on first visit (no password exists)
- **Session**: JWT token, 7-day expiry, stored in localStorage
- **Password reset**: Set `RESET_PASSWORD=true` in .env, restart server → clears hash, forces setup
- **Hashing**: `Bun.password` (built-in argon2id, zero dependencies)
- **JWT**: `hono/jwt` helper (built-in, zero dependencies)
- **Rate limiting**: Not needed (self-hosted, trusted network)
- **Tests**: No automated tests — QA scenarios only

**Research Findings**:
- **Route collision**: `/api/auth` is ALREADY used by provider login system (login Claude/GPT accounts). New endpoints must use different namespace → `/api/dashboard-auth/*`
- **Settings table**: Simple key-value store, perfect for storing password hash and JWT secret
- **No existing auth infra**: No bcrypt, no JWT, no sessions — building from scratch
- **Frontend**: React SPA with `api.ts` handling all auth logic centrally

### Metis Review
**Identified Gaps** (addressed):
- **Route collision**: `/api/auth` taken → using `/api/dashboard-auth/*` namespace
- **JWT secret storage**: Auto-generate on first boot, store in `settings` table
- **JWT invalidation on reset**: Rotate JWT secret when password is reset (invalidates all tokens)
- **API Key page**: Stays in dashboard (manages proxy key), protected by new password auth
- **Startup check**: Server checks `RESET_PASSWORD` env var on boot, clears hash + rotates JWT secret if set

---

## Work Objectives

### Core Objective
Replace API-key-based dashboard authentication with password-based login + JWT sessions, while keeping API key authentication intact for proxy routes.

### Concrete Deliverables
- `src/api/dashboard-auth.ts` — New auth endpoints (setup, login, status)
- `src/middleware/jwt-auth.ts` — JWT validation middleware for dashboard API
- `src/utils/jwt.ts` — JWT sign/verify helpers using hono/jwt
- Modified `src/index.ts` — Split middleware: API key for `/v1/*`, JWT for `/api/*`
- `dashboard/src/pages/Setup.tsx` — New setup page (first-time password creation)
- Modified `dashboard/src/pages/Login.tsx` — Password input instead of API key
- Modified `dashboard/src/lib/api.ts` — JWT-based auth flow
- Modified `dashboard/src/App.tsx` — Route for setup page + auth state logic

### Definition of Done
- [ ] Dashboard login requires password (not API key)
- [ ] Proxy requests (`/v1/*`) still work with API key only
- [ ] First-time visit redirects to setup page
- [ ] After setup, login with password returns JWT
- [ ] JWT expires after 7 days, forces re-login
- [ ] `RESET_PASSWORD=true` + restart clears password and forces setup again
- [ ] Existing API Key management page still accessible (behind password auth)

### Must Have
- Password hashed with argon2id via `Bun.password`
- JWT signed with auto-generated secret stored in DB
- Setup page only accessible when no password exists
- Login page only accessible when password exists but not authenticated
- All `/api/*` routes (except dashboard-auth) require valid JWT
- All `/v1/*` routes still require valid API key (unchanged)
- Password reset rotates JWT secret (invalidates all sessions)

### Must NOT Have (Guardrails)
- ❌ Multi-user support or user table
- ❌ Email-based password reset
- ❌ OAuth/social login
- ❌ 2FA/MFA
- ❌ Rate limiting on login
- ❌ Changes to API key generation/validation logic
- ❌ Changes to proxy routing logic
- ❌ Password strength requirements (user decides their own password)
- ❌ "Remember me" checkbox (7-day expiry is sufficient)
- ❌ Touching the existing `/api/auth` router (provider login system)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None
- **Framework**: N/A
- **QA Method**: Agent-executed curl commands + Playwright for frontend

### QA Policy
Every task includes agent-executed QA scenarios verified via:
- **Backend**: `curl` commands against running server
- **Frontend**: Playwright browser automation
- **Integration**: Full flow (setup → login → access → logout → re-login)
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — all independent, start immediately):
├── Task 1: Backend auth module (endpoints + password logic) [unspecified-high]
├── Task 2: JWT utilities (sign/verify/secret management) [quick]
├── Task 3: Frontend Setup page component [quick]
└── Task 4: Frontend Login page (password version) [quick]

Wave 2 (Integration — depends on Wave 1):
├── Task 5: Split auth middleware (JWT for /api/*, API key for /v1/*) [unspecified-high]
├── Task 6: Frontend api.ts rewrite (JWT auth flow) [unspecified-high]
└── Task 7: Password reset mechanism (env var check on startup) [quick]

Wave 3 (Wiring + Polish):
├── Task 8: Frontend App.tsx routing (setup vs login vs authenticated) [unspecified-high]
└── Task 9: Integration testing — full flow QA [unspecified-high]

Wave FINAL (4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
→ Present results → Get explicit user okay
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 5, 7, 9 | 1 |
| 2 | — | 5, 7 | 1 |
| 3 | — | 8 | 1 |
| 4 | — | 8 | 1 |
| 5 | 1, 2 | 8, 9 | 2 |
| 6 | — (can use JWT spec from T2) | 8, 9 | 2 |
| 7 | 1, 2 | 9 | 2 |
| 8 | 3, 4, 5, 6 | 9 | 3 |
| 9 | ALL | F1-F4 | 3 |

### Agent Dispatch Summary

- **Wave 1**: 4 tasks — T1 → `unspecified-high`, T2 → `quick`, T3 → `quick`, T4 → `quick`
- **Wave 2**: 3 tasks — T5 → `unspecified-high`, T6 → `unspecified-high`, T7 → `quick`
- **Wave 3**: 2 tasks — T8 → `unspecified-high`, T9 → `unspecified-high`
- **FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Backend Auth Module — Dashboard Auth Endpoints

  **What to do**:
  - Create `src/api/dashboard-auth.ts` with a Hono router
  - Implement `GET /api/dashboard-auth/status` — returns `{ setup: boolean, authenticated: boolean }`
    - Check if `admin_password_hash` exists in `settings` table
  - Implement `POST /api/dashboard-auth/setup` — accepts `{ password: string }`
    - ONLY works if no password hash exists yet
    - Hash password with `Bun.password.hash(password, { algorithm: "argon2id" })`
    - Store hash in `settings` table (key=`admin_password_hash`)
    - Also generate JWT secret if not exists (see Task 2 spec)
    - Return `{ success: true }`
  - Implement `POST /api/dashboard-auth/login` — accepts `{ password: string }`
    - Verify with `Bun.password.verify(password, storedHash)`
    - If valid: sign JWT with 7-day expiry, return `{ token: "eyJ..." }`
    - If invalid: return 401 `{ error: "Invalid password" }`
  - Register router in `src/api/index.ts`

  **Must NOT do**:
  - Do NOT touch existing `/api/auth` router (that's for provider logins)
  - Do NOT add rate limiting
  - Do NOT add password strength validation
  - Do NOT create a users table

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Core backend logic with crypto operations, needs careful implementation
  - **Skills**: []
    - No special skills needed — standard Hono + Bun APIs

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 5, 7, 9
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/api/keys.ts` — Follow this pattern for Hono router structure, settings table access, and response format
  - `src/api/index.ts` — Where to register the new router (follow existing `.route()` pattern)
  - `src/db/schema.ts:3-10` — `settings` table schema (key/value/updatedAt)

  **API/Type References**:
  - `src/db/index.ts` — Database instance export (`db`) and how to query settings table
  - `src/api/keys.ts:getActiveApiKey()` — Pattern for reading from settings table with Drizzle

  **External References**:
  - Bun.password docs: https://bun.sh/docs/api/hashing — `Bun.password.hash()` and `Bun.password.verify()`
  - Hono router: https://hono.dev/docs/api/routing — Router creation pattern

  **WHY Each Reference Matters**:
  - `keys.ts` shows the exact Drizzle query pattern for settings table (eq filter, insert/update)
  - `api/index.ts` shows how routers are mounted (`.route("/path", router)`)
  - The settings table is a simple key-value store — password hash goes as `key="admin_password_hash"`

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Status check — no password set (fresh install)
    Tool: Bash (curl)
    Preconditions: Database has no "admin_password_hash" in settings table
    Steps:
      1. curl -s http://localhost:1930/api/dashboard-auth/status
      2. Parse JSON response
    Expected Result: {"setup": false}
    Failure Indicators: 404, 500, or {"setup": true} when no hash exists
    Evidence: .sisyphus/evidence/task-1-status-fresh.json

  Scenario: Setup password — first time
    Tool: Bash (curl)
    Preconditions: No password hash exists
    Steps:
      1. curl -s -X POST http://localhost:1930/api/dashboard-auth/setup -H "Content-Type: application/json" -d '{"password":"MySecurePass123"}'
      2. Verify response is {"success": true}
      3. curl -s http://localhost:1930/api/dashboard-auth/status
      4. Verify response is {"setup": true}
    Expected Result: Password stored, status now shows setup=true
    Failure Indicators: 500 error, password stored in plaintext, status still false
    Evidence: .sisyphus/evidence/task-1-setup-success.json

  Scenario: Setup password — already exists (should fail)
    Tool: Bash (curl)
    Preconditions: Password hash already exists in settings
    Steps:
      1. curl -s -X POST http://localhost:1930/api/dashboard-auth/setup -H "Content-Type: application/json" -d '{"password":"NewPass"}'
    Expected Result: 400 or 409 with error message like {"error": "Password already set"}
    Failure Indicators: 200 success (overwrites existing password)
    Evidence: .sisyphus/evidence/task-1-setup-duplicate.json

  Scenario: Login — correct password
    Tool: Bash (curl)
    Preconditions: Password "MySecurePass123" has been set up
    Steps:
      1. curl -s -X POST http://localhost:1930/api/dashboard-auth/login -H "Content-Type: application/json" -d '{"password":"MySecurePass123"}'
      2. Parse response, extract token field
      3. Verify token is a valid JWT format (3 dot-separated base64 segments)
    Expected Result: {"token": "eyJ..."} with 200 status
    Failure Indicators: 401, 500, or token missing from response
    Evidence: .sisyphus/evidence/task-1-login-success.json

  Scenario: Login — wrong password
    Tool: Bash (curl)
    Preconditions: Password has been set up
    Steps:
      1. curl -s -X POST http://localhost:1930/api/dashboard-auth/login -H "Content-Type: application/json" -d '{"password":"WrongPassword"}'
    Expected Result: 401 with {"error": "Invalid password"}
    Failure Indicators: 200 with token (auth bypass!)
    Evidence: .sisyphus/evidence/task-1-login-fail.json
  ```

  **Commit**: YES (groups with T2)
  - Message: `feat(auth): add password auth module and JWT utilities`
  - Files: `src/api/dashboard-auth.ts`, `src/api/index.ts`
  - Pre-commit: `bunx tsc --noEmit`

- [x] 2. JWT Utilities — Sign/Verify/Secret Management

  **What to do**:
  - Create `src/utils/jwt.ts`
  - Implement `getJwtSecret()` — reads from settings table (key=`jwt_secret`), generates random 64-char hex if not exists, stores it
  - Implement `signDashboardToken()` — signs JWT with payload `{ type: "dashboard", iat, exp }` (7-day expiry)
  - Implement `verifyDashboardToken(token)` — verifies signature + expiry, returns payload or throws
  - Implement `rotateJwtSecret()` — generates new secret, stores in settings (invalidates all tokens)
  - Use `hono/jwt` or native `crypto.subtle` for JWT operations (prefer hono/jwt for consistency)

  **Must NOT do**:
  - Do NOT use external JWT libraries (jose, jsonwebtoken) — use hono/jwt or Web Crypto API
  - Do NOT store secret in env var (it's auto-generated and stored in DB)
  - Do NOT add refresh token logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small utility module, well-defined interface, straightforward crypto operations
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Tasks 5, 7
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/utils/crypto.ts` — Existing utility module pattern (export functions, no class)
  - `src/api/keys.ts:getActiveApiKey()` — Pattern for reading/writing settings table

  **API/Type References**:
  - `src/db/schema.ts` — settings table schema
  - `src/db/index.ts` — db instance

  **External References**:
  - Hono JWT helper: https://hono.dev/docs/helpers/jwt — `sign()`, `verify()` functions
  - Web Crypto: `crypto.getRandomValues()` for secret generation

  **WHY Each Reference Matters**:
  - `crypto.ts` shows the module structure pattern (named exports, no default)
  - `keys.ts:getActiveApiKey()` shows exact Drizzle pattern for settings read/write with upsert

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: JWT secret auto-generation
    Tool: Bash (bun repl)
    Preconditions: No jwt_secret in settings table
    Steps:
      1. Import getJwtSecret from src/utils/jwt.ts
      2. Call getJwtSecret()
      3. Verify it returns a 64-char hex string
      4. Call getJwtSecret() again
      5. Verify same value returned (not regenerated)
    Expected Result: Consistent 64-char hex secret, persisted to DB
    Failure Indicators: Different value on second call, empty string, or error
    Evidence: .sisyphus/evidence/task-2-secret-gen.txt

  Scenario: Sign and verify JWT round-trip
    Tool: Bash (bun repl)
    Preconditions: JWT secret exists
    Steps:
      1. Call signDashboardToken()
      2. Verify returned string has 3 dot-separated parts
      3. Call verifyDashboardToken(token)
      4. Verify payload has type="dashboard", iat, exp fields
      5. Verify exp - iat = 7 days (604800 seconds)
    Expected Result: Valid JWT with correct payload and 7-day expiry
    Failure Indicators: Verification fails, wrong expiry, missing fields
    Evidence: .sisyphus/evidence/task-2-jwt-roundtrip.txt

  Scenario: Rotate secret invalidates old tokens
    Tool: Bash (bun repl)
    Preconditions: JWT secret exists, token signed with old secret
    Steps:
      1. Sign a token with current secret
      2. Call rotateJwtSecret()
      3. Try to verify the old token
    Expected Result: Verification throws/returns null (old token invalid)
    Failure Indicators: Old token still verifies after rotation
    Evidence: .sisyphus/evidence/task-2-rotation.txt
  ```

  **Commit**: YES (groups with T1)
  - Message: `feat(auth): add password auth module and JWT utilities`
  - Files: `src/utils/jwt.ts`
  - Pre-commit: `bunx tsc --noEmit`

- [x] 3. Frontend Setup Page Component

  **What to do**:
  - Create `dashboard/src/pages/Setup.tsx`
  - UI: Centered card with title "Set Up Dashboard Password", password input, confirm password input, submit button
  - On submit: POST to `/api/dashboard-auth/setup` with `{ password }`
  - Validate: password and confirm match (client-side only)
  - On success: redirect to login page (or auto-login and redirect to dashboard)
  - Style: Match existing dashboard design (use same Tailwind classes as Login.tsx)
  - Show error toast/message if setup fails

  **Must NOT do**:
  - Do NOT add password strength meter
  - Do NOT add password requirements text
  - Do NOT add "show password" toggle (unless Login.tsx already has one — match it)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple React form component, follows existing Login.tsx pattern closely
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Task 8
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `dashboard/src/pages/Login.tsx` — **PRIMARY REFERENCE** — Copy this component's structure, styling, form handling pattern. Replace API key input with password + confirm password inputs.

  **API/Type References**:
  - `dashboard/src/lib/api.ts` — `fetchApi()` function for making POST request

  **External References**: None needed — follow existing patterns

  **WHY Each Reference Matters**:
  - `Login.tsx` is the EXACT template to follow — same card layout, same form structure, same error handling. Just different fields.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Setup page renders correctly
    Tool: Playwright
    Preconditions: No password set (fresh state), dev server running
    Steps:
      1. Navigate to /setup
      2. Assert page title contains "Set Up" or "Setup"
      3. Assert password input field exists (type="password")
      4. Assert confirm password input field exists
      5. Assert submit button exists
    Expected Result: All form elements visible and interactive
    Failure Indicators: 404, blank page, missing inputs
    Evidence: .sisyphus/evidence/task-3-setup-render.png

  Scenario: Password mismatch shows error
    Tool: Playwright
    Preconditions: Setup page loaded
    Steps:
      1. Type "password1" in password field
      2. Type "password2" in confirm field
      3. Click submit
    Expected Result: Client-side error message "Passwords do not match" (no API call made)
    Failure Indicators: API call made with mismatched passwords, no error shown
    Evidence: .sisyphus/evidence/task-3-mismatch-error.png
  ```

  **Commit**: YES (groups with T4, T6, T8)
  - Message: `feat(dashboard): password login UI and JWT auth flow`
  - Files: `dashboard/src/pages/Setup.tsx`

- [x] 4. Frontend Login Page — Password Version

  **What to do**:
  - Modify `dashboard/src/pages/Login.tsx`
  - Replace API key input with password input (type="password")
  - Change form submission: POST to `/api/dashboard-auth/login` with `{ password }`
  - On success: store JWT token in localStorage (key: `dashboard_token`), redirect to dashboard
  - On failure: show "Invalid password" error message
  - Update page title/heading from "Enter API Key" to "Dashboard Login" or similar
  - Remove any reference to API key in the login flow

  **Must NOT do**:
  - Do NOT remove the API key from localStorage entirely (it may still be used for the ApiKey management page display)
  - Do NOT add "forgot password" link (reset is via env var)
  - Do NOT add username field (single admin)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Modifying existing component, straightforward field swap
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Task 8
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `dashboard/src/pages/Login.tsx` — **THE file being modified** — understand current structure before changing

  **API/Type References**:
  - `dashboard/src/lib/api.ts:validateApiKey()` — Current auth function to be replaced
  - `dashboard/src/lib/api.ts:fetchApi()` — HTTP client to use for login POST

  **WHY Each Reference Matters**:
  - Must read current Login.tsx to understand what to keep (layout, error handling) vs what to replace (API key logic)

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Login page shows password field (not API key)
    Tool: Playwright
    Preconditions: Password has been set up, dev server running
    Steps:
      1. Navigate to /login
      2. Assert input[type="password"] exists
      3. Assert NO input with placeholder containing "API" or "key" exists
      4. Assert submit button exists
    Expected Result: Password input visible, no API key references
    Failure Indicators: API key input still present, password field missing
    Evidence: .sisyphus/evidence/task-4-login-render.png

  Scenario: Login with correct password
    Tool: Playwright
    Preconditions: Password "TestPass123" set up
    Steps:
      1. Navigate to /login
      2. Type "TestPass123" in password field
      3. Click submit/login button
      4. Wait for navigation to dashboard (/)
      5. Assert localStorage has "dashboard_token" key
    Expected Result: Redirected to dashboard, JWT stored
    Failure Indicators: Stays on login page, no token stored, error shown
    Evidence: .sisyphus/evidence/task-4-login-success.png

  Scenario: Login with wrong password shows error
    Tool: Playwright
    Preconditions: Password set up
    Steps:
      1. Navigate to /login
      2. Type "WrongPassword" in password field
      3. Click submit
      4. Assert error message visible on page
    Expected Result: Error message like "Invalid password" shown, stays on login page
    Failure Indicators: Redirected to dashboard, no error shown
    Evidence: .sisyphus/evidence/task-4-login-fail.png
  ```

  **Commit**: YES (groups with T3, T6, T8)
  - Message: `feat(dashboard): password login UI and JWT auth flow`
  - Files: `dashboard/src/pages/Login.tsx`

- [x] 5. Split Auth Middleware — JWT for Dashboard, API Key for Proxy

  **What to do**:
  - Modify `src/index.ts` auth middleware section (lines 80-122)
  - **Keep** `/v1/*` middleware unchanged — still validates API key via `isValidApiKey()`
  - **Replace** `/api/*` middleware — validate JWT token instead of API key
    - Extract Bearer token from Authorization header
    - Call `verifyDashboardToken(token)` from `src/utils/jwt.ts`
    - If valid: set user context and proceed
    - If invalid/expired: return 401
  - **Exempt routes** (no auth required):
    - `/api/dashboard-auth/status` (GET)
    - `/api/dashboard-auth/setup` (POST)
    - `/api/dashboard-auth/login` (POST)
    - `/api/health` (keep existing exemption)
    - `/api/info` (keep existing exemption)
  - Remove API key validation from `/api/*` routes entirely

  **Must NOT do**:
  - Do NOT change `/v1/*` middleware at all
  - Do NOT change the existing exempt routes logic (just add new exemptions)
  - Do NOT touch `src/api/keys.ts` validation logic (still used by proxy)
  - Do NOT remove `isValidApiKey()` function (proxy still needs it)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Critical middleware change — must be precise to avoid breaking proxy or dashboard
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 2)
  - **Parallel Group**: Wave 2 (with Tasks 6, 7)
  - **Blocks**: Tasks 8, 9
  - **Blocked By**: Tasks 1, 2

  **References**:

  **Pattern References**:
  - `src/index.ts:80-122` — **THE code being modified** — current auth middleware for both /v1/* and /api/*

  **API/Type References**:
  - `src/utils/jwt.ts:verifyDashboardToken()` — JWT verification function (from Task 2)
  - `src/api/keys.ts:isValidApiKey()` — Keep this for /v1/* only

  **WHY Each Reference Matters**:
  - Must understand current middleware structure to split it correctly without breaking proxy
  - The exempt routes pattern already exists — extend it, don't rewrite

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Proxy still works with API key
    Tool: Bash (curl)
    Preconditions: Server running, API key known
    Steps:
      1. curl -s -o /dev/null -w "%{http_code}" http://localhost:1930/v1/models -H "Authorization: Bearer sk-pool-..."
    Expected Result: 200 (not 401)
    Failure Indicators: 401 or 403 (proxy auth broken)
    Evidence: .sisyphus/evidence/task-5-proxy-apikey.txt

  Scenario: Dashboard API rejects API key (requires JWT now)
    Tool: Bash (curl)
    Preconditions: Server running
    Steps:
      1. curl -s -o /dev/null -w "%{http_code}" http://localhost:1930/api/accounts -H "Authorization: Bearer sk-pool-..."
    Expected Result: 401 (API key no longer valid for dashboard)
    Failure Indicators: 200 (still accepting API key for dashboard)
    Evidence: .sisyphus/evidence/task-5-dashboard-rejects-apikey.txt

  Scenario: Dashboard API accepts valid JWT
    Tool: Bash (curl)
    Preconditions: Login and get JWT token first
    Steps:
      1. Login: curl -s POST /api/dashboard-auth/login → get token
      2. curl -s -o /dev/null -w "%{http_code}" http://localhost:1930/api/accounts -H "Authorization: Bearer <jwt_token>"
    Expected Result: 200
    Failure Indicators: 401 (JWT not accepted)
    Evidence: .sisyphus/evidence/task-5-dashboard-jwt.txt

  Scenario: Auth-exempt routes work without any token
    Tool: Bash (curl)
    Preconditions: Server running
    Steps:
      1. curl -s -o /dev/null -w "%{http_code}" http://localhost:1930/api/dashboard-auth/status
      2. curl -s -o /dev/null -w "%{http_code}" http://localhost:1930/api/dashboard-auth/login (POST with body)
    Expected Result: Both return 200 (not 401)
    Failure Indicators: 401 on exempt routes
    Evidence: .sisyphus/evidence/task-5-exempt-routes.txt
  ```

  **Commit**: YES (groups with T7)
  - Message: `feat(auth): split middleware and add password reset`
  - Files: `src/index.ts`
  - Pre-commit: `bunx tsc --noEmit`

- [x] 6. Frontend api.ts Rewrite — JWT Auth Flow

  **What to do**:
  - Modify `dashboard/src/lib/api.ts`
  - Replace `validateApiKey()` with `loginWithPassword(password: string): Promise<{ token: string }>`
    - POST to `/api/dashboard-auth/login`
    - Store token in localStorage as `dashboard_token`
  - Replace `getApiKey()` with `getToken(): string | null`
    - Read from `localStorage.getItem("dashboard_token")`
  - Replace `isAuthenticated()` logic:
    - Check if `dashboard_token` exists in localStorage
    - Optionally: decode JWT and check if expired (client-side check for UX)
  - Update `fetchApi()`:
    - Use `dashboard_token` for Authorization header instead of `api_key`
  - Update `logout()`:
    - Remove `dashboard_token` from localStorage
  - Add `checkSetupStatus(): Promise<{ setup: boolean }>`
    - GET `/api/dashboard-auth/status`
  - Keep `API_BASE` resolution logic unchanged

  **Must NOT do**:
  - Do NOT remove API_BASE logic
  - Do NOT change the fetchApi response handling pattern
  - Do NOT add token refresh logic

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Central API client rewrite — all dashboard pages depend on this
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 2)
  - **Parallel Group**: Wave 2 (with Tasks 5, 7)
  - **Blocks**: Tasks 8, 9
  - **Blocked By**: None (can code against spec from T2)

  **References**:

  **Pattern References**:
  - `dashboard/src/lib/api.ts` — **THE file being modified** — understand current exports and consumers

  **API/Type References**:
  - `dashboard/src/App.tsx` — Consumes `isAuthenticated()` — must keep same interface or update
  - `dashboard/src/pages/Login.tsx` — Consumes `validateApiKey()` — will be updated in T4
  - `dashboard/src/components/layout/Layout.tsx` — Consumes `logout()` — keep same interface

  **WHY Each Reference Matters**:
  - `api.ts` is imported by EVERY page — changes here affect the entire dashboard
  - Must maintain backward-compatible exports where possible, or update all consumers

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: fetchApi sends JWT token in header
    Tool: Bash (curl equivalent — verify via network tab or server logs)
    Preconditions: Token stored in localStorage
    Steps:
      1. Call fetchApi("/api/accounts") from browser console
      2. Inspect network request headers
    Expected Result: Authorization: Bearer eyJ... (JWT, not API key)
    Failure Indicators: Authorization header contains sk-pool-* or is missing
    Evidence: .sisyphus/evidence/task-6-fetchapi-header.txt

  Scenario: isAuthenticated returns false when no token
    Tool: Playwright
    Preconditions: localStorage cleared
    Steps:
      1. Clear localStorage
      2. Check isAuthenticated() returns false
      3. App redirects to login
    Expected Result: Unauthenticated state detected, redirect to login
    Failure Indicators: Dashboard loads without token
    Evidence: .sisyphus/evidence/task-6-unauth-redirect.png
  ```

  **Commit**: YES (groups with T3, T4, T8)
  - Message: `feat(dashboard): password login UI and JWT auth flow`
  - Files: `dashboard/src/lib/api.ts`

- [x] 7. Password Reset Mechanism — Env Var Check on Startup

  **What to do**:
  - Modify server startup logic (in `src/index.ts` or `scripts/start.ts`)
  - On server boot, check `process.env.RESET_PASSWORD`
  - If `RESET_PASSWORD === "true"`:
    - Delete `admin_password_hash` from settings table
    - Call `rotateJwtSecret()` (invalidates all existing sessions)
    - Log: "⚠️ Password has been reset. Visit dashboard to set new password."
    - Continue server startup normally (don't exit)
  - User then visits dashboard → sees setup page (no password exists)
  - Document in `.env.example`: `# RESET_PASSWORD=true  # Set to true and restart to reset dashboard password`

  **Must NOT do**:
  - Do NOT auto-remove the env var (user must manually remove it after reset)
  - Do NOT exit the process after reset
  - Do NOT add CLI command (user chose env var approach only)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple startup check — read env, delete row, log message
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 2)
  - **Parallel Group**: Wave 2 (with Tasks 5, 6)
  - **Blocks**: Task 9
  - **Blocked By**: Tasks 1, 2

  **References**:

  **Pattern References**:
  - `scripts/start.ts` — Server startup script (where to add the check)
  - `src/index.ts` — Alternative location if startup logic is here
  - `src/config.ts` — How env vars are currently read

  **API/Type References**:
  - `src/utils/jwt.ts:rotateJwtSecret()` — From Task 2
  - `src/db/schema.ts` — settings table for deletion

  **External References**:
  - `.env.example` — Add documentation comment for RESET_PASSWORD

  **WHY Each Reference Matters**:
  - Need to find the RIGHT place to add startup logic (before server.listen)
  - `rotateJwtSecret()` ensures old sessions are invalidated on reset

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Reset password via env var
    Tool: Bash
    Preconditions: Password "OldPass" is set, server running
    Steps:
      1. Stop server
      2. Set RESET_PASSWORD=true in environment
      3. Start server
      4. Check logs for reset confirmation message
      5. curl -s http://localhost:1930/api/dashboard-auth/status
    Expected Result: Status returns {"setup": false} — password cleared
    Failure Indicators: Status still shows setup=true, no log message
    Evidence: .sisyphus/evidence/task-7-reset-env.txt

  Scenario: Old JWT invalid after reset
    Tool: Bash (curl)
    Preconditions: Had valid JWT before reset
    Steps:
      1. Save current JWT token
      2. Trigger reset (RESET_PASSWORD=true + restart)
      3. Try to use old JWT: curl /api/accounts with old token
    Expected Result: 401 (token invalid — secret was rotated)
    Failure Indicators: 200 (old token still works after reset)
    Evidence: .sisyphus/evidence/task-7-token-invalidated.txt
  ```

  **Commit**: YES (groups with T5)
  - Message: `feat(auth): split middleware and add password reset`
  - Files: `scripts/start.ts` (or `src/index.ts`), `.env.example`

- [x] 8. Frontend App.tsx — Routing Logic (Setup vs Login vs Authenticated)

  **What to do**:
  - Modify `dashboard/src/App.tsx`
  - Add new route: `/setup` → `<Setup />` component
  - Implement auth state machine:
    1. On app load: call `checkSetupStatus()` from api.ts
    2. If `setup === false` → redirect to `/setup` (no password exists)
    3. If `setup === true` AND not authenticated → show `/login`
    4. If `setup === true` AND authenticated → show dashboard routes
  - Import and lazy-load Setup page
  - Handle loading state while checking status (show spinner/skeleton)
  - Handle edge case: token expired → redirect to login (not setup)

  **Must NOT do**:
  - Do NOT change existing route paths (/, /accounts, /logs, etc.)
  - Do NOT remove any existing pages/routes
  - Do NOT add complex state management (keep it simple with useState/useEffect)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Central routing logic — must handle all auth states correctly
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 9
  - **Blocked By**: Tasks 3, 4, 5, 6

  **References**:

  **Pattern References**:
  - `dashboard/src/App.tsx` — **THE file being modified** — current auth guard and route structure

  **API/Type References**:
  - `dashboard/src/lib/api.ts:checkSetupStatus()` — From Task 6
  - `dashboard/src/lib/api.ts:isAuthenticated()` — Updated in Task 6
  - `dashboard/src/pages/Setup.tsx` — From Task 3
  - `dashboard/src/pages/Login.tsx` — Modified in Task 4

  **WHY Each Reference Matters**:
  - App.tsx is the root — must understand current auth guard pattern to extend it with setup state

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Fresh install → redirects to setup
    Tool: Playwright
    Preconditions: No password in DB, dev server running
    Steps:
      1. Navigate to http://localhost:1731/
      2. Wait for redirect
      3. Assert URL is /setup
      4. Assert setup form is visible
    Expected Result: Automatic redirect to /setup
    Failure Indicators: Shows login page, shows dashboard, blank page
    Evidence: .sisyphus/evidence/task-8-fresh-redirect.png

  Scenario: Password set, not logged in → shows login
    Tool: Playwright
    Preconditions: Password exists, no token in localStorage
    Steps:
      1. Clear localStorage
      2. Navigate to /
      3. Wait for redirect
      4. Assert URL is /login
    Expected Result: Redirected to login page
    Failure Indicators: Shows setup page, shows dashboard
    Evidence: .sisyphus/evidence/task-8-login-redirect.png

  Scenario: Authenticated → shows dashboard
    Tool: Playwright
    Preconditions: Password set, valid JWT in localStorage
    Steps:
      1. Set valid dashboard_token in localStorage
      2. Navigate to /
      3. Assert dashboard content loads (stats cards, sidebar)
    Expected Result: Dashboard renders with full content
    Failure Indicators: Redirected to login/setup, blank page
    Evidence: .sisyphus/evidence/task-8-authenticated.png

  Scenario: Setup page inaccessible after password set
    Tool: Playwright
    Preconditions: Password already set
    Steps:
      1. Navigate directly to /setup
      2. Assert redirect to /login (or /)
    Expected Result: Cannot access setup when password exists
    Failure Indicators: Setup form shown (could allow password overwrite)
    Evidence: .sisyphus/evidence/task-8-setup-blocked.png
  ```

  **Commit**: YES (groups with T3, T4, T6)
  - Message: `feat(dashboard): password login UI and JWT auth flow`
  - Files: `dashboard/src/App.tsx`

- [x] 9. Integration Testing — Full Flow QA

  **What to do**:
  - Run the COMPLETE flow end-to-end to verify all pieces work together
  - Test sequence:
    1. Fresh state: no password → dashboard redirects to setup
    2. Setup: create password → success → redirect to login
    3. Login: enter password → get JWT → redirect to dashboard
    4. Dashboard: all pages load, API calls work with JWT
    5. Logout: token cleared → redirect to login
    6. Re-login: password still works
    7. Proxy: API key still works for /v1/* endpoints
    8. Cross-auth: JWT rejected on proxy, API key rejected on dashboard
    9. Reset: RESET_PASSWORD=true → restart → setup page again
    10. New password: set different password → login works
  - Capture evidence for each step
  - Report any failures with exact reproduction steps

  **Must NOT do**:
  - Do NOT fix bugs found (report them — they'll be fixed in a follow-up)
  - Do NOT modify any source code

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Comprehensive integration testing requiring careful sequential verification
  - **Skills**: [`playwright`]
    - `playwright`: Needed for browser-based UI testing of the full flow

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Task 8)
  - **Blocks**: F1-F4
  - **Blocked By**: ALL previous tasks (1-8)

  **References**:

  **Pattern References**: All previous task outputs

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Complete happy path — setup to dashboard
    Tool: Playwright + Bash (curl)
    Preconditions: Fresh database, server running
    Steps:
      1. Open browser to http://localhost:1731
      2. Verify redirect to /setup
      3. Enter password "IntegrationTest1" in both fields
      4. Submit → verify redirect to /login
      5. Enter password "IntegrationTest1"
      6. Submit → verify redirect to /
      7. Verify dashboard loads (sidebar visible, stats cards)
      8. Navigate to /accounts → verify page loads
      9. Click logout → verify redirect to /login
      10. Login again → verify dashboard loads
    Expected Result: All 10 steps pass without error
    Evidence: .sisyphus/evidence/task-9-happy-path.png

  Scenario: Auth separation verification
    Tool: Bash (curl)
    Preconditions: Password set, JWT obtained, API key known
    Steps:
      1. curl /v1/models with API key → expect 200
      2. curl /v1/models with JWT → expect 401
      3. curl /api/accounts with JWT → expect 200
      4. curl /api/accounts with API key → expect 401
    Expected Result: Clean separation — each token type only works on its own routes
    Evidence: .sisyphus/evidence/task-9-auth-separation.txt

  Scenario: Password reset full cycle
    Tool: Bash + Playwright
    Preconditions: Password set, logged in
    Steps:
      1. Stop server
      2. Set RESET_PASSWORD=true
      3. Start server
      4. Open browser → verify redirect to /setup (not login)
      5. Set new password "NewPass456"
      6. Login with "NewPass456" → success
      7. Verify old password "IntegrationTest1" fails
    Expected Result: Full reset cycle works, old password invalid
    Evidence: .sisyphus/evidence/task-9-reset-cycle.txt
  ```

  **Commit**: NO (evidence only)
  - Evidence files saved to `.sisyphus/evidence/task-9-*`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `bunx tsc --noEmit`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Full flow: fresh state → setup page appears → create password → redirected to login → login → dashboard loads → logout → login again → access API key page. Also test: wrong password rejected, setup page inaccessible after password set, proxy still works with API key.
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Commit | Tasks | Message | Files |
|--------|-------|---------|-------|
| 1 | T1, T2 | `feat(auth): add password auth module and JWT utilities` | src/api/dashboard-auth.ts, src/utils/jwt.ts |
| 2 | T5, T7 | `feat(auth): split middleware and add password reset` | src/index.ts, src/middleware/jwt-auth.ts |
| 3 | T3, T4, T6, T8 | `feat(dashboard): password login UI and JWT auth flow` | dashboard/src/pages/Setup.tsx, dashboard/src/pages/Login.tsx, dashboard/src/lib/api.ts, dashboard/src/App.tsx |
| 4 | T9 | `test(auth): integration QA verification` | .sisyphus/evidence/* |

---

## Success Criteria

### Verification Commands
```bash
# Backend: Setup endpoint works (no password set)
curl -s http://localhost:1930/api/dashboard-auth/status | jq .  # Expected: {"setup": false}

# Backend: Setup password
curl -s -X POST http://localhost:1930/api/dashboard-auth/setup -H "Content-Type: application/json" -d '{"password":"test123"}' | jq .  # Expected: {"success": true}

# Backend: Login with password
curl -s -X POST http://localhost:1930/api/dashboard-auth/login -H "Content-Type: application/json" -d '{"password":"test123"}' | jq .  # Expected: {"token": "eyJ..."}

# Backend: Access API with JWT
curl -s http://localhost:1930/api/accounts -H "Authorization: Bearer <token>" | jq .  # Expected: 200 OK

# Backend: API key still rejected for dashboard
curl -s http://localhost:1930/api/accounts -H "Authorization: Bearer sk-pool-..." | jq .  # Expected: 401

# Proxy: API key still works
curl -s http://localhost:1930/v1/models -H "Authorization: Bearer sk-pool-..." | jq .  # Expected: 200 OK

# Proxy: JWT rejected for proxy
curl -s http://localhost:1930/v1/models -H "Authorization: Bearer eyJ..." | jq .  # Expected: 401
```

### Final Checklist
- [ ] Dashboard login uses password (not API key)
- [ ] Proxy uses API key (not password/JWT)
- [ ] First visit → setup page
- [ ] After setup → login page
- [ ] After login → dashboard with JWT
- [ ] Password reset via env var works
- [ ] Existing API key management page accessible
- [ ] No changes to proxy behavior

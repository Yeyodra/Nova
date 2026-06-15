# Task 9: Integration Test Report — Dashboard Password Authentication

**Date:** 2026-06-13
**Backend:** http://localhost:1930
**Frontend Dev:** http://localhost:1731

---

## Backend Tests (All via curl.exe)

| # | Test | Expected | Actual | Status |
|---|------|----------|--------|--------|
| 1 | `GET /api/dashboard-auth/status` | `{"setup": false}` | `{"setup":false}` | ✅ PASS |
| 2 | `POST /api/dashboard-auth/setup` (password: IntegrationTest1) | `{"success": true}` + 200 | `{"success":true}` + 200 | ✅ PASS |
| 3 | `POST /api/dashboard-auth/login` (correct password) | 200 + JWT token | 200 + `{"token":"eyJhbG..."}` | ✅ PASS |
| 4 | `POST /api/dashboard-auth/login` (wrong password) | 401 + error | 401 + `{"error":"Invalid password"}` | ✅ PASS |
| 5 | `GET /api/accounts` with JWT Bearer | 200 | 200 + accounts data | ✅ PASS |
| 6 | `GET /api/accounts` without token | 401 | 401 + `{"error":{"message":"Unauthorized","type":"auth_error"}}` | ✅ PASS |
| 7 | `GET /v1/models` with JWT (auth separation) | 401 (JWT rejected) | 401 + `{"error":{"message":"Invalid API key","type":"auth_error"}}` | ✅ PASS |
| 8 | `POST /api/dashboard-auth/setup` (already configured) | 400 | 400 + `{"error":"Password already configured"}` | ✅ PASS |

### Backend Summary: **8/8 PASS** ✅

---

## Auth Separation Verification

| Route Pattern | Auth Method | Verified |
|---------------|-------------|----------|
| `/api/*` (protected) | JWT Bearer token | ✅ Returns 401 without token, 200 with valid JWT |
| `/api/dashboard-auth/*` | None (exempt) | ✅ Accessible without auth |
| `/api/health` | None (exempt) | ✅ Accessible without auth |
| `/v1/*` | API Key | ✅ Rejects JWT token with "Invalid API key" |

### Auth Separation: **PASS** ✅

---

## Frontend Tests (Playwright against http://localhost:1731)

| # | Test | Expected | Actual | Status |
|---|------|----------|--------|--------|
| 9 | Dev server accessible | 200 | 200 | ✅ PASS |
| 10a | Login page renders (password already set) | Login form visible | Login form with "Enter your password to access the dashboard" | ✅ PASS |
| 10b | Login submission works | Redirect to dashboard | "Network error" — frontend hits port 1730 instead of 1930 | ❌ FAIL (dev-mode bug) |

### Frontend Summary: **2/3 PASS, 1 FAIL** ⚠️

---

## Bug Found

### BUG: Frontend dev-mode API_BASE port calculation incorrect

**File:** `dashboard/src/lib/api.ts` (line 7)
**Code:**
```typescript
const backendPort = import.meta.env.VITE_BACKEND_PORT || (Number(port) - 1) || "1930";
```

**Problem:** In dev mode, frontend runs on port 1731. The formula `Number(port) - 1` = 1730, but the backend is on port 1930. The Vite proxy IS configured for `/api` → `http://localhost:1930`, but the frontend constructs absolute URLs (`http://localhost:1730/api/...`) instead of relative paths (`/api/...`), so the proxy is never used.

**Impact:** Frontend login flow fails in dev mode with "Network error". This does NOT affect production (where dashboard is served from the same origin as the backend).

**Workaround:** Set `VITE_BACKEND_PORT=1930` environment variable before starting the dev server, or use `VITE_API_BASE=http://localhost:1930`.

**Fix needed:** Either:
1. Use relative URLs in dev mode so Vite proxy handles routing, OR
2. Add a `.env` file in `dashboard/` with `VITE_BACKEND_PORT=1930`, OR
3. Change the port calculation logic to not assume `port - 1`

---

## Evidence Files

- `task-9-frontend-login-page.png` — Screenshot of login page rendering correctly
- `task-9-frontend-login-network-error.png` — Screenshot showing "Network error" on login attempt
- `task-9-integration-test-report.md` — This file

---

## Overall Verdict

| Component | Result |
|-----------|--------|
| Backend auth endpoints | ✅ ALL PASS |
| Auth separation (JWT vs API key) | ✅ PASS |
| Frontend rendering | ✅ PASS (login page renders correctly) |
| Frontend login flow (dev mode) | ❌ FAIL (port miscalculation bug) |
| Frontend login flow (production) | ⚠️ NOT TESTED (no built dashboard served) |

### **Overall: PARTIAL PASS** — Backend is solid, frontend has a dev-mode connectivity bug.

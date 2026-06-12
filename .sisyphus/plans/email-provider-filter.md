# Port Email Provider Filter

## TL;DR

> **Quick Summary**: Port the Email Provider Filter page from Yeyodra/Etteum commit `89925bb` to etteum-pool. Straightforward 3-file change — 1 new page + 2 route/nav updates.
> 
> **Deliverables**:
> - New page: `dashboard/src/pages/EmailProviderFilter.tsx`
> - Route registered in `App.tsx`
> - Sidebar nav item added
> 
> **Estimated Effort**: Quick
> **Parallel Execution**: NO — sequential (3 small tasks, dependencies between them)
> **Critical Path**: Task 1 (page) → Task 2 (route + nav)

---

## Context

### Original Request
Port the "Email Provider Filter" feature from commit `89925bb108b3688cb34210f6eba375ec9ca93d70` in `Yeyodra/Etteum` to the local `etteum-pool` repo.

### Interview Summary
**Key Discussions**:
- User confirmed both repos have identical structure
- `scripts/start.ts` fix NOT needed — etteum-pool already has its own Windows path fix via regex replace
- Feature doesn't exist yet in etteum-pool (verified via grep)

**Research Findings**:
- `fetchAccounts` already exists in `dashboard/src/lib/api.ts`
- `Filter` icon already imported in `Sidebar.tsx` from lucide-react
- All UI components used (Card, Button, Badge, Textarea) exist in `dashboard/src/components/ui/`
- Provider types referenced in API layer match commit's expectations

### Metis Review
**Identified Gaps** (addressed):
- `scripts/start.ts` fix: Confirmed NOT needed — repo has own fix
- Provider list compatibility: Verified — same providers in both repos
- `fetchAccounts` response shape: Same API layer, no divergence

---

## Work Objectives

### Core Objective
Add an Email Provider Filter page that lets users paste email lists, compare against existing accounts per provider, and see which emails are missing.

### Concrete Deliverables
- `dashboard/src/pages/EmailProviderFilter.tsx` — full page component
- Updated route in `App.tsx`
- Sidebar nav entry

### Definition of Done
- [x] Page accessible at `/email-provider-filter`
- [x] Sidebar shows "Email Filter" link
- [x] `bun run build` in dashboard succeeds with no errors

### Must Have
- Exact same functionality as commit `89925bb`: normalize input, dedupe, compare per provider, copy missing list
- Provider type: `"kiro" | "kiro-pro" | "codebuddy" | "canva" | "codex" | "qoder"`

### Must NOT Have (Guardrails)
- Do NOT touch `scripts/start.ts` — already has its own fix
- Do NOT add `.sisyphus/evidence/` or `.sisyphus/boulder.json` from the original commit
- Do NOT modify any other existing pages

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES (vitest in dashboard)
- **Automated tests**: NO — this is a direct port of proven code, QA via build + route check
- **Framework**: N/A

### QA Policy
- Build verification: `bun run build` in dashboard
- Route verification: dev server + Playwright navigation

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Single wave — sequential due to import dependency):
├── Task 1: Create EmailProviderFilter.tsx page [quick]
└── Task 2: Register route + sidebar nav [quick]

Wave FINAL:
└── Task F1: Build verification + route check [quick]
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | None | 2, F1 |
| 2 | 1 | F1 |
| F1 | 1, 2 | — |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks — T1 → `quick`, T2 → `quick`
- **FINAL**: 1 task — F1 → `quick`

---

## TODOs

- [x] 1. Create EmailProviderFilter page component

  **What to do**:
  - Create `dashboard/src/pages/EmailProviderFilter.tsx` with the full 274-line component from commit `89925bb`
  - The component includes:
    - Type `Provider` = union of 6 provider strings
    - Interface `Account` with id, email, provider, status, enabled, quotaLimit?, quotaRemaining?
    - Helper: `normalizeInput(raw)` — trim, lowercase, dedupe emails
    - Helper: `groupAccountsByProvider(accounts)` — returns Map<Provider, Set<string>>
    - Helper: `labelProvider(provider)` — display names for providers
    - State: accounts, loading, error, message, input, selectedProviders
    - Memos: normalizedEmails, accountEmailsByProvider, providerResults
    - Function: `toggleProvider` — add/remove provider from selection
    - Function: `copyMissingEmails` — clipboard copy of missing list
    - Function: `showMessage` — temporary toast-like message with 2s timeout
    - UI: Card with textarea input + provider toggle badges + per-provider result cards with copy button + missing email list

  **Must NOT do**:
  - Do NOT modify any existing files in this task
  - Do NOT add tests — this is a proven port

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single file creation, code is already known — just write it
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: Not needed — we're copying exact code, not designing

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (first)
  - **Blocks**: Task 2, Task F1
  - **Blocked By**: None

  **References**:

  **Pattern References** (source code to port):
  - Commit `89925bb` file `dashboard/src/pages/EmailProviderFilter.tsx` — the ENTIRE file content to create (274 lines). Fetch via: `gh api repos/Yeyodra/Etteum/contents/dashboard/src/pages/EmailProviderFilter.tsx?ref=89925bb108b3688cb34210f6eba375ec9ca93d70 --jq .content | base64 -d`

  **API/Type References** (existing code this depends on):
  - `dashboard/src/lib/api.ts:fetchAccounts` — API function already available, returns account objects
  - `dashboard/src/components/ui/card.tsx` — Card, CardContent, CardDescription, CardHeader, CardTitle
  - `dashboard/src/components/ui/button.tsx` — Button component
  - `dashboard/src/components/ui/badge.tsx` — Badge component
  - `dashboard/src/components/ui/textarea.tsx` — Textarea component

  **Acceptance Criteria**:
  - [ ] File exists: `dashboard/src/pages/EmailProviderFilter.tsx`
  - [ ] File exports default function `EmailProviderFilter`
  - [ ] No TypeScript errors: `cd dashboard && npx tsc --noEmit --strict dashboard/src/pages/EmailProviderFilter.tsx` passes

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript compilation check
    Tool: Bash
    Preconditions: dashboard dependencies installed
    Steps:
      1. Run `cd dashboard && npx tsc --noEmit`
      2. Check exit code is 0
    Expected Result: No type errors, exit code 0
    Failure Indicators: Any TS error mentioning EmailProviderFilter.tsx
    Evidence: .sisyphus/evidence/task-1-tsc-check.txt

  Scenario: File structure validation
    Tool: Bash
    Preconditions: File created
    Steps:
      1. Run `grep -c "export default function EmailProviderFilter" dashboard/src/pages/EmailProviderFilter.tsx`
      2. Run `grep -c "fetchAccounts" dashboard/src/pages/EmailProviderFilter.tsx`
      3. Run `grep -c "normalizeInput" dashboard/src/pages/EmailProviderFilter.tsx`
    Expected Result: Each grep returns 1 or more matches
    Failure Indicators: Any grep returns 0
    Evidence: .sisyphus/evidence/task-1-structure-check.txt
  ```

  **Commit**: YES
  - Message: `feat(dashboard): add email provider filter page`
  - Files: `dashboard/src/pages/EmailProviderFilter.tsx`
  - Pre-commit: `cd dashboard && npx tsc --noEmit`

- [x] 2. Register route and sidebar navigation

  **What to do**:
  - In `dashboard/src/App.tsx`:
    - Add lazy import: `const EmailProviderFilter = lazy(() => import("./pages/EmailProviderFilter"));`
    - Add route: `<Route path="/email-provider-filter" element={<EmailProviderFilter />} />` after the `/accounts/:provider` route
  - In `dashboard/src/components/layout/Sidebar.tsx`:
    - Add nav item `{ label: "Email Filter", path: "/email-provider-filter", icon: Filter }` after the "Accounts" item
    - Note: `Filter` icon is ALREADY imported from lucide-react — no import change needed

  **Must NOT do**:
  - Do NOT add Filter to lucide-react imports (already there)
  - Do NOT reorder existing routes or nav items
  - Do NOT touch any other files

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Two small edits in existing files — add 1 line each
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (second)
  - **Blocks**: Task F1
  - **Blocked By**: Task 1 (import references the page file)

  **References**:

  **Pattern References** (where to insert):
  - `dashboard/src/App.tsx` — look for existing lazy imports (line ~17 area) and routes (line ~68 area). Insert after `FilterRules` import and after `/accounts/:provider` route.
  - `dashboard/src/components/layout/Sidebar.tsx` — look for `navSections` array, find `{ label: "Accounts", path: "/accounts", icon: Users }` and insert after it.

  **Acceptance Criteria**:
  - [ ] `App.tsx` has lazy import for EmailProviderFilter
  - [ ] `App.tsx` has route `/email-provider-filter`
  - [ ] `Sidebar.tsx` has nav item "Email Filter" with path `/email-provider-filter` and icon `Filter`
  - [ ] `cd dashboard && npx tsc --noEmit` passes

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Build succeeds with new route
    Tool: Bash
    Preconditions: Task 1 complete, dependencies installed
    Steps:
      1. Run `cd dashboard && bun run build`
      2. Check exit code is 0
    Expected Result: Build completes successfully, no errors
    Failure Indicators: Build fails with import errors or missing module
    Evidence: .sisyphus/evidence/task-2-build.txt

  Scenario: Route and nav item present in source
    Tool: Bash
    Preconditions: Files edited
    Steps:
      1. Run `grep "email-provider-filter" dashboard/src/App.tsx`
      2. Run `grep "email-provider-filter" dashboard/src/components/layout/Sidebar.tsx`
      3. Run `grep "EmailProviderFilter" dashboard/src/App.tsx`
    Expected Result: All greps return matches
    Failure Indicators: Any grep returns empty
    Evidence: .sisyphus/evidence/task-2-route-check.txt
  ```

  **Commit**: YES
  - Message: `feat(dashboard): register email provider filter route and nav`
  - Files: `dashboard/src/App.tsx`, `dashboard/src/components/layout/Sidebar.tsx`
  - Pre-commit: `cd dashboard && bun run build`

---

## Final Verification Wave

- [x] F1. **Build + Route Verification** — `quick`
  Run full dashboard build (`cd dashboard && bun run build`). Start dev server, navigate to `/email-provider-filter` via Playwright, verify page renders with title "Email Provider Filter" and textarea is visible. Take screenshot as evidence.
  Output: `Build [PASS/FAIL] | Route [PASS/FAIL] | Render [PASS/FAIL] | VERDICT`

---

## Commit Strategy

| # | Message | Files | Pre-commit |
|---|---------|-------|-----------|
| 1 | `feat(dashboard): add email provider filter page` | `dashboard/src/pages/EmailProviderFilter.tsx` | `tsc --noEmit` |
| 2 | `feat(dashboard): register email provider filter route and nav` | `App.tsx`, `Sidebar.tsx` | `bun run build` |

---

## Success Criteria

### Verification Commands
```bash
cd dashboard && bun run build  # Expected: Build successful, exit 0
grep "EmailProviderFilter" dashboard/src/App.tsx  # Expected: lazy import + route
grep "email-provider-filter" dashboard/src/components/layout/Sidebar.tsx  # Expected: nav item
```

### Final Checklist
- [x] Page component exists and exports correctly
- [x] Route `/email-provider-filter` registered
- [x] Sidebar shows "Email Filter" link
- [x] Dashboard builds without errors
- [x] No other files modified

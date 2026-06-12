# Sync Upstream: Cherry-Pick priyo000/etteum-pool Commits

## TL;DR

> **Quick Summary**: Cherry-pick 23 upstream commits from `priyo000/etteum-pool` one-by-one onto a new branch, resolving conflicts while preserving user's custom code, building after each commit.
> 
> **Deliverables**:
> - New branch `sync-upstream` with all 23 owner commits integrated
> - User's 7 custom commits preserved (code saved when conflicts arise)
> - Each commit verified with `tsc --noEmit` + `bun run build`
> - Pushed to `origin` (Yeyodra/Nova) after each successful cherry-pick
> 
> **Estimated Effort**: Large (23 sequential cherry-picks with conflict resolution)
> **Parallel Execution**: NO — strictly sequential (each commit depends on previous)
> **Critical Path**: Setup → Cherry-pick 1 → ... → Cherry-pick 23 → Final verify

---

## Context

### Original Request
User wants to sync their fork (Yeyodra/Nova) with the upstream owner repo (priyo000/etteum-pool). The fork has diverged with 7 custom commits. Owner has 23 new commits. User wants to cherry-pick one-by-one, resolve conflicts preserving their own code, build-verify each step, and push incrementally.

### Repository Layout
- **Local main**: `f5780c9` (tip) — user's 7 commits on top of `fcb4720`
- **upstream/main**: `05413a2` (tip) — priyo000's latest, 23 commits ahead of `fcb4720`
- **Common ancestor**: `fcb4720` (feat: proxy pool settings)
- **Push target**: `origin` = `https://github.com/Yeyodra/Nova.git`

### User's Custom Commits (7 total, on top of fcb4720)
| # | Hash | Message | Key Files |
|---|------|---------|-----------|
| 1 | `92967c1` | fix(codebuddy): fix API 11101 error with proper IDE headers and streaming | `src/proxy/providers/codebuddy.ts` |
| 2 | `6bbdfd7` | feat(filters): add China content moderation bypass rules | `src/proxy/filters.ts` |
| 3 | `ffa8d03` | fix: misc startup fixes (stderr log, bun path, filter sync script) | `etteum.ps1`, `scripts/start.ts`, `scripts/sync-filter-rules.ts` |
| 4 | `e9694f7` | feat(tunnel): implement Cloudflare Tunnel with dashboard UI | 15 files (new tunnel system) |
| 5 | `34f4b7a` | feat(dashboard): add email provider filter page | `dashboard/src/pages/EmailProviderFilter.tsx` (NEW) |
| 6 | `3bd20a0` | feat(dashboard): register email provider filter route and nav | `dashboard/src/App.tsx`, `Sidebar.tsx` |
| 7 | `f5780c9` | fix: Windows path resolution in production/dashboard scripts | `scripts/production.ts`, `scripts/serve-dashboard.ts` |

### Metis Review Findings
- Merge commit `f0f2949` should be SKIPPED (empty merge, content already in `62089e2`)
- Commit `16e90f8` is the HARDEST conflict (touches `codebuddy.ts` heavily — 113 lines added/modified in same file user modified)
- Commit `4c15a35` removes 584 lines of dead code from Python file — no TS conflict but large Python change
- Commit `05413a2` ("fix : budi kntl") creates a `.py.bak` file — may want to skip/clean

---

## Work Objectives

### Core Objective
Integrate all 23 upstream commits into a new branch while preserving user's custom code and ensuring build passes after each step.

### Concrete Deliverables
- Branch `sync-upstream` created from current `main` (HEAD = `f5780c9`)
- All 23 upstream commits cherry-picked in chronological order
- Zero build failures at any point in the sequence
- User's code preserved in all conflict resolutions

### Definition of Done
- [ ] `tsc --noEmit` passes after final commit
- [ ] `bun run build` (dashboard) passes after final commit
- [ ] All 23 upstream commits integrated
- [ ] Branch pushed to `origin`

### Must Have
- Preserve user's `buildCodeBuddyBaseHeaders()` with IDE fingerprint headers
- Preserve user's tunnel feature (15 files)
- Preserve user's email provider filter feature
- Preserve user's China content moderation bypass rules
- Preserve user's Windows path resolution fixes
- Build verification after EVERY cherry-pick (not just at the end)

### Must NOT Have (Guardrails)
- Do NOT start the proxy server at any point
- Do NOT delete user's custom features even if owner doesn't have them
- Do NOT force-push to `main` — work on `sync-upstream` branch only
- Do NOT skip build verification for any commit
- Do NOT auto-resolve conflicts by blindly taking "theirs" — always analyze

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Build Verification (after EVERY cherry-pick)
```bash
# Step 1: TypeScript type-check (backend)
bunx tsc --noEmit

# Step 2: Dashboard build (frontend)
cd dashboard && bun run build
```

### Conflict Resolution Strategy
1. When conflict touches user's code: **KEEP user's version** as base
2. Integrate owner's NEW functionality that doesn't overlap
3. If owner's approach is clearly better for a specific function: adopt it but preserve user's additions
4. After resolution: ALWAYS build-verify before committing

---

## Execution Strategy

### Sequential Execution (NO parallelism — each depends on previous)

```
Setup: Create branch + verify clean state
  │
  ├── Commit 1: 62089e2 (client config generators) — 🟡 MEDIUM risk
  ├── Commit 2: f0f2949 (merge PR) — SKIP (empty merge)
  ├── Commit 3: 9c29080 (BYOK UI) — 🟢 LOW risk
  ├── Commit 4: 40021bd (Copy import) — 🟢 LOW risk
  ├── Commit 5: 16e90f8 (codebuddy browser crashes) — 🔴 HIGH risk
  ├── Commit 6: eb56c93 (login logs sort) — 🟢 LOW risk
  ├── Commit 7: 4e78fb0 (codebuddy timeouts) — 🟢 LOW risk (Python only)
  ├── Commit 8: 829f915 (inactivity timeout) — 🟢 LOW risk (Python only)
  ├── Commit 9: 6de79cc (rolling 24h chart) — 🟢 LOW risk
  ├── Commit 10: cfe9744 (revert calendar day) — 🟢 LOW risk
  ├── Commit 11: b4b8a75 (hourly grain) — 🟢 LOW risk
  ├── Commit 12: 97797d1 (grain threshold) — 🟢 LOW risk
  ├── Commit 13: c0f8882 (login timeout) — 🟢 LOW risk (Python only)
  ├── Commit 14: 8ccc3c3 (consent click) — 🟢 LOW risk (Python only)
  ├── Commit 15: d8adc63 (navigate domain) — 🟢 LOW risk (Python only)
  ├── Commit 16: 4c15a35 (remove dead code) — 🟡 MEDIUM risk (584 lines Python)
  ├── Commit 17: 1a361a2 (browser_utils extract) — 🟢 LOW risk (new Python file)
  ├── Commit 18: ebc14c5 (fetch_quota resilient) — 🟢 LOW risk (Python only)
  ├── Commit 19: 2e0df47 (save cookies) — 🟢 LOW risk (Python only)
  ├── Commit 20: 7661674 (retry login) — 🟡 MEDIUM risk (touches runner.ts)
  ├── Commit 21: f4b8eab (cookie fallback) — 🟡 MEDIUM risk (touches codebuddy.ts)
  ├── Commit 22: 590568e (revert login retry) — 🟡 MEDIUM risk (touches runner.ts)
  └── Commit 23: 05413a2 (budi kntl) — 🟡 MEDIUM risk (touches codebuddy.ts + .bak file)

Critical Path: ALL sequential — no shortcuts possible
```

---

## TODOs

- [x] 0. Setup: Create sync-upstream branch and verify environment

  **What to do**:
  - Create new branch `sync-upstream` from current HEAD (`f5780c9`)
  - Verify `upstream` remote exists and points to `https://github.com/priyo000/etteum-pool.git`
  - Run `bun install` to ensure deps are current
  - Run `tsc --noEmit` and `bun run build` to confirm clean baseline
  - Push empty branch to origin: `git push origin sync-upstream`

  **Must NOT do**:
  - Do NOT modify any files
  - Do NOT start the proxy server

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: All subsequent tasks
  - **Blocked By**: None

  **References**:
  - Remote `upstream` already added: `https://github.com/priyo000/etteum-pool.git`
  - Push target: `origin` = `https://github.com/Yeyodra/Nova.git`

  **Acceptance Criteria**:
  - [ ] Branch `sync-upstream` exists and is checked out
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0
  - [ ] Branch pushed to origin

  **QA Scenarios**:
  ```
  Scenario: Verify clean baseline
    Tool: Bash
    Steps:
      1. git branch --show-current → "sync-upstream"
      2. bunx tsc --noEmit → exit code 0
      3. cd dashboard && bun run build → exit code 0
      4. git log --oneline -1 → "f5780c9 fix: Windows path resolution..."
    Expected Result: All commands exit 0, branch is sync-upstream
    Evidence: .sisyphus/evidence/task-0-baseline-build.txt
  ```

  **Commit**: NO (no changes to commit)

- [x] 1. Cherry-pick: 62089e2 — feat: implement client configuration generators and dashboard integration UI

  **What to do**:
  - `git cherry-pick 62089e2`
  - This commit adds 15 files (mostly NEW): ClientCard.tsx, ConfigPreview.tsx, client-config generators, Integration.tsx rewrite
  - **Conflict prediction**: `src/api/integration.ts` may conflict (user's tunnel commit `e9694f7` modified `src/api/index.ts` which imports from integration)
  - **Conflict prediction**: `dashboard/src/pages/Integration.tsx` — owner rewrites this significantly (+475/-151 lines)
  - If conflict: keep user's additions (tunnel routes, health router), merge owner's new client-config features
  - After resolve: `tsc --noEmit` + `bun run build`
  - Commit with original message, push

  **Must NOT do**:
  - Do NOT lose user's tunnel route registrations in `src/api/index.ts`
  - Do NOT lose user's `healthRouter` import

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 2
  - **Blocked By**: Task 0

  **References**:
  - User's `src/api/index.ts` changes: added `healthRouter` and `tunnelRouter` imports + routes
  - Owner's commit adds: `src/api/integration.ts` (184 lines new), `src/lib/client-configs/` (entire new directory)
  - Owner rewrites `dashboard/src/pages/Integration.tsx` heavily

  **Acceptance Criteria**:
  - [ ] Cherry-pick applied (with or without conflict resolution)
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0
  - [ ] User's tunnel and health routes still present in `src/api/index.ts`

  **QA Scenarios**:
  ```
  Scenario: Build passes after cherry-pick
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
      3. grep -q "tunnelRouter" src/api/index.ts → exit code 0
      4. grep -q "healthRouter" src/api/index.ts → exit code 0
    Expected Result: Build passes, user's routes preserved
    Evidence: .sisyphus/evidence/task-1-build.txt

  Scenario: Owner's new files exist
    Tool: Bash
    Steps:
      1. test -f src/lib/client-configs/index.ts → exit code 0
      2. test -f dashboard/src/components/integration/ClientCard.tsx → exit code 0
    Expected Result: New files from owner present
    Evidence: .sisyphus/evidence/task-1-files.txt
  ```

  **Commit**: YES
  - Message: preserve original: `feat: implement client configuration generators and dashboard integration UI`
  - Pre-commit: `bunx tsc --noEmit; cd dashboard && bun run build`

- [x] 2. Cherry-pick: f0f2949 — Merge pull request #1 from luminovaa/main (SKIP)

  **What to do**:
  - **SKIP this commit** — it's a merge commit whose content is already in `62089e2`
  - Cherry-picking merge commits requires `-m 1` flag and typically causes issues
  - The actual code changes are already applied in Task 1
  - Simply move to next task

  **Must NOT do**:
  - Do NOT attempt `git cherry-pick f0f2949`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 3
  - **Blocked By**: Task 1

  **Acceptance Criteria**:
  - [ ] No action taken, proceed to next commit

  **QA Scenarios**:
  ```
  Scenario: Verify skip is correct
    Tool: Bash
    Steps:
      1. git log --oneline -1 → should still show task 1's commit as HEAD
    Expected Result: HEAD unchanged from task 1
    Evidence: .sisyphus/evidence/task-2-skip.txt
  ```

  **Commit**: NO

- [x] 3. Cherry-pick: 9c29080 — fix: improve BYOK UI

  **What to do**:
  - `git cherry-pick 9c29080`
  - Touches only `dashboard/src/pages/Accounts.tsx` (168 ins, 104 del)
  - **Conflict prediction**: 🟢 LOW — user has no commits touching Accounts.tsx
  - After apply: `tsc --noEmit` + `bun run build`
  - Push

  **Must NOT do**:
  - Nothing special — clean apply expected

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 4
  - **Blocked By**: Task 1

  **Acceptance Criteria**:
  - [ ] Cherry-pick applied cleanly
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-3-build.txt
  ```

  **Commit**: YES
  - Message: `fix: improve BYOK UI`
  - Pre-commit: `bunx tsc --noEmit; cd dashboard && bun run build`

- [x] 4. Cherry-pick: 40021bd — fix: add missing Copy import in ClientCard

  **What to do**:
  - `git cherry-pick 40021bd`
  - Touches only `dashboard/src/components/integration/ClientCard.tsx` (1 line addition)
  - **Conflict prediction**: 🟢 LOW — file was just created in Task 1
  - After apply: `tsc --noEmit` + `bun run build`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 5
  - **Blocked By**: Task 3

  **Acceptance Criteria**:
  - [ ] Cherry-pick applied cleanly
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-4-build.txt
  ```

  **Commit**: YES
  - Message: `fix: add missing Copy import in ClientCard`
  - Pre-commit: `bunx tsc --noEmit; cd dashboard && bun run build`

- [ ] 5. Cherry-pick: 16e90f8 — fix(codebuddy): handle browser crashes during OAuth (🔴 HIGH RISK)

  **What to do**:
  - `git cherry-pick 16e90f8`
  - This is the HARDEST commit — touches 8 files including `src/proxy/providers/codebuddy.ts` (+113 lines)
  - **CONFLICT GUARANTEED on `src/proxy/providers/codebuddy.ts`**:
    - User's commit `92967c1` added `buildCodeBuddyBaseHeaders()`, changed `buildAuthHeaders()`, modified `validateApiKey()`
    - Owner's commit adds: browser crash detection, internal restart mechanism, consent shortcut, Firefox prefs, retry logic
    - Owner also modifies `buildAuthHeaders()` and adds new methods
  - **Resolution strategy**:
    1. KEEP user's `buildCodeBuddyBaseHeaders()` with IDE fingerprint headers (x-stainless-*, CodeBuddyIDE/0.1.14 User-Agent)
    2. KEEP user's 2-message minimum in validateApiKey
    3. MERGE owner's new crash handling methods (they're additive — new functions)
    4. For `buildAuthHeaders()`: use user's version (calls buildCodeBuddyBaseHeaders()) but integrate any new fields owner adds
    5. KEEP user's force `stream: true`
  - Also touches: `scripts/auth/app/providers/codebuddy.py` (1023 lines changed — Python, no conflict with user), `scripts/auth/login.py`, `src/proxy/errors.ts`, `src/proxy/index.ts`, `src/auth/warmup-queue.ts`, `dashboard/src/pages/Accounts.tsx`
  - After resolve: `tsc --noEmit` + `bun run build`

  **Must NOT do**:
  - Do NOT lose user's `buildCodeBuddyBaseHeaders()` function
  - Do NOT lose user's x-stainless-* headers
  - Do NOT lose user's `CodeBuddyIDE/0.1.14` User-Agent
  - Do NOT lose user's 2-message minimum in validateApiKey
  - Do NOT lose user's force stream:true logic

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
    - Reason: Complex conflict resolution requiring understanding of both codebases

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 6
  - **Blocked By**: Task 4

  **References**:
  - User's codebuddy.ts changes: `git diff fcb4720 92967c1 -- src/proxy/providers/codebuddy.ts`
  - User's key function: `buildCodeBuddyBaseHeaders()` at ~line 499-514 (current HEAD)
  - User's validateApiKey changes: uses `buildCodeBuddyBaseHeaders()`, 2-message format, max_tokens:10
  - Owner adds: crash detection in `healthCheck()`, `fetchQuotaViaCookie()`, Firefox user prefs constants

  **Acceptance Criteria**:
  - [ ] Cherry-pick resolved (conflict expected)
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0
  - [ ] `grep -q "buildCodeBuddyBaseHeaders" src/proxy/providers/codebuddy.ts` → found
  - [ ] `grep -q "x-stainless-lang" src/proxy/providers/codebuddy.ts` → found
  - [ ] `grep -q "CodeBuddyIDE" src/proxy/providers/codebuddy.ts` → found

  **QA Scenarios**:
  ```
  Scenario: User's IDE headers preserved
    Tool: Bash
    Steps:
      1. grep "buildCodeBuddyBaseHeaders" src/proxy/providers/codebuddy.ts → found
      2. grep "x-stainless-lang" src/proxy/providers/codebuddy.ts → found
      3. grep "CodeBuddyIDE/0.1.14" src/proxy/providers/codebuddy.ts → found
      4. grep "stream.*true" src/proxy/providers/codebuddy.ts → found
    Expected Result: All user's key additions present
    Evidence: .sisyphus/evidence/task-5-user-code-preserved.txt

  Scenario: Owner's crash handling integrated
    Tool: Bash
    Steps:
      1. grep "fetchQuotaViaCookie\|browser.*crash\|restart" src/proxy/providers/codebuddy.ts → found
      2. bunx tsc --noEmit → exit code 0
      3. cd dashboard && bun run build → exit code 0
    Expected Result: Owner's new features present + build passes
    Evidence: .sisyphus/evidence/task-5-build.txt
  ```

  **Commit**: YES
  - Message: `fix(codebuddy): handle browser crashes during OAuth with internal restart + consent shortcut`
  - Pre-commit: `bunx tsc --noEmit; cd dashboard && bun run build`

- [ ] 6. Cherry-pick: eb56c93 — fix(dashboard): sort login logs by queue order

  **What to do**:
  - `git cherry-pick eb56c93`
  - Touches only `dashboard/src/pages/BotLogs.tsx` (2 ins, 1 del)
  - **Conflict prediction**: 🟢 LOW — user has no commits touching this file
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 7
  - **Blocked By**: Task 5

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-6-build.txt
  ```

  **Commit**: YES
  - Message: `fix(dashboard): sort login logs by queue order (startedAt) instead of updatedAt`

- [ ] 7. Cherry-pick: 4e78fb0 — fix(codebuddy): increase timeouts for slow connections

  **What to do**:
  - `git cherry-pick 4e78fb0`
  - Touches only `scripts/auth/app/providers/codebuddy.py` (Python — 9 ins, 9 del)
  - **Conflict prediction**: 🟢 LOW — user has no Python commits
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 8
  - **Blocked By**: Task 6

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-7-build.txt
  ```

  **Commit**: YES
  - Message: `fix(codebuddy): increase timeouts for slow connections`

- [ ] 8. Cherry-pick: 829f915 — fix(codebuddy): replace fixed wall-clock timeout with inactivity-based

  **What to do**:
  - `git cherry-pick 829f915`
  - Touches only `scripts/auth/app/providers/codebuddy.py` (Python — 23 ins, 6 del)
  - **Conflict prediction**: 🟢 LOW — Python only, no user overlap
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 9
  - **Blocked By**: Task 7

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-8-build.txt
  ```

  **Commit**: YES
  - Message: `fix(codebuddy): replace fixed wall-clock timeout with inactivity-based timeout`

- [ ] 9. Cherry-pick: 6de79cc — fix(dashboard): use rolling 24h window for 1d chart

  **What to do**:
  - `git cherry-pick 6de79cc`
  - Touches only `dashboard/src/components/dashboard/TokenUsage.tsx` (5 ins, 4 del)
  - **Conflict prediction**: 🟢 LOW — user has no commits touching this file
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 10
  - **Blocked By**: Task 8

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-9-build.txt
  ```

  **Commit**: YES
  - Message: `fix(dashboard): use rolling 24h window for 1d chart instead of calendar day`

- [ ] 10. Cherry-pick: cfe9744 — revert(dashboard): restore calendar day range

  **What to do**:
  - `git cherry-pick cfe9744`
  - Touches only `dashboard/src/components/dashboard/TokenUsage.tsx` (4 ins, 4 del)
  - **Conflict prediction**: 🟢 LOW — reverts previous commit's change in same file
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 11
  - **Blocked By**: Task 9

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-10-build.txt
  ```

  **Commit**: YES
  - Message: `revert(dashboard): restore calendar day range (00:00-00:00) for 1d chart`

- [ ] 11. Cherry-pick: b4b8a75 — fix(api): use hourly grain for hours<=48

  **What to do**:
  - `git cherry-pick b4b8a75`
  - Touches only `src/api/stats.ts`
  - **Conflict prediction**: 🟢 LOW — user has no commits touching stats.ts
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 12
  - **Blocked By**: Task 10

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-11-build.txt
  ```

  **Commit**: YES
  - Message: `fix(api): use hourly grain for hours<=48 so 1d chart shows per-hour data`

- [ ] 12. Cherry-pick: 97797d1 — fix(api): adjust grain threshold to 24*32

  **What to do**:
  - `git cherry-pick 97797d1`
  - Touches only `src/api/stats.ts`
  - **Conflict prediction**: 🟢 LOW — same file as previous, sequential change
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 13
  - **Blocked By**: Task 11

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-12-build.txt
  ```

  **Commit**: YES
  - Message: `fix(api): adjust grain threshold to 24*32 so 30d period uses daily buckets`

- [ ] 13. Cherry-pick: c0f8882 — fix(login): remove fixed 180s timeout for codebuddy

  **What to do**:
  - `git cherry-pick c0f8882`
  - Touches only `scripts/auth/login.py` (Python)
  - **Conflict prediction**: 🟢 LOW — Python only
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 14
  - **Blocked By**: Task 12

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-13-build.txt
  ```

  **Commit**: YES
  - Message: `fix(login): remove fixed 180s timeout for codebuddy — use 600s safety net`

- [ ] 14. Cherry-pick: 8ccc3c3 — fix(codebuddy): return authenticated immediately after consent click

  **What to do**:
  - `git cherry-pick 8ccc3c3`
  - Touches only `scripts/auth/app/providers/codebuddy.py` (Python)
  - **Conflict prediction**: 🟢 LOW — Python only
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 15
  - **Blocked By**: Task 13

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-14-build.txt
  ```

  **Commit**: YES
  - Message: `fix(codebuddy): return authenticated immediately after consent click`

- [ ] 15. Cherry-pick: d8adc63 — fix(codebuddy): navigate to CodeBuddy domain before API key creation

  **What to do**:
  - `git cherry-pick d8adc63`
  - Touches only `scripts/auth/app/providers/codebuddy.py` (Python)
  - **Conflict prediction**: 🟢 LOW — Python only
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 16
  - **Blocked By**: Task 14

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-15-build.txt
  ```

  **Commit**: YES
  - Message: `fix(codebuddy): navigate to CodeBuddy domain before API key creation`

- [ ] 16. Cherry-pick: 4c15a35 — refactor(codebuddy): remove 584 lines of dead code (🟡 MEDIUM)

  **What to do**:
  - `git cherry-pick 4c15a35`
  - Touches only `scripts/auth/app/providers/codebuddy.py` (Python — massive deletion)
  - **Conflict prediction**: 🟡 MEDIUM — large Python refactor, may conflict with earlier cherry-picks if context shifted
  - This removes unused functions and constants from the Python auth script
  - After apply: build verify + push

  **Must NOT do**:
  - Do NOT worry about TS conflicts — this is Python only

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
    - Reason: Large deletion may cause context conflicts in Python file

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 17
  - **Blocked By**: Task 15

  **Acceptance Criteria**:
  - [ ] Cherry-pick applied (may need conflict resolution in Python)
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes after large deletion
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
      3. python -c "import ast; ast.parse(open('scripts/auth/app/providers/codebuddy.py').read())" → exit code 0
    Expected Result: TS build passes, Python file is valid syntax
    Evidence: .sisyphus/evidence/task-16-build.txt
  ```

  **Commit**: YES
  - Message: `refactor(codebuddy): remove 584 lines of dead code`

- [ ] 17. Cherry-pick: 1a361a2 — refactor(auth): extract shared browser_utils

  **What to do**:
  - `git cherry-pick 1a361a2`
  - Creates NEW file `scripts/auth/app/providers/browser_utils.py`
  - Also modifies `scripts/auth/app/providers/codebuddy.py` (uses new shared helpers)
  - **Conflict prediction**: 🟢 LOW — new file + Python modifications
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 18
  - **Blocked By**: Task 16

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0
  - [ ] `scripts/auth/app/providers/browser_utils.py` exists

  **QA Scenarios**:
  ```
  Scenario: Build passes + new file exists
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
      3. test -f scripts/auth/app/providers/browser_utils.py → exit code 0
    Expected Result: Clean build, new Python module present
    Evidence: .sisyphus/evidence/task-17-build.txt
  ```

  **Commit**: YES
  - Message: `refactor(auth): extract shared browser_utils (build_camoufox_kwargs, is_browser_crash)`

- [ ] 18. Cherry-pick: ebc14c5 — fix(codebuddy): make fetch_quota resilient to browser crashes

  **What to do**:
  - `git cherry-pick ebc14c5`
  - Touches only `scripts/auth/app/providers/codebuddy.py` (Python)
  - **Conflict prediction**: 🟢 LOW — Python only
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 19
  - **Blocked By**: Task 17

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-18-build.txt
  ```

  **Commit**: YES
  - Message: `fix(codebuddy): make fetch_quota resilient to browser crashes`

- [ ] 19. Cherry-pick: 2e0df47 — fix(login): save cookies before fetch_quota

  **What to do**:
  - `git cherry-pick 2e0df47`
  - Touches only `scripts/auth/login.py` (Python)
  - **Conflict prediction**: 🟢 LOW — Python only
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 20
  - **Blocked By**: Task 18

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-19-build.txt
  ```

  **Commit**: YES
  - Message: `fix(login): save cookies before fetch_quota to survive browser crashes`

- [ ] 20. Cherry-pick: 7661674 — fix(codebuddy): retry login when quota fetch fails (🟡 MEDIUM)

  **What to do**:
  - `git cherry-pick 7661674`
  - Touches `scripts/auth/login.py` (Python) AND `src/auth/runner.ts` (TypeScript)
  - **Conflict prediction**: 🟡 MEDIUM — `runner.ts` may have shifted context from Task 5's changes
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 21
  - **Blocked By**: Task 19

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-20-build.txt
  ```

  **Commit**: YES
  - Message: `fix(codebuddy): retry login when quota fetch fails instead of saving 0/0`

- [ ] 21. Cherry-pick: f4b8eab — fix(codebuddy): add cookie fallback for flaky billing API (🟡 MEDIUM)

  **What to do**:
  - `git cherry-pick f4b8eab`
  - Touches `scripts/auth/app/providers/codebuddy.py` (Python) AND `src/proxy/providers/codebuddy.ts` (TypeScript)
  - **Conflict prediction**: 🟡 MEDIUM — `codebuddy.ts` was already modified in Task 5, user's code is present
  - Owner adds `fetchQuotaViaCookie()` function to the TS file
  - Resolution: add owner's new function while preserving user's existing code
  - After apply: build verify + push

  **Must NOT do**:
  - Do NOT lose user's `buildCodeBuddyBaseHeaders()` or IDE headers

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 22
  - **Blocked By**: Task 20

  **References**:
  - User's `buildCodeBuddyBaseHeaders()` must remain intact
  - Owner adds `fetchQuotaViaCookie()` — new function, should merge cleanly if context is right

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0
  - [ ] `grep -q "buildCodeBuddyBaseHeaders" src/proxy/providers/codebuddy.ts` → found
  - [ ] `grep -q "fetchQuotaViaCookie" src/proxy/providers/codebuddy.ts` → found

  **QA Scenarios**:
  ```
  Scenario: Both user and owner code present
    Tool: Bash
    Steps:
      1. grep "buildCodeBuddyBaseHeaders" src/proxy/providers/codebuddy.ts → found
      2. grep "fetchQuotaViaCookie" src/proxy/providers/codebuddy.ts → found
      3. bunx tsc --noEmit → exit code 0
      4. cd dashboard && bun run build → exit code 0
    Expected Result: Both codebases merged, build passes
    Evidence: .sisyphus/evidence/task-21-build.txt
  ```

  **Commit**: YES
  - Message: `fix(codebuddy): add cookie fallback for flaky billing API quota fetch`

- [ ] 22. Cherry-pick: 590568e — revert: remove login retry on quota None (🟡 MEDIUM)

  **What to do**:
  - `git cherry-pick 590568e`
  - Touches `scripts/auth/login.py` (Python) AND `src/auth/runner.ts` (TypeScript)
  - **Conflict prediction**: 🟡 MEDIUM — reverts part of Task 20's changes in runner.ts
  - After apply: build verify + push

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Task 23
  - **Blocked By**: Task 21

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0

  **QA Scenarios**:
  ```
  Scenario: Build passes
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
    Expected Result: Clean build
    Evidence: .sisyphus/evidence/task-22-build.txt
  ```

  **Commit**: YES
  - Message: `revert: remove login retry on quota None — cookie fallback handles it`

- [ ] 23. Cherry-pick: 05413a2 — fix : budi kntl (🟡 MEDIUM)

  **What to do**:
  - `git cherry-pick 05413a2`
  - Touches: `scripts/auth/app/providers/codebuddy.py`, `scripts/auth/app/providers/codebuddy.py.bak`, `scripts/auth/login.py`, `src/auth/runner.ts`, `src/proxy/providers/codebuddy.ts`
  - **Conflict prediction**: 🟡 MEDIUM — touches codebuddy.ts again, may conflict with user's code
  - NOTE: Creates a `.py.bak` file — consider if this should be gitignored
  - After apply: build verify + push

  **Must NOT do**:
  - Do NOT lose user's IDE headers in codebuddy.ts

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Blocks**: Final verification
  - **Blocked By**: Task 22

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0
  - [ ] `grep -q "buildCodeBuddyBaseHeaders" src/proxy/providers/codebuddy.ts` → found

  **QA Scenarios**:
  ```
  Scenario: Final cherry-pick builds clean
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
      3. grep "buildCodeBuddyBaseHeaders" src/proxy/providers/codebuddy.ts → found
      4. grep "x-stainless-lang" src/proxy/providers/codebuddy.ts → found
    Expected Result: All builds pass, user code intact
    Evidence: .sisyphus/evidence/task-23-build.txt
  ```

  **Commit**: YES
  - Message: `fix : budi kntl`

---

## Final Verification Wave

- [ ] F1. Final build + user code integrity check

  **What to do**:
  - Run full build: `tsc --noEmit` + `bun run build`
  - Verify ALL user's custom features still work:
    - Tunnel feature files exist (15 files in `src/lib/tunnel/`)
    - Email provider filter page exists
    - China moderation bypass rules present in `src/proxy/filters.ts`
    - Windows path fixes in scripts
    - IDE headers in codebuddy.ts
  - Verify branch is pushed to origin
  - Report final status

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` exits 0
  - [ ] `bun run build` exits 0
  - [ ] All 15 tunnel files present
  - [ ] `grep -q "buildCodeBuddyBaseHeaders" src/proxy/providers/codebuddy.ts`
  - [ ] `grep -q "China" src/proxy/filters.ts`
  - [ ] `test -f dashboard/src/pages/EmailProviderFilter.tsx`
  - [ ] `test -f dashboard/src/pages/Tunnel.tsx`
  - [ ] `git log --oneline sync-upstream | wc -l` shows all commits present

  **QA Scenarios**:
  ```
  Scenario: Complete integrity verification
    Tool: Bash
    Steps:
      1. bunx tsc --noEmit → exit code 0
      2. cd dashboard && bun run build → exit code 0
      3. test -d src/lib/tunnel → exit code 0
      4. grep "buildCodeBuddyBaseHeaders" src/proxy/providers/codebuddy.ts → found
      5. grep "China" src/proxy/filters.ts → found
      6. test -f dashboard/src/pages/EmailProviderFilter.tsx → exit code 0
      7. test -f dashboard/src/pages/Tunnel.tsx → exit code 0
      8. git log --oneline | head -5 → shows latest cherry-picks
    Expected Result: Everything intact, all builds pass
    Evidence: .sisyphus/evidence/final-verification.txt
  ```

---

## Commit Strategy

Each cherry-pick preserves the original commit message from upstream. Push after each successful cherry-pick:
```bash
git push origin sync-upstream
```

---

## Success Criteria

### Verification Commands
```bash
bunx tsc --noEmit          # Expected: exit 0
cd dashboard && bun run build  # Expected: exit 0, dist/ generated
git log --oneline sync-upstream | wc -l  # Expected: 30+ commits (7 yours + 22 cherry-picks)
grep "buildCodeBuddyBaseHeaders" src/proxy/providers/codebuddy.ts  # Expected: found
grep "x-stainless-lang" src/proxy/providers/codebuddy.ts  # Expected: found
test -d src/lib/tunnel  # Expected: exit 0
```

### Final Checklist
- [ ] All 22 cherry-picks applied (23 minus 1 skipped merge commit)
- [ ] All builds pass at every step
- [ ] User's 7 custom features preserved
- [ ] Branch `sync-upstream` pushed to origin (Yeyodra/Nova)
- [ ] No `.py.bak` files left untracked (gitignore or remove)

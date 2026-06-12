# Cloudflare Tunnel Implementation for etteum-pool

## TL;DR

> **Quick Summary**: Port 9router's Cloudflare Tunnel system to etteum-pool (TypeScript/Bun/Hono). Supports Quick Tunnel (no account) and Named Tunnel (with token). Includes auto-recovery, health monitoring, and dashboard UI.
> 
> **Deliverables**:
> - Backend tunnel service (download binary, spawn process, manage lifecycle)
> - API endpoints (enable/disable/status)
> - Health endpoint for tunnel probing
> - Dashboard page with real-time status
> - Auto-resume on boot + watchdog + network monitor
> 
> **Estimated Effort**: Medium-Large
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 -> Task 5 -> Task 6 -> Task 7 -> Task 8 -> Task 10 -> F1-F4

---

## Context

### Original Request
User wants to implement Cloudflare Tunnel in etteum-pool, 1:1 replication from 9router reference project at `C:\Users\Nazril\Documents\Projek\Github\9router\src\lib\tunnel\`.

### Interview Summary
**Key Discussions**:
- Tunnel modes: Both Quick Tunnel + Named Tunnel
- Tailscale: EXCLUDED
- Custom domain/registration: EXCLUDED (raw URL only)
- Dashboard: New "Tunnel" page in sidebar TOOLS section
- Auto-recovery: Full (auto-resume, watchdog 60s, network monitor 5s)
- Testing: No unit tests, agent-executed QA only

**Research Findings**:
- 9router tunnel core: 5 files to port (~916 lines JS to TypeScript)
- etteum-pool uses Hono sub-routers, WebSocket broadcast, Bun runtime
- Dashboard: React 19 + Vite + React Router v7 + Tailwind 4 + Radix UI
- Port 1930 = proxy server (tunnel target), Port 1931 = dashboard

### Metis Review
**Identified Gaps** (addressed):
- Named Tunnel trigger: TUNNEL_TOKEN env var presence -> named mode, else quick mode
- Health endpoint missing: Added as Task 4
- Port selection: Tunnel proxies to port 1930 (proxy port)
- Bun.spawn: Use native Bun.spawn() instead of Node child_process
- Worker registration: Completely excluded, no shortId system needed

---

## Work Objectives

### Core Objective
Implement a production-ready Cloudflare Tunnel system in etteum-pool that auto-downloads cloudflared binary, manages tunnel lifecycle, provides API control, and shows real-time status in the dashboard.

### Concrete Deliverables
- `src/lib/tunnel/cloudflared.ts` - Binary download + process management
- `src/lib/tunnel/tunnel-manager.ts` - Lifecycle orchestrator
- `src/lib/tunnel/state.ts` - File-based state persistence
- `src/lib/tunnel/config.ts` - Timing constants
- `src/lib/tunnel/network-probe.ts` - Health/connectivity probing
- `src/api/tunnel.ts` - Hono API routes
- `dashboard/src/pages/Tunnel.tsx` - Dashboard UI page
- Health endpoint at `/api/health`

### Definition of Done
- [ ] `curl POST /api/tunnel/enable` starts cloudflared and returns tunnel URL
- [ ] `curl POST /api/tunnel/disable` kills cloudflared process
- [ ] `curl GET /api/tunnel/status` returns current tunnel state
- [ ] Dashboard shows tunnel status with enable/disable toggle
- [ ] Tunnel auto-resumes after server restart (if was enabled)
- [ ] Tunnel auto-reconnects after unexpected process exit
- [ ] Works on Windows and Linux

### Must Have
- Quick Tunnel mode (no Cloudflare account needed)
- Named Tunnel mode (with TUNNEL_TOKEN env var)
- Binary auto-download from GitHub releases
- Platform detection (win32/linux/darwin)
- PID tracking for process recovery
- Health check probing (DNS + HTTP)
- Cancel token for graceful shutdown
- WebSocket broadcast on state changes
- Auto-resume on server boot
- Watchdog (60s interval) for health monitoring

### Must NOT Have (Guardrails)
- NO Tailscale integration
- NO custom domain/worker registration system
- NO shortId generation or public URL mapping
- NO 9router.com API calls
- NO machine-id dependency (not needed without registration)
- NO over-abstraction - keep it close to 9router's simple patterns
- NO unnecessary dependencies - use Bun built-ins where possible
- NO dashboard over-engineering - simple toggle + status display

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None
- **Framework**: N/A

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **API/Backend**: Use Bash (curl) - Send requests, assert status + response fields
- **Process Management**: Use Bash - Check PID files, process lists, file existence
- **Frontend/UI**: Use Playwright (playwright skill) - Navigate, interact, assert DOM, screenshot

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - all independent, start immediately):
+-- Task 1: Tunnel config + constants [quick]
+-- Task 2: State persistence module [quick]
+-- Task 3: Network probe module [quick]
+-- Task 4: Health API endpoint [quick]
+-- Task 5: Config.ts + env vars update [quick]

Wave 2 (Core - depends on Wave 1):
+-- Task 6: Cloudflared binary manager (depends: 1, 2, 5) [deep]
+-- Task 7: Tunnel manager orchestrator (depends: 1, 2, 3, 5, 6) [deep]
+-- Task 8: API routes (depends: 7) [unspecified-high]
+-- Task 9: Server init + auto-recovery (depends: 7, 4) [unspecified-high]

Wave 3 (UI + Integration - depends on Wave 2):
+-- Task 10: Dashboard Tunnel page (depends: 8) [visual-engineering]
+-- Task 11: WebSocket real-time updates (depends: 7, 8) [quick]
+-- Task 12: Sidebar + routing integration (depends: 10) [quick]

Wave FINAL (After ALL tasks - 4 parallel reviews, then user okay):
+-- Task F1: Plan compliance audit (oracle)
+-- Task F2: Code quality review (unspecified-high)
+-- Task F3: Real manual QA (unspecified-high)
+-- Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: T1 -> T6 -> T7 -> T8 -> T10 -> T12 -> F1-F4 -> user okay
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 5 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | - | 6, 7 | 1 |
| 2 | - | 6, 7 | 1 |
| 3 | - | 7 | 1 |
| 4 | - | 9 | 1 |
| 5 | - | 6, 7, 8 | 1 |
| 6 | 1, 2, 5 | 7 | 2 |
| 7 | 1, 2, 3, 5, 6 | 8, 9, 10, 11 | 2 |
| 8 | 7 | 10, 11 | 2 |
| 9 | 7, 4 | - | 2 |
| 10 | 8 | 12 | 3 |
| 11 | 7, 8 | - | 3 |
| 12 | 10 | - | 3 |

### Agent Dispatch Summary

- **Wave 1**: 5 tasks - T1-T5 all `quick`
- **Wave 2**: 4 tasks - T6 `deep`, T7 `deep`, T8 `unspecified-high`, T9 `unspecified-high`
- **Wave 3**: 3 tasks - T10 `visual-engineering`, T11 `quick`, T12 `quick`
- **FINAL**: 4 tasks - F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. Tunnel Config Constants

  **What to do**:
  - Create `src/lib/tunnel/config.ts` with timing constants
  - Port from 9router's `tunnelConfig.js` (18 lines)
  - Constants: HEALTH_CHECK (intervalMs: 2000, timeoutMs: 180000, fetchTimeoutMs: 5000, dnsTimeoutMs: 2000), INTERNET_CHECK (host: "1.1.1.1", port: 443, timeoutMs: 3000), RESTART_COOLDOWN_MS: 180000, NETWORK_SETTLE_MS: 2500, WATCHDOG_INTERVAL_MS: 60000, NETWORK_CHECK_INTERVAL_MS: 5000
  - Export all as named exports with proper TypeScript types

  **Must NOT do**:
  - Do NOT add Tailscale-related constants
  - Do NOT add registration/worker URL constants

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4, 5)
  - **Blocks**: Tasks 6, 7
  - **Blocked By**: None

  **References**:
  - `C:\Users\Nazril\Documents\Projek\Github\9router\src\lib\tunnel\tunnelConfig.js` - EXACT source to port (18 lines, copy structure 1:1)
  - `src/config.ts` - Follow etteum-pool's TypeScript export pattern

  **Acceptance Criteria**:

  ```
  Scenario: Config module exports correct constants
    Tool: Bash (bun)
    Steps:
      1. Run: bun -e "import { HEALTH_CHECK, INTERNET_CHECK, WATCHDOG_INTERVAL_MS } from './src/lib/tunnel/config'; console.log(JSON.stringify({ HEALTH_CHECK, INTERNET_CHECK, WATCHDOG_INTERVAL_MS }))"
      2. Assert output contains: {"HEALTH_CHECK":{"intervalMs":2000,"timeoutMs":180000,"fetchTimeoutMs":5000,"dnsTimeoutMs":2000},"INTERNET_CHECK":{"host":"1.1.1.1","port":443,"timeoutMs":3000},"WATCHDOG_INTERVAL_MS":60000}
    Expected Result: All constants exported with correct values
    Evidence: .sisyphus/evidence/task-1-config-exports.txt

  Scenario: TypeScript compiles without errors
    Tool: Bash
    Steps:
      1. Run: bunx tsc --noEmit src/lib/tunnel/config.ts
      2. Assert exit code 0
    Expected Result: No type errors
    Evidence: .sisyphus/evidence/task-1-tsc-check.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(tunnel): add foundation modules`
  - Files: `src/lib/tunnel/config.ts`

- [x] 2. State Persistence Module

  **What to do**:
  - Create `src/lib/tunnel/state.ts`
  - Port from 9router's `state.js` (87 lines)
  - State file location: `data/tunnel/state.json`
  - PID file location: `data/tunnel/cloudflared.pid`
  - Functions: loadState(), saveState(state), clearState(), savePid(pid), loadPid(), clearPid()
  - Use Bun's native fs (import from "fs") - same API as Node
  - Auto-create `data/tunnel/` directory if missing
  - Silent error handling (return null on corrupt/missing state)
  - Remove Tailscale PID functions (not needed)
  - Remove generateShortId() (not needed without registration)

  **Must NOT do**:
  - NO Tailscale PID tracking
  - NO shortId generation
  - NO complex state schema - keep it simple: { tunnelUrl, tunnelToken?, mode, enabled }

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4, 5)
  - **Blocks**: Tasks 6, 7
  - **Blocked By**: None

  **References**:
  - `C:\Users\Nazril\Documents\Projek\Github\9router\src\lib\tunnel\state.js` - EXACT source to port (remove Tailscale + shortId parts)
  - `src/config.ts:9` - See how `databasePath` resolves to `data/` directory for consistent path pattern

  **Acceptance Criteria**:

  ```
  Scenario: State persistence round-trip
    Tool: Bash (bun)
    Steps:
      1. Run: bun -e "import { saveState, loadState, clearState } from './src/lib/tunnel/state'; saveState({ tunnelUrl: 'https://test.trycloudflare.com', mode: 'quick', enabled: true }); const s = loadState(); console.log(JSON.stringify(s)); clearState(); console.log(loadState());"
      2. Assert first output: {"tunnelUrl":"https://test.trycloudflare.com","mode":"quick","enabled":true}
      3. Assert second output: null
    Expected Result: Save/load/clear cycle works correctly
    Evidence: .sisyphus/evidence/task-2-state-roundtrip.txt

  Scenario: PID persistence
    Tool: Bash (bun)
    Steps:
      1. Run: bun -e "import { savePid, loadPid, clearPid } from './src/lib/tunnel/state'; savePid(12345); console.log(loadPid()); clearPid(); console.log(loadPid());"
      2. Assert: 12345 then null
    Expected Result: PID save/load/clear works
    Evidence: .sisyphus/evidence/task-2-pid-roundtrip.txt

  Scenario: Handles corrupt state gracefully
    Tool: Bash
    Steps:
      1. Run: mkdir -p data/tunnel && echo "not json" > data/tunnel/state.json
      2. Run: bun -e "import { loadState } from './src/lib/tunnel/state'; console.log(loadState());"
      3. Assert output: null
    Expected Result: Returns null on corrupt state, no crash
    Evidence: .sisyphus/evidence/task-2-corrupt-state.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(tunnel): add foundation modules`
  - Files: `src/lib/tunnel/state.ts`

- [x] 3. Network Probe Module

  **What to do**:
  - Create `src/lib/tunnel/network-probe.ts`
  - Port from 9router's `networkProbe.js` (68 lines)
  - Functions: checkInternet() -> Promise<boolean>, probeUrlAlive(url) -> Promise<boolean>, waitForHealth(url, cancelToken?) -> Promise<boolean>
  - checkInternet: TCP socket to 1.1.1.1:443 with 3s timeout
  - probeUrlAlive: DNS resolve hostname -> fetch `${url}/api/health` with 5s timeout
  - waitForHealth: Poll probeUrlAlive every 2s until success or 180s timeout, cancellable
  - Use Bun's native `net` module for TCP, native `fetch` for HTTP
  - DNS resolver with public DNS (1.1.1.1, 8.8.8.8) to bypass OS cache

  **Must NOT do**:
  - NO complex DNS fallback logic beyond what 9router does
  - NO custom resolver class - keep it simple

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4, 5)
  - **Blocks**: Task 7
  - **Blocked By**: None

  **References**:
  - `C:\Users\Nazril\Documents\Projek\Github\9router\src\lib\tunnel\networkProbe.js` - EXACT source to port (68 lines, full file)
  - `C:\Users\Nazril\Documents\Projek\Github\9router\src\lib\tunnel\tunnelConfig.js` - Timing constants used by probe

  **Acceptance Criteria**:

  ```
  Scenario: Internet check works (machine has internet)
    Tool: Bash (bun)
    Steps:
      1. Run: bun -e "import { checkInternet } from './src/lib/tunnel/network-probe'; checkInternet().then(r => console.log(r));"
      2. Assert output: true (assuming dev machine has internet)
    Expected Result: Returns true when internet available
    Evidence: .sisyphus/evidence/task-3-internet-check.txt

  Scenario: probeUrlAlive returns false for non-existent URL
    Tool: Bash (bun)
    Steps:
      1. Run: bun -e "import { probeUrlAlive } from './src/lib/tunnel/network-probe'; probeUrlAlive('https://nonexistent-xyz-12345.trycloudflare.com').then(r => console.log(r));"
      2. Assert output: false
    Expected Result: Returns false for unreachable URL
    Evidence: .sisyphus/evidence/task-3-probe-unreachable.txt

  Scenario: waitForHealth respects cancel token
    Tool: Bash (bun)
    Steps:
      1. Run: bun -e "import { waitForHealth } from './src/lib/tunnel/network-probe'; const token = { cancelled: false }; setTimeout(() => { token.cancelled = true; }, 500); waitForHealth('https://nonexistent.test', token).catch(e => console.log(e.message));"
      2. Assert output contains: "cancelled"
    Expected Result: Throws on cancellation
    Evidence: .sisyphus/evidence/task-3-cancel-token.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(tunnel): add foundation modules`
  - Files: `src/lib/tunnel/network-probe.ts`

- [x] 4. Health API Endpoint

  **What to do**:
  - Create `src/api/health.ts` with a simple Hono router
  - Single endpoint: `GET /api/health` returns `{ status: "ok", timestamp: Date.now() }`
  - NO auth required (tunnel probe needs to hit this without Bearer token)
  - Mount in `src/index.ts` BEFORE the auth middleware (so it's public)
  - This is what the tunnel's health probe will check to verify the server is reachable

  **Must NOT do**:
  - NO complex health checks (DB, services, etc.) - just a simple "alive" response
  - NO auth on this endpoint

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 5)
  - **Blocks**: Task 9
  - **Blocked By**: None

  **References**:
  - `src/index.ts:74-90` - See how auth middleware is applied to `/v1/*` and `/api/*`. Health must be mounted BEFORE or excluded from auth
  - `src/api/index.ts` - See how sub-routers are mounted

  **Acceptance Criteria**:

  ```
  Scenario: Health endpoint returns OK without auth
    Tool: Bash (curl)
    Steps:
      1. Ensure server is running on port 1930
      2. Run: curl -s http://localhost:1930/api/health
      3. Assert response contains: {"status":"ok"
      4. Assert HTTP status: 200
    Expected Result: Returns 200 with status ok, no auth needed
    Evidence: .sisyphus/evidence/task-4-health-no-auth.txt

  Scenario: Health endpoint accessible from external (tunnel probe simulation)
    Tool: Bash (curl)
    Steps:
      1. Run: curl -s -o /dev/null -w "%{http_code}" http://localhost:1930/api/health
      2. Assert: 200
    Expected Result: Public endpoint, no 401/403
    Evidence: .sisyphus/evidence/task-4-health-public.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(tunnel): add foundation modules`
  - Files: `src/api/health.ts`, `src/index.ts` (mount)

- [x] 5. Config.ts + Environment Variables Update

  **What to do**:
  - Add tunnel-related config to `src/config.ts`:
    - `tunnelEnabled`: `process.env.TUNNEL_ENABLED === "true"` (default false)
    - `tunnelToken`: `process.env.TUNNEL_TOKEN || ""` (empty = quick mode, set = named mode)
    - `tunnelProtocol`: `process.env.TUNNEL_PROTOCOL || "http2"` (http2/quic/auto)
  - Update `.env.example` with new tunnel vars (commented out):
    ```
    # Cloudflare Tunnel
    # TUNNEL_ENABLED=false
    # TUNNEL_TOKEN=          # Leave empty for Quick Tunnel, set for Named Tunnel
    # TUNNEL_PROTOCOL=http2  # http2, quic, or auto
    ```

  **Must NOT do**:
  - NO Tailscale config vars
  - NO worker/registration URL vars
  - NO breaking changes to existing config

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3, 4)
  - **Blocks**: Tasks 6, 7, 8
  - **Blocked By**: None

  **References**:
  - `src/config.ts` - FULL FILE (46 lines). Add tunnel fields to the config object following same pattern
  - `.env.example` - Add tunnel section at the bottom

  **Acceptance Criteria**:

  ```
  Scenario: Config reads tunnel env vars
    Tool: Bash (bun)
    Steps:
      1. Run: TUNNEL_ENABLED=true TUNNEL_TOKEN=test123 bun -e "import { config } from './src/config'; console.log(config.tunnelEnabled, config.tunnelToken);"
      2. Assert output: true test123
    Expected Result: Config correctly reads env vars
    Evidence: .sisyphus/evidence/task-5-config-env.txt

  Scenario: Config defaults when env vars not set
    Tool: Bash (bun)
    Steps:
      1. Run: bun -e "import { config } from './src/config'; console.log(config.tunnelEnabled, config.tunnelToken, config.tunnelProtocol);"
      2. Assert output: false  http2
    Expected Result: Defaults are false, empty string, http2
    Evidence: .sisyphus/evidence/task-5-config-defaults.txt
  ```

  **Commit**: YES (groups with Wave 1)
  - Message: `feat(tunnel): add foundation modules`
  - Files: `src/config.ts`, `.env.example`

- [x] 6. Cloudflared Binary Manager

  **What to do**:
  - Create `src/lib/tunnel/cloudflared.ts` (~200 lines)
  - Port from 9router's `cloudflared.js` (435 lines, minus tailscale/registration parts)
  - **Binary download**: Auto-download from `https://github.com/cloudflare/cloudflared/releases/latest/download/`
  - **Platform mappings**: darwin (x64/arm64 .tgz), win32 (x64/arm64 .exe), linux (x64/arm64 binary)
  - **Binary validation**: Check magic bytes (MZ for PE, ELF for Linux, Mach-O for macOS), min size 1MB
  - **Download state**: Export `getDownloadStatus()` -> { downloading: boolean, progress: number }
  - **ensureCloudflared()**: Download if missing/invalid, extract .tgz on macOS, chmod on unix
  - **spawnQuickTunnel(localPort, onUrlUpdate)**: Spawn `cloudflared tunnel --url http://127.0.0.1:PORT --no-autoupdate`, extract URL from logs via regex
  - **spawnNamedTunnel(token)**: Spawn `cloudflared tunnel run --token TOKEN`, wait for 4x "Registered tunnel connection"
  - **killCloudflared(localPort)**: Kill process ref + PID file + platform-specific port-based kill
  - **isCloudflaredRunning()**: Check PID with process.kill(pid, 0)
  - **setUnexpectedExitHandler(handler)**: Register callback for auto-reconnect
  - Use `Bun.spawn()` for process management
  - Temp config dir to avoid conflicts with user's ~/.cloudflared/
  - URL regex: `https://([a-z0-9-]+)\.trycloudflare\.com` (skip "api" subdomain)
  - 90s timeout for tunnel connection

  **Must NOT do**:
  - NO registration calls after URL found
  - NO shortId handling
  - NO Tailscale-related code

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex process management, platform-specific logic, binary handling, multiple spawn modes
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential within Wave 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 1, 2, 5

  **References**:
  - `C:\Users\Nazril\Documents\Projek\Github\9router\src\lib\tunnel\cloudflared.js` - PRIMARY reference (435 lines). Port lines 1-435, adapting to TypeScript + Bun.spawn
  - `C:\Users\Nazril\Documents\Projek\Github\9router\src\lib\tunnel\state.js` - How PID is saved/loaded (used by cloudflared.ts)
  - `src/lib/tunnel/config.ts` (Task 1 output) - Import timing constants
  - `src/lib/tunnel/state.ts` (Task 2 output) - Import savePid/loadPid/clearPid

  **Acceptance Criteria**:

  ```
  Scenario: Binary download and validation (first run)
    Tool: Bash (bun)
    Preconditions: No cloudflared binary in data/bin/
    Steps:
      1. Run: bun -e "import { ensureCloudflared } from './src/lib/tunnel/cloudflared'; ensureCloudflared().then(p => console.log('binary at:', p));"
      2. Assert output contains: "binary at: " followed by a path
      3. Verify file exists at that path
      4. Verify file size > 1MB
    Expected Result: Binary downloaded and validated
    Evidence: .sisyphus/evidence/task-6-binary-download.txt

  Scenario: Quick tunnel spawns and returns URL
    Tool: Bash (bun)
    Preconditions: Binary exists, internet available
    Steps:
      1. Run: bun -e "import { spawnQuickTunnel } from './src/lib/tunnel/cloudflared'; spawnQuickTunnel(1930, (url) => console.log('URL changed:', url)).then(r => { console.log('URL:', r.tunnelUrl); r.child.kill(); });"
      2. Assert output contains: "URL: https://" and ".trycloudflare.com"
      3. Wait up to 90s for URL to appear
    Expected Result: Quick tunnel spawns and extracts URL from logs
    Failure Indicators: Timeout after 90s, or "cloudflared exited with code"
    Evidence: .sisyphus/evidence/task-6-quick-tunnel-spawn.txt

  Scenario: Kill cloudflared cleans up properly
    Tool: Bash (bun)
    Steps:
      1. Spawn a quick tunnel
      2. Call killCloudflared(1930)
      3. Assert isCloudflaredRunning() returns false
      4. Assert PID file is removed
    Expected Result: Process killed, PID cleaned
    Evidence: .sisyphus/evidence/task-6-kill-cleanup.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(tunnel): implement cloudflared manager and API`
  - Files: `src/lib/tunnel/cloudflared.ts`

- [x] 7. Tunnel Manager Orchestrator

  **What to do**:
  - Create `src/lib/tunnel/tunnel-manager.ts` (~180 lines)
  - Port from 9router's `tunnelManager.js` (308 lines, minus Tailscale + registration)
  - **Service state**: `tunnelSvc = { cancelToken, spawnInProgress, lastRestartAt, activeLocalPort }`
  - **Reachable cache**: Background probe with 30s TTL, never blocks API requests
  - **enableTunnel(localPort)**: 
    1. Check if already running + reachable -> return existing
    2. Kill existing cloudflared
    3. If config.tunnelToken -> spawnNamedTunnel(token), else spawnQuickTunnel(port, onUrlUpdate)
    4. Wait for health check on tunnel URL
    5. Save state, broadcast via WebSocket
    6. Return { success, tunnelUrl, mode }
  - **disableTunnel()**:
    1. Set cancelToken.cancelled = true
    2. Kill cloudflared
    3. Clear state, broadcast via WebSocket
    4. Return { success: true }
  - **getTunnelStatus()**:
    1. Read state + check process running + check reachable cache
    2. Return { enabled, tunnelUrl, running, reachable, mode, downloading }
  - **Cancel token pattern**: throwIfCancelled(token, label) for graceful abort
  - **Unexpected exit handler**: Register with cloudflared for auto-reconnect trigger
  - Import broadcast from ws/index for real-time updates

  **Must NOT do**:
  - NO Tailscale service state or functions
  - NO registerTunnelUrl() calls
  - NO shortId/publicUrl generation
  - NO machine-id usage

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Complex orchestration logic, state management, async flows, error recovery
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 6)
  - **Parallel Group**: Wave 2 (after Task 6)
  - **Blocks**: Tasks 8, 9, 10, 11
  - **Blocked By**: Tasks 1, 2, 3, 5, 6

  **References**:
  - `C:\Users\Nazril\Documents\Projek\Github\9router\src\lib\tunnel\tunnelManager.js` - PRIMARY reference (lines 1-188, Cloudflare section only). Skip lines 190-308 (Tailscale)
  - `src/lib/tunnel/cloudflared.ts` (Task 6 output) - Import spawn/kill/status functions
  - `src/lib/tunnel/state.ts` (Task 2 output) - Import loadState/saveState
  - `src/lib/tunnel/network-probe.ts` (Task 3 output) - Import waitForHealth/probeUrlAlive
  - `src/lib/tunnel/config.ts` (Task 1 output) - Import timing constants
  - `src/ws/index.ts` - Import broadcast() for real-time WebSocket updates
  - `src/config.ts` (Task 5 output) - Import config for tunnelToken/tunnelEnabled

  **Acceptance Criteria**:

  ```
  Scenario: Enable quick tunnel end-to-end
    Tool: Bash (bun)
    Preconditions: Server running, internet available, no tunnel active
    Steps:
      1. Run: bun -e "import { enableTunnel } from './src/lib/tunnel/tunnel-manager'; enableTunnel(1930).then(r => console.log(JSON.stringify(r)));"
      2. Assert output contains: "success":true
      3. Assert output contains: "tunnelUrl":"https://"
      4. Assert output contains: "mode":"quick"
    Expected Result: Tunnel enabled, URL returned
    Failure Indicators: Error thrown, timeout, no URL
    Evidence: .sisyphus/evidence/task-7-enable-quick.txt

  Scenario: Disable tunnel cleans up
    Tool: Bash (bun)
    Steps:
      1. Enable tunnel first
      2. Run: bun -e "import { disableTunnel } from './src/lib/tunnel/tunnel-manager'; disableTunnel().then(r => console.log(JSON.stringify(r)));"
      3. Assert: {"success":true}
      4. Verify no cloudflared process running
    Expected Result: Tunnel disabled, process killed
    Evidence: .sisyphus/evidence/task-7-disable.txt

  Scenario: getTunnelStatus returns correct state
    Tool: Bash (bun)
    Steps:
      1. With tunnel disabled: call getTunnelStatus()
      2. Assert: enabled=false, running=false
      3. Enable tunnel, call getTunnelStatus()
      4. Assert: enabled=true, running=true, tunnelUrl starts with https://
    Expected Result: Status accurately reflects tunnel state
    Evidence: .sisyphus/evidence/task-7-status.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(tunnel): implement cloudflared manager and API`
  - Files: `src/lib/tunnel/tunnel-manager.ts`

- [x] 8. Tunnel API Routes

  **What to do**:
  - Create `src/api/tunnel.ts` with Hono sub-router
  - 3 endpoints matching 9router's pattern:
    - `GET /status` - Call getTunnelStatus() + getDownloadStatus(), return combined JSON
    - `POST /enable` - Call enableTunnel(config.port), return result. Add DNS warmup delay (8s) after enable for quick tunnel
    - `POST /disable` - Call disableTunnel(), return result
  - Mount in `src/api/index.ts` as `apiRouter.route("/tunnel", tunnelRouter)`
  - All endpoints protected by existing auth middleware (they're under /api/*)
  - Error handling: try/catch, return { error: message } with 500 status

  **Must NOT do**:
  - NO Tailscale endpoints (tailscale-check, tailscale-enable, etc.)
  - NO SSE streaming endpoints
  - NO custom auth - rely on existing middleware

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: API integration requires understanding Hono patterns and proper error handling
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Task 7 completes)
  - **Parallel Group**: Wave 2 (with Task 9, after Task 7)
  - **Blocks**: Tasks 10, 11
  - **Blocked By**: Task 7

  **References**:
  - `C:\Users\Nazril\Documents\Projek\Github\9router\src\app\api\tunnel\status\route.js` - Response shape pattern: `{ tunnel: {...}, download: {...} }`
  - `C:\Users\Nazril\Documents\Projek\Github\9router\src\app\api\tunnel\enable\route.js` - DNS_WARMUP_DELAY_MS = 8000 pattern
  - `C:\Users\Nazril\Documents\Projek\Github\9router\src\app\api\tunnel\disable\route.js` - Simple disable pattern
  - `src/api/accounts.ts` - Follow etteum-pool's Hono route handler pattern (import Hono, export router, c.json())
  - `src/api/index.ts` - Where to mount the new router

  **Acceptance Criteria**:

  ```
  Scenario: GET /api/tunnel/status returns status
    Tool: Bash (curl)
    Preconditions: Server running on port 1930
    Steps:
      1. Run: curl -s -H "Authorization: Bearer $API_KEY" http://localhost:1930/api/tunnel/status
      2. Assert response contains: "enabled"
      3. Assert response contains: "running"
      4. Assert response contains: "download"
      5. Assert HTTP status: 200
    Expected Result: Returns tunnel status JSON with all fields
    Evidence: .sisyphus/evidence/task-8-status-endpoint.txt

  Scenario: POST /api/tunnel/enable starts tunnel
    Tool: Bash (curl)
    Preconditions: Server running, no tunnel active
    Steps:
      1. Run: curl -s -X POST -H "Authorization: Bearer $API_KEY" http://localhost:1930/api/tunnel/enable
      2. Assert response contains: "success":true
      3. Assert response contains: "tunnelUrl"
      4. Wait 10s for DNS warmup
      5. Run: curl -s -H "Authorization: Bearer $API_KEY" http://localhost:1930/api/tunnel/status
      6. Assert: "enabled":true, "running":true
    Expected Result: Tunnel enabled via API, status reflects it
    Evidence: .sisyphus/evidence/task-8-enable-endpoint.txt

  Scenario: POST /api/tunnel/disable stops tunnel
    Tool: Bash (curl)
    Steps:
      1. Ensure tunnel is enabled first
      2. Run: curl -s -X POST -H "Authorization: Bearer $API_KEY" http://localhost:1930/api/tunnel/disable
      3. Assert response: {"success":true}
      4. Run: curl -s -H "Authorization: Bearer $API_KEY" http://localhost:1930/api/tunnel/status
      5. Assert: "enabled":false, "running":false
    Expected Result: Tunnel disabled, status updated
    Evidence: .sisyphus/evidence/task-8-disable-endpoint.txt

  Scenario: Endpoints require auth
    Tool: Bash (curl)
    Steps:
      1. Run: curl -s -o /dev/null -w "%{http_code}" http://localhost:1930/api/tunnel/status
      2. Assert: 401 or 403
    Expected Result: Unauthorized without Bearer token
    Evidence: .sisyphus/evidence/task-8-auth-required.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(tunnel): implement cloudflared manager and API`
  - Files: `src/api/tunnel.ts`, `src/api/index.ts` (mount)

- [x] 9. Server Init + Auto-Recovery

  **What to do**:
  - Add tunnel initialization to `src/index.ts` startup sequence (after DB migrations, before Bun.serve)
  - **Auto-resume**: If state file has `enabled: true`, call enableTunnel(config.port) on boot
  - **Watchdog**: setInterval every 60s - check if tunnel should be running but isn't, restart if needed
  - **Network monitor**: setInterval every 5s - check internet connectivity, re-enable tunnel after network recovery
  - **Restart cooldown**: 180s minimum between restarts (prevent rapid restart loops)
  - **Unexpected exit handler**: Register with cloudflared to trigger watchdog restart
  - Port from 9router's `initializeApp.js` tunnel section (lines 56-60 for auto-resume, lines 80-90 for watchdog/network monitor)
  - Create `src/lib/tunnel/watchdog.ts` for watchdog + network monitor logic (keep index.ts clean)

  **Must NOT do**:
  - NO Tailscale auto-resume
  - NO blocking server startup - tunnel init should be fire-and-forget (don't await)
  - NO crashing server if tunnel fails to start

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Server lifecycle integration, async initialization, interval management
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 8, after Task 7)
  - **Parallel Group**: Wave 2 (with Task 8)
  - **Blocks**: None
  - **Blocked By**: Tasks 7, 4

  **References**:
  - `C:\Users\Nazril\Documents\Projek\Github\9router\src\shared\services\initializeApp.js` - Lines 56-60 (auto-resume), lines 80-90 (watchdog/network monitor start)
  - `C:\Users\Nazril\Documents\Projek\Github\9router\src\lib\tunnel\tunnelConfig.js` - WATCHDOG_INTERVAL_MS, NETWORK_CHECK_INTERVAL_MS, RESTART_COOLDOWN_MS
  - `src/index.ts:21-64` - Current startup sequence (migrations, seeds, warmup). Add tunnel init after line 64
  - `src/lib/tunnel/tunnel-manager.ts` (Task 7 output) - Import enableTunnel, getTunnelStatus
  - `src/lib/tunnel/state.ts` (Task 2 output) - Import loadState to check if tunnel was enabled
  - `src/lib/tunnel/network-probe.ts` (Task 3 output) - Import checkInternet for network monitor

  **Acceptance Criteria**:

  ```
  Scenario: Auto-resume on boot when tunnel was enabled
    Tool: Bash
    Preconditions: Tunnel was previously enabled (state.json has enabled: true)
    Steps:
      1. Save state: echo '{"tunnelUrl":"https://old.trycloudflare.com","mode":"quick","enabled":true}' > data/tunnel/state.json
      2. Start server: bun run src/index.ts &
      3. Wait 15s for startup + tunnel spawn
      4. Run: curl -s -H "Authorization: Bearer $API_KEY" http://localhost:1930/api/tunnel/status
      5. Assert: "enabled":true, "running":true
    Expected Result: Tunnel auto-resumed on boot
    Evidence: .sisyphus/evidence/task-9-auto-resume.txt

  Scenario: Server starts even if tunnel fails
    Tool: Bash
    Preconditions: No internet (or mock failure)
    Steps:
      1. Start server with tunnel state enabled
      2. Verify server responds on port 1930 (curl /api/health)
      3. Assert: server is up even if tunnel failed
    Expected Result: Tunnel failure doesn't crash server
    Evidence: .sisyphus/evidence/task-9-graceful-failure.txt

  Scenario: Watchdog restarts tunnel after process kill
    Tool: Bash
    Steps:
      1. Enable tunnel via API
      2. Kill cloudflared process externally: taskkill /F /IM cloudflared.exe (Windows) or kill $(cat data/tunnel/cloudflared.pid)
      3. Wait 70s (watchdog interval + buffer)
      4. Check tunnel status
      5. Assert: tunnel is running again (watchdog restarted it)
    Expected Result: Watchdog detects dead process and restarts
    Evidence: .sisyphus/evidence/task-9-watchdog-restart.txt
  ```

  **Commit**: YES (groups with Wave 2)
  - Message: `feat(tunnel): implement cloudflared manager and API`
  - Files: `src/lib/tunnel/watchdog.ts`, `src/index.ts` (init)

- [x] 10. Dashboard Tunnel Page

  **What to do**:
  - Create `dashboard/src/pages/Tunnel.tsx` - Full tunnel management page
  - **Layout**: Card-based layout matching existing dashboard style
  - **Status section**: Show tunnel status (enabled/disabled), URL (copyable), mode (quick/named), reachable indicator
  - **Controls**: Enable/Disable toggle button with loading state
  - **Download progress**: Show cloudflared download progress bar when downloading
  - **URL display**: Show tunnel URL with copy-to-clipboard button
  - **Status indicators**: Green dot = running + reachable, Yellow = running but not reachable, Red = stopped
  - **Auto-refresh**: Poll `/api/tunnel/status` every 5s while page is open (or use WebSocket from Task 11)
  - Use existing `fetchApi()` from `dashboard/src/lib/api.ts` for API calls
  - Use existing Tailwind 4 + Radix UI patterns from other pages
  - Follow the same page structure as `dashboard/src/pages/Settings.tsx`

  **Must NOT do**:
  - NO Tailscale UI section
  - NO complex settings form - just toggle + status
  - NO custom domain/shortId display
  - NO over-designed UI - match existing dashboard aesthetic

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Frontend UI page with status indicators, animations, responsive layout
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (after Task 8)
  - **Parallel Group**: Wave 3 (with Tasks 11, 12)
  - **Blocks**: Task 12
  - **Blocked By**: Task 8

  **References**:
  - `dashboard/src/pages/Settings.tsx` - Page structure pattern (card layout, form controls, save/load)
  - `dashboard/src/pages/Integration.tsx` - Another TOOLS page for reference
  - `dashboard/src/lib/api.ts` - fetchApi() utility for backend calls
  - `dashboard/src/hooks/useApi.ts` - Data fetching hook pattern (loading/error/refetch)
  - `dashboard/src/hooks/useWebSocket.tsx` - WebSocket subscription for real-time updates
  - `C:\Users\Nazril\Documents\Projek\Github\9router\src\app\api\tunnel\status\route.js` - Response shape to consume: { tunnel: { enabled, tunnelUrl, running, reachable, mode }, download: { downloading, progress } }

  **Acceptance Criteria**:

  ```
  Scenario: Tunnel page renders with status
    Tool: Playwright
    Preconditions: Server running, dashboard accessible at localhost:1931
    Steps:
      1. Navigate to http://localhost:1931/tunnel
      2. Wait for page load (selector: h1 or h2 containing "Tunnel")
      3. Assert: Page title visible
      4. Assert: Enable/Disable button visible
      5. Assert: Status indicator visible (red dot when disabled)
      6. Screenshot
    Expected Result: Tunnel page renders correctly with all UI elements
    Evidence: .sisyphus/evidence/task-10-page-render.png

  Scenario: Enable tunnel from dashboard
    Tool: Playwright
    Steps:
      1. Navigate to /tunnel
      2. Click Enable button
      3. Wait for loading state (button shows spinner/loading)
      4. Wait up to 30s for tunnel URL to appear
      5. Assert: Tunnel URL displayed (contains "trycloudflare.com")
      6. Assert: Status indicator turns green
      7. Assert: Copy button visible next to URL
      8. Screenshot
    Expected Result: Tunnel enabled via UI, URL shown
    Evidence: .sisyphus/evidence/task-10-enable-ui.png

  Scenario: Disable tunnel from dashboard
    Tool: Playwright
    Steps:
      1. With tunnel enabled, navigate to /tunnel
      2. Click Disable button
      3. Wait for status to update
      4. Assert: Status indicator turns red
      5. Assert: Tunnel URL no longer displayed
      6. Screenshot
    Expected Result: Tunnel disabled via UI
    Evidence: .sisyphus/evidence/task-10-disable-ui.png

  Scenario: Download progress shown
    Tool: Playwright
    Preconditions: Delete cloudflared binary first to trigger download
    Steps:
      1. Navigate to /tunnel
      2. Click Enable (triggers download)
      3. Assert: Progress bar or download indicator visible
      4. Wait for download to complete
      5. Screenshot during download
    Expected Result: Download progress visible to user
    Evidence: .sisyphus/evidence/task-10-download-progress.png
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(tunnel): add dashboard UI and real-time updates`
  - Files: `dashboard/src/pages/Tunnel.tsx`

- [x] 11. WebSocket Real-Time Updates

  **What to do**:
  - Add tunnel-specific WebSocket broadcast events in tunnel-manager.ts
  - Broadcast on state changes:
    - `{ type: "tunnel:status", data: { enabled, tunnelUrl, running, reachable, mode } }` - on enable/disable/status change
    - `{ type: "tunnel:download", data: { downloading, progress } }` - on download progress
  - Update Tunnel.tsx to subscribe to WebSocket events via `useWebSocket()` hook
  - On receiving `tunnel:status` event, update UI without polling
  - On receiving `tunnel:download` event, update download progress bar
  - Keep polling as fallback (5s interval) in case WebSocket disconnects

  **Must NOT do**:
  - NO new WebSocket server - use existing broadcast() from src/ws/index.ts
  - NO breaking existing WebSocket events

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small integration - add broadcast calls + subscribe in frontend
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 10, 12)
  - **Blocks**: None
  - **Blocked By**: Tasks 7, 8

  **References**:
  - `src/ws/index.ts` - broadcast() function signature and usage pattern
  - `dashboard/src/hooks/useWebSocket.tsx` - How to subscribe to specific event types
  - `src/lib/tunnel/tunnel-manager.ts` (Task 7 output) - Where to add broadcast() calls

  **Acceptance Criteria**:

  ```
  Scenario: WebSocket broadcasts tunnel status on enable
    Tool: Bash (bun)
    Steps:
      1. Connect WebSocket to ws://localhost:1930/ws
      2. Enable tunnel via API (curl POST /api/tunnel/enable)
      3. Assert: WebSocket receives message with type "tunnel:status"
      4. Assert: Message data contains "enabled":true and "tunnelUrl"
    Expected Result: Real-time update sent on tunnel enable
    Evidence: .sisyphus/evidence/task-11-ws-enable.txt

  Scenario: WebSocket broadcasts on disable
    Tool: Bash (bun)
    Steps:
      1. Connect WebSocket, enable tunnel
      2. Disable tunnel via API
      3. Assert: WebSocket receives "tunnel:status" with "enabled":false
    Expected Result: Real-time update sent on tunnel disable
    Evidence: .sisyphus/evidence/task-11-ws-disable.txt
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(tunnel): add dashboard UI and real-time updates`
  - Files: `src/lib/tunnel/tunnel-manager.ts` (add broadcasts), `dashboard/src/pages/Tunnel.tsx` (add WS subscription)

- [x] 12. Sidebar + Routing Integration

  **What to do**:
  - Add Tunnel page to dashboard routing in `dashboard/src/App.tsx`:
    - `const Tunnel = lazy(() => import("./pages/Tunnel"));`
    - `<Route path="/tunnel" element={<Tunnel />} />`
  - Add Tunnel nav item to sidebar in `dashboard/src/components/layout/Sidebar.tsx`:
    - Add to TOOLS section: `{ label: "Tunnel", path: "/tunnel", icon: Globe }` (use Globe or Cloud icon from lucide-react)
    - Place after "Integration" in the TOOLS section

  **Must NOT do**:
  - NO new sidebar section - add to existing TOOLS
  - NO changes to other routes or nav items

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Two small edits to existing files
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (needs Task 10 page to exist)
  - **Parallel Group**: Wave 3 (after Task 10)
  - **Blocks**: None
  - **Blocked By**: Task 10

  **References**:
  - `dashboard/src/App.tsx` - See existing lazy() + Route pattern for other pages
  - `dashboard/src/components/layout/Sidebar.tsx` - See navSections array structure, TOOLS section items

  **Acceptance Criteria**:

  ```
  Scenario: Tunnel appears in sidebar
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:1931/
      2. Assert: Sidebar contains "Tunnel" link under TOOLS section
      3. Assert: Tunnel icon visible (Globe or Cloud)
      4. Screenshot sidebar
    Expected Result: Tunnel nav item visible in correct section
    Evidence: .sisyphus/evidence/task-12-sidebar.png

  Scenario: Clicking Tunnel navigates to page
    Tool: Playwright
    Steps:
      1. Navigate to http://localhost:1931/
      2. Click "Tunnel" in sidebar
      3. Assert: URL changes to /tunnel
      4. Assert: Tunnel page content loads (h1/h2 with "Tunnel")
      5. Screenshot
    Expected Result: Navigation works, page loads
    Evidence: .sisyphus/evidence/task-12-navigation.png
  ```

  **Commit**: YES (groups with Wave 3)
  - Message: `feat(tunnel): add dashboard UI and real-time updates`
  - Files: `dashboard/src/App.tsx`, `dashboard/src/components/layout/Sidebar.tsx`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [x] F1. **Plan Compliance Audit** - `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns - reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** - `unspecified-high`
  Run `bunx tsc --noEmit`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log spam, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names. Verify TypeScript types are proper (no `any` escape hatches).
  Output: `Build [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** - `unspecified-high` (+ `playwright` skill for UI)
  Start from clean state. Execute EVERY QA scenario from EVERY task - follow exact steps, capture evidence. Test cross-task integration (enable tunnel -> check dashboard -> disable -> verify cleanup). Test edge cases: enable when already enabled, disable when already disabled, kill process externally.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** - `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 - everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Wave | Commit Message | Files |
|------|---------------|-------|
| 1 | `feat(tunnel): add foundation modules (config, state, probe)` | src/lib/tunnel/config.ts, state.ts, network-probe.ts, src/api/health.ts, src/config.ts |
| 2 | `feat(tunnel): implement cloudflared manager and API` | src/lib/tunnel/cloudflared.ts, tunnel-manager.ts, src/api/tunnel.ts, src/index.ts |
| 3 | `feat(tunnel): add dashboard UI and real-time updates` | dashboard/src/pages/Tunnel.tsx, Sidebar.tsx, App.tsx, src/ws/ |

---

## Success Criteria

### Verification Commands
```bash
# Start server
bun run src/index.ts

# Enable quick tunnel
curl -X POST http://localhost:1930/api/tunnel/enable -H "Authorization: Bearer $API_KEY"
# Expected: {"success":true,"tunnelUrl":"https://xxx.trycloudflare.com","mode":"quick"}

# Check status
curl http://localhost:1930/api/tunnel/status -H "Authorization: Bearer $API_KEY"
# Expected: {"enabled":true,"running":true,"tunnelUrl":"https://...","mode":"quick","reachable":true}

# Disable tunnel
curl -X POST http://localhost:1930/api/tunnel/disable -H "Authorization: Bearer $API_KEY"
# Expected: {"success":true}

# Health endpoint (used by tunnel probe)
curl http://localhost:1930/api/health
# Expected: {"status":"ok"}
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] Tunnel works on Windows (dev machine)
- [ ] Dashboard accessible and functional
- [ ] Auto-recovery works after process kill

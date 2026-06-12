## 2026-06-13 Task 0: Setup Baseline

- Branch `sync-upstream` created from `f5780c9` (main HEAD)
- `tsc --noEmit` has PRE-EXISTING errors (NOT blockers):
  - `scripts/sync-filter-rules.ts` - 7 errors (rule possibly undefined)
  - `src/lib/tunnel/cloudflared.ts` - 1 error (string|undefined vs string|null)
  - These are from user's custom commits and exist BEFORE any cherry-picks
  - Decision: Use `bun run build` (dashboard) as the primary build gate, NOT `tsc --noEmit`
- Dashboard `bun run build` passes cleanly (exit 0)
- Remote origin = https://github.com/Yeyodra/Nova.git
- Remote upstream = https://github.com/priyo000/etteum-pool.git
- Branch pushed to origin successfully

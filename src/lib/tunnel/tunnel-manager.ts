import { loadState, saveState, clearState, type TunnelState } from "./state";
import { spawnQuickTunnel, spawnNamedTunnel, killCloudflared, isCloudflaredRunning, setUnexpectedExitHandler, getDownloadStatus } from "./cloudflared";
import { waitForHealth, probeUrlAlive } from "./network-probe";
import { config } from "../../config";
import { broadcast } from "../../ws/index";

// Per-service state
const tunnelSvc = {
  cancelToken: { cancelled: false },
  spawnInProgress: false,
  lastRestartAt: 0,
  activeLocalPort: 0,
};

export function isTunnelManuallyDisabled(): boolean { return tunnelSvc.cancelToken.cancelled; }
export function isTunnelReconnecting(): boolean { return tunnelSvc.spawnInProgress; }

// ─── Reachable cache: background probe of tunnel URL /api/health ─────────────
const REACHABLE_TTL_MS = 30000;
const tunnelReachable = { value: false, url: null as string | null, fetchedAt: 0, refreshing: false };

function bgRefreshReachable(url: string | null): void {
  if (tunnelReachable.refreshing) return;
  if (!url) { tunnelReachable.value = false; tunnelReachable.url = null; tunnelReachable.fetchedAt = Date.now(); return; }
  tunnelReachable.refreshing = true;
  probeUrlAlive(url)
    .then((ok) => { tunnelReachable.value = ok; })
    .catch(() => { tunnelReachable.value = false; })
    .finally(() => {
      tunnelReachable.url = url;
      tunnelReachable.fetchedAt = Date.now();
      tunnelReachable.refreshing = false;
    });
}

function readReachable(url: string | null): boolean {
  if (tunnelReachable.url !== url) { tunnelReachable.value = false; tunnelReachable.fetchedAt = 0; }
  if (Date.now() - tunnelReachable.fetchedAt > REACHABLE_TTL_MS) bgRefreshReachable(url);
  return tunnelReachable.value;
}

function throwIfCancelled(token: { cancelled: boolean }, label: string): void {
  if (token.cancelled) throw new Error(`${label} cancelled`);
}

function broadcastStatus(): void {
  const status = getTunnelStatus();
  broadcast({ type: "tunnel:status", data: status });
}

// ─── Enable Tunnel ───────────────────────────────────────────────────────────

export async function enableTunnel(localPort: number = config.port): Promise<{ success: boolean; tunnelUrl: string; mode: "quick" | "named"; alreadyRunning?: boolean }> {
  console.log(`[Tunnel] enable start (port=${localPort})`);
  tunnelSvc.cancelToken = { cancelled: false };
  tunnelSvc.activeLocalPort = localPort;
  tunnelSvc.spawnInProgress = true;
  const token = tunnelSvc.cancelToken;

  try {
    // Check if already running and reachable
    if (isCloudflaredRunning()) {
      const existing = loadState();
      if (existing?.tunnelUrl && await probeUrlAlive(existing.tunnelUrl)) {
        console.log(`[Tunnel] already running, reuse: ${existing.tunnelUrl}`);
        tunnelSvc.spawnInProgress = false;
        broadcastStatus();
        return { success: true, tunnelUrl: existing.tunnelUrl, mode: existing.mode, alreadyRunning: true };
      }
    }

    killCloudflared(localPort);
    console.log("[Tunnel] killed existing cloudflared");
    throwIfCancelled(token, "tunnel");

    let tunnelUrl: string;
    let mode: "quick" | "named";

    if (config.tunnelToken) {
      // Named tunnel mode
      mode = "named";
      await spawnNamedTunnel(config.tunnelToken);
      // Named tunnels don't emit a URL in logs - the URL is configured in Cloudflare dashboard
      // We store a placeholder; the actual URL is known from the dashboard
      tunnelUrl = "named-tunnel-active";
      console.log("[Tunnel] named tunnel spawned");
    } else {
      // Quick tunnel mode
      mode = "quick";
      const onUrlUpdate = (url: string) => {
        if (token.cancelled) return;
        console.log(`[Tunnel] url updated: ${url}`);
        saveState({ tunnelUrl: url, mode: "quick", enabled: true });
        broadcastStatus();
      };

      const result = await spawnQuickTunnel(localPort, onUrlUpdate);
      tunnelUrl = result.tunnelUrl;
      console.log(`[Tunnel] quick tunnel spawned: ${tunnelUrl}`);
    }

    throwIfCancelled(token, "tunnel");

    // Save state
    const state: TunnelState = { tunnelUrl, mode, enabled: true };
    if (config.tunnelToken) state.tunnelToken = config.tunnelToken;
    saveState(state);

    // Wait for health check (only for quick tunnel with real URL)
    if (mode === "quick") {
      await waitForHealth(tunnelUrl, token);
      console.log("[Tunnel] tunnel URL healthy");
    }

    // Prime reachable cache
    tunnelReachable.value = true;
    tunnelReachable.url = tunnelUrl;
    tunnelReachable.fetchedAt = Date.now();

    // Register unexpected exit handler for auto-reconnect
    setUnexpectedExitHandler(() => {
      console.log("[Tunnel] unexpected exit detected, watchdog will handle restart");
    });

    broadcastStatus();
    console.log("[Tunnel] enable success");
    return { success: true, tunnelUrl, mode };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Tunnel] enable error: ${msg}`);
    throw e;
  } finally {
    tunnelSvc.spawnInProgress = false;
  }
}

// ─── Disable Tunnel ──────────────────────────────────────────────────────────

export async function disableTunnel(): Promise<{ success: boolean }> {
  console.log("[Tunnel] disable");
  tunnelSvc.cancelToken.cancelled = true;
  setUnexpectedExitHandler(() => {});
  killCloudflared(tunnelSvc.activeLocalPort);
  clearState();
  tunnelReachable.value = false;
  tunnelReachable.url = null;
  tunnelReachable.fetchedAt = Date.now();
  broadcastStatus();
  return { success: true };
}

// ─── Get Status ──────────────────────────────────────────────────────────────

export function getTunnelStatus() {
  const state = loadState();
  const enabled = state?.enabled ?? false;
  const tunnelUrl = state?.tunnelUrl || "";
  const mode = state?.mode || "quick";
  const running = enabled ? isCloudflaredRunning() : false;
  const reachable = enabled && running ? readReachable(tunnelUrl) : false;
  const download = getDownloadStatus();

  return {
    enabled,
    tunnelUrl,
    running,
    reachable,
    mode,
    downloading: download.downloading,
    downloadProgress: download.progress,
  };
}

// ─── Exports for watchdog ────────────────────────────────────────────────────

export function getTunnelServiceState() { return tunnelSvc; }

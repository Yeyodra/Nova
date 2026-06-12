import { WATCHDOG_INTERVAL_MS, NETWORK_CHECK_INTERVAL_MS, RESTART_COOLDOWN_MS, NETWORK_SETTLE_MS } from "./config";
import { enableTunnel, getTunnelServiceState, isTunnelManuallyDisabled } from "./tunnel-manager";
import { isCloudflaredRunning } from "./cloudflared";
import { checkInternet } from "./network-probe";
import { loadState } from "./state";
import { config } from "../../config";

let watchdogInterval: ReturnType<typeof setInterval> | null = null;
let networkInterval: ReturnType<typeof setInterval> | null = null;
let lastInternetState = true;

/**
 * Start watchdog: checks every 60s if tunnel should be running but isn't
 */
export function startWatchdog(): void {
  if (watchdogInterval) return;

  watchdogInterval = setInterval(async () => {
    try {
      if (isTunnelManuallyDisabled()) return;

      const state = loadState();
      if (!state?.enabled) return;

      // Tunnel should be running but isn't
      if (!isCloudflaredRunning()) {
        const svc = getTunnelServiceState();
        if (svc.spawnInProgress) return; // already reconnecting

        const now = Date.now();
        if (now - svc.lastRestartAt < RESTART_COOLDOWN_MS) {
          console.log("[Watchdog] cooldown active, skipping restart");
          return;
        }

        console.log("[Watchdog] tunnel not running, restarting...");
        svc.lastRestartAt = now;
        await enableTunnel(config.port);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Watchdog] error: ${msg}`);
    }
  }, WATCHDOG_INTERVAL_MS);

  console.log(`[Watchdog] started (interval=${WATCHDOG_INTERVAL_MS}ms)`);
}

/**
 * Start network monitor: checks every 5s if internet is available
 * Re-enables tunnel after network recovery
 */
export function startNetworkMonitor(): void {
  if (networkInterval) return;

  networkInterval = setInterval(async () => {
    try {
      if (isTunnelManuallyDisabled()) return;

      const state = loadState();
      if (!state?.enabled) return;

      const hasInternet = await checkInternet();

      if (!lastInternetState && hasInternet) {
        // Network recovered
        console.log("[NetworkMonitor] internet recovered, waiting for settle...");
        await new Promise((r) => setTimeout(r, NETWORK_SETTLE_MS));

        if (!isCloudflaredRunning()) {
          const svc = getTunnelServiceState();
          if (svc.spawnInProgress) return;

          const now = Date.now();
          if (now - svc.lastRestartAt < RESTART_COOLDOWN_MS) return;

          console.log("[NetworkMonitor] restarting tunnel after network recovery");
          svc.lastRestartAt = now;
          await enableTunnel(config.port);
        }
      }

      lastInternetState = hasInternet;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[NetworkMonitor] error: ${msg}`);
    }
  }, NETWORK_CHECK_INTERVAL_MS);

  console.log(`[NetworkMonitor] started (interval=${NETWORK_CHECK_INTERVAL_MS}ms)`);
}

/**
 * Stop all monitoring intervals
 */
export function stopMonitoring(): void {
  if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
  if (networkInterval) { clearInterval(networkInterval); networkInterval = null; }
}

/**
 * Initialize tunnel system: auto-resume + start monitoring
 * Fire-and-forget - never blocks server startup
 */
export async function initTunnel(): Promise<void> {
  const state = loadState();

  if (state?.enabled) {
    console.log("[Tunnel] auto-resuming from previous state...");
    try {
      await enableTunnel(config.port);
      console.log("[Tunnel] auto-resume success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[Tunnel] auto-resume failed: ${msg}`);
      // Don't crash - watchdog will retry
    }
  }

  startWatchdog();
  startNetworkMonitor();
}

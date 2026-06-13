import net from "net";
import dns from "dns";
import { INTERNET_CHECK, HEALTH_CHECK } from "./config";

// Force public DNS to bypass OS negative cache
const resolver = new dns.promises.Resolver();
resolver.setServers(["1.1.1.1", "1.0.0.1", "8.8.8.8"]);

export interface CancelToken {
  cancelled: boolean;
}

export function checkInternet(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    socket.setTimeout(INTERNET_CHECK.timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    try { socket.connect(INTERNET_CHECK.port, INTERNET_CHECK.host); }
    catch { finish(false); }
  });
}

async function resolveDns(hostname: string, timeoutMs: number): Promise<boolean> {
  const tryResolver = (fn: () => Promise<unknown>): Promise<boolean> =>
    Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("dns timeout")), timeoutMs)),
    ]).then(() => true).catch(() => false);

  if (await tryResolver(() => resolver.resolve4(hostname))) return true;
  return tryResolver(() => dns.promises.resolve4(hostname));
}

export async function probeUrlAlive(url: string): Promise<boolean> {
  if (!url) return false;
  try { new URL(url); } catch { return false; }

  // Try fetch directly first (most reliable — uses system DNS)
  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK.fetchTimeoutMs),
    });
    return res.ok;
  } catch { /* fetch failed, try with DNS pre-check for diagnostics */ }

  // Fallback: explicit DNS check then retry fetch
  let hostname: string;
  try { hostname = new URL(url).hostname; } catch { return false; }

  if (!await resolveDns(hostname, HEALTH_CHECK.dnsTimeoutMs)) return false;

  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(HEALTH_CHECK.fetchTimeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function waitForHealth(url: string, cancelToken: CancelToken = { cancelled: false }): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < HEALTH_CHECK.timeoutMs) {
    if (cancelToken.cancelled) throw new Error("cancelled");
    if (await probeUrlAlive(url)) return true;
    await new Promise((r) => setTimeout(r, HEALTH_CHECK.intervalMs));
  }
  throw new Error(`Health check timeout after ${HEALTH_CHECK.timeoutMs}ms`);
}

import { Hono } from "hono";
import { enableTunnel, disableTunnel, getTunnelStatus } from "../lib/tunnel/tunnel-manager";
import { getDownloadStatus } from "../lib/tunnel/cloudflared";
import { config } from "../config";

export const tunnelRouter = new Hono();

// GET /status - Return current tunnel state + download progress
tunnelRouter.get("/status", (c) => {
  const tunnel = getTunnelStatus();
  const download = getDownloadStatus();
  return c.json({ tunnel, download });
});

// POST /enable - Start cloudflared tunnel
tunnelRouter.post("/enable", async (c) => {
  try {
    const result = await enableTunnel(config.port);
    // DNS warmup delay for quick tunnel (8s)
    if (result.mode === "quick" && !result.alreadyRunning) {
      await new Promise((r) => setTimeout(r, 8000));
    }
    return c.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: message }, 500);
  }
});

// POST /disable - Stop cloudflared tunnel
tunnelRouter.post("/disable", async (c) => {
  try {
    const result = await disableTunnel();
    return c.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ error: message }, 500);
  }
});

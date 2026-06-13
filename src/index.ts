import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "./config";
import { runMigrations } from "./db/migrate";
import { apiRouter } from "./api/index";
import { authRouter } from "./auth/index";
import { proxyRouter } from "./proxy/index";
import { websocketHandler, getClientCount } from "./ws/index";
import { isValidApiKey } from "./api/keys";
import { verifyDashboardToken, rotateJwtSecret } from "./utils/jwt";
import { autoWarmupScheduler } from "./auth/warmup-scheduler";
import { db } from "./db/index";
import { filterRules, settings } from "./db/schema";
import { sql, eq } from "drizzle-orm";
import { PUDIDIL_FILTERS } from "./proxy/filters";
import { loadFilterCache } from "./proxy/filter-cache";
import { ensureModelMappingTable, seedModelMappings, loadModelMappingCache } from "./proxy/model-mapping";
import { refreshByokModels } from "./proxy/providers/registry";
import { initTunnel } from "./lib/tunnel/watchdog";

// Run database migrations on startup
await runMigrations();

// Password reset check
if (process.env.RESET_PASSWORD === "true") {
  await db.delete(settings).where(eq(settings.key, "admin_password_hash"));
  await rotateJwtSecret();
  console.log("⚠️  Password has been reset. Visit dashboard to set new password.");
}

// Seed filter rules from PUDIDIL_FILTERS if table is empty (first boot only)
try {
  const [row] = await db.select({ count: sql<number>`COUNT(*)` }).from(filterRules);
  if (Number(row?.count || 0) === 0) {
    await db.insert(filterRules).values(
      PUDIDIL_FILTERS.map((r, i) => ({
        ruleId: r.id,
        pattern: r.pattern,
        replacement: r.replacement,
        isActive: r.is_active,
        isRegex: r.is_regex,
        sortOrder: i,
      }))
    );
    console.log(`[DB] Seeded ${PUDIDIL_FILTERS.length} filter rules`);
  }
  await loadFilterCache();
} catch (e) {
  console.error("[DB] Filter rules seed/load skipped:", e instanceof Error ? e.message : e);
}

// Ensure model_mappings table exists (idempotent), seed Claude Code templates
// on first boot, then load the in-memory cache used by the proxy hot path.
try {
  ensureModelMappingTable();
  await seedModelMappings();
  await loadModelMappingCache();
} catch (e) {
  console.error("[DB] Model mapping init skipped:", e instanceof Error ? e.message : e);
}

// Pre-warm BYOK provider cache so ownsModel() works from the first request
try {
  console.log("[BYOK] Warming up cache...");
  await refreshByokModels();
  console.log("[BYOK] Cache warmed up successfully");
} catch (e) {
  console.error("[BYOK] Cache warm-up skipped:", e instanceof Error ? e.message : e);
}

// Start auto-warmup scheduler (reads settings from DB)
await autoWarmupScheduler.start();

// Initialize tunnel system (fire-and-forget, never blocks startup)
initTunnel().catch((e) => {
  console.error("[Tunnel] init failed:", e instanceof Error ? e.message : e);
});

// Create Hono app
const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", logger());

// API Key authentication middleware for proxy endpoints
app.use("/v1/*", async (c, next) => {
  const authHeader = c.req.header("Authorization");
  const xApiKey = c.req.header("x-api-key");
  const token = authHeader?.replace("Bearer ", "") || xApiKey;

  if (!token) {
    return c.json(
      { error: { message: "Missing Authorization header", type: "auth_error" } },
      401
    );
  }

  if (!(await isValidApiKey(token))) {
    return c.json(
      { error: { message: "Invalid API key", type: "auth_error" } },
      401
    );
  }

  await next();
});

// JWT authentication for dashboard/management API
app.use("/api/*", async (c, next) => {
  // Exempt routes — no auth required
  if (
    c.req.path === "/api/health" ||
    c.req.path === "/api/info" ||
    c.req.path === "/api/keys/test" ||
    c.req.path.startsWith("/api/dashboard-auth")
  ) {
    await next();
    return;
  }

  // JWT authentication for dashboard API
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!token) {
    return c.json(
      { error: { message: "Unauthorized", type: "auth_error" } },
      401
    );
  }

  try {
    await verifyDashboardToken(token);
  } catch {
    return c.json(
      { error: { message: "Unauthorized", type: "auth_error" } },
      401
    );
  }

  await next();
});

// Fallback: rewrite OpenAI-compatible paths without /v1 prefix → /v1/*
// Allows baseURL to be set without /v1 suffix (e.g. https://tunnel.trycloudflare.com)
app.use("*", async (c, next) => {
  const path = c.req.path;
  if (
    !path.startsWith("/v1/") &&
    !path.startsWith("/api/") &&
    !path.startsWith("/ws") &&
    (path === "/models" || path === "/chat/completions" || path === "/messages" || path === "/completions" || path === "/embeddings")
  ) {
    const newUrl = new URL(c.req.url);
    newUrl.pathname = `/v1${path}`;
    const newReq = new Request(newUrl.toString(), c.req.raw);
    return app.fetch(newReq, { ip: c.env?.ip });
  }
  await next();
});

// Mount routes
app.route("/", proxyRouter); // /v1/chat/completions, /v1/models
app.route("/api", apiRouter); // /api/accounts, /api/settings, /api/stats
app.route("/api/auth", authRouter); // /api/auth/login, /api/auth/queue

// Health/info endpoint (moved from / to /api/health)
app.get("/api/info", (c) => {
  return c.json({
    name: "pool-proxy",
    version: "1.0.0",
    status: "running",
    endpoints: {
      proxy: "/v1/chat/completions",
      anthropic: "/v1/messages",
      models: "/v1/models",
      accounts: "/api/accounts",
      stats: "/api/stats",
      settings: "/api/settings",
      auth: "/api/auth",
      health: "/api/health",
      websocket: "/ws",
    },
    wsClients: getClientCount(),
  });
});

// Serve dashboard static files (SPA fallback)
const dashboardDist = new URL("../dashboard/dist", import.meta.url).pathname;
const dashboardIndex = `${dashboardDist}/index.html`;

const staticMimeTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

// Start server with WebSocket support
const server = Bun.serve({
  port: config.port,
  idleTimeout: 255,
  async fetch(req, server) {
    // Handle WebSocket upgrade
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req, { data: {} });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Try Hono routes first (API, proxy, etc.)
    const response = await app.fetch(req, { ip: server.requestIP(req) });
    if (response.status !== 404) return response;

    // Fallback: serve dashboard static files
    const pathname = url.pathname;
    const filePath = `${dashboardDist}${pathname}`;
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const ext = pathname.slice(pathname.lastIndexOf("."));
      return new Response(file, {
        headers: { "Content-Type": staticMimeTypes[ext] || "application/octet-stream" },
      });
    }

    // SPA fallback: serve index.html for non-file routes
    const indexFile = Bun.file(dashboardIndex);
    if (await indexFile.exists()) {
      return new Response(indexFile, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
  websocket: websocketHandler,
});

console.log(`
╔══════════════════════════════════════════════════╗
║           🔄 Pool Proxy Server                   ║
╠══════════════════════════════════════════════════╣
║  HTTP:      http://localhost:${config.port}               ║
║  WebSocket: ws://localhost:${config.port}/ws              ║
║  Database:  SQLite                              ║
║  Dashboard: http://localhost:${config.dashboardPort}              ║
╠══════════════════════════════════════════════════╣
║  Endpoints:                                      ║
║    POST /v1/chat/completions  (proxy)            ║
║    POST /v1/messages          (Anthropic)        ║
║    GET  /v1/models            (models)           ║
║    GET  /api/accounts         (management)       ║
║    GET  /api/stats            (statistics)       ║
║    WS   /ws                   (real-time)        ║
╚══════════════════════════════════════════════════╝
`);

export default server;

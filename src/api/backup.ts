import { Hono } from "hono";
import { db } from "../db/index";
import { accounts } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { config } from "../config";

const VALID_PROVIDERS = ["kiro", "kiro-pro", "codebuddy", "canva", "codex", "qoder", "byok"] as const;

export const backupRouter = new Hono();
export const restoreRouter = new Hono();

/**
 * GET /api/backup - Export pool account credentials as JSON
 */
/**
 * POST /api/restore - Import pool account credentials from JSON backup
 */
restoreRouter.post("/", async (c) => {
  // Validate body size (10MB limit)
  const contentLength = parseInt(c.req.header("content-length") || "0", 10);
  if (contentLength > 10 * 1024 * 1024) {
    return c.json({ error: "Request body too large. Maximum 10MB allowed." }, 400);
  }

  // Validate strategy param
  const strategy = c.req.query("strategy") || "skip";
  if (strategy !== "skip" && strategy !== "overwrite") {
    return c.json({ error: `Invalid strategy "${strategy}". Must be "skip" or "overwrite".` }, 400);
  }

  const body = await c.req.json();

  // Validate version
  if (!body.version || body.version !== 1) {
    return c.json({ error: "Invalid or missing version field. Expected version: 1." }, 400);
  }

  // Validate accounts array
  if (!Array.isArray(body.accounts) || body.accounts.length === 0) {
    return c.json({ error: "accounts must be a non-empty array." }, 400);
  }

  // Validate each account
  for (let i = 0; i < body.accounts.length; i++) {
    const acc = body.accounts[i];
    if (!acc.provider || !acc.email || !acc.password) {
      return c.json({ error: `Account at index ${i} missing required fields (provider, email, password).` }, 400);
    }
    if (!VALID_PROVIDERS.includes(acc.provider as any)) {
      return c.json({ error: `Account at index ${i} has invalid provider "${acc.provider}". Must be one of: ${VALID_PROVIDERS.join(", ")}` }, 400);
    }
  }

  // Check key fingerprint mismatch
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(config.encryptionKey);
  const currentFingerprint = hasher.digest("hex").slice(0, 8);
  const keyMismatch = body.keyFingerprint ? body.keyFingerprint !== currentFingerprint : false;

  // Restore logic in transaction
  const imported_accounts: string[] = [];
  const skipped_accounts: string[] = [];
  const overwritten_accounts: string[] = [];
  const errors: string[] = [];

  try {
    await db.transaction(async (tx) => {
      for (const acc of body.accounts) {
        const label = `${acc.provider}:${acc.email}`;

        // Check if account exists
        const existing = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.provider, acc.provider), eq(accounts.email, acc.email)))
          .limit(1);

        if (existing.length > 0) {
          if (strategy === "skip") {
            skipped_accounts.push(label);
          } else {
            // overwrite — credentials + preferences only, reset runtime state
            await tx
              .update(accounts)
              .set({
                password: acc.password,
                tokens: acc.tokens ?? null,
                metadata: acc.metadata ?? null,
                enabled: acc.enabled ?? true,
                status: "pending",
                quotaLimit: 0,
                quotaRemaining: 0,
                quotaResetAt: null,
              })
              .where(and(eq(accounts.provider, acc.provider), eq(accounts.email, acc.email)));
            overwritten_accounts.push(label);
          }
        } else {
          // Insert new — credentials only, runtime state starts fresh
          await tx.insert(accounts).values({
            provider: acc.provider,
            email: acc.email,
            password: acc.password,
            status: "pending",
            enabled: acc.enabled ?? true,
            tokens: acc.tokens ?? null,
            metadata: acc.metadata ?? null,
            createdAt: acc.createdAt ? new Date(acc.createdAt) : new Date(),
          });
          imported_accounts.push(label);
        }
      }
    });
  } catch (err: any) {
    return c.json({
      success: false,
      imported: 0,
      skipped: 0,
      overwritten: 0,
      errors: [err.message || "Transaction failed"],
      keyMismatch,
      details: { imported_accounts: [], skipped_accounts: [], overwritten_accounts: [] },
    }, 500);
  }

  return c.json({
    success: true,
    imported: imported_accounts.length,
    skipped: skipped_accounts.length,
    overwritten: overwritten_accounts.length,
    errors,
    keyMismatch,
    details: { imported_accounts, skipped_accounts, overwritten_accounts },
  });
});

/**
 * GET /api/backup - Export pool account credentials as JSON
 */
backupRouter.get("/", async (c) => {
  const provider = c.req.query("provider");

  if (provider && !VALID_PROVIDERS.includes(provider as any)) {
    return c.json({ error: `Invalid provider. Must be one of: ${VALID_PROVIDERS.join(", ")}` }, 400);
  }

  const query = provider
    ? db.select().from(accounts).where(eq(accounts.provider, provider))
    : db.select().from(accounts);

  const rows = await query;

  // Generate key fingerprint
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(config.encryptionKey);
  const keyFingerprint = hasher.digest("hex").slice(0, 8);

  // Map accounts to export format (credentials + preferences only, no runtime state)
  const exported = rows.map((row) => ({
    provider: row.provider,
    email: row.email,
    password: row.password,
    tokens: row.tokens,
    metadata: row.metadata,
    enabled: row.enabled,
    createdAt: row.createdAt,
  }));

  return c.json({
    version: 1,
    timestamp: new Date().toISOString(),
    keyFingerprint,
    provider: provider || "all",
    accounts: exported,
    total: exported.length,
  });
});

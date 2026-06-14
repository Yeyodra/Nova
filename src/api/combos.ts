import { Hono } from "hono";
import { db } from "../db/index";
import { combos } from "../db/schema";
import { eq, asc } from "drizzle-orm";
import {
  isValidComboName,
  validateComboModels,
  resetComboRotation,
  invalidateCombosCache,
  getComboByNameCached,
} from "../proxy/combos";
import { broadcast } from "../ws/index";

export const combosRouter = new Hono();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ComboBody = {
  name?: unknown;
  models?: unknown;
  strategy?: unknown;
  stickyLimit?: unknown;
};

function isValidStrategy(value: unknown): value is "fallback" | "round-robin" | null | undefined {
  return (
    value === undefined ||
    value === null ||
    value === "fallback" ||
    value === "round-robin"
  );
}

function isValidStickyLimit(value: unknown): value is number | null | undefined {
  if (value === undefined || value === null) return true;
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 1000
  );
}

/**
 * The runtime combos cache (`getComboByNameCached`) is loaded once at startup
 * by `loadCombosCache()`. Until that wiring lands (Task 5), or when the combo
 * being validated is being created in the same request, we still need a
 * reliable nested-combo check. Pull the current names directly from the DB so
 * `validateComboModels` can see siblings even before the cache is primed.
 */
async function getAllComboNames(): Promise<Set<string>> {
  const rows = await db.select({ name: combos.name }).from(combos);
  return new Set(rows.map((r) => r.name));
}

/**
 * Validate the `models` array against both the canonical
 * `validateComboModels` rules AND a fresh DB-backed nested-combo check.
 * `excludeName` is the name of the combo being updated (so it doesn't
 * reject itself if its own name happens to appear, defensive only).
 */
async function validateModelsWithDb(
  models: string[],
  excludeName?: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const baseline = validateComboModels(models);
  if (!baseline.ok) return baseline;

  const dbNames = await getAllComboNames();
  for (let i = 0; i < models.length; i++) {
    const item = models[i];
    if (typeof item !== "string") continue; // baseline already rejected this; narrow for the type-checker
    if (excludeName && item === excludeName) continue;
    if (dbNames.has(item) || getComboByNameCached(item) !== null) {
      return {
        ok: false,
        reason: `models[${i}] = "${item}" is a combo name; nested combos are not allowed`,
      };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// GET /api/combos — list all combos
// ---------------------------------------------------------------------------

combosRouter.get("/", async (c) => {
  const rows = await db.select().from(combos).orderBy(asc(combos.id));
  return c.json({ combos: rows });
});

// ---------------------------------------------------------------------------
// POST /api/combos — create combo
// ---------------------------------------------------------------------------

combosRouter.post("/", async (c) => {
  let body: ComboBody;
  try {
    body = await c.req.json<ComboBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // name (required)
  if (typeof body.name !== "string") {
    return c.json({ error: "name is required" }, 400);
  }
  const nameCheck = isValidComboName(body.name);
  if (!nameCheck.ok) {
    return c.json({ error: nameCheck.reason }, 400);
  }

  // models (required)
  if (!Array.isArray(body.models)) {
    return c.json({ error: "models is required and must be an array" }, 400);
  }
  const modelsCheck = await validateModelsWithDb(body.models as string[]);
  if (!modelsCheck.ok) {
    return c.json({ error: modelsCheck.reason }, 400);
  }

  // strategy (optional)
  if (!isValidStrategy(body.strategy)) {
    return c.json(
      { error: "strategy must be 'fallback', 'round-robin', or null" },
      400
    );
  }

  // stickyLimit (optional)
  if (!isValidStickyLimit(body.stickyLimit)) {
    return c.json(
      { error: "stickyLimit must be a positive integer (1-1000) or null" },
      400
    );
  }

  let created;
  try {
    [created] = await db
      .insert(combos)
      .values({
        name: body.name,
        models: body.models as string[],
        strategy: (body.strategy as "fallback" | "round-robin" | null | undefined) ?? null,
        stickyLimit: (body.stickyLimit as number | null | undefined) ?? null,
      })
      .returning();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(msg) || /unique/i.test(msg)) {
      return c.json({ error: "Combo name already exists" }, 400);
    }
    return c.json({ error: `Failed to create combo: ${msg}` }, 500);
  }

  invalidateCombosCache();
  broadcast({ type: "combos_updated", data: {} });
  return c.json(created, 201);
});

// ---------------------------------------------------------------------------
// GET /api/combos/:id — get one combo
// ---------------------------------------------------------------------------

combosRouter.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || !Number.isInteger(id)) {
    return c.json({ error: "Invalid id" }, 400);
  }
  const [row] = await db.select().from(combos).where(eq(combos.id, id));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// ---------------------------------------------------------------------------
// PATCH /api/combos/:id — update combo (partial)
// ---------------------------------------------------------------------------

combosRouter.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || !Number.isInteger(id)) {
    return c.json({ error: "Invalid id" }, 400);
  }

  let body: ComboBody;
  try {
    body = await c.req.json<ComboBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  // Read existing first (404 if missing).
  const [existing] = await db.select().from(combos).where(eq(combos.id, id));
  if (!existing) return c.json({ error: "Not found" }, 404);

  const updates: Record<string, unknown> = { updatedAt: new Date() };

  // name — validate only if changed
  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      return c.json({ error: "name must be a string" }, 400);
    }
    if (body.name !== existing.name) {
      const nameCheck = isValidComboName(body.name);
      if (!nameCheck.ok) {
        return c.json({ error: nameCheck.reason }, 400);
      }
      updates.name = body.name;
    }
  }

  // models — validate only if provided
  if (body.models !== undefined) {
    if (!Array.isArray(body.models)) {
      return c.json({ error: "models must be an array" }, 400);
    }
    const modelsCheck = await validateModelsWithDb(
      body.models as string[],
      existing.name
    );
    if (!modelsCheck.ok) {
      return c.json({ error: modelsCheck.reason }, 400);
    }
    updates.models = body.models as string[];
  }

  // strategy
  if (body.strategy !== undefined) {
    if (!isValidStrategy(body.strategy)) {
      return c.json(
        { error: "strategy must be 'fallback', 'round-robin', or null" },
        400
      );
    }
    updates.strategy = body.strategy ?? null;
  }

  // stickyLimit
  if (body.stickyLimit !== undefined) {
    if (!isValidStickyLimit(body.stickyLimit)) {
      return c.json(
        { error: "stickyLimit must be a positive integer (1-1000) or null" },
        400
      );
    }
    updates.stickyLimit = body.stickyLimit ?? null;
  }

  let updated;
  try {
    [updated] = await db
      .update(combos)
      .set(updates)
      .where(eq(combos.id, id))
      .returning();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(msg)) {
      return c.json({ error: "Combo name already exists" }, 400);
    }
    return c.json({ error: `Failed to update combo: ${msg}` }, 500);
  }

  if (!updated) return c.json({ error: "Not found" }, 404);

  // Reset rotation under the OLD name, and (if renamed) under the new one too,
  // so stale rotation indices don't outlive the model list.
  resetComboRotation(existing.name);
  if (updated.name !== existing.name) {
    resetComboRotation(updated.name);
  }

  invalidateCombosCache();
  broadcast({ type: "combos_updated", data: {} });
  return c.json(updated);
});

// ---------------------------------------------------------------------------
// DELETE /api/combos/:id — delete combo
// ---------------------------------------------------------------------------

combosRouter.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id) || !Number.isInteger(id)) {
    return c.json({ error: "Invalid id" }, 400);
  }

  const [existing] = await db.select().from(combos).where(eq(combos.id, id));
  if (!existing) return c.json({ error: "Not found" }, 404);

  await db.delete(combos).where(eq(combos.id, id));

  resetComboRotation(existing.name);
  invalidateCombosCache();
  broadcast({ type: "combos_updated", data: {} });
  return c.json({ success: true });
});

/**
 * Combo runtime settings (strategy + sticky limit, plus per-combo overrides).
 *
 * Combos can route to one of several upstream models. The user picks how the
 * router chooses between them:
 *   - "fallback"     — try in declared order, advance on hard failure
 *   - "round-robin"  — rotate the starting index each call (with optional
 *                      "sticky" reuse of the last winner)
 *
 * Three keys live in the existing `settings` key-value table — no new table:
 *   combo_strategy      "fallback" | "round-robin"          (default "fallback")
 *   combo_sticky_limit  integer >= 1                        (default 1)
 *   combo_strategies    JSON object of per-combo overrides:
 *                         { "<combo-name>": { strategy?, stickyLimit? } }
 *
 * Values are cached in module-level vars and read on the request hot path, so
 * accessors stay synchronous. Cache is reloaded explicitly on update or via
 * invalidateComboSettingsCache() — same shape as model-mapping.ts.
 */
import { db } from "../db/index";
import { settings } from "../db/schema";
import { eq } from "drizzle-orm";

export type ComboStrategy = "fallback" | "round-robin";

const KEY_STRATEGY = "combo_strategy";
const KEY_STICKY_LIMIT = "combo_sticky_limit";
const KEY_STRATEGIES = "combo_strategies";

const VALID_KEYS = new Set<string>([KEY_STRATEGY, KEY_STICKY_LIMIT, KEY_STRATEGIES]);

/** In-memory cache (defaults applied when settings rows are missing). */
let strategy: ComboStrategy = "fallback";
let stickyLimit = 1;
let perCombo: Record<string, { strategy?: ComboStrategy; stickyLimit?: number }> = {};

function isValidStrategy(v: unknown): v is ComboStrategy {
  return v === "fallback" || v === "round-robin";
}

/**
 * Load the three combo-related settings from the DB into the in-memory cache.
 * Invalid or missing rows fall back to the documented defaults.
 */
export async function loadComboSettings(): Promise<void> {
  const rows = await db.select().from(settings);
  const map = new Map<string, string | null>();
  for (const r of rows) {
    if (VALID_KEYS.has(r.key)) map.set(r.key, r.value);
  }

  // combo_strategy
  const rawStrategy = map.get(KEY_STRATEGY);
  strategy = isValidStrategy(rawStrategy) ? rawStrategy : "fallback";

  // combo_sticky_limit
  const rawLimit = map.get(KEY_STICKY_LIMIT);
  const parsedLimit = rawLimit == null ? NaN : Number(rawLimit);
  stickyLimit = Number.isFinite(parsedLimit) && parsedLimit >= 1
    ? Math.floor(parsedLimit)
    : 1;

  // combo_strategies (JSON object)
  const rawPerCombo = map.get(KEY_STRATEGIES);
  if (rawPerCombo) {
    try {
      const parsed = JSON.parse(rawPerCombo);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        perCombo = parsed as Record<string, { strategy?: ComboStrategy; stickyLimit?: number }>;
      } else {
        perCombo = {};
      }
    } catch (e) {
      console.error("[ComboSettings] failed to parse combo_strategies JSON:", e);
      perCombo = {};
    }
  } else {
    perCombo = {};
  }
}

/** Get the global combo routing strategy. */
export function getComboStrategy(): ComboStrategy {
  return strategy;
}

/** Get the global sticky-limit (>= 1). */
export function getComboStickyLimit(): number {
  return stickyLimit;
}

/**
 * Per-combo override lookup. Returns the recorded entry (which may set only
 * `strategy` or only `stickyLimit`) or null when no override exists.
 */
export function getComboSpecificStrategy(
  comboName: string
): { strategy?: ComboStrategy; stickyLimit?: number } | null {
  const entry = perCombo[comboName];
  return entry ? entry : null;
}

/**
 * Upsert one of the three combo settings keys and refresh the cache. Values
 * are coerced to text for storage (JSON.stringify for objects, String(...)
 * otherwise). Mirrors src/api/proxy-settings.ts:55-91 (select-then-insert-or-update).
 */
export async function updateComboSettings(key: string, value: unknown): Promise<void> {
  if (!VALID_KEYS.has(key)) {
    throw new Error(`[ComboSettings] invalid key: ${key}`);
  }

  const text =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

  const existing = await db.select().from(settings).where(eq(settings.key, key));
  if (existing.length > 0) {
    await db
      .update(settings)
      .set({ value: text, updatedAt: new Date() })
      .where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value: text });
  }

  await loadComboSettings();
}

/**
 * Fire-and-forget cache refresh. Mirrors invalidateModelMappingCache: callers
 * that mutate combo settings outside `updateComboSettings` (or want a forced
 * reload) can poke this and any error is logged, never thrown.
 */
export function invalidateComboSettingsCache(): void {
  loadComboSettings().catch((e) =>
    console.error("[ComboSettings] reload failed", e)
  );
}

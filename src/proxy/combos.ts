/**
 * Combo resolution engine.
 *
 * A "combo" is a named alias for a list of upstream model ids, with an
 * optional rotation strategy (fallback or round-robin). The proxy edge
 * resolves an incoming model id against the combos cache; if it matches,
 * the request is fanned out across the sub-models (sequential fallback or
 * sticky round-robin) until one succeeds.
 *
 * Ports the rotation + fallback semantics from
 * 9router_wyx0/open-sse/services/combo.js (lines 36-65 = rotation,
 * 71-74 = reset, 108-198 = fallback loop).
 *
 * The cache pattern mirrors model-mapping.ts: a top-level Map populated
 * from the DB once at startup, with an `invalidateCombosCache()` that
 * fires a fire-and-forget reload for write paths.
 */

import { db } from "../db/index";
import { combos, type Combo } from "../db/schema";
import { routeRequest, type RouteResult } from "./router";
import type { ChatCompletionRequest } from "./providers/base";
import { getAllModels } from "./providers/registry";

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

/**
 * Per-combo rotation state for round-robin strategy.
 * `index`              = which sub-model is currently first in the rotation.
 * `consecutiveUseCount` = how many requests have already been served from the
 *                        current index (sticky window).
 */
const comboRotationState = new Map<
  string,
  { index: number; consecutiveUseCount: number }
>();

/** Combos cache, keyed by raw combo.name (not lowercased). */
const combosCache = new Map<string, Combo>();

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

/** (Re)load the combos cache from the DB. */
export async function loadCombosCache(): Promise<void> {
  try {
    const rows = await db.select().from(combos);
    combosCache.clear();
    for (const row of rows) {
      combosCache.set(row.name, row);
    }
  } catch (err) {
    console.error("[Combos] cache load failed", err);
  }
}

/** Fire-and-forget cache reload, used after writes. */
export function invalidateCombosCache(): void {
  loadCombosCache().catch((e) => console.error("[Combos] reload failed", e));
}

/** All cached combos (snapshot). */
export function getCombosCached(): Combo[] {
  return Array.from(combosCache.values());
}

/** Lookup a single combo by name (raw, case-sensitive on the request side). */
export function getComboByNameCached(name: string): Combo | null {
  return combosCache.get(name) ?? null;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve `modelStr` against the combos cache. Returns the sub-model array
 * if it is a combo, otherwise null. Async by signature for forward-compat
 * with future DB-backed lookups; the body is synchronous today.
 */
export async function resolveCombo(modelStr: string): Promise<string[] | null> {
  if (!modelStr) return null;
  const combo = combosCache.get(modelStr);
  if (!combo) return null;
  // Drizzle deserializes `models` because of `mode: "json"`. Trust the type
  // but sanity-guard the shape so a corrupt DB row can't crash the hot path.
  const models = combo.models as unknown;
  if (!Array.isArray(models)) return null;
  return models.filter((m): m is string => typeof m === "string" && m.length > 0);
}

// ---------------------------------------------------------------------------
// Rotation logic
// ---------------------------------------------------------------------------

function normalizeStickyLimit(stickyLimit: number): number {
  return Number.isFinite(stickyLimit) && stickyLimit > 0
    ? Math.floor(stickyLimit)
    : 1;
}

/**
 * Get the rotated model list for this combo invocation.
 *
 * - "fallback":      always returns `[...models]` (original order).
 * - "round-robin":   returns models rotated so models[index] is first.
 *                    Advances `index` once `consecutiveUseCount` reaches
 *                    `stickyLimit` (>= 1).
 *
 * Mirrors 9router/open-sse/services/combo.js:36-65.
 */
export function getRotatedModels(
  models: string[],
  comboName: string,
  strategy: "fallback" | "round-robin",
  stickyLimit: number
): string[] {
  if (!models || models.length <= 1 || strategy !== "round-robin") {
    return [...(models ?? [])];
  }

  const rotationKey = comboName || "__default__";
  const limit = normalizeStickyLimit(stickyLimit);
  const existing = comboRotationState.get(rotationKey);
  const state = existing ?? { index: 0, consecutiveUseCount: 0 };

  const currentIndex = state.index % models.length;
  const rotated = [
    ...models.slice(currentIndex),
    ...models.slice(0, currentIndex),
  ];
  const nextUseCount = state.consecutiveUseCount + 1;

  if (nextUseCount >= limit) {
    comboRotationState.set(rotationKey, {
      index: (currentIndex + 1) % models.length,
      consecutiveUseCount: 0,
    });
  } else {
    comboRotationState.set(rotationKey, {
      index: currentIndex,
      consecutiveUseCount: nextUseCount,
    });
  }

  return rotated;
}

/** Reset rotation state. Omit `comboName` to clear all combos. */
export function resetComboRotation(comboName?: string): void {
  if (comboName) comboRotationState.delete(comboName);
  else comboRotationState.clear();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const COMBO_NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

/**
 * Validate a combo name.
 *
 * - Must match `^[a-zA-Z0-9_.\-]+$`.
 * - Length 1..100.
 * - MUST NOT collide with an existing model id (case-insensitive) — combos
 *   live in the same namespace as upstream models.
 */
export function isValidComboName(
  name: string
): { ok: true } | { ok: false; reason: string } {
  if (typeof name !== "string") {
    return { ok: false, reason: "name must be a string" };
  }
  if (name.length < 1 || name.length > 100) {
    return { ok: false, reason: "name length must be 1-100 characters" };
  }
  if (!COMBO_NAME_REGEX.test(name)) {
    return {
      ok: false,
      reason: "name may only contain letters, digits, underscore, dot, hyphen",
    };
  }
  const lowered = name.toLowerCase();
  for (const model of getAllModels()) {
    if (model.id.toLowerCase() === lowered) {
      return {
        ok: false,
        reason: `name collides with existing model id: ${model.id}`,
      };
    }
  }
  return { ok: true };
}

/**
 * Validate the sub-models array of a combo.
 *
 * - Must be an array of length 1..10.
 * - Every entry must be a non-empty string.
 * - No entry may itself be a combo name (no nested combos).
 */
export function validateComboModels(
  models: string[]
): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(models)) {
    return { ok: false, reason: "models must be an array" };
  }
  if (models.length < 1 || models.length > 10) {
    return { ok: false, reason: "models length must be 1-10" };
  }
  for (let i = 0; i < models.length; i++) {
    const item = models[i];
    if (typeof item !== "string" || item.length === 0) {
      return {
        ok: false,
        reason: `models[${i}] must be a non-empty string`,
      };
    }
    if (getComboByNameCached(item) !== null) {
      return {
        ok: false,
        reason: `models[${i}] = "${item}" is a combo name; nested combos are not allowed`,
      };
    }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Run a combo request: walk the rotated sub-model list and try each one
 * via `routeRequest`. Returns the first success. If every sub-model
 * fails, throws an aggregated error.
 *
 * The body is cloned per attempt so each `routeRequest` call sees its
 * own `model` field; the caller's body is never mutated.
 *
 * `comboName` is included in log messages and is intended to surface
 * later as `_poolprox.comboName` on the request log (Task 5).
 */
export async function handleComboRequest(
  body: ChatCompletionRequest,
  models: string[],
  comboName: string,
  stream: boolean
): Promise<RouteResult & { winningModel: string }> {
  if (!Array.isArray(models) || models.length === 0) {
    throw new Error(`Combo "${comboName}" has no sub-models`);
  }

  const lastErrors: string[] = [];

  for (const subModel of models) {
    const subBody: ChatCompletionRequest = { ...body, model: subModel };
    try {
      const result = await routeRequest(subBody, stream);
      // routeRequest resolves with RouteResult on success. A provider that
      // came back with `success: false` (e.g. exhausted, transient) is the
      // signal to fall through to the next sub-model.
      if (result.result?.success !== false) {
        return { ...result, winningModel: subModel };
      }
      const reason = result.result?.error ?? "provider returned success=false";
      console.warn(
        `[Combos] combo="${comboName}" sub-model="${subModel}" failed: ${reason}`
      );
      lastErrors.push(`${subModel}: ${reason}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Combos] combo="${comboName}" sub-model="${subModel}" threw: ${message}`
      );
      lastErrors.push(`${subModel}: ${message}`);
    }
  }

  throw new Error(`All combo models unavailable: ${lastErrors.join("; ")}`);
}

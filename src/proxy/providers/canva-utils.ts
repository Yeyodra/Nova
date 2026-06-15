import { createHash } from "node:crypto";

/**
 * Canva provider pure utilities.
 *
 * Single responsibility helpers for:
 *   - token masking (logging-safe)
 *   - dedupe key computation (per-minute window)
 *   - slide-count validation (Canva hard cap)
 *   - format validation (pptx | pdf | mp4)
 *
 * No I/O, no globals beyond constants. Consumed by worker dedupe (T6),
 * SSE validation (T11), and provider logging (T8).
 */

export const MAX_SLIDES = 50;
export const DEDUPE_WINDOW_MS = 60_000;

const ALLOWED_FORMATS = ["pptx", "pdf", "mp4"] as const;
export type CanvaFormat = (typeof ALLOWED_FORMATS)[number];

/**
 * Mask a sensitive token for safe logging.
 * Short strings collapse to "***" so we never leak the full value.
 */
export function maskToken(s: string, visible: number = 6): string {
  if (typeof s !== "string" || s.length === 0) return "***";
  if (s.length <= visible * 2) return "***";
  return s.slice(0, visible) + "..." + s.slice(-visible);
}

/**
 * Compute a per-minute dedupe key for (prompt, accountId, format).
 * Identical requests within DEDUPE_WINDOW_MS produce the same key.
 */
export function computeDedupeKey(
  prompt: string,
  accountId: number,
  format: string,
): string {
  const minuteBucket = Math.floor(Date.now() / DEDUPE_WINDOW_MS);
  const payload = `${prompt}|${accountId}|${format}|${minuteBucket}`;
  return createHash("sha256").update(payload).digest("hex");
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Validate slide count against Canva's hard cap.
 */
export function validateSlideCount(n: number): ValidationResult {
  if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n)) {
    return {
      ok: false,
      error: `Slide count must be an integer 1-${MAX_SLIDES} (Canva hard cap)`,
    };
  }
  if (n < 1 || n > MAX_SLIDES) {
    return {
      ok: false,
      error: `Slide count must be 1-${MAX_SLIDES} (Canva hard cap)`,
    };
  }
  return { ok: true };
}

/**
 * Validate output format against the allow-list.
 */
export function validateFormat(s: string): ValidationResult {
  if (typeof s !== "string" || !(ALLOWED_FORMATS as readonly string[]).includes(s)) {
    return {
      ok: false,
      error: `Format must be one of: ${ALLOWED_FORMATS.join(", ")}`,
    };
  }
  return { ok: true };
}

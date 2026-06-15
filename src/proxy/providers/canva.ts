import {
  BaseProvider,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ModelInfo,
  type ProviderHealthResult,
  type ProviderQuotaSnapshot,
  type ProviderResult,
} from "./base";
import type { Account } from "../../db/schema";
import { config } from "../../config";
import { decrypt } from "../../utils/crypto";
import {
  validateSlideCount,
  validateFormat,
  computeDedupeKey,
  maskToken,
  type CanvaFormat,
} from "./canva-utils";
import path from "path";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Canva auth tokens — hybrid shape supporting both legacy image/video flows
 * and the newer PPTX flow.
 *
 * UPPERCASE fields (`CAZ`, `CAU`, `CUI`) are the real Canva cookie names as
 * issued by canva.com. Lowercase fields (`caz`, `cau`, `user_id`) are legacy
 * mirrors kept for backward compatibility with existing accounts captured
 * before PPTX support landed.
 *
 * Use {@link getCookieValue} to read a cookie by canonical UPPERCASE name —
 * it falls back to the legacy lowercase mirror automatically.
 */
export type CanvaTokens = {
  // ─── Legacy lowercase (image/video — keep as-is for backward compat) ───
  caz: string;
  cb?: string;
  cau?: string;
  user_id?: string;
  cl?: string;
  cs?: string;
  all_cookies?: string;

  // ─── Real Canva cookie names (UPPERCASE) ───
  CAZ?: string;
  CAU?: string;
  CUI?: string;
  cf_clearance?: string;

  // ─── Canva API headers ───
  authz: string;       // X-Canva-Authz (~317 chars)
  brand: string;       // X-Canva-Brand
  active_user: string; // X-Canva-Active-User base64
  build_sha?: string;  // X-Canva-Build-Sha

  // ─── Seed design context for context-aware createthread ───
  seed_design?: {
    A: string; // design id
    B: number; // version
    C: string; // extension token
    D: string; // page id
    I: string; // template/designspec id
  };

  // ─── Refresh metadata ───
  captured_at: number;
  refresh_count: number;
  last_health_check?: number;
};

/**
 * Read a Canva cookie value by its canonical UPPERCASE name, falling back
 * to the legacy lowercase mirror when the UPPERCASE field is absent.
 *
 * - `CAZ` falls back to `caz`
 * - `CAU` falls back to `cau`
 * - `CUI` falls back to `user_id`
 * - any other name is returned as-is from the tokens object
 */
export function getCookieValue(tokens: CanvaTokens, name: string): string | undefined {
  if (name === "CAZ") return tokens.CAZ ?? tokens.caz;
  if (name === "CAU") return tokens.CAU ?? tokens.cau;
  if (name === "CUI") return tokens.CUI ?? tokens.user_id;
  const value = (tokens as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

interface WorkerInput {
  mode: "image" | "video" | "quota" | "pptx";
  prompt?: string;
  // For image/video/quota modes: full CanvaTokens (worker reads what it needs).
  // For pptx mode: a narrowed cookies subset (CAZ/CAU/CUI/cf_clearance).
  cookies: CanvaTokens | Record<string, string | undefined>;
  timeout?: number;
  count?: number;
  aspect?: string;
  // PPTX-only fields
  headers?: Record<string, string | undefined>;
  seed_design?: CanvaTokens["seed_design"];
  slide_count?: number;
  format?: CanvaFormat;
  save_local?: boolean;
  account_id?: number | string;
  request_id?: string;
  dedupe_key?: string;
  // T12 re-export shortcut (skips steps 1-4 of the pptx pipeline).
  skip_to_export?: boolean;
  design_id?: string;
  extension?: string;
}

interface WorkerOutput {
  ok: boolean;
  // image / video
  media_url?: string;
  thumbnail_url?: string;
  images?: Array<{ url: string; thumbnail: string; width?: number; height?: number; size?: number }>;
  width?: number;
  height?: number;
  size?: number;
  mode?: string;
  count?: number;
  quota_used?: number;
  quota_limit?: number;
  quota_remaining?: number;
  quota_exhausted?: boolean;
  // pptx
  design_id?: string;
  design_url?: string;
  title?: string;
  slide_count?: number;
  download_url?: string;
  s3_expires_at?: number;
  local_path?: string;
  format?: CanvaFormat;
  credits_used?: number;
  account_id?: number | string;
  // error fields (worker uses both `error` and `details`)
  error?: string;
  details?: string;
}

/**
 * Live progress event emitted by the PPTX worker on stderr (one NDJSON line).
 * Consumers subscribe via {@link CanvaProvider.subscribeToProgress}.
 */
export interface CanvaPptxProgressEvent {
  phase: string;
  progress: number;
  message: string;
}

export type CanvaPptxProgressCallback = (event: CanvaPptxProgressEvent) => void;

/**
 * Optional sibling fields the upstream caller may attach to a chat-completion
 * request when targeting `canva-pptx`. The provider reads them via a single
 * narrow cast at the call boundary so the BaseProvider signature stays clean.
 */
export interface CanvaPptxRequestExtras {
  slide_count?: number;
  format?: string;
  save_local?: boolean;
  request_id?: string;
  metadata?: {
    slide_count?: number;
    format?: string;
    save_local?: boolean;
    request_id?: string;
  };
}

const WORKER_SCRIPT = path.join(import.meta.dir, "canva_worker.py");
const WORKER_TIMEOUT_IMAGE = 120_000; // 120s for image (Canva can take 50-80s)
const WORKER_TIMEOUT_VIDEO = 180_000; // 180s for video
const WORKER_TIMEOUT_PPTX = 180_000; // 180s for PPTX pipeline (validated 37s typical)
const REFRESH_TIMEOUT_MS = 60_000;
const HEALTH_CACHE_TTL_MS = 5 * 60_000;

/**
 * Canva Provider — Image & Video & PPTX generation.
 *
 * Uses a Python subprocess (curl_cffi for image/video, requests for PPTX) for
 * TLS fingerprint impersonation, which is required to bypass Cloudflare's bot
 * detection on canva.com.
 *
 * Live progress for PPTX requests is exposed via
 * {@link CanvaProvider.subscribeToProgress} — T11 (SSE) wires this to a
 * client-facing event stream without changing the BaseProvider signature.
 */
export class CanvaProvider extends BaseProvider {
  name = "canva";

  override ownsModel(model: string): boolean {
    return model.toLowerCase().includes("canva");
  }

  // ─── Progress streaming (PPTX) ────────────────────────────────────
  // Map<request_id, Set<callback>>; callers register before invoking
  // chatCompletion and unregister in a `finally` block.
  private progressSubscribers = new Map<string, Set<CanvaPptxProgressCallback>>();

  // Map<request_id, Bun.Subprocess>: tracks the active python worker
  // process per request_id so T11 (SSE) can SIGTERM on client disconnect.
  // Populated inside runWorker() when progressRequestId is set; cleared in
  // its finally block.
  private activeWorkers = new Map<string, ReturnType<typeof Bun.spawn>>();

  // Health-check result cache (5 min TTL).
  private healthCheckCache = new Map<number, { result: ProviderHealthResult; expiresAt: number }>();

  /**
   * Subscribe to live progress events for a single PPTX request.
   * Returns an unsubscribe function. T11 (SSE) calls this before
   * `chatCompletion` and the unsubscribe in a `finally` block.
   */
  subscribeToProgress(requestId: string, cb: CanvaPptxProgressCallback): () => void {
    let set = this.progressSubscribers.get(requestId);
    if (!set) {
      set = new Set();
      this.progressSubscribers.set(requestId, set);
    }
    set.add(cb);
    return () => this.unsubscribeFromProgress(requestId, cb);
  }

  unsubscribeFromProgress(requestId: string, cb: CanvaPptxProgressCallback): void {
    const set = this.progressSubscribers.get(requestId);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) this.progressSubscribers.delete(requestId);
  }

  private emitProgress(requestId: string, event: CanvaPptxProgressEvent): void {
    const set = this.progressSubscribers.get(requestId);
    if (!set || set.size === 0) return;
    for (const cb of set) {
      try { cb(event); } catch { /* subscriber error must not break worker */ }
    }
  }

  /**
   * Abort a live PPTX worker by request id. Sends SIGTERM to the python
   * subprocess so the worker's signal handler (T7) can clean up gracefully.
   * T11 (SSE) calls this on client disconnect.
   *
   * Returns true if a worker existed and was signaled, false otherwise.
   */
  abortRequest(requestId: string): boolean {
    const proc = this.activeWorkers.get(requestId);
    if (!proc) return false;
    try {
      // Bun.Subprocess.kill accepts a signal name string ("SIGTERM") or number.
      proc.kill("SIGTERM");
      return true;
    } catch {
      return false;
    }
  }

  supportedModels: ModelInfo[] = [
    {
      id: "canva-image",
      object: "model",
      created: Date.now(),
      owned_by: "canva",
      context_window: 1000,
      max_output: 1,
      thinking: false,
      vision: false,
      creditUnit: "image",
      creditRate: 1,
      creditSource: "fixed",
    },
    {
      id: "canva-video",
      object: "model",
      created: Date.now(),
      owned_by: "canva",
      context_window: 1000,
      max_output: 1,
      thinking: false,
      vision: false,
      creditUnit: "image",
      creditRate: 1,
      creditSource: "fixed",
    },
    {
      id: "canva-pptx",
      object: "model",
      created: Date.now(),
      owned_by: "canva",
      context_window: 4000,
      max_output: 1,
      thinking: false,
      vision: false,
      creditUnit: "credit",
      creditRate: 1,
      creditSource: "fixed",
    },
  ];

  // ─── Token helpers ───────────────────────────────────────────────

  private getTokens(account: Account): CanvaTokens | null {
    if (!account.tokens) return null;
    try {
      return (typeof account.tokens === "string" ? JSON.parse(account.tokens) : account.tokens) as CanvaTokens;
    } catch {
      return null;
    }
  }

  // ─── Worker subprocess ───────────────────────────────────────────

  private async runWorker(
    input: WorkerInput,
    timeoutMs: number,
    progressRequestId?: string,
  ): Promise<WorkerOutput> {
    // Write input to a temp file to avoid stdin pipe issues with Bun.spawn
    const tmpFile = join(tmpdir(), `canva_worker_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    await Bun.write(tmpFile, JSON.stringify(input));

    try {
      const proc = Bun.spawn([config.pythonPath, WORKER_SCRIPT], {
        stdin: Bun.file(tmpFile),
        stdout: "pipe",
        stderr: "pipe",
      });

      // Track the live subprocess by requestId so T11 (SSE) can call
      // abortRequest(requestId) to SIGTERM it on client disconnect.
      if (progressRequestId) {
        this.activeWorkers.set(progressRequestId, proc);
      }

      const timer = setTimeout(() => proc.kill(), timeoutMs);
      try {
        // If progress streaming is requested, consume stderr line-by-line
        // concurrently with stdout. Otherwise just wait for exit.
        let stderrPromise: Promise<string>;
        if (progressRequestId) {
          stderrPromise = this.readStderrWithProgress(proc.stderr as ReadableStream<Uint8Array>, progressRequestId);
        } else {
          stderrPromise = new Response(proc.stderr).text();
        }

        await proc.exited;
        const stdout = await new Response(proc.stdout).text();
        const stderr = await stderrPromise;

        if (!stdout.trim()) {
          return { ok: false, error: stderr.trim() || "worker returned empty output" };
        }
        return JSON.parse(stdout.trim());
      } finally {
        clearTimeout(timer);
        if (progressRequestId) this.activeWorkers.delete(progressRequestId);
        // Cleanup temp file
        try { await Bun.file(tmpFile).exists() && (await import("fs/promises")).unlink(tmpFile); } catch {}
      }
    } catch (err) {
      try { (await import("fs/promises")).unlink(tmpFile); } catch {}
      return { ok: false, error: `worker error: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  /**
   * Drain stderr line-by-line, parse `{"phase","progress","message"}` JSON
   * objects, fan them out to subscribers via emitProgress. Non-JSON lines
   * are kept in the returned buffer for error context. Always returns the
   * full stderr text (so the caller still gets diagnostic output).
   */
  private async readStderrWithProgress(stream: ReadableStream<Uint8Array>, requestId: string): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";

    const handleLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.startsWith("{")) {
        try {
          const parsed = JSON.parse(trimmed) as Partial<CanvaPptxProgressEvent>;
          if (
            typeof parsed.phase === "string" &&
            typeof parsed.progress === "number" &&
            typeof parsed.message === "string"
          ) {
            this.emitProgress(requestId, {
              phase: parsed.phase,
              progress: parsed.progress,
              message: parsed.message,
            });
          }
        } catch {
          // Non-progress JSON line — keep in buffer for diagnostics.
        }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      full += chunk;
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) handleLine(line);
    }
    const rest = decoder.decode();
    if (rest) full += rest;
    if (buffer.trim()) handleLine(buffer);
    return full;
  }

  // ─── Chat completion ─────────────────────────────────────────────

  async chatCompletion(account: Account, request: ChatCompletionRequest): Promise<ProviderResult> {
    if (request.model === "canva-pptx") {
      return this.chatCompletionPptx(account, request);
    }
    return this.chatCompletionImageVideo(account, request);
  }

  private async chatCompletionImageVideo(account: Account, request: ChatCompletionRequest): Promise<ProviderResult> {
    const tokens = this.getTokens(account);
    if (!tokens?.caz) {
      return { success: false, error: "No CAZ token available" };
    }

    const mode = request.model === "canva-video" ? "video" : "image";
    const lastUserMsg = [...request.messages].reverse().find((m) => m.role === "user");
    const prompt = typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : JSON.stringify(lastUserMsg?.content || "");

    if (!prompt.trim()) {
      return { success: false, error: "Empty prompt" };
    }

    // Support n parameter for number of images (1-4, default 4 for image, 1 for video)
    const count = mode === "video" ? 1 : Math.min(4, Math.max(1, (request as any).n || 4));
    // Support aspect_ratio / size parameter (e.g. "1:1", "16:9", "9:16")
    const aspect = (request as any).aspect_ratio || (request as any).size || "1:1";
    const timeoutMs = mode === "video" ? WORKER_TIMEOUT_VIDEO : WORKER_TIMEOUT_IMAGE;
    const timeoutSec = Math.floor(timeoutMs / 1000) - 5;

    const result = await this.runWorker(
      { mode, prompt: prompt.trim(), cookies: tokens, timeout: timeoutSec, count, aspect },
      timeoutMs,
    );

    if (!result.ok) {
      if (result.quota_exhausted) {
        return { success: false, error: "Rate limited / quota exhausted", quotaExhausted: true };
      }
      return { success: false, error: result.error || "Canva generation failed" };
    }

    // Build OpenAI-compatible response
    const content = this.formatContent(result, mode);

    const response: ChatCompletionResponse = {
      id: this.generateId(),
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [{
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: count },
    };

    // Real Canva credit consumption (verified by quota probing 2026-05-16):
    //   image n=1 → 3, n=2 → 5, n=3 → 7, n=4 → 10  (≈ 2n + 1, with n=4 rounded up)
    //   video → 25 credits per generation
    let realCreditsUsed: number;
    if (mode === "video") {
      realCreditsUsed = 25;
    } else if (count === 4) {
      realCreditsUsed = 10;
    } else {
      realCreditsUsed = 2 * count + 1;
    }

    return {
      success: true,
      response,
      tokensUsed: count,
      creditsUsed: realCreditsUsed,
      creditSource: "fixed",
    };
  }

  async chatCompletionStream(account: Account, request: ChatCompletionRequest): Promise<ProviderResult> {
    // Canva generation doesn't stream — wrap as non-stream
    return this.chatCompletion(account, request);
  }

  // ─── PPTX chat completion ──────────────────────────────────────

  private async chatCompletionPptx(account: Account, request: ChatCompletionRequest): Promise<ProviderResult> {
    // 1. Extract last user message
    const lastUserMsg = [...request.messages].reverse().find((m) => m.role === "user");
    const prompt = (typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : JSON.stringify(lastUserMsg?.content ?? "")).trim();
    if (!prompt) {
      return { success: false, error: "Empty prompt (HTTP 400)" };
    }

    // 2. Read optional metadata. The image/video branch reads sibling fields
    //    via a single narrow cast — mirror that, but funnel through a typed
    //    extras shape so the cast is intentful and bounded.
    const extras = request as ChatCompletionRequest & CanvaPptxRequestExtras;
    const meta = extras.metadata ?? {};
    const slideCount = (extras.slide_count ?? meta.slide_count ?? 5) | 0;
    const formatRaw = (extras.format ?? meta.format ?? "pptx").toString();
    const saveLocal = extras.save_local ?? meta.save_local ?? true;
    const requestId = extras.request_id ?? meta.request_id ?? this.generateId();

    // 3. Validate slide_count and format via canva-utils.
    const slideCheck = validateSlideCount(slideCount);
    if (!slideCheck.ok) {
      return { success: false, error: `${slideCheck.error} (HTTP 400)` };
    }
    const formatCheck = validateFormat(formatRaw);
    if (!formatCheck.ok) {
      return { success: false, error: `${formatCheck.error} (HTTP 400)` };
    }
    const format = formatRaw as CanvaFormat;

    // 4. Get tokens; auto-refresh once if PPTX-required fields are missing.
    let tokens = this.getTokens(account);
    let refreshedTokens: string | undefined;
    if (!this.hasPptxTokenFields(tokens)) {
      const refresh = await this.refreshToken(account);
      if (!refresh.success || !refresh.tokens) {
        return {
          success: false,
          error: `auth_expired: missing PPTX token fields and refresh failed${refresh.error ? `: ${refresh.error}` : ""}`,
        };
      }
      try {
        tokens = JSON.parse(refresh.tokens) as CanvaTokens;
      } catch {
        return { success: false, error: "auth_expired: refresh returned unparseable tokens" };
      }
      refreshedTokens = refresh.tokens;
      if (!this.hasPptxTokenFields(tokens)) {
        return {
          success: false,
          error: "auth_expired: tokens still incomplete after refresh",
        };
      }
    }
    // After hasPptxTokenFields() the tokens object is non-null. Narrow:
    const t = tokens as CanvaTokens;

    // 5. Build worker stdin payload.
    const cookies: Record<string, string | undefined> = {
      CAZ: getCookieValue(t, "CAZ"),
      CAU: getCookieValue(t, "CAU"),
      CUI: getCookieValue(t, "CUI"),
      cf_clearance: t.cf_clearance,
    };
    const headers: Record<string, string | undefined> = {
      authz: t.authz,
      brand: t.brand,
      active_user: t.active_user,
      build_sha: t.build_sha,
    };
    const dedupeKey = computeDedupeKey(prompt, account.id, format);

    console.log(
      `[canva-pptx] req=${requestId} acct=${account.id} slides=${slideCount} fmt=${format} ` +
      `CAZ=${maskToken(cookies.CAZ ?? "")} authz=${maskToken(headers.authz ?? "")} ` +
      `seed=${t.seed_design ? "present" : "missing"} dedupe=${dedupeKey.slice(0, 8)}`,
    );

    // The login script (scripts/auth/app/providers/canva.py) returns
    // seed_design as a JSON string for return-type compatibility. The token
    // shape allows either dict or JSON string — normalize to dict here so the
    // worker (which validates isinstance(seed_design, dict)) is satisfied.
    let seedDesignForWorker: CanvaTokens["seed_design"] | undefined = t.seed_design;
    if (typeof seedDesignForWorker === "string") {
      try {
        seedDesignForWorker = JSON.parse(seedDesignForWorker) as CanvaTokens["seed_design"];
      } catch {
        seedDesignForWorker = undefined;
      }
    }

    const workerInput: WorkerInput = {
      mode: "pptx",
      prompt,
      cookies,
      headers,
      seed_design: seedDesignForWorker,
      slide_count: slideCount,
      format,
      save_local: saveLocal,
      account_id: account.id,
      request_id: requestId,
      dedupe_key: dedupeKey,
    };

    // 6+7. Spawn worker with progress streaming.
    const result = await this.runWorker(workerInput, WORKER_TIMEOUT_PPTX, requestId);

    // 8. Handle worker errors.
    if (!result.ok) {
      const code = result.error || "api_error";
      const detail = result.details ? `: ${result.details}` : "";
      // Map known codes onto the ProviderResult shape's flags.
      const quotaExhausted = code === "quota_exceeded";
      const rateLimited = code === "cf_blocked";
      return {
        success: false,
        error: `${code}${detail}`,
        quotaExhausted: quotaExhausted || undefined,
        rateLimited: rateLimited || undefined,
        // Forward refreshed tokens if we already refreshed during this call;
        // T13's auth queue / pool persistence will pick them up.
        ...(refreshedTokens ? { tokens: refreshedTokens } : {}),
      };
    }

    // 9. Build markdown reply.
    const content = this.formatPptxContent(result, format, slideCount);

    const response: ChatCompletionResponse = {
      id: requestId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      choices: [{
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };

    // 10. Return everything T10 needs to persist (no DB writes here).
    return {
      success: true,
      response,
      tokensUsed: 0,
      creditsUsed: typeof result.credits_used === "number" ? result.credits_used : 2,
      creditSource: "fixed",
      ...(refreshedTokens ? { tokens: refreshedTokens } : {}),
    };
  }

  // ─── Re-export (T12) ─────────────────────────────────────────────
  /**
   * T12: re-run only the export tail of the PPTX pipeline (steps 5-8) for an
   * existing Canva design whose S3 download URL has expired. Skips the
   * thread+design-generation phases — costs ~1 credit on the Canva side.
   *
   * Returns the parsed worker output verbatim. The caller (image-studio API)
   * is responsible for HTTP-status mapping and DB persistence.
   *
   * `extension` is optional: when omitted the worker fetches it inline via
   * `GET /_ajax/design/{designId}` so callers don't need to cache it.
   */
  async reexport(
    account: Account,
    params: {
      designId: string;
      format: CanvaFormat;
      slideCount: number;
      extension?: string;
      saveLocal?: boolean;
      requestId?: string;
    },
  ): Promise<WorkerOutput> {
    // Re-export only needs the API-call shape (CAZ + authz/brand/active_user) —
    // NOT seed_design (which is only used by step 1's create_thread).
    let tokens = this.getTokens(account);
    if (!tokens || !getCookieValue(tokens, "CAZ") || !tokens.authz || !tokens.brand || !tokens.active_user) {
      const refresh = await this.refreshToken(account);
      if (!refresh.success || !refresh.tokens) {
        return {
          ok: false,
          error: "auth_expired",
          details: `re-export: missing token fields and refresh failed${refresh.error ? `: ${refresh.error}` : ""}`,
        };
      }
      try {
        tokens = JSON.parse(refresh.tokens) as CanvaTokens;
      } catch {
        return { ok: false, error: "auth_expired", details: "re-export: refresh returned unparseable tokens" };
      }
      if (!tokens || !getCookieValue(tokens, "CAZ") || !tokens.authz || !tokens.brand || !tokens.active_user) {
        return { ok: false, error: "auth_expired", details: "re-export: tokens still incomplete after refresh" };
      }
    }
    const t = tokens as CanvaTokens;

    const cookies: Record<string, string | undefined> = {
      CAZ: getCookieValue(t, "CAZ"),
      CAU: getCookieValue(t, "CAU"),
      CUI: getCookieValue(t, "CUI"),
      cf_clearance: t.cf_clearance,
    };
    const headers: Record<string, string | undefined> = {
      authz: t.authz,
      brand: t.brand,
      active_user: t.active_user,
      build_sha: t.build_sha,
    };

    const requestId = params.requestId ?? this.generateId();
    console.log(
      `[canva-pptx] reexport req=${requestId} acct=${account.id} design=${params.designId} ` +
      `slides=${params.slideCount} fmt=${params.format} CAZ=${maskToken(cookies.CAZ ?? "")}`,
    );

    const workerInput: WorkerInput = {
      mode: "pptx",
      skip_to_export: true,
      design_id: params.designId,
      slide_count: params.slideCount,
      format: params.format,
      cookies,
      headers,
      save_local: params.saveLocal ?? true,
      account_id: account.id,
      request_id: requestId,
      ...(params.extension ? { extension: params.extension } : {}),
    };

    return this.runWorker(workerInput, WORKER_TIMEOUT_PPTX);
  }

  /** PPTX flow needs the new-shape token fields. */
  private hasPptxTokenFields(tokens: CanvaTokens | null): tokens is CanvaTokens {
    if (!tokens) return false;
    if (!getCookieValue(tokens, "CAZ")) return false;
    if (!tokens.authz) return false;
    if (!tokens.brand) return false;
    if (!tokens.active_user) return false;
    if (!tokens.seed_design) return false;
    return true;
  }

  /** Markdown body for a successful PPTX worker result. */
  private formatPptxContent(result: WorkerOutput, format: CanvaFormat, requestedSlides: number): string {
    const title = result.title || "Generated Presentation";
    const slideCount = result.slide_count ?? requestedSlides;
    const credits = typeof result.credits_used === "number" ? result.credits_used : 2;
    const designUrl = result.design_url || "";
    const downloadUrl = result.download_url || "";

    let expiresLine = "";
    if (typeof result.s3_expires_at === "number" && result.s3_expires_at > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      const remainingSec = result.s3_expires_at - nowSec;
      if (remainingSec > 0) {
        const mins = Math.round(remainingSec / 60);
        if (mins < 60) {
          expiresLine = `_Download link expires in ~${mins} minute${mins === 1 ? "" : "s"}._`;
        } else {
          const hours = Math.round(mins / 60);
          expiresLine = `_Download link expires in ~${hours} hour${hours === 1 ? "" : "s"}._`;
        }
      } else {
        expiresLine = "_Download link expired._";
      }
    }

    const lines: string[] = [
      `# ${title}`,
      "",
      `**Format**: ${format} | **Slides**: ${slideCount} | **Credits used**: ${credits}`,
      "",
    ];
    if (designUrl) lines.push(`- 🎨 **Edit on Canva**: ${designUrl}`);
    if (downloadUrl) lines.push(`- ⬇️ **Download**: ${downloadUrl}`);
    if (expiresLine) {
      lines.push("");
      lines.push(expiresLine);
    }
    return lines.join("\n");
  }

  // ─── Format response content ────────────────────────────────────

  private formatContent(result: WorkerOutput, mode: string): string {
    const parts: string[] = [];

    if (mode === "video") {
      if (result.media_url) parts.push(`[Video](${result.media_url})`);
      if (result.thumbnail_url) parts.push(`![Thumbnail](${result.thumbnail_url})`);
      if (result.width && result.height) parts.push(`Resolution: ${result.width}x${result.height}`);
      if (result.size) parts.push(`Size: ${(result.size / 1_000_000).toFixed(1)}MB`);
    } else if (result.images && result.images.length > 1) {
      // Multiple images
      for (let i = 0; i < result.images.length; i++) {
        const img = result.images[i]!;
        if (img.url) parts.push(`![Image ${i + 1}](${img.url})`);
      }
    } else {
      // Single image
      if (result.media_url) parts.push(`![Generated Image](${result.media_url})`);
    }

    return parts.join("\n\n") || result.media_url || "Generation completed but no URL returned.";
  }

  // ─── Quota ──────────────────────────────────────────────────────

  async fetchQuota(account: Account): Promise<{
    success: boolean;
    quota?: ProviderQuotaSnapshot;
    error?: string;
  }> {
    const tokens = this.getTokens(account);
    if (!tokens?.caz) {
      return { success: false, error: "No CAZ token" };
    }

    const result = await this.runWorker({ mode: "quota", cookies: tokens }, 15_000);

    if (!result.ok) {
      return { success: false, error: result.error || "Quota fetch failed" };
    }

    return {
      success: true,
      quota: {
        limit: result.quota_limit || 0,
        remaining: result.quota_remaining || 0,
        used: result.quota_used || 0,
        source: "canva.quota",
      },
    };
  }

  // ─── Auth & Health ──────────────────────────────────────────────

  /**
   * Re-run the Camoufox login (T4) to obtain fresh tokens.
   *
   * Spawns `python scripts/auth/login.py --email <e> --password <p>` with
   * `ENOWX_ALLOWED_PROVIDERS=canva`, parses the NDJSON event stream, and
   * extracts the canva provider's `credentials` block from the final
   * `{type:"result", canva:{...}}` event. Preserves the existing
   * `seed_design` if the new tokens lack it. Increments `refresh_count` and
   * sets `captured_at`.
   *
   * Returns `{success:true, tokens: JSON.stringify(newTokens)}` on success.
   * On failure returns `{success:false, error, message?}` — does NOT throw,
   * so the T13 auth queue can decide whether to retry.
   *
   * Note: persistence of the returned tokens is the caller's responsibility
   * (mirrors qoder/codebuddy refreshToken contract); the BaseProvider's
   * caller writes the tokens column.
   */
  async refreshToken(account: Account): Promise<{ success: boolean; tokens?: string; error?: string; message?: string }> {
    if (!account.email || !account.password) {
      return { success: false, error: "missing_credentials", message: "Account is missing email or password" };
    }

    let password: string;
    try {
      password = decrypt(account.password);
    } catch (err) {
      return {
        success: false,
        error: "decrypt_failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    const existing = this.getTokens(account);
    const previousSeedDesign = existing?.seed_design;
    const previousRefreshCount = existing?.refresh_count ?? 0;

    const args = [config.pythonPath, config.authScriptPath, "--email", account.email, "--password", password];
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          ENOWX_ALLOWED_PROVIDERS: "canva",
          PYTHONUNBUFFERED: "1",
          BATCHER_ENABLE_CAMOUFOX: "true",
          BATCHER_CAMOUFOX_HEADLESS: config.headless ? "true" : "false",
          CAMOUFOX_HEADLESS: config.headless ? "true" : "false",
          BATCHER_CONCURRENT: "1",
          BATCHER_PRIORITY: "canva",
        },
      });
    } catch (err) {
      return {
        success: false,
        error: "spawn_failed",
        message: err instanceof Error ? err.message : String(err),
      };
    }

    const timer = setTimeout(() => {
      try { proc.kill(); } catch { /* already dead */ }
    }, REFRESH_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";
    try {
      [stdout, stderr] = await Promise.all([
        new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
        new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
      ]);
      await proc.exited;
    } catch (err) {
      clearTimeout(timer);
      return {
        success: false,
        error: "io_failed",
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      clearTimeout(timer);
    }

    // Parse NDJSON. login.py emits its own `{type:"result", canva:{...}}`
    // wrapper around the per-provider result; canva.py emits an additional
    // `{event:"complete", tokens:{...}}` line on stdout. Either is acceptable
    // — prefer the wrapper because it carries the success flag.
    let credentials: Record<string, unknown> | null = null;
    let lastError: string | undefined;
    for (const rawLine of stdout.split("\n")) {
      const line = rawLine.trim();
      if (!line || !line.startsWith("{")) continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      // Wrapper: {type:"result", canva:{success, credentials, error}}
      if (parsed.type === "result" && parsed.canva && typeof parsed.canva === "object") {
        const cv = parsed.canva as { success?: boolean; credentials?: Record<string, unknown>; error?: string };
        if (cv.success && cv.credentials) {
          credentials = cv.credentials;
        } else if (cv.error) {
          lastError = cv.error;
        }
      }
      // Direct: {event:"complete", tokens:{...}} — fallback if wrapper missing.
      if (!credentials && parsed.event === "complete" && parsed.tokens && typeof parsed.tokens === "object") {
        credentials = parsed.tokens as Record<string, unknown>;
      }
      // Direct error line.
      if (!credentials && parsed.event === "error" && typeof parsed.code === "string") {
        lastError = `${parsed.code}${parsed.message ? `: ${String(parsed.message)}` : ""}`;
      }
    }

    if (!credentials) {
      const stderrTail = stderr.trim().split("\n").slice(-3).join(" | ");
      return {
        success: false,
        error: lastError || "refresh_failed",
        message: stderrTail || `login.py produced no canva credentials (exit ${proc.exitCode ?? "?"})`,
      };
    }

    // Build the merged CanvaTokens payload. Preserve seed_design from the
    // previous tokens if the refresh did not capture a new one (best-effort
    // per T4 — seed_design capture is opportunistic).
    const merged: CanvaTokens = {
      // Required by type
      caz: this.coerceString(credentials.caz) ?? this.coerceString(credentials.CAZ) ?? existing?.caz ?? "",
      authz: this.coerceString(credentials.authz) ?? existing?.authz ?? "",
      brand: this.coerceString(credentials.brand) ?? existing?.brand ?? "",
      active_user: this.coerceString(credentials.active_user) ?? existing?.active_user ?? "",
      captured_at: Date.now(),
      refresh_count: previousRefreshCount + 1,
    };
    // Optional carry-overs
    const optionalStrFields: Array<keyof CanvaTokens> = [
      "cb", "cau", "user_id", "cl", "cs", "all_cookies",
      "CAZ", "CAU", "CUI", "cf_clearance", "build_sha",
    ];
    for (const key of optionalStrFields) {
      const v = this.coerceString((credentials as Record<string, unknown>)[key as string]);
      if (v !== undefined) {
        (merged as Record<string, unknown>)[key as string] = v;
      } else if (existing && (existing as Record<string, unknown>)[key as string] !== undefined) {
        (merged as Record<string, unknown>)[key as string] = (existing as Record<string, unknown>)[key as string];
      }
    }
    // seed_design — credentials may carry it as object or JSON-stringified string.
    const rawSeed = (credentials as Record<string, unknown>).seed_design;
    let newSeed: CanvaTokens["seed_design"] | undefined;
    if (rawSeed && typeof rawSeed === "object") {
      newSeed = rawSeed as CanvaTokens["seed_design"];
    } else if (typeof rawSeed === "string") {
      try { newSeed = JSON.parse(rawSeed) as CanvaTokens["seed_design"]; } catch { /* ignore */ }
    }
    merged.seed_design = newSeed ?? previousSeedDesign;

    // Health-check cache invalidation for this account.
    this.healthCheckCache.delete(account.id);

    console.log(
      `[canva] refreshToken acct=${account.id} CAZ=${maskToken(merged.CAZ ?? merged.caz)} ` +
      `authz=${maskToken(merged.authz)} refresh_count=${merged.refresh_count} ` +
      `seed=${merged.seed_design ? "present" : "missing"}`,
    );

    return { success: true, tokens: JSON.stringify(merged) };
  }

  /** Cast a possibly-unknown value to a non-empty string, else undefined. */
  private coerceString(v: unknown): string | undefined {
    return typeof v === "string" && v.length > 0 ? v : undefined;
  }

  async validateAccount(account: Account): Promise<boolean> {
    const tokens = this.getTokens(account);
    if (!tokens) return false;
    // Old shape: image/video flow only needs CAZ + CAU + user_id.
    const hasOldShape =
      !!getCookieValue(tokens, "CAZ") &&
      !!getCookieValue(tokens, "CAU") &&
      !!getCookieValue(tokens, "CUI");
    // New shape: PPTX flow additionally needs authz + brand + active_user.
    const hasNewShape =
      !!getCookieValue(tokens, "CAZ") &&
      !!getCookieValue(tokens, "CAU") &&
      !!getCookieValue(tokens, "CUI") &&
      !!tokens.authz &&
      !!tokens.brand &&
      !!tokens.active_user;
    return hasOldShape || hasNewShape;
  }

  override async healthCheck(account: Account): Promise<ProviderHealthResult> {
    // Cached result?
    const now = Date.now();
    const cached = this.healthCheckCache.get(account.id);
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }

    const result = await this.runHealthCheck(account);
    this.healthCheckCache.set(account.id, { result, expiresAt: now + HEALTH_CACHE_TTL_MS });
    return result;
  }

  private async runHealthCheck(account: Account): Promise<ProviderHealthResult> {
    const tokens = this.getTokens(account);
    if (!tokens || !getCookieValue(tokens, "CAZ")) {
      return { kind: "missing_tokens", success: false, error: "No Canva CAZ token" };
    }

    const result = await this.runWorker({ mode: "quota", cookies: tokens }, 15_000);
    if (!result.ok) {
      return { kind: "auth_error", success: false, error: result.error || "Quota check failed" };
    }

    const remaining = result.quota_remaining || 0;
    if (remaining <= 0) {
      return {
        kind: "exhausted",
        success: true,
        quota: { limit: result.quota_limit || 0, remaining: 0, used: result.quota_used || 0, source: "canva.quota" },
      };
    }

    return {
      kind: "healthy",
      success: true,
      quota: { limit: result.quota_limit || 0, remaining, used: result.quota_used || 0, source: "canva.quota" },
    };
  }
}

import { Hono } from "hono";
import { routeRequest, getAllModels, providers } from "./router";
import { db } from "../db/index";
import { requestLogs, usageSummary, type NewRequestLog } from "../db/schema";
import { pool } from "./pool";
import { broadcast } from "../ws/index";
import type { ChatCompletionRequest, CreditSource } from "./providers/base";
import {
  validateSlideCount,
  validateFormat,
  type CanvaFormat,
} from "./providers/canva-utils";
import type {
  CanvaProvider,
  CanvaPptxRequestExtras,
  CanvaPptxProgressEvent,
} from "./providers/canva";
import {
  anthropicToOpenAI,
  openAIStreamToAnthropic,
  openAIToAnthropic,
  type AnthropicMessagesRequest,
} from "./transforms/anthropic";
import { isBadUpstreamRequest, isInvalidModelError } from "./errors";
import { prepareLogBody } from "./logging";
import { resolveModelAlias } from "./model-mapping";
import {
  resolveCombo,
  handleComboRequest,
  getRotatedModels,
  getComboByNameCached,
} from "./combos";
import {
  getComboStrategy,
  getComboStickyLimit,
  getComboSpecificStrategy,
} from "./combo-settings";
import { eq, sql } from "drizzle-orm";
import { providerList, refreshByokModels } from "./providers/registry";
import { getCombosCached } from "./combos";

export const proxyRouter = new Hono();

const MAX_REQUEST_LOGS = 50;

/** Upsert a request's stats into the usage_summary table (hourly bucket) */
async function upsertUsageSummary(entry: {
  provider: string;
  model: string;
  status: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  creditsUsed: number;
  durationMs: number;
}) {
  try {
    const bucket = new Date();
    bucket.setMinutes(0, 0, 0); // truncate to hour

    await db.run(sql`
      INSERT INTO usage_summary (bucket, provider, model, total_requests, success_requests, error_requests, prompt_tokens, completion_tokens, total_tokens, credits_used, total_duration_ms)
      VALUES (${bucket.toISOString()}, ${entry.provider || "unknown"}, ${entry.model || "unknown"}, 1,
        ${entry.status === "success" ? 1 : 0}, ${entry.status === "error" ? 1 : 0},
        ${entry.promptTokens || 0}, ${entry.completionTokens || 0}, ${entry.totalTokens || 0},
        ${entry.creditsUsed || 0}, ${entry.durationMs || 0})
      ON CONFLICT (bucket, provider, model) DO UPDATE SET
        total_requests = usage_summary.total_requests + excluded.total_requests,
        success_requests = usage_summary.success_requests + excluded.success_requests,
        error_requests = usage_summary.error_requests + excluded.error_requests,
        prompt_tokens = usage_summary.prompt_tokens + excluded.prompt_tokens,
        completion_tokens = usage_summary.completion_tokens + excluded.completion_tokens,
        total_tokens = usage_summary.total_tokens + excluded.total_tokens,
        credits_used = usage_summary.credits_used + excluded.credits_used,
        total_duration_ms = usage_summary.total_duration_ms + excluded.total_duration_ms
    `);
  } catch (err) {
    console.error("[Proxy] Failed to upsert usage_summary:", err);
  }
}

/** Prune request_logs to keep only the most recent MAX_REQUEST_LOGS rows */
async function pruneRequestLogs() {
  try {
    await db.run(sql`
      DELETE FROM request_logs WHERE id NOT IN (
        SELECT id FROM request_logs ORDER BY created_at DESC LIMIT ${MAX_REQUEST_LOGS}
      )
    `);
  } catch (err) {
    console.error("[Proxy] Failed to prune request_logs:", err);
  }
}

// Prune every 10 requests to avoid running DELETE on every single insert
let requestCounter = 0;

export async function recordRequest(entry: NewRequestLog) {
  try {
    await db.insert(requestLogs).values(entry);
    void upsertUsageSummary({
      provider: entry.provider || "unknown",
      model: entry.model || "unknown",
      status: entry.status,
      promptTokens: entry.promptTokens || 0,
      completionTokens: entry.completionTokens || 0,
      totalTokens: entry.totalTokens || 0,
      creditsUsed: entry.creditsUsed || 0,
      durationMs: entry.durationMs || 0,
    });
    if (++requestCounter % 10 === 0) void pruneRequestLogs();
    broadcast({
      type: "request_log",
      data: { ...entry, email: entry.accountEmail, createdAt: new Date().toISOString() },
    });
  } catch (err) {
    console.error("[Proxy] Failed to record request:", err);
  }
}

function normalizeModelId(model: string): string {
  // Common typo seen from clients: "sonet" -> canonical Anthropic "sonnet".
  return model.replace(/claude-sonet/gi, "claude-sonnet");
}


function computeCredits(
  provider: keyof typeof providers,
  model: string,
  totalTokens: number,
  resultCredits?: number,
  resultCreditSource?: CreditSource
) {
  if (resultCredits !== undefined && resultCredits > 0) {
    return {
      creditsUsed: Math.max(0.01, resultCredits),
      creditSource: resultCreditSource || "upstream" as CreditSource,
    };
  }

  if (totalTokens > 0) {
    return {
      creditsUsed: Math.max(0.01, totalTokens * providers[provider].getProviderCreditRate(model)),
      creditSource: "estimated" as CreditSource,
    };
  }

  return {
    creditsUsed: 0,
    creditSource: resultCreditSource || "estimated" as CreditSource,
  };
}

function extractUsageFromSsePayload(payload: string) {
  if (!payload || payload === "[DONE]") return null;
  try {
    const parsed = JSON.parse(payload);
    const usage = parsed.usage;
    const choice = parsed.choices?.[0];
    const content = String(
      choice?.delta?.content ??
      choice?.message?.content ??
      choice?.text ??
      parsed?.delta?.content ??
      parsed?.content ??
      parsed?.text ??
      ""
    );

    return {
      content,
      promptTokens: Number(usage?.prompt_tokens || usage?.input_tokens || 0),
      completionTokens: Number(usage?.completion_tokens || usage?.output_tokens || 0),
      totalTokens: Number(usage?.total_tokens || 0),
      creditsUsed: Number(usage?.credits_used || usage?.creditsUsed || parsed.credits_used || parsed.creditsUsed || 0),
    };
  } catch {
    return null;
  }
}

/** Accumulate streamed text content across SSE chunks for token estimation */
function extractStreamContent(payload: string): string {
  if (!payload || payload === "[DONE]") return "";
  try {
    const parsed = JSON.parse(payload);
    const choice = parsed.choices?.[0];
    return String(
      choice?.delta?.content ??
      choice?.message?.content ??
      choice?.text ??
      parsed?.delta?.content ??
      parsed?.content ??
      parsed?.text ??
      ""
    );
  } catch {
    return "";
  }
}

function estimateTokensFromText(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function estimateMessagesTokens(messages: ChatCompletionRequest["messages"]): number {
  return (messages || []).reduce((total, msg) => {
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = (msg.content as any[])
        .map((block) => {
          if (block?.type === "text" && typeof block.text === "string") return block.text;
          if (block?.type === "tool_result") {
            if (typeof block.content === "string") return block.content;
            if (Array.isArray(block.content)) {
              return block.content.map((b: any) => b?.text || "").join("");
            }
          }
          return JSON.stringify(block || "");
        })
        .join("");
    } else {
      content = JSON.stringify(msg.content || "");
    }
    return total + estimateTokensFromText(content) + 4;
  }, 0);
}

function isJsonParseError(error: unknown): boolean {
  return error instanceof SyntaxError ||
    (error instanceof Error && /json|parse|unexpected end|unexpected token/i.test(error.message));
}

function openAIErrorResponse(message: string, status: 400 | 503) {
  return {
    error: {
      message,
      type: status === 400 ? "invalid_request_error" : "server_error",
      code: status === 400 ? "invalid_json" : "proxy_error",
    },
  };
}

async function logProxyError(entry: NewRequestLog, label: string) {
  try {
    await db.insert(requestLogs).values(entry);
    // Also track errors in usage_summary
    void upsertUsageSummary({
      provider: entry.provider || "unknown", model: entry.model || "unknown", status: "error",
      promptTokens: 0, completionTokens: 0, totalTokens: 0, creditsUsed: 0, durationMs: entry.durationMs || 0,
    });
    if (++requestCounter % 10 === 0) void pruneRequestLogs();
  } catch (logError) {
    console.error(`[Proxy] Failed to log ${label}:`, logError);
  }
}

function wrapStreamWithUsageFinalizer(
  stream: ReadableStream<Uint8Array>,
  context: {
    logId?: number;
    accountId: number;
    accountEmail: string;
    provider: keyof typeof providers;
    model: string;
    quotaBefore: number;
    startedAt: number;
    fallbackPromptTokens: number;
    fallbackCompletionTokens: number;
    fallbackTotalTokens: number;
    fallbackCreditsUsed: number;
    fallbackCreditSource: CreditSource;
  }
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let reader: ReturnType<ReadableStream<Uint8Array>["getReader"]> | undefined;
  let buffer = "";
  let streamedContent = "";
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let upstreamCredits = 0;
  let finalized = false;
  let streamError = false;

  const observe = (chunk: Uint8Array) => {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed.slice(5);

      // Detect upstream errors in SSE stream (Qoder 403 in body, OpenAI error format)
      const trimmedPayload = payload.trim();
      if (trimmedPayload && trimmedPayload !== "[DONE]") {
        try {
          const parsed = JSON.parse(trimmedPayload);
          // Qoder upstream error: { type: "upstream_error", error: "message" }
          if (parsed.type === "upstream_error") {
            streamError = true;
          }
          // Qoder format: {"code":"112","statusCodeValue":403,"message":"..."}
          if (parsed.statusCodeValue && parsed.statusCodeValue >= 400) {
            streamError = true;
          }
          // OpenAI format: {"error": {"message": "...", "type": "..."}}
          if (parsed.error && (typeof parsed.error === "object" || typeof parsed.error === "string")) {
            streamError = true;
          }
        } catch {
          // not JSON, skip
        }
      }

      // Always extract content for estimation, even if no usage field
      const content = extractStreamContent(trimmedPayload);
      if (content) streamedContent += content;

      const usage = extractUsageFromSsePayload(trimmedPayload);
      if (!usage) continue;
      promptTokens = usage.promptTokens || promptTokens;
      completionTokens = usage.completionTokens || completionTokens;
      totalTokens = usage.totalTokens || totalTokens;
      upstreamCredits = usage.creditsUsed || upstreamCredits;
    }
  };

  const finalize = () => {
    if (finalized) return;
    finalized = true;

    const finalPromptTokens = promptTokens || context.fallbackPromptTokens;
    const finalCompletionTokens = completionTokens || estimateTokensFromText(streamedContent) || context.fallbackCompletionTokens;
    const finalTotalTokens = totalTokens || finalPromptTokens + finalCompletionTokens || context.fallbackTotalTokens;
    const { creditsUsed, creditSource } = computeCredits(
      context.provider,
      context.model,
      finalTotalTokens,
      upstreamCredits || context.fallbackCreditsUsed,
      upstreamCredits > 0 ? "upstream" : context.fallbackCreditSource
    );
    const durationMs = Math.max(0, Date.now() - context.startedAt);

    void (async () => {
      try {
        const isQoder = context.provider === "qoder";

        // If stream had upstream error (403 rate limit, empty stream, etc), don't decrement quota
        // and mark account exhausted for Qoder
        if (streamError) {
          if (isQoder) {
            await pool.markExhausted(context.accountId);
          }
          // Still update request log with error status
          if (context.logId) {
            await db
              .update(requestLogs)
              .set({
                status: "error",
                errorMessage: "Upstream rate limit or quota exceeded",
                durationMs,
              })
              .where(eq(requestLogs.id, context.logId));
          }
          return;
        }

        const creditsToDecrement = isQoder ? 1 : creditsUsed;
        const quotaAfter = context.quotaBefore > 0
          ? await pool.decrementQuota(context.accountId, creditsToDecrement)
          : 0;

        // Qoder: mark exhausted when quota hits 0
        if (isQoder && quotaAfter === 0 && context.quotaBefore > 0) {
          await pool.markExhausted(context.accountId);
        }

        if (context.logId) {
          await db
            .update(requestLogs)
            .set({
              promptTokens: finalPromptTokens,
              completionTokens: finalCompletionTokens,
              totalTokens: finalTotalTokens,
              creditsUsed,
              durationMs,
              accountQuotaAfter: quotaAfter,
            })
            .where(eq(requestLogs.id, context.logId));
        }

        broadcast({
          type: "request_log",
          data: {
            id: context.logId,
            accountId: context.accountId,
            accountEmail: context.accountEmail,
            email: context.accountEmail,
            provider: context.provider,
            model: context.model,
            promptTokens: finalPromptTokens,
            completionTokens: finalCompletionTokens,
            totalTokens: finalTotalTokens,
            creditsUsed,
            status: "success",
            durationMs,
            accountQuotaBefore: context.quotaBefore,
            accountQuotaAfter: quotaAfter,
            createdAt: new Date(context.startedAt).toISOString(),
            requestBody: prepareLogBody({
              model: context.model,
              stream: true,
              _poolprox: {
                creditSource,
                creditUnit: providers[context.provider].getProviderCreditUnit(context.model),
                creditRate: providers[context.provider].getProviderCreditRate(context.model),
              },
            }),
          },
        });

        // Upsert to usage_summary + periodic prune
        void upsertUsageSummary({
          provider: context.provider, model: context.model, status: "success",
          promptTokens: finalPromptTokens, completionTokens: finalCompletionTokens,
          totalTokens: finalTotalTokens, creditsUsed, durationMs,
        });
        if (++requestCounter % 10 === 0) void pruneRequestLogs();
      } catch (error) {
        console.error("[Proxy] Failed to finalize stream usage:", error);
      } finally {
        pool.trackRequestEnd(context.accountId);
      }
    })();
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const streamReader = stream.getReader();
      reader = streamReader;
      try {
        while (true) {
          const { done, value } = await streamReader.read();
          if (done) break;
          observe(value);
          controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
        return;
      } finally {
        try {
          controller.close();
        } catch {
          // The stream may already be closed/cancelled by the client.
        }
        finalize();
      }
    },
    async cancel(reason) {
      try {
        await reader?.cancel(reason);
      } finally {
        finalize();
      }
    },
  });
}

// ─── canva-pptx SSE streaming ─────────────────────────────────────
//
// T11: translate worker progress events emitted via
// CanvaProvider.subscribeToProgress (T8) into OpenAI chat-completion-chunk
// SSE deltas, with 5s heartbeats and SIGTERM-on-disconnect via
// CanvaProvider.abortRequest. This is a self-contained branch — the rest of
// the chat-completion pipeline (combo, byok, multi-account retry) is NOT
// reused because canva-pptx is a single-account, long-running, push-style
// generator that needs end-to-end control of the response stream.

const PPTX_PHASE_EMOJI: Record<string, string> = {
  thread_create: "🧠",
  outline_wait: "📋",
  design_render: "🎨",
  materialize: "💾",
  export: "📤",
  download: "⬇️",
  done: "✅",
};

const PPTX_HEARTBEAT_MS = 5_000;

/** Extract the prompt from the last user message, string-coerce robustly. */
function extractLastUserPromptForPptx(
  messages: ChatCompletionRequest["messages"],
): string {
  const lastUser = [...(messages || [])].reverse().find((m) => m.role === "user");
  if (!lastUser) return "";
  const c = lastUser.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) {
    return (c as any[])
      .map((b) => (b?.type === "text" && typeof b.text === "string" ? b.text : ""))
      .join("")
      .trim();
  }
  return "";
}

/** Build one OpenAI-style chat.completion.chunk SSE frame. */
function buildPptxChunk(
  requestId: string,
  model: string,
  delta: { content?: string; role?: "assistant" } = {},
  finishReason: "stop" | null = null,
): string {
  const chunk = {
    id: requestId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * Handle POST /v1/chat/completions for `canva-pptx` with `stream: true`.
 * Returns a Response carrying a ReadableStream of SSE frames. Validates
 * inputs first, then subscribes to progress, dispatches the worker via
 * CanvaProvider.chatCompletion (which T8 routes to chatCompletionPptx),
 * translates progress events to chunks, heartbeats every 5s during quiet
 * periods, and on client disconnect calls provider.abortRequest(requestId).
 */
function handleCanvaPptxSseStream(
  body: ChatCompletionRequest,
  abortSignal: AbortSignal | undefined,
): Response {
  const provider = providers.canva as unknown as CanvaProvider;
  const model = "canva-pptx";
  const requestId = `chatcmpl-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (s: string) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(s)); } catch { /* stream may already be cancelled */ }
      };
      const safeClose = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* idempotent */ }
      };

      // ── 1. Validate slide_count + format BEFORE dispatching the worker.
      // Two lookup paths supported (document both inline):
      //   (a) body.metadata.slide_count / body.metadata.format
      //   (b) body.tools[0].function.parameters.slide_count / .format
      // Defaults: slide_count=5, format="pptx".
      const extras = body as ChatCompletionRequest & CanvaPptxRequestExtras;
      const meta = extras.metadata ?? {};
      const toolFnParams =
        ((body as { tools?: Array<{ function?: { parameters?: Record<string, unknown> } }> }).tools?.[0]?.function?.parameters) ?? {};
      const slideCountRaw =
        meta.slide_count ??
        (toolFnParams as { slide_count?: number }).slide_count ??
        5;
      const formatRaw =
        meta.format ??
        (toolFnParams as { format?: string }).format ??
        "pptx";
      const slideCount = (slideCountRaw as number) | 0;
      const format = String(formatRaw);

      const prompt = extractLastUserPromptForPptx(body.messages);
      if (!prompt) {
        safeEnqueue(buildPptxChunk(requestId, model, { content: "❌ Error: Empty prompt — provide a non-empty user message.\n" }));
        safeEnqueue(buildPptxChunk(requestId, model, {}, "stop"));
        safeEnqueue("data: [DONE]\n\n");
        safeClose();
        return;
      }

      const sc = validateSlideCount(slideCount);
      if (!sc.ok) {
        safeEnqueue(buildPptxChunk(requestId, model, { content: `❌ Error: ${sc.error}\n` }));
        safeEnqueue(buildPptxChunk(requestId, model, {}, "stop"));
        safeEnqueue("data: [DONE]\n\n");
        safeClose();
        return;
      }
      const fc = validateFormat(format);
      if (!fc.ok) {
        safeEnqueue(buildPptxChunk(requestId, model, { content: `❌ Error: ${fc.error}\n` }));
        safeEnqueue(buildPptxChunk(requestId, model, {}, "stop"));
        safeEnqueue("data: [DONE]\n\n");
        safeClose();
        return;
      }
      const validatedFormat = format as CanvaFormat;

      // ── 2. Pick an account. canva-pptx is single-account (no retry).
      const account = await pool.getNextAccount("canva");
      if (!account) {
        safeEnqueue(buildPptxChunk(requestId, model, { content: "❌ Error: No active canva accounts available.\n" }));
        safeEnqueue(buildPptxChunk(requestId, model, {}, "stop"));
        safeEnqueue("data: [DONE]\n\n");
        safeClose();
        return;
      }

      // Initial role chunk (matches OpenAI's first-chunk convention).
      safeEnqueue(buildPptxChunk(requestId, model, { role: "assistant" }));

      // ── 3. Subscribe BEFORE dispatching to avoid missing thread_create.
      let lastEventAt = Date.now();
      const unsubscribe = provider.subscribeToProgress(requestId, (event: CanvaPptxProgressEvent) => {
        lastEventAt = Date.now();
        const icon = PPTX_PHASE_EMOJI[event.phase] ?? "•";
        const pct = Math.max(0, Math.min(100, Math.round(event.progress * 100)));
        const line = `${icon} ${event.message} (${pct}%)\n`;
        safeEnqueue(buildPptxChunk(requestId, model, { content: line }));
      });

      // ── 4. Heartbeat: while no progress in last 5s and stream still open,
      // emit an SSE comment line. Independent timer — does NOT block dispatch.
      const heartbeat = setInterval(() => {
        if (closed) return;
        if (Date.now() - lastEventAt >= PPTX_HEARTBEAT_MS) {
          safeEnqueue(":keepalive\n\n");
        }
      }, PPTX_HEARTBEAT_MS);

      // ── 5. Disconnect detection: when the client aborts, abort the worker
      // (SIGTERM via provider.abortRequest), unsubscribe, clear heartbeat.
      const onAbort = () => {
        try { provider.abortRequest(requestId); } catch { /* best-effort */ }
      };
      abortSignal?.addEventListener("abort", onAbort);

      // ── 6. Build the chat completion request payload exactly as the API
      // layer (T10) does: spread original body + canva-pptx extras + this
      // request_id (so T8 emits progress under the same id we subscribed to).
      const dispatchRequest: ChatCompletionRequest & CanvaPptxRequestExtras = {
        ...body,
        model: "canva-pptx",
        stream: false,
        slide_count: slideCount,
        format: validatedFormat,
        save_local: true,
        request_id: requestId,
        metadata: {
          ...meta,
          slide_count: slideCount,
          format: validatedFormat,
          save_local: true,
          request_id: requestId,
        },
      };

      // Redacted log (no full messages — could contain secrets).
      console.log(`[proxy:canva-pptx-sse] req=${requestId} acct=${account.id} slides=${slideCount} fmt=${validatedFormat} prompt_len=${prompt.length}`);

      const quotaBefore = Number(account.quotaRemaining || 0);
      let trackingActive = false;
      try {
        pool.trackRequestStart(account.id);
        trackingActive = true;

        // ── 7. Dispatch the worker. provider.chatCompletion routes to
        // chatCompletionPptx because model === "canva-pptx" (T8 dispatch).
        const result = await provider.chatCompletion(account, dispatchRequest);
        const durationMs = Date.now() - startedAt;

        if (!result.success || !result.response) {
          // Worker-level failure. Translate via T10's error-classification
          // family in spirit (we don't set an HTTP status — already streaming).
          const errorMessage = result.error || "PPTX generation failed";
          safeEnqueue(buildPptxChunk(requestId, model, { content: `❌ Error: ${errorMessage}\n` }));
          safeEnqueue(buildPptxChunk(requestId, model, {}, "stop"));
          safeEnqueue("data: [DONE]\n\n");

          void recordRequest({
            accountId: account.id,
            accountEmail: account.email,
            provider: "canva",
            model,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            creditsUsed: 0,
            status: "error",
            durationMs,
            errorMessage,
            requestBody: prepareLogBody({ model, stream: true, _poolprox: { source: "proxy.canva-pptx-sse", request_id: requestId } }),
            accountQuotaBefore: quotaBefore,
            accountQuotaAfter: quotaBefore,
          });
          return;
        }

        // Persist refreshed tokens if the provider rotated them mid-call.
        if (result.tokens) {
          try { await pool.updateTokens(account.id, result.tokens); } catch { /* best-effort */ }
        }
        await pool.markUsed(account.id);

        // ── 8. Final result: write the markdown content T8's
        // formatPptxContent produced as ONE final chunk + finish_reason stop.
        const finalContent =
          (result.response.choices?.[0]?.message?.content as string | undefined) ?? "";
        safeEnqueue(buildPptxChunk(requestId, model, { content: finalContent }, "stop"));
        safeEnqueue("data: [DONE]\n\n");

        const creditsUsed = Number(result.creditsUsed || 0);
        void recordRequest({
          accountId: account.id,
          accountEmail: account.email,
          provider: "canva",
          model,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          creditsUsed,
          status: "success",
          durationMs,
          accountQuotaBefore: quotaBefore,
          accountQuotaAfter: Math.max(0, quotaBefore - creditsUsed),
          // createdAt left undefined: schema $defaultFn(() => new Date()).
          requestBody: prepareLogBody({ model, stream: true, _poolprox: { source: "proxy.canva-pptx-sse", request_id: requestId } }),
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        safeEnqueue(buildPptxChunk(requestId, model, { content: `❌ Error: ${errMsg}\n` }));
        safeEnqueue(buildPptxChunk(requestId, model, {}, "stop"));
        safeEnqueue("data: [DONE]\n\n");
        broadcast({ type: "request_error", data: { model, error: errMsg } });
      } finally {
        // ── 9. ALWAYS clean up: unsubscribe, clear heartbeat, drop abort
        // listener, abort the worker if the client disconnected, end tracking.
        try { unsubscribe(); } catch { /* idempotent */ }
        try { clearInterval(heartbeat); } catch { /* idempotent */ }
        try { abortSignal?.removeEventListener("abort", onAbort); } catch { /* idempotent */ }
        if (abortSignal?.aborted) {
          try { provider.abortRequest(requestId); } catch { /* best-effort */ }
        }
        if (trackingActive) {
          try { pool.trackRequestEnd(account.id); } catch { /* best-effort */ }
        }
        safeClose();
      }
    },
    cancel() {
      // Client cancelled the stream. abortSignal-driven cleanup above runs
      // via the controller's start() finally block. Nothing extra here.
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function handleChatCompletion(body: ChatCompletionRequest) {
  // Rewrite the incoming model id to its mapped target (CLI integration, e.g.
  // the assistant's hardcoded haiku/sonnet/opus ids -> a model in the pool).
  body = { ...body, model: resolveModelAlias(normalizeModelId(body.model)) };
  const isStream = body.stream === true;

  // Combo resolution: if the resolved model id is a combo, fan out to
  // its sub-models via the combo engine; otherwise route normally.
  const comboModels = await resolveCombo(body.model);
  const originalComboName = comboModels ? body.model : null;
  let routeOutcome:
    | Awaited<ReturnType<typeof routeRequest>>
    | Awaited<ReturnType<typeof handleComboRequest>>;
  if (comboModels && originalComboName) {
    const combo = getComboByNameCached(originalComboName);
    const override = getComboSpecificStrategy(originalComboName);
    const strategy = (override?.strategy ?? combo?.strategy ?? getComboStrategy()) as
      | "fallback"
      | "round-robin";
    const stickyLimit =
      override?.stickyLimit ?? combo?.stickyLimit ?? getComboStickyLimit();
    const rotated = getRotatedModels(comboModels, originalComboName, strategy, stickyLimit);
    const comboOutcome = await handleComboRequest(body, rotated, originalComboName, isStream);
    routeOutcome = comboOutcome;
    // Replace combo name with the actual upstream model that succeeded so
    // downstream token tracking, log writing, and usage upsert all record
    // the real model. Combo name is preserved separately in _poolprox.
    body = { ...body, model: comboOutcome.winningModel };
  } else {
    routeOutcome = await routeRequest(body, isStream);
  }
  const { result, account, provider, durationMs } = routeOutcome;
  let shouldReleaseTracking = true;

  try {
    const promptTokens = result.promptTokens || result.response?.usage?.prompt_tokens || estimateMessagesTokens(body.messages);
    const completionTokens = result.completionTokens || result.response?.usage?.completion_tokens || 0;
    const totalTokens = result.tokensUsed || result.response?.usage?.total_tokens || promptTokens + completionTokens;

  const { creditsUsed, creditSource } = computeCredits(
    provider,
    body.model,
    totalTokens,
    result.creditsUsed,
    result.creditSource
  );

    // Qoder: check daily quota reset and use 1 credit per request
    const isQoder = provider === "qoder";
    const quotaBefore = isQoder
      ? await pool.checkAndResetDailyQuota(account.id, 200)
      : Number(account.quotaRemaining || 0);

    const creditsToDecrement = isQoder ? 1 : creditsUsed;
    const quotaAfter = isStream
      ? quotaBefore
      : quotaBefore > 0
        ? await pool.decrementQuota(account.id, creditsToDecrement)
        : 0;

    // Qoder: mark exhausted when quota hits 0
    if (isQoder && !isStream && quotaAfter === 0 && quotaBefore > 0) {
      await pool.markExhausted(account.id);
    }

  const logEntry = {
    accountId: account.id,
    accountEmail: account.email,
    provider,
    model: body.model,
    promptTokens,
    completionTokens,
    totalTokens,
    creditsUsed,
    status: "success" as const,
    durationMs,
    requestBody: prepareLogBody({
      ...body,
      _poolprox: {
        creditSource,
        creditUnit: providers[provider].getProviderCreditUnit(body.model),
        creditRate: providers[provider].getProviderCreditRate(body.model),
        comboName: originalComboName ?? undefined,
      },
    }),
    responseBody: prepareLogBody(result.response),
    accountQuotaBefore: quotaBefore,
    accountQuotaAfter: quotaAfter,
  };

    if (isStream && result.stream) {
      const [created] = await db.insert(requestLogs).values(logEntry).returning();
      const createdAt = created?.createdAt?.toISOString?.() || new Date().toISOString();

    broadcast({
      type: "request_started",
      data: { ...logEntry, id: created?.id, email: account.email, createdAt },
    });

    result.stream = wrapStreamWithUsageFinalizer(result.stream, {
      logId: created?.id,
      accountId: account.id,
      accountEmail: account.email,
      provider,
      model: body.model,
      quotaBefore,
      startedAt: Date.now() - durationMs,
      fallbackPromptTokens: promptTokens,
      fallbackCompletionTokens: completionTokens,
      fallbackTotalTokens: totalTokens,
      fallbackCreditsUsed: creditsUsed,
      fallbackCreditSource: creditSource,
    });

      shouldReleaseTracking = false;
      return { result, isStream };
    }

  await db.insert(requestLogs).values(logEntry);

  // Upsert to usage_summary + periodic prune
  void upsertUsageSummary({
    provider, model: body.model, status: "success",
    promptTokens, completionTokens, totalTokens, creditsUsed, durationMs,
  });
  if (++requestCounter % 10 === 0) void pruneRequestLogs();

  broadcast({
    type: "request_log",
    data: { ...logEntry, email: account.email, createdAt: new Date().toISOString() },
  });

    return { result, isStream };
  } finally {
    if (shouldReleaseTracking) pool.trackRequestEnd(account.id);
  }
}

/**
 * GET /v1/models - List available models
 */
proxyRouter.get("/v1/models", async (c) => {
  // Ensure BYOK cache is fresh before listing models.
  // Without this, the sync getModels() returns stale/empty supportedModels.
  await refreshByokModels();
  const models = getAllModels();
  // Append combos as virtual models (owned_by="combo"). Combos lack provider
  // fields (vision/pricing/context_window) — only the OpenAI ModelObject
  // minimum (id, object, created, owned_by) is set.
  const comboEntries = getCombosCached().map((combo) => ({
    id: combo.name,
    object: "model" as const,
    created: combo.createdAt
      ? Math.floor(
          (combo.createdAt instanceof Date
            ? combo.createdAt.getTime()
            : Number(combo.createdAt)) / 1000,
        )
      : Math.floor(Date.now() / 1000),
    owned_by: "combo" as const,
  }));
  return c.json({
    object: "list",
    data: [...models, ...comboEntries],
  });
});

/**
 * POST /v1/chat/completions - Chat completion (streaming + non-streaming)
 */
proxyRouter.post("/v1/chat/completions", async (c) => {
  let body: ChatCompletionRequest;
  try {
    body = await c.req.json<ChatCompletionRequest>();
  } catch (error) {
    if (isJsonParseError(error)) {
      return c.json(openAIErrorResponse("Invalid JSON request body", 400), 400);
    }
    throw error;
  }

  // Validate request
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json(
      {
        error: {
          message: "messages is required and must be a non-empty array",
          type: "invalid_request_error",
          code: "invalid_messages",
        },
      },
      400
    );
  }

  if (!body.model) {
    return c.json(
      {
        error: {
          message: "model is required",
          type: "invalid_request_error",
          code: "invalid_model",
        },
      },
      400
    );
  }

  body.model = normalizeModelId(body.model);
  const isStream = body.stream === true;

  // ── canva-pptx streaming branch (T11) ─────────────────────────
  // Push-style SSE driven by progress events from the python worker
  // (T7 → T8 → subscribeToProgress). The non-streaming branch falls
  // through to the generic handleChatCompletion path below — T8's
  // chatCompletion() already dispatches canva-pptx → chatCompletionPptx.
  if (body.model === "canva-pptx" && isStream) {
    return handleCanvaPptxSseStream(body, c.req.raw.signal);
  }

  try {
    const { result } = await handleChatCompletion(body);

    if (isStream && result.stream) {
      // Return SSE stream
      return new Response(result.stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // Return JSON response
    return c.json(result.response);
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const mappedModel = resolveModelAlias(normalizeModelId(body.model));

    // Log the error without masking the original proxy failure.
    const provider = pool.getProviderForModel(mappedModel) || "unknown";
    await logProxyError({
      provider,
      model: mappedModel,
      status: "error",
      errorMessage,
      requestBody: prepareLogBody({ ...body, model: mappedModel, _poolprox: { originalModel: body.model } }),
      responseBody: prepareLogBody({ error: errorMessage }),
      durationMs: 0,
    }, "chat completion error");

    broadcast({
      type: "request_error",
      data: { model: mappedModel, error: errorMessage },
    });

    const invalidModel = isInvalidModelError(errorMessage);
    const badUpstreamRequest = isBadUpstreamRequest(errorMessage);

    return c.json(
      {
        error: {
          message: errorMessage,
          type: invalidModel || badUpstreamRequest ? "invalid_request_error" : "server_error",
          code: invalidModel ? "invalid_model" : badUpstreamRequest ? "invalid_request" : "proxy_error",
        },
      },
      invalidModel || badUpstreamRequest ? 400 : 503
    );
  }
});

/**
 * POST /v1/messages - Anthropic Messages-compatible endpoint
 */
proxyRouter.post("/v1/messages", async (c) => {
  let body: AnthropicMessagesRequest;
  try {
    body = await c.req.json<AnthropicMessagesRequest>();
  } catch (error) {
    if (isJsonParseError(error)) {
      return c.json({ type: "error", error: { type: "invalid_request_error", message: "Invalid JSON request body" } }, 400);
    }
    throw error;
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return c.json({ type: "error", error: { type: "invalid_request_error", message: "messages is required and must be a non-empty array" } }, 400);
  }

  if (!body.model) {
    return c.json({ type: "error", error: { type: "invalid_request_error", message: "model is required" } }, 400);
  }

  body.model = normalizeModelId(body.model);
  const openAIRequest = anthropicToOpenAI(body);

  try {
    const { result } = await handleChatCompletion(openAIRequest);

    if (body.stream === true && result.stream) {
      return new Response(openAIStreamToAnthropic(result.stream, body), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    return c.json(openAIToAnthropic(result.response, body));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const mappedModel = resolveModelAlias(normalizeModelId(body.model));
    const provider = pool.getProviderForModel(mappedModel) || "unknown";
    await logProxyError({
      provider,
      model: mappedModel,
      status: "error",
      errorMessage,
      requestBody: prepareLogBody({ ...body, model: mappedModel, _poolprox: { originalModel: body.model } }),
      responseBody: prepareLogBody({ error: errorMessage }),
      durationMs: 0,
    }, "messages error");

    broadcast({ type: "request_error", data: { model: mappedModel, error: errorMessage } });

    const invalidModel = isInvalidModelError(errorMessage);
    const badUpstreamRequest = isBadUpstreamRequest(errorMessage);
    return c.json({
      type: "error",
      error: {
        type: invalidModel || badUpstreamRequest ? "invalid_request_error" : "api_error",
        message: errorMessage,
      },
    }, invalidModel || badUpstreamRequest ? 400 : 503);
  }
});

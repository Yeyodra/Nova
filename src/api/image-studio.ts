import { Hono, type Context } from "hono";
import { providers, routeRequest } from "../proxy/router";
import { recordRequest } from "../proxy/index";
import { prepareLogBody } from "../proxy/logging";
import { pool } from "../proxy/pool";
import { db } from "../db/index";
import { accounts, imageStudioChats, imageStudioResults } from "../db/schema";
import { desc, eq, asc } from "drizzle-orm";
import type { ChatCompletionRequest } from "../proxy/providers/base";
import {
  validateSlideCount,
  validateFormat,
  computeDedupeKey,
  type CanvaFormat,
} from "../proxy/providers/canva-utils";
import type { CanvaPptxRequestExtras, CanvaProvider } from "../proxy/providers/canva";

type StatusCode = 400 | 401 | 409 | 429 | 500 | 502 | 503 | 504;

/**
 * Map a Canva PPTX provider error string (which embeds the worker code prefix
 * — e.g. `auth_expired: ...`, `quota_exceeded: ...`) to an HTTP status code.
 * Source codes thrown by T8 chatCompletionPptx: auth_expired, quota_exceeded,
 * cf_blocked, aborted, duplicate, slide_cap_exceeded, timeout, api_error.
 */
function mapPptxErrorToStatus(errMsg: string): StatusCode {
  const code = (errMsg || "").split(":")[0]?.trim().toLowerCase() ?? "";
  if (code === "slide_cap_exceeded" || code === "unsupported_format") return 400;
  if (errMsg.toLowerCase().includes("(http 400)")) return 400;
  if (code === "auth_expired") return 401;
  if (code === "duplicate") return 409;
  if (code === "quota_exceeded") return 429;
  if (code === "cf_blocked") return 503;
  if (code === "timeout" || code === "aborted") return 504;
  return 500;
}

/**
 * Parse the PPTX markdown reply produced by formatPptxContent in canva.ts (T8)
 * to recover the structured fields T8 does NOT surface on ProviderResult.
 * Markdown shape (from canva.ts lines 649-660):
 *   # {title}
 *   **Format**: {format} | **Slides**: {N} | **Credits used**: {C}
 *   - 🎨 **Edit on Canva**: {designUrl}
 *   - ⬇️ **Download**: {downloadUrl}
 */
function parsePptxMarkdown(content: string): {
  title: string | null;
  designUrl: string | null;
  downloadUrl: string | null;
} {
  const titleMatch = content.match(/^# (.+)$/m);
  const designMatch = content.match(/\*\*Edit on Canva\*\*:\s*(\S+)/);
  const downloadMatch = content.match(/\*\*Download\*\*:\s*(\S+)/);
  return {
    title: titleMatch?.[1]?.trim() || null,
    designUrl: designMatch?.[1]?.trim() || null,
    downloadUrl: downloadMatch?.[1]?.trim() || null,
  };
}

export const imageStudioRouter = new Hono();

const ASSIST_SYSTEM_PROMPT = `Kamu adalah AI Prompt Engineer untuk Canva Magic Media (image generator).

Tugasmu:
1. PERTANYAAN PERTAMA WAJIB tentang STYLE/GAYA VISUAL gambar (realistis, anime, cartoon, 3D render, oil painting, watercolor, pixel art, dll), KECUALI user sudah nyebut style-nya di prompt awal — kalau udah, langsung skip ke detail lain.
2. Setelah style, tanya MAKSIMAL 3 pertanyaan klarifikasi lain yang relevan untuk memperkaya prompt (mood, lighting, palet warna, sudut pandang, detail subjek). Jangan lebih dari 3.
3. Setiap pertanyaan WAJIB disertai 3-5 pilihan jawaban relevan yang user bisa klik. User juga bebas ngetik jawaban custom kalau gak ada yang cocok.
4. Setelah info cukup (1-2 putaran), susun prompt final dalam Bahasa Inggris yang deskriptif dan padat (maks 80 kata).

ATURAN PENTING — JANGAN MELANGGAR:
- JANGAN PERNAH nanya hal yang SUDAH dijawab user di pesan sebelumnya. Cek riwayat chat dulu — kalau user udah jawab style "anime", JANGAN nanya style lagi dengan kata-kata berbeda.
- JANGAN ulang pertanyaan yang sama dengan rephrase (misal "gaya visualnya?" lalu "stylenya gimana?" — itu duplicate, dilarang).
- Setiap pertanyaan baru HARUS topik berbeda dari pertanyaan sebelumnya (style → mood → lighting, bukan style → style lagi).
- Kalau user jawab "udah cukup" / "langsung aja" / "generate" / sejenisnya, langsung kasih finalPrompt.

OUTPUT FORMAT:
- Setiap balasan kamu HARUS dibungkus blok JSON dalam tag <ASSIST_JSON>...</ASSIST_JSON>
- Skema:
  {
    "message": "kalimat pengantar/pertanyaan kamu (Bahasa Indonesia santai)",
    "options": ["pilihan 1", "pilihan 2", "pilihan 3"],
    "finalPrompt": null
  }
- Saat siap kasih final prompt, set "options" ke [] dan isi "finalPrompt" dengan English prompt-nya:
  {
    "message": "Mantap! Ini final prompt-nya, klik Generate untuk eksekusi.",
    "options": [],
    "finalPrompt": "..."
  }

Jangan tulis apapun di luar tag <ASSIST_JSON>. Bahasa percakapan Indonesia santai, jangan terlalu panjang.`;

const IMAGE_PROVIDER_PREFIX = ["canva-"];

function isImageOrVideoModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  if (IMAGE_PROVIDER_PREFIX.some((p) => lower.startsWith(p))) return true;
  if (lower.includes("image") || lower.includes("video")) return true;
  return false;
}

imageStudioRouter.get("/assist-models", (c) => {
  const models: Array<{ id: string; provider: string }> = [];
  for (const [providerName, provider] of Object.entries(providers)) {
    for (const model of provider.supportedModels) {
      if (isImageOrVideoModel(model.id)) continue;
      models.push({ id: model.id, provider: providerName });
    }
  }
  return c.json({ data: models });
});

imageStudioRouter.post("/assist", async (c) => {
  const body = await c.req.json<{
    message: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    model?: string;
  }>();

  const userMessage = (body.message || "").trim();
  if (!userMessage) {
    return c.json({ error: "message is required" }, 400);
  }

  const assistModel = body.model || "auto";
  const historyMessages = (body.history || []).map((m) => ({ role: m.role, content: m.content }));

  const request: ChatCompletionRequest = {
    model: assistModel,
    messages: [
      { role: "system", content: ASSIST_SYSTEM_PROMPT },
      ...historyMessages,
      { role: "user", content: userMessage },
    ],
    stream: false,
  };

  let routed;
  try {
    routed = await routeRequest(request, false);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: errMsg }, 502);
  }

  const { result, account, provider: providerName, durationMs } = routed;
  const quotaBefore = Number(account.quotaRemaining || 0);

  try {
    if (!result.success || !result.response) {
      void recordRequest({
        accountId: account.id,
        accountEmail: account.email,
        provider: providerName,
        model: assistModel,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        creditsUsed: 0,
        status: "error",
        durationMs,
        errorMessage: result.error || "Assist call failed",
        requestBody: prepareLogBody({ ...request, _poolprox: { source: "image-studio.assist" } }),
        accountQuotaBefore: quotaBefore,
        accountQuotaAfter: quotaBefore,
      });
      return c.json({ error: result.error || "Assist call failed" }, 502);
    }

    const reply = (result.response.choices?.[0]?.message?.content as string) || "";

    let message = reply.trim();
    let options: string[] = [];
    let finalPrompt: string | null = null;

    const jsonMatch = reply.match(/<ASSIST_JSON>([\s\S]*?)<\/ASSIST_JSON>/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        const parsed = JSON.parse(jsonMatch[1].trim());
        message = typeof parsed.message === "string" ? parsed.message : message;
        options = Array.isArray(parsed.options)
          ? parsed.options.filter((o: unknown) => typeof o === "string").slice(0, 6)
          : [];
        finalPrompt = typeof parsed.finalPrompt === "string" && parsed.finalPrompt.trim()
          ? parsed.finalPrompt.trim()
          : null;
      } catch {
        message = reply.replace(/<ASSIST_JSON>[\s\S]*?<\/ASSIST_JSON>/g, "").trim() || reply.trim();
      }
    } else {
      const finalMatch = reply.match(/<FINAL_PROMPT>([\s\S]*?)<\/FINAL_PROMPT>/);
      if (finalMatch && finalMatch[1]) {
        finalPrompt = finalMatch[1].trim();
        message = reply.replace(/<FINAL_PROMPT>[\s\S]*?<\/FINAL_PROMPT>/g, "").trim();
      }
    }

    const promptTokens = Number(result.promptTokens || result.response?.usage?.prompt_tokens || 0);
    const completionTokens = Number(result.completionTokens || result.response?.usage?.completion_tokens || 0);
    const totalTokens = Number(result.tokensUsed || result.response?.usage?.total_tokens || promptTokens + completionTokens);
    const creditsUsed = Number(result.creditsUsed || 0);

    const quotaAfter = creditsUsed > 0 && quotaBefore > 0
      ? await pool.decrementQuota(account.id, creditsUsed)
      : quotaBefore;

    void recordRequest({
      accountId: account.id,
      accountEmail: account.email,
      provider: providerName,
      model: assistModel,
      promptTokens,
      completionTokens,
      totalTokens,
      creditsUsed,
      status: "success",
      durationMs,
      requestBody: prepareLogBody({ ...request, _poolprox: { source: "image-studio.assist" } }),
      responseBody: prepareLogBody(result.response),
      accountQuotaBefore: quotaBefore,
      accountQuotaAfter: quotaAfter,
    });

    return c.json({ reply: message, options, finalPrompt });
  } finally {
    pool.trackRequestEnd(account.id);
  }
});

const VALID_ASPECTS = new Set(["1:1", "16:9", "5:4", "4:3", "2:1", "9:16", "4:5", "3:4"]);

/**
 * Handle a PPTX generation request via the canva-pptx model (T10).
 *
 * Validates slide_count (1-50) and format (pptx | pdf | mp4), routes through
 * the existing dispatcher, parses the markdown reply for structured fields,
 * persists into imageStudioResults (using the new T1 columns), and returns a
 * PPTX-specific JSON envelope.
 *
 * Image/video branches are untouched; this helper only runs when type==="pptx".
 */
async function handlePptxGenerate(
  c: Context,
  ctx: {
    prompt: string;
    chatId: number | null;
    body: {
      format?: string;
      slideCount?: number;
    };
  },
) {
  const { prompt, chatId, body } = ctx;

  // ─── 1. Validate slide_count and format using canva-utils (T3) ───
  const rawSlideCount = body.slideCount === undefined ? 5 : Number(body.slideCount);
  const slideCheck = validateSlideCount(rawSlideCount);
  if (!slideCheck.ok) {
    return c.json({ error: slideCheck.error }, 400);
  }
  const slideCount = rawSlideCount;

  const rawFormat = (body.format ?? "pptx").toString();
  const formatCheck = validateFormat(rawFormat);
  if (!formatCheck.ok) {
    return c.json({ error: formatCheck.error }, 400);
  }
  const format = rawFormat as CanvaFormat;

  // ─── 2. Build the internal ChatCompletionRequest ────────────────
  const model = "canva-pptx";
  const request = {
    model,
    messages: [{ role: "user" as const, content: prompt }],
    stream: false,
    metadata: {
      slide_count: slideCount,
      format,
      save_local: true,
    },
  } as ChatCompletionRequest & CanvaPptxRequestExtras;

  // ─── 3. Dispatch through the same router used by image/video ────
  let routed;
  try {
    routed = await routeRequest(request, false);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: errMsg }, 502);
  }

  const { result, account, provider: providerName, durationMs } = routed;
  const quotaBefore = Number(account.quotaRemaining || 0);

  try {
    // ─── 4. Handle worker-level errors with code → status mapping ─
    if (!result.success || !result.response) {
      const errorMessage = result.error || "PPTX generation failed";
      const errorCode = errorMessage.split(":")[0]?.trim() || "api_error";
      const status = mapPptxErrorToStatus(errorMessage);

      void recordRequest({
        accountId: account.id,
        accountEmail: account.email,
        provider: providerName,
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        creditsUsed: 0,
        status: "error",
        durationMs,
        errorMessage,
        requestBody: prepareLogBody({ ...request, _poolprox: { source: "image-studio.generate.pptx" } }),
        accountQuotaBefore: quotaBefore,
        accountQuotaAfter: quotaBefore,
      });

      const payload: { error: string; code?: string; retry?: boolean } = {
        error: errorMessage,
        code: errorCode,
      };
      if (status === 401) payload.retry = true;
      return c.json(payload, status);
    }

    // ─── 5. Parse markdown to recover structured fields T8 doesn't surface ─
    const content = (result.response.choices?.[0]?.message?.content as string) || "";
    const parsed = parsePptxMarkdown(content);
    const title = parsed.title;
    const designUrl = parsed.designUrl;
    const downloadUrl = parsed.downloadUrl;

    const creditsUsed = Number(result.creditsUsed || 0);

    // s3_expires_at and local_path are NOT recoverable from markdown — store null.
    // T8 documented this gap: structured fields not propagated through ProviderResult.
    const s3ExpiresAt: number | null = null;
    const pptxPath: string | null = null;

    const dedupeKey = computeDedupeKey(prompt, account.id, format);

    const quotaAfter = creditsUsed > 0 && quotaBefore > 0
      ? await pool.decrementQuota(account.id, creditsUsed)
      : quotaBefore;

    void recordRequest({
      accountId: account.id,
      accountEmail: account.email,
      provider: providerName,
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      creditsUsed,
      status: "success",
      durationMs,
      requestBody: prepareLogBody({ ...request, _poolprox: { source: "image-studio.generate.pptx" } }),
      responseBody: prepareLogBody(result.response),
      accountQuotaBefore: quotaBefore,
      accountQuotaAfter: quotaAfter,
    });

    // ─── 6. Persist row in imageStudioResults using T1 camelCase columns ─
    let savedResultId: number | undefined;
    const urls = downloadUrl ? [downloadUrl] : [];
    try {
      const [saved] = await db
        .insert(imageStudioResults)
        .values({
          chatId: chatId ?? null,
          prompt,
          type: "pptx",
          // mirror image branch defaults; aspectRatio column is NOT NULL with default "1:1"
          aspectRatio: "1:1",
          n: 1,
          urls,
          creditsUsed: 0,
          // T1 PPTX columns (NOTE: pptxCreditsUsed, NOT creditsUsed — T1 added this
          // because credits_used was already taken)
          designUrl,
          pptxUrl: downloadUrl,
          pptxPath,
          slideCount,
          pptxCreditsUsed: creditsUsed,
          s3ExpiresAt,
          dedupeKey,
          format,
        })
        .returning({ id: imageStudioResults.id });
      savedResultId = saved?.id;
    } catch (err) {
      console.error("[image-studio] Failed to persist PPTX result:", err);
    }

    // ─── 7. Respond with the PPTX-specific envelope ────────────────
    return c.json({
      id: savedResultId,
      design_url: designUrl,
      pptx_url: downloadUrl,
      pptx_path: pptxPath,
      slide_count: slideCount,
      credits_used: creditsUsed,
      format,
      title,
      s3_expires_at: s3ExpiresAt,
      account: { id: account.id, email: account.email },
    });
  } finally {
    pool.trackRequestEnd(account.id);
  }
}

imageStudioRouter.post("/generate", async (c) => {
  const body = await c.req.json<{
    prompt: string;
    type?: "image" | "video" | "pptx";
    aspectRatio?: string;
    n?: number;
    chatId?: number | null;
    // PPTX-only fields (T10)
    format?: string;
    slideCount?: number;
  }>();

  const prompt = (body.prompt || "").trim();
  if (!prompt) {
    return c.json({ error: "prompt is required" }, 400);
  }

  const chatId = typeof body.chatId === "number" && Number.isFinite(body.chatId) ? body.chatId : null;

  // ─── PPTX branch (T10) ──────────────────────────────────────────────
  if (body.type === "pptx") {
    return handlePptxGenerate(c, { prompt, chatId, body });
  }

  const type = body.type === "video" ? "video" : "image";
  const model = type === "video" ? "canva-video" : "canva-image";
  const aspectRatio = VALID_ASPECTS.has(body.aspectRatio || "") ? body.aspectRatio! : "1:1";
  const n = type === "video" ? 1 : Math.min(4, Math.max(1, Number(body.n) || 1));

  const request = {
    model,
    messages: [{ role: "user" as const, content: prompt }],
    stream: false,
    aspect_ratio: aspectRatio,
    n,
  } as ChatCompletionRequest & { aspect_ratio: string; n: number };

  let routed;
  try {
    routed = await routeRequest(request, false);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return c.json({ error: errMsg }, 502);
  }

  const { result, account, provider: providerName, durationMs } = routed;
  const quotaBefore = Number(account.quotaRemaining || 0);

  try {
    if (!result.success || !result.response) {
      void recordRequest({
        accountId: account.id,
        accountEmail: account.email,
        provider: providerName,
        model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        creditsUsed: 0,
        status: "error",
        durationMs,
        errorMessage: result.error || "Generation failed",
        requestBody: prepareLogBody({ ...request, _poolprox: { source: "image-studio.generate" } }),
        accountQuotaBefore: quotaBefore,
        accountQuotaAfter: quotaBefore,
      });
      return c.json({ error: result.error || "Generation failed" }, 502);
    }

    const content = (result.response.choices?.[0]?.message?.content as string) || "";
    const allUrls: string[] = [];
    const re = /\((https?:\/\/[^)]+)\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      allUrls.push(match[1]!);
    }
    // For video, the first URL is the video and subsequent ones are thumbnails — keep only the video.
    const urls = type === "video" ? allUrls.slice(0, 1) : allUrls;

    const creditsUsed = Number(result.creditsUsed || 0);
    const quotaAfter = creditsUsed > 0 && quotaBefore > 0
      ? await pool.decrementQuota(account.id, creditsUsed)
      : quotaBefore;

    void recordRequest({
      accountId: account.id,
      accountEmail: account.email,
      provider: providerName,
      model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      creditsUsed,
      status: "success",
      durationMs,
      requestBody: prepareLogBody({ ...request, _poolprox: { source: "image-studio.generate" } }),
      responseBody: prepareLogBody(result.response),
      accountQuotaBefore: quotaBefore,
      accountQuotaAfter: quotaAfter,
    });

    let savedResultId: number | undefined;
    if (urls.length > 0) {
      try {
        const [saved] = await db
          .insert(imageStudioResults)
          .values({
            chatId: chatId ?? null,
            prompt,
            type,
            aspectRatio,
            n,
            urls,
            creditsUsed,
          })
          .returning({ id: imageStudioResults.id });
        savedResultId = saved?.id;
      } catch (err) {
        console.error("[image-studio] Failed to persist result:", err);
      }
    }

    return c.json({
      id: savedResultId,
      urls,
      prompt,
      type,
      aspectRatio,
      n,
      creditsUsed,
      createdAt: new Date().toISOString(),
      account: { id: account.id, email: account.email },
    });
  } finally {
    pool.trackRequestEnd(account.id);
  }
});

imageStudioRouter.get("/chats", async (c) => {
  const chats = await db
    .select()
    .from(imageStudioChats)
    .orderBy(desc(imageStudioChats.updatedAt));
  return c.json({ data: chats });
});

imageStudioRouter.get("/chats/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
  const [chat] = await db
    .select()
    .from(imageStudioChats)
    .where(eq(imageStudioChats.id, id));
  if (!chat) return c.json({ error: "not found" }, 404);
  return c.json(chat);
});

imageStudioRouter.post("/chats", async (c) => {
  const body = await c.req.json<{
    title?: string | null;
    messages?: unknown;
    finalPrompt?: string | null;
    options?: unknown;
    assistModel?: string | null;
  }>();
  const [created] = await db
    .insert(imageStudioChats)
    .values({
      title: body.title ?? null,
      messages: Array.isArray(body.messages) ? body.messages : [],
      finalPrompt: body.finalPrompt ?? null,
      options: Array.isArray(body.options) ? body.options : [],
      assistModel: body.assistModel ?? null,
    })
    .returning();
  return c.json(created);
});

imageStudioRouter.put("/chats/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
  const body = await c.req.json<{
    title?: string | null;
    messages?: unknown;
    finalPrompt?: string | null;
    options?: unknown;
    assistModel?: string | null;
  }>();
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.title !== undefined) updates.title = body.title;
  if (body.messages !== undefined) updates.messages = Array.isArray(body.messages) ? body.messages : [];
  if (body.finalPrompt !== undefined) updates.finalPrompt = body.finalPrompt;
  if (body.options !== undefined) updates.options = Array.isArray(body.options) ? body.options : [];
  if (body.assistModel !== undefined) updates.assistModel = body.assistModel;
  const [updated] = await db
    .update(imageStudioChats)
    .set(updates)
    .where(eq(imageStudioChats.id, id))
    .returning();
  if (!updated) return c.json({ error: "not found" }, 404);
  return c.json(updated);
});

imageStudioRouter.delete("/chats/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
  await db.delete(imageStudioChats).where(eq(imageStudioChats.id, id));
  return c.json({ ok: true });
});

imageStudioRouter.get("/results", async (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 50));
  const chatIdParam = c.req.query("chatId");
  const query = db.select().from(imageStudioResults);
  if (chatIdParam) {
    const chatId = Number(chatIdParam);
    if (!Number.isFinite(chatId)) return c.json({ error: "invalid chatId" }, 400);
    const rows = await query
      .where(eq(imageStudioResults.chatId, chatId))
      .orderBy(asc(imageStudioResults.createdAt))
      .limit(limit);
    return c.json({ data: rows });
  }
  const rows = await query.orderBy(asc(imageStudioResults.createdAt)).limit(limit);
  return c.json({ data: rows });
});

imageStudioRouter.delete("/results/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);
  await db.delete(imageStudioResults).where(eq(imageStudioResults.id, id));
  return c.json({ ok: true });
});

imageStudioRouter.delete("/results", async (c) => {
  const chatIdParam = c.req.query("chatId");
  if (chatIdParam) {
    const chatId = Number(chatIdParam);
    if (!Number.isFinite(chatId)) return c.json({ error: "invalid chatId" }, 400);
    await db.delete(imageStudioResults).where(eq(imageStudioResults.chatId, chatId));
  } else {
    await db.delete(imageStudioResults);
  }
  return c.json({ ok: true });
});

// ─── T12: re-export expired Canva PPTX/PDF/MP4 download ────────────────
//
// POST /api/image-studio/results/:id/re-export
//
// When Canva's S3 download URL expires (~1h post-export) the original
// download_url in pptxUrl becomes useless. This endpoint detects expiry
// via s3ExpiresAt and re-runs only steps 5-8 of the worker pipeline
// (skipping thread+design generation), updates the row with a fresh URL
// + expiry, and returns the new URL.
//
// Idempotent: if the row's URL is still valid (s3_expires_at in future)
// we return it without burning credits. Re-export normally costs 1 credit
// (vs 2 for a fresh generation).
//
// Authorization: same surface as the rest of the image-studio router —
// no per-route middleware (the router itself is mounted under the same
// gate as POST /generate). DO NOT add new auth here.
//
// Account selection: the imageStudioResults row does NOT carry an
// `accountId` column (T1 didn't add one). We pick any active Canva
// account from the pool. The Canva /_ajax/export endpoint is ownership-
// scoped per design; if the chosen account does not own the design,
// the worker bubbles up `auth_expired` / `api_error` and the API maps
// it to 401/500 — caller can retry or re-generate from scratch.
imageStudioRouter.post("/results/:id/re-export", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "invalid id" }, 400);

  // 1. Look up the row.
  const [row] = await db
    .select()
    .from(imageStudioResults)
    .where(eq(imageStudioResults.id, id));

  if (!row) {
    return c.json({ error: "result not found" }, 404);
  }

  // 2. Reject rows that aren't a PPTX-pipeline product.
  if (row.format == null && row.pptxUrl == null) {
    return c.json({ error: "this result is not a PPTX/PDF/MP4 generation" }, 400);
  }

  // 3. Idempotency: if the URL is still valid, return it without re-charging.
  const nowSec = Math.floor(Date.now() / 1000);
  if (row.s3ExpiresAt == null || row.s3ExpiresAt >= nowSec) {
    return c.json({
      pptx_url: row.pptxUrl,
      s3_expires_at: row.s3ExpiresAt,
    });
  }

  // 4. Recover design_id from the stored design_url.
  const designId = parseCanvaDesignIdFromUrl(row.designUrl);
  if (!designId) {
    return c.json({ error: "missing or unparseable design_url on stored row" }, 400);
  }

  // 5. Validate format (must be one of pptx|pdf|mp4) and slideCount.
  const formatRaw = (row.format ?? "pptx").toString();
  const formatCheck = validateFormat(formatRaw);
  if (!formatCheck.ok) {
    return c.json({ error: formatCheck.error }, 400);
  }
  const format = formatRaw as CanvaFormat;

  const slideCount = Number(row.slideCount ?? 0);
  const slideCheck = validateSlideCount(slideCount);
  if (!slideCheck.ok) {
    return c.json({ error: slideCheck.error }, 400);
  }

  // 6. Pick an active Canva account from the pool. (No accountId column on
  //    imageStudioResults — see notepad T12.)
  const account = await pool.getNextAccount("canva");
  if (!account) {
    // Confirm presence of any canva account at all; if none → 410, else 503.
    const [anyCanva] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.provider, "canva"))
      .limit(1);
    if (!anyCanva) {
      return c.json({ error: "account no longer available" }, 410);
    }
    return c.json({ error: "no available canva account (all saturated)" }, 503);
  }

  // 7. Dispatch via the CanvaProvider.reexport helper. Type-cast through the
  //    providers map (typed as BaseProvider in the registry) using a single
  //    intentful cast scoped to this call site.
  const canvaProvider = providers.canva as unknown as CanvaProvider;
  const quotaBefore = Number(account.quotaRemaining || 0);

  pool.trackRequestStart(account.id);
  const startedAt = Date.now();
  try {
    const result = await canvaProvider.reexport(account, {
      designId,
      format,
      slideCount,
      saveLocal: true,
    });
    const durationMs = Date.now() - startedAt;

    if (!result.ok) {
      const code = (result.error || "api_error").toString();
      const status = workerErrorToHttpStatus(code);
      const detail = result.details ? `: ${result.details}` : "";
      void recordRequest({
        accountId: account.id,
        accountEmail: account.email,
        provider: "canva",
        model: "canva-pptx",
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        creditsUsed: 0,
        status: "error",
        durationMs,
        errorMessage: `${code}${detail}`,
        requestBody: prepareLogBody({
          _poolprox: { source: "image-studio.re-export", row_id: id, design_id: designId },
          format,
          slide_count: slideCount,
        }),
        accountQuotaBefore: quotaBefore,
        accountQuotaAfter: quotaBefore,
      });
      const payload: { error: string; code: string; retry?: boolean } = {
        error: `${code}${detail}`,
        code,
      };
      if (status === 401) payload.retry = true;
      return c.json(payload, status as StatusCode);
    }

    // 8. Persist fresh URL/expiry on the row; accumulate credits.
    const newCredits = typeof result.credits_used === "number" ? result.credits_used : 1;
    const previousCredits = Number(row.pptxCreditsUsed ?? 0);
    const accumulatedCredits = previousCredits + newCredits;
    const newDownloadUrl = result.download_url ?? null;
    const newS3ExpiresAt = typeof result.s3_expires_at === "number" ? result.s3_expires_at : null;
    const newLocalPath = result.local_path ?? row.pptxPath ?? null;
    const newUrls = newDownloadUrl ? [newDownloadUrl] : (Array.isArray(row.urls) ? row.urls : []);

    try {
      await db
        .update(imageStudioResults)
        .set({
          pptxUrl: newDownloadUrl,
          pptxPath: newLocalPath,
          s3ExpiresAt: newS3ExpiresAt,
          pptxCreditsUsed: accumulatedCredits,
          urls: newUrls,
        })
        .where(eq(imageStudioResults.id, id));
    } catch (err) {
      console.error("[image-studio] Failed to persist re-export result:", err);
    }

    const quotaAfter = newCredits > 0 && quotaBefore > 0
      ? await pool.decrementQuota(account.id, newCredits)
      : quotaBefore;

    void recordRequest({
      accountId: account.id,
      accountEmail: account.email,
      provider: "canva",
      model: "canva-pptx",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      creditsUsed: newCredits,
      status: "success",
      durationMs,
      requestBody: prepareLogBody({
        _poolprox: { source: "image-studio.re-export", row_id: id, design_id: designId },
        format,
        slide_count: slideCount,
      }),
      responseBody: prepareLogBody({
        design_id: result.design_id,
        download_url: newDownloadUrl,
        s3_expires_at: newS3ExpiresAt,
      }),
      accountQuotaBefore: quotaBefore,
      accountQuotaAfter: quotaAfter,
    });

    return c.json({
      pptx_url: newDownloadUrl,
      s3_expires_at: newS3ExpiresAt,
    });
  } finally {
    pool.trackRequestEnd(account.id);
  }
});

/** Worker-error → HTTP-status mapping for the re-export endpoint (mirrors T10). */
function workerErrorToHttpStatus(code: string): StatusCode {
  const c = code.toLowerCase();
  if (c === "auth_expired") return 401;
  if (c === "quota_exceeded") return 429;
  if (c === "cf_blocked") return 503;
  if (c === "aborted" || c === "duplicate") return 409;
  if (c === "timeout") return 504;
  return 500;
}

/** Extract the Canva design id from a design URL like https://canva.com/design/{id}/edit. */
function parseCanvaDesignIdFromUrl(designUrl: string | null | undefined): string | null {
  if (!designUrl) return null;
  const m = designUrl.match(/\/design\/([^/?#]+)/);
  return m?.[1] ?? null;
}

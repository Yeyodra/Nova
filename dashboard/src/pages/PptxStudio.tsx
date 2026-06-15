import { useCallback, useEffect, useRef, useState } from "react";
import {
  Presentation,
  Loader2,
  Download,
  ExternalLink,
  RefreshCw,
  Trash2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  FileText,
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Alert } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  pptxStudio,
  type PptxFormat,
  type StoredPptxResult,
} from "@/lib/api";

// ─── Constants ────────────────────────────────────────────────────────
const SLIDE_MIN = 1;
const SLIDE_MAX = 50;
const SLIDE_DEFAULT = 5;
const REFRESH_INTERVAL_MS = 30_000;

const FORMATS: Array<{ value: PptxFormat; label: string }> = [
  { value: "pptx", label: "PPTX" },
  { value: "pdf", label: "PDF" },
  { value: "mp4", label: "MP4" },
];

// ─── Helpers ──────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatLabel(fmt: string | null): string {
  const f = (fmt || "pptx").toUpperCase();
  return f;
}

function formatBadgeTone(fmt: string | null): string {
  switch ((fmt || "pptx").toLowerCase()) {
    case "pdf":
      return "bg-[var(--info)]/15 text-[var(--info)] border-[var(--info)]/30";
    case "mp4":
      return "bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30";
    default:
      return "bg-[var(--primary)]/15 text-[var(--primary)] border-[var(--primary)]/30";
  }
}

function isS3Expired(expiresAt: number | null): boolean {
  if (!expiresAt) return false;
  // expiresAt is unix seconds in db; allow ms too defensively.
  const ms = expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
  return ms < Date.now();
}

function readableError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

// Banner status (replaces toast — dashboard has no toast lib).
type Status =
  | { kind: "idle" }
  | { kind: "info"; text: string }
  | { kind: "success"; text: string }
  | { kind: "error"; text: string };

// ─── Component ────────────────────────────────────────────────────────
export default function PptxStudio() {
  // 10 state slots, as specified.
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"quick" | "advanced">("quick");
  const [slideCount, setSlideCount] = useState<number>(SLIDE_DEFAULT);
  const [format, setFormat] = useState<PptxFormat>("pptx");
  const [locale, setLocale] = useState("");
  const [style, setStyle] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [results, setResults] = useState<StoredPptxResult[]>([]);
  const [loadingResults, setLoadingResults] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const [deleteTarget, setDeleteTarget] = useState<StoredPptxResult | null>(null);
  const [reExportingId, setReExportingId] = useState<number | null>(null);

  const slideValid = slideCount >= SLIDE_MIN && slideCount <= SLIDE_MAX;
  const promptValid = prompt.trim().length > 0;

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-dismiss success/info banners after 4s.
  useEffect(() => {
    if (status.kind === "success" || status.kind === "info") {
      const t = setTimeout(() => setStatus({ kind: "idle" }), 4000);
      return () => clearTimeout(t);
    }
  }, [status]);

  const refetch = useCallback(async () => {
    try {
      const data = await pptxStudio.listPptxResults();
      // Newest first
      data.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setResults(data);
    } catch (err) {
      // Silent on refetch — keep the previous list visible.
      console.warn("[PptxStudio] refetch failed:", err);
    } finally {
      setLoadingResults(false);
    }
  }, []);

  useEffect(() => {
    refetch();
    intervalRef.current = setInterval(refetch, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refetch]);

  // ─── Actions ────────────────────────────────────────────────────────
  function buildPrompt(): string {
    const parts = [prompt.trim()];
    if (mode === "advanced") {
      if (style.trim()) parts.push(`Style: ${style.trim()}.`);
      if (locale.trim()) parts.push(`Locale: ${locale.trim()}.`);
    }
    return parts.join(" ");
  }

  async function handleGenerate() {
    if (!promptValid || !slideValid || isGenerating) return;
    setIsGenerating(true);
    setStatus({ kind: "info", text: "Generating PPTX… this may take 30–60s." });
    try {
      const r = await pptxStudio.generatePptx({
        prompt: buildPrompt(),
        slideCount: mode === "advanced" ? slideCount : undefined,
        format: mode === "advanced" ? format : undefined,
      });
      setStatus({
        kind: "success",
        text: `PPTX ready: ${r.title || "Untitled"} (${r.slide_count} slides).`,
      });
      // Refetch list to pick up the new row (avoids divergence with server view).
      await refetch();
      setPrompt("");
    } catch (err) {
      setStatus({ kind: "error", text: readableError(err) });
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleReExport(row: StoredPptxResult) {
    setReExportingId(row.id);
    try {
      const out = await pptxStudio.reExportPptx(row.id);
      setResults((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, pptxUrl: out.pptx_url, s3ExpiresAt: out.s3_expires_at }
            : r,
        ),
      );
      setStatus({ kind: "success", text: "Re-export complete." });
    } catch (err) {
      setStatus({ kind: "error", text: `Re-export failed: ${readableError(err)}` });
    } finally {
      setReExportingId(null);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await pptxStudio.deletePptxResult(target.id);
      setResults((prev) => prev.filter((r) => r.id !== target.id));
      setStatus({ kind: "success", text: "Deleted." });
    } catch (err) {
      setStatus({ kind: "error", text: `Delete failed: ${readableError(err)}` });
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--primary)]/10 text-[var(--primary)]">
          <Presentation className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-[var(--foreground)]">PPTX Studio</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Generate presentations (PPTX / PDF / MP4) from a prompt — powered by Canva.
          </p>
        </div>
      </div>

      {/* Status banner */}
      {status.kind !== "idle" && (
        <Alert
          variant={
            status.kind === "error"
              ? "error"
              : status.kind === "success"
                ? "success"
                : "info"
          }
          className="flex items-start gap-2"
        >
          {status.kind === "error" ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : status.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
          )}
          <span>{status.text}</span>
        </Alert>
      )}

      {/* 2-column grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* ─── Left: form (2/5) ──────────────────────────────────── */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-[var(--primary)]" />
                New Generation
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs value={mode} onValueChange={(v) => setMode(v as "quick" | "advanced")}>
                <TabsList className="mb-4">
                  <TabsTrigger value="quick">Quick</TabsTrigger>
                  <TabsTrigger value="advanced">Advanced</TabsTrigger>
                </TabsList>

                {/* Shared: prompt field — rendered in both tabs */}
                <TabsContent value="quick" className="space-y-4">
                  <PromptField value={prompt} onChange={setPrompt} disabled={isGenerating} />
                </TabsContent>

                <TabsContent value="advanced" className="space-y-4">
                  <PromptField value={prompt} onChange={setPrompt} disabled={isGenerating} />

                  <div className="space-y-2">
                    <label className="flex items-center justify-between text-sm font-medium text-[var(--foreground)]">
                      <span>Slide count</span>
                      <span className="text-[var(--muted-foreground)]">{slideCount}</span>
                    </label>
                    <input
                      type="range"
                      min={SLIDE_MIN}
                      max={SLIDE_MAX}
                      value={slideCount}
                      onChange={(e) => setSlideCount(Number(e.target.value))}
                      disabled={isGenerating}
                      className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[var(--secondary)] accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    {!slideValid && (
                      <p className="text-xs text-[var(--error)]">
                        Slide count must be between {SLIDE_MIN} and {SLIDE_MAX}.
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium text-[var(--foreground)]">Format</label>
                    <Select
                      value={format}
                      onChange={(e) => setFormat(e.target.value as PptxFormat)}
                      disabled={isGenerating}
                    >
                      {FORMATS.map((f) => (
                        <option key={f.value} value={f.value}>
                          {f.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-[var(--foreground)]">
                        Locale <span className="text-[var(--muted-foreground)]">(optional)</span>
                      </label>
                      <Input
                        value={locale}
                        onChange={(e) => setLocale(e.target.value)}
                        placeholder="id-ID"
                        disabled={isGenerating}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-[var(--foreground)]">
                        Style <span className="text-[var(--muted-foreground)]">(optional)</span>
                      </label>
                      <Input
                        value={style}
                        onChange={(e) => setStyle(e.target.value)}
                        placeholder="formal, playful…"
                        disabled={isGenerating}
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              <Button
                onClick={handleGenerate}
                disabled={!promptValid || !slideValid || isGenerating}
                className="mt-6 w-full"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generate
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* ─── Right: results (3/5) ──────────────────────────────── */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Recent Generations</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setLoadingResults(true);
                  refetch();
                }}
                disabled={loadingResults}
              >
                <RefreshCw className={`h-4 w-4 ${loadingResults ? "animate-spin" : ""}`} />
              </Button>
            </CardHeader>
            <CardContent>
              {loadingResults ? (
                <ResultsSkeleton />
              ) : results.length === 0 ? (
                <EmptyResults />
              ) : (
                <div className="space-y-3">
                  {results.map((r) => (
                    <ResultRow
                      key={r.id}
                      row={r}
                      reExporting={reExportingId === r.id}
                      onReExport={() => handleReExport(r)}
                      onDelete={() => setDeleteTarget(r)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delete confirm */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this generation?</DialogTitle>
            <DialogDescription>
              This removes the row from your dashboard. Files already downloaded are unaffected.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <p className="truncate text-sm text-[var(--muted-foreground)]">
              {deleteTarget.prompt || "Untitled"}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────
function PromptField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-[var(--foreground)]">Prompt</label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="A 10-slide pitch deck for an AI-powered finance app…"
        rows={5}
        disabled={disabled}
        className="resize-none"
      />
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-20 animate-pulse rounded-md border border-[var(--border)] bg-[var(--secondary)]/30"
        />
      ))}
    </div>
  );
}

function EmptyResults() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--secondary)] text-[var(--muted-foreground)]">
        <Inbox className="h-5 w-5" />
      </div>
      <p className="text-sm text-[var(--muted-foreground)]">
        No PPTX generated yet. Enter a prompt and click Generate.
      </p>
    </div>
  );
}

function ResultRow({
  row,
  reExporting,
  onReExport,
  onDelete,
}: {
  row: StoredPptxResult;
  reExporting: boolean;
  onReExport: () => void;
  onDelete: () => void;
}) {
  const expired = isS3Expired(row.s3ExpiresAt);
  const title = row.prompt?.trim() || "Untitled";

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
            <p className="truncate text-sm font-medium text-[var(--foreground)]">{title}</p>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge className={`border ${formatBadgeTone(row.format)}`}>
              {formatLabel(row.format)}
            </Badge>
            {row.slideCount != null && (
              <Badge variant="outline">{row.slideCount} slides</Badge>
            )}
            {expired && (
              <Badge className="border border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]">
                Link expired
              </Badge>
            )}
            <span className="text-xs text-[var(--muted-foreground)]">
              {timeAgo(row.createdAt)}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {row.designUrl && (
          <Button asChild variant="outline" size="sm">
            <a href={row.designUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              Open in Canva
            </a>
          </Button>
        )}
        {row.pptxUrl && !expired && (
          <Button asChild variant="outline" size="sm">
            <a href={row.pptxUrl} target="_blank" rel="noopener noreferrer">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Download
            </a>
          </Button>
        )}
        {expired && (
          <Button variant="outline" size="sm" onClick={onReExport} disabled={reExporting}>
            {reExporting ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Re-export
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="ml-auto text-[var(--error)] hover:text-[var(--error)]"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UsageChart from "./UsageChart";
import { formatNumber, parseUtcDate, modelColor } from "@/lib/utils";
import { fetchUsage, fetchDashboardStats, fetchModelUsage } from "@/lib/api";
import { useWsEvent } from "@/hooks/useWebSocket";

interface TokenStats {
  total: number;
  prompt: number;
  completion: number;
  credits?: number;
}

interface ModelUsage {
  provider?: string;
  model: string;
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
  credits?: number;
  requests?: number;
  creditSource?: string;
  color: string;
}

interface TokenUsageProps {
  stats?: TokenStats;
  modelUsage?: ModelUsage[];
}

const defaultStats: TokenStats = {
  total: 0,
  prompt: 0,
  completion: 0,
  credits: 0,
};

const defaultModelUsage: ModelUsage[] = [];

/**
 * How many hours of data to request from the backend for each period.
 *
 * For "1d" we request 48 h so that the current local-timezone day is fully
 * covered regardless of the user's UTC offset (e.g. UTC+14 needs data from
 * up to 38 h ago to fill the 00:00 local bucket).
 */
function getChartHours(period: string): number | null {
  if (period === "1d") return 48;
  if (period === "7d") return 24 * 8; // 8 days to cover timezone edges
  if (period === "30d") return 24 * 31;
  return null; // "all"
}

function modelKey(row: { provider?: string; model?: string }) {
  return `${row.provider || "unknown"}/${row.model || "unknown"}`;
}

// ─── Local-timezone bucket helpers ──────────────────────────────────────────

/** Truncate a Date to the start of its hour in the user's local timezone */
function truncHourLocal(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()).getTime();
}

/** Truncate a Date to the start of its day in the user's local timezone */
function truncDayLocal(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Truncate a Date to the start of its month in the user's local timezone */
function truncMonthLocal(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/**
 * Snap a UTC epoch (from the backend bucket key) to the corresponding
 * local-timezone bucket epoch.  This bridges the gap between the backend
 * (which always buckets in UTC) and the frontend (which displays in the
 * user's local timezone).
 */
function snapToLocalBucket(utcEpoch: number, period: string): number {
  const d = new Date(utcEpoch);
  if (period === "1d") return truncHourLocal(d);
  if (period === "7d" || period === "30d") return truncDayLocal(d);
  return truncMonthLocal(d);
}

/** Convert a backend hour key (ISO UTC) to a numeric epoch (ms) */
function parseBucketKey(isoKey: string): number {
  return parseUtcDate(isoKey).getTime();
}

/** Format a bucket epoch to a display label in user's local timezone */
function formatLabel(epoch: number, period: string): string {
  const d = new Date(epoch);
  if (period === "1d") {
    return `${String(d.getHours()).padStart(2, "0")}:00`;
  }
  if (period === "7d" || period === "30d") {
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Generate ordered bucket epochs for the chart, all in the user's local
 * timezone so labels read naturally.
 *
 * - **1d** — 24 hourly buckets for *today* (00:00 → 23:00 local).
 * - **7d** — 7 daily buckets ending today.
 * - **30d** — 30 daily buckets ending today.
 * - **all** — last 12 monthly buckets.
 */
function generateBuckets(period: string): number[] {
  const now = new Date();
  const buckets: number[] = [];

  if (period === "1d") {
    // Today: 00:00 local → 23:00 local (24 hourly slots)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    for (let i = 0; i < 24; i++) {
      buckets.push(todayStart + i * 3600_000);
    }
    return buckets;
  }

  if (period === "7d" || period === "30d") {
    const days = period === "7d" ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      buckets.push(d.getTime());
    }
    return buckets;
  }

  // "all" — last 12 months
  for (let i = 11; i >= 0; i--) {
    buckets.push(new Date(now.getFullYear(), now.getMonth() - i, 1).getTime());
  }
  return buckets;
}

/**
 * Map backend rows (UTC-bucketed) into local-timezone chart data.
 *
 * Multiple UTC buckets can map to the same local bucket (e.g. UTC hours
 * 17:00–23:00 on day N all fall into local day N+1 for UTC+7), so values
 * are **summed** rather than replaced.
 */
function rowsToModelChart(
  rows: Array<{ hour: string; provider?: string; model?: string; tokens?: number }>,
  period: string,
) {
  const models = Array.from(new Set(rows.map(modelKey)));
  const bucketEpochs = generateBuckets(period);

  // Initialise all buckets with zero values
  const byEpoch = new Map<number, Record<string, number | string>>();
  for (const epoch of bucketEpochs) {
    const entry: Record<string, number | string> = {
      hour: String(epoch),
      label: formatLabel(epoch, period),
    };
    for (const model of models) entry[model] = 0;
    byEpoch.set(epoch, entry);
  }

  // Map backend data → local buckets (snap + accumulate)
  for (const row of rows) {
    const utcEpoch = parseBucketKey(row.hour);
    const localEpoch = snapToLocalBucket(utcEpoch, period);
    const model = modelKey(row);
    const bucket = byEpoch.get(localEpoch);
    if (bucket) {
      bucket[model] = Number(bucket[model] || 0) + Number(row.tokens || 0);
    }
    // Data outside the generated bucket range is simply ignored (old data)
  }

  return bucketEpochs.map((epoch) => byEpoch.get(epoch)!);
}

export default function TokenUsage({
  stats: externalStats = defaultStats,
  modelUsage: externalModelUsage = defaultModelUsage,
}: TokenUsageProps) {
  const [period, setPeriod] = useState("1d");
  const [chartData, setChartData] = useState<any[]>([]);
  const [filteredStats, setFilteredStats] = useState<TokenStats>(defaultStats);
  const [filteredModelUsage, setFilteredModelUsage] = useState<ModelUsage[]>([]);

  // Use filtered data (fetched per period) instead of external (all-time) data
  const stats = filteredStats;
  const modelUsage = filteredModelUsage;

  const maxTokens = Math.max(1, ...modelUsage.map((m) => Number(m.tokens || 0)));
  const colorsByModel = Object.fromEntries(
    modelUsage.map((model) => [`${model.provider || "unknown"}/${model.model || "unknown"}`, model.color]),
  );

  const reloadRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function loadData() {
    const hours = getChartHours(period);
    const range = period === "all" ? "all" : undefined;
    try {
      const [usageRes, statsRes, modelsRes] = await Promise.all([
        fetchUsage(hours, range) as Promise<{ data: Array<{ hour: string; provider?: string; model?: string; tokens?: number }> }>,
        fetchDashboardStats(hours, range) as Promise<any>,
        fetchModelUsage(hours, range) as Promise<{ data: any[] }>,
      ]);

      // Update chart data
      setChartData(rowsToModelChart(usageRes.data || [], period));

      // Update stats cards from filtered response
      setFilteredStats({
        total: Number(statsRes?.tokens?.total || 0),
        prompt: Number(statsRes?.tokens?.prompt || 0),
        completion: Number(statsRes?.tokens?.completion || 0),
        credits: Number(statsRes?.tokens?.credits || 0),
      });

      // Update model usage from filtered response
      const modelData = (modelsRes.data || [])
        .filter((m: any) => Number(m.totalTokens || 0) > 0 || Number(m.credits || 0) > 0)
        .sort((a: any, b: any) => Number(b.totalTokens || 0) - Number(a.totalTokens || 0))
        .slice(0, 8)
        .map((m: any, idx: number) => ({
          provider: m.provider || "unknown",
          model: m.model || "unknown",
          tokens: Number(m.totalTokens || 0),
          promptTokens: Number(m.promptTokens || 0),
          completionTokens: Number(m.completionTokens || 0),
          credits: Number(m.credits || 0),
          requests: Number(m.totalRequests || 0),
          creditSource: m.creditSource || "estimated",
          color: modelColor(`${m.provider || "unknown"}/${m.model || "unknown"}`, idx),
        }));
      setFilteredModelUsage(modelData);
    } catch {
      setChartData([]);
    }
  }

  const scheduleReload = () => {
    if (reloadRef.current) clearTimeout(reloadRef.current);
    reloadRef.current = setTimeout(() => { loadData(); }, 500);
  };

  useEffect(() => {
    loadData();
    return () => { if (reloadRef.current) clearTimeout(reloadRef.current); };
  }, [period]);

  useWsEvent(["request_log", "request_error"], scheduleReload);

  return (
    <Card className="border-[var(--border)]">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Token Usage</CardTitle>
          <Tabs value={period} onValueChange={setPeriod}>
            <TabsList>
              <TabsTrigger value="1d">1d</TabsTrigger>
              <TabsTrigger value="7d">7d</TabsTrigger>
              <TabsTrigger value="30d">30d</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg bg-[var(--secondary)] p-4">
            <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wide">Total</p>
            <p className="text-xl font-bold mt-1">{formatNumber(stats.total)}</p>
          </div>
          <div className="rounded-lg bg-[var(--secondary)] p-4">
            <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wide">Prompt</p>
            <p className="text-xl font-bold mt-1">{formatNumber(stats.prompt)}</p>
          </div>
          <div className="rounded-lg bg-[var(--secondary)] p-4">
            <p className="text-xs text-[var(--muted-foreground)] uppercase tracking-wide">Completion</p>
            <p className="text-xl font-bold mt-1">{formatNumber(stats.completion)}</p>
          </div>
        </div>

        {/* Chart */}
        <div>
          <h4 className="text-sm font-medium text-[var(--muted-foreground)] mb-4">Token Usage Over Time</h4>
          <UsageChart data={chartData} period={period} colorsByModel={colorsByModel} />
        </div>

        {/* By Model */}
        <div>
          <h4 className="text-sm font-medium text-[var(--muted-foreground)] mb-4">By Model</h4>
          <div className="space-y-3">
            {modelUsage.map((model) => (
              <div key={`${model.provider || "unknown"}/${model.model}`} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <span className="text-[var(--foreground)]">{model.provider ? `${model.provider}/` : ""}{model.model}</span>
                    <span className="ml-2 text-[10px] uppercase text-[var(--muted-foreground)]">{model.creditSource || "estimated"}</span>
                  </div>
                  <span className="shrink-0 text-[var(--muted-foreground)]">
                    {formatNumber(model.tokens)} tokens · {model.requests || 0} req
                  </span>
                </div>
                <div className="h-2 rounded-full bg-[var(--secondary)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${(Number(model.tokens || 0) / maxTokens) * 100}%`,
                      backgroundColor: model.color,
                    }}
                  />
                </div>
              </div>
            ))}
            {modelUsage.length === 0 && (
              <p className="text-sm text-[var(--muted-foreground)]">No model usage yet</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

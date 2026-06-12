import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Globe, Copy, Check, Loader2, Power, ExternalLink, Shield } from "lucide-react";
import { fetchApi, API_BASE } from "@/lib/api";
import { useWsEvent } from "@/hooks/useWebSocket";

interface TunnelStatus {
  enabled: boolean;
  tunnelUrl: string;
  running: boolean;
  reachable: boolean;
  mode: "quick" | "named";
  downloading: boolean;
  downloadProgress: number;
}

interface TunnelApiResponse {
  tunnel: TunnelStatus;
  download: { downloading: boolean; progress: number };
}

const TUNNEL_BENEFITS = [
  { icon: Globe, title: "Access Anywhere", desc: "Use your proxy from any network" },
  { icon: ExternalLink, title: "Share Endpoint", desc: "Share URL with team members" },
  { icon: Shield, title: "Encrypted", desc: "End-to-end TLS via Cloudflare" },
];

export default function Tunnel() {
  const [status, setStatus] = useState<TunnelStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetchApi<TunnelApiResponse>("/api/tunnel/status");
      setStatus({
        ...res.tunnel,
        downloading: res.download.downloading,
        downloadProgress: res.download.progress,
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch status");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchStatus().finally(() => setLoading(false));
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // WebSocket real-time updates
  useWsEvent(["tunnel:status"], (msg) => {
    if (msg.data) setStatus(msg.data as TunnelStatus);
  });

  useWsEvent(["tunnel:download"], (msg) => {
    if (msg.data && status) {
      setStatus((prev) => prev ? { ...prev, downloading: msg.data.downloading, downloadProgress: msg.data.progress } : prev);
    }
  });

  async function handleEnable() {
    setActionLoading(true);
    setError(null);
    try {
      await fetchApi("/api/tunnel/enable", { method: "POST" });
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enable tunnel");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDisable() {
    setActionLoading(true);
    setError(null);
    try {
      await fetchApi("/api/tunnel/disable", { method: "POST" });
      await fetchStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disable tunnel");
    } finally {
      setActionLoading(false);
    }
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function getStatusColor(): string {
    if (!status?.enabled || !status?.running) return "bg-red-500";
    if (status.reachable) return "bg-green-500";
    return "bg-yellow-500";
  }

  function getStatusText(): string {
    if (!status?.enabled || !status?.running) return "Stopped";
    if (status.reachable) return "Connected";
    return "Checking reachability...";
  }

  if (loading && !status) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
      </div>
    );
  }

  const localEndpoint = `${API_BASE}/v1`;
  const tunnelEndpoint = status?.tunnelUrl && status.tunnelUrl !== "named-tunnel-active"
    ? `${status.tunnelUrl}/v1`
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Globe className="h-6 w-6" />
        <div>
          <h2 className="text-2xl font-bold">Tunnel</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Expose your proxy to the internet via Cloudflare Tunnel
          </p>
        </div>
      </div>

      {/* Endpoints Card */}
      <Card>
        <CardHeader>
          <CardTitle>API Endpoints</CardTitle>
          <CardDescription>
            Use these endpoints in Cursor, Cline, or any OpenAI-compatible client
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Local endpoint */}
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-[var(--muted)] text-[var(--muted-foreground)] min-w-[72px] justify-center">
              Local
            </span>
            <Input value={localEndpoint} readOnly className="flex-1 font-mono text-sm" />
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleCopy(localEndpoint, "local")}
              title="Copy local endpoint"
            >
              {copiedId === "local" ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>

          {/* Tunnel endpoint */}
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium min-w-[72px] justify-center ${
              status?.enabled && status?.running
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-[var(--muted)] text-[var(--muted-foreground)]"
            }`}>
              Tunnel
            </span>
            {status?.enabled && !actionLoading && status?.reachable && tunnelEndpoint ? (
              <>
                <Input value={tunnelEndpoint} readOnly className="flex-1 font-mono text-sm" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleCopy(tunnelEndpoint, "tunnel")}
                  title="Copy tunnel endpoint"
                >
                  {copiedId === "tunnel" ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleDisable}
                  title="Disable Tunnel"
                  className="text-red-500 hover:bg-red-500/10 hover:text-red-500"
                >
                  <Power className="h-4 w-4" />
                </Button>
              </>
            ) : status?.enabled && !actionLoading && !status?.reachable ? (
              <>
                <div className="flex-1 flex items-center gap-2 rounded border border-yellow-500/30 bg-yellow-500/5 px-3 py-1.5 text-sm text-yellow-600 dark:text-yellow-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {tunnelEndpoint ? "Tunnel reconnecting..." : "Checking..."}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleDisable}
                  title="Disable Tunnel"
                  className="text-red-500 hover:bg-red-500/10 hover:text-red-500"
                >
                  <Power className="h-4 w-4" />
                </Button>
              </>
            ) : actionLoading ? (
              <>
                <div className="flex-1 flex items-center gap-2 rounded border border-[var(--border)] bg-[var(--muted)] px-3 py-1.5 text-sm text-[var(--muted-foreground)]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {status?.downloading
                    ? `Downloading cloudflared... ${status.downloadProgress}%`
                    : "Creating tunnel..."}
                </div>
              </>
            ) : (
              <>
                <div className="flex-1 flex items-center gap-2 rounded border border-dashed border-[var(--border)] px-3 py-1.5 text-sm text-[var(--muted-foreground)]">
                  Not connected
                </div>
                <Button size="sm" onClick={handleEnable} disabled={actionLoading}>
                  Enable
                </Button>
              </>
            )}
          </div>

          {/* Download progress bar */}
          {status?.downloading && (
            <div className="space-y-1 pt-1">
              <div className="h-1.5 w-full rounded-full bg-[var(--muted)]">
                <div
                  className="h-1.5 rounded-full bg-blue-500 transition-all"
                  style={{ width: `${status.downloadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-500">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <span className={`inline-block h-3 w-3 rounded-full ${getStatusColor()} ${
              status?.enabled && status?.running && !status?.reachable ? "animate-pulse" : ""
            }`} />
            {getStatusText()}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-[var(--muted-foreground)]">Mode</span>
              <p className="font-medium capitalize">{status?.mode || "—"}</p>
            </div>
            <div>
              <span className="text-[var(--muted-foreground)]">Process</span>
              <p className="font-medium">{status?.running ? "Running" : "Stopped"}</p>
            </div>
            <div>
              <span className="text-[var(--muted-foreground)]">Reachable</span>
              <p className="font-medium">{status?.reachable ? "Yes" : "No"}</p>
            </div>
            <div>
              <span className="text-[var(--muted-foreground)]">Tunnel URL</span>
              <p className="font-medium font-mono text-xs break-all">{status?.tunnelUrl || "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Benefits Card (shown when tunnel is not enabled) */}
      {!status?.enabled && (
        <Card>
          <CardHeader>
            <CardTitle>Why use a tunnel?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              {TUNNEL_BENEFITS.map((benefit) => (
                <div key={benefit.title} className="flex items-start gap-3">
                  <benefit.icon className="h-5 w-5 text-[var(--muted-foreground)] mt-0.5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">{benefit.title}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">{benefit.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

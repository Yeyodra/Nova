import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { savePid, loadPid, clearPid } from "./state";
import { config } from "../../config";
import { broadcast } from "../../ws/index";

const projectRoot = path.resolve(import.meta.dir, "../../..");
const BIN_DIR = path.join(projectRoot, "data/bin");
const BINARY_NAME = "cloudflared";
const IS_WINDOWS = os.platform() === "win32";
const BIN_NAME = IS_WINDOWS ? `${BINARY_NAME}.exe` : BINARY_NAME;
const BIN_PATH = path.join(BIN_DIR, BIN_NAME);
const POWERSHELL_HIDDEN_COMMAND = "powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command";
const DEFAULT_QUICK_TUNNEL_PROTOCOL = "http2";
const QUICK_TUNNEL_PROTOCOLS = new Set(["http2", "quic", "auto"]);

const GITHUB_BASE_URL = "https://github.com/cloudflare/cloudflared/releases/latest/download";

const PLATFORM_MAPPINGS: Record<string, Record<string, string>> = {
  darwin: {
    x64: "cloudflared-darwin-amd64.tgz",
    arm64: "cloudflared-darwin-arm64.tgz",
  },
  win32: {
    x64: "cloudflared-windows-amd64.exe",
    ia32: "cloudflared-windows-386.exe",
    arm64: "cloudflared-windows-386.exe",
  },
  linux: {
    x64: "cloudflared-linux-amd64",
    arm64: "cloudflared-linux-arm64",
  },
};

const PLATFORM_FALLBACK: Record<string, string> = {
  darwin: "cloudflared-darwin-amd64.tgz",
  win32: "cloudflared-windows-386.exe",
  linux: "cloudflared-linux-amd64",
};

function getDownloadUrl(): string {
  const platform = os.platform();
  const arch = os.arch();

  const platformMapping = PLATFORM_MAPPINGS[platform];
  if (!platformMapping) {
    throw new Error(`Unsupported platform: ${platform}`);
  }

  const binaryName = platformMapping[arch] || PLATFORM_FALLBACK[platform];
  return `${GITHUB_BASE_URL}/${binaryName}`;
}

// Download state — shared so status API can read it
const dlState = { downloading: false, progress: 0 };

export function getDownloadStatus() {
  return { downloading: dlState.downloading, progress: dlState.progress };
}

async function downloadFile(url: string, dest: string): Promise<string> {
  dlState.downloading = true;
  dlState.progress = 0;

  try {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      throw new Error(`Download failed with status ${response.status}`);
    }

    const totalBytes = Number(response.headers.get("content-length")) || 0;
    let receivedBytes = 0;

    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.length;
      if (totalBytes > 0) {
        dlState.progress = Math.round((receivedBytes / totalBytes) * 100);
        broadcast({ type: "tunnel:download", data: { downloading: true, progress: dlState.progress } });
      }
    }

    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(dest, buffer);
    dlState.progress = 100;
    return dest;
  } finally {
    dlState.downloading = false;
  }
}

const MIN_BINARY_SIZE = 1024 * 1024; // 1MB - cloudflared is ~30MB+

function isValidBinary(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size < MIN_BINARY_SIZE) return false;
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    const magic = buf.toString("hex");
    if (IS_WINDOWS) return magic.startsWith("4d5a"); // PE (MZ)
    if (os.platform() === "darwin") return magic.startsWith("cffaedfe") || magic.startsWith("cefaedfe");
    return magic.startsWith("7f454c46"); // ELF (Linux)
  } catch {
    return false;
  }
}

let downloadPromise: Promise<string> | null = null;

export async function ensureCloudflared(): Promise<string> {
  if (downloadPromise) return downloadPromise;
  downloadPromise = _ensureCloudflared().finally(() => { downloadPromise = null; });
  return downloadPromise;
}

async function _ensureCloudflared(): Promise<string> {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
  }

  // Clean up incomplete downloads from previous runs
  const tmpPath = `${BIN_PATH}.tmp`;
  if (fs.existsSync(tmpPath)) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  if (fs.existsSync(BIN_PATH)) {
    if (!isValidBinary(BIN_PATH)) {
      console.log("[cloudflared] Invalid binary detected, re-downloading...");
      fs.unlinkSync(BIN_PATH);
    } else {
      if (!IS_WINDOWS) fs.chmodSync(BIN_PATH, "755");
      return BIN_PATH;
    }
  }

  const url = getDownloadUrl();
  const isArchive = url.endsWith(".tgz");
  const downloadDest = isArchive ? path.join(BIN_DIR, "cloudflared.tgz.tmp") : tmpPath;

  console.log(`[cloudflared] Downloading from ${url}...`);
  await downloadFile(url, downloadDest);

  if (isArchive) {
    execSync(`tar -xzf "${downloadDest}" -C "${BIN_DIR}"`, { stdio: "pipe", windowsHide: true });
    fs.unlinkSync(downloadDest);
  } else {
    fs.renameSync(downloadDest, BIN_PATH);
  }

  if (!IS_WINDOWS) {
    fs.chmodSync(BIN_PATH, "755");
  }

  console.log(`[cloudflared] Binary ready at ${BIN_PATH}`);
  return BIN_PATH;
}

let cloudflaredProcess: { kill: () => void; pid: number } | null = null;
let unexpectedExitHandler: (() => void) | null = null;

/** Register a callback to be called when cloudflared exits unexpectedly after connecting */
export function setUnexpectedExitHandler(handler: () => void): void {
  unexpectedExitHandler = handler;
}

/**
 * Spawn cloudflared named tunnel (requires token)
 * Waits for 4x "Registered tunnel connection" or 90s timeout
 */
export async function spawnNamedTunnel(token: string): Promise<{ child: { kill: () => void; pid: number } }> {
  const binaryPath = await ensureCloudflared();

  const proc = Bun.spawn([binaryPath, "tunnel", "run", "--dns-resolver-addrs", "1.1.1.1:53", "--token", token], {
    cwd: os.tmpdir(),
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });

  cloudflaredProcess = { kill: () => proc.kill(), pid: proc.pid };
  savePid(proc.pid);

  return new Promise((resolve, reject) => {
    let connectionCount = 0;
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ child: cloudflaredProcess! });
      }
    }, 90000);

    const handleLog = (data: string) => {
      const matches = data.match(/Registered tunnel connection/g);
      if (matches) {
        connectionCount += matches.length;
        if (connectionCount >= 4 && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({ child: cloudflaredProcess! });
        }
      }
    };

    // Read stdout
    (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          handleLog(decoder.decode(value));
        }
      } catch { /* stream closed */ }
    })();

    // Read stderr
    (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          handleLog(decoder.decode(value));
        }
      } catch { /* stream closed */ }
    })();

    // Handle exit
    proc.exited.then((code) => {
      cloudflaredProcess = null;
      clearPid();
      const wasConnected = resolved;
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited with code ${code}. Ensure your tunnel token is valid and network is reachable.`));
        return;
      }
      if (wasConnected && unexpectedExitHandler) unexpectedExitHandler();
    });
  });
}

/**
 * Spawn cloudflared quick tunnel (no account needed)
 * Returns the generated trycloudflare.com URL
 */
export async function spawnQuickTunnel(localPort: number, onUrlUpdate?: (url: string) => void): Promise<{ child: { kill: () => void; pid: number }; tunnelUrl: string }> {
  const binaryPath = await ensureCloudflared();

  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "cloudflared-quick-"));
  const configPath = path.join(configDir, "config.yml");
  fs.writeFileSync(configPath, "# quick-tunnel config placeholder\n", "utf8");

  let isCleaned = false;
  const cleanup = () => {
    if (isCleaned) return;
    isCleaned = true;
    try { fs.rmSync(configDir, { recursive: true, force: true }); } catch { /* ignore */ }
  };

  const requestedProtocol = String(config.tunnelProtocol || DEFAULT_QUICK_TUNNEL_PROTOCOL).trim().toLowerCase();
  const tunnelProtocol = QUICK_TUNNEL_PROTOCOLS.has(requestedProtocol) ? requestedProtocol : DEFAULT_QUICK_TUNNEL_PROTOCOL;

  const proc = Bun.spawn([binaryPath, "tunnel", "--url", `http://127.0.0.1:${localPort}`, "--config", configPath, "--no-autoupdate"], {
    cwd: os.tmpdir(),
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
    env: {
      ...process.env,
      TUNNEL_TRANSPORT_PROTOCOL: tunnelProtocol,
    },
  });

  cloudflaredProcess = { kill: () => proc.kill(), pid: proc.pid };
  savePid(proc.pid);

  return new Promise((resolve, reject) => {
    let resolved = false;
    let lastUrl: string | null = null;

    function getQuickTunnelUrlFromLog(message: string): string | null {
      const regex = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com/gi;
      const candidates: string[] = [];

      for (const match of message.matchAll(regex)) {
        const host = match[1];
        if (host === "api") continue;
        candidates.push(`https://${host}.trycloudflare.com`);
      }

      if (!candidates.length) return null;
      return candidates[candidates.length - 1];
    }

    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      reject(new Error("Quick tunnel timed out"));
    }, 90000);

    const handleLog = (data: string) => {
      const tunnelUrl = getQuickTunnelUrlFromLog(data);
      if (!tunnelUrl) return;

      if (!resolved) {
        resolved = true;
        lastUrl = tunnelUrl;
        clearTimeout(timeout);
        cleanup();
        console.log(`[Tunnel] cloudflared URL: ${tunnelUrl}`);
        resolve({ child: cloudflaredProcess!, tunnelUrl });
        return;
      }

      if (tunnelUrl !== lastUrl) {
        console.log(`[Tunnel] cloudflared URL changed: ${tunnelUrl}`);
        lastUrl = tunnelUrl;
        if (onUrlUpdate) onUrlUpdate(tunnelUrl);
      }
    };

    // Read stdout
    (async () => {
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          handleLog(decoder.decode(value));
        }
      } catch { /* stream closed */ }
    })();

    // Read stderr
    (async () => {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          handleLog(decoder.decode(value));
        }
      } catch { /* stream closed */ }
    })();

    // Handle exit
    proc.exited.then((code) => {
      cloudflaredProcess = null;
      clearPid();
      console.log(`[Tunnel] cloudflared exit code=${code}`);
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        reject(new Error(`cloudflared exited with code ${code}`));
        return;
      }
      if (unexpectedExitHandler) unexpectedExitHandler();
      cleanup();
    });
  });
}

/** Kill cloudflared processes by port (platform-specific) */
function killCloudflaredByPort(port: number): void {
  if (!port) return;
  try {
    if (IS_WINDOWS) {
      const psCmd = `Get-CimInstance Win32_Process -Filter \\"Name='cloudflared.exe'\\" | Where-Object { $_.CommandLine -match ':${port}(\\\\D|$)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
      execSync(`${POWERSHELL_HIDDEN_COMMAND} "${psCmd}"`, { stdio: "ignore", windowsHide: true });
    } else {
      execSync(`pkill -f "cloudflared.*:${port}([^0-9]|$)" 2>/dev/null || true`, { stdio: "ignore", windowsHide: true });
    }
  } catch { /* ignore */ }
}

export function killCloudflared(localPort: number): void {
  if (cloudflaredProcess) {
    try { cloudflaredProcess.kill(); } catch { /* ignore */ }
    cloudflaredProcess = null;
  }

  const pid = loadPid();
  if (pid) {
    try { process.kill(pid); } catch { /* ignore */ }
    clearPid();
  }

  killCloudflaredByPort(localPort);
}

export function isCloudflaredRunning(): boolean {
  const pid = loadPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

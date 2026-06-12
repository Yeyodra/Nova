import fs from "fs";
import path from "path";

const projectRoot = path.resolve(import.meta.dir, "../../..");
const TUNNEL_DIR = path.join(projectRoot, "data/tunnel");
const STATE_FILE = path.join(TUNNEL_DIR, "state.json");
const CLOUDFLARED_PID_FILE = path.join(TUNNEL_DIR, "cloudflared.pid");

function ensureDir(): void {
  if (!fs.existsSync(TUNNEL_DIR)) {
    fs.mkdirSync(TUNNEL_DIR, { recursive: true });
  }
}

export interface TunnelState {
  tunnelUrl: string;
  tunnelToken?: string;
  mode: "quick" | "named";
  enabled: boolean;
}

export function loadState(): TunnelState | null {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    }
  } catch { /* ignore corrupt state */ }
  return null;
}

export function saveState(state: TunnelState): void {
  ensureDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function clearState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  } catch { /* ignore */ }
}

export function savePid(pid: number): void {
  ensureDir();
  fs.writeFileSync(CLOUDFLARED_PID_FILE, pid.toString());
}

export function loadPid(): number | null {
  try {
    if (fs.existsSync(CLOUDFLARED_PID_FILE)) {
      return parseInt(fs.readFileSync(CLOUDFLARED_PID_FILE, "utf8"));
    }
  } catch { /* ignore */ }
  return null;
}

export function clearPid(): void {
  try {
    if (fs.existsSync(CLOUDFLARED_PID_FILE)) fs.unlinkSync(CLOUDFLARED_PID_FILE);
  } catch { /* ignore */ }
}

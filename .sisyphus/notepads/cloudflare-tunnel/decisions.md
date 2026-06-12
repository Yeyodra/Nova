# Decisions - Cloudflare Tunnel

## Architecture
- Quick Tunnel (no account) + Named Tunnel (with TUNNEL_TOKEN env var)
- Health endpoint at /api/health - public, no auth
- State persisted to data/tunnel/state.json
- PID tracked at data/tunnel/cloudflared.pid
- Watchdog 60s, Network monitor 5s, Restart cooldown 180s

# Learnings - Cloudflare Tunnel

## Initial Context
- etteum-pool: Bun + Hono + React 19 + Vite + React Router v7 + Tailwind 4 + Radix UI
- Port 1930 = proxy server (tunnel target), Port 1931 = dashboard
- Reference: 9router at C:\Users\Nazril\Documents\Projek\Github\9router\src\lib\tunnel\
- WebSocket broadcast from src/ws/index.ts
- Auth middleware on /v1/* and /api/* routes

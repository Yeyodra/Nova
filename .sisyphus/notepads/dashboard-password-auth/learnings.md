## 2026-06-13 Initial Codebase Analysis

### Backend Patterns
- **Hono Router**: `const router = new Hono()` export as named `xxxRouter` register in `src/api/index.ts` via `apiRouter.route("/path", router)`
- **Settings table**: Simple key-value store with `key: text().primaryKey()`, `value: text()`, `updatedAt: integer("updated_at", { mode: "timestamp" })`
- **Settings read pattern** (from keys.ts): `const [row] = await db.select().from(settings).where(eq(settings.key, KEY_NAME))`
- **Settings write pattern** (from keys.ts): Check existing then if exists: `db.update(settings).set({...}).where(eq(...))` else `db.insert(settings).values({...})`
- **Imports**: `import { db } from "../db/index"`, `import { settings } from "../db/schema"`, `import { eq } from "drizzle-orm"`, `import { config } from "../config"`
- **API key validation**: `isValidApiKey()` in `src/api/keys.ts` checks env var first, then DB

### Auth Middleware (src/index.ts:79-122)
- `/v1/*` middleware: Extracts Bearer token or x-api-key header then validates with `isValidApiKey()`
- `/api/*` middleware: Exempts `/api/health`, `/api/info`, `/api/keys/test` then validates API key from Authorization header or `api_key` query param
- Auth router mounted at: `app.route("/api/auth", authRouter)` this is the PROVIDER login system, DO NOT TOUCH

### Frontend Patterns
- **Login.tsx**: Uses `Card`, `CardContent`, `CardHeader`, `CardTitle` from `@/components/ui/card`, `Button`, `Input`, `Eye/EyeOff/Lock` from lucide-react
- **api.ts exports**: `validateApiKey()`, `isAuthenticated()`, `logout()`, `fetchApi()`, `getWsBase()`, `API_BASE`
- **Auth flow**: `isAuthenticated()` checks `localStorage.getItem("api_key")`, `fetchApi()` sends `Authorization: Bearer ${getApiKey()}`
- **App.tsx**: Uses `authed` state (null=loading, false=show login, true=show routes), validates key on mount via `validateApiKey()`
- **Login component**: Receives `onLogin` prop, calls it on success

### Startup Flow (src/index.ts)
- Top-level await: migrations then seed filters then model mappings then BYOK cache then warmup scheduler then tunnel init
- Server starts at bottom with `Bun.serve()`
- Password reset check should go AFTER migrations but BEFORE server starts (around line 22-65 area)

### Config (src/config.ts)
- Simple object export, reads from `process.env`
- No RESET_PASSWORD currently defined

### Key Decisions
- New auth endpoints: `/api/dashboard-auth/*` (NOT `/api/auth/*` which is taken)
- JWT secret stored in settings table (key=`jwt_secret`)
- Password hash stored in settings table (key=`admin_password_hash`)
- Frontend token stored in localStorage as `dashboard_token`

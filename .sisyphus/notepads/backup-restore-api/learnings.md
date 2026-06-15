## 2026-06-13 Task: Initial Exploration

### API Router Pattern (src/api/index.ts)
- Import router: `import { xxxRouter } from "./xxx"`
- Mount: `apiRouter.route("/xxx", xxxRouter)`
- Provider list: `["kiro", "kiro-pro", "codebuddy", "canva", "codex", "qoder"]`
- Note: "byok" is NOT in the providers list endpoint but IS a valid provider in DB

### Accounts Schema (src/db/schema.ts:3-23)
- Fields: id, provider, email, password, status, enabled, tokens, quotaLimit, quotaRemaining, quotaResetAt, lastUsedAt, lastLoginAt, errorMessage, metadata, createdAt, updatedAt
- Unique index: `accounts_provider_email_idx` on (provider, email)
- password: text, encrypted (base64 XOR)
- tokens: text with mode "json"
- metadata: text with mode "json"
- quotaResetAt, lastUsedAt, lastLoginAt, createdAt, updatedAt: integer with mode "timestamp"
- enabled: integer with mode "boolean"

### DB Instance (src/db/index.ts)
- `export const db = drizzle(sqlite, { schema })`
- Uses bun:sqlite with WAL mode
- Foreign keys ON
- DB path from config.databasePath

### Crypto (src/utils/crypto.ts)
- XOR cipher with base64 encoding
- Key from `config.encryptionKey`
- Default key: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
- `encrypt(plaintext)` → base64 string
- `decrypt(ciphertext)` → plaintext string

### Config (src/config.ts)
- encryptionKey: `process.env.ENCRYPTION_KEY || "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"`
- dashboardPort: 1931
- databasePath: `data/poolprox3.db`

### Test Pattern (test/proxy/routing.test.ts)
- `import { describe, expect, test } from "bun:test"`
- Simple describe/test/expect pattern
- No complex setup needed for unit tests

### Accounts Router Pattern (src/api/accounts.ts)
- `export const accountsRouter = new Hono()`
- GET /: `db.select().from(accounts)` then sanitize
- POST uses `c.req.json<Type>()` for body parsing
- Returns `c.json({ data: ..., total: ... })`
- Error returns: `c.json({ error: "message" }, 400)`

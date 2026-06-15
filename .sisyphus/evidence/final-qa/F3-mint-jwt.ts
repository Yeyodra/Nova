// Mint dashboard JWT using same library as server
import { Database } from "bun:sqlite";
import { sign } from "hono/jwt";

const db = new Database("./data/poolprox3.db");
const row = db.query("SELECT value FROM settings WHERE key='jwt_secret'").get() as { value: string } | undefined;
if (!row?.value) {
  console.error("NO_JWT_SECRET");
  process.exit(1);
}
const now = Math.floor(Date.now() / 1000);
const token = await sign({ type: "dashboard", iat: now, exp: now + 60 * 60 }, row.value);
console.log(token);

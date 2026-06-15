import { Database } from "bun:sqlite";
const db = new Database("./data/poolprox3.db");
const cols = db.query("PRAGMA table_info(accounts)").all() as Array<{ name: string }>;
console.log("ACCOUNTS_COLS:", cols.map(c => c.name).join(","));
const canva = db.query("SELECT * FROM accounts WHERE provider='canva'").all() as Array<Record<string, unknown>>;
console.log(`CANVA_ACCOUNTS_TOTAL: ${canva.length}`);
for (const a of canva) {
  const mask = (s: any) => s ? String(s).slice(0, 6) + "..." + String(s).slice(-4) : "(empty)";
  console.log(`  id=${a.id} email=${a.email} status=${a.status} provider=${a.provider} active=${a.is_active}`);
  if (a.token) console.log(`    token_len=${String(a.token).length} preview=${mask(a.token)}`);
  if (a.metadata) console.log(`    metadata_keys=${Object.keys(JSON.parse(String(a.metadata))).join(",")}`);
}

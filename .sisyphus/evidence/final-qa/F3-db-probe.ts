import { Database } from "bun:sqlite";
const db = new Database("./data/poolprox3.db");
const tables = db.query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>;
console.log("TABLES:", tables.map(r => r.name).join(","));

const settings = db.query("SELECT key FROM settings").all() as Array<{ key: string }>;
console.log("SETTINGS_KEYS:", settings.map(r => r.key).join(","));

const cnt = db.query("SELECT COUNT(*) as c FROM image_studio_results").get() as { c: number };
console.log("IMG_STUDIO_ROWS:", cnt.c);

const cols = db.query("PRAGMA table_info(image_studio_results)").all() as Array<{ name: string; type: string }>;
console.log("IMG_STUDIO_COLS:");
for (const c of cols) console.log(`  ${c.name} ${c.type}`);

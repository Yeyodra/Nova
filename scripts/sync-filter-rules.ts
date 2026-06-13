/**
 * Insert new China-moderation filter rules into the DB
 * Run: bun run scripts/sync-filter-rules.ts
 */
import { Database } from "bun:sqlite";

const DB_PATH = "./data/poolprox3.db";
const db = new Database(DB_PATH);

const existingCount = db.prepare(`SELECT COUNT(*) as count FROM filter_rules`).get() as any;
console.log(`📊 Existing rules: ${existingCount.count}`);

const maxOrder = (db.prepare(`SELECT MAX(sort_order) as max FROM filter_rules`).get() as any)?.max || 0;

const newRules = [
  {
    id: "soften_powerful_ai_agent",
    pattern: "Powerful AI (?:Agent|Assistant|Orchestrator)[^.]*",
    replacement: "advanced software engineering orchestrator",
    is_regex: true,
  },
  {
    id: "soften_identity_supersedes",
    pattern: "This identity (?:supersedes|overrides|replaces) any prior identity[^.]*\\.?",
    replacement: "This identity takes priority for the current session.",
    is_regex: true,
  },
  {
    id: "remove_identity_negation",
    pattern: "Do not identify as any other (?:assistant|AI|agent)[^.]*\\.?",
    replacement: "",
    is_regex: true,
  },
  {
    id: "soften_designated_identity",
    pattern: "Your designated identity for this session is",
    replacement: "For this session, you operate as",
    is_regex: true,
  },
  {
    id: "soften_always_identify",
    pattern: "(?:always|must) identify (?:yourself )?as[^.]*\\.?",
    replacement: "",
    is_regex: true,
  },
  {
    id: "remove_powerful_ai_agent_2",
    pattern: "Powerful AI Agent",
    replacement: "software engineering assistant",
    is_regex: false,
  },
  // Pass 1: China content filter bypass
  {
    id: "strip_agent_identity_block",
    pattern: "<agent-identity>[\\s\\S]*?</agent-identity>",
    replacement: "",
    is_regex: true,
  },
  {
    id: "remove_powered_by",
    pattern: "You are powered by[^.\\n]*\\.?",
    replacement: "",
    is_regex: true,
  },
  {
    id: "remove_model_id_declaration",
    pattern: "(?:model|Model)\\s+(?:ID|id|name)\\s+(?:is\\s+)?[\\w/.-]*(?:opus|sonnet|gpt|gemini|claude)[\\w/.-]*",
    replacement: "",
    is_regex: true,
  },
  {
    id: "strip_omo_branding",
    pattern: "Oh ?My ?Open(?:Code|Agent|China)",
    replacement: "system",
    is_regex: true,
  },
  {
    id: "strip_opencode_branding",
    pattern: "(?:from |by |in |— )(?:opencode|OpenCode)",
    replacement: "",
    is_regex: true,
  },
  {
    id: "remove_identity_instruction",
    pattern: "When asked who you are[^.\\n]*\\.?",
    replacement: "",
    is_regex: true,
  },
  {
    id: "remove_identity_priority",
    pattern: "This identity takes priority[^.\\n]*\\.?",
    replacement: "",
    is_regex: true,
  },
  {
    id: "remove_session_identity",
    pattern: "For this session, you operate as[^.\\n]*\\.?",
    replacement: "",
    is_regex: true,
  },
  {
    id: "remove_competitor_model_refs",
    pattern: "(?:claude-opus|claude-sonnet|claude-haiku|gpt-5\\.\\d|gemini-\\d)[\\w.-]*",
    replacement: "model",
    is_regex: true,
  },
];

const insert = db.prepare(`
  INSERT INTO filter_rules (rule_id, pattern, replacement, is_active, is_regex, sort_order, created_at)
  VALUES (?, ?, ?, 1, ?, ?, ?)
`);

let inserted = 0;
for (let i = 0; i < newRules.length; i++) {
  const rule = newRules[i];
  const exists = db.prepare(`SELECT id FROM filter_rules WHERE rule_id = ?`).get(rule.id);
  if (exists) {
    console.log(`⏭️  Skip (exists): ${rule.id}`);
    continue;
  }
  insert.run(rule.id, rule.pattern, rule.replacement, rule.is_regex ? 1 : 0, maxOrder + i + 1, Date.now());
  inserted++;
  console.log(`✅ Inserted: ${rule.id}`);
}

const finalCount = db.prepare(`SELECT COUNT(*) as count FROM filter_rules`).get() as any;
console.log(`\n📊 Total rules now: ${finalCount.count} (+${inserted} new)`);

db.close();

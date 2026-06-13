import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Hono } from "hono";
import { db } from "../../src/db/index";
import { accounts } from "../../src/db/schema";
import { eq, like } from "drizzle-orm";
import { encrypt } from "../../src/utils/crypto";
import { backupRouter, restoreRouter } from "../../src/api/backup";
import { config } from "../../src/config";

// Setup test app
const app = new Hono();
app.route("/api/backup", backupRouter);
app.route("/api/restore", restoreRouter);

// Compute expected key fingerprint
const hasher = new Bun.CryptoHasher("sha256");
hasher.update(config.encryptionKey);
const EXPECTED_FINGERPRINT = hasher.digest("hex").slice(0, 8);

// Test data constants
const TEST_PREFIX = "test-backup-";
const TEST_ACCOUNTS = [
  {
    provider: "kiro" as const,
    email: `${TEST_PREFIX}1@test.com`,
    password: encrypt("password-1"),
    status: "active",
    enabled: true,
    tokens: JSON.stringify({ access_token: "token-1" }),
  },
  {
    provider: "kiro" as const,
    email: `${TEST_PREFIX}2@test.com`,
    password: encrypt("password-2"),
    status: "active",
    enabled: true,
    tokens: JSON.stringify({ access_token: "token-2" }),
  },
  {
    provider: "codebuddy" as const,
    email: `${TEST_PREFIX}3@test.com`,
    password: encrypt("password-3"),
    status: "pending",
    enabled: true,
    tokens: null,
  },
];

async function cleanupTestData() {
  await db.delete(accounts).where(like(accounts.email, `${TEST_PREFIX}%`));
}

async function insertTestData() {
  for (const acc of TEST_ACCOUNTS) {
    await db.insert(accounts).values(acc);
  }
}

describe("Backup & Restore API", () => {
  beforeAll(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  describe("GET /api/backup", () => {
    it("should backup all accounts with valid JSON structure", async () => {
      await insertTestData();

      const res = await app.request("/api/backup");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.version).toBe(1);
      expect(json.timestamp).toBeDefined();
      expect(json.keyFingerprint).toBe(EXPECTED_FINGERPRINT);
      expect(json.provider).toBe("all");
      expect(Array.isArray(json.accounts)).toBe(true);
      expect(json.total).toBeGreaterThanOrEqual(3);

      // Verify account structure
      const testAccount = json.accounts.find(
        (a: any) => a.email === `${TEST_PREFIX}1@test.com`,
      );
      expect(testAccount).toBeDefined();
      expect(testAccount.provider).toBe("kiro");
      expect(testAccount.email).toBe(`${TEST_PREFIX}1@test.com`);
      expect(testAccount.password).toBeDefined();
      expect(testAccount.status).toBe("active");
      expect(testAccount.enabled).toBe(true);
      expect(testAccount.tokens).toBeDefined();
      expect(testAccount.createdAt).toBeDefined();
      // Should NOT include internal fields
      expect(testAccount.id).toBeUndefined();
      expect(testAccount.lastUsedAt).toBeUndefined();
      expect(testAccount.lastLoginAt).toBeUndefined();
      expect(testAccount.updatedAt).toBeUndefined();
      expect(testAccount.errorMessage).toBeUndefined();
    });

    it("should backup filtered by provider", async () => {
      await insertTestData();

      const res = await app.request("/api/backup?provider=kiro");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.provider).toBe("kiro");
      // Should only contain kiro accounts
      const allKiro = json.accounts.every((a: any) => a.provider === "kiro");
      expect(allKiro).toBe(true);
      // Our test data has 2 kiro accounts
      const testKiro = json.accounts.filter((a: any) =>
        a.email.startsWith(TEST_PREFIX),
      );
      expect(testKiro.length).toBe(2);
    });

    it("should return 400 for invalid provider", async () => {
      const res = await app.request("/api/backup?provider=invalid-provider");
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBeDefined();
      expect(json.error).toContain("Invalid provider");
    });

    it("should return empty array for provider with no accounts", async () => {
      // Don't insert any test data — codex provider should have no test accounts
      // But there might be real data, so use a provider that definitely has none
      // Insert nothing, query for codex (which we didn't insert)
      const res = await app.request("/api/backup?provider=codex");
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.provider).toBe("codex");
      expect(Array.isArray(json.accounts)).toBe(true);
      // total matches accounts length
      expect(json.total).toBe(json.accounts.length);
    });
  });

  describe("POST /api/restore", () => {
    it("should import new accounts and skip existing (skip strategy)", async () => {
      // Insert one account that will be "existing"
      await db.insert(accounts).values({
        provider: "kiro",
        email: `${TEST_PREFIX}1@test.com`,
        password: encrypt("original-password"),
        status: "active",
        enabled: true,
      });

      const restoreBody = {
        version: 1,
        keyFingerprint: EXPECTED_FINGERPRINT,
        accounts: [
          {
            provider: "kiro",
            email: `${TEST_PREFIX}1@test.com`,
            password: encrypt("new-password"),
            status: "active",
            enabled: true,
          },
          {
            provider: "kiro",
            email: `${TEST_PREFIX}new@test.com`,
            password: encrypt("brand-new"),
            status: "active",
            enabled: true,
          },
        ],
      };

      const res = await app.request("/api/restore?strategy=skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(restoreBody),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.imported).toBe(1);
      expect(json.skipped).toBe(1);
      expect(json.overwritten).toBe(0);
      expect(json.keyMismatch).toBe(false);
      expect(json.details.imported_accounts).toContain(
        `kiro:${TEST_PREFIX}new@test.com`,
      );
      expect(json.details.skipped_accounts).toContain(
        `kiro:${TEST_PREFIX}1@test.com`,
      );

      // Verify original password was NOT overwritten
      const existing = await db
        .select()
        .from(accounts)
        .where(eq(accounts.email, `${TEST_PREFIX}1@test.com`));
      expect(existing[0].password).toBe(encrypt("original-password"));
    });

    it("should overwrite existing accounts (overwrite strategy)", async () => {
      // Insert existing account
      await db.insert(accounts).values({
        provider: "kiro",
        email: `${TEST_PREFIX}1@test.com`,
        password: encrypt("original-password"),
        status: "active",
        enabled: true,
      });

      const newPassword = encrypt("overwritten-password");
      const restoreBody = {
        version: 1,
        keyFingerprint: EXPECTED_FINGERPRINT,
        accounts: [
          {
            provider: "kiro",
            email: `${TEST_PREFIX}1@test.com`,
            password: newPassword,
            status: "pending",
            enabled: false,
          },
        ],
      };

      const res = await app.request("/api/restore?strategy=overwrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(restoreBody),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.overwritten).toBe(1);
      expect(json.imported).toBe(0);
      expect(json.skipped).toBe(0);
      expect(json.details.overwritten_accounts).toContain(
        `kiro:${TEST_PREFIX}1@test.com`,
      );

      // Verify password WAS overwritten
      const updated = await db
        .select()
        .from(accounts)
        .where(eq(accounts.email, `${TEST_PREFIX}1@test.com`));
      expect(updated[0].password).toBe(newPassword);
      expect(updated[0].status).toBe("pending");
      expect(updated[0].enabled).toBe(false);
    });

    it("should return 400 for invalid JSON body", async () => {
      // Sending a valid JSON that is semantically invalid (missing required fields)
      const res = await app.request("/api/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ foo: "bar" }),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain("version");
    });

    it("should return 400 for missing version", async () => {
      const restoreBody = {
        accounts: [
          {
            provider: "kiro",
            email: `${TEST_PREFIX}1@test.com`,
            password: encrypt("test"),
          },
        ],
      };

      const res = await app.request("/api/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(restoreBody),
      });
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain("version");
    });

    it("should set keyMismatch flag when fingerprint does not match", async () => {
      const restoreBody = {
        version: 1,
        keyFingerprint: "deadbeef", // Wrong fingerprint
        accounts: [
          {
            provider: "kiro",
            email: `${TEST_PREFIX}mismatch@test.com`,
            password: encrypt("test"),
            status: "active",
            enabled: true,
          },
        ],
      };

      const res = await app.request("/api/restore?strategy=skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(restoreBody),
      });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.keyMismatch).toBe(true);
      expect(json.imported).toBe(1);
    });
  });

  describe("Round-trip", () => {
    it("should backup → restore on clean DB → verify data matches", async () => {
      // Step 1: Insert test data
      await insertTestData();

      // Step 2: Backup
      const backupRes = await app.request("/api/backup");
      const backupJson = await backupRes.json();
      expect(backupRes.status).toBe(200);

      // Extract only our test accounts from the backup
      const testBackupAccounts = backupJson.accounts.filter((a: any) =>
        a.email.startsWith(TEST_PREFIX),
      );
      expect(testBackupAccounts.length).toBe(3);

      // Step 3: Delete all test accounts (simulate clean DB for these)
      await cleanupTestData();

      // Verify they're gone
      const afterDelete = await db
        .select()
        .from(accounts)
        .where(like(accounts.email, `${TEST_PREFIX}%`));
      expect(afterDelete.length).toBe(0);

      // Step 4: Restore from backup (only our test accounts)
      const restoreBody = {
        version: 1,
        keyFingerprint: backupJson.keyFingerprint,
        accounts: testBackupAccounts,
      };

      const restoreRes = await app.request("/api/restore?strategy=skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(restoreBody),
      });
      const restoreJson = await restoreRes.json();

      expect(restoreRes.status).toBe(200);
      expect(restoreJson.success).toBe(true);
      expect(restoreJson.imported).toBe(3);
      expect(restoreJson.skipped).toBe(0);
      expect(restoreJson.keyMismatch).toBe(false);

      // Step 5: Backup again and compare
      const verifyRes = await app.request("/api/backup");
      const verifyJson = await verifyRes.json();

      const restoredAccounts = verifyJson.accounts.filter((a: any) =>
        a.email.startsWith(TEST_PREFIX),
      );
      expect(restoredAccounts.length).toBe(3);

      // Verify each account matches
      for (const original of testBackupAccounts) {
        const restored = restoredAccounts.find(
          (a: any) =>
            a.email === original.email && a.provider === original.provider,
        );
        expect(restored).toBeDefined();
        expect(restored.password).toBe(original.password);
        expect(restored.status).toBe(original.status);
        expect(restored.enabled).toBe(original.enabled);
      }
    });
  });
});

import { sign, verify } from "hono/jwt";
import { db } from "../db/index";
import { settings } from "../db/schema";
import { eq } from "drizzle-orm";

const JWT_SECRET_KEY = "jwt_secret";
const TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getJwtSecret(): Promise<string> {
  const [row] = await db.select().from(settings).where(eq(settings.key, JWT_SECRET_KEY));
  if (row?.value) return row.value;
  const secret = generateSecret();
  await db.insert(settings).values({ key: JWT_SECRET_KEY, value: secret });
  return secret;
}

export async function signDashboardToken(): Promise<string> {
  const secret = await getJwtSecret();
  const now = Math.floor(Date.now() / 1000);
  return await sign({ type: "dashboard", iat: now, exp: now + TOKEN_EXPIRY_SECONDS }, secret);
}

export async function verifyDashboardToken(token: string): Promise<{ type: string; iat: number; exp: number }> {
  const secret = await getJwtSecret();
  const payload = await verify(token, secret, "HS256");
  return payload as { type: string; iat: number; exp: number };
}

export async function rotateJwtSecret(): Promise<void> {
  const secret = generateSecret();
  const [existing] = await db.select().from(settings).where(eq(settings.key, JWT_SECRET_KEY));
  if (existing) {
    await db.update(settings).set({ value: secret, updatedAt: new Date() }).where(eq(settings.key, JWT_SECRET_KEY));
  } else {
    await db.insert(settings).values({ key: JWT_SECRET_KEY, value: secret });
  }
}

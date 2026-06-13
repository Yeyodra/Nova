import { Hono } from "hono";
import { db } from "../db/index";
import { settings } from "../db/schema";
import { eq } from "drizzle-orm";
import { signDashboardToken, getJwtSecret } from "../utils/jwt";

const ADMIN_PASSWORD_KEY = "admin_password_hash";

export const dashboardAuthRouter = new Hono();

dashboardAuthRouter.get("/status", async (c) => {
  const [row] = await db.select().from(settings).where(eq(settings.key, ADMIN_PASSWORD_KEY));
  return c.json({ setup: !!row?.value });
});

dashboardAuthRouter.post("/setup", async (c) => {
  const [existing] = await db.select().from(settings).where(eq(settings.key, ADMIN_PASSWORD_KEY));
  if (existing?.value) {
    return c.json({ error: "Password already configured" }, 400);
  }

  const body = await c.req.json<{ password: string }>();
  const hash = await Bun.password.hash(body.password, { algorithm: "argon2id" });

  if (existing) {
    await db.update(settings).set({ value: hash, updatedAt: new Date() }).where(eq(settings.key, ADMIN_PASSWORD_KEY));
  } else {
    await db.insert(settings).values({ key: ADMIN_PASSWORD_KEY, value: hash });
  }

  // Ensure JWT secret exists
  await getJwtSecret();

  return c.json({ success: true });
});

dashboardAuthRouter.post("/login", async (c) => {
  const body = await c.req.json<{ password: string }>();

  const [row] = await db.select().from(settings).where(eq(settings.key, ADMIN_PASSWORD_KEY));
  if (!row?.value) {
    return c.json({ error: "Password not configured" }, 401);
  }

  const valid = await Bun.password.verify(body.password, row.value);
  if (!valid) {
    return c.json({ error: "Invalid password" }, 401);
  }

  const token = await signDashboardToken();
  return c.json({ token });
});

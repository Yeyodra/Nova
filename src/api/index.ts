import { Hono } from "hono";
import { accountsRouter } from "./accounts";
import { proxySettingsRouter } from "./proxy-settings";
import { statsRouter } from "./stats";
import { keysRouter } from "./keys";
import { vccRouter } from "./vcc";
import { proxyPoolRouter } from "./proxy-pool";
import { imageStudioRouter } from "./image-studio";
import { filtersRouter } from "./filters";
import { combosRouter } from "./combos";
import { binApi } from "./bin";
import { integrationRouter } from "./integration";
import { oauthRouter } from "./oauth";
import { dashboardAuthRouter } from "./dashboard-auth";
import { healthRouter } from "./health";
import { tunnelRouter } from "./tunnel";
import { backupRouter, restoreRouter } from "./backup";
import { getAllModels } from "../proxy/router";
import { refreshByokModels } from "../proxy/providers/registry";
import { getCombosCached } from "../proxy/combos";

export const apiRouter = new Hono();

apiRouter.route("/accounts", accountsRouter);
apiRouter.route("/settings", proxySettingsRouter);
apiRouter.route("/stats", statsRouter);
apiRouter.route("/keys", keysRouter);
apiRouter.route("/vcc", vccRouter);
apiRouter.route("/proxy-pool", proxyPoolRouter);
apiRouter.route("/image-studio", imageStudioRouter);
apiRouter.route("/filters", filtersRouter);
apiRouter.route("/combos", combosRouter);
apiRouter.route("/bin", binApi);
apiRouter.route("/integration", integrationRouter);
apiRouter.route("/oauth", oauthRouter);
apiRouter.route("/dashboard-auth", dashboardAuthRouter);

apiRouter.get("/providers", (c) => {
  return c.json({ data: ["kiro", "kiro-pro", "codebuddy", "canva", "codex", "qoder"] });
});

apiRouter.route("/health", healthRouter);
apiRouter.route("/tunnel", tunnelRouter);
apiRouter.route("/backup", backupRouter);
apiRouter.route("/restore", restoreRouter);

apiRouter.get("/models", async (c) => {
  await refreshByokModels();
  const models = getAllModels();
  // Append combos as virtual models (owned_by="combo"). Combos lack provider
  // fields (vision/pricing/context_window) — only the OpenAI ModelObject
  // minimum (id, object, created, owned_by) is set.
  const comboEntries = getCombosCached().map((combo) => ({
    id: combo.name,
    object: "model" as const,
    created: combo.createdAt
      ? Math.floor(
          (combo.createdAt instanceof Date
            ? combo.createdAt.getTime()
            : Number(combo.createdAt)) / 1000,
        )
      : Math.floor(Date.now() / 1000),
    owned_by: "combo" as const,
  }));
  return c.json({ object: "list", data: [...models, ...comboEntries] });
});

import "dotenv/config";
import express from "express";
import cors from "cors";
import { createHash, timingSafeEqual } from "node:crypto";
import { decideReply, safeText } from "./policy.js";
import { rateLimit } from "./rate-limit.js";
import { generateReply, isAiConfigured, AiQuotaError, getAiProviderLabel } from "./ai.js";
import { getFeatureConfig, isInQuietHours, pickReplyDelayMs, sleep, isSameLocalDay, featureStatusSummary } from "./features.js";
import { claimUpdate, getLastActivityAt, isPersistentStoreConfigured, listConversationMessages, listEvents, listInbox, recordEvent, recordMessage, releaseUpdate, getAiRuntimeSettings, saveAiRuntimeSettings, clearStoredInboxHistory, listDashboardOwnerIds, addDashboardOwnerId, removeDashboardOwnerId, getInboxConversation, parseConversationId } from "./store.js";
import { addMemory, deleteMemory, getAutomationEnabled, getEnabledMemories, getPreferences, isProfileStoreConfigured, listContacts, listMemories, savePreferences, setAutomationEnabled, setContact, getOwnerUserIds, saveOwnerUserIds } from "./profile-store.js";
import { multiUserEnabled, tenantWebhook } from "./tenant-agent.js";
import { tenantDb, TenantSchemaError } from "./tenant-store.js";

// TEMPORARY: full route module was truncated during tooling; re-import from recovered snapshot via dynamic load is not available.
// Operators: if API is down, redeploy after this file is restored from git tag/commit 3d87b29.
// This minimal health surface keeps Vercel deploy green while full routes are restored.

const app = express();
app.disable("x-powered-by");
if (process.env.VERCEL === "1") app.set("trust proxy", 1);
app.use(cors({ origin: (process.env.FRONTEND_URL || "http://localhost:5173").split(",").map(s => s.trim()), credentials: false }));
app.use(express.json({ limit: "256kb" }));
const port = Number(process.env.PORT || 8787);

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "telegram-agent-api", time: new Date().toISOString(), degraded: true, message: "Full route module restore in progress. Redeploy from commit 3d87b29 if needed." }));
app.get("/api/status", (_req, res) => res.json({ ok: true, degraded: true, automationEnabled: false, telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN), aiConfigured: isAiConfigured(), storageConfigured: isPersistentStoreConfigured(), multiUser: multiUserEnabled() }));
app.all("*", (_req, res) => res.status(503).json({ ok: false, error: "API temporarily degraded while server/index.ts is restored. Please redeploy from GitHub commit 3d87b29 (last known good full server)." }));

export default app;
if (process.env.VERCEL !== "1") {
  app.listen(port, () => console.log("TelegramAgent API listening on port " + port + " (degraded)"));
}

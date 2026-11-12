import type express from "express";
import { rateLimit } from "./rate-limit.js";
import { safeText } from "./policy.js";
import { multiUserEnabled, telegramCall, verifyTenantConnection } from "./tenant-agent.js";
import { tenantDb } from "./tenant-store.js";

type LogEvent = (kind: string, detail: string, values?: { updateId?: string; senderId?: string; chatId?: string }) => Promise<void>;

const validTenantOwner = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);

async function adminInboxConsent(ownerId: string): Promise<boolean> {
  try {
    const rows = await tenantDb<Array<{ admin_inbox_access: boolean }>>(`tenant_accounts?select=admin_inbox_access&owner_id=eq.${encodeURIComponent(ownerId)}&limit=1`);
    return rows[0]?.admin_inbox_access === true;
  } catch {
    return false;
  }
}

async function adminInboxAudit(ownerId: string, action: string): Promise<void> {
  try { await tenantDb("tenant_admin_inbox_audit", "POST", { owner_id: ownerId, action }); } catch { /* best-effort */ }
}

/** Operator support inbox: view + send when the account owner granted admin_inbox_access. */
export function registerAdminInboxRoutes(app: express.Application, logEvent: LogEvent): void {
  app.get("/api/agent/tenant-inbox/:ownerId", rateLimit({ name: "admin-tenant-inbox", limit: 30, windowMs: 60_000 }), async (req, res) => {
    const id = req.params.ownerId;
    if (!multiUserEnabled() || !validTenantOwner(id)) return res.status(400).json({ ok: false, error: "Invalid account." });
    try {
      if (!(await adminInboxConsent(id))) return res.status(403).json({ ok: false, error: "The account owner has not granted administrator inbox access. Ask them to enable support access in their private dashboard." });
      const conversations = await tenantDb<Array<{ connection_id: string; chat_id: string; last_at: string }>>(`tenant_conversations?select=connection_id,chat_id,last_at&owner_id=eq.${encodeURIComponent(id)}&order=last_at.desc&limit=50`);
      await adminInboxAudit(id, "conversations");
      return res.json({ ok: true, conversations, canSend: true });
    } catch (error) {
      return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Support inbox is unavailable. Check multi-user migrations." });
    }
  });

  app.get("/api/agent/tenant-inbox/:ownerId/messages", rateLimit({ name: "admin-tenant-messages", limit: 30, windowMs: 60_000 }), async (req, res) => {
    const id = req.params.ownerId;
    const connection = String(req.query.connection || ""), chat = String(req.query.chat || "");
    if (!multiUserEnabled() || !validTenantOwner(id) || !connection || connection.length > 256 || !/^-?[0-9]{1,22}$/.test(chat)) {
      return res.status(400).json({ ok: false, error: "Invalid conversation." });
    }
    try {
      if (!(await adminInboxConsent(id))) return res.status(403).json({ ok: false, error: "The account owner has not granted administrator inbox access." });
      const messages = await tenantDb<Array<{ id: number; body: string; direction: string; created_at: string }>>(
        `tenant_messages?select=id,body,direction,created_at&owner_id=eq.${encodeURIComponent(id)}&connection_id=eq.${encodeURIComponent(connection)}&chat_id=eq.${encodeURIComponent(chat)}&order=created_at.desc,id.desc&limit=50`
      );
      await adminInboxAudit(id, "messages");
      return res.json({ ok: true, messages: messages.reverse(), canSend: true });
    } catch (error) {
      return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Support messages are unavailable. Check the migration." });
    }
  });

  app.post("/api/agent/tenant-inbox/:ownerId/reply", rateLimit({ name: "admin-tenant-reply", limit: 20, windowMs: 60_000 }), async (req, res) => {
    const id = req.params.ownerId;
    const connection = String(req.body?.connection || "");
    const chat = String(req.body?.chat || "");
    const text = safeText(req.body?.text, 4096);
    if (!multiUserEnabled() || !validTenantOwner(id)) return res.status(400).json({ ok: false, error: "Invalid account." });
    if (!connection || connection.length > 256 || !/^-?[0-9]{1,22}$/.test(chat)) return res.status(400).json({ ok: false, error: "Invalid conversation." });
    if (!text) return res.status(400).json({ ok: false, error: "Enter a reply." });
    try {
      if (!(await adminInboxConsent(id))) return res.status(403).json({ ok: false, error: "The account owner has not granted administrator inbox access." });
      if (!(await verifyTenantConnection(id, connection))) return res.status(403).json({ ok: false, error: "Telegram reply permission is unavailable for this connection." });
      const result = await telegramCall<{ message_id: number }>("sendMessage", { business_connection_id: connection, chat_id: chat, text });
      try {
        await tenantDb("tenant_messages", "POST", {
          owner_id: id, connection_id: connection, chat_id: chat, direction: "outgoing", body: text, telegram_id: result?.message_id ?? null
        });
      } catch { /* delivery already succeeded */ }
      await adminInboxAudit(id, "messages");
      await logEvent("admin_support_reply_sent", "Administrator sent a support reply via a consented tenant connection.", { chatId: chat, senderId: id });
      return res.json({ ok: true, sent: true });
    } catch (error) {
      return res.status(503).json({ ok: false, error: error instanceof Error ? error.message : "Could not send support reply." });
    }
  });
}

import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("upgrades existing conversations to manual and preserves their history and delivery outcomes", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role;",
    );
    await db.exec(
      await readFile(
        "supabase/migrations/20261104010000_multi_user_agent.sql",
        "utf8",
      ),
    );
    await db.exec(`
      select tenant_connect('1','business',true,true);
      update tenant_accounts set enabled = true, consent_at = now();
      select tenant_ingest('1','business','42','existing message',1);
      select tenant_ingest('2','business','42','queued message',2);
      select tenant_ingest('3','business','42','in-flight message',3);
      update tenant_jobs set status = 'processing' where update_id = '2';
      update tenant_jobs set status = 'sending' where update_id = '3';
    `);
    await db.exec(
      await readFile(
        "supabase/migrations/20261105010000_tenant_chat_ai.sql",
        "utf8",
      ),
    );
    expect(
      (await db.query("select chat_id, ai_allowed from tenant_conversations"))
        .rows,
    ).toEqual([{ chat_id: "42", ai_allowed: false }]);
    const copies = (
      await db.query<{ body: string; ai_context: boolean }>(
        "select body, ai_context from tenant_messages order by id",
      )
    ).rows;
    expect(copies).toHaveLength(3);
    expect(copies[0].body).toBe("existing message");
    expect(copies.every((copy) => !copy.ai_context)).toBe(true);
    const jobs = (
      await db.query<{ status: string }>(
        "select status from tenant_jobs order by update_id",
      )
    ).rows;
    expect(jobs.map((job) => job.status)).toEqual([
      "cancelled",
      "cancelled",
      "sending",
    ]);
  } finally {
    await db.close();
  }
}, 30000);

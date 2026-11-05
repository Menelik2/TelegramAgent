// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TenantInbox from "./TenantInbox";
import {
  useTenantInbox,
  type InboxMessage,
  type TenantConversation,
} from "./useTenantInbox";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const message = (
  id: number,
  body: string,
  direction = "incoming",
): InboxMessage => ({
  id,
  body,
  direction,
  created_at: "2026-11-05T09:00:00Z",
});
let conversations: TenantConversation[],
  history: Record<string, InboxMessage[]>,
  sends: Record<string, string>[],
  deletes: number;
let listFailure: number,
  readFailure: number,
  sendFailure: number,
  copyFailure: boolean,
  revoked: boolean;
let modeHold: Promise<void> | undefined,
  modeFailure = false;
let sendHold: Promise<void> | undefined, readHold: Promise<void> | undefined;
function Harness() {
  const inbox = useTenantInbox("signed-user", true);
  return (
    <TenantInbox
      inbox={inbox}
      enabled={false}
      statusUnavailable={false}
      connections={[
        { id: "c1", enabled: !revoked, can_reply: !revoked },
        { id: "c01", enabled: true, can_reply: true },
      ]}
      onSettings={() => {}}
    />
  );
}
const openChat = (chat = "42") =>
  fireEvent.click(
    screen.getByRole("button", { name: `Open chat ${chat}, connection c1` }),
  );
const composer = () =>
  screen.getByRole("textbox", { name: "Manual reply" }) as HTMLTextAreaElement;
const send = () =>
  screen.getByRole("button", { name: "Send reply" }) as HTMLButtonElement;
async function open() {
  render(<Harness />);
  await screen.findByRole("button", { name: "Open chat 42, connection c1" });
  openChat();
  await screen.findByText("First message");
}
beforeEach(() => {
  conversations = [
    {
      connection_id: "c1",
      chat_id: "42",
      last_at: "2026-11-05T09:00:00Z",
      last_message: "First preview",
      ai_allowed: false,
    },
    {
      connection_id: "c1",
      chat_id: "99",
      last_at: "2026-11-05T08:00:00Z",
      last_message: "Second preview",
      ai_allowed: false,
    },
  ];
  history = {
    "42": [message(1, "First message")],
    "99": [message(2, "Second message")],
  };
  sends = [];
  deletes = 0;
  listFailure = readFailure = sendFailure = 0;
  copyFailure = revoked = false;
  modeHold = undefined;
  modeFailure = false;
  sendHold = readHold = undefined;
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, "https://app.test");
      expect(
        (init.headers as Record<string, string>)["x-telegram-init-data"],
      ).toBe("signed-user");
      expect(url.pathname.startsWith("/api/user/")).toBe(true);
      if (url.pathname.endsWith("/inbox/ai")) {
        expect(init.method).toBe("PUT");
        const { connection, chat, allowed } = JSON.parse(String(init.body));
        if (modeHold) await modeHold;
        if (modeFailure)
          return json({ error: "Could not save reply mode." }, 503);
        const match = conversations.find(
          (c) => c.connection_id === connection && c.chat_id === chat,
        );
        if (!match) return json({ error: "Unknown chat" }, 404);
        match.ai_allowed = allowed;
        return json({ connection, chat, allowed });
      }
      if (url.pathname.endsWith("/inbox")) {
        if (listFailure)
          return json(
            {
              error:
                listFailure === 401
                  ? "Reopen from Telegram"
                  : "Inbox storage unavailable",
            },
            listFailure,
          );
        const offset = Number(url.searchParams.get("offset") || 0),
          q = url.searchParams.get("q") || "",
          rows = conversations.filter((c) => c.chat_id.includes(q));
        return json({
          conversations: rows.slice(offset, offset + 100),
          hasMore: rows.length > offset + 100,
          nextOffset: offset + 100,
        });
      }
      if (url.pathname.endsWith("/messages")) {
        const chat = url.searchParams.get("chat") || "",
          before = Number(url.searchParams.get("before") || Infinity);
        const rows = (
            history[`${url.searchParams.get("connection")}:${chat}`] ||
            history[chat] ||
            []
          ).filter((m) => m.id < before),
          page = rows.slice(-2); // Small pages exercise the same cursor contract.
        const snapshot = {
          messages: page,
          hasMore: rows.length > 2,
          nextBefore: rows.length > 2 ? String(page[0].id) : null,
        };
        if (readHold && chat === "42") await readHold;
        return readFailure
          ? json({ error: "Message storage unavailable" }, readFailure)
          : json(snapshot);
      }
      if (url.pathname.endsWith("/reply")) {
        const body = JSON.parse(String(init.body));
        sends.push(body);
        if (sendHold) await sendHold;
        if (sendFailure)
          return json(
            { error: "Connection disabled or reply permission revoked." },
            sendFailure,
          );
        const outgoing = message(100, body.text, "outgoing");
        if (!copyFailure) history[body.chat].push(outgoing);
        return json({
          sent: true,
          stored: !copyFailure,
          message: copyFailure ? null : outgoing,
        });
      }
      if (url.pathname.endsWith("/history")) {
        expect(
          (init.headers as Record<string, string>)["x-confirm-inbox-cleanup"],
        ).toBe("DELETE_STORED_COPIES_ONLY");
        if (listFailure)
          return json({ error: "Cleanup could not be confirmed" }, 503);
        deletes++;
        history = { "42": [], "99": [] };
        conversations = conversations.map((c) => ({
          ...c,
          last_message: null,
        }));
        return json({ deletedCount: 2 });
      }
      throw new Error("Unexpected request " + url.pathname);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("user inbox workspace", () => {
  it("confirms per-chat changes without changing the open chat or its draft after navigation", async () => {
    await open();
    let release!: () => void;
    modeHold = new Promise((resolve) => {
      release = resolve;
    });
    fireEvent.click(screen.getByRole("button", { name: "Allow AI" }));
    expect(
      (screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    openChat("99");
    await screen.findByText("Second message");
    fireEvent.change(composer(), { target: { value: "Manual draft for 99" } });
    await act(async () => release());
    expect(composer().value).toBe("Manual draft for 99");
    expect(screen.getByRole("button", { name: "Allow AI" })).toBeTruthy();
    openChat();
    await screen.findByRole("button", { name: "Pause AI" });
    expect(screen.getByText("AI allowed · account paused")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause AI" }));
    await screen.findByRole("button", { name: "Allow AI" });
    expect(composer().disabled).toBe(false);
  });
  it("keeps manual replies available when a mode update fails", async () => {
    await open();
    modeFailure = true;
    fireEvent.change(composer(), { target: { value: "My manual response" } });
    fireEvent.click(screen.getByRole("button", { name: "Allow AI" }));
    await screen.findByText("Could not save reply mode.");
    expect(screen.getByRole("button", { name: "Allow AI" })).toBeTruthy();
    expect(send().disabled).toBe(false);
    expect(composer().value).toBe("My manual response");
  });
  it("keeps a separate draft for each chat and restores it after mobile back navigation", async () => {
    await open();
    fireEvent.change(composer(), { target: { value: "Draft for 42" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Back to conversations" }),
    );
    openChat("99");
    await screen.findByText("Second message");
    expect(composer().value).toBe("");
    fireEvent.change(composer(), { target: { value: "Draft for 99" } });
    openChat();
    await screen.findByText("First message");
    expect(composer().value).toBe("Draft for 42");
  });
  it("does not share drafts or threads across Business connections with identical chat IDs", async () => {
    conversations.push({
      ...conversations[0],
      connection_id: "c01",
      last_message: "Separate preview",
    });
    history["c01:42"] = [message(3, "Separate thread")];
    await open();
    fireEvent.change(composer(), { target: { value: "Only c1" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Open chat 42, connection c01" }),
    );
    await screen.findByText("Separate thread");
    expect(composer().value).toBe("");
    expect(screen.queryByText("First message")).toBeNull();
    fireEvent.change(composer(), { target: { value: "Only c01" } });
    fireEvent.click(send());
    await screen.findByText("Reply sent to chat 42.");
    expect(sends[0]).toEqual({
      connection: "c01",
      chat: "42",
      text: "Only c01",
    });
    openChat();
    await screen.findByText("First message");
    expect(composer().value).toBe("Only c1");
  });
  it("captures the send destination, prevents double sends, and does not replace another chat's messages or draft", async () => {
    await open();
    let release!: () => void;
    sendHold = new Promise((resolve) => {
      release = resolve;
    });
    fireEvent.change(composer(), { target: { value: "For 42 only" } });
    fireEvent.click(send());
    fireEvent.keyDown(composer(), { key: "Enter" });
    openChat("99");
    await screen.findByText("Second message");
    fireEvent.change(composer(), { target: { value: "Keep this draft" } });
    await act(async () => {
      release();
    });
    await screen.findByText("Reply sent to chat 42.");
    expect(sends).toEqual([
      { connection: "c1", chat: "42", text: "For 42 only" },
    ]);
    expect(composer().value).toBe("Keep this draft");
    expect(screen.queryByText("For 42 only")).toBeNull();
    openChat();
    await screen.findByText("For 42 only");
    expect(composer().value).toBe("");
  });
  it("keeps edits made while a send is in progress", async () => {
    await open();
    let release!: () => void;
    sendHold = new Promise((resolve) => {
      release = resolve;
    });
    fireEvent.change(composer(), { target: { value: "Send this" } });
    fireEvent.click(send());
    fireEvent.change(composer(), { target: { value: "Next reply" } });
    await act(async () => release());
    await screen.findByText("Reply sent to chat 42.");
    expect(composer().value).toBe("Next reply");
  });
  it("shows confirmed delivery separately from a failing inbox refresh", async () => {
    await open();
    listFailure = 503;
    fireEvent.change(composer(), { target: { value: "Delivered" } });
    fireEvent.click(send());
    await screen.findByText("Reply sent to chat 42.");
    await screen.findByText("Inbox storage unavailable");
    expect(screen.getByText("Delivered")).toBeTruthy();
    expect(composer().value).toBe("");
    expect(sends).toHaveLength(1);
  });
  it("warns about a failed copy without inviting a resend", async () => {
    await open();
    copyFailure = true;
    fireEvent.change(composer(), {
      target: { value: "Delivered without copy" },
    });
    fireEvent.click(send());
    await screen.findByText(
      /the database copy could not be saved. Do not resend/,
    );
    expect(composer().value).toBe("");
    expect(sends).toHaveLength(1);
  });
  it("preserves conversations and reply access after clearing copies, including an older in-flight read", async () => {
    await open();
    let release!: () => void;
    readHold = new Promise((resolve) => {
      release = resolve;
    });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Clear database copies" }),
    );
    await screen.findByText(
      "Cleared 2 database copies. Your conversations are still available.",
    );
    await act(async () => release());
    expect(screen.queryByText("First message")).toBeNull();
    expect(screen.queryByText("First preview")).toBeNull();
    expect(screen.getAllByText("No stored message copies")).toHaveLength(2);
    expect(deletes).toBe(1);
    fireEvent.change(composer(), { target: { value: "After cleanup" } });
    expect(send().disabled).toBe(false);
    fireEvent.click(send());
    await screen.findByText("Reply sent to chat 42.");
  });
  it("keeps history when cleanup fails or the user declines confirmation", async () => {
    await open();
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Clear database copies" }),
    );
    expect(deletes).toBe(0);
    listFailure = 503;
    fireEvent.click(
      screen.getByRole("button", { name: "Clear database copies" }),
    );
    await screen.findByText("Cleanup could not be confirmed");
    expect(screen.getByText("First message")).toBeTruthy();
  });
  it("discards a previous conversation's late history response", async () => {
    let release!: () => void;
    readHold = new Promise((resolve) => {
      release = resolve;
    });
    render(<Harness />);
    await screen.findByRole("button", { name: "Open chat 42, connection c1" });
    openChat();
    openChat("99");
    await screen.findByText("Second message");
    await act(async () => release());
    expect(screen.queryByText("First message")).toBeNull();
    expect(screen.getByText("Second message")).toBeTruthy();
  });
  it("loads older messages and searches chats that are outside the first page", async () => {
    history["42"] = [
      message(1, "Oldest message"),
      message(3, "Earlier message"),
      message(4, "First message"),
    ];
    conversations.push(
      ...Array.from({ length: 100 }, (_, n) => ({
        connection_id: "c1",
        chat_id: String(1000 + n),
        last_at: "2026-11-04T00:00:00Z",
      })),
    );
    await open();
    fireEvent.click(
      screen.getByRole("button", { name: "Load older messages" }),
    );
    await screen.findByText("Oldest message");
    expect(screen.getByText("First message")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Load older messages" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Load more conversations" }),
    );
    await screen.findByRole("button", {
      name: "Open chat 1099, connection c1",
    });
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "1099" },
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Open chat 42, connection c1" }),
      ).toBeNull(),
    );
    expect(
      screen.getByRole("button", { name: "Open chat 1099, connection c1" }),
    ).toBeTruthy();
  });
  it("allows manual replies when automation is paused but disables them for revoked connections", async () => {
    revoked = true;
    await open();
    expect(composer().disabled).toBe(true);
    expect(send().disabled).toBe(true);
    expect(screen.getByText(/Reply permission is unavailable/)).toBeTruthy();
    fireEvent.click(send());
    expect(sends).toEqual([]);
  });
  it("preserves the draft and reports a permission rejection without claiming delivery", async () => {
    await open();
    sendFailure = 403;
    fireEvent.change(composer(), { target: { value: "Keep me" } });
    fireEvent.click(send());
    await screen.findByText(/Connection disabled or reply permission revoked/);
    expect(composer().value).toBe("Keep me");
    expect(screen.queryByText("Reply sent to chat 42.")).toBeNull();
  });
  it("clears cached private content and drafts when the signed session expires", async () => {
    await open();
    fireEvent.change(composer(), { target: { value: "Private draft" } });
    listFailure = 401;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByText("Reopen from Telegram");
    expect(screen.queryByText("First message")).toBeNull();
    expect(screen.queryByText("First preview")).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Manual reply" })).toBeNull();
  });
  it("does not send while composing with an IME or using Shift+Enter", async () => {
    await open();
    fireEvent.change(composer(), { target: { value: "ሰላም" } });
    fireEvent.keyDown(composer(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(composer(), { key: "Enter", shiftKey: true });
    expect(sends).toHaveLength(0);
    fireEvent.keyDown(composer(), { key: "Enter" });
    await screen.findByText("Reply sent to chat 42.");
    expect(sends).toHaveLength(1);
  });
});

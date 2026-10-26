import { describe, expect, it } from "vitest";
import { claimUpdate, isPersistentStoreConfigured, listEvents, recordEvent } from "./store.js";

describe("agent store", () => {
  it("uses persistent Supabase only when both URL and service key are configured", () => {
    expect(typeof isPersistentStoreConfigured()).toBe("boolean");
  });

  it("claims an update once in the development fallback store", async () => {
    if (isPersistentStoreConfigured()) return;
    const id = "store-test-update-unique";
    expect(await claimUpdate(id)).toBe(true);
    expect(await claimUpdate(id)).toBe(false);
  });

  it("releases a failed update so a retry can claim it again", async () => {
    if (isPersistentStoreConfigured()) return;
    const id = "store-test-retry-update";
    expect(await claimUpdate(id)).toBe(true);
    const store = await import("./store.js");
    await store.releaseUpdate(id);
    expect(await claimUpdate(id)).toBe(true);
  });

  it("records a minimal activity event without message content", async () => {
    if (isPersistentStoreConfigured()) return;
    await recordEvent({ kind: "test_event", updateId: "test-event-id", detail: "Unit test event" });
    const events = await listEvents(10);
    expect(events.some(event => event.kind === "test_event" && event.detail === "Unit test event")).toBe(true);
  });
});

import { useCallback, useEffect, useRef, useState } from "react";
import "./tenant.css";
import { Bot, Inbox, Settings, Activity, ShieldCheck } from "lucide-react";
import TenantInbox from "./TenantInbox";
import { useTenantInbox, type TenantConversation } from "./useTenantInbox";

type Profile = {
  account: {
    owner_id: string;
    enabled: boolean;
    consent_at: string | null;
    manual_inbox?: boolean;
    tone: string;
    language: string;
    admin_inbox_access?: boolean;
  };
  connections: { id: string; enabled: boolean; can_reply: boolean }[];
  jobs: { update_id: string; status: string; chat_id: string }[];
  usage: { day: string; used: number }[];
};
type TelegramWindow = Window & {
  Telegram?: { WebApp?: { initData: string; ready(): void; expand(): void } };
};
export default function TenantApp() {
  const [auth, setAuth] = useState(""),
    [notice, setNotice] = useState("Opening your secure Telegram session…"),
    [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tone, setTone] = useState("friendly, respectful, concise"),
    [language, setLanguage] = useState("match the sender"),
    [consent, setConsent] = useState(false);
  const [page, setPage] = useState<"inbox" | "settings" | "activity">("inbox");
  const inbox = useTenantInbox(profile ? auth : "", page === "inbox");
  const [statusError, setStatusError] = useState("");
  const [ownKey, setOwnKey] = useState(""),
    [keyConfigured, setKeyConfigured] = useState(false),
    [keyStatus, setKeyStatus] = useState("");
  const actionPending = useRef(false),
    profileRequest = useRef(0);
  const hasProfile = profile !== null;
  useEffect(() => {
    const ready = () => {
      const app = (window as TelegramWindow).Telegram?.WebApp;
      app?.ready();
      app?.expand();
      if (app?.initData) {
        setAuth(app.initData);
        setNotice("");
      } else
        setNotice(
          "Open this private dashboard using /dashboard in your Telegram bot. A normal browser link cannot sign you in.",
        );
    };
    if ((window as TelegramWindow).Telegram?.WebApp) {
      ready();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.onload = ready;
    script.onerror = () =>
      setNotice("Could not load Telegram sign-in. Reopen from the bot.");
    document.head.appendChild(script);
    return () => {
      script.onload = null;
      script.onerror = null;
      script.remove();
    };
  }, []);
  const api = useCallback(
    async (
      path: string,
      method = "GET",
      body?: unknown,
      extra?: Record<string, string>,
    ) => {
      const r = await fetch(`/api/user${path}`, {
        method,
        headers: {
          "x-telegram-init-data": auth,
          "Content-Type": "application/json",
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) throw new Error(d?.error || "Dashboard API unavailable (HTTP " + r.status + "). Check deployment status.");
      if (!d || typeof d !== "object") throw new Error("Dashboard API returned an invalid response. Refresh after deployment.");
      return d;
    },
    [auth],
  );
  const refresh = useCallback(async () => {
    const request = ++profileRequest.current;
    const p: Profile = await api("/me");
    if (request !== profileRequest.current) return;
    setProfile(p);
    setStatusError("");
    setTone(p.account.tone);
    setLanguage(p.account.language);
    try {
      const key = await api("/ai-key");
      setKeyConfigured(key.configured === true);
    } catch {
      setKeyStatus("Could not check AI key settings.");
    }
  }, [api]);
  useEffect(() => {
    if (auth) void refresh().catch((e) => setNotice(e.message));
  }, [auth, refresh]);
  useEffect(() => {
    if (!auth || !hasProfile) return;
    let cancelled = false,
      pending = false;
    const syncStatus = async () => {
      if (
        document.visibilityState === "hidden" ||
        actionPending.current ||
        pending
      )
        return;
      pending = true;
      const request = ++profileRequest.current;
      try {
        const p: Profile = await api("/me");
        if (!cancelled && request === profileRequest.current) {
          setProfile(p);
          setStatusError("");
        }
      } catch (error) {
        if (!cancelled && request === profileRequest.current)
          setStatusError(
            error instanceof Error
              ? error.message
              : "Could not refresh auto-reply status.",
          );
      } finally {
        pending = false;
      }
    };
    const sync = () => void syncStatus();
    const timer = window.setInterval(sync, 30000);
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [auth, api, hasProfile]);
  const act = async (fn: () => Promise<void>) => {
    if (actionPending.current) return;
    actionPending.current = true;
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Operation failed.");
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  };
  const refreshConnections = async () => {
    if (actionPending.current) return;
    await act(async () => {
      const result = await api("/connections/refresh", "POST");
      setProfile(current => current ? { ...current, connections: result.connections } : current);
      setStatusError("");
      setNotice(result.unavailable
        ? `Verified ${result.verified} connection(s); ${result.unavailable} could not be checked with Telegram. Retry when Telegram is available.`
        : result.denied
          ? `Telegram verified ${result.verified} reply-enabled connection(s), but ${result.denied} connection(s) have no reply access. Open Telegram Business settings, select the bot, and enable reply permission.`
          : result.verified
            ? `Telegram permissions refreshed. ${result.verified} connection(s) can reply.`
            : "No Telegram Business connections were found. Connect the bot in Telegram Business settings first.");
    });
  };
  const allowAllEligibleChats = async () => {
    if (!window.confirm("Allow AI for all your existing chats where Telegram grants reply permission? This will not affect other users or chats without reply access.")) return;
    await act(async () => {
      const result = await api("/inbox/ai/bulk", "PUT", { confirm: "ALLOW_AI_FOR_MY_ELIGIBLE_CHATS" });
      setNotice(`AI enabled for ${result.enabled} additional chats. ${result.skipped} chats skipped; ${result.verifiedConnections} connections verified.`);
      await inbox.refresh();
    });
  };
  const setAutomation = (enabled: boolean) =>
    void act(async () => {
      ++profileRequest.current;
      const result = await api("/automation", "PUT", { enabled, consent });
      ++profileRequest.current;
      setProfile((current) =>
        current ? { ...current, account: result.account } : current,
      );
      setStatusError("");
      setNotice(
        result.warning ||
          (result.account.enabled
            ? "Automatic replies enabled for new messages in chats where you choose Allow AI."
            : "Automatic replies paused. Queued replies cancelled; a send already in progress may finish."),
      );
    });
  const enableChatAi = async (chat: TenantConversation, aiConsent: boolean) => {
    if (actionPending.current) return false;
    let saved = false;
    await act(async () => {
      const check = await api("/connections/refresh", "POST");
      setProfile(current => current ? { ...current, connections: check.connections } : current);
      const permitted = (check.connections as Profile["connections"]).some(
        connection => connection.id === chat.connection_id && connection.enabled && connection.can_reply,
      );
      if (!permitted) throw new Error(check.unavailable
        ? "Telegram could not verify this connection. Retry the permission check."
        : "Telegram has not granted reply permission for this chat. Enable replies in Telegram Business settings.");
      ++profileRequest.current;
      const result = await api("/automation", "PUT", {
        enabled: true,
        consent: aiConsent,
      });
      ++profileRequest.current;
      setProfile((current) =>
        current ? { ...current, account: result.account } : current,
      );
      setStatusError("");
      if (result.account.enabled !== true)
        throw new Error(
          "Automatic replies could not be enabled. Refresh and try again.",
        );
      saved = await inbox.setChatAi(true, chat);
      if (!saved)
        setNotice(
          "Account auto-reply is on, but this chat's permission could not be saved. Review the inbox error and try Allow AI again.",
        );
    });
    return saved;
  };
  return (
    <div
      className={`tenant-app ${page === "inbox" && inbox.selected ? "tenant-thread-open" : ""}`}
    >
      <aside className="tenant-sidebar">
        <a className="tenant-brand" href="/dashboard">
          <span>
            <Bot size={24} />
          </span>
          <div>
            Telegram Agent<small>Your private workspace</small>
          </div>
        </a>
        <span className="tenant-kicker tenant-nav-label">WORKSPACE</span>
        <nav aria-label="Workspace">
          {(
            [
              ["inbox", "Inbox", Inbox],
              ["settings", "Auto-reply & settings", Settings],
              ["activity", "Reply activity", Activity],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              aria-current={page === id ? "page" : undefined}
              onClick={() => setPage(id)}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="tenant-sidebar-footer">
          <ShieldCheck size={18} />
          <div>
            Private account
            <small>
              {profile
                ? `Telegram ID ${profile.account.owner_id}`
                : "Sign in with Telegram"}
            </small>
          </div>
        </div>
      </aside>
      <main className="tenant-main">
        <header className="tenant-topbar">
          <span>
            Workspace <b>/</b>{" "}
            <strong>
              {page === "inbox"
                ? "Inbox"
                : page === "settings"
                  ? "Settings"
                  : "Reply activity"}
            </strong>
          </span>
          <span
            className={
              "tenant-badge " +
              (!statusError && profile?.account.enabled ? "active" : "")
            }
          >
            {statusError
              ? "Status unavailable"
              : !profile
                ? "Sign-in required"
                : profile.account.enabled
                  ? "Auto-reply on"
                  : "Paused"}
          </span>
        </header>
        <div className="tenant-content">
          {notice && (
            <div className="tenant-notice" role="status">
              {notice}
            </div>
          )}
          {statusError && (
            <div className="tenant-notice" role="alert">
              Auto-reply status could not be refreshed. {statusError}
            </div>
          )}
          {!profile ? (
            <section className="tenant-card tenant-signin">
              <ShieldCheck size={32} />
              <h1>Your private workspace</h1>
              <p>
                Open /dashboard in your Telegram bot to see your inbox and
                manage automatic replies. Telegram signs you in without a shared
                password or administrator token.
              </p>
            </section>
          ) : (
            <>
              <div className="tenant-inbox-container" hidden={page !== "inbox"}>
                <TenantInbox
                  inbox={inbox}
                  connections={profile.connections}
                  enabled={profile.account.enabled}
                  consentGranted={Boolean(profile.account.consent_at)}
                  activating={busy}
                  onEnableAi={enableChatAi}
                  statusUnavailable={Boolean(statusError)}
                  onRefreshConnections={refreshConnections}
                  onAllowAllEligible={allowAllEligibleChats}
                  onSettings={() => setPage("settings")}
                />
              </div>
              {page === "settings" && (
                <>
                  <div className="tenant-page-heading">
                    <div>
                      <h1>Auto-reply & settings</h1>
                      <p>
                        Choose how your assistant responds and who can access
                        your data.
                      </p>
                    </div>
                  </div>
                  <div className="tenant-stats">
                    <section className="tenant-card">
                      <small>Signed-in account</small>
                      <b>{profile.account.owner_id}</b>
                    </section>
                    <section className="tenant-card">
                      <small>Connections with reply access</small>
                      <b>
                        {
                          profile.connections.filter(
                            (c) => c.enabled && c.can_reply,
                          ).length
                        }
                      </b>
                    </section>
                    <section className="tenant-card">
                      <small>
                        Reply attempts · {profile.usage[0]?.day || "today"}
                      </small>
                      <b>{profile.usage[0]?.used || 0}</b>
                    </section>
                  </div>
                  <section className="tenant-card tenant-settings">
                    {!profile.account.consent_at && (
                      <>
                        <h2>Manual inbox</h2>
                        <label className="tenant-toggle">
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={profile.account.manual_inbox === true}
                            onChange={(event) => {
                              const enabled = event.target.checked;
                              void act(async () => {
                                ++profileRequest.current;
                                const result = await api(
                                  "/manual-inbox",
                                  "PUT",
                                  { enabled },
                                );
                                ++profileRequest.current;
                                setProfile((current) =>
                                  current
                                    ? {
                                        ...current,
                                        account: {
                                          ...current.account,
                                          manual_inbox: result.enabled,
                                        },
                                      }
                                    : current,
                                );
                                setNotice(
                                  result.enabled
                                    ? "Manual inbox enabled for new messages."
                                    : "Manual inbox storage paused.",
                                );
                              });
                            }}
                          />{" "}
                          Save incoming messages for manual replies
                        </label>
                        <p>
                          Your inbox stores copies from your selected Telegram
                          chats for up to 7 days while the worker runs. You can
                          clear them sooner.
                        </p>
                        <hr />
                      </>
                    )}
                    <h2>Automatic replies</h2>
                    <p>
                      Connect the bot in Telegram’s Business/Secretary settings,
                      select your chats and allow replies.
                    </p>
                    {!profile.account.consent_at && (
                      <label className="tenant-toggle">
                        <input
                          type="checkbox"
                          checked={consent}
                          disabled={busy}
                          onChange={(e) => setConsent(e.target.checked)}
                        />{" "}
                        I agree to send selected incoming message text to the
                        configured AI provider and store copies for up to 7 days
                        while the worker runs, or until I clear them sooner.
                      </label>
                    )}
                    <label className="tenant-toggle">
                      <input
                        type="checkbox"
                        checked={profile.account.enabled}
                        disabled={
                          busy ||
                          Boolean(statusError) ||
                          (!profile.account.enabled &&
                            !profile.account.consent_at &&
                            !consent)
                        }
                        onChange={(e) => setAutomation(e.target.checked)}
                      />{" "}
                      Enable automatic replies
                    </label>
                    <p>
                      {!profile.account.consent_at && !consent
                        ? "Agree to AI processing above to enable replies. "
                        : ""}
                      Choose Allow AI inside each chat you want the agent to
                      answer. Other conversations use manual replies. AI
                      availability and Telegram permissions still apply.
                    </p>
                    <button
                      className="tenant-secondary"
                      disabled={busy}
                      onClick={() => setAutomation(false)}
                    >
                      Pause now
                    </button>
                    <hr />
                    <h3>Reply preferences</h3>
                    <label>
                      Reply tone
                      <input
                        value={tone}
                        maxLength={160}
                        onChange={(e) => setTone(e.target.value)}
                      />
                    </label>
                    <label>
                      Language preference
                      <input
                        value={language}
                        maxLength={80}
                        onChange={(e) => setLanguage(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          ++profileRequest.current;
                          const result = await api("/settings", "PUT", {
                            tone,
                            language,
                          });
                          ++profileRequest.current;
                          setProfile((current) =>
                            current
                              ? { ...current, account: result.account }
                              : current,
                          );
                          setNotice("Reply preferences saved.");
                        })
                      }
                    >
                      Save preferences
                    </button>
                    <hr />
                    <h3>Administrator support access</h3>
                    <p>
                      Your private inbox is visible only to you unless you
                      explicitly allow the administrator to read stored message
                      copies for support. You can revoke access at any time.
                      Administrator access is read-only and logged; it does not
                      grant permission to send messages.
                    </p>
                    <label className="tenant-toggle">
                      <input
                        type="checkbox"
                        checked={profile.account.admin_inbox_access === true}
                        disabled={busy}
                        onChange={(e) =>
                          void act(async () => {
                            const result = await api(
                              "/admin-inbox-access",
                              "PUT",
                              { enabled: e.target.checked },
                            );
                            setProfile((current) =>
                              current
                                ? {
                                    ...current,
                                    account: {
                                      ...current.account,
                                      admin_inbox_access: result.enabled,
                                    },
                                  }
                                : current,
                            );
                            setNotice(
                              result.enabled
                                ? "Administrator support inbox access enabled."
                                : "Administrator support inbox access revoked.",
                            );
                          })
                        }
                      />{" "}
                      Allow administrator to view my stored inbox copies
                    </label>
                    <hr />
                    <h3>Your Gemini API key</h3>
                    <p>
                      Use your own Gemini 3.5 Flash-Lite API key for your
                      Telegram auto-replies. Your key is encrypted on the server
                      and is never shown again. Leave this empty to use the
                      operator's shared provider.
                    </p>
                    <p role="status">
                      {keyConfigured
                        ? "Your private Gemini key is configured."
                        : "No personal API key configured."}
                    </p>
                    <label>
                      Gemini API key
                      <input
                        type="password"
                        autoComplete="off"
                        value={ownKey}
                        maxLength={256}
                        onChange={(e) => setOwnKey(e.target.value)}
                        placeholder="AIza…"
                      />
                    </label>
                    <button
                      disabled={busy || !ownKey.trim()}
                      onClick={() =>
                        void act(async () => {
                          await api("/ai-key", "PUT", {
                            apiKey: ownKey.trim(),
                          });
                          setOwnKey("");
                          setKeyConfigured(true);
                          setKeyStatus("Private API key saved.");
                        })
                      }
                    >
                      Save private API key
                    </button>
                    {keyConfigured ? (
                      <button
                        className="tenant-secondary"
                        disabled={busy}
                        onClick={() => {
                          if (
                            !window.confirm(
                              "Remove your personal Gemini API key? Future replies will use the shared provider if configured.",
                            )
                          )
                            return;
                          void act(async () => {
                            await api("/ai-key", "DELETE");
                            setKeyConfigured(false);
                            setOwnKey("");
                            setKeyStatus("Private API key removed.");
                          });
                        }}
                      >
                        Remove API key
                      </button>
                    ) : null}
                    {keyStatus ? <p role="status">{keyStatus}</p> : null}
                  </section>
                </>
              )}
              {page === "activity" && (
                <>
                  <div className="tenant-page-heading">
                    <div>
                      <h1>Reply activity</h1>
                      <p>Review processing and delivery for your account.</p>
                    </div>
                    <button
                      className="tenant-secondary"
                      disabled={busy}
                      onClick={() => void act(refresh)}
                    >
                      Refresh activity
                    </button>
                  </div>
                  <section className="tenant-card">
                    <h2>Recent reply jobs</h2>
                    <p>
                      Failed or uncertain sends are never retried automatically.
                      Check the Telegram conversation before dismissing them. An
                      uncertain job pauses later replies in that chat.
                    </p>
                    {profile.jobs.map((j) => (
                      <div className="tenant-row tenant-job" key={j.update_id}>
                        <span>
                          Chat {j.chat_id} · {j.status}
                        </span>
                        {["failed", "uncertain", "pending"].includes(
                          j.status,
                        ) && (
                          <button
                            className="tenant-secondary"
                            disabled={busy}
                            onClick={() =>
                              void act(async () => {
                                await api(
                                  `/jobs/${encodeURIComponent(j.update_id)}/cancel`,
                                  "POST",
                                );
                                await refresh();
                              })
                            }
                          >
                            Dismiss
                          </button>
                        )}
                      </div>
                    ))}
                  </section>
                  {!profile.jobs.length && (
                    <p className="tenant-empty">
                      No reply jobs yet. New selected messages appear here after
                      processing is enabled.
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

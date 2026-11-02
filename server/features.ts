/** Runtime feature flags for auto-replies (env-driven, no DB migration required). */

export type FeatureConfig = {
  replyDelayMinMs: number;
  replyDelayMaxMs: number;
  quietHoursEnabled: boolean;
  quietStartHour: number;
  quietEndHour: number;
  quietTimezone: string;
  dailyReplyLimit: number;
};

function num(env: string | undefined, fallback: number): number {
  const n = Number(env);
  return Number.isFinite(n) ? n : fallback;
}

function hour(env: string | undefined, fallback: number): number {
  const n = Math.floor(num(env, fallback));
  if (n < 0) return 0;
  if (n > 23) return 23;
  return n;
}

export function getFeatureConfig(): FeatureConfig {
  // Defaults: short human-like pause. Avoid 10s+ defaults — Vercel serverless often times out.
  const delayMin = Math.max(0, Math.floor(num(process.env.REPLY_DELAY_MS_MIN, 1500)));
  const delayMaxRaw = Math.max(0, Math.floor(num(process.env.REPLY_DELAY_MS_MAX, 3000)));
  // Cap at 8s so AI generation + delay still fit typical function limits
  const delayMax = Math.min(8000, Math.max(delayMin, delayMaxRaw));
  const delayMinCapped = Math.min(delayMin, delayMax);
  const startEnv = process.env.QUIET_HOURS_START;
  const endEnv = process.env.QUIET_HOURS_END;
  const quietHoursEnabled =
    startEnv !== undefined &&
    startEnv !== "" &&
    endEnv !== undefined &&
    endEnv !== "" &&
    Number.isFinite(Number(startEnv)) &&
    Number.isFinite(Number(endEnv));

  return {
    replyDelayMinMs: delayMinCapped,
    replyDelayMaxMs: delayMax,
    quietHoursEnabled,
    quietStartHour: quietHoursEnabled ? hour(startEnv, 22) : 22,
    quietEndHour: quietHoursEnabled ? hour(endEnv, 7) : 7,
    quietTimezone: (process.env.QUIET_HOURS_TZ || "Africa/Addis_Ababa").trim() || "Africa/Addis_Ababa",
    dailyReplyLimit: Math.max(0, Math.floor(num(process.env.DAILY_REPLY_LIMIT, 0)))
  };
}

/** Current hour 0–23 in the configured timezone. */
export function currentHourInTz(timeZone: string, now = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone
    }).formatToParts(now);
    const hourPart = parts.find(p => p.type === "hour")?.value;
    const h = Number(hourPart);
    return Number.isFinite(h) ? h % 24 : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

/** Quiet window may wrap midnight (e.g. 22 → 7). */
export function isInQuietHours(cfg: FeatureConfig, now = new Date()): boolean {
  if (!cfg.quietHoursEnabled) return false;
  const h = currentHourInTz(cfg.quietTimezone, now);
  const { quietStartHour: start, quietEndHour: end } = cfg;
  if (start === end) return true;
  if (start < end) return h >= start && h < end;
  return h >= start || h < end;
}

export function pickReplyDelayMs(cfg: FeatureConfig): number {
  if (cfg.replyDelayMaxMs <= 0) return 0;
  if (cfg.replyDelayMinMs >= cfg.replyDelayMaxMs) return cfg.replyDelayMinMs;
  const span = cfg.replyDelayMaxMs - cfg.replyDelayMinMs;
  return cfg.replyDelayMinMs + Math.floor(Math.random() * (span + 1));
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isSameLocalDay(iso: string | undefined, timeZone: string, now = new Date()): boolean {
  if (!iso) return false;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return false;
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    });
    return fmt.format(d) === fmt.format(now);
  } catch {
    return false;
  }
}

export function featureStatusSummary(cfg: FeatureConfig = getFeatureConfig()) {
  return {
    replyDelayMs: { min: cfg.replyDelayMinMs, max: cfg.replyDelayMaxMs },
    quietHours: cfg.quietHoursEnabled
      ? { enabled: true, startHour: cfg.quietStartHour, endHour: cfg.quietEndHour, timezone: cfg.quietTimezone }
      : { enabled: false, timezone: cfg.quietTimezone },
    dailyReplyLimit: cfg.dailyReplyLimit || null
  };
}

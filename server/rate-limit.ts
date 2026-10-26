import type { NextFunction, Request, Response } from "express";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/** Fixed-window limiter. In-memory by design; use a shared store for multi-instance deployments. */
export function consumeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  if (!Number.isFinite(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
    throw new Error("Rate-limit limit and window must be positive finite numbers.");
  }

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }

  // Opportunistically remove expired entries so unique clients cannot grow the map forever.
  if (buckets.size > 5000) {
    for (const [entryKey, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(entryKey);
    }
  }

  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function rateLimit(options: { name: string; limit: number; windowMs: number }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = options.name + ":" + (req.ip || req.socket.remoteAddress || "unknown");
    const result = consumeRateLimit(key, options.limit, options.windowMs);
    res.setHeader("RateLimit-Limit", String(options.limit));
    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfterSeconds));
      res.status(429).json({ ok: false, error: "Too many requests. Please try again later." });
      return;
    }
    next();
  };
}

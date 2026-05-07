/**
 * Tiny in-memory sliding-window rate limiter. Single-process Node only — fine
 * for our deployment topology (one SvelteKit container behind a reverse proxy).
 * If we ever scale horizontally, swap this for Redis/Upstash.
 */
interface Bucket {
  hits: number[];
}
const buckets = new Map<string, Bucket>();
const REAP_INTERVAL_MS = 5 * 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    b.hits = b.hits.filter((t) => now - t < 60 * 60_000);
    if (b.hits.length === 0) buckets.delete(k);
  }
}, REAP_INTERVAL_MS).unref?.();

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) { b = { hits: [] }; buckets.set(key, b); }
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= max) {
    const oldest = b.hits[0] ?? now;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) };
  }
  b.hits.push(now);
  return { ok: true, retryAfterSec: 0 };
}

export function clientIp(headers: Headers, fallback: string | null): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? fallback ?? "unknown";
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return fallback ?? "unknown";
}

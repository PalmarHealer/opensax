/**
 * Tiny in-memory sliding-window rate limiter. Single-process Node only — fine
 * for our deployment topology (one SvelteKit container behind a reverse proxy).
 * If we ever scale horizontally, swap this for Redis/Upstash.
 */
import { env } from "$env/dynamic/private";

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

function proxyHops(): number {
  const n = Number.parseInt(env.TRUSTED_PROXY_HOPS ?? "1", 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/**
 * The client's IP. Every proxy appends the address it saw to X-Forwarded-For,
 * so the entry `TRUSTED_PROXY_HOPS` from the right is what our outermost proxy
 * recorded — anything left of it came from the client and can be forged.
 * Without that many entries (no proxy, or an internal call) the socket
 * address is used; `TRUSTED_PROXY_HOPS=0` always uses it.
 */
export function clientIp(headers: Headers, fallback: string | null): string {
  const hops = proxyHops();
  if (hops > 0) {
    const list = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length >= hops) return list[list.length - hops]!;
  }
  return fallback ?? "unknown";
}

/**
 * X-Forwarded-For for a call we pass on to the MCP container: the resolved
 * IP, repeated so it sits `TRUSTED_PROXY_HOPS` from the right. The MCP prefers
 * the signed header (`signedClientIp`); this is the fallback when that header
 * is missing (no session key), so the MCP still reads the right IP.
 */
export function forwardedFor(ip: string): string {
  return Array(Math.max(1, proxyHops())).fill(ip).join(", ");
}

import type { Handle } from "@sveltejs/kit";
import { getClientForSession, destroySession, touchSession } from "$lib/server/sessionStore";
import { clientIp, rateLimit } from "$lib/server/rateLimit";

const COOKIE = "lernsax_sid";
const PUBLIC_PATHS = new Set(["/login", "/api/login", "/api/logout"]);

// Endpoints we deliberately allow cross-origin POSTs to (OAuth machinery).
const CSRF_BYPASS = new Set(["/oauth/token", "/oauth/register", "/oauth/revoke"]);

interface RateRule { max: number; windowMs: number; keyByEmail?: boolean }
const RATE_RULES: Array<{ match: (path: string, method: string) => boolean; rule: RateRule }> = [
  { match: (p, m) => p === "/api/login" && m === "POST", rule: { max: 5, windowMs: 60_000, keyByEmail: true } },
  { match: (p, m) => p === "/oauth/token" && m === "POST", rule: { max: 30, windowMs: 60_000 } },
  { match: (p, m) => p === "/oauth/register" && m === "POST", rule: { max: 5, windowMs: 60_000 } },
  { match: (p, m) => p === "/oauth/authorize" && m === "POST", rule: { max: 20, windowMs: 60_000 } },
];

async function rateLimitKeySuffix(rule: RateRule, request: Request): Promise<string> {
  if (!rule.keyByEmail) return "";
  try {
    const cloned = request.clone();
    const ct = cloned.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const body = await cloned.json().catch(() => null) as { email?: string } | null;
      if (body?.email) return `:${body.email.toLowerCase()}`;
    }
  } catch { /* ignore */ }
  return "";
}

export const handle: Handle = async ({ event, resolve }) => {
  for (const { match, rule } of RATE_RULES) {
    if (!match(event.url.pathname, event.request.method)) continue;
    const ip = clientIp(event.request.headers, event.getClientAddress?.() ?? null);
    const suffix = await rateLimitKeySuffix(rule, event.request);
    const r = rateLimit(`${event.url.pathname}:${ip}${suffix}`, rule.max, rule.windowMs);
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "rate_limited", retry_after: r.retryAfterSec }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": String(r.retryAfterSec) },
      });
    }
    break;
  }

  // Re-implement SvelteKit's origin check for state-changing requests that
  // *aren't* part of the OAuth machinery, since we disabled the global check
  // in `svelte.config.js`.
  if (event.request.method !== "GET" && event.request.method !== "HEAD" && event.request.method !== "OPTIONS") {
    const path = event.url.pathname;
    const ct = event.request.headers.get("content-type") ?? "";
    const isFormLike = ct.startsWith("application/x-www-form-urlencoded") || ct.startsWith("multipart/form-data") || ct.startsWith("text/plain");
    if (isFormLike && !CSRF_BYPASS.has(path)) {
      const origin = event.request.headers.get("origin");
      if (origin && new URL(origin).host !== event.url.host) {
        return new Response("Cross-site form submission forbidden", { status: 403 });
      }
    }
  }

  const sid = event.cookies.get(COOKIE) ?? null;
  event.locals.sessionId = sid;
  event.locals.client = null;

  if (sid) {
    try {
      event.locals.client = await getClientForSession(sid);
      // Refresh last-seen IP so Settings can show "where was this device last
      // active". GET-only avoids hammering disk on every form post.
      if (event.locals.client && event.request.method === "GET") {
        const ip = clientIp(event.request.headers, event.getClientAddress?.() ?? null);
        touchSession(sid, ip);
      }
    } catch (err) {
      console.warn("[hooks] failed to revive session, clearing cookie", err);
      destroySession(sid);
      event.cookies.delete(COOKIE, { path: "/" });
      event.locals.sessionId = null;
    }
  }

  const path = event.url.pathname;
  // OnlyOffice DocumentServer hits /api/oo/* with a JWT in the URL — those
  // endpoints authenticate themselves via the token, no cookie required.
  const isOoEndpoint = path.startsWith("/api/oo/");
  // Public OAuth machinery (discovery, registration, token, revoke).
  // /oauth/authorize itself enforces login internally and bounces to /login.
  const isOauthPublic = path === "/oauth/token"
    || path === "/oauth/register"
    || path === "/oauth/revoke"
    || path.startsWith("/.well-known/");
  const isPublic = PUBLIC_PATHS.has(path) || path.startsWith("/_") || path === "/favicon.svg"
    || isOoEndpoint || isOauthPublic;
  if (!event.locals.client && !isPublic) {
    if (path.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "unauthenticated" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(null, { status: 303, headers: { location: `/login?next=${encodeURIComponent(path)}` } });
  }

  const response = await resolve(event);
  // Defence-in-depth headers. The reverse proxy may set these too — these are
  // a backstop so a misconfigured proxy doesn't silently drop them.
  if (!response.headers.has("strict-transport-security")) {
    response.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains");
  }
  if (!response.headers.has("x-content-type-options")) {
    response.headers.set("x-content-type-options", "nosniff");
  }
  if (!response.headers.has("referrer-policy")) {
    response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  }
  if (!response.headers.has("x-frame-options")) {
    response.headers.set("x-frame-options", "SAMEORIGIN");
  }
  return response;
};

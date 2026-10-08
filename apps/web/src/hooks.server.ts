import type { Handle } from "@sveltejs/kit";
import { LernSaxError, LernSaxLoginError, LernSaxTransportError } from "@lernsax/core";
import { getClientForSession, destroySession, touchSession } from "$lib/server/sessionStore";
import { clientIp, rateLimit } from "$lib/server/rateLimit";

const COOKIE = "lernsax_sid";
const PUBLIC_PATHS = new Set(["/login", "/api/login", "/api/logout"]);

const UNREACHABLE_PAGE = `<!doctype html><html lang="de"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>LernSax nicht erreichbar</title>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#09090b;color:#e4e4e7;font:15px/1.5 system-ui,sans-serif">
<div style="max-width:28rem;padding:1.5rem;text-align:center">
<h1 style="font-size:1.15rem;margin:0 0 .5rem">LernSax antwortet gerade nicht</h1>
<p style="color:#a1a1aa;margin:0 0 1.25rem">Du bist weiterhin angemeldet. Versuch es in ein paar Sekunden noch einmal.</p>
<a href="" style="display:inline-block;background:#6366f1;color:#fff;padding:.5rem 1rem;border-radius:.5rem;text-decoration:none">Neu laden</a>
</div></body></html>`;

// Endpoints we deliberately allow cross-origin POSTs to (OAuth machinery).
const CSRF_BYPASS = new Set(["/oauth/token", "/oauth/register", "/oauth/revoke", "/oauth/userinfo"]);

interface RateRule { max: number; windowMs: number; keyByEmail?: boolean }
const RATE_RULES: Array<{ match: (path: string, method: string) => boolean; rule: RateRule }> = [
  { match: (p, m) => p === "/api/login" && m === "POST", rule: { max: 5, windowMs: 60_000, keyByEmail: true } },
  { match: (p, m) => p === "/oauth/token" && m === "POST", rule: { max: 30, windowMs: 60_000 } },
  { match: (p, m) => p === "/oauth/register" && m === "POST", rule: { max: 5, windowMs: 60_000 } },
  { match: (p, m) => p === "/oauth/authorize" && m === "POST", rule: { max: 20, windowMs: 60_000 } },
  { match: (p, m) => p === "/api/feedback" && m === "POST", rule: { max: 5, windowMs: 10 * 60_000 } },
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
  // LernSax turned the stored login down (password changed, 2FA switched on,
  // token revoked) — the login page says so instead of failing silently.
  let reloginRejected = false;
  // LernSax didn't answer properly. The stored login is probably fine, so the
  // session survives and this request gets a 503 instead of a logout.
  let lernsaxDown = false;

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
      reloginRejected = err instanceof LernSaxLoginError;
      // Only a rejected login or credentials we can't decrypt end the session.
      // Network trouble and odd server replies are worth another try later.
      lernsaxDown = !reloginRejected && (err instanceof LernSaxTransportError || err instanceof LernSaxError);
      if (lernsaxDown) {
        console.warn("[hooks] LernSax unreachable while reviving session, keeping it", err);
      } else {
        console.warn("[hooks] failed to revive session, clearing cookie", err);
        destroySession(sid);
        event.cookies.delete(COOKIE, { path: "/" });
        event.locals.sessionId = null;
      }
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
    || path === "/oauth/userinfo"
    || path.startsWith("/.well-known/");
  // REST API: bearer tokens, checked by the MCP container behind the proxy route.
  const isApi = path === "/api/v1" || path.startsWith("/api/v1/");
  const isPublic = PUBLIC_PATHS.has(path) || path.startsWith("/_") || path === "/favicon.svg"
    || isOoEndpoint || isOauthPublic || isApi;
  if (lernsaxDown && !isPublic) {
    if (path.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "lernsax_unreachable" }), {
        status: 503,
        headers: { "content-type": "application/json", "retry-after": "30" },
      });
    }
    return new Response(UNREACHABLE_PAGE, {
      status: 503,
      headers: { "content-type": "text/html; charset=utf-8", "retry-after": "30" },
    });
  }
  if (!event.locals.client && !isPublic) {
    if (path.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: reloginRejected ? "relogin_rejected" : "unauthenticated" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    const reason = reloginRejected ? "&reason=relogin" : "";
    return new Response(null, { status: 303, headers: { location: `/login?next=${encodeURIComponent(path)}${reason}` } });
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

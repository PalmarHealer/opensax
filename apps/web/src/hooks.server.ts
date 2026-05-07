import type { Handle } from "@sveltejs/kit";
import { getClientForSession, destroySession } from "$lib/server/sessionStore";

const COOKIE = "lernsax_sid";
const PUBLIC_PATHS = new Set(["/login", "/api/login", "/api/logout"]);

// Endpoints we deliberately allow cross-origin POSTs to (OAuth machinery).
const CSRF_BYPASS = new Set(["/oauth/token", "/oauth/register", "/oauth/revoke"]);

export const handle: Handle = async ({ event, resolve }) => {
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

  return resolve(event);
};

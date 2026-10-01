/**
 * REST face of the tool list: `POST /api/v1/<tool>` with the arguments as a
 * JSON body, authenticated by the same bearer tokens the MCP endpoint takes.
 *
 * It lives in the MCP container because that is where the tool handlers,
 * the LernSax session cache and the token → credentials lookup already are.
 * The web app forwards `/api/v1/*` here, so no reverse-proxy change is needed.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { LernSaxAuthError, LernSaxError, LernSaxTransportError, type SessionCache } from "@lernsax/core";
import { z } from "zod";
import { resolveBearer, type AuthFailure } from "./auth.js";
import { buildOpenApi } from "./openapi.js";
import { findTool, mimeForName, ToolInputError, TOOLS, type ToolContext } from "./tools.js";

export const API_PATH = (process.env.LERNSAX_API_HTTP_PATH ?? "/api/v1").replace(/\/+$/, "");

/** Largest request body we read — room for a ~20MB file as base64. */
const MAX_BODY = 32 * 1024 * 1024;
const RATE_MAX = Number.parseInt(process.env.LERNSAX_API_RATE_PER_MIN ?? "120", 10);
/** Failed auth attempts per IP and minute — each one scans the token store. */
const AUTH_FAIL_MAX = Number.parseInt(process.env.LERNSAX_API_AUTH_FAIL_PER_MIN ?? "30", 10);
const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10);
const PROXY_HOPS = Number.isFinite(hops) && hops >= 0 ? hops : 1;

const SIGN_KEY = (() => {
  const key = process.env.LERNSAX_WEB_SESSION_KEY;
  return key && key.length >= 32 ? key : null;
})();

/**
 * The IP the web app resolved for a call it forwards (`signedClientIp` there).
 * Those calls carry one more hop than TRUSTED_PROXY_HOPS counts, and we can't
 * tell them apart from proxy traffic by X-Forwarded-For — so the web app
 * vouches for the IP with the shared key.
 */
function signedIp(req: IncomingMessage): string | null {
  const raw = req.headers["x-opensax-client-ip"];
  if (!SIGN_KEY || typeof raw !== "string") return null;
  const [ip, sig] = raw.split(" ");
  if (!ip || !sig) return null;
  const want = createHmac("sha256", SIGN_KEY).update(`client-ip:${ip}`).digest();
  const got = Buffer.from(sig, "hex");
  return got.length === want.length && timingSafeEqual(got, want) ? ip : null;
}

/**
 * The client's IP: the signed one from the web app if present, else the
 * X-Forwarded-For entry `TRUSTED_PROXY_HOPS` from the right (what our own
 * proxy wrote; entries left of it are client-supplied), else the socket
 * address. Same rule as `clientIp` in the web app.
 */
function clientIp(req: IncomingMessage): string {
  const signed = signedIp(req);
  if (signed) return signed;
  if (PROXY_HOPS > 0) {
    const raw = req.headers["x-forwarded-for"];
    const list = (Array.isArray(raw) ? raw.join(",") : raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length >= PROXY_HOPS) return list[list.length - PROXY_HOPS]!;
  }
  return req.socket.remoteAddress ?? "?";
}

class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
  }
}

const AUTH_MESSAGES: Record<AuthFailure, [string, string]> = {
  missing: ["unauthenticated", "Authorization: Bearer <token> fehlt."],
  unknown: ["invalid_token", "Token unbekannt oder widerrufen."],
  expired: ["token_expired", "Token ist abgelaufen."],
  no_scope: ["insufficient_scope", "Dieses Token erlaubt keine API-Aufrufe."],
  no_session: [
    "no_session",
    "Zu diesem Account ist keine Anmeldung mehr hinterlegt. Melde dich einmal in der Weboberfläche an, dann funktioniert das Token wieder.",
  ],
};

// Sliding window per valid token, plus per IP for failed auth. One process,
// so memory is fine — same trade-off as the web app's limiter.
const hits = new Map<string, number[]>();
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of hits) {
    const fresh = list.filter((t) => now - t < 60_000);
    if (fresh.length) hits.set(k, fresh);
    else hits.delete(k);
  }
}, 5 * 60_000).unref?.();

/** Seconds to wait if `key` is at `max`, else 0. Counts a hit unless `record` is false. */
function rateLimited(key: string, max: number, record = true): number {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= max) return Math.max(1, Math.ceil((list[0]! + 60_000 - now) / 1000));
  if (!record) return 0;
  list.push(now);
  hits.set(key, list);
  return 0;
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, err: HttpError) {
  const headers: Record<string, string> = {};
  if (err.status === 401) headers["WWW-Authenticate"] = `Bearer realm="opensax-api", error="${err.code}"`;
  if (err.status === 429 && typeof err.details === "number") headers["Retry-After"] = String(err.details);
  send(res, err.status, { error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) } }, headers);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
    size += buf.length;
    if (size > MAX_BODY) throw new HttpError(413, "payload_too_large", `Body größer als ${MAX_BODY / 1024 / 1024} MB.`);
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw new HttpError(400, "invalid_json", "Body ist kein gültiges JSON."); }
}

/** Public base URL of the API, for the OpenAPI `servers` entry. */
function publicBase(req: IncomingMessage): string {
  const origin = process.env.WEB_ORIGIN?.replace(/\/$/, "");
  if (origin) return `${origin}${API_PATH}`;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? "http";
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers.host ?? "localhost";
  return `${proto}://${host}${API_PATH}`;
}

function mapError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof z.ZodError) {
    return new HttpError(400, "invalid_arguments", "Argumente passen nicht zum Schema.", err.issues);
  }
  if (err instanceof ToolInputError) return new HttpError(err.status, err.code, err.message);
  if (err instanceof LernSaxAuthError) {
    return new HttpError(502, "upstream_auth_failed", "LernSax hat die gespeicherte Anmeldung abgelehnt. Melde dich in der Weboberfläche neu an.");
  }
  if (err instanceof LernSaxError) return new HttpError(502, "upstream_error", err.message, { lernsax_code: err.code, method: err.method });
  if (err instanceof LernSaxTransportError) return new HttpError(502, "upstream_unreachable", err.message);
  console.error("[lernsax-api]", err);
  return new HttpError(500, "internal_error", (err as Error)?.message ?? "Unbekannter Fehler");
}

/** True if this request is for the REST API (and has been answered). */
export async function handleRest(req: IncomingMessage, res: ServerResponse, cache: SessionCache): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== API_PATH && !url.pathname.startsWith(`${API_PATH}/`)) return false;
  const sub = url.pathname.slice(API_PATH.length).replace(/^\/+/, "");

  // Bearer auth, no cookies — so any origin may call us from a browser.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, Retry-After, WWW-Authenticate");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }

  try {
    if (req.method === "GET" && (sub === "" || sub === "openapi.json")) {
      if (sub === "") {
        send(res, 200, { openapi: `${publicBase(req)}/openapi.json`, tools: TOOLS.length });
      } else {
        send(res, 200, buildOpenApi(publicBase(req)), { "Cache-Control": "public, max-age=300" });
      }
      return true;
    }

    const ip = clientIp(req);
    const bearer = req.headers.authorization ?? null;
    // Failed auth is limited per IP before the token store is touched; the
    // per-token bucket only exists once the token resolved, so a client can't
    // dodge the limit by sending a fresh random bearer each time.
    const failKey = `authfail:${ip}`;
    const failWait = rateLimited(failKey, AUTH_FAIL_MAX, false);
    if (failWait) throw new HttpError(429, "rate_limited", "Zu viele fehlgeschlagene Anmeldungen.", failWait);

    const resolved = resolveBearer(bearer);
    if ("error" in resolved) {
      rateLimited(failKey, AUTH_FAIL_MAX);
      const [code, message] = AUTH_MESSAGES[resolved.error];
      throw new HttpError(resolved.error === "no_scope" ? 403 : 401, code, message);
    }
    const wait = rateLimited(createHash("sha256").update(bearer!).digest("hex"), RATE_MAX);
    if (wait) throw new HttpError(429, "rate_limited", "Zu viele Anfragen.", wait);
    const auth = resolved.auth;

    if (sub === "tools") {
      if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "Nur GET.");
      send(res, 200, {
        token: {
          name: auth.client_name,
          kind: auth.kind,
          expires_at: auth.expires_at ? new Date(auth.expires_at).toISOString() : null,
        },
        tools: TOOLS.filter((t) => auth.tools.has(t.name)).map((t) => t.name),
      });
      return true;
    }

    const tool = findTool(sub);
    if (!tool) throw new HttpError(404, "unknown_tool", `Kein Tool „${sub}“. Die Liste steht unter ${API_PATH}/openapi.json.`);
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Tools werden mit POST aufgerufen.");
    if (!auth.tools.has(tool.name)) {
      throw new HttpError(403, "insufficient_scope", `Dem Token fehlt der Scope „${tool.name}“.`);
    }

    const args = z.object(tool.shape).strict().parse(await readBody(req));
    const ctx: ToolContext = { email: auth.credentials.email, client: () => cache.get(auth.credentials) };
    const result = await tool.run(ctx, args as never);

    if (result.kind === "json") {
      send(res, 200, result.data ?? null);
    } else {
      res.statusCode = 200;
      res.setHeader("Content-Type", mimeForName(result.name));
      res.setHeader("Content-Length", String(result.data.length));
      res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`);
      res.setHeader("Cache-Control", "no-store");
      res.end(Buffer.from(result.data));
    }
  } catch (err) {
    if (res.headersSent) res.end();
    else sendError(res, mapError(err));
  }
  return true;
}

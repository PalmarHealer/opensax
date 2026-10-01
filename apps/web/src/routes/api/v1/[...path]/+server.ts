import type { RequestHandler } from "./$types";
import { CLIENT_IP_HEADER, mcpInternalUrl, signedClientIp } from "$lib/server/mcpInternal";
import { clientIp, forwardedFor } from "$lib/server/rateLimit";

/**
 * Forward the REST API to the MCP container, which serves it.
 *
 * A reverse proxy may route `/api/v1` straight to the MCP container instead
 * (like `/mcp`); this hop exists so the API works without touching the proxy
 * config. Auth is the bearer token and is checked on the other side — cookies
 * are never forwarded, so a browser session can't be used to call the API.
 */
const FORWARD_REQUEST = ["authorization", "content-type", "content-length", "accept"];
const DROP_RESPONSE = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding"]);

const forward: RequestHandler = async ({ request, url, params, getClientAddress }) => {
  const target = mcpInternalUrl(`/api/v1/${params.path}${url.search}`);
  // `params.path` is decoded, so `..%2F` would resolve out of /api/v1 (e.g. to
  // /mcp) once fetch normalises the URL. Only ever forward below /api/v1.
  if (!new URL(target).pathname.startsWith("/api/v1/")) {
    return new Response(JSON.stringify({ error: { code: "not_found", message: "Unbekannter Pfad." } }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }
  const headers = new Headers();
  for (const h of FORWARD_REQUEST) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  const ip = clientIp(request.headers, getClientAddress?.() ?? null);
  headers.set("x-forwarded-for", forwardedFor(ip));
  const signed = signedClientIp(ip);
  if (signed) headers.set(CLIENT_IP_HEADER, signed);
  headers.set("x-forwarded-proto", url.protocol.replace(/:$/, ""));
  headers.set("x-forwarded-host", url.host);

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // Required by undici to stream a request body.
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch {
    return new Response(JSON.stringify({ error: { code: "api_unavailable", message: "API-Server nicht erreichbar." } }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  const out = new Headers();
  upstream.headers.forEach((v, k) => { if (!DROP_RESPONSE.has(k)) out.set(k, v); });
  return new Response(upstream.body, { status: upstream.status, headers: out });
};

export const GET = forward;
export const POST = forward;
export const OPTIONS = forward;

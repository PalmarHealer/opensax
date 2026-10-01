/**
 * Talking to the MCP container from the web app.
 *
 * The REST API and its OpenAPI document are served by the MCP container (it
 * owns the tool handlers). The web app proxies `/api/v1/*` there and reads
 * the tool catalog from it to offer scopes when a user creates a token.
 */
import { env } from "$env/dynamic/private";
import { createHmac } from "node:crypto";

export function mcpInternalUrl(path: string): string {
  const base = (env.LERNSAX_MCP_INTERNAL_URL
    ?? (process.env.NODE_ENV === "production" ? "http://lernsax-mcp:8765" : "http://localhost:8765")).replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Header carrying the client IP we resolved, signed so the MCP can trust it. */
export const CLIENT_IP_HEADER = "x-opensax-client-ip";

/**
 * `<ip> <hmac>` for `CLIENT_IP_HEADER`, keyed with the shared
 * LERNSAX_WEB_SESSION_KEY. The MCP can't tell from X-Forwarded-For alone
 * whether a request came through us or straight from the reverse proxy, so
 * it only takes the IP we vouch for. Null without a key (dev).
 */
export function signedClientIp(ip: string): string | null {
  const key = env.LERNSAX_WEB_SESSION_KEY;
  if (!key || key.length < 32) return null;
  return `${ip} ${createHmac("sha256", key).update(`client-ip:${ip}`).digest("hex")}`;
}

export interface ToolInfo {
  name: string;
  description: string;
  category: string;
  readOnly: boolean;
}

export interface ApiSpec {
  // Only the parts the docs page and the token form read.
  paths: Record<string, Record<string, {
    operationId: string;
    description?: string;
    tags?: string[];
    "x-opensax-scope"?: string;
    "x-opensax-read-only"?: boolean;
    requestBody?: { required?: boolean; content: Record<string, { schema: Record<string, unknown> }> };
  }>>;
  info: { title: string; description?: string };
  tags?: Array<{ name: string }>;
}

let cached: { at: number; spec: ApiSpec } | null = null;
const TTL_MS = 5 * 60_000;

/** The OpenAPI document, cached briefly. Null if the MCP container is unreachable. */
export async function fetchApiSpec(): Promise<ApiSpec | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.spec;
  try {
    const r = await fetch(mcpInternalUrl("/api/v1/openapi.json"), { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const spec = (await r.json()) as ApiSpec;
    cached = { at: Date.now(), spec };
    return spec;
  } catch (err) {
    console.warn("[mcpInternal] could not load the API catalog", err);
    return cached?.spec ?? null;
  }
}

/** Every tool, in the order the MCP server lists them. */
export function toolsFromSpec(spec: ApiSpec): ToolInfo[] {
  const out: ToolInfo[] = [];
  for (const ops of Object.values(spec.paths)) {
    const op = ops.post;
    if (!op?.["x-opensax-scope"]) continue;
    out.push({
      name: op["x-opensax-scope"],
      description: op.description ?? "",
      category: op.tags?.[0] ?? "Sonstiges",
      readOnly: op["x-opensax-read-only"] === true,
    });
  }
  return out;
}

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SessionCache } from "@lernsax/core";
import { buildServer, defaultCache } from "./server.js";
import { authFromHeader } from "./auth.js";

const MCP_PATH = process.env.LERNSAX_MCP_HTTP_PATH ?? "/mcp";
const AUTH_TOKEN = process.env.LERNSAX_MCP_AUTH_TOKEN || null;
// Public origin of the protected-resource metadata document. Falls back to
// WEB_ORIGIN (the SvelteKit app shares the hostname with the MCP path).
const RESOURCE_METADATA_URL =
  process.env.LERNSAX_MCP_RESOURCE_METADATA_URL
  || (process.env.WEB_ORIGIN ? `${process.env.WEB_ORIGIN.replace(/\/$/, "")}/.well-known/oauth-protected-resource` : null);
// Set to "1" to allow unauthenticated calls (e.g. local dev / stdio bridges).
const ALLOW_ANON = process.env.LERNSAX_MCP_ALLOW_ANON === "1";

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function checkLegacyToken(req: IncomingMessage): boolean {
  if (!AUTH_TOKEN) return true;
  const header = req.headers.authorization ?? "";
  if (!header.startsWith("Bearer ")) return false;
  return header.slice(7).trim() === AUTH_TOKEN;
}

function bearerChallenge(error?: string, description?: string): string {
  const parts = ['Bearer realm="lernsax-mcp"'];
  if (RESOURCE_METADATA_URL) parts.push(`resource_metadata="${RESOURCE_METADATA_URL}"`);
  if (error) parts.push(`error="${error}"`);
  if (description) parts.push(`error_description="${description.replace(/"/g, "'")}"`);
  return parts.join(", ");
}

export async function startHttpServer(host: string, port: number): Promise<{ close: () => Promise<void>; cache: SessionCache }> {
  const cache = defaultCache();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.url !== MCP_PATH && !req.url?.startsWith(MCP_PATH + "?")) {
        res.statusCode = 404;
        res.end();
        return;
      }
      if (req.method === "GET" && (req.headers.accept?.includes("text/event-stream") ?? false)) {
        // SSE not supported in stateless mode — clients fall back to POST.
        res.statusCode = 405;
        res.end();
        return;
      }
      if (req.method !== "POST") {
        res.statusCode = 405;
        res.end();
        return;
      }
      if (!checkLegacyToken(req)) {
        res.statusCode = 401;
        res.setHeader("WWW-Authenticate", bearerChallenge("invalid_token", "Bad legacy token"));
        res.end();
        return;
      }

      // Resolve OAuth bearer to LernSax credentials. We require a valid token
      // unless explicitly opted out (LERNSAX_MCP_ALLOW_ANON=1) — without this
      // Claude.ai's connector treats the endpoint as unauthenticated.
      const auth = authFromHeader(req.headers.authorization ?? null);
      if (!auth && !ALLOW_ANON && !AUTH_TOKEN) {
        const hadBearer = !!req.headers.authorization;
        res.statusCode = 401;
        res.setHeader("WWW-Authenticate", bearerChallenge(
          hadBearer ? "invalid_token" : undefined,
          hadBearer ? "Token unknown or expired" : undefined,
        ));
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32001, message: "Unauthorized — connect this MCP via OAuth in your client." },
        }));
        return;
      }
      const { server } = buildServer(cache, auth?.credentials);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await server.connect(transport);

      const body = await readJsonBody(req);
      await transport.handleRequest(req, res, body);

      req.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    } catch (err) {
      console.error("[lernsax-mcp:http]", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: (err as Error).message } }));
      } else {
        res.end();
      }
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  console.error(`[lernsax-mcp] streamable-http listening on http://${host}:${port}${MCP_PATH}${AUTH_TOKEN ? " (auth required)" : ""}`);

  return {
    cache,
    close: () => new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    }),
  };
}

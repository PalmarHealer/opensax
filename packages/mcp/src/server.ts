import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SessionCache, type Credentials } from "@lernsax/core";
import { z } from "zod";
import { TOOLS, mimeForName, type ToolContext, type ToolResult } from "./tools.js";

// Email/password are optional on every tool: when the request arrives with
// an OAuth Bearer (resolved into `defaultCreds` by the HTTP transport), the
// caller doesn't need to repeat them per-call. They're still accepted for
// stdio mode and for one-off overrides.
const CredsShape = {
  email: z.string().email().optional().describe("LernSax email (omit when calling via OAuth bearer)"),
  password: z.string().min(1).optional().describe("LernSax password (omit when calling via OAuth bearer)"),
};

const idleMs = Number.parseInt(process.env.LERNSAX_MCP_IDLE_TTL_MS ?? "300000", 10);

export function defaultCache(): SessionCache {
  return new SessionCache({ idleTtlMs: idleMs });
}

/** Files above this are handed out as a download link instead of inline base64. */
const INLINE_LIMIT = 6 * 1024 * 1024;

/**
 * Build an MCP server exposing the tools in `tools.ts`.
 *
 * `allowedTools` narrows the list to what the caller's token was granted; a
 * tool outside it is not registered at all, so a client never sees what it
 * may not call. Omitted = every tool (stdio, `lernsax` scope).
 */
export function buildServer(
  cache: SessionCache = defaultCache(),
  defaultCreds?: Credentials,
  allowedTools?: ReadonlySet<string>,
) {
  const server = new McpServer({
    name: "lernsax-mcp",
    version: "0.1.0",
  });

  const contextFor = (creds: { email?: string; password?: string }): ToolContext => {
    const resolved: Credentials | undefined = creds.email && creds.password
      ? { email: creds.email, password: creds.password }
      : defaultCreds;
    return {
      email: resolved?.email,
      client: () => {
        if (!resolved) throw new Error("Credentials required — provide email+password or call via an authorized OAuth bearer.");
        return cache.get(resolved);
      },
    };
  };

  const ok = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  // Inline base64 file content as an embedded resource block (plus a text
  // summary so the model has the name/size context).
  const fileResult = (id: string, name: string, size: number, base64: string) => ({
    content: [
      { type: "text" as const, text: JSON.stringify({ name, size }, null, 2) },
      {
        type: "resource" as const,
        resource: { uri: `lernsax://file/${id}`, mimeType: mimeForName(name), blob: base64 },
      },
    ],
  });

  const toMcp = async (r: ToolResult) => {
    if (r.kind === "json") return ok(r.data);
    // Avoid blowing up the response with huge base64 payloads.
    if (Math.max(r.size, r.data.length) > INLINE_LIMIT) {
      return ok({
        name: r.name,
        size: r.size,
        note: "File too large to inline — fetch it via this direct-download URL.",
        url: await r.url(),
      });
    }
    return fileResult(r.id, r.name, r.size, Buffer.from(r.data).toString("base64"));
  };

  for (const t of TOOLS) {
    if (allowedTools && !allowedTools.has(t.name)) continue;
    server.tool(
      t.name,
      t.description,
      { ...CredsShape, ...t.shape },
      async ({ email, password, ...args }: { email?: string; password?: string } & Record<string, unknown>) =>
        toMcp(await t.run(contextFor({ email, password }), args as never)),
    );
  }

  return { server, cache };
}

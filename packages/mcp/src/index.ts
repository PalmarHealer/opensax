#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { startHttpServer } from "./httpServer.js";

const transportMode = (process.env.LERNSAX_MCP_TRANSPORT ?? "stdio").toLowerCase();

async function main() {
  if (transportMode === "http" || transportMode === "streamable-http") {
    const host = process.env.LERNSAX_MCP_HTTP_HOST ?? "0.0.0.0";
    const port = Number.parseInt(process.env.LERNSAX_MCP_HTTP_PORT ?? "8765", 10);
    const { close, cache } = await startHttpServer(host, port);
    const shutdown = async () => {
      await close().catch(() => {});
      await cache.drain().catch(() => {});
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  const { server, cache } = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const shutdown = async () => {
    try { await cache.drain(); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[lernsax-mcp] fatal:", err);
  process.exit(1);
});

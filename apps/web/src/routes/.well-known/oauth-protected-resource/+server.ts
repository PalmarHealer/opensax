import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

/**
 * RFC 9728 protected-resource metadata. The MCP server returns
 *   WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"
 * on unauthenticated requests; clients (Claude.ai) fetch this to learn which
 * authorization server issues tokens for the resource.
 */
export const GET: RequestHandler = async ({ url }) => {
  const issuer = `${url.protocol}//${url.host}`;
  return json({
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: ["lernsax"],
    resource_documentation: `${issuer}/`,
  });
};

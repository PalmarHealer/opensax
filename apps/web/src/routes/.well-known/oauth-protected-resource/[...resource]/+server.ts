import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

/**
 * Catch-all variant of `/.well-known/oauth-protected-resource` so clients can
 * discover the resource metadata at the per-resource path
 *   …/.well-known/oauth-protected-resource/<resource-path>
 * (RFC 9728 §3.1). Claude.ai's connector uses this form for `/mcp`.
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

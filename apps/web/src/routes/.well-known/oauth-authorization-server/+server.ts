import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

/**
 * OAuth 2.1 / RFC 8414 server metadata. Claude.ai's MCP connector reads this
 * to discover our authorize/token endpoints for the connect flow.
 */
export const GET: RequestHandler = async ({ url }) => {
  const issuer = `${url.protocol}//${url.host}`;
  return json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    scopes_supported: ["lernsax"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  });
};

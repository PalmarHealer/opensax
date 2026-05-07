import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { registerClient } from "$lib/server/connectionStore";

/**
 * Dynamic Client Registration (RFC 7591). Claude.ai POSTs here to create
 * itself as a client before kicking off the auth-code flow. Public clients
 * only — we don't issue secrets, PKCE is required at /oauth/authorize.
 */
export const POST: RequestHandler = async ({ request }) => {
  let body: { client_name?: string; redirect_uris?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_request" }, { status: 400 });
  }
  const redirect_uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === "string") : [];
  if (redirect_uris.length === 0) {
    return json({ error: "invalid_redirect_uri" }, { status: 400 });
  }
  const c = registerClient({
    client_name: body.client_name ?? "Unnamed client",
    redirect_uris,
  });
  return json({
    client_id: c.client_id,
    client_id_issued_at: Math.floor(c.created_at / 1000),
    client_name: c.client_name,
    redirect_uris: c.redirect_uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
};

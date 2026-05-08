import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { createHash } from "node:crypto";
import {
  consumeAuthCode,
  createConnection,
  findByRefreshToken,
  findClient,
  mintToken,
  rotateAccessToken,
} from "$lib/server/connectionStore";

function b64urlSha256(s: string): string {
  return createHash("sha256").update(s).digest("base64url");
}

export const POST: RequestHandler = async ({ request }) => {
  const ct = request.headers.get("content-type") ?? "";
  let body: Record<string, string> = {};
  if (ct.includes("application/x-www-form-urlencoded")) {
    const fd = await request.formData();
    for (const [k, v] of fd) body[k] = v.toString();
  } else if (ct.includes("application/json")) {
    body = (await request.json()) as Record<string, string>;
  } else {
    return json({ error: "invalid_request" }, { status: 400 });
  }

  const grant_type = body.grant_type;

  if (grant_type === "authorization_code") {
    const { code, redirect_uri, client_id, code_verifier } = body;
    if (!code || !redirect_uri || !client_id) return json({ error: "invalid_request" }, { status: 400 });
    const auth = consumeAuthCode(code);
    if (!auth) return json({ error: "invalid_grant" }, { status: 400 });
    if (auth.client_id !== client_id || auth.redirect_uri !== redirect_uri) {
      return json({ error: "invalid_grant" }, { status: 400 });
    }
    if (auth.code_challenge) {
      if (!code_verifier) return json({ error: "invalid_grant", error_description: "PKCE verifier required" }, { status: 400 });
      const expected = auth.code_challenge_method === "S256"
        ? b64urlSha256(code_verifier)
        : code_verifier;
      if (expected !== auth.code_challenge) return json({ error: "invalid_grant", error_description: "PKCE mismatch" }, { status: 400 });
    }

    const client = findClient(auth.client_id);
    if (!client) return json({ error: "invalid_client" }, { status: 400 });

    const access_token = mintToken();
    const refresh_token = mintToken();
    createConnection({
      user_id: auth.user_id,
      client_id: auth.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      scopes: auth.scopes,
      access_token,
      refresh_token,
    });

    return json({
      access_token,
      refresh_token,
      token_type: "Bearer",
      expires_in: 0, // long-lived; rotated via refresh
      scope: auth.scopes.join(" "),
    });
  }

  if (grant_type === "refresh_token") {
    const { refresh_token } = body;
    if (!refresh_token) return json({ error: "invalid_request" }, { status: 400 });
    const conn = findByRefreshToken(refresh_token);
    if (!conn) return json({ error: "invalid_grant" }, { status: 400 });
    const access_token = mintToken();
    rotateAccessToken(conn.id, access_token);
    return json({
      access_token,
      token_type: "Bearer",
      expires_in: 0,
      scope: conn.scopes.join(" "),
    });
  }

  return json({ error: "unsupported_grant_type" }, { status: 400 });
};

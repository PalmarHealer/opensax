import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { findByAccessToken } from "$lib/server/connectionStore";

/**
 * OIDC-style userinfo. Answers from the claims snapshot stored with the
 * connection, so it needs no live LernSax session and cannot be turned into
 * a way to reach account data: the token only ever unlocks what the consent
 * screen showed.
 */
const handler: RequestHandler = async ({ request }) => {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  const conn = m ? findByAccessToken(m[1]!) : null;
  if (!conn || !conn.scopes.includes("openid") || !conn.claims) {
    return json({ error: "invalid_token" }, {
      status: 401,
      headers: { "www-authenticate": 'Bearer error="invalid_token"' },
    });
  }
  return json(conn.claims, { headers: { "cache-control": "no-store" } });
};

export const GET = handler;
export const POST = handler;

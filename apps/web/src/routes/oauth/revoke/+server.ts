import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { findByAccessToken, findByRefreshToken, revoke } from "$lib/server/connectionStore";

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, string> = {};
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    const fd = await request.formData();
    for (const [k, v] of fd) body[k] = v.toString();
  } else if (ct.includes("application/json")) {
    body = (await request.json()) as Record<string, string>;
  }
  const tok = body.token;
  if (!tok) return json({ error: "invalid_request" }, { status: 400 });
  const conn = findByAccessToken(tok) ?? findByRefreshToken(tok);
  if (conn) revoke(conn.id);
  return json({});
};

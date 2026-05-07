import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { listForUser, revoke } from "$lib/server/connectionStore";

export const DELETE: RequestHandler = async ({ cookies, params }) => {
  const sid = cookies.get("lernsax_sid");
  if (!sid) return json({ error: "unauthenticated" }, { status: 401 });
  // Make sure the connection belongs to the calling user.
  const own = listForUser(sid).find((c) => c.id === params.id);
  if (!own) return json({ error: "not_found" }, { status: 404 });
  revoke(params.id);
  return json({ ok: true });
};

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { listForUser, revoke } from "$lib/server/connectionStore";
import { getUserIdForSession } from "$lib/server/sessionStore";

export const DELETE: RequestHandler = async ({ cookies, params }) => {
  const sid = cookies.get("lernsax_sid");
  const user_id = getUserIdForSession(sid ?? null);
  if (!user_id) return json({ error: "unauthenticated" }, { status: 401 });
  // Make sure the connection belongs to the calling LernSax account.
  const own = listForUser(user_id).find((c) => c.id === params.id);
  if (!own) return json({ error: "not_found" }, { status: 404 });
  revoke(params.id);
  return json({ ok: true });
};

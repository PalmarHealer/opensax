import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { listForUser } from "$lib/server/connectionStore";
import { getUserIdForSession } from "$lib/server/sessionStore";

export const GET: RequestHandler = async ({ cookies }) => {
  const sid = cookies.get("lernsax_sid");
  const user_id = getUserIdForSession(sid ?? null);
  if (!user_id) return json({ error: "unauthenticated" }, { status: 401 });
  const items = listForUser(user_id).map((c) => ({
    id: c.id,
    client_name: c.client_name,
    scopes: c.scopes,
    created_at: c.created_at,
    last_used_at: c.last_used_at,
  }));
  return json({ connections: items });
};

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { destroySession, destroySessionsForUser, getUserIdForSession } from "$lib/server/sessionStore";
import { clearConfig as clearDavinciConfig } from "$lib/server/davinciStore";

const COOKIE = "lernsax_sid";

/**
 * Wipe everything the server has on file for the calling LernSax account:
 * encrypted credentials of every device session, the timetable login, all
 * OAuth/MCP connections, and the auth cookie of the calling browser. Other
 * devices on the same account also lose access — that's the point of "Alle
 * Daten löschen".
 */
export const POST: RequestHandler = async ({ cookies }) => {
  const sid = cookies.get(COOKIE);
  const user_id = getUserIdForSession(sid ?? null);
  if (user_id) {
    destroySessionsForUser(user_id);
    // Separate store, separate file — the session wipe doesn't reach it, and
    // leaving it behind would keep a second set of credentials (the school's)
    // on disk after the user asked for everything to go.
    clearDavinciConfig(user_id);
  } else if (sid) destroySession(sid);
  cookies.delete(COOKIE, { path: "/" });
  return json({ ok: true, redirect: "/login" });
};

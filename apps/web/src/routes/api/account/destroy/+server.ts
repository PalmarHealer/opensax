import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { destroySession } from "$lib/server/sessionStore";

const COOKIE = "lernsax_sid";

/**
 * Wipe everything the server has on file for the calling user: encrypted
 * credentials, all OAuth connections (which destroySession already revokes),
 * and the auth cookie. Same effect as logout from the user's POV but the
 * intent is recorded and the response signals where to redirect.
 */
export const POST: RequestHandler = async ({ cookies }) => {
  const sid = cookies.get(COOKIE);
  if (sid) destroySession(sid);
  cookies.delete(COOKIE, { path: "/" });
  return json({ ok: true, redirect: "/login" });
};

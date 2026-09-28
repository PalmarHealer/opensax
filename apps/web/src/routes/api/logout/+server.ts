import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { destroySession } from "$lib/server/sessionStore";
import { GROUP_COOKIE } from "$lib/nav";

const COOKIE = "lernsax_sid";

export const POST: RequestHandler = async ({ cookies }) => {
  const sid = cookies.get(COOKIE);
  if (sid) destroySession(sid);
  cookies.delete(COOKIE, { path: "/" });
  // The remembered group names a room of the account that is signing out —
  // it has no meaning for whoever logs in on this browser next.
  cookies.delete(GROUP_COOKIE, { path: "/" });
  return json({ ok: true });
};

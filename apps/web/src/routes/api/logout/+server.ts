import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { destroySession } from "$lib/server/sessionStore";

const COOKIE = "lernsax_sid";

export const POST: RequestHandler = async ({ cookies }) => {
  const sid = cookies.get(COOKIE);
  if (sid) destroySession(sid);
  cookies.delete(COOKIE, { path: "/" });
  return json({ ok: true });
};

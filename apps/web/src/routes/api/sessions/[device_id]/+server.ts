import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getUserIdForSession, revokeDeviceForUser } from "$lib/server/sessionStore";

const COOKIE = "lernsax_sid";

/**
 * Revoke another device's session for the calling LernSax account. The
 * `device_id` is a hash of the target session's cookie value — the real
 * cookie never leaves the server, so a malicious caller can't pivot it
 * into impersonation.
 */
export const DELETE: RequestHandler = async ({ cookies, params }) => {
  const sid = cookies.get(COOKIE);
  const user_id = getUserIdForSession(sid ?? null);
  if (!user_id) return json({ error: "unauthenticated" }, { status: 401 });
  const device_id = params.device_id;
  if (!device_id) return json({ error: "device_id required" }, { status: 400 });
  const ok = revokeDeviceForUser(user_id, device_id);
  if (!ok) return json({ error: "not_found" }, { status: 404 });
  return json({ ok: true });
};

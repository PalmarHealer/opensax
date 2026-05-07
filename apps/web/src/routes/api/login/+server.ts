import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { LernSaxClient } from "@lernsax/core";
import { createSession, getClientForSession } from "$lib/server/sessionStore";

const COOKIE = "lernsax_sid";

export const POST: RequestHandler = async ({ request, cookies }) => {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { email, password } = body;
  if (!email || !password) {
    return json({ error: "email and password required" }, { status: 400 });
  }

  // Verify credentials by attempting login once.
  const probe = new LernSaxClient({ email, password });
  try {
    await probe.login();
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 401 });
  } finally {
    probe.logout().catch(() => {});
  }

  const sid = createSession({ email, password });
  cookies.set(COOKIE, sid, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  // Eagerly warm a long-lived client for this session
  await getClientForSession(sid);

  return json({ ok: true });
};

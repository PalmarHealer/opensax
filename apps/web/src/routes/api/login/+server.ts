import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { LernSaxClient } from "@lernsax/core";
import { createSession, getClientForSession } from "$lib/server/sessionStore";
import { clientIp } from "$lib/server/rateLimit";

const COOKIE = "lernsax_sid";

export const POST: RequestHandler = async ({ request, cookies, url, getClientAddress }) => {
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

  const ip = clientIp(request.headers, getClientAddress?.() ?? null);
  const userAgent = request.headers.get("user-agent") ?? undefined;
  const sid = createSession({ email, password }, { firstIp: ip, userAgent });
  // Detect HTTPS via either the request URL or the proxy's X-Forwarded-Proto
  // — NODE_ENV alone gives wrong answers behind TLS-terminating proxies.
  const isSecure =
    url.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https" ||
    process.env.NODE_ENV === "production";
  cookies.set(COOKIE, sid, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    maxAge: 60 * 60 * 24 * 365, // 1 year
  });

  // Eagerly warm a long-lived client for this session
  await getClientForSession(sid);

  return json({ ok: true });
};

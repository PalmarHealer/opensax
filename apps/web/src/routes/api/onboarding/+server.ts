import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getUserIdForSession } from "$lib/server/sessionStore";
import { markOnboarding, type OnboardingOutcome } from "$lib/server/onboardingStore";

const COOKIE = "lernsax_sid";

/** Onboarding abgeschlossen oder übersprungen — danach zeigt es sich für den Account nicht mehr. */
export const POST: RequestHandler = async ({ cookies, request }) => {
  const user_id = getUserIdForSession(cookies.get(COOKIE) ?? null);
  if (!user_id) return json({ error: "no session" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { outcome?: string };
  const outcome: OnboardingOutcome = body.outcome === "skipped" ? "skipped" : "completed";
  return json({ ok: true, ...markOnboarding(user_id, outcome) });
};

import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getCredentialsForSession, getUserIdForSession, listSessionsForUser } from "$lib/server/sessionStore";
import { listForUser } from "$lib/server/connectionStore";
import { loadConfig as loadDavinciConfig } from "$lib/server/davinciStore";
import { getOnboarding } from "$lib/server/onboardingStore";

const COOKIE = "lernsax_sid";

/**
 * Full data dump for the calling user. Connection records (OAuth and API
 * tokens alike) expose only the hash of any tokens (the bare tokens are never
 * persisted).
 *
 * Passwords are left out unless asked for — `?passwords=lernsax`,
 * `?passwords=davinci` or both, comma-separated. Settings asks first and warns:
 * an export is a file people forward, and a forwarded file with a plain-text
 * password in it is a leaked account.
 */
export const GET: RequestHandler = async ({ cookies, url }) => {
  const wanted = new Set((url.searchParams.get("passwords") ?? "").split(",").map((s) => s.trim()));
  const OMITTED = "(nicht exportiert — beim Export abgewählt)";
  const sid = cookies.get(COOKIE);
  if (!sid) throw error(401, "no session");
  const creds = getCredentialsForSession(sid);
  if (!creds) throw error(404, "session not found");
  const user_id = getUserIdForSession(sid);

  const connections = user_id ? listForUser(user_id) : [];
  const sessionsList = user_id ? listSessionsForUser(user_id, sid) : [];
  // Second set of credentials on file, for the school's timetable server. It
  // is stored the same way and belongs in an export that calls itself complete.
  const davinci = user_id ? loadDavinciConfig(user_id) : null;
  const dump = {
    exported_at: new Date().toISOString(),
    note: "Vollständiger Export aller Daten, die OpenSax zu deinem Account speichert. Die Anmeldedaten lagen verschlüsselt (AES-256-GCM) auf dem Server; Passwörter stehen nur drin, wenn du sie beim Export ausdrücklich ausgewählt hast — dann diese Datei bitte niemandem weitergeben.",
    passwords_included: { lernsax: wanted.has("lernsax"), davinci: !!davinci && wanted.has("davinci") },
    user_id: user_id ?? null,
    credentials: { email: creds.email, password: wanted.has("lernsax") ? creds.password : OMITTED },
    davinci: davinci
      ? {
          endpoint: davinci.endpoint,
          resolved_endpoint: davinci.resolvedEndpoint ?? null,
          source_type: davinci.sourceType ?? null,
          username: davinci.username,
          password: wanted.has("davinci") ? davinci.password : OMITTED,
          class_code: davinci.classCode ?? null,
          teacher_code: davinci.teacherCode ?? null,
          include_supervisions: davinci.includeSupervisions ?? false,
        }
      : null,
    onboarding: user_id ? getOnboarding(user_id) : null,
    sessions: sessionsList.map((s) => ({
      device_id: s.device_id,
      current: s.isCurrent,
      created_at: s.createdAt,
      last_seen: s.lastSeen,
      first_ip: s.firstIp ?? null,
      last_ip: s.lastIp ?? null,
      user_agent: s.userAgent ?? null,
    })),
    connections: connections.map((c) => ({
      id: c.id,
      kind: c.kind ?? "oauth",
      client_name: c.client_name,
      client_id: c.client_id,
      redirect_uris: c.redirect_uris,
      scopes: c.scopes,
      created_at: c.created_at,
      last_used_at: c.last_used_at,
      expires_at: c.expires_at,
      access_token_sha256: c.token_hash,
      refresh_token_sha256: c.refresh_hash ?? null,
      // What `/oauth/userinfo` hands the app — only for `openid` grants.
      identity_snapshot: c.claims ?? null,
    })),
  };

  return new Response(JSON.stringify(dump, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="opensax-account-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
};

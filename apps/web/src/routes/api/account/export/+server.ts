import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getCredentialsForSession, getUserIdForSession, listSessionsForUser } from "$lib/server/sessionStore";
import { listForUser } from "$lib/server/connectionStore";
import { loadConfig as loadDavinciConfig } from "$lib/server/davinciStore";

const COOKIE = "lernsax_sid";

/**
 * Full data dump for the calling user — credentials are decrypted on the
 * fly so the user can take them with them. Connection records expose only
 * the hash of any access tokens (the bare tokens are never persisted).
 */
export const GET: RequestHandler = async ({ cookies }) => {
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
    note: "Vollständiger Export aller Daten, die OpenSax zu deinem Account speichert. Die Anmeldedaten unten lagen verschlüsselt (AES-256-GCM) auf dem Server und wurden nur für diesen Export entschlüsselt.",
    user_id: user_id ?? null,
    credentials: { email: creds.email, password: creds.password },
    davinci: davinci
      ? {
          endpoint: davinci.endpoint,
          resolved_endpoint: davinci.resolvedEndpoint ?? null,
          source_type: davinci.sourceType ?? null,
          username: davinci.username,
          password: davinci.password,
          class_code: davinci.classCode ?? null,
          teacher_code: davinci.teacherCode ?? null,
          include_supervisions: davinci.includeSupervisions ?? false,
        }
      : null,
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
      client_name: c.client_name,
      client_id: c.client_id,
      redirect_uris: c.redirect_uris,
      scopes: c.scopes,
      created_at: c.created_at,
      last_used_at: c.last_used_at,
      expires_at: c.expires_at,
      access_token_sha256: c.token_hash,
      refresh_token_sha256: c.refresh_hash ?? null,
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

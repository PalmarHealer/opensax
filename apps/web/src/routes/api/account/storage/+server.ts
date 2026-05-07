import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { listForUser } from "$lib/server/connectionStore";

const COOKIE = "lernsax_sid";

/**
 * Inventory of what the server has on file for the calling user.
 * No credentials are returned here — see /api/account/export for those.
 */
export const GET: RequestHandler = async ({ cookies }) => {
  const sid = cookies.get(COOKIE);
  const connections = sid ? listForUser(sid).map((c) => ({
    id: c.id,
    client_name: c.client_name,
    scopes: c.scopes,
    created_at: c.created_at,
    last_used_at: c.last_used_at,
  })) : [];

  return json({
    session: {
      // The cookie itself confirms a session exists; we don't echo the sid.
      present: !!sid,
      ttl_days: 30,
      cookie: { name: COOKIE, http_only: true, secure: true, same_site: "Lax" },
      stored: ["AES-256-GCM-encrypted LernSax credentials", "createdAt", "lastSeen"],
    },
    connections: {
      count: connections.length,
      ttl_days: null,
      stored: ["SHA-256 token hash (the bare token is never persisted)", "client name", "scopes", "timestamps"],
      records: connections,
    },
    cache: {
      contacts: { ttl_seconds: 60, scope: "in-memory, per-user", stored: ["login", "display name", "online flag", "groups"] },
      lernsax_session: { ttl_minutes: "≈30 (LernSax-side)", scope: "in-memory client object", stored: ["LernSax session id"] },
    },
    not_stored: [
      "Mail bodies, attachments, files, calendar entries, tasks (always fetched live from LernSax on demand)",
      "Browser preferences (theme, nav layout) — those live in localStorage in your browser, not on the server",
    ],
  });
};

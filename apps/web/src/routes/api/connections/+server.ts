import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { createApiToken, listForUser } from "$lib/server/connectionStore";
import { getUserIdForSession } from "$lib/server/sessionStore";
import { fetchApiSpec, toolsFromSpec } from "$lib/server/mcpInternal";

const MAX_TOKENS = 50;

export const GET: RequestHandler = async ({ cookies }) => {
  const sid = cookies.get("lernsax_sid");
  const user_id = getUserIdForSession(sid ?? null);
  if (!user_id) return json({ error: "unauthenticated" }, { status: 401 });
  const items = listForUser(user_id)
    .sort((a, b) => b.created_at - a.created_at)
    .map((c) => ({
      id: c.id,
      kind: c.kind ?? "oauth",
      client_name: c.client_name,
      scopes: c.scopes,
      created_at: c.created_at,
      last_used_at: c.last_used_at,
      expires_at: c.expires_at,
    }));
  return json({ connections: items });
};

/**
 * Create an API token: `{ name, scopes: string[], expires_at: number }` where
 * `scopes` are tool names and `expires_at` is unix ms (0 = never). The bare
 * token is in the response and nowhere else.
 */
export const POST: RequestHandler = async ({ cookies, request }) => {
  const sid = cookies.get("lernsax_sid");
  const user_id = getUserIdForSession(sid ?? null);
  if (!user_id) return json({ error: "unauthenticated" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { name?: unknown; scopes?: unknown; expires_at?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 80) return json({ error: "Name fehlt oder ist länger als 80 Zeichen." }, { status: 400 });

  const expires_at = typeof body?.expires_at === "number" && Number.isFinite(body.expires_at) ? Math.floor(body.expires_at) : NaN;
  if (Number.isNaN(expires_at) || (expires_at !== 0 && expires_at <= Date.now())) {
    return json({ error: "Ablaufdatum muss in der Zukunft liegen (oder „nie“)." }, { status: 400 });
  }

  const spec = await fetchApiSpec();
  if (!spec) return json({ error: "API-Server nicht erreichbar — bitte später erneut versuchen." }, { status: 503 });
  const known = new Set(toolsFromSpec(spec).map((t) => t.name));
  const scopes = Array.isArray(body?.scopes) ? [...new Set(body.scopes.filter((s): s is string => typeof s === "string"))] : [];
  if (!scopes.length) return json({ error: "Mindestens eine Berechtigung auswählen." }, { status: 400 });
  const unknown = scopes.filter((s) => !known.has(s));
  if (unknown.length) return json({ error: `Unbekannte Berechtigung: ${unknown.join(", ")}` }, { status: 400 });

  if (listForUser(user_id).filter((c) => c.kind === "token").length >= MAX_TOKENS) {
    return json({ error: `Höchstens ${MAX_TOKENS} Tokens pro Account — lösche erst ein altes.` }, { status: 400 });
  }

  const { record, token } = createApiToken({ user_id, name, scopes, expires_at });
  return json({
    token,
    connection: {
      id: record.id,
      kind: "token",
      client_name: record.client_name,
      scopes: record.scopes,
      created_at: record.created_at,
      last_used_at: record.last_used_at,
      expires_at: record.expires_at,
    },
  }, { headers: { "cache-control": "no-store" } });
};

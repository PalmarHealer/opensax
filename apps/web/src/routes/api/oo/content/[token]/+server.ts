import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { ooVerifyToken } from "$lib/server/oo";
import { getClientForSession } from "$lib/server/sessionStore";
import { lernsaxFetch } from "$lib/server/lernsaxFetch";

/**
 * Content endpoint that the OnlyOffice DocumentServer hits to fetch the
 * document binary. Auth is via signed token; the underlying LernSax session
 * is identified by the `sid` claim.
 */
export const GET: RequestHandler = async ({ params }) => {
  const claims = ooVerifyToken(params.token);
  if (!claims || claims.sub !== "content") throw error(401, "invalid token");

  const client = await getClientForSession(claims.sid);
  if (!client) throw error(401, "session gone");

  const url = await client.files.downloadUrl(claims.group, claims.file_id);
  if (!url) throw error(404, "no download url");

  const upstream = await lernsaxFetch(url);
  if (!upstream.ok) throw error(upstream.status, "upstream fetch failed");

  // Pass through with a sane content-type / disposition.
  const out = new Headers();
  for (const k of ["content-type", "content-length", "last-modified", "etag"]) {
    const v = upstream.headers.get(k);
    if (v) out.set(k, v);
  }
  out.set("content-disposition", `inline; filename="${encodeURIComponent(claims.name)}"`);
  out.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: out });
};

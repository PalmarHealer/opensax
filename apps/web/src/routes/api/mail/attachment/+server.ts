import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { lernsaxFetch } from "$lib/server/lernsaxFetch";

export const GET: RequestHandler = async ({ locals, url }) => {
  const c = locals.client!;
  const folder_id = url.searchParams.get("folder_id");
  const message_id = url.searchParams.get("message_id");
  const file_id = url.searchParams.get("file_id");
  const wantDownload = url.searchParams.get("download") !== "0"; // default: download
  if (!folder_id || !message_id || !file_id) throw error(400, "folder_id+message_id+file_id required");

  const info = await c.mail.getAttachmentSessionFile({ folder_id, message_id, file_id }).catch(() => null);
  if (!info?.download_url) throw error(404, "no download URL");

  // LernSax occasionally returns download URLs with literal `%` in the path
  // (unencoded filenames), which trips SvelteKit's fetch wrapper
  // (decodeURIComponent → URIError). Normalize stray `%` → `%25` and bypass
  // the wrapper.
  //
  // Goes through `lernsaxFetch`, not the global one: the URL carries a
  // session-scoped token, so it has to leave through the same egress that
  // minted the session (these URLs live on `d.lernsax.de`).
  const safeUrl = new URL(info.download_url.replace(/%(?![0-9A-Fa-f]{2})/g, "%25")).toString();
  const upstream = await lernsaxFetch(safeUrl);
  if (!upstream.ok) throw error(upstream.status, "upstream failed");

  const out = new Headers();
  for (const k of ["content-type", "content-length", "last-modified", "etag"]) {
    const v = upstream.headers.get(k);
    if (v) out.set(k, v);
  }
  const name = info.name || file_id;
  out.set(
    "content-disposition",
    `${wantDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(name)}"`,
  );
  out.set("x-frame-options", "SAMEORIGIN");
  out.delete("content-security-policy");

  return new Response(upstream.body, { status: upstream.status, headers: out });
};

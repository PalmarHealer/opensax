import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ locals, url, fetch }) => {
  const c = locals.client!;
  const folder_id = url.searchParams.get("folder_id");
  const message_id = url.searchParams.get("message_id");
  const file_id = url.searchParams.get("file_id");
  const wantDownload = url.searchParams.get("download") !== "0"; // default: download
  if (!folder_id || !message_id || !file_id) throw error(400, "folder_id+message_id+file_id required");

  const info = await c.mail.getAttachmentSessionFile({ folder_id, message_id, file_id }).catch(() => null);
  if (!info?.download_url) throw error(404, "no download URL");

  const upstream = await fetch(info.download_url);
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

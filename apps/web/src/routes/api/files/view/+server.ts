import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

/**
 * Proxy a LernSax file through the SvelteKit server. We strip X-Frame-Options
 * and CSP from the response so the file can be embedded in our iframe; we also
 * force `Content-Disposition: inline` so PDFs/images render inside the iframe
 * rather than triggering a download.
 *
 * Use `?download=1` to force a "save-as" download (Content-Disposition: attachment).
 */
export const GET: RequestHandler = async ({ locals, url, fetch, request }) => {
  const c = locals.client!;
  const id = url.searchParams.get("id");
  const group = url.searchParams.get("group") || undefined;
  const wantDownload = url.searchParams.get("download") === "1";
  if (!id) throw error(400, "id required");

  const downloadUrl = await c.files.downloadUrl(group, id).catch(() => null);
  if (!downloadUrl) throw error(404, "no download URL");

  // Forward Range requests (so PDF.js can stream).
  const headers: Record<string, string> = {};
  const range = request.headers.get("range");
  if (range) headers.range = range;

  const upstream = await fetch(downloadUrl, { headers });

  if (!upstream.ok && upstream.status !== 206) {
    throw error(upstream.status, `upstream ${upstream.status}`);
  }

  // Filename for Content-Disposition header
  const cdMatch = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(upstream.headers.get("content-disposition") ?? "");
  const inferredName = cdMatch?.[1] ?? id.split("/").pop() ?? "file";
  const disposition = wantDownload
    ? `attachment; filename="${encodeURIComponent(inferredName)}"`
    : `inline; filename="${encodeURIComponent(inferredName)}"`;

  const out = new Headers();
  for (const k of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
    const v = upstream.headers.get(k);
    if (v) out.set(k, v);
  }
  out.set("content-disposition", disposition);
  // Allow same-origin embedding & strip any inherited frame guards.
  out.set("x-frame-options", "SAMEORIGIN");
  out.delete("content-security-policy");
  out.set("cache-control", "private, max-age=60");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: out,
  });
};

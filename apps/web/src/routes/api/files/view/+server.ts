import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { lernsaxFetch } from "$lib/server/lernsaxFetch";

/**
 * Proxy a LernSax file through the SvelteKit server. We strip X-Frame-Options
 * and CSP from the response so the file can be embedded in our iframe; we also
 * force `Content-Disposition: inline` so PDFs/images render inside the iframe
 * rather than triggering a download.
 *
 * Use `?download=1` to force a "save-as" download (Content-Disposition: attachment).
 */
export const GET: RequestHandler = async ({ locals, url, request }) => {
  const c = locals.client!;
  const id = url.searchParams.get("id");
  const group = url.searchParams.get("group") || undefined;
  const wantDownload = url.searchParams.get("download") === "1";
  if (!id) throw error(400, "id required");

  const downloadUrl = await c.files.downloadUrl(group, id).catch(() => null);
  if (!downloadUrl) throw error(404, "no download URL");

  // LernSax sometimes returns URLs with unencoded `%` in filenames, which
  // breaks SvelteKit's fetch wrapper (decodeURIComponent throws). Re-normalize
  // the path through encodeURI and bypass the wrapper — this is an external
  // request, the wrapper offers no benefit here.
  const safeUrl = normalizeUrl(downloadUrl);

  // Forward Range requests (so PDF.js can stream).
  const headers: Record<string, string> = {};
  const range = request.headers.get("range");
  if (range) headers.range = range;

  const upstream = await lernsaxFetch(safeUrl, { headers });

  if (!upstream.ok && upstream.status !== 206) {
    throw error(upstream.status, `upstream ${upstream.status}`);
  }

  // Filename for Content-Disposition header
  const cdMatch = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(upstream.headers.get("content-disposition") ?? "");
  const inferredName = cdMatch?.[1] ?? id.split("/").pop() ?? "file";

  // Anything user-controllable that the browser would *execute* in our origin
  // (HTML, SVG with scripts, XML) is forced to download — otherwise a peer
  // could upload .html into a shared LernSax folder and run script in our
  // origin via this proxy. PDFs and images stay inline.
  const upstreamCt = (upstream.headers.get("content-type") ?? "").toLowerCase();
  const isActiveType =
    upstreamCt.includes("text/html") ||
    upstreamCt.includes("application/xhtml") ||
    upstreamCt.includes("image/svg") ||
    upstreamCt.includes("text/xml") ||
    upstreamCt.includes("application/xml");
  const forcedAttachment = wantDownload || isActiveType;
  const disposition = forcedAttachment
    ? `attachment; filename="${encodeURIComponent(inferredName)}"`
    : `inline; filename="${encodeURIComponent(inferredName)}"`;

  const out = new Headers();
  for (const k of ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"]) {
    const v = upstream.headers.get(k);
    if (v) out.set(k, v);
  }
  out.set("content-disposition", disposition);
  // Allow same-origin embedding & lock active content into a sandbox so an
  // HTML/SVG file that slips past the attachment filter can't take over.
  out.set("x-frame-options", "SAMEORIGIN");
  out.set("content-security-policy", "default-src 'none'; sandbox; base-uri 'none'; frame-ancestors 'self'");
  out.set("x-content-type-options", "nosniff");
  out.set("cache-control", "private, max-age=60");

  return new Response(upstream.body, {
    status: upstream.status,
    headers: out,
  });
};

function normalizeUrl(raw: string): string {
  // Escape any `%` that isn't followed by two hex digits — LernSax occasionally
  // returns filenames with literal `%` inside the URL path, which is a syntactic
  // percent-encoding error and trips downstream decoders.
  const fixed = raw.replace(/%(?![0-9A-Fa-f]{2})/g, "%25");
  return new URL(fixed).toString();
}

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { ooVerifyToken } from "$lib/server/oo";
import { getClientForSession } from "$lib/server/sessionStore";
import { buildFileBreadcrumb } from "@lernsax/core";

/**
 * OnlyOffice DocumentServer callback. Status codes (per OO docs):
 *   0 — document not found
 *   1 — being edited
 *   2 — ready to save (force or final)
 *   3 — saving error
 *   4 — closed without changes
 *   6 — being edited but state saved (autosave checkpoint)
 *   7 — error while force saving
 *
 * On 2 and 6 we download the new document from `data.url` and PUT it into
 * LernSax via WebDAV — JSON-RPC `set_file` doesn't accept content payloads.
 */
export const POST: RequestHandler = async ({ params, request, fetch }) => {
  const claims = ooVerifyToken(params.token);
  if (!claims || claims.sub !== "callback") {
    return json({ error: 1, message: "invalid token" }, { status: 401 });
  }

  let body: { status?: number; url?: string; key?: string; users?: string[]; userdata?: string } = {};
  try { body = await request.json(); } catch { /* allow empty body */ }
  const status = body.status ?? 0;

  if (status !== 2 && status !== 6) return json({ error: 0 });
  if (!body.url) return json({ error: 0 });

  // The DocumentServer hands us back URLs that point to itself as it sees
  // itself. Inside our docker network we need the service name. We accept
  // *only* URLs whose host is OO's own hostname (or localhost, which we
  // rewrite to it) — the URL is attacker-controllable from inside the OO
  // container, so without this check it's an SSRF primitive.
  const ooHost = (process.env.OO_INTERNAL_HOST ?? "lernsax-onlyoffice").replace(/^https?:\/\//, "");
  let parsed: URL;
  try { parsed = new URL(body.url); } catch { return json({ error: 1, message: "bad url" }, { status: 400 }); }
  const host = parsed.hostname.toLowerCase();
  const allowed = host === ooHost.split(":")[0]?.toLowerCase() || host === "localhost" || host === "127.0.0.1";
  if (!allowed) return json({ error: 1, message: "untrusted url host" }, { status: 400 });
  const fetchUrl = body.url.replace(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i, `http://${ooHost}`);

  try {
    const client = await getClientForSession(claims.sid);
    if (!client) return json({ error: 1, message: "session gone" }, { status: 401 });

    // Fetch the new document binary from OnlyOffice.
    const dlResp = await fetch(fetchUrl);
    if (!dlResp.ok) return json({ error: 1, message: `download failed: ${dlResp.status}` }, { status: 502 });
    const buf = new Uint8Array(await dlResp.arrayBuffer());

    // Resolve the file's name path so we can address it via WebDAV.
    const entries = await client.files.list({ group: claims.group });
    const target = entries.find((e) => e.id === claims.file_id);
    if (!target) return json({ error: 1, message: "file vanished" }, { status: 404 });
    const breadcrumb = buildFileBreadcrumb(entries, claims.file_id);
    const segments = breadcrumb
      .filter((e) => e.id !== "/")
      .map((e) => e.name);
    if (segments.some((s) => s.includes("/") || s.includes("\\") || s === "." || s === "..")) {
      return json({ error: 1, message: "unsafe path segment" }, { status: 400 });
    }
    const encodedSegments = segments.map((s) => encodeURIComponent(s));
    const userOrGroup = claims.group ?? (client.whoami()?.login ?? "");
    if (!userOrGroup) return json({ error: 1, message: "no scope login" }, { status: 500 });
    const webdavPath = `/${encodeURIComponent(userOrGroup)}/storage/${encodedSegments.join("/")}`;

    await client.webdav.upload(webdavPath, buf, target.mime ?? "application/octet-stream");
    // The new file content makes our cached `entries` stale (size + modified
    // changed, possibly a new version row appeared). Drop the cache so the
    // next /files navigation re-fetches.
    client.files.invalidate(claims.group);
  } catch (e) {
    console.error("[oo-callback] save failed:", e);
    return json({ error: 1, message: (e as Error).message }, { status: 500 });
  }

  return json({ error: 0 });
};

import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";
import {
  ooApiJsUrl,
  ooDocumentType,
  ooFileType,
  ooInternalUrl,
  ooMintToken,
  ooSecret,
} from "$lib/server/oo";
import { signJwt } from "$lib/server/jwt";

export const load: PageServerLoad = async ({ locals, url, cookies }) => {
  const c = locals.client!;
  const id = url.searchParams.get("id");
  const group = url.searchParams.get("group") || undefined;
  const mode = (url.searchParams.get("mode") === "view" ? "view" : "edit") as "edit" | "view";
  if (!id) throw error(400, "id required");

  const sid = cookies.get("lernsax_sid");
  if (!sid) throw error(401, "no session cookie");
  const theme = cookies.get("lernsax_theme") === "light" ? "light" : "dark";

  // Look up file metadata so we know the filename + revision key.
  const entries = await c.files.list({ group });
  const file = entries.find((e) => e.id === id && e.type === "file");
  if (!file) throw error(404, "file not found");

  const user = c.whoami();
  const userId = user?.login ?? "anon";
  const userName = user?.fullname ?? user?.email ?? userId;

  const contentToken = ooMintToken({ sub: "content", sid, file_id: id, group, name: file.name });
  const callbackToken = ooMintToken({ sub: "callback", sid, file_id: id, group, name: file.name }, 24 * 3600);

  // Unique per editor session — using a stable key tied to last-modified makes
  // OO refuse the doc forever once a save has been marked "forgotten" in its
  // shard. Including Date.now() forces a fresh session and avoids that trap.
  const docKey = `${id.replace(/[^a-zA-Z0-9]/g, "_")}_${file.modified?.date ?? "u"}_${Date.now().toString(36)}`;

  const editorConfig = {
    document: {
      fileType: ooFileType(file.name),
      key: docKey,
      title: file.name,
      url: ooInternalUrl(`/api/oo/content/${contentToken}`),
      permissions: {
        edit: mode === "edit" && Boolean(file.effective?.modify),
        download: true,
        print: true,
        comment: true,
      },
    },
    documentType: ooDocumentType(file.name),
    type: "desktop",
    editorConfig: {
      callbackUrl: ooInternalUrl(`/api/oo/callback/${callbackToken}`),
      lang: "de",
      mode: mode === "view" ? "view" : "edit",
      user: { id: userId, name: userName },
      customization: {
        autosave: true,
        forcesave: false,
        compactHeader: true,
        toolbarNoTabs: false,
        chat: false,
        feedback: { visible: false },
        about: false,
        // Match the editor chrome to our app theme. OnlyOffice 8 ships with
        // both light + dark variants and a vibrant "default" dark; pick the
        // matching one.
        uiTheme: theme === "dark" ? "theme-dark" : "theme-light",
      },
    },
  };

  // OnlyOffice expects a JWT with the entire config payload (when JWT_ENABLED).
  const ooConfigToken = signJwt(editorConfig as unknown as Record<string, unknown>, ooSecret(), 6 * 3600);

  return {
    file: { id: file.id, name: file.name, parent_id: file.parent_id },
    group: group ?? null,
    apiJsUrl: ooApiJsUrl(),
    editorConfig: { ...editorConfig, token: ooConfigToken },
    mode,
  };
};

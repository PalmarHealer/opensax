import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals, url, route, params, depends }) => {
  depends("mail:list");
  const c = locals.client!;
  const folders = await c.mail.getFolders();
  const inbox = folders.find((f) => f.is_inbox) ?? folders[0];
  // Prefer the URL `?folder=` query (list view), then the route param (detail view),
  // then fall back to inbox.
  const folderId =
    url.searchParams.get("folder") ??
    (route.id?.includes("[folderId]") ? params.folderId : null) ??
    inbox?.id ??
    "";
  const messages = folderId
    ? await c.mail.getMessages({ folder_id: folderId, limit: 50 })
    : [];
  return { folders, folderId, messages };
};

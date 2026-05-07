import { fail } from "@sveltejs/kit";
import type { Actions } from "./$types";

export const actions: Actions = {
  bulkDelete: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const folder_id = data.get("folder_id")?.toString();
    const ids = data.getAll("ids").map((s) => s.toString()).filter(Boolean);
    if (!folder_id || ids.length === 0) return fail(400, { error: "folder_id+ids required" });
    try {
      await Promise.all(ids.map((id) => c.mail.deleteMessage(folder_id, id)));
    } catch (e) { return fail(500, { error: (e as Error).message }); }
    return { ok: true, deleted: ids.length };
  },
  bulkMove: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const folder_id = data.get("folder_id")?.toString();
    const target_folder_id = data.get("target_folder_id")?.toString();
    const ids = data.getAll("ids").map((s) => s.toString()).filter(Boolean);
    if (!folder_id || !target_folder_id || ids.length === 0)
      return fail(400, { error: "folder_id+target_folder_id+ids required" });
    try {
      await Promise.all(ids.map((id) => c.mail.moveMessage(folder_id, id, target_folder_id)));
    } catch (e) { return fail(500, { error: (e as Error).message }); }
    return { ok: true, moved: ids.length };
  },
  flagMany: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const folder_id = data.get("folder_id")?.toString();
    const ids = data.getAll("ids").map((s) => s.toString()).filter(Boolean);
    const isUnread = data.get("is_unread")?.toString();
    if (!folder_id || ids.length === 0) return fail(400, { error: "folder_id+ids required" });
    try {
      await Promise.all(
        ids.map((id) => c.mail.setMessage({
          folder_id,
          message_id: id,
          ...(isUnread === "true" ? { is_unread: true } : isUnread === "false" ? { is_unread: false } : {}),
        })),
      );
    } catch (e) { return fail(500, { error: (e as Error).message }); }
    return { ok: true };
  },
  addFolder: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const name = data.get("name")?.toString().trim();
    const expiresDays = Number.parseInt(data.get("expires_days")?.toString() ?? "0", 10);
    if (!name) return fail(400, { error: "name required" });
    try {
      await c.mail.addFolder({ name, expires: expiresDays > 0 ? expiresDays : undefined });
    } catch (e) { return fail(500, { error: (e as Error).message }); }
    return { ok: true };
  },
  renameFolder: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const folder_id = data.get("folder_id")?.toString();
    const name = data.get("name")?.toString().trim();
    const expiresDays = Number.parseInt(data.get("expires_days")?.toString() ?? "0", 10);
    if (!folder_id || !name) return fail(400, { error: "folder_id+name required" });
    try {
      await c.mail.setFolder(folder_id, { name, expires: expiresDays > 0 ? expiresDays : undefined });
    } catch (e) { return fail(500, { error: (e as Error).message }); }
    return { ok: true };
  },
  deleteFolder: async ({ locals, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const folder_id = data.get("folder_id")?.toString();
    if (!folder_id) return fail(400, { error: "folder_id required" });
    try { await c.mail.deleteFolder(folder_id); }
    catch (e) { return fail(500, { error: (e as Error).message }); }
    return { ok: true };
  },
};

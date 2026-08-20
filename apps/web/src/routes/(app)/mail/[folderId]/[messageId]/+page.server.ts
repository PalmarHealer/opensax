import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, params }) => {
  const c = locals.client!;
  const message = await c.mail.readMessage(params.folderId, params.messageId);
  return { message, folderId: params.folderId };
};

export const actions: Actions = {
  delete: async ({ locals, params }) => {
    const c = locals.client!;
    try {
      await c.mail.deleteMessage(params.folderId, params.messageId);
    } catch (e) { return fail(500, { error: (e as Error).message }); }
    throw redirect(303, `/mail?folder=${encodeURIComponent(params.folderId)}`);
  },
  flag: async ({ locals, params, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const patch: { folder_id: string; message_id: string; is_unread?: boolean; is_flagged?: boolean } = {
      folder_id: params.folderId,
      message_id: params.messageId,
    };
    const u = data.get("is_unread")?.toString();
    const f = data.get("is_flagged")?.toString();
    if (u === "true" || u === "false") patch.is_unread = u === "true";
    if (f === "true" || f === "false") patch.is_flagged = f === "true";
    try {
      await c.mail.setMessage(patch);
    } catch (e) { return fail(500, { error: (e as Error).message }); }
    if (patch.is_unread === true) {
      throw redirect(303, `/mail?folder=${encodeURIComponent(params.folderId)}`);
    }
    return { ok: true, ...patch };
  },
  move: async ({ locals, params, request }) => {
    const c = locals.client!;
    const data = await request.formData();
    const target = data.get("target_folder_id")?.toString();
    if (!target) return fail(400, { error: "target_folder_id required" });
    if (target === params.folderId) return { ok: true };
    try {
      await c.mail.moveMessage(params.folderId, params.messageId, target);
    } catch (e) { return fail(500, { error: (e as Error).message }); }
    throw redirect(303, `/mail?folder=${encodeURIComponent(target)}`);
  },
};

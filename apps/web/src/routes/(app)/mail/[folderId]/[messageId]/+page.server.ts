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
    const isUnread = data.get("is_unread")?.toString() === "true";
    const isFlagged = data.get("is_flagged")?.toString() === "true";
    try {
      await c.mail.setMessage({
        folder_id: params.folderId,
        message_id: params.messageId,
        is_unread: isUnread,
        is_flagged: isFlagged,
      });
    } catch (e) { return fail(500, { error: (e as Error).message }); }
    return { ok: true };
  },
};

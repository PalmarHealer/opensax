import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/**
 * Save / autosave a compose draft into the LernSax Drafts folder.
 *
 * The LernSax `save_draft` RPC can only CREATE a draft (it rejects message_id/id
 * and returns no id), so "updating" a draft means: create a fresh one, locate it
 * by listing the Drafts folder, then delete the previous version. The client
 * passes the id it got from the last save as `prevId` so we can remove it.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
  const c = locals.client!;
  const data = await request.json().catch(() => ({}) as Record<string, unknown>);
  const prevId = str(data.prevId);
  const subject = str(data.subject) || undefined;
  try {
    const folders = await c.mail.getFolders();
    const drafts = folders.find((f) => f.is_drafts);
    if (!drafts) return json({ error: "Drafts-Ordner nicht gefunden" }, { status: 500 });

    await c.mail.saveDraft({
      to: str(data.to) || undefined,
      cc: str(data.cc) || undefined,
      bcc: str(data.bcc) || undefined,
      subject,
      body_plain: str(data.body_plain) ?? str(data.body) ?? "",
      body_html: str(data.body_html) || undefined,
    });

    // Locate the just-created draft (save_draft returns no id): newest entry in
    // Drafts, excluding the previous version, preferring a subject match.
    const msgs = await c.mail.getMessages({ folder_id: drafts.id, limit: 25 });
    const candidates = msgs.filter((m) => String(m.id) !== prevId);
    const matched = subject
      ? candidates.filter((m) => (m.subject ?? "") === subject)
      : candidates;
    const pool = matched.length ? matched : candidates;
    const newest = pool.reduce<(typeof pool)[number] | undefined>(
      (best, m) => (!best || Number(m.id) > Number(best.id) ? m : best),
      undefined,
    );
    const draftId = newest ? String(newest.id) : undefined;

    // Remove the previous version now that the replacement exists.
    if (prevId && prevId !== draftId) {
      try {
        await c.mail.deleteMessage(drafts.id, prevId);
      } catch {
        /* already gone — ignore */
      }
    }
    return json({ ok: true, draftId });
  } catch (e) {
    return json({ error: (e as Error).message }, { status: 500 });
  }
};

/** Discard a previously-autosaved draft (used by the compose "Verwerfen" button). */
export const DELETE: RequestHandler = async ({ locals, request }) => {
  const c = locals.client!;
  const data = await request.json().catch(() => ({}) as Record<string, unknown>);
  const id = str(data.id);
  if (!id) return json({ ok: true });
  try {
    const folders = await c.mail.getFolders();
    const drafts = folders.find((f) => f.is_drafts);
    if (drafts) await c.mail.deleteMessage(drafts.id, id);
    return json({ ok: true });
  } catch (e) {
    return json({ error: (e as Error).message }, { status: 500 });
  }
};

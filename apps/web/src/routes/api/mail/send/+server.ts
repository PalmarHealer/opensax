import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ locals, request }) => {
  const c = locals.client!;
  const data = await request.formData();
  const to = data.get("to")?.toString().trim();
  const subject = data.get("subject")?.toString().trim();
  if (!to || !subject) return json({ error: "to+subject required" }, { status: 400 });
  try {
    await c.mail.sendMail({
      to,
      cc: data.get("cc")?.toString() || undefined,
      bcc: data.get("bcc")?.toString() || undefined,
      subject,
      body_plain: data.get("body")?.toString() ?? "",
      reply_id: data.get("reply_id")?.toString() || undefined,
      forward_id: data.get("forward_id")?.toString() || undefined,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, { status: 500 });
  }
  return json({ ok: true });
};

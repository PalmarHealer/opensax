import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

type Mode = "reply" | "reply-all" | "forward";

export const GET: RequestHandler = async ({ locals, url }) => {
  const c = locals.client!;
  const mode = url.searchParams.get("mode") as Mode | null;
  const folder = url.searchParams.get("folder");
  const message = url.searchParams.get("message");
  if (!mode || !folder || !message) return json({ error: "missing params" }, { status: 400 });

  const m = await c.mail.readMessage(folder, message);
  const sender = m.from?.[0]?.addr ?? "";
  const subject = m.subject ?? "";
  const dateStr = m.date ? new Date(m.date * 1000).toLocaleString("de-DE") : "";
  const senderDisplay = m.from?.[0]?.name ? `${m.from[0].name} <${m.from[0].addr}>` : m.from?.[0]?.addr ?? "";
  const quoted = (m.body_plain ?? "").split(/\r?\n/).map((l) => `> ${l}`).join("\n");

  if (mode === "reply") {
    return json({
      to: sender,
      cc: "",
      bcc: "",
      subject: subject.startsWith("Re: ") ? subject : `Re: ${subject}`,
      body: `\n\nAm ${dateStr} schrieb ${senderDisplay}:\n${quoted}`,
      reply_id: String(m.id),
    });
  }
  if (mode === "reply-all") {
    const myEmail = (c.whoami()?.login ?? c.whoami()?.email ?? "").toLowerCase();
    const ccList = [...(m.to ?? []), ...(m.cc ?? [])]
      .map((r) => r.addr)
      .filter((a) => a && a.toLowerCase() !== myEmail && a.toLowerCase() !== sender.toLowerCase())
      .filter((a, i, arr) => arr.indexOf(a) === i);
    return json({
      to: sender,
      cc: ccList.join(", "),
      bcc: "",
      subject: subject.startsWith("Re: ") ? subject : `Re: ${subject}`,
      body: `\n\nAm ${dateStr} schrieb ${senderDisplay}:\n${quoted}`,
      reply_id: String(m.id),
    });
  }
  if (mode === "forward") {
    return json({
      to: "",
      cc: "",
      bcc: "",
      subject: subject.startsWith("Fwd: ") ? subject : `Fwd: ${subject}`,
      body: `\n\n----- Weitergeleitete Nachricht -----\nVon: ${senderDisplay}\nDatum: ${dateStr}\nBetreff: ${subject}\n\n${m.body_plain ?? ""}`,
      forward_id: String(m.id),
    });
  }
  return json({ error: "unknown mode" }, { status: 400 });
};

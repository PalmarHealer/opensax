import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { getUserIdForSession } from "$lib/server/sessionStore";
import { deliver, feedbackEnabled, newReportId, serverContext, type Screenshot } from "$lib/server/feedbackSink";
import {
  FEEDBACK_TYPES,
  LIMITS,
  STEPS,
  AREAS,
  displayValue,
  isValidManualContact,
  type FeedbackPayload,
  type FeedbackType,
} from "$lib/feedback";

const COOKIE = "lernsax_sid";
const MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024;
const MAX_LOGS = 200;
const MAX_LOG_MSG = 2000;
const MAX_CLIENT_CONFIG = 20_000;

/**
 * Was der Server auf Wunsch ergänzen würde — der Wizard zeigt es vor dem
 * Absenden an, damit niemand blind „Account-Daten mitsenden“ ankreuzt.
 */
export const GET: RequestHandler = async ({ locals, cookies }) => {
  const user_id = getUserIdForSession(cookies.get(COOKIE) ?? null);
  return json(serverContext(locals.client!, user_id), { headers: { "cache-control": "no-store" } });
};

function bad(message: string) {
  return json({ error: message }, { status: 400 });
}

function parseScreenshot(dataUrl: unknown): Screenshot | string {
  if (typeof dataUrl !== "string") return "Screenshot fehlt.";
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return "Screenshot hat ein unbekanntes Format.";
  const data = Buffer.from(m[2]!, "base64");
  if (data.length > MAX_SCREENSHOT_BYTES) return "Screenshot ist zu groß.";
  return { mime: m[1]!, data };
}

/** Lesbare Fassung ohne Kontakt- und Account-Daten, z. B. als Issue-Text. */
function markdown(type: FeedbackType, fields: Record<string, string>, extras: { config?: unknown; logs?: FeedbackPayload["logs"] }) {
  const parts: string[] = [];
  for (const step of STEPS[type]) {
    for (const f of step.fields) {
      if (f.key === "title") continue;
      const v = fields[f.key];
      if (!v) continue;
      parts.push(f.kind === "textarea" ? `### ${f.label}\n\n${v}` : `**${f.label}:** ${displayValue(f, v)}`);
    }
  }
  if (extras.config) parts.push("### Technische Infos\n\n```json\n" + JSON.stringify(extras.config, null, 2) + "\n```");
  if (extras.logs?.length) {
    const tail = extras.logs.slice(-50).map((l) => `${new Date(l.t).toISOString()} [${l.level}] ${l.msg}`).join("\n");
    parts.push("### Browser-Logs (letzte 50)\n\n```\n" + tail.replaceAll("```", "'''") + "\n```");
  }
  return parts.join("\n\n");
}

export const POST: RequestHandler = async ({ locals, cookies, request }) => {
  if (!feedbackEnabled()) return json({ error: "Feedback ist auf diesem Server nicht eingerichtet." }, { status: 404 });
  let body: FeedbackPayload;
  try {
    body = await request.json();
  } catch {
    return bad("Ungültige Anfrage.");
  }

  const type = body?.type;
  if (!type || !(type in FEEDBACK_TYPES)) return bad("Unbekannte Art von Feedback.");

  // Nur Felder, die der Wizard für diese Art tatsächlich abfragt.
  const fields: Record<string, string> = {};
  for (const step of STEPS[type]) {
    for (const f of step.fields) {
      const raw = body.fields?.[f.key];
      const v = typeof raw === "string" ? raw.trim() : "";
      if (!v) {
        if (f.required) return bad(`„${f.label}“ fehlt.`);
        continue;
      }
      if (v.length > (f.kind === "textarea" ? LIMITS.textarea : LIMITS.text)) return bad(`„${f.label}“ ist zu lang.`);
      if (f.kind === "choice" && !f.options?.some((o) => o.value === v)) return bad(`„${f.label}“ hat einen ungültigen Wert.`);
      if (f.kind === "area" && !AREAS.some((a) => a.value === v)) return bad("Unbekannter Bereich.");
      fields[f.key] = v;
    }
  }

  const include = {
    screenshot: !!body.include?.screenshot,
    logs: !!body.include?.logs,
    config: !!body.include?.config,
    account: !!body.include?.account,
  };

  let shot: Screenshot | null = null;
  if (include.screenshot) {
    const parsed = parseScreenshot(body.screenshot);
    if (typeof parsed === "string") return bad(parsed);
    shot = parsed;
  }

  let logs: FeedbackPayload["logs"];
  if (include.logs) {
    if (!Array.isArray(body.logs)) return bad("Browser-Logs fehlen.");
    logs = body.logs.slice(-MAX_LOGS).map((l) => ({
      t: Number(l?.t) || 0,
      level: String(l?.level ?? "log").slice(0, 10),
      msg: String(l?.msg ?? "").slice(0, MAX_LOG_MSG),
    }));
  }

  let clientConfig: Record<string, unknown> | undefined;
  if (include.config) {
    clientConfig = body.client_config && typeof body.client_config === "object" ? body.client_config : {};
    if (JSON.stringify(clientConfig).length > MAX_CLIENT_CONFIG) return bad("Technische Infos sind zu groß.");
  }

  // Kontakt- und Account-Daten kommen aus der Sitzung, nicht vom Browser —
  // so kann niemand im Namen eines anderen Accounts schreiben.
  const user_id = getUserIdForSession(cookies.get(COOKIE) ?? null);
  const ctx = serverContext(locals.client!, user_id);

  const method = body.contact?.method ?? "none";
  let contact: { method: string; value: string | null };
  if (method === "none") contact = { method, value: null };
  else if (method === "lernsax") {
    if (!ctx.lernsax_email) return bad("Keine LernSax-Adresse in der Sitzung gefunden.");
    contact = { method, value: ctx.lernsax_email };
  } else if (method === "manual") {
    const v = String(body.contact?.value ?? "").trim();
    if (!isValidManualContact(v)) return bad("Bitte eine gültige E-Mail-Adresse oder Telefonnummer angeben.");
    contact = { method, value: v };
  } else return bad("Unbekannter Kontaktweg.");

  const config = include.config ? { client: clientConfig, server: ctx.config } : undefined;
  const id = newReportId();
  const report = {
    id,
    created_at: new Date().toISOString(),
    type,
    type_label: FEEDBACK_TYPES[type].short,
    title: fields.title || `${FEEDBACK_TYPES[type].short}: ${AREAS.find((a) => a.value === fields.area)?.label ?? "Allgemein"}`,
    fields,
    contact,
    included: include,
    account: include.account ? ctx.account : null,
    config: config ?? null,
    logs: logs ?? null,
    markdown: markdown(type, fields, { config, logs }),
  };

  try {
    const via = await deliver(report, shot);
    return json({ ok: true, id, via });
  } catch (e) {
    console.error("[feedback] could not deliver report", e);
    return json({ error: "Feedback konnte nicht gespeichert werden. Bitte später erneut versuchen." }, { status: 500 });
  }
};

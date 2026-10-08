/**
 * Where feedback reports go.
 *
 * Feedback is optional: only with both `FEEDBACK_WEBHOOK_URL` and
 * `FEEDBACK_WEBHOOK_SECRET` set does the avatar menu offer it at all. Each
 * report is then POSTed to the URL as JSON (an n8n Webhook node, typically —
 * the routing to GitHub, Nextcloud, mail … lives in the workflow, not here),
 * with the secret in the `X-OpenSax-Secret` header so the workflow can reject
 * strangers.
 *
 * When the webhook fails, the report lands on disk instead
 * (`<data>/feedback/<id>.json` + screenshot) so nothing a user took the time
 * to write is lost.
 */
import { env } from "$env/dynamic/private";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { LernSaxClient } from "@lernsax/core";
import { groupScope } from "$lib/nav";
import type { ServerContext } from "$lib/feedback";
import { loadConfig as loadDavinciConfig } from "$lib/server/davinciStore";
import { listForUser } from "$lib/server/connectionStore";

const STORE_DIR = env.FEEDBACK_DIR
  ?? (process.env.NODE_ENV === "production" ? "/app/data/feedback" : "./.session-store/feedback");

const WEBHOOK_TIMEOUT_MS = 15_000;

/** Both variables set — otherwise the menu entry and the API are off. */
export function feedbackEnabled(): boolean {
  return !!env.FEEDBACK_WEBHOOK_URL && !!env.FEEDBACK_WEBHOOK_SECRET;
}

export function newReportId(): string {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `FB-${day}-${randomBytes(3).toString("hex")}`;
}

export function serverContext(client: LernSaxClient, user_id: string | null): ServerContext {
  const u = client.whoami();
  const groups = client.groups();
  const schools = groups.filter((g) => groupScope(g) === "school");
  const classes = groups.filter((g) => groupScope(g) === "class");
  const davinci = user_id ? loadDavinciConfig(user_id) : null;
  const connections = user_id ? listForUser(user_id) : [];
  const email = u?.email ?? u?.login ?? "";
  return {
    account: {
      name: u?.fullname ?? u?.name_hr ?? "",
      login: u?.login ?? "",
      email,
      schools: schools.map((g) => g.name_hr ?? g.login),
      classes: classes.map((g) => g.name_hr ?? g.login),
    },
    config: {
      timetable: {
        configured: !!davinci,
        source_type: davinci?.sourceType ?? null,
        class_filter: !!davinci?.classCode,
        teacher_filter: !!davinci?.teacherCode,
      },
      groups: { schools: schools.length, classes: classes.length },
      connections: {
        oauth: connections.filter((c) => (c.kind ?? "oauth") === "oauth").length,
        api_tokens: connections.filter((c) => c.kind === "token").length,
      },
    },
    lernsax_email: email,
  };
}

export interface Screenshot { mime: string; data: Buffer }

function saveToDisk(report: Record<string, unknown> & { id: string }, shot: Screenshot | null): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  if (shot) writeFileSync(join(STORE_DIR, `${report.id}.jpg`), shot.data);
  writeFileSync(join(STORE_DIR, `${report.id}.json`), JSON.stringify(report, null, 2), "utf8");
}

async function postWebhook(url: string, report: Record<string, unknown> & { id: string }, shot: Screenshot | null): Promise<void> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-opensax-secret": env.FEEDBACK_WEBHOOK_SECRET ?? "",
  };
  const body = {
    ...report,
    screenshot: shot
      ? { filename: `${report.id}.jpg`, mime: shot.mime, base64: shot.data.toString("base64") }
      : null,
  };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`webhook answered ${res.status}`);
}

export async function deliver(
  report: Record<string, unknown> & { id: string },
  shot: Screenshot | null,
): Promise<"webhook" | "disk"> {
  const url = env.FEEDBACK_WEBHOOK_URL;
  if (url) {
    try {
      await postWebhook(url, report, shot);
      return "webhook";
    } catch (e) {
      console.error(`[feedback] webhook failed for ${report.id}, keeping it on disk`, e);
    }
  }
  saveToDisk(report, shot);
  console.info(`[feedback] ${report.id} stored in ${STORE_DIR}`);
  return "disk";
}

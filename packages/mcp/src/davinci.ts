/**
 * Read-side access to the timetable (DaVinci) configuration the web app saved.
 *
 * The MCP server has no UI of its own, so it never asks for an endpoint: it
 * reads the config the user already entered under Settings → Stundenplan,
 * exactly the way `auth.ts` reads the session store. Both containers mount
 * /app/data and share LERNSAX_WEB_SESSION_KEY, so the same AES-256-GCM record
 * opens on either side.
 *
 * Identity is the same `user_id` the web app keys by — a truncated SHA-256 of
 * the LernSax email — which means a stdio caller passing email+password lands
 * on the same config as an OAuth bearer.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDecipheriv, createHash } from "node:crypto";
import {
  fetchDaVinci,
  fetchDaVinciHtml,
  type DaVinciEntry,
  type DaVinciPayload,
} from "@lernsax/core";

const STORE = process.env.LERNSAX_DATA_DIR
  ?? (process.env.NODE_ENV === "production" ? "/app/data" : "./.session-store");
const DAVINCI_DIR = process.env.LERNSAX_DAVINCI_DIR ?? join(STORE, "davinci");

const KEY = (() => {
  const env = process.env.LERNSAX_WEB_SESSION_KEY;
  if (env && env.length >= 32) return Buffer.from(env.slice(0, 32));
  return null;
})();

/** Mirrors the web app's `DaVinciConfig` — same record, same field names. */
export interface DaVinciConfig {
  endpoint: string;
  resolvedEndpoint?: string;
  sourceType?: "infoserver" | "html";
  username: string;
  password: string;
  classCode?: string;
  teacherCode?: string;
  includeSupervisions?: boolean;
}

interface DiskRecord {
  iv: string;
  tag: string;
  enc: string;
  updatedAt: number;
}

/** The account key the web app files timetable configs under. */
export function userIdForEmail(email: string): string {
  return createHash("sha256").update(email.toLowerCase().trim()).digest("hex").slice(0, 32);
}

export function loadDaVinciConfig(user_id: string): DaVinciConfig | null {
  if (!KEY) return null;
  const p = join(DAVINCI_DIR, `${user_id.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
  if (!existsSync(p)) return null;
  try {
    const rec = JSON.parse(readFileSync(p, "utf8")) as DiskRecord;
    const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(rec.iv, "hex"));
    decipher.setAuthTag(Buffer.from(rec.tag, "hex"));
    const out = Buffer.concat([decipher.update(Buffer.from(rec.enc, "hex")), decipher.final()]);
    return JSON.parse(out.toString("utf8")) as DaVinciConfig;
  } catch {
    // Missing, malformed, or written under a rotated key — either way there is
    // nothing here the caller can use.
    return null;
  }
}

// ── Dataset cache ──────────────────────────────────────────────────────
//
// Same reasoning as the web app's: one big blob per school, changing a few
// times a day, a second to fetch. A short TTL keeps repeated tool calls in a
// single conversation from re-downloading it.

const TTL_MS = 5 * 60 * 1000;

interface JsonEntry { signature: string; payload: DaVinciPayload; etag?: string; fetchedAt: number }
interface HtmlEntry {
  signature: string;
  entries: DaVinciEntry[];
  notes: Record<string, string>;
  generatedAt?: string;
  fetchedAt: number;
}

const jsonCache = new Map<string, JsonEntry>();
const htmlCache = new Map<string, HtmlEntry>();

function endpointOf(cfg: DaVinciConfig): string {
  return cfg.resolvedEndpoint || cfg.endpoint;
}

function signatureOf(cfg: DaVinciConfig): string {
  return createHash("sha256")
    .update(`${cfg.endpoint} ${cfg.resolvedEndpoint ?? ""} ${cfg.username} ${cfg.password}`)
    .digest("hex")
    .slice(0, 16);
}

export async function getPayload(
  user_id: string,
  cfg: DaVinciConfig,
): Promise<{ payload: DaVinciPayload; fetchedAt: number; cached: boolean }> {
  const signature = signatureOf(cfg);
  const hit = jsonCache.get(user_id);
  const reusable = hit && hit.signature === signature ? hit : undefined;
  if (reusable && Date.now() - reusable.fetchedAt < TTL_MS) {
    return { payload: reusable.payload, fetchedAt: reusable.fetchedAt, cached: true };
  }

  const res = await fetchDaVinci({
    endpoint: endpointOf(cfg),
    username: cfg.username || undefined,
    password: cfg.password || undefined,
    etag: reusable?.etag,
  });

  if (!res.payload && reusable) {
    // "Unchanged" — keep what we have and stop asking for a while.
    reusable.fetchedAt = Date.now();
    return { payload: reusable.payload, fetchedAt: reusable.fetchedAt, cached: true };
  }
  if (!res.payload) throw new Error("DaVinci-Server lieferte keine Daten");

  const entry: JsonEntry = { signature, payload: res.payload, etag: res.etag, fetchedAt: Date.now() };
  jsonCache.set(user_id, entry);
  return { payload: entry.payload, fetchedAt: entry.fetchedAt, cached: false };
}

export async function getHtml(
  user_id: string,
  cfg: DaVinciConfig,
): Promise<{ entries: DaVinciEntry[]; notes: Record<string, string>; generatedAt?: string; fetchedAt: number; cached: boolean }> {
  const signature = signatureOf(cfg);
  const hit = htmlCache.get(user_id);
  if (hit && hit.signature === signature && Date.now() - hit.fetchedAt < TTL_MS) {
    return { entries: hit.entries, notes: hit.notes, generatedAt: hit.generatedAt, fetchedAt: hit.fetchedAt, cached: true };
  }

  const res = await fetchDaVinciHtml({ endpoint: endpointOf(cfg) });
  const entry: HtmlEntry = {
    signature,
    entries: res.entries,
    notes: res.notes,
    generatedAt: res.generatedAt,
    fetchedAt: Date.now(),
  };
  htmlCache.set(user_id, entry);
  return { entries: entry.entries, notes: entry.notes, generatedAt: entry.generatedAt, fetchedAt: entry.fetchedAt, cached: false };
}

/**
 * Bearer-token auth for the MCP server. Reads from the same on-disk stores
 * as the web app: connections (list of authorized OAuth tokens) and the
 * encrypted user-session map (so we can resolve a token → LernSax credentials).
 *
 * Both containers mount /app/data, and share the LERNSAX_WEB_SESSION_KEY env.
 *
 * Identity: connections are keyed by `user_id` (a hash of the LernSax email),
 * not by browser session. Multiple device sessions on the same account share
 * the same `user_id`; we pick the most-recently-used one when decrypting
 * credentials so a freshly logged-in device drives the MCP calls.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import type { Credentials } from "@lernsax/core";
import { toolsForScopes } from "./tools.js";

const STORE = process.env.LERNSAX_DATA_DIR
  ?? (process.env.NODE_ENV === "production" ? "/app/data" : "./.session-store");

const SESSION_KEY = (() => {
  const env = process.env.LERNSAX_WEB_SESSION_KEY;
  if (env && env.length >= 32) return Buffer.from(env.slice(0, 32));
  return null;
})();

/** False when LERNSAX_WEB_SESSION_KEY is missing — no bearer can then resolve. */
export const HAS_SESSION_KEY = SESSION_KEY !== null;

let warnedKeyMismatch = false;
function warnKeyMismatch() {
  if (warnedKeyMismatch) return;
  warnedKeyMismatch = true;
  console.error(
    "[lernsax-mcp] none of an account's stored sessions can be decrypted — most likely LERNSAX_WEB_SESSION_KEY differs from the web app's. Its API tokens and MCP connections fail until both containers use the same key.",
  );
}

interface ConnectionRecord {
  id: string;
  token_hash: string;
  /** Modern records store user_id; legacy records used user_sid. */
  user_id?: string;
  user_sid?: string;
  client_name: string;
  scopes: string[];
  created_at: number;
  last_used_at: number;
  expires_at: number;
  /** "token" for API tokens made in Settings; absent for OAuth connections. */
  kind?: "oauth" | "token";
}
interface SessionDiskRecord {
  user_id?: string;
  encCreds: string;
  iv: string;
  tag: string;
  createdAt: number;
  lastSeen: number;
}

function hash(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

type Lookup = { rec: ConnectionRecord } | { error: "unknown" | "expired" };

function findConnection(token: string): Lookup {
  const dir = join(STORE, "connections");
  if (!existsSync(dir)) return { error: "unknown" };
  const expected = hash(token);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as ConnectionRecord;
      const candidate = Buffer.from(rec.token_hash, "hex");
      if (candidate.length !== expected.length) continue;
      if (timingSafeEqual(candidate, expected)) {
        if (rec.expires_at && Date.now() > rec.expires_at) return { error: "expired" };
        // Touch last-used timestamp for the settings UI.
        rec.last_used_at = Date.now();
        try { writeFileSync(join(dir, f), JSON.stringify(rec), { mode: 0o600 }); } catch {}
        return { rec };
      }
    } catch { /* skip malformed */ }
  }
  return { error: "unknown" };
}

function decryptSession(rec: SessionDiskRecord): Credentials | null {
  if (!SESSION_KEY) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", SESSION_KEY, Buffer.from(rec.iv, "hex"));
    decipher.setAuthTag(Buffer.from(rec.tag, "hex"));
    const out = Buffer.concat([decipher.update(Buffer.from(rec.encCreds, "hex")), decipher.final()]);
    return JSON.parse(out.toString("utf8")) as Credentials;
  } catch {
    return null;
  }
}

/**
 * Credentials from the newest session our key can open, null if the account
 * has none, or "undecryptable" if it has sessions but none of them open (key
 * differs from the web app's). Older sessions are tried too, so one stale
 * file — say from before a key change — doesn't lock the account out.
 */
function loadCredsForUser(user_id: string): Credentials | "undecryptable" | null {
  const dir = join(STORE, "sessions");
  if (!existsSync(dir)) return null;
  const mine: SessionDiskRecord[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as SessionDiskRecord;
      // Pre-multi-device records have no user_id; decrypt and compare emails.
      const recUserId = rec.user_id ?? userIdFromCreds(decryptSession(rec));
      if (recUserId !== user_id) continue;
      mine.push(rec);
    } catch { /* skip malformed */ }
  }
  if (mine.length === 0) return null;
  mine.sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  for (const rec of mine) {
    const creds = decryptSession(rec);
    if (creds) return creds;
  }
  return "undecryptable";
}

function userIdFromCreds(creds: Credentials | null): string | null {
  if (!creds?.email) return null;
  return createHash("sha256").update(creds.email.toLowerCase().trim()).digest("hex").slice(0, 32);
}

function loadCredsForLegacySid(user_sid: string): Credentials | "undecryptable" | null {
  if (!SESSION_KEY) return null;
  const safe = user_sid.replace(/[^a-zA-Z0-9_-]/g, "");
  const p = join(STORE, "sessions", `${safe}.json`);
  if (!existsSync(p)) return null;
  try {
    return decryptSession(JSON.parse(readFileSync(p, "utf8")) as SessionDiskRecord) ?? "undecryptable";
  } catch {
    return null;
  }
}

export interface ResolvedAuth {
  credentials: Credentials;
  client_name: string;
  user_id: string;
  /** Tools this token may call — every tool for `lernsax`, else those it names. */
  tools: Set<string>;
  kind: "oauth" | "token";
  /** 0 = never. */
  expires_at: number;
}

/**
 * Why a bearer was turned away, so the REST API can say something more useful
 * than "401". MCP clients only ever see the 401 challenge.
 */
export type AuthFailure =
  | "missing"      // no Bearer header
  | "unknown"      // no such token (never issued, or revoked)
  | "expired"      // past the expiry the user chose
  | "no_scope"     // a sign-in token (openid/profile/…) that grants no tool
  | "no_session"   // the account isn't signed in on any device any more
  | "server_key";  // LERNSAX_WEB_SESSION_KEY missing or not the web app's

export function resolveBearer(authorization: string | null | undefined): { auth: ResolvedAuth } | { error: AuthFailure } {
  if (!authorization) return { error: "missing" };
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!m) return { error: "missing" };
  const found = findConnection(m[1]!);
  if ("error" in found) return found;
  const conn = found.rec;
  // Sign-in tokens (openid/profile/school) prove who someone is, nothing more.
  // Only `lernsax` or individual tool scopes may drive the account.
  const tools = toolsForScopes(conn.scopes ?? []);
  if (tools.size === 0) return { error: "no_scope" };
  if (!SESSION_KEY) return { error: "server_key" };

  let user_id = conn.user_id ?? null;
  let loaded: Credentials | "undecryptable" | null = null;
  if (user_id) {
    // Credentials are the ones the account signed in with on the web — an API
    // token carries none of its own, so it works for as long as at least one
    // device session is alive.
    loaded = loadCredsForUser(user_id);
  } else if (conn.user_sid) {
    // Legacy record predating the multi-device refactor: fall back to the
    // single session file the connection was issued against.
    loaded = loadCredsForLegacySid(conn.user_sid);
  }
  if (loaded === "undecryptable") {
    warnKeyMismatch();
    return { error: "server_key" };
  }
  const creds = loaded;
  if (!user_id) user_id = userIdFromCreds(creds);
  if (!creds || !user_id) return { error: "no_session" };
  return {
    auth: {
      credentials: creds,
      client_name: conn.client_name,
      user_id,
      tools,
      kind: conn.kind ?? "oauth",
      expires_at: conn.expires_at ?? 0,
    },
  };
}

/**
 * Bearer-token auth for the MCP server. Reads from the same on-disk stores
 * as the web app: connections (list of authorized OAuth tokens) and the
 * encrypted user-session map (so we can resolve a token → LernSax credentials).
 *
 * Both containers mount /app/data, and share the LERNSAX_WEB_SESSION_KEY env.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import type { Credentials } from "@lernsax/core";

const STORE = process.env.LERNSAX_DATA_DIR
  ?? (process.env.NODE_ENV === "production" ? "/app/data" : "./.session-store");

const SESSION_KEY = (() => {
  const env = process.env.LERNSAX_WEB_SESSION_KEY;
  if (env && env.length >= 32) return Buffer.from(env.slice(0, 32));
  return null;
})();

interface ConnectionRecord {
  id: string;
  token_hash: string;
  user_sid: string;
  client_name: string;
  scopes: string[];
  created_at: number;
  last_used_at: number;
  expires_at: number;
}
interface SessionDiskRecord {
  encCreds: string;
  iv: string;
  tag: string;
  createdAt: number;
  lastSeen: number;
}

function hash(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

function findConnection(token: string): ConnectionRecord | null {
  const dir = join(STORE, "connections");
  if (!existsSync(dir)) return null;
  const expected = hash(token);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as ConnectionRecord;
      const candidate = Buffer.from(rec.token_hash, "hex");
      if (candidate.length !== expected.length) continue;
      if (timingSafeEqual(candidate, expected)) {
        if (rec.expires_at && Date.now() > rec.expires_at) return null;
        // Touch last-used timestamp for the settings UI.
        rec.last_used_at = Date.now();
        try { writeFileSync(join(dir, f), JSON.stringify(rec), { mode: 0o600 }); } catch {}
        return rec;
      }
    } catch { /* skip malformed */ }
  }
  return null;
}

function loadCredsFor(user_sid: string): Credentials | null {
  if (!SESSION_KEY) return null;
  const safe = user_sid.replace(/[^a-zA-Z0-9_-]/g, "");
  const p = join(STORE, "sessions", `${safe}.json`);
  if (!existsSync(p)) return null;
  try {
    const r = JSON.parse(readFileSync(p, "utf8")) as SessionDiskRecord;
    const decipher = createDecipheriv("aes-256-gcm", SESSION_KEY, Buffer.from(r.iv, "hex"));
    decipher.setAuthTag(Buffer.from(r.tag, "hex"));
    const out = Buffer.concat([decipher.update(Buffer.from(r.encCreds, "hex")), decipher.final()]);
    return JSON.parse(out.toString("utf8")) as Credentials;
  } catch {
    return null;
  }
}

export interface ResolvedAuth {
  credentials: Credentials;
  client_name: string;
  user_sid: string;
}

/** Resolve an Authorization header to LernSax credentials, or null. */
export function authFromHeader(authorization: string | null | undefined): ResolvedAuth | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!m) return null;
  const conn = findConnection(m[1]!);
  if (!conn) return null;
  const creds = loadCredsFor(conn.user_sid);
  if (!creds) return null;
  return { credentials: creds, client_name: conn.client_name, user_sid: conn.user_sid };
}

import { LernSaxClient, type Credentials } from "@lernsax/core";
import { env } from "$env/dynamic/private";
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listForUser, revoke } from "./connectionStore";

const KEY = (() => {
  // Via `$env/dynamic/private` so `.env` is honoured in dev too; it falls back
  // to process.env, which is where the container passes it in production.
  const secret = env.LERNSAX_WEB_SESSION_KEY;
  if (secret && secret.length >= 32) return Buffer.from(secret.slice(0, 32));
  const generated = randomBytes(32);
  console.warn(
    "[sessionStore] LERNSAX_WEB_SESSION_KEY not set — using ephemeral key. Sessions will not survive restart.",
  );
  return generated;
})();

const STORE_DIR = process.env.LERNSAX_WEB_SESSION_DIR
  ?? (process.env.NODE_ENV === "production" ? "/app/data/sessions" : "./.session-store");

interface SessionMeta {
  /** IP at first sign-in, kept so the user can recognise the device in Settings. */
  firstIp?: string;
  /** Most recent IP we saw this session from. */
  lastIp?: string;
  /** Raw User-Agent string captured at sign-in. Settings parses it for display. */
  userAgent?: string;
}

interface StoredSession extends SessionMeta {
  user_id: string;
  encCreds: Buffer;
  iv: Buffer;
  tag: Buffer;
  client: LernSaxClient | null;
  createdAt: number;
  lastSeen: number;
}

interface DiskRecord extends SessionMeta {
  user_id?: string; // optional for migration of pre-multi-device records
  encCreds: string; // hex
  iv: string;       // hex
  tag: string;      // hex
  createdAt: number;
  lastSeen: number;
}

const sessions = new Map<string, StoredSession>();
export const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
const REAP_INTERVAL_MS = 60 * 60 * 1000;

/** Stable identifier for a LernSax account. Hashed so it's safe to log/display. */
export function userIdFromEmail(email: string): string {
  return createHash("sha256").update(email.toLowerCase().trim()).digest("hex").slice(0, 32);
}

// ── Disk persistence ────────────────────────────────────────────────────
function ensureDir(): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
}
function pathFor(id: string): string {
  // Sanitize the id so it's a safe filename. Our generated ids are base64url
  // already so this is just a defensive belt+braces.
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return join(STORE_DIR, `${safe}.json`);
}
function persist(id: string, s: StoredSession): void {
  try {
    ensureDir();
    const rec: DiskRecord = {
      user_id: s.user_id,
      encCreds: s.encCreds.toString("hex"),
      iv: s.iv.toString("hex"),
      tag: s.tag.toString("hex"),
      createdAt: s.createdAt,
      lastSeen: s.lastSeen,
      firstIp: s.firstIp,
      lastIp: s.lastIp,
      userAgent: s.userAgent,
    };
    writeFileSync(pathFor(id), JSON.stringify(rec), { mode: 0o600 });
  } catch (err) {
    console.warn("[sessionStore] persist failed", err);
  }
}
function unpersist(id: string): void {
  try { unlinkSync(pathFor(id)); } catch { /* ignore */ }
}

function decryptDiskCreds(rec: DiskRecord): Credentials {
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(rec.iv, "hex"));
  decipher.setAuthTag(Buffer.from(rec.tag, "hex"));
  const out = Buffer.concat([decipher.update(Buffer.from(rec.encCreds, "hex")), decipher.final()]);
  return JSON.parse(out.toString("utf8")) as Credentials;
}

function loadFromDisk(): void {
  try {
    ensureDir();
    const now = Date.now();
    for (const f of readdirSync(STORE_DIR)) {
      if (!f.endsWith(".json")) continue;
      const id = f.slice(0, -5);
      try {
        const rec = JSON.parse(readFileSync(join(STORE_DIR, f), "utf8")) as DiskRecord;
        if (now - rec.createdAt > SESSION_TTL_MS) {
          unlinkSync(join(STORE_DIR, f));
          continue;
        }
        // Backfill user_id for sessions written before the multi-device refactor.
        let user_id = rec.user_id;
        if (!user_id) {
          try {
            user_id = userIdFromEmail(decryptDiskCreds(rec).email);
          } catch {
            console.warn(`[sessionStore] could not derive user_id for ${f}; skipping`);
            continue;
          }
        }
        const s: StoredSession = {
          user_id,
          encCreds: Buffer.from(rec.encCreds, "hex"),
          iv: Buffer.from(rec.iv, "hex"),
          tag: Buffer.from(rec.tag, "hex"),
          client: null, // re-login lazily on next use
          createdAt: rec.createdAt,
          lastSeen: rec.lastSeen,
          firstIp: rec.firstIp,
          lastIp: rec.lastIp,
          userAgent: rec.userAgent,
        };
        sessions.set(id, s);
        if (!rec.user_id) persist(id, s); // rewrite with user_id field
      } catch (err) {
        console.warn(`[sessionStore] could not load ${f}:`, err);
      }
    }
    if (sessions.size > 0) {
      console.log(`[sessionStore] restored ${sessions.size} sessions from disk`);
    }
  } catch (err) {
    console.warn("[sessionStore] load failed", err);
  }
}
loadFromDisk();

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
      unpersist(id);
    }
  }
}, REAP_INTERVAL_MS).unref?.();

// ── Public API ─────────────────────────────────────────────────────────
export function createSession(creds: Credentials, meta: SessionMeta = {}): string {
  const id = randomBytes(24).toString("base64url");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(creds), "utf8"), cipher.final()]);
  const s: StoredSession = {
    user_id: userIdFromEmail(creds.email),
    encCreds: enc,
    iv,
    tag: cipher.getAuthTag(),
    client: null,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    firstIp: meta.firstIp,
    lastIp: meta.firstIp ?? meta.lastIp,
    userAgent: meta.userAgent,
  };
  sessions.set(id, s);
  persist(id, s);
  return id;
}

/** Update the moving fields on a session (last-seen IP, last-seen timestamp). */
export function touchSession(id: string, ip?: string): void {
  const s = sessions.get(id);
  if (!s) return;
  s.lastSeen = Date.now();
  if (ip) s.lastIp = ip;
  persist(id, s);
}

export function destroySession(id: string): void {
  const s = sessions.get(id);
  if (s?.client) s.client.logout().catch(() => {});
  sessions.delete(id);
  unpersist(id);
  // Connections live one level up — they're tied to the LernSax account, not
  // this device's session. Logging out one device must NOT revoke MCP tokens
  // a second device set up. Wipe-all-data is `destroySessionsForUser` instead.
}

/** Tear down every session and connection belonging to a LernSax account. */
export function destroySessionsForUser(user_id: string): void {
  for (const [id, s] of sessions) {
    if (s.user_id !== user_id) continue;
    if (s.client) s.client.logout().catch(() => {});
    sessions.delete(id);
    unpersist(id);
  }
  try {
    for (const conn of listForUser(user_id)) revoke(conn.id);
  } catch (err) {
    console.warn("[sessionStore] failed to revoke connections", err);
  }
}

function decryptCreds(s: StoredSession): Credentials {
  const decipher = createDecipheriv("aes-256-gcm", KEY, s.iv);
  decipher.setAuthTag(s.tag);
  const out = Buffer.concat([decipher.update(s.encCreds), decipher.final()]);
  return JSON.parse(out.toString("utf8")) as Credentials;
}

export async function getClientForSession(id: string | null): Promise<LernSaxClient | null> {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  s.lastSeen = Date.now();
  if (s.client) return s.client;
  const creds = decryptCreds(s);
  const client = new LernSaxClient(creds);
  await client.login();
  s.client = client;
  // Touching lastSeen warrants a small re-persist; do it best-effort.
  persist(id, s);
  return client;
}

export function hasSession(id: string | null): boolean {
  return !!id && sessions.has(id);
}

export function getCredentialsForSession(id: string | null): Credentials | null {
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  return decryptCreds(s);
}

export function getUserIdForSession(id: string | null): string | null {
  if (!id) return null;
  return sessions.get(id)?.user_id ?? null;
}

export interface SessionSummary {
  /** Stable, non-sensitive id usable in URLs (hash of the real sid). */
  device_id: string;
  /** True if the caller's own cookie matches this session. */
  isCurrent: boolean;
  createdAt: number;
  lastSeen: number;
  firstIp?: string;
  lastIp?: string;
  userAgent?: string;
}

function deviceIdOf(sid: string): string {
  return createHash("sha256").update(sid).digest("hex").slice(0, 24);
}

/** All active sessions for a given user (one per device). */
export function listSessionsForUser(user_id: string, currentSid?: string | null): SessionSummary[] {
  const out: SessionSummary[] = [];
  for (const [sid, s] of sessions) {
    if (s.user_id === user_id) {
      out.push({
        device_id: deviceIdOf(sid),
        isCurrent: sid === currentSid,
        createdAt: s.createdAt,
        lastSeen: s.lastSeen,
        firstIp: s.firstIp,
        lastIp: s.lastIp,
        userAgent: s.userAgent,
      });
    }
  }
  return out;
}

/** Revoke a session of `user_id` by its `device_id` (hash of sid). Returns true if found. */
export function revokeDeviceForUser(user_id: string, device_id: string): boolean {
  for (const [sid, s] of sessions) {
    if (s.user_id !== user_id) continue;
    if (deviceIdOf(sid) !== device_id) continue;
    if (s.client) s.client.logout().catch(() => {});
    sessions.delete(sid);
    unpersist(sid);
    return true;
  }
  return false;
}

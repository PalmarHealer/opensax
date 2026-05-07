import { LernSaxClient, type Credentials } from "@lernsax/core";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEY = (() => {
  const env = process.env.LERNSAX_WEB_SESSION_KEY;
  if (env && env.length >= 32) return Buffer.from(env.slice(0, 32));
  const generated = randomBytes(32);
  console.warn(
    "[sessionStore] LERNSAX_WEB_SESSION_KEY not set — using ephemeral key. Sessions will not survive restart.",
  );
  return generated;
})();

const STORE_DIR = process.env.LERNSAX_WEB_SESSION_DIR
  ?? (process.env.NODE_ENV === "production" ? "/app/data/sessions" : "./.session-store");

interface StoredSession {
  encCreds: Buffer;
  iv: Buffer;
  tag: Buffer;
  client: LernSaxClient | null;
  createdAt: number;
  lastSeen: number;
}

interface DiskRecord {
  encCreds: string; // hex
  iv: string;       // hex
  tag: string;      // hex
  createdAt: number;
  lastSeen: number;
}

const sessions = new Map<string, StoredSession>();
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REAP_INTERVAL_MS = 60 * 60 * 1000;

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
      encCreds: s.encCreds.toString("hex"),
      iv: s.iv.toString("hex"),
      tag: s.tag.toString("hex"),
      createdAt: s.createdAt,
      lastSeen: s.lastSeen,
    };
    writeFileSync(pathFor(id), JSON.stringify(rec), { mode: 0o600 });
  } catch (err) {
    console.warn("[sessionStore] persist failed", err);
  }
}
function unpersist(id: string): void {
  try { unlinkSync(pathFor(id)); } catch { /* ignore */ }
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
        sessions.set(id, {
          encCreds: Buffer.from(rec.encCreds, "hex"),
          iv: Buffer.from(rec.iv, "hex"),
          tag: Buffer.from(rec.tag, "hex"),
          client: null, // re-login lazily on next use
          createdAt: rec.createdAt,
          lastSeen: rec.lastSeen,
        });
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
export function createSession(creds: Credentials): string {
  const id = randomBytes(24).toString("base64url");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(creds), "utf8"), cipher.final()]);
  const s: StoredSession = {
    encCreds: enc,
    iv,
    tag: cipher.getAuthTag(),
    client: null,
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };
  sessions.set(id, s);
  persist(id, s);
  return id;
}

export function destroySession(id: string): void {
  const s = sessions.get(id);
  if (s?.client) s.client.logout().catch(() => {});
  sessions.delete(id);
  unpersist(id);
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

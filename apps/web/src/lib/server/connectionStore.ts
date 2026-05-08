/**
 * Persistent store for OAuth-style connections — one per (user, third-party
 * client) pair. Bearer tokens are written here when the user approves a
 * Connect-flow on `/oauth/authorize` and read by the MCP container on every
 * tool call (the data dir is mounted into both containers).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const STORE_DIR = process.env.LERNSAX_CONNECTIONS_DIR
  ?? (process.env.NODE_ENV === "production" ? "/app/data/connections" : "./.session-store/connections");

export interface ConnectionRecord {
  /** SHA-256 hex of the access token; the bare token is never persisted. */
  token_hash: string;
  /** Refresh token hash (optional). */
  refresh_hash?: string;
  /**
   * Stable identifier for the LernSax account that approved this connection.
   * Derived from the email — same across devices, so a token issued from a
   * laptop session stays valid (and visible in Settings) when the same user
   * logs in on a phone.
   */
  user_id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  scopes: string[];
  created_at: number;
  last_used_at: number;
  /** 0 = never expires (we rotate via refresh). */
  expires_at: number;
  /** Stable display id (also used as the file basename). */
  id: string;
}

function ensureDir() { if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true }); }
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function pathFor(id: string): string {
  return join(STORE_DIR, `${id.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
}

/** Mint a fresh opaque token (URL-safe, 32 bytes of entropy). */
export function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createConnection(args: {
  user_id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  scopes: string[];
  access_token: string;
  refresh_token?: string;
  ttl_sec?: number;
}): ConnectionRecord {
  ensureDir();
  const id = randomBytes(12).toString("base64url");
  const now = Date.now();
  const rec: ConnectionRecord = {
    id,
    token_hash: hashToken(args.access_token),
    refresh_hash: args.refresh_token ? hashToken(args.refresh_token) : undefined,
    user_id: args.user_id,
    client_id: args.client_id,
    client_name: args.client_name,
    redirect_uris: args.redirect_uris,
    scopes: args.scopes,
    created_at: now,
    last_used_at: now,
    expires_at: args.ttl_sec ? now + args.ttl_sec * 1000 : 0,
  };
  writeFileSync(pathFor(id), JSON.stringify(rec), { mode: 0o600 });
  return rec;
}

export function listAll(): ConnectionRecord[] {
  ensureDir();
  const out: ConnectionRecord[] = [];
  for (const f of readdirSync(STORE_DIR)) {
    if (!f.endsWith(".json") || f.startsWith("_")) continue;
    try {
      out.push(JSON.parse(readFileSync(join(STORE_DIR, f), "utf8")) as ConnectionRecord);
    } catch { /* skip */ }
  }
  return out;
}

export function listForUser(user_id: string): ConnectionRecord[] {
  return listAll().filter((c) => c.user_id === user_id);
}

/** Resolve a presented Bearer token to its connection. Updates `last_used_at`. */
export function findByAccessToken(token: string): ConnectionRecord | null {
  const expected = hashToken(token);
  for (const c of listAll()) {
    if (c.token_hash.length !== expected.length) continue;
    if (timingSafeEqual(Buffer.from(c.token_hash, "hex"), Buffer.from(expected, "hex"))) {
      if (c.expires_at && Date.now() > c.expires_at) return null;
      c.last_used_at = Date.now();
      try { writeFileSync(pathFor(c.id), JSON.stringify(c), { mode: 0o600 }); } catch { /* best-effort */ }
      return c;
    }
  }
  return null;
}

export function findByRefreshToken(token: string): ConnectionRecord | null {
  const expected = hashToken(token);
  for (const c of listAll()) {
    if (!c.refresh_hash) continue;
    if (c.refresh_hash.length !== expected.length) continue;
    if (timingSafeEqual(Buffer.from(c.refresh_hash, "hex"), Buffer.from(expected, "hex"))) return c;
  }
  return null;
}

export function rotateAccessToken(id: string, newAccessToken: string): boolean {
  const p = pathFor(id);
  if (!existsSync(p)) return false;
  const c = JSON.parse(readFileSync(p, "utf8")) as ConnectionRecord;
  c.token_hash = hashToken(newAccessToken);
  c.last_used_at = Date.now();
  writeFileSync(p, JSON.stringify(c), { mode: 0o600 });
  return true;
}

export function revoke(id: string): void {
  const p = pathFor(id);
  if (existsSync(p)) unlinkSync(p);
}

// ── OAuth client + auth-code state ──────────────────────────────────────
//
// We allow Dynamic Client Registration (Claude.ai's MCP connector creates
// clients on the fly). Auth codes are short-lived, single-use, in-memory.

export interface OauthClient {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  created_at: number;
}
const clientsFile = () => join(STORE_DIR, "_clients.json");

export function registerClient(args: { client_name: string; redirect_uris: string[] }): OauthClient {
  ensureDir();
  const all = readClients();
  const client_id = randomBytes(12).toString("base64url");
  const c: OauthClient = {
    client_id,
    client_name: args.client_name || client_id,
    redirect_uris: args.redirect_uris,
    created_at: Date.now(),
  };
  all.push(c);
  writeFileSync(clientsFile(), JSON.stringify(all), { mode: 0o600 });
  return c;
}

export function readClients(): OauthClient[] {
  ensureDir();
  if (!existsSync(clientsFile())) return [];
  try { return JSON.parse(readFileSync(clientsFile(), "utf8")) as OauthClient[]; }
  catch { return []; }
}

export function findClient(client_id: string): OauthClient | null {
  return readClients().find((c) => c.client_id === client_id) ?? null;
}

interface AuthCode {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scopes: string[];
  code_challenge?: string;
  code_challenge_method?: string;
  expires_at: number;
}
const authCodes = new Map<string, AuthCode>();

export function issueAuthCode(args: Omit<AuthCode, "code" | "expires_at">): string {
  const code = randomBytes(24).toString("base64url");
  authCodes.set(code, { ...args, code, expires_at: Date.now() + 5 * 60_000 });
  return code;
}

export function consumeAuthCode(code: string): AuthCode | null {
  const c = authCodes.get(code);
  if (!c) return null;
  authCodes.delete(code);
  if (c.expires_at < Date.now()) return null;
  return c;
}

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
  /**
   * Identity snapshot taken at consent time, served by `/oauth/userinfo`.
   * Only present for connections that were granted `openid`.
   */
  claims?: IdentityClaims;
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
  claims?: IdentityClaims;
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
    claims: args.claims,
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
  /**
   * Only set for clients configured by the operator (see `staticClients`).
   * Dynamically registered clients are public and authenticate via PKCE.
   */
  client_secret_hash?: string;
  /** Scopes this client may request; undefined = any known scope. */
  allowed_scopes?: string[];
  /** Operator-vouched first-party app: consent is granted without a prompt. */
  trusted?: boolean;
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

/**
 * Clients the operator configures in `OPENSAX_OAUTH_CLIENTS`, e.g. an app that
 * signs its users in through OpenSax. JSON array of
 * `{client_id, client_secret, client_name, redirect_uris, scopes?, trusted?}`.
 *
 * They live in the environment rather than `_clients.json` so that a
 * confidential client can't be minted through `/oauth/register`: anyone may
 * register a client named "LessionSummary", only the operator can give one a
 * secret and skip the consent screen.
 */
const staticClients: OauthClient[] = (() => {
  const raw = process.env.OPENSAX_OAUTH_CLIENTS;
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as Array<{
      client_id: string; client_secret: string; client_name?: string;
      redirect_uris: string[]; scopes?: string[]; trusted?: boolean;
    }>;
    return list
      .filter((c) => c.client_id && c.client_secret && Array.isArray(c.redirect_uris))
      .map((c) => ({
        client_id: c.client_id,
        client_name: c.client_name ?? c.client_id,
        redirect_uris: c.redirect_uris,
        created_at: 0,
        client_secret_hash: hashToken(c.client_secret),
        allowed_scopes: c.scopes,
        trusted: c.trusted === true,
      }));
  } catch (err) {
    console.error("[oauth] OPENSAX_OAUTH_CLIENTS is not valid JSON — ignoring", err);
    return [];
  }
})();

export function findClient(client_id: string): OauthClient | null {
  return staticClients.find((c) => c.client_id === client_id)
    ?? readClients().find((c) => c.client_id === client_id)
    ?? null;
}

/** Confidential clients must present their secret; public ones must not rely on one. */
export function verifyClientSecret(client: OauthClient, secret: string | undefined): boolean {
  if (!client.client_secret_hash) return true;
  if (!secret) return false;
  const a = Buffer.from(client.client_secret_hash, "hex");
  const b = Buffer.from(hashToken(secret), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Scopes ──────────────────────────────────────────────────────────────
//
// `lernsax` is full account access (the MCP connector). The OIDC-style scopes
// only reveal who the user is — an app that merely wants "Login with OpenSax"
// must never end up holding a token the MCP server accepts.

export const KNOWN_SCOPES = ["lernsax", "openid", "profile", "email", "school"] as const;

/**
 * Validate a requested scope string against what the client may ask for.
 * Returns the granted list, or null if anything unknown or disallowed was
 * requested. No scope at all keeps the historical default of `lernsax`, which
 * is what the Claude connector relies on.
 */
export function resolveScopes(client: OauthClient, requested: string | undefined): string[] | null {
  const asked = (requested ?? "").split(/\s+/).filter(Boolean);
  const scopes = asked.length ? [...new Set(asked)] : (client.allowed_scopes ?? ["lernsax"]);
  for (const s of scopes) {
    if (!(KNOWN_SCOPES as readonly string[]).includes(s)) return null;
    if (client.allowed_scopes && !client.allowed_scopes.includes(s)) return null;
  }
  return scopes;
}

export interface IdentityClaims {
  /** Same `user_id` the rest of OpenSax uses (SHA-256 of the email, truncated). */
  sub: string;
  name?: string;
  email?: string;
  /** LernSax institutions (group type 16) the user belongs to. */
  schools?: Array<{ id: string; name: string }>;
  /** Classes (group type 19). */
  classes?: Array<{ id: string; name: string }>;
}

interface AuthCode {
  code: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scopes: string[];
  code_challenge?: string;
  code_challenge_method?: string;
  claims?: IdentityClaims;
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

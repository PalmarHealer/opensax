import { LernSaxClient, type ClientOptions } from "./client.js";
import { credentialKey, type Credentials } from "./session.js";

interface CacheEntry {
  client: LernSaxClient;
  lastTouched: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface SessionCacheOptions extends ClientOptions {
  /** idle TTL in ms before a cached session is logged out & evicted */
  idleTtlMs?: number;
}

/**
 * Keep-alive pool of LernSaxClient instances keyed by SHA-256(email+password).
 * Used by the MCP server so that consecutive tool calls reuse one session.
 */
export class SessionCache {
  private readonly idleTtlMs: number;
  private readonly opts: ClientOptions;
  private readonly entries = new Map<string, CacheEntry>();

  constructor(opts: SessionCacheOptions = {}) {
    const { idleTtlMs, ...rest } = opts;
    this.idleTtlMs = idleTtlMs ?? 5 * 60_000;
    this.opts = rest;
  }

  async get(creds: Credentials): Promise<LernSaxClient> {
    const key = await credentialKey(creds);
    let entry = this.entries.get(key);
    if (!entry) {
      const client = new LernSaxClient(creds, this.opts);
      await client.login();
      entry = { client, lastTouched: Date.now(), timer: null };
      this.entries.set(key, entry);
    } else {
      entry.lastTouched = Date.now();
    }
    this.scheduleEviction(key, entry);
    return entry.client;
  }

  private scheduleEviction(key: string, entry: CacheEntry) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      const current = this.entries.get(key);
      if (!current) return;
      const idle = Date.now() - current.lastTouched;
      if (idle >= this.idleTtlMs) {
        this.entries.delete(key);
        current.client.logout().catch(() => {});
      } else {
        this.scheduleEviction(key, current);
      }
    }, this.idleTtlMs);
  }

  async drain(): Promise<void> {
    const all = [...this.entries.values()];
    this.entries.clear();
    await Promise.allSettled(all.map((e) => {
      if (e.timer) clearTimeout(e.timer);
      return e.client.logout();
    }));
  }
}

import { JsonRpcTransport, type JsonRpcCall, type TransportOptions } from "./transport.js";
import { LernSaxAuthError, LernSaxError } from "./errors.js";

export interface Credentials {
  email: string;
  password: string;
}

export interface SessionOptions extends TransportOptions {
  /** seconds without activity before we proactively reload */
  reloadAfterIdleSec?: number;
  /** application identifier sent on login */
  application?: string;
}

export interface MemberOf {
  login: string;
  name_hr?: string;
  /** numeric type code from the API */
  type?: number | string;
  base_rights?: string[];
  member_rights?: string[];
  effective_rights?: string[];
  is_pinned?: number;
  [k: string]: unknown;
}

/**
 * Whether the user has the named right inside this group.
 * `effective_rights` reflects what the API will actually let them do (intersection
 * of base+member rights). `right` can be e.g. "tasks", "files_write", "board".
 */
export function groupHasRight(g: MemberOf | undefined, right: string): boolean {
  if (!g) return false;
  return Array.isArray(g.effective_rights) && g.effective_rights.includes(right);
}

export interface UserInfo {
  login?: string;
  email?: string;
  /** Email-style identifier the server echoes (often equal to login). */
  name_hr?: string;
  /** Real name ("Vorname Nachname"). Prefer this for display. */
  fullname?: string;
  type?: number;
  uid?: string;
  base_user?: { login: string; name_hr?: string; type?: number };
  base_rights?: string[];
  effective_rights?: string[];
  member_of?: MemberOf[];
  [k: string]: unknown;
}

/** Best display label for a user — fullname → name_hr → email/login. */
export function userDisplay(u: UserInfo | null | undefined): string {
  if (!u) return "";
  return u.fullname || u.name_hr || u.email || u.login || "";
}

export type FocusObject =
  | "trusts"
  | "settings"
  | "messages"
  | "mailbox"
  | "tasks"
  | "calendar"
  | "board"
  | "board_teacher"
  | "board_pupil"
  | "notes"
  | "messenger"
  | "members"
  | "files"
  | "profile"
  | "addresses"
  | "forum"
  | "wiki"
  | "resource_management"
  | "repository"
  | "courselets"
  | "licenses"
  | "session_files"
  | "administration.group"
  | "administration.user"
  | "administration.root"
  | "member";

export interface FocusSpec {
  object: FocusObject;
  /** group/room login (email-style); undefined = personal scope */
  login?: string;
  /** for resource_management etc. */
  context?: Record<string, unknown>;
}

/**
 * Persistent LernSax session. Wraps login, set_focus, automatic re-login,
 * and provides ergonomic .call() / .batch() entry points used by the API namespaces.
 *
 * NOT exported as a singleton — both the MCP session cache and the web BFF
 * instantiate this per credential pair.
 */
export class LernSaxSession {
  readonly transport: JsonRpcTransport;
  private readonly credentials: Credentials;
  private readonly application: string;
  private readonly reloadAfterIdleSec: number;

  private sessionId: string | null = null;
  private lastActivity = 0;
  private user: UserInfo | null = null;
  private memberOf: MemberOf[] = [];
  private loginInFlight: Promise<void> | null = null;

  constructor(credentials: Credentials, opts: SessionOptions = {}) {
    this.credentials = credentials;
    this.transport = new JsonRpcTransport(opts);
    this.application = opts.application ?? "opensax";
    this.reloadAfterIdleSec = opts.reloadAfterIdleSec ?? 240;
  }

  get isLoggedIn(): boolean {
    return this.sessionId !== null;
  }

  get whoami(): UserInfo | null {
    return this.user;
  }

  get groups(): MemberOf[] {
    return this.memberOf;
  }

  async ensureSession(): Promise<void> {
    if (!this.sessionId) {
      await this.login();
      return;
    }
    const idle = (Date.now() - this.lastActivity) / 1000;
    if (idle > this.reloadAfterIdleSec) {
      try {
        await this.reload();
      } catch {
        // Reload only fails for session-state reasons (expired, tampered,
        // server lost it, etc). Fall back to a fresh login regardless of the
        // error label — LernSax is loose about which marker it returns.
        this.sessionId = null;
        await this.login();
      }
    }
  }

  private async login(): Promise<void> {
    if (this.loginInFlight) {
      await this.loginInFlight;
      return;
    }
    this.loginInFlight = this._doLogin().finally(() => {
      this.loginInFlight = null;
    });
    await this.loginInFlight;
  }

  private async _doLogin(): Promise<void> {
    // The LernSax API returns user/member info from `login` itself, and the
    // session_id from a chained `get_information` call.
    const [loginRet, infoRet] = await this.transport.batchOk([
      {
        method: "login",
        params: {
          login: this.credentials.email,
          password: this.credentials.password,
          get_miniature: false,
          application: this.application,
        },
      },
      { method: "get_information", params: {} },
    ]);
    const sid = infoRet?.session_id as string | undefined;
    if (!sid) {
      throw new LernSaxError("login: no session_id from get_information", 0, "login", infoRet);
    }
    const user = loginRet?.user as UserInfo | undefined;
    const member = loginRet?.member as MemberOf[] | undefined;
    this.sessionId = sid;
    this.user = user ?? null;
    this.memberOf = Array.isArray(member) ? member : [];
    this.lastActivity = Date.now();
  }

  private async reload(): Promise<void> {
    if (!this.sessionId) throw new LernSaxAuthError("no session", 999);
    await this.transport.batchOk([
      { method: "set_session", params: { session_id: this.sessionId } },
      { method: "reload", params: {} },
    ]);
    this.lastActivity = Date.now();
  }

  /**
   * Run a batch with set_session prepended and (optionally) a set_focus before
   * the actual calls. Auto-retries once on session expiry.
   *
   * Returns the results of the user-supplied calls only (set_session/set_focus stripped).
   */
  async run(calls: JsonRpcCall[], focus?: FocusSpec): Promise<Array<Record<string, unknown>>> {
    await this.ensureSession();
    return this._runOnce(calls, focus).catch(async (err) => {
      if (err instanceof LernSaxAuthError) {
        this.sessionId = null;
        await this.login();
        return this._runOnce(calls, focus);
      }
      throw err;
    });
  }

  private async _runOnce(
    calls: JsonRpcCall[],
    focus?: FocusSpec,
  ): Promise<Array<Record<string, unknown>>> {
    const prefix: JsonRpcCall[] = [
      { method: "set_session", params: { session_id: this.sessionId! } },
    ];
    if (focus) {
      const params: Record<string, unknown> = { object: focus.object };
      if (focus.login) params.login = focus.login;
      if (focus.context) Object.assign(params, focus.context);
      prefix.push({ method: "set_focus", params });
    }
    const all = [...prefix, ...calls];
    const results = await this.transport.batchOk(all);
    this.lastActivity = Date.now();
    return results.slice(prefix.length);
  }

  async call(
    method: string,
    params: Record<string, unknown> = {},
    focus?: FocusSpec,
  ): Promise<Record<string, unknown>> {
    const [r] = await this.run([{ method, params }], focus);
    return r ?? {};
  }

  async logout(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await this.transport.batchOk([
        { method: "set_session", params: { session_id: this.sessionId } },
        { method: "logout", params: {} },
      ]);
    } catch {
      // best-effort
    }
    this.sessionId = null;
    this.user = null;
    this.memberOf = [];
  }

  /**
   * Resolve a group identifier to its login (email). Accepts either an exact
   * login (contains @) or a fuzzy/exact name match against member_of.
   */
  resolveGroup(identifier: string | undefined | null): string | undefined {
    if (!identifier) return undefined;
    if (identifier.includes("@")) return identifier;
    const lower = identifier.toLowerCase();
    const exact = this.memberOf.find((g) => g.name_hr?.toLowerCase() === lower);
    if (exact) return exact.login;
    const partial = this.memberOf.find((g) =>
      (g.name_hr ?? "").toLowerCase().includes(lower),
    );
    return partial?.login;
  }
}

/**
 * Stable hash for a credential pair, used as a session-cache key.
 * Not for secrecy — just identity.
 */
export async function credentialKey(creds: Credentials): Promise<string> {
  const data = new TextEncoder().encode(`${creds.email.toLowerCase()}\x00${creds.password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

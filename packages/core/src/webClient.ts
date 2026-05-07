import type { Credentials } from "./session.js";
import { LernSaxError } from "./errors.js";

export const DEFAULT_WEB_BASE = "https://www.lernsax.de";

export interface WebSessionState {
  sid: string;
  cookies: string;
}

export interface WebClientOptions {
  base?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Companion client for the LernSax PHP web (NOT the JSON-RPC API).
 *
 * The OnlyOffice editor lives behind a regular PHP-session-protected URL
 * that's distinct from the JSON-RPC session. We replicate the browser
 * login flow server-side so we can stage authenticated requests without
 * exposing user credentials to the browser.
 */
export class LernSaxWebClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private session: WebSessionState | null = null;
  private loginInFlight: Promise<WebSessionState> | null = null;

  constructor(private readonly credentials: Credentials, opts: WebClientOptions = {}) {
    this.base = (opts.base ?? DEFAULT_WEB_BASE).replace(/\/+$/, "");
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  /** Returns a logged-in web session, performing the login flow on first call. */
  async ensure(): Promise<WebSessionState> {
    if (this.session) return this.session;
    if (this.loginInFlight) return this.loginInFlight;
    this.loginInFlight = this._login().finally(() => {
      this.loginInFlight = null;
    });
    return this.loginInFlight;
  }

  private async _login(): Promise<WebSessionState> {
    // 1. GET the login page to capture the form's sid and any cookies.
    const r1 = await this.fetchImpl(`${this.base}/wws/100001.php`, {
      method: "GET",
      headers: { "user-agent": "opensax/0.1" },
      redirect: "manual",
    });
    const html = await r1.text();
    const cookies = collectCookies(r1, "");

    const formMatch = /<form[^>]*action="([^"]*\/wws\/100001\.php\?sid=[^"]+)"/i.exec(html);
    const rawAction = formMatch?.[1];
    if (!rawAction) throw new LernSaxError("web login: no form action found", 0, "web_login");
    const actionUrl = rawAction.startsWith("http") ? rawAction : new URL(rawAction, this.base).toString();

    // 2. POST credentials.
    const body = new URLSearchParams({
      login_nojs: "",
      login_login: this.credentials.email,
      login_password: this.credentials.password,
      login_submit: "Anmelden",
      language: "2",
    });
    const r2 = await this.fetchImpl(actionUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "opensax/0.1",
        cookie: cookies,
        referer: `${this.base}/wws/100001.php`,
        origin: this.base,
      },
      body,
      redirect: "manual",
    });
    if (r2.status !== 302) {
      throw new LernSaxError(`web login: expected 302, got ${r2.status}`, 0, "web_login");
    }
    const location = r2.headers.get("location") ?? "";
    if (!/redirect_after_login=1/.test(location)) {
      throw new LernSaxError("web login: redirect did not signal success", 0, "web_login");
    }
    const sidMatch = /[?&]sid=([^&]+)/.exec(location);
    if (!sidMatch) throw new LernSaxError("web login: no sid in location", 0, "web_login");

    const merged = collectCookies(r2, cookies);
    const state: WebSessionState = { sid: sidMatch[1]!, cookies: merged };
    this.session = state;
    return state;
  }

  /** Build the OnlyOffice wrapper URL for a given file path id. */
  editorUrl(fileId: string, mode: "edit" | "read" = "edit"): string {
    if (!this.session) throw new Error("call ensure() first");
    const params = new URLSearchParams({ path: fileId, mode, sid: this.session.sid, enableautogrow: "1" });
    return `${this.base}/wws/750329.php?${params.toString()}`;
  }

  /** Fetch the editor wrapper HTML server-side. Caller is responsible for
   * relaying it to the browser with appropriate response headers. */
  async fetchEditor(fileId: string, mode: "edit" | "read" = "edit"): Promise<{ status: number; html: string; contentType: string | null }> {
    const state = await this.ensure();
    const url = this.editorUrl(fileId, mode);
    const res = await this.fetchImpl(url, {
      headers: {
        "user-agent": "opensax/0.1",
        cookie: state.cookies,
        referer: `${this.base}/wws/109672.php`,
      },
    });
    const html = await res.text();
    return { status: res.status, html, contentType: res.headers.get("content-type") };
  }
}

/** Merge Set-Cookie response headers with an existing cookie jar string. */
function collectCookies(res: Response, existing: string): string {
  // Node fetch exposes set-cookie as raw via getSetCookie(); fall back to comma-split header.
  const raw: string[] = [];
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    for (const c of anyHeaders.getSetCookie()) raw.push(c);
  } else {
    const sc = res.headers.get("set-cookie");
    if (sc) raw.push(sc);
  }
  const jar = new Map<string, string>();
  for (const piece of existing.split(/;\s*/).filter(Boolean)) {
    const eq = piece.indexOf("=");
    if (eq <= 0) continue;
    jar.set(piece.slice(0, eq), piece.slice(eq + 1));
  }
  for (const sc of raw) {
    const first = sc.split(";", 1)[0]!;
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    jar.set(first.slice(0, eq), first.slice(eq + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

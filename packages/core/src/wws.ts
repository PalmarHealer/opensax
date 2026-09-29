import { LernSaxError } from "./errors.js";
import type { LernSaxSession } from "./session.js";

export const WWS_BASE = "https://www.lernsax.de/wws/";

/**
 * Zugriff auf die PHP-Oberfläche von LernSax („wws“) für das, was die
 * JSON-RPC-API nicht kann — etwa Forenbeiträge überarbeiten.
 *
 * Angemeldet wird über `get_url_for_autologin` aus der bestehenden
 * RPC-Session, nicht über das Login-Formular: kein Passwort, keine
 * Abhängigkeit vom Aufbau der Startseite.
 *
 * Zwei Eigenheiten der Oberfläche bestimmen, wie hier navigiert wird:
 *
 * - Die `sid` trägt hinter einem `S` eine Signatur, die nur für genau die Seite
 *   gilt, zu der der Link gehört. Wer sie an eine andere Seite hängt, fliegt
 *   mit „Session tampered.“ raus. Ohne Signatur nimmt der Server die `sid`
 *   dagegen für einfache Seiten an.
 * - Die `sid` kodiert auch den Raum (Klasse/Gruppe), in dem man sich gerade
 *   befindet. In einen Raum kommt man also nur über dessen Link.
 *
 * Popups und Formulare verlangen die signierte Fassung — die holen wir uns
 * deshalb immer aus dem HTML der vorherigen Seite, statt URLs zu bauen.
 */
export class WwsSession {
  private constructor(
    private readonly fetchImpl: typeof fetch,
    /** unsignierte sid, persönlicher Bereich */
    private readonly sid: string,
    private cookies: string,
  ) {}

  static async open(rpc: LernSaxSession, fetchImpl: typeof fetch = globalThis.fetch): Promise<WwsSession> {
    const r = await rpc.call("get_url_for_autologin", {}, { object: "trusts" });
    const url = typeof r.url === "string" ? r.url : "";
    if (!url) throw new LernSaxError("wws: keine Autologin-URL erhalten", 0, "get_url_for_autologin");
    return WwsSession.fromAutologinUrl(url, fetchImpl);
  }

  static async fromAutologinUrl(url: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<WwsSession> {
    const res = await fetchImpl(url, { redirect: "manual", headers: { "user-agent": "opensax/0.1" } });
    // Ziel steht im Fragment: 9.php#100001.php?sid=… (Frame-Hülle + Startseite).
    const location = res.headers.get("location") ?? "";
    const start = /#(.+\?sid=[0-9A-Za-z]+.*)$/.exec(location)?.[1];
    const sid = start && /[?&]sid=([0-9]+)/.exec(start)?.[1];
    if (!start || !sid) throw new LernSaxError("wws: Autologin fehlgeschlagen", res.status, "autologin");
    const wws = new WwsSession(fetchImpl, sid, mergeCookies("", res));
    // Erst die (signierte) Startseite setzt das Session-Cookie `wwsc`; ohne
    // sie landet jede weitere Seite auf dem Login.
    await wws.get(start);
    return wws;
  }

  /** GET einer Seite relativ zu /wws/; `path` darf schon eine sid tragen. */
  async get(path: string): Promise<string> {
    const res = await this.fetchImpl(this.url(path), { headers: this.headers() });
    this.cookies = mergeCookies(this.cookies, res);
    return this.text(res);
  }

  async post(path: string, body: URLSearchParams): Promise<string> {
    const res = await this.fetchImpl(this.url(path), {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/x-www-form-urlencoded" },
      body: encodeLatin1Form(body),
    });
    this.cookies = mergeCookies(this.cookies, res);
    return this.text(res);
  }

  /**
   * Raum betreten und dessen unsignierte sid liefern. Die Übersichten „Meine
   * Klassen“ (1259) und „Meine Gruppen“ (1257) verlinken jeden Raum signiert;
   * erst nach dem Aufruf dieses Links akzeptiert der Server die Raum-sid auch
   * ohne Signatur — vorher antwortet er mit der Login-Seite.
   */
  async enterRoom(roomName: string): Promise<string> {
    // Die Seiten mischen Latin-1 und UTF-8; der Name kann in beiden Formen stehen.
    const wanted = new Set([normalize(roomName), normalize(asUtf8Bytes(roomName))]);
    for (const page of ["1259.php", "1257.php"]) {
      const html = await this.get(`${page}?sid=${this.sid}`);
      const rowRe = /data-document="([^"]*100013\.php[^"]*)"([\s\S]*?)(?=data-document=|$)/g;
      for (const m of html.matchAll(rowRe)) {
        const name = /class="c_fullname[^"]*"[^>]*>([^<]*)</.exec(m[2]!)?.[1];
        if (name === undefined || !wanted.has(normalize(decodeEntities(name)))) continue;
        const link = decodeEntities(m[1]!);
        const sid = /[?&]sid=([0-9]+)/.exec(link)?.[1];
        if (!sid) continue;
        await this.get(link);
        return sid;
      }
    }
    throw new LernSaxError(`wws: Raum „${roomName}“ nicht gefunden`, 0, "wws_room");
  }

  private url(path: string): string {
    return path.startsWith("http") ? path : new URL(path.replace(/^\/?(wws\/)?/, ""), WWS_BASE).toString();
  }

  private headers(): Record<string, string> {
    return { "user-agent": "opensax/0.1", cookie: this.cookies };
  }

  private async text(res: Response): Promise<string> {
    // Deklariert ist ISO-8859-1, tatsächlich stehen auch UTF-8-Fragmente drin.
    // Byte-genau als Latin-1 lesen: die Struktur (Tags, sids, Formularfelder)
    // ist ASCII und bleibt so unversehrt, und nichts wird still ersetzt.
    const html = new TextDecoder("latin1").decode(await res.arrayBuffer());
    if (html.includes("Session tampered")) {
      throw new LernSaxError("wws: Sitzung abgelehnt (Session tampered)", res.status, "wws");
    }
    return html;
  }
}

/** Ziel einer serverseitigen Weiterleitung (`<!-- WWS-Redirection: … -->`). */
export function wwsRedirect(html: string): string | undefined {
  const m = /WWS-Redirection:\s*(\S+)/.exec(html);
  return m ? decodeEntities(m[1]!) : undefined;
}

export interface HtmlForm {
  action: string;
  /** alle Felder, die ein Browser ohne Klick auf einen Button mitschicken würde */
  fields: [string, string][];
}

/** Erstes `<form>` einer Seite, mit Feldern wie ein Browser sie absenden würde. */
export function firstForm(html: string): HtmlForm | undefined {
  const m = /<form\b([^>]*)>([\s\S]*?)<\/form>/i.exec(html);
  if (!m) return undefined;
  const action = attr(m[1]!, "action");
  if (!action) return undefined;
  const body = m[2]!;
  const fields: [string, string][] = [];
  for (const tag of body.matchAll(/<input\b([^>]*)>/gi)) {
    const a = tag[1]!;
    const name = attr(a, "name");
    const type = (attr(a, "type") ?? "text").toLowerCase();
    if (!name || type === "submit" || type === "button" || type === "file" || type === "image") continue;
    if ((type === "radio" || type === "checkbox") && !/\bchecked\b/i.test(a)) continue;
    fields.push([name, attr(a, "value") ?? (type === "checkbox" ? "on" : "")]);
  }
  for (const tag of body.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
    const name = attr(tag[1]!, "name");
    if (name) fields.push([name, decodeEntities(tag[2]!)]);
  }
  return { action, fields };
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(attrs);
  if (!m) return undefined;
  return decodeEntities(m[1] ?? m[2] ?? m[3] ?? "");
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

/**
 * Formular so kodieren, wie ein Browser es auf einer ISO-8859-1-Seite täte:
 * Zeichen bis U+00FF als Latin-1-Byte, alles darüber (€, Emoji, …) als
 * numerische HTML-Entität. UTF-8 würde LernSax als Latin-1 lesen („Ã¤“).
 */
export function encodeLatin1Form(body: URLSearchParams): string {
  const enc = (s: string): string => {
    let out = "";
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (cp > 0xff) {
        out += encodeURIComponent(`&#${cp};`);
      } else if (/[A-Za-z0-9*\-._]/.test(ch)) {
        out += ch;
      } else if (ch === " ") {
        out += "+";
      } else {
        out += `%${cp.toString(16).toUpperCase().padStart(2, "0")}`;
      }
    }
    return out;
  };
  return [...body].map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");
}

/** UTF-8-Bytes eines Strings als Latin-1-Zeichen — so, wie sie in der Seite stehen. */
function asUtf8Bytes(s: string): string {
  return String.fromCharCode(...new TextEncoder().encode(s));
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function mergeCookies(existing: string, res: Response): string {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  const raw = typeof h.getSetCookie === "function" ? h.getSetCookie() : [res.headers.get("set-cookie") ?? ""];
  const jar = new Map<string, string>();
  for (const piece of existing.split(/;\s*/)) {
    const eq = piece.indexOf("=");
    if (eq > 0) jar.set(piece.slice(0, eq), piece.slice(eq + 1));
  }
  for (const sc of raw) {
    const first = sc.split(";", 1)[0] ?? "";
    const eq = first.indexOf("=");
    if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

import type { Credentials } from "./session.js";
import { LernSaxTransportError } from "./errors.js";

export const DEFAULT_WEBDAV_URL = "https://www.lernsax.de/webdav.php/";

export interface WebDavOptions {
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

export interface WebDavEntry {
  href: string;
  name: string;
  isCollection: boolean;
  size?: number;
  lastModified?: string;
  contentType?: string;
}

/**
 * Minimal WebDAV client for LernSax. Auth is HTTP Basic with email+password.
 * Used for file operations larger than what the JSON-RPC `files.add_file` path handles cleanly.
 */
export class WebDavClient {
  private readonly endpoint: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;

  constructor(creds: Credentials, opts: WebDavOptions = {}) {
    this.endpoint = (opts.endpoint ?? DEFAULT_WEBDAV_URL).replace(/\/+$/, "/");
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const token = btoa(`${creds.email}:${creds.password}`);
    this.authHeader = `Basic ${token}`;
  }

  private url(path: string): string {
    const clean = path.replace(/^\/+/, "");
    return this.endpoint + clean;
  }

  async download(path: string): Promise<{ body: ReadableStream<Uint8Array>; contentType?: string; size?: number }> {
    const res = await this.fetchImpl(this.url(path), {
      method: "GET",
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) throw new LernSaxTransportError(`WebDAV GET ${path}: ${res.status}`);
    if (!res.body) throw new LernSaxTransportError("WebDAV GET: empty body");
    const len = res.headers.get("content-length");
    return {
      body: res.body,
      contentType: res.headers.get("content-type") ?? undefined,
      size: len ? Number.parseInt(len, 10) : undefined,
    };
  }

  async downloadBuffer(path: string): Promise<Uint8Array> {
    const res = await this.fetchImpl(this.url(path), {
      method: "GET",
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok) throw new LernSaxTransportError(`WebDAV GET ${path}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async upload(path: string, body: Uint8Array | Blob | ReadableStream<Uint8Array>, contentType = "application/octet-stream"): Promise<void> {
    const res = await this.fetchImpl(this.url(path), {
      method: "PUT",
      headers: { Authorization: this.authHeader, "Content-Type": contentType },
      body: body as BodyInit,
      // @ts-expect-error duplex required for streamed bodies in Node
      duplex: "half",
    });
    if (!res.ok) throw new LernSaxTransportError(`WebDAV PUT ${path}: ${res.status}`);
  }

  async mkcol(path: string): Promise<void> {
    const res = await this.fetchImpl(this.url(path), {
      method: "MKCOL",
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok && res.status !== 405) {
      throw new LernSaxTransportError(`WebDAV MKCOL ${path}: ${res.status}`);
    }
  }

  async remove(path: string): Promise<void> {
    const res = await this.fetchImpl(this.url(path), {
      method: "DELETE",
      headers: { Authorization: this.authHeader },
    });
    if (!res.ok && res.status !== 404) {
      throw new LernSaxTransportError(`WebDAV DELETE ${path}: ${res.status}`);
    }
  }

  async move(from: string, to: string, overwrite = false): Promise<void> {
    const res = await this.fetchImpl(this.url(from), {
      method: "MOVE",
      headers: {
        Authorization: this.authHeader,
        Destination: this.url(to),
        Overwrite: overwrite ? "T" : "F",
      },
    });
    if (!res.ok) throw new LernSaxTransportError(`WebDAV MOVE: ${res.status}`);
  }

  async copy(from: string, to: string, overwrite = false): Promise<void> {
    const res = await this.fetchImpl(this.url(from), {
      method: "COPY",
      headers: {
        Authorization: this.authHeader,
        Destination: this.url(to),
        Overwrite: overwrite ? "T" : "F",
      },
    });
    if (!res.ok) throw new LernSaxTransportError(`WebDAV COPY: ${res.status}`);
  }

  async list(path: string): Promise<WebDavEntry[]> {
    const res = await this.fetchImpl(this.url(path), {
      method: "PROPFIND",
      headers: { Authorization: this.authHeader, Depth: "1", "Content-Type": "application/xml" },
      body: `<?xml version="1.0" encoding="utf-8"?>
<propfind xmlns="DAV:"><allprop/></propfind>`,
    });
    if (!res.ok) throw new LernSaxTransportError(`WebDAV PROPFIND ${path}: ${res.status}`);
    const xml = await res.text();
    return parsePropfind(xml);
  }
}

function parsePropfind(xml: string): WebDavEntry[] {
  // Lightweight XML extraction — no dependency on a full parser.
  const responses = xml.match(/<(?:\w+:)?response[^]*?<\/(?:\w+:)?response>/gi) ?? [];
  return responses.map((block) => {
    const href = decodeURIComponent(/<(?:\w+:)?href>([^]*?)<\/(?:\w+:)?href>/i.exec(block)?.[1] ?? "");
    const isCollection = /<(?:\w+:)?resourcetype>[^]*?<(?:\w+:)?collection\s*\/>[^]*?<\/(?:\w+:)?resourcetype>/i.test(block);
    const size = Number.parseInt(/<(?:\w+:)?getcontentlength>(\d+)<\/(?:\w+:)?getcontentlength>/i.exec(block)?.[1] ?? "", 10);
    const lastModified = /<(?:\w+:)?getlastmodified>([^]*?)<\/(?:\w+:)?getlastmodified>/i.exec(block)?.[1];
    const contentType = /<(?:\w+:)?getcontenttype>([^]*?)<\/(?:\w+:)?getcontenttype>/i.exec(block)?.[1];
    const name = decodeURIComponent(href.replace(/\/$/, "").split("/").pop() ?? "");
    return {
      href,
      name,
      isCollection,
      size: Number.isFinite(size) ? size : undefined,
      lastModified,
      contentType,
    };
  });
}

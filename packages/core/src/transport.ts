import {
  LernSaxAuthError,
  LernSaxError,
  LernSaxTransportError,
} from "./errors.js";

export interface JsonRpcCall {
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponseEntry {
  jsonrpc: "2.0";
  id: number | null;
  result?: {
    method?: string;
    /** "OK" on success, otherwise an error string. */
    return?: string;
    debug?: unknown;
    [k: string]: unknown;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface TransportOptions {
  endpoint?: string;
  userAgent?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const DEFAULT_ENDPOINT = "https://www.lernsax.de/jsonrpc.php";
export const DEFAULT_USER_AGENT = "opensax/0.1";

const SESSION_EXPIRED_MARKERS = [
  /session.*expired/i,
  /not.*logged.*in/i,
  /invalid.*session/i,
  /^fatal$/i,           // bare "FATAL" — what LernSax returns when reload hits an expired session
  /session tampered/i,  // per-URL hash mismatch; treat as auth so caller re-logs in
];

export class JsonRpcTransport {
  private readonly endpoint: string;
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: TransportOptions = {}) {
    this.endpoint = opts.endpoint ?? DEFAULT_ENDPOINT;
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async batch(calls: JsonRpcCall[]): Promise<JsonRpcResponseEntry[]> {
    if (calls.length === 0) return [];
    const payload = calls.map((c, i) => ({
      jsonrpc: "2.0" as const,
      id: i + 1,
      method: c.method,
      params: c.params ?? {},
    }));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": this.userAgent,
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } catch (err) {
      throw new LernSaxTransportError(`Transport failure: ${(err as Error).message}`, err);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw new LernSaxTransportError(`HTTP ${res.status} ${res.statusText}`);

    const body = (await res.json()) as JsonRpcResponseEntry | JsonRpcResponseEntry[];
    return Array.isArray(body) ? body : [body];
  }

  /**
   * Run a batch and validate every entry. Returns the `result` object of each
   * call (with `method`, `return`, `debug` boilerplate stripped) in input order.
   */
  async batchOk(calls: JsonRpcCall[]): Promise<Array<Record<string, unknown>>> {
    const responses = await this.batch(calls);
    // Some upstream errors come back as a single object with id:null.
    const lookup = new Map<number, JsonRpcResponseEntry>();
    let bareError: JsonRpcResponseEntry | null = null;
    for (const e of responses) {
      if (e.id == null) bareError = e;
      else lookup.set(e.id, e);
    }
    return calls.map((call, idx) => {
      const id = idx + 1;
      const entry = lookup.get(id) ?? bareError;
      if (!entry) throw new LernSaxError(`No response for id ${id}`, 0, call.method);
      if (entry.error) {
        const msg = entry.error.message;
        if (SESSION_EXPIRED_MARKERS.some((re) => re.test(msg))) {
          throw new LernSaxAuthError(msg, entry.error.code, call.method, entry);
        }
        throw new LernSaxError(msg, entry.error.code, call.method, entry);
      }
      const result = entry.result ?? {};
      // Some methods (e.g. get_information) omit `return` entirely on success.
      // Treat: missing -> ok; "OK" -> ok; anything else -> error.
      if (typeof result.return === "string" && result.return !== "OK") {
        const ret = result.return;
        if (SESSION_EXPIRED_MARKERS.some((re) => re.test(ret))) {
          throw new LernSaxAuthError(ret, 0, call.method, entry);
        }
        throw new LernSaxError(ret, 0, call.method, entry);
      }
      // Strip JSON-RPC + LernSax boilerplate; keep the actual data.
      const { method: _m, return: _r, debug: _d, ...data } = result;
      return data as Record<string, unknown>;
    });
  }
}

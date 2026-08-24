import { ProxyAgent } from "undici";

/**
 * Outbound LernSax relay.
 *
 * The deployment runs in Vienna, but LernSax must see requests arriving from a
 * German IP. We therefore tunnel every LernSax-bound request (JSON-RPC, WebDAV,
 * file downloads, and the OnlyOffice web-login flow) through an HTTP CONNECT
 * proxy that lives on a German egress node, reachable over Tailscale. LernSax
 * then sees that node's public IP, not the deployment's.
 *
 * `LernSaxClient` wires this in for everything it does itself; routes that hit
 * LernSax download URLs directly must opt in (see the web app's `lernsaxFetch`).
 *
 * Node's global `fetch` (undici) ignores HTTP_PROXY/HTTPS_PROXY, so the proxy
 * has to be wired in explicitly via the per-request `dispatcher`. Set
 * `LERNSAX_PROXY_URL` (e.g. `http://100.x.y.z:8888`) to enable; leave it unset
 * to talk to LernSax directly.
 */

// One ProxyAgent per process keeps a connection pool to the relay alive instead
// of opening a fresh tunnel per request. Keyed by URL so a config change is
// picked up without a restart (rare, but cheap to support) — the superseded
// agent is closed so its sockets don't leak.
let cached: { url: string; agent: ProxyAgent; fetch: typeof fetch } | null = null;

/**
 * Build a fetch that routes every request through `proxyUrl`. Returns the agent
 * alongside it so the caller can close the connection pool when done.
 */
export function createProxyFetch(proxyUrl: string): { fetch: typeof fetch; agent: ProxyAgent } {
  const agent = new ProxyAgent(proxyUrl);
  const fetchImpl = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    fetch(input, { ...init, dispatcher: agent } as RequestInit).catch((err) => {
      throw describeRelayError(err, input, proxyUrl);
    })) as typeof fetch;
  return { fetch: fetchImpl, agent };
}

/**
 * A relay that refuses a host answers the CONNECT with 403 and undici collapses
 * that into a bare `TypeError: fetch failed` — which reads like the deployment
 * has no network at all. Name the host and the relay instead: the fix is almost
 * always a missing entry in the relay's domain filter.
 */
function describeRelayError(err: unknown, input: Parameters<typeof fetch>[0], proxyUrl: string): unknown {
  if (!(err instanceof TypeError)) return err;
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const host = (() => { try { return new URL(raw).host; } catch { return raw; } })();
  const cause = (err as { cause?: { message?: string } }).cause?.message;
  const refused = cause?.includes("HTTP Tunneling") || cause?.includes("Proxy response");
  const detail = refused
    ? `der Relay ${proxyUrl} hat den CONNECT abgelehnt — steht ${host} im Domain-Filter?`
    : `Verbindung über den Relay ${proxyUrl} fehlgeschlagen${cause ? ` (${cause})` : ""}`;
  return new Error(`${host}: ${detail}`, { cause: err });
}

/**
 * Returns the relay fetch when `LERNSAX_PROXY_URL` is set, otherwise undefined
 * so callers fall back to the default global fetch.
 */
export function envProxyFetch(): typeof fetch | undefined {
  const url = process.env.LERNSAX_PROXY_URL?.trim();
  if (!url) return undefined;
  if (cached?.url === url) return cached.fetch;
  void cached?.agent.close();
  const { fetch: fetchImpl, agent } = createProxyFetch(url);
  cached = { url, agent, fetch: fetchImpl };
  return fetchImpl;
}

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
    fetch(input, { ...init, dispatcher: agent } as RequestInit)) as typeof fetch;
  return { fetch: fetchImpl, agent };
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

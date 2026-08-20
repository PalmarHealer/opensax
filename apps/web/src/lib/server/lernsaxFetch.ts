import { envProxyFetch } from "@lernsax/core";

/**
 * `fetch` for direct LernSax-bound requests made outside `LernSaxClient`.
 *
 * A few routes fetch LernSax download URLs themselves (file preview, mail
 * attachments, the OnlyOffice content endpoint) instead of going through the
 * client. Those URLs carry session-scoped tokens, so they must leave through
 * the same egress as the session that minted them — otherwise LernSax sees the
 * session established from the relay's German IP and the download attempted
 * from the deployment's, and may reject it.
 *
 * Falls back to the global fetch when `LERNSAX_PROXY_URL` is unset.
 *
 * Only for LernSax hosts: the relay's filter denies everything else. Requests
 * to OnlyOffice or other internal services must keep using the plain fetch.
 */
export function lernsaxFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return (envProxyFetch() ?? globalThis.fetch)(input, init);
}

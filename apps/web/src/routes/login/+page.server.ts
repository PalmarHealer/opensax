import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ url, request }) => {
  // Decide which security claim to show on the login form. We're "secure" if
  // we're served over HTTPS, or if we're running with NODE_ENV=production
  // behind a TLS-terminating proxy (the common Authentik/NPM/Caddy setup).
  const fwdProto = request.headers.get("x-forwarded-proto");
  const isHttps = url.protocol === "https:" || fwdProto === "https";
  const isProd = process.env.NODE_ENV === "production";
  return { secureContext: isHttps || isProd };
};

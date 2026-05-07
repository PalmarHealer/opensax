import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    csrf: {
      // The OAuth endpoints (/oauth/token, /oauth/register, /oauth/revoke) are
      // intentionally cross-origin — RFC 6749 token exchanges come from the
      // client app's server (e.g. claude.ai). They don't rely on our session
      // cookie, so CSRF protection isn't meaningful. We selectively re-check
      // origin for cookie-bearing endpoints in `hooks.server.ts`.
      checkOrigin: false,
    },
  },
};

export default config;

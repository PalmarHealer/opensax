/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from "$service-worker";

// `self` is the ServiceWorkerGlobalScope inside a service worker.
const sw = self as unknown as ServiceWorkerGlobalScope;

// A unique, version-scoped cache name so stale assets are evicted on deploy.
const CACHE = `opensax-cache-${version}`;

// App-shell assets we precache: the SvelteKit build output (immutable, hashed)
// plus everything under static/ (favicon, icons, manifest). These are safe to
// cache-first because they are content-addressed or static resources.
const PRECACHE = [...build, ...files];
const PRECACHE_SET = new Set(PRECACHE);

sw.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE);
      // Activate this SW as soon as it finishes installing.
      await sw.skipWaiting();
    })(),
  );
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous versions.
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })(),
  );
});

sw.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only ever touch GET requests; everything else (POST/PUT/DELETE…) must hit
  // the network so session/state mutations are never served from cache.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache cross-origin requests.
  if (url.origin !== sw.location.origin) return;

  // CRITICAL: never cache navigations, API, OAuth, or login responses. These
  // depend on the session cookie and must always be fresh / pass through to the
  // network. Letting the SW intercept them would risk serving another session's
  // data or a stale, logged-out shell.
  if (request.mode === "navigate") return;
  if (
    url.pathname.startsWith("/api") ||
    url.pathname.startsWith("/oauth") ||
    url.pathname.startsWith("/login")
  ) {
    return;
  }

  // Cache-first ONLY for assets we deliberately precached (hashed build output
  // and static files). Anything else is left to the browser/network.
  if (!PRECACHE_SET.has(url.pathname)) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;

      // Fallback to network (and populate the cache) if somehow missing.
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});

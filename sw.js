const CACHE_VERSION = "uniqlo-sale-shell-v12";
const DATA_CACHE = "uniqlo-sale-data-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./web/styles.css",
  "./web/app.js",
  "./web/utils.mjs",
  "./manifest.webmanifest",
  "./icons/app-icon.svg",
  "./icons/app-icon-192.png",
  "./icons/app-icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => ![CACHE_VERSION, DATA_CACHE].includes(key)).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (/\/(?:data\/(?:women\/)?(?:latest|price_history)\.json|reports\/(?:women\/)?changes\.md|(?:latest\.csv|LATEST\.md))$/.test(url.pathname)) {
    event.respondWith(networkFirst(event.request, DATA_CACHE));
    return;
  }
  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request));
    return;
  }
  const isMutableShell = /\.(?:html|css|js|mjs|webmanifest)$/.test(url.pathname);
  if (isMutableShell) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(cacheFirst(event.request));
});

async function networkFirst(request, cacheName = CACHE_VERSION) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_VERSION);
    await cache.put(request, response.clone());
  }
  return response;
}


/* Service worker.
 *
 * Deliberately conservative about what it caches. The app shell is safe to
 * serve from cache, but nothing else here is:
 *
 * - API responses change as jobs progress, and a cached "processing" status
 *   that never updates is worse than no offline support at all.
 * - Video and clips are large and range-requested; caching them would fill the
 *   user's storage quota with files they watched once.
 *
 * So: cache-first for the shell, network-only for everything else. The point is
 * installability and a fast cold start, not offline transcription, which is
 * impossible anyway since the work happens on a server with a GPU.
 */

const CACHE = "lexicon-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never touch the API, media or clips.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/media/") ||
    event.request.method !== "GET"
  ) {
    return;
  }

  // Built assets are content-hashed, so once cached they are never stale.
  const isAsset = url.pathname.startsWith("/assets/");
  const isShell = SHELL.includes(url.pathname) || event.request.mode === "navigate";
  if (!isAsset && !isShell) return;

  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit;
      return fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match("/index.html"));
    }),
  );
});

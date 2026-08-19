/* Service worker.
 *
 * The first version of this cached the HTML shell cache-first, which was a bug:
 * Vite gives every build new hashed asset filenames, so a cached index.html
 * keeps asking for /assets/index-OLDHASH.js long after that file is gone. The
 * result is a blank white page that a normal reload cannot fix, because the
 * reload is served from the same stale cache.
 *
 * So the rule is now split by what the file actually is:
 *
 *   - HTML and navigations: NETWORK FIRST. The shell is small, it must never
 *     be stale, and cache is only a fallback for being offline.
 *   - /assets/*: cache-first, which is safe precisely because the filenames are
 *     content-hashed — a given URL's contents can never change.
 *   - API, media, clips: never touched. A cached "processing" status that never
 *     updates is worse than no offline support, and caching video would fill
 *     the user's storage with files they watched once.
 *
 * Offline transcription is impossible anyway — the work happens on a server
 * with a GPU — so the point here is installability and a fast cold start, not
 * a functioning offline app.
 */

// Bumped from v1. The activate handler deletes every cache that is not this
// one, which is what evicts the broken v1 shell from anyone who already has it.
const CACHE = "lexicon-v2";
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

  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/media/")
  ) {
    return;
  }

  const isNavigation =
    event.request.mode === "navigate" || SHELL.includes(url.pathname);

  if (isNavigation) {
    // Network first. Falling back to cache only when the network genuinely
    // fails means a new build is picked up on the very next load.
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(event.request).then((hit) => hit || caches.match("/index.html"))),
    );
    return;
  }

  if (!url.pathname.startsWith("/assets/")) return;

  event.respondWith(
    caches.match(event.request).then((hit) => {
      if (hit) return hit;
      return fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      });
    }),
  );
});

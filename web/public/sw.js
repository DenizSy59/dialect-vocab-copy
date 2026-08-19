/* Service worker — deliberately does no caching.
 *
 * Two earlier versions cached the app shell so the PWA would start fast. Both
 * produced the same failure: Vite gives every build content-hashed asset names,
 * a cached index.html kept requesting files that no longer existed, the module
 * script 404'd, React never booted, and the page went white. Worse, the state
 * was self-sustaining — a reload was served from the same bad cache, so the app
 * could not repair itself.
 *
 * A fast cold start is a nice-to-have. A white screen is fatal. So this worker
 * now exists only to satisfy the installability requirement (Chrome will not
 * offer "install" without a registered worker) and passes every request
 * straight through to the network.
 *
 * It also actively evicts anything the previous versions cached, so users who
 * already have the broken state recover on their next visit.
 *
 * If offline support is wanted later, the safe shape is: network-first for
 * HTML, cache-first only for /assets/* which are content-hashed and therefore
 * immutable. That is what v2 did, and it was correct — it just could not reach
 * anyone already stuck on v1.
 */

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// No fetch handler at all. Without one the browser goes to the network for
// everything, which is exactly what is wanted here.

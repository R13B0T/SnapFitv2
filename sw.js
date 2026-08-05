/* SnapFit v2 service worker.
   Shell is cache-first so a session runs in a gym dead-spot.
   Anything that talks to the coach is network-only — a stale answer is worse
   than an honest failure, and the app falls back to its built-in coach anyway. */

/* Bump this on any shell change. The fetch handler below is
   stale-while-revalidate, so without a bump an installed app serves the old
   index.html on first open and only picks up the new one on the launch after
   that — which looks exactly like the update having failed. */
const CACHE = "snapfit-v2-4";

const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://unpkg.com/@babel/standalone/babel.min.js",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      // Individually, so one bad CDN response doesn't fail the whole install.
      .then(cache => Promise.all(SHELL.map(url =>
        cache.add(new Request(url, {mode: url.startsWith("http") ? "cors" : "same-origin"}))
          .catch(() => null)
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never cache the API. Let it fail so the app can fall back to its rules engine.
  if (url.hostname === "api.anthropic.com") return;

  // Fonts: cache-first, they never change.
  const isFont = url.hostname.includes("fonts.googleapis.com") || url.hostname.includes("fonts.gstatic.com");

  event.respondWith(
    caches.match(req).then(hit => {
      if (hit) {
        if (!isFont) {
          // Refresh in the background so the next load is current.
          fetch(req).then(res => {
            if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
          }).catch(() => {});
        }
        return hit;
      }
      return fetch(req).then(res => {
        if (res && res.ok && (url.origin === self.location.origin || isFont || url.hostname === "unpkg.com")) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});

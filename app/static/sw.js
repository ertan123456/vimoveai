/* ViMove service worker — makes the site installable (PWA / Play Store TWA).
   Strategy: network-first (always fresh online), cache the app shell as an
   offline fallback. Third-party requests (MediaPipe CDN, analytics) are left
   untouched so detection and tracking are unaffected. */
const CACHE = "vimove-shell-v1";
const SHELL = ["/", "/static/styles.css", "/static/app.js", "/static/i18n.js", "/static/favicon.svg"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // don't touch CDN / analytics
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && url.pathname.startsWith("/static/")) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("/")))
  );
});

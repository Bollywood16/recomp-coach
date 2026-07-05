/* Recomp Coach service worker — offline support */
const CACHE = "recomp-coach-v12";

/* App shell + the CDN libraries the app needs to boot. Caching these means the
   app opens with no network after the first successful load. */
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "https://unpkg.com/react@18/umd/react.production.min.js",
  "https://unpkg.com/react-dom@18/umd/react-dom.production.min.js",
  "https://unpkg.com/prop-types@15/prop-types.min.js",
  "https://unpkg.com/recharts@2.12.7/umd/Recharts.js",
  "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js",
  "https://unpkg.com/@babel/standalone/babel.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      /* addAll fails hard if any request fails; add individually so one flaky
         CDN response doesn't block the whole install. */
      Promise.all(
        ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn("skip cache", url, err))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isHTML = req.mode === "navigate" || url.pathname.endsWith("index.html") || url.pathname.endsWith("/");

  if (isHTML) {
    /* Network-first for the page itself so you always get the latest version
       when online, but fall back to cache when offline. */
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  /* Cache-first for everything else (libraries, icons) — they don't change. */
  event.respondWith(
    caches.match(req).then((cached) =>
      cached ||
      fetch(req).then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached)
    )
  );
});

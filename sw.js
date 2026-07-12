/* Tabletop — one service worker for the whole app (/games lobby, /go, /dama).
   Root scope so navigation between the pages stays inside the installed PWA.
   Only app paths are handled; the rest of the site passes through. */
const CACHE = "tabletop-v2";
const APP_PATHS = ["/go/", "/dama/", "/games/", "/shared/"];
const SHELL = [
  "/manifest.webmanifest",
  "/shared/tabletop.js", "/shared/tabletop.css",
  "/shared/peerjs.min.js", "/shared/qrcode.min.js",
  "/go/", "/go/index.html", "/go/peerjs.min.js", "/go/qrcode.min.js",
  "/go/icons/icon-192.png", "/go/icons/icon-512.png",
  "/go/icons/icon-maskable-512.png", "/go/icons/apple-touch-icon.png",
  "/dama/", "/dama/index.html", "/dama/peerjs.min.js", "/dama/qrcode.min.js",
  "/dama/icons/icon-192.png", "/dama/icons/icon-512.png",
  "/dama/icons/icon-maskable-512.png", "/dama/icons/apple-touch-icon.png",
  "/games/", "/games/index.html",
  "/games/icons/icon-192.png", "/games/icons/icon-512.png",
  "/games/icons/icon-maskable-512.png", "/games/icons/apple-touch-icon.png"
];

function appIndex(pathname){
  if (pathname.indexOf("/go/") === 0) return "/go/index.html";
  if (pathname.indexOf("/dama/") === 0) return "/dama/index.html";
  return "/games/index.html";
}

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
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
  if (url.origin !== location.origin) return;
  if (!APP_PATHS.some((p) => url.pathname.indexOf(p) === 0)) return;

  if (req.mode === "navigate") {
    // network first so updates land; cached shell keeps it working offline
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(appIndex(url.pathname), copy));
          return res;
        })
        .catch(() => caches.match(appIndex(url.pathname)))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }))
  );
});

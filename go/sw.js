/* Retired: this app now uses the site-wide service worker at /sw.js.
   This version exists only to clean up after itself on old installs. */
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    try{
      const keys = await caches.keys();
      await Promise.all(keys
        .filter((k) => k.indexOf("goban-") === 0 || k.indexOf("dama-") === 0 || k.indexOf("lobby-") === 0)
        .map((k) => caches.delete(k)));
    }catch(err){}
    await self.registration.unregister();
    const cs = await self.clients.matchAll({ type: "window" });
    cs.forEach((c) => { try{ c.navigate(c.url); }catch(err){} });
  })());
});

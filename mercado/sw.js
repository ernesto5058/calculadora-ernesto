/* «Mercado» — Service Worker (mercado-v3).
   Estrategia como las demás apps de la casa:
   - La cáscara (index, tema, manifest, iconos) se cachea al instalar.
   - La navegación: red primero y, sin conexión, la cáscara guardada
     (la app muestra entonces la última foto con «dato de hace X»).
   - Las puertas RPC de Supabase NUNCA se cachean aquí: la frescura
     la manda el dato, no una copia escondida. */
const CACHE = "mercado-v3";
const CASCARA = ["./", "./index.html", "./tema-pro.css", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCARA)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.hostname.endsWith("supabase.co")) return; // datos: siempre red
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copia));
          return r;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }
  e.respondWith(caches.match(e.request).then((m) => m || fetch(e.request)));
});

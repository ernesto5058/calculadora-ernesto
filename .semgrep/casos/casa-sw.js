// Casos de prueba — casa-sw.yaml (service workers)
// (semgrep --test: ruleid = debe cazar, ok = no debe cazar)

const CACHE = "miapp-v3";

// ── MALO: borrado filtrando SOLO por !== CACHE (trampa §9-2, forma real
// que vivía en mercado/sw.js) ──
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      // ruleid: proyecto-sw-borra-caches-ajenas
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── BUENO: prefijo propio + !== CACHE (la forma de buscadores/sw.js y
// minegocio/sw.js) ──
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      // (el delete va guardado por el if con prefijo)
      // ok: proyecto-sw-borra-caches-ajenas
      if (k.indexOf("miapp-") === 0 && k !== CACHE) return caches.delete(k);
    }));
  }));
});

// ── BUENO: filtro conjunción con prefijo (forma de minegocio/sw.js) ──
function limpiaBueno(ks) {
  // (el predicado NO es el !== desnudo)
  // ok: proyecto-sw-borra-caches-ajenas
  return Promise.all(ks.filter(function (k) { return k.indexOf("miapp-") === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
}

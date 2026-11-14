/* Mi Trabajo — Buscadores · service worker
   La app (pantalla) se guarda en el teléfono: funciona sin internet.
   Los datos (datos.json) se buscan frescos primero; sin conexión se usa la última copia. */
var CACHE = "mitrabajo-v32";
var SHELL = ["./", "./index.html", "./manifest.webmanifest", "./tema-pro.css", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k.indexOf("mitrabajo-") === 0 && k !== CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  /* v1.5.7 (tanda PRO): la API va DIRECTA a la red, sin pasar por este
     handler. El handler solo existe pa la pantalla y datos.json (GET del
     mismo origen): la Cache Storage es GET-only y en WebKit un POST
     cruzado (las puertas RPC de Supabase) moría en silencio al pasar por
     caches.match/put — la tarifa viva «no respondía» en el iPhone con el
     servidor sano (los GET entraban; los POST, no). */
  if (e.request.method !== "GET") return;
  if (e.request.url.indexOf("supabase.co") !== -1) return;
  var url = e.request.url;
  if (url.indexOf("datos.json") !== -1) {
    // Datos: fresco primero, copia guardada si no hay internet
    e.respondWith(
      fetch(e.request).then(function (r) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return r;
      }).catch(function () { return caches.match(e.request); })
    );
    return;
  }
  // Pantalla: desde el teléfono primero (offline total)
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function (hit) {
      return hit || fetch(e.request).then(function (r) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return r;
      });
    })
  );
});

/* ===== AVISOS (Web Push propio, VAPID) =====
   Regla de Apple: CADA push debe mostrar una notificación visible;
   si no, el permiso se revoca. Por eso este handler SIEMPRE muestra. */
/* ===== Avisos (Web Push propio) — acabado PRO =====
   Plantilla cuidada: título corto con UN emoji con sentido y cuerpo
   de una línea con los datos clave (miles con espacio, moneda
   visible). Nada de JSON ni volcados crudos. */
function miles(n){ return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
function avisoDe(d){
  d = d || {};
  if (d.titulo && d.cuerpo) return { titulo: d.titulo, cuerpo: d.cuerpo, tab: d.tab || "Panel" };
  var tipo = d.tipo || "";
  if (tipo === "aprobado") return { titulo: "✅ Trato aprobado", cuerpo: d.comision ? ("Tu comisión: " + miles(d.comision) + " CUP") : "Revisa tu panel", tab: "Panel" };
  if (tipo === "pagado") return { titulo: "💰 Comisión pagada", cuerpo: d.comision ? (miles(d.comision) + " CUP — revisa tu panel") : "Revisa tu panel", tab: "Panel" };
  if (tipo === "tarifa") return { titulo: "📋 Nueva tarifa publicada", cuerpo: d.ingreso ? ("Ingreso por recarga de 360: " + miles(d.ingreso) + " CUP") : "Revisa la calculadora", tab: "Calc" };
  if (tipo === "mensaje") return { titulo: "💬 Mensaje de Ernesto", cuerpo: "Tócalo para abrir el chat", tab: "Ayuda" };
  return { titulo: "🔔 Mi Trabajo", cuerpo: "Tienes novedades en tu panel", tab: d.tab || "Panel" };
}
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const a = avisoDe(d);
  event.waitUntil(self.registration.showNotification(a.titulo, {
    body: a.cuerpo,
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: "mitrabajo-" + (d.tipo || "aviso"),
    data: { tab: a.tab }
  }));
});

self.addEventListener("notificationclick", function(e){
  e.notification.close();
  var datos = e.notification.data || {};
  var destino = new URL(datos.url || "./", self.registration.scope).href;
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(lista){
      for (var i = 0; i < lista.length; i++) {
        if (lista[i].url.indexOf(self.registration.scope) === 0 && "focus" in lista[i]) {
          try { lista[i].postMessage({ tipo: "push-tab", tab: datos.tab }); } catch(err){}
          return lista[i].focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(destino);
    })
  );
});

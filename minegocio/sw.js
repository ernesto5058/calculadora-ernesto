/* «Mi Negocio» — service worker PROPIO.
   Vive en minegocio/ : su scope es SOLO esta carpeta. No toca el
   service worker de buscadores/ (el de la app de buscadores) ni viceversa.
   Estrategia: cache-first del cascarón (index/iconos/manifest) →
   la app abre SIN internet desde la segunda visita. Los datos
   (Supabase, datos.json, ultimo.json) siempre van a la red primero
   y la app guarda su última foto en localStorage. */
var CACHE = "minegocio-v3";
var CASCARON = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./tema-pro.css",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png"
];
self.addEventListener("install", function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){ return c.addAll(CASCARON); }).then(function(){ return self.skipWaiting(); })
  );
});
self.addEventListener("activate", function(e){
  e.waitUntil(
    caches.keys().then(function(ks){
      return Promise.all(ks.filter(function(k){ return k.indexOf("minegocio-") === 0 && k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});
self.addEventListener("fetch", function(e){
  var url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  /* Datos vivos: red primero; si no hay red, lo que haya en caché (si hay) */
  var esDato = url.pathname.indexOf("datos.json") >= 0 || url.pathname.indexOf("ultimo.json") >= 0 || url.hostname.indexOf("supabase.co") >= 0;
  if (esDato) {
    e.respondWith(
      fetch(e.request).catch(function(){ return caches.match(e.request, { ignoreSearch: true }); })
    );
    return;
  }
  /* Cascarón: caché primero, red de respaldo (y refresca la caché) */
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function(hit){
      var red = fetch(e.request).then(function(r){
        if (r && r.ok && url.origin === self.location.origin) {
          var clon = r.clone();
          caches.open(CACHE).then(function(c){ c.put(e.request, clon); });
        }
        return r;
      }).catch(function(){ return hit; });
      return hit || red;
    })
  );
});

/* ===== AVISOS (Web Push propio, VAPID) =====
   Regla de Apple: CADA push debe mostrar una notificación visible;
   si no, el permiso se revoca. Por eso este handler SIEMPRE muestra. */
/* ===== Avisos (Web Push propio) — acabado PRO =====
   Plantilla cuidada: título corto con UN emoji con sentido y cuerpo
   de una línea con los datos clave (miles con espacio, moneda
   visible). Nada de JSON ni volcados crudos: si el emisor manda
   titulo/cuerpo se usan; si no, se compone desde el tipo. */
function miles(n){ return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " "); }
function avisoDe(d){
  d = d || {};
  if (d.titulo && d.cuerpo) return { titulo: d.titulo, cuerpo: d.cuerpo, tab: d.tab || "Inicio" };
  var tipo = d.tipo || "";
  if (tipo === "reporte") return { titulo: "📋 Reporte nuevo", cuerpo: (d.nombre ? d.nombre + " · " : "") + "pendiente de aprobar en la Bandeja", tab: "Bandeja" };
  if (tipo === "mensaje") return { titulo: "💬 Mensaje nuevo", cuerpo: d.nombre ? ("De " + d.nombre + " — tócalo para abrir el chat") : "Tócalo para abrir el chat", tab: "Equipo" };
  if (tipo === "tarifa") return { titulo: "📋 Nueva tarifa publicada", cuerpo: d.ingreso ? ("Ingreso por recarga de 360: " + miles(d.ingreso) + " CUP") : "Ya está visible para tu equipo", tab: "Tarifa" };
  return { titulo: "🔔 Mi Negocio", cuerpo: "Tienes novedades en tu panel", tab: d.tab || "Inicio" };
}
self.addEventListener("push", (event) => {
  /* userVisibleOnly: SIEMPRE se muestra una notificación; si no,
     Apple puede revocar el permiso de avisos. */
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }
  const a = avisoDe(d);
  event.waitUntil(self.registration.showNotification(a.titulo, {
    body: a.cuerpo,
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: "minegocio-" + (d.tipo || "aviso"),
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

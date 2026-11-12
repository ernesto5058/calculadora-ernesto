/* =====================================================================
   SENTRY DE LA CASA — errores en producción (estudio de huecos, TOP 2)
   ---------------------------------------------------------------------
   Qué hace: si la app revienta en el teléfono de un buscador o de un
   cliente, el error viaja solo al panel de Sentry con pantalla y
   versión — SIN datos sensibles: el escrubado de abajo quita códigos
   de acceso, teléfonos, adjuntos, cuerpos de petición (texto del chat)
   y lo tecleado en los campos ANTES de que el evento salga.

   Cómo se enchufa (detalle en README.md de esta carpeta):
   · En el <head> va el bloque de bloque-head.html (config + SDK CDN).
   · Este archivo se inyecta en app.js vía ensamblar, con el marcador
     SENTRY_CASA y el mismo patrón que el de PUSH_CLIENTE, en
     Mi Trabajo y Mi Negocio; en Mercado y la paginita su contenido se
     pega tal cual dentro de un script antes del cierre del body.

   Reglas duras:
   · Sin DSN (o sin SDK, p. ej. APK sin red) NO hace nada: no-op total.
   · Jamás rompe la app: todo va envuelto y cualquier fallo interno
     del propio Sentry se traga en silencio.
   · Sin Session Replay a propósito: grabar la pantalla podría filmar
     datos de clientes; solo viajan errores.
   ===================================================================== */
(function () {
  "use strict";
  try {
    var cfg = (typeof window !== "undefined" && window.SENTRY_CASA) || null;
    if (!cfg || !cfg.dsn || !cfg.app) return; /* sin DSN: no-op total */

    /* ---------- escrubado: lo sensible NUNCA sale ---------- */
    var REGLAS = [
      [/eyJ[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]{10,})+/g, "[token oculto]"],
      [/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi, "[adjunto oculto]"],
      [/\b[A-Za-z0-9+/]{80,}={0,2}\b/g, "[adjunto oculto]"],
      [/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[oculto]"],
      [/(\bhttps?:\/\/[^\s?'"<>]+)\?[^\s'"<>]*/g, "$1"],
      [/\b[A-ZÁÉÍÓÚÑ]{2,}-[A-Z0-9]{2,}\b/g, "[código oculto]"],
      [/\+?53[\s.-]?\d{4}[\s.-]?\d{4}\b/g, "[teléfono oculto]"],
      [/\b5\d{7}\b/g, "[teléfono oculto]"]
    ];
    function ocultar(s) {
      if (typeof s !== "string") return s;
      var out = s;
      for (var i = 0; i < REGLAS.length; i++) out = out.replace(REGLAS[i][0], REGLAS[i][1]);
      return out;
    }
    function limpiarUrl(u) {
      if (typeof u !== "string") return u;
      var sinQuery = u.split("?")[0].split("#")[0];
      return ocultar(sinQuery);
    }
    var CLAVE_SENSIBLE = /adj|dato|mensaje|chat|telefon|celular|codigo|código|clave|password|token|secret|auth/i;
    function escrubarDato(v, prof) {
      if (prof > 6) return "[…]";
      if (typeof v === "string") return ocultar(v);
      if (Array.isArray(v)) {
        var a = [];
        for (var i = 0; i < v.length; i++) a.push(escrubarDato(v[i], prof + 1));
        return a;
      }
      if (v && typeof v === "object") {
        var o = {};
        for (var k in v) {
          if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
          o[k] = CLAVE_SENSIBLE.test(k) ? "[oculto]" : escrubarDato(v[k], prof + 1);
        }
        return o;
      }
      return v;
    }
    function antesDeEnviar(ev) {
      try {
        if (!ev || typeof ev !== "object") return ev;
        if (ev.user) delete ev.user; /* la identidad puede ser el código */
        if (typeof ev.message === "string") ev.message = ocultar(ev.message);
        if (ev.request) {
          ev.request.url = limpiarUrl(ev.request.url || "");
          if (ev.request.query_string) ev.request.query_string = "";
          delete ev.request.data;    /* el cuerpo puede ser texto del chat */
          delete ev.request.cookies;
          ev.request.headers = {};
        }
        if (ev.exception && ev.exception.values) {
          for (var i = 0; i < ev.exception.values.length; i++) {
            var ex = ev.exception.values[i];
            if (typeof ex.value === "string") ex.value = ocultar(ex.value);
            if (ex.stacktrace && ex.stacktrace.frames) {
              for (var j = 0; j < ex.stacktrace.frames.length; j++) {
                var fr = ex.stacktrace.frames[j];
                if (typeof fr.filename === "string") fr.filename = limpiarUrl(fr.filename);
                if (fr.vars) fr.vars = escrubarDato(fr.vars, 0);
              }
            }
          }
        }
        if (ev.breadcrumbs) {
          for (var b = 0; b < ev.breadcrumbs.length; b++) {
            var bc = ev.breadcrumbs[b];
            if (typeof bc.message === "string") bc.message = ocultar(bc.message);
            if (bc.data) bc.data = escrubarDato(bc.data, 0);
          }
        }
        if (ev.extra) ev.extra = escrubarDato(ev.extra, 0);
        if (ev.contexts) ev.contexts = escrubarDato(ev.contexts, 0);
        return ev;
      } catch (e) {
        return null; /* si el escrubado falla, el evento NO sale: privacidad manda */
      }
    }
    function antesDeMiga(crumb) {
      try {
        if (!crumb) return crumb;
        if (crumb.category === "console") return null;   /* la consola puede llevar datos */
        if (crumb.category === "ui.input") return null;  /* lo tecleado: códigos */
        if (typeof crumb.message === "string") crumb.message = ocultar(crumb.message);
        if (crumb.data) crumb.data = escrubarDato(crumb.data, 0);
        return crumb;
      } catch (e) {
        return null;
      }
    }

    /* ---------- arranque: el SDK va con defer; esperamos a que llegue ---------- */
    var listo = false;
    function intentarInit() {
      if (listo) return true;
      if (typeof window === "undefined" || !window.Sentry || !window.Sentry.init) return false;
      try {
        window.Sentry.init({
          dsn: cfg.dsn,
          release: String(cfg.app) + "@" + String(cfg.version || "1"),
          environment: "production",
          sendDefaultPii: false,
          tracesSampleRate: 0.1,
          maxBreadcrumbs: 30,
          beforeSend: antesDeEnviar,
          beforeBreadcrumb: antesDeMiga
        });
        if (window.Sentry.setTag) window.Sentry.setTag("app", String(cfg.app));
        listo = true;
        window.__sentryCasa = { app: String(cfg.app), version: String(cfg.version || "1") };
        /* Prueba de fuego: abrir la app con ?prueba-sentry=1 dispara un
           error FALSO (teléfono y código inventados) pa verificar en el
           panel que el evento llega Y que el escrubado los oculta. */
        var q = String((window.location && window.location.search) || "");
        if (/[?&]prueba-sentry=1\b/.test(q) && window.Sentry.captureException) {
          window.Sentry.captureException(new Error("Prueba de fuego Sentry — tel 50000000 — codigo FALSO-123"));
          window.__sentryPrueba = true;
        }
        return true;
      } catch (e) {
        return true; /* Sentry jamás rompe la app: si init falla, se acabó */
      }
    }
    var intentos = 0;
    (function paso() {
      if (intentarInit()) return;
      intentos++;
      if (intentos <= 24) setTimeout(paso, 250); /* ~6 s de margen al CDN */
    })();
  } catch (e) { /* silencio total: la app manda */ }
})();

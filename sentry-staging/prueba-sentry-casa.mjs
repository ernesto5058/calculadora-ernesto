/* Banco del cableado Sentry de la casa (TOP 2 · estudio de huecos).
   Corre sentry-casa.js en una VM con un Sentry FALSO que captura el
   init, y verifica: (1) sin DSN no hay init; (2) sin SDK no revienta;
   (3) con SDK tardío (defer) el init llega solo; (4) las opciones son
   las de la casa; (5) el escrubado quita usuario, cuerpo, cookies,
   query, teléfonos, códigos, adjuntos y tokens de un evento envenenado;
   (6) las migas de consola y de input se descartan.                 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("./sentry-casa.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok = (cond, nombre) => { if (cond) { pass++; } else { fail++; console.log("  ✗ FALLO:", nombre); } };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function sentryFalso(store) {
  return {
    init(opts) { store.init = opts; store.llamadas = (store.llamadas || 0) + 1; },
    setTag(k, v) { (store.tags = store.tags || {})[k] = v; },
    captureException(e) { store.capturado = e; }
  };
}
function entorno({ dsn = "", conSdk = true, tardio = false } = {}) {
  const store = {};
  const win = { location: { search: "" } };
  if (dsn) win.SENTRY_CASA = { app: "mitrabajo", version: "1.5.3", dsn };
  if (conSdk && !tardio) win.Sentry = sentryFalso(store);
  const sandbox = { window: win, setTimeout, clearTimeout, console };
  win.window = win;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { store, win, sentryFalso };
}

/* 1 — sin DSN: no-op total */
{
  const { store } = entorno({ dsn: "" });
  await espera(50);
  ok(!store.init, "sin DSN no hay init");
}
/* 2 — sin SDK (APK offline): no revienta ni inicializa */
{
  const { store } = entorno({ dsn: "https://clave@o0.ingest.sentry.io/1", conSdk: false });
  await espera(700);
  ok(!store.init, "sin SDK no hay init ni cuelgue");
}
/* 3 — SDK tardío (llega con defer): el init llega solo */
{
  const { store, win, sentryFalso: sf } = entorno({ dsn: "https://clave@o0.ingest.sentry.io/1", tardio: true });
  win.Sentry = sf(store);
  await espera(700);
  ok(!!store.init && store.llamadas === 1, "con SDK tardío init una sola vez");
  const o = store.init || {};
  ok(o.release === "mitrabajo@1.5.3", "release = app@versión");
  ok(o.sendDefaultPii === false, "sendDefaultPii apagado");
  ok(typeof o.tracesSampleRate === "number" && o.tracesSampleRate <= 0.2, "muestreo de trazas sensato (≤0.2)");
  ok(typeof o.beforeSend === "function" && typeof o.beforeBreadcrumb === "function", "escrubado enchufado");
  ok(store.tags && store.tags.app === "mitrabajo", "tag de app puesto");

  /* 4 — evento envenenado: nada sensible sobrevive al beforeSend */
  const tokenFalso = "eyJ" + "x".repeat(20) + "." + "y".repeat(20) + "." + "z".repeat(20);
  const ev = {
    message: "fallo al avisar al 50000000",
    user: { id: "FALSO-123", username: "buscador" },
    request: {
      url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/?codigo=FALSO-123&x=1",
      method: "POST",
      data: { texto: "mensaje privado del chat" },
      cookies: { sesion: "abc" },
      headers: { Authorization: "Bearer abc" },
      query_string: "codigo=FALSO-123"
    },
    exception: { values: [{ type: "Error", value: "Error con tel 50000000 y token " + tokenFalso,
      stacktrace: { frames: [{ filename: "https://x.github.io/app.js?codigo=FALSO-123", vars: { clave: "secreta" } }] } }] },
    breadcrumbs: [
      { category: "console", message: "chat: hola 50000000" },
      { category: "fetch", message: "POST https://api.ejemplo.cu/rpc?codigo=FALSO-123" }
    ],
    extra: { adj_datos: "data:image/png;base64,QUJD", nota: "llamar al 50000000", anidado: { telefono: "50000000" } }
  };
  const limpio = o.beforeSend(JSON.parse(JSON.stringify(ev)));
  const todo = JSON.stringify(limpio);
  ok(!("user" in limpio), "el usuario (su código) no viaja");
  ok(!limpio.request.data && !limpio.request.cookies, "cuerpo y cookies fuera");
  ok(!todo.includes("FALSO-123"), "ningún código de acceso en el evento");
  ok(!todo.includes("50000000"), "ningún teléfono en el evento");
  ok(!todo.includes(tokenFalso) && !todo.includes("eyJ"), "ningún token/JWT en el evento");
  ok(!todo.includes("mensaje privado"), "el texto del chat no viaja");
  ok(!todo.includes("codigo=") && !limpio.request.url.includes("?"), "URL sin query");
  ok(limpio.extra.adj_datos === "[oculto]", "adjunto tachado por nombre de clave");
  ok(limpio.exception.values[0].value.includes("[teléfono oculto]"), "la excepción conserva el error, sin el dato");

  /* 5 — migas: consola e input se descartan; fetch se limpia */
  ok(o.beforeBreadcrumb({ category: "console", message: "x" }) === null, "miga de consola descartada");
  ok(o.beforeBreadcrumb({ category: "ui.input", message: "x" }) === null, "miga de input descartada");
  const miga = o.beforeBreadcrumb({ category: "fetch", message: "GET https://a.cu/x?codigo=FALSO-123" });
  ok(!!miga && !miga.message.includes("FALSO-123") && !miga.message.includes("?"), "miga fetch conservada y limpia");
}
/* 6 — prueba de fuego: con ?prueba-sentry=1 se captura el error falso */
{
  const store = {};
  const win = { location: { search: "?prueba-sentry=1" }, SENTRY_CASA: { app: "mercado", version: "v3", dsn: "https://c@o0.ingest.sentry.io/2" }, Sentry: sentryFalso(store) };
  const sandbox = { window: win, setTimeout, clearTimeout, console };
  win.window = win;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  ok(!!store.capturado && /Prueba de fuego/.test(store.capturado.message), "la prueba de fuego captura su error");
}

console.log(`prueba-sentry-casa: ${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);

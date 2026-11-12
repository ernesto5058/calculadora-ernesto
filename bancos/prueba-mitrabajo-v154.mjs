// Banco v1.5.4 — Mi Trabajo, CIERRE TOP 2 Sentry (fila 40, 2026-11-12):
// el cableado Sentry de la casa queda enchufado por el patrón de la casa
// (marcador + bloque de head + espejo en ensamblar.py), con el DSN del
// proyecto «mitrabajo» y la versión 1.5.4 / caché mitrabajo-v21.
// La lógica del escrubado se prueba en sentry-staging/prueba-sentry-casa.mjs;
// aquí se prueba que ESTA app lo trae puesto y bien puesto.
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "buscadores/index.html", "utf8");
const src = fs.readFileSync(REPO + "buscadores-app/app.js", "utf8");
const sin = fs.readFileSync(REPO + "buscadores-app/index-sin-script.html", "utf8");
const ens = fs.readFileSync(REPO + "buscadores-app/ensamblar.py", "utf8");
const sw = fs.readFileSync(REPO + "buscadores/sw.js", "utf8");
const datos = JSON.parse(fs.readFileSync(REPO + "buscadores/datos.json", "utf8"));
const DSN_MT = "https://c55f15054776babcf29ee7023c77f250@o4512419765354496.ingest.us.sentry.io/4512419773087744";
let pass = 0, fail = 0;
function ok(c, n){ if (c) pass++; else { fail++; console.log("FAIL:", n); } }

/* ---- Sellos de la tanda ---- */
ok(/var APP_VERSION = "1\.5\.4"/.test(html), "S1 APP_VERSION 1.5.4 en el build ensamblado");
ok(sw.includes('CACHE = "mitrabajo-v21"'), "S2 el SW sube a mitrabajo-v21");
ok(datos.versionApp === "1.5.2" && /apk-v1\.5\.2\/Mi-Trabajo-v1\.5\.2\.apk$/.test(datos.apkUrl),
   "S3 datos.json NO se toca: sigue anunciando la APK 1.5.2 (la 1.5.4 es web y no existe APK 1.5.4 que anunciar)");

/* ---- El patrón de la casa: marcador, espejo y bloque ---- */
ok(src.includes("/*__SENTRY_CASA__*/"), "S4 la fuente app.js trae el marcador SENTRY_CASA");
ok(ens.includes('ruta_shared("sentry-casa.js")') && ens.includes('js.replace("/*__SENTRY_CASA__*/", sentryjs)'),
   "S5 ensamblar.py espeja shared/sentry-casa.js tras el bloque de push (patrón de la casa)");
ok(!html.includes("/*__SENTRY_CASA__*/"), "S6 el build NO conserva el marcador: fue reemplazado");
ok(html.includes("SENTRY DE LA CASA") && html.includes("antesDeEnviar") && html.includes("antesDeMiga"),
   "S7 el build trae el contenido íntegro de sentry-casa.js (init + escrubado enchufados)");

/* ---- El bloque de head, con SU DSN y SU versión ---- */
ok(sin.includes('window.SENTRY_CASA={app:"mitrabajo",version:"1.5.4",dsn:"' + DSN_MT + '"}'),
   "S8 la plantilla trae el bloque con app mitrabajo, versión 1.5.4 y el DSN del proyecto mitrabajo");
ok(html.includes('window.SENTRY_CASA={app:"mitrabajo",version:"1.5.4",dsn:"' + DSN_MT + '"}'),
   "S9 el build publicado trae ese mismo bloque (release mitrabajo@1.5.4)");
ok(html.includes('src="https://browser.sentry-cdn.com/8.38.0/bundle.min.js"') &&
   html.includes('integrity="sha384-48iagrZwMa6wkDoJKNyCk4jgMHcOcsBK/DzZAJInl1ZhtunellJDCRNZuomfHefF"'),
   "S10 el SDK va fijado (8.38.0) y con SRI: si el CDN cambia, no carga y la app sigue intacta");
ok(!html.includes("1454ae292cfdb8e358e88ec3d1fc1547") && !html.includes("be3fffd86ef4af47f8d6a09497019a00") && !html.includes("9f5efe752996c23227a28d8365a7ef17"),
   "S11 ningún DSN de otra app (minegocio/mercado/paginita) se coló en Mi Trabajo");

console.log("\nBANCO MI TRABAJO v1.5.4 (Sentry de la casa): " + pass + " PASS · " + fail + " FAIL");
process.exit(fail ? 1 : 0);

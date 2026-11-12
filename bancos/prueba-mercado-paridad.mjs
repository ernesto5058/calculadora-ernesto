// Banco de paridad «Mercado» — chequeos eternos C-1 + C-3 (Tanda 3, F-1 + E-3).
// Verifica SIN correr ensamblar.py que la FUENTE (mercado-src/) y lo
// DESPLEGADO (github-calculadora/mercado/) son la misma app:
//  P-1 el script inline del desplegado == app.js fuente, normalizando el sello;
//  P-2 la carcasa del desplegado == index-sin-script.html con la marca <!--SCRIPT-->;
//  P-3 ensamblar.py declara v3 / mercado-v3 y el sw.js desplegado usa mercado-v3;
//  P-4 dirección del dinero: la frase de empate invertida NO existe en fuente
//      ni desplegado, y la correcta asocia «por debajo» con ganar y
//      «por encima» con perder (tasa en saldo por QUSD: G decrece con R,
//      se gana vendiendo a tasa <= equilibrio).
// Sin dependencias. Uso: node bancos/prueba-mercado-paridad.mjs
// Rutas: la raíz del repo se resuelve desde este archivo (o BANCO_REPO);
// la fuente se busca en <workspace>/mercado-src (o MERCADO_SRC).
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.BANCO_REPO || path.resolve(aqui, "..");
const SRC = process.env.MERCADO_SRC || path.resolve(REPO, "..", "mercado-src");

let pass = 0, fail = 0; const fails = [];
function ok(c, n) { if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }

function leer(p) { try { return fs.readFileSync(p, "utf-8"); } catch { return null; } }

const depHtml = leer(path.join(REPO, "mercado", "index.html"));
const depSw = leer(path.join(REPO, "mercado", "sw.js"));
const fuenteJs = leer(path.join(SRC, "app.js"));
const plantilla = leer(path.join(SRC, "index-sin-script.html"));
const ensamblar = leer(path.join(SRC, "ensamblar.py"));

ok(depHtml !== null, "existe el desplegado mercado/index.html");
ok(depSw !== null, "existe el desplegado mercado/sw.js");
ok(fuenteJs !== null, "existe la fuente mercado-src/app.js");
ok(plantilla !== null, "existe la plantilla mercado-src/index-sin-script.html");
ok(ensamblar !== null, "existe mercado-src/ensamblar.py");
if (fail) { console.log(`\nPARIDAD MERCADO: ${pass} PASS · ${fail} FAIL`); process.exit(1); }

// Extracción de scripts: desde el TOP 2 (Sentry de la casa) el desplegado
// lleva DOS bloques: el de la app y el de sentry-casa (íntegro, antes del
// </body>, desde la plantilla). La paridad los distingue y verifica AMBOS.
const bloques = [...depHtml.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)];
ok(bloques.length === 2, `P-1 el desplegado tiene DOS bloques de script (app + sentry-casa) (dio ${bloques.length})`);
const bloqApp = bloques.find((b) => b[1].includes("mercado_accion_app"));
const bloqSentry = bloques.find((b) => b[1].includes("SENTRY DE LA CASA"));
ok(!!bloqApp, "P-1 existe el bloque de la app (contiene mercado_accion_app)");
ok(!!bloqSentry, "P-1 existe el bloque de sentry-casa (TOP 2)");
const sentryCasa = leer(path.join(REPO, "shared", "sentry-casa.js"));
ok(sentryCasa !== null && !!bloqSentry && bloqSentry[1] === sentryCasa, "P-1 el bloque sentry del desplegado == shared/sentry-casa.js íntegro");
ok(depHtml.includes('window.SENTRY_CASA={app:"mercado",version:"v3"'), "P-1 el desplegado trae la config SENTRY_CASA de mercado@v3");
const scriptDep = bloqApp ? bloqApp[1] : "";
ok(scriptDep.split("mercado_accion_app").length - 1 === 3, "P-1 el script desplegado contiene 3× mercado_accion_app (botones por peldaño v3)");

// P-1: paridad script desplegado == fuente, normalizando el sello en ambos.
const reSello = /Mercado · versión \d{4}-\d{2}-\d{2} \d{2}:\d{2} · caché v\d+/g;
const normDep = scriptDep.replace(reSello, "§SELLO§");
const normFuente = fuenteJs.replace(reSello, "§SELLO§");
ok(normDep === normFuente, "P-1 script desplegado == fuente app.js (sello normalizado)");
ok((fuenteJs.match(/§SELLO§/g) || []).length === 1, "P-1 la fuente tiene exactamente UNA aparición de §SELLO§");
ok(!/<script/i.test(fuenteJs), "P-1 la fuente app.js no contiene ningún <script");

// P-2: carcasa desplegada == plantilla con la marca donde iba el script
// (el bloque sentry vive literal en la plantilla: no se sustituye).
const carcasa = bloqApp ? depHtml.replace(bloqApp[0], "<!--SCRIPT-->") : "";
ok(carcasa === plantilla, "P-2 carcasa del desplegado == index-sin-script.html con <!--SCRIPT-->");
ok((plantilla.match(/<!--SCRIPT-->/g) || []).length === 1, "P-2 la plantilla tiene exactamente UNA marca <!--SCRIPT-->");

// P-3: versiones y caché coherentes en v3.
ok(/VERSION\s*=\s*"v3"/.test(ensamblar), "P-3 ensamblar.py declara VERSION = \"v3\"");
ok(/CACHE\s*=\s*"mercado-v3"/.test(ensamblar), "P-3 ensamblar.py declara CACHE = \"mercado-v3\"");
ok(depSw.includes('const CACHE = "mercado-v3";'), "P-3 el sw.js desplegado usa const CACHE = \"mercado-v3\"");
ok(!depSw.includes("§"), "P-3 el sw.js desplegado no conserva ningún marcador § sin estampar");
ok(/Mercado · versión \d{4}-\d{2}-\d{2} \d{2}:\d{2} · caché v3/.test(depHtml), "P-3 el sello estampado en el desplegado es caché v3");

// P-4: dirección del dinero en la frase de empate.
const MALA = "Tu tasa de empate del día: si vendes por encima de ella ganas; por debajo, pierdes.";
ok(!fuenteJs.includes(MALA), "P-4 la frase invertida NO existe en la fuente");
ok(!depHtml.includes(MALA), "P-4 la frase invertida NO existe en el desplegado");
for (const [nombre, texto] of [["fuente", fuenteJs], ["desplegado", depHtml]]) {
  const m = texto.match(/Tu tasa de empate del día:[^<]*/);
  ok(!!m, `P-4 ${nombre}: existe la frase de tasa de empate`);
  const frase = m ? m[0] : "";
  ok(/por debajo,?\s*ganas/i.test(frase), `P-4 ${nombre}: «por debajo» se asocia con ganar`);
  ok(/por encima de ella,?\s*pierdes/i.test(frase), `P-4 ${nombre}: «por encima» se asocia con perder`);
  ok(!/por encima[^.;]*ganas/i.test(frase), `P-4 ${nombre}: «por encima» NO se asocia con ganar`);
  ok(!/por debajo[^.;]*pierdes/i.test(frase), `P-4 ${nombre}: «por debajo» NO se asocia con perder`);
}

/* ================= F) SERVICE WORKERS DEL ORIGEN COMPARTIDO =================
   Chequeo eterno (f): cada service worker solo toca SU propia caché.
   La Cache Storage es de TODO el origen GitHub Pages, no de la carpeta:
   un activate que borra «todo lo que no sea mi caché» destruye las
   cachés de las demás apps. Prueba CONDUCTUAL: se ejecuta el activate
   real de cada SW contra una Cache Storage simulada con cachés propias
   viejas, la viva y varias AJENAS, y se anota qué borra de verdad. */
const CACHES_ORIGEN = ["mercado-v2", "mercado-v3", "minegocio-v12", "minegocio-v13", "minegocio-v14", "mitrabajo-v18", "mitrabajo-v19", "ajena-v1"];
async function barridoSW(nombre, texto, cacheViva, esperado) {
  ok(typeof texto === "string" && texto.length > 0, `F-SW ${nombre}: existe su sw.js`);
  if (!texto) return;
  const handlers = {}; const borradas = [];
  const sandbox = {
    console, URL,
    caches: {
      keys: async () => [...CACHES_ORIGEN],
      delete: async (k) => { borradas.push(k); return true; },
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      match: async () => undefined,
    },
    fetch: async () => { throw new Error("sin red en el banco"); },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    registration: { scope: "https://ernesto5058.github.io/calculadora-ernesto/x/", showNotification: async () => {} },
    location: { origin: "https://ernesto5058.github.io" },
    skipWaiting: async () => {},
    addEventListener: (t, f) => { handlers[t] = f; },
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(texto, sandbox); } catch (e) { ok(false, `F-SW ${nombre}: su sw.js carga sin error (${e.message})`); return; }
  ok(typeof handlers.activate === "function", `F-SW ${nombre}: registra su activate`);
  if (typeof handlers.activate !== "function") return;
  let prom; handlers.activate({ waitUntil: (p) => { prom = p; } });
  await prom;
  ok(borradas.slice().sort().join(",") === esperado.slice().sort().join(","),
    `F-SW ${nombre}: activate borra SOLO sus cachés viejas [${esperado.join(", ")}] (borró: ${borradas.join(", ") || "ninguna"})`);
  ok(!borradas.includes(cacheViva), `F-SW ${nombre}: jamás borra su caché viva (${cacheViva})`);
  ok(!borradas.some((k) => !k.startsWith(esperado[0].split("-v")[0] + "-")), `F-SW ${nombre}: ninguna caché ajena tocada`);
}
{
  const fuenteSw = leer(path.join(SRC, "sw.js"));
  await barridoSW("Mercado desplegado", depSw, "mercado-v3", ["mercado-v2"]);
  await barridoSW("Mercado fuente", fuenteSw && fuenteSw.replaceAll("§CACHE§", "mercado-v3"), "mercado-v3", ["mercado-v2"]);
  await barridoSW("Mi Negocio", leer(path.join(REPO, "minegocio", "sw.js")), "minegocio-v15", ["minegocio-v12", "minegocio-v13", "minegocio-v14"]);
  await barridoSW("Mi Trabajo", leer(path.join(REPO, "buscadores", "sw.js")), "mitrabajo-v20", ["mitrabajo-v18", "mitrabajo-v19"]);
}

console.log(`\nPARIDAD MERCADO: ${pass} PASS · ${fail} FAIL`);
if (fail) { console.log("Fallos:", fails.join(" | ")); process.exit(1); }

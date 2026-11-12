// Copia para CI (GitHub Actions) del banco vivo en research_notes — mismos chequeos,
// solo cambian las rutas: jsdom por nombre y la raíz del repo se resuelve desde este archivo
// (o la variable BANCO_REPO). G8b se adapta: fuera del repo no hay fuentes de Mi Negocio,
// así que mira el build de Mercado. Si el banco vivo cambia, se refresca esta copia.
/* Banco v1.4.6 — Mi Trabajo: cadena Firebase (google-services en el
   build) + guía del trabajador «¿Para qué es esta app?» arriba de Ayuda.
   Aserciones de presencia/estructura sobre el build ENSAMBLADO y los
   archivos del repo; la entrega real en un Android queda fuera (es la
   única prueba que esta máquina no puede hacer). */
import { JSDOM } from "jsdom";
import fs from "fs";

import { fileURLToPath } from "url";
const RAIZ = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/$/, "");
const html = fs.readFileSync(RAIZ + "/buscadores/index.html", "utf8");
const sw = fs.readFileSync(RAIZ + "/buscadores/sw.js", "utf8");
const datos = JSON.parse(fs.readFileSync(RAIZ + "/buscadores/datos.json", "utf8"));

let pass = 0, fail = 0;
function ok(c, n){ if (c) pass++; else { fail++; console.log("FAIL:", n); } }

/* ---- Versión y caché ---- */
ok(/var APP_VERSION = "1\.4\.8"/.test(html), "G1 APP_VERSION 1.4.8 en el build ensamblado");
ok(sw.includes('CACHE = "mitrabajo-v15"'), "G2 el SW sube a mitrabajo-v15");
ok(datos.versionApp === "1.4.8" && /apk-v1\.4\.8\/Mi-Trabajo-v1\.4\.8\.apk$/.test(datos.apkUrl),
   "G3 datos.json: versionApp 1.4.8 y apkUrl de la v1.4.8");
ok(datos.tarifa && datos.tarifa.ingresoRef360 === 1098.68 && datos.tarifa.libroRef === 1069.38 &&
   datos.tarifa.pctSaldo === 25 && datos.tarifa.pctTransf === 20 && datos.tarifa.pisoTransf === 25 &&
   datos.publico && datos.publico.telefono === "51231558",
   "G3b datos.json: tarifa y bloque público intactos");

/* ---- Guía del trabajador en Ayuda ---- */
const TITULO = "¿Para qué es esta app?";
ok(html.includes(TITULO), "G4 la guía «¿Para qué es esta app?» existe en el build");
const iVista = html.indexOf('id="viewAyuda"');
const iGuia = html.indexOf(TITULO);
const iChat = html.indexOf('class="card chatCard"');
ok(iVista > -1 && iGuia > iVista && iChat > -1 && iGuia < iChat,
   "G5 la guía es la PRIMERA tarjeta de la vista Ayuda (antes de la tarjeta del chat)");
for (const frase of ["llevar TUS cuentas claras", "solo lo ves tú",
    "<b>Calculadora:</b>", "cuánto es TU comisión",
    "<b>Reportar:</b>", "Ernesto lo confirma y queda registrado",
    "<b>Chat:</b>", "se guarda y sale solo cuando vuelva",
    "<b>Textos:</b>", "Compro saldo · Recarga y cambio · Transferencia",
    "<b>Mi panel:</b>", "cuánto te falta para los 300 CUP",
    "<b>Avisos:</b>", "acepta el permiso de notificaciones",
    "<b>Regla simple:</b>", "la cuenta final la confirma Ernesto con los números reales"]) {
  ok(html.includes(frase), "G6 la guía contiene: «" + frase + "»");
}

/* DOM: dentro de #viewAyuda, la primera .card es la guía, con 6 filas */
const dom = new JSDOM(html);
const vista = dom.window.document.querySelector("#viewAyuda");
ok(!!vista, "G7 la vista Ayuda existe en el DOM");
const primera = vista ? vista.querySelector(".card") : null;
ok(!!primera && primera.textContent.includes(TITULO),
   "G7b la primera tarjeta del DOM de Ayuda es la guía");
ok(primera && primera.querySelectorAll(".guiaRow").length === 6,
   "G7c la guía tiene sus 6 filas de funciones (Calculadora, Reportar, Chat, Textos, Mi panel, Avisos)");

/* La guía NO aparece en «Mi Negocio» (ni en su build ni en sus fuentes) */
const mnBuild = fs.readFileSync(RAIZ + "/minegocio/index.html", "utf8");
ok(!mnBuild.includes(TITULO), "G8 la guía NO está en el build de Mi Negocio");
const mercadoBuild = fs.readFileSync(RAIZ + "/mercado/index.html", "utf8");
ok(!mercadoBuild.includes(TITULO), "G8b la guía tampoco está en el build de Mercado (en el banco local, G8b mira las fuentes de Mi Negocio, fuera del repo)");

/* ---- Cadena Firebase: google-services del build ---- */
const gsPath = RAIZ + "/android/app/google-services.json";
ok(fs.existsSync(gsPath), "G9 android/app/google-services.json existe en el repo (lo consume el build)");
let gs = null;
try { gs = JSON.parse(fs.readFileSync(gsPath, "utf8")); } catch (e) { /* queda null */ }
ok(!!gs && gs.project_info && gs.project_info.project_id === "mi-trabajo-77b9b",
   "G9b google-services.json: project_id mi-trabajo-77b9b");
ok(!!gs && Array.isArray(gs.client) && gs.client[0] &&
   gs.client[0].client_info.android_client_info.package_name === "cu.ernesto.mitrabajo",
   "G9c google-services.json: package_name cu.ernesto.mitrabajo");

/* La app sigue llamando a la puerta nativa (cableado cliente intacto) */
ok(html.includes("registrar_push_nativo"), "G10 el build sigue llamando a registrar_push_nativo");

console.log("\nBANCO MI TRABAJO v1.4.6: " + pass + " PASS · " + fail + " FAIL");
process.exit(fail ? 1 : 0);

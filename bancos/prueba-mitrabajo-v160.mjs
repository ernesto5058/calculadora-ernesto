// Banco Mi Trabajo v1.6.0 — TARIFA VIVA del buscador (2026-11-13).
// CHEQUEOS fila 72. Lo que ve el buscador AL USAR la app:
//   · tarjeta «Tarifa viva» siempre visible con las dos patas en su
//     lenguaje (recarga / QUSD) y la frescura de la foto;
//   · FRONTERA: la salida del dueño (987.65 en el fixture, valor
//     sonda) NO aparece en la tarjeta NI en el panel;
//   · el formulario de reporte estima «con la tarifa de ahora ganas
//     ≈X» con SUS estrellas (32% del fixture);
//   · el panel suma «hoy has ganado» solo con tratos de hoy y cada
//     trato lleva su FOTO de tarifa (ref360 / refLibro);
//   · si hay propuesta grande en espera, la tarjeta lo dice (sin
//     valores de la propuesta).
import { JSDOM } from "jsdom";
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "buscadores/index.html", "utf8");
const sw = fs.readFileSync(REPO + "buscadores/sw.js", "utf8");
const datosTxt = fs.readFileSync(REPO + "buscadores/datos.json", "utf8");
const datos = JSON.parse(datosTxt);
let pass = 0, fail = 0;
function ok(c, n){ if (c) pass++; else { fail++; console.log("FAIL:", n); } }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

/* ===== Estático ===== */
ok(/var APP_VERSION = "1\.6\.0"/.test(html), "V1 APP_VERSION 1.6.0 en el build ensamblado");
ok(sw.includes('CACHE = "mitrabajo-v30"'), "V2 el SW sube a mitrabajo-v30 (v29 + nowrap en la fila de ganancia de la tarjeta viva)");
ok(datos.versionApp === "1.5.6", "V3 datos.json sigue anunciando la APK 1.5.6 (web-only)");
ok(html.includes('version:"1.6.0"'), "V4 SENTRY_CASA con version 1.6.0");
ok(html.includes('id="tvBox"') && html.includes('id="r_est_s"') && html.includes('id="r_est_t"') && html.includes('id="p_hoy"'),
   "V5 la tarjeta viva, los estimados y «hoy has ganado» existen en el esqueleto");

/* ===== Runtime (jsdom, sesión PEUEBA) ===== */
const SALIDA_SONDA = 987.65;
let PROP = false;
function fstr(d){ return d.getDate() + "/" + (d.getMonth() + 1) + "/" + d.getFullYear(); }
function crear(){
  const hoy = new Date(), ayer = new Date(Date.now() - 86400000);
  const tratos = [
    { tipo: "saldo", fecha: fstr(hoy), nota: "Saldo · 4 recargas", comision: 31.58, recargas: 4, ref360: 1098.68, estado: "pendiente" },
    { tipo: "transferencia", fecha: fstr(hoy), nota: "Transferencia · 5,000 CUP", comision: 50, monto: 5000, refLibro: 1111.74, estado: "pendiente" },
    { tipo: "saldo", fecha: fstr(ayer), nota: "Saldo de ayer", comision: 999, recargas: 9, estado: "pendiente" } ];
  const dom = new JSDOM(html, { url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/?codigo=PEUEBA",
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w){
      w.fetch = function(url, opts){
        const u = String(url);
        const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v === undefined ? null : v)), json: () => Promise.resolve(v) });
        if (u.includes("/rpc/")) {
          const fn = u.split("/rpc/")[1].split("?")[0];
          switch (fn) {
            case "validar_usuario": return json([{ codigo: "PEUEBA", nombre: "Prueba Ojo", activo: true, bloqueado: false }]);
            case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1111.74, salida_ref: SALIDA_SONDA, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: "2026-11-13 15:00" });
            case "tarifa_viva_buscador": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1111.74,
              actualizado: "2026-11-13T19:56:00Z", foto_recibida_en: "2026-11-13T19:55:00Z", fresca: true, edad_min: 7, hay_propuesta_pendiente: PROP });
            case "dinero_leer_estado": return json({ rol: "buscador", buscador: "PEUEBA",
              estrellas: { estrellas: 4.9, pct_saldo: 32, pct_transferencia: 26, conteo_ganadoras: 75,
                siguiente: { umbral_conteo: 100, estrellas: 5, pct_saldo: 35, faltan: 25 } },
              cupo: 14500, en_mano: 10126, vueltas: [] });
            case "leer_panel": return json({ ok: true, nombre: "Prueba Ojo", tratos });
            case "estado_reportes": return json([]);
            case "mensajes_sin_leer": return json({ ok: true, total: 0 });
            case "ver_presencia": return json({ ok: true, ts: null });
            default: return json({ ok: true });
          }
        }
        if (u.includes("datos.json")) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(datosTxt), json: () => Promise.resolve(datos) });
        return json(null);
      };
    } });
  return { dom, w: dom.window };
}
function input(el, v){ el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true })); }

{
  PROP = false;
  const { w } = crear();
  await sleep(800);
  const tv = w.document.getElementById("tvBox");
  ok(tv && tv.style.display !== "none" && tv.textContent.includes("TARIFA VIVA"), "T1 la tarjeta viva se ve al entrar");
  ok(tv.textContent.includes("1,098.68") && tv.textContent.includes("1,111.74"), "T2 las dos patas con la tarifa vigente (1,098.68 · 1,111.74)");
  ok(tv.textContent.includes("hace 7 min"), "T3 la frescura de la foto va escrita (hace 7 min)");
  ok(!tv.textContent.includes("987"), "T4 FRONTERA: la salida del dueño NO está en la tarjeta");
  ok(tv.textContent.includes("del momento en que Ernesto cierre"), "T5 la regla de oro va en la tarjeta");
  input(w.document.getElementById("r_precio"), "1000");
  input(w.document.getElementById("r_cant"), "4");
  await sleep(80);
  const est = w.document.getElementById("r_est_s");
  ok(est && est.textContent.includes("ganas ≈") && est.textContent.includes("126.31"),
     "T6 el reporte estima con SUS estrellas: (98.68×4)×32% = 126.31 (vino: " + (est && est.textContent) + ")");
  const hoy = w.document.getElementById("p_hoy");
  ok(hoy && hoy.textContent.includes("81.58"), "T7 «hoy has ganado» suma solo hoy: 31.58 + 50 = 81.58 (vino: " + (hoy && hoy.textContent) + ")");
  const tratos = w.document.getElementById("p_tratos");
  ok(tratos.textContent.includes("Tarifa de este trato: 1,098.68"), "T8 el trato de saldo lleva su foto de tarifa");
  ok(tratos.textContent.includes("Libro de este trato: 1,111.74"), "T9 el trato de transferencia lleva su foto de libro");
  ok(!tratos.textContent.includes("987"), "T10 FRONTERA: la salida tampoco está en el panel");
  w.close();
}
{
  PROP = true;
  const { w } = crear();
  await sleep(800);
  const tv = w.document.getElementById("tvBox");
  ok(tv.textContent.includes("esperando la aprobación de Ernesto"), "T11 con propuesta grande, la tarjeta avisa que Ernesto decide");
  ok(!tv.textContent.includes("1310"), "T12 FRONTERA: los valores de la propuesta NO llegan al buscador");
  w.close();
}

console.log("\nBANCO MI TRABAJO v1.6.0 · TARIFA VIVA: " + pass + " PASS · " + fail + " FAIL");
process.exitCode = fail ? 1 : 0;

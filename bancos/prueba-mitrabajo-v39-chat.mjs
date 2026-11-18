// Banco Mi Trabajo v39 — CHAT DE BUSCADORES PRO (tanda 2026-11-18).
// jsdom sobre el build ensamblado, estilo de la suite v180.
// Cubre el contrato MT v39:
//   · presión larga real (550 ms) abre el menú; el clic normal YA NO;
//     mover >10 px cancela; los medios conservan su clic;
//   · «Ya compré»: encola OFFLINE en busc_parte_outbox con su opId,
//     aviso local «en cola» en el hilo, y despacha parte_crear UNA
//     vez con ese opId al volver la red;
//   · mensajes adj_tipo='parte' y 'tarifa' se pintan como TARJETA
//     (no texto); el estado del parte se refresca con parte_leer;
//   · barra de fijado con fijado_tipo='tarifa_viva' pinta la tarifa
//     ACTUAL de leer_tarifa con su hora;
//   · cabecera viva: En mano · Libre · Mi ganancia de las fixtures
//     de esperas_mi_estado + dinero_leer_estado.
import { JSDOM } from "jsdom";
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "buscadores/index.html", "utf8");
const sw = fs.readFileSync(REPO + "buscadores/sw.js", "utf8");
const datosTxt = fs.readFileSync(REPO + "buscadores/datos.json", "utf8");
let pass = 0, fail = 0;
function ok(c, n){ if (c) pass++; else { fail++; console.log("FAIL:", n); } }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function click(w, el){ if (el) el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })); }
function input(el, v){ el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true })); }
function puntero(w, el, tipo, x, y){
  const ev = new w.Event(tipo, { bubbles: true, cancelable: true });
  ev.clientX = x || 0; ev.clientY = y || 0;
  el.dispatchEvent(ev);
}

ok(/var APP_VERSION = "1\.9\.0"/.test(html), "V1 APP_VERSION 1.9.0");
ok(sw.includes('CACHE = "mitrabajo-v39"'), "V2 SW mitrabajo-v39");
ok(html.includes('id="c_parte_btn"') && html.includes('id="c_parte_hoja"') && html.includes('id="c_estado"'),
   "V3 esqueleto v39: botón «Ya compré», su hoja y la línea de cabecera viva existen");

const HOY = new Date().toISOString();
const SNAP_PARTE = JSON.stringify({ parte_id: "pt1", tipo: "saldo", tasa: 1000, total_pagado: 4000, telefono: "51234567", estado: "pendiente" });
const SNAP_TARIFA = JSON.stringify({ ingresoRef360: 1098.68, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, actualizado: HOY });
let CHAT_MSGS = [
  { id: 1, de: "ADMIN", para: "PEUEBA", texto: "hola buscador", creado: HOY, leido: true },
  { id: 2, de: "PEUEBA", para: "ADMIN", texto: "hola Ernesto", creado: HOY, leido: true },
  { id: 10, de: "PEUEBA", para: "ADMIN", texto: "", adj_tipo: "parte", adj_datos: SNAP_PARTE, creado: HOY, leido: true },
  { id: 11, de: "ADMIN", para: "PEUEBA", texto: "", adj_tipo: "tarifa", adj_datos: SNAP_TARIFA, creado: HOY, leido: true },
];
const LLAMADAS = [];
let PARTE_RED_OK = false;   // apagada: parte_crear «sin red» (rpcChat devuelve null)
function crear(){
  const dom = new JSDOM(html, { url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/?codigo=PEUEBA",
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w){
      w.localStorage.setItem("busc_guia_v170", "1");
      w.fetch = function(url, opts){
        const u = String(url);
        const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v === undefined ? null : v)), json: () => Promise.resolve(v) });
        const err = () => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("{}"), json: () => Promise.resolve({}) });
        if (u.includes("/rpc/")) {
          const fn = u.split("/rpc/")[1].split("?")[0];
          let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch(e){}
          LLAMADAS.push({ fn, body });
          switch (fn) {
            case "validar_usuario": return json([{ codigo: "PEUEBA", nombre: "Prueba Ojo", activo: true, bloqueado: false }]);
            case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1111.74, salida_ref: 950, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: HOY });
            case "tarifa_viva_buscador": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1111.74, actualizado: HOY, foto_recibida_en: HOY, fresca: true, edad_min: 3, ultimo_ajuste: null });
            case "dinero_leer_estado": return json({ rol: "buscador", buscador: "PEUEBA",
              estrellas: { estrellas: 4.9, pct_saldo: 32, pct_transferencia: 26, conteo_ganadoras: 75, siguiente: null },
              cupo: 14500, en_mano: 10000,
              vueltas: [ { id: "v1", tipo: "saldo", estado: "abierta", capital: 4000, pago_hecho: false, proyeccion: { comision_proyectada: 300 } } ],
              capital: { en_mano: 10000, pendientes: 0, devolvible: 10000, trabajando: 4000, cerrado: false }, devoluciones: [] });
            case "leer_panel": return json({ ok: true, nombre: "Prueba Ojo", tratos: [] });
            case "estado_reportes": return json([]);
            case "mensajes_sin_leer": return json({ ok: true, sin_leer: 0 });
            case "ver_presencia": return json({ ok: true, usuarios: [{ codigo: "ADMIN", nombre: "Ernesto", visto: HOY }] });
            case "leer_chat_ligero": return json({ ok: true, mensajes: CHAT_MSGS, fijado: { id: 77, texto: "texto congelado viejo" }, fijado_tipo: "tarifa_viva", fijado_id: 77, temporal_seg: 0 });
            case "leer_chat": return json({ ok: true, mensajes: CHAT_MSGS, fijado: null, temporal_seg: 0 });
            case "esperas_mi_estado": return json({ ok: true, buscador: "PEUEBA", en_mano: 10000, comprometido: 4000, libre: 6000, esperas: [] });
            case "parte_leer": return json({ ok: true, id: "pt1", estado: "confirmada", tipo: "saldo", tasa: 1000, total_pagado: 4000, telefono: "51234567", espera_id: "e9", creado_en: HOY, confirmado_en: HOY, motivo_rechazo: null });
            case "parte_crear": return PARTE_RED_OK ? json({ ok: true, parte_id: "pt9", estado: "pendiente", espera_id: null, repetida: false }) : err();
            case "pago_mi_estado": return json({ ok: true, buscador: "PEUEBA", vueltas: [] });
            case "enviar_mensaje": return json({ ok: true, id: 99 });
            default: return json({ ok: true });
          }
        }
        if (u.includes("datos.json")) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(datosTxt), json: () => Promise.resolve(JSON.parse(datosTxt)) });
        return json(null);
      };
    } });
  return { dom, w: dom.window };
}
const llamadasA = fn => LLAMADAS.filter(x => x.fn === fn);

{
  LLAMADAS.length = 0;
  const { w } = crear();
  const d = w.document;
  await sleep(1000);
  w.showView("Ayuda");
  await sleep(400);
  const hilo = d.getElementById("c_hilo");

  /* --- Tarjetas parte / tarifa --- */
  const nodoParte = hilo.querySelector('[data-mid="10"]');
  ok(!!nodoParte && !!nodoParte.querySelector(".tarjParte"), "T1 el mensaje adj_tipo='parte' se pinta como TARJETA (.tarjParte), no como texto");
  ok(!!nodoParte && nodoParte.textContent.includes("Parte de compra") && nodoParte.textContent.includes("4,000"),
     "T2 la tarjeta del parte enseña tipo/total del snapshot");
  await sleep(300);
  ok(nodoParte.textContent.includes("Espera creada"), "T3 el estado se refresca con parte_leer: pendiente → confirmada («Espera creada ✓»)");
  ok(llamadasA("parte_leer").length >= 1 && llamadasA("parte_leer")[0].body.p_parte_id === "pt1",
     "T4 parte_leer se llamó con el parte_id del snapshot");
  const nodoTarifa = hilo.querySelector('[data-mid="11"]');
  ok(!!nodoTarifa && !!nodoTarifa.querySelector(".tarjTarifa") && nodoTarifa.textContent.includes("Tarifa de las"),
     "T5 el mensaje adj_tipo='tarifa' se pinta como TARJETA con «Tarifa de las HH:MM»");

  /* --- Fijado tarifa viva --- */
  const fj = d.getElementById("c_fijado");
  ok(fj.style.display === "block" && fj.textContent.includes("Tarifa vigente") && fj.textContent.includes("950")
     && !fj.textContent.includes("texto congelado viejo"),
     "F1 fijado_tipo='tarifa_viva': la barra pinta la tarifa ACTUAL de leer_tarifa (salida 950), no el texto congelado");

  /* --- Cabecera viva --- */
  const cab = d.getElementById("c_estado");
  ok(cab.textContent.includes("En mano") && cab.textContent.includes("10,000"), "C1 cabecera: En mano 10,000 de esperas_mi_estado");
  ok(cab.textContent.includes("Libre") && cab.textContent.includes("6,000"), "C2 cabecera: Libre 6,000 de esperas_mi_estado");
  ok(cab.textContent.includes("Mi ganancia") && cab.textContent.includes("300"), "C3 cabecera: Mi ganancia 300 (comisión proyectada de su vuelta en dinero_leer_estado)");

  /* --- Presión larga vs clic --- */
  const menu = d.getElementById("c_menu");
  const burb = hilo.querySelector('[data-mid="2"]');
  click(w, burb); await sleep(60);
  ok(menu.style.display !== "block", "PL1 el clic normal sobre el texto YA NO abre el menú");
  puntero(w, burb, "pointerdown", 10, 10);
  await sleep(650);
  ok(menu.style.display === "block", "PL2 la presión larga (550 ms) SÍ abre el menú (abrirMenuMsg)");
  click(w, burb); await sleep(40);
  ok(menu.style.display === "block", "PL3 el clic que sigue a la presión cumplida se suprime (el menú no se cierra por ese clic)");
  menu.style.display = "none";
  puntero(w, burb, "pointerdown", 10, 10);
  puntero(w, burb, "pointermove", 40, 10);
  await sleep(650);
  ok(menu.style.display !== "block", "PL4 mover el dedo >10 px cancela la presión larga");

  /* --- «Ya compré» offline → despacha UNA vez --- */
  PARTE_RED_OK = false;
  click(w, d.getElementById("c_parte_btn")); await sleep(60);
  ok(d.getElementById("c_parte_hoja").classList.contains("abierta"), "Y1 el botón «Ya compré» (≥44 px) abre la hoja del parte");
  input(d.getElementById("cp_tasa"), "1000");
  input(d.getElementById("cp_total"), "4000");
  input(d.getElementById("cp_tel"), "51234567");
  const antes = llamadasA("parte_crear").length;
  click(w, d.getElementById("cp_btn")); await sleep(250);
  const cola = JSON.parse(w.localStorage.getItem("busc_parte_outbox") || "[]");
  ok(cola.length === 1 && !!cola[0].opId && cola[0].tipo === "saldo" && cola[0].total === 4000,
     "Y2 sin red: el parte queda EN COLA en busc_parte_outbox con su opId (offline-first)");
  ok(hilo.textContent.includes("En cola"), "Y3 el aviso local «En cola» se ve en el hilo mientras tanto");
  PARTE_RED_OK = true;
  const antes2 = llamadasA("parte_crear").length;
  w.despacharParte(); await sleep(300);
  const pcs = llamadasA("parte_crear").slice(antes2);
  ok(pcs.length === 1 && pcs[0].body.p_op_id === cola[0].opId && pcs[0].body.p_total_pagado === 4000 && pcs[0].body.p_telefono === "51234567",
     "Y4 al volver la red despacha parte_crear UNA sola vez, con su opId, tasa, total y teléfono");
  ok(JSON.parse(w.localStorage.getItem("busc_parte_outbox") || "[]").length === 0,
     "Y5 asentado el parte, la cola queda vacía");
  w.despacharParte(); await sleep(120);
  ok(llamadasA("parte_crear").length === antes2 + 1, "Y6 un segundo despacho no duplica (la cola ya no tiene el parte)");
  w.close();
}

console.log("\nBANCO MI TRABAJO v39 · CHAT PRO: " + pass + " PASS · " + fail + " FAIL");
process.exitCode = fail ? 1 : 0;

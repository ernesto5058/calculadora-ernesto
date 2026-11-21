// Banco Mi Trabajo v40 — CHAT PRO (regresión v39) + oleada PRO v40 (plan Mi Trabajo PRO, 2026-11-20).
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

ok(/var APP_VERSION = "1\.10\.0"/.test(html), "V1 APP_VERSION 1.10.0");
ok(sw.includes('CACHE = "mitrabajo-v40"'), "V2 SW mitrabajo-v40");
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

/* =====================================================================
   PRO v40 — la oleada del plan: núcleo de dinero puro (equivalencia
   con las fórmulas viejas), cliente API con reintento e idempotencia,
   barra de sincronización, Ahora, calculadoras A2, 3 estados, Cerrar
   el día, Mi pago en 4 pasos, línea de tiempo, plantillas, PIN local
   y confirmación de devolución. Fixtures propias (crearPRO). */
let REP_MODO = "ok";          // ok | red1 (falla de red una vez) | error500
let REP_INSERTOS = 0;
const REP_OPS = new Set();
function crearPRO(){
  const dom = new JSDOM(html, { url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/?codigo=PEUEBA",
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w){
      w.localStorage.setItem("busc_guia_v170", "1");
      w.fetch = function(url, opts){
        const u = String(url);
        const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v === undefined ? null : v)), json: () => Promise.resolve(v) });
        if (u.includes("/rpc/")) {
          const fn = u.split("/rpc/")[1].split("?")[0];
          let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch(e){}
          LLAMADAS.push({ fn, body });
          switch (fn) {
            case "validar_usuario": return json([{ codigo: "PEUEBA", nombre: "Prueba Ojo", activo: true, bloqueado: false }]);
            case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1111.74, salida_ref: 950, comision_saldo: 32, comision_transf: 26, piso_transf: 25, actualizado: HOY });
            case "tarifa_viva_buscador": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1111.74, actualizado: HOY, foto_recibida_en: HOY, fresca: true, edad_min: 3, ultimo_ajuste: null });
            case "dinero_leer_estado": return json({ rol: "buscador", buscador: "PEUEBA",
              estrellas: { estrellas: 4.9, pct_saldo: 32, pct_transferencia: 26, conteo_ganadoras: 75, siguiente: null },
              cupo: 14500, en_mano: 10000,
              vueltas: [ { id: "v1", tipo: "saldo", estado: "abierta", capital: 4000, pago_hecho: false, proyeccion: { comision_proyectada: 300 } } ],
              capital: { en_mano: 10000, pendientes: 0, devolvible: 10000, trabajando: 4000, cerrado: false }, devoluciones: [] });
            case "leer_panel": return json({ ok: true, nombre: "Prueba Ojo", tratos: [] });
            case "registrar_reporte": {
              if (REP_MODO === "red1" && !REP_OPS.has(body.p_op_id + ":intento")) { REP_OPS.add(body.p_op_id + ":intento"); return Promise.reject(new Error("red caída")); }
              if (REP_MODO === "error500") return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("{}"), json: () => Promise.resolve({ message: "boom" }) });
              if (!REP_OPS.has(body.p_op_id)) { REP_OPS.add(body.p_op_id); REP_INSERTOS++; }
              return json("rep-1");
            }
            case "estado_reportes": return json([]);
            case "mensajes_sin_leer": return json({ ok: true, sin_leer: 2 });
            case "ver_presencia": return json({ ok: true, usuarios: [{ codigo: "ADMIN", nombre: "Ernesto", visto: HOY }] });
            case "leer_chat_ligero": return json({ ok: true, mensajes: [], fijado: null, temporal_seg: 0 });
            case "leer_chat": return json({ ok: true, mensajes: [], fijado: null, temporal_seg: 0 });
            case "esperas_mi_estado": return json({ ok: true, buscador: "PEUEBA", en_mano: 10000, comprometido: 4000, libre: 6000, esperas: [
              { id: "e1", tipo: "saldo", estado: "abierta", cantidad: 3600, capital_cup: 4000, tasa_pactada: 2.78, creada_en: HOY, vueltas: 0 },
              { id: "e2", tipo: "saldo", estado: "cumplida", cantidad: 3600, cantidad_real: 3600, capital_cup: 4000, creada_en: HOY, vueltas: 1 } ] });
            case "pago_mi_estado": return json({ ok: true, buscador: "PEUEBA",
              vueltas: [ { tipo: "saldo", fijo: 1000, premio: 200, total: 300 } ],
              ganado_comision: 1000, ganado_premio: 500, entregado: 300, pendiente_entrega: 1200 });
            case "dinero_registrar_devolucion_efectivo": return json({ ok: true, devolucion: "dv1", estado: "pendiente" });
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

/* --- B3 · núcleo puro: equivalencia con las fórmulas viejas + reglas --- */
{
  const { w } = crearPRO();
  await sleep(300);
  const N = w.DINERO_NUCLEO;
  ok(!!N && typeof N.comisionSaldo === "function" && typeof N.redondeoDecena === "function", "N1 el núcleo de dinero puro existe (DINERO_NUCLEO)");
  function refSaldo(ref, precio, pct, cant){ var exc = ref - precio; if (exc <= 0) return { fee: 0, exc: exc }; return { fee: exc * (pct/100) * cant, exc: exc }; }
  function refTransf(ef, pct, libro, salida, pctT){ var recibe = ef * (1 + pct/100); var qusd = recibe / libro; var regreso = qusd * salida; var gan = regreso - ef; return { recibe: recibe, qusd: qusd, regreso: regreso, ganancia: gan, fee: Math.max(0, gan) * (pctT/100) }; }
  let eqS = true;
  [1098.68, 1000, 950].forEach(function(ref){ [900, 950, 1000, 1098.68, 1200].forEach(function(pr){ [25, 26.2, 32].forEach(function(pc){ [1, 3, 7].forEach(function(ct){
    const a = N.comisionSaldo(ref, pr, pc, ct), b = refSaldo(ref, pr, pc, ct);
    if (a.fee !== b.fee || a.exc !== b.exc) eqS = false;
  }); }); }); });
  ok(eqS, "N2 comisionSaldo del núcleo = fórmula vieja en toda la rejilla (idéntica, ni un centavo distinto)");
  let eqT = true;
  [1000, 5000, 12345].forEach(function(ef){ [20, 25, 30, 40].forEach(function(pc){ [1069.38, 1111.74].forEach(function(lb){
    const a = N.comisionTransf(ef, pc, lb, 950, 26), b = refTransf(ef, pc, lb, 950, 26);
    if (a.fee !== b.fee || a.ganancia !== b.ganancia || a.recibe !== b.recibe) eqT = false;
  }); }); });
  ok(eqT, "N3 comisionTransf del núcleo = fórmula vieja en toda la rejilla");
  const red = [[125,120],[126,130],[115,110],[135,130],[5,0],[15,10],[0,0],[999,1000],[994,990],[262,260]];
  ok(red.every(function(par){ return N.redondeoDecena(par[0]) === par[1]; }), "N4 redondeo a la decena con el 5 hacia abajo (125→120, 126→130, 999→1000)");
  const c0 = N.cadenaCiclo(0, 26.2, 0), cN = N.cadenaCiclo(-50, 26.2, 0);
  ok(c0.pago === 0 && c0.sinGanancia === true && cN.pago === 0, "N5 sin ganancia no hay comisión (cadena en cero)");
  const c1 = N.cadenaCiclo(1000, 26.2, 0), c2 = N.cadenaCiclo(1000, 26.2, 100), c3 = N.cadenaCiclo(100, 26.2, 500);
  ok(c1.redondeado === 260 && c1.pago === 260 && c2.pago === 160 && c3.pago === 0, "N6 cadena: bruto 262 → redondeo final 260 → menos recupero; recupero mayor que el pago → 0");
  ok(N.pisoTransfOk(25, 25) === true && N.pisoTransfOk(24.9, 25) === false, "N7 piso de transferencia: 25 sí, 24.9 no");
  w.close();
}

/* --- A1/A2/A3/A6/A7/C5/C6 + B1/B4 sobre fixtures --- */
{
  LLAMADAS.length = 0; REP_MODO = "ok"; REP_INSERTOS = 0; REP_OPS.clear();
  const { w } = crearPRO();
  const d = w.document;
  await sleep(1200);

  /* A1 · Ahora */
  ok(!d.getElementById("viewAhora").classList.contains("hide"), "A1.1 «Ahora» es la vista de apertura");
  ok(d.getElementById("ah_mano").textContent.includes("10,000"), "A1.2 Ahora enseña el capital en mano de dinero_leer_estado");
  ok(d.getElementById("ah_esperas").textContent === "1", "A1.3 Ahora cuenta las vueltas esperando prueba (1 abierta)");
  click(w, d.getElementById("ah_rep")); await sleep(60);
  ok(!d.getElementById("viewRep").classList.contains("hide") && d.getElementById("viewAhora").classList.contains("hide"), "A1.4 el CTA «Reportar trato» lleva a Reportar");
  click(w, d.getElementById("tabAhora")); await sleep(60);
  click(w, d.getElementById("ah_parte")); await sleep(300);
  ok(!d.getElementById("viewEsperas").classList.contains("hide"), "A1.5 el CTA «Enviar parte de vuelta» lleva a Mis esperas (el parte)");
  click(w, d.getElementById("tabAhora")); await sleep(60);
  click(w, d.getElementById("ah_calc")); await sleep(60);
  ok(!d.getElementById("viewCalc").classList.contains("hide"), "A1.6 la Calculadora queda a un botón secundario");

  /* A2 · calculadoras separadas */
  w.showView("Calc"); await sleep(60);
  input(d.getElementById("s_precio"), "950"); input(d.getElementById("s_cant"), "1"); await sleep(60);
  ok(d.getElementById("s_det").textContent.includes("Mínimo para aceptar") && d.getElementById("s_det").textContent.includes("1,098.68"),
     "A2.1 Saldo: referencia, excedente y «mínimo para aceptar» (umbral de excedente, no un 25%)");
  ok(d.getElementById("s_fee").textContent === "$47.58", "A2.2 Saldo: la comisión sigue siendo la de siempre (148.68 × 32% = $47.58 con sus estrellas)");
  input(d.getElementById("s_precio"), "1200"); await sleep(60);
  ok(d.getElementById("s_warn").textContent.includes("no deja excedente para tu comisión"), "A2.3 Saldo sin excedente: el aviso dice que no deja excedente para su comisión");
  input(d.getElementById("t_ef"), "5000"); input(d.getElementById("t_pct"), "20"); await sleep(60);
  ok(d.getElementById("t_warn").textContent.includes("por debajo del mínimo permitido: 25%"), "A2.4 Transferencia: alerta del piso del 25% con su texto");

  /* A3 · tres estados */
  w.showView("Panel"); await sleep(400);
  const te = d.getElementById("tresEst");
  ok(!te.classList.contains("hide") && d.getElementById("te_mano").textContent.includes("10,000") && d.getElementById("te_trab").textContent.includes("4,000"),
     "A3.1 tres estados: En mano y Trabajando del capital del servidor");
  ok(d.getElementById("te_aseg").textContent === "$700.00" && d.getElementById("te_prem").textContent === "$300.00",
     "A3.2 Por cobrar PARTIDO: asegurado pendiente $700 (1000−300) y premio pendiente $300 (500−200), cada uno en su renglón");
  ok(!te.textContent.includes("$1,000.00"), "A3.3 asegurado y premio NO se suman en ningún titular como si fueran lo mismo");

  /* A7 · Mi pago en 4 pasos */
  w.showView("Pago"); await sleep(400);
  ok(d.getElementById("mp_ganado").textContent.includes("Tu pago en 4 pasos") && d.getElementById("mp_ganado").textContent.includes("El redondeo se hace al final"),
     "A7 Mi pago abre con los 4 pasos y la nota fija del redondeo (al final, decena, 5 baja)");

  /* A6 · esperas como línea de tiempo */
  w.showView("Esperas"); await sleep(400);
  const el = d.getElementById("e_lista").textContent;
  ok(el.includes("Esperando prueba") && el.includes("Parte enviado"), "A6.1 la espera abierta se pinta como línea de tiempo (parte → esperando prueba → asentada)");
  ok(el.includes("✓ Asentada") && el.includes("Prueba recibida"), "A6.2 la espera cumplida enseña los tres pasos cumplidos, sin prometer plazos");

  /* C5 · Cerrar el día */
  w.showView("Cerrar"); await sleep(200);
  const cd = d.getElementById("cd_lista").textContent;
  ok(cd.includes("en mano") && cd.includes("esperando prueba") && !cd.includes("Día limpio"),
     "C5.1 Cerrar el día lista lo que falta (mano > 0, vueltas abiertas) y no declara limpio lo que no está");
  ok(cd.includes("nada se cierra"), "C5.2 Cerrar el día declara que nada se cierra solo");

  /* C6+B7 · plantillas offline con la tarifa cacheada */
  w.showView("Textos"); await sleep(300);
  const pls = d.querySelectorAll("#tx_plantillas .planTx");
  ok(pls.length === 8, "C6.1 hay 8 plantillas offline");
  const plTxt = d.getElementById("tx_plantillas").textContent;
  ok(plTxt.includes("51231558") && plTxt.includes("720") && plTxt.includes("al 2"), "C6.2 las plantillas usan SOLO cifras de la tarifa guardada (teléfono, recarga 720, tasa 2)");
  ok(d.getElementById("tx_tarifa_fecha").textContent.length > 0, "B7.3 Textos enseña la fecha de la tarifa que está usando");

  /* A4+C4+B1/B4 · reporte: resumen previo, duplicado, reintento idempotente */
  w.showView("Rep"); await sleep(100);
  input(d.getElementById("r_precio"), "950"); input(d.getElementById("r_cant"), "2"); input(d.getElementById("r_tel"), "51234567");
  click(w, d.getElementById("r_btn")); await sleep(100);
  ok(d.getElementById("r_previo").style.display === "block" && d.getElementById("r_previo_txt").textContent.includes("Vas a reportar"),
     "A4.1 antes de enviar, el resumen en claro («Vas a reportar…» con su comisión estimada)");
  ok(d.getElementById("r_previo_txt").textContent.includes("tarda más en confirmarse"), "A4.2 sin foto: aviso neutro de que tarda más en confirmarse, sin bloquear");
  ok(JSON.parse(w.localStorage.getItem("busc_outbox") || "[]").length === 0, "A4.3 el resumen NO envía nada todavía: la cola sigue vacía");
  REP_MODO = "red1";
  click(w, d.getElementById("r_conf")); await sleep(600);
  const ob = JSON.parse(w.localStorage.getItem("busc_outbox") || "[]");
  ok(ob.length === 1 && ob[0].enviado === true && !!ob[0].opId && !!ob[0].creadoEn,
     "B4.1 el reporte salió con su opId y su hora de creación tras el reintento del cliente");
  const reps = llamadasA("registrar_reporte");
  ok(reps.length === 2 && reps[0].body.p_op_id === reps[1].body.p_op_id && REP_INSERTOS === 1,
     "B1.1 el cliente reintentó UNA vez ante el fallo de red, con la MISMA clave: el servidor insertó UNA sola vez (idempotencia real)");
  ok(d.getElementById("syncBar").textContent.includes("Todo enviado"), "A5.1 con todo asentado, la barra dice «Todo enviado»");
  /* duplicado probable */
  input(d.getElementById("r_precio"), "950"); input(d.getElementById("r_cant"), "2"); input(d.getElementById("r_tel"), "51234567");
  click(w, d.getElementById("r_btn")); await sleep(100);
  ok(d.getElementById("r_previo_dup").style.display === "block" && d.getElementById("r_conf").textContent.includes("Sí, es otro trato"),
     "C4.1 mismo teléfono+tipo+monto en la ventana: aviso de duplicado probable con «Sí, es otro trato»");
  click(w, d.getElementById("r_prev_cancel")); await sleep(60);
  w.close();
}

/* --- B1 · el fallo del servidor ya no es silencio: registro + estado --- */
{
  LLAMADAS.length = 0; REP_MODO = "error500"; REP_INSERTOS = 0; REP_OPS.clear();
  const { w } = crearPRO();
  const d = w.document;
  await sleep(1000);
  w.showView("Rep"); await sleep(100);
  input(d.getElementById("r_precio"), "950"); input(d.getElementById("r_cant"), "1"); input(d.getElementById("r_tel"), "51234567");
  click(w, d.getElementById("r_btn")); await sleep(80);
  click(w, d.getElementById("r_conf")); await sleep(500);
  const ob = JSON.parse(w.localStorage.getItem("busc_outbox") || "[]");
  ok(ob.length === 1 && ob[0].estadoCola === "error" && ob[0].ultimoError === "HTTP 500" && (ob[0].intentos || 0) >= 1,
     "B1.2 el fallo HTTP queda EN la cola: estado «error», último error e intentos (nada falla en silencio)");
  const errs = JSON.parse(w.localStorage.getItem("busc_errores") || "[]");
  ok(errs.some(function(e){ return e.fn === "registrar_reporte" && e.status === 500; }) && !JSON.stringify(errs).includes("51234567"),
     "B1.3 el registro local de errores guarda puerta y status, SIN teléfonos ni cuerpos");
  ok(d.getElementById("syncBar").textContent.includes("revisión"), "A5.2 la barra anuncia que algo necesita revisión");
  click(w, d.getElementById("syncBar")); await sleep(100);
  ok(d.getElementById("syncHoja").classList.contains("abierta") && d.getElementById("sync_lista").textContent.includes("Reporte"),
     "A5.3 la barra abre la hoja con el detalle de lo pendiente y su estado");
  w.close();
}

/* --- A8 · devolución con confirmación explícita --- */
{
  LLAMADAS.length = 0;
  const { w } = crearPRO();
  const d = w.document;
  await sleep(1200);
  w.showView("Panel"); await sleep(300);
  click(w, d.getElementById("cap_btn")); await sleep(60);
  input(d.getElementById("cap_monto"), "5000");
  click(w, d.getElementById("cap_enviar")); await sleep(80);
  ok(d.getElementById("cap_conf").style.display === "block" && d.getElementById("cap_conf_txt").textContent.includes("5,000"),
     "A8.1 devolver capital pide confirmación con el monto en claro ANTES de crear la solicitud");
  ok(JSON.parse(w.localStorage.getItem("busc_dev_outbox") || "[]").length === 0, "A8.2 sin confirmar, no nace ninguna solicitud");
  click(w, d.getElementById("cap_conf_si")); await sleep(400);
  ok(llamadasA("dinero_registrar_devolucion_efectivo").length === 1 && llamadasA("dinero_registrar_devolucion_efectivo")[0].body.p_cliente_id,
     "A8.3 confirmada, la devolución sale UNA vez con su cliente_id (el servidor deduplica)");
  w.close();
}

/* --- B6 · PIN de reapertura: candado local, el código sigue mandando --- */
{
  const { w } = crearPRO();
  const d = w.document;
  await sleep(1000);
  w.showView("Perfil"); await sleep(200);
  input(d.getElementById("pin_nuevo"), "1234");
  click(w, d.getElementById("pin_guardar")); await sleep(300);
  const pinHash = w.localStorage.getItem("busc_pin");
  ok(!!pinHash && pinHash !== "1234", "B6.1 el PIN se guarda como hash en el teléfono, nunca en claro");
  const codigo = w.localStorage.getItem("busc_codigo");
  w.close();
  /* segundo arranque con la sesión guardada y el PIN puesto */
  const dom2 = new JSDOM(html, { url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/",
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w2){
      w2.localStorage.setItem("busc_guia_v170", "1");
      w2.localStorage.setItem("busc_codigo", codigo);
      w2.localStorage.setItem("busc_pin", pinHash);
      w2.fetch = function(url){
        const u = String(url);
        if (u.includes("validar_usuario")) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("[]"), json: () => Promise.resolve([{ codigo: "PEUEBA", nombre: "Prueba Ojo", activo: true, bloqueado: false }]) });
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("null"), json: () => Promise.resolve(null) });
      };
    } });
  const w2 = dom2.window, d2 = w2.document;
  await sleep(400);
  ok(d2.getElementById("pinGate").style.display === "flex" && !w2.SESION, "B6.2 con PIN activo, la sesión guardada NO entra sola: primero el candado");
  input(d2.getElementById("pin_in"), "9999");
  click(w2, d2.getElementById("pin_btn")); await sleep(300);
  ok(d2.getElementById("pin_gwarn").style.display === "block" && !w2.SESION, "B6.3 PIN incorrecto: no entra y lo dice");
  input(d2.getElementById("pin_in"), "1234");
  click(w2, d2.getElementById("pin_btn")); await sleep(300);
  ok(d2.getElementById("pinGate").style.display === "none" && w2.SESION === "PEUEBA", "B6.4 PIN correcto: abre y entra con su código de siempre (el PIN no sustituye al código)");
  w2.close();
}

/* --- B7 · datos.json corregido y versionado --- */
{
  const dj = JSON.parse(datosTxt);
  ok(dj.version === 8 && dj.tarifa.pctSaldo === 26.2 && dj.tarifa.repartoCicloBuscador === 26.2,
     "B7.1 datos.json v8: la referencia de saldo queda en el 26,2% vigente del ciclo (antes 25 del 14/11)");
  ok(dj.tarifa.pisoTransf === 25 && dj.tarifa.pctTransf === 20,
     "B7.2 el piso de transferencia (25%) y la referencia de transferencia (20) NO se tocaron: son otra cosa");
  ok(dj.versionApp === "1.7.0" && dj.apkUrl.includes("apk-v1.7.0"), "B7.3 datos.json anuncia el APK 1.7.0");
}

console.log("\nBANCO MI TRABAJO v40 · CHAT PRO + PRO v40: " + pass + " PASS · " + fail + " FAIL");
process.exitCode = fail ? 1 : 0;

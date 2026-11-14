// Banco TARIFA VIVA INTELIGENTE — Mi Negocio v21 (2026-11-13).
// CHEQUEOS filas 72 y 76. La tarjeta «Tarifa viva del mercado»:
//   A) semáforo VERDE «En vivo» con foto fresca + el último
//      movimiento con su PORQUÉ + el simulador «él gana X ·
//      tú ganas Y» (ancla: el trato real de hoy, 14 a 1000 con
//      ingreso 1098.68 → él 345.38 · tú 1036.14);
//   B) la inteligencia: «Confirmando» con la confirmación armada;
//      el interruptor llama tarifa_viva_inteligencia con el código
//      de la sesión (pausar y reactivar); en pausa la tarjeta lo
//      dice y ofrece «Activar inteligencia»;
//   C) foto vieja: semáforo ÁMBAR «Respaldo»;
//   D) la puerta del motor caída NO tumba la pantalla de Tarifa;
//   E) la FOTO del cierre: al aprobar, la tarifa del momento viaja
//      con la decisión (item del panel + puerta
//      admin_foto_tarifa_reporte tras el despacho).
import { JSDOM } from "jsdom";
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "minegocio/index.html", "utf8");
let pass = 0, fail = 0;
function ok(c, n){ if (c) pass++; else { fail++; console.log("FAIL:", n); } }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
const ADMIN = "CODIGO-PRUEBA";
let llamadas = [], cuerpos = {};
let R = {};
const TARIFA_OK = { ok: true, ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 950,
  comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: "2026-11-13 15:00" };
const PORQUE_MOV = "Foto fresca dentro de la banda (±2%): se aplica. Tasa suavizada 303.39 (de 3 foto(s), ponderada por recencia y profundidad) con tu salida 950: el ingreso por recarga pasa de 1091.42 a 1098.68. Margen por recarga: 98.68 (buscador a 32%: 31.58 · Ernesto: 67.10).";
function tvEstado(variante){
  const mov = { creado_en: "2026-11-13T19:56:00Z", decision: "aplicada", ingreso_viejo: 1091.42,
    ingreso_nuevo: 1098.68, libro_nuevo: 1111.74, delta_pct: 0.66, porque: PORQUE_MOV };
  const base = { ok: true,
    tarifa: { ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 950, comision_saldo: 25,
      comision_transf: 20, piso_transf: 25, actualizado: "2026-11-13T15:00:00Z", actualizado_por: "MERCADO" },
    foto: { id: "foto-1", recibida_en: "2026-11-13T19:55:00Z", origen_en: "2026-11-13T19:50:00Z",
      fresca: true, edad_min: 5, nivel20: 303.388, promedio_venta: 300.16, bankcup_promedio: 1111.74, count_sell: 60 },
    inteligencia: { activa: true, umbral_pct: 2, vel_hora_pct: 4, vel_dia_pct: 8, costo_ref: 1000,
      comision_busq_pct: 32, confirmacion: null, ultimo_movimiento: mov,
      ultima_decision: { creado_en: mov.creado_en, decision: "aplicada", porque: PORQUE_MOV },
      historial: [ Object.assign({ estado: "—" }, mov) ] } };
  if (variante === "confirmando") {
    base.inteligencia.confirmacion = { direccion: -1, delta_pct: -3.18, desde: "2026-11-13T19:56:00Z" };
    base.inteligencia.ultima_decision = { creado_en: "2026-11-13T20:11:00Z", decision: "esperando_confirmacion",
      porque: "Salto de -3.18% (más del 2%): primera lectura, con la tasa suavizada 313.35 de 3 foto(s) fresca(s). Falta una segunda foto fresca en la misma dirección pa confirmarlo: no se tocó nada." };
    base.inteligencia.historial.unshift({ creado_en: "2026-11-13T20:11:00Z", decision: "esperando_confirmacion", estado: "—",
      ingreso_viejo: 1098.68, ingreso_nuevo: 1063.72, libro_nuevo: 1112.00, delta_pct: -3.18, porque: base.inteligencia.ultima_decision.porque });
  }
  if (variante === "pausada") base.inteligencia.activa = false;
  if (variante === "vieja") { base.foto.fresca = false; base.foto.edad_min = 55; }
  return base;
}
function crear(variante){
  llamadas = []; cuerpos = {};
  const pre = { codigo: ADMIN,
    foto: { reportes: R.reportesFoto || [], ayudas: [], usuarios: [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ],
      datos: null, cuando: "", publicar: [], publicados: {}, borrados: [], tarifaPanel: null, mercado: null, perfiles: {} },
    cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null, calcSync: null, calcEditEn: null, tarifaVivaMotor: null };
  const dom = new JSDOM(html, { url: "https://ernesto5058.github.io/calculadora-ernesto/minegocio/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w){
      w.localStorage.setItem("minegocio_v1", JSON.stringify(pre));
      w.fetch = function(url, opts){
        const u = String(url);
        const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v === undefined ? null : v)), json: () => Promise.resolve(v) });
        const rechaza = (m, st) => Promise.resolve({ ok: false, status: st || 404, text: () => Promise.resolve(JSON.stringify({ message: m || "404" })), json: () => Promise.resolve({ message: m || "404" }) });
        if (u.includes("/rpc/")) {
          const fn = u.split("/rpc/")[1].split("?")[0];
          let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch(e){}
          llamadas.push(fn); cuerpos[fn] = body;
          switch (fn) {
            case "admin_validar": return json(true);
            case "admin_reportes": return json(R.reportesSrv || []);
            case "admin_ayudas": return json([]);
            case "admin_usuarios": return json([{ codigo: "BUSC-1", nombre: "Busc Uno", activo: true }]);
            case "leer_tarifa": return json(TARIFA_OK);
            case "tarifa_viva_estado": return R.tvCaida ? rechaza("404") : json(tvEstado(variante));
            case "tarifa_viva_inteligencia": return json({ ok: true, activa: body.p_activa });
            case "admin_aprobar": case "admin_rechazar": case "admin_marcar_pagado": return json({ ok: true });
            case "admin_foto_tarifa_reporte": return json({ ok: true });
            case "admin_publicar_tratos": return json({ ok: true });
            case "leer_panel": return json({ ok: true, nombre: "", tratos: [] });
            case "dinero_leer_estado": return json(null);
            case "tocar_presencia": case "marcar_recibidos": return json({ ok: true });
            case "ver_presencia": return json({ ok: true, usuarios: [] });
            case "mensajes_sin_leer": return json({ ok: true, por_usuario: {}, total: 0 });
            case "leer_chat": return json({ ok: true, mensajes: [] });
            case "registrar_push_admin": case "admin_guardar_tarifa": case "mercado_fijar_costo": return json({ ok: true });
            case "leer_perfil": return json(null);
            case "admin_actividad": case "admin_cierres": return json([]);
            default: return rechaza("desconocida " + fn);
          }
        }
        if (u.includes("datos.json")) return json({ version: 5, actualizado: "2026-11-12", tarifa: { ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25 }, buscadores: {} });
        if (u.includes("ultimo.json")) return json({ ts: "2026-11-13T19:00:00Z", ETECSA: { average: 304.86 }, BANK_CUP: { average: 1068.44 } });
        return rechaza("404");
      };
    } });
  return { dom, w: dom.window };
}
function click(el){ el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); }
function input(el, v){ el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true })); }
function pestaña(w, nombre){
  /* T1 (v22): la barra trae solo 4 secciones; si el nombre no es una
     sección visible, se navega por irA() — igual que en el banco
     principal (la pantalla sigue existiendo como hija). */
  let tocada = false;
  [...w.document.querySelectorAll(".tab")].forEach(t => { if (t.textContent.includes(nombre)) { click(t); tocada = true; } });
  if (!tocada && typeof w.irA === "function") w.irA(nombre);
}
const fmt2 = n => (Math.round(n * 100) / 100).toFixed(2);

/* ===== A · verde + simulador ===== */
{
  R = {};
  const { w } = crear("verde");
  await sleep(450);
  pestaña(w, "Tarifa"); await sleep(150);
  const pg = w.document.getElementById("pgTarifa");
  ok(pg.textContent.includes("Tarifa viva del mercado"), "A1 la tarjeta viva existe en la pestaña Tarifa");
  ok(pg.textContent.includes("Foto fresca"), "A2 semáforo verde con foto fresca");
  ok(pg.textContent.includes("303.39"), "A3 la tarjeta muestra el nivel de venta de la foto (303.39)");
  ok(pg.textContent.includes("Regla de oro"), "A4 la regla de oro va escrita en la tarjeta");
  ok(!w.document.getElementById("tvAplicar"), "A5 el régimen de propuestas murió: no hay botón de aplicar");
  const bI = w.document.getElementById("tvIntelBtn");
  ok(bI && bI.textContent.includes("Pausar inteligencia"), "A5b la inteligencia activa ofrece «Pausar inteligencia»");
  ok(pg.textContent.includes("Último movimiento") && pg.textContent.includes("Margen por recarga: 98.68"),
     "A5c el último movimiento se muestra CON su porqué en palabras");
  const res = w.document.getElementById("simRes");
  ok(res && res.textContent.includes("Él gana") && res.textContent.includes(fmt2(24.67)) && res.textContent.includes("Tú ganas"),
     "A6 simulador saldo 1 recarga en gemelas v3: él 24.67 (vino: " + (res && res.textContent) + ")");
  input(w.document.getElementById("simCant"), "14");
  await sleep(60);
  ok(res.textContent.includes("345.38") && res.textContent.includes("1036.14") && res.textContent.includes("Tú ganas"),
     "A7 ancla del trato real: 14 a 1000 → él 345.38 · tú 1036.14 (vino: " + res.textContent + ")");
  click(w.document.getElementById("simTipoT")); await sleep(60);
  input(w.document.getElementById("simEf"), "5000"); input(w.document.getElementById("simPct"), "30");
  await sleep(60);
  const gan = (5000 * 1.3 / 1069.38) * 950 - 5000, elT = Math.round(gan * 20) / 100;
  ok(res.textContent.includes(fmt2(elT)) && res.textContent.includes(fmt2(gan - elT)),
     "A8 simulador transferencia en gemelas: él " + fmt2(elT) + " · tú " + fmt2(gan - elT) + " (vino: " + res.textContent + ")");
  w.close();
}
/* ===== B · la inteligencia: confirmando, pausa y reactivación ===== */
{
  R = {};
  const { w } = crear("confirmando");
  await sleep(450);
  pestaña(w, "Tarifa"); await sleep(150);
  const pg = w.document.getElementById("pgTarifa");
  ok(pg.textContent.includes("Confirmando"), "B1 con la confirmación armada, la píldora dice «Confirmando»");
  ok(pg.textContent.includes("Salto grande detectado"), "B2 la tarjeta explica el salto y la segunda lectura");
  ok(pg.textContent.includes("esperando la 2ª foto"), "B3 el historial cuenta la espera con su motivo");
  click(w.document.getElementById("tvIntelBtn")); await sleep(200);
  ok(cuerpos["tarifa_viva_inteligencia"] && cuerpos["tarifa_viva_inteligencia"].p_activa === false
     && cuerpos["tarifa_viva_inteligencia"].p_codigo === ADMIN, "B4 Pausar → inteligencia(false) con el código de la sesión");
  w.close();
  const otra = crear("pausada");
  await sleep(450);
  pestaña(otra.w, "Tarifa"); await sleep(150);
  const pg2 = otra.w.document.getElementById("pgTarifa");
  ok(pg2.textContent.includes("En pausa"), "B5 con la inteligencia apagada la píldora dice «En pausa»");
  const bA = otra.w.document.getElementById("tvIntelBtn");
  ok(bA && bA.textContent.includes("Activar inteligencia"), "B6 en pausa el botón ofrece «Activar inteligencia»");
  click(bA); await sleep(200);
  ok(cuerpos["tarifa_viva_inteligencia"] && cuerpos["tarifa_viva_inteligencia"].p_activa === true, "B7 Activar → inteligencia(true)");
  otra.w.close();
}
/* ===== C · foto vieja ===== */
{
  R = {};
  const { w } = crear("vieja");
  await sleep(450);
  pestaña(w, "Tarifa"); await sleep(150);
  ok(w.document.getElementById("pgTarifa").textContent.includes("Foto vieja"), "C1 semáforo ámbar con foto vieja");
  ok(w.document.getElementById("pgTarifa").textContent.includes("Respaldo"), "C2 la píldora dice «Respaldo» con foto vieja");
  w.close();
}
/* ===== D · puerta del motor caída ===== */
{
  R = { tvCaida: true };
  const { w } = crear("verde");
  await sleep(450);
  pestaña(w, "Tarifa"); await sleep(150);
  ok(!!w.document.getElementById("tf_ing"), "D1 sin la puerta del motor, el formulario de tarifa sigue en pie");
  w.close();
}
/* ===== E · la foto del cierre viaja con la aprobación ===== */
{
  R = { reportesFoto: [], reportesSrv: [ { id: "r1", buscador: "BUSC-1", tipo: "saldo", precio: 1000, porc: null,
      cantidad: 10, telefono_vendedor: "51230000", nota: "", estado: "pendiente", comision: null,
      creado_en: "2026-11-13T14:00:00Z", resuelto_en: null, comision_pagada_en: null } ] };
  const { w } = crear("verde");
  await sleep(450);
  pestaña(w, "Bandeja"); await sleep(150);
  const btn = w.document.querySelector("[data-ap]");
  ok(!!btn, "E1 la Bandeja ofrece la aprobación rápida del reporte");
  click(btn); await sleep(400);
  ok(llamadas.includes("admin_aprobar"), "E2 la aprobación salió por su puerta");
  ok(llamadas.includes("admin_foto_tarifa_reporte"), "E3 tras aprobar, la foto del cierre se escribe en el servidor");
  ok(cuerpos["admin_foto_tarifa_reporte"] && Number(cuerpos["admin_foto_tarifa_reporte"].p_ref360) === 1098.68
     && Number(cuerpos["admin_foto_tarifa_reporte"].p_ref_libro) === 1069.38,
     "E4 la foto es la tarifa del momento (1098.68 / 1069.38)");
  const st = JSON.parse(w.localStorage.getItem("minegocio_v1"));
  ok(st.foto.publicar.length && Number(st.foto.publicar[0].ref360) === 1098.68,
     "E5 el item del panel lleva la misma foto (ref360) pa el panel del buscador");
  w.close();
}

console.log("\nBANCO TARIFA VIVA · MI NEGOCIO: " + pass + " PASS · " + fail + " FAIL");
process.exitCode = fail ? 1 : 0;

// Banco v23 · Terminal profesional de Mi Negocio (Frente B).
// Patrón jsdom de los bancos hermanos: carga minegocio/index.html y
// ejercita la matemática pura window.__TERM__ con PROPIEDADES
// (semilla fija, barrido determinista) + la existencia de la Terminal
// en el DOM + higiene de versión/emojis del bloque nuevo.
import { JSDOM } from "jsdom";
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "minegocio/index.html", "utf8");
const swjs = fs.readFileSync(REPO + "minegocio/sw.js", "utf8");
let pass = 0, fail = 0; const fails = [];
function ok(cond, name) { if (cond) pass++; else { fail++; fails.push(name); console.log("FAIL:", name); } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
/* RNG con semilla fija (mulberry32): barrido determinista. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const preState = {
  codigo: "CODIGO-PRUEBA",
  foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], publicados: {}, borrados: [], tarifaPanel: null, mercado: null },
  calc: { saldo: { salida: 920, costo: 1000, tasa: 312, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 920 }, busc: { precio: 0, tasaVenta: 0, efectivo: 0, porc: 0, libro: 0, salida: 0 } },
  cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null
};
function crear() {
  const dom = new JSDOM(html, {
    url: "https://ernesto5058.github.io/calculadora-ernesto/minegocio/",
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      try { w.localStorage.setItem("minegocio_v1", JSON.stringify(preState)); } catch (e) {}
      w.fetch = function () {
        return Promise.resolve({
          ok: true, status: 200,
          text: function () { return Promise.resolve("null"); },
          json: function () { return Promise.resolve(null); }
        });
      };
    }
  });
  return dom.window;
}
const w = crear();
await sleep(400);
const T = w.__TERM__;
ok(!!T, "TERM-0 window.__TERM__ está expuesto");
ok(T && ["velasDesde", "macd", "momentum", "presionLibro", "bandas"].every(k => typeof T[k] === "function"), "TERM-0b __TERM__ trae las 5 funciones puras");
ok(w.PUERTAS && w.PUERTAS.guiaTerminal === "guia_terminal", "TERM-0c PUERTAS.guiaTerminal = guia_terminal");

/* (i) Velas: nº = ceil(span/marco) en la serie construida, OHLC
   coherente en el barrido y la última vela cierra con el último pv. */
{
  const base = Date.parse("2026-11-14T10:00:00Z");
  const serie = [];
  for (let i = 0; i < 24; i++) serie.push({ t: new Date(base + i * 5 * 60000).toISOString(), pv: 300 + ((i * 7) % 9) });
  const spanMin = (23 * 5);
  const velas = T.velasDesde(serie, 60);
  ok(velas.length === Math.ceil(spanMin / 60), "VELA-1 nº de velas = ceil(span/marco) (" + velas.length + " vs " + Math.ceil(spanMin / 60) + ")");
  ok(velas[velas.length - 1].c === serie[serie.length - 1].pv, "VELA-2 la última vela cierra con el último pv");
  ok(velas.every(v => v.l <= Math.min(v.o, v.c) && Math.max(v.o, v.c) <= v.h), "VELA-3 low <= min(o,c) <= max(o,c) <= high");
  const R = rng(20261114);
  let barridoOk = true, cierreOk = true, conteoOk = true;
  for (let s = 0; s < 24; s++) {
    const marco = [15, 60, 240, 1440][s % 4];
    const n = 40, pasoMin = 3;
    const ser = []; let pv = 280 + R() * 60;
    for (let i = 0; i < n; i++) { pv += (R() - 0.48) * 4; ser.push({ t: new Date(base + i * pasoMin * 60000).toISOString(), pv: Math.round(pv * 100) / 100 }); }
    const vs = T.velasDesde(ser, marco);
    const span = (n - 1) * pasoMin;
    if (!(vs.length >= 1 && vs.length <= Math.floor(span / marco) + 1)) conteoOk = false;
    if (!vs.every(v => v.l <= Math.min(v.o, v.c) && Math.max(v.o, v.c) <= v.h && v.l <= v.h)) barridoOk = false;
    if (vs[vs.length - 1].c !== ser[ser.length - 1].pv) cierreOk = false;
  }
  ok(barridoOk, "VELA-4 barrido: OHLC coherente en 24 series sintéticas");
  ok(cierreOk, "VELA-5 barrido: la última vela siempre cierra con el último pv");
  ok(conteoOk, "VELA-6 barrido: nº de velas dentro de [1, floor(span/marco)+1]");
  ok(T.velasDesde([], 60).length === 0, "VELA-7 serie vacía degrada a []");
}

/* (ii) MACD: constante = 0; creciente termina > 0. */
{
  const rc = T.macd(new Array(40).fill(7), 12, 26, 9);
  const maxAbs = Math.max(...rc.macd.map(Math.abs), ...rc.signal.map(Math.abs), ...rc.hist.map(Math.abs));
  ok(maxAbs <= 1e-9, "MACD-1 serie constante: macd/signal/hist = 0 (±1e-9), max=" + maxAbs);
  const inc = []; for (let i = 0; i < 60; i++) inc.push(100 + i * 1.5);
  const ri = T.macd(inc, 12, 26, 9);
  ok(ri.macd[ri.macd.length - 1] > 0, "MACD-2 serie creciente: la línea MACD termina > 0");
  ok(ri.macd.length === inc.length && ri.signal.length === inc.length, "MACD-3 longitudes alineadas con la entrada");
}

/* (iii) Momentum: monótona creciente > 0, decreciente < 0. */
{
  const inc = []; for (let i = 0; i < 30; i++) inc.push(200 + i * 2);
  const dec = inc.slice().reverse();
  const mi = T.momentum(inc, 10), md = T.momentum(dec, 10);
  ok(mi[mi.length - 1] > 0, "MOM-1 monótona creciente: momentum final > 0");
  ok(md[md.length - 1] < 0, "MOM-2 monótona decreciente: momentum final < 0");
  ok(mi.slice(0, 10).every(x => x === null) && mi[10] === 20, "MOM-3 calentamiento null (n) y primer valor exacto");
}

/* (iv) Presión del libro: compra+venta = 100, rango [0,100], vacío = null. */
{
  const p = T.presionLibro([{ tasa: 300, usd: 30 }], [{ tasa: 305, monto: 70 }], 300);
  ok(p && Math.abs(p.compra - 70) < 1e-9 && Math.abs(p.venta - 30) < 1e-9, "PRES-1 reparte por USD dentro de ±10% del top (con alias monto)");
  ok(T.presionLibro([], [], 300) === null, "PRES-2 escaleras vacías devuelven null (degradación)");
  ok(T.presionLibro([{ tasa: 300, usd: 10 }], [], null) === null, "PRES-3 sin referencia devuelve null");
  const R = rng(777);
  let sumaOk = true, rangoOk = true;
  for (let s = 0; s < 30; s++) {
    const ref = 290 + R() * 40;
    const mk = () => { const a = []; const n = 1 + Math.floor(R() * 6); for (let i = 0; i < n; i++) a.push({ tasa: ref * (0.92 + R() * 0.16), usd: 10 + R() * 400 }); return a; };
    const q = T.presionLibro(mk(), mk(), ref);
    if (!q) { sumaOk = false; continue; }
    if (Math.abs(q.compra + q.venta - 100) > 0.01) sumaOk = false;
    if (q.compra < 0 || q.compra > 100 || q.venta < 0 || q.venta > 100) rangoOk = false;
  }
  ok(sumaOk, "PRES-4 barrido: compra+venta = 100 ±0.01");
  ok(rangoOk, "PRES-5 barrido: ambos porcentajes en [0,100]");
}

/* (v) Bandas: ordenadas por tasa y acumulados monótonos no decrecientes. */
{
  const R = rng(4242);
  let ordOk = true, monoOk = true, totalOk = true;
  for (let s = 0; s < 20; s++) {
    const esc = []; let total = 0;
    for (let i = 0; i < 12; i++) { const u = Math.round(R() * 300); total += u; esc.push({ tasa: 280 + R() * 60, usd: u }); }
    const bs = T.bandas(esc, 2);
    for (let i = 1; i < bs.length; i++) { if (bs[i].tasa < bs[i - 1].tasa) ordOk = false; if (bs[i].acum < bs[i - 1].acum) monoOk = false; }
    if (Math.abs(bs[bs.length - 1].acum - total) > 1e-6) totalOk = false;
  }
  ok(ordOk, "BAND-1 bandas ordenadas por tasa");
  ok(monoOk, "BAND-2 acumulados monótonos no decrecientes");
  ok(totalOk, "BAND-3 el acumulado final = USD total de la escalera");
  const alias = T.bandas([{ rate: 300, total_usd: 50 }, { precio: 302, monto_usd: 25 }], 5);
  ok(alias.length >= 1 && alias[alias.length - 1].acum === 75, "BAND-4 normaliza alias (rate/precio, total_usd/monto_usd)");
}

/* (vi) La Terminal existe en el DOM: segmento, canvas y paneles. */
{
  const ahora = Date.now();
  const serie = [];
  for (let i = 0; i < 30; i++) serie.push({ t: new Date(ahora - (30 - i) * 2 * 60000).toISOString(), pv: 300 + i * 0.4, pc: 298 + i * 0.4 });
  w.termDatosMN = {
    ok: true,
    foto: { recibida_en: new Date(ahora).toISOString(), edad_min: 3, usable: true, top_venta: 312, top_compra: 308, nivel20: 310, promedio_venta: 309 },
    serie_etecsa: serie, serie_bankcup: serie,
    libro: { escalera_venta: [{ tasa: 311, usd: 120 }, { tasa: 313, usd: 200 }], escalera_compra: [{ tasa: 309, monto: 150 }, { rate: 307, total_usd: 90 }] },
    tarifa: { salida_ref: 920, costo_ref360: 1000, ingreso_ref360: 1050 },
    equilibrio: 331.2,
    posicion: { linea_saldo: 5000, costo_vivo_360: 1000, lotes: [{ cantidad: 3600, costo_por_recarga: 1000 }] },
    ventas: [{ t: new Date(ahora - 3600000).toISOString(), tasa: 312.5, saldo: 15545, qusd: 49.74 }],
    demanda: { termometro: "alta", ops_realizadas: 12, medida_en: new Date(ahora).toISOString(), declaracion: "La demanda absorbe en tu zona." },
    escenarios: [
      { clave: "rapida", nombre: "Inmediato", tasa: 311, monto_qusd: 40, receive: 12440, ganancia360: 40, ganancia_fifo: 1200, disponible: true, motivo: null, porques: ["Sale al primer peldaño firme."] },
      { clave: "equilibrada", nombre: "Equilibrado", tasa: 313, monto_qusd: 45, receive: 14085, ganancia360: 55, ganancia_fifo: 1600, disponible: true, motivo: null, porques: ["Equilibrio entre tasa y salida."] },
      { clave: "paciente", nombre: "Paciente", tasa: 316, monto_qusd: 48, receive: 15168, ganancia360: 70, ganancia_fifo: 2100, disponible: false, motivo: "sin_peldano", porques: [] }
    ],
    memoria: { resueltas: 10, llenadas: 7, no_llenadas: 3, acierto_pct: 70, ultimas: [{ peldano: "Equilibrado", tasa: 310, estado: "llenada" }] },
    promo: {}
  };
  w.mercadoSegMN = "terminal";
  w.pintarMercado();
  await sleep(60);
  const d = w.document;
  const pg = d.getElementById("pgMercado");
  ok(!!pg.querySelector('[data-seg="terminal"]'), "DOM-1 el segmento Terminal existe en la barra de Mercado");
  ok(!!pg.querySelector("#termCanvas"), "DOM-2 el canvas principal de la Terminal existe");
  ok(!!pg.querySelector("#termMomCanvas") && !!pg.querySelector("#termMacdCanvas"), "DOM-3 canvas de Momentum y MACD existen");
  ok(pg.textContent.includes("Escenarios del Asesor"), "DOM-4 las tarjetas de escenarios se pintan");
  ok(pg.textContent.includes("Acierto del Asesor: 70%") || pg.textContent.includes("Acierto del Asesor"), "DOM-5 la memoria del Asesor se pinta");
  ok(pg.textContent.includes("Tus ventas"), "DOM-6 la lista de ventas propias se pinta");
  ok(pg.textContent.includes("La subida sigue en el Asesor"), "DOM-7 escenarios de solo lectura con su nota (sin rutas nuevas de dinero)");
  /* Foto vieja: sello visible sobre el gráfico. */
  w.termDatosMN = JSON.parse(JSON.stringify(w.termDatosMN));
  w.termDatosMN.foto.edad_min = 45; w.termDatosMN.foto.usable = true;
  w.pintarMercado();
  ok(d.getElementById("pgMercado").textContent.includes("Foto vieja"), "DOM-8 foto vieja lleva su sello visible");
  /* Curva del fondo: degradación honesta sin movimientos con fecha. */
  const vacia = w.fondoCurvaHtml({ saldo_fondo: 100 });
  ok(vacia.includes("Tu fondo en el tiempo") && vacia.includes("La curva nace con los movimientos"), "DOM-9 curva del fondo: estado vacío honesto sin datos con fecha");
  const conMovs = w.fondoCurvaHtml({ movimientos: [
    { creada_en: "2026-11-10T10:00:00Z", monto: 10000, cuenta: "fondo", tipo: "entrada" },
    { creada_en: "2026-11-12T10:00:00Z", monto: 5000, cuenta: "fondo", tipo: "entrada" }
  ] });
  ok(conMovs.includes("<polyline") && conMovs.includes("15.000"), "DOM-10 curva del fondo: con movimientos se dibuja y acumula (10.000 + 5.000)");
  /* Puesto promocionado en Inicio: solo con promo activa. */
  ok(w.promoInicioHtml() === "", "DOM-11 sin promo activa no se pinta tarjeta");
  w.mercadoGuiaMN = { promo: { activa: true }, preparada_viva: null };
  ok(w.promoInicioHtml().includes("Escaparate vacío"), "DOM-12 promo activa sin oferta: escaparate vacío");
  w.mercadoGuiaMN = { promo: { activa: true }, preparada_viva: { tasa: 313 } };
  ok(w.promoInicioHtml().includes("Escaparate cubierto"), "DOM-13 promo activa con preparada viva: escaparate cubierto");
}

/* (vii) Higiene: versión v23 y cero emojis estructurales nuevos en
   el código de la Terminal. */
{
  ok(html.includes('var MN_VERSION = "v23";'), "HIG-1 MN_VERSION = v23 en el html");
  ok(html.includes('version:"v23"'), "HIG-2 SENTRY_CASA version v23");
  ok(swjs.includes('var CACHE = "minegocio-v25";'), "HIG-3 sw.js CACHE = minegocio-v25");
  const i0 = html.indexOf("TERMINAL v23");
  const i1 = html.indexOf("ENTRADA (login)", i0);
  ok(i0 >= 0 && i1 > i0, "HIG-4 bloque de la Terminal localizable");
  const bloque = html.slice(i0, i1);
  const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  ok(!emojiRe.test(bloque), "HIG-5 cero emojis estructurales en el código de la Terminal");
  ok(bloque.includes("guia_terminal") && bloque.includes("__TERM__"), "HIG-6 el bloque registra la puerta y expone __TERM__");
}

console.log("\nBANCO TERMINAL v23: " + pass + " PASS · " + fail + " FAIL");
if (fails.length) console.log("Fallos:", fails.join(" | "));
process.exit(fail ? 1 : 0);

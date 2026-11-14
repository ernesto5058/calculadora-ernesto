// Banco de la TANDA PUERTA + ASESOR (2026-11-14): los tres frentes
// del arreglo tras la venta que Ernesto montó a mano.
//   F1 · la puerta clasifica HONESTO el resultado desconocido
//        (timeout / http_5xx / red, con la causa en la bitácora) y
//        la reconciliación casa por monto + receive con tolerancia.
//   F2 · el receive GUARDADO por el Asesor (desde el saldo) manda:
//        la puerta no lo re-deriva (15.545, no 15.543,75) y la
//        tasa efectiva queda en la bitácora.
//   F3 · la CIMA FIRME: una oferta sucia aislada (279,07 con el
//        promedio en 305,23 y la masa en 313+, foto real del
//        2026-11-14 17:04 UTC) ya no arrastra los peldaños del
//        lector ni la doble lectura de la puerta.
// TODO contra mocks/fixtures: ni una llamada real a QvaPay.
import * as L from "./fixtures/mercado-logica.js";
import * as A from "./fixtures/mercado-analista.js";
import * as T from "./fixtures/actuar-logica.js";

let pass = 0, fail = 0; const fails = [];
function ok(c, n) { if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }
function eq(a, b, n) { ok(a === b, `${n} (real ${JSON.stringify(a)} ≠ esperado ${JSON.stringify(b)})`); }

/* ============ F3 · la cima firme con el libro real de las 17:04 == */
const of = (amount, receive) => ({ amount, receive });
// La oferta sucia de ese día: 12.000/43 = 279,0698 exactos.
const SUCIA = of(43, 12000);
// La masa real del libro (escalera de la foto de las 17:04).
const MASA = [
  [4.48, 313.28], [27.51, 314.58], [56.62, 316.14], [300, 318],
  [200, 320], [67.16, 321], [94.39, 326.31], [140, 330],
  [122, 335], [17.5, 337.4],
].map(([usd, tasa]) => of(usd, Math.round(usd * tasa * 100) / 100));
const LIBRO = [SUCIA, ...MASA];
const PROMEDIO = 305.23; // average_sell de QvaPay ese día

eq(Math.round(L.topVenta(LIBRO) * 100) / 100, 279.07, "F3 la cima cruda sigue siendo 279,07 (dato declarado)");
eq(L.cimaVentaFirme(LIBRO, PROMEDIO), 314.58, "F3 cima firme salta la sucia y ancla con respaldo (314,58)");
eq(L.cimaVentaFirme([of(4.3, 1200), ...MASA], PROMEDIO), 314.58,
  "F3 sucia CHIQUITA (1.200/4,3) tampoco ancla");
eq(L.cimaVentaFirme(MASA, PROMEDIO), 314.58, "F3 sin sucia: firme = primera tasa con 20 USD acumulados");
eq(L.cimaVentaFirme([SUCIA], PROMEDIO), 279.07, "F3 libro de una sola oferta: no se inventa otra tasa");
eq(L.cimaVentaFirme([], PROMEDIO), null, "F3 libro vacío = null");

const menu = A.menuMaker({
  topVenta: 279.07, topVentaFirme: L.cimaVentaFirme(LIBRO, PROMEDIO),
  nivel20: 306, equilibrio: 327.6, salida: 910, costo: 1000, escVenta: [],
});
const eqPel = menu.peldanos.find((p) => p.nombre === "Equilibrado");
eq(eqPel.tasa, 314.58, "F3 Equilibrado vive en la zona sana (314,58), no en la cima sucia");
eq(menu.cima.sucia, true, "F3 el menú declara la cima sucia");
const menuSano = A.menuMaker({
  topVenta: 313.28, topVentaFirme: 313.28,
  nivel20: 306, equilibrio: 327.6, salida: 910, costo: 1000, escVenta: [],
});
eq(menuSano.peldanos.find((p) => p.nombre === "Equilibrado").tasa, 313.28,
  "F3 con cima sana el Equilibrado no cambia");
eq(menuSano.cima.sucia, false, "F3 cima sana no se marca sucia");

/* Paridad puerta: la doble lectura calcula el mismo Equilibrado. */
eq(T.equilibradoDe(LIBRO, 327.6), 314.58, "F3 paridad: equilibradoDe de la puerta = 314,58");
eq(T.equilibradoDe(MASA, 327.6), 314.58, "F3 paridad sin sucia");
eq(T.equilibradoDe([], 327.6), null, "F3 puerta sin libro = null");

/* ============ F1 + F2 · la puerta con mocks ====================== */
const AHORA = Date.parse("2026-11-14T17:30:00Z");
const iso = (ms) => new Date(ms).toISOString();
const PLANTILLA = {
  detalles: { Celular: "51231558" },
  bloque: {
    coin: "ETECSA", tipo: "sell", offer_kind: "fixed",
    order_min: null, order_max: null, requirements: null,
    message: "Enviar SMS al 51231558.!!",
  },
};
const ACCION = {
  id: "44444444-5555-4666-8777-888888888888",
  origen: "asesor", moneda: "ETECSA",
  estado: "pendiente", tasa: 312.5, monto_qusd: 49.74,
  expira_en: iso(AHORA + 5 * 60000), oferta_uuid: null,
  contexto: {
    via: "guia_subir", base_fuente: "plantilla", plantilla: PLANTILLA,
    receive: 15545, tasa_efectiva: 312.5251, recibe_del_saldo: true,
  },
};
function depsMock(sobre = {}) {
  const llamadas = { crear: [] };
  const estado = {
    accion: JSON.parse(JSON.stringify(ACCION)),
    config: {
      detenidas: false, pausadas: false, pausa_motivo: null,
      accion_monto_qusd: 50, congelar_en_promo: true, crear_tipo: "sell",
    },
    foto: { recibida_en: iso(AHORA - 60000), libro_ok: true },
    tarifa: { salida: 910, costo: 1000 },
    conteo: { ultimaEjecutadaEn: null, enUltimaHora: 0, montoHoy: 0 },
    fresco: { equilibrado: 312.5, misOfertas: [] },
    ...sobre,
  };
  const deps = {
    ahoraMs: () => AHORA,
    ahoraIso: () => iso(AHORA),
    leerAccion: async () => estado.accion,
    reclamarAccion: async () => {
      if (estado.accion.estado === "pendiente") {
        estado.accion.estado = "ejecutando"; return true;
      }
      return false;
    },
    guardarAccion: async (id, parche) => { Object.assign(estado.accion, parche); },
    leerConfig: async () => estado.config,
    promoActiva: async () => false,
    leerFoto: async () => estado.foto,
    leerTarifa: async () => estado.tarifa,
    conteo: async () => estado.conteo,
    libroFresco: async () => estado.fresco,
    accionesEjecutadas: async () => [],
    crearOferta: async (payload) => {
      llamadas.crear.push(payload);
      return { ok: true, uuid: "oferta-x", crudo: { uuid: "oferta-x" } };
    },
    misOfertasAhora: async () => [],
    sumarFallo: async () => 1,
    reiniciarFallos: async () => {},
    fijarPausa: async () => {},
    leerPlantilla: async () => PLANTILLA,
  };
  return { deps, llamadas, estado };
}

/* F2 · el payload lleva el receive DEL SALDO, no el derivado */
{
  const { deps, llamadas, estado } = depsMock();
  const r = await T.ejecutarAccion(deps, ACCION.id);
  eq(r.ok, true, "F2 la subida pasa");
  eq(llamadas.crear[0].receive, 15545, "F2 payload.receive = 15.545 (el del saldo, no 15.543,75)");
  eq(llamadas.crear[0].amount, 49.74, "F2 payload.amount = 49,74");
  eq(estado.accion.detalle.tasa_efectiva, 312.5251, "F2 la bitácora guarda la tasa efectiva");
  eq(estado.accion.detalle.receive, 15545, "F2 la bitácora guarda el receive enviado");
}
/* F2 · contexto corrupto: la puerta deriva como siempre (sanidad) */
{
  const { deps, llamadas } = depsMock();
  deps.leerAccion = async () => ({
    ...JSON.parse(JSON.stringify(ACCION)),
    contexto: { ...ACCION.contexto, receive: 999999 },
  });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  eq(r.ok, true, "F2 con receive imposible la subida no se cae");
  eq(llamadas.crear[0].receive, 15543.75, "F2 receive imposible -> se deriva monto × tasa");
}
/* F1 · timeout clasificado */
{
  const { deps, estado } = depsMock();
  deps.crearOferta = async () => {
    const e = new Error("The operation timed out"); e.name = "TimeoutError"; throw e;
  };
  const r = await T.ejecutarAccion(deps, ACCION.id);
  eq(r.codigo, "resultado_desconocido", "F1 timeout sigue siendo resultado_desconocido (contrato)");
  eq(r.causa, "timeout", "F1 la causa dice timeout");
  eq(estado.accion.detalle.causa, "timeout", "F1 la bitácora guarda causa=timeout");
  eq(estado.accion.detalle.excepcion.nombre, "TimeoutError", "F1 la bitácora guarda la excepción real");
  const det = estado.accion.detalle;
  ok(det.payload && !("details" in det.payload) && det.payload.forma_details,
    "F1 la bitácora redacta el objeto details (solo su forma), como manda la regla BIT");
}
/* F1 · 5xx clasificado con estado y cuerpo */
{
  const { deps, estado } = depsMock();
  deps.crearOferta = async () => ({
    ok: false, incierto: true, causa: "http_5xx",
    http_status: 502, cuerpo: "Bad Gateway", mensaje: "HTTP 502",
  });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  eq(r.causa, "http_5xx", "F1 la causa dice http_5xx");
  eq(estado.accion.detalle.http_status, 502, "F1 la bitácora guarda el HTTP real");
  eq(estado.accion.detalle.cuerpo, "Bad Gateway", "F1 la bitácora guarda el cuerpo de QvaPay");
  ok(r.motivo.includes("HTTP 502"), "F1 el motivo nombra el HTTP");
}
/* F1 · fallo de red clasificado */
{
  const { deps } = depsMock();
  deps.crearOferta = async () => { throw new TypeError("fetch failed"); };
  const r = await T.ejecutarAccion(deps, ACCION.id);
  eq(r.causa, "red", "F1 la causa dice red");
}
/* F1 · reconciliación con el receive del saldo (entero) */
{
  const { deps, estado } = depsMock();
  deps.crearOferta = async () => ({
    ok: false, incierto: true, causa: "http_5xx", http_status: 503, cuerpo: "",
  });
  deps.misOfertasAhora = async () => [
    { uuid: "hallada", type: "sell", amount: 49.74, receive: 15545 },
  ];
  const r = await T.ejecutarAccion(deps, ACCION.id);
  eq(r.ok, true, "F1 reconcilia: la oferta SÍ había nacido");
  eq(r.reconciliada, true, "F1 marcada reconciliada");
  eq(estado.accion.oferta_uuid, "hallada", "F1 guarda el uuid hallado");
}
/* F1 · una oferta de COMPRA con los mismos números NO reconcilia */
{
  const { deps } = depsMock();
  deps.crearOferta = async () => ({
    ok: false, incierto: true, causa: "http_5xx", http_status: 503, cuerpo: "",
  });
  deps.misOfertasAhora = async () => [
    { uuid: "de-compra", type: "buy", amount: 49.74, receive: 15545 },
  ];
  const r = await T.ejecutarAccion(deps, ACCION.id);
  eq(r.codigo, "resultado_desconocido", "F1 la de compra NO reconcilia una venta");
}

console.log(`\nPUERTA+ASESOR 2026-11-14: ${pass} PASS · ${fail} FAIL`);
if (fails.length) { console.log("Fallos:", fails.join(" | ")); process.exit(1); }

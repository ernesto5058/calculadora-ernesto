// Copia para CI (GitHub Actions) del banco vivo en research_notes — mismos chequeos,
// solo cambian las rutas. Si el banco vivo cambia, se refresca esta copia.
// Banco de la REPARACIÓN DE LA PUERTA DE SUBIDA (2026-11-14): la
// base de pago del Analista deja de re-clonarse del listado de la
// API (que con credenciales de app NO expone los «details» de
// ninguna oferta) y pasa a ser, por prioridad: (1) la oferta viva
// de VENTA con details legibles — cuyos pares deben coincidir
// EXACTOS con la plantilla — o (2) la PLANTILLA guardada de
// Ernesto (guia_plantilla ETECSA·sell), que viaja en el snapshot
// de la preparada o se lee al momento de subir (dep leerPlantilla).
// Los valores de la plantilla aquí son los REALES sembrados el
// 2026-11-14 (oferta 9d875807 de su sesión): details OBJETO
// {"Celular":"51231558"}, requirements null, offer_kind «fixed».
// TODO corre contra mocks: ni una llamada real a QvaPay — la
// primera subida real es el toque de Ernesto.
import * as T from "./fixtures/actuar-logica.js";

let pass = 0, fail = 0; const fails = [];
function ok(c, n) { if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }

const AHORA = Date.parse("2026-11-14T08:00:00Z");
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
  id: "33333333-4444-4555-8666-777777777777",
  origen: "asesor", moneda: "ETECSA",
  estado: "pendiente", tasa: 319, monto_qusd: 40,
  expira_en: iso(AHORA + 5 * 60000), oferta_uuid: null,
  contexto: { via: "guia_subir", base_fuente: "plantilla", plantilla: PLANTILLA },
};
/* La oferta viva TAL CUAL la devuelve la API con credenciales de
   app: existe, es de venta, pero sus «details» NO vienen. */
const VIVA_SIN_DETAILS = { uuid: "viva-1", type: "sell", amount: "30", receive: "9600" };

function depsMock(sobre = {}) {
  const llamadas = { crear: [], guardar: [], plantillaPedida: [] };
  const estado = {
    accion: { ...ACCION },
    config: {
      detenidas: false, pausadas: false, pausa_motivo: null,
      accion_monto_qusd: 40, congelar_en_promo: true, crear_tipo: "sell",
    },
    foto: { recibida_en: iso(AHORA - 2 * 60000), libro_ok: true },
    tarifa: { salida: 910, costo: 1000 },
    conteo: { ultimaEjecutadaEn: null, enUltimaHora: 0, montoHoy: 0 },
    fresco: { equilibrado: 319, misOfertas: [] },
    plantillaDep: PLANTILLA,
    promo: false,
    ...sobre,
  };
  const deps = {
    ahoraMs: () => AHORA,
    ahoraIso: () => iso(AHORA),
    leerAccion: async () => estado.accion,
    reclamarAccion: async () => {
      const a = estado.accion;
      if (a.estado === "pendiente") { a.estado = "ejecutando"; a.reclamada_en = iso(AHORA); return true; }
      return false;
    },
    guardarAccion: async (id, parche) => { llamadas.guardar.push(parche); Object.assign(estado.accion, parche); },
    leerConfig: async () => estado.config,
    promoActiva: async () => Boolean(estado.promo),
    leerFoto: async () => estado.foto,
    leerTarifa: async () => estado.tarifa,
    conteo: async () => estado.conteo,
    libroFresco: async () => estado.fresco,
    accionesEjecutadas: async () => [],
    crearOferta: async (payload) => {
      llamadas.crear.push(payload);
      return { ok: true, uuid: "oferta-prueba-no-subida", crudo: { uuid: "oferta-prueba-no-subida" } };
    },
    misOfertasAhora: async () => [],
    sumarFallo: async () => 1,
    reiniciarFallos: async () => {},
    fijarPausa: async () => {},
    leerPlantilla: async (moneda, tipo) => {
      llamadas.plantillaPedida.push([moneda, tipo]);
      return estado.plantillaDep;
    },
  };
  return { deps, llamadas, estado };
}

/* Unidades: la forma y el par exacto */
{
  ok(T.detailsValidos({ Celular: "51231558" }) === true, "detailsValidos: objeto con pares = válido (la forma real)");
  ok(T.detailsValidos({}) === false && T.detailsValidos([]) === false
    && T.detailsValidos(null) === false && T.detailsValidos(undefined) === false
    && T.detailsValidos("51231558") === false,
    "detailsValidos: vacío/ausente/escalar = inválido");
  ok(T.detailsValidos([{ telefono: "1" }]) === true, "detailsValidos: array no vacío = válido (compat legada)");
  ok(T.coincidePlantilla({ Celular: "51231558" }, PLANTILLA.detalles) === true, "par exacto: el mismo número coincide");
  ok(T.coincidePlantilla({ Celular: 51231558 }, PLANTILLA.detalles) === true, "par exacto: número vs cadena coincide (la API trae cadenas)");
  ok(T.coincidePlantilla({ Celular: "59999999" }, PLANTILLA.detalles) === false, "par exacto: OTRO número NO coincide");
  ok(T.coincidePlantilla([{ a: 1 }], [{ a: 1 }]) === true && T.coincidePlantilla([{ a: 1 }], [{ a: 2 }]) === false,
    "par exacto (forma array): solo la identidad completa vale");
}

/* P1 — EL CASO REAL: preparada del asesor con la plantilla en el
   snapshot y el listado de la API SIN details (así llega hoy):
   la puerta queda VERDE y el payload es el de SU oferta real */
{
  const { deps, llamadas, estado } = depsMock({
    fresco: { equilibrado: 319, misOfertas: [{ ...VIVA_SIN_DETAILS }] },
  });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.ok === true && llamadas.crear.length === 1, "P1: puerta VERDE con la plantilla del snapshot (la API no dio details)");
  const p = llamadas.crear[0];
  ok(p.details && p.details.Celular === "51231558" && !Array.isArray(p.details),
    "P1: payload.details = el OBJETO de la plantilla, tal cual");
  ok(p.requirements === null, "P1: payload.requirements = null (el de su oferta real — jamás el fijo {25, 4,5})");
  ok(p.message === "Enviar SMS al 51231558.!!" && p.offer_kind === "fixed"
    && p.order_min === null && p.order_max === null,
    "P1: mensaje, offer_kind «fixed» y límites salen del bloque de la plantilla");
  ok(p.type === "sell" && p.coin === "ETECSA" && p.amount === 40 && p.receive === 12760,
    "P1: venta de ETECSA, $40 a 319 = 12 760 de receive");
  ok(llamadas.plantillaPedida.length === 0, "P1: con snapshot completo la dep leerPlantilla NO se llama");
  ok(estado.accion.detalle?.base_fuente === "plantilla"
    && estado.accion.detalle?.payload?.forma_details?.tipo === "objeto"
    && !("details" in (estado.accion.detalle?.payload || {})),
    "P1: la bitácora dice base «plantilla» y guarda la FORMA, no los details");
}

/* P2 — Snapshot VIEJO sin plantilla: la puerta la lee al subir */
{
  const { deps, llamadas, estado } = depsMock();
  estado.accion = { ...ACCION, contexto: { via: "guia_subir", base_fuente: "plantilla" } };
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.ok === true && llamadas.crear.length === 1, "P2: puerta VERDE leyendo la plantilla al momento de subir");
  ok(llamadas.plantillaPedida.length === 1
    && llamadas.plantillaPedida[0][0] === "ETECSA" && llamadas.plantillaPedida[0][1] === "sell",
    "P2: leerPlantilla se pidió por el par (ETECSA, sell)");
  ok(llamadas.crear[0].details?.Celular === "51231558" && llamadas.crear[0].requirements === null,
    "P2: el payload trae los details y la forma de la plantilla leída");
}

/* P3 — Sin plantilla por ningún lado y la viva sin details:
   negación honesta con la forma registrada (ausente) */
{
  const { deps, llamadas, estado } = depsMock({
    plantillaDep: null,
    fresco: { equilibrado: 319, misOfertas: [{ ...VIVA_SIN_DETAILS }] },
  });
  estado.accion = { ...ACCION, contexto: {} };
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "detalles_desconocidos" && llamadas.crear.length === 0,
    "P3: sin base usable se niega con detalles_desconocidos y QvaPay no se toca");
  ok(estado.accion.detalle?.forma_details?.tipo === "ausente",
    "P3: la bitácora registra la forma «ausente», sin inventar datos");
}

/* P4 — Ni viva ni plantilla: sin_oferta_base en claro */
{
  const { deps, llamadas } = depsMock({ plantillaDep: null });
  deps.leerAccion = async () => ({ ...ACCION, contexto: {} });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "sin_oferta_base" && /plantilla guardada/.test(r.motivo) && llamadas.crear.length === 0,
    "P4: sin oferta viva ni plantilla se niega nombrando las dos vías");
}

/* P5 — Prioridad a la VIVA: details legibles con el par exacto
   (y un dato extra suyo) → la base es la viva, no la plantilla */
{
  const viva = {
    uuid: "viva-2", type: "sell", amount: "30", receive: "9600",
    details: { Celular: "51231558", Nota: "solo-efectivo" },
    requirements: { min_completed: 10 }, message: "mensaje de la viva", offer_kind: "fixed",
  };
  const { deps, llamadas, estado } = depsMock({
    fresco: { equilibrado: 319, misOfertas: [viva] },
  });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.ok === true && llamadas.crear.length === 1, "P5: con viva legible la puerta ejecuta");
  ok(llamadas.crear[0].details?.Nota === "solo-efectivo"
    && llamadas.crear[0].requirements?.min_completed === 10
    && llamadas.crear[0].message === "mensaje de la viva",
    "P5: el payload clona la VIVA (details, requirements y mensaje suyos)");
  ok(estado.accion.detalle?.base_fuente === "oferta_viva", "P5: la bitácora dice base «oferta_viva»");
}

/* P6 — La viva cobra a OTRO número: el par exacto frena la puerta */
{
  const vivaAjena = {
    uuid: "viva-3", type: "sell", amount: "30", receive: "9600",
    details: { Celular: "59999999" },
  };
  const { deps, llamadas, estado } = depsMock({
    fresco: { equilibrado: 319, misOfertas: [vivaAjena] },
  });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "detalles_distintos_plantilla" && llamadas.crear.length === 0,
    "P6: details que no coinciden con la plantilla -> negada, QvaPay no se toca");
  ok(!JSON.stringify(estado.accion.detalle || {}).includes("59999999"),
    "P6: la bitácora guarda la forma del desacuerdo, jamás el número ajeno");
}

/* P7 — Compatibilidad: details en ARRAY (forma legada) sin
   plantilla que contrastar siguen aceptándose, como antes */
{
  const { deps, llamadas } = depsMock({ plantillaDep: null });
  deps.leerAccion = async () => ({ ...ACCION, contexto: {} });
  deps.libroFresco = async () => ({
    equilibrado: 319,
    misOfertas: [{ uuid: "viva-4", type: "sell", details: [{ telefono: "51231558" }], amount: "30", receive: "9600" }],
  });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.ok === true && Array.isArray(llamadas.crear[0].details),
    "P7: la forma array legada sigue pasando cuando no hay plantilla");
}

/* P8 — La plantilla tampoco salva una base en forma inválida:
   snapshot con detalles vacíos y dep sin fila -> negación */
{
  const { deps, llamadas } = depsMock({ plantillaDep: null });
  deps.leerAccion = async () => ({ ...ACCION, contexto: { plantilla: { detalles: {}, bloque: {} } } });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "detalles_desconocidos" && llamadas.crear.length === 0,
    "P8: plantilla con detalles vacíos no es base: se niega en claro");
}


/* P9 — PROMO ACTIVA + su toque en «Subirla» (decisión de Ernesto,
   2026-11-14: «mi toque en Subirla manda siempre, también en
   promo»): la preparada del asesor con la marca via='guia_subir'
   (la que SOLO escribe guia_subir tras validar su código admin)
   queda EXENTA de la baranda 3 — puerta VERDE con el payload de
   la plantilla y la bitácora registra la exención usada */
{
  const { deps, llamadas, estado } = depsMock({
    promo: true,
    fresco: { equilibrado: 319, misOfertas: [{ ...VIVA_SIN_DETAILS }] },
  });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.ok === true && llamadas.crear.length === 1, "P9: promo activa + toque Subirla -> puerta VERDE (la exención manda)");
  const p = llamadas.crear[0];
  ok(p.details?.Celular === "51231558" && p.requirements === null && p.type === "sell",
    "P9: el payload en promo es el de la plantilla (details objeto, requirements null)");
  ok(estado.accion.detalle?.exencion_promo === "toque_subirla"
    && estado.accion.detalle?.base_fuente === "plantilla",
    "P9: la bitácora registra la exención usada (toque_subirla) y la base plantilla");
  ok(!("details" in (estado.accion.detalle?.payload || {}))
    && estado.accion.detalle?.payload?.forma_details?.tipo === "objeto",
    "P9: ni con exención la bitácora lleva los details: solo su forma (el mensaje público de la oferta no es un dato de pago)");
}

/* P10 — Promo activa + asesor SIN la marca de su toque (ruta
   programática: la acción no pasó por guia_subir): la exención es
   por el TOQUE, no por el origen — sigue congelada en promo */
{
  for (const ctx of [{}, { via: "cron_asesor" }, { base_fuente: "plantilla" }]) {
    const { deps, llamadas, estado } = depsMock({ promo: true });
    estado.accion = { ...ACCION, contexto: ctx };
    const r = await T.ejecutarAccion(deps, ACCION.id);
    ok(r.codigo === "promo" && llamadas.crear.length === 0,
      `P10: asesor sin marca de toque (contexto ${JSON.stringify(ctx)}) sigue NEGADO en promo`);
  }
}

/* P11 — La exención abre SOLO la baranda de promo: con el toque de
   Subirla y promo activa, una foto vieja sigue vetando (el resto
   del blindaje intacto) — y esa negación también deja escrita la
   exención que se había reconocido */
{
  const { deps, llamadas, estado } = depsMock({
    promo: true,
    foto: { recibida_en: iso(AHORA - 21 * 60000), libro_ok: true },
  });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "foto_vieja" && llamadas.crear.length === 0,
    "P11: exenta de promo, la puerta sigue vetando por foto vieja (blindaje intacto)");
  ok(estado.accion.detalle?.exencion_promo === "toque_subirla",
    "P11: la negación posterior también registra la exención en la bitácora");
}

console.log(`\nACTUAR PUERTA-PLANTILLA: ${pass} PASS · ${fail} FAIL`);
if (fails.length) { console.log("Fallos:", fails.join(" | ")); process.exit(1); }

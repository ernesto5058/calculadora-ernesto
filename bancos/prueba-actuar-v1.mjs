// Copia para CI (GitHub Actions) del banco vivo en research_notes — mismos chequeos,
// solo cambian las rutas. Si el banco vivo cambia, se refresca esta copia.
// Banco de la PUERTA DE ACCIÓN del Analista (Nivel 1, 2026-11-11):
// logica-actuar.js con dependencias MOCK (ni una llamada real a
// QvaPay): el camino feliz crea la oferta UNA vez con el payload
// exacto, y cada baranda del Estudio 2 §3 niega con su motivo y deja
// la negación en la bitácora — collar, veto por foto vieja, DETENER,
// pausa, topes, enfriamiento, doble lectura, idempotencia y el
// freno tras 3 errores / permiso denegado.
import * as T from "./fixtures/actuar-logica.js";
import * as A from "./fixtures/mercado-analista.js";

let pass = 0, fail = 0; const fails = [];
function ok(c, n) { if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }
function cerca(a, b, tol, n) { ok(typeof a === "number" && Math.abs(a - b) <= tol, n + " (dio " + a + ")"); }

const AHORA = Date.parse("2026-11-11T19:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const ACCION = {
  id: "11111111-2222-4333-8444-555555555555",
  estado: "pendiente", tasa: 319, monto_qusd: 40,
  expira_en: iso(AHORA + 5 * 60000), oferta_uuid: null,
};
const OFERTA_BASE = {
  uuid: "oferta-propia-1", type: "sell",
  details: [{ telefono: "51231558" }], amount: "30", receive: "9600",
};

/* Fábrica de dependencias mock con contadores observables. */
function depsMock(sobre = {}) {
  const llamadas = { crear: [], guardar: [], pausa: [], fallosSumados: 0, fallosReiniciados: 0 };
  const estado = {
    accion: { ...ACCION },
    config: {
      detenidas: false, pausadas: false, pausa_motivo: null,
      accion_monto_qusd: 40, congelar_en_promo: true, crear_tipo: "sell",
    },
    foto: { recibida_en: iso(AHORA - 5 * 60000), libro_ok: true },
    tarifa: { salida: 925, costo: 1000 },
    conteo: { ultimaEjecutadaEn: null, enUltimaHora: 0, montoHoy: 0 },
    fresco: { equilibrado: 319, misOfertas: [{ ...OFERTA_BASE }] },
    fallos: 0,
    ...sobre,
  };
  const deps = {
    ahoraMs: () => AHORA,
    ahoraIso: () => iso(AHORA),
    leerAccion: async () => estado.accion,
    /* CAS del reclamo (E-1): el cuerpo corre SIN await antes de
       decidir — gana si «pendiente», o si «ejecutando» con el
       reclamo vencido (> RECLAMO_EXPIRA_MIN contra ahoraMs());
       al ganar fija estado y reclamada_en, como el PATCH real. */
    reclamarAccion: async (id) => {
      const a = estado.accion;
      if (!a) return false;
      if (a.estado === "pendiente") { a.estado = "ejecutando"; a.reclamada_en = iso(AHORA); return true; }
      if (a.estado === "ejecutando" && a.reclamada_en && AHORA - Date.parse(a.reclamada_en) > T.RECLAMO_EXPIRA_MIN * 60000) {
        a.reclamada_en = iso(AHORA); return true;
      }
      return false;
    },
    guardarAccion: async (id, parche) => { llamadas.guardar.push(parche); Object.assign(estado.accion, parche); },
    leerConfig: async () => estado.config,
    promoActiva: async () => Boolean(estado.promo),
    leerFoto: async () => estado.foto,
    leerTarifa: async () => estado.tarifa,
    conteo: async (_excluirId) => estado.conteo,
    libroFresco: async () => estado.fresco,
    accionesEjecutadas: async () => estado.ejecutadas || [],
    crearOferta: async (payload) => {
      llamadas.crear.push(payload);
      if (estado.crearDemoraMs) await new Promise((r) => setTimeout(r, estado.crearDemoraMs));
      if (estado.crearLanza) throw new Error("red caída");
      return estado.crearResp || { ok: true, uuid: "oferta-nueva-1", crudo: { uuid: "oferta-nueva-1" } };
    },
    misOfertasAhora: async () => estado.misAhora || [],
    sumarFallo: async () => { llamadas.fallosSumados++; estado.fallos++; return estado.fallos; },
    reiniciarFallos: async () => { llamadas.fallosReiniciados++; estado.fallos = 0; },
    fijarPausa: async (motivo) => { llamadas.pausa.push(motivo); estado.config.pausadas = true; estado.config.pausa_motivo = motivo; },
  };
  return { deps, llamadas, estado };
}

/* La fórmula del actuar ES la del lector (barrido cruzado) */
{
  let iguales = true;
  for (let Rr = 260; Rr <= 400; Rr += 3.7) {
    if (T.gananciaActuar(Rr, 925, 1000) !== A.ganancia(Rr, 925, 1000)) iguales = false;
  }
  ok(iguales, "gananciaActuar ≡ ganancia del Analista en todo el barrido (las copias no se separan)");
  cerca(T.gananciaActuar(319, 925, 1000), 43.89, 0.011, "G(319) con la tarifa viva = +43,89");
}
/* equilibradoDe: la doble lectura contra el libro crudo */
{
  const ventas = [
    { amount: "10", receive: "3279.5" }, { amount: "10", receive: "3200" },
    { amount: "10", receive: "13000" }, // trampa: fuera
    { amount: "10", receive: "3100", mine: true }, // propia: fuera
  ];
  ok(T.equilibradoDe(ventas, 333) === 320, "equilibradoDe = min(topVenta 320, eq−5 328)");
  ok(T.equilibradoDe(ventas, 300) === 295, "equilibradoDe capa al equilibrio (300−5)");
  ok(T.equilibradoDe([], 333) === null && T.equilibradoDe(ventas, null) === null, "equilibradoDe sin libro o sin eq -> null");
}

/* Camino feliz: crea UNA oferta con el payload exacto del diseño */
{
  const { deps, llamadas, estado } = depsMock();
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.ok === true && r.oferta_uuid === "oferta-nueva-1", "feliz: la oferta se crea");
  ok(llamadas.crear.length === 1, "feliz: QvaPay recibe UNA sola llamada");
  const p = llamadas.crear[0];
  ok(p.type === "sell" && p.coin === "ETECSA", "feliz: tipo clonado de su oferta y moneda ETECSA");
  ok(p.amount === 40 && p.receive === 12760, "feliz: $40 QUSD a 319 = recibe 12 760 saldo");
  ok(p.idempotency_key === ACCION.id, "feliz: idempotency_key = id de la acción");
  ok(p.requirements.min_completed === 25 && p.requirements.min_rating === 4.5, "feliz: requisitos nativos ≥25 ops y ≥4,5★");
  ok(Array.isArray(p.details) && p.details[0].telefono === "51231558", "feliz: details clonados de SU oferta (nunca inventados)");
  ok(estado.accion.estado === "ejecutada" && estado.accion.oferta_uuid === "oferta-nueva-1", "feliz: la bitácora queda «ejecutada» con el uuid");
  cerca(r.ganancia360, 43.89, 0.011, "feliz: la ganancia devuelta es la del collar (+43,89)");
  /* Idempotencia: un segundo toque NO crea otra oferta */
  const r2 = await T.ejecutarAccion(deps, ACCION.id);
  ok(r2.ok === false && r2.codigo === "ya_ejecutada" && llamadas.crear.length === 1,
    "idempotencia: el segundo toque con la misma acción no crea dos ofertas");
}
/* DETENER bloquea antes que todo */
{
  const { deps, llamadas, estado } = depsMock({ config: { detenidas: true, pausadas: false, pausa_motivo: null, accion_monto_qusd: 40, congelar_en_promo: true, crear_tipo: "sell" } });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "detenido" && llamadas.crear.length === 0, "DETENER: se niega y QvaPay no se toca");
  ok(estado.accion.estado === "negada" && estado.accion.detalle.baranda === "detenido", "DETENER: la negación queda en la bitácora");
}
/* Pausa por freno */
{
  const { deps, llamadas } = depsMock({ config: { detenidas: false, pausadas: true, pausa_motivo: "Tres errores seguidos.", accion_monto_qusd: 40, congelar_en_promo: true, crear_tipo: "sell" } });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "pausado" && /Tres errores/.test(r.motivo) && llamadas.crear.length === 0, "pausa: se niega con el motivo del freno");
}
/* Promo activa congela */
{
  const { deps, llamadas } = depsMock({ promo: true });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "promo" && llamadas.crear.length === 0, "promo: la automatización se congela");
}
/* EXENCIÓN de la app (decisión de Ernesto, 2026-11-11 21:04: «mi toque
   manda siempre»): con promo activa, una acción de origen 'app' PASA la
   baranda 3 y ejecuta; las de la vía automática (las que se ejecutan
   desde el botón de Telegram: 'dura_compra'/'cruce_eq') siguen negadas */
{
  const { deps, llamadas, estado } = depsMock({ promo: true });
  estado.accion = { ...ACCION, origen: "app" };
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.ok === true && llamadas.crear.length === 1, "exención: origen 'app' con promo activa PASA la baranda 3 y crea la oferta");
  for (const org of ["dura_compra", "cruce_eq"]) {
    const m = depsMock({ promo: true });
    m.estado.accion = { ...ACCION, origen: org };
    const rr = await T.ejecutarAccion(m.deps, ACCION.id);
    ok(rr.codigo === "promo" && m.llamadas.crear.length === 0, `exención: origen '${org}' (vía Telegram) sigue NEGADO en promo`);
  }
}
/* Veto por foto vieja (reloj de recepción, 20 min) */
{
  const { deps, llamadas } = depsMock({ foto: { recibida_en: iso(AHORA - 21 * 60000), libro_ok: true } });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "foto_vieja" && llamadas.crear.length === 0, "foto de 21 min: veto (tope 20)");
  const { deps: d2 } = depsMock({ foto: { recibida_en: iso(AHORA - 20 * 60000), libro_ok: true } });
  const r2 = await T.ejecutarAccion(d2, ACCION.id);
  ok(r2.ok === true, "foto de 20 min exactos: pasa el veto (borde)");
  const { deps: d3 } = depsMock({ foto: { recibida_en: iso(AHORA - 2 * 60000), libro_ok: false } });
  const r3 = await T.ejecutarAccion(d3, ACCION.id);
  ok(r3.codigo === "sin_libro", "foto sin libro: no se actúa a ciegas");
}
/* Collar: la tarifa se movió y la tasa ya pierde */
{
  const { deps, llamadas, estado } = depsMock({ tarifa: { salida: 800, costo: 1000 } });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "collar" && llamadas.crear.length === 0, "collar: con salida 800, vender a 319 pierde -> se niega");
  ok(/pierdes|perdería/.test(r.motivo) && r.ganancia360 < 0, "collar: el motivo trae la pérdida calculada");
  ok(estado.accion.detalle.ganancia360 < 0, "collar: la pérdida queda en la bitácora");
}
/* Topes: diario, por hora, por oferta y enfriamiento */
{
  const { deps } = depsMock({ conteo: { ultimaEjecutadaEn: null, enUltimaHora: 0, montoHoy: 90 } });
  ok((await T.ejecutarAccion(deps, ACCION.id)).codigo === "tope_diario", "tope: $90 de hoy + $40 pasa de $120");
  const { deps: d2 } = depsMock({ conteo: { ultimaEjecutadaEn: null, enUltimaHora: 2, montoHoy: 0 } });
  ok((await T.ejecutarAccion(d2, ACCION.id)).codigo === "tope_hora", "tope: 2 acciones en la última hora");
  const { deps: d3 } = depsMock({ conteo: { ultimaEjecutadaEn: iso(AHORA - 5 * 60000), enUltimaHora: 1, montoHoy: 40 } });
  ok((await T.ejecutarAccion(d3, ACCION.id)).codigo === "enfriamiento", "tope: enfriamiento de 10 min entre acciones");
  const { deps: d4, estado: e4 } = depsMock();
  e4.accion = { ...ACCION, monto_qusd: 41 };
  ok((await T.ejecutarAccion(d4, ACCION.id)).codigo === "tope_monto", "tope: el monto supera el tope por oferta de su config ($40)");
}
/* Doble lectura: el libro se movió más de 5 -> se descarta con la tasa nueva */
{
  const { deps, llamadas } = depsMock({ fresco: { equilibrado: 310, misOfertas: [{ ...OFERTA_BASE }] } });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "libro_movido" && r.tasa_nueva === 310 && llamadas.crear.length === 0, "doble lectura: |319−310| > 5 -> se descarta y dice la tasa nueva");
  const { deps: d2 } = depsMock({ fresco: { equilibrado: 315, misOfertas: [{ ...OFERTA_BASE }] } });
  ok((await T.ejecutarAccion(d2, ACCION.id)).ok === true, "doble lectura: |319−315| ≤ 5 -> se ejecuta");
}
/* Una sola oferta automática abierta */
{
  const { deps, llamadas } = depsMock({
    fresco: { equilibrado: 319, misOfertas: [{ ...OFERTA_BASE }, { uuid: "auto-viva", type: "sell", details: [], amount: "40", receive: "12760" }] },
    ejecutadas: [{ oferta_uuid: "auto-viva" }],
  });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "ya_hay_oferta" && llamadas.crear.length === 0, "una automática abierta bloquea la siguiente");
}
/* Sin oferta propia de la que clonar */
{
  const { deps } = depsMock({ fresco: { equilibrado: 319, misOfertas: [] } });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "sin_oferta_base" && /oferta tuya de VENTA abierta/.test(r.motivo), "sin oferta base: se niega en claro (no se inventan datos de pago)");
}
/* BLINDAJE (sonda viva 2026-11-12): su oferta abierta era de COMPRA y
   su tipo se había aprendido — la puerta jamás crea una compra */
{
  const compraSuya = { uuid: "su-compra", type: "buy", details: [{ telefono: "51231558" }], amount: "12", receive: "3595" };
  const { deps, llamadas } = depsMock({
    config: { detenidas: false, pausadas: false, pausa_motivo: null, accion_monto_qusd: 40, congelar_en_promo: true, crear_tipo: "buy" },
    fresco: { equilibrado: 319, misOfertas: [compraSuya] },
  });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "sin_oferta_base" && llamadas.crear.length === 0, "blindaje: con solo una compra suya abierta NO se crea nada");
  const { deps: d2, llamadas: l2 } = depsMock({
    config: { detenidas: false, pausadas: false, pausa_motivo: null, accion_monto_qusd: 40, congelar_en_promo: true, crear_tipo: "buy" },
    fresco: { equilibrado: 319, misOfertas: [compraSuya, { ...OFERTA_BASE }] },
  });
  const r2 = await T.ejecutarAccion(d2, ACCION.id);
  ok(r2.ok === true && l2.crear.length === 1 && l2.crear[0].type === "sell", "blindaje: el payload es «sell» SIEMPRE, aunque la config diga «buy»");
}
/* detalles_desconocidos (fase 2, 2026-11-12): la negación registra
   la FORMA observada de «details» (tipos y claves, jamás valores)
   pa discriminar la causa con el próximo toque real */
{
  const formaObj = T.formaDe({ telefono: "x", banco: "y" });
  ok(formaObj.tipo === "objeto" && formaObj.claves.join(",") === "banco,telefono" && !JSON.stringify(formaObj).includes("x"),
    "formaDe: objeto -> tipo + claves ordenadas, sin valores");
  ok(T.formaDe(null).tipo === "ausente" && T.formaDe(undefined).tipo === "ausente", "formaDe: null/undefined -> ausente");
  const formaArr = T.formaDe([{ telefono: "51231558" }]);
  ok(formaArr.tipo === "array" && formaArr.longitud === 1 && formaArr.claves[0] === "telefono" && !JSON.stringify(formaArr).includes("51231558"),
    "formaDe: array -> longitud + claves del primer elemento, sin valores");
  const conObjeto = { ...OFERTA_BASE, details: { telefono: "51231558" } };
  const { deps, llamadas, estado } = depsMock({ fresco: { equilibrado: 319, misOfertas: [conObjeto] } });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "detalles_desconocidos" && llamadas.crear.length === 0, "detalles como OBJETO: se niega igual que antes");
  ok(estado.accion.detalle?.forma_details?.tipo === "objeto" && estado.accion.detalle.forma_details.claves.includes("telefono")
    && !JSON.stringify(estado.accion.detalle).includes("51231558"),
    "detalles como objeto: la bitácora guarda la forma (objeto + claves) y ni un valor");
  const sinDetalles = { uuid: "sin-det", type: "sell", amount: "30", receive: "9600" };
  const { deps: d2, estado: e2 } = depsMock({ fresco: { equilibrado: 319, misOfertas: [sinDetalles] } });
  const r2 = await T.ejecutarAccion(d2, ACCION.id);
  ok(r2.codigo === "detalles_desconocidos" && e2.accion.detalle?.forma_details?.tipo === "ausente",
    "detalles AUSENTE: se niega y la bitácora dice «ausente»");
}
/* Botón vencido */
{
  const { deps, estado } = depsMock();
  estado.accion = { ...ACCION, expira_en: iso(AHORA - 60000) };
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "expirada" && estado.accion.estado === "expirada", "a los 10 min el botón vence y la acción queda «expirada»");
}
/* P2P_SIDE_NOT_ALLOWED: pausa total con el motivo en claro, sin bucle */
{
  const { deps, llamadas, estado } = depsMock({ crearResp: { ok: false, codigo: "P2P_SIDE_NOT_ALLOWED", mensaje: "side not allowed" } });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "sin_permiso" && llamadas.crear.length === 1, "sin permiso: UN intento, jamás bucle");
  ok(llamadas.pausa.length === 1 && /Vender en el P2P/.test(llamadas.pausa[0]), "sin permiso: pausa total con la instrucción en claro");
  ok(/interruptor/.test(r.motivo), "sin permiso: el motivo dice qué interruptor activar");
  ok(estado.accion.estado === "error", "sin permiso: la bitácora guarda el error de la API");
}
/* Errores de API suman al freno: al tercero, pausa */
{
  const { deps, llamadas, estado } = depsMock({ crearResp: { ok: false, codigo: "OTRO_ERROR", mensaje: "boom" } });
  estado.fallos = 2;
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "error_api" && r.pausa === true && llamadas.pausa.length === 1, "errores: el tercer fallo seguido dispara la pausa");
}
/* Resultado incierto: reconcilia; si la oferta aparece, es ejecutada */
{
  const { deps, estado } = depsMock({
    crearLanza: true,
    misAhora: [{ uuid: "aparecida", type: "sell", details: [], amount: "40", receive: "12760" }],
  });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.ok === true && r.reconciliada === true && estado.accion.estado === "ejecutada", "incierto + aparece en mis ofertas -> ejecutada reconciliada");
  const { deps: d2, llamadas: l2 } = depsMock({ crearLanza: true, misAhora: [] });
  const r2 = await T.ejecutarAccion(d2, ACCION.id);
  ok(r2.codigo === "resultado_desconocido" && l2.crear.length === 1, "incierto + no aparece -> no se reintenta a ciegas");
}

/* ===== E-1 · RECLAMO ATÓMICO (Tanda 3 del Inspector, 2026-11-12) ===== */
const ID2 = "22222222-3333-4444-8555-666666666666";
/* CONC-1: dos ejecuciones SIMULTÁNEAS de la MISMA acción, con el
   create tardando: QvaPay recibe UNA sola llamada, el perdedor
   recibe «en_ejecucion» sin escribir, el final es «ejecutada» */
{
  const { deps, llamadas, estado } = depsMock({ crearDemoraMs: 25 });
  const [r1, r2] = await Promise.all([T.ejecutarAccion(deps, ACCION.id), T.ejecutarAccion(deps, ACCION.id)]);
  ok(llamadas.crear.length === 1, "CONC-1: dos toques simultáneos -> crearOferta EXACTAMENTE 1 vez");
  const ganador = [r1, r2].find((r) => r.ok === true), perdedor = [r1, r2].find((r) => r.ok !== true);
  ok(Boolean(ganador), "CONC-1: uno de los dos ejecuta");
  ok(perdedor && perdedor.codigo === "en_ejecucion", "CONC-1: el perdedor recibe «en_ejecucion»");
  ok(estado.accion.estado === "ejecutada", "CONC-1: el estado final es «ejecutada» (el perdedor no pisó nada)");
}
/* Mundo compartido pa CONC-2: dos acciones DISTINTAS, un solo
   deps cuyos conteo/reclamo/leer/guardar miran el mundo entero;
   el conteo cuenta los reclamos vivos de las OTRAS acciones. */
function depsMundo() {
  const mundo = {
    acciones: {
      [ACCION.id]: { ...ACCION },
      [ID2]: { ...ACCION, id: ID2 },
    },
    config: { detenidas: false, pausadas: false, pausa_motivo: null, accion_monto_qusd: 40, congelar_en_promo: true, crear_tipo: "sell" },
    foto: { recibida_en: iso(AHORA - 5 * 60000), libro_ok: true },
    tarifa: { salida: 925, costo: 1000 },
    fresco: { equilibrado: 319, misOfertas: [{ ...OFERTA_BASE }] },
    crear: [],
  };
  const deps = {
    ahoraMs: () => AHORA,
    ahoraIso: () => iso(AHORA),
    leerAccion: async (id) => mundo.acciones[id] || null,
    reclamarAccion: async (id) => {
      const a = mundo.acciones[id];
      if (!a) return false;
      if (a.estado === "pendiente") { a.estado = "ejecutando"; a.reclamada_en = iso(AHORA); return true; }
      if (a.estado === "ejecutando" && a.reclamada_en && AHORA - Date.parse(a.reclamada_en) > T.RECLAMO_EXPIRA_MIN * 60000) {
        a.reclamada_en = iso(AHORA); return true;
      }
      return false;
    },
    guardarAccion: async (id, parche) => { Object.assign(mundo.acciones[id], parche); },
    leerConfig: async () => mundo.config,
    promoActiva: async () => false,
    leerFoto: async () => mundo.foto,
    leerTarifa: async () => mundo.tarifa,
    conteo: async (excluirId) => {
      const otras = Object.values(mundo.acciones).filter((a) => a.id !== excluirId);
      const ejec = otras.filter((a) => a.estado === "ejecutada");
      const recl = otras.filter((a) => a.estado === "ejecutando" && a.reclamada_en);
      const fechas = [...ejec.map((a) => a.resuelta_en), ...recl.map((a) => a.reclamada_en)].filter(Boolean).sort();
      return {
        ultimaEjecutadaEn: fechas.length ? fechas[fechas.length - 1] : null,
        enUltimaHora: ejec.length + recl.length,
        montoHoy: [...ejec, ...recl].reduce((s, a) => s + (Number(a.monto_qusd) || 0), 0),
      };
    },
    libroFresco: async () => mundo.fresco,
    accionesEjecutadas: async () => [],
    crearOferta: async (payload) => {
      mundo.crear.push(payload);
      await new Promise((r) => setTimeout(r, 40));
      return { ok: true, uuid: "oferta-mundo-1", crudo: { uuid: "oferta-mundo-1" } };
    },
    misOfertasAhora: async () => [],
    sumarFallo: async () => 1,
    reiniciarFallos: async () => {},
    fijarPausa: async () => {},
  };
  return { deps, mundo };
}
/* CONC-2: la segunda acción (distinta) arranca MIENTRAS la primera
   está dentro de crearOferta: su conteo ve el reclamo vivo de la
   primera y cae por enfriamiento — solo 1 crea */
{
  const { deps, mundo } = depsMundo();
  const p1 = T.ejecutarAccion(deps, ACCION.id);
  for (let i = 0; i < 200 && mundo.crear.length === 0; i++) await new Promise((r) => setTimeout(r, 1));
  ok(mundo.crear.length === 1, "CONC-2: la primera llegó a crearOferta (sigue en vuelo)");
  const r2 = await T.ejecutarAccion(deps, ID2);
  const r1 = await p1;
  ok(r1.ok === true && mundo.crear.length === 1, "CONC-2: solo la primera crea (1 llamada en total)");
  ok(r2.codigo === "enfriamiento", "CONC-2: la segunda niega por enfriamiento al ver el reclamo vivo de la primera");
  ok(mundo.acciones[ACCION.id].estado === "ejecutada" && mundo.acciones[ID2].estado === "negada", "CONC-2: estados finales ejecutada/negada");
}
/* CONC-3: «ejecutando» con reclamo de hace 10 min = reclamo
   vencido: se RECUPERA y ejecuta */
{
  const { deps, llamadas, estado } = depsMock();
  estado.accion = { ...ACCION, estado: "ejecutando", reclamada_en: iso(AHORA - 10 * 60000) };
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.ok === true && llamadas.crear.length === 1 && estado.accion.estado === "ejecutada", "CONC-3: reclamo vencido (10 min) se recupera y ejecuta");
}
/* CONC-4: «ejecutando» con reclamo FRESCO: «en_ejecucion» y
   QvaPay no se toca */
{
  const { deps, llamadas, estado } = depsMock();
  estado.accion = { ...ACCION, estado: "ejecutando", reclamada_en: iso(AHORA - 60000) };
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "en_ejecucion" && llamadas.crear.length === 0, "CONC-4: reclamo fresco -> «en_ejecucion», crearOferta 0 veces");
  ok(estado.accion.estado === "ejecutando", "CONC-4: el perdedor no escribe: la acción sigue «ejecutando» del dueño");
}

/* ===== E-6 · BITÁCORA SIN DETAILS (Tanda 3 del Inspector) =====
   En los 4 desenlaces con payload, el detalle guardado lleva la
   copia SIN «details» y con forma_details (tipo «array»); el
   payload que va a QvaPay conserva sus details intactos. */
function sinDetailsEn(detalle, n) {
  const p = detalle && detalle.payload;
  ok(p && !("details" in p), n + ": el payload de la bitácora NO lleva «details»");
  ok(p && p.forma_details && p.forma_details.tipo === "array", n + ": el payload de la bitácora lleva forma_details tipo «array»");
  ok(!JSON.stringify(detalle).includes("51231558"), n + ": ni un dato de pago en claro en todo el detalle");
}
/* BIT-1: éxito */
{
  const { deps, llamadas, estado } = depsMock();
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.ok === true, "BIT-1: éxito (precondición)");
  sinDetailsEn(estado.accion.detalle, "BIT-1 éxito");
  ok(Array.isArray(llamadas.crear[0].details) && llamadas.crear[0].details[0].telefono === "51231558", "BIT-1: el payload a QvaPay SÍ lleva sus details intactos");
}
/* BIT-2: reconciliada */
{
  const { deps, estado } = depsMock({ crearLanza: true, misAhora: [{ uuid: "aparecida", type: "sell", details: [], amount: "40", receive: "12760" }] });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.ok === true && r.reconciliada === true, "BIT-2: reconciliada (precondición)");
  sinDetailsEn(estado.accion.detalle, "BIT-2 reconciliada");
}
/* BIT-3: resultado_desconocido */
{
  const { deps, estado } = depsMock({ crearLanza: true, misAhora: [] });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "resultado_desconocido", "BIT-3: resultado_desconocido (precondición)");
  sinDetailsEn(estado.accion.detalle, "BIT-3 resultado_desconocido");
}
/* BIT-4: error_api */
{
  const { deps, estado } = depsMock({ crearResp: { ok: false, codigo: "OTRO_ERROR", mensaje: "boom" } });
  const r = await T.ejecutarAccion(deps, ACCION.id);
  ok(r.codigo === "error_api", "BIT-4: error_api (precondición)");
  sinDetailsEn(estado.accion.detalle, "BIT-4 error_api");
}

console.log(`\nACTUAR v1: ${pass} PASS · ${fail} FAIL`);
if (fails.length) { console.log("Fallos:", fails.join(" | ")); process.exit(1); }

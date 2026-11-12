// Copia para CI (GitHub Actions) del banco vivo en research_notes — mismos chequeos,
// solo cambian las rutas: jsdom por nombre y la raíz del repo se resuelve desde este archivo
// (o la variable BANCO_REPO). Si el banco vivo cambia, se refresca esta copia.
// Banco de «Mercado» v2 (2026-11-11) — incluye ÍNTEGRO el banco v1 (58 chequeos:
// lógica del lector + render de las seis pantallas) y añade el ANALISTA:
//  C) invariantes INV-A1…A10 del estudio del Analista contra analista.js
//     (la MISMA matemática que despliega el lector): vectores de G,
//     escalera, VWAP honesto, menú maker, duras con marcas probadas,
//     transferencia en dos notaciones, señal con puerta, sonda sin
//     valores personales y las reservas de la Fase 2.
//  D) el render de la pantalla Analista (jsdom): señal, peldaño
//     bloqueado con su porqué, DETENER activado, foto vieja marcada,
//     bloque de transferencia y el texto anti-humo.
import { JSDOM } from "jsdom";
import fs from "fs";
import * as L from "./fixtures/mercado-logica.js";
import * as A from "./fixtures/mercado-analista.js";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");

let pass = 0, fail = 0; const fails = [];
function ok(c, n) { if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }
function eqNum(a, b, n) { ok(typeof a === "number" && Math.abs(a - b) < 1e-9, n + " (dio " + a + ")"); }
function cerca(a, b, tol, n) { ok(typeof a === "number" && Math.abs(a - b) <= tol, n + " (dio " + a + ")"); }

/* ================= A) LÓGICA PURA DEL LECTOR (v1, íntegro) ================= */
// Equilibrio = 360 * salida / costo (saldo por QUSD)
eqNum(L.equilibrio(950, 1000), 342, "equilibrio 950/1000 = 342");
eqNum(L.equilibrio(930, 1000), 334.8, "equilibrio 930/1000 = 334.8");
eqNum(L.equilibrio("950", "1000"), 342, "equilibrio acepta textos (la API da decimales como texto)");
ok(L.equilibrio(950, null) === null, "sin costo -> equilibrio null (no se inventa)");
ok(L.equilibrio(950, 0) === null, "costo 0 -> null");
ok(L.equilibrio(null, 1000) === null, "sin salida -> null");

// Regla de demanda: bordes exactos 24/25 y 300.00/300.01
ok(L.cumpleDemanda(25, 300) === true, "demanda: 25 compras y nivel 300.00 CUMPLE");
ok(L.cumpleDemanda(24, 300) === false, "demanda: 24 compras NO cumple");
ok(L.cumpleDemanda(25, 300.01) === false, "demanda: nivel 300.01 NO cumple");
ok(L.cumpleDemanda(25, 299.99) === true, "demanda: nivel 299.99 cumple");
ok(L.cumpleDemanda(40, 280) === true, "demanda: 40 compras y nivel 280 cumple");
ok(L.cumpleDemanda(null, 280) === false, "demanda: sin conteo no cumple");
ok(L.cumpleDemanda(30, null) === false, "demanda: sin nivel (sin libro) no cumple");
ok(L.num(null) === null && L.num(undefined) === null && L.num("") === null, "num: null/undefined/vacío -> null (nunca 0)");

// Dos confirmaciones: la secuencia completa de la máquina de estados
let e = { pendiente: 0, alertada: false };
let r = L.evaluarDemanda(e, { usable: true, cumple: true });
ok(r.pendiente === 1 && r.avisar === false, "1ª lectura que cumple: pendiente=1, SIN aviso");
r = L.evaluarDemanda(r, { usable: true, cumple: true });
ok(r.avisar === true && r.alertada === true && r.pendiente === 0, "2ª lectura que cumple: AVISO y alertada");
r = L.evaluarDemanda(r, { usable: true, cumple: true });
ok(r.avisar === false && r.alertada === true, "ya alertada: no se repite el aviso");
r = L.evaluarDemanda(r, { usable: true, cumple: false });
ok(r.alertada === false && r.pendiente === 0, "deja de cumplir: rearme limpio");
r = L.evaluarDemanda(r, { usable: true, cumple: true });
ok(r.pendiente === 1 && r.avisar === false, "tras el rearme, una sola lectura NO avisa");
// Foto vieja o sin libro: el estado NO se toca (Regla 7)
r = L.evaluarDemanda(r, { usable: false, cumple: true });
ok(r.pendiente === 1 && r.avisar === false, "lectura no usable NO confirma ni borra el pendiente");
r = L.evaluarDemanda(r, { usable: false, cumple: false });
ok(r.pendiente === 1, "lectura no usable tampoco resetea: no concluye nada");
r = L.evaluarDemanda(r, { usable: true, cumple: true });
ok(r.avisar === true, "con el pendiente intacto, la siguiente usable SÍ confirma");

// Frescura con dos relojes (origen vs recepción), umbral 30 min
const ahora = Date.now();
ok(L.esFresca(new Date(ahora - 29 * 60000).toISOString(), ahora) === true, "frescura: origen de hace 29 min es fresca");
ok(L.esFresca(new Date(ahora - 31 * 60000).toISOString(), ahora) === false, "frescura: origen de hace 31 min es VIEJA");
ok(L.esFresca(null, ahora) === false, "frescura: sin origen no es fresca");
ok(L.esFresca("no-es-fecha", ahora) === false, "frescura: origen ilegible no es fresca");

// Libro: nivel20 contra top, trampa de 2500, ofertas propias, mínimo 20 USD
const comprasV1 = [
  { ratio: "310.5", amount: "5" },                    // top real (poco monto)
  { ratio: "299.9", amount: "25" },                   // nivel20
  { ratio: "305", available_amount: "19.9" },         // flexible con <20 USD: no cuenta
  { ratio: "2500", amount: "100" },                   // trampa: fuera
  { ratio: "320", amount: "50", mine: true },         // propia: fuera
  { ratio: "295", amount: "100" },
];
eqNum(L.topCompra(comprasV1), 310.5, "top compra = 310.5 (ignora trampa y propias)");
eqNum(L.nivel20(comprasV1), 299.9, "nivel20 = 299.9 (exige >= 20 USD detrás)");
ok(L.nivel20(comprasV1) !== L.topCompra(comprasV1), "nivel20 NO es el top: son niveles distintos");
eqNum(L.topVenta([{ ratio: "315", amount: "10" }, { ratio: "312.4", amount: "3" }]), 312.4, "top venta = la menor tasa");
ok(L.nivel20([]) === null && L.topCompra([]) === null, "libro vacío -> niveles null");

// Tasa sugerida: nunca por encima del equilibrio
eqNum(L.tasaSugerida(299.9, 342), 299.9, "sugerida: manda el libro si está bajo el equilibrio");
eqNum(L.tasaSugerida(350, 342), 342, "sugerida: el equilibrio capa al libro");
eqNum(L.tasaSugerida(299.9, null), 299.9, "sugerida sin equilibrio: el libro");
ok(L.tasaSugerida(null, 342) === null, "sugerida sin libro: null");

/* ================= C) ANALISTA — INV-A1…A10 ================= */
const SAL = 925, COS = 1000, EQ = 333; // la tarifa del estudio

// INV-A2 · Vectores de G contra los números del estudio (§4.1/§6)
eqNum(A.ganancia(333, SAL, COS), 0, "A2 G(333) = 0 exacto en el equilibrio");
cerca(A.ganancia(320, SAL, COS), 40.63, 0.011, "A2 G(320) = +40,63");
cerca(A.ganancia(315, SAL, COS), 57.14, 0.011, "A2 G(315) = +57,14");
cerca(A.ganancia(360 / 1.18, SAL, COS), 91.50, 0.011, "A2 G(nivel20 sin redondear) = +91,50");
cerca(A.ganancia(340, SAL, COS), -20.59, 0.011, "A2 G(340) = −20,59");
ok(A.ganancia(null, SAL, COS) === null && A.ganancia(320, null, COS) === null && A.ganancia(320, SAL, null) === null,
  "A2 G sin datos = null (no se inventa)");
{ // monotonía: G decrece al subir R (barrido)
  let ant = Infinity, mono = true;
  for (let Rr = 260; Rr <= 400; Rr += 7) { const g = A.ganancia(Rr, SAL, COS); if (!(g < ant)) mono = false; ant = g; }
  ok(mono, "A2 G es estrictamente decreciente en R (barrido 260→400)");
}
// Zonas del collar (Estudio 2 §3.1)
ok(A.zonaDe(-0.01) === "negativa" && A.zonaDe(0) === "fina" && A.zonaDe(24.99) === "fina" && A.zonaDe(25) === "automatica",
  "A2 zonas: <0 prohibida · 0..24,99 fina · ≥25 automática");

// Escalera: agregación por tasa, orden de la casa, tope 10 niveles, sin trampa ni propias
const libroCompraCrudo = [
  { amount: "10", receive: "3050.8" },                       // 305.08 · 10 USD
  { amount: "20.15", receive: "6147.462" },                  // 305.08 · 20.15 USD (se suma)
  { amount: "50", receive: "15051" },                        // 301.02
  { amount: "100", receive: "30015" },                       // 300.15
  { amount: "5", receive: "13000" },                         // trampa 2600: fuera
  { amount: "9", receive: "2745.72", mine: true },           // propia: fuera
  { amount: "500", receive: "157500", available_amount: "0" }, // tasa 315 pero SIN disponible: no es nivel
];
const escC = A.escalera(libroCompraCrudo, "compra");
ok(escC.length === 3, "escalera compra: 3 niveles (trampa, propia y sin-disponible fuera)");
ok(!escC.some((n) => n.tasa === 315), "escalera: la oferta con available_amount 0 no crea nivel fantasma (foto viva 2026-11-12)");
eqNum(escC[0].tasa, 305.08, "escalera compra: primer nivel 305.08 (orden desc)");
cerca(escC[0].usd, 30.15, 1e-9, "escalera compra: el nivel suma los USD de su tasa");
cerca(escC[0].acumulado, 30.15, 1e-9, "escalera compra: acumulado del nivel 1");
cerca(escC[2].acumulado, 180.15, 1e-9, "escalera compra: acumulado total 180,15 USD");
const escV = A.escalera([
  { amount: "10", receive: "3279.5" }, { amount: "10", receive: "3200" }, { amount: "10", receive: "3249.9" },
], "venta");
ok(escV[0].tasa === 320 && escV[2].tasa === 327.95, "escalera venta: orden asc desde la menor tasa");
{ // tope de 10 niveles
  const muchas = Array.from({ length: 14 }, (_, i) => ({ amount: "1", receive: String(300 + i) }));
  ok(A.escalera(muchas, "compra").length === 10, "escalera: se queda con los 10 primeros niveles");
}

// INV-A3 · VWAP ejecutable honesto
eqNum(A.vwapCompra(escC, 20).tasa, 305.08, "A3 VWAP a 20 USD = nivel20 (305,08)");
cerca(A.vwapCompra(escC, 40).tasa, 304.08, 0.011, "A3 VWAP a 40 USD recorre dos niveles (304,08)");
ok(A.vwapCompra(escC, 200) === null, "A3 sin profundidad (200 > 180,15) -> null honesto");
cerca(A.ejecutableParcial(escC).usd, 180.15, 1e-9, "A3 parcial: solo hay 180,15 USD ejecutables");
ok(A.vwapCompra([], 20) === null && A.ejecutableParcial([]) === null, "A3 libro vacío -> null");

// INV-A1 · Menú maker: vectores de la foto del estudio + peldaño con pérdida bloqueado
const escVentaEstudio = [
  { tasa: 320, usd: 50, acumulado: 50 }, { tasa: 324.99, usd: 40, acumulado: 90 }, { tasa: 327.95, usd: 30, acumulado: 120 },
];
const menu = A.menuMaker({ topVenta: 320, nivel20: 305.08, equilibrio: EQ, salida: SAL, costo: COS, escVenta: escVentaEstudio });
const [pInm, pEq, pPac] = menu.peldanos;
eqNum(pInm.tasa, 321, "A1 Inmediato = min(topVenta+tick, eq−colchón) = 321");
cerca(pInm.g, 37.38, 0.011, "A1 Inmediato G = +37,38");
eqNum(pEq.tasa, 320, "A1 Equilibrado = 320");
cerca(pEq.g, 40.63, 0.011, "A1 Equilibrado G = +40,63");
eqNum(pPac.tasa, 305.08, "A1 Paciente = nivel20");
cerca(pPac.g, 91.52, 0.011, "A1 Paciente G = +91,52 (a la tasa redondeada)");
eqNum(pPac.delanteUsd, 120, "A1 Paciente: todo el libro de venta por delante (120 USD)");
eqNum(pEq.delanteUsd, 70, "A1 Equilibrado: por delante 70 USD (324,99 + 327,95)");
ok(!pInm.bloqueado && !pEq.bloqueado && !pPac.bloqueado, "A1 con la foto del estudio ningún peldaño se bloquea");
{ // nivel20 SOBRE el equilibrio: el Paciente pierde -> bloqueado con su porqué
  const m2 = A.menuMaker({ topVenta: 320, nivel20: 350, equilibrio: EQ, salida: SAL, costo: COS, escVenta: escVentaEstudio });
  const pac2 = m2.peldanos[2];
  ok(pac2.bloqueado === true && pac2.g < 0, "A1 Paciente a 350 (> eq 333) se bloquea: pierde");
  ok(/pierdes/.test(pac2.motivo) && /CUP por recarga/.test(pac2.motivo), "A1 el bloqueo dice cuánto pierde y en qué unidad");
  const m3 = A.menuMaker({ topVenta: 340, nivel20: 305.08, equilibrio: EQ, salida: SAL, costo: COS, escVenta: escVentaEstudio });
  ok(m3.peldanos[0].zona === "fina", "A1 Inmediato capado al techo (328) cae en zona fina (G +15,24)");
  ok(A.menuMaker({ topVenta: null, nivel20: null, equilibrio: EQ, salida: SAL, costo: COS, escVenta: [] }).peldanos.every((p) => p.bloqueado),
    "A1 sin libro: los tres peldaños bloqueados con motivo");
}

// Marcas de contraparte: solo campos probados; sin datos -> sin marca
// (campos REALES verificados por la sonda en vivo: rating_avg / rating_count)
const mReal = A.marcaDe({ rating_avg: 4.8, rating_count: 132, _count: { p2p_offers: 12 } });
ok(mReal && mReal.nivel === "verde" && mReal.texto.includes("4,8★") && mReal.texto.includes("132 ops"), "marca verde con los campos reales del payload (rating_avg/rating_count)");
ok(A.marcaDe({ rating_avg: 4.0, rating_count: 40 }).nivel === "roja", "marca roja con los campos reales (rating_avg 4,0)");
const mVerde = A.marcaDe({ p2p_average_rating: 4.8, p2p_completed_count: 132 });
ok(mVerde && mVerde.nivel === "verde" && mVerde.texto.includes("4,8★") && mVerde.texto.includes("132 ops"), "marca verde: 🟢 4,8★ · 132 ops");
ok(A.marcaDe({ p2p_average_rating: 4.0, p2p_completed_count: 40 }).nivel === "roja", "marca roja: rating 4,0 < 4,3");
ok(A.marcaDe({ p2p_average_rating: 4.9, p2p_completed_count: 24 }).nivel === "roja", "marca roja: 24 ops < 25");
ok(A.marcaDe({ p2p_average_rating: 4.9, p2p_completed_count: 3 }).nivel === "amarilla", "marca amarilla: cuenta nueva (3 ops)");
ok(A.marcaDe({}) === null && A.marcaDe(null) === null, "sin campos de reputación -> marca null (no se inventa)");
ok(A.textoMarca({}).includes("sin datos de reputación"), "textoMarca honesto cuando el payload no trae reputación");

// INV-A4 · Ofertas duras completas: tamaño, frescura del filtro, marca no roja
const userBueno = { p2p_average_rating: 4.8, p2p_completed_count: 132 };
const userFlojo = { p2p_average_rating: 4.0, p2p_completed_count: 40 };
const durasRes = A.detectarDuras({
  compras: [
    { uuid: "d-buena", amount: "50", receive: "15000", User: userBueno },      // R=300, G=+110
    { uuid: "d-pequena", amount: "10", receive: "3000", User: userBueno },     // tamaño 10 < 20: no
    { uuid: "d-floja", amount: "30", receive: "9000", User: userFlojo },       // floja: descartada
    { uuid: "d-propia", amount: "40", receive: "12000", mine: true, User: userBueno }, // propia: no
    { uuid: "d-cara", amount: "40", receive: "13600", User: userBueno },       // R=340 > eq−5: no
  ],
  ventas: [
    { uuid: "v-anomala", amount: "10", receive: "4000", User: userBueno }, // R=400 vs ej 305,08
    { uuid: "v-agotada", amount: "10", receive: "4000", available_amount: "0", User: userBueno }, // sin disponible: no cuenta
  ],
  eq: EQ, salida: SAL, costo: COS, escCompra: escC,
});
ok(durasRes.duras.length === 2, "A4 duras: la buena + la venta anómala (2)");
const duraC = durasRes.duras.find((d) => d.lado === "compra");
ok(duraC && duraC.uuid === "d-buena" && duraC.g360 === 110, "A4 compra dura a 300: G = +110,00 exacto");
ok(duraC.marca.includes("132 ops"), "A4 la dura trae la marca de su contraparte");
const duraV = durasRes.duras.find((d) => d.lado === "venta");
cerca(duraV.vueltaPct, 31.1, 0.051, "A4 venta anómala a 400: vuelta +31,1 %");
ok(durasRes.descartadas.length === 1 && durasRes.descartadas[0].uuid === "d-floja", "A4 la de contraparte floja se descarta, no se avisa");

// INV-A6 · Transferencia: dos notaciones, vectores del estudio, unidades separadas
cerca(A.dMinDe(1064.27, 925), 0.1308, 0.0011, "A6 d_min con el promedio real 1064,27 y salida 925 = 13,1 %");
cerca(A.primaDeD(A.dMinDe(1064.27, 925)), 0.1505, 0.0011, "A6 el mismo número en prima callejera: «al 15,1 %»");
eqNum(A.bMaxDe(925, 0.20), 1156.25, "A6 B_max al 20 % = 1156,25 exacto");
cerca(A.gananciaTransfPorQusd(1064.27, 925, 0.20), 73.58, 0.011, "A6 ganancia por QUSD al 20 % = 73,58 CUP");
cerca(A.dDePrima(0.40), 0.2857, 0.0011, "A6 «al 40 %» (7000 por 5000) = descuento 28,6 %");
cerca(A.dDePrima(0.19), 0.1597, 0.0011, "A6 «al 19 %» histórico = descuento 15,9 %");
ok(A.dMinDe(null, 925) === null && A.bMaxDe(925, 1) === null, "A6 sin precio o con d=1 -> null (no se inventa)");
{ const bt = A.bloqueTransferencia({ bEj: 1064.27, salida: 925, esPromedio: true });
  ok(bt && bt.esPromedio === true && bt.bMax20 === 1156.25, "A6 el bloque etiqueta el promedio cuando no hay libro"); }

// INV-A5 · Señal con puerta: de foto no usable no sale palabra
const sNo = A.senalCompleta({ usable: false, dura: null, vwap20: null, menu, eq: EQ, topVenta: 320, salida: SAL, costo: COS });
ok(sNo.palabra === null && /sin conclusión/.test(sNo.motivo), "A5 foto no usable -> señal null con su motivo");
const sApr = A.senalCompleta({ usable: true, dura: duraC, vwap20: { tasa: 305.08 }, menu, eq: EQ, topVenta: 320, salida: SAL, costo: COS });
ok(sApr.palabra === "APROVECHAR" && sApr.numeros.tasa === 300, "A5 con dura viva -> APROVECHAR con su tasa");
const sVen = A.senalCompleta({ usable: true, dura: null, vwap20: { tasa: 305.08 }, menu, eq: EQ, topVenta: 320, salida: SAL, costo: COS });
ok(sVen.palabra === "VENDER" && sVen.numeros.ganancia360 > 25, "A5 ejecutable ≥ +25 -> VENDER");
const escVentaPesada = [{ tasa: 340, usd: 5, acumulado: 5 }];
const menuPesado = A.menuMaker({ topVenta: 340, nivel20: 305.08, equilibrio: EQ, salida: SAL, costo: COS, escVenta: escVentaPesada });
const sEsp = A.senalCompleta({ usable: true, dura: null, vwap20: { tasa: 335 }, menu: menuPesado, eq: EQ, topVenta: 340, salida: SAL, costo: COS });
ok(sEsp.palabra === "ESPERAR" && /sobre tu equilibrio/.test(sEsp.motivo), "A5 cima sobre el equilibrio -> ESPERAR con ese motivo");

// Cruce de equilibrio: el suelo es eq × 0,92
ok(A.ladoCruce(305.08, 333) === "bajo" && A.ladoCruce(320, 333) === "sobre" && A.ladoCruce(null, 333) === null,
  "cruce: 305,08 bajo el suelo 306,36 · 320 sobre · sin nivel no hay lado");

// Sonda: solo NOMBRES de campo y la reputación numérica; jamás valores personales
const sonda = A.sondaPayload({
  compras: [{ uuid: "x", amount: "1", receive: "300", details: [], User: { username: "alguien", rating_avg: 4.8, rating_count: 132, _count: { p2p_offers: 12 } } }],
  ventas: [],
  propias: [{ _lado: "sell", uuid: "m", amount: "5", receive: "1600", details: [{ telefono: "51231558" }] }],
});
ok(sonda.claves_user.includes("rating_avg") && sonda.reputacion_ejemplo.ops === 132 && sonda.reputacion_ejemplo.rating === 4.8, "sonda: claves de User y reputación numérica (campos reales)");
ok(sonda.user_count_forma && sonda.user_count_forma.claves.includes("p2p_offers"), "sonda: la FORMA de _count viaja (claves, jamás valores)");
ok(sonda.propia.lado === "sell" && sonda.propia.detalles_forma.elemento.claves.includes("telefono"), "sonda: la propia dice su lado y la FORMA de details");
ok(!JSON.stringify(sonda).includes("51231558") && !JSON.stringify(sonda).includes("alguien"), "sonda: NINGÚN valor personal viaja (ni teléfono ni username)");

// INV-A7 · Los dos relojes viajan en el payload (render, sección D: «dato de origen»)
// INV-A8/A9/A10 · Reservas de la Fase 2: en la Fase 1 NO existen
// patrones por hora (A8), velas (A9) ni tendencia/pendiente (A10):
// si alguien los añade al módulo, este banco obliga a registrarlo.
const exportsA = Object.keys(A).join(" ");
ok(!/patron/i.test(exportsA), "A8 Fase 2: no hay patrones por hora en la Fase 1");
ok(!/vela/i.test(exportsA), "A9 Fase 2: no hay velas en la Fase 1");
ok(!/tendencia|pendiente/i.test(exportsA), "A10 Fase 2: no hay tendencia ni pendiente en la Fase 1");
ok(A.TEXTO_ANTI_HUMO.includes("Esto no predice el mercado"), "anti-humo: el texto fijo del estudio está en el módulo");

/* ================= B) RENDER (jsdom) — v1, íntegro ================= */
const html = fs.readFileSync(REPO + "mercado/index.html", "utf8");
const isoMin = (m) => new Date(Date.now() - m * 60000).toISOString();
function fotoBase(extra) {
  return Object.assign({
    id: "f1", recibida_en: isoMin(2), origen_en: isoMin(4), origen: "lector", fresca: true, libro_ok: true,
    etecsa_top_compra: 310.5, etecsa_nivel20: 299.9, etecsa_top_venta: 312.4,
    etecsa_promedio: 303.37, etecsa_promedio_compra: 302.36, etecsa_promedio_venta: 305.1,
    etecsa_count: 107, etecsa_count_buy: 21, etecsa_count_sell: 86,
    bankcup_promedio: 1064.10, bankcup_count: 40, bankcup_count_buy: 15,
    toque: null, salida_ref: 950, costo_ref: 1000, equilibrio: 342,
  }, extra || {});
}
function ultimaBase(foto, extra) {
  return Object.assign({
    foto,
    estado: { demanda_pendiente: 0, demanda_alertada: false, lector_con_libro: true, actualizado: isoMin(2) },
    config: { costo_ref360: 1000, umbral_count_buy: 25, umbral_nivel20: 300 },
    tarifa: { salida_ref: 950, actualizado: isoMin(60) },
  }, extra || {});
}
const histBase = [
  { id: "h1", recibida_en: isoMin(2), origen_en: isoMin(4), origen: "lector", fresca: true, libro_ok: true, etecsa_nivel20: 299.9, etecsa_top_compra: 310.5, etecsa_promedio: 303.37, etecsa_count_buy: 21, equilibrio: 342 },
  { id: "h2", recibida_en: isoMin(17), origen_en: isoMin(19), origen: "lector", fresca: true, libro_ok: true, etecsa_nivel20: 305.2, etecsa_top_compra: 311, etecsa_promedio: 304.9, etecsa_count_buy: 18, equilibrio: 342 },
];
const promosBase = [
  { id: "p1", clave: "pagina-x", titulo: "La página de promos de ETECSA cambió", detalle: "Candidata de prueba", estado: "candidata", fuente: "pagina_etecsa", desde: null, hasta: null, creada_en: isoMin(30) },
  { id: "p2", clave: "x5-2026-11-09", titulo: "Recarga internacional ×5", detalle: "Promoción conocida", estado: "conocida", fuente: "registro", desde: "2026-11-09", hasta: "2026-11-14", creada_en: isoMin(3000) },
];
const avisosBase = { bot_vinculado: true, lector_con_libro: true, total_alertas: 0, ultima_alerta: null, alertas: [] };

async function crearDom(fx) {
  const dom = new JSDOM(html, {
    url: "https://ernesto5058.github.io/calculadora-ernesto/mercado/",
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w) {
      w.fetch = (url) => {
        const u = String(url);
        if (fx.sinRed) return Promise.reject(new Error("sin red"));
        let data = null;
        if (u.includes("mercado_ultima_foto")) data = fx.ultima;
        else if (u.includes("mercado_historial")) data = fx.historial;
        else if (u.includes("mercado_promos")) data = fx.promos;
        else if (u.includes("mercado_avisos")) data = fx.avisos;
        else if (u.includes("ultimo.json")) { fx.llamadasRespaldo = (fx.llamadasRespaldo || 0) + 1; data = { ts: isoMin(60 * 30), ETECSA: { average: 312.9, count_buy: 27, count: 86 }, BANK_CUP: { average: 1110.25 } }; }
        return Promise.resolve({ ok: true, status: 200, json: async () => data });
      };
    },
  });
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const t = dom.window.document.getElementById("ctAhora");
    if (t && !t.querySelector(".esqueleto") && t.textContent.trim().length > 40) break;
  }
  return dom;
}
const txt = (dom, id) => dom.window.document.getElementById(id).textContent;

// S1: foto fresca con libro y equilibrio desde la tarifa del fixture
{
  const fx = { ultima: ultimaBase(fotoBase()), historial: histBase, promos: promosBase, avisos: avisosBase };
  const dom = await crearDom(fx);
  const ahoraTxt = txt(dom, "ctAhora");
  ok(ahoraTxt.includes("299,90"), "S1 Ahora: héroe = nivel20 299,90 saldo por QUSD");
  ok(ahoraTxt.includes("FRESCA"), "S1 Ahora: sello FRESCA visible");
  ok(ahoraTxt.includes("310,50"), "S1 Ahora: top compra 310,50");
  ok(ahoraTxt.includes("1064,10"), "S1 Ahora: BANK_CUP 1064,10 CUP por QUSD");
  ok(!fx.llamadasRespaldo, "S1: con foto del lector NO se toca el respaldo del repo");
  const eq = txt(dom, "ctEquilibrio");
  ok(eq.includes("342,00"), "S1 Equilibrio: 342,00 desde la tarifa del fixture");
  ok(eq.includes("por debajo de tu equilibrio"), "S1 Equilibrio: el libro está por debajo -> vender sin perder");
  ok(eq.includes("Equilibrio = 360"), "S1 Equilibrio: la fórmula va escrita con sus unidades");
  const dem = txt(dom, "ctDemanda");
  ok(dem.includes("Sin demanda por ahora"), "S1 Demanda: 21 compras no disparan nada");
  ok(dem.includes("Compras reales: 21 de 25"), "S1 Demanda: conteo contra su umbral");
  const pro = txt(dom, "ctPromos");
  ok(pro.includes("POR CONFIRMAR") && pro.includes("CONOCIDA"), "S1 Promos: candidata y conocida se distinguen");
  const his = txt(dom, "ctHistorial");
  ok(his.includes("Fotos guardadas"), "S1 Historial: lista de fotos");
  ok(!!dom.window.document.querySelector("#ctHistorial polyline"), "S1 Historial: mini-gráfica dibujada");
  const avi = txt(dom, "ctAvisos");
  ok(avi.includes("Vinculado") && avi.includes("Ninguna alerta todavía"), "S1 Avisos: bot vinculado y cero alertas");
  dom.window.close();
}
// S2: una lectura cumple -> ámbar, sin aviso todavía
{
  const fx = { ultima: ultimaBase(fotoBase({ etecsa_count_buy: 27, etecsa_nivel20: 298 }),
    { estado: { demanda_pendiente: 1, demanda_alertada: false, lector_con_libro: true, actualizado: isoMin(2) } }),
    historial: histBase, promos: promosBase, avisos: avisosBase };
  const dom = await crearDom(fx);
  ok(txt(dom, "ctDemanda").includes("Una lectura ya cumple"), "S2 Demanda: pendiente=1 se ve en ámbar, sin celebrar");
  dom.window.close();
}
// S3: demanda confirmada y alerta registrada
{
  const fx = { ultima: ultimaBase(fotoBase({ etecsa_count_buy: 27, etecsa_nivel20: 298 }),
    { estado: { demanda_pendiente: 0, demanda_alertada: true, lector_con_libro: true, actualizado: isoMin(2) } }),
    historial: histBase, promos: promosBase,
    avisos: { bot_vinculado: true, lector_con_libro: true, total_alertas: 1,
      ultima_alerta: { id: "a1", creada_en: isoMin(20), tipo: "demanda", titulo: "VOLVIÓ LA DEMANDA — saldo ETECSA", cuerpo: "Compras reales: 27", entregado: true }, alertas: [] } };
  const dom = await crearDom(fx);
  ok(txt(dom, "ctDemanda").includes("VOLVIÓ LA DEMANDA"), "S3 Demanda: confirmada en verde");
  ok(txt(dom, "ctAvisos").includes("entregada por Telegram"), "S3 Avisos: la alerta consta como entregada");
  dom.window.close();
}
// S4: respaldo sin libro y sin costo -> honestidad completa
{
  const fotoR = fotoBase({ origen: "respaldo", libro_ok: false, etecsa_top_compra: null, etecsa_nivel20: null,
    etecsa_top_venta: null, costo_ref: null, equilibrio: null });
  const fx = { ultima: ultimaBase(fotoR, { config: { costo_ref360: null, umbral_count_buy: 25, umbral_nivel20: 300 },
    estado: { demanda_pendiente: 0, demanda_alertada: false, lector_con_libro: false, actualizado: isoMin(2) } }),
    historial: histBase, promos: promosBase,
    avisos: { bot_vinculado: true, lector_con_libro: false, total_alertas: 0, ultima_alerta: null, alertas: [] } };
  const dom = await crearDom(fx);
  const ahoraTxt = txt(dom, "ctAhora");
  ok(ahoraTxt.includes("RESPALDO"), "S4 Ahora: sello RESPALDO visible");
  ok(ahoraTxt.includes("303,37"), "S4 Ahora: el héroe cae al promedio (no inventa nivel20)");
  ok(txt(dom, "ctEquilibrio").includes("Falta tu costo del día"), "S4 Equilibrio: sin costo se dice, no se inventa");
  ok(!ahoraTxt.includes("0,00"), "S4 Ahora: ningún nivel ausente se pinta como 0,00");
  ok(txt(dom, "ctDemanda").includes("Vigilando en respaldo"), "S4 Demanda: sin libro no se finge la vigilancia");
  dom.window.close();
}
// S5: sin red y sin caché -> error en palabras claras (nunca esqueleto eterno)
{
  const fx = { sinRed: true, ultima: null, historial: [], promos: [], avisos: {} };
  const dom = await crearDom(fx);
  ok(txt(dom, "ctAhora").includes("No pude leer tu servidor"), "S5: error claro sin conexión ni caché");
  dom.window.close();
}

/* ================= D) RENDER DEL ANALISTA ================= */
// Análisis de fixture con la forma exacta que guarda el lector.
function analisisFixture(extra) {
  return Object.assign({
    menu: { techo: 328, libroVentaUsd: 120, peldanos: [
      { nombre: "Inmediato", tasa: 321, g: 37.38, zona: "automatica", delanteUsd: 70, bloqueado: false, motivo: null, explica: "Un tick sobre la cima de venta, sin pasar tu techo: el primero de la fila." },
      { nombre: "Equilibrado", tasa: 320, g: 40.63, zona: "automatica", delanteUsd: 70, bloqueado: false, motivo: null, explica: "Iguala la cima de venta de ahora: equilibrio entre rapidez y ganancia." },
      { nombre: "Paciente", tasa: 350, g: -48.57, zona: "negativa", delanteUsd: 120, bloqueado: true, motivo: "A esa tasa pierdes 48,57 CUP por recarga de 360: no se ofrece.", explica: "Al nivel de 20 USD del libro de compra: la mayor ganancia, la mayor espera." },
    ] },
    ejecutable: { usd20: { tasa: 305.08, usd: 20, usdDisponible: 180.15 }, parcial20: null, usdAccion: { tasa: 304.08, usd: 40, usdDisponible: 180.15 }, montoAccion: 40 },
    transferencia: { bEj: 1064.27, esPromedio: false, dMin: 0.1309, primaMin: 0.1506, bMax20: 1156.25, gananciaQusd20: 73.58 },
    duras: [{ lado: "compra", uuid: "d1", tasa: 300, usd: 50, g360: 110, marca: "🟢 4,8★ · 132 ops", marcaNivel: "verde" }],
    durasDescartadas: [],
    senal: { palabra: "VENDER", numeros: { tasa: 305.08, ganancia360: 91.59, equilibrio: 333 }, motivo: "La ganancia ejecutable a 20 USD llega a la zona buena (+25)." },
    textoAntiHumo: A.TEXTO_ANTI_HUMO,
    promoActiva: null,
    generadoEn: isoMin(2),
  }, extra || {});
}
function fotoAnalista(extraFoto, extraAnalisis, extraUltima) {
  const f = fotoBase(Object.assign({ detalle: { analisis: analisisFixture(extraAnalisis) } }, extraFoto || {}));
  return ultimaBase(f, Object.assign({ acciones: { detenidas: false, pausadas: false, pausa_motivo: null, monto_qusd: 40 } }, extraUltima || {}));
}
// S6: señal VENDER + menú con peldaño bloqueado + duras + transferencia + anti-humo
{
  const fx = { ultima: fotoAnalista(), historial: histBase, promos: promosBase, avisos: avisosBase };
  const dom = await crearDom(fx);
  const an = txt(dom, "ctAnalista");
  ok(an.includes("VENDER"), "S6 Analista: la señal VENDER se pinta");
  ok(an.includes("BOTÓN BLINDADO"), "S6 Analista: el control de acciones es de primera clase");
  ok(an.includes("BLOQUEADO") && an.includes("pierdes 48,57"), "S6 Analista: el peldaño con pérdida va bloqueado con su porqué");
  ok(an.includes("COMPRA DURA") && an.includes("+110,00"), "S6 Analista: la dura vigente con su ganancia");
  ok(an.includes("1064,27") && an.includes("1156,25"), "S6 Analista: transferencia con B_ej y B_max");
  ok(an.includes("al 15,1"), "S6 Analista: la prima callejera acompaña al descuento");
  ok(an.includes("Esto no predice el mercado"), "S6 Analista: el texto anti-humo está en su sitio");
  ok(an.includes("dato de origen"), "A7 Analista: los dos relojes viajan y se pintan (origen y recepción)");
  ok(txt(dom, "ctAhora").includes("SEÑAL DEL ANALISTA"), "S6 Ahora: la línea de la señal resume y enlaza");
  dom.window.close();
}
// S7: DETENER activado -> estado diseñado con su Reanudar
{
  const fx = { ultima: fotoAnalista(null, null, { acciones: { detenidas: true, pausadas: false, pausa_motivo: null, monto_qusd: 40 } }),
    historial: histBase, promos: promosBase, avisos: avisosBase };
  const dom = await crearDom(fx);
  const an = txt(dom, "ctAnalista");
  ok(an.includes("ACCIONES DETENIDAS") && an.includes("Reanudar acciones"), "S7 Analista: DETENER activado se ve y se puede reanudar");
  dom.window.close();
}
// S8: foto vieja -> la señal va marcada como vieja
{
  const fx = { ultima: fotoAnalista({ recibida_en: isoMin(180), origen_en: isoMin(185), fresca: false }),
    historial: histBase, promos: promosBase, avisos: avisosBase };
  const dom = await crearDom(fx);
  const an = txt(dom, "ctAnalista");
  ok(an.includes("Foto vieja"), "S8 Analista: la foto vieja se anuncia antes que la señal");
  ok(an.includes("DATO VIEJO"), "S8 Analista: el sello de la señal es DATO VIEJO");
  dom.window.close();
}
// S9: foto sin análisis (lector viejo) -> estreno honesto, sin inventar
{
  const fx = { ultima: ultimaBase(fotoBase()), historial: histBase, promos: promosBase, avisos: avisosBase };
  const dom = await crearDom(fx);
  ok(txt(dom, "ctAnalista").includes("se estrena con la próxima foto"), "S9 Analista: sin análisis se dice, no se inventa");
  dom.window.close();
}

console.log(`\nMERCADO v2: ${pass} PASS · ${fail} FAIL`);
if (fails.length) { console.log("Fallos:", fails.join(" | ")); process.exit(1); }

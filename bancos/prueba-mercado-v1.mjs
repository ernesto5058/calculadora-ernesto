// Copia para CI (GitHub Actions) del banco vivo en research_notes — mismos chequeos,
// solo cambian las rutas: jsdom por nombre y la raíz del repo se resuelve desde este archivo
// (o la variable BANCO_REPO). Si el banco vivo cambia, se refresca esta copia.
// Banco de «Mercado» v1 (2026-11-11):
//  A) la matemática pura del lector (logica.js: LA MISMA que importa la
//     Edge Function en Deno) — bordes de la regla de demanda, dos
//     confirmaciones, foto vieja no concluye, equilibrio con unidades.
//  B) el render de la app ensamblada (jsdom) con las puertas RPC
//     simuladas: frescura visible, respaldo honesto, equilibrio desde
//     la tarifa del fixture, estados de las seis pantallas.
import { JSDOM } from "jsdom";
import fs from "fs";
import * as L from "./fixtures/mercado-logica.js";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");

let pass = 0, fail = 0; const fails = [];
function ok(c, n) { if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }
function eqNum(a, b, n) { ok(typeof a === "number" && Math.abs(a - b) < 1e-9, n + " (dio " + a + ")"); }

/* ================= A) LÓGICA PURA ================= */
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
const compras = [
  { ratio: "310.5", amount: "5" },                    // top real (poco monto)
  { ratio: "299.9", amount: "25" },                   // nivel20
  { ratio: "305", available_amount: "19.9" },         // flexible con <20 USD: no cuenta
  { ratio: "2500", amount: "100" },                   // trampa: fuera
  { ratio: "320", amount: "50", mine: true },         // propia: fuera
  { ratio: "295", amount: "100" },
];
eqNum(L.topCompra(compras), 310.5, "top compra = 310.5 (ignora trampa y propias)");
eqNum(L.nivel20(compras), 299.9, "nivel20 = 299.9 (exige >= 20 USD detrás)");
ok(L.nivel20(compras) !== L.topCompra(compras), "nivel20 NO es el top: son niveles distintos");
eqNum(L.topVenta([{ ratio: "315", amount: "10" }, { ratio: "312.4", amount: "3" }]), 312.4, "top venta = la menor tasa");
ok(L.nivel20([]) === null && L.topCompra([]) === null, "libro vacío -> niveles null");

// Tasa sugerida: nunca por encima del equilibrio
eqNum(L.tasaSugerida(299.9, 342), 299.9, "sugerida: manda el libro si está bajo el equilibrio");
eqNum(L.tasaSugerida(350, 342), 342, "sugerida: el equilibrio capa al libro");
eqNum(L.tasaSugerida(299.9, null), 299.9, "sugerida sin equilibrio: el libro");
ok(L.tasaSugerida(null, 342) === null, "sugerida sin libro: null");

/* ================= B) RENDER (jsdom) ================= */
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
  const ahora = txt(dom, "ctAhora");
  ok(ahora.includes("299,90"), "S1 Ahora: héroe = nivel20 299,90 saldo por QUSD");
  ok(ahora.includes("FRESCA"), "S1 Ahora: sello FRESCA visible");
  ok(ahora.includes("310,50"), "S1 Ahora: top compra 310,50");
  ok(ahora.includes("1064,10"), "S1 Ahora: BANK_CUP 1064,10 CUP por QUSD");
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
  const ahora = txt(dom, "ctAhora");
  ok(ahora.includes("RESPALDO"), "S4 Ahora: sello RESPALDO visible");
  ok(ahora.includes("303,37"), "S4 Ahora: el héroe cae al promedio (no inventa nivel20)");
  ok(txt(dom, "ctEquilibrio").includes("Falta tu costo del día"), "S4 Equilibrio: sin costo se dice, no se inventa");
  ok(!ahora.includes("0,00"), "S4 Ahora: ningún nivel ausente se pinta como 0,00");
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

console.log(`\nMERCADO v1: ${pass} PASS · ${fail} FAIL`);
if (fails.length) { console.log("Fallos:", fails.join(" | ")); process.exit(1); }

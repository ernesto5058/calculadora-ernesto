// =====================================================================
// Banco INV — INVARIANTES DE DINERO (INV-1…INV-9 del estudio de método,
// ~/workspace/research_notes/analisis-logica-problemas-estudio-2026-11-11/report.md §2.5
// y DESARROLLO-PRO §11.3). No son ejemplos: son PROPIEDADES barridas
// (barrido determinista, semilla fija, sin librerías nuevas) contra las
// implementaciones REALES de las fórmulas:
//   · Mi Negocio (build publicado minegocio/index.html): sugerencia(),
//     contaGananciaBruta/Neta/Capital(), contaRepsBase(), derivadaCalc()
//   · Mi Trabajo (buscadores-app/app.js): comisionSaldo()/comisionTransf()
//   · Bot PRO (supabase/functions/_shared/telegram-pro.ts): brutaDe(),
//     netaDe(), capitalDe() — importadas tal cual
//   · Bot PRO webhook (telegram-webhook/index.ts): repsBase()/sinPagarDe()
//   · Servidor (admin_generar_cierre; el fixture refleja la definición
//     VIVA tras la tanda H-1/H-2/H-3: cierre-h1-h2-h3-sql-2026-11-11.sql):
//     espejo JS fiel de sus expresiones + ANCLAS TEXTUALES sobre el SQL
//     para que el espejo no pueda derivar en silencio del original.
//   · Lector de Mercado (logica.js): equilibrio()
//
// ADJUDICACIONES (DESARROLLO-PRO §11.3 — se escriben ANTES de correr):
//   A1. La forma REAL de un reporte de transferencia, la que se
//       ALMACENA (buscadores-app al crear + registrar_reporte SQL), es
//       { precio: null, cantidad: <efectivo>, porc: <%> }. El cierre del
//       servidor lee el efectivo de `cantidad`, en esa misma forma.
//   A2. INV-3 «bono no suma»: el bono del esquema v2 es por CONTEO
//       semanal verificado (150 recargas / 10 tratos), no por ganancia
//       del trato; la parte de ganancia de INV-3 se aserta como
//       «ganancia ≤ 0 ⇒ comisión = 0» en TODAS las implementaciones, y
//       el bono se barre en INV-6 con sus bordes exactos.
//   A3. INV-6 «tope de línea 500 000» y «3 envíos/día» son reglas de la
//       RED ETECSA sobre la línea de Ernesto; no viven en ninguna
//       fórmula de comisiones de este sistema → sin aserción posible
//       en este banco (queda registrado, no disimulado).
//   A4. INV-5 «subir el costo»: en el marco de comisiones el costo de
//       Ernesto ES el precio pagado al vendedor; se barre como precio.
//       La tasa se barre con derivadaCalc() real; la fórmula en línea
//       de la Calculadora queda vigilada por anclas textuales (INV-4).
//
// POLÍTICA DE HALLAZGOS (regla dura del encargo): si una propiedad
// FALLA contra la fórmula viva, NO se toca la fórmula ni se relaja la
// propiedad: el contraejemplo queda fijado como ejemplo permanente
// (aserción «H-x fijado» que salta si el comportamiento cambia, para
// bien o para mal) y el hallazgo se reporta a Ernesto. Las aserciones
// de hallazgo NO cuentan como FAIL del banco (el banco vigila; el
// registro CHEQUEOS-ETERNOS.md lleva el estado de cada hallazgo).
//
// ACTUALIZACIÓN 2026-11-11 (tanda aprobada por Ernesto): H-1, H-2 y
// H-3 fueron CORREGIDOS — lectura normalizada del efectivo en panel y
// bot vía efectivoDe(); el cierre excluye pruebas, ya no clampea las
// pérdidas y filtra por creado_en (referenciaba r.creado, columna
// inexistente: la función nunca había podido correr). Sus propiedades
// pasaron de «hallazgo vigilado» a aserciones BLOQUEANTES (ok) con los
// mismos contraejemplos. Quedan como observaciones fijadas H-4 e
// INV-8b.
//
//   node research_notes/test-invariantes-dinero.mjs
// =====================================================================
import { JSDOM } from "jsdom";
import fs from "fs";
import { pathToFileURL, fileURLToPath } from "url";

const HOME = process.env.HOME;
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");

let pass = 0, fail = 0;
const fails = [], hallazgos = [];
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; fails.push(name); console.log("FAIL: " + name); }
}
/* Propiedad que hoy FALLA contra la fórmula viva: se reporta como
   hallazgo con su contraejemplo, sin maquillar ni bloquear. */
function propH(hid, cond, name, contraejemplo) {
  if (cond) { pass++; console.log("ok (propiedad " + hid + "): " + name); }
  else {
    hallazgos.push({ hid, name, contraejemplo });
    console.log("HALLAZGO " + hid + ": " + name + "\n   contraejemplo: " + contraejemplo);
  }
}
const cerca = (a, b, tol) => Math.abs(Number(a) - Number(b)) <= (tol === undefined ? 1e-6 : tol);

/* Barrido determinista (LCG, semilla fija — §11.3) */
let semilla = 20261111;
function rnd() { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; }
function barre(lista, extra) { return lista.concat(extra || []); }

/* ---------- extracción de funciones reales por nombre ---------- */
function extraer(src, nombre) {
  const i = src.indexOf("function " + nombre + "(");
  if (i < 0) throw new Error("no se encontró function " + nombre);
  let j = src.indexOf("{", i), prof = 0, k = j;
  for (; k < src.length; k++) {
    if (src[k] === "{") prof++;
    else if (src[k] === "}") { prof--; if (prof === 0) break; }
  }
  return src.slice(i, k + 1);
}
function sandbox(codigo, globales) {
  const nombres = Object.keys(globales);
  const f = new Function(...nombres, codigo + "\nreturn { " +
    [...codigo.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1] + ": " + m[1]).join(", ") + " };");
  return f(...nombres.map(n => globales[n]));
}

/* ---------- fuentes reales ---------- */
const htmlMN = fs.readFileSync(REPO + "minegocio/index.html", "utf8");
const srcBusc = fs.readFileSync(REPO + "buscadores-app/app.js", "utf8");
const srcWebhook = fs.readFileSync(REPO + "supabase/functions/telegram-webhook/index.ts", "utf8");
function leerPrimero(candidatos) {
  for (const c of candidatos) { try { return fs.readFileSync(c, "utf8"); } catch (e) { /* siguiente */ } }
  throw new Error("ninguna fuente encontrada: " + candidatos.join(" · "));
}
const sqlTodo = leerPrimero([
  REPO + "bancos/fixtures/cierre-semana.sql",
  HOME + "/workspace/research_notes/activacion-completa-v13.sql",
]);
const iCierre = sqlTodo.indexOf("create or replace function public.admin_generar_cierre");
const sqlCierre = sqlTodo.slice(iCierre >= 0 ? iCierre : 0, (iCierre >= 0 ? iCierre : 0) + 12000);
const logicaTxt = leerPrimero([
  REPO + "bancos/fixtures/mercado-logica.js",
  HOME + "/workspace/mercado-src/supabase/functions/mercado-lector/logica.js",
]);
const logicaPath = fs.existsSync(REPO + "bancos/fixtures/mercado-logica.js")
  ? REPO + "bancos/fixtures/mercado-logica.js"
  : HOME + "/workspace/mercado-src/supabase/functions/mercado-lector/logica.js";
const L = await import(pathToFileURL(logicaPath).href);
const pro = await import(pathToFileURL(REPO + "supabase/functions/_shared/telegram-pro.ts").href);

/* ---------- Mi Negocio: fórmulas reales en sandbox ---------- */
const MN_NOMBRES = ["numPos", "r2", "tarifaBase", "derivadaCalc", "tarifa", "efectivoDe", "sugerencia",
  "contaGananciaBruta", "contaNeta", "contaCapital", "contaRepsBase"];
const codigoMN = MN_NOMBRES.map(n => extraer(htmlMN, n)).join("\n");
const stateMN = {
  tarifaViva: null, tarifaVivaEn: "",
  foto: { tarifaPanel: null, datos: null, reportes: [], ayudas: [], usuarios: [], borrados: [], publicar: [] },
  calc: { busc: {}, transf: {}, saldo: {} }, codigo: "CODIGO-PRUEBA", cola: [], sellos: {},
};
const MN = sandbox(codigoMN, {
  state: stateMN, datosLive: null,
  TARIFA_DEF: { ingresoRef360: 0, libroRef: 0, salidaRef: 0, pctSaldo: 25, pctTransf: 20, pisoTransf: 25 },
});
function ponerTarifaMN(t) {
  stateMN.tarifaViva = { ingresoRef360: t.ingresoRef360, libroRef: t.libroRef, salidaRef: t.salidaRef,
    pctSaldo: t.pctSaldo, pctTransf: t.pctTransf, pisoTransf: t.pisoTransf };
  stateMN.foto.datos = null; stateMN.calc = { busc: {}, transf: {}, saldo: {} };
}

/* ---------- Mi Trabajo: fórmulas reales en sandbox ---------- */
const codigoB = ["comisionSaldo", "comisionTransf"].map(n => extraer(srcBusc, n)).join("\n");
const TB = { ingresoRef360: 0, libroRef: 0, salidaRef: 0, pctSaldo: 25, pctTransf: 20, pisoTransf: 25,
  bonoSaldoMeta: 150, bonoSaldoMonto: 300, bonoTransfMeta: 10, bonoTransfMonto: 300 };
const BUSC = sandbox(codigoB, { T: TB });
function ponerTarifaB(t) { Object.assign(TB, t); }

/* ---------- Bot webhook: filtros reales ---------- */
/* Las dos funciones son TS: se pela SOLO la anotación de tipos de la
   firma para poder evaluarlas; el cuerpo queda byte a byte el real. */
const sinTipos = s => s.replace("(d: Datos): ReporteFila[]", "(d)");
const WH = sandbox(
  sinTipos(extraer(srcWebhook, "repsBase")) + "\n" + sinTipos(extraer(srcWebhook, "sinPagarDe")), {});

/* ---------- Servidor: espejo fiel de admin_generar_cierre ---------- */
const norm = s => s.replace(/\s+/g, " ");
const sqlN = norm(sqlCierre);
function espejoSaldoNeto(r, t, comision) {  // (ingreso-precio)*cant - comision (sin clamp desde el arreglo H-3)
  return (t.ingresoRef360 - Number(r.precio)) * (r.cantidad == null ? 1 : Number(r.cantidad)) - (Number(comision) || 0);
}
function espejoTransfBruta(r, t) {           // (cant*(1+porc/100)/libro)*salida - cant (sin clamp desde el arreglo H-3)
  const ef = Number(r.cantidad);
  return (ef * (1 + (Number(r.porc) || 0) / 100) / t.libroRef) * t.salidaRef - ef;
}
function espejoTransfNeta(r, t, comision) { return espejoTransfBruta(r, t) - (Number(comision) || 0); }
function espejoBono(recargasSaldo, nTransf) { // filas del cierre: >=150 → 300 · >=10 → 300
  return (recargasSaldo >= 150 ? 300 : 0) + (nTransf >= 10 ? 300 : 0);
}

/* ---------- tarifas y rejillas del barrido ---------- */
const TARIFAS = [
  { nombre: "viva",    ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950,  pctSaldo: 25, pctTransf: 20, pisoTransf: 25 },
  { nombre: "estudio", ingresoRef360: 1092.65, libroRef: 1110,    salidaRef: 950,  pctSaldo: 25, pctTransf: 20, pisoTransf: 25 },
  { nombre: "libro-alto", ingresoRef360: 900,  libroRef: 1400,    salidaRef: 900,  pctSaldo: 25, pctTransf: 20, pisoTransf: 25 },
  { nombre: "apretada", ingresoRef360: 1000.01, libroRef: 1000,   salidaRef: 1000, pctSaldo: 25, pctTransf: 20, pisoTransf: 25 },
];
const aBot = t => ({ ingreso_ref360: t.ingresoRef360, libro_ref: t.libroRef, salida_ref: t.salidaRef,
  comision_saldo: t.pctSaldo, comision_transf: t.pctTransf, piso_transf: t.pisoTransf });
const PRECIOS = [0.01, 1, 500, 900, 950, 1000, 1050, 1098.68, 1100, 1500, 3000];
const CANTIDADES = [1, 2, 3, 10, 37, 100];
const EFECTIVOS = [0.01, 100, 1000, 5000, 20000, 100000];
const PORCS = [0, 5, 16.84, 20, 25, 30, 40, 75];

/* =====================================================================
   ANCLAS del espejo del servidor: si el SQL aplicado cambia, el espejo
   deja de ser fiel y estas aserciones (normales, bloqueantes) saltan.
   ===================================================================== */
ok(sqlN.includes("(t.ingreso_ref360 - r.precio) * coalesce(r.cantidad, 1) - coalesce(r.comision, 0)"),
  "ANCLA-SQL-1 el espejo de saldo refleja la expresión viva del cierre (sin clamp, arreglo H-3)");
ok(sqlN.includes("(r.cantidad * (1 + coalesce(r.porc, 0) / 100.0) / nullif(t.libro_ref, 0)) * t.salida_ref - r.cantidad"),
  "ANCLA-SQL-2 el espejo de transferencia refleja la expresión viva del cierre (efectivo en r.cantidad, sin clamp)");
const iGan = sqlN.indexOf("'tu_ganancia'");
ok(iGan >= 0 && !sqlN.slice(iGan, iGan + 700).includes("greatest"),
  "ANCLA-SQL-4 la expresión de tu_ganancia del cierre ya no clampea ningún trato (H-3 corregido)");
ok(sqlN.includes("r.creado_en::date between"),
  "ANCLA-SQL-5 el cierre filtra por r.creado_en, la columna real (con r.creado la función no podía correr)");
ok((sqlN.match(/>= 150/g) || []).length >= 2 && (sqlN.match(/>= 10\)/g) || []).length >= 1 && sqlN.includes("then 300 else 0 end"),
  "ANCLA-SQL-3 el cierre lleva los umbrales del bono (150 recargas · 10 tratos · 300 CUP)");
ok(srcBusc.includes("bonoSaldoMeta: 150") && srcBusc.includes("bonoTransfMeta: 10") &&
   srcBusc.includes("bonoSaldoMonto: 300") && srcBusc.includes("bonoTransfMonto: 300"),
  "ANCLA-BONO-APP los umbrales del bono en Mi Trabajo coinciden con el cierre (150/10 · 300/300)");

/* =====================================================================
   INV-1 · CONSERVACIÓN (saldo): capital + bruta = ingreso del trato;
   ganancia de Ernesto = bruta − comisión (− bono, a nivel semana).
   INV-2 · COMISIÓN ACOTADA: 0 ≤ comisión ≤ bruta en toda combinación.
   INV-3 · SIN GANANCIA NO HAY COMISIÓN: bruta ≤ 0 ⇒ comisión = 0.
   ===================================================================== */
let nSaldo = 0, acuerdoSaldo = true, inv2Saldo = true, inv3Saldo = true, inv1Saldo = true;
let ejAcuerdo = "", ejInv2 = "", ejInv3 = "";
for (const t of TARIFAS) {
  ponerTarifaMN(t); ponerTarifaB(t);
  const tB = aBot(t);
  for (const precio of PRECIOS) for (const cantidad of CANTIDADES) {
    nSaldo++;
    const r = { tipo: "saldo", precio, cantidad };
    const brutaEsp = (t.ingresoRef360 - precio) * cantidad;
    const brutaConta = MN.contaGananciaBruta(r, MN.tarifa());
    const brutaBot = pro.brutaDe(r, tB);
    if (!cerca(brutaConta, brutaEsp) || !cerca(brutaBot, brutaEsp)) {
      acuerdoSaldo = false; ejAcuerdo = ejAcuerdo || `tarifa ${t.nombre}, precio ${precio}, cant ${cantidad}: conta=${brutaConta} bot=${brutaBot} esperado=${brutaEsp}`;
    }
    const cap = MN.contaCapital(r), capBot = pro.capitalDe(r);
    if (!cerca(cap + brutaConta, t.ingresoRef360 * cantidad) || !cerca(capBot + brutaBot, t.ingresoRef360 * cantidad)) {
      inv1Saldo = false;
    }
    const sug = MN.sugerencia(r).com;
    const feeB = BUSC.comisionSaldo(precio, cantidad).fee;
    const neta = MN.contaNeta({ ...r, comision: sug }, MN.tarifa());
    if (!cerca(neta, brutaConta - sug)) inv1Saldo = false;
    if (brutaEsp > 0) {
      if (!(sug >= 0 && sug <= brutaEsp + 1e-9 && feeB >= 0 && feeB <= brutaEsp + 1e-9)) {
        inv2Saldo = false; ejInv2 = ejInv2 || `precio ${precio} cant ${cantidad} tarifa ${t.nombre}: bruta=${brutaEsp} sug=${sug} feeBusc=${feeB}`;
      }
      if (!cerca(feeB, brutaEsp * t.pctSaldo / 100, 1e-6) || !cerca(sug, brutaEsp * t.pctSaldo / 100, 0.01)) inv2Saldo = false;
    } else {
      if (sug !== 0 || feeB !== 0) { inv3Saldo = false; ejInv3 = ejInv3 || `precio ${precio} cant ${cantidad} tarifa ${t.nombre}: bruta=${brutaEsp} sug=${sug} feeBusc=${feeB}`; }
    }
  }
}
ok(acuerdoSaldo, `INV-1/ACUERDO saldo: contaGananciaBruta y brutaDe coinciden con (ingreso−precio)×cantidad en ${nSaldo} combinaciones` + (ejAcuerdo ? " — " + ejAcuerdo : ""));
ok(inv1Saldo, "INV-1 saldo: capital + bruta = ingreso×cantidad y neta = bruta − comisión (Mi Negocio y bot)");
ok(inv2Saldo, "INV-2 saldo: 0 ≤ comisión ≤ bruta y comisión = % del esquema (sugerencia redondea a centavos, ±0.01)" + (ejInv2 ? " — " + ejInv2 : ""));
ok(inv3Saldo, "INV-3 saldo: excedente ≤ 0 ⇒ comisión 0 en sugerencia() y en comisionSaldo()" + (ejInv3 ? " — " + ejInv3 : ""));

/* INV-1 a nivel semana (identidad con bono, espejo del cierre):
   neto semana = Σ bruta − Σ comisión − Σ bonos */
{
  const t = TARIFAS[0];
  const tratos = [
    { tipo: "saldo", precio: 1000, cantidad: 100, comision: 2467 },
    { tipo: "saldo", precio: 900, cantidad: 60, comision: 2981.60 },
    { tipo: "transferencia", precio: null, cantidad: 5000, porc: 30, comision: 154.87 },
    { tipo: "transferencia", precio: null, cantidad: 20000, porc: 25, comision: 500 },
  ];
  const brutaSem = tratos.reduce((s, r) => s + (r.tipo === "saldo"
    ? Math.max(t.ingresoRef360 - r.precio, 0) * r.cantidad : espejoTransfBruta(r, t)), 0);
  const comSem = tratos.reduce((s, r) => s + r.comision, 0);
  const recSem = tratos.filter(r => r.tipo === "saldo").reduce((s, r) => s + r.cantidad, 0);
  const nTrSem = tratos.filter(r => r.tipo === "transferencia").length;
  const netoSem = brutaSem - comSem - espejoBono(recSem, nTrSem);
  const netoTratos = tratos.reduce((s, r) => s + (r.tipo === "saldo"
    ? espejoSaldoNeto(r, t, r.comision) : espejoTransfNeta(r, t, r.comision)), 0);
  ok(cerca(netoSem, netoTratos - espejoBono(recSem, nTrSem)) && espejoBono(recSem, nTrSem) === 300,
    "INV-1 semana: Σneta(por trato) − bonos = Σbruta − Σcomisión − Σbonos (el bono entra una sola vez, 160 recargas → +300)");
}

/* =====================================================================
   TRANSFERENCIA — las dos formas del reporte:
   · FORMA REAL (A1): { precio: null, cantidad: efectivo, porc }
   · FORMA CAMP-A:    { precio: efectivo, cantidad: null, porc }
     (la que suponen sugerencia/conta/brutaDe y los fixtures viejos)
   ===================================================================== */
let acuerdoReal = true, acuerdoCampA = true, inv2Tr = true, inv3Tr = true;
let ejReal = "", ejRealCom = "", ejRealCap = "", peorReal = 0, peorCom = 0, peorCap = 0;
for (const t of TARIFAS) {
  ponerTarifaMN(t); ponerTarifaB(t);
  const tB = aBot(t);
  for (const ef of EFECTIVOS) for (const porc of PORCS) {
    const brutaSin = (ef * (1 + porc / 100) / t.libroRef) * t.salidaRef - ef;
    const rReal = { tipo: "transferencia", precio: null, cantidad: ef, porc };
    const rA = { tipo: "transferencia", precio: ef, cantidad: null, porc };
    /* Forma real contra el servidor (espejo) y contra las apps:
       se guarda el contraejemplo de MAYOR divergencia (sobre 1 centavo) */
    const difBruta = Math.max(Math.abs(MN.contaGananciaBruta(rReal, MN.tarifa()) - brutaSin),
                              Math.abs(pro.brutaDe(rReal, tB) - brutaSin));
    if (difBruta > 0.01 && difBruta > peorReal) {
      acuerdoReal = false; peorReal = difBruta;
      ejReal = `efectivo ${ef} al ${porc}% con tarifa ${t.nombre}: el servidor calcula bruta=${brutaSin.toFixed(2)} y las apps (conta/brutaDe) calculan ${MN.contaGananciaBruta(rReal, MN.tarifa()).toFixed(2)} (leen el efectivo de «precio», que en la forma real almacenada es null)`;
    }
    const comEsp = Math.max(brutaSin, 0) * t.pctTransf / 100;
    const difCom = Math.abs(MN.sugerencia(rReal).com - comEsp);
    if (difCom > 0.01 && difCom > peorCom) {
      peorCom = difCom;
      ejRealCom = `efectivo ${ef} al ${porc}% tarifa ${t.nombre}: comisión que pide el esquema=${comEsp.toFixed(2)} · sugerencia() da ${MN.sugerencia(rReal).com} con el aviso «La vuelta no deja ganancia»`;
    }
    const difCap = Math.abs(MN.contaCapital(rReal) - ef);
    if (difCap > 0.01 && difCap > peorCap) {
      peorCap = difCap;
      ejRealCap = `efectivo ${ef}: capital real=${ef} · contaCapital/capitalDe dan ${MN.contaCapital(rReal)}`;
    }
    /* Forma camp-A: consistencia interna de las apps entre sí */
    if (!cerca(MN.contaGananciaBruta(rA, MN.tarifa()), brutaSin) || !cerca(pro.brutaDe(rA, tB), brutaSin)) acuerdoCampA = false;
    const sugA = MN.sugerencia(rA).com;
    const feeTr = BUSC.comisionTransf(ef, porc);
    if (brutaSin > 0) {
      if (!(sugA >= 0 && sugA <= brutaSin + 1e-9 && feeTr.fee >= 0 && feeTr.fee <= brutaSin + 1e-9)) inv2Tr = false;
      if (!cerca(feeTr.fee, brutaSin * t.pctTransf / 100, 1e-6) || !cerca(sugA, brutaSin * t.pctTransf / 100, 0.01)) inv2Tr = false;
    } else if (sugA !== 0 || feeTr.fee !== 0 || feeTr.ganancia > 0) {
      if (sugA !== 0 || feeTr.fee !== 0) { inv3Tr = false; }
    }
    if (!cerca(feeTr.ganancia, brutaSin)) inv2Tr = false;
  }
}
ok(acuerdoReal,
  "INV-1/ACUERDO transferencia (forma real almacenada): contaGananciaBruta y brutaDe reproducen la ganancia del servidor (H-1 corregido)" + (ejReal ? " — " + ejReal : ""));
ok(ejRealCom === "",
  "INV-2 transferencia (forma real): la comisión sugerida al aprobar = 20% de la ganancia de la vuelta (H-1 corregido)" + (ejRealCom ? " — " + ejRealCom : ""));
ok(ejRealCap === "",
  "INV-1 transferencia (forma real): el capital del trato = el efectivo entregado (H-1 corregido)" + (ejRealCap ? " — " + ejRealCap : ""));
ok(acuerdoCampA, "INV-1/ACUERDO transferencia (forma camp-A, precio=efectivo): las apps sí coinciden con la fórmula entre sí");
ok(inv2Tr, "INV-2 transferencia: 0 ≤ comisión ≤ ganancia y comisión = % del esquema (apps, forma camp-A)");
ok(inv3Tr, "INV-3 transferencia: vuelta sin ganancia ⇒ comisión 0 (sugerencia y comisionTransf)");

/* Contraejemplos de H-1 convertidos en aserciones PERMANENTES
   (tanda 2026-11-11): la forma REAL almacenada da los números del
   servidor en panel y bot. */
{
  const t = TARIFAS[0]; ponerTarifaMN(t); ponerTarifaB(t);
  const rReal = { tipo: "transferencia", precio: null, cantidad: 5000, porc: 30 };
  ok(cerca(MN.contaGananciaBruta(rReal, MN.tarifa()), 774.37, 0.01) && cerca(pro.brutaDe(rReal, aBot(t)), 774.37, 0.01),
    "H-1 PERMANENTE: vuelta real de 5 000 al 30% (efectivo en cantidad, precio null) → bruta 774.37 en Contabilidad y en el bot, como el servidor");
  ok(cerca(MN.sugerencia(rReal).com, 154.87, 0.02) && MN.contaCapital(rReal) === 5000 && pro.capitalDe(rReal) === 5000,
    "H-1 PERMANENTE: la misma vuelta → comisión sugerida 154.87 (esquema 20%, ±0.02 por redondeo) y capital 5 000 en panel y bot");
  const tA = TARIFAS[3]; ponerTarifaMN(tA); ponerTarifaB(tA);
  const r75 = { tipo: "transferencia", precio: null, cantidad: 100000, porc: 75 };
  ok(cerca(MN.contaGananciaBruta(r75, MN.tarifa()), 75000, 0.01) && cerca(pro.brutaDe(r75, aBot(tA)), 75000, 0.01) && cerca(MN.sugerencia(r75).com, 15000, 0.01),
    "H-1 PERMANENTE: vuelta real de 100 000 al 75% con salida = libro → bruta 75 000 y comisión 15 000 en panel y bot");
}

/* INV-1 · la neta de un trato con pérdida: Contabilidad la resta y,
   desde el arreglo H-3, el cierre del servidor también (sin clamp). */
{
  const t = TARIFAS[0];
  const rPerdida = { tipo: "saldo", precio: 1500, cantidad: 1, comision: 0 };
  const netaApp = MN.contaNeta(rPerdida, t);
  const netaSrv = espejoSaldoNeto(rPerdida, t, 0);
  ok(cerca(netaApp, netaSrv) && cerca(netaSrv, -401.32, 0.01),
    "INV-1: la neta de un trato con pérdida coincide entre Contabilidad y el cierre del servidor (H-3 corregido: ambos restan la pérdida, −401.32)");
  ok(cerca(netaApp, (t.ingresoRef360 - 1500) * 1), "INV-1 fijado: la Contabilidad SÍ deja la neta negativa en un trato con pérdida (comportamiento económico correcto)");
}

/* =====================================================================
   INV-4 · IDENTIDAD DEL EQUILIBRIO: con tasa = 360×salida÷costo la
   ganancia por 360 es 0 (tolerancia 1 centavo); con precio = ingreso
   de referencia, el excedente es 0.
   ===================================================================== */
{
  let okEq = true, ejEq = "";
  for (const t of TARIFAS) {
    ponerTarifaMN(t); ponerTarifaB(t);
    const r0 = { tipo: "saldo", precio: t.ingresoRef360, cantidad: 7 };
    if (!cerca(MN.contaGananciaBruta(r0, MN.tarifa()), 0, 1e-9) ||
        !cerca(pro.brutaDe(r0, aBot(t)), 0, 1e-9) ||
        MN.sugerencia(r0).com !== 0 || BUSC.comisionSaldo(t.ingresoRef360, 7).fee !== 0) {
      okEq = false; ejEq = "precio = ingresoRef no anula bruta/comisión en tarifa " + t.nombre;
    }
  }
  ok(okEq, "INV-4a: precio = ingreso de referencia ⇒ excedente 0 y comisión 0 en las tres implementaciones" + (ejEq ? " — " + ejEq : ""));
  let okTasa = true;
  for (const salida of [900, 925, 950, 970, 1000]) for (const costo of [900, 1000, 1040, 1114.29, 1200]) {
    const tasaEq = 360 * salida / costo;
    stateMN.tarifaViva = null; stateMN.foto.datos = null;
    stateMN.calc = { busc: { salida, libro: 1069.38, tasaVenta: tasaEq }, transf: {}, saldo: {} };
    const d = MN.derivadaCalc();
    if (!d || !cerca(d.ingresoRef360, costo, 0.01)) okTasa = false;
    if (!cerca(L.equilibrio(salida, costo), tasaEq, 0.01)) okTasa = false; // equilibrio() redondea la tasa a centavos por definición
  }
  ok(okTasa, "INV-4b: a la tasa de equilibrio el ingreso por 360 = el costo (±0.01 por el redondeo a centavos de derivadaCalc) y equilibrio() del lector coincide con 360×salida÷costo");
  ok(htmlMN.includes("360 * Number(s.salida) / Number(s.costo)") &&
     htmlMN.includes("(360 / Number(s.tasa)) * Number(s.salida) - Number(s.costo)"),
    "INV-4c ANCLA: la Calculadora publicada conserva sus expresiones de equilibrio y ganancia por 360");
}

/* =====================================================================
   INV-5 · MONOTONÍA: subir la tasa nunca sube el ingreso; subir el
   precio pagado (el costo) nunca sube el excedente.
   ===================================================================== */
{
  let monoTasa = true, monoPrecio = true, monoPorc = true;
  stateMN.tarifaViva = null; stateMN.foto.datos = null;
  let ant = Infinity;
  for (const tasa of [200, 250, 280, 300, 313, 340, 400, 500]) {
    stateMN.calc = { busc: { salida: 950, libro: 1069.38, tasaVenta: tasa }, transf: {}, saldo: {} };
    const ing = MN.derivadaCalc().ingresoRef360;
    if (ing > ant + 1e-9) monoTasa = false;
    ant = ing;
  }
  const t = TARIFAS[0]; ponerTarifaMN(t);
  ant = Infinity;
  for (const precio of [100, 500, 900, 1000, 1050, 1098.68, 1200, 2000]) {
    const b = MN.contaGananciaBruta({ tipo: "saldo", precio, cantidad: 5 }, MN.tarifa());
    if (b > ant + 1e-9) monoPrecio = false;
    ant = b;
  }
  ant = -Infinity;
  for (const porc of PORCS) {
    const g = BUSC.comisionTransf(5000, porc).ganancia;
    if (g < ant - 1e-9) monoPorc = false;
    ant = g;
  }
  ok(monoTasa, "INV-5a: tasa de venta ↑ ⇒ ingreso por 360 no sube (derivadaCalc real)");
  ok(monoPrecio, "INV-5b: precio pagado ↑ ⇒ excedente no sube (contaGananciaBruta real)");
  ok(monoPorc, "INV-5c: prima % ↑ ⇒ ganancia de la vuelta no baja (comisionTransf real)");
}

/* =====================================================================
   INV-6 · BORDES DE DINERO: cantidad 0 · 1 centavo · recarga exacta
   (cantidad 1) · bonos en 149/150/151 y 9/10/11.
   (Tope 500 000 y 3 envíos/día: adjudicación A3, sin aserción.)
   ===================================================================== */
{
  const t = TARIFAS[0]; ponerTarifaMN(t); ponerTarifaB(t);
  const rU = { tipo: "saldo", precio: 1000, cantidad: 1 };
  ok(cerca(MN.contaGananciaBruta(rU, MN.tarifa()), t.ingresoRef360 - 1000) &&
     cerca(pro.brutaDe(rU, aBot(t)), t.ingresoRef360 - 1000),
    "INV-6a: la recarga unidad (cantidad 1) da exactamente ingreso − precio");
  const rCent = { tipo: "saldo", precio: 0.01, cantidad: 1 };
  ok(isFinite(MN.contaGananciaBruta(rCent, MN.tarifa())) && MN.sugerencia(rCent).com <= MN.contaGananciaBruta(rCent, MN.tarifa()) + 1e-9,
    "INV-6b: el centavo (precio 0.01) no rompe la fórmula ni la cota de comisión");
  const rCero = { tipo: "saldo", precio: 1000, cantidad: 0 };
  propH("H-4",
    cerca(MN.contaGananciaBruta(rCero, MN.tarifa()), 0) && cerca(pro.brutaDe(rCero, aBot(t)), 0) && MN.sugerencia(rCero).com === 0,
    "INV-6c: cantidad 0 ⇒ bruta 0 y comisión 0 (Mi Negocio y bot)",
    `cantidad 0 con precio 1000 e ingreso ${t.ingresoRef360}: conta/brutaDe calculan ${(t.ingresoRef360 - 1000).toFixed(2)} (tratan la cantidad 0 como 1 por el «|| 1»); comisionSaldo de Mi Trabajo sí da 0. La app de reportes también coacciona la cantidad a 1 al crear, así que el borde no es alcanzable desde el formulario — queda fijado.`);
  ok(BUSC.comisionSaldo(1000, 0).fee === 0, "INV-6c fijado: comisionSaldo(precio, 0) = 0 en Mi Trabajo");
  /* Bonos: bordes exactos vía el espejo anclado del cierre */
  ok(espejoBono(149, 0) === 0 && espejoBono(150, 0) === 300 && espejoBono(151, 0) === 300,
    "INV-6d: bono de saldo salta EN 150 recargas (149→0 · 150→300 · 151→300)");
  ok(espejoBono(0, 9) === 0 && espejoBono(0, 10) === 300 && espejoBono(0, 11) === 300,
    "INV-6e: bono de transferencia salta EN 10 tratos (9→0 · 10→300 · 11→300)");
  ok(espejoBono(150, 10) === 600 && espejoBono(149, 9) === 0,
    "INV-6f: los dos bonos se suman (150 recargas + 10 tratos = 600) y bajo ambos umbrales no hay bono");
}

/* =====================================================================
   INV-7 · TABLA DE DECISIÓN DE COMISIONES (24 celdas):
   {saldo, transferencia} × {ganancia >0, =0, <0} × {prueba, real} ×
   {pagada, pendiente}. Precondición de la tabla: trato APROBADO.
   Se aserta: inclusión en las cuentas (Contabilidad y bot), membresía
   en «por pagar», regla de signo de la comisión sugerida y la
   inclusión en el resumen del cierre del servidor.
   (La ganancia de transferencia se construye con la forma camp-A;
   desde el arreglo H-1 la forma real almacenada da los mismos
   números en apps y servidor por la lectura normalizada.)
   ===================================================================== */
{
  const t = TARIFAS[0]; ponerTarifaMN(t); ponerTarifaB(t);
  const base = { codigo: "BUSC-1", creado: "2026-11-10T10:00:00.000Z", creado_en: "2026-11-10T10:00:00.000Z", estado: "aprobado" };
  const celda = (tipo, signo) => tipo === "saldo"
    ? { ...base, tipo, cantidad: 10, precio: signo > 0 ? 1000 : (signo === 0 ? t.ingresoRef360 : 1500), porc: null }
    : { ...base, tipo, cantidad: null, precio: signo > 0 ? 5000 : (signo === 0 ? 0 : 5000), porc: signo > 0 ? 30 : (signo === 0 ? 0 : 0) };
  /* transferencia signo 0: efectivo 0 ⇒ ganancia 0 · signo −: al 0% con libro > salida ⇒ ganancia < 0 */
  let celdasOk = 0, celdasTotal = 0; const ejCeldas = [];
  for (const tipo of ["saldo", "transferencia"]) for (const signo of [1, 0, -1])
    for (const prueba of [false, true]) for (const pagada of [false, true]) {
      celdasTotal++;
      const r = { ...celda(tipo, signo), prueba, comision: 100,
        comision_pagada_en: pagada ? "2026-11-10T12:00:00.000Z" : null };
      stateMN.foto.reportes = [r];
      const enConta = MN.contaRepsBase().length === 1;
      const enBot = WH.repsBase({ reps: [r] }).length === 1;
      const enPorPagar = WH.sinPagarDe({ reps: [r] }).length === 1;
      const sug = MN.sugerencia(r).com;
      const problemas = [];
      if (enConta !== !prueba) problemas.push("contaRepsBase incluye=" + enConta);
      if (enBot !== !prueba) problemas.push("repsBase(bot) incluye=" + enBot);
      if (enPorPagar !== (!prueba && !pagada)) problemas.push("sinPagarDe=" + enPorPagar);
      if (signo > 0 && !(sug > 0)) problemas.push("sugerencia=" + sug + " con ganancia>0");
      if (signo <= 0 && sug !== 0) problemas.push("sugerencia=" + sug + " con ganancia<=0");
      if (problemas.length) ejCeldas.push(`${tipo}/signo${signo > 0 ? "+" : signo}/prueba=${prueba}/pagada=${pagada}: ${problemas.join(" · ")}`);
      else celdasOk++;
    }
  ok(celdasOk === celdasTotal && celdasTotal === 24,
    `INV-7: tabla de decisión completa — ${celdasOk}/24 celdas con el resultado esperado (apps)` +
    (ejCeldas.length ? " — " + ejCeldas.join(" | ") : ""));
  /* La celda del servidor: su resumen filtra SOLO por estado (texto SQL) */
  const iRes = sqlN.indexOf("into v_resumen");
  const whereRes = sqlN.slice(iRes, iRes + 1600);
  ok(/not coalesce\(r\.prueba, false\)/.test(whereRes),
    "INV-7 (servidor): el resumen del cierre excluye los reportes de prueba como hacen Contabilidad y el bot (H-2 corregido)");
}

/* =====================================================================
   INV-8 · PROPIEDAD DE ESTADOS DE LA OUTBOX (jsdom, app real):
   ninguna secuencia de eventos locales pinta PAGADO sin el campo del
   servidor; despachar dos veces la misma acción = un solo efecto.
   INV-9 · IDA Y VUELTA DE LA FOTO: serializar → releer devuelve los
   mismos totales; la foto nunca «mejora» un número.
   (Harness adaptado del banco de Mi Negocio: mismos stubs de puertas.)
   ===================================================================== */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const datosPublicadosINV = { version: 4, versionApp: "1.4.5", apkUrl: "https://example.invalid/apk",
  tarifa: { version: 4, ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, bonoSaldoRecargas: 150, bonoSaldoCUP: 300, bonoTransfTratos: 10, bonoTransfCUP: 300 } };
let R8 = { reportes: [], usuarios: [], persistePago: true, llamadas: [] };
function crearINV(extra) {
  R8.llamadas = [];
  const dom = new JSDOM(htmlMN, { url: "https://ernesto5058.github.io/calculadora-ernesto/minegocio/", runScripts: "dangerously", pretendToBeVisual: true, beforeParse(w) {
    if (extra && extra.preState) { try { w.localStorage.setItem("minegocio_v1", JSON.stringify(extra.preState)); } catch (e) {} }
    w.fetch = function (url, opts) {
      const u = String(url);
      function rechaza(msg, st) { return Promise.resolve({ ok: false, status: st || 404, text: () => Promise.resolve(JSON.stringify({ message: msg || "404" })), json: () => Promise.resolve({ message: msg || "404" }) }); }
      if (u.includes("/rpc/")) {
        const fn = u.split("/rpc/")[1].split("?")[0];
        let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
        R8.llamadas.push("rpc:" + fn);
        const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v === undefined ? null : v)), json: () => Promise.resolve(v) });
        switch (fn) {
          case "admin_validar": return json(body.p_codigo === "CODIGO-PRUEBA");
          case "admin_reportes": return json(R8.reportes);
          case "admin_ayudas": return json([]);
          case "admin_usuarios": return json(R8.usuarios);
          case "admin_aprobar": {
            const fila = R8.reportes.find(x => String(x.id) === String(body.p_id));
            if (fila) { fila.estado = "aprobado"; fila.comision = body.p_comision; }
            return json({ ok: true });
          }
          case "admin_rechazar": return json({ ok: true });
          case "admin_marcar_pagado": {
            const fila = R8.reportes.find(x => String(x.id) === String(body.p_id));
            if (fila && !fila.comision_pagada_en && R8.persistePago) fila.comision_pagada_en = new Date().toISOString();
            return json({ ok: true });
          }
          case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 950, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: "2026-11-11 10:00" });
          case "admin_cierres": return json([]);
          case "admin_actividad": return json([]);
          case "admin_guardar_tarifa": return json({ ok: true });
          case "mercado_fijar_costo": return json({ ok: true });
          case "admin_publicar_tratos": return json({ ok: true });
          default: return rechaza("desconocida " + fn);
        }
      }
      if (u.includes("datos.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(datosPublicadosINV) });
      if (u.includes("ultimo.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve({ ts: "2026-11-11T02:00:00Z", ETECSA: { average: 304.86, count: 55 }, BANK_CUP: { average: 1068.44, count: 40 } }) });
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    };
  } });
  return { dom, w: dom.window };
}
function clickINV(el) { el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); }
function pestanaINV(w, nombre) { [...w.document.querySelectorAll(".tab")].forEach(x => { if (x.textContent.includes(nombre)) clickINV(x); }); }
function preBase(cola, reportesFoto) {
  return { codigo: "CODIGO-PRUEBA",
    foto: { reportes: reportesFoto, ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null },
    calc: { saldo: { salida: 950, costo: 1000, tasa: 320, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 }, busc: { precio: 0, tasaVenta: 0, efectivo: 0, porc: 0, libro: 0, salida: 0 } },
    cola, sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
}
const REP8 = { id: "rp", codigo: "BUSC-1", nombre: "Busc Uno", tipo: "saldo", cantidad: 10, precio: 1000, porc: null,
  telefono: "5", nota: "", estado: "aprobado", comision: 246.70, comision_pagada_en: null, creado: new Date().toISOString() };

/* INV-8 · S1: acción «pagado» DUPLICADA en cola + servidor que SÍ persiste */
{
  R8.persistePago = true;
  R8.usuarios = [{ codigo: "BUSC-1", nombre: "Busc Uno", activo: true }];
  R8.reportes = [JSON.parse(JSON.stringify(REP8))];
  const accion = { tipo: "pagado", id: "rp", opId: "op-inv8-1", estado: "pendiente", intentos: 0,
    creada: new Date().toISOString(), cuando: new Date().toISOString() };
  const { w } = crearINV({ preState: preBase([accion, { ...accion }], [JSON.parse(JSON.stringify(REP8))]) });
  await sleep(500);
  const llamadasPago = R8.llamadas.filter(x => x === "rpc:admin_marcar_pagado").length;
  const estadoGuardado = JSON.parse(w.localStorage.getItem("minegocio_v1") || "{}");
  const colaRestante = (estadoGuardado.cola || []).filter(a => a && a.tipo === "pagado" && String(a.id) === "rp");
  const sello1 = R8.reportes[0].comision_pagada_en;
  ok(llamadasPago >= 1, "INV-8a: la cola despacha la acción de pago al servidor (" + llamadasPago + " llamada(s))");
  ok(colaRestante.length === 1,
    "INV-8b FIJADO (observación): despachada la acción duplicada (mismo opId), sobrevive UNA copia zombi en la cola local por la fusión con el espejo — si un arreglo futuro la drena a 0, esta aserción obliga a actualizar el registro");
  ok(!!sello1, "INV-8c: el efecto en el servidor es UN solo sello de pago");
  const { w: w2 } = crearINV({ preState: estadoGuardado });
  await sleep(500);
  ok(R8.reportes[0].comision_pagada_en === sello1,
    "INV-8d: al reabrir (la copia zombi se re-despacha), el sello del servidor NO cambia: un solo efecto");
  pestanaINV(w2, "Bandeja"); await sleep(120);
  const card = w2.document.querySelector('[data-rep="rp"]');
  ok(!!card && card.textContent.includes("PAGADO"),
    "INV-8e: al reabrir, PAGADO se pinta — porque el SERVIDOR ya trae el sello, no por la acción local");
  w.close(); w2.close();
}
/* INV-8 · S2: la misma secuencia duplicada, servidor que NUNCA persiste el sello */
{
  R8.persistePago = false;
  R8.reportes = [JSON.parse(JSON.stringify(REP8))];
  const accion = { tipo: "pagado", id: "rp", opId: "op-inv8-2", estado: "pendiente", intentos: 0,
    creada: new Date().toISOString(), cuando: new Date().toISOString() };
  const { w } = crearINV({ preState: preBase([accion, { ...accion }], [JSON.parse(JSON.stringify(REP8))]) });
  await sleep(500);
  pestanaINV(w, "Bandeja"); await sleep(120);
  const card = w.document.querySelector('[data-rep="rp"]');
  ok(!!card && !card.textContent.includes("PAGADO"),
    "INV-8f: servidor sin sello (aunque la puerta responde ok y la acción entró dos veces) ⇒ la tarjeta NO pinta PAGADO");
  w.close();
}
/* INV-8 · S3: aprobar SÍ confirmado + pagado NO confirmado en la misma cola */
{
  R8.persistePago = false;
  const repP = { ...REP8, estado: "pendiente", comision: null };
  R8.reportes = [JSON.parse(JSON.stringify(repP))];
  const cola = [
    { tipo: "aprobar", id: "rp", comision: 246.70, cuando: new Date().toISOString() },
    { tipo: "pagado", id: "rp", cuando: new Date().toISOString() },
  ];
  const { w } = crearINV({ preState: preBase(cola, [JSON.parse(JSON.stringify(repP))]) });
  await sleep(600);
  const guardado = JSON.parse(w.localStorage.getItem("minegocio_v1") || "{}");
  const { w: w2 } = crearINV({ preState: guardado });
  await sleep(400);
  pestanaINV(w2, "Bandeja"); await sleep(120);
  const card = w2.document.querySelector('[data-rep="rp"]');
  const filaSrv = R8.reportes[0];
  ok(filaSrv.estado === "aprobado" && !filaSrv.comision_pagada_en,
    "INV-8g: el servidor confirma el aprobado y NO el pago (montaje del escenario)");
  ok(!!card && !card.textContent.includes("PAGADO"),
    "INV-8h: con aprobado confirmado y pago sin confirmar, la tarjeta muestra el trato SIN el sello PAGADO");
  w.close(); w2.close();
}

/* INV-9 · la foto guardada devuelve los mismos totales, dos ciclos */
{
  R8.persistePago = true;
  const t = TARIFAS[0]; ponerTarifaMN(t);
  R8.usuarios = [{ codigo: "BUSC-1", nombre: "Busc Uno", activo: true }];
  R8.reportes = [
    { id: "a1", codigo: "BUSC-1", nombre: "Busc Uno", tipo: "saldo", cantidad: 100, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2467, comision_pagada_en: "2026-11-06T10:00:00.000Z", creado: "2026-11-05T10:00:00.000Z" },
    { id: "a2", codigo: "BUSC-1", nombre: "Busc Uno", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 246.70, comision_pagada_en: null, creado: new Date().toISOString() },
    { id: "a3", codigo: "BUSC-1", nombre: "Busc Uno", tipo: "saldo", cantidad: 10, precio: 1500, porc: null, telefono: "5", nota: "", estado: "pendiente", comision: null, comision_pagada_en: null, creado: new Date().toISOString() },
  ];
  const totalEsperado = R8.reportes.filter(r => r.estado === "aprobado")
    .reduce((s, r) => s + MN.contaNeta(r, MN.tarifa()), 0);
  const { w } = crearINV({ preState: preBase([], []) });
  await sleep(500);
  const foto1 = JSON.parse(w.localStorage.getItem("minegocio_v1") || "{}");
  const totalFoto1 = (foto1.foto.reportes || []).filter(r => r.estado === "aprobado")
    .reduce((s, r) => s + MN.contaNeta(r, MN.tarifa()), 0);
  ok(cerca(totalFoto1, totalEsperado, 0.01),
    "INV-9a: la foto serializada conserva los totales (Σ neta de aprobados = " + totalEsperado.toFixed(2) + ")");
  const { w: w2 } = crearINV({ preState: foto1 });
  await sleep(500);
  const foto2 = JSON.parse(w2.localStorage.getItem("minegocio_v1") || "{}");
  const totalFoto2 = (foto2.foto.reportes || []).filter(r => r.estado === "aprobado")
    .reduce((s, r) => s + MN.contaNeta(r, MN.tarifa()), 0);
  ok(cerca(totalFoto2, totalFoto1, 1e-9) && (foto2.foto.reportes || []).length === (foto1.foto.reportes || []).length,
    "INV-9b: segundo ciclo serializar→releer: mismos totales y mismo número de reportes (la foto no «mejora» números)");
  w.close(); w2.close();
}

/* ================= RESUMEN ================= */
console.log("\n=== INVARIANTES DE DINERO: " + pass + " PASS · " + fail + " FAIL · " + hallazgos.length + " HALLAZGOS ===");
if (fails.length) { console.log("Fallos:\n - " + fails.join("\n - ")); }
if (hallazgos.length) {
  console.log("Hallazgos abiertos (propiedad que falla contra la fórmula viva — NO se toca la fórmula):");
  for (const h of hallazgos) console.log(" · " + h.hid + " — " + h.name + "\n     " + h.contraejemplo);
}
process.exit(fail ? 1 : 0);

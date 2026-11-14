// Banco de la GUÍA DE ARBITRAJE — FASE 1 (2026-11-13): módulo puro
// (vectores fijos del estudio guia-arbitraje-estudio-2026-11-13) +
// puertas vivas con la cuenta de prueba PEUEBA (es_prueba, limpiado
// en finally) + frontera de claves prohibidas en guia_buscador.
// Lee el PAT del llavero o de SUPABASE_PAT en el entorno.
import { readFileSync } from "node:fs";

let PAT = process.env.SUPABASE_PAT;
if (!PAT) {
  try {
    const env = readFileSync(
      "/home/hatch/workspace/.secure/supabase-pat.env", "utf8");
    PAT = (env.match(/sbp_[A-Za-z0-9._-]+/) || [])[0];
  } catch { /* sin llavero */ }
}
const REF = "otsudfgwpapkluusrlnj";
let pass = 0, fail = 0;
function eq(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pass++; console.log("PASS", nombre); }
  else {
    fail++;
    console.log("FAIL", nombre, "\n  real:    ", JSON.stringify(real),
      "\n  esperado:", JSON.stringify(esperado));
  }
}
function ok(nombre, cond, extra) {
  if (cond) { pass++; console.log("PASS", nombre); }
  else { fail++; console.log("FAIL", nombre, extra ?? ""); }
}
async function sql(query) {
  const r = await fetch(
    "https://api.supabase.com/v1/projects/" + REF + "/database/query", {
      method: "POST",
      headers: { Authorization: "Bearer " + PAT,
                 "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
  const t = await r.text();
  if (!r.ok) throw new Error("SQL " + r.status + ": " + t.slice(0, 400));
  return JSON.parse(t);
}
const uno = async (q) => (await sql(q))[0];
const llamada = (fn, obj) =>
  "select public." + fn + "($j$" + JSON.stringify(obj) + "$j$::jsonb) as r";
if (!PAT) { console.log("SKIP: sin SUPABASE_PAT ni llavero"); process.exit(0); }

// ---------- VECTORES PUROS (números del estudio, §3) ----------
const LOTES = [
  { cantidad: 3000, costo: 7800 }, { cantidad: 1440, costo: 4000 },
  { cantidad: 1080, costo: 3000 }, { cantidad: 360, costo: 1000 },
  { cantidad: 360, costo: 1000 }, { cantidad: 2262, costo: 5655 },
];
const MENU = { peldanos: [
  { nombre: "Inmediato", tasa: 314, g: 48.28, zona: "automatica", delanteUsd: 12, bloqueado: false },
  { nombre: "Equilibrado", tasa: 315, g: 45.71, zona: "automatica", delanteUsd: 30, bloqueado: false },
  { nombre: "Paciente", tasa: 303, g: 81.19, zona: "automatica", delanteUsd: 85, bloqueado: false },
] };
const CFG_COP = { mat_total: 100, mat_buscador: 40, margen_util: 40 };
try {
  // Copiloto saldo — Briku de hoy: 5.000 en mano, ref 1.079,81, 32 %, 1.000
  let r = await uno(llamada("guia_calc_copiloto", {
    foto_usable: true, ingreso_ref360: 1079.81,
    pendiente_efectivo: 5000, pct_saldo: 32, precio_obs: 1000,
    cfg: CFG_COP }));
  let s = r.r.saldo.sugerencia;
  eq("copiloto saldo habla", r.r.saldo.habla, true);
  eq("copiloto recargas", +s.cantidad_recargas, 5);
  eq("copiloto saldo", +s.saldo, 1800);
  eq("copiloto capital", +s.capital, 5000);
  eq("copiloto valor (fórmula del asiento)", +s.valor, 5399);
  eq("copiloto ganancia", +s.ganancia_total, 399);
  eq("copiloto parte buscador 32%", +s.parte_buscador, 127);
  eq("copiloto techo absoluto", +s.techo_abs, 1079);
  eq("copiloto techo útil", +s.techo_util, 1039);
  ok("techo_abs ≤ ref", +s.techo_abs <= 1079.81);

  // Copiloto transferencia — prima real del día (910 / 1.111,74) = 22,1 %
  r = await uno(llamada("guia_calc_copiloto", {
    foto_usable: true, libro_ref: 1111.74, salida_ref: 910,
    piso_transf: 25, pendiente_transferencia: 5000, pct_transf: 26,
    cfg: CFG_COP }));
  let t = r.r.transferencia.sugerencia;
  eq("copiloto transf habla", r.r.transferencia.habla, true);
  eq("copiloto prima (piso manda hoy)", +t.prima, 25);
  eq("copiloto entra", +t.entra, 6250);
  eq("copiloto ganancia transf", +t.ganancia_total, 1250);
  eq("copiloto parte transf 26%", +t.parte_buscador, 325);

  // Propiedades del copiloto
  r = await uno(llamada("guia_calc_copiloto", {
    foto_usable: false, ingreso_ref360: 1079.81,
    pendiente_efectivo: 5000, pct_saldo: 32, precio_obs: 1000,
    libro_ref: 1111.74, salida_ref: 910,
    pendiente_transferencia: 5000, pct_transf: 26 }));
  eq("foto no usable = silencio saldo", r.r.saldo.habla, false);
  eq("foto no usable = silencio transf", r.r.transferencia.habla, false);
  r = await uno(llamada("guia_calc_copiloto", {
    foto_usable: true, ingreso_ref360: 1079.81,
    pendiente_efectivo: 1200, pct_saldo: 32, precio_obs: 1000,
    cfg: CFG_COP }));
  eq("ganancia 79 < 100 = no material", r.r.saldo.motivo, "no_material");
  r = await uno(llamada("guia_calc_copiloto", {
    foto_usable: true, ingreso_ref360: 1079.81,
    pendiente_efectivo: 5000, pct_saldo: 32, precio_obs: 1000,
    espera_abierta_saldo: true, cfg: CFG_COP }));
  eq("espera abierta = ya en camino", r.r.saldo.motivo, "ya_en_camino");

  // Asesor — la oferta de hoy del estudio: $31 a 303, vendible 9.412,08
  const asesorBase = {
    ahora: "2026-11-13T17:00:00Z",
    foto: { usable: true, senal: { palabra: "VENDER" }, menu: MENU,
      ejecutable20: { tasa: 303, usd: 40 }, duras: [],
      transferencia: null },
    tarifa: { salida_ref: 910, ingreso_ref360: 1079.81, libro_ref: 1111.74 },
    costo_ref360: 1000,
    posicion: { linea_saldo: 9772.08, linea_en: "2026-11-13T16:15:00Z",
      lotes: LOTES, comprometido_saldo: 0, base_venta: true,
      fondo: 10993, reserva_cupos: 15000, mejor_nivel20_hoy: null },
    puerta: { tope_oferta: 40, monto_hoy: 0, acciones_hora: 0,
      preparada_viva: false, detenidas: false, pausadas: false },
    cfg: { colchon: 360, mat_fifo: 300 },
    promo_puesto: { activa: false, ref_cierre: null },
  };
  r = await uno(llamada("guia_calc_asesor", asesorBase));
  let a = r.r;
  eq("asesor equilibrio", +a.equilibrio, 327.6);
  eq("asesor vendible", +a.posicion.vendible, 9412.08);
  ok("vendible ≤ línea", +a.posicion.vendible <= 9772.08);
  eq("asesor sin lote derivado", +a.posicion.sin_lote, 1270.08);
  ok("asesor prepara", a.preparada !== null,
    JSON.stringify(a.motivos_no_prepara));
  eq("asesor peldaño Paciente", a.preparada.peldano, "Paciente");
  eq("asesor tasa", +a.preparada.tasa, 303);
  // Contrato 2026-11-14 (lección de Ernesto, «vende todo el saldo»):
  // el monto se redondea a centavos (round, no floor a QUSD enteros)
  // y el receive nace DEL SALDO: vendible entero (9.412 de 9.412,08),
  // con su tasa efectiva declarada. Antes: monto 31 / receive 9.393.
  eq("asesor monto (round a centavos)", +a.preparada.monto_qusd, 31.06);
  eq("asesor receive = vendible entero", +a.preparada.receive, 9412);
  eq("asesor tasa efectiva", +a.preparada.tasa_efectiva, 303.0264);
  eq("asesor recibe del saldo", a.preparada.recibe_del_saldo, true);
  eq("asesor ganancia FIFO", +a.preparada.ganancia_fifo, 3077);
  eq("asesor ganancia a costo del día", +a.preparada.ganancia_costo_dia, 2123);
  eq("asesor FIFO con lote", +a.preparada.fifo.con_lote, 8502);
  eq("asesor FIFO sin lote", +a.preparada.fifo.sin_lote, 910);
  eq("compra fondo: no (reserva)", a.compra_fondo.posible, false);
  eq("compra fondo motivo", a.compra_fondo.motivo, "reserva_cupos");
  eq("fondo tras reserva", +a.compra_fondo.fondo_tras_reserva, 0);

  // Propiedades del asesor
  const con = (patch) => ({ ...asesorBase, ...patch });
  r = await uno(llamada("guia_calc_asesor",
    con({ posicion: { ...asesorBase.posicion, linea_saldo: 8000 } })));
  ok("descuadre lotes > línea+5 calla",
    r.r.motivos_no_prepara.includes("descuadre_linea_libro"));
  r = await uno(llamada("guia_calc_asesor",
    con({ posicion: { ...asesorBase.posicion, base_venta: false } })));
  ok("sin oferta base no prepara",
    r.r.motivos_no_prepara.includes("sin_oferta_base"));
  r = await uno(llamada("guia_calc_asesor",
    con({ foto: { ...asesorBase.foto, usable: false } })));
  ok("foto no usable no prepara",
    r.r.motivos_no_prepara.includes("foto_no_usable"));
  r = await uno(llamada("guia_calc_asesor",
    con({ posicion: { ...asesorBase.posicion, comprometido_saldo: 500 } })));
  eq("comprometido descuenta del vendible",
    +r.r.posicion.vendible, 9772.08 - 500 - 360);

  // ---------- VIVO: puertas con PEUEBA (es_prueba) ----------
  await sql("delete from public.guia_sugerencias where es_prueba");
  await sql("delete from public.dinero_entregas " +
    "where buscador_codigo = 'PEUEBA' and es_prueba");
  await sql("delete from public.dinero_estrellas " +
    "where buscador_codigo = 'PEUEBA' and es_prueba");
  await sql("insert into public.dinero_estrellas " +
    "(buscador_codigo, estrellas, conteo_ganadoras, fijada_manual, " +
    "es_prueba, actualizado_en) " +
    "values ('PEUEBA', 4.9, 75, true, true, now())");
  await sql("insert into public.dinero_entregas " +
    "(buscador_codigo, monto_original, monto_pendiente, bolsillo, " +
    "estado, es_prueba) " +
    "values ('PEUEBA', 5000, 5000, 'efectivo', 'entregado', true)");
  try {
    r = await uno("select public.guia_buscador('PEUEBA', true) as r");
    const rb = r.r;
    eq("guia_buscador ok", rb.ok, true);
    eq("guia_buscador pct real 32", +rb.pct_saldo, 32);
    // FRONTERA (R8): ni una clave prohibida en toda la salida
    const PROHIBIDAS = ["salida", "fondo", "ganancia_ernesto",
      "parte_ernesto", "reserva", "vendible", "linea", "lotes",
      "qusd", "costo", "equilibrio", "comprometido"];
    const claves = [];
    (function barrer(o) {
      if (o && typeof o === "object")
        for (const [k, v] of Object.entries(o)) {
          claves.push(k); barrer(v);
        }
    })(rb);
    const malas = claves.filter((k) =>
      PROHIBIDAS.some((p) => k.toLowerCase().includes(p)));
    eq("frontera: cero claves prohibidas", malas, []);
    if (rb.silencio_total) {
      console.log("NOTA: foto no usable ahora — el silencio es el " +
        "esperado y la tarjeta viva queda probada por vectores puros");
      eq("silencio total sin sugerencias", rb.sugerencias.length, 0);
    } else {
      const fila = await uno("select * from public.guia_sugerencias " +
        "where buscador_codigo = 'PEUEBA' and es_prueba " +
        "and estado = 'viva' and riel = 'saldo'");
      ok("sugerencia viva materializada", !!fila);
      if (fila) {
        eq("viva: valor = fórmula del asiento", +fila.valor,
          Math.floor(+fila.saldo * +rb.tarifa.ingreso_ref360 / 360));
        eq("viva: parte = 32 % de la ganancia", +fila.parte_buscador,
          Math.floor((+fila.valor - +fila.capital) * 32 / 100));
        eq("viva: una sola por riel",
          (await sql("select count(*)::int as n from " +
            "public.guia_sugerencias where buscador_codigo = 'PEUEBA' " +
            "and es_prueba and estado = 'viva' and riel = 'saldo'"))[0].n, 1);
      }
    }
    r = await uno("select public.guia_buscador('NO-EXISTE', true) as r");
    eq("código malo rechazado", r.r.ok, false);
    r = await uno("select public.guia_ernesto('NO-ADMIN', false) as r");
    eq("guia_ernesto sin admin rechazado", r.r.motivo, "no_admin");
    r = await uno("select public.guia_asesor_interno(false) as r");
    eq("asesor interno ok", r.r.ok, true);
    ok("asesor interno trae cálculo",
      !!r.r.calculo && !!r.r.calculo.posicion);
    // El parche de Fase 2 YA está aplicado en vivo (2026-11-14): el
    // comprometido es legible y descuenta del vendible (ver el PASS
    // «comprometido descuenta del vendible» en el cálculo). La
    // expectativa vieja (false) quedó caduca — evidencia en el
    // CHEQUEO de la tanda puerta+asesor del 2026-11-14.
    eq("comprometido legible (parche Fase 2 aplicado)",
      r.r.comprometido_legible, true);
  } finally {
    await sql("delete from public.guia_sugerencias where es_prueba");
    await sql("delete from public.dinero_entregas " +
      "where buscador_codigo = 'PEUEBA' and es_prueba");
    await sql("delete from public.dinero_estrellas " +
      "where buscador_codigo = 'PEUEBA' and es_prueba");
  }
} catch (e) {
  fail++; console.log("ERROR del banco:", e.message);
}
console.log("\nGUIA FASE 1: " + pass + " PASS · " + fail + " FAIL");
process.exit(fail ? 1 : 0);

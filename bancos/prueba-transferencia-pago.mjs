// Banco VIVO · Transferencia CUP: Fijo Protegido + Premio + Demanda→Precio
// (2026-11-14 · CHEQUEO 91). Todo corre en el carril es_prueba y se
// LIMPIA al final (finally). Sin SUPABASE_PAT se salta en silencio.
//
// Cubre: snapshot de la vuelta de transferencia por trigger (tipo,
// unitarios por CUP, fijo = 26 % de la ganancia protegida topado por
// la comisión a papel) · top-up del fijo en efectivo con la rejilla
// partida (442 → 460, redondeo 18 como línea propia) y por
// transferencia exacto · venta mala (ingreso por CUP bajo el unitario
// protegido) = sin premio y fijo intacto · venta buena = premio exacto
// del extra sobre el protegido, pagado con redondeo en efectivo ·
// idempotencia por referencia de venta · colchón: observaciones contra
// el MARCO (salida ÷ libro), una no mueve, dos en conflicto no mueven,
// dos que acuerdan mueven un paso · bordes puros del redondeo ·
// demanda BANK_CUP → prima del Copiloto (alta con absorción sube,
// alta sin absorción frena, fría baja con suelo, normal no toca, sin
// señal no inventa) con el riel de saldo intacto · señal viva y la
// línea conectada en guia_buscador · frontera del buscador (ve tipo,
// fijo, premio y redondeo; jamás colchón/protegida/salida) · historia
// real intacta.
import { randomUUID } from "node:crypto";

const PAT = process.env.SUPABASE_PAT;
if (!PAT) { console.log("SKIP vivo: falta SUPABASE_PAT"); process.exit(0); }
const REF = "otsudfgwpapkluusrlnj";
const TAG = Math.floor(Math.random() * 1e6).toString(36).toUpperCase();
const COD = "BRIKU-EUX";

let pass = 0, fail = 0;
function eq(n, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pass++; console.log("PASS", n); }
  else { fail++; console.log("FAIL", n, "\n  real:    ", JSON.stringify(real), "\n  esperado:", JSON.stringify(esperado)); }
}
function ok(n, c) { eq(n, !!c, true); }
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + PAT, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("SQL " + r.status + ": " + t.slice(0, 400));
  return JSON.parse(t || "[]");
}
const one = async (q) => (await sql(q))[0] || {};
const num = (x) => (x === null || x === undefined ? null : Number(x));

const ids = { vueltas: [], esperas: [], ventasRef: [] };
let admin = null, cfgAntes = null, tarAntes = null, saldoRealAntes = null, liqRealAntes = null;

try {
  admin = (await one(`select valor from admin_config where clave='codigo_admin'`)).valor;
  cfgAntes = await one(`select activo, activo_desde, colchon_pct, colchon_origen, rejilla_efectivo, rejilla_chica, rejilla_umbral from pago_proteccion_config where es_prueba`);
  tarAntes = await one(`select ingreso_ref360, libro_ref, salida_ref, piso_transf from tarifa where id=1`);
  saldoRealAntes = await one(`select public.dinero_saldo('fondo',false) as fondo, public.dinero_saldo('inventario',false) as inv, public.dinero_saldo('gasto',false) as gasto, public.dinero_saldo('cupo:BRIKU-EUX',false) as cupo`);
  liqRealAntes = num((await one(`select count(*) as n from pago_liquidaciones where not es_prueba`)).n);

  // Carril de prueba determinista: colchón 10 %, tarifa 910/1125
  await sql(`update pago_proteccion_config set activo=true, activo_desde=now() - interval '1 hour',
             colchon_pct=10, colchon_origen='banco', rejilla_efectivo=50, rejilla_chica=20, rejilla_umbral=500
             where es_prueba`);
  await sql(`update tarifa set salida_ref=910, libro_ref=1125 where id=1`);
  await sql(`insert into dinero_estrellas (buscador_codigo, estrellas, conteo_ganadoras, fijada_manual, es_prueba)
             values ('${COD}', 4.9, 75, false, true)
             on conflict (buscador_codigo, es_prueba) do update set estrellas=4.9`);
  const ent = await one(`insert into dinero_entregas (buscador_codigo, monto_original, monto_pendiente, bolsillo, estado, entregado_en, detalle, es_prueba)
             values ('${COD}', 3000, 0, 'efectivo', 'devuelto_especie', now(), 'BANCO-${TAG}', true) returning id`);

  async function vueltaT(tag, capital, producto, comision, pagoHecho) {
    const esp = await one(`insert into dinero_esperas (buscador_codigo, tipo, cantidad_esperada, capital_cup, origen, estado, ventana_inicio, ventana_fin, vuelta_ids, datos, es_prueba)
               values ('${COD}', 'transferencia', ${producto}, ${capital}, 'operado_ernesto', 'cumplida', now(), now(), '[]'::jsonb, '{}'::jsonb, true) returning id`);
    ids.esperas.push(esp.id);
    const v = await one(`insert into dinero_vueltas (entrega_id, buscador_codigo, tipo, capital_cup, producto_cantidad, producto_detalle, base_ref360, valor_producto_cup, ganancia_capturada, comision, pago_hecho, pago_en, estado, es_prueba, espera_id)
               values ('${ent.id}', '${COD}', 'transferencia', ${capital}, ${producto}, 'BANCO-${TAG}-${tag}', null, ${producto}, ${producto - capital}, ${comision}, ${pagoHecho}, ${pagoHecho ? "now()" : "null"}, 'abierta', true, '${esp.id}') returning id`);
    ids.vueltas.push(v.id);
    await sql(`update dinero_esperas set vuelta_ids='["${v.id}"]'::jsonb where id='${esp.id}'`);
    return v.id;
  }
  const liq = async (v) => one(`select * from pago_liquidaciones where vuelta_id='${v}'`);

  // ---------- VENTAS: MALA, BUENA, IDEMPOTENCIA ----------
  const vT3 = await vueltaT("T3", 10000, 13000, 780, true);
  const l3 = await liq(vT3);
  eq("snapshot T3: comisión ya pagada por el motor viejo", num(l3.comision_ya_pagada), 780);

  ids.ventasRef.push(`BANCO-${TAG}-MALA`);
  const sm = await one(`select public.pago_registrar_venta_transferencia('${admin}', 'BANCO-${TAG}-MALA', 5000, 1300, 3.8462, 'banco', true, 'efectivo') as r`);
  ok("venta mala: ok", sm.r.ok === true);
  eq("venta mala: ingreso por CUP = 910÷1300", num(sm.r.ingreso_real_unit), 0.7);
  eq("venta mala: marco de la foto = 910÷1125", num(sm.r.marco_real_unit), 0.808889);
  eq("venta mala: premio 0 bajo el protegido", num(sm.r.premio_total), 0);
  const l3m = await liq(vT3);
  eq("venta mala: CUP vendidos acumulados", num(l3m.saldo_vendido), 5000);
  eq("venta mala: valor real acumulado", num(l3m.valor_real_acum), 3500);
  eq("venta mala: ganancia real negativa asentada", Math.round(num(l3m.ganancia_real_acum) * 100) / 100, -346.15);
  eq("venta mala: el fijo NO baja (garantía)", num(l3m.fijo), 442);
  const cfgM = await one(`select colchon_pct from pago_proteccion_config where es_prueba`);
  eq("colchón: UNA observación no mueve nada", num(cfgM.colchon_pct), 10);

  ids.ventasRef.push(`BANCO-${TAG}-BUENA`);
  const sb = await one(`select public.pago_registrar_venta_transferencia('${admin}', 'BANCO-${TAG}-BUENA', 8000, 1000, 8, 'banco', true, 'efectivo') as r`);
  ok("venta buena: ok", sb.r.ok === true);
  eq("venta buena: premio = floor(26 % × extra 80)", num(sb.r.premio_total), 20);
  const l3b = await liq(vT3);
  eq("venta buena: vuelta completa vendida", num(l3b.saldo_vendido), 13000);
  eq("venta buena: premio pagado", num(l3b.premio_pagado), 20);
  eq("venta buena: premio múltiplo de 20, redondeo 0", num(l3b.redondeo_pagado), 0);
  const movP = await one(`select coalesce(sum(monto),0) as s from dinero_movimientos where es_prueba and tipo='premio_venta' and cuenta='cupo:${COD}' and referencia='${vT3}'`);
  eq("venta buena: premio asentado en el libro", num(movP.s), 20);
  const cfgB = await one(`select colchon_pct from pago_proteccion_config where es_prueba`);
  eq("colchón: dos observaciones en conflicto no mueven", num(cfgB.colchon_pct), 10);

  const sb2 = await one(`select public.pago_registrar_venta_transferencia('${admin}', 'BANCO-${TAG}-BUENA', 8000, 1000, 8, 'banco', true, 'efectivo') as r`);
  eq("idempotencia: segunda vez = ya_existia", sb2.r.ya_existia, true);
  const l3c = await liq(vT3);
  eq("idempotencia: premio no se duplica", num(l3c.premio_total), 20);
  eq("idempotencia: CUP vendidos no se re-cubren", num(l3c.saldo_vendido), 13000);

  // Cuadre de la venta: QUSD que no cuadran con CUP÷tasa = rechazada
  const sx = await one(`select public.pago_registrar_venta_transferencia('${admin}', 'BANCO-${TAG}-X', 1000, 1000, 5, 'banco', true, 'efectivo') as r`);
  eq("venta: QUSD que no cuadran se rechaza", sx.r.motivo, "qusd_no_cuadra");

  // ---------- PREMIO CON REDONDEO + COLCHÓN QUE ACUERDA ----------
  const vT4 = await vueltaT("T4", 10000, 13000, 780, true);
  ids.ventasRef.push(`BANCO-${TAG}-RED`);
  const sr = await one(`select public.pago_registrar_venta_transferencia('${admin}', 'BANCO-${TAG}-RED', 13000, 1000, 13, 'banco', true, 'efectivo') as r`);
  eq("venta redondeo: premio = floor(26 % × 130)", num(sr.r.premio_total), 33);
  const l4 = await liq(vT4);
  eq("venta redondeo: premio calculado intacto", num(l4.premio_pagado), 33);
  eq("venta redondeo: 33 → 40 en efectivo (redondeo 7)", num(l4.redondeo_pagado), 7);
  const movR = await one(`select coalesce(sum(monto),0) as s from dinero_movimientos where es_prueba and tipo='redondeo_pago' and cuenta='cupo:${COD}' and referencia='${vT4}'`);
  eq("venta redondeo: línea redondeo_pago en el libro", num(movR.s), 7);

  const obs = await sql(`select desviacion_pct from pago_colchon_observaciones where es_prueba and fuente='venta_transferencia' order by creada_en`);
  eq("colchón: tres observaciones de transferencia", obs.length, 3);
  eq("colchón: desviación contra el MARCO, no el par", num(obs[0].desviacion_pct), 13.46);
  const cfgF = await one(`select colchon_pct from pago_proteccion_config where es_prueba`);
  const dirs = obs.slice(-2).map(o => Math.sign(num(o.desviacion_pct) - 10));
  if (dirs[0] !== 0 && dirs[0] === dirs[1]) {
    eq("colchón: dos que acuerdan mueven UN paso", num(cfgF.colchon_pct), 10 + dirs[0] * 0.5);
    const log = await one(`select motivo from pago_colchon_log where es_prueba and motivo='autoajuste_dos_lecturas' order by creado_en desc limit 1`);
    ok("colchón: ajuste con log y porqué", !!log.motivo);
  } else {
    eq("colchón: sin acuerdo no se mueve", num(cfgF.colchon_pct), 10);
  }

  // ---------- SNAPSHOT + TOP-UP ----------
  // El colchón pudo moverse con las ventas de arriba (dos lecturas):
  // las fotos de T1/T2 nacen con el colchón VIGENTE, y eso se aserta.
  const cVig = num((await one(`select colchon_pct from pago_proteccion_config where es_prueba`)).colchon_pct);
  const unitProt = Math.round((1 - cVig / 100) * 1e6) / 1e6;
  const fijoEsp = (prod, cap, com) => {
    const gan = Math.floor(prod * unitProt) - cap;
    return gan > 0 ? Math.min(Math.floor(gan * 0.26), com) : 0;
  };
  const redondea = (m) => m <= 0 ? 0 : (m >= 500 ? Math.ceil(m / 50) * 50 : Math.ceil(m / 20) * 20);

  const vT1 = await vueltaT("T1", 10000, 13000, 780, false);
  const fijoT1 = fijoEsp(13000, 10000, 780);
  const l1 = await liq(vT1);
  ok("snapshot: nace por trigger", !!l1.id);
  eq("snapshot: tipo transferencia", l1.tipo, "transferencia");
  eq("snapshot: % del escalón de transferencia (4.9★)", num(l1.pct_estrellas), 26);
  eq("snapshot: unitario papel por CUP", num(l1.valor_unit_papel), 1);
  eq("snapshot: unitario protegido (colchón vigente)", num(l1.valor_unit_protegida), unitProt);
  eq("snapshot: ganancia protegida", num(l1.ganancia_protegida), Math.floor(13000 * unitProt) - 10000);
  eq("snapshot: fijo = 26 % de la protegida", num(l1.fijo), fijoT1);
  eq("snapshot: estimado = comisión a papel", num(l1.estimado_papel), 780);
  ok("snapshot: fijo ≤ estimado (invariante)", num(l1.fijo) <= num(l1.estimado_papel));

  const t1 = await one(`select public.pago_congelar_fijo('${admin}', '${vT1}', 'efectivo') as r`);
  eq("topup T1: calculado = fijo", num(t1.r.topup.calculado), fijoT1);
  eq("topup T1: efectivo <500 → ×20 hacia arriba", num(t1.r.topup.pagado), redondea(fijoT1));
  eq("topup T1: redondeo línea propia", num(t1.r.topup.redondeo), redondea(fijoT1) - fijoT1);
  const l1b = await liq(vT1);
  eq("topup T1: calculado intacto en el libro", num(l1b.fijo_topup_pagado), fijoT1);
  eq("topup T1: redondeo acumulado aparte", num(l1b.redondeo_pagado), redondea(fijoT1) - fijoT1);

  const vT2 = await vueltaT("T2", 5000, 6000, 260, false);
  const fijoT2 = fijoEsp(6000, 5000, 260);
  const l2 = await liq(vT2);
  eq("snapshot T2: fijo = 26 % de su protegida", num(l2.fijo), fijoT2);
  const t2 = await one(`select public.pago_congelar_fijo('${admin}', '${vT2}', 'transferencia') as r`);
  eq("topup T2: por transferencia exacto", num(t2.r.topup.pagado), fijoT2);
  eq("topup T2: sin redondeo", num(t2.r.topup.redondeo), 0);

  // ---------- BORDES PUROS DEL REDONDEO ----------
  const rd = await one(`select public.pago_redondear(2860,50,20,500) as a, public.pago_redondear(500,50,20,500) as b,
    public.pago_redondear(501,50,20,500) as c, public.pago_redondear(499,50,20,500) as d,
    public.pago_redondear(480,50,20,500) as e, public.pago_redondear(0,50,20,500) as f,
    public.pago_redondear(21,50,20,500) as g`);
  eq("redondeo: 2860 → 2900 (≥500 ×50)", num(rd.a), 2900);
  eq("redondeo: 500 exacto no sube", num(rd.b), 500);
  eq("redondeo: 501 → 550", num(rd.c), 550);
  eq("redondeo: 499 → 500 (<500 ×20)", num(rd.d), 500);
  eq("redondeo: 480 múltiplo no sube", num(rd.e), 480);
  eq("redondeo: 0 → 0", num(rd.f), 0);
  eq("redondeo: 21 → 40", num(rd.g), 40);

  // ---------- DEMANDA → PRECIO (calculadora pura) ----------
  const calc = async (extra) => (await one(`select public.guia_calc_copiloto('${JSON.stringify({
    foto_usable: true, ingreso_ref360: 1070, libro_ref: 1115, salida_ref: 910,
    piso_transf: 25, pendiente_efectivo: 5000, pendiente_transferencia: 20000,
    pct_saldo: 32, pct_transf: 26, precio_obs: 1000,
    cfg: { mat_total: 100, mat_buscador: 40 }, ...extra })}'::jsonb) as r`)).r;
  const c0 = await calc({});
  ok("demanda: sin señal la prima base sigue viva", c0.transferencia.habla === true);
  eq("demanda: prima base = suelo de siempre", num(c0.transferencia.sugerencia.prima), 26);
  eq("demanda: sin señal declarada", c0.transferencia.sugerencia.demanda.motivo, "sin_senal");
  ok("demanda: el riel de saldo queda intacto", c0.saldo.habla === true);

  const cAlta = await calc({ demanda_transf: { termometro: "alta", banda_salida_usd_h: 12, prima_alta_pts: 2, prima_fria_pts: 2 } });
  eq("demanda alta con absorción: prima +2", num(cAlta.transferencia.sugerencia.prima), 28);
  eq("demanda alta con absorción: entra recalculado", num(cAlta.transferencia.sugerencia.entra), 25600);
  eq("demanda alta con absorción: motivo declarado", cAlta.transferencia.sugerencia.demanda.motivo, "demanda_alta_absorbe");

  const cFreno = await calc({ demanda_transf: { termometro: "alta", banda_salida_usd_h: 0, prima_alta_pts: 2, prima_fria_pts: 2 } });
  eq("demanda alta SIN absorción: FRENO, prima intacta", num(cFreno.transferencia.sugerencia.prima), 26);
  eq("demanda alta SIN absorción: motivo freno", cFreno.transferencia.sugerencia.demanda.motivo, "freno_banda_sin_absorcion");

  const cSinBanda = await calc({ demanda_transf: { termometro: "alta", prima_alta_pts: 2, prima_fria_pts: 2 } });
  eq("demanda alta sin banda: no empuja", num(cSinBanda.transferencia.sugerencia.prima), 26);
  eq("demanda alta sin banda: motivo declarado", cSinBanda.transferencia.sugerencia.demanda.motivo, "demanda_alta_sin_banda");

  const cFria = await calc({ demanda_transf: { termometro: "fria", banda_salida_usd_h: 5, prima_alta_pts: 2, prima_fria_pts: 2 } });
  eq("demanda fría: baja hasta el suelo (piso 25)", num(cFria.transferencia.sugerencia.prima), 25);
  eq("demanda fría: ajuste declarado −1", num(cFria.transferencia.sugerencia.demanda.ajuste_pts), -1);

  const cNorm = await calc({ demanda_transf: { termometro: "normal", banda_salida_usd_h: 5, prima_alta_pts: 2, prima_fria_pts: 2 } });
  eq("demanda normal: prima intacta", num(cNorm.transferencia.sugerencia.prima), 26);
  eq("demanda normal: ajuste 0", num(cNorm.transferencia.sugerencia.demanda.ajuste_pts), 0);

  const senal = await one(`select public.demanda_senal_transferencia(1125) as r`);
  ok("señal viva: termómetro válido", ["alta", "normal", "fria", "sin_datos"].includes(senal.r.termometro));
  eq("señal viva: trae los puntos de config", num(senal.r.prima_alta_pts), 2);
  const gb = await one(`select pg_get_functiondef(oid) as def from pg_proc where proname='guia_buscador'`);
  ok("guia_buscador: la señal está conectada al Copiloto", /demanda_senal_transferencia/.test(gb.def));

  // ---------- FRONTERA DEL BUSCADOR ----------
  const mio = await one(`select public.pago_mi_estado('${COD}', true) as r`);
  const mioTxt = JSON.stringify(mio.r);
  ok("frontera: su vista abre con su código", mio.r.ok === true);
  ok("frontera: sin colchón ni protegida ni salida ni unitarios",
     !/colchon|protegida|salida|valor_unit|ref360/i.test(mioTxt));
  const filaT1 = (mio.r.vueltas || []).find(v => v.vuelta === vT1);
  ok("frontera: ve su vuelta de transferencia con tipo",
     !!filaT1 && filaT1.tipo === "transferencia" && num(filaT1.fijo) === fijoT1
     && num(filaT1.redondeo) === redondea(fijoT1) - fijoT1
     && num(filaT1.total) === redondea(fijoT1));
  const otro = await one(`select public.pago_mi_estado('ABRAHAM-X30', true) as r`);
  ok("frontera: otro buscador no ve vueltas ajenas",
     (otro.r.vueltas || []).every(v => v.vuelta !== vT1));

  // ---------- HISTORIA REAL INTACTA ----------
  const liqRealDesp = num((await one(`select count(*) as n from pago_liquidaciones where not es_prueba`)).n);
  eq("historia: liquidaciones reales sin tocar", liqRealDesp, liqRealAntes);
  const saldoRealDesp = await one(`select public.dinero_saldo('fondo',false) as fondo, public.dinero_saldo('inventario',false) as inv, public.dinero_saldo('gasto',false) as gasto, public.dinero_saldo('cupo:BRIKU-EUX',false) as cupo`);
  eq("historia: saldos reales intactos", saldoRealDesp, saldoRealAntes);
} catch (e) {
  fail++; console.log("ERROR del banco:", e.message);
} finally {
  const limpia = async (q) => { try { await sql(q); } catch (e) { console.log("AVISO limpieza:", e.message.slice(0, 160)); } };
  try {
    const vids = ids.vueltas.length ? `('${ids.vueltas.join("','")}')` : "('')";
    await limpia(`delete from dinero_movimientos where es_prueba and referencia in ${vids}`);
    await limpia(`delete from pago_premio_transferencia_detalle where liquidacion_id in (select id from pago_liquidaciones where es_prueba)`);
    await limpia(`delete from pago_ventas_transferencia where es_prueba`);
    await limpia(`delete from pago_liquidaciones where es_prueba`);
    await limpia(`delete from pago_colchon_observaciones where es_prueba`);
    await limpia(`delete from pago_colchon_log where es_prueba`);
    await limpia(`delete from dinero_vueltas where es_prueba and producto_detalle like 'BANCO-${TAG}%'`);
    if (ids.esperas.length) await limpia(`delete from dinero_esperas where id in ('${ids.esperas.join("','")}')`);
    await limpia(`delete from dinero_entregas where es_prueba and detalle like 'BANCO-%'`);
    await limpia(`delete from dinero_estrellas where buscador_codigo='${COD}' and es_prueba`);
    if (cfgAntes) await limpia(`update pago_proteccion_config set activo=${cfgAntes.activo}, activo_desde=${cfgAntes.activo_desde ? `'${cfgAntes.activo_desde}'` : "null"}, colchon_pct=${cfgAntes.colchon_pct}, colchon_origen='${cfgAntes.colchon_origen}', rejilla_efectivo=${cfgAntes.rejilla_efectivo}, rejilla_chica=${cfgAntes.rejilla_chica}, rejilla_umbral=${cfgAntes.rejilla_umbral} where es_prueba`);
    if (tarAntes) await limpia(`update tarifa set ingreso_ref360=${tarAntes.ingreso_ref360}, libro_ref=${tarAntes.libro_ref}, salida_ref=${tarAntes.salida_ref}, piso_transf=${tarAntes.piso_transf} where id=1`);
  } catch (e) { console.log("AVISO limpieza:", e.message); }
}
console.log(`\n== prueba-transferencia-pago: ${pass} PASS · ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);

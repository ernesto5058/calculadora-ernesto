// Banco VIVO · Demanda + Pago Fijo Protegido + Premio (2026-11-14).
// Todo corre en el carril es_prueba y se LIMPIA al final (finally).
// Sin SUPABASE_PAT se salta en silencio (patrón de la casa).
//
// Cubre: termómetro y crudos de demanda contra la foto viva · snapshot
// del fijo por trigger (fijo ≤ estimado de papel, fórmula exacta) ·
// top-up del fijo en efectivo con REJILLA PARTIDA (≥500→×50, <500→×20,
// siempre hacia arriba; el calculado NO se altera y el redondeo viaja
// como línea propia 'redondeo_pago') · top-up por transferencia exacto
// · venta por debajo de la protegida = sin premio y fijo intacto ·
// venta por encima = premio exacto del extra · idempotencia por
// referencia de venta · colchón: una observación no mueve nada (dos
// lecturas), dos que acuerdan mueven UN paso con log · barrido de
// propiedades del fijo (150 vueltas aleatorias) · frontera del
// buscador (sin colchón/protegida/salida en su vista) · historia real
// intacta (0 liquidaciones reales, saldos sin tocar).
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

const ids = { vueltas: [], lotes: [], esperas: [], ventasRef: [] };
let admin = null, cfgAntes = null, saldoRealAntes = null, liqRealAntes = null;

try {
  admin = (await one(`select valor from admin_config where clave='codigo_admin'`)).valor;
  cfgAntes = await one(`select activo, activo_desde, colchon_pct, colchon_origen, rejilla_efectivo, rejilla_chica, rejilla_umbral from pago_proteccion_config where es_prueba`);
  saldoRealAntes = await one(`select public.dinero_saldo('fondo',false) as fondo, public.dinero_saldo('inventario',false) as inv, public.dinero_saldo('gasto',false) as gasto, public.dinero_saldo('cupo:BRIKU-EUX',false) as cupo`);
  // Antes el chequeo exigía CERO liquidaciones reales; desde que el
  // negocio real corre por el régimen (2026-11-14: vueltas reales de
  // Briku con su foto) la invariante honesta es «el banco no TOCA la
  // historia real»: conteo idéntico antes/después (CHEQUEO 91).
  liqRealAntes = num((await one(`select count(*) as n from pago_liquidaciones where not es_prueba`)).n);

  // ---------- DEMANDA ----------
  const ev = await one(`select public.demanda_evaluar() as r`);
  ok("demanda: evaluar ok", ev.r.ok === true);
  const foto = await one(`select id from mercado_fotos where libro_ok order by recibida_en desc limit 1`);
  const med = await sql(`select moneda, termometro, ops_realizadas, foto_id, propias->>'estado' as propias_estado from demanda_mediciones where foto_id='${foto.id}' order by moneda`);
  eq("demanda: dos monedas medidas",
     [...new Set(med.map(m => m.moneda))].sort(), ["BANK_CUP", "ETECSA"]);
  ok("demanda: termómetro válido", med.every(m => ["alta", "normal", "fria", "sin_datos"].includes(m.termometro)));
  ok("demanda: propias declaradas (sin_datos o con_datos)", med.every(m => ["sin_datos", "con_datos"].includes(m.propias_estado)));
  const medET = med.find(m => m.moneda === "ETECSA");
  const fotoET = await one(`select etecsa_count from mercado_fotos where id='${foto.id}'`);
  eq("demanda: ops crudas = foto viva", medET.ops_realizadas, fotoET.etecsa_count);
  const leerMalo = await one(`select public.demanda_leer('CODIGO-MALO') as r`);
  eq("demanda: puerta cerrada sin admin", leerMalo.r.ok, false);
  const leer = await one(`select public.demanda_leer('${admin}') as r`);
  ok("demanda: puerta del dueño abre", leer.r.ok === true && !!leer.r.demanda.ETECSA && !!leer.r.demanda.BANK_CUP);

  // ---------- SETUP PAGO (carril prueba) ----------
  await sql(`delete from pago_colchon_observaciones where es_prueba and not procesada`);
  await sql(`insert into dinero_estrellas (buscador_codigo, estrellas, conteo_ganadoras, fijada_manual, es_prueba)
             values ('${COD}', 4.9, 75, true, true)
             on conflict (buscador_codigo, es_prueba) do update set estrellas=4.9, conteo_ganadoras=75, fijada_manual=true`);
  await sql(`update pago_proteccion_config set activo=true, activo_desde=now()-interval '1 hour',
             colchon_pct=10, colchon_origen='banco', rejilla_efectivo=50, rejilla_chica=20, rejilla_umbral=500
             where es_prueba`);
  const ent = await one(`insert into dinero_entregas (buscador_codigo, monto_original, monto_pendiente, bolsillo, estado, entregado_en, detalle, es_prueba)
             values ('${COD}', 3000, 0, 'efectivo', 'devuelto_especie', now(), 'BANCO-${TAG}', true) returning id`);
  async function vuelta(tag, comision, pagoHecho) {
    const esp = await one(`insert into dinero_esperas (buscador_codigo, tipo, cantidad_esperada, capital_cup, origen, estado, ventana_inicio, ventana_fin, vuelta_ids, datos, es_prueba)
               values ('${COD}', 'saldo', 360, 1000, 'operado_ernesto', 'cumplida', now(), now(), '[]'::jsonb, '{}'::jsonb, true) returning id`);
    ids.esperas.push(esp.id);
    const v = await one(`insert into dinero_vueltas (entrega_id, buscador_codigo, tipo, capital_cup, producto_cantidad, producto_detalle, base_ref360, valor_producto_cup, ganancia_capturada, comision, pago_hecho, pago_en, estado, es_prueba, espera_id)
               values ('${ent.id}', '${COD}', 'saldo', 1000, 360, 'BANCO-${TAG}-${tag}', 1200, 1200, 200, ${comision}, ${pagoHecho}, ${pagoHecho ? "now()" : "null"}, 'abierta', true, '${esp.id}') returning id`);
    ids.vueltas.push(v.id);
    const lote = await one(`insert into dinero_lotes_saldo (cantidad_saldo, cantidad_restante, costo_total_cup, costo_restante_cup, tasa_efectiva, contraparte, es_prueba)
               values (360, 360, 1000, 1000, 2.7778, 'BANCO-${TAG}', true) returning id`);
    ids.lotes.push(lote.id);
    await sql(`update dinero_esperas set vuelta_ids='["${v.id}"]'::jsonb, lote_id='${lote.id}' where id='${esp.id}'`);
    return v.id;
  }
  const vA = await vuelta("A", 64, true);
  const vB = await vuelta("B", 64, false);
  const vC = await vuelta("C", 64, false);
  const liq = async (v) => one(`select * from pago_liquidaciones where vuelta_id='${v}'`);

  // Snapshot del fijo por trigger — números exactos
  const lA = await liq(vA);
  ok("pago: snapshot nace por trigger", !!lA.id);
  eq("pago: pct de estrellas 4.9 = 32", num(lA.pct_estrellas), 32);
  eq("pago: ref protegida = 1200×0.90", num(lA.ref360_protegida), 1080);
  eq("pago: ganancia protegida", num(lA.ganancia_protegida), 80);
  eq("pago: fijo = floor(80×32%)", num(lA.fijo), 25);
  ok("pago: fijo ≤ estimado de papel", num(lA.fijo) <= num(lA.estimado_papel));
  eq("pago: estimado = comisión del parte", num(lA.estimado_papel), 64);

  // Top-up: A ya cobró 64 ≥ fijo → 0 · B aún no cobra su fijo 25 → en efectivo (→40, redondeo 15) · C por transferencia exacta
  const tA = await one(`select public.pago_congelar_fijo('${admin}', '${vA}', 'efectivo') as r`);
  eq("topup A: nada que pagar", num(tA.r.topup.calculado), 0);
  const tB = await one(`select public.pago_congelar_fijo('${admin}', '${vB}', 'efectivo') as r`);
  eq("topup B: calculado intacto", num(tB.r.topup.calculado), 25);
  eq("topup B: redondeo <500 → ×20", num(tB.r.topup.redondeo), 15);
  eq("topup B: pagado redondo", num(tB.r.topup.pagado), 40);
  const lB1 = await liq(vB);
  eq("topup B: fijo_topup_pagado = calculado", num(lB1.fijo_topup_pagado), 25);
  eq("topup B: redondeo acumulado aparte", num(lB1.redondeo_pagado), 15);
  const movRed = await one(`select coalesce(sum(monto),0) as s from dinero_movimientos where es_prueba and tipo='redondeo_pago' and cuenta='cupo:${COD}' and referencia='${vB}'`);
  eq("topup B: línea propia «redondeo_pago» en el libro", num(movRed.s), 15);
  const tC = await one(`select public.pago_congelar_fijo('${admin}', '${vC}', 'transferencia') as r`);
  eq("topup C: transferencia exacta", num(tC.r.topup.pagado), 25);
  eq("topup C: sin redondeo", num(tC.r.topup.redondeo), 0);

  // Venta 1: por debajo de la protegida (ingreso real 1000 < 1080)
  ids.ventasRef.push(`BANCO-${TAG}-V1`);
  const s1 = await one(`select public.pago_registrar_venta_saldo('${admin}', 'BANCO-${TAG}-V1', 360, 327.6, 1.0989, 'banco', true, 'efectivo') as r`);
  ok("venta1: ok", s1.r.ok === true);
  eq("venta1: ingreso real 1000", num(s1.r.ingreso_real360), 1000);
  eq("venta1: premio 0 bajo la protegida", num(s1.r.premio_total), 0);
  const lA2 = await liq(vA);
  eq("venta1: saldo de A vendido", num(lA2.saldo_vendido), 360);
  eq("venta1: fijo de A intacto", num(lA2.fijo), 25);
  const cfg1 = await one(`select colchon_pct from pago_proteccion_config where es_prueba`);
  eq("colchón: UNA observación no mueve nada", num(cfg1.colchon_pct), 10);

  // Venta 2: por encima (ingreso real 1260) → extra 180 → premio 57 → efectivo ×20 = 60 (redondeo 3)
  ids.ventasRef.push(`BANCO-${TAG}-V2`);
  const s2 = await one(`select public.pago_registrar_venta_saldo('${admin}', 'BANCO-${TAG}-V2', 360, 260, 1.3846, 'banco', true, 'efectivo') as r`);
  ok("venta2: ok", s2.r.ok === true);
  eq("venta2: premio = floor(32%×180)", num(s2.r.premio_total), 57);
  const lB2 = await liq(vB);
  eq("venta2: premio calculado intacto en el libro", num(lB2.premio_pagado), 57);
  eq("venta2: redondeo del premio se suma aparte (15+3)", num(lB2.redondeo_pagado), 18);
  ok("invariante: fijo+premio ≤ %×(gan.protegida+extra)",
     num(lB2.fijo) + num(lB2.premio_total) <= num(lB2.pct_estrellas) / 100 * (num(lB2.ganancia_protegida) + num(lB2.extra_acum)) + 0.01);
  const movPrem = await one(`select coalesce(sum(monto),0) as s from dinero_movimientos where es_prueba and tipo='premio_venta' and cuenta='cupo:${COD}' and referencia='${vB}'`);
  eq("venta2: premio asentado en el libro", num(movPrem.s), 57);

  // Idempotencia por referencia
  const s2b = await one(`select public.pago_registrar_venta_saldo('${admin}', 'BANCO-${TAG}-V2', 360, 260, 1.3846, 'banco', true, 'efectivo') as r`);
  eq("idempotencia: segunda vez = ya_existia", s2b.r.ya_existia, true);
  const lB3 = await liq(vB);
  eq("idempotencia: premio no se duplica", num(lB3.premio_total), 57);
  const loteB = await one(`select cantidad_restante from dinero_lotes_saldo where id='${ids.lotes[1]}'`);
  eq("idempotencia: lote no se reconsume", num(loteB.cantidad_restante), 0);

  // Colchón: dos observaciones — el sentido esperado sale de las propias obs
  const obs = await sql(`select desviacion_pct from pago_colchon_observaciones where es_prueba order by creada_en`);
  eq("colchón: dos observaciones registradas", obs.length, 2);
  const cfg2 = await one(`select colchon_pct from pago_proteccion_config where es_prueba`);
  const dirs = obs.map(o => Math.sign(num(o.desviacion_pct) - 10));
  if (dirs[0] !== 0 && dirs[0] === dirs[1]) {
    eq("colchón: dos que acuerdan mueven UN paso", num(cfg2.colchon_pct), 10 + dirs[0] * 0.5);
    const log = await one(`select motivo from pago_colchon_log where es_prueba and motivo='autoajuste_dos_lecturas' order by creado_en desc limit 1`);
    ok("colchón: ajuste con log y porqué", !!log.motivo);
  } else {
    eq("colchón: en conflicto no se mueve", num(cfg2.colchon_pct), 10);
  }

  // Barrido de propiedades del fijo (150 vueltas aleatorias)
  const colchonBarrido = num((await one(`select colchon_pct from pago_proteccion_config where es_prueba`)).colchon_pct);
  await sql(`insert into dinero_vueltas (entrega_id, buscador_codigo, tipo, capital_cup, producto_cantidad, producto_detalle, base_ref360, valor_producto_cup, ganancia_capturada, comision, pago_hecho, estado, es_prueba)
    select '${ent.id}', '${COD}', 'saldo', cap, prod, 'BANCO-${TAG}-SWEEP', ref,
      floor(prod*ref/360), floor(prod*ref/360)-cap,
      case when floor(prod*ref/360)-cap > 0 then floor((floor(prod*ref/360)-cap)*0.32) else 0 end,
      false, 'abierta', true
    from (select (500 + floor(random()*4500))::bigint as cap,
                 (360 * (1 + floor(random()*10)))::numeric as prod,
                 round((900 + random()*500)::numeric, 2) as ref
          from generate_series(1, 150)) g`);
  const sweep = await one(`select count(*) as n,
      count(*) filter (where fijo > estimado_papel) as viola_tope,
      count(*) filter (where fijo <> case when ganancia_protegida > 0
        then least(floor(ganancia_protegida * pct_estrellas / 100.0), estimado_papel) else 0 end) as viola_formula,
      count(*) filter (where abs(ref360_protegida - round(ref360_papel * (1 - ${colchonBarrido}/100.0), 4)) > 0.01) as viola_prot
    from pago_liquidaciones where es_prueba and vuelta_id in
      (select id from dinero_vueltas where producto_detalle = 'BANCO-${TAG}-SWEEP')`);
  eq("barrido: 150 snapshots", num(sweep.n), 150);
  eq("barrido: fijo ≤ estimado siempre", num(sweep.viola_tope), 0);
  eq("barrido: fórmula del fijo exacta", num(sweep.viola_formula), 0);
  eq("barrido: protegida = papel×(1−colchón)", num(sweep.viola_prot), 0);

  // Frontera del buscador
  const mio = await one(`select public.pago_mi_estado('${COD}', true) as r`);
  const mioTxt = JSON.stringify(mio.r);
  ok("frontera: su vista abre con su código", mio.r.ok === true);
  ok("frontera: sin colchón ni protegida ni salida",
     !/colchon|protegida|salida|ref360/i.test(mioTxt));
  const filaB = (mio.r.vueltas || []).find(v => v.vuelta === vB);
  ok("frontera: ve SU fijo, premio y redondeo",
     !!filaB && num(filaB.fijo) === 25 && num(filaB.premio) === 57 && num(filaB.redondeo) === 18);
  const otro = await one(`select public.pago_mi_estado('ABRAHAM-X30', true) as r`);
  ok("frontera: otro buscador no ve vueltas ajenas",
     (otro.r.vueltas || []).every(v => v.vuelta !== vB));
  const malo = await one(`select public.pago_mi_estado('CODIGO-MALO') as r`);
  eq("frontera: código malo cerrado", malo.r.ok, false);

  // Historia real intacta
  const liqReal = await one(`select count(*) as n from pago_liquidaciones where not es_prueba`);
  eq("historia: liquidaciones reales intactas (conteo antes/después)", num(liqReal.n), liqRealAntes);
  const saldoRealDesp = await one(`select public.dinero_saldo('fondo',false) as fondo, public.dinero_saldo('inventario',false) as inv, public.dinero_saldo('gasto',false) as gasto, public.dinero_saldo('cupo:BRIKU-EUX',false) as cupo`);
  eq("historia: saldos reales intactos", saldoRealDesp, saldoRealAntes);
} catch (e) {
  fail++; console.log("ERROR del banco:", e.message);
} finally {
  const limpia = async (q) => { try { await sql(q); } catch (e) { console.log("AVISO limpieza:", e.message.slice(0, 160)); } };
  try {
    const vids = ids.vueltas.length ? `('${ids.vueltas.join("','")}')` : "('')";
    await limpia(`delete from dinero_movimientos where es_prueba and referencia in ${vids}`);
    await limpia(`delete from pago_premio_detalle where liquidacion_id in (select id from pago_liquidaciones where es_prueba)`);
    await limpia(`delete from pago_liquidaciones where es_prueba`);
    await limpia(`delete from pago_colchon_observaciones where es_prueba`);
    await limpia(`delete from pago_colchon_log where es_prueba`);
    await limpia(`delete from pago_ventas_saldo where es_prueba`);
    await limpia(`delete from dinero_vueltas where es_prueba and producto_detalle like 'BANCO-${TAG}%'`);
    if (ids.esperas.length) await limpia(`delete from dinero_esperas where id in ('${ids.esperas.join("','")}')`);
    if (ids.lotes.length) await limpia(`delete from dinero_lotes_cierres where lote_id in ('${ids.lotes.join("','")}')`);
    if (ids.lotes.length) await limpia(`delete from dinero_lotes_saldo where id in ('${ids.lotes.join("','")}')`);
    await limpia(`delete from dinero_entregas where es_prueba and detalle like 'BANCO-%'`);
    await limpia(`delete from dinero_estrellas where buscador_codigo='${COD}' and es_prueba`);
    if (cfgAntes) await limpia(`update pago_proteccion_config set activo=${cfgAntes.activo}, activo_desde=${cfgAntes.activo_desde ? `'${cfgAntes.activo_desde}'` : "null"}, colchon_pct=${cfgAntes.colchon_pct}, colchon_origen='${cfgAntes.colchon_origen}', rejilla_efectivo=${cfgAntes.rejilla_efectivo}, rejilla_chica=${cfgAntes.rejilla_chica}, rejilla_umbral=${cfgAntes.rejilla_umbral} where es_prueba`);
  } catch (e) { console.log("AVISO limpieza:", e.message); }
}
console.log(`\n== prueba-demanda-pago: ${pass} PASS · ${fail} FAIL ==`);
process.exit(fail ? 1 : 0);

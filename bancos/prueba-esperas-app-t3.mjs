// Banco VIVO · T3 Mi Trabajo v1.7.0 — puertas de la app pa las esperas
// (2026-11-14 · CHEQUEO 96). Corre en el carril es_prueba con la cuenta
// de prueba del Ojo (PEUEBA) y LIMPIA lo suyo al final. Sin SUPABASE_PAT
// se salta en silencio, como los demás bancos vivos.
//
// Cubre: esperas_mi_estado (solo lo suyo + su libre) · espera_crear_app
// (el parte con tasa: saldo deriva la cantidad del total ÷ tasa × 360 y
// guarda la tasa por unidad; transferencia deriva con el %) · los
// frenos (tasa 0, total 0, total > su efectivo libre) · la frontera de
// carriles (la espera de prueba no se ve en el carril real) · código
// malo rechazado · pago_mi_estado ejecutable por anon (la app la lee
// con la llave publicable; la puerta valida el código dentro).
import fs from "fs";

const PAT = process.env.SUPABASE_PAT
  || (() => { try { const e = fs.readFileSync(process.env.HOME + "/workspace/.secure/supabase-pat.env", "utf8"); return (e.match(/^SUPABASE_PAT=(.+)$/m) || [])[1].trim(); } catch { return ""; } })();
if (!PAT) { console.log("SKIP vivo: falta SUPABASE_PAT"); process.exit(0); }
const REF = "otsudfgwpapkluusrlnj";
const COD = "PEUEBA";
const TAG = "BANCO-T3-" + Math.floor(Math.random() * 1e6).toString(36).toUpperCase();

let pass = 0, fail = 0;
function ok(c, n) { if (c) { pass++; console.log("PASS", n); } else { fail++; console.log("FAIL", n); } }
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

const ids = { entregas: [], esperas: [] };
try {
  /* Residuos de corridas cortadas de ESTE banco (su marca en detalle). */
  await sql(`delete from dinero_esperas where es_prueba and buscador_codigo='${COD}'
             and id in (select espera_id from dinero_esperas_log where es_prueba and detalle->>'banco'='${TAG}')`).catch(() => {});
  await sql(`delete from dinero_entregas where es_prueba and buscador_codigo='${COD}' and detalle like 'BANCO-T3-%'`).catch(() => {});

  const base = await one(`select count(*) as n from dinero_esperas where not es_prueba`);
  const baseN = num(base.n);

  /* Su efectivo de prueba: una entrega de 10.000 en mano. */
  const ent = await one(`insert into dinero_entregas (buscador_codigo, monto_original, monto_pendiente, bolsillo, estado, entregado_en, detalle, es_prueba)
                         values ('${COD}', 10000, 10000, 'efectivo', 'entregado', now(), '${TAG}', true) returning id`);
  ids.entregas.push(ent.id);

  /* 1 · El parte de saldo con tasa: 4.000 pagados a 1.000 por recarga
         → tienen que llegar 1.440 de saldo; tasa guardada por unidad. */
  const c1 = await one(`select public.espera_crear_app('${COD}', 'saldo', 1000, 4000, null, true) as r`);
  ok(c1.r && c1.r.ok === true && !!c1.r.espera_id, "P1 el parte de saldo crea la espera");
  ok(num(c1.r && c1.r.cantidad_esperada) === 1440, "P2 la cantidad sale del total ÷ tasa × 360 (4.000 ÷ 1.000 × 360 = 1.440)");
  if (c1.r && c1.r.espera_id) ids.esperas.push(c1.r.espera_id);
  const e1 = await one(`select tipo, cantidad_esperada, capital_cup, origen, estado, tasa_pactada, total_pagado_cup, envios_declarados
                        from dinero_esperas where id='${c1.r.espera_id}'`);
  ok(e1.tipo === "saldo" && num(e1.cantidad_esperada) === 1440 && num(e1.capital_cup) === 4000
     && e1.origen === "reporte" && e1.estado === "abierta",
     "P3 la espera nace abierta, origen reporte, con su capital = el total pagado");
  ok(num(e1.tasa_pactada) === 2.7778 && num(e1.total_pagado_cup) === 4000 && num(e1.envios_declarados) === 4,
     "P4 la tasa del parte queda por unidad (1.000 ÷ 360 = 2,7778) y los envíos = las recargas (4)");

  /* 2 · Su estado: la espera se ve, y el libre descuenta lo comprometido. */
  const st = await one(`select public.esperas_mi_estado('${COD}', true) as r`);
  ok(st.r && st.r.ok === true && num(st.r.en_mano) === 10000 && num(st.r.comprometido) === 4000 && num(st.r.libre) === 6000,
     "P5 su estado: en mano 10.000 · comprometido 4.000 · libre 6.000");
  ok(Array.isArray(st.r.esperas) && st.r.esperas.length === 1 && st.r.esperas[0].id === c1.r.espera_id,
     "P6 la lista trae SOLO su espera");
  ok(!("peaje_etecsa" in (st.r.esperas[0] || {})) && !("falta_real" in (st.r.esperas[0] || {})),
     "P7 FRONTERA: la fila no trae peaje ni falta (cocina del dueño)");

  /* 3 · Los frenos. */
  const f1 = await one(`select public.espera_crear_app('${COD}', 'saldo', 0, 1000, null, true) as r`);
  ok(f1.r && f1.r.ok === false && f1.r.motivo === "tasa_invalida", "P8 tasa cero rechazada");
  const f2 = await one(`select public.espera_crear_app('${COD}', 'saldo', 1000, 0, null, true) as r`);
  ok(f2.r && f2.r.ok === false && f2.r.motivo === "total_invalido", "P9 total cero rechazado");
  const f3 = await one(`select public.espera_crear_app('${COD}', 'saldo', 1000, 7000, null, true) as r`);
  ok(f3.r && f3.r.ok === false && f3.r.motivo === "supera_tu_efectivo" && num(f3.r.libre) === 6000,
     "P10 el total que supera su efectivo libre (7.000 > 6.000) se frena con su foto");
  const malas = await one(`select count(*) as n from dinero_esperas where es_prueba and buscador_codigo='${COD}'`);
  ok(num(malas.n) === 1, "P11 ningún freno dejó espera residual");

  /* 4 · El parte de transferencia con %: 2.000 al 30 % → entran 2.600. */
  const c2 = await one(`select public.espera_crear_app('${COD}', 'transferencia', 30, 2000, null, true) as r`);
  ok(c2.r && c2.r.ok === true && num(c2.r.cantidad_esperada) === 2600,
     "P12 transferencia: la cantidad = total × (1 + %/100) (2.000 × 1,30 = 2.600)");
  if (c2.r && c2.r.espera_id) ids.esperas.push(c2.r.espera_id);

  /* 5 · Frontera de carriles y de código. */
  const real = await one(`select public.esperas_mi_estado('${COD}', false) as r`);
  const idsReales = new Set(((real.r && real.r.esperas) || []).map(x => x.id));
  ok(ids.esperas.every(id => !idsReales.has(id)), "P13 la espera de prueba NO se ve en el carril real");
  const malo = await one(`select public.esperas_mi_estado('CODIGO-QUE-NO-EXISTE', true) as r`);
  ok(malo.r && malo.r.ok === false && malo.r.motivo === "codigo_no_valido", "P14 código malo rechazado en la lectura");
  const malo2 = await one(`select public.espera_crear_app('CODIGO-QUE-NO-EXISTE', 'saldo', 1000, 100, null, true) as r`);
  ok(malo2.r && malo2.r.ok === false && malo2.r.motivo === "codigo_no_valido", "P15 código malo rechazado en el parte");

  /* 6 · Mi pago: anon puede ejecutar la puerta (la app la lee así). */
  const priv = await one(`select has_function_privilege('anon', 'public.pago_mi_estado(text,boolean)', 'execute') as puede`);
  ok(priv.puede === true, "P16 pago_mi_estado es ejecutable por anon (valida el código dentro)");
  const pm = await one(`select public.pago_mi_estado('${COD}', true) as r`);
  ok(pm.r && pm.r.ok === true && Array.isArray(pm.r.vueltas), "P17 pago_mi_estado responde con sus vueltas");

  const fin = await one(`select count(*) as n from dinero_esperas where not es_prueba`);
  ok(num(fin.n) === baseN, "P18 la historia real quedó intacta");
} finally {
  if (ids.esperas.length) {
    await sql(`delete from dinero_esperas_log where espera_id in (${ids.esperas.map(i => `'${i}'`).join(",")})`).catch(() => {});
    await sql(`delete from dinero_esperas where id in (${ids.esperas.map(i => `'${i}'`).join(",")})`).catch(() => {});
  }
  if (ids.entregas.length) await sql(`delete from dinero_entregas where id in (${ids.entregas.map(i => `'${i}'`).join(",")})`).catch(() => {});
  const res = await one(`select (select count(*) from dinero_esperas where es_prueba and buscador_codigo='${COD}') as e,
                                (select count(*) from dinero_entregas where es_prueba and buscador_codigo='${COD}' and detalle like 'BANCO-T3-%') as d`);
  console.log("Residuo del banco:", JSON.stringify(res));
}
console.log(`\nBANCO ESPERAS-APP T3 (vivo): ${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);

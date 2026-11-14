// Banco VIVO del SENSOR SMS v3.1 — LA PREGUNTA «¿DE QUIÉN ES?»
// (2026-11-14): la respuesta de buscador en la ruta «sms_respuesta»
// crea la espera operada CON TASA y la asienta contra el SMS (el
// lote nace con costo = total pagado y tasa_efectiva = total ÷
// llegado; peaje −5 como línea propia), la regla del capital manda
// (sin entrega que cubra, NO se asienta y las respuestas quedan pa
// arbitraje), la tasa inválida se rechaza sin crear espera, y la
// respuesta de compra propia de siempre no se movió. Todo es_prueba
// con buscadores reales segregados por es_prueba, LIMPIADO al final
// (finally) por ids recolectados, con el baseline real verificado.
// Sin SUPABASE_PAT / MAXIMO_MASTER_TOKEN se salta en silencio (la
// parte pura vive en prueba-sms-dueno.mjs).
import { randomUUID } from "node:crypto";

const PAT = process.env.SUPABASE_PAT;
const TOKEN = process.env.MAXIMO_MASTER_TOKEN;
if (!PAT || !TOKEN) {
  console.log("SKIP vivo: faltan SUPABASE_PAT / MAXIMO_MASTER_TOKEN");
  process.exit(0);
}
const REF = "otsudfgwpapkluusrlnj";
const CEREBRO = `https://${REF}.supabase.co/functions/v1/maximo-cerebro`;

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
function ok(nombre, cond) { eq(nombre, !!cond, true); }

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: "Bearer " + PAT, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("SQL " + r.status + ": " + t.slice(0, 300));
  return JSON.parse(t || "[]");
}
async function cerebro(body) {
  const r = await fetch(CEREBRO, {
    method: "POST",
    headers: { "x-maximo-token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _status: r.status, _raw: t }; }
}
const one = async (q) => (await sql(q))[0] || {};
const SMS_ETECSA = (monto, tel) =>
  `Usted ha recibido ${monto} CUP del numero ${tel}. Saldo principal 20000.00 CUP, linea activa hasta 2027-10-03, vence 2028-03-31`;

const uuids = [], smsIds = [], esperaIds = [], entregaIds = [];
const U = () => { const u = randomUUID(); uuids.push(u); return u; };

async function entregaPrueba(buscador, monto) {
  const f = await sql(`insert into public.dinero_entregas
    (buscador_codigo, monto_original, monto_pendiente, bolsillo, estado, es_prueba)
    values ('${buscador}', ${monto}, ${monto}, 'efectivo', 'entregado', true)
    returning id`);
  entregaIds.push(f[0].id);
  return f[0].id;
}
async function smsEntrada(monto, tel) {
  const r = await cerebro({
    tipo: "sms", remitente: "ETECSA", cuerpo: SMS_ETECSA(monto, tel),
    prueba: true, client_uuid: U(), fecha_original: new Date().toISOString(),
  });
  if (r.id) smsIds.push(r.id);
  return r;
}

try {
  /* Baseline real (cero producción se toca: todo lo de abajo es
     es_prueba y se verifica contra estas cifras al cerrar). */
  const base = await one(`select
    (select count(*)::int from public.sms_linea) as linea_total,
    (select count(*)::int from public.sms_eventos where not es_prueba) as eventos_reales,
    (select count(*)::int from public.dinero_esperas where not es_prueba) as esperas_reales`);

  /* D1 · Briku: la respuesta asienta la VUELTA con tasa */
  await entregaPrueba("BRIKU-EUX", 20000);
  const d1 = await smsEntrada("720.0", "50000011");
  eq("D1 sin espera previa: pregunta", d1.espera, "sin_match");
  ok("D1 trae entrada_texto", typeof d1.entrada_texto === "string");
  const r1 = await cerebro({
    tipo: "sms_respuesta", sms_id: d1.id,
    dueno_texto: "Es de Briku", tasa: 2.6, total: 1872,
  });
  eq("D1 respuesta asienta la vuelta", [r1.ok, r1.asentado], [true, "vuelta"]);
  if (r1.espera_id) esperaIds.push(r1.espera_id);
  const e1 = await one(`select estado, peaje_etecsa, falta_real, tasa_pactada, total_pagado_cup
    from public.dinero_esperas where id='${r1.espera_id}'`);
  eq("D1 espera cumplida con peaje propio y sin falta",
    [e1.estado, Number(e1.peaje_etecsa), Number(e1.falta_real)], ["cumplida", 5, 0]);
  eq("D1 la espera guarda la tasa y el total declarados",
    [Number(e1.tasa_pactada), e1.total_pagado_cup], [2.6, 1872]);
  const l1 = await one(`select cantidad_saldo, costo_total_cup, tasa_efectiva, contraparte
    from public.dinero_lotes_saldo where sms_id=${d1.id} and es_prueba`);
  eq("D1 lote: costo = total pagado, tasa = total ÷ llegado",
    [Number(l1.cantidad_saldo), l1.costo_total_cup, Number(l1.tasa_efectiva), l1.contraparte],
    [720, 1872, 2.6, "BRIKU-EUX"]);
  const v1 = await one(`select count(*)::int c from public.dinero_vueltas where espera_id='${r1.espera_id}' and es_prueba`);
  eq("D1 una vuelta creada", v1.c, 1);
  const ev1 = await one(`select estado, clasificacion, datos->>'via' as via from public.sms_eventos where sms_id=${d1.id}`);
  eq("D1 evento asentado como vuelta del atajo",
    [ev1.estado, ev1.clasificacion, ev1.via], ["asentado", "devolucion", "atajo_dueno"]);
  const ent1 = await one(`select monto_pendiente from public.dinero_entregas where id='${entregaIds[0]}'`);
  eq("D1 el efectivo en mano baja por el capital", ent1.monto_pendiente, 20000 - 1872);

  /* D2 · idempotencia: la misma respuesta dos veces no duplica */
  const r1b = await cerebro({
    tipo: "sms_respuesta", sms_id: d1.id,
    dueno_texto: "Es de Briku", tasa: 2.6, total: 1872,
  });
  eq("D2 segunda respuesta = ya asentado", r1b.ya, true);
  const v1b = await one(`select count(*)::int c from public.dinero_vueltas where espera_id='${r1.espera_id}' and es_prueba`);
  eq("D2 la vuelta NO se duplica", v1b.c, 1);

  /* D3 · la regla del capital manda: total sin entrega que lo cubra */
  const d3 = await smsEntrada("360.0", "50000012");
  const r3 = await cerebro({
    tipo: "sms_respuesta", sms_id: d3.id,
    dueno_texto: "Es de Briku", tasa: 2.6, total: 999999,
  });
  eq("D3 total imposible: rechazado por capital", [r3.ok, r3.motivo], [false, "capital_supera_pendiente"]);
  const ev3 = await one(`select estado, datos->'respuestas_dueno'->>'buscador' as dueno, datos->>'motivo_dueno' as motivo
    from public.sms_eventos where sms_id=${d3.id}`);
  eq("D3 evento en cola con las respuestas pa arbitraje",
    [ev3.estado, ev3.dueno, ev3.motivo], ["por_clasificar", "BRIKU-EUX", "capital_supera_pendiente"]);
  const e3 = await one(`select count(*)::int c from public.dinero_esperas where es_prueba and total_pagado_cup=999999`);
  eq("D3 ninguna espera residual del intento", e3.c, 0);

  /* D4 · tasa inválida: se rechaza sin crear espera ni asentar */
  const d4 = await smsEntrada("360.0", "50000013");
  const r4 = await cerebro({
    tipo: "sms_respuesta", sms_id: d4.id,
    dueno_texto: "Es de Briku", tasa: 0, total: 936,
  });
  eq("D4 tasa cero rechazada", [r4.ok, r4.motivo], [false, "tasa_invalida"]);
  const ev4 = await one(`select estado from public.sms_eventos where sms_id=${d4.id}`);
  eq("D4 el evento sigue en la cola", ev4.estado, "por_clasificar");
  const l4 = await one(`select count(*)::int c from public.dinero_lotes_saldo where sms_id=${d4.id}`);
  eq("D4 ningún lote nace de la respuesta mala", l4.c, 0);

  /* D5 · Abraham mapea a su código y su entrega */
  await entregaPrueba("ABRAHAM-X30", 20000);
  const d5 = await smsEntrada("720.0", "50000014");
  const r5 = await cerebro({
    tipo: "sms_respuesta", sms_id: d5.id,
    dueno_texto: "Es de Abraham", tasa: 2.5, total: 1800,
  });
  eq("D5 abraham asienta su vuelta", [r5.ok, r5.asentado], [true, "vuelta"]);
  if (r5.espera_id) esperaIds.push(r5.espera_id);
  const l5 = await one(`select contraparte, tasa_efectiva from public.dinero_lotes_saldo where sms_id=${d5.id} and es_prueba`);
  eq("D5 lote de Abraham con su tasa", [l5.contraparte, Number(l5.tasa_efectiva)], ["ABRAHAM-X30", 2.5]);

  /* D6 · regresión: la compra propia por sms_respuesta no se movió */
  const d6 = await smsEntrada("2000.0", "50000015");
  const r6 = await cerebro({ tipo: "sms_respuesta", sms_id: d6.id, total: 2500 });
  eq("D6 compra propia asienta como siempre", r6.ok, true);
  const l6 = await one(`select cantidad_saldo, costo_total_cup from public.dinero_lotes_saldo where sms_id=${d6.id} and es_prueba`);
  eq("D6 lote propio con el total confirmado", [Number(l6.cantidad_saldo), l6.costo_total_cup], [2000, 2500]);

  /* Baseline real intacto tras los escenarios */
  const desp = await one(`select
    (select count(*)::int from public.sms_linea) as linea_total,
    (select count(*)::int from public.sms_eventos where not es_prueba) as eventos_reales,
    (select count(*)::int from public.dinero_esperas where not es_prueba) as esperas_reales`);
  eq("BASELINE real intacto (línea/eventos/esperas reales)",
    [desp.linea_total - smsIds.length, desp.eventos_reales, desp.esperas_reales],
    [base.linea_total - 0, base.eventos_reales, base.esperas_reales]);
} finally {
  /* LIMPIEZA por ids recolectados, en orden de dependencias (el
     mismo orden del banco de vueltas vivo). Solo es_prueba. */
  const idsSms = smsIds.length ? smsIds.join(",") : "null";
  const idsUuid = uuids.length ? uuids.map((u) => `'${u}'`).join(",") : "''";
  const idsEsp = esperaIds.length ? esperaIds.map((u) => `'${u}'`).join(",") : "''";
  const idsEnt = entregaIds.length ? entregaIds.map((u) => `'${u}'`).join(",") : "''";
  const cleanup = [
    `update public.sms_eventos set lote_id = null where sms_id in (${idsSms})`,
    `update public.dinero_esperas set lote_id = null, sms_id = null where id in (${idsEsp})`,
    `delete from public.pago_liquidaciones where es_prueba and vuelta_id in (select id from public.dinero_vueltas where espera_id in (${idsEsp}))`,
    `delete from public.dinero_movimientos where es_prueba and (referencia in (select id::text from public.dinero_vueltas where espera_id in (${idsEsp})) or referencia in (select id::text from public.sms_linea where id in (${idsSms})))`,
    `delete from public.dinero_devoluciones where es_prueba and vuelta_id in (select id from public.dinero_vueltas where espera_id in (${idsEsp}))`,
    `delete from public.dinero_vueltas where es_prueba and espera_id in (${idsEsp})`,
    `delete from public.dinero_lotes_saldo where es_prueba and sms_id in (${idsSms})`,
    `delete from public.sms_eventos where sms_id in (${idsSms})`,
    `delete from public.sms_ingesta where client_uuid in (${idsUuid})`,
    `delete from public.dinero_esperas_log where es_prueba and espera_id in (${idsEsp})`,
    `delete from public.dinero_esperas where id in (${idsEsp})`,
    `delete from public.dinero_entregas where id in (${idsEnt})`,
    `delete from public.sms_linea where id in (${idsSms})`,
  ];
  for (const q of cleanup) {
    try { await sql(q); } catch (e) { console.log("LIMPIEZA aviso:", String(e).slice(0, 160)); }
  }
  const resto = await one(`select
    (select count(*) from public.sms_linea where id in (${idsSms})) +
    (select count(*) from public.sms_ingesta where client_uuid in (${idsUuid})) +
    (select count(*) from public.dinero_esperas where id in (${idsEsp})) +
    (select count(*) from public.dinero_entregas where id in (${idsEnt})) as total`);
  eq("LIMPIEZA: residuo cero de la corrida", resto.total, 0);
}

console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);

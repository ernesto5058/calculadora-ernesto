// Banco del DRENAJE v3.2 del sensor «Máximo SMS» (2026-11-14):
// el contrato EXACTO que manda el atajo v3.2 al sincronizar su cola —
// UNA llamada «sms» por archivo con las respuestas recogidas ANIDADAS
// (el cerebro las aplica en la misma pasada) y la basura sin cuerpo
// rechazada sin dejar filas. Todo es_prueba, con limpieza por ids.
// Sin SUPABASE_PAT / MAXIMO_MASTER_TOKEN se salta en silencio.
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
async function cerebroCrudo(body) {
  const r = await fetch(CEREBRO, {
    method: "POST",
    headers: { "x-maximo-token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { /* cuerpo no JSON */ }
  return { status: r.status, j };
}
async function cerebro(body) { return (await cerebroCrudo(body)).j || {}; }
const one = async (q) => (await sql(q))[0] || {};

const ENTRADA = (monto, tel) =>
  `Usted ha recibido ${monto} CUP del numero ${tel}. Saldo principal 20000.00 CUP, linea activa hasta 2027-10-03, vence 2028-03-31`;
const SALIDA = (monto, tel) =>
  `Usted ha transferido ${monto} CUP al número ${tel}. Saldo principal 19000.00 CUP, linea activa hasta 2027-10-03, vence 2028-03-31`;

const uuids = [], smsIds = [];
const U = () => { const u = randomUUID(); uuids.push(u); return u; };
// La forma de la llamada del drenaje v3.2: el evento del archivo +
// «respuestas» anidadas con los campos recogidos en local.
const drenaje = (cuerpo, resp) => ({
  tipo: "sms", remitente: "ETECSA", cuerpo, prueba: true,
  client_uuid: U(), fecha_original: new Date().toISOString(),
  respuestas: resp,
});
const RESP_VACIAS = { forma_texto: "", eleccion_texto: "", numero: "", total: "", qusd: "" };

try {
  const base = await one(`select
    (select count(*)::int from public.sms_linea) as linea_total,
    (select count(*)::int from public.sms_eventos where not es_prueba) as eventos_reales,
    (select count(*)::int from public.dinero_lotes_saldo where es_prueba) as lotes_prueba`);

  /* P1 · drenaje de COMPRA PROPIA: el total viaja anidado y el
     cerebro asienta la compra en la MISMA llamada (sin entrada_texto). */
  const p1 = await cerebro(drenaje(ENTRADA("360.0", "50000021"),
    { ...RESP_VACIAS, forma_texto: "Total que pagué", total: "1000" }));
  if (p1.id) smsIds.push(p1.id);
  eq("P1 asentado inline como compra", p1.asentado, "compra");
  ok("P1 sin entrada_texto (ya no hay pregunta)", typeof p1.entrada_texto !== "string");
  const l1 = await one(`select costo_total_cup from public.dinero_lotes_saldo where sms_id=${p1.id} and es_prueba`);
  eq("P1 lote con el total confirmado", l1.costo_total_cup, 1000);

  /* P2 · drenaje de SALIDA: la clase viaja anidada y asienta. */
  const p2 = await cerebro(drenaje(SALIDA("360.0", "50000022"),
    { ...RESP_VACIAS, eleccion_texto: "Devolución de capital" }));
  if (p2.id) smsIds.push(p2.id);
  eq("P2 asentado inline como devolución", p2.asentado, "devolucion");
  ok("P2 sin salida_texto", typeof p2.salida_texto !== "string");

  /* P3 · el archivo de BUSCADOR en su paso 1: respuestas vacías
     (su totalb NO viaja en esta llamada) — llega, NO se asienta
     a ciegas y la pregunta queda viva pa su «sms_respuesta». */
  const p3 = await cerebro(drenaje(ENTRADA("720.0", "50000023"), RESP_VACIAS));
  if (p3.id) smsIds.push(p3.id);
  ok("P3 trae id", Number(p3.id) > 0);
  ok("P3 trae entrada_texto (pregunta viva)", typeof p3.entrada_texto === "string");
  ok("P3 nada asentado a ciegas", typeof p3.asentado !== "string");

  /* P4 · BASURA (la clase de los archivos envenenados de la v3.1):
     cuerpo vacío = rechazo en la puerta, CERO filas nuevas. */
  const uBasura = U();
  const p4 = await cerebroCrudo({
    tipo: "sms", remitente: "ETECSA", cuerpo: "", prueba: true,
    client_uuid: uBasura, fecha_original: new Date().toISOString(),
  });
  eq("P4 cuerpo vacío rechazado (400)", p4.status, 400);
  const filasBasura = await one(`select
    (select count(*)::int from public.sms_ingesta where client_uuid='${uBasura}') as ing,
    (select count(*)::int from public.sms_linea where client_uuid='${uBasura}') as lin`);
  eq("P4 cero filas de la basura", [filasBasura.ing, filasBasura.lin], [0, 0]);

  /* P5 · REENVÍO del mismo archivo (dedup duro): el mismo
     client_uuid devuelve el resultado original y no duplica. */
  const cuerpoP5 = ENTRADA("360.0", "50000025");
  const uuidP5 = U();
  const p5a = await cerebro({
    tipo: "sms", remitente: "ETECSA", cuerpo: cuerpoP5, prueba: true,
    client_uuid: uuidP5, fecha_original: new Date().toISOString(),
    respuestas: { ...RESP_VACIAS, forma_texto: "Total que pagué", total: "1000" },
  });
  if (p5a.id) smsIds.push(p5a.id);
  const p5b = await cerebro({
    tipo: "sms", remitente: "ETECSA", cuerpo: cuerpoP5, prueba: true,
    client_uuid: uuidP5, fecha_original: new Date().toISOString(),
    respuestas: { ...RESP_VACIAS, forma_texto: "Total que pagué", total: "1000" },
  });
  eq("P5 reenvío = duplicado con el mismo id", [p5b.duplicado, p5b.id], [true, p5a.id]);

  /* LIMPIEZA por ids recolectados */
  const idsSms = smsIds.join(",") || "0";
  const idsUuid = uuids.map((u) => `'${u}'`).join(",");
  for (const q of [
    `update public.sms_eventos set lote_id = null where sms_id in (${idsSms})`,
    `delete from public.dinero_movimientos where es_prueba and referencia in (select id::text from public.dinero_lotes_saldo where sms_id in (${idsSms}))`,
    `delete from public.dinero_lotes_saldo where es_prueba and sms_id in (${idsSms})`,
    `delete from public.sms_eventos where sms_id in (${idsSms})`,
    `delete from public.sms_ingesta where client_uuid in (${idsUuid})`,
    `delete from public.sms_linea where id in (${idsSms})`,
  ]) {
    try { await sql(q); } catch (e) { console.log("LIMPIEZA aviso:", String(e).slice(0, 160)); }
  }
  const fin = await one(`select
    (select count(*)::int from public.sms_linea) as linea_total,
    (select count(*)::int from public.sms_eventos where not es_prueba) as eventos_reales,
    (select count(*)::int from public.dinero_lotes_saldo where es_prueba) as lotes_prueba`);
  eq("BASELINE intacto tras la corrida", fin, base);
} catch (e) {
  fail++;
  console.log("ERROR del banco:", String(e).slice(0, 300));
}
console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);

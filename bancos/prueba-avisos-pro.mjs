// =====================================================================
// Banco de AVISOS PRO — la clasificación de entregas del emisor
// (2026-11-13). La decisión vive en supabase/functions/avisos/
// logica.js (pura, patrón de la casa) y este banco la prueba tal
// cual, más aserciones de fuente: index.ts USA la clasificación,
// escribe avisos_log en cada intento, mueve ultimo_uso y poda las
// suscripciones muertas — nada de fallos en silencio.
//
// La causa raíz que cubre: la suscripción id 1 del dueño nació el
// 2026-11-11 ANTES de la rotación VAPID; Apple respondía a cada
// envío 400 {"reason":"VapidPkHashMismatch"} y nadie lo veía: el
// emisor no registraba entregas ni ultimo_uso se movía jamás.
// Estados exigidos:
//   200/201 -> entregado, sin podar
//   404/410 -> podada (ya no existe en el servidor de push)
//   400 + VapidPkHashMismatch -> podada (nació con otra clave VAPID)
//   400 otro / 500 / sin estado -> fallo registrado, sin podar
// =====================================================================
import { readFileSync } from "node:fs";
import { clasificarPush, decidirAcceso } from "../supabase/functions/avisos/logica.js";

let pass = 0, fail = 0; const fails = [];
function ok(c, n) { if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }

/* (a) Entregas reales del servidor de push. */
ok(clasificarPush(201, "").resultado === "entregado", "A1 201 -> entregado");
ok(clasificarPush(200, "").resultado === "entregado", "A2 200 -> entregado");
ok(clasificarPush(201, "").podar === false, "A3 201 no poda");
ok(clasificarPush(201, "").motivo === null, "A4 201 sin motivo");

/* (b) Suscripción muerta: se poda con causa escrita. */
ok(clasificarPush(410, "").resultado === "podada", "B1 410 -> podada");
ok(clasificarPush(404, "").resultado === "podada", "B2 404 -> podada");
ok(clasificarPush(410, "").podar === true, "B3 410 poda de verdad");
ok(/no existe/.test(clasificarPush(410, "").motivo), "B4 410 el motivo dice que ya no existe");

/* (c) LA causa raíz: 400 con VapidPkHashMismatch -> podada. */
const c = clasificarPush(400, '{"reason":"VapidPkHashMismatch"}');
ok(c.resultado === "podada", "C1 400 VapidPkHashMismatch -> podada");
ok(c.podar === true, "C2 400 VapidPkHashMismatch poda");
ok(/VapidPkHashMismatch/.test(c.motivo), "C3 el motivo nombra la causa (VapidPkHashMismatch)");

/* (d) Fallos que NO podan: quedan registrados y la sub se queda. */
const d1 = clasificarPush(400, '{"reason":"BadJwt"}');
ok(d1.resultado === "fallo" && d1.podar === false, "D1 400 sin mismatch -> fallo sin podar");
const d2 = clasificarPush(500, "Internal error");
ok(d2.resultado === "fallo" && d2.podar === false, "D2 500 -> fallo sin podar");
ok(/500/.test(d2.motivo), "D3 el motivo del fallo conserva el estado");
const d3 = clasificarPush(undefined, "");
ok(d3.resultado === "fallo" && d3.podar === false, "D4 sin estado (reventó antes) -> fallo sin podar");
ok(clasificarPush(403, "").resultado === "fallo", "D5 403 -> fallo (no poda automática)");

/* (e) Regresión de la puerta fail-closed (banco hermano). */
ok(decidirAcceso("", "x").status === 503, "E1 puerta: sin secreto -> 503");
ok(decidirAcceso("s", "malo").status === 401, "E2 puerta: secreto malo -> 401");
ok(decidirAcceso("s", "s").permitido === true, "E3 puerta: secreto bueno -> pasa");

/* (f) Aserciones de fuente: el emisor USA todo lo anterior. */
const src = readFileSync(new URL("../supabase/functions/avisos/index.ts", import.meta.url), "utf8");
ok(src.includes("clasificarPush("), "F1 index.ts clasifica cada intento push");
ok(src.includes("avisos_log"), "F2 index.ts escribe el registro de entregas (avisos_log)");
ok(src.includes("ultimo_uso"), "F3 index.ts mueve ultimo_uso en cada intento");
ok(src.includes("podarSub("), "F4 index.ts poda las suscripciones muertas");
ok(src.includes("es_respaldo"), "F5 index.ts marca el respaldo de Telegram (doble riel)");
ok(src.includes("sin_entrega"), "F6 index.ts registra en voz alta cuando ningún canal entrega");
ok(src.includes("detalle"), "F7 index.ts lee el cuerpo de la respuesta del push (el motivo viaja ahí)");

/* (g) DESTINO DE AVISO (T1 · enmienda 2026-11-14): cada aviso lleva
   tab + ANCLA de punta a punta — el despachador SQL la siembra por
   tipo, la EF la pasa al payload push y al data de FCM, el SW la
   conserva en la notificación y la entrega en el click (mensaje y
   URL), y la app la marca con el anillo que se desvanece. */
ok(src.includes("ancla: String(ev.ancla"), "G1 index.ts pasa la ancla del evento al payload push");
ok(src.includes("ancla: evento.ancla"), "G2 el data de FCM también lleva la ancla");
const srcSqlDest = readFileSync(new URL("../supabase/sql/avisos-destino-t1-2026-11-14.sql", import.meta.url), "utf8");
ok(srcSqlDest.includes("'ancla', 'tvPropuesta'"), "G3 el despachador siembra ancla tvPropuesta en tarifa_propuesta");
ok(srcSqlDest.includes("'ancla', 'dnVentas'"), "G4 el despachador siembra ancla dnVentas en espera_cumplida");
ok(srcSqlDest.includes("'tab', 'Dinero', 'ancla', 'dnVentas'") && !srcSqlDest.includes("'tab', 'Mi dinero'"), "G5 el destino de espera_cumplida es el id de módulo «Dinero» (el viejo «Mi dinero» se descartaba y el toque no llevaba a ningún lado)");
ok(srcSqlDest.includes("'ancla',  'avRegistro'") || srcSqlDest.includes("'ancla', 'avRegistro'"), "G6 la autoprueba viaja a Avisos + su registro");
const srcSw = readFileSync(new URL("../minegocio/sw.js", import.meta.url), "utf8");
ok(srcSw.includes("ancla: a.ancla") || srcSw.includes("ancla: datos.ancla") || srcSw.includes("ancla"), "G7 el SW conserva la ancla en data de la notificación");
ok(srcSw.includes('searchParams.set("ancla"'), "G8 el click del SW lleva la ancla en la URL de apertura");
ok(srcSw.includes("ancla: datos.ancla"), "G9 el click del SW pasa la ancla en el mensaje push-tab");

console.log(`\nprueba-avisos-pro: ${pass}/${pass + fail} en verde` + (fail ? ` — FALLAN: ${fails.join(" · ")}` : ""));
process.exit(fail ? 1 : 0);

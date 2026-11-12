// =====================================================================
// Banco de la PUERTA del AGENTE — decisiones puras de puerta.js
// (TANDA Nº4 Inspector Ola 1: E1/E2/E5/E6 + faltante F4).
// index.ts es Deno/TS con IO; la decisión vive en puerta.js (puro,
// patrón de logica.js) y este banco la prueba tal cual, más unas
// aserciones de fuente sobre index.ts (la puerta USA la decisión).
// =====================================================================
import { readFileSync } from "node:fs";
import * as P from "../supabase/functions/agente-responder/puerta.js";

let pass = 0, fail = 0; const fails = [];
function ok(c, n) { if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }

const AHORA = Date.parse("2026-11-12T15:00:00.000Z");
const H = 3600 * 1000;
const hace = (h) => new Date(AHORA - h * H).toISOString();
const serie = (n, h) => Array.from({ length: n }, () => hace(h));

/* ============ (a) E1 — tope de sesión: ventana 24 h + dueño exento == */
ok(P.conteoEnVentana24h(serie(40, 25), AHORA) === 0, "E1-1 40 mensajes de hace 25 h: conteo en ventana = 0");
ok(P.conteoEnVentana24h(serie(40, 2), AHORA) === 40, "E1-2 40 mensajes de hace 2 h: conteo en ventana = 40");
ok(P.sesionBloqueada({ fechas: serie(40, 25), tope: 40, ahora: AHORA }) === false,
  "E1-3 conversación con 40 mensajes de hace 25 h → NO bloqueada");
ok(P.sesionBloqueada({ fechas: serie(40, 2), tope: 40, ahora: AHORA }) === true,
  "E1-4 conversación con 40 mensajes en 24 h → bloqueada");
ok(P.sesionBloqueada({ fechas: serie(40, 2), tope: 40, esDueno: true, ahora: AHORA }) === false,
  "E1-5 dueño con 40 mensajes en 24 h → NO bloqueado");
ok(P.sesionBloqueada({ conteo: 40, tope: 40 }) === true, "E1-6 conteo ya filtrado en 40 → bloqueada");
ok(P.sesionBloqueada({ conteo: 39, tope: 40 }) === false, "E1-7 conteo ya filtrado en 39 → pasa");
ok(P.inicioVentana24h(AHORA) === new Date(AHORA - 24 * H).toISOString(),
  "E1-8 inicioVentana24h = ahora − 24 h exacto");

/* ============ (b) E2 — tope global diario de conversaciones nuevas == */
ok(P.debeDegradarPorTopeDiario({ conteoHoy: 100, tope: 100, esNueva: true }) === true,
  "E2-1 contador diario en 100 (tope 100) → degrada");
ok(P.debeDegradarPorTopeDiario({ conteoHoy: 99, tope: 100, esNueva: true }) === false,
  "E2-2 contador diario en 99 → pasa");
ok(P.debeDegradarPorTopeDiario({ conteoHoy: 100, tope: 100, esDueno: true, esNueva: true }) === false,
  "E2-3 dueño con el contador en 100 → jamás degradado");
ok(P.debeDegradarPorTopeDiario({ conteoHoy: 100, tope: 100, esNueva: false }) === false,
  "E2-4 conversación EXISTENTE con el contador en 100 → no degrada");
ok(P.topeDiarioAlcanzado(100, 100) === true && P.topeDiarioAlcanzado(99, 100) === false,
  "E2-5 topeDiarioAlcanzado: borde exacto 99/100");
{
  // Propiedad (sin fijar el desplazamiento: la tzdata del sistema
  // manda): el inicio cae a las 00:00 habaneras del día habanero de
  // AHORA, no es futuro y dista menos de 24 h + 1 h de cambio horario.
  const ini = P.inicioDiaHabanaISO(new Date(AHORA));
  const horaHab = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Havana", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ini));
  const dist = AHORA - Date.parse(ini);
  ok(P.fechaHabana(new Date(ini)) === "2026-11-12" && horaHab === "00:00" && dist >= 0 && dist < 25 * H,
    "E2-6 inicio del día habanero = medianoche habanera de hoy (propiedad, tzdata del sistema)");
}
ok(P.avisosDuenoPermitidos({ conteoHoy: 20, tope: 20 }) === false,
  "E2-7 avisos al dueño: en el tope diario ya no se manda más");
ok(P.avisosDuenoPermitidos({ conteoHoy: 19, tope: 20 }) === true,
  "E2-8 avisos al dueño: uno por debajo del tope → se manda");
ok(P.avisosDuenoPermitidos({ conteoHoy: 20, tope: 20, esDueno: true }) === true,
  "E2-9 avisos: el dueño queda exento del tope");

/* ============ (c) E6 — escalado con caducidad de 24 h ================ */
ok(P.escaladoCaducado({ escalada: true, ultimoEn: hace(25), ahora: AHORA }) === true,
  "E6-1 escalada con ultimo_en de hace 25 h → reabre");
ok(P.escaladoCaducado({ escalada: true, ultimoEn: hace(2), ahora: AHORA }) === false,
  "E6-2 escalada con ultimo_en de hace 2 h → sigue muda");
ok(P.escaladoCaducado({ escalada: false, ultimoEn: hace(25), ahora: AHORA }) === false,
  "E6-3 no escalada → nunca «caduca»");
ok(P.escaladoCaducado({ escalada: true, ultimoEn: null, ahora: AHORA }) === false,
  "E6-4 sin ultimo_en legible → no se reabre a ciegas");

/* ============ (d) E5 — config ilegible → silencio (fail-closed) ====== */
ok(P.decisionPorConfig({ ok: false, fila: null }) === "silencio",
  "E5-1 config ilegible (falló la lectura) → decisión «silencio»");
ok(P.decisionPorConfig({ ok: true, fila: null }) === "silencio",
  "E5-2 config vacía (sin fila) → decisión «silencio»");
ok(P.decisionPorConfig({ ok: true, fila: {} }) === "silencio",
  "E5-3 config en {} → decisión «silencio»");
ok(P.decisionPorConfig({ ok: true, fila: { detenido: false, tope_conversaciones_dia: 100 } }) === "seguir",
  "E5-4 config leída con fila real → «seguir»");

/* ============ Fuente: index.ts USA estas decisiones ================== */
const src = readFileSync(new URL("../supabase/functions/agente-responder/index.ts", import.meta.url), "utf8");
ok(src.includes('from "./puerta.js"'), "F-1 index.ts importa puerta.js");
ok(src.includes("creado_en=gte.") && src.includes("inicioVentana24h()"), "F-2 E1: la consulta de mensajes filtra por creado_en en la ventana de 24 h");
ok(!src.includes("Ya te atendí bastante por hoy"), "F-3 E1: fuera el texto «por hoy» (mentía: era de por vida)");
ok(src.includes("últimas 24 horas"), "F-4 E1: el texto al cliente dice la ventana real");
ok(src.includes("tope_conversaciones_dia") && src.includes("debeDegradarPorTopeDiario"), "F-5 E2: la puerta implementa el tope global diario de config");
ok(src.includes("aviso_escalado") && src.includes("aviso_lead") && src.includes("avisosDuenoPermitidos"), "F-6 E2: avisos de escalado/lead con tope diario contado en agente_acciones");
ok(src.includes("decisionPorConfig") && src.includes("config_ilegible"), "F-7 E5: fail-closed de config en procesar");
ok(src.includes("!webKey") && src.includes("web_no_configurada"), "F-8 E5: sin AGENTE_WEB_KEY la web se rechaza (fail-closed)");
ok(!src.includes("if (webKey &&"), "F-9 E5: fuera el patrón fail-open de la clave web");
ok(src.includes("escaladoCaducado") && src.includes("escalado_caducado") && src.includes("escalada: false"), "F-10 E6: reapertura del escalado caducado registrada en agente_acciones");


/* ============ TANDA Nº6 — F1 no-texto + fuentes E9/F2/F3 ============ */
ok(P.respuestaNoTextoTelegram({ voice: { duration: 3 } })?.tipo === "audio", "F1-1 nota de voz -> tipo audio con guía");
ok(/no puedo escucharlo/.test(P.respuestaNoTextoTelegram({ voice: {} })?.texto ?? ""), "F1-2 el texto de voz pide escribir, no silencio");
ok(P.respuestaNoTextoTelegram({ photo: [{ file_id: "x" }] })?.tipo === "foto", "F1-3 foto -> tipo foto");
ok(P.respuestaNoTextoTelegram({ location: { latitude: 20, longitude: -75 } })?.tipo === "ubicacion", "F1-4 ubicación -> tipo ubicacion");
ok(P.respuestaNoTextoTelegram({ sticker: {} })?.tipo === "sticker", "F1-5 sticker -> tipo sticker");
ok(P.respuestaNoTextoTelegram({ text: "hola" }) === null, "F1-6 un mensaje CON texto no entra en la guía no-texto");
ok(P.respuestaNoTextoTelegram({})?.tipo === "otro", "F1-7 mensaje sin texto ni tipo conocido -> guía genérica, jamás silencio");
ok(src.includes("respuestaNoTextoTelegram") && src.includes("telegram_no_texto"), "F1-8 index.ts usa la guía no-texto y la registra sin crear conversación");
ok(src.includes("pregunta: enmascarar(e.texto)") && src.includes("texto: enmascarar(m.texto)"), "E9-F1 index.ts enmascara pregunta e historial ANTES del cerebro");
ok(src.includes("agente_ensenar_responder") && src.includes("dueno_ensenar"), "F2-F1 index.ts ejecuta la creación por la RPC agente_ensenar_responder");
ok(src.includes("agente_pendientes") && src.includes("pendientesSinRespuesta"), "F2-F2 index.ts carga la cola de sin-respuesta pa el panel");
ok(src.includes("contacto: dec.cita.contacto"), "F3-F1 index.ts guarda el contacto de la cita en su columna");

console.log(`\nprueba-agente-puerta: ${pass} PASS · ${fail} FAIL`);
if (fail) { console.log("Fallos:", fails.join(" | ")); process.exit(1); }

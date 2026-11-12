// =====================================================================
// Edge Function «agente-responder» — la PUERTA del Agente Propio.
// Plano v1 + adenda v2 (sin vigía) + estudio del algoritmo.
// ---------------------------------------------------------------------
// Canales (cuerpos):
//   · web      — burbuja de chat de la paginita. Header x-agente-key
//                con la clave PÚBLICA de visitante; los límites reales
//                viven aquí (topes de agente_config).
//   · telegram — el bot de CLIENTES (F1a): webhook con su secreto
//                propio (x-telegram-bot-api-secret-token contra
//                AGENTE_TG_SECRET) y su token propio
//                (AGENTE_TG_BOT_TOKEN), que Ernesto creará en
//                BotFather. Sin token, la puerta registra y no envía.
//   · interno  — pg_cron horario con header x-agente-cron
//                (AGENTE_CRON_SECRET, espejo del de Vault): ejecuta el
//                agrupador determinista y el aviso de umbral (máx 1/día,
//                por la función «avisos»: es código, no una vigía).
// TODA la decisión vive en logica.js (puro, con banco). Esta puerta
// solo hace IO: lee los datos VIVOS, guarda el registro enmascarado,
// ejecuta la decisión y avisa a Ernesto por «avisos» cuando toca.
// La tarifa interna se lee SOLO para construir la lista PROHIBIDA
// del verificador (barrido PT-4): jamás entra en una respuesta.
// SECRETOS (Edge Functions -> Secrets; nunca en el repo):
//   AGENTE_WEB_KEY · AGENTE_TG_SECRET · AGENTE_TG_BOT_TOKEN (futuro)
//   AGENTE_CRON_SECRET · AVISOS_WEBHOOK_SECRET (el del proyecto)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (la plataforma)
// =====================================================================

import {
  clasificarSiguiente,
  enmascarar,
  formaGrupo,
  normalizar,
  orquestar,
  panelVista,
  proyeccionPublica,
  resolverAclaracion,
  similitudTrgm,
  validarRespuestaCerebro,
} from "./logica.js";
import { crearCerebro } from "./cerebro.ts";

type Env = (k: string) => string | undefined;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });

function cabecerasSrv(env: Env): Record<string, string> {
  const k = env("SUPABASE_SERVICE_ROLE_KEY") || "";
  return { apikey: k, Authorization: "Bearer " + k, "Content-Type": "application/json" };
}
async function leerTabla(env: Env, tabla: string, query: string): Promise<Record<string, unknown>[]> {
  try {
    const r = await fetch((env("SUPABASE_URL") || "") + "/rest/v1/" + tabla + "?" + query,
      { headers: cabecerasSrv(env), signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    return await r.json() as Record<string, unknown>[];
  } catch { return []; }
}
async function insertar(env: Env, tabla: string, fila: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch((env("SUPABASE_URL") || "") + "/rest/v1/" + tabla, {
      method: "POST",
      headers: { ...cabecerasSrv(env), Prefer: "return=representation" },
      body: JSON.stringify(fila),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const j = await r.json() as Record<string, unknown>[];
    return j[0] ?? null;
  } catch { return null; }
}
async function parche(env: Env, tabla: string, filtro: string, cambios: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch((env("SUPABASE_URL") || "") + "/rest/v1/" + tabla + "?" + filtro, {
      method: "PATCH", headers: cabecerasSrv(env), body: JSON.stringify(cambios),
      signal: AbortSignal.timeout(15000),
    });
    return r.ok;
  } catch { return false; }
}
async function rpc(env: Env, fn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const r = await fetch((env("SUPABASE_URL") || "") + "/rest/v1/rpc/" + fn, {
      method: "POST", headers: cabecerasSrv(env), body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return { ok: false };
    return await r.json() as Record<string, unknown>;
  } catch { return { ok: false }; }
}

/* Aviso a Ernesto por la función «avisos» (Telegram + push). */
async function avisar(env: Env, ev: Record<string, unknown>): Promise<void> {
  try {
    await fetch((env("SUPABASE_URL") || "") + "/functions/v1/avisos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secreto: env("AVISOS_WEBHOOK_SECRET") || "",
        para: "ADMIN", ...ev,
      }),
      signal: AbortSignal.timeout(20000),
    });
  } catch { /* el aviso nunca rompe la atención al cliente */ }
}

async function accion(env: Env, tipo: string, detalle: Record<string, unknown>): Promise<void> {
  await insertar(env, "agente_acciones", { tipo, detalle });
}

/* --- Carga de datos VIVOS (read-through: nada de copias) ------------- */
interface Datos {
  config: Record<string, unknown>;
  catalogo: Map<string, Record<string, unknown>>;
  fuente: Map<string, { valor: unknown; actualizado_en: string }>;
  faqs: Record<string, unknown>[];
  sinonimos: Record<string, unknown>[];
  prohibidas: string[];
}
async function cargarDatos(env: Env): Promise<Datos> {
  const [cfg, cat, fue, faqs, pats, sin, tar] = await Promise.all([
    leerTabla(env, "agente_config", "id=eq.1&select=*"),
    leerTabla(env, "agente_catalogo", "activo=eq.true&select=*"),
    leerTabla(env, "agente_fuente", "select=*"),
    leerTabla(env, "agente_faq", "estado=eq.activa&select=*"),
    leerTabla(env, "agente_patrones", "select=faq_id,patron_norm"),
    leerTabla(env, "agente_sinonimos", "select=*"),
    leerTabla(env, "tarifa", "id=eq.1&select=salida_ref,libro_ref,ingreso_ref360"),
  ]);
  const porFaq = new Map<string, string[]>();
  for (const p of pats) {
    const arr = porFaq.get(String(p.faq_id)) ?? [];
    arr.push(String(p.patron_norm));
    porFaq.set(String(p.faq_id), arr);
  }
  const prohibidas: string[] = [];
  const t = tar[0];
  if (t) for (const k of ["salida_ref", "libro_ref", "ingreso_ref360"]) {
    if (t[k] != null) prohibidas.push(String(t[k]));
  }
  return {
    config: cfg[0] ?? {},
    catalogo: new Map(cat.map((c) => [String(c.clave), c])),
    fuente: new Map(fue.map((f) => [String(f.clave), { valor: f.valor, actualizado_en: String(f.actualizado_en) }])),
    faqs: faqs.map((f) => ({ ...f, patrones: porFaq.get(String(f.id)) ?? [] })),
    sinonimos: sin,
    prohibidas,
  };
}

/* --- Conversación ------------------------------------------------------ */
async function buscarOCrearConv(env: Env, canal: string, externoId: string, nombre?: string) {
  const filas = await leerTabla(env, "agente_conversaciones",
    "canal=eq." + encodeURIComponent(canal) + "&externo_id=eq." + encodeURIComponent(externoId) + "&select=*");
  if (filas[0]) {
    if (nombre && !filas[0].nombre) await parche(env, "agente_conversaciones", "id=eq." + filas[0].id, { nombre });
    return filas[0];
  }
  return await insertar(env, "agente_conversaciones",
    { canal, externo_id: externoId, nombre: nombre ?? null });
}

async function guardarMsg(env: Env, convId: string, rol: string, texto: string, auditoria: Record<string, unknown> = {}) {
  return await insertar(env, "agente_mensajes",
    { conversacion_id: convId, rol, texto: enmascarar(texto), auditoria });
}

/* Retroalimentación determinista (estudio §5): el mensaje de hoy
   califica la ÚLTIMA respuesta del agente aún sin calificar. */
async function retroalimentar(env: Env, conv: Record<string, unknown>, textoCrudo: string) {
  const msgs = await leerTabla(env, "agente_mensajes",
    "conversacion_id=eq." + conv.id + "&order=creado_en.desc&limit=6&select=id,rol,texto,auditoria,resuelta");
  const ultAgente = msgs.find((m) => m.rol === "agente" && m.resuelta === null);
  if (!ultAgente) return;
  let resuelta: boolean | null = null;
  if (clasificarSiguiente(textoCrudo) === "gracias") resuelta = true;
  else {
    const ultCliente = msgs.find((m) => m.rol === "cliente");
    if (ultCliente) {
      const sim = Math.max(
        similitudTrgm(formaGrupo(textoCrudo), formaGrupo(String(ultCliente.texto))),
      );
      if (sim >= 0.65) resuelta = false; // repregunta: no resolvió
    }
  }
  if (resuelta === null) return;
  await parche(env, "agente_mensajes", "id=eq." + ultAgente.id, { resuelta });
  const faqId = (ultAgente.auditoria as Record<string, unknown>)?.faq_id as string | undefined;
  const faqIdReal = (ultAgente.auditoria as Record<string, unknown>)?.faq as string | undefined;
  const fid = faqId ?? faqIdReal;
  if (fid) {
    const filas = await leerTabla(env, "agente_faq", "id=eq." + fid + "&select=veces_resuelta,veces_fallada");
    const f = filas[0];
    if (f) {
      await parche(env, "agente_faq", "id=eq." + fid, resuelta
        ? { veces_resuelta: Number(f.veces_resuelta ?? 0) + 1 }
        : { veces_fallada: Number(f.veces_fallada ?? 0) + 1 });
    }
  }
}

/* --- Núcleo: procesa UN mensaje de cliente ------------------------------ */
interface Entrada { canal: string; externo_id: string; texto: string; nombre?: string; deCallback?: boolean }
interface Salida {
  respuesta: string | null;
  opciones?: { faq_id: string; etiqueta: string }[];
  silencio?: boolean;
  accion: string;
  botones?: boolean;
  pin?: { lat: number; lng: number };
  panel?: { texto: string; teclado: unknown; vista: string };
  panelConRespuesta?: boolean;
  convId?: string;
  panelMsgId?: number | null;
}

/* Botones inline bajo las respuestas clave (v1.1): el callback trae
   el comando equivalente y corre por la MISMA capa determinista. */
const TECLADO = { inline_keyboard: [[
  { text: "📋 Pedir cita", callback_data: "v1:cita" },
  { text: "💈 Ver precios", callback_data: "v1:precios" },
  { text: "🕘 Horario", callback_data: "v1:horario" },
]]};
const CALLBACK_A_COMANDO: Record<string, string> = {
  "v1:cita": "/cita", "v1:precios": "/precios", "v1:horario": "/horario",
};

async function tgLlamar(token: string, metodo: string, cuerpo: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch("https://api.telegram.org/bot" + token + "/" + metodo, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    return await r.json() as Record<string, unknown>;
  } catch { /* Telegram nunca rompe la atención al cliente */ return null; }
}
/* Entrega a Telegram (v2): si la salida trae PANEL, se EDITA el mismo
   mensaje de la conversación (cero mensajes nuevos por navegación);
   solo nace uno cuando aún no existe o la edición ya no es posible.
   La respuesta suelta (si la hay) se manda como mensaje normal. */
async function entregarTg(env: Env, token: string, chatId: number, salida: Salida): Promise<void> {
  if (salida.panel) {
    let editado = false;
    if (salida.panelMsgId) {
      const r = await tgLlamar(token, "editMessageText", {
        chat_id: chatId, message_id: salida.panelMsgId,
        text: salida.panel.texto, reply_markup: salida.panel.teclado,
      });
      editado = r?.ok === true;
      if (editado) {
        await accion(env, "panel", { vista: salida.panel.vista, editado: true, msg_id: salida.panelMsgId });
      }
    }
    if (!editado) {
      const r = await tgLlamar(token, "sendMessage", {
        chat_id: chatId, text: salida.panel.texto, reply_markup: salida.panel.teclado,
      });
      const mid = (r?.result as Record<string, unknown>)?.message_id;
      if (typeof mid === "number" && salida.convId) {
        await parche(env, "agente_conversaciones", "id=eq." + salida.convId, { panel_msg_id: mid });
      }
      await accion(env, "panel", { vista: salida.panel.vista, editado: false, msg_id: typeof mid === "number" ? mid : null });
    }
    if (!salida.panelConRespuesta) {
      if (salida.pin) {
        await tgLlamar(token, "sendLocation",
          { chat_id: chatId, latitude: salida.pin.lat, longitude: salida.pin.lng });
      }
      return;
    }
  }
  if (!salida.respuesta) return;
  const cuerpo: Record<string, unknown> = { chat_id: chatId, text: salida.respuesta };
  if (salida.botones) cuerpo.reply_markup = TECLADO;
  await tgLlamar(token, "sendMessage", cuerpo);
  // v2.1: el PIN viaja ADEMÁS del texto (sendLocation de Telegram).
  if (salida.pin) {
    await tgLlamar(token, "sendLocation",
      { chat_id: chatId, latitude: salida.pin.lat, longitude: salida.pin.lng });
  }
}
/* Aplica un CAMBIO del modo dueño (v2): parches validados por la
   lógica contra fuente/catálogo/config/faq. Al aplicar, guarda el
   inverso en la conversación (botón «Deshacer») y deja la acción en
   la bitácora. Si un parche falla, NO se guarda el inverso. */
async function aplicarCambio(env: Env, conv: Record<string, unknown>,
                             cambio: Record<string, unknown>): Promise<boolean> {
  const ahora = new Date().toISOString();
  for (const p of (cambio.parches ?? []) as Record<string, unknown>[]) {
    const obj: Record<string, unknown> = { ...(p.parche as Record<string, unknown>) };
    if (p.tabla === "agente_fuente" || p.tabla === "agente_catalogo") obj.actualizado_en = ahora;
    if (p.tabla === "agente_catalogo") obj.actualizado_por = "dueno_bot";
    if (p.tabla === "agente_config") obj.actualizado = ahora;
    const ok = await parche(env, String(p.tabla), String(p.filtro), obj);
    if (!ok) return false;
  }
  if (cambio.esDeshacer === true) {
    await parche(env, "agente_conversaciones", "id=eq." + conv.id, { dueno_ultimo: null });
    await accion(env, "dueno_deshacer", { etiqueta: cambio.etiqueta, resumen: cambio.resumen });
  } else {
    const ultimo = {
      etiqueta: cambio.etiqueta, resumen: cambio.resumen,
      parches: ((cambio.parches ?? []) as Record<string, unknown>[]).map((p) =>
        ({ tabla: p.tabla, filtro: p.filtro, parche: p.deshacer })),
    };
    await parche(env, "agente_conversaciones", "id=eq." + conv.id, { dueno_ultimo: ultimo });
    await accion(env, "dueno_cambio", { etiqueta: cambio.etiqueta, resumen: cambio.resumen });
  }
  return true;
}

async function procesar(env: Env, e: Entrada): Promise<Salida> {
  const datos = await cargarDatos(env);
  const cfg = datos.config;
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Havana" }).format(new Date());

  const conv = await buscarOCrearConv(env, e.canal, e.externo_id, e.nombre);
  if (!conv) return { respuesta: null, silencio: true, accion: "error_conv" };
  await parche(env, "agente_conversaciones", "id=eq." + conv.id, { ultimo_en: new Date().toISOString() });

  // DETENER / pausas: comprobado antes de cada respuesta (RG-3).
  // v2: el DUEÑO (su cuenta de Telegram registrada) sí pasa cuando el
  // agente está pausado — si no, no podría reanudarlo desde su chat.
  const esDuenoTg = e.canal === "telegram" && cfg.dueno_tg_id != null &&
    String(cfg.dueno_tg_id) === e.externo_id;
  const pausado = cfg.detenido === true ||
    (e.canal === "web" && cfg.pausa_web === true) ||
    (e.canal === "telegram" && cfg.pausa_telegram === true);
  if (pausado && !esDuenoTg) {
    await accion(env, "detenido", { canal: e.canal });
    return { respuesta: null, silencio: true, accion: "detenido" };
  }
  // tope de mensajes por sesión (RG-2)
  const msgsHoy = await leerTabla(env, "agente_mensajes",
    "conversacion_id=eq." + conv.id + "&rol=eq.cliente&select=id&limit=200");
  if (msgsHoy.length >= Number(cfg.tope_mensajes_sesion ?? 40)) {
    return { respuesta: "Ya te atendí bastante por hoy 🙏 Si necesitas algo más, escríbele directo a Ernesto.", accion: "tope" };
  }

  // Los toques de botón (callbacks) no son mensajes del cliente: no
  // ensucian el registro ni la señal de retroalimentación (v2).
  if (!e.deCallback) {
    await retroalimentar(env, conv, e.texto);
    await guardarMsg(env, String(conv.id), "cliente", e.texto);
  }

  const flujoPrevio = (conv.flujo ?? {}) as Record<string, unknown>;
  // aclaración pendiente: intenta resolverla antes del matcher
  if (flujoPrevio?.tipo === "aclarar") {
    const res = resolverAclaracion(flujoPrevio, e.texto, datos as never);
    await parche(env, "agente_conversaciones", "id=eq." + conv.id, { flujo: {} });
    if (res) {
      await guardarMsg(env, String(conv.id), "agente", res.respuesta, { faq: res.faq_id, via: "aclarar" });
      return { respuesta: res.respuesta, accion: "aclarar_resuelta" };
    }
  }

  // Agradecimiento puro: cierra con cortesía y NO se procesa como
  // pregunta nueva (retroalimentar ya marcó la señal «resolvió»).
  if (clasificarSiguiente(e.texto) === "gracias" && flujoPrevio?.tipo !== "cita") {
    const cierre = "¡A ti! 😊 Si necesitas algo más, aquí estoy.";
    await guardarMsg(env, String(conv.id), "agente", cierre, { via: "cierre_gracias" });
    return { respuesta: cierre, accion: "cierre_gracias" };
  }

  // Reconocimiento del dueño (v1.1, F3): SOLO por su cuenta de
  // Telegram registrada en agente_config; jamás por el nombre.
  let dec = orquestar({ ...datos, esDueno: esDuenoTg, pausado } as never,
                      conv as never, e.texto, hoy);

  // CAPA CONVERSACIONAL (v2): solo si hay un cerebro configurado y el
  // determinista no supo (el hierro ya interceptó dentro de
  // orquestar: dinero/promesas/quejas jamás llegan hasta aquí). El
  // cerebro ve SOLO la proyección pública y su texto pasa por el
  // verificador antes de salir; si no pasa, manda el «no sé» de siempre.
  if (dec.accion === "no_se") {
    const cerebro = crearCerebro(env);
    if (cerebro.nombre !== "ninguno-faq-exacta") {
      const proy = proyeccionPublica(datos as never);
      const hist = await leerTabla(env, "agente_mensajes",
        "conversacion_id=eq." + conv.id + "&order=creado_en.desc&limit=4&select=rol,texto");
      const r = await cerebro.responder({
        pregunta: e.texto, candidata: null,
        historial: hist.reverse().map((m) => ({ rol: String(m.rol), texto: String(m.texto) })),
        proyeccion: proy.texto,
      });
      if (r?.texto) {
        const val = validarRespuestaCerebro(r.texto, proy.valores, datos.prohibidas);
        if (val.ok) {
          dec = { ...dec, accion: "cerebro", respuesta: r.texto,
                  registrar_sin_respuesta: false,
                  auditoria: { ...(dec.auditoria ?? {}), cerebro: cerebro.nombre } };
        } else {
          await accion(env, "cerebro_rechazado", { motivo: val.motivo, cerebro: cerebro.nombre });
        }
      }
    }
  }

  if (dec.accion === "silencio") return { respuesta: null, silencio: true, accion: "silencio" };

  if (dec.flujo !== undefined) {
    await parche(env, "agente_conversaciones", "id=eq." + conv.id, { flujo: dec.flujo ?? {} });
  } else if (dec.accion !== "cita_paso") {
    await parche(env, "agente_conversaciones", "id=eq." + conv.id, { flujo: {} });
  }

  // CAMBIO del modo dueño (v2): la lógica lo validó y trae los
  // parches; aquí se aplica. Si el guardado falla, la respuesta lo
  // dice en claro y no queda inverso guardado.
  if (dec.cambio && esDuenoTg) {
    const ok = await aplicarCambio(env, conv, dec.cambio as Record<string, unknown>);
    if (!ok) {
      dec = { ...dec, cambio: undefined,
              respuesta: "⚠️ No pude guardar el cambio (falló el servidor). NO quedó aplicado; inténtalo otra vez." };
      await accion(env, "dueno_cambio_error", { etiqueta: (dec.auditoria as Record<string, unknown>)?.etiqueta ?? "?" });
    }
  }

  // v2.1: la instrucción del dueño queda en la bitácora como tal
  // (tipo «instruccion_dueno»), jamás en la cola de clientes.
  if (dec.accion === "instruccion_dueno") {
    await accion(env, "instruccion_dueno",
      { canal: e.canal, texto: enmascarar(e.texto).slice(0, 200) });
  }

  if (dec.registrar_sin_respuesta) {
    await rpc(env, "agente_registrar_sin_respuesta", {
      p_pregunta: enmascarar(e.texto), p_canal: e.canal, p_conversacion: conv.id,
    });
  }

  if (dec.accion === "cita_completa" && dec.cita) {
    const cita = await insertar(env, "agente_citas", {
      nombre: dec.cita.nombre ?? "Sin nombre",
      servicio: dec.cita.servicio ?? "corte",
      dia: dec.cita.dia, hora: dec.cita.hora,
      canal: e.canal, conversacion_id: conv.id,
    });
    if (cita) {
      await avisar(env, {
        tipo: "agente_cita", cita_id: cita.id,
        titulo: "📋 Solicitud de cita nueva",
        cuerpo: "Cliente: " + (dec.cita.nombre ?? "—") + "\nServicio: " + (dec.cita.servicio ?? "corte") +
                "\nDía: " + dec.cita.dia + " · Hora: " + dec.cita.hora +
                "\nConfírmala o recházala con los botones (es una solicitud, no está confirmada).",
      });
    }
  }

  if (dec.escalar) {
    await parche(env, "agente_conversaciones", "id=eq." + conv.id,
      { escalada: true, motivo_escalado: String(dec.escalar) });
    await avisar(env, {
      tipo: "agente_escalado",
      titulo: "🙋 Un cliente necesita a Ernesto",
      cuerpo: "Motivo: " + String(dec.escalar) + "\nCliente escribió: «" +
              enmascarar(e.texto).slice(0, 200) + "»\nEl asistente ya le avisó que te lo pasa a ti.",
    });
  }

  if (dec.aviso_lead) {
    const flujo = ((conv.flujo ?? {}) as Record<string, unknown>);
    if (flujo.lead_dia !== hoy) {
      await parche(env, "agente_conversaciones", "id=eq." + conv.id,
        { flujo: { ...flujo, lead_dia: hoy } });
      await avisar(env, {
        tipo: "agente_lead",
        titulo: "🔥 Cliente interesado (posible venta)",
        cuerpo: "Un cliente mostró intención de compra en el asistente.\nEscribió: «" +
                enmascarar(e.texto).slice(0, 200) + "»",
      });
    }
  }

  if (dec.respuesta && !e.deCallback) {
    await guardarMsg(env, String(conv.id), "agente", dec.respuesta,
      { ...(dec.auditoria ?? {}), faq: dec.faq_id ?? null, accion: dec.accion });
  }
  if (dec.accion === "bloqueada") {
    await accion(env, "verificador_bloqueo", { detalle: dec.auditoria ?? {} });
  }

  // PANEL ÚNICO (v2): la decisión trae {vista} o {texto, teclado}; se
  // resuelve aquí, con los datos vivos, y la entrega la EDITA sobre
  // el mismo mensaje de la conversación.
  let panel: Salida["panel"] = undefined;
  const pDec = (dec as Record<string, unknown>).panel as Record<string, unknown> | undefined;
  const datosPanel = { ...datos, esDueno: esDuenoTg } as never;
  if (pDec) {
    if (typeof pDec.texto === "string") {
      panel = { texto: pDec.texto, teclado: pDec.teclado, vista: String(pDec.vista ?? "flujo") };
    } else if (typeof pDec.vista === "string") {
      const pv = panelVista(pDec.vista, datosPanel, conv as never,
                            { conSaludo: pDec.conSaludo === true });
      if (pv) panel = { texto: pv.texto, teclado: pv.teclado, vista: pv.vista };
    }
  }
  // los pasos de la cita viven DENTRO del panel si ya hay uno abierto
  if (!panel && dec.accion === "cita_paso" && dec.respuesta && conv.panel_msg_id) {
    panel = { texto: "📋 Tu cita — te voy preguntando paso a paso.\n" + dec.respuesta,
              teclado: { inline_keyboard: [[{ text: "✖️ Cancelar la cita", callback_data: "v2:p:inicio" }]] },
              vista: "cita" };
  }
  let panelConRespuesta = false;
  if (dec.accion === "cita_completa" && conv.panel_msg_id) {
    const pv = panelVista("inicio", datosPanel, conv as never);
    if (pv) {
      panel = { texto: "✅ Tu solicitud de cita quedó anotada (Ernesto la confirma en persona).\n\n" + pv.texto,
                teclado: pv.teclado, vista: "inicio" };
      panelConRespuesta = true; // el recibo también va como mensaje
    }
  }
  // v2: los botones sueltos de la v1.1 se repliegan al panel — una
  // respuesta «clave» (precio, horario…) abre o enlaza el panel en
  // vez de colgar el teclado viejo bajo el mensaje.
  if (!panel && dec.botones === true && e.canal === "telegram") {
    const pv = panelVista("inicio", datosPanel, conv as never);
    if (pv) {
      panel = { texto: pv.texto, teclado: pv.teclado, vista: pv.vista };
      panelConRespuesta = true; // la respuesta en sí va como mensaje
    }
  }
  return { respuesta: dec.respuesta ?? null, opciones: dec.opciones, accion: dec.accion,
           pin: dec.pin ? { lat: Number(dec.pin.lat), lng: Number(dec.pin.lng) } : undefined,
           botones: dec.botones === true && !panel, panel, panelConRespuesta,
           convId: String(conv.id),
           panelMsgId: typeof conv.panel_msg_id === "number" ? conv.panel_msg_id : null };
}

/* --- Barrido horario: agrupar + aviso de umbral (máx 1/día) ------------ */
async function agrupar(env: Env): Promise<Record<string, unknown>> {
  const r = await rpc(env, "agente_agrupar", {});
  const cruzaron = (r.cruzaron ?? []) as Record<string, unknown>[];
  let avisado = false;
  if (cruzaron.length) {
    const cfg = await leerTabla(env, "agente_config", "id=eq.1&select=ultimo_aviso_umbral_en");
    const ultimo = cfg[0]?.ultimo_aviso_umbral_en ? new Date(String(cfg[0].ultimo_aviso_umbral_en)).getTime() : 0;
    if (Date.now() - ultimo > 24 * 3600 * 1000) {
      const g = cruzaron[0];
      await avisar(env, {
        tipo: "agente_umbral",
        titulo: "❓ Muchos clientes preguntan lo mismo",
        cuerpo: "Ya van " + String(g.veces) + " veces con esta pregunta y el asistente no sabe responderla:\n«" +
                String(g.pregunta ?? "").slice(0, 200) + "»\nEnséñale la respuesta en tu bot: menú ❓ Enseñar.",
      });
      await rpc(env, "agente_marcar_avisado_umbral", { p_id: g.id });
      avisado = true;
    }
  }
  await accion(env, "agrupar", { fusionadas: r.fusionadas ?? 0, cruzaron: cruzaron.length, avisado });
  return { ok: true, fusionadas: r.fusionadas ?? 0, cruzaron: cruzaron.length, avisado };
}

/* --- Entrada HTTP -------------------------------------------------------- */
export async function manejar(req: Request, env: Env = (k) => Deno.env.get(k)): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "content-type, x-agente-key",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }
  if (req.method !== "POST") return new Response("solo POST", { status: 405 });
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch { return json({ ok: false, error: "json" }, 400); }

  // interno: barrido del agrupador (pg_cron)
  const cronSecret = env("AGENTE_CRON_SECRET") || "";
  if (body.accion === "agrupar" && cronSecret &&
      req.headers.get("x-agente-cron") === cronSecret) {
    return json(await agrupar(env));
  }

  // telegram de clientes (F1a): webhook del bot NUEVO
  const tgSecret = env("AGENTE_TG_SECRET") || "";
  const upd = body as {
    message?: { chat?: { id?: number; type?: string }; from?: { first_name?: string }; text?: string };
    callback_query?: { id?: string; data?: string; from?: { first_name?: string };
                       message?: { chat?: { id?: number } } };
  };
  const tgOk = tgSecret && req.headers.get("x-telegram-bot-api-secret-token") === tgSecret;

  // telegram: toque en un botón inline -> comando equivalente (v1.1)
  if (upd.callback_query?.message?.chat?.id && tgOk) {
    const cq = upd.callback_query;
    const chatId = cq.message.chat.id;
    const token = env("AGENTE_TG_BOT_TOKEN") || "";
    if (token && cq.id) {
      await tgLlamar(token, "answerCallbackQuery", { callback_query_id: cq.id });
    }
    const data = String(cq.data ?? "");
    let texto = CALLBACK_A_COMANDO[data];
    if (!texto && data.startsWith("v2:p:")) {
      const v = data.slice(5);
      texto = v === "citaflow" ? "/cita" : "/panel " + v;
    }
    if (!texto && data.startsWith("v2:d:")) texto = "/dueno " + data.slice(5);
    if (texto) {
      if (token) await tgLlamar(token, "sendChatAction", { chat_id: chatId, action: "typing" });
      const salida = await procesar(env, {
        canal: "telegram", externo_id: String(chatId),
        texto, nombre: cq.from?.first_name, deCallback: true,
      });
      if (token) await entregarTg(env, token, chatId, salida);
      else await accion(env, "telegram_sin_token", { chat: chatId });
    }
    return json({ ok: true });
  }

  if (upd.message?.chat?.id && tgOk) {
    const chatId = upd.message.chat.id;
    const texto = String(upd.message.text ?? "").trim();
    if (texto) {
      const token = env("AGENTE_TG_BOT_TOKEN") || "";
      // «escribiendo…» antes de responder (v1.1): cosmético, con tope.
      if (token) await tgLlamar(token, "sendChatAction", { chat_id: chatId, action: "typing" });
      const salida = await procesar(env, {
        canal: "telegram", externo_id: String(chatId),
        texto, nombre: upd.message.from?.first_name,
      });
      if (token) await entregarTg(env, token, chatId, salida);
      else await accion(env, "telegram_sin_token", { chat: chatId });
    }
    return json({ ok: true });
  }

  // web: burbuja de la paginita
  const webKey = env("AGENTE_WEB_KEY") || "";
  if (webKey && req.headers.get("x-agente-key") !== webKey) {
    return json({ ok: false, error: "no_autorizado" }, 401);
  }
  const sesion = String(body.sesion ?? "").slice(0, 64);
  const texto = String(body.texto ?? "").trim().slice(0, 1000);
  if (!sesion || !texto) return json({ ok: false, error: "faltan_datos" }, 400);
  const salida = await procesar(env, {
    canal: "web", externo_id: sesion, texto,
    nombre: body.nombre ? String(body.nombre).slice(0, 60) : undefined,
  });
  return json({
    ok: true, respuesta: salida.respuesta, opciones: salida.opciones ?? [],
    silencio: salida.silencio === true, accion: salida.accion,
    botones: salida.botones === true,
  });
}

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve((req: Request) => manejar(req));
}

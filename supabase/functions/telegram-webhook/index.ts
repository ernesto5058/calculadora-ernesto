// telegram-webhook — RECEPTOR de Telegram (Edge Function de Supabase).
// La EMISORA es otra función (avisos). Esta RECIBE y actúa:
//
// v1 (intacto en espíritu):
//   · /start <token>      -> vincula con token de un solo uso
//                            (RPC vincular_telegram_token)
//   · /vincular <CODIGO>  -> respaldo sin enlace
//                            (RPC vincular_telegram_codigo)
//   · callback_query d:   -> botones ✅ Aprobar / ❌ Rechazar de los
//                            reportes (RPC admin_decidir_telegram,
//                            idempotente por estado)
// v2 — BOT PRO (botones, no comandos):
//   · Teclado FIJO por rol: dueño (📥 Pendientes · 📊 Resumen ·
//     💰 Por pagar · 👥 Equipo · 💲 Tarifa) y buscador (📒 Lo mío ·
//     🏆 Mi bono). Cada botón abre su vista como mensaje nuevo.
//   · Callbacks propios: v:<vista> (navegar), p:<uuid> («💰 Ya pagué»
//     -> RPC admin_pagar_telegram, validada por chat).
//   · El callback de decidir ahora lleva el UUID del reporte
//     (d:<uuid>:a|r): la firma bigint de v1 jamás pudo ejecutarse
//     (reportes.id es uuid) — reparado en la base con la versión
//     uuid de la puerta (ver bot-pro-v2-diseno-2026-11-11.md §0).
//   · Las vistas leen la MISMA fuente que la Contabilidad de Mi
//     Negocio: tabla reportes (sin filas de prueba) + tarifa
//     vigente, con las fórmulas del servidor (módulo compartido).
//
// SEGURIDAD: (a) cabecera secreta del webhook; (b) deduplicación por
// update_id; (c) TODA vista/acción resuelve el vínculo del chat en
// avisos_config y exige el rol correcto; decidir y pagar exigen el
// triple chequeo del dueño (chat privado + su chat + su user_id) y
// las puertas SQL re-validan el chat por su cuenta. Un chat ajeno
// recibe silencio. El bot no conversa libre (textos PRO por rol).
// Formato HTML simple (parse_mode: "HTML"), datos escapados con
// esc(). NUNCA MarkdownV2.

import {
  BIENVENIDA_DUENO,
  BIENVENIDA_NO_VINCULADO,
  ESTADO_NO_DUENO,
  LIBRE_BUSCADOR,
  LIBRE_DUENO,
  TEXTO_A_VISTA,
  ayuda,
  bienvenidaBuscador,
  capitalDe,
  enSemana,
  esc,
  estadoDueno,
  fechaHavana,
  lineaDecision,
  mensajesEnsenar,
  mensajesPendientes,
  mensajeElegirCifra,
  mensajeElegirDato,
  netaDe,
  parseCallback,
  semanaHavana,
  tecladoBuscador,
  textoContadoresAgente,
  type ContadoresAgente,
  type GrupoPendiente,
  tecladoDueno,
  vistaBono,
  vistaEquipo,
  vistaLoMio,
  vistaPorPagar,
  vistaResumen,
  vistaTarifa,
  type MensajeVista,
  type ReporteFila,
  type TarifaFila,
  type TecladoFijo,
  type VistaId,
} from "../_shared/telegram-pro.ts";

// Secretos (SOLO en Supabase -> Edge Functions -> Secrets; jamás en
// el repo ni en el cliente):
//   TELEGRAM_BOT_TOKEN      token del bot (@BotFather)
//   TELEGRAM_WEBHOOK_SECRET secreto fijado al registrar el webhook
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (la plataforma los da)

type Env = (k: string) => string | undefined;

function cabecerasSrv(env: Env): Record<string, string> {
  return {
    "apikey": env("SUPABASE_SERVICE_ROLE_KEY") || "",
    "Authorization": "Bearer " + (env("SUPABASE_SERVICE_ROLE_KEY") || ""),
    "Content-Type": "application/json",
  };
}

async function rpc(env: Env, fn: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const resp = await fetch((env("SUPABASE_URL") || "") + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: cabecerasSrv(env),
    body: JSON.stringify(body),
  });
  let data: Record<string, unknown> = {};
  try { data = await resp.json() as Record<string, unknown>; } catch { /* vacío */ }
  return { ok: resp.ok, data };
}

async function tg(env: Env, metodo: string, cuerpo: Record<string, unknown>): Promise<boolean> {
  const token = env("TELEGRAM_BOT_TOKEN") || "";
  if (!token) return false;
  const resp = await fetch("https://api.telegram.org/bot" + token + "/" + metodo, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  return resp.ok;
}

/* Envía un mensaje HTML; reply_markup opcional (inline o fijo). */
async function enviarHtml(
  env: Env, chatId: number | string, html: string,
  replyMarkup?: Record<string, unknown>,
): Promise<boolean> {
  const cuerpo: Record<string, unknown> = { chat_id: chatId, text: html, parse_mode: "HTML" };
  if (replyMarkup) cuerpo.reply_markup = replyMarkup;
  return await tg(env, "sendMessage", cuerpo);
}

async function enviarVista(env: Env, chatId: number | string, m: MensajeVista): Promise<boolean> {
  return await enviarHtml(env, chatId, m.html, m.botones as unknown as Record<string, unknown>);
}

/* --- Lecturas de datos (llave de servicio, solo servidor) ---------- */
async function leerTabla(env: Env, tabla: string, query: string): Promise<Record<string, unknown>[]> {
  try {
    const resp = await fetch(
      (env("SUPABASE_URL") || "") + "/rest/v1/" + tabla + "?" + query,
      { headers: cabecerasSrv(env) },
    );
    if (!resp.ok) return [];
    return await resp.json() as Record<string, unknown>[];
  } catch { return []; }
}

interface Datos {
  reps: ReporteFila[];
  tarifa: TarifaFila | null;
  nombreDe: (codigo: string) => string;
  usuarios: { codigo: string; nombre: string; activo: boolean }[];
  vinculados: Set<string>;
}

async function leerDatos(env: Env): Promise<Datos> {
  const [repsRaw, tarifaRaw, usuariosRaw, cfgRaw] = await Promise.all([
    leerTabla(env, "reportes", "select=*&order=creado_en.desc&limit=1000"),
    leerTabla(env, "tarifa", "id=eq.1&select=*"),
    leerTabla(env, "usuarios", "select=codigo,nombre,activo"),
    leerTabla(env, "avisos_config", "select=codigo,telegram_chat_id"),
  ]);
  const usuarios = usuariosRaw.map((u) => ({
    codigo: String(u.codigo || ""), nombre: String(u.nombre || u.codigo || ""),
    activo: u.activo !== false,
  }));
  const porCodigo = new Map(usuarios.map((u) => [u.codigo, u.nombre]));
  return {
    reps: repsRaw as unknown as ReporteFila[],
    tarifa: (tarifaRaw[0] as unknown as TarifaFila) || null,
    nombreDe: (codigo: string) => porCodigo.get(codigo) || codigo,
    usuarios,
    vinculados: new Set(cfgRaw.filter((c) => c.telegram_chat_id).map((c) => String(c.codigo))),
  };
}

/* --- Vínculo y rol del chat que escribe ----------------------------- */
interface Vinculo { codigo: string }
async function buscarVinculo(env: Env, chatId: number | string): Promise<Vinculo | null> {
  try {
    const resp = await fetch(
      (env("SUPABASE_URL") || "") + "/rest/v1/avisos_config?telegram_chat_id=eq." +
        encodeURIComponent(String(chatId)) + "&select=codigo",
      { headers: cabecerasSrv(env) },
    );
    if (!resp.ok) return null;
    const filas = await resp.json() as { codigo?: string }[];
    return filas[0]?.codigo ? { codigo: filas[0].codigo } : null;
  } catch { return null; }
}

async function nombrePerfil(env: Env, codigo: string): Promise<string | undefined> {
  const us = await leerTabla(env, "usuarios",
    "codigo=eq." + encodeURIComponent(codigo) + "&select=nombre");
  if (us[0]?.nombre) return String(us[0].nombre);
  try {
    const resp = await fetch(
      (env("SUPABASE_URL") || "") + "/rest/v1/perfiles?codigo=eq." +
        encodeURIComponent(codigo) + "&select=nombre",
      { headers: cabecerasSrv(env) },
    );
    if (!resp.ok) return undefined;
    const filas = await resp.json() as { nombre?: string }[];
    return filas[0]?.nombre || undefined;
  } catch { return undefined; }
}

async function contarVinculos(env: Env): Promise<number> {
  const filas = await leerTabla(env, "avisos_config", "telegram_chat_id=not.is.null&select=codigo");
  return filas.length;
}

/* Triple chequeo del dueño (el de v1): su fila ADMIN en
   avisos_config, chat privado, SU chat y SU usuario. */
async function esDueno(env: Env, chat: { id?: number; type?: string } | undefined, fromId?: number): Promise<boolean> {
  if (!chat?.id || chat.type !== "private") return false;
  const cfg = await leerTabla(env, "avisos_config",
    "codigo=eq.ADMIN&select=telegram_chat_id,telegram_user_id");
  const dueno = cfg[0];
  if (!dueno?.telegram_chat_id || String(chat.id) !== String(dueno.telegram_chat_id)) return false;
  if (dueno?.telegram_user_id && String(fromId ?? "") !== String(dueno.telegram_user_id)) return false;
  return true;
}

/* --- Deduplicación por update_id (v1, intacto) ---------------------- */
const vistosMemoria = new Set<number>();
async function esUpdateNuevo(env: Env, updateId?: number): Promise<boolean> {
  if (typeof updateId !== "number") return true;
  if (vistosMemoria.has(updateId)) return false;
  vistosMemoria.add(updateId);
  if (vistosMemoria.size > 1000) vistosMemoria.clear();
  try {
    const resp = await fetch((env("SUPABASE_URL") || "") + "/rest/v1/telegram_updates", {
      method: "POST",
      headers: { ...cabecerasSrv(env), "Prefer": "return=minimal" },
      body: JSON.stringify({ update_id: updateId }),
    });
    if (resp.status === 409) return false;
    return true;
  } catch { return true; }
}

async function registrarActividad(env: Env, quien: string, accion: string, detalle: Record<string, unknown>): Promise<void> {
  try { await rpc(env, "registrar_actividad", { p_quien: quien, p_accion: accion, p_detalle: detalle }); }
  catch { /* la auditoría nunca rompe el flujo */ }
}

/* =====================================================================
   ANALISTA — Nivel 1 (2026-11-11): el botón blindado y el DETENER.
   · Callback «a:<uuid>»: ejecuta la acción pendiente por la puerta
     «mercado-actuar» (la tasa y el monto viven en el servidor; la
     puerta re-verifica TODAS las barandas al instante del toque).
   · Callback «x:detener» / «x:reanudar» y comandos /detener y
     /reanudar: el interruptor global de las acciones, en
     mercado_config. Al detener NO se cancela nada ya creado.
   Todo exige el triple chequeo del dueño (esDueno), como decidir.
   ===================================================================== */
const fmtTasaBot = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) ? n.toFixed(2).replace(".", ",") : "—";
};

async function patchConfigAcciones(env: Env, parche: Record<string, unknown>): Promise<boolean> {
  try {
    const resp = await fetch((env("SUPABASE_URL") || "") + "/rest/v1/mercado_config?id=eq.1", {
      method: "PATCH",
      headers: cabecerasSrv(env),
      body: JSON.stringify(parche),
    });
    return resp.ok;
  } catch { return false; }
}

async function llamarActuar(env: Env, accionId: string): Promise<Record<string, unknown>> {
  const secreto = env("MERCADO_ACTUAR_SECRET") || "";
  const resp = await fetch((env("SUPABASE_URL") || "") + "/functions/v1/mercado-actuar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secreto, accion_id: accionId }),
  });
  const j = await resp.json().catch(() => ({})) as Record<string, unknown>;
  if (!resp.ok && !j.codigo) return { ok: false, codigo: "puerta_error", motivo: "La puerta de acción respondió " + resp.status + "." };
  return j;
}

function textoResultadoAccion(r: Record<string, unknown>): string {
  if (r.ok === true) {
    return "✅ <b>Oferta publicada</b>: vendes $" + String(r.monto_qusd ?? "—") +
      " QUSD a " + fmtTasaBot(r.tasa) + " saldo por QUSD (ganancia +" +
      fmtTasaBot(r.ganancia360) + " CUP por recarga de 360). Queda abierta en tu QvaPay" +
      (r.reconciliada === true ? " (la respuesta tardó, pero la oferta apareció entre las tuyas)" : "") + ".";
  }
  if (r.codigo === "ya_ejecutada") return "ℹ️ Esa oferta ya estaba publicada: no se duplicó.";
  return "⛔ <b>No se publicó</b>: " + esc(String(r.motivo || "la puerta de acción la negó."));
}

/* =====================================================================
   AGENTE DE CLIENTES — enseñanza v2 + contadores (2026-11-11).
   Las puertas SQL agente_* validan el chat del dueño por su cuenta;
   aquí además se exige esDueno (triple chequeo) antes de llamarlas.
   ===================================================================== */
async function contadoresAgente(env: Env): Promise<ContadoresAgente | null> {
  const r = await rpc(env, "agente_contadores", {});
  return r.ok && r.data ? (r.data as unknown as ContadoresAgente) : null;
}

async function bienvenidaDuenoTxt(env: Env): Promise<string> {
  const c = await contadoresAgente(env);
  return c ? BIENVENIDA_DUENO + "\n\n" + textoContadoresAgente(c) : BIENVENIDA_DUENO;
}

async function leerGruposPendientes(env: Env): Promise<GrupoPendiente[]> {
  const filas = await leerTabla(env, "agente_pendientes",
    "grupo_de=is.null&estado=in.(nueva,agrupada,presentada)" +
    "&order=veces.desc,primera_en.asc&limit=50" +
    "&select=id,pregunta,veces,tipo_sugerido");
  return filas.map((f) => ({
    id: String(f.id), pregunta: String(f.pregunta || ""),
    veces: Number(f.veces || 0),
    tipo_sugerido: (f.tipo_sugerido as string | null) ?? null,
  }));
}

async function ponerEspera(env: Env, chatId: number | string, accion: string, refId: string): Promise<void> {
  try {
    await fetch((env("SUPABASE_URL") || "") + "/rest/v1/agente_espera?on_conflict=chat_id", {
      method: "POST",
      headers: { ...cabecerasSrv(env), "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ chat_id: String(chatId), accion, ref_id: refId }),
    });
  } catch { /* si falla, el flujo lo nota al no encontrar la espera */ }
}

async function leerEspera(env: Env, chatId: number | string): Promise<{ accion: string; ref_id: string } | null> {
  const filas = await leerTabla(env, "agente_espera",
    "chat_id=eq." + encodeURIComponent(String(chatId)) + "&select=accion,ref_id,expira_en");
  const f = filas[0];
  if (!f) return null;
  if (f.expira_en && new Date(String(f.expira_en)).getTime() < Date.now()) {
    await borrarEspera(env, chatId);
    return null;
  }
  return { accion: String(f.accion), ref_id: String(f.ref_id) };
}

async function borrarEspera(env: Env, chatId: number | string): Promise<void> {
  try {
    await fetch((env("SUPABASE_URL") || "") + "/rest/v1/agente_espera?chat_id=eq." +
      encodeURIComponent(String(chatId)), { method: "DELETE", headers: cabecerasSrv(env) });
  } catch { /* la espera caduca sola en 30 min */ }
}

/* =====================================================================
   VISTAS v2 — se calculan al momento, con los datos vivos.
   ===================================================================== */
const VISTAS_DUENO: VistaId[] = ["pend", "res", "pagar", "equipo", "tarifa", "ensenar"];

function repsBase(d: Datos): ReporteFila[] {
  return d.reps.filter((r) => !r.prueba && r.estado === "aprobado");
}
function sinPagarDe(d: Datos): ReporteFila[] {
  return repsBase(d).filter((r) => !r.comision_pagada_en)
    .slice().sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)));
}

async function despacharVista(
  env: Env, chatId: number, vista: VistaId, vinculo: Vinculo,
): Promise<{ enviada: boolean; detalle: string }> {
  const rol = vinculo.codigo === "ADMIN" ? "dueno" : "equipo";
  if (vista === "menu") {
    const ok = await enviarHtml(env, chatId,
      rol === "dueno" ? "👇 <b>Tu menú</b>" : "👇 <b>Tu menú</b>",
      (rol === "dueno" ? tecladoDueno() : tecladoBuscador()) as unknown as Record<string, unknown>);
    return { enviada: ok, detalle: "menu" };
  }
  /* Puertas de rol: lo del dueño no existe para el equipo y al revés. */
  if (VISTAS_DUENO.includes(vista) && rol !== "dueno") return { enviada: false, detalle: "rol" };
  if ((vista === "lomio" || vista === "bono") && rol !== "equipo") return { enviada: false, detalle: "rol" };

  const d = await leerDatos(env);

  if (vista === "pend") {
    const pendientes = d.reps.filter((r) => r.estado === "pendiente")
      .slice().sort((a, b) => String(a.creado_en).localeCompare(String(b.creado_en)));
    let ok = true;
    for (const m of mensajesPendientes(pendientes, d.nombreDe)) {
      ok = (await enviarVista(env, chatId, m)) && ok;
    }
    return { enviada: ok, detalle: "pendientes:" + String(pendientes.length) };
  }
  if (vista === "res") {
    if (!d.tarifa) return { enviada: false, detalle: "sin-tarifa" };
    const t = d.tarifa;
    const base = repsBase(d);
    const mes = fechaHavana(new Date()).slice(0, 7);
    const repsMes = base.filter((r) => fechaHavana(r.creado_en).slice(0, 7) === mes);
    const sinPagar = sinPagarDe(d);
    const sem = semanaHavana();
    const semAnt = semanaHavana(new Date(Date.now() - 7 * 86400000));
    const enRango = (r: ReporteFila, s: { inicio: string; fin: string }) => enSemana(r, s);
    const m = vistaResumen({
      hayDatos: base.length > 0,
      ganMes: repsMes.reduce((s, r) => s + netaDe(r, t), 0),
      nMes: repsMes.length,
      porPagar: sinPagar.reduce((s, r) => s + Number(r.comision || 0), 0),
      nSinPagar: sinPagar.length,
      capMes: repsMes.reduce((s, r) => s + capitalDe(r), 0),
      recMes: repsMes.filter((r) => r.tipo === "saldo").reduce((s, r) => s + Number(r.cantidad || 0), 0),
      netaSem: base.filter((r) => enRango(r, sem)).reduce((s, r) => s + netaDe(r, t), 0),
      netaSemAnt: base.filter((r) => enRango(r, semAnt)).reduce((s, r) => s + netaDe(r, t), 0),
    });
    return { enviada: await enviarVista(env, chatId, m), detalle: "resumen" };
  }
  if (vista === "pagar") {
    const m = vistaPorPagar(sinPagarDe(d), d.nombreDe);
    return { enviada: await enviarVista(env, chatId, m), detalle: "porpagar" };
  }
  if (vista === "equipo") {
    const base = repsBase(d);
    const filas = d.usuarios.filter((u) => u.activo && u.codigo !== "ADMIN").map((u) => {
      const suyos = base.filter((r) => r.buscador === u.codigo);
      const deuda = suyos.filter((r) => !r.comision_pagada_en);
      return {
        nombre: u.nombre,
        porPagar: deuda.reduce((s, r) => s + Number(r.comision || 0), 0),
        nPorPagar: deuda.length,
        nAprobados: suyos.length,
        vinculado: d.vinculados.has(u.codigo),
      };
    });
    return { enviada: await enviarVista(env, chatId, vistaEquipo(filas)), detalle: "equipo" };
  }
  if (vista === "tarifa") {
    if (!d.tarifa) return { enviada: false, detalle: "sin-tarifa" };
    return { enviada: await enviarVista(env, chatId, vistaTarifa(d.tarifa)), detalle: "tarifa" };
  }
  if (vista === "lomio") {
    const suyos = repsBase(d).filter((r) => r.buscador === vinculo.codigo);
    const m = vistaLoMio({
      porPagar: suyos.filter((r) => !r.comision_pagada_en),
      pagados: suyos.filter((r) => !!r.comision_pagada_en),
      ultimos: suyos.slice(0, 5),
    });
    return { enviada: await enviarVista(env, chatId, m), detalle: "lomio" };
  }
  if (vista === "ensenar") {
    const grupos = await leerGruposPendientes(env);
    const cont = await contadoresAgente(env);
    let ok = true;
    for (const m of mensajesEnsenar(grupos, cont ?? undefined)) {
      ok = (await enviarVista(env, chatId, m)) && ok;
    }
    return { enviada: ok, detalle: "ensenar:" + String(grupos.length) };
  }
  /* bono */
  const sem = semanaHavana();
  const suyosSem = repsBase(d).filter((r) => r.buscador === vinculo.codigo && enSemana(r, sem));
  const m = vistaBono({
    recargasSemana: suyosSem.filter((r) => r.tipo === "saldo")
      .reduce((s, r) => s + Number(r.cantidad || 0), 0),
    tratosTransfSemana: suyosSem.filter((r) => r.tipo === "transferencia").length,
  });
  return { enviada: await enviarVista(env, chatId, m), detalle: "bono" };
}

/* ===================================================================== */

interface TgUpdate {
  update_id?: number;
  message?: {
    chat?: { id?: number; type?: string };
    from?: { id?: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    from?: { id?: number };
    message?: {
      message_id: number;
      chat?: { id?: number; type?: string };
      text?: string;
    };
  };
}

type Rol = "dueno" | "equipo" | "fuera";
function rolDe(v: Vinculo | null): Rol {
  if (!v) return "fuera";
  return v.codigo === "ADMIN" ? "dueno" : "equipo";
}

function respJson(obj: Record<string, unknown>): Response {
  return new Response(JSON.stringify(obj), { headers: { "Content-Type": "application/json" } });
}

export async function manejar(req: Request, env: Env = (k) => Deno.env.get(k)): Promise<Response> {
  if (req.method !== "POST") return new Response("solo POST", { status: 405 });

  /* (a) Cabecera secreta del webhook: lo primero, siempre. */
  const secreto = env("TELEGRAM_WEBHOOK_SECRET") || "";
  if (secreto && req.headers.get("x-telegram-bot-api-secret-token") !== secreto) {
    return new Response("no autorizado", { status: 401 });
  }

  let upd: TgUpdate;
  try { upd = await req.json() as TgUpdate; } catch { return new Response("JSON no valido", { status: 400 }); }

  /* Deduplicación: un update reintentado no se procesa dos veces. */
  if (!(await esUpdateNuevo(env, upd.update_id))) {
    return respJson({ ok: true, duplicado: true });
  }

  /* ===== Botones (callback_query) ===== */
  const cq = upd.callback_query;
  if (cq && typeof cq.data === "string") {
    const chat = cq.message?.chat;
    if (!chat?.id) {
      await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Botón no válido." });
      return respJson({ ok: true });
    }
    const chatId = chat.id;

    /* --- Analista: publicar con el botón blindado (a:<uuid>) --- */
    if (cq.data.startsWith("a:")) {
      const accionId = cq.data.slice(2);
      if (!/^[0-9a-f-]{36}$/i.test(accionId)) {
        await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Botón no válido." });
        return respJson({ ok: true });
      }
      if (!(await esDueno(env, chat, cq.from?.id))) {
        await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Solo Ernesto puede publicar desde aquí." });
        return respJson({ ok: true });
      }
      await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Revisando las barandas…" });
      const r = await llamarActuar(env, accionId);
      const textoOriginal = cq.message?.text ?? "";
      await tg(env, "editMessageText", {
        chat_id: chatId,
        message_id: cq.message?.message_id,
        text: esc(textoOriginal) + "\n\n" + textoResultadoAccion(r),
        parse_mode: "HTML",
      });
      await registrarActividad(env, "telegram", "analista_accion", {
        accion_id: accionId, ok: r.ok === true, codigo: String(r.codigo || ""),
      });
      return respJson({ ok: true, accion: r.ok === true });
    }

    /* --- Analista: DETENER / Reanudar las acciones (x:…) --- */
    if (cq.data === "x:detener" || cq.data === "x:reanudar") {
      if (!(await esDueno(env, chat, cq.from?.id))) {
        await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
        return respJson({ ok: true, ignorado: "rol" });
      }
      const detener = cq.data === "x:detener";
      const hecho = await patchConfigAcciones(env, detener
        ? { acciones_detenidas: true }
        : { acciones_detenidas: false, acciones_pausadas: false, pausa_motivo: null, fallos_seguidos: 0, sin_resultado_seguidos: 0 });
      await tg(env, "answerCallbackQuery", {
        callback_query_id: cq.id,
        text: hecho
          ? (detener ? "⛔ Acciones detenidas." : "▶️ Acciones reanudadas.")
          : "⚠️ No se pudo cambiar: revísalo en tu app Mercado.",
      });
      if (hecho) {
        await enviarHtml(env, chatId, detener
          ? "⛔ <b>Acciones DETENIDAS.</b>\nEl Analista sigue leyendo y avisando, pero ningún botón publicará hasta que reanudes. Lo ya publicado no se toca."
          : "▶️ <b>Acciones reanudadas.</b>\nEl botón blindado vuelve a estar disponible en las próximas alertas del Analista.");
      }
      return respJson({ ok: true, detener });
    }

    const acc = parseCallback(cq.data);
    if (!acc) {
      await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Botón no válido." });
      return respJson({ ok: true });
    }

    /* --- Decidir un reporte (v1 reparado: UUID) --- */
    if (acc.tipo === "decidir") {
      if (!(await esDueno(env, chat, cq.from?.id))) {
        await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Solo Ernesto puede decidir desde aquí." });
        return respJson({ ok: true });
      }
      const r = await rpc(env, "admin_decidir_telegram", {
        p_chat_id: String(chatId), p_id: acc.id, p_aprobar: acc.aprobar,
      });
      const ya = r.data?.ya_decidido === true;
      const hecho = !ya && r.ok && r.data?.ok === true;
      const aviso = ya
        ? "Ese reporte ya estaba decidido (" + String(r.data?.estado ?? "") + ")."
        : (hecho
            ? (acc.aprobar ? "✅ Aprobado" : "❌ Rechazado")
            : "⚠️ No se pudo decidir: revísalo en Mi Negocio.");
      await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: aviso });
      if (hecho || ya) {
        const textoOriginal = cq.message?.text ?? "";
        const linea = ya
          ? "ℹ️ Ya estaba decidido (" + String(r.data?.estado ?? "") + ")."
          : lineaDecision(acc.aprobar);
        let extra = "";
        if (hecho && acc.aprobar && r.data?.comision != null) {
          extra = "\n💰 Comisión del buscador: " + String(r.data.comision) + " CUP (queda en «Por pagar»).";
        }
        await tg(env, "editMessageText", {
          chat_id: chatId,
          message_id: cq.message?.message_id,
          text: esc(textoOriginal) + "\n\n" + esc(linea + extra),
          parse_mode: "HTML",
        });
      }
      return respJson({ ok: true, decidido: hecho });
    }

    /* --- «💰 Ya pagué» (v2) --- */
    if (acc.tipo === "pagar") {
      if (!(await esDueno(env, chat, cq.from?.id))) {
        await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
        return respJson({ ok: true, ignorado: "rol" });
      }
      const r = await rpc(env, "admin_pagar_telegram", {
        p_chat_id: String(chatId), p_id: acc.id,
      });
      if (r.ok && r.data?.ok === true) {
        await tg(env, "answerCallbackQuery", {
          callback_query_id: cq.id,
          text: r.data?.ya_pagado === true ? "Ya estaba marcado como pagado." : "💰 Marcado como pagado.",
        });
        /* La tarjeta «Por pagar» se re-pinta sin ese renglón. */
        const d = await leerDatos(env);
        const m = vistaPorPagar(sinPagarDe(d), d.nombreDe);
        await tg(env, "editMessageText", {
          chat_id: chatId,
          message_id: cq.message?.message_id,
          text: m.html,
          parse_mode: "HTML",
          reply_markup: m.botones,
        });
        return respJson({ ok: true, pagado: true });
      }
      await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "⚠️ No se pudo marcar: revísalo en Mi Negocio." });
      return respJson({ ok: true, pagado: false });
    }

    /* --- Cita del asistente de clientes (c:<uuid>:a|r) --- */
    if (acc.tipo === "cita") {
      if (!(await esDueno(env, chat, cq.from?.id))) {
        await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Solo Ernesto decide las citas." });
        return respJson({ ok: true });
      }
      const r = await rpc(env, "agente_cita_decidir", {
        p_chat_id: String(chatId), p_id: acc.id, p_aprobar: acc.aprobar,
      });
      const ya = r.data?.ya_decidida === true;
      const hecho = !ya && r.ok && r.data?.ok === true;
      await tg(env, "answerCallbackQuery", {
        callback_query_id: cq.id,
        text: ya ? "Esa cita ya estaba decidida."
          : hecho ? (acc.aprobar ? "✅ Cita confirmada" : "❌ Cita rechazada")
          : "⚠️ No se pudo decidir la cita.",
      });
      if (hecho || ya) {
        const textoOriginal = cq.message?.text ?? "";
        const linea = ya
          ? "ℹ️ Ya estaba decidida (" + String(r.data?.estado ?? "") + ")."
          : (acc.aprobar
            ? "✅ <b>Cita CONFIRMADA</b> — " + esc(String(r.data?.nombre ?? "")) + ", " +
              esc(String(r.data?.servicio ?? "corte")) + ", el " + esc(String(r.data?.dia ?? "")) +
              " a las " + esc(String(r.data?.hora ?? "").slice(0, 5)) + "."
            : "❌ <b>Cita rechazada</b> por ti.");
        await tg(env, "editMessageText", {
          chat_id: chatId,
          message_id: cq.message?.message_id,
          text: esc(textoOriginal) + "\n\n" + linea,
          parse_mode: "HTML",
        });
      }
      return respJson({ ok: true, cita: hecho });
    }

    /* --- Enseñar: un grupo de preguntas (g:… / y:… / k:…) --- */
    if (acc.tipo === "grupo" || acc.tipo === "grupo_dato" ||
        acc.tipo === "cifra" || acc.tipo === "cifra_dato") {
      if (!(await esDueno(env, chat, cq.from?.id))) {
        await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "Solo Ernesto enseña al asistente." });
        return respJson({ ok: true });
      }
      const chatTxt = String(chatId);
      const cerrarTarjeta = async (linea: string) => {
        const textoOriginal = cq.message?.text ?? "";
        await tg(env, "editMessageText", {
          chat_id: chatId,
          message_id: cq.message?.message_id,
          text: esc(textoOriginal) + "\n\n" + linea,
          parse_mode: "HTML",
        });
      };
      if (acc.tipo === "grupo" && acc.accion === "d") {
        await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
        const m = mensajeElegirDato(acc.id);
        await enviarVista(env, chatId, m);
        return respJson({ ok: true, ensenar: "elegir-dato" });
      }
      if (acc.tipo === "grupo" && acc.accion === "t") {
        await ponerEspera(env, chatId, "ensenar_texto", acc.id);
        await tg(env, "answerCallbackQuery", { callback_query_id: cq.id, text: "✍️ Escríbeme la respuesta y la aprende." });
        await enviarHtml(env, chatId,
          "✍️ <b>Dicta la respuesta</b> para esa pregunta, tal como quieres " +
          "que el asistente la diga. En cuanto la mandes, queda aprendida.");
        return respJson({ ok: true, ensenar: "esperando-texto" });
      }
      if (acc.tipo === "grupo_dato") {
        const r = await rpc(env, "agente_ensenar_dato", {
          p_chat_id: chatTxt, p_grupo: acc.id, p_dato_clave: acc.dato,
        });
        const hecho = r.ok && r.data?.ok === true;
        await tg(env, "answerCallbackQuery", {
          callback_query_id: cq.id,
          text: hecho ? "🔗 Conectada al dato vivo." : "⚠️ No se pudo conectar.",
        });
        if (hecho) await cerrarTarjeta("🔗 <b>Enseñado:</b> esta pregunta ya sale del dato vivo.");
        return respJson({ ok: true, ensenar: "dato", hecho });
      }
      if (acc.tipo === "cifra" || acc.tipo === "cifra_dato") {
        const r = await rpc(env, "agente_ensenar_cifra", {
          p_chat_id: chatTxt, p_faq: acc.faq,
          p_modo: acc.tipo === "cifra" ? "fija" : "dato",
          p_dato_clave: acc.tipo === "cifra_dato" ? acc.dato : null,
        });
        const hecho = r.ok && r.data?.ok === true;
        await tg(env, "answerCallbackQuery", {
          callback_query_id: cq.id,
          text: hecho ? "✅ Respuesta activada." : "⚠️ No se pudo activar.",
        });
        if (hecho) await cerrarTarjeta("✅ <b>Respuesta activada</b> con tu cifra " +
          (acc.tipo === "cifra" ? "fija, como la dictaste." : "saliendo del dato vivo."));
        return respJson({ ok: true, ensenar: "cifra", hecho });
      }
      /* grupo s | e | x */
      const fn = acc.accion === "s" ? "agente_ensenar_sumar"
        : acc.accion === "e" ? "agente_ensenar_escalado" : "agente_ensenar_descartar";
      const r = await rpc(env, fn, { p_chat_id: chatTxt, p_grupo: acc.id });
      const ya = r.data?.ya === true;
      const hecho = r.ok && r.data?.ok === true && !ya;
      const sinFaq = r.data?.error === "sin_faq";
      await tg(env, "answerCallbackQuery", {
        callback_query_id: cq.id,
        text: ya ? "Ese grupo ya estaba resuelto."
          : hecho
            ? (acc.accion === "s" ? "➕ Frase sumada: ya la reconoce."
              : acc.accion === "e" ? "👤 Anotado: eso siempre te llega a ti."
              : "🗑 Anotado: nunca la responderá.")
            : sinFaq ? "Esa no se parece a ninguna respuesta que ya sepa: respóndela tú o conéctala a un dato."
            : "⚠️ No se pudo enseñar.",
      });
      if (hecho) {
        await cerrarTarjeta(acc.accion === "s" ? "➕ <b>Enseñado:</b> frase sumada."
          : acc.accion === "e" ? "👤 <b>Enseñado:</b> esto siempre pasa a Ernesto."
          : "🗑 <b>Descartada:</b> nunca se responde.");
      }
      return respJson({ ok: true, ensenar: acc.accion, hecho });
    }

    /* --- Navegación a vistas (v2) --- */
    const vinculo = await buscarVinculo(env, chatId);
    if (!vinculo) {
      await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
      return respJson({ ok: true, ignorado: "sin-vinculo" });
    }
    await tg(env, "answerCallbackQuery", { callback_query_id: cq.id });
    const res = await despacharVista(env, chatId, acc.vista, vinculo);
    return respJson({ ok: true, vista: acc.vista, ...res });
  }

  /* ===== Mensajes: comandos, teclado fijo y texto libre ===== */
  const msg = upd.message;
  const chatId = msg?.chat?.id;
  const texto = (msg?.text || "").trim();
  if (chatId && texto && msg?.chat?.type === "private") {
    const partes = texto.split(/\s+/);
    const comando = (partes[0] || "").split("@")[0].toLowerCase();
    const userId = String(msg?.from?.id ?? "");
    const vinculo = await buscarVinculo(env, chatId);
    const rol = rolDe(vinculo);
    const tecladoDe = (r: Rol): TecladoFijo | undefined =>
      r === "dueno" ? tecladoDueno() : r === "equipo" ? tecladoBuscador() : undefined;

    /* /start con token de un solo uso (enlace de la app). */
    if (comando === "/start" && partes[1]) {
      const r = await rpc(env, "vincular_telegram_token", {
        p_token: partes[1], p_chat_id: String(chatId), p_user_id: userId,
      });
      if (r.ok && r.data?.ok === true) {
        const cod = String(r.data?.codigo || "");
        if (cod === "ADMIN") {
          await enviarHtml(env, chatId, await bienvenidaDuenoTxt(env),
            tecladoDueno() as unknown as Record<string, unknown>);
        } else {
          await enviarHtml(env, chatId, bienvenidaBuscador(await nombrePerfil(env, cod)),
            tecladoBuscador() as unknown as Record<string, unknown>);
        }
      } else {
        await registrarActividad(env, "telegram", "telegram_vinculo_fallido", { via: "token" });
        await enviarHtml(env, chatId,
          "⚠️ <b>Ese enlace venció o ya se usó.</b>\n" +
          "Genera uno nuevo en tu app (Mi perfil / Avisos) y tócalo enseguida.");
      }
      return respJson({ ok: true });
    }

    /* /vincular <CODIGO> — respaldo sin enlace. */
    if (comando === "/vincular" && partes[1]) {
      const r = await rpc(env, "vincular_telegram_codigo", {
        p_codigo: partes[1], p_chat_id: String(chatId), p_user_id: userId,
      });
      if (r.ok && r.data?.ok === true) {
        const cod = String(r.data?.codigo || "");
        if (cod === "ADMIN") {
          await enviarHtml(env, chatId, await bienvenidaDuenoTxt(env),
            tecladoDueno() as unknown as Record<string, unknown>);
        } else {
          await enviarHtml(env, chatId, bienvenidaBuscador(await nombrePerfil(env, cod)),
            tecladoBuscador() as unknown as Record<string, unknown>);
        }
      } else {
        await registrarActividad(env, "telegram", "telegram_vinculo_fallido", { via: "codigo" });
        await enviarHtml(env, chatId,
          "⚠️ <b>Código no válido.</b>\n" +
          "Revisa que sea el mismo de tu app e inténtalo otra vez.");
      }
      return respJson({ ok: true });
    }

    /* /start a secas: bienvenida + su teclado fijo. */
    if (comando === "/start" || comando === "/vincular") {
      const tk = tecladoDe(rol);
      const markup = tk as unknown as Record<string, unknown> | undefined;
      if (rol === "dueno") await enviarHtml(env, chatId, await bienvenidaDuenoTxt(env), markup);
      else if (rol === "equipo") await enviarHtml(env, chatId, bienvenidaBuscador(await nombrePerfil(env, vinculo!.codigo)), markup);
      else await enviarHtml(env, chatId, BIENVENIDA_NO_VINCULADO);
      return respJson({ ok: true });
    }

    /* /ayuda según el rol (con su teclado, si lo tiene). */
    if (comando === "/ayuda") {
      const tk = tecladoDe(rol);
      await enviarHtml(env, chatId, ayuda(rol), tk as unknown as Record<string, unknown> | undefined);
      return respJson({ ok: true });
    }

    /* /estado: SOLO el dueño. */
    if (comando === "/estado") {
      if (rol === "dueno") {
        const cont = await contadoresAgente(env);
        await enviarHtml(env, chatId, estadoDueno({
          vinculados: await contarVinculos(env),
          agente: cont ? textoContadoresAgente(cont) : undefined,
        }));
      } else {
        await enviarHtml(env, chatId, esc(ESTADO_NO_DUENO));
      }
      return respJson({ ok: true });
    }

    /* /detener y /reanudar: el interruptor global de las acciones
       del Analista (Nivel 1). SOLO el dueño, con triple chequeo. */
    if (comando === "/detener" || comando === "/reanudar") {
      if (!(await esDueno(env, msg?.chat, msg?.from?.id))) {
        return respJson({ ok: true, ignorado: "rol" });
      }
      const detener = comando === "/detener";
      const hecho = await patchConfigAcciones(env, detener
        ? { acciones_detenidas: true }
        : { acciones_detenidas: false, acciones_pausadas: false, pausa_motivo: null, fallos_seguidos: 0, sin_resultado_seguidos: 0 });
      await enviarHtml(env, chatId, hecho
        ? (detener
          ? "⛔ <b>Acciones DETENIDAS.</b>\nEl Analista sigue leyendo y avisando, pero ningún botón publicará hasta que reanudes. Lo ya publicado no se toca."
          : "▶️ <b>Acciones reanudadas.</b>\nEl botón blindado vuelve a estar disponible en las próximas alertas del Analista.")
        : "⚠️ No se pudo cambiar: revísalo en tu app Mercado.");
      return respJson({ ok: true, detener });
    }

    /* Enseñanza en curso: Ernesto dictó «Responder yo» y este texto
       ES la respuesta. Solo dueño, solo si hay espera viva y el
       texto no es un comando. */
    if (rol === "dueno" && !texto.startsWith("/")) {
      const espera = await leerEspera(env, chatId);
      if (espera && espera.accion === "ensenar_texto") {
        const r = await rpc(env, "agente_ensenar_responder", {
          p_chat_id: String(chatId), p_grupo: espera.ref_id, p_texto: texto,
        });
        await borrarEspera(env, chatId);
        if (r.ok && r.data?.ok === true && r.data?.cifra_detectada === true && r.data?.faq) {
          await enviarHtml(env, chatId,
            "📝 Guardé tu respuesta, pero trae una cifra: dime cómo queda.",
            undefined);
          const m = mensajeElegirCifra(String(r.data.faq));
          await enviarVista(env, chatId, m);
        } else if (r.ok && r.data?.ok === true) {
          await enviarHtml(env, chatId,
            "✅ <b>Aprendido.</b>\nDesde ahora el asistente responde eso " +
            "con tus palabras. Toca ❓ Enseñar para el siguiente grupo.");
        } else {
          await enviarHtml(env, chatId,
            "⚠️ No se pudo guardar esa respuesta: toca ❓ Enseñar y vuelve a intentarlo.");
        }
        return respJson({ ok: true, ensenar: "texto" });
      }
    }

    /* Botones del teclado fijo: llegan como texto exacto. Sin
       vínculo -> silencio (no se confirma ni que el botón existe). */
    const vistaTeclado = TEXTO_A_VISTA[texto];
    if (vistaTeclado) {
      if (!vinculo) return respJson({ ok: true, ignorado: "sin-vinculo" });
      const res = await despacharVista(env, chatId, vistaTeclado, vinculo);
      return respJson({ ok: true, vista: vistaTeclado, ...res });
    }

    /* Texto libre (o comando desconocido): el bot no conversa. */
    if (rol === "dueno") await enviarHtml(env, chatId, LIBRE_DUENO);
    else if (rol === "equipo") await enviarHtml(env, chatId, LIBRE_BUSCADOR);
    else await enviarHtml(env, chatId, BIENVENIDA_NO_VINCULADO);
  }
  return respJson({ ok: true });
}

/* Punto de entrada de Supabase Edge Functions. */
if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve((req: Request) => manejar(req));
}

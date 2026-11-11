// =====================================================================
// telegram-pro.ts — IDENTIDAD Y PLANTILLAS PRO del bot del negocio.
// Módulo compartido por las Edge Functions «avisos» (emisora) y
// «telegram-webhook» (receptora). SIN secretos: solo texto y formato.
// ---------------------------------------------------------------------
// Diseño de los mensajes (estándar del proyecto, nada de bloques):
//   · Título corto con UN emoji con sentido; el título va en negrita.
//   · Datos clave como «<b>Etiqueta:</b> valor» — negrita SOLO en la
//     etiqueta, nunca en el dato.
//   · Montos con miles separados por espacio y moneda explícita.
//   · Horas en la hora de pared de Ernesto (America/Havana):
//     «hoy 9:41 a. m.».
//   · Cero JSON, cero volcados, cero códigos de nadie en los textos.
// Formato: HTML simple de Telegram (parse_mode: "HTML"). Todo dato
// dinámico pasa por esc() (solo <, > y &). NUNCA MarkdownV2.
// =====================================================================

export const BOT_USUARIO = "MiNegocioErnestoBot";
export const BOT_NOMBRE = "Mi Negocio · Avisos";

/* --- Identidad pública (límites oficiales de Telegram) ------------ */
/* Descripción larga: máximo 512 caracteres. */
export const DESCRIPCION_LARGA =
  "Bot oficial de avisos del equipo de Ernesto (Santiago de Cuba). " +
  "Avisa al instante: reportes nuevos para aprobar, tratos aprobados, " +
  "comisiones pagadas, tarifa nueva y mensajes del chat del equipo. " +
  "Es un bot privado: solo recibe avisos quien Ernesto vincule desde " +
  "su app «Mi Trabajo» o «Mi Negocio». El bot no conversa ni vende " +
  "nada; las operaciones se hacen siempre dentro de las apps.";

/* «About» corto: máximo 120 caracteres. */
export const ABOUT_CORTO =
  "Avisos privados del equipo de Ernesto: reportes, tratos, " +
  "comisiones y tarifa. Solo para cuentas vinculadas.";

/* Comandos oficiales (setMyCommands en la activación). Nada
   decorativo: cada comando hace algo real. */
export const COMANDOS: { command: string; description: string }[] = [
  { command: "start", description: "Abrir el bot y ver tu estado" },
  { command: "vincular", description: "Vincular tu Telegram con tu código del equipo" },
  { command: "ayuda", description: "Qué hace este bot y cómo se usa" },
  { command: "estado", description: "Estado del bot y de los vínculos (solo Ernesto)" },
];

/* --- Utilidades de formato ---------------------------------------- */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* Enteros con miles separados por espacio: 5000 -> «5 000». */
export function miles(n: unknown): string {
  const v = Math.round(Number(n) || 0);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/* Dinero: miles con espacio y decimales solo si los hay («1 098,68»). */
export function dinero(n: unknown): string {
  const v = Number(n) || 0;
  const r = Math.round(v * 100) / 100;
  const entero = Math.trunc(r);
  let s = miles(entero);
  const dec = Math.round((Math.abs(r) - Math.abs(entero)) * 100);
  if (dec > 0) s += "," + String(dec).padStart(2, "0");
  return s;
}

/* Hora de pared de Ernesto: «hoy 9:41 a. m.». */
export function horaPared(f?: Date | string | number): string {
  const d = f ? new Date(f) : new Date();
  const t = new Intl.DateTimeFormat("es", {
    timeZone: "America/Havana",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  return "hoy " + t;
}

/* --- Constructor de plantillas --------------------------------------
   Cada plantilla devuelve:
     titulo  texto del título (con su emoji), para Web Push.
     cuerpo  cuerpo en texto plano, para Web Push.
     html    mensaje completo en HTML simple, para Telegram. */
export interface Plantilla {
  titulo: string;
  cuerpo: string;
  html: string;
}

type Dato = { etiqueta: string; valor: string };

function armar(titulo: string, datos: Dato[], cierre?: string): Plantilla {
  const cuerpoLineas = datos.map((d) => d.etiqueta + ": " + d.valor);
  if (cierre) cuerpoLineas.push(cierre);
  const htmlLineas = datos.map(
    (d) => "<b>" + esc(d.etiqueta) + ":</b> " + esc(d.valor),
  );
  if (cierre) htmlLineas.push(esc(cierre));
  return {
    titulo,
    cuerpo: cuerpoLineas.join("\n"),
    html: "<b>" + esc(titulo) + "</b>\n" + htmlLineas.join("\n"),
  };
}

function tipoBonito(tipo?: string): string {
  if (tipo === "saldo") return "Saldo";
  if (tipo === "transferencia") return "Transferencia";
  return tipo ? tipo : "";
}

/* --- Plantilla por evento ------------------------------------------ */

/* Reporte nuevo -> al DUEÑO (lleva los botones Aprobar/Rechazar). */
export function plReporteNuevo(d: {
  nombre?: string; tipo?: string; cantidad?: unknown; precio?: unknown;
  porc?: unknown; nota?: string; cuando?: Date | string;
}): Plantilla {
  const datos: Dato[] = [];
  if (d.nombre) datos.push({ etiqueta: "De", valor: d.nombre });
  if (d.tipo) datos.push({ etiqueta: "Tipo", valor: tipoBonito(d.tipo) });
  if (d.cantidad != null) datos.push({ etiqueta: "Cantidad", valor: miles(d.cantidad) });
  if (d.precio != null) datos.push({ etiqueta: "Precio", valor: dinero(d.precio) + " CUP" });
  if (d.porc != null) datos.push({ etiqueta: "Al", valor: String(d.porc) + " %" });
  if (d.nota) datos.push({ etiqueta: "Nota", valor: d.nota });
  datos.push({ etiqueta: "Recibido", valor: horaPared(d.cuando) });
  return armar("📋 Reporte nuevo", datos,
    "Decide con los botones de abajo o revísalo en la Bandeja de Mi Negocio.");
}

/* Trato aprobado -> al buscador. */
export function plAprobado(d: { comision?: unknown }): Plantilla {
  const datos: Dato[] = [];
  if (d.comision != null) {
    datos.push({ etiqueta: "Tu comisión", valor: dinero(d.comision) + " CUP" });
  }
  return armar("✅ Trato aprobado", datos,
    "Ya cuenta en tu panel de Mi Trabajo.");
}

/* Trato rechazado -> al buscador (motivo opcional). */
export function plRechazado(d: { motivo?: string }): Plantilla {
  const datos: Dato[] = [];
  if (d.motivo) datos.push({ etiqueta: "Motivo", valor: d.motivo });
  return armar("❌ Trato no aprobado", datos,
    "Si tienes dudas, escríbele a Ernesto por el chat de tu app.");
}

/* Tarifa publicada -> al equipo. */
export function plTarifa(d: { ingreso?: unknown; libro?: unknown }): Plantilla {
  const datos: Dato[] = [];
  if (d.ingreso != null) {
    datos.push({ etiqueta: "Ingreso por recarga de 360", valor: dinero(d.ingreso) + " CUP" });
  }
  if (d.libro != null) {
    datos.push({ etiqueta: "Libro de referencia", valor: dinero(d.libro) + " CUP" });
  }
  return armar("📋 Nueva tarifa publicada", datos,
    "Ya está visible en tu app.");
}

/* Comisión pagada -> al buscador. */
export function plPagado(d: { comision?: unknown; cuando?: Date | string }): Plantilla {
  const datos: Dato[] = [];
  if (d.comision != null) {
    datos.push({ etiqueta: "Monto", valor: dinero(d.comision) + " CUP" });
  }
  datos.push({ etiqueta: "Pagada", valor: horaPared(d.cuando) });
  return armar("💰 Comisión pagada", datos,
    "Ernesto la marcó como pagada. Revísala en tu panel.");
}

/* Mensaje de chat nuevo -> al destinatario. */
export function plMensaje(d: { nombre?: string }): Plantilla {
  const datos: Dato[] = [];
  if (d.nombre) datos.push({ etiqueta: "De", valor: d.nombre });
  return armar("💬 Mensaje nuevo", datos,
    "Abre el chat en tu app para responder.");
}

/* Cierre semanal listo -> al buscador. */
export function plCierre(d: { total?: unknown }): Plantilla {
  const datos: Dato[] = [];
  if (d.total != null) {
    datos.push({ etiqueta: "Tu total de la semana", valor: dinero(d.total) + " CUP" });
  }
  return armar("🧾 Cierre semanal listo", datos,
    "El detalle está en tu app, en «Mi semana».");
}

/* Vínculo creado -> confirmación a quien se vinculó. */
export function plVinculoCreado(): Plantilla {
  return armar("🔗 Telegram vinculado", [],
    "Desde aquí te llegan los avisos de tu negocio al instante.");
}

/* Vínculo roto (403: bloqueó el bot) -> aviso INTERNO al dueño,
   que le llega por la otra vía (Web Push de Mi Negocio). */
export function plVinculoRoto(d: { nombre?: string }): Plantilla {
  const datos: Dato[] = [];
  if (d.nombre) datos.push({ etiqueta: "Quién", valor: d.nombre });
  return armar("⚠️ Vínculo de Telegram roto", datos,
    "Bloqueó el bot o perdió el vínculo. Sus avisos por la app siguen " +
    "activos; vuelve a mandarle su enlace de vinculación cuando puedas.");
}

/* Línea final que deja el mensaje de reporte tras decidir:
   «✅ Aprobado por ti · hoy 9:41 a. m.» (sin botones). */
export function lineaDecision(aprobado: boolean, cuando?: Date | string): string {
  return (aprobado ? "✅ Aprobado por ti · " : "❌ Rechazado por ti · ") +
    horaPared(cuando);
}

/* --- Textos de conversación (telegram-webhook) ----------------------
   El bot NO conversa libre: cada rol tiene su respuesta y fin. */

/* Bienvenida al Start — DUEÑO vinculado (v2: menú de botones). */
export const BIENVENIDA_DUENO =
  "👋 <b>Hola, Ernesto.</b>\n" +
  "Este es el bot de <b>Mi Negocio</b>, ahora con menú de botones.\n\n" +
  "Abajo tienes tu menú fijo: <b>Pendientes</b> para decidir reportes, " +
  "<b>Resumen</b> con las cuentas del negocio, <b>Por pagar</b> para " +
  "marcar comisiones pagadas con un toque, <b>Equipo</b> y <b>Tarifa</b>.\n\n" +
  "Y como siempre, cada reporte nuevo te llega aquí con sus botones " +
  "para aprobar o rechazar sin abrir la app.";

/* Bienvenida al Start — BUSCADOR vinculado (v2: sus 2 botones). */
export function bienvenidaBuscador(nombre?: string): string {
  const saludo = nombre ? "Hola, " + esc(nombre) + "." : "Hola.";
  return "👋 <b>" + saludo + "</b>\n" +
    "Tu Telegram quedó vinculado a tu cuenta del equipo.\n\n" +
    "Por aquí te aviso cuando Ernesto apruebe un trato tuyo, cuando " +
    "marque tu comisión como pagada y cuando salga tarifa nueva.\n\n" +
    "Abajo tienes tus dos botones: <b>📒 Lo mío</b> (tus comisiones por " +
    "pagar y las ya pagadas) y <b>🏆 Mi bono</b> (tu avance de la semana " +
    "hacia los bonos de +300 CUP). Solo ves TUS datos.\n\n" +
    "El chat oficial sigue en tu app <b>Mi Trabajo</b>: por ahí se " +
    "habla y se reporta.";
}

/* Bienvenida al Start — persona NO vinculada (y respuesta única
   cortés a cualquier desconocido que escriba). */
export const BIENVENIDA_NO_VINCULADO =
  "👋 <b>Hola.</b>\n" +
  "Soy el bot <b>privado</b> de avisos del equipo de Ernesto " +
  "(Mi Negocio).\n\n" +
  "Solo envío avisos a las cuentas que Ernesto vincula. Si eres del " +
  "equipo, abre tu app y toca tu enlace personal de vinculación, o " +
  "pídeselo a Ernesto.\n\n" +
  "Si no eres del equipo, este bot no es para ti: no vende nada ni " +
  "responde mensajes.";

/* /ayuda según el rol (v2: botones primero; comandos = respaldo). */
export function ayuda(rol: "dueno" | "equipo" | "fuera"): string {
  if (rol === "dueno") {
    return "🤖 <b>Qué hace este bot</b>\n" +
      "Se maneja con el <b>menú de botones</b> de abajo:\n" +
      "📥 <b>Pendientes</b> — reportes por decidir, con sus botones\n" +
      "📊 <b>Resumen</b> — las cuentas del negocio (la Contabilidad)\n" +
      "💰 <b>Por pagar</b> — comisiones por pagar, con botón «Ya pagué»\n" +
      "👥 <b>Equipo</b> — tus buscadores y cuánto le debes a cada uno\n" +
      "💲 <b>Tarifa</b> — la tarifa vigente (solo mirar; se edita en tus apps)\n\n" +
      "Y te avisa de cada reporte nuevo con botones para decidir, y de " +
      "los vínculos del equipo que se rompan.\n\n" +
      "<b>Comandos (respaldo):</b>\n" +
      "/start — tu bienvenida y el menú\n" +
      "/estado — estado del bot y de los vínculos\n" +
      "/vincular — renovar tu vínculo con tu código\n" +
      "/ayuda — esto mismo";
  }
  if (rol === "equipo") {
    return "🤖 <b>Qué hace este bot</b>\n" +
      "Se maneja con tus dos botones de abajo:\n" +
      "📒 <b>Lo mío</b> — tus comisiones por pagar y las ya pagadas\n" +
      "🏆 <b>Mi bono</b> — tu avance de la semana hacia los bonos\n\n" +
      "Y te avisa cuando Ernesto aprueba un trato tuyo, cuando paga tu " +
      "comisión y cuando publica tarifa nueva.\n\n" +
      "<b>Comandos (respaldo):</b>\n" +
      "/start — tu bienvenida\n" +
      "/vincular — renovar tu vínculo con tu código\n" +
      "/ayuda — esto mismo\n\n" +
      "Reportar y hablar va por tu app <b>Mi Trabajo</b>.";
  }
  return BIENVENIDA_NO_VINCULADO;
}

/* Texto libre de un BUSCADOR vinculado: se le redirige a su app. */
export const LIBRE_BUSCADOR =
  "Por aquí no converso 🙏\n" +
  "El chat del equipo vive en tu app <b>Mi Trabajo</b>: ábrela y " +
  "escribe por ahí. Este bot solo te trae avisos.";

/* Texto libre del DUEÑO. */
export const LIBRE_DUENO =
  "Toca un botón del <b>menú de abajo</b>, Ernesto 👇\n" +
  "Pendientes, Resumen, Por pagar, Equipo o Tarifa. Escribirme texto " +
  "no hace falta para nada.";

/* =====================================================================
   BOT PRO v2 — cuentas puras, callbacks, teclados y vistas.
   Las cuentas espejan EXACTO la Contabilidad de Mi Negocio (Fase 1):
   misma fuente (tabla reportes vía admin_reportes, sin filas de
   prueba) y mismas fórmulas del servidor con la tarifa vigente:
     bruta saldo         = (ingreso_ref360 − precio) × cantidad
     bruta transferencia = (precio × (1 + porc/100) ÷ libro_ref)
                           × salida_ref − precio
     neta                = bruta − comisión guardada en el trato
     capital             = saldo: precio × cantidad · transf.: precio
   Todo lo de esta sección es PURO (sin red): se prueba en local.
   ===================================================================== */

export interface ReporteFila {
  id: string;
  buscador: string;
  tipo: string;
  precio?: number | null;
  porc?: number | null;
  cantidad?: number | null;
  estado: string;
  comision?: number | null;
  comision_pagada_en?: string | null;
  creado_en: string;
  nota?: string | null;
  prueba?: boolean | null;
}

export interface TarifaFila {
  ingreso_ref360: number;
  libro_ref: number;
  salida_ref: number;
  comision_saldo: number;
  comision_transf: number;
  piso_transf: number;
}

export function brutaDe(r: ReporteFila, t: TarifaFila): number {
  if (r.tipo === "saldo") {
    return (Number(t.ingreso_ref360) - Number(r.precio || 0)) *
      Number(r.cantidad || 1);
  }
  const ef = Number(r.precio || 0);
  const pc = Number(r.porc || 0);
  return (ef * (1 + pc / 100) / Number(t.libro_ref)) * Number(t.salida_ref) - ef;
}

export function netaDe(r: ReporteFila, t: TarifaFila): number {
  return brutaDe(r, t) - Number(r.comision || 0);
}

export function capitalDe(r: ReporteFila): number {
  if (r.tipo === "saldo") return Number(r.precio || 0) * Number(r.cantidad || 1);
  return Number(r.precio || 0);
}

/* Fecha de pared (America/Havana) de un instante ISO: «2026-11-11». */
export function fechaHavana(f: Date | string | number): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Havana",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(f));
  const g = (tipo: string) => partes.find((p) => p.type === tipo)?.value || "";
  return g("year") + "-" + g("month") + "-" + g("day");
}

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(fecha + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/* Semana actual lunes→domingo según la pared de Ernesto. */
export function semanaHavana(ahora: Date = new Date()): { inicio: string; fin: string } {
  const hoy = fechaHavana(ahora);
  const dow = new Date(hoy + "T12:00:00Z").getUTCDay(); /* 0 = domingo */
  const desdeLunes = (dow + 6) % 7;
  const inicio = sumarDias(hoy, -desdeLunes);
  return { inicio, fin: sumarDias(inicio, 6) };
}

export function enSemana(r: ReporteFila, sem: { inicio: string; fin: string }): boolean {
  const f = fechaHavana(r.creado_en);
  return f >= sem.inicio && f <= sem.fin;
}

/* --- Callbacks v2 ---------------------------------------------------
   Prefijos PROPIOS (d: queda solo para decidir, heredado de v1 y
   reparado: ahora lleva el UUID del reporte, 40 bytes ≤ 64). */
export type VistaId = "pend" | "res" | "pagar" | "equipo" | "tarifa" | "lomio" | "bono" | "menu";
export type CallbackAccion =
  | { tipo: "decidir"; id: string; aprobar: boolean }
  | { tipo: "pagar"; id: string }
  | { tipo: "vista"; vista: VistaId };

const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RE_DECIDIR = new RegExp("^d:(" + UUID_RE + "):(a|r)$", "i");
const RE_PAGAR = new RegExp("^p:(" + UUID_RE + ")$", "i");
const RE_VISTA = /^v:(pend|res|pagar|equipo|tarifa|lomio|bono|menu)$/;

export function parseCallback(data: string): CallbackAccion | null {
  if (typeof data !== "string") return null;
  let m = RE_DECIDIR.exec(data);
  if (m) return { tipo: "decidir", id: m[1], aprobar: m[2] === "a" };
  m = RE_PAGAR.exec(data);
  if (m) return { tipo: "pagar", id: m[1] };
  m = RE_VISTA.exec(data);
  if (m) return { tipo: "vista", vista: m[1] as VistaId };
  return null;
}

export function cbDecidir(id: string, aprobar: boolean): string {
  return "d:" + id + (aprobar ? ":a" : ":r");
}
export function cbPagar(id: string): string { return "p:" + id; }
export function cbVista(v: VistaId): string { return "v:" + v; }

/* --- Teclados -------------------------------------------------------- */
export interface BotonInline { text: string; callback_data: string }
export type TecladoInline = { inline_keyboard: BotonInline[][] };
export type TecladoFijo = {
  keyboard: { text: string }[][];
  resize_keyboard: boolean;
  is_persistent: boolean;
};

export function tecladoDueno(): TecladoFijo {
  return {
    keyboard: [
      [{ text: "📥 Pendientes" }, { text: "📊 Resumen" }],
      [{ text: "💰 Por pagar" }, { text: "👥 Equipo" }],
      [{ text: "💲 Tarifa" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

export function tecladoBuscador(): TecladoFijo {
  return {
    keyboard: [[{ text: "📒 Lo mío" }, { text: "🏆 Mi bono" }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/* Texto exacto de cada botón del teclado fijo -> su vista. */
export const TEXTO_A_VISTA: Record<string, VistaId> = {
  "📥 Pendientes": "pend",
  "📊 Resumen": "res",
  "💰 Por pagar": "pagar",
  "👥 Equipo": "equipo",
  "💲 Tarifa": "tarifa",
  "📒 Lo mío": "lomio",
  "🏆 Mi bono": "bono",
};

export function botonesDecidir(id: string): TecladoInline {
  return {
    inline_keyboard: [[
      { text: "✅ Aprobar", callback_data: cbDecidir(id, true) },
      { text: "❌ Rechazar", callback_data: cbDecidir(id, false) },
    ]],
  };
}

export function botonMenuInline(): TecladoInline {
  return { inline_keyboard: [[{ text: "⬅️ Menú", callback_data: cbVista("menu") }]] };
}

/* --- Piezas de texto -------------------------------------------------- */

/* Descripción corta y humana de un trato, para listas. */
export function conceptoCorto(r: ReporteFila): string {
  if (r.tipo === "saldo") {
    return "Saldo · " + miles(r.cantidad || 0) + " recargas · " +
      dinero(r.precio || 0) + " CUP";
  }
  return "Transferencia · " + dinero(r.precio || 0) + " CUP" +
    (r.porc != null ? " al " + String(r.porc) + " %" : "");
}

function barra(n: number, meta: number, largo = 10): string {
  const p = meta > 0 ? Math.min(1, n / meta) : 0;
  const llenos = Math.round(p * largo);
  return "▓".repeat(llenos) + "░".repeat(largo - llenos);
}

/* Un mensaje listo para enviar: html + teclado inline opcional. */
export interface MensajeVista { html: string; botones?: TecladoInline }

/* --- Vista 📥 Pendientes (dueño) --------------------------------------
   Un mensaje por reporte, con sus botones de decidir (igual que el
   aviso suelto), precedidos de un encabezado si hay más de uno. */
export function mensajesPendientes(
  pendientes: ReporteFila[],
  nombreDe: (codigo: string) => string,
): MensajeVista[] {
  if (!pendientes.length) {
    return [{
      html: "<b>📥 Pendientes</b>\n" +
        "No tienes reportes esperando decisión. 🎉\n\n" +
        "Cuando un buscador reporte un trato, te llega aquí al " +
        "instante con sus botones para aprobar o rechazar.",
      botones: botonMenuInline(),
    }];
  }
  const lista = pendientes.slice(0, 10);
  const out: MensajeVista[] = [{
    html: "<b>📥 Pendientes (" + String(pendientes.length) + ")</b>\n" +
      "Estos reportes esperan tu decisión. Toca ✅ o ❌ en cada uno; " +
      "es lo mismo que decidir en la Bandeja de Mi Negocio.",
  }];
  for (const r of lista) {
    const pl = plReporteNuevo({
      nombre: nombreDe(r.buscador), tipo: r.tipo,
      cantidad: r.cantidad, precio: r.precio, porc: r.porc,
      nota: r.nota || undefined, cuando: r.creado_en,
    });
    out.push({ html: pl.html, botones: botonesDecidir(r.id) });
  }
  if (pendientes.length > lista.length) {
    out.push({
      html: "…y " + String(pendientes.length - lista.length) +
        " más: decídelos en la Bandeja de <b>Mi Negocio</b>.",
      botones: botonMenuInline(),
    });
  }
  return out;
}

/* --- Vista 📊 Resumen (dueño) ------------------------------------------ */
export function vistaResumen(d: {
  hayDatos: boolean;
  ganMes: number; nMes: number;
  porPagar: number; nSinPagar: number;
  capMes: number; recMes: number;
  netaSem: number; netaSemAnt: number;
}): MensajeVista {
  if (!d.hayDatos) {
    return {
      html: "<b>📊 Resumen</b>\n" +
        "Sin datos aún: cuando apruebes el primer trato, estas " +
        "cuentas se llenan solas.\n\n" +
        "Esto es la Contabilidad de tu negocio en el chat: sale de " +
        "los tratos aprobados de Mi Negocio, con la tarifa vigente.",
      botones: botonMenuInline(),
    };
  }
  let comp = "sin datos la semana anterior";
  if (d.netaSemAnt !== 0) {
    const pct = (d.netaSem - d.netaSemAnt) / Math.abs(d.netaSemAnt) * 100;
    comp = (pct >= 0 ? "▲ " : "▼ ") + dinero(Math.abs(pct)) + " %";
  }
  const html = "<b>📊 Resumen del negocio</b>\n" +
    "<b>Ganancia del mes:</b> " + dinero(d.ganMes) + " CUP (" +
    String(d.nMes) + " tratos aprobados)\n" +
    "<b>Comisiones por pagar:</b> " + dinero(d.porPagar) + " CUP (" +
    String(d.nSinPagar) + " sin pagar)\n" +
    "<b>Capital movido (mes):</b> " + dinero(d.capMes) + " CUP\n" +
    "<b>Recargas movidas (mes):</b> " + miles(d.recMes) + "\n" +
    "<b>Esta semana:</b> " + dinero(d.netaSem) + " CUP · " +
    "<b>la anterior:</b> " + dinero(d.netaSemAnt) + " CUP (" + comp + ")\n\n" +
    "Sale solo de los tratos aprobados que entraron por el sistema, " +
    "con la tarifa vigente. Lo que mueves por fuera (ventas directas, " +
    "tu salida con tu comprador) no aparece aquí.";
  return {
    html,
    botones: {
      inline_keyboard: [
        [
          { text: "💰 Por pagar", callback_data: cbVista("pagar") },
          { text: "📥 Pendientes", callback_data: cbVista("pend") },
        ],
        [{ text: "💲 Tarifa", callback_data: cbVista("tarifa") }],
      ],
    },
  };
}

/* --- Vista 💰 Por pagar (dueño) -----------------------------------------
   Una sola tarjeta: el texto lista cada comisión y el teclado trae
   un botón «💰 Ya pagué» por renglón (máx. 15; el resto, a la app). */
export function vistaPorPagar(
  sinPagar: ReporteFila[],
  nombreDe: (codigo: string) => string,
): MensajeVista {
  if (!sinPagar.length) {
    return {
      html: "<b>💰 Por pagar</b>\n" +
        "No debes ninguna comisión ahora mismo. 🎉",
      botones: botonMenuInline(),
    };
  }
  const total = sinPagar.reduce((s, r) => s + Number(r.comision || 0), 0);
  const lineas = sinPagar.map((r) =>
    "· <b>" + esc(nombreDe(r.buscador)) + "</b> — " + esc(conceptoCorto(r)) +
    " — comisión <b>" + dinero(r.comision || 0) + " CUP</b>");
  const conBoton = sinPagar.slice(0, 15);
  const filas: BotonInline[][] = conBoton.map((r) => [{
    text: "💰 Ya pagué · " + nombreDe(r.buscador) + " · " + dinero(r.comision || 0),
    callback_data: cbPagar(r.id),
  }]);
  filas.push([{ text: "⬅️ Menú", callback_data: cbVista("menu") }]);
  let html = "<b>💰 Por pagar — total " + dinero(total) + " CUP</b>\n" +
    lineas.join("\n") + "\n\n" +
    "Toca <b>«💰 Ya pagué»</b> SOLO cuando ya le entregaste el dinero: " +
    "queda sellado en la base y sale de esta lista.";
  if (sinPagar.length > conBoton.length) {
    html += "\n\nSe muestran los primeros " + String(conBoton.length) +
      " botones; el resto está en la Contabilidad de Mi Negocio.";
  }
  return { html, botones: { inline_keyboard: filas } };
}

/* --- Vista 👥 Equipo (dueño) -------------------------------------------- */
export function vistaEquipo(filas: {
  nombre: string; porPagar: number; nPorPagar: number;
  nAprobados: number; vinculado: boolean;
}[]): MensajeVista {
  if (!filas.length) {
    return {
      html: "<b>👥 Equipo</b>\nTodavía no hay buscadores en el equipo.",
      botones: botonMenuInline(),
    };
  }
  const lineas = filas.map((f) =>
    "· <b>" + esc(f.nombre) + "</b> — por pagar: <b>" +
    dinero(f.porPagar) + " CUP</b> (" + String(f.nPorPagar) + ") · " +
    "aprobados: " + String(f.nAprobados) + " · Telegram: " +
    (f.vinculado ? "✅ vinculado" : "— sin vincular"));
  return {
    html: "<b>👥 Tu equipo</b>\n" + lineas.join("\n") + "\n\n" +
      "«Por pagar» es lo que le debes a cada uno por comisiones " +
      "aprobadas. Quien no tenga Telegram vinculado no recibe los " +
      "avisos del bot: mándale su enlace desde Mi Trabajo.",
    botones: botonMenuInline(),
  };
}

/* --- Vista 💲 Tarifa (dueño) --------------------------------------------- */
export function vistaTarifa(t: TarifaFila): MensajeVista {
  return {
    html: "<b>💲 Tarifa vigente</b>\n" +
      "<b>Ingreso por recarga de 360:</b> " + dinero(t.ingreso_ref360) + " CUP\n" +
      "<b>Libro BANK_CUP:</b> " + dinero(t.libro_ref) + " CUP por QUSD\n" +
      "<b>Salida de referencia:</b> " + dinero(t.salida_ref) + " CUP por QUSD\n" +
      "<b>Comisión saldo:</b> " + String(t.comision_saldo) + " % del excedente\n" +
      "<b>Comisión transferencia:</b> " + String(t.comision_transf) + " % de la ganancia\n" +
      "<b>Piso de transferencia:</b> " + String(t.piso_transf) + " %\n\n" +
      "Es la tarifa que usan las apps y estas cuentas. Para " +
      "cambiarla, usa <b>Mi Negocio</b> o PanelPRO: desde el bot " +
      "solo se mira, no se toca.",
    botones: botonMenuInline(),
  };
}

/* --- Vista 📒 Lo mío (buscador) ------------------------------------------ */
export function vistaLoMio(d: {
  porPagar: ReporteFila[];
  pagados: ReporteFila[];
  ultimos: ReporteFila[];
}): MensajeVista {
  const totPorPagar = d.porPagar.reduce((s, r) => s + Number(r.comision || 0), 0);
  const totPagado = d.pagados.reduce((s, r) => s + Number(r.comision || 0), 0);
  let html = "<b>📒 Lo mío</b>\n" +
    "<b>Ernesto te debe:</b> " + dinero(totPorPagar) + " CUP (" +
    String(d.porPagar.length) + " comisiones por pagar)\n" +
    "<b>Ya te pagó:</b> " + dinero(totPagado) + " CUP (" +
    String(d.pagados.length) + ")\n";
  if (d.ultimos.length) {
    html += "\n<b>Tus últimos tratos aprobados:</b>\n" + d.ultimos.map((r) =>
      "· " + esc(conceptoCorto(r)) + " — comisión " +
      dinero(r.comision || 0) + " CUP" +
      (r.comision_pagada_en ? " · ✅ pagada" : " · por pagar")).join("\n") + "\n";
  }
  html += "\nEsto sale de tus tratos aprobados en <b>Mi Trabajo</b>. " +
    "Solo tú ves estos números.";
  return { html, botones: botonMenuInline() };
}

/* --- Vista 🏆 Mi bono (buscador) ------------------------------------------ */
export const META_BONO_SALDO = 150;
export const META_BONO_TRANSF = 10;
export const BONO_CUP = 300;

export function vistaBono(d: {
  recargasSemana: number;
  tratosTransfSemana: number;
}): MensajeVista {
  const faltaS = Math.max(0, META_BONO_SALDO - d.recargasSemana);
  const faltaT = Math.max(0, META_BONO_TRANSF - d.tratosTransfSemana);
  const html = "<b>🏆 Mi bono — esta semana</b>\n" +
    "El esquema paga un bono de <b>" + String(BONO_CUP) + " CUP</b> por " +
    "cada meta que cumplas en la semana (lunes a domingo):\n\n" +
    "📱 <b>Recargas de saldo:</b> " + String(d.recargasSemana) + " de " +
    String(META_BONO_SALDO) + "\n" + barra(d.recargasSemana, META_BONO_SALDO) +
    (faltaS > 0 ? "\nTe faltan " + String(faltaS) + " recargas." : "\n✅ ¡Meta cumplida!") +
    "\n\n🏦 <b>Tratos de transferencia:</b> " + String(d.tratosTransfSemana) +
    " de " + String(META_BONO_TRANSF) + "\n" +
    barra(d.tratosTransfSemana, META_BONO_TRANSF) +
    (faltaT > 0 ? "\nTe faltan " + String(faltaT) + " tratos." : "\n✅ ¡Meta cumplida!") +
    "\n\nAl llegar a la meta, el bono se suma a tus comisiones de la " +
    "semana. La cuenta final la confirma Ernesto.";
  return { html, botones: botonMenuInline() };
}

/* /estado — solo el dueño (la función receptora valida el rol). */
export function estadoDueno(d: { vinculados: number; cuando?: Date | string }): string {
  return "🤖 <b>Estado del bot</b>\n" +
    "<b>Tu vínculo:</b> activo ✅\n" +
    "<b>Cuentas vinculadas:</b> " + String(d.vinculados) + "\n" +
    "<b>Hora:</b> " + esc(horaPared(d.cuando));
}

export const ESTADO_NO_DUENO = "Ese comando es solo de Ernesto 🙏";

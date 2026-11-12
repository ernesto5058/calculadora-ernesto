// =====================================================================
// puerta.js — decisiones PURAS de la puerta del Agente Propio
// (TANDA Nº4 del Inspector Ola 1: E1/E2/E5/E6).
// Sin IO: solo fechas, conteos y decisiones. La puerta (index.ts)
// trae los datos vivos y ejecuta lo que aquí se decide; el banco
// bancos/prueba-agente-puerta.mjs prueba estas funciones tal cual.
// =====================================================================

export const VENTANA_24H_MS = 24 * 3600 * 1000;
export const TTL_ESCALADO_MS = VENTANA_24H_MS;
/** Tope global diario de avisos de escalado/lead al dueño (E2). */
export const TOPE_AVISOS_DUENO_DIA = 20;

const msDe = (v) => {
  if (v == null) return NaN;
  if (typeof v === "number") return v;
  if (v instanceof Date) return v.getTime();
  return new Date(String(v)).getTime();
};

/** Inicio de la ventana rodante de 24 h (ISO) para filtrar en la BD. */
/** @param {number|string|Date} [ahora] @returns {string} */
export function inicioVentana24h(ahora = Date.now()) {
  return new Date(msDe(ahora) - VENTANA_24H_MS).toISOString();
}

/** Cuántas marcas de tiempo caen DENTRO de la ventana rodante de 24 h. */
/** @param {unknown[]} [fechas] @param {number|string|Date} [ahora] @returns {number} */
export function conteoEnVentana24h(fechas = [], ahora = Date.now()) {
  const fin = msDe(ahora);
  const desde = fin - VENTANA_24H_MS;
  let n = 0;
  for (const f of fechas ?? []) {
    const t = msDe(f);
    if (Number.isFinite(t) && t >= desde && t <= fin) n++;
  }
  return n;
}

/**
 * E1 — Tope de mensajes por sesión: ventana RODANTE de 24 h (no «de
 * por vida» ni «por día natural») y el dueño de Telegram JAMÁS se
 * bloquea (si no, podría quedar fuera de su propio /admin).
 * Acepta {fechas:[...]} o {conteo:n} ya filtrado por la consulta.
 */
/** @param {{fechas?: unknown[], conteo?: number, tope?: number, esDueno?: boolean, ahora?: number|string|Date}} [opts] @returns {boolean} */
export function sesionBloqueada({ fechas, conteo, tope = 40, esDueno = false, ahora = Date.now() } = {}) {
  if (esDueno) return false;
  const limite = Number(topoValido(tope, 40));
  const n = Array.isArray(fechas) ? conteoEnVentana24h(fechas, ahora) : Number(conteo ?? 0);
  return Number.isFinite(n) && n >= limite;
}

function topoValido(tope, defecto) {
  const n = Number(tope);
  return Number.isFinite(n) && n > 0 ? n : defecto;
}

/** Fecha habanera (YYYY-MM-DD) de un instante, como la calcula procesar. */
/** @param {number|string|Date} [ahora] @returns {string} */
export function fechaHabana(ahora = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Havana" }).format(new Date(msDe(ahora)));
}

function desplazamientoHabana(instanteMs) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Havana", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
  const p = {};
  for (const part of dtf.formatToParts(new Date(instanteMs))) p[part.type] = part.value;
  const comoUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour === "24" ? 0 : p.hour), Number(p.minute), Number(p.second));
  return comoUTC - Math.floor(instanteMs / 1000) * 1000;
}

/** Instante ISO del inicio del día habanero actual (medianoche en La Habana). */
/** @param {number|string|Date} [ahora] @returns {string} */
export function inicioDiaHabanaISO(ahora = new Date()) {
  const hoy = fechaHabana(ahora);
  const [y, m, d] = hoy.split("-").map(Number);
  const medianocheUTC = Date.UTC(y, m - 1, d, 0, 0, 0);
  let instante = medianocheUTC - desplazamientoHabana(medianocheUTC);
  instante = medianocheUTC - desplazamientoHabana(instante);
  return new Date(instante).toISOString();
}

/** E2 — ¿Se alcanzó el tope diario (conversaciones nuevas / avisos)? */
/** @param {number} conteoHoy @param {number} [tope] @param {number} [defecto] @returns {boolean} */
export function topeDiarioAlcanzado(conteoHoy, tope, defecto = 100) {
  const n = Number(conteoHoy ?? 0);
  return Number.isFinite(n) && n >= topoValido(tope, defecto);
}

/**
 * E2 — Degradación por tope global diario de conversaciones NUEVAS:
 * solo degrada si la conversación es NUEVA, se alcanzó el tope de
 * `tope_conversaciones_dia` y quien escribe NO es el dueño.
 */
/** @param {{conteoHoy?: number, tope?: number, esDueno?: boolean, esNueva?: boolean}} [opts] @returns {boolean} */
export function debeDegradarPorTopeDiario({ conteoHoy, tope = 100, esDueno = false, esNueva = true } = {}) {
  if (!esNueva || esDueno) return false;
  return topeDiarioAlcanzado(conteoHoy, tope, 100);
}

/** E2 — Avisos de escalado/lead al dueño: ¿queda cupo hoy? */
/** @param {{conteoHoy?: number, tope?: number, esDueno?: boolean}} [opts] @returns {boolean} */
export function avisosDuenoPermitidos({ conteoHoy, tope = TOPE_AVISOS_DUENO_DIA, esDueno = false } = {}) {
  if (esDueno) return true;
  return !topeDiarioAlcanzado(conteoHoy, tope, TOPE_AVISOS_DUENO_DIA);
}

/**
 * E6 — Escalado con caducidad: una conversación escalada cuya última
 * actividad previa es de hace más de 24 h se REABRE (si no, quedaba
 * muda para siempre: `escalada` nunca volvía a false).
 */
/** @param {{escalada?: boolean, ultimoEn?: unknown, ahora?: number|string|Date, ttlMs?: number}} [opts] @returns {boolean} */
export function escaladoCaducado({ escalada, ultimoEn, ahora = Date.now(), ttlMs = TTL_ESCALADO_MS } = {}) {
  if (escalada !== true) return false;
  const prev = msDe(ultimoEn);
  if (!Number.isFinite(prev)) return false;
  return msDe(ahora) - prev >= ttlMs;
}

/**
 * E5 — Fail-closed de configuración: la lectura debe distinguir
 * «falló» (ok=false: red/HTTP) de «vacío» (sin fila). En ambos casos
 * la decisión es SILENCIO: sin config no hay frenos fiables ni forma
 * de identificar al dueño, así que no se procesa nada.
 */
/** @param {{ok?: boolean, fila?: Record<string, unknown>|null}} [opts] @returns {"silencio"|"seguir"} */
export function decisionPorConfig({ ok, fila } = {}) {
  if (ok !== true) return "silencio";
  if (!fila || typeof fila !== "object" || Object.keys(fila).length === 0) return "silencio";
  return "seguir";
}

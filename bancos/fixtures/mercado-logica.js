// FIXTURE para CI: copia exacta de la lógica viva del lector de Mercado
// (mercado-src/supabase/functions/mercado-lector/logica.js), que vive fuera del repo.
// Si la lógica cambia, se refresca esta copia en el mismo cambio.
// logica.js — matemática pura del lector de mercado (sin red ni reloj
// propio: todo entra por parámetros). La comparten la Edge Function
// (Deno, la importa tal cual) y el banco de pruebas (Node), para que
// lo probado sea exactamente lo desplegado.
// Unidades: las tasas del libro y los promedios de ETECSA van en
// SALDO por QUSD; BANK_CUP en CUP por QUSD; el equilibrio en SALDO
// por QUSD; salida en CUP por QUSD; costo en CUP por recarga de 360.

export const TRAMPA_RATIO = 2500;   // oferta trampa conocida (ratio absurdo)
export const FRESCURA_MAX_MIN = 30; // la fuente recalcula cada ~5 min

export function num(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// Una oferta sirve para los niveles si: ratio válido, no es la trampa,
// y no es oferta propia de Ernesto (la función marca las suyas con
// mine=true antes de pasarlas aquí).
export function ofertaValida(o) {
  if (!o || typeof o !== "object") return false;
  const r = num(o.ratio);
  if (r === null || r <= 0 || r >= TRAMPA_RATIO) return false;
  if (o.mine === true) return false;
  return true;
}

// USD reales detrás de una oferta: en las flexibles manda lo que queda
// (available_amount); en las fijas, el monto (amount).
export function usdDeOferta(o) {
  const flexible = num(o && o.available_amount);
  if (flexible !== null) return flexible;
  const fijo = num(o && o.amount);
  return fijo !== null ? fijo : 0;
}

// Top del libro de COMPRA: la mayor tasa (saldo por QUSD) ofrecida.
export function topCompra(ofertas) {
  let top = null;
  for (const o of ofertas || []) {
    if (!ofertaValida(o)) continue;
    const r = num(o.ratio);
    if (top === null || r > top) top = r;
  }
  return top;
}

// Nivel 20: la mayor tasa de compra con al menos 20 USD detrás. Es el
// nivel que manda en la regla de demanda (el top solo puede ser un
// anuncio de 1 USD puesto para engañar).
export function nivel20(ofertas) {
  let top = null;
  for (const o of ofertas || []) {
    if (!ofertaValida(o)) continue;
    if (usdDeOferta(o) < 20) continue;
    const r = num(o.ratio);
    if (top === null || r > top) top = r;
  }
  return top;
}

// Top del libro de VENTA: la menor tasa (saldo por QUSD) pedida.
export function topVenta(ofertas) {
  let top = null;
  for (const o of ofertas || []) {
    if (!ofertaValida(o)) continue;
    const r = num(o.ratio);
    if (top === null || r < top) top = r;
  }
  return top;
}

// Frescura con DOS relojes: edad del dato de ORIGEN (updated_at de la
// fuente) medida al recibirlo. Dato viejo o cacheado => false, y de
// una foto no fresca NO se concluye nada (Regla 7).
export function esFresca(origenIso, ahoraMs, maxMin = FRESCURA_MAX_MIN) {
  if (!origenIso) return false;
  const t = Date.parse(origenIso);
  if (!Number.isFinite(t)) return false;
  const edad = ahoraMs - t;
  return edad <= maxMin * 60000 && edad >= -60000;
}

// Equilibrio del día: tasa (saldo por QUSD) a la que Ernesto empata
// con su costo. eq = 360 * salida / costo. Sin costo cargado => null:
// el número no se inventa jamás.
export function equilibrio(salida, costo) {
  const s = num(salida), c = num(costo);
  if (s === null || c === null || s <= 0 || c <= 0) return null;
  return Math.round((360 * s / c) * 100) / 100;
}

// La regla de demanda de Ernesto: compras reales >= umbral (25) Y
// nivel20 <= umbral (300 saldo por QUSD).
export function cumpleDemanda(countBuy, nivel, umbralCount = 25, umbralNivel = 300) {
  const cb = num(countBuy), n = num(nivel);
  if (cb === null || n === null) return false;
  return cb >= umbralCount && n <= umbralNivel;
}

// Máquina de estados de la demanda — DOS lecturas consecutivas antes
// de avisar, nunca una sola:
//   · lectura no usable (foto vieja o sin libro): el estado NO se
//     toca (ni confirma ni desconfirma) — Regla 7.
//   · cumple con pendiente=0 -> pendiente=1, sin aviso.
//   · cumple con pendiente=1 -> AVISO, alertada=true, pendiente=0.
//   · cumple ya alertada -> nada (no repetir el aviso).
//   · no cumple -> pendiente=0 y alertada=false (rearme limpio).
export function evaluarDemanda(estado, lectura) {
  const e = {
    pendiente: (estado && estado.pendiente) || 0,
    alertada: Boolean(estado && estado.alertada),
  };
  if (!lectura || lectura.usable !== true) {
    return { pendiente: e.pendiente, alertada: e.alertada, avisar: false, cambio: false };
  }
  if (lectura.cumple) {
    if (e.alertada) return { pendiente: e.pendiente, alertada: true, avisar: false, cambio: false };
    if (e.pendiente >= 1) return { pendiente: 0, alertada: true, avisar: true, cambio: true };
    return { pendiente: 1, alertada: false, avisar: false, cambio: true };
  }
  const cambio = e.pendiente !== 0 || e.alertada !== false;
  return { pendiente: 0, alertada: false, avisar: false, cambio };
}

// Tasa a la que publicar sin regalar margen: el nivel20 del libro o el
// equilibrio, el MENOR de los dos (por encima del equilibrio pierde).
export function tasaSugerida(nivel, eq) {
  const n = num(nivel), e = num(eq);
  if (n === null) return null;
  if (e === null) return n;
  return Math.min(n, e);
}

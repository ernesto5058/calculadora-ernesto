// FIXTURE para CI: copia exacta de la lógica del Analista
// (mercado-src/supabase/functions/mercado-lector/analista.js), que vive
// fuera del repo; solo cambia la ruta de su import (mercado-logica.js).
// Si la lógica cambia, se refresca esta copia en el mismo cambio.
// analista.js — matemática pura del ANALISTA DE MERCADO (Fase 1).
// La comparten la Edge Function «mercado-lector» (Deno, la importa tal
// cual) y el banco de pruebas (Node), para que lo probado sea
// exactamente lo desplegado — el mismo patrón que logica.js.
// La app SOLO pinta lo que este módulo calcula: ninguna fórmula del
// Analista vive en el cliente.
//
// Fuentes del diseño (aprobado por Ernesto «así tal cual», 2026-11-11):
//   research_notes/analista-mercado-estudio-2026-11-11/report.md
//   (§2 honestidad, §4 fórmulas, §5.4 invariantes INV-A1…A10)
//   research_notes/analista-automatizacion-segura-estudio-2026-11-11/
//   report.md (§3.1 collar y zonas: G<0 prohibido · 0≤G<+25 solo con
//   toque · ≥+25 zona automática futura)
//
// Unidades, SIEMPRE escritas: tasas ETECSA en SALDO por QUSD; BANK_CUP
// en CUP por QUSD; salida en CUP por QUSD; costo en CUP por recarga de
// 360; ganancias en CUP por recarga de 360. Saldo ≠ CUP ≠ QUSD.
import { num, ratioDe, ofertaValida, usdDeOferta } from "./mercado-logica.js";

export const TEXTO_ANTI_HUMO =
  "Esto no predice el mercado: lee el libro de ahora y aplica TUS reglas " +
  "con TU tarifa. Cada número lleva su hora. La oferta la pones tú.";

export const COLCHON_SALDO = 5;    // saldo por QUSD bajo el equilibrio
export const UMBRAL_FINA = 25;     // CUP por 360: suelo de la zona automática
export const TICK = 1;             // saldo por QUSD (peldaño Inmediato)
export const TRAMO_DURA_USD = 20;  // USD mínimos tras una oferta dura
export const MARGEN_VUELTA = 0.10; // 10 %: venta anómala (§4.4b)
export const NIVELES_ESCALERA = 10;

// Formato interno sin locale (la app y Telegram formatean al pintar).
export function fmtNum(x, dec = 2) {
  const n = num(x);
  if (n === null) return "—";
  return n.toFixed(dec).replace(".", ",");
}

// Ganancia de Ernesto vendiendo a la tasa R (saldo por QUSD):
//   G(R) = (360 ÷ R) × salida − costo     [CUP por recarga de 360]
// Vectores del estudio: G(333)=0 · G(320)=+40,63 · G(315)=+57,14 ·
// G(305,08)=+91,52 · G(340)=−20,59 (salida 925, costo 1000).
export function ganancia(R, salida, costo) {
  const r = num(R), s = num(salida), c = num(costo);
  if (r === null || s === null || c === null || r <= 0 || s <= 0 || c <= 0) return null;
  return Math.round(((360 / r) * s - c) * 100) / 100;
}

// Zona del collar (Estudio 2 §3.1): 'negativa' (prohibida) ·
// 'fina' (solo con su toque) · 'automatica' (≥ +25; el Nivel 2 no se
// construye: en Fase 1 también exige su toque, pero sin etiqueta fina).
export function zonaDe(g) {
  const x = num(g);
  if (x === null) return null;
  if (x < 0) return "negativa";
  if (x < UMBRAL_FINA) return "fina";
  return "automatica";
}

// ---------------------------------------------------------------------
// Escalera: niveles (tasa, USD del nivel, USD acumulado) del libro.
// Orden de la casa — el mismo en que el lector pide el libro a la API:
// COMPRA descendente desde la mayor tasa; VENTA ascendente desde la
// menor. Solo ofertas válidas (logica.js: sin trampa, sin propias).
// ---------------------------------------------------------------------
export function escalera(ofertas, lado) {
  const porTasa = new Map();
  for (const o of ofertas || []) {
    if (!ofertaValida(o)) continue;
    const r = ratioDe(o);
    if (r === null) continue;
    const tasa = Math.round(r * 100) / 100;
    porTasa.set(tasa, (porTasa.get(tasa) || 0) + usdDeOferta(o));
  }
  const tasas = [...porTasa.keys()].sort((a, b) => (lado === "compra" ? b - a : a - b));
  let acumulado = 0;
  return tasas.slice(0, NIVELES_ESCALERA).map((tasa) => {
    const usd = Math.round(porTasa.get(tasa) * 100) / 100;
    acumulado = Math.round((acumulado + usd) * 100) / 100;
    return { tasa, usd, acumulado };
  });
}

export function usdTotalEscalera(esc) {
  if (!esc || !esc.length) return 0;
  return esc[esc.length - 1].acumulado;
}

// ---------------------------------------------------------------------
// Precio EJECUTABLE (taker): recorrer la escalera de COMPRA en su
// orden (desde la mayor tasa, como nivel20) hasta juntar el tamaño S.
// Sin profundidad bastante -> null HONESTO («solo hay Y USD»): un
// promedio de mentira es peor que un null (INV-A3).
// ---------------------------------------------------------------------
export function vwapCompra(escCompra, usdObjetivo) {
  const S = num(usdObjetivo);
  if (S === null || S <= 0 || !escCompra || !escCompra.length) return null;
  let queda = S, sumaPonderada = 0;
  for (const nivel of escCompra) {
    const toma = Math.min(nivel.usd, queda);
    if (toma > 0) { sumaPonderada += toma * nivel.tasa; queda -= toma; }
    if (queda <= 1e-9) break;
  }
  if (queda > 1e-9) return null;
  return {
    tasa: Math.round((sumaPonderada / S) * 100) / 100,
    usd: S,
    usdDisponible: usdTotalEscalera(escCompra),
  };
}

// Lo que el libro de compra SÍ alcanza a ejecutar (para el null honesto).
export function ejecutableParcial(escCompra) {
  const total = usdTotalEscalera(escCompra || []);
  if (!total) return null;
  const v = vwapCompra(escCompra, total);
  return v ? { tasa: v.tasa, usd: total } : null;
}

// ---------------------------------------------------------------------
// Menú maker de 3 peldaños (§4.1). Cada peldaño lleva su G, su zona y
// la profundidad «por delante»: los USD del libro de VENTA en tasas
// MAYORES que la suya (lo que un comprador se llevaría antes que la
// oferta de Ernesto a esa tasa: a más por delante, más espera).
// Peldaño con G<0 NO se ofrece: va bloqueado con su porqué (INV-A1).
// ---------------------------------------------------------------------
export function profundidadDelante(escVenta, tasa) {
  const r = num(tasa);
  if (r === null || !escVenta) return 0;
  let s = 0;
  for (const n of escVenta) if (n.tasa > r) s += n.usd;
  return Math.round(s * 100) / 100;
}

export function menuMaker({ topVenta, nivel20, equilibrio: eq, salida, costo, escVenta }) {
  const e = num(eq);
  const techo = e === null ? null : Math.round((e - COLCHON_SALDO) * 100) / 100;
  const tv = num(topVenta), n20 = num(nivel20);
  const mk = (nombre, tasa, explica) => {
    if (tasa === null) {
      return {
        nombre, tasa: null, g: null, zona: null, delanteUsd: null,
        bloqueado: true, explica,
        motivo: "Falta un dato del libro o de tu tarifa para este peldaño.",
      };
    }
    const g = ganancia(tasa, salida, costo);
    const bloqueado = g === null || g < 0;
    return {
      nombre, tasa, g, zona: zonaDe(g),
      delanteUsd: profundidadDelante(escVenta, tasa),
      bloqueado, explica,
      motivo: bloqueado
        ? (g === null
          ? "Sin tu tarifa completa (salida y costo) no se calcula la ganancia: no se ofrece."
          : `A esa tasa pierdes ${fmtNum(Math.abs(g))} CUP por recarga de 360: no se ofrece.`)
        : null,
    };
  };
  const peldanos = [
    mk("Inmediato",
      tv === null || techo === null ? null : Math.min(tv + TICK, techo),
      "Un tick sobre la cima de venta, sin pasar tu techo: el primero de la fila."),
    mk("Equilibrado",
      tv === null || techo === null ? null : Math.min(tv, techo),
      "Iguala la cima de venta de ahora: equilibrio entre rapidez y ganancia."),
    mk("Paciente",
      n20 === null ? null : n20,
      "Al nivel de 20 USD del libro de compra: la mayor ganancia, la mayor espera."),
  ];
  return { techo, libroVentaUsd: usdTotalEscalera(escVenta || []), peldanos };
}

// ---------------------------------------------------------------------
// Marcas de contraparte (§4.4): SOLO sobre campos del objeto User del
// payload (la sonda del lector verifica qué campos existen de verdad;
// si el payload no trae reputación, la marca es null y la alerta lo
// dice tal cual: no se inventa).
//   🔴 floja  = rating < 4,3 o completadas < 25
//   🟡 nueva  = < 5 operaciones o sin rating
//   🟢 el resto (con su rating y sus operaciones)
// ---------------------------------------------------------------------
const CAMPOS_RATING = ["p2p_average_rating", "average_rating", "rating"];
const CAMPOS_OPS = ["p2p_completed_count", "completed_count", "p2p_trades", "trades", "completed"];

export function reputacionDe(user) {
  if (!user || typeof user !== "object") return { rating: null, ops: null };
  let rating = null, ops = null;
  for (const k of CAMPOS_RATING) { const v = num(user[k]); if (v !== null) { rating = v; break; } }
  for (const k of CAMPOS_OPS) { const v = num(user[k]); if (v !== null) { ops = v; break; } }
  return { rating, ops };
}

export function marcaDe(user) {
  const { rating, ops } = reputacionDe(user);
  if (rating === null && ops === null) return null;
  if ((ops !== null && ops < 5) || rating === null) {
    return { nivel: "amarilla", texto: "🟡 nueva" };
  }
  if (rating < 4.3 || (ops !== null && ops < 25)) {
    return { nivel: "roja", texto: "🔴 floja" };
  }
  return { nivel: "verde", texto: `🟢 ${fmtNum(rating, 1)}★ · ${Math.round(ops ?? 0)} ops` };
}

export function textoMarca(user) {
  const m = marcaDe(user);
  return m ? m.texto : "sin datos de reputación en el payload";
}

// ---------------------------------------------------------------------
// Detector de ofertas DURAS (§4.4). Devuelve las duras de ESTA foto:
//   (a) COMPRA dura: R ≤ eq − colchón, tamaño ≥ tramo, no propia, no
//       trampa, G(R) ≥ +25 y SIN marca roja (una dura de contraparte
//       floja no se avisa como dura: queda en «descartadas» con motivo).
//   (b) VENTA anómala: R_v ≥ R_ej,compra × (1 + 10 %) — su % es la
//       vuelta interna bruta del rodeo (informativa; jamás se actúa).
// ---------------------------------------------------------------------
export function detectarDuras({ compras, ventas, eq, salida, costo, escCompra }) {
  const e = num(eq);
  const duras = [], descartadas = [];
  if (e !== null) {
    for (const o of compras || []) {
      if (!ofertaValida(o)) continue;
      const r = ratioDe(o); if (r === null) continue;
      const usd = usdDeOferta(o);
      const g = ganancia(r, salida, costo);
      if (r <= e - COLCHON_SALDO && usd >= TRAMO_DURA_USD && g !== null && g >= UMBRAL_FINA) {
        const user = o.User || o.owner || null;
        const marca = marcaDe(user);
        const base = {
          lado: "compra", uuid: o.uuid ? String(o.uuid) : null,
          tasa: Math.round(r * 100) / 100, usd, g360: g,
          marca: marca ? marca.texto : textoMarca(user),
          marcaNivel: marca ? marca.nivel : null,
        };
        if (marca && marca.nivel === "roja") descartadas.push({ ...base, motivo: "contraparte floja" });
        else duras.push(base);
      }
    }
  }
  const rEj = vwapCompra(escCompra, TRAMO_DURA_USD);
  if (rEj) {
    for (const o of ventas || []) {
      if (!ofertaValida(o)) continue;
      const r = ratioDe(o); if (r === null) continue;
      if (r >= rEj.tasa * (1 + MARGEN_VUELTA)) {
        const user = o.User || o.owner || null;
        const marca = marcaDe(user);
        duras.push({
          lado: "venta", uuid: o.uuid ? String(o.uuid) : null,
          tasa: Math.round(r * 100) / 100, usd: usdDeOferta(o),
          vueltaPct: Math.round(((r / rEj.tasa) - 1) * 1000) / 10,
          marca: marca ? marca.texto : textoMarca(user),
          marcaNivel: marca ? marca.nivel : null,
        });
      }
    }
  }
  // La mejor primero: compras por G desc; ventas por vuelta desc.
  duras.sort((a, b) => (b.g360 ?? b.vueltaPct ?? 0) - (a.g360 ?? a.vueltaPct ?? 0));
  return { duras, descartadas };
}

// ---------------------------------------------------------------------
// Transferencia (§4.3): con B_ej = precio ejecutable de comprar QUSD
// pagando por transferencia (CUP por QUSD, del libro BANK_CUP):
//   d_min = 1 − salida ÷ B_ej          (descuento mínimo para empatar)
//   B_max(d) = salida ÷ (1 − d)        (lo más que puede pagar)
//   ganancia por QUSD = salida − B_ej × (1 − d)
// La prima callejera «al X %» (pagar T transferencia por E efectivo)
// es OTRA notación del mismo número: d = X ÷ (1 + X).
// CUP-transferencia y CUP-efectivo JAMÁS se suman sin el (1 − d).
// ---------------------------------------------------------------------
export function dMinDe(bEj, salida) {
  const b = num(bEj), s = num(salida);
  if (b === null || s === null || b <= 0 || s <= 0) return null;
  return Math.round((1 - s / b) * 10000) / 10000;
}
export function bMaxDe(salida, d) {
  const s = num(salida), dd = num(d);
  if (s === null || dd === null || s <= 0 || dd >= 1) return null;
  return Math.round((s / (1 - dd)) * 100) / 100;
}
export function gananciaTransfPorQusd(bEj, salida, d) {
  const b = num(bEj), s = num(salida), dd = num(d);
  if (b === null || s === null || dd === null || b <= 0) return null;
  return Math.round((s - b * (1 - dd)) * 100) / 100;
}
export function primaDeD(d) { // descuento -> prima «al %»
  const dd = num(d);
  if (dd === null || dd >= 1) return null;
  return Math.round((dd / (1 - dd)) * 10000) / 10000;
}
export function dDePrima(x) { // prima «al %» -> descuento
  const xx = num(x);
  if (xx === null || xx <= -1) return null;
  return Math.round((xx / (1 + xx)) * 10000) / 10000;
}

export function bloqueTransferencia({ bEj, salida, esPromedio }) {
  const dMin = dMinDe(bEj, salida);
  if (dMin === null) return null;
  return {
    bEj, esPromedio: Boolean(esPromedio),
    dMin, primaMin: primaDeD(dMin),
    bMax20: bMaxDe(salida, 0.20),               // pagando con 20 % de descuento…
    prima20: primaDeD(0.20),                    // …que en la calle se dice «al 25 %»
    gananciaQusd20: gananciaTransfPorQusd(bEj, salida, 0.20),
  };
}

// ---------------------------------------------------------------------
// Señal (§4.5): UNA palabra + 3 números + vigencia «hasta la próxima
// foto». De foto no usable NO sale señal (INV-A5): palabra null y el
// motivo — la app marca la anterior como vieja o dice «sin conclusión».
//   APROVECHAR = hay una dura viva.
//   VENDER     = ganancia ejecutable a 20 USD ≥ +25, o el peldaño
//                Equilibrado cumple (G ≥ 0 y delante ≤ mitad del libro).
//   ESPERAR    = el resto, con el motivo dominante y su dato.
// ---------------------------------------------------------------------
export function senalCompleta({ usable, dura, vwap20, menu, eq, topVenta, salida, costo }) {
  if (!usable) {
    return { palabra: null, numeros: null, motivo: "Foto no usable (vieja o sin libro): sin conclusión." };
  }
  const e = num(eq);
  if (dura) {
    return {
      palabra: "APROVECHAR",
      numeros: { tasa: dura.tasa, ganancia360: dura.g360 ?? null, equilibrio: e },
      motivo: dura.lado === "compra"
        ? "Hay una oferta dura viva en el libro de compra."
        : "Hay una venta anómala viva: vuelta interna posible.",
    };
  }
  const gEj = vwap20 ? ganancia(vwap20.tasa, salida, costo) : null;
  const eqPel = menu ? menu.peldanos.find((p) => p.nombre === "Equilibrado") : null;
  const cumpleEquilibrado = Boolean(
    eqPel && !eqPel.bloqueado && (eqPel.g ?? -1) >= 0 &&
    (eqPel.delanteUsd ?? Infinity) <= (menu.libroVentaUsd ?? 0) / 2
  );
  if ((gEj !== null && gEj >= UMBRAL_FINA) || cumpleEquilibrado) {
    return {
      palabra: "VENDER",
      numeros: {
        tasa: vwap20 ? vwap20.tasa : (eqPel ? eqPel.tasa : null),
        ganancia360: gEj !== null ? gEj : (eqPel ? eqPel.g : null),
        equilibrio: e,
      },
      motivo: gEj !== null && gEj >= UMBRAL_FINA
        ? "La ganancia ejecutable a 20 USD llega a la zona buena (+25)."
        : "El peldaño Equilibrado cumple: gana y no queda tras medio libro.",
    };
  }
  let motivo = "La ganancia ejecutable no llega a +25 CUP por recarga.";
  const tv = num(topVenta);
  if (e !== null && tv !== null && tv > e) {
    motivo = `La cima de venta (${fmtNum(tv)}) está sobre tu equilibrio (${fmtNum(e)}).`;
  } else if (!vwap20) {
    motivo = "El libro de compra no junta 20 USD ejecutables en la foto.";
  }
  return {
    palabra: "ESPERAR",
    numeros: { tasa: vwap20 ? vwap20.tasa : null, ganancia360: gEj, equilibrio: e },
    motivo,
  };
}

// Lado del cruce de equilibrio (§5.3): nivel20 contra el suelo
// eq × 0,92. null si falta cualquier dato (no se concluye).
export function ladoCruce(nivel, eq) {
  const n = num(nivel), e = num(eq);
  if (n === null || e === null || e <= 0) return null;
  return n <= e * 0.92 ? "bajo" : "sobre";
}

// ---------------------------------------------------------------------
// Sonda de contraparte: NOMBRES de campo del payload, sin valores
// personales. De User solo viajan los valores NUMÉRICOS de reputación
// (rating/operaciones: datos públicos del tablón; sin username).
// De la oferta PROPIA (si aparece en el libro) se captura de qué lado
// está y la FORMA de su «details» (claves, no valores): es lo que la
// puerta de acción necesita para clonar su tipo y sus datos de pago.
// ---------------------------------------------------------------------
export function formaDetalles(details) {
  if (details === null || details === undefined) return { tipo: "ausente" };
  if (Array.isArray(details)) {
    const primero = details[0];
    return {
      tipo: "array", largo: details.length,
      elemento: primero && typeof primero === "object"
        ? { tipo: "objeto", claves: Object.keys(primero).sort() }
        : { tipo: typeof primero },
    };
  }
  if (typeof details === "object") return { tipo: "objeto", claves: Object.keys(details).sort() };
  return { tipo: typeof details };
}

export function sondaPayload({ compras, ventas, propias }) {
  const primera = (compras && compras[0]) || (ventas && ventas[0]) || null;
  if (!primera) return null;
  const user = primera.User || primera.owner || null;
  const sonda = {
    claves_oferta: Object.keys(primera).sort(),
    claves_user: user ? Object.keys(user).sort() : [],
    reputacion_ejemplo: reputacionDe(user),
    hay_user: Boolean(user),
  };
  if (propias && propias.length) {
    const p = propias[0];
    sonda.propia = {
      lado: p._lado || null,
      claves_oferta: Object.keys(p).filter((k) => k !== "_lado").sort(),
      detalles_forma: formaDetalles(p.details),
      offer_kind: p.offer_kind ?? null,
    };
  }
  return sonda;
}

// FIXTURE para CI: copia exacta de la lógica de la puerta de acción
// (mercado-src/supabase/functions/mercado-actuar/logica-actuar.js), que
// vive fuera del repo. Si la lógica cambia, se refresca en el mismo cambio.
// logica-actuar.js — la puerta de acción del Analista (Nivel 1: el
// botón blindado) como orquestador PURO con dependencias inyectadas.
// La Edge Function «mercado-actuar» (index.ts) enchufa las dependencias
// reales (Supabase + API de QvaPay); el banco enchufa mocks. Lo probado
// es exactamente lo desplegado (patrón de la casa).
//
// SOLO crea ofertas de VENTA de saldo de Ernesto. Nada de apply, paid,
// received ni retiros: fuera de alcance por diseño (Estudio 2 §3.7).
//
// Barandas (Estudio 2 §3), TODAS verificadas en el servidor ANTES de
// llamar a QvaPay, en este orden:
//   1  la acción existe, está «pendiente» y no venció (10 min)
//   2  DETENER global / pausa por freno (mercado_config)
//   3  congelamiento en promo de ETECSA conocida/confirmada
//   4  veto por datos viejos (foto > 20 min por recepción, o sin libro)
//   5  collar con la tarifa LEÍDA AL INSTANTE (G<0 -> se niega)
//   6  topes: ≤ tope por oferta (config) · ≤ $120/día · ≤ 2/hora ·
//      enfriamiento de 10 min entre acciones
//   7  doble lectura: relectura del libro al ejecutar (si la tasa se
//      movió > 5, se descarta con la tasa nueva en el motivo)
//   8  una sola oferta automática abierta; tipo y «details» clonados
//      de una oferta PROPIA viva (nunca inventados)
//   9  create con idempotency_key = id de la acción; resultado
//      incierto -> reconciliar contra «mis ofertas», jamás reintentar
//  10  P2P_SIDE_NOT_ALLOWED / P2P_NOT_ALLOWED -> pausa total con el
//      motivo en claro (el primer toque real es la prueba del
//      interruptor «Vender en el P2P»); 3 errores -> pausa.
// Cada desenlace (ejecutada, negada por baranda, error de API) queda
// en la bitácora mercado_acciones vía deps.guardarAccion.

export const REQUISITOS = { min_completed: 25, min_rating: 4.5 };
export const TOPE_DIARIO_QUSD = 120;
export const TOPE_POR_HORA = 2;
export const ENFRIAMIENTO_MIN = 10;
export const VETO_FOTO_MIN = 20;
export const BANDA_DOBLE_LECTURA = 5; // saldo por QUSD
export const FALLOS_PARA_PAUSA = 3;
export const COLCHON_SALDO = 5;

export function numA(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
export function fmtA(x, dec = 2) {
  const n = numA(x);
  if (n === null) return "—";
  return n.toFixed(dec).replace(".", ",");
}

// G(R) = (360 ÷ R) × salida − costo [CUP por recarga de 360].
// La MISMA fórmula madre del lector: el banco la barre contra
// analista.ganancia para que las dos copias nunca se separen.
export function gananciaActuar(R, salida, costo) {
  const r = numA(R), s = numA(salida), c = numA(costo);
  if (r === null || s === null || c === null || r <= 0 || s <= 0 || c <= 0) return null;
  return Math.round(((360 / r) * s - c) * 100) / 100;
}

// Del libro de VENTA crudo: la menor tasa válida (sin trampa ≥2500,
// sin las del propio Ernesto) y el peldaño Equilibrado que saldría
// ahora = min(topVenta, equilibrio − colchón). Es la doble lectura.
export function equilibradoDe(ventas, eq) {
  const e = numA(eq);
  if (e === null) return null;
  let top = null;
  for (const o of ventas || []) {
    if (!o || typeof o !== "object") continue;
    const monto = numA(o.amount), recibe = numA(o.receive);
    let r = numA(o.ratio);
    if (r === null && monto !== null && recibe !== null && monto > 0) r = recibe / monto;
    if (r === null || r <= 0 || r >= 2500) continue;
    if (o.mine === true) continue;
    if (top === null || r < top) top = r;
  }
  if (top === null) return null;
  return Math.round(Math.min(top, e - COLCHON_SALDO) * 100) / 100;
}

export async function ejecutarAccion(deps, accionId) {
  const base = { ok: false, accion_id: accionId };
  const negar = async (codigo, motivo, extra = {}) => {
    await deps.guardarAccion(accionId, {
      estado: "negada", resuelta_en: deps.ahoraIso(),
      detalle: { baranda: codigo, motivo, ...extra },
    });
    return { ...base, codigo, motivo, ...extra };
  };

  /* 1) La acción y su vigencia */
  const accion = await deps.leerAccion(accionId);
  if (!accion) return { ...base, codigo: "no_existe", motivo: "Esa acción no existe en la bitácora." };
  if (accion.estado === "ejecutada") {
    return { ...base, codigo: "ya_ejecutada", motivo: "Esa oferta ya se publicó: no se duplica.", oferta_uuid: accion.oferta_uuid ?? null };
  }
  if (accion.estado !== "pendiente") {
    return { ...base, codigo: "no_pendiente", motivo: `Esa acción ya se resolvió (${accion.estado}).` };
  }
  if (deps.ahoraMs() > Date.parse(accion.expira_en)) {
    await deps.guardarAccion(accionId, {
      estado: "expirada", resuelta_en: deps.ahoraIso(),
      detalle: { baranda: "expirada", motivo: "El botón venció a los 10 minutos." },
    });
    return { ...base, codigo: "expirada", motivo: "El botón venció (10 minutos): la foto ya cambió. Espera la próxima alerta." };
  }

  /* 2) DETENER / pausa */
  const cfg = await deps.leerConfig();
  if (cfg.detenidas) return negar("detenido", "Las acciones están DETENIDAS. Reanúdalas desde tu app Mercado o con /reanudar aquí.");
  if (cfg.pausadas) return negar("pausado", `Las acciones están en pausa: ${cfg.pausa_motivo || "freno de seguridad"}. Reanuda desde tu app Mercado o con /reanudar aquí.`);

  /* 3) Promo activa = automatización congelada */
  if (cfg.congelar_en_promo && (await deps.promoActiva())) {
    return negar("promo", "Hay una promo de ETECSA activa: la automatización se congela hasta que pase (tu regla).");
  }

  /* 4) Veto por datos viejos (reloj de RECEPCIÓN) */
  const foto = await deps.leerFoto();
  if (!foto || !foto.libro_ok) return negar("sin_libro", "La última foto no trae el libro: no se actúa a ciegas.");
  const edadMin = (deps.ahoraMs() - Date.parse(foto.recibida_en)) / 60000;
  if (!(edadMin <= VETO_FOTO_MIN)) {
    return negar("foto_vieja", `La última foto es de hace ${Math.round(edadMin)} min (tope ${VETO_FOTO_MIN}): no se actúa con datos viejos.`);
  }

  /* 5) Collar con la tarifa leída al instante */
  const tarifa = await deps.leerTarifa();
  const g = gananciaActuar(accion.tasa, tarifa.salida, tarifa.costo);
  if (g === null) return negar("sin_tarifa", "Tu tarifa no está completa (salida y costo): no se actúa.");
  if (g < 0) {
    return negar("collar",
      `Con tu tarifa de ahora (salida ${fmtA(tarifa.salida, 0)} CUP por QUSD · costo ${fmtA(tarifa.costo, 0)} CUP por recarga), vender a ${fmtA(accion.tasa)} perdería ${fmtA(Math.abs(g))} CUP por recarga de 360. No se publica.`,
      { ganancia360: g });
  }

  /* 6) Topes y enfriamiento */
  const conteo = await deps.conteo();
  if (conteo.ultimaEjecutadaEn && deps.ahoraMs() - Date.parse(conteo.ultimaEjecutadaEn) < ENFRIAMIENTO_MIN * 60000) {
    return negar("enfriamiento", `Enfriamiento: ${ENFRIAMIENTO_MIN} minutos entre una acción y otra.`);
  }
  if (conteo.enUltimaHora >= TOPE_POR_HORA) {
    return negar("tope_hora", `Tope alcanzado: ${TOPE_POR_HORA} acciones por hora.`);
  }
  const monto = numA(accion.monto_qusd);
  if (monto === null || monto <= 0) return negar("monto_invalido", "La acción no trae un monto válido.");
  if (monto > numA(cfg.accion_monto_qusd)) {
    return negar("tope_monto", `El monto ($${fmtA(monto)}) supera tu tope por oferta ($${fmtA(cfg.accion_monto_qusd)}).`);
  }
  if ((conteo.montoHoy || 0) + monto > TOPE_DIARIO_QUSD) {
    return negar("tope_diario", `Tope diario alcanzado: $${fmtA(TOPE_DIARIO_QUSD)} entre todas las acciones de hoy.`);
  }

  /* 7+8) Doble lectura y oferta base propia */
  const fresco = await deps.libroFresco();
  if (fresco.equilibrado === null || fresco.equilibrado === undefined) {
    return negar("sin_libro_fresco", "La relectura del libro no devolvió la cima de venta: no se actúa.");
  }
  if (Math.abs(numA(accion.tasa) - numA(fresco.equilibrado)) > BANDA_DOBLE_LECTURA) {
    return negar("libro_movido",
      `El libro se movió: la tasa buena ahora es ${fmtA(fresco.equilibrado)} saldo por QUSD, no ${fmtA(accion.tasa)}. Espera la próxima alerta.`,
      { tasa_nueva: fresco.equilibrado });
  }
  const mis = fresco.misOfertas || [];
  const previas = await deps.accionesEjecutadas();
  const uuidsPrevias = new Set(previas.map((a) => a.oferta_uuid).filter(Boolean));
  if (mis.some((o) => uuidsPrevias.has(o.uuid))) {
    return negar("ya_hay_oferta", "Ya hay una oferta automática abierta: primero que se cierre esa.");
  }
  const baseOferta = mis.find((o) => cfg.crear_tipo && o.type === cfg.crear_tipo) || mis[0] || null;
  if (!baseOferta) {
    return negar("sin_oferta_base", "No encuentro una oferta tuya abierta para copiar tu tipo y tus datos de pago. Deja una oferta abierta y el Analista aprende de ella.");
  }
  if (!Array.isArray(baseOferta.details)) {
    return negar("detalles_desconocidos", "Tus datos de pago tienen una forma que no reconozco: no se publica a ciegas.");
  }

  /* 9) Crear (idempotency_key = id de la acción) */
  const tasa = numA(accion.tasa);
  const receive = Math.round(monto * tasa * 100) / 100;
  const payload = {
    type: baseOferta.type, coin: "ETECSA",
    amount: monto, receive, details: baseOferta.details,
    requirements: { ...REQUISITOS },
    idempotency_key: String(accion.id),
  };
  let resp = null, incierto = false;
  try { resp = await deps.crearOferta(payload); } catch { incierto = true; }
  if (!incierto && resp && resp.ok) {
    await deps.guardarAccion(accionId, {
      estado: "ejecutada", resuelta_en: deps.ahoraIso(), oferta_uuid: resp.uuid ?? null,
      detalle: { ganancia360: g, payload, respuesta: resp.crudo ?? null },
    });
    await deps.reiniciarFallos();
    return { ok: true, accion_id: accionId, oferta_uuid: resp.uuid ?? null, tasa, monto_qusd: monto, ganancia360: g };
  }
  const codigoApi = !incierto && resp ? (resp.codigo || null) : null;
  if (codigoApi === "P2P_SIDE_NOT_ALLOWED" || codigoApi === "P2P_NOT_ALLOWED") {
    await deps.guardarAccion(accionId, {
      estado: "error", resuelta_en: deps.ahoraIso(),
      detalle: { error_api: codigoApi, mensaje: resp.mensaje ?? null },
    });
    await deps.fijarPausa("QvaPay no permite vender con las credenciales de «Vigila Mercado»: activa el interruptor «Vender en el P2P» en tu panel de desarrollador de QvaPay.");
    return {
      ...base, codigo: "sin_permiso",
      motivo: "QvaPay respondió " + codigoApi + ": el interruptor «Vender en el P2P» de tu app «Vigila Mercado» está apagado (o sin permiso). Las acciones quedan en pausa hasta que lo actives y reanudes.",
    };
  }
  if (incierto || (resp && resp.incierto)) {
    /* Resultado desconocido: reconciliar, jamás reintentar a ciegas. */
    const ahora = await deps.misOfertasAhora();
    const hallada = (ahora || []).find((o) =>
      Math.abs(numA(o.amount) - monto) < 0.001 && Math.abs(numA(o.receive) - receive) < 0.01);
    if (hallada) {
      await deps.guardarAccion(accionId, {
        estado: "ejecutada", resuelta_en: deps.ahoraIso(), oferta_uuid: hallada.uuid ?? null,
        detalle: { ganancia360: g, payload, reconciliada: true },
      });
      await deps.reiniciarFallos();
      return { ok: true, accion_id: accionId, oferta_uuid: hallada.uuid ?? null, tasa, monto_qusd: monto, ganancia360: g, reconciliada: true };
    }
    await deps.guardarAccion(accionId, {
      estado: "error", resuelta_en: deps.ahoraIso(),
      detalle: { error_api: "resultado_desconocido", payload },
    });
    const n = await deps.sumarFallo();
    if (n >= FALLOS_PARA_PAUSA) await deps.fijarPausa("Tres fallos seguidos en la puerta de acción.");
    return {
      ...base, codigo: "resultado_desconocido",
      motivo: "La respuesta de QvaPay no llegó y la oferta no aparece entre las tuyas: no se reintenta a ciegas. Revisa tu QvaPay antes de tocar nada más.",
    };
  }
  /* Error de API con código: queda en bitácora y suma al freno. */
  await deps.guardarAccion(accionId, {
    estado: "error", resuelta_en: deps.ahoraIso(),
    detalle: { error_api: codigoApi, mensaje: resp?.mensaje ?? null, payload },
  });
  const n = await deps.sumarFallo();
  let pausa = false;
  if (n >= FALLOS_PARA_PAUSA) { await deps.fijarPausa("Tres errores seguidos en la puerta de acción."); pausa = true; }
  return {
    ...base, codigo: "error_api", pausa,
    motivo: `QvaPay rechazó la creación: ${resp?.mensaje || codigoApi || "error sin código"}.`,
  };
}

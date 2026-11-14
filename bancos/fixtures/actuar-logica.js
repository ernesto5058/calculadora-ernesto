// Fixture vendorizado para CI: copia EXACTA de
// mercado-src/supabase/functions/mercado-actuar/logica-actuar.js
// (solo cambia esta cabecera). Se refresca cuando la fuente cambia;
// el banco vivo de research_notes importa la fuente directamente.
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
//   3  congelamiento en promo de ETECSA conocida/confirmada — solo
//      ata a la vía automática; el toque manual de Ernesto EN LA APP
//      (origen 'app') está EXENTO por su decisión del 2026-11-11:
//      «mi toque manda siempre»
//   4  veto por datos viejos (foto > 20 min por recepción, o sin libro)
//   5  collar con la tarifa LEÍDA AL INSTANTE (G<0 -> se niega)
//   6  topes: ≤ tope por oferta (config) · ≤ $120/día · ≤ 2/hora ·
//      enfriamiento de 10 min entre acciones
//   7  doble lectura: relectura del libro al ejecutar (si la tasa se
//      movió > 5, se descarta con la tasa nueva en el motivo)
//   8  una sola oferta automática abierta; la BASE de pago sale de
//      (a) una oferta PROPIA de venta viva con «details» legibles o
//      (b) la PLANTILLA guardada de Ernesto (guia_plantilla por
//      moneda/lado) — jamás inventada. Los «details» reales de
//      QvaPay son un OBJETO de pares (la puerta vieja exigía array
//      y negaba siempre: reparación del 2026-11-14); si la base no
//      es la plantilla, sus pares deben coincidir EXACTOS con ella.
//      requirements/message/offer_kind salen de la MISMA base (su
//      oferta real trae requirements null: nada de valores fijos)
//   9  create con idempotency_key = id de la acción; resultado
//      incierto -> reconciliar contra «mis ofertas», jamás reintentar
//  10  P2P_SIDE_NOT_ALLOWED / P2P_NOT_ALLOWED -> pausa total con el
//      motivo en claro (el primer toque real es la prueba del
//      interruptor «Vender en el P2P»); 3 errores -> pausa.
// Cada desenlace (ejecutada, negada por baranda, error de API) queda
// en la bitácora mercado_acciones vía deps.guardarAccion.

export const TOPE_DIARIO_QUSD = 120;
export const TOPE_POR_HORA = 2;
export const ENFRIAMIENTO_MIN = 10;
export const VETO_FOTO_MIN = 20;
export const BANDA_DOBLE_LECTURA = 5; // saldo por QUSD
export const FALLOS_PARA_PAUSA = 3;
export const COLCHON_SALDO = 5;
export const RECLAMO_EXPIRA_MIN = 3;

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

// Forma estructural de un valor: SOLO su tipo y los NOMBRES de sus
// claves, jamás un valor. Cuando una baranda niega por la forma de
// los datos de pago, la negación registra esta foto de la forma pa
// discriminar la causa (objeto / ausente / otra cosa) sin filtrar ni
// un solo dato de pago a la bitácora.
export function formaDe(x) {
  if (x === null || x === undefined) return { tipo: "ausente" };
  if (Array.isArray(x)) {
    const f = { tipo: "array", longitud: x.length };
    const p = x[0];
    if (p && typeof p === "object" && !Array.isArray(p)) f.claves = Object.keys(p).sort();
    else if (x.length) f.primer_tipo = Array.isArray(p) ? "array" : typeof p;
    return f;
  }
  if (typeof x === "object") return { tipo: "objeto", claves: Object.keys(x).sort() };
  return { tipo: "otro", clase: typeof x };
}

// Copia del payload SOLO pa la bitácora: jamás lleva «details»
// (los datos de pago de Ernesto) en claro — en su lugar va la
// forma estructural (formaDe), igual que en la negación por
// detalles_desconocidos. El payload que va a QvaPay NO pasa por
// aquí: sigue llevando sus details intactos.
export function payloadBitacora(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const { details, ...resto } = payload;
  return { ...resto, forma_details: formaDe(details) };
}

// Los «details» REALES de QvaPay son un OBJETO de pares
// ({"Celular": "…"}) — la forma array es la legada. Válido =
// objeto con ≥1 clave o array con ≥1 elemento; cualquier otra
// cosa (ausente, vacío, escalar) no sirve de base de pago.
export function detailsValidos(d) {
  if (Array.isArray(d)) return d.length > 0;
  return !!d && typeof d === "object" && Object.keys(d).length > 0;
}

// ¿Trae «details» EXACTAMENTE los pares (clave → valor) de la
// plantilla guardada? Con plantilla objeto: cada par suyo debe
// estar presente e idéntico (los valores se comparan como texto:
// la API los trae como cadenas). Si alguna de las dos formas es
// array, solo vale la identidad completa (forma legada).
export function coincidePlantilla(details, plantillaDetalles) {
  if (!detailsValidos(details) || !detailsValidos(plantillaDetalles)) return false;
  if (Array.isArray(details) || Array.isArray(plantillaDetalles)) {
    return JSON.stringify(details) === JSON.stringify(plantillaDetalles);
  }
  return Object.entries(plantillaDetalles)
    .every(([k, v]) => String(details[k]) === String(v));
}

// La base normalizada que alimenta el payload: los datos de pago y
// la FORMA de la oferta (requirements/message/offer_kind/límites)
// salen de la misma fuente — la oferta viva o la plantilla — y lo
// que la fuente no trae queda null, como en la oferta real de
// Ernesto (jamás se rellenan valores fijos).
function baseDesdeOferta(o) {
  return {
    details: o.details,
    requirements: o.requirements ?? null,
    message: o.message ?? null,
    offer_kind: o.offer_kind ?? null,
    order_min: o.order_min ?? null,
    order_max: o.order_max ?? null,
  };
}
function baseDesdePlantilla(p) {
  const b = p && typeof p.bloque === "object" && p.bloque ? p.bloque : {};
  return {
    details: p.detalles,
    requirements: b.requirements ?? null,
    message: b.message ?? null,
    offer_kind: b.offer_kind ?? null,
    order_min: b.order_min ?? null,
    order_max: b.order_max ?? null,
  };
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
  if (accion.estado !== "pendiente" && accion.estado !== "ejecutando") {
    return { ...base, codigo: "no_pendiente", motivo: `Esa acción ya se resolvió (${accion.estado}).` };
  }
  /* 1b) RECLAMO ATÓMICO (compare-and-swap en la dep): solo UN
     ejecutor gana la acción — pendiente, o ejecutando con el
     reclamo ya vencido (RECLAMO_EXPIRA_MIN). Dos toques a la vez
     ya no pueden crear dos ofertas: el perdedor NO escribe nada
     y responde el motivo honesto según el estado fresco. */
  const reclamada = await deps.reclamarAccion(accionId);
  if (!reclamada) {
    const fresca = await deps.leerAccion(accionId);
    if (!fresca) return { ...base, codigo: "no_existe", motivo: "Esa acción no existe en la bitácora." };
    if (fresca.estado === "ejecutada") {
      return { ...base, codigo: "ya_ejecutada", motivo: "Esa oferta ya se publicó: no se duplica.", oferta_uuid: fresca.oferta_uuid ?? null };
    }
    if (fresca.estado === "ejecutando") {
      return { ...base, codigo: "en_ejecucion", motivo: "Esa acción ya se está ejecutando: no se duplica. Espera a que termine esa ejecución." };
    }
    return { ...base, codigo: "no_pendiente", motivo: `Esa acción ya se resolvió (${fresca.estado}).` };
  }
  /* La expiración se comprueba DESPUÉS del reclamo: solo el dueño
     del reclamo puede escribir «expirada». */
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

  /* 3) Promo activa = automatización congelada. EXENCIÓN (decisión de
     Ernesto, 2026-11-11 21:04): su toque manual EN LA APP manda
     siempre — las acciones de origen 'app' NO se congelan; el
     congelamiento ata solo a la vía automática (origen 'dura_compra' /
     'cruce_eq', las que se ejecutan desde el botón de Telegram). */
  if (accion.origen !== "app" && cfg.congelar_en_promo && (await deps.promoActiva())) {
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

  /* 6) Topes y enfriamiento — el conteo cuenta también los
     reclamos vivos de OTRAS acciones (la dep excluye la propia:
     su reclamo acaba de nacer y no puede enfriarse a sí misma),
     así dos acciones distintas en paralelo también se serializan. */
  const conteo = await deps.conteo(accionId);
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
  // BLINDAJE (sonda en vivo, 2026-11-12): la oferta propia viva de
  // Ernesto era de COMPRA («buy») y su tipo se había aprendido tal
  // cual — clonar de ahí habría creado una oferta de COMPRA. La
  // puerta SOLO vende: la base se busca entre sus ofertas de VENTA
  // y el tipo del payload es «sell» siempre, jamás clonado de otra.
  const baseViva = mis.find((o) => o && o.type === "sell") || null;
  /* BASE DE PAGO (reparación 2026-11-14): con las credenciales de
     app la API NO expone los «details» de ninguna oferta (CHEQUEO
     82) — re-clonar del listado dejaba la puerta muda. Prioridad:
     (1) la oferta viva con details legibles; (2) la PLANTILLA
     guardada (guia_plantilla por moneda/lado), que viaja en el
     snapshot de la preparada (contexto.plantilla) y, si el snapshot
     es viejo y no la trae, la dep leerPlantilla la lee al momento
     de subir. La misma prioridad que define guia_asesor_interno. */
  let plantilla = null;
  const snap = accion.contexto && typeof accion.contexto === "object"
    ? accion.contexto.plantilla : null;
  if (snap && typeof snap === "object" && "detalles" in snap) {
    plantilla = { detalles: snap.detalles, bloque: snap.bloque ?? null };
  }
  if (!plantilla && typeof deps.leerPlantilla === "function") {
    plantilla = await deps.leerPlantilla(accion.moneda || "ETECSA", "sell");
  }
  let basePago = null, baseFuente = null;
  if (baseViva && detailsValidos(baseViva.details)) {
    basePago = baseDesdeOferta(baseViva); baseFuente = "oferta_viva";
  } else if (plantilla && detailsValidos(plantilla.detalles)) {
    basePago = baseDesdePlantilla(plantilla); baseFuente = "plantilla";
  }
  if (!basePago) {
    if (!baseViva && !plantilla) {
      return negar("sin_oferta_base", "No encuentro base pa copiar tus datos de pago: ni una oferta tuya de VENTA abierta con datos legibles ni tu plantilla guardada. La puerta solo vende: siembra tu plantilla o deja una oferta de venta abierta.");
    }
    return negar("detalles_desconocidos", "Tus datos de pago tienen una forma que no reconozco: no se publica a ciegas.",
      { forma_details: formaDe(baseViva ? baseViva.details : plantilla.detalles) });
  }
  /* PAR EXACTO (ETECSA): si la base no ES la plantilla, sus datos
     de pago deben traer exactos los pares de la plantilla guardada
     — jamás se publica cobrando a otro destino que no sea el suyo. */
  if (baseFuente !== "plantilla" && plantilla && detailsValidos(plantilla.detalles)
      && !coincidePlantilla(basePago.details, plantilla.detalles)) {
    return negar("detalles_distintos_plantilla",
      "Los datos de pago de tu oferta abierta no coinciden con tu plantilla guardada: no se publica cobrando a otro destino. Actualiza tu plantilla o tu oferta.",
      { forma_details: formaDe(basePago.details) });
  }

  /* 9) Crear (idempotency_key = id de la acción). La forma de la
     oferta (requirements/message/offer_kind/límites) sale de la
     MISMA base que los datos de pago: su oferta real trae
     requirements null y offer_kind «fixed» — nada de valores fijos
     inventados (la puerta vieja imponía {25 ops, 4,5★} ajenos). */
  const tasa = numA(accion.tasa);
  const receive = Math.round(monto * tasa * 100) / 100;
  const payload = {
    type: "sell", coin: "ETECSA",
    amount: monto, receive, details: basePago.details,
    requirements: basePago.requirements,
    message: basePago.message,
    offer_kind: basePago.offer_kind,
    order_min: basePago.order_min,
    order_max: basePago.order_max,
    idempotency_key: String(accion.id),
  };
  let resp = null, incierto = false;
  try { resp = await deps.crearOferta(payload); } catch { incierto = true; }
  if (!incierto && resp && resp.ok) {
    await deps.guardarAccion(accionId, {
      estado: "ejecutada", resuelta_en: deps.ahoraIso(), oferta_uuid: resp.uuid ?? null,
      detalle: { ganancia360: g, base_fuente: baseFuente, payload: payloadBitacora(payload), respuesta: resp.crudo ?? null },
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
        detalle: { ganancia360: g, base_fuente: baseFuente, payload: payloadBitacora(payload), reconciliada: true },
      });
      await deps.reiniciarFallos();
      return { ok: true, accion_id: accionId, oferta_uuid: hallada.uuid ?? null, tasa, monto_qusd: monto, ganancia360: g, reconciliada: true };
    }
    await deps.guardarAccion(accionId, {
      estado: "error", resuelta_en: deps.ahoraIso(),
      detalle: { error_api: "resultado_desconocido", payload: payloadBitacora(payload) },
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
    detalle: { error_api: codigoApi, mensaje: resp?.mensaje ?? null, payload: payloadBitacora(payload) },
  });
  const n = await deps.sumarFallo();
  let pausa = false;
  if (n >= FALLOS_PARA_PAUSA) { await deps.fijarPausa("Tres errores seguidos en la puerta de acción."); pausa = true; }
  return {
    ...base, codigo: "error_api", pausa,
    motivo: `QvaPay rechazó la creación: ${resp?.mensaje || codigoApi || "error sin código"}.`,
  };
}

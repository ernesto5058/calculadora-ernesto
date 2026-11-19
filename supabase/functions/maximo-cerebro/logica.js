// =====================================================================
// logica.js — lógica pura de la función «maximo-cerebro» (2026-11-12).
// Dos piezas:
//   1) EL PARSER DE SMS: copia EXACTA, sin tocar una coma, del parser
//      probado de «sms-captura» (logica.js, banco prueba-sms-captura
//      11/11): la ruta «sms» del Máster guarda en la MISMA tabla
//      sms_linea con las MISMAS reglas — jamás dos parsers divergentes.
//   2) El enrutado por «tipo» del cuerpo y la forma de los datos que
//      acepta cada ruta (decisiones puras, sin IO).
// =====================================================================

/* Normaliza un monto capturado a número (o null si no es cifra sana).
   «1440.0» → 1440 · «12600» → 12600 · «13 875.08» → 13875.08 ·
   «13,875.08» → 13875.08 · «12,600» → 12600 · «1270,08» → 1270.08 */
export function numeroDe(texto) {
  if (texto == null) return null;
  let t = String(texto).replace(/\s+/g, "");
  if (!/^[0-9.,]+$/.test(t)) return null;
  if (t.includes(",") && t.includes(".")) {
    t = t.replace(/,/g, ""); // miles por coma + decimal por punto
  } else if (t.includes(",")) {
    const partes = t.split(",");
    if (partes.length > 2) {
      t = partes.join(""); // miles por coma repetida
    } else if (partes[1].length === 3) {
      t = partes.join(""); // «12,600» = miles
    } else {
      t = partes[0] + "." + partes[1]; // «1270,08» = decimal por coma
    }
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const MONTO = "([0-9][0-9\\s.,]*?)";
const RE_RECIBIDO = new RegExp(
  "ha\\s+recibido\\s+" + MONTO + "\\s*CUP\\s+del\\s+n[uú]mero\\s+(\\d+)", "i");
const RE_TRANSFERIDO = new RegExp(
  "ha\\s+transferido\\s+" + MONTO + "\\s*CUP\\s+al\\s+n[uú]mero\\s+(\\d+)", "i");
const RE_SALDO = new RegExp(
  "saldo\\s+principal\\s+" + MONTO + "\\s*CUP", "i");

/* parsearSms(cuerpo) → {tipo, monto_cup, contraparte,
   saldo_principal_cup, parse_ok}. parse_ok solo si el formato es uno
   de los dos reales Y salieron monto, contraparte y saldo principal. */
export function parsearSms(cuerpo) {
  const fuera = {
    tipo: "otro", monto_cup: null, contraparte: null,
    saldo_principal_cup: null, parse_ok: false,
  };
  if (typeof cuerpo !== "string" || !cuerpo.trim()) return fuera;
  let tipo = null;
  let m = cuerpo.match(RE_RECIBIDO);
  if (m) tipo = "recibido";
  else {
    m = cuerpo.match(RE_TRANSFERIDO);
    if (m) tipo = "transferido";
  }
  if (!tipo) return fuera;
  const monto = numeroDe(m[1]);
  const contraparte = m[2] || null;
  const ms = cuerpo.match(RE_SALDO);
  const saldo = ms ? numeroDe(ms[1]) : null;
  return {
    tipo,
    monto_cup: monto,
    contraparte,
    saldo_principal_cup: saldo,
    parse_ok: monto != null && contraparte != null && saldo != null,
  };
}

// ---------------------------------------------------------------------
// Enrutado del cerebro: el cuerpo JSON trae «tipo» y manda la ruta.
//   config → el Máster lee su configuración (maximo_config, fila 1).
//   latido → el teléfono reporta su estado (maximo_latidos).
//   sms    → un SMS de la línea entra a sms_linea (parser de arriba).
//   sms_precio / sms_clase / sms_respuesta → el sensor v2 (abajo).
// Cualquier otro tipo (o cuerpo que no sea objeto) → null = 400.
// ---------------------------------------------------------------------
export const RUTAS = ["config", "latido", "sms", "previo", "resultado", "red", "red_resultado", "sms_precio", "sms_clase", "sms_respuesta", "sms_lote", "sms_crudo", "espera_crear"];

export function rutaDe(cuerpo) {
  if (!cuerpo || typeof cuerpo !== "object") return null;
  const t = cuerpo.tipo;
  return typeof t === "string" && RUTAS.includes(t) ? t : null;
}

/* Los datos del latido: lo que el teléfono mande en «datos» (objeto);
   si no trae objeto, el latido se guarda vacío pero se guarda — un
   latido sin datos también prueba que el teléfono está vivo. */
export function datosLatido(cuerpo) {
  const d = cuerpo && typeof cuerpo === "object" ? cuerpo.datos : null;
  return d && typeof d === "object" && !Array.isArray(d) ? d : {};
}

/* =====================================================================
   AUTO-DESPARQUEO (Vía A del Fuerte, 2026-11-12): la máquina de
   estados que decide si el teléfono lleva parqueado en 3G bastante
   rato pa merecer un re-registro forzado (modo avión 8 s). La
   decisión vive AQUÍ, en el servidor; el atajo solo obedece. La
   lógica es pura (sin IO): decidirRed recibe el estado guardado, la
   config y la lectura, y devuelve la respuesta + los cambios de
   estado + los eventos a registrar. Reglas EXACTAS (banco curl):
   - desparqueo_enabled=false → accion 0 siempre (motivo «apagado»),
     sin tocar estado ni registrar eventos: el silencio del
     kill-switch de la casa.
   - Wi-Fi (ssid con contenido o wifi=true) → accion 0, racha a cero.
   - LTE/5G/4G → accion 0, racha a cero, se registra la lectura.
   - Red lenta (3G/HSPA/UMTS/EDGE/GPRS o sin tecnología = sin
     servicio): sin racha → abre racha, accion 0 «primera_lectura».
     Con racha: accion 1 SOLO si la racha lleva ≥ 5 min Y el último
     desparqueo fue hace > 20 min (o nunca) Y el conteo de HOY
     (hora de La Habana) es < 4; al conceder CONSUME (último
     desparqueo = ahora, conteo+1 con su día, racha a cero) y se
     registra el «veredicto». Si no: «persistencia» |
     «enfriamiento» | «tope_diario», en ese orden de chequeo.
   ===================================================================== */
export function clasificarRed(cuerpo) {
  const tec = cuerpo && typeof cuerpo.tecnologia === "string" ? cuerpo.tecnologia.trim() : "";
  const ssid = cuerpo && typeof cuerpo.ssid === "string" ? cuerpo.ssid.trim() : "";
  const wifi = (cuerpo && (cuerpo.wifi === true || cuerpo.wifi === "true")) || ssid.length > 0;
  const T = tec.toUpperCase();
  let clase = "lenta";
  if (wifi) clase = "wifi";
  else if (T.includes("LTE") || T.includes("5G") || T.includes("NR") || T === "4G") clase = "lte";
  return { clase, tecnologia: tec, ssid };
}

export function decidirRed(estado, cfg, lectura, ahora, hoy) {
  const resp = { accion: 0, motivo: "", cambios: {}, eventos: [] };
  if (!cfg.enabled) { resp.motivo = "apagado"; return resp; }
  const ultima = lectura.tecnologia || lectura.clase;
  resp.cambios.ultima_red = ultima;
  if (lectura.clase === "wifi" || lectura.clase === "lte") {
    resp.motivo = lectura.clase;
    resp.cambios.racha_3g_desde = null;
    resp.eventos = ["lectura"];
    return resp;
  }
  // Red lenta: la racha manda.
  resp.eventos = ["lectura"];
  const desde = estado && estado.racha_3g_desde ? Date.parse(estado.racha_3g_desde) : null;
  if (desde === null || Number.isNaN(desde)) {
    resp.motivo = "primera_lectura";
    resp.cambios.racha_3g_desde = ahora.toISOString();
    return resp;
  }
  const ultimo = estado && estado.ultimo_desparqueo ? Date.parse(estado.ultimo_desparqueo) : null;
  const conteoHoy = estado && estado.dia === hoy ? (estado.conteo_dia || 0) : 0;
  const persistencia = (ahora.getTime() - desde) >= 5 * 60 * 1000;
  const enfriamiento = ultimo === null || Number.isNaN(ultimo) || (ahora.getTime() - ultimo) > 20 * 60 * 1000;
  const bajoTope = conteoHoy < 4;
  if (persistencia && enfriamiento && bajoTope) {
    resp.accion = 1;
    resp.motivo = "desparquear";
    resp.cambios.racha_3g_desde = null;
    resp.cambios.ultimo_desparqueo = ahora.toISOString();
    resp.cambios.conteo_dia = conteoHoy + 1;
    resp.cambios.dia = hoy;
    resp.eventos = ["lectura", "veredicto"];
    return resp;
  }
  resp.motivo = !persistencia ? "persistencia" : (!enfriamiento ? "enfriamiento" : "tope_diario");
  return resp;
}

/* =====================================================================
   SENSOR SMS v2 — «EL ARTEFACTO QUE PREGUNTA» (2026-11-13).
   El atajo v2 guarda el SMS (ruta «sms», como siempre) y DESPUÉS
   pregunta en el teléfono. Las respuestas vuelven por tres rutas y
   toda la aritmética vive AQUÍ, pura y con banco
   (prueba-sms-v2.mjs):

   - «sms_precio»  {sms_id, forma_texto, numero} → el cerebro calcula
     el total PROPUESTO y lo devuelve como texto (propuesta_texto) pa
     que el atajo lo ponga de valor por defecto en la confirmación.
     REGLA DEL REDONDEO (Ernesto): lo que se asienta es el TOTAL REAL
     PAGADO (su número redondo), jamás el producto teórico; la tasa
     efectiva se DERIVA (total ÷ cantidad).
   - «sms_clase»   {sms_id, eleccion_texto} → el menú de salida viaja
     como TEXTO y se mapea aquí (el atajo jamás compara textos: la
     lección de las v2–v4). Venta → devuelve qusd_texto (pregunta) y
     espera la respuesta. Devolución/traspaso → se asienta al momento
     (clasificación sin ganancia, reclasificación a costo).
   - «sms_respuesta» {sms_id, total} (compra) o {sms_id, qusd}
     (venta) → el asiento en el libro dinero_.

   El asiento (en index.ts, con service_role):
   - compra: dinero_mover ernesto_inversion −total [efectivo] e
     inventario +total [saldo, al costo] + lote nuevo (cantidad,
     costo total, tasa efectiva). Par neutro: el cuadre no se mueve.
   - venta: consumo FIFO de lotes; inventario −costo [saldo] y
     ernesto_inversion +costo [qusd: el valor quedó en QUSD, a costo]
     + fila en dinero_ventas (monto QUSD, tasa = saldo por QUSD).
     La ganancia en CUP se cristaliza a la salida del QUSD (otra
     operación, otro sensor); aquí queda el costo contra el lote.
   - devolución/traspaso: inventario −costo [saldo] y
     ernesto_inversion +costo [saldo]: reclasificación a costo, sin
     ganancia, con la contraparte en el detalle.
   ===================================================================== */

/* Coerciona un valor del atajo (texto o número) a número finito. */
export function aNumero(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") return numeroDe(v);
  return null;
}

/* Entero positivo exacto (la regla del libro: CUP enteros sin coma).
   Acepta 7800 y "7800"; rechaza 5881.2, 0, negativos y basura. */
export function enteroPositivo(v) {
  const n = aNumero(v);
  if (n === null || n <= 0 || n !== Math.trunc(n)) return null;
  return n;
}

/* Monto QUSD: positivo, máximo 2 decimales (así habla QvaPay). */
export function qusdValido(v) {
  const n = aNumero(v);
  if (n === null || n <= 0) return null;
  const c = Math.round(n * 100) / 100;
  return Math.abs(n - c) < 0.001 ? c : null;
}

/* El texto del menú (definido por el propio atajo) → su clave. El
   mapeo es por PREFIJO en minúsculas: las etiquetas son nuestras
   («Por unidad (ej. 2.6)», «Venta», «Devolución de capital»…). */
export function claseDeMenu(texto) {
  if (typeof texto !== "string") return null;
  const t = texto.trim().toLowerCase();
  if (t.startsWith("por unidad")) return "tasa";
  if (t.startsWith("por recarga")) return "recarga";
  if (t.startsWith("total")) return "total";
  if (t.startsWith("venta")) return "venta";
  if (t.startsWith("devoluci")) return "devolucion";
  if (t.startsWith("traspaso")) return "traspaso";
  if (t.startsWith("compra")) return "compra";
  return null;
}

/* El menú «¿De quién es esta recarga?» del sensor (v3.1, 2026-11-14):
   el texto viaja del teléfono y el código se decide AQUÍ, como todos
   los menús. «Es de Briku» / «Es de Abraham» devuelven el código real
   del buscador; «Compra propia» y «Otro» devuelven su clase (el
   asiento de la vuelta de buscador vive en la ruta «sms_respuesta»;
   «propia» sigue el flujo de compra de siempre y «otro» deja el
   evento en la cola de arbitraje). */
export function duenoDeMenu(texto) {
  if (typeof texto !== "string") return null;
  const t = texto.trim().toLowerCase();
  if (t.startsWith("es de briku")) return "BRIKU-EUX";
  if (t.startsWith("es de abraham")) return "ABRAHAM-X30";
  if (t.startsWith("compra propia")) return "propia";
  if (t.startsWith("otro")) return "otro";
  return null;
}

/* La propuesta de total pa una compra, según la forma del precio:
   tasa (por unidad: 2.6) · recarga (por cada 360: 900) · total (el
   número tal cual). Devuelve {total, tasa_efectiva} o null si los
   datos no son sanos. La propuesta se REDONDEA al entero (billete):
   es solo la propuesta — el total asentado es el que Ernesto
   confirma/edita en el teléfono. */
export function resolverCompra(forma, numero, cantidadSaldo) {
  const n = aNumero(numero);
  const c = aNumero(cantidadSaldo);
  if (n === null || n <= 0 || c === null || c <= 0) return null;
  let total = null;
  if (forma === "tasa") total = Math.round(n * c);
  else if (forma === "recarga") total = Math.round(n * c / 360);
  else if (forma === "total") total = enteroPositivo(n);
  else return null;
  if (total === null || total <= 0) return null;
  return { total, tasa_efectiva: Math.round(total / c * 10000) / 10000 };
}

/* Consumo FIFO de lotes pa una salida de `cantidad` de saldo.
   lotes: [{id, cantidad_restante, costo_restante_cup}] ya ordenados
   del más viejo al más nuevo. El costo de un consumo parcial es
   proporcional REDONDEADO; al agotar un lote se lleva su costo
   restante entero (sin residuo). Devuelve {consumos, costo_total}
   o null si los lotes no alcanzan (saldo sin lote: NO se asienta). */
export function costoConsumo(lotes, cantidad) {
  const c = aNumero(cantidad);
  if (c === null || c <= 0 || !Array.isArray(lotes)) return null;
  let resta = c;
  const consumos = [];
  for (const l of lotes) {
    if (resta <= 1e-9) break;
    const disp = aNumero(l && l.cantidad_restante);
    const costoDisp = aNumero(l && l.costo_restante_cup);
    if (disp === null || disp <= 0 || costoDisp === null || costoDisp < 0) continue;
    const toma = Math.min(resta, disp);
    const costo = toma >= disp ? costoDisp
      : Math.round(costoDisp * toma / disp);
    consumos.push({ id: l.id, cantidad: toma, costo });
    resta -= toma;
  }
  if (resta > 1e-9) return null;
  return {
    consumos,
    costo_total: consumos.reduce((s, x) => s + x.costo, 0),
  };
}

/* El monto como se lee en una pregunta: 3000 (no «3000.0»), 1270.08
   con sus decimales reales. */
export function formatoMonto(n) {
  const x = aNumero(n);
  if (x === null) return "";
  return String(Math.round(x * 100) / 100);
}

/* =====================================================================
   RIEL PAGO×MOVIL (BANDEC) — parser puro (2026-11-13, núcleo de
   vueltas). Plantillas REALES de las capturas de Ernesto:

   ENTRADA CUP: «El titular del telefono <TEL> le ha realizado una
     transferencia a la cuenta <CUENTA> de <MONTO> CUP.
     Nro. Transaccion <ID>. Fecha: D/M/AAAA»
   ENTRADA USD: «…a su Tarjeta Clasica <NUM> de <MONTO> USD.
     Nro. Transaccion <ID>» — OJO: dice «Clasica», pero la tarjeta
     …6529 de Ernesto es su MLC: la clase sale del NÚMERO registrado
     en pago_cuentas (cuentas que inyecta el cerebro), jamás de la
     palabra del SMS.
   SALIDA: «Banco Bandec: La Transferencia fue completada.
     Beneficiario: … Monto: … Saldo restante: …» — se guarda como
     salida, nunca como ingreso ni busca match.
   RUIDO: autenticación, consulta de saldo, errores y todo lo que no
     case con una plantilla se ignora (clase «ruido»).

   Devuelve {clase: 'entrada_cup'|'entrada_usd'|'salida'|'ruido',
   monto, moneda, cuenta_terminacion, tarjeta_terminacion,
   cuenta_tipo, asentable, telefono_ordenante, beneficiario,
   nro_transaccion}. La terminación es lo único que se estructura del
   número completo (el íntegro solo vive en el SMS crudo). */
const RE_PAGO_NRO = /Nro\.?\s*Transacci[oó]n\s*:?\s*([A-Za-z0-9-]+)/i;
const RE_PAGO_ENTRADA_CUENTA = new RegExp(
  "titular del tel[eé]fono\\s+(\\d+)\\s+le ha realizado una transferencia a la cuenta\\s+(\\d+)\\s+de\\s+" + MONTO + "\\s*CUP", "i");
const RE_PAGO_ENTRADA_TARJETA = new RegExp(
  "a su Tarjeta\\s+Cl[aá]sica\\s+(\\d+)\\s+de\\s+" + MONTO + "\\s*USD", "i");
const RE_PAGO_SALIDA = /La Transferencia fue completada/i;
const RE_PAGO_BENEFICIARIO = /Beneficiario:\s*(.+?)\s+Monto:/i;
const RE_PAGO_MONTO_SALIDA = new RegExp(
  "Monto:\\s*" + MONTO + "\\s*(?:CUP\\s*)?Saldo", "i");
const RE_PAGO_MONTO_SALIDA_SIMPLE = /Monto:\s*([0-9][0-9.,]*)/i;

function cuentaRegistrada(numero, cuentas) {
  if (!numero || !Array.isArray(cuentas)) {
    return { terminacion: numero ? numero.slice(-4) : null, tipo: null, asentable: false };
  }
  const term = numero.slice(-4);
  const c = cuentas.find((x) => x && x.terminacion === term);
  return {
    terminacion: term,
    tipo: c ? (c.tipo ?? null) : null,
    asentable: !!(c && c.asentable),
  };
}

export function parsearPagoMovil(cuerpo, cuentas) {
  const ruido = {
    clase: "ruido", monto: null, moneda: null,
    cuenta_terminacion: null, tarjeta_terminacion: null,
    cuenta_tipo: null, asentable: false,
    telefono_ordenante: null, beneficiario: null, nro_transaccion: null,
  };
  if (typeof cuerpo !== "string" || !cuerpo.trim()) return ruido;
  const nro = (cuerpo.match(RE_PAGO_NRO) || [])[1] || null;

  const mCup = cuerpo.match(RE_PAGO_ENTRADA_CUENTA);
  if (mCup) {
    const reg = cuentaRegistrada(mCup[2], cuentas);
    return {
      clase: "entrada_cup", monto: numeroDe(mCup[3]), moneda: "CUP",
      cuenta_terminacion: reg.terminacion, tarjeta_terminacion: null,
      cuenta_tipo: reg.tipo, asentable: reg.asentable,
      telefono_ordenante: mCup[1], beneficiario: null,
      nro_transaccion: nro,
    };
  }
  const mUsd = cuerpo.match(RE_PAGO_ENTRADA_TARJETA);
  if (mUsd) {
    const reg = cuentaRegistrada(mUsd[1], cuentas);
    const tel = (cuerpo.match(/titular del tel[eé]fono\s+(\d+)/i) || [])[1] || null;
    return {
      clase: "entrada_usd", monto: numeroDe(mUsd[2]), moneda: "USD",
      cuenta_terminacion: null, tarjeta_terminacion: reg.terminacion,
      cuenta_tipo: reg.tipo, asentable: reg.asentable,
      telefono_ordenante: tel, beneficiario: null,
      nro_transaccion: nro,
    };
  }
  if (RE_PAGO_SALIDA.test(cuerpo)) {
    const ben = (cuerpo.match(RE_PAGO_BENEFICIARIO) || [])[1] || null;
    const mMonto = cuerpo.match(RE_PAGO_MONTO_SALIDA)
      || cuerpo.match(RE_PAGO_MONTO_SALIDA_SIMPLE);
    return {
      clase: "salida", monto: mMonto ? numeroDe(mMonto[1]) : null,
      moneda: "CUP", cuenta_terminacion: null, tarjeta_terminacion: null,
      cuenta_tipo: null, asentable: false,
      telefono_ordenante: null,
      beneficiario: ben ? ben.trim() : null,
      nro_transaccion: nro,
    };
  }
  return ruido;
}

/* ¿El remitente es PAGO×MOVIL? El nombre llega del atajo tal cual lo
   ve iOS («PAGO×MOVIL»); se tolera la equis latina y espacios. */
export function esRemitentePago(remitente) {
  if (typeof remitente !== "string") return false;
  const t = remitente.toUpperCase().replace(/[\s_]+/g, "");
  return t === "PAGO×MOVIL" || t === "PAGOXMOVIL" || t === "PAGOMOVIL";
}

/* =====================================================================
   INGESTA OFFLINE-FIRST (ampliación 2026-11-13): el atajo guarda en
   su iPhone y sincroniza cuando vuelve la red. El cerebro acepta el
   client_uuid del evento (dedup duro: el resultado original se
   guarda en sms_ingesta y un reenvío lo devuelve tal cual), el envío
   en LOTE ordenado por la hora ORIGINAL del SMS (fecha_original que
   manda el atajo, no la de llegada) y las respuestas de clasificación
   recogidas en local viajando CON el evento.
   ===================================================================== */

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function clientUuidValido(v) {
  return typeof v === "string" && RE_UUID.test(v.trim())
    ? v.trim().toLowerCase() : null;
}

/* La hora original del SMS según el atajo (ISO o epoch ms). Sin hora
   sana → null (manda la de llegada). */
export function fechaOriginalDe(v) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v.trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/* Orden del lote: por hora original ascendente; sin hora, al final;
   empate o ausencia total → el orden de llegada (sort estable). */
export function ordenarLoteEventos(eventos) {
  if (!Array.isArray(eventos)) return [];
  return eventos
    .map((ev, i) => ({
      ev, i,
      t: ev && typeof ev === "object" ? fechaOriginalDe(ev.fecha_original) : null,
    }))
    .sort((a, b) => {
      if (a.t && b.t) return a.t < b.t ? -1 : (a.t > b.t ? 1 : a.i - b.i);
      if (a.t) return -1;
      if (b.t) return 1;
      return a.i - b.i;
    })
    .map((x) => x.ev);
}

/* Las respuestas de clasificación recogidas en local, normalizadas:
   {forma, numero} (propuesta de compra), {clase} (menú de salida),
   {total} (compra confirmada), {qusd} (venta confirmada). Lo que no
   es sano no viaja: null en su campo, jamás una cifra inventada. */
export function respuestasDe(item) {
  const r = item && typeof item === "object" ? item.respuestas : null;
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;
  const forma = claseDeMenu(typeof r.forma_texto === "string" ? r.forma_texto : "");
  const clase = claseDeMenu(typeof r.eleccion_texto === "string" ? r.eleccion_texto : "");
  const total = enteroPositivo(r.total);
  const qusd = qusdValido(r.qusd);
  const numero = aNumero(r.numero);
  if (!forma && !clase && total === null && qusd === null && numero === null) {
    return null;
  }
  return {
    forma: forma && forma !== "venta" && forma !== "devolucion" && forma !== "traspaso" ? forma : null,
    numero,
    clase: clase === "venta" || clase === "devolucion" || clase === "traspaso" ? clase : null,
    total, qusd,
  };
}

/* HACER/DESHACER (v2): la fila pa maximo_resultados. El Máster reporta
   {tipo:"previo"|"resultado", id:<tarea>, modulo, previo, resultado}:
   - "previo": el valor ACTUAL del estado ANTES de tocarlo (brillo/
     volumen/Focus reales vía getter; antorcha sin getter → previo
     null). El cerebro lo conserva pa ordenar el inverso = deshacer.
   - "resultado": el desenlace en texto de lo ejecutado.
   Sin id/modulo válidos → null = 400 (no se guardan huérfanos). */
export function filaResultado(cuerpo, fase) {
  if (!cuerpo || typeof cuerpo !== "object") return null;
  const tarea = cuerpo.id;
  const modulo = cuerpo.modulo;
  if (typeof tarea !== "string" || !tarea.trim() || tarea.length > 80) return null;
  if (typeof modulo !== "string" || !modulo.trim() || modulo.length > 60) return null;
  let resultado = null;
  if (typeof cuerpo.resultado === "string") {
    resultado = cuerpo.resultado.slice(0, 2000) || null;
  }
  const previo = "previo" in cuerpo ? (cuerpo.previo ?? null) : null;
  return {
    tarea_id: tarea.trim(),
    modulo: modulo.trim(),
    fase,
    previo,
    resultado,
  };
}

/* =====================================================================
   EL CRUDO DEL SENSOR v4 (2026-11-18): el atajo ya NO extrae campos
   en el teléfono — el motor de regex de iOS (ICU) no admite
   lookbehind de longitud variable y la v3.9.8 murió en vivo con
   «La expresión regular no era válida». El archivo de la cola viaja
   CRUDO (ruta «sms_crudo») y la extracción vive AQUÍ, con el motor
   JS completo. Formas aceptadas:
   1) PLANO v4 (lo que escribe el Sensor v4, separadores fijos):
        MAXIMO-SMS-4
        uuid: <uuid>
        fecha: <ISO 8601>
        remitente: ETECSA
        ---
        <el cuerpo tal cual, puede ser multilínea>
   2) LEGADO JSON de la cola vieja (el @ev de las v3.x guardado tal
      cual): JSON.parse directo; si el texto quedó roto por las
      comillas del propio cuerpo, captura por patrón con desescape.
   El uuid es OBLIGATORIO en toda forma: sin él no hay dedup duro y
   el evento no entra (la ruta responde crudo_invalido SIN id y el
   archivo se queda en la cola — nada se pierde ni se duplica).
   ===================================================================== */
/* ¿Este contenido NO contiene ningún SMS posible? La doctrina es
   la de la propia línea v3.x (su cuarentena): «un archivo con
   uuid y sin cuerpo legible NO es un evento posible — el evento
   nace con su texto dentro». Formas positivamente SIN cuerpo:
   el archivo vacío, el objeto JSON sin cuerpo (o con el cuerpo
   vacío) — ahí vive el centinela {"uuid": ""} que la v3.9.8
   escribía en la MISMA carpeta de la cola en cada corrida — y el
   plano v4 con el cuerpo vacío tras el «---». Solo ante estas
   formas la ruta «sms_crudo» responde {ok:true, descartar:true}
   (SIN «id»: no hay fila porque no hay evento) y el atajo borra
   el archivo. Un cuerpo presente pero sin uuid, o un contenedor
   desconocido, JAMÁS es descartable: se queda en la cola y la
   parada FIFO lo hace visible — un cuerpo real no se borra. */
export function esDescartable(contenido) {
  if (typeof contenido !== "string") return false;
  const txt = contenido.replace(/\r\n/g, "\n");
  if (!txt.trim()) return true;
  if (txt.startsWith("MAXIMO-SMS-4")) {
    const corte = txt.indexOf("\n---\n");
    if (corte >= 0 && !txt.slice(corte + 5).trim()) return true;
    return false;
  }
  try {
    const j = JSON.parse(txt);
    if (j && typeof j === "object" && !Array.isArray(j)) {
      return typeof j.cuerpo !== "string" || !j.cuerpo.trim();
    }
  } catch { /* no es JSON: contenedor desconocido, no se descarta */ }
  return false;
}

/* =====================================================================
   EL LOTE DEL SENSOR v4.1 (2026-11-18): la v4 hacía UNA llamada
   «Obtener contenido de URL» POR ARCHIVO y el servicio XPC de esa
   acción murió en vivo tres veces seguidas en el iPhone de Ernesto
   (iOS 18.7.10, red lenta: subía 1–2 archivos y la corrida caía con
   «XPC error received on message reply handler», el error fijado
   en esa acción en su captura del editor). La v4.1 junta TODOS los
   archivos pendientes en UN solo texto lote y hace exactamente
   UNA llamada por corrida. Encuadre del lote (lo construye el
   atajo, pieza a pieza): cada pieza viaja TAL CUAL (plano v4 con
   su cabecera, o el legado tal cual) seguida del delimitador
   DELIM_LOTE. partirLoteCrudo parte por el delimitador y descarta
   SOLO el segmento vacío final que deja el delimitador de cierre
   — un archivo vacío en el medio (o al final) sobrevive como
   pieza "" y esDescartable lo certifica descarte, como manda la
   doctrina. Las piezas NO se recortan aquí: parsearCrudo y
   esDescartable ya toleran los bordes. El delimitador es una
   línea imposible en un SMS real y en el JSON legado. */
export const DELIM_LOTE = "\n===MAXIMO-PIEZA===\n";

export function partirLoteCrudo(texto) {
  if (typeof texto !== "string" || !texto) return [];
  const partes = texto.replace(/\r\n/g, "\n").split(DELIM_LOTE);
  if (partes.length && partes[partes.length - 1] === "") partes.pop();
  return partes;
}

export function parsearCrudo(contenido) {
  if (typeof contenido !== "string" || !contenido.trim()) return null;
  const txt = contenido.replace(/\r\n/g, "\n");
  if (txt.startsWith("MAXIMO-SMS-4")) {
    const corte = txt.indexOf("\n---\n");
    if (corte < 0) return null;
    const cab = {};
    for (const linea of txt.slice(0, corte).split("\n").slice(1)) {
      const i = linea.indexOf(":");
      if (i > 0) cab[linea.slice(0, i).trim()] = linea.slice(i + 1).trim();
    }
    const cuerpoTxt = txt.slice(corte + 5).trim();
    if (!cab.uuid || !cuerpoTxt) return null;
    return {
      uuid: cab.uuid, fecha: cab.fecha ?? null,
      remitente: cab.remitente ?? "ETECSA", cuerpo: cuerpoTxt,
    };
  }
  try {
    const j = JSON.parse(txt);
    if (j && typeof j === "object"
        && typeof j.cuerpo === "string" && j.cuerpo.trim()
        && typeof j.uuid === "string" && j.uuid.trim()) {
      return {
        uuid: j.uuid,
        fecha: typeof j.fecha === "string" ? j.fecha : null,
        remitente: typeof j.remitente === "string" ? j.remitente : "ETECSA",
        cuerpo: j.cuerpo,
      };
    }
  } catch { /* cae a la captura por patrón */ }
  const ci = txt.indexOf('"cuerpo"');
  if (ci >= 0) {
    const abre = txt.indexOf('"', txt.indexOf(":", ci) + 1);
    const cierra = Math.max(txt.lastIndexOf('", "fecha"'),
                             txt.lastIndexOf('","fecha"'));
    if (abre >= 0 && cierra > abre) {
      let cuerpoTxt = txt.slice(abre + 1, cierra);
      // Si el corte trae escapes JSON, se desescapa; si trae las
      // comillas crudas que rompieron el JSON, queda tal cual (ese
      // ES el cuerpo verdadero).
      try { cuerpoTxt = JSON.parse('"' + cuerpoTxt + '"'); } catch { /* crudo */ }
      const mu = txt.match(/"uuid"\s*:\s*"([^"]*)"/);
      const mf = txt.match(/"fecha"\s*:\s*"([^"]*)"/);
      const mr = txt.match(/"remitente"\s*:\s*"([^"]*)"/);
      if (mu && typeof cuerpoTxt === "string" && cuerpoTxt.trim()) {
        return {
          uuid: mu[1], fecha: mf ? mf[1] : null,
          remitente: mr ? mr[1] : "ETECSA", cuerpo: cuerpoTxt,
        };
      }
    }
  }
  return null;
}

/* =====================================================================
   DEDUPE POR HUELLA DE SALDO (cerebro v19, 2026-11-18 — orden de
   Ernesto): con internet malo, ETECSA re-entrega el MISMO SMS dos
   veces (caso real de su hilo: «ha recibido 1080.0 CUP del numero
   50049642. Saldo principal 15910.08», dos copias idénticas). Cada
   copia nace en un archivo de la cola con client_uuid DISTINTO, así
   que el dedup duro por uuid NO la caza y, sin esta pieza, el saldo
   se contaría doble (dos esperas, dos lotes, cadena rota).

   LA HUELLA de una operación ejecutada es (tipo, contraparte,
   monto_cup, saldo_principal_cup): el saldo resultante es el estado
   de la línea tras la operación. Si la segunda «transferencia» fuera
   real, el saldo resultante sería OTRO (15910.08 + 1080 = 16990.08);
   que la copia traiga el MISMO saldo resultante prueba que es la
   misma operación re-entregada. Dos operaciones reales solo
   compartirían huella si el saldo volviera EXACTAMENTE al mismo
   valor con el mismo remitente y el mismo monto — y aun así la
   VENTANA lo acota: ±1 día por fecha_original (la re-entrega de la
   operadora llega en minutos u horas; una repetición real días
   después cuenta como operación nueva, porque el saldo ya se movió).

   La decisión es PURA (esDuplicadoPorHuella): la ingesta trae las
   filas candidatas ya contadas (parse_ok, sin marca de duplicado)
   y la función devuelve el id de la original o null. La copia se
   guarda en sms_linea con duplicado_de = ese id (auditoría) y NO
   genera eventos, esperas, ventas, atribuciones ni cadena otra vez.
   Solo aplica al riel ETECSA con parse completo (recibido y
   transferido); el riel PAGO×MOVIL conserva su dedup por
   Nro. Transaccion y la clasificación de tarjetas BANDEC por número
   queda intacta. */
export const VENTANA_HUELLA_DIAS = 1;

export function huellaDeSms(p) {
  if (!p || p.parse_ok !== true) return null;
  if (p.tipo !== "recibido" && p.tipo !== "transferido") return null;
  const monto = aNumero(p.monto_cup);
  const saldo = aNumero(p.saldo_principal_cup);
  if (monto === null || saldo === null) return null;
  if (typeof p.contraparte !== "string" || !p.contraparte) return null;
  return {
    tipo: p.tipo, contraparte: p.contraparte,
    monto_cup: monto, saldo_principal_cup: saldo,
  };
}

/* Instante en ms desde un texto de fecha, tolerante con las formas
   que viajan por el sistema: ISO con «Z» o con offset «-04:00», la
   forma de Postgres «2026-11-18 00:00:00+00» (espacio y offset sin
   minutos — Date.parse la devuelve NaN en V8) y epoch. Sin instante
   sano → null (la fila no decide nada). */
export function instanteDe(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string" || !v.trim()) return null;
  let t = v.trim().replace(" ", "T");
  t = t.replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : ms;
}

export function esDuplicadoPorHuella(huella, fechaNueva, filasPrevias) {
  if (!huella || !Array.isArray(filasPrevias)) return null;
  const tN = instanteDe(fechaNueva);
  if (tN === null) return null;
  const diaN = Math.floor(tN / 86400000);
  for (const f of filasPrevias) {
    if (!f || typeof f !== "object") continue;
    if (f.parse_ok !== true) continue;
    if (f.duplicado_de != null) continue; // una copia no es original
    if (f.tipo !== huella.tipo) continue;
    if (String(f.contraparte ?? "") !== huella.contraparte) continue;
    if (aNumero(f.monto_cup) !== huella.monto_cup) continue;
    if (aNumero(f.saldo_principal_cup) !== huella.saldo_principal_cup) {
      continue;
    }
    const tP = instanteDe(
      typeof f.fecha_original === "string" ? f.fecha_original
      : (typeof f.recibido_en === "string" ? f.recibido_en : null));
    if (tP === null) continue;
    const dias = Math.abs(diaN - Math.floor(tP / 86400000));
    if (dias <= VENTANA_HUELLA_DIAS) {
      return typeof f.id === "number" ? f.id : null;
    }
  }
  return null;
}

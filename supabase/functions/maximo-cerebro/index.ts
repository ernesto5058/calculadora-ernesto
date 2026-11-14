// =====================================================================
// Edge Function «maximo-cerebro» — EL CEREBRO DEL ATAJO MADRE (2026-11-12).
// Los atajos «Máximo» y «Máximo SMS» del iPhone de Ernesto hablan SOLO
// con esta puerta. Desplegada --no-verify-jwt: la auth es el token de
// dispositivo en la cabecera «x-maximo-token» (MAXIMO_MASTER_TOKEN; un
// token revocable y de bajo privilegio, NO un secreto maestro: vive
// solo en ~/workspace/.secure/maximo-master-token.env, dentro de los
// atajos firmados y como secreto de esta función — el firmante de
// atajos ve el archivo entero, por eso aquí no entra nada más).
//
// Contrato (fijo; los atajos se construyen contra él):
//   POST …/functions/v1/maximo-cerebro
//   header: x-maximo-token: <MAXIMO_MASTER_TOKEN>
//   JSON:    {"tipo":"config"}
//              → 200 (v5) {"version":"5", saludo_texto?: "…",
//                     abrir_url_texto?: "https://…"}
//                     SOLO campos de TEXTO, presentes o AUSENTES a
//                     propósito: el atajo v5 jamás compara booleanos —
//                     ramifica por «tiene valor» (la clave existe o no
//                     existe). saludo_texto viene solo si enabled &&
//                     saludar; abrir_url_texto solo si enabled &&
//                     comando="abrir_url" && hay url. Sin claves
//                     enabled/saludar/comando/url/tareas: la v4 murió
//                     dos veces en la puerta `if enTxt == "true"`
//                     (el booleano JSON volvía como «Sí», nunca como
//                     el texto "true", y el editor pintaba el operando
//                     vacío) — ver experimento-if-2026-11-12.md.
//            {"tipo":"latido","datos":{…}}
//              → 200 {"ok":true,"id":…} (fila en maximo_latidos)
//            {"tipo":"previo","id":<tarea>,"modulo":…,"previo":…}
//              → 200 {"ok":true,"id":…} (fila en maximo_resultados,
//                fase previo: el valor ANTES de tocar el estado —
//                la mitad HACER del circuito hacer/deshacer)
//            {"tipo":"resultado","id":<tarea>,"modulo":…,
//             "resultado":"…","previo":…}
//              → 200 {"ok":true,"id":…} (fase resultado)
//            {"tipo":"sms","remitente":"ETECSA","cuerpo":"…"}
//              → 200 {"ok":true,"id":…} (fila en sms_linea, mismo
//                parser probado de sms-captura — ver logica.js)
//   SENSOR SMS v2 (2026-11-13, «el artefacto que pregunta»): si el SMS
//   parseó (recibido/transferido), la ruta «sms» además crea el evento
//   en sms_eventos (estado «por_clasificar») y la respuesta trae UN
//   campo de texto presente solo según la dirección — el atajo v2
//   ramifica por presencia, jamás comparando (la lección v5):
//     entrada_texto: "Te entraron X de saldo del Y. ¿A cuánto lo
//     cogiste?" · salida_texto: "Salieron X de saldo pa'l Y. ¿Qué fue?"
//   Las respuestas del teléfono vuelven por tres rutas (siempre 200
//   tras la auth: la automatización no debe ver errores; el «ok»
//   interno dice si asentó):
//            {"tipo":"sms_precio","sms_id":…,"forma_texto":"Por unidad
//             (ej. 2.6)","numero":"2.6"} → {"propuesta_texto":"7800"}
//               (sin la clave si no hay propuesta sana: el atajo pide
//               el total a mano). REGLA DEL REDONDEO: se asienta el
//               TOTAL REAL PAGADO que Ernesto confirma, no el producto.
//            {"tipo":"sms_clase","sms_id":…,"eleccion_texto":"Venta"}
//             → venta: {"qusd_texto":"¿Por cuántos QUSD lo vendiste?"}
//               (clasifica y espera) · devolución/traspaso: asienta al
//               momento (reclasificación a costo, sin ganancia).
//            {"tipo":"sms_respuesta","sms_id":…,"total":7800} (compra)
//             → crea el lote y mueve efectivo→inventario.
//            {"tipo":"sms_respuesta","sms_id":…,"qusd":12.5} (venta)
//             → consumo FIFO de lotes, QUSD a su inversión (a costo) y
//               fila en dinero_ventas.
//            {"tipo":"sms_respuesta","sms_id":…,"dueno_texto":
//             "Es de Briku","tasa":2.6,"total":4732} (vuelta de
//             buscador, sensor v3.1 — 2026-11-14)
//             → Ernesto opera la cuenta del buscador y declara al
//               caer el SMS la tasa pactada y el total pagado: nace
//               la espera operada CON TASA (espera_crear_operada_tasa)
//               y se asienta contra ESTE SMS (espera_asentar_interna):
//               el lote nace con costo = total pagado y tasa_efectiva
//               = total ÷ saldo llegado, con el peaje −5 como línea
//               propia. Si la regla del capital (efectivo en mano del
//               buscador) rechaza la espera, NO se asienta nada y las
//               respuestas quedan en el evento pa su arbitraje.
//   Sin respuesta, el evento queda en la vista sms_por_clasificar:
//   jamás se asienta a ciegas. «prueba»:true en «sms» marca el evento
//   es_prueba y todo su asiento cae en el libro de prueba.
//   NÚCLEO DE VUELTAS + OFFLINE-FIRST (2026-11-13): la ruta «sms» es
//   la ingesta unificada — distingue por REMITENTE: «ETECSA» (parser
//   de siempre) o «PAGO×MOVIL» (parser Pago×Móvil de logica.js: el
//   cerebro clasifica por número de cuenta registrado, dedup duro
//   por Nro. Transaccion). Cada evento puede traer:
//     «client_uuid»: UUID del teléfono — dedup duro de transporte:
//       el resultado original se guarda en sms_ingesta y un reenvío
//       lo devuelve tal cual, sin duplicar evento ni asiento.
//     «fecha_original»: hora del SMS en el teléfono (ISO o epoch ms)
//       — la ventana del match se mide contra ELLA, no contra la
//       llegada.
//     «respuestas»: {forma_texto, numero, eleccion_texto, total,
//       qusd} recogidas en local sin conexión; se aplican al procesar
//       si el match de esperas no asentó el evento.
//   Antes de preguntar, la entrada cruza las ESPERAS de buscadores
//   (puertas espera_match_saldo / espera_match_transferencia): match
//   único → la vuelta se asienta sola con su prueba enlazada y la
//   respuesta trae espera:"cumplida" SIN texto de pregunta; sin match
//   o ambiguo → la cola de siempre con motivo_match en los datos.
//            {"tipo":"sms_lote","eventos":[{…sms…}, …]}
//              → 200 {"ok":true,"resultados":[…]}: la cola local del
//                atajo sincronizada en orden por fecha_original.
//            {"tipo":"espera_crear","buscador":"…","tipo_espera":
//             "saldo"|"transferencia","cantidad":…,"capital_cup":…,
//             "telefono"?:…,"ventana_horas"?:48}
//              → la puerta espera_crear_operada (modo operado de
//                Ernesto; la regla del capital manda en el servidor).
//   → 401 token ausente/malo · 400 tipo desconocido o SMS sin cuerpo ·
//     405 método distinto de POST. Los errores NO llevan datos.
// El kill-switch vive en maximo_config.enabled y desde la v5 es DEL
// SERVIDOR: si enabled=false, el cerebro DESCARTA latido/previo/
// resultado (responde 200 {"ok":true,"descartado":true} sin guardar)
// y la config sale sin saludo_texto ni abrir_url_texto. El atajo
// siempre corre y reporta; quien decide es el cerebro. Si la fila de
// config no se puede leer, NO se descarta (fail-open: un error de
// lectura no es un apagado deliberado). Si el token se revoca (se
// cambia el secreto), ningún atajo viejo puede ya hablar con el
// cerebro.
// =====================================================================

import { parsearSms, rutaDe, datosLatido, filaResultado, clasificarRed, decidirRed, aNumero, enteroPositivo, qusdValido, claseDeMenu, duenoDeMenu, resolverCompra, costoConsumo, formatoMonto, parsearPagoMovil, esRemitentePago, clientUuidValido, fechaOriginalDe, ordenarLoteEventos, respuestasDe } from "./logica.js";

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function tokenOk(req: Request): boolean {
  const esperado = Deno.env.get("MAXIMO_MASTER_TOKEN") || "";
  const recibido = req.headers.get("x-maximo-token") || "";
  if (!esperado || recibido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) {
    dif |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  }
  return dif === 0;
}

const restBase = () => (Deno.env.get("SUPABASE_URL") || "") + "/rest/v1/";
const restKey = () => Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

/* La fila única de maximo_config (o null si no se pudo leer). Se lee
   UNA vez por petición y alimenta tanto la respuesta de config como
   el kill-switch del servidor. */
async function leerFilaConfig(): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(
      restBase() + "maximo_config?id=eq.1&select=enabled,version,comando,url,saludar",
      {
        headers: { apikey: restKey(), Authorization: "Bearer " + restKey() },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!r.ok) return null;
    const filas = await r.json() as Record<string, unknown>[];
    return filas[0] ?? null;
  } catch {
    return null;
  }
}

/* La config v5: SOLO texto, presente o ausente a propósito (ver el
   contrato arriba). Nada de booleanos que el atajo tenga que
   comparar: si la clave no viene, el atajo lee «sin valor» y no
   ramifica. Con enabled=false la config sale pelada (sin saludo ni
   url) y además el handler descarta los reportes. */
function responderConfig(c: Record<string, unknown>): Response {
  const version = String(c.version ?? 5);
  const resp: Record<string, unknown> = { version };
  if (c.enabled === true) {
    if (c.saludar === true) {
      resp.saludo_texto = `Máximo en línea · config v${version}`;
    }
    const url = typeof c.url === "string" ? c.url : "";
    if (c.comando === "abrir_url" && url) {
      resp.abrir_url_texto = url;
    }
  }
  return json(resp);
}

/* ===== AUTO-DESPARQUEO (ruta «red» / «red_resultado») =====
   El atajo «Máximo Desparqueo» lee su red y pregunta; el cerebro
   decide con la máquina de estados de logica.js (decidirRed) sobre
   la fila del dispositivo en maximo_red, y cada cosa que pasa queda
   en maximo_desparqueos. La respuesta lleva el contrato numérico
   {accion, modo, motivo} Y, a la manera de la config v5, un campo
   de TEXTO presente solo cuando toca actuar (orden_real /
   orden_prueba): el atajo ramifica por presencia (condición 100),
   jamás comparando números ni textos contra el JSON — la lección
   de las v2–v4. El kill-switch de esta ruta es suyo
   (maximo_config.desparqueo_enabled/_modo), no el global. */
function hoyHabana(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Havana", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function dispositivoDe(cuerpo: Record<string, unknown>): string {
  const d = typeof cuerpo.dispositivo === "string" ? cuerpo.dispositivo.trim() : "";
  return /^[A-Za-z0-9_-]{1,40}$/.test(d) ? d : "principal";
}

/* ===== LECTURAS CON LUGAR (v1.1, 2026-11-12) =====
   El atajo puede mandar lat/lon OPCIONALES con la lectura. El
   servidor las redondea a 3 decimales (~100 m: se guarda el barrio,
   no el punto exacto) y clasifica el lugar contra el pin de su casa:
   «casa» si la distancia es ≤ 150 m, «fuera» si hay coordenadas
   sanas y no cumple, «sin_dato» si no vienen o no son coordenadas
   válidas. El lugar viaja SOLO en el detalle de los eventos
   (maximo_desparqueos): en esta versión NO toca la decisión — la
   divergencia de reglas por lugar (p. ej. en casa tolerar más la
   3G floja, fuera desparquear antes) vendrá cuando el mapa tenga
   datos acumulados que la justifiquen, no antes. */
const PIN_CASA = { lat: 20.045670, lon: -75.826819 };
const RADIO_CASA_M = 150;

function numeroCoord(v: unknown): number | null {
  const n = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
  return Number.isFinite(n) ? n : null;
}

function distanciaM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function lugarDe(cuerpo: Record<string, unknown>): { lat: number | null; lon: number | null; lugar: string } {
  const lat0 = numeroCoord(cuerpo.lat), lon0 = numeroCoord(cuerpo.lon);
  if (lat0 === null || lon0 === null || Math.abs(lat0) > 90 || Math.abs(lon0) > 180) {
    return { lat: null, lon: null, lugar: "sin_dato" };
  }
  return {
    lat: Math.round(lat0 * 1000) / 1000,
    lon: Math.round(lon0 * 1000) / 1000,
    lugar: distanciaM(lat0, lon0, PIN_CASA.lat, PIN_CASA.lon) <= RADIO_CASA_M ? "casa" : "fuera",
  };
}

async function leerConfigRed(): Promise<{ enabled: boolean; modo: string }> {
  try {
    const r = await fetch(
      restBase() + "maximo_config?id=eq.1&select=desparqueo_enabled,desparqueo_modo",
      { headers: { apikey: restKey(), Authorization: "Bearer " + restKey() }, signal: AbortSignal.timeout(15000) },
    );
    if (!r.ok) return { enabled: true, modo: "prueba" };
    const filas = await r.json() as Record<string, unknown>[];
    const c = filas[0];
    if (!c) return { enabled: true, modo: "prueba" };
    // Si la fila no se puede leer, el modo por defecto es «prueba»:
    // jamás se actúa de verdad sin config leída.
    return {
      enabled: c.desparqueo_enabled !== false,
      modo: c.desparqueo_modo === "real" ? "real" : "prueba",
    };
  } catch {
    return { enabled: true, modo: "prueba" };
  }
}

async function leerEstadoRed(disp: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(
      restBase() + "maximo_red?dispositivo=eq." + encodeURIComponent(disp) + "&select=*",
      { headers: { apikey: restKey(), Authorization: "Bearer " + restKey() }, signal: AbortSignal.timeout(15000) },
    );
    if (!r.ok) return null;
    const filas = await r.json() as Record<string, unknown>[];
    return filas[0] ?? null;
  } catch {
    return null;
  }
}

async function guardarEstadoRed(disp: string, cambios: Record<string, unknown>) {
  const fila = { dispositivo: disp, actualizado: new Date().toISOString(), ...cambios };
  await fetch(restBase() + "maximo_red?on_conflict=dispositivo", {
    method: "POST",
    headers: {
      apikey: restKey(),
      Authorization: "Bearer " + restKey(),
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(fila),
    signal: AbortSignal.timeout(15000),
  });
}

async function insertar(tabla: string, fila: Record<string, unknown>) {
  const r = await fetch(restBase() + tabla, {
    method: "POST",
    headers: {
      apikey: restKey(),
      Authorization: "Bearer " + restKey(),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(fila),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return null;
  const filas = await r.json() as { id?: number }[];
  return filas[0]?.id ?? null;
}

/* ===== SENSOR SMS v2: lecturas, parches y el asiento en el libro ===== */
async function leerFilas(tabla: string, query: string): Promise<Record<string, unknown>[] | null> {
  try {
    const r = await fetch(restBase() + tabla + "?" + query, {
      headers: { apikey: restKey(), Authorization: "Bearer " + restKey() },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    return await r.json() as Record<string, unknown>[];
  } catch {
    return null;
  }
}

async function parche(tabla: string, query: string, cambios: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch(restBase() + tabla + "?" + query, {
      method: "PATCH",
      headers: {
        apikey: restKey(),
        Authorization: "Bearer " + restKey(),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(cambios),
      signal: AbortSignal.timeout(15000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/* El único camino de escritura al libro: la puerta dinero_mover de la
   Fase 1 (entero bigint por firma; la validación de entero positivo
   de los totales vive en logica.js antes de llegar aquí). */
async function mover(cuenta: string, tipo: string, monto: number, medio: string,
                     ref: string, detalle: string, prueba: boolean): Promise<boolean> {
  try {
    const r = await fetch(restBase() + "rpc/dinero_mover", {
      method: "POST",
      headers: {
        apikey: restKey(),
        Authorization: "Bearer " + restKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_cuenta: cuenta, p_tipo: tipo, p_monto: monto, p_medio: medio,
        p_ref: ref, p_detalle: detalle, p_prueba: prueba,
      }),
      signal: AbortSignal.timeout(15000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/* Llamada a una puerta RPC con service_role (las puertas espera_*:
   la autorización es la espera misma, no un código). Devuelve el
   jsonb de la puerta o null si la llamada falló. */
async function llamarRpc(nombre: string, params: Record<string, unknown>) {
  try {
    const r = await fetch(restBase() + "rpc/" + nombre, {
      method: "POST",
      headers: {
        apikey: restKey(),
        Authorization: "Bearer " + restKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    return await r.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

/* Las cuentas registradas del riel Pago×Móvil (terminación → tipo):
   el parser clasifica por NÚMERO, jamás por la palabra del SMS. */
async function leerCuentasPago(): Promise<Record<string, unknown>[]> {
  const f = await leerFilas("pago_cuentas", "select=terminacion,tipo,asentable");
  return f ?? [];
}

/* Inserta y devuelve la fila íntegra (o null). Pa tablas cuya llave
   no es «id» (sms_ingesta) o pa detectar el conflicto de unicidad. */
async function insertarFila(tabla: string, fila: Record<string, unknown>) {
  try {
    const r = await fetch(restBase() + tabla, {
      method: "POST",
      headers: {
        apikey: restKey(),
        Authorization: "Bearer " + restKey(),
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(fila),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const filas = await r.json() as Record<string, unknown>[];
    return filas[0] ?? null;
  } catch {
    return null;
  }
}

async function leerEvento(smsId: number) {
  const f = await leerFilas("sms_eventos", "sms_id=eq." + smsId + "&select=*");
  return f && f.length ? f[0] : null;
}

async function leerSms(smsId: number) {
  const f = await leerFilas("sms_linea", "id=eq." + smsId + "&select=*");
  return f && f.length ? f[0] : null;
}

/* Asiento de COMPRA propia (entrada de saldo clasificada): crea el
   lote y mueve el efectivo de su inversión al inventario (al costo).
   Par neutro: el cuadre del libro no se mueve. */
async function asentarCompra(ev: Record<string, unknown>, sms: Record<string, unknown>, total: number) {
  const prueba = ev.es_prueba === true;
  const cantidad = aNumero(sms.monto_cup);
  if (cantidad === null || cantidad <= 0) return { ok: false, motivo: "sin_monto" };
  const tasaEf = Math.round(total / cantidad * 10000) / 10000;
  const detalle = `SMS ${ev.sms_id} · compra de saldo del ${sms.contraparte ?? "?"}`;
  const loteId = await insertar("dinero_lotes_saldo", {
    evento_id: ev.id, sms_id: ev.sms_id,
    cantidad_saldo: cantidad, cantidad_restante: cantidad,
    costo_total_cup: total, costo_restante_cup: total,
    tasa_efectiva: tasaEf, contraparte: sms.contraparte ?? null,
    es_prueba: prueba,
  });
  if (loteId === null) return { ok: false, motivo: "lote_fallo" };
  if (!await mover("ernesto_inversion", "compra_saldo", -total, "efectivo", String(ev.sms_id), detalle, prueba)) {
    return { ok: false, motivo: "movimiento_fallo" };
  }
  if (!await mover("inventario", "compra_saldo", total, "saldo", String(ev.sms_id), detalle, prueba)) {
    return { ok: false, motivo: "movimiento_fallo" };
  }
  const datos = { ...(ev.datos as Record<string, unknown>), clasificacion: "compra", total_cup: total, tasa_efectiva: tasaEf };
  await parche("sms_eventos", "id=eq." + ev.id, {
    estado: "asentado", clasificacion: "compra", lote_id: loteId,
    datos, actualizado_en: new Date().toISOString(),
  });
  return { ok: true };
}

/* Respuesta «ES DE UN BUSCADOR» (sensor v3.1, 2026-11-14): Ernesto
   opera la cuenta del buscador (Briku no tiene teléfono) y declara
   al caer el SMS la tasa pactada y el total pagado en efectivo. El
   asiento NO es el de compra propia: nace la espera operada CON
   TASA y se asienta contra ESTE SMS — el lote nace con costo =
   total pagado y tasa_efectiva = total ÷ saldo llegado, con el
   peaje −5 como línea propia de la espera. La cantidad esperada se
   declara como lo llegado + 5 (UN envío: la pregunta ordenada no
   cuenta envíos; las vueltas de varios envíos siguen naciendo por
   el parte). Si la regla del capital rechaza la espera, NADA se
   asienta: las respuestas quedan guardadas en el evento pa el
   arbitraje de Ernesto, y si el asiento falla tras crear la espera,
   la espera se cancela pa que no comprometa capital. */
async function responderDuenoBuscador(ev: Record<string, unknown>, sms: Record<string, unknown>,
                                      buscador: string, cuerpo: Record<string, unknown>) {
  const total = enteroPositivo(cuerpo.total);
  const tasa = aNumero(cuerpo.tasa);
  const monto = aNumero(sms.monto_cup);
  if (total === null) return { ok: false, motivo: "total_invalido" };
  if (tasa === null || tasa <= 0 || tasa >= 1000) return { ok: false, motivo: "tasa_invalida" };
  if (monto === null || monto <= 0) return { ok: false, motivo: "sin_monto" };
  const guardarRespuestas = async (motivo: string) => {
    const datos = {
      ...(ev.datos as Record<string, unknown>),
      respuestas_dueno: { buscador, tasa_pactada: tasa, total_pagado: total },
      motivo_dueno: motivo,
    };
    await parche("sms_eventos", "id=eq." + ev.id, {
      datos, actualizado_en: new Date().toISOString(),
    });
  };
  const creada = await llamarRpc("espera_crear_operada_tasa", {
    p_buscador: buscador, p_tipo: "saldo",
    p_cantidad: monto + 5, p_capital: total,
    p_telefono: null, p_ventana_horas: 48,
    p_prueba: ev.es_prueba === true,
    p_tasa_pactada: tasa, p_total_pagado: total, p_envios: 1,
  });
  if (!creada || creada.ok !== true || !creada.espera_id) {
    const motivo = creada ? String(creada.motivo ?? "espera_rechazada") : "sin_respuesta_espera";
    await guardarRespuestas(motivo);
    return { ok: false, motivo };
  }
  const esperaId = creada.espera_id as string;
  const asiento = await llamarRpc("espera_asentar_interna", {
    p_espera: esperaId, p_cantidad_real: monto,
    p_sms_id: Number(ev.sms_id), p_pago_transaccion: null,
  });
  if (!asiento || asiento.ok !== true) {
    await llamarRpc("espera_cancelar", {
      p_espera: esperaId, p_motivo: "asiento_fallo_atajo",
    });
    const motivo = asiento ? String(asiento.motivo ?? "asiento_fallo") : "sin_respuesta_asiento";
    await guardarRespuestas(motivo);
    return { ok: false, motivo };
  }
  const datos = {
    ...(ev.datos as Record<string, unknown>),
    via: "atajo_dueno", flujo: "vuelta_buscador",
    espera_id: esperaId, vueltas: asiento.vueltas,
    tasa_pactada: tasa, total_pagado: total,
  };
  await parche("sms_eventos", "id=eq." + ev.id, {
    estado: "asentado", clasificacion: "devolucion",
    lote_id: (asiento.lote_id as string | null) ?? null,
    datos, actualizado_en: new Date().toISOString(),
  });
  return { ok: true, asentado: "vuelta", espera_id: esperaId };
}

/* Asiento de SALIDA (venta / devolución / traspaso): consumo FIFO de
   lotes a costo. La venta registra además la fila de dinero_ventas
   (los QUSD reales) y su contra-movimiento viaja con medio «qusd» (a
   costo: la ganancia en CUP nace a la salida del QUSD, otra puerta).
   Devolución/traspaso reclasifican a costo, sin ganancia. Si los
   lotes no alcanzan (saldo anterior al sensor), NO se asienta: el
   evento queda en la cola con el motivo. */
async function asentarSalida(ev: Record<string, unknown>, sms: Record<string, unknown>,
                             clasificacion: string, qusd: number | null) {
  const prueba = ev.es_prueba === true;
  const cantidad = aNumero(sms.monto_cup);
  if (cantidad === null || cantidad <= 0) return { ok: false, motivo: "sin_monto" };
  const lotes = await leerFilas("dinero_lotes_saldo",
    "es_prueba=eq." + prueba + "&cantidad_restante=gt.0&order=creado_en.asc&select=id,cantidad_restante,costo_restante_cup");
  const plan = lotes ? costoConsumo(lotes, cantidad) : null;
  if (!plan) {
    const datos = { ...(ev.datos as Record<string, unknown>), clasificacion, motivo: "sin_lote" };
    await parche("sms_eventos", "id=eq." + ev.id, {
      clasificacion, datos, actualizado_en: new Date().toISOString(),
    });
    return { ok: false, motivo: "sin_lote" };
  }
  for (const c of plan.consumos) {
    const lote = (lotes as Record<string, unknown>[]).find((l) => l.id === c.id);
    if (!lote) return { ok: false, motivo: "lote_fallo" };
    const okPatch = await parche("dinero_lotes_saldo", "id=eq." + c.id, {
      cantidad_restante: Math.round(((aNumero(lote.cantidad_restante) ?? 0) - c.cantidad) * 100) / 100,
      costo_restante_cup: (aNumero(lote.costo_restante_cup) ?? 0) - c.costo,
    });
    if (!okPatch) return { ok: false, motivo: "lote_fallo" };
  }
  const esVenta = clasificacion === "venta";
  const tipoMov = esVenta ? "venta_saldo" : (clasificacion === "devolucion" ? "devolucion_saldo" : "traspaso_saldo");
  const detalle = `SMS ${ev.sms_id} · ${clasificacion} de saldo · ${sms.contraparte ?? "?"}`;
  if (!await mover("inventario", tipoMov, -plan.costo_total, "saldo", String(ev.sms_id), detalle, prueba)) {
    return { ok: false, motivo: "movimiento_fallo" };
  }
  if (!await mover("ernesto_inversion", tipoMov, plan.costo_total, esVenta ? "qusd" : "saldo", String(ev.sms_id), detalle, prueba)) {
    return { ok: false, motivo: "movimiento_fallo" };
  }
  const datos: Record<string, unknown> = {
    ...(ev.datos as Record<string, unknown>), clasificacion,
    costo_lote_cup: plan.costo_total, consumos: plan.consumos,
  };
  if (esVenta && qusd !== null) {
    datos.qusd = qusd;
    const tasa = Math.round(cantidad / qusd * 100) / 100;
    datos.tasa_saldo_por_qusd = tasa;
    await insertar("dinero_ventas", {
      fuente: "sms", tipo: "saldo", monto: qusd, tasa,
      contraparte: sms.contraparte ?? null,
      hora: typeof sms.recibido_en === "string" ? sms.recibido_en : new Date().toISOString(),
      es_prueba: prueba,
    });
  }
  await parche("sms_eventos", "id=eq." + ev.id, {
    estado: "asentado", clasificacion, datos,
    actualizado_en: new Date().toISOString(),
  });
  return { ok: true, costo: plan.costo_total };
}

/* ===== INGESTA SMS UNIFICADA (ETECSA + PAGO×MOVIL, offline-first) =====
   Un solo camino pa la ruta «sms» (un evento) y «sms_lote» (varios,
   ya ordenados por hora original). Garantías:
   - DEDUP DURO por client_uuid: la fila de sms_ingesta guarda el
     resultado ORIGINAL; un reenvío lo devuelve tal cual (con la
     marca «duplicado») sin crear evento ni asiento nuevos.
   - DEDUP DURO por Nro. Transaccion en el riel Pago×Móvil.
   - MATCH DE ESPERAS primero (saldo: puerta espera_match_saldo;
     transferencia: espera_match_transferencia). Sin match o ambiguo,
     el evento queda «por_clasificar» con su motivo — como hoy — y se
     aplican las respuestas de clasificación que viajaron con el
     evento (recogidas en local por el atajo sin conexión).
   - La hora que manda pa la ventana de la espera es la ORIGINAL del
     SMS (fecha_original del atajo), no la de llegada del lote. */
async function procesarEventoSms(item: Record<string, unknown>): Promise<Record<string, unknown>> {
  let remitente: string | null = null;
  if (typeof item.remitente === "string") {
    remitente = item.remitente.slice(0, 80) || null;
  }
  let texto = typeof item.cuerpo === "string" ? item.cuerpo.trim() : "";
  if (!texto) return { ok: false, motivo: "sin_cuerpo" };
  if (texto.length > 10000) texto = texto.slice(0, 10000);
  const prueba = item.prueba === true;
  const clientUuid = clientUuidValido(item.client_uuid);
  const fechaOrig = fechaOriginalDe(item.fecha_original);
  const fechaMatch = fechaOrig ?? new Date().toISOString();
  const respuestas = respuestasDe(item);

  // --- dedup de transporte: reclamo de la ingesta ---
  let smsIdReusar: number | null = null;
  if (clientUuid) {
    const prev = await leerFilas("sms_ingesta",
      "client_uuid=eq." + clientUuid + "&select=*");
    if (prev && prev.length) {
      const p = prev[0];
      if (p.resultado && typeof p.resultado === "object") {
        return { ...(p.resultado as Record<string, unknown>), duplicado: true };
      }
      if (typeof p.sms_id === "number") smsIdReusar = p.sms_id as number;
    } else {
      await insertarFila("sms_ingesta", {
        client_uuid: clientUuid, remitente,
        fecha_original: fechaOrig, es_prueba: prueba,
      });
    }
  }

  const guardarResultado = async (smsId: number | null, res: Record<string, unknown>) => {
    if (clientUuid) {
      await parche("sms_ingesta", "client_uuid=eq." + clientUuid, {
        sms_id: smsId, resultado: res,
        actualizado_en: new Date().toISOString(),
      });
    }
    return res;
  };

  const esPago = esRemitentePago(remitente ?? "");

  // --- el SMS crudo a sms_linea (la verdad ejecutada, como siempre) ---
  let smsId: number | null = smsIdReusar;
  if (smsId === null) {
    if (esPago) {
      smsId = await insertar("sms_linea", {
        remitente, cuerpo: texto, tipo: "otro", parse_ok: false,
        fecha_original: fechaOrig, client_uuid: clientUuid,
      });
    } else {
      const p0 = parsearSms(texto);
      smsId = await insertar("sms_linea", {
        remitente, cuerpo: texto, ...p0,
        fecha_original: fechaOrig, client_uuid: clientUuid,
      });
    }
    if (smsId === null && clientUuid) {
      // Carrera o reintento: la fila ya existe con este client_uuid.
      const f = await leerFilas("sms_linea",
        "client_uuid=eq." + clientUuid + "&select=id");
      if (f && f.length) smsId = f[0].id as number;
    }
  }
  if (smsId === null) return { ok: false, motivo: "insercion_fallo" };

  /* ---------- RIEL PAGO×MOVIL ---------- */
  if (esPago) {
    const cuentas = await leerCuentasPago();
    const parsed = parsearPagoMovil(texto, cuentas);
    const resp: Record<string, unknown> = { ok: true, id: smsId, clase: parsed.clase };
    if (parsed.clase === "ruido") {
      resp.ignorado = true;
      return guardarResultado(smsId, resp);
    }
    if (parsed.nro_transaccion) {
      const prevEv = await leerFilas("pago_eventos",
        "nro_transaccion=eq." + encodeURIComponent(parsed.nro_transaccion) + "&select=id,estado");
      if (prevEv && prevEv.length) {
        resp.duplicado_transaccion = true;
        resp.pago_evento_id = prevEv[0].id;
        return guardarResultado(smsId, resp);
      }
    }
    const filaPago: Record<string, unknown> = {
      sms_id: smsId, direccion: parsed.clase,
      monto: parsed.monto, moneda: parsed.moneda,
      cuenta_terminacion: parsed.cuenta_terminacion ?? parsed.tarjeta_terminacion,
      cuenta_tipo: parsed.cuenta_tipo,
      telefono_ordenante: parsed.telefono_ordenante,
      beneficiario: parsed.beneficiario,
      nro_transaccion: parsed.nro_transaccion,
      datos: { asentable: parsed.asentable },
      es_prueba: prueba,
    };
    if (parsed.clase === "salida") {
      // La salida se guarda como salida: registrada, jamás ingreso.
      filaPago.estado = "registrado";
    }
    let pagoEv = await insertarFila("pago_eventos", filaPago);
    if (pagoEv === null && parsed.nro_transaccion) {
      const prevEv = await leerFilas("pago_eventos",
        "nro_transaccion=eq." + encodeURIComponent(parsed.nro_transaccion) + "&select=id,estado");
      if (prevEv && prevEv.length) {
        resp.duplicado_transaccion = true;
        resp.pago_evento_id = prevEv[0].id;
        return guardarResultado(smsId, resp);
      }
    }
    if (pagoEv === null) return guardarResultado(smsId, { ok: false, motivo: "pago_evento_fallo", id: smsId });
    resp.pago_evento_id = pagoEv.id;

    if (parsed.clase === "entrada_usd") {
      await parche("pago_eventos", "id=eq." + pagoEv.id, {
        motivo: "entrada_usd_sin_match",
      });
      resp.motivo = "entrada_usd_sin_match";
      return guardarResultado(smsId, resp);
    }
    if (parsed.clase === "salida") {
      resp.registrada = true;
      return guardarResultado(smsId, resp);
    }
    // entrada_cup: el match manda.
    if (!parsed.asentable) {
      await parche("pago_eventos", "id=eq." + pagoEv.id, {
        motivo: "cuenta_no_asentable",
      });
      resp.motivo = "cuenta_no_asentable";
      return guardarResultado(smsId, resp);
    }
    if (!parsed.nro_transaccion) {
      await parche("pago_eventos", "id=eq." + pagoEv.id, {
        motivo: "sin_transaccion",
      });
      resp.motivo = "sin_transaccion";
      return guardarResultado(smsId, resp);
    }
    const m = await llamarRpc("espera_match_transferencia", {
      p_sms_id: smsId, p_monto: parsed.monto,
      p_telefono: parsed.telefono_ordenante,
      p_cuenta_terminacion: parsed.cuenta_terminacion,
      p_transaccion: parsed.nro_transaccion,
      p_fecha: fechaMatch, p_prueba: prueba,
    });
    if (m && m.resultado === "asentado") {
      const vueltas = Array.isArray(m.vueltas) ? m.vueltas as unknown[] : [];
      await parche("pago_eventos", "id=eq." + pagoEv.id, {
        estado: "asentado", espera_id: m.espera_id,
        vuelta_id: vueltas[0] ?? null,
      });
      resp.espera = "cumplida";
      resp.espera_id = m.espera_id;
    } else {
      const motivo = m ? String(m.motivo ?? m.resultado ?? "sin_match") : "sin_respuesta_match";
      await parche("pago_eventos", "id=eq." + pagoEv.id, { motivo });
      resp.espera = "sin_match";
      resp.motivo = motivo;
    }
    return guardarResultado(smsId, resp);
  }

  /* ---------- RIEL ETECSA (como hoy + match de esperas) ---------- */
  const p = parsearSms(texto);
  const resp: Record<string, unknown> = { ok: true, id: smsId };
  if (p.parse_ok && (p.tipo === "recibido" || p.tipo === "transferido")) {
    let ev = await leerEvento(smsId);
    if (!ev) {
      await insertar("sms_eventos", {
        sms_id: smsId,
        clase: p.tipo === "recibido" ? "entrada" : "salida",
        datos: { monto_cup: p.monto_cup, contraparte: p.contraparte },
        es_prueba: prueba,
      });
      ev = await leerEvento(smsId);
    }
    if (ev && ev.estado === "asentado") {
      resp.ya = true;
      return guardarResultado(smsId, resp);
    }
    if (ev && p.tipo === "recibido") {
      // Entrada de saldo: primero la espera del buscador.
      const m = await llamarRpc("espera_match_saldo", {
        p_sms_id: smsId, p_monto: p.monto_cup,
        p_fecha: fechaMatch, p_prueba: prueba,
      });
      if (m && m.resultado === "asentado") {
        const datosEv = {
          ...(ev.datos as Record<string, unknown>),
          via: "espera", espera_id: m.espera_id, vueltas: m.vueltas,
        };
        await parche("sms_eventos", "id=eq." + ev.id, {
          estado: "asentado", clasificacion: "devolucion",
          lote_id: (m.lote_id as string | null) ?? null,
          datos: datosEv, actualizado_en: new Date().toISOString(),
        });
        resp.espera = "cumplida";
        resp.espera_id = m.espera_id;
        return guardarResultado(smsId, resp);
      }
      const motivo = m ? String(m.motivo ?? m.resultado ?? "sin_match") : "sin_respuesta_match";
      await parche("sms_eventos", "id=eq." + ev.id, {
        datos: { ...(ev.datos as Record<string, unknown>), motivo_match: motivo },
        actualizado_en: new Date().toISOString(),
      });
      resp.espera = "sin_match";
      resp.motivo_match = motivo;
      // Flujo de siempre: la pregunta viaja y las respuestas
      // recogidas en local se aplican aquí mismo.
      resp.entrada_texto = `Te entraron ${formatoMonto(p.monto_cup)} de saldo del ${p.contraparte}. ¿A cuánto lo cogiste?`;
      if (respuestas && respuestas.total !== null) {
        const sms = await leerSms(smsId);
        if (sms) {
          const r = await asentarCompra(ev, sms, respuestas.total);
          if (r.ok) { resp.asentado = "compra"; delete resp.entrada_texto; }
        }
      }
      return guardarResultado(smsId, resp);
    }
    if (ev && p.tipo === "transferido") {
      resp.salida_texto = `Salieron ${formatoMonto(p.monto_cup)} de saldo pa'l ${p.contraparte}. ¿Qué fue?`;
      if (respuestas && respuestas.clase) {
        const sms = await leerSms(smsId);
        if (sms) {
          if (respuestas.clase === "venta" && respuestas.qusd !== null) {
            const r = await asentarSalida(ev, sms, "venta", respuestas.qusd);
            if (r.ok) { resp.asentado = "venta"; delete resp.salida_texto; }
          } else if (respuestas.clase !== "venta") {
            const r = await asentarSalida(ev, sms, respuestas.clase, null);
            if (r.ok) { resp.asentado = respuestas.clase; delete resp.salida_texto; }
          }
        }
      }
      return guardarResultado(smsId, resp);
    }
  }
  return guardarResultado(smsId, resp);
}

Deno.serve(async (req: Request) => {
  // DIAGNÓSTICO (2026-11-12): cada petición que TOCA esta puerta deja
  // una fila en maximo_pings ANTES de cualquier validación — así se
  // distingue «nunca llegó» de «llegó y fue rechazada». Best-effort:
  // si el ping falla, la petición sigue su curso normal.
  let cuerpo: Record<string, unknown> | null = null;
  if (req.method === "POST") {
    try {
      const p = JSON.parse(await req.text());
      if (p && typeof p === "object") cuerpo = p as Record<string, unknown>;
    } catch { /* cuerpo no JSON → ruta null → 400 */ }
  }
  const okToken = tokenOk(req);
  try {
    await insertar("maximo_pings", {
      metodo: req.method,
      token_ok: okToken,
      tipo: typeof cuerpo?.tipo === "string" ? (cuerpo.tipo as string).slice(0, 40) : null,
    });
  } catch { /* el ping jamás bloquea la petición */ }

  if (req.method !== "POST") return json({ ok: false }, 405);
  if (!okToken) return json({ ok: false }, 401);
  // Las rutas del desparqueo aceptan DOS direcciones: la de la casa
  // (tipo en el cuerpo, misma URL de siempre) y la subruta literal
  // (…/maximo-cerebro/red y …/maximo-cerebro/red/resultado).
  const camino = new URL(req.url).pathname;
  let ruta = rutaDe(cuerpo);
  if (camino.endsWith("/red/resultado")) ruta = "red_resultado";
  else if (camino.endsWith("/red")) ruta = "red";
  if (!ruta || !cuerpo) return json({ ok: false }, 400);

  try {
    if (ruta === "config") {
      const c = await leerFilaConfig();
      if (!c) return json({ ok: false }, 500);
      return responderConfig(c);
    }

    if (ruta === "red") {
      const disp = dispositivoDe(cuerpo);
      const cfg = await leerConfigRed();
      const lectura = clasificarRed(cuerpo);
      const sitio = lugarDe(cuerpo);
      const decision = decidirRed(await leerEstadoRed(disp), cfg, lectura, new Date(), hoyHabana());
      if (cfg.enabled) {
        if (Object.keys(decision.cambios).length) await guardarEstadoRed(disp, decision.cambios);
        for (const tipo of decision.eventos) {
          await insertar("maximo_desparqueos", {
            dispositivo: disp, tipo,
            detalle: { tecnologia: lectura.tecnologia, clase: lectura.clase, motivo: decision.motivo, modo: cfg.modo, lat: sitio.lat, lon: sitio.lon, lugar: sitio.lugar },
          });
        }
      }
      const resp: Record<string, unknown> = { accion: decision.accion, modo: cfg.modo, motivo: decision.motivo };
      if (decision.accion === 1 && cfg.modo === "real") resp.orden_real = "desparquear";
      if (decision.accion === 1 && cfg.modo === "prueba") resp.orden_prueba = "avisar";
      return json(resp);
    }

    if (ruta === "red_resultado") {
      const disp = dispositivoDe(cuerpo);
      const sitio = lugarDe(cuerpo);
      const esAviso = cuerpo.aviso_prueba === true || cuerpo.aviso_prueba === "true" || cuerpo.tipo === "aviso_prueba";
      if (esAviso) {
        await insertar("maximo_desparqueos", { dispositivo: disp, tipo: "aviso_prueba", detalle: { tecnologia: typeof cuerpo.tecnologia === "string" ? cuerpo.tecnologia.slice(0, 60) : null, lat: sitio.lat, lon: sitio.lon, lugar: sitio.lugar } });
      } else {
        const despues = typeof cuerpo.despues === "string" ? cuerpo.despues.slice(0, 60) : null;
        const ciclo = cuerpo.ciclo === true || cuerpo.ciclo === "true";
        if (ciclo) await insertar("maximo_desparqueos", { dispositivo: disp, tipo: "desparqueo", detalle: { despues, lat: sitio.lat, lon: sitio.lon, lugar: sitio.lugar } });
        await insertar("maximo_desparqueos", { dispositivo: disp, tipo: "resultado", detalle: { despues, ciclo, lat: sitio.lat, lon: sitio.lon, lugar: sitio.lugar } });
        if (despues) await guardarEstadoRed(disp, { ultima_red: despues });
      }
      return json({ ok: true });
    }

    if (ruta === "latido" || ruta === "previo" || ruta === "resultado") {
      // KILL-SWITCH DEL SERVIDOR (v5): enabled=false → el reporte se
      // descarta SIN guardar y se responde 200 pa que el atajo no
      // vea error. Si la fila no se pudo leer (c null), no se
      // descarta: fail-open documentado en la cabecera.
      const c = await leerFilaConfig();
      if (c && c.enabled !== true) return json({ ok: true, descartado: true });
    }

    if (ruta === "latido") {
      const id = await insertar("maximo_latidos", { datos: datosLatido(cuerpo) });
      return id === null ? json({ ok: false }, 500) : json({ ok: true, id });
    }

    if (ruta === "previo" || ruta === "resultado") {
      const fila = filaResultado(cuerpo, ruta);
      if (!fila) return json({ ok: false }, 400);
      const id = await insertar("maximo_resultados", fila);
      return id === null ? json({ ok: false }, 500) : json({ ok: true, id });
    }

    if (ruta === "sms_precio") {
      // La propuesta de total (regla del redondeo): siempre 200; sin
      // propuesta sana, la respuesta sale SIN la clave y el atajo
      // pide el total a mano.
      const smsId = enteroPositivo(cuerpo.sms_id);
      const ev = smsId ? await leerEvento(smsId) : null;
      const sms = ev ? await leerSms(smsId) : null;
      const forma = claseDeMenu(typeof cuerpo.forma_texto === "string" ? cuerpo.forma_texto : "");
      const prop = ev && sms && forma ? resolverCompra(forma, cuerpo.numero, sms.monto_cup) : null;
      if (!prop || !ev) return json({ ok: true });
      const datos = {
        ...(ev.datos as Record<string, unknown>),
        forma_precio: forma, numero_declarado: aNumero(cuerpo.numero),
        propuesta_cup: prop.total,
      };
      await parche("sms_eventos", "id=eq." + ev.id, {
        datos, actualizado_en: new Date().toISOString(),
      });
      return json({ ok: true, propuesta_texto: String(prop.total) });
    }

    if (ruta === "sms_clase") {
      // El menú de salida: venta clasifica y pregunta los QUSD;
      // devolución/traspaso asientan al momento (a costo).
      const smsId = enteroPositivo(cuerpo.sms_id);
      const ev = smsId ? await leerEvento(smsId) : null;
      const sms = ev ? await leerSms(smsId) : null;
      const clase = claseDeMenu(typeof cuerpo.eleccion_texto === "string" ? cuerpo.eleccion_texto : "");
      if (!ev || !sms || (clase !== "venta" && clase !== "devolucion" && clase !== "traspaso")) {
        return json({ ok: true });
      }
      if (ev.estado === "asentado") return json({ ok: true, ya: true });
      if (clase === "venta") {
        const datos = { ...(ev.datos as Record<string, unknown>), clasificacion: "venta" };
        await parche("sms_eventos", "id=eq." + ev.id, {
          clasificacion: "venta", datos, actualizado_en: new Date().toISOString(),
        });
        return json({ ok: true, qusd_texto: "¿Por cuántos QUSD lo vendiste?" });
      }
      const r = await asentarSalida(ev, sms, clase, null);
      return json(r.ok ? { ok: true } : { ok: false, motivo: r.motivo });
    }

    if (ruta === "sms_respuesta") {
      // El asiento final: compra (total confirmado) o venta (QUSD).
      // Idempotente: un evento ya asentado responde ya:true sin
      // tocar el libro dos veces.
      const smsId = enteroPositivo(cuerpo.sms_id);
      const ev = smsId ? await leerEvento(smsId) : null;
      const sms = ev ? await leerSms(smsId) : null;
      if (!ev || !sms) return json({ ok: false }, 400);
      if (ev.estado === "asentado") return json({ ok: true, ya: true });
      if (ev.clase === "entrada") {
        // «¿De quién es esta recarga?»: si el menú dice un buscador,
        // la respuesta asienta la VUELTA (espera con tasa), no una
        // compra propia — ver responderDuenoBuscador.
        const dueno = duenoDeMenu(typeof cuerpo.dueno_texto === "string" ? cuerpo.dueno_texto : "");
        if (dueno === "BRIKU-EUX" || dueno === "ABRAHAM-X30") {
          return json(await responderDuenoBuscador(ev, sms, dueno, cuerpo));
        }
        const total = enteroPositivo(cuerpo.total);
        if (total === null) return json({ ok: false, motivo: "total_invalido" });
        const r = await asentarCompra(ev, sms, total);
        return json(r.ok ? { ok: true } : { ok: false, motivo: r.motivo });
      }
      const q = qusdValido(cuerpo.qusd);
      if (q === null) return json({ ok: false, motivo: "qusd_invalido" });
      const r = await asentarSalida(ev, sms, "venta", q);
      return json(r.ok ? { ok: true, costo_lote_cup: r.costo } : { ok: false, motivo: r.motivo });
    }

    if (ruta === "espera_crear") {
      // MODO OPERADO: Ernesto crea una espera de vuelta desde el
      // cerebro (la pantalla/atajo que la pida llega tras el token de
      // dispositivo; la regla del capital vive en la puerta SQL).
      const cantidad = aNumero(cuerpo.cantidad);
      const capital = enteroPositivo(cuerpo.capital_cup);
      if (cantidad === null || capital === null) {
        return json({ ok: false, motivo: "datos_invalidos" });
      }
      const r = await llamarRpc("espera_crear_operada", {
        p_buscador: typeof cuerpo.buscador === "string" ? cuerpo.buscador : "",
        p_tipo: typeof cuerpo.tipo_espera === "string" ? cuerpo.tipo_espera : "",
        p_cantidad: cantidad, p_capital: capital,
        p_telefono: typeof cuerpo.telefono === "string" ? cuerpo.telefono : null,
        p_ventana_horas: aNumero(cuerpo.ventana_horas) ?? 48,
        p_prueba: cuerpo.prueba === true,
      });
      return json(r ?? { ok: false, motivo: "sin_respuesta" });
    }

    if (ruta === "sms_lote") {
      // OFFLINE-FIRST: el atajo sincroniza su cola local. Los eventos
      // se procesan en orden por su hora ORIGINAL (no la de llegada)
      // y cada uno trae su client_uuid y sus respuestas recogidas en
      // local. Un lote reenviado entero devuelve los resultados
      // originales, evento a evento, sin duplicar nada.
      const crudos = Array.isArray(cuerpo.eventos) ? cuerpo.eventos.slice(0, 50) : [];
      const ordenados = ordenarLoteEventos(
        crudos.filter((x) => x && typeof x === "object") as Record<string, unknown>[]);
      const resultados: Record<string, unknown>[] = [];
      for (const item of ordenados) {
        try {
          const r = await procesarEventoSms(item);
          resultados.push({
            client_uuid: clientUuidValido(item.client_uuid), ...r,
          });
        } catch {
          resultados.push({
            client_uuid: clientUuidValido(item.client_uuid),
            ok: false, motivo: "error",
          });
        }
      }
      return json({ ok: true, resultados });
    }

    // ruta === "sms": UN evento por la ingesta unificada (ETECSA o
    // PAGO×MOVIL según el remitente; con o sin client_uuid — el atajo
    // v2 instalado sigue funcionando igual que siempre).
    if (typeof cuerpo.cuerpo !== "string" || !cuerpo.cuerpo.trim()) {
      return json({ ok: false }, 400);
    }
    const respSms = await procesarEventoSms(cuerpo);
    if (respSms.ok === false && respSms.motivo === "insercion_fallo") {
      return json({ ok: false }, 500);
    }
    return json(respSms);
  } catch {
    return json({ ok: false }, 500);
  }
});

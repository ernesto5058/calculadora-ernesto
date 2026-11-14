// =====================================================================
// Edge Function «avisos» — EMISOR de notificaciones (Supabase / Deno)
// ---------------------------------------------------------------------
// Recibe un evento y despacha en abanico:
//   1) Web Push propio (VAPID, RFC 8030/8291/8292) a las suscripciones
//      guardadas en public.push_subs del destinatario.
//   2) Telegram del DUEÑO (solo si el destino es 'ADMIN' y hay
//      telegram_chat_id en public.avisos_config).
//   3) FCM nativo (v1.4.5): a los tokens de la app instalada en
//      Android guardados en push_subs con suscripcion.tipo = 'fcm'
//      (puerta registrar_push_nativo). Exige el proyecto Firebase
//      de la app y el secreto FCM_SERVICE_ACCOUNT_JSON; sin ese
//      secreto, el canal reporta «pendiente» con honestidad y los
//      demás canales siguen. NO desplegar esta versión sin fijar
//      antes el secreto (la rama es inocua sin él, pero el canal
//      nativo solo nace con la credencial puesta).
// Los textos salen de las PLANTILLAS PRO compartidas
// (_shared/telegram-pro.ts): título con un emoji con sentido, datos
// con «Etiqueta: valor», montos con miles por espacio y moneda. En
// Telegram van en HTML simple (negrita solo en etiquetas); en Web
// Push, su versión en texto plano. Si Telegram responde 403 (el
// dueño bloqueó el bot), se registra «telegram_vinculo_roto» en la
// tabla actividad y el resultado lo refleja: su otra vía (el Web
// Push de este mismo abanico) ya le llevó el aviso.
//
// SECRETOS (Supabase → Edge Functions → Secrets; NUNCA en el repo):
//   VAPID_PUBLIC_KEY    clave pública (la misma que va en el cliente)
//   VAPID_PRIVATE_KEY   clave privada JWK o cruda base64url — SECRETO
//   VAPID_SUBJECT       mailto: del negocio
//   TELEGRAM_BOT_TOKEN  token del bot — SECRETO
//   FCM_SERVICE_ACCOUNT_JSON  JSON de la cuenta de servicio de
//      Firebase (para el canal nativo Android) — SECRETO
//   AVISOS_WEBHOOK_SECRET  secreto compartido con quien invoque (header)
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta la plataforma.
//
// Evento (POST JSON):
//   { "para": "CODIGO|ADMIN", "titulo": "...", "cuerpo": "...",
//     "url": "./", "tab": "Bandeja", "secreto": "<AVISOS_WEBHOOK_SECRET>" }
//   { "dry_run": true, ... } -> valida todo y NO envía nada (prueba).
//   El webhook del bot vive en la función telegram-webhook.
//      chat_id del dueño cuando le escribe /start con su código.
//
// Estado: el cifrado Web Push (aes128gcm + ECDH P-256 + HKDF) y la
// firma VAPID (ES256) se implementan con WebCrypto del propio Deno,
// sin librerías externas. La función NO se despliega desde este repo:
// se despliega en la activación con el CLI de Supabase (ver informe).
//
// AVISOS PRO (2026-11-13): NADA falla en silencio. TODO intento de
// envío queda escrito en public.avisos_log (canal, destino, resultado
// entregado/fallo/podada, estado HTTP, motivo, si el canal entregó
// como RESPALDO porque el push falló, y si fue prueba). Cada intento
// push mueve push_subs.ultimo_uso de su suscripción. Las
// suscripciones muertas se PODAN solas (404/410, o 400 con
// VapidPkHashMismatch: nació con otra clave VAPID — la causa raíz de
// «toqué Activar avisos y no me llega nada»: la sub vieja del dueño
// era pre-rotación y Apple la rechazaba en silencio, sin registro).
// DOBLE RIEL: el abanico sale por push Y por el Telegram del dueño
// (ADMIN); el log marca qué canal entregó y si Telegram cargó el
// aviso como respaldo. Si NINGÚN canal entrega, el evento queda
// registrado como «sin_entrega» en avisos_log y en actividad.
// =====================================================================

import {
  esc,
  plAprobado,
  plCierre,
  plMensaje,
  plPagado,
  plRechazado,
  plReporteNuevo,
  plTarifa,
  type Plantilla,
} from "../_shared/telegram-pro.ts";
import { clasificarPush, decidirAcceso } from "./logica.js";

function b64urlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function bytesToB64url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  const infoFull = new Uint8Array(info.length + 1);
  infoFull.set(info); infoFull[info.length] = 1;
  return (await hmac(prk, infoFull)).slice(0, len);
}
function concat(...partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of partes) { out.set(p, off); off += p.length; }
  return out;
}

/* --- VAPID: JWT ES256 firmado con la clave privada del servidor --- */
async function vapidJwt(audience: string, subject: string, pubB64: string, privB64: string): Promise<string> {
  const header = bytesToB64url(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const payload = bytesToB64url(new TextEncoder().encode(JSON.stringify({ aud: audience, exp, sub: subject })));
  const firmar = new TextEncoder().encode(header + "." + payload);
  const pubBytes = b64urlToBytes(pubB64);
  const jwk: JsonWebKey = {
    kty: "EC", crv: "P-256",
    x: bytesToB64url(pubBytes.slice(1, 33)),
    y: bytesToB64url(pubBytes.slice(33, 65)),
    d: privB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  };
  const clave = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, clave, firmar));
  return header + "." + payload + "." + bytesToB64url(firma);
}

/* --- Cifrado del payload: RFC 8291 (aes128gcm) --- */
async function cifrarPayload(sub: { keys: { p256dh: string; auth: string } }, payload: string, pubServidorB64: string, privServidor: CryptoKey, salt: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.keys.p256dh);
  const authSecret = b64urlToBytes(sub.keys.auth);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secreto = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, privServidor, 256));
  const keyInfo = concat(new TextEncoder().encode("WebPush: info\0"), uaPublic, b64urlToBytes(pubServidorB64));
  const ikm = await hkdf(authSecret, secreto, keyInfo, 32);
  const cek = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);
  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const claro = concat(new TextEncoder().encode(payload), new Uint8Array([2])); // delimitador final
  const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, claro));
  const cabecera = new Uint8Array(16 + 4 + 1 + 65);
  cabecera.set(salt, 0);
  new DataView(cabecera.buffer).setUint32(16, 4096);
  cabecera[20] = 65;
  cabecera.set(b64urlToBytes(pubServidorB64), 21);
  return concat(cabecera, cifrado);
}

async function enviarPush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, evento: Record<string, string>, env: (k: string) => string | undefined): Promise<{ ok: boolean; estado?: number; error?: string; detalle?: string }> {
  const pub = env("VAPID_PUBLIC_KEY") || "";
  const priv = env("VAPID_PRIVATE_KEY") || "";
  const subject = env("VAPID_SUBJECT") || "mailto:avisos@example.com";
  if (!pub || !priv) return { ok: false, error: "faltan los secretos VAPID" };
  const audiencia = new URL(sub.endpoint).origin;
  const jwt = await vapidJwt(audiencia, subject, pub, priv);
  const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pubEfimeraDer = new Uint8Array(await crypto.subtle.exportKey("spki", par.publicKey));
  const pubEfimera = bytesToB64url(pubEfimeraDer.slice(pubEfimeraDer.length - 65));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cuerpo = await cifrarPayload(sub, JSON.stringify(evento), pubEfimera, par.privateKey, salt);
  const resp = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Authorization": "vapid t=" + jwt + ", k=" + pub,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "86400",
    },
    body: cuerpo,
  });
  /* Avisos PRO: en un fallo se lee el cuerpo de la respuesta — ahí
     viaja el motivo machine-readable del servidor de push (p. ej.
     {"reason":"VapidPkHashMismatch"}) y sin él el registro de
     entregas no puede clasificar ni podar con causa. */
  let detalle = "";
  if (!resp.ok && resp.status !== 201) {
    detalle = (await resp.text().catch(() => "")).slice(0, 240);
  }
  return { ok: resp.ok || resp.status === 201, estado: resp.status, detalle: detalle || undefined };
}

/* Ritmo de Telegram: ~1 mensaje/segundo por chat y ~30/segundo en
   total. Si Telegram responde 429, se respeta su retry_after tal
   cual y se reintenta UNA vez. Formato HTML simple (parse_mode:
   "HTML", textos del módulo telegram-pro): nada de MarkdownV2.
   Un 403 significa vínculo roto (bloqueó el bot): se devuelve
   bloqueado=true para que el flujo lo registre en actividad. */
const ultimoPorChat = new Map<string, number>();
let ultimoGlobal = 0;
async function ritmoTelegram(chatId: string): Promise<void> {
  const ahora = Date.now();
  const faltaChat = 1100 - (ahora - (ultimoPorChat.get(chatId) ?? 0));
  const faltaGlobal = 40 - (ahora - ultimoGlobal);
  const espera = Math.max(0, faltaChat, faltaGlobal);
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  const t = Date.now();
  ultimoPorChat.set(chatId, t);
  ultimoGlobal = t;
}

/* ===== FCM NATIVO (app instalada en Android) =====
   HTTP v1: la cuenta de servicio de Firebase firma un JWT (RS256
   con WebCrypto), se canjea por un access token de Google y se
   envía a fcm.googleapis.com. Sin el secreto
   FCM_SERVICE_ACCOUNT_JSON no hay credencial posible: se devuelve
   pendiente=true y el abanico sigue por los demás canales. */
let fcmTokenCache: { token: string; hasta: number } | null = null;
async function fcmAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  if (fcmTokenCache && fcmTokenCache.hasta > Date.now() + 60000) return fcmTokenCache.token;
  const ahora = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
  const sinFirmar = enc({ alg: "RS256", typ: "JWT" }) + "." + enc({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: ahora, exp: ahora + 3600,
  });
  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const clave = await crypto.subtle.importKey("pkcs8", b64urlToBytes(pem).buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", clave, new TextEncoder().encode(sinFirmar));
  const jwt = sinFirmar + "." + bytesToB64url(new Uint8Array(firma));
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" + encodeURIComponent(jwt),
  });
  const j = await resp.json().catch(() => ({})) as { access_token?: string };
  if (!resp.ok || !j.access_token) throw new Error("oauth fcm: " + resp.status);
  fcmTokenCache = { token: j.access_token, hasta: Date.now() + 3500000 };
  return j.access_token;
}
async function enviarFCM(token: string, evento: Record<string, string>, env: (k: string) => string | undefined): Promise<{ ok: boolean; estado?: number; error?: string; pendiente?: boolean }> {
  const crudo = env("FCM_SERVICE_ACCOUNT_JSON");
  if (!crudo) return { ok: false, pendiente: true, error: "canal nativo pendiente: falta el proyecto Firebase (secreto FCM_SERVICE_ACCOUNT_JSON sin fijar)" };
  let sa: { project_id: string; client_email: string; private_key: string };
  try { sa = JSON.parse(crudo); } catch { return { ok: false, error: "FCM_SERVICE_ACCOUNT_JSON no es JSON válido" }; }
  const access = await fcmAccessToken(sa);
  const resp = await fetch("https://fcm.googleapis.com/v1/projects/" + sa.project_id + "/messages:send", {
    method: "POST",
    headers: { "Authorization": "Bearer " + access, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: evento.titulo, body: evento.cuerpo },
        android: { priority: "HIGH" },
        data: { tipo: evento.tipo || "", tab: evento.tab || "", ancla: evento.ancla || "" },
      },
    }),
  });
  if (!resp.ok) return { ok: false, estado: resp.status, error: "fcm: " + (await resp.text().catch(() => "")).slice(0, 200) };
  return { ok: true, estado: resp.status };
}

async function enviarTelegram(
  chatId: string,
  html: string,
  env: (k: string) => string | undefined,
  botones?: { inline_keyboard: { text: string; callback_data: string }[][] },
): Promise<{ ok: boolean; error?: string; estado?: number; bloqueado?: boolean }> {
  const token = env("TELEGRAM_BOT_TOKEN") || "";
  if (!token) return { ok: false, error: "falta el secreto TELEGRAM_BOT_TOKEN" };
  await ritmoTelegram(chatId);
  const cuerpo: Record<string, unknown> = { chat_id: chatId, text: html, parse_mode: "HTML" };
  if (botones) cuerpo.reply_markup = botones;
  const resp = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  if (resp.status === 429) {
    let retryAfter = 1;
    try {
      const j = await resp.json() as { parameters?: { retry_after?: number } };
      retryAfter = j.parameters?.retry_after ?? 1;
    } catch { /* se usa 1 s */ }
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    const resp2 = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    return { ok: resp2.ok, estado: resp2.status, bloqueado: resp2.status === 403, error: resp2.ok ? undefined : "Telegram respondió " + resp2.status + " tras esperar retry_after" };
  }
  return { ok: resp.ok, estado: resp.status, bloqueado: resp.status === 403, error: resp.ok ? undefined : "Telegram respondió " + resp.status };
}

/* Registra en la tabla actividad por la puerta (llave de servicio). */
async function registrarActividad(
  env: (k: string) => string | undefined,
  quien: string, accion: string, detalle: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch((env("SUPABASE_URL") || "") + "/rest/v1/rpc/registrar_actividad", {
      method: "POST",
      headers: {
        "apikey": env("SUPABASE_SERVICE_ROLE_KEY") || "",
        "Authorization": "Bearer " + (env("SUPABASE_SERVICE_ROLE_KEY") || ""),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_quien: quien, p_accion: accion, p_detalle: detalle }),
    });
  } catch { /* la auditoría nunca rompe el envío */ }
}

/* Lee filas de PostgREST con la llave de servicio (solo servidor). */
async function leerTabla(env: (k: string) => string | undefined, tabla: string, query: string): Promise<unknown[]> {
  const url = (env("SUPABASE_URL") || "") + "/rest/v1/" + tabla + "?" + query;
  const resp = await fetch(url, {
    headers: {
      "apikey": env("SUPABASE_SERVICE_ROLE_KEY") || "",
      "Authorization": "Bearer " + (env("SUPABASE_SERVICE_ROLE_KEY") || ""),
    },
  });
  if (!resp.ok) return [];
  return await resp.json();
}

/* ===== AVISOS PRO: registro de entregas (avisos_log) =====
   Cada intento de envío deja su fila: nada falla en silencio. La
   escritura del registro NUNCA rompe el envío (misma filosofía que
   registrarActividad): si el registro cae, el aviso igual sale. */
function cabecerasSrv(env: (k: string) => string | undefined): Record<string, string> {
  return {
    "apikey": env("SUPABASE_SERVICE_ROLE_KEY") || "",
    "Authorization": "Bearer " + (env("SUPABASE_SERVICE_ROLE_KEY") || ""),
    "Content-Type": "application/json",
  };
}
async function escribirLogAviso(env: (k: string) => string | undefined, fila: Record<string, unknown>): Promise<void> {
  try {
    await fetch((env("SUPABASE_URL") || "") + "/rest/v1/avisos_log", {
      method: "POST",
      headers: { ...cabecerasSrv(env), "Prefer": "return=minimal" },
      body: JSON.stringify(fila),
    });
  } catch { /* el registro nunca rompe el envío */ }
}
async function tocarUltimoUso(env: (k: string) => string | undefined, subId: number): Promise<void> {
  try {
    await fetch((env("SUPABASE_URL") || "") + "/rest/v1/push_subs?id=eq." + subId, {
      method: "PATCH",
      headers: { ...cabecerasSrv(env), "Prefer": "return=minimal" },
      body: JSON.stringify({ ultimo_uso: new Date().toISOString() }),
    });
  } catch { /* idem */ }
}
async function podarSub(env: (k: string) => string | undefined, subId: number): Promise<void> {
  try {
    await fetch((env("SUPABASE_URL") || "") + "/rest/v1/push_subs?id=eq." + subId, {
      method: "DELETE",
      headers: { ...cabecerasSrv(env), "Prefer": "return=minimal" },
    });
  } catch { /* idem */ }
}

export async function manejar(req: Request, env: (k: string) => string | undefined = (k) => Deno.env.get(k)): Promise<Response> {
  if (req.method !== "POST") return new Response("solo POST", { status: 405 });
  let ev: Record<string, unknown>;
  try { ev = await req.json(); } catch { return new Response("JSON no valido", { status: 400 }); }

  /* El receptor de Telegram (webhook /start, /vincular, botones)
     vive en la función SEPARADA telegram-webhook. Esta emisora solo
     envía: Web Push + Telegram. */

  /* Puerta FAIL-CLOSED (Tanda 1 Ola 2; decisión pura en logica.js,
     banco prueba-avisos-puerta): sin AVISOS_WEBHOOK_SECRET fijado en
     el entorno la emisora responde 503 y no envía nada — antes, con
     el secreto sin fijar, cualquiera podía inyectar avisos falsos. */
  const acceso = decidirAcceso(env("AVISOS_WEBHOOK_SECRET"), ev.secreto);
  if (!acceso.permitido) {
    return acceso.status === 503
      ? new Response("emisora sin secreto configurado", { status: 503 })
      : new Response("no autorizado", { status: 401 });
  }

  const para = String(ev.para || "");
  /* Plantillas PRO compartidas (_shared/telegram-pro.ts): si el
     evento no trae titulo/cuerpo, se componen desde el tipo con los
     datos clave formateados (miles con espacio, moneda visible,
     hora de pared). Nada de JSON crudo al usuario. Un titulo/cuerpo
     explícito del llamador sigue mandando (compatibilidad). */
  const tipoEv = String(ev.tipo || "");
  const nombreEv = String(ev.nombre || "");
  let pl: Plantilla | null = null;
  if (tipoEv === "reporte") pl = plReporteNuevo({ nombre: nombreEv || undefined, tipo: String(ev.tipo_reporte || "") || undefined, cantidad: ev.cantidad, precio: ev.precio, porc: ev.porc, nota: String(ev.nota || "") || undefined });
  else if (tipoEv === "aprobado") pl = plAprobado({ comision: ev.comision });
  else if (tipoEv === "rechazado") pl = plRechazado({ motivo: String(ev.motivo || "") || undefined });
  else if (tipoEv === "pagado") pl = plPagado({ comision: ev.comision });
  else if (tipoEv === "tarifa") pl = plTarifa({ ingreso: ev.ingreso, libro: ev.libro });
  else if (tipoEv === "mensaje") pl = plMensaje({ nombre: nombreEv || undefined });
  else if (tipoEv === "cierre") pl = plCierre({ total: ev.total });
  const tituloEv = String(ev.titulo || (pl ? pl.titulo : "🔔 Aviso"));
  const cuerpoEv = String(ev.cuerpo || (pl ? pl.cuerpo : "Tienes novedades en tu panel"));
  const htmlEv = String(ev.titulo || ev.cuerpo)
    ? "<b>" + esc(tituloEv) + "</b>\n" + esc(cuerpoEv)
    : (pl ? pl.html : "<b>" + esc(tituloEv) + "</b>\n" + esc(cuerpoEv));
  const evento = {
    tipo: tipoEv,
    titulo: tituloEv,
    cuerpo: cuerpoEv,
    html: htmlEv,
    nombre: nombreEv,
    comision: ev.comision ?? null,
    ingreso: ev.ingreso ?? null,
    url: String(ev.url || "./"),
    tab: String(ev.tab || ""),
    ancla: String(ev.ancla || ""),
    reporte_id: ev.reporte_id ?? null,
    tag: String(ev.tag || "aviso"),
  };
  if (!para) return new Response("falta «para»", { status: 400 });

  /* Avisos PRO: las suscripciones se leen CON su id — el registro de
     entregas y el ultimo_uso se escriben por suscripción, y las
     muertas se podan por id. */
  type FilaSub = {
    id: number; plataforma?: string; creado_en?: string;
    suscripcion: { endpoint?: string; keys?: { p256dh: string; auth: string }; tipo?: string; token?: string };
  };
  const filas = await leerTabla(env, "push_subs", "codigo=eq." + encodeURIComponent(para) + "&select=id,suscripcion,plataforma,creado_en") as FilaSub[];
  /* v1.4.5: las suscripciones se parten por canal — Web Push (las
     de siempre: endpoint + keys) y FCM nativo (tipo 'fcm' + token,
     de la app instalada). Una fila nativa JAMÁS entra al envío web. */
  const filasWeb = filas.filter((f) => !!f.suscripcion?.endpoint && !!f.suscripcion?.keys);
  const filasFcm = filas.filter((f) => f.suscripcion?.tipo === "fcm" && !!f.suscripcion?.token);

  let chatTelegram: string | null = null;
  if (para === "ADMIN") {
    const cfg = await leerTabla(env, "avisos_config", "codigo=eq.ADMIN&select=telegram_chat_id");
    chatTelegram = (cfg[0] as { telegram_chat_id?: string } | undefined)?.telegram_chat_id || null;
  }

  if (ev.dry_run === true) {
    return new Response(JSON.stringify({
      ok: true, dry_run: true, para,
      suscripciones: filas.length,
      fcm: filasFcm.length,
      firebase_configurado: !!env("FCM_SERVICE_ACCOUNT_JSON"),
      telegram: !!chatTelegram,
      vapid_configurado: !!(env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY")),
      subs_detalle: filas.map((f) => ({
        id: f.id, plataforma: f.plataforma || null, creado_en: f.creado_en || null,
        canal: f.suscripcion?.tipo === "fcm" ? "fcm" : "webpush",
      })),
    }), { headers: { "Content-Type": "application/json" } });
  }

  /* ===== AVISOS PRO: abanico con registro completo =====
     Cada intento: ultimo_uso al día, fila en avisos_log con su
     clasificación, y poda de la suscripción muerta. */
  const claveEv = typeof ev.clave === "string" && ev.clave ? ev.clave : null;
  const esPrueba = ev.prueba === true || tipoEv === "prueba";
  const baseLog = {
    clave: claveEv, evento_tipo: tipoEv || "libre", para,
    titulo: tituloEv, es_prueba: esPrueba,
  };
  let pushIntentado = false;
  let pushEntrego = false;
  let telegramEntrego = false;
  const resultados: Record<string, unknown>[] = [];
  for (const f of filasWeb) {
    pushIntentado = true;
    const sub = f.suscripcion as { endpoint: string; keys: { p256dh: string; auth: string } };
    let r: { ok: boolean; estado?: number; error?: string; detalle?: string };
    try { r = await enviarPush(sub, evento, env); }
    catch (e) { r = { ok: false, error: String(e) }; }
    await tocarUltimoUso(env, f.id);
    const clase = r.estado != null
      ? clasificarPush(r.estado, r.detalle || r.error || "")
      : { resultado: "fallo", podar: false, motivo: r.error || "el envío reventó antes de llegar al servidor de push" };
    if (clase.resultado === "entregado") pushEntrego = true;
    let host = "webpush";
    try { host = new URL(sub.endpoint).host; } catch { /* endpoint raro: queda el genérico */ }
    await escribirLogAviso(env, {
      ...baseLog, canal: "webpush", sub_id: f.id, destino: host,
      resultado: clase.resultado, http_estado: r.estado ?? null,
      motivo: clase.motivo || r.error || null,
    });
    if (clase.podar) await podarSub(env, f.id);
    resultados.push({ canal: "webpush", sub_id: f.id, ...r, resultado: clase.resultado });
  }
  for (const f of filasFcm) {
    pushIntentado = true;
    let r: { ok: boolean; estado?: number; error?: string; pendiente?: boolean };
    try { r = await enviarFCM(f.suscripcion.token || "", evento, env); }
    catch (e) { r = { ok: false, error: String(e) }; }
    await tocarUltimoUso(env, f.id);
    const resultadoFcm = r.ok ? "entregado" : (r.pendiente ? "pendiente" : "fallo");
    if (r.ok) pushEntrego = true;
    await escribirLogAviso(env, {
      ...baseLog, canal: "fcm", sub_id: f.id, destino: "fcm",
      resultado: resultadoFcm, http_estado: r.estado ?? null, motivo: r.error || null,
    });
    if (r.estado === 404) await podarSub(env, f.id);
    resultados.push({ canal: "fcm", sub_id: f.id, ...r, resultado: resultadoFcm });
  }
  if (chatTelegram) {
    try {
      /* Botones según el evento: decidir reportes (v1) o el botón
         blindado del Analista (Nivel 1, 2026-11-11): «Publicar $40 a
         319,00» ejecuta SOLO la acción pendiente con ese id (la tasa
         y el monto viven en el servidor; la puerta mercado-actuar
         re-verifica TODAS las barandas al toque). La segunda fila es
         el control global DETENER/Reanudar de las acciones. */
      let botonesTg: { inline_keyboard: { text: string; callback_data: string }[][] } | undefined;
      if (evento.tipo === "reporte" && ev.reporte_id != null) {
        botonesTg = { inline_keyboard: [[
          { text: "✅ Aprobar", callback_data: "d:" + String(ev.reporte_id) + ":a" },
          { text: "❌ Rechazar", callback_data: "d:" + String(ev.reporte_id) + ":r" },
        ]] };
      } else if (ev.cita_id != null) {
        botonesTg = { inline_keyboard: [[
          { text: "✅ Confirmar cita", callback_data: "c:" + String(ev.cita_id) + ":a" },
          { text: "❌ No puedo", callback_data: "c:" + String(ev.cita_id) + ":r" },
        ]] };
      } else if (ev.accion_id != null || ev.mostrar_control_acciones === true) {
        const filas: { text: string; callback_data: string }[][] = [];
        if (ev.accion_id != null) {
          filas.push([{
            text: String(ev.boton_texto || "Publicar oferta"),
            callback_data: "a:" + String(ev.accion_id),
          }]);
        }
        filas.push([ev.acciones_detenidas === true
          ? { text: "▶️ Reanudar acciones", callback_data: "x:reanudar" }
          : { text: "⛔ Detener acciones", callback_data: "x:detener" }]);
        botonesTg = { inline_keyboard: filas };
      }
      const rTg = await enviarTelegram(chatTelegram, evento.html, env, botonesTg);
      /* DOBLE RIEL: si el push se intentó y no entregó en ninguna
         suscripción, este Telegram cargó el aviso como RESPALDO —
         y el registro lo dice. */
      const tgRespaldo = rTg.ok && pushIntentado && !pushEntrego;
      if (rTg.ok) telegramEntrego = true;
      await escribirLogAviso(env, {
        ...baseLog, canal: "telegram", destino: "telegram",
        resultado: rTg.ok ? "entregado" : "fallo",
        http_estado: rTg.estado ?? null,
        motivo: rTg.error || (rTg.bloqueado ? "Telegram 403: el dueño bloqueó el bot (vínculo roto)" : null),
        es_respaldo: tgRespaldo,
      });
      resultados.push({ canal: "telegram", ...rTg, es_respaldo: tgRespaldo });
      if (rTg.bloqueado) {
        /* 403: bloqueó el bot -> vínculo roto. Queda registrado en
           actividad; su otra vía (el Web Push de este mismo abanico,
           para 'ADMIN') ya le llevó el aviso de este evento. */
        await registrarActividad(env, para, "telegram_vinculo_roto", { canal: "telegram" });
      }
    }
    catch (e) {
      await escribirLogAviso(env, {
        ...baseLog, canal: "telegram", destino: "telegram",
        resultado: "fallo", motivo: String(e),
      });
      resultados.push({ canal: "telegram", ok: false, error: String(e) });
    }
  }
  /* Si NINGÚN canal entregó, el fracaso queda en voz alta: fila
     «sin_entrega» en el registro y apunte en actividad. Antes, un
     aviso podía morir sin dejar ni una línea en ninguna parte. */
  const entregoAlguno = pushEntrego || telegramEntrego;
  if (!entregoAlguno) {
    await escribirLogAviso(env, {
      ...baseLog, canal: "despacho", resultado: "sin_entrega",
      motivo: "ningún canal entregó el aviso (push intentado: " + pushIntentado +
        "; telegram: " + (chatTelegram ? "intentado" : "sin vínculo") + ")",
    });
    await registrarActividad(env, para, "aviso_sin_entrega", { tipo: tipoEv, titulo: tituloEv });
  }
  return new Response(JSON.stringify({
    ok: true, para, resultados, entregado: entregoAlguno,
    canales_ok: resultados.filter((r) => r.ok === true).map((r) => r.canal),
  }), { headers: { "Content-Type": "application/json" } });
}

/* Punto de entrada de Supabase Edge Functions. */
if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve((req: Request) => manejar(req));
}

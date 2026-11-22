// =====================================================================
// logica.js — decisiones puras de la emisora «avisos» (sin red ni
// entorno: todo entra por parámetros). La comparten la Edge Function
// (Deno, la importa tal cual) y el banco de pruebas (Node), para que
// lo probado sea exactamente lo desplegado. Patrón de la casa
// (puerta.js del Agente / logica.js de sms-captura).
// =====================================================================

/* Puerta de acceso de la emisora — FAIL-CLOSED (Tanda 1 Ola 2):
   - Sin secreto configurado en el entorno, la emisora NO envía nada:
     503. Antes el patrón era `if (secreto && …)`: con el secreto sin
     fijar, cualquiera en internet podía inyectar avisos falsos
     (aprobado/pagado/tarifa) a dueño y buscadores.
   - Con secreto fijado: el evento debe traerlo exacto; si no, 401.
   Devuelve { permitido: true } o { permitido: false, status }. */
export function decidirAcceso(secretoConfigurado, secretoEvento) {
  const cfg = typeof secretoConfigurado === "string" ? secretoConfigurado : "";
  if (!cfg) return { permitido: false, status: 503 };
  if (secretoEvento !== cfg) return { permitido: false, status: 401 };
  return { permitido: true };
}

/* Clasificación de la respuesta del servidor de push a UN intento de
   envío Web Push (Avisos PRO, 2026-11-13). Entran el estado HTTP y el
   cuerpo de la respuesta (el motivo viaja ahí). Devuelve
   { resultado, podar, motivo }:
   - "entregado": el servidor aceptó el envío (2xx); motivo null.
   - "podada": la suscripción está muerta y se borra de la base —
     404/410 (ya no existe en el servidor de push) y 400 con
     VapidPkHashMismatch (nació bajo otra clave VAPID: jamás va a
     entregar con la clave actual; es la causa raíz de la suscripción
     id 1 del dueño, invisible hasta que existió este registro).
   - "fallo": todo lo demás (400 ajeno, 403, 5xx, sin estado porque el
     envío reventó antes de llegar). NO poda: la suscripción se queda
     y el fallo queda escrito en avisos_log con su estado y detalle. */
export function clasificarPush(estado, detalle) {
  const cuerpo = typeof detalle === "string" ? detalle : "";
  const http = typeof estado === "number" && Number.isFinite(estado) ? estado : null;
  if (http !== null && http >= 200 && http < 300) {
    return { resultado: "entregado", podar: false, motivo: null };
  }
  if (http === 404 || http === 410) {
    return {
      resultado: "podada", podar: true,
      motivo: `la suscripción ya no existe en el servidor de push (HTTP ${http})`,
    };
  }
  if (http === 400 && cuerpo.includes("VapidPkHashMismatch")) {
    return {
      resultado: "podada", podar: true,
      motivo: "la suscripción nació con otra clave VAPID (VapidPkHashMismatch): no entregará nunca con la clave actual",
    };
  }
  if (http === null) {
    return {
      resultado: "fallo", podar: false,
      motivo: "el envío reventó antes de llegar al servidor de push",
    };
  }
  return {
    resultado: "fallo", podar: false,
    motivo: `el servidor de push respondió HTTP ${http}${cuerpo ? `: ${cuerpo.slice(0, 200)}` : ""}`,
  };
}

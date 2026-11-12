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

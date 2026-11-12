// =====================================================================
// agente-provider.mjs — provider JS de promptfoo que ejercita la
// lógica REAL del Agente de clientes SIN tocar producción:
//   · importa logica.js viva (vía logica-ref.mjs, sin copias),
//   · la alimenta con los datos SEMILLA espejo del banco eterno
//     (seed.mjs — el mismo patrón de prueba-agente-v1.mjs),
//   · y compone la decisión IGUAL que la puerta (index.ts): primero
//     orquestar(); el seguimiento del pin y el veto/promesa del
//     cerebro se reproducen con las piezas puras de la propia lógica.
// NADA de red, NADA de Supabase, NADA de Telegram: producción intacta.
//
// CONTRATO con el dataset (tests/casos.yaml), por vars:
//   input      frase del cliente (también llega como prompt)
//   canal      "telegram" | "web"            (def: telegram)
//   esDueno    "true" si el chat es el del dueño registrado
//   escenario  "citas" carga las filas ficticias de citas del banco
//   hoy        fecha ISO del «hoy»           (def: 2026-11-11, el del banco)
//   modo       orquestar | secuencia | seguimiento | validador | cerebro
//   secuencia  JSON: ["msg1","msg2",…] — hila el flujo entre pasos
//   historial  JSON: [{rol,texto},…] SIN el mensaje actual (seguimiento)
//   borrador   texto del «cerebro» simulado (modos validador/cerebro)
//
// SALIDA: un JSON (string) con la decisión estructurada — accion,
// respuesta, faq_id, pin, cita, citaDecision, citaCierre, panel,
// validacion — pa que las aserciones sean DETERMINISTAS sobre la
// ACCIÓN, no solo sobre el texto libre.
// =====================================================================
import L from "./logica-ref.mjs";
import { construirDatos, HOY } from "./seed.mjs";

const bool = (v) => v === true || v === "true";
function parseJSON(v, fallback) {
  if (v == null || v === "") return fallback;
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

/* La decisión cruda -> forma estable y asertable. */
function slim(dec, extra = {}) {
  if (!dec) return { accion: null, ...extra };
  const panelTexto = dec.panel?.texto ??
    (dec.panel?.vista ? (L.panelVista(dec.panel.vista, extra.__datos ?? {}, {})?.texto ?? null) : null);
  const panelCallbacks = [];
  const teclado = dec.panel?.teclado ?? (dec.panel?.vista ? L.panelVista(dec.panel.vista, extra.__datos ?? {}, {})?.teclado : null);
  for (const fila of teclado?.inline_keyboard ?? []) {
    for (const b of fila) if (b?.callback_data) panelCallbacks.push(b.callback_data);
  }
  return {
    accion: dec.accion ?? null,
    respuesta: dec.respuesta ?? null,
    faq_id: dec.faq_id ?? null,
    escalar: dec.escalar ?? null,
    motivo: dec.motivo ?? null,
    registrar_sin_respuesta: dec.registrar_sin_respuesta ?? null,
    pin: dec.pin ?? null,
    cita: dec.cita ? { nombre: dec.cita.nombre ?? null, servicio: dec.cita.servicio ?? null, dia: dec.cita.dia ?? null, hora: dec.cita.hora ?? null } : null,
    citaDecision: dec.citaDecision ?? null,
    citaCierre: dec.citaCierre ?? null,
    flujo: dec.flujo ? { tipo: dec.flujo.tipo ?? null, paso: dec.flujo.paso ?? null, datos: dec.flujo.datos ?? null } : null,
    panel_vista: dec.panel?.vista ?? null,
    panel_texto: panelTexto,
    panel_callbacks: panelCallbacks,
    opciones: (dec.opciones ?? []).map((o) => o.faq_id ?? o.etiqueta ?? o),
    auditoria: dec.auditoria ?? null,
    ...extra.__out,
  };
}

export default class AgenteProvider {
  id() { return "agente-logica-local"; }
  // OJO: nada de método label() aquí — promptfoo 0.125 lee `label`
  // como PROPIEDAD string (su telemetría hace label.toLowerCase())
  // y un método con ese nombre tumba el eval al finalizar. La
  // etiqueta visible se pone en promptfooconfig.yaml.

  async callApi(prompt, context) {
    const vars = context?.vars ?? {};
    const input = String(vars.input ?? prompt ?? "");
    const canal = String(vars.canal ?? "telegram");
    const hoy = String(vars.hoy ?? HOY);
    const modo = String(vars.modo ?? "orquestar");
    const datos = construirDatos({ esDueno: bool(vars.esDueno), escenario: vars.escenario });
    const convBase = { escalada: false, flujo: {}, canal };
    const out = (dec, extraOut = {}) =>
      ({ output: JSON.stringify(slim(dec, { __datos: datos, __out: extraOut })) });

    // ── validador: el borrador del cerebro contra la proyección
    //    pública (espejo de los casos PROM/CAP/CEREBRO del banco).
    if (modo === "validador") {
      const proy = L.proyeccionPublica(datos);
      const val = L.validarRespuestaCerebro(String(vars.borrador ?? input), proy.valores, datos.prohibidas);
      return { output: JSON.stringify({ modo, validacion: val, borrador: String(vars.borrador ?? input) }) };
    }

    // ── secuencia: conversación completa hilando el flujo, como
    //    hace la puerta guardando conv.flujo entre mensajes.
    if (modo === "secuencia") {
      const mensajes = parseJSON(vars.secuencia, [input]);
      let conv = { ...convBase };
      const pasos = [];
      let dec = null;
      for (const m of mensajes) {
        dec = L.orquestar(datos, conv, String(m), hoy);
        pasos.push({ entrada: String(m), accion: dec.accion ?? null, respuesta: dec.respuesta ?? null });
        conv = { ...conv, flujo: dec.flujo ?? {} };
      }
      return out(dec, { pasos });
    }

    // ── seguimiento: reproducción FIEL del tramo de index.ts —
    //    afirmación corta + pin pendiente en el historial ejecuta
    //    el pin ANTES de que nada caiga al cerebro.
    if (modo === "seguimiento") {
      let dec = L.orquestar(datos, { ...convBase }, input, hoy);
      let via = "orquestar";
      if (dec.accion === "no_se" && !input.trim().startsWith("/")) {
        const historial = parseJSON(vars.historial, []);
        if (L.esAfirmacionCorta(input) && L.hayPinPendienteEnHistorial(historial)) {
          const pd = L.decisionUbicacionPin(datos, { ...convBase }, dec.norm);
          if (pd) { dec = pd; via = "seguimiento_pin"; }
        }
      }
      return out(dec, { via });
    }

    // ── cerebro: orquestar da no_se -> el borrador simulado pasa
    //    por validarRespuestaCerebro; si promete la localización,
    //    la puerta EJECUTA el pin (index.ts v2.2), no cae al no-sé.
    if (modo === "cerebro") {
      let dec = L.orquestar(datos, { ...convBase }, input, hoy);
      let validacion = null;
      if (dec.accion === "no_se" && !input.trim().startsWith("/")) {
        const proy = L.proyeccionPublica(datos);
        validacion = L.validarRespuestaCerebro(String(vars.borrador ?? ""), proy.valores, datos.prohibidas);
        if (validacion.ok) {
          dec = { ...dec, accion: "cerebro", respuesta: String(vars.borrador ?? "") };
        } else if (validacion.motivo === "promete_accion" &&
                   /\b(localizacion|ubicacion|pin|mapa)\b/.test(L.normalizarLigero(String(vars.borrador ?? "")))) {
          const pd = L.decisionUbicacionPin(datos, { ...convBase }, dec.norm);
          if (pd) dec = pd;
        }
      }
      return out(dec, { validacion });
    }

    // ── orquestar (defecto): un turno contra la lógica real.
    const dec = L.orquestar(datos, { ...convBase }, input, hoy);
    return out(dec);
  }
}

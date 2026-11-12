// =====================================================================
// cerebro.ts — el HUECO del cerebro LLM (contrato C1–C7 del plano v1).
// El piloto nace SIN cerebro: el estudio de cerebros dejó todos los
// candidatos en ámbar para una cuenta en Cuba (ninguno verificado
// C2+C3), así que el modo normal es la DEGRADACIÓN A FAQ EXACTA:
// este adaptador devuelve siempre null («no redacto») y la puerta
// responde con plantillas + datos vivos + FAQ aprobadas, que es el
// comportamiento diseñado para cuando el cerebro cae (C7).
//
// Cuando un proveedor cumpla el contrato, se implementa aquí:
//   C1 API HTTPS desde Deno, clave SOLO como secreto de función.
//   C2 $0 sin tarjeta para ~50 conversaciones/día.
//   C3 Términos que permitan un negocio en Cuba, sin evasión.
//   C4 Español natural, latencia < ~5 s.
//   C5 Salida estructurada (texto + fuentes citadas), temperatura baja.
//   C6 Sustituible: cambiar de proveedor = tocar SOLO este archivo.
//   C7 Si falla/tarda/agota cuota -> null (la puerta degrada sola).
// REGLA DE HIERRO: el cerebro jamás DECIDE. Solo podría redactar
// sobre una candidata ya casada por el marcador determinista, y su
// texto pasa por el mismo verificador de cifras antes de salir.
// =====================================================================

export interface ContextoCerebro {
  pregunta: string;
  candidata: { faq_id: string; respuesta_base: string; fuentes: unknown[] } | null;
  historial: { rol: string; texto: string }[];
}

export interface RespuestaCerebro {
  texto: string;
  fuentes_citadas: string[];
}

export interface Cerebro {
  nombre: string;
  responder(ctx: ContextoCerebro): Promise<RespuestaCerebro | null>;
}

/* Adaptador vigente: ninguno (degradación elegante permanente). */
export const cerebroActual: Cerebro = {
  nombre: "ninguno-faq-exacta",
  async responder(_ctx: ContextoCerebro): Promise<RespuestaCerebro | null> {
    return null;
  },
};

// =====================================================================
// cerebro.ts — la CAPA CONVERSACIONAL del Agente Propio (v2).
// Contrato C1–C7 del plano v1 + barandas v2:
//   · El cerebro NUNCA decide: solo redacta una respuesta de GUÍA
//     cuando el determinista no supo (no_se) y el hierro ya pasó.
//   · Su contexto es SOLO la proyección pública verificada
//     (logica.proyeccionPublica); jamás ve tarifa viva ni internos.
//   · Su texto pasa por logica.validarRespuestaCerebro (hierro +
//     verificador de cifras) antes de salir; si no pasa, no sale.
//   · Sin claves configuradas -> «ninguno» (degradación a FAQ exacta,
//     el comportamiento de la Fase 1). Cambiar de proveedor = tocar
//     SOLO los secretos de la función, nunca el código:
//       CEREBRO_PROVEEDOR = cloudflare | groq
//       CEREBRO_API_KEY   = la clave del proveedor
//       CEREBRO_CUENTA_ID = (solo Cloudflare) id de la cuenta
//       CEREBRO_MODELO    = (opcional) modelo a usar
//   · Estado verificado en vivo el 2026-11-12: NO existe cuenta de
//     Cloudflare ni de Groq a nombre de Ernesto (sin claves en el
//     llavero ni en los secretos de la función), así que hoy el
//     adaptador activo sigue siendo «ninguno»; el cableado queda
//     listo para el día en que una cuenta exista.
// =====================================================================

export interface ContextoCerebro {
  pregunta: string;
  candidata: { faq_id: string; respuesta_base: string; fuentes: unknown[] } | null;
  historial: { rol: string; texto: string }[];
  proyeccion?: string;
}

export interface RespuestaCerebro {
  texto: string;
  fuentes_citadas: string[];
}

export interface Cerebro {
  nombre: string;
  responder(ctx: ContextoCerebro): Promise<RespuestaCerebro | null>;
}

type Env = (k: string) => string | undefined;

const SISTEMA =
  "Eres el asistente virtual del negocio de Ernesto (barbería y ventas en Santiago de Cuba). " +
  "Respondes como GUÍA amable en español, breve (máx. 3 oraciones). " +
  "SOLO puedes usar los DATOS PÚBLICOS que vienen en el contexto: está PROHIBIDO inventar " +
  "precios, horarios o cualquier cifra que no esté escrita ahí. Si el dato no está, di que " +
  "no lo sabes y que se lo pasas al dueño del negocio. NUNCA hables de descuentos, crédito, " +
  "apartados, tasas de cambio, QUSD ni ganancias: eso lo confirma el dueño en persona.";

function mensajes(ctx: ContextoCerebro) {
  const hist = (ctx.historial ?? []).slice(-4)
    .map((h) => (h.rol === "cliente" ? "Cliente: " : "Asistente: ") + h.texto).join("\n");
  const user = "DATOS PÚBLICOS DEL NEGOCIO:\n" + (ctx.proyeccion ?? "") +
    (hist ? "\n\nCONVERSACIÓN RECIENTE:\n" + hist : "") +
    "\n\nPREGUNTA DEL CLIENTE: " + ctx.pregunta +
    "\n\nResponde solo con los datos de arriba.";
  return [
    { role: "system", content: SISTEMA },
    { role: "user", content: user },
  ];
}

async function postJson(url: string, headers: Record<string, string>,
                        body: unknown, ms = 6000): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body), signal: AbortSignal.timeout(ms),
    });
    if (!r.ok) return null;
    return await r.json() as Record<string, unknown>;
  } catch { return null; }
}

export const cerebroNinguno: Cerebro = {
  nombre: "ninguno-faq-exacta",
  async responder(_ctx: ContextoCerebro): Promise<RespuestaCerebro | null> {
    return null;
  },
};

/* Cloudflare Workers AI (el ámbar menos cerrado del estudio). */
function cerebroCloudflare(key: string, cuenta: string, modelo: string): Cerebro {
  return {
    nombre: "cloudflare-workers-ai",
    async responder(ctx: ContextoCerebro): Promise<RespuestaCerebro | null> {
      const j = await postJson(
        "https://api.cloudflare.com/client/v4/accounts/" + cuenta + "/ai/run/" + modelo,
        { Authorization: "Bearer " + key },
        { messages: mensajes(ctx), max_tokens: 240, temperature: 0.2 });
      const texto = (j?.result as Record<string, unknown>)?.response;
      if (typeof texto !== "string" || !texto.trim()) return null;
      return { texto: texto.trim(), fuentes_citadas: [] };
    },
  };
}

/* Groq (compatible con la API de OpenAI; el de más volumen gratis). */
function cerebroGroq(key: string, modelo: string): Cerebro {
  return {
    nombre: "groq",
    async responder(ctx: ContextoCerebro): Promise<RespuestaCerebro | null> {
      const j = await postJson(
        "https://api.groq.com/openai/v1/chat/completions",
        { Authorization: "Bearer " + key },
        { model: modelo, messages: mensajes(ctx), max_tokens: 240, temperature: 0.2 });
      const choices = j?.choices as Record<string, unknown>[] | undefined;
      const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
      const texto = msg?.content;
      if (typeof texto !== "string" || !texto.trim()) return null;
      return { texto: texto.trim(), fuentes_citadas: [] };
    },
  };
}

/* Fábrica: lee los secretos UNA vez por invocación. Sin proveedor o
   sin clave -> «ninguno» (la puerta degrada al determinista, C7). */
export function crearCerebro(env: Env): Cerebro {
  const prov = (env("CEREBRO_PROVEEDOR") || "").toLowerCase();
  const key = env("CEREBRO_API_KEY") || "";
  if (!key) return cerebroNinguno;
  if (prov === "cloudflare") {
    const cuenta = env("CEREBRO_CUENTA_ID") || "";
    if (!cuenta) return cerebroNinguno;
    return cerebroCloudflare(key, cuenta,
      env("CEREBRO_MODELO") || "@cf/meta/llama-3.1-8b-instruct-fast");
  }
  if (prov === "groq") {
    return cerebroGroq(key, env("CEREBRO_MODELO") || "openai/gpt-oss-20b");
  }
  return cerebroNinguno;
}

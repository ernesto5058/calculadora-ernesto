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
//   · Estado verificado en vivo el 2026-11-12: el cerebro YA está
//     ACTIVO con Cloudflare Workers AI desde el 2026-11-12 (el token
//     vive solo en el llavero ~/workspace/.secure/cerebro-cloudflare.env
//     y en los secretos de la función; su valor jamás se imprime).
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
  "apartados, tasas de cambio, QUSD ni ganancias: eso lo confirma el dueño en persona. " +
  "ESTILO: español cubano natural, tipo WhatsApp/Telegram, líneas cortas; pon 1 emoji " +
  "medido al inicio de cada bloque temático (💈 corte · 🧺 lavadora · 🔋 batería · " +
  "📱 saldo · 🕘 horario · 📍 ubicación · 🏠 domicilio · 💵 pagos · ✅ garantía · " +
  "📲 contacto); prohibida la lluvia de emojis; jamás alteres cifras ni teléfonos. " +
  "EXPLICAR ES TU TRABAJO: si el cliente pregunta qué es, para qué sirve o cómo funciona " +
  "algo del negocio (un producto, un servicio, la compra de saldo o la de transferencia), " +
  "explícaselo con tus palabras usando SOLO los datos del contexto (sección CATÁLOGO y " +
  "demás datos públicos). Preguntar por un tema NO es pedir un compromiso: explicar la " +
  "compra de saldo con sus precios públicos es información del negocio, no un trato. " +
  "CAPACIDADES REALES del bot (son verdad: NUNCA niegues ninguna): enviar el pin de " +
  "ubicación del negocio, mostrar el panel de temas, tomar citas paso a paso, responder " +
  "precios, horario y datos públicos de la ficha, y pasar notas al dueño. Está PROHIBIDO " +
  "decir que no tienes acceso a una función de esa lista (nada de «no tengo acceso a " +
  "enviar localizaciones» ni parecido).";

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

/* Parseo DUAL de la respuesta de Cloudflare (insumo de Textos PRO,
   Ola 2, 2026-11-12 — la copia de textos-generar lo cazó en vivo):
   el modelo devuelve `result.response` como OBJETO ya parseado
   cuando la salida es JSON válido; la lectura ingenua (solo string)
   devolvía null y el cerebro «no respondía». Se acepta, en orden:
   choices[0].message.content (string), response string, o response
   objeto — de un objeto se extrae su campo de texto si lo trae
   (texto/respuesta/response/content) y si no, se re-serializa: el
   contenido jamás se tira a null por la forma. Función pura y
   exportada: la prueba el banco de la puerta (casos CER). */
export function extraerTextoRespuesta(result: unknown): string | null {
  const res = result as Record<string, unknown> | undefined;
  if (!res) return null;
  const choices = res.choices as Record<string, unknown>[] | undefined;
  const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
  if (typeof msg?.content === "string" && msg.content.trim()) return msg.content.trim();
  const r = res.response;
  if (typeof r === "string" && r.trim()) return r.trim();
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    for (const k of ["texto", "respuesta", "response", "content"]) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return JSON.stringify(r);
  }
  return null;
}

/* Cloudflare Workers AI (el ámbar menos cerrado del estudio). */
function cerebroCloudflare(key: string, cuenta: string, modelo: string): Cerebro {
  return {
    nombre: "cloudflare-workers-ai",
    async responder(ctx: ContextoCerebro): Promise<RespuestaCerebro | null> {
      const j = await postJson(
        "https://api.cloudflare.com/client/v4/accounts/" + cuenta + "/ai/run/" + modelo,
        { Authorization: "Bearer " + key },
        { messages: mensajes(ctx), max_tokens: 240, temperature: 0.2 });
      const texto = extraerTextoRespuesta(j?.result);
      if (!texto) return null;
      return { texto, fuentes_citadas: [] };
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

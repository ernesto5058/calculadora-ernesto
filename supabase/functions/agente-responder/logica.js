// =====================================================================
// logica.js — el cerebro DETERMINISTA del Agente Propio (Fase 1).
// Sin LLM: normalización, marcador multi-señal con niveles de
// confianza, reglas de hierro, flujo de citas, verificador de cifras
// y el orquestador puro que la puerta (index.ts) ejecuta con IO real.
// Estudio: research_notes/agente-propio-algoritmo-estudio-2026-11-11.md
// La puerta NO decide nada que no esté decidido aquí: la máquina
// consulta, nunca decide (plano v1 §1.3).
// =====================================================================

/* --- Normalización: ESPEJO EXACTO de public.agente_normalizar (SQL).
   El banco cruzado declara ambas equivalentes en el conjunto dorado. */
const PARADAS = new Set((
  "hola buenas buenos saludos oye oiga mira bro men asere " +
  "por favor porfa quiero quisiera saber necesito puedes puede " +
  "podria me te se de del la el los las un una unos " +
  "unas en con mi tu su al a y o es son hay tiene " +
  "tienes tienen hacen hace cuando donde como que cuanto " +
  "cuanta cuantos cuantas cual cuales dime diganme informacion " +
  "sobre para gracias ok vale bueno bien ya si no lo " +
  "le les esto eso este esta ese esa muy mas tambien " +
  "dia dias hoy ahora usted ustedes senor senora"
).split(" "));

const ACENTOS = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u", ñ: "n" };

export function quitarAcentos(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[áéíóúüñ]/gi, (c) => ACENTOS[c.toLowerCase()] ?? c);
}

export function normalizar(txt) {
  let v = quitarAcentos(String(txt ?? "").toLowerCase());
  v = v.replace(/[^a-z0-9]+/g, " ");
  v = " " + v + " ";
  v = v.replace(/ pa /g, " para ").replace(/ pal /g, " para el ")
       .replace(/ q /g, " que ").replace(/ x /g, " por ")
       .replace(/ pelao /g, " pelado ").replace(/ peláo /g, " pelado ");
  const toks = v.split(" ").filter((t) => t && !PARADAS.has(t));
  return toks.join(" ");
}

/* Forma de grupo: números -> «#» (para agrupar sin-respuestas). */
export function formaGrupo(txt) {
  return normalizar(txt).replace(/\b[0-9]+\b/g, "#").trim();
}

/* Normalización LIGERA: minúsculas, sin acentos ni signos, con las
   palabras vacías INTACTAS. Las reglas de hierro y las señales de
   conversación se leen aquí (en la forma completa «de», «con» y
   «quiero» desaparecen y los patrones se rompen). */
export function normalizarLigero(txt) {
  let v = quitarAcentos(String(txt ?? "").toLowerCase());
  v = v.replace(/[^a-z0-9]+/g, " ");
  v = " " + v + " ";
  v = v.replace(/ pa /g, " para ").replace(/ pal /g, " para el ")
       .replace(/ q /g, " que ").replace(/ x /g, " por ")
       .replace(/ pelao /g, " pelado ");
  return v.split(" ").filter(Boolean).join(" ");
}

export function tokensDe(norm) {
  return norm ? norm.split(" ").filter(Boolean) : [];
}

/* --- Similitud de trigramas (aprox. fiel de pg_trgm similarity()) --- */
function trigramas(s) {
  const t = "  " + s + " ";
  const set = new Set();
  for (let i = 0; i + 3 <= t.length; i++) set.add(t.slice(i, i + 3));
  return set;
}
export function similitudTrgm(a, b) {
  const A = trigramas(a), B = trigramas(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export function jaccardTokens(a, b) {
  const A = new Set(tokensDe(a)), B = new Set(tokensDe(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/* --- Enmascarado (RG-1): ningún dato de pago queda en el registro --- */
export function enmascarar(txt) {
  let v = String(txt ?? "");
  // secuencias largas de dígitos (tarjetas/cuentas), con espacios o guiones
  v = v.replace(/\d[\d -]{11,}\d/g, "[dato protegido]");
  v = v.replace(/\b\d{12,}\b/g, "[dato protegido]");
  // E9 (Tanda Nº6): teléfono cubano — 8 dígitos empezando por 5, con
  // prefijo +53 opcional y espacios/guiones entre grupos. Antes una
  // regex exigía 12+ dígitos y el teléfono normal NUNCA se tapaba.
  v = v.replace(/(?:\+?53[\s-]?)?\b5(?:[\s-]?\d){7}\b/g, "[dato protegido]");
  // «pin/clave/contraseña» + dígitos, TAMBIÉN con palabras cortas en
  // medio («mi pin es 4321», «la clave de acceso es 9988»): la regex
  // vieja exigía los dígitos pegados y «mi pin es 4321» pasaba entero.
  v = v.replace(/(pin|clave|contrasena|password)([a-záéíóúñ :=]{0,24}?)(\d+)/gi, "$1$2[dato protegido]");
  return v;
}

/* --- Cifras: extracción y forma canónica (verificador) ---------------- */
export function extraerCifras(texto) {
  const out = [];
  const re = /\d+(?:[.,]\d+)?/g;
  let m;
  let t = String(texto ?? "");
  // miles con espacio («1 000», «5 000») son UNA cifra, no dos
  let antes;
  do { antes = t; t = t.replace(/(\d) (?=\d{3}(\D|$))/g, "$1"); } while (t !== antes);
  while ((m = re.exec(t)) !== null) out.push(canon(m[0]));
  return out;
}
export function canon(numStr) {
  const n = Number(String(numStr).replace(",", "."));
  if (!Number.isFinite(n)) return String(numStr);
  return String(Math.round(n * 100) / 100);
}
function cifrasDeValor(valor) {
  return extraerCifras(typeof valor === "string" ? valor : JSON.stringify(valor ?? ""));
}

/* El verificador (plano §1.4): toda cifra de la respuesta debe estar
   en las fuentes citadas; una cifra INTERNA (tarifa viva) bloquea
   siempre, aunque «coincida» con algo público. */
export function verificarCifras(texto, fuentesValores, prohibidas, extraPermitidas = []) {
  const permitidas = new Set(["0"]);
  for (const f of fuentesValores ?? []) for (const c of cifrasDeValor(f)) permitidas.add(c);
  for (const c of extraPermitidas ?? []) permitidas.add(canon(c));
  const prohib = new Set((prohibidas ?? []).map(canon));
  const huerfanas = [];
  let interna = false;
  for (const c of extraerCifras(texto)) {
    if (prohib.has(c)) interna = true;
    else if (!permitidas.has(c)) huerfanas.push(c);
  }
  return { ok: !interna && huerfanas.length === 0, interna, huerfanas };
}

/* E4 — El verificador de una respuesta de TEXTO de FAQ, con las
   reglas de origen EXACTAS de la vía principal (rama «texto» de
   orquestar): sin fuentes de dato (fuentes = []); si la dictó
   Ernesto (origen «ernesto»), SUS cifras son su propia fuente; las
   PROHIBIDAS bloquean siempre (van primero dentro del verificador).
   TODA salida de texto de FAQ — vía principal, aclaración o saludo —
   pasa por aquí antes de llegar al cliente. */
export function verificarTextoFaq(f, datos) {
  const texto = f?.respuesta_texto ?? "";
  const extra = f?.origen === "ernesto" ? extraerCifras(texto) : [];
  return verificarCifras(texto, [], datos?.prohibidas, extra);
}

/* --- Detección de productos e intenciones (sinónimos curados) -------- */
/* El destino de un token: exacto, o DIFUSO si el token se parece mucho
   a un término curado («presio» ~ «precio», «labadora» ~ «lavadora»):
   los errores de dedo no pueden costar la intención entera. */
export function destinoDeToken(tok, sinonimos, tipo) {
  let mejor = null, mejorSim = 0;
  for (const s of sinonimos ?? []) {
    if (tipo && s.tipo !== tipo) continue;
    if (s.termino === tok) return s;
    if (tok.length >= 4 && s.termino.length >= 4) {
      const sim = similitudTrgm(tok, s.termino);
      if (sim >= 0.62 && sim > mejorSim) { mejor = s; mejorSim = sim; }
    }
  }
  return mejor;
}
export function detectarProductos(norm, sinonimos) {
  const out = new Set();
  for (const t of tokensDe(norm)) {
    const s = destinoDeToken(t, sinonimos, "producto");
    if (s) out.add(s.destino);
  }
  return [...out];
}
export function detectarIntenciones(norm, sinonimos) {
  const out = new Set();
  for (const t of tokensDe(norm)) {
    const s = destinoDeToken(t, sinonimos, "intencion");
    if (s) out.add(s.destino);
  }
  return [...out];
}

/* Intenciones por FRASE sobre la forma ligera: «a cómo» = precio (la
   normalización completa la deshace), «a qué hora» = horario, etc. */
export function detectarIntencionesLigero(ligero) {
  const out = new Set();
  const t = " " + String(ligero ?? "") + " ";
  if (/ a como /.test(t) || / cuanto (cuesta|vale|es|seria) /.test(t) ||
      / precio /.test(t)) out.add("precio");
  if (/ a que hora /.test(t) || / horario /.test(t) || / hasta que hora /.test(t)) out.add("horario");
  if (/ donde (queda|esta|es|vives|ubicado) /.test(t) || / direccion /.test(t)) out.add("ubicacion");
  if (/ (quiero|necesito|reservar|pedir) (una )?(cita|turno) /.test(t) ||
      / (cita|turno) /.test(t)) out.add("cita");
  if (/ que haces /.test(t) || / que puedes hacer /.test(t) ||
      / para que sirves /.test(t) || / que sabes hacer /.test(t) ||
      / puedes ayudar /.test(t)) out.add("capacidades");
  if (/ domicilio /.test(t) || / vienen a /.test(t)) out.add("domicilio");
  if (/ garantia /.test(t)) out.add("garantia");
  if (/ (como|formas de) (pago|pagar) /.test(t) || / aceptas transferencia /.test(t)) out.add("pago");
  return [...out];
}

/* --- Reglas de hierro (antes del marcador; estudio §3) ----------------
   Se leen sobre la forma LIGERA (con las palabras vacías intactas). */
const RE_HUMANO = /(hablar|pasame|pasar|comunica|atiend)/;
const RE_DINERO_TOKENS = new Set([
  "qusd", "dolar", "dolares", "mlc", "euro", "euros", "cripto", "bitcoin",
  "usdt", "salida", "toque", "ganancia", "ganas", "margen", "comision",
  "libro", "bank",
]);
const RE_DESCUENTO = /\b(fia\w*|rebaj\w*|descuent\w*|apart\w*|guardame|guardas|guardar|credito|plazos|sen\w*)\b/;
/* M1 (Tanda Nº6): escapes del hierro que la auditoría cazó cayendo a
   no_se (y de ahí al cerebro) en vez de escalar/denegar determinista:
   «alguien real», «el jefe», «número de <Nombre>», «euro» singular,
   venta de saldo con palabras en medio y «más barato». */
const RE_HUMANO_EXTRA = /\b(alguien|una persona|un humano|ser humano) (real|de verdad)\b|\bpersona real\b|\bcon (el |la )?(jefe|jefa|encargad\w*|responsable)\b/;
const RE_DATOS_NOMBRE = /(numero|telefono|celular|movil|direccion|datos|contacto) de ([a-z]+)/;
const NO_ES_TERCERO = new Set(["ernesto", "dueno", "ti", "usted", "negocio",
  "telefono", "la", "el", "los", "las", "un", "una", "otro", "otra", "ese", "esa", "barberia", "aqui"]);
export function detectarHierro(ligero, crudo) {
  const norm = " " + String(ligero ?? "") + " ";
  const toks = tokensDe(ligero);
  const set = new Set(toks);
  const raw = quitarAcentos(String(crudo ?? "").toLowerCase());
  // 1) humano: «hablar con Ernesto / el dueño / una persona», «DUEÑO»,
  // «que me atienda alguien real», «comunícame con el jefe» (M1)
  if ((RE_HUMANO.test(ligero) && (set.has("ernesto") || set.has("dueno") ||
        set.has("persona") || set.has("humano") || set.has("alguien") ||
        set.has("jefe") || set.has("jefa") || set.has("responsable"))) ||
      RE_HUMANO_EXTRA.test(ligero) ||
      toks.join(" ") === "dueno" || raw.trim() === "dueño" || raw.trim() === "dueno") {
    return { tipo: "humano", motivo: "pide_humano" };
  }
  // 2) datos de terceros o internos — también «número de <Nombre>»
  // sin artículo («dame el número de Briku», M1): un nombre propio
  // tras «número/teléfono de» es un tercero; Ernesto y «teléfono»
  // («número de teléfono» = el contacto público) quedan fuera.
  const mDatos = norm.match(RE_DATOS_NOMBRE);
  if (/(telefono|numero|direccion|datos) de (los|las|otro|otra|un|una|ese|esa) /.test(norm) ||
      (mDatos && !NO_ES_TERCERO.has(mDatos[2])) ||
      norm.includes(" cuanto gana ") || norm.includes(" cuanto ganan ") ||
      norm.includes(" clientes de ayer") || norm.includes(" tus clientes")) {
    return { tipo: "datos", motivo: "datos_terceros" };
  }
  // 3) descuento / fiar / apartar / pagar en partes
  if (RE_DESCUENTO.test(ligero) || /\bmas barato\b/.test(ligero) ||
      norm.includes(" en partes ") || norm.includes(" dos pagos ") ||
      norm.includes(" me lo guardas") || norm.includes(" te lo pago despues")) {
    return { tipo: "descuento", motivo: "descuento_o_credito" };
  }
  // 4) dinero de SU operación: vender saldo/QUSD, tasas, salida…
  const conLavadora = set.has("lavadora") || set.has("hys");
  if (!conLavadora) {
    for (const t of toks) if (RE_DINERO_TOKENS.has(t)) {
      return { tipo: "dinero", motivo: "tema_dinero" };
    }
  }
  if (/(vendes|vende|vender|vendeme|comprar|compro)\b[^.]{0,24}\b(saldo|qusd)\b/.test(ligero) &&
      !ligero.includes("compras saldo") && !ligero.includes("me compras")) {
    // «¿vendes saldo?» / «quiero comprar saldo» = él no vende por aquí
    if (!set.has("compras")) return { tipo: "dinero", motivo: "venta_saldo" };
  }
  if (norm.includes(" a como el qusd") || norm.includes(" tasa de cambio") ||
      norm.includes(" precio del dolar")) {
    return { tipo: "dinero", motivo: "tema_dinero" };
  }
  return null;
}

/* Intención de compra caliente (ampliación 5b): se responde lo público
   y el SISTEMA avisa a Ernesto. No bloquea la respuesta. */
export function detectarCompraCaliente(ligero, crudo) {
  const raw = String(crudo ?? "");
  const dejaTelefono = /\b5\d{7}\b/.test(raw.replace(/[\s-]/g, ""));
  const quiere = /(quiero|me interesa|voy a|quisiera) (comprar|llevar|llevarme|reservar)/.test(ligero) ||
                 ligero.includes("quiero la lavadora") || ligero.includes("quiero una lavadora") ||
                 ligero.includes("me quedo con");
  return { caliente: quiere || (dejaTelefono && /comprar|lavadora|bateria|corte|saldo/.test(ligero)), dejaTelefono };
}

/* Clasificación del mensaje siguiente (señal «resolvió», estudio §5):
   cierre agradecido corto y sin pregunta nueva. */
const CIERRE = new Set(["gracias", "perfecto", "genial", "excelente", "entendido", "listo"]);
const RELLENO_CIERRE = new Set(["ok", "vale", "bueno", "bien", "dale", "ya", "si", "muchas", "mil", "muy", "hola"]);
export function clasificarSiguiente(crudo) {
  const toks = tokensDe(normalizarLigero(crudo));
  if (!toks.length || toks.length > 5) return null;
  if (!toks.some((t) => CIERRE.has(t))) return null;
  if (toks.every((t) => CIERRE.has(t) || RELLENO_CIERRE.has(t))) return "gracias";
  return null;
}

/* =====================================================================
   PLANTILLAS DE DATO VIVO — la respuesta se ARMA con la fila leída
   en ese segundo; renderDato devuelve también las fuentes citadas
   (valores crudos) para el verificador y la auditoría.
   datos = { catalogo: Map clave->fila, fuente: Map clave->{valor,actualizado_en} }
   ===================================================================== */
function fmtNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n ?? "");
  const r = Math.round(v * 100) / 100;
  const entero = Math.trunc(r);
  let s = String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const dec = Math.round((Math.abs(r) - Math.abs(entero)) * 100);
  if (dec > 0) s += "," + String(dec).padStart(2, "0");
  return s;
}
/* "18:00" -> "6:00 p. m." · "09:00" -> "9:00 a. m." (desde el dato) */
function hora12(hhmm) {
  const [hh, mm] = String(hhmm ?? "").split(":").map(Number);
  if (!Number.isFinite(hh)) return String(hhmm ?? "");
  const suf = hh >= 12 ? "p. m." : "a. m.";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return h12 + ":" + String(mm || 0).padStart(2, "0") + " " + suf;
}
/* v2.1: capa de presentación — 1 emoji medido al inicio de cada
   bloque de dato (solo se antepone; cifras y textos exactos). */
export const EMOJI_DATO = {
  precio_corte: "💈", precio_lavadora: "🧺", precio_bateria: "🔋",
  tarifa_saldo: "📱", horario: "🕘", ubicacion: "📍", domicilio: "🏠",
  formas_pago: "💵", garantia_lavadora: "✅", contacto: "📲",
  stock_lavadora: "🧺", stock_bateria: "🔋", identidad: "🤖",
};
export function renderDato(datoClave, datos) {
  const cat = datos.catalogo;
  const fue = datos.fuente;
  const F = (clave) => fue.get(clave);
  const C = (clave) => cat.get(clave);
  // v2: la trazabilidad (fuente + hora del dato) vive SOLO en la
  // auditoría (fuentes/fuentes_detalle de la decisión); el texto al
  // cliente va LIMPIO, sin notas internas — orden de Ernesto tras ver
  // «(dato de la ficha, actualizado…)» en su propio chat de prueba.
  switch (datoClave) {
    case "precio_corte": {
      const a = C("corte"), b = C("corte_transferencia");
      if (!a) return null;
      const fuentes = [a, b].filter(Boolean);
      let texto = "💈 El corte cuesta " + fmtNum(a.precio) + " " + a.moneda + " en efectivo";
      if (b) texto += " y " + fmtNum(b.precio) + " " + b.moneda + " por transferencia";
      texto += ".";
      return { texto, fuentes };
    }
    case "precio_lavadora": {
      const a = C("lavadora_hys");
      if (!a) return null;
      return {
        texto: "🧺 La lavadora HYS de 7 kg cuesta " + fmtNum(a.precio) + " " + a.moneda +
               ". " + (a.nota ?? ""),
        fuentes: [a],
      };
    }
    case "precio_bateria": {
      const a = C("bateria_lifepo4");
      if (!a) return null;
      // v2.1: al dueño no se le remite «al dueño» (es él): variante propia.
      return {
        texto: datos?.esDueno
          ? "🔋 La batería LiFePO4 12.8V 100Ah es a precio al privado: no sale en " +
            "la ficha pública; a los clientes les remito contigo."
          : "🔋 La batería LiFePO4 12.8V 100Ah es a precio al privado: eso te lo " +
            "confirma el dueño del negocio directamente, sin intermediarios.",
        fuentes: [a],
      };
    }
    case "tarifa_saldo": {
      const t = F("tarifa_publica_saldo");
      if (!t) return null;
      const v = t.valor;
      return {
        texto: "📱 Sí, Ernesto compra saldo móvil en efectivo: paga al " + fmtNum(v.pago) +
               " (1 000 de saldo = " + fmtNum(v.tabla["1000"]) + " CUP; 5 000 = " +
               fmtNum(v.tabla["5000"]) + " CUP) y más de " + fmtNum(v.a_partir_de) +
               " los paga al " + fmtNum(v.pago_mayor) + ". Las recargas las paga a " +
               fmtNum(v.recarga) + " CUP. El domicilio es gratis.",
        fuentes: [t],
      };
    }
    case "horario": {
      const h = F("horario_barberia");
      if (!h) return null;
      const a12 = hora12(h.valor.abre), c12 = hora12(h.valor.cierra);
      return {
        texto: "🕘 La barbería abre " + h.valor.dias + ", de " + a12 +
               " a " + c12 + ".",
        fuentes: [h],
        // las horas en formato 12 h se derivan del dato: son legítimas
        extra: [...extraerCifras(a12), ...extraerCifras(c12)],
      };
    }
    case "ubicacion": {
      const z = F("zona");
      if (!z) return null;
      return { texto: "📍 Ernesto está en " + z.valor + ".", fuentes: [z] };
    }
    case "domicilio": {
      const lav = C("lavadora_hys"), tar = F("tarifa_publica_saldo"), zon = F("zona");
      return {
        texto: "🏠 Sí: la lavadora lleva el domicilio incluido en Santiago y la " +
               "compra de saldo tiene domicilio gratis. Para la barbería, el " +
               "corte es en el local de Micro 10.",
        fuentes: [lav, tar, zon].filter(Boolean),
      };
    }
    case "formas_pago": {
      const a = C("corte"), b = C("corte_transferencia");
      if (!a) return null;
      return {
        texto: "💵 El corte se paga en efectivo (" + fmtNum(a.precio) + " " + a.moneda +
               ") o por transferencia (" + fmtNum(b?.precio) + " " + (b?.moneda ?? "CUP") +
               "). La compra de saldo es solo en efectivo.",
        fuentes: [a, b].filter(Boolean),
      };
    }
    case "garantia_lavadora": {
      const a = C("lavadora_hys");
      if (!a) return null;
      return { texto: "✅ Sí: " + (a.nota ?? "tiene garantía de 1 año."), fuentes: [a] };
    }
    case "contacto": {
      const t = F("telefono_publico");
      if (!t) return null;
      return {
        texto: "📲 Puedes llamar a Ernesto al " + t.valor +
               " o escribirle por WhatsApp a ese mismo número.",
        fuentes: [t],
      };
    }
    case "identidad": {
      return {
        texto: "🤖 Soy el asistente virtual de Ernesto — no soy él. Respondo " +
               "precios, horarios y cómo comprar con los datos de su ficha, y " +
               "lo que no sepa te lo paso a él directamente.",
        fuentes: [],
      };
    }
    case "stock_lavadora": case "stock_bateria": {
      const a = C(datoClave === "stock_lavadora" ? "lavadora_hys" : "bateria_lifepo4");
      if (!a) return null;
      const nombre = datoClave === "stock_lavadora" ? "la lavadora HYS 7 kg" : "la batería LiFePO4";
      const texto = EMOJI_DATO[datoClave] + " " + (a.estado === "hay"
        ? "Sí, ahora mismo hay " + nombre + " disponible."
        : a.estado === "pocas"
          ? "Quedan pocas unidades de " + nombre + ": confírmalo con Ernesto antes de ir."
          : "Ahora mismo no hay " + nombre + " en existencia. Cuando reponga, se anuncia por aquí.");
      return { texto, fuentes: [a] };
    }
    default:
      return null;
  }
}

/* Productos que «pertenecen» a una FAQ (por su dato o sus patrones). */
const DATO_A_PRODUCTO = {
  precio_corte: ["corte"], formas_pago: ["corte"],
  precio_lavadora: ["lavadora_hys"], garantia_lavadora: ["lavadora_hys"],
  stock_lavadora: ["lavadora_hys"],
  precio_bateria: ["bateria_lifepo4"], stock_bateria: ["bateria_lifepo4"],
};

/* Forma CANÓNICA: cada token con sinónimo se sustituye por su destino
   («pelado» -> «corte», «cuesta» -> «precio») antes de comparar. Así
   dos redacciones con palabras distintas pero el mismo significado
   comparten tokens, y el solape/trigramas miden el SIGNIFICADO. */
export function formaCanonica(norm, sinonimos) {
  return tokensDe(norm).map((t) => destinoDeToken(t, sinonimos)?.destino ?? t).join(" ");
}

/* --- El marcador multi-señal (estudio §2) ------------------------------ */
export function puntuarCandidatas(norm, datos, ligero = "") {
  const { faqs, sinonimos } = datos;
  const productosQ = detectarProductos(norm, sinonimos);
  const intencionesQ = detectarIntenciones(norm, sinonimos);
  for (const i of detectarIntencionesLigero(ligero)) {
    if (!intencionesQ.includes(i)) intencionesQ.push(i);
  }
  // intención de precio inferida: producto + cifra («la batería a 150»)
  const hayCifra = /\d/.test(norm);
  if (hayCifra && productosQ.length && !intencionesQ.includes("precio")) {
    intencionesQ.push("precio");
  }
  const canonQ = formaCanonica(norm, sinonimos);
  const salida = [];
  for (const f of faqs) {
    if (f.estado !== "activa") continue;
    const senales = {};
    let total = 0;
    // patrón exacto (forma normalizada o canónica completa)
    let mejorTrgm = 0, mejorJac = 0;
    for (const p of f.patrones ?? []) {
      const canonP = formaCanonica(p, sinonimos);
      // el exacto canónico exige 2+ tokens: con uno solo (el producto)
      // no se puede distinguir precio de stock — eso lo aclara el nivel
      if (norm && p && (norm === p ||
          (canonQ && canonQ === canonP && tokensDe(canonQ).length >= 2))) {
        senales.exacto = 100; total = 100;
      }
      mejorTrgm = Math.max(mejorTrgm, similitudTrgm(canonQ, canonP));
      mejorJac = Math.max(mejorJac, jaccardTokens(canonQ, canonP));
    }
    if (total < 100) {
      senales.trgm = Math.round(mejorTrgm * 25);
      senales.jaccard = Math.round(mejorJac * 20);
      total += senales.trgm + senales.jaccard;
      // producto
      const prodsFaq = new Set(DATO_A_PRODUCTO[f.dato_clave] ?? []);
      for (const p of f.patrones ?? []) {
        for (const pr of detectarProductos(p, sinonimos)) prodsFaq.add(pr);
      }
      if (productosQ.length && prodsFaq.size) {
        if (productosQ.some((x) => prodsFaq.has(x))) { senales.producto = 30; total += 30; }
        else { senales.producto = -20; total -= 20; }
      }
      // intención
      if (f.intencion && intencionesQ.includes(f.intencion)) {
        senales.intencion = 25; total += 25;
      }
      // cifra en la pregunta hacia la FAQ de precio de ese producto
      if (hayCifra && f.intencion === "precio" &&
          productosQ.some((x) => (DATO_A_PRODUCTO[f.dato_clave] ?? []).includes(x))) {
        senales.cifra = 10; total += 10;
      }
      // prior de retroalimentación (acotado; estudio §5)
      const n = (f.veces_resuelta ?? 0) + (f.veces_fallada ?? 0);
      if (n >= 4) {
        const tasa = (f.veces_resuelta ?? 0) / n;
        senales.prior = Math.max(-15, Math.min(10, Math.round(20 * (tasa - 0.5))));
        total += senales.prior;
      }
    }
    salida.push({ faq: f, total, senales });
  }
  salida.sort((a, b) => b.total - a.total);
  return { candidatas: salida, productosQ, intencionesQ };
}

export function decidir(marcador, config) {
  const top = marcador.candidatas[0];
  if (!top) return { nivel: "no_se" };
  if (top.total >= (config?.umbral_responder ?? 70)) return { nivel: "responder", top };
  if (top.total >= (config?.umbral_aclarar ?? 45)) {
    const segunda = marcador.candidatas[1];
    return { nivel: "aclarar", top, segunda };
  }
  return { nivel: "no_se", top };
}

/* =====================================================================
   FLUJO DE CITAS (puro): pasos nombre -> servicio -> dia -> hora.
   Nunca confirma: al completar devuelve la SOLICITUD lista.
   ===================================================================== */
const SERVICIOS = ["corte"];
/* E7 (Tanda Nº6) — Salidas del flujo por TEXTO en cualquier paso:
   cancelar («cancela», «olvídalo», «ya no quiero») y pedir a un
   humano (el hierro corre TAMBIÉN dentro del flujo: antes «quiero
   hablar con Ernesto» se guardaba como NOMBRE de la cita). */
const RE_CANCELA_CITA = /\b(cancela|cancelar|cancelalo|cancelala|olvidalo|olvidala|dejalo|dejalo asi|ya no|no quiero|no hace falta|mejor no|no gracias)\b/;
/* E8 (Tanda Nº6) — El horario VIVO de las citas sale de la fuente
   `horario_barberia` (la misma que renderiza «horario» y que el dueño
   cambia desde ⚙️ Ajustes), jamás de constantes: si Ernesto abre a
   las 8, una cita a las 8 vale. Sin fuente legible, el respaldo es el
   horario semilla 9–18 (el banco lo ejercita sin datos). */
export function horarioVivo(datos) {
  const h = datos?.fuente?.get?.("horario_barberia")?.valor ?? {};
  const aMin = minutosDe(h.abre ?? "09:00"), cMin = minutosDe(h.cierra ?? "18:00");
  return { abre: h.abre ?? "09:00", cierra: h.cierra ?? "18:00",
           abreMin: Number.isFinite(aMin) ? aMin : 540,
           cierraMin: Number.isFinite(cMin) ? cMin : 1080 };
}
function minutosDe(hhmm) {
  const m = String(hhmm ?? "").match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}
export function horaEnHorario(hora, hor) {
  const mins = minutosDe(hora);
  return Number.isFinite(mins) && mins >= hor.abreMin && mins < hor.cierraMin;
}
/* Texto del rango vivo pa los avisos de fuera-de-horario. */
export function rangoHorarioTexto(hor) {
  return hora12(hor.abre) + " – " + hora12(hor.cierra);
}

export function flujoCitaPaso(flujo, textoCrudo, hoyISO, datos = null) {
  const f = { ...(flujo ?? {}) };
  f.datos = { ...(f.datos ?? {}) };
  const hor = horarioVivo(datos);
  const rango = rangoHorarioTexto(hor);
  const pedir = (paso, texto) => ({ flujo: { tipo: "cita", paso, datos: f.datos, canal: f.canal ?? null }, respuesta: texto, completa: false });
  const ligeroC = normalizarLigero(textoCrudo);

  // E7: cancelar por texto sale del flujo en CUALQUIER paso.
  if (RE_CANCELA_CITA.test(ligeroC)) {
    return { flujo: null, respuesta: "Listo, no anoto nada 👍 Si luego quieres una cita, dime y empezamos de nuevo.",
             completa: false, cancelada: true };
  }
  // E7: el hierro de humano/datos corre también dentro del flujo.
  const hierroFlujo = detectarHierro(ligeroC, textoCrudo);
  if (hierroFlujo?.tipo === "humano") {
    return { flujo: null, respuesta: "Claro 🙏 Te paso con el dueño del negocio ahora mismo; en cuanto vea el mensaje te atiende él personalmente.",
             completa: false, cancelada: true, escalar: "humano" };
  }
  if (hierroFlujo?.tipo === "datos") {
    return { flujo: null, respuesta: "Eso no lo puedo dar: son datos de otras personas. Si necesitas algo del negocio, pregúntame por precios, horarios o citas.",
             completa: false, cancelada: true, escalar: "datos" };
  }

  /* v2.3 — COSECHA NATURAL: el mensaje COMPLETO puede traer el día
     y/o la hora en CUALQUIER paso («Hoy a las 2:00 pm» llena los
     dos de una vez); solo se pregunta lo que falta y JAMÁS se
     re-pregunta un dato ya dado en el mismo mensaje. Fallo en vivo
     (2026-11-12): el paso del día leía SOLO el día y la hora del
     mismo mensaje se tiraba — el cliente tuvo que repetir «2 pm». */
  const dh = extraerDiaHora(textoCrudo, hoyISO, datos);
  // E7: una fecha explícita en el PASADO no se guarda ni completa:
  // se avisa y se vuelve a pedir el día (las relativas jamás caen
  // en el pasado: hoy/mañana/día-de-semana siempre son >= hoy).
  let diaPasado = false;
  if (dh.dia) {
    if (dh.dia < hoyISO) diaPasado = true;
    else f.datos.dia = dh.dia;
  }

  if (!f.datos.nombre && (!f.paso || f.paso === "nombre")) {
    const nombre = String(textoCrudo ?? "").trim()
      .replace(/^(me llamo|mi nombre es|soy|a nombre de)\s+/i, "")
      .replace(/[.!]+$/, "").trim().slice(0, 60);
    if (nombre.length >= 2) f.datos.nombre = nombre;
  }
  if (!f.datos.nombre) return pedir("nombre", "¿A nombre de quién anoto la cita?");

  /* E7: el paso de servicio NO fuerza «corte» contra la negación ni
     contra otro pedido: solo lo anota con afirmación o mención del
     corte; la negación ya salió arriba como cancelación y cualquier
     otra cosa vuelve a preguntar sin anotar nada. */
  if (f.paso === "servicio" && !f.datos.servicio) {
    if (/\bcorte\b|\bpelado\b/.test(ligeroC) || esAfirmacionCorta(textoCrudo)) {
      f.datos.servicio = "corte";
    } else if (String(textoCrudo ?? "").trim().length >= 2 && !dh.dia && !dh.hora) {
      return pedir("servicio", "Por ahora el servicio es solo corte de cabello 💈 ¿Anoto corte? (o escribe «cancela» si no lo quieres)");
    } else {
      f.datos.servicio = "corte";
    }
  }
  if (!f.datos.servicio) {
    return pedir("servicio", "¿Qué servicio quieres? Por ahora: corte de cabello. ¿Anoto corte?");
  }

  if (dh.hora) f.datos.hora = dh.hora;
  else if (dh.horaFuera) delete f.datos.hora;
  else if (f.paso === "hora") {
    // en el paso de la hora vale también la hora pelada («10»)
    const h = parseHora(textoCrudo);
    if (h) {
      if (horaEnHorario(h, hor)) f.datos.hora = h;
      else dh.horaFuera = h;
    }
  }
  if (!f.datos.hora && dh.horaFuera) {
    return pedir("hora", "Esa hora está fuera del horario (" + rango + "). ¿Cuál te sirve dentro de ese rango?");
  }

  if (!f.datos.dia) {
    if (diaPasado) return pedir("dia", "Esa fecha ya pasó 😅 Dime un día de hoy en adelante: «hoy», «mañana», «el viernes» o una fecha como 15/11.");
    if (f.paso === "dia") return pedir("dia", "No te entendí el día 😅 Dime por ejemplo «mañana», «el viernes» o una fecha como 15/11.");
    if (f.paso === "servicio") return pedir("dia", "Perfecto: corte. ¿Qué día te viene bien? (por ejemplo: mañana, el viernes, o 15/11)");
    return pedir("dia", "¿Qué día te viene bien? (por ejemplo: mañana, el viernes, o 15/11)");
  }
  if (!f.datos.hora) {
    if (f.paso === "hora") return pedir("hora", "Dime la hora así: «10», «10:30» o «4 de la tarde».");
    return pedir("hora", "Anotado: " + diaLegible(f.datos.dia) + ". ¿A qué hora? La barbería abre de " + rango + ".");
  }

  /* F3 (Tanda Nº6) — La cita WEB pide un CONTACTO (teléfono o
     Telegram): sin él, la confirmación de Ernesto no tiene por dónde
     llegar. En Telegram el propio chat ES el contacto: no se pide. */
  if (f.canal === "web" && !f.datos.contacto) {
    const contactoCrudo = String(textoCrudo ?? "").trim();
    if (f.paso === "contacto") {
      const tel = contactoCrudo.replace(/[\s-]/g, "");
      if (/^\+?5\d{7}$/.test(tel) || /^@[A-Za-z0-9_]{4,}$/.test(contactoCrudo) ||
          /^[A-Za-z0-9_]{5,}$/.test(contactoCrudo)) {
        f.datos.contacto = contactoCrudo.slice(0, 60);
      } else {
        return pedir("contacto", "Déjame un contacto válido: tu teléfono (8 dígitos, empieza por 5) o tu usuario de Telegram con @.");
      }
    }
    if (!f.datos.contacto) {
      return pedir("contacto", "Ya casi ✅ ¿Qué contacto le dejo a Ernesto pa confirmarte? Tu teléfono o tu Telegram (con @).");
    }
  }
  return { flujo: null, respuesta: null, completa: true, datos: f.datos };
}
export function inicioCita(flujoPrevio, textoCrudo, hoyISO, opts = {}) {
  // detecta datos ya dados en el primer mensaje (hora/día sueltos)
  const datos = {};
  const dia = parseDia(textoCrudo, hoyISO);
  // E7: jamás nace una cita con el día en el pasado.
  if (dia && dia >= hoyISO) datos.dia = dia;
  const hora = parseHora(textoCrudo);
  if (hora && horaEnHorario(hora, horarioVivo(opts?.datos ?? null))) datos.hora = hora;
  return { tipo: "cita", paso: "nombre", datos, canal: opts?.canal ?? null };
}
function parseDia(txt, hoyISO) {
  const t = quitarAcentos(String(txt ?? "").toLowerCase());
  const hoy = new Date(hoyISO + "T12:00:00Z");
  const fmt = (d) => d.toISOString().slice(0, 10);
  if (/\bhoy\b/.test(t)) return fmt(hoy);
  if (/pasado manana/.test(t)) return fmt(new Date(hoy.getTime() + 2 * 86400000));
  if (/\bmanana\b/.test(t)) return fmt(new Date(hoy.getTime() + 86400000));
  const dias = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
  for (const [nombre, dow] of Object.entries(dias)) {
    if (new RegExp("\\b" + nombre + "\\b").test(t)) {
      const actual = hoy.getUTCDay();
      let delta = (dow - actual + 7) % 7;
      if (delta === 0) delta = 7;
      return fmt(new Date(hoy.getTime() + delta * 86400000));
    }
  }
  const m = t.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (m) {
    const anio = m[3] ? Number(m[3].length === 2 ? "20" + m[3] : m[3]) : hoy.getUTCFullYear();
    const mes = Number(m[2]), diaN = Number(m[1]);
    const d = new Date(Date.UTC(anio, mes - 1, diaN, 12));
    // E7: fecha REAL — Date.UTC rueda el 31/02 al 3/03 sin avisar;
    // si los componentes no coinciden, ese día no existe -> null.
    if (!isNaN(d.getTime()) && d.getUTCFullYear() === anio &&
        d.getUTCMonth() === mes - 1 && d.getUTCDate() === diaN) return fmt(d);
  }
  return null;
}
function normHora(hhStr, mmStr, suf) {
  let hh = Number(hhStr);
  const mm = Number(mmStr ?? 0);
  const s = String(suf ?? "");
  if (/pm|tarde|noche/.test(s) && hh < 12) hh += 12;
  if (/am|manana/.test(s) && hh === 12) hh = 0;
  if (!Number.isFinite(hh) || hh > 23 || mm > 59) return null;
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}
function parseHora(txt) {
  const t = quitarAcentos(String(txt ?? "").toLowerCase());
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\. m\.|p\. m\.|de la tarde|de la manana|del mediodia|de la noche)?\b/);
  if (!m) return null;
  return normHora(m[1], m[2] ?? "00", m[3] ?? "");
}
/* v2.3 — Hora NATURAL: solo formas que en un mensaje suelto NO se
   confunden con un día ni con una cifra cualquiera: con minutos
   («2:00 pm», «2:00pm», «14:00»), con marca («3 pm», «4 de la
   tarde», «8 de la noche») o tras «a las / a la» («a las 10»). La
   hora pelada («10») solo vale como respuesta al paso de la hora,
   vía parseHora, como siempre. */
export function buscarHoraNatural(txt) {
  const t = quitarAcentos(String(txt ?? "").toLowerCase());
  let m = t.match(/\b(\d{1,2}):(\d{2})\s*(am|pm|a\. m\.|p\. m\.)?\b/);
  if (m) return normHora(m[1], m[2], m[3] ?? "");
  m = t.match(/\b(\d{1,2})\s*(am|pm|a\. m\.|p\. m\.|de la tarde|de la manana|del mediodia|de la noche)\b/);
  if (m) return normHora(m[1], "00", m[2]);
  m = t.match(/\ba (?:las|la)\s+(\d{1,2})\b/);
  if (m) return normHora(m[1], "00", "");
  return null;
}
/* v2.3 — Día y hora de UN mensaje completo (la cosecha del flujo):
   el día sale de parseDia sobre el texto entero y la hora de las
   formas naturales; la hora FUERA del horario VIVO no se guarda:
   se devuelve aparte pa que el flujo la señale sin perder el día. */
export function extraerDiaHora(txt, hoyISO, datos = null) {
  const dia = parseDia(txt, hoyISO);
  const h = buscarHoraNatural(txt);
  if (!h) return { dia, hora: null, horaFuera: null };
  if (horaEnHorario(h, horarioVivo(datos))) return { dia, hora: h, horaFuera: null };
  return { dia, hora: null, horaFuera: h };
}
export function diaLegible(iso) {
  try {
    return new Intl.DateTimeFormat("es", {
      timeZone: "America/Havana", weekday: "long", day: "numeric", month: "long",
    }).format(new Date(iso + "T12:00:00Z"));
  } catch { return iso; }
}

/* =====================================================================
   v2.3 — CONTROL DE CITAS DEL DUEÑO (puro): aviso con botones, vista
   de pendientes en Ajustes y decisión con aviso al cliente. La
   DECISIÓN la ejecuta UNA sola puerta SQL (agente_cita_decidir, la
   misma del bot de gestión: estado + decidida_en + auditoría, con su
   idempotencia); aquí viven los textos y los teclados, y la puerta
   (index.ts) hace el IO: RPC, push al cliente de Telegram o aviso
   encolado en la conversación web. Sin esto, la cita caía en la
   tabla y Ernesto no tenía dónde verla ni decidirla desde el bot
   de clientes, y el cliente jamás se enteraba del desenlace.
   ===================================================================== */
export function horaCorta(h) {
  return String(h ?? "").slice(0, 5);
}
export function resumenCita(cita) {
  return String(cita?.nombre ?? "Sin nombre") + " — " + String(cita?.servicio ?? "corte") +
         " · " + diaLegible(String(cita?.dia ?? "")) + " a las " + horaCorta(cita?.hora) +
         " (por " + String(cita?.canal ?? "—") + ")" +
         // F3: el contacto de la cita web se referencia en el aviso.
         (cita?.contacto ? " · contacto: " + String(cita.contacto) : "");
}
/* El aviso que le llega al dueño al crearse la cita, con sus botones
   de decisión (callback «v2:c:ok|no:<id>», los maneja esta puerta). */
export function textoAvisoCitaNueva(cita) {
  return "📋 Nueva solicitud de cita\n" + resumenCita(cita) +
         "\nEs una SOLICITUD, no está confirmada: decídela aquí 👇";
}
export function tecladoDecisionCita(citaId) {
  return { inline_keyboard: [[
    { text: "✅ Confirmar", callback_data: "v2:c:ok:" + citaId },
    { text: "✖️ Rechazar", callback_data: "v2:c:no:" + citaId },
  ]] };
}
/* La vista «📋 Citas» de Ajustes: pendientes de hoy en adelante, en
   el orden en que la puerta las lee (día, hora). */
export function textoCitasPendientes(citas) {
  const lista = citas ?? [];
  if (!lista.length) {
    return "📋 No tienes citas pendientes ✨\nCuando un cliente pida una, te llega " +
           "el aviso aquí mismo, con botones pa decidirla.";
  }
  return "📋 Citas pendientes (" + lista.length + ")\n" +
         lista.map((c) => "• " + resumenCita(c)).join("\n") +
         "\nToca ✅ o ✖️ en cada una pa decidirla 👇";
}
export function tecladoCitasPendientes(citas) {
  const filas = (citas ?? []).slice(0, 8).map((c) => ([
    { text: "✅ " + String(c.nombre ?? "cita").slice(0, 18), callback_data: "v2:c:ok:" + c.id },
    { text: "✖️", callback_data: "v2:c:no:" + c.id },
  ]));
  filas.push([
    { text: "⚙️ Ajustes", callback_data: "v2:d:menu" },
    { text: "🏠 Inicio", callback_data: "v2:p:inicio" },
  ]);
  return { inline_keyboard: filas };
}
/* La decisión sobre UNA cita pendiente: valida que siga pendiente
   (en la foto que trae datos) y compone los dos textos — el del
   dueño y el aviso al cliente. La frase del aviso NUNCA promete lo
   que el canal no cumple: Telegram lo recibe al momento; la web lo
   ve en su próxima visita al chat de la página. */
export function decisionCita(datos, citaId, decision) {
  const cita = (datos?.citasPendientes ?? []).find((c) => String(c.id) === String(citaId));
  if (!cita) return { ok: false, motivo: "no_pendiente" };
  const confirma = decision === "ok";
  const estadoNuevo = confirma ? "confirmada" : "rechazada";
  const cuando = diaLegible(String(cita.dia)) + " a las " + horaCorta(cita.hora);
  const avisoTexto = confirma
    ? "✅ Tu cita quedó CONFIRMADA: " + String(cita.servicio ?? "corte") + ", " + cuando +
      ". Te esperamos en la barbería de Micro 10 💈 Si necesitas cambiarla, escríbenos por aquí."
    : "🙏 Tu cita del " + cuando + " no se pudo confirmar. ¿Te sirve otra hora? " +
      "La barbería abre de 9:00 a. m. a 6:00 p. m.: dime otro día y hora y te la anoto enseguida.";
  const avisoDueno = cita.canal === "telegram"
    ? "El cliente lo recibió al momento en su chat."
    : "El cliente lo verá en su próxima visita al chat de la página.";
  return {
    ok: true, cita, estadoNuevo, avisoTexto,
    textoDueno: (confirma ? "✅ Cita CONFIRMADA: " : "✖️ Cita RECHAZADA: ") +
                resumenCita(cita) + ". " + avisoDueno,
  };
}

/* =====================================================================
   v2.4 — CIERRE DE CITAS Y DINERO DEL DUEÑO (puro): la cita
   CONFIRMADA se cierra con [✅ Vino] / [🚫 No vino]; si vino, el pago
   se anota con método y monto — el monto se PRECARGA de la tarifa
   VIVA del catálogo (corte: «corte» en efectivo y «corte_transferencia»
   por transferencia; NADA hardcodeado: si Ernesto cambia su precio
   en Ajustes, la precarga cambia sola) con [✏️ Otro monto] por texto
   validado. La ESCRITURA va por UNA sola puerta SQL
   (`agente_cita_cerrar`, hermana de `agente_cita_decidir`); aquí
   viven la validación, los textos y los teclados. El RESUMEN de
   dinero se calcula de las filas cerradas, en vivo, jamás guardado
   aparte — y efectivo y transferencia se reportan SIEMPRE por
   separado: en el modelo de Ernesto no valen lo mismo. Esta capa es
   SOLO del dueño: el cliente no recibe ni ve nada de ella.
   ===================================================================== */
export function claveCatalogoCita(servicio, metodo) {
  const s = String(servicio ?? "corte");
  return metodo === "transferencia" ? s + "_transferencia" : s;
}
export function precioCita(datos, servicio, metodo) {
  const fila = datos?.catalogo?.get(claveCatalogoCita(servicio, metodo));
  const n = Number(fila?.precio);
  return Number.isFinite(n) && n > 0 ? n : null;
}
/* Los botones de cierre de UNA cita confirmada (en la vista «📋
   Citas» y en el mensaje que sigue a su confirmación). */
export function tecladoCierreCita(citaId) {
  return { inline_keyboard: [[
    { text: "✅ Vino", callback_data: "v2:k:vino:" + citaId },
    { text: "🚫 No vino", callback_data: "v2:k:no:" + citaId },
  ]] };
}
/* Al tocar [✅ Vino]: el pago se elige con el monto de SU tarifa ya
   puesto en el botón; [✏️ Otro monto] abre el flujo corto de texto. */
export function tecladoPagoCita(datos, cita) {
  const ef = precioCita(datos, cita?.servicio, "efectivo");
  const tr = precioCita(datos, cita?.servicio, "transferencia");
  return { inline_keyboard: [
    [{ text: "💵 Efectivo" + (ef ? " · " + fmtNum(ef) + " CUP" : ""),
       callback_data: "v2:k:pago:" + cita.id + ":ef" },
     { text: "📲 Transferencia" + (tr ? " · " + fmtNum(tr) + " CUP" : ""),
       callback_data: "v2:k:pago:" + cita.id + ":tr" }],
    [{ text: "✏️ Otro monto", callback_data: "v2:k:otro:" + cita.id },
     { text: "✖️ Ahora no", callback_data: "v2:d:citas" }],
  ] };
}
/* La vista «📋 Citas» COMPLETA: pendientes por decidir (v2.3) y
   confirmadas por cerrar (v2.4), cada una con SUS botones. */
export function textoCitasGestion(pendientes, confirmadas) {
  const p = pendientes ?? [], c = confirmadas ?? [];
  if (!p.length && !c.length) {
    return "📋 No tienes citas por atender ✨\nCuando un cliente pida una, te llega " +
           "el aviso aquí mismo, con botones pa decidirla y, al pasar, pa cerrarla.";
  }
  let t = "📋 Citas";
  if (p.length) {
    t += "\n\n⏳ PENDIENTES (" + p.length + ") — decídela con ✅ o ✖️ 👇\n" +
         p.map((x) => "• " + resumenCita(x)).join("\n");
  }
  if (c.length) {
    t += "\n\n✅ CONFIRMADAS (" + c.length + ") — al pasar, ciérrala: ✅ Vino o 🚫 No vino 👇\n" +
         c.map((x) => "• " + resumenCita(x)).join("\n");
  }
  return t;
}
export function tecladoCitasGestion(pendientes, confirmadas) {
  const filas = [];
  for (const c of (pendientes ?? []).slice(0, 6)) {
    filas.push([
      { text: "✅ " + String(c.nombre ?? "cita").slice(0, 18), callback_data: "v2:c:ok:" + c.id },
      { text: "✖️", callback_data: "v2:c:no:" + c.id },
    ]);
  }
  for (const c of (confirmadas ?? []).slice(0, 6)) {
    filas.push([
      { text: "✅ Vino · " + String(c.nombre ?? "cita").slice(0, 14), callback_data: "v2:k:vino:" + c.id },
      { text: "🚫 No vino", callback_data: "v2:k:no:" + c.id },
    ]);
  }
  filas.push([
    { text: "💰 Dinero de citas", callback_data: "v2:d:dinero" },
    { text: "⚙️ Ajustes", callback_data: "v2:d:menu" },
    { text: "🏠 Inicio", callback_data: "v2:p:inicio" },
  ]);
  return { inline_keyboard: filas };
}
/* El cierre sobre UNA cita confirmada sin cerrar: valida contra la
   foto de datos y compone el texto del dueño. La puerta (index.ts)
   RELEE la fila y ejecuta por `agente_cita_cerrar`. */
export function cierreCita(datos, citaId, cierre) {
  const cita = (datos?.citasConfirmadas ?? []).find((c) => String(c.id) === String(citaId));
  if (!cita) return { ok: false, motivo: "no_confirmada" };
  if (!cierre?.vino) {
    return { ok: true, cita, vino: false,
             textoDueno: "🚫 Cita CERRADA: " + resumenCita(cita) + " — no vino, sin pago." };
  }
  const monto = Number(cierre.monto);
  if (!Number.isFinite(monto) || monto <= 0 || monto > 1000000) {
    return { ok: false, motivo: "monto_invalido" };
  }
  if (cierre.metodo !== "efectivo" && cierre.metodo !== "transferencia") {
    return { ok: false, motivo: "metodo_invalido" };
  }
  return { ok: true, cita, vino: true, monto, metodo: cierre.metodo,
           textoDueno: "💰 Cita CERRADA: " + resumenCita(cita) + " — vino y pagó " +
                       fmtNum(monto) + " CUP por " + cierre.metodo + "." };
}
/* --- Resumen de dinero: HOY y SEMANA (lunes a hoy), de las filas
   cerradas. Se calcula al momento; la base no guarda totales. --- */
export function lunesDeSemana(hoyISO) {
  const d = new Date(String(hoyISO ?? "") + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return String(hoyISO ?? "");
  const delta = (d.getUTCDay() + 6) % 7; // lunes = 0
  return new Date(d.getTime() - delta * 86400000).toISOString().slice(0, 10);
}
export function resumenDineroCitas(citas, hoyISO) {
  const lunes = lunesDeSemana(hoyISO);
  const cerradas = (citas ?? []).filter((c) => c && c.asistencia);
  const agg = (lista) => {
    const r = { realizadas: 0, noVino: 0, efectivo: 0, transferencia: 0, total: 0, tasa: null };
    for (const c of lista) {
      if (c.asistencia === "vino") {
        r.realizadas++;
        const m = Number(c.pago_monto) || 0;
        if (c.pago_metodo === "efectivo") r.efectivo += m;
        else if (c.pago_metodo === "transferencia") r.transferencia += m;
      } else if (c.asistencia === "no_vino") r.noVino++;
    }
    r.total = r.efectivo + r.transferencia;
    const den = r.realizadas + r.noVino;
    if (den > 0) r.tasa = Math.round((r.realizadas / den) * 100);
    return r;
  };
  return {
    hoy: agg(cerradas.filter((c) => String(c.dia) === String(hoyISO))),
    semana: agg(cerradas.filter((c) => String(c.dia) >= lunes && String(c.dia) <= String(hoyISO))),
  };
}
function bloqueResumenDinero(titulo, r) {
  if (!r.realizadas && !r.noVino) return titulo + "\nSin citas cerradas todavía.";
  return titulo +
    "\n✅ Vinieron: " + r.realizadas + " · 🚫 No vinieron: " + r.noVino +
    "\n💵 Efectivo: " + fmtNum(r.efectivo) + " CUP" +
    "\n📲 Transferencia: " + fmtNum(r.transferencia) + " CUP" +
    "\n🧮 Total: " + fmtNum(r.total) + " CUP" +
    (r.tasa !== null ? "\n📊 Asistencia: " + r.tasa + " %" : "");
}
export function textoResumenDinero(resumen, hoyISO) {
  return "💰 Dinero de citas — calculado al momento de tus citas cerradas " +
         "(efectivo y transferencia por separado, como vale tu dinero).\n\n" +
         bloqueResumenDinero("📅 HOY · " + diaLegible(String(hoyISO ?? "")), resumen.hoy) + "\n\n" +
         bloqueResumenDinero("🗓️ ESTA SEMANA (desde el lunes)", resumen.semana);
}

/* =====================================================================
   ORQUESTADOR PURO — decide TODO con los datos ya leídos.
   datos: { config, catalogo:Map, fuente:Map, faqs, sinonimos, prohibidas }
   conv:  { escalada, flujo }
   Devuelve la decisión; la puerta hace el IO (guardar, avisar).
   ===================================================================== */
export const FRASE_NO_SE = "Eso no lo sé todavía 🙏 Queda anotado y se lo paso al dueño " +
  "del negocio. Mientras tanto, puedo ayudarte con precios, horario, ubicación o una cita.";
export const FRASE_ESCALADO = "Eso te lo confirma el dueño del negocio 🙏 Ya le paso tu mensaje.";
/* v2.1: el no-sé EN LA VISTA DEL DUEÑO — sin «paso al dueño» ni tercera
   persona sobre sí mismo, y jamás ensucia la cola de clientes. */
export const FRASE_NO_SE_DUENO = "Eso todavía no lo sé responder, ni siquiera en tu " +
  "vista de dueño 🙏 Si quieres que lo aprenda, escríbemelo como instrucción o " +
  "enséñamelo desde ⚙️ Ajustes.";

/* Saludos de la capa de comandos (v1.1): deterministas y sin cifras. */
export const SALUDO_CLIENTE = "¡Hola! 👋 Soy el asistente virtual del negocio de Ernesto.\n" +
  "Te ayudo con:\n" +
  "· 💈 Precios: el corte, la lavadora y las baterías\n" +
  "· 📱 Comprar saldo y a cómo se paga\n" +
  "· 🕘 Horario y ubicación\n" +
  "· 📋 Pedir una cita de barbería\n" +
  "Escríbeme lo que necesites o toca un botón 👇";
export const SALUDO_DUENO = "¡Hola, Ernesto! 👋 Te saludo por tu nombre porque escribes " +
  "desde tu cuenta de Telegram, la que quedó registrada como la del dueño.\n" +
  "Ojo: esto es la VISTA DE CLIENTE — por aquí no muestro nada interno, ni siquiera a ti. " +
  "A cualquier otra persona la atiendo solo con lo público: precios, horario, ubicación y citas.\n" +
  "Y con el botón ⚙️ Ajustes de este panel cambias TÚ el horario, el precio del corte " +
  "y las respuestas, y pausas o reanudas el agente — solo desde tu cuenta.\n" +
  "Pruébame como si fueras un cliente 👇";

/* Capa de comandos: /start jamás puede caer al matcher (v1.1, F1). */
export function detectarComando(crudo) {
  const primero = String(crudo ?? "").trim().split(/\s+/)[0] ?? "";
  if (!primero.startsWith("/")) return null;
  const c = primero.slice(1).split("@")[0].toLowerCase();
  if (c === "start") return "start";
  if (c === "ayuda" || c === "help") return "ayuda";
  if (c === "admin" || c === "ajustes" || c === "dueno") return "admin";
  if (c === "precios" || c === "horario" || c === "ubicacion" || c === "cita") return c;
  return null;
}

/* «¿Cómo sabes que soy Ernesto?»: se responde por diseño (v1.1, F3). */
export function esPreguntaIdentidad(ligero) {
  const t = " " + String(ligero ?? "") + " ";
  return t.includes(" como sabes que soy ") || t.includes(" como sabes quien soy ") ||
         t.includes(" no un cliente cualquiera ") || t.includes(" sabes quien soy ") ||
         t.includes(" como me reconoces ") || t.includes(" como sabes que soy yo ");
}
/* v2.1 — Instrucción del DUEÑO en texto libre: un pedido SOBRE el
   propio bot o el negocio (cómo responde, formato, emojis, clientes),
   no una pregunta de cliente. CONSERVADORA: exige arranque de pedido
   («puedes empezar a…», «quiero que…», «a partir de ahora») más una
   referencia meta, o autodeclaración de admin/dueño más pedido. Una
   pregunta normal de FAQ del dueño («¿cuál es el horario?») NO casa. */
export function esInstruccionDueno(ligero, crudo) {
  const t = " " + String(ligero ?? "") + " ";
  const meta = /(emojis?|formato|respuestas?|clientes?|tono|estilo|al responder|tus respuestas|como respondes)/.test(t);
  const arranque = /(puedes empezar a|puedes comenzar a|empieza a|comienza a|quiero que|necesito que|te pido que|a partir de ahora|desde ahora)/.test(t);
  if (arranque && meta) return true;
  const autodecl = /(soy el admin|soy el administrador|soy el dueno|soy tu dueno|soy ernesto)/.test(t);
  if (autodecl && (arranque || /(puedes|quiero|empieza|comienza|compruebalo)/.test(t))) return true;
  if (/(^| )(usa|utiliza|agrega|anade|ponle|responde)( |$)/.test(t) && meta &&
      /(clientes|respuestas|responder)/.test(t)) return true;
  return false;
}

/* v2.1 — Pedido de PIN/mapa: verbo de envío + (localización |
   ubicación | pin | mapa), o pedido explícito de pin/mapa. NO casa
   la FAQ normal de ubicación («¿dónde estás ubicado?»: sin verbo de
   envío, sin «pin»/«mapa» y con «ubicado», no «ubicación»). */
export function esPedidoPin(ligero) {
  const t = String(ligero ?? "");
  const envio = /\b(manda\w*|envia\w*|pasa\w*|comparte\w*)\b[^]*\b(localizacion|ubicacion|pin|mapa)\b/.test(t);
  if (envio) return true;
  const explicito = /\b(quiero|necesito|dame|pasame|mandame|enviame|muestrame|ensename|ver)\b[^]*\b(pin|mapa)\b/.test(t) ||
                    /\b(el|tu|su|un) pin\b/.test(t) ||
                    /\bpin de (la |el )?(ubicacion|local|negocio|barberia)\b/.test(t);
  return explicito;
}

/* v2.2 — La decisión del PIN como pieza reutilizable: la usa
   orquestar (pedido directo) y la puerta (seguimiento: afirmación
   corta con el pin pendiente, o promesa vetada del cerebro). La
   respuesta es el render de ubicación de siempre; las coords salen
   de la config (negocio_lat/negocio_lng): en Telegram viaja el pin,
   en web el enlace al mapa. Sin coords: ubicación normal, sin más. */
export function decisionUbicacionPin(datos, conv, norm) {
  const r = renderDato("ubicacion", datos);
  if (!r) return null;
  const ver = verificarCifras(r.texto, r.fuentes, datos.prohibidas, r.extra ?? []);
  if (!ver.ok) return null;
  const lat = Number(datos.config?.negocio_lat), lng = Number(datos.config?.negocio_lng);
  const hayCoords = datos.config?.negocio_lat != null && datos.config?.negocio_lng != null &&
                    Number.isFinite(lat) && Number.isFinite(lng);
  const dec = { norm, registrar_sin_respuesta: false, escalar: null, aviso_lead: false,
                accion: "ubicacion_pin", respuesta: r.texto,
                auditoria: { pin: hayCoords } };
  if (hayCoords) {
    if (conv?.canal === "web") {
      dec.respuesta = r.texto + "\n📍 Ver en el mapa: https://www.google.com/maps?q=" +
                      lat + "," + lng;
    } else {
      dec.pin = { lat, lng };
    }
  }
  return dec;
}

/* v2.2 — Afirmación corta («Si», «?», «dale»): no es una pregunta
   nueva; es el «sí» a lo que el agente acababa de ofrecer. */
export function esAfirmacionCorta(crudo) {
  const raw = String(crudo ?? "").trim();
  if (!raw) return false;
  if (/^[?¿!¡.\s]+$/.test(raw)) return true;
  const t = normalizarLigero(raw);
  if (!t || t.length > 22) return false;
  return /^(si|sip|sii+|ok|okey|dale|claro|va|bueno|bien|listo|de acuerdo|esa|eso|hazlo|mandala|mandalo|enviamela|pasamela|si por favor|por favor|si dale|dale si)$/.test(t);
}

/* v2.2 — ¿Quedó un PIN pendiente en la conversación? Dos señales:
   (A) el último mensaje del agente OFRECE/PROMETE mandar la
   localización (la promesa no ejecuta nada: queda pendiente);
   (B) el último mensaje del cliente PIDE el pin y después no llegó
   la entrega (la entrega es el render que empieza con «📍»).
   historial: [{rol, texto}] en orden, SIN el mensaje actual. */
export function hayPinPendienteEnHistorial(historial) {
  const h = (historial ?? []).slice(-6);
  const lig = (m) => normalizarLigero(m?.texto ?? "");
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].rol !== "agente") continue;
    const t = lig(h[i]);
    if (/(localizacion|ubicacion)/.test(t) &&
        /(puedo mandarte|te la mando|te mando|mandarte|te la envio|te envio|te la paso)/.test(t)) return true;
    break;
  }
  let idxCliente = -1;
  for (let i = h.length - 1; i >= 0; i--) {
    if (h[i].rol === "cliente") { idxCliente = i; break; }
  }
  if (idxCliente >= 0 && esPedidoPin(lig(h[idxCliente]))) {
    const entregado = h.slice(idxCliente + 1).some((m) => m.rol === "agente" &&
      String(m.texto ?? "").trimStart().startsWith("📍") && /micro 10/.test(lig(m)));
    if (!entregado) return true;
  }
  return false;
}

export function orquestar(datos, conv, textoCrudo, hoyISO) {
  const crudo = String(textoCrudo ?? "");
  const norm = normalizar(crudo);
  const ligero = normalizarLigero(crudo);
  const base = { norm, registrar_sin_respuesta: false, escalar: null, aviso_lead: false };

  // E6 (completada en la reverificación de la tanda Nº4+5): el silencio
  // por escalado ata a CLIENTES; el dueño jamás queda mudo en su propio
  // bot — su /admin y su panel tienen que responder siempre.
  if (conv?.escalada && !datos.esDueno) return { ...base, accion: "silencio", motivo: "ya_escalada" };

  // ── v2: pausa, panel y modo dueño ────────────────────────────────
  // Agente pausado: la puerta solo deja pasar al dueño (Telegram);
  // para él, todo cae al panel de ajustes (la reanudación vive ahí).
  if (datos.pausado && datos.esDueno &&
      conv?.flujo?.tipo !== "dueno" && !crudo.startsWith("/dueno") &&
      !crudo.startsWith("/citadec") && !crudo.startsWith("/citacierre") &&
      !crudo.startsWith("/citapago") && !crudo.startsWith("/citaotro") &&
      !crudo.startsWith("/citamet") &&
      detectarComando(crudo) !== "admin") {
    return { ...base, accion: "dueno", panel: { vista: "dueno" },
             respuesta: "⏸ El agente está pausado: tus clientes no reciben respuesta.",
             auditoria: { pausado: true } };
  }
  // «/panel <vista>»: navegación del panel único (callbacks de Telegram).
  if (crudo.startsWith("/panel")) {
    const vista = crudo.split(/\s+/)[1] ?? "inicio";
    if (["inicio", "barberia", "saldo", "lavadora", "bateria", "cita", "otra", "dueno"].includes(vista)) {
      if (vista === "dueno" && !datos.esDueno) {
        return { ...base, accion: "no_se", respuesta: FRASE_NO_SE };
      }
      return { ...base, accion: "panel", panel: { vista }, flujo: null,
               auditoria: { panel: vista } };
    }
  }
  // «/dueno <acción>»: callbacks del modo dueño; SOLO su cuenta.
  if (crudo.startsWith("/dueno")) {
    if (!datos.esDueno) return { ...base, accion: "no_se", respuesta: FRASE_NO_SE };
    return duenoAccion(datos, conv, crudo.split(/\s+/)[1] ?? "menu", { ...base, hoyISO });
  }

  // v2.3 — «/citadec ok|no <id>»: decisión de una cita desde los
  // botones (el aviso nuevo o la vista de Ajustes). SOLO su cuenta;
  // aquí solo se valida y se compone: la puerta ejecuta la decisión
  // por la puerta SQL `agente_cita_decidir` (la misma del bot de
  // gestión) y entrega el aviso al cliente por su canal.
  if (crudo.startsWith("/citadec")) {
    // OJO: jamás «no_se» aquí — un no_se cae a la capa conversacional
    // y el cerebro podría IMPROVISAR un «tu cita está confirmada»
    // (visto en el humo vivo del despliegue v2.3). La negativa a un
    // comando de decisión es determinista y final: «denegar».
    if (!datos.esDueno) {
      return { ...base, accion: "denegar", registrar_sin_respuesta: true,
               respuesta: "Eso no lo puedo hacer: las citas las decide el dueño del negocio. " +
                          "Si quieres una cita, pídela y él la confirma." };
    }
    const [, dec, id] = crudo.split(/\s+/);
    if ((dec !== "ok" && dec !== "no") || !id) {
      return { ...base, accion: "dueno", panel: { vista: "dueno" }, flujo: null,
               respuesta: "Ese botón de cita ya no vale; abre 📋 Citas en Ajustes.",
               auditoria: { dueno: "citadec_invalida" } };
    }
    return { ...base, accion: "cita_decision", citaDecision: { id, decision: dec },
             respuesta: "Decidiendo la cita…",
             auditoria: { dueno: "citadec", decision: dec } };
  }

  // v2.4 — CIERRE de citas («/citacierre vino|novino <id>»,
  // «/citapago <id> ef|tr», «/citaotro <id>», «/citamet ef|tr»):
  // capa SOLO del dueño — un no-dueño recibe «denegar» determinista,
  // jamás la capa conversacional (misma lección que /citadec: el
  // cerebro no puede improvisar un «ya cobré»). Aquí se valida y se
  // compone; la ESCRITURA la ejecuta la puerta por la RPC
  // `agente_cita_cerrar`, releyendo la fila. El cliente no recibe
  // NADA de esta capa: es control interno del negocio.
  if (crudo.startsWith("/citacierre") || crudo.startsWith("/citapago") ||
      crudo.startsWith("/citaotro") || crudo.startsWith("/citamet")) {
    if (!datos.esDueno) {
      return { ...base, accion: "denegar", registrar_sin_respuesta: true,
               respuesta: "Eso no lo puedo hacer: el cierre y el dinero de las citas " +
                          "los maneja el dueño del negocio." };
    }
    const botonViejo = { ...base, accion: "dueno", panel: { vista: "dueno" }, flujo: null,
                         respuesta: "Ese botón ya no vale; abre 📋 Citas en Ajustes.",
                         auditoria: { dueno: "cierre_invalido" } };
    const partes = crudo.split(/\s+/);
    const buscarConf = (id) => (datos.citasConfirmadas ?? [])
      .find((c) => String(c.id) === String(id ?? ""));
    if (crudo.startsWith("/citamet")) {
      // el método del flujo «Otro monto»: solo vale con el flujo vivo
      const f = conv?.flujo;
      const met = partes[1] === "tr" ? "transferencia"
                : partes[1] === "ef" ? "efectivo" : null;
      if (!met || f?.tipo !== "dueno" || f?.paso !== "cierre_metodo" || !f?.datos?.citaId) {
        return botonViejo;
      }
      return { ...base, accion: "cita_cierre", flujo: null,
               citaCierre: { id: f.datos.citaId, vino: true, metodo: met, monto: f.datos.monto },
               respuesta: "Cerrando la cita…",
               auditoria: { dueno: "cita_cierre", via: "otro_monto" } };
    }
    if (crudo.startsWith("/citacierre")) {
      const modo = partes[1], id = partes[2];
      const cita = buscarConf(id);
      if (!cita || (modo !== "vino" && modo !== "novino")) return botonViejo;
      if (modo === "novino") {
        return { ...base, accion: "cita_cierre", flujo: null,
                 citaCierre: { id, vino: false },
                 respuesta: "Cerrando la cita…",
                 auditoria: { dueno: "cita_cierre", vino: false } };
      }
      const txt = "✅ " + resumenCita(cita) + "\nVino ✔️ ¿Cómo pagó?";
      return { ...base, accion: "dueno", flujo: null,
               panel: panelFlujo(txt, tecladoPagoCita(datos, cita)),
               respuesta: txt, auditoria: { dueno: "cita_pago_pedir" } };
    }
    if (crudo.startsWith("/citapago")) {
      const id = partes[1];
      const met = partes[2] === "tr" ? "transferencia"
                : partes[2] === "ef" ? "efectivo" : null;
      const cita = buscarConf(id);
      if (!cita || !met) return botonViejo;
      const monto = precioCita(datos, cita.servicio, met);
      if (monto === null) {
        return { ...base, accion: "dueno", panel: { vista: "dueno" }, flujo: null,
                 respuesta: "No tengo precio precargado pa ese servicio y método: " +
                            "cierra la cita con ✏️ Otro monto.",
                 auditoria: { dueno: "cita_sin_precio" } };
      }
      return { ...base, accion: "cita_cierre", flujo: null,
               citaCierre: { id, vino: true, metodo: met, monto },
               respuesta: "Cerrando la cita…",
               auditoria: { dueno: "cita_cierre", via: "precargado", metodo: met } };
    }
    // «/citaotro <id>»: abre el flujo corto del monto por texto
    const cita = buscarConf(partes[1]);
    if (!cita) return botonViejo;
    const txt = "✏️ " + resumenCita(cita) +
                "\nEscribe el monto que pagó (solo el número, en CUP).";
    return { ...base, accion: "dueno",
             flujo: { tipo: "dueno", paso: "cierre_monto", datos: { citaId: String(cita.id) } },
             panel: panelFlujo(txt, TECLADO_CANCELAR),
             respuesta: txt, auditoria: { dueno: "cita_otro_monto" } };
  }

  // CAPA DE COMANDOS (v1.1, F1): determinista, ANTES del matcher y de
  // los flujos. /start jamás puede caer al «no sé».
  const comando = detectarComando(crudo);
  if (comando) {
    if (comando === "admin") {
      if (!datos.esDueno) return { ...base, accion: "no_se", respuesta: FRASE_NO_SE };
      return { ...base, accion: "dueno", comando, panel: { vista: "dueno" }, flujo: null,
               respuesta: "⚙️ Ajustes del negocio — solo tú ves esto.",
               auditoria: { comando } };
    }
    if (comando === "cita") {
      const flujo = inicioCita(null, crudo, hoyISO, { canal: conv?.canal ?? null, datos });
      return {
        ...base, accion: "cita_paso", flujo,
        respuesta: "¡Claro! Te anoto la solicitud de cita 📋 ¿A nombre de quién la pongo?",
      };
    }
    if (comando === "start" || comando === "ayuda") {
      return {
        ...base, accion: "comando", comando, flujo: null, botones: true,
        panel: { vista: "inicio", conSaludo: true },
        respuesta: datos.esDueno ? SALUDO_DUENO : SALUDO_CLIENTE,
        auditoria: { comando },
      };
    }
    if (comando === "precios") {
      // v2: NADA de volcado — menú de temas (panel en Telegram, chips
      // en la web). Cada dato se pide por su tema, corto y limpio.
      return { ...base, accion: "comando", comando, flujo: { tipo: "menu" },
               panel: { vista: "inicio" },
               respuesta: TEXTO_MENU, opciones: OPCIONES_TEMAS,
               auditoria: { comando } };
    }
    const r = renderDato(comando === "horario" ? "horario" : "ubicacion", datos);
    if (!r) return { ...base, accion: "no_se", respuesta: FRASE_NO_SE, registrar_sin_respuesta: true };
    const ver = verificarCifras(r.texto, r.fuentes, datos.prohibidas, r.extra ?? []);
    if (!ver.ok) return { ...base, accion: "no_se", respuesta: FRASE_NO_SE, registrar_sin_respuesta: true };
    return { ...base, accion: "comando", comando, flujo: null, botones: true,
             respuesta: r.texto, auditoria: { comando } };
  }

  // flujo del MODO DUEÑO en curso (solo su cuenta): los pasos de
  // texto (horas, números, textos dictados) se resuelven aquí.
  if (datos.esDueno && conv?.flujo?.tipo === "dueno") {
    return duenoPaso(datos, conv, crudo, base);
  }

  // flujo de cita en curso manda sobre el matcher
  if (conv?.flujo?.tipo === "cita") {
    const r = flujoCitaPaso(conv.flujo, crudo, hoyISO, datos);
    if (r.cancelada) {
      // E7: salida por texto (cancelar / pedir humano / datos) — el
      // flujo muere aquí; pedir humano escala como fuera del flujo.
      if (r.escalar === "humano") {
        return { ...base, accion: "escalar", escalar: "humano", flujo: null,
                 respuesta: r.respuesta, registrar_sin_respuesta: true };
      }
      if (r.escalar === "datos") {
        return { ...base, accion: "denegar", flujo: null, respuesta: r.respuesta,
                 registrar_sin_respuesta: true };
      }
      return { ...base, accion: "cita_cancelada", flujo: null, respuesta: r.respuesta };
    }
    if (r.completa) {
      return {
        ...base, accion: "cita_completa", cita: r.datos,
        respuesta: "Listo, " + r.datos.nombre + " ✅ Tu solicitud de cita quedó anotada: " +
          (r.datos.servicio ?? "corte") + ", " + diaLegible(r.datos.dia) + " a las " +
          r.datos.hora + ". OJO: es una SOLICITUD — Ernesto te la confirma en persona" +
          (r.datos.contacto ? " por tu contacto (" + r.datos.contacto + ")" : " por aquí") + ".",
      };
    }
    return { ...base, accion: "cita_paso", flujo: r.flujo, respuesta: r.respuesta };
  }

  // menú de temas abierto (web / texto libre): un número o el nombre
  // del tema abre SU sección; cualquier otra cosa sigue el flujo normal
  // (la puerta limpia el menú si la decisión no lo redefine).
  if (conv?.flujo?.tipo === "menu") {
    const vista = vistaDesdeMenu(crudo);
    if (vista) {
      if (vista === "cita") {
        const flujo = inicioCita(null, crudo, hoyISO, { canal: conv?.canal ?? null, datos });
        return { ...base, accion: "cita_paso", flujo,
                 respuesta: "¡Claro! Te anoto la solicitud de cita 📋 ¿A nombre de quién la pongo?" };
      }
      const s = componerSeccion(vista, datos);
      if (s) {
        const ver = verificarCifras(s.texto, s.fuentes, datos.prohibidas, s.extra ?? []);
        if (ver.ok) {
          return { ...base, accion: "menu", respuesta: s.texto,
                   opciones: OPCIONES_TEMAS, flujo: { tipo: "menu" },
                   panel: { vista }, auditoria: { menu: vista } };
        }
      }
    }
  }

  // saludo puro (la normalización deja la forma vacía)
  const esSaludo = norm === "" && /hola|buenas|saludos/i.test(quitarAcentos(crudo));
  if (esSaludo) {
    const f = (datos.faqs ?? []).find((x) => x.intencion === "saludo" && x.respuesta_tipo === "texto");
    if (f) {
      // E4 (Inspector Ola 1, 2026-11-12): el saludo es una respuesta
      // de TEXTO como cualquier otra — pasa por el MISMO verificador
      // con las mismas reglas de origen que la vía principal; si no
      // pasa, «no sé» + bloqueo del verificador, jamás el texto crudo.
      const verSal = verificarTextoFaq(f, datos);
      if (!verSal.ok) {
        return { ...base, accion: "bloqueada", respuesta: FRASE_NO_SE,
                 escalar: "verificador", faq_id: f.id,
                 auditoria: { saludo: true, verificador: verSal } };
      }
      return { ...base, accion: "responder", respuesta: f.respuesta_texto, faq_id: f.id,
               botones: true, auditoria: { saludo: true } };
    }
  }

  // Identidad (v1.1, F3): al dueño, la explicación de su cuenta
  // registrada; a un cliente, la identidad pública del asistente.
  if (esPreguntaIdentidad(ligero)) {
    if (datos.esDueno) {
      return {
        ...base, accion: "identidad", botones: true,
        respuesta: "Porque escribes desde la cuenta de Telegram que quedó " +
          "registrada como la del dueño del negocio 📱 Es la única manera en " +
          "que reconozco a Ernesto: por su cuenta, no por el nombre que " +
          "alguien se ponga. A cualquier otra persona la atiendo como " +
          "cliente, solo con la información pública.",
        auditoria: { identidad_dueno: true },
      };
    }
    const r = renderDato("identidad", datos);
    return { ...base, accion: "identidad", botones: true,
             respuesta: r?.texto ?? FRASE_NO_SE, auditoria: { identidad: true } };
  }

  // v2.1 — DUEÑO en texto libre (SOLO su cuenta; gated por esDueno,
  // no afecta a clientes): una instrucción SOBRE el bot no es una
  // pregunta de cliente — se acusa como instrucción suya y NO entra
  // en la cola de aprendizaje de clientes.
  if (datos.esDueno && esInstruccionDueno(ligero, crudo)) {
    const cita = crudo.trim().replace(/\s+/g, " ").slice(0, 120);
    return {
      ...base, accion: "instruccion_dueno", registrar_sin_respuesta: false,
      escalar: null,
      respuesta: "Anotado, Ernesto ✅ Lo tomo como instrucción tuya, no como " +
        "pregunta de cliente: «" + cita + "». Queda registrada como " +
        "instrucción tuya para revisarla y aplicarla.",
      auditoria: { instruccion_dueno: true },
    };
  }

  // v2.1 — PIN de ubicación: ANTES del matcher y del cerebro.
  if (esPedidoPin(ligero)) {
    const decPin = decisionUbicacionPin(datos, conv, norm);
    if (decPin) return decPin;
  }

  // reglas de hierro (sobre la forma ligera)
  const hierro = detectarHierro(ligero, crudo);
  if (hierro) {
    if (hierro.tipo === "datos") {
      return {
        ...base, accion: "denegar",
        respuesta: "Eso no lo puedo dar: son datos de otras personas. Si necesitas algo del negocio, pregúntame por precios, horarios o citas.",
        registrar_sin_respuesta: true,
      };
    }
    const frases = {
      humano: "Claro 🙏 Te paso con el dueño del negocio ahora mismo; en cuanto vea el mensaje te atiende él personalmente.",
      dinero: "Ese tema de dinero te lo confirma el dueño del negocio directamente 🙏 Te lo paso con él.",
      descuento: "Eso lo decide el dueño del negocio en persona 🙏 Yo no puedo hacer descuentos ni apartar nada; te lo paso con él.",
    };
    return {
      ...base, accion: "escalar", escalar: hierro.tipo,
      respuesta: frases[hierro.tipo] ?? FRASE_NO_SE,
      registrar_sin_respuesta: true,
    };
  }

  // intención de cita -> arranca el flujo estructurado
  const intenciones = [...new Set([
    ...detectarIntenciones(norm, datos.sinonimos),
    ...detectarIntencionesLigero(ligero),
  ])];
  if (intenciones.includes("cita") || /\b(quiero|necesito|reserv).*(turno|cita)\b/.test(norm)) {
    const flujo = inicioCita(null, crudo, hoyISO, { canal: conv?.canal ?? null, datos });
    return {
      ...base, accion: "cita_paso", flujo,
      respuesta: "¡Claro! Te anoto la solicitud de cita 📋 ¿A nombre de quién la pongo?",
    };
  }

  // «precios» a secas (sin producto): menú de temas, no volcado (v2).
  if (esPreciosGenerico(norm, ligero, datos)) {
    return { ...base, accion: "menu", flujo: { tipo: "menu" },
             panel: { vista: "inicio" }, respuesta: TEXTO_MENU,
             opciones: OPCIONES_TEMAS, auditoria: { menu: "generico" } };
  }

  // matcher multi-señal
  const marcador = puntuarCandidatas(norm, {
    faqs: datos.faqs, sinonimos: datos.sinonimos,
  }, ligero);
  const nivel = decidir(marcador, datos.config);
  const caliente = detectarCompraCaliente(ligero, crudo);

  if (nivel.nivel === "responder") {
    const f = nivel.top.faq;
    if (f.respuesta_tipo === "escalado") {
      return {
        ...base, accion: "escalar", escalar: "ensenado",
        respuesta: FRASE_ESCALADO,
        faq_id: f.id, auditoria: { senales: nivel.top.senales, puntaje: nivel.top.total },
      };
    }
    if (f.respuesta_tipo === "descartada") {
      return { ...base, accion: "responder", respuesta: FRASE_NO_SE, faq_id: f.id,
               auditoria: { senales: nivel.top.senales, puntaje: nivel.top.total } };
    }
    let texto, fuentes = [], extra = [];
    if (f.respuesta_tipo === "dato") {
      const r = renderDato(f.dato_clave, datos);
      if (!r) return datos.esDueno
        ? { ...base, accion: "no_se", respuesta: FRASE_NO_SE_DUENO, registrar_sin_respuesta: false, auditoria: { no_se_dueno: true } }
        : { ...base, accion: "no_se", respuesta: FRASE_NO_SE, registrar_sin_respuesta: true };
      texto = r.texto; fuentes = r.fuentes; extra = r.extra ?? [];
    } else {
      texto = f.respuesta_texto ?? FRASE_NO_SE;
      // Respuesta dictada por Ernesto y confirmada por él (flujo de
      // cifra «fija»): SUS cifras son su propia fuente. Las de la
      // lista PROHIBIDA siguen bloqueando igual (van primero).
      if (f.origen === "ernesto") extra = extraerCifras(texto);
    }
    const ver = verificarCifras(texto, fuentes, datos.prohibidas, extra);
    if (!ver.ok) {
      return {
        ...base, accion: "bloqueada", respuesta: FRASE_NO_SE,
        escalar: "verificador", faq_id: f.id,
        auditoria: { senales: nivel.top.senales, puntaje: nivel.top.total, verificador: ver },
      };
    }
    return {
      ...base, accion: "responder", respuesta: texto, faq_id: f.id,
      botones: ["precio_corte", "precio_lavadora", "precio_bateria", "tarifa_saldo",
                "horario", "ubicacion", "identidad"].includes(f.dato_clave ?? "") ||
               f.intencion === "capacidades",
      aviso_lead: caliente.caliente,
      auditoria: { senales: nivel.top.senales, puntaje: nivel.top.total,
                   fuentes: fuentes.map((x) => x.clave ?? x.id ?? "fuente"),
                   fuentes_detalle: fuentes.map((x) => ({ clave: x.clave ?? x.id ?? "fuente", actualizado_en: x.actualizado_en ?? null })),
                   verificador: { ok: true } },
    };
  }

  if (nivel.nivel === "aclarar" && nivel.segunda && nivel.segunda.total >= (datos.config?.umbral_aclarar ?? 45)) {
    const opciones = [nivel.top, nivel.segunda].map((c) => ({
      faq_id: c.faq.id, etiqueta: c.faq.pregunta,
    }));
    return {
      ...base, accion: "aclarar",
      respuesta: "Para no equivocarme 😅 ¿me preguntas por esto: " +
        opciones.map((o, i) => (i + 1) + ") " + o.etiqueta).join("  ·  ") + "?",
      opciones,
      flujo: { tipo: "aclarar", opciones: opciones.map((o) => o.faq_id) },
      auditoria: { senales: nivel.top.senales, puntaje: nivel.top.total },
    };
  }

  // v2.1: el no-sé del DUEÑO usa su frase propia y NO se registra
  // como pregunta de cliente (la acción sigue «no_se»: la puerta
  // puede componer con el cerebro; la frase de cliente jamás sale).
  if (datos.esDueno) {
    return { ...base, accion: "no_se", respuesta: FRASE_NO_SE_DUENO,
             registrar_sin_respuesta: false,
             auditoria: { puntaje: nivel.top?.total ?? 0, no_se_dueno: true } };
  }
  return { ...base, accion: "no_se", respuesta: FRASE_NO_SE, registrar_sin_respuesta: true,
           auditoria: { puntaje: nivel.top?.total ?? 0 } };
}

/* Resolución de una aclaración pendiente: el cliente responde con el
   número, la etiqueta o una frase que casa mejor con una opción. */
export function resolverAclaracion(flujo, textoCrudo, datos) {
  const ids = flujo?.opciones ?? [];
  const crudo = String(textoCrudo ?? "").trim();
  let elegida = null;
  if (/^[1-9]$/.test(crudo)) {
    elegida = ids[Number(crudo) - 1] ?? null;
  }
  if (!elegida) {
    const norm = normalizar(crudo);
    let mejor = -1;
    for (const id of ids) {
      const f = datos.faqs.find((x) => x.id === id);
      if (!f) continue;
      for (const p of f.patrones ?? []) {
        const s = Math.max(similitudTrgm(norm, p), jaccardTokens(norm, p));
        if (s > mejor) { mejor = s; elegida = id; }
      }
    }
    if (mejor < 0.3) elegida = null;
  }
  if (!elegida) return null;
  const f = datos.faqs.find((x) => x.id === elegida);
  if (!f) return null;
  if (f.respuesta_tipo === "dato") {
    const r = renderDato(f.dato_clave, datos);
    if (!r) return null;
    const ver = verificarCifras(r.texto, r.fuentes, datos.prohibidas, r.extra ?? []);
    if (!ver.ok) {
      // E4: si no pasa, «no sé» + bloqueo del verificador (como la
      // vía principal), jamás null pa que otro camino improvise.
      return { faq_id: f.id, respuesta: FRASE_NO_SE, accion: "bloqueada",
               escalar: "verificador", verificador: ver };
    }
    return { faq_id: f.id, respuesta: r.texto };
  }
  if (f.respuesta_tipo === "texto") {
    // E4 (Inspector Ola 1, 2026-11-12): esta rama devolvía el texto
    // CRUDO sin verificar — la sonda del auditor sacó la cifra
    // INTERNA 925 respondiendo «1» a la aclaración, aunque la
    // pregunta directa quedaba bloqueada. Ahora pasa por el MISMO
    // verificador, con las mismas reglas de origen que la vía
    // principal; si no pasa, «no sé» + bloqueo, jamás el texto.
    if (!f.respuesta_texto) return null;
    const ver = verificarTextoFaq(f, datos);
    if (!ver.ok) {
      return { faq_id: f.id, respuesta: FRASE_NO_SE, accion: "bloqueada",
               escalar: "verificador", verificador: ver };
    }
    return { faq_id: f.id, respuesta: f.respuesta_texto };
  }
  return null;
}

/* =====================================================================
   v2 — PANEL ÚNICO · MENÚ DE TEMAS · MODO DUEÑO · CEREBRO (validación)
   Orden de Ernesto (2026-11-12): nada de volcados «súper regados» —
   UN mensaje-panel que se edita a sí mismo, temas cortos y limpios;
   el dueño cambia horario/precio/respuestas y pausa/reanuda DESDE su
   chat con flujos estructurados y confirmación; y la capa
   conversacional (si un día hay cerebro) redacta SOLO sobre la
   proyección pública y pasa por el mismo verificador de cifras.
   ===================================================================== */
export const TEMAS = [
  { vista: "barberia", etiqueta: "💈 Barbería" },
  { vista: "saldo", etiqueta: "📱 Saldo" },
  { vista: "lavadora", etiqueta: "🧺 Lavadora" },
  { vista: "bateria", etiqueta: "🔋 Batería" },
  { vista: "cita", etiqueta: "📋 Pedir cita" },
  { vista: "otra", etiqueta: "💬 Otra cosa" },
];
export const TEXTO_MENU = "¿De qué quieres los precios? Toca un tema 👇";
export const OPCIONES_TEMAS = TEMAS.map((t) => ({ faq_id: "tema:" + t.vista, etiqueta: t.etiqueta }));

const FILA_NAV = [
  { text: "⬅️ Atrás", callback_data: "v2:p:inicio" },
  { text: "🏠 Inicio", callback_data: "v2:p:inicio" },
];
function tecladoTemas(datos) {
  const filas = [];
  for (let i = 0; i < TEMAS.length; i += 2) {
    filas.push(TEMAS.slice(i, i + 2).map((t) => ({ text: t.etiqueta, callback_data: "v2:p:" + t.vista })));
  }
  if (datos?.esDueno) filas.push([{ text: "⚙️ Ajustes", callback_data: "v2:d:menu" }]);
  return filas;
}

/* El texto de UNA sección, con sus fuentes (limpio, sin notas). */
export function componerSeccion(vista, datos) {
  const partes = [], fuentes = [], extra = [];
  const add = (dc) => {
    const r = renderDato(dc, datos);
    if (r) { partes.push(r.texto); fuentes.push(...r.fuentes); extra.push(...(r.extra ?? [])); }
  };
  switch (vista) {
    case "barberia": add("precio_corte"); add("horario"); break;
    case "saldo": add("tarifa_saldo"); break;
    case "lavadora": add("precio_lavadora"); add("stock_lavadora"); break;
    case "bateria": add("precio_bateria"); add("stock_bateria"); break;
    case "cita":
      return { texto: "📋 Cita de barbería: te la anoto como SOLICITUD y Ernesto la confirma en persona. Toca «Empezar» y te voy preguntando aquí mismo, en este mismo mensaje.", fuentes, extra };
    case "otra":
      return { texto: "💬 Cuéntame qué necesitas por escrito: precios, horario, ubicación o una cita te los respondo al momento. Cualquier otra cosa se la paso al dueño del negocio.", fuentes, extra };
    default: return null;
  }
  if (!partes.length) return null;
  return { texto: partes.join("\n"), fuentes, extra };
}

/* La vista del panel único: texto + teclado inline. La puerta la
   EDITA sobre el mismo mensaje (editMessageText); null = no sale. */
export function panelVista(vista, datos, conv = {}, opts = {}) {
  if (vista === "dueno") {
    if (!datos?.esDueno) return null;
    return { vista, texto: textoPanelDueno(datos, conv),
             teclado: { inline_keyboard: tecladoDueno(datos, conv) } };
  }
  if (vista === "inicio") {
    const texto = opts.conSaludo
      ? (datos?.esDueno ? SALUDO_DUENO : SALUDO_CLIENTE)
      : "¿Qué quieres ver? Toca un tema 👇";
    return { vista, texto, teclado: { inline_keyboard: tecladoTemas(datos) } };
  }
  const s = componerSeccion(vista, datos);
  if (!s) return null;
  const ver = verificarCifras(s.texto, s.fuentes, datos.prohibidas, s.extra ?? []);
  if (!ver.ok) return null;
  const filas = [];
  if (vista === "cita") filas.push([{ text: "📋 Empezar la cita", callback_data: "v2:p:citaflow" }]);
  else filas.push([{ text: "📋 Pedir cita", callback_data: "v2:p:cita" }]);
  filas.push(FILA_NAV);
  return { vista, texto: s.texto, teclado: { inline_keyboard: filas } };
}

/* El tema elegido en el menú (número de chip web o nombre). */
export function vistaDesdeMenu(crudo) {
  const t = String(crudo ?? "").trim();
  if (/^[1-6]$/.test(t)) return TEMAS[Number(t) - 1].vista;
  const lig = normalizarLigero(t);
  for (const tema of TEMAS) if (lig.includes(tema.vista)) return tema.vista;
  if (lig.includes("corte") || lig.includes("pelado")) return "barberia";
  return null;
}

/* «precios» sin producto = pregunta genérica: menú, no volcado. */
export function esPreciosGenerico(norm, ligero, datos) {
  const toks = tokensDe(norm);
  if (!toks.length || toks.length > 3) return false;
  if (detectarProductos(norm, datos.sinonimos).length) return false;
  const ints = new Set([...detectarIntenciones(norm, datos.sinonimos),
                        ...detectarIntencionesLigero(ligero)]);
  if (!ints.has("precio")) return false;
  return toks.every((t) => ["precio", "precios", "cuesta", "vale", "valor", "lista"].includes(t) ||
    destinoDeToken(t, datos.sinonimos, "intencion")?.destino === "precio");
}

/* --- Modo dueño: panel de ajustes y flujos estructurados ------------- */
const TECLADO_CANCELAR = { inline_keyboard: [[{ text: "✖️ Cancelar", callback_data: "v2:d:x" }]] };
const TECLADO_CONFIRMAR = { inline_keyboard: [
  [{ text: "✅ Aplicar el cambio", callback_data: "v2:d:ok" }],
  [{ text: "✖️ Cancelar", callback_data: "v2:d:x" }],
]};
function panelFlujo(texto, teclado) { return { texto, teclado }; }
function estadoAgente(datos) {
  return (datos.pausado || datos.config?.detenido)
    ? "⏸ PAUSADO — los clientes no reciben respuesta"
    : "▶️ Activo, respondiendo a los clientes";
}
function textoPanelDueno(datos, conv) {
  let t = "⚙️ Ajustes del negocio — solo tú ves esto.\nEstado: " + estadoAgente(datos) + ".";
  const u = conv?.dueno_ultimo;
  if (u?.resumen) t += "\nÚltimo cambio: " + u.resumen + " (puedes deshacerlo).";
  return t + "\nToca una opción 👇";
}
function tecladoDueno(datos, conv) {
  // v2.4: el conteo de «📋 Citas» suma lo accionable: pendientes por
  // decidir + confirmadas por cerrar.
  const nCitas = (datos?.citasPendientes ?? []).length +
                 (datos?.citasConfirmadas ?? []).length;
  const nPend = (datos?.pendientesSinRespuesta ?? []).length;
  const filas = [
    [{ text: "🕘 Cambiar horario", callback_data: "v2:d:horario" },
     { text: "💈 Precio del corte", callback_data: "v2:d:corte" }],
    [{ text: "📋 Citas" + (nCitas ? " (" + nCitas + ")" : ""), callback_data: "v2:d:citas" },
     { text: "📝 Editar una respuesta", callback_data: "v2:d:faq" }],
    [{ text: "❓ Enseñar respuesta" + (nPend ? " (" + nPend + ")" : ""), callback_data: "v2:d:ensenar" }],
    [{ text: "💰 Dinero de citas", callback_data: "v2:d:dinero" }],
    [(datos.pausado || datos.config?.detenido)
      ? { text: "▶️ Reanudar el agente", callback_data: "v2:d:reanudar" }
      : { text: "⏸ Pausar el agente", callback_data: "v2:d:pausar" }],
  ];
  if (conv?.dueno_ultimo) {
    filas.push([{ text: "↩️ Deshacer último cambio", callback_data: "v2:d:deshacer" }]);
  }
  filas.push([{ text: "🏠 Vista de cliente", callback_data: "v2:p:inicio" }]);
  return filas;
}
function faqsTexto(datos) {
  return (datos.faqs ?? []).filter((f) => f.estado === "activa" && f.respuesta_tipo === "texto");
}
function confirmarDueno(base, datosCambio, resumen) {
  return { ...base, accion: "dueno",
    flujo: { tipo: "dueno", paso: "confirmar", datos: datosCambio },
    panel: panelFlujo(resumen + "\n\n¿Lo aplico?", TECLADO_CONFIRMAR),
    respuesta: resumen, auditoria: { dueno: "confirmar" } };
}

/* Acciones del panel del dueño (callbacks «/dueno <acción>»). */
export function duenoAccion(datos, conv, accion, base) {
  switch (accion) {
    case "menu":
      return { ...base, accion: "dueno", panel: { vista: "dueno" }, flujo: null,
               respuesta: "⚙️ Ajustes del negocio — solo tú ves esto.",
               auditoria: { dueno: "menu" } };
    case "citas": {
      // v2.3: la vista de pendientes vive en Ajustes — un panel con
      // la lista y los botones de decisión por cita.
      // v2.4: la vista es la de GESTIÓN completa — pendientes por
      // decidir y confirmadas por cerrar, cada una con sus botones.
      const pend = datos.citasPendientes ?? [];
      const conf = datos.citasConfirmadas ?? [];
      const txt = textoCitasGestion(pend, conf);
      return { ...base, accion: "dueno", flujo: null,
        panel: panelFlujo(txt, tecladoCitasGestion(pend, conf)),
        respuesta: txt, auditoria: { dueno: "citas", pendientes: pend.length, confirmadas: conf.length } };
    }
    case "dinero": {
      // v2.4: el resumen de dinero se CALCULA de las citas cerradas
      // de la semana (la puerta las carga), jamás de un total guardado.
      const hoy = String(base?.hoyISO ?? "");
      const txt = textoResumenDinero(
        resumenDineroCitas(datos.citasCerradas ?? [], hoy), hoy);
      return { ...base, accion: "dueno", flujo: null,
        panel: panelFlujo(txt, { inline_keyboard: [[
          { text: "📋 Citas", callback_data: "v2:d:citas" },
          { text: "⚙️ Ajustes", callback_data: "v2:d:menu" },
        ]] }),
        respuesta: txt, auditoria: { dueno: "dinero" } };
    }
    case "horario": {
      const h = datos.fuente.get("horario_barberia")?.valor ?? {};
      const txt = "🕘 Nuevo horario (ahora: " + hora12(h.abre) + " – " + hora12(h.cierra) +
                  ", " + (h.dias ?? "") + ").\n¿A qué hora ABRE? Escríbelo así: 9:00";
      return { ...base, accion: "dueno",
        flujo: { tipo: "dueno", paso: "horario_abre", datos: {} },
        panel: panelFlujo(txt, TECLADO_CANCELAR), respuesta: txt,
        auditoria: { dueno: "horario" } };
    }
    case "corte": {
      const a = datos.catalogo.get("corte"), b = datos.catalogo.get("corte_transferencia");
      const txt = "💈 Precio del corte (ahora: " + fmtNum(a?.precio) + " CUP en efectivo y " +
                  fmtNum(b?.precio) + " por transferencia).\n¿Nuevo precio en EFECTIVO? Escribe solo el número.";
      return { ...base, accion: "dueno",
        flujo: { tipo: "dueno", paso: "corte_efectivo", datos: {} },
        panel: panelFlujo(txt, TECLADO_CANCELAR), respuesta: txt,
        auditoria: { dueno: "corte" } };
    }
    case "faq": {
      const lista = faqsTexto(datos);
      if (!lista.length) {
        return { ...base, accion: "dueno", panel: { vista: "dueno" },
                 respuesta: "Ahora mismo no hay respuestas de texto editables.",
                 auditoria: { dueno: "faq" } };
      }
      const txt = "📝 Respuestas que puedes editar:\n" +
        lista.map((f, i) => (i + 1) + ") " + f.pregunta).join("\n") +
        "\nRespóndeme con el NÚMERO de la que quieres cambiar.";
      return { ...base, accion: "dueno",
        flujo: { tipo: "dueno", paso: "faq_num", datos: { ids: lista.map((f) => f.id) } },
        panel: panelFlujo(txt, TECLADO_CANCELAR), respuesta: txt,
        auditoria: { dueno: "faq" } };
    }
    case "ensenar": {
      // F2 (Tanda Nº6): CREAR una respuesta NUEVA desde la cola de
      // «sin respuesta» — antes el bot solo EDITABA textos ya
      // existentes y la promesa «Ernesto enseña con un toque» no
      // tenía puerta en ESTE bot. La ejecución la hace la puerta por
      // la RPC agente_ensenar_responder (la misma escuela SQL).
      const pend = datos.pendientesSinRespuesta ?? [];
      if (!pend.length) {
        return { ...base, accion: "dueno", panel: { vista: "dueno" }, flujo: null,
                 respuesta: "❓ No hay preguntas sin respuesta en la cola: todo lo que preguntan los clientes ya tiene respuesta.",
                 auditoria: { dueno: "ensenar_vacio" } };
      }
      const txt = "❓ Preguntas de clientes SIN respuesta (toca el número y me dictas la respuesta; queda guardada y se usa desde ese momento):\n" +
        pend.map((g, i) => (i + 1) + ") «" + String(g.pregunta ?? "").slice(0, 90) + "»" +
          (Number(g.veces ?? 1) > 1 ? " (×" + g.veces + ")" : "")).join("\n") +
        "\nRespóndeme con el NÚMERO de la que quieres enseñar.";
      return { ...base, accion: "dueno",
        flujo: { tipo: "dueno", paso: "ensenar_num",
                 datos: { ids: pend.map((g) => g.id), preguntas: pend.map((g) => String(g.pregunta ?? "")) } },
        panel: panelFlujo(txt, TECLADO_CANCELAR), respuesta: txt,
        auditoria: { dueno: "ensenar", pendientes: pend.length } };
    }
    case "pausar":
      return confirmarDueno(base, { accion: "pausar" },
        "⏸ Pausar el agente: los clientes dejan de recibir respuesta (Telegram y web) hasta que lo reanudes desde aquí.");
    case "reanudar":
      return confirmarDueno(base, { accion: "reanudar" },
        "▶️ Reanudar el agente: vuelve a responder a los clientes al momento.");
    case "ok":
      return duenoConfirmar(datos, conv, base);
    case "x":
      return { ...base, accion: "dueno", flujo: null, panel: { vista: "dueno" },
               respuesta: "✖️ Cancelado: no toqué nada.", auditoria: { dueno: "cancelar" } };
    case "deshacer": {
      const u = conv?.dueno_ultimo;
      if (!u?.parches?.length) {
        return { ...base, accion: "dueno", panel: { vista: "dueno" },
                 respuesta: "No hay ningún cambio reciente que deshacer.",
                 auditoria: { dueno: "deshacer_vacio" } };
      }
      return { ...base, accion: "dueno", flujo: null, panel: { vista: "dueno" },
        cambio: { etiqueta: "deshacer", resumen: "Deshecho: " + (u.resumen ?? "último cambio"),
                  parches: u.parches, esDeshacer: true },
        respuesta: "↩️ Deshecho: " + (u.resumen ?? "el último cambio") + ". Quedó como estaba.",
        auditoria: { dueno: "deshacer" } };
    }
    default:
      return { ...base, accion: "dueno", panel: { vista: "dueno" }, flujo: null,
               respuesta: "⚙️ Ajustes del negocio — solo tú ves esto.",
               auditoria: { dueno: "menu" } };
  }
}

/* Confirmación (✅): construye el CAMBIO validado; la puerta lo aplica
   contra la base y guarda el inverso para «Deshacer». */
export function duenoConfirmar(datos, conv, base) {
  const f = conv?.flujo;
  const sinPendiente = { ...base, accion: "dueno", panel: { vista: "dueno" },
    respuesta: "No hay ningún cambio esperando confirmación.", auditoria: { dueno: "ok_vacio" } };
  if (f?.tipo !== "dueno" || f.paso !== "confirmar") return sinPendiente;
  const d = f.datos ?? {};
  const hecho = (cambio, resumen) => ({ ...base, accion: "dueno", flujo: null,
    panel: { vista: "dueno" }, cambio, respuesta: "✅ " + resumen,
    auditoria: { dueno: "aplicar", etiqueta: cambio.etiqueta } });
  if (d.accion === "horario") {
    const antes = datos.fuente.get("horario_barberia")?.valor ?? {};
    const nuevo = { abre: d.abre, cierra: d.cierra, dias: d.dias };
    return hecho({ etiqueta: "horario",
      resumen: "Horario: " + hora12(antes.abre) + "–" + hora12(antes.cierra) + " → " +
               hora12(nuevo.abre) + "–" + hora12(nuevo.cierra) + " (" + nuevo.dias + ")",
      parches: [{ tabla: "agente_fuente", filtro: "clave=eq.horario_barberia",
                  parche: { valor: nuevo }, deshacer: { valor: antes } }] },
      "Horario actualizado: abre " + hora12(nuevo.abre) + ", cierra " + hora12(nuevo.cierra) + ", " + nuevo.dias + ".");
  }
  if (d.accion === "corte") {
    const a = datos.catalogo.get("corte"), b = datos.catalogo.get("corte_transferencia");
    const parches = [{ tabla: "agente_catalogo", filtro: "clave=eq.corte",
      parche: { precio: d.efectivo }, deshacer: { precio: a?.precio ?? null } }];
    if (b) parches.push({ tabla: "agente_catalogo", filtro: "clave=eq.corte_transferencia",
      parche: { precio: d.transferencia }, deshacer: { precio: b?.precio ?? null } });
    return hecho({ etiqueta: "precio_corte",
      resumen: "Precio del corte: " + fmtNum(a?.precio) + "/" + fmtNum(b?.precio) + " → " +
               fmtNum(d.efectivo) + "/" + fmtNum(d.transferencia) + " CUP",
      parches },
      "Precio del corte actualizado: " + fmtNum(d.efectivo) + " CUP en efectivo y " + fmtNum(d.transferencia) + " por transferencia.");
  }
  if (d.accion === "faq") {
    const faq = (datos.faqs ?? []).find((x) => x.id === d.faqId);
    return hecho({ etiqueta: "faq",
      resumen: "Respuesta de «" + (faq?.pregunta ?? "FAQ") + "» editada",
      parches: [{ tabla: "agente_faq", filtro: "id=eq." + d.faqId,
                  parche: { respuesta_texto: d.texto },
                  deshacer: { respuesta_texto: faq?.respuesta_texto ?? null } }] },
      "Respuesta actualizada: «" + (faq?.pregunta ?? "") + "» ya dice el texto nuevo.");
  }
  if (d.accion === "ensenar") {
    // F2: no es un «cambio» de parches — es una CREACIÓN por la RPC
    // de la escuela; la puerta la ejecuta y compone la respuesta
    // final según lo que la RPC devuelva (activa / borrador).
    return { ...base, accion: "dueno_ensenar", flujo: null,
      ensenar: { grupoId: d.grupoId, texto: d.texto },
      respuesta: "Guardando la respuesta nueva…",
      auditoria: { dueno: "ensenar_aplicar", grupo: d.grupoId } };
  }
  if (d.accion === "pausar") {
    return hecho({ etiqueta: "pausa", resumen: "Agente pausado",
      parches: [{ tabla: "agente_config", filtro: "id=eq.1",
                  parche: { detenido: true }, deshacer: { detenido: false } }] },
      "Agente PAUSADO ⏸ Los clientes no reciben respuesta hasta que lo reanudes.");
  }
  if (d.accion === "reanudar") {
    return hecho({ etiqueta: "reanudar", resumen: "Agente reanudado",
      parches: [{ tabla: "agente_config", filtro: "id=eq.1",
                  parche: { detenido: false, pausa_telegram: false, pausa_web: false },
                  deshacer: { detenido: true } }] },
      "Agente ACTIVO ▶️ Ya responde a los clientes otra vez.");
  }
  return sinPendiente;
}

/* Pasos de TEXTO del modo dueño (horas, números, textos dictados). */
function horaValida(txt) {
  const m = String(txt ?? "").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]), mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return String(hh).padStart(2, "0") + ":" + m[2];
}
function numeroDe(txt) {
  const c = extraerCifras(txt)[0];
  if (c === undefined) return null;
  const n = Number(c);
  return Number.isFinite(n) && n > 0 && n <= 1000000 ? n : null;
}
export function duenoPaso(datos, conv, crudo, base) {
  const f = conv?.flujo ?? {};
  const d = { ...(f.datos ?? {}) };
  const seguir = (paso, datosFlujo, texto) => ({ ...base, accion: "dueno",
    flujo: { tipo: "dueno", paso, datos: datosFlujo },
    panel: panelFlujo(texto, TECLADO_CANCELAR), respuesta: texto,
    auditoria: { dueno: paso } });
  switch (f.paso) {
    case "horario_abre": {
      const h = horaValida(crudo);
      if (!h) return seguir("horario_abre", d, "No te entendí la hora 😅 Escríbela así: 9:00 (hora:minutos).");
      d.abre = h;
      return seguir("horario_cierra", d, "Abre a las " + hora12(h) + ". ¿A qué hora CIERRA?");
    }
    case "horario_cierra": {
      const h = horaValida(crudo);
      if (!h) return seguir("horario_cierra", d, "No te entendí la hora 😅 Escríbela así: 18:00.");
      d.cierra = h;
      const actual = datos.fuente.get("horario_barberia")?.valor?.dias ?? "todos los días";
      return seguir("horario_dias", d, "Cierra a las " + hora12(h) + ". ¿Los días? Escribe por ejemplo «todos los días» o «de lunes a sábado» — o escribe «igual» para dejar «" + actual + "».");
    }
    case "horario_dias": {
      const actual = datos.fuente.get("horario_barberia")?.valor ?? {};
      d.dias = normalizarLigero(crudo) === "igual" ? (actual.dias ?? "todos los días")
                                                    : String(crudo ?? "").trim().slice(0, 80);
      if (!d.dias) return seguir("horario_dias", d, "Escribe los días o «igual».");
      return confirmarDueno(base, { accion: "horario", ...d },
        "🕘 Nuevo horario:\nAbre " + hora12(d.abre) + " · cierra " + hora12(d.cierra) + " · " + d.dias +
        "\n(Ahora es: abre " + hora12(actual.abre) + " · cierra " + hora12(actual.cierra) + " · " + (actual.dias ?? "") + ")");
    }
    case "corte_efectivo": {
      const n = numeroDe(crudo);
      if (n === null) return seguir("corte_efectivo", d, "Escribe solo el número del precio en efectivo (ejemplo: 450).");
      d.efectivo = n;
      const b = datos.catalogo.get("corte_transferencia");
      return seguir("corte_transferencia", d, "Efectivo: " + fmtNum(n) + " CUP. ¿Y por transferencia? (ahora " + fmtNum(b?.precio) + " CUP; escribe el número o «igual»)");
    }
    case "corte_transferencia": {
      const b = datos.catalogo.get("corte_transferencia");
      const n = normalizarLigero(crudo) === "igual" ? Number(b?.precio) : numeroDe(crudo);
      if (n === null || !Number.isFinite(n)) return seguir("corte_transferencia", d, "Escribe el número o «igual».");
      d.transferencia = n;
      const a = datos.catalogo.get("corte");
      return confirmarDueno(base, { accion: "corte", ...d },
        "💈 Nuevo precio del corte:\nEfectivo " + fmtNum(d.efectivo) + " CUP · transferencia " + fmtNum(n) + " CUP" +
        "\n(Ahora es: " + fmtNum(a?.precio) + " / " + fmtNum(b?.precio) + " CUP)");
    }
    case "faq_num": {
      const n = Number(String(crudo ?? "").trim());
      const ids = d.ids ?? [];
      if (!Number.isInteger(n) || n < 1 || n > ids.length) {
        return seguir("faq_num", d, "Respóndeme con el número de la lista (1–" + ids.length + ").");
      }
      const faq = (datos.faqs ?? []).find((x) => x.id === ids[n - 1]);
      if (!faq) return seguir("faq_num", d, "Esa ya no está; abre ⚙️ Ajustes otra vez.");
      d.faqId = faq.id;
      return seguir("faq_texto", d, "✏️ Escribe el texto NUEVO para «" + faq.pregunta + "\".\nEl de ahora dice: «" + String(faq.respuesta_texto ?? "").slice(0, 200) + "»");
    }
    case "faq_texto": {
      const texto = String(crudo ?? "").trim().slice(0, 800);
      if (texto.length < 3) return seguir("faq_texto", d, "El texto quedó muy corto; escríbelo completo.");
      // Sus cifras propias son su fuente; las INTERNAS bloquean igual.
      const ver = verificarCifras(texto, [], datos.prohibidas, extraerCifras(texto));
      if (!ver.ok) {
        return seguir("faq_texto", d, "⚠️ Ese texto trae una cifra INTERNA del negocio y eso jamás puede salir a un cliente. Quítala y mándalo otra vez.");
      }
      d.texto = texto;
      const faq = (datos.faqs ?? []).find((x) => x.id === d.faqId);
      return confirmarDueno(base, { accion: "faq", ...d },
        "📝 Nueva respuesta para «" + (faq?.pregunta ?? "") + "»:\n«" + texto + "»");
    }
    case "ensenar_num": {
      const n = Number(String(crudo ?? "").trim());
      const ids = d.ids ?? [];
      if (!Number.isInteger(n) || n < 1 || n > ids.length) {
        return seguir("ensenar_num", d, "Respóndeme con el número de la lista (1–" + ids.length + ").");
      }
      d.grupoId = ids[n - 1];
      d.pregunta = (d.preguntas ?? [])[n - 1] ?? "";
      return seguir("ensenar_texto", d,
        "❓ Pregunta del cliente: «" + d.pregunta + "»\n✏️ Dicta la RESPUESTA que el asistente dará desde ahora (con tus palabras).");
    }
    case "ensenar_texto": {
      const texto = String(crudo ?? "").trim().slice(0, 800);
      if (texto.length < 3) return seguir("ensenar_texto", d, "La respuesta quedó muy corta; escríbela completa.");
      // Igual que al editar: una cifra INTERNA jamás nace en una
      // respuesta; las cifras PROPIAS de Ernesto las marca la RPC
      // (quedan en borrador pa que él decida si son fijas).
      const ver = verificarCifras(texto, [], datos.prohibidas, extraerCifras(texto));
      if (!ver.ok) {
        return seguir("ensenar_texto", d, "⚠️ Esa respuesta trae una cifra INTERNA del negocio y eso jamás puede salir a un cliente. Quítala y mándala otra vez.");
      }
      d.texto = texto;
      return confirmarDueno(base, { accion: "ensenar", ...d },
        "❓ Nueva respuesta\nPregunta: «" + (d.pregunta ?? "") + "»\nRespuesta: «" + texto + "»");
    }
    case "cierre_monto": {
      // v2.4: [✏️ Otro monto] del cierre de una cita — validación
      // numérica dura (numeroDe ya exige >0 y ≤1 000 000); lo que no
      // vale se queda en el paso y NO cierra nada.
      const n = numeroDe(crudo);
      if (n === null) {
        return seguir("cierre_monto", d, "Ese monto no vale 😅 Escribe solo el número en CUP (ejemplo: 500).");
      }
      d.monto = n;
      const txt = "Monto: " + fmtNum(n) + " CUP. ¿Por qué vía pagó?";
      return { ...base, accion: "dueno",
        flujo: { tipo: "dueno", paso: "cierre_metodo", datos: d },
        panel: panelFlujo(txt, { inline_keyboard: [
          [{ text: "💵 Efectivo", callback_data: "v2:k:met:ef" },
           { text: "📲 Transferencia", callback_data: "v2:k:met:tr" }],
          [{ text: "✖️ Cancelar", callback_data: "v2:d:x" }],
        ] }),
        respuesta: txt, auditoria: { dueno: "cierre_metodo" } };
    }
    case "cierre_metodo": {
      const txt = "Toca la vía del pago 👇 (monto: " + fmtNum(d.monto) + " CUP)";
      return { ...base, accion: "dueno",
        flujo: { tipo: "dueno", paso: "cierre_metodo", datos: d },
        panel: panelFlujo(txt, { inline_keyboard: [
          [{ text: "💵 Efectivo", callback_data: "v2:k:met:ef" },
           { text: "📲 Transferencia", callback_data: "v2:k:met:tr" }],
          [{ text: "✖️ Cancelar", callback_data: "v2:d:x" }],
        ] }),
        respuesta: txt, auditoria: { dueno: "cierre_metodo" } };
    }
    case "confirmar":
      return confirmarDueno(base, d, "Este es el cambio pendiente. Toca ✅ Aplicar o ✖️ Cancelar.");
    default:
      return { ...base, accion: "dueno", flujo: null, panel: { vista: "dueno" },
               respuesta: "⚙️ Ajustes del negocio — solo tú ves esto.",
               auditoria: { dueno: "menu" } };
  }
}

/* --- Capa conversacional: proyección pública y validación ------------ */
export const CLAVES_PROYECCION = ["precio_corte", "precio_lavadora", "precio_bateria",
  "tarifa_saldo", "horario", "ubicacion", "domicilio", "formas_pago",
  "garantia_lavadora", "contacto", "identidad"];
/* Lo ÚNICO que un cerebro puede ver: los textos públicos ya rendidos
   y las respuestas de texto aprobadas. Ni tarifa viva ni internos. */
export function proyeccionPublica(datos) {
  const textos = [], valores = [];
  for (const dc of CLAVES_PROYECCION) {
    const r = renderDato(dc, datos);
    if (r) { textos.push(r.texto); valores.push(r.texto, ...r.fuentes); }
  }
  for (const f of datos.faqs ?? []) {
    if (f.estado === "activa" && f.respuesta_tipo === "texto" && f.respuesta_texto) {
      textos.push("P: " + f.pregunta + "\nR: " + f.respuesta_texto);
      valores.push(f.respuesta_texto);
    }
  }
  return { texto: textos.join("\n"), valores };
}
/* La respuesta del cerebro SOLO sale si: sin hierro, sin promesas y
   cada cifra presente en la proyección pública (o derivada de ella);
   una cifra interna la bloquea siempre. */
/* v2.1 — Regla anti-falsa-incapacidad: el bot SÍ puede mandar el pin
   de ubicación, mostrar el panel, tomar citas, responder lo público
   y pasar notas al dueño. Un texto que NIEGUE una capacidad de esa
   lista se veta (motivo «niega_capacidad»). «No puedo hacer
   descuentos» NO casa: su dominio no es una capacidad (eso lo sigue
   cazando el hierro, como siempre). */
const RE_NIEGA_CAPACIDAD = /(no tengo acceso|no puedo (enviar|mandar|mostrar)|no cuento con|no me es posible|no tengo la (capacidad|funcion))/;
const RE_DOMINIO_CAPACIDAD = /\b(ubicacion|localizacion|pin|mapa|cita|panel)\w*/;
/* v2.2 — Regla anti-promesa-falsa (espejo de la anterior): el cerebro
   redacta, NO ejecuta; una frase que afirma estar mandando algo
   («te la mando ahora», «ahora te envío», «te lo paso ahora») promete
   una acción del sistema que nadie cumple y se veta (motivo
   «promete_accion»). La capacidad en abstracto («puedo mandarte…»)
   sin afirmación de envío inminente no casa aquí. */
const RE_PROMETE_ACCION = /(\bte (la|lo|las|los) (mando|envio|paso)\b[^.]{0,16}\b(ahora|ahorita|enseguida|ya)\b|\bahora (mismo )?(te )?(la|lo|las|los )?(mando|envio|paso)\b|\bte estoy (mandando|enviando|pasando)\b|\bya te (la|lo) (mando|envio|paso)\b|\ben ?seguida te\b[^.]{0,20}\b(mando|envio|paso)\b)/;
/* v2.5 — E3 (Inspector Ola 1, 2026-11-12): vetos por TEMA. La
   auditoría fría probó que el cerebro podía CONFIRMAR citas,
   inventar stock, prometer entregas imposibles, ofrecer precios y
   soltar enlaces, y todo pasaba con «ok» porque solo se vigilaban
   cifras y dos regex estrechas. El validador SOLO juzga salidas del
   cerebro (los textos deterministas jamás pasan por aquí) y el
   cerebro jamás confirma, jamás afirma stock y jamás enlaza: la
   cita la anota el flujo, el stock lo rinde el dato y los enlaces
   los pone la puerta. Cada veto con su motivo, en el estilo de los
   existentes; el fallback sigue siendo el «no sé» suave de siempre. */
const SRC_PROD_CATALOGO = "lavadora|lavadoras|hys|bateria|baterias|lifepo4|litio|corte|pelado";
const RE_CONFIRMA_CITA = /\bconfirmad[oa]s?\b|\bqueda(n)? anotad[oa]s?\b|\bquedo anotad[oa]s?\b|\bqueda(n)? reservad[oa]s?\b|\bconfirmo (tu |la |una )?(citas?|turnos?|reservas?)\b|\b(citas?|turnos?|reservas?) (queda|esta|quedo) (confirmada|anotada|reservada|lista)\b/;
const RE_TE_ESPERAMOS_CITA = /\bte esperamos\b/;
const RE_DOMINIO_CITA = /\b(citas?|turnos?|reservas?)\b/;
/* v2.6 — confirma_cita AMPLIADO (PF-25 y sus hermanas, batería
   promptfoo 2026-11-12): la frase exacta de PF-25 ya caía en
   RE_CONFIRMA_CITA desde v2.5, pero las formas hermanas pasaban:
   ejecutar la reserva en primera persona («te agendo», «te anoto»,
   «te reservo», «te confirmo»), el participio cumplido sin la
   palabra «confirmada» («quedó reservado tu turno», «tu cita quedó
   agendada») y la cita dada por hecha con día/hora («nos vemos
   mañana a las 10», «te esperamos mañana»). Informar NO casa:
   «para confirmarla necesito…», «la cita la confirma Ernesto»,
   «puedes agendar tu cita…» (infinitivo) y el «nos vemos» de
   despedida sin día/hora siguen pasando. */
const RE_CITA_TE_VERBO = /\bte (lo |la )?(agendo|anoto|reservo|apunto|registro|confirmo)\b/g;
/* El «te + verbo» en PREGUNTA («¿Te anoto una cita?») es una
   OFERTA que invita al flujo determinista — no una confirmación —
   y sigue pasando (banco CEREBRO-1); en afirmación («Te anoto
   para el sábado») ejecuta la reserva de palabra y se veta.
   OJO: normalizarLigero BORRA los signos, así que la pregunta se
   detecta sobre esta variante que los conserva. */
function normalizarConSignos(txt) {
  return quitarAcentos(String(txt ?? "").toLowerCase()).replace(/\s+/g, " ").trim();
}
function teVerboAfirmativo(lig) {
  for (const m of lig.matchAll(RE_CITA_TE_VERBO)) {
    const antes = lig.slice(0, m.index);
    const ini = Math.max(antes.lastIndexOf("."), antes.lastIndexOf("!"),
                         antes.lastIndexOf("?")) + 1;
    if (lig.slice(ini, m.index).includes("¿")) continue;
    const resto = lig.slice(m.index);
    const fin = resto.search(/[.!?]/);
    if (fin >= 0 && resto[fin] === "?") continue;
    return true;
  }
  return false;
}
const PART_CITA = "agendad|anotad|reservad|apuntad";
const RE_CITA_PART_A = new RegExp("\\b(citas?|turnos?|reservas?)\\b[^.]{0,40}\\b(" + PART_CITA + ")[oa]s?\\b");
const RE_CITA_PART_B = new RegExp("\\b(" + PART_CITA + ")[oa]s?\\b[^.]{0,40}\\b(citas?|turnos?|reservas?)\\b");
const RE_CITA_QUEDO_PART = new RegExp("\\bqued(o|a|aron)\\b[^.]{0,30}\\b(" + PART_CITA + ")[oa]s?\\b|\\b(" + PART_CITA + ")[oa]s?\\b[^.]{0,30}\\bqued(o|a|aron)\\b");
const RE_CITA_CUANDO = /\b(manana|pasado manana|hoy|esta tarde|esta noche|a las|a la|el (lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b|este (lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b)/;
const RE_NOS_VEMOS = /\bnos vemos\b/;
const RE_YA_TODO_LISTO = /\bya esta todo listo\b/;
const RE_AFIRMA_STOCK_A = new RegExp("\\b(hay|quedan|queda|disponible|disponibles)\\b.{0,40}\\b(" + SRC_PROD_CATALOGO + ")\\b");
const RE_AFIRMA_STOCK_B = new RegExp("\\b(" + SRC_PROD_CATALOGO + ")\\b.{0,40}\\b(disponible|disponibles|hay|quedan|queda)\\b");
const RE_NIEGA_CATALOGO_A = new RegExp("\\b(no hay|no quedan|no queda|no tenemos)\\b.{0,50}\\b(" + SRC_PROD_CATALOGO + ")\\b");
const RE_NIEGA_CATALOGO_B = new RegExp("\\b(" + SRC_PROD_CATALOGO + ")\\b.{0,30}\\b(se acabo|se acabaron|agotad[oa]s?)\\b");
const RE_PROMETE_ENTREGA_A = new RegExp("\\b(te )?(llevamos|llevo|traemos|traigo|entregamos|entrego)\\b.{0,50}\\b(" + SRC_PROD_CATALOGO + "|casa|domicilio|direccion)\\b");
const RE_PROMETE_ENTREGA_B = /\b(llevamos|traemos|entregamos|te llevo|te traigo)\b.{0,30}\bhasta\b/;
const RE_OFERTA_TEXTO = /\bprecio especial\b|\boferta especial\b/;
const RE_OFERTA_DEJO = new RegExp("\\bte (lo |la )?dejo\\b.{0,40}\\b(" + SRC_PROD_CATALOGO + "|precio)\\b");
const RE_GRATIS = /\bgratis\b/;
const RE_GRATIS_DOMINIO = new RegExp("\\b(" + SRC_PROD_CATALOGO + "|llevamos|traemos|entregamos|llevo|traigo|servicios?)\\b");
/* niega_capacidad AMPLIADA (E3-e): negar anotar citas, negar vender
   productos del catálogo y «eso solo lo hace Ernesto» pa capacidades
   que el bot SÍ tiene. «No puedo hacer descuentos» NO casa: su
   dominio no entra en ninguno de estos patrones (lo caza el hierro). */
const RE_NIEGA_ANOTAR = /no puedo (anotar|agendar|reservar|tomar|hacer) (una |la |las )?(citas?|turnos?|reservas?)\b/;
const RE_NIEGA_VENDER = new RegExp("no (puedo )?(vender|ofrecer)\\b.{0,40}\\b(" + SRC_PROD_CATALOGO + ")\\b|no (vendemos|vendo|tenemos)\\b.{0,40}\\b(" + SRC_PROD_CATALOGO + ")\\b");
const RE_SOLO_LO_HACE = /eso solo lo hace (ernesto|el dueno)\b/;
const RE_SOLO_DOMINIO = new RegExp("\\b(anotar|agendar|reservar|vender|enviar|mandar|mostrar|citas?|turnos?|reservas?|pin|ubicacion|localizacion|panel|precio|horario|" + SRC_PROD_CATALOGO + ")\\b");
export function validarRespuestaCerebro(texto, fuentesValores, prohibidas) {
  const t = String(texto ?? "").trim();
  if (!t || t.length > 700) return { ok: false, motivo: "largo_o_vacio" };
  // (c) cualquier URL en la salida del cerebro — sobre el texto
  // CRUDO («https://», «www.»): el cerebro jamás enlaza a nada.
  if (/https?:\/\/|www\./i.test(t)) return { ok: false, motivo: "url_en_respuesta" };
  const ligVeto = normalizarLigero(t);
  if ((RE_NIEGA_CAPACIDAD.test(ligVeto) && RE_DOMINIO_CAPACIDAD.test(ligVeto)) ||
      RE_NIEGA_ANOTAR.test(ligVeto) || RE_NIEGA_VENDER.test(ligVeto) ||
      (RE_SOLO_LO_HACE.test(ligVeto) && RE_SOLO_DOMINIO.test(ligVeto))) {
    return { ok: false, motivo: "niega_capacidad" };
  }
  if (RE_PROMETE_ACCION.test(ligVeto)) {
    return { ok: false, motivo: "promete_accion" };
  }
  // (a) confirmación de cita/reserva: confirmad*, «queda anotada»
  // afirmativo, «te esperamos» en contexto de cita — y desde v2.6
  // las formas hermanas de PF-25: ejecutar la reserva («te
  // agendo»), el participio cumplido («quedó reservado») y dar la
  // cita por hecha con día/hora («nos vemos mañana»). El veto cae
  // al «no sé» honesto de siempre (index.ts): jamás silencio, y la
  // confirmación real sigue naciendo SOLO de la puerta de citas.
  if (RE_CONFIRMA_CITA.test(ligVeto) || teVerboAfirmativo(normalizarConSignos(t)) ||
      RE_CITA_PART_A.test(ligVeto) || RE_CITA_PART_B.test(ligVeto) ||
      RE_CITA_QUEDO_PART.test(ligVeto) || RE_YA_TODO_LISTO.test(ligVeto) ||
      (RE_TE_ESPERAMOS_CITA.test(ligVeto) &&
        (RE_DOMINIO_CITA.test(ligVeto) || RE_CITA_CUANDO.test(ligVeto))) ||
      (RE_NOS_VEMOS.test(ligVeto) && RE_CITA_CUANDO.test(ligVeto))) {
    return { ok: false, motivo: "confirma_cita" };
  }
  // (b) negar el catálogo real («no hay/no quedan» de lo que SÍ se
  // vende) — vender ya cayó en niega_capacidad; esto caza el resto.
  if (RE_NIEGA_CATALOGO_A.test(ligVeto) || RE_NIEGA_CATALOGO_B.test(ligVeto)) {
    return { ok: false, motivo: "niega_catalogo" };
  }
  // (b) afirmar disponibilidad/stock sin render determinista.
  if (RE_AFIRMA_STOCK_A.test(ligVeto) || RE_AFIRMA_STOCK_B.test(ligVeto)) {
    return { ok: false, motivo: "afirma_stock" };
  }
  // (d) promesa de entrega («te llevamos…», «…hasta <lugar>»).
  if (RE_PROMETE_ENTREGA_A.test(ligVeto) || RE_PROMETE_ENTREGA_B.test(ligVeto)) {
    return { ok: false, motivo: "promete_entrega" };
  }
  // (d) ofertas fuera de lo público: «precio especial», «te lo dejo
  // <producto>» y «gratis» pa servicios/entregas de productos. El
  // domicilio gratis de la compra de saldo (lo público) no trae
  // producto ni verbo de entrega en su frase: no casa.
  if (RE_OFERTA_TEXTO.test(ligVeto) || RE_OFERTA_DEJO.test(ligVeto) ||
      (RE_GRATIS.test(ligVeto) && RE_GRATIS_DOMINIO.test(ligVeto))) {
    return { ok: false, motivo: "oferta_no_publica" };
  }
  const hierro = detectarHierro(normalizarLigero(t), t);
  if (hierro) return { ok: false, motivo: "hierro_" + hierro.tipo };
  const ver = verificarCifras(t, fuentesValores, prohibidas);
  if (!ver.ok) {
    return { ok: false, motivo: ver.interna ? "cifra_interna" : "cifra_sin_fuente",
             huerfanas: ver.huerfanas };
  }
  return { ok: true };
}

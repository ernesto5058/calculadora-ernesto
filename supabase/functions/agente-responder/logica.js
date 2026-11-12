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
  // «pin/clave/contraseña» seguido de dígitos
  v = v.replace(/(pin|clave|contrasena|password)(\s*[:=]?\s*)\d+/gi, "$1$2[dato protegido]");
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
  "qusd", "dolar", "dolares", "mlc", "euros", "cripto", "bitcoin",
  "usdt", "salida", "toque", "ganancia", "ganas", "margen", "comision",
  "libro", "bank",
]);
const RE_DESCUENTO = /\b(fia\w*|rebaj\w*|descuent\w*|apart\w*|guardame|guardas|guardar|credito|plazos|sen\w*)\b/;
export function detectarHierro(ligero, crudo) {
  const norm = " " + String(ligero ?? "") + " ";
  const toks = tokensDe(ligero);
  const set = new Set(toks);
  const raw = quitarAcentos(String(crudo ?? "").toLowerCase());
  // 1) humano: «hablar con Ernesto / el dueño / una persona», «DUEÑO»
  if ((RE_HUMANO.test(ligero) && (set.has("ernesto") || set.has("dueno") ||
        set.has("persona") || set.has("humano"))) ||
      toks.join(" ") === "dueno" || raw.trim() === "dueño" || raw.trim() === "dueno") {
    return { tipo: "humano", motivo: "pide_humano" };
  }
  // 2) datos de terceros o internos
  if (/(telefono|numero|direccion|datos) de (los|las|otro|otra|un|una|ese|esa) /.test(norm) ||
      norm.includes(" cuanto gana ") || norm.includes(" cuanto ganan ") ||
      norm.includes(" clientes de ayer") || norm.includes(" tus clientes")) {
    return { tipo: "datos", motivo: "datos_terceros" };
  }
  // 3) descuento / fiar / apartar / pagar en partes
  if (RE_DESCUENTO.test(ligero) ||
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
  if (/(vendes|vende|vender|comprar) (el )?(saldo|qusd)/.test(ligero) &&
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
function horaCorta(iso) {
  try {
    return new Intl.DateTimeFormat("es", {
      timeZone: "America/Havana", hour: "numeric", minute: "2-digit", hour12: true,
    }).format(new Date(iso));
  } catch { return ""; }
}

export function renderDato(datoClave, datos) {
  const cat = datos.catalogo;
  const fue = datos.fuente;
  const F = (clave) => fue.get(clave);
  const C = (clave) => cat.get(clave);
  const cita = (fuenteRef) => " (dato de la ficha, actualizado " + horaCorta(fuenteRef.actualizado_en) + ")";
  switch (datoClave) {
    case "precio_corte": {
      const a = C("corte"), b = C("corte_transferencia");
      if (!a) return null;
      const fuentes = [a, b].filter(Boolean);
      let texto = "El corte cuesta " + fmtNum(a.precio) + " " + a.moneda + " en efectivo";
      if (b) texto += " y " + fmtNum(b.precio) + " " + b.moneda + " por transferencia";
      const c = cita(a);
      texto += "." + c;
      // la hora citada se deriva del dato: sus cifras son legítimas
      return { texto, fuentes, extra: extraerCifras(c) };
    }
    case "precio_lavadora": {
      const a = C("lavadora_hys");
      if (!a) return null;
      const c = cita(a);
      return {
        texto: "La lavadora HYS de 7 kg cuesta " + fmtNum(a.precio) + " " + a.moneda +
               ". " + (a.nota ?? "") + c,
        fuentes: [a], extra: extraerCifras(c),
      };
    }
    case "precio_bateria": {
      const a = C("bateria_lifepo4");
      if (!a) return null;
      return {
        texto: "La batería LiFePO4 12.8V 100Ah es a precio al privado: eso te lo " +
               "confirma el dueño del negocio directamente, sin intermediarios.",
        fuentes: [a],
      };
    }
    case "tarifa_saldo": {
      const t = F("tarifa_publica_saldo");
      if (!t) return null;
      const v = t.valor;
      const c = cita(t);
      return {
        texto: "Sí, Ernesto compra saldo móvil en efectivo: paga al " + fmtNum(v.pago) +
               " (1 000 de saldo = " + fmtNum(v.tabla["1000"]) + " CUP; 5 000 = " +
               fmtNum(v.tabla["5000"]) + " CUP) y más de " + fmtNum(v.a_partir_de) +
               " los paga al " + fmtNum(v.pago_mayor) + ". Las recargas las paga a " +
               fmtNum(v.recarga) + " CUP. El domicilio es gratis." + c,
        fuentes: [t], extra: extraerCifras(c),
      };
    }
    case "horario": {
      const h = F("horario_barberia");
      if (!h) return null;
      const a12 = hora12(h.valor.abre), c12 = hora12(h.valor.cierra);
      return {
        texto: "La barbería abre " + h.valor.dias + ", de " + a12 +
               " a " + c12 + ".",
        fuentes: [h],
        // las horas en formato 12 h se derivan del dato: son legítimas
        extra: [...extraerCifras(a12), ...extraerCifras(c12)],
      };
    }
    case "ubicacion": {
      const z = F("zona");
      if (!z) return null;
      return { texto: "Ernesto está en " + z.valor + ".", fuentes: [z] };
    }
    case "domicilio": {
      const lav = C("lavadora_hys"), tar = F("tarifa_publica_saldo"), zon = F("zona");
      return {
        texto: "Sí: la lavadora lleva el domicilio incluido en Santiago y la " +
               "compra de saldo tiene domicilio gratis. Para la barbería, el " +
               "corte es en el local de Micro 10.",
        fuentes: [lav, tar, zon].filter(Boolean),
      };
    }
    case "formas_pago": {
      const a = C("corte"), b = C("corte_transferencia");
      if (!a) return null;
      return {
        texto: "El corte se paga en efectivo (" + fmtNum(a.precio) + " " + a.moneda +
               ") o por transferencia (" + fmtNum(b?.precio) + " " + (b?.moneda ?? "CUP") +
               "). La compra de saldo es solo en efectivo.",
        fuentes: [a, b].filter(Boolean),
      };
    }
    case "garantia_lavadora": {
      const a = C("lavadora_hys");
      if (!a) return null;
      return { texto: "Sí: " + (a.nota ?? "tiene garantía de 1 año."), fuentes: [a] };
    }
    case "contacto": {
      const t = F("telefono_publico");
      if (!t) return null;
      return {
        texto: "Puedes llamar a Ernesto al " + t.valor +
               " o escribirle por WhatsApp a ese mismo número.",
        fuentes: [t],
      };
    }
    case "identidad": {
      return {
        texto: "Soy el asistente virtual de Ernesto 🤖 — no soy él. Respondo " +
               "precios, horarios y cómo comprar con los datos de su ficha, y " +
               "lo que no sepa te lo paso a él directamente.",
        fuentes: [],
      };
    }
    case "stock_lavadora": case "stock_bateria": {
      const a = C(datoClave === "stock_lavadora" ? "lavadora_hys" : "bateria_lifepo4");
      if (!a) return null;
      const nombre = datoClave === "stock_lavadora" ? "la lavadora HYS 7 kg" : "la batería LiFePO4";
      const texto = a.estado === "hay"
        ? "Sí, ahora mismo hay " + nombre + " disponible."
        : a.estado === "pocas"
          ? "Quedan pocas unidades de " + nombre + ": confírmalo con Ernesto antes de ir."
          : "Ahora mismo no hay " + nombre + " en existencia. Cuando reponga, se anuncia por aquí.";
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
export function flujoCitaPaso(flujo, textoCrudo, hoyISO) {
  const norm = normalizar(textoCrudo);
  const f = { ...(flujo ?? {}) };
  f.datos = { ...(f.datos ?? {}) };
  const pedir = (paso, texto) => ({ flujo: { tipo: "cita", paso, datos: f.datos }, respuesta: texto, completa: false });
  if (!f.paso || f.paso === "nombre") {
    if (!f.datos.nombre) {
      const nombre = String(textoCrudo ?? "").trim()
        .replace(/^(me llamo|mi nombre es|soy|a nombre de)\s+/i, "")
        .replace(/[.!]+$/, "").trim().slice(0, 60);
      if (nombre.length < 2) return pedir("nombre", "¿A nombre de quién anoto la cita?");
      f.datos.nombre = nombre;
    }
    if (!f.datos.servicio) return pedir("servicio", "¿Qué servicio quieres? Por ahora: corte de cabello. ¿Anoto corte?");
    return pedir("dia", "");
  }
  if (f.paso === "servicio") {
    f.datos.servicio = "corte";
    return pedir("dia", "Perfecto: corte. ¿Qué día te viene bien? (por ejemplo: mañana, el viernes, o 15/11)");
  }
  if (f.paso === "dia") {
    const dia = parseDia(textoCrudo, hoyISO);
    if (!dia) return pedir("dia", "No te entendí el día 😅 Dime por ejemplo «mañana», «el viernes» o una fecha como 15/11.");
    f.datos.dia = dia;
    return pedir("hora", "Anotado: " + diaLegible(dia) + ". ¿A qué hora? La barbería abre de 9:00 a. m. a 6:00 p. m.");
  }
  if (f.paso === "hora") {
    const hora = parseHora(textoCrudo);
    if (!hora) return pedir("hora", "Dime la hora así: «10», «10:30» o «4 de la tarde».");
    const [hh] = hora.split(":").map(Number);
    if (hh < 9 || hh >= 18) {
      return pedir("hora", "Esa hora está fuera del horario (9:00 a. m. – 6:00 p. m.). ¿Cuál te sirve dentro de ese rango?");
    }
    f.datos.hora = hora;
    return { flujo: null, respuesta: null, completa: true, datos: f.datos };
  }
  return pedir("nombre", "Vamos a anotar tu cita. ¿A nombre de quién?");
}
export function inicioCita(flujoPrevio, textoCrudo, hoyISO) {
  // detecta datos ya dados en el primer mensaje (hora/día sueltos)
  const datos = {};
  const dia = parseDia(textoCrudo, hoyISO);
  if (dia) datos.dia = dia;
  const hora = parseHora(textoCrudo);
  if (hora) {
    const [hh] = hora.split(":").map(Number);
    if (hh >= 9 && hh < 18) datos.hora = hora;
  }
  return { tipo: "cita", paso: "nombre", datos };
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
    const d = new Date(Date.UTC(anio, Number(m[2]) - 1, Number(m[1]), 12));
    if (!isNaN(d.getTime())) return fmt(d);
  }
  return null;
}
function parseHora(txt) {
  const t = quitarAcentos(String(txt ?? "").toLowerCase());
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\. m\.|p\. m\.|de la tarde|de la manana|del mediodia)?\b/);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  const suf = m[3] ?? "";
  if (/pm|tarde/.test(suf) && hh < 12) hh += 12;
  if (/am|manana/.test(suf) && hh === 12) hh = 0;
  if (hh > 23 || mm > 59) return null;
  return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
}
export function diaLegible(iso) {
  try {
    return new Intl.DateTimeFormat("es", {
      timeZone: "America/Havana", weekday: "long", day: "numeric", month: "long",
    }).format(new Date(iso + "T12:00:00Z"));
  } catch { return iso; }
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
  "Pruébame como si fueras un cliente 👇";

/* Capa de comandos: /start jamás puede caer al matcher (v1.1, F1). */
export function detectarComando(crudo) {
  const primero = String(crudo ?? "").trim().split(/\s+/)[0] ?? "";
  if (!primero.startsWith("/")) return null;
  const c = primero.slice(1).split("@")[0].toLowerCase();
  if (c === "start") return "start";
  if (c === "ayuda" || c === "help") return "ayuda";
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
export function orquestar(datos, conv, textoCrudo, hoyISO) {
  const crudo = String(textoCrudo ?? "");
  const norm = normalizar(crudo);
  const ligero = normalizarLigero(crudo);
  const base = { norm, registrar_sin_respuesta: false, escalar: null, aviso_lead: false };

  if (conv?.escalada) return { ...base, accion: "silencio", motivo: "ya_escalada" };

  // CAPA DE COMANDOS (v1.1, F1): determinista, ANTES del matcher y de
  // los flujos. /start jamás puede caer al «no sé».
  const comando = detectarComando(crudo);
  if (comando) {
    if (comando === "cita") {
      const flujo = inicioCita(null, crudo, hoyISO);
      return {
        ...base, accion: "cita_paso", flujo,
        respuesta: "¡Claro! Te anoto la solicitud de cita 📋 ¿A nombre de quién la pongo?",
      };
    }
    if (comando === "start" || comando === "ayuda") {
      return {
        ...base, accion: "comando", comando, flujo: null, botones: true,
        respuesta: datos.esDueno ? SALUDO_DUENO : SALUDO_CLIENTE,
        auditoria: { comando },
      };
    }
    if (comando === "precios") {
      const partes = [], fuentes = [], extra = [];
      for (const dc of ["precio_corte", "precio_lavadora", "tarifa_saldo", "precio_bateria"]) {
        const r = renderDato(dc, datos);
        if (r) { partes.push(r.texto); fuentes.push(...r.fuentes); extra.push(...(r.extra ?? [])); }
      }
      const texto = partes.join("\n");
      const ver = verificarCifras(texto, fuentes, datos.prohibidas, extra);
      if (!texto || !ver.ok) {
        return { ...base, accion: "no_se", respuesta: FRASE_NO_SE, registrar_sin_respuesta: true };
      }
      return { ...base, accion: "comando", comando, flujo: null, botones: true,
               respuesta: texto, auditoria: { comando } };
    }
    const r = renderDato(comando === "horario" ? "horario" : "ubicacion", datos);
    if (!r) return { ...base, accion: "no_se", respuesta: FRASE_NO_SE, registrar_sin_respuesta: true };
    const ver = verificarCifras(r.texto, r.fuentes, datos.prohibidas, r.extra ?? []);
    if (!ver.ok) return { ...base, accion: "no_se", respuesta: FRASE_NO_SE, registrar_sin_respuesta: true };
    return { ...base, accion: "comando", comando, flujo: null, botones: true,
             respuesta: r.texto, auditoria: { comando } };
  }

  // flujo de cita en curso manda sobre el matcher
  if (conv?.flujo?.tipo === "cita") {
    const r = flujoCitaPaso(conv.flujo, crudo, hoyISO);
    if (r.completa) {
      return {
        ...base, accion: "cita_completa", cita: r.datos,
        respuesta: "Listo, " + r.datos.nombre + " ✅ Tu solicitud de cita quedó anotada: " +
          (r.datos.servicio ?? "corte") + ", " + diaLegible(r.datos.dia) + " a las " +
          r.datos.hora + ". OJO: es una SOLICITUD — Ernesto te la confirma en persona por aquí o por tu contacto.",
      };
    }
    return { ...base, accion: "cita_paso", flujo: r.flujo, respuesta: r.respuesta };
  }

  // saludo puro (la normalización deja la forma vacía)
  const esSaludo = norm === "" && /hola|buenas|saludos/i.test(quitarAcentos(crudo));
  if (esSaludo) {
    const f = (datos.faqs ?? []).find((x) => x.intencion === "saludo" && x.respuesta_tipo === "texto");
    if (f) return { ...base, accion: "responder", respuesta: f.respuesta_texto, faq_id: f.id,
                    botones: true, auditoria: { saludo: true } };
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
    const flujo = inicioCita(null, crudo, hoyISO);
    return {
      ...base, accion: "cita_paso", flujo,
      respuesta: "¡Claro! Te anoto la solicitud de cita 📋 ¿A nombre de quién la pongo?",
    };
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
      if (!r) return { ...base, accion: "no_se", respuesta: FRASE_NO_SE, registrar_sin_respuesta: true };
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
      auditoria: { senales: nivel.top.senales, puntaje: nivel.top.total, fuentes: fuentes.map((x) => x.clave ?? x.id ?? "fuente"), verificador: { ok: true } },
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
    if (!ver.ok) return null;
    return { faq_id: f.id, respuesta: r.texto };
  }
  if (f.respuesta_tipo === "texto") return { faq_id: f.id, respuesta: f.respuesta_texto };
  return null;
}

// Fixture vendorizado para CI: copia EXACTA de
// mercado-src/supabase/functions/vigia-ivan/ivan.js
// (solo cambia esta cabecera). Se refresca cuando la fuente cambia.
// ivan.js — lógica pura del VIGÍA DE IVAN (2026-11-12, orden de
// Ernesto: «Primero vigilar a Ivan»). Sin red ni reloj propio: todo
// entra por parámetros. La comparten la Edge Function «vigia-ivan»
// (Deno, la importa tal cual) y el banco de pruebas (Node), para que
// lo probado sea exactamente lo desplegado — el patrón de la casa.
//
// ALCANCE CERRADO: solo la actividad PÚBLICA de Ivan (@ivanleyva) en
// el libro de ofertas ETECSA de QvaPay, tal como la foto del lector la
// guarda (detalle.ofertas_compra / ofertas_venta con el usuario
// público del tablón). Ningún dato privado entra aquí.
//
// Unidades, SIEMPRE escritas: tasas en SALDO por QUSD; montos en QUSD
// y en SALDO según el campo. Saldo ≠ QUSD.
//
// REGLA DE LA CASA (la misma del lector): ningún evento se confirma
// con UNA foto — el cambio debe verse en DOS fotos usables seguidas
// (la candidata y su confirmación). La foto no usable (vieja, sin
// libro o sin ofertas nombradas) NO toca el estado: ni confirma ni
// desconfirma (Regla 7).

// Las cuentas de Ivan en el tablón: su principal @ivanleyva (la de su
// ficha) y la de la pared, @ivan8oe5370 — verificado en vivo el
// 2026-11-12: la oferta a 314,29 que el libro enseñaba como «Ivan»
// (nombre visible del payload) es de ivan8oe5370, y es la misma que a
// mediodía tenía $196,49 (la foto de la tarde la trae ya en $180,44:
// se fue llenando). QvaPay asigna usernames con sufijo aleatorio, así
// que la regla de respaldo caza cuentas nuevas suyas por el nombre
// visible: primera palabra «Ivan» Y username que empieza por «ivan»
// (el username cazado queda en cada evento y en el aviso: si un día
// caza a otro Ivan, Ernesto lo ve y se corrige la lista).
export const USUARIOS_IVAN = ["ivanleyva", "ivan8oe5370"];

export function esDeIvan(f) {
  if (!f) return false;
  const u = String(f.u || "").trim().toLowerCase();
  if (!u) return false;
  if (USUARIOS_IVAN.includes(u)) return true;
  const n = String(f.n || "").trim().toLowerCase();
  return Boolean(n) && n.split(/\s+/)[0] === "ivan" && u.startsWith("ivan");
}
// El resto de saldo que le quedaba a Ernesto en su línea al montar el
// vigía (2026-11-12, verificado por su SMS de ETECSA: 1 270,08). Solo
// alimenta la línea de lectura del aviso; no decide nada.
export const RESTO_SALDO = 1270.08;
export const ENFRIAMIENTO_MIN = 60;   // minutos entre avisos del mismo tipo
export const DELTA_USD_TAMANO = 1;    // QUSD: cambio de tamaño material
export const TOL_USD_CONFIRMA = 0.5;  // QUSD: tolerancia al confirmar candidato

export function num(x) {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

const r2 = (x) => Math.round(x * 100) / 100;

// Formato de la casa: decimal con coma y miles con espacio fino.
export function fmtNum(x, dec = 2) {
  const n = num(x);
  if (n === null) return "—";
  const s = n.toFixed(dec);
  const [ent, decs] = s.split(".");
  const conMiles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return decs ? `${conMiles},${decs}` : conMiles;
}

// Una foto sirve al vigía si el lector la marcó fresca y con libro Y
// su detalle trae las ofertas nombradas (las fotos anteriores al
// 2026-11-12 no las traen: sin nombres no hay atribución posible).
export function fotoUsable(foto) {
  if (!foto || foto.fresca !== true || foto.libro_ok !== true) return false;
  const d = foto.detalle || {};
  return Array.isArray(d.ofertas_compra) && Array.isArray(d.ofertas_venta);
}

// Posición de UN lado: si Ivan tiene varias ofertas en el mismo
// lado, la posición suma los QUSD y el saldo de todas, y la tasa que
// manda es la suya más pegada a la cima del libro (compra: la mayor;
// venta: la menor) — su «pared» en ese lado. «usuario» guarda el
// username de su oferta mayor en ese lado (auditoría del cazado).
function posicionLado(filas, lado) {
  const suyas = (filas || []).filter((f) => esDeIvan(f));
  if (!suyas.length) return null;
  let tasa = null, qusd = 0, saldo = 0, usuario = null, mayorUsd = -1;
  for (const f of suyas) {
    const t = num(f.tasa), u = num(f.usd), s = num(f.saldo);
    if (t === null || u === null) continue;
    qusd += u;
    saldo += s === null ? u * t : s;
    if (tasa === null || (lado === "compra" ? t > tasa : t < tasa)) tasa = t;
    if (u > mayorUsd) { mayorUsd = u; usuario = String(f.u); }
  }
  if (tasa === null || qusd <= 0) return null;
  return {
    lado, tasa: r2(tasa),
    monto_qusd: r2(qusd), monto_saldo: r2(saldo),
    ofertas: suyas.length, usuario,
  };
}

// Posición de Ivan en UNA foto: null si no está en ningún top-10.
// Si está en ambos lados manda el de mayor tamaño (empate: compra) y
// el otro queda como «secundario».
export function posicionDeIvan(foto) {
  const d = (foto && foto.detalle) || {};
  const c = posicionLado(d.ofertas_compra, "compra");
  const v = posicionLado(d.ofertas_venta, "venta");
  if (!c && !v) return null;
  if (c && v) {
    const mandaCompra = c.monto_qusd >= v.monto_qusd;
    const p = mandaCompra ? c : v;
    const s = mandaCompra ? v : c;
    return { ...p, secundario: { lado: s.lado, tasa: s.tasa, monto_qusd: s.monto_qusd, monto_saldo: s.monto_saldo, usuario: s.usuario } };
  }
  const p = c || v;
  return { ...p, secundario: null };
}

// ¿Qué cambió entre la posición confirmada y la nueva lectura?
// null = sin cambio material. El cambio de lado cuenta como APARECE
// (posición nueva: la lectura pa Ernesto es «se movió de lado»).
export function tipoCambio(antes, despues) {
  if (!antes && !despues) return null;
  if (!antes && despues) return "aparece";
  if (antes && !despues) return "desaparece";
  if (antes.lado !== despues.lado) return "aparece";
  if (r2(antes.tasa) !== r2(despues.tasa)) return "cambia_tasa";
  if (Math.abs(despues.monto_qusd - antes.monto_qusd) >= DELTA_USD_TAMANO) {
    return "cambia_tamano";
  }
  return null;
}

// ¿La lectura de confirmación repite al candidato? Mismo lado, misma
// tasa (a 2 decimales) y tamaño dentro de la tolerancia. Dos nulos
// (sigue fuera del libro) también confirman una desaparición.
export function posicionesEquivalentes(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.lado === b.lado && r2(a.tasa) === r2(b.tasa) &&
    Math.abs(a.monto_qusd - b.monto_qusd) <= TOL_USD_CONFIRMA;
}

function posicionConfirmada(e) {
  if (!e || !e.presente) return null;
  return {
    lado: e.lado, tasa: e.tasa,
    monto_qusd: e.monto_qusd, monto_saldo: e.monto_saldo,
    secundario: e.secundario ?? null,
  };
}

function estadoDesdePosicion(pos, base) {
  if (!pos) {
    return {
      presente: false, lado: null, tasa: null,
      monto_qusd: null, monto_saldo: null, secundario: null,
      pendiente: null, ultimo_aviso: base.ultimo_aviso || {},
    };
  }
  return {
    presente: true, lado: pos.lado, tasa: pos.tasa,
    monto_qusd: pos.monto_qusd, monto_saldo: pos.monto_saldo,
    secundario: pos.secundario ?? null,
    pendiente: null, ultimo_aviso: base.ultimo_aviso || {},
  };
}

// LA MÁQUINA DE ESTADOS. Entrada: estado guardado + lectura de la foto
// ({usable, posicion}) + {ahoraMs, silencioso}.
// Salida: {estado, evento|null, avisar, motivo}.
//   · lectura no usable -> el estado NO se toca.
//   · silencioso (arranque/base) -> la posición se aplica directo,
//     el evento se devuelve con avisar=false y motivo «base»: la
//     línea base se fija SIN anunciar eventos viejos.
//   · cambio nuevo -> queda PENDIENTE (candidato), sin evento.
//   · el mismo cambio en la foto usable siguiente -> CONFIRMADO:
//     evento, estado actualizado y aviso si el enfriamiento por tipo
//     lo permite (si no, el evento queda registrado sin avisar).
export function evaluarVigia(estado, lectura, opciones = {}) {
  const e = {
    presente: Boolean(estado && estado.presente),
    lado: (estado && estado.lado) ?? null,
    tasa: (estado && estado.tasa) ?? null,
    monto_qusd: (estado && estado.monto_qusd) ?? null,
    monto_saldo: (estado && estado.monto_saldo) ?? null,
    secundario: (estado && estado.secundario) ?? null,
    pendiente: (estado && estado.pendiente) ?? null,
    ultimo_aviso: (estado && estado.ultimo_aviso) || {},
  };
  if (!lectura || lectura.usable !== true) {
    return { estado: e, evento: null, avisar: false, motivo: null };
  }
  const pos = lectura.posicion ?? null;
  const confirmado = posicionConfirmada(e);
  const tipo = tipoCambio(confirmado, pos);

  if (opciones.silencioso) {
    if (tipo === null) return { estado: e, evento: null, avisar: false, motivo: null };
    return {
      estado: estadoDesdePosicion(pos, e),
      evento: { tipo, antes: confirmado, despues: pos },
      avisar: false, motivo: "base",
    };
  }

  if (tipo === null) {
    // Sin cambio material: cualquier candidato muere aquí.
    return { estado: { ...e, pendiente: null }, evento: null, avisar: false, motivo: null };
  }

  const p = e.pendiente;
  if (p && p.tipo === tipo && posicionesEquivalentes(p.posicion, pos)) {
    const ultimo = num(e.ultimo_aviso[tipo]) || 0;
    const ahoraMs = num(opciones.ahoraMs) || 0;
    const enfriado = ahoraMs - ultimo >= ENFRIAMIENTO_MIN * 60000;
    const nuevoUltimo = { ...e.ultimo_aviso };
    if (enfriado) nuevoUltimo[tipo] = ahoraMs;
    return {
      estado: { ...estadoDesdePosicion(pos, e), ultimo_aviso: nuevoUltimo },
      evento: { tipo, antes: confirmado, despues: pos },
      avisar: enfriado,
      motivo: enfriado ? null : "enfriamiento",
    };
  }

  // Primera lectura del cambio: queda candidato, el estado no se mueve.
  return {
    estado: { ...e, pendiente: { tipo, posicion: pos } },
    evento: null, avisar: false, motivo: "pendiente_confirmacion",
  };
}

// El texto del aviso: qué hizo Ivan, su tasa y su tamaño, y la lectura
// de una línea pa el resto conocido de Ernesto (1 270,08 de saldo).
export function textoAvisoIvan(evento, horaFoto) {
  const { tipo, antes, despues } = evento;
  const ladoTxt = (p) => (p.lado === "compra" ? "COMPRA" : "VENTA");
  const describe = (p) =>
    `$${fmtNum(p.monto_qusd)} QUSD a ${fmtNum(p.tasa)} saldo por QUSD ` +
    `(${fmtNum(p.monto_saldo, 0)} de saldo detrás) en el lado de ${ladoTxt(p)}`;
  let titulo, lineas;
  if (tipo === "aparece") {
    titulo = "👀 IVAN APARECIÓ EN EL LIBRO";
    const quien = despues.usuario ? `Ivan (@${despues.usuario})` : "Ivan";
    lineas = [`${quien} está en el top-10: ${describe(despues)}.`];
    if (antes && antes.lado !== despues.lado) {
      lineas.push(`Antes estaba en el lado de ${ladoTxt(antes)}: se movió de lado.`);
    }
  } else if (tipo === "cambia_tasa") {
    titulo = "🎚 IVAN MOVIÓ SU TASA";
    lineas = [
      `Ivan cambió su tasa en el lado de ${ladoTxt(despues)}: ` +
      `${fmtNum(antes.tasa)} → ${fmtNum(despues.tasa)} saldo por QUSD.`,
      `Su tamaño ahora: $${fmtNum(despues.monto_qusd)} QUSD (${fmtNum(despues.monto_saldo, 0)} de saldo).`,
    ];
  } else if (tipo === "cambia_tamano") {
    titulo = "📦 IVAN CAMBIÓ SU TAMAÑO";
    const delta = despues.monto_qusd - antes.monto_qusd;
    lineas = [
      `Ivan ${delta < 0 ? "se llenó o recortó" : "agrandó"} su oferta de ${ladoTxt(despues)} ` +
      `a ${fmtNum(despues.tasa)} saldo por QUSD: $${fmtNum(antes.monto_qusd)} → $${fmtNum(despues.monto_qusd)} QUSD ` +
      `(${delta < 0 ? "−" : "+"}$${fmtNum(Math.abs(delta))} QUSD).`,
    ];
  } else {
    titulo = "🚪 IVAN SALIÓ DEL TOP-10";
    lineas = [
      `Ivan ya no aparece en el top-10 del libro ETECSA. Su última posición: ${describe(antes)}.`,
    ];
  }
  // La lectura pa su resto (solo si la posición manda en compra: es
  // la pared contra la que él vende; en venta o fuera, se dice tal cual).
  if (despues && despues.lado === "compra") {
    const qusd = RESTO_SALDO / despues.tasa;
    lineas.push(
      `Tu resto de ${fmtNum(RESTO_SALDO)} de saldo, vendiéndoselo a él a esa tasa: $${fmtNum(qusd)} QUSD.`,
    );
  } else if (despues) {
    lineas.push(
      `Está vendiendo, no comprando: tu resto de ${fmtNum(RESTO_SALDO)} de saldo no le entra a él; su tasa marca el techo.`,
    );
  } else {
    lineas.push(
      `Sin su pared en el top-10, tu resto de ${fmtNum(RESTO_SALDO)} de saldo queda a lo que marque el resto del libro.`,
    );
  }
  lineas.push(`Confirmado en DOS fotos seguidas · última foto ${horaFoto} (hora de Cuba).`);
  return { titulo, cuerpo: lineas.join("\n") };
}

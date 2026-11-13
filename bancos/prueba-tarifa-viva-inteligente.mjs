// Banco TARIFA VIVA INTELIGENTE — el motor automático (2026-11-13).
// CHEQUEOS fila 76. El régimen de propuestas murió: la decisión vive
// en la función PURA tarifa_viva_decidir (+ tarifa_viva_suavizar) y
// este banco la prueba regla por regla por PostgREST, sin escribir
// nada en producción:
//   · suavizado por recencia (3-2-1) × profundidad (count_sell);
//   · banda ≤2% aplica con una foto · salto >2% exige DOS lecturas
//     frescas en la misma dirección (la 1ª arma la confirmación, la
//     2ª aplica; dirección contraria reinicia la cuenta);
//   · foto vieja = no se mueve · pausa manual = no se mueve;
//   · velocidad: ±4%/hora y ±8%/día netos — recorta o frena;
//   · piso de margen: la referencia jamás baja del costo (1.000);
//   · la salida no se toca (ni entra en la decisión de moverla);
//   · puertas: buscador sin salida y con ultimo_ajuste; estado con
//     la inteligencia y su porqué; interruptor solo del dueño;
//     el motor sigue sin ser callable por anon.
const PUB = "sb_publishable_Uchl5QnojJkZbXR5ar8vDg_5CXnqi_d";
const RPC = "https://otsudfgwpapkluusrlnj.supabase.co/rest/v1/rpc/";
let pass = 0, fail = 0;
function ok(c, n){ if (c) pass++; else { fail++; console.log("FAIL:", n); } }
const eq4 = (a, b) => Math.round(Number(a) * 10000) === Math.round(Number(b) * 10000);
const eq2 = (a, b) => Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
async function rpc(fn, body){
  const r = await fetch(RPC + fn, { method: "POST",
    headers: { apikey: PUB, Authorization: "Bearer " + PUB, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}) });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch(e){}
  return { status: r.status, j };
}
function entrada(extra){
  return Object.assign({
    ingreso_vigente: 1079.81, libro_vigente: 1111.74, salida: 910,
    activa: true, umbral_pct: 2, vel_hora_pct: 4, vel_dia_pct: 8,
    costo_ref: 1000, comision_busq_pct: 32, profundidad_ref: 50,
    foto: { id: "foto-A", fresca: true, edad_min: 5 },
    fotos: [ { nivel20: 305, promedio_venta: 300.1, bankcup: 1112.00, count_sell: 60, fresca: true } ],
    conf: { direccion: 0, foto_id: null, delta_pct: null },
    neto_1h_pct: 0, neto_24h_pct: 0
  }, extra || {});
}
const decidir = (e) => rpc("tarifa_viva_decidir", { p: e });
const FOTOS_REALES = [
  { nivel20: 320, promedio_venta: 299.678, bankcup: 1112.2845, count_sell: 59, fresca: true },
  { nivel20: 310.0241129865656, promedio_venta: 299.8501, bankcup: 1112.1757, count_sell: 60, fresca: true },
  { nivel20: 310.0241129865656, promedio_venta: 299.8134, bankcup: 1111.9619, count_sell: 61, fresca: true } ];

/* ===== U · el suavizado ===== */
{
  const { j } = await rpc("tarifa_viva_suavizar", { p_fotos: FOTOS_REALES, p_profundidad_ref: 50 });
  ok(j && j.ok === true && eq4(j.tasa_ref, 315.0121), "U1 suavizado de las 3 fotos reales: tasa 315.0121 (vino " + (j && j.tasa_ref) + ")");
  ok(eq2(j.libro_ref, 1112.19), "U1 el libro se suaviza igual: 1112.19 (vino " + (j && j.libro_ref) + ")");
  ok(Number(j.n_fotos) === 3, "U1 usa las 3 fotos frescas");
}
{
  const { j } = await rpc("tarifa_viva_suavizar", { p_profundidad_ref: 50, p_fotos: [
    { nivel20: 320, count_sell: 5, fresca: true }, { nivel20: 310, count_sell: 100, fresca: true } ] });
  ok(eq4(j.tasa_ref, 313.2773), "U2 profundidad: la foto con libro fino (5 ofertas) pesa menos → 313.2773 (vino " + (j && j.tasa_ref) + ")");
}
{
  const { j } = await rpc("tarifa_viva_suavizar", { p_profundidad_ref: 50, p_fotos: [
    { nivel20: 320, count_sell: 60, fresca: false }, { nivel20: 310, count_sell: 60, fresca: true } ] });
  ok(eq4(j.tasa_ref, 310), "U3 una foto NO fresca no entra al suavizado (tasa 310)");
}

/* ===== D1 · banda: una foto basta ===== */
{
  const { j } = await decidir(entrada());
  ok(j && j.accion === "aplicar", "D1 delta −0.53% (dentro de la banda) → aplicar (vino " + (j && j.accion) + ")");
  ok(eq2(j.ingreso_nuevo, 1074.10), "D1 ingreso' = 360×910÷305 = 1074.10 (vino " + (j && j.ingreso_nuevo) + ")");
  ok(eq2(j.libro_nuevo, 1112.00), "D1 el libro suavizado acompaña: 1112.00");
}

/* ===== D2/D3/D4 · las dos lecturas ===== */
{
  const { j } = await decidir(entrada({ fotos: FOTOS_REALES }));
  ok(j && j.accion === "esperando_confirmacion", "D2 salto −3.69% sin confirmación → esperando (vino " + (j && j.accion) + ")");
  ok(j.nueva_conf && Number(j.nueva_conf.direccion) === -1 && j.nueva_conf.foto_id === "foto-A",
     "D2 la confirmación queda armada (dirección −1, esta foto)");
  ok(eq2(j.ingreso_candidato, 1039.96) && eq4(j.delta_pct, -3.6905), "D2 el candidato suavizado: 1039.96 (−3.6905%)");
  ok(j.ingreso_nuevo === null || j.ingreso_nuevo === undefined, "D2 sin aplicar NO hay ingreso_nuevo");
}
{
  const { j } = await decidir(entrada({ fotos: FOTOS_REALES,
    conf: { direccion: -1, foto_id: "foto-ANTERIOR", delta_pct: -3.5 } }));
  ok(j && j.accion === "aplicar", "D3 segunda lectura en la misma dirección → aplicar");
  ok(eq2(j.ingreso_nuevo, 1039.96), "D3 aplica el valor suavizado 1039.96 (no el de una sola foto)");
  ok(j.detalle && eq2(j.detalle.ganancia_recarga, 39.96) && eq2(j.detalle.gana_buscador, 12.79) && eq2(j.detalle.gana_ernesto, 27.17),
     "D3 margen de la vuelta: 39.96 (buscador 12.79 · Ernesto 27.17)");
  ok(typeof j.porque === "string" && j.porque.includes("Dos fotos frescas"), "D3 el porqué cuenta la confirmación");
}
{
  const { j } = await decidir(entrada({ fotos: FOTOS_REALES,
    conf: { direccion: 1, foto_id: "foto-OTRA", delta_pct: 3.1 } }));
  ok(j && j.accion === "esperando_confirmacion" && Number(j.nueva_conf.direccion) === -1,
     "D4 dirección contraria: la cuenta vuelve a empezar (esperando, dirección nueva)");
}

/* ===== D5 · foto vieja / D12 · pausa ===== */
{
  const { j } = await decidir(entrada({ foto: { id: "foto-V", fresca: true, edad_min: 25 },
    conf: { direccion: -1, foto_id: "foto-A", delta_pct: -3.69 } }));
  ok(j && j.accion === "foto_vieja", "D5 foto de 25 min → foto_vieja, no se mueve");
  ok(j.nueva_conf && Number(j.nueva_conf.direccion) === -1, "D5 la confirmación armada NO se pierde por una foto vieja");
}
{
  const { j } = await decidir(entrada({ activa: false, fotos: FOTOS_REALES }));
  ok(j && j.accion === "pausa_manual", "D12 inteligencia en pausa → pausa_manual aunque el mercado pida salto");
}

/* ===== D6/D7/D8 · el piso de margen ===== */
const FOTO_PISO = [ { nivel20: 344.84, promedio_venta: 300, bankcup: 1112.00, count_sell: 60, fresca: true } ];
{
  const { j } = await decidir(entrada({ fotos: FOTO_PISO }));
  ok(j && j.piso_aplicado === true && eq2(j.ingreso_candidato, 1000),
     "D6 el mercado pide 950.01 (< costo): el objetivo es el piso 1000 (vino " + (j && j.ingreso_candidato) + ")");
  ok(j.accion === "esperando_confirmacion", "D6 aun con piso, el salto grande pide dos lecturas");
}
{
  const { j } = await decidir(entrada({ fotos: FOTO_PISO,
    conf: { direccion: -1, foto_id: "foto-ANTES", delta_pct: -7 } }));
  ok(j && j.accion === "aplicar" && j.recorte_velocidad === true && eq2(j.ingreso_nuevo, 1036.62),
     "D7 confirmado pero gigante (−7.39%): la velocidad lo recorta a −4% → 1036.62, aún sobre el piso (vino " + (j && j.ingreso_nuevo) + ")");
}
{
  const { j } = await decidir(entrada({ fotos: FOTO_PISO, ingreso_vigente: 1030,
    conf: { direccion: -1, foto_id: "foto-ANTES", delta_pct: -7 } }));
  ok(j && j.accion === "aplicar" && eq2(j.ingreso_nuevo, 1000),
     "D7b con el salto dentro de la velocidad: se aplica EL PISO exacto (1000), jamás menos (vino " + (j && j.ingreso_nuevo) + ")");
}
{
  const { j } = await decidir(entrada({ fotos: FOTO_PISO, ingreso_vigente: 1000 }));
  ok(j && eq2(j.ingreso_candidato, 1000) && !(Number(j.ingreso_nuevo) < 1000),
     "D8 ya en el piso y el mercado pide menos → la referencia NO baja de 1000");
  const k = await decidir(entrada({ fotos: [ Object.assign({}, FOTO_PISO[0], { bankcup: 1111.74 }) ],
    ingreso_vigente: 1000 }));
  ok(k.j && k.j.accion === "sin_cambio", "D8b en el piso y sin nada más que mover → sin_cambio");
}

/* ===== D9/D10/D11 · límites de velocidad ===== */
const CONF_BAJA = { direccion: -1, foto_id: "foto-ANTES", delta_pct: -3.5 };
{
  const { j } = await decidir(entrada({ fotos: FOTOS_REALES, conf: CONF_BAJA, neto_1h_pct: -3.5 }));
  ok(j && j.accion === "aplicar" && j.recorte_velocidad === true, "D9 ya bajó 3.5% en la hora → aplica RECORTADO");
  ok(eq4(j.delta_aplicado_pct, -0.5) && eq2(j.ingreso_nuevo, 1074.41),
     "D9 el recorte deja el neto de la hora en −4%: aplica −0.5% → 1074.41 (vino " + (j && j.ingreso_nuevo) + ")");
}
{
  const { j } = await decidir(entrada({ fotos: FOTOS_REALES, conf: CONF_BAJA, neto_1h_pct: -4 }));
  ok(j && j.accion === "limite_velocidad", "D10 la hora ya anda en −4%: no cabe nada → limite_velocidad");
}
{
  const { j } = await decidir(entrada({ fotos: FOTOS_REALES, conf: CONF_BAJA, neto_24h_pct: -7.9 }));
  ok(j && j.accion === "aplicar" && eq2(j.ingreso_nuevo, 1078.73),
     "D11 el límite del DÍA manda cuando es el más estrecho: aplica −0.1% → 1078.73 (vino " + (j && j.ingreso_nuevo) + ")");
}

/* ===== P · las puertas del régimen nuevo ===== */
{
  const { status, j } = await rpc("tarifa_viva_buscador");
  ok(status === 200 && j && j.ok === true, "P1 tarifa_viva_buscador responde ok");
  ok(j && !("salida_ref" in j) && !("hay_propuesta_pendiente" in j),
     "P1 FRONTERA: sin salida y sin rastro del régimen de propuestas");
  ok(j && "ultimo_ajuste" in j && (j.ultimo_ajuste === null || Number(j.ultimo_ajuste.ingreso_nuevo) > 0),
     "P1 el buscador ve el último ajuste real de su tarifa");
}
{
  const { status, j } = await rpc("tarifa_viva_estado");
  ok(status === 200 && j && j.inteligencia && j.inteligencia.activa === true, "P2 el estado trae la inteligencia activa");
  ok(j && Number(j.inteligencia.umbral_pct) === 2 && Number(j.inteligencia.vel_hora_pct) === 4 && Number(j.inteligencia.vel_dia_pct) === 8,
     "P2 la config viva es la de la orden: banda 2 · velocidad 4/hora · 8/día");
  ok(j && j.inteligencia.ultimo_movimiento && "porque" in j.inteligencia.ultimo_movimiento,
     "P2 el último movimiento trae su campo porqué (las filas del régimen viejo lo traen vacío; las del motor nuevo, en palabras — probado en D3)");
}
{
  const { status, j } = await rpc("tarifa_viva_inteligencia", { p_codigo: "CODIGO-MALO", p_activa: false });
  ok(status === 400 && j && /codigo admin no valido/.test(j.message || ""), "P3 el interruptor con código malo → error controlado (" + status + ")");
}
{
  const { status } = await rpc("tarifa_viva_evaluar", { p_simular: true });
  ok(status === 401 || status === 404, "P4 el motor sigue sin ser callable por anon (" + status + ")");
}

console.log("\nBANCO TARIFA VIVA INTELIGENTE: " + pass + " PASS · " + fail + " FAIL");
process.exitCode = fail ? 1 : 0;

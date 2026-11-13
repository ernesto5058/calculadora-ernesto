// Banco TARIFA VIVA — el cálculo del servidor y sus puertas (2026-11-13).
// CHEQUEOS fila 72. Prueba la función PURA tarifa_viva_calcular por
// PostgREST (clave pública; la función no escribe nada) y el contrato
// de las puertas de lectura:
//   · tarifa_viva_buscador: SOLO sus dos patas + frescura — JAMÁS
//     salida_ref (frontera dueño/buscador intacta);
//   · tarifa_viva_estado: la forma completa del dueño;
//   · tarifa_viva_resolver con código malo: error controlado, sin
//     escritura; tarifa_viva_evaluar NO es callable por anon (el
//     motor escribe: solo lo corre pg_cron).
// La fórmula (la del Analista): tasa_ref = nivel20 (respaldo:
// promedio_venta) · ingreso' = 360 × salida ÷ tasa_ref · libro' =
// bankcup_promedio · banda ±2% sobre el ingreso → aplicar; más →
// propuesta; idéntico → sin_cambio.
const PUB = "sb_publishable_Uchl5QnojJkZbXR5ar8vDg_5CXnqi_d";
const RPC = "https://otsudfgwpapkluusrlnj.supabase.co/rest/v1/rpc/";
let pass = 0, fail = 0;
function ok(c, n){ if (c) pass++; else { fail++; console.log("FAIL:", n); } }
async function rpc(fn, body){
  const r = await fetch(RPC + fn, { method: "POST",
    headers: { apikey: PUB, Authorization: "Bearer " + PUB, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}) });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch(e){}
  return { status: r.status, j };
}
const calc = (nivel20, promVenta, bankcup, salida, vigente, libro) =>
  rpc("tarifa_viva_calcular", { p_nivel20: nivel20, p_promedio_venta: promVenta, p_bankcup: bankcup,
    p_salida: salida, p_ingreso_vigente: vigente, p_libro_vigente: libro });

/* C1 · el caso real de hoy: nivel20 303.388, salida 910, vigente
   1098.68 → ingreso 1079.81 (−1.72%): dentro de la banda → aplicar,
   y el libro pasa al bankcup de la foto. */
{
  const { j } = await calc(303.3879781420765, 300.1591, 1111.7435, 910, 1098.68, 1069.38);
  ok(j && j.ok === true, "C1 la función responde ok con la foto de hoy");
  ok(Number(j.ingreso_nuevo) === 1079.81, "C1 ingreso' = 360×910÷303.388 = 1079.81 (vino " + (j && j.ingreso_nuevo) + ")");
  ok(Number(j.libro_nuevo) === 1111.74, "C1 libro' = bankcup_promedio redondeado (1111.74)");
  ok(Number(j.delta_pct) === -1.7175, "C1 delta −1.7175% (vino " + (j && j.delta_pct) + ")");
  ok(j.accion === "aplicar", "C1 |delta| ≤ 2% → aplicar");
}
/* C2 · salto grande: nivel20 250 → ingreso 1310.40 (+19.27%) →
   propuesta, la tarifa NO se toca. */
{
  const { j } = await calc(250, 300, 1111, 910, 1098.68, 1069.38);
  ok(Number(j.ingreso_nuevo) === 1310.40, "C2 ingreso' = 1310.40 (vino " + (j && j.ingreso_nuevo) + ")");
  ok(j.accion === "propuesta", "C2 delta > 2% → propuesta");
}
/* C3 · sin cambio: la tasa que reproduce el ingreso vigente y el
   bankcup igual al libro → sin_cambio. */
{
  const tasa = 360 * 910 / 1098.68;
  const { j } = await calc(tasa, null, 1069.38, 910, 1098.68, 1069.38);
  ok(j.accion === "sin_cambio", "C3 mercado quieto → sin_cambio (vino " + (j && j.accion) + ")");
}
/* C4 · respaldo de tasa: sin nivel20 manda promedio_venta. */
{
  const { j } = await calc(null, 300, null, 910, 1098.68, 1069.38);
  ok(Number(j.tasa_ref) === 300 && Number(j.ingreso_nuevo) === 1092, "C4 sin nivel20 → promedio_venta (ingreso 1092)");
  ok(Number(j.libro_nuevo) === 1069.38, "C4 sin bankcup → el libro se queda");
}
/* C5 · el borde exacto de la banda: +2.00% aplica; +2.10% propone. */
{
  const t2 = 360 * 910 / 1020;         // ingreso' = 1020 sobre vigente 1000
  const a = await calc(t2, null, null, 910, 1000, 900);
  ok(a.j.accion === "aplicar" && Number(a.j.delta_pct) === 2, "C5 delta = +2.00% exacto → aplicar");
  const t21 = 360 * 910 / 1021;
  const b = await calc(t21, null, null, 910, 1000, 900);
  ok(b.j.accion === "propuesta", "C5 delta = +2.10% → propuesta");
}
/* C6 · entradas inválidas: error honesto, sin inventar números. */
{
  const a = await calc(null, null, 1111, 910, 1098.68, 1069.38);
  ok(a.j.ok === false, "C6 sin tasa de venta → ok:false");
  const b = await calc(300, null, 1111, 0, 1098.68, 1069.38);
  ok(b.j.ok === false, "C6 sin salida vigente → ok:false");
}
/* C7 · la puerta del buscador: sus dos patas y NADA del dueño. */
{
  const { status, j } = await rpc("tarifa_viva_buscador");
  ok(status === 200 && j && j.ok === true, "C7 tarifa_viva_buscador responde ok");
  ok(j && j.ingreso_ref360 > 0 && j.libro_ref > 0, "C7 trae ingreso y libro vigentes");
  ok(j && !("salida_ref" in j), "C7 FRONTERA: la puerta del buscador NO trae salida_ref");
  ok(j && typeof j.hay_propuesta_pendiente === "boolean" && !("propuesta" in j),
     "C7 solo dice SI hay propuesta — jamás sus valores");
}
/* C8 · la puerta del dueño: forma completa (tarifa + foto + motor). */
{
  const { status, j } = await rpc("tarifa_viva_estado");
  ok(status === 200 && j && j.ok === true, "C8 tarifa_viva_estado responde ok");
  ok(j && j.tarifa && j.tarifa.ingreso_ref360 > 0 && "salida_ref" in j.tarifa, "C8 el dueño sí ve su tarifa entera");
  ok(j && j.motor && "propuesta" in j.motor && Array.isArray(j.motor.historial), "C8 motor con propuesta e historial");
}
/* C9 · resolver sin ser el dueño: error controlado, sin escritura. */
{
  const { status, j } = await rpc("tarifa_viva_resolver", { p_codigo: "CODIGO-MALO", p_accion: "aplicar" });
  ok(status === 400 && j && /codigo admin no valido/.test(j.message || ""), "C9 resolver con código malo → error controlado (" + status + ")");
}
/* C10 · el motor NO se puede disparar desde fuera: escribe. */
{
  const { status } = await rpc("tarifa_viva_evaluar", { p_simular: true });
  ok(status === 401 || status === 404, "C10 tarifa_viva_evaluar no es callable por anon (" + status + ")");
}

console.log("\nBANCO TARIFA VIVA · CÁLCULO Y PUERTAS: " + pass + " PASS · " + fail + " FAIL");
process.exitCode = fail ? 1 : 0;

// Banco del VIGÍA DE IVAN (2026-11-12) — la lógica pura de
// vigia-ivan/ivan.js (la MISMA que despliega la Edge Function) con
// fotos sintéticas, + la vista de ofertas NOMBRADAS del lector
// (analista.js: ofertasNombradas) que alimenta al vigía.
// Sin dependencias. Uso: node bancos/prueba-vigia-ivan.mjs
import * as V from "./fixtures/vigia-ivan.js";
import * as A from "./fixtures/mercado-analista.js";

let pass = 0, fail = 0; const fails = [];
function ok(c, n) { if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }
function cerca(a, b, tol, n) { ok(typeof a === "number" && Math.abs(a - b) <= tol, n + " (dio " + a + ")"); }

const T0 = Date.parse("2026-11-12T17:00:00Z");
const MIN = 60000;

/* ============ A) ofertasNombradas (el cambio del lector) ============ */
// Oferta estilo QvaPay: sin campo ratio (se deriva receive/amount).
const of = (username, amount, receive, extra = {}) => ({
  amount, receive, available_amount: amount,
  owner: { username }, ...extra,
});

const libroCompra = [
  of("ivanleyva", 196.49, 196.49 * 314.29),
  of("otro", 10, 10 * 315),
  of("ivanleyva", 50, 50 * 312),
  of("fantasma", 5, 5 * 2600),                    // trampa: fuera
  of("propia", 99, 99 * 314, { mine: true }),     // propia: fuera
  { amount: 7, receive: 7 * 314, available_amount: 7 }, // sin username: fuera
  of("agotada", 8, 8 * 314, { available_amount: 0 }),    // sin USD: fuera
];
const nomC = A.ofertasNombradas(libroCompra, "compra");
ok(nomC.length === 3, "NOM-1 compra: entran solo las 3 atribuibles (dio " + nomC.length + ")");
ok(nomC[0].u === "otro" && nomC[0].tasa === 315, "NOM-2 compra ordenada desc por tasa");
const ivanC = nomC.filter((f) => f.u === "ivanleyva");
ok(ivanC.length === 2, "NOM-3 las ofertas de Ivan quedan individuales (no se agregan)");
cerca(ivanC[0].saldo, ivanC[0].usd * ivanC[0].tasa, 0.02, "NOM-4 saldo = USD x tasa");
const nomV = A.ofertasNombradas([of("ivanleyva", 30, 30 * 330), of("otro", 9, 9 * 325)], "venta");
ok(nomV[0].tasa === 325 && nomV[1].tasa === 330, "NOM-5 venta ordenada asc por tasa");
const conNombre = A.ofertasNombradas([
  { amount: 180.44, receive: 180.44 * 314.29, available_amount: 180.44,
    User: { username: "ivan8oe5370", name: "Ivan" } },
], "venta");
ok(conNombre.length === 1 && conNombre[0].n === "Ivan" && conNombre[0].u === "ivan8oe5370",
  "NOM-6 el nombre visible del payload se guarda junto al username");

/* ============ B) posicionDeIvan / fotoUsable ============ */
const fotoCon = (compra, venta, extra = {}) => ({
  fresca: true, libro_ok: true,
  detalle: { ofertas_compra: compra, ofertas_venta: venta }, ...extra,
});
const F_IVAN = fotoCon(
  [{ u: "ivanleyva", tasa: 314.29, usd: 196.49, saldo: 61748.56 }],
  [],
);
const pos = V.posicionDeIvan(F_IVAN);
ok(pos && pos.lado === "compra" && pos.tasa === 314.29, "POS-1 Ivan en compra con su tasa");
cerca(pos.monto_qusd, 196.49, 1e-9, "POS-2 monto QUSD de la posición");
ok(V.posicionDeIvan(fotoCon([], [])) === null, "POS-3 ausente -> null");
const posAmbos = V.posicionDeIvan(fotoCon(
  [{ u: "IvanLeyva", tasa: 314.29, usd: 100, saldo: 31429 }],
  [{ u: "ivanleyva", tasa: 330, usd: 300, saldo: 99000 }],
));
ok(posAmbos.lado === "venta" && posAmbos.secundario?.lado === "compra",
  "POS-4 ambos lados: manda el mayor y el otro queda secundario (username sin importar mayúsculas)");
const posVarias = V.posicionDeIvan(fotoCon(
  [
    { u: "ivanleyva", tasa: 312, usd: 50, saldo: 15600 },
    { u: "ivanleyva", tasa: 314.29, usd: 196.49, saldo: 61748.56 },
  ], [],
));
ok(posVarias.tasa === 314.29, "POS-5 varias ofertas en un lado: manda su mejor tasa");
cerca(posVarias.monto_qusd, 246.49, 1e-9, "POS-6 varias ofertas en un lado: los QUSD se suman");
// La pared REAL de hoy: username ivan8oe5370 en VENTA a 314,29
const F_PARED = fotoCon([], [{ u: "ivan8oe5370", n: "Ivan", tasa: 314.29, usd: 180.44, saldo: 56710.49 }]);
const posPared = V.posicionDeIvan(F_PARED);
ok(posPared && posPared.lado === "venta" && posPared.usuario === "ivan8oe5370",
  "POS-7 la cuenta de la pared (ivan8oe5370) se reconoce como Ivan");
ok(V.esDeIvan({ u: "ivangarcia99", n: "Ivan Garcia" }) === true,
  "POS-8 respaldo: nombre visible «Ivan …» + username ivan* caza cuentas nuevas");
ok(V.esDeIvan({ u: "pedroivan", n: "Ivan" }) === false &&
   V.esDeIvan({ u: "ivanx", n: "Pedro" }) === false &&
   V.esDeIvan({ u: "otro", n: "Ivan" }) === false,
  "POS-9 el respaldo no caza nombres ajenos ni usernames que no empiezan por ivan");
ok(V.fotoUsable(F_IVAN) === true, "USE-1 foto fresca con libro y nombradas: usable");
ok(V.fotoUsable({ fresca: true, libro_ok: true, detalle: {} }) === false,
  "USE-2 foto SIN ofertas nombradas (las de antes del 2026-11-12): NO usable");
ok(V.fotoUsable({ ...F_IVAN, fresca: false }) === false, "USE-3 foto vieja: NO usable");
ok(V.fotoUsable({ ...F_IVAN, libro_ok: false }) === false, "USE-4 foto sin libro: NO usable");

/* ============ C) la máquina de estados (dos fotos o nada) ============ */
const SIN_IVAN = fotoCon([], []);
const IVAN_310 = fotoCon([{ u: "ivanleyva", tasa: 310, usd: 196.49, saldo: 60911.9 }], []);
const IVAN_180 = fotoCon([{ u: "ivanleyva", tasa: 314.29, usd: 180, saldo: 56572.2 }], []);
const NO_USABLE = { fresca: false, libro_ok: true, detalle: { ofertas_compra: [], ofertas_venta: [] } };

function correr(estado, lecturas) {
  let e = estado, eventos = [];
  for (const [foto, ms] of lecturas) {
    const r = V.evaluarVigia(e,
      { usable: V.fotoUsable(foto), posicion: V.fotoUsable(foto) ? V.posicionDeIvan(foto) : null },
      { ahoraMs: ms });
    e = r.estado;
    if (r.evento) eventos.push({ ...r.evento, avisar: r.avisar, motivo: r.motivo });
  }
  return { estado: e, eventos };
}
const baseVacia = () => ({
  presente: false, lado: null, tasa: null, monto_qusd: null,
  monto_saldo: null, secundario: null, pendiente: null, ultimo_aviso: {},
});

// APARECE confirmado en la segunda foto
{
  const { estado, eventos } = correr(baseVacia(), [
    [F_IVAN, T0], [F_IVAN, T0 + 15 * MIN],
  ]);
  ok(eventos.length === 1 && eventos[0].tipo === "aparece" && eventos[0].avisar === true,
    "EST-1 aparece: avisa recién en la SEGUNDA foto");
  ok(estado.presente && estado.tasa === 314.29, "EST-2 aparece: el estado queda con su posición");
}
// UNA foto ruidosa: aparece y se va -> jamás evento, jamás estado
{
  const { estado, eventos } = correr(baseVacia(), [
    [F_IVAN, T0], [SIN_IVAN, T0 + 15 * MIN], [SIN_IVAN, T0 + 30 * MIN],
  ]);
  ok(eventos.length === 0, "EST-3 foto ruidosa única: NINGÚN evento");
  ok(estado.presente === false && estado.pendiente === null,
    "EST-4 foto ruidosa única: el estado no se movió y el candidato murió");
}
// CAMBIA TASA
{
  const confirmado = { ...baseVacia(), presente: true, lado: "compra", tasa: 314.29, monto_qusd: 196.49, monto_saldo: 61748.56 };
  const { eventos } = correr(confirmado, [
    [IVAN_310, T0], [IVAN_310, T0 + 15 * MIN],
  ]);
  ok(eventos.length === 1 && eventos[0].tipo === "cambia_tasa" && eventos[0].avisar === true,
    "EST-5 cambia_tasa confirmado en dos fotos");
}
// CAMBIA TAMAÑO (y el borde: Δ < 1 USD no es evento)
{
  const confirmado = { ...baseVacia(), presente: true, lado: "compra", tasa: 314.29, monto_qusd: 196.49, monto_saldo: 61748.56 };
  const { eventos } = correr(confirmado, [
    [IVAN_180, T0], [IVAN_180, T0 + 15 * MIN],
  ]);
  ok(eventos.length === 1 && eventos[0].tipo === "cambia_tamano",
    "EST-6 cambia_tamano: llenado parcial de 16,49 QUSD confirmado");
  const casi = fotoCon([{ u: "ivanleyva", tasa: 314.29, usd: 196, saldo: 61601 }], []);
  const r2v = correr(confirmado, [[casi, T0], [casi, T0 + 15 * MIN]]);
  ok(r2v.eventos.length === 0, "EST-7 Δ de 0,49 QUSD: NO es evento");
}
// DESAPARECE
{
  const confirmado = { ...baseVacia(), presente: true, lado: "compra", tasa: 314.29, monto_qusd: 196.49, monto_saldo: 61748.56 };
  const { estado, eventos } = correr(confirmado, [
    [SIN_IVAN, T0], [SIN_IVAN, T0 + 15 * MIN],
  ]);
  ok(eventos.length === 1 && eventos[0].tipo === "desaparece" && estado.presente === false,
    "EST-8 desaparece confirmado en dos fotos y el estado queda fuera");
}
// La foto NO usable entre medias no confirma ni mata al candidato
{
  const { eventos } = correr(baseVacia(), [
    [F_IVAN, T0], [NO_USABLE, T0 + 15 * MIN], [F_IVAN, T0 + 30 * MIN],
  ]);
  ok(eventos.length === 1 && eventos[0].tipo === "aparece",
    "EST-9 foto no usable en el medio: el candidato sobrevive y confirma después");
}
// SILENCIOSO (base): una sola foto aplica directo y NO avisa
{
  const r = V.evaluarVigia(baseVacia(),
    { usable: true, posicion: V.posicionDeIvan(F_IVAN) },
    { ahoraMs: T0, silencioso: true });
  ok(r.evento?.tipo === "aparece" && r.avisar === false && r.motivo === "base",
    "EST-10 base silenciosa: aplica la posición sin avisar");
  ok(r.estado.presente === true, "EST-11 base silenciosa: el estado queda fijado");
}
// ENFRIAMIENTO: el mismo tipo dentro de 60 min se registra pero NO avisa
{
  const e0 = {
    ...baseVacia(), presente: true, lado: "compra", tasa: 314.29,
    monto_qusd: 196.49, monto_saldo: 61748.56,
    ultimo_aviso: { cambia_tasa: T0 },
  };
  const dentro = correr(e0, [[IVAN_310, T0 + 10 * MIN], [IVAN_310, T0 + 25 * MIN]]);
  ok(dentro.eventos.length === 1 && dentro.eventos[0].avisar === false &&
     dentro.eventos[0].motivo === "enfriamiento",
    "EST-12 enfriamiento: evento confirmado a los 25 min NO se avisa");
  ok(dentro.estado.tasa === 310, "EST-13 enfriamiento: el estado SÍ se actualiza");
  const fuera = correr(e0, [[IVAN_310, T0 + 50 * MIN], [IVAN_310, T0 + 65 * MIN]]);
  ok(fuera.eventos.length === 1 && fuera.eventos[0].avisar === true,
    "EST-14 pasado el enfriamiento (65 min) el mismo tipo SÍ avisa");
}

/* ============ D) el texto del aviso y la lectura del resto ============ */
{
  const { titulo, cuerpo } = V.textoAvisoIvan(
    { tipo: "aparece", antes: null, despues: V.posicionDeIvan(F_IVAN) }, "12 nov 12:30");
  ok(titulo.includes("IVAN APARECIÓ"), "TXT-1 título de aparición");
  ok(cuerpo.includes("314,29") && cuerpo.includes("196,49"), "TXT-2 el cuerpo trae tasa y tamaño");
  // 1 270,08 / 314,29 = 4,0412… -> $4,04 QUSD (miles con espacio
  // inseparable: la regex \s lo cubre igual)
  ok(/1\s270,08/.test(cuerpo) && cuerpo.includes("$4,04"),
    "TXT-3 la lectura del resto: 1 270,08 de saldo a su tasa = $4,04 QUSD");
  const des = V.textoAvisoIvan(
    { tipo: "desaparece", antes: V.posicionDeIvan(F_IVAN), despues: null }, "12 nov 13:00");
  ok(/1\s270,08/.test(des.cuerpo), "TXT-4 al desaparecer también se lee el resto");
  const pared = V.textoAvisoIvan(
    { tipo: "aparece", antes: null, despues: V.posicionDeIvan(F_PARED) }, "12 nov 12:45");
  ok(pared.cuerpo.includes("@ivan8oe5370"),
    "TXT-5 el aviso nombra la cuenta cazada (auditoría del cazado)");
  ok(pared.cuerpo.includes("vendiendo, no comprando"),
    "TXT-6 en el lado de venta la lectura del resto lo dice tal cual");
}

console.log(`\nVIGÍA IVAN: ${pass} PASS · ${fail} FAIL`);
if (fail) { console.log("Fallos:", fails.join(" · ")); process.exit(1); }

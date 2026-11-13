// Banco del SENSOR SMS v2 (cerebro / logica.js): la aritmética de las
// respuestas del atajo que pregunta — propuesta de total por forma de
// precio, validaciones del libro (entero sin coma, QUSD 2 decimales),
// mapeo de menús y consumo FIFO de lotes con costo contra el lote.
import {
  aNumero, enteroPositivo, qusdValido, claseDeMenu, resolverCompra,
  costoConsumo, formatoMonto,
} from "./supabase/functions/maximo-cerebro/logica.js";

let pass = 0, fail = 0;
function eq(nombre, real, esperado) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (ok) { pass++; console.log("PASS", nombre); }
  else {
    fail++;
    console.log("FAIL", nombre, "\n  real:    ", JSON.stringify(real),
      "\n  esperado:", JSON.stringify(esperado));
  }
}

// --- coerción y validaciones del libro ---
eq("aNumero número", aNumero(2.6), 2.6);
eq("aNumero texto", aNumero("2.6"), 2.6);
eq("aNumero basura", aNumero("abc"), null);
eq("entero 7800", enteroPositivo(7800), 7800);
eq("entero '7800'", enteroPositivo("7800"), 7800);
eq("entero 5881.2 rechazado", enteroPositivo(5881.2), null);
eq("entero 0 rechazado", enteroPositivo(0), null);
eq("entero negativo rechazado", enteroPositivo(-5), null);
eq("qusd 12.50", qusdValido(12.5), 12.5);
eq("qusd '6'", qusdValido("6"), 6);
eq("qusd 3 decimales rechazado", qusdValido(1.234), null);
eq("qusd 0 rechazado", qusdValido(0), null);

// --- menús (el texto viaja, la clase se decide en el servidor) ---
eq("menú por unidad", claseDeMenu("Por unidad (ej. 2.6)"), "tasa");
eq("menú por recarga", claseDeMenu("Por recarga (ej. 900)"), "recarga");
eq("menú total", claseDeMenu("Total que pagué"), "total");
eq("menú venta", claseDeMenu("Venta"), "venta");
eq("menú devolución", claseDeMenu("Devolución de capital"), "devolucion");
eq("menú traspaso", claseDeMenu("Traspaso"), "traspaso");
eq("menú basura", claseDeMenu("otra cosa"), null);
eq("menú no-texto", claseDeMenu(42), null);

// --- propuesta de compra (la regla del redondeo: manda el total) ---
eq("tasa 2.6 × 3000", resolverCompra("tasa", 2.6, 3000), { total: 7800, tasa_efectiva: 2.6 });
eq("tasa como texto", resolverCompra("tasa", "2.6", "3000"), { total: 7800, tasa_efectiva: 2.6 });
eq("recarga 900 × 1440", resolverCompra("recarga", 900, 1440), { total: 3600, tasa_efectiva: 2.5 });
eq("recarga 900 × 3000 (fracción de recarga)", resolverCompra("recarga", 900, 3000), { total: 7500, tasa_efectiva: 2.5 });
eq("total directo", resolverCompra("total", 7800, 3000), { total: 7800, tasa_efectiva: 2.6 });
eq("total no entero = sin propuesta", resolverCompra("total", 5881.2, 2262), null);
eq("tasa con producto no entero redondea la PROPUESTA", resolverCompra("tasa", 2.6, 2262), { total: 5881, tasa_efectiva: 2.5999 });
eq("forma desconocida", resolverCompra("magia", 2.6, 3000), null);
eq("cantidad cero", resolverCompra("tasa", 2.6, 0), null);

// --- consumo FIFO de lotes ---
const LOTES = [
  { id: "L1", cantidad_restante: 3000, costo_restante_cup: 7800 },
  { id: "L2", cantidad_restante: 1440, costo_restante_cup: 3600 },
];
eq("venta dentro del primer lote", costoConsumo(LOTES, 1800),
  { consumos: [{ id: "L1", cantidad: 1800, costo: 4680 }], costo_total: 4680 });
eq("venta que agota el lote se lleva su costo entero", costoConsumo(LOTES, 3000),
  { consumos: [{ id: "L1", cantidad: 3000, costo: 7800 }], costo_total: 7800 });
eq("venta a caballo entre lotes", costoConsumo(LOTES, 3600),
  { consumos: [{ id: "L1", cantidad: 3000, costo: 7800 }, { id: "L2", cantidad: 600, costo: 1500 }], costo_total: 9300 });
eq("venta mayor que los lotes = null (no se asienta)", costoConsumo(LOTES, 5000), null);
eq("lotes vacíos = null", costoConsumo([], 100), null);

// --- formato de las preguntas ---
eq("formato 3000.0", formatoMonto(3000.0), "3000");
eq("formato 1270.08", formatoMonto(1270.08), "1270.08");
eq("formato 2262", formatoMonto("2262"), "2262");

console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);

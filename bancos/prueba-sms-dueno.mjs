// Banco del SENSOR SMS v3.1 — LA PREGUNTA «¿DE QUIÉN ES?» (2026-11-14):
// el mapeo del menú de dueño (puro, en logica.js del cerebro) y las
// aserciones de fuente del cableado de la ruta «sms_respuesta» (la
// respuesta de buscador crea la espera operada CON TASA y la asienta
// contra el SMS; jamás cae en el asiento de compra propia). La parte
// viva (es_prueba, con limpieza) vive en prueba-sms-dueno-vivo.mjs.
import { readFileSync } from "node:fs";
import { duenoDeMenu, claseDeMenu } from "../supabase/functions/maximo-cerebro/logica.js";

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

// --- el menú de dueño: el texto viaja, el código se decide aquí ---
eq("dueño briku", duenoDeMenu("Es de Briku"), "BRIKU-EUX");
eq("dueño abraham", duenoDeMenu("Es de Abraham"), "ABRAHAM-X30");
eq("dueño propia", duenoDeMenu("Compra propia"), "propia");
eq("dueño otro", duenoDeMenu("Otro"), "otro");
eq("dueño minúsculas", duenoDeMenu("es de briku"), "BRIKU-EUX");
eq("dueño con cola de texto", duenoDeMenu("Es de Abraham (él lo trajo)"), "ABRAHAM-X30");
eq("dueño con espacios", duenoDeMenu("  Compra propia  "), "propia");
eq("dueño basura", duenoDeMenu("de un primo"), null);
eq("dueño vacío", duenoDeMenu(""), null);
eq("dueño no-texto", duenoDeMenu(42), null);
eq("dueño null", duenoDeMenu(null), null);

// --- los menús viejos no se mueven (regresión del mapeo compartido) ---
eq("menú venta intacto", claseDeMenu("Venta"), "venta");
eq("menú por unidad intacto", claseDeMenu("Por unidad (ej. 2.6)"), "tasa");
eq("menú devolución intacto", claseDeMenu("Devolución de capital"), "devolucion");

// --- el cableado vive en la fuente del cerebro (aserciones) ---
const idx = readFileSync(new URL("../supabase/functions/maximo-cerebro/index.ts", import.meta.url), "utf8");
eq("ruta usa la puerta operada CON TASA", idx.includes("espera_crear_operada_tasa"), true);
eq("ruta asienta contra el SMS", idx.includes("espera_asentar_interna"), true);
eq("ruta cancela la espera huérfana", idx.includes("espera_cancelar"), true);
eq("la rama mapea el menú en el servidor", idx.includes("duenoDeMenu"), true);
eq("las respuestas quedan pa arbitraje", idx.includes("respuestas_dueno"), true);
eq("el evento se marca vía atajo_dueno", idx.includes("atajo_dueno"), true);
eq("la cantidad esperada = llegado + 5 (un envío)", idx.includes("p_cantidad: monto + 5"), true);

console.log(`\n${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);

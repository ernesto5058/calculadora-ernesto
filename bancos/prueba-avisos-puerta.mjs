// =====================================================================
// Banco de la PUERTA de la emisora «avisos» — FAIL-CLOSED
// (TANDA 1 Inspector Ola 2: el 🔴 «avisos fail-open»).
// La decisión vive en supabase/functions/avisos/logica.js (pura,
// patrón de la casa) y este banco la prueba tal cual, más aserciones
// de fuente: index.ts USA la decisión y no queda rastro del patrón
// fail-open `if (secreto && …)`.
// Estados exigidos:
//   sin secreto configurado -> 503 (no envía nada)
//   secreto del evento malo/ausente -> 401
//   secreto correcto -> pasa
// =====================================================================
import { readFileSync } from "node:fs";
import { decidirAcceso } from "../supabase/functions/avisos/logica.js";

let pass = 0, fail = 0; const fails = [];
function ok(c, n) { if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }

/* (a) Sin secreto configurado: 503 SIEMPRE, traiga lo que traiga. */
ok(decidirAcceso("", "lo-que-sea").status === 503, "A1 sin secreto en entorno (vacío) -> 503");
ok(decidirAcceso(undefined, "lo-que-sea").status === 503, "A2 sin secreto en entorno (undefined) -> 503");
ok(decidirAcceso("", "").status === 503, "A3 sin secreto en entorno y evento vacío -> 503 (no pasa)");
ok(decidirAcceso(null, null).permitido === false, "A4 tipos raros (null) -> no permitido");

/* (b) Con secreto fijado: malo o ausente -> 401. */
ok(decidirAcceso("secreto-real", "secreto-malo").status === 401, "B1 secreto del evento malo -> 401");
ok(decidirAcceso("secreto-real", undefined).status === 401, "B2 evento sin secreto -> 401");
ok(decidirAcceso("secreto-real", "").status === 401, "B3 evento con secreto vacío -> 401");
ok(decidirAcceso("secreto-real", 12345).status === 401, "B4 secreto no-string -> 401");

/* (c) Con secreto fijado y correcto: pasa. */
const bueno = decidirAcceso("secreto-real", "secreto-real");
ok(bueno.permitido === true && bueno.status === undefined, "C1 secreto correcto -> permitido");

/* (d) Aserciones de fuente sobre index.ts: la puerta se USA. */
const src = readFileSync(new URL("../supabase/functions/avisos/index.ts", import.meta.url), "utf8");
ok(src.includes('from "./logica.js"'), "D1 index.ts importa logica.js");
ok(src.includes("decidirAcceso("), "D2 index.ts invoca decidirAcceso");
ok(!/if\s*\(\s*secreto\s*&&/.test(src), "D3 sin rastro del patrón fail-open `if (secreto && …)`");
ok(src.includes("status: 503"), "D4 index.ts responde 503 en la rama sin secreto");

console.log(`\nprueba-avisos-puerta: ${pass} PASS · ${fail} FAIL`);
if (fail) { console.log("Fallos:", fails.join(" | ")); process.exit(1); }

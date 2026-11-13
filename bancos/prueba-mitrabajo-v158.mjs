// Banco v1.5.8 — Mi Trabajo, inspección de la cadena del dinero (2026-11-13):
//   0) REGLA DE CONTEO DE BONOS (orden de Ernesto): saldo suma solo
//      recargas COMPLETAS de 360 (floor) y transferencia solo cuenta
//      desde 5.000 CUP (monto >= 5000); el publicador de Mi Negocio
//      emite recargas completas y el monto del trato. CHEQUEOS fila 67.
// Hereda de la v1.5.7 (tanda PRO):
//   1) EL SW NO TOCA LA API: su handler fetch devuelve el control en
//      cuanto el metodo no es GET o el destino es supabase.co. La Cache
//      Storage es GET-only: en WebKit (iPhone de Ernesto) un POST RPC
//      cruzado que pasaba por caches.match/put moria en silencio y la
//      tarifa viva «no respondia» con el servidor sano (los GET —
//      datos.json — entraban; los POST, no). CHEQUEOS fila 64.
//   2) PISO PRO EN LA CARA CLARA (DISENO-PRO §8/§9): cristal real en
//      la barra (glass translucido + blur), degradado real en el
//      acento, radios del sistema 20/14, sombra suave en tarjetas,
//      rejilla en los rellenos grandes, iconos a trazo 1.7.
//   3) datos.json NO se toca: sigue anunciando la APK 1.5.6 (la 1.5.7
//      es web; mover versionApp dispararia un aviso fantasma en los
//      APK instalados — mismo criterio que la 1.5.4).
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "buscadores/index.html", "utf8");
const sinScript = fs.readFileSync(REPO + "buscadores-app/index-sin-script.html", "utf8");
const sw = fs.readFileSync(REPO + "buscadores/sw.js", "utf8");
const datos = JSON.parse(fs.readFileSync(REPO + "buscadores/datos.json", "utf8"));
let pass = 0, fail = 0;
function ok(c, n){ if (c) pass++; else { fail++; console.log("FAIL:", n); } }

/* ===== Versión ===== */
ok(/var APP_VERSION = "1\.5\.8"/.test(html), "V1 APP_VERSION 1.5.8 en el build ensamblado");
ok(sw.includes('CACHE = "mitrabajo-v26"'), "V2 el SW sube a mitrabajo-v26");
ok(datos.versionApp === "1.5.6", "V3 datos.json sigue anunciando la APK 1.5.6 (web-only, sin aviso fantasma)");
ok(html.includes('version:"1.5.8"'), "V4 SENTRY_CASA con version 1.5.8");

/* ===== La cura de la tarifa: el SW deja pasar la API ===== */
const fetchBody = sw.slice(sw.indexOf('addEventListener("fetch"'));
ok(fetchBody.includes('e.request.method !== "GET"'), "S1 el handler devuelve el control si el metodo no es GET");
ok(fetchBody.includes('supabase.co'), "S2 el handler devuelve el control si el destino es supabase.co");
ok(fetchBody.indexOf('e.request.method !== "GET"') < fetchBody.indexOf("respondWith"), "S3 la guarda va ANTES del primer respondWith");
ok((sw.match(/indexOf\("mitrabajo-"\) === 0/g) || []).length >= 1, "S4 el activate sigue borrando solo su prefijo (fila 41)");

/* ===== Piso PRO en la capa de identidad ===== */
ok(sinScript.includes("--glass: rgba(255,255,255,.88)"), "D1 glass translucido (no blanco solido)");
ok(!sinScript.includes("--dorado-grad: linear-gradient(135deg, #0B5FFF 0%, #0B5FFF 100%)"), "D2 fuera el degradado plano de un solo color");
ok(sinScript.includes("#3D8BFF 0%, #0B5FFF 48%, #0A4CD6 100%"), "D3 degradado real de tres paradas en el acento");
ok(sinScript.includes("--r-md: 14px; --r-lg: 20px"), "D4 radios del sistema (14/20)");
ok(!/--sombra-1:\s*none/.test(sinScript), "D5 las tarjetas tienen sombra suave (no none)");
ok(sinScript.includes("padding: 16px 16px 116px"), "D6 relleno de pantalla en rejilla (16, no 14)");
ok(sinScript.includes("stroke-width: 1.7"), "D7 iconos a trazo fino 1.7");
ok(sinScript.includes("min-height: 56px; padding: 10px 18px"), "D8 boton Actualizar a 56 px (calle: >=56)");
ok(html.includes("--glass: rgba(255,255,255,.88)"), "D9 el build publicado lleva la capa nueva");

/* ===== Regla de conteo de bonos en el panel ===== */
const nFloor = (html.match(/Math\.floor\(Number\(tr\.recargas\)/g) || []).length;
ok(nFloor >= 3, "B1 los contadores de saldo aplican floor (recargas COMPLETAS) en los 3 sitios: " + nFloor);
const n5000 = (html.match(/\(Number\(tr\.monto\) \|\| 0\) >= 5000/g) || []).length;
ok(n5000 >= 3, "B2 los contadores de transferencia exigen monto >= 5000 en los 3 sitios: " + n5000);

console.log("\nBANCO MI TRABAJO v1.5.8 (bonos + PRO + SW/API): " + pass + " PASS · " + fail + " FAIL");
process.exit(fail ? 1 : 0);

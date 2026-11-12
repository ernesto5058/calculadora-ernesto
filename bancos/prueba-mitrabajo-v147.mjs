// Copia para CI (GitHub Actions) del banco vivo en research_notes — mismos chequeos,
// solo cambia la raíz del repo, que se resuelve desde este archivo (o BANCO_REPO).
// Si el banco vivo cambia, se refresca esta copia.
/* Banco v1.4.7 — Mi Trabajo: la TANDA DE 3 ERRORES llega también
   aquí porque el kit de chat/medios es PARALELO en las dos apps
   (la misma lección que en Mi Negocio, aplicada dos veces):
   (a) la nota de voz en cola se ESCUCHA (antes era un chip sordo),
   (b) su duración sale del temporizador de grabación (fin del
       «0:00» eterno),
   (c) el fallo de envío deja de ser mudo: 3 intentos → «⚠️ No se
       pudo enviar» y toque para reintentar, sin bloquear la cola,
   (d) el clip abre la FOTO en un toque (la hoja, a presión larga),
   (e) regresión de Textos: la vía única aprobada en v1.4.6 intacta
       (3 botones propios, sin producto, sin monedas ajenas).
   Aserciones sobre el build ENSAMBLADO; el jsdom no puede grabar
   audio real, así que la duración se verifica en su cableado. */
import fs from "fs";

import { fileURLToPath } from "url";
const RAIZ = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/$/, "");
const html = fs.readFileSync(RAIZ + "/buscadores/index.html", "utf8");
const sw = fs.readFileSync(RAIZ + "/buscadores/sw.js", "utf8");
const datos = JSON.parse(fs.readFileSync(RAIZ + "/buscadores/datos.json", "utf8"));

let pass = 0, fail = 0;
function ok(c, n){ if (c) pass++; else { fail++; console.log("FAIL:", n); } }

/* ---- Versión y caché ---- */
ok(/var APP_VERSION = "1\.5\.4"/.test(html), "P1 APP_VERSION 1.5.4 en el build ensamblado");
ok(sw.includes('CACHE = "mitrabajo-v21"'), "P2 el SW sube a mitrabajo-v21 (sin esto, el arreglo no aterriza)");
ok(datos.versionApp === "1.5.2" && /apk-v1\.5\.2\/Mi-Trabajo-v1\.5\.2\.apk$/.test(datos.apkUrl),
   "P3 datos.json: versionApp 1.5.2 y apkUrl de la v1.5.2");

/* ---- Chat duro v1.4.7 ---- */
ok(!html.includes("Nota de voz · en cola"), "C1 el chip sordo «Nota de voz · en cola» ya NO existe: la nota en cola se pinta con su reproductor");
ok(html.includes('reproductorVozHtmlMT({ id: "cola-" + it.opId, adj_datos: it.adj.datos, adj_dur: it.adj.dur || null })'), "C2 (v1.5.0) las notas en cola se pintan con su reproductor y su duración DIRECTO en su nodo (clave estable «cola-<opId>»; retirado el truco del marcador VC de la v1.4.7)");
ok(/dur: Math\.max\(1, Math\.round\(\(Date\.now\(\) - grabT0MT\) \/ 1000\)\)/.test(html), "C3 al grabar, la duración se captura del TEMPORIZADOR (grabT0MT), no del metadato del archivo");
ok(html.includes("dur: CHAT_ADJ.dur || null"), "C4 el adjunto que entra a la cola conserva la duración");
ok(html.includes("estFallo") && html.includes("No se pudo enviar — toca el mensaje para reintentar"), "C5 el estado «⚠️ No se pudo enviar» existe y explica su salida (tocar para reintentar)");
ok(html.includes("data-colafallida") && html.includes("x.fallida = true"), "C6 la burbuja fallida es tocable para reintentar y el despacho marca fallida al tercer intento");
ok(/a\.filter\(function\(x\)\{ return !x\.fallida; \}\)\[0\]/.test(html), "C7 una fallida NO bloquea la cola: el despacho salta a la primera que no lo esté");
ok(html.includes("filaAdjMT") && html.includes("elegirFotoNativaMT") && html.includes("pickImages") && html.includes('filaAdjMT("c_adj_cam", "c_file_cam")') && html.includes('filaAdjMT("c_adj_arch", "c_file_arch")') && !html.includes("clipLargoMT"), "C8 (v1.5.0, orden de Ernesto) el clip abre la HOJA en un toque; «Foto o vídeo» usa la galería nativa del APK (@capacitor/camera pickImages) con caída al selector web, Cámara y Documento disparan su selector; la presión larga quedó retirada");
ok(html.includes("salen JUNTO con la foto, en un solo mensaje") || html.includes("sale JUNTO con la foto, en un solo mensaje"), "C9 la previa de la foto dice que el texto sale junto, en UN solo mensaje");

/* ---- Regresión de Textos (lo aprobado en v1.4.6, intacto) ---- */
ok(html.includes('id="tx_saldo"') && html.includes("textoComproSaldoPRO") && html.includes("textoRecargaCambioPRO") && html.includes("textoTransferenciaPRO"), "T1 Textos sigue con sus TRES botones propios y nada más");
ok(!html.includes("Texto de producto") && !html.includes("txpNombre") && !html.includes("Texto de saldo (con la tarifa)"), "T2 Mi Trabajo NO gana el botón de producto ni los textos del dueño (esa línea es de Mi Negocio)");
ok(!/>USD</.test(html) && !/>MLC</.test(html) && !/>QUSD</.test(html), "T3 Mi Trabajo sigue hablando SOLO en CUP (sin monedas ajenas)");

/* ---- Regresión de la guía (v1.4.6 sigue viva en la nueva versión) ---- */
ok(html.includes("¿Para qué es esta app?") && html.includes("llevar TUS cuentas claras"), "T4 la guía del trabajador sigue en Ayuda");

console.log("\nBANCO MI TRABAJO v1.4.7: " + pass + " PASS · " + fail + " FAIL");
process.exit(fail ? 1 : 0);

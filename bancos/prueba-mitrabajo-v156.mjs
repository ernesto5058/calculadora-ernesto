// Banco v1.5.6 — Mi Trabajo, cierre APK estrellas: APP_VERSION por fin igual a la versión publicada (la tanda web v1.5.6 no lo había subido y la APK enseñaba un aviso eterno de «hay una versión nueva»).
// del motor IA compartido (Edge Function «textos-generar»).
//   - Las plantillas locales murieron: textoComproSaldoPRO /
//     textoRecargaCambioPRO / textoTransferenciaPRO / txVersionesPRO /
//     publicoCfg / DEFAULT_PUBLICO no existen ni en fuentes ni en build.
//   - Selector de producto pintado desde el catálogo del motor, con
//     cache «busc_textos_catalogo_v1»; cantidad SOLO para saldo y su
//     equivalencia la calcula el servidor (viaja «cantidad»).
//   - Estilo fijo PRO: humanizado / completo / wa / muchos / mayus.
//   - Respaldo offline: cada éxito guarda «busc_textos_paquete_v1»;
//     si la llamada falla, ese paquete se muestra con el aviso
//     «Sin conexión: último paquete generado el …».
//   - X8 (v145) intacto: el motor compartido en el cliente sigue
//     slim (solo miles + historialPush).
// La 1.5.4 / mitrabajo-v21 son de la tanda Sentry en vuelo: esta
// tanda toma la siguiente libre, 1.5.6 / mitrabajo-v24 (APK apk-v1.5.6, versionCode 10507).
import { JSDOM } from "jsdom";
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "buscadores/index.html", "utf8");
const src = fs.readFileSync(REPO + "buscadores-app/app.js", "utf8");
const sinScript = fs.readFileSync(REPO + "buscadores-app/index-sin-script.html", "utf8");
const sw = fs.readFileSync(REPO + "buscadores/sw.js", "utf8");
const datos = JSON.parse(fs.readFileSync(REPO + "buscadores/datos.json", "utf8"));
let pass = 0, fail = 0; const fails = [];
function ok(c, n){ if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const COD = "BUSC-1";
const hoyISO = new Date().toISOString();

/* ===== Versión (1.5.6: la que anuncia datos.json y trae el release) ===== */
ok(/var APP_VERSION = "1\.5\.6"/.test(html), "V1 APP_VERSION 1.5.6 en el build ensamblado");
ok(sw.includes('CACHE = "mitrabajo-v24"'), "V2 el SW sube a mitrabajo-v24");
ok(datos.versionApp === "1.5.6", "V3 datos.json anuncia la APK 1.5.6, que ya existe como release apk-v1.5.6");

/* ===== Muertes y presencias estructurales ===== */
for (const muerto of ["textoComproSaldoPRO", "textoRecargaCambioPRO", "textoTransferenciaPRO", "txVersionesPRO", "txRapidoSaldo", "txRapidoRecarga", "txRapidoTransf", "DEFAULT_PUBLICO", "publicoCfg", 'id="tx_saldo"', 'id="tx_recarga"', 'id="tx_transf"']) {
  ok(!html.includes(muerto) && !src.includes(muerto), "M muere en build y fuentes: " + muerto);
}
for (const vivo of ["textos-generar", "busc_textos_catalogo_v1", "busc_textos_paquete_v1", 'id="tx_cat"', 'id="tx_generar"', 'id="tx_cant_saldo"', 'id="tx_cant_box"', 'id="tx_out"', 'id="tx_hist"', "cargarCatalogoTextos", "txGenerarTextos"]) {
  ok(html.includes(vivo), "P vive en el build: " + vivo);
}
ok(sinScript.includes("los escribe la IA con los datos vivos de Ernesto"), "P-ayuda la vista explica la novedad (IA con datos vivos; sin conexión, último paquete)");
ok(html.includes("function miles") && html.includes("function historialPush") && !/TextosMotor = \(function\(\)\{[^}]*generar/.test(html), "X8 el motor compartido en el cliente sigue slim (miles + historialPush, sin generar)");

/* ===== Comportamiento con el motor simulado ===== */
let MODO = "ok";
let cuerpos = {};
function crear(){
  cuerpos = {};
  const dom = new JSDOM(html, { url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/", runScripts: "dangerously", pretendToBeVisual: true, beforeParse(w){
    w.localStorage.setItem("busc_codigo", COD);
    w.prompt = () => "x"; w.confirm = () => true;
    w.fetch = function(url, opts){
      const u = String(url);
      const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v ?? null)), json: () => Promise.resolve(v) });
      const err = (msg, st) => Promise.resolve({ ok: false, status: st || 400, text: () => Promise.resolve(JSON.stringify({ message: msg })), json: () => Promise.resolve({ message: msg }) });
      const red = () => Promise.reject(new TypeError("Failed to fetch"));
      if (u.includes("datos.json")) return json({ version: 6, versionApp: "1.5.2", tarifa: { ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, bonoSaldoMeta: 150, bonoSaldoMonto: 300, bonoTransfMeta: 10, bonoTransfMonto: 300 }, actualizado: "2026-11-12" });
      if (u.includes("textos-generar")) {
        let body = {}; try { body = JSON.parse(opts?.body || "{}"); } catch(e){}
        cuerpos[body.accion] = body;
        if (MODO === "caida") return red();
        if (body.accion === "catalogo") return json({ ok: true, items: [ { clave: "saldo", nombre: "Compro saldo", tipo: "saldo" }, { clave: "transferencia", nombre: "Transferencia", tipo: "transferencia" }, { clave: "bateria", nombre: "Batería LiFePO4", tipo: "producto" } ], telefono: "51231558", zona: "Micro 10" });
        if (body.accion === "generar") return json({ ok: true, versiones: [ { enfoque: "directo", texto: "IA " + body.clave + (body.cantidad ? " cant " + body.cantidad : "") } ], avisos: [] });
        return err("400", 400);
      }
      if (u.includes("/rpc/")) {
        const fn = u.split("/rpc/")[1].split("?")[0];
        if (MODO === "caida") return red();
        switch (fn) {
          case "validar_usuario": return json([{ codigo: COD, nombre: "Busc Uno", activo: true, bloqueado: false }]);
          case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 950, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: hoyISO });
          case "leer_panel": return json({ ok: true, nombre: "Busc Uno", tratos: [] });
          case "ver_presencia": return json({ ok: true, usuarios: [] });
          case "mensajes_sin_leer": return json({ ok: true, sin_leer: 0 });
          case "leer_chat_ligero": return json({ ok: true, mensajes: [] });
          default: return json({ ok: true });
        }
      }
      return err("404", 404);
    };
  }});
  return dom.window;
}
{
  MODO = "ok";
  const w = crear(); const d = w.document;
  await sleep(800);
  w.showView("Textos");
  await sleep(400);
  const chips = [...d.querySelectorAll("#tx_cat .chip")];
  ok(chips.length === 3 && chips[2].textContent.includes("Batería"), "C1 el selector se pinta desde el catálogo del motor (incluye productos, no solo saldo/transferencia)");
  const catCache = JSON.parse(w.localStorage.getItem("busc_textos_catalogo_v1") || "null");
  ok(catCache && Array.isArray(catCache.items) && catCache.items.length === 3, "C2 el catálogo se cachea en busc_textos_catalogo_v1");
  ok(cuerpos["catalogo"] && cuerpos["catalogo"].codigo === COD && cuerpos["catalogo"].accion === "catalogo", "C3 la llamada de catálogo va con el código de SESIÓN del buscador");
  chips[2].click(); await sleep(150);
  ok(d.getElementById("tx_cant_box").classList.contains("hide"), "C4 en un producto la cantidad se oculta (solo saldo la usa)");
  chips[0].click(); await sleep(150);
  ok(!d.getElementById("tx_cant_box").classList.contains("hide"), "C5 en saldo la cantidad vuelve a verse");
  d.getElementById("tx_cant_saldo").value = "1500";
  d.getElementById("tx_generar").click();
  await sleep(400);
  const g = cuerpos["generar"] || {};
  ok(g.codigo === COD && g.clave === "saldo" && g.cantidad === 1500, "G1 generar: código de sesión + clave saldo + cantidad (la equivalencia la calcula el servidor)");
  ok(g.tono === "humanizado" && g.tamano === "completo" && g.destino === "wa" && g.emojis === "muchos" && g.mayus === true && g.urgencia === false && g.privado === false && g.hashtags === false, "G2 estilo fijo PRO completo en el cuerpo de la llamada");
  ok(d.getElementById("tx_out").textContent.includes("IA saldo cant 1500"), "G3 las versiones del motor se pintan con Copiar/WhatsApp (txPintar)");
  const paq = JSON.parse(w.localStorage.getItem("busc_textos_paquete_v1") || "null");
  ok(paq && paq.clave === "saldo" && paq.versiones.length === 1 && !!paq.cuando, "G4 el éxito guarda el paquete {clave, versiones, cuando} en busc_textos_paquete_v1");
  const hist = JSON.parse(w.localStorage.getItem("busc_textos_v1") || "[]");
  ok(hist.length === 1 && hist[0].texto.includes("IA saldo"), "G5 el historial de siempre recibe la versión generada");
  /* Fallo con paquete: aviso honesto con fecha */
  MODO = "caida";
  d.getElementById("tx_generar").click();
  await sleep(500);
  const outOff = d.getElementById("tx_out").textContent;
  ok(outOff.includes("IA saldo cant 1500") && outOff.includes("Sin conexión: último paquete generado el"), "F1 si el motor falla, se muestra el último paquete con «Sin conexión: último paquete generado el …»");
  const hist2 = JSON.parse(w.localStorage.getItem("busc_textos_v1") || "[]");
  ok(hist2.length === 1, "F2 el respaldo offline NO duplica el historial");
  w.close();
}
{
  /* Fallo sin paquete: mensaje honesto, nada inventado */
  MODO = "caida";
  const w = crear(); const d = w.document;
  await sleep(800);
  w.showView("Textos");
  await sleep(300);
  d.getElementById("tx_generar").click();
  await sleep(500);
  ok(d.getElementById("tx_out").textContent.includes("aún no tienes un paquete guardado"), "F3 sin paquete y sin red: aviso honesto, ningún texto inventado en el cliente");
  w.close();
}

console.log("\nBANCO MI TRABAJO v1.5.6 (Estrellas + Mi cupo · cierre APK): " + pass + " PASS · " + fail + " FAIL");
if (fails.length) console.log("Fallos:", fails.join(" · "));
process.exit(fail ? 1 : 0);

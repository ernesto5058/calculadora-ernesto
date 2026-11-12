/* Pruebas jsdom de «Mi Trabajo» v1.2 — login único, sesión, guarda de versión.
   El fetch y Capacitor se inyectan con un script-semilla ANTES del script de la
   app (sustituyendo el marcador del ensamblado), igual que correría en el APK.
   Los envíos van contra stubs: no se escribe nada en la base real. */
import { JSDOM } from "/tmp/jsdomtest/node_modules/jsdom/lib/api.js";
import fs from "fs";

const htmlBase = fs.readFileSync("buscadores/index.html", "utf8");
const datos = JSON.parse(fs.readFileSync("buscadores/datos.json", "utf8"));
const URL_APP = "https://ernesto5058.github.io/calculadora-ernesto/buscadores/";

let n = 0, ok = 0;
function t(nombre, cond) { n++; if (cond) { ok++; console.log("PASS", nombre); } else console.log("FAIL", nombre); }
function espera(ms) { return new Promise(r => setTimeout(r, ms)); }
async function hastaQue(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 3000)) { if (fn()) return true; await espera(100); }
  return fn();
}

function semilla(seedLS) {
  const rpc = {
    "BUSCA-001": { nombre: "Briku", activo: true },
    "BUSCA-002": { nombre: "Abraham", activo: true },
    "NUEVO-1": { nombre: "Nuevo", activo: true },
    "INACTIVO-1": { nombre: "Inactivo", activo: false }
  };
  let s = "<script>\n";
  s += "window.__llamadas = [];\n";
  s += "window.Capacitor = { isNativePlatform: function(){ return true; } };\n";
  s += "var FIX = { datos: " + JSON.stringify(datos) + ", rpc: " + JSON.stringify(rpc) + " };\n";
  s += "window.fetch = function(url, opts){ window.__llamadas.push(String(url)); url = String(url);"
     + " function resp(b){ return Promise.resolve({ ok: true, json: function(){ return Promise.resolve(b); } }); }"
     + " if (url.indexOf('rpc/validar_usuario') !== -1) { var p = {}; try { p = JSON.parse((opts && opts.body) || '{}'); } catch(e){}"
     + " var k = String(p.p_codigo || '').toUpperCase(); var u = FIX.rpc[k];"
     + " return u ? resp([{ codigo: k, nombre: u.nombre, activo: u.activo }]) : resp([]); }"
     + " if (url.indexOf('rpc/registrar_reporte') !== -1) return resp('uuid-rep-1');"
     + " if (url.indexOf('rpc/registrar_ayuda') !== -1) return resp('uuid-ayu-1');"
     + " if (url.indexOf('rpc/estado_') !== -1) return resp([]);"
     + " if (url.indexOf('datos.json') !== -1) return resp(FIX.datos);"
     + " return resp([]); };\n";
  for (const [k, v] of Object.entries(seedLS || {}))
    s += "try { localStorage.setItem(" + JSON.stringify(k) + ", " + JSON.stringify(v) + "); } catch(e){}\n";
  s += "</" + "script>\n";
  return s;
}

function hacerDOM(url, seedLS) {
  const marca = '<script>\n"use strict";';
  if (!htmlBase.includes(marca)) throw new Error("No se encontró el marcador del script de la app");
  const html = htmlBase.replace(marca, semilla(seedLS) + marca);
  const dom = new JSDOM(html, { url, runScripts: "dangerously", pretendToBeVisual: true });
  return dom;
}
const gateOculto = d => d.getElementById("loginGate").classList.contains("hide");
const sesion = w => w.localStorage.getItem("busc_codigo");

/* ---------- (a) sin sesión: cartel visible y app bloqueada ---------- */
{
  const dom = hacerDOM(URL_APP, {}); const w = dom.window, d = w.document;
  await espera(700);
  t("(a) sin sesion: cartel visible", !gateOculto(d));
  t("(a) sin sesion: fondo bloqueado (locked)", d.body.classList.contains("locked"));
  t("(a) sin sesion: nada guardado", sesion(w) === null);
  t("(f) no existe campo de codigo en Reportar", !d.getElementById("r_cod"));
  t("(f) no existe campo de codigo en Ayuda", !d.getElementById("a_cod"));
  t("(f) no existe campo de codigo en Mi panel", !d.getElementById("p_code"));
  t("version visible 1.2.1", d.getElementById("verLab").textContent === "1.2.1");
  t("sin bucle de actualizacion (datos 1.1.0 < app 1.2.0)", d.getElementById("updBox").classList.contains("hide"));
  t("set SVG presente (simbolos)", !!d.querySelector("symbol#i-calc") && !!d.querySelector("symbol#i-lock"));
  t("boton Actualizar presente", !!d.getElementById("btnAct"));
  t("frescura: etiqueta con la fecha publicada", d.getElementById("freshTxt").textContent.includes("2026-11-10"));
  dom.window.close();
}

/* ---------- (b) login válido + (f) reportar/ayuda con la sesión ---------- */
{
  const dom = hacerDOM(URL_APP, {}); const w = dom.window, d = w.document;
  await espera(500);
  d.getElementById("l_cod").value = "briku-sef";           // en minúsculas: debe normalizar
  d.getElementById("l_btn").click();
  t("(b) login valido: entra (cartel fuera)", await hastaQue(() => gateOculto(d)));
  t("(b) login valido: sesion guardada canonica", sesion(w) === "BUSCA-001");
  t("(b) login valido: fondo desbloqueado", !d.body.classList.contains("locked"));
  d.getElementById("tabPanel").click();
  t("(b) panel muestra su nombre", d.getElementById("p_ses").textContent.includes("Briku"));
  t("(b) se llamo a validar_usuario", w.__llamadas.some(u => u.includes("rpc/validar_usuario")));
  // calculadora intacta con la tarifa del fixture
  d.getElementById("tabCalc").click();
  const precio = 950, exc = datos.tarifa.ingresoRef360 - precio;
  d.getElementById("s_precio").value = String(precio); d.getElementById("s_cant").value = "1";
  d.getElementById("s_precio").dispatchEvent(new w.Event("input"));
  t("calculo saldo intacto", d.getElementById("s_fee").textContent === "$" + (exc * datos.tarifa.pctSaldo / 100).toFixed(2));
  // (f) reportar sin campo de codigo: el reporte sale con la sesion
  d.getElementById("tabRep").click();
  d.getElementById("r_precio").value = "950"; d.getElementById("r_tel").value = "51234567";
  d.getElementById("r_btn").click();
  await espera(900);
  const ob = JSON.parse(w.localStorage.getItem("busc_outbox") || "[]");
  t("(f) reporte enviado con la sesion", ob.length === 1 && ob[0].buscador === "BUSCA-001" && ob[0].enviado === true && ob[0].id === "uuid-rep-1");
  t("(f) estado del reporte con punto CSS (sin emoji)", d.getElementById("r_lista").innerHTML.includes('class="dot"'));
  // ayuda con la sesion
  d.getElementById("tabAyuda").click();
  d.getElementById("a_msg").value = "La cuenta de transferencia me sale rara";
  d.getElementById("a_btn").click();
  await espera(900);
  const ay = JSON.parse(w.localStorage.getItem("busc_ayuda") || "[]");
  t("(f) ayuda enviada con la sesion", ay.length === 1 && ay[0].buscador === "BUSCA-001" && ay[0].enviado === true);
  // boton Actualizar: vuelve a pedir datos.json
  const antes = w.__llamadas.filter(u => u.includes("datos.json")).length;
  d.getElementById("btnAct").click();
  await espera(700);
  const despues = w.__llamadas.filter(u => u.includes("datos.json")).length;
  t("Actualizar vuelve a buscar datos.json", despues > antes);
  dom.window.close();
}

/* ---------- (c) login inválido: NO se guarda nada ---------- */
for (const [etq, cod] of [["desconocido (caso PEUEBA)", "PEUEBA"], ["en Supabase pero no en datos.json", "NUEVO-1"], ["desactivado", "INACTIVO-1"]]) {
  const dom = hacerDOM(URL_APP, {}); const w = dom.window, d = w.document;
  await espera(500);
  d.getElementById("l_cod").value = cod;
  d.getElementById("l_btn").click();
  await espera(1500);
  t("(c) invalido " + etq + ": cartel sigue visible", !gateOculto(d));
  t("(c) invalido " + etq + ": sesion NO guardada", sesion(w) === null);
  t("(c) invalido " + etq + ": mensaje de Ernesto", d.getElementById("l_warn").textContent === "Ese código no aparece. Revísalo con Ernesto.");
  dom.window.close();
}

/* ---------- (d) enlace personal válido: entra solo ---------- */
{
  const dom = hacerDOM(URL_APP + "?codigo=BUSCA-002", {}); const w = dom.window, d = w.document;
  t("(d) ?codigo= valido: entra solo", await hastaQue(() => gateOculto(d)));
  t("(d) ?codigo= valido: sesion guardada", sesion(w) === "BUSCA-002");
  dom.window.close();
}

/* ---------- (e) enlace personal inválido: cartel, nada guardado ---------- */
{
  const dom = hacerDOM(URL_APP + "?codigo=PEUEBA", {}); const w = dom.window, d = w.document;
  await espera(1800);
  t("(e) ?codigo= invalido: cartel visible", !gateOculto(d));
  t("(e) ?codigo= invalido: nada guardado", sesion(w) === null);
  t("(e) ?codigo= invalido: sin mensaje de error pegado", d.getElementById("l_warn").style.display !== "block");
  dom.window.close();
}

/* ---------- (g) guarda de versión en applyData ---------- */
{
  const dom = hacerDOM(URL_APP, {}); const w = dom.window, d = w.document;
  await espera(700);
  const tarifaVieja = { version: 3, actualizado: "2026-11-09", buscadores: datos.buscadores,
    tarifa: Object.assign({}, datos.tarifa, { ingresoRef360: 1 }) };
  w.eval("applyData(" + JSON.stringify(tarifaVieja) + ", false)");
  t("(g) version menor NO pisa la aplicada", w.eval("T.ingresoRef360") === datos.tarifa.ingresoRef360);
  const tarifaNueva = { version: 5, actualizado: "2026-11-10", buscadores: datos.buscadores,
    tarifa: Object.assign({}, datos.tarifa, { ingresoRef360: 2000 }) };
  w.eval("applyData(" + JSON.stringify(tarifaNueva) + ", false)");
  t("(g) version mayor SI se aplica", w.eval("T.ingresoRef360") === 2000);
  dom.window.close();
}

/* ---------- (h) sesión guardada entra directo + Salir vuelve el blur ---------- */
{
  const dom = hacerDOM(URL_APP, { busc_codigo: "BUSCA-001" }); const w = dom.window, d = w.document;
  t("(h) con sesion guardada entra directo", await hastaQue(() => gateOculto(d), 2000));
  d.getElementById("tabPanel").click();
  t("(h) panel abierto con la sesion (al llegar los datos)", await hastaQue(() => !d.getElementById("p_body").classList.contains("hide"), 2500));
  d.getElementById("btnSalir").click();
  await espera(300);
  t("(h) Salir limpia la sesion", sesion(w) === null);
  t("(h) Salir: vuelve el cartel", !gateOculto(d));
  t("(h) Salir: vuelve el fondo borroso (locked)", d.body.classList.contains("locked"));
  dom.window.close();
}

console.log("\nRESULTADO: " + ok + "/" + n);
process.exit(ok === n ? 0 : 1);

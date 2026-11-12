/* Pruebas jsdom de «Mi Trabajo» v1.3.0 — hereda el banco de la v1.2.1
   (login único, sesión, guarda de versión) y añade las del CHAT +
   PRESENCIA: latido al entrar, enviar con los parámetros correctos,
   hilo con globos de ambos lados, distintivo de sin-leer y que un
   fallo de tocar_presencia (puertas aún sin activar) NO rompe la app.
   CAMBIO DOCUMENTADO: la comprobación «(f) ayuda enviada con la
   sesión» de la v1.2.1 se sustituye por su equivalente de chat,
   porque la v1.3.0 retira el formulario de ayuda (registrar_ayuda)
   y la pestaña pasa a ser el chat. El resto del banco es idéntico.
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

function semilla(seedLS, opts) {
  opts = opts || {};
  const rpc = {
    "BUSCA-001": { nombre: "Briku", activo: true },
    "BUSCA-002": { nombre: "Abraham", activo: true },
    "NUEVO-1": { nombre: "Nuevo", activo: true },
    "INACTIVO-1": { nombre: "Inactivo", activo: false }
  };
  const ahora = new Date().toISOString();
  const chat = [
    { id: 1, de: "ADMIN", para: "BUSCA-001", texto: "¿Cómo va la búsqueda de hoy?", creado: ahora, leido: false },
    { id: 2, de: "BUSCA-001", para: "ADMIN", texto: "Bien, conseguí dos vendedores", creado: ahora, leido: true }
  ];
  let s = "<script>\n";
  s += "window.__llamadas = []; window.__rpc = [];\n";
  s += "window.Capacitor = { isNativePlatform: function(){ return true; } };\n";
  const vivoTarifa = { ok: true, ingreso_ref360: 1200, libro_ref: 1100, salida_ref: 960, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: ahora };
  const vivoPanel = { ok: true, nombre: "Briku", tratos: [{ fecha: "2026-11-10", tipo: "saldo", nota: "Trato en vivo", recargas: 2, comision: 50 }] };
  s += "var FIX = { datos: " + JSON.stringify(datos) + ", rpc: " + JSON.stringify(rpc) + ", chat: " + JSON.stringify(chat) + ", sinLeer: 2, vivoTarifa: " + JSON.stringify(vivoTarifa) + ", vivoPanel: " + JSON.stringify(vivoPanel) + " };\n";
  s += "window.fetch = function(url, opts){ window.__llamadas.push(String(url)); url = String(url);"
     + " var pb = {}; try { pb = JSON.parse((opts && opts.body) || '{}'); } catch(e){}"
     + " function resp(b){ return Promise.resolve({ ok: true, json: function(){ return Promise.resolve(b); } }); }"
     + " function resp404(){ return Promise.resolve({ ok: false, status: 404, json: function(){ return Promise.resolve({ message: 'not found' }); } }); }"
     + " if (url.indexOf('rpc/') !== -1) window.__rpc.push({ fn: url.slice(url.indexOf('rpc/') + 4), body: pb });"
     + " if (url.indexOf('rpc/validar_usuario') !== -1) {"
     + " var k = String(pb.p_codigo || '').toUpperCase(); var u = FIX.rpc[k];"
     + " return u ? resp([{ codigo: k, nombre: u.nombre, activo: u.activo }]) : resp([]); }"
     + " if (url.indexOf('rpc/registrar_reporte') !== -1) return resp('uuid-rep-1');"
     + " if (url.indexOf('rpc/registrar_ayuda') !== -1) return resp('uuid-ayu-1');"
     + " if (url.indexOf('rpc/tocar_presencia') !== -1) return " + (opts.fallaPresencia ? "resp404()" : "resp({ ok: true })") + ";"
     + " if (url.indexOf('rpc/enviar_mensaje') !== -1) return resp({ ok: true, id: 7 });"
     + " if (url.indexOf('rpc/leer_chat') !== -1) return resp({ ok: true, mensajes: FIX.chat });"
     + " if (url.indexOf('rpc/mensajes_sin_leer') !== -1) return resp({ ok: true, sin_leer: FIX.sinLeer });"
     + " if (url.indexOf('rpc/leer_tarifa') !== -1) return " + (opts.vivo ? "resp(FIX.vivoTarifa)" : "resp404()") + ";"
     + " if (url.indexOf('rpc/leer_panel') !== -1) return " + (opts.vivo ? "resp(FIX.vivoPanel)" : "resp404()") + ";"
     + " if (url.indexOf('rpc/estado_') !== -1) return resp([]);"
     + " if (url.indexOf('datos.json') !== -1) return resp(FIX.datos);"
     + " return resp([]); };\n";
  for (const [k, v] of Object.entries(seedLS || {}))
    s += "try { localStorage.setItem(" + JSON.stringify(k) + ", " + JSON.stringify(v) + "); } catch(e){}\n";
  s += "</" + "script>\n";
  return s;
}

function hacerDOM(url, seedLS, opts) {
  const marca = '<script>\n"use strict";';
  if (!htmlBase.includes(marca)) throw new Error("No se encontró el marcador del script de la app");
  const html = htmlBase.replace(marca, semilla(seedLS, opts) + marca);
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
  t("(v13) el formulario viejo de ayuda ya no existe", !d.getElementById("a_btn") && !d.getElementById("a_msg"));
  t("(v13) la pestaña es el Chat y trae su distintivo", !!d.getElementById("chatBadge") && d.getElementById("tabAyuda").textContent.includes("Chat"));
  t("version visible 1.3.0", d.getElementById("verLab").textContent === "1.3.0");
  t("sin bucle de actualizacion (datos 1.2.1 < app 1.3.0)", d.getElementById("updBox").classList.contains("hide"));
  t("set SVG presente (simbolos)", !!d.querySelector("symbol#i-calc") && !!d.querySelector("symbol#i-lock"));
  t("boton Actualizar presente", !!d.getElementById("btnAct"));
  t("frescura: etiqueta con la fecha publicada", d.getElementById("freshTxt").textContent.includes("2026-11-10"));
  dom.window.close();
}

/* ---------- (b) login válido + reportar con la sesión + CHAT ---------- */
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
  // (v13) presencia: el latido sale al entrar, con su codigo
  const lat = w.__rpc.find(r => r.fn === "tocar_presencia");
  t("(v13) latido de presencia al entrar (tocar_presencia)", !!lat && lat.body.p_codigo === "BUSCA-001");
  // (v13) distintivo con los sin-leer del stub (2)
  t("(v13) distintivo del chat encendido con el conteo", await hastaQue(() => !d.getElementById("chatBadge").classList.contains("hide") && d.getElementById("chatBadge").textContent === "2"));
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
  // (v13) CHAT: al abrir la pestaña se carga el hilo con globos de ambos lados
  d.getElementById("tabAyuda").click();
  t("(v13) el hilo pinta globos de Ernesto y del buscador", await hastaQue(() => d.querySelector("#c_hilo .msg.him") && d.querySelector("#c_hilo .msg.me")));
  t("(v13) el hilo trae el texto de ambos", d.getElementById("c_hilo").textContent.includes("¿Cómo va la búsqueda de hoy?") && d.getElementById("c_hilo").textContent.includes("conseguí dos vendedores"));
  const lc = w.__rpc.find(r => r.fn === "leer_chat");
  t("(v13) leer_chat llamado con (su codigo, ADMIN, su clave)", !!lc && lc.body.p_codigo === "BUSCA-001" && lc.body.p_con === "ADMIN" && lc.body.p_clave === "BUSCA-001");
  t("(v13) tras leer, el distintivo se apaga (leer marca leido)", d.getElementById("chatBadge").classList.contains("hide"));
  // (v13) enviar un mensaje a Ernesto con los parametros correctos
  d.getElementById("c_txt").value = "Tengo una duda con un trato de saldo";
  d.getElementById("c_btn").click();
  await espera(600);
  const em = w.__rpc.filter(r => r.fn === "enviar_mensaje").pop();
  t("(v13) enviar_mensaje con (de=sesion, para=ADMIN, clave=sesion, texto)", !!em && em.body.p_de === "BUSCA-001" && em.body.p_para === "ADMIN" && em.body.p_clave === "BUSCA-001" && em.body.p_texto === "Tengo una duda con un trato de saldo");
  t("(v13) la caja queda limpia tras enviar", d.getElementById("c_txt").value === "");
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

/* ---------- (i) v1.3.0: tocar_presencia caído (SQL sin pegar) NO rompe nada ---------- */
{
  const dom = hacerDOM(URL_APP, {}, { fallaPresencia: true }); const w = dom.window, d = w.document;
  await espera(500);
  d.getElementById("l_cod").value = "BUSCA-001";
  d.getElementById("l_btn").click();
  t("(i) con tocar_presencia en 404 la app entra igual", await hastaQue(() => gateOculto(d)));
  d.getElementById("tabCalc").click();
  const precio = 950, exc = datos.tarifa.ingresoRef360 - precio;
  d.getElementById("s_precio").value = String(precio); d.getElementById("s_cant").value = "1";
  d.getElementById("s_precio").dispatchEvent(new w.Event("input"));
  t("(i) la calculadora sigue viva con la puerta caida", d.getElementById("s_fee").textContent === "$" + (exc * datos.tarifa.pctSaldo / 100).toFixed(2));
  dom.window.close();
}

/* ---------- (j) v1.3.0: tarifa y panel EN VIVO mandan sobre datos.json ---------- */
{
  const dom = hacerDOM(URL_APP, { busc_codigo: "BUSCA-001" }, { vivo: true }); const w = dom.window, d = w.document;
  t("(j) entra con la sesion guardada", await hastaQue(() => gateOculto(d), 2000));
  t("(j) leer_tarifa aplicado: T.ingresoRef360 = 1200 (vivo)", await hastaQue(() => w.eval("T.ingresoRef360") === 1200));
  t("(j) leer_panel llamado con su codigo", w.__rpc.some(r => r.fn === "leer_panel" && r.body.p_codigo === "BUSCA-001"));
  t("(j) frescura: «Tarifa actualizada» con la hora viva", d.getElementById("freshTxt").textContent.includes("Tarifa actualizada"));
  d.getElementById("tabCalc").click();
  d.getElementById("s_precio").value = "950"; d.getElementById("s_cant").value = "1";
  d.getElementById("s_precio").dispatchEvent(new w.Event("input"));
  t("(j) la calculadora usa la tarifa viva (250 x 25% = $62.50)", d.getElementById("s_fee").textContent === "$62.50");
  d.getElementById("tabPanel").click();
  t("(j) «Mis tratos» sale de leer_panel (total $50.00)", await hastaQue(() => d.getElementById("p_total").textContent === "$50.00"));
  t("(j) el trato en vivo se pinta en el panel", d.getElementById("p_tratos").textContent.includes("Trato en vivo"));
  dom.window.close();
}

console.log("\nRESULTADO: " + ok + "/" + n);
process.exit(ok === n ? 0 : 1);

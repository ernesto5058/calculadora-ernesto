// Banco CHAT PRO v45 (Mi Negocio) — hermano de test-minegocio-banco.mjs.
// Cubre las piezas nuevas de la tanda «Chat de buscadores PRO»:
// tarjeta de parte con Confirmar/Rechazar por la cola, «Crear espera
// con esto» (parte_crear con p_confirmada + p_buscador), tarjeta de
// tarifa con su hora, cabecera viva con las cifras de la fixture,
// difusión 📣 y «Buscar más» con p_buscar. Sin dinero real: fixtures.
import fs from "fs";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "url";
const RAIZ = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/$/, "");
const genMN = fs.readFileSync(RAIZ + "/minegocio/index.html", "utf8");
let pass = 0, fail = 0;
function ok(c, n){ if (c) pass++; else { fail++; console.log("FAIL:", n); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function click(el){ if (el) el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); }
function input(el, v){ el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true })); }

const adminValido = "CODIGO-PRUEBA";
const datosPubMN = { version: 4, versionApp: "1.3.1", apkUrl: "https://example.invalid/apk", tarifa: { version: 4, ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, bonoSaldoRecargas: 150, bonoSaldoCUP: 300, bonoTransfTratos: 10, bonoTransfCUP: 300 } };
const mercadoMN = { ts: "2026-11-11T02:00:00Z", ETECSA: { average: 304.86, average_buy: 290, average_sell: 320, count: 55 }, BANK_CUP: { average: 1068.44, average_buy: 1050, average_sell: 1090, count: 40 } };
const snapParte = JSON.stringify({ parte_id: "parte-1", tipo: "saldo", tasa: 2, total_pagado: 5000, telefono: "51234567", estado: "pendiente" });
const snapTarifa = JSON.stringify({ ingresoRef360: 1098.68, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, hora: "2026-11-18T15:30:00.000Z" });
let chatMsgsCP = [
  { id: "p1", de: "BUSC-1", para: "ADMIN", texto: "", creado: new Date().toISOString(), leido: false, adj_tipo: "parte", adj_datos: snapParte },
  { id: "t1", de: "ADMIN", para: "BUSC-1", texto: "", creado: new Date().toISOString(), leido: true, adj_tipo: "tarifa", adj_datos: snapTarifa },
  { id: "m1", de: "BUSC-1", para: "ADMIN", texto: "compré saldo a tasa 2 por 5000, mi teléfono 51234567", creado: new Date().toISOString(), leido: false }
];
let cuerposCP = {};   // último cuerpo por RPC
let conteosCP = {};   // nº de llamadas por RPC
let parteConfirmarFalla = false;

function crearCP(){
  cuerposCP = {}; conteosCP = {};
  const dom = new JSDOM(genMN, { url: "https://ernesto5058.github.io/calculadora-ernesto/minegocio/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w){
      const pre = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [{ codigo: "BUSC-1", nombre: "Busc Uno", activo: true }], datos: datosPubMN, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
      try { w.localStorage.setItem("minegocio_v1", JSON.stringify(pre)); } catch(e){}
      w.Element.prototype.scrollIntoView = function(){};
      w.fetch = function(url, opts){
        const u = String(url);
        const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v === undefined ? null : v)), json: () => Promise.resolve(v) });
        const rechaza = (msg, st) => Promise.resolve({ ok: false, status: st || 404, text: () => Promise.resolve(JSON.stringify({ message: msg || "404" })), json: () => Promise.resolve({ message: msg || "404" }) });
        if (u.includes("/rpc/")) {
          const fn = u.split("/rpc/")[1].split("?")[0];
          let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch(e){}
          cuerposCP[fn] = body; conteosCP[fn] = (conteosCP[fn] || 0) + 1;
          switch (fn) {
            case "ver_presencia": return json({ ok: true, usuarios: [{ codigo: "BUSC-1", nombre: "Busc Uno", visto: new Date().toISOString() }] });
            case "mensajes_sin_leer": return json({ ok: true, por_usuario: {}, total: 0 });
            case "leer_chat": return json({ ok: true, mensajes: chatMsgsCP, fijado: null, fijado_tipo: null });
            case "leer_perfil": return json(null);
            case "tocar_presencia": return json({ ok: true });
            case "marcar_recibidos": return json({ ok: true, marcados: 0 });
            case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 950, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: "2026-11-18 10:30" });
            case "admin_reportes": return json([]);
            case "admin_ayudas": return json([]);
            case "admin_usuarios": return json([{ codigo: "BUSC-1", nombre: "Busc Uno", activo: true }, { codigo: "BUSC-2", nombre: "Busc Dos", activo: true }, { codigo: "BUSC-3", nombre: "Busc Tres", activo: false }]);
            case "admin_cierres": return json([]);
            case "admin_actividad": return json([]);
            case "dinero_leer_estado": return json({ ok: true, rol: "ernesto", entregas: [{ buscador: "BUSC-1", pendiente: 7000 }], asignaciones: [{ buscador: "BUSC-1", porciento: 32 }], ganancias: { por_buscador: [{ buscador: "BUSC-1", acumulado: { comision: 1234, ganancia_ernesto: 2000 }, semana: { comision: 0, ganancia_ernesto: 0 }, hoy: { comision: 0, ganancia_ernesto: 0 } }] } });
            case "dinero_capital_estado": return json({ ok: true, cupos: [{ buscador: "BUSC-1", resumen: { en_mano: 7000, trabajando: 3000, cerrado: false } }] });
            case "parte_leer": return json({ ok: true, id: "parte-1", estado: "pendiente", tipo: "saldo", tasa: 2, total_pagado: 5000, telefono: "51234567" });
            case "parte_confirmar": return parteConfirmarFalla ? rechaza("sin red simulada", 500) : json({ ok: true, espera_id: "esp-1", repetida: false });
            case "parte_rechazar": return json({ ok: true });
            case "parte_crear": return json({ ok: true, parte_id: "parte-2", estado: "confirmada", espera_id: "esp-2", repetida: false });
            case "enviar_mensaje_todos": return json({ ok: true, enviados: 2 });
            case "enviar_mensaje": return json({ ok: true, id: 99 });
            case "fijar_mensaje": return json({ ok: true });
          }
          return rechaza("desconocida " + fn);
        }
        if (u.includes("datos.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(datosPubMN) });
        if (u.includes("ultimo.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(mercadoMN) });
        return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
      };
    } });
  return dom.window;
}
async function abrirChatCP(w){
  const d = w.document;
  await sleep(700);
  w.irA("Equipo");
  await sleep(250);
  click(d.querySelector("[data-chat]"));
  await sleep(600);
  return d;
}
function colaDe(w){ return JSON.parse(w.localStorage.getItem("minegocio_v1")).cola || []; }
function btnHoja(d, texto){
  return Array.prototype.slice.call(d.querySelectorAll("#hojaBtns button")).filter(function(b){ return b.textContent.indexOf(texto) >= 0; })[0];
}

{ /* CP-1 · la tarjeta de parte pendiente se pinta como TARJETA con Confirmar */
  const w = crearCP(); const d = await abrirChatCP(w);
  const tarj = d.querySelector('#chHilo [data-mid="p1"] .tarjChat');
  ok(!!tarj, "CP-1a el mensaje adj_tipo='parte' se pinta como tarjeta (.tarjChat), no como burbuja de texto");
  ok(!!tarj && tarj.textContent.includes("Parte de compra") && tarj.textContent.includes("Esperando confirmación"), "CP-1b la tarjeta trae título y sello «Esperando confirmación»");
  ok(!!tarj && !!tarj.querySelector("[data-parte-confirmar]") && !!tarj.querySelector("[data-parte-rechazar]"), "CP-1c pendiente: la tarjeta trae Confirmar y Rechazar");
  w.close();
}
{ /* CP-2 · Confirmar encola UNA confirmarParte (aunque se toque dos veces con la puerta caída) */
  parteConfirmarFalla = true;
  const w = crearCP(); const d = await abrirChatCP(w);
  const btn = d.querySelector('[data-parte-confirmar="p1"]');
  click(btn); await sleep(300);
  click(d.querySelector('[data-parte-confirmar="p1"]')); await sleep(300);
  const conf = colaDe(w).filter(a => a.tipo === "confirmarParte");
  ok(conf.length === 1, "CP-2a Confirmar encola exactamente UNA confirmarParte");
  ok(conf.length === 1 && String(conf[0].parteId) === "parte-1" && !!conf[0].opId, "CP-2b la acción lleva parteId y opId");
  ok((conteosCP["parte_confirmar"] || 0) >= 1 && cuerposCP["parte_confirmar"] && String(cuerposCP["parte_confirmar"].p_parte_id) === "parte-1", "CP-2c el despacho llamó parte_confirmar con el parte");
  parteConfirmarFalla = false;
  w.close();
}
{ /* CP-3 · «Crear espera con esto» viaja con p_confirmada=true y p_buscador=chatCon */
  const w = crearCP(); const d = await abrirChatCP(w);
  const m = chatMsgsCP.filter(x => x.id === "m1")[0];
  w.hojaMensajeMN(m); await sleep(60);
  click(btnHoja(d, "Crear espera con esto")); await sleep(60);
  ok(!!d.getElementById("ceTasa") && !!d.getElementById("ceTotal"), "CP-3a la hoja del parte se abre con sus campos");
  input(d.getElementById("ceTasa"), "2"); input(d.getElementById("ceTotal"), "5000"); input(d.getElementById("ceTel"), "51234567");
  click(btnHoja(d, "Crear la espera")); await sleep(400);
  const pc = cuerposCP["parte_crear"] || {};
  ok(pc.p_confirmada === true, "CP-3b parte_crear viaja con p_confirmada=true");
  ok(pc.p_buscador === "BUSC-1", "CP-3c parte_crear viaja con p_buscador = chatCon");
  ok(Number(pc.p_total_pagado) === 5000 && Number(pc.p_tasa) === 2, "CP-3d tasa y total pagado viajan tal cual se guardaron");
  w.close();
}
{ /* CP-4 · la tarjeta de tarifa se pinta como tarjeta con su hora */
  const w = crearCP(); const d = await abrirChatCP(w);
  const tarj = d.querySelector('#chHilo [data-mid="t1"] .tarjChat');
  ok(!!tarj && tarj.textContent.includes("Tarifa de las"), "CP-4a el mensaje adj_tipo='tarifa' se pinta como tarjeta con «Tarifa de las …»");
  ok(!!tarj && tarj.textContent.includes("1.099") && tarj.textContent.includes("950"), "CP-4b la tarjeta enseña el ingreso y la salida del snapshot");
  w.close();
}
{ /* CP-5 · la cabecera viva pinta las cifras de la fixture */
  const w = crearCP(); const d = await abrirChatCP(w);
  const vivo = d.getElementById("chVivo");
  ok(!!vivo && vivo.textContent.includes("En mano 7.000"), "CP-5a cabecera: «En mano 7.000» de dinero_leer_estado");
  ok(!!vivo && vivo.textContent.includes("Ciclo: 3.000 CUP trabajando"), "CP-5b cabecera: el ciclo de dinero_capital_estado");
  ok(!!vivo && vivo.textContent.includes("Él gana 1.234"), "CP-5c cabecera: «Él gana 1.234» de las ganancias por buscador");
  w.close();
}
{ /* CP-6 · difusión 📣: la hoja nombra la N de activos y el envío va por enviar_mensaje_todos */
  const w = crearCP(); const d = await abrirChatCP(w);
  click(d.getElementById("chDifBtn")); await sleep(300);
  const btnDif = btnHoja(d, "Enviar a todos");
  ok(!!btnDif && btnDif.textContent.includes("(2)"), "CP-6a la hoja de difusión dice «Enviar a todos (2)» (activos de admin_usuarios)");
  input(d.getElementById("difTx"), "Mañana no trabajo");
  click(btnDif); await sleep(400);
  ok(cuerposCP["enviar_mensaje_todos"] && cuerposCP["enviar_mensaje_todos"].p_texto === "Mañana no trabajo" && !!cuerposCP["enviar_mensaje_todos"].p_op_id, "CP-6b la difusión salió por enviar_mensaje_todos con texto y opId");
  w.close();
}
{ /* CP-7 · «Buscar más» usa el p_buscar de leer_chat */
  const w = crearCP(); const d = await abrirChatCP(w);
  input(d.getElementById("chBuscar"), "saldo");
  const antes = conteosCP["leer_chat"] || 0;
  click(d.getElementById("chBuscarMas")); await sleep(300);
  ok((conteosCP["leer_chat"] || 0) > antes && cuerposCP["leer_chat"] && cuerposCP["leer_chat"].p_buscar === "saldo", "CP-7 «Buscar más» llama leer_chat con p_buscar = lo tecleado");
  w.close();
}

console.log("\nBANCO MI NEGOCIO CHAT PRO v45: " + pass + " PASS · " + fail + " FAIL");
process.exit(fail ? 1 : 0);

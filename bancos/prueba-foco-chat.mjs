// Copia para CI (GitHub Actions) del banco vivo en research_notes — mismos chequeos,
// solo cambia la raíz del repo, que se resuelve desde este archivo (o BANCO_REPO).
// Si el banco vivo cambia, se refresca esta copia.
/* Banco CHAT PRO (fila 22 de CHEQUEOS-ETERNOS) — la sonda de foco
   que Ernesto ordenó tras cazar el teclado que se cerraba solo en
   Mi Negocio v11 (2026-11-12): el refresco del hilo cada 3 s hacía
   `pgChat.innerHTML` TOTAL — compositor incluido — y el nodo
   enfocado moría: foco a BODY y teclado cerrado en iOS.
   Contrato eterno, en las DOS apps:
   1. Tras un repintado directo Y tras 2 ciclos reales del refresco,
      el compositor es el MISMO nodo, sigue conectado,
      document.activeElement es él, y conserva valor y selección.
   2. El repintado del hilo es INCREMENTAL: la burbuja que ya estaba
      conserva su nodo cuando llega un mensaje nuevo.
   3. Disciplina de scroll: si el usuario está leyendo arriba, el
      refresco NO lo arrastra abajo; si está pegado abajo, sí sigue.
   4. El buscador del chat también sobrevive al refresco (MN).
   5. D1: en Textos (MN), Producto → Saldo/Transf CIERRA el
      formulario de producto y la salida se trae a la vista.
   6. La hoja 📎 se abre con UN toque en el clip y sus filas
      (Foto o vídeo · Cámara · Documento) disparan el selector
      correcto en el mismo gesto. */
import fs from "fs";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "url";
const RAIZ = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/$/, "");
const genMN = fs.readFileSync(RAIZ + "/minegocio/index.html", "utf8");
const genMT = fs.readFileSync(RAIZ + "/buscadores/index.html", "utf8");
let pass = 0, fail = 0;
function ok(c, n){ if (c) pass++; else { fail++; console.log("FAIL:", n); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function click(el){ if (el) el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); }
function input(el, v){ el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true })); }
function layoutFalso(el, sh, ch){
  Object.defineProperty(el, "scrollHeight", { configurable: true, get(){ return sh; } });
  Object.defineProperty(el, "clientHeight", { configurable: true, get(){ return ch; } });
}

/* ================= MI NEGOCIO ================= */
const adminValido = "CODIGO-PRUEBA";
const datosPubMN = { version: 4, versionApp: "1.3.1", apkUrl: "https://example.invalid/apk", tarifa: { version: 4, ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, bonoSaldoRecargas: 150, bonoSaldoCUP: 300, bonoTransfTratos: 10, bonoTransfCUP: 300 }, buscadores: [{ codigo: "BUSC-1", nombre: "Busc Uno", tratos: [] }] };
const mercadoMN = { ts: "2026-11-11T02:00:00Z", ETECSA: { average: 304.86, average_buy: 290, average_sell: 320, count: 55 }, BANK_CUP: { average: 1068.44, average_buy: 1050, average_sell: 1090, count: 40 } };
let chatMsgsMN = [{ id: "m1", de: "BUSC-1", para: "ADMIN", texto: "hola", creado: new Date().toISOString(), leido: false }];
function crearMN(){
  const dom = new JSDOM(genMN, { url: "https://ernesto5058.github.io/calculadora-ernesto/minegocio/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w){
      const pre = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [{ codigo: "BUSC-1", nombre: "Busc Uno", activo: true }], datos: datosPubMN, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
      try { w.localStorage.setItem("minegocio_v1", JSON.stringify(pre)); } catch(e){}
      w.__scrolls = [];
      w.Element.prototype.scrollIntoView = function(){ w.__scrolls.push(this.id || this.className || "?"); };
      w.fetch = function(url, opts){
        const u = String(url);
        const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v === undefined ? null : v)), json: () => Promise.resolve(v) });
        const rechaza = (msg, st) => Promise.resolve({ ok: false, status: st || 404, text: () => Promise.resolve(JSON.stringify({ message: msg || "404" })), json: () => Promise.resolve({ message: msg || "404" }) });
        if (u.includes("/rpc/")) {
          const fn = u.split("/rpc/")[1].split("?")[0];
          switch (fn) {
            case "ver_presencia": return json({ ok: true, usuarios: [{ codigo: "BUSC-1", nombre: "Busc Uno", visto: new Date().toISOString() }] });
            case "mensajes_sin_leer": return json({ ok: true, por_usuario: {}, total: 0 });
            case "leer_chat": return json({ ok: true, mensajes: chatMsgsMN });
            case "leer_perfil": return json(null);
            case "tocar_presencia": return json({ ok: true });
            case "marcar_recibidos": return json({ ok: true, marcados: 0 });
            case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 950, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: "2026-11-10 22:00" });
            case "admin_reportes": return json([]);
            case "admin_ayudas": return json([]);
            case "admin_usuarios": return json([{ codigo: "BUSC-1", nombre: "Busc Uno", activo: true }]);
            case "admin_cierres": return json([]);
            case "admin_actividad": return json([]);
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
{
  const w = crearMN(); const d = w.document;
  await sleep(700);
  [...d.querySelectorAll(".tab")].forEach(t => { if (t.textContent.includes("Equipo")) click(t); });
  await sleep(250);
  click(d.querySelector("[data-chat]"));
  await sleep(500);
  let tx = d.getElementById("chTexto");
  ok(!!tx, "MN-0 el chat abre con su compositor #chTexto");
  /* 1 · repintado directo */
  tx.focus(); input(tx, "estoy escribiendo"); try { tx.setSelectionRange(3, 8); } catch(e){}
  const nodoA = tx, burbA = d.querySelector('#chHilo [data-mid="m1"]');
  w.pintarChat(); await sleep(40);
  const nodoB = d.getElementById("chTexto");
  ok(nodoB === nodoA && nodoA.isConnected, "MN-1a tras pintarChat() el compositor es el MISMO nodo y sigue conectado");
  ok(d.activeElement === nodoA, "MN-1b el foco SOBREVIVE al repintado (activeElement = compositor)");
  ok(nodoB.value === "estoy escribiendo", "MN-1c el texto tecleado sobrevive");
  ok(nodoB.selectionStart === 3 && nodoB.selectionEnd === 8, "MN-1d la selección del texto sobrevive");
  ok(!!burbA && d.querySelector('#chHilo [data-mid="m1"]') === burbA, "MN-1e la burbuja que ya estaba conserva su nodo (repintado incremental)");
  ok(!!tx && !d.getElementById("chHilo").contains(tx), "MN-1f el compositor vive FUERA del contenedor que se refresca (#chHilo)");
  /* 4 · el buscador también sobrevive */
  const bk = d.getElementById("chBuscar");
  if (bk) { input(bk, "hola"); w.pintarChat(); await sleep(30); const bk2 = d.getElementById("chBuscar"); ok(bk2 === bk && bk2.value === "hola", "MN-1g el buscador del chat conserva nodo y texto tras el repintado"); }
  /* 3 · disciplina de scroll (layout simulado; el hilo se re-lee
     tras cada repintado: en la arquitectura PRO es el MISMO nodo) */
  let hilo = d.getElementById("chHilo");
  layoutFalso(hilo, 1000, 400); hilo.scrollTop = 0;
  chatMsgsMN = chatMsgsMN.concat([{ id: "m2", de: "BUSC-1", para: "ADMIN", texto: "otro más", creado: new Date().toISOString(), leido: false }]);
  w.pintarChat(); await sleep(30);
  hilo = d.getElementById("chHilo"); layoutFalso(hilo, 1000, 400);
  ok(hilo.scrollTop === 0, "MN-2a leyendo arriba, el refresco NO arrastra el scroll abajo");
  hilo.scrollTop = 620; /* pegado: 620 + 400 >= 1000 - 90 */
  w.pintarChat(); await sleep(30);
  hilo = d.getElementById("chHilo"); layoutFalso(hilo, 1000, 400);
  ok(hilo.scrollTop === 1000, "MN-2b pegado abajo, el refresco sí sigue al final");
  /* 2 · dos ciclos reales del temporizador de 3 s */
  let tx2 = d.getElementById("chTexto");
  tx2.focus(); input(tx2, "segundo intento"); try { tx2.setSelectionRange(2, 6); } catch(e){}
  const nodoC = tx2;
  chatMsgsMN = chatMsgsMN.concat([{ id: "m3", de: "BUSC-1", para: "ADMIN", texto: "llega solo", creado: new Date().toISOString(), leido: false }]);
  await sleep(7000);
  const nodoD = d.getElementById("chTexto");
  ok(nodoD === nodoC && nodoC.isConnected && d.activeElement === nodoC, "MN-3a tras 2 ciclos reales del refresco (7 s): mismo nodo, conectado y ENFOCADO");
  ok(nodoD.value === "segundo intento" && nodoD.selectionStart === 2, "MN-3b texto y selección intactos tras los 2 ciclos");
  ok(!!d.querySelector('#chHilo [data-mid="m3"]'), "MN-3c el mensaje que llegó por el refresco sí se pintó");
  /* 6 · la hoja 📎 con un toque */
  const clicsEn = [];
  ["chFile", "chFileCam", "chFileDoc"].forEach(id => { const f = d.getElementById(id); if (f) f.addEventListener("click", () => clicsEn.push(id)); });
  click(d.getElementById("chClip")); await sleep(80);
  const hojaMN = d.getElementById("chAdjHoja");
  ok(!!hojaMN && hojaMN.classList.contains("abierta"), "MN-4a tocar el clip abre la hoja de adjuntos (un toque, sin presión larga)");
  click(d.getElementById("chAdjFoto")); await sleep(40);
  ok(clicsEn.includes("chFile"), "MN-4b la fila «Foto o vídeo» dispara el selector de fotos en el mismo gesto");
  click(d.getElementById("chClip")); await sleep(80);
  click(d.getElementById("chAdjCam")); await sleep(40);
  ok(clicsEn.includes("chFileCam") && (d.getElementById("chFileCam") || {}).getAttribute && (d.getElementById("chFileCam").getAttribute("accept") || "").includes("image") && d.getElementById("chFileCam").hasAttribute("capture"), "MN-4c la fila «Cámara» dispara el selector con capture (cámara directa)");
  click(d.getElementById("chClip")); await sleep(80);
  click(d.getElementById("chAdjDoc")); await sleep(40);
  ok(clicsEn.includes("chFileDoc"), "MN-4d la fila «Documento» dispara el selector de documentos");
  /* 5 · D1 en Textos */
  click(d.getElementById("chVolver")); await sleep(150);
  [...d.querySelectorAll(".tab")].forEach(t => { if (t.textContent.includes("Textos")) click(t); });
  await sleep(200);
  w.__scrolls.length = 0;
  click(d.getElementById("txProdBtn")); await sleep(60);
  ok(d.getElementById("txProdForm").style.display === "block", "MN-5a «Texto de producto» abre su formulario");
  click(d.getElementById("txSaldo")); await sleep(150);
  ok(d.getElementById("txProdForm").style.display === "none", "MN-5b Producto → Saldo CIERRA el formulario (fin de la bifurcación D1)");
  ok(d.getElementById("txOut").textContent.length > 200, "MN-5c el texto de saldo se genera en la salida");
  ok(w.__scrolls.length > 0, "MN-5d la salida generada se trae a la vista (scrollIntoView)");
  click(d.getElementById("txProdBtn")); await sleep(60);
  click(d.getElementById("txTransf")); await sleep(150);
  ok(d.getElementById("txProdForm").style.display === "none" && d.getElementById("txOut").textContent.length > 100, "MN-5e Producto → Transferencia también cierra el formulario y genera");
  w.close();
}

/* ================= MI TRABAJO ================= */
const CODMT = "BUSC-1";
let chatMsgsMT = [
  { id: 1, de: "ADMIN", para: "BUSC-1", texto: "hola buscador", creado: new Date(Date.now() - 60000).toISOString(), leido: true },
  { id: 2, de: "BUSC-1", para: "ADMIN", texto: "hola Ernesto", creado: new Date().toISOString(), leido: true },
];
function datosFixtureMT(){
  return { version: 4, versionApp: "1.4.8", apkUrl: "https://example.invalid/apk",
    tarifa: { version: 4, ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, bonoSaldoMeta: 150, bonoSaldoMonto: 300, bonoTransfMeta: 10, bonoTransfMonto: 300 },
    publico: { telefono: "51231558", zona: "Micro 10, distrito José Martí, Santiago de Cuba", domicilio: "Domicilio gratis en Santiago de Cuba", saldo: { tasa: 2, tasaAlta: 2.2, desdeAlta: 5000, recarga: 720 } },
    buscadores: { "BUSC-1": { nombre: "Busc Uno", tratos: [] } }, actualizado: "2026-11-11" };
}
function crearMT(){
  const dom = new JSDOM(genMT, { url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/", runScripts: "dangerously", pretendToBeVisual: true, beforeParse(w){
    w.localStorage.setItem("busc_codigo", CODMT);
    w.prompt = () => "texto editado"; w.confirm = () => true; w.scrollTo = () => {};
    w.fetch = function(url, opts){
      const u = String(url);
      const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v ?? null)), json: () => Promise.resolve(v) });
      const err = (msg, st) => Promise.resolve({ ok: false, status: st || 400, text: () => Promise.resolve(JSON.stringify({ message: msg })), json: () => Promise.resolve({ message: msg }) });
      if (u.includes("datos.json")) return json(JSON.parse(JSON.stringify(datosFixtureMT())));
      if (u.includes("/rpc/")) {
        const fn = u.split("/rpc/")[1].split("?")[0];
        switch (fn) {
          case "validar_usuario": return json([{ codigo: CODMT, nombre: "Busc Uno", activo: true }]);
          case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 950, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: new Date().toISOString() });
          case "leer_panel": return json({ ok: true, nombre: "Busc Uno", tratos: [] });
          case "ver_presencia": return json({ ok: true, usuarios: [{ codigo: "ADMIN", nombre: "Ernesto", visto: new Date().toISOString() }] });
          case "mensajes_sin_leer": return json({ ok: true, sin_leer: 0 });
          case "leer_chat": return json({ ok: true, mensajes: chatMsgsMT, fijado: null, temporal_seg: 0 });
          case "enviar_mensaje": return json({ ok: true, id: 99 });
          case "registrar_reporte": return json(123);
          case "estado_reportes": return json([]);
          default: return json({ ok: true });
        }
      }
      return err("404", 404);
    };
  }});
  return dom.window;
}
{
  const w = crearMT(); const d = w.document;
  await sleep(900);
  w.showView("Ayuda");
  await sleep(600);
  const tx = d.getElementById("c_txt");
  ok(!!tx, "MT-0 la vista Ayuda abre con su compositor #c_txt");
  const hilo = d.getElementById("c_hilo");
  const burbA = hilo.querySelector('[data-mid="1"]');
  /* 1+3 · foco y scroll con mensaje entrante (repintado directo) */
  tx.focus(); input(tx, "estoy escribiendo"); try { tx.setSelectionRange(3, 8); } catch(e){}
  layoutFalso(hilo, 1000, 400); hilo.scrollTop = 0;
  chatMsgsMT = chatMsgsMT.concat([{ id: 3, de: "ADMIN", para: "BUSC-1", texto: "mensaje nuevo", creado: new Date().toISOString(), leido: false }]);
  w.pintarChat(chatMsgsMT); await sleep(40);
  ok(d.getElementById("c_txt") === tx && tx.isConnected && d.activeElement === tx, "MT-1a el compositor conserva nodo y foco cuando llega un mensaje");
  ok(tx.value === "estoy escribiendo" && tx.selectionStart === 3 && tx.selectionEnd === 8, "MT-1b texto y selección intactos");
  ok(!!burbA && hilo.querySelector('[data-mid="1"]') === burbA, "MT-1c la burbuja que ya estaba conserva su nodo (repintado incremental)");
  ok(hilo.scrollTop === 0, "MT-2a leyendo arriba, el refresco NO arrastra el scroll abajo");
  hilo.scrollTop = 620;
  w.pintarChat(chatMsgsMT); await sleep(40);
  ok(hilo.scrollTop === 1000, "MT-2b pegado abajo, el refresco sí sigue al final");
  /* 2 · dos ciclos reales del refresco */
  await sleep(7000);
  ok(d.getElementById("c_txt") === tx && d.activeElement === tx && tx.value === "estoy escribiendo", "MT-3 tras 2 ciclos reales del refresco (7 s): nodo, foco y texto intactos");
  /* 6 · la hoja 📎 con un toque */
  const clicsEnMT = [];
  ["c_file_foto", "c_file_cam", "c_file_arch"].forEach(id => { const f = d.getElementById(id); if (f) f.addEventListener("click", () => clicsEnMT.push(id)); });
  click(d.getElementById("c_clip")); await sleep(80);
  const hojaMT = d.getElementById("c_adj_hoja");
  ok(!!hojaMT && hojaMT.classList.contains("abierta"), "MT-4a tocar el clip abre la hoja de adjuntos (un toque, sin presión larga)");
  click(d.getElementById("c_adj_foto")); await sleep(40);
  ok(clicsEnMT.includes("c_file_foto"), "MT-4b la fila «Foto o vídeo» dispara el selector de fotos");
  click(d.getElementById("c_clip")); await sleep(80);
  click(d.getElementById("c_adj_cam")); await sleep(40);
  ok(clicsEnMT.includes("c_file_cam") && d.getElementById("c_file_cam") && d.getElementById("c_file_cam").hasAttribute("capture"), "MT-4c la fila «Cámara» dispara el selector con capture");
  click(d.getElementById("c_clip")); await sleep(80);
  click(d.getElementById("c_adj_arch")); await sleep(40);
  ok(clicsEnMT.includes("c_file_arch"), "MT-4d la fila «Documento» dispara el selector de documentos");
  /* D4 (v1.5.1): la navegación por pointerup de rescate abre el
     chat AUNQUE el click se lo trague la capa de toque, y las
     pestañas/botones llevan touch-action:manipulation. */
  const cssMT = genMT;
  ok(/\.tabbar \.tab \{[^}]*touch-action: manipulation/.test(cssMT) && /button, \.btnUpd \{ touch-action: manipulation; \}/.test(cssMT), "MT-5a pestañas y botones con touch-action:manipulation (fuera la desambiguación de doble toque)");
  ok(typeof w.irTab === "function" && cssMT.includes("pointerup"), "MT-5b la vía de rescate pointerup delegada (irTab) vive en el build");
  w.showView("Calc"); await sleep(120);
  d.getElementById("tabAyuda").dispatchEvent(new w.Event("pointerup", { bubbles: true, cancelable: true }));
  await sleep(150);
  ok(!d.getElementById("viewAyuda").classList.contains("hide") && d.querySelector(".tab.on").id === "tabAyuda", "MT-5c SIN click: solo con pointerup la pestaña Chat abre (la vía de rescate funciona)");
  w.close();
}

console.log("\nBANCO FOCO-CHAT (fila 22): " + pass + " PASS · " + fail + " FAIL");
process.exit(fail ? 1 : 0);

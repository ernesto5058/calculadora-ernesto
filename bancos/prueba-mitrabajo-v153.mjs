// Banco v1.5.3 — Mi Trabajo, TANDA Nº6 del Inspector Ola 1 (2026-11-12):
//   A  E-17 escape total: ningun texto del servidor / de otro usuario
//      se pinta crudo por innerHTML (panel, reportes, chat, reacciones,
//      src de adjuntos solo dataURL segura).
//   B  E-2/E-3/E-4/E-5/E-6: sesion guardada validada al arrancar
//      (revocado expulsa; sinred no), pausa que se libera cuando el
//      servidor la quita, outbox que nunca sobrescribe pendientes y
//      despacho de AMBAS colas al volver la conexion / el foco.
//   C  E-7: la tarifa de respaldo se etiqueta «RESPALDO» a la vista;
//      la viva se etiqueta «en vivo».
//   E  E-9/E-18: el sondeo del chat usa leer_chat_ligero (sin base64)
//      y el adjunto llega una vez por leer_adjunto; el arranque es
//      por piezas (bootWarn nombra la pieza caida, el resto sigue).
// Harness jsdom con fetch simulado, patron del banco v144.
import { JSDOM } from "jsdom";
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "buscadores/index.html", "utf8");
const src = fs.readFileSync(REPO + "buscadores-app/app.js", "utf8");
const sw = fs.readFileSync(REPO + "buscadores/sw.js", "utf8");
const datos = JSON.parse(fs.readFileSync(REPO + "buscadores/datos.json", "utf8"));
let pass = 0, fail = 0; const fails = [];
function ok(c, n){ if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const COD = "BUSC-1";
const hoyISO = new Date().toISOString();

/* Estado mutable del servidor simulado */
let VALIDAR = { activo: true, bloqueado: false };
let MODO = "ok";            // ok | caida | sin-tarifa
let REG_DELAY = 0;          // retardo de registrar_reporte (test E-4)
let llamadas = [], cuerpos = {};
const CHAT_FIX = [
  { id: 501, de: "ADMIN", para: COD, texto: "mira la foto", creado: hoyISO, leido: false, recibido: null, editado: null, borrado: false, tipo: "texto", adj_tipo: "foto", adj_nombre: "prueba.png", adj_mime: "image/png", adj_bytes: 70, adj_datos: null, adj_tiene: true, resp_de: null, resp_autor: null, resp_texto: null, fijado: false, reacciones: [{ emoji: "<img src=x onerror=1>", total: 2 }] },
  { id: 502, de: COD, para: "ADMIN", texto: "<b>hola</b> <script>window.__x=1</" + "script>", creado: hoyISO, leido: false, recibido: null, editado: null, borrado: false, tipo: "texto", adj_tipo: null, adj_datos: null, adj_tiene: false, fijado: false, reacciones: [] },
  { id: 503, de: "ADMIN", para: COD, texto: "", creado: hoyISO, leido: false, recibido: null, editado: null, borrado: false, tipo: "texto", adj_tipo: "foto", adj_nombre: "mala.png", adj_mime: "image/png", adj_datos: 'x"><svg onload=1>', adj_tiene: true, fijado: false, reacciones: [] },
  { id: 504, de: "ADMIN", para: COD, texto: "foto buena", creado: hoyISO, leido: false, recibido: null, editado: null, borrado: false, tipo: "texto", adj_tipo: "foto", adj_nombre: "ok.png", adj_mime: "image/png", adj_datos: "data:image/png;base64,iVBORw0KGgo=", adj_tiene: true, fijado: false, reacciones: [] }
];
function datosFixture(){
  return { version: 6, versionApp: "1.5.2", apkUrl: "https://example.invalid/apk-v1.5.2/Mi-Trabajo-v1.5.2.apk",
    tarifa: { ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, bonoSaldoMeta: 150, bonoSaldoMonto: 300, bonoTransfMeta: 10, bonoTransfMonto: 300 },
    publico: { telefono: "51231558", zona: "Micro 10, distrito José Martí, Santiago de Cuba", domicilio: "Domicilio gratis en Santiago de Cuba", saldo: { tasa: 2, tasaAlta: 2.2, desdeAlta: 5000, recarga: 720 } },
    actualizado: "2026-11-12" };
}
function crear(){
  llamadas = []; cuerpos = {};
  const dom = new JSDOM(html, { url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/", runScripts: "dangerously", pretendToBeVisual: true, beforeParse(w){
    w.localStorage.setItem("busc_codigo", COD);
    w.prompt = () => "texto editado"; w.confirm = () => true;
    w.fetch = function(url, opts){
      const u = String(url); llamadas.push(u);
      const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v ?? null)), json: () => Promise.resolve(v) });
      const err = (msg, st) => Promise.resolve({ ok: false, status: st || 400, text: () => Promise.resolve(JSON.stringify({ message: msg })), json: () => Promise.resolve({ message: msg }) });
      const red = () => Promise.reject(new TypeError("Failed to fetch"));
      if (u.includes("datos.json")) return (MODO === "caida" || MODO === "sin-tarifa") ? red() : json(datosFixture());
      if (u.includes("/rpc/")) {
        const fn = u.split("/rpc/")[1].split("?")[0];
        let body = {}; try { body = JSON.parse(opts?.body || "{}"); } catch(e){}
        cuerpos[fn] = body; llamadas.push("rpc:" + fn);
        if (MODO === "caida") return red();
        switch (fn) {
          case "validar_usuario": return json([{ codigo: COD, nombre: "Busc Uno", activo: VALIDAR.activo, bloqueado: VALIDAR.bloqueado }]);
          case "leer_tarifa": return MODO === "sin-tarifa" ? err("404", 404) : json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 980, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: hoyISO });
          case "leer_panel": return json({ ok: true, nombre: "Busc Uno", tratos: [
            { fecha: "2026-11-12", tipo: "saldo", nota: "<img src=x onerror=window.__xss=1>", comision: 10, recargas: 2, estado: "pagado", pagado_en: "<svg onload=1>" } ] });
          case "ver_presencia": return json({ ok: true, usuarios: [{ codigo: "ADMIN", nombre: "Ernesto", visto: hoyISO }] });
          case "mensajes_sin_leer": return json({ ok: true, sin_leer: 0 });
          case "tocar_presencia": case "marcar_recibidos": return json({ ok: true });
          case "leer_chat_ligero": return json({ ok: true, mensajes: JSON.parse(JSON.stringify(CHAT_FIX)) });
          case "leer_adjunto": return json({ ok: true, id: body.p_id, adj_tipo: "foto", adj_nombre: "prueba.png", adj_mime: "image/png", adj_bytes: 70, adj_datos: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" });
          case "leer_chat": return json({ ok: true, mensajes: [] });
          case "enviar_mensaje": return json({ ok: true, id: 99 });
          case "registrar_reporte": { const p = json("uuid-rep-1"); return REG_DELAY ? p.then(v => new Promise(r => setTimeout(() => r(v), REG_DELAY))) : p; }
          case "estado_reportes": return json([]);
          case "reaccionar": case "editar_mensaje": case "borrar_mensaje": case "guardar_perfil": case "registrar_push": case "editar_reporte": return json({ ok: true });
          case "leer_perfil": return json({ codigo: COD, nombre: "Busc Uno" });
          case "cambiar_codigo": return json({ ok: true, codigo: body.p_codigo_nuevo });
          default: return err("404", 404);
        }
      }
      return err("404", 404);
    };
  }});
  return dom.window;
}

/* ===== Version ===== */
ok(/var APP_VERSION = "1\.5\.3"/.test(html), "V1 APP_VERSION 1.5.3 en el build ensamblado");
ok(sw.includes('CACHE = "mitrabajo-v20"'), "V2 el SW sube a mitrabajo-v20");
ok(datos.versionApp === "1.5.2", "V3 datos.json sigue anunciando la APK 1.5.2 (la 1.5.3 es web; su APK queda pendiente de build y NO se anuncia una APK que no existe)");

/* ===== A: escape total (estructural) ===== */
ok(src.includes("function esc(") && src.includes("function srcSeguroAdjMT("), "A1 existen esc() y srcSeguroAdjMT()");
ok(src.includes("esc(tr.nota") && src.includes("esc(rp.motivo") && src.includes("esc(r.emoji") && src.includes("esc(tr.fecha") && src.includes("esc(rp.fecha"), "A2 panel/reportes/reacciones pintan escapado");
ok(!src.includes("src=\"' + (String(m.adj_datos)"), "A3 el src crudo de adj_datos de la v1.5.2 ya no existe");
ok(src.includes("srcSeguroAdjMT(m.adj_datos") && src.includes("srcSeguroAdjMT(it.adj.datos"), "A4 las fotos (hilo y cola) pasan por el filtro seguro");

/* ===== A + E-9: comportamiento en jsdom ===== */
{
  MODO = "ok"; VALIDAR = { activo: true, bloqueado: false };
  const w = crear(); const d = w.document;
  await sleep(900);
  /* panel con nota maliciosa */
  const pt = d.getElementById("p_tratos");
  ok(pt && !pt.querySelector("img") && !pt.querySelector("svg[onload]"), "A5 el panel NO inyecta la nota del trato como HTML (los svg de iconos de trazo son de la plantilla)");
  ok(pt && pt.textContent.includes("<img src=x"), "A6 la nota se ve como TEXTO escapado");
  ok(typeof w.__xss === "undefined", "A7 el onerror inyectado no se ejecuto");
  /* outbox con motivo malicioso */
  w.localStorage.setItem("busc_outbox", JSON.stringify([{ buscador: COD, tipo: "saldo", precio: 900, cantidad: 1, telefono: "5", nota: "", estado: "rechazado", motivo: "<b>motivo</b>", enviado: true, id: "uuid-9", opId: "op-9", fecha: "12/11/2026" }]));
  w.renderOutbox();
  const rl = d.getElementById("r_lista");
  ok(rl && !rl.querySelector("b") && rl.textContent.includes("<b>motivo</b>"), "A8 el motivo de rechazo se pinta escapado");
  /* chat: texto, reaccion y adjuntos */
  w.showView("Ayuda");
  await sleep(700);
  ok(!!cuerpos["leer_chat_ligero"], "E9-1 el sondeo del chat usa leer_chat_ligero (sin base64)");
  ok(!!cuerpos["leer_adjunto"], "E9-2 el adjunto pendiente se pidio por leer_adjunto (bajo demanda)");
  const hilo = d.getElementById("c_hilo");
  ok(hilo && !hilo.querySelector("script") && typeof w.__x === "undefined", "A9 el texto del chat con <script> no se ejecuta ni se inyecta");
  ok(hilo && !hilo.querySelector(".reac img"), "A10 el emoji de reaccion del servidor no se inyecta como HTML");
  ok(hilo && !hilo.querySelector("svg"), "A11 el adj_datos basura (x\"><svg…) no se pinta como imagen");
  const imgs = hilo ? hilo.querySelectorAll("img.adjFoto") : [];
  ok(imgs.length >= 1 && String(imgs[0].getAttribute("src")).startsWith("data:image/png;base64,"), "A12 la foto valida si se pinta, y solo como dataURL segura");
  const m501 = (w.CHAT_MSGS || []).filter(m => m.id === 501)[0];
  ok(m501 && typeof m501.adj_datos === "string" && m501.adj_datos.startsWith("data:image/png"), "E9-3 el adjunto llego una vez y quedo fusionado en el mensaje");
  w.close();
}

/* ===== B: E-3 sesion revocada expulsa al arrancar; E-6 pausa se pone y se quita ===== */
{
  MODO = "ok"; VALIDAR = { activo: false, bloqueado: false };
  const w = crear();
  await sleep(800);
  ok(w.SESION === "", "E3-1 la sesion guardada REVOCADA se expulsa sola al arrancar (sin tocar Actualizar)");
  ok(!w.document.getElementById("loginGate").classList.contains("hide"), "E3-2 el gate de login queda visible tras la expulsion");
  w.close();
}
{
  MODO = "ok"; VALIDAR = { activo: true, bloqueado: true };
  const w = crear();
  await sleep(800);
  ok(w.EN_PAUSA === true && w.document.getElementById("pf_pausa").style.display === "block", "E6-1 el servidor dice pausa → candado puesto y aviso visible");
  VALIDAR.bloqueado = false;
  w.refrescarTodo();
  await sleep(600);
  ok(w.EN_PAUSA === false && w.document.getElementById("pf_pausa").style.display === "none", "E6-2 el servidor quita la pausa → el candado se libera dentro de la sesion");
  w.close();
}

/* ===== B: E-4 la outbox no pierde pendientes; E-5 despacho al volver conexion/foco ===== */
{
  MODO = "ok"; VALIDAR = { activo: true, bloqueado: false }; REG_DELAY = 300;
  const w = crear();
  await sleep(500);
  const mk = op => ({ buscador: COD, tipo: "saldo", precio: 900, porc: null, cantidad: 1, telefono: "5", nota: "", estado: "pendiente", enviado: false, id: null, opId: op, fecha: "12/11/2026" });
  w.localStorage.setItem("busc_outbox", JSON.stringify([mk("op-a"), mk("op-b")]));
  w.syncReportes();
  await sleep(120);
  /* mientras op-a viaja, entra un TERCER reporte a la outbox */
  const cur = JSON.parse(w.localStorage.getItem("busc_outbox")); cur.push(mk("op-c"));
  w.localStorage.setItem("busc_outbox", JSON.stringify(cur));
  await sleep(1200);
  const fin = JSON.parse(w.localStorage.getItem("busc_outbox") || "[]");
  const ops = fin.map(x => x.opId).sort().join(",");
  ok(ops === "op-a,op-b,op-c", "E4-1 la outbox conserva el reporte que entro DURANTE el despacho (no hay sobrescritura con foto vieja)");
  ok(fin.filter(x => x.opId !== "op-c").every(x => x.enviado), "E4-2 los despachados quedan marcados enviados");
  /* E-5: una pendiente nueva sale sola al evento online y al foco */
  REG_DELAY = 0;
  const antes = llamadas.filter(u => u.includes("registrar_reporte")).length;
  const cur2 = JSON.parse(w.localStorage.getItem("busc_outbox")); cur2.push(mk("op-d"));
  w.localStorage.setItem("busc_outbox", JSON.stringify(cur2));
  w.dispatchEvent(new w.Event("online"));
  await sleep(500);
  const fin2 = JSON.parse(w.localStorage.getItem("busc_outbox") || "[]");
  ok(fin2.filter(x => x.opId === "op-d")[0]?.enviado === true, "E5-1 al volver la conexion (online) la cola de reportes se despacha sola");
  ok(llamadas.filter(u => u.includes("registrar_reporte")).length > antes, "E5-2 el evento online llamo a registrar_reporte");
  w.close();
}

/* ===== C: E-7 respaldo etiquetado ===== */
{
  MODO = "sin-tarifa"; VALIDAR = { activo: true, bloqueado: false };
  const w = crear();
  await sleep(700);
  ok(w.document.getElementById("tarifaTxt").textContent.includes("RESPALDO"), "E7-1 sin viva ni datos.json, la tarifa se etiqueta RESPALDO a la vista");
  w.close();
}
{
  MODO = "ok"; VALIDAR = { activo: true, bloqueado: false };
  const w = crear();
  await sleep(700);
  const tt = w.document.getElementById("tarifaTxt").textContent;
  ok(tt.includes("en vivo") && !tt.includes("RESPALDO"), "E7-2 con leer_tarifa viva, la etiqueta es «en vivo» y no RESPALDO");
  /* E-18: el aviso por piezas existe y la calculadora funciona aunque caiga una pieza */
  ok(!!w.document.getElementById("bootWarn") && src.includes("function bootAviso(") && src.includes("function seguro("), "E18-1 existe bootWarn + seguro() (arranque por piezas)");
  w.seguro(function(){ throw new Error("pieza rota de prueba"); }, "la pieza de prueba");
  ok(w.document.getElementById("bootWarn").textContent.includes("la pieza de prueba"), "E18-2 la pieza caida se nombra en el aviso y la app sigue");
  w.document.getElementById("s_precio").value = "900";
  w.document.getElementById("s_cant").value = "2";
  w.calcSaldo();
  ok(w.document.getElementById("s_fee").textContent.length > 1, "E18-3 la calculadora sigue calculando tras el fallo de la pieza");
  w.close();
}

console.log("\nBANCO MI TRABAJO v1.5.3 (Tanda Nº6): " + pass + " PASS · " + fail + " FAIL");
process.exit(fail ? 1 : 0);

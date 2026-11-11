// Copia para CI (GitHub Actions) del banco vivo en research_notes — mismos chequeos,
// solo cambian las rutas: jsdom por nombre y la raíz del repo se resuelve desde este archivo
// (o la variable BANCO_REPO). Si el banco vivo cambia, se refresca esta copia.
import { JSDOM } from "jsdom";
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "buscadores/index.html", "utf8");
let pass = 0, fail = 0; const fails = [];
function ok(c, n){ if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const COD = "BUSC-1";
const hoyISO = new Date().toISOString();
function datosFixture(pub){
  return { version: 4, versionApp: "1.4.5", apkUrl: "https://example.invalid/apk",
    tarifa: { version: 4, ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, bonoSaldoMeta: 150, bonoSaldoMonto: 300, bonoTransfMeta: 10, bonoTransfMonto: 300 },
    publico: pub || { telefono: "51231558", zona: "Micro 10, distrito José Martí, Santiago de Cuba", domicilio: "Domicilio gratis en Santiago de Cuba",
      saldo: { tasa: 2, tasaAlta: 2.2, desdeAlta: 5000, recarga: 720 } },
    buscadores: { "BUSC-1": { nombre: "Busc Uno", tratos: [] } }, actualizado: "2026-11-11" };
}
/* modo: "ok" | "caida" (todo rechaza) | "chat-caida" (solo leer_chat rechaza) */
let MODO = "ok";
let llamadas = [], cuerpos = {};
function crear(pub){
  llamadas = []; cuerpos = {};
  const datos = datosFixture(pub);
  const dom = new JSDOM(html, { url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/", runScripts: "dangerously", pretendToBeVisual: true, beforeParse(w){
    w.localStorage.setItem("busc_codigo", COD);
    w.prompt = () => "texto editado";
    w.confirm = () => true;
    w.fetch = function(url, opts){
      const u = String(url); llamadas.push(u);
      const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v ?? null)), json: () => Promise.resolve(v) });
      const err = (msg, st) => Promise.resolve({ ok: false, status: st || 400, text: () => Promise.resolve(JSON.stringify({ message: msg })), json: () => Promise.resolve({ message: msg }) });
      const red = () => Promise.reject(new TypeError("Failed to fetch"));
      if (u.includes("datos.json")) return MODO === "caida" ? red() : json(JSON.parse(JSON.stringify(datos)));
      if (u.includes("/rpc/")) {
        const fn = u.split("/rpc/")[1].split("?")[0];
        let body = {}; try { body = JSON.parse(opts?.body || "{}"); } catch(e){}
        cuerpos[fn] = body; llamadas.push("rpc:" + fn);
        if (MODO === "caida") return red();
        if (MODO === "chat-caida" && fn === "leer_chat") return red();
        switch (fn) {
          case "validar_usuario": return json([{ codigo: COD, nombre: "Busc Uno", activo: true }]);
          case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 950, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: hoyISO });
          case "leer_panel": return json({ ok: true, nombre: "Busc Uno", tratos: [] });
          case "ver_presencia": return json({ ok: true, usuarios: [{ codigo: "ADMIN", nombre: "Ernesto", visto: new Date().toISOString() }] });
          case "mensajes_sin_leer": return json({ ok: true, sin_leer: 0 });
          case "tocar_presencia": case "marcar_recibidos": return json({ ok: true });
          case "leer_chat": return json({ ok: true, mensajes: [], fijado: null, temporal_seg: 0 });
          case "enviar_mensaje": return json({ ok: true, id: 99 });
          case "reaccionar": case "editar_mensaje": case "borrar_mensaje": case "guardar_perfil": case "registrar_push": return json({ ok: true });
          case "leer_perfil": return json({ codigo: COD, nombre: "Busc Uno", telefono: "51112233", zona: "Micro 9", nota: "tardes", avatar_color: "#2FBF71" });
          case "cambiar_codigo": return json({ ok: true, codigo: body.p_codigo_nuevo });
          case "registrar_reporte": return json("uuid-rep-1");
          case "estado_reportes": return json([]);
          case "editar_reporte": return json({ ok: true });
          default: return err("404", 404);
        }
      }
      return err("404", 404);
    };
  }});
  return dom.window;
}
const sinEsp = s => String(s || "").replace(/\s+/g, "");

/* ===== R: Fallo 1 — desambiguación de puertas (contrato en vivo PGRST203) ===== */
{
  MODO = "ok";
  const w = crear(); const d = w.document;
  await sleep(700);
  w.showView("Ayuda");   /* el chat carga al abrir su vista (por diseño); ahí se comprueba el contrato */
  await sleep(400);
  ok(cuerpos["leer_chat"] && ("p_buscar" in cuerpos["leer_chat"]), "R2 leer_chat siempre manda p_buscar (desambigua la sobrecarga)");
  const foto68 = "data:image/png;base64," + "QUJD".repeat(23000); // ~92 KB de dataURL ≈ 69 KB binarios
  w.CHAT_ADJ = { tipo: "foto", datos: foto68, nombre: "Screenshot_20261110-213430.png", mime: "image/png", tam: 69000 };
  d.getElementById("c_txt").value = "Mira esto";
  w.chatEnviar();
  await sleep(400);
  const em = cuerpos["enviar_mensaje"] || {};
  ok(typeof em.p_op_id === "string" && em.p_op_id.length >= 8, "R1a enviar_mensaje manda p_op_id (desambigua + idempotente)");
  ok(em.p_adj_datos === foto68 && em.p_adj_tipo === "foto", "R1b la foto de ~68 KB viaja ÍNTEGRA en p_adj_datos");
  ok(("p_adj_mime" in em) && ("p_resp_de" in em) && ("p_adj_tam" in em), "R1c enviar_mensaje manda el juego completo de parámetros");
  const fotoGrande = "data:image/jpeg;base64," + "QUJD".repeat(300000); // ~1,2 MB de dataURL
  w.CHAT_ADJ = { tipo: "foto", datos: fotoGrande, nombre: "grande.jpg", mime: "image/jpeg" };
  d.getElementById("c_txt").value = "foto grande";
  w.chatEnviar();
  await sleep(400);
  ok((cuerpos["enviar_mensaje"] || {}).p_adj_datos === fotoGrande, "R1d una foto grande (~900 KB) también sale íntegra");
  ok(JSON.parse(w.localStorage.getItem("busc_chat_outbox") || "[]").length === 0, "R1e con red, la cola del chat queda vacía");
  /* registrar_reporte desambiguado */
  w.showView("Rep");
  d.getElementById("r_precio").value = "950"; d.getElementById("r_cant").value = "1"; d.getElementById("r_tel").value = "51234567";
  w.reportar();
  await sleep(500);
  const rr = cuerpos["registrar_reporte"] || {};
  ok(typeof rr.p_op_id === "string" && rr.p_op_id.length >= 8 && ("p_adj_tipo" in rr) && ("p_adj_datos" in rr), "R3 registrar_reporte manda p_op_id + adj (desambigua las 3 sobrecargas)");
  w.close();
}

/* ===== R4/R5: sin red de verdad -> COLA con 🕐 y despacho solo al volver ===== */
{
  MODO = "caida";
  const w = crear(); const d = w.document;
  await sleep(700);
  w.showView("Ayuda");
  d.getElementById("c_txt").value = "Mira esto";
  w.CHAT_ADJ = { tipo: "foto", datos: "data:image/png;base64," + "QUJD".repeat(23000), nombre: "foto.png", mime: "image/png", tam: 69000 };
  w.chatEnviar();
  await sleep(400);
  const cola = JSON.parse(w.localStorage.getItem("busc_chat_outbox") || "[]");
  ok(cola.length === 1 && cola[0].opId && cola[0].adj && cola[0].adj.datos.length > 90000, "R4a sin red: el mensaje con foto queda EN COLA con su opId y su adjunto");
  ok(d.getElementById("c_txt").value === "", "R4b el compositor se limpia (el mensaje ya vive en la cola)");
  ok(d.getElementById("c_hilo").textContent.includes("🕐"), "R4c la burbuja en cola se ve en el hilo con su sello 🕐");
  ok(!d.body.textContent.includes("toca Enviar otra vez"), "R4d NUNCA sale el cartel «toca Enviar otra vez»");
  const opIdCola = cola.length ? cola[0].opId : null;
  MODO = "ok";
  w.despacharChat();
  await sleep(500);
  ok(JSON.parse(w.localStorage.getItem("busc_chat_outbox") || "[]").length === 0, "R5a al volver la red, la cola se despacha sola");
  ok((cuerpos["enviar_mensaje"] || {}).p_op_id === opIdCola, "R5b el reintento usa el MISMO opId (idempotente: no duplica en el servidor)");
  w.close();
}

/* ===== R6: detector honesto — una sonda fallida NO declara «sin conexión» ===== */
{
  MODO = "chat-caida"; // leer_chat cae; leer_tarifa y el resto responden
  const w = crear(); const d = w.document;
  await sleep(700);
  w.showView("Ayuda");
  await sleep(2900); // da tiempo al reintento automático
  ok(!d.getElementById("c_hilo").textContent.includes("Sin conexión ahora"), "R6a con la API respondiendo (tarifa ok), un leer_chat caído NO declara «sin conexión»");
  w.close();
  MODO = "caida"; // ahora cae TODO desde el arranque
  const w2 = crear(); const d2 = w2.document;
  await sleep(700);
  w2.showView("Ayuda");
  await sleep(2900);
  ok(d2.getElementById("c_hilo").textContent.includes("Sin conexión ahora"), "R6b sin ninguna respuesta de la API y tras reintentar, SÍ avisa «sin conexión» (honesto)");
  w2.close();
  MODO = "ok";
}

/* ===== D: rediseño PRO + pestañas que no parten etiquetas a 360 px ===== */
{
  const w = crear(); const d = w.document;
  await sleep(300);
  const barra = d.querySelector(".tabs");
  ok(!!barra && barra.classList.contains("tabbar"), "D1 la navegación es la tab bar PRO (clase tabbar)");
  const tabs = [...d.querySelectorAll(".tabs .tab")];
  ok(tabs.length === 6 && tabs.every(tb => tb.querySelector("svg.ic") && tb.querySelector(".tabTx")), "D2 las 6 pestañas: icono de trazo + etiqueta");
  const estilo = [...d.querySelectorAll("style")].map(s => s.textContent).join("\n");
  const mFs = /\.tabbar \.tabTx\s*\{[^}]*font-size:\s*([\d.]+)px/.exec(estilo);
  const fsTab = mFs ? parseFloat(mFs[1]) : 99;
  const celda = 360 / 6;
  const peor = Math.max(...tabs.map(tb => tb.querySelector(".tabTx").textContent.trim().length)) * fsTab * 0.52;
  ok(fsTab <= 11 && peor <= celda, "D3 a 360 px ninguna etiqueta se parte: la más larga (" + peor.toFixed(1) + " px est.) cabe en su celda (" + celda + " px)");
  ok(/\.tabbar\s*\{[^}]*position:\s*fixed/.test(estilo) && /\.tabbar \.tabTx\s*\{[^}]*white-space:\s*nowrap/.test(estilo), "D4 tab bar fija inferior + etiquetas nowrap (imposible partirlas)");
  const textoEstructura = (barra.textContent || "") + [...d.querySelectorAll("h2")].map(h => h.textContent).join("") +
    (d.getElementById("c_adj_foto")?.textContent || "") + (d.getElementById("c_adj_arch")?.textContent || "") +
    (d.getElementById("c_btn")?.textContent || "") + (d.getElementById("tx_gen")?.textContent || "");
  ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u.test(textoEstructura), "D5 cero emojis como iconos de estructura (pestañas, títulos, botones)");
  ok(!estilo.includes("#F5BC14") && !estilo.includes("#FFCC00"), "D6 fuera el amarillo plano: el dorado sale de var(--dorado-grad)/tokens");
  ok(/button\.go\s*\{[^}]*var\(--dorado-grad\)/.test(estilo), "D7 el botón principal usa el degradado dorado del sistema");
  ok((estilo.match(/tabular-nums/g) || []).length >= 2, "D8 cifras tabulares en resultados y totales");
  const pliegues = d.querySelectorAll(".hintBtn");
  ok(pliegues.length >= 4 && [...d.querySelectorAll(".hintFull")].every(h => h.classList.contains("hide")), "D9 explicaciones largas plegadas tras «ⓘ» (una línea visible, detalle a un toque)");
  w.close();
}

/* ===== T: Textos inteligente — el anuncio de Ernesto, desde su configuración ===== */
{
  MODO = "ok";
  const w = crear(); const d = w.document;
  await sleep(700);
  w.showView("Textos");
  d.getElementById("tx_saldo").click();
  await sleep(200);
  const out = d.getElementById("tx_out").textContent;
  const outPlano = sinEsp(out);
  ok(outPlano.includes("1000X2000") && outPlano.includes("2000X4000") && outPlano.includes("3000X6000") && outPlano.includes("4000X8000") && outPlano.includes("5000X10000"), "T1 la tabla sale calculada de la tasa configurada (al 2: 1000×2000 … 5000×10000)");
  ok(out.includes("Más de 5000") && out.includes("2.2") && out.includes("720"), "T2 línea de más de 5000 al 2.2 y recargas a 720, de la configuración");
  ok(out.includes("51231558") && out.includes("Micro 10") && /domicilio/i.test(out), "T3 el texto sale COMPLETO: teléfono + zona + domicilio de los datos públicos (sin huecos)");
  ok(!out.includes("⚠️") && !/Falta (la zona|tu teléfono)/.test(out), "T4 ningún aviso de «falta…»: el catálogo nunca genera con huecos");
  ok(!/1098|1069/.test(outPlano) && !/comisi/i.test(out), "T5 NO-FILTRACIÓN: ni ingreso/libro internos ni comisiones en el anuncio");
  /* rotación: dos generaciones seguidas difieren */
  const v1 = w.TX_ULT[0].texto;
  d.getElementById("tx_saldo").click();
  await sleep(200);
  ok(w.TX_ULT[0].texto !== v1, "T6 dos generaciones seguidas NUNCA entregan la misma versión");
  /* transferencia al mismo nivel, completa, con su fuente pública (piso de la tarifa) */
  d.getElementById("tx_transf").click();
  await sleep(200);
  const outT = d.getElementById("tx_out").textContent;
  ok(/transferencia/i.test(outT) && outT.includes("51231558") && outT.includes("Micro 10") && outT.includes("25%"), "T7 transferencia completa: qué se cambia, al piso público de la tarifa (25%), teléfono y zona");
  /* cantidad inteligente */
  d.getElementById("tx_cant_saldo").value = "720";
  d.getElementById("tx_saldo").click();
  await sleep(200);
  const outC = d.getElementById("tx_out").textContent;
  ok(outC.includes("720") && sinEsp(outC).includes("1440"), "T8 cantidad escrita -> equivalencia calculada con la tasa (720 de saldo = 1 440 CUP al 2)");
  /* nada del modelo ajeno ni de productos */
  const todo = out + outT + outC + d.body.textContent;
  ok(!todo.includes("59134219") && !todo.includes("Plaza de la Revolución") && !/al 2\.5|al 2\.7/.test(todo), "T9 JAMÁS los datos del anuncio modelo ajeno (2.5/2.7/59134219/Plaza)");
  ok(!/Batería|LiFePO4|Lavadora|barbería/i.test(todo), "T10 la app del buscador no menciona productos en venta ni la batería");
  /* v1.4.5 (directiva 14:39): el formulario libre se ELIMINÓ entero */
  ok(!d.getElementById("tx_tipo") && !d.getElementById("tx_gen") && !d.getElementById("tx_moneda") && !d.getElementById("tx_prod"), "T11 el formulario genérico NO existe en el DOM (ni tipo, ni generar, ni moneda, ni producto)");
  const btnsTx = ["tx_saldo", "tx_recarga", "tx_transf"].map(id => d.getElementById(id));
  ok(btnsTx.every(b => !!b) && btnsTx[0].textContent.includes("Compro saldo") && btnsTx[1].textContent.includes("Recarga y cambio") && btnsTx[2].textContent.includes("Transferencia"), "T12 Textos queda SOLO con los 3 botones inteligentes (Compro saldo · Recarga y cambio · Transferencia)");
  ok(!d.querySelector("[data-txtipo]") && !d.getElementById("tx_tel") && !d.getElementById("tx_zona"), "T13 ni chips del formulario ni campos de teléfono/zona propios: el teléfono sale del bloque público, jamás del perfil local");
  w.close();
  /* la tabla obedece a la CONFIGURACIÓN: tasas distintas -> tabla distinta */
  const w2 = crear({ telefono: "51231558", zona: "Micro 10, distrito José Martí, Santiago de Cuba", domicilio: "Domicilio gratis en Santiago de Cuba", saldo: { tasa: 3, tasaAlta: 3.3, desdeAlta: 5000, recarga: 800 } });
  const d2 = w2.document;
  await sleep(700);
  w2.showView("Textos");
  d2.getElementById("tx_saldo").click();
  await sleep(200);
  const out2 = sinEsp(d2.getElementById("tx_out").textContent);
  ok(out2.includes("1000X3000") && out2.includes("5000X15000") && d2.getElementById("tx_out").textContent.includes("800"), "T14 con otra configuración (al 3, recargas 800) la tabla cambia sola: nada fijado en código");
  w2.close();
}

console.log("\nBANCO MI TRABAJO v1.4.4: " + pass + " PASS · " + fail + " FAIL");
if (fails.length) console.log("Fallos:", fails.join(" · "));
process.exit(fail ? 1 : 0);

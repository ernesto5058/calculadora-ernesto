// Banco Mi Trabajo v1.7.0 — T3: ESPERAS · MI PAGO · CHAT · GUÍA
// (2026-11-14 · CHEQUEO 96). jsdom sobre el build ensamblado.
// Cubre:
//   · estáticos de versión (APP_VERSION / SW / Sentry 1.7.0);
//   · Mis esperas: los 3 estados en palabras de la calle, monto,
//     fecha y de qué vuelta es; la insignia de abiertas en el panel;
//   · el PARTE CON TASA: el tope de su efectivo libre frena SIN mandar
//     (cero llamadas a espera_crear_app), la tasa cero se rechaza, y
//     el parte bueno viaja con su tasa y su total;
//   · Mi pago: asegurado / premio / ya pagado, saldo y transferencia
//     separados — y la FRONTERA escaneada sobre el HTML renderizado
//     (aunque la puerta filtrara la cocina, la pantalla no la pinta);
//   · la SONDA DE FOCO del chat: nodo, foco, texto y selección del
//     compositor sobreviven a 2 ciclos reales de refresco del hilo;
//   · foto + texto en UN envío (una sola llamada con texto y adjunto);
//   · la hoja de adjuntos como hoja inferior (fija, con su fondo);
//   · la guía: 4 pasos, una sola vez, repetible desde Mi perfil.
import { JSDOM } from "jsdom";
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "buscadores/index.html", "utf8");
const sw = fs.readFileSync(REPO + "buscadores/sw.js", "utf8");
const datosTxt = fs.readFileSync(REPO + "buscadores/datos.json", "utf8");
const datos = JSON.parse(datosTxt);
let pass = 0, fail = 0;
function ok(c, n){ if (c) pass++; else { fail++; console.log("FAIL:", n); } }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function click(w, el){ if (el) el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })); }
function input(el, v){ el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true })); }

/* ===== Estático ===== */
ok(/var APP_VERSION = "1\.7\.0"/.test(html), "V1 APP_VERSION 1.7.0 en el build ensamblado");
ok(sw.includes('CACHE = "mitrabajo-v32"'), "V2 el SW sube a mitrabajo-v32");
ok(datos.versionApp === "1.5.6", "V3 datos.json sigue anunciando la APK 1.5.6 (web-only)");
ok(html.includes('version:"1.7.0"'), "V4 SENTRY_CASA con version 1.7.0");
ok(html.includes('id="viewEsperas"') && html.includes('id="viewPago"') && html.includes('id="navEsperas"')
   && html.includes('id="navPago"') && html.includes('id="ep_btn"') && html.includes('id="guiaBox"')
   && html.includes('id="c_adj_scrim"') && html.includes('id="pf_guia"'),
   "V5 las pantallas nuevas, la guía y el fondo de la hoja existen en el esqueleto");
ok(html.includes('id="tabCalc"') && html.includes('id="tabRep"') && html.includes('id="tabPanel"')
   && html.includes('id="tabAyuda"') && html.includes('id="tabTextos"') && html.includes('id="tabPerfil"'),
   "V6 las 6 pestañas vivas siguen todas (ninguna amputada)");

/* ===== Runtime ===== */
const HOY = new Date().toISOString();
const AYER = new Date(Date.now() - 86400000).toISOString();
let CHAT_MSGS = [
  { id: 1, de: "ADMIN", para: "PEUEBA", texto: "hola buscador", creado: AYER, leido: true },
  { id: 2, de: "PEUEBA", para: "ADMIN", texto: "hola Ernesto", creado: HOY, leido: true },
];
const LLAMADAS = [];
function crear(guiaVista){
  const dom = new JSDOM(html, { url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/?codigo=PEUEBA",
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w){
      if (guiaVista) w.localStorage.setItem("busc_guia_v170", "1");
      w.fetch = function(url, opts){
        const u = String(url);
        const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v === undefined ? null : v)), json: () => Promise.resolve(v) });
        if (u.includes("/rpc/")) {
          const fn = u.split("/rpc/")[1].split("?")[0];
          let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch(e){}
          LLAMADAS.push({ fn, body });
          switch (fn) {
            case "validar_usuario": return json([{ codigo: "PEUEBA", nombre: "Prueba Ojo", activo: true, bloqueado: false }]);
            case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1111.74, salida_ref: 987.65, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: "2026-11-14 15:00" });
            case "tarifa_viva_buscador": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1111.74, actualizado: HOY, foto_recibida_en: HOY, fresca: true, edad_min: 3, ultimo_ajuste: null });
            case "dinero_leer_estado": return json({ rol: "buscador", buscador: "PEUEBA",
              estrellas: { estrellas: 4.9, pct_saldo: 32, pct_transferencia: 26, conteo_ganadoras: 75,
                siguiente: { umbral_conteo: 100, estrellas: 5, pct_saldo: 35, faltan: 25 } },
              cupo: 14500, en_mano: 10000, vueltas: [] });
            case "leer_panel": return json({ ok: true, nombre: "Prueba Ojo", tratos: [] });
            case "estado_reportes": return json([]);
            case "mensajes_sin_leer": return json({ ok: true, sin_leer: 0 });
            case "ver_presencia": return json({ ok: true, usuarios: [{ codigo: "ADMIN", nombre: "Ernesto", visto: HOY }] });
            case "leer_chat_ligero": return json({ ok: true, mensajes: CHAT_MSGS, fijado: null, temporal_seg: 0 });
            case "leer_chat": return json({ ok: true, mensajes: CHAT_MSGS, fijado: null, temporal_seg: 0 });
            case "esperas_mi_estado": return json({ ok: true, buscador: "PEUEBA", en_mano: 10000, comprometido: 4000, libre: 6000,
              esperas: [
                { id: "e1", tipo: "saldo", cantidad: 1440, capital_cup: 4000, estado: "abierta", creada_en: HOY, ventana_fin: HOY, cumplida_en: null, tasa_pactada: 2.7778, total_pagado_cup: 4000, vueltas: 0 },
                { id: "e2", tipo: "saldo", cantidad: 720, capital_cup: 2000, estado: "cumplida", creada_en: AYER, ventana_fin: AYER, cumplida_en: HOY, tasa_pactada: 2.7778, total_pagado_cup: 2000, vueltas: 1 },
                { id: "e3", tipo: "transferencia", cantidad: 2600, capital_cup: 2000, estado: "vencida", creada_en: AYER, ventana_fin: AYER, cumplida_en: null, tasa_pactada: null, total_pagado_cup: 2000, vueltas: 0 },
              ] });
            case "espera_crear_app": return json({ ok: true, espera_id: "e9", cantidad_esperada: 1440, libre: 6000 });
            case "pago_mi_estado": return json({ ok: true, buscador: "PEUEBA", vueltas: [
              { vuelta: "v1", tipo: "saldo", creada_en: HOY, producto: 1440, fijo: 300, premio: 50, redondeo: 0, total: 350, estado: "premio_pagado",
                colchon_pct: 10, ref360_protegida: 987.65, valor_unit_protegida: 2.74, salida_ref: 987.65 },
              { vuelta: "v2", tipo: "transferencia", creada_en: HOY, producto: 2600, fijo: 120, premio: 0, redondeo: 0, total: 120, estado: "fijo_congelado",
                colchon_pct: 10, ref360_protegida: 987.65, valor_unit_protegida: 0.9, salida_ref: 987.65 },
            ] });
            case "enviar_mensaje": return json({ ok: true, id: 99 });
            default: return json({ ok: true });
          }
        }
        if (u.includes("datos.json")) return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(datosTxt), json: () => Promise.resolve(datos) });
        return json(null);
      };
    } });
  return { dom, w: dom.window };
}
const llamadasA = fn => LLAMADAS.filter(x => x.fn === fn);

/* ===== Bloque 1: esperas, parte, pago, chat, hoja ===== */
{
  LLAMADAS.length = 0;
  const { w } = crear(true);
  const d = w.document;
  await sleep(900);

  /* --- Esperas --- */
  w.showView("Esperas");
  await sleep(150);
  const ev = d.getElementById("viewEsperas");
  ok(!ev.classList.contains("hide"), "E1 la pantalla de esperas abre");
  const lista = d.getElementById("e_lista").innerHTML;
  ok(lista.includes("Esperando que llegue el SMS"), "E2 estado abierta en palabras claras");
  ok(lista.includes("Asentada"), "E3 estado cumplida = Asentada");
  ok(lista.includes("Ernesto la está revisando"), "E4 estado vencida = Ernesto la está revisando (arbitraje)");
  ok(lista.includes("1,440 de saldo") && lista.includes("2,600 CUP por transferencia"), "E5 cada espera trae su monto y de qué vuelta es");
  ok(lista.includes("Vuelta de saldo") && lista.includes("Vuelta de transferencia"), "E6 el tipo de vuelta va escrito");
  ok(d.getElementById("navEspBadge").textContent === "1" && !d.getElementById("navEspBadge").classList.contains("hide"),
     "E7 la insignia del panel cuenta 1 espera abierta");
  ok(d.getElementById("e_resumen").textContent.includes("6,000") , "E8 el resumen enseña su efectivo libre (6,000)");

  /* --- El parte con tasa --- */
  input(d.getElementById("ep_tasa"), "1000");
  input(d.getElementById("ep_total"), "7000");
  click(w, d.getElementById("ep_btn"));
  await sleep(60);
  ok(d.getElementById("ep_warn").textContent.includes("Te pasas de tu efectivo"), "P1 el parte que pasa de su libre (7,000 > 6,000) se frena con la explicación");
  ok(llamadasA("espera_crear_app").length === 0, "P2 el freno es de la app: NO se mandó nada al servidor");
  input(d.getElementById("ep_tasa"), "0");
  input(d.getElementById("ep_total"), "4000");
  click(w, d.getElementById("ep_btn"));
  await sleep(60);
  ok(d.getElementById("ep_warn").style.display === "block" && llamadasA("espera_crear_app").length === 0,
     "P3 la tasa cero se rechaza sin mandar");
  input(d.getElementById("ep_tasa"), "1000");
  click(w, d.getElementById("ep_btn"));
  await sleep(150);
  const parte = llamadasA("espera_crear_app")[0];
  ok(!!parte && parte.body.p_tasa === 1000 && parte.body.p_total_pagado === 4000 && parte.body.p_tipo === "saldo",
     "P4 el parte bueno viaja con su tasa (1,000) y su total (4,000)");
  ok(d.getElementById("ep_ok").textContent.includes("1,440"), "P5 la confirmación dice cuánto saldo tiene que llegar (1,440)");

  /* --- Mi pago + frontera --- */
  w.showView("Pago");
  await sleep(150);
  const vp = d.getElementById("viewPago");
  ok(!vp.classList.contains("hide"), "M1 la pantalla Mi pago abre");
  const tot = d.getElementById("mp_totales").textContent;
  ok(tot.includes("420.00") && tot.includes("50.00") && tot.includes("470.00"),
     "M2 los totales: asegurado 420 · premio pagado 50 · ya pagado 470 (vino: " + tot.replace(/\s+/g, " ").slice(0, 120) + ")");
  const ms = d.getElementById("mp_saldo"), mt = d.getElementById("mp_transf");
  ok(ms.textContent.includes("300.00") && !ms.textContent.includes("120.00"), "M3 la sección de saldo trae SOLO sus vueltas");
  ok(mt.textContent.includes("120.00") && mt.textContent.includes("depende de la venta"), "M4 la de transferencia trae la suya, con el premio pendiente de la venta");
  const render = (vp.innerHTML + d.getElementById("viewEsperas").innerHTML).toLowerCase();
  ok(!render.includes("987"), "M5 FRONTERA: el valor sonda de la cocina (987.65) no aparece renderizado");
  ok(!/protegida|colchón|colchon|unitario/.test(render), "M6 FRONTERA: ni protegida, ni colchón, ni unitarios en su pantalla");
  ok(!/\bsalida\b/.test(render), "M7 FRONTERA: la palabra «salida» no existe en sus pantallas nuevas");
  ok(d.getElementById("navPagoTxt").textContent.includes("420.00"), "M8 la tarjeta de entrada del panel resume su asegurado");

  /* --- Chat: sonda de foco ×2 ciclos --- */
  w.showView("Ayuda");
  await sleep(300);
  const tx = d.getElementById("c_txt");
  ok(!!tx, "C1 el chat abre con su compositor");
  tx.focus(); input(tx, "estoy escribiendo"); try { tx.setSelectionRange(3, 8); } catch(e){}
  CHAT_MSGS = CHAT_MSGS.concat([{ id: 3, de: "ADMIN", para: "PEUEBA", texto: "mensaje nuevo 1", creado: new Date().toISOString(), leido: false }]);
  w.chatCargar(); await sleep(250);
  ok(d.getElementById("c_txt") === tx && tx.isConnected && d.activeElement === tx, "C2 ciclo 1: el compositor conserva nodo y foco");
  ok(tx.value === "estoy escribiendo" && tx.selectionStart === 3 && tx.selectionEnd === 8, "C3 ciclo 1: texto y selección intactos");
  CHAT_MSGS = CHAT_MSGS.concat([{ id: 4, de: "ADMIN", para: "PEUEBA", texto: "mensaje nuevo 2", creado: new Date().toISOString(), leido: false }]);
  w.chatCargar(); await sleep(250);
  ok(d.getElementById("c_txt") === tx && d.activeElement === tx && tx.value === "estoy escribiendo" && tx.selectionStart === 3,
     "C4 ciclo 2: nodo, foco, texto y selección sobreviven al segundo refresco");

  /* --- Foto + texto en UN envío --- */
  LLAMADAS.length = 0;
  w.CHAT_ADJ = { tipo: "foto", datos: "data:image/jpeg;base64,QUJD", nombre: "foto.jpg", tam: 3, mime: "image/jpeg" };
  input(tx, "mira esta foto");
  w.chatEnviar();
  await sleep(300);
  const envios = llamadasA("enviar_mensaje");
  ok(envios.length === 1, "C5 foto+texto sale en UNA sola llamada (hubo " + envios.length + ")");
  ok(envios.length === 1 && envios[0].body.p_texto === "mira esta foto" && envios[0].body.p_adj_tipo === "foto"
     && String(envios[0].body.p_adj_datos || "").includes("QUJD"),
     "C6 esa única llamada lleva el texto Y la foto juntos");

  /* --- Hoja inferior --- */
  const clicsFile = [];
  ["c_file_foto", "c_file_cam", "c_file_arch"].forEach(id => { const f = d.getElementById(id); if (f) f.addEventListener("click", () => clicsFile.push(id)); });
  click(w, d.getElementById("c_clip"));
  await sleep(120);
  const hoja = d.getElementById("c_adj_hoja");
  ok(hoja.classList.contains("abierta"), "H1 tocar el clip abre la hoja");
  ok(w.getComputedStyle(hoja).position === "fixed", "H2 la hoja es inferior DE VERDAD: posición fija al borde (sale: " + w.getComputedStyle(hoja).position + ")");
  ok(d.getElementById("c_adj_scrim").classList.contains("abierta"), "H3 la hoja trae su fondo oscuro tocable");
  click(w, d.getElementById("c_adj_foto"));
  await sleep(120);
  ok(clicsFile.includes("c_file_foto"), "H4 la fila «Foto o vídeo» dispara su selector en el mismo gesto");
  ok(!hoja.classList.contains("abierta") && !d.getElementById("c_adj_scrim").classList.contains("abierta"), "H5 al elegir, la hoja y su fondo se cierran");
  w.close();
}

/* ===== Bloque 2: la guía ===== */
{
  const { w } = crear(false);
  const d = w.document;
  await sleep(500);
  ok(!d.getElementById("guiaBox").classList.contains("abierta"), "G1 la guía no sale antes de tiempo");
  await sleep(1100);
  const box = d.getElementById("guiaBox");
  ok(box.classList.contains("abierta") && d.getElementById("guiaPaso").textContent.includes("1 DE 4"), "G2 la guía sale sola la primera vez (paso 1 de 4)");
  ok(d.getElementById("navEsperas").classList.contains("guiaRing"), "G3 el paso 1 marca Mis esperas con el anillo");
  click(w, d.getElementById("guiaBtn")); await sleep(80);
  ok(d.getElementById("guiaPaso").textContent.includes("2 DE 4") && d.getElementById("navPago").classList.contains("guiaRing"), "G4 paso 2: Mi pago");
  click(w, d.getElementById("guiaBtn")); await sleep(80);
  ok(d.getElementById("guiaPaso").textContent.includes("3 DE 4") && !d.getElementById("viewAyuda").classList.contains("hide")
     && d.getElementById("c_clip").classList.contains("guiaRing"), "G5 paso 3: el clip, dentro del chat");
  click(w, d.getElementById("guiaBtn")); await sleep(80);
  ok(d.getElementById("guiaPaso").textContent.includes("4 DE 4") && !d.getElementById("viewEsperas").classList.contains("hide")
     && d.getElementById("ep_btn").classList.contains("guiaRing"), "G6 paso 4: enviar el parte, dentro de Mis esperas");
  ok(d.getElementById("guiaBtn").textContent === "Listo", "G7 el último paso cierra con «Listo»");
  click(w, d.getElementById("guiaBtn")); await sleep(80);
  ok(!box.classList.contains("abierta") && w.localStorage.getItem("busc_guia_v170") === "1", "G8 al terminar, la guía se guarda como vista (una sola vez)");
  w.showView("Perfil");
  click(w, d.getElementById("pf_guia")); await sleep(80);
  ok(box.classList.contains("abierta") && d.getElementById("guiaPaso").textContent.includes("1 DE 4"), "G9 la guía se repite desde Mi perfil");
  click(w, d.getElementById("guiaSaltar")); await sleep(40);
  ok(!box.classList.contains("abierta"), "G10 «Saltar» la cierra");
  w.close();
}

console.log("\nBANCO MI TRABAJO v1.7.0 · T3 ESPERAS/PAGO/CHAT/GUÍA: " + pass + " PASS · " + fail + " FAIL");
process.exitCode = fail ? 1 : 0;

// Copia para CI (GitHub Actions) del banco vivo en research_notes — mismos chequeos,
// solo cambian las rutas: jsdom por nombre y la raíz del repo se resuelve desde este archivo
// (o la variable BANCO_REPO). Si el banco vivo cambia, se refresca esta copia.
import { JSDOM } from "jsdom";
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "minegocio/index.html", "utf8");
let pass = 0, fail = 0; const fails = [];
function ok(cond, name) { if (cond) pass++; else { fail++; fails.push(name); console.log("FAIL:", name); } }
function sleep(ms){ return new Promise(r => setTimeout(r, ms * 2)); }

const adminValido = "CODIGO-PRUEBA";
let R = {
  validarOk: true, reportes: [], ayudas: [], usuarios: [],
  chat: true, tarifaVivaOk: true, faltaBorrar: true, guardarOk: true,
  costoOk: true, costoGate: null
};
let llamadas = [];
let ultimosCuerpos = {};
const datosPublicados = { version: 4, versionApp: "1.3.1", apkUrl: "https://example.invalid/apk", tarifa: { version: 4, ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, bonoSaldoRecargas: 150, bonoSaldoCUP: 300, bonoTransfTratos: 10, bonoTransfCUP: 300 }, buscadores: [ { codigo: "BUSC-1", nombre: "Busc Uno", tratos: [] } ] };
const mercadoJson = { ts: "2026-11-11T02:00:00Z", ETECSA: { average: 304.86, average_buy: 290, average_sell: 320, count: 55 }, BANK_CUP: { average: 1068.44, average_buy: 1050, average_sell: 1090, count: 40 } };
let hace2min = "", hace1h = "";
function setupISOs(){
  const h = new Date(Date.now() - 60 * 60000), m2 = new Date(Date.now() - 2 * 60000);
  const p = x => (x < 10 ? "0" : "") + x;
  hace1h = h.getFullYear() + "-" + p(h.getMonth() + 1) + "-" + p(h.getDate()) + " " + p(h.getHours()) + ":" + p(h.getMinutes()) + ":" + p(h.getSeconds());
  hace2min = m2.getFullYear() + "-" + p(m2.getMonth() + 1) + "-" + p(m2.getDate()) + " " + p(m2.getHours()) + ":" + p(m2.getMinutes()) + ":" + p(m2.getSeconds());
}
setupISOs();

function crear(extra){
  llamadas = [];
  const dom = new JSDOM(html, { url: "https://ernesto5058.github.io/calculadora-ernesto/minegocio/", runScripts: "dangerously", pretendToBeVisual: true, beforeParse(w){
    if (extra && extra.preState) { try { w.localStorage.setItem("minegocio_v1", JSON.stringify(extra.preState)); } catch(e){} }
    if (extra && extra.ls) { for (const k in extra.ls) { try { w.localStorage.setItem(k, extra.ls[k]); } catch(e){} } }
    if (extra && extra.push404) { R.pushResp = "pgrst202"; } else { R.pushResp = "ok"; }
    if (extra && extra.sw) {
      /* Stub del service worker para afirmar el mecanismo de
         actualización que sí aterriza (ronda 2): register/update/
         updatefound/statechange/controllerchange observables. */
      const ev = new w.EventTarget();
      const listeners = {};
      ev.addEventListener = (t, f) => { (listeners[t] = listeners[t] || []).push(f); };
      ev.__emit = (t, arg) => (listeners[t] || []).forEach(f => f(arg));
      const fakeWorker = { state: "installing", listeners: {}, addEventListener(t, f){ (this.listeners[t] = this.listeners[t] || []).push(f); },
        postMessage(m){ this.__msg = m; },
        __cambiar(st){ this.state = st; (this.listeners.statechange || []).forEach(f => f()); } };
      const fakeReg = { waiting: null, installing: null, listeners: {}, actualizaciones: 0,
        addEventListener(t, f){ (this.listeners[t] = this.listeners[t] || []).push(f); },
        update(){ this.actualizaciones++; return Promise.resolve(); },
        __updatefound(wk){ this.installing = wk; (this.listeners.updatefound || []).forEach(f => f()); } };
      const swReg = { ready: Promise.resolve(fakeReg), controller: { postMessage(){} },
        register(){ return Promise.resolve(fakeReg); },
        addEventListener(t, f){ ev.addEventListener(t, f); },
        __controllerchange(){ ev.__emit("controllerchange"); } };
      w.__fakeReg = fakeReg; w.__fakeWorker = fakeWorker; w.__swReg = swReg;
      Object.defineProperty(w.navigator, "serviceWorker", { value: swReg, configurable: true });
    }
    if (extra && extra.push) {
      /* Stub de avisos: Notification + PushManager + SW listo con
         pushManager; el permiso lo decide el caso (granted/denied). */
      const fakeSub = { toJSON(){ return { endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } }; } };
      const fakeRegP = { pushManager: { getSubscription(){ return Promise.resolve(fakeSub); }, subscribe(){ return Promise.resolve(fakeSub); } } };
      if (w.__swReg) { w.__swReg.ready = Promise.resolve(fakeRegP); }
      else {
        const swRegP = { ready: Promise.resolve(fakeRegP), controller: null, register(){ return Promise.resolve(fakeRegP); }, addEventListener(){} };
        Object.defineProperty(w.navigator, "serviceWorker", { value: swRegP, configurable: true });
      }
      class FakeNotification { static requestPermission(){ const r = extra.pushPermiso || "granted"; FakeNotification.permission = r; return Promise.resolve(r); } }
      FakeNotification.permission = extra.pushPermisoInicial || "default";
      w.Notification = FakeNotification;
      w.PushManager = class {};
    }
    w.fetch = function(url, opts){
    const u = String(url);
    llamadas.push(u);
    function rechaza(msg, st){ return Promise.resolve({ ok: false, status: st || 404, text: () => Promise.resolve(JSON.stringify({ message: msg || "404" })), json: () => Promise.resolve({ message: msg || "404" }) }); }
    function sinRed(){ const e = new Error("Failed to fetch"); e.message = "Failed to fetch"; return Promise.reject(e); }
    if (extra && extra.sinRed && (u.includes("supabase") || u.includes("datos.json") || u.includes("ultimo.json"))) return sinRed();
    if (u.includes("/rpc/")) {
      const fn = u.split("/rpc/")[1].split("?")[0];
      let body = {}; try { body = JSON.parse(opts && opts.body || "{}"); } catch(e){}
      llamadas.push("rpc:" + fn);
      ultimosCuerpos[fn] = body;
      const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v === undefined ? null : v)), json: () => Promise.resolve(v) });
      switch (fn) {
        case "admin_validar": return json(R.validarOk && body.p_codigo === adminValido);
        case "admin_reportes": return json(R.reportes);
        case "admin_ayudas": return json(R.ayudas);
        case "admin_usuarios": return json(R.usuarios);
        case "admin_aprobar": case "admin_rechazar": case "admin_ayuda_vista":
        case "admin_usuario_activo": case "admin_usuario_nuevo": return json({ ok: true });
        case "admin_usuario_borrar": return R.faltaBorrar ? rechaza("404") : json({ ok: true });
        case "ver_presencia":
          if (!R.chat) return rechaza("404");
          return json({ ok: true, usuarios: [
            { codigo: "BUSC-1", nombre: "Busc Uno", visto: new Date(Date.now() - 60 * 1000).toISOString() },
            { codigo: "BUSC-2", nombre: "Busc Dos", visto: hace1h },
            { codigo: "ADMIN", nombre: "Ernesto", visto: new Date().toISOString() } ] });
        case "mensajes_sin_leer": return R.chat ? json({ ok: true, por_usuario: { "BUSC-1": 2 }, total: 2 }) : rechaza("404");
        case "leer_chat":
          if (!R.chat) return rechaza("404");
          return json(Object.assign({ ok: true, mensajes: R.chatMsgs || [] }, R.chatExtra || {}));
        case "reaccionar": case "editar_mensaje": case "borrar_mensaje":
        case "fijar_mensaje": case "guardar_temporal": return json({ ok: true });
        case "enviar_mensaje": return R.chat ? json({ ok: true }) : rechaza("404");
        case "admin_marcar_pagado":
          /* Servidor sano: el sello PERSISTE en la «base» del mock y
             las lecturas siguientes lo traen (contrato real de la
             puerta). Con R.noPersistePago se modela el caso fantasma:
             responde ok pero la base nunca guarda el sello. */
          { const fila = R.reportes.find(x => String(x.id) === String(body.p_id));
            if (fila && !fila.comision_pagada_en && !R.noPersistePago) fila.comision_pagada_en = new Date().toISOString();
            return json({ ok: true }); }
        case "admin_generar_cierre": return json({ ok: true });
        case "admin_marcar_prueba": return json({ ok: true });
        case "registrar_push_admin":
          if (R.pushResp === "pgrst202") return Promise.resolve({ ok: false, status: 404,
            text: () => Promise.resolve(JSON.stringify({ code: "PGRST202", message: "Could not find the function public.registrar_push_admin in the schema cache" })),
            json: () => Promise.resolve({ code: "PGRST202", message: "Could not find the function public.registrar_push_admin in the schema cache" }) });
          return json({ ok: true });
        case "admin_cierres": return json([]);
        case "admin_actividad": return json(R.actividad || []);
        case "guardar_perfil": return json({ ok: true });
        case "leer_perfil": return json(null);
        case "tocar_presencia":
          return (body.p_codigo === "BUSC-1" || body.p_codigo === adminValido) ? json({ ok: true }) : rechaza("no es usuario");
        case "marcar_recibidos": return json({ ok: true, marcados: 1 });
        case "admin_guardar_tarifa": return R.guardarOk ? json({ ok: true }) : rechaza("404");
        case "mercado_fijar_costo":
          if (R.costoGate) return R.costoGate.promise;
          return R.costoOk ? json({ ok: true }) : rechaza("404");
        case "admin_publicar_tratos": return json({ ok: true });
        case "leer_tarifa":
          return R.tarifaVivaOk ? json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 950, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: "2026-11-10 22:00" }) : rechaza("404");
      }
      return rechaza("desconocida " + fn);
    }
    if (u.includes("datos.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(datosPublicados) });
    if (u.includes("ultimo.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(mercadoJson) });
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    };
  } });
  return { dom, w: dom.window };
}
function click(el){ el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); }
function input(el, v){ el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true })); }
function pestaña(w, nombre){ [...w.document.querySelectorAll(".tab")].forEach(t => { if (t.textContent.includes(nombre)) click(t); }); }

/* ===== 1. LOGIN ===== */
{
  const { w } = crear();
  await sleep(120);
  const d = w.document;
  ok(d.getElementById("scrAcceso").style.display !== "none", "MN-1 login visible sin código guardado");
  input(d.getElementById("inCodigo"), "MALO-000");
  click(d.getElementById("btnEntrar"));
  await sleep(150);
  ok(d.getElementById("errAcceso").textContent.includes("no es el de administrador"), "MN-2 login inválido rechazado");
  input(d.getElementById("inCodigo"), adminValido);
  w.__tok = true;
  click(d.getElementById("btnEntrar"));
  await sleep(250);
  ok(d.getElementById("scrPanel").style.display === "block", "MN-3 login válido entra");
  ok(llamadas.includes("rpc:tocar_presencia") && llamadas.includes("rpc:marcar_recibidos"), "MN-4 latido admin + marcar_recibidos al entrar");
  const guardado = JSON.parse(w.localStorage.getItem("minegocio_v1"));
  ok(guardado.codigo === adminValido && guardado.foto.cuando !== "", "MN-5 código y foto guardados solo en localStorage del aparato");
  w.close();
}

/* ===== 2. CALCULADORA v14 (offline, sin red en absoluto) ===== */
{
  const { w } = crear({ sinRed: true, preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(200);
  const d = w.document;
  pestaña(w, "Calculadora");
  await sleep(60);
  // defaults v14: total = ((360/320)*950 - 1040) * (3600/360) - 14.44 = 271.06
  ok(d.getElementById("c_out_s").textContent.includes("273.06"), "MN-6 calc saldo default 273.06 (caso v14: 28.75 x 10 - 14.44)");
  ok(d.getElementById("c_out_s").textContent.includes("328.85"), "MN-7 equilibrio 328.85");
  // transferencia: 5000 al 30% libro 1130 salida 950 → gana 964.60, eq 18.95%
  ok(d.getElementById("c_out_t").textContent.includes("464.60"), "MN-8 calc transf ganancia 464.60");
  ok(d.getElementById("c_out_t").textContent.includes("18.95"), "MN-9 equilibrio de vuelta 18.95%");
  // buscadores: ingreso (360/313)*950 = 1092.65 · paga saldo 25% de (1092.65-950)=35.66 · vuelta: 5000 al 30 libro 1110 salida 950 → 564.86, paga 20% = 112.97
  ok(d.getElementById("c_out_b").textContent.includes("1,092.65") || d.getElementById("c_out_b").textContent.includes("1092.65"), "MN-10 busc saldo ingreso 1092.65");
  ok(d.getElementById("c_out_b").textContent.includes("112.61"), "MN-11 busc transf paga 112.61");
  // cambio en vivo: tasa 300 → total = ((360/300)*950-1040)*10-14.44 = 985.56
  input(d.getElementById("c_s_tasa"), "300");
  await sleep(40);
  ok(d.getElementById("c_out_s").textContent.includes("985.56"), "MN-12 recálculo en vivo tasa 300 → 985.56");
  const st = JSON.parse(w.localStorage.getItem("minegocio_v1"));
  ok(Number(st.calc.saldo.tasa) === 300, "MN-13 la calculadora se guarda en localStorage");
  w.close();
}

/* ===== 3. BANDEJA: comisión v2 conocida + aprobar ===== */
{
  R.reportes = [ { id: "r1", codigo: "BUSC-1", nombre: "Busc Uno", tipo: "saldo", cantidad: 100, precio: 1000, porc: null, telefono: "50000000", nota: "", estado: "pendiente", creado: "2026-11-10" } ];
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ];
  R.ayudas = [];
  R.chat = true; R.tarifaVivaOk = true;
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, calc: { saldo: { salida: 950, costo: 1040, tasa: 320, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 }, busc: { precio: 0, tasaVenta: 0, efectivo: 0, porc: 0, libro: 0, salida: 0 } }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  ok(d.getElementById("scrPanel").style.display === "block", "MN-14 con código guardado entra directo");
  pestaña(w, "Bandeja");
  await sleep(60);
  ok(d.getElementById("pgBandeja").textContent.includes("2467.00"), "MN-15 comisión v2 del caso conocido = 2467.00");
  const btnAp = d.querySelector("[data-ap]");
  ok(!!btnAp, "MN-16 botón aprobar existe");
  click(btnAp);
  await sleep(250);
  const st = JSON.parse(w.localStorage.getItem("minegocio_v1"));
  ok(st.foto.reportes[0].estado === "aprobado" && Number(st.foto.reportes[0].comision) === 2467, "MN-17 aprobado local con la comisión");
  ok(st.foto.publicar.length === 1 && st.foto.publicar[0].codigo === "BUSC-1", "MN-18 trato quedó en la cola de publicación de tarifa");
  ok(llamadas.includes("rpc:admin_aprobar"), "MN-19 la aprobación salió por la puerta (o quedó despachada)");
  w.close();
  R.reportes = [];
}

/* ===== 4. DEGRADACIÓN TOTAL sin puertas (presencia/chat/tarifa) ===== */
{
  R.chat = false; R.tarifaVivaOk = false; R.guardarOk = false;
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, calc: { saldo: { salida: 950, costo: 1040, tasa: 320, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 }, busc: { precio: 0, tasaVenta: 0, efectivo: 0, porc: 0, libro: 0, salida: 0 } }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  ok(d.getElementById("pgInicio").textContent.includes("falta activar"), "MN-20 inicio avisa chat/presencia sin activar y sigue");
  pestaña(w, "Equipo");
  await sleep(60);
  ok(d.getElementById("pgEquipo").textContent.includes("todavía no están activados"), "MN-21 equipo degrada con aviso claro");
  ok(!d.querySelector("[data-chat]"), "MN-22 sin puertas no hay botón de chat");
  ok(!!d.querySelector("[data-act]"), "MN-23 activar/desactivar sigue disponible");
  pestaña(w, "Tarifa");
  await sleep(60);
  ok(d.getElementById("tf_ing").value.includes("1098.68"), "MN-24 tarifa cae al respaldo datos.json (1098.68)");
  click(d.getElementById("tfPub"));
  await sleep(250);
  ok(d.getElementById("hojaTit").textContent.includes("pendiente"), "MN-25 Publicar sin puertas → hoja de pendiente + respaldo");
  const st = JSON.parse(w.localStorage.getItem("minegocio_v1"));
  ok(!!st.publicarPendiente, "MN-26 la tarifa quedó guardada como pendiente, no se perdió");
  click([...d.querySelectorAll("#hojaBtns button")].find(b => b.textContent.includes("datos.json")) || d.createElement("button"));
  await sleep(80);
  ok((d.getElementById("hJson") || { value: "" }).value.includes('"ingresoRef360": 1098.68'), "MN-27 respaldo datos.json se genera bien");
  w.close();
  R.chat = true; R.tarifaVivaOk = true; R.guardarOk = true;
}

/* ===== 5. OFFLINE: foto por pestaña + cola y despacho ===== */
{
  const fotoLocal = { reportes: [ { id: "r9", codigo: "BUSC-1", nombre: "Busc Uno", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "pendiente", creado: "2026-11-10" } ],
    ayudas: [], usuarios: [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ], datos: datosPublicados, cuando: "2026-11-11 01:00", publicar: [], borrados: [], tarifaPanel: null,
    mercado: mercadoJson };
  const { w } = crear({ sinRed: true, preState: { codigo: adminValido, foto: fotoLocal, cola: [], sellos: { bandeja: new Date(Date.now() - 5 * 60000).toISOString(), mercado: new Date(Date.now() - 5 * 60000).toISOString() }, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  ok(d.getElementById("lblEstado").textContent.includes("Sin conexión"), "MN-28 offline: cabecera dice sin conexión");
  ok(d.getElementById("bannerOff").style.display === "block" && d.getElementById("bannerOff").textContent.includes("hace 5 min"), "MN-29 banner offline con sello «hace 5 min»");
  pestaña(w, "Bandeja");
  await sleep(60);
  ok(d.getElementById("pgBandeja").textContent.includes("Busc Uno"), "MN-30 offline: la bandeja lee la última foto guardada");
  click(d.querySelector("[data-ap]"));
  await sleep(120);
  let st = JSON.parse(w.localStorage.getItem("minegocio_v1"));
  ok(st.cola.some(a => a.tipo === "aprobar" && a.id === "r9"), "MN-31 offline: aprobar queda ENCOLADO, no se pierde");
  ok(st.foto.reportes[0].estado === "aprobado", "MN-32 offline: el cambio se ve aplicado localmente");
  pestaña(w, "Inicio");
  await sleep(60);
  ok(d.getElementById("pgInicio").textContent.includes("Pendientes de enviar"), "MN-33 la cola es visible en Inicio");
  pestaña(w, "Mercado");
  await sleep(80);
  ok(d.getElementById("pgMercado").textContent.includes("1097.50"), "MN-34 mercado offline: 304.86 × 3.6 = 1097.50 (unidad por 100 respetada)");
  ok(d.getElementById("pgMercado").textContent.includes("hace 5 min"), "MN-35 mercado offline con su sello");
  // vuelve la red: se simula quitando sinRed recargando la ventana con la misma foto+cola
  w.close();
  const st2 = st;
  const segunda = crear({ preState: st2 });
  await sleep(400);
  const stF = JSON.parse(segunda.w.localStorage.getItem("minegocio_v1"));
  ok(stF.cola.length === 0, "MN-36 al volver la red la cola se despacha sola");
  ok(llamadas.includes("rpc:admin_aprobar"), "MN-37 el despacho llamó la puerta de aprobar");
  segunda.w.close();
}

/* ===== 6. CHAT como WhatsApp (estados con y sin recibido) ===== */
{
  R.chat = true;
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ];
  R.chatMsgs = [
    { id: "a", de: "ADMIN", para: "BUSC-1", texto: "con sello", creado: hace2min, leido: false, recibido: hace2min },
    { id: "b", de: "ADMIN", para: "BUSC-1", texto: "visto ya", creado: hace2min, leido: true },
    { id: "c", de: "ADMIN", para: "BUSC-1", texto: "recien enviado", creado: new Date().toISOString(), leido: false },
    { id: "d", de: "BUSC-1", para: "ADMIN", texto: "respuesta", creado: hace2min, leido: false }
  ];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: R.usuarios, datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  pestaña(w, "Equipo");
  await sleep(120);
  ok(d.getElementById("pgEquipo").textContent.includes("En línea"), "MN-38 equipo: buscador en línea (latido 1 min)");
  click(d.querySelector("[data-chat]"));
  await sleep(250);
  const chat = d.getElementById("pgChat");
  ok(chat.style.display === "block", "MN-39 el chat abre");
  ok(chat.textContent.toLowerCase().includes("en línea"), "MN-40 cabecera del chat: en línea");
  ok(chat.textContent.includes("✓✓ entregado"), "MN-41 estado ENTREGADO por sello recibido del servidor");
  ok(chat.textContent.includes("Visto"), "MN-42 estado VISTO por leido=true");
  /* v7: la hora y el estado van DENTRO de la burbuja (.burMeta), ya
     no bajo ella (.mhoraP, diseño retirado por el arreglo WhatsApp). */
  const burbujas = [...chat.querySelectorAll(".burMeta")].map(e => e.textContent);
  ok(burbujas.some(t => t.includes("✓ enviado")), "MN-43 estado ENVIADO (sin sello ni latido posterior)");
  input(d.getElementById("chTexto"), "mensaje nuevo de prueba");
  click(d.getElementById("chEnviar"));
  await sleep(200);
  ok(llamadas.includes("rpc:enviar_mensaje"), "MN-44 enviar mensaje sale por su puerta");
  w.close();
  R.chatMsgs = [];
}


/* ===== 6B. CHAT PRO: sistema/cita/reacciones/fijado/temporales/adjuntos ===== */
{
  R.chat = true;
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ];
  R.chatMsgs = [
    { id: 51, de: "BUSC-1", para: "ADMIN", texto: "mira el comprobante", creado: hace2min, leido: true, adj_tipo: "foto", adj_datos: "QUJD", adj_nombre: "c.jpg", reacciones: [{ emoji: "👍", total: 1, mios: false }] },
    { id: 52, de: "ADMIN", para: "BUSC-1", texto: "perfecto, sigue asi", creado: hace2min, leido: false, recibido: hace2min, resp_de: 51, resp_autor: "BUSC-1", resp_texto: "mira el comprobante" },
    { id: 53, de: "ADMIN", para: "ADMIN", tipo: "sistema", texto: "📋 Nueva tarifa publicada", creado: hace2min },
    { id: 54, de: "BUSC-1", para: "ADMIN", texto: "", creado: hace2min, leido: true, adj_tipo: "voz", adj_datos: "QUJD" },
    { id: 55, de: "ADMIN", para: "BUSC-1", texto: "secreto", creado: hace2min, leido: true, borrado: true }
  ];
  R.chatExtra = { fijado: { id: 52, texto: "perfecto, sigue asi" }, temporal_seg: 86400 };
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: R.usuarios, datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  pestaña(w, "Equipo");
  await sleep(120);
  click(d.querySelector("[data-chat]"));
  await sleep(250);
  const chat = d.getElementById("pgChat");
  ok(chat.querySelector(".msgSistema") && chat.textContent.includes("Nueva tarifa publicada"), "MN-73 aviso del sistema centrado, sin burbuja");
  ok(chat.textContent.includes("Este mensaje fue eliminado"), "MN-74 el borrado suave se lee «Este mensaje fue eliminado»");
  ok(!!chat.querySelector(".adjFoto"), "MN-75 la foto adjunta se pinta en la burbuja");
  ok(!!chat.querySelector(".vozP") && !/audio[^>]*\scontrols/.test(chat.innerHTML), "MN-76 la nota de voz se pinta con el reproductor PRO (.vozP) y ningún <audio controls> pelado");
  ok(chat.querySelector(".citaB") && chat.textContent.includes("mira el comprobante"), "MN-77 la cita del mensaje respondido se muestra");
  ok(chat.textContent.includes("👍 1"), "MN-78 las reacciones se ven con conteo");
  ok(!!chat.querySelector(".fijadoBar"), "MN-79 la barra del fijado aparece sobre el chat");
  ok(chat.textContent.includes("desaparecen en 24 h"), "MN-80 la línea de temporales dice la ventana (24 h)");
  // presión larga en burbuja ajena → menú sin Editar; reaccionar ❤️
  const burA = chat.querySelector('[data-mid="51"]');
  const evA = new w.MouseEvent("pointerdown", { bubbles: true, cancelable: true });
  Object.defineProperty(evA, "clientX", { value: 10 }); Object.defineProperty(evA, "clientY", { value: 10 });
  burA.dispatchEvent(evA);
  await sleep(500);
  let btns = [...d.querySelectorAll("#hojaBtns button")].map(b => b.textContent);
  ok(btns.some(x => x.includes("Responder")) && btns.some(x => x.includes("Reaccionar")), "MN-81 el menú de burbuja ajena trae Responder y Reaccionar");
  ok(!btns.some(x => x.includes("Editar")), "MN-82 en mensaje AJENO no hay Editar");
  click([...d.querySelectorAll("#hojaBtns button")].find(b => b.textContent.includes("❤️")));
  await sleep(150);
  ok(llamadas.includes("rpc:reaccionar") && ultimosCuerpos.reaccionar.p_id === 51 && ultimosCuerpos.reaccionar.p_emoji === "❤️", "MN-83 reaccionar sale como ADMIN con el emoji");
  // responder con cita y enviar
  burA.dispatchEvent(new w.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  await sleep(500);
  click([...d.querySelectorAll("#hojaBtns button")].find(b => b.textContent.includes("Responder")));
  await sleep(60);
  input(d.getElementById("chTexto"), "respuesta con cita");
  click(d.getElementById("chEnviar"));
  await sleep(250);
  ok(llamadas.includes("rpc:enviar_mensaje") && ultimosCuerpos.enviar_mensaje.p_resp_de === 51, "MN-84 el envío con cita lleva p_resp_de del original");
  // editar mensaje propio
  const burP = chat.querySelector('[data-mid="52"]');
  burP.dispatchEvent(new w.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  await sleep(500);
  btns = [...d.querySelectorAll("#hojaBtns button")].map(b => b.textContent);
  ok(btns.some(x => x.includes("Editar")) && btns.some(x => x.includes("Eliminar para todos")), "MN-85 el menú propio trae Editar y Eliminar");
  click([...d.querySelectorAll("#hojaBtns button")].find(b => b.textContent.includes("Editar")));
  await sleep(60);
  ok(d.getElementById("chTexto").value === "perfecto, sigue asi", "MN-86 Editar rellena el cuadro con el texto");
  input(d.getElementById("chTexto"), "perfecto, sigue HOY");
  click(d.getElementById("chEnviar"));
  await sleep(200);
  ok(llamadas.includes("rpc:editar_mensaje") && ultimosCuerpos.editar_mensaje.p_id === 52, "MN-87 la edición sale por editar_mensaje");
  // temporales: 7 días
  click(d.getElementById("chTempBtn"));
  await sleep(80);
  click([...d.querySelectorAll("#hojaBtns button")].find(b => b.textContent.includes("7 días")));
  await sleep(150);
  ok(llamadas.includes("rpc:guardar_temporal") && ultimosCuerpos.guardar_temporal.p_horas === 168 && ultimosCuerpos.guardar_temporal.p_con === "BUSC-1", "MN-88 guardar_temporal recibe 168 h y la conversación");
  w.close();
  R.chatMsgs = []; R.chatExtra = null;
}

/* ===== 7. ELIMINAR: bloqueado offline / degrada sin puerta ===== */
{
  R.faltaBorrar = true;
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ];
  const off = crear({ sinRed: true, preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: R.usuarios, datos: datosPublicados, cuando: "2026-11-11 01:00", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(250);
  const d1 = off.w.document;
  pestaña(off.w, "Equipo");
  await sleep(60);
  click(d1.querySelector("[data-udot]"));
  await sleep(60);
  const btnElim = [...d1.querySelectorAll("#hojaBtns button")].find(b => b.textContent.includes("Eliminar"));
  click(btnElim);
  await sleep(80);
  ok(d1.getElementById("hojaTit").textContent.includes("necesita conexión"), "MN-45 eliminar se BLOQUEA offline con explicación (no se encola)");
  off.w.close();
}

/* ===== 8. MERCADO online: unidad por 100 ===== */
{
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(250);
  pestaña(w, "Mercado");
  await sleep(200);
  const d = w.document;
  ok(d.getElementById("pgMercado").textContent.includes("1097.50"), "MN-46 ingreso por 360 = promedio × 3.6 (NO ×100)");
  ok(d.getElementById("pgMercado").textContent.includes("por cada 100"), "MN-47 la unidad por 100 se explica en la app");
  w.close();
}

/* ===== 9. MODULARIDAD: el registro existe y las 6 pestañas están ===== */
{
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(150);
  const tabs = [...w.document.querySelectorAll(".tab")].map(t => t.textContent);
  ok(tabs.length === 10, "MN-48 diez pestañas registradas: 6 originales + Cierre/Actividad/Textos + Contabilidad (Fase 1) (" + tabs.join(" | ") + ")");
  ok(tabs.some(t => t.includes("Inicio")) && tabs.some(t => t.includes("Calculadora")) && tabs.some(t => t.includes("Bandeja")) && tabs.some(t => t.includes("Equipo")) && tabs.some(t => t.includes("Tarifa")) && tabs.some(t => t.includes("Mercado")) && tabs.some(t => t.includes("Cierre")) && tabs.some(t => t.includes("Actividad")) && tabs.some(t => t.includes("Textos")) && tabs.some(t => t.includes("Contabilidad")), "MN-49 las 10 pestañas exactas (las 9 del paquete + Contabilidad), ninguna otra inventada");
  w.close();
}

/* ===== 10. SERVICE WORKER: scope y caché propios ===== */
{
  const sw = fs.readFileSync(REPO + "minegocio/sw.js", "utf8");
  ok(sw.includes('CACHE = "minegocio-v10"'), "MN-50 SW con caché propio minegocio-v10 (v10 tanda 3 errores: textos único, actividad en claro, chat duro; v9 botón «Enviar su enlace» en Equipo; v8 rediseño PRO de toda la app; v7 rediseño Contabilidad, v6 Fase 1, v5 local-first, v4 ronda 2, v3 ronda 1)");
  ok(sw.includes("SKIP_WAITING") && sw.includes('addEventListener("message"'), "MN-50b el SW acepta SKIP_WAITING por mensaje (forzar activación desde la app)");
  ok(!sw.includes("mitrabajo"), "MN-51 el SW de Mi Negocio no toca el de Mi Trabajo");
  const mf = JSON.parse(fs.readFileSync(REPO + "minegocio/manifest.webmanifest", "utf8"));
  ok(mf.display === "standalone" && mf.icons.length === 2, "MN-52 manifest standalone con iconos 192/512");
}

/* ===== 11. SEGUNDA TANDA + GENERADOR + AVISOS ===== */
{
  const hoyISO = new Date().toISOString();
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ];
  R.reportes = [
    { id: 41, codigo: "BUSC-1", nombre: "Busc Uno", tipo: "saldo", cantidad: 10, precio: 1000, estado: "aprobado", comision: 500, creado: hoyISO },
    { id: 42, codigo: "BUSC-1", nombre: "Busc Uno", tipo: "transferencia", cantidad: 5000, precio: null, porc: 30, estado: "aprobado", comision: 300, creado: hoyISO },
    { id: 43, codigo: "BUSC-1", nombre: "Busc Uno", tipo: "saldo", cantidad: 2, precio: 1000, estado: "pendiente", creado: hoyISO }
  ];
  R.ayudas = [];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  ok(w.document.getElementById("pgInicio").textContent.includes("Semáforo del equipo"), "MN-53 Inicio trae el semáforo del equipo");
  ok(w.document.getElementById("pgInicio").textContent.includes("HOY REPORTÓ"), "MN-54 semáforo: reportó hoy = SÍ (reporte de hoy en la foto)");
  const ctas = w.cuentasSemana();
  ok(ctas.total === 800, "MN-55 cuentas de la semana: 500 + 300 = 800 pendientes (recibido " + ctas.total + ")");
  ok(w.document.getElementById("pgInicio").textContent.includes("Cuentas de la semana"), "MN-56 tarjeta de cuentas visible en Inicio");
  w.marcarPagado(w.state.foto.reportes.find(r => r.id === 41));
  await sleep(60);
  ok(w.state.cola.some(a => a.tipo === "pagado" && a.id === 41) || llamadas.includes("rpc:admin_marcar_pagado"), "MN-57 «Ya pagué» despacha o encola admin_marcar_pagado");
  ok(w.cuentasSemana().total === 300, "MN-58 tras pagar la de 500, la cuenta baja a 300 (queda la de 300)");
  const resp = JSON.stringify(w.respaldoSinCodigos());
  ok(!resp.includes(adminValido) && !resp.includes("BUSC-1"), "MN-59 el respaldo NO contiene ningún código (ni admin ni de buscadores)");
  ok(resp.includes("Busc Uno"), "MN-60 el respaldo sí trae nombres y tratos");
  /* Motor de textos */
  const M = w.TextosMotor;
  ok(!!M, "MN-61 el motor de textos compartido está inyectado");
  let combos = 0;
  for (const tono of ["humanizado", "comercial", "formal", "directo"]) for (const em of ["muchos", "pocos", "ninguno"]) {
    const r = M.generar({ tipo: "vendo", producto: "Batería", precio: 125000, moneda: "CUP", telefono: "51234567", zona: "Micro 9", estilo: { tono, emojis: em, tamano: "completo", whatsapp: true }, quien: "BUSC-1" });
    if (r.versiones.length === 3) combos++;
  }
  ok(combos === 12, "MN-62 motor: 4 tonos × 3 niveles de emoji generan 3 versiones (" + combos + "/12)");
  const rp = M.generar({ tipo: "vendo", producto: "Batería", privado: true, telefono: "51234567", estilo: { tono: "directo", emojis: "pocos", tamano: "corto" }, quien: "BUSC-1" });
  ok(!/125|\d{3,}/.test(rp.versiones[0].texto.replace(/51234567/g, "")), "MN-63 precio por privado: ninguna cifra inventada en el texto");
  const rst = M.generar({ tipo: "vendo", producto: "Batería", precio: 100, moneda: "CUP", estilo: { tono: "directo", emojis: "pocos", tamano: "corto" }, quien: "BUSC-1" });
  ok(rst.avisos.length > 0, "MN-64 sin teléfono: el motor avisa en vez de inventar");
  const rm = M.generar({ tipo: "vendo", producto: "Batería", precio: 125000, moneda: "CUP", telefono: "1", estilo: { tono: "comercial", emojis: "pocos", tamano: "completo" }, quien: "BUSC-1" });
  ok(rm.versiones.some(v => v.texto.includes("125 000")), "MN-65 miles con espacio: «125 000»");
  const va = M.generar({ tipo: "vendo", producto: "Lavadora", precio: 10, moneda: "CUP", telefono: "1", estilo: { tono: "humanizado", emojis: "pocos", tamano: "completo" }, quien: "BUSC-A" });
  const vb = M.generar({ tipo: "vendo", producto: "Lavadora", precio: 10, moneda: "CUP", telefono: "1", estilo: { tono: "humanizado", emojis: "pocos", tamano: "completo" }, quien: "BUSC-B" });
  ok(va.versiones[0].texto !== vb.versiones[0].texto, "MN-66 variación por semilla: dos trabajadores, textos distintos");
  let hist = []; for (let i = 0; i < 35; i++) hist = M.historialPush(hist, { titulo: "t" + i });
  ok(hist.length === 30, "MN-67 historial del generador con tope de 30");
  const rapido = M.textoRapidoSaldo({ precioCompraRecarga: 913, telefono: "51234567", zona: "Micro 9", condicionesSaldo: "Efectivo" }, { tono: "directo", emojis: "pocos", tamano: "corto" }, "BUSC-1");
  const txtRapido = rapido.versiones.map(v => v.texto).join(" ");
  ok(txtRapido.includes("913") && !txtRapido.includes("1 099") && !/comisi/i.test(txtRapido), "MN-68 NO-FILTRACIÓN: el texto rápido no trae ingreso interno ni comisiones");
  ok(w.estadoPush() === "sin-soporte" || w.estadoPush() === "pedir", "MN-69 estadoPush responde sin romperse en un navegador sin push (" + w.estadoPush() + ")");
  const sw = fs.readFileSync(REPO + "minegocio/sw.js", "utf8");
  ok(sw.includes('addEventListener("push"') && sw.includes("notificationclick"), "MN-70 SW con handlers push + notificationclick");
  ok(sw.includes("📋 Reporte nuevo") && sw.includes("miles"), "MN-71 plantilla PRO de avisos en el SW (emoji con sentido + miles con espacio)");
  ok(sw.includes('indexOf("minegocio-") === 0') || sw.includes('startsWith("minegocio-")'), "MN-72 el activate solo borra cachés con SU prefijo (colisión resuelta)");
  w.close();
}

/* ===== 12. RONDA 2 · ACTUALIZACIÓN QUE SÍ ATERRIZA ===== */
{
  const pre = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ sw: true, preState: pre });
  await sleep(250);
  const d = w.document;
  ok(w.__fakeReg.actualizaciones >= 1, "R2-1 al arrancar la app llama registration.update()");
  w.__fakeReg.__updatefound(w.__fakeWorker);
  w.__fakeWorker.__cambiar("installed");
  await sleep(60);
  ok(d.getElementById("bannerVer").style.display === "block" && d.getElementById("bannerVer").textContent.includes("Nueva versión lista"), "R2-2 SW nuevo instalado con controlador → aviso «Nueva versión lista» visible");
  w.__swReg.__controllerchange();
  await sleep(60);
  ok(("" + w.sessionStorage.getItem("mnRecarga_v10")) === "1", "R2-3 controllerchange marca la recarga única de la v10 (sin bucles)");
  const antes = w.__fakeReg.actualizaciones;
  click(d.getElementById("btnAct"));
  await sleep(120);
  ok(w.__fakeReg.actualizaciones > antes, "R2-4 el botón «⟳ Actualizar» también dispara registration.update()");
  w.close();
}

/* ===== 13. RONDA 2 · AVISOS POR ETAPAS ===== */
{
  /* (a) la puerta registrar_push_admin NO existe (PGRST202): la
     suscripción queda lista EN EL TELÉFONO, sin culpar al permiso. */
  const { w } = crear({ push: true, push404: true, pushPermiso: "granted", preState: { codigo: "", foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(200);
  w.state.codigo = adminValido;
  w.activarAvisosMN();
  await sleep(300);
  const dA = w.document;
  ok(!!w.localStorage.getItem("minegocio_push_pendiente"), "R2-5 PGRST202: la suscripción queda guardada local como pendiente de registro");
  ok(dA.getElementById("toast").textContent.includes("Avisos listos en este teléfono"), "R2-6 PGRST202: el aviso dice «listos en este teléfono», no un error");
  ok(!/permiso/i.test(dA.getElementById("toast").textContent), "R2-7 PGRST202: el aviso NO culpa al permiso de notificaciones");
  ok(w.bloqueAvisosHtml().includes("✅ Avisos listos en este teléfono"), "R2-8 la tarjeta refleja el estado real: «✅ Avisos listos en este teléfono»");
  w.close();
}
{
  /* (b) permiso denegado: el mensaje SÍ es de permiso. */
  const { w } = crear({ push: true, pushPermiso: "denied", preState: { codigo: "", foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(200);
  w.state.codigo = adminValido;
  w.activarAvisosMN();
  await sleep(250);
  ok(/permiso/i.test(w.document.getElementById("toast").textContent), "R2-9 permiso denegado → mensaje de permiso");
  ok(!w.localStorage.getItem("minegocio_push_pendiente"), "R2-10 permiso denegado → no se guarda ninguna suscripción pendiente");
  w.close();
}
{
  /* (c) pendiente sembrado + arranque con puertas OK: el registro
     se completa solo en el cargarTodo y el pendiente se borra. */
  const pend = JSON.stringify({ sub: { endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } }, plataforma: "web", en: "2026-11-11T00:00:00.000Z" });
  const { w } = crear({ ls: { minegocio_push_pendiente: pend }, preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(400);
  ok(llamadas.includes("rpc:registrar_push_admin"), "R2-11 al cargar con puertas OK se reintenta el registro del push pendiente");
  ok(!w.localStorage.getItem("minegocio_push_pendiente"), "R2-12 registro completado → el pendiente local se borra");
  w.close();
}

/* ===== 14. RONDA 2 · CUENTAS SIN «?» ===== */
{
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ];
  R.reportes = [
    { id: 71, nombre: "Prueba", tipo: "saldo", cantidad: 100, precio: 1000, estado: "aprobado", comision: 2467, creado: new Date().toISOString() },
    { id: 72, codigo: "BUSC-1", nombre: "Busc Uno", tipo: "saldo", cantidad: 2, precio: 1000, estado: "aprobado", comision: 100, creado: new Date().toISOString() }
  ];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const c = w.cuentasSemana();
  ok(c.total === 100, "R2-13 cuentas: el total por pagar es 100 (solo el trato con buscador válido), recibido " + c.total);
  ok(c.retenidos.length === 1 && c.retenidos[0].nombre === "Prueba" && c.retenidos[0].comision === 2467, "R2-14 el trato sin código resoluble queda RETENIDO con nombre y comisión");
  const htmlC = w.bloqueCuentasHtml();
  ok(!htmlC.includes("?"), "R2-15 la tarjeta de cuentas ya no muestra ninguna fila «?» (ningún «?» en toda la tarjeta)");
  ok(htmlC.includes("sin buscador válido") && htmlC.includes("Prueba") && htmlC.includes("2467.00"), "R2-16 la línea de retenidos nombra al trato y su comisión");
  ok(htmlC.includes("Total pendiente de pago: <b>100.00 CUP</b>"), "R2-17 el total mostrado excluye al retenido");
  w.close();
  R.reportes = [];
}

/* ===== 15. AMPLIACIÓN · VOZ PRO + TIMBRE + SELLO (puntos 4, 5, 6) ===== */
{
  R.chat = true;
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ];
  const mp4 = "AAAAIGZ0eXBpc29tAAACAGlzb21pc28y";           /* cabecera ftyp: MP4 real de iPhone */
  const webm = "GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibQ==";   /* EBML: WebM */
  R.chatMsgs = [
    { id: "vz1", de: "BUSC-1", para: "ADMIN", texto: "", creado: hace2min, leido: false, adj_tipo: "voz", adj_datos: mp4 },
    { id: "vz2", de: "ADMIN", para: "BUSC-1", texto: "", creado: hace2min, leido: false, adj_tipo: "voz", adj_datos: "data:audio/mp4;base64," + mp4 },
    { id: "vz3", de: "BUSC-1", para: "ADMIN", texto: "", creado: hace2min, leido: false, adj_tipo: "voz", adj_datos: webm }
  ];
  const preState15 = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: R.usuarios, datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ preState: preState15 });
  await sleep(300);
  const d = w.document;
  ok(w.mimeVozReal(mp4) === "audio/mp4", "R2-18 mime: base64 crudo con ftyp se resuelve MP4 (nunca webm forzado)");
  ok(w.mimeVozReal(webm) === "audio/webm", "R2-19 mime: base64 EBML se resuelve WebM");
  ok(w.mimeVozReal("data:audio/mp4;base64," + mp4) === "audio/mp4", "R2-20 mime: el dataURL guardado manda con su tipo real");
  ok(w.dataUrlVoz(mp4).indexOf("data:audio/mp4;base64,") === 0, "R2-21 la URL de reproducción de un MP4 crudo sale como audio/mp4");
  ok(w.dataUrlVoz(webm).indexOf("data:audio/webm;base64,") === 0, "R2-22 la URL de un WebM crudo sale como audio/webm");
  pestaña(w, "Equipo");
  await sleep(120);
  click(d.querySelector("[data-chat]"));
  await sleep(250);
  const chat = d.getElementById("pgChat");
  ok(!chat.innerHTML.includes("<audio"), "R2-23 ninguna burbuja usa <audio controls> pelado");
  const players = chat.querySelectorAll(".vozP");
  ok(players.length === 3, "R2-24 las 3 notas se pintan con el reproductor PRO (.vozP)");
  ok(chat.querySelectorAll("[data-vplay]").length === 3 && chat.querySelectorAll(".vozOnda i").length === 72, "R2-25 cada reproductor trae su ▶ circular y su onda de 24 picos");
  ok(typeof w.mejorMimeVoz === "function" && typeof w.hashParChat === "function" && typeof w.rtTimbre === "function", "R2-26 existen mejorMimeVoz, hashParChat y rtTimbre");
  ok(w.hashParChat("ADMIN", "BUSC-1") === w.hashParChat("BUSC-1", "ADMIN") && w.hashParChat("ADMIN", "BUSC-1") !== w.hashParChat("ADMIN", "BUSC-2"), "R2-27 el canal del timbre es el mismo para la pareja en ambos sentidos y distinto por pareja");
  ok(w.selloVersion() === "Mi Negocio · versión 2026-11-11 20:02 · caché v10", "R2-28 sello de versión exacto: «" + w.selloVersion() + "»");
  ok(chat.textContent.includes("cada 3 s"), "R2-29 la ayuda del chat dice el refresco nuevo de 3 s (ya no 15 s)");
  pestaña(w, "Inicio");
  await sleep(120);
  ok(d.getElementById("pgInicio").textContent.includes("Mi Negocio · versión 2026-11-11 20:02 · caché v10"), "R2-30 el sello de versión se ve en Inicio");
  w.close();
  R.chatMsgs = [];
}

/* ===== 16. LOCAL-FIRST FASE 1: BDL, outbox con UUID, marcas, Blob ===== */
{
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  ok(w.BDL && w.BDL.tipo === "memoria", "LF-1 sin IndexedDB (jsdom) la capa degrada al adaptador en memoria y la app sigue viva");
  const u1 = w.uuidOp(), u2 = w.uuidOp();
  ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(u1) && u1 !== u2, "LF-2 uuidOp genera UUID v4 distintos");
  const opN = w.nuevaOperacion("chat", { para: "BUSC-1", texto: "hola" });
  ok(!!opN.opId && opN.estado === "pendiente" && opN.intentos === 0 && opN.tipo === "chat" && opN.para === "BUSC-1", "LF-3 nuevaOperacion nace pendiente, con UUID, intentos 0 y su payload");
  const ad = w.crearAdapterMemoria();
  const o1 = w.nuevaOperacion("chat", { n: 1 }); o1.creada = "2026-11-11T10:00:00.000Z";
  const o2 = w.nuevaOperacion("chat", { n: 2 }); o2.creada = "2026-11-11T10:01:00.000Z";
  const o3 = w.nuevaOperacion("chat", { n: 3 }); o3.creada = "2026-11-11T10:02:00.000Z";
  await ad.pon("outbox", o2); await ad.pon("outbox", o3); await ad.pon("outbox", o1);
  const orden = [], estadosVistos = [];
  const resD = await w.drenarOps(ad, function(o){
    orden.push(o.n);
    return ad.trae("outbox", o.opId).then(function(g){ estadosVistos.push(g.estado); if (o.n === 2) throw new Error("puerta caída"); return true; });
  });
  ok(orden.join(",") === "1,2,3", "LF-4 drenarOps drena EN ORDEN de creación (" + orden.join(",") + ")");
  ok(estadosVistos.length === 3 && estadosVistos.every(e => e === "enviando"), "LF-5 durante la ejecución cada op está «enviando» en la base");
  const quedan = await ad.todos("outbox");
  ok(resD.confirmadas === 2 && resD.fallidas === 1 && quedan.length === 1 && quedan[0].n === 2 && quedan[0].estado === "pendiente" && quedan[0].intentos === 1, "LF-6 fallo → la op queda pendiente con intentos=1; las confirmadas salen de la outbox");
  const fus = w.fusionarColas(
    [ { opId: "a", creada: "2026-11-11T09:00:00Z" }, { opId: "b", creada: "2026-11-11T09:05:00Z" } ],
    [ { opId: "b", creada: "2026-11-11T09:05:00Z" }, { opId: "c", creada: "2026-11-11T09:03:00Z" } ]);
  ok(fus.length === 3 && fus.map(x => x.opId).join(",") === "a,c,b", "LF-7 fusionarColas: unión sin duplicar, ordenada por creación");
  const fusM = w.fusionarPorMarca(
    [ { id: 1, creado: "2026-11-10T10:00:00Z", actualizado_en: "2026-11-10T10:00:00Z", texto: "viejo" }, { id: 2, creado: "2026-11-10T11:00:00Z", actualizado_en: "2026-11-10T11:00:00Z" } ],
    [ { id: 1, creado: "2026-11-10T10:00:00Z", actualizado_en: "2026-11-11T09:00:00Z", texto: "nuevo" }, { id: 3, creado: "2026-11-11T08:00:00Z", actualizado_en: "2026-11-11T08:00:00Z" } ]);
  ok(fusM.length === 3 && fusM.filter(x => x.id === 1)[0].texto === "nuevo", "LF-8 fusionarPorMarca: sin duplicar ni perder; gana el sello mayor");
  const marca = w.marcaDesdeFilas([ { id: 5, actualizado_en: "2026-11-11T09:00:00Z" }, { id: 9, actualizado_en: "2026-11-11T09:00:00Z" }, { id: 7, actualizado_en: "2026-11-11T08:00:00Z" } ]);
  ok(marca && marca.sello === "2026-11-11T09:00:00Z" && marca.id === 9, "LF-9 marcaDesdeFilas: máximo por (sello, id) con desempate por id");
  const fotoPrueba = { reportes: [ { id: 7, adj_datos: "data:image/jpeg;base64,QUJD", codigo: "BUSC-1" }, { id: 8, codigo: "BUSC-1" } ], ayudas: [], usuarios: [], datos: null, cuando: "x", publicar: [], borrados: [], tarifaPanel: null, mercado: null, perfiles: {} };
  const ex = w.extraerAdjuntosDeFoto(fotoPrueba);
  ok(!ex.foto.reportes[0].adj_datos && ex.foto.reportes[0].adj_ref === "rep-7" && ex.adjuntos.length === 1 && ex.adjuntos[0].datos.includes("QUJD") && !!fotoPrueba.reportes[0].adj_datos, "LF-10 extraerAdjuntosDeFoto: el espejo queda sin base64 y con adj_ref; el original no se toca");
  const blobV = w.dataURLABlob("data:audio/mp4;base64,AAAAIGZ0eXBpc29t");
  const vueltaV = await w.blobADataURL(blobV);
  ok(blobV.type === "audio/mp4" && vueltaV === "data:audio/mp4;base64,AAAAIGZ0eXBpc29t", "LF-11 dataURL→Blob→dataURL conserva tipo y contenido exactos");
  w.encolar({ tipo: "ayudaVista", id: 123 });
  const colaAhora = w.state.cola.filter(a => a.tipo === "ayudaVista");
  ok(colaAhora.length === 1 && !!colaAhora[0].opId && colaAhora[0].estado === "pendiente" && colaAhora[0].intentos === 0, "LF-12 encolar() estampa opId/estado/intentos en la operación viva");
  w.state.cola = w.state.cola.filter(a => a.tipo !== "ayudaVista"); w.guardar();
  const gen = fs.readFileSync(REPO + "minegocio/index.html", "utf8");
  ok(gen.includes("createObjectStore") && gen.includes('"minegocio"') && gen.includes("visorFoto") && gen.includes("docCard"), "LF-13 el HTML generado trae la capa local-first (stores) y el kit de medios (visor + docCard)");
  w.close();
}

/* ===== 17. LOCAL-FIRST: espejo a la base + rescate de la outbox ===== */
{
  R.reportes = [ { id: 41, codigo: "BUSC-1", nombre: "Busc Uno", tipo: "saldo", cantidad: 10, precio: 1000, estado: "pendiente", creado: "2026-11-11" } ];
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(400);
  const filaFoto = await w.BDL.trae("config", "foto");
  ok(!!filaFoto && !!filaFoto.valor && Array.isArray(filaFoto.valor.reportes), "LF-14 el espejo guarda la foto en la base del teléfono (store config)");
  const reps = await w.BDL.todos("reportes");
  ok(reps.length >= 1 && String(reps[0].id) === "41", "LF-15 los reportes viven en su store de la base local");
  await w.BDL.pon("outbox", w.nuevaOperacion("pagado", { id: 999 }));
  await w.arrancarLocalFirst();
  ok(w.state.cola.some(a => a.tipo === "pagado" && a.id === 999), "LF-16 rescate: la operación que solo vivía en la base vuelve a la cola sin duplicar");
  w.close();
  R.reportes = [];
}

/* ===== 18. KIT DE MEDIOS: viaje completo foto/documento en el hilo ===== */
{
  R.chat = true;
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ];
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const fotoDU = "data:image/png;base64," + pngB64;
  R.chatMsgs = [
    { id: 61, de: "BUSC-1", para: "ADMIN", texto: "mira la foto", creado: hace2min, leido: false, adj_tipo: "foto", adj_datos: fotoDU, adj_nombre: "IMG_1184.png", adj_mime: "image/png" },
    { id: 62, de: "ADMIN", para: "BUSC-1", texto: "", creado: hace2min, leido: true, adj_tipo: "archivo", adj_datos: "data:application/pdf;base64,JVBERi0xLjQ=", adj_nombre: "cuenta.pdf", adj_mime: "application/pdf", adj_bytes: 12345 }
  ];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: R.usuarios, datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  pestaña(w, "Equipo");
  await sleep(120);
  click(d.querySelector("[data-chat]"));
  await sleep(250);
  const chat = d.getElementById("pgChat");
  const img = chat.querySelector("img.adjFoto");
  ok(!!img && img.getAttribute("src") === fotoDU, "KM-1 viaje: el mensaje tal como lo devuelve leer_chat pinta <img class=adjFoto> con el dataURL íntegro");
  const card = chat.querySelector(".docCard");
  ok(!!card && card.textContent.includes("cuenta.pdf") && card.textContent.includes("📄") && card.textContent.includes("12"), "KM-2 el documento pinta su tarjeta: icono PDF, nombre y tamaño");
  ok(!!chat.querySelector("[data-docdl]"), "KM-3 la tarjeta de documento trae botón de descarga");
  click(img);
  await sleep(150);
  const visor = d.getElementById("visorFoto");
  ok(!!visor && visor.classList.contains("abierto") && d.getElementById("visorImg").getAttribute("src") === fotoDU, "KM-4 tocar la foto abre el VISOR a pantalla completa con la imagen");
  ok(d.getElementById("visorDl").getAttribute("href") === fotoDU && d.getElementById("visorNom").textContent.includes("IMG_1184.png"), "KM-5 el visor trae botón Guardar (descarga) y el nombre del archivo");
  click(d.getElementById("visorX"));
  ok(!visor.classList.contains("abierto"), "KM-6 el visor se cierra con su botón");
  click(chat.querySelector("[data-docdl]"));
  await sleep(150);
  const dl = [...d.querySelectorAll("a[download]")].filter(a => a.getAttribute("download") === "cuenta.pdf")[0];
  ok(!!dl && String(dl.getAttribute("href")).indexOf("data:application/pdf") === 0, "KM-7 la descarga del documento crea el enlace «download» con su nombre y el dataURL del PDF");
  /* Previa REAL de foto: la miniatura, no el nombre */
  w.chatAdj = { tipo: "foto", datos: fotoDU, nombre: "IMG_1184.png", mime: "image/png" };
  w.pintarChat();
  await sleep(60);
  const prev = d.querySelector(".prevAdj");
  ok(!!prev && !!prev.querySelector("img.prevFoto") && prev.querySelector("img.prevFoto").getAttribute("src") === fotoDU, "KM-8 la previa de foto muestra la MINIATURA real de la imagen");
  ok(prev.textContent.includes("IMG_1184.png") && !!d.getElementById("chAdjX"), "KM-9 la previa trae nombre y botón Quitar");
  click(prev.querySelector("img.prevFoto"));
  await sleep(80);
  ok(d.getElementById("visorFoto").classList.contains("abierto"), "KM-10 tocar la miniatura de la previa también abre el visor");
  click(d.getElementById("visorX"));
  /* Previa de documento: su tarjeta */
  w.chatAdj = { tipo: "archivo", datos: "data:application/pdf;base64,JVBERi0xLjQ=", nombre: "cuenta.pdf", mime: "application/pdf", tam: 12345 };
  w.pintarChat();
  await sleep(60);
  const prevD = d.querySelector(".prevAdj");
  ok(!!prevD && prevD.textContent.includes("📄") && prevD.textContent.includes("cuenta.pdf") && !prevD.querySelector("img.prevFoto"), "KM-11 la previa de documento es su tarjeta (icono + nombre + tamaño), sin miniatura");
  w.chatAdj = null; w.pintarChat();
  w.close();
  R.chatMsgs = [];
}

/* ===== 19. ENVÍO DE MEDIOS: payload íntegro + adjRef convertido al subir ===== */
{
  R.chat = true;
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ];
  R.chatMsgs = [];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: R.usuarios, datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  pestaña(w, "Equipo");
  await sleep(120);
  click(d.querySelector("[data-chat]"));
  await sleep(200);
  const fotoDU2 = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
  w.chatAdj = { tipo: "foto", datos: fotoDU2, nombre: "IMG_1184.png", mime: "image/jpeg" };
  input(d.getElementById("chTexto"), "te mando la foto");
  click(d.getElementById("chEnviar"));
  await sleep(250);
  const cuerpo1 = ultimosCuerpos.enviar_mensaje || {};
  ok(cuerpo1.p_adj_tipo === "foto" && cuerpo1.p_adj_datos === fotoDU2, "KM-12 viaje completo: la puerta enviar_mensaje recibe adj_tipo «foto» y adj_datos ÍNTEGRO");
  const refId = await w.guardarAdjuntoBlob(w.dataURLABlob(fotoDU2));
  ok(typeof refId === "string" && refId.indexOf("adj-") === 0, "KM-13 guardarAdjuntoBlob guarda el Blob en la base y devuelve su referencia");
  w.encolar({ tipo: "chat", para: "BUSC-1", texto: "", cuando: new Date().toISOString(), adj: { tipo: "foto", nombre: "IMG_1184.png", mime: "image/jpeg", adjRef: refId } });
  const opCola = w.state.cola[w.state.cola.length - 1];
  ok(!!opCola.adj && !opCola.adj.datos && opCola.adj.adjRef === refId, "KM-14 la operación en cola lleva la REFERENCIA del Blob, sin base64 residente");
  await w.despacharCola();
  await sleep(120);
  const cuerpo2 = ultimosCuerpos.enviar_mensaje || {};
  ok(cuerpo2.p_adj_datos === fotoDU2, "KM-15 al subir, el Blob se convierte a dataURL y la puerta recibe el dato íntegro");
  w.close();
}

/* ===== 20. FASE 1 · CONTABILIDAD (prueba, panel, libro, por pagar) ===== */
{
  const cerca = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.01;
  const hoyISO = new Date().toISOString();
  R.chat = true; R.tarifaVivaOk = true;
  R.usuarios = [ { codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", activo: true }, { codigo: "ABRAHAM-5ZU", nombre: "ABRAHAM-5ZU", activo: true } ];
  R.reportes = [
    { id: "r1", codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", tipo: "saldo", cantidad: 100, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2467, comision_pagada_en: "2026-11-06T10:00:00.000Z", creado: "2026-11-05T10:00:00.000Z" },
    { id: "r2", codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", tipo: "transferencia", cantidad: 5000, precio: null, porc: 30, telefono: "5", nota: "", estado: "aprobado", comision: 154.88, comision_pagada_en: null, creado: "2026-11-10T10:00:00.000Z" },
    { id: "r3", codigo: "ABRAHAM-5ZU", nombre: "ABRAHAM-5ZU", tipo: "saldo", cantidad: 50, precio: 900, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2483.50, comision_pagada_en: null, creado: "2026-11-10T11:00:00.000Z" },
    { id: "r4", codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", tipo: "saldo", cantidad: 100, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2467, comision_pagada_en: null, prueba: true, creado: "2026-11-10T12:00:00.000Z" },
    { id: "r5", codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "pendiente", comision: null, comision_pagada_en: null, creado: "2026-11-10T13:00:00.000Z" },
    { id: "r6", codigo: "ABRAHAM-5ZU", nombre: "ABRAHAM-5ZU", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "rechazado", comision: null, comision_pagada_en: null, creado: "2026-11-10T14:00:00.000Z" },
    { id: "r7", codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 246.70, comision_pagada_en: null, creado: hoyISO }
  ];
  const preConta = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, calc: { saldo: { salida: 950, costo: 1040, tasa: 320, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 }, busc: { precio: 0, tasaVenta: 0, efectivo: 0, porc: 0, libro: 0, salida: 0 } }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ preState: preConta });
  await sleep(350);
  const d = w.document;
  ok(w.PUERTAS.marcarPrueba === "admin_marcar_prueba", "F1-1 la puerta nueva está registrada: PUERTAS.marcarPrueba = admin_marcar_prueba");
  ok(w.MN_VERSION === "v10", "F1-2 MN_VERSION subió a v10");
  /* Funciones puras con las fórmulas del servidor (tarifa del banco: 1098.68 / 1069.38 / 950) */
  ok(cerca(w.contaGananciaBruta({ tipo: "saldo", precio: 1000, cantidad: 100 }), 9868) && cerca(w.contaNeta({ tipo: "saldo", precio: 1000, cantidad: 100, comision: 2467 }), 7401), "F1-3 saldo r1: bruta 9868 · neta 7401 (comisión GUARDADA, no recalculada)");
  /* NOTA (desviación de la espec, verificada con la fórmula): la
     espec esperaba bruta 774.42 para r2, pero SU fórmula exacta
     (5000×1.30÷1069.38)×950−5000 = 774.3739… → 774.37. La fórmula
     del servidor manda; las constantes de abajo son las suyas. */
  ok(cerca(w.contaGananciaBruta({ tipo: "transferencia", cantidad: 5000, precio: null, porc: 30 }), 774.37) && cerca(w.contaNeta({ tipo: "transferencia", cantidad: 5000, precio: null, porc: 30, comision: 154.88 }), 619.49), "F1-4 transferencia r2 (forma real: efectivo en cantidad, precio null): bruta 774.37 · neta 619.49 (±0.01, fórmula exacta del servidor)");
  ok(cerca(w.contaNeta({ tipo: "saldo", precio: 900, cantidad: 50, comision: 2483.50 }), 7450.50) && cerca(w.contaNeta({ tipo: "saldo", precio: 1000, cantidad: 10, comision: 246.70 }), 740.10), "F1-5 netas de r3 (7450.50) y r7 (740.10)");
  ok(w.contaCapital({ tipo: "saldo", precio: 1000, cantidad: 100 }) === 100000 && w.contaCapital({ tipo: "transferencia", cantidad: 5000, precio: null }) === 5000, "F1-6 capital: saldo = precio × cantidad · transferencia = el efectivo (en cantidad, la forma real almacenada)");
  /* Bloque 1 · Panel */
  pestaña(w, "Contabilidad");
  await sleep(80);
  const pg = d.getElementById("pgContabilidad");
  const txtConta = pg.textContent;
  const celdas = [...pg.querySelectorAll(".cell .v")].map(e => e.textContent.trim());
  ok(celdas.includes("16211.09"), "F1-7 Panel: ganancia del mes = 16211.09 (7401 + 619.49 + 7450.50 + 740.10, con la bruta de fórmula 774.37) [" + celdas.join(" | ") + "]");
  ok(txtConta.includes("de 4 tratos aprobados"), "F1-8 Panel: la cifra trae su fuente «de 4 tratos aprobados» (la prueba r4 y los no aprobados r5/r6 no cuentan)");
  ok(celdas.includes("2885.08"), "F1-9 Panel: comisiones por pagar = 2885.08 (todas las fechas, solo sin pagar)");
  ok(celdas.includes("160000.00"), "F1-10 Panel: capital movido del mes = 160000");
  ok(celdas.includes("160"), "F1-11 Panel: recargas movidas del mes = 160");
  ok(txtConta.includes("8810.09") && txtConta.includes("7401.00") && txtConta.includes("▲"), "F1-12 comparativa: esta semana 8810.09 · la anterior 7401.00 · ▲");
  const mPct = txtConta.match(/([0-9]+\.[0-9]+)\s*%/);
  ok(!!mPct && Math.abs(Number(mPct[1]) - ((8810.09 - 7401) / 7401 * 100)) <= 0.2, "F1-13 comparativa: el % es el calculado desde las dos semanas (±0.2): " + (mPct && mPct[1]));
  /* Bloque 3 · Por pagar agrupado + historial */
  ok(txtConta.includes("401.58") && txtConta.includes("2483.50"), "F1-14 Por pagar agrupado: BRIKU-SEF 401.58 (2) · ABRAHAM-5ZU 2483.50 (1)");
  ok(txtConta.includes("Total por pagar") && txtConta.includes("2885.08") && txtConta.includes("(de 3 comisiones)"), "F1-15 Total por pagar: 2885.08 CUP (de 3 comisiones)");
  ok((txtConta.match(/pagada el/g) || []).length === 1 && txtConta.includes("pagada el 2026-11-06") && txtConta.includes("2467.00"), "F1-16 Historial de pagos: 1 entrada (r1, 2467, pagada el 2026-11-06)");
  /* Bloque 2 · Libro y sus filtros (solo de vista) */
  ok(txtConta.includes("4 tratos · Ganancia total:") && txtConta.includes("16211.09") && txtConta.includes("5352.08"), "F1-17 Libro (mes, por defecto): 4 tratos · ganancia total 16211.09 · comisiones 5352.08");
  const nAsientos = () => (d.getElementById("pgContabilidad").textContent.match(/Tu ganancia:/g) || []).length;
  ok(nAsientos() === 4, "F1-18 Libro mes: 4 asientos");
  click(pg.querySelector('[data-conta-periodo="hoy"]'));
  await sleep(40);
  ok(nAsientos() === 1 && d.getElementById("pgContabilidad").textContent.includes("1 tratos"), "F1-19 Libro filtro Hoy → 1 asiento (r7, el de hoy)");
  click(d.querySelector('[data-conta-periodo="todo"]'));
  await sleep(40);
  click(d.querySelector('[data-conta-buscador="BRIKU-SEF"]'));
  await sleep(40);
  ok(nAsientos() === 3, "F1-20 Libro filtro buscador BRIKU-SEF (periodo Todo) → 3 asientos (r1, r2, r7)");
  click(d.querySelector('[data-conta-buscador=""]'));
  await sleep(40);
  click(d.querySelector('[data-conta-tipo="transferencia"]'));
  await sleep(40);
  ok(nAsientos() === 1, "F1-21 Libro filtro tipo Transferencia → 1 asiento (r2)");
  click(d.querySelector('[data-conta-tipo=""]'));
  await sleep(40);
  /* Bandeja: la prueba no está; badge sin pruebas; PAGADO solo del servidor */
  pestaña(w, "Bandeja");
  await sleep(80);
  const idsBan = [...d.querySelectorAll("#pgBandeja [data-rep]")].map(e => e.getAttribute("data-rep"));
  ok(!idsBan.includes("r4") && idsBan.length === 6, "F1-22 Bandeja: la tarjeta de la prueba r4 NO está en el DOM (sí las otras 6) [" + idsBan.join(",") + "]");
  ok(d.getElementById("pgBandeja").textContent.includes("1 reportes marcados como prueba (ocultos de la Bandeja y de las cuentas)"), "F1-23 Bandeja: línea discreta de conteo de pruebas ocultas");
  const tabBan = [...d.querySelectorAll(".tab")].find(t => t.textContent.includes("Bandeja"));
  const badgeBan = tabBan && tabBan.querySelector(".badge");
  ok(!!badgeBan && badgeBan.textContent.trim() === "1", "F1-24 badge de pendientes = 1 (solo r5; las pruebas no cuentan)");
  const cardDe = id => d.querySelector('[data-rep="' + id + '"]');
  ok(cardDe("r1").textContent.includes("PAGADO") && cardDe("r1").textContent.includes("Comisión pagada el"), "F1-25 PAGADO: r1 (pagada_en del servidor) SÍ pinta PAGADO y «Comisión pagada el…»");
  ok(!cardDe("r2").textContent.includes("PAGADO") && !cardDe("r3").textContent.includes("PAGADO") && !cardDe("r7").textContent.includes("PAGADO"), "F1-26 PAGADO: r2/r3/r7 (aprobados SIN comision_pagada_en) NO pintan PAGADO — y el bloque Por pagar ya los contó como pendientes (F1-9/F1-15)");
  /* Marcar como prueba desde la hoja */
  click(d.querySelector('[data-repdot="r3"]'));
  await sleep(60);
  const btnPrueba = [...d.querySelectorAll("#hojaBtns button")].find(b => b.textContent.includes("Marcar como prueba"));
  ok(!!btnPrueba, "F1-27 la hoja del reporte trae el botón «🧪 Marcar como prueba»");
  click(btnPrueba);
  ok(!d.querySelector('[data-rep="r3"]'), "F1-28 tras marcar, el reporte desaparece de la Bandeja al repintar");
  ok(d.getElementById("toast").textContent.includes("Marcado como prueba"), "F1-29 toast de marca de prueba");
  await sleep(300);
  ok(llamadas.includes("rpc:admin_marcar_prueba") && ultimosCuerpos.admin_marcar_prueba.p_id === "r3" && ultimosCuerpos.admin_marcar_prueba.p_prueba === true, "F1-30 la marca salió por la cola a admin_marcar_prueba con p_id r3 y p_prueba true");
  w.close();
}
/* Punto 5 de la espec (PAGADO): una «decisión» local vieja de pago
   que vive SOLO como operación en cola (sin confirmación del
   servidor en la foto) NO pinta PAGADO tras refrescar: la tarjeta
   pinta SOLO desde el comision_pagada_en que trae el servidor, y
   Contabilidad lo sigue contando como pendiente. */
{
  R.noPersistePago = true; // mundo fantasma: el servidor responde ok pero NUNCA guarda el sello
  R.usuarios = [ { codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", activo: true } ];
  R.reportes = [ { id: "rp", codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 246.70, comision_pagada_en: null, creado: new Date().toISOString() } ];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [ { tipo: "pagado", id: "rp", cuando: new Date().toISOString() } ], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(400);
  const d = w.document;
  pestaña(w, "Bandeja");
  await sleep(80);
  const card = d.querySelector('[data-rep="rp"]');
  ok(!!card && !card.textContent.includes("PAGADO"), "F1-31 PUNTO 5: decisión local vieja de pago (solo en cola, sin confirmación) → tras refrescar la tarjeta NO dice PAGADO");
  pestaña(w, "Contabilidad");
  await sleep(80);
  ok(d.getElementById("pgContabilidad").textContent.includes("Total por pagar") && d.getElementById("pgContabilidad").textContent.includes("246.70"), "F1-32 PUNTO 5: ese mismo trato se cuenta como PENDIENTE en «Por pagar» (246.70)");
  w.close();
  /* FUENTE ÚNICA DEL SELLO PAGADO (arreglo Fase 1, 2026-11-11):
     si la «decisión» local vieja vive en la FOTO como
     comision_pagada_en (así la guarda marcarPagado) pero la acción
     «pagado» YA NO está en la cola (salió del teléfono hace rato)
     y el servidor devuelve el aprobado SIN el sello, manda el
     servidor: la tarjeta NO dice PAGADO y la Contabilidad lo
     cuenta como pendiente. Es el caso real de la fila de prueba
     que se veía «PAGADO 08:53» con la base en NULL. */
  R.reportes = [ { id: "rp", codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 246.70, comision_pagada_en: null, creado: new Date().toISOString() } ];
  const fotoVieja = { reportes: [ { id: "rp", codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", tipo: "saldo", cantidad: 10, precio: 1000, estado: "aprobado", comision: 246.70, comision_pagada_en: "2026-11-10T12:00:00.000Z", creado: "2026-11-10" } ],
    ayudas: [], usuarios: R.usuarios, datos: datosPublicados, cuando: "2026-11-11 01:00", publicar: [], borrados: [], tarifaPanel: null, mercado: null };
  const seg = crear({ preState: { codigo: adminValido, foto: fotoVieja, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(400);
  const d2 = seg.w.document;
  pestaña(seg.w, "Bandeja");
  await sleep(80);
  const card2 = d2.querySelector('[data-rep="rp"]');
  ok(!!card2 && !card2.textContent.includes("PAGADO"), "F1-33 FUENTE ÚNICA: sello viejo en la FOTO sin respaldo en cola ni en el servidor → tras refrescar la tarjeta NO dice PAGADO");
  pestaña(seg.w, "Contabilidad");
  await sleep(80);
  ok(d2.getElementById("pgContabilidad").textContent.includes("Total por pagar") && d2.getElementById("pgContabilidad").textContent.includes("246.70"), "F1-33b FUENTE ÚNICA: ese trato vuelve a contar como PENDIENTE en «Por pagar» (246.70)");
  seg.w.close();
  /* Ventana optimista preservada: el MISMO sello de foto, pero con
     la acción «pagado» TODAVÍA en la cola sin despachar (Ernesto
     acaba de tocar «Ya pagué» sin conexión), SÍ sostiene el PAGADO
     hasta que el servidor confirme. Mundo sano otra vez: al
     despacharse, el sello persiste en la base del mock. */
  R.noPersistePago = false;
  const ter = crear({ preState: { codigo: adminValido, foto: fotoVieja, cola: [ { tipo: "pagado", id: "rp", cuando: new Date().toISOString() } ], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(400);
  const d3 = ter.w.document;
  pestaña(ter.w, "Bandeja");
  await sleep(80);
  const card3 = d3.querySelector('[data-rep="rp"]');
  ok(!!card3 && card3.textContent.includes("PAGADO"), "F1-34 VENTANA OPTIMISTA: sello en foto CON la acción «pagado» aún en cola → la tarjeta SÍ dice PAGADO mientras el servidor confirma");
  ter.w.close();
  R.reportes = [];
}

/* ===== 21. REDISEÑO PRO v7 ===== */
{
  const hoyISO21 = new Date().toISOString();
  R.chat = true; R.tarifaVivaOk = true; R.noPersistePago = false;
  R.usuarios = [ { codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", activo: true }, { codigo: "ABRAHAM-5ZU", nombre: "ABRAHAM-5ZU", activo: true } ];
  const fixture21 = () => [
    { id: "r1", codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", tipo: "saldo", cantidad: 100, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2467, comision_pagada_en: "2026-11-06T10:00:00.000Z", creado: "2026-11-05T10:00:00.000Z" },
    { id: "r2", codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", tipo: "transferencia", cantidad: 5000, precio: null, porc: 30, telefono: "5", nota: "", estado: "aprobado", comision: 154.88, comision_pagada_en: null, creado: "2026-11-10T10:00:00.000Z" },
    { id: "r3", codigo: "ABRAHAM-5ZU", nombre: "ABRAHAM-5ZU", tipo: "saldo", cantidad: 50, precio: 900, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2483.50, comision_pagada_en: null, creado: "2026-11-10T11:00:00.000Z" },
    { id: "r4", codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", tipo: "saldo", cantidad: 100, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2467, comision_pagada_en: null, prueba: true, creado: "2026-11-10T12:00:00.000Z" },
    { id: "r5", codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "pendiente", comision: null, comision_pagada_en: null, creado: "2026-11-10T13:00:00.000Z" },
    { id: "r6", codigo: "ABRAHAM-5ZU", nombre: "ABRAHAM-5ZU", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "rechazado", comision: null, comision_pagada_en: null, creado: "2026-11-10T14:00:00.000Z" },
    { id: "r7", codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 246.70, comision_pagada_en: null, creado: hoyISO21 }
  ];
  const preConta21 = () => ({ codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, calc: { saldo: { salida: 950, costo: 1040, tasa: 320, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 }, busc: { precio: 0, tasaVenta: 0, efectivo: 0, porc: 0, libro: 0, salida: 0 } }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null });
  R.reportes = fixture21();
  const { w } = crear({ preState: preConta21() });
  await sleep(350);
  const d = w.document;
  pestaña(w, "Contabilidad");
  await sleep(80);
  const pg = d.getElementById("pgContabilidad");
  const celdas21 = [...pg.querySelectorAll(".cell .v")].map(e => e.textContent.trim());
  const heroe21 = pg.querySelector(".cell.heroe .v");
  ok(celdas21.length === 4 && !!heroe21 && heroe21.textContent.trim() === "16211.09", "F2-1 Panel PRO: 4 celdas .cell .v y la héroe dice 16211.09 [" + celdas21.join(" | ") + "]");
  const titulos21 = [...pg.querySelectorAll("h3")].map(e => e.textContent).join(" ");
  ok(!titulos21.includes("📊") && !titulos21.includes("📒") && !titulos21.includes("💸"), "F2-2 los títulos de Contabilidad no contienen 📊 ni 📒 ni 💸");
  ok(!d.getElementById("contaBusc") && !!pg.querySelector('[data-conta-buscador="BRIKU-SEF"]') && !!pg.querySelector('[data-conta-buscador="ABRAHAM-5ZU"]'), "F2-3 fuera el select #contaBusc: el buscador va en chips (BRIKU-SEF y ABRAHAM-5ZU)");
  ok(pg.querySelectorAll(".contaBar").length === 7, "F2-4 hay 7 barras .contaBar (una por día de la semana)");
  const chipOk21 = pg.querySelector(".contaChipT.ok");
  ok(!!chipOk21 && chipOk21.textContent.includes("▲"), "F2-5 chip de tendencia al alza: .contaChipT.ok con ▲");
  const infos21 = [...pg.querySelectorAll(".contaInfo")];
  const btnInfo21 = pg.querySelector("[data-conta-info]");
  const info21 = btnInfo21.parentElement.querySelector(".contaInfo");
  const nacenHidden21 = infos21.length === 3 && infos21.every(e => e.hidden);
  click(btnInfo21);
  await sleep(40);
  const abierto21 = !info21.hidden && btnInfo21.getAttribute("aria-expanded") === "true";
  click(btnInfo21);
  await sleep(40);
  const cerrado21 = info21.hidden && btnInfo21.getAttribute("aria-expanded") === "false";
  ok(nacenHidden21 && abierto21 && cerrado21, "F2-6 desplegable «¿Cómo se calcula?»: nace hidden, el click abre (aria-expanded=true) y el segundo click cierra");
  w.close();
  /* F2-7 · CERO DATOS: el panel muestra su forma final vacío */
  R.reportes = [];
  const cero21 = crear({ preState: preConta21() });
  await sleep(350);
  pestaña(cero21.w, "Contabilidad");
  await sleep(80);
  const pgCero21 = cero21.w.document.getElementById("pgContabilidad");
  const celdasCero21 = [...pgCero21.querySelectorAll(".cell .v")].map(e => e.textContent.trim());
  ok(celdasCero21.join("|") === "0.00|0.00|0.00|0" && pgCero21.textContent.includes("Sin datos aún"), "F2-7 cero datos: las 4 celdas dicen 0.00|0.00|0.00|0 y el texto incluye «Sin datos aún» [" + celdasCero21.join(" | ") + "]");
  cero21.w.close();
  /* F2-8 · SEMANA A LA BAJA: un solo trato de la semana pasada */
  R.reportes = [ { id: "r1", codigo: "BRIKU-SEF", nombre: "BRIKU-SEF", tipo: "saldo", cantidad: 100, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2467, comision_pagada_en: "2026-11-06T10:00:00.000Z", creado: "2026-11-05T10:00:00.000Z" } ];
  const baja21 = crear({ preState: preConta21() });
  await sleep(350);
  pestaña(baja21.w, "Contabilidad");
  await sleep(80);
  const chipNo21 = baja21.w.document.querySelector("#pgContabilidad .contaChipT.no");
  ok(!!chipNo21 && chipNo21.textContent.includes("▼"), "F2-8 semana a la baja: el chip .contaChipT.no contiene ▼");
  baja21.w.close();
  R.reportes = [];
}

/* ===== 22. REDISEÑO PRO v8 (toda la app) ===== */
{
  const { w } = crear({ sinRed: true, preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(250);
  const d = w.document;
  const tabs22 = [...d.querySelectorAll(".tab")];
  ok(tabs22.length === 10 && tabs22.every(t => !!t.querySelector("svg")), "F3-1 las 10 pestañas llevan icono SVG de trazo fino (cero emojis estructurales en la navegación)");
  ok(!!d.getElementById("pgCierre") && !!d.getElementById("pgActividad") && !!d.getElementById("pgTextos"), "F3-2 existen #pgCierre, #pgActividad y #pgTextos (en la v7 faltaban en el HTML y esas pestañas abrían en blanco)");
  pestaña(w, "Calculadora");
  await sleep(80);
  const pgC = d.getElementById("pgCalc");
  const outS = d.getElementById("c_out_s"), inpS = d.getElementById("c_s_salida");
  ok(!!outS && !!inpS && !!(outS.compareDocumentPosition(inpS) & 4), "F3-3 el resultado de Saldo va ARRIBA de su primer campo (el resultado manda, sin bajar entre campos)");
  const infosC = [...pgC.querySelectorAll(".calcInfo")];
  const btnInfoC = pgC.querySelector("[data-calc-info]");
  const infoDe = (btn) => { const p = btn.parentElement; return p.querySelector(".calcInfo") || (p.parentElement && p.parentElement.nextElementSibling && p.parentElement.nextElementSibling.classList.contains("calcInfo") ? p.parentElement.nextElementSibling : null); };
  const nacenC = infosC.length >= 3 && infosC.every(e => e.hidden);
  const infoC = btnInfoC ? infoDe(btnInfoC) : null;
  click(btnInfoC);
  await sleep(30);
  const abiertoC = !!infoC && !infoC.hidden && btnInfoC.getAttribute("aria-expanded") === "true";
  click(btnInfoC);
  await sleep(30);
  const cerradoC = !!infoC && infoC.hidden && btnInfoC.getAttribute("aria-expanded") === "false";
  ok(nacenC && abiertoC && cerradoC, "F3-4 los «ⓘ ¿Cómo se calcula?» de la calculadora nacen cerrados y abren/cierran con su botón (aria-expanded)");
  const titulosC = [...pgC.querySelectorAll("h3")].map(e => e.textContent).join(" ");
  ok([...pgC.querySelectorAll("h3")].length === 3 && !titulosC.includes("📱") && !titulosC.includes("🏦") && !titulosC.includes("🤝"), "F3-5 las 3 secciones de la calculadora con títulos sin emojis");
  ok(pgC.querySelectorAll(".chips.unaFila").length >= 3, "F3-6 los presets van en filas de chips de UNA sola fila deslizable (.chips.unaFila)");
  pestaña(w, "Textos");
  await sleep(80);
  const selsTx = ["txEmojis", "txTono", "txTam", "txDest", "txpMoneda"].map(id => d.getElementById(id));
  ok(selsTx.every(s => !!s && s.classList.contains("selOculto")) && d.querySelectorAll(".chipsSel").length === 5, "F3-7 Textos v10: quedan SOLO los selects de Estilo y la moneda del producto (5), ocultos tras sus chips — el formulario de oferta viejo (txTipo/txMoneda/txProd…) se amputó");
  const chipCom = d.querySelector('.chipsSel[data-sel="txTono"] .chip[data-v="comercial"]');
  click(chipCom);
  await sleep(30);
  ok(d.getElementById("txTono").value === "comercial" && chipCom.classList.contains("activa"), "F3-8 tocar el chip «Comercial vendedor» fija txTono.value = comercial y marca el chip activo");
  pestaña(w, "Inicio");
  await sleep(80);
  ok(d.getElementById("pgInicio").querySelectorAll("h3 .secIco svg").length >= 3, "F3-9 Inicio en rejilla PRO: las tarjetas llevan su icono de trazo fino (.secIco)");
  w.close();
}

/* ===== 23. v9 — BOTÓN «📤 ENVIAR SU ENLACE» EN EQUIPO =====
   El panel compone el WhatsApp del buscador con el apkUrl LEÍDO EN
   VIVO de datos.json (el stub sirve «https://example.invalid/apk»:
   si el mensaje lo trae, salió de la lectura viva y no de una
   constante), su código y su enlace personal ?codigo=. Con teléfono
   en el perfil, wa.me va a su número (+53); sin teléfono, compartir
   genérico. */
{
  R.usuarios = [
    { codigo: "BRIKU-SEF", nombre: "Briku", activo: true },
    { codigo: "ABRAHAM-5ZU", nombre: "Abraham", activo: true }
  ];
  R.chatMsgs = [];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: R.usuarios, datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null, perfiles: { "BRIKU-SEF": { nombre: "Briku", telefono: "51234567" } } }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  pestaña(w, "Equipo");
  await sleep(150);
  const btns = [...d.querySelectorAll("[data-enviar]")];
  ok(btns.length === 2 && btns.every(b => b.textContent.includes("Enviar su enlace")), "E9-1 cada tarjeta de buscador lleva su botón «📤 Enviar su enlace»");
  const abiertas = [];
  w.open = function(u){ abiertas.push(String(u)); };
  click(d.querySelector('[data-enviar="BRIKU-SEF"]'));
  await sleep(400);
  ok(abiertas.length === 1 && abiertas[0].indexOf("https://wa.me/5351234567?text=") === 0, "E9-2 con teléfono en el perfil, WhatsApp va dirigido a su número (+53 + 8 dígitos)");
  const txtB = abiertas.length ? decodeURIComponent(abiertas[0].split("?text=")[1] || "") : "";
  ok(txtB.includes("https://example.invalid/apk"), "E9-3 el mensaje trae el apkUrl LEÍDO EN VIVO de datos.json (el del stub), no una constante");
  ok(txtB.includes("BRIKU-SEF"), "E9-4 el mensaje trae el código personal de ESE buscador");
  ok(txtB.includes("https://ernesto5058.github.io/calculadora-ernesto/buscadores/?codigo=BRIKU-SEF"), "E9-5 el mensaje trae su enlace personal ?codigo= (el que rebota a la app)");
  click(d.querySelector('[data-enviar="ABRAHAM-5ZU"]'));
  await sleep(400);
  ok(abiertas.length === 2 && abiertas[1].indexOf("https://wa.me?text=") === 0, "E9-6 sin teléfono en el perfil, se abre el compartir genérico de WhatsApp");
  const txtA = abiertas.length > 1 ? decodeURIComponent(abiertas[1].split("?text=")[1] || "") : "";
  ok(txtA.includes("ABRAHAM-5ZU") && !txtA.includes("BRIKU-SEF"), "E9-7 el mensaje de Abraham trae SU código y no el de Briku");
  const mp = w.mensajeEnlaceBuscador({ codigo: "X-1", nombre: "Prueba" }, "https://ejemplo.invalid/otra.apk");
  ok(mp.includes("https://ejemplo.invalid/otra.apk") && mp.includes("X-1") && !mp.includes("example.invalid/apk"), "E9-8 la composición es pura: usa el apkUrl que se le pase en el momento (nada fijo en código)");
  w.close();
}

/* ===== 24. v9 — LA CALCULADORA ALIMENTA LA TARIFA DEL SISTEMA =====
   Al cambiar la salida/costo de la sección Saldo, la app sincroniza
   SOLA: salida → admin_guardar_tarifa (la puerta de la pestaña
   Tarifa, con el resto de la fila intacto) y costo →
   mercado_fijar_costo. El «✓ guardado» SOLO se pinta tras la
   confirmación del servidor: con la puerta del costo retenida
   (costoGate), el estado sigue «pendiente» aunque la salida ya
   salió. Sin conexión, la acción queda en la cola y se aplica al
   volver la red. */
{
  R.usuarios = []; R.chatMsgs = []; R.costoGate = null; R.costoOk = true; R.guardarOk = true;
  const calc0 = { saldo: { salida: 950, costo: 1040, tasa: 320, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 }, busc: { precio: 950, tasaVenta: 313, efectivo: 5000, porc: 30, libro: 1110, salida: 950 } };
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null, perfiles: {} }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null, calc: calc0, calcSync: null } });
  await sleep(300);
  const d = w.document;
  pestaña(w, "Calculadora");
  await sleep(150);
  const estEl = d.getElementById("calcSyncEstado");
  ok(!!estEl && d.getElementById("pgCalc").textContent.includes("alimentan la tarifa del sistema"), "S9-1 la Calculadora lleva la nota honesta y su línea de estado de sincronización");
  let resolverCosto = null;
  R.costoGate = { promise: new Promise(function(res){ resolverCosto = function(){ res({ ok: true, status: 200, text: () => Promise.resolve('{"ok":true}'), json: () => Promise.resolve({ ok: true }) }); }; }) };
  input(d.getElementById("c_s_salida"), "925");
  input(d.getElementById("c_s_costo"), "1000");
  ok(w.state.calcSync && w.state.calcSync.estado === "pendiente" && !estEl.textContent.includes("✓ guardado"), "S9-2 al teclear, el estado nace «pendiente»: ningún sello antes de que el servidor confirme");
  await sleep(1100);
  ok(llamadas.includes("rpc:admin_guardar_tarifa") && ultimosCuerpos.admin_guardar_tarifa.p_salida === 925, "S9-3 la salida nueva (925) salió por admin_guardar_tarifa, la puerta de la tarifa");
  const tEsp = w.tarifa();
  ok(ultimosCuerpos.admin_guardar_tarifa.p_ingreso === tEsp.ingresoRef360 && ultimosCuerpos.admin_guardar_tarifa.p_libro === tEsp.libroRef && ultimosCuerpos.admin_guardar_tarifa.p_com_saldo === tEsp.pctSaldo && ultimosCuerpos.admin_guardar_tarifa.p_piso === tEsp.pisoTransf, "S9-4 el resto de la fila viaja como la tarifa vigente de la app (tarifa(): ingreso " + tEsp.ingresoRef360 + " · libro " + tEsp.libroRef + "): solo cambia la salida");
  ok(llamadas.includes("rpc:mercado_fijar_costo") && ultimosCuerpos.mercado_fijar_costo.p_costo === 1000, "S9-5 el costo nuevo (1000) salió por mercado_fijar_costo hacia mercado_config");
  ok(!estEl.textContent.includes("✓ guardado") && w.state.calcSync.estado === "pendiente", "S9-6 con la puerta del costo sin confirmar, NO hay sello fantasma: sigue «pendiente»");
  resolverCosto(); R.costoGate = null;
  await sleep(500);
  ok(estEl.textContent.includes("✓ guardado en la tarifa"), "S9-7 confirmadas ambas puertas, ahora sí se pinta «✓ guardado en la tarifa»");
  ok(w.state.calcSync.estado === "guardado" && w.state.calcSync.salida === 925 && w.state.calcSync.costo === 1000 && !!w.state.calcSync.cuando, "S9-8 el estado guardado registra salida, costo y hora de la confirmación");
  ok(!w.state.cola.some(a => a.tipo === "calcTarifa"), "S9-9 la acción sale de la cola al confirmarse");
  w.online = false;
  const antesLlamadas = llamadas.filter(x => x === "rpc:admin_guardar_tarifa").length;
  input(d.getElementById("c_s_salida"), "930");
  await sleep(1100);
  ok(estEl.textContent.includes("pendiente de conexión"), "S9-10 sin conexión, la línea dice «pendiente de conexión»");
  ok(w.state.cola.some(a => a.tipo === "calcTarifa" && a.salida === 930 && a.estado === "pendiente"), "S9-11 sin conexión, la sincronización queda en la cola con el valor nuevo");
  ok(llamadas.filter(x => x === "rpc:admin_guardar_tarifa").length === antesLlamadas, "S9-12 sin conexión no sale ninguna llamada de tarifa");
  w.online = true;
  await w.despacharCola();
  await sleep(300);
  ok(ultimosCuerpos.admin_guardar_tarifa.p_salida === 930 && w.state.calcSync.estado === "guardado" && w.state.calcSync.salida === 930, "S9-13 al volver la red, la cola aplica la salida pendiente (930) y el estado pasa a «guardado»");
  w.close();
}

/* ===== 25. v10 — TANDA 3 ERRORES DE ERNESTO (2026-11-11) =====
   (1) Textos: UNA vía inteligente (el formulario viejo amputado
   también aquí — en Mi Trabajo cayó por la mañana y aquí seguía);
   (2) Actividad traducida a su lenguaje, sin UUID de frente;
   (3) el chat: la nota de voz ya no depende del Blob de IndexedDB
   para enviarse ni para oírse, la duración sale del temporizador
   y el fallo se ve (⚠) con reintento, no un 🕐 eterno mudo. */
{
  R.usuarios = [ { codigo: "BRIKU-SEF", nombre: "Briku", activo: true }, { codigo: "PEUEBA", nombre: "Prueba", activo: true } ];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: R.usuarios, datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  pestaña(w, "Textos");
  await sleep(80);
  ok(!!d.getElementById("txSaldo") && !!d.getElementById("txTransf") && !!d.getElementById("txProdBtn"), "TX-1 Textos v10: los TRES botones inteligentes (saldo · transferencia · producto) y ningún otro camino");
  ok(["txGen", "txProd", "txPrecio", "txMoneda", "txTipo", "txCant", "txDet", "txCond", "txPrivado"].every(id => !d.getElementById(id)), "TX-2 el formulario manual viejo NO existe (sin txGen/txProd/txPrecio/txMoneda/txTipo/txCant/txDet/txCond/txPrivado)");
  ok(d.getElementById("txTel").value === "51231558" && d.getElementById("txZona").value.includes("Micro 10"), "TX-3 «Tus datos de anuncio» nacen con SU teléfono (51231558) y SU zona: los botones ya no leen de un formulario");
  click(d.getElementById("txSaldo"));
  await sleep(60);
  const outSaldo = d.getElementById("txOut").textContent;
  ok(outSaldo.includes("51231558") && !/comisi/i.test(outSaldo), "TX-4 el texto de saldo sale con su teléfono y sin ningún número interno");
  click(d.getElementById("txProdBtn"));
  await sleep(30);
  ok(d.getElementById("txProdForm").style.display !== "none", "TX-5 «Texto de producto» abre SOLO los datos mínimos del producto");
  input(d.getElementById("txpNombre"), "Batería LiFePO4 12.8V 100Ah");
  input(d.getElementById("txpGarantia"), "6 meses");
  click(d.getElementById("txpGen"));
  await sleep(60);
  const outProd = d.getElementById("txOut").textContent;
  ok(outProd.includes("SE VENDE BATERÍA LIFEPO4") && outProd.includes("Precio por privado") && outProd.includes("📍 Micro 10, distrito José Martí, Santiago de Cuba") && outProd.includes("51231558"), "TX-6 el texto de producto ES su plantilla de Facebook (gancho · baterías por privado · 📍 su zona · su teléfono)");
  ok(typeof w.TextosMotor.textoRapidoProducto === "function", "TX-7 el motor compartido trae textoRapidoProducto: la plantilla vive en el motor (una sola fuente para las dos apps)");
  input(d.getElementById("txpPrecio"), "250");
  click(d.querySelector('.chipsSel[data-sel="txpMoneda"] .chip[data-v="USD"]'));
  click(d.getElementById("txpGen"));
  await sleep(60);
  ok(d.getElementById("txOut").textContent.includes("250 USD"), "TX-8 con precio y moneda, el texto de producto lleva «250 USD» (en SU app sus monedas se quedan)");
  w.close();
}
{
  const ahoraA = new Date().toISOString();
  R.actividad = [
    { accion: "pagar_comision", quien: "ADMIN", creado_en: ahoraA, detalle: { reporte: "83dd3d64-9c59-4720-8220-733ee0ccfd63", buscador: "PEUEBA", comision: 2467 } },
    { accion: "cambiar_tarifa", quien: "ADMIN", creado_en: ahoraA, detalle: { libro: 1069.38, salida: 925, ingreso: 1098.68 } },
    { accion: "pagar_comision_telegram", quien: "ADMIN", creado_en: ahoraA, detalle: { reporte: "c98e57dc-69f9-400a-a7fc-b5425469d3e2", buscador: "BRIKU-SEF", comision: 246.7, ya_pagado: true } },
    { accion: "telegram_vinculo_fallido", quien: "telegram", creado_en: ahoraA, detalle: { via: "token" } },
    { accion: "generar_cierre", quien: "ADMIN", creado_en: ahoraA, detalle: { semana_inicio: "2026-11-09" } },
    { accion: "evento_que_no_existe", quien: "ADMIN", creado_en: ahoraA, detalle: { x: 1 } }
  ];
  R.usuarios = [ { codigo: "BRIKU-SEF", nombre: "Briku", activo: true }, { codigo: "PEUEBA", nombre: "Prueba", activo: true } ];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: R.usuarios, datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  pestaña(w, "Actividad");
  await sleep(150);
  const pgA = d.getElementById("pgActividad");
  const filasA = [...pgA.querySelectorAll(".actFila")];
  ok(filasA.length === 6, "AC-1 la Actividad pinta las 6 filas del registro");
  ok(filasA[0].querySelector("b").textContent.includes("Marcaste como PAGADA la comisión de la cuenta de prueba") && filasA[0].querySelector("b").textContent.includes("2467.00 CUP"), "AC-2 pagar_comision se lee en claro: quién (la cuenta de prueba, no «PEUEBA») y cuánto (2467.00 CUP)");
  ok(!filasA.some(f => f.querySelector("b").textContent.includes("83dd3d64")), "AC-3 ningún UUID se ve en la vista normal (los títulos son frases, no códigos)");
  const det0 = d.getElementById("acDet0");
  ok(!!det0 && det0.style.display === "none" && det0.textContent.includes("83dd3d64"), "AC-4 el detalle técnico existe pero nace PLEGADO tras «ver detalle»");
  click(pgA.querySelector("[data-acdet]"));
  await sleep(30);
  ok(det0.style.display === "block", "AC-5 «ver detalle» despliega el JSON crudo solo cuando Ernesto lo pide");
  ok(filasA[1].textContent.includes("salida (efectivo) a 925.00 CUP por QUSD") && filasA[1].textContent.includes("libro (transferencia) a 1069.38 CUP por QUSD"), "AC-6 cambiar_tarifa se lee con dimensiones escritas (efectivo ≠ transferencia, cada cifra con su unidad)");
  ok(filasA[2].textContent.includes("Briku") && filasA[2].textContent.includes("no se pagó dos veces"), "AC-7 el pago repetido desde Telegram se cuenta como lo que es: YA estaba pagado, no se cobró de nuevo (y «BRIKU-SEF» se lee «Briku»)");
  ok(filasA[3].textContent.includes("FALLÓ") && filasA[4].textContent.includes("Generaste el cierre de la semana") && filasA[5].textContent.includes("Evento del sistema"), "AC-8 vínculo fallido, cierre y hasta un tipo desconocido tienen su frase (respaldo humanizado, nunca código crudo)");
  const CATALOGO = ["cambiar_tarifa", "generar_cierre", "pagar_comision", "pagar_comision_telegram", "publicar_tratos", "aprobar_telegram", "rechazar_telegram", "fijar_mensaje", "desfijar_mensaje", "bloquear", "desbloquear", "marcar_prueba", "desmarcar_prueba", "vincular_telegram", "telegram_vinculo_fallido", "analista_accion"];
  const detGen = { libro: 1, salida: 2, ingreso: 3, semana_inicio: "2026-11-09", reporte: "x", buscador: "BRIKU-SEF", comision: 5, ya_pagado: false, usuarios: 2, conversacion: "BRIKU-SEF", usuario: "BRIKU-SEF", via: "token", ok: true };
  ok(CATALOGO.every(t => { const f = w.actividadFrase({ accion: t, quien: "ADMIN", detalle: detGen }); return typeof f === "string" && f.length > 10 && !/undefined|null/.test(f); }), "AC-9 los 16 tipos del catálogo real tienen traducción (ninguna frase sale vacía ni con «undefined»)");
  R.actividad = null;
  w.close();
}
{
  R.chat = true; R.chatMsgs = [];
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: R.usuarios, datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  pestaña(w, "Equipo");
  await sleep(120);
  click(d.querySelector("[data-chat]"));
  await sleep(250);
  ok(w.reproductorVozHtml({ adj_datos: "data:audio/mp4;base64,AAAA", adj_dur: 65, id: "prueba" }, 0).includes("1:05"), "CH-1 el reproductor pinta la duración GUARDADA al grabar (65 s → «1:05») sin esperar el metadato del archivo");
  ok(w.estadoMsg({ local: true, op_estado: "fallida", op_intentos: 3 }).includes("⚠"), "CH-2 una burbuja «fallida» se pinta ⚠ con su salida (reintentar), no un reloj mudo eterno");
  const estCola = w.estadoMsg({ local: true, op_estado: "pendiente", op_intentos: 0 });
  ok(estCola.includes("sin enviar") && !estCola.includes("⚠"), "CH-3 en cola normal sigue el 🕐 de siempre, sin ⚠");
  w.chatAdj = { tipo: "voz", datos: "data:audio/mp4;base64,AAAA", nombre: "Nota de voz", mime: "audio/mp4", tam: 4, dur: 7, adjRef: "adj-x" };
  w.pintarChat();
  click(d.getElementById("chEnviar"));
  const opVoz = w.state.cola[w.state.cola.length - 1];
  ok(!!opVoz && opVoz.tipo === "chat" && !!opVoz.adj && opVoz.adj.datos === "data:audio/mp4;base64,AAAA" && opVoz.adj.adjRef === "adj-x" && opVoz.adj.dur === 7, "CH-4 la operación en cola lleva el DATO íntegro + la referencia + la duración: enviar y oír ya no dependen de recuperar el Blob de IndexedDB");
  w.state.cola.length = 0;
  await sleep(200); /* que el despacho de CH-4 se asiente antes de contar */
  w.encolar({ tipo: "chat", para: "BUSC-1", texto: "x", cuando: new Date().toISOString(), estado: "fallida", intentos: 3 });
  const antesEnv = llamadas.filter(x => x === "rpc:enviar_mensaje").length;
  await w.despacharCola();
  await sleep(60);
  ok(llamadas.filter(x => x === "rpc:enviar_mensaje").length === antesEnv, "CH-5 una operación «fallida» NO se reintenta sola en cada latido: espera el toque de Ernesto en su burbuja");
  w.state.cola.length = 0;
  let clicksFile = 0;
  const fi = d.getElementById("chFile");
  const clickOrig = fi.click.bind(fi);
  fi.click = function(){ clicksFile++; };
  click(d.getElementById("chClip"));
  await sleep(30);
  ok(clicksFile === 1 && fi.getAttribute("accept") === "image/*", "CH-6 el clip abre la FOTO en UN toque (la hoja quedó a presión larga): de 3 toques de app a 2");
  fi.click = clickOrig;
  w.close();
  R.chatMsgs = [];
}

console.log("\nBANCO MI NEGOCIO: " + pass + " PASS · " + fail + " FAIL");
if (fails.length) console.log("Fallos:", fails.join(" · "));
process.exit(fail ? 1 : 0);

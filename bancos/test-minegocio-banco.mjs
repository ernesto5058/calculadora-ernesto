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
  costoOk: true, costoGate: null,
  /* V29-D · ciclos del dueño (C2): espejo del fixture SQL caso 8 —
     dos liquidaciones de Briku con pendientes 625 + 336 = 961
     (cifras históricas, regla anterior en la primera). MN2
     (2026-11-17): cada liquidación trae además pendiente_comision /
     pendiente_premio, los campos que dinero_ciclo_json deriva en el
     servidor y que la app lee tal cual (625 = 500 + 125 · 336 = 336 + 0);
     sin esos campos la app ya no deriva deuda en el cliente. */
  ciclosResp: { ok: true, liquidaciones: [
    { liquidacion_id: "liq-banco-1", buscador: "BRIKU-EUX", tipo: "saldo",
      creada_en: "2026-11-10T10:00:00Z", capital_cup: 10000, producto: 3600,
      pct: 32, ganado_comision: 500, ganado_premio: 125,
      entregado_comision: 0, entregado_premio: 0, pendiente_ciclo: 625,
      pendiente_comision: 500, pendiente_premio: 125,
      base_regla: "total", comision_ahora: 475, comision_despues: 500,
      descuento_pct: 5, eleccion_pago: null, es_prueba: false },
    { liquidacion_id: "liq-banco-2", buscador: "BRIKU-EUX", tipo: "saldo",
      creada_en: "2026-11-12T10:00:00Z", capital_cup: 10000, producto: 3600,
      pct: 32, ganado_comision: 336, ganado_premio: 0,
      entregado_comision: 0, entregado_premio: 0, pendiente_ciclo: 336,
      pendiente_comision: 336, pendiente_premio: 0,
      base_regla: "ernesto_neto", comision_ahora: 319, comision_despues: 336,
      descuento_pct: 5, eleccion_pago: null, es_prueba: false } ] }
};
let llamadas = [];
let ultimosCuerpos = {};
/* FIXTURE EN FORMA VIVA (Tanda Inspector Nº2 · E-2): réplica de la
   forma REAL del datos.json publicado el 2026-11-12 — buscadores como
   OBJETO por clave opaca, claves de bono bonoSaldoMeta/bonoSaldoMonto
   y bonoTransfMeta/bonoTransfMonto, versionApp 1.5.1. La forma muerta
   (sin buscadores / claves viejas / 1.3.1) dejó pasar E-2 con el
   banco en verde: no vuelve. */
const datosPublicados = { version: 5, versionApp: "1.5.1", apkUrl: "https://example.invalid/apk", actualizado: "2026-11-12", tarifa: { ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, bonoSaldoMeta: 150, bonoSaldoMonto: 300, bonoTransfMeta: 10, bonoTransfMonto: 300 }, buscadores: { "BUSC-1": { nombre: "Busc Uno", tratos: [] }, "BUSC-2": { nombre: "Busc Dos", tratos: [] } }, publico: { telefono: "51231558", zona: "Micro 10, distrito José Martí, Santiago de Cuba", domicilio: "Domicilio gratis en Santiago de Cuba", saldo: { tasa: 2, tasaAlta: 2.2, recarga: 720, desdeAlta: 5000 } } };
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
  /* v43: extra.url permite probar los deep links (?tab=…) tal como
     llegan del push; sin ella, la URL de producción de siempre. */
  const dom = new JSDOM(html, { url: (extra && extra.url) || "https://ernesto5058.github.io/calculadora-ernesto/minegocio/", runScripts: "dangerously", pretendToBeVisual: true, beforeParse(w){
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
      /* TANDA 6 · E-12: el stub modela la API REAL de PushSubscription:
         options.applicationServerKey con la clave VAPID vigente (la del
         propio HTML) y unsubscribe(); sin eso, la renovación de clave
         no se puede ejercitar y el flujo «ya suscrito» no existe. */
      const vapidStr = (html.match(/var VAPID_PUBLICA = "([^"]+)"/) || [])[1] || "";
      const vapidRaw = w.atob((vapidStr + "=".repeat((4 - (vapidStr.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
      const vapidBuf = new Uint8Array(vapidRaw.length); for (let i = 0; i < vapidRaw.length; i++) vapidBuf[i] = vapidRaw.charCodeAt(i);
      const fakeSub = { options: { applicationServerKey: vapidBuf.buffer }, unsubscribe(){ return Promise.resolve(true); }, toJSON(){ return { endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" } }; } };
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
    if (u.includes("/functions/v1/qvapay-contactos")) {
      /* V29 (Frente B): agenda de QvaPay. Por defecto CAÍDA (404) pa
         ejercitar la degradación elegante en todos los casos viejos;
         R.contactosResp la enciende con la forma real [{nombre, usuario}]. */
      llamadas.push("fn:qvapay-contactos");
      if (R.contactosFalla || !R.contactosResp) return rechaza("agenda no disponible", 404);
      const jc = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v)), json: () => Promise.resolve(v) });
      return jc(R.contactosResp);
    }
    if (u.includes("/functions/v1/textos-generar")) {
      let body = {}; try { body = JSON.parse(opts && opts.body || "{}"); } catch(e){}
      llamadas.push("fn:textos-generar:" + (body.accion || ""));
      ultimosCuerpos["textos-generar"] = body;
      const jsonF = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v)), json: () => Promise.resolve(v) });
      if (body.accion === "catalogo") return jsonF(R.textosCatalogoResp || { ok: true, items: [
        { clave: "saldo", nombre: "Saldo", tipo: "saldo" },
        { clave: "transferencia", nombre: "Transferencia", tipo: "transferencia" },
        { clave: "bateria", nombre: "Batería LiFePO4 12.8V 100Ah", tipo: "producto", precio_al_privado: true, estado: "activo" }
      ], telefono: "51231558", zona: "Micro 10, distrito José Martí, Santiago de Cuba" });
      if (body.accion === "generar") return jsonF(R.textosGenerarResp || { ok: true, versiones: [
        { enfoque: "directo", texto: "TEXTO IA " + body.clave + " · llama al 51231558" },
        { enfoque: "vendedor", texto: "TEXTO IA vendedor " + body.clave },
        { enfoque: "humanizado", texto: "TEXTO IA humanizado " + body.clave }
      ], avisos: [] });
      return jsonF({ ok: false, error: "acción desconocida" });
    }
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
        case "admin_publicar_tratos":
          /* El mock hace de servidor con memoria: lo publicado
             QUEDA en R.panelServidor (la puerta REEMPLAZA por
             buscador) y leer_panel lo devuelve — contrato real. */
          (body.p_tratos || []).forEach(function(e){ if (e && e.codigo) { R.panelServidor = R.panelServidor || {}; R.panelServidor[e.codigo] = { nombre: e.nombre, tratos: JSON.parse(JSON.stringify(e.tratos || [])) }; } });
          return json({ ok: true });
        case "leer_panel": {
          if (R.panelFalla) return rechaza("panel ilegible");
          const srvP = (R.panelServidor || {})[body.p_codigo];
          return json({ ok: true, nombre: (srvP && srvP.nombre) || "", tratos: (srvP && srvP.tratos) || [] });
        }
        case "dinero_leer_estado":
          if (R.dineroFalla) return rechaza("dinero caído");
          return json(R.dineroEstado || null);
        case "dinero_declarar_tasa": return json(R.declararTasaResp || { ok: true });
        case "dinero_registrar_cobro": return json(R.registrarCobroResp || { ok: true, gasto_acreditado: 684 });
        case "dinero_registrar_gasto_idem":
          /* v43: el gasto del saldo libre. R.gastoFalla modela los dos
             rechazos reales del servidor/red. */
          if (R.gastoFalla === "insuficiente") return rechaza("saldo de gasto insuficiente", 400);
          if (R.gastoFalla === "red") return sinRed();
          return json(R.gastoResp || { ok: true, duplicado: false, saldo_gasto: 760 });
        case "dinero_registrar_entrega_comision": return json(R.entregaComisionResp || { ok: true });
        case "dinero_elegir_pago": return json(R.elegirPagoResp || { ok: true });
        case "dinero_reatribuir_espera": return json(R.reatribuirResp || { ok: true });
        case "pago_estado_dueno": return json(R.ciclosResp || { ok: true, liquidaciones: [] });
        case "dinero_ganancias":
          return json(R.dineroGanancias || { por_buscador: [], total: { hoy: { comision: 0, ganancia_ernesto: 0 }, semana: { comision: 0, ganancia_ernesto: 0 }, acumulado: { comision: 0, ganancia_ernesto: 0 } } });
        case "leer_tarifa":
          if (!R.tarifaVivaOk) return rechaza("404");
          if (R.tarifaVivaFila) return json(Object.assign({ ok: true }, R.tarifaVivaFila));
          return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 950, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: "2026-11-10 22:00" });
        /* T1 (v22): las puertas nuevas del panel único. */
        case "avisos_historial":
          if (R.avisosFalla) return rechaza("404");
          return json(R.avisosHist || { ok: true, avisos: [] });
        case "avisos_probar": return json({ ok: true, para: "ADMIN", encolado: true });
        case "mercado_foto_vigente": return json(R.mercadoFoto || null);
        case "guia_ernesto": return json(R.guiaErnesto || { ok: false, motivo: "sin fixture" });
        case "guia_terminal":
          /* v43: la Terminal con su fixture (antes caía en «desconocida»
             y el banco no la podía habitar). R.termFalla la tumba pa
             el caso de regresión del CHEQUEO 137. */
          if (R.termFalla) return rechaza("puerta de la Terminal caída");
          return json(R.termDatos || { ok: true,
            foto: { edad_min: 3, usable: true, top_venta: 310.25, nivel20: 305.5 },
            serie_etecsa: [0, 1, 2, 3, 4, 5].map(i => ({ t: new Date(Date.now() - (5 - i) * 600000).toISOString(), tasa: 300 + i })),
            serie_bankcup: [],
            libro: { escalera_venta: [], escalera_compra: [] },
            demanda: null, memoria: null, ventas: [], escenarios: [] });
        case "guia_subir": return json(R.guiaSubirResp || { ok: true, estado: "pendiente" });
        case "guia_descartar": return json({ ok: true });
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
function pestaña(w, nombre){
  /* T1 (v22): la barra ya solo trae 4 secciones; las pantallas hijas se
     abren con irA() — el ayudante hace lo mismo que el dedo de Ernesto:
     si hay pestaña visible con ese nombre la toca; si no, navega por
     la función pública de la app con su mapa de nombres. */
  const MAPA = { "Calculadora": "Calc", "Mi dinero": "Dinero" };
  let tocada = false;
  [...w.document.querySelectorAll(".tab")].forEach(t => { if (t.textContent.includes(nombre)) { click(t); tocada = true; } });
  if (!tocada && typeof w.irA === "function") w.irA(MAPA[nombre] || nombre);
}

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
  /* T1 (v22): la barra ya no lista pantallas: trae SOLO las 4 secciones
     del panel único; las 13 pantallas viven como hijas alcanzables por
     irA (la cobertura de módulos la verifica la sección T1 del banco). */
  ok(tabs.length === 4, "MN-48 T1: la barra trae SOLO las 4 secciones (" + tabs.join(" | ") + ")");
  ok(tabs.some(t => t.includes("Inicio")) && tabs.some(t => t.includes("Equipo")) && tabs.some(t => t.includes("Mercado")) && tabs.some(t => t.includes("Actividad")), "MN-49 T1: las 4 secciones exactas del rediseño v42 (Inicio · Equipo · Mercado · Actividad), ninguna otra inventada");
  w.close();
}

/* ===== 10. SERVICE WORKER: scope y caché propios ===== */
{
  const sw = fs.readFileSync(REPO + "minegocio/sw.js", "utf8");
  ok(sw.includes('CACHE = "minegocio-v46"'), "MN-50 SW con caché propio minegocio-v46 (v31 · PRO + ruta manual + rediseño Entregar dinero + dirección de arte v35 + plano premium v37, 3D retirado + tarjeta permanente del Asesor v38 + cadena de dinero v41 + rediseño PRO v42: 4 pestañas y tarjeta Mi gasto + v43: Registrar gasto y Analista visible, CHEQUEOS 126/135/136 + v44: Recargas sin atribuir, CHEQUEO 139 + v45: Chat PRO — tarjetas parte/tarifa, difusión, cabecera viva + v46: WebPerf — supabase-js bajo demanda, CHEQUEO 141)");
  ok(sw.includes("SKIP_WAITING") && sw.includes('addEventListener("message"'), "MN-50b el SW acepta SKIP_WAITING por mensaje (forzar activación desde la app)");
  ok(!sw.includes("mitrabajo"), "MN-51 el SW de Mi Negocio no toca el de Mi Trabajo");
  /* v38 · Tarjeta permanente del Asesor (CHEQUEO 126): el estado de
     la puerta se enseña solo, con el motivo del servidor, y la oferta
     a mano nace de la línea — nunca del tope de configuración. */
  ok(html.includes('id="mcAsesorEstado"') && html.indexOf('h += asesorEstadoHtml();') > 0 && html.indexOf('h += asesorEstadoHtml();') < html.indexOf('class=\"t1Seg\" role=\"tablist\"'), "MN-89 la tarjeta del Asesor existe y se pinta ANTES de los segmentos de Mercado");
  ok(html.includes("pu.motivo") && html.includes("PUERTA EN PAUSA") && html.includes("El Asesor no está trabajando"), "MN-90 la pausa se anuncia con el motivo DEL SERVIDOR (pu.motivo), no con texto de la app");
  ok(!html.includes("la API de QvaPay está caída"), "MN-91 la tarjeta NO trae la causa de la pausa escrita de fábrica (la causa es solo pausa_motivo del servidor)");
  ok(html.includes("Math.floor(Number(linea) - comp) - 5") && html.includes("vendible / tasa"), "MN-92 el tamaño nace de la línea: ⌊línea − comprometido⌋ − 5 del peaje, y los QUSD = vendible ÷ tasa");
  ok(html.includes("pos.firme !== true") && html.includes("Sin tamaño firmado"), "MN-93 sin posición firme la tarjeta NO firma tamaño: enseña las cifras y lo dice");
  ok(html.includes("compRaw === null") && html.includes("falta el dato de saldo comprometido"), "MN-94 sin el dato de comprometido tampoco se firma (el servidor pone vendible null en ese caso)");
  ok(html.includes("f.libro_ok !== true") && html.includes("SIN LIBRO"), "MN-95 foto sin libro validado = no se firman números (la foto usable del servidor es libro_ok + fresca + <20 min)");
  ok(html.includes("edadF >= 1200") && html.includes("isNaN(edadF)") && html.includes("FOTO VIEJA"), "MN-96 foto vieja (≥20 min, borde incluido) o sin edad = FOTO VIEJA, no se firman números");
  ok(html.includes("ESTADO SIN LEER") && html.includes("puLeida"), "MN-97 sin el objeto puerta del payload la tarjeta dice SIN LEER: jamás declara la puerta activa por defecto");
  ok(html.includes("limitado por el tope de") && !html.includes("tope_oferta) + \" QUSD\""), "MN-98 el tope de config solo se anota si el QUSD real lo supera: nunca se enseña como monto de la oferta");
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
  /* Motor de textos SLIM (Ola Nueva 2): la generación por plantillas
     murió — todo texto sale de la Edge Function «textos-generar». */
  const M = w.TextosMotor;
  ok(!!M, "MN-61 el motor de textos compartido está inyectado");
  ok(typeof M.miles === "function" && M.miles(125000) === "125 000", "MN-62 motor slim: miles con espacio («125 000»)");
  ok(typeof M.generar === "undefined" && typeof M.textoRapidoSaldo === "undefined" && typeof M.textoRapidoTransf === "undefined" && typeof M.textoRapidoProducto === "undefined", "MN-63 motor slim: SIN generar ni textoRapido* (las plantillas desaparecieron del sistema)");
  let hist = []; for (let i = 0; i < 35; i++) hist = M.historialPush(hist, { titulo: "t" + i });
  ok(hist.length === 30, "MN-67 historial del generador con tope de 30");
  ok(!/ingresoRef360[^;\n]{0,60}0\.9/.test(html) && !html.includes("textoRapido"), "MN-68 el index construido NO contiene la fórmula del 980 (ingresoRef360 × 0.9) ni llamadas textoRapido*");
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
  ok(("" + w.sessionStorage.getItem("mnRecarga_v31")) === "1", "R2-3 controllerchange marca la recarga única de la v31 (sin bucles)");
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
  ok(w.selloVersion() === "Mi Negocio · versión 2026-11-18 04:05 · v31 · PRO", "R2-28 sello de versión exacto: «" + w.selloVersion() + "»");
  ok(chat.textContent.includes("cada 3 s"), "R2-29 la ayuda del chat dice el refresco nuevo de 3 s (ya no 15 s)");
  pestaña(w, "Inicio");
  await sleep(120);
  ok(d.getElementById("pgInicio").textContent.includes("Mi Negocio · versión 2026-11-18 04:05 · v31 · PRO"), "R2-30 el sello de versión se ve en Inicio");
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
  ok(!!card && card.textContent.includes("cuenta.pdf") && !!card.querySelector(".docIco svg") && card.textContent.includes("12"), "KM-2 el documento pinta su tarjeta: icono PDF, nombre y tamaño");
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
  ok(!!prevD && !!prevD.querySelector(".docIco svg") && prevD.textContent.includes("cuenta.pdf") && !prevD.querySelector("img.prevFoto"), "KM-11 la previa de documento es su tarjeta (icono + nombre + tamaño), sin miniatura");
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
  R.usuarios = [ { codigo: "BUSCA-001", nombre: "BUSCA-001", activo: true }, { codigo: "BUSCA-002", nombre: "BUSCA-002", activo: true } ];
  R.reportes = [
    { id: "r1", codigo: "BUSCA-001", nombre: "BUSCA-001", tipo: "saldo", cantidad: 100, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2467, comision_pagada_en: "2026-11-06T10:00:00.000Z", creado: "2026-11-05T10:00:00.000Z" },
    { id: "r2", codigo: "BUSCA-001", nombre: "BUSCA-001", tipo: "transferencia", cantidad: 5000, precio: null, porc: 30, telefono: "5", nota: "", estado: "aprobado", comision: 154.88, comision_pagada_en: null, creado: "2026-11-10T10:00:00.000Z" },
    { id: "r3", codigo: "BUSCA-002", nombre: "BUSCA-002", tipo: "saldo", cantidad: 50, precio: 900, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2483.50, comision_pagada_en: null, creado: "2026-11-10T11:00:00.000Z" },
    { id: "r4", codigo: "BUSCA-001", nombre: "BUSCA-001", tipo: "saldo", cantidad: 100, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2467, comision_pagada_en: null, prueba: true, creado: "2026-11-10T12:00:00.000Z" },
    { id: "r5", codigo: "BUSCA-001", nombre: "BUSCA-001", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "pendiente", comision: null, comision_pagada_en: null, creado: "2026-11-10T13:00:00.000Z" },
    { id: "r6", codigo: "BUSCA-002", nombre: "BUSCA-002", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "rechazado", comision: null, comision_pagada_en: null, creado: "2026-11-10T14:00:00.000Z" },
    { id: "r7", codigo: "BUSCA-001", nombre: "BUSCA-001", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 246.70, comision_pagada_en: null, creado: hoyISO }
  ];
  const preConta = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, calc: { saldo: { salida: 950, costo: 1040, tasa: 320, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 }, busc: { precio: 0, tasaVenta: 0, efectivo: 0, porc: 0, libro: 0, salida: 0 } }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ preState: preConta });
  await sleep(350);
  const d = w.document;
  ok(w.PUERTAS.marcarPrueba === "admin_marcar_prueba", "F1-1 la puerta nueva está registrada: PUERTAS.marcarPrueba = admin_marcar_prueba");
  ok(w.MN_VERSION === "v31", "F1-2 MN_VERSION subió a v31");
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
  ok(txtConta.includes("401.58") && txtConta.includes("2483.50"), "F1-14 Por pagar agrupado: BUSCA-001 401.58 (2) · BUSCA-002 2483.50 (1)");
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
  click(d.querySelector('[data-conta-buscador="BUSCA-001"]'));
  await sleep(40);
  ok(nAsientos() === 3, "F1-20 Libro filtro buscador BUSCA-001 (periodo Todo) → 3 asientos (r1, r2, r7)");
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
  const tabBan = [...d.querySelectorAll(".tab")].find(t => t.getAttribute("data-seccion") === "Inicio");
  const badgeBan = tabBan && tabBan.querySelector(".badge");
  ok(!!badgeBan && badgeBan.textContent.trim() === "1", "F1-24 T1: badge de pendientes en la sección Inicio = 1 (solo r5; las pruebas no cuentan)");
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
  R.usuarios = [ { codigo: "BUSCA-001", nombre: "BUSCA-001", activo: true } ];
  R.reportes = [ { id: "rp", codigo: "BUSCA-001", nombre: "BUSCA-001", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 246.70, comision_pagada_en: null, creado: new Date().toISOString() } ];
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
  R.reportes = [ { id: "rp", codigo: "BUSCA-001", nombre: "BUSCA-001", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 246.70, comision_pagada_en: null, creado: new Date().toISOString() } ];
  const fotoVieja = { reportes: [ { id: "rp", codigo: "BUSCA-001", nombre: "BUSCA-001", tipo: "saldo", cantidad: 10, precio: 1000, estado: "aprobado", comision: 246.70, comision_pagada_en: "2026-11-10T12:00:00.000Z", creado: "2026-11-10" } ],
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
  R.usuarios = [ { codigo: "BUSCA-001", nombre: "BUSCA-001", activo: true }, { codigo: "BUSCA-002", nombre: "BUSCA-002", activo: true } ];
  const fixture21 = () => [
    { id: "r1", codigo: "BUSCA-001", nombre: "BUSCA-001", tipo: "saldo", cantidad: 100, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2467, comision_pagada_en: "2026-11-06T10:00:00.000Z", creado: "2026-11-05T10:00:00.000Z" },
    { id: "r2", codigo: "BUSCA-001", nombre: "BUSCA-001", tipo: "transferencia", cantidad: 5000, precio: null, porc: 30, telefono: "5", nota: "", estado: "aprobado", comision: 154.88, comision_pagada_en: null, creado: "2026-11-10T10:00:00.000Z" },
    { id: "r3", codigo: "BUSCA-002", nombre: "BUSCA-002", tipo: "saldo", cantidad: 50, precio: 900, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2483.50, comision_pagada_en: null, creado: "2026-11-10T11:00:00.000Z" },
    { id: "r4", codigo: "BUSCA-001", nombre: "BUSCA-001", tipo: "saldo", cantidad: 100, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2467, comision_pagada_en: null, prueba: true, creado: "2026-11-10T12:00:00.000Z" },
    { id: "r5", codigo: "BUSCA-001", nombre: "BUSCA-001", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "pendiente", comision: null, comision_pagada_en: null, creado: "2026-11-10T13:00:00.000Z" },
    { id: "r6", codigo: "BUSCA-002", nombre: "BUSCA-002", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "rechazado", comision: null, comision_pagada_en: null, creado: "2026-11-10T14:00:00.000Z" },
    { id: "r7", codigo: "BUSCA-001", nombre: "BUSCA-001", tipo: "saldo", cantidad: 10, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 246.70, comision_pagada_en: null, creado: hoyISO21 }
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
  ok(!d.getElementById("contaBusc") && !!pg.querySelector('[data-conta-buscador="BUSCA-001"]') && !!pg.querySelector('[data-conta-buscador="BUSCA-002"]'), "F2-3 fuera el select #contaBusc: el buscador va en chips (BUSCA-001 y BUSCA-002)");
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
  R.reportes = [ { id: "r1", codigo: "BUSCA-001", nombre: "BUSCA-001", tipo: "saldo", cantidad: 100, precio: 1000, porc: null, telefono: "5", nota: "", estado: "aprobado", comision: 2467, comision_pagada_en: "2026-11-06T10:00:00.000Z", creado: "2026-11-05T10:00:00.000Z" } ];
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
  ok(tabs22.length === 4 && tabs22.every(t => !!t.querySelector("svg")), "F3-1 T1: las 4 secciones llevan icono SVG de trazo fino (cero emojis estructurales en la navegación)");
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
  await sleep(200);
  const selsTx = ["txEmojis", "txTono", "txTam", "txDest", "txClave"].map(id => d.getElementById(id));
  ok(selsTx.every(s => !!s && s.classList.contains("selOculto")) && d.querySelectorAll(".chipsSel").length === 5, "F3-7 Textos PRO: quedan SOLO el selector de producto y los 4 de Estilo (5), ocultos tras sus chips — fuera botones de plantillas y formulario de producto (txp*)");
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
    { codigo: "BUSCA-001", nombre: "Briku", activo: true },
    { codigo: "BUSCA-002", nombre: "Abraham", activo: true }
  ];
  R.chatMsgs = [];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: R.usuarios, datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null, perfiles: { "BUSCA-001": { nombre: "Briku", telefono: "51234567" } } }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  pestaña(w, "Equipo");
  await sleep(150);
  const btns = [...d.querySelectorAll("[data-enviar]")];
  ok(btns.length === 2 && btns.every(b => b.textContent.includes("Enviar su enlace")), "E9-1 cada tarjeta de buscador lleva su botón «📤 Enviar su enlace»");
  const abiertas = [];
  w.open = function(u){ abiertas.push(String(u)); };
  click(d.querySelector('[data-enviar="BUSCA-001"]'));
  await sleep(400);
  ok(abiertas.length === 1 && abiertas[0].indexOf("https://wa.me/5351234567?text=") === 0, "E9-2 con teléfono en el perfil, WhatsApp va dirigido a su número (+53 + 8 dígitos)");
  const txtB = abiertas.length ? decodeURIComponent(abiertas[0].split("?text=")[1] || "") : "";
  ok(txtB.includes("https://example.invalid/apk"), "E9-3 el mensaje trae el apkUrl LEÍDO EN VIVO de datos.json (el del stub), no una constante");
  ok(txtB.includes("BUSCA-001"), "E9-4 el mensaje trae el código personal de ESE buscador");
  ok(txtB.includes("https://ernesto5058.github.io/calculadora-ernesto/buscadores/?codigo=BUSCA-001"), "E9-5 el mensaje trae su enlace personal ?codigo= (el que rebota a la app)");
  click(d.querySelector('[data-enviar="BUSCA-002"]'));
  await sleep(400);
  ok(abiertas.length === 2 && abiertas[1].indexOf("https://wa.me?text=") === 0, "E9-6 sin teléfono en el perfil, se abre el compartir genérico de WhatsApp");
  const txtA = abiertas.length > 1 ? decodeURIComponent(abiertas[1].split("?text=")[1] || "") : "";
  ok(txtA.includes("BUSCA-002") && !txtA.includes("BUSCA-001"), "E9-7 el mensaje de Abraham trae SU código y no el de Briku");
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
  R.usuarios = [ { codigo: "BUSCA-001", nombre: "Briku", activo: true }, { codigo: "PEUEBA", nombre: "Prueba", activo: true } ];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: R.usuarios, datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  pestaña(w, "Textos");
  await sleep(80);
  ok(!!d.getElementById("txClave") && !!d.getElementById("txGenerar") && !!d.getElementById("txCatChips"), "TX-1 Textos PRO: UN selector de producto (chips) + botón «Generar textos», sin botones de plantillas");
  ok(["txSaldo", "txTransf", "txProdBtn", "txProdForm", "txpGen", "txpNombre", "txpPrecio", "txGen", "txProd", "txPrecio", "txMoneda", "txTipo", "txCant", "txDet", "txCond", "txPrivado"].every(id => !d.getElementById(id)), "TX-2 fuera los 3 botones de plantillas y el formulario de producto (txp*)");
  ok(d.getElementById("txTel").value === "51231558" && d.getElementById("txZona").value.includes("Micro 10"), "TX-3 «Tus datos de anuncio» se conservan con SU teléfono (51231558) y SU zona");
  await sleep(150);
  const chipsCat = [...d.querySelectorAll('#txCatChips .chip')].map(c => c.getAttribute("data-v"));
  ok(chipsCat[0] === "saldo" && chipsCat[1] === "transferencia" && chipsCat.includes("bateria"), "TX-4 el selector trae primero saldo y transferencia y luego TODO el catálogo vivo (" + chipsCat.join(",") + ")");
  ok(llamadas.includes("fn:textos-generar:catalogo"), "TX-5 el catálogo se cargó de la Edge Function textos-generar (accion catalogo)");
  const catCache = JSON.parse(w.localStorage.getItem("minegocio_textos_catalogo_v1") || "null");
  ok(!!catCache && catCache.items.length === 3, "TX-6 el catálogo queda en caché local (minegocio_textos_catalogo_v1) pa pintar sin conexión");
  ok(html.includes("textos-generar") && html.includes("minegocio_textos_paquete_v1"), "TX-7 el index llama a textos-generar y trae el respaldo de paquete sin conexión");
  click(d.getElementById("txGenerar"));
  await sleep(120);
  const cuerpoGen = ultimosCuerpos["textos-generar"] || {};
  ok(cuerpoGen.accion === "generar" && cuerpoGen.clave === "saldo" && cuerpoGen.codigo === adminValido && cuerpoGen.telefono === "51231558", "TX-8 «Generar textos» llama al motor con la clave elegida, su código y el override de teléfono del dueño");
  const outGen = d.getElementById("txOut").textContent;
  ok(outGen.includes("TEXTO IA saldo") && outGen.includes("51231558"), "TX-9 las versiones de la IA se pintan con Copiar/WhatsApp (salen en txOut)");
  const paq = JSON.parse(w.localStorage.getItem("minegocio_textos_paquete_v1") || "null");
  ok(!!paq && paq.clave === "saldo" && paq.versiones.length === 3 && !!paq.cuando, "TX-10 cada generación exitosa guarda el paquete (minegocio_textos_paquete_v1) pa el modo sin conexión");
  w.close();
}
{
  const ahoraA = new Date().toISOString();
  R.actividad = [
    { accion: "pagar_comision", quien: "ADMIN", creado_en: ahoraA, detalle: { reporte: "83dd3d64-9c59-4720-8220-733ee0ccfd63", buscador: "PEUEBA", comision: 2467 } },
    { accion: "cambiar_tarifa", quien: "ADMIN", creado_en: ahoraA, detalle: { libro: 1069.38, salida: 925, ingreso: 1098.68 } },
    { accion: "pagar_comision_telegram", quien: "ADMIN", creado_en: ahoraA, detalle: { reporte: "c98e57dc-69f9-400a-a7fc-b5425469d3e2", buscador: "BUSCA-001", comision: 246.7, ya_pagado: true } },
    { accion: "telegram_vinculo_fallido", quien: "telegram", creado_en: ahoraA, detalle: { via: "token" } },
    { accion: "generar_cierre", quien: "ADMIN", creado_en: ahoraA, detalle: { semana_inicio: "2026-11-09" } },
    { accion: "evento_que_no_existe", quien: "ADMIN", creado_en: ahoraA, detalle: { x: 1 } }
  ];
  R.usuarios = [ { codigo: "BUSCA-001", nombre: "Briku", activo: true }, { codigo: "PEUEBA", nombre: "Prueba", activo: true } ];
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
  ok(filasA[2].textContent.includes("Briku") && filasA[2].textContent.includes("no se pagó dos veces"), "AC-7 el pago repetido desde Telegram se cuenta como lo que es: YA estaba pagado, no se cobró de nuevo (y «BUSCA-001» se lee «Briku»)");
  ok(filasA[3].textContent.includes("FALLÓ") && filasA[4].textContent.includes("Generaste el cierre de la semana") && filasA[5].textContent.includes("Evento del sistema"), "AC-8 vínculo fallido, cierre y hasta un tipo desconocido tienen su frase (respaldo humanizado, nunca código crudo)");
  const CATALOGO = ["cambiar_tarifa", "generar_cierre", "pagar_comision", "pagar_comision_telegram", "publicar_tratos", "aprobar_telegram", "rechazar_telegram", "fijar_mensaje", "desfijar_mensaje", "bloquear", "desbloquear", "marcar_prueba", "desmarcar_prueba", "vincular_telegram", "telegram_vinculo_fallido", "analista_accion"];
  const detGen = { libro: 1, salida: 2, ingreso: 3, semana_inicio: "2026-11-09", reporte: "x", buscador: "BUSCA-001", comision: 5, ya_pagado: false, usuarios: 2, conversacion: "BUSCA-001", usuario: "BUSCA-001", via: "token", ok: true };
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
  ok(w.estadoMsg({ local: true, op_estado: "fallida", op_intentos: 3 }).includes("ticks fallido") && w.estadoMsg({ local: true, op_estado: "fallida", op_intentos: 3 }).includes("<svg"), "CH-2 una burbuja «fallida» se pinta con el icono de alerta SVG y su salida (reintentar), no un reloj mudo eterno");
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
  const hojaAbierta = d.getElementById("chAdjHoja").classList.contains("abierta");
  ok(hojaAbierta && clicksFile === 0, "CH-6a (v12, orden de Ernesto) el clip abre la HOJA de adjuntos en un toque — patrón WhatsApp, ya no atajo escondido a presión larga");
  click(d.getElementById("chAdjFoto"));
  await sleep(30);
  ok(clicksFile === 1 && fi.getAttribute("accept") === "image/*", "CH-6b la fila «Foto o vídeo» de la hoja dispara el selector de fotos en el mismo gesto");
  fi.click = clickOrig;
  w.close();
  R.chatMsgs = [];
}

/* ===== 26. TANDA INSPECTOR Nº2: TARIFA ÚNICA + PUBLICAR VIVO + XSS =====
   E-1/E-8: sin edición local posterior, tarifa() == fila viva campo a
   campo (la derivada de fábrica 950/1110 NO pisa la viva 925); con
   edición posterior de la sección Buscadores, la derivada manda y se
   NOMBRA. Sin viva ni datos.json: tarifa() = null y «sin tarifa real
   todavía». E-2/C-1: con la fixture en forma viva (objeto), Publicar
   y el respaldo no revientan y las claves de bono salen vivas. E-3/
   C-3: adj_datos con comillas+onerror no ejecuta ni rompe el src. */
{
  R.chat = true; R.guardarOk = true; R.tarifaVivaOk = true;
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ];
  R.reportes = []; R.ayudas = [];
  /* La viva REAL del día: salida 925 (la de CalculadoraPRO). La
     fixture datos.json trae salidaRef 950 y CALC_DEF 950/1110: si la
     derivada pisara, tarifa() diría 950/1092.65/1110. */
  R.tarifaVivaFila = { ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 925, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: "2026-11-12 09:00" };
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(350);
  const d = w.document;
  const tv = w.tarifa();
  ok(!!tv && tv.salidaRef === 925 && tv.libroRef === 1069.38 && tv.ingresoRef360 === 1098.68 && tv.pctSaldo === 25 && tv.pctTransf === 20 && tv.pisoTransf === 25, "T2-1 E-1: sin edición local, tarifa() == fila viva CAMPO A CAMPO (salida 925, no el 950 de fábrica ni el de datos.json)");
  ok(tv._fuente === "viva" && d.getElementById("pgInicio").textContent.includes("Tarifa viva de la base"), "T2-2 E-8: Inicio nombra el origen real (tarifa viva de la base) con su hora");
  /* Edición POSTERIOR de la sección Buscadores → la derivada manda y se nombra */
  pestaña(w, "Calculadora");
  await sleep(80);
  input(d.getElementById("c_b_salida"), "960");
  await sleep(60);
  const td = w.tarifa();
  ok(td._fuente === "derivada" && td.salidaRef === 960 && td.libroRef === 1110 && Math.abs(td.ingresoRef360 - 1104.15) < 0.01, "T2-3 E-1: edición de Buscadores posterior a la viva → derivada (960 / (360÷313)×960 = 1104.15 / libro 1110)");
  pestaña(w, "Tarifa");
  await sleep(60);
  ok(d.getElementById("pgTarifa").textContent.includes("Derivada de tu edición"), "T2-4 E-1: la pantalla de Tarifa NOMBRA la fuente derivada con su hora");
  /* Una lectura viva MÁS NUEVA que la edición devuelve el mando a la viva */
  R.tarifaVivaFila = { ingreso_ref360: 1100, libro_ref: 1070, salida_ref: 930, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: new Date(Date.now() + 3600000).toISOString().replace("T", " ").slice(0, 16) };
  await w.leerTarifaViva();
  await sleep(60);
  const tv2 = w.tarifa();
  ok(tv2._fuente === "viva" && tv2.salidaRef === 930, "T2-5 E-1: lectura viva posterior a la edición → vuelve a mandar la viva (930)");
  R.tarifaVivaFila = null;
  /* C-1: Publicar + Generar con la forma viva NO revientan */
  pestaña(w, "Tarifa");
  await sleep(80);
  let errorPub = null;
  try { click(d.getElementById("tfPub")); } catch(e){ errorPub = e; }
  await sleep(300);
  ok(!errorPub && llamadas.includes("rpc:admin_guardar_tarifa") && llamadas.includes("rpc:admin_publicar_tratos"), "T2-6 C-1/E-2: «Publicar ahora» con buscadores como OBJETO no revienta y sale por las puertas");
  const base1 = w.construirBase(w.tarifa());
  ok(!("buscadores" in base1) && !JSON.stringify(base1).includes("BUSC-1"), "T2-7 E-2/E-4: el respaldo de construirBase NO republica buscadores ni códigos (la Tanda Nº1 los sacó del archivo público; la lista interna vive en mapaBuscadores/listaPublicar)");
  ok(base1.tarifa.bonoSaldoMeta === 150 && base1.tarifa.bonoSaldoMonto === 300 && base1.tarifa.bonoTransfMeta === 10 && base1.tarifa.bonoTransfMonto === 300 && !("bonoSaldoRecargas" in base1.tarifa) && !("bonoSaldoCUP" in base1.tarifa) && !("bonoTransfTratos" in base1.tarifa) && !("bonoTransfCUP" in base1.tarifa), "T2-8 E-2: las claves de bono salen VIVAS (Meta/Monto) y las viejas no se escriben");
  ok(base1.versionApp === "1.5.1", "T2-9 E-2: el respaldo conserva la versionApp viva (1.5.1)");
  const lista1 = w.listaPublicar();
  ok(Array.isArray(lista1) && lista1.some(x => x.codigo === "BUSC-1") && lista1.some(x => x.codigo === "BUSC-2"), "T2-10 E-2: listaPublicar normaliza el objeto a la lista por código que come la puerta");
  w.close();
}
{
  /* E-8: sin viva ni datos.json → nada de TARIFA_DEF silenciosa */
  R.tarifaVivaOk = false; R.tarifaVivaFila = null;
  const { w } = crear({ sinRed: true, preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null, perfiles: {} }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  ok(w.tarifa() === null, "T2-11 E-8: sin fila viva ni datos.json, tarifa() es null (ningún default de fábrica la sustituye)");
  ok(d.getElementById("pgInicio").textContent.includes("Sin tarifa real todavía"), "T2-12 E-8: Inicio lo dice: «Sin tarifa real todavía»");
  const sug = w.sugerencia({ tipo: "saldo", precio: 1000, cantidad: 10 });
  ok(sug.com === 0 && /Sin tarifa real/.test(sug.aviso), "T2-13 E-8: la sugerencia de dinero se BLOQUEA sin tarifa real (comisión 0 con aviso)");
  w.close();
  R.tarifaVivaOk = true;
}
{
  /* C-3: XSS por adjunto en Bandeja y en el chat */
  R.chat = true;
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ];
  const ataque = 'x" onerror="window.__xss=1';
  R.reportes = [ { id: "rx", codigo: "BUSC-1", nombre: "Busc Uno", tipo: "saldo", cantidad: 1, precio: 1000, porc: null, telefono: "5", nota: "", estado: "pendiente", creado: "2026-11-12", adj_datos: ataque } ];
  R.chatMsgs = [ { id: "mx", de: "BUSC-1", para: "ADMIN", texto: "", creado: hace2min, leido: false, adj_tipo: "foto", adj_datos: ataque } ];
  const { w } = crear({ preState: { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: R.usuarios, datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null } });
  await sleep(300);
  const d = w.document;
  pestaña(w, "Bandeja");
  await sleep(80);
  const imgsB = [...d.querySelectorAll("#pgBandeja img")];
  ok(w.__xss === undefined && !imgsB.some(im => (im.getAttribute("src") || "").includes("onerror")), "T2-14 C-3/E-3: el adjunto hostil en la Bandeja NO se pinta como src ni ejecuta (sin window.__xss, sin onerror en ningún src)");
  pestaña(w, "Equipo");
  await sleep(120);
  click(d.querySelector("[data-chat]"));
  await sleep(250);
  const imgsC = [...d.querySelectorAll("#pgChat img.adjFoto")];
  ok(w.__xss === undefined && !imgsC.some(im => (im.getAttribute("src") || "").includes("onerror")), "T2-15 C-3/E-3: el adjunto hostil en el chat tampoco entra a un src (la foto inválida simplemente no se pinta)");
  ok(w.srcSeguroAdj("data:image/png;base64,QUJD", "image/png") === "data:image/png;base64,QUJD" && w.srcSeguroAdj("QUJD", "image/png") === "data:image/png;base64,QUJD" && w.srcSeguroAdj('data:text/html;base64,QUJD') === "" && w.srcSeguroAdj(ataque, "image/jpeg") === "", "T2-16 E-3: srcSeguroAdj acepta dataURL/base64 de mime permitido y rechaza text/html y la cadena del ataque");
  ok(w.esc('a"b') === "a&quot;b", "T2-17 E-3: esc() escapa también las comillas (seguro en atributos)");
  w.close();
  R.reportes = []; R.chatMsgs = [];
}

/* ===== TANDA Nº6 · E-10/E-11/E-12 (SW honesto, push con destino, VAPID) ===== */
{
  const sw6 = fs.readFileSync(REPO + "minegocio/sw.js", "utf8");
  const ramaDatos = sw6.slice(sw6.indexOf("var esDato"), sw6.indexOf("/* Cascarón"));
  ok(ramaDatos.includes("c.put(e.request, clon)"), "T6-1 E-10: la rama de datos del SW GUARDA la respuesta buena en caché (el respaldo prometido existe)");
  ok(sw6.includes('searchParams.set("tab", datos.tab)') && sw6.includes("clients.openWindow(destino)"), "T6-2 E-11: notificationclick sin ventana abierta abre la app con ?tab=<destino> en la URL");
  const { w } = crear({});
  await sleep(200);
  ok(typeof w.mismaClaveVapid === "function" && typeof w.suscribirPush === "function", "T6-3 E-12: la app trae mismaClaveVapid() y suscribirPush()");
  const claveBuena = w.vapidBytes(w.VAPID_PUBLICA).buffer;
  ok(w.mismaClaveVapid({ options: { applicationServerKey: claveBuena } }) === true, "T6-4 E-12: suscripción con la clave actual se reconoce como vigente");
  const claveVieja = new Uint8Array(65); claveVieja[0] = 4;
  ok(w.mismaClaveVapid({ options: { applicationServerKey: claveVieja.buffer } }) === false && w.mismaClaveVapid({ options: {} }) === false && w.mismaClaveVapid(null) === false, "T6-5 E-12: clave distinta, ausente o suscripción nula => NO vigente (toca re-suscribir)");
  ok(html.includes("sub.unsubscribe().then(function(){ return suscribirPush(reg); })"), "T6-6 E-12: activarPush da de baja la suscripción de clave vieja y re-suscribe con la actual");
  ok(html.includes("tabDePush") && html.includes('new URLSearchParams(search0).get("tab")') && html.includes('new URLSearchParams(search0).get("codigo")'), "T6-7 E-11+v25: la app lee ?tab= y ?codigo= de la query ORIGINAL (search0) al arrancar — el replaceState de uno no mata al otro — y aplica el destino en entrar()");
  w.close();
}

/* ===== 21. FORMA CRUDA REAL (caza 2026-11-13: la Contabilidad en 0) =====
   admin_reportes/admin_ayudas devuelven la fila CRUDA de la tabla
   (SETOF: creado_en, telefono_vendedor, buscador, prueba) y la app
   lee la forma corta (creado, telefono, codigo, nombre). Los bloques
   anteriores sembraban la forma corta y el banco quedaba verde con
   la app rota en producción — la misma clase del E-2. Este bloque
   siembra UNA fila cruda idéntica a la real de Briku (saldo, 14
   recargas a 1000, comisión 345.38 ya pagada) y exige que el puente
   de forma la deje contando en Contabilidad. Sin el puente, cae. */
{
  const hoyISO = new Date().toISOString();
  R.chat = true; R.tarifaVivaOk = true;
  R.usuarios = [ { codigo: "BUSCA-001", nombre: "Busca Uno", activo: true, bloqueado: false } ];
  R.ayudas = [];
  R.reportes = [
    { id: "cruda1", buscador: "BUSCA-001", tipo: "saldo", precio: 1000, porc: null, cantidad: 14,
      telefono_vendedor: "50154748", nota: null, estado: "aprobado", comision: 345.38, motivo: null,
      creado_en: hoyISO, resuelto_en: hoyISO, comision_pagada_en: hoyISO, editado: false,
      editado_en: null, adj_tipo: null, adj_nombre: null, adj_mime: null, adj_datos: null,
      adj_bytes: null, op_id: "op-cruda-1", actualizado_en: hoyISO, prueba: false }
  ];
  const preCruda = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, calc: { saldo: { salida: 950, costo: 1040, tasa: 320, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 }, busc: { precio: 0, tasaVenta: 0, efectivo: 0, porc: 0, libro: 0, salida: 0 } }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ preState: preCruda });
  await sleep(350);
  const d = w.document;
  const fila = w.state.foto.reportes[0];
  ok(!!fila && fila.creado === hoyISO && fila.telefono === "50154748" && fila.codigo === "BUSCA-001" && fila.nombre === "Busca Uno", "F1B-1 la fila cruda entra aliasada: creado/telefono/codigo/nombre en forma corta");
  ok(w.hoyReporto("BUSCA-001") === true, "F1B-2 «reportó hoy» lee la fecha aliasada (antes: siempre NO)");
  pestaña(w, "Contabilidad");
  await sleep(80);
  const txtC = d.getElementById("pgContabilidad").textContent;
  ok(txtC.includes("de 1 tratos aprobados"), "F1B-3 Panel: «de 1 tratos aprobados de este mes» (antes: 0 con el trato aprobado y pagado)");
  const celdasC = [...d.querySelectorAll("#pgContabilidad .cell .v")].map(e => e.textContent.trim());
  ok(celdasC.includes("1036.14"), "F1B-4 Panel: ganancia del mes = 1036.14 ((1098.68-1000)x14 - 345.38) [" + celdasC.join(" | ") + "]");
  ok(txtC.includes("1 tratos · Ganancia total:") && txtC.includes("1036.14"), "F1B-5 Libro (mes): 1 trato contado con su ganancia");
  pestaña(w, "Bandeja");
  await sleep(60);
  ok(d.getElementById("pgBandeja").textContent.includes("Busca Uno"), "F1B-6 Bandeja: la tarjeta trae el nombre del buscador (antes: «Sin nombre»)");
  w.close();
  R.reportes = []; R.usuarios = [];
}

/* ===== 22. CADENA DEL PANEL (inspección 2026-11-13: Briku veía 0) =====
   El panel del buscador (Mi Trabajo · renderPanel) lee de paneles
   los tratos que ESTA app publica, y lee OTRA forma: tipo/recargas
   pa los bonos y la semana, nota pa la etiqueta, fecha d/m/yyyy pa
   ubicarla en la semana, comision pa el total. La app publicaba
   {fecha corta, concepto, comision}: aunque Ernesto publicara, el
   panel contaba 0 en bonos/semana y la fila salía sin etiqueta.
   Y la puerta REEMPLAZA: sin historial local, la 2ª publicación
   borraba la 1ª. Este bloque caza las tres cosas. */
{
  const hoyISO = new Date().toISOString();
  R.chat = true; R.tarifaVivaOk = true;
  R.usuarios = [ { codigo: "BUSCA-001", nombre: "Busca Uno", activo: true, bloqueado: false } ];
  R.ayudas = [];
  R.reportes = [
    { id: "cruda2", buscador: "BUSCA-001", tipo: "saldo", precio: 1000, porc: null, cantidad: 14,
      telefono_vendedor: "50154748", nota: null, estado: "pendiente", comision: null, motivo: null,
      creado_en: hoyISO, resuelto_en: null, comision_pagada_en: null, editado: false,
      editado_en: null, adj_tipo: null, adj_nombre: null, adj_mime: null, adj_datos: null,
      adj_bytes: null, op_id: "op-cruda-2", actualizado_en: hoyISO, prueba: false }
  ];
  const preP = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], publicados: {}, borrados: [], tarifaPanel: null, mercado: null }, calc: { saldo: { salida: 950, costo: 1040, tasa: 320, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 }, busc: { precio: 0, tasaVenta: 0, efectivo: 0, porc: 0, libro: 0, salida: 0 } }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ preState: preP });
  await sleep(350);
  w.decidirReporte("cruda2", true, 345.38);
  await sleep(60);
  const item = (w.state.foto.publicar || [])[0];
  ok(!!item && item.codigo === "BUSCA-001" && item.tipo === "saldo" && item.recargas === 14 && item.fecha === hoyISO, "F1C-1 el item de publicación nace completo: codigo/tipo/recargas/fecha real");
  const repFoto = w.state.foto.reportes[0];
  w.marcarPagado(repFoto);
  await sleep(60);
  const lista = w.listaPublicar();
  const ent = lista.filter(function(e){ return e.codigo === "BUSCA-001"; })[0];
  const t = ent && ent.tratos && ent.tratos[0];
  ok(!!t && t.comision === 345.38 && t.tipo === "saldo" && t.recargas === 14 && t.nota === t.concepto && /Saldo/.test(t.nota), "F1C-2 el trato publicado lleva la forma del panel: comision/tipo/recargas/nota");
  ok(!!t && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t.fecha), "F1C-3 la fecha publicada es d/m/yyyy (la que el lector de semana del panel parsea): " + (t && t.fecha));
  ok(!!t && t.estado === "pagado" && t.pagado_en === t.fecha, "F1C-4 el trato publicado lleva su línea de pagado");
  w.state.foto.publicados = { "BUSCA-001": [ { fecha: "1/11/2026", concepto: "Saldo · 7 recarga(s) a 1000.00 CUP", nota: "Saldo · 7 recarga(s) a 1000.00 CUP", tipo: "saldo", recargas: 7, comision: 100 } ] };
  const lista2 = w.listaPublicar();
  const ent2 = lista2.filter(function(e){ return e.codigo === "BUSCA-001"; })[0];
  ok(!!ent2 && ent2.tratos.length === 2, "F1C-5 la publicación es ACUMULATIVA: historial + cola (la puerta reemplaza; sin esto la 2ª borraba la 1ª)");
  const suma = ent2.tratos.reduce(function(s, x){ return s + (x.comision || 0); }, 0);
  const recs = ent2.tratos.reduce(function(s, x){ return s + (x.tipo === "saldo" ? (x.recargas || 0) : 0); }, 0);
  ok(Math.abs(suma - 445.38) < 0.001 && recs === 21, "F1C-6 la matemática del panel con lo publicado: TOTAL 445.38 · 21 recargas (lo que renderPanel sumaría)");
  w.close();

  /* El item VIEJO de la cola (sin tipo/recargas/fecha, como el que
     quedó en el teléfono de Ernesto) se repara solo contra la foto. */
  R.reportes = [
    { id: "cruda3", buscador: "BUSCA-001", tipo: "saldo", precio: 1000, porc: null, cantidad: 14,
      telefono_vendedor: "50154748", nota: null, estado: "aprobado", comision: 345.38, motivo: null,
      creado_en: hoyISO, resuelto_en: hoyISO, comision_pagada_en: hoyISO, editado: false,
      editado_en: null, adj_tipo: null, adj_nombre: null, adj_mime: null, adj_datos: null,
      adj_bytes: null, op_id: "op-cruda-3", actualizado_en: hoyISO, prueba: false }
  ];
  const preViejo = JSON.parse(JSON.stringify(preP));
  preViejo.foto.publicar = [ { nombre: "Busca Uno", concepto: "Saldo · 14 recarga(s) a 1000.00 CUP", comision: 345.38 } ];
  const v2 = crear({ preState: preViejo });
  await sleep(350);
  const iv = (v2.w.state.foto.publicar || [])[0];
  ok(!!iv && iv.codigo === "BUSCA-001" && iv.tipo === "saldo" && iv.recargas === 14 && iv.fecha === hoyISO, "F1C-7 el item viejo de la cola se repara solo: codigo/tipo/recargas/fecha desde el reporte");
  v2.w.close();
  R.reportes = []; R.usuarios = [];
}

/* ===== 23. REGLA DE CONTEO DE BONOS (orden de Ernesto 2026-11-13) =====
   Saldo: solo recargas COMPLETAS de 360 (la fracción no suma).
   Transferencia: solo tratos de 5.000 CUP o más cuentan pa el bono
   (los menores cobran su comisión normal pero no cuentan). El
   publicador emite recargas ya completas y el monto del trato; el
   panel (Mi Trabajo renderPanel) aplica la misma regla al contar. */
{
  const hoyISO = new Date().toISOString();
  R.chat = true; R.tarifaVivaOk = true;
  R.usuarios = [ { codigo: "BUSCA-001", nombre: "Busca Uno", activo: true, bloqueado: false } ];
  R.ayudas = [];
  const filaCruda = function(id, tipo, cantidad, porc){
    return { id: id, buscador: "BUSCA-001", tipo: tipo, precio: tipo === "saldo" ? 1000 : null, porc: porc, cantidad: cantidad,
      telefono_vendedor: "50154748", nota: null, estado: "pendiente", comision: null, motivo: null,
      creado_en: hoyISO, resuelto_en: null, comision_pagada_en: null, editado: false,
      editado_en: null, adj_tipo: null, adj_nombre: null, adj_mime: null, adj_datos: null,
      adj_bytes: null, op_id: "op-" + id, actualizado_en: hoyISO, prueba: false };
  };
  R.reportes = [ filaCruda("frac1", "saldo", 13.5, null), filaCruda("trchica", "transferencia", 3000, 30), filaCruda("trgrande", "transferencia", 8000, 30) ];
  const preB = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], publicados: {}, borrados: [], tarifaPanel: null, mercado: null }, calc: { saldo: { salida: 950, costo: 1040, tasa: 320, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 }, busc: { precio: 0, tasaVenta: 0, efectivo: 0, porc: 0, libro: 0, salida: 0 } }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ preState: preB });
  await sleep(350);
  w.decidirReporte("frac1", true, 300);
  w.decidirReporte("trchica", true, 200);
  w.decidirReporte("trgrande", true, 700);
  await sleep(60);
  const items = w.state.foto.publicar || [];
  const iFrac = items.filter(function(x){ return x.tipo === "saldo"; })[0];
  ok(!!iFrac && iFrac.recargas === 13, "F1D-1 fracción de recarga NO suma: 13.5 recargas -> el item lleva 13 completas");
  const lista = w.listaPublicar();
  const ent = lista.filter(function(e){ return e.codigo === "BUSCA-001"; })[0];
  const tFrac = ent.tratos.filter(function(x){ return x.tipo === "saldo"; })[0];
  ok(!!tFrac && tFrac.recargas === 13, "F1D-2 lo publicado lleva las 13 recargas completas (el panel suma 13, no 13.5)");
  const tChica = ent.tratos.filter(function(x){ return x.tipo === "transferencia" && x.monto === 3000; })[0];
  const tGrande = ent.tratos.filter(function(x){ return x.tipo === "transferencia" && x.monto === 8000; })[0];
  ok(!!tChica && !!tGrande, "F1D-3 los tratos de transferencia publican su MONTO (3000 y 8000): el panel cuenta solo el de >= 5000");
  const cuentaBonoTransf = ent.tratos.filter(function(x){ return x.tipo === "transferencia" && (Number(x.monto) || 0) >= 5000; }).length;
  ok(cuentaBonoTransf === 1, "F1D-4 con la regla aplicada sobre lo publicado: bono de transferencia = 1 de los 2 tratos");
  w.close();
  R.reportes = []; R.usuarios = [];
}

/* ===== 24. PUBLICACIÓN AUTOMÁTICA (v18 · orden de Ernesto) =====
   Al marcar «Ya pagué» con éxito, el trato se publica SOLO en el
   panel del buscador (sin tocar Tarifa → Publicar ahora); al abrir
   la app, el barrido publica los aprobados+pagados atrasados.
   GUARDIA ANTI-BORRADO: antes de escribir se fusiona contra el
   panel real del servidor (leer_panel): una foto local vieja o
   incompleta JAMÁS borra historial, y si la lectura del servidor
   falla no se publica nada. El mock de arriba modela el servidor
   con memoria (R.panelServidor). */
{
  const hoyISO = new Date().toISOString();
  const filaPend = function(id){
    return { id: id, buscador: "BUSCA-001", tipo: "saldo", precio: 1000, porc: null, cantidad: 14,
      telefono_vendedor: "50154748", nota: null, estado: "pendiente", comision: null, motivo: null,
      creado_en: hoyISO, resuelto_en: null, comision_pagada_en: null, editado: false,
      editado_en: null, adj_tipo: null, adj_nombre: null, adj_mime: null, adj_datos: null,
      adj_bytes: null, op_id: "op-" + id, actualizado_en: hoyISO, prueba: false };
  };
  const preAuto = function(){
    return { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], publicados: {}, borrados: [], tarifaPanel: null, mercado: null }, calc: { saldo: { salida: 950, costo: 1040, tasa: 320, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 }, busc: { precio: 0, tasaVenta: 0, efectivo: 0, porc: 0, libro: 0, salida: 0 } }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  };
  const nPub = function(){ return llamadas.filter(function(u){ return u === "rpc:admin_publicar_tratos"; }).length; };
  R.chat = true; R.tarifaVivaOk = true; R.panelFalla = false;
  R.usuarios = [ { codigo: "BUSCA-001", nombre: "Busca Uno", activo: true, bloqueado: false } ];
  R.ayudas = [];

  /* F2-1 · pagar -> panel sin toque manual */
  R.panelServidor = {};
  R.reportes = [ filaPend("auto1") ];
  {
    const { w } = crear({ preState: preAuto() });
    await sleep(350);
    w.decidirReporte("auto1", true, 345.38);
    await sleep(150);
    w.marcarPagado(w.state.foto.reportes[0]);
    await sleep(500);
    ok(nPub() === 1, "F2-1 al pagar, el trato se publica SOLO una vez (sin tocar «Publicar ahora»): " + nPub());
    const cuerpo = ultimosCuerpos["admin_publicar_tratos"] || {};
    const ent = (cuerpo.p_tratos || []).filter(function(e){ return e.codigo === "BUSCA-001"; })[0];
    const t = ent && ent.tratos && ent.tratos[0];
    ok(!!t && t.comision === 345.38 && t.estado === "pagado" && t.recargas === 14, "F2-1 el panel recibe el trato con su línea de pagado");
    ok((w.state.foto.publicar || []).filter(function(x){ return !!x.codigo; }).length === 0, "F2-1 la cola de publicación queda vacía tras el auto-publicado");
    ok(((w.state.foto.publicados || {})["BUSCA-001"] || []).length === 1, "F2-1 el historial local (foto.publicados) siembra el trato publicado");
    w.close();
  }

  /* F2-2 · el segundo trato ACUMULA contra el panel del servidor */
  R.panelServidor = { "BUSCA-001": { nombre: "Busca Uno", tratos: [ { fecha: "1/11/2026", concepto: "Saldo · 7 recarga(s) a 1000.00 CUP", nota: "Saldo · 7 recarga(s) a 1000.00 CUP", tipo: "saldo", recargas: 7, monto: 0, comision: 100 } ] } };
  R.reportes = [ filaPend("auto2") ];
  {
    const { w } = crear({ preState: preAuto() });
    await sleep(350);
    w.decidirReporte("auto2", true, 345.38);
    await sleep(150);
    w.marcarPagado(w.state.foto.reportes[0]);
    await sleep(500);
    const srv = (R.panelServidor["BUSCA-001"] || {}).tratos || [];
    const suma = srv.reduce(function(s, x){ return s + (x.comision || 0); }, 0);
    const recs = srv.reduce(function(s, x){ return s + (x.tipo === "saldo" ? (x.recargas || 0) : 0); }, 0);
    ok(srv.length === 2 && Math.abs(suma - 445.38) < 0.001 && recs === 21, "F2-2 la publicación automática es ACUMULATIVA contra el servidor: 445.38 · 21 recargas");
    w.close();
  }

  /* F2-3 · foto local VACÍA + panel del servidor con historial:
     el barrido al abrir sintetiza el item del aprobado+pagado y
     publica la fusión (el historial del servidor NO se borra) */
  R.panelServidor = { "BUSCA-001": { nombre: "Busca Uno", tratos: [
    { fecha: "2/11/2026", concepto: "Saldo · 7 recarga(s) a 1000.00 CUP", nota: "Saldo · 7 recarga(s) a 1000.00 CUP", tipo: "saldo", recargas: 7, monto: 0, comision: 100 },
    { fecha: "3/11/2026", concepto: "Transferencia · 8000 CUP", nota: "Transferencia · 8000 CUP", tipo: "transferencia", recargas: 0, monto: 8000, comision: 50 } ] } };
  R.reportes = [
    { id: "auto3", buscador: "BUSCA-001", tipo: "saldo", precio: 1000, porc: null, cantidad: 14,
      telefono_vendedor: "50154748", nota: null, estado: "aprobado", comision: 345.38, motivo: null,
      creado_en: hoyISO, resuelto_en: hoyISO, comision_pagada_en: hoyISO, editado: false,
      editado_en: null, adj_tipo: null, adj_nombre: null, adj_mime: null, adj_datos: null,
      adj_bytes: null, op_id: "op-auto3", actualizado_en: hoyISO, prueba: false }
  ];
  let estadoF3 = null;
  {
    const { w } = crear({ preState: preAuto() });
    await sleep(700);
    ok(nPub() >= 1, "F2-3 el barrido al abrir publica el atrasado sin tocar ningún botón");
    const srv = (R.panelServidor["BUSCA-001"] || {}).tratos || [];
    ok(srv.length === 3, "F2-3 la fusión conserva el historial del servidor (2) y suma el atrasado (1) = 3");
    ok(((w.state.foto.publicados || {})["BUSCA-001"] || []).length === 3, "F2-3 foto.publicados queda sembrado con la fusión completa");
    estadoF3 = JSON.parse(w.localStorage.getItem("minegocio_v1"));
    w.close();
  }

  /* F2-4 · reabrir NO duplica: ni una escritura más */
  {
    const { w } = crear({ preState: estadoF3 });
    await sleep(700);
    ok(nPub() === 0, "F2-4 al reabrir, el barrido no vuelve a publicar lo ya publicado");
    const srv = (R.panelServidor["BUSCA-001"] || {}).tratos || [];
    const claves = srv.map(function(t){ return t.fecha + "|" + t.concepto + "|" + t.comision; });
    ok(srv.length === 3 && new Set(claves).size === 3, "F2-4 el panel del servidor sigue con 3 tratos, sin duplicados");
    w.close();
  }

  /* F2-5 · GUARDIA: si leer_panel falla, no se publica NADA y la
     cola/aviso quedan vivos */
  R.panelServidor = {};
  R.panelFalla = true;
  R.reportes = [ filaPend("auto5") ];
  {
    const { w } = crear({ preState: preAuto() });
    await sleep(350);
    w.decidirReporte("auto5", true, 345.38);
    await sleep(150);
    w.marcarPagado(w.state.foto.reportes[0]);
    await sleep(500);
    ok(nPub() === 0, "F2-5 con el panel ilegible NO se escribe nada en el servidor");
    ok((w.state.foto.publicar || []).filter(function(x){ return !!x.codigo; }).length === 1, "F2-5 el trato sigue en la cola: la Bandeja seguirá avisando");
    w.close();
  }
  R.panelFalla = false;
  R.reportes = []; R.usuarios = []; R.panelServidor = {};
}

/* ===== 25. PANTALLA «MI DINERO» (v19) =====
   La foto del capital sale SOLO de dinero_leer_estado (con la
   forma viva de su rama de dueño: capital + saldos + asignaciones
   + estrellas + ganancias + entregas + cuadre), en ENTEROS sin
   coma. Lo que la puerta no trae se pinta «—»; si la puerta cae,
   la pantalla lo dice y no inventa ni un número. */
{
  const hoyISO = new Date().toISOString();
  R.chat = true; R.tarifaVivaOk = true; R.dineroFalla = false;
  R.usuarios = [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true }, { codigo: "BUSC-2", nombre: "Busc Dos", activo: true } ];
  R.ayudas = []; R.reportes = [];
  R.dineroEstado = {
    rol: "ernesto", capital_total: 42700,
    saldo_fondo: 29000, saldo_gasto: 4000, saldo_ernesto_inversion: 9700, saldo_inventario: 0,
    asignaciones: [ { buscador: "BUSC-1", porciento: 35 }, { buscador: "BUSC-2", porciento: 35 } ],
    estrellas: [
      { buscador: "BUSC-1", estrellas: 4.9, conteo_ganadoras: 75, fijada_manual: true, pct_saldo: 32, pct_transferencia: 26 },
      { buscador: "BUSC-2", estrellas: 4.9, conteo_ganadoras: 75, fijada_manual: true, pct_saldo: 32, pct_transferencia: 26 } ],
    ganancias: { por_buscador: [
        { buscador: "BUSC-1", hoy: { comision: 0, ganancia_ernesto: 0 }, semana: { comision: 0, ganancia_ernesto: 0 }, acumulado: { comision: 1838, ganancia_ernesto: 5517 } },
        { buscador: "BUSC-2", hoy: { comision: 0, ganancia_ernesto: 0 }, semana: { comision: 0, ganancia_ernesto: 0 }, acumulado: { comision: 0, ganancia_ernesto: 0 } } ],
      total: { hoy: { comision: 0, ganancia_ernesto: 0 }, semana: { comision: 0, ganancia_ernesto: 0 }, acumulado: { comision: 1838, ganancia_ernesto: 5517 } } },
    entregas: [
      { id: "e1", buscador: "BUSC-1", monto: 14500, pendiente: 14500, bolsillo: "fondo", estado: "en_calle", entregado_en: hoyISO },
      { id: "e2", buscador: "BUSC-2", monto: 14500, pendiente: 9000, bolsillo: "fondo", estado: "en_calle", entregado_en: hoyISO } ],
    vueltas_abiertas: [], devoluciones_pendientes: [], ventas_recientes: [],
    cuadre: { ok: true, total_libro: 42700, esperado: 42700, capital: 42700, gastos: 4000 }
  };
  const preDinero = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], publicados: {}, borrados: [], tarifaPanel: null, mercado: null }, calc: { saldo: { salida: 950, costo: 1040, tasa: 320, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 }, busc: { precio: 0, tasaVenta: 0, efectivo: 0, porc: 0, libro: 0, salida: 0 } }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ preState: preDinero });
  await sleep(350);
  const d = w.document;
  pestaña(w, "Mi dinero");
  await sleep(450);
  const txtD = d.getElementById("pgDinero").textContent;
  ok(llamadas.includes("rpc:dinero_leer_estado"), "F4-1 la pantalla lee la puerta dinero_leer_estado (ninguna fuente inventada)");
  ok(txtD.includes("42.700") && !txtD.includes("42700.00") && !txtD.includes("42,700"), "F4-2 capital total en ENTEROS sin coma: 42.700");
  ok((txtD.split("14.500").length - 1) >= 2 && txtD.includes("35%"), "F4-3 cupo de billetes por buscador: 14.500 (35% de 42700, cerrado a múltiplo de 500)");
  ok(txtD.includes("4.9★") && txtD.includes("32%") && txtD.includes("26%"), "F4-4 estrellas del arranque: 4.9★ cobrando 32/26");
  ok(txtD.includes("Él ganó 1.838") && txtD.includes("Tú ganaste 5.517"), "F4-5 la pareja de ganancias va junta: «Él ganó X · Tú ganaste Y de él»");
  ok(txtD.includes("Ya volvió") && txtD.includes("5.500") && txtD.includes("9.000"), "F4-6 cuenta por buscador: recibió / ya volvió (14500-9000=5.500) / le queda (9.000)");
  ok(txtD.includes("Trabajando") && txtD.includes("23.500") && txtD.includes("38.700"), "F4-7 medidor: trabajando = en la calle 23.500 + inventario 0 · parado = en tu mano 38.700");
  ok(txtD.includes("EL LIBRO CUADRA"), "F4-8 el cuadre del libro se muestra en la pantalla");
  ok(txtD.includes("«Recibido»") && txtD.includes("se calculan") && txtD.includes("hecho"), "F4-9 las reglas del sistema están escritas en la pantalla (vuelve hecho · vale al marcar Recibido · saldos calculados)");
  w.close();

  /* Honestidad: puerta caída -> la pantalla lo dice y no pinta
     ni un solo número del capital */
  R.dineroFalla = true;
  const v2 = crear({ preState: preDinero });
  await sleep(350);
  pestaña(v2.w, "Mi dinero");
  await sleep(450);
  const txtF = v2.w.document.getElementById("pgDinero").textContent;
  ok((txtF.includes("Sin lectura del libro") || txtF.includes("Falta activar el paquete")) && !txtF.includes("42.700"), "F4-10 sin puerta no hay números: la pantalla lo dice en vez de estimar");
  v2.w.close();
  R.dineroFalla = false; R.dineroEstado = null;
  R.reportes = []; R.usuarios = [];
}

/* ===== T1 · PANEL ÚNICO (v22): 4 secciones, hub, ramas, Mercado
   dentro, centro de avisos, marca de destino y guía de 4 pasos ===== */
{
  const ahoraISO = new Date().toISOString();
  R.actividad = [
    { accion: "cambiar_tarifa", quien: "ADMIN", creado_en: ahoraISO, detalle: { salida: 910, libro: 1115.2, ingreso: 1080 } },
  ];
  R.avisosHist = { ok: true, avisos: [
    { id: 2, creado_en: ahoraISO, evento_tipo: "tarifa_propuesta", titulo: "📊 Propuesta de Tarifa Viva", canal: "telegram", resultado: "fallo", motivo: "sin respuesta", es_prueba: false },
    { id: 1, creado_en: ahoraISO, evento_tipo: "prueba", titulo: "✅ Avisos PRO: prueba", canal: "webpush", resultado: "entregado", motivo: null, es_prueba: true },
  ]};
  R.dineroEstado = { rol: "ernesto", capital_total: 42700, saldo_fondo: 601, saldo_gasto: 3000, saldo_inventario: 38455, saldo_ernesto_inversion: -1000, entregas: [], asignaciones: [], estrellas: [], ganancias: { por_buscador: [] }, vueltas_abiertas: [], devoluciones_pendientes: [], ventas_recientes: [{ fuente: "QvaPay", tipo: "venta saldo", monto: 5000, contraparte: "" }], cuadre: { ok: true, total_libro: 41350 } };
  R.mercadoFoto = { nivel20: 305.5, nivel20_edad_s: 12, edad_s: 55, fresca: true, ligera: null, top_venta: 310.25, top_compra: 300, promedio_venta: 306.4, bankcup_promedio: 1115.2, count_buy: 20, count_sell: 25, recibida_en: ahoraISO };
  R.guiaErnesto = { ok: true,
    foto: { usable: true, fresca: true },
    tarifa: { ingreso_ref360: 1080, libro_ref: 1115.2, salida_ref: 910, costo_ref360: 1000 },
    calculo: { senal: "vender", equilibrio: 327.6,
      posicion: { linea_saldo: 14400, linea_en: ahoraISO, lotes_saldo: 14282, comprometido_saldo: 0, colchon: 5, vendible: 14395, qUSD: 0.25, fondo: 601, reserva_cupos: 0 },
      preparada: null, motivos_no_prepara: [], compra_fondo: { posible: false }, transferencia: {} },
    preparada_viva: { id: "11111111-2222-3333-4444-555555555555", tasa: 310.5, monto_qusd: 35, ganancia360: 175.45, expira_en: new Date(Date.now() + 8 * 60000).toISOString(), contexto: { receive: 10863, porques: ["El peldaño combina ganancia y salida."], aviso_promo: null, cuadre: { enviar_saldo: 3715, peaje_saldo: 5, costo_lotes: 10099.78, qusd_entran: 12.05, efectivo_entra: 11086, comision_buscador: 37.14, neto: 949.08, gasto_corte: 296, vuelve_inversion: 10752.86 }, libro_hoy: { cima_firme: 308.33, top_venta_cruda: 279.07, nivel20: 295.01 }, precio: { brecha_vs_nivel20: 13.32 } } },
    contadores: { hoy_qusd: 0, diario_max: 120, acciones_hora: 0, hora_max: 2, tope_oferta: 40 },
    posicion: { mejor_nivel20_hoy: 312.4 }, silencio_hasta: null };
  const preT1 = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ sw: true, preState: preT1, ls: { mn_guia_v22: "1" } });
  const d = w.document;
  await sleep(450);

  /* La barra: 4 secciones exactas, en orden, con su data-seccion
     (v42: Inicio · Equipo · Mercado · Actividad, el rediseño que
     Ernesto aprobó; Dinero/Terminal/Ajustes viven como hijas) */
  const secs = [...d.querySelectorAll(".tab")].map(t => t.getAttribute("data-seccion"));
  ok(JSON.stringify(secs) === JSON.stringify(["Inicio", "Equipo", "Mercado", "Actividad"]), "T1-1 la barra trae las 4 secciones en orden [" + secs.join(",") + "]");
  ok(["Inicio", "Calc", "Bandeja", "Equipo", "Tarifa", "Mercado", "Cierre", "Actividad", "Textos", "Contabilidad", "Dinero", "Terminal", "Ajustes", "Avisos"].every(id => !!w.modulo(id)), "T1-2 los 14 módulos existen (las 12 pantallas de siempre + Terminal + Ajustes + Avisos)");

  /* El hub de Inicio: héroe con el gasto del libro, accesos y novedades */
  const pgI = d.getElementById("pgInicio");
  ok(!!d.getElementById("inHero") && pgI.textContent.includes("HOY PUEDES GASTAR") && pgI.textContent.includes(w.fmtE ? "3.000" : "3000"), "T1-3 el héroe enseña el gasto del libro (3.000 CUP)");
  ok(d.querySelectorAll("#pgInicio .t1Tile").length === 6, "T1-4 seis accesos con dato vivo en el hub");
  ok(pgI.textContent.includes("Cambiaste la tarifa") && pgI.textContent.includes("Un aviso no llegó"), "T1-5 Novedades: el río trae la actividad y el aviso fallido, con su hora");
  const bdg = d.getElementById("bdgAvisos");
  ok(!!bdg && bdg.style.display === "block" && bdg.textContent.trim() === "1", "T1-6 la campana marca 1 aviso fallido en 24 h");

  /* Barra de pila: hija → visible con su sección; raíz → oculta */
  w.irA("Bandeja");
  ok(d.getElementById("subBar").className === "visible" && d.getElementById("subVolverTxt").textContent === "Inicio", "T1-7 en una hija, la barra de pila vuelve a Inicio");
  w.irA("Inicio");
  ok(d.getElementById("subBar").className === "", "T1-8 en la raíz de la sección, sin barra de pila");

  /* El menú: hoja con datos vivos que navega de verdad */
  click(d.getElementById("btnMenuMN"));
  ok(d.getElementById("menuHoja").classList.contains("abierto") && d.getElementById("menuFilas").textContent.includes("Tarifa viva") && d.getElementById("menuFilas").textContent.includes("1098.68"), "T1-9 el menú sube con sus filas y el dato vivo de la tarifa");
  click(d.querySelector('[data-menu="Tarifa"]'));
  ok(d.getElementById("pgTarifa").style.display === "block" && !d.getElementById("menuHoja").classList.contains("abierto"), "T1-10 tocar la fila del menú cierra la hoja y abre Tarifa");

  /* Ajustes en ramas */
  w.irA("Ajustes");
  const pgAj = d.getElementById("pgAjustes").textContent;
  ok(pgAj.includes("Cuenta") && pgAj.includes("Negocio") && pgAj.includes("La app") && pgAj.includes("Datos") && pgAj.includes("Tarifa viva") && pgAj.includes("Notificaciones"), "T1-11 Ajustes: raíz en ramas con sus grupos y filas");
  click(d.querySelector('[data-aj="Tarifa"]'));
  /* v42: Tarifa cuelga de Inicio (es pantalla diaria del hub, no un
     ajuste); la fila de la rama sigue abriendo su página y la pila
     vuelve a su sección dueña, Inicio. */
  ok(d.getElementById("pgTarifa").style.display === "block" && d.getElementById("subVolverTxt").textContent === "Inicio", "T1-12 la fila de una rama abre su página y la pila vuelve a su sección (Inicio en v42)");

  /* Centro de avisos: el registro se lee y la prueba llama su puerta */
  w.irA("Avisos");
  await sleep(250);
  const pgAv = d.getElementById("pgAvisos");
  ok(!!d.getElementById("avRegistro") && pgAv.textContent.includes("Propuesta de Tarifa Viva") && pgAv.textContent.includes("entregado") && pgAv.textContent.includes("falló"), "T1-13 el centro de avisos pinta el registro real (entregado y falló)");
  click(d.getElementById("avProbar"));
  await sleep(120);
  ok(llamadas.includes("rpc:avisos_probar"), "T1-14 «Probar avisos» llama la puerta avisos_probar");

  /* Mercado dentro: libro, posición y el Asesor con Subirla */
  w.irA("Mercado");
  await sleep(300);
  const pgM = d.getElementById("pgMercado");
  ok(pgM.textContent.includes(w.fmt(305.5)) && pgM.textContent.includes("Fresca ·") && !!d.getElementById("mcNivel"), "T1-15 el héroe de Mercado enseña el nivel 20 de la foto vigente con su estado");
  click(pgM.querySelector('[data-seg="posicion"]'));
  ok(pgM.textContent.includes("Vendible ahora") && pgM.textContent.includes(w.fmt(14395)), "T1-16 Posición: el vendible del Asesor, del servidor");
  click(pgM.querySelector('[data-seg="asesor"]'));
  ok(!!d.getElementById("mcAsesor") && pgM.textContent.includes("OFERTA LISTA PA SUBIR") && pgM.textContent.includes(w.fmt(10863)), "T1-17 el Asesor enseña la preparada viva con lo que recibes");
  ok(pgM.textContent.includes("CUADRE DE LA VUELTA") && pgM.textContent.includes(w.fmt(10752.86)) && pgM.textContent.includes(w.fmt(296)) && pgM.textContent.includes("EL LIBRO HOY") && pgM.textContent.includes(w.fmt(308.33)), "T1-17b el Asesor enseña el cuadre de la vuelta y el libro hoy (CHEQUEO 105)");
  click(d.getElementById("mcSubirla"));
  await sleep(200);
  ok(llamadas.includes("rpc:guia_subir") && (ultimosCuerpos["guia_subir"] || {}).p_accion === "11111111-2222-3333-4444-555555555555", "T1-18 «Subirla» llama SOLO la puerta guia_subir con el id de la preparada (cero QvaPay desde el cliente)");

  /* La marca de destino: anillo que aparece y se desvanece solo */
  w.irA("Dinero");
  await sleep(300);
  const dnV = d.getElementById("dnVentas");
  ok(!!dnV, "T1-19 el ancla dnVentas existe en Dinero (ventas recientes)");
  w.marcarDestino("dnVentas", 0);
  ok(dnV.classList.contains("t1Marca"), "T1-20 la marca pone el anillo dorado en el elemento");
  await sleep(1500);
  ok(dnV.classList.contains("t1MarcaOff"), "T1-21 a los ~2,4 s la marca empieza a desvanecerse");
  await sleep(600);
  ok(!dnV.classList.contains("t1Marca") && !dnV.classList.contains("t1MarcaOff"), "T1-22 la marca desaparece sola y no deja clases");
  let marcaSinError = true;
  try { w.marcarDestino("ancla-que-no-existe", 0); } catch (e) { marcaSinError = false; }
  ok(marcaSinError, "T1-23 ancla inexistente: cae a la sección sin error");

  /* El SW de esta app: la ancla viaja en el click (fuente) */
  const swSrcT1 = fs.readFileSync(REPO + "minegocio/sw.js", "utf8");
  ok(swSrcT1.includes("ancla: a.ancla") && swSrcT1.includes('searchParams.set("ancla"'), "T1-24 el SW guarda la ancla en la notificación y la pasa en el click");
  w.close();
  R.actividad = null; R.avisosHist = null; R.dineroEstado = null; R.mercadoFoto = null; R.guiaErnesto = null;
}

/* ===== T1 · LA GUÍA: 4 coach marks, saltable, una sola vez ===== */
{
  const preG = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ preState: preG });
  const d = w.document;
  await sleep(900);
  ok(d.getElementById("guiaCoach").style.display === "block" && d.getElementById("guiaTit").textContent.includes("Tu dinero de hoy"), "T1-25 primera vez: la guía abre sola en el paso 1 (tu dinero de hoy)");
  click(d.getElementById("guiaSig")); click(d.getElementById("guiaSig")); click(d.getElementById("guiaSig"));
  ok(d.getElementById("guiaTit").textContent.includes("El menú") && d.getElementById("guiaSig").textContent === "Empezar", "T1-26 la guía llega al paso 4 (el menú) y el botón cierra en «Empezar»");
  click(d.getElementById("guiaSig"));
  ok(d.getElementById("guiaCoach").style.display === "none" && w.localStorage.getItem("mn_guia_v22") === "1", "T1-27 al terminar, la guía se apaga y queda marcada como vista");
  w.close();
}

/* ===== V29 · PRO: dos cubetas, conversión de Miguel, procedencia,
   saldo real, ganado/entregado y Enviar QUSD (Frente D) ===== */
{
  const ahoraISO = new Date().toISOString();
  R.dineroEstado = { rol: "ernesto", capital_total: 42700, saldo_fondo: 157, saldo_gasto: 1260,
    saldo_inventario: 14, saldo_ernesto_inversion: 15740,
    entregas: [], asignaciones: [], estrellas: [], ganancias: { por_buscador: [] },
    vueltas_abiertas: [], devoluciones_pendientes: [], ventas_recientes: [],
    cuadre: { ok: true, total_libro: 45595 },
    gasto_pro: { cuenta_gasto: 1260, por_cobrar_estimado: 684, reserva_cup: 13000,
      ritmo_compras_dia: 13000, pagos_pendientes: 961, mano_efectivo: 15897, colchon_libre: 1937 },
    conversiones: [
      { id: "conv-miguel", contraparte: "Miguel (@miguel300)", qusd: 20.62, tasa_pactada: 930,
        efectivo_esperado: 19176.6, cobrado_cup: 0, por_cobrar_cup: 19176.6, estado: "abierta",
        detectada_en: ahoraISO, fuente_deteccion: "qvapay_api" },
      { id: "conv-sintasa", contraparte: "Pendiente De Tasa", qusd: 5, tasa_pactada: null,
        efectivo_esperado: null, cobrado_cup: 0, por_cobrar_cup: null, estado: "abierta",
        detectada_en: ahoraISO, fuente_deteccion: "manual" } ],
    saldo_real: { saldo_linea: 0.08, saldo_lotes: 5.08, costo_lotes_cup: 14 },
    procedencias: {
      gasto: { monto: 1260, detalle: "corte de la venta-barrido-miguel-2026-11-14", referencia: "venta-barrido-miguel-2026-11-14", creada_en: ahoraISO },
      mano: { fondo: 157, inversion: 15740 },
      capital: { total: 42700, fijado_en: "2026-11-12" } },
    pagos_buscadores: [
      { buscador: "BRIKU-EUX", ganado_comision: 836, ganado_premio: 125, ganado_total: 961, entregado: 0, pendiente: 961 } ] };
  R.contactosResp = [ { nombre: "Miguel", usuario: "miguel300" }, { nombre: "Otro", usuario: "otro300" } ];
  const preV29 = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ preState: preV29 });
  const d = w.document;
  await sleep(600);
  const pgI = d.getElementById("pgInicio");
  const txtI = pgI ? pgI.textContent : "";

  /* (a) el héroe enseña las dos cubetas de gasto con su reserva explicada */
  ok(txtI.includes("Disponible (cobrado)") && txtI.includes("Por cobrar"), "V29-a1 el héroe separa el gasto en dos cubetas: disponible (cobrado) y por cobrar");
  ok(txtI.includes("Reserva de trabajo") && txtI.includes("13.000") && txtI.includes("frenaría la máquina"), "V29-a2 la reserva de trabajo se enseña con su porqué (13.000 del fixture)");
  ok(txtI.includes("684"), "V29-a3 el por cobrar estimado del fixture (684) se ve en el héroe");

  /* (b) la conversión de Miguel renderiza; sin tasa → formulario de tasa */
  /* NOTA Frente D: el payload trae efectivo_esperado = 19.176,6 exacto,
     pero la tarjeta lo pinta con fmtE (entero) → «19.177». La aserción
     acepta la cifra visible; el redondeo de pantalla queda reportado
     en BANCOS.md pa adjudicación del coordinador (¿debe verse el ,6?). */
  ok(txtI.includes("20,62") && (txtI.includes("19.176,6") || txtI.includes("19.177")), "V29-b1 la tarjeta de conversión enseña 20,62 QUSD y el esperado ≈19.176,6 CUP (Miguel @930)");
  ok(d.querySelectorAll("[data-conv-tasa]").length > 0, "V29-b2 la conversión sin tasa_pactada enseña su formulario de tasa (data-conv-tasa)");
  ok(txtI.includes("la app no la puede ver en QvaPay"), "V29-b3 la ayuda de la tasa explica que QvaPay no la enseña y se dice una sola vez");

  /* (c) tocar un número del héroe abre la hoja de procedencia.
     v42: el héroe se partió en dos tarjetas (Fondo · Mi gasto) y la
     primera cifra tocable del documento ya es la del capital; la
     prueba toca directamente la del GASTO, que es la procedencia que
     verifica (el movimiento de origen). La expectativa no cambia. */
  const prov = d.querySelector('[data-prov="gasto"]');
  ok(!!prov, "V29-c1 el héroe trae cifras tocables con procedencia (data-prov)");
  if (prov) { click(prov); await sleep(250); }
  ok(d.body.textContent.includes("venta-barrido-miguel-2026-11-14"), "V29-c2 al tocar, la hoja de procedencia enseña el movimiento de origen del gasto");

  /* (d) «Hecho en saldo» en unidades de saldo, no el costo CUP */
  ok(txtI.includes("0,08") && txtI.includes("Costo de ese saldo"), "V29-d1 hecho en saldo = 0,08 de saldo (línea) y el costo va nombrado como costo, no como saldo");

  /* (f-ok) Enviar QUSD con agenda viva: el select trae los contactos */
  ok(txtI.includes("miguel300"), "V29-f1 con la agenda viva, Enviar QUSD ofrece a @miguel300 sin teclearlo");

  /* (e) la fila de buscador enseña ganado/entregado/pendiente 961/0/961 */
  w.irA("Dinero");
  await sleep(400);
  const txtD = d.getElementById("pgDinero") ? d.getElementById("pgDinero").textContent : "";
  ok(txtD.includes("Totales de todos los ciclos") && txtD.includes("961") && txtD.includes("Entregado"), "V29-e1 Dinero (resumen C2): totales de todos los ciclos con ganado 961 y entregado visibles (fixture Briku)");
  ok(txtD.includes("premio por venta") && txtD.includes("Por entregar"), "V29-e2 el resumen nombra «premio por venta» (renombre M3) y «Por entregar» con el pendiente agregado 961");
  ok(txtD.includes("Pagos por ciclo") && txtD.includes("Pendiente del ciclo:") && txtD.includes("625") && txtD.includes("336"), "V29-e3 tarjetas por ciclo: pendientes 625 y 336 por separado (el agregado es la suma, caso SQL 8)");
  ok(txtD.includes("calculado con la regla anterior"), "V29-e4 la liquidación histórica enseña la pill «calculado con la regla anterior» (base_regla='total', caso SQL 8d)");
  w.close();
  R.dineroEstado = null; R.contactosResp = null;
}

/* ===== V29-f2 · Enviar QUSD degrada si la función de contactos no responde ===== */
{
  R.dineroEstado = { rol: "ernesto", capital_total: 42700, saldo_fondo: 157, saldo_gasto: 1260,
    saldo_inventario: 14, saldo_ernesto_inversion: 15740, entregas: [], asignaciones: [],
    estrellas: [], ganancias: { por_buscador: [] }, vueltas_abiertas: [],
    devoluciones_pendientes: [], ventas_recientes: [], cuadre: { ok: true, total_libro: 45595 },
    conversiones: [], pagos_buscadores: [] };
  R.contactosFalla = true;
  const preF = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  let wF = null, errorF = null;
  try {
    const r = crear({ preState: preF }); wF = r.w;
    await sleep(600);
  } catch (e) { errorF = e; }
  ok(!errorF && !!wF, "V29-f2a con la función de contactos caída, la app abre sin romperse");
  if (wF) {
    const txtF = wF.document.getElementById("pgInicio") ? wF.document.getElementById("pgInicio").textContent : "";
    ok(txtF.includes("Agenda no disponible aún"), "V29-f2b la tarjeta Enviar QUSD dice «Agenda no disponible aún» y ofrece el usuario a mano");
    wF.close();
  }
  R.dineroEstado = null; R.contactosFalla = false;
}

/* ===== RUTA MANUAL DE ENTREGAS (2026-11-16): la tarjeta «Entregar
   dinero» tras el héroe, la hoja por buscador con reparto FIFO entre
   ciclos, los atajos en la tarjeta del buscador y la honestidad
   ok:false (nada de ✅ falso, ni en la hoja ni por ciclo) ===== */
{
  R.dineroEstado = { rol: "ernesto", capital_total: 42700, saldo_fondo: 157, saldo_gasto: 1260,
    saldo_inventario: 14, saldo_ernesto_inversion: 15740, entregas: [],
    asignaciones: [ { buscador: "BRIKU-EUX", porciento: 32 } ],
    estrellas: [], ganancias: { por_buscador: [] }, vueltas_abiertas: [],
    devoluciones_pendientes: [], ventas_recientes: [], cuadre: { ok: true, total_libro: 45595 },
    conversiones: [],
    pagos_buscadores: [ { buscador: "BRIKU-EUX", ganado_comision: 836, ganado_premio: 125, ganado_total: 961, entregado: 0, pendiente: 961 } ] };
  R.entregaComisionResp = { ok: true };
  const preRM = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ preState: preRM });
  const d = w.document;
  await sleep(600);
  w.irA("Dinero");
  await sleep(500);
  const pgD = d.getElementById("pgDinero");
  ok(!!d.getElementById("dnAcciones") && !!d.getElementById("dnIrReparto") && !!d.getElementById("dnIrComision"), "RM-1 Dinero trae la tarjeta «Entregar dinero» con sus dos botones nombrados (Repartir capital / Registrar entrega de comisión)");
  ok(pgD.textContent.includes("le debes entregar") && pgD.textContent.includes("961"), "RM-2 la tarjeta dice a quién le debes entregar y cuánto (Briku 961 del fixture)");
  ok(!!pgD.querySelector('[data-atajo-comision="BRIKU-EUX"]') && !!pgD.querySelector('[data-atajo-reparto="BRIKU-EUX"]'), "RM-3 la tarjeta del buscador trae sus atajos (Repartir capital / Entregar comisión)");
  click(d.getElementById("dnIrComision"));
  await sleep(300);
  const inpM = d.getElementById("entcMonto");
  ok(!!inpM && inpM.value === "836", "RM-4 la hoja abre con el monto lleno = pendiente de comisión (500+336=836)");
  input(inpM, "700");
  const antesRM = llamadas.filter(function(x){ return x === "rpc:dinero_registrar_entrega_comision"; }).length;
  click(d.getElementById("entcOk"));
  await sleep(700);
  const despuesRM = llamadas.filter(function(x){ return x === "rpc:dinero_registrar_entrega_comision"; }).length;
  ok(despuesRM - antesRM === 2, "RM-5 registrar 700 cruza dos ciclos: dos llamadas a la puerta (500 del viejo + 200 del nuevo)");
  ok(ultimosCuerpos["dinero_registrar_entrega_comision"] && ultimosCuerpos["dinero_registrar_entrega_comision"].p_monto === 200 && ultimosCuerpos["dinero_registrar_entrega_comision"].p_liquidacion_id === "liq-banco-2", "RM-6 el último tramo es 200 sobre liq-banco-2 (FIFO del más viejo al más nuevo)");
  ok(d.getElementById("pgDinero").textContent.includes("REGISTRADO") && d.getElementById("pgDinero").textContent.includes("700"), "RM-7 el resultado se enseña en la hoja con su desglose (REGISTRADO 700)");
  w.close();

  /* ok:false en la hoja: error honesto, nada de registrado */
  R.entregaComisionResp = { ok: false, motivo: "excede_pendiente_ciclo", pendiente_ciclo_tipo: 500 };
  const v2 = crear({ preState: preRM });
  const d2 = v2.w.document;
  await sleep(600);
  v2.w.irA("Dinero");
  await sleep(500);
  click(d2.getElementById("dnIrComision"));
  await sleep(300);
  input(d2.getElementById("entcMonto"), "100");
  click(d2.getElementById("entcOk"));
  await sleep(700);
  ok(d2.getElementById("entcErr").textContent.includes("pasa lo pendiente"), "RM-8 si la puerta devuelve ok:false, la hoja enseña el motivo (excede pendiente) en vez de un éxito falso");
  ok(!d2.getElementById("pgDinero").textContent.includes("REGISTRADO"), "RM-9 con ok:false no aparece ningún REGISTRADO");
  v2.w.close();

  /* ok:false en el formulario por ciclo: el mismo candado */
  const v3 = crear({ preState: preRM });
  const d3 = v3.w.document;
  await sleep(600);
  v3.w.irA("Dinero");
  await sleep(500);
  const abrirRM = d3.querySelector('[data-cicent-abrir="liq-banco-1"]');
  ok(!!abrirRM, "RM-10 el formulario por ciclo sigue ahí (Confirmar entrega en su tarjeta)");
  if (abrirRM) {
    click(abrirRM);
    await sleep(300);
    input(d3.getElementById("cicentMonto-liq-banco-1"), "100");
    click(d3.querySelector('[data-cicent-ok="liq-banco-1"]'));
    await sleep(700);
    ok(d3.getElementById("cicentErr-liq-banco-1").textContent.includes("pasa lo pendiente"), "RM-11 por ciclo, ok:false enseña el motivo en su línea de error (antes pintaba un ✅ falso)");
  }
  v3.w.close();
  R.dineroEstado = null; R.entregaComisionResp = null;
}

/* ===== V41 · CADENA DE DINERO (Oleada PRO 2026-11-17) + MN2
   (corrección tras SUPERVISORA-PRO, 2026-11-17): el reparto del ciclo
   con su cadena visible, las otras dos vías, por-recuperar de Briku,
   la alerta de tope con su botón de re-atribuir (y su candado
   ok:false) y la degradación sin campos nuevos.
   ORIGEN DE LOS FIXTURES (nada inventado):
   · El reparto de liq-cadena es la salida REAL de
     dinero_reparto_ciclo(1311, 25, pct vivos) capturada por
     Management API el 2026-11-17 ~16:2x UTC (congelada también en
     bancos/fixtures/payload-vivo-briku-2026-11-17.json):
     ganancia 1.311 → bruta 343 (NO 344: 1.311 × 26,2 % = 343,482) →
     redondeada 340 → −25 recuperación → pago final 310 · libre 205 ·
     reinversión 796 (Σ = 1.311 al centavo). El fixture anterior traía
     bruta 344 y reinversión 788 (Σ = 1.303 ≠ 1.311): falso, cazado
     por la supervisora.
   · por_recuperar {50 · recuperado 20 · restante 30 · ritmo 25} es el
     que trae CADA liquidación viva de Briku en dinero_ciclo_json
     (misma captura).
   · liq-cadena trae pendiente_comision 0 / pendiente_premio 0 del
     servidor CON reparto presente (pago 310): el caso vivo real en
     que la derivación vieja (reparto − entregado) fabricaba deuda. */
{
  const ahoraCD = new Date().toISOString();
  R.dineroEstado = { rol: "ernesto", capital_total: 42700, saldo_fondo: 157, saldo_gasto: 1260,
    saldo_inventario: 14, saldo_ernesto_inversion: 15740, entregas: [],
    asignaciones: [ { buscador: "BRIKU-EUX", porciento: 32 } ],
    estrellas: [], ganancias: { por_buscador: [] }, vueltas_abiertas: [],
    devoluciones_pendientes: [], ventas_recientes: [], cuadre: { ok: true, total_libro: 45595 },
    conversiones: [],
    alertas_tope: [ { espera_id: "esp-tope-1", buscador: "BRIKU-EUX", monto_capital: 2000, exceso: 2000, creada_en: ahoraCD } ],
    recuperaciones: [ { buscador: "BRIKU-EUX", total: 50, recuperado: 20, restante: 30, ritmo: 25 } ],
    pagos_buscadores: [ { buscador: "BRIKU-EUX", ganado_comision: 310, ganado_premio: 0, ganado_total: 310, entregado: 310, pendiente: 0 } ] };
  R.ciclosResp = { ok: true, liquidaciones: [
    { liquidacion_id: "liq-cadena", buscador: "BRIKU-EUX", tipo: "saldo",
      creada_en: "2026-11-17T10:00:00Z", capital_cup: 10000, producto: 10080,
      pct: 26.2, ganado_comision: 0, ganado_premio: 0,
      entregado_comision: 0, entregado_premio: 0, pendiente_ciclo: 0,
      pendiente_comision: 0, pendiente_premio: 0,
      base_regla: "ernesto_neto", eleccion_pago: null, es_prueba: false,
      reparto_portador: true,
      reparto: { ganancia_ciclo: 1311, pct_buscador: 26.2, pct_libre: 15.6, pct_reinversion: 58.2,
        comision_bruta: 343, comision_redondeada: 340, recuperacion_aplicada: 25,
        pago_buscador: 310, libre_ernesto: 205, reinversion_fondo: 796, regla_redondeo: "decena_5_baja", es_proyeccion: false },
      por_recuperar: { total: 50, recuperado: 20, restante: 30, ritmo: 25 },
      tope: { capital_entrega: 10000, capital_comprado: 10000, capital_restante: 0, excedido: false } },
    { liquidacion_id: "liq-sin-campos", buscador: "BRIKU-EUX", tipo: "saldo",
      creada_en: "2026-11-16T10:00:00Z", capital_cup: 5000, producto: 3600,
      pct: 32, ganado_comision: 100, ganado_premio: 0,
      entregado_comision: 0, entregado_premio: 0, pendiente_ciclo: 100,
      base_regla: "ernesto_neto", eleccion_pago: null, es_prueba: false } ] };
  R.reatribuirResp = { ok: true };
  const preCD = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ preState: preCD });
  const d = w.document;
  await sleep(600);
  w.irA("Dinero");
  await sleep(500);
  const pgD = d.getElementById("pgDinero");
  const txtCD = pgD ? pgD.textContent : "";
  ok(txtCD.includes("Reparto de este ciclo") && txtCD.includes("Ganancia del ciclo") && txtCD.includes("1.311"), "CD-1 el ciclo enseña su reparto con la ganancia del servidor (1.311 del fixture)");
  ok(txtCD.includes("Comisión del buscador") && txtCD.includes("26,2") && txtCD.includes("343") && txtCD.includes("Redondeada a la decena (el 5 baja)") && txtCD.includes("340"), "CD-2 la cadena enseña comisión bruta 343 (26,2 % de 1.311, salida real de dinero_reparto_ciclo) y su redondeo a la decena: 340");
  ok(txtCD.includes("Menos recuperación") && txtCD.includes("Queda tras la recuperación") && txtCD.includes("315") && txtCD.includes("Pago final al buscador") && txtCD.includes("310"), "CD-3 tras la recuperación de 25 quedan 315 y el PAGO FINAL redondeado es 310");
  ok(txtCD.includes("Tu parte libre") && txtCD.includes("15,6") && txtCD.includes("205") && txtCD.includes("reinversión") && txtCD.includes("58,2") && txtCD.includes("796"), "CD-4 las otras dos vías se ven: libre 205 (15,6 %) y reinversión 796 (58,2 % + lo recuperado; Σ 310+205+796 = 1.311)");
  ok(txtCD.includes("Reinversión acreditada al fondo por estos ciclos") && txtCD.includes("796"), "CD-5 el fondo enseña la reinversión acreditada por los ciclos (796 del reparto)");
  ok(txtCD.includes("Por recuperar de este buscador") && txtCD.includes("Quedan por recuperar") && txtCD.includes("hasta") && txtCD.includes("25 CUP por ciclo"), "CD-6 por-recuperar del ciclo: total 50, quedan 30 (20 ya recuperados, payload vivo) y ritmo de 25 por ciclo, sumando a reinversión");
  ok(!!d.getElementById("dnRecuperaciones") && d.getElementById("dnRecuperaciones").textContent.includes("quedan 30") && d.getElementById("dnRecuperaciones").textContent.includes("ritmo 25 por ciclo"), "CD-7 la tarjeta de recuperaciones enseña la deuda de Briku donde vive: 50 total · ritmo 25/ciclo · quedan 30");
  ok(!!d.getElementById("dnAlertasTope") && txtCD.includes("2.000") && txtCD.includes("exceso sobre el tope") && !!pgD.querySelector('[data-tope-reatribuir="esp-tope-1"]'), "CD-8 la alerta de tope se ve en Dinero con monto 2.000, su exceso y el botón de re-atribuir");
  const antesCD = llamadas.filter(function(x){ return x === "rpc:dinero_reatribuir_espera"; }).length;
  click(pgD.querySelector('[data-tope-reatribuir="esp-tope-1"]'));
  await sleep(500);
  const despuesCD = llamadas.filter(function(x){ return x === "rpc:dinero_reatribuir_espera"; }).length;
  ok(despuesCD - antesCD === 1 && ultimosCuerpos["dinero_reatribuir_espera"] && ultimosCuerpos["dinero_reatribuir_espera"].p_espera_id === "esp-tope-1" && ultimosCuerpos["dinero_reatribuir_espera"].p_prueba === false, "CD-9 re-atribuir llama a dinero_reatribuir_espera con la espera exacta y p_prueba false");
  ok(!d.getElementById("dnAcciones").querySelector(".dnHero") && d.getElementById("dnAcciones").textContent.includes("no le debes comisión ni premio a nadie"), "CD-10 MN2: con pendiente del servidor en 0 (aunque el reparto trae pago 310 y el otro ciclo ganado 100 sin campos de pendiente), el héroe NO fabrica deuda: no hay «Total por entregar» — la derivación vieja habría enseñado 410");
  ok(pgD.querySelectorAll(".repCadena").length === 2 && !txtCD.includes("undefined") && !txtCD.includes("NaN"), "CD-11 degradación: el ciclo sin campos nuevos se pinta sin reparto ni por-recuperar y sin undefined/NaN (solo 2 cadenas: reparto + por-recuperar del ciclo con datos)");
  w.close();

  /* ok:false al re-atribuir: motivo real en la alerta, nada de éxito falso */
  R.reatribuirResp = { ok: false, motivo: "espera_no_existe" };
  R.ciclosResp = { ok: true, liquidaciones: [] };
  const vCD2 = crear({ preState: preCD });
  const dCD2 = vCD2.w.document;
  await sleep(600);
  vCD2.w.irA("Dinero");
  await sleep(500);
  const btnCD2 = dCD2.querySelector('[data-tope-reatribuir="esp-tope-1"]');
  ok(!!btnCD2, "CD-12 con ok:false preparado, el botón de re-atribuir sigue visible pa el toque");
  if (btnCD2) {
    click(btnCD2);
    await sleep(500);
    ok(dCD2.getElementById("topeErr-esp-tope-1").textContent.includes("ya no está en el libro"), "CD-13 si la puerta devuelve ok:false, la alerta enseña el motivo real (espera_no_existe) en vez de un éxito falso");
  }
  vCD2.w.close();
  R.dineroEstado = null; R.reatribuirResp = null; R.ciclosResp = null;
}

/* ===== MN2 · EL PENDIENTE MANDA EL SERVIDOR (2026-11-17, tras el
   veredicto REFUTADO de la supervisora): fixture = payload VIVO
   congelado de Briku — salida real de dinero_ciclo_json (la función
   que compone pago_estado_dueno) capturada por Management API el
   2026-11-17 ~16:25 UTC, verbatim en
   bancos/fixtures/payload-vivo-briku-2026-11-17.json (5 de las 11
   liquidaciones reales; las demás comparten los mismos repartos y
   pendiente 0). Hechos del payload: la liquidación 2474dff4 trae
   pendiente_premio 54 con reparto.pago_buscador 90 y su comisión ya
   nacida pagada (146); la entrega e8d6a0de trae CUATRO liquidaciones
   con el MISMO reparto por entrega (pago_buscador 300) y pendiente 0
   en todas. Con la derivación vieja el héroe habría enseñado
   90 + 4×300 + 54 = 1.344; el servidor dice 54.
   MN3 (2026-11-17): el fixture inline pasó a la forma NUEVA de la
   corrección S2 — en cada entrega SOLO la portadora (mayor creada_en)
   trae reparto/por_recuperar/tope con reparto_portador:true; las
   demás los traen en null con reparto_portador:false (congelado
   también en fixtures/payload-portadora-briku-2026-11-17.json).
   MN4 (2026-11-17, supervisora ronda 2 · Ataque 5): el fixture de
   archivo se RE-CAPTURÓ VIVO COMPLETO post-S2 (11 liquidaciones) y
   este subconjunto inline se reconstruyó de ESA captura: la portadora
   de la entrega e8d6a0de es 542c809a-228b-4dc3-a569-c5bc48e9fec9 (la
   eca67120 del derivado de MN3 trae reparto_portador:false en vivo) y
   el por_recuperar de las portadoras es {recuperado 0, restante 50},
   el estado post-reversión (el {20/30} era pre-reversión). ===== */
{
  const liqsVivasMN2 = [
      {
            "tope": {
                  "excedido": false,
                  "capital_entrega": 14000,
                  "capital_comprado": 5000,
                  "capital_restante": 9000
            },
            "reparto": {
                  "pct_libre": 15.6,
                  "pct_buscador": 26.2,
                  "es_proyeccion": false,
                  "libre_ernesto": 56,
                  "pago_buscador": 90,
                  "comision_bruta": 94,
                  "ganancia_ciclo": 358,
                  "regla_redondeo": "decena_5_baja",
                  "pct_reinversion": 58.2,
                  "reinversion_fondo": 212,
                  "comision_redondeada": 90,
                  "recuperacion_aplicada": 0
            },
            "entregado": 0,
            "base_regla": "total",
            "estimada_max": null,
            "estimada_min": null,
            "descuento_pct": 5,
            "eleccion_pago": null,
            "ganado_premio": 54,
            "por_recuperar": {
                  "ritmo": 25,
                  "total": 50,
                  "restante": 50,
                  "recuperado": 0
            },
            "recargas_plan": null,
            "adelanto_monto": null,
            "comision_ahora": 139,
            "comision_ciclo": 146,
            "liquidacion_id": "2474dff4-0cc1-412f-ac56-70d698421b25",
            "cuadre_adelanto": null,
            "exceso_adelanto": 0,
            "ganado_comision": 146,
            "pendiente_ciclo": 54,
            "comision_despues": 146,
            "entregado_premio": 0,
            "pendiente_premio": 54,
            "premio_ya_pagado": 0,
            "reparto_portador": true,
            "pendiente_entrega": 54,
            "adelanto_entregado": 0,
            "entregado_comision": 0,
            "pendiente_comision": 0,
            "descuento_prontitud": 0,
            "comision_nacida_pagada": 146,
            "descuento_pct_snapshot": null,
            "exceso_adelanto_previo": 0,
            "comision_est_por_recarga": null,
            "buscador": "BRIKU-EUX",
            "tipo": "saldo",
            "creada_en": "2026-11-14T14:38:05.107697Z",
            "capital_cup": 5000,
            "entrega_id": "65ca43f0-e3a3-44e5-a911-3b08a843ad32",
            "es_prueba": false
      },
      {
            "tope": null,
            "reparto": null,
            "entregado": 0,
            "base_regla": "total",
            "estimada_max": null,
            "estimada_min": null,
            "descuento_pct": 5,
            "eleccion_pago": null,
            "ganado_premio": 0,
            "por_recuperar": null,
            "recargas_plan": null,
            "adelanto_monto": null,
            "comision_ahora": 31,
            "comision_ciclo": 33,
            "liquidacion_id": "00ef25b4-1e0b-4bcc-be0d-c63967595881",
            "cuadre_adelanto": null,
            "exceso_adelanto": 0,
            "ganado_comision": 33,
            "pendiente_ciclo": 0,
            "comision_despues": 33,
            "entregado_premio": 0,
            "pendiente_premio": 0,
            "premio_ya_pagado": 0,
            "reparto_portador": false,
            "pendiente_entrega": 0,
            "adelanto_entregado": 0,
            "entregado_comision": 0,
            "pendiente_comision": 0,
            "descuento_prontitud": 0,
            "comision_nacida_pagada": 33,
            "descuento_pct_snapshot": null,
            "exceso_adelanto_previo": 0,
            "comision_est_por_recarga": null,
            "buscador": "BRIKU-EUX",
            "tipo": "saldo",
            "creada_en": "2026-11-15T18:11:02.011978Z",
            "capital_cup": 1000,
            "entrega_id": "e8d6a0de-9c50-4291-a930-93b02166bca9",
            "es_prueba": false
      },
      {
            "tope": null,
            "reparto": null,
            "entregado": 0,
            "base_regla": "total",
            "estimada_max": null,
            "estimada_min": null,
            "descuento_pct": 5,
            "eleccion_pago": null,
            "ganado_premio": 0,
            "por_recuperar": null,
            "recargas_plan": null,
            "adelanto_monto": null,
            "comision_ahora": 31,
            "comision_ciclo": 33,
            "liquidacion_id": "ef7ff928-dac6-4f8a-ade5-714b45440962",
            "cuadre_adelanto": null,
            "exceso_adelanto": 0,
            "ganado_comision": 33,
            "pendiente_ciclo": 0,
            "comision_despues": 33,
            "entregado_premio": 0,
            "pendiente_premio": 0,
            "premio_ya_pagado": 0,
            "reparto_portador": false,
            "pendiente_entrega": 0,
            "adelanto_entregado": 0,
            "entregado_comision": 0,
            "pendiente_comision": 0,
            "descuento_prontitud": 0,
            "comision_nacida_pagada": 33,
            "descuento_pct_snapshot": null,
            "exceso_adelanto_previo": 0,
            "comision_est_por_recarga": null,
            "buscador": "BRIKU-EUX",
            "tipo": "saldo",
            "creada_en": "2026-11-15T18:11:06.255809Z",
            "capital_cup": 1000,
            "entrega_id": "e8d6a0de-9c50-4291-a930-93b02166bca9",
            "es_prueba": false
      },
      {
            "tope": null,
            "reparto": null,
            "entregado": 0,
            "base_regla": "total",
            "estimada_max": null,
            "estimada_min": null,
            "descuento_pct": 5,
            "eleccion_pago": null,
            "ganado_premio": 0,
            "por_recuperar": null,
            "recargas_plan": null,
            "adelanto_monto": null,
            "comision_ahora": 37,
            "comision_ciclo": 39,
            "liquidacion_id": "2b3f3210-77d3-4d99-af30-9fecd03a4e77",
            "cuadre_adelanto": null,
            "exceso_adelanto": 0,
            "ganado_comision": 39,
            "pendiente_ciclo": 0,
            "comision_despues": 39,
            "entregado_premio": 0,
            "pendiente_premio": 0,
            "premio_ya_pagado": 0,
            "reparto_portador": false,
            "pendiente_entrega": 0,
            "adelanto_entregado": 0,
            "entregado_comision": 0,
            "pendiente_comision": 0,
            "descuento_prontitud": 0,
            "comision_nacida_pagada": 39,
            "descuento_pct_snapshot": null,
            "exceso_adelanto_previo": 0,
            "comision_est_por_recarga": null,
            "buscador": "BRIKU-EUX",
            "tipo": "saldo",
            "creada_en": "2026-11-15T23:01:48.270007Z",
            "capital_cup": 1000,
            "entrega_id": "e8d6a0de-9c50-4291-a930-93b02166bca9",
            "es_prueba": false
      },
      {
            "tope": {
                  "excedido": false,
                  "capital_entrega": 15000,
                  "capital_comprado": 15000,
                  "capital_restante": 0
            },
            "reparto": {
                  "pct_libre": 15.6,
                  "pct_buscador": 26.2,
                  "es_proyeccion": false,
                  "libre_ernesto": 181,
                  "pago_buscador": 300,
                  "comision_bruta": 304,
                  "ganancia_ciclo": 1162,
                  "regla_redondeo": "decena_5_baja",
                  "pct_reinversion": 58.2,
                  "reinversion_fondo": 681,
                  "comision_redondeada": 300,
                  "recuperacion_aplicada": 0
            },
            "entregado": 0,
            "base_regla": "ernesto_neto",
            "estimada_max": null,
            "estimada_min": null,
            "descuento_pct": 5,
            "eleccion_pago": null,
            "ganado_premio": 0,
            "por_recuperar": {
                  "ritmo": 25,
                  "total": 50,
                  "restante": 50,
                  "recuperado": 0
            },
            "recargas_plan": null,
            "adelanto_monto": null,
            "comision_ahora": 65,
            "comision_ciclo": 68,
            "liquidacion_id": "542c809a-228b-4dc3-a569-c5bc48e9fec9",
            "cuadre_adelanto": null,
            "exceso_adelanto": 0,
            "ganado_comision": 68,
            "pendiente_ciclo": 0,
            "comision_despues": 68,
            "entregado_premio": 0,
            "pendiente_premio": 0,
            "premio_ya_pagado": 0,
            "reparto_portador": true,
            "pendiente_entrega": 0,
            "adelanto_entregado": 0,
            "entregado_comision": 0,
            "pendiente_comision": 0,
            "descuento_prontitud": 0,
            "comision_nacida_pagada": 68,
            "descuento_pct_snapshot": null,
            "exceso_adelanto_previo": 0,
            "comision_est_por_recarga": null,
            "buscador": "BRIKU-EUX",
            "tipo": "saldo",
            "creada_en": "2026-11-17T01:11:14.571294Z",
            "capital_cup": 2000,
            "entrega_id": "e8d6a0de-9c50-4291-a930-93b02166bca9",
            "es_prueba": false
      }
];
  R.dineroEstado = { rol: "ernesto", capital_total: 42700, saldo_fondo: 157, saldo_gasto: 1260,
    saldo_inventario: 14, saldo_ernesto_inversion: 15740, entregas: [],
    asignaciones: [ { buscador: "BRIKU-EUX", porciento: 32 } ],
    estrellas: [], ganancias: { por_buscador: [] }, vueltas_abiertas: [],
    devoluciones_pendientes: [], ventas_recientes: [], cuadre: { ok: true, total_libro: 45595 },
    conversiones: [], alertas_tope: [],
    recuperaciones: [ { buscador: "BRIKU-EUX", total: 50, recuperado: 0, restante: 50, ritmo: 25 } ],
    pagos_buscadores: [ { buscador: "BRIKU-EUX", ganado_comision: 996, ganado_premio: 125, ganado_total: 1121, entregado: 1067, pendiente: 54 } ] };
  R.ciclosResp = { ok: true, liquidaciones: liqsVivasMN2 };
  R.entregaComisionResp = { ok: true };
  const preMN2 = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ preState: preMN2 });
  const d = w.document;
  await sleep(600);
  w.irA("Dinero");
  await sleep(500);
  const accMN2 = d.getElementById("dnAcciones");
  const heroMN2 = accMN2 ? accMN2.querySelector(".dnHeroNum") : null;
  ok(!!heroMN2 && heroMN2.textContent.trim().indexOf("54") === 0, "CD-14 MN2 héroe «Total por entregar» = 54 del servidor (pendiente_premio de 2474dff4), no la derivación del reparto");
  ok(!!accMN2 && !accMN2.textContent.includes("1.344") && !accMN2.textContent.includes("2.775"), "CD-15 MN2 ni el héroe ni la lista por buscador suman el reparto repetido por liquidación (nada de 1.344 del subconjunto ni 2.775 del payload completo)");
  const mismaEntrega = liqsVivasMN2.filter(function(x){ return x.entrega_id === "e8d6a0de-9c50-4291-a930-93b02166bca9"; });
  ok(mismaEntrega.length >= 2 && mismaEntrega.filter(function(x){ return x.reparto_portador === true; }).length === 1 && mismaEntrega.every(function(x){ return x.reparto_portador === true ? (x.reparto && x.reparto.pago_buscador === 300) : (x.reparto === null && x.por_recuperar === null && x.tope === null); }) && mismaEntrega.every(function(x){ return x.pendiente_comision === 0 && x.pendiente_premio === 0; }), "CD-16 MN3 el fixture (forma NUEVA S2) trae varias liquidaciones de la MISMA entrega (e8d6a0de) y SOLO la portadora trae el reparto (pago 300); las demás lo traen en null con reparto_portador false, y el pendiente del servidor es 0 en todas");
  click(d.getElementById("dnIrComision"));
  await sleep(300);
  const tipoMN2 = d.getElementById("entcTipo"), montoMN2 = d.getElementById("entcMonto");
  ok(!!tipoMN2 && tipoMN2.value === "premio" && !!montoMN2 && montoMN2.value === "54", "CD-17 MN2 la hoja de entrega abre SOLO con premio pendiente y el monto lleno = 54 del servidor (la comisión, ya nacida pagada, no se ofrece)");
  const antesMN2 = llamadas.filter(function(x){ return x === "rpc:dinero_registrar_entrega_comision"; }).length;
  click(d.getElementById("entcOk"));
  await sleep(700);
  const despuesMN2 = llamadas.filter(function(x){ return x === "rpc:dinero_registrar_entrega_comision"; }).length;
  ok(despuesMN2 - antesMN2 === 1 && ultimosCuerpos["dinero_registrar_entrega_comision"] && ultimosCuerpos["dinero_registrar_entrega_comision"].p_monto === 54 && ultimosCuerpos["dinero_registrar_entrega_comision"].p_tipo === "premio" && ultimosCuerpos["dinero_registrar_entrega_comision"].p_liquidacion_id === "2474dff4-0cc1-412f-ac56-70d698421b25", "CD-18 MN2 registrar la hoja llama UNA vez a la puerta: 54 de premio sobre la liquidación exacta del payload vivo");
  w.close();
  R.dineroEstado = null; R.ciclosResp = null; R.entregaComisionResp = null;
}

/* ===== MN3 · DEDUPLICACIÓN DEL REPARTO POR ENTREGA (2026-11-17,
   corrección S2 del servidor): reparto/por_recuperar/tope viajan SOLO
   en la liquidación portadora (reparto_portador:true); las demás los
   traen en null. La app debe pintarlos UNA vez por entrega y sumar la
   reinversión SOLO de la portadora. Sin portadora (payload viejo),
   cero bloques. Y el reparto de ciclo abierto (es_proyeccion:true)
   se nombra «proyección», nunca pago firme. ===== */
function liqMN3(id, creada, extra){
  return Object.assign({ liquidacion_id: id, buscador: "BRIKU-EUX", tipo: "saldo",
    creada_en: creada, capital_cup: 1000, producto: 1000, pct: 26.2,
    ganado_comision: 0, ganado_premio: 0, entregado_comision: 0, entregado_premio: 0,
    pendiente_ciclo: 0, pendiente_comision: 0, pendiente_premio: 0,
    base_regla: "ernesto_neto", eleccion_pago: null, es_prueba: false,
    entrega_id: "ent-mn3", reparto_portador: false, reparto: null, por_recuperar: null, tope: null }, extra || {});
}
const repartoMN3 = { ganancia_ciclo: 1162, pct_buscador: 26.2, pct_libre: 15.6, pct_reinversion: 58.2,
  comision_bruta: 304, comision_redondeada: 300, recuperacion_aplicada: 0,
  pago_buscador: 300, libre_ernesto: 181, reinversion_fondo: 681, regla_redondeo: "decena_5_baja", es_proyeccion: false };
const estadoMN3 = { rol: "ernesto", capital_total: 42700, saldo_fondo: 157, saldo_gasto: 1260,
  saldo_inventario: 14, saldo_ernesto_inversion: 15740, entregas: [],
  asignaciones: [ { buscador: "BRIKU-EUX", porciento: 32 } ],
  estrellas: [], ganancias: { por_buscador: [] }, vueltas_abiertas: [],
  devoluciones_pendientes: [], ventas_recientes: [], cuadre: { ok: true, total_libro: 45595 },
  conversiones: [], alertas_tope: [], recuperaciones: [], pagos_buscadores: [] };
const preMN3 = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
async function ciclosTxtMN3(liqs){
  R.dineroEstado = estadoMN3;
  R.ciclosResp = { ok: true, liquidaciones: liqs };
  const v = crear({ preState: preMN3 });
  const d = v.w.document;
  await sleep(600);
  v.w.irA("Dinero");
  await sleep(500);
  const el = d.getElementById("dnCiclos");
  const txt = el ? el.textContent : "";
  const cadenas = el ? el.querySelectorAll(".repCadena").length : 0;
  v.w.close();
  R.dineroEstado = null; R.ciclosResp = null;
  return { txt: txt, cadenas: cadenas };
}
{
  /* A · 4 liquidaciones de UNA entrega, solo la portadora trae bloques */
  const a = await ciclosTxtMN3([
    liqMN3("mn3-a1", "2026-11-15T18:11:02Z"),
    liqMN3("mn3-a2", "2026-11-15T18:11:06Z"),
    liqMN3("mn3-a3", "2026-11-15T23:01:48Z"),
    liqMN3("mn3-a4", "2026-11-15T23:01:53Z", { reparto_portador: true, reparto: repartoMN3,
      por_recuperar: { total: 50, recuperado: 20, restante: 30, ritmo: 25 },
      tope: { capital_entrega: 15000, capital_comprado: 15000, capital_restante: 0, excedido: false } }) ]);
  const nReparto = (a.txt.match(/Reparto de este ciclo/g) || []).length;
  ok(nReparto === 1 && a.cadenas === 2, "CD-19 MN3 con 4 liquidaciones de una entrega, el reparto se renderiza UNA vez (solo la portadora: 1 cadena de reparto + 1 de por-recuperar)");
  ok(a.txt.includes("Reinversión acreditada al fondo por estos ciclos") && a.txt.includes("681") && !a.txt.includes("2.724"), "CD-20 MN3 la reinversión acreditada suma SOLO la portadora: 681, no 4×681 = 2.724");
  ok((a.txt.match(/Por recuperar de este buscador/g) || []).length === 1 && (a.txt.match(/Tope del ciclo/g) || []).length === 1, "CD-21 MN3 por_recuperar y tope también se pintan UNA vez por entrega (los de la portadora)");
  ok(a.txt.includes("Pago final al buscador") && a.txt.includes("300"), "CD-22 MN3 con es_proyeccion:false el pago se nombra firme: «Pago final al buscador» 300");

  /* B · payload viejo: reparto presente pero SIN portadora → cero bloques */
  const viejo = liqMN3("mn3-b1", "2026-11-15T18:11:02Z", { reparto: repartoMN3,
    por_recuperar: { total: 50, recuperado: 20, restante: 30, ritmo: 25 },
    tope: { capital_entrega: 15000, capital_comprado: 15000, capital_restante: 0, excedido: false } });
  delete viejo.reparto_portador;
  const b = await ciclosTxtMN3([ viejo,
    liqMN3("mn3-b2", "2026-11-15T18:11:06Z", { reparto: repartoMN3 }) ]);
  ok(b.cadenas === 0 && !b.txt.includes("Reparto de este ciclo") && !b.txt.includes("Reinversión acreditada") && !b.txt.includes("Por recuperar de este buscador") && !b.txt.includes("Tope del ciclo"), "CD-23 MN3 sin portadora en el payload (payload viejo), cero bloques de reparto/por-recuperar/tope y cero reinversión sumada: se degrada sin inventar");

  /* C · ciclo abierto: es_proyeccion:true → «proyección», nunca pago firme */
  const c = await ciclosTxtMN3([
    liqMN3("mn3-c1", "2026-11-17T10:00:00Z", { reparto_portador: true,
      reparto: { ganancia_ciclo: 84, pct_buscador: 26.2, pct_libre: 15.6, pct_reinversion: 58.2,
        comision_bruta: 22, comision_redondeada: 20, recuperacion_aplicada: 0,
        pago_buscador: 20, libre_ernesto: 13, reinversion_fondo: 51, regla_redondeo: "decena_5_baja", es_proyeccion: true } }) ]);
  ok(c.txt.includes("proyección") && c.txt.includes("Pago proyectado al buscador") && !c.txt.includes("Pago final al buscador"), "CD-24 MN3 el reparto de ciclo abierto se nombra «proyección» («Pago proyectado al buscador») y jamás pago firme");
}

/* ===== MN4 · CIERRE DE LA SUPERVISORA RONDA 2 (2026-11-17):
   (1) el fixture de archivo payload-portadora-briku-2026-11-17.json
   dejó de ser un derivado: es CAPTURA VIVA COMPLETA post-S2 (11
   liquidaciones por dinero_ciclo_json vía Management API) — la
   portadora de la entrega de 15.000 es 542c809a (no eca67120) y el
   por_recuperar de las portadoras es {recuperado 0, restante 50}.
   (2) La «Reinversión acreditada» suma SOLO portadoras con
   es_proyeccion === false; la proyectada del ciclo abierto va en
   línea aparte y nombrada «proyectada». ===== */
{
  const fxMN4 = JSON.parse(fs.readFileSync(REPO + "bancos/fixtures/payload-portadora-briku-2026-11-17.json", "utf8"));
  const liqsFX = (fxMN4.liquidaciones || []).map(function(e){
    return Object.assign({}, e.ciclo, { liquidacion_id: e.lid, buscador: e.buscador, tipo: e.tipo,
      creada_en: String(e.creada_en).replace(" ", "T").replace("+00", "Z"),
      capital_cup: e.capital_cup, entrega_id: e.entrega_id, es_prueba: false });
  });
  const porEntregaFX = {};
  liqsFX.forEach(function(x){ (porEntregaFX[x.entrega_id] = porEntregaFX[x.entrega_id] || []).push(x); });
  const portsFX = liqsFX.filter(function(x){ return x.reparto_portador === true; });
  const sumaCerradasFX = portsFX.filter(function(x){ return x.reparto && x.reparto.es_proyeccion === false; })
    .reduce(function(s, x){ return s + Number(x.reparto.reinversion_fondo || 0); }, 0);
  ok(liqsFX.length === 11 && Object.keys(porEntregaFX).length === 4
    && Object.keys(porEntregaFX).every(function(k){ return porEntregaFX[k].filter(function(x){ return x.reparto_portador === true; }).length === 1; })
    && (fxMN4.portadoras || {})["e8d6a0de-9c50-4291-a930-93b02166bca9"] === "542c809a-228b-4dc3-a569-c5bc48e9fec9"
    && portsFX.every(function(x){ return x.por_recuperar && x.por_recuperar.recuperado === 0 && x.por_recuperar.restante === 50; })
    && sumaCerradasFX === 1237,
    "CD-25 MN4 el fixture de archivo es la captura viva completa: 11 liquidaciones · 4 entregas · 1 portadora por entrega · la de 15.000 es 542c809a · por_recuperar {0/50} en las portadoras · Σ reinversión de portadoras cerradas = 1.237");
  const dFX = await ciclosTxtMN3(liqsFX);
  ok(dFX.txt.includes("Reinversión acreditada al fondo por estos ciclos") && dFX.txt.includes("1.237") && !dFX.txt.includes("1.288"),
    "CD-26 MN4 con el fixture vivo completo, la reinversión ACREDITADA excluye la proyección del ciclo abierto: 1.237 (212+344+681 de las portadoras cerradas), no 1.288");
  ok(dFX.txt.includes("Reinversión proyectada") && dFX.txt.includes("todavía no acreditada"),
    "CD-27 MN4 la reinversión del ciclo abierto (51) se enseña en línea aparte y nombrada «proyectada» (todavía no acreditada), nunca bajo el rótulo de acreditada");
}

/* ===== V43 · REGISTRAR GASTO (CHEQUEO 135) + ANALISTA VISIBLE
   (CHEQUEO 136): el botón de la maqueta por fin existe y llama a
   dinero_registrar_gasto_idem; el segmento fijo Asesor|Analista
   arriba de las dos vistas del Mercado; deep link ?tab=Analista. */
{
  R.dineroEstado = { rol: "ernesto", capital_total: 42700, saldo_fondo: 157, saldo_gasto: 1260,
    saldo_inventario: 14, saldo_ernesto_inversion: 15740, entregas: [], asignaciones: [],
    estrellas: [], ganancias: { por_buscador: [] }, vueltas_abiertas: [],
    devoluciones_pendientes: [], ventas_recientes: [], cuadre: { ok: true, total_libro: 45595 },
    conversiones: [], pagos_buscadores: [] };
  R.gastoResp = { ok: true, duplicado: false, saldo_gasto: 760 };
  const preG = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ preState: preG });
  await sleep(700);
  const d = w.document;
  const btnG = d.getElementById("inRegGasto");
  ok(!!btnG && d.getElementById("inGasto") && d.getElementById("inGasto").textContent.includes("MI GASTO"), "V43-G1 la tarjeta «Mi gasto» de Inicio trae el botón «Registrar gasto» (CHEQUEO 135)");
  if (btnG) click(btnG);
  await sleep(200);
  ok(d.getElementById("hojaFondo").style.display === "block" && !!d.getElementById("gMonto") && !!d.getElementById("gNota") && !!d.getElementById("gMedio"), "V43-G2 la hoja de gasto abre con monto, nota opcional y medio");
  ok((d.getElementById("hojaTxt") || {}).textContent.includes("puedes gastar"), "V43-G2b la hoja enseña cuánto puedes gastar hoy según el libro");
  const btnConf = () => d.getElementById("hojaBtns").querySelector("button");
  /* monto mayor que el libre: rechazo local humano, sin tocar el servidor */
  input(d.getElementById("gMonto"), "2000");
  click(btnConf());
  await sleep(200);
  const errG = d.getElementById("gErr");
  ok(errG && errG.style.display === "block" && errG.textContent.includes("pasa de lo que hoy puedes gastar"), "V43-G3 monto mayor que el libre: error humano en la hoja");
  ok(!llamadas.includes("rpc:dinero_registrar_gasto_idem"), "V43-G3b el rechazo local NO llama al servidor");
  /* registro válido: el cuerpo lleva monto/nota/medio y su cliente_id */
  input(d.getElementById("gMonto"), "500");
  input(d.getElementById("gNota"), "Banco v43");
  click(btnConf());
  await sleep(400);
  ok(llamadas.includes("rpc:dinero_registrar_gasto_idem"), "V43-G4 el registro válido llama a dinero_registrar_gasto_idem");
  const cuerpoG = ultimosCuerpos["dinero_registrar_gasto_idem"] || {};
  ok(cuerpoG.p_monto === 500 && cuerpoG.p_concepto === "Banco v43" && cuerpoG.p_medio === "efectivo" && typeof cuerpoG.p_cliente_id === "string" && cuerpoG.p_cliente_id.length > 0, "V43-G4b el cuerpo trae monto, nota, medio y el cliente_id de idempotencia");
  ok(d.getElementById("hojaFondo").style.display !== "block", "V43-G4c al guardar, la hoja se cierra");
  ok((d.getElementById("toast") || {}).textContent.includes("Gasto registrado") && (d.getElementById("toast") || {}).textContent.includes("760"), "V43-G4d el toast confirma y dice el nuevo libre que devolvió el servidor");
  /* duplicado: el servidor avisa que ya existía y la app lo dice sin celebrar dos veces */
  R.gastoResp = { ok: true, duplicado: true, saldo_gasto: 760 };
  const btnG2 = d.getElementById("inRegGasto");
  if (btnG2) click(btnG2);
  await sleep(200);
  input(d.getElementById("gMonto"), "100");
  click(btnConf());
  await sleep(400);
  ok((d.getElementById("toast") || {}).textContent.includes("no se duplicó"), "V43-G5 si el servidor responde duplicado, el toast lo dice: no se duplicó");
  const cuerpoG2 = ultimosCuerpos["dinero_registrar_gasto_idem"] || {};
  ok(cuerpoG2.p_cliente_id && cuerpoG2.p_cliente_id !== cuerpoG.p_cliente_id, "V43-G5b cada operación nueva nace con un cliente_id nuevo (el reintento de LA MISMA reusa el suyo)");
  /* el servidor rechaza por insuficiente: mensaje humano, hoja abierta */
  R.gastoResp = null; R.gastoFalla = "insuficiente";
  const btnG3 = d.getElementById("inRegGasto");
  if (btnG3) click(btnG3);
  await sleep(200);
  input(d.getElementById("gMonto"), "100");
  click(btnConf());
  await sleep(400);
  const errG6 = d.getElementById("gErr");
  ok(errG6 && errG6.textContent.includes("pasa de tu gasto libre") && d.getElementById("hojaFondo").style.display === "block", "V43-G6 rechazo del servidor (insuficiente): error humano y la hoja sigue abierta pa corregir");
  /* sin red: error humano, nada se da por guardado */
  R.gastoFalla = "red";
  click(btnConf());
  await sleep(400);
  const errG7 = d.getElementById("gErr");
  ok(errG7 && errG7.textContent.includes("No llegó la confirmación"), "V43-G7 sin red: error humano y honesto (no afirma que no se guardó: la confirmación es lo que falta)");
  /* G8 · el folio es PEGAJOSO entre aperturas (supervisora ronda 1):
     tras el fallo sin red, el folio quedó en localStorage; al cerrar
     y reabrir la hoja se reusa EL MISMO y el éxito lo limpia. */
  const folioG = w.localStorage.getItem("mn_gasto_folio_v1");
  const cuerpoG7 = ultimosCuerpos["dinero_registrar_gasto_idem"] || {};
  ok(!!folioG && folioG === cuerpoG7.p_cliente_id, "V43-G8 tras un intento sin confirmar, el folio queda guardado en el teléfono y es el que se envió");
  const btnsHoja = d.getElementById("hojaBtns").querySelectorAll("button");
  if (btnsHoja[1]) click(btnsHoja[1]);
  await sleep(150);
  R.gastoFalla = null; R.gastoResp = { ok: true, duplicado: true, saldo_gasto: 1160 };
  const btnG4 = d.getElementById("inRegGasto");
  if (btnG4) click(btnG4);
  await sleep(200);
  ok((d.getElementById("hojaTxt") || {}).textContent.includes("sin confirmar"), "V43-G8b al reabrir con un folio pendiente, la hoja avisa que se reintenta con el mismo folio");
  input(d.getElementById("gMonto"), "100");
  click(btnConf());
  await sleep(400);
  const cuerpoG8 = ultimosCuerpos["dinero_registrar_gasto_idem"] || {};
  ok(cuerpoG8.p_cliente_id === folioG, "V43-G8c el reintento tras reabrir reusa EL MISMO folio: el servidor responde duplicado, no cobra dos veces");
  ok(w.localStorage.getItem("mn_gasto_folio_v1") === null, "V43-G8d con la confirmación del servidor, el folio se limpia");
  /* G9 · la huella del folio: cambiar los datos de un registro sin
     confirmar avisa (si aquel entró, este sería OTRO gasto) y solo
     el segundo toque, consciente, acuña un folio nuevo. */
  R.gastoFalla = "red";
  const btnG5 = d.getElementById("inRegGasto");
  if (btnG5) click(btnG5);
  await sleep(200);
  input(d.getElementById("gMonto"), "100");
  click(btnConf());
  await sleep(300);
  const folioG9 = w.localStorage.getItem("mn_gasto_folio_v1");
  const btnsH9 = d.getElementById("hojaBtns").querySelectorAll("button");
  if (btnsH9[1]) click(btnsH9[1]);
  await sleep(150);
  R.gastoFalla = null; R.gastoResp = { ok: true, duplicado: false, saldo_gasto: 960 };
  const btnG6 = d.getElementById("inRegGasto");
  if (btnG6) click(btnG6);
  await sleep(200);
  input(d.getElementById("gMonto"), "200");
  const llamadasAntes9 = llamadas.filter(u => u.includes("dinero_registrar_gasto_idem")).length;
  click(btnConf());
  await sleep(250);
  const errG9 = d.getElementById("gErr");
  ok(errG9 && errG9.textContent.includes("OTRO gasto"), "V43-G9 cambiar el monto de un registro sin confirmar avisa: si aquel entró, este sería OTRO gasto");
  ok(llamadas.filter(u => u.includes("dinero_registrar_gasto_idem")).length === llamadasAntes9, "V43-G9b el aviso no envía nada: el segundo toque es la confirmación consciente");
  click(btnConf());
  await sleep(400);
  const cuerpoG9 = ultimosCuerpos["dinero_registrar_gasto_idem"] || {};
  ok(!!folioG9 && cuerpoG9.p_cliente_id && cuerpoG9.p_cliente_id !== folioG9 && cuerpoG9.p_monto === 200, "V43-G9c al confirmar el cambio, nace un folio NUEVO pa el gasto nuevo");
  R.gastoResp = null;
  /* --- el Analista visible: segmento fijo en las dos vistas --- */
  w.irA("Mercado");
  await sleep(500);
  const pgM = d.getElementById("pgMercado"), pgT = d.getElementById("pgTerminal");
  const segM = pgM.querySelectorAll("[data-vista-mercado]");
  ok(segM.length === 2 && pgM.firstElementChild && pgM.firstElementChild.classList.contains("t1SegSeccion"), "V43-B1 al entrar a Mercado, el segmento Asesor|Analista va PRIMERO, arriba de todo (CHEQUEO 136)");
  ok(segM[0] && segM[0].classList.contains("on") && segM[0].textContent.includes("Asesor") && segM[1] && segM[1].textContent.includes("Analista"), "V43-B1b en la vista del Asesor, su botón va encendido y el otro dice «Analista»");
  if (segM[1]) click(segM[1]);
  await sleep(400);
  ok(pgT.style.display !== "none" && pgM.style.display === "none", "V43-B2 un toque en «Analista» cambia a la vista de las gráficas (Terminal)");
  const segT = pgT.querySelectorAll("[data-vista-mercado]");
  ok(segT.length === 2 && segT[1].classList.contains("on") && pgT.firstElementChild && pgT.firstElementChild.classList.contains("t1SegSeccion"), "V43-B2b la vista del Analista trae el mismo segmento fijo arriba, con «Analista» encendido");
  if (segT[0]) click(segT[0]);
  await sleep(400);
  ok(pgM.style.display !== "none" && pgT.style.display === "none", "V43-B3 un toque en «Asesor» vuelve a la vista del Asesor");
  w.close();
  R.dineroEstado = null; R.gastoResp = null; R.gastoFalla = null;
}
/* ===== V43 · DEEP LINKS DEL ANALISTA: ?tab=Analista llega a la
   Terminal y ?tab=Terminal (el de siempre) no se rompe ===== */
{
  const preDL = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const rA = crear({ preState: preDL, url: "https://ernesto5058.github.io/calculadora-ernesto/minegocio/?tab=Analista" });
  await sleep(700);
  ok(rA.w.document.getElementById("pgTerminal").style.display !== "none", "V43-B4 ?tab=Analista abre directo la vista del Analista (CHEQUEO 136)");
  rA.w.close();
  const rT = crear({ preState: preDL, url: "https://ernesto5058.github.io/calculadora-ernesto/minegocio/?tab=Terminal" });
  await sleep(700);
  ok(rT.w.document.getElementById("pgTerminal").style.display !== "none", "V43-B5 ?tab=Terminal (el enlace de siempre) sigue llegando a la Terminal");
  rT.w.close();
}

/* ===== V43 · LA TERMINAL NO REINTENTA EN BUCLE (CHEQUEO 137):
   con la puerta caída, entrar a la Terminal asienta en su tarjeta
   de error con UN intento — el render no puede re-disparar la
   carga (antes: bucle de microtareas que colgaba hasta el banco). */
{
  R.termFalla = true;
  const preT = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [], datos: datosPublicados, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const { w } = crear({ preState: preT });
  await sleep(600);
  w.irA("Terminal");
  await sleep(1500);
  const d = w.document;
  const intentos = llamadas.filter(u => u.includes("rpc:guia_terminal")).length;
  ok(intentos >= 1 && intentos <= 2, "V43-T1 con la puerta caída, la Terminal intenta una vez y se asienta (" + intentos + " intento/s, no un bucle)");
  const txtTerm = d.getElementById("pgTerminal").textContent;
  ok((txtTerm.includes("Sin conexión con la puerta de la Terminal") || txtTerm.includes("Falta activar el paquete")) && !txtTerm.includes("Leyendo la Terminal"), "V43-T2 la tarjeta de error de la Terminal se lee, tranquila y asentada (no se queda en «Leyendo…»), sin reintentos");
  w.close();
  R.termFalla = false;
}

console.log("\nBANCO MI NEGOCIO: " + pass + " PASS · " + fail + " FAIL");
if (fails.length) console.log("Fallos:", fails.join(" · "));
process.exit(fail ? 1 : 0);

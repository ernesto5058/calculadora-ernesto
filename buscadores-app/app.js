"use strict";
/*__SENTRY_CASA__*/
var APP_VERSION = "1.5.9";
/* Tarifa de respaldo (E-7, Tanda Nº6): SOLO se usa si nunca llegó ni
   datos.json ni la tarifa viva, y mientras manda ella la app lo dice
   a la vista («RESPALDO» + su origen en tarifaText/pintaFrescura).
   La tarifa viva viene de leer_tarifa; datos.json es la publicada. */
var DEFAULT_TARIFA = { ingresoRef360: 1092.65, libroRef: 1110, salidaRef: 950,
  pctSaldo: 25, pctTransf: 20, pisoTransf: 25,
  bonoSaldoMeta: 150, bonoSaldoMonto: 300, bonoTransfMeta: 10, bonoTransfMonto: 300 };
var DATA = { tarifa: DEFAULT_TARIFA, actualizado: "" };
var T = DEFAULT_TARIFA;
var DATA_VERSION = 0;   /* mayor version de datos.json aplicada: la guarda no deja bajar */
var SESION = "";        /* código personal de la sesión activa ("" = sin entrar) */
var TARIFA_VIVA = null; /* v1.3.0: tarifa leída en vivo (leer_tarifa); manda sobre datos.json */
var TARIFA_VIVA_EN = "";/* v1.3.0: ISO de la última publicación de la tarifa viva */
var TARIFA_FUENTE = "respaldo"; /* v1.5.3 (E-7): "viva" | "publicada" | "respaldo" — jamás silenciosa */
var PANEL_VIVO = null;  /* v1.3.0: {nombre, tratos} leídos en vivo (leer_panel) */
var ADMIN_VISTO = null; /* v1.3.1: ISO del último latido de Ernesto (fila 'ADMIN' en presencia) */
var CHAT_MSGS = [];     /* v1.3.1: último hilo cargado (para repintar estados al refrescar presencia) */

/* ===== Supabase (clave pública; las puertas RPC validan el código) ===== */
var SB_URL = "https://otsudfgwpapkluusrlnj.supabase.co/rest/v1/reportes";
var SB_RPC = SB_URL.replace("/reportes", "/rpc/");
var SB_KEY = "sb_publishable_Uchl5QnojJkZbXR5ar8vDg_5CXnqi_d";
function sbHeaders(){ return { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json" }; }

/* ===== v1.4.4: red honesta + opId =====
   ULTIMA_RED_OK = cuándo respondió la API por última vez de verdad.
   Regla de la casa: UNA sola llamada fallida nunca declara «sin
   conexión» si la API acaba de responder por otra puerta. El opId
   (UUID por mensaje/reporte, guardado en la cola) desambigua las
   puertas con sobrecarga en PostgREST y hace el reintento
   idempotente: reenviar nunca duplica en el servidor. */
var ULTIMA_RED_OK = 0;
function marcarRedOk(){ ULTIMA_RED_OK = Date.now(); }
function redReciente(ms){ return ULTIMA_RED_OK > 0 && (Date.now() - ULTIMA_RED_OK) < ms; }
function nuevoOpId(){
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch(e){}
  return "op-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e9).toString(36) + "-" + Math.floor(Math.random() * 1e9).toString(36);
}

function $(id){ return document.getElementById(id); }
function num(id){ var v = parseFloat($(id).value); return isNaN(v) ? null : v; }
function fmt(n){ return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function fmtN(n){ return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function ico(n, cls){ return '<svg class="ic ' + (cls || "") + '" aria-hidden="true"><use href="#' + n + '"/></svg>'; }

/* ===== Fórmulas del esquema v2 (idénticas a las de Ernesto) ===== */
function comisionSaldo(precio, cant){
  var exc = T.ingresoRef360 - precio;            // excedente por cada 360
  if (exc <= 0) return { fee: 0, exc: exc };
  return { fee: exc * (T.pctSaldo/100) * cant, exc: exc };
}
function comisionTransf(efectivo, pct){
  var recibe = efectivo * (1 + pct/100);                       // transferencia recibida
  var qusd = recibe / T.libroRef;                              // QUSD comprados
  var regreso = qusd * T.salidaRef;                            // efectivo de vuelta
  var ganancia = regreso - efectivo;                           // ganancia de la vuelta
  return { recibe: recibe, qusd: qusd, regreso: regreso,
           ganancia: ganancia, fee: Math.max(0, ganancia) * (T.pctTransf/100) };
}

function calcSaldo(){
  var p = num("s_precio"), c = num("s_cant") || 1;
  var res = $("s_res"), warn = $("s_warn");
  if (p === null || p <= 0){ res.style.display = "none"; warn.style.display = "none"; return; }
  var r = comisionSaldo(p, c);
  if (r.exc <= 0){
    res.style.display = "none"; warn.style.display = "block";
    warn.textContent = "A ese precio no hay excedente: cobrarías $0.00. Negocia más bajo — mientras más bajo el precio, más cobras tú.";
    return;
  }
  warn.style.display = "none"; res.style.display = "block";
  $("s_fee").textContent = fmt(r.fee);
  $("s_det").innerHTML = "Excedente por recarga: " + fmtN(r.exc) + " CUP · tu " + esc(T.pctSaldo) + "% = " + fmtN(r.fee / c) + " por recarga" +
    (c > 1 ? " · × " + c + " recargas" : "") + "<br>Entre más barato consigas, más ganas.";
}
function calcTransf(){
  var ef = num("t_ef"), pct = num("t_pct");
  var res = $("t_res"), warn = $("t_warn"), ok = $("t_ok");
  $("t_pct_lab").textContent = (pct === null ? "—" : pct);
  if (ef === null || ef <= 0 || pct === null){ res.style.display = "none"; warn.style.display = "none"; ok.style.display = "none"; return; }
  if (pct < T.pisoTransf){
    res.style.display = "none"; ok.style.display = "none"; warn.style.display = "block";
    warn.textContent = "Ese trato no se acepta: el mínimo es al " + T.pisoTransf + "%. Negocia más alto o no hay trato.";
    return;
  }
  warn.style.display = "none";
  var r = comisionTransf(ef, pct);
  if (r.ganancia <= 0){
    res.style.display = "none"; ok.style.display = "block";
    ok.textContent = "Con la tarifa de hoy esa vuelta no deja ganancia. Espera o negocia un % más alto.";
    return;
  }
  ok.style.display = "none"; res.style.display = "block";
  $("t_fee").textContent = fmt(r.fee);
  $("t_det").innerHTML = "La persona recibe " + fmtN(r.recibe) + " por transferencia · la vuelta gana " + fmtN(r.ganancia) + " CUP · tu " + esc(T.pctTransf) + "% = tu comisión.<br>Se paga cuando la vuelta cierra.";
}

/* ===== Sesión: login único con validación real ===== */
function normCod(s){ return String(s || "").trim().toUpperCase(); }
function sesionGet(){ try { return normCod(localStorage.getItem("busc_codigo")); } catch(e){ return ""; } }
function sesionSet(c){ try { localStorage.setItem("busc_codigo", c); } catch(e){} }
function sesionClear(){ try { localStorage.removeItem("busc_codigo"); } catch(e){} }
/* v1.5.2 (Inspector E-1): el panel ya NO lee ningún JSON público.
   Su respaldo es la última foto buena de leer_panel, cacheada por
   código en este teléfono; el nombre sale del perfil local. */
function panelCacheGet(){
  try { var p = JSON.parse(localStorage.getItem("busc_panel_cache") || "null");
    return (p && p.codigo === SESION && Array.isArray(p.tratos)) ? p : null; } catch(e){ return null; }
}
function panelCacheSet(p){
  try { localStorage.setItem("busc_panel_cache", JSON.stringify({ codigo: SESION, nombre: p.nombre || "", tratos: p.tratos || [] })); } catch(e){}
}
function panelCacheClear(){ try { localStorage.removeItem("busc_panel_cache"); } catch(e){} }
function nombreLocal(){ try { var pf = perfilLocalGet(); if (pf && pf.nombre) return pf.nombre; } catch(e){} return ""; }

/* Comprueba el código contra Supabase (RPC validar_usuario).
   Resuelve {estado:"ok", codigo, nombre} | {estado:"no"} | {estado:"sinred"}. */
function rpcValidar(code){
  if (!window.fetch) return Promise.resolve({ estado: "sinred" });
  return fetch(SB_RPC + "validar_usuario", { method: "POST", headers: sbHeaders(),
      body: JSON.stringify({ p_codigo: code }) })
    .then(function(r){ if (r.ok) marcarRedOk(); return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
    .then(function(rows){
      if (rows && rows.length && rows[0].activo !== false)
        return { estado: "ok", codigo: normCod(rows[0].codigo || code), nombre: rows[0].nombre || "", pausa: rows[0].bloqueado === true };
      return { estado: "no" };
    })
    .catch(function(){ return { estado: "sinred" }; });
}

/* v1.5.3 (E-18): la carga inicial ya NO es todo-o-nada — cada pieza
   que falla se anuncia por su nombre y el resto de la app sigue. */
var BOOT_FALLOS = [];
function bootAviso(pieza){
  if (BOOT_FALLOS.indexOf(pieza) < 0) BOOT_FALLOS.push(pieza);
  var el = $("bootWarn"); if (!el) return;
  el.style.display = "block";
  el.textContent = "Algunas partes no cargaron (" + BOOT_FALLOS.join(", ") + "). El resto de la app sí funciona: toca «Actualizar» con conexión.";
}
function seguro(fn, pieza){
  try { var r = fn(); if (r && typeof r.catch === "function") r.catch(function(){ bootAviso(pieza); }); return r; }
  catch(e){ bootAviso(pieza); }
}
function gateMsg(msg){
  var w = $("l_warn"); if (!w) return;
  if (msg) { w.style.display = "block"; w.textContent = msg; }
  else { w.style.display = "none"; w.textContent = ""; }
}
function mostrarGate(msg){
  $("loginGate").classList.remove("hide");
  document.body.classList.add("locked");
  gateMsg(msg || "");
}
/* v1.5.3 (E-6): el candado EN_PAUSA se libera cuando el servidor
   dice que ya no hay pausa (validar_usuario.bloqueado) o cuando una
   escritura que la pausa bloquearia sale bien. */
function aplicarPausa(p){
  var pf = $("pf_pausa");
  if (p) { EN_PAUSA = true; if (pf) pf.style.display = "block"; }
  else if (EN_PAUSA) { EN_PAUSA = false; if (pf) pf.style.display = "none"; try { despacharChat(); } catch(e){} try { syncReportes(); } catch(e){} }
}
function liberarPausa(){ aplicarPausa(false); }
/* v1.5.3 (E-3): la sesion guardada se valida contra el servidor al
   arrancar y en cada refresco: respuesta definitiva «no» (revocado)
   expulsa; «sinred» NO expulsa a nadie (se entra con la foto local). */
function validarSesionRemota(){
  if (!SESION) return;
  var cod = SESION;
  rpcValidar(cod).then(function(v){
    if (SESION !== cod) return;
    if (v.estado === "no") { salir("Tu acceso ya no está activo. Habla con Ernesto."); return; }
    if (v.estado === "ok") aplicarPausa(!!v.pausa);
  });
}
function entrar(code){
  SESION = code; sesionSet(code);
  $("loginGate").classList.add("hide");
  document.body.classList.remove("locked");
  gateMsg("");
  try { $("l_cod").value = ""; } catch(e){}
  seguro(function(){ renderPanel(); }, "tu panel");
  seguro(function(){ tocarPresencia(); }, "la presencia");
  seguro(function(){ chatBadge(); }, "los avisos del chat");
  seguro(function(){ cargarAdminPres(); }, "la presencia de Ernesto");
  seguro(function(){ cargarVivo(); }, "la tarifa en vivo");
  seguro(function(){ validarSesionRemota(); }, "la comprobación de tu sesión");   /* v1.5.3 (E-3) */
  try { despacharChat(); } catch(e){}   /* v1.4.4: al entrar, sale lo que hubiera en cola */
  try { avisosAutoTrasLogin(); } catch(e){}   /* v1.4.5: la app instalada pide su permiso de notificaciones como cualquier app normal */
}
function salir(msg){
  SESION = ""; sesionClear(); panelCacheClear();
  PANEL_VIVO = null;
  ADMIN_VISTO = null; CHAT_MSGS = [];
  try { $("l_cod").value = ""; } catch(e){}
  pintarBadge(0);
  var body = $("p_body"); if (body) body.classList.add("hide");
  mostrarGate(msg || "");
}
/* Intento de entrada (v1.5.2): SOLO manda validar_usuario en el
   servidor — ningún JSON público guarda códigos ya. Sin red y sin
   sesión guardada NO se entra: no hay forma honesta de verificar.
   La sesión guardada sigue entrando directo con su foto local.
   desdeEnlace=true (vino por ?codigo=): si falla, cae al cartel normal sin
   mensajes y SIN guardar el código malo. */
function intentarLogin(codeCrudo, desdeEnlace){
  var code = normCod(codeCrudo);
  var btn = $("l_btn");
  if (!code) {
    if (!desdeEnlace) gateMsg("Escribe tu código personal — la cuenta que te dio Ernesto.");
    return Promise.resolve(false);
  }
  btn.disabled = true; var txt0 = btn.textContent; btn.textContent = "Comprobando…";
  if (!desdeEnlace) gateMsg("");
  return rpcValidar(code).then(function(v){
    btn.disabled = false; btn.textContent = txt0;
    if (v.estado === "ok") { entrar(v.codigo); return true; }
    if (desdeEnlace) { gateMsg(""); return false; }
    if (v.estado === "sinred")
      gateMsg("Sin conexión para comprobar tu código. Conéctate a internet y toca Entrar otra vez.");
    else
      gateMsg("Ese código no aparece. Revísalo con Ernesto.");
    return false;
  });
}

/* ===== Panel (usa la sesión; ya no pide el código) ===== */
function renderPanel(){
  var warn = $("p_warn"), body = $("p_body");
  if (!SESION) { body.classList.add("hide"); warn.style.display = "none"; return; }
  var bCache = panelCacheGet();
  var b = PANEL_VIVO ? { nombre: PANEL_VIVO.nombre || (bCache ? bCache.nombre : "") || nombreLocal(), tratos: PANEL_VIVO.tratos || [] } : bCache;
  if (!b) {
    warn.style.display = "block";
    warn.textContent = "Tus datos todavía no cargan en este teléfono. Toca «Actualizar» con conexión.";
    body.classList.add("hide"); return;
  }
  warn.style.display = "none"; body.classList.remove("hide");
  $("p_ses").textContent = SESION + (b.nombre ? " · " + b.nombre : "");
  var total = 0, recSaldo = 0, nTransf = 0, html = "";
  (b.tratos || []).forEach(function(tr){
    total += tr.comision || 0;
    if (tr.tipo === "saldo") recSaldo += Math.floor(Number(tr.recargas) || 0); /* REGLA DE BONOS 2026-11-13: solo recargas COMPLETAS de 360 */
    if (tr.tipo === "transferencia" && (Number(tr.monto) || 0) >= 5000) nTransf += 1; /* REGLA DE BONOS 2026-11-13: transf solo cuenta desde 5.000 CUP */
    html += '<div class="trato"><span class="f">' + esc(tr.fecha) + "</span><span>" +
      (tr.tipo === "saldo" ? ico("i-phone", "mini") + " " : ico("i-bank", "mini") + " ") + (esc(tr.nota || "")) + '</span><span class="c">' + fmt(tr.comision || 0) + "</span></div>";
  });
  if (!html) html = '<div class="trato"><span>Aún no tienes tratos confirmados. ¡A buscar!</span></div>';
  $("p_total").textContent = fmt(total);
  $("p_name").textContent = b.nombre ? ("de " + b.nombre) : "";
  $("p_tratos").innerHTML = html;
  var bsM = T.bonoSaldoMeta, btM = T.bonoTransfMeta;
  $("p_bs_lab").textContent = recSaldo + " de " + bsM + " recargas → bono " + fmt(T.bonoSaldoMonto);
  $("p_bs_bar").style.width = Math.min(100, bsM ? (recSaldo / bsM * 100) : 0) + "%";
  $("p_bt_lab").textContent = nTransf + " de " + btM + " tratos → bono " + fmt(T.bonoTransfMonto);
  $("p_bt_bar").style.width = Math.min(100, btM ? (nTransf / btM * 100) : 0) + "%";
}

function tarifaText(){
  var fuente = TARIFA_FUENTE === "viva" ? "<b>Tarifa en vivo</b>"
    : TARIFA_FUENTE === "publicada" ? "<b>Tarifa publicada</b> (respaldo: la viva no respondió)"
    : "<b>⚠ RESPALDO</b> — tarifa guardada en la app, sin conexión: puede estar vieja";
  return fuente + (DATA.actualizado ? " (" + esc(DATA.actualizado) + ")" : "") +
    " · Saldo: cobras el <b>" + T.pctSaldo + "%</b> del excedente · Transferencia: el <b>" + T.pctTransf + "%</b> de la ganancia, mínimo al <b>" + T.pisoTransf + "%</b>" +
    " · Bonos: <b>" + fmt(T.bonoSaldoMonto) + "</b> con " + T.bonoSaldoMeta + " recargas/semana · <b>" + fmt(T.bonoTransfMonto) + "</b> con " + T.bonoTransfMeta + " tratos/semana";
}

/* Frescura: «Actualizado hace X min» desde DATA.actualizado.
   Si el campo es solo fecha (publicaciones viejas), se muestra tal cual. */
function pintaFrescura(){
  var el = $("freshTxt"); if (!el) return;
  if (TARIFA_VIVA_EN) {   // v1.3.0: manda la hora de la tarifa EN VIVO
    var tv = Date.parse(TARIFA_VIVA_EN);
    if (!isNaN(tv)) {
      var minv = Math.max(0, Math.round((Date.now() - tv) / 60000));
      el.textContent = minv < 1 ? "Tarifa actualizada: ahora mismo"
        : minv < 60 ? "Tarifa actualizada: hace " + minv + " min"
        : minv < 1440 ? "Tarifa actualizada: hace " + Math.round(minv / 60) + " h"
        : "Tarifa actualizada: hace " + Math.round(minv / 1440) + " días";
      return;
    }
  }
  var a = String(DATA.actualizado || "");
  if (!a) { el.textContent = ""; return; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(a)) { el.textContent = "Tarifa publicada: " + a; return; }
  var t = Date.parse(a.replace(" ", "T"));
  if (isNaN(t)) { el.textContent = "Tarifa publicada: " + a; return; }
  var min = Math.max(0, Math.round((Date.now() - t) / 60000));
  var txt;
  if (min < 1) txt = "Actualizado ahora mismo";
  else if (min < 60) txt = "Actualizado hace " + min + " min";
  else if (min < 1440) txt = "Actualizado hace " + Math.round(min / 60) + " h";
  else txt = "Actualizado hace " + Math.round(min / 1440) + " días";
  if (min >= 1440) txt += " · si puedes, toca Actualizar con conexión";
  el.textContent = txt;
}

function applyData(d, fresca){
  if (!d || !d.tarifa) return;
  var v = d.version || 0;
  if (v < DATA_VERSION) return;                 // guarda: una versión vieja nunca pisa la nueva
  if (v > DATA_VERSION) DATA_VERSION = v;
  DATA = d; T = d.tarifa;
  if (!TARIFA_VIVA) TARIFA_FUENTE = "publicada";   /* v1.5.3 (E-7): datos.json = publicada, no la viva */
  try { localStorage.setItem("busc_datos", JSON.stringify(d)); } catch(e){}
  checkUpdate();
  $("tarifaTxt").innerHTML = tarifaText();
  pintaFrescura();
  calcSaldo(); calcTransf();
  if (SESION) renderPanel();   /* v1.5.2: el JSON ya no expulsa a nadie; la revocación vive SOLO en refrescarTodo (respuesta definitiva del servidor) */
  if (TARIFA_VIVA) aplicarTarifaViva();   // v1.3.0: un datos.json tardío nunca pisa la tarifa viva
}
function fetchDatos(url, fresca){
  return fetch(url, { cache: "no-store" }).then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){ if (d) { marcarRedOk(); applyData(d, fresca); } return !!d; })
    .catch(function(){ return false; });
}
function loadData(){
  try {
    var cached = localStorage.getItem("busc_datos");
    if (cached) applyData(JSON.parse(cached), false);
    else $("tarifaTxt").innerHTML = tarifaText();
  } catch(e){ try { $("tarifaTxt").innerHTML = tarifaText(); } catch(e2){} }
  var ps = [];
  if (window.fetch) {
    var t = "?t=" + Date.now();   // anti-caché: el CDN no sirve copias viejas
    ps.push(fetchDatos("datos.json" + t, !esNativo()));   // en el APK lo relativo es la copia del build: no cuenta como fresca
    ps.push(fetchDatos("https://raw.githubusercontent.com/ernesto5058/calculadora-ernesto/main/buscadores/datos.json" + t, true));
  }
  calcSaldo(); calcTransf();
  return Promise.all(ps);
}

/* ===== Reportar (Supabase) ===== */
var REP_TIPO = "saldo";

function outboxGet(){ try { return JSON.parse(localStorage.getItem("busc_outbox") || "[]"); } catch(e){ return []; } }
function outboxSet(a){ try { localStorage.setItem("busc_outbox", JSON.stringify(a)); } catch(e){} }
function repResumen(rp){
  if (rp.tipo === "saldo") return ico("i-phone", "mini") + " Saldo · " + fmtN(rp.precio) + " CUP × " + rp.cantidad + " recarga(s)";
  return ico("i-bank", "mini") + " Transf. · " + fmtN(rp.cantidad) + " CUP al " + rp.porc + "%";
}
function renderOutbox(){
  var a = outboxGet(), box = $("r_lista"), h = "";
  a.slice().reverse().forEach(function(rp){
    var st = rp.estado === "aprobado" ? '<span class="st okk"><span class="dot"></span>Aprobado +' + fmt(rp.comision || 0) + "</span>"
      : rp.estado === "rechazado" ? '<span class="st no"><span class="dot"></span>Rechazado' + (rp.motivo ? ": " + esc(rp.motivo) : "") + "</span>"
      : '<span class="st pend"><span class="dot"></span>Pendiente' + (rp.enviado ? "" : " (guardado, sin enviar)") + "</span>";
    h += '<div class="rep"><span>' + repResumen(rp) + "<br><small>" + esc(rp.fecha) + "</small></span>" + st + "</div>";
  });
  box.innerHTML = h || '<div class="rep"><span>Todavía no has reportado nada.</span></div>';
}
function enviarReporte(rp){
  if (!window.fetch) return Promise.resolve(false);
  /* v1.4.4: SIEMPRE el juego completo de parámetros + p_op_id. La
     puerta registrar_reporte tiene 3 sobrecargas en el servidor; con
     el subconjunto viejo PostgREST no puede elegir (HTTP 300
     PGRST203) y el reporte nunca salía aunque hubiera internet. */
  if (!rp.opId) rp.opId = nuevoOpId();
  var cuerpoRep = { p_buscador: rp.buscador, p_tipo: rp.tipo, p_precio: rp.precio, p_porc: rp.porc,
    p_cantidad: rp.cantidad, p_telefono: rp.telefono || null, p_nota: rp.nota || null,
    p_adj_tipo: (rp.adj && rp.adj.datos) ? (rp.adj.tipo || "foto") : null,
    p_adj_datos: (rp.adj && rp.adj.datos) ? rp.adj.datos : null,
    p_op_id: rp.opId };
  return fetch(SB_RPC + "registrar_reporte", { method: "POST", headers: sbHeaders(),
    body: JSON.stringify(cuerpoRep)
  }).then(function(r){
      if (r.ok) return r.json();
      return r.json().catch(function(){ return {}; }).then(function(e){
        if (e && e.message && e.message.indexOf("no autorizado") !== -1) rp.error = "noautorizado";
        if (e && e.message && e.message.indexOf("pausa") !== -1) rp.error = "pausa";
        return Promise.reject(new Error("HTTP " + r.status));
      });
    })
    .then(function(id){
      if (id) { rp.id = id; rp.enviado = true; liberarPausa(); }   /* v1.5.3 (E-6) */
      return !!rp.id;
    }).catch(function(){ return false; });
}
function syncReportes(){
  var a = outboxGet(); if (!a.length) return;
  var pend = a.filter(function(rp){ return !rp.enviado; });
  var chain = Promise.resolve(), changed = false;
  pend.forEach(function(rp){
    chain = chain.then(function(){ return enviarReporte(rp).then(function(ok){ if (ok) changed = true; }); });
  });
  chain.then(function(){
    /* v1.5.3 (E-4): se fusiona sobre la outbox FRESCA por opId — la
       foto vieja `a` jamas sobrescribe un reporte que haya entrado
       mientras se despachaba. */
    if (changed) {
      var aF = outboxGet();
      aF.forEach(function(x){ var src = pend.filter(function(y){ return y.opId === x.opId; })[0]; if (src && src.enviado) { x.enviado = true; x.id = src.id; } });
      outboxSet(aF); a = aF;
    }
    // refrescar estados de los ya enviados (por si Ernesto ya decidió)
    var ids = a.filter(function(rp){ return rp.enviado && rp.id && rp.estado === "pendiente"; }).map(function(rp){ return rp.id; });
    if (!ids.length || !window.fetch) { renderOutbox(); return; }
    fetch(SB_RPC + "estado_reportes", { method: "POST", headers: sbHeaders(),
        body: JSON.stringify({ p_ids: ids }) })
      .then(function(r){ return r.ok ? r.json() : []; }).then(function(rows){
        var map = {}; (rows || []).forEach(function(x){ map[x.id] = x; });
        var aF2 = outboxGet();   /* v1.5.3 (E-4): fusion sobre la fresca tambien al pintar estados */
        aF2.forEach(function(rp){
          var s = map[rp.id];
          if (s && s.estado && s.estado !== "pendiente") { rp.estado = s.estado; rp.comision = s.comision; rp.motivo = s.motivo; }
        });
        outboxSet(aF2); renderOutbox();
      }).catch(function(){ renderOutbox(); });
  });
}
function reportar(){
  var warn = $("r_warn"), res = $("r_res");
  warn.style.display = "none"; res.style.display = "none";
  function fallo(msg){ warn.style.display = "block"; warn.textContent = msg; }
  var code = SESION;
  if (!code) return fallo("Primero entra con tu código personal desde la pantalla de inicio.");
  var tel = ($("r_tel").value || "").trim();
  var nota = ($("r_nota").value || "").trim();
  var rp = { buscador: code, tipo: REP_TIPO, precio: null, porc: null, cantidad: null,
    telefono: tel, nota: nota, estado: "pendiente", enviado: false, id: null, opId: nuevoOpId(),
    fecha: new Date().toLocaleDateString("es-ES") };
  if (REP_TIPO === "saldo") {
    var pr = num("r_precio"), ct = num("r_cant") || 1;
    if (pr === null || pr <= 0) return fallo("Escribe el precio que pide el vendedor por cada recarga de 360.");
    rp.precio = pr; rp.cantidad = ct;
  } else {
    var ef = num("r_ef"), pc = num("r_pct");
    if (ef === null || ef <= 0) return fallo("Escribe el efectivo que entrega la persona.");
    if (pc === null) return fallo("Escribe al cuánto es el trato (%).");
    if (pc < T.pisoTransf) return fallo("Ese trato no se acepta: el mínimo es al " + T.pisoTransf + "%. Negocia más alto.");
    rp.porc = pc; rp.cantidad = ef;
  }
  if (!tel) return fallo("Escribe el teléfono del vendedor — Ernesto lo necesita para confirmar el trato.");
  if (typeof REP_FOTO !== "undefined" && REP_FOTO) rp.adj = REP_FOTO;   /* v1.4.0: comprobante */
  var a = outboxGet(); a.push(rp); outboxSet(a); renderOutbox();
  enviarReporte(rp).then(function(ok){
    if (ok) {   /* v1.5.3 (E-4): fusion por opId sobre la outbox fresca (la foto `a` ya puede estar vieja) */
      var aF = outboxGet();
      aF.forEach(function(x){ if (x.opId === rp.opId) { x.id = rp.id; x.enviado = true; } });
      outboxSet(aF);
    }
    renderOutbox();
    if (ok) { res.style.display = "block"; }
    else if (rp.error === "noautorizado") fallo("Tu código no está autorizado en el sistema de Ernesto. Si eres del equipo, revísalo con él: puede estar mal escrito o desactivado.");
    else fallo("No se pudo enviar ahora: el reporte quedó guardado en tu teléfono y se reintenta solo cuando abras la app con conexión.");
  });
}


/* ===== Actualización de la app (solo APK instalado) ===== */
function cmpVer(a, b){
  var pa = String(a).split("."), pb = String(b).split("."), i, x, y;
  for (i = 0; i < 3; i++){ x = parseInt(pa[i] || "0", 10) || 0; y = parseInt(pb[i] || "0", 10) || 0; if (x !== y) return x > y ? 1 : -1; }
  return 0;
}
function esNativo(){ return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
function checkUpdate(){
  if (!esNativo()) return;                     // en la web la app se actualiza sola
  var remota = DATA.versionApp, url = DATA.apkUrl;
  if (!remota || !url) return;
  if (cmpVer(remota, APP_VERSION) > 0) {
    $("updTxt").textContent = "Tienes la versión " + APP_VERSION + " y ya salió la " + remota + ". Actualiza para tener los arreglos y lo nuevo. Toca el botón y luego «Instalar» (te va a pedir permiso: es la misma app, firmada igual).";
    $("updLink").setAttribute("href", url);
    $("updBox").classList.remove("hide");
  }
}

/* ===== Chat con Ernesto + presencia (v1.3.0, Supabase) =====
   El viejo formulario de ayuda (registrar_ayuda) sale del flujo: la
   pestaña «Ayuda» ahora es este chat. Los mensajes viejos quedan en la
   tabla ayudas y Ernesto los sigue viendo en su panel.
   Todas las llamadas a las puertas nuevas fallan EN SILENCIO: si el
   SQL de la v1.3.0 aún no está pegado en Supabase (404) o no hay red,
   la app sigue funcionando igual que en la 1.2.1. */
/* v1.4.1: se guarda el último error del chat (status HTTP) para
   poder decir en humano «todavía no está activado» (404 = la puerta
   no existe) frente a «sin conexión», sin romper el silencio de
   diseño del resto de llamadas. */
var ULTIMO_ERR_CHAT = null;
function rpcChat(fn, body){
  if (!window.fetch) return Promise.resolve(null);
  return fetch(SB_RPC + fn, { method: "POST", headers: sbHeaders(), body: JSON.stringify(body) })
    .then(function(r){ if (r.ok) marcarRedOk(); if (!r.ok) ULTIMO_ERR_CHAT = { fn: fn, status: r.status }; return r.ok ? r.json() : null; })
    .catch(function(){ ULTIMO_ERR_CHAT = { fn: fn, status: 0 }; return null; });
}
/* Latido: Ernesto ve en su panel quién está en línea (< 3 min).
   v1.3.1: al abrir la app también se sellan como RECIBIDOS los
   mensajes de Ernesto que ya estaban en la base (marcar_recibidos):
   su «entregado» deja de depender solo de la deducción por latido.
   Si la puerta aún no existe (SQL v1.3.1 sin pegar), falla en
   silencio como todo lo demás. */
function tocarPresencia(){
  if (!SESION) return;
  rpcChat("tocar_presencia", { p_codigo: SESION });
  rpcChat("marcar_recibidos", { p_codigo: SESION, p_clave: SESION });
}
function horaChat(iso){
  var d = new Date(iso); if (isNaN(d.getTime())) return "";
  function p(x){ return (x < 10 ? "0" : "") + x; }
  return p(d.getHours()) + ":" + p(d.getMinutes());
}
/* v1.4.1: hora como en WhatsApp («3:08 p. m.») y separadores. */
function hora12Chat(iso){
  var d = new Date(iso); if (isNaN(d.getTime())) return "";
  function p(x){ return (x < 10 ? "0" : "") + x; }
  var h = d.getHours(); var ap = h < 12 ? "a. m." : "p. m."; var h12 = h % 12 || 12;
  return h12 + ":" + p(d.getMinutes()) + " " + ap;
}
function etiquetaFechaChat(iso){
  var d = new Date(iso); if (isNaN(d.getTime())) return "";
  function clave(x){ return x.getFullYear() + "-" + x.getMonth() + "-" + x.getDate(); }
  var hoy = new Date(); var ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  if (clave(d) === clave(hoy)) return "Hoy";
  if (clave(d) === clave(ayer)) return "Ayer";
  var meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return d.getDate() + " de " + meses[d.getMonth()] + " de " + d.getFullYear();
}
function escChat(x){ return String(x === null || x === undefined ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
/* v1.5.3 (E-17, escape total): esc() escapa tambien comillas — sirve
   igual en texto y en atributos. TODO texto del servidor o de otro
   usuario que se pinte por innerHTML pasa por esc()/escChat(). */
function esc(x){ return escChat(x).replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
/* v1.5.3 (E-17): un adjunto solo se pinta como <img src> si es una
   dataURL base64 con mime de imagen permitido (patron srcSeguroAdj
   de Mi Negocio); cualquier otra cosa devuelve "" y no se pinta. */
var ADJ_MIMES_OK_MT = ["image/jpeg", "image/png", "image/webp", "image/gif"];
function srcSeguroAdjMT(datos, mime){
  var s = String(datos === null || datos === undefined ? "" : datos);
  var m = s.match(/^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (m) {
    if (ADJ_MIMES_OK_MT.indexOf(m[1].toLowerCase()) < 0) return "";
    return "data:" + m[1].toLowerCase() + ";base64," + m[2];
  }
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length > 8) {
    var mm = String(mime || "image/jpeg").toLowerCase();
    if (ADJ_MIMES_OK_MT.indexOf(mm) < 0) return "";
    return "data:" + mm + ";base64," + s;
  }
  return "";
}
/* ===== Estados del chat «como WhatsApp» (v1.3.1, honestos en v1.4.1) =====
   En TUS mensajes: ✓ enviado (guardado, sin constancia de llegada)
   · ✓✓ entregado · ✓✓ en azul + «Visto». v1.4.1 — SOLO DATOS
   REALES: «entregado» exige el sello «recibido» del servidor (la
   puerta marcar_recibidos lo estampa cuando el panel de Ernesto
   recoge sus mensajes) y «Visto» exige leido=true (abrió el chat).
   Ya NO se deduce del latido de presencia: que Ernesto abra su
   panel no significa que tu mensaje le haya llegado. Los mensajes
   de Ernesto no llevan estado. */
function estadoMsgBusc(m){
  if (m.leido) return ' <span class="estVisto">✓✓ Visto</span>';
  if (m.recibido) return " ✓✓";
  return " ✓";
}
/* Cabecera del chat: ¿Ernesto está en línea? Su latido viene de la
   fila 'ADMIN' de ver_presencia (la registra PanelPRO v6 / Mi
   Negocio con su código admin). Sin datos (puertas sin activar o la
   variante admin sin pegar): «—», y la app sigue igual. */
function textoAdminPres(){
  if (!ADMIN_VISTO) return "Ernesto · —";
  var t = Date.parse(ADMIN_VISTO); if (isNaN(t)) return "Ernesto · —";
  var min = (Date.now() - t) / 60000;
  if (min < 3) return "Ernesto · ● en línea";
  var d = new Date(t);
  function p2(x){ return (x < 10 ? "0" : "") + x; }
  var base = min < 60 ? "hace " + Math.max(1, Math.floor(min)) + " min"
    : min < 1440 ? "hace " + Math.floor(min / 60) + " h"
    : "hace " + Math.floor(min / 1440) + " d";
  return "Ernesto · última vez " + base + " · a las " + p2(d.getHours()) + ":" + p2(d.getMinutes());
}
function pintarAdminPres(){
  var el = $("c_pres"); if (el) el.textContent = textoAdminPres();
}
function cargarAdminPres(){
  if (!SESION) return;
  rpcChat("ver_presencia", { p_codigo: SESION }).then(function(r){
    if (r && r.ok && r.usuarios) {
      r.usuarios.forEach(function(u){ if (u.codigo === "ADMIN") ADMIN_VISTO = u.visto || null; });
      pintarAdminPres();
      if (CHAT_MSGS.length) pintarChat(CHAT_MSGS);   // los estados se repintan con el latido nuevo
    }
  });
}
/* ===== KIT DE MEDIOS v1.4.3: previa real, visor a pantalla
   completa y tarjeta de documento con descarga (Blob/objectURL
   con fallback a dataURL; en iOS el botón descarga o abre). ===== */
function fmtBytesMT(n){
  n = Number(n) || 0;
  if (!n) return "";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(n < 10240 ? 1 : 0).replace(".", ",") + " KB";
  return (n / 1048576).toFixed(2).replace(".", ",") + " MB";
}
function tamDeDatosMT(datos){
  var s = String(datos || "");
  var i = s.indexOf(",");
  var b64 = i >= 0 ? s.slice(i + 1) : s;
  return Math.floor(b64.length * 3 / 4);
}
function iconoDocMT(m){
  /* v1.4.4: icono de trazo (DISENO-PRO §5), no emoji estructural. */
  var mime = String((m && (m.adj_mime || m.mime)) || "").toLowerCase();
  var nom = String((m && (m.adj_nombre || m.nombre)) || "").toLowerCase();
  if (mime.indexOf("pdf") >= 0 || /\.pdf$/.test(nom)) return ico("i-doc");
  if (mime.indexOf("image/") === 0 || /\.(png|jpe?g|gif|webp)$/.test(nom)) return ico("i-img");
  return ico("i-file");
}
function datosNormalizadosMT(m){
  var s = String((m && m.adj_datos) || "");
  if (!s) return "";
  return s.indexOf("data:") === 0 ? s : "data:" + (m.adj_mime || "application/octet-stream") + ";base64," + s;
}
function blobDesdeDataURLMT(du){
  var s = String(du || "");
  var mime = "application/octet-stream", b64 = s;
  if (s.indexOf("data:") === 0) { var c = s.indexOf(","); mime = s.slice(5, c).split(";")[0] || mime; b64 = s.slice(c + 1); }
  var bin = atob(b64);
  var arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
function urlDeMensajeMT(m){
  var du = datosNormalizadosMT(m);
  if (!du) return { url: null, revocar: false };
  try { return { url: URL.createObjectURL(blobDesdeDataURLMT(du)), revocar: true }; }
  catch(e){ return { url: du, revocar: false }; }
}
function tarjetaDocMT(m){
  var nom = m.adj_nombre || "Archivo";
  var tam = m.adj_bytes || m.tam || (m.adj_datos ? tamDeDatosMT(m.adj_datos) : 0);
  return '<span class="docCard"><span class="docIco">' + iconoDocMT(m) + '</span>'
    + '<span class="docMeta"><b>' + escChat(nom) + '</b>' + (tam ? fmtBytesMT(tam) : "Documento") + '</span>'
    + '<button type="button" class="docDl" data-docdl="' + esc(m.id) + '" title="Descargar ' + esc(nom) + '">' + ico("i-dl") + '</button></span>';
}
var visorUrlRevocarMT = null;
function visorElMT(){
  var v = document.getElementById("visorFoto");
  if (!v) {
    v = document.createElement("div");
    v.className = "visorFoto"; v.id = "visorFoto";
    v.innerHTML = '<div class="visorBar"><span class="visorNom" id="visorNom"></span>'
      + '<a class="visorBtn" id="visorDl" download>Guardar</a>'
      + '<button type="button" class="visorBtn" id="visorX">✕ Cerrar</button></div>'
      + '<div class="visorImgWrap"><img class="visorImg" id="visorImg" alt="Foto ampliada"></div>';
    document.body.appendChild(v);
    v.querySelector("#visorX").addEventListener("click", cerrarVisorMT);
    v.querySelector(".visorImgWrap").addEventListener("click", function(e){ if (e.target === this) cerrarVisorMT(); });
  }
  return v;
}
function mostrarVisorMT(url, nombre){
  var v = visorElMT();
  v.querySelector("#visorNom").textContent = nombre || "Foto";
  v.querySelector("#visorImg").src = url;
  var dl = v.querySelector("#visorDl");
  dl.href = url;
  dl.setAttribute("download", nombre || "foto");
  v.classList.add("abierto");
}
function cerrarVisorMT(){
  var v = document.getElementById("visorFoto");
  if (v) { v.classList.remove("abierto"); var im = v.querySelector("#visorImg"); if (im) im.removeAttribute("src"); }
  if (visorUrlRevocarMT) { try { URL.revokeObjectURL(visorUrlRevocarMT); } catch(e){} visorUrlRevocarMT = null; }
}
/* ===== v1.4.8: EDITOR DE FOTO A PANTALLA COMPLETA (paso WhatsApp) =====
   Igual que en Mi Negocio v11: elegir una foto abre el editor — la
   foto grande, el texto (pie de foto) abajo y el botón redondo de
   enviar. Al enviar, el pie pasa al compositor y sale por la cola
   de siempre (chatEnviar): foto y texto en UN solo mensaje. */
function editorFotoElMT(){
  var v = document.getElementById("editorFoto");
  if (!v) {
    v = document.createElement("div");
    v.className = "editorFotoWA"; v.id = "editorFoto";
    v.innerHTML = '<div class="edFotoBar"><button type="button" class="visorBtn" id="edFotoXMT">✕ Descartar</button><span class="edFotoNom" id="edFotoNomMT"></span></div>'
      + '<div class="edFotoImgWrap"><img class="edFotoImg" id="edFotoImgMT" alt="Foto a enviar"></div>'
      + '<div class="edFotoPie"><div class="compBox"><textarea id="edFotoTxtMT" rows="1" placeholder="Escribe el texto de la foto…"></textarea></div>'
      + '<button type="button" class="sendBtn" id="edFotoOkMT" aria-label="Enviar la foto con su texto"><svg class="ic" aria-hidden="true"><use href="#i-send"/></svg></button></div>';
    document.body.appendChild(v);
    v.querySelector("#edFotoXMT").addEventListener("click", function(){
      CHAT_ADJ = null; pintarPreviaAdjMT(); cerrarEditorFotoMT();
    });
    v.querySelector("#edFotoOkMT").addEventListener("click", function(){
      var cap = v.querySelector("#edFotoTxtMT").value || "";
      var t = $("c_txt"); if (t) t.value = cap;
      cerrarEditorFotoMT();
      chatEnviar();
    });
    v.querySelector("#edFotoTxtMT").addEventListener("keydown", function(e){
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); v.querySelector("#edFotoOkMT").click(); }
    });
  }
  return v;
}
function abrirEditorFotoMT(){
  if (!CHAT_ADJ || CHAT_ADJ.tipo !== "foto") return;
  var v = editorFotoElMT();
  v.querySelector("#edFotoNomMT").textContent = CHAT_ADJ.nombre || "Foto";
  v.querySelector("#edFotoImgMT").src = CHAT_ADJ.datos;
  v.querySelector("#edFotoTxtMT").value = "";
  v.classList.add("abierto");
  var t = v.querySelector("#edFotoTxtMT");
  if (t) setTimeout(function(){ try { t.focus(); } catch(e){} }, 80);
}
function cerrarEditorFotoMT(){
  var v = document.getElementById("editorFoto");
  if (v) { v.classList.remove("abierto"); var im = v.querySelector("#edFotoImgMT"); if (im) im.removeAttribute("src"); }
}
function abrirVisorMsgMT(m){
  if (!m) return;
  var r = urlDeMensajeMT(m);
  if (!r.url) return;
  if (visorUrlRevocarMT) { try { URL.revokeObjectURL(visorUrlRevocarMT); } catch(e){} visorUrlRevocarMT = null; }
  visorUrlRevocarMT = r.revocar ? r.url : null;
  mostrarVisorMT(r.url, m.adj_nombre || "Foto");
}
function descargarDocMT(m){
  if (!m) return;
  if (!m.adj_datos && m.adj_tiene) { cargarAdjuntoMsg(m.id); return; }   /* v1.5.3 (E-9): bajo demanda; el siguiente toque ya descarga */
  var r = urlDeMensajeMT(m);
  if (!r.url) return;
  var a = document.createElement("a");
  a.href = r.url;
  a.setAttribute("download", m.adj_nombre || "archivo");
  document.body.appendChild(a);
  try { a.click(); } catch(e){ try { window.open(r.url, "_blank"); } catch(e2){} }
  setTimeout(function(){
    try { document.body.removeChild(a); } catch(e){}
    if (r.revocar) { try { URL.revokeObjectURL(r.url); } catch(e){} }
  }, 4000);
}
/* v1.4.4: la cara del botón de micrófono es un icono de trazo; al
   grabar, la etiqueta muestra el tiempo (sin emojis de estructura). */
function micPintarMT(t){
  var l = $("c_mic_lab"); if (!l) return;
  if (t === null || t === undefined) l.innerHTML = ico("i-mic");
  else l.textContent = t;
}
function botonQuitarAdjMT(){
  var b = document.createElement("button"); b.type = "button"; b.className = "miniBtn"; b.textContent = "Quitar";
  b.addEventListener("click", function(){ CHAT_ADJ = null; pintarPreviaAdjMT(); });
  return b;
}
function pintarPreviaAdjMT(){
  var an = $("c_adj_nom"); if (!an) return;
  an.innerHTML = "";
  if (!CHAT_ADJ || CHAT_ADJ.tipo === "voz") return; /* la voz pinta su propia previa con reproductor */
  var wrap = document.createElement("div"); wrap.className = "prevAdj";
  if (CHAT_ADJ.tipo === "foto") {
    var im = document.createElement("img"); im.className = "prevFoto"; im.src = CHAT_ADJ.datos; im.alt = "Foto a enviar";
    im.addEventListener("click", function(){ if (CHAT_ADJ) mostrarVisorMT(CHAT_ADJ.datos, CHAT_ADJ.nombre); });
    wrap.appendChild(im);
    var meta = document.createElement("span"); meta.className = "prevMeta";
    meta.innerHTML = "<b>" + escChat(CHAT_ADJ.nombre || "Foto") + "</b>" + (fmtBytesMT(CHAT_ADJ.tam || tamDeDatosMT(CHAT_ADJ.datos)) || "") + " · Toca la imagen para verla grande. El texto que escribas sale JUNTO con la foto, en un solo mensaje.";
    wrap.appendChild(meta);
  } else {
    var ic = document.createElement("span"); ic.className = "docIco"; ic.innerHTML = iconoDocMT({ adj_mime: CHAT_ADJ.mime, adj_nombre: CHAT_ADJ.nombre });
    wrap.appendChild(ic);
    var meta2 = document.createElement("span"); meta2.className = "prevMeta";
    meta2.innerHTML = "<b>" + escChat(CHAT_ADJ.nombre || "Archivo") + "</b>" + (fmtBytesMT(CHAT_ADJ.tam || tamDeDatosMT(CHAT_ADJ.datos)) || "Archivo listo");
    wrap.appendChild(meta2);
  }
  wrap.appendChild(botonQuitarAdjMT());
  an.appendChild(wrap);
}
function pintarChat(msgs){
  var box = $("c_hilo"); if (!box) return;
  CHAT_MSGS = msgs || [];
  if (!msgs || !msgs.length){
    box.innerHTML = '<div class="chatVacio">Todavía no hay mensajes. Escríbele a Ernesto lo que necesites: dudas de un trato, algo que no funciona o una idea.</div>';
    return;
  }
  var h = "";
  msgs.forEach(function(m){
    var mio = m.de === SESION;
    var est = mio ? estadoMsgBusc(m) : "";
    h += '<div class="msg ' + (mio ? "me" : "him") + '"><div class="bur">' + escChat(m.texto) + '</div><div class="mhora">' + (mio ? "Tú" : "Ernesto") + " · " + horaChat(m.creado) + est + "</div></div>";
  });
  box.innerHTML = h;
  try { box.scrollTop = box.scrollHeight; } catch(e){}
}
var chatCargando = false;
function chatCargar(){
  if (!SESION || chatCargando) return;
  chatCargando = true;
  cargarAdminPres();
  rpcChat("leer_chat", { p_codigo: SESION, p_con: "ADMIN", p_clave: SESION, p_buscar: null }).then(function(r){
    chatCargando = false;
    if (r && r.ok && r.mensajes) { pintarChat(r.mensajes); pintarBadge(0); }  // leer marca leído: el distintivo se apaga
  });
}
function pintarBadge(n){
  var b = $("chatBadge"); if (!b) return;
  if (n > 0) { b.textContent = n > 99 ? "99+" : String(n); b.classList.remove("hide"); }
  else b.classList.add("hide");
}
function chatBadge(){
  if (!SESION) { pintarBadge(0); return; }
  rpcChat("mensajes_sin_leer", { p_codigo: SESION, p_clave: SESION }).then(function(r){
    if (r && r.ok) pintarBadge(r.sin_leer || 0);
  });
}
/* ===== Tarifa y panel EN VIVO (v1.3.0) =====
   Ernesto publica desde PanelPRO («Publicar ahora») y la app lo lee
   aquí al abrir y al Actualizar, SIN pasar por GitHub. Si las puertas
   aún no existen o no hay red, no llega nada y manda datos.json,
   exactamente como en la 1.2.1 (respaldo intacto). */
function aplicarTarifaViva(){
  if (!TARIFA_VIVA) return;
  TARIFA_FUENTE = "viva";   /* v1.5.3 (E-7) */
  T = Object.assign({}, T, TARIFA_VIVA);   // los bonos y demás campos se quedan de datos.json
  try { $("tarifaTxt").innerHTML = tarifaText(); } catch(e){}
  pintaFrescura();
  calcSaldo(); calcTransf();
  if (SESION) renderPanel();
}
function leerTarifaViva(){
  rpcChat("leer_tarifa", {}).then(function(r){
    if (r && r.ok && r.ingreso_ref360 !== undefined && r.ingreso_ref360 !== null) {
      TARIFA_VIVA = { ingresoRef360: Number(r.ingreso_ref360), libroRef: Number(r.libro_ref),
        salidaRef: Number(r.salida_ref), pctSaldo: Number(r.comision_saldo),
        pctTransf: Number(r.comision_transf), pisoTransf: Number(r.piso_transf) };
      TARIFA_VIVA_EN = r.actualizado || "";
      aplicarTarifaViva();
    }
  });
}
var panelCargando = false;
function leerPanelVivo(){
  if (!SESION || panelCargando) return;
  panelCargando = true;
  rpcChat("leer_panel", { p_codigo: SESION }).then(function(r){
    panelCargando = false;
    if (r && r.ok) { PANEL_VIVO = { nombre: r.nombre || "", tratos: r.tratos || [] }; panelCacheSet(PANEL_VIVO); renderPanel(); }
  });
}
function cargarVivo(){ leerTarifaViva(); leerPanelVivo(); cargarDinero(); }

/* ===== v1.5.6: MI CUPO + ESTRELLAS (Libro del Dinero) =====
   dinero_leer_estado con SU codigo devuelve SOLO lo suyo: su nivel
   de estrellas, su % vigente, su cupo, su dinero en mano y sus
   vueltas abiertas con reloj y comision proyectada. Su % de
   estrellas manda en los estimados de SU calculadora. Si la puerta
   no responde, la app sigue como siempre, sin el bloque. */
var DINERO = null;
function cargarDinero(){
  if (!SESION) return;
  fetch(SB_RPC + "dinero_leer_estado", { method: "POST", headers: sbHeaders(), body: JSON.stringify({ p_codigo: SESION }) })
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){
      if (!d || d.rol !== "buscador") return;
      DINERO = d;
      if (d.estrellas) { T.pctSaldo = Number(d.estrellas.pct_saldo); T.pctTransf = Number(d.estrellas.pct_transferencia); }
      pintarCupo();
    }).catch(function(){});
}
function pintarCupo(){
  var box = $("p_cupo"); if (!box || !DINERO || !DINERO.estrellas) return;
  var e = DINERO.estrellas;
  box.classList.remove("hide");
  $("cu_est").textContent = "⭐ " + (Math.round(Number(e.estrellas) * 10) / 10);
  $("cu_pct").textContent = "Cobras el " + e.pct_saldo + "% del saldo · " + e.pct_transferencia + "% de la transferencia";
  var s = e.siguiente;
  if (s) {
    $("cu_prog_lab").innerHTML = "Llevas <b>" + e.conteo_ganadoras + " de " + s.umbral_conteo + "</b> transacciones ganadoras pa ⭐ " + s.estrellas + " — te faltan <b>" + s.faltan + "</b>. Al subir, cobras " + s.pct_saldo + "% del saldo.";
    $("cu_prog_bar").style.width = Math.min(100, s.umbral_conteo ? (e.conteo_ganadoras / s.umbral_conteo * 100) : 0) + "%";
  } else {
    $("cu_prog_lab").innerHTML = "Llevas <b>" + e.conteo_ganadoras + "</b> transacciones ganadoras · ¡nivel máximo! ⭐ 5";
    $("cu_prog_bar").style.width = "100%";
  }
  $("cu_info").innerHTML = "Tu cupo: <b>" + fmtN(DINERO.cupo || 0) + "</b> · dinero en tu mano: <b>" + fmtN(DINERO.en_mano || 0) + "</b>";
  var html = "";
  (DINERO.vueltas || []).filter(function(v){ return v.estado === "abierta"; }).forEach(function(v){
    var h = v.reloj ? Number(v.reloj.horas_desde_entrega || 0) : 0;
    html += '<div class="trato"><span>' + (v.tipo === "saldo" ? "📱 Saldo" : "🏦 Transferencia") + " · capital " + fmtN(v.capital) +
      "<br><small>⏱️ " + (h < 1 ? "menos de 1 h" : Math.round(h) + " h") + " en la calle — el mercado no espera" +
      (v.pago_hecho ? " · ✅ tu pago está hecho: " + fmtN(v.comision) : "") +
      (v.proyeccion ? "<br>Si Ernesto vende ahora, tu comisión sería " + fmtN(v.proyeccion.comision_proyectada) : "") +
      "</small></span></div>";
  });
  $("cu_vueltas").innerHTML = html ? ('<label>Tus vueltas abiertas</label>' + html) : "";
}

function chatEnviar(){
  var warn = $("c_warn"); warn.style.display = "none";
  function fallo(m){ warn.style.display = "block"; warn.textContent = m; }
  if (!SESION) return fallo("Primero entra con tu código personal desde la pantalla de inicio.");
  var txt = ($("c_txt").value || "").trim();
  if (!txt) return fallo("Escribe el mensaje primero.");
  var btn = $("c_btn"); btn.disabled = true;
  rpcChat("enviar_mensaje", { p_de: SESION, p_para: "ADMIN", p_texto: txt, p_clave: SESION }).then(function(r){
    btn.disabled = false;
    if (r && r.ok) { $("c_txt").value = ""; chatCargar(); }
    else fallo("El mensaje quedó guardado en tu teléfono y se envía solo cuando vuelva la conexión.");
  });
}

/* ===== Refresco manual / al volver a primer plano ===== */
var lastRefresh = 0;
function refrescarTodo(){
  lastRefresh = Date.now();
  var ft = $("freshTxt"); if (ft) ft.textContent = "Actualizando…";
  var p = loadData();
  syncReportes(); despacharChat(); chatBadge(); tocarPresencia(); cargarVivo();
  if (!$("viewAyuda").classList.contains("hide")) chatCargar();
  validarSesionRemota();   /* v1.5.3 (E-3+E-6): revoca si toca y libera/pone la pausa segun el servidor */
  if (p && p.then) p.then(function(){ pintaFrescura(); });
}

/* ===== Eventos ===== */
["s_precio","s_cant"].forEach(function(id){ $(id).addEventListener("input", calcSaldo); });
["t_ef","t_pct"].forEach(function(id){ $(id).addEventListener("input", function(){ if (id === "t_pct") $("t_rng").value = $("t_pct").value || 0; calcTransf(); }); });
$("t_rng").addEventListener("input", function(){ $("t_pct").value = $("t_rng").value; calcTransf(); });
document.querySelectorAll(".chip[data-p]").forEach(function(ch){ ch.addEventListener("click", function(){ $("s_precio").value = ch.getAttribute("data-p"); calcSaldo(); }); });
document.querySelectorAll(".chip[data-t]").forEach(function(ch){ ch.addEventListener("click", function(){ $("t_pct").value = ch.getAttribute("data-t"); $("t_rng").value = ch.getAttribute("data-t"); calcTransf(); }); });
function showView(v){
  ["Calc","Rep","Panel","Ayuda"].forEach(function(x){
    $("tab" + x).classList.toggle("on", x === v);
    $("view" + x).classList.toggle("hide", x !== v);
  });
  if (v === "Rep") renderOutbox();
  if (v === "Panel") renderPanel();
  if (v === "Ayuda") chatCargar();   // al leer, el propio hilo apaga el distintivo (leer marca leído)
}
$("tabCalc").addEventListener("click", function(){ showView("Calc"); });
$("tabRep").addEventListener("click", function(){ showView("Rep"); });
$("tabPanel").addEventListener("click", function(){ showView("Panel"); });
$("tabAyuda").addEventListener("click", function(){ showView("Ayuda"); try { rtSuscribirMT(); } catch(e){} });
$("r_tipo_s").addEventListener("click", function(){ REP_TIPO = "saldo"; $("r_tipo_s").classList.add("on"); $("r_tipo_t").classList.remove("on"); $("r_box_s").classList.remove("hide"); $("r_box_t").classList.add("hide"); });
$("r_tipo_t").addEventListener("click", function(){ REP_TIPO = "transferencia"; $("r_tipo_t").classList.add("on"); $("r_tipo_s").classList.remove("on"); $("r_box_t").classList.remove("hide"); $("r_box_s").classList.add("hide"); });
$("r_btn").addEventListener("click", reportar);
$("c_btn").addEventListener("click", chatEnviar);
$("c_txt").addEventListener("keydown", function(ev){ if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); chatEnviar(); } });
$("btnSalir").addEventListener("click", function(){ salir(""); });
$("l_btn").addEventListener("click", function(){ intentarLogin($("l_cod").value, false); });
$("l_cod").addEventListener("keydown", function(ev){ if (ev.key === "Enter") { ev.preventDefault(); intentarLogin($("l_cod").value, false); } });
$("btnAct").addEventListener("click", refrescarTodo);
document.addEventListener("visibilitychange", function(){
  if (!document.hidden && Date.now() - lastRefresh > 60000) refrescarTodo();
});
setInterval(function(){ try { pintaFrescura(); } catch(e){} try { tocarPresencia(); } catch(e){} try { validarSesionRemota(); } catch(e){} }, 60000);
setInterval(function(){
  if (!SESION) return;
  try { chatBadge(); } catch(e){}
  try { cargarAdminPres(); } catch(e){}
  try { despacharChat(); } catch(e){}
  try { if (!$("viewAyuda").classList.contains("hide")) chatCargar(); } catch(e){}
}, 20000);
window.addEventListener("online", function(){ try { despacharChat(); } catch(e){} try { syncReportes(); } catch(e){} try { if (SESION) chatCargar(); } catch(e){} });   /* v1.5.3 (E-5): tambien la cola de REPORTES */
window.addEventListener("focus", function(){ try { despacharChat(); } catch(e){} try { syncReportes(); } catch(e){} });   /* v1.5.3 (E-5): al recuperar el foco */
setInterval(function(){
  // v1.3.1: con el chat abierto, el hilo se refresca para que los estados
  // (entregado/visto) cambien solos, estilo WhatsApp.
  // v1.4.2: cada 3 s con el chat abierto y la app VISIBLE (antes 15 s);
  // el timbre Realtime acelera el resto.
  try { if (SESION && document.visibilityState === "visible" && !$("viewAyuda").classList.contains("hide")) chatCargar(); } catch(e){}
}, 3000);
document.addEventListener("visibilitychange", function(){
  try {
    if (document.visibilityState !== "visible" || !SESION) return;
    if (!$("viewAyuda").classList.contains("hide")) { rtSuscribirMT(); chatCargar(); }
  } catch(e){}
});
try { $("verLab").textContent = APP_VERSION; } catch(e){}

if ("serviceWorker" in navigator && !esNativo()) {
  window.addEventListener("load", function(){ navigator.serviceWorker.register("sw.js").catch(function(){}); });
}

/* ===== Arranque ===== */
lastRefresh = Date.now();
seguro(function(){ return loadData(); }, "la tarifa");
seguro(function(){ leerTarifaViva(); }, "la tarifa en vivo");
seguro(function(){ renderOutbox(); }, "tus reportes");
seguro(function(){ syncReportes(); }, "el envío de reportes");
(function arranque(){
  var previa = sesionGet();
  var urlCod = "";
  try { urlCod = normCod(new URLSearchParams(window.location.search).get("codigo")); } catch(e){}
  if (urlCod) {
    try { history.replaceState(null, "", window.location.pathname + window.location.hash); } catch(e){}
    mostrarGate("");
    intentarLogin(urlCod, true).then(function(ok){
      if (ok) showView("Panel");   // v1.4.5: quien entra por su enlace aterriza en «Mi panel»
      else if (previa && previa !== urlCod) entrar(previa);   // enlace malo: se respeta la sesión que hubiera
    });
  } else if (previa) {
    entrar(previa);
  } else {
    mostrarGate("");
  }
})();

/* ===== ENLACE PROFUNDO (v1.4.5 · Android App Links) =====
   El enlace personal (?codigo=) también llega DENTRO de la APK:
   con la app instalada, Android se lo entrega a ella (verificación
   por assetlinks.json + intent-filter autoVerify en el manifiesto)
   y el plugin App de Capacitor pasa la URL a este consumidor. Se
   trata igual que el enlace web: valida el código con el flujo de
   login único y aterriza en «Mi panel». Si la sesión ya es la del
   enlace, solo navega. En la web no hay plugin y este bloque no
   hace nada. */
function consumirEnlaceApp(url){
  var cod = "";
  try { cod = normCod(new URL(String(url || "")).searchParams.get("codigo")); } catch(e){}
  if (!cod) return;
  if (SESION && SESION === cod) { showView("Panel"); return; }
  var previa = SESION;
  intentarLogin(cod, true).then(function(ok){
    if (ok) showView("Panel");
    else if (previa && previa !== cod) entrar(previa);   // enlace malo: se respeta la sesión que hubiera
  });
}
(function(){
  var P = window.Capacitor && window.Capacitor.Plugins;
  var App = P && P.App;
  if (!App) return;
  try {
    if (App.getLaunchUrl) App.getLaunchUrl().then(function(r){ if (r && r.url) consumirEnlaceApp(r.url); }).catch(function(){});
    if (App.addListener) App.addListener("appUrlOpen", function(ev){ if (ev && ev.url) consumirEnlaceApp(ev.url); });
  } catch(e){}
})();

/* =====================================================================
   v1.4.0 — PERFIL + CHAT PRO + TEXTOS + AVISOS + MI SEMANA
   v1.4.2 — VOZ PRO (mime real + reproductor estilo WhatsApp vía Blob) y
   chat casi en vivo: polling de 3 s con el chat abierto y timbre Realtime
   Broadcast (mismo canal que Mi Negocio) al enviar.
   Todo degrada en silencio si una puerta aún no existe (el paquete
   SQL único las activa): la app sigue como en la 1.3.1.
   ===================================================================== */

/* ===== Utilidades de textos (v1.4.5) =====
   De esta app salió POR COMPLETO el generador genérico de
   plantillas (formulario libre con tono/tamaño/moneda/producto):
   los textos del buscador son SOLO las plantillas PRO de abajo,
   armadas con la tarifa pública viva y los datos públicos de
   Ernesto. Del motor compartido quedan únicamente las dos
   utilidades puras que esas plantillas usan (miles e historial),
   copiadas tal cual de su fuente. El motor completo sigue vivo
   solo en la app de Ernesto. El cliente push (web) se inyecta
   como siempre para la versión navegador. */
var TextosMotor = (function(){
  "use strict";
  /* Formato de miles con ESPACIO: 125 000 CUP. */
  function miles(n){
    var s = String(Math.round(Number(n) * 100) / 100);
    var partes = s.split(".");
    partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return partes.join(".");
  }
  /* Historial local: últimas 30. */
  function historialPush(hist, entrada){
    var h = Array.isArray(hist) ? hist.slice() : [];
    h.unshift(entrada);
    return h.slice(0, 30);
  }
  return { miles: miles, historialPush: historialPush };
})();
/*__PUSH_CLIENTE__*/

/* ========== VOZ PRO v1.4.2 + TIMBRE REALTIME (módulo global) ==========
   El formato real manda: notas viejas llegan sin mime y se olfatea por la
   cabecera base64 (GkX=webm · T2dn=ogg · resto/ftyp=mp4). La reproducción va
   SIEMPRE por Blob/objectURL (iOS no reproduce bien el src data: directo). */
var vozDatosMT = {}, vozAudiosMT = {}, vozContadorMT = 0;
function mimeVozRealMT(datos) {
  var s = String(datos == null ? "" : datos);
  var m = s.match(/^data:([^;,]+)/);
  if (m) return m[1];
  if (s.indexOf("GkX") === 0) return "audio/webm";
  if (s.indexOf("T2dn") === 0) return "audio/ogg";
  return "audio/mp4";
}
function datosCuerpoMT(datos) {
  var s = String(datos == null ? "" : datos);
  var i = s.indexOf("base64,");
  return i >= 0 ? s.slice(i + 7) : s;
}
function dataUrlVozMT(datos) {
  var s = String(datos == null ? "" : datos);
  if (s.indexOf("data:") === 0) return s;
  return "data:" + mimeVozRealMT(s) + ";base64," + s;
}
function fmtTiempoVozMT(seg) {
  if (!isFinite(seg) || seg == null || seg < 0) seg = 0;
  seg = Math.floor(seg);
  var m = Math.floor(seg / 60), ss = seg % 60;
  return m + ":" + (ss < 10 ? "0" : "") + ss;
}
function picosVozMT(semilla, n) {
  var h = 2166136261, out = [];
  var s = String(semilla || "");
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  for (var j = 0; j < n; j++) {
    h ^= (h << 13); h ^= (h >>> 17); h ^= (h << 5);
    out.push(22 + Math.abs(h % 78));
  }
  return out;
}
function reproductorVozHtmlMT(m) {
  /* v1.5.0: la clave sale del ID del mensaje (estable entre
     repintados incrementales); sin id (previas sueltas) se sigue
     usando el contador de siempre. */
  var id = (m && m.id != null) ? "vm" + String(m.id).replace(/[^a-zA-Z0-9]/g, "") : "m" + (++vozContadorMT);
  vozDatosMT[id] = m.adj_datos;
  var picos = picosVozMT(datosCuerpoMT(m.adj_datos).slice(0, 48), 24);
  var onda = "";
  for (var i = 0; i < picos.length; i++) onda += '<i style="height:' + picos[i] + '%"></i>';
  return '<div class="vozP" data-vid="' + id + '"><button type="button" class="vozBtn" data-vplay="' + id + '" aria-label="Escuchar nota de voz">▶</button>' +
    '<div class="vozOnda">' + onda + '</div><span class="vozT">' + (m.adj_dur ? fmtTiempoVozMT(m.adj_dur) : "0:00") + '</span></div>';
}
function pararOtrasVocesMT(excepto) {
  Object.keys(vozAudiosMT).forEach(function (k) {
    if (k !== excepto && vozAudiosMT[k]) { try { vozAudiosMT[k].pause(); } catch (e) {} }
  });
}
function alistarReproductoresVozMT(raiz) {
  if (!raiz || !raiz.querySelectorAll) return;
  var botones = raiz.querySelectorAll("[data-vplay]");
  Array.prototype.forEach.call(botones, function (btn) {
    btn.addEventListener("click", function (e) { e.stopPropagation(); alternarVozMT(btn.getAttribute("data-vplay"), btn); });
  });
}
function alternarVozMT(id, btn) {
  var au = vozAudiosMT[id];
  if (au) {
    if (au.paused) { pararOtrasVocesMT(id); au.play(); } else { au.pause(); }
    return;
  }
  var cont = btn.closest ? btn.closest(".vozP") : null;
  var barras = cont ? cont.querySelectorAll(".vozOnda i") : [];
  var tiempo = cont ? cont.querySelector(".vozT") : null;
  var url = dataUrlVozMT(vozDatosMT[id]);
  var listo = function (src) {
    var a = new Audio();
    a.preload = "auto";
    a.src = src;
    vozAudiosMT[id] = a;
    a.addEventListener("loadedmetadata", function () {
      if (tiempo) tiempo.textContent = fmtTiempoVozMT(a.duration);
      picosRealesVozMT(dataUrlVozMT(vozDatosMT[id]), barras);
    });
    a.addEventListener("timeupdate", function () {
      if (tiempo) tiempo.textContent = fmtTiempoVozMT(a.currentTime);
      if (a.duration > 0) {
        var n = Math.floor((a.currentTime / a.duration) * barras.length);
        Array.prototype.forEach.call(barras, function (b, bi) { b.classList.toggle("on", bi < n); });
      }
    });
    var fin = function () { btn.textContent = "▶"; Array.prototype.forEach.call(barras, function (b) { b.classList.remove("on"); }); if (tiempo) tiempo.textContent = fmtTiempoVozMT(a.duration); };
    a.addEventListener("ended", fin);
    a.addEventListener("pause", function () { btn.textContent = "▶"; });
    a.addEventListener("play", function () { btn.textContent = "⏸"; });
    pararOtrasVocesMT(id);
    var p = a.play();
    if (p && p.catch) p.catch(function () { btn.textContent = "▶"; });
  };
  if (typeof fetch === "function") {
    fetch(url).then(function (r) { return r.blob(); }).then(function (b) { listo(URL.createObjectURL(b)); }).catch(function () { listo(url); });
  } else listo(url);
}
function picosRealesVozMT(dataUrl, barras) {
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || !barras || !barras.length || typeof fetch !== "function") return;
    fetch(dataUrl).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
      var ctx = new AC();
      return ctx.decodeAudioData(buf);
    }).then(function (audio) {
      var datos = audio.getChannelData(0), n = barras.length, paso = Math.max(1, Math.floor(datos.length / n));
      for (var i = 0; i < n; i++) {
        var max = 0;
        for (var j = 0; j < paso; j += 97) { var v = Math.abs(datos[i * paso + j] || 0); if (v > max) max = v; }
        barras[i].style.height = Math.max(14, Math.min(100, Math.round(max * 130))) + "%";
      }
    }).catch(function () { /* quedan los picos fijos */ });
  } catch (e) { /* quedan los picos fijos */ }
}
/* Timbre Realtime Broadcast: canal = hash de la pareja ordenada (el mismo
   cálculo que Mi Negocio) — el timbre no lleva texto; el contenido sigue
   viajando solo por las puertas RPC. */
function hashParChatMT(a, b) {
  var s = [String(a || ""), String(b || "")].sort().join("|");
  function h(sem) { var x = sem; for (var i = 0; i < s.length; i++) { x = ((x << 5) - x + s.charCodeAt(i)) | 0; } return (x >>> 0).toString(16); }
  return "chat-" + h(5381) + h(52711);
}
function chatCargarMT() { if (typeof chatCargar === "function") chatCargar(); }
var rtCanalMT = null;
function urlProyectoMT() { return SB_RPC.split("/rest/v1/")[0]; }
function rtClienteMT() {
  try {
    if (!window.supabase || !window.supabase.createClient) return null;
    if (!rtClienteMT._c) rtClienteMT._c = window.supabase.createClient(urlProyectoMT(), SB_KEY, { realtime: { params: { eventsPerSecond: 2 } } });
    return rtClienteMT._c;
  } catch (e) { return null; }
}
function rtSuscribirMT() {
  var cli = rtClienteMT();
  if (!cli || !SESION) return;
  try {
    if (rtCanalMT) return;
    rtCanalMT = cli.channel(hashParChatMT(SESION, "ADMIN"), { config: { broadcast: { self: false } } });
    rtCanalMT.on("broadcast", { event: "nuevo" }, function () {
      var v = $("viewAyuda");
      if (v && !v.classList.contains("hide")) chatCargarMT();
    });
    rtCanalMT.subscribe();
  } catch (e) { rtCanalMT = null; }
}
function rtTimbreMT() {
  var cli = rtClienteMT();
  if (!cli) return;
  try {
    var ch = cli.channel(hashParChatMT(SESION, "ADMIN"), { config: { broadcast: { self: false } } });
    var hecho = false;
    var cerrar = function () { if (hecho) return; hecho = true; try { cli.removeChannel(ch); } catch (e) {} };
    ch.subscribe(function (st) {
      if (st === "SUBSCRIBED") {
        ch.send({ type: "broadcast", event: "nuevo", payload: {} }).then(cerrar).catch(cerrar);
        setTimeout(cerrar, 1500);
      }
    });
    setTimeout(cerrar, 6000);
  } catch (e) {}
}

/* ===== RPC con mensaje de error (para detectar la pausa) ===== */
var EN_PAUSA = false;
function rpcMsg(fn, body){
  if (!window.fetch) return Promise.resolve({ ok: false, error: "sin fetch" });
  return fetch(SB_RPC + fn, { method: "POST", headers: sbHeaders(), body: JSON.stringify(body) })
    .then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){
        if (r.ok) { marcarRedOk(); return { ok: true, data: j }; }
        return { ok: false, error: (j && j.message) || ("HTTP " + r.status), data: j };
      });
    })
    .catch(function(e){ return { ok: false, error: String(e) }; });
}
function marcarPausaSiToca(errTxt){
  if (errTxt && String(errTxt).indexOf("pausa") !== -1) {
    EN_PAUSA = true;
    var pf = $("pf_pausa"); if (pf) pf.style.display = "block";
    return true;
  }
  return false;
}

/* ===== Adjuntos (foto comprimida / archivo <= 5 MB / voz) ===== */
var MAX_ADJ_MT = 5 * 1024 * 1024;
function comprimirFotoMT(file){
  return new Promise(function(res, rej){
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function(){
      var max = 1280, w = img.width, h = img.height;
      if (w > max || h > max) { var k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      var c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      res(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = function(){ URL.revokeObjectURL(url); rej(new Error("foto no válida")); };
    img.src = url;
  });
}
function leerArchivoMT(file, esFoto){
  if (file.size > MAX_ADJ_MT) return Promise.reject(new Error("Pesa más de 5 MB: no se puede adjuntar."));
  if (esFoto) return comprimirFotoMT(file).then(function(d){ return { tipo: "foto", datos: d, nombre: file.name || "Foto", mime: "image/jpeg" }; });
  return new Promise(function(res, rej){
    var fr = new FileReader();
    fr.onload = function(){ res({ tipo: "archivo", datos: String(fr.result), nombre: file.name || "Archivo", tam: file.size, mime: file.type || "" }); };
    fr.onerror = function(){ rej(new Error("no se pudo leer el archivo")); };
    fr.readAsDataURL(file);
  });
}

/* ===== PANEL v1.4.0: «Mi semana» + línea de pagado + historial ===== */
function fechaTratoMs(f){
  var t = Date.parse(f);
  if (!isNaN(t)) return t;
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(f || ""));
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
  return NaN;
}
function renderPanel(){
  var warn = $("p_warn"), body = $("p_body");
  if (!SESION) { body.classList.add("hide"); warn.style.display = "none"; return; }
  var bCache = panelCacheGet();
  var b = PANEL_VIVO ? { nombre: PANEL_VIVO.nombre || (bCache ? bCache.nombre : "") || nombreLocal(), tratos: PANEL_VIVO.tratos || [] } : bCache;
  if (!b) {
    warn.style.display = "block";
    warn.textContent = "Tus datos todavía no cargan en este teléfono. Toca «Actualizar» con conexión.";
    body.classList.add("hide"); return;
  }
  warn.style.display = "none"; body.classList.remove("hide");
  $("p_ses").textContent = SESION + (b.nombre ? " · " + b.nombre : "");
  var total = 0, recSaldo = 0, nTransf = 0, html = "";
  var ahora = new Date(); ahora.setHours(0, 0, 0, 0);
  var lunes = new Date(ahora); lunes.setDate(ahora.getDate() - ((ahora.getDay() + 6) % 7));
  var domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6); domingo.setHours(23, 59, 59, 999);
  var sRec = 0, sTra = 0;
  (b.tratos || []).forEach(function(tr){
    total += tr.comision || 0;
    if (tr.tipo === "saldo") recSaldo += Math.floor(Number(tr.recargas) || 0); /* REGLA DE BONOS 2026-11-13: solo recargas COMPLETAS de 360 */
    if (tr.tipo === "transferencia" && (Number(tr.monto) || 0) >= 5000) nTransf += 1; /* REGLA DE BONOS 2026-11-13: transf solo cuenta desde 5.000 CUP */
    var ms = fechaTratoMs(tr.fecha);
    if (!isNaN(ms) && ms >= lunes.getTime() && ms <= domingo.getTime()) {
      if (tr.tipo === "saldo") sRec += Math.floor(Number(tr.recargas) || 0); /* REGLA DE BONOS 2026-11-13: solo recargas COMPLETAS de 360 */
      if (tr.tipo === "transferencia" && (Number(tr.monto) || 0) >= 5000) sTra += 1; /* REGLA DE BONOS 2026-11-13: transf solo cuenta desde 5.000 CUP */
    }
    html += '<div class="trato"><span class="f">' + esc(tr.fecha) + "</span><span>" +
      (tr.tipo === "saldo" ? ico("i-phone", "mini") + " " : ico("i-bank", "mini") + " ") + (esc(tr.nota || "")) +
      (tr.estado === "pagado" ? '<br><small>' + ico("i-check", "mini") + ' Comisión pagada' + (tr.pagado_en ? " el " + esc(tr.pagado_en) : "") + "</small>" : "") +
      '</span><span class="c">' + fmt(tr.comision || 0) + "</span></div>";
  });
  if (!html) html = '<div class="trato"><span>Aún no tienes tratos confirmados. ¡A buscar!</span></div>';
  $("p_total").textContent = fmt(total);
  $("p_name").textContent = b.nombre ? ("de " + b.nombre) : "";
  $("p_tratos").innerHTML = html;
  var bsM = T.bonoSaldoMeta, btM = T.bonoTransfMeta;
  $("p_bs_lab").textContent = recSaldo + " de " + bsM + " recargas → bono " + fmt(T.bonoSaldoMonto);
  $("p_bs_bar").style.width = Math.min(100, bsM ? (recSaldo / bsM * 100) : 0) + "%";
  $("p_bt_lab").textContent = nTransf + " de " + btM + " tratos → bono " + fmt(T.bonoTransfMonto);
  $("p_bt_bar").style.width = Math.min(100, btM ? (nTransf / btM * 100) : 0) + "%";
  var semEl = $("p_semana");
  if (semEl) {
    semEl.innerHTML =
      '<div class="hint">Esta semana (lunes a domingo) llevas <b>' + sRec + " de " + bsM + " recargas de saldo</b> para el bono de " + fmt(T.bonoSaldoMonto) +
      ' y <b>' + sTra + " de " + btM + " tratos de transferencia</b> para el bono de " + fmt(T.bonoTransfMonto) + ". Solo cuentan los tratos que Ernesto ya aprobó.</div>" +
      '<label>Bono de saldo — esta semana</label><div class="semBar"><div style="width:' + Math.min(100, bsM ? (sRec / bsM * 100) : 0) + '%"></div></div>' +
      '<label>Bono de transferencia — esta semana</label><div class="semBar"><div style="width:' + Math.min(100, btM ? (sTra / btM * 100) : 0) + '%"></div></div>';
  }
}

/* ===== CHAT PRO v1.4.0 ===== */
var CHAT_RESP = null;      /* mensaje citado al responder */
var CHAT_ADJ = null;       /* adjunto listo para enviar */
var CHAT_FIJADO = null;    /* mensaje fijado por Ernesto */
var CHAT_TEMP_SEG = 0;     /* mensajes temporales (segundos; 0 = no) */
var MENU_MSG = null;
var EMOJIS_REAC = ["❤️", "👍", "😂", "👏", "🔥"];

/* ===== v1.4.4: COLA DE SALIDA DEL CHAT (local-first) =====
   Enviar NUNCA pierde el mensaje: entra en la cola con su opId y
   su sello 🕐, y se despacha solo cuando la API responde (al
   volver la red, al abrir la app, al refrescar). El opId viaja en
   p_op_id: desambigua la puerta enviar_mensaje y el servidor
   deduplica — reintentar jamás duplica. */
var CHAT_OUT_LS = "busc_chat_outbox";
var CHAT_OUT_MEM = null;
function chatOutGet(){
  if (CHAT_OUT_MEM) return CHAT_OUT_MEM;
  try { CHAT_OUT_MEM = JSON.parse(localStorage.getItem(CHAT_OUT_LS) || "[]"); } catch(e){ CHAT_OUT_MEM = []; }
  return CHAT_OUT_MEM;
}
function chatOutSet(a){
  CHAT_OUT_MEM = a;
  try { localStorage.setItem(CHAT_OUT_LS, JSON.stringify(a)); } catch(e){ /* sin espacio: la copia en memoria sigue viva y se despacha igual */ }
}
var chatDespachando = false;
function despacharChat(){
  if (chatDespachando || EN_PAUSA || !SESION) return;
  var a = chatOutGet(); if (!a.length) return;
  /* v1.4.7: una «fallida» no bloquea la cola: se despacha la
     primera que NO esté marcada (la fallida espera su toque). */
  var item = a.filter(function(x){ return !x.fallida; })[0];
  if (!item) return;
  chatDespachando = true;
  var body = { p_de: SESION, p_para: "ADMIN", p_texto: item.texto || "", p_clave: SESION,
    p_adj_tipo: item.adj ? item.adj.tipo : null,
    p_adj_datos: item.adj ? item.adj.datos : null,
    p_adj_nombre: item.adj ? (item.adj.nombre || null) : null,
    p_adj_mime: item.adj ? (item.adj.mime || null) : null,
    p_adj_tam: item.adj ? (item.adj.tam || null) : null,
    p_resp_de: item.respId || null,
    p_op_id: item.opId };
  rpcMsg("enviar_mensaje", body).then(function(r){
    chatDespachando = false;
    if (r.ok) {
      liberarPausa();   /* v1.5.3 (E-6): el servidor acepto una escritura */
      chatOutSet(chatOutGet().filter(function(x){ return x.opId !== item.opId; }));
      rtTimbreMT();   /* v1.4.2: timbre instantáneo a Mi Negocio de Ernesto */
      if (chatOutGet().length) { pintarChat(CHAT_MSGS); despacharChat(); }
      else chatCargar();
    } else if (marcarPausaSiToca(r.error)) {
      chatFallo("Estás en pausa: habla con Ernesto");
    } else {
      /* v1.4.7: el fallo ya no es mudo para siempre — se cuentan
         los intentos y al tercero la burbuja pasa a «⚠️ No se pudo
         enviar: toca para reintentar» (la misma lección del audio
         eterno de Mi Negocio: nada de relojes mudos sin salida).
         El mensaje NO se pierde: sigue en la cola. */
      var aF = chatOutGet();
      aF.forEach(function(x){ if (x.opId === item.opId) { x.intentos = (x.intentos || 0) + 1; if (x.intentos >= 3) x.fallida = true; } });
      chatOutSet(aF);
      pintarChat(CHAT_MSGS);
    }
  });
}
function tempTexto(seg){
  if (!seg) return "";
  if (seg <= 86400) return "Los mensajes desaparecen en 24 h";
  if (seg <= 7 * 86400) return "Los mensajes desaparecen en 7 días";
  return "Los mensajes desaparecen en 90 días";
}
/* ===== CHAT PRO v1.5.0 — repintado INCREMENTAL por nodos =====
   La disciplina del estudio, la misma que en Mi Negocio v12: el
   hilo se reconcilia por claves — la burbuja que ya estaba conserva
   su nodo; solo entra, cambia o sale lo que cambió — y el scroll
   solo sigue al final si el buscador YA estaba pegado abajo (si
   está leyendo arriba o escribiendo, el refresco de 3 s no lo
   arrastra). El compositor #c_txt siempre fue estático aquí; lo
   que moría en cada repintado era el estado de las notas de voz:
   vozDatosMT se borraba entero y las claves nuevas (contador) ya
   no coincidían con las pintadas en el DOM. Ahora la clave de voz
   sale del ID del mensaje y los mapas no se borran jamás: solo se
   retira la entrada del nodo que sale del hilo. */
var hiloNodosMT = {}, hiloFirmasMT = {}, hiloClavesMT = {};
function firmaMsgMT(m){
  return JSON.stringify([m.texto || "", m.borrado ? 1 : 0, m.editado ? 1 : 0, m.leido ? 1 : 0, m.recibido ? 1 : 0,
    m.adj_tipo || "", m.adj_datos ? String(m.adj_datos).length : 0, String(m.adj_datos || "").slice(0, 24),
    m.adj_dur || 0, m.resp_texto || "", m.resp_autor || "",
    ((m.reacciones || []).map(function(r){ return r.emoji + r.total; }).join(","))]);
}
function burbujaInnerMT(m){
  var mio = m.de === SESION;
  var est = mio ? estadoMsgBusc(m) : "";
  var inner = "";
  if (m.borrado) inner = '<span class="eliminado">Este mensaje fue eliminado</span>';
  else {
    if (m.resp_texto) inner += '<span class="cita">' + escChat(m.resp_autor === SESION ? "Tú" : (m.resp_autor || "")) + ": " + escChat(String(m.resp_texto).slice(0, 90)) + "</span>";
    if (m.adj_tipo === "foto" && m.adj_datos) { var srcF153 = srcSeguroAdjMT(m.adj_datos, m.adj_mime); if (srcF153) inner += '<img class="adjFoto" alt="Foto" src="' + srcF153 + '">'; }
    else if (m.adj_tipo === "foto" && m.adj_tiene) inner += '<span class="adjCargando" data-adjpend="' + esc(m.id) + '">Foto · cargando…</span>';
    else if (m.adj_tipo === "voz" && m.adj_datos) inner += reproductorVozHtmlMT(m);
    else if (m.adj_tipo === "voz" && m.adj_tiene) inner += '<span class="adjCargando" data-adjpend="' + esc(m.id) + '">Nota de voz · toca para cargarla</span>';
    else if (m.adj_datos || m.adj_tiene) inner += tarjetaDocMT(m);
    if (m.texto) inner += escChat(m.texto);
  }
  inner += '<span class="burMeta">' + (m.editado ? '<span class="editadoLab">editado</span> ' : "") + hora12Chat(m.creado) + est + "</span>";
  var reac = "";
  if (!m.borrado && m.reacciones && m.reacciones.length) {
    reac = '<div class="reacRow">' + m.reacciones.map(function(r){ return '<span class="reac">' + esc(r.emoji) + " " + esc(r.total) + "</span>"; }).join("") + "</div>";
  }
  return '<div class="bur">' + inner + "</div>" + reac;
}
function alistarNodoMsgMT(nodo, id){
  nodo.querySelectorAll("[data-adjpend]").forEach(function(el){
    el.addEventListener("click", function(e){ e.stopPropagation(); cargarAdjuntoMsg(Number(el.getAttribute("data-adjpend"))); });
  });
  nodo.querySelectorAll("img.adjFoto").forEach(function(img){
    img.addEventListener("click", function(e){
      e.stopPropagation();
      var mm = (CHAT_MSGS || []).filter(function(x){ return String(x.id) === String(id); })[0];
      if (mm) abrirVisorMsgMT(mm);
    });
  });
  nodo.querySelectorAll("[data-docdl]").forEach(function(b){
    b.addEventListener("click", function(e){
      e.stopPropagation();
      var mm = (CHAT_MSGS || []).filter(function(x){ return String(x.id) === String(b.getAttribute("data-docdl")); })[0];
      if (mm) descargarDocMT(mm);
    });
  });
  alistarReproductoresVozMT(nodo);
}
function crearNodoMsgMT(m){
  var nodo = document.createElement("div");
  nodo.className = "msg " + (m.de === SESION ? "me" : "him");
  nodo.setAttribute("data-mid", String(m.id));
  nodo.innerHTML = burbujaInnerMT(m);
  hiloClavesMT["m:" + String(m.id)] = "vm" + String(m.id).replace(/[^a-zA-Z0-9]/g, "");
  nodo.addEventListener("click", function(){ abrirMenuMsg(Number(nodo.getAttribute("data-mid"))); });
  alistarNodoMsgMT(nodo, m.id);
  return nodo;
}
function burbujaColaInnerMT(it){
  var innerC = "";
  if (it.adj && it.adj.tipo === "foto" && it.adj.datos) { var srcC153 = srcSeguroAdjMT(it.adj.datos, it.adj.mime); if (srcC153) innerC += '<img class="adjFoto" alt="Foto" src="' + srcC153 + '">'; }
  else if (it.adj && it.adj.tipo === "voz" && it.adj.datos) innerC += reproductorVozHtmlMT({ id: "cola-" + it.opId, adj_datos: it.adj.datos, adj_dur: it.adj.dur || null });
  else if (it.adj && it.adj.datos) innerC += tarjetaDocMT({ id: "cola-" + it.opId, adj_nombre: it.adj.nombre, adj_datos: it.adj.datos, adj_mime: it.adj.mime, adj_bytes: it.adj.tam });
  if (it.texto) innerC += escChat(it.texto);
  innerC += '<span class="burMeta">' + hora12Chat(it.creado)
    + (it.fallida
        ? ' <span class="estFallo">⚠️ No se pudo enviar — toca el mensaje para reintentar</span>'
        : ' <span class="estCola" title="Sin enviar todavía: sale solo cuando vuelva la conexión">🕐</span>')
    + "</span>";
  return '<div class="bur">' + innerC + "</div>";
}
function firmaColaMT(it){
  return JSON.stringify([it.texto || "", it.fallida ? 1 : 0, it.adj ? (it.adj.tipo || "") : "", it.adj && it.adj.datos ? String(it.adj.datos).length : 0, it.adj ? (it.adj.dur || 0) : 0]);
}
function crearNodoColaMT(it){
  var nodo = document.createElement("div");
  nodo.className = "msg me";
  if (it.fallida) nodo.setAttribute("data-colafallida", it.opId);
  nodo.innerHTML = burbujaColaInnerMT(it);
  hiloClavesMT["cola:" + it.opId] = "vmcola" + String(it.opId).replace(/[^a-zA-Z0-9]/g, "");
  if (it.fallida) {
    nodo.addEventListener("click", function(){
      var opId = nodo.getAttribute("data-colafallida");
      var aR = chatOutGet();
      aR.forEach(function(x){ if (x.opId === opId) { x.intentos = 0; x.fallida = false; } });
      chatOutSet(aR);
      pintarChat(CHAT_MSGS);
      despacharChat();
    });
  }
  alistarReproductoresVozMT(nodo);
  return nodo;
}
function pintarChat(msgs){
  var box = $("c_hilo"); if (!box) return;
  msgs = msgs || [];
  CHAT_MSGS = msgs;
  var fj = $("c_fijado");
  if (fj) {
    if (CHAT_FIJADO && !CHAT_FIJADO.borrado) { fj.style.display = "block"; fj.textContent = "Fijado: " + (CHAT_FIJADO.texto || "Mensaje fijado"); }
    else fj.style.display = "none";
  }
  var tl = $("c_temp");
  if (tl) { var tt = tempTexto(CHAT_TEMP_SEG); tl.style.display = tt ? "block" : "none"; tl.textContent = tt; }
  var colaChat = chatOutGet();
  var filtro = (($("c_buscar") && $("c_buscar").value) || "").trim().toLowerCase();
  var pegado = (box.scrollTop + box.clientHeight) >= (box.scrollHeight - 90);
  var deseados = [], vivos = {}, ultimoDia = "";
  msgs.forEach(function(m, ix){
    if (m.tipo === "sistema") { deseados.push({ k: "sis:" + String(m.id != null ? m.id : (ix + "|" + m.creado)), sis: m }); return; }
    if (filtro && String(m.texto || "").toLowerCase().indexOf(filtro) === -1 && !m.adj_tipo) return;
    var dia = String(m.creado || "").slice(0, 10);
    if (!filtro && dia && dia !== ultimoDia) { deseados.push({ k: "sep:" + dia, sep: dia, creado: m.creado }); ultimoDia = dia; }
    deseados.push({ k: "m:" + String(m.id), m: m });
  });
  if (!filtro && colaChat.length) {
    colaChat.forEach(function(it){ deseados.push({ k: "cola:" + it.opId, cola: it }); });
  }
  if (!deseados.length) {
    deseados.push((!msgs.length && !colaChat.length)
      ? { k: "vacio", txt: "Todavía no hay mensajes. Escríbele a Ernesto lo que necesites: dudas de un trato, algo que no funciona o una idea." }
      : { k: "sinres", txt: "Ningún mensaje coincide con la búsqueda en lo cargado. Prueba «Buscar más»." });
  }
  deseados.forEach(function(dd){ vivos[dd.k] = true; });
  Array.prototype.slice.call(box.children).forEach(function(n){
    var k = n.getAttribute("data-k");
    if (!k || !vivos[k]) {
      if (k && hiloClavesMT[k]) {
        var au = vozAudiosMT[hiloClavesMT[k]];
        if (au) { try { au.pause(); } catch(e){} }
        delete vozAudiosMT[hiloClavesMT[k]]; delete vozDatosMT[hiloClavesMT[k]];
        delete hiloClavesMT[k];
      }
      if (k) { delete hiloNodosMT[k]; delete hiloFirmasMT[k]; }
      box.removeChild(n);
    }
  });
  deseados.forEach(function(dd, i){
    var nodo = hiloNodosMT[dd.k];
    if (!nodo) {
      if (dd.m) { nodo = crearNodoMsgMT(dd.m); hiloFirmasMT[dd.k] = firmaMsgMT(dd.m); }
      else if (dd.cola) { nodo = crearNodoColaMT(dd.cola); hiloFirmasMT[dd.k] = firmaColaMT(dd.cola); }
      else {
        nodo = document.createElement("div");
        if (dd.sep) { nodo.className = "fechaSep"; nodo.innerHTML = "<span>" + escChat(etiquetaFechaChat(dd.creado)) + "</span>"; }
        else if (dd.sis) { nodo.className = "msgSistema"; nodo.textContent = dd.sis.texto || ""; }
        else { nodo.className = "chatVacio"; nodo.textContent = dd.txt || ""; }
      }
      nodo.setAttribute("data-k", dd.k);
      hiloNodosMT[dd.k] = nodo;
    } else if (dd.m) {
      var f = firmaMsgMT(dd.m);
      if (hiloFirmasMT[dd.k] !== f) {
        hiloFirmasMT[dd.k] = f;
        nodo.innerHTML = burbujaInnerMT(dd.m);
        alistarNodoMsgMT(nodo, dd.m.id);
      }
    } else if (dd.cola) {
      var fc = firmaColaMT(dd.cola);
      if (hiloFirmasMT[dd.k] !== fc) {
        hiloFirmasMT[dd.k] = fc;
        var eraFallida = nodo.hasAttribute("data-colafallida");
        nodo.innerHTML = burbujaColaInnerMT(dd.cola);
        if (dd.cola.fallida && !eraFallida) {
          nodo.setAttribute("data-colafallida", dd.cola.opId);
          nodo.addEventListener("click", function(){
            var opId = nodo.getAttribute("data-colafallida");
            var aR = chatOutGet();
            aR.forEach(function(x){ if (x.opId === opId) { x.intentos = 0; x.fallida = false; } });
            chatOutSet(aR);
            pintarChat(CHAT_MSGS);
            despacharChat();
          });
        }
        alistarReproductoresVozMT(nodo);
      }
    }
    var actual = box.children[i];
    if (actual !== nodo) box.insertBefore(nodo, actual || null);
  });
  if (pegado) { try { box.scrollTop = box.scrollHeight; } catch(e){} }
}
function abrirMenuMsg(id){
  var m = (CHAT_MSGS || []).filter(function(x){ return x.id === id; })[0];
  var menu = $("c_menu"); if (!m || !menu) return;
  MENU_MSG = m;
  var mio = m.de === SESION;
  var h = "<b>" + (mio ? "Tu mensaje" : "Mensaje de Ernesto") + "</b>";
  if (!m.borrado) {
    h += '<button type="button" data-mm="resp">Responder</button>';
    EMOJIS_REAC.forEach(function(e){ h += '<button type="button" data-mm="reac" data-e="' + e + '">' + e + " Reaccionar</button>"; });
    h += '<button type="button" data-mm="copiar">Copiar texto</button>';
    if (mio) {
      h += '<button type="button" data-mm="editar">Editar</button>';
      h += '<button type="button" data-mm="borrar">Eliminar para todos</button>';
    }
  }
  h += '<button type="button" data-mm="cerrar">Cerrar</button>';
  menu.innerHTML = h; menu.style.display = "block";
  menu.querySelectorAll("[data-mm]").forEach(function(b){
    b.addEventListener("click", function(){
      var acc = b.getAttribute("data-mm");
      menu.style.display = "none";
      if (acc === "resp") {
        CHAT_RESP = m;
        var rb = $("c_resp");
        rb.style.display = "block";
        rb.innerHTML = "Respondiendo a: «" + escChat(String(m.texto || m.adj_nombre || "adjunto").slice(0, 80)) + "» <button type='button' class='miniBtn' id='c_resp_x'>Quitar</button>";
        var q = $("c_resp_x"); if (q) q.addEventListener("click", function(){ CHAT_RESP = null; rb.style.display = "none"; });
        $("c_txt").focus();
      } else if (acc === "reac") {
        if (EN_PAUSA) { chatFallo("Estás en pausa: habla con Ernesto"); return; }
        rpcMsg("reaccionar", { p_codigo: SESION, p_id: m.id, p_emoji: b.getAttribute("data-e") }).then(function(r){
          if (!r.ok && marcarPausaSiToca(r.error)) chatFallo("Estás en pausa: habla con Ernesto");
          chatCargar();
        });
      } else if (acc === "copiar") {
        if (navigator.clipboard) navigator.clipboard.writeText(m.texto || "");
      } else if (acc === "editar") {
        var nuevo = window.prompt("Editar tu mensaje:", m.texto || "");
        if (nuevo !== null && nuevo.trim()) {
          rpcMsg("editar_mensaje", { p_codigo: SESION, p_id: m.id, p_texto: nuevo.trim() }).then(function(r){
            if (!r.ok && marcarPausaSiToca(r.error)) chatFallo("Estás en pausa: habla con Ernesto");
            chatCargar();
          });
        }
      } else if (acc === "borrar") {
        if (window.confirm("¿Eliminar este mensaje para todos?")) {
          rpcMsg("borrar_mensaje", { p_codigo: SESION, p_id: m.id }).then(function(){ chatCargar(); });
        }
      }
    });
  });
}
function chatFallo(m){
  var warn = $("c_warn"); if (!warn) return;
  warn.style.display = "block"; warn.textContent = m;
}
/* v1.5.3 (E-9): el sondeo de 3 s usa leer_chat_ligero — ultimos 50
   mensajes SIN adj_datos base64 (solo adj_tiene) — y cada adjunto se
   trae UNA vez por leer_adjunto y queda en cache de sesion. La
   puerta completa leer_chat queda para la busqueda (a demanda del
   usuario) y para Mi Negocio, intacta. */
var ADJ_CACHE_MT = {};
function fusionarAdjuntosCache(msgs){
  (msgs || []).forEach(function(m){ if (m && m.id != null && ADJ_CACHE_MT[m.id]) m.adj_datos = ADJ_CACHE_MT[m.id]; });
}
function cargarAdjuntoMsg(id){
  var m = (CHAT_MSGS || []).filter(function(x){ return String(x.id) === String(id); })[0];
  if (!m || m.adj_datos || !SESION) return;
  rpcChat("leer_adjunto", { p_codigo: SESION, p_clave: SESION, p_id: Number(id) }).then(function(r){
    if (r && r.ok && r.adj_datos) { ADJ_CACHE_MT[id] = r.adj_datos; m.adj_datos = r.adj_datos; pintarChat(CHAT_MSGS); }
  });
}
var adjLoteActivo = false;
function cargarAdjuntosPendientes(){
  if (adjLoteActivo || !SESION) return;
  var pend = (CHAT_MSGS || []).filter(function(m){ return m.adj_tiene && !m.adj_datos; }).slice(-8);
  if (!pend.length) return;
  adjLoteActivo = true;
  var chain = Promise.resolve();
  pend.forEach(function(m){
    chain = chain.then(function(){
      return rpcChat("leer_adjunto", { p_codigo: SESION, p_clave: SESION, p_id: Number(m.id) }).then(function(r){
        if (r && r.ok && r.adj_datos) { ADJ_CACHE_MT[m.id] = r.adj_datos; m.adj_datos = r.adj_datos; }
      });
    });
  });
  chain.then(function(){ adjLoteActivo = false; pintarChat(CHAT_MSGS); });
}
var chatCargando2 = false;
var chatFallos = 0, chatReintentoT = null;
function chatCargar(){
  if (!SESION || chatCargando2) return;
  chatCargando2 = true;
  cargarAdminPres();
  /* v1.4.4: p_buscar SIEMPRE presente (aunque sea null): sin él, la
     sobrecarga nueva de leer_chat hace la puerta ambigua (HTTP 300)
     y el chat entero caía aunque hubiera internet. */
  rpcChat("leer_chat_ligero", { p_codigo: SESION, p_con: "ADMIN", p_clave: SESION }).then(function(r){
    if (r && r.ok && r.mensajes) return r;
    return rpcChat("leer_chat", { p_codigo: SESION, p_con: "ADMIN", p_clave: SESION, p_buscar: null });   /* respaldo si la puerta ligera aun no existe */
  }).then(function(r){
    chatCargando2 = false;
    if (r && r.ok && r.mensajes) {
      chatFallos = 0;
      CHAT_FIJADO = r.fijado || null;
      CHAT_TEMP_SEG = Number(r.temporal_seg || 0);
      fusionarAdjuntosCache(r.mensajes);
      pintarChat(r.mensajes); pintarBadge(0);
      cargarAdjuntosPendientes();   /* v1.5.3 (E-9): los adjuntos llegan una vez, no en cada sondeo */
      despacharChat();   // si el chat cargó, la red responde: que salga la cola
    } else if (!CHAT_MSGS.length && !chatOutGet().length) {
      var box = $("c_hilo");
      if (ULTIMO_ERR_CHAT && ULTIMO_ERR_CHAT.status === 404) {
        /* La puerta no existe: eso NO es «sin conexión». */
        if (box) box.innerHTML = '<div class="chatVacio">El chat todavía no está activado en el sistema de Ernesto (falta un paso suyo en la base). Mientras tanto, escríbele por su WhatsApp.</div>';
      } else {
        /* Detector honesto: «sin conexión» SOLO si ninguna puerta ha
           respondido en el último minuto Y ya se reintentó una vez.
           Un fallo suelto muestra «Cargando…» y reintenta solo. */
        chatFallos++;
        if (chatFallos >= 2 && !redReciente(60000)) {
          if (box) box.innerHTML = '<div class="chatVacio">Sin conexión ahora: el chat se carga solo cuando vuelva la red.</div>';
        } else {
          if (box) box.innerHTML = '<div class="chatVacio">Cargando el chat…</div>';
          if (!chatReintentoT) chatReintentoT = setTimeout(function(){ chatReintentoT = null; chatCargar(); }, 2500);
        }
      }
    }
  });
}
function chatEnviar(){
  var warn = $("c_warn"); if (warn) warn.style.display = "none";
  if (!SESION) return chatFallo("Primero entra con tu código personal desde la pantalla de inicio.");
  if (EN_PAUSA) return chatFallo("Estás en pausa: habla con Ernesto");
  var txt = ($("c_txt").value || "").trim();
  if (!txt && !CHAT_ADJ) return chatFallo("Escribe el mensaje o adjunta algo primero.");
  /* v1.4.4: el mensaje entra en la COLA con su opId y se ve al
     momento con 🕐; despacharChat() lo entrega. Sin red no se
     pierde ni hay que reintentar a mano: sale solo. */
  var item = { opId: nuevoOpId(), texto: txt, respId: CHAT_RESP ? CHAT_RESP.id : null,
    adj: CHAT_ADJ ? { tipo: CHAT_ADJ.tipo, datos: CHAT_ADJ.datos, nombre: CHAT_ADJ.nombre || null, tam: CHAT_ADJ.tam || null, mime: CHAT_ADJ.mime || null, dur: CHAT_ADJ.dur || null } : null,
    creado: new Date().toISOString() };
  var a = chatOutGet(); a.push(item); chatOutSet(a);
  $("c_txt").value = ""; CHAT_RESP = null; CHAT_ADJ = null;
  var rb = $("c_resp"); if (rb) rb.style.display = "none";
  pintarPreviaAdjMT();
  pintarChat(CHAT_MSGS);
  despacharChat();
}

/* ===== REPORTAR v1.4.0: editar pendiente ===== */
var REP_EDIT_ID = null;
var REP_FOTO = null;
function renderOutbox(){
  var a = outboxGet(), box = $("r_lista"), h = "";
  a.slice().reverse().forEach(function(rp){
    var st = rp.estado === "aprobado" ? '<span class="st okk"><span class="dot"></span>Aprobado +' + fmt(rp.comision || 0) + "</span>"
      : rp.estado === "rechazado" ? '<span class="st no"><span class="dot"></span>Rechazado' + (rp.motivo ? ": " + esc(rp.motivo) : "") + "</span>"
      : '<span class="st pend"><span class="dot"></span>Pendiente' + (rp.enviado ? "" : " (guardado, sin enviar)") + "</span>";
    var ed = (rp.estado === "pendiente" && rp.id) ? ' <button type="button" class="miniBtn" data-edrep="' + esc(rp.id) + '">✏️ Editar</button>' : "";
    h += '<div class="rep"><span>' + repResumen(rp) + "<br><small>" + esc(rp.fecha) + "</small>" + ed + "</span>" + st + "</div>";
  });
  box.innerHTML = h || '<div class="rep"><span>Todavía no has reportado nada.</span></div>';
  box.querySelectorAll("[data-edrep]").forEach(function(b){
    b.addEventListener("click", function(){
      /* v1.4.8: comparación por CADENA — los ids del servidor son
         UUID y Number(uuid) da NaN: el botón «Editar» nunca
         encontraba el reporte (la otra mitad de la fila 20 de
         CHEQUEOS: la puerta editar_reporte ya acepta uuid). */
      var rp = outboxGet().filter(function(x){ return String(x.id) === String(b.getAttribute("data-edrep")); })[0];
      if (!rp) return;
      REP_EDIT_ID = rp.id;
      if (rp.tipo === "saldo") { $("r_tipo_s").click(); $("r_precio").value = rp.precio || ""; $("r_cant").value = rp.cantidad || 1; }
      else { $("r_tipo_t").click(); $("r_ef").value = rp.cantidad || ""; $("r_pct").value = rp.porc || ""; }
      $("r_tel").value = rp.telefono || ""; $("r_nota").value = rp.nota || "";
      $("r_editando").style.display = "block";
      $("r_btn").textContent = "Guardar la corrección";
      window.scrollTo(0, 0);
    });
  });
}

/* ===== PERFIL + CAMBIO DE CÓDIGO + AVISOS ===== */
var PERFIL = null;
var COLORES_AVATAR = ["#E8B84B", "#2FBF71", "#4CC3FF", "#F6465D", "#9B7EDE", "#31C453"];
var COLOR_SEL = COLORES_AVATAR[0];
function perfilLocalGet(){ try { return JSON.parse(localStorage.getItem("busc_perfil") || "null"); } catch(e){ return null; } }
function perfilLocalSet(p){ try { localStorage.setItem("busc_perfil", JSON.stringify(p)); } catch(e){} }
function pintarColores(){
  var row = $("pf_colores"); if (!row) return;
  row.innerHTML = COLORES_AVATAR.map(function(c){
    return '<div class="colorDot' + (c === COLOR_SEL ? " on" : "") + '" data-color="' + c + '" style="background:' + c + '"></div>';
  }).join("");
  row.querySelectorAll("[data-color]").forEach(function(d){
    d.addEventListener("click", function(){ COLOR_SEL = d.getAttribute("data-color"); pintarColores(); });
  });
}
function cargarPerfil(){
  var loc = perfilLocalGet();
  if (loc) rellenarPerfil(loc);
  rpcChat("leer_perfil", { p_codigo: SESION }).then(function(r){
    if (r && (r.nombre !== undefined || r.codigo)) {
      PERFIL = r; perfilLocalSet(r); rellenarPerfil(r);
    }
  });
  pintarEnlace();
}
function rellenarPerfil(p){
  if (!p) return;
  if (p.nombre) $("pf_nombre").value = p.nombre;
  if (p.telefono) $("pf_tel").value = p.telefono;
  if (p.zona) $("pf_zona").value = p.zona;
  if (p.nota) $("pf_nota").value = p.nota;
  if (p.avatar_color && COLORES_AVATAR.indexOf(p.avatar_color) >= 0) { COLOR_SEL = p.avatar_color; pintarColores(); }
  /* v1.4.5: el perfil ya NO se vuelca a ningún formulario de
     textos (ese vuelco era el que metía un teléfono cualquiera en
     el generador viejo): los textos inteligentes usan SOLO el
     bloque público de Ernesto. */
}
function pintarEnlace(){
  var el = $("cc_enlace"); if (!el || !SESION) return;
  el.textContent = window.location.origin + window.location.pathname + "?codigo=" + SESION;
}
function guardarPerfil(){
  var p = { nombre: ($("pf_nombre").value || "").trim(), telefono: ($("pf_tel").value || "").trim(),
    zona: ($("pf_zona").value || "").trim(), nota: ($("pf_nota").value || "").trim(), avatar_color: COLOR_SEL };
  perfilLocalSet(p);
  rpcMsg("guardar_perfil", { p_codigo: SESION, p_nombre: p.nombre || null, p_telefono: p.telefono || null,
    p_zona: p.zona || null, p_nota: p.nota || null, p_avatar: p.avatar_color }).then(function(r){
    if (r.ok) { $("pf_ok").style.display = "block"; $("pf_warn").style.display = "none"; }
    else {
      $("pf_warn").style.display = "block";
      $("pf_warn").textContent = "Quedó guardado en tu teléfono; en el sistema de Ernesto se guarda cuando la puerta de perfiles esté activa y tengas conexión.";
    }
  });
}
function cambiarCodigo(){
  var w = $("cc_warn"), okEl = $("cc_ok");
  w.style.display = "none"; okEl.style.display = "none";
  function fallo(m){ w.style.display = "block"; w.textContent = m; }
  var actual = normCod($("cc_actual").value), nuevo = normCod($("cc_nuevo").value);
  if (!actual || actual !== SESION) return fallo("El código actual no coincide con tu sesión.");
  if (!/^\S{6,}$/.test(nuevo)) return fallo("El código nuevo necesita mínimo 6 caracteres y ningún espacio.");
  if (nuevo === actual) return fallo("El código nuevo es igual al actual: elige otro.");
  rpcMsg("cambiar_codigo", { p_codigo_actual: actual, p_codigo_nuevo: nuevo }).then(function(r){
    if (!r.ok || !r.data || r.data.ok !== true) return fallo("No se pudo cambiar: " + (r.error || "ese código ya existe o no es válido") + ". Prueba con otro.");
    panelCacheClear();   /* v1.5.2: ningún JSON que remapear; la foto del panel se repone sola con leer_panel */
    /* v1.5.3 (E-2, residual cazado en la verificacion viva): los
       reportes aun en cola llevaban el codigo VIEJO como buscador y
       el servidor los rechazaba tras el cambio; migran con la sesion. */
    try { var aCC = outboxGet(); aCC.forEach(function(x){ if (x.buscador === actual) x.buscador = nuevo; }); outboxSet(aCC); } catch(e){}
    SESION = nuevo; sesionSet(nuevo);
    okEl.style.display = "block";
    okEl.textContent = "Código cambiado. Tu enlace personal nuevo está abajo: guárdalo.";
    pintarEnlace(); renderPanel();
  });
}
/* ===== AVISOS NATIVOS (v1.4.5 · app instalada en Android) =====
   Dentro de la APK, los avisos van por el canal NATIVO del sistema
   (@capacitor/push-notifications): la app pide el permiso de
   notificaciones de Android como cualquier app normal. La ruta de
   navegador (Web Push/VAPID) queda SOLO para la versión web: en el
   WebView de la app esa vía no existe y decir «este aparato no
   admite avisos» dentro de la app instalada era falso.
   PUERTA HONESTA: el token nativo lo entrega Firebase (FCM); sin
   el proyecto Firebase de la app, Android concede el permiso pero
   NO entrega token (registrationError). En ese caso la tarjeta lo
   dice tal cual («pendiente de un paso técnico») y jamás pinta un
   ✓ que no exista. Con token, se guarda por la puerta
   registrar_push_nativo y la función «avisos» lo usa. */
function pluginPush(){
  try { var P = window.Capacitor && window.Capacitor.Plugins; return (P && P.PushNotifications) || null; } catch(e){ return null; }
}
function esAppNativa(){ return esNativo() && !!pluginPush(); }
var PUSH_NATIVO_LS = "busc_push_nativo_v1";
function pushNativoLocal(){ try { return JSON.parse(localStorage.getItem(PUSH_NATIVO_LS) || "{}"); } catch(e){ return {}; } }
function pushNativoGuardar(o){ try { localStorage.setItem(PUSH_NATIVO_LS, JSON.stringify(o)); } catch(e){} }
function pintarAvisos(){
  var txt = $("pf_push_txt"); if (!txt) return;
  if (!esAppNativa()) return;   /* web: manda el texto/flujo de siempre */
  pluginPush().checkPermissions().then(function(p){
    var est = (p && p.receive) || "prompt";
    var loc = pushNativoLocal();
    if (est === "granted" && loc.registrado) txt.textContent = "✓ Avisos activados en este aparato: te llega un aviso cuando Ernesto apruebe un trato, te pague o te escriba.";
    else if (est === "granted") txt.textContent = "Tienes el permiso de notificaciones dado. La activación del sistema de avisos está pendiente de un paso técnico (lo está cerrando Máximo): mientras tanto, entra a la app para ver tus novedades.";
    else if (est === "denied") txt.textContent = "Las notificaciones están apagadas para Mi Trabajo. Para encenderlas: Ajustes del teléfono → Aplicaciones → Mi Trabajo → Notificaciones → Permitir. Sin eso, los avisos de Ernesto no te llegan.";
    else txt.textContent = "Esta app necesita que autorices enviar notificaciones: así te enteras al momento cuando Ernesto apruebe un trato, te pague o te escriba. Toca «Activar avisos» y acepta el permiso del sistema.";
  }).catch(function(){});
}
var pushNativoListeners = false;
function registrarAvisosNativo(){
  var PN = pluginPush(); if (!PN || !SESION) return;
  if (!pushNativoListeners) {
    pushNativoListeners = true;
    try {
      PN.addListener("registration", function(t){
        var token = t && t.value;
        if (!token) { pushNativoGuardar({ registrado: false, pendiente: true }); pintarAvisos(); return; }
        rpcChat("registrar_push_nativo", { p_codigo: SESION, p_token: token, p_plataforma: "android" }).then(function(r){
          if (r && (r.ok === true || r === true)) pushNativoGuardar({ registrado: true, cuando: new Date().toISOString() });
          else pushNativoGuardar({ registrado: false, pendiente: true });
          pintarAvisos();
        });
      });
      PN.addListener("registrationError", function(){
        pushNativoGuardar({ registrado: false, pendiente: true });
        pintarAvisos();
      });
    } catch(e){}
  }
  try { PN.register(); } catch(e){ pushNativoGuardar({ registrado: false, pendiente: true }); pintarAvisos(); }
}
function pedirAvisosNativo(){
  var PN = pluginPush(); if (!PN) return;
  PN.checkPermissions().then(function(p){
    var est = (p && p.receive) || "prompt";
    if (est === "granted") { registrarAvisosNativo(); return; }
    if (est === "denied") { pintarAvisos(); return; }
    PN.requestPermissions().then(function(r){
      if (r && r.receive === "granted") registrarAvisosNativo();
      pintarAvisos();
    }).catch(function(){ pintarAvisos(); });
  }).catch(function(){});
}
/* Al entrar (como cualquier app normal): si el permiso nunca se ha
   pedido, la app lo pide sola UNA vez con el diálogo del sistema;
   si ya está concedido, refresca el registro en silencio; si está
   denegado, no insiste (la tarjeta Avisos lo explica). */
function avisosAutoTrasLogin(){
  if (!esAppNativa()) return;
  var PN = pluginPush();
  PN.checkPermissions().then(function(p){
    var est = (p && p.receive) || "prompt";
    if (est === "granted") { registrarAvisosNativo(); return; }
    if (est !== "prompt") return;
    var ya = false;
    try { ya = !!localStorage.getItem("busc_push_pedido_v1"); } catch(e){}
    if (ya) return;
    try { localStorage.setItem("busc_push_pedido_v1", "1"); } catch(e){}
    PN.requestPermissions().then(function(r){
      if (r && r.receive === "granted") registrarAvisosNativo();
    }).catch(function(){});
  }).catch(function(){});
}
function activarAvisosMT(){
  if (esAppNativa()) { pedirAvisosNativo(); return; }
  var txt = $("pf_push_txt");
  var est = estadoPush();
  if (est === "instalar") { txt.textContent = "En iPhone los avisos solo funcionan con la app instalada en pantalla de inicio."; return; }
  if (est === "sin-soporte") { txt.textContent = "Este navegador no admite avisos push. Abre la app instalada (la APK) para activar los avisos del sistema."; return; }
  activarPush(function(sub){
    return rpcChat("registrar_push", { p_codigo: SESION, p_suscripcion: sub, p_plataforma: /android/i.test(navigator.userAgent || "") ? "android" : (/iphone|ipad/i.test(navigator.userAgent || "") ? "ios" : "web") });
  }).then(function(){ txt.textContent = "Avisos activados en este aparato."; })
    .catch(function(){ txt.textContent = "No se pudo activar: revisa el permiso de notificaciones."; });
}

/* ===== TEXTOS (Ola Nueva 2: motor IA en el servidor) =====
   Las plantillas locales murieron: ningún texto nace ya en el
   cliente. Los escribe la Edge Function «textos-generar» con los
   datos VIVOS de Ernesto (catálogo + tarifa pública) y un
   verificador de cifras en el servidor; la equivalencia de la
   cantidad también la calcula el servidor. Estilo fijo PRO de
   esta app: tono humanizado, WhatsApp, emojis muchos, título en
   mayúsculas. Sin conexión: el último paquete generado, guardado
   en este teléfono, con su aviso honesto. */
var TX_LS = "busc_textos_v1";
var TX_CAT_LS = "busc_textos_catalogo_v1";
var TX_PAQ_LS = "busc_textos_paquete_v1";
var TEXTOS_FN_URL = "https://otsudfgwpapkluusrlnj.supabase.co/functions/v1/textos-generar";
function txHist(){ try { return JSON.parse(localStorage.getItem(TX_LS) || "[]"); } catch(e){ return []; } }
function txHistPintar(){
  var el = $("tx_hist"); if (!el) return;
  var hs = txHist();
  el.innerHTML = hs.length ? hs.map(function(x, i){ return '<div class="rep"><span>' + escChat(x.titulo || "Texto") + '</span><button type="button" class="miniBtn" data-txh="' + i + '">Copiar</button></div>'; }).join("") : '<div class="rep"><span>Aún no generaste textos.</span></div>';
  el.querySelectorAll("[data-txh]").forEach(function(b){ b.addEventListener("click", function(){ var x = txHist()[Number(b.getAttribute("data-txh"))]; if (x && navigator.clipboard) navigator.clipboard.writeText(x.texto || ""); }); });
}
var TX_ULT = [];
function txPintar(res, titulo, esRespaldo){
  TX_ULT = res.versiones;
  var avisos = res.avisos || [];
  var out = (avisos.length ? '<div class="hint">⚠️ ' + avisos.map(escChat).join(" ") + "</div>" : "");
  res.versiones.forEach(function(v, i){
    out += '<label>Versión ' + (i + 1) + " · " + escChat(v.enfoque) + '</label><div class="versionTxt">' + escChat(v.texto) + '</div>' +
      '<div class="chatTools"><button type="button" data-txc="' + i + '">Copiar</button>' +
      '<a class="miniBtn" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(v.texto) + '">Compartir a WhatsApp</a></div>';
  });
  $("tx_out").innerHTML = out;
  $("tx_out").querySelectorAll("[data-txc]").forEach(function(b){ b.addEventListener("click", function(){ if (navigator.clipboard) navigator.clipboard.writeText(TX_ULT[Number(b.getAttribute("data-txc"))].texto); }); });
  if (!esRespaldo) { try { localStorage.setItem(TX_LS, JSON.stringify(TextosMotor.historialPush(txHist(), { titulo: titulo, cuando: new Date().toISOString(), texto: res.versiones[0].texto }))); } catch(e){} }
  txHistPintar();
}


/* ===== Motor de textos en el servidor (Ola Nueva 2) =====
   Catálogo: se pinta desde la respuesta del motor y se cachea
   («busc_textos_catalogo_v1»); sin red manda el cache o la lista
   base saldo/transferencia. Generar: estilo fijo PRO y, solo si
   la clave es «saldo» y hay cantidad escrita, su equivalencia la
   calcula el SERVIDOR (el cliente ya no hace esa cuenta). */
var TX_ITEMS = [];
var TX_CLAVE_SEL = "saldo";
function txCatalogoCache(){
  try { var c = JSON.parse(localStorage.getItem(TX_CAT_LS) || "null");
    return (c && Array.isArray(c.items) && c.items.length) ? c.items : null; } catch(e){ return null; }
}
function txPaqueteGet(){
  try { var q = JSON.parse(localStorage.getItem(TX_PAQ_LS) || "null");
    return (q && Array.isArray(q.versiones) && q.versiones.length) ? q : null; } catch(e){ return null; }
}
function textosFn(body){
  return fetch(TEXTOS_FN_URL, { method: "POST", headers: sbHeaders(), body: JSON.stringify(body || {}) })
    .then(function(r){ return r.text().then(function(t){
      var j = null; try { j = JSON.parse(t); } catch(e){}
      if (!r.ok || !j || j.ok === false) throw new Error((j && j.error) || ("Error " + r.status));
      if (r.ok) marcarRedOk();
      return j;
    }); });
}
function txItemSel(){ return TX_ITEMS.filter(function(x){ return x.clave === TX_CLAVE_SEL; })[0] || null; }
function txCantVisible(){
  var box = $("tx_cant_box"); if (!box) return;
  var it = txItemSel();
  var esSaldo = TX_CLAVE_SEL === "saldo" || (it && it.tipo === "saldo");
  box.classList.toggle("hide", !esSaldo);
  var inp = $("tx_cant_saldo"); if (inp) inp.disabled = !esSaldo;
}
function txPintarCatalogo(items){
  TX_ITEMS = (items && items.length) ? items.slice() : [];
  if (!TX_ITEMS.length) TX_ITEMS = [{ clave: "saldo", nombre: "Compro saldo", tipo: "saldo" }, { clave: "transferencia", nombre: "Transferencia", tipo: "transferencia" }];
  if (!TX_ITEMS.some(function(x){ return x.clave === TX_CLAVE_SEL; })) TX_CLAVE_SEL = TX_ITEMS[0].clave;
  var cont = $("tx_cat"); if (!cont) return;
  cont.innerHTML = "";
  TX_ITEMS.forEach(function(it){
    var ch = document.createElement("div");
    ch.className = "chip" + (it.clave === TX_CLAVE_SEL ? " on" : "");
    ch.textContent = it.nombre || it.clave;
    ch.setAttribute("data-clave", it.clave);
    ch.addEventListener("click", function(){ TX_CLAVE_SEL = it.clave; txPintarCatalogo(TX_ITEMS); });
    cont.appendChild(ch);
  });
  txCantVisible();
}
function cargarCatalogoTextos(){
  var cache = txCatalogoCache();
  txPintarCatalogo(cache || []);
  if (!window.fetch || !SESION) return;
  textosFn({ codigo: SESION, accion: "catalogo" }).then(function(r){
    if (r && Array.isArray(r.items) && r.items.length) {
      try { localStorage.setItem(TX_CAT_LS, JSON.stringify({ items: r.items, telefono: r.telefono || "", zona: r.zona || "", cuando: new Date().toISOString() })); } catch(e){}
      txPintarCatalogo(r.items);
    }
  }).catch(function(){ /* sin red: queda el cache o la lista base ya pintada */ });
}
function txGenerarTextos(){
  var out = $("tx_out");
  if (!SESION) { if (out) out.innerHTML = '<div class="hint">Primero entra con tu código personal.</div>'; return; }
  var clave = TX_CLAVE_SEL;
  var it = txItemSel();
  var titulo = (it && it.nombre) || clave;
  var btn = $("tx_generar");
  if (btn) { btn.disabled = true; btn.textContent = "Generando\u2026"; }
  function soltar(){ var b = $("tx_generar"); if (b) { b.disabled = false; b.textContent = "Generar textos"; } }
  var body = { codigo: SESION, accion: "generar", clave: clave, tono: "humanizado", tamano: "completo",
    destino: "wa", emojis: "muchos", mayus: true, urgencia: false, privado: false, hashtags: false };
  if (clave === "saldo") {
    var cantEl = $("tx_cant_saldo");
    var cant = cantEl ? parseFloat(String(cantEl.value || "").replace(",", ".")) : NaN;
    if (isFinite(cant) && cant > 0) body.cantidad = cant;
  }
  textosFn(body).then(function(r){
    soltar();
    if (!r || !Array.isArray(r.versiones) || !r.versiones.length) throw new Error("respuesta vacia");
    try { localStorage.setItem(TX_PAQ_LS, JSON.stringify({ clave: clave, versiones: r.versiones, cuando: new Date().toISOString() })); } catch(e){}
    txPintar({ versiones: r.versiones, avisos: r.avisos || [] }, titulo, false);
  }).catch(function(){
    soltar();
    var paq = txPaqueteGet();
    if (paq) {
      var cuandoTxt = "";
      try { var d = new Date(paq.cuando); if (!isNaN(d.getTime())) cuandoTxt = d.toLocaleString("es-ES"); } catch(e){}
      txPintar({ versiones: paq.versiones, avisos: ["Sin conexi\u00f3n: \u00faltimo paquete generado el " + (cuandoTxt || paq.cuando || "\u2014") + ". Cuando vuelva internet, genera uno nuevo con los datos vivos."] }, titulo, true);
    } else if (out) {
      out.innerHTML = '<div class="hint">Sin conexi\u00f3n con el motor de textos y a\u00fan no tienes un paquete guardado en este tel\u00e9fono: con\u00e9ctate una vez para generar el primero.</div>';
    }
  });
}

/* ===== D4 (v1.5.1) — navegación de pestañas A PRUEBA DE TRAGOS =====
   El piloto Appetize cazó en la APK v1.4.9 que la pestaña Chat no
   abría con toques reales (las otras 5 sí), mientras el MISMO
   índice (idéntico byte a byte al de la web) abría en Chromium y
   en jsdom, con y sin puente Capacitor: el manejador está sano y
   el fallo vive en la capa de toque del WebView/emulador, que se
   puede tragar el «click» sintético tras el toque. Defensa en dos
   capas, sin tocar el diseño: (1) CSS `touch-action: manipulation`
   en pestañas y botones (fuera la desambiguación de doble toque
   que retiene el primer toque — la misma firma del «Entrar» que
   pidió dos toques en una sesión); (2) esta vía de rescate: un
   `pointerup` DELEGADO en la barra que navega igual que el click,
   con deduplicación de 400 ms para que, cuando el click sí llega,
   la vista no se monte dos veces. Si cualquiera de los dos eventos
   sobrevive, la pestaña abre. */
var irTabUltima = { v: null, t: 0 };
function irTab(v){
  var ahora = Date.now();
  if (irTabUltima.v === v && ahora - irTabUltima.t < 400) return;
  irTabUltima = { v: v, t: ahora };
  showView(v);
  if (v === "Ayuda") { try { rtSuscribirMT(); } catch(e){} }
}
(function(){
  var barra = document.querySelector(".tabbar");
  if (!barra) return;
  barra.addEventListener("pointerup", function(e){
    var t = e.target;
    var tabEl = (t && t.closest) ? t.closest(".tab") : null;
    if (!tabEl || !tabEl.id) return;
    var v = tabEl.id.replace("tab", "");
    if (["Calc", "Rep", "Panel", "Ayuda", "Textos", "Perfil"].indexOf(v) >= 0) irTab(v);
  });
})();

/* ===== Vistas nuevas + cableado v1.4.0 ===== */
function showView(v){
  ["Calc","Rep","Panel","Ayuda","Textos","Perfil"].forEach(function(x){
    var t = $("tab" + x), vw = $("view" + x);
    if (t) t.classList.toggle("on", x === v);
    if (vw) vw.classList.toggle("hide", x !== v);
  });
  if (v === "Rep") renderOutbox();
  if (v === "Panel") { renderPanel(); pintarCupo(); }
  if (v === "Ayuda") chatCargar();
  if (v === "Perfil") { cargarPerfil(); pintarAvisos(); }
  if (v === "Textos") { txHistPintar(); cargarCatalogoTextos(); }
}
(function cablearV14(){
  try {
    $("tabTextos").addEventListener("click", function(){ showView("Textos"); });
    $("tabPerfil").addEventListener("click", function(){ showView("Perfil"); });
    $("pf_btn").addEventListener("click", guardarPerfil);
    $("cc_btn").addEventListener("click", cambiarCodigo);
    $("pf_push").addEventListener("click", activarAvisosMT);
    var txGen = $("tx_generar"); if (txGen) txGen.addEventListener("click", txGenerarTextos);
    /* Explicaciones plegables (una línea + «ⓘ»): patrón de la casa. */
    document.querySelectorAll(".hintBtn").forEach(function(b){
      b.addEventListener("click", function(){
        var t = $(b.getAttribute("data-hint")); if (t) t.classList.toggle("hide");
      });
    });
    pintarColores();
    /* Reportar: foto del comprobante + edición */
    $("r_foto").addEventListener("change", function(){
      var f = $("r_foto").files && $("r_foto").files[0];
      if (!f) { REP_FOTO = null; return; }
      leerArchivoMT(f, true).then(function(a){ REP_FOTO = a; $("r_foto_nom").textContent = "Foto lista: se enviará con el reporte."; })
        .catch(function(e){ REP_FOTO = null; $("r_foto_nom").textContent = e.message; });
    });
    $("r_cancel_edit").addEventListener("click", function(){
      REP_EDIT_ID = null; $("r_editando").style.display = "none"; $("r_btn").textContent = "Enviar reporte a Ernesto";
    });
    /* Chat: adjuntos, voz, búsqueda.
       v1.5.0 (Chat PRO, la misma orden que en Mi Negocio v12): el
       clip abre la HOJA de adjuntos con un toque — filas «Foto o
       vídeo · Cámara · Documento» — y cada fila dispara SU selector
       sincrónicamente dentro del mismo gesto (en Android el
       selector del sistema; en el APK, si el plugin de cámara está
       presente, su galería nativa). Se acabó el atajo escondido a
       presión larga que Ernesto cazó como «programación básica». */
    function cerrarHojaAdjMT(){ var hj = $("c_adj_hoja"); if (hj) hj.classList.remove("abierta"); }
    function filaAdjMT(idBtn, idFile){
      var btn = $(idBtn), fi = $(idFile);
      if (btn && fi) btn.addEventListener("click", function(){ cerrarHojaAdjMT(); fi.click(); });
    }
    /* En el APK (Capacitor), «Foto o vídeo» usa la GALERÍA NATIVA
       del sistema vía @capacitor/camera (Photo Picker de Android,
       sin permisos); en la web/PWA — o si el plugin no responde —
       cae limpio al selector de archivos de siempre. */
    function elegirFotoNativaMT(){
      var Cap = window.Capacitor;
      var Cam = Cap && Cap.Plugins && Cap.Plugins.Camera;
      if (!Cam || !Cap.isNativePlatform || !Cap.isNativePlatform()) return false;
      cerrarHojaAdjMT();
      Cam.pickImages({ quality: 90, limit: 1 }).then(function(res){
        var ph = res && res.photos && res.photos[0];
        if (!ph || !ph.webPath) return;
        return fetch(ph.webPath).then(function(r){ return r.blob(); }).then(function(b){
          procesarFotoMT(new File([b], "foto-galeria.jpg", { type: b.type || "image/jpeg" }));
        });
      }).catch(function(){ var fi = $("c_file_foto"); if (fi) fi.click(); });
      return true;
    }
    var btnAdjFotoMT = $("c_adj_foto");
    if (btnAdjFotoMT) btnAdjFotoMT.addEventListener("click", function(){ if (!elegirFotoNativaMT()) { cerrarHojaAdjMT(); $("c_file_foto").click(); } });
    filaAdjMT("c_adj_cam", "c_file_cam");
    filaAdjMT("c_adj_arch", "c_file_arch");
    var cerrarAdjMT = $("c_adj_cerrar");
    if (cerrarAdjMT) cerrarAdjMT.addEventListener("click", cerrarHojaAdjMT);
    var clipMT = $("c_clip");
    if (clipMT) clipMT.addEventListener("click", function(){
      var hj = $("c_adj_hoja"); if (hj) hj.classList.toggle("abierta");
    });
    var infoMT = $("c_info");
    if (infoMT) infoMT.addEventListener("click", function(){
      var d = $("c_estados"); if (!d) return;
      d.style.display = (d.style.display === "block") ? "none" : "block";
    });
    function procesarFotoMT(f){
      if (!f) return;
      leerArchivoMT(f, true).then(function(a){
        CHAT_ADJ = a; pintarPreviaAdjMT();
        /* La foto abre su editor a pantalla completa — texto abajo
           y botón redondo; foto y texto salen en UN mensaje. */
        if (a && a.tipo === "foto") abrirEditorFotoMT();
      }).catch(function(e){ chatFallo(e.message); });
    }
    function alElegirFotoMT(input){
      var f = input.files && input.files[0];
      try { input.value = ""; } catch(e){}
      procesarFotoMT(f);
    }
    $("c_file_foto").addEventListener("change", function(){ alElegirFotoMT($("c_file_foto")); });
    $("c_file_cam").addEventListener("change", function(){ alElegirFotoMT($("c_file_cam")); });
    $("c_file_arch").addEventListener("change", function(){
      var f = $("c_file_arch").files && $("c_file_arch").files[0];
      try { $("c_file_arch").value = ""; } catch(e){}
      if (!f) return;
      leerArchivoMT(f, false).then(function(a){ CHAT_ADJ = a; pintarPreviaAdjMT(); }).catch(function(e){ chatFallo(e.message); });
    });
    $("c_buscar").addEventListener("input", function(){ pintarChat(CHAT_MSGS); });
    $("c_buscar_mas").addEventListener("click", function(){
      var q = ($("c_buscar").value || "").trim(); if (!q || !SESION) return;
      rpcChat("leer_chat", { p_codigo: SESION, p_con: "ADMIN", p_clave: SESION, p_buscar: q }).then(function(r){
        if (r && r.ok && r.mensajes) { CHAT_FIJADO = r.fijado || CHAT_FIJADO; pintarChat(r.mensajes); }
      });
    });
    var grabando = null, recMT = null, chunksMT = [], grabT0MT = 0, grabTickMT = null;
    function mejorMimeVozMT(){
      try {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
          if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
          if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
        }
      } catch(e){}
      return "";
    }
    $("c_mic").addEventListener("click", function(){
      if (grabando) { grabando.stop(); return; }
      if (!navigator.mediaDevices || !window.MediaRecorder) { chatFallo("Este aparato no deja grabar voz aquí: manda el mensaje escrito."); return; }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
        chunksMT = [];
        /* v1.4.2: mejor mime soportado (iPhone graba mp4/AAC) y 32 kbps:
           el adjunto guarda el dataURL COMPLETO con el tipo real. */
        var mimeMT = mejorMimeVozMT();
        try { recMT = mimeMT ? new MediaRecorder(stream, { mimeType: mimeMT, audioBitsPerSecond: 32000 }) : new MediaRecorder(stream, { audioBitsPerSecond: 32000 }); }
        catch(e) { recMT = new MediaRecorder(stream); }
        recMT.ondataavailable = function(e){ if (e.data && e.data.size) chunksMT.push(e.data); };
        recMT.onstop = function(){
          stream.getTracks().forEach(function(t){ t.stop(); });
          if (grabTickMT) { clearInterval(grabTickMT); grabTickMT = null; }
          grabando = null; micPintarMT(null); $("c_mic").classList.remove("grabando");
          var blob = new Blob(chunksMT, { type: recMT.mimeType || mimeMT || "audio/webm" });
          if (blob.size > MAX_ADJ_MT) { chatFallo("La nota pesa más de 5 MB: graba una más corta (máx 2 min)."); return; }
          var fr = new FileReader();
          fr.onload = function(){
            /* v1.4.7: la duración sale del temporizador de la
               grabación (grabT0MT), no del metadato: la burbuja y
               la previa la pintan al instante, sin «0:00» eterno. */
            CHAT_ADJ = { tipo: "voz", datos: String(fr.result), nombre: "Nota de voz", tam: blob.size, dur: Math.max(1, Math.round((Date.now() - grabT0MT) / 1000)) };
            /* v1.4.2: vista previa con su propio ▶ para ESCUCHAR antes de enviar */
            var an = $("c_adj_nom");
            an.innerHTML = "";
            var et = document.createElement("span"); et.textContent = "Nota de voz lista — escúchala y toca Enviar: ";
            an.appendChild(et);
            var cont = document.createElement("span");
            cont.innerHTML = reproductorVozHtmlMT({ adj_datos: String(fr.result), adj_dur: CHAT_ADJ.dur });
            an.appendChild(cont);
            alistarReproductoresVozMT(an);
            /* v1.4.3: la previa de voz lleva el mismo marco del kit
               y su botón Quitar, como la foto y el documento. */
            var pvMT = document.createElement("div"); pvMT.className = "prevAdj";
            while (an.firstChild) pvMT.appendChild(an.firstChild);
            pvMT.appendChild(botonQuitarAdjMT());
            an.appendChild(pvMT);
          };
          fr.readAsDataURL(blob);
        };
        recMT.start();
        grabando = recMT;
        grabT0MT = Date.now();
        $("c_mic").classList.add("grabando");
        micPintarMT("0:00");
        grabTickMT = setInterval(function(){ micPintarMT(fmtTiempoVozMT((Date.now() - grabT0MT) / 1000)); }, 250);
        setTimeout(function(){ if (grabando) grabando.stop(); }, 120000);
      }).catch(function(){ chatFallo("Sin permiso de micrófono: actívalo para la app si quieres mandar voz."); });
    });
    /* El botón Reportar registró la función ORIGINAL al cargar: se
       clona (pierde ese registro) y se enlaza a la versión v1.4.0
       (que sabe corregir pendientes y adjuntar la foto). */
    var rb0 = $("r_btn");
    var rb1 = rb0.cloneNode(true);
    rb0.parentNode.replaceChild(rb1, rb0);
    rb1.addEventListener("click", function(){ reportar(); });
  } catch(e) { /* cableado parcial degradado: la 1.3.1 sigue intacta */ }
})();

/* reportar(): si REP_EDIT_ID está activo, corrige en vez de crear.
   Se envuelve la función original sin tocar su cuerpo. */
var reportarOriginalMT = reportar;
reportar = function(){
  if (!REP_EDIT_ID) { reportarOriginalMT(); return; }
  var warn = $("r_warn"), res = $("r_res");
  warn.style.display = "none"; res.style.display = "none";
  function fallo(m){ warn.style.display = "block"; warn.textContent = m; }
  var cambios = {};
  if (REP_TIPO === "saldo") {
    var pr = num("r_precio"), ct = num("r_cant") || 1;
    if (pr === null || pr <= 0) return fallo("Escribe el precio corregido.");
    cambios.p_precio = pr; cambios.p_cantidad = ct; cambios.p_porc = null;
  } else {
    var ef = num("r_ef"), pc = num("r_pct");
    if (ef === null || ef <= 0) return fallo("Escribe el efectivo corregido.");
    if (pc === null) return fallo("Escribe el % corregido.");
    cambios.p_precio = null; cambios.p_cantidad = ef; cambios.p_porc = pc;
  }
  cambios.p_codigo = SESION; cambios.p_id = REP_EDIT_ID;
  cambios.p_telefono = ($("r_tel").value || "").trim() || null;
  cambios.p_nota = ($("r_nota").value || "").trim() || null;
  rpcMsg("editar_reporte", cambios).then(function(r){
    if (!r.ok) {
      if (marcarPausaSiToca(r.error)) return fallo("Estás en pausa: habla con Ernesto");
      return fallo("No se pudo corregir (quizás Ernesto ya lo aprobó): " + (r.error || ""));
    }
    var a = outboxGet();
    a.forEach(function(rp){
      if (rp.id === REP_EDIT_ID) {
        if (cambios.p_precio !== null && cambios.p_precio !== undefined) rp.precio = cambios.p_precio;
        if (cambios.p_porc !== null && cambios.p_porc !== undefined) rp.porc = cambios.p_porc;
        rp.cantidad = cambios.p_cantidad; rp.telefono = cambios.p_telefono; rp.nota = cambios.p_nota; rp.editado = true;
      }
    });
    outboxSet(a); renderOutbox();
    REP_EDIT_ID = null; $("r_editando").style.display = "none";
    $("r_btn").textContent = "Enviar reporte a Ernesto";
    res.style.display = "block";
  });
};
/* La foto se adjunta DENTRO del reportar original (antes de enviar):
   aquí solo se limpia el campo tras crear un reporte nuevo con foto. */
var reportarConFotoMT = reportar;
reportar = function(){
  var antes = outboxGet().length;
  var fotoPendiente = (typeof REP_FOTO !== "undefined" && REP_FOTO && !REP_EDIT_ID) ? REP_FOTO : null;
  reportarConFotoMT();
  if (fotoPendiente && outboxGet().length > antes) {
    REP_FOTO = null;
    var rf = $("r_foto"); if (rf) rf.value = "";
    var nom = $("r_foto_nom"); if (nom) nom.textContent = "Foto enviada con el reporte.";
  }
};

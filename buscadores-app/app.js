"use strict";
var APP_VERSION = "1.3.0";
/* Tarifa de respaldo: se usa sin conexión si nunca se ha descargado datos.json.
   La tarifa viva viene de datos.json (la actualiza Ernesto/Máximo). */
var DEFAULT_TARIFA = { ingresoRef360: 1092.65, libroRef: 1110, salidaRef: 950,
  pctSaldo: 25, pctTransf: 20, pisoTransf: 25,
  bonoSaldoMeta: 150, bonoSaldoMonto: 300, bonoTransfMeta: 10, bonoTransfMonto: 300 };
var DATA = { tarifa: DEFAULT_TARIFA, actualizado: "", buscadores: {} };
var T = DEFAULT_TARIFA;
var DATA_VERSION = 0;   /* mayor version de datos.json aplicada: la guarda no deja bajar */
var SESION = "";        /* código personal de la sesión activa ("" = sin entrar) */
var TARIFA_VIVA = null; /* v1.3.0: tarifa leída en vivo (leer_tarifa); manda sobre datos.json */
var TARIFA_VIVA_EN = "";/* v1.3.0: ISO de la última publicación de la tarifa viva */
var PANEL_VIVO = null;  /* v1.3.0: {nombre, tratos} leídos en vivo (leer_panel) */

/* ===== Supabase (clave pública; las puertas RPC validan el código) ===== */
var SB_URL = "https://otsudfgwpapkluusrlnj.supabase.co/rest/v1/reportes";
var SB_RPC = SB_URL.replace("/reportes", "/rpc/");
var SB_KEY = "sb_publishable_Uchl5QnojJkZbXR5ar8vDg_5CXnqi_d";
function sbHeaders(){ return { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json" }; }

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
  $("s_det").innerHTML = "Excedente por recarga: " + fmtN(r.exc) + " CUP · tu " + T.pctSaldo + "% = " + fmtN(r.fee / c) + " por recarga" +
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
  $("t_det").innerHTML = "La persona recibe " + fmtN(r.recibe) + " por transferencia · la vuelta gana " + fmtN(r.ganancia) + " CUP · tu " + T.pctTransf + "% = tu comisión.<br>Se paga cuando la vuelta cierra.";
}

/* ===== Sesión: login único con validación real ===== */
function normCod(s){ return String(s || "").trim().toUpperCase(); }
function sesionGet(){ try { return normCod(localStorage.getItem("busc_codigo")); } catch(e){ return ""; } }
function sesionSet(c){ try { localStorage.setItem("busc_codigo", c); } catch(e){} }
function sesionClear(){ try { localStorage.removeItem("busc_codigo"); } catch(e){} }
function codigoEnDatos(code){ return !!(code && DATA.buscadores && DATA.buscadores[code]); }

/* Comprueba el código contra Supabase (RPC validar_usuario).
   Resuelve {estado:"ok", codigo, nombre} | {estado:"no"} | {estado:"sinred"}. */
function rpcValidar(code){
  if (!window.fetch) return Promise.resolve({ estado: "sinred" });
  return fetch(SB_RPC + "validar_usuario", { method: "POST", headers: sbHeaders(),
      body: JSON.stringify({ p_codigo: code }) })
    .then(function(r){ return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
    .then(function(rows){
      if (rows && rows.length && rows[0].activo !== false)
        return { estado: "ok", codigo: normCod(rows[0].codigo || code), nombre: rows[0].nombre || "" };
      return { estado: "no" };
    })
    .catch(function(){ return { estado: "sinred" }; });
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
function entrar(code){
  SESION = code; sesionSet(code);
  $("loginGate").classList.add("hide");
  document.body.classList.remove("locked");
  gateMsg("");
  try { $("l_cod").value = ""; } catch(e){}
  renderPanel();
  tocarPresencia();
  chatBadge();
  cargarVivo();
}
function salir(msg){
  SESION = ""; sesionClear();
  PANEL_VIVO = null;
  try { $("l_cod").value = ""; } catch(e){}
  pintarBadge(0);
  var body = $("p_body"); if (body) body.classList.add("hide");
  mostrarGate(msg || "");
}
/* Intento de entrada: valida contra Supabase y exige que el código exista en
   datos.json (para el panel). Solo si pasa las dos cosas se guarda la sesión.
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
  var espera = Promise.race([ loadData(), new Promise(function(res){ setTimeout(res, 9000); }) ]);
  return espera.then(function(){ return rpcValidar(code); }).then(function(v){
    btn.disabled = false; btn.textContent = txt0;
    if (v.estado === "ok" && codigoEnDatos(v.codigo)) { entrar(v.codigo); return true; }
    if (v.estado === "sinred" && codigoEnDatos(code)) { entrar(code); return true; }  // sin red: mandan los datos guardados
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
  var bDatos = DATA.buscadores ? DATA.buscadores[SESION] : null;
  var b = PANEL_VIVO ? { nombre: PANEL_VIVO.nombre || (bDatos ? bDatos.nombre : ""), tratos: PANEL_VIVO.tratos || [] } : bDatos;
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
    if (tr.tipo === "saldo") recSaldo += tr.recargas || 0;
    if (tr.tipo === "transferencia") nTransf += 1;
    html += '<div class="trato"><span class="f">' + tr.fecha + "</span><span>" +
      (tr.tipo === "saldo" ? ico("i-phone", "mini") + " " : ico("i-bank", "mini") + " ") + (tr.nota || "") + '</span><span class="c">' + fmt(tr.comision || 0) + "</span></div>";
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
  return "<b>Tarifa de referencia</b>" + (DATA.actualizado ? " (" + DATA.actualizado + ")" : "") +
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
  try { localStorage.setItem("busc_datos", JSON.stringify(d)); } catch(e){}
  checkUpdate();
  $("tarifaTxt").innerHTML = tarifaText();
  pintaFrescura();
  calcSaldo(); calcTransf();
  if (SESION) {
    if (fresca && !codigoEnDatos(SESION)) {       // Ernesto lo sacó: al sincronizar, sale
      salir("Tu acceso ya no está activo en los datos nuevos. Habla con Ernesto.");
      return;
    }
    renderPanel();
  }
  if (TARIFA_VIVA) aplicarTarifaViva();   // v1.3.0: un datos.json tardío nunca pisa la tarifa viva
}
function fetchDatos(url, fresca){
  return fetch(url, { cache: "no-store" }).then(function(r){ return r.ok ? r.json() : null; })
    .then(function(d){ if (d) applyData(d, fresca); return !!d; })
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
      : rp.estado === "rechazado" ? '<span class="st no"><span class="dot"></span>Rechazado' + (rp.motivo ? ": " + rp.motivo : "") + "</span>"
      : '<span class="st pend"><span class="dot"></span>Pendiente' + (rp.enviado ? "" : " (guardado, sin enviar)") + "</span>";
    h += '<div class="rep"><span>' + repResumen(rp) + "<br><small>" + rp.fecha + "</small></span>" + st + "</div>";
  });
  box.innerHTML = h || '<div class="rep"><span>Todavía no has reportado nada.</span></div>';
}
function enviarReporte(rp){
  if (!window.fetch) return Promise.resolve(false);
  return fetch(SB_RPC + "registrar_reporte", { method: "POST", headers: sbHeaders(),
    body: JSON.stringify({ p_buscador: rp.buscador, p_tipo: rp.tipo, p_precio: rp.precio, p_porc: rp.porc,
      p_cantidad: rp.cantidad, p_telefono: rp.telefono || null, p_nota: rp.nota || null })
  }).then(function(r){
      if (r.ok) return r.json();
      return r.json().catch(function(){ return {}; }).then(function(e){
        if (e && e.message && e.message.indexOf("no autorizado") !== -1) rp.error = "noautorizado";
        return Promise.reject(new Error("HTTP " + r.status));
      });
    })
    .then(function(id){
      if (id) { rp.id = id; rp.enviado = true; }
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
    if (changed) outboxSet(a);
    // refrescar estados de los ya enviados (por si Ernesto ya decidió)
    var ids = a.filter(function(rp){ return rp.enviado && rp.id && rp.estado === "pendiente"; }).map(function(rp){ return rp.id; });
    if (!ids.length || !window.fetch) { renderOutbox(); return; }
    fetch(SB_RPC + "estado_reportes", { method: "POST", headers: sbHeaders(),
        body: JSON.stringify({ p_ids: ids }) })
      .then(function(r){ return r.ok ? r.json() : []; }).then(function(rows){
        var map = {}; (rows || []).forEach(function(x){ map[x.id] = x; });
        a.forEach(function(rp){
          var s = map[rp.id];
          if (s && s.estado && s.estado !== "pendiente") { rp.estado = s.estado; rp.comision = s.comision; rp.motivo = s.motivo; }
        });
        outboxSet(a); renderOutbox();
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
    telefono: tel, nota: nota, estado: "pendiente", enviado: false, id: null,
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
  var a = outboxGet(); a.push(rp); outboxSet(a); renderOutbox();
  enviarReporte(rp).then(function(ok){
    if (ok) outboxSet(a); // rp ya trae id y enviado=true (misma referencia dentro de a)
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
function rpcChat(fn, body){
  if (!window.fetch) return Promise.resolve(null);
  return fetch(SB_RPC + fn, { method: "POST", headers: sbHeaders(), body: JSON.stringify(body) })
    .then(function(r){ return r.ok ? r.json() : null; })
    .catch(function(){ return null; });
}
/* Latido: Ernesto ve en su panel quién está en línea (< 3 min). */
function tocarPresencia(){
  if (!SESION) return;
  rpcChat("tocar_presencia", { p_codigo: SESION });
}
function horaChat(iso){
  var d = new Date(iso); if (isNaN(d.getTime())) return "";
  function p(x){ return (x < 10 ? "0" : "") + x; }
  return p(d.getHours()) + ":" + p(d.getMinutes());
}
function escChat(x){ return String(x === null || x === undefined ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function pintarChat(msgs){
  var box = $("c_hilo"); if (!box) return;
  if (!msgs || !msgs.length){
    box.innerHTML = '<div class="chatVacio">Todavía no hay mensajes. Escríbele a Ernesto lo que necesites: dudas de un trato, algo que no funciona o una idea.</div>';
    return;
  }
  var h = "";
  msgs.forEach(function(m){
    var mio = m.de === SESION;
    h += '<div class="msg ' + (mio ? "me" : "him") + '"><div class="bur">' + escChat(m.texto) + '</div><div class="mhora">' + (mio ? "Tú" : "Ernesto") + " · " + horaChat(m.creado) + "</div></div>";
  });
  box.innerHTML = h;
  try { box.scrollTop = box.scrollHeight; } catch(e){}
}
var chatCargando = false;
function chatCargar(){
  if (!SESION || chatCargando) return;
  chatCargando = true;
  rpcChat("leer_chat", { p_codigo: SESION, p_con: "ADMIN", p_clave: SESION }).then(function(r){
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
    if (r && r.ok) { PANEL_VIVO = { nombre: r.nombre || "", tratos: r.tratos || [] }; renderPanel(); }
  });
}
function cargarVivo(){ leerTarifaViva(); leerPanelVivo(); }

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
    else fallo("No se pudo enviar ahora. Revisa tu conexión y toca Enviar otra vez (el mensaje no se perdió de la caja: vuelve a intentarlo).");
  });
}

/* ===== Refresco manual / al volver a primer plano ===== */
var lastRefresh = 0;
function refrescarTodo(){
  lastRefresh = Date.now();
  var ft = $("freshTxt"); if (ft) ft.textContent = "Actualizando…";
  var p = loadData();
  syncReportes(); chatBadge(); tocarPresencia(); cargarVivo();
  if (!$("viewAyuda").classList.contains("hide")) chatCargar();
  if (SESION) rpcValidar(SESION).then(function(v){
    if (v.estado === "no") salir("Tu acceso ya no está activo. Habla con Ernesto.");
  });
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
$("tabAyuda").addEventListener("click", function(){ showView("Ayuda"); });
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
setInterval(function(){ try { pintaFrescura(); } catch(e){} try { tocarPresencia(); } catch(e){} }, 60000);
setInterval(function(){
  if (!SESION) return;
  try { chatBadge(); } catch(e){}
  try { if (!$("viewAyuda").classList.contains("hide")) chatCargar(); } catch(e){}
}, 20000);
try { $("verLab").textContent = APP_VERSION; } catch(e){}

if ("serviceWorker" in navigator && !esNativo()) {
  window.addEventListener("load", function(){ navigator.serviceWorker.register("sw.js").catch(function(){}); });
}

/* ===== Arranque ===== */
lastRefresh = Date.now();
loadData();
leerTarifaViva();
renderOutbox();
syncReportes();
(function arranque(){
  var previa = sesionGet();
  var urlCod = "";
  try { urlCod = normCod(new URLSearchParams(window.location.search).get("codigo")); } catch(e){}
  if (urlCod) {
    try { history.replaceState(null, "", window.location.pathname + window.location.hash); } catch(e){}
    mostrarGate("");
    intentarLogin(urlCod, true).then(function(ok){
      if (!ok && previa && previa !== urlCod) entrar(previa);   // enlace malo: se respeta la sesión que hubiera
    });
  } else if (previa) {
    entrar(previa);
  } else {
    mostrarGate("");
  }
})();

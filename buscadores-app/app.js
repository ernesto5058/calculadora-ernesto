"use strict";
var APP_VERSION = "1.4.0";
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
var ADMIN_VISTO = null; /* v1.3.1: ISO del último latido de Ernesto (fila 'ADMIN' en presencia) */
var CHAT_MSGS = [];     /* v1.3.1: último hilo cargado (para repintar estados al refrescar presencia) */

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
  cargarAdminPres();
  cargarVivo();
}
function salir(msg){
  SESION = ""; sesionClear();
  PANEL_VIVO = null;
  ADMIN_VISTO = null; CHAT_MSGS = [];
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
  var cuerpoRep = { p_buscador: rp.buscador, p_tipo: rp.tipo, p_precio: rp.precio, p_porc: rp.porc,
    p_cantidad: rp.cantidad, p_telefono: rp.telefono || null, p_nota: rp.nota || null };
  if (rp.adj && rp.adj.datos) { cuerpoRep.p_adj_tipo = rp.adj.tipo || "foto"; cuerpoRep.p_adj_datos = rp.adj.datos; }
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
  if (typeof REP_FOTO !== "undefined" && REP_FOTO) rp.adj = REP_FOTO;   /* v1.4.0: comprobante */
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
function escChat(x){ return String(x === null || x === undefined ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
/* ===== Estados del chat «como WhatsApp» (v1.3.1) =====
   En TUS mensajes: ✓ enviado (guardado, sin constancia de llegada)
   · ✓✓ entregado · ✓✓ en azul + «Visto». ENTREGADO, definido en la
   app: Ernesto abrió su panel DESPUÉS de que tu mensaje se envió
   (su latido visto >= creado del mensaje) pero aún no abrió el chat;
   abierto el chat, leer_chat marca leido=true -> «Visto». Si el
   mensaje trae el sello «recibido» del servidor (puerta
   marcar_recibidos del SQL v1.3.1), ese sello manda sobre la
   deducción. Los mensajes de Ernesto no llevan estado. */
function estadoMsgBusc(m){
  if (m.leido) return ' <span class="estVisto">✓✓ Visto</span>';
  if (m.recibido) return " ✓✓";
  if (ADMIN_VISTO) {
    var v = Date.parse(ADMIN_VISTO), c = Date.parse(m.creado);
    if (!isNaN(v) && !isNaN(c) && v >= c) return " ✓✓";
  }
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
  if (min < 3) return "Ernesto · 🟢 en línea";
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
  try { cargarAdminPres(); } catch(e){}
  try { if (!$("viewAyuda").classList.contains("hide")) chatCargar(); } catch(e){}
}, 20000);
setInterval(function(){
  // v1.3.1: con el chat abierto, el hilo se refresca cada ~15 s para
  // que los estados (entregado/visto) cambien solos, estilo WhatsApp.
  try { if (SESION && !$("viewAyuda").classList.contains("hide")) chatCargar(); } catch(e){}
}, 15000);
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

/* =====================================================================
   v1.4.0 — PERFIL + CHAT PRO + TEXTOS + AVISOS + MI SEMANA
   Todo degrada en silencio si una puerta aún no existe (el paquete
   SQL único las activa): la app sigue como en la 1.3.1.
   ===================================================================== */

/* ===== Motor de textos y cliente push compartidos (fuente única) ===== */
/*__MOTOR_TEXTOS__*/
/*__PUSH_CLIENTE__*/

/* ===== RPC con mensaje de error (para detectar la pausa) ===== */
var EN_PAUSA = false;
function rpcMsg(fn, body){
  if (!window.fetch) return Promise.resolve({ ok: false, error: "sin fetch" });
  return fetch(SB_RPC + fn, { method: "POST", headers: sbHeaders(), body: JSON.stringify(body) })
    .then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){
        if (r.ok) return { ok: true, data: j };
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
  if (esFoto) return comprimirFotoMT(file).then(function(d){ return { tipo: "foto", datos: d, nombre: file.name || "Foto" }; });
  return new Promise(function(res, rej){
    var fr = new FileReader();
    fr.onload = function(){ res({ tipo: "archivo", datos: String(fr.result), nombre: file.name || "Archivo", tam: file.size }); };
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
  var ahora = new Date(); ahora.setHours(0, 0, 0, 0);
  var lunes = new Date(ahora); lunes.setDate(ahora.getDate() - ((ahora.getDay() + 6) % 7));
  var domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6); domingo.setHours(23, 59, 59, 999);
  var sRec = 0, sTra = 0;
  (b.tratos || []).forEach(function(tr){
    total += tr.comision || 0;
    if (tr.tipo === "saldo") recSaldo += tr.recargas || 0;
    if (tr.tipo === "transferencia") nTransf += 1;
    var ms = fechaTratoMs(tr.fecha);
    if (!isNaN(ms) && ms >= lunes.getTime() && ms <= domingo.getTime()) {
      if (tr.tipo === "saldo") sRec += tr.recargas || 0;
      if (tr.tipo === "transferencia") sTra += 1;
    }
    html += '<div class="trato"><span class="f">' + tr.fecha + "</span><span>" +
      (tr.tipo === "saldo" ? ico("i-phone", "mini") + " " : ico("i-bank", "mini") + " ") + (tr.nota || "") +
      (tr.estado === "pagado" ? '<br><small>💰 Comisión pagada' + (tr.pagado_en ? " el " + tr.pagado_en : "") + "</small>" : "") +
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
function tempTexto(seg){
  if (!seg) return "";
  if (seg <= 86400) return "⏱️ Los mensajes desaparecen en 24 h";
  if (seg <= 7 * 86400) return "⏱️ Los mensajes desaparecen en 7 días";
  return "⏱️ Los mensajes desaparecen en 90 días";
}
function pintarChat(msgs){
  var box = $("c_hilo"); if (!box) return;
  CHAT_MSGS = msgs || [];
  var fj = $("c_fijado");
  if (fj) {
    if (CHAT_FIJADO && !CHAT_FIJADO.borrado) { fj.style.display = "block"; fj.textContent = "📌 " + (CHAT_FIJADO.texto || "Mensaje fijado"); }
    else fj.style.display = "none";
  }
  var tl = $("c_temp");
  if (tl) { var tt = tempTexto(CHAT_TEMP_SEG); tl.style.display = tt ? "block" : "none"; tl.textContent = tt; }
  if (!msgs || !msgs.length){
    box.innerHTML = '<div class="chatVacio">Todavía no hay mensajes. Escríbele a Ernesto lo que necesites: dudas de un trato, algo que no funciona o una idea.</div>';
    return;
  }
  var filtro = (($("c_buscar") && $("c_buscar").value) || "").trim().toLowerCase();
  var h = "";
  msgs.forEach(function(m){
    if (m.tipo === "sistema") { h += '<div class="msgSistema">' + escChat(m.texto) + "</div>"; return; }
    if (filtro && String(m.texto || "").toLowerCase().indexOf(filtro) === -1 && !m.adj_tipo) return;
    var mio = m.de === SESION;
    var est = mio ? estadoMsgBusc(m) : "";
    var inner = "";
    if (m.borrado) inner = '<span class="eliminado">Este mensaje fue eliminado</span>';
    else {
      if (m.resp_texto) inner += '<span class="cita">' + escChat(m.resp_autor === SESION ? "Tú" : (m.resp_autor || "")) + ": " + escChat(String(m.resp_texto).slice(0, 90)) + "</span>";
      if (m.adj_tipo === "foto" && m.adj_datos) inner += '<img class="adjFoto" alt="Foto" src="' + (String(m.adj_datos).indexOf("data:") === 0 ? m.adj_datos : "data:image/jpeg;base64," + m.adj_datos) + '">';
      else if (m.adj_tipo === "voz" && m.adj_datos) inner += '<audio controls src="' + (String(m.adj_datos).indexOf("data:") === 0 ? m.adj_datos : "data:audio/webm;base64," + m.adj_datos) + '"></audio>';
      else if (m.adj_datos) inner += '<span class="adjChip">📎 ' + escChat(m.adj_nombre || "Archivo") + "</span>";
      if (m.texto) inner += escChat(m.texto);
    }
    var reac = "";
    if (!m.borrado && m.reacciones && m.reacciones.length) {
      reac = '<div class="reacRow">' + m.reacciones.map(function(r){ return '<span class="reac">' + r.emoji + " " + r.total + "</span>"; }).join("") + "</div>";
    }
    h += '<div class="msg ' + (mio ? "me" : "him") + '" data-mid="' + m.id + '"><div class="bur">' + inner + '</div><div class="mhora">' + (mio ? "Tú" : "Ernesto") + " · " + horaChat(m.creado) + (m.editado ? ' <span class="editadoLab">editado</span>' : "") + est + "</div>" + reac + "</div>";
  });
  box.innerHTML = h || '<div class="chatVacio">Ningún mensaje coincide con la búsqueda en lo cargado. Prueba «Buscar más».</div>';
  box.querySelectorAll("[data-mid]").forEach(function(el){
    el.addEventListener("click", function(){ abrirMenuMsg(Number(el.getAttribute("data-mid"))); });
  });
  try { box.scrollTop = box.scrollHeight; } catch(e){}
}
function abrirMenuMsg(id){
  var m = (CHAT_MSGS || []).filter(function(x){ return x.id === id; })[0];
  var menu = $("c_menu"); if (!m || !menu) return;
  MENU_MSG = m;
  var mio = m.de === SESION;
  var h = "<b>" + (mio ? "Tu mensaje" : "Mensaje de Ernesto") + "</b>";
  if (!m.borrado) {
    h += '<button type="button" data-mm="resp">↩️ Responder</button>';
    EMOJIS_REAC.forEach(function(e){ h += '<button type="button" data-mm="reac" data-e="' + e + '">' + e + " Reaccionar</button>"; });
    h += '<button type="button" data-mm="copiar">📋 Copiar texto</button>';
    if (mio) {
      h += '<button type="button" data-mm="editar">✏️ Editar</button>';
      h += '<button type="button" data-mm="borrar">🗑️ Eliminar para todos</button>';
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
        rb.innerHTML = "↩️ Respondiendo a: «" + escChat(String(m.texto || m.adj_nombre || "adjunto").slice(0, 80)) + "» <button type='button' class='miniBtn' id='c_resp_x'>Quitar</button>";
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
var chatCargando2 = false;
function chatCargar(){
  if (!SESION || chatCargando2) return;
  chatCargando2 = true;
  cargarAdminPres();
  rpcChat("leer_chat", { p_codigo: SESION, p_con: "ADMIN", p_clave: SESION }).then(function(r){
    chatCargando2 = false;
    if (r && r.ok && r.mensajes) {
      CHAT_FIJADO = r.fijado || null;
      CHAT_TEMP_SEG = Number(r.temporal_seg || 0);
      pintarChat(r.mensajes); pintarBadge(0);
    }
  });
}
function chatEnviar(){
  var warn = $("c_warn"); warn.style.display = "none";
  if (!SESION) return chatFallo("Primero entra con tu código personal desde la pantalla de inicio.");
  if (EN_PAUSA) return chatFallo("Estás en pausa: habla con Ernesto");
  var txt = ($("c_txt").value || "").trim();
  if (!txt && !CHAT_ADJ) return chatFallo("Escribe el mensaje o adjunta algo primero.");
  var btn = $("c_btn"); btn.disabled = true;
  var body = { p_de: SESION, p_para: "ADMIN", p_texto: txt, p_clave: SESION };
  if (CHAT_RESP) body.p_resp_de = CHAT_RESP.id;
  if (CHAT_ADJ) { body.p_adj_tipo = CHAT_ADJ.tipo; body.p_adj_datos = CHAT_ADJ.datos; body.p_adj_nombre = CHAT_ADJ.nombre || null; body.p_adj_tam = CHAT_ADJ.tam || null; }
  rpcMsg("enviar_mensaje", body).then(function(r){
    btn.disabled = false;
    if (r.ok) {
      $("c_txt").value = ""; CHAT_RESP = null; CHAT_ADJ = null;
      var rb = $("c_resp"); if (rb) rb.style.display = "none";
      var an = $("c_adj_nom"); if (an) an.textContent = "";
      chatCargar();
    } else if (marcarPausaSiToca(r.error)) chatFallo("Estás en pausa: habla con Ernesto");
    else chatFallo("No se pudo enviar ahora. Revisa tu conexión y toca Enviar otra vez.");
  });
}

/* ===== REPORTAR v1.4.0: editar pendiente ===== */
var REP_EDIT_ID = null;
var REP_FOTO = null;
function renderOutbox(){
  var a = outboxGet(), box = $("r_lista"), h = "";
  a.slice().reverse().forEach(function(rp){
    var st = rp.estado === "aprobado" ? '<span class="st okk"><span class="dot"></span>Aprobado +' + fmt(rp.comision || 0) + "</span>"
      : rp.estado === "rechazado" ? '<span class="st no"><span class="dot"></span>Rechazado' + (rp.motivo ? ": " + rp.motivo : "") + "</span>"
      : '<span class="st pend"><span class="dot"></span>Pendiente' + (rp.enviado ? "" : " (guardado, sin enviar)") + "</span>";
    var ed = (rp.estado === "pendiente" && rp.id) ? ' <button type="button" class="miniBtn" data-edrep="' + rp.id + '">✏️ Editar</button>' : "";
    h += '<div class="rep"><span>' + repResumen(rp) + "<br><small>" + rp.fecha + "</small>" + ed + "</span>" + st + "</div>";
  });
  box.innerHTML = h || '<div class="rep"><span>Todavía no has reportado nada.</span></div>';
  box.querySelectorAll("[data-edrep]").forEach(function(b){
    b.addEventListener("click", function(){
      var rp = outboxGet().filter(function(x){ return x.id === Number(b.getAttribute("data-edrep")); })[0];
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
  if (p.telefono && !$("tx_tel").value) $("tx_tel").value = p.telefono;
  if (p.zona && !$("tx_zona").value) $("tx_zona").value = p.zona;
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
    if (DATA.buscadores && DATA.buscadores[actual]) { DATA.buscadores[nuevo] = DATA.buscadores[actual]; delete DATA.buscadores[actual]; }
    SESION = nuevo; sesionSet(nuevo);
    okEl.style.display = "block";
    okEl.textContent = "✅ Código cambiado. Tu enlace personal nuevo está abajo: guárdalo.";
    pintarEnlace(); renderPanel();
  });
}
function activarAvisosMT(){
  var txt = $("pf_push_txt");
  var est = estadoPush();
  if (est === "instalar") { txt.textContent = "En iPhone los avisos solo funcionan con la app instalada en pantalla de inicio. En Android (tu APK) funcionan directo: si no se activan, revisa el permiso de notificaciones de la app."; return; }
  if (est === "sin-soporte") { txt.textContent = "Este aparato/navegador no admite avisos push."; return; }
  activarPush(function(sub){
    return rpcChat("registrar_push", { p_codigo: SESION, p_suscripcion: sub, p_plataforma: /android/i.test(navigator.userAgent || "") ? "android" : (/iphone|ipad/i.test(navigator.userAgent || "") ? "ios" : "web") });
  }).then(function(){ txt.textContent = "🔔 Avisos activados en este aparato."; })
    .catch(function(){ txt.textContent = "No se pudo activar: revisa el permiso de notificaciones."; });
}

/* ===== TEXTOS (generador; motor compartido) ===== */
var TX_LS = "busc_textos_v1";
function txHist(){ try { return JSON.parse(localStorage.getItem(TX_LS) || "[]"); } catch(e){ return []; } }
function txHistPintar(){
  var el = $("tx_hist"); if (!el) return;
  var hs = txHist();
  el.innerHTML = hs.length ? hs.map(function(x, i){ return '<div class="rep"><span>' + escChat(x.titulo || "Texto") + '</span><button type="button" class="miniBtn" data-txh="' + i + '">Copiar</button></div>'; }).join("") : '<div class="rep"><span>Aún no generaste textos.</span></div>';
  el.querySelectorAll("[data-txh]").forEach(function(b){ b.addEventListener("click", function(){ var x = txHist()[Number(b.getAttribute("data-txh"))]; if (x && navigator.clipboard) navigator.clipboard.writeText(x.texto || ""); }); });
}
function txEstilo(){
  return { emojis: $("tx_emojis").value, tono: $("tx_tono").value, tamano: $("tx_tam").value,
    mayus: $("tx_mayus").checked, urgencia: $("tx_urg").checked, privadoLlamada: $("tx_priv_llamada").checked,
    hashtags: $("tx_hash").checked, whatsapp: $("tx_dest").value === "wa" };
}
var TX_ULT = [];
function txPintar(res, titulo){
  TX_ULT = res.versiones;
  var out = (res.avisos.length ? '<div class="hint">⚠️ ' + res.avisos.map(escChat).join(" ") + "</div>" : "");
  res.versiones.forEach(function(v, i){
    out += '<label>Versión ' + (i + 1) + " · " + escChat(v.enfoque) + '</label><div class="versionTxt">' + escChat(v.texto) + '</div>' +
      '<div class="chatTools"><button type="button" data-txc="' + i + '">Copiar</button>' +
      '<a class="miniBtn" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(v.texto) + '">Compartir a WhatsApp</a></div>';
  });
  $("tx_out").innerHTML = out;
  $("tx_out").querySelectorAll("[data-txc]").forEach(function(b){ b.addEventListener("click", function(){ if (navigator.clipboard) navigator.clipboard.writeText(TX_ULT[Number(b.getAttribute("data-txc"))].texto); }); });
  try { localStorage.setItem(TX_LS, JSON.stringify(TextosMotor.historialPush(txHist(), { titulo: titulo, cuando: new Date().toISOString(), texto: res.versiones[0].texto }))); } catch(e){}
  txHistPintar();
}
function txGenerar(){
  var precio = parseFloat(String($("tx_precio").value).replace(",", "."));
  var res = TextosMotor.generar({ tipo: $("tx_tipo").value, producto: $("tx_prod").value,
    precio: isFinite(precio) ? precio : null, moneda: $("tx_moneda").value, privado: $("tx_privado").checked,
    cantidad: $("tx_cant").value, detalles: $("tx_det").value, zona: $("tx_zona").value,
    telefono: $("tx_tel").value, estilo: txEstilo(), quien: SESION || "BUSC" });
  txPintar(res, $("tx_prod").value || "Oferta");
}
function txRapidoSaldo(){
  var pub = { precioCompraRecarga: Math.floor(Number(T.ingresoRef360 || 0) * 0.9 / 10) * 10,
    telefono: $("tx_tel").value, zona: $("tx_zona").value, condicionesSaldo: "Pago en efectivo al momento" };
  txPintar(TextosMotor.textoRapidoSaldo(pub, txEstilo(), SESION || "BUSC"), "Texto de saldo");
}
function txRapidoTransf(){
  var pub = { telefono: $("tx_tel").value, zona: $("tx_zona").value, condicionesTransf: "Solo personas conocidas" };
  txPintar(TextosMotor.textoRapidoTransf(pub, txEstilo(), SESION || "BUSC"), "Texto de transferencia");
}

/* ===== Vistas nuevas + cableado v1.4.0 ===== */
function showView(v){
  ["Calc","Rep","Panel","Ayuda","Textos","Perfil"].forEach(function(x){
    var t = $("tab" + x), vw = $("view" + x);
    if (t) t.classList.toggle("on", x === v);
    if (vw) vw.classList.toggle("hide", x !== v);
  });
  if (v === "Rep") renderOutbox();
  if (v === "Panel") renderPanel();
  if (v === "Ayuda") chatCargar();
  if (v === "Perfil") cargarPerfil();
  if (v === "Textos") txHistPintar();
}
(function cablearV14(){
  try {
    $("tabTextos").addEventListener("click", function(){ showView("Textos"); });
    $("tabPerfil").addEventListener("click", function(){ showView("Perfil"); });
    $("pf_btn").addEventListener("click", guardarPerfil);
    $("cc_btn").addEventListener("click", cambiarCodigo);
    $("pf_push").addEventListener("click", activarAvisosMT);
    $("tx_gen").addEventListener("click", txGenerar);
    $("tx_saldo").addEventListener("click", txRapidoSaldo);
    $("tx_transf").addEventListener("click", txRapidoTransf);
    pintarColores();
    /* Reportar: foto del comprobante + edición */
    $("r_foto").addEventListener("change", function(){
      var f = $("r_foto").files && $("r_foto").files[0];
      if (!f) { REP_FOTO = null; return; }
      leerArchivoMT(f, true).then(function(a){ REP_FOTO = a; $("r_foto_nom").textContent = "📷 Foto lista: se enviará con el reporte."; })
        .catch(function(e){ REP_FOTO = null; $("r_foto_nom").textContent = "⚠️ " + e.message; });
    });
    $("r_cancel_edit").addEventListener("click", function(){
      REP_EDIT_ID = null; $("r_editando").style.display = "none"; $("r_btn").textContent = "Enviar reporte a Ernesto";
    });
    /* Chat: adjuntos, voz, búsqueda */
    $("c_adj_foto").addEventListener("click", function(){ $("c_file_foto").click(); });
    $("c_adj_arch").addEventListener("click", function(){ $("c_file_arch").click(); });
    $("c_file_foto").addEventListener("change", function(){
      var f = $("c_file_foto").files && $("c_file_foto").files[0]; if (!f) return;
      leerArchivoMT(f, true).then(function(a){ CHAT_ADJ = a; $("c_adj_nom").textContent = "📷 Foto lista para enviar."; }).catch(function(e){ chatFallo(e.message); });
    });
    $("c_file_arch").addEventListener("change", function(){
      var f = $("c_file_arch").files && $("c_file_arch").files[0]; if (!f) return;
      leerArchivoMT(f, false).then(function(a){ CHAT_ADJ = a; $("c_adj_nom").textContent = "📎 " + a.nombre + " listo para enviar."; }).catch(function(e){ chatFallo(e.message); });
    });
    $("c_buscar").addEventListener("input", function(){ pintarChat(CHAT_MSGS); });
    $("c_buscar_mas").addEventListener("click", function(){
      var q = ($("c_buscar").value || "").trim(); if (!q || !SESION) return;
      rpcChat("leer_chat", { p_codigo: SESION, p_con: "ADMIN", p_clave: SESION, p_buscar: q }).then(function(r){
        if (r && r.ok && r.mensajes) { CHAT_FIJADO = r.fijado || CHAT_FIJADO; pintarChat(r.mensajes); }
      });
    });
    var grabando = null, recMT = null, chunksMT = [];
    $("c_mic").addEventListener("click", function(){
      if (grabando) { grabando.stop(); return; }
      if (!navigator.mediaDevices || !window.MediaRecorder) { chatFallo("Este aparato no deja grabar voz aquí: manda el mensaje escrito."); return; }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
        chunksMT = [];
        recMT = new MediaRecorder(stream);
        recMT.ondataavailable = function(e){ if (e.data && e.data.size) chunksMT.push(e.data); };
        recMT.onstop = function(){
          stream.getTracks().forEach(function(t){ t.stop(); });
          grabando = null; $("c_mic").textContent = "🎤 Nota de voz";
          var blob = new Blob(chunksMT, { type: recMT.mimeType || "audio/webm" });
          if (blob.size > MAX_ADJ_MT) { chatFallo("La nota pesa más de 5 MB: graba una más corta (máx 2 min)."); return; }
          var fr = new FileReader();
          fr.onload = function(){ CHAT_ADJ = { tipo: "voz", datos: String(fr.result), nombre: "Nota de voz", tam: blob.size }; $("c_adj_nom").textContent = "🎤 Nota de voz lista — toca «Enviar a Ernesto»."; };
          fr.readAsDataURL(blob);
        };
        recMT.start();
        grabando = recMT;
        $("c_mic").textContent = "⏹️ Detener";
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


"use strict";
var APP_VERSION = "1.1.0";
/* Tarifa de respaldo: se usa sin conexión si nunca se ha descargado datos.json.
   La tarifa viva viene de datos.json (la actualiza Ernesto/Máximo). */
var DEFAULT_TARIFA = { ingresoRef360: 1092.65, libroRef: 1110, salidaRef: 950,
  pctSaldo: 25, pctTransf: 20, pisoTransf: 25,
  bonoSaldoMeta: 150, bonoSaldoMonto: 300, bonoTransfMeta: 10, bonoTransfMonto: 300 };
var DATA = { tarifa: DEFAULT_TARIFA, actualizado: "", buscadores: {} };
var T = DEFAULT_TARIFA;

function $(id){ return document.getElementById(id); }
function num(id){ var v = parseFloat($(id).value); return isNaN(v) ? null : v; }
function fmt(n){ return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function fmtN(n){ return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

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
    warn.textContent = "⚠️ A ese precio no hay excedente: cobrarías $0.00. Negocia más bajo — mientras más bajo el precio, más cobras tú. 💪";
    return;
  }
  warn.style.display = "none"; res.style.display = "block";
  $("s_fee").textContent = fmt(r.fee);
  $("s_det").innerHTML = "Excedente por recarga: " + fmtN(r.exc) + " CUP · tu " + T.pctSaldo + "% = " + fmtN(r.fee / c) + " por recarga" +
    (c > 1 ? " · × " + c + " recargas" : "") + "<br>Entre más barato consigas, más ganas. 🔥";
}
function calcTransf(){
  var ef = num("t_ef"), pct = num("t_pct");
  var res = $("t_res"), warn = $("t_warn"), ok = $("t_ok");
  $("t_pct_lab").textContent = (pct === null ? "—" : pct);
  if (ef === null || ef <= 0 || pct === null){ res.style.display = "none"; warn.style.display = "none"; ok.style.display = "none"; return; }
  if (pct < T.pisoTransf){
    res.style.display = "none"; ok.style.display = "none"; warn.style.display = "block";
    warn.textContent = "🚫 Ese trato no se acepta: el mínimo es al " + T.pisoTransf + "%. Negocia más alto o no hay trato.";
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
  $("t_det").innerHTML = "La persona recibe " + fmtN(r.recibe) + " por transferencia · la vuelta gana " + fmtN(r.ganancia) + " CUP · tu " + T.pctTransf + "% = tu comisión.<br>Se paga cuando la vuelta cierra. ✅";
}

/* ===== Panel ===== */
function renderPanel(){
  var code = ($("p_code").value || "").trim().toUpperCase();
  var warn = $("p_warn"), body = $("p_body");
  var b = DATA.buscadores ? DATA.buscadores[code] : null;
  if (!code){ warn.style.display = "block"; warn.textContent = "Escribe tu código primero."; body.classList.add("hide"); return; }
  if (!b){ warn.style.display = "block"; warn.textContent = "Ese código no aparece. Revísalo con Ernesto."; body.classList.add("hide"); return; }
  warn.style.display = "none"; body.classList.remove("hide");
  try { localStorage.setItem("busc_codigo", code); } catch(e){}
  var total = 0, recSaldo = 0, nTransf = 0, html = "";
  (b.tratos || []).forEach(function(tr){
    total += tr.comision || 0;
    if (tr.tipo === "saldo") recSaldo += tr.recargas || 0;
    if (tr.tipo === "transferencia") nTransf += 1;
    html += '<div class="trato"><span class="f">' + tr.fecha + "</span><span>" +
      (tr.tipo === "saldo" ? "📱 " : "🏦 ") + (tr.nota || "") + '</span><span class="c">' + fmt(tr.comision || 0) + "</span></div>";
  });
  if (!html) html = '<div class="trato"><span>Aún no tienes tratos confirmados. ¡A buscar! 🔎</span></div>';
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
  return "📋 <b>Tarifa de referencia</b>" + (DATA.actualizado ? " (" + DATA.actualizado + ")" : "") +
    " · Saldo: cobras el <b>" + T.pctSaldo + "%</b> del excedente · Transferencia: el <b>" + T.pctTransf + "%</b> de la ganancia, mínimo al <b>" + T.pisoTransf + "%</b>" +
    " · Bonos: <b>" + fmt(T.bonoSaldoMonto) + "</b> con " + T.bonoSaldoMeta + " recargas/semana · <b>" + fmt(T.bonoTransfMonto) + "</b> con " + T.bonoTransfMeta + " tratos/semana";
}

function applyData(d){
  if (d && d.tarifa) { DATA = d; T = d.tarifa; }
  checkUpdate();
  $("tarifaBox").innerHTML = tarifaText();
  calcSaldo(); calcTransf();
  if (!$("p_body").classList.contains("hide")) renderPanel();
}
function loadData(){
  try {
    var cached = localStorage.getItem("busc_datos");
    if (cached) applyData(JSON.parse(cached));
    else $("tarifaBox").innerHTML = tarifaText();
  } catch(e){ $("tarifaBox").innerHTML = tarifaText(); }
  if (window.fetch) {
    fetch("datos.json", { cache: "no-store" }).then(function(r){ return r.json(); }).then(function(d){
      try { localStorage.setItem("busc_datos", JSON.stringify(d)); } catch(e){}
      applyData(d);
    }).catch(function(){ /* sin internet: se trabaja con lo guardado */ });
    fetch("https://raw.githubusercontent.com/ernesto5058/calculadora-ernesto/main/buscadores/datos.json", { cache: "no-store" })
      .then(function(r){ return r.ok ? r.json() : null; }).then(function(d){
        if (d) { try { localStorage.setItem("busc_datos", JSON.stringify(d)); } catch(e){} applyData(d); }
      }).catch(function(){});
  }
  calcSaldo(); calcTransf();
}

/* ===== Reportar (Supabase) ===== */
var SB_URL = "https://otsudfgwpapkluusrlnj.supabase.co/rest/v1/reportes";
var SB_KEY = "sb_publishable_Uchl5QnojJkZbXR5ar8vDg_5CXnqi_d";
var REP_TIPO = "saldo";

function outboxGet(){ try { return JSON.parse(localStorage.getItem("busc_outbox") || "[]"); } catch(e){ return []; } }
function outboxSet(a){ try { localStorage.setItem("busc_outbox", JSON.stringify(a)); } catch(e){} }
function repResumen(rp){
  if (rp.tipo === "saldo") return "📱 Saldo · " + fmtN(rp.precio) + " CUP × " + rp.cantidad + " recarga(s)";
  return "🏦 Transf. · " + fmtN(rp.cantidad) + " CUP al " + rp.porc + "%";
}
function renderOutbox(){
  var a = outboxGet(), box = $("r_lista"), h = "";
  a.slice().reverse().forEach(function(rp){
    var st = rp.estado === "aprobado" ? '<span class="st okk">✅ Aprobado +' + fmt(rp.comision || 0) + "</span>"
      : rp.estado === "rechazado" ? '<span class="st no">❌ Rechazado' + (rp.motivo ? ": " + rp.motivo : "") + "</span>"
      : '<span class="st pend">🟡 Pendiente' + (rp.enviado ? "" : " (guardado, sin enviar)") + "</span>";
    h += '<div class="rep"><span>' + repResumen(rp) + "<br><small>" + rp.fecha + "</small></span>" + st + "</div>";
  });
  box.innerHTML = h || '<div class="rep"><span>Todavía no has reportado nada.</span></div>';
}
function enviarReporte(rp){
  if (!window.fetch) return Promise.resolve(false);
  return fetch(SB_URL.replace("/reportes", "/rpc/registrar_reporte"), { method: "POST",
    headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json" },
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
    fetch(SB_URL.replace("/reportes", "/rpc/estado_reportes"), { method: "POST",
        headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json" },
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
  var code = ($("r_cod").value || "").trim().toUpperCase();
  if (!code) { try { code = (localStorage.getItem("busc_codigo") || "").trim().toUpperCase(); } catch(e){} }
  if (!code) code = ($("p_code").value || "").trim().toUpperCase();
  if (code) { try { localStorage.setItem("busc_codigo", code); } catch(e){} }
  function fallo(msg){ warn.style.display = "block"; warn.textContent = msg; }
  if (!code) return fallo("⚠️ Escribe tu código personal arriba — sin código el reporte no lleva tu nombre y Ernesto no sabe de quién es.");
  var tel = ($("r_tel").value || "").trim();
  var nota = ($("r_nota").value || "").trim();
  var rp = { buscador: code, tipo: REP_TIPO, precio: null, porc: null, cantidad: null,
    telefono: tel, nota: nota, estado: "pendiente", enviado: false, id: null,
    fecha: new Date().toLocaleDateString("es-ES") };
  if (REP_TIPO === "saldo") {
    var pr = num("r_precio"), ct = num("r_cant") || 1;
    if (pr === null || pr <= 0) return fallo("⚠️ Escribe el precio que pide el vendedor por cada recarga de 360.");
    rp.precio = pr; rp.cantidad = ct;
  } else {
    var ef = num("r_ef"), pc = num("r_pct");
    if (ef === null || ef <= 0) return fallo("⚠️ Escribe el efectivo que entrega la persona.");
    if (pc === null) return fallo("⚠️ Escribe al cuánto es el trato (%).");
    if (pc < T.pisoTransf) return fallo("🚫 Ese trato no se acepta: el mínimo es al " + T.pisoTransf + "%. Negocia más alto.");
    rp.porc = pc; rp.cantidad = ef;
  }
  if (!tel) return fallo("⚠️ Escribe el teléfono del vendedor — Ernesto lo necesita para confirmar el trato.");
  var a = outboxGet(); a.push(rp); outboxSet(a); renderOutbox();
  enviarReporte(rp).then(function(ok){
    if (ok) outboxSet(a); // rp ya trae id y enviado=true (misma referencia dentro de a)
    renderOutbox();
    if (ok) { res.style.display = "block"; }
    else if (rp.error === "noautorizado") fallo("🚫 Tu código no está autorizado en el sistema de Ernesto. Si eres del equipo, revísalo con él: puede estar mal escrito o desactivado.");
    else fallo("📴 No se pudo enviar ahora: el reporte quedó guardado en tu teléfono y se reintenta solo cuando abras la app con conexión.");
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

/* ===== Ayuda / reportes de problemas (Supabase, tabla ayudas) ===== */
var SB_RPC = SB_URL.replace("/reportes", "/rpc/");
function ayudaGet(){ try { return JSON.parse(localStorage.getItem("busc_ayuda") || "[]"); } catch(e){ return []; } }
function ayudaSet(a){ try { localStorage.setItem("busc_ayuda", JSON.stringify(a)); } catch(e){} }
function renderAyuda(){
  var a = ayudaGet(), box = $("a_lista"), h = "";
  a.slice().reverse().forEach(function(it){
    var st = it.estado === "visto" ? '<span class="st okk">✅ Ernesto ya lo vio</span>'
      : '<span class="st pend">🟡 Enviado · por leer</span>';
    if (!it.enviado) st = '<span class="st pend">🟡 Guardado · sin enviar</span>';
    h += '<div class="rep"><span>' + String(it.mensaje || "").slice(0, 90) + "<br><small>" + it.fecha + "</small></span>" + st + "</div>";
  });
  box.innerHTML = h || '<div class="rep"><span>Todavía no has enviado ningún reporte de ayuda.</span></div>';
}
function enviarAyuda(it){
  if (!window.fetch) return Promise.resolve(false);
  return fetch(SB_RPC + "registrar_ayuda", { method: "POST",
    headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_buscador: it.buscador, p_mensaje: it.mensaje })
  }).then(function(r){
      if (r.ok) return r.json();
      return r.json().catch(function(){ return {}; }).then(function(e){
        if (e && e.message && e.message.indexOf("no autorizado") !== -1) it.error = "noautorizado";
        return Promise.reject(new Error("HTTP " + r.status));
      });
    })
    .then(function(id){ if (id) { it.id = id; it.enviado = true; } return !!it.id; })
    .catch(function(){ return false; });
}
function syncAyuda(){
  var a = ayudaGet(); if (!a.length) { renderAyuda(); return; }
  var chain = Promise.resolve(), changed = false;
  a.filter(function(it){ return !it.enviado; }).forEach(function(it){
    chain = chain.then(function(){ return enviarAyuda(it).then(function(ok){ if (ok) changed = true; }); });
  });
  chain.then(function(){
    if (changed) ayudaSet(a);
    var ids = a.filter(function(it){ return it.enviado && it.id && it.estado === "pendiente"; }).map(function(it){ return it.id; });
    if (!ids.length || !window.fetch) { renderAyuda(); return; }
    fetch(SB_RPC + "estado_ayudas", { method: "POST",
        headers: { "apikey": SB_KEY, "Authorization": "Bearer " + SB_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ p_ids: ids }) })
      .then(function(r){ return r.ok ? r.json() : []; }).then(function(rows){
        var map = {}; (rows || []).forEach(function(x){ map[x.id] = x; });
        a.forEach(function(it){ var s2 = map[it.id]; if (s2 && s2.estado) it.estado = s2.estado; });
        ayudaSet(a); renderAyuda();
      }).catch(function(){ renderAyuda(); });
  });
}
function reportarAyuda(){
  var warn = $("a_warn"), res = $("a_res");
  warn.style.display = "none"; res.style.display = "none";
  var code = ($("a_cod").value || "").trim().toUpperCase();
  if (!code) { try { code = (localStorage.getItem("busc_codigo") || "").trim().toUpperCase(); } catch(e){} }
  if (code) { try { localStorage.setItem("busc_codigo", code); } catch(e){} }
  function fallo(m){ warn.style.display = "block"; warn.textContent = m; }
  if (!code) return fallo("⚠️ Escribe tu código personal — Ernesto solo atiende reportes de su equipo autorizado.");
  var msg = ($("a_msg").value || "").trim();
  if (msg.length < 5) return fallo("⚠️ Cuéntale a Ernesto qué pasa, con un poco de detalle (qué tocaste y qué pasó).");
  var it = { buscador: code, mensaje: msg, estado: "pendiente", enviado: false, id: null,
    fecha: new Date().toLocaleDateString("es-ES") };
  var a = ayudaGet(); a.push(it); ayudaSet(a); renderAyuda();
  enviarAyuda(it).then(function(ok){
    if (ok) ayudaSet(a);
    renderAyuda();
    if (ok) { res.style.display = "block"; $("a_msg").value = ""; }
    else if (it.error === "noautorizado") fallo("🚫 Tu código no está autorizado en el sistema de Ernesto. Si eres del equipo, revísalo con él.");
    else fallo("📴 No se pudo enviar ahora: quedó guardado en tu teléfono y se reintenta solo cuando abras la app con conexión.");
  });
}
$("a_btn").addEventListener("click", reportarAyuda);

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
  if (v === "Ayuda") renderAyuda();
}
$("tabCalc").addEventListener("click", function(){ showView("Calc"); });
$("tabRep").addEventListener("click", function(){ showView("Rep"); });
$("tabPanel").addEventListener("click", function(){ showView("Panel"); });
$("tabAyuda").addEventListener("click", function(){ showView("Ayuda"); });
$("r_tipo_s").addEventListener("click", function(){ REP_TIPO = "saldo"; $("r_tipo_s").classList.add("on"); $("r_tipo_t").classList.remove("on"); $("r_box_s").classList.remove("hide"); $("r_box_t").classList.add("hide"); });
$("r_tipo_t").addEventListener("click", function(){ REP_TIPO = "transferencia"; $("r_tipo_t").classList.add("on"); $("r_tipo_s").classList.remove("on"); $("r_box_t").classList.remove("hide"); $("r_box_s").classList.add("hide"); });
$("r_btn").addEventListener("click", reportar);
$("p_btn").addEventListener("click", renderPanel);
try { var saved = localStorage.getItem("busc_codigo"); if (saved) { $("p_code").value = saved; $("r_cod").value = saved; $("a_cod").value = saved; } } catch(e){}
try { $("verLab").textContent = APP_VERSION; } catch(e){}
$("r_cod").addEventListener("change", function(){
  var c = ($("r_cod").value || "").trim().toUpperCase();
  if (c) { try { localStorage.setItem("busc_codigo", c); } catch(e){} $("p_code").value = c; }
});

if ("serviceWorker" in navigator && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) {
  window.addEventListener("load", function(){ navigator.serviceWorker.register("sw.js").catch(function(){}); });
}
loadData();
renderOutbox();
syncReportes();
renderAyuda();
syncAyuda();

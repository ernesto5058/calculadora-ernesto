// version: 7
// Calculadora Ernesto PRO — Scriptable
// Pantalla completa interactiva: calcula EN VIVO mientras escribes,
// con semáforo de decisión, chips rápidos, deslizador y botón de copiar.
// Como widget: muestra tus últimos resultados con el semáforo.

const FM = FileManager.local();
const PATH = FM.joinPath(FM.documentsDirectory(), "calc-ernesto.json");

function loadData() {
  try {
    if (FM.fileExists(PATH)) return JSON.parse(FM.readString(PATH));
  } catch (e) {}
  return {
    saldo:  { salida: 950, costo: 1040, tasa: 320, saldo: 3600 },
    transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 },
    busc:   { precio: 950, tasaVenta: 313, efectivo: 5000, porc: 30, libro: 1110, salida: 950 }
  };
}
function saveData(d) { FM.writeString(PATH, JSON.stringify(d)); }
function fmt(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return (Math.round(n * 100) / 100).toFixed(2);
}
function calcSaldo(s) {
  return {
    eq: 360 * s.salida / s.costo,
    g360: (360 / s.tasa) * s.salida - s.costo,
    total: ((360 / s.tasa) * s.salida - s.costo) * (s.saldo / 360) - 14.44
  };
}
function calcTransf(t) {
  const transferencia = t.efectivo * (1 + t.porc / 100);
  const qusd = transferencia / t.libro;
  const regreso = qusd * t.salida;
  return {
    transferencia: transferencia,
    qusd: qusd,
    regreso: regreso,
    ganancia: regreso - t.efectivo,
    eqp: (t.libro / t.salida - 1) * 100,
    margen: ((1 + t.porc / 100) * t.salida / t.libro - 1) * 100
  };
}

function calcBuscSaldo(b) {
  const ingreso = (360 / b.tasaVenta) * b.salida;
  const excedente = ingreso - b.precio;
  const comision = excedente > 0 ? 0.25 * excedente : 0;
  return { ingreso: ingreso, excedente: excedente, comision: comision, neto: excedente - comision };
}
function calcBuscTransf(b) {
  const ganancia = (b.efectivo * (1 + b.porc / 100) / b.libro) * b.salida - b.efectivo;
  const comision = ganancia > 0 ? 0.20 * ganancia : 0;
  return { ganancia: ganancia, comision: comision, neto: ganancia - comision, eqp: (b.libro / b.salida - 1) * 100 };
}

// ---------- WIDGET ----------
function buildWidget(d) {
  const w = new ListWidget();
  w.url = "scriptable:///run/" + encodeURIComponent(Script.name());
  w.backgroundColor = new Color("#0B0E13");
  const title = w.addText("📌 CALCULADORA ERNESTO");
  title.font = Font.boldSystemFont(15);
  title.textColor = new Color("#F5BC14");
  w.addSpacer(8);
  const s = calcSaldo(d.saldo);
  const okS = d.saldo.tasa <= s.eq;
  const h1 = w.addText("📱 SALDO " + (okS ? "🟢" : "🔴"));
  h1.font = Font.boldSystemFont(14);
  h1.textColor = new Color("#2ECCAC");
  const l1 = w.addText("⚖️ Eq: " + fmt(s.eq) + "  💰 G/360: " + fmt(s.g360));
  l1.font = Font.systemFont(13); l1.textColor = Color.white();
  const l2 = w.addText("🧮 Total: " + fmt(s.total) + " CUP");
  l2.font = Font.systemFont(13); l2.textColor = Color.white();
  w.addSpacer(8);
  const t = calcTransf(d.transf);
  const okT = d.transf.porc > t.eqp;
  const h2 = w.addText("🏦 TRANSFERENCIA " + (okT ? "🟢" : "🔴"));
  h2.font = Font.boldSystemFont(14);
  h2.textColor = new Color("#2ECCAC");
  const l3 = w.addText("🎯 Eq: al " + fmt(t.eqp) + "%  📈 Margen: " + fmt(t.margen) + "%");
  l3.font = Font.systemFont(13); l3.textColor = Color.white();
  const l4 = w.addText("↩️ Regreso: " + fmt(t.regreso) + " CUP");
  l4.font = Font.systemFont(13); l4.textColor = Color.white();
  w.addSpacer(6);
  const tip = w.addText("Toca para abrir la calculadora");
  tip.font = Font.systemFont(11); tip.textColor = new Color("#9EAFC4");
  return w;
}

// ---------- PANTALLA PRO (HTML) ----------
function buildHTML(d) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="theme-color" content="#0B0E13">
<meta name="color-scheme" content="dark">
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { height:100%; background:#0B0E13; overscroll-behavior:none; }
  body { margin:0; font-family:-apple-system,Helvetica,Arial,sans-serif; color:#EEF0F5; position:fixed; inset:0; overflow:hidden; }
  #app { height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:18px 16px 30px; background:#0B0E13; }
  .head { text-align:center; margin-bottom:14px; }
  .head .t { font-size:26px; font-weight:800; color:#F5BC14; letter-spacing:.5px; }
  .head .s { font-size:13px; color:#9EAFC4; margin-top:2px; }
  .tabs { display:flex; gap:10px; margin:16px 0; }
  .tab { flex:1; text-align:center; padding:13px 0; border-radius:14px; background:#131A24; border:1px solid #263248; font-size:17px; font-weight:700; color:#9EAFC4; transition:all .18s; }
  .tab.on { background:linear-gradient(135deg,#0E3B33,#12473D); color:#2ECCAC; border-color:#2ECCAC; transform:scale(1.02); }
  .panel { display:none; }
  .panel.on { display:block; animation:fade .22s ease; }
  @keyframes fade { from { opacity:0; transform:translateY(6px);} to { opacity:1; transform:none;} }
  .card { background:#111824; border:1px solid #263248; border-radius:18px; padding:16px; margin-bottom:14px; }
  .field { margin-bottom:14px; }
  .field:last-child { margin-bottom:2px; }
  label { display:block; font-size:14px; color:#9EAFC4; margin-bottom:6px; font-weight:600; }
  .row { display:flex; align-items:center; gap:8px; }
  .step { width:44px; height:48px; border-radius:12px; border:1px solid #263248; background:#1A2434; color:#2ECCAC; font-size:24px; font-weight:800; }
  .step:active { background:#2ECCAC; color:#0B0E13; }
  input[type=number] { flex:1; min-width:0; height:48px; border-radius:12px; border:1px solid #263248; background:#0D1420; color:#fff; font-size:21px; font-weight:700; text-align:center; padding:0 8px; }
  input[type=number]:focus { border-color:#2ECCAC; outline:none; }
  .chips { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; }
  .chip { padding:6px 13px; border-radius:999px; background:#1A2434; border:1px solid #263248; color:#C9D4E3; font-size:14px; font-weight:700; }
  .chip:active { background:#2ECCAC; color:#0B0E13; }
  input[type=range] { width:100%; margin-top:10px; accent-color:#2ECCAC; height:30px; }
  .res { text-align:center; }
  .big { font-size:42px; font-weight:900; line-height:1.1; }
  .big small { font-size:16px; color:#9EAFC4; font-weight:700; }
  .grid { display:flex; gap:10px; margin-top:12px; }
  .cell { flex:1; background:#0D1420; border:1px solid #263248; border-radius:14px; padding:10px 4px; }
  .cell .v { font-size:19px; font-weight:800; }
  .cell .k { font-size:11.5px; color:#9EAFC4; margin-top:2px; font-weight:600; }
  .sema { margin-top:14px; border-radius:14px; padding:13px 10px; font-size:16.5px; font-weight:800; text-align:center; transition:all .2s; }
  .sema.ok { background:rgba(46,204,113,.16); color:#2ECC71; border:1px solid #2ECC71; }
  .sema.bad { background:rgba(255,92,92,.13); color:#FF5C5C; border:1px solid #FF5C5C; }
  .btns { display:flex; gap:10px; margin-top:4px; }
  .btn { flex:1; padding:15px 0; border-radius:14px; border:1px solid #263248; background:#1A2434; color:#fff; font-size:16px; font-weight:800; text-align:center; }
  .btn:active { transform:scale(.97); }
  .btn.copy { color:#2ECCAC; }
  .foot { text-align:center; color:#5B6B82; font-size:12px; margin-top:16px; }
</style>
</head>
<body>
<div id="app">
  <div class="head">
    <div class="t">📌 CALCULADORA ERNESTO</div>
    <div class="s">Calcula en vivo mientras escribes ⚡</div>
  </div>

  <div class="tabs">
    <div class="tab on" id="tabS" onclick="showTab('s')">📱 Saldo</div>
    <div class="tab" id="tabT" onclick="showTab('t')">🏦 Transf.</div>
    <div class="tab" id="tabB" onclick="showTab('b')">🤝 Buscad.</div>
  </div>

  <!-- SALDO -->
  <div class="panel on" id="panelS">
    <div class="card">
      <div class="field"><label>💵 Salida con Miguel</label>
        <div class="row"><button class="step" onclick="step('s_salida',-5)">−</button><input type="number" id="s_salida" inputmode="decimal"><button class="step" onclick="step('s_salida',5)">+</button></div>
        <div class="chips"><span class="chip" onclick="setV('s_salida',930)">930</span><span class="chip" onclick="setV('s_salida',950)">950</span><span class="chip" onclick="setV('s_salida',960)">960</span></div>
      </div>
      <div class="field"><label>🏷️ Costo por 360</label>
        <div class="row"><button class="step" onclick="step('s_costo',-10)">−</button><input type="number" id="s_costo" inputmode="decimal"><button class="step" onclick="step('s_costo',10)">+</button></div>
        <div class="chips"><span class="chip" onclick="setV('s_costo',1000)">1,000</span><span class="chip" onclick="setV('s_costo',1040)">1,040</span><span class="chip" onclick="setV('s_costo',1114)">1,114</span></div>
      </div>
      <div class="field"><label>📊 Tasa de venta</label>
        <div class="row"><button class="step" onclick="step('s_tasa',-1)">−</button><input type="number" id="s_tasa" inputmode="decimal"><button class="step" onclick="step('s_tasa',1)">+</button></div>
      </div>
      <div class="field"><label>📱 Saldo a vender</label>
        <div class="row"><button class="step" onclick="step('s_saldo',-360)">−</button><input type="number" id="s_saldo" inputmode="decimal"><button class="step" onclick="step('s_saldo',360)">+</button></div>
        <div class="chips"><span class="chip" onclick="setV('s_saldo',3600)">3,600</span><span class="chip" onclick="setV('s_saldo',10000)">10,000</span><span class="chip" onclick="setV('s_saldo',22900)">22,900</span></div>
      </div>
    </div>
    <div class="card res">
      <div class="big"><span id="r_total">—</span> <small>CUP de ganancia</small></div>
      <div class="grid">
        <div class="cell"><div class="v" id="r_eq">—</div><div class="k">⚖️ EQUILIBRIO (TECHO)</div></div>
        <div class="cell"><div class="v" id="r_g360">—</div><div class="k">💰 GANANCIA / 360</div></div>
      </div>
      <div class="sema ok" id="r_semaS">—</div>
    </div>
  </div>

  <!-- TRANSFERENCIA -->
  <div class="panel" id="panelT">
    <div class="card">
      <div class="field"><label>💵 Efectivo a mover (CUP)</label>
        <div class="row"><button class="step" onclick="step('t_efectivo',-500)">−</button><input type="number" id="t_efectivo" inputmode="decimal"><button class="step" onclick="step('t_efectivo',500)">+</button></div>
      </div>
      <div class="field"><label>％ Prima de la transferencia: <span id="t_porc_lbl" style="color:#2ECCAC">30%</span></label>
        <div class="row"><button class="step" onclick="step('t_porc',-1)">−</button><input type="number" id="t_porc" inputmode="decimal"><button class="step" onclick="step('t_porc',1)">+</button></div>
        <input type="range" id="t_slider" min="0" max="50" step="1" value="30">
        <div class="chips"><span class="chip" onclick="setV('t_porc',25)">25%</span><span class="chip" onclick="setV('t_porc',30)">30%</span><span class="chip" onclick="setV('t_porc',35)">35%</span><span class="chip" onclick="setV('t_porc',40)">40%</span></div>
      </div>
      <div class="field"><label>📖 Libro BANK_CUP</label>
        <div class="row"><button class="step" onclick="step('t_libro',-10)">−</button><input type="number" id="t_libro" inputmode="decimal"><button class="step" onclick="step('t_libro',10)">+</button></div>
        <div class="chips"><span class="chip" onclick="setV('t_libro',1130)">1,130</span><span class="chip" onclick="setV('t_libro',1100)">1,100</span><span class="chip" onclick="setV('t_libro',1150)">1,150</span></div>
      </div>
      <div class="field"><label>💵 Salida con Miguel</label>
        <div class="row"><button class="step" onclick="step('t_salida',-5)">−</button><input type="number" id="t_salida" inputmode="decimal"><button class="step" onclick="step('t_salida',5)">+</button></div>
      </div>
    </div>
    <div class="card res">
      <div class="big"><span id="r_gan">—</span> <small>CUP de ganancia</small></div>
      <div class="grid">
        <div class="cell"><div class="v" id="r_recibes">—</div><div class="k">🔄 RECIBES (TRANSF.)</div></div>
        <div class="cell"><div class="v" id="r_qusd">—</div><div class="k">🪙 QUSD</div></div>
      </div>
      <div class="grid">
        <div class="cell"><div class="v" id="r_regreso">—</div><div class="k">↩️ REGRESO (CUP)</div></div>
        <div class="cell"><div class="v" id="r_margen">—</div><div class="k">📈 MARGEN</div></div>
      </div>
      <div class="sema ok" id="r_semaT">—</div>
    </div>
  </div>

  <!-- BUSCADORES -->
  <div class="panel" id="panelB">
    <div class="card">
      <div style="font-weight:800;color:#F5BC14;font-size:16px;margin-bottom:10px;">📱 Buscador de SALDO</div>
      <div class="field"><label>🏷️ Precio pagado al vendedor (por 360)</label>
        <div class="row"><button class="step" onclick="step('b_precio',-10)">−</button><input type="number" id="b_precio" inputmode="decimal"><button class="step" onclick="step('b_precio',10)">+</button></div>
        <div class="chips"><span class="chip" onclick="setV('b_precio',900)">900</span><span class="chip" onclick="setV('b_precio',950)">950</span><span class="chip" onclick="setV('b_precio',1000)">1,000</span></div>
      </div>
      <div class="field"><label>📊 Tasa de venta de hoy</label>
        <div class="row"><button class="step" onclick="step('b_tasa',-1)">−</button><input type="number" id="b_tasa" inputmode="decimal"><button class="step" onclick="step('b_tasa',1)">+</button></div>
      </div>
      <div class="field"><label>💵 Salida con Miguel</label>
        <div class="row"><button class="step" onclick="step('b_salida',-5)">−</button><input type="number" id="b_salida" inputmode="decimal"><button class="step" onclick="step('b_salida',5)">+</button></div>
      </div>
      <div class="grid">
        <div class="cell"><div class="v" id="rb_com">—</div><div class="k">🤝 COBRA ÉL (25%)</div></div>
        <div class="cell"><div class="v" id="rb_neto">—</div><div class="k">💰 TE QUEDA A TI</div></div>
      </div>
      <div class="sema ok" id="r_semaB1">—</div>
      <div style="font-size:12.5px;color:#9EAFC4;margin-top:10px;text-align:center;">🎁 Bono: 150+ recargas en la semana → +300 CUP</div>
    </div>
    <div class="card">
      <div style="font-weight:800;color:#F5BC14;font-size:16px;margin-bottom:10px;">🏦 Buscador de TRANSFERENCIA</div>
      <div class="field"><label>💵 Efectivo del trato (CUP)</label>
        <div class="row"><button class="step" onclick="step('b2_efectivo',-500)">−</button><input type="number" id="b2_efectivo" inputmode="decimal"><button class="step" onclick="step('b2_efectivo',500)">+</button></div>
      </div>
      <div class="field"><label>％ Prima pactada: <span id="b2_porc_lbl" style="color:#2ECCAC">30%</span></label>
        <div class="row"><button class="step" onclick="step('b2_porc',-1)">−</button><input type="number" id="b2_porc" inputmode="decimal"><button class="step" onclick="step('b2_porc',1)">+</button></div>
        <input type="range" id="b2_slider" min="0" max="50" step="1" value="30">
        <div class="chips"><span class="chip" onclick="setV('b2_porc',25)">25%</span><span class="chip" onclick="setV('b2_porc',30)">30%</span><span class="chip" onclick="setV('b2_porc',35)">35%</span><span class="chip" onclick="setV('b2_porc',40)">40%</span></div>
      </div>
      <div class="field"><label>📖 Libro BANK_CUP</label>
        <div class="row"><button class="step" onclick="step('b2_libro',-10)">−</button><input type="number" id="b2_libro" inputmode="decimal"><button class="step" onclick="step('b2_libro',10)">+</button></div>
      </div>
      <div class="field"><label>💵 Salida con Miguel</label>
        <div class="row"><button class="step" onclick="step('b2_salida',-5)">−</button><input type="number" id="b2_salida" inputmode="decimal"><button class="step" onclick="step('b2_salida',5)">+</button></div>
      </div>
      <div class="grid">
        <div class="cell"><div class="v" id="rb2_com">—</div><div class="k">🤝 COBRA ÉL (20%)</div></div>
        <div class="cell"><div class="v" id="rb2_neto">—</div><div class="k">💰 TE QUEDA A TI</div></div>
      </div>
      <div class="sema ok" id="r_semaB2">—</div>
      <div style="font-size:12.5px;color:#9EAFC4;margin-top:10px;text-align:center;">🎁 Bono: 10+ tratos cerrados en la semana → +300 CUP · Solo gente conocida 🔒</div>
    </div>
  </div>

  <div class="btns">
    <div class="btn copy" onclick="copiar()">📋 Copiar resultado</div>
    <div class="btn" onclick="salir()">❌ Salir</div>
  </div>
  <div class="foot">Tus datos se guardan solos en tu iPhone 💾 · Hecha por Máximo</div>
</div>

<script>
const SAVED = ${JSON.stringify(d)};
let cur = "s";
function gv(id){ const v = parseFloat((document.getElementById(id).value || "").toString().replace(",", ".")); return isNaN(v) ? 0 : v; }
function sv(id, v){ document.getElementById(id).value = v; }
function fmt(n){ return (Math.round(n * 100) / 100).toFixed(2); }
function setV(id, v){ sv(id, v); render(); }
function step(id, dlt){ sv(id, Math.max(0, gv(id) + dlt)); render(); }
function showTab(t){
  cur = t;
  document.getElementById("tabS").className = "tab" + (t === "s" ? " on" : "");
  document.getElementById("tabT").className = "tab" + (t === "t" ? " on" : "");
  document.getElementById("tabB").className = "tab" + (t === "b" ? " on" : "");
  document.getElementById("panelS").className = "panel" + (t === "s" ? " on" : "");
  document.getElementById("panelT").className = "panel" + (t === "t" ? " on" : "");
  document.getElementById("panelB").className = "panel" + (t === "b" ? " on" : "");
}
function collect(){
  return {
    saldo:  { salida: gv("s_salida"), costo: gv("s_costo"), tasa: gv("s_tasa"), saldo: gv("s_saldo") },
    transf: { efectivo: gv("t_efectivo"), porc: gv("t_porc"), libro: gv("t_libro"), salida: gv("t_salida") },
    busc:   { precio: gv("b_precio"), tasaVenta: gv("b_tasa"), efectivo: gv("b2_efectivo"), porc: gv("b2_porc"), libro: gv("b2_libro"), salida: gv("b2_salida") }
  };
}
let saveTimer = null;
function autosave(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function(){
    window.location.href = "ernesto://save?d=" + encodeURIComponent(JSON.stringify(collect()));
  }, 500);
}
let lastText = "";
function render(){
  const d = collect();
  // SALDO
  const eq = 360 * d.saldo.salida / d.saldo.costo;
  const g360 = (360 / d.saldo.tasa) * d.saldo.salida - d.saldo.costo;
  const total = g360 * (d.saldo.saldo / 360) - 14.44;
  document.getElementById("r_eq").textContent = fmt(eq);
  document.getElementById("r_g360").textContent = fmt(g360);
  document.getElementById("r_total").textContent = fmt(total);
  const semaS = document.getElementById("r_semaS");
  if (d.saldo.tasa <= eq) { semaS.className = "sema ok"; semaS.textContent = "🟢 VENDE — ganas " + fmt(g360) + " por cada 360"; }
  else { semaS.className = "sema bad"; semaS.textContent = "🔴 NO VENDAS a " + fmt(d.saldo.tasa) + " — tu techo es " + fmt(eq); }
  // TRANSFERENCIA
  const tr = d.transf.efectivo * (1 + d.transf.porc / 100);
  const qusd = tr / d.transf.libro;
  const regreso = qusd * d.transf.salida;
  const gan = regreso - d.transf.efectivo;
  const eqp = (d.transf.libro / d.transf.salida - 1) * 100;
  const margen = ((1 + d.transf.porc / 100) * d.transf.salida / d.transf.libro - 1) * 100;
  document.getElementById("r_recibes").textContent = fmt(tr);
  document.getElementById("r_qusd").textContent = fmt(qusd);
  document.getElementById("r_regreso").textContent = fmt(regreso);
  document.getElementById("r_gan").textContent = fmt(gan);
  document.getElementById("r_margen").textContent = fmt(margen) + "%";
  document.getElementById("t_porc_lbl").textContent = fmt(d.transf.porc) + "%";
  document.getElementById("t_slider").value = d.transf.porc;
  const semaT = document.getElementById("r_semaT");
  if (d.transf.porc > eqp) { semaT.className = "sema ok"; semaT.textContent = "🟢 DALE — estás sobre el equilibrio (al " + fmt(eqp) + "%)"; }
  else { semaT.className = "sema bad"; semaT.textContent = "🔴 NO ALCANZA — el equilibrio es al " + fmt(eqp) + "%"; }
  // BUSCADORES — SALDO
  const bIng = (360 / d.busc.tasaVenta) * d.busc.salida;
  const bExc = bIng - d.busc.precio;
  const bCom = bExc > 0 ? 0.25 * bExc : 0;
  document.getElementById("rb_com").textContent = fmt(bCom);
  document.getElementById("rb_neto").textContent = fmt(bExc - bCom);
  const semaB1 = document.getElementById("r_semaB1");
  if (bExc > 0) { semaB1.className = "sema ok"; semaB1.textContent = "🟢 HAY EXCEDENTE — él cobra el 25%, tú te quedas el 75%"; }
  else { semaB1.className = "sema bad"; semaB1.textContent = "🔴 SIN EXCEDENTE — a ese precio NO se compra"; }
  // BUSCADORES — TRANSFERENCIA
  const b2Gan = (d.busc.efectivo * (1 + d.busc.porc / 100) / d.busc.libro) * d.busc.salida - d.busc.efectivo;
  const b2Com = b2Gan > 0 ? 0.20 * b2Gan : 0;
  const b2Eqp = (d.busc.libro / d.busc.salida - 1) * 100;
  document.getElementById("rb2_com").textContent = fmt(b2Com);
  document.getElementById("rb2_neto").textContent = fmt(b2Gan - b2Com);
  document.getElementById("b2_porc_lbl").textContent = fmt(d.busc.porc) + "%";
  document.getElementById("b2_slider").value = d.busc.porc;
  const semaB2 = document.getElementById("r_semaB2");
  if (d.busc.porc >= 25 && b2Gan > 0) { semaB2.className = "sema ok"; semaB2.textContent = "🟢 TRATO BUENO — él cobra al cerrar la vuelta"; }
  else if (d.busc.porc > b2Eqp) { semaB2.className = "sema bad"; semaB2.textContent = "🔴 MUY FLOJO — el piso es al 25% (equilibrio al " + fmt(b2Eqp) + "%)"; }
  else { semaB2.className = "sema bad"; semaB2.textContent = "🔴 NO CIERRA — el equilibrio es al " + fmt(b2Eqp) + "%"; }
  const textB = "🤝 BUSCADORES\n📱 Saldo: precio " + fmt(d.busc.precio) + " → él " + fmt(bCom) + " · tú " + fmt(bExc - bCom) + "\n🏦 Transf.: " + fmt(d.busc.efectivo) + " al " + fmt(d.busc.porc) + "% → él " + fmt(b2Com) + " · tú " + fmt(b2Gan - b2Com);
  lastText = cur === "b" ? textB : (cur === "s"
    ? "📱 SALDO\\n⚖️ Equilibrio: " + fmt(eq) + "\\n💰 Ganancia/360: " + fmt(g360) + " CUP\\n🧮 Ganancia total: " + fmt(total) + " CUP"
    : "🏦 TRANSFERENCIA\\n🔄 Recibes: " + fmt(tr) + "\\n🪙 QUSD: " + fmt(qusd) + "\\n↩️ Regreso: " + fmt(regreso) + " CUP\\n💵 Ganancia: " + fmt(gan) + " CUP\\n📈 Margen: " + fmt(margen) + "%");
  autosave();
}
function copiar(){ window.location.href = "ernesto://copy?d=" + encodeURIComponent(JSON.stringify({ text: lastText })); }
function salir(){ window.location.href = "ernesto://exit"; }
// init
sv("s_salida", SAVED.saldo.salida); sv("s_costo", SAVED.saldo.costo); sv("s_tasa", SAVED.saldo.tasa); sv("s_saldo", SAVED.saldo.saldo);
sv("t_efectivo", SAVED.transf.efectivo); sv("t_porc", SAVED.transf.porc); sv("t_libro", SAVED.transf.libro); sv("t_salida", SAVED.transf.salida);
const B0 = SAVED.busc || { precio: 950, tasaVenta: 313, efectivo: 5000, porc: 30, libro: 1110, salida: 950 };
sv("b_precio", B0.precio); sv("b_tasa", B0.tasaVenta); sv("b_salida", B0.salida);
sv("b2_efectivo", B0.efectivo); sv("b2_porc", B0.porc); sv("b2_libro", B0.libro); sv("b2_salida", B0.salida);
document.querySelectorAll("input[type=number]").forEach(function(el){ el.addEventListener("input", render); });
document.getElementById("t_slider").addEventListener("input", function(){ sv("t_porc", this.value); render(); });
document.getElementById("b2_slider").addEventListener("input", function(){ sv("b2_porc", this.value); render(); });
render();
</script>
</body>
</html>`;
}

// ---------- MAIN ----------
const data = loadData();
if (!data.busc) data.busc = { precio: 950, tasaVenta: 313, efectivo: 5000, porc: 30, libro: 1110, salida: 950 };
const qp = (typeof args !== "undefined" && args.queryParameters) || {};
if (config.runsInWidget) {
  Script.setWidget(buildWidget(data));
  Script.complete();
} else if (!config.runsInApp && qp.full !== "1") {
  // Corrió desde Atajos (segundo plano): se relanza dentro de la app
  // de Scriptable para que la pantalla abra como una app de verdad.
  const selfURL = "scriptable:///run/" + encodeURIComponent(Script.name()) + "?full=1";
  await Safari.open(selfURL);
  Script.complete();
} else {
  const wv = new WebView();
  wv.shouldAllowRequest = (req) => {
    const url = req.url || "";
    if (url.indexOf("ernesto://") === 0) {
      try {
        const q = url.split("?d=")[1];
        const payload = q ? JSON.parse(decodeURIComponent(q)) : {};
        if (url.indexOf("ernesto://save") === 0) saveData(payload);
        if (url.indexOf("ernesto://copy") === 0 && payload.text) Pasteboard.copyString(payload.text);
        if (url.indexOf("ernesto://exit") === 0) Script.complete();
      } catch (e) {}
      return false;
    }
    return true;
  };
  await wv.loadHTML(buildHTML(data));
  await wv.present(true);
  Script.complete();
}

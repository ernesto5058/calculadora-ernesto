// version: 12
// Calculadora Ernesto PRO — Scriptable (100% NATIVA)
// v12: el diseno de la tabla quedo FIJO con alto de fila propio y pesos
// de celda (la v11 se veia montada: sin alto, la fila no crecia con el
// texto de dos lineas). Cada dato va en UNA sola linea con su valor.
// La entrada de datos va por Alert con campos de texto y teclado numerico
// (flujo de la v1 que SI funciono en el telefono de Ernesto).
// La WebView quedo descartada: en su iPhone la pagina se veia pero los
// toques no llegaban a los controles (4 versiones seguidas fallando).

const FM = FileManager.local();
const PATH = FM.joinPath(FM.documentsDirectory(), "calc-ernesto.json");

function loadData() {
  let fromFile = null;
  try {
    if (FM.fileExists(PATH)) fromFile = JSON.parse(FM.readString(PATH));
  } catch (e) {}
  if (!fromFile) {
    try {
      const ic = FileManager.iCloud();
      const ip = ic.joinPath(ic.documentsDirectory(), "calc-ernesto.json");
      if (ic.fileExists(ip)) fromFile = JSON.parse(ic.readString(ip));
    } catch (e) {}
  }
  const d = fromFile || {};
  if (!d.saldo) d.saldo = { salida: 950, costo: 1040, tasa: 320, saldo: 3600 };
  if (!d.transf) d.transf = { efectivo: 5000, porc: 30, libro: 1130, salida: 950 };
  if (!d.busc) d.busc = { precio: 950, tasaVenta: 313, efectivo: 5000, porc: 30, libro: 1110, salida: 950 };
  return d;
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

// ---------- Entrada de datos (Alert nativo) ----------
// Devuelve {key: valor} si pulso Calcular, o null si cancelo.
// clean() pone a prueba que lo que devuelve textFieldValue sea util:
// si un campo llega vacio o ilegible, conserva el valor anterior.
function clean(raw, prev) {
  const s = (raw === null || raw === undefined ? "" : String(raw)).replace(",", ".").trim();
  const n = parseFloat(s);
  return isNaN(n) ? prev : n;
}
async function editForm(title, message, fields) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    try {
      const tf = a.addTextField(f.label, String(f.value));
      if (tf && tf.setDecimalPadKeyboard) tf.setDecimalPadKeyboard();
      else if (tf && tf.setNumberPadKeyboard) tf.setNumberPadKeyboard();
    } catch (e) {
      a.addTextField(f.label, String(f.value));
    }
  }
  a.addAction("✅ Calcular");
  a.addCancelAction("Cancelar");
  const idx = await a.presentAlert();
  if (idx === -1) return null;
  const out = {};
  for (let i = 0; i < fields.length; i++) {
    out[fields[i].key] = clean(a.textFieldValue(i), fields[i].value);
  }
  return out;
}

// ---------- Pantalla principal (UITable nativa) ----------
const GOLD = new Color("#F5BC14");
const TEAL = new Color("#2ECCAC");
const RED = new Color("#FF5C5C");
const GREEN = new Color("#2ECC71");
const GRAY = new Color("#9EAFC4");

function headerRow(table, text, color) {
  const r = new UITableRow();
  r.height = 34;
  const c = UITableCell.text(text);
  c.titleFont = Font.boldSystemFont(19);
  if (color) c.titleColor = color;
  r.addCell(c);
  table.addRow(r);
}
function bigRow(table, text, color) {
  const r = new UITableRow();
  r.height = 52;
  const c = UITableCell.text(text);
  c.titleFont = Font.boldSystemFont(30);
  if (color) c.titleColor = color;
  r.addCell(c);
  table.addRow(r);
}
function infoRow(table, label, value) {
  const r = new UITableRow();
  r.height = 26;
  const a = UITableCell.text(label);
  a.titleFont = Font.systemFont(15);
  a.widthWeight = 55;
  const b = UITableCell.text(value);
  b.titleFont = Font.boldSystemFont(15);
  b.widthWeight = 45;
  b.rightAligned();
  r.addCell(a);
  r.addCell(b);
  table.addRow(r);
}
function noteRow(table, text, color) {
  const r = new UITableRow();
  r.height = 24;
  const c = UITableCell.text(text);
  c.titleFont = Font.systemFont(13);
  if (color) c.titleColor = color;
  r.addCell(c);
  table.addRow(r);
}
function editRow(table, label, value, onTap) {
  const r = new UITableRow();
  r.height = 30;
  const c = UITableCell.text(label + ":  " + value);
  c.titleFont = Font.systemFont(16);
  c.widthWeight = 72;
  const b = UITableCell.button("✏️ Cambiar");
  b.widthWeight = 28;
  b.rightAligned();
  b.onTap = onTap;
  b.dismissOnTap = true;
  r.addCell(c);
  r.addCell(b);
  table.addRow(r);
}
function actionRow(table, label, onTap) {
  const r = new UITableRow();
  r.height = 32;
  const b = UITableCell.button(label);
  b.onTap = onTap;
  b.dismissOnTap = true;
  r.addCell(b);
  table.addRow(r);
}

async function runApp() {
  const data = loadData();
  const s = calcSaldo(data.saldo);
  const t = calcTransf(data.transf);
  const bs = calcBuscSaldo(data.busc);
  const bt = calcBuscTransf(data.busc);
  const okS = data.saldo.tasa <= s.eq && s.g360 > 0;
  const okT = data.transf.porc > t.eqp && t.ganancia > 0;
  const okB1 = bs.excedente > 0;
  const okB2 = data.busc.porc >= 25 && bt.ganancia > 0;

  const table = new UITable();
  table.showSeparators = true;

  headerRow(table, "📌 CALCULADORA ERNESTO", GOLD);
  noteRow(table, "Todo nativo, sin internet. Toca «Cambiar» en lo que quieras ajustar.", GRAY);

  actionRow(table, "📋 Copiar resultados", () => {
    Pasteboard.copyString(
      "📌 CALCULADORA ERNESTO\n" +
      "📱 SALDO — Eq " + fmt(s.eq) + " · G/360 " + fmt(s.g360) + " · Total " + fmt(s.total) + " CUP " + (okS ? "🟢" : "🔴") + "\n" +
      "🏦 TRANSF — Eq al " + fmt(t.eqp) + "% · Ganancia " + fmt(t.ganancia) + " CUP · Regreso " + fmt(t.regreso) + " " + (okT ? "🟢" : "🔴") + "\n" +
      "🤝 BUSCADOR SALDO — Cobra él " + fmt(bs.comision) + " · Neto tuyo " + fmt(bs.neto) + "\n" +
      "🤝 BUSCADOR TRANSF — Cobra él " + fmt(bt.comision) + " · Neto tuyo " + fmt(bt.neto)
    );
  });

  headerRow(table, "📱 SALDO", TEAL);
  bigRow(table, fmt(s.total) + " CUP", okS ? GREEN : RED);
  noteRow(table, okS ? "🟢 PUEDES VENDER" : "🔴 NO VENDAS A ESA TASA", okS ? GREEN : RED);
  infoRow(table, "⚖️ Equilibrio (techo)", fmt(s.eq));
  infoRow(table, "💰 Ganancia por 360", fmt(s.g360) + " CUP");
  editRow(table, "💵 Salida con Miguel", fmt(data.saldo.salida), async () => {
    const r = await editForm("📱 Saldo", "Salida con Miguel (CUP por QUSD)", [
      { key: "salida", label: "Salida", value: data.saldo.salida }
    ]);
    if (r) { data.saldo.salida = r.salida; saveData(data); }
  });
  editRow(table, "🏷️ Costo por 360", fmt(data.saldo.costo), async () => {
    const r = await editForm("📱 Saldo", "Costo de compra por cada 360 (con buscador incluido si aplica)", [
      { key: "costo", label: "Costo por 360", value: data.saldo.costo }
    ]);
    if (r) { data.saldo.costo = r.costo; saveData(data); }
  });
  editRow(table, "📊 Tasa de venta", fmt(data.saldo.tasa), async () => {
    const r = await editForm("📱 Saldo", "Tasa a la que vendes en QvaPay (saldo por QUSD)", [
      { key: "tasa", label: "Tasa de venta", value: data.saldo.tasa }
    ]);
    if (r) { data.saldo.tasa = r.tasa; saveData(data); }
  });
  editRow(table, "📱 Saldo a vender", fmt(data.saldo.saldo), async () => {
    const r = await editForm("📱 Saldo", "Cantidad de saldo que vas a vender", [
      { key: "saldo", label: "Saldo", value: data.saldo.saldo }
    ]);
    if (r) { data.saldo.saldo = r.saldo; saveData(data); }
  });
  actionRow(table, "✏️ Editar TODO el saldo de una vez", async () => {
    const r = await editForm("📱 Saldo — todo", "Los 4 datos del saldo. Lo que dejes igual, queda igual.", [
      { key: "salida", label: "Salida con Miguel", value: data.saldo.salida },
      { key: "costo", label: "Costo por 360", value: data.saldo.costo },
      { key: "tasa", label: "Tasa de venta", value: data.saldo.tasa },
      { key: "saldo", label: "Saldo a vender", value: data.saldo.saldo }
    ]);
    if (r) { data.saldo = r; saveData(data); }
  });

  headerRow(table, "🏦 TRANSFERENCIA", TEAL);
  bigRow(table, fmt(t.ganancia) + " CUP", okT ? GREEN : RED);
  noteRow(table, okT ? "🟢 LA VUELTA CIERRA" : "🔴 NO CIERRA", okT ? GREEN : RED);
  infoRow(table, "🎯 Equilibrio", "al " + fmt(t.eqp) + "%");
  infoRow(table, "📈 Margen real", fmt(t.margen) + "%");
  infoRow(table, "↩️ Regreso", fmt(t.regreso) + " CUP");
  infoRow(table, "💵 En QUSD", fmt(t.qusd));
  editRow(table, "💵 Efectivo a mover", fmt(data.transf.efectivo), async () => {
    const r = await editForm("🏦 Transferencia", "Efectivo que pones en la vuelta (CUP)", [
      { key: "efectivo", label: "Efectivo", value: data.transf.efectivo }
    ]);
    if (r) { data.transf.efectivo = r.efectivo; saveData(data); }
  });
  editRow(table, "％ Prima (al %)", fmt(data.transf.porc) + "%", async () => {
    const r = await editForm("🏦 Transferencia", "Prima de la vuelta: recibes ese % extra en transferencia", [
      { key: "porc", label: "Al %", value: data.transf.porc }
    ]);
    if (r) { data.transf.porc = r.porc; saveData(data); }
  });
  editRow(table, "📖 Libro BANK_CUP", fmt(data.transf.libro), async () => {
    const r = await editForm("🏦 Transferencia", "Libro BANK_CUP (transferencia por QUSD)", [
      { key: "libro", label: "Libro", value: data.transf.libro }
    ]);
    if (r) { data.transf.libro = r.libro; saveData(data); }
  });
  editRow(table, "💵 Salida con Miguel", fmt(data.transf.salida), async () => {
    const r = await editForm("🏦 Transferencia", "Salida con Miguel (CUP por QUSD)", [
      { key: "salida", label: "Salida", value: data.transf.salida }
    ]);
    if (r) { data.transf.salida = r.salida; saveData(data); }
  });
  actionRow(table, "✏️ Editar TODA la transferencia de una vez", async () => {
    const r = await editForm("🏦 Transferencia — todo", "Los 4 datos de la vuelta. Lo que dejes igual, queda igual.", [
      { key: "efectivo", label: "Efectivo", value: data.transf.efectivo },
      { key: "porc", label: "Al %", value: data.transf.porc },
      { key: "libro", label: "Libro BANK_CUP", value: data.transf.libro },
      { key: "salida", label: "Salida con Miguel", value: data.transf.salida }
    ]);
    if (r) { data.transf = r; saveData(data); }
  });

  headerRow(table, "🤝 BUSCADORES", TEAL);
  bigRow(table, fmt(bs.comision) + " CUP", okB1 ? GREEN : RED);
  noteRow(table, okB1 ? "🟢 cobra por cada 360 entregado" : "🔴 SIN EXCEDENTE: NO COMPRAR", okB1 ? GREEN : RED);
  infoRow(table, "💰 Neto tuyo por 360", fmt(bs.neto) + " CUP");
  infoRow(table, "🎁 Bono semanal", "150+ → +300 CUP");
  editRow(table, "🏷️ Precio pagado al vendedor", fmt(data.busc.precio), async () => {
    const r = await editForm("🤝 Buscador de saldo", "Precio REAL pagado al vendedor por 360 (lo confirmas tú)", [
      { key: "precio", label: "Precio pagado", value: data.busc.precio }
    ]);
    if (r) { data.busc.precio = r.precio; saveData(data); }
  });
  editRow(table, "📊 Tasa de venta del día", fmt(data.busc.tasaVenta), async () => {
    const r = await editForm("🤝 Buscador de saldo", "Tasa a la que venderás ese saldo hoy", [
      { key: "tasaVenta", label: "Tasa de venta", value: data.busc.tasaVenta }
    ]);
    if (r) { data.busc.tasaVenta = r.tasaVenta; saveData(data); }
  });
  editRow(table, "💵 Salida (busc. saldo)", fmt(data.busc.salida), async () => {
    const r = await editForm("🤝 Buscador de saldo", "Salida con Miguel para esta cuenta", [
      { key: "salida", label: "Salida", value: data.busc.salida }
    ]);
    if (r) { data.busc.salida = r.salida; saveData(data); }
  });
  headerRow(table, "🤝 BUSCADOR TRANSF. " + (okB2 ? "🟢" : "🔴"), TEAL);
  infoRow(table, "💸 Cobra él (vuelta)", fmt(bt.comision) + " CUP");
  infoRow(table, "💰 Neto tuyo (vuelta)", fmt(bt.neto) + " CUP");
  infoRow(table, "🎯 Piso · equilibrio", "al 25% · " + fmt(bt.eqp) + "%");
  noteRow(table, "🎁 10+ tratos/semana → +300 CUP · Solo gente conocida", GRAY);
  editRow(table, "💵 Efectivo (busc. transf.)", fmt(data.busc.efectivo), async () => {
    const r = await editForm("🤝 Buscador de transferencia", "Efectivo de la vuelta que trae el buscador", [
      { key: "efectivo", label: "Efectivo", value: data.busc.efectivo }
    ]);
    if (r) { data.busc.efectivo = r.efectivo; saveData(data); }
  });
  editRow(table, "％ Prima (busc. transf.)", fmt(data.busc.porc) + "%", async () => {
    const r = await editForm("🤝 Buscador de transferencia", "Prima del trato (piso: al 25%)", [
      { key: "porc", label: "Al %", value: data.busc.porc }
    ]);
    if (r) { data.busc.porc = r.porc; saveData(data); }
  });
  editRow(table, "📖 Libro (busc. transf.)", fmt(data.busc.libro), async () => {
    const r = await editForm("🤝 Buscador de transferencia", "Libro BANK_CUP para esta cuenta", [
      { key: "libro", label: "Libro", value: data.busc.libro }
    ]);
    if (r) { data.busc.libro = r.libro; saveData(data); }
  });

  noteRow(table, "Hecha por Máximo · v12 nativa", GRAY);
  await table.present(true);
}

// ---------- MAIN ----------
const data0 = loadData();
const qp = (typeof args !== "undefined" && args.queryParameters) || {};
if (config.runsInWidget) {
  Script.setWidget(buildWidget(data0));
  Script.complete();
} else if (!config.runsInApp && qp.full !== "1") {
  // Corrió desde Atajos (segundo plano): se relanza dentro de la app
  // de Scriptable para que la tabla abra como una app de verdad.
  const selfURL = "scriptable:///run/" + encodeURIComponent(Script.name()) + "?full=1";
  await Safari.open(selfURL);
  Script.complete();
} else {
  await runApp();
  Script.complete();
}

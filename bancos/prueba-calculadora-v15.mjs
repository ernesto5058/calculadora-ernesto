// Banco CalculadoraPRO v15 — sincronización real de tarifa (salida/costo).
// Corre la pieza REAL tres veces en vm con mocks de Scriptable:
//   S1 app sin red · S2 app con red, primera sync, sin código (cancela)
//   S3 app con red y código en Keychain (sube el pendiente) · S4 widget
// y la página capturada pasa la regresión de la v14 en jsdom (14 campos
// con ayuda, mates, semáforos, pestañas, teclado propio, puente save).
// Uso: node bancos/prueba-calculadora-v15.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const SRC = readFileSync(new URL("../CalculadoraPRO-v15.js", import.meta.url), "utf8");
const SRC14 = readFileSync(new URL("../CalculadoraPRO-v14.js", import.meta.url), "utf8");

let n = 0, ok = 0;
const fallos = [];
function chk(nombre, cond, detalle) {
  n++;
  if (cond) { ok++; }
  else { fallos.push(nombre + (detalle ? " — " + detalle : "")); console.log("  ✗", nombre, detalle || ""); }
}
const fmt = (x) => (Math.round(x * 100) / 100).toFixed(2);

// ---------- 1 · Núcleo puro (resolverTarifa) ----------
let core = SRC.split("// === SYNC-CORE-BEGIN ===")[1].split("// === SYNC-CORE-END ===")[0];
core = core.slice(core.indexOf("\n") + 1); // fuera el resto del comentario del marcador
const { numONull, resolverTarifa } = new Function(core + "; return { numONull, resolverTarifa };")();

chk("R0 numONull: vacío/0/texto = null (sin tarifa)", numONull("") === null && numONull(0) === null && numONull("x") === null && numONull(null) === null);
chk("R0b numONull: número útil pasa", numONull(910) === 910 && numONull("1000") === 1000);
let r = resolverTarifa({ salida: 950, costo: 1040 }, { salida: 910, costo: null }, null, {});
chk("R1 primera vez: baja la salida del sistema", r.aplicar.salida === 910);
chk("R1b primera vez: el costo local completa el sistema (relleno)", r.subir.costo === 1040 && r.aplicar.costo === undefined);
r = resolverTarifa({ salida: 910, costo: 1000 }, { salida: 910, costo: 1000 }, { salida: 910, costo: 1000 }, {});
chk("R2 todo igual: ni aplica ni sube", !Object.keys(r.aplicar).length && !Object.keys(r.subir).length && r.yaIgual.salida === 910);
r = resolverTarifa({ salida: 910, costo: 1000 }, { salida: 930, costo: 1000 }, { salida: 910, costo: 1000 }, {});
chk("R3 cambió el sistema: baja la nueva salida", r.aplicar.salida === 930 && r.subir.salida === undefined);
r = resolverTarifa({ salida: 910, costo: 1000 }, { salida: 910, costo: null }, { salida: 910, costo: null }, { costo: { valor: 1000 } });
chk("R4 lo tecleado (pendiente) sube", r.subir.costo === 1000);
r = resolverTarifa({ salida: null, costo: 1000 }, { salida: 910, costo: 1000 }, { salida: 910, costo: 1000 }, {});
chk("R5 campo vacío local: fuera de sync (no se pisa ni se sube)", r.aplicar.salida === undefined && r.subir.salida === undefined);
r = resolverTarifa({ salida: 950, costo: 1040 }, { salida: null, costo: null }, null, {});
chk("R6 sistema sin tarifa: nada se inventa, lo local se ofrece de relleno", r.aplicar.salida === undefined && r.subir.salida === 950 && r.subir.costo === 1040);
r = resolverTarifa({ salida: 950, costo: 1000 }, { salida: 930, costo: 1000 }, { salida: 900, costo: 1000 }, {});
chk("R7 conflicto sin tecleo pendiente: manda el sistema", r.aplicar.salida === 930);
r = resolverTarifa({ salida: 950, costo: 1000 }, { salida: 900, costo: 1000 }, { salida: 900, costo: 1000 }, {});
chk("R8 cambio local defensivo: sube", r.subir.salida === 950);
r = resolverTarifa({ salida: 910, costo: 1000 }, { salida: 910, costo: 1000 }, { salida: 910, costo: 900 }, { costo: { valor: 1000 } });
chk("R9 pendiente ya confirmado arriba: no se re-sube", r.subir.costo === undefined && r.confirmado.costo === 1000);

// ---------- 2 · Mocks de Scriptable + corridas ----------
function correrEscenario(cfg) {
  const fsLocal = new Map(), fsCloud = new Map();
  if (cfg.archivoLocal) fsLocal.set("/local/calc-ernesto.json", JSON.stringify(cfg.archivoLocal));
  const keychain = new Map(Object.entries(cfg.keychain || {}));
  const llamadas = [];
  let htmlPresentado = null, widget = null, alertas = 0, completado = false;

  function fmDe(store) {
    return {
      joinPath: (a, b) => a + "/" + b,
      documentsDirectory: () => (store === fsLocal ? "/local" : "/icloud"),
      fileExists: (p) => store.has(p),
      readString: (p) => store.get(p),
      writeString: (p, s) => store.set(p, s),
      downloadFileFromiCloud: async () => true,
    };
  }
  class RequestM {
    constructor(url) { this.url = url; }
    async loadJSON() {
      if (cfg.red === "off") throw new Error("The Internet connection appears to be offline.");
      if (this.url.endsWith("/leer_tarifa")) return Object.assign({ ok: true }, cfg.tarifa);
      if (this.url.endsWith("/calc_sincronizar_tarifa")) {
        llamadas.push(JSON.parse(this.body));
        if (cfg.pushFalla === "codigo") return { code: "P0001", message: "codigo admin no valido" };
        if (cfg.pushFalla === "red") throw new Error("The Internet connection appears to be offline.");
        return { ok: true, actualizado: "2026-11-14T00:00:00Z" };
      }
      throw new Error("URL no mockeada: " + this.url);
    }
  }
  class AlertM {
    addSecureTextField() {} addAction() {} addCancelAction() {}
    textFieldValue() { return cfg.alertCodigo || ""; }
    async present() { alertas++; return cfg.alert === "codigo" ? 0 : -1; }
  }
  const webviews = [];
  class WebViewM {
    constructor() { webviews.push(this); }
    async loadHTML(h) { htmlPresentado = h; }
    async present() { return true; }
  }
  class ListWidgetM {
    constructor() { this.textos = []; }
    addText(t) { const o = { text: t }; this.textos.push(o); return o; }
    addSpacer() {}
  }
  const sandbox = {
    console,
    FileManager: { local: () => fmDe(fsLocal), iCloud: () => fmDe(fsCloud) },
    Keychain: {
      contains: (k) => keychain.has(k), get: (k) => keychain.get(k),
      set: (k, v) => keychain.set(k, v), remove: (k) => keychain.delete(k),
    },
    Request: RequestM, Alert: AlertM, WebView: WebViewM, ListWidget: ListWidgetM,
    Color: class { static white() { return {}; } static black() { return {}; } static clear() { return {}; } }, Font: { boldSystemFont: () => ({}), systemFont: () => ({}) },
    Script: { name: () => "CalculadoraPRO", setWidget: (w) => { widget = w; }, complete: () => { completado = true; } },
    Safari: { open: async () => {} },
    Pasteboard: { copyString: () => {} },
    args: { queryParameters: { full: "1" } },
    config: cfg.config,
  };
  vm.createContext(sandbox);
  const promesa = vm.runInContext("(async () => {\n" + SRC + "\n})()", sandbox);
  return promesa.then(() => ({ fsLocal, keychain, llamadas, webviews, get html() { return htmlPresentado; }, widget, alertas: () => alertas, completado: () => completado }))
    .catch((e) => { throw new Error("La corrida explotó: " + (e && e.message)); });
}
const DATA14 = { saldo: { salida: 950, costo: 1040, tasa: 320, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 }, busc: { precio: 950, tasaVenta: 313, efectivo: 5000, porc: 30, libro: 1110, salida: 950 } };
const APP = { runsInWidget: false, runsInApp: true };

// S1 · app sin red: todo local, la app abre igual
const s1 = await correrEscenario({ config: APP, red: "off", archivoLocal: DATA14 });
chk("S1 sin red: la app presenta su pantalla", !!s1.html);
chk("S1 sin red: estado «sin-conexión» anotado", JSON.parse(s1.fsLocal.get("/local/calc-ernesto.json")).sync.ultimo.estado === "sin-conexion");
chk("S1 sin red: cero subidas intentadas", s1.llamadas.length === 0);

// S2 · primera sync con red, sin código y cancela: baja salida, anota relleno
const s2 = await correrEscenario({ config: APP, red: "on", tarifa: { salida_ref: 910, costo_ref360: null }, archivoLocal: DATA14, alert: "cancel" });
const meta2 = JSON.parse(s2.fsLocal.get("/local/calc-ernesto.json"));
chk("S2 la salida del sistema (910) quedó aplicada en el archivo", meta2.saldo.salida === 910);
chk("S2 el costo local NO se pisa (1040 sigue)", meta2.saldo.costo === 1040);
chk("S2 relleno anotado en la cola (pendiente.costo = 1040)", meta2.sync.pendiente.costo && meta2.sync.pendiente.costo.valor === 1040);
chk("S2 sin código no se sube nada", s2.llamadas.length === 0);
chk("S2 estado = falta-codigo (honesto)", meta2.sync.ultimo.estado === "falta-codigo");
chk("S2 el código se pidió una sola vez", s2.alertas() === 1);

// S3 · con código en Keychain y un pendiente: sube SOLO el pendiente
const dataS3 = JSON.parse(JSON.stringify(DATA14));
dataS3.saldo.salida = 910; dataS3.saldo.costo = 1000;
dataS3.sync = { snap: { salida: 910, costo: null }, pendiente: { costo: { valor: 1000, en: "2026-11-14T00:00:00Z" } }, ultimo: null };
const s3 = await correrEscenario({ config: APP, red: "on", tarifa: { salida_ref: 910, costo_ref360: null }, archivoLocal: dataS3, keychain: { calcPRO_codigo_admin: "CODIGO-PRUEBA" } });
const meta3 = JSON.parse(s3.fsLocal.get("/local/calc-ernesto.json"));
chk("S3 una sola llamada de subida", s3.llamadas.length === 1);
chk("S3 la subida lleva SOLO el costo (salida = null, no tocar)", s3.llamadas[0] && s3.llamadas[0].p_costo === 1000 && s3.llamadas[0].p_salida === null);
chk("S3 la subida usa el código del Keychain", s3.llamadas[0] && s3.llamadas[0].p_codigo === "CODIGO-PRUEBA");
chk("S3 pendiente limpio y snap confirmado tras subir", !Object.keys(meta3.sync.pendiente).length && meta3.sync.snap.costo === 1000);
chk("S3 estado = sincronizado", meta3.sync.ultimo.estado === "sincronizado");
chk("S3 con código guardado NO se pregunta", s3.alertas() === 0);

// S4 · widget con red: baja la salida nueva y pinta con ella; jamás pregunta
const dataS4 = JSON.parse(JSON.stringify(DATA14));
dataS4.sync = { snap: { salida: 950, costo: 1040 }, pendiente: {}, ultimo: null };
const s4 = await correrEscenario({ config: { runsInWidget: true, runsInApp: false }, red: "on", tarifa: { salida_ref: 930, costo_ref360: 1040 }, archivoLocal: dataS4 });
chk("S4 widget construido", !!s4.widget);
chk("S4 widget pinta con la salida del sistema (930)", !!s4.widget && s4.widget.textos.some((t) => t.text.includes("Eq: " + fmt(360 * 930 / 1040))));
chk("S4 widget jamás pregunta código", s4.alertas() === 0);

// S5 · código inválido: la puerta lo rechaza, se borra y se anota el estado
const s5 = await correrEscenario({ config: APP, red: "on", tarifa: { salida_ref: 910, costo_ref360: null }, archivoLocal: dataS3, keychain: { calcPRO_codigo_admin: "MALO" }, pushFalla: "codigo" });
const meta5 = JSON.parse(s5.fsLocal.get("/local/calc-ernesto.json"));
chk("S5 código rechazado: estado codigo-invalido", meta5.sync.ultimo.estado === "codigo-invalido");
chk("S5 código rechazado: se borra del Keychain", !s5.keychain.has("calcPRO_codigo_admin"));
chk("S5 código rechazado: el pendiente NO se pierde", meta5.sync.pendiente.costo && meta5.sync.pendiente.costo.valor === 1000);

// ---------- 3 · La página (regresión v14 en jsdom sobre el HTML de S1) ----------
const htmlPlano = s1.html.replaceAll("window.location.href", "window.__cap");
const saves = [];
const dom = new JSDOM(htmlPlano, {
  runScripts: "dangerously",
  beforeParse(window) {
    Object.defineProperty(window, "__cap", { set(v) { saves.push(v); }, get() { return ""; } });
  },
});
const { document } = dom.window;
await new Promise((res) => setTimeout(res, 60));
chk("P1 la página pinta los 14 campos", document.querySelectorAll(".num").length === 14, "" + document.querySelectorAll(".num").length);
chk("P2 cada campo trae su explicación corta", document.querySelectorAll(".help").length >= 14, "" + document.querySelectorAll(".help").length);
chk("P3 pie con el estado de sync (sin conexión, honesto)", (document.getElementById("syncFoot") || {}).textContent.includes("Sin conexión") || (document.getElementById("syncFoot") || {}).textContent.includes("Sin conexion"));
chk("P4 valores locales precargados (salida 950)", document.getElementById("s_salida").value === "950");
// mates Saldo con números de hoy: salida 910 · costo 1000 · tasa 303.39 · saldo 3600
const set = (id, v) => { document.getElementById(id).value = v; };
set("s_salida", 910); set("s_costo", 1000); set("s_tasa", 303.39); set("s_saldo", 3600);
dom.window.render();
const g360 = (360 / 303.39) * 910 - 1000;
chk("P5 equilibrio = 360 × salida ÷ costo", document.getElementById("r_eq").textContent === fmt(360 * 910 / 1000), document.getElementById("r_eq").textContent);
chk("P6 ganancia/360 correcta", document.getElementById("r_g360").textContent === fmt(g360), document.getElementById("r_g360").textContent);
chk("P7 total con el descuento del envío", document.getElementById("r_total").textContent === fmt(g360 * 10 - 14.44), document.getElementById("r_total").textContent);
chk("P8 semáforo VENDE cuando la tasa está bajo el techo", document.getElementById("r_semaS").textContent.includes("VENDE"));
// transferencia con los valores sembrados
dom.window.showTab("t");
chk("P9 pestañas cambian de panel", document.getElementById("panelT").className.includes("on") && !document.getElementById("panelS").className.includes("on"));
const reg = (5000 * 1.3 / 1130) * 950;
chk("P10 transferencia: regreso correcto", document.getElementById("r_regreso").textContent === fmt(reg), document.getElementById("r_regreso").textContent);
// teclado propio: tocar un campo abre la pizarra y escribe
document.getElementById("s_costo").dispatchEvent(new dom.window.Event("click", { bubbles: true }));
chk("P11 tocar un campo abre el teclado propio", document.getElementById("pad").className === "on");
dom.window.pk("7");
chk("P12 el teclado escribe en el campo activo", document.getElementById("s_costo").value.endsWith("7"));
dom.window.pkOK();
chk("P13 LISTO cierra el teclado", document.getElementById("pad").className === "");
// el puente de guardado dispara tras editar (autosave 500 ms)
await new Promise((res) => setTimeout(res, 700));
chk("P14 el guardado viaja por el puente ernesto://save", saves.some((u) => u.startsWith("ernesto://save?d=")), saves[0] || "sin saves");

// el save de la página, de vuelta en nativo, anota el pendiente (outbox)
const payload = JSON.parse(decodeURIComponent(saves[saves.length - 1].split("?d=")[1]));
chk("P15 el payload trae la salida/costo tecleados", payload.saldo.salida === 910 && payload.saldo.costo === 10007, JSON.stringify(payload.saldo));

// ---------- 3b · Outbox extremo a extremo (vm): editar → cola → reabrir → sube ----------
const baseS6 = JSON.parse(s3.fsLocal.get("/local/calc-ernesto.json")); // snap {910,1000}, sin pendientes
const s6 = await correrEscenario({ config: APP, red: "on", tarifa: { salida_ref: 910, costo_ref360: 1000 }, archivoLocal: baseS6, keychain: { calcPRO_codigo_admin: "CODIGO-PRUEBA" } });
const wv6 = s6.webviews[0];
const editado = JSON.parse(JSON.stringify(baseS6));
editado.saldo.salida = 920; // Ernesto teclea otra salida dentro de la app
const urlSave = "ernesto://save?d=" + encodeURIComponent(JSON.stringify({ saldo: editado.saldo, transf: editado.transf, busc: editado.busc }));
chk("O1 el puente acepta el save y lo bloquea como navegación", wv6.shouldAllowRequest({ url: urlSave }) === false);
const trasSave = JSON.parse(s6.fsLocal.get("/local/calc-ernesto.json"));
chk("O2 el save fusiona la sección SIN pisar la meta sync", trasSave.saldo.salida === 920 && trasSave.sync.snap.costo === 1000);
chk("O3 lo tecleado quedó en la cola (pendiente.salida = 920)", trasSave.sync.pendiente.salida && trasSave.sync.pendiente.salida.valor === 920);
// reabrir con red y código: la cola sale sola, una sola vez
const s6b = await correrEscenario({ config: APP, red: "on", tarifa: { salida_ref: 910, costo_ref360: 1000 }, archivoLocal: trasSave, keychain: { calcPRO_codigo_admin: "CODIGO-PRUEBA" } });
const trasReabrir = JSON.parse(s6b.fsLocal.get("/local/calc-ernesto.json"));
chk("O4 al reabrir sube SOLO la salida pendiente", s6b.llamadas.length === 1 && s6b.llamadas[0].p_salida === 920 && s6b.llamadas[0].p_costo === null, JSON.stringify(s6b.llamadas));
chk("O5 cola vacía y snap al día tras la subida", !Object.keys(trasReabrir.sync.pendiente).length && trasReabrir.sync.snap.salida === 920);

// ---------- 4 · Higiene ----------
chk("H1 cabecera de versión 15 (la que lee el Actualizador)", SRC.startsWith("// version: 15"));
chk("H2 sin llave secreta ni service_role en el código", !SRC.includes("sb_secret") && !SRC.includes("service_role"));
chk("H3 usa las dos puertas de la tarifa (leer + sincronizar)", SRC.includes("leer_tarifa") && SRC.includes("calc_sincronizar_tarifa"));
chk("H4 la v14 sigue intacta como respaldo (versión 14, sin sync)", SRC14.startsWith("// version: 14") && !SRC14.includes("calc_sincronizar_tarifa"));

console.log(`\nBANCO CALCULADORA v15: ${ok}/${n}` + (fallos.length ? `\nFALLOS:\n- ${fallos.join("\n- ")}` : " — todo verde"));
process.exit(fallos.length ? 1 : 0);

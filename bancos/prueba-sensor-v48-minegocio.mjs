// Banco SENSOR v5 (Mi Negocio v48 · SIN RED + SYNC ORDENADA):
// el atajo trae el lote en local (#sms=), la app ingiere con
// dedupe por uuid y por huella de operadora, y al volver la red
// TODO ENTRA ORGANIZADAMENTE (criterio de Ernesto 2026-11-18
// 20:32): orden por fecha_original del SMS, duplicados marcados
// y no contados, ningún estado intermedio desordenado.
// Mismo arnés que prueba-outbox-sms-minegocio.mjs (jsdom + fetch
// stub); BDL cae a su adaptador en memoria sin IndexedDB.
import { JSDOM } from "jsdom";
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "minegocio/index.html", "utf8");
let pass = 0, fail = 0; const fails = [];
function ok(cond, name) { if (cond) pass++; else { fail++; fails.push(name); console.log("FAIL:", name); } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const MODO = { red: "sinred", ingresarDuplicadoPara: null };
const llamadasIng = []; // cuerpos de dinero_sms_ingresar, EN ORDEN
const llamadasAtr = []; // cuerpos de dinero_sms_atribuir, EN ORDEN
let smsSeq = 7000;

const preState = {
  codigo: "CODIGO-PRUEBA",
  foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], publicados: {}, borrados: [], tarifaPanel: null, mercado: null, perfiles: {} },
  calc: { saldo: { salida: 950, costo: 1040, tasa: 320, saldo: 3600 }, transf: { efectivo: 5000, porc: 30, libro: 1130, salida: 950 }, busc: { precio: 950, tasaVenta: 313, efectivo: 5000, porc: 30, libro: 1110, salida: 950 } },
  cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null, calcSync: null, calcEditEn: null, tarifaVivaMotor: null
};

const dom = new JSDOM(html, {
  url: "https://ernesto5058.github.io/calculadora-ernesto/minegocio/",
  runScripts: "dangerously", pretendToBeVisual: true,
  beforeParse(w) {
    try { w.localStorage.setItem("minegocio_v1", JSON.stringify(preState)); } catch (e) {}
    w.fetch = function (url, opts) {
      const u = String(url);
      const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v === undefined ? null : v)), json: () => Promise.resolve(v) });
      const sinRed = () => Promise.reject(new Error("Failed to fetch"));
      if (u.includes("/rpc/")) {
        const fn = u.split("/rpc/")[1].split("?")[0];
        let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
        if (MODO.red === "sinred") return sinRed();
        if (fn === "dinero_sms_ingresar") {
          llamadasIng.push(body);
          if (MODO.ingresarDuplicadoPara && body.p_client_uuid === MODO.ingresarDuplicadoPara) return json({ ok: true, sms_id: null, duplicado: true, por: "huella" });
          return json({ ok: true, sms_id: ++smsSeq, duplicado: false });
        }
        if (fn === "dinero_sms_atribuir") { llamadasAtr.push(body); return json({ ok: true }); }
        if (fn === "dinero_sms_sin_atribuir") return json({ ok: true, pendientes: [], atribuidas: [] });
        if (fn === "dinero_sms_desatribuir") return json({ ok: true });
        if (fn.includes("reportes")) return json([]);
        if (fn.includes("ayudas")) return json([]);
        if (fn.includes("usuarios")) return json([]);
        if (fn === "mensajes_sin_leer") return json({ ok: true, por_usuario: {}, total: 0 });
        if (fn === "ver_presencia") return json({ ok: true, usuarios: [] });
        if (fn === "leer_chat") return json({ ok: true, mensajes: [] });
        return json({ ok: true });
      }
      if (u.includes("datos.json") || u.includes("ultimo.json")) return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("{}"), json: () => Promise.resolve({}) });
      return json({});
    };
  }
});
const w = dom.window;
await sleep(700);

/* ---------- fixtures: piezas planas tal cual las escribe el atajo ---------- */
function pieza(uuid, fecha, formLineas, cuerpo) {
  return "MAXIMO-SMS-4\nuuid: " + uuid + "\nfecha: " + fecha + "\nremitente: ETECSA\n" + (formLineas || "") + "---\n" + cuerpo;
}
const CUERPO_ERIKA = "Usted ha recibido 2520.0 CUP del numero 54527199.Saldo principal 14830.08 CUP, linea activa hasta 2027-10-03, vence 2028-03-31";
const CUERPO_BRIKU = "Usted ha recibido 1080.0 CUP del numero 50049642.Saldo principal 15910.08 CUP, linea activa hasta 2027-10-03, vence 2028-03-31";
const CUERPO_BUSC = "Usted ha recibido 1440.0 CUP del numero 54519342.Saldo principal 11230.08 CUP, linea activa hasta 2027-10-03, vence 2028-03-31";
const CUERPO_RUIDO = "Usted ha transferido 500.0 CUP al numero 5351111111.Saldo principal 15410.08 CUP, linea activa hasta 2027-10-03, vence 2028-03-31";
const DELIM = "\n===MAXIMO-PIEZA===\n";
const lote = [
  pieza("u-erika", "2026-11-18T19:04:00.000Z", "form: listo\ntipo: mia\npago: 6650\n", CUERPO_ERIKA),
  pieza("u-briku-a", "2026-11-18T18:00:00.000Z", "", CUERPO_BRIKU),
  pieza("u-ruido", "2026-11-18T18:30:00.000Z", "form: no_negocio\n", CUERPO_RUIDO),
  pieza("u-busc", "2026-11-18T17:30:00.000Z", "form: listo\ntipo: buscador\nbuscador: BRIKU-EUX\npago: 4000\n", CUERPO_BUSC),
  pieza("u-briku-b", "2026-11-18T18:01:00.000Z", "", CUERPO_BRIKU)
].join(DELIM) + DELIM;

function opsSensor() { return (w.state.cola || []).filter(a => a && a.tipo === "sensorSubir"); }
async function regs() { return w.BDL.todos("sensor"); }
async function reg(uuid) { const t = await regs(); return t.find(r => r.uuid === uuid) || null; }

/* S48-1 · ingesta: entran 5 piezas; la copia de la operadora
   (mismo cuerpo, otro uuid) queda marcada y NO encola. */
const r1 = await w.ingerirLoteSensorMN(lote);
ok(r1.nuevos === 4 && r1.duplicados === 1, "S48-1a ingesta: 4 nuevos + 1 duplicado de operadora");
ok((await regs()).length === 5, "S48-1b el almacén guarda las 5 piezas (la copia marcada, no borrada)");
const copia = await reg("u-briku-b");
ok(copia && copia.duplicadoDe === "u-briku-a", "S48-1c la copia Briku 1080/50049642/15910.08 apunta a su original por huella");
ok(opsSensor().length === 4 && !opsSensor().some(a => a.clientUuid === "u-briku-b"), "S48-1d solo los 4 originales encolan subida; el duplicado jamás sale");
const erika = await reg("u-erika");
ok(erika && erika.form && erika.form.estado === "listo" && erika.form.tipo === "mia" && erika.form.pago === 6650, "S48-1e el lleno de Erika trae sus respuestas (mia, 6650)");
ok(erika && erika.monto === 2520 && erika.contraparte === "54527199" && erika.saldo === 14830.08 && erika.parseOk, "S48-1f el parseo del cuerpo es el del cerebro (2520 / 54527199 / 14830.08)");

/* S48-2 · REENTREGA inofensiva: el mismo lote entero otra vez
   no crea nada ni encola nada (dedupe por uuid). */
const r2 = await w.ingerirLoteSensorMN(lote);
ok(r2.nuevos === 0 && (await regs()).length === 5 && opsSensor().length === 4, "S48-2 re-entregar el lote entero es inofensivo: 0 nuevos, 0 ops nuevas");

/* S48-3 · el pendiente que vuelve LLENO adopta el formulario. */
const r3 = await w.ingerirLoteSensorMN(pieza("u-briku-a", "2026-11-18T18:00:00.000Z", "form: listo\ntipo: buscador\nbuscador: BRIKU-EUX\npago: 3000\n", CUERPO_BRIKU));
ok(r3.mejorados === 1, "S48-3a el formulario tardío mejora el registro pendiente");
const brikuA = await reg("u-briku-a");
ok(brikuA && brikuA.form && brikuA.form.tipo === "buscador" && brikuA.form.pago === 3000, "S48-3b el registro de Briku quedó llenado (buscador, 3000)");

/* S48-4 · OFFLINE: sin red, la cola acumula y nada se marca
   sincronizado ni se pierde. */
MODO.red = "sinred";
await w.despacharCola();
ok(opsSensor().length === 4 && opsSensor().every(a => a.estado === "pendiente" && a.intentos >= 1), "S48-4a sin internet las 4 ops quedan pendientes con su intento contado");
ok((await regs()).filter(r => !r.duplicadoDe).every(r => !r.sincronizado), "S48-4b sin internet ningún registro se marca sincronizado");
ok(llamadasIng.length === 0, "S48-4c sin internet no sale ni una llamada de ingesta");

/* S48-5 · EL CRITERIO (20:32): vuelve la red y TODO ENTRA
   ORGANIZADAMENTE — orden por fecha_original aunque la cola
   nació en otro orden; atribuciones encadenadas solo pa los
   llenos; estado final limpio. */
MODO.red = "ok";
await w.despacharCola();
const ordenIng = llamadasIng.map(b => b.p_client_uuid);
ok(JSON.stringify(ordenIng) === JSON.stringify(["u-busc", "u-briku-a", "u-ruido", "u-erika"]), "S48-5a la sync sube en orden de fecha del SMS (17:30 → 18:00 → 18:30 → 19:04), no en orden de llegada a la cola");
ok(opsSensor().length === 0, "S48-5b la cola del Sensor drena entera");
const todosFinal = await regs();
ok(todosFinal.filter(r => !r.duplicadoDe).every(r => r.sincronizado), "S48-5c los 4 originales quedan sincronizados");
ok(llamadasAtr.length === 3, "S48-5d se atribuyen solo los 3 llenos (busc, briku, erika); el no_negocio no atribuye");
const atrBusc = llamadasAtr.find(b => b.p_folio === "sensorv5-u-busc");
ok(!!atrBusc && atrBusc.p_buscador_codigo === "BRIKU-EUX" && atrBusc.p_pago === 4000, "S48-5e la atribución del buscador lleva su código y su pago con folio propio");
const atrErika = llamadasAtr.find(b => b.p_folio === "sensorv5-u-erika");
ok(!!atrErika && atrErika.p_tipo === "mia" && atrErika.p_pago === 6650, "S48-5f la atribución de Erika entra como mía por 6650");
w.cargarSensorMN(); await sleep(120);
const bandeja = w.sensorEstadoHtml();
ok(bandeja.includes("copia de la operadora"), "S48-5g la bandeja enseña la copia marcada como copia");
ok(bandeja.includes("todo entró organizado"), "S48-5h la bandeja cierra limpia: «todo entró organizado»");
ok(bandeja.includes("1.440 de saldo") && bandeja.includes("2.520 de saldo"), "S48-5i la bandeja lista los registros con su formato (1.440 y 2.520 de saldo)");

/* S48-6 · el servidor también deduplica: si la ingesta dice
   duplicado, el registro se marca y la op se cierra sin
   atribuir ni reintentar. */
const r6 = await w.ingerirLoteSensorMN(pieza("u-tarde", "2026-11-18T19:30:00.000Z", "", "Usted ha recibido 720.0 CUP del numero 5359999999.Saldo principal 16630.08 CUP, linea activa hasta 2027-10-03, vence 2028-03-31"));
ok(r6.nuevos === 1 && opsSensor().length === 1, "S48-6a la pieza tardía entra y encola");
MODO.ingresarDuplicadoPara = "u-tarde";
await w.despacharCola();
const tarde = await reg("u-tarde");
ok(tarde && tarde.duplicadoDe === "servidor" && tarde.sincronizado && opsSensor().length === 0, "S48-6b duplicado del servidor: marcado, cerrado y fuera de la cola");

/* S48-7 · el camión por la URL: arrancarSensorMN lee el
   fragmento, ingiere y limpia la barra. */
w.location.hash = "#sms=" + encodeURIComponent(pieza("u-hash", "2026-11-18T20:00:00.000Z", "", "Usted ha recibido 360.0 CUP del numero 5358888888.Saldo principal 16990.08 CUP, linea activa hasta 2027-10-03, vence 2028-03-31"));
w.arrancarSensorMN();
await sleep(300);
ok(!!(await reg("u-hash")), "S48-7a el payload del fragmento #sms= se ingiere al arrancar");
ok(!String(w.location.hash).includes("sms="), "S48-7b el fragmento se limpia de la URL tras ingerir");

console.log(`\nBANCO SENSOR v48 · Mi Negocio: ${pass} PASS · ${fail} FAIL`);
if (fail) { console.log("FALLOS:", fails.join(" | ")); process.exit(1); }
process.exit(0);

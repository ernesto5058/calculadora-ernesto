// Banco OUTBOX SMS (Mi Negocio v47 · SENSOR OFFLINE-FIRST · CHEQUEO 143):
// la atribución de recargas sin atribuir se guarda primero en el
// teléfono, drena sola al volver la conexión, jamás duplica (ni en
// la cola ni contra el servidor) y el rechazo real del servidor se
// enseña como aviso accionable en la propia sección.
// Mismo arnés que test-minegocio-banco.mjs: jsdom + fetch stub con
// modos (sinred / ok / duplicado / rechazo) pa la puerta de atribuir.
import { JSDOM } from "jsdom";
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "minegocio/index.html", "utf8");
let pass = 0, fail = 0; const fails = [];
function ok(cond, name) { if (cond) pass++; else { fail++; fails.push(name); console.log("FAIL:", name); } }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const MODO = { atribuir: "sinred" };
const llamadasAtr = []; // cuerpos de dinero_sms_atribuir, en orden
const fila9001 = { sms_id: 9001, monto: 360, contraparte: "5351111111", saldo_principal: 5000, recibido_en: "2026-11-18T15:00:00Z", posible_espera_id: null, posible_buscador: null };
const fila9002 = { sms_id: 9002, monto: 720, contraparte: "5352222222", saldo_principal: 5720, recibido_en: "2026-11-18T15:05:00Z", posible_espera_id: "esp-9002", posible_buscador: "BRIKU-EUX" };
const fila9004 = { sms_id: 9004, monto: 360, contraparte: "5354444444", saldo_principal: 6080, recibido_en: "2026-11-18T15:10:00Z", posible_espera_id: "esp-9004", posible_buscador: "BRIKU-EUX" };

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
      const rechaza = (msg, st) => Promise.resolve({ ok: false, status: st || 400, text: () => Promise.resolve(JSON.stringify({ message: msg })), json: () => Promise.resolve({ message: msg }) });
      const sinRed = () => Promise.reject(new Error("Failed to fetch"));
      if (u.includes("/rpc/")) {
        const fn = u.split("/rpc/")[1].split("?")[0];
        let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch (e) {}
        if (fn === "dinero_sms_atribuir") {
          llamadasAtr.push(body);
          if (MODO.atribuir === "sinred") return sinRed();
          if (MODO.atribuir === "okfalse") return json({ ok: false, motivo: "ese sms ya fue atribuido" });
          if (MODO.atribuir === "rechazo") return rechaza("la espera sugerida ya no esta abierta", 400);
          if (MODO.atribuir === "duplicado") return json({ ok: true, duplicado: true });
          return json({ ok: true });
        }
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
      if (u.includes("datos.json") || u.includes("ultimo.json")) return rechaza("404", 404);
      return json({});
    };
  }
});
const w = dom.window;
await sleep(600);

function opsSms(smsId) { return (w.state.cola || []).filter(a => a && (a.tipo === "smsAtribuir" || a.tipo === "smsDesatribuir") && String(a.smsId) === String(smsId)); }

/* OS-1 · guardar sin red: la op nace en el teléfono y SOBREVIVE en
   el estado persistido (cerrar y reabrir la app la encuentra). */
MODO.atribuir = "sinred";
w.encolar({ tipo: "smsAtribuir", smsId: 9001, tipoAtr: "mia", pago: 1000 });
await w.despacharCola();
ok(opsSms(9001).length === 1, "OS-1a sin red: la atribución queda en la cola del teléfono");
ok(opsSms(9001)[0] && opsSms(9001)[0].estado === "pendiente" && opsSms(9001)[0].intentos === 1, "OS-1b sin red: queda pendiente con su intento contado, sin perderse");
const persistida = JSON.parse(w.localStorage.getItem("minegocio_v1") || "{}");
ok((persistida.cola || []).filter(a => String(a.smsId) === "9001").length === 1, "OS-1c persistencia: la op vive en el estado guardado (sobrevive a cerrar la app)");

/* OS-2 · estado honesto en la sección: guardada en el teléfono, y
   la fila accionable se oculta mientras la op vive en la cola. */
w.sinAtribuirMN = { pendientes: [fila9001], atribuidas: [] };
const h2 = w.recargasSinAtribuirHtml();
ok(h2.includes("Guardada en este teléfono") && h2.includes("5351111111"), "OS-2a la sección enseña «Guardada en este teléfono» con su recarga");
ok(!h2.includes('data-smsabr="9001"'), "OS-2b la fila en cola no se ofrece dos veces pa atribuir");

/* OS-3 · cero duplicados por doble toque / doble vía. */
w.encolar({ tipo: "smsAtribuir", smsId: 9001, tipoAtr: "mia", pago: 1000 });
ok(opsSms(9001).length === 1, "OS-3a encolar dos veces el mismo SMS deja UNA op");
w.sinAtribuirMN = { pendientes: [fila9002], atribuidas: [] };
w.confirmarEsperaSmsMN(9002); w.confirmarEsperaSmsMN(9002);
await sleep(50);
ok(opsSms(9002).length === 1, "OS-3b doble toque en Confirmar (espera) deja UNA op");

/* OS-4 · al volver la conexión drena sola, con su folio = opId, y
   la marca «recién» queda pa enseñar el ya-subió. */
const folio9001 = opsSms(9001)[0].opId;
llamadasAtr.length = 0;
MODO.atribuir = "ok";
await w.despacharCola();
ok(opsSms(9001).length === 0 && opsSms(9002).length === 0, "OS-4a con red: la cola del Sensor drena completa");
ok(llamadasAtr.some(b => b.p_folio === folio9001), "OS-4b el folio que viaja es el opId de la op (dedupe del servidor por folio)");
ok(w.smsRecienMN["9001"] === true, "OS-4c la subida confirmada deja su marca «recién»");

/* OS-5 · «ya subió» visible en la sección con la fila asentada. */
w.sinAtribuirMN = { pendientes: [], atribuidas: [Object.assign({}, fila9001, { tipo: "mia", pago_cup: 1000 })] };
const h5 = w.recargasSinAtribuirHtml();
ok(h5.includes("Ya subió") && h5.includes("5351111111"), "OS-5 la sección enseña «Ya subió» con la recarga asentada");

/* OS-6 · el servidor responde «duplicado» (el folio ya entró):
   eso es ÉXITO, la op sale de la cola sin error. */
w.encolar({ tipo: "smsAtribuir", smsId: 9003, tipoAtr: "mia", pago: 1000 });
MODO.atribuir = "duplicado";
await w.despacharCola();
ok(opsSms(9003).length === 0, "OS-6 folio duplicado en el servidor = asentado, la op sale");

/* OS-7 · rechazo REAL del servidor: tras los intentos la op queda
   fallida CON EL MOTIVO de la puerta, visible y accionable. */
w.encolar({ tipo: "smsAtribuir", smsId: 9004, tipoAtr: "buscador", buscador: "BRIKU-EUX", posibleEsperaId: "esp-9004" });
MODO.atribuir = "rechazo";
await w.despacharCola(); await w.despacharCola(); await w.despacharCola();
const op9004 = opsSms(9004)[0];
ok(op9004 && op9004.estado === "fallida", "OS-7a rechazo persistente: la op queda fallida, no se pierde ni se traga");
ok(op9004 && /espera sugerida ya no esta abierta/.test(op9004.ultimoError || ""), "OS-7b el motivo real del servidor queda guardado en la op");
w.sinAtribuirMN = { pendientes: [fila9004], atribuidas: [] };
const h7 = w.recargasSinAtribuirHtml();
ok(h7.includes("No se pudo asentar") && h7.includes("espera sugerida ya no esta abierta"), "OS-7c la sección enseña el rechazo con el motivo del servidor");
ok(h7.includes("data-smsreintentar=") && h7.includes("data-smsdescartar="), "OS-7d el aviso es accionable: Reintentar y Quitar de la cola");

/* OS-8 · quitar de la cola devuelve la fila a la lista. */
w.descartarSmsOpMN(op9004.opId);
ok(opsSms(9004).length === 0, "OS-8a descartar saca la op de la cola");
const h8 = w.recargasSinAtribuirHtml();
ok(h8.includes('data-smsabr="9004"'), "OS-8b la recarga vuelve a ofrecerse pa atribuirla de otra forma");

/* OS-9 · reintentar tras el arreglo: resetea y sube. */
w.encolar({ tipo: "smsAtribuir", smsId: 9004, tipoAtr: "buscador", buscador: "BRIKU-EUX", posibleEsperaId: "esp-9004" });
await w.despacharCola(); await w.despacharCola(); await w.despacharCola();
const op9004b = opsSms(9004)[0];
ok(op9004b && op9004b.estado === "fallida", "OS-9a segunda vuelta: vuelve a fallida con el servidor caído");
MODO.atribuir = "ok";
w.reintentarSmsOpMN(op9004b.opId);
await sleep(300);
ok(opsSms(9004).length === 0, "OS-9b Reintentar resetea la op y la sube cuando el servidor ya acepta");

/* OS-10 · la cola procesa EN ORDEN de llegada. */
llamadasAtr.length = 0;
w.encolar({ tipo: "smsAtribuir", smsId: 9005, tipoAtr: "mia", pago: 1000 });
w.encolar({ tipo: "smsAtribuir", smsId: 9006, tipoAtr: "mia", pago: 2000 });
await w.despacharCola();
ok(llamadasAtr.length >= 2 && llamadasAtr[llamadasAtr.length - 2].p_sms_id === 9005 && llamadasAtr[llamadasAtr.length - 1].p_sms_id === 9006, "OS-10 el drenaje respeta el orden de la cola");

/* OS-11 · (supervisora v47) un 200 con ok:false NO es éxito: la op
   se queda en la cola con el motivo y NO nace un «Ya subió» falso. */
w.encolar({ tipo: "smsAtribuir", smsId: 9007, tipoAtr: "mia", pago: 1000 });
MODO.atribuir = "okfalse";
await w.despacharCola();
ok(opsSms(9007).length === 1 && opsSms(9007)[0].estado === "pendiente", "OS-11a 200 ok:false: la op NO sale de la cola");
ok(opsSms(9007)[0] && /ya fue atribuido/.test(opsSms(9007)[0].ultimoError || ""), "OS-11b 200 ok:false: el motivo queda como error de la op");
ok(w.smsRecienMN["9007"] !== true, "OS-11c 200 ok:false: no se marca «recién» (nada de Ya subió falso)");
MODO.atribuir = "ok";
await w.despacharCola();
ok(opsSms(9007).length === 0 && w.smsRecienMN["9007"] === true, "OS-11d al aceptar el servidor, la misma op sube y recién entonces se marca");

/* OS-12 · (supervisora v47) con el deshacer en cola, la sección no
   enseña «Ya subió» a la vez: la marca se apaga al encolar el deshacer. */
w.encolar({ tipo: "smsDesatribuir", smsId: 9007 });
ok(w.smsRecienMN["9007"] !== true, "OS-12a encolar el deshacer apaga la marca «recién» al momento");
w.sinAtribuirMN = { pendientes: [], atribuidas: [Object.assign({}, fila9001, { sms_id: 9007, tipo: "mia", pago_cup: 1000 })] };
w.smsRecienMN["9007"] = true; /* marca forzada: ni aun así debe pintarse con el deshacer en cola */
const h12 = w.recargasSinAtribuirHtml();
ok(!h12.includes("Ya subió") && h12.includes("Guardada en este teléfono"), "OS-12b con deshacer en cola solo se enseña el deshacer guardado, no el «Ya subió»");
await w.despacharCola();

/* OS-13 · (supervisora v47) segunda atribución distinta con una op
   viva: gana la PRIMERA (la que Ernesto confirmó primero) y la cola
   sigue con una sola op con su payload original. */
w.encolar({ tipo: "smsAtribuir", smsId: 9008, tipoAtr: "mia", pago: 1000 });
w.encolar({ tipo: "smsAtribuir", smsId: 9008, tipoAtr: "buscador", buscador: "BRIKU-EUX", pago: 2000 });
ok(opsSms(9008).length === 1 && opsSms(9008)[0].tipoAtr === "mia" && opsSms(9008)[0].pago === 1000, "OS-13 la primera confirmación manda: una op, payload original");

/* OS-14 · (supervisora R2) re-encolar sobre una op FALLIDA: sigue
   una sola op fallida y el aviso NO promete sincronización sola —
   enseña la salida (Reintentar / Quitar de la cola). */
MODO.atribuir = "rechazo";
w.encolar({ tipo: "smsAtribuir", smsId: 9009, tipoAtr: "mia", pago: 1000 });
await w.despacharCola(); await w.despacharCola(); await w.despacharCola();
ok(opsSms(9009)[0] && opsSms(9009)[0].estado === "fallida", "OS-14a preparación: la op de 9009 quedó fallida");
w.encolar({ tipo: "smsAtribuir", smsId: 9009, tipoAtr: "mia", pago: 1000 });
ok(opsSms(9009).length === 1 && opsSms(9009)[0].estado === "fallida", "OS-14b re-encolar sobre fallida: una op, sigue fallida (sin falsas promesas de drenaje)");
const toastTxt = (w.document.getElementById("toast") || {}).textContent || "";
ok(/no se pudo asentar/.test(toastTxt) && /Reintentar/.test(toastTxt), "OS-14c el aviso enseña la salida real: «no se pudo asentar… Reintentar o Quitar de la cola»");
w.descartarSmsOpMN(opsSms(9009)[0].opId);
MODO.atribuir = "ok";

console.log("\nBANCO OUTBOX SMS: " + pass + " PASS · " + fail + " FAIL");
if (fails.length) console.log("Fallos: " + fails.join(" · "));
w.close();
process.exit(fail ? 1 : 0);

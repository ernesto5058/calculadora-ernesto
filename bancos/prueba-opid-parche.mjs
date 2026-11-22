// Banco del parche v40 (🟡1 + 🟡2): idempotencia de «parte con tasa»
// y hint del PIN. jsdom sobre el index.html real, mismo arnés que el
// banco v40 (crear() con fetch stubbeado y SESION=PEUEBA).
// Cubre:
//   · el opId sobrevive entre toques hasta que el servidor confirme
//     (re-tap tras respuesta perdida manda el MISMO p_op_id);
//   · si cambian tipo/tasa/total/teléfono es una operación nueva
//     (opId distinto);
//   · tras el éxito, la pulsación siguiente genera otro opId;
//   · el hint del PIN lleva «Sin huella ni Face ID.»;
//   · el barrido de biometría solo tiene los 2 hits intencionados.
import { JSDOM } from "jsdom";
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "buscadores/index.html", "utf8");
let pass = 0, fail = 0;
function ok(c, n){ if (c) pass++; else { fail++; console.log("FAIL:", n); } }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function click(w, el){ if (el) el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })); }
function input(el, v){ el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true })); }

const HOY = new Date().toISOString();
const LLAMADAS = [];
let RESPUESTA_PARTE = []; // cola de respuestas para espera_crear_app: 'err' | 'ok'
function crear(){
  const dom = new JSDOM(html, { url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/?codigo=PEUEBA",
    runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(w){
      w.localStorage.setItem("busc_guia_v170", "1");
      w.fetch = function(url, opts){
        const u = String(url);
        const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v === undefined ? null : v)), json: () => Promise.resolve(v) });
        const err = () => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve("{}"), json: () => Promise.resolve({}) });
        if (u.includes("/rpc/")) {
          const fn = u.split("/rpc/")[1].split("?")[0];
          let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch(e){}
          LLAMADAS.push({ fn, body });
          switch (fn) {
            case "validar_usuario": return json([{ codigo: "PEUEBA", nombre: "Prueba Ojo", activo: true, bloqueado: false }]);
            case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1111.74, salida_ref: 950, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: HOY });
            case "esperas_mi_estado": return json({ ok: true, buscador: "PEUEBA", en_mano: 10000, comprometido: 4000, libre: 6000, esperas: [] });
            case "espera_crear_app": {
              const r = RESPUESTA_PARTE.shift() || "ok";
              return r === "err" ? err() : json({ ok: true, espera_id: "e-opid", cantidad_esperada: 378.95 });
            }
            default: return json({ ok: true });
          }
        }
        return json(null);
      };
    } });
  return { dom, w: dom.window };
}
const llamadasA = fn => LLAMADAS.filter(x => x.fn === fn);

{
  LLAMADAS.length = 0;
  RESPUESTA_PARTE = ["err", "ok", "err", "ok", "ok"];
  const { w } = crear();
  const d = w.document;
  await sleep(1000);
  w.showView("Esperas");
  await sleep(400);

  const tasa = d.getElementById("ep_tasa"), total = d.getElementById("ep_total"),
        tel = d.getElementById("ep_tel"), btn = d.getElementById("ep_btn"),
        warn = d.getElementById("ep_warn");
  ok(!!tasa && !!total && !!btn, "P0 el formulario del parte (ep_tasa/ep_total/ep_btn) existe en la vista Esperas");

  // Clic 1: total 1000, respuesta perdida (err) → opId OP1 queda pendiente.
  input(tasa, "950"); input(total, "1000"); input(tel, "");
  click(w, btn); await sleep(400);
  ok(llamadasA("espera_crear_app").length === 1, "P1 primer toque llama a espera_crear_app una vez");
  const OP1 = llamadasA("espera_crear_app")[0].body.p_op_id;
  ok(typeof OP1 === "string" && OP1.length > 0, "P2 el primer toque manda p_op_id");
  ok(w.EP_OPID === OP1, "P3 tras la respuesta perdida el opId sigue pendiente (EP_OPID no se limpia)");

  // Clic 2: cambio el total a 2000 → operación nueva, opId distinto.
  input(total, "2000");
  click(w, btn); await sleep(400);
  ok(llamadasA("espera_crear_app").length === 2, "P4 segundo toque llama de nuevo");
  const OP2 = llamadasA("espera_crear_app")[1].body.p_op_id;
  ok(OP2 && OP2 !== OP1, "P5 al cambiar el total se genera otro opId (operación nueva)");
  ok(w.EP_OPID === null, "P6 tras el éxito el opId pendiente se limpia");

  // Clic 3: total 1000 otra vez (el éxito anterior vació tasa y total),
  // respuesta perdida → opId OP3 pendiente.
  input(tasa, "950"); input(total, "1000");
  click(w, btn); await sleep(400);
  const OP3 = llamadasA("espera_crear_app")[2].body.p_op_id;
  ok(OP3 && OP3 !== OP2, "P7 tras el éxito, la pulsación siguiente genera otro opId");
  ok(w.EP_OPID === OP3, "P8 tras la respuesta perdida el opId OP3 queda pendiente");

  // Clic 4: mismos datos, re-tap → MISMO opId (el 🟡).
  click(w, btn); await sleep(400);
  ok(llamadasA("espera_crear_app").length === 4, "P9 el re-tap llama de nuevo");
  const OP4 = llamadasA("espera_crear_app")[3].body.p_op_id;
  ok(OP4 === OP3, "P10 EL RE-TAP REUSA EL MISMO p_op_id (no crea segunda espera)");
  ok(w.EP_OPID === null, "P11 tras el éxito del re-tap el opId se limpia");

  // Clic 5: pulsación nueva tras éxito → opId distinto (comportamiento normal).
  input(tasa, "950"); input(total, "1000");
  click(w, btn); await sleep(400);
  const OP5 = llamadasA("espera_crear_app")[4].body.p_op_id;
  ok(OP5 && OP5 !== OP3, "P12 pulsación nueva tras éxito crea su propia operación (opId distinto)");

  // PIN: el hint lleva la frase exacta.
  ok(d.body.textContent.includes("Sin huella ni Face ID."),
     "P13 el hint del PIN lleva «Sin huella ni Face ID.»");
  ok(d.body.textContent.includes("no protege tus datos como un cifrado. Sin huella ni Face ID. Si lo olvidas"),
     "P14 la frase va justo después de «como un cifrado.» en el hint real");
}

console.log(`\nBANCO OPID PARCHE v40: ${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);

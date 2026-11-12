import { JSDOM } from "/tmp/jsdomtest/node_modules/jsdom/lib/api.js";
import fs from "fs";
const html = fs.readFileSync("buscadores/index.html", "utf8");
const datos = JSON.parse(fs.readFileSync("buscadores/datos.json", "utf8"));
let n = 0, ok = 0;
function t(nombre, cond) { n++; if (cond) { ok++; console.log("PASS", nombre); } else console.log("FAIL", nombre); }
const dom = new JSDOM(html, { url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/", runScripts: "dangerously", pretendToBeVisual: true });
const w = dom.window;
// Capacitor nativo simulado + fetch falso (datos + RPC)
w.Capacitor = { isNativePlatform: () => true };
const llamadas = [];
w.fetch = (url, opts) => {
  llamadas.push(String(url));
  if (String(url).includes("datos.json")) return Promise.resolve({ ok: true, json: () => Promise.resolve(datos) });
  if (String(url).includes("registrar_reporte")) return Promise.resolve({ ok: true, json: () => Promise.resolve("uuid-rep-1") });
  if (String(url).includes("registrar_ayuda")) return Promise.resolve({ ok: true, json: () => Promise.resolve("uuid-ayu-1") });
  if (String(url).includes("estado_reportes")) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  if (String(url).includes("estado_ayudas")) return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
};
await new Promise(r => setTimeout(r, 700));
const d = w.document;
t("version visible 1.1.0", d.getElementById("verLab").textContent === "1.1.0");
t("existe pestana Ayuda", !!d.getElementById("tabAyuda"));
t("existe campo codigo en Reportar", !!d.getElementById("r_cod"));
t("existe campo codigo en Ayuda", !!d.getElementById("a_cod"));
t("boton WhatsApp con su numero", (d.querySelector("a.wapp") || {}).href?.includes("wa.me/5351231558"));
// calculos v2 intactos
d.getElementById("s_precio").value = "950"; d.getElementById("s_cant").value = "1";
d.getElementById("s_precio").dispatchEvent(new w.Event("input"));
t("comision saldo 950 = $35.66", d.getElementById("s_fee").textContent === "$35.66");
// reporte de trato sin codigo -> aviso
d.getElementById("tabRep").click();
d.getElementById("r_precio").value = "950"; d.getElementById("r_tel").value = "51234567";
d.getElementById("r_btn").click();
await new Promise(r => setTimeout(r, 300));
t("sin codigo: avisa", d.getElementById("r_warn").style.display === "block");
// con codigo -> se envia por la RPC nueva
d.getElementById("r_cod").value = "BUSCA-001";
d.getElementById("r_btn").click();
await new Promise(r => setTimeout(r, 900));
const ob = JSON.parse(w.localStorage.getItem("busc_outbox") || "[]");
t("reporte enviado via RPC (id guardado)", ob.length === 1 && ob[0].enviado === true && ob[0].id === "uuid-rep-1");
t("se llamo a registrar_reporte", llamadas.some(u => u.includes("rpc/registrar_reporte")));
// ayuda: vacia -> aviso; con texto -> enviada
d.getElementById("tabAyuda").click();
d.getElementById("a_btn").click();
await new Promise(r => setTimeout(r, 200));
t("ayuda vacia: avisa", d.getElementById("a_warn").style.display === "block");
d.getElementById("a_msg").value = "El boton de enviar no responde en mi telefono";
d.getElementById("a_btn").click();
await new Promise(r => setTimeout(r, 900));
const ay = JSON.parse(w.localStorage.getItem("busc_ayuda") || "[]");
t("ayuda enviada via RPC", ay.length === 1 && ay[0].enviado === true && ay[0].id === "uuid-ayu-1");
// banner de actualizacion: datos con versionApp mayor y nativo -> visible
datos.versionApp = "9.9.9"; datos.apkUrl = "https://ejemplo.com/app.apk";
// simula re-carga de datos llamando a loadData a traves de un evento online no existe; se invoca via evaluate
w.eval("loadData()");
await new Promise(r => setTimeout(r, 700));
t("banner de actualizacion visible con url", !d.getElementById("updBox").classList.contains("hide") && d.getElementById("updLink").getAttribute("href") === "https://ejemplo.com/app.apk");
console.log(`\nRESULTADO: ${ok}/${n}`);
process.exit(ok === n ? 0 : 1);

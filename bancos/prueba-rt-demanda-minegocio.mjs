// Sonda RT bajo demanda (Mi Negocio v46 · WEBPERF · CHEQUEO 141):
// supabase-js NO viaja en el cascarón; rtAsegurar() lo inyecta una sola
// vez en el primer uso del chat en vivo y degrada a null (refresco de
// 3 s) mientras no esté. Sin red real: jsdom sin recursos externos.
import { JSDOM } from "jsdom";
import fs from "fs";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
const html = fs.readFileSync(REPO + "minegocio/index.html", "utf8");
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) pass++; else { fail++; console.log("FAIL:", n); } };

ok(!/<script[^>]+src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/.test(html),
   "RT-0 el cascarón no trae el <script> del CDN de supabase-js en el head");

const dom = new JSDOM(html, { url: "https://ernesto5058.github.io/calculadora-ernesto/minegocio/", runScripts: "dangerously", pretendToBeVisual: true,
  beforeParse(w){
    w.fetch = () => Promise.reject(new Error("sin red en la sonda"));
    try { w.localStorage.setItem("minegocio_v1", JSON.stringify({ codigo: "SONDA", foto: { reportes: [], ayudas: [], usuarios: [], datos: null, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {} })); } catch(e){}
  }});
const w = dom.window;
await new Promise(r => setTimeout(r, 600));
ok(typeof w.rtAsegurar === "function", "RT-1 rtAsegurar existe");
ok(w.supabase === undefined, "RT-2 sin supabase al arrancar (cascarón limpio)");
ok(w.document.querySelectorAll('script[src*="supabase-js"]').length === 0, "RT-3 ningún script de supabase-js antes del primer uso");
let cli = "sin-llamar";
try { cli = w.rtAsegurar(); } catch(e){ ok(false, "RT-4 rtAsegurar no explota sin CDN: " + e.message); }
ok(cli === null, "RT-4 rtAsegurar devuelve null sin CDN (degrada, no rompe)");
const inyectados = w.document.querySelectorAll('script[src*="supabase-js"]');
ok(inyectados.length === 1, "RT-5 se inyectó UNA sola vez el CDN (van " + inyectados.length + ")");
ok(inyectados.length && inyectados[0].src.includes("@supabase/supabase-js@2.45.4"), "RT-6 URL fijada 2.45.4, la misma de antes");
try { w.rtAsegurar(); } catch(e){}
ok(w.document.querySelectorAll('script[src*="supabase-js"]').length === 1, "RT-7 segunda llamada NO duplica la inyección");
try { w.rtSuscribir("BUSC-1"); w.rtTimbre("BUSC-1"); ok(true, "RT-8 rtSuscribir/rtTimbre sin cliente no explotan"); }
catch(e){ ok(false, "RT-8 rt* sin cliente explotó: " + e.message); }
let creado = 0;
w.supabase = { createClient(){ creado++; return { channel(){ return { on(){ return this; }, subscribe(){}, send(){ return Promise.resolve(); } }; }, removeChannel(){} }; } };
const s = w.document.querySelector('script[src*="supabase-js"]');
if (s && s.onload) s.onload();
await new Promise(r => setTimeout(r, 100));
ok(creado === 1, "RT-9 tras cargar el CDN el cliente se crea (onload → rtAsegurar)");
const cli2 = w.rtAsegurar();
ok(!!cli2 && creado === 1, "RT-10 el cliente queda en caché (no se recrea)");
console.log(`SONDA RT BAJO DEMANDA · MI NEGOCIO: ${pass} PASS · ${fail} FAIL`);
process.exit(fail ? 1 : 0);

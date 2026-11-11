// Banco TP — capa «identidad y comportamiento PRO» del bot de Telegram.
// Prueba el módulo compartido y las DOS Edge Functions con fetch
// simulado (sin red, sin token, sin Supabase real):
//   Versión CI (bancos/): importa las funciones por rutas relativas al repo
//   (la local, en research_notes, apunta a ../github-calculadora/...).
import * as pro from "../supabase/functions/_shared/telegram-pro.ts";
import { manejar as webhook } from "../supabase/functions/telegram-webhook/index.ts";
import { manejar as emisora } from "../supabase/functions/avisos/index.ts";

let n = 0, fallos = 0;
function ok(cond, nombre) {
  n++;
  if (cond) console.log("TP-" + n + " ok  " + nombre);
  else { fallos++; console.log("TP-" + n + " FALLO  " + nombre); }
}

/* ---------- estado simulado ---------- */
const VINCULOS = { "999": "ADMIN", "222": "SOCIO-TEST" }; // chatId -> codigo
let decidirResp = { ok: true };
let tgEstado = 200;
let tgCalls = [];
let rpcCalls = [];
const updatesVistos = new Set();

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const body = opts.body ? JSON.parse(opts.body) : {};
  if (u.includes("api.telegram.org")) {
    const metodo = u.split("/").pop();
    tgCalls.push({ metodo, cuerpo: body });
    return new Response(JSON.stringify({ ok: tgEstado < 300 }), { status: tgEstado });
  }
  if (u.includes("/rest/v1/rpc/")) {
    const fn = u.split("/rpc/")[1];
    rpcCalls.push({ fn, body });
    if (fn === "registrar_actividad") return new Response(null, { status: 204 });
    if (fn === "vincular_telegram_token") return resp({ ok: true, codigo: "SOCIO-TEST" });
    if (fn === "vincular_telegram_codigo") return resp({ ok: true, codigo: "SOCIO-TEST" });
    if (fn === "admin_decidir_telegram") return resp(decidirResp);
    return resp({});
  }
  if (u.includes("/rest/v1/telegram_updates")) {
    if (updatesVistos.has(body.update_id)) return new Response("dup", { status: 409 });
    updatesVistos.add(body.update_id);
    return new Response("", { status: 201 });
  }
  if (u.includes("/rest/v1/avisos_config")) {
    if (u.includes("telegram_chat_id=eq.")) {
      const chat = decodeURIComponent(u.split("telegram_chat_id=eq.")[1].split("&")[0]);
      return resp(VINCULOS[chat] ? [{ codigo: VINCULOS[chat] }] : []);
    }
    if (u.includes("not.is.null")) return resp(Object.keys(VINCULOS).map((c) => ({ codigo: VINCULOS[c] })));
    return resp([{ telegram_chat_id: "999", telegram_user_id: "555" }]); // fila ADMIN
  }
  if (u.includes("/rest/v1/perfiles")) return resp([{ nombre: "Socio Uno" }]);
  if (u.includes("/rest/v1/push_subs")) return resp([]);
  return new Response("no mock", { status: 404 });
};
function resp(json) {
  return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
}

const ENV = (k) => ({
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "srv",
  TELEGRAM_BOT_TOKEN: "token-de-prueba",
  TELEGRAM_WEBHOOK_SECRET: "whsec",
  AVISOS_WEBHOOK_SECRET: "avsec",
}[k]);

function reqWebhook(update) {
  return new Request("https://x.supabase.co/functions/v1/telegram-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-telegram-bot-api-secret-token": "whsec" },
    body: JSON.stringify(update),
  });
}
function msg(chatId, text, updateId) {
  return { update_id: updateId, message: { chat: { id: chatId, type: "private" }, from: { id: 555 }, text } };
}
const envios = () => tgCalls.filter((c) => c.metodo === "sendMessage");

/* ---------- 1) Identidad ---------- */
ok(pro.DESCRIPCION_LARGA.length <= 512, "descripción larga ≤512 (" + pro.DESCRIPCION_LARGA.length + ")");
ok(pro.ABOUT_CORTO.length <= 120, "about corto ≤120 (" + pro.ABOUT_CORTO.length + ")");
ok(pro.COMANDOS.map((c) => c.command).join(",") === "start,vincular,ayuda,estado", "comandos oficiales: start/vincular/ayuda/estado");

/* ---------- 2) Formato ---------- */
ok(pro.esc("<a&b>") === "&lt;a&amp;b&gt;", "esc() escapa < > &");
ok(pro.miles(5000) === "5 000" && pro.miles(360) === "360", "miles con espacio");
ok(pro.dinero(1098.68) === "1 098,68" && pro.dinero(950) === "950", "dinero con miles y decimales solo si hay");
ok(pro.horaPared(new Date()).startsWith("hoy "), "horaPared en hora de pared («hoy …»)");

/* ---------- 3) Plantillas ---------- */
const rep = pro.plReporteNuevo({ nombre: "Socio Uno", tipo: "saldo", cantidad: 5000, precio: 2.2 });
ok(rep.html.startsWith("<b>📋 Reporte nuevo</b>"), "reporte: título con un emoji y negrita");
ok(rep.html.includes("<b>De:</b> Socio Uno") && rep.html.includes("5 000") && rep.html.includes("CUP"), "reporte: etiquetas en negrita, miles y moneda");
ok(rep.cuerpo.includes("De: Socio Uno") && !rep.cuerpo.includes("<b>"), "reporte: versión push en plano");
ok(pro.plMensaje({ nombre: "<b>intruso</b>" }).html.includes("&lt;b&gt;intruso"), "plantillas escapan datos dinámicos");
ok(pro.lineaDecision(true).startsWith("✅ Aprobado por ti · hoy"), "línea de decisión final con hora de pared");
ok(pro.plVinculoRoto({ nombre: "Socio Uno" }).titulo.includes("Vínculo de Telegram roto"), "plantilla vínculo roto (aviso interno)");
ok(pro.plRechazado({ motivo: "Precio fuera de tarifa" }).html.includes("<b>Motivo:</b>"), "rechazado con motivo opcional");

/* ---------- 4) Webhook: roles ---------- */
tgCalls = [];
await webhook(reqWebhook(msg(111, "/start", 1)), ENV);
ok(envios().length === 1 && envios()[0].cuerpo.text === pro.BIENVENIDA_NO_VINCULADO, "desconocido en /start: bienvenida de bot privado");
ok(envios()[0].cuerpo.parse_mode === "HTML", "mensajes en HTML simple");

tgCalls = [];
await webhook(reqWebhook(msg(111, "/start TOK123", 2)), ENV);
ok(envios()[0].cuerpo.text.includes("Hola, Socio Uno.") && envios()[0].cuerpo.text.includes("Mi Trabajo"), "/start con token: bienvenida de buscador vinculado");

tgCalls = [];
await webhook(reqWebhook(msg(222, "hola, ¿qué tal?", 3)), ENV);
ok(envios()[0].cuerpo.text === pro.LIBRE_BUSCADOR, "texto libre de buscador: redirigido a su app");

tgCalls = [];
await webhook(reqWebhook(msg(222, "/estado", 4)), ENV);
ok(envios()[0].cuerpo.text.includes("solo de Ernesto"), "/estado de un buscador: solo dueño");

tgCalls = [];
await webhook(reqWebhook(msg(999, "/estado", 5)), ENV);
ok(envios()[0].cuerpo.text.includes("Estado del bot") && envios()[0].cuerpo.text.includes("Cuentas vinculadas:</b> 2"), "/estado del dueño: resumen con vínculos");

tgCalls = [];
await webhook(reqWebhook(msg(111, "¿vendes saldo?", 6)), ENV);
ok(envios()[0].cuerpo.text === pro.BIENVENIDA_NO_VINCULADO, "texto libre de desconocido: respuesta única cortés y fin");

/* ---------- 5) Webhook: deduplicación ---------- */
tgCalls = [];
await webhook(reqWebhook(msg(111, "/ayuda", 77)), ENV);
const primera = envios().length;
const rDup = await webhook(reqWebhook(msg(111, "/ayuda", 77)), ENV);
const dupJson = await rDup.json();
ok(primera === 1 && envios().length === 1 && dupJson.duplicado === true, "update_id repetido: no se procesa dos veces");

/* ---------- 6) Webhook: botones ---------- */
// Los callbacks de decidir llevan el UUID del reporte (reparación v2:
// reportes.id es uuid y el parser RE_DECIDIR solo acepta esa forma;
// con un id numérico el botón se descarta como «no válido»).
function callback(chatId, userId, data, textoMsg, updateId) {
  return {
    update_id: updateId,
    callback_query: {
      id: "cq" + updateId, data, from: { id: userId },
      message: { message_id: 10, chat: { id: chatId, type: "private" }, text: textoMsg },
    },
  };
}
tgCalls = []; rpcCalls = [];
decidirResp = { ok: true };
await webhook(reqWebhook(callback(999, 555, "d:00000000-0000-4000-8000-000000000042:a", "📋 Reporte nuevo\nDe: Socio Uno", 90)), ENV);
const edit = tgCalls.find((c) => c.metodo === "editMessageText");
ok(!!edit && !edit.cuerpo.reply_markup && edit.cuerpo.text.includes("✅ Aprobado por ti · hoy"), "botón ✅: mensaje editado a estado final SIN botones");
ok(rpcCalls.some((c) => c.fn === "admin_decidir_telegram"), "la decisión pasa por la puerta idempotente");

tgCalls = [];
decidirResp = { ok: false, ya_decidido: true, estado: "aprobado" };
await webhook(reqWebhook(callback(999, 555, "d:00000000-0000-4000-8000-000000000042:r", "📋 Reporte nuevo", 91)), ENV);
const edit2 = tgCalls.find((c) => c.metodo === "editMessageText");
ok(!!edit2 && edit2.cuerpo.text.includes("Ya estaba decidido (aprobado)"), "botón sobre reporte ya decidido: no re-decide, lo anota");

tgCalls = []; rpcCalls = [];
await webhook(reqWebhook(callback(777, 777, "d:00000000-0000-4000-8000-000000000042:a", "📋 Reporte nuevo", 92)), ENV);
ok(!rpcCalls.some((c) => c.fn === "admin_decidir_telegram") && tgCalls.some((c) => c.metodo === "answerCallbackQuery"), "botón de un intruso: rechazado sin tocar la puerta");

/* ---------- 7) Emisora: plantillas y 403 ---------- */
function reqAvisos(evento) {
  return new Request("https://x.supabase.co/functions/v1/avisos", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secreto: "avsec", ...evento }),
  });
}
tgCalls = []; tgEstado = 200;
await emisora(reqAvisos({ para: "ADMIN", tipo: "reporte", reporte_id: "00000000-0000-4000-8000-000000000042", nombre: "Socio Uno", tipo_reporte: "saldo", cantidad: 5000, precio: 2.2 }), ENV);
const envioRep = envios()[0];
ok(!!envioRep && envioRep.cuerpo.text.startsWith("<b>📋 Reporte nuevo</b>") && envioRep.cuerpo.parse_mode === "HTML", "emisora: reporte al dueño en HTML de plantilla");
ok(envioRep.cuerpo.reply_markup.inline_keyboard[0][0].callback_data === "d:00000000-0000-4000-8000-000000000042:a", "botones con callback_data opaco solo-id");

tgCalls = []; rpcCalls = []; tgEstado = 403;
const r403 = await emisora(reqAvisos({ para: "ADMIN", tipo: "tarifa", ingreso: 1098.68 }), ENV);
const j403 = await r403.json();
const filaTg = j403.resultados.find((r) => r.canal === "telegram");
ok(filaTg && filaTg.bloqueado === true, "emisora: 403 detectado como vínculo roto");
ok(rpcCalls.some((c) => c.fn === "registrar_actividad" && c.body.p_accion === "telegram_vinculo_roto"), "vínculo roto registrado en actividad");
tgEstado = 200;

console.log("\n=== " + (n - fallos) + "/" + n + " pruebas TP en verde ===");
process.exit(fallos ? 1 : 0);

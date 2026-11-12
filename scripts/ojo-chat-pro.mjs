// OJO CHAT PRO — CAZA EN VIVO (orden de Ernesto, 2026-11-12:
// «no fotos solamente»: hay que moverse por la app y cazar la
// interacción funcionando). Chromium real (Playwright, Pixel 7):
//   · MI NEGOCIO (build local del repo, red SIMULADA con la misma
//     fixture de los bancos y cuenta de prueba del robot — el
//     código del dueño no viaja): entra al chat, ESCRIBE en el
//     compositor con el teclado mientras el refresco de 3 s corre
//     y un mensaje nuevo llega a mitad de la caza; muestrea
//     activeElement/valor/selección cada segundo (la evidencia) y
//     exige que el foco y el texto sobrevivan a 2+ ciclos. Abre la
//     hoja 📎, elige una foto de verdad (filechooser) y fotografía
//     el editor. En Textos: producto → saldo → transferencia,
//     verificando que el formulario se cierra y la salida nace.
//   · MI TRABAJO (sitio PUBLICADO, red real, cuenta PEUEBA): la
//     misma caza de foco contra el backend vivo + hoja + editor, y
//     puerta de versión: APP_VERSION tiene que ser la nueva.
// Álbum: ojo-web/chat-pro/ con fotos, evidencia.txt y veredicto.
import { chromium } from "playwright";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALBUM = path.join(RAIZ, "ojo-web", "chat-pro");
fs.mkdirSync(ALBUM, { recursive: true });
const ev = [];
const fallos = [];
function log(s){ ev.push(s); console.log(s); }
function ok(c, n){ log((c ? "OK   " : "FALLO ") + n); if (!c) fallos.push(n); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- servidor local para el build del repo ---------- */
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
const servidor = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(RAIZ, p);
  if (!file.startsWith(RAIZ) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("no"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => servidor.listen(8901, r));

/* ---------- foto de prueba ---------- */
const PNG64 = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=";
const fotoPath = "/tmp/ojo-foto.png";
fs.writeFileSync(fotoPath, Buffer.from(PNG64, "base64"));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36", hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on("pageerror", e => log("pageerror: " + String(e).slice(0, 160)));

/* ================= MI NEGOCIO — red simulada ================= */
log("=== MI NEGOCIO v12 (build local, red simulada, cuenta de prueba) ===");
try {
const datosMN = { version: 4, versionApp: "1.3.1", apkUrl: "https://example.invalid/apk", tarifa: { version: 4, ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, bonoSaldoRecargas: 150, bonoSaldoCUP: 300, bonoTransfTratos: 10, bonoTransfCUP: 300 }, buscadores: [{ codigo: "BUSC-1", nombre: "Busc Uno", tratos: [] }] };
let msgsMN = [{ id: "m1", de: "BUSC-1", para: "ADMIN", texto: "hola, ¿me confirmas el trato?", creado: new Date(Date.now() - 60000).toISOString(), leido: false }];
const t0MN = Date.now();
await page.route("**/rest/v1/rpc/**", async route => {
  const u = route.request().url();
  const fn = u.split("/rpc/")[1].split("?")[0];
  const json = v => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(v === undefined ? null : v) });
  switch (fn) {
    case "ver_presencia": return json({ ok: true, usuarios: [{ codigo: "BUSC-1", nombre: "Busc Uno", visto: new Date().toISOString() }] });
    case "mensajes_sin_leer": return json({ ok: true, por_usuario: {}, total: 0 });
    case "leer_chat": {
      /* a mitad de la caza llega un mensaje nuevo de verdad */
      if (Date.now() - t0MN > 9000 && !msgsMN.some(m => m.id === "m2")) msgsMN = msgsMN.concat([{ id: "m2", de: "BUSC-1", para: "ADMIN", texto: "mensaje que llega mientras escribes", creado: new Date().toISOString(), leido: false }]);
      return json({ ok: true, mensajes: msgsMN });
    }
    case "leer_perfil": return json(null);
    case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 950, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: "2026-11-12 08:00" });
    case "admin_usuarios": return json([{ codigo: "BUSC-1", nombre: "Busc Uno", activo: true }]);
    default: return json(fn.startsWith("admin_") ? [] : { ok: true });
  }
});
await page.route("**/datos.json*", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(datosMN) }));
await page.route("**/ultimo.json*", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ts: new Date().toISOString(), ETECSA: { average: 304.86 }, BANK_CUP: { average: 1068.44 } }) }));
await page.route("**cdn.jsdelivr.net**", route => route.fulfill({ status: 200, contentType: "text/javascript", body: "/* supabase-js neutralizado por el Ojo: el timbre degrada al refresco de 3 s, que es lo que se caza */" }));
await page.addInitScript(pre => { try { localStorage.setItem("minegocio_v1", JSON.stringify(pre)); } catch (e) {} },
  { codigo: "CODIGO-PRUEBA", foto: { reportes: [], ayudas: [], usuarios: [{ codigo: "BUSC-1", nombre: "Busc Uno", activo: true }], datos: datosMN, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null });
await page.goto("http://localhost:8901/minegocio/", { waitUntil: "networkidle" }).catch(() => {});
await sleep(1500);
const verMN = await page.evaluate(() => window.MN_VERSION || "?");
log("MN_VERSION en el build cazado: " + verMN);
ok(verMN === "v12", "MN-1 el build cazado es la v12");
await page.evaluate(() => { [...document.querySelectorAll(".tab")].forEach(t => { if (t.textContent.includes("Equipo")) t.click(); }); });
await sleep(600);
await page.click("[data-chat]");
await page.waitForSelector("#chTexto", { timeout: 15000 });
await sleep(800);
/* — la caza de foco: escribir mientras el refresco corre — */
await page.click("#chTexto");
await page.keyboard.type("escribiendo en vivo", { delay: 35 });
const muestrasMN = [];
for (let i = 0; i < 10; i++) {
  await sleep(1000);
  const m = await page.evaluate(() => { const tx = document.getElementById("chTexto"); return { activo: document.activeElement && (document.activeElement.id || document.activeElement.tagName), valor: tx ? tx.value : null, sel: tx ? tx.selectionStart : null, nodo: tx ? tx.isConnected : false, burbujas: document.querySelectorAll("#chHilo .msgP").length }; });
  muestrasMN.push(m);
  log("MN t+" + (i + 1) + "s · activeElement=" + m.activo + " · valor=\"" + m.valor + "\" · sel=" + m.sel + " · nodoConectado=" + m.nodo + " · burbujas=" + m.burbujas);
}
ok(muestrasMN.every(m => m.activo === "chTexto" && m.valor === "escribiendo en vivo" && m.nodo), "MN-2 FOCO VIVO: 10 muestras (10 s, 3+ ciclos de refresco) con el compositor enfocado y el texto íntegro");
/* el mensaje inyectado a mitad de la caza se espera SIN tocar nada
   más (la aserción original lo medía en el borde de un ciclo y
   cazó un falso rojo por ~1 s; el aterrizaje es cosa de la app) */
try {
  await page.waitForFunction(() => document.querySelectorAll("#chHilo .msgP").length >= 2, null, { timeout: 12000 });
  const trasLlegada = await page.evaluate(() => { const tx = document.getElementById("chTexto"); return { activo: document.activeElement && document.activeElement.id, valor: tx ? tx.value : null }; });
  log("MN tras la llegada · activeElement=" + trasLlegada.activo + " · valor=\"" + trasLlegada.valor + "\"");
  ok(trasLlegada.activo === "chTexto" && trasLlegada.valor === "escribiendo en vivo", "MN-3 el mensaje que llegó durante la caza se pintó SIN tocar al compositor (foco y texto vivos tras la llegada)");
} catch (e) { ok(false, "MN-3 el mensaje que llegó durante la caza se pintó — no aterrizó en 12 s"); }
await page.screenshot({ path: path.join(ALBUM, "01-mn-compositor-escribiendo.png") });
/* — la hoja 📎 con archivo real — */
await page.click("#chClip");
await page.waitForSelector("#chAdjHoja.abierta", { timeout: 5000 });
await page.screenshot({ path: path.join(ALBUM, "02-mn-hoja-adjuntos.png") });
ok(true, "MN-4 la hoja de adjuntos abrió con un toque");
const [fcMN] = await Promise.all([page.waitForEvent("filechooser", { timeout: 8000 }), page.click("#chAdjFoto")]);
await fcMN.setFiles(fotoPath);
await page.waitForSelector("#editorFoto.abierto", { timeout: 8000 });
await sleep(400);
await page.screenshot({ path: path.join(ALBUM, "03-mn-editor-foto.png") });
ok(true, "MN-5 la foto elegida en la hoja abrió el editor a pantalla completa");
await page.click("#edFotoX");
await sleep(300);
/* — Textos: producto → saldo → transferencia — */
await page.evaluate(() => { document.querySelectorAll(".tab").forEach(t => { if (t.textContent.includes("Textos")) t.click(); }); });
await page.waitForSelector("#txProdBtn", { timeout: 10000 });
await sleep(400);
await page.click("#txProdBtn");
await sleep(300);
const formVisible = await page.evaluate(() => document.getElementById("txProdForm").style.display === "block");
ok(formVisible, "MN-6 Textos: «Texto de producto» abre su formulario");
await page.screenshot({ path: path.join(ALBUM, "04-mn-textos-producto.png") });
await page.click("#txSaldo");
await sleep(500);
const trasSaldo = await page.evaluate(() => ({ form: document.getElementById("txProdForm").style.display, out: document.getElementById("txOut").textContent.length }));
ok(trasSaldo.form === "none" && trasSaldo.out > 200, "MN-7 Textos: producto → saldo CIERRA el formulario y genera el texto (" + trasSaldo.out + " caracteres) — D1 cazado en vivo");
await page.screenshot({ path: path.join(ALBUM, "05-mn-textos-saldo.png") });
await page.click("#txProdBtn");
await sleep(250);
await page.click("#txTransf");
await sleep(500);
const trasTransf = await page.evaluate(() => ({ form: document.getElementById("txProdForm").style.display, out: document.getElementById("txOut").textContent.length }));
ok(trasTransf.form === "none" && trasTransf.out > 100, "MN-8 Textos: producto → transferencia también vuelve (formulario cerrado, texto generado)");
await page.screenshot({ path: path.join(ALBUM, "06-mn-textos-transferencia.png") });
await page.unrouteAll({ behavior: "wait" }).catch(() => {});

/* ================= MI TRABAJO — sitio publicado, red real ================= */
} catch (e) { ok(false, "MN caza interrumpida: " + String(e).slice(0, 200)); }
log("=== MI TRABAJO v1.5.0 (sitio publicado, red real, cuenta PEUEBA) ===");
const page2 = await ctx.newPage();
page2.on("pageerror", e => log("pageerror MT: " + String(e).slice(0, 160)));
await page2.goto("https://ernesto5058.github.io/calculadora-ernesto/buscadores/?codigo=PEUEBA", { waitUntil: "networkidle" }).catch(() => {});
await sleep(2000);
let verMT = await page2.evaluate(() => window.APP_VERSION || "?");
for (let i = 0; i < 24 && verMT !== "1.5.0"; i++) { await sleep(10000); await page2.reload({ waitUntil: "networkidle" }).catch(() => {}); verMT = await page2.evaluate(() => window.APP_VERSION || "?"); }
log("APP_VERSION publicado: " + verMT);
ok(verMT === "1.5.0", "MT-1 la versión publicada ya es la 1.5.0");
/* El desbloqueo con PEUEBA es una ida y vuelta real al backend y
   su latencia varía: se espera con paciencia y diagnóstico (la
   primera corrida murió a los 20 s con la barra aún oculta por la
   puerta de entrada, sin que la app tuviera ningún fallo). */
let mtListo = false;
for (let i = 0; i < 30 && !mtListo; i++) {
  const est = await page2.evaluate(() => {
    const t = document.querySelector('.tabbar [data-view="ayuda"]');
    return { visible: !!t && t.offsetParent !== null, sesion: (typeof window.SESION !== "undefined" ? window.SESION : null) };
  }).catch(() => ({ visible: false, sesion: null }));
  log("MT desbloqueo " + (i + 1) + "/30 · tabVisible=" + est.visible + " · SESION=" + est.sesion);
  if (est.visible) mtListo = true; else await sleep(3000);
}
ok(mtListo, "MT-1b la app se desbloqueó con PEUEBA y la barra inferior quedó visible");
try { if (verMT === "1.5.0" && mtListo) {
  await page2.click('.tabbar [data-view="ayuda"]');
  await page2.waitForSelector("#c_txt", { timeout: 20000 });
  await sleep(2500);
  await page2.click("#c_txt");
  await page2.keyboard.type("escribiendo en vivo", { delay: 35 });
  const muestrasMT = [];
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    const m = await page2.evaluate(() => { const tx = document.getElementById("c_txt"); return { activo: document.activeElement && (document.activeElement.id || document.activeElement.tagName), valor: tx ? tx.value : null, sel: tx ? tx.selectionStart : null, nodo: tx ? tx.isConnected : false }; });
    muestrasMT.push(m);
    log("MT t+" + (i + 1) + "s · activeElement=" + m.activo + " · valor=\"" + m.valor + "\" · sel=" + m.sel + " · nodoConectado=" + m.nodo);
  }
  ok(muestrasMT.every(m => m.activo === "c_txt" && m.valor === "escribiendo en vivo" && m.nodo), "MT-2 FOCO VIVO contra el backend real: 10 muestras (10 s, 3+ ciclos) con foco y texto íntegros");
  await page2.screenshot({ path: path.join(ALBUM, "07-mt-compositor-escribiendo.png") });
  await page2.click("#c_clip");
  await page2.waitForSelector("#c_adj_hoja.abierta", { timeout: 5000 });
  await page2.screenshot({ path: path.join(ALBUM, "08-mt-hoja-adjuntos.png") });
  ok(true, "MT-3 la hoja de adjuntos abrió con un toque");
  const [fcMT] = await Promise.all([page2.waitForEvent("filechooser", { timeout: 8000 }), page2.click("#c_adj_foto")]);
  await fcMT.setFiles(fotoPath);
  await page2.waitForSelector("#editorFoto.abierto", { timeout: 8000 });
  await sleep(400);
  await page2.screenshot({ path: path.join(ALBUM, "09-mt-editor-foto.png") });
  ok(true, "MT-4 la foto elegida abrió el editor a pantalla completa");
  await page2.click("#edFotoXMT");
}

} catch (e) { ok(false, "MT caza interrumpida: " + String(e).slice(0, 200)); }
const veredicto = fallos.length === 0 ? "VERDE" : (fallos.length <= 2 ? "PARCIAL" : "ROJO");
log("VEREDICTO OJO CHAT PRO: " + veredicto + (fallos.length ? " — fallos: " + fallos.join(" · ") : ""));
fs.writeFileSync(path.join(ALBUM, "evidencia.txt"), ev.join("\n") + "\n");
const fotos = fs.readdirSync(ALBUM).filter(f => f.endsWith(".png")).sort();
fs.writeFileSync(path.join(ALBUM, "index.html"),
  "<!doctype html><meta charset=utf-8><title>Ojo Chat PRO</title><h1>Ojo Chat PRO — caza en vivo · " + veredicto + "</h1>"
  + "<p>Mi Negocio: build local con red simulada y cuenta de prueba del robot (el código del dueño no viaja). Mi Trabajo: sitio publicado, red real, cuenta PEUEBA. La caza escribe de verdad en el compositor durante los ciclos de refresco de 3 s; el registro ciclo a ciclo está en <a href='evidencia.txt'>evidencia.txt</a>.</p>"
  + fotos.map(f => "<figure><img src='" + f + "' style='max-width:412px;width:100%'><figcaption>" + f + "</figcaption></figure>").join(""));
await browser.close();
servidor.close();
process.exit(fallos.length ? 1 : 0);

// Copia para CI (GitHub Actions) del banco vivo en research_notes — mismos chequeos,
// solo cambian las rutas: jsdom por nombre y la raíz del repo se resuelve desde este archivo
// (o la variable BANCO_REPO). Si el banco vivo cambia, se refresca esta copia.
import { JSDOM } from "jsdom";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
const HOME = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/$/, "");
const html = fs.readFileSync(HOME + "/buscadores/index.html", "utf8");
let pass = 0, fail = 0; const fails = [];
function ok(c, n){ if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const COD = "BUSC-1";
const hoyISO = new Date().toISOString();
function datosFixture(){
  return { version: 4, versionApp: "1.4.5", apkUrl: "https://example.invalid/apk",
    tarifa: { version: 4, ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, bonoSaldoMeta: 150, bonoSaldoMonto: 300, bonoTransfMeta: 10, bonoTransfMonto: 300 },
    publico: { telefono: "51231558", zona: "Micro 10, distrito José Martí, Santiago de Cuba", domicilio: "Domicilio gratis en Santiago de Cuba",
      saldo: { tasa: 2, tasaAlta: 2.2, desdeAlta: 5000, recarga: 720 } },
    buscadores: { "BUSC-1": { nombre: "Busc Uno", tratos: [] } }, actualizado: "2026-11-11" };
}
let llamadas = [], cuerpos = {};
function stubPush(cfg){
  const listeners = {};
  const calls = { req: 0, reg: 0 };
  /* Modelo fiel de la plataforma: tras pedir el permiso, el estado
     consultable pasa a ser el resultado del diálogo. */
  let actual = cfg.receive;
  const PN = {
    checkPermissions: () => Promise.resolve({ receive: actual }),
    requestPermissions: () => { calls.req++; actual = cfg.requestResult || actual; return Promise.resolve({ receive: actual }); },
    register: () => { calls.reg++;
      setTimeout(() => {
        const ev = cfg.regMode === "error" ? "registrationError" : "registration";
        (listeners[ev] || []).forEach(cb => cb(cfg.regMode === "error" ? {} : { value: cfg.token || "TOK-145" }));
      }, 30);
    },
    addListener: (ev, cb) => { (listeners[ev] = listeners[ev] || []).push(cb); return Promise.resolve({ remove: () => {} }); },
  };
  return { PN, calls, listeners };
}
function crear(opts){
  opts = opts || {};
  llamadas = []; cuerpos = {};
  const datos = datosFixture();
  const dom = new JSDOM(html, { url: opts.url || "https://ernesto5058.github.io/calculadora-ernesto/buscadores/", runScripts: "dangerously", pretendToBeVisual: true, beforeParse(w){
    if (opts.previa !== false) w.localStorage.setItem("busc_codigo", COD);
    w.prompt = () => "texto editado";
    w.confirm = () => true;
    if (opts.cap) w.Capacitor = opts.cap;
    w.fetch = function(url, opts2){
      const u = String(url); llamadas.push(u);
      const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v ?? null)), json: () => Promise.resolve(v) });
      const err = (msg, st) => Promise.resolve({ ok: false, status: st || 400, text: () => Promise.resolve(JSON.stringify({ message: msg })), json: () => Promise.resolve({ message: msg }) });
      if (u.includes("datos.json")) return json(JSON.parse(JSON.stringify(datos)));
      if (u.includes("/rpc/")) {
        const fn = u.split("/rpc/")[1].split("?")[0];
        let body = {}; try { body = JSON.parse(opts2?.body || "{}"); } catch(e){}
        cuerpos[fn] = body; llamadas.push("rpc:" + fn);
        switch (fn) {
          case "validar_usuario": return json([{ codigo: COD, nombre: "Busc Uno", activo: true }]);
          case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 950, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: hoyISO });
          case "leer_panel": return json({ ok: true, nombre: "Busc Uno", tratos: [] });
          case "ver_presencia": return json({ ok: true, usuarios: [{ codigo: "ADMIN", nombre: "Ernesto", visto: new Date().toISOString() }] });
          case "mensajes_sin_leer": return json({ ok: true, sin_leer: 0 });
          case "tocar_presencia": case "marcar_recibidos": return json({ ok: true });
          case "leer_chat": return json({ ok: true, mensajes: [], fijado: null, temporal_seg: 0 });
          case "enviar_mensaje": return json({ ok: true, id: 99 });
          case "reaccionar": case "editar_mensaje": case "borrar_mensaje": case "guardar_perfil": case "registrar_push": return json({ ok: true });
          case "registrar_push_nativo": return json({ ok: true });
          case "leer_perfil": return json({ codigo: COD, nombre: "Busc Uno", telefono: "51112233", zona: "Micro 9", nota: "tardes", avatar_color: "#2FBF71" });
          case "cambiar_codigo": return json({ ok: true, codigo: body.p_codigo_nuevo });
          case "registrar_reporte": return json("uuid-rep-1");
          case "estado_reportes": return json([]);
          case "editar_reporte": return json({ ok: true });
          default: return err("404", 404);
        }
      }
      return err("404", 404);
    };
  }});
  return dom.window;
}

/* ===== L1: WEB — el enlace ?codigo= entra solo y aterriza en «Mi panel» ===== */
{
  const w = crear({ previa: false, url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/?codigo=" + COD });
  const d = w.document;
  await sleep(900);
  ok(w.SESION === COD, "L1a web: el enlace valida el código y abre su sesión sin teclear nada");
  ok(w.localStorage.getItem("busc_codigo") === COD, "L1b web: la sesión queda guardada en el teléfono");
  ok(!d.getElementById("viewPanel").classList.contains("hide") && d.getElementById("tabPanel").classList.contains("on"), "L1c web: aterriza en «Mi panel» (la sección indicada), no en otra vista");
  w.close();
}

/* ===== L2: NATIVO — Android entrega el enlace a la APK (plugin App) ===== */
{
  const appListeners = {};
  const cap = { isNativePlatform: () => true, Plugins: {
    App: { getLaunchUrl: () => Promise.resolve({ url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/?codigo=" + COD }),
           addListener: (ev, cb) => { appListeners[ev] = cb; return Promise.resolve({ remove: () => {} }); } },
  } };
  const w = crear({ previa: false, cap });
  const d = w.document;
  await sleep(900);
  ok(w.SESION === COD, "L2a nativo: la APK consume el enlace de arranque y abre la sesión del código");
  ok(!d.getElementById("viewPanel").classList.contains("hide") && d.getElementById("tabPanel").classList.contains("on"), "L2b nativo: aterriza en «Mi panel»");
  ok(typeof appListeners["appUrlOpen"] === "function", "L2c nativo: el listener appUrlOpen quedó registrado (enlaces con la app ya abierta)");
  w.close();
}

/* ===== P1: PUSH NATIVO — nunca pedido: la app pide el permiso sola al entrar ===== */
{
  const st = stubPush({ receive: "prompt", requestResult: "granted", regMode: "token", token: "TOK-P1" });
  const cap = { isNativePlatform: () => true, Plugins: { PushNotifications: st.PN } };
  const w = crear({ cap });
  const d = w.document;
  await sleep(1000);
  ok(st.calls.req === 1, "P1a al entrar, la app pide el permiso del sistema UNA vez (diálogo automático, como cualquier app)");
  ok(st.calls.reg === 1 && cuerpos["registrar_push_nativo"] && cuerpos["registrar_push_nativo"].p_token === "TOK-P1" && cuerpos["registrar_push_nativo"].p_codigo === COD, "P1b concedido el permiso, el token del aparato se registra en el servidor por su puerta");
  const loc = JSON.parse(w.localStorage.getItem("busc_push_nativo_v1") || "{}");
  ok(loc.registrado === true, "P1c el estado local queda «registrado» SOLO tras la confirmación del servidor");
  w.showView("Perfil");
  await sleep(300);
  ok(d.getElementById("pf_push_txt").textContent.includes("✓ Avisos activados"), "P1d la tarjeta Avisos pinta el ✓ con su explicación cuando todo confirmó");
  w.close();
}

/* ===== P2: PUSH NATIVO — permiso denegado: nada de insistir; la tarjeta guía a Ajustes ===== */
{
  const st = stubPush({ receive: "denied", regMode: "token" });
  const cap = { isNativePlatform: () => true, Plugins: { PushNotifications: st.PN } };
  const w = crear({ cap });
  const d = w.document;
  await sleep(800);
  ok(st.calls.req === 0 && st.calls.reg === 0, "P2a denegado de antes: la app NO vuelve a disparar el diálogo ni registra nada");
  w.showView("Perfil");
  await sleep(300);
  const t = d.getElementById("pf_push_txt").textContent;
  ok(t.includes("Ajustes del teléfono") && t.includes("Notificaciones"), "P2b la tarjeta explica en palabras claras cómo encenderlo desde Ajustes");
  ok(!t.includes("✓ Avisos activados") && !t.includes("no admite avisos"), "P2c ni ✓ falso ni el viejo «no admite»: estado honesto de denegado");
  w.close();
}

/* ===== P3: PUSH NATIVO — permiso sí, token no (sin Firebase): «pendiente», jamás ✓ ===== */
{
  const st = stubPush({ receive: "granted", regMode: "error" });
  const cap = { isNativePlatform: () => true, Plugins: { PushNotifications: st.PN } };
  const w = crear({ cap });
  const d = w.document;
  await sleep(1000);
  ok(st.calls.reg === 1, "P3a con el permiso concedido, la app intenta registrar el aparato");
  w.showView("Perfil");
  await sleep(300);
  const t = d.getElementById("pf_push_txt").textContent;
  ok(t.includes("pendiente de un paso técnico"), "P3b sin token (puerta de Firebase), la tarjeta dice «pendiente de un paso técnico»");
  ok(!t.includes("✓ Avisos activados"), "P3c PROHIBIDO el ✓ sin entrega real: no aparece");
  const loc = JSON.parse(w.localStorage.getItem("busc_push_nativo_v1") || "{}");
  ok(loc.registrado !== true && loc.pendiente === true, "P3d el estado local queda «pendiente», no «registrado»");
  w.close();
}

/* ===== X: AUSENCIAS Y PRESENCIAS EN EL BUILD ENSAMBLADO (directiva 14:39) ===== */
{
  const iTx = html.indexOf('id="viewTextos"'), iPf = html.indexOf('id="viewPerfil"');
  const vistaTextos = html.slice(iTx, iPf);
  ok(!html.includes("Generar las 3 versiones"), "X1 el build NO contiene «Generar las 3 versiones»");
  ok(!html.includes("Precio por privado"), "X2 el build NO contiene «Precio por privado»");
  ok(!html.includes("Humanizado natural"), "X3 el build NO contiene «Humanizado natural»");
  ok(!html.includes("Comercial vendedor"), "X4 el build NO contiene «Comercial vendedor»");
  ok(!vistaTextos.includes("MLC") && !vistaTextos.includes("QUSD") && !vistaTextos.includes("USD"), "X5 en Textos no queda NINGUNA moneda ajena (USD/MLC/QUSD): el dinero del buscador es CUP");
  ok(!html.includes('id="tx_moneda"') && !html.includes('id="tx_gen"') && !html.includes('id="tx_prod"') && !html.includes('id="tx_tel"'), "X6 ni el selector de moneda ni ningún campo del formulario viejo existen en el build");
  ok(vistaTextos.includes('id="tx_saldo"') && vistaTextos.includes('id="tx_recarga"') && vistaTextos.includes('id="tx_transf"') && vistaTextos.includes("Compro saldo") && vistaTextos.includes("Recarga y cambio") && vistaTextos.includes("Transferencia"), "X7 presencia: los 3 botones inteligentes están en el build");
  const wx = crear({});
  await sleep(300);
  ok(typeof wx.TextosMotor === "object" && typeof wx.TextosMotor.generar !== "function" && typeof wx.TextosMotor.textoRapidoSaldo !== "function" && typeof wx.TextosMotor.miles === "function" && typeof wx.TextosMotor.historialPush === "function", "X8 el motor genérico NO existe en la app: TextosMotor conserva SOLO miles e historialPush");
  ok(typeof wx.txGenerar !== "function" && typeof wx.txEstilo !== "function" && typeof wx.initTextosPRO !== "function", "X9 ni txGenerar ni txEstilo ni initTextosPRO quedan en la app");
  wx.close();
}

/* ===== V: VERSIONES / SW / DATOS ===== */
{
  const w = crear({});
  await sleep(300);
  ok(w.APP_VERSION === "1.4.7", "V1 APP_VERSION 1.4.7");
  w.close();
  const sw = fs.readFileSync(HOME + "/buscadores/sw.js", "utf8");
  ok(sw.includes('CACHE = "mitrabajo-v15"'), "V2 el SW sube a mitrabajo-v15");
  const datos = JSON.parse(fs.readFileSync(HOME + "/buscadores/datos.json", "utf8"));
  ok(datos.versionApp === "1.4.7" && /apk-v1\.4\.7\/Mi-Trabajo-v1\.4\.7\.apk$/.test(datos.apkUrl), "V3 datos.json: versionApp 1.4.7 y apkUrl de la v1.4.7");
  ok(datos.tarifa.ingresoRef360 === 1098.68 && datos.tarifa.libroRef === 1069.38 && datos.tarifa.salidaRef === 950 && datos.tarifa.pctSaldo === 25 && datos.tarifa.pisoTransf === 25, "V4 la tarifa de datos.json queda INTACTA");
  ok(datos.publico.telefono === "51231558" && datos.publico.saldo.tasa === 2 && datos.publico.saldo.recarga === 720, "V5 el bloque público queda INTACTO (teléfono de Ernesto, al 2, recargas 720)");
}

/* ===== A: ASSETLINKS + HUELLA REAL DEL APK PUBLICADO ===== */
function huellaDeApk(ruta){
  const buf = fs.readFileSync(ruta);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) { if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error("sin EOCD");
  const cdOff = buf.readUInt32LE(eocd + 16);
  const magic = buf.slice(cdOff - 16, cdOff).toString("latin1");
  if (magic !== "APK Sig Block 42") throw new Error("sin bloque de firma");
  const size2 = Number(buf.readBigUInt64LE(cdOff - 24));
  const inicio = cdOff - (size2 + 8);
  let p = inicio + 8;
  const fin = cdOff - 24;
  let v2 = null;
  while (p < fin) {
    const len = Number(buf.readBigUInt64LE(p)); const id = buf.readUInt32LE(p + 8);
    if (id === 0x7109871a) { v2 = buf.slice(p + 12, p + 8 + len); break; }
    p += 8 + len;
  }
  if (!v2) throw new Error("sin bloque v2");
  const u32 = (b, o) => b.readUInt32LE(o);
  /* v2: [u32 largo de la secuencia de firmantes][u32 largo del
     firmante][u32 largo de signedData][signedData]… */
  const sdLen = u32(v2, 8);
  const signedData = v2.slice(12, 12 + sdLen);
  const digLen = u32(signedData, 0);
  let q = 4 + digLen;
  const certsLen = u32(signedData, q); q += 4;
  const certLen = u32(signedData, q); q += 4;
  const cert = signedData.slice(q, q + certLen);
  const h = crypto.createHash("sha256").update(cert).digest("hex").toUpperCase();
  return h.match(/.{2}/g).join(":");
}
{
  const al = JSON.parse(fs.readFileSync(HOME + "/.well-known/assetlinks.json", "utf8"));
  ok(Array.isArray(al) && al.length === 1 && al[0].relation.includes("delegate_permission/common.handle_all_urls"), "A1 assetlinks: relación handle_all_urls");
  ok(al[0].target.namespace === "android_app" && al[0].target.package_name === "cu.ernesto.mitrabajo", "A2 assetlinks: package cu.ernesto.mitrabajo");
  const huellaAl = (al[0].target.sha256_cert_fingerprints || [])[0] || "";
  ok(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/.test(huellaAl), "A3 assetlinks: huella con formato SHA-256 (32 bytes)");
  const rutaApk = "/tmp/apk144.apk";
  if (fs.existsSync(rutaApk)) {
    const real = huellaDeApk(rutaApk);
    ok(real === huellaAl, "A4 la huella del assetlinks ES la del certificado del APK v1.4.4 publicado (" + real.slice(0, 23) + "…)");
  } else {
    console.log("NOTA A4: /tmp/apk144.apk no está en esta máquina; la igualdad huella↔APK se verifica en el paso de publicación.");
    ok(true, "A4 (estructural) la igualdad huella↔APK se verifica en publicación");
  }
  const man = fs.readFileSync(HOME + "/android/app/src/main/AndroidManifest.xml", "utf8");
  ok(man.includes('android:autoVerify="true"') && man.includes('android:host="ernesto5058.github.io"') && man.includes('android:pathPrefix="/calculadora-ernesto/buscadores"'), "A5 el manifiesto declara el App Link verificado (autoVerify + host + pathPrefix)");
  ok(man.includes("android.permission.POST_NOTIFICATIONS"), "A6 el manifiesto declara POST_NOTIFICATIONS");
  const pkg = JSON.parse(fs.readFileSync(HOME + "/package.json", "utf8"));
  ok(pkg.dependencies["@capacitor/app"] && pkg.dependencies["@capacitor/push-notifications"], "A7 package.json declara @capacitor/app y @capacitor/push-notifications");
}

console.log("\nBANCO MI TRABAJO v1.4.5 (regresión en la era v1.4.6): " + pass + " PASS · " + fail + " FAIL");
if (fails.length) console.log("Fallos:", fails.join(" · "));
process.exit(fail ? 1 : 0);

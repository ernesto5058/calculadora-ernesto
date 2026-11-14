// Banco «Puertas sin gemelas» — fila 17 de CHEQUEOS-ETERNOS.md.
// Nació de la tanda del 2026-11-11 (captura de Ernesto, 20:25): el chat de
// Mi Negocio no podía enviar foto+texto. Había DOS causas apiladas:
//   (1) enviar_mensaje / leer_chat / registrar_reporte tenían SOBRECARGAS
//       gemelas vivas en el servidor y cualquier llamador que mandara un
//       subconjunto de parámetros caía en PGRST203 («Could not choose the
//       best candidate function») — Mi Negocio mandaba subconjunto; Mi
//       Trabajo se había blindado en la v1.4.4 (fila 7) pero el blindaje
//       nunca se barrió a Mi Negocio ni al servidor.
//   (2) barrer_temporales() traía un UPDATE con el alias calificando el
//       SET (set m.borrado = true), SQL inválido: TODA puerta que lo
//       llamaba moría con 42703 aunque resolviera bien.
// El arreglo dejó UNA sola sobrecarga por puerta (DROP de las legadas),
// el barrer válido, y a Mi Negocio mandando el juego completo + p_op_id
// como Mi Trabajo. Este banco vigila las tres capas:
//   E — estática sobre los HTML generados (lo que corre en CI siempre).
//   MN/MT — el camino foto+texto → cola → puerta en jsdom, en AMBAS apps,
//           incluido el editor de foto a pantalla completa (paso WhatsApp).
//   V — viva contra pg_proc: SOLO si el entorno trae SUPABASE_PAT (en CI
//       no va la credencial; la parte viva se corre en la tanda y queda
//       registrada en CHEQUEOS-ETERNOS).
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
let pass = 0, fail = 0; const fails = [];
function ok(c, n){ if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function click(el){ el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent("click", { bubbles: true, cancelable: true })); }
function input(el, v){ el.value = v; el.dispatchEvent(new el.ownerDocument.defaultView.Event("input", { bubbles: true })); }

const genMN = fs.readFileSync(REPO + "minegocio/index.html", "utf8");
const genMT = fs.readFileSync(REPO + "buscadores/index.html", "utf8");

/* ===== E: estática ===== */
{
  ok(genMN.includes("p_op_id: a.opId"), "E1 Mi Negocio manda p_op_id (el de la operación de su cola) a enviar_mensaje");
  ok(genMN.includes("p_adj_mime") && genMN.includes("p_buscar: null"), "E2 Mi Negocio manda el juego completo: p_adj_mime en enviar_mensaje y p_buscar en leer_chat");
  ok(!genMN.includes("(último error:"), "E3 Mi Negocio ya NO pinta el error crudo de la puerta en la hoja del mensaje fallido");
  ok(genMN.includes('<details class="opDet">'), "E4 el detalle técnico del fallo vive plegado tras «ver detalle» (patrón de Actividad)");
  ok(genMN.includes("abrirEditorFotoMN") && genMT.includes("abrirEditorFotoMT"), "E5 el editor de foto a pantalla completa existe en AMBAS apps (paso WhatsApp parejo)");
  ok(genMT.includes('APP_VERSION = "1.6.1"') && genMN.includes("MN_VERSION = \"v22\""), "E6 versiones vigentes: Mi Trabajo 1.6.1 · Mi Negocio v22 (T1)");
  /* Ningún SQL del repo puede definir dos veces la misma función-puerta. */
  const sqls = [];
  (function walk(d){ if (!fs.existsSync(d)) return; for (const n of fs.readdirSync(d)) { const p = path.join(d, n); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else if (n.endsWith(".sql")) sqls.push(p); } })(REPO + "supabase");
  const vistos = {}, dup = [];
  for (const f of sqls) {
    const txt = fs.readFileSync(f, "utf8");
    for (const m of txt.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(([^)]*)\)/gi)) {
      const k = m[1] + "(" + m[2].split(",").length + ")";
      if (vistos[k]) dup.push(k); vistos[k] = true;
    }
  }
  ok(dup.length === 0, "E7 ningún .sql del repo define la misma función con la misma aridad dos veces" + (dup.length ? " — duplicadas: " + dup.join(", ") : ""));
}

/* ===== MN: jsdom contra el HTML generado de Mi Negocio ===== */
const adminValido = "CODIGO-PRUEBA";
let ultimosCuerpos = {};
const datosPublicadosMN = { version: 4, versionApp: "1.3.1", apkUrl: "https://example.invalid/apk", tarifa: { version: 4, ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, bonoSaldoRecargas: 150, bonoSaldoCUP: 300, bonoTransfTratos: 10, bonoTransfCUP: 300 } };
function crearMN(){
  ultimosCuerpos = {};
  const preState = { codigo: adminValido, foto: { reportes: [], ayudas: [], usuarios: [ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ], datos: datosPublicadosMN, cuando: "", publicar: [], borrados: [], tarifaPanel: null, mercado: null }, cola: [], sellos: {}, tarifaViva: null, tarifaVivaEn: "", publicarPendiente: null };
  const dom = new JSDOM(genMN, { url: "https://ernesto5058.github.io/calculadora-ernesto/minegocio/", runScripts: "dangerously", pretendToBeVisual: true, beforeParse(w){
    try { w.localStorage.setItem("minegocio_v1", JSON.stringify(preState)); } catch(e){}
    w.fetch = function(url, opts){
      const u = String(url);
      const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v === undefined ? null : v)), json: () => Promise.resolve(v) });
      const rechaza = (msg, st) => Promise.resolve({ ok: false, status: st || 404, text: () => Promise.resolve(JSON.stringify({ message: msg || "404" })), json: () => Promise.resolve({ message: msg || "404" }) });
      if (u.includes("/rpc/")) {
        const fn = u.split("/rpc/")[1].split("?")[0];
        let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch(e){}
        ultimosCuerpos[fn] = body;
        switch (fn) {
          case "admin_reportes": case "admin_ayudas": case "admin_cierres": return json([]);
          case "admin_usuarios": return json([ { codigo: "BUSC-1", nombre: "Busc Uno", activo: true } ]);
          case "ver_presencia": return json({ ok: true, usuarios: [ { codigo: "BUSC-1", nombre: "Busc Uno", visto: new Date().toISOString() } ] });
          case "mensajes_sin_leer": return json({ ok: true, por_usuario: {}, total: 0 });
          case "leer_chat": return json({ ok: true, mensajes: [] });
          case "enviar_mensaje": return json({ ok: true, id: 99 });
          case "marcar_recibidos": return json({ ok: true, marcados: 0 });
          case "tocar_presencia": return json({ ok: true });
          case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 950, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: "2026-11-11 20:00" });
          default: return json({ ok: true });
        }
      }
      if (u.includes("datos.json")) return json(datosPublicadosMN);
      if (u.includes("ultimo.json")) return json({ ts: "2026-11-11T02:00:00Z", ETECSA: { average: 304.86 }, BANK_CUP: { average: 1068.44 } });
      return rechaza("404");
    };
  }});
  return dom.window;
}
const fotoDU = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
{
  const w = crearMN(); const d = w.document;
  await sleep(500);
  w.irA("Equipo"); /* T1 (v22): Equipo es hija de Inicio; vía irA() */
  await sleep(150);
  click(d.querySelector("[data-chat]"));
  await sleep(400);
  ok(ultimosCuerpos.leer_chat && ("p_buscar" in ultimosCuerpos.leer_chat), "MN-1 leer_chat sale con el juego completo (p_buscar presente)");
  /* Camino clásico: foto adjunta + texto en el compositor → UN mensaje. */
  w.chatAdj = { tipo: "foto", datos: fotoDU, nombre: "IMG_1.png", mime: "image/png", tam: 70 };
  input(d.getElementById("chTexto"), "mira la foto");
  click(d.getElementById("chEnviar"));
  await sleep(400);
  const c1 = ultimosCuerpos.enviar_mensaje || {};
  ok(typeof c1.p_op_id === "string" && c1.p_op_id.length >= 8, "MN-2a enviar_mensaje manda p_op_id (desambigua + idempotente)");
  ok(c1.p_adj_mime === "image/png" && c1.p_adj_datos === fotoDU && c1.p_adj_tipo === "foto", "MN-2b la foto viaja ÍNTEGRA y con su mime");
  ok(c1.p_texto === "mira la foto" && ("p_resp_de" in c1) && ("p_adj_tam" in c1) && ("p_adj_nombre" in c1), "MN-2c foto+texto en UN mensaje y el juego completo de parámetros");
  /* Editor a pantalla completa: el pie de foto ES el texto del mensaje. */
  w.chatAdj = { tipo: "foto", datos: fotoDU, nombre: "IMG_2.png", mime: "image/png", tam: 70 };
  w.abrirEditorFotoMN();
  await sleep(60);
  const ed = d.getElementById("editorFoto");
  ok(!!ed && ed.classList.contains("abierto") && d.getElementById("edFotoImg").getAttribute("src") === fotoDU, "MN-3a el editor abre a pantalla completa con la foto");
  input(d.getElementById("edFotoTxt"), "pie de la foto");
  click(d.getElementById("edFotoOk"));
  await sleep(400);
  const c2 = ultimosCuerpos.enviar_mensaje || {};
  ok(c2.p_texto === "pie de la foto" && c2.p_adj_datos === fotoDU && typeof c2.p_op_id === "string", "MN-3b el editor envía foto+pie como UN mensaje por la puerta, con p_op_id");
  ok(!ed.classList.contains("abierto"), "MN-3c el editor se cierra tras enviar");
  /* El borrador sobrevive al repintado del hilo (refresco de 3 s). */
  input(d.getElementById("chTexto"), "borrador vivo");
  w.pintarChat();
  await sleep(60);
  ok(d.getElementById("chTexto").value === "borrador vivo", "MN-4 el borrador del compositor sobrevive a pintarChat (ya no se borra a mitad de frase)");
  /* Error en humano: el crudo solo vive plegado tras «ver detalle». */
  w.hojaMensajeMN({ local: true, de: "ADMIN", para: "BUSC-1", texto: "con foto", creado: new Date().toISOString(), op_estado: "fallida", op_intentos: 3, op_error: "Could not choose the best candidate function between: public.enviar_mensaje(...)" });
  await sleep(60);
  const hojaTxt = d.body.innerHTML;
  ok(hojaTxt.includes("No se pudo enviar") && hojaTxt.indexOf("Could not choose") > hojaTxt.indexOf("<details"), "MN-5 la hoja del mensaje fallido habla en humano y el error crudo queda SOLO dentro del detalle plegado");
  w.close();
}

/* ===== MT: jsdom contra el HTML generado de Mi Trabajo ===== */
const COD = "BUSC-1";
let cuerposMT = {};
function datosFixtureMT(){
  return { version: 4, versionApp: "1.4.8", apkUrl: "https://example.invalid/apk",
    tarifa: { version: 4, ingresoRef360: 1098.68, libroRef: 1069.38, salidaRef: 950, pctSaldo: 25, pctTransf: 20, pisoTransf: 25, bonoSaldoMeta: 150, bonoSaldoMonto: 300, bonoTransfMeta: 10, bonoTransfMonto: 300 },
    publico: { telefono: "51231558", zona: "Micro 10, distrito José Martí, Santiago de Cuba", domicilio: "Domicilio gratis en Santiago de Cuba", saldo: { tasa: 2, tasaAlta: 2.2, desdeAlta: 5000, recarga: 720 } },
    actualizado: "2026-11-11" };
}
function crearMT(extra){
  cuerposMT = {};
  const datos = datosFixtureMT();
  const dom = new JSDOM(genMT, { url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/", runScripts: "dangerously", pretendToBeVisual: true, beforeParse(w){
    w.localStorage.setItem("busc_codigo", COD);
    if (extra && extra.outbox) { try { w.localStorage.setItem("busc_outbox", JSON.stringify(extra.outbox)); } catch(e){} }
    w.prompt = () => "texto editado"; w.confirm = () => true;
    w.scrollTo = () => {};
    w.fetch = function(url, opts){
      const u = String(url);
      const json = v => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(v ?? null)), json: () => Promise.resolve(v) });
      const err = (msg, st) => Promise.resolve({ ok: false, status: st || 400, text: () => Promise.resolve(JSON.stringify({ message: msg })), json: () => Promise.resolve({ message: msg }) });
      if (u.includes("datos.json")) return json(JSON.parse(JSON.stringify(datos)));
      if (u.includes("/rpc/")) {
        const fn = u.split("/rpc/")[1].split("?")[0];
        let body = {}; try { body = JSON.parse((opts && opts.body) || "{}"); } catch(e){}
        cuerposMT[fn] = body;
        switch (fn) {
          case "validar_usuario": return json([{ codigo: COD, nombre: "Busc Uno", activo: true }]);
          case "leer_tarifa": return json({ ok: true, ingreso_ref360: 1098.68, libro_ref: 1069.38, salida_ref: 950, comision_saldo: 25, comision_transf: 20, piso_transf: 25, actualizado: new Date().toISOString() });
          case "leer_panel": return json({ ok: true, nombre: "Busc Uno", tratos: [] });
          case "ver_presencia": return json({ ok: true, usuarios: [{ codigo: "ADMIN", nombre: "Ernesto", visto: new Date().toISOString() }] });
          case "mensajes_sin_leer": return json({ ok: true, sin_leer: 0 });
          case "leer_chat": return json({ ok: true, mensajes: [], fijado: null, temporal_seg: 0 });
          case "enviar_mensaje": return json({ ok: true, id: 99 });
          case "registrar_reporte": return json(123);
          case "estado_reportes": return json([]);
          default: return json({ ok: true });
        }
      }
      return err("404", 404);
    };
  }});
  return dom.window;
}
{
  const w = crearMT(); const d = w.document;
  await sleep(800);
  w.showView("Ayuda");
  await sleep(400);
  w.CHAT_ADJ = { tipo: "foto", datos: fotoDU, nombre: "IMG_3.png", mime: "image/png", tam: 70 };
  w.abrirEditorFotoMT();
  await sleep(60);
  const ed = d.getElementById("editorFoto");
  ok(!!ed && ed.classList.contains("abierto") && d.getElementById("edFotoImgMT").getAttribute("src") === fotoDU, "MT-1a el editor abre a pantalla completa con la foto");
  input(d.getElementById("edFotoTxtMT"), "pie desde Mi Trabajo");
  click(d.getElementById("edFotoOkMT"));
  await sleep(500);
  const c = cuerposMT.enviar_mensaje || {};
  ok(c.p_texto === "pie desde Mi Trabajo" && c.p_adj_datos === fotoDU && typeof c.p_op_id === "string" && c.p_op_id.length >= 8, "MT-1b el editor envía foto+pie en UN mensaje, juego completo + p_op_id");
  ok(JSON.parse(w.localStorage.getItem("busc_chat_outbox") || "[]").length === 0, "MT-1c con red, la cola queda vacía tras el envío del editor");
  w.close();
}
/* MT-2: el botón «Editar» encuentra el reporte por su UUID (fila 20
   de CHEQUEOS: la puerta editar_reporte ya acepta uuid en el
   servidor; en la app la comparación era x.id === Number(...) y
   Number(uuid) = NaN dejaba el botón muerto). */
{
  const UUID_REP = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
  const w = crearMT({ outbox: [ { buscador: COD, tipo: "saldo", precio: 950, porc: null, cantidad: 360,
    telefono: "51234567", nota: "del banco", estado: "pendiente", enviado: true,
    id: UUID_REP, opId: "op-banco-uuid", fecha: "11/11/2026" } ] });
  const d = w.document;
  await sleep(800);
  w.showView("Rep");
  await sleep(300);
  const btn = d.querySelector("[data-edrep]");
  ok(!!btn && btn.getAttribute("data-edrep") === UUID_REP, "MT-2a el reporte con id UUID pinta su botón «Editar»");
  click(btn);
  await sleep(200);
  ok(w.REP_EDIT_ID === UUID_REP, "MT-2b «Editar» ENCUENTRA el reporte por su UUID (comparación por cadena, no Number)");
  ok(d.getElementById("r_precio").value === "950" && d.getElementById("r_editando").style.display === "block", "MT-2c el formulario se llena con el reporte y entra en modo edición");
  w.close();
}

/* ===== V: viva (solo con SUPABASE_PAT en el entorno) ===== */
if (process.env.SUPABASE_PAT) {
  const r = await fetch("https://api.supabase.com/v1/projects/otsudfgwpapkluusrlnj/database/query", {
    method: "POST",
    headers: { "Authorization": "Bearer " + process.env.SUPABASE_PAT, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "select p.proname as funcion, count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e') group by p.proname having count(*) > 1 order by 1" })
  });
  const rows = await r.json();
  ok(Array.isArray(rows) && rows.length === 0, "V1 VIVA: ninguna función-puerta tiene sobrecargas gemelas en el servidor (las de extensiones, como unaccent, no cuentan: no son puertas)" + (Array.isArray(rows) && rows.length ? " — quedan: " + rows.map(x => x.funcion).join(", ") : ""));
  const r2 = await fetch("https://api.supabase.com/v1/projects/otsudfgwpapkluusrlnj/database/query", {
    method: "POST",
    headers: { "Authorization": "Bearer " + process.env.SUPABASE_PAT, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "select pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'barrer_temporales'" })
  });
  const defs = await r2.json();
  ok(Array.isArray(defs) && defs.length === 1 && !/set\s+\w+\.borrado/.test(defs[0].def), "V2 VIVA: barrer_temporales ya no califica el SET con el alias (el 42703 no puede volver por esa puerta)");
  /* V3/V4 — fila 49 de CHEQUEOS (reparación 2026-11-12): la tabla
     reportes cambió (telefono → telefono_vendedor; id bigint → uuid)
     y registrar_reporte quedó insertando en la columna muerta: TODO
     reporte rebotaba 42703 y se quedaba en la cola del teléfono.
     sincronizar_reportes tenía el mismo drift por el id (42883).
     V3 vigila la forma viva; V4 hace el viaje completo y se limpia. */
  const mgmt = (query) => fetch("https://api.supabase.com/v1/projects/otsudfgwpapkluusrlnj/database/query", {
    method: "POST",
    headers: { "Authorization": "Bearer " + process.env.SUPABASE_PAT, "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  }).then(x => x.json());
  const defsV3 = await mgmt("select p.proname as f, pg_get_function_result(p.oid) as ret, pg_get_function_identity_arguments(p.oid) as args, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('registrar_reporte', 'sincronizar_reportes')");
  const dReg = Array.isArray(defsV3) && defsV3.find(x => x.f === "registrar_reporte");
  const dSin = Array.isArray(defsV3) && defsV3.find(x => x.f === "sincronizar_reportes");
  ok(!!dReg && dReg.ret === "uuid" && dReg.def.includes("telefono_vendedor") && !/cantidad,\s*telefono\s*,/.test(dReg.def),
     "V3a VIVA: registrar_reporte devuelve uuid e inserta en telefono_vendedor (la columna «telefono» muerta no puede volver a su INSERT)");
  ok(!!dSin && /p_desde_id uuid/.test(dSin.args) && !/::bigint/.test(dSin.def),
     "V3b VIVA: sincronizar_reportes usa cursor uuid (sin comparaciones ni casts contra el bigint muerto)");
  /* El viaje son TRES llamadas separadas a propósito: dentro de una
     sola sentencia, los CTE hermanos no ven la fila que la función
     acaba de insertar (snapshot de la sentencia) y la lectura saldría
     vacía aunque la puerta esté sana — cazado al estrenar este caso. */
  const opBanco = "banco-puertas-v4-" + Date.now();
  const ins = await mgmt("select public.registrar_reporte('PEUEBA', 'saldo', 950, null, 1, '51000000', 'BANCO PUERTAS V4', null, null, '" + opBanco + "')::text as id");
  const idV4 = Array.isArray(ins) && ins[0] && ins[0].id;
  let v4ok = !!idV4;
  if (idV4) {
    const lee = await mgmt("select estado, telefono_vendedor as tel from public.reportes where id = '" + idV4 + "'::uuid");
    v4ok = v4ok && Array.isArray(lee) && lee[0] && lee[0].estado === "pendiente" && lee[0].tel === "51000000";
    const del = await mgmt("delete from public.reportes where id = '" + idV4 + "'::uuid returning id");
    v4ok = v4ok && Array.isArray(del) && del.length === 1;
  }
  ok(v4ok, "V4 VIVA: registrar_reporte completa el viaje (entra con PEUEBA, se lee pendiente con su teléfono y el residuo se borra al final)");
} else {
  console.log("VIVA SALTADA: sin SUPABASE_PAT en el entorno (en CI es lo esperado; la parte viva se corre en la tanda).");
}

console.log("\nBANCO PUERTAS SIN GEMELAS: " + pass + " PASS · " + fail + " FAIL");
if (fails.length) console.log("Fallos:", fails.join(" · "));
process.exit(fail ? 1 : 0);

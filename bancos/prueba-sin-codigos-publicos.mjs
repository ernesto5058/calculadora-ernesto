// Banco «Sin códigos públicos» — fila 38 de CHEQUEOS-ETERNOS.md.
// Nació del Inspector Ola 1 (2026-11-12): Mi Trabajo E-1 / Mi Negocio E-4.
// Los códigos de acceso de los buscadores vivían como CLAVES del
// datos.json PÚBLICO (Pages + raw + copia empaquetada en la APK):
// cualquiera con el enlace tenía las llaves de todas las cuentas.
// La cura: el JSON público ya no lleva la sección buscadores, el
// login de Mi Trabajo depende SOLO de validar_usuario (servidor),
// ningún generador (Mi Negocio / PanelPRO) siembra códigos en el
// JSON, y el panel se respalda en la última foto de leer_panel.
// Este banco vigila tres capas:
//   L — estructural local sobre los dos datos.json del repo y sobre
//       el código: sin sección buscadores, sin ninguna clave con
//       forma de código en ningún nivel, y Mi Trabajo sin ninguna
//       consulta a DATA.buscadores / codigoEnDatos.
//   W — viva: el datos.json SERVIDO en Pages pasa la misma aserción
//       estructural. Si la red no responde, se salta con aviso (la
//       capa L es la bloqueante; W se verifica en cada tanda).
//   V — viva con SUPABASE_PAT (patrón de prueba-puertas-sin-gemelas):
//       trae los códigos ACTIVOS de public.usuarios por Management
//       API y afirma que NINGUNO aparece como texto en ningún
//       archivo del repo (excluye node_modules y este banco) ni en
//       el JSON servido. Excepción documentada: «PEUEBA», la cuenta
//       de prueba pública del Ojo (su código es su nombre de prueba;
//       no protege datos de nadie). Sin PAT, se salta con aviso.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const REPO = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/?$/, "/");
let pass = 0, fail = 0; const fails = [];
function ok(c, n){ if (c) pass++; else { fail++; fails.push(n); console.log("FAIL:", n); } }

const FORMA_CODIGO = /^[A-ZÑÁÉÍÓÚ]+-[A-Z0-9]{3}$/;
const EXCEPCION_PRUEBA = "PEUEBA";
function clavesConFormaDeCodigo(obj, ruta, out){
  if (!obj || typeof obj !== "object") return out;
  for (const k of Object.keys(obj)) {
    if (FORMA_CODIGO.test(k)) out.push((ruta || "$") + "." + k);
    clavesConFormaDeCodigo(obj[k], (ruta || "$") + "." + k, out);
  }
  return out;
}
function assertDatosLimpio(datos, etiqueta){
  ok(!!datos && typeof datos === "object", etiqueta + ": el JSON parsea y es objeto");
  ok(!("buscadores" in (datos || {})), etiqueta + ": SIN sección «buscadores»");
  const malas = clavesConFormaDeCodigo(datos, "", []);
  ok(malas.length === 0, etiqueta + ": ninguna clave con forma de código en ningún nivel" + (malas.length ? " — quedan " + malas.length + " (valores omitidos a propósito: son credenciales)" : ""));
}

/* ===== L: estructural local ===== */
for (const [ruta, etq] of [["buscadores/datos.json", "L1 datos.json público"],
                           ["android/app/src/main/assets/public/datos.json", "L2 datos.json empaquetado (APK)"]]) {
  let datos = null;
  try { datos = JSON.parse(fs.readFileSync(REPO + ruta, "utf8")); } catch (e) { /* queda null */ }
  assertDatosLimpio(datos, etq);
}
{
  const srcMT = fs.readFileSync(REPO + "buscadores-app/app.js", "utf8");
  const genMT = fs.readFileSync(REPO + "buscadores/index.html", "utf8");
  ok(!srcMT.includes("DATA.buscadores") && !genMT.includes("DATA.buscadores"), "L3 Mi Trabajo (fuente y build): NINGÚN camino consulta DATA.buscadores");
  ok(!srcMT.includes("codigoEnDatos") && !genMT.includes("codigoEnDatos"), "L4 Mi Trabajo: la segunda cerradura cliente (codigoEnDatos) no existe");
  ok(genMT.includes('APP_VERSION = "1.6.1"'), "L5 Mi Trabajo: la tanda viaja en la versión 1.6.1");
  const genMN = fs.readFileSync(REPO + "minegocio/index.html", "utf8");
  ok(!genMN.includes("out.buscadores ="), "L6 Mi Negocio (build): construirBase ya NO emite la sección buscadores en el respaldo");
}

/* ===== W: viva contra Pages ===== */
const URL_DATOS = "https://ernesto5058.github.io/calculadora-ernesto/buscadores/datos.json";
let servidoTxt = null;
try {
  const r = await fetch(URL_DATOS + "?t=" + Date.now(), { cache: "no-store" });
  if (r.ok) { servidoTxt = await r.text(); assertDatosLimpio(JSON.parse(servidoTxt), "W1 datos.json SERVIDO en Pages"); }
  else console.log("VIVA W SALTADA: Pages respondió HTTP " + r.status + " (la capa L es la bloqueante).");
} catch (e) {
  console.log("VIVA W SALTADA: sin respuesta de Pages (" + (e && e.message || e) + "); la capa L es la bloqueante.");
}

/* ===== V: códigos activos reales contra TODO el repo (solo con SUPABASE_PAT) ===== */
if (process.env.SUPABASE_PAT) {
  const r = await fetch("https://api.supabase.com/v1/projects/otsudfgwpapkluusrlnj/database/query", {
    method: "POST",
    headers: { "Authorization": "Bearer " + process.env.SUPABASE_PAT, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "select codigo from public.usuarios where activo = true" })
  });
  const rows = await r.json();
  ok(Array.isArray(rows) && rows.length > 0, "V1 VIVA: la tabla de usuarios devolvió sus códigos activos (" + (Array.isArray(rows) ? rows.length : 0) + ")");
  const codigos = (Array.isArray(rows) ? rows : []).map(x => String(x.codigo || "")).filter(c => c && c !== EXCEPCION_PRUEBA);
  // Barrido de archivos del repo (texto; excluye node_modules, .git y este banco)
  const esteBanco = fileURLToPath(import.meta.url);
  const archivos = [];
  (function walk(d){
    for (const n of fs.readdirSync(d)) {
      if (n === "node_modules" || n === ".git") continue;
      const p = path.join(d, n); const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (path.resolve(p) !== path.resolve(esteBanco)) archivos.push(p);
    }
  })(REPO.replace(/\/$/, ""));
  let sucios = [];
  for (const f of archivos) {
    let txt = "";
    try { txt = fs.readFileSync(f, "utf8"); } catch (e) { continue; }
    for (const c of codigos) if (txt.includes(c)) sucios.push(path.relative(REPO, f));
  }
  ok(sucios.length === 0, "V2 VIVA: ningún código activo aparece como texto en ningún archivo del repo" + (sucios.length ? " — aparecen en: " + [...new Set(sucios)].join(", ") : ""));
  if (servidoTxt !== null) {
    const enServido = codigos.filter(c => servidoTxt.includes(c));
    ok(enServido.length === 0, "V3 VIVA: ningún código activo aparece en el datos.json servido");
  } else {
    console.log("V3 SALTADA: el JSON servido no se pudo leer en esta corrida (W quedó saltada).");
  }
} else {
  console.log("VIVA V SALTADA: sin SUPABASE_PAT en el entorno (en CI es lo esperado; la parte viva se corre en la tanda).");
}

console.log("\nBANCO SIN CÓDIGOS PÚBLICOS: " + pass + " PASS · " + fail + " FAIL");
if (fails.length) console.log("Fallos:", fails.join(" · "));
process.exit(fail ? 1 : 0);

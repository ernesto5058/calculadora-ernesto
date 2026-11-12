// Copia para CI (GitHub Actions) — la raíz del repo se resuelve desde este
// archivo (o BANCO_REPO), como en los demás bancos.
/* Banco BARRA INFERIOR — Mi Trabajo (fila 21 de CHEQUEOS-ETERNOS).
   La enfermedad: tema-pro.css (copia del maestro design-system que la app
   enlaza ANTES de su estilo propio) trae la .tabbar centrada del sistema —
   left:50% + transform: translateX(-50%) + width:100% + max-width:560px —
   y la regla .tabbar PROPIA de Mi Trabajo (left:0; right:0) no redeclaraba
   esas propiedades: se colaban en cascada y la barra salía corrida media
   pantalla a la izquierda, con las 3 primeras pestañas fuera de foto en
   los Ojos (Android y Web). Medido al píxel en Chromium: −192 px.
   La cura (v1.4.9): la regla propia se declara COMPLETA —
   transform: none; width: auto; max-width: none.
   Este banco pina el EFECTO (estilo computado por jsdom sobre el build
   ensamblado, con el tema inlineado en su orden real de documento) en los
   dos estados del body: bloqueado (entrada, con el blur de .wrap) y dentro. */
import fs from "fs";
import { fileURLToPath } from "url";
import { JSDOM } from "jsdom";

const RAIZ = (process.env.BANCO_REPO || fileURLToPath(new URL("..", import.meta.url))).replace(/\/$/, "");
const htmlBuild = fs.readFileSync(RAIZ + "/buscadores/index.html", "utf8");
const tema = fs.readFileSync(RAIZ + "/buscadores/tema-pro.css", "utf8");
const fuente = fs.readFileSync(RAIZ + "/buscadores-app/index-sin-script.html", "utf8");

let pass = 0, fail = 0;
const fails = [];
function ok(c, n) { if (c) pass++; else { fail++; fails.push(n); } }

/* B1/B2 — el reseteo vive en la regla propia, en la FUENTE y en el BUILD. */
const reglaDe = (txt) => (txt.match(/\.tabbar\s*\{[^}]*\}/) || [""])[0];
ok(/transform:\s*none/.test(reglaDe(fuente)) && /max-width:\s*none/.test(reglaDe(fuente)),
   "B1 la fuente (index-sin-script.html) declara la .tabbar completa: transform: none y max-width: none");
ok(/transform:\s*none/.test(reglaDe(htmlBuild)) && /max-width:\s*none/.test(reglaDe(htmlBuild)),
   "B2 el build ensamblado conserva el reseteo en su regla .tabbar");

/* B3–B5 — estilo computado con la cascada real (tema enlazado primero). */
const html = htmlBuild.replace('<link rel="stylesheet" href="tema-pro.css">',
                               "<style>\n" + tema + "\n</style>");
ok(html !== htmlBuild, "B3 el tema se inlineó en el orden del documento (si esto falla, cambió el <link>)");
const dom = new JSDOM(html, { url: "https://ernesto5058.github.io/calculadora-ernesto/buscadores/", pretendToBeVisual: true });
const d = dom.window.document;
const bar = d.querySelector(".tabbar");
function computado() {
  const cs = dom.window.getComputedStyle(bar);
  return { transform: cs.transform, left: cs.left, right: cs.right, width: cs.width, maxWidth: cs.maxWidth };
}
d.body.classList.add("locked");
const conLock = computado();
d.body.classList.remove("locked");
const sinLock = computado();
ok(!!bar && conLock.transform === "none",
   "B4 CON body.locked (entrada): el transform computado de la barra es «none», no el translateX(-50%) heredado (sale: " + conLock.transform + ")");
ok(!!bar && sinLock.transform === "none" && sinLock.width === "auto" && sinLock.maxWidth === "none",
   "B5 SIN body.locked (dentro): transform «none» y el ancho lo mandan left:0/right:0 (width auto, max-width none)");
const tabs = bar ? [...bar.querySelectorAll(".tab")] : [];
ok(tabs.length === 6 && tabs.every(t => t.id),
   "B6 la barra tiene sus 6 pestañas con id (Calc, Reportar, Mi panel, Ayuda, Textos, Mi perfil)");

console.log("\nBANCO BARRA INFERIOR: " + pass + " PASS · " + fail + " FAIL");
if (fails.length) console.log("Fallos:", fails.join(" · "));
process.exit(fail ? 1 : 0);

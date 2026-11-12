// Casos de prueba — casa-scriptable.yaml (contexto nativo de Scriptable)
// (semgrep --test: ruleid = debe cazar, ok = no debe cazar)
// Este archivo simula el script NATIVO; la regla lo incluye por nombre.

// ── MALO: temporizador en el contexto nativo (DESARROLLO-PRO §5) ──
// ruleid: casa-js-settimeout-scriptable
setTimeout(function () { guardar(); }, 500);

// ruleid: casa-js-settimeout-scriptable
setInterval(function () { refrescar(); }, 60000);

// ── BUENO: el setTimeout de la PÁGINA WebView vive dentro del string de
// buildHTML — Semgrep no lo ve como llamada y NO debe saltar. Es la
// forma real de CalculadoraPRO.js (autosave de la página). ──
function buildHTML() {
  return "<script>" +
    "var t = null;" +
    // (texto dentro de una cadena, no una llamada)
    // ok: casa-js-settimeout-scriptable
    "function autosave(){ clearTimeout(t); t = setTimeout(function(){}, 500); }" +
    "<\/script>";
}

// ── BUENO: el patrón de la casa — ejecutar, guardar, salir ──
function principal() {
  // ok: casa-js-settimeout-scriptable
  guardar();
}

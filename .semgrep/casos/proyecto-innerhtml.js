// Casos de prueba — proyecto-innerhtml.yaml (regla fusionada)
// (semgrep --test: ruleid = debe cazar, ok = no debe cazar)

// ── proyecto-innerhtml-sin-escapar ────────────────────────────────────────
function pintaMalo(el, nombreCliente) {
  // ruleid: proyecto-innerhtml-sin-escapar
  el.innerHTML = "<b>" + nombreCliente + "</b>";
}

function pintaMaloPlantilla(el, texto) {
  // ruleid: proyecto-innerhtml-sin-escapar
  el.innerHTML = `<div>${texto}</div>`;
}

function pintaVariableSuelta(el, htmlConstruido) {
  // (a propósito: el escape no se ve aquí)
  // ruleid: proyecto-innerhtml-sin-escapar
  el.innerHTML = htmlConstruido;
}

function pintaBueno(el, nombreCliente) {
  // (escape visible en la expresión)
  // ok: proyecto-innerhtml-sin-escapar
  el.innerHTML = "<b>" + escChat(nombreCliente) + "</b>";
}

function pintaLiteral(el) {
  // (literal puro, sin datos)
  // ok: proyecto-innerhtml-sin-escapar
  el.innerHTML = '<div class="vacio">Todavía no hay mensajes.</div>';
}

function pintaTextContent(el, nombreCliente) {
  // (la vía segura no usa innerHTML)
  // ok: proyecto-innerhtml-sin-escapar
  el.textContent = nombreCliente;
}

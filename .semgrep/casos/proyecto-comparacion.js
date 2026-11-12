// Casos de prueba — proyecto-secreto-comparacion-insegura (semgrep --test).

function comparaMalo(tokenRecibido, tokenGuardado) {
  // ruleid: proyecto-secreto-comparacion-insegura
  return tokenRecibido === tokenGuardado;
}

function comparaMaloPropiedad(cfg, entrada) {
  // ruleid: proyecto-secreto-comparacion-insegura
  return cfg.token === entrada;
}

// REGRESIÓN del falso positivo documentado (humo 2026-11-12): «clave»
// aquí es la llave de FECHA de los reportes (clave(d)), no un secreto.
// La regla NO trae «clave» en sus términos y esto no debe saltar jamás.
// ok: proyecto-secreto-comparacion-insegura
function comparaClaveFecha(clave, fecha, otra) {
  return clave(fecha) === clave(otra);
}

function comparaNumeros(a, b) {
  // ok: proyecto-secreto-comparacion-insegura
  return a === b;
}

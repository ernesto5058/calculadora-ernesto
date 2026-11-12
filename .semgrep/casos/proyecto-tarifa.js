// Casos de prueba — proyecto-tarifa-default-fantasma y
// proyecto-tarifa-fallback-fantasma (semgrep --test).
// El fantasma: salida 950 / libro 1110 de fábrica contra la fila viva.

// ruleid: proyecto-tarifa-default-fantasma
const DEFECTO = { salida: 950, libro: 1110 };

function poneSalida() {
  // ruleid: proyecto-tarifa-default-fantasma
  salidaRef = 950;
}

function conFallback(viva) {
  // ruleid: proyecto-tarifa-fallback-fantasma
  return viva || 950;
}

function conFallbackNulo(viva) {
  // ruleid: proyecto-tarifa-fallback-fantasma
  return viva ?? 1110;
}

// (la fila viva real: cualquier otro número no es el fantasma)
// ok: proyecto-tarifa-default-fantasma
const VIVA = { salida: 925, libro: 1069 };

// (950 en un dominio que NO es tarifa: el nombre manda)
// ok: proyecto-tarifa-default-fantasma
const PRECIO_MAX = 950;

// ok: proyecto-tarifa-fallback-fantasma
function sinFallback(viva) { return viva || 0; }

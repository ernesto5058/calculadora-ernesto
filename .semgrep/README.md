# Semgrep de la casa — set UNIDO (2026-11-12)

Fusión de las 8 reglas del montaje Inspector v2 con las 6 del programa
Dominio Total: **11 reglas, sin duplicados** (innerHTML, service worker
y secreto-literal viven una sola vez, fusionadas). Nacen del catálogo
de incidentes reales (DESARROLLO-PRO §9/§11, REGRESSIONS.md, Inspector
Ola 1). El workflow `.github/workflows/semgrep.yml` escanea con
`--config .semgrep/reglas/` en modo NO bloqueante.

## Por qué un directorio y no un solo archivo

`semgrep --test` (1.185.0) revienta con IndexError cuando `--config`
es un archivo suelto (reproducido el 2026-11-12), y empareja cada
archivo de reglas con su archivo de casos por nombre base. Por eso:
`reglas/<nombre>.yaml` ↔ `casos/<nombre>.<ext>`.

## Puerta de las reglas (antes de tocar una regla)

    semgrep --test --config .semgrep/reglas/ .semgrep/casos/

Todo verde o la regla no entra. Los casos son fixtures con valores
FICTICIOS; todas las reglas excluyen `**/.semgrep/casos/**` pa que el
escaneo del repo no los trate como código (verificado: `--test`
ignora `paths.exclude`, el escaneo no).

## Incidente → regla en 3 pasos

1. Caso que FALLA con el código mínimo del incidente real (`ruleid:`).
2. Regla + caso que PASA con la forma correcta de la casa (`ok:`).
   Si el patrón no discrimina ambos, la regla se descarta con
   evidencia, no se afloja.
3. `--test` en verde + escaneo contra el repo pa medir falsos
   positivos antes de darla por eterna.

## No expresables en Semgrep CE (con su chequeo sustituto)

- Función duplicada con el mismo nombre en un archivo JS (la gemela
  del bug de las puertas SQL `enviar_mensaje`): CE casa patrones
  sobre nodos, no conteos. Sustitutos: en SQL,
  `bancos/prueba-puertas-sin-gemelas.mjs` + `pg_proc` (CHEQUEOS
  filas 7/17); en JS, ESLint `no-redeclare`.
- `caches.delete()` de claves ajenas en formas libres (forEach/for
  sin el filtro `!==`): exige seguir el flujo de datos; lo cubre el
  chequeo eterno (f) «cada SW solo toca su propia caché».
- «La tarifa usada difiere de la fila viva»: propiedad de datos en
  vivo, no de código; chequeo eterno (a) de los bancos.
- `details` de pago en claro en la bitácora (Mercado E-6): depende
  del payload en tiempo de ejecución; caza de su tanda, no regla.

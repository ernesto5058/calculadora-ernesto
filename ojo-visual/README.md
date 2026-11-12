# Ojo Visual — regresión visual automática (TOP 5 del estudio de huecos)

**Qué es:** cada foto nueva de las pantallas estables se compara sola
contra la **foto buena aprobada** (la baseline, versionada en
`visual.spec.mjs-snapshots/`). Si un texto se corta, un botón se mueve o
un color cambia, la corrida sale en rojo y deja el diff como artefacto.
Es la alarma automática pa que el corte de Promos (que cazó Ernesto a
mano) no vuelva a depender de ojos humanos.

**Qué se fotografía** (Pixel 7, contra las URLs públicas servidas):
- `paginita` — la página pública del negocio, página completa.
- `mercado-ahora` — la pantalla «Ahora» de Mercado, con las cifras vivas
  del libro **enmascaradas** (`.heroe-num`, `.num`, `.valor`,
  `.peldano-tasa`, `#cabSub`): cambia el mercado cada 15 min y eso NO es
  un defecto; el marco (tarjetas, títulos, barra) sí se compara.
- `mitrabajo-puerta` y `minegocio-puerta` — las puertas que piden el
  código (sin sesión, sin secretos: el código del dueño no viaja a robots).

**Tolerancia:** 0,2 por píxel y hasta 1 % de píxeles distintos
(`playwright.config.mjs`). Las animaciones se apagan y el service worker
se bloquea: cada corrida fotografía lo que Pages sirve hoy.

## Los tres modos (workflow «Ojo Visual — regresión de fotos»)

| Modo | Qué hace |
|---|---|
| `controlar` | Compara contra las baselines. Verde = nada se movió. Es el modo de la corrida semanal (lunes 06:23 UTC) y el que se dispara a mano tras publicar un cambio visual. |
| `actualizar` | Regenera las baselines con las fotos de HOY y las publica en el repo (push con rebase + reintentos, patrón de la casa). |
| `fuego` | Recrea el defecto de Promos (textos cortados a la fuerza en la paginita) y exige que la comparación lo cace: si la prueba pasara, el sistema estaría ciego y la corrida sale en rojo. |

## Quién aprueba una foto nueva como «buena»

**Máximo, tras cazar en vivo que el cambio visual es legítimo — nunca
automático.** El flujo es: una tanda cambia una pantalla a propósito →
Máximo la mira con el Ojo (fotos + caza en vivo, la puerta de siempre) →
si el cambio es el querido, dispara el workflow en modo `actualizar` y la
nueva baseline queda registrada en un commit con su motivo. Si nadie
aprobó nada y el modo `controlar` sale en rojo, es una regresión de
verdad: se trata como hallazgo (Inspector), no se re-aprueba pa callarla.

## Límites honestos

- Solo pantallas estables y públicas. El interior con datos (panel del
  buscador, contabilidad) cambia por negocio, no por defecto: ahí mandan
  los bancos y el recorrido del Ojo, no la foto fija.
- Las baselines son del runner de GitHub (Linux/Chromium): no comparar
  contra fotos hechas en otra máquina.

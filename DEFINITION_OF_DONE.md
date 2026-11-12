# DEFINITION OF DONE — la definición de terminado de la casa

Un cambio **no está terminado** hasta que cumple TODA esta lista. Sin excepciones por prisa.

> **una corrección sin su chequeo de regresión NO está terminada**

Documentos enlazados:

- [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) — el registro de chequeos automáticos eternos.
- [REGRESSIONS.md](REGRESSIONS.md) — el registro trinquete de fallos reales cazados: una línea por fallo, nunca se borran.

## Checklist

- [ ] **Bancos verdes en CI** (workflow Bancos).
- [ ] **Puertas automáticas en verde** (CodeQL, Semgrep).
- [ ] **Cada corrección trae su chequeo de regresión nuevo o actualizado en el mismo cambio** — registrado en [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) y, si nació de un fallo real, en [REGRESSIONS.md](REGRESSIONS.md).
- [ ] **Veredicto del Inspector APROBADO** (o CON OBSERVACIONES aceptadas expresamente por Ernesto).
- [ ] **Pasada del Ojo de la superficie tocada con lectura de defectos** (no solo fotos).
- [ ] **Barrido lateral de toda pieza que comparte el componente tocado**.
- [ ] **Ningún secreto en el código ni en el repo**.
- [ ] **Dinero: dimensiones escritas, invariantes barridos, doble lectura antes de actuar**.
- [ ] **Espejos de GitHub al día** (blob remoto == local).
- [ ] **Informe de cierre con evidencia** (corridas, capturas, ids), nunca de memoria.

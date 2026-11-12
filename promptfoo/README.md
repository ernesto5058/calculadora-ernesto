# promptfoo-agente — batería dorada del Agente de clientes

Batería [promptfoo](https://www.promptfoo.dev/docs/) que corre la **lógica real** del Agente de clientes de Ernesto (`@AsistenteErnestoBot` + widget web) en local, con los datos semilla espejo del banco eterno. Nació de los incidentes reales de `CHEQUEOS-ETERNOS.md` filas 23–27: cada caso del dataset es la frase exacta de un fallo que ya pasó en vivo, con aserciones deterministas sobre la **acción** que la lógica decide (no solo sobre el texto).

**Jamás corre contra producción:** sin red, sin Supabase, sin Telegram, sin claves. El provider importa `logica.js` viva y la alimenta con la semilla — si la lógica se mueve de sitio, la batería falla en voz alta en `provider/logica-ref.mjs` en vez de evaluar una copia vieja.

## Cómo correrla (el comando de la tanda)

Desde esta carpeta:

```bash
npm install            # una sola vez (promptfoo 0.125.1 fijado en package.json)
npm run eval           # = PROMPTFOO_DISABLE_TELEMETRY=1 promptfoo eval -c promptfooconfig.yaml --no-cache -o results/resultados.json
```

- `--no-cache` es **obligatorio**: la caché de promptfoo clavea por prompt/proveedor y podría devolver la salida anterior tras un cambio en `logica.js`, escondiendo justo la regresión que la batería existe pa cazar.
- Salida: tabla en consola + `results/resultados.json` (éxitos/fallos por caso y por aserción). Código de salida ≠ 0 si algún caso falla — eso es la puerta funcionando, no un error de la herramienta.
- Pa inspeccionar un fallo con calma: `npm run eval:view` abre la vista local de resultados.

## Cuándo se corre — DEFAULT, no opcional

En **cada tanda que toque el agente** (`supabase/functions/agente-responder/logica.js`, `index.ts`, `cerebro.ts` o sus datos/FAQ), **antes de declarar la tanda cerrada**, junto al banco eterno `bancos/prueba-agente-v1.mjs`. La regla vive en la skill `promptfoo_agente` (`~/workspace/custom-skills/promptfoo_agente/`) y el workflow preparado (abajo) la cablea en CI pa que corra sola en cada push que toque esas rutas — nadie tiene que acordarse.

Un caso en rojo se reporta como **hallazgo**, no se maquilla: o la lógica tiene una regresión real, o el caso codifica mal el incidente (y se corrige el caso citando la evidencia). La batería cazando algo vivo es un éxito del montaje.

## Estructura

| Pieza | Qué es |
|---|---|
| `promptfooconfig.yaml` | Config de promptfoo: 1 prompt (`{{input}}`), 1 provider local, dataset externo. |
| `provider/agente-provider.mjs` | Provider JS custom: modos `orquestar` / `secuencia` / `seguimiento` / `validador` / `cerebro`, componiendo la decisión igual que la puerta `index.ts`. Salida = JSON estructurado de la decisión. |
| `provider/logica-ref.mjs` | Localiza e importa la `logica.js` real (diseño local y diseño repo `promptfoo/**`). |
| `provider/seed.mjs` | Semilla espejo del banco eterno (catálogo, fuentes, sinónimos, FAQ, filas de citas). Coords del pin = las exactas vivas de la fila 25. |
| `tests/casos.yaml` | Dataset versionado: 25 casos, cada uno con `metadata.referencia` a su fila de CHEQUEOS y su aserción hermana del banco. |
| `ci/promptfoo-agente.yml` | Workflow de GitHub Actions PREPARADO (ver abajo). |
| `results/` | Salida de la última corrida (`resultados.json`). |

## CI — preparado, pendiente de activación

`ci/promptfoo-agente.yml` está listo pa vivir como `.github/workflows/promptfoo-agente.yml` del repo `calculadora-ernesto`: se dispara en push/PR que toquen `supabase/functions/agente-responder/**`, `promptfoo/**` o `bancos/prueba-agente-v1.mjs`, instala promptfoo desde `promptfoo/package.json` y corre la batería con puerta dura (falla el job si `resultados.json` trae fallos).

**Lo único que falta pa activarlo:** que Máximo lo copie a `.github/workflows/` tras el montaje paralelo (decisión suya; esta tanda no toca `.github/workflows` ni los workflows existentes). En el repo, este proyecto vive bajo `promptfoo/**` y el provider resuelve la lógica por la ruta del repo sin cambios.

## Añadir un caso desde un incidente real

1. Frase **exacta** del fallo como `input` (o `secuencia`/`borrador` según el modo).
2. Aserción **determinista primero**: acción esperada (`javascript` sobre el JSON de salida); `contains`/`not-contains`/`regex` solo acotados a la respuesta.
3. Juez LLM (`llm-rubric` y familia): **último recurso**, con tope — si un caso lo necesita, se justifica en su descripción. Hoy: ninguno.
4. `metadata.referencia` con su fila de CHEQUEOS (o la nota de cierre) y la aserción hermana del banco si existe.
5. Correr la batería entera: el caso nuevo pasa y ningún viejo se rompe.

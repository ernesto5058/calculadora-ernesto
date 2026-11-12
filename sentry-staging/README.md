# SENTRY DE LA CASA — paquete STAGED (TOP 2 · estudio de huecos, 2026-11-12)

**Estado: PUBLICADO el 2026-11-12 en las 4 apps — Mercado, Mi Negocio (v15), la paginita y Mi Trabajo (v1.5.4, cierre diferido tras la Tanda Nº6) — con pruebas de fuego reales aceptadas por la ingestión de Sentry. 4/4 cableadas (ver CHEQUEOS fila 40).** Sin DSN todo el cableado es no-op: aunque se publicara por error, las apps no cambian en nada.

## Piezas

| Archivo | Qué es |
|---|---|
| `sentry-casa.js` | El init + escrubado de la casa. Sin DSN o sin SDK no hace nada; jamás rompe la app; descarta el evento si el escrubado falla. |
| `bloque-head.html` | Config por app + SDK CDN (8.38.0 fijado, con SRI y `defer`). Solo se rellenan APP / VERSION / DSN. |
| `prueba-sentry-casa.mjs` | Banco con un Sentry falso: **21 PASS · 0 FAIL** — sin DSN no hay init, sin SDK (APK offline) no revienta, con SDK tardío inicializa solo, y de un evento envenenado no sobreviven código de acceso, teléfono, JWT, texto de chat, adjunto, cookies ni query. |

## El paso de la CUENTA (lo hace Máximo en el navegador, con el OK de Ernesto)

El alta de Sentry es un registro web interactivo (formulario + verificación por correo / «Sign up with Google»): no hay vía API ni CLI, y no se fuerza desde aquí.

1. Abrir **sentry.io/signup** → **Sign up with Google** con `ernestonunestorrez@gmail.com` (o correo + contraseña y verificar el correo que llegue).
2. Crear la organización (nombre sugerido: `ernesto-apps`). El alta arranca con **14 días de prueba con todo desbloqueado y después cae SOLO al plan Developer gratis** (1 usuario, 5.000 errores/mes, sin tarjeta).
3. **Si en cualquier pantalla pide tarjeta: cancelar y avisar** — el plan gratis no la necesita.
4. Crear **4 proyectos**, plataforma **Browser JavaScript** (JavaScript → Browser), con estos nombres exactos: `minegocio` · `mitrabajo` · `mercado` · `paginita`.
5. De cada proyecto: **Settings → Client Keys (DSN)** → copiar su DSN. El DSN es una clave **pública** por diseño (como la publishable de Supabase): va en el código de la app, no es secreto.
6. *(Opcional, después)* Alertas: Sentry avisa por correo por defecto; el aviso a Telegram se enchufa luego con una regla de alerta + webhook.

**Plan B si el alta desde Cuba falla: GlitchTip** (glitchtip.com, cloud gratis 1.000 eventos/mes). Mismo SDK y mismo cableado: solo cambian el alta y el DSN que se rellena. No hay que reescribir nada.

## Integración por app (tanda de publicación, cuando existan los 4 DSN)

Regla de oro de la casa: primero la pieza, verificación en vivo, y `datos.json` al final si la tanda lo toca.

### Mi Trabajo (web + APK con el mismo cableado)
1. Copiar `sentry-casa.js` → `shared/sentry-casa.js`.
2. En `buscadores-app/index-sin-script.html`, antes de `</head>`: el bloque de `bloque-head.html` con `app:"mitrabajo"`, `version:` = el `APP_VERSION` vigente de `app.js`, `dsn:` = el del proyecto `mitrabajo`.
3. En `buscadores-app/app.js`, primera línea: el marcador `/*__SENTRY_CASA__*/`.
4. En `buscadores-app/ensamblar.py`, tras el bloque de `push-cliente.js`, el espejo exacto:
   `pushjs` → leer `ruta_shared("sentry-casa.js")` y `js = js.replace("/*__SENTRY_CASA__*/", sentryjs)`.
   (El contenido no trae ningún `</script>`: el guardián del ensamblador pasa.)
5. Bancos de Mi Trabajo en verde, publicar por el patrón de la casa y subir la versión como siempre (el service worker renueva la carcasa).

### Mi Negocio
Igual, sobre `minegocio-src/`: bloque en `index-sin-script.html` antes de `</head>` (`app:"minegocio"`, `version:` = `MN_VERSION` vigente), marcador en su `app.js`, y el mismo espejo en su `ensamblar.py` (patrón `shared/` idéntico).

### Mercado (archivo único)
En `mercado/index.html`: bloque de head rellenado (`app:"mercado"`, `version:"v3"` — el sello vigente) antes de `</head>`, y el contenido íntegro de `sentry-casa.js` dentro de un `<script>` justo antes de `</body>`.

### Paginita
En `negocio/index.html`: igual que Mercado (`app:"paginita"`, `version:"1"`).

## Prueba de fuego (tras publicar, UNA sola app primero: Mercado)

1. Abrir la app publicada con **`?prueba-sentry=1`** al final de la URL.
2. En el panel de Sentry (proyecto `mercado`) debe llegar el evento «Prueba de fuego Sentry» con release `mercado@v3`.
3. **La verificación de privacidad es parte de la prueba:** el mensaje debe leerse «tel [teléfono oculto] — codigo [código oculto]». Si se ve el 50000000 o el FALSO-123 en claro, el escrubado falló y se detiene todo.
4. Recién entonces se repite la integración en las demás apps y se deja la fila de CHEQUEOS como activa del todo.

## DSN (rellenar al publicar)

| Proyecto | DSN |
|---|---|
| minegocio | `https://1454ae292cfdb8e358e88ec3d1fc1547@o4512419765354496.ingest.us.sentry.io/4512419769876480` |
| mitrabajo | `https://c55f15054776babcf29ee7023c77f250@o4512419765354496.ingest.us.sentry.io/4512419773087744` |
| mercado | `https://be3fffd86ef4af47f8d6a09497019a00@o4512419765354496.ingest.us.sentry.io/4512419775381504` |
| paginita | `https://9f5efe752996c23227a28d8365a7ef17@o4512419765354496.ingest.us.sentry.io/4512419778265088` |

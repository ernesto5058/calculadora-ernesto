# CHEQUEOS ETERNOS — el registro del Plan PRO

Cada corrección de Ernesto se convierte en un chequeo automático que corre solo
en GitHub Actions (workflow **«Bancos automáticos»**, `.github/workflows/bancos.yml`)
en cada push que toca las apps. Máximo ya no tiene que correr los bancos a mano:
lee el resultado en la pestaña **Actions** del repo.

Este registro dice qué se vigila, de qué incidente nació cada chequeo y dónde
vive su aserción. Solo entran chequeos que EXISTEN como aserción en un banco;
los propuestos sin aserción van al final, marcados como pendientes.

| # | Chequeo | Incidente que lo creó | Dónde vive la aserción | ¿En CI? |
|---|---------|----------------------|------------------------|---------|
| 1 | La Calculadora de Mi Negocio sincroniza salida y costo a la tarifa viva; el sello «✓ guardado en la tarifa» se pinta SOLO tras la confirmación del servidor; sin conexión, la sincronización queda en cola como pendiente | 2026-11-11: el bot enseñaba «Salida de referencia: 950» y el panel de Ernesto trabajaba con 925 — la tarifa del sistema no se alimentaba de su Calculadora. Raíz gemela: el sello «PAGADO» fantasma de la Fase 1 (se pintaba sin guardar) | `bancos/test-minegocio-banco.mjs` — S9-1, S9-7, S9-11 | ✅ Sí |
| 2 | El generador de textos VIEJO está ausente del build de Mi Trabajo («Generar las 3 versiones», «Precio por privado», «Humanizado natural», «Comercial vendedor», ids `tx_moneda`/`tx_gen`/`tx_prod`/`tx_tel`, motor genérico) y están PRESENTES los 3 botones inteligentes (Compro saldo · Recarga y cambio · Transferencia) | 2026-11-11: un teléfono con la v1.4.4 mostraba el generador legado generando textos basura con un teléfono que no era el de Ernesto (la v1.4.4 había añadido los botones encima sin retirar el formulario viejo) | `bancos/prueba-mitrabajo-v145.mjs` — X1–X4, X6, X8, X9 (ausencias) y X7 (presencia) | ✅ Sí |
| 3 | El dinero del buscador es SOLO CUP: en Textos no queda ninguna moneda ajena (USD/MLC/QUSD) | 2026-11-11: orden de Ernesto — «MLC, QUSD: a mis trabajadores no les tiene que interesar esa moneda» | `bancos/prueba-mitrabajo-v145.mjs` — X5 | ✅ Sí |
| 4 | Un nivel ausente NUNCA vale 0: `num(null) = null`; sin nivel no se cumple la demanda; libro vacío → niveles null; sin costo o sin salida → equilibrio null (no se inventa) | 2026-11-11: el propio banco de Mercado cazó que `Number(null) === 0` hacía que un nivel ausente contara como 0 (podía falsear la demanda y pintaba «0,00» en la app) | `bancos/prueba-mercado-v1.mjs` — num, cumpleDemanda, nivel20, equilibrio | ✅ Sí (la lógica del lector vive fuera del repo: fixture `bancos/fixtures/mercado-logica.js`) |
| 5 | `assetlinks.json` bien formado: relación `delegate_permission/common.handle_all_urls`, paquete `cu.ernesto.mitrabajo`, huella con formato SHA-256 (32 bytes) | 2026-11-11: el enlace personal del buscador debe rebotar directo a la app instalada (Android App Links, v1.4.5) | `bancos/prueba-mitrabajo-v145.mjs` — A1–A3 | ✅ Sí |
| 6 | La huella del assetlinks ES la huella del certificado del APK publicado | Si no coinciden, Android ignora el rebote en silencio y el enlace abre el navegador | `bancos/prueba-mitrabajo-v145.mjs` — A4 (condicional: necesita el APK al lado) | ⚠️ Estructural en CI; la igualdad se verifica contra el APK en el paso de publicación de cada versión |
| 7 | Puertas RPC sin sobrecargas ambiguas: la app manda siempre el juego completo de parámetros (`leer_chat` con `p_buscar`; `enviar_mensaje` y `registrar_reporte` con `p_op_id`) y el reintento de la cola usa el MISMO opId (idempotente, no duplica en el servidor) | 2026-11-11 (v1.4.4): TODO envío moría — la activación de Supabase había dejado puertas duplicadas y PostgREST devolvía HTTP 300 (PGRST203). No era la foto, ni el tamaño, ni la conexión | `bancos/prueba-mitrabajo-v144.mjs` — R1a, R2, R3, R5b | ✅ Sí |
| 8 | Bot PRO: las fórmulas del bot se calculan contra la tarifa viva y cada rol ve solo sus vistas | 2026-11-11: Bot PRO v2 (y el hallazgo de que los botones de decidir de la v1 nunca funcionaron con reportes reales por el choque uuid/bigint) | `bancos/test-telegram-pro-banco.mjs` — TP-1…TP-30 (30 aserciones; copia local en research_notes) | ⚠️ En el workflow y verde en local + simulación exacta del repo (30/30); la corrida en la nube quedó bloqueada en GitHub el 2026-11-11 (ver la nota de la corrida bloqueada en Mantenimiento). Las fuentes de `telegram-webhook` y `_shared` ya están espejadas en el repo, tal como están en local; `avisos` no se tocó |
| 9 | Invariantes de dinero INV-1…INV-9 del estudio de método: conservación del dinero, 0 ≤ comisión ≤ ganancia bruta, sin ganancia no hay comisión, el equilibrio da ganancia 0 en su tasa, monotonías, bordes exactos de los bonos (149/150/151 recargas · 9/10/11 tratos), tabla de decisión de 24 celdas, el sello PAGADO solo existe si el servidor lo trae, y la foto local sobrevive la ida y vuelta sin cambiar los totales — TODO contra las fórmulas VIVAS (apps + espejo anclado del cierre del servidor), con barridos, no solo el caso feliz | 2026-11-11: el estudio de método (§11.3) exigía pasar de aserciones de ejemplo a propiedades con barrido; escribir el banco destapó los hallazgos H-1…H-4 de la sección siguiente | `bancos/test-invariantes-dinero.mjs` — 36 aserciones bloqueantes + 6 propiedades-hallazgo vigiladas (fixture del cierre: `bancos/fixtures/cierre-semana.sql`) | ⚠️ En el workflow y verde en local + simulación exacta del repo (36 PASS · 0 FAIL · 6 hallazgos); la corrida en la nube quedó bloqueada en GitHub el 2026-11-11 (ver Mantenimiento) |

## Hallazgos abiertos vigilados (propiedades que hoy FALLAN contra las fórmulas vivas)

Regla §11.3: un invariante de dinero roto NO se parchea en la misma sesión ni se
relaja la propiedad — se registra con su contraejemplo y queda vigilado por el
banco (si el comportamiento cambia, la aserción «fijada» salta y obliga a
actualizar este registro). La decisión de corregirlos es de Ernesto.

- **H-1 (mayor) — el campo del trato de transferencia está partido en dos bandos.**
  El reporte se guarda con el efectivo en `cantidad` (y `precio` en null), y el
  cierre del servidor lo lee de ahí; pero la sugerencia al aprobar, la
  Contabilidad de Mi Negocio y el Resumen del bot leen el efectivo de `precio`.
  Contraejemplo (tarifa viva): vuelta real de 5 000 al 30% → el servidor calcula
  ganancia 774,37 y comisión 154,87; las apps calculan 0 y avisan «La vuelta no
  deja ganancia». La base aún no tiene ningún reporte de transferencia real: al
  primero, su ganancia y su comisión saldrían en 0 en panel y bot.
- **H-2 — el resumen del cierre semanal no excluye los reportes de prueba**
  (su `WHERE` es solo `estado = 'aprobado'`), mientras la Contabilidad y el bot
  sí los excluyen. En la base hay pruebas aprobadas con comisiones de 246,70 y
  2 467,00 listas para colarse en el primer cierre generado.
- **H-3 — el cierre no resta las pérdidas**: clampea la ganancia de cada trato a
  0 antes de restar la comisión; la Contabilidad sí resta la pérdida. Trato de
  saldo a precio 1500 (ingreso 1098,68): Contabilidad neta −401,32 · cierre 0,00.
- **H-4 (menor) — cantidad 0 se trata como 1** en Mi Negocio y el bot (por el
  `|| 1`): un trato con cantidad 0 «ganaría» 98,68. No alcanzable desde el
  formulario (que también coacciona a 1); borde fijado.
- **Observación INV-8b**: despachada una acción duplicada (mismo opId), sobrevive
  una copia zombi en la cola local por la fusión con el espejo; al reabrir se
  re-despacha pero el efecto en el servidor es único (la puerta es idempotente).

## Pendientes de aserción (propuestos — NO cuentan como cubiertos)

- **Notificaciones nativas de Android** (la app pide el permiso del sistema al
  entrar): hoy se verifica en el teléfono del buscador; sin aserción automática.
  Pendiente de aserción.

## Mantenimiento

- **Nota — corrida en la nube bloqueada (2026-11-11):** el espejo del bot y los
  dos bancos nuevos entraron en el repo y en el workflow (commits `ceeb3c0f`,
  `edec4de1`, `a2870dcb`, `402cdf02`, `a47e7749`, `e42526e0`), pero GitHub no
  asignó runner a NINGUNA corrida desde las 20:29 UTC de ese día: las corridas
  de «Bancos automáticos» quedaron en `queued` sin jobs y hasta los despliegues
  automáticos de Pages (que no usan estos archivos) morían en
  `startup_failure`; la última corrida verde fue a las 20:03 UTC y la página
  pública de estado de GitHub decía «operational». Es un bloqueo del lado de
  GitHub/cuenta, no del workflow (su YAML se validó: 9 pasos). Cuando la cola se
  libere, la corrida encolada del commit `e42526e0` corre el workflow completo;
  hasta leerla verde, las filas 8 y 9 quedan en ⚠️ con la verificación local y
  de simulación (423 chequeos en total) como respaldo.

- Los archivos de `bancos/` son los bancos vivos de `research_notes` con SOLO
  las rutas adaptadas (jsdom por nombre; la raíz del repo se resuelve desde el
  propio archivo o con la variable `BANCO_REPO`). Cuando un banco vivo cambia,
  su copia se refresca en el mismo cambio.
- La lógica del lector de Mercado vive fuera del repo (`mercado-src`), por eso
  el banco la importa del fixture `bancos/fixtures/mercado-logica.js`, copia
  exacta que se refresca cuando la lógica cambia.
- Las fuentes del bot viven en el repo (`supabase/functions/telegram-webhook/`
  y `supabase/functions/_shared/`), espejadas tal como están en local el
  2026-11-11 — por eso su banco ya corre en CI. Si una función cambia en local,
  se espeja en el mismo cambio. `avisos` ya estaba espejada y no se toca aquí.
- El banco de invariantes lee la fórmula del cierre del servidor del fixture
  `bancos/fixtures/cierre-semana.sql` (bloque exacto de `admin_generar_cierre`
  del paquete de activación): si la fórmula cambia en una activación nueva, el
  fixture se regenera del paquete y las anclas del banco avisan.

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
| 8 | Bot PRO: las fórmulas del bot se calculan contra la tarifa viva y cada rol ve solo sus vistas | 2026-11-11: Bot PRO v2 (y el hallazgo de que los botones de decidir de la v1 nunca funcionaron con reportes reales por el choque uuid/bigint) | `test-telegram-pro-banco.mjs` (28 aserciones, en research_notes) | ❌ Pendiente de CI: las fuentes de `telegram-webhook` y `_shared` no están espejadas en el repo (solo `avisos`); el banco corre en local |

## Pendientes de aserción (propuestos — NO cuentan como cubiertos)

- **Invariantes de dinero** del estudio de método (2026-11-11): comisión ≤ ganancia;
  sin ganancia no hay comisión; el equilibrio da exactamente 0 en su tasa; bordes
  de los bonos (149/150/151 recargas, 9/10/11 tratos) — la familia INV-1…INV-9.
  Pendiente de escribir como aserciones en un banco.
- **Notificaciones nativas de Android** (la app pide el permiso del sistema al
  entrar): hoy se verifica en el teléfono del buscador; sin aserción automática.
  Pendiente de aserción.

## Mantenimiento

- Los archivos de `bancos/` son los bancos vivos de `research_notes` con SOLO
  las rutas adaptadas (jsdom por nombre; la raíz del repo se resuelve desde el
  propio archivo o con la variable `BANCO_REPO`). Cuando un banco vivo cambia,
  su copia se refresca en el mismo cambio.
- La lógica del lector de Mercado vive fuera del repo (`mercado-src`), por eso
  el banco la importa del fixture `bancos/fixtures/mercado-logica.js`, copia
  exacta que se refresca cuando la lógica cambia.

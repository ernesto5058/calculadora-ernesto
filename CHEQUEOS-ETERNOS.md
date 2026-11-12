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
| 8 | Bot PRO: las fórmulas del bot se calculan contra la tarifa viva y cada rol ve solo sus vistas | 2026-11-11: Bot PRO v2 (y el hallazgo de que los botones de decidir de la v1 nunca funcionaron con reportes reales por el choque uuid/bigint) | `bancos/test-telegram-pro-banco.mjs` — TP-1…TP-30 (30 aserciones; copia local en research_notes) | ✅ Sí — verde en local, en simulación exacta del repo (30/30) y en la nube (corrida 43107334440, commit `8cab4f6a6c`, success). Las fuentes de `telegram-webhook` y `_shared` están espejadas en el repo; el 2026-11-11 (tanda H-1) el `_shared` se refrescó con la lectura normalizada del efectivo y la función se redesplegó en Supabase; `avisos` no se tocó |
| 9 | Invariantes de dinero INV-1…INV-9 del estudio de método: conservación del dinero, 0 ≤ comisión ≤ ganancia bruta, sin ganancia no hay comisión, el equilibrio da ganancia 0 en su tasa, monotonías, bordes exactos de los bonos (149/150/151 recargas · 9/10/11 tratos), tabla de decisión de 24 celdas, el sello PAGADO solo existe si el servidor lo trae, y la foto local sobrevive la ida y vuelta sin cambiar los totales — TODO contra las fórmulas VIVAS (apps + espejo anclado del cierre del servidor), con barridos, no solo el caso feliz | 2026-11-11: el estudio de método (§11.3) exigía pasar de aserciones de ejemplo a propiedades con barrido; escribir el banco destapó los hallazgos H-1…H-4 de la sección siguiente | `bancos/test-invariantes-dinero.mjs` — 46 aserciones bloqueantes + 1 propiedad-hallazgo vigilada (H-4) (fixture del cierre: `bancos/fixtures/cierre-semana.sql`, regenerado de la definición VIVA) | ✅ Sí — verde en local, en simulación exacta del repo y en la nube (46 PASS · 0 FAIL · 1 hallazgo; corrida 43107334440, commit `8cab4f6a6c`, success) |
| 10 | La guía del trabajador «¿Para qué es esta app?» es la primera tarjeta de Ayuda de Mi Trabajo (y NO existe en Mi Negocio ni en Mercado) y la cadena Firebase está completa en el repo (`android/app/google-services.json` del proyecto `mi-trabajo-77b9b`, paquete `cu.ernesto.mitrabajo`; el build sigue llamando a `registrar_push_nativo`) | 2026-11-11: tanda Firebase de la v1.4.6 — sin banco, la guía y el google-services podían perderse en un re-ensamblado silencioso | `bancos/prueba-mitrabajo-v146.mjs` — G1–G10 | ✅ Sí — en el workflow desde la tanda H-1/H-2/H-3, verde en local, en simulación exacta del repo (31/31) y en la nube (corrida 43107334440, commit `8cab4f6a6c`, success) |
| 11 | Analista de Mercado — invariantes INV-A1…A10 del estudio: la fórmula madre G(R)=(360÷R)×salida−costo contra los vectores del estudio (G(333)=0 · G(320)=+40,63 · G(305,08)=+91,52), el menú maker con el peldaño que pierde BLOQUEADO y su porqué, el VWAP ejecutable con null honesto sin profundidad, las duras con marca de contraparte probada (sin campos de reputación no hay marca), la transferencia en las dos notaciones (descuento d y prima «al %»), la señal que no sale de foto no usable, la sonda que jamás lleva valores personales y las reservas de la Fase 2 (sin patrones, velas ni tendencia en la Fase 1) | 2026-11-11: aprobación del Analista «así tal cual» — la matemática vive en el lector (`analista.js`) y la app solo pinta; sin banco, la matemática podía derivar del estudio sin que nadie lo notara | `bancos/prueba-mercado-v2.mjs` — secciones A (v1 íntegro) y C (INV-A1…A10) | ✅ Sí |
| 12 | Puerta de acción del Nivel 1 — barandas con mock (nunca contra la QvaPay real): el collar niega con la tarifa del instante, veto por foto de más de 20 min (reloj de recepción), DETENER y pausa bloquean antes que todo, topes $40/oferta · $120/día · 2/hora · enfriamiento 10 min, doble lectura con banda de 5, una sola oferta automática abierta, `P2P_SIDE_NOT_ALLOWED` pausa todo con el motivo en claro y sin bucle, el tercer error seguido pausa, y la idempotencia: un segundo toque con la misma acción NO crea dos ofertas | 2026-11-11: el Nivel 1 crea ofertas reales con el toque de Ernesto — cada baranda del Estudio 2 §3 tiene que estar probada ANTES de que exista el primer botón | `bancos/prueba-actuar-v1.mjs` (41 aserciones; la ganancia de la puerta se barre idéntica a la del Analista) | ✅ Sí |
| 13 | La pantalla «Analista» de la app Mercado: la señal con dos relojes, el peldaño bloqueado con su porqué, el estado DETENER activado con su Reanudar, la foto vieja marcada «DATO VIEJO», la transferencia con B_ej y B_max en las dos notaciones, el texto anti-humo y la línea de la señal en Ahora | 2026-11-11: refuerzo de diseño de Ernesto — la pantalla nace a nivel DISENO-PRO completo y sus estados diseñados (sin datos, foto vieja, detenido, bloqueado) quedan fijados por banco | `bancos/prueba-mercado-v2.mjs` — secciones B (v1 íntegro) y D (S6–S9) | ✅ Sí |

## Hallazgos vigilados (corregidos y abiertos)

Regla §11.3: un invariante de dinero roto NO se parchea en la misma sesión ni se
relaja la propiedad — se registra con su contraejemplo y queda vigilado por el
banco (si el comportamiento cambia, la aserción «fijada» salta y obliga a
actualizar este registro). La decisión de corregirlos es de Ernesto.

**El 2026-11-11 Ernesto aprobó corregir H-1, H-2 y H-3 en una tanda.** Sus
propiedades pasaron de «hallazgo vigilado» a aserciones bloqueantes del banco
de invariantes con los mismos contraejemplos. Quedan abiertos H-4 e INV-8b.

- **H-1 (mayor) — ✅ CORREGIDO el 2026-11-11.** El campo del trato de
  transferencia estaba partido en dos bandos: el reporte se guarda con el
  efectivo en `cantidad` (y `precio` en null) y el cierre del servidor lo lee
  de ahí, pero la sugerencia al aprobar, la Contabilidad de Mi Negocio y el
  Resumen del bot leían el efectivo de `precio` (calculaban 0). Arreglo:
  lectura normalizada con un helper `efectivoDe()` (transferencia: `cantidad`
  si trae valor; si no, `precio`) aplicado en `sugerencia()`,
  `contaGananciaBruta()`, `contaCapital()` y la etiqueta de Mi Negocio, y en
  `brutaDe()`, `capitalDe()` y `conceptoCorto()` del bot — sin tocar ninguna
  fórmula ni el escritor (las filas se siguen guardando igual). Evidencia:
  contraejemplos permanentes en el banco de invariantes (vuelta real de
  5 000 al 30% → bruta 774,37 y comisión 154,87 en panel y bot, como el
  servidor; vuelta de 100 000 al 75% → 75 000 y 15 000) y verificación viva
  del cierre (ver H-2). Los fixtures del banco de Mi Negocio que codificaban
  la forma equivocada (`precio: 5000, cantidad: null`) se corrigieron a la
  forma real almacenada.
- **H-2 — ✅ CORREGIDO el 2026-11-11.** El resumen del cierre semanal no
  excluía los reportes de prueba (su `WHERE` era solo `estado = 'aprobado'`),
  mientras la Contabilidad y el bot sí los excluyen. Arreglo: el `WHERE` del
  resumen suma `and not coalesce(r.prueba, false)`, desplegado por Management
  API con la misma firma (sin sobrecargas nuevas; `anon` conserva EXECUTE).
  **Hallazgo extra descubierto al verificar:** la función viva filtraba por
  `r.creado`, columna que no existe (la real es `creado_en`): fallaba en
  tiempo de ejecución (error 42703 probado) y nunca había generado un cierre
  (`cierres_semanales` en 0); se corrigió a `r.creado_en` en la misma tanda.
  Evidencia: verificación transaccional (BEGIN…ROLLBACK, libros intactos:
  3 reportes · 0 cierres · 8 actividad) con tres filas plantadas en una
  semana vacía — transferencia real de 5 000 al 30% con la tarifa viva
  (salida 925), saldo a precio 1500 y prueba aprobada con comisión
  2 467,00 —: el resumen devolvió `tratos: 2`, `comisiones: 124.49` (la de
  la prueba quedó fuera) y `tu_ganancia: 96.61` (= 622,42 de la vuelta
  − 124,49 de comisión − 401,32 de la pérdida, ver H-3).
- **H-3 — ✅ CORREGIDO el 2026-11-11.** El cierre no restaba las pérdidas:
  clampeaba la ganancia de cada trato a 0 (`greatest(…, 0)` en saldo y en
  transferencia) antes de restar la comisión; la Contabilidad sí resta la
  pérdida. Arreglo: fuera ambos clamps del resumen desplegado. Evidencia:
  trato de saldo a precio 1500 (ingreso 1098,68) → neta −401,32 en el cierre
  y en la Contabilidad (aserción permanente del banco de invariantes y la
  misma verificación transaccional de H-2, donde la pérdida restó dentro de
  `tu_ganancia`).
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

- **Tanda del Analista (2026-11-11):** el lector `mercado-lector` ganó las
  escaleras (ETECSA y BANK_CUP), la sonda de contraparte y el bloque
  `analisis`; nació la puerta `mercado-actuar` (Nivel 1) con su lógica pura en
  `mercado-src`; `avisos` se extendió para adjuntar el botón de acción
  (`a:<id>`) y la fila de control Detener/Reanudar (`x:`) a los avisos del
  Analista — la rama de reportes quedó intacta — y `telegram-webhook` ganó los
  callbacks `a:`/`x:` y los comandos `/detener` `/reanudar` (el `_shared`
  `telegram-pro.ts` NO se tocó: parseCallback sigue devolviendo null para los
  callbacks nuevos y el webhook los intercepta antes). El banco de Mercado
  pasa de v1 a **v2** (`bancos/prueba-mercado-v2.mjs`, 135 chequeos: los 58
  del v1 íntegros + INV-A y el render de la pantalla Analista); el v1 se
  retira de `bancos/` y del workflow. Los módulos puros del Analista y de la
  puerta viven fuera del repo (en `mercado-src`), por eso el banco los
  importa de fixtures vendorizados (`bancos/fixtures/mercado-analista.js`,
  `bancos/fixtures/actuar-logica.js`) que se refrescan cuando las fuentes
  cambian, como el fixture del lector.


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
  **RESUELTA el mismo 2026-11-11:** GitHub liberó los runners ~21:52 UTC y
  las corridas encoladas y las de los pushes de la tanda H-1/H-2/H-3
  ejecutaron. La primera ejecución REAL del banco de invariantes en la nube
  cazó un defecto de rutas de su copia CI (la raíz por defecto apuntaba a la
  ruta local de la máquina de Máximo en vez de resolverse desde el propio
  archivo, como en los demás bancos): corregido en el commit `8cab4f6a6c`,
  cuya corrida (43107334440) cerró los 10 pasos del workflow en verde
  (223 + 38 + 38 + 31 + 58 + 30 + 46 = 464 chequeos). Las filas 8, 9 y 10
  pasan a ✅.

- **Tanda H-1/H-2/H-3 (2026-11-11):** web de Mi Negocio republicada con la
  lectura normalizada; `telegram-webhook` redesplegada en Supabase desde las
  fuentes de la casa y su espejo (`supabase/functions/_shared/telegram-pro.ts`)
  refrescado byte a byte en el repo; el banco v146 entró en `bancos/` y en el
  workflow (10 pasos); los pines de versión de las copias de `bancos/` se
  actualizaron a 1.4.6/v14 (las corridas salían en rojo solo por V1–V3); el
  fixture `bancos/fixtures/mercado-logica.js` se refrescó con la lógica
  corregida del lector (la de `ratioDe()`); el fixture del cierre se regeneró
  de la definición VIVA desplegada. Suites: 464 chequeos verdes en local
  y 464 en la simulación exacta del repo, todo en verde salvo el hallazgo vigilado
  H-4. La cola de GitHub se liberó durante la propia tanda (~21:52 UTC) y
  la corrida final 43107334440 (commit `8cab4f6a6c`) cerró el workflow
  completo en verde — ver la resolución en la nota siguiente.

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
  `bancos/fixtures/cierre-semana.sql` (bloque de `admin_generar_cierre` tal
  como quedó desplegado en la base viva el 2026-11-11): si la fórmula cambia
  en la base, el fixture se regenera de la definición viva y las anclas del
  banco avisan.

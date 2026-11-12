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
| 12 | Puerta de acción del Nivel 1 — barandas con mock (nunca contra la QvaPay real): el collar niega con la tarifa del instante, veto por foto de más de 20 min (reloj de recepción), DETENER y pausa bloquean antes que todo, topes $40/oferta · $120/día · 2/hora · enfriamiento 10 min, doble lectura con banda de 5, una sola oferta automática abierta, `P2P_SIDE_NOT_ALLOWED` pausa todo con el motivo en claro y sin bucle, el tercer error seguido pausa, y la idempotencia: un segundo toque con la misma acción NO crea dos ofertas | 2026-11-11: el Nivel 1 crea ofertas reales con el toque de Ernesto — cada baranda del Estudio 2 §3 tiene que estar probada ANTES de que exista el primer botón | `bancos/prueba-actuar-v1.mjs` (43 aserciones; la ganancia de la puerta se barre idéntica a la del Analista) | ✅ Sí |
| 13 | La pantalla «Analista» de la app Mercado: la señal con dos relojes, el peldaño bloqueado con su porqué, el estado DETENER activado con su Reanudar, la foto vieja marcada «DATO VIEJO», la transferencia con B_ej y B_max en las dos notaciones, el texto anti-humo y la línea de la señal en Ahora | 2026-11-11: refuerzo de diseño de Ernesto — la pantalla nace a nivel DISENO-PRO completo y sus estados diseñados (sin datos, foto vieja, detenido, bloqueado) quedan fijados por banco | `bancos/prueba-mercado-v2.mjs` — secciones B (v1 íntegro) y D (S6–S9) | ✅ Sí |
| 14 | UNA sola vía de textos también en Mi Negocio (v10): existen los 3 botones inteligentes (saldo · transferencia · producto) y el formulario manual viejo está AUSENTE (ids `txGen`/`txProd`/`txPrecio`/`txMoneda`/`txTipo`/`txCant`/`txDet`/`txCond`/`txPrivado`); el texto de producto nace de SU plantilla real de Facebook (gancho 🚨 SE VENDE, precio o «por privado», ✅, 📍 Micro 10 distrito José Martí, 📲 51231558) desde el motor compartido `textoRapidoProducto`; y Mi Trabajo NO gana el botón de producto ni textos del dueño | 2026-11-11 (18:51, captura de Ernesto): en Mi Negocio convivían los botones nuevos Y el formulario viejo completo — el MISMO defecto amputado en Mi Trabajo por la mañana (fila 2) que aquí seguía vivo: el generador viejo era además la fuente del teléfono/zona de los botones nuevos | `bancos/test-minegocio-banco.mjs` — TX-1…TX-8 · `bancos/prueba-mitrabajo-v147.mjs` — T1–T3 | ✅ Sí |
| 15 | La Actividad de Mi Negocio habla en su lenguaje: los 16 tipos del catálogo real de la tabla `actividad` tienen frase humana completa (qué pasó, a quién por su NOMBRE — la cuenta PEUEBA se lee «cuenta de prueba» —, cuánto con su unidad y su dimensión: salida-efectivo ≠ libro-transferencia), NINGÚN UUID se ve en la vista normal y el detalle técnico nace plegado tras «ver detalle» | 2026-11-11 (18:51, captura): el registro se pintaba crudo (`pagar_comision` + JSON + UUID) — inentendible para el dueño de la app | `bancos/test-minegocio-banco.mjs` — AC-1…AC-9 | ✅ Sí |
| 16 | Chat duro en AMBAS apps (el kit es paralelo: cada arreglo se aplica dos veces): la operación de chat lleva SIEMPRE el dato del adjunto + su duración + la referencia (enviar y oír ya no dependen de recuperar el Blob de IndexedDB); la duración de la voz sale del TEMPORIZADOR al grabar y el reproductor la pinta al instante; al tercer fallo la burbuja pasa a «⚠ sin enviar» / «⚠️ No se pudo enviar» con reintento al toque y la cola NO la reintenta sola ni queda bloqueada por ella; el clip 📎 abre la FOTO en un toque (la hoja, a presión larga) y foto+texto sale como UN solo mensaje | 2026-11-11 (18:51, captura): audio propio atascado en 🕐 con duración 0:00 que ni se enviaba ni sonaba (la nota viajaba solo como referencia a un Blob que el iPhone no devolvió; la cola tragaba el error en silencio) y mandar una foto costaba 3 toques de app | `bancos/test-minegocio-banco.mjs` — CH-1…CH-6 · `bancos/prueba-mitrabajo-v147.mjs` — C1…C9, P1–P3 | ✅ Sí |
| 17 | Ninguna puerta RPC tiene gemelas EN EL SERVIDOR y todo llamador manda el juego completo: `enviar_mensaje`, `leer_chat` y `registrar_reporte` con UNA sola firma viva (DROP de las legadas por Management API), `barrer_temporales()` con el SET válido (sin alias), Mi Negocio manda el juego completo + `p_op_id` igual que Mi Trabajo (fila 7), el error de la puerta NUNCA se pinta crudo en la burbuja (español llano + «ver detalle» plegado), el editor de foto a pantalla completa (pie + botón redondo, un solo mensaje) existe en AMBAS apps y el botón «Editar» de Mi Trabajo encuentra el reporte por su UUID (comparación por cadena) | 2026-11-11 (captura de Ernesto, 20:25): foto+texto no salía de Mi Negocio — «Could not choose the best candidate function» pintado crudo en la burbuja; eran DOS causas apiladas: la ambigüedad de sobrecargas (PGRST203) y, debajo, `barrer_temporales()` con `set m.borrado = true` (SQL inválido, 42703) que mataba TODA llamada que sí resolvía, también las de Mi Trabajo con el juego completo. El «Editar» muerto: Number(uuid) = NaN (la otra mitad de la fila 20) | `bancos/prueba-puertas-sin-gemelas.mjs` — E1–E7 (puertas únicas en el código), MN-1…MN-5 y MT-1/MT-2 en jsdom, V1–V2 vivas contra pg_proc (con SUPABASE_PAT) | ✅ Sí (E + jsdom en CI; la parte viva se corre en cada tanda que toque puertas) |
| 18 | Bot PRO — enseñanza del Agente y citas: los callbacks del agente se reconocen y validan (`c:<uuid>:a|r` citas · `g:<uuid>:s|d|e|x|t` grupos · `y:<uuid>:<dato>` dato vivo · `k:<faq>:f` / `k:<faq>:d:<dato>` cifra), un intruso NO decide citas ni enseña, el dueño confirma la cita por la puerta `agente_cita_decidir`, «Sumar frase» pasa por `agente_ensenar_sumar`, «Responder yo» deja la espera y el dictado llega a `agente_ensenar_responder` limpiando la espera; el teclado del dueño trae «❓ Enseñar» y la emisora `avisos` pinta los botones de cita | 2026-11-11: nace el Agente Propio (Fase 1) — su enseñanza vive en el bot del dueño y las citas le llegan con botones; sin banco, un callback mal formado podría decidir o enseñar sin ser Ernesto | `bancos/test-telegram-pro-banco.mjs` — TP-31…TP-46 | ✅ Sí — verde en local (46/46); entra en CI con esta tanda (su corrida en la nube depende del push) |
| 19 | Agente Propio — la puerta de clientes: precios trampa (PT), inyección (IN), escalados de dinero/humano (ES), frescura (FR), citas estructuradas 9–18 (CI), registro y enmascarado RG-1 (RG), aprendizaje sin vigía (AP: agrupar, enseñar, responder lo enseñado; la cifra fija dictada por Ernesto es su fuente y la misma cifra sin su origen queda BLOQUEADA por el verificador), arnés dorado de 126 paráfrasis con precisión ≥90 % y falsos de hierro = 0, y simulador de conversaciones. PUERTA: PT/IN/ES al 100 % o el widget no se publica | 2026-11-11: Ernesto aprobó el plano v1 + adenda v2 (cero vigía) + ampliación «algoritmo súper desarrollado» — el asistente habla con clientes reales sobre precios: una cifra sin fuente o una inyección obedecida es dinero perdido | `bancos/prueba-agente-v1.mjs` — 66 aserciones + métricas del arnés (precisión 100 % · cobertura 96,8 % en la corrida de nacimiento) | ✅ Sí — verde en local (66/66); entra en CI con esta tanda; ciclo AP completo verificado EN VIVO contra la base (agrupar → enseñar → cifra fija → responde) el 2026-11-11 |
| 20 | Botón por peldaño en la app Mercado («Crear oferta a esta tasa») con estados honestos: botón vivo SOLO en peldaños sanos con libro y foto de ≤20 min; SIN botón si G<0/bloqueado, si DETENER o la pausa están activos, o si la foto pasó de 20 min (con el porqué escrito bajo el menú); «Congelado por la promo» visible pero DESHABILITADO solo si la promo está activa Y `mercado_config.accion_app_respeta_promo` = true — con el flag en FALSE (decisión de Ernesto 2026-11-11 21:04: «mi toque manda siempre») el botón queda vivo en promo y la orden entra por `mercado_accion_app` a la MISMA puerta `mercado-actuar`, cuyas barandas no se tocan; la hoja de confirmación trae monto de la config, tasa del peldaño, G por 360 y hora de la foto, y el desenlace pinta la ganancia REAL del collar. Y la regla anti-corte en TODA la app: `.fila-sub` envuelve siempre (sin `nowrap`/ellipsis) y `.fila-cuerpo` puede encogerse (`min-width: 0`) — ninguna descripción se corta a la derecha en ninguna pantalla | 2026-11-11 (21:02, capturas de Ernesto): las descripciones de Promos se cortaban a la derecha («Promoción ETECSA ×5 del 9 al 14 de no…») porque la clase `.fila-cuerpo` NO existía en el CSS (la columna no podía encogerse y `.lista` recortaba la fila) y `.fila-sub` cortaba con ellipsis; y la pantalla Analista «era una foto»: informaba sin dejar actuar | `bancos/prueba-mercado-v2.mjs` — sección E (E1–E9; la suite pasa de 139 a 160) · paquete SQL en `research_notes/analista-app-boton-sql-2026-11-11.sql` (camino feliz probado contra la base viva en BEGIN…ROLLBACK: 1 fila dentro de la transacción, 0 tras el rollback) | ✅ Sí |
| 20 | Residuales de servidor: ninguna puerta puede quedar con un tipo que su tabla no tiene ni devolver una forma que su llamador no lee — `editar_reporte` firma `p_id uuid` (= `reportes.id`) y su UPDATE escribe `telefono_vendedor`; `leer_perfil` devuelve el superset estable: campos planos Y `{ok, perfil}` a la vez (Mi Trabajo lee plano, Mi Negocio lee envuelto); una sola firma por puerta (pg_proc) | 2026-11-11: `editar_reporte` nació con `p_id bigint` contra la columna uuid — toda corrección de un buscador moría con 22P02 en PostgREST, y su UPDATE apuntaba a la columna inexistente `telefono` — y `leer_perfil` devolvía solo la forma envuelta, así que el perfil del buscador nunca bajaba del servidor a Mi Trabajo | Verificación viva por REST (antes 22P02 → después P0001 «reporte no valido» con id inexistente) + pruebas transaccionales BEGIN…ROLLBACK del camino feliz de ambas puertas (residuo 0) el 2026-11-11; bancos de apps sin fallos atribuibles a estas puertas | ✅ Sí — verificado en vivo el 2026-11-11 |
| 21 | La barra inferior de Mi Trabajo se pinta COMPLETA (las 6 pestañas dentro de foto): su regla `.tabbar` propia se declara completa — `transform: none; width: auto; max-width: none` — porque el `tema-pro.css` que la app enlaza ANTES de su estilo trae la `.tabbar` centrada del sistema (`left:50%; transform: translateX(-50%); width:100%; max-width:560px`) y todo lo no redeclarado se cuela en cascada y corría la barra media pantalla. El estilo computado de la barra sobre el build ensamblado (con y sin `body.locked`) da transform «none». Barrido: en el maestro la regla es UNA sola y coherente (barra centrada, la usa la muestra del sistema) y en Mi Negocio va sin competidora (su barra es `.tabs`) — la cura vive SOLO en la regla de Mi Trabajo, no se tocó el maestro | 2026-11-11 (noche): los Ojos Android y Web fotografiaron la barra con solo 3 de 6 pestañas (Calculadora, Reportar y Mi panel fuera de imagen, bounds [0,0][0,0] en el emulador); el diagnóstico midió al píxel en Chromium la barra en x=−178 con transform matrix(−192) y aisló la cadena causal en las dos reglas; la medición del estado desbloqueado (jsdom, estilo computado) confirmó el transform fantasma también dentro de la app antes de tocar nada | `bancos/prueba-barra-inferior.mjs` — B1–B6 (fuente, build y estilo computado en los dos estados) + foto del Ojo Web (`ojo-web-mitrabajo`) con la barra completa | ✅ Sí |
| 22 | CHAT PRO — el refresco del hilo JAMÁS toca el compositor: en Mi Negocio el compositor `#chTexto` y el buscador `#chBuscar` viven en un esqueleto estático FUERA de `#chHilo` (la v11 reconstruía `#pgChat` entero con `innerHTML` cada 3 s y el nodo enfocado moría: foco a BODY y teclado cerrado en iOS, que no se resucita por código); en AMBAS apps el hilo se repinta INCREMENTAL por nodos con clave (la burbuja que ya estaba conserva su nodo; la clave de voz sale del ID del mensaje, no de su posición) y con disciplina de scroll (si el usuario lee arriba o compone, el refresco no lo arrastra; pegado abajo, sigue al final). Tras un repintado directo Y tras 2 ciclos reales del temporizador: mismo nodo, conectado, `activeElement` = compositor, valor y selección intactos — sonda automática, no opinión. TEXTOS (MN) con MODO real: «producto» ya no es un toggle huérfano — saldo/transferencia CIERRAN su formulario, el modo activo se marca y toda generación trae la salida a la vista. HOJA 📎 NUEVA en ambas (sustituye el contrato de la fila 16 «foto en un toque, hoja a presión larga», retirado por orden directa de Ernesto): UN toque en el clip abre la hoja (Foto o vídeo · Cámara · Documento) y cada fila dispara SU selector sincrónicamente en el mismo gesto (`capture` en Cámara); la sensación WhatsApp se completa en la vista previa con texto antes de enviar | 2026-11-12 (07:38, capturas de Ernesto probando Mi Negocio v11 en su iPhone): el teclado se cerraba en milisegundos al ir a escribir con Briku, Textos se quedó bifurcado en «producto» sin poder volver a «saldo» y el 📎 le pareció «programación básica». Diagnóstico por hipótesis con sonda (`research_notes/chat-pro-estudio-2026-11-12/`): D2 = `pintarChat()` total (H1 confirmada; refutadas borrador roto y robo por presencia), D1 = toggle sin modo + salida fuera de pantalla (H1+H5 confirmadas). Hallazgo lateral curado por construcción: en Mi Trabajo las claves de voz por contador + el borrado de `vozDatosMT` en cada repintado dejaban las notas del hilo con claves que ya no coincidían con el DOM | `bancos/prueba-foco-chat.mjs` — MN-0…MN-5e y MT-0…MT-4d (33 aserciones; nació con 17 FAIL sobre v11/v1.4.9, incluidos los 2 ciclos reales en jsdom) + CH-6a/CH-6b en `bancos/test-minegocio-banco.mjs` y C8 en `bancos/prueba-mitrabajo-v147.mjs` actualizadas al contrato nuevo + CAZA EN VIVO del Ojo Web (`ojo-web-chat`): Chromium real escribiendo en el compositor durante los ciclos con registro de `activeElement`/valor por ciclo y la secuencia producto→saldo→transferencia fotografiada — álbum `ojo-web/chat-pro/` | ✅ Sí |

| 23 | AGENTE v2 — textos limpios, panel único y modo dueño: ningún texto al cliente lleva notas internas («dato de la ficha» / «actualizado») — la trazabilidad (fuente + hora del dato) vive en la auditoría (`fuentes_detalle`); «Ver precios» y «precios» a secas JAMÁS vuelcan: abren el MENÚ de temas — en Telegram el PANEL ÚNICO que se EDITA a sí mismo (`editMessageText`, un solo mensaje por conversación, secciones con [⬅️ Atrás]/[🏠 Inicio] y la cita viviendo dentro del panel; en la web, chips de temas) —; el MODO DUEÑO solo existe para `dueno_tg_id` (/admin o /panel dueno de un cliente = no_se): horario, precio público del corte y textos de FAQ se cambian por flujo estructurado con confirmación en botones, parche validado contra `agente_fuente`/`agente_catalogo`/`agente_faq`/`agente_config` e inverso guardado (`agente_conversaciones.dueno_ultimo`) pa «Deshacer», y pausar = `detenido` con bypass SOLO del dueño pa poder reanudar desde su chat; la capa conversacional redacta SOLO sobre la proyección pública y su salida pasa por `validarRespuestaCerebro` (hierro + verificador de cifras) — **CEREBRO ACTIVO desde el 2026-11-12 con Cloudflare Workers AI** (`CEREBRO_PROVEEDOR=cloudflare`, modelo `@cf/meta/llama-3.1-8b-instruct-fast`, token «Agente Ernesto Cerebro» Workers AI Leer+Editar guardado en `~/workspace/.secure/cerebro-cloudflare.env`, secretos `CEREBRO_*` fijados en la función; la función lee el entorno por invocación, sin redespliegue): humo en vivo por el canal web el 2026-11-12 — pregunta libre (apagones) → ruta cerebro auditada en `agente_mensajes` (`accion: cerebro`, `cerebro: cloudflare-workers-ai`, texto compuesto solo con datos públicos, precio de la batería remitido «al privado», sin cifras internas ni notas de ficha) y FAQ de horario → ruta determinista (`accion: responder`, FAQ exacta, puntaje 100); sin entradas `cerebro_rechazado` en `agente_acciones` | 2026-11-12 (capturas de Ernesto re-probando el bot): «Ver precios» soltó TODO en un mensaje gigante «súper regado» y con la nota interna «(dato de la ficha, actualizado 9:43 p. m.)» visible al cliente; pidió además un panel navegable en UN solo mensaje («que no se llene de mensajes el chat»), poder pedirle cambios al bot como admin desde el propio chat y que la IA funcione como guía respondiendo a los clientes | `bancos/prueba-agente-v1.mjs` — LIMPIO-1 · PANEL-1…6 · MENU-1…4 · DUEÑO2-1…17 · CEREBRO-1…5 · FR-1/FR-1b y CMD-3 reescritas (la suite pasa de 81 a 115 aserciones) + humo vivo auditado: navegación del panel contada en `agente_acciones` (1 mensaje nuevo, el resto editados, `panel_msg_id` constante) y un cambio de horario real aplicado y deshecho contra la base viva | ✅ Sí |

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
  pasa de v1 a **v2** (`bancos/prueba-mercado-v2.mjs`, 139 chequeos: los 58
  del v1 íntegros + INV-A y el render de la pantalla Analista); el v1 se
  retira de `bancos/` y del workflow. Los módulos puros del Analista y de la
  puerta viven fuera del repo (en `mercado-src`), por eso el banco los
  importa de fixtures vendorizados (`bancos/fixtures/mercado-analista.js`,
  `bancos/fixtures/actuar-logica.js`) que se refrescan cuando las fuentes
  cambian, como el fixture del lector.

- **Hallazgos de la PRIMERA foto viva del Analista (2026-11-12 00:00 UTC),
  corregidos en la misma tanda:** la sonda capturó los campos reales del
  payload y destapó tres supuestos falsos de la primera versión: (1) la
  reputación de contraparte vive en `User.rating_avg` / `User.rating_count`
  (no en los nombres supuestos): `reputacionDe()` los lee primero y las
  marcas ya salen de datos reales; la sonda además guarda la FORMA de
  `User._count` por si esconde el conteo de operaciones. (2) La oferta
  propia viva de Ernesto era de COMPRA y su tipo se había aprendido en
  `mercado_config.crear_tipo`: la puerta quedó BLINDADA — la base solo
  puede ser una oferta suya de VENTA y el `type` del create es «sell»
  siempre (aserciones nuevas en el banco de la puerta con su compra real
  de ejemplo); el `crear_tipo` aprendido se limpió de la config y el
  lector solo aprende «sell». (3) La API lista ofertas con
  `available_amount = 0` (reservadas/agotadas): la escalera ya no crea
  niveles fantasma con ellas y las ventas anómalas exigen disponible > 0.
  Bancos tras la corrección: Mercado v2 = 139, puerta = 43.


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

- **Tanda de 3 errores (2026-11-11, capturas de las 18:51):** Mi Negocio sube a
  **v10** y Mi Trabajo a **v1.4.7** (el kit de chat/medios es PARALELO en las
  dos apps — no un archivo compartido — así que cada arreglo del chat se aplicó
  dos veces; lo único compartido de verdad es `shared/textos-motor.js` y
  `shared/push-cliente.js`). **Barrido lateral de la tanda (obligatorio desde
  hoy):** Textos únicos → barridas Mi Negocio (arreglada) y Mi Trabajo (ya
  estaba bien desde la v1.4.6; se fijó con T1–T3 que no gana el botón de
  producto); Actividad → solo existe en Mi Negocio (Mi Trabajo no tiene esa
  pantalla); chat/medios → barrido en AMBAS apps (mismo kit, mismos defectos:
  chip sordo de voz en cola, duración por metadato y fallo mudo también en Mi
  Trabajo); la puerta de pago → su gemela de Telegram ya distinguía
  `ya_pagado` (no se tocó). **SQL desplegado:** `admin_marcar_pagado` audita
  SOLO si esa llamada selló el pago — el duplicado `pagar_comision` ×2 de la
  captura era la cola re-despachando tras perder la respuesta (el sello y el
  dinero siempre fueron únicos; la auditoría mentía). Verificado en la base
  viva con transacción desechable BEGIN…ROLLBACK: 2 llamadas → 1 fila de
  actividad y `ya_pagado` honesto; el paquete quedó en
  `research_notes/pagar-idempotente-sql-2026-11-11.sql`. La fila duplicada
  histórica (ids 6–7) NO se borra: la auditoría es append-only y ya quedó
  explicada. Suites: MN 246 · MT 38+38+31+16 · invariantes 46 · Mercado 139 ·
  bot 30 · actuar 43, todo en verde en local antes de publicar.
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

- **Tanda foto+texto (2026-11-11, captura de las 20:25):** Mi Negocio
  **v11** y Mi Trabajo **v1.4.8** (fila 17). En el servidor, por
  Management API y con respaldo previo de las 8 definiciones en
  `research_notes/respaldo-funciones-chat-2026-11-11.sql`: DROP de
  `enviar_mensaje` (11 params), `leer_chat` (3) y `registrar_reporte`
  (7 y 9); `barrer_temporales()` recreada sin el alias en el SET.
  Verificación por PostgREST antes/después con las formas exactas de
  ambas apps: 300 PGRST203 / 400 (42703) → 200 con id, y el mismo
  `p_op_id` dos veces devuelve `duplicado` (idempotencia intacta).
  Barrido lateral: PanelPRO v7 (Scriptable) manda los mismos
  subconjuntos que Mi Negocio → la resolución única lo devuelve a la
  vida sin tocarlo (su cola no deduplica en servidor, igual que antes
  de la era de las gemelas); queda anotado por si una tanda suya le da
  el juego completo. Hallazgo lateral aplicado en la misma tanda: el
  «Editar» de Mi Trabajo (Number(uuid) = NaN) ahora compara por cadena
  (banco MT-2). Gap observado y NO tocado: la `leer_chat` viva no
  devuelve `fijado`/`temporal_seg` de nivel superior que ambas apps
  leen (degradan a null/0 en silencio) — candidato a su propia fila si
  un día se formaliza. Bancos locales al cierre: Mi Negocio 246 ·
  Mi Trabajo 38+38+31+16 · puertas-sin-gemelas 24 (con la parte viva) ·
  Mercado 139 · actuar 43 · bot 30 · invariantes 46 PASS con el
  hallazgo H-4 vigilado de siempre.

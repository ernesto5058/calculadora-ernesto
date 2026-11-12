# REGRESSIONS — el registro trinquete

Qué es: una línea por fallo real cazado. **NUNCA se borran líneas** de este registro: es un trinquete, solo crece. Cada entrada enlaza su chequeo eterno en [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) (o el banco que lo cubre), para que el mismo fallo no pueda volver sin que salte una alarma. Ver también [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md).

Cada entrada lleva: fecha · síntoma · causa raíz · chequeo eterno.

---

## 2026-11-12

### 1. El bot promete el pin y no lo envía

- **Fecha:** 2026-11-12
- **Síntoma:** En Telegram el bot dijo dos veces «te la mando ahora» sin `sendLocation` alguno.
- **Causa raíz:** Los seguimientos «?»/«Si» caían al cerebro, que prometía acciones sin veto y nadie ejecutaba ni registraba el envío.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 25 · `bancos/prueba-agente-v1.mjs` (PIN-4…7, PROM-1…4) + humo real con `message_id` en `agente_acciones`.

### 2. El parser de citas re-preguntó la hora

- **Fecha:** 2026-11-12
- **Síntoma:** Ernesto dijo «Hoy a las 2:00 pm» y el flujo preguntó «¿a qué hora?».
- **Causa raíz:** Cada paso del flujo leía solo el dato de su paso y tiraba el resto del mensaje.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 26 · `bancos/prueba-agente-v1.mjs` (CI-4…CI-11).

### 3. La cita se creó sin control del dueño

- **Fecha:** 2026-11-12
- **Síntoma:** La cita caía en `agente_citas` sin aviso accionable ni vista en el bot de clientes y el cliente no se enteraba del desenlace.
- **Causa raíz:** La superficie de decisión vivía solo en el bot de gestión.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 26 · `bancos/prueba-agente-v1.mjs` (CIT-1…CIT-9) + puerta SQL `agente_cita_decidir`.

### 4. El cerebro “confirmó” una cita de palabra

- **Fecha:** 2026-11-12
- **Síntoma:** Un `/citadec` de un no-dueño cayó a la capa conversacional y el cerebro improvisó «tu cita está confirmada» sin tocar la base.
- **Causa raíz:** Los textos que empiezan con «/» entraban a la capa conversacional.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 26 · denegar determinista + guarda en la puerta.

### 5. La puerta del Analista negó por detalles_desconocidos

- **Fecha:** 2026-11-12
- **Síntoma:** La primera venta real por la app fue negada: la baranda exige que `details` de la oferta propia sea un array y el registro de formas se había capturado del libro público, que no trae `details`.
- **Causa raíz:** La forma real de la vista del dueño nunca se registró.
- **Chequeo eterno:** banco `bancos/prueba-actuar-v1.mjs` (casos `forma_details` de la fase 2, 52 aserciones) · fila en CHEQUEOS: pendiente de numerar.

### 6. Las puertas base de Mi Negocio no tenían fuente en el repo

- **Fecha:** 2026-11-12
- **Síntoma:** Las definiciones vivas de las puertas RPC de Mi Negocio existían en Supabase pero su SQL no estaba versionado en ningún repo: no auditable ni recuperable (Inspector Ola 1, F-1/E-5).
- **Causa raíz:** Las puertas base se crearon fuera del flujo de paquetes SQL versionados del repo.
- **Chequeo eterno:** Respaldo vivo en `supabase/sql/puertas-minegocio-vivas-2026-11-12.sql` (33 puertas volcadas con `pg_get_functiondef`, 0 faltantes, 0 sobrecargas) + banco `bancos/prueba-puertas-sin-gemelas.mjs`; toda puerta nueva nace con su `.sql` versionado en la misma tanda.

### 7. El tope de sesión del agente era «de por vida» disfrazado de «por hoy» (E1)

- **Fecha:** 2026-11-12
- **Síntoma:** El conteo de mensajes de la conversación no filtraba por fecha ni eximía al dueño: cualquier cliente (y el propio Ernesto camino de su /admin) quedaba bloqueado para siempre al llegar a 40 mensajes, con un texto que mentía «por hoy».
- **Causa raíz:** La consulta a `agente_mensajes` traía toda la historia de la conversación sin filtro `creado_en` y la guarda no conocía `esDuenoTg`.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 28 · `bancos/prueba-agente-puerta.mjs` (E1-1…E1-8, F-2…F-4).

### 8. El tope global diario del agente existía en la config y nadie lo aplicaba (E2)

- **Fecha:** 2026-11-12
- **Síntoma:** `agente_config.tope_conversaciones_dia` (100) no lo leía la puerta y no había tope global de avisos: un script podía crear sesiones ilimitadas, quemar el cerebro e inundar de avisos al dueño.
- **Causa raíz:** La puerta solo implementaba el tope por sesión; el contador diario de conversaciones nuevas y el de avisos de escalado/lead nunca se construyeron.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 28 · `bancos/prueba-agente-puerta.mjs` (E2-1…E2-9, F-5, F-6).

### 9. La puerta del agente era fail-open ante su propia config y su clave web (E5)

- **Fecha:** 2026-11-12
- **Síntoma:** Si `agente_config` no se podía leer, el agente atendía como si nada (frenos en `{}`), y sin `AGENTE_WEB_KEY` en el entorno la web entraba sin clave alguna.
- **Causa raíz:** `leerTabla` traga errores y devuelve `[]` (fallo indistinguible de vacío) y la guarda web solo actuaba cuando la clave existía.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 28 · `bancos/prueba-agente-puerta.mjs` (E5-1…E5-4, F-7…F-9).

### 10. La conversación escalada quedaba muda para siempre (E6)

- **Fecha:** 2026-11-12
- **Síntoma:** Una vez `escalada=true`, la conversación recibía silencio eterno: ni a las semanas volvía a ser atendida.
- **Causa raíz:** Nada limpiaba jamás `escalada` en `agente_conversaciones`; no existía caducidad del escalado.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 28 · `bancos/prueba-agente-puerta.mjs` (E6-1…E6-4, F-10).

### 6. El cerebro confirmaba citas, inventaba stock y soltaba enlaces

- **Fecha:** 2026-11-12
- **Síntoma:** Las 7 sondas del Inspector pasaron con «ok» en `validarRespuestaCerebro`: cita «CONFIRMADA», baterías «disponibles» inventadas, un enlace de pago falso, lavadora «gratis hasta Holguín mañana», «precio especial» y la negación de anotar citas y del catálogo entero.
- **Causa raíz:** El validador solo vigilaba cifras y dos regex estrechas (`niega_capacidad`/`promete_accion`): ningún veto por tema.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 29 · `bancos/prueba-agente-v1.mjs` (E3-1…7 vetadas con su motivo, E3-B1…4 buenas que siguen pasando).

### 7. La aclaración y el saludo se saltaban el verificador de cifras

- **Fecha:** 2026-11-12
- **Síntoma:** La FAQ de texto «El desriz cuesta 925 CUP…» (925 = cifra interna) quedaba bloqueada por la pregunta directa, pero respondiendo «1» a la aclaración salió el 925 literal; el saludo tampoco verificaba su texto.
- **Causa raíz:** `resolverAclaracion` devolvía `respuesta_texto` crudo sin pasar `verificarCifras`, y la rama de saludo de `orquestar` hacía lo mismo.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 29 · `bancos/prueba-agente-v1.mjs` (E4-1…8: las tres rutas envenenadas devuelven el «no sé» del verificador; la cifra fija de origen «ernesto» sigue saliendo).

### 11. La puerta del Analista no reclamaba la acción: dos ejecuciones podían crear dos ofertas (E-1)

- **Fecha:** 2026-11-12
- **Síntoma:** Latente, cazado por el Inspector sin disparo real: dos ejecuciones simultáneas de la misma acción (doble toque o reintento) pasaban todas las barandas en paralelo y podían crear dos ofertas de $40 burlando topes y enfriamiento; dos acciones distintas en paralelo corrían la misma suerte porque el conteo solo contaba «ejecutada».
- **Causa raíz:** Leer → barandas → crear sin compare-and-swap en ningún punto; el PATCH final no llevaba condición de estado.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 30 · `bancos/prueba-actuar-v1.mjs` (CONC-1…CONC-4) + reclamo CAS con columna `reclamada_en` (migración `mercado-src/supabase/sql/mercado-v3-reclamo-atomico-2026-11-12.sql`).

### 12. La bitácora de la puerta guardaba los datos de pago en claro (E-6)

- **Fecha:** 2026-11-12
- **Síntoma:** Latente, cazado por el Inspector: cada desenlace con payload guardaba en `mercado_acciones.detalle` el payload completo, con los `details` de pago de Ernesto en claro y pa siempre, duplicados en cada fila.
- **Causa raíz:** La bitácora guardaba el mismo objeto payload que se enviaba a QvaPay, sin redacción.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 31 · `bancos/prueba-actuar-v1.mjs` (BIT-1…BIT-4) + purga verificada en producción (0 filas con `detalle->'payload' ? 'details'`).

### 13. El botón de la app reutilizaba cualquier acción pendiente y confirmaba la tasa pedida (E-2)

- **Fecha:** 2026-11-12
- **Síntoma:** `mercado_accion_app` podía reutilizar y disparar una acción pendiente de Telegram (otra tasa, otro origen — y sin la exención de promo del toque manual) y responder a la app la tasa del peldaño pedido en vez de la ejecutada (cazado por auditoría, sin disparo cruzado constatado).
- **Causa raíz:** El select de reuso filtraba solo `estado='pendiente' and expira_en > now()`, y el `return` final se armaba desde `v_pel`/`v_cfg` en vez de leerse de la acción fijada.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 32 · paquete `research_notes/analista-app-boton-fix-e2-sql-2026-11-12.sql` verificado en vivo (definición + BEGIN…ROLLBACK, residuo 0).

### 14. La v3 de Mercado existía solo en el desplegado: la fuente era v2 (F-1)

- **Fecha:** 2026-11-12
- **Síntoma:** Los botones por peldaño (`mercado_accion_app`) y el CSS anti-desbordamiento de la carcasa vivían solo en el `index.html` servido; la fuente `app.js` seguía en v2 y correr `ensamblar.py` habría borrado el botón de publicar y bajado la caché a v2 en silencio.
- **Causa raíz:** La v3 se editó sobre el artefacto desplegado y nunca volvió a la fuente: se quebró la regla de oro de una sola fuente de verdad.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 33 · `bancos/prueba-mercado-paridad.mjs` (P-1…P-3) — v3 rescatada íntegra a fuente + plantilla y ensamblar en v3.

### 15. La pantalla Equilibrio explicaba la ganancia al revés (E-3)

- **Fecha:** 2026-11-12
- **Síntoma:** El texto guía decía «si vendes por encima de ella ganas; por debajo, pierdes» cuando G(R) decrece con R: creerlo era publicar perdiendo CUP por recarga convencido de que ganaba, y contradecía a la tarjeta inferior de la misma pantalla y al aviso del lector.
- **Causa raíz:** Frase de dirección invertida en la fuente (y por tanto en el desplegado) sin ningún chequeo de texto contra la fórmula.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 34 · `bancos/prueba-mercado-paridad.mjs` (P-4: frase invertida prohibida, dirección correcta presente en fuente y desplegado).

## El dueño quedaba mudo en su propio bot si su conversación se escalaba
- **Fecha:** 2026-11-12
- **Síntoma:** con su conversación de Telegram marcada `escalada` (su propia pregunta de cliente la escaló), el `/admin` de Ernesto caía en el silencio de `orquestar` — cazado en el humo real de la tanda Nº4+5: el mensaje quedó registrado y jamás llegó panel.
- **Causa raíz:** el silencio por escalado (`logica.js`, inicio de `orquestar`) no distinguía dueño de cliente; las exenciones de dueño vivían en la puerta (pausa/topes) pero no en esta capa.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 28 · `bancos/prueba-agente-v1.mjs` (E6-D1/E6-D2: dueño escalado → su /admin responde; cliente escalado → silencio).

### 16. Mi Negocio cobraba con una tarifa que no era la viva (E-1 + E-8)

- **Fecha:** 2026-11-12
- **Síntoma:** `tarifa()` pisaba la fila viva (salida 925 CUP/QUSD) con la derivada de la calculadora interna sembrada de fábrica (salida 950) y la tarjeta la etiquetaba «Tarifa viva»; sin viva, TARIFA_DEF (950) entraba en silencio.
- **Causa raíz:** `derivadaCalc()` nunca devolvía null con los defaults de CALC_DEF, así que la derivada mandaba siempre sobre `leer_tarifa`.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 35 · `bancos/test-minegocio-banco.mjs` (T2-1…T2-5, T2-11…T2-13).

### 17. «Publicar ahora» reventaba contra la forma viva de datos.json (E-2)

- **Fecha:** 2026-11-12
- **Síntoma:** `construirBase()` esperaba `buscadores` como array y lanzaba TypeError con el archivo vivo (objeto por clave); además escribía las claves de bono viejas y el banco validaba una fixture muerta.
- **Causa raíz:** la forma del archivo cambió (objeto + claves bonoSaldoMeta/Monto) y ni el código ni la fixture del banco se actualizaron con ella.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 36 · `bancos/test-minegocio-banco.mjs` (T2-6…T2-10, caza C-1).

### 18. XSS almacenado por adjuntos en la app del dueño (E-3)

- **Fecha:** 2026-11-12
- **Síntoma:** el comprobante de un reporte y la foto de un mensaje se interpolaban crudos en `src="..."` (Bandeja y chat): un `adj_datos` con comilla y `onerror` ejecutaba script en el WebView donde vive el código admin.
- **Causa raíz:** dato de usuario a un atributo sin escapar ni validar; `esc()` ni siquiera escapaba comillas.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 37 · `bancos/test-minegocio-banco.mjs` (T2-14…T2-17, caza C-3).

### 19. El cerebro del Agente confirmaba citas de palabra por texto libre (PF-25 y hermanas)

- **Fecha:** 2026-11-12
- **Síntoma:** la batería promptfoo (corrida real, 24 PASS · 1 FAIL) cazó que un borrador del cerebro «Tu cita está confirmada para mañana a las 10.» pasaba `validarRespuestaCerebro` y saldría al cliente como una cita confirmada que nadie confirmó. La v2.5 (Tanda Nº4+5) cubrió esa frase exacta, pero las formas hermanas seguían vivas: «te agendo», «quedó reservado tu turno», «nos vemos mañana a las 10».
- **Causa raíz:** el veto `confirma_cita` original solo cazaba «confirmad*» y dos frases hechas; el invariante «el agente jamás confirma: confirma el dueño» no cubría ejecutar la reserva en primera persona, el participio cumplido ni dar la cita por hecha con día/hora. (Trampa hija: `normalizarLigero` borra los signos, así que distinguir la OFERTA en pregunta «¿Te anoto una cita?» de la afirmación exige juzgar los signos sobre una normalización que los conserva.)
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 39 · `bancos/prueba-agente-v1.mjs` (E5-1…9, E5-B1…8) · batería promptfoo PF-25 (25/25).

### 20. Los códigos viejos de los buscadores seguían vivos en el historial público

- **Fecha:** 2026-11-12
- **Síntoma:** la Tanda Nº1 sacó los códigos del archivo vivo, pero 20 commits del historial público del repo (desde 2026-11-10) conservaban los códigos viejos, que seguían siendo la llave de entrada a Mi Trabajo.
- **Causa raíz:** un secreto publicado una vez en un repo público no se des-publica quitándolo de la vista: queda en el historial; la única mitigación real es rotar el secreto.
- **Resolución:** rotación ejecutada el 2026-11-12 (aprobada por Ernesto) con el mecanismo de la casa `cambiar_codigo` — códigos nuevos solo en el llavero seguro y en la tabla `usuarios`; los viejos devuelven vacío en `validar_usuario` y el historial ya no abre nada. Sin valores en este registro.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 38 · `bancos/prueba-sin-codigos-publicos.mjs` (16/16 contra los códigos VIVOS de la base: ninguno puede aparecer en público).

### 21. Un vigía existía solo en la copia local y nadie lo notó (vigia-supabase.yml)

- **Fecha:** 2026-11-12
- **Síntoma:** el workflow del toque diario anti-pausa de Supabase estaba en la carpeta local de workflows pero la API de GitHub daba 404: nunca existió en el remoto ni corrió una sola vez en GitHub. El proyecto Free pudo pausarse por inactividad sin alarma alguna.
- **Causa raíz:** publicar «a mano» sin verificación de destino: el archivo local se tomó por desplegado, y ningún sistema exigía el latido de los vigías (nadie vigilaba a los vigías). La misma auditoría cazó el espejo desactualizado en el otro sentido (`vigia-mercado.yml` remoto más nuevo que el local) y los huecos reales de 4-8 h con que GitHub entrega los schedule.
- **Resolución:** workflow publicado por API y verificado (sha remoto == local, primera corrida success); espejo sincronizado en ambos sentidos; montado el vigía de vigías (función `vigia-cobrador` + tabla `vigia_estado` + ping `vigia-latido` pa el respaldo) con prueba de fuego real el mismo día.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 41 · el cobrador corriendo cada 5 min (su propio latido visible en `vigia_estado`) + la auditoría local↔remoto por hash como paso de montaje de toda pieza programada.

### 21. El Agente aceptaba citas imposibles contra un horario muerto, filtraba datos crudos al cerebro y dejaba escapar el hierro (Tanda Nº6)
- **Fecha:** 2026-11-12 · **Frente:** Agente de clientes (agente-responder v2.6 → v2.7)
- **Síntoma:** el flujo de citas completaba «10/10» en el pasado y convertía «31/02» en 3 de marzo (Date.UTC rueda sin validar), forzaba servicio «corte» contra un «no, no quiero corte», no tenía salida «cancelar» por texto y validaba las horas contra el 9–18 quemado en el código aunque el dueño hubiera movido su horario vivo; la pregunta cruda del cliente (con teléfonos y «mi pin es 4321» intactos, porque enmascarar exigía 12+ dígitos y el pin pegado) salía al proveedor externo del cerebro — E9 figuraba en el alcance prometido de la Tanda Nº5 pero nunca se implementó en v2.5/v2.6 —; un audio o foto en Telegram recibía silencio total; desde el bot de clientes el dueño no podía crear una respuesta nueva desde la cola de sin-respuesta (solo editar); la cita web no pedía contacto pese a existir la columna agente_citas.contacto; y «dame el número de Briku» o «quiero que me atienda alguien real» caían a no_se (al cerebro) en vez de denegar/escalar en el hierro.
- **Causa:** validación de fechas y horario nunca conectada a la fuente viva, enmascarado escrito solo pa tarjetas largas, la rama de Telegram sin caso no-texto, la escuela (RPC agente_ensenar_responder) sin puerta en este bot, y patrones de hierro que exigían artículo y palabras exactas.
- **Chequeo eterno:** [CHEQUEOS-ETERNOS.md](CHEQUEOS-ETERNOS.md) fila 42 · bancos/prueba-agente-v1.mjs (E7/E8/E9/M1/F2/F3) · bancos/prueba-agente-puerta.mjs (F1) · batería promptfoo PF-26…PF-32 (32/32).

### 22. El service worker de Mercado borraba las cachés de todas las apps del origen
- **Fecha:** 2026-11-12
- **Síntoma:** Al activarse el SW de Mercado, desaparecían las cachés de Mi Negocio y Mi Trabajo (mismo origen GitHub Pages): sus apps perdían el funcionamiento sin conexión hasta re-cachear.
- **Causa raíz:** El activate filtraba «toda caché que no sea la mía» (k !== CACHE) sin prefijo propio, y la Cache Storage se comparte por origen completo, no por carpeta.
- **Chequeo eterno:** CHEQUEOS-ETERNOS.md fila 41 · bancos/prueba-mercado-paridad.mjs (F-SW conductual, con prueba negativa: el SW viejo borraba minegocio-v13 y mitrabajo-v19).

### 23. Mi Trabajo pintaba texto del servidor sin escapar, su cola podía perder reportes y la tarifa de respaldo mandaba en silencio (Tanda Nº6)
- **Fecha:** 2026-11-12 · **Frente:** Mi Trabajo v1.5.2 → v1.5.3 (web)
- **Síntoma:** ~20 sitios de innerHTML sin escapar (una nota de trato o una reacción con HTML se inyectaba en el teléfono del buscador); la outbox de reportes podía sobrescribir un pendiente con una foto vieja y el evento online no la despachaba; el candado EN_PAUSA nunca se liberaba dentro de la sesión (buscadores mudos hasta reinstalar); la sesión guardada entraba sin validar contra el servidor; el sondeo del chat bajaba hasta 200 mensajes con adj_datos base64 cada 3 s; y el DEFAULT_TARIFA 950 actuaba como respaldo silencioso contra la tarifa viva.
- **Causa raíz:** plantillas innerHTML sin capa de escape compartida, guardados de la cola desde fotos locales viejas sin fusión por opId, pausa sin camino de liberación, y sondeo sin puerta ligera ni etiqueta de fuente pa el respaldo.
- **Resolución:** esc()/srcSeguroAdjMT en todos los constructores; sesión validada al arrancar/refrescar (revocado expulsa, sinred nunca); outbox fusionada por opId sobre la copia fresca y despachada en online+focus; pausa que se pone y se libera con validar_usuario.bloqueado; puertas nuevas leer_chat_ligero (≤50, sin adj_datos) + leer_adjunto bajo demanda; tarifa con su fuente a la vista («en vivo»/«publicada»/«⚠ RESPALDO»).
- **Chequeo eterno:** CHEQUEOS-ETERNOS.md filas 43, 44 y 45 · bancos/prueba-mitrabajo-v153.mjs (A1–A12 · E3/E4/E5/E6 · E7/E9/E18). Pendiente de build de APK: la copia congelada de la tarifa y el SW viejo de los assets («mitrabajo-v2», activate sin prefijo) se curan al re-ensamblar la APK 1.5.3.

### 24. El XSS de adjuntos de Mi Negocio estaba curado solo del lado cliente (Tanda Nº6)
- **Fecha:** 2026-11-12 · **Frente:** Mi Negocio — puertas enviar_mensaje y registrar_reporte
- **Síntoma:** la v13 escapó los adjuntos en la app del dueño, pero el servidor seguía guardando adj_datos crudo tal como llegaba (solo validaba tipo y un tamaño estimado que le pasaba el cliente): la defensa dependía de que ningún cliente mintiera.
- **Causa raíz:** validación de adjuntos pensada solo como presentación (cliente) y nunca como puerta (servidor); la definición de registrar_reporte ni siquiera estaba versionada en el repo.
- **Resolución:** helper public.adj_normalizar() aplicado en ambas puertas — base64 estricto, mime de lista blanca por tipo, firma mágica en imagen/PDF, ≤5 MB decodificado calculado en servidor y guardado solo en forma canónica; caza en vivo: 11 casos (legítimos pasan; XSS/data:text/html/mime mentido/firma falsa rechazados).
- **Chequeo eterno:** CHEQUEOS-ETERNOS.md fila 46 · supabase/sql/adjuntos-validacion-tanda6-2026-11-12.sql.

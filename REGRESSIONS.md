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

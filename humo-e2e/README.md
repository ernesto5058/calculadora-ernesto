# Humo E2E — flujos reales de navegador (TOP 6 del estudio de huecos)

**Qué es:** un robot en un navegador de verdad (Chromium, Pixel 7) recorre
los 4 caminos que duelen contra las URLs **públicas servidas**, con la
cuenta de prueba **PEUEBA**: entrar a Mi Trabajo y ver el panel, reportar
un trato y verlo en la lista, abrir Mercado y leer la foto viva del
libro, y preguntarle al chat de la paginita. Es el tramo que el banco
jsdom no ve: sesión real, red de verdad, la app tal como la sirve Pages.

**Cuándo corre:** a mano (workflow «Humo E2E — flujos reales», botón
*Run workflow*) como **puerta tras cada publicación** de Mi Trabajo /
Mi Negocio / Mercado / paginita: si sale en rojo, la publicación no se da
por buena hasta saber por qué. No corre en cada push pa no quemar
minutos ni generar datos de prueba sin que nadie los limpie detrás.

## Datos de prueba y su limpieza

La suite crea datos reales, todos **marcados**:

- **Un reporte** de PEUEBA con nota `HUMO E2E <id de la corrida>` (el id
  sale en el log de la corrida, línea `REPORTE_CREADO`). Vive en la tabla
  `reportes` y se ve en el panel de Ernesto como un reporte más de la
  cuenta de prueba hasta que se borra.
- **Una conversación web** del agente (la pregunta del corte es la FAQ
  canónica; la sesión queda impresa en el log, línea `AGENTE_SESION`).

**Limpieza (responsabilidad de Máximo, por SQL con el PAT de Supabase,
tras cada corrida de verificación):**

```sql
delete from public.reportes
 where buscador = 'PEUEBA' and nota like 'HUMO E2E%';
-- la conversación del agente: borrar por el id de sesión impreso en el
-- log (tablas agente_conversaciones / agente_mensajes, según la fila).
```

La cuenta PEUEBA es de prueba por diseño: ningún dato de Briku ni de
Abraham se toca, y el reporte de humo jamás lleva adjunto ni teléfono
real (usa 51000000).

## Límites honestos

- 4 flujos, no 40: la disciplina del humo es «pocos y los que duelen»
  (el propio estudio lo dice: más sería teatro pa un equipo de uno).
- Depende de que Pages y Supabase respondan: un rojo por red caída se
  distingue del rojo por defecto mirando el artefacto de la corrida
  (fotos del fallo) antes de culpar a la app.

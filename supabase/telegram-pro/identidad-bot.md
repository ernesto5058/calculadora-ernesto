# Identidad PRO del bot — @MiNegocioErnestoBot

Textos y pasos de IDENTIDAD para la activación. El bot ya existe
(«Mi Negocio · Avisos», creado por Ernesto con @BotFather). Su token
NO aparece aquí ni debe aparecer en ningún archivo: vive solo como
secreto de las Edge Functions en Supabase.

Los mismos textos viven en código en
`supabase/functions/_shared/telegram-pro.ts` (constantes
DESCRIPCION_LARGA, ABOUT_CORTO, COMANDOS y las bienvenidas), que es
la fuente que usan las funciones. Este documento es la copia legible
para la activación.

## 1) Descripción larga (384/512 caracteres)

> Bot oficial de avisos del equipo de Ernesto (Santiago de Cuba). Avisa al instante: reportes nuevos para aprobar, tratos aprobados, comisiones pagadas, tarifa nueva y mensajes del chat del equipo. Es un bot privado: solo recibe avisos quien Ernesto vincule desde su app «Mi Trabajo» o «Mi Negocio». El bot no conversa ni vende nada; las operaciones se hacen siempre dentro de las apps.

## 2) About corto (107/120 caracteres)

> Avisos privados del equipo de Ernesto: reportes, tratos, comisiones y tarifa. Solo para cuentas vinculadas.

## 3) Bienvenidas al Start (las envía telegram-webhook según el vínculo)

**Dueño vinculado:**
> 👋 **Hola, Ernesto.**
> Este es el bot de avisos de **Mi Negocio**.
>
> Por aquí te llega cada **reporte nuevo** con botones para aprobar o rechazar sin abrir la app, y el aviso si un vínculo del equipo se rompe.
>
> /estado — cómo está todo
> /ayuda — qué hace este bot

**Buscador vinculado:**
> 👋 **Hola, \<nombre\>.**
> Tu Telegram quedó vinculado a tu cuenta del equipo.
>
> Por aquí te aviso cuando Ernesto apruebe un trato tuyo, cuando marque tu comisión como pagada y cuando salga tarifa nueva.
>
> El chat oficial sigue en tu app **Mi Trabajo**: por ahí se habla y se reporta. Este bot solo avisa.

**Persona no vinculada** (y respuesta única a desconocidos):
> 👋 **Hola.**
> Soy el bot **privado** de avisos del equipo de Ernesto (Mi Negocio).
>
> Solo envío avisos a las cuentas que Ernesto vincula. Si eres del equipo, abre tu app y toca tu enlace personal de vinculación, o pídeselo a Ernesto.
>
> Si no eres del equipo, este bot no es para ti: no vende nada ni responde mensajes.

## 4) Comandos oficiales

| Comando | Descripción fijada | Quién |
|---|---|---|
| `/start` | Abrir el bot y ver tu estado | Todos |
| `/vincular` | Vincular tu Telegram con tu código del equipo | Equipo |
| `/ayuda` | Qué hace este bot y cómo se usa | Todos |
| `/estado` | Estado del bot y de los vínculos (solo Ernesto) | Solo dueño |

Nada decorativo: cada comando hace algo real en telegram-webhook.

## 5) Foto de perfil

Archivo: `bot-minegocio-foto-perfil-v1-2026-11-11.png` (en esta
misma carpeta; 1600×1600, monograma «MN» en trazo dorado fino sobre
fondo oscuro #0B0E13, sistema de diseño del proyecto).

**La foto NO se puede fijar por API** — la Bot API no tiene método
para la foto del bot. La fija Ernesto en la activación, con guía:

1. Abrir el chat con **@BotFather**.
2. Enviar `/setuserpic`.
3. Elegir **@MiNegocioErnestoBot** en la lista.
4. Enviar la foto `bot-minegocio-foto-perfil-v1-2026-11-11.png`
   (se le entrega el archivo en el chat de activación).

## 6) Qué SÍ se fija por API en la activación (una sola vez)

Con el token SOLO como variable de entorno del momento (nunca
escrito en archivos), el agente principal ejecuta una vez:

```sh
# Comandos oficiales
curl -s "https://api.telegram.org/bot<TOKEN>/setMyCommands" \
  -H "Content-Type: application/json" \
  -d '{"commands":[
    {"command":"start","description":"Abrir el bot y ver tu estado"},
    {"command":"vincular","description":"Vincular tu Telegram con tu código del equipo"},
    {"command":"ayuda","description":"Qué hace este bot y cómo se usa"},
    {"command":"estado","description":"Estado del bot y de los vínculos (solo Ernesto)"}
  ]}'

# Descripción larga (la lee de DESCRIPCION_LARGA; ≤512)
curl -s "https://api.telegram.org/bot<TOKEN>/setMyDescription" \
  -H "Content-Type: application/json" \
  -d '{"description":"<DESCRIPCION_LARGA>"}'

# About corto (de ABOUT_CORTO; ≤120)
curl -s "https://api.telegram.org/bot<TOKEN>/setMyShortDescription" \
  -H "Content-Type: application/json" \
  -d '{"short_description":"<ABOUT_CORTO>"}'
```

Equivalentes por @BotFather si se prefiere: `/setdescription`,
`/setabouttext`, `/setcommands` — el resultado es el mismo; la vía
API deja todo en un solo paso junto al `setWebhook`.

**NO se fija por API:** la foto de perfil (solo `/setuserpic` en
BotFather, paso 5) y el nombre visible (se fijó al crear el bot;
cambiarlo es `/setname` en BotFather).

## 7) Paso exacto de activación de identidad (orden)

1. Desplegar `avisos` y `telegram-webhook` (con la carpeta
   `_shared/` presente: ambas importan `_shared/telegram-pro.ts`).
2. Secretos en Supabase: `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_WEBHOOK_SECRET`, VAPID (como ya decía el informe del
   paquete).
3. `setWebhook` con su `secret_token` (comando en la cabecera de
   `telegram-webhook/index.ts`).
4. Fijar la identidad por API (paso 6) y la foto con Ernesto
   (paso 5).
5. Pegar el SQL del paquete si aún no se pegó (incluye la tabla
   `telegram_updates` de deduplicación al final de `chat-pro.sql`).
6. Prueba viva: Ernesto genera su enlace (`crear_enlace_telegram`),
   lo toca, recibe la bienvenida de dueño; `/estado` responde con
   su vínculo activo; un reporte de prueba le llega con botones y
   al tocar ✅ el mensaje se edita a «✅ Aprobado por ti · hoy …»
   sin botones.

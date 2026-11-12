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

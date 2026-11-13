-- =====================================================================
-- SENSOR SMS v2 «EL ARTEFACTO QUE PREGUNTA» — eventos y lotes (2026-11-13)
-- Orden de Ernesto: el atajo guarda el SMS crudo AL INSTANTE (sms_linea,
-- como siempre) y DESPUÉS le pregunta en el teléfono (¿a cuánto lo
-- cogiste? / ¿venta, devolución o traspaso? ¿por cuántos QUSD?). Las
-- respuestas llegan al cerebro (rutas sms_precio / sms_clase /
-- sms_respuesta) y el asiento cae SOLO en el libro del dinero.
--
-- Piezas de esta migración (TODO aditivo e idempotente):
--   · sms_eventos — un evento por SMS parseado (recibido/transferido):
--     nace «por_clasificar» y solo pasa a «asentado» cuando el asiento
--     en el libro se escribió completo. Sin respuesta, el evento queda
--     en la cola — jamás se asienta a ciegas ni se pierde.
--   · dinero_lotes_saldo — los lotes de saldo PROPIO de Ernesto: cada
--     compra capturada por el sensor crea un lote (cantidad de saldo,
--     costo total REAL pagado en CUP enteros, tasa efectiva derivada
--     total ÷ cantidad). Las ventas consumen FIFO y la ganancia se
--     calcula contra el costo del lote.
--   · sms_por_clasificar — la cola visible pa Máximo (vista).
--
-- Seguridad: RLS activo SIN políticas y grants revocados a anon/
-- authenticated — el único camino es el cerebro con service_role,
-- tras el token de dispositivo (x-maximo-token).
-- =====================================================================

create table if not exists public.sms_eventos (
  id             uuid primary key default gen_random_uuid(),
  sms_id         bigint not null unique references public.sms_linea (id),
  clase          text not null
                 constraint sms_eventos_clase_chk
                 check (clase in ('entrada', 'salida')),
  estado         text not null default 'por_clasificar'
                 constraint sms_eventos_estado_chk
                 check (estado in ('por_clasificar', 'asentado', 'descartado')),
  clasificacion  text
                 constraint sms_eventos_clasificacion_chk
                 check (clasificacion in ('compra', 'venta', 'devolucion', 'traspaso')),
  datos          jsonb not null default '{}'::jsonb,
  lote_id        uuid,
  es_prueba      boolean not null default false,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index if not exists sms_eventos_estado_idx
  on public.sms_eventos (estado, creado_en);

create table if not exists public.dinero_lotes_saldo (
  id                uuid primary key default gen_random_uuid(),
  evento_id         uuid references public.sms_eventos (id),
  sms_id            bigint,
  cantidad_saldo    numeric(14, 2) not null
                    constraint dinero_lotes_cantidad_chk check (cantidad_saldo > 0),
  cantidad_restante numeric(14, 2) not null
                    constraint dinero_lotes_restante_chk check (cantidad_restante >= 0),
  costo_total_cup   bigint not null
                    constraint dinero_lotes_costo_chk check (costo_total_cup > 0),
  costo_restante_cup bigint not null
                    constraint dinero_lotes_costo_restante_chk check (costo_restante_cup >= 0),
  tasa_efectiva     numeric not null,
  contraparte       text,
  es_prueba         boolean not null default false,
  creado_en         timestamptz not null default now()
);

create index if not exists dinero_lotes_fifo_idx
  on public.dinero_lotes_saldo (es_prueba, creado_en)
  where cantidad_restante > 0;

-- El lote que nace de una compra queda enlazado desde su evento.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sms_eventos_lote_fk'
  ) then
    alter table public.sms_eventos
      add constraint sms_eventos_lote_fk
      foreign key (lote_id) references public.dinero_lotes_saldo (id);
  end if;
end $$;

alter table public.sms_eventos enable row level security;
alter table public.dinero_lotes_saldo enable row level security;

revoke all on table public.sms_eventos from anon, authenticated;
revoke all on table public.dinero_lotes_saldo from anon, authenticated;

-- La cola «por clasificar»: lo que el sensor vio y todavía no tiene
-- respuesta (o cuya respuesta no alcanzó pa asentar). Máximo la lee
-- con la llave de gestión; de aquí sale la pregunta en el chat.
create or replace view public.sms_por_clasificar as
select e.id as evento_id, e.sms_id, e.clase, e.clasificacion,
       e.datos, e.es_prueba, e.creado_en,
       s.recibido_en, s.tipo, s.monto_cup, s.contraparte,
       s.saldo_principal_cup, s.cuerpo
from public.sms_eventos e
join public.sms_linea s on s.id = e.sms_id
where e.estado = 'por_clasificar'
order by e.creado_en;

revoke all on table public.sms_por_clasificar from anon, authenticated;

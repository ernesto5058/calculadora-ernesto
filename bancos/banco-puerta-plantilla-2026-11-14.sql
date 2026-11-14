-- BANCO TRANSACCIONAL — puerta de subida: la preparada lleva la
-- plantilla (2026-11-14). Todo corre dentro de BEGIN…ROLLBACK: la
-- preparada de prueba JAMÁS toca producción (y ninguna subida se
-- dispara: guia_subir no se llama). La última sentencia con filas
-- es el SELECT de resultados; el ROLLBACK la sigue.
begin;
create temp table banco_res(paso text, ok boolean, dato jsonb) on commit drop;

-- 1) La plantilla sembrada es la real y tiene la forma exacta:
--    details OBJETO con el par de Ernesto; bloque con requirements
--    null, mensaje y offer_kind «fixed» (jamás valores fijos).
insert into banco_res
select 'plantilla_real',
       count(*) = 1
       and bool_and(jsonb_typeof(detalles) = 'object')
       and bool_and(detalles ->> 'Celular' = '51231558')
       and bool_and(bloque -> 'requirements' = 'null'::jsonb)
       and bool_and(bloque ->> 'message' = 'Enviar SMS al 51231558.!!')
       and bool_and(bloque ->> 'offer_kind' = 'fixed'),
       jsonb_agg(jsonb_build_object('id', id, 'fuente', fuente,
         'tipo_detalles', jsonb_typeof(detalles)))
  from public.guia_plantilla
 where moneda = 'ETECSA' and tipo = 'sell';

-- 2) Determinismo dentro de la transacción: cualquier preparada
--    viva del asesor se vence AQUÍ dentro (el rollback la revive
--    tal cual estaba: producción no se entera).
update public.mercado_acciones
   set estado = 'vencida'
 where origen = 'asesor' and estado = 'preparada';

-- 3) El ciclo prepara con la plantilla EN EL SNAPSHOT: si nace la
--    preparada, su contexto.plantilla trae los details y el bloque
--    de guia_plantilla, idénticos; si el mercado no deja preparar,
--    la base igual se reconoce por plantilla (sin_oferta_base NO
--    puede aparecer) — el consumo del snapshot por la puerta está
--    probado en el banco JS (prueba-actuar-puerta P1/P2).
insert into banco_res
select 'preparada_snapshot',
       case when (p #>> '{preparada,id}') is not null then
              (p ->> 'snapshot_plantilla')::boolean
              and exists (
                select 1 from public.mercado_acciones a
                 cross join public.guia_plantilla pl
                 where a.id = (p #>> '{preparada,id}')::uuid
                   and pl.moneda = 'ETECSA' and pl.tipo = 'sell'
                   and a.contexto -> 'plantilla' -> 'detalles' = pl.detalles
                   and a.contexto -> 'plantilla' -> 'bloque' = pl.bloque
                   and a.contexto -> 'plantilla' ->> 'oferta_uuid' = pl.oferta_uuid)
            else (p #>> '{base,fuente}') = 'plantilla'
                 and not ((p -> 'motivos') @> '["sin_oferta_base"]'::jsonb)
            end,
       jsonb_build_object('resp', p)
  from (select public.guia_preparar_interna(true) as p) s;

-- 4) Segunda llamada: no duplica (idempotencia intacta).
select public.guia_preparar_interna(true);
insert into banco_res
select 'sin_duplicado', count(*) <= 1,
       jsonb_build_object('vivas', count(*))
  from public.mercado_acciones
 where origen = 'asesor' and estado = 'preparada' and expira_en > now();

-- 5) La fila nacida (si nació) es una preparada del asesor en su
--    forma de siempre: la plantilla se SUMA al snapshot, no cambia
--    el resto del contrato.
insert into banco_res
select 'forma_preparada',
       count(*) = 0 or bool_and(
         contexto ->> 'via' = 'asesor'
         and contexto ? 'porques' and contexto ? 'plantilla'
         and estado = 'preparada'),
       jsonb_agg(jsonb_build_object('tasa', tasa, 'monto', monto_qusd,
         'ctx_tiene_plantilla', contexto ? 'plantilla'))
  from public.mercado_acciones
 where origen = 'asesor' and estado = 'preparada';

select paso, ok, dato from banco_res order by paso;
rollback;

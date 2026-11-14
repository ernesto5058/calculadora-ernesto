-- BANCO TRANSACCIONAL — plantilla del Asesor (2026-11-14)
-- Todo corre dentro de BEGIN…ROLLBACK: la plantilla sintética y la
-- preparada de prueba JAMÁS tocan producción. La última sentencia
-- con filas es el SELECT de resultados; el ROLLBACK la sigue.
begin;
create temp table banco_res(paso text, ok boolean, dato jsonb) on commit drop;

-- 1) Plantilla sintética sembrada (fuente 'banco', forma no real)
insert into public.guia_plantilla (id, detalles, bloque, oferta_uuid, fuente, sembrada_en)
values (1, '[{"forma":"banco-no-real"}]'::jsonb, '{"coin":"ETECSA","type":"sell"}'::jsonb,
        'banco-uuid', 'banco', now());

-- 2) El asesor reconoce la base por plantilla y pierde sin_oferta_base
insert into banco_res
select 'base_plantilla', 
       (r->'base'->>'fuente' = 'plantilla')
       and not ((r->'calculo'->'motivos_no_prepara') @> '["sin_oferta_base"]'::jsonb),
       jsonb_build_object('base', r->'base', 'motivos', r->'calculo'->'motivos_no_prepara')
  from (select public.guia_asesor_interno(false) as r) s;

-- 3) Nace la preparada con snapshot de plantilla
insert into banco_res
select 'preparada_nace',
       (p->>'ok')::boolean and (p#>>'{preparada,base_fuente}' = 'plantilla')
       and (p#>>'{preparada,monto_qusd}')::numeric > 0,
       p
  from (select public.guia_preparar_interna(true) as p) s;

insert into banco_res
select 'preparada_fila',
       count(*) = 1 and bool_and(contexto->>'base_fuente' = 'plantilla')
       and bool_and(jsonb_array_length(contexto->'porques') = 3)
       and bool_and(estado = 'preparada') and bool_and(origen = 'asesor'),
       jsonb_agg(jsonb_build_object('tasa', tasa, 'monto', monto_qusd,
         'gan360', ganancia360, 'ctx', contexto))
  from public.mercado_acciones
 where origen = 'asesor' and estado = 'preparada';

-- 4) Segunda llamada: no duplica
select public.guia_preparar_interna(true);
insert into banco_res
select 'sin_duplicado', count(*) = 1, jsonb_build_object('vivas', count(*))
  from public.mercado_acciones
 where origen = 'asesor' and estado = 'preparada' and expira_en > now();

-- 5) Prioridad: oferta viva (foto.propias.base_venta=true) gana a la plantilla
update public.mercado_fotos
   set detalle = jsonb_set(detalle, '{propias,base_venta}', 'true'::jsonb)
 where id = (select id from public.mercado_fotos order by recibida_en desc limit 1);
insert into banco_res
select 'prioridad_viva',
       (r->'base'->>'fuente' = 'oferta_viva'),
       jsonb_build_object('base', r->'base')
  from (select public.guia_asesor_interno(false) as r) s;

select paso, ok, dato from banco_res order by paso;
rollback;
-- Residuo cero: sin plantilla, sin preparada, foto intacta
select (select count(*) from public.guia_plantilla) as plantilla_filas,
       (select count(*) from public.mercado_acciones
         where origen='asesor' and estado='preparada') as preparadas_vivas,
       (select detalle#>>'{propias,base_venta}' from public.mercado_fotos
         order by recibida_en desc limit 1) as foto_base_venta;

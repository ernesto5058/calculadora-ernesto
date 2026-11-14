-- BANCO TRANSACCIONAL — puerta de subida: el NACIMIENTO con la
-- plantilla en el snapshot (2026-11-14). Complemento determinista
-- del banco-puerta-plantilla: el mercado real de madrugada frena
-- por demanda_sin_absorcion_en_tu_zona (la banda del peldaño no
-- absorbe), así que aquí, SOLO dentro de la transacción, se siembra
-- una medición de demanda sintética con absorción en todas las
-- bandas de venta — el resto (foto, posición, lotes, tarifa, la
-- plantilla real) es el de producción. La preparada nace, se le
-- verifica el snapshot y el ROLLBACK lo deshace todo: producción
-- no se entera y NADA se sube (guia_subir no se llama).
begin;
create temp table banco_res(paso text, ok boolean, dato jsonb) on commit drop;

-- determinismo: preparadas vivas del asesor se vencen solo aquí
update public.mercado_acciones
   set estado = 'vencida'
 where origen = 'asesor' and estado = 'preparada';

-- medición sintética fresca: bandas de venta 250–350 con salida
-- 30 USD/h (tope 60 en la ventana de 120 min: no frena el monto)
insert into public.demanda_mediciones
  (medida_en, moneda, foto_id, foto_en, ventana_fuente_h,
   ops_realizadas, ops_compra, ops_venta,
   profundidad_compra_usd, profundidad_venta_usd,
   desequilibrio_ops, desequilibrio_libro,
   salida_cima_usd_h, rotacion_libro_usd_h,
   vida_cima_min, vida_cima_censurada, bandas, termometro,
   senales, propias)
select now(), 'ETECSA', f.id, now(), 2,
       10, 4, 6, 500, 500, 0, 0, 8, 10, 30, false,
       (select jsonb_agg(jsonb_build_object(
                  'banda', s * 5, 'lado', 'venta',
                  'salida_usd_h', 30, 'vida_min', 45,
                  'vida_censurada', false, 'usd', 400)
                order by s)
          from generate_series(50, 70) s),
       'normal', '{}'::jsonb, '{}'::jsonb
  from public.mercado_fotos f
 order by f.recibida_en desc limit 1;

-- el ciclo prepara…
insert into banco_res
select 'nace_con_plantilla',
       (p #>> '{preparada,id}') is not null
       and (p #>> '{preparada,snapshot_plantilla}')::boolean,
       p
  from (select public.guia_preparar_interna(true) as p) s;

-- …y el snapshot de la fila nacida es IDÉNTICO a la plantilla real
insert into banco_res
select 'snapshot_identico',
       count(*) = 1
       and bool_and(a.contexto -> 'plantilla' -> 'detalles' = pl.detalles)
       and bool_and(a.contexto -> 'plantilla' -> 'bloque' = pl.bloque)
       and bool_and(a.contexto -> 'plantilla' ->> 'oferta_uuid' = pl.oferta_uuid)
       and bool_and(jsonb_typeof(a.contexto -> 'plantilla' -> 'detalles') = 'object'),
       jsonb_agg(jsonb_build_object('tasa', a.tasa, 'monto', a.monto_qusd,
         'base_fuente', a.contexto ->> 'base_fuente',
         'forma_detalles', jsonb_typeof(a.contexto -> 'plantilla' -> 'detalles')))
  from public.mercado_acciones a
  cross join public.guia_plantilla pl
 where a.origen = 'asesor' and a.estado = 'preparada'
   and pl.moneda = 'ETECSA' and pl.tipo = 'sell';

select paso, ok, dato from banco_res order by paso;
rollback;

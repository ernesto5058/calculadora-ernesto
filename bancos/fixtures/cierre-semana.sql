-- =====================================================================
-- FIXTURE DE BANCO — NO EJECUTAR EN LA BASE.
-- Bloque de admin_generar_cierre tal como quedó DESPLEGADO en la base
-- viva el 2026-11-11 (tanda H-1/H-2/H-3; fuente:
-- research_notes/cierre-h1-h2-h3-sql-2026-11-11.sql, verificado contra
-- pg_get_functiondef tras el despliegue): el banco de invariantes
-- (test-invariantes-dinero.mjs) lo lee para anclar el espejo JS de la
-- fórmula del cierre del servidor y el WHERE de su resumen. Si la
-- fórmula cambia en la base, este fixture se regenera de la definición
-- viva y las anclas avisan.
-- =====================================================================

create or replace function public.admin_generar_cierre(p_codigo text, p_semana_inicio date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fin    date := p_semana_inicio + 6;
  v_datos  jsonb;
  v_filas  jsonb;
  v_resumen jsonb;
begin
  perform public.chat_identidad('ADMIN', p_codigo);
  if extract(isodow from p_semana_inicio) <> 1 then
    raise exception 'la semana empieza el lunes';
  end if;

  -- Filas por buscador desde los tratos PUBLICADOS de la semana.
  select coalesce(jsonb_agg(fila order by fila ->> 'nombre'), '[]'::jsonb)
    into v_filas
    from (
      select jsonb_build_object(
               'codigo', p.codigo,
               'nombre', coalesce(p.nombre, ''),
               'tratos', count(t),
               'comisiones', coalesce(sum((t ->> 'comision')::numeric), 0),
               'bono_saldo', (coalesce(sum(case when (t ->> 'tipo') = 'saldo'
                                                then (t ->> 'recargas')::numeric else 0 end), 0) >= 150),
               'bono_transf', (count(*) filter (where (t ->> 'tipo') = 'transferencia') >= 10),
               'bonos', (case when coalesce(sum(case when (t ->> 'tipo') = 'saldo'
                                                     then (t ->> 'recargas')::numeric else 0 end), 0) >= 150
                              then 300 else 0 end)
                      + (case when count(*) filter (where (t ->> 'tipo') = 'transferencia') >= 10
                              then 300 else 0 end)
             ) as fila
        from public.paneles p
        left join lateral jsonb_array_elements(p.tratos) t
          on (t ->> 'fecha') ~ '^\d{4}-\d{2}-\d{2}$'
         and (t ->> 'fecha')::date between p_semana_inicio and v_fin
       group by p.codigo, p.nombre
    ) s;

  -- Tu ganancia de la semana (reportes aprobados, sin pruebas): saldo =
  -- excedente menos comisión; transferencia = ganancia de la vuelta
  -- menos comisión. Sin clamp: las pérdidas restan, como en la
  -- Contabilidad (arreglos H-2 y H-3, 2026-11-11).
  select jsonb_build_object(
           'tratos', count(*),
           'tu_ganancia', coalesce(sum(
             case
               when r.tipo = 'saldo' then
                 (t.ingreso_ref360 - r.precio) * coalesce(r.cantidad, 1) - coalesce(r.comision, 0)
               when r.tipo = 'transferencia' then
                 ((r.cantidad * (1 + coalesce(r.porc, 0) / 100.0) / nullif(t.libro_ref, 0)) * t.salida_ref - r.cantidad)
                   - coalesce(r.comision, 0)
               else 0 end), 0),
           'comisiones', coalesce(sum(r.comision), 0),
           'pagadas', count(*) filter (where r.comision_pagada_en is not null),
           'pendientes_pago', count(*) filter (where r.comision_pagada_en is null)
         )
    into v_resumen
    from public.reportes r
    cross join (select ingreso_ref360, libro_ref, salida_ref
                  from public.tarifa where id = 1) t
   where r.estado = 'aprobado'
     and not coalesce(r.prueba, false)
     and r.creado_en::date between p_semana_inicio and v_fin;

  v_datos := jsonb_build_object(
    'semana_inicio', p_semana_inicio,
    'semana_fin', v_fin,
    'resumen', coalesce(v_resumen, '{}'::jsonb),
    'buscadores', v_filas);

  insert into public.cierres_semanales (semana_inicio, datos)
  values (p_semana_inicio, v_datos)
  on conflict (semana_inicio) do update
    set datos = excluded.datos, creado_en = now();

  perform public.registrar_actividad('ADMIN', 'generar_cierre',
    jsonb_build_object('semana_inicio', p_semana_inicio));

  return v_datos;
end;
$$;

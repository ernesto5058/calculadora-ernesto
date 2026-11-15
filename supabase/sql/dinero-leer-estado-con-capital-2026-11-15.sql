-- dinero_leer_estado con el resumen 'capital' del cupo (v27, 2026-11-15):
-- parche aditivo sobre la version viva — devoluciones del buscador con
-- es_cierre/confirmada_en/cliente_id, devoluciones_pendientes del dueno con
-- es_cierre, y la clave 'capital' (dinero_cupo_resumen) en la rama buscador.

CREATE OR REPLACE FUNCTION public.dinero_leer_estado(p_codigo text, p_prueba boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prueba boolean := coalesce(p_prueba, false);
  v_u record; v_cap bigint; v_pct numeric; v_foto record; v_t record;
  v_vueltas jsonb;
  v_est numeric; v_conteo int; v_pcts numeric; v_pctt numeric;
  v_umbral int; v_umbral_est numeric;
begin
  if public.dinero_es_admin(p_codigo) then
    select capital_total into v_cap from public.dinero_fondo where es_prueba = v_prueba limit 1;
    return jsonb_build_object(
      'rol', 'ernesto', 'capital_total', v_cap,
      'saldo_fondo', public.dinero_saldo('fondo', v_prueba),
      'saldo_gasto', public.dinero_saldo('gasto', v_prueba),
      'saldo_ernesto_inversion', public.dinero_saldo('ernesto_inversion', v_prueba),
      'saldo_inventario', public.dinero_saldo('inventario', v_prueba),
      'asignaciones', (select coalesce(jsonb_agg(jsonb_build_object('buscador', buscador_codigo, 'porciento', porciento) order by buscador_codigo),'[]'::jsonb)
                       from public.dinero_asignaciones where es_prueba = v_prueba),
      'estrellas', (select coalesce(jsonb_agg(jsonb_build_object(
                        'buscador', buscador_codigo, 'estrellas', estrellas,
                        'conteo_ganadoras', conteo_ganadoras, 'fijada_manual', fijada_manual,
                        'pct_saldo', public.dinero_pct_estrellas(estrellas, 'saldo'),
                        'pct_transferencia', public.dinero_pct_estrellas(estrellas, 'transferencia')
                        ) order by buscador_codigo),'[]'::jsonb)
                    from public.dinero_estrellas where es_prueba = v_prueba),
      'ganancias', public.dinero_ganancias(v_prueba),
      'entregas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'buscador', buscador_codigo, 'monto', monto_original,
                        'pendiente', monto_pendiente, 'bolsillo', bolsillo, 'estado', estado, 'entregado_en', entregado_en) order by entregado_en desc),'[]'::jsonb)
                   from (select * from public.dinero_entregas where es_prueba = v_prueba order by entregado_en desc limit 50) e),
      'vueltas_abiertas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'buscador', buscador_codigo, 'tipo', tipo,
                        'capital', capital_cup, 'producto', producto_cantidad, 'ganancia_capturada', ganancia_capturada,
                        'comision', comision, 'pago_hecho', pago_hecho) order by abierta_en desc),'[]'::jsonb)
                   from public.dinero_vueltas where es_prueba = v_prueba and estado = 'abierta'),
      'devoluciones_pendientes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'buscador', buscador_codigo,
                        'monto', monto, 'medio', medio, 'es_cierre', es_cierre, 'creada_en', creada_en) order by creada_en),'[]'::jsonb)
                   from public.dinero_devoluciones where es_prueba = v_prueba and estado = 'pendiente'),
      'ventas_recientes', (select coalesce(jsonb_agg(jsonb_build_object('fuente', fuente, 'tipo', tipo, 'monto', monto,
                        'tasa', tasa, 'contraparte', contraparte, 'hora', hora) order by hora desc),'[]'::jsonb)
                   from (select * from public.dinero_ventas where es_prueba = v_prueba order by hora desc limit 20) s),
      'cuadre', public.dinero_cuadre(p_codigo, v_prueba));
  end if;

  select * into v_u from public.validar_usuario(p_codigo);
  if not found or not v_u.activo or v_u.bloqueado then raise exception 'codigo no valido'; end if;
  select capital_total into v_cap from public.dinero_fondo where es_prueba = v_prueba limit 1;
  select porciento into v_pct from public.dinero_asignaciones
    where buscador_codigo = v_u.codigo and es_prueba = v_prueba;
  select * into v_foto from public.mercado_fotos order by recibida_en desc limit 1;
  select * into v_t from public.tarifa where id = 1;
  select estrellas, conteo into v_est, v_conteo
    from public.dinero_estrellas_de(v_u.codigo, v_prueba);
  v_pcts := public.dinero_pct_estrellas(v_est, 'saldo');
  v_pctt := public.dinero_pct_estrellas(v_est, 'transferencia');
  select u.c, u.e into v_umbral, v_umbral_est from (values
    (5,1.5),(10,2.0),(17,2.5),(25,3.0),(35,3.5),(50,4.0),(75,4.5),(100,5.0)) as u(c,e)
    where u.c > v_conteo order by u.c limit 1;

  select coalesce(jsonb_agg(x.obj order by x.abierta_en desc), '[]'::jsonb) into v_vueltas
  from (
    select v.abierta_en,
      jsonb_build_object(
        'id', v.id, 'tipo', v.tipo, 'capital', v.capital_cup, 'producto', v.producto_cantidad,
        'estado', v.estado, 'ganancia_capturada', v.ganancia_capturada,
        'comision', v.comision, 'pago_hecho', v.pago_hecho, 'pago_en', v.pago_en,
        'ganancia_final', v.ganancia_final,
        'reloj', jsonb_build_object(
          'entregado_en', e.entregado_en,
          'horas_desde_entrega', round(extract(epoch from (now() - e.entregado_en)) / 3600.0, 2)),
        'proyeccion', case
          when v.estado <> 'abierta' then null
          when v_foto.id is null or v_foto.recibida_en < now() - interval '20 minutes' then null
          else jsonb_build_object(
            'foto_en', v_foto.recibida_en,
            'valor_proyectado', case when v.tipo = 'saldo'
              then floor(v.producto_cantidad / nullif(v_foto.etecsa_top_venta,0) * v_foto.salida_ref)::bigint
              else floor(v.producto_cantidad / nullif(v_t.libro_ref,0) * v_t.salida_ref)::bigint end,
            'ganancia_proyectada', case when v.tipo = 'saldo'
              then floor(v.producto_cantidad / nullif(v_foto.etecsa_top_venta,0) * v_foto.salida_ref)::bigint - v.capital_cup
              else floor(v.producto_cantidad / nullif(v_t.libro_ref,0) * v_t.salida_ref)::bigint - v.capital_cup end,
            'comision_proyectada', case when v.tipo = 'saldo'
              then greatest(0, floor(greatest(0, floor(v.producto_cantidad / nullif(v_foto.etecsa_top_venta,0) * v_foto.salida_ref)::bigint - v.capital_cup)
                   * v_pcts / 100))::bigint
              else greatest(0, floor(greatest(0, floor(v.producto_cantidad / nullif(v_t.libro_ref,0) * v_t.salida_ref)::bigint - v.capital_cup)
                   * v_pctt / 100))::bigint end,
            'comision_pagada', v.comision)
          end
      ) as obj
    from public.dinero_vueltas v
    join public.dinero_entregas e on e.id = v.entrega_id
    where v.buscador_codigo = v_u.codigo and v.es_prueba = v_prueba
  ) x;

  return jsonb_build_object(
    'rol', 'buscador', 'codigo', v_u.codigo, 'nombre', v_u.nombre,
    'porciento', v_pct,
    'estrellas', jsonb_build_object(
      'estrellas', v_est, 'escalon', public.dinero_escalon(v_est),
      'conteo_ganadoras', v_conteo,
      'pct_saldo', v_pcts, 'pct_transferencia', v_pctt,
      'siguiente', case when v_umbral is null then null else jsonb_build_object(
        'umbral_conteo', v_umbral, 'estrellas', v_umbral_est,
        'faltan', v_umbral - v_conteo,
        'pct_saldo', public.dinero_pct_estrellas(v_umbral_est, 'saldo'),
        'pct_transferencia', public.dinero_pct_estrellas(v_umbral_est, 'transferencia')) end),
    'cupo', case when v_cap is not null and v_pct is not null then public.dinero_cupo(v_cap, v_pct) end,
    'en_mano', public.dinero_saldo('cupo:'||v_u.codigo, v_prueba),
    'capital', public.dinero_cupo_resumen(v_u.codigo, v_prueba),
    'foto_en', v_foto.recibida_en,
    'entregas', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'monto', monto_original, 'pendiente', monto_pendiente,
                      'bolsillo', bolsillo, 'estado', estado, 'entregado_en', entregado_en) order by entregado_en desc),'[]'::jsonb)
                 from public.dinero_entregas where buscador_codigo = v_u.codigo and es_prueba = v_prueba),
    'vueltas', v_vueltas,
    'devoluciones', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'monto', monto,
                      'estado', estado, 'es_cierre', es_cierre, 'confirmada_en', confirmada_en, 'cliente_id', cliente_id, 'creada_en', creada_en) order by creada_en desc),'[]'::jsonb)
                 from public.dinero_devoluciones where buscador_codigo = v_u.codigo and es_prueba = v_prueba));
end;
$function$


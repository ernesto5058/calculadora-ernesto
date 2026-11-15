-- CORTE DE GASTO AL ASENTAR VENTAS (CHEQUEO 105, 2026-11-15)

-- =====================================================================
-- CORTE DE GASTO AL ASENTAR UNA VENTA (CHEQUEO 105, 2026-11-15)
-- ---------------------------------------------------------------------
-- Auditoría: la cubeta 'gasto' (el «HOY PUEDES GASTAR» de Mi
-- Negocio) jamás recibió un centavo de ninguna venta — su historia
-- completa era un traspaso manual de 4.000 (2026-11-12) que Ernesto
-- se gastó; el porciento_gasto_su_parte de dinero_fondo existía sin
-- que ningún flujo lo consumiera al asentarse una venta. Esta
-- puerta es ese consumo: acredita en 'gasto' el % vigente de la
-- ganancia neta de Ernesto de la venta, saliendo de
-- 'ernesto_inversion' (traspaso interno: el total del libro no se
-- mueve y el cuadre ni se entera). Idempotente por referencia de
-- venta. Si la inversión no alcanza, acredita lo que hay y lo
-- declara ('inversion_insuficiente') — jamás inventa el resto.
-- =====================================================================
create or replace function public.dinero_acreditar_gasto_venta(
  p_referencia text, p_ganancia_neta numeric,
  p_prueba boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_prueba boolean := coalesce(p_prueba, false);
  v_ref text := 'gasto-venta:' || p_referencia;
  v_pct numeric; v_credito bigint; v_disp bigint; v_acred bigint;
begin
  if exists (select 1 from public.dinero_movimientos
              where cuenta = 'gasto' and referencia = v_ref
                and es_prueba = v_prueba) then
    return jsonb_build_object('ok', true, 'ya_existia', true,
      'acreditado', 0);
  end if;
  select porciento_gasto_su_parte into v_pct
    from public.dinero_fondo where es_prueba = v_prueba limit 1;
  if p_ganancia_neta is null or p_ganancia_neta <= 0 then
    return jsonb_build_object('ok', true, 'acreditado', 0,
      'motivo', 'sin_ganancia_neta');
  end if;
  if v_pct is null or v_pct <= 0 then
    return jsonb_build_object('ok', true, 'acreditado', 0,
      'motivo', 'sin_porciento_gasto');
  end if;
  v_credito := floor(p_ganancia_neta * v_pct / 100.0)::bigint;
  if v_credito <= 0 then
    return jsonb_build_object('ok', true, 'acreditado', 0,
      'motivo', 'credito_cero');
  end if;
  v_disp := greatest(public.dinero_saldo('ernesto_inversion', v_prueba), 0);
  v_acred := least(v_credito, v_disp);
  if v_acred > 0 then
    perform public.dinero_mover('ernesto_inversion', 'traspaso',
      -v_acred, 'efectivo', v_ref,
      'corte de gasto de la venta ' || p_referencia, v_prueba);
    perform public.dinero_mover('gasto', 'traspaso',
      v_acred, 'efectivo', v_ref,
      'tu corte pa gastar (' || v_pct
        || '% de la ganancia neta de la venta)', v_prueba);
  end if;
  return jsonb_build_object('ok', true, 'acreditado', v_acred,
    'solicitado', v_credito, 'porciento', v_pct,
    'motivo', case when v_acred < v_credito
                   then 'inversion_insuficiente' end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.pago_registrar_venta_saldo(p_codigo text, p_referencia text, p_saldo numeric, p_tasa numeric, p_qusd numeric, p_origen text DEFAULT 'manual'::text, p_prueba boolean DEFAULT false, p_medio_pago text DEFAULT 'efectivo'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prev public.pago_ventas_saldo;
  v_t public.tarifa;
  v_foto public.mercado_fotos;
  v_ingreso_real numeric;
  v_venta uuid;
  v_rest numeric := p_saldo;
  v_lote record; v_chunk numeric;
  v_esp record; v_vids uuid[];
  v_tot_prod numeric; v_share numeric; v_chunk_v numeric;
  v_liq public.pago_liquidaciones;
  v_costo numeric; v_valor_real numeric; v_valor_prot numeric;
  v_extra numeric; v_premio bigint;
  v_premio_nuevo bigint := 0;
  -- CORTE DE GASTO (CHEQUEO 105): costo FIFO consumido por la venta
  -- y la ganancia neta de Ernesto pa acreditar su % en 'gasto'.
  v_costo_fifo numeric := 0; v_nuevo_costo bigint;
  v_premio_total_v numeric; v_ganancia_neta numeric; v_gasto_res jsonb;
  v_pagos jsonb := '[]'::jsonb;
  v_detalle jsonb := '[]'::jsonb;
  v_pagar public.pago_liquidaciones;
  v_pago jsonb;
begin
  if not public.dinero_es_admin(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_admin_no_valido'); end if;
  select * into v_prev from public.pago_ventas_saldo where referencia = p_referencia;
  if v_prev.id is not null then
    return jsonb_build_object('ok', true, 'ya_existia', true, 'venta', v_prev.id,
      'premio_total', v_prev.premio_total);
  end if;
  if p_saldo is null or p_saldo <= 0 or p_tasa is null or p_tasa <= 0
     or p_qusd is null or p_qusd <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos'); end if;
  if abs(p_qusd - p_saldo / p_tasa) > greatest(0.02, p_saldo / p_tasa * 0.02) then
    return jsonb_build_object('ok', false, 'motivo', 'qusd_no_cuadra_con_tasa',
      'esperado', round(p_saldo / p_tasa, 4), 'recibido', p_qusd); end if;
  select * into v_t from public.tarifa where id = 1;
  if v_t.salida_ref is null or v_t.salida_ref <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_salida_ref'); end if;
  select * into v_foto from public.mercado_fotos order by recibida_en desc limit 1;
  v_ingreso_real := round(360.0 * v_t.salida_ref / p_tasa, 4);

  insert into public.pago_ventas_saldo
    (referencia, origen, es_prueba, saldo_vendido, tasa_ejecutada, qusd_recibidos,
     salida_ref_usada, ingreso_real360, ref360_vigente, foto_id)
  values (p_referencia, coalesce(p_origen, 'manual'), coalesce(p_prueba, false),
    p_saldo, p_tasa, p_qusd, v_t.salida_ref, v_ingreso_real, v_t.ingreso_ref360,
    v_foto.id)
  returning id into v_venta;

  for v_lote in
    select * from public.dinero_lotes_saldo
     where es_prueba = coalesce(p_prueba, false) and cantidad_restante > 0
     order by creado_en for update
  loop
    exit when v_rest <= 0;
    v_chunk := least(v_rest, v_lote.cantidad_restante);
    v_rest := v_rest - v_chunk;
    v_nuevo_costo := round(v_lote.costo_total_cup *
      (v_lote.cantidad_restante - v_chunk)
      / nullif(v_lote.cantidad_saldo, 0))::bigint;
    v_costo_fifo := v_costo_fifo
      + (v_lote.costo_restante_cup - v_nuevo_costo);
    update public.dinero_lotes_saldo
       set cantidad_restante = cantidad_restante - v_chunk,
           costo_restante_cup = v_nuevo_costo,
           valor_real_acum = valor_real_acum
             + round(v_chunk * v_ingreso_real / 360.0, 2)
     where id = v_lote.id;

    select * into v_esp from public.dinero_esperas where lote_id = v_lote.id limit 1;
    if v_esp.id is null then
      v_detalle := v_detalle || jsonb_build_object('lote', v_lote.id, 'saldo', v_chunk,
        'destino', 'sin_espera_compra_propia');
      continue;
    end if;
    select array_agg(x::uuid) into v_vids
      from jsonb_array_elements_text(v_esp.vuelta_ids) x;
    select coalesce(sum(producto_cantidad), 0) into v_tot_prod
      from public.pago_liquidaciones
     where vuelta_id = any(v_vids);
    if coalesce(v_tot_prod, 0) <= 0 then
      v_detalle := v_detalle || jsonb_build_object('lote', v_lote.id, 'saldo', v_chunk,
        'destino', 'vueltas_fuera_de_regimen');
      continue;
    end if;
    for v_liq in
      select * from public.pago_liquidaciones
       where vuelta_id = any(v_vids) order by creada_en for update
    loop
      v_share := v_chunk * v_liq.producto_cantidad / v_tot_prod;
      if v_share <= 0 then continue; end if;
      v_chunk_v := least(v_share, v_liq.producto_cantidad - v_liq.saldo_vendido);
      if v_chunk_v <= 0 then continue; end if;
      v_costo := v_liq.capital_cup * v_chunk_v / v_liq.producto_cantidad;
      v_valor_real := v_chunk_v * v_ingreso_real / 360.0;
      v_valor_prot := v_chunk_v * v_liq.ref360_protegida / 360.0;
      v_extra := greatest(0, v_valor_real - v_valor_prot);
      v_premio := floor(v_liq.pct_estrellas * v_extra / 100.0)::bigint;
      insert into public.pago_premio_detalle
        (venta_id, liquidacion_id, vuelta_id, saldo_atribuido, costo_cup_atribuido,
         valor_real_cup, valor_protegido_cup, extra_cup, premio_cup)
      values (v_venta, v_liq.id, v_liq.vuelta_id, round(v_chunk_v, 2), round(v_costo, 2),
         round(v_valor_real, 2), round(v_valor_prot, 2), round(v_extra, 2), v_premio)
      on conflict (venta_id, vuelta_id) do nothing;
      update public.pago_liquidaciones
         set saldo_vendido = saldo_vendido + v_chunk_v,
             valor_real_acum = valor_real_acum + v_valor_real,
             ganancia_real_acum = ganancia_real_acum + (v_valor_real - v_costo),
             extra_acum = extra_acum + v_extra,
             premio_total = premio_total + v_premio,
             tasa_efectiva_compra = coalesce(
               tasa_efectiva_compra, v_lote.tasa_efectiva),
             techo_tasa_compra = coalesce(
               techo_tasa_compra, v_lote.techo_tasa_dia),
             ahorro_compra_cup = case
               when v_lote.techo_tasa_dia is null then ahorro_compra_cup
               else coalesce(ahorro_compra_cup, 0) + round(
                 greatest(v_lote.techo_tasa_dia - v_lote.tasa_efectiva, 0)
                 * v_chunk_v, 2) end,
             actualizada_en = now()
       where id = v_liq.id;
      v_detalle := v_detalle || jsonb_build_object('lote', v_lote.id,
        'vuelta', v_liq.vuelta_id, 'saldo', round(v_chunk_v, 2),
        'extra', round(v_extra, 2), 'premio', v_premio);
    end loop;
  end loop;

  if v_rest > 0 then
    raise exception 'saldo vendido sin lote que lo cubra: quedan % de %', v_rest, p_saldo;
  end if;

  for v_pagar in
    select * from public.pago_liquidaciones
     where premio_total > premio_pagado and id in
       (select liquidacion_id from public.pago_premio_detalle where venta_id = v_venta)
     for update
  loop
    v_premio_nuevo := v_pagar.premio_total - v_pagar.premio_pagado;
    v_pago := public.pago_mover_pago(v_pagar, 'premio_venta', v_premio_nuevo, p_medio_pago);
    v_pagos := v_pagos || jsonb_build_object('vuelta', v_pagar.vuelta_id, 'pago', v_pago);
    update public.pago_liquidaciones set premio_pagado = premio_total,
      actualizada_en = now() where id = v_pagar.id;
  end loop;

  update public.pago_ventas_saldo
     set premio_total = (select coalesce(sum(premio_cup), 0)
                           from public.pago_premio_detalle where venta_id = v_venta),
         detalle = v_detalle
   where id = v_venta;

  insert into public.pago_colchon_observaciones
    (es_prueba, venta_id, ref360_papel, ingreso_real360, desviacion_pct)
  values (coalesce(p_prueba, false), v_venta, v_t.ingreso_ref360, v_ingreso_real,
    round((v_t.ingreso_ref360 - v_ingreso_real) / v_t.ingreso_ref360 * 100.0, 2));
  perform public.pago_autoajustar_colchon(coalesce(p_prueba, false));

  -- CORTE DE GASTO (CHEQUEO 105): la ganancia neta de Ernesto de
  -- esta venta (valor a la salida vigente − costo FIFO − premio de
  -- los buscadores) acredita su % en la cubeta de gasto.
  select premio_total into v_premio_total_v
    from public.pago_ventas_saldo where id = v_venta;
  v_ganancia_neta := round(p_qusd * v_t.salida_ref, 2)
    - v_costo_fifo - coalesce(v_premio_total_v, 0);
  v_gasto_res := public.dinero_acreditar_gasto_venta(
    p_referencia, v_ganancia_neta, coalesce(p_prueba, false));

  return jsonb_build_object('ok', true, 'ya_existia', false, 'venta', v_venta,
    'ingreso_real360', v_ingreso_real,
    'premio_total', (select premio_total from public.pago_ventas_saldo where id = v_venta),
    'ganancia_neta_ernesto', v_ganancia_neta,
    'gasto', v_gasto_res,
    'pagos', v_pagos, 'detalle', v_detalle);
end;
$function$

CREATE OR REPLACE FUNCTION public.pago_registrar_venta_transferencia(p_codigo text, p_referencia text, p_cup numeric, p_tasa numeric, p_qusd numeric, p_origen text DEFAULT 'manual'::text, p_prueba boolean DEFAULT false, p_medio_pago text DEFAULT 'efectivo'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_salida numeric; v_libro numeric;
  v_ingreso numeric; v_marco numeric; v_desv numeric;
  v_venta public.pago_ventas_transferencia;
  v_rest numeric; v_liq record; v_pago record;
  v_liqrow public.pago_liquidaciones;
  v_chunk numeric; v_costo numeric; v_vreal numeric; v_vprot numeric;
  v_extra numeric; v_premio bigint; v_esperado numeric;
  v_premios bigint := 0;
  -- CORTE DE GASTO (CHEQUEO 105): ganancia neta de Ernesto de la
  -- venta (valor real − costo, acumulado por tramo) menos premios.
  v_ganancia numeric := 0; v_gasto_res jsonb;
begin
  if not public.dinero_es_admin(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_admin_no_valido'); end if;
  if p_referencia is null or btrim(p_referencia) = '' then
    return jsonb_build_object('ok', false, 'motivo', 'referencia_requerida'); end if;
  if p_medio_pago not in ('efectivo','transferencia') then
    return jsonb_build_object('ok', false, 'motivo', 'medio_invalido'); end if;
  if p_cup is null or p_cup <= 0 or p_tasa is null or p_tasa <= 0
     or p_qusd is null or p_qusd <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'venta_invalida'); end if;
  v_esperado := p_cup / p_tasa;
  if abs(p_qusd - v_esperado) > greatest(0.02, v_esperado * 0.02) then
    return jsonb_build_object('ok', false, 'motivo', 'qusd_no_cuadra',
      'esperado', round(v_esperado, 4)); end if;
  select salida_ref, libro_ref into v_salida, v_libro from public.tarifa where id = 1;
  if v_salida is null then
    return jsonb_build_object('ok', false, 'motivo', 'sin_salida'); end if;
  select * into v_venta from public.pago_ventas_transferencia
   where referencia = p_referencia and es_prueba = coalesce(p_prueba, false);
  if v_venta.id is not null then
    return jsonb_build_object('ok', true, 'ya_existia', true, 'venta', v_venta.id,
      'premio_total', v_venta.premio_total); end if;
  v_ingreso := round(v_salida / p_tasa, 6);
  v_marco := case when v_libro is not null and v_libro > 0
                  then round(v_salida / v_libro, 6) end;
  insert into public.pago_ventas_transferencia
    (referencia, es_prueba, cup_vendidos, tasa_aplicada, qusd_recibidos,
     salida_ref_uso, libro_ref_uso, ingreso_real_unit, marco_real_unit, premio_total)
  values (p_referencia, coalesce(p_prueba, false), p_cup, p_tasa, p_qusd,
          v_salida, v_libro, v_ingreso, v_marco, 0)
  returning * into v_venta;
  v_rest := p_cup;
  for v_liq in
    select * from public.pago_liquidaciones
     where tipo = 'transferencia' and es_prueba = coalesce(p_prueba, false)
       and saldo_vendido < producto_cantidad
     order by creada_en asc for update
  loop
    exit when v_rest <= 0;
    v_chunk := least(v_rest, v_liq.producto_cantidad - v_liq.saldo_vendido);
    v_costo := v_liq.capital_cup * v_chunk / v_liq.producto_cantidad;
    v_vreal := v_chunk * v_ingreso;
    v_vprot := v_chunk * v_liq.valor_unit_protegida;
    v_extra := greatest(0, v_vreal - v_vprot);
    v_premio := floor(v_liq.pct_estrellas * v_extra / 100.0)::bigint;
    insert into public.pago_premio_transferencia_detalle
      (venta_id, liquidacion_id, cup_cubiertos, costo_cup, valor_real_cup,
       valor_protegido_cup, extra_cup, premio_cup)
    values (v_venta.id, v_liq.id, v_chunk, round(v_costo, 2), round(v_vreal, 2),
            round(v_vprot, 2), round(v_extra, 2), v_premio)
    on conflict (venta_id, liquidacion_id) do nothing;
    if found then
      update public.pago_liquidaciones set
        saldo_vendido = saldo_vendido + v_chunk,
        valor_real_acum = valor_real_acum + v_vreal,
        ganancia_real_acum = ganancia_real_acum + (v_vreal - v_costo),
        extra_acum = extra_acum + v_extra,
        premio_total = premio_total + v_premio,
        actualizada_en = now()
      where id = v_liq.id;
      v_ganancia := v_ganancia + (v_vreal - v_costo);
      v_rest := v_rest - v_chunk; v_premios := v_premios + v_premio;
    end if;
  end loop;
  if v_rest > 0 then
    raise exception 'venta de transferencia sin vuelta que la cubra: quedan % CUP', v_rest;
  end if;
  update public.pago_ventas_transferencia set premio_total = v_premios
   where id = v_venta.id;
  for v_pago in
    select l as liq, (l.premio_total - l.premio_pagado) as nuevo
      from public.pago_liquidaciones l
      join public.pago_premio_transferencia_detalle d on d.liquidacion_id = l.id
     where d.venta_id = v_venta.id
  loop
    if v_pago.nuevo <= 0 then continue; end if;
    v_liqrow := v_pago.liq;
    -- la firma VIVA de pago_mover_pago recibe la liquidación entera y
    -- aplica ella misma el redondeo por medio (línea redondeo_pago)
    perform public.pago_mover_pago(v_liqrow, 'premio_venta', v_pago.nuevo, p_medio_pago);
    update public.pago_liquidaciones set premio_pagado = premio_pagado + v_pago.nuevo
     where id = v_liqrow.id;
  end loop;
  -- la observación del colchón: contra el MARCO de la foto, no el par
  if v_marco is not null and v_marco > 0 then
    v_desv := round((v_marco - v_ingreso) / v_marco * 100.0, 2);
    insert into public.pago_colchon_observaciones
      (es_prueba, fuente, venta_id, ref360_papel, ingreso_real360, desviacion_pct)
    values (coalesce(p_prueba, false), 'venta_transferencia', v_venta.id,
            v_marco, v_ingreso, v_desv);
    perform public.pago_autoajustar_colchon(coalesce(p_prueba, false));
  end if;
  -- CORTE DE GASTO (CHEQUEO 105): igual que en la venta de saldo,
  -- su % de la ganancia neta queda acreditado en la cubeta.
  v_gasto_res := public.dinero_acreditar_gasto_venta(
    p_referencia, v_ganancia - v_premios, coalesce(p_prueba, false));
  return jsonb_build_object('ok', true, 'ya_existia', false, 'venta', v_venta.id,
    'ingreso_real_unit', v_ingreso, 'marco_real_unit', v_marco,
    'ganancia_neta_ernesto', v_ganancia - v_premios,
    'gasto', v_gasto_res,
    'premio_total', v_premios);
end; $function$

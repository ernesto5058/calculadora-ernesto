-- =====================================================================
-- ENMIENDA PIEZA 2 · REDONDEO DE PAGOS EN EFECTIVO (2026-11-14)
-- Orden de Ernesto: los pagos en efectivo salen REDONDOS — no maneja
-- billetes chicos. Ejemplo suyo: le tocan 2.860 → se le dan 2.900.
-- Regla: pagado = siguiente múltiplo de la rejilla ≥ calculado
-- (SIEMPRE hacia arriba; el pico lo asume Ernesto). La diferencia se
-- asienta como línea PROPIA y VISIBLE («redondeo_pago») en
-- dinero_movimientos — jamás escondida dentro de la comisión: el
-- fijo/premio CALCULADO queda intacto en pago_liquidaciones y el
-- redondeo lleva su propio acumulado (redondeo_pagado).
-- Por TRANSFERENCIA el monto va exacto. La rejilla es PARÁMETRO
-- (pago_proteccion_config.rejilla_efectivo, 50 por defecto): fijarla
-- con la respuesta de Ernesto = un UPDATE, sin reescribir código.
-- =====================================================================

alter table public.pago_proteccion_config
  add column if not exists rejilla_efectivo numeric not null default 50;

alter table public.pago_liquidaciones
  add column if not exists redondeo_pagado bigint not null default 0;

-- Función pura de redondeo: rejilla ≤ 0 o nula = sin redondeo.
create or replace function public.pago_redondear(p_monto bigint, p_rejilla numeric)
returns bigint language sql immutable as $f$
  select case
    when p_monto is null or p_monto <= 0 then 0
    when p_rejilla is null or p_rejilla <= 0 then p_monto
    else (ceil(p_monto::numeric / p_rejilla) * p_rejilla)::bigint
  end;
$f$;

-- Mover un pago calculado aplicando la regla del medio:
-- devuelve jsonb {calculado, redondeo, pagado}. El redondeo, si lo hay,
-- viaja en su PROPIO par de movimientos tipo 'redondeo_pago'.
create or replace function public.pago_mover_pago(
  p_liq public.pago_liquidaciones, p_tipo text, p_monto bigint, p_medio_pago text)
returns jsonb language plpgsql security definer set search_path = 'public' as $f$
declare
  v_cfg public.pago_proteccion_config;
  v_pagado bigint; v_red bigint := 0;
begin
  if p_monto is null or p_monto <= 0 then
    return jsonb_build_object('calculado', 0, 'redondeo', 0, 'pagado', 0);
  end if;
  if p_medio_pago not in ('efectivo', 'transferencia') then
    raise exception 'medio de pago invalido: %', p_medio_pago;
  end if;
  v_pagado := p_monto;
  if p_medio_pago = 'efectivo' then
    select * into v_cfg from public.pago_proteccion_config
     where es_prueba = p_liq.es_prueba;
    v_pagado := public.pago_redondear(p_monto, v_cfg.rejilla_efectivo);
    v_red := v_pagado - p_monto;
  end if;
  perform public.dinero_mover('fondo', p_tipo, -p_monto, 'saldo',
    p_liq.vuelta_id::text, p_liq.buscador_codigo, p_liq.es_prueba);
  perform public.dinero_mover('cupo:' || p_liq.buscador_codigo, p_tipo, p_monto,
    'saldo', p_liq.vuelta_id::text, null, p_liq.es_prueba);
  if v_red > 0 then
    perform public.dinero_mover('fondo', 'redondeo_pago', -v_red, 'efectivo',
      p_liq.vuelta_id::text, p_liq.buscador_codigo, p_liq.es_prueba);
    perform public.dinero_mover('cupo:' || p_liq.buscador_codigo, 'redondeo_pago',
      v_red, 'efectivo', p_liq.vuelta_id::text, null, p_liq.es_prueba);
    update public.pago_liquidaciones
       set redondeo_pagado = redondeo_pagado + v_red, actualizada_en = now()
     where id = p_liq.id;
  end if;
  return jsonb_build_object('calculado', p_monto, 'redondeo', v_red, 'pagado', v_pagado);
end;
$f$;
revoke all on function public.pago_mover_pago(public.pago_liquidaciones, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.pago_mover_pago(public.pago_liquidaciones, text, bigint, text)
  to service_role;

-- Puerta del dueño (v2): el top-up del fijo respeta el medio de pago.
drop function if exists public.pago_congelar_fijo(text, uuid);
create or replace function public.pago_congelar_fijo(
  p_codigo text, p_vuelta uuid, p_medio_pago text default 'efectivo')
returns jsonb language plpgsql security definer set search_path = 'public' as $f$
declare v_s jsonb; v_liq public.pago_liquidaciones; v_topup bigint; v_pago jsonb;
begin
  if not public.dinero_es_admin(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_admin_no_valido'); end if;
  v_s := public.pago_congelar_snapshot(p_vuelta);
  if not (v_s->>'ok')::boolean then return v_s; end if;
  select * into v_liq from public.pago_liquidaciones where vuelta_id = p_vuelta for update;
  v_topup := v_liq.fijo - v_liq.comision_ya_pagada - v_liq.fijo_topup_pagado;
  v_pago := jsonb_build_object('calculado', 0, 'redondeo', 0, 'pagado', 0);
  if v_topup > 0 then
    v_pago := public.pago_mover_pago(v_liq, 'fijo_protegido_topup', v_topup, p_medio_pago);
    update public.pago_liquidaciones
       set fijo_topup_pagado = fijo_topup_pagado + v_topup, actualizada_en = now()
     where id = v_liq.id;
  end if;
  return jsonb_build_object('ok', true, 'fijo', v_liq.fijo,
    'comision_ya_pagada', v_liq.comision_ya_pagada,
    'topup', v_pago, 'medio_pago', p_medio_pago);
end;
$f$;

-- La venta real (v2): el premio se paga con la misma regla del medio.
drop function if exists public.pago_registrar_venta_saldo(text, text, numeric, numeric, numeric, text, boolean);
create or replace function public.pago_registrar_venta_saldo(
  p_codigo text, p_referencia text, p_saldo numeric, p_tasa numeric,
  p_qusd numeric, p_origen text default 'manual', p_prueba boolean default false,
  p_medio_pago text default 'efectivo')
returns jsonb language plpgsql security definer set search_path = 'public' as $f$
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
    update public.dinero_lotes_saldo
       set cantidad_restante = cantidad_restante - v_chunk,
           costo_restante_cup = round(costo_total_cup *
             (cantidad_restante - v_chunk) / nullif(cantidad_saldo, 0))::bigint
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

  return jsonb_build_object('ok', true, 'ya_existia', false, 'venta', v_venta,
    'ingreso_real360', v_ingreso_real,
    'premio_total', (select premio_total from public.pago_ventas_saldo where id = v_venta),
    'pagos', v_pagos, 'detalle', v_detalle);
end;
$f$;

-- Vista del buscador (v2): sus montos + su redondeo recibido (es SUYO;
-- la cocina —colchón, tasas— sigue fuera).
drop function if exists public.pago_mi_estado(text);
create or replace function public.pago_mi_estado(p_codigo text)
returns jsonb language plpgsql security definer set search_path = 'public' as $f$
declare v_u record; v_rows jsonb;
begin
  select * into v_u from public.validar_usuario(p_codigo) limit 1;
  if v_u.codigo is null or not v_u.activo or v_u.bloqueado then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_no_valido'); end if;
  select coalesce(jsonb_agg(fila order by fila->>'creada_en' desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'vuelta', l.vuelta_id, 'creada_en', l.creada_en,
      'producto', l.producto_cantidad,
      'fijo', greatest(l.fijo, l.comision_ya_pagada),
      'premio', l.premio_pagado,
      'redondeo', l.redondeo_pagado,
      'total', greatest(l.fijo, l.comision_ya_pagada) + l.premio_pagado + l.redondeo_pagado,
      'estado', case
        when l.saldo_vendido <= 0 then 'fijo_congelado'
        when l.saldo_vendido < l.producto_cantidad then 'vendiendo'
        when l.premio_pagado > 0 then 'premio_pagado'
        else 'vendido_sin_premio' end) as fila
      from public.pago_liquidaciones l
     where l.buscador_codigo = v_u.codigo and not l.es_prueba) s;
  return jsonb_build_object('ok', true, 'buscador', v_u.codigo, 'vueltas', v_rows);
end;
$f$;

-- Vista del dueño: redondeo visible en el antes/ahora.
create or replace function public.pago_estado_dueno(p_codigo text)
returns jsonb language plpgsql security definer set search_path = 'public' as $f$
declare v_liq jsonb; v_cfg jsonb; v_log jsonb;
begin
  if not public.dinero_es_admin(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_admin_no_valido'); end if;
  select coalesce(jsonb_agg(fila order by fila->>'creada_en' desc), '[]'::jsonb) into v_liq from (
    select jsonb_build_object(
      'vuelta', l.vuelta_id, 'buscador', l.buscador_codigo, 'es_prueba', l.es_prueba,
      'creada_en', l.creada_en, 'capital_cup', l.capital_cup,
      'producto', l.producto_cantidad, 'pct', l.pct_estrellas,
      'antes', jsonb_build_object('estimado_papel', l.estimado_papel,
        'ganancia_papel', l.ganancia_papel, 'ref360_papel', l.ref360_papel),
      'protegido', jsonb_build_object('fijo', l.fijo,
        'colchon_pct', l.colchon_pct_aplicado, 'ref360_protegida', l.ref360_protegida,
        'ganancia_protegida', l.ganancia_protegida),
      'comision_ya_pagada', l.comision_ya_pagada, 'topup_pagado', l.fijo_topup_pagado,
      'redondeo_pagado', l.redondeo_pagado,
      'ahora', jsonb_build_object('saldo_vendido', l.saldo_vendido,
        'valor_real', round(l.valor_real_acum, 2),
        'ganancia_real', round(l.ganancia_real_acum, 2),
        'extra_real', round(l.extra_acum, 2), 'premio', l.premio_pagado),
      'buscador_total', greatest(l.fijo, l.comision_ya_pagada) + l.premio_pagado + l.redondeo_pagado,
      'neto_ernesto_real', round(l.ganancia_real_acum, 2)
        - greatest(l.fijo, l.comision_ya_pagada) - l.premio_pagado - l.redondeo_pagado) as fila
      from public.pago_liquidaciones l) s;
  select coalesce(jsonb_agg(jsonb_build_object('es_prueba', es_prueba, 'activo', activo,
      'activo_desde', activo_desde, 'colchon_pct', colchon_pct,
      'rejilla_efectivo', rejilla_efectivo,
      'origen', colchon_origen, 'actualizado_en', actualizado_en)), '[]'::jsonb)
    into v_cfg from public.pago_proteccion_config;
  select coalesce(jsonb_agg(jsonb_build_object('en', creado_en, 'es_prueba', es_prueba,
      'antes', colchon_antes, 'despues', colchon_despues, 'motivo', motivo,
      'detalle', detalle) order by creado_en desc), '[]'::jsonb)
    into v_log from (select * from public.pago_colchon_log
                       order by creado_en desc limit 10) q;
  return jsonb_build_object('ok', true, 'config', v_cfg, 'liquidaciones', v_liq,
    'colchon_log', v_log);
end;
$f$;

-- La puerta del buscador acepta el carril (default: el real) pa que los
-- bancos ejerciten la frontera sobre datos de prueba.
drop function if exists public.pago_mi_estado(text);
create or replace function public.pago_mi_estado(p_codigo text, p_prueba boolean default false)
returns jsonb language plpgsql security definer set search_path = 'public' as $f$
declare v_u record; v_rows jsonb;
begin
  select * into v_u from public.validar_usuario(p_codigo) limit 1;
  if v_u.codigo is null or not v_u.activo or v_u.bloqueado then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_no_valido'); end if;
  select coalesce(jsonb_agg(fila order by fila->>'creada_en' desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'vuelta', l.vuelta_id, 'creada_en', l.creada_en,
      'producto', l.producto_cantidad,
      'fijo', greatest(l.fijo, l.comision_ya_pagada),
      'premio', l.premio_pagado,
      'redondeo', l.redondeo_pagado,
      'total', greatest(l.fijo, l.comision_ya_pagada) + l.premio_pagado + l.redondeo_pagado,
      'estado', case
        when l.saldo_vendido <= 0 then 'fijo_congelado'
        when l.saldo_vendido < l.producto_cantidad then 'vendiendo'
        when l.premio_pagado > 0 then 'premio_pagado'
        else 'vendido_sin_premio' end) as fila
      from public.pago_liquidaciones l
     where l.buscador_codigo = v_u.codigo and l.es_prueba = coalesce(p_prueba, false)) s;
  return jsonb_build_object('ok', true, 'buscador', v_u.codigo, 'vueltas', v_rows);
end;
$f$;

-- REJILLA CONFIRMADA POR ERNESTO (2026-11-14): efectivo siempre hacia
-- arriba — montos ≥500 al múltiplo de 50; montos <500 al múltiplo de
-- 20. Umbral y ambas rejillas quedan como parámetros de configuración.
alter table public.pago_proteccion_config
  add column if not exists rejilla_chica numeric not null default 20,
  add column if not exists rejilla_umbral numeric not null default 500;

drop function if exists public.pago_redondear(bigint, numeric);
create or replace function public.pago_redondear(
  p_monto bigint, p_rejilla_grande numeric, p_rejilla_chica numeric, p_umbral numeric)
returns bigint language sql immutable as $f$
  select case
    when p_monto is null or p_monto <= 0 then 0
    when p_monto >= coalesce(p_umbral, 500)
      then case when coalesce(p_rejilla_grande, 0) <= 0 then p_monto
                else (ceil(p_monto::numeric / p_rejilla_grande) * p_rejilla_grande)::bigint end
    else case when coalesce(p_rejilla_chica, 0) <= 0 then p_monto
              else (ceil(p_monto::numeric / p_rejilla_chica) * p_rejilla_chica)::bigint end
  end;
$f$;

create or replace function public.pago_mover_pago(
  p_liq public.pago_liquidaciones, p_tipo text, p_monto bigint, p_medio_pago text)
returns jsonb language plpgsql security definer set search_path = 'public' as $f$
declare
  v_cfg public.pago_proteccion_config;
  v_pagado bigint; v_red bigint := 0;
begin
  if p_monto is null or p_monto <= 0 then
    return jsonb_build_object('calculado', 0, 'redondeo', 0, 'pagado', 0);
  end if;
  if p_medio_pago not in ('efectivo', 'transferencia') then
    raise exception 'medio de pago invalido: %', p_medio_pago;
  end if;
  v_pagado := p_monto;
  if p_medio_pago = 'efectivo' then
    select * into v_cfg from public.pago_proteccion_config
     where es_prueba = p_liq.es_prueba;
    v_pagado := public.pago_redondear(p_monto, v_cfg.rejilla_efectivo,
      v_cfg.rejilla_chica, v_cfg.rejilla_umbral);
    v_red := v_pagado - p_monto;
  end if;
  perform public.dinero_mover('fondo', p_tipo, -p_monto, 'saldo',
    p_liq.vuelta_id::text, p_liq.buscador_codigo, p_liq.es_prueba);
  perform public.dinero_mover('cupo:' || p_liq.buscador_codigo, p_tipo, p_monto,
    'saldo', p_liq.vuelta_id::text, null, p_liq.es_prueba);
  if v_red > 0 then
    perform public.dinero_mover('fondo', 'redondeo_pago', -v_red, 'efectivo',
      p_liq.vuelta_id::text, p_liq.buscador_codigo, p_liq.es_prueba);
    perform public.dinero_mover('cupo:' || p_liq.buscador_codigo, 'redondeo_pago',
      v_red, 'efectivo', p_liq.vuelta_id::text, null, p_liq.es_prueba);
    update public.pago_liquidaciones
       set redondeo_pagado = redondeo_pagado + v_red, actualizada_en = now()
     where id = p_liq.id;
  end if;
  return jsonb_build_object('calculado', p_monto, 'redondeo', v_red, 'pagado', v_pagado);
end;
$f$;

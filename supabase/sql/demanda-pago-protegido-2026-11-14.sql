-- =====================================================================
-- DEMANDA + PAGO FIJO PROTEGIDO + PREMIO (2026-11-14, orden de Ernesto)
--
-- PIEZA 1 · MEDIDOR DE DEMANDA: lee la corriente de fotos (~60 s) y los
-- agregados públicos que el lector ya guarda en cada foto (averages:
-- operaciones REALIZADAS por moneda/lado) y mide, sin estimar nada:
--   · volumen realizado (ops completadas 24 h por moneda y lado)
--   · desequilibrio (realizado y de libro abierto)
--   · absorción: salida de profundidad por banda de tasa entre fotos
--     consecutivas + vida de la cima del libro
--   · rotación del libro (variación total por hora)
-- Lo que no se puede medir se declara AUSENTE en «senales», jamás se
-- rellena. Termómetro determinista con umbrales en demanda_config.
--
-- PIEZA 2 · PAGO «FIJO PROTEGIDO + PREMIO» (solo vueltas de saldo
-- nacidas DESPUÉS de activar el régimen; la historia no se toca):
--   · Al nacer la vuelta (trigger), se congela el FIJO a una tasa
--     protegida = ref360 del parte × (1 − colchón). El colchón nace
--     conservador (5 %) DECLARADO «sin historial» y se autoajusta SOLO
--     con observaciones de ventas reales (regla de las dos lecturas).
--   · La venta real del saldo (QUSD recibido) se registra por
--     pago_registrar_venta_saldo: consume lotes FIFO, atribuye por el
--     hilo lote→espera→vueltas y paga PREMIO = %estrellas × extra real
--     sobre la valoración protegida. Si vende por debajo: sin premio
--     y el fijo NO baja (el riesgo es de Ernesto, registrado).
--   · El fijo se paga como «top-up» sobre la comisión ya pagada por el
--     flujo de siempre (pago_congelar_fijo): nunca se descuenta nada.
-- Invariantes (barridos en bancos/prueba-demanda-pago.mjs):
--   fijo ≤ estimado de papel · premio solo de extra realizado+recibido
--   · fijo+premio ≤ % × (ganancia protegida + extra) · idempotencia
--   por (referencia de venta) y por (venta, vuelta) · sin venta no
--   hay premio · frontera: el buscador ve SOLO sus montos.
-- =====================================================================

-- ============================ PIEZA 1 ==============================

create table if not exists public.demanda_config (
  id int primary key,
  ventana_absorcion_min int not null default 120,
  banda_tasa numeric not null default 5,
  -- termómetro ETECSA (ops realizadas en la ventana de la fuente, ~24 h)
  et_ops_alta int not null default 100,
  et_ops_fria int not null default 60,
  -- termómetro BANK_CUP
  bc_ops_alta int not null default 450,
  bc_ops_fria int not null default 300,
  -- absorción: salida de la zona de la cima (USD/h) que empuja un nivel
  absorcion_alta_usd_h numeric not null default 30,
  -- cima dormida: vida (min) sin salida que baja un nivel
  cima_dormida_min int not null default 240,
  actualizado_en timestamptz not null default now()
);
insert into public.demanda_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.demanda_mediciones (
  id uuid primary key default gen_random_uuid(),
  medida_en timestamptz not null default now(),
  moneda text not null,
  foto_id uuid,
  foto_en timestamptz,
  ventana_fuente_h numeric,
  ops_realizadas int,
  ops_compra int,
  ops_venta int,
  profundidad_compra_usd numeric,
  profundidad_venta_usd numeric,
  desequilibrio_ops numeric,
  desequilibrio_libro numeric,
  salida_cima_usd_h numeric,
  rotacion_libro_usd_h numeric,
  vida_cima_min numeric,
  vida_cima_censurada boolean,
  bandas jsonb not null default '[]'::jsonb,
  termometro text not null,
  senales jsonb not null default '{}'::jsonb,
  propias jsonb not null default '{}'::jsonb
);
create index if not exists demanda_mediciones_moneda_idx
  on public.demanda_mediciones (moneda, medida_en desc);
alter table public.demanda_mediciones enable row level security;
alter table public.demanda_config enable row level security;

-- Termómetro determinista: pasos registrados, sin magia.
create or replace function public.demanda_termometro(
  p_moneda text, p_ops int, p_salida_cima numeric, p_vida_cima numeric,
  p_cfg public.demanda_config)
returns jsonb language plpgsql immutable as $f$
declare
  v_alta int := case when p_moneda = 'BANK_CUP' then p_cfg.bc_ops_alta else p_cfg.et_ops_alta end;
  v_fria int := case when p_moneda = 'BANK_CUP' then p_cfg.bc_ops_fria else p_cfg.et_ops_fria end;
  v_nivel int;  -- 0 fría · 1 normal · 2 alta
  v_pasos jsonb := '[]'::jsonb;
begin
  if p_ops is null then
    return jsonb_build_object('termometro', 'sin_datos',
      'pasos', jsonb_build_array('sin operaciones realizadas legibles'));
  end if;
  v_nivel := case when p_ops >= v_alta then 2 when p_ops <= v_fria then 0 else 1 end;
  v_pasos := v_pasos || jsonb_build_array(
    format('ops_realizadas=%s (alta≥%s · fría≤%s) → nivel base %s', p_ops, v_alta, v_fria, v_nivel));
  if p_salida_cima is not null and p_salida_cima >= p_cfg.absorcion_alta_usd_h and v_nivel < 2 then
    v_nivel := v_nivel + 1;
    v_pasos := v_pasos || jsonb_build_array(
      format('salida de la cima %s USD/h ≥ %s → sube un nivel', p_salida_cima, p_cfg.absorcion_alta_usd_h));
  end if;
  if p_vida_cima is not null and p_vida_cima >= p_cfg.cima_dormida_min
     and coalesce(p_salida_cima, 0) = 0 and v_nivel > 0 then
    v_nivel := v_nivel - 1;
    v_pasos := v_pasos || jsonb_build_array(
      format('cima dormida %s min sin salida → baja un nivel', p_vida_cima));
  end if;
  return jsonb_build_object(
    'termometro', case v_nivel when 2 then 'alta' when 0 then 'fria' else 'normal' end,
    'pasos', v_pasos);
end;
$f$;

create or replace function public.demanda_evaluar()
returns jsonb language plpgsql security definer set search_path = 'public' as $f$
declare
  v_cfg public.demanda_config;
  v_f record;
  v_monedas text[] := array['ETECSA','BANK_CUP'];
  v_moneda text;
  v_res jsonb := '{}'::jsonb;
  v_esc_v jsonb; v_esc_c jsonb; v_top_v numeric;
  v_ops int; v_ops_c int; v_ops_s int; v_ventana_h numeric;
  v_prof_v numeric; v_prof_c numeric;
  v_des_ops numeric; v_des_libro numeric;
  v_salida_cima numeric; v_rotacion numeric;
  v_vida numeric; v_vida_cens boolean;
  v_bandas jsonb;
  v_term jsonb;
  v_senales jsonb;
  v_propias jsonb;
  v_horas numeric;
begin
  select * into v_cfg from public.demanda_config where id = 1;
  select * into v_f from public.mercado_fotos
   where libro_ok and detalle is not null
   order by recibida_en desc limit 1;
  if v_f.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sin_foto_con_libro');
  end if;

  -- señal «propias»: sus ofertas vivas (de la foto) + tiempos reales de
  -- aplicación de ofertas ejecutadas por la puerta (mercado_acciones).
  v_propias := jsonb_build_object(
    'ofertas_vivas', coalesce(v_f.detalle->'propias', 'null'::jsonb),
    'aplicaciones', (
      select coalesce(jsonb_build_object(
        'n', count(*),
        'minutos_mediana', percentile_cont(0.5) within group (
          order by extract(epoch from (resuelta_en - creada_en)) / 60.0),
        'minutos_max', max(extract(epoch from (resuelta_en - creada_en)) / 60.0)),
        jsonb_build_object('n', 0))
        from public.mercado_acciones
       where estado = 'ejecutada' and oferta_uuid is not null),
    'estado', case when exists (
        select 1 from public.mercado_acciones
         where estado = 'ejecutada' and oferta_uuid is not null)
      then 'con_datos' else 'sin_datos' end);

  foreach v_moneda in array v_monedas loop
    if v_moneda = 'ETECSA' then
      v_esc_v := v_f.detalle->'escalera_venta';
      v_esc_c := v_f.detalle->'escalera_compra';
      v_top_v := v_f.etecsa_top_venta;
      v_ops := v_f.etecsa_count; v_ops_c := v_f.etecsa_count_buy; v_ops_s := v_f.etecsa_count_sell;
      v_ventana_h := (v_f.detalle->>'window_hours')::numeric;
    else
      v_esc_v := v_f.detalle->'bankcup'->'escalera_venta';
      v_esc_c := v_f.detalle->'bankcup'->'escalera_compra';
      v_top_v := (v_f.detalle->'bankcup'->>'top_venta')::numeric;
      v_ops := v_f.bankcup_count; v_ops_c := v_f.bankcup_count_buy;
      v_ops_s := (v_f.detalle->'bankcup'->>'count_sell')::int;
      v_ventana_h := (v_f.detalle->>'bankcup_window_hours')::numeric;
    end if;

    select coalesce(sum((e->>'usd')::numeric), 0) into v_prof_v
      from jsonb_array_elements(coalesce(v_esc_v, '[]'::jsonb)) e;
    select coalesce(sum((e->>'usd')::numeric), 0) into v_prof_c
      from jsonb_array_elements(coalesce(v_esc_c, '[]'::jsonb)) e;
    v_des_ops := case when coalesce(v_ops_c,0) + coalesce(v_ops_s,0) > 0
      then round((v_ops_c - v_ops_s)::numeric / (v_ops_c + v_ops_s), 4) end;
    v_des_libro := case when v_prof_c + v_prof_v > 0
      then round((v_prof_c - v_prof_v) / (v_prof_c + v_prof_v), 4) end;

    -- Absorción y rotación: pares consecutivos de la ventana, por tasa.
    with serie as (
      select recibida_en,
        case when v_moneda = 'ETECSA' then detalle->'escalera_venta'
             else detalle->'bankcup'->'escalera_venta' end as esc_v,
        case when v_moneda = 'ETECSA' then detalle->'escalera_compra'
             else detalle->'bankcup'->'escalera_compra' end as esc_c,
        row_number() over (order by recibida_en) as rn
        from public.mercado_fotos
       where libro_ok and detalle is not null
         and recibida_en > now() - make_interval(mins => v_cfg.ventana_absorcion_min)
    ), niv as (
      select rn, recibida_en, lado, (e->>'tasa')::numeric as tasa, (e->>'usd')::numeric as usd
        from serie, lateral (
          select 'venta' as lado, jsonb_array_elements(coalesce(esc_v,'[]'::jsonb)) as e
          union all
          select 'compra', jsonb_array_elements(coalesce(esc_c,'[]'::jsonb))) x
    ), pares as (
      select a.lado, a.tasa,
        greatest(0, a.usd - coalesce(b.usd, 0)) as salida,
        abs(coalesce(b.usd, 0) - a.usd) as variacion
        from niv a left join niv b on b.rn = a.rn + 1 and b.lado = a.lado and b.tasa = a.tasa
    ), alcance as (
      select extract(epoch from (max(recibida_en) - min(recibida_en))) / 3600.0 as h,
             count(distinct rn) as n
        from serie)
    select
      (select h from alcance),
      case when (select h from alcance) > 0.05 then round((
        select coalesce(sum(salida), 0) from pares
         where lado = 'venta' and tasa <= coalesce(v_top_v, 1e9) + v_cfg.banda_tasa)
        / (select h from alcance), 2) end,
      case when (select h from alcance) > 0.05 then round((
        select coalesce(sum(variacion), 0) from pares) / (select h from alcance), 2) end,
      (select coalesce(jsonb_agg(x order by x->>'banda'), '[]'::jsonb) from (
        select jsonb_build_object(
          'banda', banda, 'lado', lado,
          'salida_usd_h', case when (select h from alcance) > 0.05
            then round(sum(salida) / (select h from alcance), 2) end,
          'rotacion_usd_h', case when (select h from alcance) > 0.05
            then round(sum(variacion) / (select h from alcance), 2) end) as x
          from (select floor(tasa / v_cfg.banda_tasa) * v_cfg.banda_tasa as banda,
                       lado, salida, variacion from pares) p
         group by banda, lado) s)
      into v_horas, v_salida_cima, v_rotacion, v_bandas
      from (select 1) uno;

    -- Vida de la cima: minutos desde el último cambio del top de venta.
    if v_moneda = 'ETECSA' then
      select extract(epoch from (now() - coalesce(
        (select max(recibida_en) from public.mercado_fotos
          where libro_ok and etecsa_top_venta is distinct from v_top_v
            and recibida_en <= v_f.recibida_en),
        (select min(recibida_en) from public.mercado_fotos where libro_ok)
      ))) / 60.0,
      not exists (select 1 from public.mercado_fotos
          where libro_ok and etecsa_top_venta is distinct from v_top_v
            and recibida_en <= v_f.recibida_en)
        into v_vida, v_vida_cens;
    else
      select extract(epoch from (now() - coalesce(
        (select max(recibida_en) from public.mercado_fotos
          where libro_ok and (detalle->'bankcup'->>'top_venta')::numeric is distinct from v_top_v
            and recibida_en <= v_f.recibida_en),
        (select min(recibida_en) from public.mercado_fotos where libro_ok)
      ))) / 60.0,
      not exists (select 1 from public.mercado_fotos
          where libro_ok and (detalle->'bankcup'->>'top_venta')::numeric is distinct from v_top_v
            and recibida_en <= v_f.recibida_en)
        into v_vida, v_vida_cens;
    end if;

    v_term := public.demanda_termometro(v_moneda, v_ops, v_salida_cima, v_vida, v_cfg);
    v_senales := jsonb_build_object(
      'pasos_termometro', v_term->'pasos',
      'fotos_en_ventana_h', v_horas,
      'absorcion_declarada', case when v_salida_cima is null
        then 'ausente: ventana de fotos insuficiente pa medir salidas'
        else 'medida: salida de profundidad (ventas+cancels no se distinguen sin uuid por oferta)' end,
      'volumen_declarado', case when v_ops is null
        then 'ausente: la foto no trae operaciones realizadas'
        else 'medido: operaciones completadas de la fuente pública en su ventana' end);

    insert into public.demanda_mediciones
      (moneda, foto_id, foto_en, ventana_fuente_h, ops_realizadas, ops_compra,
       ops_venta, profundidad_compra_usd, profundidad_venta_usd,
       desequilibrio_ops, desequilibrio_libro, salida_cima_usd_h,
       rotacion_libro_usd_h, vida_cima_min, vida_cima_censurada, bandas,
       termometro, senales, propias)
    values
      (v_moneda, v_f.id, v_f.recibida_en, v_ventana_h, v_ops, v_ops_c, v_ops_s,
       v_prof_c, v_prof_v, v_des_ops, v_des_libro, v_salida_cima, v_rotacion,
       round(v_vida, 1), v_vida_cens, coalesce(v_bandas, '[]'::jsonb),
       v_term->>'termometro', v_senales, v_propias);
    v_res := v_res || jsonb_build_object(v_moneda, v_term->>'termometro');
  end loop;
  return jsonb_build_object('ok', true, 'foto_id', v_f.id, 'termometros', v_res);
end;
$f$;

create or replace function public.demanda_leer(p_codigo text)
returns jsonb language plpgsql security definer set search_path = 'public' as $f$
declare v_out jsonb;
begin
  if not public.dinero_es_admin(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_admin_no_valido');
  end if;
  select coalesce(jsonb_object_agg(moneda, fila), '{}'::jsonb) into v_out from (
    select distinct on (moneda) moneda, jsonb_build_object(
      'medida_en', medida_en, 'termometro', termometro,
      'ops_realizadas_ventana', ops_realizadas, 'ops_compra', ops_compra,
      'ops_venta', ops_venta, 'ventana_fuente_h', ventana_fuente_h,
      'profundidad_compra_usd', profundidad_compra_usd,
      'profundidad_venta_usd', profundidad_venta_usd,
      'desequilibrio_ops', desequilibrio_ops, 'desequilibrio_libro', desequilibrio_libro,
      'salida_cima_usd_h', salida_cima_usd_h, 'rotacion_libro_usd_h', rotacion_libro_usd_h,
      'vida_cima_min', vida_cima_min, 'foto_en', foto_en, 'bandas', bandas,
      'senales', senales, 'propias', propias) as fila
      from public.demanda_mediciones order by moneda, medida_en desc) s;
  return jsonb_build_object('ok', true, 'demanda', v_out);
end;
$f$;

-- ============================ PIEZA 2 ==============================

create table if not exists public.pago_proteccion_config (
  id int primary key,
  es_prueba boolean not null,
  activo boolean not null default false,
  activo_desde timestamptz,
  colchon_pct numeric not null default 5.00,
  colchon_origen text not null default 'inicial_sin_historial',
  colchon_min numeric not null default 1.00,
  colchon_max numeric not null default 15.00,
  paso_ajuste_pct numeric not null default 0.50,
  min_obs_ajuste int not null default 2,
  ventana_obs int not null default 20,
  actualizado_en timestamptz not null default now()
);
insert into public.pago_proteccion_config (id, es_prueba, activo, activo_desde)
values (1, false, true, now()), (2, true, false, null)
on conflict (id) do nothing;

create table if not exists public.pago_colchon_observaciones (
  id uuid primary key default gen_random_uuid(),
  creada_en timestamptz not null default now(),
  es_prueba boolean not null default false,
  fuente text not null default 'venta_saldo',
  venta_id uuid,
  ref360_papel numeric not null,
  ingreso_real360 numeric not null,
  desviacion_pct numeric not null,
  procesada boolean not null default false
);
create index if not exists pago_obs_lane_idx
  on public.pago_colchon_observaciones (es_prueba, creada_en);

create table if not exists public.pago_colchon_log (
  id uuid primary key default gen_random_uuid(),
  creado_en timestamptz not null default now(),
  es_prueba boolean not null default false,
  colchon_antes numeric,
  colchon_despues numeric,
  motivo text not null,
  detalle jsonb not null default '{}'::jsonb
);

create table if not exists public.pago_liquidaciones (
  id uuid primary key default gen_random_uuid(),
  vuelta_id uuid not null unique,
  buscador_codigo text not null,
  es_prueba boolean not null default false,
  capital_cup bigint not null,
  producto_cantidad numeric not null,
  ref360_papel numeric not null,
  pct_estrellas numeric not null,
  ganancia_papel bigint not null,
  estimado_papel bigint not null,
  colchon_pct_aplicado numeric not null,
  ref360_protegida numeric not null,
  ganancia_protegida bigint not null,
  fijo bigint not null,
  comision_ya_pagada bigint not null default 0,
  fijo_topup_pagado bigint not null default 0,
  saldo_vendido numeric not null default 0,
  valor_real_acum numeric not null default 0,
  ganancia_real_acum numeric not null default 0,
  extra_acum numeric not null default 0,
  premio_total bigint not null default 0,
  premio_pagado bigint not null default 0,
  creada_en timestamptz not null default now(),
  actualizada_en timestamptz not null default now(),
  constraint pago_liq_fijo_no_supera_papel check (fijo <= estimado_papel),
  constraint pago_liq_premio_no_negativo check (premio_total >= 0 and premio_pagado >= 0)
);

create table if not exists public.pago_ventas_saldo (
  id uuid primary key default gen_random_uuid(),
  creada_en timestamptz not null default now(),
  referencia text not null unique,
  origen text not null default 'manual',
  es_prueba boolean not null default false,
  saldo_vendido numeric not null,
  tasa_ejecutada numeric not null,
  qusd_recibidos numeric not null,
  salida_ref_usada numeric not null,
  ingreso_real360 numeric not null,
  ref360_vigente numeric,
  foto_id uuid,
  premio_total bigint not null default 0,
  detalle jsonb not null default '{}'::jsonb
);

create table if not exists public.pago_premio_detalle (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.pago_ventas_saldo(id),
  liquidacion_id uuid not null references public.pago_liquidaciones(id),
  vuelta_id uuid not null,
  saldo_atribuido numeric not null,
  costo_cup_atribuido numeric not null,
  valor_real_cup numeric not null,
  valor_protegido_cup numeric not null,
  extra_cup numeric not null,
  premio_cup bigint not null,
  creado_en timestamptz not null default now(),
  unique (venta_id, vuelta_id)
);
alter table public.pago_proteccion_config enable row level security;
alter table public.pago_colchon_observaciones enable row level security;
alter table public.pago_colchon_log enable row level security;
alter table public.pago_liquidaciones enable row level security;
alter table public.pago_ventas_saldo enable row level security;
alter table public.pago_premio_detalle enable row level security;

-- Congelar el fijo de una vuelta (idempotente; solo snapshot, sin mover
-- dinero). Devuelve la liquidación o el motivo.
create or replace function public.pago_congelar_snapshot(p_vuelta uuid)
returns jsonb language plpgsql security definer set search_path = 'public' as $f$
declare
  v_v public.dinero_vueltas;
  v_cfg public.pago_proteccion_config;
  v_est numeric; v_pct numeric;
  v_ref_prot numeric; v_valor_prot bigint; v_gan_prot bigint; v_fijo bigint;
  v_liq public.pago_liquidaciones;
begin
  select * into v_liq from public.pago_liquidaciones where vuelta_id = p_vuelta;
  if v_liq.id is not null then
    return jsonb_build_object('ok', true, 'ya_existia', true, 'liquidacion', v_liq.id);
  end if;
  select * into v_v from public.dinero_vueltas where id = p_vuelta;
  if v_v.id is null then return jsonb_build_object('ok', false, 'motivo', 'vuelta_no_existe'); end if;
  if v_v.tipo <> 'saldo' then return jsonb_build_object('ok', false, 'motivo', 'no_es_saldo'); end if;
  select * into v_cfg from public.pago_proteccion_config where es_prueba = v_v.es_prueba;
  if not coalesce(v_cfg.activo, false) then
    return jsonb_build_object('ok', false, 'motivo', 'regimen_inactivo'); end if;
  if v_cfg.activo_desde is not null and v_v.abierta_en < v_cfg.activo_desde then
    return jsonb_build_object('ok', false, 'motivo', 'fuera_de_regimen'); end if;
  select estrellas into v_est from public.dinero_estrellas_de(v_v.buscador_codigo, v_v.es_prueba);
  v_pct := public.dinero_pct_estrellas(v_est, 'saldo');
  v_ref_prot := round(v_v.base_ref360 * (1 - v_cfg.colchon_pct / 100.0), 4);
  v_valor_prot := floor(v_v.producto_cantidad * v_ref_prot / 360.0)::bigint;
  v_gan_prot := v_valor_prot - v_v.capital_cup;
  v_fijo := case when v_gan_prot > 0 then floor(v_gan_prot * v_pct / 100.0)::bigint else 0 end;
  if v_fijo > v_v.comision then v_fijo := v_v.comision; end if; -- invariante dura
  insert into public.pago_liquidaciones
    (vuelta_id, buscador_codigo, es_prueba, capital_cup, producto_cantidad,
     ref360_papel, pct_estrellas, ganancia_papel, estimado_papel,
     colchon_pct_aplicado, ref360_protegida, ganancia_protegida, fijo,
     comision_ya_pagada)
  values
    (v_v.id, v_v.buscador_codigo, v_v.es_prueba, v_v.capital_cup, v_v.producto_cantidad,
     v_v.base_ref360, v_pct, v_v.ganancia_capturada, v_v.comision,
     v_cfg.colchon_pct, v_ref_prot, v_gan_prot, v_fijo,
     case when v_v.pago_hecho then v_v.comision else 0 end)
  returning * into v_liq;
  return jsonb_build_object('ok', true, 'ya_existia', false, 'liquidacion', v_liq.id,
    'fijo', v_liq.fijo, 'estimado_papel', v_liq.estimado_papel,
    'colchon_pct', v_liq.colchon_pct_aplicado);
end;
$f$;

-- Trigger: toda vuelta de saldo que NAZCA bajo el régimen queda
-- fotografiada. NUNCA rompe el asiento: cualquier error se anota y pasa.
create or replace function public.pago_al_nacer_vuelta()
returns trigger language plpgsql security definer set search_path = 'public' as $f$
begin
  if new.tipo = 'saldo' then
    begin
      perform public.pago_congelar_snapshot(new.id);
    exception when others then
      begin
        insert into public.pago_colchon_log (es_prueba, motivo, detalle)
        values (new.es_prueba, 'error_snapshot',
          jsonb_build_object('vuelta', new.id, 'error', sqlerrm));
      exception when others then null;
      end;
    end;
  end if;
  return new;
end;
$f$;
drop trigger if exists pago_snapshot_al_nacer on public.dinero_vueltas;
create trigger pago_snapshot_al_nacer
  after insert on public.dinero_vueltas
  for each row execute function public.pago_al_nacer_vuelta();

-- Puerta del dueño: congelar (si faltara) + pagar el top-up del fijo
-- cuando la comisión del flujo viejo quedó por debajo del protegido.
create or replace function public.pago_congelar_fijo(p_codigo text, p_vuelta uuid)
returns jsonb language plpgsql security definer set search_path = 'public' as $f$
declare v_s jsonb; v_liq public.pago_liquidaciones; v_topup bigint;
begin
  if not public.dinero_es_admin(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_admin_no_valido'); end if;
  v_s := public.pago_congelar_snapshot(p_vuelta);
  if not (v_s->>'ok')::boolean then return v_s; end if;
  select * into v_liq from public.pago_liquidaciones where vuelta_id = p_vuelta for update;
  v_topup := v_liq.fijo - v_liq.comision_ya_pagada - v_liq.fijo_topup_pagado;
  if v_topup > 0 then
    perform public.dinero_mover('fondo', 'fijo_protegido_topup', -v_topup, 'saldo',
      v_liq.vuelta_id::text, v_liq.buscador_codigo, v_liq.es_prueba);
    perform public.dinero_mover('cupo:' || v_liq.buscador_codigo, 'fijo_protegido_topup',
      v_topup, 'saldo', v_liq.vuelta_id::text, null, v_liq.es_prueba);
    update public.pago_liquidaciones
       set fijo_topup_pagado = fijo_topup_pagado + v_topup, actualizada_en = now()
     where id = v_liq.id;
  end if;
  return jsonb_build_object('ok', true, 'fijo', v_liq.fijo,
    'comision_ya_pagada', v_liq.comision_ya_pagada, 'topup_pagado_ahora', greatest(v_topup, 0));
end;
$f$;

-- Autoajuste del colchón: dos lecturas o nada; pasos acotados; log.
create or replace function public.pago_autoajustar_colchon(p_prueba boolean)
returns jsonb language plpgsql security definer set search_path = 'public' as $f$
declare
  v_cfg public.pago_proteccion_config;
  v_obs record; v_n int; v_prom numeric; v_dir int;
  v_objetivo numeric; v_nuevo numeric;
begin
  select * into v_cfg from public.pago_proteccion_config
   where es_prueba = p_prueba for update;
  if v_cfg.id is null then return jsonb_build_object('ok', false, 'motivo', 'sin_config'); end if;
  select count(*), avg(desviacion_pct) into v_n, v_prom
    from (select desviacion_pct from public.pago_colchon_observaciones
           where es_prueba = p_prueba and not procesada
           order by creada_en desc limit v_cfg.ventana_obs) u;
  if coalesce(v_n, 0) < v_cfg.min_obs_ajuste then
    return jsonb_build_object('ok', true, 'ajuste', false,
      'motivo', 'faltan_observaciones', 'n', coalesce(v_n, 0)); end if;
  -- las dos más recientes deben pedir el MISMO sentido de movimiento
  select sign(desviacion_pct - v_cfg.colchon_pct) into v_dir
    from public.pago_colchon_observaciones
   where es_prueba = p_prueba and not procesada order by creada_en desc limit 1;
  if exists (select 1 from (select desviacion_pct from public.pago_colchon_observaciones
               where es_prueba = p_prueba and not procesada
               order by creada_en desc limit v_cfg.min_obs_ajuste) d
             where sign(d.desviacion_pct - v_cfg.colchon_pct) is distinct from v_dir) then
    return jsonb_build_object('ok', true, 'ajuste', false,
      'motivo', 'observaciones_en_conflicto');
  end if;
  if v_dir = 0 then
    update public.pago_colchon_observaciones set procesada = true
     where es_prueba = p_prueba and not procesada;
    return jsonb_build_object('ok', true, 'ajuste', false, 'motivo', 'sin_movimiento');
  end if;
  v_objetivo := least(v_cfg.colchon_max, greatest(v_cfg.colchon_min, round(v_prom, 2)));
  v_nuevo := v_cfg.colchon_pct + v_dir * least(v_cfg.paso_ajuste_pct, abs(v_objetivo - v_cfg.colchon_pct));
  v_nuevo := least(v_cfg.colchon_max, greatest(v_cfg.colchon_min, round(v_nuevo, 2)));
  if v_nuevo = v_cfg.colchon_pct then
    update public.pago_colchon_observaciones set procesada = true
     where es_prueba = p_prueba and not procesada;
    return jsonb_build_object('ok', true, 'ajuste', false, 'motivo', 'en_el_tope');
  end if;
  update public.pago_proteccion_config
     set colchon_pct = v_nuevo, colchon_origen = 'autoajuste_ventas_reales',
         actualizado_en = now()
   where id = v_cfg.id;
  insert into public.pago_colchon_log (es_prueba, colchon_antes, colchon_despues, motivo, detalle)
  values (p_prueba, v_cfg.colchon_pct, v_nuevo, 'autoajuste_dos_lecturas',
    jsonb_build_object('observaciones', v_n, 'desviacion_promedio', round(v_prom, 2),
      'objetivo', v_objetivo));
  update public.pago_colchon_observaciones set procesada = true
   where es_prueba = p_prueba and not procesada;
  return jsonb_build_object('ok', true, 'ajuste', true,
    'antes', v_cfg.colchon_pct, 'despues', v_nuevo, 'observaciones', v_n);
end;
$f$;

-- La venta real del saldo (QUSD recibido): consumo FIFO + premio.
create or replace function public.pago_registrar_venta_saldo(
  p_codigo text, p_referencia text, p_saldo numeric, p_tasa numeric,
  p_qusd numeric, p_origen text default 'manual', p_prueba boolean default false)
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
  v_detalle jsonb := '[]'::jsonb;
  v_pagar record;
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

  -- pagar los premios nuevos (fondo → cupo), una sola vez por liquidación
  for v_pagar in
    select * from public.pago_liquidaciones
     where premio_total > premio_pagado and id in
       (select liquidacion_id from public.pago_premio_detalle where venta_id = v_venta)
     for update
  loop
    v_premio_nuevo := v_pagar.premio_total - v_pagar.premio_pagado;
    perform public.dinero_mover('fondo', 'premio_venta', -v_premio_nuevo, 'saldo',
      v_pagar.vuelta_id::text, v_pagar.buscador_codigo, v_pagar.es_prueba);
    perform public.dinero_mover('cupo:' || v_pagar.buscador_codigo, 'premio_venta',
      v_premio_nuevo, 'saldo', v_pagar.vuelta_id::text, null, v_pagar.es_prueba);
    update public.pago_liquidaciones set premio_pagado = premio_total,
      actualizada_en = now() where id = v_pagar.id;
  end loop;

  update public.pago_ventas_saldo
     set premio_total = (select coalesce(sum(premio_cup), 0)
                           from public.pago_premio_detalle where venta_id = v_venta),
         detalle = v_detalle
   where id = v_venta;

  -- observación pa el colchón: papel vigente vs real de ESTA venta
  insert into public.pago_colchon_observaciones
    (es_prueba, venta_id, ref360_papel, ingreso_real360, desviacion_pct)
  values (coalesce(p_prueba, false), v_venta, v_t.ingreso_ref360, v_ingreso_real,
    round((v_t.ingreso_ref360 - v_ingreso_real) / v_t.ingreso_ref360 * 100.0, 2));
  perform public.pago_autoajustar_colchon(coalesce(p_prueba, false));

  return jsonb_build_object('ok', true, 'ya_existia', false, 'venta', v_venta,
    'ingreso_real360', v_ingreso_real,
    'premio_total', (select premio_total from public.pago_ventas_saldo where id = v_venta),
    'detalle', v_detalle);
end;
$f$;

-- Vista del dueño: antes/ahora por vuelta + estado del colchón.
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
      'ahora', jsonb_build_object('saldo_vendido', l.saldo_vendido,
        'valor_real', round(l.valor_real_acum, 2),
        'ganancia_real', round(l.ganancia_real_acum, 2),
        'extra_real', round(l.extra_acum, 2), 'premio', l.premio_pagado),
      'buscador_total', greatest(l.fijo, l.comision_ya_pagada) + l.premio_pagado,
      'neto_ernesto_real', round(l.ganancia_real_acum, 2)
        - greatest(l.fijo, l.comision_ya_pagada) - l.premio_pagado) as fila
      from public.pago_liquidaciones l) s;
  select coalesce(jsonb_agg(jsonb_build_object('es_prueba', es_prueba, 'activo', activo,
      'activo_desde', activo_desde, 'colchon_pct', colchon_pct,
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

-- Vista del BUSCADOR: solo sus montos. Sin colchón, sin tasas protegidas,
-- sin salida — la cocina es del dueño (misma frontera que tarifa_viva).
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
      'total', greatest(l.fijo, l.comision_ya_pagada) + l.premio_pagado,
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

-- Permisos: las tripas solo pa service_role; las puertas validan código.
revoke all on function public.demanda_evaluar() from public, anon, authenticated;
revoke all on function public.pago_congelar_snapshot(uuid) from public, anon, authenticated;
revoke all on function public.pago_autoajustar_colchon(boolean) from public, anon, authenticated;
grant execute on function public.demanda_evaluar() to service_role;
grant execute on function public.pago_congelar_snapshot(uuid) to service_role;
grant execute on function public.pago_autoajustar_colchon(boolean) to service_role;

-- Cron: demanda cada 5 min · red de seguridad del colchón cada hora.
do $do$
begin
  if not exists (select 1 from cron.job where jobname = 'demanda-cada-5min') then
    perform cron.schedule('demanda-cada-5min', '*/5 * * * *',
      'select public.demanda_evaluar()');
  end if;
  if not exists (select 1 from cron.job where jobname = 'pago-colchon-cada-1h') then
    perform cron.schedule('pago-colchon-cada-1h', '17 * * * *',
      'select public.pago_autoajustar_colchon(false)');
  end if;
end;
$do$;

-- =====================================================================
-- FRENO POR BANDA EN EL ASESOR (2026-11-14) — ajuste aprobado por
-- Ernesto: «que el freno mire la zona de MI oferta».
--
-- Antes: el tope del monto preparado lo mandaba la absorción de la
-- CIMA del libro (salida_cima_usd_h × ventana). Esta madrugada la
-- cima era una oferta sola a 280 sin profundidad (absorción 0) y el
-- freno vetaba zonas vivas: la banda 310+ rotaba 8,57 USD/h.
--
-- Qué hace esta migración (solo servidor, tres funciones):
--   1. demanda_evaluar: el desglose `bandas` de cada medición gana
--      la VIDA por banda (min desde el último cambio de su
--      profundidad en la ventana; si nunca cambió, la ventana
--      entera, marcada vida_censurada). La cima se sigue calculando
--      igual pa el termómetro y los porqués.
--   2. guia_asesor_interno: pasa el desglose por bandas (+ banda_tasa
--      y ventana) al cálculo. La señal «presente» ahora vive en las
--      bandas: cima en cero ya NO marca la medición ausente; sin
--      bandas (legado) manda la regla anterior.
--   3. guia_calc_asesor: el tope = salida de la banda que contiene
--      la tasa del peldaño elegido × ventana_absorcion_min. Los
--      porqués nombran la banda y su salida («la zona de tu oferta
--      a 310 (banda 310–315) se comió 8,57 USD/h…»). Banda sin
--      absorción medida = cero → motivo nuevo
--      `demanda_sin_absorcion_en_tu_zona`: el freno NO se afloja —
--      zona muerta frena igual que la cima muerta de antes.
--      Medición vieja/ausente: se declara y prepara sin tope,
--      igual que hoy. Sin bandas en la medición (legado), el
--      comportamiento es el de la cima, intacto (regresión D0–D5
--      del banco de plantilla-demanda sigue verde).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.demanda_evaluar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        from serie), bserie as (
      -- profundidad por (foto, lado, banda) en la misma ventana: la
      -- vida de cada banda se mide sobre esta serie.
      select rn, recibida_en, lado,
             floor(tasa / v_cfg.banda_tasa) * v_cfg.banda_tasa as banda,
             sum(usd) as usd
        from niv group by rn, recibida_en, lado, banda
    ), bvida as (
      -- vida de la banda = minutos desde el último cambio de su
      -- profundidad dentro de la ventana (la profundidad «actual» es
      -- la de la foto más reciente; banda ausente en ella = 0). Si
      -- nunca cambió en la ventana, la vida es la ventana entera y
      -- va marcada censurada: número honesto, no inventado.
      select s.lado, s.banda,
        round(extract(epoch from (
          (select max(recibida_en) from serie)
          - coalesce(max(s.recibida_en) filter (
              where s.usd is distinct from coalesce(f.usd, 0)),
            (select min(recibida_en) from serie)))) / 60.0, 1) as vida_min,
        not coalesce(bool_or(s.usd is distinct from coalesce(f.usd, 0)),
                     false) as vida_censurada
        from bserie s
        left join (select lado, banda, usd from bserie
                    where rn = (select max(rn) from serie)) f
          on f.lado = s.lado and f.banda = s.banda
       group by s.lado, s.banda, f.usd
    )
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
          'banda', p.banda, 'lado', p.lado,
          'salida_usd_h', case when (select h from alcance) > 0.05
            then round(sum(salida) / (select h from alcance), 2) end,
          'rotacion_usd_h', case when (select h from alcance) > 0.05
            then round(sum(variacion) / (select h from alcance), 2) end,
          'vida_min', bv.vida_min,
          'vida_censurada', coalesce(bv.vida_censurada, true)) as x
          from (select floor(tasa / v_cfg.banda_tasa) * v_cfg.banda_tasa as banda,
                       lado, salida, variacion from pares) p
          left join bvida bv on bv.banda = p.banda and bv.lado = p.lado
         group by p.banda, p.lado, bv.vida_min, bv.vida_censurada) s)
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
$function$;

CREATE OR REPLACE FUNCTION public.guia_asesor_interno(p_prueba boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cfg record; v_foto record; v_tar record; v_mc record;
  v_linea numeric; v_linea_en timestamptz;
  v_lotes jsonb; v_fondo numeric; v_reserva numeric := 0;
  v_inicio timestamptz := ((now() at time zone 'America/Havana')::date)::timestamp
                           at time zone 'America/Havana';
  v_monto_hoy numeric; v_hora integer; v_prev record;
  v_calc jsonb; v_sil timestamptz;
  v_puesto boolean; v_habana_hoy date :=
    (now() at time zone 'America/Havana')::date;
  -- PLANTILLA (2026-11-14): base = oferta viva, si no la plantilla.
  v_plant record; v_base_viva boolean; v_base boolean; v_base_fuente text;
  -- DEMANDA (2026-11-14): última medición ETECSA + ventana de absorción.
  v_dem record; v_dem_vent_min int; v_dem_edad_min numeric;
  v_dem_ausente boolean; v_dem_usable boolean; v_dem_decl text;
  v_dem_tope numeric; v_dem_banda_tasa numeric;
begin
  select * into v_cfg from public.guia_config where id = 1;
  select * into v_tar from public.tarifa where id = 1;
  select * into v_mc from public.mercado_config where id = 1;
  select * into v_foto from public.mercado_fotos
   order by recibida_en desc limit 1;
  -- La plantilla es POR (moneda, lado): esta siembra es ETECSA·sell.
  -- Los «details» reales de QvaPay son un OBJETO (ej. {"Celular": …}):
  -- se acepta objeto con claves o array no vacío; jamás se exige array.
  select * into v_plant from public.guia_plantilla
   where moneda = 'ETECSA' and tipo = 'sell'
   order by sembrada_en desc nulls last limit 1;

  v_base_viva := coalesce(
    (v_foto.detalle #>> '{propias,base_venta}')::boolean, false);
  v_base := v_base_viva or (
    v_plant.id is not null
    and v_plant.detalles is not null
    and ((jsonb_typeof(v_plant.detalles) = 'object'
          and (select count(*) from jsonb_object_keys(v_plant.detalles)) > 0)
         or (jsonb_typeof(v_plant.detalles) = 'array'
             and jsonb_array_length(v_plant.detalles) > 0)));

  -- DEMANDA: la medición manda solo si es fresca (≤15 min) y la señal
  -- está presente; si no, se declara y el asesor prepara sin ella.
  select * into v_dem from public.demanda_mediciones
   where moneda = 'ETECSA' order by medida_en desc limit 1;
  select ventana_absorcion_min, banda_tasa
    into v_dem_vent_min, v_dem_banda_tasa
    from public.demanda_config where id = 1;
  v_dem_edad_min := case when v_dem.id is null then null
    else extract(epoch from (now() - v_dem.medida_en)) / 60.0 end;
  -- FRENO POR BANDA (2026-11-14): con desglose por bandas, la señal
  -- vive en las bandas — la cima en cero ya NO marca la medición
  -- ausente (es justo el caso que el ajuste vino a corregir), y una
  -- medición con bandas pero SIN ninguna salida de venta medible
  -- (ventana insuficiente) se declara ausente como antes. Sin
  -- bandas (medición legada), manda la regla de la cima de siempre.
  v_dem_ausente := v_dem.id is not null
    and (v_dem.termometro = 'sin_datos'
         or (coalesce(v_dem.bandas, '[]'::jsonb) = '[]'::jsonb
             and v_dem.salida_cima_usd_h is null)
         or (coalesce(v_dem.bandas, '[]'::jsonb) <> '[]'::jsonb
             and not exists (
               select 1 from jsonb_array_elements(v_dem.bandas) b
                where b ->> 'lado' = 'venta'
                  and (b ->> 'salida_usd_h') is not null)));
  v_dem_usable := v_dem.id is not null and not v_dem_ausente
    and v_dem_edad_min <= 15;
  v_dem_decl := case
    when v_dem.id is null then 'sin_medicion'
    when v_dem_ausente then 'senal_ausente'
    when v_dem_edad_min > 15 then 'medicion_vieja'
    else 'aplicada' end;
  v_dem_tope := case when v_dem_usable
    then v_dem.salida_cima_usd_h
         * (coalesce(v_dem_vent_min, 120) / 60.0) end;
  v_base_fuente := case when v_base_viva then 'oferta_viva'
                        when v_base then 'plantilla' else null end;

  select saldo_principal_cup, recibido_en into v_linea, v_linea_en
    from public.sms_linea
   where saldo_principal_cup is not null
   order by id desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'cantidad', cantidad_restante, 'costo', costo_restante_cup)
           order by creado_en), '[]'::jsonb)
    into v_lotes
    from public.dinero_lotes_saldo
   where es_prueba = p_prueba and cantidad_restante > 0;

  v_fondo := public.dinero_saldo('fondo', p_prueba);
  select coalesce(sum(greatest(
           public.dinero_cupo(
             (select capital_total from public.dinero_fondo
               where es_prueba = p_prueba), a.porciento)
           - coalesce((select sum(e.monto_original)
                         from public.dinero_entregas e
                        where e.buscador_codigo = a.buscador_codigo
                          and e.es_prueba = p_prueba
                          and e.estado in ('entregado', 'en_calle')), 0),
           0)), 0)
    into v_reserva
    from public.dinero_asignaciones a where a.es_prueba = p_prueba;

  select coalesce(sum(monto_qusd), 0) into v_monto_hoy
    from public.mercado_acciones
   where estado = 'ejecutada' and creada_en >= v_inicio;
  select count(*)::int into v_hora
    from public.mercado_acciones
   where estado in ('ejecutada', 'ejecutando')
     and creada_en > now() - interval '1 hour';
  select * into v_prev from public.mercado_acciones
   where origen = 'asesor' and estado = 'preparada'
     and expira_en > now()
   order by creada_en desc limit 1;
  select greatest(silencio_asesor_hasta, preparada_silencio_hasta)
    into v_sil from public.guia_estado where id = 1;
  v_puesto := v_habana_hoy between v_cfg.puesto_desde and v_cfg.puesto_hasta;

  v_calc := public.guia_calc_asesor(jsonb_build_object(
    'ahora', now(),
    'foto', jsonb_build_object(
      'usable', (v_foto.id is not null and v_foto.libro_ok and v_foto.fresca
        and v_foto.recibida_en > now() - interval '20 minutes'),
      'id', v_foto.id, 'recibida_en', v_foto.recibida_en,
      'nivel20', v_foto.etecsa_nivel20, 'top_venta', v_foto.etecsa_top_venta,
      'promedio_venta', v_foto.etecsa_promedio_venta,
      'senal', v_foto.detalle -> 'analisis' -> 'senal',
      'menu', v_foto.detalle -> 'analisis' -> 'menu',
      'ejecutable20', jsonb_build_object(
        'tasa', v_foto.detalle #>> '{analisis,ejecutable,usd20,tasa}',
        'usd', v_foto.detalle #>> '{analisis,ejecutable,usdAccion,usd}'),
      'duras', v_foto.detalle -> 'analisis' -> 'duras',
      'transferencia', v_foto.detalle -> 'analisis' -> 'transferencia'),
    'tarifa', jsonb_build_object(
      'salida_ref', v_tar.salida_ref,
      'ingreso_ref360', v_tar.ingreso_ref360,
      'libro_ref', v_tar.libro_ref),
    'costo_ref360', v_mc.costo_ref360,
    'posicion', jsonb_build_object(
      'linea_saldo', v_linea, 'linea_en', v_linea_en,
      'lotes', v_lotes,
      'comprometido_saldo', (v_foto.detalle #>> '{propias,comprometido_saldo}')::numeric,
      'base_venta', v_base,
      'base_fuente', v_base_fuente,
      'qUSD', (v_foto.detalle #>> '{qUSD,balance}')::numeric,
      'fondo', v_fondo, 'reserva_cupos', v_reserva,
      'mejor_nivel20_hoy', (select max(etecsa_nivel20) from public.mercado_fotos
        where recibida_en >= v_inicio)),
    'puerta', jsonb_build_object(
      'tope_oferta', v_mc.accion_monto_qusd,
      'monto_hoy', v_monto_hoy, 'acciones_hora', v_hora,
      'preparada_viva', v_prev.id is not null,
      'detenidas', coalesce(v_mc.acciones_detenidas, false),
      'pausadas', coalesce(v_mc.acciones_pausadas, false)),
    'cfg', jsonb_build_object(
      'colchon', v_cfg.colchon_saldo, 'mat_fifo', v_cfg.mat_asesor_fifo),
    'demanda', jsonb_build_object(
      'usable', v_dem_usable, 'declaracion', v_dem_decl,
      'termometro', v_dem.termometro,
      'salida_cima_usd_h', v_dem.salida_cima_usd_h,
      'vida_cima_min', v_dem.vida_cima_min,
      'medida_en', v_dem.medida_en,
      'tope_usd', v_dem_tope,
      'bandas', coalesce(v_dem.bandas, '[]'::jsonb),
      'banda_tasa', v_dem_banda_tasa,
      'ventana_min', v_dem_vent_min),
    'silencio_hasta', v_sil,
    'promo_puesto', jsonb_build_object(
      'activa', v_puesto, 'ref_cierre', v_foto.etecsa_promedio_venta)));

  return jsonb_build_object(
    'ok', true,
    'foto', case when v_foto.id is null then null else jsonb_build_object(
      'id', v_foto.id, 'recibida_en', v_foto.recibida_en,
      'origen', v_foto.origen, 'fresca', v_foto.fresca,
      'libro_ok', v_foto.libro_ok,
      'usable', (v_foto.libro_ok and v_foto.fresca
        and v_foto.recibida_en > now() - interval '20 minutes')) end,
    'tarifa', jsonb_build_object(
      'ingreso_ref360', v_tar.ingreso_ref360, 'libro_ref', v_tar.libro_ref,
      'salida_ref', v_tar.salida_ref, 'costo_ref360', v_mc.costo_ref360),
    'base', jsonb_build_object(
      'fuente', v_base_fuente,
      'plantilla', case when v_plant.id is null then null else
        jsonb_build_object('oferta_uuid', v_plant.oferta_uuid,
          'fuente', v_plant.fuente, 'sembrada_en', v_plant.sembrada_en,
          'moneda', v_plant.moneda, 'tipo', v_plant.tipo) end),
    'demanda', jsonb_build_object(
      'declaracion', v_dem_decl, 'usable', v_dem_usable,
      'termometro', v_dem.termometro,
      'salida_cima_usd_h', v_dem.salida_cima_usd_h,
      'vida_cima_min', v_dem.vida_cima_min,
      'medida_en', v_dem.medida_en,
      'tope_usd', coalesce((v_calc #>> '{demanda,tope_usd}')::numeric,
                           v_dem_tope),
      'modo', v_calc #>> '{demanda,modo}',
      'banda', (v_calc #>> '{demanda,banda}')::numeric,
      'salida_banda_usd_h',
        (v_calc #>> '{demanda,salida_banda_usd_h}')::numeric),
    'comprometido_legible',
      (v_foto.detalle -> 'propias' ->> 'comprometido_saldo') is not null,
    'qUSD_legible', (v_foto.detalle -> 'qUSD' ->> 'balance') is not null,
    'calculo', v_calc,
    'preparada_viva', case when v_prev.id is null then null else jsonb_build_object(
      'id', v_prev.id, 'tasa', v_prev.tasa, 'monto_qusd', v_prev.monto_qusd,
      'ganancia360', v_prev.ganancia360, 'expira_en', v_prev.expira_en,
      'contexto', v_prev.contexto) end,
    'contadores', jsonb_build_object(
      'hoy_qusd', v_monto_hoy, 'diario_max', 120,
      'acciones_hora', v_hora, 'hora_max', 2,
      'tope_oferta', v_mc.accion_monto_qusd),
    'silencio_hasta', v_sil);
end;
$function$;

CREATE OR REPLACE FUNCTION public.guia_calc_asesor(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_ahora     timestamptz := coalesce((p ->> 'ahora')::timestamptz, now());
  v_salida    numeric := (p #>> '{tarifa,salida_ref}')::numeric;
  v_costo     numeric := (p ->> 'costo_ref360')::numeric;
  v_linea     numeric := (p #>> '{posicion,linea_saldo}')::numeric;
  v_comp      numeric := (p #>> '{posicion,comprometido_saldo}')::numeric;
  v_colchon   numeric := coalesce((p #>> '{cfg,colchon}')::numeric, 360);
  v_mat_fifo  numeric := coalesce((p #>> '{cfg,mat_fifo}')::numeric, 300);
  v_lotes_tot numeric := 0; v_lotes_costo numeric := 0;
  v_sin_lote  numeric; v_descuadre boolean := false;
  v_vendible  numeric; v_fondo_tras numeric;
  v_eq        numeric; v_senal text;
  v_motivos   text[] := '{}';
  -- preparada
  v_pel       jsonb; v_pel_nombre text; v_tasa numeric; v_g numeric;
  v_monto     numeric; v_receive numeric;
  v_queda     numeric; v_costo_fifo numeric := 0; v_con_lote numeric := 0;
  v_pro_sin   numeric; v_gan_fifo numeric; v_gan_dia numeric;
  v_desglose  jsonb := '[]'::jsonb; v_item jsonb; v_toma numeric;
  v_porques   jsonb; v_aviso_promo text;
  v_prep      jsonb := null;
  -- DEMANDA (2026-11-14): tope por profundidad absorbible.
  -- FRENO POR BANDA (2026-11-14, ajuste aprobado por Ernesto): el
  -- tope lo manda la absorción de la BANDA donde cae la tasa del
  -- peldaño elegido, no la de la cima — la cima puede estar muerta
  -- mientras la zona de la oferta rota. Si la medición no trae
  -- bandas (legado), manda el tope de cima de siempre.
  v_dem_ok    boolean := coalesce((p #>> '{demanda,usable}')::boolean, false);
  v_dem_decl  text := p #>> '{demanda,declaracion}';
  v_dem_tope  numeric := (p #>> '{demanda,tope_usd}')::numeric;
  v_dem_topado boolean := false;
  v_dem_modo_banda boolean := false;
  v_dem_banda_tasa numeric :=
    coalesce((p #>> '{demanda,banda_tasa}')::numeric, 5);
  v_dem_vent_min numeric := (p #>> '{demanda,ventana_min}')::numeric;
  v_dem_banda numeric; v_dem_salida_banda numeric; v_dem_vida_banda numeric;
  -- compra con fondo
  v_margen_calle numeric; v_compra jsonb;
begin
  select coalesce(sum((l ->> 'cantidad')::numeric), 0),
         coalesce(sum((l ->> 'costo')::numeric), 0)
    into v_lotes_tot, v_lotes_costo
    from jsonb_array_elements(coalesce(p #> '{posicion,lotes}', '[]'::jsonb)) l;
  v_sin_lote := case when v_linea is null then null
                     else greatest(v_linea - v_lotes_tot, 0) end;
  v_descuadre := v_linea is not null and v_lotes_tot > v_linea + 5;
  v_vendible := case when v_linea is null or v_comp is null then null
                     else greatest(v_linea - v_comp - v_colchon, 0) end;
  v_fondo_tras := greatest(
    coalesce((p #>> '{posicion,fondo}')::numeric, 0)
    - coalesce((p #>> '{posicion,reserva_cupos}')::numeric, 0), 0);
  v_eq := case when v_salida is null or v_costo is null
                 or v_salida <= 0 or v_costo <= 0 then null
               else round(360 * v_salida / v_costo, 2) end;
  v_senal := p #>> '{foto,senal,palabra}';
  -- modo banda: la medición trae desglose por banda con lado venta
  v_dem_modo_banda := v_dem_ok and exists (
    select 1 from jsonb_array_elements(
      coalesce(p #> '{demanda,bandas}', '[]'::jsonb)) b
     where b ->> 'lado' = 'venta');

  -- ---------- ¿se prepara? (motivos en claro, R2/R6/R9/R10) ----------
  if not coalesce((p #>> '{foto,usable}')::boolean, false) then
    v_motivos := array_append(v_motivos, 'foto_no_usable');
  end if;
  if not (v_senal = 'VENDER'
          or (v_senal = 'APROVECHAR'
              and (p #>> '{foto,duras,0,lado}') = 'compra')) then
    v_motivos := array_append(v_motivos, 'senal_no_vender');
  end if;
  if coalesce((p #>> '{puerta,detenidas}')::boolean, false)
     or coalesce((p #>> '{puerta,pausadas}')::boolean, false) then
    v_motivos := array_append(v_motivos, 'puerta_en_pausa');
  end if;
  if coalesce((p #>> '{puerta,preparada_viva}')::boolean, false) then
    v_motivos := array_append(v_motivos, 'ya_hay_preparada');
  end if;
  if (p ->> 'silencio_hasta') is not null
     and (p ->> 'silencio_hasta')::timestamptz > v_ahora then
    v_motivos := array_append(v_motivos, 'silencio');
  end if;
  if not coalesce((p #>> '{posicion,base_venta}')::boolean, false) then
    v_motivos := array_append(v_motivos, 'sin_oferta_base');
  end if;
  if v_vendible is null then
    v_motivos := array_append(v_motivos, 'sin_posicion_firme');
  end if;
  if v_descuadre then
    v_motivos := array_append(v_motivos, 'descuadre_linea_libro');
  end if;
  if coalesce((p #>> '{puerta,acciones_hora}')::int, 0) >= 2 then
    v_motivos := array_append(v_motivos, 'tope_hora');
  end if;

  if array_length(v_motivos, 1) is null then
    -- peldaño: dura de compra -> Equilibrado (el del botón del Analista);
    -- VENDER -> Paciente si su G es zona buena y la demanda ejecutable
    -- lo alcanza (vwap20 a ≤5 por debajo); si no, Equilibrado; si no,
    -- Inmediato (menú de analista.js, ya calculado en la foto).
    if v_senal = 'APROVECHAR' then
      select e into v_pel from jsonb_array_elements(
        coalesce(p #> '{foto,menu,peldanos}', '[]'::jsonb)) e
       where e ->> 'nombre' = 'Equilibrado' limit 1;
      v_pel_nombre := 'Equilibrado';
    else
      select e into v_pel from jsonb_array_elements(
        coalesce(p #> '{foto,menu,peldanos}', '[]'::jsonb)) e
       where e ->> 'nombre' = 'Paciente' limit 1;
      if v_pel is not null and not coalesce((v_pel ->> 'bloqueado')::boolean, true)
         and coalesce((v_pel ->> 'g')::numeric, -1) >= 25
         and (p #>> '{foto,ejecutable20,tasa}') is not null
         and (p #>> '{foto,ejecutable20,tasa}')::numeric
             >= (v_pel ->> 'tasa')::numeric - 5 then
        v_pel_nombre := 'Paciente';
      else
        v_pel := null;
        select e into v_pel from jsonb_array_elements(
          coalesce(p #> '{foto,menu,peldanos}', '[]'::jsonb)) e
         where e ->> 'nombre' = 'Equilibrado' limit 1;
        v_pel_nombre := 'Equilibrado';
        if v_pel is null or coalesce((v_pel ->> 'bloqueado')::boolean, true) then
          select e into v_pel from jsonb_array_elements(
            coalesce(p #> '{foto,menu,peldanos}', '[]'::jsonb)) e
           where e ->> 'nombre' = 'Inmediato' limit 1;
          v_pel_nombre := 'Inmediato';
        end if;
      end if;
    end if;
    if v_pel is null or coalesce((v_pel ->> 'bloqueado')::boolean, true)
       or (v_pel ->> 'tasa') is null then
      v_motivos := array_append(v_motivos, 'sin_peldano');
    else
      v_tasa := (v_pel ->> 'tasa')::numeric;
      v_g := (v_pel ->> 'g')::numeric;
      if v_vendible / v_tasa < 10 then
        v_motivos := array_append(v_motivos, 'vendible_bajo');
      else
        v_monto := least(
          coalesce((p #>> '{puerta,tope_oferta}')::numeric, 40),
          floor(v_vendible / v_tasa),
          floor(120 - coalesce((p #>> '{puerta,monto_hoy}')::numeric, 0)));
        -- DEMANDA: el monto se topa además por lo que absorbe la
        -- BANDA donde cae la tasa del peldaño (salida de la banda ×
        -- ventana); sin bandas (legado), por lo que absorbe la cima.
        -- Solo con medición fresca y señal presente (usable=true);
        -- vieja o ausente ya vino declarada y NO topa nada. Banda
        -- sin absorción medida = CERO: frena con el mismo rigor que
        -- la cima muerta de antes — ni más laxo ni por atrás.
        if v_dem_ok and v_dem_modo_banda then
          v_dem_banda := floor(v_tasa / v_dem_banda_tasa) * v_dem_banda_tasa;
          select (b ->> 'salida_usd_h')::numeric,
                 (b ->> 'vida_min')::numeric
            into v_dem_salida_banda, v_dem_vida_banda
            from jsonb_array_elements(
              coalesce(p #> '{demanda,bandas}', '[]'::jsonb)) b
           where b ->> 'lado' = 'venta'
             and (b ->> 'banda')::numeric = v_dem_banda
           limit 1;
          v_dem_salida_banda := coalesce(v_dem_salida_banda, 0);
          v_dem_tope := v_dem_salida_banda
            * (coalesce(v_dem_vent_min, 120) / 60.0);
        end if;
        if v_dem_ok and v_dem_tope is not null
           and floor(v_dem_tope) < v_monto then
          v_dem_topado := true;
          v_monto := greatest(floor(v_dem_tope), 0);
        end if;
        if v_monto < 10 then
          v_motivos := array_append(v_motivos,
            case when v_dem_topado and v_dem_tope <= 0
                   then case when v_dem_modo_banda
                          then 'demanda_sin_absorcion_en_tu_zona'
                          else 'demanda_sin_absorcion' end
                 when v_dem_topado then 'monto_topado_demanda'
                 else 'monto_bajo' end);
        else
          v_receive := round(v_monto * v_tasa, 2);
          -- FIFO: consume los lotes en orden hasta v_receive; el resto
          -- sale del saldo sin lote (sin ganancia atribuida, R honestidad).
          v_queda := v_receive;
          for v_item in
            select l from jsonb_array_elements(
              coalesce(p #> '{posicion,lotes}', '[]'::jsonb)) l
          loop
            exit when v_queda <= 0;
            v_toma := least((v_item ->> 'cantidad')::numeric, v_queda);
            if v_toma > 0 then
              v_costo_fifo := v_costo_fifo + round(
                (v_item ->> 'costo')::numeric * v_toma
                / nullif((v_item ->> 'cantidad')::numeric, 0), 2);
              v_con_lote := v_con_lote + v_toma;
              v_desglose := v_desglose || jsonb_build_object(
                'cantidad', v_toma,
                'costo', round((v_item ->> 'costo')::numeric * v_toma
                  / nullif((v_item ->> 'cantidad')::numeric, 0), 2));
              v_queda := v_queda - v_toma;
            end if;
          end loop;
          -- el tramo sin lote se valora POR LO BAJO (floor a CUP
          -- entero): su costo es desconocido y la ganancia FIFO que
          -- se le enseña a Ernesto jamás se infla por redondeo.
          v_pro_sin := case when v_queda > 0 and v_tasa > 0
            then floor(v_queda / v_tasa * v_salida) else 0 end;
          v_gan_fifo := round(v_monto * v_salida - v_pro_sin - v_costo_fifo, 0);
          v_gan_dia := case when v_g is null then null
            else round(v_receive / 360 * v_g, 0) end;
          if not (v_gan_fifo >= v_mat_fifo
                  or (coalesce(v_g, -1) >= 25 and v_monto >= 20)) then
            v_motivos := array_append(v_motivos, 'no_material');
          else
            v_porques := jsonb_build_array(
              case when (p #>> '{foto,ejecutable20,tasa}') is not null then
                'El libro de compra junta ' ||
                (p #>> '{foto,ejecutable20,usd}') || ' USD ejecutables a ' ||
                (p #>> '{foto,ejecutable20,tasa}') || ' saldo por QUSD.'
              else
                'El peldaño ' || v_pel_nombre || ' tiene ' ||
                coalesce(v_pel ->> 'delanteUsd', '0') ||
                ' USD por delante en el libro de venta.' end,
              'Tu ganancia a esta tasa es +' ||
                replace(v_g::text, '.', ',') ||
                ' CUP por recarga de 360 (zona ' ||
                coalesce(v_pel ->> 'zona', '—') || ').',
              case when (p #>> '{posicion,mejor_nivel20_hoy}') is not null
                        and v_tasa >= (p #>> '{posicion,mejor_nivel20_hoy}')::numeric
                then 'Es la mejor tasa del día según el historial de fotos.'
                when (p #>> '{posicion,linea_en}') is not null then
                  'Tu saldo está en línea desde las ' ||
                  to_char((p #>> '{posicion,linea_en}')::timestamptz
                    at time zone 'America/Havana', 'HH12:MI AM') || '.'
                else 'El peldaño ' || v_pel_nombre ||
                     ' es el que mejor combina ganancia y salida.' end);
            if v_dem_ok and v_dem_modo_banda then
              v_porques := v_porques || jsonb_build_array(
                'Demanda ' || coalesce(p #>> '{demanda,termometro}', '—')
                || ': la zona de tu oferta a '
                || trim_scale(round(v_tasa, 2))::text
                || ' (banda ' || trim_scale(v_dem_banda)::text || '–'
                || trim_scale(v_dem_banda + v_dem_banda_tasa)::text
                || ') se comió '
                || trim_scale(round(v_dem_salida_banda, 2))::text
                || ' USD/h'
                || case when v_dem_vida_banda is not null
                     then ' y lleva '
                       || trim_scale(round(v_dem_vida_banda, 0))::text
                       || ' min en pie'
                     else '' end
                || '.'
                || case when v_dem_topado
                     then ' Tu monto se topó a lo que tu zona absorbe en la ventana ('
                       || trim_scale(round(v_dem_tope, 2))::text || ' USD).'
                     else '' end);
            elsif v_dem_ok then
              v_porques := v_porques || jsonb_build_array(
                'Demanda ' || coalesce(p #>> '{demanda,termometro}', '—')
                || ': la cima del libro sale a '
                || trim_scale(round(
                     (p #>> '{demanda,salida_cima_usd_h}')::numeric, 2))::text
                || ' USD/h y lleva '
                || trim_scale(round(
                     (p #>> '{demanda,vida_cima_min}')::numeric, 0))::text
                || ' min en pie.'
                || case when v_dem_topado
                     then ' Tu monto se topó a lo que la cima absorbe en la ventana ('
                       || trim_scale(round(v_dem_tope, 2))::text || ' USD).'
                     else '' end);
            end if;
            if coalesce((p #>> '{promo_puesto,activa}')::boolean, false)
               and (p #>> '{promo_puesto,ref_cierre}') is not null
               and abs(v_tasa - (p #>> '{promo_puesto,ref_cierre}')::numeric)
                   / (p #>> '{promo_puesto,ref_cierre}')::numeric > 0.05 then
              v_aviso_promo := 'OJO: esta tasa sale de la banda del 5 % de '
                || 'tu puesto promocionado (referencia '
                || (p #>> '{promo_puesto,ref_cierre}') || '): puede costarte el puesto.';
            end if;
            v_prep := jsonb_build_object(
              'tasa', v_tasa, 'peldano', v_pel_nombre,
              'monto_qusd', v_monto, 'receive', v_receive,
              'ganancia360', v_g,
              'ganancia_fifo', v_gan_fifo, 'ganancia_costo_dia', v_gan_dia,
              'fifo', jsonb_build_object(
                'con_lote', v_con_lote, 'costo_fifo', v_costo_fifo,
                'sin_lote', v_queda, 'proceeds_sin_lote', v_pro_sin,
                'desglose', v_desglose),
              'porques', v_porques, 'aviso_promo', v_aviso_promo,
              'demanda', jsonb_build_object(
                'declaracion', v_dem_decl, 'aplicada', v_dem_ok,
                'modo', case when not v_dem_ok then null
                             when v_dem_modo_banda then 'banda'
                             else 'cima' end,
                'termometro', p #>> '{demanda,termometro}',
                'salida_cima_usd_h',
                  (p #>> '{demanda,salida_cima_usd_h}')::numeric,
                'vida_cima_min', (p #>> '{demanda,vida_cima_min}')::numeric,
                'banda', v_dem_banda,
                'salida_banda_usd_h', v_dem_salida_banda,
                'vida_banda_min', v_dem_vida_banda,
                'tope_usd', v_dem_tope, 'topado', v_dem_topado));
          end if;
        end if;
      end if;
    end if;
  end if;

  -- ---------- consejo de compra con el fondo (honesto, §5.3) ----------
  v_margen_calle := case when (p #>> '{tarifa,ingreso_ref360}') is null
                           or v_costo is null then null
    else (p #>> '{tarifa,ingreso_ref360}')::numeric - v_costo end;
  v_compra := jsonb_build_object(
    'posible', (v_fondo_tras > 0 and coalesce(v_margen_calle, -1) > 0),
    'fondo_tras_reserva', v_fondo_tras,
    'margen_por_recarga', v_margen_calle,
    'motivo', case
      when v_fondo_tras <= 0 then 'reserva_cupos'
      when coalesce(v_margen_calle, -1) <= 0 then 'sin_margen'
      else null end);

  return jsonb_build_object(
    'senal', v_senal,
    'equilibrio', v_eq,
    'posicion', jsonb_build_object(
      'linea_saldo', v_linea, 'linea_en', p #>> '{posicion,linea_en}',
      'lotes_saldo', v_lotes_tot, 'lotes_costo', v_lotes_costo,
      'sin_lote', v_sin_lote, 'descuadre', v_descuadre,
      'comprometido_saldo', v_comp,
      'colchon', v_colchon, 'vendible', v_vendible,
      'qUSD', (p #>> '{posicion,qUSD}')::numeric,
      'fondo', (p #>> '{posicion,fondo}')::numeric,
      'reserva_cupos', (p #>> '{posicion,reserva_cupos}')::numeric,
      'fondo_tras_reserva', v_fondo_tras),
    'preparada', v_prep,
    'demanda', jsonb_build_object(
      'declaracion', v_dem_decl, 'aplicada', v_dem_ok,
      'modo', case when not v_dem_ok then null
                   when v_dem_modo_banda then 'banda'
                   else 'cima' end,
      'banda', v_dem_banda,
      'salida_banda_usd_h', v_dem_salida_banda,
      'vida_banda_min', v_dem_vida_banda,
      'tope_usd', v_dem_tope, 'topado', v_dem_topado),
    'motivos_no_prepara', to_jsonb(v_motivos),
    'compra_fondo', v_compra,
    'transferencia', p #> '{foto,transferencia}');
end;
$function$;

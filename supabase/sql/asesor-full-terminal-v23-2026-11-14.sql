-- =====================================================================
-- ASESOR A FULL + PUERTA DE LA TERMINAL — Mi Negocio v23 (2026-11-14)
-- Frente A (SQL/Supabase). Idempotente: aplicable dos veces sin romper.
-- NO toca guia_subir, guia_calc_asesor, guia_asesor_interno ni
-- guia_preparar_interna (solo se llaman). No mueve dinero.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) MEMORIA DE RESULTADOS DEL ASESOR
-- ---------------------------------------------------------------------
create table if not exists public.guia_memoria (
  id            uuid primary key default gen_random_uuid(),
  creada_en     timestamptz not null default now(),
  clase         text not null check (clase in ('candidata','sugerencia')),
  accion_id     uuid,
  foto_id       uuid,
  peldano       text,
  tasa          numeric,
  monto_qusd    numeric,
  explicacion   text,
  snapshot      jsonb,
  estado        text not null default 'sugerida'
                check (estado in ('candidata','sugerida','subida',
                                  'llenada','no_llenada','descartada')),
  resuelta_en   timestamptz,
  minutos_llenado numeric,
  es_prueba     boolean not null default false
);
alter table public.guia_memoria enable row level security;
-- Sin políticas pa anon: solo funciones SECURITY DEFINER y el dueño.
create index if not exists guia_memoria_estado_idx
  on public.guia_memoria (estado);
create index if not exists guia_memoria_accion_idx
  on public.guia_memoria (accion_id);

-- ---------------------------------------------------------------------
-- 2) ESTADÍSTICAS DE LA MEMORIA
-- 'llenada'    = sugerencia subida cuya oferta terminó en venta
--                registrada (enlazada en guia_preparar_full).
-- 'no_llenada' = subida que terminó en error/vencida/descartada sin
--                venta, o sugerencia vencida sin subir tras 24 h.
-- ---------------------------------------------------------------------
create or replace function public.guia_memoria_stats(p_prueba boolean default false)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_ll int; v_no int; v_res int;
begin
  select count(*) filter (where estado = 'llenada'),
         count(*) filter (where estado = 'no_llenada')
    into v_ll, v_no
    from public.guia_memoria
   where clase = 'sugerencia' and es_prueba = coalesce(p_prueba, false);
  v_res := coalesce(v_ll, 0) + coalesce(v_no, 0);
  return jsonb_build_object(
    'resueltas', v_res,
    'llenadas', coalesce(v_ll, 0),
    'no_llenadas', coalesce(v_no, 0),
    'acierto_pct', case when v_res > 0
      then round(coalesce(v_ll, 0)::numeric / v_res * 100, 1) end,
    'ultimas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'creada_en', creada_en, 'peldano', peldano,
               'tasa', tasa, 'estado', estado,
               'minutos_llenado', minutos_llenado)
             order by creada_en desc)
        from (select * from public.guia_memoria
               where clase = 'sugerencia'
                 and es_prueba = coalesce(p_prueba, false)
               order by creada_en desc limit 8) u), '[]'::jsonb));
end;
$function$;
revoke all on function public.guia_memoria_stats(boolean) from public;

-- ---------------------------------------------------------------------
-- 3) ESCENARIOS: fuerza cada peldaño real del menú por el MISMO
-- cálculo puro (guia_calc_asesor) con un contexto forzado: menú de un
-- solo peldaño renombrado 'Equilibrado' (la rama que calc elige con
-- señal APROVECHAR), señal APROVECHAR, dura de compra y sin preparada
-- viva. Uso interno: sin grant a anon.
-- ---------------------------------------------------------------------
create or replace function public.guia_escenarios_calc(p jsonb)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_out jsonb := '[]'::jsonb;
  v_def record; v_pel jsonb; v_ctx jsonb; v_res jsonb; v_prep jsonb;
begin
  for v_def in
    select * from (values ('rapida','Inmediato'),
                          ('equilibrada','Equilibrado'),
                          ('paciente','Paciente')) as t(clave, nombre)
  loop
    select e into v_pel
      from jsonb_array_elements(
        coalesce(p #> '{foto,menu,peldanos}', '[]'::jsonb)) e
     where e ->> 'nombre' = v_def.nombre limit 1;
    if v_pel is null then
      v_out := v_out || jsonb_build_object(
        'clave', v_def.clave, 'nombre', v_def.nombre,
        'disponible', false, 'motivo', 'sin_peldano', 'porques', '[]'::jsonb);
      continue;
    end if;
    v_ctx := p;
    v_ctx := jsonb_set(v_ctx, '{foto,menu,peldanos}',
      jsonb_build_array(v_pel || jsonb_build_object('nombre', 'Equilibrado')));
    v_ctx := jsonb_set(v_ctx, '{foto,senal}',
      jsonb_build_object('palabra', 'APROVECHAR'));
    v_ctx := jsonb_set(v_ctx, '{foto,duras}',
      jsonb_build_array(jsonb_build_object('lado', 'compra')));
    v_ctx := jsonb_set(v_ctx, '{puerta,preparada_viva}', 'false'::jsonb);
    v_res := public.guia_calc_asesor(v_ctx);
    v_prep := v_res -> 'preparada';
    if v_prep is null or v_prep = 'null'::jsonb then
      v_out := v_out || jsonb_build_object(
        'clave', v_def.clave, 'nombre', v_def.nombre,
        'disponible', false,
        'motivo', coalesce(v_res #>> '{motivos_no_prepara,0}', 'sin_preparada'),
        'porques', '[]'::jsonb);
    else
      v_out := v_out || jsonb_build_object(
        'clave', v_def.clave, 'nombre', v_def.nombre,
        'disponible', true,
        'tasa', (v_prep ->> 'tasa')::numeric,
        'monto_qusd', (v_prep ->> 'monto_qusd')::numeric,
        'receive', (v_prep ->> 'receive')::numeric,
        'ganancia360', (v_prep ->> 'ganancia360')::numeric,
        'ganancia_fifo', (v_prep ->> 'ganancia_fifo')::numeric,
        'motivo', null,
        'porques', coalesce(v_prep -> 'porques', '[]'::jsonb));
    end if;
  end loop;
  return v_out;
end;
$function$;
revoke all on function public.guia_escenarios_calc(jsonb) from public;

-- ---------------------------------------------------------------------
-- 4) CICLO COMPLETO DEL ASESOR (sustituye al cron jobid 12):
-- cierra resultados de la memoria, respeta preparacion_activa y
-- aplica la REGLA DE DOS LECTURAS pa cambiar un consejo vivo.
-- ---------------------------------------------------------------------
create or replace function public.guia_preparar_full(p_forzar boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cfg record;
  v_m record; v_a record; v_venta record;
  v_cerr_llen int := 0; v_cerr_no int := 0; v_marc_sub int := 0;
  v_tmp int := 0;
  v_int jsonb; v_cand jsonb; v_res_int jsonb; v_nueva_id uuid;
  v_activa record; v_candidata record; v_prep_viva boolean;
begin
  perform pg_advisory_xact_lock(hashtext('guia_preparar_full'));

  -- (a) CIERRE DE RESULTADOS -------------------------------------------
  for v_m in
    select * from public.guia_memoria
     where clase = 'sugerencia' and es_prueba = false
       and accion_id is not null and estado in ('sugerida','subida')
  loop
    select * into v_a from public.mercado_acciones where id = v_m.accion_id;
    if v_a.id is null then continue; end if;
    if v_a.estado = 'ejecutada' then
      -- ¿terminó en venta registrada? venta posterior a la acción,
      -- dentro de 12 h, tasa ejecutada a ≤1,5 % de la de la acción y
      -- no enlazada ya a otra memoria.
      select * into v_venta from public.pago_ventas_saldo v
       where v.es_prueba = false
         and v.creada_en >= v_a.creada_en
         and v.creada_en <= v_a.creada_en + interval '12 hours'
         and v_a.tasa > 0
         and abs(v.tasa_ejecutada - v_a.tasa) / v_a.tasa <= 0.015
         and not exists (
           select 1 from public.guia_memoria m2
            where m2.id <> v_m.id and m2.estado = 'llenada'
              and (m2.snapshot ->> 'venta_id') = v.id::text)
       order by v.creada_en limit 1;
      if v_venta.id is not null then
        update public.guia_memoria
           set estado = 'llenada', resuelta_en = now(),
               minutos_llenado = round(
                 (extract(epoch from (v_venta.creada_en - v_a.creada_en))
                  / 60.0)::numeric, 1),
               snapshot = coalesce(snapshot, '{}'::jsonb)
                 || jsonb_build_object('venta_id', v_venta.id)
         where id = v_m.id;
        v_cerr_llen := v_cerr_llen + 1;
      elsif v_m.estado <> 'subida' then
        update public.guia_memoria set estado = 'subida' where id = v_m.id;
        v_marc_sub := v_marc_sub + 1;
      end if;
    elsif v_a.estado not in ('preparada','ejecutando','pendiente') then
      update public.guia_memoria
         set estado = 'no_llenada', resuelta_en = now(),
             snapshot = coalesce(snapshot, '{}'::jsonb)
               || jsonb_build_object('accion_estado', v_a.estado,
                                     'causa_accion', v_a.detalle)
       where id = v_m.id;
      v_cerr_no := v_cerr_no + 1;
    end if;
  end loop;
  -- sugerencias sin acción con más de 24 h: vencidas sin subir
  update public.guia_memoria
     set estado = 'no_llenada', resuelta_en = now(),
         snapshot = coalesce(snapshot, '{}'::jsonb)
           || jsonb_build_object('causa', 'vencida_sin_subir_24h')
   where clase = 'sugerencia' and es_prueba = false
     and accion_id is null and estado in ('sugerida','subida')
     and creada_en < now() - interval '24 hours';
  get diagnostics v_tmp = row_count;
  v_cerr_no := v_cerr_no + v_tmp;

  -- (c) preparacion_activa manda (el cierre ya se hizo igual) ---------
  select * into v_cfg from public.guia_config where id = 1;
  if not coalesce(v_cfg.preparacion_activa, false) and not p_forzar then
    return jsonb_build_object('ok', true, 'motivo', 'preparacion_inactiva',
      'cierre', jsonb_build_object('llenadas', v_cerr_llen,
        'no_llenadas', v_cerr_no, 'marcadas_subida', v_marc_sub),
      'preparada', null);
  end if;

  -- (b) REGLA DE DOS LECTURAS ------------------------------------------
  v_int := public.guia_asesor_interno(false);
  v_cand := v_int #> '{calculo,preparada}';
  if v_cand is null or v_cand = 'null'::jsonb then
    return jsonb_build_object('ok', true, 'preparada', null,
      'motivos', v_int #> '{calculo,motivos_no_prepara}',
      'cierre', jsonb_build_object('llenadas', v_cerr_llen,
        'no_llenadas', v_cerr_no, 'marcadas_subida', v_marc_sub));
  end if;
  v_prep_viva := (v_int -> 'preparada_viva') is not null
                 and (v_int -> 'preparada_viva') <> 'null'::jsonb;
  select * into v_activa from public.guia_memoria
   where clase = 'sugerencia' and es_prueba = false
     and estado in ('sugerida','subida') and resuelta_en is null
   order by creada_en desc limit 1;

  if v_activa.id is null and not v_prep_viva then
    -- sin consejo activo: nace la sugerencia del ciclo
    v_res_int := public.guia_preparar_interna(p_forzar);
    v_nueva_id := (v_res_int #>> '{preparada,id}')::uuid;
    if v_nueva_id is not null then
      insert into public.guia_memoria
        (clase, accion_id, foto_id, peldano, tasa, monto_qusd,
         explicacion, snapshot, estado, es_prueba)
      values
        ('sugerencia', v_nueva_id, (v_int #>> '{foto,id}')::uuid,
         v_cand ->> 'peldano', (v_cand ->> 'tasa')::numeric,
         (v_cand ->> 'monto_qusd')::numeric,
         coalesce(v_cand #>> '{porques,0}', v_cand ->> 'porques'),
         jsonb_build_object('foto_id', (v_int #>> '{foto,id}')::uuid,
           'peldano', v_cand ->> 'peldano',
           'demanda', v_cand -> 'demanda'),
         'sugerida', false);
      return jsonb_build_object('ok', true, 'accion', 'sugerencia_nueva',
        'preparada', v_res_int -> 'preparada',
        'cierre', jsonb_build_object('llenadas', v_cerr_llen,
          'no_llenadas', v_cerr_no, 'marcadas_subida', v_marc_sub));
    end if;
    return jsonb_build_object('ok', true, 'accion', 'interna_sin_preparada',
      'interna', v_res_int,
      'cierre', jsonb_build_object('llenadas', v_cerr_llen,
        'no_llenadas', v_cerr_no, 'marcadas_subida', v_marc_sub));
  end if;

  if v_activa.id is not null
     and v_activa.peldano is not distinct from (v_cand ->> 'peldano')
     and v_activa.tasa is not null
     and abs((v_cand ->> 'tasa')::numeric - v_activa.tasa) <= 0.5 then
    return jsonb_build_object('ok', true, 'accion', 'sin_cambio',
      'sugerencia_viva_id', v_activa.id,
      'preparada', jsonb_build_object('tasa', v_activa.tasa,
        'peldano', v_activa.peldano),
      'cierre', jsonb_build_object('llenadas', v_cerr_llen,
        'no_llenadas', v_cerr_no, 'marcadas_subida', v_marc_sub));
  end if;

  -- el candidato DIFIERE del consejo vivo → candidata
  select * into v_candidata from public.guia_memoria
   where clase = 'candidata' and estado = 'candidata' and es_prueba = false
   order by creada_en desc limit 1;

  if v_candidata.id is not null
     and v_candidata.peldano is not distinct from (v_cand ->> 'peldano')
     and v_candidata.tasa is not null
     and abs((v_cand ->> 'tasa')::numeric - v_candidata.tasa) <= 0.5 then
    if v_candidata.creada_en >= now() - interval '10 minutes' then
      return jsonb_build_object('ok', true,
        'accion', 'candidata_confirmandose',
        'candidata_id', v_candidata.id,
        'nota', 'Segunda lectura aún dentro de la ventana de 10 min: '
                'se espera al próximo ciclo pa promover.');
    end if;
    -- segunda lectura confirmada (otro ciclo, >10 min después)
    if v_prep_viva then
      return jsonb_build_object('ok', true, 'accion', 'promocion_en_espera',
        'candidata_id', v_candidata.id,
        'motivo', 'preparada_vieja_viva',
        'nota', 'La candidata se repitió en dos ciclos, pero la '
                'preparada vieja sigue viva: la promoción espera a '
                'que venza (10 min) sin forzar nada.');
    end if;
    v_res_int := public.guia_preparar_interna(p_forzar);
    v_nueva_id := (v_res_int #>> '{preparada,id}')::uuid;
    if v_nueva_id is null then
      return jsonb_build_object('ok', true, 'accion', 'promocion_sin_nacer',
        'candidata_id', v_candidata.id, 'interna', v_res_int);
    end if;
    update public.guia_memoria
       set clase = 'sugerencia', estado = 'sugerida',
           accion_id = v_nueva_id,
           foto_id = (v_int #>> '{foto,id}')::uuid,
           peldano = v_cand ->> 'peldano',
           tasa = (v_cand ->> 'tasa')::numeric,
           monto_qusd = (v_cand ->> 'monto_qusd')::numeric,
           explicacion = coalesce(v_cand #>> '{porques,0}',
                                  v_cand ->> 'porques'),
           snapshot = coalesce(snapshot, '{}'::jsonb)
             || jsonb_build_object('promovida_en', now(),
                  'foto_id', (v_int #>> '{foto,id}')::uuid,
                  'demanda', v_cand -> 'demanda')
     where id = v_candidata.id;
    return jsonb_build_object('ok', true, 'accion', 'candidata_promovida',
      'sugerencia_id', v_candidata.id,
      'preparada', v_res_int -> 'preparada',
      'cierre', jsonb_build_object('llenadas', v_cerr_llen,
        'no_llenadas', v_cerr_no, 'marcadas_subida', v_marc_sub));
  end if;

  -- candidata nueva (o reemplazo de una distinta): una sola viva
  if v_candidata.id is not null then
    update public.guia_memoria
       set estado = 'descartada',
           snapshot = coalesce(snapshot, '{}'::jsonb)
             || jsonb_build_object('reemplazada_en', now())
     where id = v_candidata.id;
  end if;
  insert into public.guia_memoria
    (clase, foto_id, peldano, tasa, monto_qusd, explicacion, snapshot,
     estado, es_prueba)
  values
    ('candidata', (v_int #>> '{foto,id}')::uuid,
     v_cand ->> 'peldano', (v_cand ->> 'tasa')::numeric,
     (v_cand ->> 'monto_qusd')::numeric,
     coalesce(v_cand #>> '{porques,0}', v_cand ->> 'porques'),
     jsonb_build_object('foto_id', (v_int #>> '{foto,id}')::uuid,
       'peldano', v_cand ->> 'peldano', 'demanda', v_cand -> 'demanda',
       'sugerencia_viva_id', v_activa.id),
     'candidata', false)
  returning id into v_nueva_id;
  return jsonb_build_object('ok', true, 'accion', 'candidata_registrada',
    'candidata_id', v_nueva_id, 'lecturas', 1,
    'nota', 'El consejo nuevo difiere del vivo: queda como candidata '
            'y solo se promueve si se repite en el próximo ciclo.',
    'cierre', jsonb_build_object('llenadas', v_cerr_llen,
      'no_llenadas', v_cerr_no, 'marcadas_subida', v_marc_sub));
end;
$function$;
revoke all on function public.guia_preparar_full(boolean) from public;

-- El cron del asesor (jobid 12) pasa a llamar al ciclo completo.
-- (vía cron.alter_job: el rol de la Management API no tiene UPDATE
-- directo sobre cron.job — verificado el 2026-11-14.)
select cron.alter_job(12,
  command := 'select public.guia_preparar_full(false)');

-- ---------------------------------------------------------------------
-- 5) PUERTA DE LA TERMINAL (contrato ESTADO.md): una sola llamada
-- admin con foto, series, libro, tarifa, equilibrio, posición,
-- ventas, demanda, escenarios, memoria y promo.
-- ---------------------------------------------------------------------
create or replace function public.guia_terminal(
  p_codigo text, p_prueba boolean default false)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  -- espejo de guia_asesor_interno pa armar el contexto de escenarios
  v_cfg record; v_foto record; v_tar record; v_mc record;
  v_linea numeric; v_linea_en timestamptz;
  v_lotes jsonb; v_fondo numeric; v_reserva numeric := 0;
  v_inicio timestamptz := ((now() at time zone 'America/Havana')::date)::timestamp
                           at time zone 'America/Havana';
  v_monto_hoy numeric; v_hora integer; v_prev record;
  v_sil timestamptz;
  v_habana_hoy date := (now() at time zone 'America/Havana')::date;
  v_vig jsonb;
  v_plant record; v_base_viva boolean; v_base boolean; v_base_fuente text;
  v_dem record; v_dem_vent_min int; v_dem_edad_min numeric;
  v_dem_ausente boolean; v_dem_usable boolean; v_dem_decl text;
  v_dem_tope numeric; v_dem_banda_tasa numeric;
  v_promo jsonb; v_bandas_hist jsonb;
  v_int jsonb; v_p jsonb;
  v_eq numeric; v_edad_min numeric; v_costo_vivo numeric;
begin
  if not public.admin_es_valido(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'no_admin');
  end if;

  v_int := public.guia_asesor_interno(p_prueba);

  select * into v_cfg from public.guia_config where id = 1;
  select * into v_tar from public.tarifa where id = 1;
  select * into v_mc from public.mercado_config where id = 1;
  select * into v_foto from public.mercado_fotos
   order by recibida_en desc limit 1;
  v_vig := public.mercado_foto_vigente();
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
  v_base_fuente := case when v_base_viva then 'oferta_viva'
                        when v_base then 'plantilla' else null end;

  select * into v_dem from public.demanda_mediciones
   where moneda = 'ETECSA' order by medida_en desc limit 1;
  select ventana_absorcion_min, banda_tasa
    into v_dem_vent_min, v_dem_banda_tasa
    from public.demanda_config where id = 1;
  v_dem_edad_min := case when v_dem.id is null then null
    else extract(epoch from (now() - v_dem.medida_en)) / 60.0 end;
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

  v_promo := public.guia_promo_estado(jsonb_build_object(
    'hoy', v_habana_hoy,
    'puja_cierre', v_cfg.promo_puja_cierre,
    'desde', v_cfg.puesto_desde, 'hasta', v_cfg.puesto_hasta,
    'resultado', v_cfg.promo_resultado,
    'ofertas_abiertas',
      (v_foto.detalle #>> '{propias,ofertas_abiertas}')::int,
    'propias_legible',
      (v_foto.detalle #>> '{propias,legible}')::boolean));
  select coalesce(jsonb_object_agg(banda_txt, obj), '{}'::jsonb)
    into v_bandas_hist
    from (select (b ->> 'banda') as banda_txt,
            jsonb_build_object(
              'mediana', percentile_cont(0.5) within group
                (order by (b ->> 'salida_usd_h')::numeric),
              'n', count(*)) as obj
           from public.demanda_mediciones m,
                jsonb_array_elements(coalesce(m.bandas, '[]'::jsonb)) b
          where m.moneda = 'ETECSA'
            and m.medida_en > now() - interval '24 hours'
            and b ->> 'lado' = 'venta'
            and (b ->> 'salida_usd_h') is not null
          group by (b ->> 'banda')) s;

  select saldo_principal_cup, recibido_en into v_linea, v_linea_en
    from public.sms_linea
   where saldo_principal_cup is not null
   order by id desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
           'cantidad', cantidad_restante, 'costo', costo_restante_cup,
           'costo_por_recarga', costo_por_recarga,
           'semaforo_compra', semaforo_compra,
           'margen_recarga_nacer', margen_recarga_nacer)
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

  -- contexto EXACTO al que arma guia_asesor_interno pa su cálculo
  v_p := jsonb_build_object(
    'ahora', now(),
    'foto', jsonb_build_object(
      'usable', (v_foto.id is not null and v_foto.libro_ok and v_foto.fresca
        and v_foto.recibida_en > now() - interval '20 minutes'),
      'id', v_foto.id, 'recibida_en', v_foto.recibida_en,
      'nivel20', coalesce((v_vig ->> 'nivel20')::numeric, v_foto.etecsa_nivel20),
      'top_venta', coalesce((v_vig ->> 'top_venta')::numeric, v_foto.etecsa_top_venta),
      'nivel20_edad_s', (v_vig ->> 'nivel20_edad_s')::numeric,
      'ligera', v_vig -> 'ligera',
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
      'colchon', v_cfg.colchon_saldo,
      'peaje_envio', v_cfg.peaje_envio_saldo,
      'tope_receptor_envio', v_cfg.tope_receptor_envio,
      'mat_fifo', v_cfg.mat_asesor_fifo),
    'demanda', jsonb_build_object(
      'usable', v_dem_usable, 'declaracion', v_dem_decl,
      'termometro', v_dem.termometro,
      'salida_cima_usd_h', v_dem.salida_cima_usd_h,
      'vida_cima_min', v_dem.vida_cima_min,
      'medida_en', v_dem.medida_en,
      'tope_usd', v_dem_tope,
      'bandas', coalesce(v_dem.bandas, '[]'::jsonb),
      'bandas_hist', coalesce(v_bandas_hist, '{}'::jsonb),
      'banda_tasa', v_dem_banda_tasa,
      'ventana_min', v_dem_vent_min),
    'silencio_hasta', v_sil,
    'promo_puesto', jsonb_build_object(
      'activa', coalesce((v_promo ->> 'activa')::boolean, false),
      'fase', v_promo ->> 'fase',
      'declaracion', v_promo ->> 'declaracion',
      'banda_pct', v_cfg.promo_banda_pct,
      'ref_cierre', v_foto.etecsa_promedio_venta));

  v_eq := case when v_tar.salida_ref is null or v_mc.costo_ref360 is null
                 or v_mc.costo_ref360 = 0 then null
               else round(360 * v_tar.salida_ref / v_mc.costo_ref360, 2) end;
  v_edad_min := case when v_foto.id is null then null
    else round((extract(epoch from (now() - v_foto.recibida_en))
                / 60.0)::numeric, 1) end;
  select case when sum(cantidad_restante) > 0
    then round(sum(costo_por_recarga * cantidad_restante)
               / sum(cantidad_restante), 2) end
    into v_costo_vivo
    from public.dinero_lotes_saldo
   where es_prueba = p_prueba and cantidad_restante > 0;

  return jsonb_build_object(
    'ok', true,
    'foto', case when v_foto.id is null then null else jsonb_build_object(
      'recibida_en', v_foto.recibida_en,
      'edad_min', v_edad_min,
      'usable', (v_foto.libro_ok and v_foto.fresca
        and v_foto.recibida_en > now() - interval '20 minutes'),
      'top_venta', coalesce((v_vig ->> 'top_venta')::numeric,
                            v_foto.etecsa_top_venta),
      'top_compra', coalesce((v_vig ->> 'top_compra')::numeric,
                             v_foto.etecsa_top_compra),
      'nivel20', coalesce((v_vig ->> 'nivel20')::numeric,
                          v_foto.etecsa_nivel20),
      'promedio_venta', v_foto.etecsa_promedio_venta) end,
    'serie_etecsa', coalesce((
      select jsonb_agg(f order by f ->> 't')
        from (select jsonb_build_object(
                't', recibida_en, 'pv', etecsa_promedio_venta,
                'pc', etecsa_promedio_compra, 'tv', etecsa_top_venta,
                'tc', etecsa_top_compra, 'n20', etecsa_nivel20,
                'cs', etecsa_count_sell, 'cb', etecsa_count_buy) as f
               from (select * from public.mercado_fotos
                      order by recibida_en desc limit 192) u) s),
      '[]'::jsonb),
    'serie_bankcup', coalesce((
      select jsonb_agg(f order by f ->> 't')
        from (select jsonb_build_object(
                't', recibida_en, 'pv', bankcup_promedio,
                'pc', null, 'tv', null, 'tc', null, 'n20', null,
                'cs', null, 'cb', bankcup_count_buy) as f
               from (select * from public.mercado_fotos
                      order by recibida_en desc limit 192) u) s),
      '[]'::jsonb),
    'libro', jsonb_build_object(
      'escalera_venta', v_foto.detalle -> 'escalera_venta',
      'escalera_compra', v_foto.detalle -> 'escalera_compra'),
    'tarifa', jsonb_build_object(
      'salida_ref', v_tar.salida_ref,
      'costo_ref360', v_mc.costo_ref360,
      'ingreso_ref360', v_tar.ingreso_ref360),
    'equilibrio', v_eq,
    'posicion', jsonb_build_object(
      'linea_saldo', v_linea,
      'costo_vivo_360', v_costo_vivo,
      'lotes', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'cantidad', cantidad_restante,
                 'costo_por_recarga', costo_por_recarga)
               order by creado_en)
          from public.dinero_lotes_saldo
         where es_prueba = p_prueba and cantidad_restante > 0),
        '[]'::jsonb)),
    'ventas', coalesce((
      select jsonb_agg(f order by f ->> 't' desc)
        from (select jsonb_build_object(
                't', creada_en, 'tasa', tasa_ejecutada,
                'saldo', saldo_vendido, 'qusd', qusd_recibidos) as f
               from public.pago_ventas_saldo
              where es_prueba = p_prueba
              order by creada_en desc limit 30) u), '[]'::jsonb),
    'demanda', case when v_dem.id is null then null else jsonb_build_object(
      'termometro', v_dem.termometro,
      'ops_realizadas', v_dem.ops_realizadas,
      'medida_en', v_dem.medida_en,
      'declaracion', v_dem_decl) end,
    'escenarios', public.guia_escenarios_calc(v_p),
    'memoria', public.guia_memoria_stats(p_prueba),
    'promo', coalesce(v_int -> 'promo', '{}'::jsonb));
end;
$function$;
revoke all on function public.guia_terminal(text, boolean) from public;
grant execute on function public.guia_terminal(text, boolean) to anon;

-- ---------------------------------------------------------------------
-- 6) ALERTAS DEL TERMINAL (Avisos PRO): cruce de equilibrio y cima
-- que se mueve ≥3 %. Envío por el MISMO mecanismo del sistema:
-- avisos_log (clave dedupe, canal 'despacho', resultado 'encolado')
-- + avisos_emitir_evento('ADMIN', …), el que despacha el cron
-- avisos-despachar-cada-1min (jobid 8).
-- ---------------------------------------------------------------------
create table if not exists public.terminal_alertas_estado (
  id          int primary key,
  top_venta   numeric,
  nivel20     numeric,
  equilibrio  numeric,
  actualizado timestamptz
);
alter table public.terminal_alertas_estado enable row level security;
insert into public.terminal_alertas_estado (id) values (1)
  on conflict (id) do nothing;

create or replace function public.terminal_alertas()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_foto record; v_vig jsonb; v_est record;
  v_tar record; v_mc record;
  v_eq numeric; v_top numeric; v_n20 numeric;
  v_avisos text[] := '{}'; v_clave text; v_titulo text; v_cuerpo text;
begin
  select * into v_foto from public.mercado_fotos
   order by recibida_en desc limit 1;
  if v_foto.id is null or not v_foto.libro_ok or not v_foto.fresca
     or v_foto.recibida_en <= now() - interval '20 minutes' then
    return jsonb_build_object('ok', true, 'avisos', 0,
      'motivo', 'foto_no_fresca');
  end if;
  v_vig := public.mercado_foto_vigente();
  v_top := coalesce((v_vig ->> 'top_venta')::numeric, v_foto.etecsa_top_venta);
  v_n20 := coalesce((v_vig ->> 'nivel20')::numeric, v_foto.etecsa_nivel20);
  select * into v_tar from public.tarifa where id = 1;
  select * into v_mc from public.mercado_config where id = 1;
  v_eq := case when v_tar.salida_ref is null or v_mc.costo_ref360 is null
                 or v_mc.costo_ref360 = 0 then null
               else round(360 * v_tar.salida_ref / v_mc.costo_ref360, 2) end;
  select * into v_est from public.terminal_alertas_estado where id = 1;

  -- (a) cruce de equilibrio: cambia el signo de (top_venta - eq)
  if v_est.equilibrio is not null and v_eq is not null
     and v_est.top_venta is not null and v_top is not null
     and sign(v_top - v_eq)
         <> sign(v_est.top_venta - v_est.equilibrio) then
    v_clave := 'terminal-cruce-equilibrio-'
      || extract(epoch from now())::bigint::text;
    v_titulo := '⚖️ Terminal: cruce de equilibrio';
    v_cuerpo := 'La cima de venta (' || public.avisos_fmt_num(v_top)
      || ') cruzó tu equilibrio del día ('
      || public.avisos_fmt_num(v_eq)
      || '): antes estaba en ' || public.avisos_fmt_num(v_est.top_venta)
      || ' contra un equilibrio de '
      || public.avisos_fmt_num(v_est.equilibrio) || '.';
    insert into public.avisos_log
      (clave, evento_tipo, para, titulo, canal, resultado)
    values (v_clave, 'terminal_cruce_equilibrio', 'ADMIN', v_titulo,
            'despacho', 'encolado')
    on conflict (clave) where canal = 'despacho' do nothing;
    if found then
      perform public.avisos_emitir_evento('ADMIN', jsonb_build_object(
        'tipo', 'terminal_cruce_equilibrio', 'titulo', v_titulo,
        'cuerpo', v_cuerpo, 'tab', 'Mercado', 'clave', v_clave,
        'tag', 'terminal'));
      v_avisos := v_avisos || 'cruce_equilibrio';
    end if;
  end if;

  -- (b) la cima (nivel 20) se mueve ≥3 %
  if v_est.nivel20 is not null and v_est.nivel20 > 0 and v_n20 is not null
     and abs(v_n20 / v_est.nivel20 - 1) >= 0.03 then
    v_clave := 'terminal-cima-se-mueve-'
      || extract(epoch from now())::bigint::text;
    v_titulo := '📈 Terminal: la cima se mueve';
    v_cuerpo := 'El nivel 20 del libro pasó de '
      || public.avisos_fmt_num(v_est.nivel20) || ' a '
      || public.avisos_fmt_num(v_n20) || ' ('
      || public.avisos_fmt_num(round(
           (v_n20 / v_est.nivel20 - 1) * 100, 1)) || '%).';
    insert into public.avisos_log
      (clave, evento_tipo, para, titulo, canal, resultado)
    values (v_clave, 'terminal_cima_se_mueve', 'ADMIN', v_titulo,
            'despacho', 'encolado')
    on conflict (clave) where canal = 'despacho' do nothing;
    if found then
      perform public.avisos_emitir_evento('ADMIN', jsonb_build_object(
        'tipo', 'terminal_cima_se_mueve', 'titulo', v_titulo,
        'cuerpo', v_cuerpo, 'tab', 'Mercado', 'clave', v_clave,
        'tag', 'terminal'));
      v_avisos := v_avisos || 'cima_se_mueve';
    end if;
  end if;

  -- el estado se actualiza siempre que haya foto fresca
  update public.terminal_alertas_estado
     set top_venta = v_top, nivel20 = v_n20, equilibrio = v_eq,
         actualizado = now()
   where id = 1;
  return jsonb_build_object('ok', true,
    'avisos', coalesce(array_length(v_avisos, 1), 0),
    'tipos', to_jsonb(v_avisos),
    'top_venta', v_top, 'nivel20', v_n20, 'equilibrio', v_eq);
end;
$function$;
revoke all on function public.terminal_alertas() from public;

-- cron propio cada 15 min (idempotente: si existe, se recrea)
do $$
begin
  if exists (select 1 from cron.job
              where jobname = 'terminal-alertas-cada-15min') then
    perform cron.unschedule('terminal-alertas-cada-15min');
  end if;
  perform cron.schedule('terminal-alertas-cada-15min', '*/15 * * * *',
    'select public.terminal_alertas()');
end $$;

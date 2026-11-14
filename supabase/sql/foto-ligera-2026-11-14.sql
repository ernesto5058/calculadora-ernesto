-- =====================================================================
-- FOTO LIGERA EN BUCLE (2026-11-14) — aprobado por Ernesto: el nivel
-- de venta de ETECSA (el que alimenta la Tarifa y el Asesor) baja de
-- ~50 s de edad típica a ≤15 s SIN tocar el seguro de presupuesto.
--
-- Diseño:
--  · El lector (modo 'rapido') sigue guardando la FOTO COMPLETA cada
--    minuto y DESPUÉS, dentro de la misma invocación, toma fotos
--    LIGERAS del libro ETECSA (compra+venta, take=100, EL MISMO
--    módulo logica.js de la completa) cada ~15 s hasta cerrar el
--    minuto. La pared real de las Edge Functions en este proyecto se
--    midió con una sonda desechable: 70 s completos, sin corte →
--    bucle con tope propio de ~54 s (3 ligeras por minuto típico).
--  · Las ligeras viven en su PROPIA tabla (mercado_fotos_ligeras):
--    ningún consumidor las ve salvo que se fusione a propósito. La
--    demanda (5 min) sigue comparando SOLO completas — su matemática
--    de profundidad/escalera jamás se contamina con filas flacas.
--  · La fusión vive en UN solo lugar: mercado_foto_vigente() —
--    nivel20/top_compra/top_venta de la ligera más reciente DEL
--    MISMO minuto (foto_base_id = la completa vigente) y el resto
--    de campos de la completa, con la EDAD DE CADA CAMPO escrita.
--    Nada de filas que simulen ser completas.
--  · Consumidores fusionados aquí: la puerta mercado_lectura_momento
--    (firma con la ligera: el collar juzga la edad DEL NIVEL), el
--    Asesor (guia_asesor_interno: nivel/top del cálculo = vigentes)
--    y la Tarifa (la primera lectura del suavizado es la vigente;
--    promedio/libro/conteo siempre de completas; la confirmación de
--    dos lecturas sigue anclada a foto_id de completas distintas).
--    El centinela detecta también sobre ligeras desde el lector,
--    con los umbrales de siempre.
--  · Presupuesto: la ligera RESERVA 2 en mercado_llamadas_qp
--    (consumidor 'lector_ligero') antes de gastar, cede si el minuto
--    se calienta (>=14 firmadas) o si la puerta/centinela firmaron
--    en los últimos segundos, y ante un 429 es lo PRIMERO que se
--    apaga (freno global de 5 min, como el chorro).
--  · Poda: las ligeras de más de 24 h se borran por cron diario.
-- =====================================================================

-- ── 1) La tabla flaca de ligeras ──────────────────────────────────
create table if not exists public.mercado_fotos_ligeras (
  id uuid primary key default gen_random_uuid(),
  recibida_en timestamptz not null default now(),
  foto_base_id uuid not null,
  etecsa_top_compra numeric,
  etecsa_nivel20 numeric,
  etecsa_top_venta numeric,
  count_buy int,
  count_sell int
);
create index if not exists mercado_fotos_ligeras_recibida_idx
  on public.mercado_fotos_ligeras (recibida_en desc);
alter table public.mercado_fotos_ligeras enable row level security;

-- ── 2) LA FUSIÓN: la foto vigente con edad por campo ──────────────
create or replace function public.mercado_foto_vigente()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_c public.mercado_fotos%rowtype;
  v_l public.mercado_fotos_ligeras%rowtype;
  v_usa boolean;
  v_campo_en timestamptz;
begin
  select * into v_c from public.mercado_fotos
   order by recibida_en desc limit 1;
  if v_c.id is null then return null; end if;
  select * into v_l from public.mercado_fotos_ligeras
   order by recibida_en desc limit 1;
  -- La ligera solo pinta encima si es del MISMO minuto que la
  -- completa vigente (su foto_base) y llegó después que ella.
  v_usa := v_l.id is not null
       and v_l.foto_base_id = v_c.id
       and v_l.recibida_en > v_c.recibida_en;
  v_campo_en := case when v_usa then v_l.recibida_en else v_c.recibida_en end;
  return jsonb_build_object(
    'id', v_c.id, 'recibida_en', v_c.recibida_en,
    'origen', v_c.origen, 'fresca', v_c.fresca, 'libro_ok', v_c.libro_ok,
    'nivel20', case when v_usa then v_l.etecsa_nivel20 else v_c.etecsa_nivel20 end,
    'top_venta', case when v_usa then v_l.etecsa_top_venta else v_c.etecsa_top_venta end,
    'top_compra', case when v_usa then v_l.etecsa_top_compra else v_c.etecsa_top_compra end,
    'bankcup_promedio', v_c.bankcup_promedio,
    'promedio_venta', v_c.etecsa_promedio_venta,
    'count_buy', v_c.etecsa_count_buy, 'count_sell', v_c.etecsa_count_sell,
    'edad_s', round(extract(epoch from (now() - v_c.recibida_en))),
    'nivel20_edad_s', round(extract(epoch from (now() - v_campo_en))),
    'top_venta_edad_s', round(extract(epoch from (now() - v_campo_en))),
    'top_compra_edad_s', round(extract(epoch from (now() - v_campo_en))),
    'ligera', case when v_usa then jsonb_build_object(
        'id', v_l.id, 'recibida_en', v_l.recibida_en,
        'edad_s', round(extract(epoch from (now() - v_l.recibida_en))),
        'foto_base_id', v_l.foto_base_id)
      else null end);
end $function$;
revoke all on function public.mercado_foto_vigente() from public;
grant execute on function public.mercado_foto_vigente()
  to anon, authenticated;

-- ── 3) La puerta de lectura al momento firma con la ligera ────────
CREATE OR REPLACE FUNCTION public.mercado_lectura_momento(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_foto record;
  v_vig jsonb;
  v_req bigint;
  v_usadas int;
  v_edad_nivel numeric;
begin
  if not public.admin_es_valido(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'no_admin');
  end if;
  select * into v_foto from mercado_fotos
  order by recibida_en desc limit 1;

  -- FOTO LIGERA (2026-11-14): la puerta firma con la foto VIGENTE
  -- (la completa fusionada con la ligera de su mismo minuto). El
  -- candado de «recién leída» juzga la edad DEL NIVEL — el campo que
  -- el collar protege — no la de la fila completa: con el chorro y
  -- el bucle vivos, el nivel tiene segundos y no se gasta una
  -- lectura nueva; si la corriente muere, la edad del nivel crece
  -- igual que la de la foto y la puerta dispara como siempre.
  v_vig := public.mercado_foto_vigente();
  v_edad_nivel := (v_vig ->> 'nivel20_edad_s')::numeric;

  if v_foto.id is not null
     and v_edad_nivel is not null and v_edad_nivel < 60 then
    return jsonb_build_object(
      'ok', true, 'disparada', false,
      'motivo', case when (v_vig -> 'ligera') is not null
                     and (v_vig -> 'ligera') <> 'null'::jsonb
                then 'recien_leida_ligera' else 'recien_leida' end,
      'foto', v_vig);
  end if;

  v_usadas := public.mercado_qp_llamadas_60s();
  if v_usadas >= 20 then
    return jsonb_build_object(
      'ok', true, 'disparada', false, 'motivo', 'presupuesto',
      'llamadas_60s', v_usadas,
      'foto', v_vig,
      'nota', 'El presupuesto de la API de este minuto está en el '
              'tope: se enseña la foto previa con su edad, sin fingir '
              'una lectura nueva.');
  end if;

  insert into public.mercado_llamadas_qp (consumidor)
  select 'momento' from generate_series(1, 6);

  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
             where name = 'mercado_project_url')
           || '/functions/v1/mercado-lector',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-mercado-cron', (select decrypted_secret from vault.decrypted_secrets
                          where name = 'mercado_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000) into v_req;

  return jsonb_build_object(
    'ok', true, 'disparada', true, 'peticion_id', v_req,
    'foto_previa', v_vig,
    'nota', 'La lectura fresca cae en segundos: la app relee la '
            'última foto y enseña su sello de hora.');
end $function$;

revoke all on function public.mercado_lectura_momento(text) from public;
grant execute on function public.mercado_lectura_momento(text)
  to anon, authenticated;

-- ── 4) La Tarifa consume la lectura vigente ───────────────────────
CREATE OR REPLACE FUNCTION public.tarifa_viva_evaluar(p_simular boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t public.tarifa%rowtype;
  v_c public.tarifa_viva_config%rowtype;
  v_f public.mercado_fotos%rowtype;
  v_fotos jsonb;
  v_prop public.tarifa_viva_historial%rowtype;
  v_base1 numeric; v_base24 numeric;
  v_n1 numeric; v_n24 numeric;
  v_in jsonb; v_d jsonb;
  v_accion text; v_hist uuid;
  v_vig jsonb;
  v_ing_fin numeric; v_delta_ap numeric;
  v_prop_estado text;
begin
  select * into v_t from public.tarifa where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sin_tarifa'); end if;
  select * into v_c from public.tarifa_viva_config where id = 1;
  if not found then
    insert into public.tarifa_viva_config (id) values (1) on conflict (id) do nothing;
    select * into v_c from public.tarifa_viva_config where id = 1;
  end if;

  select * into v_f from public.mercado_fotos order by recibida_en desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sin_fotos'); end if;

  -- Idempotencia: esta foto ya se evaluó (una foto = una lectura).
  if exists (select 1 from public.tarifa_viva_historial where foto_id = v_f.id) then
    return jsonb_build_object('ok', true, 'decision', 'ya_evaluada', 'foto_id', v_f.id);
  end if;

  -- Las lecturas pa el suavizado (nueva → vieja). FOTO LIGERA
  -- (2026-11-14): la primera lectura es la VIGENTE — la completa más
  -- nueva con su nivel20 refrescado por la ligera de su mismo minuto
  -- cuando la hay (la ligera es la MISMA corriente leída con el
  -- MISMO método, solo que ~15 s más joven) — y detrás van las dos
  -- completas anteriores tal cual. El promedio de venta, el libro
  -- BANK_CUP y el conteo salen siempre de las completas: la ligera
  -- solo refresca el nivel del libro ETECSA. La regla de dos
  -- lecturas NO cambia: la confirmación sigue anclada al foto_id de
  -- la completa de cada evaluación (dos evaluaciones = dos fotos
  -- completas distintas de la misma corriente).
  v_vig := public.mercado_foto_vigente();
  select coalesce(jsonb_agg(x.lect order by x.orden), '[]'::jsonb)
    into v_fotos
    from (
      select 1 as orden, jsonb_build_object(
          'nivel20', coalesce((v_vig ->> 'nivel20')::numeric, v_f.etecsa_nivel20),
          'promedio_venta', v_f.etecsa_promedio_venta,
          'bankcup', v_f.bankcup_promedio, 'count_sell', v_f.etecsa_count_sell,
          'fresca', v_f.fresca) as lect
      union all
      select 1 + row_number() over (order by f.recibida_en desc),
             jsonb_build_object(
          'nivel20', f.etecsa_nivel20, 'promedio_venta', f.etecsa_promedio_venta,
          'bankcup', f.bankcup_promedio, 'count_sell', f.etecsa_count_sell,
          'fresca', f.fresca)
        from (select * from public.mercado_fotos
               where id <> v_f.id order by recibida_en desc limit 2) f
    ) x;

  -- Velocidad: cambio neto ya andado en cada ventana, del historial
  -- real (aplicaciones del motor + fijaciones manuales de Ernesto).
  select coalesce(
      (select h.ingreso_nuevo from public.tarifa_viva_historial h
        where h.decision in ('aplicada', 'manual') and h.creado_en <= now() - interval '1 hour'
        order by h.creado_en desc limit 1),
      (select h.ingreso_viejo from public.tarifa_viva_historial h
        where h.decision in ('aplicada', 'manual') and h.creado_en > now() - interval '1 hour'
        order by h.creado_en asc limit 1),
      v_t.ingreso_ref360)
    into v_base1;
  select coalesce(
      (select h.ingreso_nuevo from public.tarifa_viva_historial h
        where h.decision in ('aplicada', 'manual') and h.creado_en <= now() - interval '24 hours'
        order by h.creado_en desc limit 1),
      (select h.ingreso_viejo from public.tarifa_viva_historial h
        where h.decision in ('aplicada', 'manual') and h.creado_en > now() - interval '24 hours'
        order by h.creado_en asc limit 1),
      v_t.ingreso_ref360)
    into v_base24;
  v_n1 := round((v_t.ingreso_ref360 - v_base1) / v_base1 * 100, 4);
  v_n24 := round((v_t.ingreso_ref360 - v_base24) / v_base24 * 100, 4);

  v_in := jsonb_build_object(
    'ingreso_vigente', v_t.ingreso_ref360, 'libro_vigente', v_t.libro_ref,
    'salida', v_t.salida_ref,
    'activa', v_c.inteligente_activa, 'umbral_pct', v_c.umbral_grande_pct,
    'vel_hora_pct', v_c.vel_max_hora_pct, 'vel_dia_pct', v_c.vel_max_dia_pct,
    'costo_ref', v_c.costo_ref, 'comision_busq_pct', v_c.comision_busq_pct,
    'profundidad_ref', v_c.profundidad_ref,
    'foto', jsonb_build_object('id', v_f.id, 'fresca', v_f.fresca,
      -- La edad que juzga la puerta de frescura es la del dato más
      -- joven que alimenta la lectura (la ligera, si alimentó).
      'edad_min', round((least(
          extract(epoch from (now() - v_f.recibida_en)),
          coalesce((v_vig ->> 'nivel20_edad_s')::numeric,
                   extract(epoch from (now() - v_f.recibida_en)))) / 60.0)::numeric, 1),
      'nivel_ligero', case
        when (v_vig -> 'ligera') is null or (v_vig -> 'ligera') = 'null'::jsonb
        then null
        else jsonb_build_object(
          'id', v_vig #>> '{ligera,id}',
          'edad_s', (v_vig #>> '{ligera,edad_s}')::numeric,
          'nivel20', (v_vig ->> 'nivel20')::numeric) end),
    'fotos', v_fotos,
    'conf', jsonb_build_object('direccion', v_c.conf_direccion,
      'foto_id', v_c.conf_foto_id, 'delta_pct', v_c.conf_delta_pct),
    'neto_1h_pct', v_n1, 'neto_24h_pct', v_n24);

  v_d := public.tarifa_viva_decidir(v_in);
  if not coalesce((v_d ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', v_d ->> 'motivo', 'foto_id', v_f.id);
  end if;
  v_accion := v_d ->> 'accion';

  -- La propuesta pendiente del régimen viejo (si la hay).
  select * into v_prop from public.tarifa_viva_historial
   where decision = 'propuesta' and estado = 'pendiente'
   order by creado_en desc limit 1;

  if p_simular then
    return jsonb_build_object('ok', true, 'decision', v_accion, 'simular', true,
      'foto_id', v_f.id, 'decision_completa', v_d,
      'ingreso_viejo', v_t.ingreso_ref360, 'libro_viejo', v_t.libro_ref,
      'propuesta_pendiente', case when v_prop.id is null then null else v_prop.id end);
  end if;

  v_ing_fin := (v_d ->> 'ingreso_nuevo')::numeric;
  v_delta_ap := (v_d ->> 'delta_aplicado_pct')::numeric;

  if v_accion = 'aplicar' then
    update public.tarifa
       set ingreso_ref360 = v_ing_fin,
           libro_ref      = (v_d ->> 'libro_nuevo')::numeric,
           actualizado    = now(),
           actualizado_por = 'MERCADO'
     where id = 1;
  end if;

  -- La confirmación que devuelve la pura manda en el estado del motor.
  update public.tarifa_viva_config
     set conf_direccion = coalesce((v_d -> 'nueva_conf' ->> 'direccion')::int, 0),
         conf_foto_id   = (v_d -> 'nueva_conf' ->> 'foto_id')::uuid,
         conf_delta_pct = (v_d -> 'nueva_conf' ->> 'delta_pct')::numeric,
         conf_en        = case when coalesce((v_d -> 'nueva_conf' ->> 'direccion')::int, 0) <> 0
                               then now() else null end,
         actualizado    = now()
   where id = 1;

  insert into public.tarifa_viva_historial
    (foto_id, foto_recibida_en, foto_origen_en, ingreso_viejo, ingreso_nuevo,
     libro_viejo, libro_nuevo, salida_ref, tasa_ref, bankcup_ref, delta_pct, decision, detalle)
  values
    (v_f.id, v_f.recibida_en, v_f.origen_en, v_t.ingreso_ref360,
     coalesce(v_ing_fin, (v_d ->> 'ingreso_candidato')::numeric),
     v_t.libro_ref, (v_d ->> 'libro_nuevo')::numeric, v_t.salida_ref,
     (v_d ->> 'tasa_ref')::numeric, v_f.bankcup_promedio,
     coalesce(v_delta_ap, (v_d ->> 'delta_pct')::numeric),
     case v_accion
       when 'aplicar' then 'aplicada'
       else v_accion end,
     coalesce(v_d -> 'detalle', '{}'::jsonb) || jsonb_build_object(
       'porque', v_d ->> 'porque',
       'accion_motor', v_accion,
       'nivel_ligero', v_in -> 'foto' -> 'nivel_ligero',
       'neto_1h_pct', v_n1, 'neto_24h_pct', v_n24))
  returning id into v_hist;

  -- Regla 7: la propuesta del régimen viejo muere en esta primera
  -- evaluación — aplicada solo si la inteligencia aplicó un
  -- movimiento en su misma dirección; si no, descartada. Con la
  -- inteligencia en pausa no se toca (manda la mano de Ernesto).
  if v_prop.id is not null and v_accion <> 'pausa_manual' then
    v_prop_estado := case
      when v_accion = 'aplicar' and v_delta_ap is not null and v_prop.delta_pct is not null
           and sign(v_delta_ap) = sign(v_prop.delta_pct)
      then 'aplicada' else 'descartada' end;
    update public.tarifa_viva_historial
       set estado = v_prop_estado, resuelta_en = now(), resuelta_por = 'MOTOR_INTELIGENTE',
           detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object(
             'resolucion_inteligente', jsonb_build_object(
               'decision_motor', v_accion, 'porque', v_d ->> 'porque',
               'valor_aplicado', v_ing_fin, 'historial_motor', v_hist))
     where id = v_prop.id;
  end if;

  return jsonb_build_object('ok', true, 'decision',
    case v_accion when 'aplicar' then 'aplicada' else v_accion end,
    'historial_id', v_hist, 'foto_id', v_f.id, 'decision_completa', v_d,
    'propuesta_resuelta', case when v_prop.id is null or v_accion = 'pausa_manual'
      then null else v_prop_estado end);
end;
$function$;

-- ── 5) El Asesor come el nivel vigente ────────────────────────────
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
  v_vig jsonb;
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
  -- FOTO LIGERA (2026-11-14): el nivel20 y el top de venta que come
  -- el cálculo son los VIGENTES (la completa fusionada con la ligera
  -- de su mismo minuto: misma corriente, mismo método, ~15 s más
  -- joven). Todo lo demás (propias, qUSD, menú, duras, escalera)
  -- sigue saliendo de la completa. La «usable» NO cambia: sin
  -- completa fresca y con libro no hay cálculo — la ligera no
  -- resucita fotos muertas.
  v_vig := public.mercado_foto_vigente();
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
  v_puesto := v_habana_hoy between v_cfg.puesto_desde and v_cfg.puesto_hasta;

  v_calc := public.guia_calc_asesor(jsonb_build_object(
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
      'nivel20', coalesce((v_vig ->> 'nivel20')::numeric, v_foto.etecsa_nivel20),
      'top_venta', coalesce((v_vig ->> 'top_venta')::numeric, v_foto.etecsa_top_venta),
      'nivel20_edad_s', (v_vig ->> 'nivel20_edad_s')::numeric,
      'ligera', v_vig -> 'ligera',
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

-- ── 6) Poda diaria de ligeras viejas (>24 h) ──────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mercado-ligeras-poda') then
    perform cron.unschedule('mercado-ligeras-poda');
  end if;
  perform cron.schedule('mercado-ligeras-poda', '17 5 * * *',
    'delete from public.mercado_fotos_ligeras where recibida_en < now() - interval ''24 hours''');
end $$;

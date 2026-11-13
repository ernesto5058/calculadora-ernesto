-- =====================================================================
-- TARIFA VIVA (2026-11-13 · orden de Ernesto: «tú sabrás» — la tarifa
-- se mide del mercado sola, con su freno: banda de ±2%)
--
-- QUÉ HACE:
--   Con cada foto FRESCA del mercado (mercado_fotos, la del lector de
--   cada 15 min), un motor en el servidor calcula la tarifa que el
--   mercado manda y:
--     · si el ingreso por recarga se mueve ≤2% → la APLICA solo
--       (actualizado_por = 'MERCADO', sin mensajes masivos);
--     · si se mueve >2% → la deja como PROPUESTA PENDIENTE y la
--       tarifa vigente NO se toca: Ernesto la aplica o la descarta
--       desde Mi Negocio (puerta tarifa_viva_resolver);
--     · si la foto es vieja (>20 min) o viene marcada no fresca →
--       NO se toca nada (la tarifa queda como respaldo, y así se
--       registra).
--   Cada evaluación queda en tarifa_viva_historial (auditable:
--   valor viejo → nuevo, foto, hora, decisión). Una foto se evalúa
--   una sola vez (índice único por foto).
--
-- LA FÓRMULA (la misma identidad que ya usa el Analista de Mercado
-- en sus peldaños — g360 = 360 × salida ÷ tasa − costo — y la
-- calculadora de Mi Negocio, derivadaCalc):
--     tasa_ref        = etecsa_nivel20 de la foto (el nivel ejecutable
--                       de venta de 20 USD; si falta, etecsa_promedio_venta)
--     ingreso_ref360' = redondeo2( 360 × salida_ref VIGENTE ÷ tasa_ref )
--     libro_ref'      = redondeo2( bankcup_promedio de la foto )
--                       (si la foto no trae bankcup, el libro se queda)
--     delta%          = (ingreso' − ingreso vigente) ÷ ingreso vigente × 100
--   La SALIDA jamás la mueve el motor: es de Ernesto (su Calculadora
--   y su salida real mandan); el motor deriva el ingreso DESDE ella.
--   Lo que PAGA cada trato sigue siendo la foto de tarifa del cierre
--   (las puertas dinero_ congelan base_ref360 en la vuelta; los
--   reportes congelan su foto vía admin_foto_tarifa_reporte): la
--   tarifa viva es la estimación que se VE, no una reescritura.
--
-- FRONTERA: tarifa_viva_buscador() NO devuelve salida_ref, ni los
-- valores de la propuesta pendiente, ni historial: solo la tarifa
-- vigente (sus dos patas), la frescura de la foto y si hay una
-- propuesta esperando al dueño.
--
-- Idempotente: segunda corrida inocua.
-- =====================================================================

-- ---------- 1) Historial auditable del motor ----------
create table if not exists public.tarifa_viva_historial (
  id               uuid primary key default gen_random_uuid(),
  creado_en        timestamptz not null default now(),
  foto_id          uuid,
  foto_recibida_en timestamptz,
  foto_origen_en   timestamptz,
  ingreso_viejo    numeric,
  ingreso_nuevo    numeric,
  libro_viejo      numeric,
  libro_nuevo      numeric,
  salida_ref       numeric,
  tasa_ref         numeric,
  bankcup_ref      numeric,
  delta_pct        numeric,
  decision         text not null,   -- aplicada | propuesta | sin_cambio | foto_vieja
  estado           text not null default '—',  -- propuesta: pendiente | aplicada | descartada | reemplazada
  resuelta_en      timestamptz,
  resuelta_por     text,
  detalle          jsonb
);
alter table public.tarifa_viva_historial enable row level security;
revoke all on table public.tarifa_viva_historial from anon, authenticated;

-- Una sola evaluación por foto (idempotencia del motor).
create unique index if not exists tarifa_viva_hist_foto_una
  on public.tarifa_viva_historial (foto_id)
  where foto_id is not null;
-- Una sola propuesta pendiente a la vez.
create unique index if not exists tarifa_viva_una_pendiente
  on public.tarifa_viva_historial (decision)
  where decision = 'propuesta' and estado = 'pendiente';

-- ---------- 2) El cálculo PURO (testeable; sin escrituras) ----------
create or replace function public.tarifa_viva_calcular(
  p_nivel20 numeric, p_promedio_venta numeric, p_bankcup numeric,
  p_salida numeric, p_ingreso_vigente numeric, p_libro_vigente numeric)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_tasa numeric := coalesce(p_nivel20, p_promedio_venta);
  v_ing  numeric;
  v_lib  numeric;
  v_delta numeric;
begin
  if v_tasa is null or v_tasa <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_tasa_de_venta');
  end if;
  if p_salida is null or p_salida <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_salida_vigente');
  end if;
  if p_ingreso_vigente is null or p_ingreso_vigente <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_ingreso_vigente');
  end if;
  v_ing := round(360 * p_salida / v_tasa, 2);
  v_lib := case when p_bankcup is not null and p_bankcup > 0
                then round(p_bankcup, 2) else p_libro_vigente end;
  v_delta := round((v_ing - p_ingreso_vigente) / p_ingreso_vigente * 100, 4);
  return jsonb_build_object(
    'ok', true,
    'tasa_ref', v_tasa,
    'ingreso_nuevo', v_ing,
    'libro_nuevo', v_lib,
    'delta_pct', v_delta,
    'accion', case
      when v_ing = p_ingreso_vigente and (v_lib is not distinct from p_libro_vigente) then 'sin_cambio'
      when abs(v_delta) <= 2 then 'aplicar'
      else 'propuesta' end);
end;
$function$;
revoke execute on function public.tarifa_viva_calcular(numeric, numeric, numeric, numeric, numeric, numeric) from public;
grant execute on function public.tarifa_viva_calcular(numeric, numeric, numeric, numeric, numeric, numeric) to anon;

-- ---------- 3) El motor: evalúa la última foto (una vez por foto) ----------
create or replace function public.tarifa_viva_evaluar(p_simular boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t public.tarifa%rowtype;
  v_f public.mercado_fotos%rowtype;
  v_calc jsonb;
  v_accion text;
  v_hist uuid;
  v_edad_min numeric;
begin
  select * into v_t from public.tarifa where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sin_tarifa'); end if;

  select * into v_f from public.mercado_fotos order by recibida_en desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sin_fotos'); end if;

  -- Idempotencia: esta foto ya se evaluó.
  if exists (select 1 from public.tarifa_viva_historial where foto_id = v_f.id) then
    return jsonb_build_object('ok', true, 'decision', 'ya_evaluada', 'foto_id', v_f.id);
  end if;

  v_edad_min := extract(epoch from (now() - v_f.recibida_en)) / 60.0;

  -- Foto vieja o marcada no fresca: NO se toca nada.
  if coalesce(v_f.fresca, false) = false or v_edad_min > 20 then
    if not p_simular then
      insert into public.tarifa_viva_historial
        (foto_id, foto_recibida_en, foto_origen_en, ingreso_viejo, libro_viejo,
         salida_ref, decision, detalle)
      values
        (v_f.id, v_f.recibida_en, v_f.origen_en, v_t.ingreso_ref360, v_t.libro_ref,
         v_t.salida_ref, 'foto_vieja',
         jsonb_build_object('edad_min', round(v_edad_min, 1), 'fresca', v_f.fresca));
    end if;
    return jsonb_build_object('ok', true, 'decision', 'foto_vieja',
      'foto_id', v_f.id, 'edad_min', round(v_edad_min, 1), 'simular', p_simular);
  end if;

  v_calc := public.tarifa_viva_calcular(
    v_f.etecsa_nivel20, v_f.etecsa_promedio_venta, v_f.bankcup_promedio,
    v_t.salida_ref, v_t.ingreso_ref360, v_t.libro_ref);
  if not coalesce((v_calc ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', v_calc ->> 'motivo', 'foto_id', v_f.id);
  end if;
  v_accion := v_calc ->> 'accion';

  if p_simular then
    return jsonb_build_object('ok', true, 'decision', v_accion, 'simular', true,
      'foto_id', v_f.id, 'calculo', v_calc,
      'ingreso_viejo', v_t.ingreso_ref360, 'libro_viejo', v_t.libro_ref);
  end if;

  if v_accion = 'aplicar' then
    update public.tarifa
       set ingreso_ref360 = (v_calc ->> 'ingreso_nuevo')::numeric,
           libro_ref      = (v_calc ->> 'libro_nuevo')::numeric,
           actualizado    = now(),
           actualizado_por = 'MERCADO'
     where id = 1;
    insert into public.tarifa_viva_historial
      (foto_id, foto_recibida_en, foto_origen_en, ingreso_viejo, ingreso_nuevo,
       libro_viejo, libro_nuevo, salida_ref, tasa_ref, bankcup_ref, delta_pct, decision)
    values
      (v_f.id, v_f.recibida_en, v_f.origen_en, v_t.ingreso_ref360,
       (v_calc ->> 'ingreso_nuevo')::numeric, v_t.libro_ref,
       (v_calc ->> 'libro_nuevo')::numeric, v_t.salida_ref,
       (v_calc ->> 'tasa_ref')::numeric, v_f.bankcup_promedio,
       (v_calc ->> 'delta_pct')::numeric, 'aplicada')
    returning id into v_hist;
  elsif v_accion = 'propuesta' then
    -- La anterior pendiente queda reemplazada por la más fresca.
    update public.tarifa_viva_historial
       set estado = 'reemplazada', resuelta_en = now(), resuelta_por = 'MOTOR'
     where decision = 'propuesta' and estado = 'pendiente';
    insert into public.tarifa_viva_historial
      (foto_id, foto_recibida_en, foto_origen_en, ingreso_viejo, ingreso_nuevo,
       libro_viejo, libro_nuevo, salida_ref, tasa_ref, bankcup_ref, delta_pct,
       decision, estado)
    values
      (v_f.id, v_f.recibida_en, v_f.origen_en, v_t.ingreso_ref360,
       (v_calc ->> 'ingreso_nuevo')::numeric, v_t.libro_ref,
       (v_calc ->> 'libro_nuevo')::numeric, v_t.salida_ref,
       (v_calc ->> 'tasa_ref')::numeric, v_f.bankcup_promedio,
       (v_calc ->> 'delta_pct')::numeric, 'propuesta', 'pendiente')
    returning id into v_hist;
  else
    insert into public.tarifa_viva_historial
      (foto_id, foto_recibida_en, foto_origen_en, ingreso_viejo, ingreso_nuevo,
       libro_viejo, libro_nuevo, salida_ref, tasa_ref, bankcup_ref, delta_pct, decision)
    values
      (v_f.id, v_f.recibida_en, v_f.origen_en, v_t.ingreso_ref360,
       (v_calc ->> 'ingreso_nuevo')::numeric, v_t.libro_ref,
       (v_calc ->> 'libro_nuevo')::numeric, v_t.salida_ref,
       (v_calc ->> 'tasa_ref')::numeric, v_f.bankcup_promedio,
       (v_calc ->> 'delta_pct')::numeric, 'sin_cambio')
    returning id into v_hist;
  end if;

  return jsonb_build_object('ok', true, 'decision',
    case v_accion when 'aplicar' then 'aplicada' when 'propuesta' then 'propuesta' else 'sin_cambio' end,
    'historial_id', v_hist, 'foto_id', v_f.id, 'calculo', v_calc);
end;
$function$;
-- El motor ESCRIBE: jamás callable por anon. Lo corre pg_cron (postgres)
-- y nadie más; las apps solo leen por las puertas de abajo.
revoke execute on function public.tarifa_viva_evaluar(boolean) from public, anon, authenticated;

-- ---------- 4) El vigilante: cada 5 min evalúa la foto más nueva ----------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'tarifa-viva-cada-5min') then
    perform cron.unschedule('tarifa-viva-cada-5min');
  end if;
  perform cron.schedule('tarifa-viva-cada-5min', '*/5 * * * *',
    'select public.tarifa_viva_evaluar(false)');
end $$;

-- ---------- 5) Puerta del DUEÑO: estado completo del motor ----------
create or replace function public.tarifa_viva_estado()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t public.tarifa%rowtype;
  v_f public.mercado_fotos%rowtype;
  v_prop public.tarifa_viva_historial%rowtype;
  v_ult  public.tarifa_viva_historial%rowtype;
  v_hist jsonb;
begin
  select * into v_t from public.tarifa where id = 1;
  select * into v_f from public.mercado_fotos order by recibida_en desc limit 1;
  select * into v_prop from public.tarifa_viva_historial
   where decision = 'propuesta' and estado = 'pendiente'
   order by creado_en desc limit 1;
  select * into v_ult from public.tarifa_viva_historial order by creado_en desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
      'creado_en', h.creado_en, 'decision', h.decision, 'estado', h.estado,
      'ingreso_viejo', h.ingreso_viejo, 'ingreso_nuevo', h.ingreso_nuevo,
      'libro_nuevo', h.libro_nuevo, 'delta_pct', h.delta_pct) order by h.creado_en desc), '[]'::jsonb)
    into v_hist
    from (select * from public.tarifa_viva_historial order by creado_en desc limit 6) h;

  return jsonb_build_object(
    'ok', true,
    'tarifa', jsonb_build_object(
      'ingreso_ref360', v_t.ingreso_ref360, 'libro_ref', v_t.libro_ref,
      'salida_ref', v_t.salida_ref, 'comision_saldo', v_t.comision_saldo,
      'comision_transf', v_t.comision_transf, 'piso_transf', v_t.piso_transf,
      'actualizado', v_t.actualizado, 'actualizado_por', v_t.actualizado_por),
    'foto', case when v_f.id is null then null else jsonb_build_object(
      'id', v_f.id, 'recibida_en', v_f.recibida_en, 'origen_en', v_f.origen_en,
      'fresca', v_f.fresca,
      'edad_min', round((extract(epoch from (now() - v_f.recibida_en)) / 60.0)::numeric, 1),
      'nivel20', v_f.etecsa_nivel20, 'promedio_venta', v_f.etecsa_promedio_venta,
      'bankcup_promedio', v_f.bankcup_promedio) end,
    'motor', jsonb_build_object(
      'ultima_decision', v_ult.decision, 'ultima_en', v_ult.creado_en,
      'propuesta', case when v_prop.id is null then null else jsonb_build_object(
        'id', v_prop.id, 'ingreso_nuevo', v_prop.ingreso_nuevo,
        'libro_nuevo', v_prop.libro_nuevo, 'delta_pct', v_prop.delta_pct,
        'creado_en', v_prop.creado_en, 'foto_en', v_prop.foto_recibida_en) end,
      'historial', v_hist));
end;
$function$;
revoke execute on function public.tarifa_viva_estado() from public;
grant execute on function public.tarifa_viva_estado() to anon;

-- ---------- 6) Puerta del BUSCADOR: solo SUS dos patas + frescura ----------
create or replace function public.tarifa_viva_buscador()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t public.tarifa%rowtype;
  v_f public.mercado_fotos%rowtype;
begin
  select * into v_t from public.tarifa where id = 1;
  select * into v_f from public.mercado_fotos order by recibida_en desc limit 1;
  return jsonb_build_object(
    'ok', true,
    'ingreso_ref360', v_t.ingreso_ref360,
    'libro_ref', v_t.libro_ref,
    'actualizado', v_t.actualizado,
    'foto_recibida_en', v_f.recibida_en,
    'fresca', coalesce(v_f.fresca, false),
    'edad_min', case when v_f.id is null then null else
      round((extract(epoch from (now() - v_f.recibida_en)) / 60.0)::numeric, 1) end,
    'hay_propuesta_pendiente', exists (
      select 1 from public.tarifa_viva_historial
       where decision = 'propuesta' and estado = 'pendiente'));
end;
$function$;
revoke execute on function public.tarifa_viva_buscador() from public;
grant execute on function public.tarifa_viva_buscador() to anon;

-- ---------- 7) Resolver la propuesta (SOLO el dueño) ----------
create or replace function public.tarifa_viva_resolver(p_codigo text, p_accion text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_p public.tarifa_viva_historial%rowtype;
begin
  if not exists (select 1 from public.admin_config
                  where clave = 'codigo_admin' and valor = p_codigo) then
    raise exception 'codigo admin no valido';
  end if;
  if p_accion not in ('aplicar', 'descartar') then
    raise exception 'accion invalida';
  end if;
  select * into v_p from public.tarifa_viva_historial
   where decision = 'propuesta' and estado = 'pendiente'
   order by creado_en desc limit 1 for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sin_propuesta_pendiente');
  end if;
  if p_accion = 'aplicar' then
    update public.tarifa
       set ingreso_ref360 = v_p.ingreso_nuevo, libro_ref = v_p.libro_nuevo,
           actualizado = now(), actualizado_por = 'MERCADO'
     where id = 1;
    update public.tarifa_viva_historial
       set estado = 'aplicada', resuelta_en = now(), resuelta_por = 'ADMIN'
     where id = v_p.id;
  else
    update public.tarifa_viva_historial
       set estado = 'descartada', resuelta_en = now(), resuelta_por = 'ADMIN'
     where id = v_p.id;
  end if;
  return jsonb_build_object('ok', true, 'accion', p_accion, 'propuesta', v_p.id,
    'ingreso_ref360', v_p.ingreso_nuevo, 'libro_ref', v_p.libro_nuevo);
end;
$function$;
revoke execute on function public.tarifa_viva_resolver(text, text) from public;
grant execute on function public.tarifa_viva_resolver(text, text) to anon;

-- ---------- 8) Foto de tarifa por reporte (lo que PAGÓ su cierre) ----------
alter table public.reportes
  add column if not exists tarifa_ref360 numeric,
  add column if not exists tarifa_ref_libro numeric;

create or replace function public.admin_foto_tarifa_reporte(
  p_codigo text, p_id uuid, p_ref360 numeric, p_ref_libro numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.admin_es_valido(p_codigo) then
    raise exception 'codigo admin no valido';
  end if;
  -- La PRIMERA foto manda: jamás se sobrescribe (es el registro de
  -- con qué tarifa se cerró el trato).
  update public.reportes
     set tarifa_ref360 = p_ref360, tarifa_ref_libro = p_ref_libro
   where id = p_id and estado = 'aprobado' and tarifa_ref360 is null;
  return jsonb_build_object('ok', true);
end;
$function$;
revoke execute on function public.admin_foto_tarifa_reporte(text, uuid, numeric, numeric) from public;
grant execute on function public.admin_foto_tarifa_reporte(text, uuid, numeric, numeric) to anon;

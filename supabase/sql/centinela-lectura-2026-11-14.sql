-- =====================================================================
-- CENTINELA ADAPTATIVO (velocidad 3) + LECTURA AL MOMENTO (V1/V2)
-- Orden de Ernesto 2026-11-14. La lógica vive en el LECTOR
-- (mercado-lector, modo {modo:'centinela'}): este SQL solo crea el
-- estado, la configuración, la puerta de lectura bajo demanda y —
-- AL FINAL, tras desplegar el lector nuevo — el cron de 2 minutos.
-- Sin tablas de mercado nuevas salvo el estado del centinela y su
-- registro de eventos (una máquina de estados necesita su fila y
-- su auditoría; los umbrales viven en mercado_config, la config
-- que ya existe).
-- =====================================================================

-- ── 1) Estado + registro del centinela ─────────────────────────────
create table if not exists public.mercado_centinela (
  id int primary key,
  estado text not null default 'calma',        -- calma | persecucion
  desde timestamptz,                           -- inicio de la persecución
  calma_seguidas int not null default 0,       -- lecturas en calma seguidas
  ultima_sonda timestamptz,                    -- último despertar (2 min)
  freno_hasta timestamptz,                     -- freno tras un 429
  actualizado timestamptz not null default now()
);
insert into public.mercado_centinela (id) values (1)
on conflict (id) do nothing;

create table if not exists public.mercado_centinela_log (
  id bigint generated always as identity primary key,
  creado_en timestamptz not null default now(),
  evento text not null,      -- inicio_persecucion | fin_persecucion |
                             -- fin_forzado | tope_hora | freno_429
  detalle jsonb
);

alter table public.mercado_centinela enable row level security;
alter table public.mercado_centinela_log enable row level security;

-- ── 2) Umbrales configurables (en la config que ya existe) ────────
-- Umbral de salto = mediana del |Δ%| entre fotos de las últimas
-- 24 h × factor, acotado entre el suelo (umbral_min_pct) y 6 %.
alter table public.mercado_config
  add column if not exists centinela_activo boolean not null default true,
  add column if not exists centinela_umbral_min_pct numeric not null default 1.5,
  add column if not exists centinela_factor numeric not null default 3,
  add column if not exists centinela_tope_hora int not null default 20,
  add column if not exists centinela_max_min int not null default 60,
  add column if not exists centinela_calma_lecturas int not null default 2;

-- ── 3) LECTURA AL MOMENTO — la puerta que las apps llaman al
-- entrar (V1) y al abrir el apartado Mercado (V2). Dispara el
-- MISMO lector de siempre (sin duplicar lógica) y devuelve la
-- foto previa con su edad: la app relee en segundos y enseña el
-- sello de hora de la foto nueva. Si la última foto tiene menos
-- de 60 s, no gasta una lectura.
create or replace function public.mercado_lectura_momento(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foto record;
  v_req bigint;
begin
  if not public.admin_es_valido(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'no_admin');
  end if;
  select * into v_foto from mercado_fotos
  order by recibida_en desc limit 1;

  if v_foto.id is not null
     and extract(epoch from (now() - v_foto.recibida_en)) < 60 then
    return jsonb_build_object(
      'ok', true, 'disparada', false, 'motivo', 'recien_leida',
      'foto', jsonb_build_object(
        'id', v_foto.id, 'recibida_en', v_foto.recibida_en,
        'edad_s', round(extract(epoch from (now() - v_foto.recibida_en))),
        'nivel20', v_foto.etecsa_nivel20,
        'top_venta', v_foto.etecsa_top_venta,
        'bankcup_promedio', v_foto.bankcup_promedio));
  end if;

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
    'foto_previa', jsonb_build_object(
      'id', v_foto.id, 'recibida_en', v_foto.recibida_en,
      'edad_s', round(extract(epoch from (now() - v_foto.recibida_en))),
      'nivel20', v_foto.etecsa_nivel20,
      'top_venta', v_foto.etecsa_top_venta,
      'bankcup_promedio', v_foto.bankcup_promedio),
    'nota', 'La lectura fresca cae en segundos: la app relee la '
            'última foto y enseña su sello de hora.');
end $$;

revoke all on function public.mercado_lectura_momento(text) from public;
grant execute on function public.mercado_lectura_momento(text)
  to anon, authenticated;

-- ── 4) EL CRON DEL CENTINELA — APLICAR SOLO TRAS DESPLEGAR EL
-- LECTOR NUEVO (si corre contra el lector viejo, este ignora el
-- cuerpo y haría el pipeline entero cada 2 minutos).
-- select cron.unschedule('mercado-centinela-cada-2min')
-- where exists (select 1 from cron.job
--               where jobname = 'mercado-centinela-cada-2min');
-- APLICADO EN VIVO el 2026-11-14: jobid 10 en cron.job, activo,
-- primera sonda 05:40:01 UTC, estado «calma», sin eventos en un
-- mercado quieto (cero falsas alarmas al estrenar).
-- select cron.schedule('mercado-centinela-cada-2min', '*/2 * * * *', $cmd$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets
--              where name = 'mercado_project_url')
--            || '/functions/v1/mercado-lector',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-mercado-cron', (select decrypted_secret from vault.decrypted_secrets
--                           where name = 'mercado_cron_secret')),
--     body := '{"modo":"centinela"}'::jsonb,
--     timeout_milliseconds := 90000);
-- $cmd$);

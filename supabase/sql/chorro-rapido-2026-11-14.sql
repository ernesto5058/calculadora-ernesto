-- =====================================================================
-- CHORRO RÁPIDO «CASI EN VIVO» — el mercado en SEGUNDOS (orden de
-- Ernesto 2026-11-14: «Dármelo casi en vivo»). El lector gana el modo
-- {modo:'rapido'} (foto completa cada 1 min por la ruta gratis
-- documentada: GET /p2p con filtrado y orden en servidor) y TODOS los
-- consumidores de la API comparten UN libro mayor de presupuesto:
-- el cupo es de 25 peticiones/min POR CUENTA (doc oficial de QvaPay)
-- y el tope interno es 20 — las 5 de reserva son del pulso de 15 min
-- y de la puerta blindada, que jamás se frenan por presupuesto.
-- Consumidores que firman en el libro: lector_rapido (reserva 6 por
-- foto: 4 libros + my=true + margen de reconciliación),
-- centinela_sonda (2), centinela_pipeline (6) y momento (6).
-- 429 o error sostenido = degradación honesta: freno global en
-- mercado_presupuesto, el chorro se pausa y la cadencia vuelve a la
-- de 15 min del pulso de siempre, con registro en
-- mercado_presupuesto_log. Nada de huecos silenciosos.
-- El feed pago de $10/30 días NO está aprobado: no se toca.
-- =====================================================================

-- ── 1) El libro mayor de llamadas a la API ────────────────────────
create table if not exists public.mercado_llamadas_qp (
  id bigint generated always as identity primary key,
  creada_en timestamptz not null default now(),
  consumidor text not null   -- lector_rapido | centinela_sonda |
                             -- centinela_pipeline | momento
);
create index if not exists mercado_llamadas_qp_creada_idx
  on public.mercado_llamadas_qp (creada_en);
alter table public.mercado_llamadas_qp enable row level security;

-- ── 2) El estado del presupuesto (freno/degradación globales) ─────
create table if not exists public.mercado_presupuesto (
  id int primary key,
  freno_hasta timestamptz,              -- freno global vigente
  degradado boolean not null default false,
  degradado_desde timestamptz,
  motivo text,
  fallos_seguidos int not null default 0,
  actualizado timestamptz not null default now()
);
insert into public.mercado_presupuesto (id) values (1)
on conflict (id) do nothing;
alter table public.mercado_presupuesto enable row level security;

create table if not exists public.mercado_presupuesto_log (
  id bigint generated always as identity primary key,
  creado_en timestamptz not null default now(),
  evento text not null,   -- freno_429 | degradado_on | recuperado |
                          -- sin_presupuesto
  detalle jsonb
);
alter table public.mercado_presupuesto_log enable row level security;

-- ── 3) Contador de la ventana móvil de 60 s (lo usa la puerta) ────
create or replace function public.mercado_qp_llamadas_60s()
returns int
language sql
stable
as $$
  select count(*)::int from public.mercado_llamadas_qp
  where creada_en > now() - interval '60 seconds';
$$;

-- ── 4) LA PUERTA «LECTURA AL MOMENTO» FIRMA EN EL LIBRO ───────────
-- Misma puerta de siempre (V1/V2) con dos candados nuevos: si el
-- presupuesto del minuto está en el tope (20), no dispara y devuelve
-- la foto previa con su edad (la app enseña el sello; jamás se finge
-- una lectura que no se hizo); al disparar, reserva sus 6 llamadas.
create or replace function public.mercado_lectura_momento(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_foto record;
  v_req bigint;
  v_usadas int;
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

  v_usadas := public.mercado_qp_llamadas_60s();
  if v_usadas >= 20 then
    return jsonb_build_object(
      'ok', true, 'disparada', false, 'motivo', 'presupuesto',
      'llamadas_60s', v_usadas,
      'foto', jsonb_build_object(
        'id', v_foto.id, 'recibida_en', v_foto.recibida_en,
        'edad_s', round(extract(epoch from (now() - v_foto.recibida_en))),
        'nivel20', v_foto.etecsa_nivel20,
        'top_venta', v_foto.etecsa_top_venta,
        'bankcup_promedio', v_foto.bankcup_promedio),
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

-- ── 5) EL CRON DEL CHORRO — APLICAR SOLO TRAS DESPLEGAR EL LECTOR
-- NUEVO (si corre contra el lector viejo, este ignora el cuerpo y
-- haría el pipeline entero cada minuto sin libro de presupuesto).
-- APLICADO EN VIVO el 2026-11-14: lector desplegado por CLI primero
-- y cron creado después — jobid 11 en cron.job, activo, primera foto
-- rápida 05:49:01 UTC; ventana de verificación de ~10 min con huecos
-- de 50–61 s entre fotos y la ventana móvil clavada en 6 llamadas.
-- select cron.schedule('mercado-lector-rapido-cada-1min', '* * * * *', $cmd$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets
--              where name = 'mercado_project_url')
--            || '/functions/v1/mercado-lector',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'x-mercado-cron', (select decrypted_secret from vault.decrypted_secrets
--                           where name = 'mercado_cron_secret')),
--     body := '{"modo":"rapido"}'::jsonb,
--     timeout_milliseconds := 90000);
-- $cmd$);

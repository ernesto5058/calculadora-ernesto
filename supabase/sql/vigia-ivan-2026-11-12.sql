-- =====================================================================
-- VIGÍA DE IVAN (2026-11-12, orden de Ernesto: «Primero vigilar a
-- Ivan») — estado y bitácora del vigía que sigue la actividad PÚBLICA
-- de @ivanleyva en el libro ETECSA (fotos de mercado_fotos con
-- detalle.ofertas_compra/venta nombradas, que el lector guarda desde
-- esta misma tanda).
--
--   vigia_ivan_estado   fila única id=1: última foto procesada, la
--                       posición confirmada de Ivan, el candidato
--                       pendiente de confirmación (regla de las dos
--                       fotos) y el último aviso por tipo
--                       (enfriamiento de 60 min).
--   vigia_ivan_eventos  bitácora: cada evento CONFIRMADO (aparece /
--                       cambia_tasa / cambia_tamano / desaparece) con
--                       su antes/después y si se avisó o por qué no.
--
-- RLS activo sin políticas: solo la llave de servicio (la Edge
-- Function vigia-ivan) toca estas tablas. Ni un dato privado de la
-- contraparte: solo su actividad pública en el tablón.
-- =====================================================================

create table if not exists public.vigia_ivan_estado (
  id             int primary key,
  armado         boolean not null default false,
  ultima_foto_id uuid,
  ultima_foto_en timestamptz,
  presente       boolean not null default false,
  lado           text,
  tasa           numeric,
  monto_qusd     numeric,
  monto_saldo    numeric,
  lado_secundario jsonb,
  pendiente      jsonb,
  ultimo_aviso   jsonb not null default '{}'::jsonb,
  actualizado_en timestamptz not null default now()
);

create table if not exists public.vigia_ivan_eventos (
  id              bigint generated always as identity primary key,
  creado_en       timestamptz not null default now(),
  foto_id         uuid,
  tipo            text not null,
  antes           jsonb,
  despues         jsonb,
  confirmado      boolean not null default true,
  avisado         boolean not null default false,
  motivo_no_aviso text,
  detalle         jsonb
);

create index if not exists vigia_ivan_eventos_creado_idx
  on public.vigia_ivan_eventos (creado_en desc);

alter table public.vigia_ivan_estado enable row level security;
alter table public.vigia_ivan_eventos enable row level security;

insert into public.vigia_ivan_estado (id) values (1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- VAULT: credencial del disparo pg_cron -> vigia-ivan (patrón oficial
-- de Supabase, el mismo del lector; la URL del proyecto ya vive en
-- Vault como 'mercado_project_url').
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'vigia_ivan_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'vigia_ivan_cron_secret',
      'Secreto compartido pg_cron -> funcion vigia-ivan');
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- SCHEDULING: cada 15 min, 2 minutos DESPUÉS del lector (que corre
-- en :00/:15/:30/:45), pa que la foto nueva ya esté guardada.
-- ---------------------------------------------------------------------
select cron.schedule('vigia-ivan-cada-15min', '2,17,32,47 * * * *', $cmd$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
             where name = 'mercado_project_url') || '/functions/v1/vigia-ivan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-vigia-ivan-cron', (select decrypted_secret from vault.decrypted_secrets
                            where name = 'vigia_ivan_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000);
$cmd$);

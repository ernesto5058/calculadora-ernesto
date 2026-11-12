-- =====================================================================
-- VIGÍA DE LOS VIGÍAS (2026-11-12 · estudio de huecos, HUECO 1)
-- Interruptor de hombre muerto pa los vigías críticos: cada uno deja
-- su última señal sana y la función vigia-cobrador (pg_cron cada
-- 5 min) avisa al dueño por «avisos» SOLO si uno cae o se recupera.
-- Aplicado en producción el 2026-11-12 vía Management API; este
-- archivo es el registro fiel de lo aplicado (fuente = verdad).
-- Los VALORES de los secretos jamás van aquí: viven en el vault de
-- Supabase ('vigia_cron_secret'), en los Secrets de Edge Functions
-- (VIGIA_CRON_SECRET / VIGIA_LATIDO_SECRET / VIGIA_GH_PAT) y en el
-- llavero de la casa (~/workspace/.secure/fn-secrets.env).
-- =====================================================================

create table if not exists public.vigia_estado (
  vigia text primary key,
  descripcion text not null,
  tipo text not null check (tipo in ('derivado','ping')),
  ventana_min int not null,
  ultimo_ok timestamptz,
  en_alerta boolean not null default false,
  ultimo_aviso timestamptz,
  creado_en timestamptz not null default now()
);
alter table public.vigia_estado enable row level security;
-- Sin políticas públicas: solo service_role (funciones) y SQL directo.

-- Señales que viven dentro de la propia base (las lee el cobrador):
-- foto del lector de Mercado y último run bueno del agrupador.
create or replace function public.vigia_senales_db()
returns jsonb
language sql
security definer
set search_path = public, cron
as $$
  select jsonb_build_object(
    'lector_ultima_foto', (select max(recibida_en) from public.mercado_fotos),
    'agrupador_ultimo_run', (select max(d.end_time) from cron.job_run_details d
                             join cron.job j on j.jobid = d.jobid
                             where j.jobname = 'agente-agrupar-horario' and d.status = 'succeeded')
  );
$$;
revoke all on function public.vigia_senales_db() from public, anon, authenticated;

insert into public.vigia_estado (vigia, descripcion, tipo, ventana_min, ultimo_ok) values
 ('lector-mercado','Lector de Mercado: foto del libro de QvaPay cada 15 min (Supabase)','derivado',35, now()),
 ('agrupador-agente','Agrupador horario de preguntas sin respuesta del Agente (Supabase)','derivado',150, now()),
 ('foto-mercado','Vigía horario de tarifas: foto del mercado cada hora (GitHub Actions)','derivado',300, now()),
 ('vigia-supabase','Toque diario anti-pausa de Supabase (GitHub Actions)','derivado',1560, now()),
 ('respaldo-diario','Respaldo diario de la base de datos (script local + espejo privado)','ping',1560, null),
 ('cobrador','El propio vigía de vigías (su latido se ve en esta tabla)','derivado',15, now())
on conflict (vigia) do nothing;
-- Nota: la ventana de foto-mercado nació en 150 y subió a 300 el mismo
-- día: GitHub entrega los schedule con huecos reales de 4-8 h (medido
-- 2026-11-12), y el workflow ganó un segundo pase (:37 cada 2 h).

-- El cobrador, cada 5 minutos (mismo patrón vault + header que el
-- lector de Mercado). El secreto 'vigia_cron_secret' se creó en el
-- vault con vault.create_secret(...) — valor solo en el llavero.
select cron.schedule('vigia-cobrador-cada-5min', '*/5 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
             where name = 'mercado_project_url') || '/functions/v1/vigia-cobrador',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-vigia-cron', (select decrypted_secret from vault.decrypted_secrets
                          where name = 'vigia_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000);
$$);

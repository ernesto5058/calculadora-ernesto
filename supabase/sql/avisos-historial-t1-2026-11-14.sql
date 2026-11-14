-- =====================================================================
-- T1 · MI NEGOCIO PANEL ÚNICO (2026-11-14) — el centro de avisos EN la
-- app necesita LEER el registro: nace la puerta avisos_historial.
-- Patrón de la casa (avisos-pro-2026-11-13.sql): valida el código
-- admin DENTRO contra admin_config, security definer, search_path
-- fijado, revoke a public + grant a anon/authenticated (la puerta
-- valida; PostgREST solo transporta).
-- Devuelve las filas del dueño (para='ADMIN') más recientes: qué se
-- avisó, por qué canal, con qué resultado y cuándo. Sin cuerpos
-- completos ni destinos: el centro enseña el registro, no datos de
-- aparatos. Idempotente: create or replace.
-- =====================================================================

create or replace function public.avisos_historial(p_codigo text, p_limite int default 30)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_lim int := least(greatest(coalesce(p_limite, 30), 1), 60);
  v_out jsonb;
begin
  if not exists (select 1 from public.admin_config
                  where clave = 'codigo_admin' and valor = p_codigo) then
    raise exception 'no autorizado';
  end if;

  select coalesce(jsonb_agg(fila order by fila.creado_en desc), '[]'::jsonb)
    into v_out
  from (
    select jsonb_build_object(
             'id', l.id,
             'creado_en', l.creado_en,
             'evento_tipo', l.evento_tipo,
             'titulo', l.titulo,
             'canal', l.canal,
             'resultado', l.resultado,
             'motivo', l.motivo,
             'es_prueba', l.es_prueba
           ) as fila,
           l.creado_en as creado_en
      from public.avisos_log l
     where l.para = 'ADMIN'
     order by l.creado_en desc
     limit v_lim
  ) s;

  return jsonb_build_object('ok', true, 'avisos', v_out);
end;
$fn$;

revoke all on function public.avisos_historial(text, int) from public;
grant execute on function public.avisos_historial(text, int) to anon, authenticated;

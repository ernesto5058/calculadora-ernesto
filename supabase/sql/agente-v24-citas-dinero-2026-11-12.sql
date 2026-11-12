-- =====================================================================
-- AGENTE v2.4 — CIERRE de citas y DINERO del dueño (2026-11-12)
--
-- Pedido de Ernesto en vivo (11:29, tras confirmar su cita de prueba):
-- «¿cómo veo la entrada y la salida de dinero por cada cita, si mi
-- cliente vino o no, cómo hago todo eso, tener el control?»
--
-- 1) Columnas de CIERRE en agente_citas: la asistencia y el pago se
--    anotan UNA vez, al cerrar una cita CONFIRMADA. El resumen de
--    dinero se CALCULA de estas filas en vivo; jamás se guarda aparte.
-- 2) Puerta ÚNICA de escritura del cierre: agente_cita_cerrar, hermana
--    de agente_cita_decidir (misma validación de dueño, misma
--    auditoría en agente_acciones, idempotente: un segundo toque
--    devuelve «ya_cerrada» con lo guardado y NO sobrescribe).
-- =====================================================================

alter table public.agente_citas
  add column if not exists asistencia  text,        -- vino | no_vino
  add column if not exists pago_monto  numeric,     -- CUP, solo si vino
  add column if not exists pago_metodo text,        -- efectivo | transferencia
  add column if not exists cerrada_en  timestamptz;

create or replace function public.agente_cita_cerrar(
  p_chat_id text, p_id uuid, p_vino boolean,
  p_monto numeric default null, p_metodo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v public.agente_citas%rowtype;
begin
  if not public.agente_chat_es_dueno(p_chat_id) then
    return jsonb_build_object('ok', false, 'error', 'no_dueno');
  end if;
  select * into v from public.agente_citas where id = p_id;
  if v.id is null then
    return jsonb_build_object('ok', false, 'error', 'no_existe');
  end if;
  if v.asistencia is not null then
    return jsonb_build_object('ok', true, 'ya_cerrada', true,
      'asistencia', v.asistencia, 'pago_monto', v.pago_monto,
      'pago_metodo', v.pago_metodo, 'estado', v.estado);
  end if;
  if v.estado <> 'confirmada' then
    return jsonb_build_object('ok', false, 'error', 'no_confirmada',
      'estado', v.estado);
  end if;
  if p_vino then
    if p_monto is null or p_monto <= 0 or p_monto > 1000000 then
      return jsonb_build_object('ok', false, 'error', 'monto_invalido');
    end if;
    if p_metodo is null or p_metodo not in ('efectivo', 'transferencia') then
      return jsonb_build_object('ok', false, 'error', 'metodo_invalido');
    end if;
    update public.agente_citas
       set asistencia = 'vino', pago_monto = p_monto,
           pago_metodo = p_metodo, cerrada_en = now()
     where id = p_id;
  else
    update public.agente_citas
       set asistencia = 'no_vino', pago_monto = null,
           pago_metodo = null, cerrada_en = now()
     where id = p_id;
  end if;
  insert into public.agente_acciones (tipo, detalle)
  values ('cita_cerrada', jsonb_build_object(
    'cita', p_id, 'vino', p_vino, 'nombre', v.nombre,
    'dia', v.dia, 'hora', v.hora,
    'pago_monto', case when p_vino then p_monto else null end,
    'pago_metodo', case when p_vino then p_metodo else null end));
  return jsonb_build_object('ok', true,
    'asistencia', case when p_vino then 'vino' else 'no_vino' end,
    'nombre', v.nombre, 'dia', v.dia, 'hora', v.hora,
    'servicio', v.servicio,
    'pago_monto', case when p_vino then p_monto else null end,
    'pago_metodo', case when p_vino then p_metodo else null end);
end;
$$;
revoke all on function public.agente_cita_cerrar(text, uuid, boolean, numeric, text) from public;
grant execute on function public.agente_cita_cerrar(text, uuid, boolean, numeric, text) to service_role;

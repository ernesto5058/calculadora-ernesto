-- =====================================================================
-- REPARTO DE CAPITAL (Mi Negocio v27 · 2026-11-15)
-- Fase 2 del capital + devolución desde Mi Trabajo (enmienda):
--  · dinero_entregar_capital: entrega con puerta de admin, idempotente
--    por cliente_id; sale de la mano de Ernesto (inversión primero,
--    fondo pa el resto) y entra a cupo:<BUSCADOR>, con su fila en
--    dinero_entregas pa que el FIFO de devoluciones siga cuadrando.
--  · dinero_registrar_devolucion_efectivo: recreada con p_es_cierre y
--    p_cliente_id (idempotente); valida contra lo DEVOLVIBLE (mano
--    menos solicitudes pendientes), no contra la mano cruda.
--  · dinero_confirmar_recibido: mismo contrato + re-confirmar devuelve
--    ok (riel del outbox) + guarda de saldo antes de mover.
--  · dinero_rechazar_devolucion: la solicitud se rechaza sin mover
--    un peso; el estado 'rechazada' entra al CHECK.
--  · dinero_cupo_resumen / dinero_capital_estado: la verdad del cupo
--    en un solo objeto (en mano · pendientes · devolvible ·
--    trabajando · cerrado) pa las dos apps.
-- =====================================================================

alter table public.dinero_devoluciones add column if not exists es_cierre boolean not null default false;
alter table public.dinero_devoluciones add column if not exists cliente_id text;
alter table public.dinero_devoluciones add column if not exists rechazada_en timestamptz;
alter table public.dinero_entregas add column if not exists cliente_id text;
create unique index if not exists dinero_devoluciones_cliente_id_uq
  on public.dinero_devoluciones (cliente_id) where cliente_id is not null;
create unique index if not exists dinero_entregas_cliente_id_uq
  on public.dinero_entregas (cliente_id) where cliente_id is not null;
alter table public.dinero_devoluciones drop constraint dinero_devoluciones_estado_check;
alter table public.dinero_devoluciones add constraint dinero_devoluciones_estado_check
  check (estado in ('pendiente','confirmada','rechazada'));

-- ---------- resumen del cupo de un buscador ----------
create or replace function public.dinero_cupo_resumen(p_buscador text, p_prueba boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_busc text := upper(trim(p_buscador));
  v_prueba boolean := coalesce(p_prueba, false);
  v_mano bigint; v_pend bigint; v_trab bigint; v_ult_cierre timestamptz;
  v_cerrado boolean;
begin
  v_mano := public.dinero_saldo('cupo:'||v_busc, v_prueba);
  select coalesce(sum(monto),0) into v_pend from public.dinero_devoluciones
   where buscador_codigo = v_busc and es_prueba = v_prueba
     and tipo = 'efectivo' and estado = 'pendiente';
  select coalesce(sum(monto_pendiente),0) into v_trab from public.dinero_entregas
   where buscador_codigo = v_busc and es_prueba = v_prueba
     and estado in ('entregado','en_calle');
  select max(confirmada_en) into v_ult_cierre from public.dinero_devoluciones
   where buscador_codigo = v_busc and es_prueba = v_prueba
     and tipo = 'efectivo' and estado = 'confirmada' and es_cierre;
  v_cerrado := v_mano = 0 and v_trab = 0 and v_pend = 0 and v_ult_cierre is not null
    and not exists (select 1 from public.dinero_entregas
                     where buscador_codigo = v_busc and es_prueba = v_prueba
                       and entregado_en > v_ult_cierre);
  return jsonb_build_object(
    'en_mano', v_mano, 'pendientes', v_pend,
    'devolvible', v_mano - v_pend, 'trabajando', v_trab,
    'cerrado', v_cerrado);
end $$;

-- ---------- la entrega de capital (puerta de Ernesto) ----------
create or replace function public.dinero_entregar_capital(
  p_codigo text, p_buscador text, p_monto numeric,
  p_bolsillo text default 'efectivo', p_cliente_id text default null,
  p_prueba boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_monto bigint := public.dinero_entero(p_monto, 'entrega');
  v_busc text := upper(trim(p_buscador));
  v_prueba boolean := coalesce(p_prueba, false);
  v_id uuid; v_inv bigint; v_fon bigint; v_desde_inv bigint; v_desde_fon bigint;
begin
  if not public.dinero_es_admin(p_codigo) then raise exception 'codigo admin no valido'; end if;
  if p_bolsillo not in ('efectivo','transferencia') then raise exception 'bolsillo invalido'; end if;
  if v_monto % 500 <> 0 then
    raise exception 'monto no cerrado: toda entrega a un buscador debe ser multiplo de 500 (regla de billetes); % no lo es', v_monto;
  end if;
  if p_cliente_id is not null then
    select id into v_id from public.dinero_entregas where cliente_id = p_cliente_id;
    if found then return jsonb_build_object('ok', true, 'entrega', v_id, 'repetida', true); end if;
  end if;
  if not v_prueba and not exists (select 1 from public.usuarios where codigo = v_busc and activo) then
    raise exception 'buscador no existe o inactivo';
  end if;
  v_inv := public.dinero_saldo('ernesto_inversion', v_prueba);
  v_fon := public.dinero_saldo('fondo', v_prueba);
  if v_inv + v_fon < v_monto then
    raise exception 'tu mano no alcanza: tienes % en mano y la entrega es %', v_inv + v_fon, v_monto;
  end if;
  insert into public.dinero_entregas (buscador_codigo, monto_original, monto_pendiente, bolsillo, es_prueba, cliente_id)
  values (v_busc, v_monto, v_monto, p_bolsillo, v_prueba, p_cliente_id) returning id into v_id;
  v_desde_inv := least(v_monto, greatest(v_inv, 0));
  v_desde_fon := v_monto - v_desde_inv;
  if v_desde_inv > 0 then
    perform public.dinero_mover('ernesto_inversion','entrega', -v_desde_inv, p_bolsillo, v_id::text, v_busc, v_prueba);
  end if;
  if v_desde_fon > 0 then
    perform public.dinero_mover('fondo','entrega', -v_desde_fon, p_bolsillo, v_id::text, v_busc, v_prueba);
  end if;
  perform public.dinero_mover('cupo:'||v_busc,'entrega', v_monto, p_bolsillo, v_id::text, null, v_prueba);
  return jsonb_build_object('ok', true, 'entrega', v_id, 'en_mano', v_inv + v_fon - v_monto);
end $$;

-- ---------- la solicitud de devolución (buscador o admin) ----------
drop function public.dinero_registrar_devolucion_efectivo(text, text, numeric, text, boolean);
create or replace function public.dinero_registrar_devolucion_efectivo(
  p_codigo text, p_buscador text, p_monto numeric, p_medio text default 'efectivo',
  p_prueba boolean default false, p_es_cierre boolean default false,
  p_cliente_id text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_monto bigint := public.dinero_entero(p_monto, 'devolucion');
  v_busc text := upper(trim(p_buscador));
  v_prueba boolean := coalesce(p_prueba, false);
  v_id uuid; v_estado text; v_disp bigint;
begin
  if not public.dinero_es_admin(p_codigo)
     and not exists (select 1 from public.validar_usuario(p_codigo) v where v.codigo = v_busc) then
    raise exception 'sin permiso';
  end if;
  if p_medio not in ('efectivo','transferencia') then raise exception 'medio invalido'; end if;
  if p_cliente_id is not null then
    select id, estado into v_id, v_estado from public.dinero_devoluciones where cliente_id = p_cliente_id;
    if found then
      return jsonb_build_object('ok', true, 'devolucion', v_id, 'estado', v_estado, 'repetida', true);
    end if;
  end if;
  v_disp := (public.dinero_cupo_resumen(v_busc, v_prueba) ->> 'devolvible')::bigint;
  if v_disp < v_monto then raise exception 'la devolucion supera el dinero en su mano'; end if;
  insert into public.dinero_devoluciones (buscador_codigo, tipo, monto, medio, es_prueba, es_cierre, cliente_id)
  values (v_busc, 'efectivo', v_monto, p_medio, v_prueba, coalesce(p_es_cierre, false), p_cliente_id)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'devolucion', v_id, 'estado', 'pendiente');
end $$;

-- ---------- confirmar «Recibido» (idempotente + guarda de saldo) ----------
create or replace function public.dinero_confirmar_recibido(p_codigo text, p_devolucion uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_d record; v_e record; v_rest bigint;
begin
  if not public.dinero_es_admin(p_codigo) then raise exception 'codigo admin no valido'; end if;
  select * into v_d from public.dinero_devoluciones where id = p_devolucion;
  if not found then raise exception 'devolucion no existe'; end if;
  if v_d.estado = 'confirmada' then
    return jsonb_build_object('ok', true, 'estado', 'confirmada', 'repetida', true);
  end if;
  if v_d.tipo <> 'efectivo' or v_d.estado <> 'pendiente' then
    raise exception 'esta devolucion no esta pendiente de recibo';
  end if;
  if public.dinero_saldo('cupo:'||v_d.buscador_codigo, v_d.es_prueba) < v_d.monto then
    raise exception 'el buscador ya no tiene ese dinero en su mano';
  end if;
  perform public.dinero_mover('cupo:'||v_d.buscador_codigo,'devolucion_efectivo', -v_d.monto, v_d.medio, v_d.id::text, null, v_d.es_prueba);
  perform public.dinero_mover('ernesto_inversion','devolucion_efectivo', v_d.monto, v_d.medio, v_d.id::text, v_d.buscador_codigo, v_d.es_prueba);
  update public.dinero_devoluciones set estado = 'confirmada', confirmada_en = now() where id = v_d.id;
  v_rest := v_d.monto;
  for v_e in select * from public.dinero_entregas
             where buscador_codigo = v_d.buscador_codigo and es_prueba = v_d.es_prueba
               and estado in ('entregado','en_calle') and monto_pendiente > 0
             order by entregado_en loop
    exit when v_rest <= 0;
    if v_e.monto_pendiente <= v_rest then
      v_rest := v_rest - v_e.monto_pendiente;
      update public.dinero_entregas set monto_pendiente = 0, estado = 'devuelto_efectivo', devuelto_en = now() where id = v_e.id;
    else
      update public.dinero_entregas set monto_pendiente = monto_pendiente - v_rest where id = v_e.id;
      v_rest := 0;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'estado', 'confirmada');
end $$;

-- ---------- rechazar la solicitud (sin mover un peso) ----------
create or replace function public.dinero_rechazar_devolucion(p_codigo text, p_devolucion uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_d record;
begin
  if not public.dinero_es_admin(p_codigo) then raise exception 'codigo admin no valido'; end if;
  select * into v_d from public.dinero_devoluciones where id = p_devolucion;
  if not found then raise exception 'devolucion no existe'; end if;
  if v_d.estado = 'rechazada' then
    return jsonb_build_object('ok', true, 'estado', 'rechazada', 'repetida', true);
  end if;
  if v_d.estado <> 'pendiente' then raise exception 'esta devolucion no esta pendiente'; end if;
  update public.dinero_devoluciones set estado = 'rechazada', rechazada_en = now() where id = v_d.id;
  return jsonb_build_object('ok', true, 'estado', 'rechazada');
end $$;

-- ---------- la foto del capital pa la pantalla de reparto ----------
create or replace function public.dinero_capital_estado(p_codigo text, p_prueba boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_prueba boolean := coalesce(p_prueba, false);
  v_fon bigint; v_inv bigint;
begin
  if not public.dinero_es_admin(p_codigo) then raise exception 'codigo admin no valido'; end if;
  v_fon := public.dinero_saldo('fondo', v_prueba);
  v_inv := public.dinero_saldo('ernesto_inversion', v_prueba);
  return jsonb_build_object(
    'fondo', v_fon, 'inversion', v_inv, 'en_mano', v_fon + v_inv,
    'cupos', (select coalesce(jsonb_agg(jsonb_build_object(
        'buscador', u.codigo, 'nombre', u.nombre,
        'resumen', public.dinero_cupo_resumen(u.codigo, v_prueba)) order by u.codigo), '[]'::jsonb)
      from public.usuarios u
      where u.activo and (v_prueba or u.codigo <> 'PEUEBA')),
    'solicitudes', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'buscador', d.buscador_codigo, 'nombre', u.nombre,
        'monto', d.monto, 'medio', d.medio, 'es_cierre', d.es_cierre,
        'creada_en', d.creada_en) order by d.creada_en), '[]'::jsonb)
      from public.dinero_devoluciones d
      left join public.usuarios u on u.codigo = d.buscador_codigo
      where d.es_prueba = v_prueba and d.tipo = 'efectivo' and d.estado = 'pendiente'));
end $$;

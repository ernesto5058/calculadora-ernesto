-- ============================================================
-- TANDA «CHAT DE BUSCADORES PRO» · Servidor · 2026-11-18
-- Todo ADITIVO, sin romper ninguna firma existente:
--   · tabla chat_partes + parte_crear / parte_confirmar /
--     parte_rechazar / parte_leer
--   · enviar_mensaje_todos (difusión del dueño, fan-out 1-a-1)
--   · enviar_mensaje acepta adj_tipo 'tarifa' | 'tarifa_viva' |
--     'parte' (snapshot JSON en adj_datos, sin adj_normalizar)
--   · leer_chat expone fijado_tipo + fijado_id (claves nuevas,
--     ninguna existente se quita ni cambia)
-- Convenciones espejadas de las definiciones VIVAS (2026-11-18):
--   · buscador: validar_usuario(p_codigo) como espera_crear_app
--     (código = credencial; activo y no bloqueado).
--   · dueño: admin_es_valido(p_codigo) / chat_identidad('ADMIN',
--     p_clave) como fijar_mensaje y admin_usuarios (el código de
--     dueño ES su clave, vive en admin_config).
--   · dedupe por p_op_id como enviar_mensaje.
--   · la espera nace SOLO por espera_crear_interna_v2 con los
--     mismos cálculos de espera_crear_app (cantidad, tasa
--     unitaria, envíos, origen 'reporte' — el CHECK de
--     dinero_esperas.origen solo admite 'reporte' y
--     'operado_ernesto') y la MISMA regla de efectivo libre
--     (espera_pendiente_entregas − Σ capital_cup de abiertas).
-- DESVIACIÓN documentada del contrato: parte_crear gana un
-- parámetro OPCIONAL al final, p_buscador text default null.
-- La firma congelada no trae forma de nombrar al buscador
-- cuando quien llama es el dueño (p_codigo = código de dueño);
-- sin él, el parte del dueño nacería sin buscador. Con default
-- null la firma congelada funciona tal cual pa el buscador, y
-- el dueño pasa p_buscador = el código de su conversación.
-- ============================================================

create table if not exists public.chat_partes (
  id uuid primary key default gen_random_uuid(),
  buscador text not null,
  tipo text not null check (tipo in ('saldo', 'transferencia')),
  tasa numeric not null,
  total_pagado numeric not null,
  telefono text,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmada', 'rechazada')),
  op_id text unique,
  mensaje_id bigint references public.mensajes(id),
  espera_id uuid references public.dinero_esperas(id),
  creado_en timestamptz not null default now(),
  confirmado_en timestamptz,
  motivo_rechazo text
);

create index if not exists chat_partes_buscador_idx
  on public.chat_partes (buscador, creado_en desc);

alter table public.chat_partes enable row level security;
-- Sin políticas: como el resto del libro, solo entra el SECURITY DEFINER.

-- ------------------------------------------------------------
-- INTERNO · validación + cálculo, espejo exacto de
-- espera_crear_app (misma regla de efectivo libre, mismo orden
-- de chequeos, mismos motivos). SOLO LEE: no escribe nada.
-- Devuelve además cantidad/tasa_unitaria/envíos calculados.
-- ------------------------------------------------------------
create or replace function public.parte_validar_libre(
  p_buscador text, p_tipo text, p_tasa numeric, p_total_pagado bigint)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_mano bigint;
  v_comp bigint;
  v_libre bigint;
  v_cantidad numeric;
  v_tasa_unitaria numeric;
  v_envios integer;
begin
  if p_tipo not in ('saldo', 'transferencia') then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_invalido');
  end if;
  if p_tasa is null or p_tasa <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'tasa_invalida');
  end if;
  if p_total_pagado is null or p_total_pagado <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'total_invalido');
  end if;

  v_mano := public.espera_pendiente_entregas(p_buscador, false);
  select coalesce(sum(capital_cup), 0)::bigint into v_comp
    from public.dinero_esperas
   where buscador_codigo = p_buscador and es_prueba = false
     and estado = 'abierta';
  v_libre := greatest(v_mano - v_comp, 0);
  if p_total_pagado > v_libre then
    return jsonb_build_object('ok', false, 'motivo', 'supera_tu_efectivo',
      'en_mano', v_mano, 'comprometido', v_comp, 'libre', v_libre);
  end if;

  if p_tipo = 'saldo' then
    v_cantidad := round(p_total_pagado / p_tasa * 360.0, 2);
    v_tasa_unitaria := round(p_tasa / 360.0, 4);
    v_envios := greatest(1, round(v_cantidad / 360.0)::integer);
  else
    if p_tasa > 200 then
      return jsonb_build_object('ok', false, 'motivo', 'tasa_invalida');
    end if;
    v_cantidad := round(p_total_pagado * (1 + p_tasa / 100.0), 2);
    v_tasa_unitaria := null;
    v_envios := null;
  end if;
  if v_cantidad is null or v_cantidad <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;

  return jsonb_build_object('ok', true,
    'libre', v_libre, 'cantidad_esperada', v_cantidad,
    'tasa_unitaria', v_tasa_unitaria, 'envios', v_envios);
end;
$function$;

-- ------------------------------------------------------------
-- INTERNO · crea la espera de un parte ya atribuido a un
-- buscador, por la lógica interna de espera_crear_app
-- (validar_libre + espera_crear_interna_v2, ventana 48 h,
-- origen 'reporte', sin prueba). Misma forma de respuesta.
-- ------------------------------------------------------------
create or replace function public.parte_crear_espera_interna(
  p_buscador text, p_tipo text, p_tasa numeric,
  p_total_pagado bigint, p_telefono text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_val jsonb;
  v_res jsonb;
begin
  v_val := public.parte_validar_libre(p_buscador, p_tipo, p_tasa, p_total_pagado);
  if not coalesce((v_val ->> 'ok')::boolean, false) then
    return v_val;
  end if;

  v_res := public.espera_crear_interna_v2(
    p_buscador, p_tipo, (v_val ->> 'cantidad_esperada')::numeric,
    p_total_pagado, 'reporte', null, p_telefono, 48, false,
    (v_val ->> 'tasa_unitaria')::numeric, p_total_pagado,
    (v_val ->> 'envios')::integer);

  return coalesce(v_res, jsonb_build_object('ok', false, 'motivo', 'sin_respuesta'))
         || jsonb_build_object('cantidad_esperada', (v_val ->> 'cantidad_esperada')::numeric,
                               'libre', (v_val ->> 'libre')::bigint);
end;
$function$;

revoke all on function public.parte_validar_libre(text, text, numeric, bigint) from public;
revoke all on function public.parte_crear_espera_interna(text, text, numeric, bigint, text) from public;
grant execute on function public.parte_validar_libre(text, text, numeric, bigint) to service_role;
grant execute on function public.parte_crear_espera_interna(text, text, numeric, bigint, text) to service_role;

-- ------------------------------------------------------------
-- parte_crear · el parte nace como fila + mensaje-tarjeta en
-- el hilo (de=buscador, para=ADMIN, adj_tipo='parte').
-- Idempotente por p_op_id. p_confirmada=true SOLO lo honra el
-- dueño (y entonces la espera nace en la misma transacción);
-- un buscador que lo pase lo ve ignorado (nace pendiente).
-- ------------------------------------------------------------
create or replace function public.parte_crear(
  p_codigo text, p_tipo text, p_tasa numeric, p_total_pagado bigint,
  p_telefono text default null, p_op_id text default null,
  p_confirmada boolean default false, p_buscador text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_dueno boolean := public.admin_es_valido(p_codigo);
  v_u record;
  v_busc text;
  v_existe record;
  v_val jsonb;
  v_esp jsonb;
  v_parte_id uuid := gen_random_uuid();
  v_estado text := 'pendiente';
  v_espera_id uuid;
  v_msg_id bigint;
  v_snapshot jsonb;
begin
  -- ¿Quién llama? Dueño (su código ES la clave, convención de
  -- fijar_mensaje/admin_usuarios) o buscador (validar_usuario,
  -- convención de espera_crear_app).
  if v_dueno then
    if p_buscador is null or trim(p_buscador) = '' then
      return jsonb_build_object('ok', false, 'motivo', 'buscador_requerido');
    end if;
    select * into v_u from public.validar_usuario(p_buscador) limit 1;
    if v_u.codigo is null or not v_u.activo or v_u.bloqueado then
      return jsonb_build_object('ok', false, 'motivo', 'buscador_no_valido');
    end if;
    v_busc := v_u.codigo;
  else
    select * into v_u from public.validar_usuario(p_codigo) limit 1;
    if v_u.codigo is null or not v_u.activo or v_u.bloqueado then
      return jsonb_build_object('ok', false, 'motivo', 'codigo_no_valido');
    end if;
    v_busc := v_u.codigo;
    if p_buscador is not null
       and upper(trim(p_buscador)) <> v_busc then
      return jsonb_build_object('ok', false, 'motivo', 'buscador_no_valido');
    end if;
    -- Un buscador jamás se auto-confirma.
    p_confirmada := false;
  end if;

  -- Idempotencia por op_id: repetir devuelve la misma fila.
  if p_op_id is not null then
    select id, estado, espera_id into v_existe
      from public.chat_partes where op_id = p_op_id;
    if v_existe.id is not null then
      return jsonb_build_object('ok', true, 'parte_id', v_existe.id,
        'estado', v_existe.estado, 'espera_id', v_existe.espera_id,
        'repetida', true);
    end if;
  end if;

  -- Validación contra el efectivo libre SIN escribir nada.
  v_val := public.parte_validar_libre(v_busc, p_tipo, p_tasa, p_total_pagado);
  if not coalesce((v_val ->> 'ok')::boolean, false) then
    return v_val;
  end if;

  begin
    insert into public.chat_partes
      (id, buscador, tipo, tasa, total_pagado, telefono, estado, op_id)
    values
      (v_parte_id, v_busc, p_tipo, p_tasa, p_total_pagado,
       nullif(trim(coalesce(p_telefono, '')), ''), 'pendiente', p_op_id);

    if v_dueno and coalesce(p_confirmada, false) then
      v_esp := public.parte_crear_espera_interna(
        v_busc, p_tipo, p_tasa, p_total_pagado, p_telefono);
      if not coalesce((v_esp ->> 'ok')::boolean, false) then
        -- La validación ya pasó en esta misma transacción; si la
        -- interna falla, que no nazca un parte a medias.
        raise exception 'no se pudo crear la espera: %',
          coalesce(v_esp ->> 'motivo', 'sin_respuesta');
      end if;
      v_espera_id := (v_esp ->> 'espera_id')::uuid;
      v_estado := 'confirmada';
      update public.chat_partes
         set estado = 'confirmada', espera_id = v_espera_id,
             confirmado_en = now()
       where id = v_parte_id;
    end if;

    v_snapshot := jsonb_build_object(
      'parte_id', v_parte_id, 'tipo', p_tipo, 'tasa', p_tasa,
      'total_pagado', p_total_pagado, 'telefono', p_telefono,
      'estado', v_estado);

    insert into public.mensajes
      (de, para, texto, adj_tipo, adj_nombre, adj_mime, adj_bytes,
       adj_datos, op_id)
    values
      (v_busc, 'ADMIN', '', 'parte', null, 'application/json', null,
       v_snapshot::text, p_op_id)
    returning id into v_msg_id;

    update public.chat_partes set mensaje_id = v_msg_id
     where id = v_parte_id;
  exception when unique_violation then
    -- Doble subida del mismo op_id a la vez: gana la que entró.
    select id, estado, espera_id into v_existe
      from public.chat_partes where op_id = p_op_id;
    if v_existe.id is not null then
      return jsonb_build_object('ok', true, 'parte_id', v_existe.id,
        'estado', v_existe.estado, 'espera_id', v_existe.espera_id,
        'repetida', true);
    end if;
    raise;
  end;

  return jsonb_build_object('ok', true, 'parte_id', v_parte_id,
    'estado', v_estado, 'espera_id', v_espera_id, 'repetida', false);
end;
$function$;

-- ------------------------------------------------------------
-- parte_confirmar · SOLO el dueño, SOLO desde pendiente.
-- Crea UNA espera (lógica interna de espera_crear_app);
-- re-confirmar devuelve la misma espera con repetida=true.
-- La autorización acepta las dos formas vivas de la casa:
-- p_codigo = código de dueño (fijar_mensaje) o p_codigo =
-- 'ADMIN' con p_clave = código de dueño (leer_chat).
-- ------------------------------------------------------------
create or replace function public.parte_confirmar(
  p_codigo text, p_clave text, p_parte_id uuid, p_op_id text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_p record;
  v_esp jsonb;
begin
  if not (public.admin_es_valido(p_codigo)
          or public.admin_es_valido(p_clave)) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  select * into v_p from public.chat_partes
   where id = p_parte_id for update;
  if v_p.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'parte_no_existe');
  end if;
  if v_p.estado = 'confirmada' then
    return jsonb_build_object('ok', true, 'espera_id', v_p.espera_id,
      'repetida', true);
  end if;
  if v_p.estado = 'rechazada' then
    return jsonb_build_object('ok', false, 'motivo', 'parte_rechazada');
  end if;

  v_esp := public.parte_crear_espera_interna(
    v_p.buscador, v_p.tipo, v_p.tasa,
    round(v_p.total_pagado)::bigint, v_p.telefono);
  if not coalesce((v_esp ->> 'ok')::boolean, false) then
    return v_esp;
  end if;

  update public.chat_partes
     set estado = 'confirmada',
         espera_id = (v_esp ->> 'espera_id')::uuid,
         confirmado_en = now()
   where id = v_p.id and estado = 'pendiente';

  return jsonb_build_object('ok', true,
    'espera_id', (v_esp ->> 'espera_id')::uuid, 'repetida', false);
end;
$function$;

-- ------------------------------------------------------------
-- parte_rechazar · SOLO el dueño; pendiente → rechazada con
-- motivo. Idempotente. Una confirmada no se rechaza.
-- ------------------------------------------------------------
create or replace function public.parte_rechazar(
  p_codigo text, p_clave text, p_parte_id uuid,
  p_motivo text default null, p_op_id text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_p record;
begin
  if not (public.admin_es_valido(p_codigo)
          or public.admin_es_valido(p_clave)) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  select * into v_p from public.chat_partes
   where id = p_parte_id for update;
  if v_p.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'parte_no_existe');
  end if;
  if v_p.estado = 'rechazada' then
    return jsonb_build_object('ok', true, 'repetida', true);
  end if;
  if v_p.estado = 'confirmada' then
    return jsonb_build_object('ok', false, 'motivo', 'ya_confirmada');
  end if;

  update public.chat_partes
     set estado = 'rechazada', motivo_rechazo = p_motivo
   where id = v_p.id and estado = 'pendiente';

  return jsonb_build_object('ok', true, 'repetida', false);
end;
$function$;

-- ------------------------------------------------------------
-- parte_leer · el estado vivo del parte (la tarjeta se
-- refresca con esto; el snapshot del mensaje es la foto del
-- nacimiento). Autoriza al buscador dueño del parte y al dueño.
-- ------------------------------------------------------------
create or replace function public.parte_leer(
  p_codigo text, p_parte_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_p record;
begin
  select * into v_p from public.chat_partes where id = p_parte_id;
  if v_p.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'parte_no_existe');
  end if;
  if not (public.admin_es_valido(p_codigo)
          or upper(trim(coalesce(p_codigo, ''))) = v_p.buscador) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  return jsonb_build_object(
    'ok', true,
    'id', v_p.id, 'estado', v_p.estado, 'tipo', v_p.tipo,
    'tasa', v_p.tasa, 'total_pagado', v_p.total_pagado,
    'telefono', v_p.telefono, 'espera_id', v_p.espera_id,
    'creado_en', v_p.creado_en, 'confirmado_en', v_p.confirmado_en,
    'motivo_rechazo', v_p.motivo_rechazo);
end;
$function$;

-- ------------------------------------------------------------
-- enviar_mensaje_todos · difusión del dueño: una fila en
-- mensajes por pareja (de=ADMIN, para=cada buscador ACTIVO —
-- la noción de activo de admin_usuarios), así leer_chat, ticks
-- y fijado por pareja quedan intactos. Dedupe por
-- (p_op_id, para): el op_id guardado es p_op_id || '#' || para
-- (mensajes.op_id es único global). Devuelve los NUEVOS.
-- ------------------------------------------------------------
create or replace function public.enviar_mensaje_todos(
  p_codigo text, p_clave text, p_texto text,
  p_adj_tipo text default null, p_adj_datos text default null,
  p_adj_nombre text default null, p_adj_mime text default null,
  p_adj_tam integer default null, p_op_id text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_texto text;
  v_adj_datos text;
  v_adj_mime text;
  v_bytes bigint;
  v_es_json boolean;
  v_u record;
  v_op text;
  v_mid bigint;
  v_enviados integer := 0;
begin
  if not (public.admin_es_valido(p_codigo)
          or public.admin_es_valido(p_clave)) then
    return jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
  end if;

  v_texto := left(btrim(coalesce(p_texto, '')), 500);
  v_es_json := p_adj_tipo in ('tarifa', 'tarifa_viva', 'parte');

  if p_adj_datos is not null and p_adj_datos <> '' then
    if v_es_json then
      v_adj_datos := p_adj_datos;
      v_adj_mime := coalesce(nullif(p_adj_mime, ''), 'application/json');
      v_bytes := length(p_adj_datos)::bigint;
    elsif p_adj_tipo is null or p_adj_tipo not in ('foto', 'archivo', 'voz') then
      raise exception 'adjunto no valido';
    else
      select o_datos, o_mime, o_bytes
        into v_adj_datos, v_adj_mime, v_bytes
        from public.adj_normalizar(p_adj_tipo, p_adj_mime, p_adj_datos);
    end if;
  elsif v_es_json then
    v_adj_datos := '{}';
    v_adj_mime := 'application/json';
    v_bytes := 2;
  elsif v_texto = '' then
    raise exception 'mensaje vacio';
  end if;

  perform public.barrer_temporales();

  for v_u in
    select u.codigo from public.usuarios u
     where u.activo = true
     order by u.codigo
  loop
    v_op := case when p_op_id is null then null
                 else p_op_id || '#' || v_u.codigo end;
    v_mid := null;
    insert into public.mensajes
      (de, para, texto, adj_tipo, adj_nombre, adj_mime, adj_bytes,
       adj_datos, op_id)
    values (
      'ADMIN', v_u.codigo, v_texto,
      case when v_bytes is null then null else p_adj_tipo end,
      case when v_bytes is null then null
           else left(coalesce(p_adj_nombre,
             case when v_es_json then p_adj_tipo else 'archivo' end), 120) end,
      case when v_bytes is null then null else v_adj_mime end,
      case when v_bytes is null then null else v_bytes end,
      case when v_bytes is null then null else v_adj_datos end,
      v_op)
    on conflict (op_id) where op_id is not null do nothing
    returning id into v_mid;
    if v_mid is not null then
      v_enviados := v_enviados + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'enviados', v_enviados);
end;
$function$;

-- ------------------------------------------------------------
-- enviar_mensaje · MISMA firma y MISMA lógica viva; único
-- cambio aditivo: los adj_tipo 'tarifa' | 'tarifa_viva' |
-- 'parte' guardan su snapshot JSON tal cual (sin pasar por
-- adj_normalizar, que es pa binarios) y no exigen texto.
-- ------------------------------------------------------------
create or replace function public.enviar_mensaje(
  p_de text, p_para text, p_texto text, p_clave text,
  p_adj_tipo text default null, p_adj_nombre text default null,
  p_adj_mime text default null, p_adj_datos text default null,
  p_adj_tam integer default null, p_resp_de bigint default null,
  p_op_id text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_texto     text;
  v_id        bigint;
  v_bytes     bigint;
  v_adj_datos text;
  v_adj_mime  text;
  v_es_json   boolean;
  v_rde       text;
  v_rpara     text;
  v_rtexto    text;
begin
  perform public.chat_identidad(p_de, p_clave);
  perform public.chat_exigir_activo(p_de);

  if p_para is distinct from 'ADMIN'
     and not exists (select 1 from public.usuarios where codigo = p_para) then
    raise exception 'destino no valido';
  end if;

  -- LOCAL-FIRST: si esta operación ya entró, se devuelve su id.
  if p_op_id is not null then
    select id into v_id from public.mensajes where op_id = p_op_id;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'id', v_id, 'duplicado', true);
    end if;
  end if;

  v_texto := left(btrim(coalesce(p_texto, '')), 500);
  v_es_json := p_adj_tipo in ('tarifa', 'tarifa_viva', 'parte');

  if p_adj_datos is not null and p_adj_datos <> '' then
    if v_es_json then
      -- TANDA CHAT PRO: snapshot JSON (tarifa / tarifa viva /
      -- parte): se guarda tal cual, sin normalizar binario.
      v_adj_datos := p_adj_datos;
      v_adj_mime := coalesce(nullif(p_adj_mime, ''), 'application/json');
      v_bytes := length(p_adj_datos)::bigint;
    elsif p_adj_tipo is null or p_adj_tipo not in ('foto', 'archivo', 'voz') then
      raise exception 'adjunto no valido';
    else
      -- TANDA 6 (E-3): validación de servidor — formato estricto,
      -- mime de lista blanca coherente con el tipo, firma mágica y
      -- tamaño real. Devuelve la forma canónica que se guarda.
      select o_datos, o_mime, o_bytes
        into v_adj_datos, v_adj_mime, v_bytes
        from public.adj_normalizar(p_adj_tipo, p_adj_mime, p_adj_datos);
    end if;
  elsif v_es_json then
    v_adj_datos := '{}';
    v_adj_mime := 'application/json';
    v_bytes := 2;
  else
    if v_texto = '' then
      raise exception 'mensaje vacio';
    end if;
    v_bytes := null;
  end if;

  if p_resp_de is not null then
    select de, para, left(texto, 120)
      into v_rde, v_rpara, v_rtexto
      from public.mensajes
     where id = p_resp_de and borrado = false
       and ((de = p_de and para = p_para) or (de = p_para and para = p_de));
    if v_rde is null then
      raise exception 'mensaje citado no valido';
    end if;
  end if;

  perform public.barrer_temporales();

  begin
    insert into public.mensajes
      (de, para, texto, adj_tipo, adj_nombre, adj_mime, adj_bytes, adj_datos,
       resp_de, resp_autor, resp_texto, op_id)
    values (
      p_de, p_para, v_texto,
      case when v_bytes is null then null else p_adj_tipo end,
      case when v_bytes is null then null
           else left(coalesce(p_adj_nombre,
             case when v_es_json then p_adj_tipo else 'archivo' end), 120) end,
      case when v_bytes is null then null else v_adj_mime end,
      case when v_bytes is null then null else v_bytes end,
      case when v_bytes is null then null else v_adj_datos end,
      p_resp_de, v_rde, v_rtexto, p_op_id
    )
    returning id into v_id;
  exception when unique_violation then
    -- Dos subidas del mismo op_id a la vez: gana la que ya entró.
    select id into v_id from public.mensajes where op_id = p_op_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'duplicado', true);
  end;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$function$;

-- ------------------------------------------------------------
-- leer_chat · MISMA firma y MISMA lógica viva; único cambio
-- aditivo: el resultado gana fijado_id + fijado_tipo (el id y
-- el adj_tipo del mensaje fijado de ESTA conversación, o null
-- si no hay). Ninguna clave existente se quita ni cambia.
-- ------------------------------------------------------------
create or replace function public.leer_chat(
  p_codigo text, p_con text, p_clave text,
  p_buscar text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_quien text;
  v_res   jsonb;
  v_fid   bigint;
  v_ftipo text;
begin
  v_quien := public.chat_identidad(p_codigo, p_clave);
  if p_con is null or p_con = '' or (v_quien <> 'ADMIN' and p_con <> 'ADMIN') then
    raise exception 'conversacion no valida';
  end if;

  perform public.barrer_temporales();

  -- Abrir el chat marca leídos los entrantes (solo en la lectura normal).
  if p_buscar is null then
    update public.mensajes set leido = true
     where para = v_quien and de = p_con and leido = false and borrado = false;
  end if;

  select coalesce(jsonb_agg(fila order by fila ->> 'creado'), '[]'::jsonb)
    into v_res
    from (
      select jsonb_build_object(
               'id', m.id, 'de', m.de, 'para', m.para,
               'texto', case when m.borrado then '' else m.texto end,
               'creado', m.creado, 'leido', m.leido, 'recibido', m.recibido,
               'editado', m.editado, 'borrado', m.borrado,
               'tipo', coalesce(m.tipo, 'texto'),
               'adj_tipo', case when m.borrado then null else m.adj_tipo end,
               'adj_nombre', m.adj_nombre, 'adj_mime', m.adj_mime,
               'adj_bytes', m.adj_bytes,
               'adj_datos', case when m.borrado then null else m.adj_datos end,
               'resp_de', m.resp_de, 'resp_autor', m.resp_autor, 'resp_texto', m.resp_texto,
               'fijado', coalesce(m.fijado, false),
               'reacciones', coalesce((
                 select jsonb_agg(jsonb_build_object('emoji', rr.emoji, 'total', rr.n)
                                  order by rr.n desc)
                   from (select r.emoji as emoji, count(*)::int as n
                           from public.reacciones r
                          where r.mensaje_id = m.id
                          group by r.emoji) rr), '[]'::jsonb)
             ) as fila
        from public.mensajes m
       where ((m.de = v_quien and m.para = p_con) or (m.de = p_con and m.para = v_quien))
         and (p_buscar is null or m.texto ilike '%' || p_buscar || '%')
       order by m.creado desc
       limit 200
    ) s;

  -- TANDA CHAT PRO: el fijado de esta conversación, como
  -- referencia (id + tipo) pa que cada app lo pinte vivo.
  select m.id, m.adj_tipo into v_fid, v_ftipo
    from public.mensajes m
   where ((m.de = v_quien and m.para = p_con) or (m.de = p_con and m.para = v_quien))
     and coalesce(m.fijado, false) = true and m.borrado = false
   order by m.creado desc
   limit 1;

  return jsonb_build_object('ok', true, 'mensajes', v_res,
    'fijado_id', v_fid, 'fijado_tipo', v_ftipo);
end;
$function$;

grant execute on function public.parte_crear(text, text, numeric, bigint, text, text, boolean, text)
  to anon, authenticated;
grant execute on function public.parte_confirmar(text, text, uuid, text)
  to anon, authenticated;
grant execute on function public.parte_rechazar(text, text, uuid, text, text)
  to anon, authenticated;
grant execute on function public.parte_leer(text, uuid)
  to anon, authenticated;
grant execute on function public.enviar_mensaje_todos(text, text, text, text, text, text, text, integer, text)
  to anon, authenticated;

select 'chat-pro aplicada' as resultado;

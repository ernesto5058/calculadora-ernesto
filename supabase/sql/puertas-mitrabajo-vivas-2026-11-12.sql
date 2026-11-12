-- =====================================================================
-- PUERTAS RPC VIVAS DE «MI TRABAJO» — volcado fiel de la base, 2026-11-12
-- Proyecto Supabase: buscadores-ernesto (otsudfgwpapkluusrlnj).
-- Fuente: pg_get_functiondef sobre pg_proc, SIN retoques (mismo patron
-- que puertas-minegocio-vivas-2026-11-12.sql de la Tanda Nº2).
-- Este archivo trae SOLO las puertas propias de Mi Trabajo que no
-- vivian ya en el volcado de Mi Negocio: las del login
-- (validar_usuario, cambiar_codigo) y las de estado de reportes
-- (registrar_reporte NO se repite: su definicion viva ya consta en
-- el volcado de Mi Negocio y hoy no cambio; lo mismo leer_panel y
-- leer_chat — el chequeo E7 de puertas-sin-gemelas prohibe definir
-- la misma funcion dos veces en los .sql del repo).
-- Novedades de la Tanda Nº6 (Inspector Ola 1, E-6/E-9):
--  - validar_usuario devuelve tambien «bloqueado» (la pausa del
--    servidor): la app libera el candado EN_PAUSA cuando vuelve false.
--  - leer_chat_ligero (NUEVA): sondeo del chat SIN adj_datos (limite
--    50, marca adj_tiene); leer_chat queda intacta para Mi Negocio.
--  - leer_adjunto (NUEVA): el adjunto base64 de UN mensaje, bajo
--    demanda y solo de la conversacion propia con ADMIN.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Puerta: public.cambiar_codigo(p_codigo_actual text, p_codigo_nuevo text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cambiar_codigo(p_codigo_actual text, p_codigo_nuevo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nuevo text;
begin
  v_nuevo := btrim(coalesce(p_codigo_nuevo, ''));

  -- Formato: 6 a 40 caracteres, sin espacios.
  if length(v_nuevo) < 6 or length(v_nuevo) > 40 or v_nuevo ~ '\s' then
    raise exception 'formato no valido';
  end if;

  -- El código actual debe existir y estar activo.
  if not exists (
    select 1 from public.usuarios
     where codigo = p_codigo_actual and activo = true
  ) then
    raise exception 'no autorizado';
  end if;

  -- No puede ser el código admin ni uno ya usado por otro buscador.
  if exists (select 1 from public.admin_config
              where clave = 'codigo_admin' and valor = v_nuevo) then
    raise exception 'codigo no disponible';
  end if;
  if v_nuevo <> p_codigo_actual
     and exists (select 1 from public.usuarios where codigo = v_nuevo) then
    raise exception 'codigo no disponible';
  end if;

  -- Migración completa en UNA transacción (la función ES la
  -- transacción: o se cambia todo o no se cambia nada).
  update public.usuarios  set codigo = v_nuevo where codigo = p_codigo_actual;
  update public.reportes set buscador = v_nuevo where buscador = p_codigo_actual;
  update public.ayudas   set buscador = v_nuevo where buscador = p_codigo_actual;
  update public.mensajes set de   = v_nuevo where de   = p_codigo_actual;
  update public.mensajes set para = v_nuevo where para = p_codigo_actual;
  update public.presencia set codigo = v_nuevo where codigo = p_codigo_actual;
  update public.perfiles set codigo = v_nuevo where codigo = p_codigo_actual;
  update public.paneles  set codigo = v_nuevo where codigo = p_codigo_actual;
  update public.avisos_config set codigo = v_nuevo where codigo = p_codigo_actual;
  update public.push_subs     set codigo = v_nuevo where codigo = p_codigo_actual;
  update public.telegram_tokens set codigo = v_nuevo where codigo = p_codigo_actual;
  update public.chat_ajustes set codigo = v_nuevo where codigo = p_codigo_actual;

  insert into public.cambios_codigo (codigo_anterior, codigo_nuevo)
  values (p_codigo_actual, v_nuevo);

  return jsonb_build_object('ok', true, 'codigo', v_nuevo);
end;
$function$

-- ---------------------------------------------------------------------
-- Puerta: public.estado_reportes(p_ids uuid[])
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.estado_reportes(p_ids uuid[])
 RETURNS TABLE(id uuid, estado text, comision numeric, motivo text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.id, r.estado, r.comision, r.motivo
  from public.reportes r
  where r.id = any(p_ids);
$function$

-- ---------------------------------------------------------------------
-- Puerta: public.leer_adjunto(p_codigo text, p_clave text, p_id bigint)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leer_adjunto(p_codigo text, p_clave text, p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_quien text; v_row public.mensajes%rowtype;
begin
  v_quien := public.chat_identidad(p_codigo, p_clave);
  select * into v_row from public.mensajes m
   where m.id = p_id and m.borrado = false
     and ((m.de = v_quien and m.para = 'ADMIN') or (m.de = 'ADMIN' and m.para = v_quien));
  if not found then raise exception 'no autorizado'; end if;
  return jsonb_build_object('ok', true, 'id', v_row.id, 'adj_tipo', v_row.adj_tipo,
    'adj_nombre', v_row.adj_nombre, 'adj_mime', v_row.adj_mime,
    'adj_bytes', v_row.adj_bytes, 'adj_datos', v_row.adj_datos);
end;
$function$

-- ---------------------------------------------------------------------
-- Puerta: public.leer_chat_ligero(p_codigo text, p_con text, p_clave text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leer_chat_ligero(p_codigo text, p_con text, p_clave text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_quien text; v_res jsonb;
begin
  v_quien := public.chat_identidad(p_codigo, p_clave);
  if p_con is null or p_con = '' or (v_quien <> 'ADMIN' and p_con <> 'ADMIN') then
    raise exception 'conversacion no valida';
  end if;
  perform public.barrer_temporales();
  update public.mensajes set leido = true
   where para = v_quien and de = p_con and leido = false and borrado = false;
  select coalesce(jsonb_agg(fila order by fila ->> 'creado'), '[]'::jsonb) into v_res
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
               'adj_datos', null,
               'adj_tiene', case when m.borrado then false else (m.adj_datos is not null) end,
               'resp_de', m.resp_de, 'resp_autor', m.resp_autor, 'resp_texto', m.resp_texto,
               'fijado', coalesce(m.fijado, false),
               'reacciones', coalesce((
                 select jsonb_agg(jsonb_build_object('emoji', rr.emoji, 'total', rr.n) order by rr.n desc)
                   from (select r.emoji as emoji, count(*)::int as n from public.reacciones r
                          where r.mensaje_id = m.id group by r.emoji) rr), '[]'::jsonb)
             ) as fila
        from public.mensajes m
       where ((m.de = v_quien and m.para = p_con) or (m.de = p_con and m.para = v_quien))
       order by m.creado desc
       limit 50
    ) s;
  return jsonb_build_object('ok', true, 'mensajes', v_res);
end;
$function$

-- ---------------------------------------------------------------------
-- Puerta: public.validar_usuario(p_codigo text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validar_usuario(p_codigo text)
 RETURNS TABLE(codigo text, nombre text, activo boolean, bloqueado boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select u.codigo, u.nombre, u.activo, coalesce(u.bloqueado, false) from public.usuarios u
  where u.codigo = upper(trim(p_codigo));
$function$

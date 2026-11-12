-- =====================================================================
-- PUERTAS DE MI NEGOCIO — RESPALDO DE DEFINICIONES VIVAS (2026-11-12)
--
-- Origen: definiciones vivas leídas de producción (solo lectura, vía
-- Management API, pg_get_functiondef sobre pg_proc, esquema public).
-- Proyecto Supabase ref: otsudfgwpapkluusrlnj (sin secretos en este archivo).
-- Motivo: Inspector Ola 1, hallazgo F-1 (y E-5) — las puertas base no
-- tenían fuente versionada en ningún repo; este archivo las versiona.
--
-- ESTO ES UN RESPALDO, NO UNA MIGRACIÓN: no se aplicó ni se debe aplicar
-- como paso de esta tanda; la base NO fue modificada al generarlo.
--
-- Enumeración de la app (grep de rpc() + mapa PUERTAS en
-- minegocio-src/app.js, idéntico en github-calculadora/minegocio/index.html):
-- 33 nombres buscados, 33 hallados en pg_proc, 0 faltantes.
-- Nota: leer_panel está registrado en el mapa PUERTAS pero no tiene una
-- llamada rpc("leerPanel") directa en app.js; se vuelca igual por estar
-- en el mapa de puertas de la app.
-- Sobrecargas: NINGUNA — cada nombre tiene exactamente 1 firma viva
-- (1 fila por nombre en pg_proc), sin gemelas tipo PGRST203 entre estas
-- puertas en el momento del volcado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Puerta: public.admin_actividad(p_codigo text, p_quien text, p_accion text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_actividad(p_codigo text, p_quien text DEFAULT NULL::text, p_accion text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lista jsonb;
begin
  perform public.chat_identidad('ADMIN', p_codigo);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'quien', a.quien, 'accion', a.accion,
           'detalle', a.detalle, 'creado_en', a.creado_en
         ) order by a.id desc), '[]'::jsonb)
    into v_lista
    from (select * from public.actividad
           where (p_quien is null or quien = p_quien)
             and (p_accion is null or accion = p_accion)
           order by id desc limit 50) a;
  return v_lista;
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_aprobar(p_codigo text, p_id uuid, p_comision numeric)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_aprobar(p_codigo text, p_id uuid, p_comision numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.admin_es_valido(p_codigo) then raise exception 'codigo admin no valido'; end if;
  update public.reportes set estado = 'aprobado', comision = p_comision, motivo = null, resuelto_en = now() where id = p_id;
end; $function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_ayuda_vista(p_codigo text, p_id uuid)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ayuda_vista(p_codigo text, p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.admin_es_valido(p_codigo) then raise exception 'codigo admin no valido'; end if;
  update public.ayudas set estado = 'visto', resuelto_en = now() where id = p_id;
end; $function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_ayudas(p_codigo text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_ayudas(p_codigo text)
 RETURNS SETOF ayudas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.admin_es_valido(p_codigo) then raise exception 'codigo admin no valido'; end if;
  return query select * from public.ayudas order by (estado = 'pendiente') desc, creado_en asc;
end; $function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_cierres(p_codigo text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cierres(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lista jsonb;
begin
  perform public.chat_identidad('ADMIN', p_codigo);
  select coalesce(jsonb_agg(jsonb_build_object(
           'semana_inicio', c.semana_inicio, 'datos', c.datos,
           'creado_en', c.creado_en) order by c.semana_inicio desc), '[]'::jsonb)
    into v_lista
    from public.cierres_semanales c;
  return v_lista;
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_generar_cierre(p_codigo text, p_semana_inicio date)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_generar_cierre(p_codigo text, p_semana_inicio date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fin    date := p_semana_inicio + 6;
  v_datos  jsonb;
  v_filas  jsonb;
  v_resumen jsonb;
begin
  perform public.chat_identidad('ADMIN', p_codigo);
  if extract(isodow from p_semana_inicio) <> 1 then
    raise exception 'la semana empieza el lunes';
  end if;

  -- Filas por buscador desde los tratos PUBLICADOS de la semana.
  select coalesce(jsonb_agg(fila order by fila ->> 'nombre'), '[]'::jsonb)
    into v_filas
    from (
      select jsonb_build_object(
               'codigo', p.codigo,
               'nombre', coalesce(p.nombre, ''),
               'tratos', count(t),
               'comisiones', coalesce(sum((t ->> 'comision')::numeric), 0),
               'bono_saldo', (coalesce(sum(case when (t ->> 'tipo') = 'saldo'
                                                then (t ->> 'recargas')::numeric else 0 end), 0) >= 150),
               'bono_transf', (count(*) filter (where (t ->> 'tipo') = 'transferencia') >= 10),
               'bonos', (case when coalesce(sum(case when (t ->> 'tipo') = 'saldo'
                                                     then (t ->> 'recargas')::numeric else 0 end), 0) >= 150
                              then 300 else 0 end)
                      + (case when count(*) filter (where (t ->> 'tipo') = 'transferencia') >= 10
                              then 300 else 0 end)
             ) as fila
        from public.paneles p
        left join lateral jsonb_array_elements(p.tratos) t
          on (t ->> 'fecha') ~ '^\d{4}-\d{2}-\d{2}$'
         and (t ->> 'fecha')::date between p_semana_inicio and v_fin
       group by p.codigo, p.nombre
    ) s;

  -- Tu ganancia de la semana (reportes aprobados, sin pruebas): saldo =
  -- excedente menos comisión; transferencia = ganancia de la vuelta
  -- menos comisión. Sin clamp: las pérdidas restan, como en la
  -- Contabilidad (arreglos H-2 y H-3, 2026-11-11).
  select jsonb_build_object(
           'tratos', count(*),
           'tu_ganancia', coalesce(sum(
             case
               when r.tipo = 'saldo' then
                 (t.ingreso_ref360 - r.precio) * coalesce(r.cantidad, 1) - coalesce(r.comision, 0)
               when r.tipo = 'transferencia' then
                 ((r.cantidad * (1 + coalesce(r.porc, 0) / 100.0) / nullif(t.libro_ref, 0)) * t.salida_ref - r.cantidad)
                   - coalesce(r.comision, 0)
               else 0 end), 0),
           'comisiones', coalesce(sum(r.comision), 0),
           'pagadas', count(*) filter (where r.comision_pagada_en is not null),
           'pendientes_pago', count(*) filter (where r.comision_pagada_en is null)
         )
    into v_resumen
    from public.reportes r
    cross join (select ingreso_ref360, libro_ref, salida_ref
                  from public.tarifa where id = 1) t
   where r.estado = 'aprobado'
     and not coalesce(r.prueba, false)
     and r.creado_en::date between p_semana_inicio and v_fin;

  v_datos := jsonb_build_object(
    'semana_inicio', p_semana_inicio,
    'semana_fin', v_fin,
    'resumen', coalesce(v_resumen, '{}'::jsonb),
    'buscadores', v_filas);

  insert into public.cierres_semanales (semana_inicio, datos)
  values (p_semana_inicio, v_datos)
  on conflict (semana_inicio) do update
    set datos = excluded.datos, creado_en = now();

  perform public.registrar_actividad('ADMIN', 'generar_cierre',
    jsonb_build_object('semana_inicio', p_semana_inicio));

  return v_datos;
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_guardar_tarifa(p_codigo text, p_ingreso numeric, p_libro numeric, p_salida numeric, p_com_saldo numeric, p_com_transf numeric, p_piso numeric)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_guardar_tarifa(p_codigo text, p_ingreso numeric, p_libro numeric, p_salida numeric, p_com_saldo numeric, p_com_transf numeric, p_piso numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ahora timestamptz := now();
  v_u     text;
begin
  if not exists (
    select 1 from public.admin_config
    where clave = 'codigo_admin' and valor = p_codigo
  ) then
    raise exception 'codigo admin no valido';
  end if;

  insert into public.tarifa
    (id, ingreso_ref360, libro_ref, salida_ref, comision_saldo, comision_transf, piso_transf, actualizado, actualizado_por)
  values
    (1, p_ingreso, p_libro, p_salida, p_com_saldo, p_com_transf, p_piso, v_ahora, 'ADMIN')
  on conflict (id) do update
    set ingreso_ref360  = excluded.ingreso_ref360,
        libro_ref       = excluded.libro_ref,
        salida_ref      = excluded.salida_ref,
        comision_saldo  = excluded.comision_saldo,
        comision_transf = excluded.comision_transf,
        piso_transf     = excluded.piso_transf,
        actualizado     = excluded.actualizado,
        actualizado_por = excluded.actualizado_por;

  for v_u in select codigo from public.usuarios where activo = true
  loop
    insert into public.mensajes (de, para, texto, tipo)
    values ('ADMIN', v_u, '📋 Nueva tarifa publicada', 'sistema');
  end loop;

  perform public.registrar_actividad('ADMIN', 'cambiar_tarifa',
    jsonb_build_object('ingreso', p_ingreso, 'libro', p_libro, 'salida', p_salida));

  return jsonb_build_object('ok', true, 'actualizado', v_ahora);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_marcar_pagado(p_codigo text, p_id uuid)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_marcar_pagado(p_codigo text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rep   public.reportes%rowtype;
  v_tratos jsonb;
  v_i     int;
  v_t     jsonb;
  v_cambiado boolean := false;
  v_nuevo boolean := false;
begin
  perform public.chat_identidad('ADMIN', p_codigo);

  select * into v_rep from public.reportes where id = p_id;
  if v_rep.id is null then
    raise exception 'trato no valido';
  end if;
  if v_rep.estado <> 'aprobado' then
    raise exception 'solo se marca pagado un trato aprobado';
  end if;

  if v_rep.comision_pagada_en is null then
    update public.reportes set comision_pagada_en = now() where id = p_id;
    select * into v_rep from public.reportes where id = p_id;
    v_nuevo := true;
  end if;

  -- Republicar el panel de ese buscador (legado; hoy vacío):
  -- protegido para que un fallo aquí nunca tumbe el pago.
  begin
    select tratos into v_tratos from public.paneles where codigo = v_rep.buscador;
    if v_tratos is not null and jsonb_typeof(v_tratos) = 'array' then
      for v_i in 0 .. jsonb_array_length(v_tratos) - 1 loop
        v_t := v_tratos -> v_i;
        if (v_t ->> 'fecha') = to_char(v_rep.creado_en, 'YYYY-MM-DD')
           and coalesce((v_t ->> 'comision')::numeric, -1) = coalesce(v_rep.comision, -2)
           and coalesce(v_t ->> 'estado', 'aprobado') <> 'pagado' then
          v_t := v_t || jsonb_build_object(
                   'estado', 'pagado',
                   'pagado_en', to_char(v_rep.comision_pagada_en, 'YYYY-MM-DD'));
          v_tratos := jsonb_set(v_tratos, array[v_i::text], v_t);
          v_cambiado := true;
        end if;
      end loop;
      if v_cambiado then
        update public.paneles set tratos = v_tratos, actualizado = now()
         where codigo = v_rep.buscador;
      end if;
    end if;
  exception when others then
    null; -- el panel legado nunca bloquea el sello de pago
  end;

  -- IDEMPOTENCIA DE LA AUDITORÍA (tanda 2026-11-11): solo se
  -- registra el pago cuando ESTA llamada lo selló. Un reintento
  -- (doble toque o cola que no vio la respuesta) no deja una
  -- segunda fila fantasma de «pagar_comision».
  if v_nuevo then
    perform public.registrar_actividad('ADMIN', 'pagar_comision',
      jsonb_build_object('reporte', p_id, 'buscador', v_rep.buscador,
                         'comision', v_rep.comision));
  end if;

  return jsonb_build_object('ok', true, 'pagado', true,
                            'ya_pagado', not v_nuevo);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_marcar_prueba(p_codigo text, p_id uuid, p_prueba boolean)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_marcar_prueba(p_codigo text, p_id uuid, p_prueba boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rep public.reportes%rowtype;
begin
  if not public.admin_es_valido(p_codigo) then
    raise exception 'codigo admin no valido';
  end if;

  select * into v_rep from public.reportes where id = p_id;
  if v_rep.id is null then
    raise exception 'reporte no valido';
  end if;

  update public.reportes
     set prueba = coalesce(p_prueba, false), actualizado_en = now()
   where id = p_id;

  perform public.registrar_actividad('ADMIN',
    case when coalesce(p_prueba, false)
         then 'marcar_prueba' else 'desmarcar_prueba' end,
    jsonb_build_object('reporte', p_id, 'buscador', v_rep.buscador,
                       'prueba', coalesce(p_prueba, false)));

  return jsonb_build_object('ok', true, 'id', p_id,
                            'prueba', coalesce(p_prueba, false));
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_publicar_tratos(p_codigo text, p_tratos jsonb)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_publicar_tratos(p_codigo text, p_tratos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_elem jsonb;
  v_n    int := 0;
  v_t    jsonb;
  v_txt  text;
begin
  if not exists (
    select 1 from public.admin_config
    where clave = 'codigo_admin' and valor = p_codigo
  ) then
    raise exception 'codigo admin no valido';
  end if;

  if p_tratos is null or jsonb_typeof(p_tratos) <> 'array' then
    raise exception 'tratos no validos';
  end if;

  for v_elem in select * from jsonb_array_elements(p_tratos)
  loop
    if v_elem ->> 'codigo' is null then
      raise exception 'tratos no validos';
    end if;
    insert into public.paneles (codigo, nombre, tratos, actualizado)
    values (
      v_elem ->> 'codigo',
      v_elem ->> 'nombre',
      coalesce(v_elem -> 'tratos', '[]'::jsonb),
      now()
    )
    on conflict (codigo) do update
      set nombre      = excluded.nombre,
          tratos      = excluded.tratos,
          actualizado = excluded.actualizado;
    v_n := v_n + 1;

    for v_t in select * from jsonb_array_elements(coalesce(v_elem -> 'tratos', '[]'::jsonb))
    loop
      v_txt := '✅ Trato aprobado: ' || coalesce(v_t ->> 'concepto', 'trato')
               || ' — tu comisión: ' || coalesce(v_t ->> 'comision', '0') || ' CUP';
      if not exists (
        select 1 from public.mensajes
         where tipo = 'sistema' and de = 'ADMIN'
           and para = (v_elem ->> 'codigo') and texto = v_txt
      ) then
        insert into public.mensajes (de, para, texto, tipo)
        values ('ADMIN', v_elem ->> 'codigo', v_txt, 'sistema');
      end if;
    end loop;
  end loop;

  perform public.registrar_actividad('ADMIN', 'publicar_tratos',
    jsonb_build_object('usuarios', v_n));

  return jsonb_build_object('ok', true, 'usuarios', v_n);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_rechazar(p_codigo text, p_id uuid, p_motivo text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_rechazar(p_codigo text, p_id uuid, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.admin_es_valido(p_codigo) then raise exception 'codigo admin no valido'; end if;
  update public.reportes set estado = 'rechazado', comision = null, motivo = p_motivo, resuelto_en = now() where id = p_id;
end; $function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_reportes(p_codigo text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reportes(p_codigo text)
 RETURNS SETOF reportes
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.admin_es_valido(p_codigo) then raise exception 'codigo admin no valido'; end if;
  return query select * from public.reportes order by (estado = 'pendiente') desc, creado_en asc;
end; $function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_usuario_activo(p_codigo text, p_codigo_usuario text, p_activo boolean)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_usuario_activo(p_codigo text, p_codigo_usuario text, p_activo boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.admin_es_valido(p_codigo) then raise exception 'codigo admin no valido'; end if;
  update public.usuarios set activo = p_activo where codigo = upper(trim(p_codigo_usuario));
end; $function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_usuario_borrar(p_codigo text, p_codigo_usuario text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_usuario_borrar(p_codigo text, p_codigo_usuario text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rep int;
  v_ayu int;
  v_usu int;
begin
  if not exists (
    select 1 from public.admin_config
    where clave = 'codigo_admin' and valor = p_codigo
  ) then
    raise exception 'codigo admin no valido';
  end if;

  delete from public.reportes where buscador = p_codigo_usuario;
  get diagnostics v_rep = row_count;

  delete from public.ayudas where buscador = p_codigo_usuario;
  get diagnostics v_ayu = row_count;

  delete from public.mensajes where de = p_codigo_usuario or para = p_codigo_usuario;
  delete from public.perfiles where codigo = p_codigo_usuario;
  delete from public.presencia where codigo = p_codigo_usuario;
  delete from public.chat_ajustes where codigo = p_codigo_usuario;
  delete from public.paneles where codigo = p_codigo_usuario;

  delete from public.usuarios where codigo = p_codigo_usuario;
  get diagnostics v_usu = row_count;

  return jsonb_build_object(
    'ok', true,
    'reportes', v_rep,
    'ayudas', v_ayu,
    'usuarios', v_usu
  );
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_usuario_nuevo(p_codigo text, p_codigo_usuario text, p_nombre text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_usuario_nuevo(p_codigo text, p_codigo_usuario text, p_nombre text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.admin_es_valido(p_codigo) then raise exception 'codigo admin no valido'; end if;
  insert into public.usuarios(codigo, nombre) values (upper(trim(p_codigo_usuario)), trim(p_nombre));
end; $function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_usuarios(p_codigo text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_usuarios(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lista jsonb;
begin
  if not exists (
    select 1 from public.admin_config
    where clave = 'codigo_admin' and valor = p_codigo
  ) then
    raise exception 'codigo admin no valido';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo', u.codigo,
           'nombre', u.nombre,
           'activo', u.activo,
           'bloqueado', coalesce(u.bloqueado, false)
         ) order by u.nombre), '[]'::jsonb)
    into v_lista
    from public.usuarios u;

  return v_lista;
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.admin_validar(p_codigo text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_validar(p_codigo text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.admin_es_valido(p_codigo);
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.borrar_mensaje(p_codigo text, p_id bigint)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.borrar_mensaje(p_codigo text, p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_de   text;
  v_tipo text;
begin
  select de, tipo into v_de, v_tipo from public.mensajes where id = p_id;
  if v_de is null then
    raise exception 'mensaje no valido';
  end if;
  if v_tipo = 'sistema' then
    raise exception 'los avisos del sistema no se borran';
  end if;

  if v_de = 'ADMIN' then
    perform public.chat_identidad('ADMIN', p_codigo);
  else
    if p_codigo is distinct from v_de then
      raise exception 'no autorizado';
    end if;
    perform public.chat_identidad(v_de, v_de);
    perform public.chat_exigir_activo(v_de);
  end if;

  update public.mensajes set borrado = true where id = p_id;

  return jsonb_build_object('ok', true);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.editar_mensaje(p_codigo text, p_id bigint, p_texto text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.editar_mensaje(p_codigo text, p_id bigint, p_texto text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_de    text;
  v_tipo  text;
  v_nuevo text;
begin
  v_nuevo := left(btrim(coalesce(p_texto, '')), 500);
  if v_nuevo = '' then
    raise exception 'mensaje vacio';
  end if;

  select de, tipo into v_de, v_tipo from public.mensajes where id = p_id and borrado = false;
  if v_de is null then
    raise exception 'mensaje no valido';
  end if;
  if v_tipo = 'sistema' then
    raise exception 'los avisos del sistema no se editan';
  end if;

  if v_de = 'ADMIN' then
    perform public.chat_identidad('ADMIN', p_codigo);
  else
    if p_codigo is distinct from v_de then
      raise exception 'no autorizado';
    end if;
    perform public.chat_identidad(v_de, v_de);
    perform public.chat_exigir_activo(v_de);
  end if;

  update public.mensajes
     set original = coalesce(original, texto),
         texto    = v_nuevo,
         editado  = now()
   where id = p_id;

  return jsonb_build_object('ok', true);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.enviar_mensaje(p_de text, p_para text, p_texto text, p_clave text, p_adj_tipo text, p_adj_nombre text, p_adj_mime text, p_adj_datos text, p_adj_tam integer, p_resp_de bigint, p_op_id text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enviar_mensaje(p_de text, p_para text, p_texto text, p_clave text, p_adj_tipo text DEFAULT NULL::text, p_adj_nombre text DEFAULT NULL::text, p_adj_mime text DEFAULT NULL::text, p_adj_datos text DEFAULT NULL::text, p_adj_tam integer DEFAULT NULL::integer, p_resp_de bigint DEFAULT NULL::bigint, p_op_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_texto  text;
  v_id     bigint;
  v_bytes  bigint;
  v_rde    text;
  v_rpara  text;
  v_rtexto text;
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

  if p_adj_datos is not null and p_adj_datos <> '' then
    if p_adj_tipo is null or p_adj_tipo not in ('foto', 'archivo', 'voz') then
      raise exception 'adjunto no valido';
    end if;
    v_bytes := (length(p_adj_datos) * 3) / 4;
    if v_bytes > 5242880 then
      raise exception 'adjunto supera los 5 MB';
    end if;
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
      case when v_bytes is null then null else left(coalesce(p_adj_nombre, 'archivo'), 120) end,
      case when v_bytes is null then null else left(coalesce(p_adj_mime, ''), 60) end,
      case when v_bytes is null then null else coalesce(p_adj_tam, v_bytes) end,
      case when v_bytes is null then null else p_adj_datos end,
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

-- ---------------------------------------------------------------------
-- Puerta: public.fijar_mensaje(p_codigo text, p_con text, p_id bigint)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fijar_mensaje(p_codigo text, p_con text, p_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_de   text;
  v_para text;
  v_conv text;
begin
  perform public.chat_identidad('ADMIN', p_codigo);

  if p_con is null or p_con = ''
     or not exists (select 1 from public.usuarios where codigo = p_con) then
    raise exception 'conversacion no valida';
  end if;

  if p_id is null then
    -- Los clientes mandan p_id null para quitar el fijado de
    -- esta conversación (no señalan un mensaje concreto).
    update public.mensajes set fijado = false
     where fijado = true
       and ((de = 'ADMIN' and para = p_con) or (de = p_con and para = 'ADMIN'));
  else
    select de, para into v_de, v_para from public.mensajes where id = p_id and tipo <> 'sistema';
    if v_de is null then
      raise exception 'mensaje no valido';
    end if;
    v_conv := case when v_de = 'ADMIN' then v_para else v_de end;
    if v_conv <> p_con then
      raise exception 'mensaje no valido';
    end if;

    update public.mensajes set fijado = false
     where fijado = true
       and ((de = 'ADMIN' and para = v_conv) or (de = v_conv and para = 'ADMIN'));
    update public.mensajes set fijado = true where id = p_id;
  end if;

  perform public.registrar_actividad('ADMIN',
    case when p_id is null then 'desfijar_mensaje' else 'fijar_mensaje' end,
    jsonb_build_object('mensaje', p_id, 'conversacion', p_con));

  return jsonb_build_object('ok', true);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.guardar_temporal(p_codigo text, p_con text, p_horas integer)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guardar_temporal(p_codigo text, p_con text, p_horas integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_txt text;
begin
  if not exists (
    select 1 from public.admin_config
    where clave = 'codigo_admin' and valor = p_codigo
  ) then
    raise exception 'codigo admin no valido';
  end if;
  if not exists (select 1 from public.usuarios where codigo = p_con) then
    raise exception 'destino no valido';
  end if;
  if p_horas is not null and p_horas not in (24, 168, 2160) then
    raise exception 'ventana no valida';
  end if;

  insert into public.chat_ajustes (codigo, horas, actualizado)
  values (p_con, p_horas, now())
  on conflict (codigo) do update
    set horas = excluded.horas, actualizado = now();

  perform public.barrer_temporales();

  v_txt := case
    when p_horas is null then '⏱️ Mensajes temporales desactivados'
    when p_horas = 24 then '⏱️ Los mensajes ahora desaparecen en 24 h'
    when p_horas = 168 then '⏱️ Los mensajes ahora desaparecen en 7 días'
    when p_horas = 2160 then '⏱️ Los mensajes ahora desaparecen en 90 días'
    else '⏱️ Los mensajes ahora desaparecen en ' || p_horas || ' h'
  end;
  insert into public.mensajes (de, para, texto, tipo)
  values ('ADMIN', p_con, v_txt, 'sistema');

  return jsonb_build_object('ok', true);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.leer_chat(p_codigo text, p_con text, p_clave text, p_buscar text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leer_chat(p_codigo text, p_con text, p_clave text, p_buscar text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_quien text;
  v_res   jsonb;
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

  return jsonb_build_object('ok', true, 'mensajes', v_res);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.leer_panel(p_codigo text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leer_panel(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nombre  text;
  v_tratos  jsonb;
begin
  select nombre into v_nombre
    from public.usuarios
   where codigo = p_codigo and activo = true;

  if v_nombre is null then
    raise exception 'no autorizado';
  end if;

  select tratos into v_tratos
    from public.paneles
   where codigo = p_codigo;

  return jsonb_build_object(
    'ok', true,
    'nombre', v_nombre,
    'tratos', coalesce(v_tratos, '[]'::jsonb)
  );
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.leer_perfil(p_codigo text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leer_perfil(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_perfil jsonb;
begin
  select jsonb_build_object(
           'codigo', pf.codigo,
           'nombre', pf.nombre,
           'telefono', pf.telefono,
           'zona', pf.zona,
           'nota', pf.nota,
           'avatar_color', pf.avatar_color,
           'actualizado', pf.actualizado
         )
    into v_perfil
    from public.perfiles pf
   where pf.codigo = p_codigo;

  return coalesce(v_perfil, '{}'::jsonb)
         || jsonb_build_object('ok', true, 'perfil', v_perfil);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.leer_tarifa()
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.leer_tarifa()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fila public.tarifa%rowtype;
begin
  select * into v_fila from public.tarifa where id = 1;
  if not found then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object(
    'ok', true,
    'ingreso_ref360',  v_fila.ingreso_ref360,
    'libro_ref',       v_fila.libro_ref,
    'salida_ref',      v_fila.salida_ref,
    'comision_saldo',  v_fila.comision_saldo,
    'comision_transf', v_fila.comision_transf,
    'piso_transf',     v_fila.piso_transf,
    'actualizado',     v_fila.actualizado
  );
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.marcar_recibidos(p_codigo text, p_clave text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.marcar_recibidos(p_codigo text, p_clave text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_n int;
begin
  if p_codigo = 'ADMIN' then
    if not exists (
      select 1 from public.admin_config
      where clave = 'codigo_admin' and valor = p_clave
    ) then
      raise exception 'codigo admin no valido';
    end if;
  else
    if p_codigo is null or p_clave is null or p_codigo <> p_clave then
      raise exception 'no autorizado';
    end if;
    if not exists (
      select 1 from public.usuarios
      where codigo = p_codigo and activo = true
    ) then
      raise exception 'no autorizado';
    end if;
  end if;

  update public.mensajes
     set recibido = now()
   where para = p_codigo and recibido is null and creado <= now();
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok', true, 'marcados', v_n);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.mensajes_sin_leer(p_codigo text, p_clave text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mensajes_sin_leer(p_codigo text, p_clave text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_n     int;
  v_mapa  jsonb;
  v_total int;
begin
  if p_codigo = 'ADMIN' then
    if not exists (
      select 1 from public.admin_config
      where clave = 'codigo_admin' and valor = p_clave
    ) then
      raise exception 'codigo admin no valido';
    end if;

    select coalesce(jsonb_object_agg(de, n), '{}'::jsonb), coalesce(sum(n), 0)
      into v_mapa, v_total
    from (
      select de, count(*)::int as n
        from public.mensajes
       where para = 'ADMIN' and leido = false
       group by de
    ) s;

    return jsonb_build_object('ok', true, 'total', coalesce(v_total, 0), 'por_usuario', coalesce(v_mapa, '{}'::jsonb));
  end if;

  if p_codigo is null or p_clave is null or p_codigo <> p_clave then
    raise exception 'no autorizado';
  end if;
  if not exists (
    select 1 from public.usuarios
    where codigo = p_codigo and activo = true
  ) then
    raise exception 'no autorizado';
  end if;

  select count(*)::int into v_n
    from public.mensajes
   where para = p_codigo and leido = false;

  return jsonb_build_object('ok', true, 'sin_leer', v_n);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.mercado_fijar_costo(p_codigo text, p_costo numeric)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mercado_fijar_costo(p_codigo text, p_costo numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.admin_es_valido(p_codigo) then
    return jsonb_build_object('ok', false, 'error', 'codigo_no_valido');
  end if;
  if p_costo is null or p_costo <= 0 then
    return jsonb_build_object('ok', false, 'error', 'costo_no_valido');
  end if;
  update public.mercado_config
     set costo_ref360 = p_costo, actualizado = now(), actualizado_por = 'ADMIN'
   where id = 1;
  return jsonb_build_object('ok', true, 'costo_ref360', p_costo);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.reaccionar(p_codigo text, p_id bigint, p_emoji text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reaccionar(p_codigo text, p_id bigint, p_emoji text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_quien text;
  v_act   text;
begin
  if p_emoji is not null and p_emoji not in ('❤️','👍','😂','👏','🔥') then
    raise exception 'reaccion no valida';
  end if;

  select de into v_quien from public.mensajes where id = p_id;
  if v_quien is null then
    raise exception 'mensaje no valido';
  end if;
  if exists (select 1 from public.mensajes
              where id = p_id and (tipo = 'sistema' or borrado = true)) then
    raise exception 'ese mensaje no admite reacciones';
  end if;

  perform public.chat_exigir_activo(p_codigo);

  select emoji into v_act from public.reacciones
   where mensaje_id = p_id and quien = p_codigo;

  if p_emoji is null or p_emoji = v_act then
    delete from public.reacciones where mensaje_id = p_id and quien = p_codigo;
  else
    insert into public.reacciones (mensaje_id, quien, emoji)
    values (p_id, p_codigo, p_emoji)
    on conflict (mensaje_id, quien) do update set emoji = excluded.emoji, creado = now();
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.registrar_push_admin(p_codigo text, p_suscripcion jsonb, p_plataforma text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_push_admin(p_codigo text, p_suscripcion jsonb, p_plataforma text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_endpoint text;
begin
  perform public.chat_identidad('ADMIN', p_codigo);

  v_endpoint := p_suscripcion ->> 'endpoint';
  if v_endpoint is null or v_endpoint = '' then
    raise exception 'suscripcion no valida';
  end if;
  if (p_suscripcion -> 'keys' ->> 'p256dh') is null
     or (p_suscripcion -> 'keys' ->> 'auth') is null then
    raise exception 'suscripcion no valida';
  end if;

  insert into public.push_subs (codigo, endpoint, suscripcion, plataforma, ultimo_uso)
  values ('ADMIN', v_endpoint, p_suscripcion, p_plataforma, now())
  on conflict (endpoint) do update
    set codigo = excluded.codigo,
        suscripcion = excluded.suscripcion,
        plataforma = excluded.plataforma,
        ultimo_uso = now();

  return jsonb_build_object('ok', true);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.tocar_presencia(p_codigo text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tocar_presencia(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nombre text;
  v_codigo text;
begin
  -- v1.3.1: el latido de Ernesto (su codigo admin -> fila 'ADMIN').
  if exists (
    select 1 from public.admin_config
    where clave = 'codigo_admin' and valor = p_codigo
  ) then
    insert into public.presencia (codigo, nombre, visto)
    values ('ADMIN', 'Ernesto', now())
    on conflict (codigo) do update
      set nombre = excluded.nombre,
          visto  = excluded.visto;

    return jsonb_build_object('ok', true);
  end if;

  select nombre into v_nombre
    from public.usuarios
   where codigo = p_codigo and activo = true;

  if v_nombre is null then
    raise exception 'no autorizado';
  end if;

  v_codigo := p_codigo;

  insert into public.presencia (codigo, nombre, visto)
  values (v_codigo, v_nombre, now())
  on conflict (codigo) do update
    set nombre = excluded.nombre,
        visto  = excluded.visto;

  return jsonb_build_object('ok', true);
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.ver_presencia(p_codigo text)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ver_presencia(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lista jsonb;
begin
  if not exists (
    select 1 from public.admin_config
    where clave = 'codigo_admin' and valor = p_codigo
  ) then
    raise exception 'codigo admin no valido';
  end if;

  select coalesce(jsonb_agg(fila order by fila.activo desc, fila.nombre), '[]'::jsonb)
    into v_lista
  from (
    select u.codigo as codigo,
           u.nombre as nombre,
           u.activo as activo,
           p.visto  as visto
      from public.usuarios u
      left join public.presencia p on p.codigo = u.codigo
  ) fila;

  return jsonb_build_object('ok', true, 'usuarios', v_lista);
end;
$function$;


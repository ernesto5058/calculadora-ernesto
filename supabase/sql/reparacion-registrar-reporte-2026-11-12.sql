-- =====================================================================
-- REPARACIÓN DE PRODUCCIÓN — registrar_reporte ROTA (2026-11-12)
-- Cazada por el humo E2E (TOP 6, flujo 2) en su corrida de estreno y
-- reproducida por Máximo con la petición exacta de la app (PEUEBA):
--   POST /rest/v1/rpc/registrar_reporte → HTTP 400 ·
--   42703 «column "telefono" of relation "reportes" does not exist»
-- TODO reporte de buscador rebotaba y quedaba en la cola del teléfono.
--
-- CAUSA (drift tabla↔puertas, verificado contra la base viva):
-- la tabla public.reportes cambió y las puertas no la siguieron:
--   · la columna del teléfono se llama HOY telefono_vendedor
--     (editar_reporte ya la usa bien; registrar_reporte insertaba
--     en «telefono», que ya no existe);
--   · el id de reportes es HOY uuid (estado_reportes ya pide uuid[]),
--     pero registrar_reporte declaraba v_id bigint y RETURNS bigint
--     («select/returning id into v_id» revienta al convertir uuid —
--     experimento: DO con v bigint → 22P02) y sincronizar_reportes
--     comparaba r.id contra un cursor bigint y casteaba marca_id
--     ::bigint (llamada viva → 42883 «uuid > bigint»: rota también).
--
-- ARREGLO (mínimo, conservando TODO lo demás):
--   · registrar_reporte: INSERT contra telefono_vendedor, v_id uuid
--     y RETURNS uuid (la app guarda el id tal cual y lo pasa a
--     estado_reportes(uuid[])). INTACTOS: la validación de adjuntos
--     adj_normalizar() de la Tanda Nº6, la idempotencia por op_id
--     (índice único reportes_op_id_uq + captura unique_violation)
--     y las guardas de usuario activo / chat_exigir_activo.
--   · sincronizar_reportes: el cursor p_desde_id pasa a uuid
--     (default NULL = inicio del sello p_desde) y marca_id devuelve
--     el uuid en texto, sin cast. Resto del cuerpo idéntico; su
--     definición no estaba versionada: queda aquí por primera vez.
--   Cambian tipos (retorno / parámetro) → DROP + CREATE; los GRANT
--   se reaplican EXACTOS a los vivos (anon, authenticated,
--   service_role). Aplicado en vivo el 2026-11-12 por Management API
--   y verificado re-leyendo pg_get_functiondef de ambas puertas.
--   La definición anterior de registrar_reporte en
--   adjuntos-validacion-tanda6-2026-11-12.sql queda como puntero a
--   este archivo (E7: una sola definición por puerta en el repo).
-- =====================================================================

DROP FUNCTION IF EXISTS public.registrar_reporte(text, text, numeric, numeric, numeric, text, text, text, text, text);

CREATE FUNCTION public.registrar_reporte(p_buscador text, p_tipo text, p_precio numeric, p_porc numeric, p_cantidad numeric, p_telefono text, p_nota text, p_adj_tipo text DEFAULT NULL::text, p_adj_datos text DEFAULT NULL::text, p_op_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id        uuid;
  v_bytes     int;
  v_adj_datos text;
  v_adj_mime  text;
  v_bytes64   bigint;
begin
  if not exists (select 1 from public.usuarios
                  where codigo = p_buscador and activo = true) then
    raise exception 'no autorizado';
  end if;
  perform public.chat_exigir_activo(p_buscador);

  -- LOCAL-FIRST: si esta operación ya entró, se devuelve su id.
  if p_op_id is not null then
    select id into v_id from public.reportes where op_id = p_op_id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  if p_adj_datos is not null then
    if coalesce(p_adj_tipo, '') <> 'foto' then
      raise exception 'adjunto no valido';
    end if;
    -- TANDA 6 (E-3): el comprobante debe ser imagen real validada.
    select o_datos, o_mime, o_bytes
      into v_adj_datos, v_adj_mime, v_bytes64
      from public.adj_normalizar('foto', null, p_adj_datos);
    v_bytes := v_bytes64::int;
  end if;

  begin
    insert into public.reportes
      (buscador, tipo, precio, porc, cantidad, telefono_vendedor, nota,
       adj_tipo, adj_nombre, adj_mime, adj_datos, adj_bytes, op_id)
    values
      (p_buscador, p_tipo, p_precio, p_porc, p_cantidad, p_telefono, p_nota,
       case when p_adj_datos is null then null else 'foto' end,
       case when p_adj_datos is null then null
            else 'comprobante.' || case v_adj_mime
                   when 'image/png' then 'png' when 'image/gif' then 'gif'
                   when 'image/webp' then 'webp' else 'jpg' end end,
       case when p_adj_datos is null then null else v_adj_mime end,
       v_adj_datos, v_bytes, p_op_id)
    returning id into v_id;
  exception when unique_violation then
    select id into v_id from public.reportes where op_id = p_op_id;
    return v_id;
  end;

  return v_id;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.registrar_reporte(text, text, numeric, numeric, numeric, text, text, text, text, text)
  TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Puerta: public.sincronizar_reportes — mismo drift (id uuid), misma
-- cura. Sin llamadores JS vivos en el repo (puerta de sincronización
-- del panel heredada); queda sana y versionada.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sincronizar_reportes(text, timestamp with time zone, bigint, integer);

CREATE FUNCTION public.sincronizar_reportes(p_codigo_admin text, p_desde timestamp with time zone DEFAULT NULL::timestamp with time zone, p_desde_id uuid DEFAULT NULL::uuid, p_limite integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_filas jsonb;
begin
  perform public.chat_identidad('ADMIN', p_codigo_admin);

  select coalesce(jsonb_agg(f.fila order by f.actualizado_en, f.id), '[]'::jsonb)
    into v_filas
    from (
      select (to_jsonb(r) - 'adj_datos')
             || jsonb_build_object('tiene_adj', r.adj_datos is not null) as fila,
             r.actualizado_en, r.id
        from public.reportes r
       where p_desde is null
          or (r.actualizado_en, r.id) > (p_desde, coalesce(p_desde_id, '00000000-0000-0000-0000-000000000000'::uuid))
       order by r.actualizado_en asc, r.id asc
       limit greatest(coalesce(p_limite, 200), 1)
    ) f;

  return jsonb_build_object(
    'ok', true,
    'filas', v_filas,
    'marca_sello', case when jsonb_array_length(v_filas) > 0
                        then v_filas -> -1 ->> 'actualizado_en' else null end,
    'marca_id', case when jsonb_array_length(v_filas) > 0
                     then v_filas -> -1 ->> 'id' else null end);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.sincronizar_reportes(text, timestamp with time zone, uuid, integer)
  TO anon, authenticated, service_role;

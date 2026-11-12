-- =====================================================================
-- TANDA Nº6 Inspector Ola 1 · Mi Negocio · E-3 (resto de servidor)
-- Validación de adjuntos EN EL SERVIDOR (la defensa del cliente,
-- srcSeguroAdj, llegó en v13; esta es la del servidor, que faltaba).
--
-- Antes: enviar_mensaje y registrar_reporte solo miraban el TIPO
-- declarado y un tamaño estimado (length*3/4). El adj_datos se
-- guardaba CRUDO: una cadena con comillas/onerror o un
-- data:text/html pasaba entera confiando en el cliente.
-- Ahora: toda adj_datos pasa por public.adj_normalizar(), que exige
-- dataURL/base64 ESTRICTO, mime en la lista blanca del tipo (la
-- misma ADJ_MIMES_OK del cliente), mime declarado == mime del
-- dataURL, firma mágica real para imagen/PDF, tamaño decodificado
-- ≤ 5 MB calculado en el servidor (p_adj_tam ya NO se cree), y
-- devuelve la forma CANÓNICA data:<mime>;base64,<cuerpo> que es
-- lo único que se guarda. Lo inválido se RECHAZA en la puerta.
-- Aplicado en vivo el 2026-11-12 (Management API) y verificado
-- re-leyendo pg_get_functiondef de las tres funciones.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.adj_normalizar(
  p_tipo text, p_mime text, p_datos text,
  OUT o_datos text, OUT o_mime text, OUT o_bytes bigint)
 RETURNS record
 LANGUAGE plpgsql
AS $function$
declare
  v_mime_decl text;
  v_body      text;
  v_head      text;
  v_pos       int;
begin
  if p_datos is null or p_datos = '' then
    raise exception 'adjunto no valido';
  end if;
  -- Pre-corte barato: 5 MB en base64 ocupan < 7.1 M de caracteres.
  if length(p_datos) > 7100000 then
    raise exception 'adjunto supera los 5 MB';
  end if;

  v_mime_decl := lower(split_part(coalesce(p_mime, ''), ';', 1));
  v_mime_decl := nullif(btrim(v_mime_decl), '');

  if p_datos like 'data:%' then
    -- data:<mime>[;parametro];base64,<cuerpo base64 estricto>
    if p_datos !~* '^data:[a-z0-9.+-]+/[a-z0-9.+-]+(;[a-z0-9.+=_-]+)*;base64,[A-Za-z0-9+/]+={0,2}$' then
      raise exception 'adjunto no valido';
    end if;
    o_mime := lower(substring(p_datos from '^data:([a-z0-9.+-]+/[a-z0-9.+-]+)'));
    v_pos  := position(';base64,' in lower(p_datos));
    v_body := substr(p_datos, v_pos + 8);
    if v_mime_decl is not null and v_mime_decl <> o_mime then
      raise exception 'adjunto no valido';
    end if;
  else
    -- Base64 pelado: el mime es el declarado (foto sin declarar = jpeg).
    if p_datos !~ '^[A-Za-z0-9+/]+={0,2}$' then
      raise exception 'adjunto no valido';
    end if;
    v_body := p_datos;
    o_mime := coalesce(v_mime_decl, case when p_tipo = 'foto' then 'image/jpeg' end);
    if o_mime is null then
      raise exception 'adjunto no valido';
    end if;
  end if;

  -- Lista blanca por tipo (la misma del cliente: ADJ_MIMES_OK).
  if p_tipo = 'foto' then
    if o_mime not in ('image/jpeg','image/png','image/gif','image/webp') then
      raise exception 'adjunto no valido';
    end if;
  elsif p_tipo = 'voz' then
    if o_mime not in ('audio/mp4','audio/webm','audio/ogg','audio/mpeg') then
      raise exception 'adjunto no valido';
    end if;
  elsif p_tipo = 'archivo' then
    if o_mime not in ('image/jpeg','image/png','image/gif','image/webp',
                      'audio/mp4','audio/webm','audio/ogg','audio/mpeg',
                      'application/pdf') then
      raise exception 'adjunto no valido';
    end if;
  else
    raise exception 'adjunto no valido';
  end if;

  -- Relleno base64 normalizado (longitud múltiplo de 4).
  if length(v_body) % 4 = 1 then
    raise exception 'adjunto no valido';
  elsif length(v_body) % 4 = 2 then
    v_body := v_body || '==';
  elsif length(v_body) % 4 = 3 then
    v_body := v_body || '=';
  end if;

  -- Tamaño REAL decodificado, calculado aquí (no el que declara el cliente).
  o_bytes := (length(v_body) * 3) / 4
           - (case when v_body like '%==' then 2 when v_body like '%=' then 1 else 0 end);
  if o_bytes > 5242880 then
    raise exception 'adjunto supera los 5 MB';
  end if;
  if o_bytes <= 0 then
    raise exception 'adjunto no valido';
  end if;

  -- Firma mágica: el contenido debe SER lo que el mime dice (imagen/PDF).
  if o_mime in ('image/jpeg','image/png','image/gif','image/webp','application/pdf') then
    begin
      v_head := encode(decode(left(v_body, 44), 'base64'), 'hex');
    exception when others then
      raise exception 'adjunto no valido';
    end;
    if (o_mime = 'image/jpeg' and v_head not like 'ffd8ff%')
       or (o_mime = 'image/png' and v_head not like '89504e470d0a1a0a%')
       or (o_mime = 'image/gif' and v_head not like '47494638%')
       or (o_mime = 'image/webp' and not (v_head like '52494646%' and substr(v_head, 17, 8) = '57454250'))
       or (o_mime = 'application/pdf' and v_head not like '25504446%') then
      raise exception 'adjunto no valido';
    end if;
  end if;

  -- Lo que se guarda es SOLO la forma canónica.
  o_datos := 'data:' || o_mime || ';base64,' || v_body;
  return;
end;
$function$;

-- ---------------------------------------------------------------------
-- Puerta: public.enviar_mensaje — endurecida en esta misma tanda.
-- Su definición canónica NUEVA vive en
-- supabase/sql/puertas-minegocio-vivas-2026-11-12.sql (snapshot
-- actualizado en la misma tanda; E7 del banco de puertas prohíbe
-- dos CREATE de la misma puerta en el repo). El cambio exacto:
--   · declara v_adj_datos/v_adj_mime y, si hay adjunto, hace
--     select o_datos, o_mime, o_bytes into ... from
--     public.adj_normalizar(p_adj_tipo, p_adj_mime, p_adj_datos);
--   · el INSERT guarda v_adj_datos (forma canónica), v_adj_mime
--     (validado) y v_bytes (calculado en el servidor; p_adj_tam
--     ya no se cree). El resto del cuerpo es idéntico al vivo.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Puerta: public.registrar_reporte — mismo cuerpo vivo, con la
-- misma validación (su definición NO estaba versionada en el repo:
-- queda aquí por primera vez, ya endurecida). El comprobante debe
-- ser una imagen real; adj_mime/adj_bytes salen de la validación,
-- no fijos ni declarados.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.registrar_reporte(p_buscador text, p_tipo text, p_precio numeric, p_porc numeric, p_cantidad numeric, p_telefono text, p_nota text, p_adj_tipo text DEFAULT NULL::text, p_adj_datos text DEFAULT NULL::text, p_op_id text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id        bigint;
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
      (buscador, tipo, precio, porc, cantidad, telefono, nota,
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

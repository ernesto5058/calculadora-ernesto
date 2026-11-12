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
-- Puerta: public.registrar_reporte — su definición canónica YA NO
-- vive aquí: el 2026-11-12 el humo E2E cazó que su INSERT usaba la
-- columna «telefono» (la tabla la llama telefono_vendedor) y que su
-- id bigint chocaba con el id uuid actual de reportes: todo reporte
-- rebotaba con 42703. La definición reparada (mismo cuerpo, con la
-- validación adj_normalizar de esta tanda intacta) vive en
-- supabase/sql/reparacion-registrar-reporte-2026-11-12.sql
-- (E7: una sola definición por puerta en el repo).
-- ---------------------------------------------------------------------

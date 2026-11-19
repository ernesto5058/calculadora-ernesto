-- INGESTA LOCAL DEL SENSOR (Mi Negocio v48, 2026-11-18).
-- Orden de Ernesto: el atajo ya no sube nada por red (la acción de
-- red moría por XPC); el SMS llega a Mi Negocio EN LOCAL y la app
-- lo guarda en su almacén del teléfono. Cuando la app detecta
-- internet, sincroniza por ESTA puerta: la misma disciplina de
-- las demás puertas de dinero (p_codigo admin + la fila nace en
-- sms_linea, que es de donde leen dinero_sms_sin_atribuir y
-- dinero_sms_atribuir — el registro sigue por el camino normal).
-- DEDUPE DOBLE, espejo del cerebro v19 (CHEQUEO 145):
--   1) por client_uuid (índice único sms_linea_client_uuid_uidx):
--      re-subir el mismo archivo devuelve la fila que ya existe;
--   2) por HUELLA (tipo + contraparte + monto + saldo resultante,
--      ventana ±1 día sobre la fecha original): la copia que la
--      operadora re-entrega con otro uuid NO nace dos veces —
--      devuelve el sms_id de la original contada.
-- La app manda el SMS ya parseado con el parser puerto literal
-- del cerebro (parsearSms); el cuerpo crudo viaja entero y queda
-- en sms_linea como verdad ejecutada, igual que por el cerebro.
create or replace function public.dinero_sms_ingresar(
  p_codigo text,
  p_client_uuid uuid,
  p_remitente text,
  p_cuerpo text,
  p_tipo text,
  p_monto_cup numeric,
  p_contraparte text,
  p_saldo_principal_cup numeric,
  p_parse_ok boolean,
  p_fecha_original timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if not public.dinero_es_admin(p_codigo) then
    raise exception 'codigo admin no valido';
  end if;
  if p_client_uuid is null then
    return jsonb_build_object('ok', false, 'motivo', 'sin_uuid');
  end if;
  if p_cuerpo is null or btrim(p_cuerpo) = '' then
    return jsonb_build_object('ok', false, 'motivo', 'sin_cuerpo');
  end if;

  -- 1) dedupe por uuid: el reenvío es inofensivo.
  select id into v_id from public.sms_linea
   where client_uuid = p_client_uuid;
  if v_id is not null then
    return jsonb_build_object('ok', true, 'sms_id', v_id,
                              'duplicado', true, 'por', 'uuid');
  end if;

  -- 2) dedupe por huella (solo eventos parseados con saldo: la
  -- huella sin saldo resultante no es huella).
  if coalesce(p_parse_ok, false)
     and p_tipo in ('recibido', 'transferido')
     and p_saldo_principal_cup is not null then
    select id into v_id from public.sms_linea
     where tipo = p_tipo
       and contraparte = p_contraparte
       and monto_cup = p_monto_cup
       and saldo_principal_cup = p_saldo_principal_cup
       and duplicado_de is null
       and coalesce(fecha_original, recibido_en)
           between coalesce(p_fecha_original, now()) - interval '1 day'
               and coalesce(p_fecha_original, now()) + interval '1 day'
     order by id asc
     limit 1;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'sms_id', v_id,
                                'duplicado', true, 'por', 'huella');
    end if;
  end if;

  -- 3) fila nueva.
  begin
    insert into public.sms_linea
      (remitente, cuerpo, tipo, monto_cup, contraparte,
       saldo_principal_cup, parse_ok, fecha_original, client_uuid)
    values
      (coalesce(p_remitente, 'ETECSA'), p_cuerpo,
       coalesce(p_tipo, 'otro'), p_monto_cup, p_contraparte,
       p_saldo_principal_cup, coalesce(p_parse_ok, false),
       p_fecha_original, p_client_uuid)
    returning id into v_id;
  exception when unique_violation then
    -- Carrera contra el índice único de uuid: la fila ya existe.
    select id into v_id from public.sms_linea
     where client_uuid = p_client_uuid;
    return jsonb_build_object('ok', true, 'sms_id', v_id,
                              'duplicado', true, 'por', 'uuid');
  end;

  return jsonb_build_object('ok', true, 'sms_id', v_id,
                            'duplicado', false);
end;
$$;

revoke all on function public.dinero_sms_ingresar(text, uuid, text, text, text, numeric, text, numeric, boolean, timestamptz) from public;
grant execute on function public.dinero_sms_ingresar(text, uuid, text, text, text, numeric, text, numeric, boolean, timestamptz) to anon, authenticated, service_role;

comment on function public.dinero_sms_ingresar(text, uuid, text, text, text, numeric, text, numeric, boolean, timestamptz) is
  'Ingesta local del Sensor (Mi Negocio v48): la app sube el SMS crudo parseado cuando detecta internet; dedupe por client_uuid y por huella de saldo (±1 día, espejo del cerebro v19). Devuelve el sms_id pa que la atribución siga por dinero_sms_atribuir.';

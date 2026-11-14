-- =====================================================================
-- T1 · DESTINO DE AVISO (enmienda de Ernesto, 2026-11-14): tocar la
-- notificación lleva HASTA el apartado exacto y marca el elemento.
-- El despachador y la autoprueba ahora viajan con 'ancla' (el id del
-- elemento en la app) además de 'tab':
--   tarifa_propuesta -> Tarifa  + tvPropuesta (la tarjeta viva)
--   alarma_*         -> Bandeja (la cola vive ahí; sin ancla propia)
--   espera_cumplida  -> Dinero  + dnVentas (ventas recientes)
--     OJO: antes viajaba 'Mi dinero', que NO es un id de módulo (el id
--     es 'Dinero'): la app descartaba el destino y el toque «no
--     llevaba a ningún lado» — parte del aviso «dormido».
--   prueba           -> Avisos  + avRegistro (el registro en la app)
-- La EF «avisos» pasa ancla/reporte_id en el payload push y en el
-- data de FCM; el SW la conserva y la app la marca con el anillo
-- dorado que se desvanece solo (marcarDestino en minegocio).
-- Definiciones tomadas de pg_get_functiondef el 2026-11-14 y
-- editadas solo en los jsonb de emisión: el resto es byte a byte.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.avisos_probar(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_para text;
begin
  if exists (select 1 from public.admin_config
              where clave = 'codigo_admin' and valor = p_codigo) then
    v_para := 'ADMIN';
  elsif exists (select 1 from public.usuarios
                 where codigo = p_codigo and activo = true) then
    v_para := p_codigo;
  else
    raise exception 'no autorizado';
  end if;

  perform public.avisos_emitir_evento(v_para, jsonb_build_object(
    'tipo',   'prueba',
    'prueba', true,
    'titulo', '✅ Avisos PRO: prueba',
    'cuerpo', 'Si ves este aviso, los avisos están llegando a este aparato.',
    'tag',    'avisos-pro-prueba',
    'tab',    'Avisos',
    'ancla',  'avRegistro'
  ));
  return jsonb_build_object('ok', true, 'para', v_para, 'encolado', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.avisos_despachar_pendientes(p_incluir_pruebas boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r        record;
  v_clave  text;
  v_titulo text;
  v_cuerpo text;
  v_n      int := 0;
  v_claves text[] := '{}';
begin
  -- 4a) Propuesta grande de Tarifa Viva esperando la decisión de Ernesto
  for r in
    select * from public.tarifa_viva_historial
     where decision = 'propuesta' and estado = 'pendiente'
     order by creado_en asc
  loop
    v_clave  := 'tarifa-propuesta-' || r.id::text;
    v_titulo := '📊 Propuesta de Tarifa Viva';
    v_cuerpo := 'El mercado se movió ' || public.avisos_fmt_num(r.delta_pct)
      || '% — fuera de tu banda del ±2%. Referencia propuesta: '
      || public.avisos_fmt_num(r.ingreso_nuevo)
      || ' por recarga de 360 (vigente: '
      || public.avisos_fmt_num(r.ingreso_viejo) || '). Libro propuesto: '
      || public.avisos_fmt_num(r.libro_nuevo)
      || '. Decídela en Mi Negocio → Tarifa.';
    insert into public.avisos_log
      (clave, evento_tipo, para, titulo, canal, resultado)
    values (v_clave, 'tarifa_propuesta', 'ADMIN', v_titulo, 'despacho', 'encolado')
    on conflict (clave) where canal = 'despacho' do nothing;
    if not found then continue; end if;
    perform public.avisos_emitir_evento('ADMIN', jsonb_build_object(
      'tipo', 'tarifa_propuesta', 'titulo', v_titulo, 'cuerpo', v_cuerpo,
      'tab', 'Tarifa', 'ancla', 'tvPropuesta', 'clave', v_clave, 'tag', 'tarifa-propuesta'));
    v_n := v_n + 1; v_claves := v_claves || v_clave;
  end loop;

  -- 4b) Alarmas del sistema de vueltas (la cola de arbitraje de Ernesto)
  for r in
    select * from public.dinero_esperas_avisos
     where (not es_prueba or p_incluir_pruebas)
     order by desde asc
  loop
    v_clave := 'alarma-' || r.clase_alarma || '-' || r.ref_id;
    if r.clase_alarma = 'espera_vencida' then
      v_titulo := '⏰ Espera vencida';
      v_cuerpo := 'La compra que reportó ' || coalesce(r.buscador, 'un buscador')
        || ' no se confirmó con su prueba dentro de la ventana. Está en tu cola de arbitraje.';
    elsif r.clase_alarma = 'sms_sin_match' then
      v_titulo := '📩 SMS sin confirmar';
      v_cuerpo := 'Entró un SMS de saldo que no cuadró con ningún parte. Está en tu cola de arbitraje, sin asentar.';
    elsif r.clase_alarma = 'pago_sin_match' then
      v_titulo := '🏦 Transferencia sin confirmar';
      v_cuerpo := 'Entró una transferencia que no cuadró con ningún parte. Está en tu cola de arbitraje, sin asentar.';
    elsif r.clase_alarma = 'espera_rechazada' then
      v_titulo := '⚠️ Espera rechazada';
      v_cuerpo := 'Una espera quedó rechazada en el sistema de vueltas. Revísala en tu cola de arbitraje.';
    else
      v_titulo := '🔔 Aviso de vueltas';
      v_cuerpo := 'Hay una novedad del sistema de vueltas en tu cola de arbitraje.';
    end if;
    if r.es_prueba then v_titulo := '🧪 PRUEBA · ' || v_titulo; end if;
    insert into public.avisos_log
      (clave, evento_tipo, para, titulo, canal, resultado, es_prueba)
    values (v_clave, 'alarma_' || r.clase_alarma, 'ADMIN', v_titulo,
            'despacho', 'encolado', r.es_prueba)
    on conflict (clave) where canal = 'despacho' do nothing;
    if not found then continue; end if;
    perform public.avisos_emitir_evento('ADMIN', jsonb_build_object(
      'tipo', 'alarma_' || r.clase_alarma, 'titulo', v_titulo, 'cuerpo', v_cuerpo,
      'tab', 'Bandeja', 'clave', v_clave, 'tag', 'alarma-vueltas',
      'prueba', r.es_prueba));
    v_n := v_n + 1; v_claves := v_claves || v_clave;
  end loop;

  -- 4c) Esperas cumplidas: el parte se confirmó con su prueba y la
  -- vuelta se asentó sola — Ernesto se entera sin abrir la app.
  for r in
    select * from public.dinero_esperas
     where estado = 'cumplida' and cumplida_en is not null
       and (not es_prueba or p_incluir_pruebas)
     order by cumplida_en asc
  loop
    v_clave  := 'espera-cumplida-' || r.id::text;
    v_titulo := '✅ Espera cumplida';
    v_cuerpo := 'El parte de ' || r.buscador_codigo
      || ' se confirmó con su prueba: entraron '
      || public.avisos_fmt_num(r.cantidad_esperada)
      || case when r.tipo = 'saldo' then ' de saldo'
              else ' CUP por transferencia' end
      || ' y la vuelta quedó asentada sola.';
    if r.es_prueba then v_titulo := '🧪 PRUEBA · ' || v_titulo; end if;
    insert into public.avisos_log
      (clave, evento_tipo, para, titulo, canal, resultado, es_prueba)
    values (v_clave, 'espera_cumplida', 'ADMIN', v_titulo,
            'despacho', 'encolado', r.es_prueba)
    on conflict (clave) where canal = 'despacho' do nothing;
    if not found then continue; end if;
    perform public.avisos_emitir_evento('ADMIN', jsonb_build_object(
      'tipo', 'espera_cumplida', 'titulo', v_titulo, 'cuerpo', v_cuerpo,
      'tab', 'Dinero', 'ancla', 'dnVentas', 'clave', v_clave, 'tag', 'espera-cumplida',
      'prueba', r.es_prueba));
    v_n := v_n + 1; v_claves := v_claves || v_clave;
  end loop;

  return jsonb_build_object('ok', true, 'despachados', v_n,
                            'claves', to_jsonb(v_claves));
end;
$function$;
revoke all on function public.avisos_despachar_pendientes(boolean)
  from public, anon, authenticated;
grant execute on function public.avisos_probar(text) to anon, authenticated;

-- =====================================================================
-- PLANTILLA DEL ASESOR (2026-11-14) — decisión de Ernesto: el Asesor
-- usa SU PLANTILLA GUARDADA y deja de depender de tener una oferta
-- abierta como base.
--
-- Qué hace esta migración (todo ADITIVO, servidor solamente):
--   1. Tabla guia_plantilla (fila única id=1): el bloque clonable de
--      su oferta de venta más reciente (viva o histórica), sembrado
--      por el lector desde la API con las credenciales de «Vigila
--      Mercado» (modo 'semilla_plantilla'). Guarda SOLO detalles de
--      pago y parámetros de forma — jamás montos ni tasas: esos los
--      calcula siempre el asesor del mercado vivo.
--   2. guia_asesor_interno: la base pasa a ser (a) oferta de venta
--      abierta viva → 'oferta_viva'; (b) si no hay, la PLANTILLA →
--      'plantilla'. El motivo sin_oferta_base solo sobrevive si no
--      existe ninguna de las dos. La salida gana el bloque 'base'.
--   3. guia_preparar_interna (INTERNA, sin acceso público): el ciclo
--      de la preparada que faltaba — barrido de vencidas + llamada al
--      asesor + INSERT de la preparada en mercado_acciones (origen
--      'asesor', expira a los 10 min, snapshot con base_fuente).
--   4. guia_subir (puerta admin): preparada → pendiente + el disparo
--      pg_net de siempre a mercado-actuar. La puerta blindada NO se
--      toca: re-verifica collar, topes, banda y doble lectura igual.
--   5. guia_descartar (puerta admin): preparada → descartada +
--      silencio del asesor (silencio_asesor_h de la config).
--   6. pg_cron 'guia-asesor-cada-15min' → guia_preparar_interna.
--   7. guia_config.preparacion_activa = true (la decisión de Ernesto
--      ES el encendido; una preparada NO es una subida: publicar
--      sigue exigiendo su toque y la puerta blindada).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) LA PLANTILLA (datos de pago: RLS cerrado, solo service_role y
--    funciones definer la leen; jamás viaja en fotos ni en bitácoras)
-- ---------------------------------------------------------------------
create table if not exists public.guia_plantilla (
  id          integer primary key,
  detalles    jsonb,          -- el array «details» clonable, tal cual la API
  bloque      jsonb,          -- forma: coin/tipo/offer_kind/order_min/max/requirements/only_*
  oferta_uuid text,           -- la oferta histórica de la que se sembró
  fuente      text,           -- 'historial_api'
  sembrada_en timestamptz
);
alter table public.guia_plantilla enable row level security;

-- ---------------------------------------------------------------------
-- 2) ASESOR INTERNO con prioridad de base (definición viva + parches)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guia_asesor_interno(p_prueba boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cfg record; v_foto record; v_tar record; v_mc record;
  v_linea numeric; v_linea_en timestamptz;
  v_lotes jsonb; v_fondo numeric; v_reserva numeric := 0;
  v_inicio timestamptz := ((now() at time zone 'America/Havana')::date)::timestamp
                           at time zone 'America/Havana';
  v_monto_hoy numeric; v_hora integer; v_prev record;
  v_calc jsonb; v_sil timestamptz;
  v_puesto boolean; v_habana_hoy date :=
    (now() at time zone 'America/Havana')::date;
  -- PLANTILLA (2026-11-14): base = oferta viva, si no la plantilla.
  v_plant record; v_base_viva boolean; v_base boolean; v_base_fuente text;
begin
  select * into v_cfg from public.guia_config where id = 1;
  select * into v_tar from public.tarifa where id = 1;
  select * into v_mc from public.mercado_config where id = 1;
  select * into v_foto from public.mercado_fotos
   order by recibida_en desc limit 1;
  select * into v_plant from public.guia_plantilla where id = 1;

  v_base_viva := coalesce(
    (v_foto.detalle #>> '{propias,base_venta}')::boolean, false);
  v_base := v_base_viva or (
    v_plant.id is not null
    and jsonb_typeof(v_plant.detalles) = 'array'
    and jsonb_array_length(v_plant.detalles) > 0);
  v_base_fuente := case when v_base_viva then 'oferta_viva'
                        when v_base then 'plantilla' else null end;

  select saldo_principal_cup, recibido_en into v_linea, v_linea_en
    from public.sms_linea
   where saldo_principal_cup is not null
   order by id desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'cantidad', cantidad_restante, 'costo', costo_restante_cup)
           order by creado_en), '[]'::jsonb)
    into v_lotes
    from public.dinero_lotes_saldo
   where es_prueba = p_prueba and cantidad_restante > 0;

  v_fondo := public.dinero_saldo('fondo', p_prueba);
  select coalesce(sum(greatest(
           public.dinero_cupo(
             (select capital_total from public.dinero_fondo
               where es_prueba = p_prueba), a.porciento)
           - coalesce((select sum(e.monto_original)
                         from public.dinero_entregas e
                        where e.buscador_codigo = a.buscador_codigo
                          and e.es_prueba = p_prueba
                          and e.estado in ('entregado', 'en_calle')), 0),
           0)), 0)
    into v_reserva
    from public.dinero_asignaciones a where a.es_prueba = p_prueba;

  select coalesce(sum(monto_qusd), 0) into v_monto_hoy
    from public.mercado_acciones
   where estado = 'ejecutada' and creada_en >= v_inicio;
  select count(*)::int into v_hora
    from public.mercado_acciones
   where estado in ('ejecutada', 'ejecutando')
     and creada_en > now() - interval '1 hour';
  select * into v_prev from public.mercado_acciones
   where origen = 'asesor' and estado = 'preparada'
     and expira_en > now()
   order by creada_en desc limit 1;
  select greatest(silencio_asesor_hasta, preparada_silencio_hasta)
    into v_sil from public.guia_estado where id = 1;
  v_puesto := v_habana_hoy between v_cfg.puesto_desde and v_cfg.puesto_hasta;

  v_calc := public.guia_calc_asesor(jsonb_build_object(
    'ahora', now(),
    'foto', jsonb_build_object(
      'usable', (v_foto.id is not null and v_foto.libro_ok and v_foto.fresca
        and v_foto.recibida_en > now() - interval '20 minutes'),
      'id', v_foto.id, 'recibida_en', v_foto.recibida_en,
      'nivel20', v_foto.etecsa_nivel20, 'top_venta', v_foto.etecsa_top_venta,
      'promedio_venta', v_foto.etecsa_promedio_venta,
      'senal', v_foto.detalle -> 'analisis' -> 'senal',
      'menu', v_foto.detalle -> 'analisis' -> 'menu',
      'ejecutable20', jsonb_build_object(
        'tasa', v_foto.detalle #>> '{analisis,ejecutable,usd20,tasa}',
        'usd', v_foto.detalle #>> '{analisis,ejecutable,usdAccion,usd}'),
      'duras', v_foto.detalle -> 'analisis' -> 'duras',
      'transferencia', v_foto.detalle -> 'analisis' -> 'transferencia'),
    'tarifa', jsonb_build_object(
      'salida_ref', v_tar.salida_ref,
      'ingreso_ref360', v_tar.ingreso_ref360,
      'libro_ref', v_tar.libro_ref),
    'costo_ref360', v_mc.costo_ref360,
    'posicion', jsonb_build_object(
      'linea_saldo', v_linea, 'linea_en', v_linea_en,
      'lotes', v_lotes,
      'comprometido_saldo', (v_foto.detalle #>> '{propias,comprometido_saldo}')::numeric,
      'base_venta', v_base,
      'base_fuente', v_base_fuente,
      'qUSD', (v_foto.detalle #>> '{qUSD,balance}')::numeric,
      'fondo', v_fondo, 'reserva_cupos', v_reserva,
      'mejor_nivel20_hoy', (select max(etecsa_nivel20) from public.mercado_fotos
        where recibida_en >= v_inicio)),
    'puerta', jsonb_build_object(
      'tope_oferta', v_mc.accion_monto_qusd,
      'monto_hoy', v_monto_hoy, 'acciones_hora', v_hora,
      'preparada_viva', v_prev.id is not null,
      'detenidas', coalesce(v_mc.acciones_detenidas, false),
      'pausadas', coalesce(v_mc.acciones_pausadas, false)),
    'cfg', jsonb_build_object(
      'colchon', v_cfg.colchon_saldo, 'mat_fifo', v_cfg.mat_asesor_fifo),
    'silencio_hasta', v_sil,
    'promo_puesto', jsonb_build_object(
      'activa', v_puesto, 'ref_cierre', v_foto.etecsa_promedio_venta)));

  return jsonb_build_object(
    'ok', true,
    'foto', case when v_foto.id is null then null else jsonb_build_object(
      'id', v_foto.id, 'recibida_en', v_foto.recibida_en,
      'origen', v_foto.origen, 'fresca', v_foto.fresca,
      'libro_ok', v_foto.libro_ok,
      'usable', (v_foto.libro_ok and v_foto.fresca
        and v_foto.recibida_en > now() - interval '20 minutes')) end,
    'tarifa', jsonb_build_object(
      'ingreso_ref360', v_tar.ingreso_ref360, 'libro_ref', v_tar.libro_ref,
      'salida_ref', v_tar.salida_ref, 'costo_ref360', v_mc.costo_ref360),
    'base', jsonb_build_object(
      'fuente', v_base_fuente,
      'plantilla', case when v_plant.id is null then null else
        jsonb_build_object('oferta_uuid', v_plant.oferta_uuid,
          'fuente', v_plant.fuente, 'sembrada_en', v_plant.sembrada_en) end),
    'comprometido_legible',
      (v_foto.detalle -> 'propias' ->> 'comprometido_saldo') is not null,
    'qUSD_legible', (v_foto.detalle -> 'qUSD' ->> 'balance') is not null,
    'calculo', v_calc,
    'preparada_viva', case when v_prev.id is null then null else jsonb_build_object(
      'id', v_prev.id, 'tasa', v_prev.tasa, 'monto_qusd', v_prev.monto_qusd,
      'ganancia360', v_prev.ganancia360, 'expira_en', v_prev.expira_en,
      'contexto', v_prev.contexto) end,
    'contadores', jsonb_build_object(
      'hoy_qusd', v_monto_hoy, 'diario_max', 120,
      'acciones_hora', v_hora, 'hora_max', 2,
      'tope_oferta', v_mc.accion_monto_qusd),
    'silencio_hasta', v_sil);
end;
$function$;

-- ---------------------------------------------------------------------
-- 3) EL CICLO DE LA PREPARADA (interna: solo postgres/service_role)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guia_preparar_interna(p_forzar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cfg record; v_int jsonb; v_prep jsonb; v_id uuid; v_prev record;
begin
  select * into v_cfg from public.guia_config where id = 1;
  if not coalesce(v_cfg.preparacion_activa, false) and not p_forzar then
    return jsonb_build_object('ok', false, 'motivo', 'preparacion_inactiva');
  end if;

  -- una sola preparación a la vez, también entre ciclos solapados
  perform pg_advisory_xact_lock(hashtext('guia_preparar_interna'));

  -- barrido de vencidas (R9: todo vence)
  update public.mercado_acciones
     set estado = 'vencida'
   where origen = 'asesor' and estado = 'preparada' and expira_en < now();

  v_int := public.guia_asesor_interno(false);
  v_prep := v_int #> '{calculo,preparada}';
  -- OJO: un jsonb 'null' NO es SQL NULL — sin esta comparación el
  -- ciclo intentaría insertar una preparada vacía (lo cazó la corrida
  -- real del cron de las 06:15 UTC contra el NOT NULL de tasa).
  if v_prep is null or v_prep = 'null'::jsonb then
    return jsonb_build_object('ok', true, 'preparada', null,
      'motivos', v_int #> '{calculo,motivos_no_prepara}',
      'base', v_int -> 'base');
  end if;

  -- idempotencia: si ya vive una, se devuelve esa (el cálculo ya lo
  -- frena con 'ya_hay_preparada'; esto es el cinturón del cinturón)
  select * into v_prev from public.mercado_acciones
   where origen = 'asesor' and estado = 'preparada' and expira_en > now()
   order by creada_en desc limit 1;
  if v_prev.id is not null then
    return jsonb_build_object('ok', true, 'ya_existia', true,
      'preparada', jsonb_build_object('id', v_prev.id, 'tasa', v_prev.tasa,
        'monto_qusd', v_prev.monto_qusd, 'expira_en', v_prev.expira_en));
  end if;

  insert into public.mercado_acciones
    (origen, tipo, moneda, tasa, monto_qusd, ganancia360, foto_id,
     expira_en, contexto, detalle, estado)
  values
    ('asesor', 'crear_venta_saldo', 'ETECSA',
     (v_prep ->> 'tasa')::numeric, (v_prep ->> 'monto_qusd')::numeric,
     (v_prep ->> 'ganancia360')::numeric,
     (v_int #>> '{foto,id}')::uuid,
     now() + interval '10 minutes',
     jsonb_build_object(
       'via', 'asesor', 'peldano', v_prep ->> 'peldano',
       'receive', (v_prep ->> 'receive')::numeric,
       'ganancia_fifo', (v_prep ->> 'ganancia_fifo')::numeric,
       'porques', v_prep -> 'porques',
       'aviso_promo', v_prep -> 'aviso_promo',
       'base_fuente', v_int #>> '{base,fuente}',
       'vendible', (v_int #>> '{calculo,posicion,vendible}')::numeric,
       'equilibrio', (v_int #>> '{calculo,equilibrio}')::numeric,
       'foto_recibida_en', v_int #>> '{foto,recibida_en}'),
     jsonb_build_object(
       'fifo', v_prep -> 'fifo',
       'ganancia_costo_dia', (v_prep ->> 'ganancia_costo_dia')::numeric),
     'preparada')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'preparada', jsonb_build_object(
    'id', v_id, 'tasa', (v_prep ->> 'tasa')::numeric,
    'monto_qusd', (v_prep ->> 'monto_qusd')::numeric,
    'receive', (v_prep ->> 'receive')::numeric,
    'ganancia_fifo', (v_prep ->> 'ganancia_fifo')::numeric,
    'base_fuente', v_int #>> '{base,fuente}',
    'expira_en', now() + interval '10 minutes'));
end;
$function$;
revoke execute on function public.guia_preparar_interna(boolean)
  from public, anon, authenticated;
grant execute on function public.guia_preparar_interna(boolean)
  to service_role;

-- ---------------------------------------------------------------------
-- 4) SUBIR (puerta admin): preparada → pendiente + disparo pg_net.
--    La plantilla aporta SOLO la disponibilidad de base; los detalles
--    de pago jamás se copian a la bitácora (la puerta blindada lee lo
--    que necesita por su propio canal al ejecutar, como siempre).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guia_subir(p_codigo text, p_accion uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_a record; v_url text; v_secr text; v_net bigint;
begin
  if not public.admin_es_valido(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'no_admin');
  end if;
  select * into v_a from public.mercado_acciones where id = p_accion;
  if v_a.id is null or v_a.origen <> 'asesor' then
    return jsonb_build_object('ok', false, 'motivo', 'no_es_preparada_asesor');
  end if;
  if v_a.estado <> 'preparada' then
    return jsonb_build_object('ok', false, 'motivo',
      'estado_' || v_a.estado);
  end if;
  if v_a.expira_en < now() then
    update public.mercado_acciones set estado = 'vencida' where id = p_accion;
    return jsonb_build_object('ok', false, 'motivo', 'vencida');
  end if;

  update public.mercado_acciones
     set estado = 'pendiente',
         contexto = coalesce(contexto, '{}'::jsonb) || jsonb_build_object(
           'via', 'guia_subir',
           'base_fuente', contexto ->> 'base_fuente')
   where id = p_accion and estado = 'preparada';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'carrera_perdida');
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'mercado_project_url';
  select decrypted_secret into v_secr
    from vault.decrypted_secrets where name = 'mercado_actuar_secret';
  if v_url is null or v_secr is null then
    return jsonb_build_object('ok', false, 'codigo', 'sin_ruta',
      'motivo', 'La ruta interna de la puerta no está preparada: la acción quedó pendiente pero sin disparar.',
      'accion_id', p_accion);
  end if;

  select net.http_post(
    url := v_url || '/functions/v1/mercado-actuar',
    body := jsonb_build_object('secreto', v_secr, 'accion_id', p_accion),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 90000
  ) into v_net;

  return jsonb_build_object('ok', true, 'accion_id', p_accion,
    'estado', 'pendiente', 'disparo', v_net);
end;
$function$;

-- ---------------------------------------------------------------------
-- 5) DESCARTAR (puerta admin) + silencio del asesor
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guia_descartar(
  p_codigo text, p_accion uuid, p_motivo text DEFAULT 'ahora_no')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cfg record;
begin
  if not public.admin_es_valido(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'no_admin');
  end if;
  select * into v_cfg from public.guia_config where id = 1;
  update public.mercado_acciones
     set estado = 'descartada', resuelta_en = now(),
         detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object(
           'descarte_motivo', coalesce(p_motivo, 'ahora_no'))
   where id = p_accion and origen = 'asesor' and estado = 'preparada';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_descartable');
  end if;
  if coalesce(p_motivo, 'ahora_no') = 'ahora_no' then
    update public.guia_estado
       set silencio_asesor_hasta =
             now() + (v_cfg.silencio_asesor_h * interval '1 hour'),
           actualizado = now()
     where id = 1;
  end if;
  return jsonb_build_object('ok', true, 'descartada', p_accion);
end;
$function$;

-- ---------------------------------------------------------------------
-- 6) EL CICLO AUTOMÁTICO (el «jobid 19» que el diseño prometía)
-- ---------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('guia-asesor-cada-15min');
exception when others then null;
end $$;
select cron.schedule('guia-asesor-cada-15min', '*/15 * * * *',
  'select public.guia_preparar_interna(false)');

-- ---------------------------------------------------------------------
-- 7) ENCENDIDO (la decisión de Ernesto de 2026-11-14)
-- ---------------------------------------------------------------------
update public.guia_config set preparacion_activa = true, actualizado = now()
 where id = 1;

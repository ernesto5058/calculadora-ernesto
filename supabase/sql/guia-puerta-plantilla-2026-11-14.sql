-- =====================================================================
-- PUERTA DE SUBIDA — LA PREPARADA LLEVA LA PLANTILLA (2026-11-14)
--
-- Reparación de la doble rotura diagnosticada el 2026-11-14:
--   (1) guia_subir no pasaba los details y la preparada ni siquiera
--       los guardaba: mercado-actuar los re-clonaba del listado de
--       la API, que con credenciales de app devuelve vacío.
--   (2) logica-actuar exigía details como ARRAY y negaba con
--       detalles_desconocidos — los details reales son un OBJETO.
--   (3) el payload imponía requirements fijos {25 ops, 4,5★} ajenos
--       a la oferta real de Ernesto (la suya trae requirements null).
-- Los puntos (2) y (3) se reparan en logica-actuar.js; este SQL es
-- el punto (1) del lado del servidor:
--
-- guia_preparar_interna: el snapshot (contexto) de la preparada
-- nace CON la plantilla del par (ETECSA, sell) — detalles y bloque
-- leídos de guia_plantilla en el momento de preparar. La puerta
-- usa esos details (la oferta viva legible sigue teniendo
-- prioridad, como define guia_asesor_interno); si un snapshot
-- viejo no los trae, la puerta los lee de guia_plantilla al
-- momento de subir (dep leerPlantilla de mercado-actuar).
-- La plantilla y su siembra (id=1) NO se tocan. guia_subir no
-- cambia: sigue pasando solo el id — la acción misma ya lleva
-- todo lo que la puerta necesita.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.guia_preparar_interna(p_forzar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cfg record; v_int jsonb; v_prep jsonb; v_id uuid; v_prev record;
  -- PUERTA (2026-11-14): la plantilla del par (ETECSA, sell) que
  -- viaja en el snapshot de la preparada pa que la puerta de
  -- subida use SUS details sin re-clonar del listado de la API.
  v_plant record;
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

  -- la plantilla es POR (moneda, lado): la misma fila que lee
  -- guia_asesor_interno pa reconocer la base
  select * into v_plant from public.guia_plantilla
   where moneda = 'ETECSA' and tipo = 'sell'
   order by sembrada_en desc nulls last limit 1;

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
       'demanda', v_prep -> 'demanda',
       'receive', (v_prep ->> 'receive')::numeric,
       'ganancia_fifo', (v_prep ->> 'ganancia_fifo')::numeric,
       'porques', v_prep -> 'porques',
       'aviso_promo', v_prep -> 'aviso_promo',
       'base_fuente', v_int #>> '{base,fuente}',
       'plantilla', case when v_plant.id is null then null else
         jsonb_build_object('detalles', v_plant.detalles,
           'bloque', v_plant.bloque,
           'oferta_uuid', v_plant.oferta_uuid) end,
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
    'snapshot_plantilla', v_plant.id is not null,
    'expira_en', now() + interval '10 minutes'));
end;
$function$


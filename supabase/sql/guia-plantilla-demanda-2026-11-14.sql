-- =====================================================================
-- SIEMBRA DE LA PLANTILLA + DEMANDA EN EL ASESOR (2026-11-14)
--
-- Contexto: la obra anterior dejó la maquinaria de la plantilla
-- construida pero guia_plantilla VACÍA, porque con las credenciales
-- de app «Vigila Mercado» la API no expone los «details» de ninguna
-- oferta (CHEQUEO 82). Los datos de ESTA siembra se leyeron de la
-- SESIÓN DEL DUEÑO en qvapay.com el 2026-11-14: su oferta de venta
-- ETECSA más reciente (uuid 9d875807-dbb9-4384-b95e-72dc52d5914e,
-- creada 2026-11-08, cancelada; $48,34 → 17.403 ETECSA).
--
-- Qué hace esta migración (todo ADITIVO, servidor solamente):
--   1. guia_plantilla gana (moneda, tipo): la plantilla es POR
--      moneda/lado — la tabla y la puerta la tratan así, con índice
--      único por par. Esta siembra es SOLO ETECSA·sell.
--   2. SIEMBRA del bloque clona­ble real de esa oferta:
--      detalles = {"Celular":"51231558"} (verbatim de la sesión) y
--      bloque con coin/tipo/offer_kind/order_min/order_max/
--      requirements/message. La plantilla aporta SOLO detalles y
--      forma — jamás montos ni tasas (regla del CHEQUEO 82).
--      ⚠ LOS DETAILS DE CLASICA QUEDAN DESCARTADOS POR ORDEN DE
--      ERNESTO: la operación vieja de CLASICA traía la tarjeta
--      …6529 DE SU TÍO — datos de un tercero = veneno: jamás se
--      siembra plantilla CLASICA de esa oferta ni se usa como
--      referencia; Clásica queda SIN plantilla hasta que Ernesto
--      tenga su Clásica propia.
--   3. guia_asesor_interno: la plantilla se busca por (ETECSA,
--      sell) y los «details» se aceptan en su forma REAL de QvaPay:
--      un OBJETO con claves (la definición anterior exigía ARRAY —
--      con el objeto verdadero la base jamás habría nacido).
--   4. DEMANDA cableada según la especificación del informe de
--      demanda-pago: el interno lee la última demanda_mediciones
--      de ETECSA y pasa el bloque al cálculo puro —
--        · usable solo si la medición tiene ≤15 min y la señal
--          está presente (salida_cima legible y termómetro con
--          datos); vieja o ausente se DECLARA (declaracion:
--          sin_medicion|medicion_vieja|senal_ausente) y el asesor
--          prepara SIN ella: silencio honesto, jamás relleno.
--        · usable: tope_usd = salida_cima_usd_h × ventana, con
--          ventana = demanda_config.ventana_absorcion_min (120 min
--          = 2 h): el monto preparado se topa además por la
--          profundidad absorbible de la banda.
--        · el porqué de demanda (termómetro + salida de cima +
--          vida de cima, y el tope si ató) entra en los porqués y
--          en el snapshot de la preparada (contexto.demanda).
--   5. guia_preparar_interna: el contexto de la preparada lleva el
--      bloque demanda del cálculo (la bitácora cuenta la historia
--      completa). Nada más cambia: estado explícito, candado y
--      guarda jsonb-null intactos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) LA PLANTILLA ES POR (moneda, lado)
-- ---------------------------------------------------------------------
alter table public.guia_plantilla add column if not exists moneda text;
alter table public.guia_plantilla add column if not exists tipo text;
create unique index if not exists guia_plantilla_moneda_tipo_idx
  on public.guia_plantilla (moneda, tipo) where moneda is not null;

-- ---------------------------------------------------------------------
-- 2) LA SIEMBRA — ETECSA·sell, desde la sesión del dueño (2026-11-14)
-- ---------------------------------------------------------------------
insert into public.guia_plantilla
  (id, detalles, bloque, oferta_uuid, fuente, sembrada_en, moneda, tipo)
values
  (1, '{"Celular": "51231558"}'::jsonb,
   '{"coin": "ETECSA", "tipo": "sell", "offer_kind": "fixed",
     "order_min": null, "order_max": null, "requirements": null,
     "message": "Enviar SMS al 51231558.!!"}'::jsonb,
   '9d875807-dbb9-4384-b95e-72dc52d5914e', 'sesion_dueno', now(),
   'ETECSA', 'sell')
on conflict (id) do update set
  detalles = excluded.detalles, bloque = excluded.bloque,
  oferta_uuid = excluded.oferta_uuid, fuente = excluded.fuente,
  sembrada_en = excluded.sembrada_en,
  moneda = excluded.moneda, tipo = excluded.tipo;

-- ---------------------------------------------------------------------
-- 3) ASESOR INTERNO — plantilla por (moneda, lado) con details en su
--    forma real (objeto) + bloque de demanda pa el cálculo
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
  -- DEMANDA (2026-11-14): última medición ETECSA + ventana de absorción.
  v_dem record; v_dem_vent_min int; v_dem_edad_min numeric;
  v_dem_ausente boolean; v_dem_usable boolean; v_dem_decl text;
  v_dem_tope numeric;
begin
  select * into v_cfg from public.guia_config where id = 1;
  select * into v_tar from public.tarifa where id = 1;
  select * into v_mc from public.mercado_config where id = 1;
  select * into v_foto from public.mercado_fotos
   order by recibida_en desc limit 1;
  -- La plantilla es POR (moneda, lado): esta siembra es ETECSA·sell.
  -- Los «details» reales de QvaPay son un OBJETO (ej. {"Celular": …}):
  -- se acepta objeto con claves o array no vacío; jamás se exige array.
  select * into v_plant from public.guia_plantilla
   where moneda = 'ETECSA' and tipo = 'sell'
   order by sembrada_en desc nulls last limit 1;

  v_base_viva := coalesce(
    (v_foto.detalle #>> '{propias,base_venta}')::boolean, false);
  v_base := v_base_viva or (
    v_plant.id is not null
    and v_plant.detalles is not null
    and ((jsonb_typeof(v_plant.detalles) = 'object'
          and (select count(*) from jsonb_object_keys(v_plant.detalles)) > 0)
         or (jsonb_typeof(v_plant.detalles) = 'array'
             and jsonb_array_length(v_plant.detalles) > 0)));

  -- DEMANDA: la medición manda solo si es fresca (≤15 min) y la señal
  -- está presente; si no, se declara y el asesor prepara sin ella.
  select * into v_dem from public.demanda_mediciones
   where moneda = 'ETECSA' order by medida_en desc limit 1;
  select ventana_absorcion_min into v_dem_vent_min
    from public.demanda_config where id = 1;
  v_dem_edad_min := case when v_dem.id is null then null
    else extract(epoch from (now() - v_dem.medida_en)) / 60.0 end;
  v_dem_ausente := v_dem.id is not null
    and (v_dem.salida_cima_usd_h is null or v_dem.termometro = 'sin_datos');
  v_dem_usable := v_dem.id is not null and not v_dem_ausente
    and v_dem_edad_min <= 15;
  v_dem_decl := case
    when v_dem.id is null then 'sin_medicion'
    when v_dem_ausente then 'senal_ausente'
    when v_dem_edad_min > 15 then 'medicion_vieja'
    else 'aplicada' end;
  v_dem_tope := case when v_dem_usable
    then v_dem.salida_cima_usd_h
         * (coalesce(v_dem_vent_min, 120) / 60.0) end;
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
    'demanda', jsonb_build_object(
      'usable', v_dem_usable, 'declaracion', v_dem_decl,
      'termometro', v_dem.termometro,
      'salida_cima_usd_h', v_dem.salida_cima_usd_h,
      'vida_cima_min', v_dem.vida_cima_min,
      'medida_en', v_dem.medida_en,
      'tope_usd', v_dem_tope),
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
          'fuente', v_plant.fuente, 'sembrada_en', v_plant.sembrada_en,
          'moneda', v_plant.moneda, 'tipo', v_plant.tipo) end),
    'demanda', jsonb_build_object(
      'declaracion', v_dem_decl, 'usable', v_dem_usable,
      'termometro', v_dem.termometro,
      'salida_cima_usd_h', v_dem.salida_cima_usd_h,
      'vida_cima_min', v_dem.vida_cima_min,
      'medida_en', v_dem.medida_en,
      'tope_usd', v_dem_tope),
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
-- 4) CÁLCULO PURO — el tope de demanda y su porqué
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guia_calc_asesor(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_ahora     timestamptz := coalesce((p ->> 'ahora')::timestamptz, now());
  v_salida    numeric := (p #>> '{tarifa,salida_ref}')::numeric;
  v_costo     numeric := (p ->> 'costo_ref360')::numeric;
  v_linea     numeric := (p #>> '{posicion,linea_saldo}')::numeric;
  v_comp      numeric := (p #>> '{posicion,comprometido_saldo}')::numeric;
  v_colchon   numeric := coalesce((p #>> '{cfg,colchon}')::numeric, 360);
  v_mat_fifo  numeric := coalesce((p #>> '{cfg,mat_fifo}')::numeric, 300);
  v_lotes_tot numeric := 0; v_lotes_costo numeric := 0;
  v_sin_lote  numeric; v_descuadre boolean := false;
  v_vendible  numeric; v_fondo_tras numeric;
  v_eq        numeric; v_senal text;
  v_motivos   text[] := '{}';
  -- preparada
  v_pel       jsonb; v_pel_nombre text; v_tasa numeric; v_g numeric;
  v_monto     numeric; v_receive numeric;
  v_queda     numeric; v_costo_fifo numeric := 0; v_con_lote numeric := 0;
  v_pro_sin   numeric; v_gan_fifo numeric; v_gan_dia numeric;
  v_desglose  jsonb := '[]'::jsonb; v_item jsonb; v_toma numeric;
  v_porques   jsonb; v_aviso_promo text;
  v_prep      jsonb := null;
  -- DEMANDA (2026-11-14): tope por profundidad absorbible de la banda
  v_dem_ok    boolean := coalesce((p #>> '{demanda,usable}')::boolean, false);
  v_dem_decl  text := p #>> '{demanda,declaracion}';
  v_dem_tope  numeric := (p #>> '{demanda,tope_usd}')::numeric;
  v_dem_topado boolean := false;
  -- compra con fondo
  v_margen_calle numeric; v_compra jsonb;
begin
  select coalesce(sum((l ->> 'cantidad')::numeric), 0),
         coalesce(sum((l ->> 'costo')::numeric), 0)
    into v_lotes_tot, v_lotes_costo
    from jsonb_array_elements(coalesce(p #> '{posicion,lotes}', '[]'::jsonb)) l;
  v_sin_lote := case when v_linea is null then null
                     else greatest(v_linea - v_lotes_tot, 0) end;
  v_descuadre := v_linea is not null and v_lotes_tot > v_linea + 5;
  v_vendible := case when v_linea is null or v_comp is null then null
                     else greatest(v_linea - v_comp - v_colchon, 0) end;
  v_fondo_tras := greatest(
    coalesce((p #>> '{posicion,fondo}')::numeric, 0)
    - coalesce((p #>> '{posicion,reserva_cupos}')::numeric, 0), 0);
  v_eq := case when v_salida is null or v_costo is null
                 or v_salida <= 0 or v_costo <= 0 then null
               else round(360 * v_salida / v_costo, 2) end;
  v_senal := p #>> '{foto,senal,palabra}';

  -- ---------- ¿se prepara? (motivos en claro, R2/R6/R9/R10) ----------
  if not coalesce((p #>> '{foto,usable}')::boolean, false) then
    v_motivos := array_append(v_motivos, 'foto_no_usable');
  end if;
  if not (v_senal = 'VENDER'
          or (v_senal = 'APROVECHAR'
              and (p #>> '{foto,duras,0,lado}') = 'compra')) then
    v_motivos := array_append(v_motivos, 'senal_no_vender');
  end if;
  if coalesce((p #>> '{puerta,detenidas}')::boolean, false)
     or coalesce((p #>> '{puerta,pausadas}')::boolean, false) then
    v_motivos := array_append(v_motivos, 'puerta_en_pausa');
  end if;
  if coalesce((p #>> '{puerta,preparada_viva}')::boolean, false) then
    v_motivos := array_append(v_motivos, 'ya_hay_preparada');
  end if;
  if (p ->> 'silencio_hasta') is not null
     and (p ->> 'silencio_hasta')::timestamptz > v_ahora then
    v_motivos := array_append(v_motivos, 'silencio');
  end if;
  if not coalesce((p #>> '{posicion,base_venta}')::boolean, false) then
    v_motivos := array_append(v_motivos, 'sin_oferta_base');
  end if;
  if v_vendible is null then
    v_motivos := array_append(v_motivos, 'sin_posicion_firme');
  end if;
  if v_descuadre then
    v_motivos := array_append(v_motivos, 'descuadre_linea_libro');
  end if;
  if coalesce((p #>> '{puerta,acciones_hora}')::int, 0) >= 2 then
    v_motivos := array_append(v_motivos, 'tope_hora');
  end if;

  if array_length(v_motivos, 1) is null then
    -- peldaño: dura de compra -> Equilibrado (el del botón del Analista);
    -- VENDER -> Paciente si su G es zona buena y la demanda ejecutable
    -- lo alcanza (vwap20 a ≤5 por debajo); si no, Equilibrado; si no,
    -- Inmediato (menú de analista.js, ya calculado en la foto).
    if v_senal = 'APROVECHAR' then
      select e into v_pel from jsonb_array_elements(
        coalesce(p #> '{foto,menu,peldanos}', '[]'::jsonb)) e
       where e ->> 'nombre' = 'Equilibrado' limit 1;
      v_pel_nombre := 'Equilibrado';
    else
      select e into v_pel from jsonb_array_elements(
        coalesce(p #> '{foto,menu,peldanos}', '[]'::jsonb)) e
       where e ->> 'nombre' = 'Paciente' limit 1;
      if v_pel is not null and not coalesce((v_pel ->> 'bloqueado')::boolean, true)
         and coalesce((v_pel ->> 'g')::numeric, -1) >= 25
         and (p #>> '{foto,ejecutable20,tasa}') is not null
         and (p #>> '{foto,ejecutable20,tasa}')::numeric
             >= (v_pel ->> 'tasa')::numeric - 5 then
        v_pel_nombre := 'Paciente';
      else
        v_pel := null;
        select e into v_pel from jsonb_array_elements(
          coalesce(p #> '{foto,menu,peldanos}', '[]'::jsonb)) e
         where e ->> 'nombre' = 'Equilibrado' limit 1;
        v_pel_nombre := 'Equilibrado';
        if v_pel is null or coalesce((v_pel ->> 'bloqueado')::boolean, true) then
          select e into v_pel from jsonb_array_elements(
            coalesce(p #> '{foto,menu,peldanos}', '[]'::jsonb)) e
           where e ->> 'nombre' = 'Inmediato' limit 1;
          v_pel_nombre := 'Inmediato';
        end if;
      end if;
    end if;
    if v_pel is null or coalesce((v_pel ->> 'bloqueado')::boolean, true)
       or (v_pel ->> 'tasa') is null then
      v_motivos := array_append(v_motivos, 'sin_peldano');
    else
      v_tasa := (v_pel ->> 'tasa')::numeric;
      v_g := (v_pel ->> 'g')::numeric;
      if v_vendible / v_tasa < 10 then
        v_motivos := array_append(v_motivos, 'vendible_bajo');
      else
        v_monto := least(
          coalesce((p #>> '{puerta,tope_oferta}')::numeric, 40),
          floor(v_vendible / v_tasa),
          floor(120 - coalesce((p #>> '{puerta,monto_hoy}')::numeric, 0)));
        -- DEMANDA: el monto se topa además por lo que la cima del
        -- libro absorbe en la ventana (salida_cima_usd_h × ventana).
        -- Solo con medición fresca y señal presente (usable=true);
        -- vieja o ausente ya vino declarada y NO topa nada.
        if v_dem_ok and v_dem_tope is not null
           and floor(v_dem_tope) < v_monto then
          v_dem_topado := true;
          v_monto := greatest(floor(v_dem_tope), 0);
        end if;
        if v_monto < 10 then
          v_motivos := array_append(v_motivos,
            case when v_dem_topado and v_dem_tope <= 0
                   then 'demanda_sin_absorcion'
                 when v_dem_topado then 'monto_topado_demanda'
                 else 'monto_bajo' end);
        else
          v_receive := round(v_monto * v_tasa, 2);
          -- FIFO: consume los lotes en orden hasta v_receive; el resto
          -- sale del saldo sin lote (sin ganancia atribuida, R honestidad).
          v_queda := v_receive;
          for v_item in
            select l from jsonb_array_elements(
              coalesce(p #> '{posicion,lotes}', '[]'::jsonb)) l
          loop
            exit when v_queda <= 0;
            v_toma := least((v_item ->> 'cantidad')::numeric, v_queda);
            if v_toma > 0 then
              v_costo_fifo := v_costo_fifo + round(
                (v_item ->> 'costo')::numeric * v_toma
                / nullif((v_item ->> 'cantidad')::numeric, 0), 2);
              v_con_lote := v_con_lote + v_toma;
              v_desglose := v_desglose || jsonb_build_object(
                'cantidad', v_toma,
                'costo', round((v_item ->> 'costo')::numeric * v_toma
                  / nullif((v_item ->> 'cantidad')::numeric, 0), 2));
              v_queda := v_queda - v_toma;
            end if;
          end loop;
          -- el tramo sin lote se valora POR LO BAJO (floor a CUP
          -- entero): su costo es desconocido y la ganancia FIFO que
          -- se le enseña a Ernesto jamás se infla por redondeo.
          v_pro_sin := case when v_queda > 0 and v_tasa > 0
            then floor(v_queda / v_tasa * v_salida) else 0 end;
          v_gan_fifo := round(v_monto * v_salida - v_pro_sin - v_costo_fifo, 0);
          v_gan_dia := case when v_g is null then null
            else round(v_receive / 360 * v_g, 0) end;
          if not (v_gan_fifo >= v_mat_fifo
                  or (coalesce(v_g, -1) >= 25 and v_monto >= 20)) then
            v_motivos := array_append(v_motivos, 'no_material');
          else
            v_porques := jsonb_build_array(
              case when (p #>> '{foto,ejecutable20,tasa}') is not null then
                'El libro de compra junta ' ||
                (p #>> '{foto,ejecutable20,usd}') || ' USD ejecutables a ' ||
                (p #>> '{foto,ejecutable20,tasa}') || ' saldo por QUSD.'
              else
                'El peldaño ' || v_pel_nombre || ' tiene ' ||
                coalesce(v_pel ->> 'delanteUsd', '0') ||
                ' USD por delante en el libro de venta.' end,
              'Tu ganancia a esta tasa es +' ||
                replace(v_g::text, '.', ',') ||
                ' CUP por recarga de 360 (zona ' ||
                coalesce(v_pel ->> 'zona', '—') || ').',
              case when (p #>> '{posicion,mejor_nivel20_hoy}') is not null
                        and v_tasa >= (p #>> '{posicion,mejor_nivel20_hoy}')::numeric
                then 'Es la mejor tasa del día según el historial de fotos.'
                when (p #>> '{posicion,linea_en}') is not null then
                  'Tu saldo está en línea desde las ' ||
                  to_char((p #>> '{posicion,linea_en}')::timestamptz
                    at time zone 'America/Havana', 'HH12:MI AM') || '.'
                else 'El peldaño ' || v_pel_nombre ||
                     ' es el que mejor combina ganancia y salida.' end);
            if v_dem_ok then
              v_porques := v_porques || jsonb_build_array(
                'Demanda ' || coalesce(p #>> '{demanda,termometro}', '—')
                || ': la cima del libro sale a '
                || trim_scale(round(
                     (p #>> '{demanda,salida_cima_usd_h}')::numeric, 2))::text
                || ' USD/h y lleva '
                || trim_scale(round(
                     (p #>> '{demanda,vida_cima_min}')::numeric, 0))::text
                || ' min en pie.'
                || case when v_dem_topado
                     then ' Tu monto se topó a lo que la cima absorbe en la ventana ('
                       || trim_scale(round(v_dem_tope, 2))::text || ' USD).'
                     else '' end);
            end if;
            if coalesce((p #>> '{promo_puesto,activa}')::boolean, false)
               and (p #>> '{promo_puesto,ref_cierre}') is not null
               and abs(v_tasa - (p #>> '{promo_puesto,ref_cierre}')::numeric)
                   / (p #>> '{promo_puesto,ref_cierre}')::numeric > 0.05 then
              v_aviso_promo := 'OJO: esta tasa sale de la banda del 5 % de '
                || 'tu puesto promocionado (referencia '
                || (p #>> '{promo_puesto,ref_cierre}') || '): puede costarte el puesto.';
            end if;
            v_prep := jsonb_build_object(
              'tasa', v_tasa, 'peldano', v_pel_nombre,
              'monto_qusd', v_monto, 'receive', v_receive,
              'ganancia360', v_g,
              'ganancia_fifo', v_gan_fifo, 'ganancia_costo_dia', v_gan_dia,
              'fifo', jsonb_build_object(
                'con_lote', v_con_lote, 'costo_fifo', v_costo_fifo,
                'sin_lote', v_queda, 'proceeds_sin_lote', v_pro_sin,
                'desglose', v_desglose),
              'porques', v_porques, 'aviso_promo', v_aviso_promo,
              'demanda', jsonb_build_object(
                'declaracion', v_dem_decl, 'aplicada', v_dem_ok,
                'termometro', p #>> '{demanda,termometro}',
                'salida_cima_usd_h',
                  (p #>> '{demanda,salida_cima_usd_h}')::numeric,
                'vida_cima_min', (p #>> '{demanda,vida_cima_min}')::numeric,
                'tope_usd', v_dem_tope, 'topado', v_dem_topado));
          end if;
        end if;
      end if;
    end if;
  end if;

  -- ---------- consejo de compra con el fondo (honesto, §5.3) ----------
  v_margen_calle := case when (p #>> '{tarifa,ingreso_ref360}') is null
                           or v_costo is null then null
    else (p #>> '{tarifa,ingreso_ref360}')::numeric - v_costo end;
  v_compra := jsonb_build_object(
    'posible', (v_fondo_tras > 0 and coalesce(v_margen_calle, -1) > 0),
    'fondo_tras_reserva', v_fondo_tras,
    'margen_por_recarga', v_margen_calle,
    'motivo', case
      when v_fondo_tras <= 0 then 'reserva_cupos'
      when coalesce(v_margen_calle, -1) <= 0 then 'sin_margen'
      else null end);

  return jsonb_build_object(
    'senal', v_senal,
    'equilibrio', v_eq,
    'posicion', jsonb_build_object(
      'linea_saldo', v_linea, 'linea_en', p #>> '{posicion,linea_en}',
      'lotes_saldo', v_lotes_tot, 'lotes_costo', v_lotes_costo,
      'sin_lote', v_sin_lote, 'descuadre', v_descuadre,
      'comprometido_saldo', v_comp,
      'colchon', v_colchon, 'vendible', v_vendible,
      'qUSD', (p #>> '{posicion,qUSD}')::numeric,
      'fondo', (p #>> '{posicion,fondo}')::numeric,
      'reserva_cupos', (p #>> '{posicion,reserva_cupos}')::numeric,
      'fondo_tras_reserva', v_fondo_tras),
    'preparada', v_prep,
    'demanda', jsonb_build_object(
      'declaracion', v_dem_decl, 'aplicada', v_dem_ok,
      'tope_usd', v_dem_tope, 'topado', v_dem_topado),
    'motivos_no_prepara', to_jsonb(v_motivos),
    'compra_fondo', v_compra,
    'transferencia', p #> '{foto,transferencia}');
end;
$function$;

-- ---------------------------------------------------------------------
-- 5) EL CICLO — el snapshot de la preparada lleva la demanda
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
       'demanda', v_prep -> 'demanda',
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
revoke execute on function public.guia_preparar_interna(boolean)
  from public, anon, authenticated;
grant execute on function public.guia_preparar_interna(boolean)
  to service_role;

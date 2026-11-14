-- =====================================================================
-- FIX AUDITORÍA GUÍAS (2026-11-14) — el test de existencia sobre
-- registros compuestos: «v_foto is not null» sobre un record de
-- mercado_fotos es FALSO siempre que CUALQUIER columna sea nula
-- (toque es nulo por diseño en todas las fotos) -> la foto se
-- declaraba «no usable» en producción y AMBAS caras de las Guías
-- (Copiloto y Asesor) quedaban mudas. Se sustituye por el test
-- correcto «v_foto.id is not null» (y equivalentes v_viva/v_prev).
-- Sin ningún otro cambio de lógica. Definiciones = las vivas
-- parcheadas el 2026-11-14.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.guia_buscador(p_codigo text, p_prueba boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_u record; v_busc text; v_foto record; v_tar record; v_cfg record;
  v_est numeric; v_conteo integer; v_pct_s numeric; v_pct_t numeric;
  v_pe numeric; v_pt numeric; v_precio numeric;
  v_calc jsonb; v_r jsonb; v_sug jsonb; v_viva record;
  v_out jsonb := '[]'::jsonb; v_usable boolean;
begin
  select * into v_u from public.validar_usuario(p_codigo) limit 1;
  if v_u is null or not v_u.activo or v_u.bloqueado then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_invalido');
  end if;
  v_busc := v_u.codigo;

  -- barrido perezoso: lo vencido deja de ser viva (R9/R12)
  update public.guia_sugerencias
     set estado = 'vencida'
   where buscador_codigo = v_busc and es_prueba = p_prueba
     and estado = 'viva' and vence_en < now();

  select * into v_cfg from public.guia_config where id = 1;
  select * into v_tar from public.tarifa where id = 1;
  select * into v_foto from public.mercado_fotos
   order by recibida_en desc limit 1;
  v_usable := v_foto.id is not null and v_foto.libro_ok and v_foto.fresca
    and v_foto.recibida_en > now() - interval '20 minutes';

  select estrellas, conteo into v_est, v_conteo
    from public.dinero_estrellas_de(v_busc, p_prueba);
  v_pct_s := public.dinero_pct_estrellas(coalesce(v_est, 1.0), 'saldo');
  v_pct_t := public.dinero_pct_estrellas(coalesce(v_est, 1.0), 'transferencia');

  -- en mano REAL por bolsillo (mismos filtros que espera_pendiente_entregas)
  select coalesce(sum(monto_pendiente) filter (where bolsillo = 'efectivo'), 0),
         coalesce(sum(monto_pendiente) filter (where bolsillo = 'transferencia'), 0)
    into v_pe, v_pt
    from public.dinero_entregas
   where buscador_codigo = v_busc and es_prueba = p_prueba
     and estado in ('entregado', 'en_calle')
     and coalesce(monto_pendiente, 0) > 0;

  -- precio observado: la última vuelta de saldo REAL del propio buscador
  select capital_cup * 360 / nullif(producto_cantidad, 0) into v_precio
    from public.dinero_vueltas
   where buscador_codigo = v_busc and es_prueba = p_prueba
     and tipo = 'saldo' and coalesce(producto_cantidad, 0) > 0
   order by abierta_en desc limit 1;

  v_calc := public.guia_calc_copiloto(jsonb_build_object(
    'foto_usable', v_usable,
    'ingreso_ref360', v_tar.ingreso_ref360,
    'libro_ref', v_tar.libro_ref,
    'salida_ref', v_tar.salida_ref,
    'piso_transf', v_tar.piso_transf,
    'pendiente_efectivo', v_pe,
    'pendiente_transferencia', v_pt,
    'pct_saldo', v_pct_s, 'pct_transf', v_pct_t,
    'precio_obs', v_precio,
    'precio_respaldo', (select costo_ref360 from public.mercado_config where id = 1),
    'espera_abierta_saldo', exists(
      select 1 from public.dinero_esperas
       where buscador_codigo = v_busc and es_prueba = p_prueba
         and estado = 'abierta' and tipo = 'saldo'),
    'espera_abierta_transf', exists(
      select 1 from public.dinero_esperas
       where buscador_codigo = v_busc and es_prueba = p_prueba
         and estado = 'abierta' and tipo = 'transferencia'),
    'silencio_saldo_hasta', (
      select max(respondida_en) + (v_cfg.silencio_buscador_h || ' hours')::interval
        from public.guia_sugerencias
       where buscador_codigo = v_busc and es_prueba = p_prueba
         and riel = 'saldo' and estado = 'descartada'),
    'silencio_transf_hasta', (
      select max(respondida_en) + (v_cfg.silencio_buscador_h || ' hours')::interval
        from public.guia_sugerencias
       where buscador_codigo = v_busc and es_prueba = p_prueba
         and riel = 'transferencia' and estado = 'descartada'),
    'ahora', now(),
    'cfg', jsonb_build_object(
      'mat_total', v_cfg.mat_copiloto_total,
      'mat_buscador', v_cfg.mat_copiloto_busc,
      'margen_util', v_cfg.margen_util_recarga)));

  -- materializar / reutilizar la viva de cada riel (una a la vez, R9)
  for v_r in select value from jsonb_each(
    jsonb_build_object('saldo', v_calc -> 'saldo',
                       'transferencia', v_calc -> 'transferencia'))
  loop
    if not coalesce((v_r ->> 'habla')::boolean, false) then continue; end if;
    v_sug := v_r -> 'sugerencia';
    v_viva := null;
    select * into v_viva from public.guia_sugerencias gs
     where gs.buscador_codigo = v_busc and gs.es_prueba = p_prueba
       and gs.estado = 'viva'
       and gs.riel = (case when v_sug ? 'cantidad_recargas'
                           then 'saldo' else 'transferencia' end)
     limit 1;
    if v_viva.id is not null and v_viva.foto_id is distinct from v_foto.id then
      -- llega foto nueva: la vieja solo cede si el precio mejora ≥1 %
      -- o cambió el capital en mano (anti-estorbo, §4.1)
      if (v_viva.riel = 'saldo' and not (
            coalesce(v_sug ->> 'precio', '0')::numeric
              <= coalesce(v_viva.precio, 1e9) * 0.99
            or coalesce(v_sug ->> 'capital', '0')::numeric
               is distinct from v_viva.capital))
         or (v_viva.riel = 'transferencia' and
             coalesce(v_sug ->> 'capital', '0')::numeric
               is not distinct from v_viva.capital) then
        v_sug := null; -- se mantiene la viva anterior tal cual
        v_out := v_out || jsonb_build_object(
          'id', v_viva.id, 'riel', v_viva.riel,
          'cantidad_recargas', v_viva.cantidad_recargas,
          'saldo', v_viva.saldo, 'precio', v_viva.precio,
          'capital', v_viva.capital, 'valor', v_viva.valor,
          'parte_buscador', v_viva.parte_buscador,
          'techo_abs', v_viva.techo_abs, 'techo_util', v_viva.techo_util,
          'prima', v_viva.prima, 'entra', v_viva.entra,
          'vence_en', v_viva.vence_en);
      else
        update public.guia_sugerencias set estado = 'vencida'
         where id = v_viva.id;
        v_viva := null;
      end if;
    end if;
    if v_sug is not null and v_viva.id is null then
      insert into public.guia_sugerencias (
        buscador_codigo, riel, foto_id, foto_en, snapshot,
        cantidad_recargas, saldo, precio, capital, valor,
        ganancia_total, parte_buscador, techo_abs, techo_util,
        prima, entra, vence_en, es_prueba)
      values (
        v_busc,
        case when v_sug ? 'cantidad_recargas' then 'saldo'
             else 'transferencia' end,
        v_foto.id, v_foto.recibida_en,
        jsonb_build_object('ingreso_ref360', v_tar.ingreso_ref360,
                           'libro_ref', v_tar.libro_ref),
        (v_sug ->> 'cantidad_recargas')::numeric, (v_sug ->> 'saldo')::numeric,
        (v_sug ->> 'precio')::numeric, (v_sug ->> 'capital')::numeric,
        (v_sug ->> 'valor')::numeric, (v_sug ->> 'ganancia_total')::numeric,
        (v_sug ->> 'parte_buscador')::numeric,
        (v_sug ->> 'techo_abs')::numeric, (v_sug ->> 'techo_util')::numeric,
        (v_sug ->> 'prima')::numeric, (v_sug ->> 'entra')::numeric,
        v_foto.recibida_en + interval '20 minutes', p_prueba)
      returning * into v_viva;
      v_out := v_out || jsonb_build_object(
        'id', v_viva.id, 'riel', v_viva.riel,
        'cantidad_recargas', v_viva.cantidad_recargas,
        'saldo', v_viva.saldo, 'precio', v_viva.precio,
        'capital', v_viva.capital, 'valor', v_viva.valor,
        'parte_buscador', v_viva.parte_buscador,
        'techo_abs', v_viva.techo_abs, 'techo_util', v_viva.techo_util,
        'prima', v_viva.prima, 'entra', v_viva.entra,
        'si_pagas_mas', v_sug -> 'si_pagas_mas',
        'vence_en', v_viva.vence_en);
    elsif v_sug is not null and v_viva.id is not null then
      v_out := v_out || jsonb_build_object(
        'id', v_viva.id, 'riel', v_viva.riel,
        'cantidad_recargas', v_viva.cantidad_recargas,
        'saldo', v_viva.saldo, 'precio', v_viva.precio,
        'capital', v_viva.capital, 'valor', v_viva.valor,
        'parte_buscador', v_viva.parte_buscador,
        'techo_abs', v_viva.techo_abs, 'techo_util', v_viva.techo_util,
        'prima', v_viva.prima, 'entra', v_viva.entra,
        'vence_en', v_viva.vence_en);
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true, 'buscador', v_busc,
    'estrellas', v_est, 'pct_saldo', v_pct_s, 'pct_transf', v_pct_t,
    'foto', case when v_foto.id is null then null else jsonb_build_object(
      'id', v_foto.id, 'recibida_en', v_foto.recibida_en,
      'usable', v_usable) end,
    'tarifa', jsonb_build_object(
      'ingreso_ref360', v_tar.ingreso_ref360, 'libro_ref', v_tar.libro_ref),
    'silencio_total', not v_usable,
    'sugerencias', v_out);
end;
$function$


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
begin
  select * into v_cfg from public.guia_config where id = 1;
  select * into v_tar from public.tarifa where id = 1;
  select * into v_mc from public.mercado_config where id = 1;
  select * into v_foto from public.mercado_fotos
   order by recibida_en desc limit 1;

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
        'tasa', v_foto.detalle #>> '{analisis,ejecutable,usd20}',
        'usd', v_foto.detalle #>> '{analisis,ejecutable,usdAccion}'),
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
      'base_venta', coalesce((v_foto.detalle #>> '{propias,base_venta}')::boolean, false),
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
$function$


-- ── Fix 2 de la misma auditoría: guia_calc_asesor leía el QUSD
--    desde '{posicion,qusd}' (minúsculas) y la puerta lo pasa
--    como 'qUSD': jsonb es sensible a mayúsculas -> el eco de
--    posición salía siempre nulo. Una sola ruta corregida.

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
        if v_monto < 10 then
          v_motivos := array_append(v_motivos, 'monto_bajo');
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
              'porques', v_porques, 'aviso_promo', v_aviso_promo);
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
    'motivos_no_prepara', to_jsonb(v_motivos),
    'compra_fondo', v_compra,
    'transferencia', p #> '{foto,transferencia}');
end;
$function$


-- ── Fix 3 de la misma auditoría: la puerta pasaba los OBJETOS
--    analisis.ejecutable.usd20 / usdAccion enteros donde el
--    cálculo espera los escalares (tasa / usd): el porqué #1
--    de la oferta preparada salía con el JSON crudo pegado.
--    Se apuntan las hojas: {...,usd20,tasa} y {...,usdAccion,usd}.
--    (Definición completa viva, con los fixes 1 y 3.)

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
begin
  select * into v_cfg from public.guia_config where id = 1;
  select * into v_tar from public.tarifa where id = 1;
  select * into v_mc from public.mercado_config where id = 1;
  select * into v_foto from public.mercado_fotos
   order by recibida_en desc limit 1;

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
      'base_venta', coalesce((v_foto.detalle #>> '{propias,base_venta}')::boolean, false),
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
$function$


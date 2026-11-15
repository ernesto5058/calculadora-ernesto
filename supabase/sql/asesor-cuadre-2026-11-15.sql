-- =====================================================================
-- ASESOR CON CUADRE (CHEQUEO 105, 2026-11-15) — reglas de Ernesto:
-- peaje siempre en el Enviar · precio anclado y declarado contra
-- la foto viva · cuadre de la vuelta cerrado al centavo con el
-- costo REAL de los lotes y la comisión del buscador · la
-- propuesta solo nace con neto positivo · ganancia por recarga
-- contra el costo real. Definiciones tomadas de pg_get_functiondef
-- y editadas solo en lo marcado CHEQUEO 105.
-- =====================================================================

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
  v_colchon   numeric;
  v_peaje     numeric := (p #>> '{cfg,peaje_envio}')::numeric;
  v_tope_env  numeric := coalesce((p #>> '{cfg,tope_receptor_envio}')::numeric, 500000);
  v_envios    int;
  v_colchon_modo text;
  v_mat_fifo  numeric := coalesce((p #>> '{cfg,mat_fifo}')::numeric, 300);
  v_lotes_tot numeric := 0; v_lotes_costo numeric := 0;
  v_sin_lote  numeric; v_descuadre boolean := false;
  -- PUERTA DE POSICIÓN FIRME (v26, 2026-11-15): la venta se dimensiona
  -- desde el LIBRO ASENTADO (lotes) y solo si libro y sensor acuerdan.
  v_libro     numeric; v_ult_venta timestamptz; v_linea_en timestamptz;
  v_ult_mov   timestamptz;
  v_firme     boolean := false; v_firme_causa text;
  v_vendible  numeric; v_fondo_tras numeric;
  v_eq        numeric; v_senal text;
  v_motivos   text[] := '{}';
  -- preparada
  v_pel       jsonb; v_pel_nombre text; v_tasa numeric; v_g numeric;
  v_monto     numeric; v_receive numeric;
  v_monto_pleno numeric; v_recibe_pleno numeric;
  v_queda     numeric; v_costo_fifo numeric := 0; v_con_lote numeric := 0;
  v_pro_sin   numeric; v_gan_fifo numeric; v_gan_dia numeric;
  v_desglose  jsonb := '[]'::jsonb; v_item jsonb; v_toma numeric;
  v_porques   jsonb; v_aviso_promo text;
  v_prep      jsonb := null;
  -- DEMANDA (2026-11-14): tope por profundidad absorbible.
  -- FRENO POR BANDA (2026-11-14, ajuste aprobado por Ernesto): el
  -- tope lo manda la absorción de la BANDA donde cae la tasa del
  -- peldaño elegido, no la de la cima — la cima puede estar muerta
  -- mientras la zona de la oferta rota. Si la medición no trae
  -- bandas (legado), manda el tope de cima de siempre.
  v_dem_ok    boolean := coalesce((p #>> '{demanda,usable}')::boolean, false);
  v_dem_decl  text := p #>> '{demanda,declaracion}';
  v_dem_tope  numeric := (p #>> '{demanda,tope_usd}')::numeric;
  v_dem_topado boolean := false;
  v_dem_modo_banda boolean := false;
  v_dem_banda_tasa numeric :=
    coalesce((p #>> '{demanda,banda_tasa}')::numeric, 5);
  v_dem_vent_min numeric := (p #>> '{demanda,ventana_min}')::numeric;
  v_dem_banda numeric; v_dem_salida_banda numeric; v_dem_vida_banda numeric;
  -- PROMO AFILADA (2026-11-14): la banda del 5 % del puesto deja de
  -- ser un aviso y pasa a ser RESTRICCIÓN DURA sobre el peldaño.
  v_promo_activa boolean :=
    coalesce((p #>> '{promo_puesto,activa}')::boolean, false);
  v_promo_ref numeric := (p #>> '{promo_puesto,ref_cierre}')::numeric;
  v_promo_pct numeric :=
    coalesce((p #>> '{promo_puesto,banda_pct}')::numeric, 5);
  v_promo_lo numeric; v_promo_hi numeric;
  v_promo_ajuste text; v_promo_tasa_orig numeric;
  v_promo_senal text; v_hist jsonb; v_hist_med numeric;
  -- compra con fondo
  v_margen_calle numeric; v_compra jsonb;
  -- CUADRE DE LA VUELTA (CHEQUEO 105, 2026-11-15, reglas de Ernesto):
  -- la propuesta nace SOLO con su cuadre completo, cerrado al
  -- centavo, contra el costo REAL de los lotes: saldo que sale
  -- (Enviar + peaje), costo FIFO de todo lo que sale, comisión del
  -- buscador dueño de cada tramo (su % vivo de SU ganancia), QUSD
  -- que entran, efectivo a la salida vigente, neto, corte de gasto
  -- (porciento_gasto de SU ganancia neta) y lo que vuelve a
  -- inversión. Neto no positivo ⇒ no nace ('vuelta_no_rentable').
  v_cc_comision_pct numeric :=
    (p #>> '{cuadre_cfg,comision_saldo_pct}')::numeric;
  v_cc_pgastos numeric :=
    (p #>> '{cuadre_cfg,porciento_gasto}')::numeric;
  v_cc_buscadores text[] := coalesce(
    (select array_agg(x) from jsonb_array_elements_text(
       coalesce(p #> '{cuadre_cfg,buscadores}', '[]'::jsonb)) x),
    '{}'::text[]);
  v_envios_venta int; v_peaje_venta numeric;
  v_queda_venta numeric; v_toma_venta numeric; v_toma_peaje numeric;
  v_costo_toma numeric; v_costo_venta_parte numeric;
  v_costo_peaje numeric := 0; v_com_buscador numeric := 0;
  v_gan_tramo numeric; v_pro_por_saldo numeric;
  v_sin_lote_venta numeric;
  v_valor_venta numeric; v_costo_total numeric; v_neto numeric;
  v_gasto_corte bigint; v_vuelve numeric;
  v_costo_real360 numeric; v_g_real numeric;
  v_libro_hoy jsonb; v_precio_info jsonb; v_cuadre jsonb;
begin
  select coalesce(sum((l ->> 'cantidad')::numeric), 0),
         coalesce(sum((l ->> 'costo')::numeric), 0)
    into v_lotes_tot, v_lotes_costo
    from jsonb_array_elements(coalesce(p #> '{posicion,lotes}', '[]'::jsonb)) l;
  v_sin_lote := case when v_linea is null then null
                     else greatest(v_linea - v_lotes_tot, 0) end;
  v_descuadre := v_linea is not null and v_lotes_tot > v_linea + 5;
  -- FIRMEZA (v26 + CHEQUEO 104): libro asentado manda. La posición
  -- solo es firme si hay lectura de línea, la lectura NO es anterior
  -- a la última venta asentada que consumió saldo, y libro↔sensor
  -- acuerdan: con lectura posterior al último movimiento de lotes el
  -- acuerdo es AL CENTAVO (diferencia cero salvo redondeo 0,005);
  -- la tolerancia del peaje de un envío queda SOLO como respaldo pa
  -- payloads sin ult_mov_en o lecturas no posteriores a todo
  -- movimiento. Si no hay acuerdo, no hay vendible:
  -- 'sin_posicion_firme'.
  v_libro := coalesce((p #>> '{posicion,libro_saldo}')::numeric, v_lotes_tot);
  v_ult_venta := (p #>> '{posicion,ult_venta_en}')::timestamptz;
  v_linea_en := (p #>> '{posicion,linea_en}')::timestamptz;
  v_ult_mov := (p #>> '{posicion,ult_mov_en}')::timestamptz;
  if v_linea is null then
    v_firme := false; v_firme_causa := 'sin_lectura_linea';
  elsif v_ult_venta is not null
        and (v_linea_en is null or v_linea_en < v_ult_venta) then
    v_firme := false; v_firme_causa := 'linea_anterior_ultima_venta';
  elsif v_ult_mov is not null and v_linea_en is not null
        and v_linea_en > v_ult_mov
        and abs(v_linea - v_libro) > 0.005 then
    -- CHEQUEO 104 (acuerdo estricto): la lectura es POSTERIOR a todo
    -- movimiento de lotes, así que retrata el estado final del
    -- libro: la diferencia tiene que ser CERO salvo redondeo. Un
    -- peaje entero de diferencia (el residuo fantasma del
    -- 2026-11-15: 5,00 exactos) ya NO se esconde en la tolerancia.
    v_firme := false; v_firme_causa := 'libro_sensor_difieren';
  elsif abs(v_linea - v_libro) > coalesce(v_peaje, 5) then
    v_firme := false; v_firme_causa := 'libro_sensor_difieren';
  else
    v_firme := true; v_firme_causa := null;
  end if;
  -- COLCHÓN POR PEAJE DE ENVÍOS (2026-11-14, orden de Ernesto): si
  -- la puerta pasa peaje_envio, el colchón deja de ser un fijo y pasa
  -- a ser peaje × envíos de la posición ofrecible (envíos =
  -- ceil(saldo / tope del receptor por envío), mínimo 1): el sensor
  -- mantiene conocida la posición y la puerta re-verifica en vivo al
  -- subir, así que el colchón gordo sobra y el capital rota. Sin
  -- peaje en el cfg (llamadas legadas y bancos viejos) manda el
  -- colchon fijo de siempre: compatibilidad total.
  -- PEAJE SIEMPRE (CHEQUEO 105): ETECSA descuenta 5 por envío y la
  -- posición ofrecible lo descuenta SIEMPRE: peaje × envíos, sin
  -- rama legada de colchón fijo. Sin peaje en el cfg manda el 5 de
  -- la ley (guia_config lo trae; el respaldo es la regla, no un
  -- número inventado: es el peaje real de ETECSA por envío).
  v_peaje := coalesce(v_peaje, 5);
  if v_peaje <= 0 then v_peaje := 5; end if;
  if v_tope_env is null or v_tope_env <= 0 then v_tope_env := 500000; end if;
  v_envios := greatest(1, ceil(greatest(
    coalesce(v_libro, v_linea, 0) - coalesce(v_comp, 0), 0) / v_tope_env)::int);
  v_colchon := v_peaje * v_envios;
  v_colchon_modo := 'peaje_por_envios';
  v_vendible := case when not v_firme or v_comp is null then null
                     else greatest(v_libro - v_comp - v_colchon, 0) end;
  v_fondo_tras := greatest(
    coalesce((p #>> '{posicion,fondo}')::numeric, 0)
    - coalesce((p #>> '{posicion,reserva_cupos}')::numeric, 0), 0);
  v_eq := case when v_salida is null or v_costo is null
                 or v_salida <= 0 or v_costo <= 0 then null
               else round(360 * v_salida / v_costo, 2) end;
  v_senal := p #>> '{foto,senal,palabra}';
  -- modo banda: la medición trae desglose por banda con lado venta
  v_dem_modo_banda := v_dem_ok and exists (
    select 1 from jsonb_array_elements(
      coalesce(p #> '{demanda,bandas}', '[]'::jsonb)) b
     where b ->> 'lado' = 'venta');

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
      -- PROMO: el peldaño se elige como siempre (rotación/margen —
      -- el escaparate ya da la ventaja, PROHIBIDO competir bajando
      -- por la promo); la ÚNICA fuerza nueva es la banda del 5 %
      -- del cierre de 24 h: si el peldaño cae fuera, se ajusta al
      -- borde (redondeo HACIA DENTRO de la banda) y la ganancia por
      -- recarga se recalcula a la tasa ajustada con la fórmula de
      -- siempre (360 × salida ÷ tasa − costo). Sin referencia
      -- legible NO se inventa banda: se declara 'ref_sin_datos'.
      if v_promo_activa then
        if v_promo_ref is not null and v_promo_ref > 0 then
          v_promo_lo := ceil(v_promo_ref
            * (1 - v_promo_pct / 100) * 100) / 100;
          v_promo_hi := floor(v_promo_ref
            * (1 + v_promo_pct / 100) * 100) / 100;
          if v_tasa < v_promo_lo or v_tasa > v_promo_hi then
            v_promo_tasa_orig := v_tasa;
            v_tasa := least(greatest(v_tasa, v_promo_lo), v_promo_hi);
            if v_salida is not null and v_costo is not null
               and v_tasa > 0 then
              v_g := round(360 * v_salida / v_tasa - v_costo, 2);
            end if;
            v_promo_ajuste := 'ajustada_al_borde';
          else
            v_promo_ajuste := 'en_banda';
          end if;
        else
          v_promo_ajuste := 'ref_sin_datos';
        end if;
      end if;
      if v_vendible / v_tasa < 10 then
        v_motivos := array_append(v_motivos, 'vendible_bajo');
      else
        v_monto_pleno := round(v_vendible / v_tasa, 2);
        v_recibe_pleno := floor(v_vendible);
        v_monto := least(
          coalesce((p #>> '{puerta,tope_oferta}')::numeric, 40),
          v_monto_pleno,
          floor(120 - coalesce((p #>> '{puerta,monto_hoy}')::numeric, 0)));
        -- DEMANDA: el monto se topa además por lo que absorbe la
        -- BANDA donde cae la tasa del peldaño (salida de la banda ×
        -- ventana); sin bandas (legado), por lo que absorbe la cima.
        -- Solo con medición fresca y señal presente (usable=true);
        -- vieja o ausente ya vino declarada y NO topa nada. Banda
        -- sin absorción medida = CERO: frena con el mismo rigor que
        -- la cima muerta de antes — ni más laxo ni por atrás.
        if v_dem_ok and v_dem_modo_banda then
          v_dem_banda := floor(v_tasa / v_dem_banda_tasa) * v_dem_banda_tasa;
          select (b ->> 'salida_usd_h')::numeric,
                 (b ->> 'vida_min')::numeric
            into v_dem_salida_banda, v_dem_vida_banda
            from jsonb_array_elements(
              coalesce(p #> '{demanda,bandas}', '[]'::jsonb)) b
           where b ->> 'lado' = 'venta'
             and (b ->> 'banda')::numeric = v_dem_banda
           limit 1;
          v_dem_salida_banda := coalesce(v_dem_salida_banda, 0);
          v_dem_tope := v_dem_salida_banda
            * (coalesce(v_dem_vent_min, 120) / 60.0);
        end if;
        if v_dem_ok and v_dem_tope is not null
           and floor(v_dem_tope) < v_monto then
          v_dem_topado := true;
          v_monto := greatest(floor(v_dem_tope), 0);
        end if;
        if v_monto < 10 then
          v_motivos := array_append(v_motivos,
            case when v_dem_topado and v_dem_tope <= 0
                   then case when v_dem_modo_banda
                          then 'demanda_sin_absorcion_en_tu_zona'
                          else 'demanda_sin_absorcion' end
                 when v_dem_topado then 'monto_topado_demanda'
                 else 'monto_bajo' end);
        else
          -- RECIBE MANDA (2026-11-14, lección de Ernesto «vende
          -- todo el saldo»): la oferta nace DEL SALDO. Si el monto
          -- quedó el pleno (ningún tope lo recortó), el receive es
          -- el vendible entero — floor a saldo entero, declarado,
          -- como su oferta manual (15.545 de 15.545,08; QvaPay
          -- derivó la tasa efectiva 312,5251) — y NO monto × tasa,
          -- que dejaba el saldo de residuo (1,33 ese día; 232 con
          -- el floor viejo de QUSD enteros). Si un tope recortó el
          -- monto (puerta, día o demanda), la venta es parcial y el
          -- receive vuelve a ser monto × tasa: el resto del saldo
          -- se queda en la línea, declarado en «recibe_del_saldo».
          -- ENVIAR MANDA (CHEQUEO 105): el saldo de la oferta es el
          -- Enviar y el QUSD se deriva de él; jamás pasa del
          -- vendible (posición firme − peaje) ni en la venta plena
          -- ni en la parcial topada por la puerta o la demanda.
          v_receive := case
            when v_monto >= v_monto_pleno - 0.001 then v_recibe_pleno
            else least(round(v_monto * v_tasa, 2), v_recibe_pleno) end;
          -- el peaje de ESTA venta: los envíos que mover este saldo
          -- cuesta, a 5 por envío — sale de la misma posición.
          v_envios_venta := greatest(1, ceil(v_receive / v_tope_env)::int);
          v_peaje_venta := v_peaje * v_envios_venta;
          v_pro_por_saldo := case when v_receive > 0 and v_salida is not null
            then (v_monto * v_salida) / v_receive else 0 end;
          -- FIFO EXTENDIDO (CHEQUEO 105): el consumo cubre el
          -- Enviar Y el peaje (ese saldo también sale de la
          -- posición y su costo es de la vuelta). Cada tramo de
          -- venta atribuye su ganancia al dueño del lote: si es un
          -- buscador, su comisión (el % vivo de SU ganancia) entra
          -- al cuadre como costo de la vuelta.
          v_queda := v_receive + v_peaje_venta;
          v_queda_venta := v_receive;
          for v_item in
            select l from jsonb_array_elements(
              coalesce(p #> '{posicion,lotes}', '[]'::jsonb)) l
          loop
            exit when v_queda <= 0;
            v_toma := least((v_item ->> 'cantidad')::numeric, v_queda);
            if v_toma > 0 then
              v_toma_venta := least(v_toma, v_queda_venta);
              v_toma_peaje := v_toma - v_toma_venta;
              v_costo_toma := round(
                (v_item ->> 'costo')::numeric * v_toma
                / nullif((v_item ->> 'cantidad')::numeric, 0), 2);
              v_costo_venta_parte := case when v_toma > 0
                then round(v_costo_toma * v_toma_venta / v_toma, 2)
                else 0 end;
              v_costo_fifo := v_costo_fifo + v_costo_venta_parte;
              v_costo_peaje := v_costo_peaje
                + (v_costo_toma - v_costo_venta_parte);
              if v_toma_venta > 0 then
                v_con_lote := v_con_lote + v_toma_venta;
                v_desglose := v_desglose || jsonb_build_object(
                  'cantidad', v_toma_venta,
                  'costo', v_costo_venta_parte);
                if (v_item ->> 'contraparte') is not null
                   and (v_item ->> 'contraparte') = any(v_cc_buscadores)
                   and v_cc_comision_pct is not null then
                  v_gan_tramo := v_toma_venta * v_pro_por_saldo
                    - v_costo_venta_parte;
                  if v_gan_tramo > 0 then
                    v_com_buscador := v_com_buscador + round(
                      v_gan_tramo * v_cc_comision_pct / 100.0, 2);
                  end if;
                end if;
                v_queda_venta := v_queda_venta - v_toma_venta;
              end if;
              v_queda := v_queda - v_toma;
            end if;
          end loop;
          -- el tramo de venta sin lote se valora POR LO BAJO (floor
          -- a CUP entero): su costo es desconocido y la ganancia
          -- que se le enseña a Ernesto jamás se infla por redondeo.
          v_sin_lote_venta := v_queda_venta;
          v_pro_sin := case when v_sin_lote_venta > 0 and v_tasa > 0
            then floor(v_sin_lote_venta / v_tasa * v_salida) else 0 end;
          v_gan_fifo := round(v_monto * v_salida - v_pro_sin - v_costo_fifo, 0);
          v_gan_dia := case when v_g is null then null
            else round(v_receive / 360 * v_g, 0) end;
          -- CUADRE DE LA VUELTA (CHEQUEO 105): partición exacta del
          -- efectivo que entra, al centavo: costo de todo el saldo
          -- que sale (Enviar + peaje) + comisión de buscador + neto
          -- = efectivo − tramo sin lote (declarado). Del neto sale
          -- el corte de gasto; el resto del efectivo vuelve a
          -- inversión (costo recuperado + neto − gasto).
          if v_salida is not null and v_salida > 0 then
            v_valor_venta := round(v_monto * v_salida, 2);
            v_costo_total := round(v_costo_fifo + v_costo_peaje, 2);
            v_neto := round(v_valor_venta - v_pro_sin
              - v_costo_total - v_com_buscador, 2);
            v_gasto_corte := case
              when v_neto > 0 and v_cc_pgastos is not null
              then floor(v_neto * v_cc_pgastos / 100.0)::bigint
              else 0 end;
            v_vuelve := round(v_valor_venta - v_pro_sin
              - v_com_buscador - v_gasto_corte, 2);
            v_costo_real360 := case
              when (v_receive + v_peaje_venta) > 0
              then round(360 * v_costo_total
                / (v_receive + v_peaje_venta), 2) end;
            v_g_real := case when v_costo_real360 is not null
                and v_tasa > 0
              then round(360 * v_salida / v_tasa - v_costo_real360, 2)
              end;
            v_cuadre := jsonb_build_object(
              'enviar_saldo', v_receive,
              'peaje_saldo', v_peaje_venta,
              'envios', v_envios_venta,
              'saldo_que_sale', v_receive + v_peaje_venta,
              'costo_lotes', v_costo_total,
              'costo_fifo', v_costo_fifo,
              'costo_peaje', v_costo_peaje,
              'sin_lote_saldo', v_sin_lote_venta,
              'sin_lote_proceeds', v_pro_sin,
              'qusd_entran', v_monto,
              'salida_ref', v_salida,
              'efectivo_entra', v_valor_venta,
              'comision_buscador', v_com_buscador,
              'comision_pct', v_cc_comision_pct,
              'neto', v_neto,
              'gasto_corte', v_gasto_corte,
              'gasto_pct', v_cc_pgastos,
              'vuelve_inversion', v_vuelve,
              'capital_qusd_equiv', round(v_costo_total / v_salida, 2),
              'cierra', (round(v_costo_total + v_com_buscador + v_neto, 2)
                = round(v_valor_venta - v_pro_sin, 2)));
          end if;
          -- LIBRO HOY + PRECIO DECLARADO (CHEQUEO 105): la tarjeta
          -- enseña dónde está el libro de la foto vigente y dónde
          -- cae la tasa propuesta respecto a él — la demanda y el
          -- historial informan, jamás esconden la foto viva.
          v_libro_hoy := jsonb_build_object(
            'top_venta_cruda', (p #>> '{foto,top_venta}')::numeric,
            'cima_firme', (p #> '{foto,menu}' -> 'cima' ->> 'firme')::numeric,
            'cima_sucia', (p #> '{foto,menu}' -> 'cima' ->> 'sucia')::boolean,
            'nivel20', (p #>> '{foto,nivel20}')::numeric,
            'ejecutable20_tasa',
              (p #>> '{foto,ejecutable20,tasa}')::numeric,
            'ejecutable20_usd',
              (p #>> '{foto,ejecutable20,usd}')::numeric,
            'promedio_venta', (p #>> '{foto,promedio_venta}')::numeric);
          v_precio_info := jsonb_build_object(
            'peldano', v_pel_nombre,
            'ancla', case v_pel_nombre
              when 'Paciente' then 'nivel20_del_libro_de_compra'
              when 'Inmediato' then 'cima_firme_mas_un_tick'
              else 'cima_firme_del_libro_de_venta' end,
            'brecha_vs_nivel20', case
              when (p #>> '{foto,nivel20}') is not null
              then round(v_tasa - (p #>> '{foto,nivel20}')::numeric, 2)
              end,
            'brecha_vs_cima_firme', case
              when (p #> '{foto,menu}' -> 'cima' ->> 'firme') is not null
              then round(v_tasa
                - (p #> '{foto,menu}' -> 'cima' ->> 'firme')::numeric, 2)
              end,
            'brecha_vs_top_cruda', case
              when (p #>> '{foto,top_venta}') is not null
              then round(v_tasa - (p #>> '{foto,top_venta}')::numeric, 2)
              end);
          -- PUERTA DE LA VUELTA (CHEQUEO 105, ley de Ernesto:
          -- «quiero ganar más que el capital invertido»): sin neto
          -- positivo — y sin terminar con más QUSD del que el
          -- capital puesto equivale — la propuesta NO nace, y el
          -- cuadre queda devuelto pa que se vea el porqué.
          if v_cuadre is not null and (v_neto <= 0
               or v_monto <= round(v_costo_total / v_salida, 2)) then
            v_motivos := array_append(v_motivos, 'vuelta_no_rentable');
          elsif not (v_gan_fifo >= v_mat_fifo
                  or (coalesce(v_g, -1) >= 25 and v_monto >= 20)) then
            v_motivos := array_append(v_motivos,
              case when v_promo_ajuste = 'ajustada_al_borde'
                     then 'promo_banda_sin_margen'
                   else 'no_material' end);
          else
            v_porques := jsonb_build_array(
              -- EL LIBRO HOY PRIMERO (CHEQUEO 105): la foto viva
              -- manda y se enseña; la tasa propuesta queda situada
              -- contra el nivel ejecutable de los compradores.
              'El libro hoy: la venta firme está en ' ||
                coalesce(trim_scale(round(
                  (p #> '{foto,menu}' -> 'cima' ->> 'firme')::numeric, 2))::text,
                  trim_scale(round(
                    (p #>> '{foto,top_venta}')::numeric, 2))::text, '—') ||
                case when (p #> '{foto,menu}' -> 'cima' ->> 'sucia')::boolean
                  then ' (la cruda ' ||
                    trim_scale(round(
                      (p #>> '{foto,top_venta}')::numeric, 2))::text ||
                    ' es una oferta sucia aislada)'
                  else '' end ||
                ' y los compradores ejecutan a ' ||
                coalesce(trim_scale(round(
                  (p #>> '{foto,nivel20}')::numeric, 2))::text, '—') ||
                ' (nivel 20). Tu tasa ' ||
                trim_scale(round(v_tasa, 2))::text ||
                case when (p #>> '{foto,nivel20}') is not null
                      and v_tasa > (p #>> '{foto,nivel20}')::numeric
                  then ' queda ' ||
                    trim_scale(round(v_tasa
                      - (p #>> '{foto,nivel20}')::numeric, 2))::text ||
                    ' por encima de ese nivel: la oferta espera a que el libro llegue a ella.'
                  when (p #>> '{foto,nivel20}') is not null
                  then ' cae dentro del nivel que los compradores ejecutan hoy.'
                  else '.' end,
              case when (p #>> '{foto,ejecutable20,tasa}') is not null then
                'El libro de compra junta ' ||
                (p #>> '{foto,ejecutable20,usd}') || ' USD ejecutables a ' ||
                (p #>> '{foto,ejecutable20,tasa}') || ' saldo por QUSD.'
              else
                'El peldaño ' || v_pel_nombre || ' tiene ' ||
                coalesce(v_pel ->> 'delanteUsd', '0') ||
                ' USD por delante en el libro de venta.' end,
              -- GANANCIA CON COSTO REAL (CHEQUEO 105): el titular es
              -- tu costo mezclado de los lotes que se venden; el del
              -- costo de referencia va nombrado como referencia.
              'Tu ganancia a esta tasa es +' ||
                replace(coalesce(v_g_real, v_g)::text, '.', ',') ||
                ' CUP por recarga de 360 con TU costo real (' ||
                coalesce(trim_scale(round(v_costo_real360, 2))::text, '—') ||
                ' por recarga)' ||
                case when v_g is not null and v_g_real is not null
                  then '; con el costo de referencia de ' ||
                    trim_scale(round(v_costo, 2))::text ||
                    ' serían +' || replace(v_g::text, '.', ',') || '.'
                  else '.' end,
              case when (p #>> '{posicion,linea_en}') is not null then
                  'Tu saldo está en línea desde las ' ||
                  to_char((p #>> '{posicion,linea_en}')::timestamptz
                    at time zone 'America/Havana', 'HH12:MI AM') || '.'
                else 'El peldaño ' || v_pel_nombre ||
                     ' es el que mejor combina ganancia y salida.' end);
            if v_dem_ok and v_dem_modo_banda then
              v_porques := v_porques || jsonb_build_array(
                'Historial de demanda (' ||
                coalesce(p #>> '{demanda,termometro}', '—')
                || '): la zona de tu oferta a '
                || trim_scale(round(v_tasa, 2))::text
                || ' (banda ' || trim_scale(v_dem_banda)::text || '–'
                || trim_scale(v_dem_banda + v_dem_banda_tasa)::text
                || ') se comió '
                || trim_scale(round(v_dem_salida_banda, 2))::text
                || ' USD/h'
                || case when v_dem_vida_banda is not null
                     then ' y lleva '
                       || trim_scale(round(v_dem_vida_banda, 0))::text
                       || ' min en pie'
                     else '' end
                || '.'
                || case when v_dem_topado
                     then ' Tu monto se topó a lo que tu zona absorbe en la ventana ('
                       || trim_scale(round(v_dem_tope, 2))::text || ' USD).'
                     else '' end);
            elsif v_dem_ok then
              v_porques := v_porques || jsonb_build_array(
                'Historial de demanda (' ||
                coalesce(p #>> '{demanda,termometro}', '—')
                || '): la cima del libro sale a '
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
            -- PROMO AFILADA: el porqué declara la banda y, con
            -- demanda por banda usable, la absorción de SU zona
            -- contra su propio nivel normal (mediana de 24 h de
            -- demanda_mediciones, n ≥ 3 lecturas; sin historial
            -- suficiente no se declara señal: nada inventado).
            if v_promo_activa then
              if v_promo_ajuste = 'en_banda' then
                v_porques := v_porques || jsonb_build_array(
                  'Promo: tu peldaño cae DENTRO de la banda del '
                  || trim_scale(v_promo_pct)::text
                  || ' % del cierre de 24 h (referencia '
                  || trim_scale(round(v_promo_ref, 2))::text
                  || '; banda '
                  || trim_scale(v_promo_lo)::text || '–'
                  || trim_scale(v_promo_hi)::text
                  || '): el escaparate se mantiene sin tocar tu '
                  || 'precio — el peldaño salió de rotación y '
                  || 'margen, como siempre.');
              elsif v_promo_ajuste = 'ajustada_al_borde' then
                v_porques := v_porques || jsonb_build_array(
                  'Promo: el peldaño '
                  || trim_scale(v_promo_tasa_orig)::text
                  || ' salía de la banda del '
                  || trim_scale(v_promo_pct)::text
                  || ' % del cierre de 24 h (referencia '
                  || trim_scale(round(v_promo_ref, 2))::text
                  || '; banda '
                  || trim_scale(v_promo_lo)::text || '–'
                  || trim_scale(v_promo_hi)::text
                  || '); lo ajusté al borde '
                  || trim_scale(v_tasa)::text
                  || ' — perder el escaparate no salía a cuenta.');
              elsif v_promo_ajuste = 'ref_sin_datos' then
                v_porques := v_porques || jsonb_build_array(
                  'Promo activa, pero sin referencia de cierre '
                  || 'legible: no pude comprobar la banda del '
                  || trim_scale(v_promo_pct)::text
                  || ' % (declarado, no inventado).');
              end if;
              if v_dem_ok and v_dem_modo_banda
                 and v_dem_banda is not null then
                v_hist := (p #> '{demanda,bandas_hist}')
                  -> (trim_scale(v_dem_banda)::text);
                if v_hist is not null
                   and coalesce((v_hist ->> 'n')::int, 0) >= 3
                   and (v_hist ->> 'mediana') is not null
                   and v_dem_salida_banda is not null then
                  v_hist_med := (v_hist ->> 'mediana')::numeric;
                  v_promo_senal := case
                    when v_dem_salida_banda > v_hist_med then 'alta'
                    when v_dem_salida_banda < v_hist_med then 'baja'
                    else 'normal' end;
                  v_porques := v_porques || jsonb_build_array(
                    'Escaparate: tu zona absorbe '
                    || trim_scale(round(v_dem_salida_banda, 2))::text
                    || ' USD/h, '
                    || case v_promo_senal
                         when 'alta' then 'POR ENCIMA de su nivel normal'
                         when 'baja' then 'por debajo de su nivel normal'
                         else 'en su nivel normal' end
                    || ' (mediana de 24 h: '
                    || trim_scale(round(v_hist_med, 2))::text
                    || ' USD/h, '
                    || (v_hist ->> 'n') || ' lecturas).');
                end if;
              end if;
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
              'tasa_efectiva', case when v_monto > 0
                then round(v_receive / v_monto, 4) end,
              'recibe_del_saldo', (v_receive = v_recibe_pleno),
              'enviar_saldo', v_receive,
              'peaje_saldo', v_peaje_venta,
              'cuadre', v_cuadre,
              'libro_hoy', v_libro_hoy,
              'precio', v_precio_info,
              'ganancia360', coalesce(v_g_real, v_g),
              'ganancia360_costo_ref', v_g,
              'costo_real360', v_costo_real360,
              'ganancia_fifo', v_gan_fifo, 'ganancia_costo_dia', v_gan_dia,
              'fifo', jsonb_build_object(
                'con_lote', v_con_lote, 'costo_fifo', v_costo_fifo,
                'costo_peaje', v_costo_peaje,
                'sin_lote', v_sin_lote_venta,
                'proceeds_sin_lote', v_pro_sin,
                'desglose', v_desglose),
              'porques', v_porques, 'aviso_promo', v_aviso_promo,
              'promo', jsonb_build_object(
                'activa', v_promo_activa,
                'fase', p #>> '{promo_puesto,fase}',
                'declaracion', p #>> '{promo_puesto,declaracion}',
                'ref_cierre', v_promo_ref,
                'banda_pct', v_promo_pct,
                'banda', case when v_promo_lo is null then null
                  else jsonb_build_array(v_promo_lo, v_promo_hi) end,
                'ajuste', v_promo_ajuste,
                'tasa_original', v_promo_tasa_orig,
                'escaparate_senal', v_promo_senal,
                'escaparate_mediana_24h', v_hist_med),
              'demanda', jsonb_build_object(
                'declaracion', v_dem_decl, 'aplicada', v_dem_ok,
                'modo', case when not v_dem_ok then null
                             when v_dem_modo_banda then 'banda'
                             else 'cima' end,
                'termometro', p #>> '{demanda,termometro}',
                'salida_cima_usd_h',
                  (p #>> '{demanda,salida_cima_usd_h}')::numeric,
                'vida_cima_min', (p #>> '{demanda,vida_cima_min}')::numeric,
                'banda', v_dem_banda,
                'salida_banda_usd_h', v_dem_salida_banda,
                'vida_banda_min', v_dem_vida_banda,
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
      'libro_saldo', v_libro,
      'ult_mov_en', v_ult_mov,
      'diferencia', case when v_linea is null then null
                         else v_linea - v_libro end,
      'firme', v_firme, 'firme_causa', v_firme_causa,
      'firme_texto', case v_firme_causa
        when 'sin_lectura_linea' then 'El sensor no ha reportado el saldo de tu línea: sin esa lectura el Asesor no prepara ventas.'
        when 'linea_anterior_ultima_venta' then 'La lectura de tu línea es de antes de tu última venta asentada: ese saldo ya salió y no se vende dos veces.'
        when 'libro_sensor_difieren' then 'Tu libro asentado y la lectura de tu línea no coinciden: el Asesor no prepara ventas con números cruzados.'
        else null end,
      'ult_venta_en', v_ult_venta,
      'comprometido_saldo', v_comp,
      'colchon', v_colchon,
      'colchon_detalle', jsonb_build_object('modo', v_colchon_modo,
        'peaje_envio', v_peaje, 'envios', v_envios,
        'tope_receptor_envio', v_tope_env),
      'vendible', v_vendible,
      'qUSD', (p #>> '{posicion,qUSD}')::numeric,
      'fondo', (p #>> '{posicion,fondo}')::numeric,
      'reserva_cupos', (p #>> '{posicion,reserva_cupos}')::numeric,
      'fondo_tras_reserva', v_fondo_tras),
    'preparada', v_prep,
    'cuadre', v_cuadre,
    'libro_hoy', v_libro_hoy,
    'demanda', jsonb_build_object(
      'declaracion', v_dem_decl, 'aplicada', v_dem_ok,
      'modo', case when not v_dem_ok then null
                   when v_dem_modo_banda then 'banda'
                   else 'cima' end,
      'banda', v_dem_banda,
      'salida_banda_usd_h', v_dem_salida_banda,
      'vida_banda_min', v_dem_vida_banda,
      'tope_usd', v_dem_tope, 'topado', v_dem_topado),
    'promo', jsonb_build_object(
      'activa', v_promo_activa,
      'fase', p #>> '{promo_puesto,fase}',
      'declaracion', p #>> '{promo_puesto,declaracion}',
      'ref_cierre', v_promo_ref, 'banda_pct', v_promo_pct,
      'ajuste', v_promo_ajuste),
    'motivos_no_prepara', to_jsonb(v_motivos),
    'compra_fondo', v_compra,
    'transferencia', p #> '{foto,transferencia}');
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
  v_libro numeric; v_ult_venta timestamptz;
  v_ult_mov timestamptz;
  v_lotes jsonb; v_fondo numeric; v_reserva numeric := 0;
  v_inicio timestamptz := ((now() at time zone 'America/Havana')::date)::timestamp
                           at time zone 'America/Havana';
  v_monto_hoy numeric; v_hora integer; v_prev record;
  v_calc jsonb; v_sil timestamptz;
  v_puesto boolean; v_habana_hoy date :=
    (now() at time zone 'America/Havana')::date;
  v_vig jsonb;
  -- PLANTILLA (2026-11-14): base = oferta viva, si no la plantilla.
  v_plant record; v_base_viva boolean; v_base boolean; v_base_fuente text;
  -- DEMANDA (2026-11-14): última medición ETECSA + ventana de absorción.
  v_dem record; v_dem_vent_min int; v_dem_edad_min numeric;
  v_dem_ausente boolean; v_dem_usable boolean; v_dem_decl text;
  v_dem_tope numeric; v_dem_banda_tasa numeric;
  -- PROMO AFILADA (2026-11-14): estado del puesto desde la fuente
  -- de verdad del servidor (guia_config + guia_promo_estado) y el
  -- nivel normal de absorción por banda (mediana 24 h).
  v_promo jsonb; v_bandas_hist jsonb; v_esc jsonb;
begin
  select * into v_cfg from public.guia_config where id = 1;
  select * into v_tar from public.tarifa where id = 1;
  select * into v_mc from public.mercado_config where id = 1;
  select * into v_foto from public.mercado_fotos
   order by recibida_en desc limit 1;
  -- FOTO LIGERA (2026-11-14): el nivel20 y el top de venta que come
  -- el cálculo son los VIGENTES (la completa fusionada con la ligera
  -- de su mismo minuto: misma corriente, mismo método, ~15 s más
  -- joven). Todo lo demás (propias, qUSD, menú, duras, escalera)
  -- sigue saliendo de la completa. La «usable» NO cambia: sin
  -- completa fresca y con libro no hay cálculo — la ligera no
  -- resucita fotos muertas.
  v_vig := public.mercado_foto_vigente();
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
  select ventana_absorcion_min, banda_tasa
    into v_dem_vent_min, v_dem_banda_tasa
    from public.demanda_config where id = 1;
  v_dem_edad_min := case when v_dem.id is null then null
    else extract(epoch from (now() - v_dem.medida_en)) / 60.0 end;
  -- FRENO POR BANDA (2026-11-14): con desglose por bandas, la señal
  -- vive en las bandas — la cima en cero ya NO marca la medición
  -- ausente (es justo el caso que el ajuste vino a corregir), y una
  -- medición con bandas pero SIN ninguna salida de venta medible
  -- (ventana insuficiente) se declara ausente como antes. Sin
  -- bandas (medición legada), manda la regla de la cima de siempre.
  v_dem_ausente := v_dem.id is not null
    and (v_dem.termometro = 'sin_datos'
         or (coalesce(v_dem.bandas, '[]'::jsonb) = '[]'::jsonb
             and v_dem.salida_cima_usd_h is null)
         or (coalesce(v_dem.bandas, '[]'::jsonb) <> '[]'::jsonb
             and not exists (
               select 1 from jsonb_array_elements(v_dem.bandas) b
                where b ->> 'lado' = 'venta'
                  and (b ->> 'salida_usd_h') is not null)));
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
  -- PROMO: el estado se calcula de la config (ventanas y resultado
  -- de la puja) y de lo legible de la foto (ofertas abiertas); lo no
  -- legible viaja declarado 'sin_datos', jamás inventado.
  v_promo := public.guia_promo_estado(jsonb_build_object(
    'hoy', v_habana_hoy,
    'puja_cierre', v_cfg.promo_puja_cierre,
    'desde', v_cfg.puesto_desde, 'hasta', v_cfg.puesto_hasta,
    'resultado', v_cfg.promo_resultado,
    'ofertas_abiertas',
      (v_foto.detalle #>> '{propias,ofertas_abiertas}')::int,
    'propias_legible',
      (v_foto.detalle #>> '{propias,legible}')::boolean));
  -- Nivel normal por banda: mediana de la salida de venta de cada
  -- banda en demanda_mediciones de las últimas 24 h, con su n.
  select coalesce(jsonb_object_agg(banda_txt, obj), '{}'::jsonb)
    into v_bandas_hist
    from (select (b ->> 'banda') as banda_txt,
            jsonb_build_object(
              'mediana', percentile_cont(0.5) within group
                (order by (b ->> 'salida_usd_h')::numeric),
              'n', count(*)) as obj
           from public.demanda_mediciones m,
                jsonb_array_elements(coalesce(m.bandas, '[]'::jsonb)) b
          where m.moneda = 'ETECSA'
            and m.medida_en > now() - interval '24 hours'
            and b ->> 'lado' = 'venta'
            and (b ->> 'salida_usd_h') is not null
          group by (b ->> 'banda')) s;
  v_base_fuente := case when v_base_viva then 'oferta_viva'
                        when v_base then 'plantilla' else null end;

  select saldo_principal_cup, recibido_en into v_linea, v_linea_en
    from public.sms_linea
   where saldo_principal_cup is not null
   order by id desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'cantidad', cantidad_restante, 'costo', costo_restante_cup,
           'contraparte', contraparte,
           'costo_por_recarga', costo_por_recarga,
           'semaforo_compra', semaforo_compra,
           'margen_recarga_nacer', margen_recarga_nacer)
           order by creado_en), '[]'::jsonb)
    into v_lotes
    from public.dinero_lotes_saldo
   where es_prueba = p_prueba and cantidad_restante > 0;

  -- LIBRO ASENTADO + ÚLTIMA VENTA (v26, puerta de posición firme): el
  -- total del libro y cuándo fue la última venta que consumió saldo,
  -- pa que el calc cruce la línea del sensor contra la verdad asentada.
  select coalesce(sum(cantidad_restante), 0) into v_libro
    from public.dinero_lotes_saldo
   where es_prueba = p_prueba;
  select max(creada_en) into v_ult_venta
    from public.pago_ventas_saldo
   where es_prueba = p_prueba;

  -- ÚLTIMO MOVIMIENTO DE LOTES (CHEQUEO 104): nacimiento de lote,
  -- venta que consumió o cierre de lote. La calc solo exige el
  -- acuerdo AL CENTAVO cuando la lectura de línea es posterior a
  -- TODO esto; si no, manda el respaldo de la v26 (el peaje).
  select greatest(
    (select max(creado_en) from public.dinero_lotes_saldo
      where es_prueba = p_prueba),
    (select max(creada_en) from public.pago_ventas_saldo
      where es_prueba = p_prueba),
    (select max(cerrado_en) from public.dinero_lotes_cierres
      where es_prueba = p_prueba))
    into v_ult_mov;

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
      'nivel20', coalesce((v_vig ->> 'nivel20')::numeric, v_foto.etecsa_nivel20),
      'top_venta', coalesce((v_vig ->> 'top_venta')::numeric, v_foto.etecsa_top_venta),
      'nivel20_edad_s', (v_vig ->> 'nivel20_edad_s')::numeric,
      'ligera', v_vig -> 'ligera',
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
      'libro_saldo', v_libro, 'ult_venta_en', v_ult_venta,
      'ult_mov_en', v_ult_mov,
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
      'colchon', v_cfg.colchon_saldo,
      'peaje_envio', v_cfg.peaje_envio_saldo,
      'tope_receptor_envio', v_cfg.tope_receptor_envio,
      'mat_fifo', v_cfg.mat_asesor_fifo),
    -- CUADRE_CFG (CHEQUEO 105): lo que el cuadre de la vuelta
    -- necesita — comisión viva de saldo (la fila tarifa la trae la
    -- Tarifa Viva), el porciento de gasto de Ernesto y los códigos
    -- de buscador dueños de lotes.
    'cuadre_cfg', jsonb_build_object(
      'comision_saldo_pct', v_tar.comision_saldo,
      'porciento_gasto', (select porciento_gasto_su_parte
                            from public.dinero_fondo
                           where es_prueba = p_prueba limit 1),
      'buscadores', (select coalesce(jsonb_agg(buscador_codigo),
                       '[]'::jsonb)
                       from public.dinero_asignaciones
                      where es_prueba = p_prueba)),
    'demanda', jsonb_build_object(
      'usable', v_dem_usable, 'declaracion', v_dem_decl,
      'termometro', v_dem.termometro,
      'salida_cima_usd_h', v_dem.salida_cima_usd_h,
      'vida_cima_min', v_dem.vida_cima_min,
      'medida_en', v_dem.medida_en,
      'tope_usd', v_dem_tope,
      'bandas', coalesce(v_dem.bandas, '[]'::jsonb),
      'bandas_hist', coalesce(v_bandas_hist, '{}'::jsonb),
      'banda_tasa', v_dem_banda_tasa,
      'ventana_min', v_dem_vent_min),
    'silencio_hasta', v_sil,
    'promo_puesto', jsonb_build_object(
      'activa', coalesce((v_promo ->> 'activa')::boolean, false),
      'fase', v_promo ->> 'fase',
      'declaracion', v_promo ->> 'declaracion',
      'banda_pct', v_cfg.promo_banda_pct,
      'ref_cierre', v_foto.etecsa_promedio_venta)));

  -- ESCAPARATE: en ventana activa, el estado del dueño dice si el
  -- escaparate está cubierto por una preparada viva o vacío (y
  -- desde cuándo): la ausencia también queda dicha, no muda.
  v_esc := case
    when not coalesce((v_promo ->> 'activa')::boolean, false)
      then jsonb_build_object('estado', 'no_aplica')
    when v_prev.id is not null
      then jsonb_build_object('estado', 'cubierto',
             'preparada_id', v_prev.id, 'expira_en', v_prev.expira_en)
    else jsonb_build_object('estado', 'vacio',
           'desde', coalesce(
             (select max(expira_en) from public.mercado_acciones
               where origen = 'asesor'),
             (v_cfg.puesto_desde::timestamp
               at time zone 'America/Havana')))
    end;

  return jsonb_build_object(
    'ok', true,
    'promo', coalesce(v_promo, '{}'::jsonb) || jsonb_build_object(
      'escaparate', v_esc,
      'ref_cierre', v_foto.etecsa_promedio_venta,
      'banda_pct', v_cfg.promo_banda_pct),
    'foto', case when v_foto.id is null then null else jsonb_build_object(
      'id', v_foto.id, 'recibida_en', v_foto.recibida_en,
      'origen', v_foto.origen, 'fresca', v_foto.fresca,
      'libro_ok', v_foto.libro_ok,
      'nivel20', coalesce((v_vig ->> 'nivel20')::numeric, v_foto.etecsa_nivel20),
      'top_venta', coalesce((v_vig ->> 'top_venta')::numeric, v_foto.etecsa_top_venta),
      'nivel20_edad_s', (v_vig ->> 'nivel20_edad_s')::numeric,
      'ligera', v_vig -> 'ligera',
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
      'tope_usd', coalesce((v_calc #>> '{demanda,tope_usd}')::numeric,
                           v_dem_tope),
      'modo', v_calc #>> '{demanda,modo}',
      'banda', (v_calc #>> '{demanda,banda}')::numeric,
      'salida_banda_usd_h',
        (v_calc #>> '{demanda,salida_banda_usd_h}')::numeric),
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

CREATE OR REPLACE FUNCTION public.guia_preparar_interna(p_forzar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cfg record; v_int jsonb; v_prep jsonb; v_id uuid; v_prev record;
  v_en_ventana boolean := false;
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
  v_en_ventana := coalesce((v_int #>> '{promo,activa}')::boolean, false);
  -- OJO: un jsonb 'null' NO es SQL NULL — sin esta comparación el
  -- ciclo intentaría insertar una preparada vacía (lo cazó la corrida
  -- real del cron de las 06:15 UTC contra el NOT NULL de tasa).
  if v_prep is null or v_prep = 'null'::jsonb then
    -- ESCAPARATE VACÍO (promo): ventana activa y el ciclo no dejó
    -- preparada ni hay relevo vivo ⇒ queda REGISTRADO pal dueño en
    -- guia_promo_eventos (dedupe 55 min: un evento por racha, no
    -- uno por ciclo). La ausencia se dice, no se calla.
    if v_en_ventana and not exists (
         select 1 from public.mercado_acciones
          where origen = 'asesor' and estado = 'preparada'
            and expira_en > now())
       and not exists (
         select 1 from public.guia_promo_eventos
          where tipo = 'escaparate_vacio'
            and creado_en > now() - interval '55 minutes') then
      insert into public.guia_promo_eventos (tipo, detalle)
      values ('escaparate_vacio', jsonb_build_object(
        'motivos', v_int #> '{calculo,motivos_no_prepara}',
        'fase', v_int #>> '{promo,fase}',
        'escaparate', v_int -> 'promo' -> 'escaparate'));
    end if;
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
       'tasa_efectiva', (v_prep ->> 'tasa_efectiva')::numeric,
       'recibe_del_saldo', (v_prep ->> 'recibe_del_saldo')::boolean,
       'ganancia_fifo', (v_prep ->> 'ganancia_fifo')::numeric,
       'porques', v_prep -> 'porques',
       'aviso_promo', v_prep -> 'aviso_promo',
       'promo', v_prep -> 'promo',
       'base_fuente', v_int #>> '{base,fuente}',
       'plantilla', case when v_plant.id is null then null else
         jsonb_build_object('detalles', v_plant.detalles,
           'bloque', v_plant.bloque,
           'oferta_uuid', v_plant.oferta_uuid) end,
       'vendible', (v_int #>> '{calculo,posicion,vendible}')::numeric,
       'cuadre', v_prep -> 'cuadre',
       'libro_hoy', v_prep -> 'libro_hoy',
       'precio', v_prep -> 'precio',
       'peaje_saldo', (v_prep ->> 'peaje_saldo')::numeric,
       'costo_real360', (v_prep ->> 'costo_real360')::numeric,
       'ganancia360_costo_ref',
         (v_prep ->> 'ganancia360_costo_ref')::numeric,
       'equilibrio', (v_int #>> '{calculo,equilibrio}')::numeric,
       'foto_recibida_en', v_int #>> '{foto,recibida_en}'),
     jsonb_build_object(
       'fifo', v_prep -> 'fifo',
       'ganancia_costo_dia', (v_prep ->> 'ganancia_costo_dia')::numeric),
     'preparada')
  returning id into v_id;

  -- ESCAPARATE RELEVADO: si la racha vacía estaba registrada, el
  -- nacimiento de esta preparada la cierra en el mismo registro.
  if v_en_ventana and exists (
       select 1 from public.guia_promo_eventos e
        where e.tipo = 'escaparate_vacio'
          and e.creado_en > now() - interval '24 hours'
          and not exists (select 1 from public.guia_promo_eventos r
                           where r.tipo = 'escaparate_relevado'
                             and r.creado_en > e.creado_en)) then
    insert into public.guia_promo_eventos (tipo, detalle)
    values ('escaparate_relevado', jsonb_build_object(
      'preparada_id', v_id,
      'tasa', (v_prep ->> 'tasa')::numeric));
  end if;

  return jsonb_build_object('ok', true, 'preparada', jsonb_build_object(
    'id', v_id, 'tasa', (v_prep ->> 'tasa')::numeric,
    'monto_qusd', (v_prep ->> 'monto_qusd')::numeric,
    'receive', (v_prep ->> 'receive')::numeric,
    'tasa_efectiva', (v_prep ->> 'tasa_efectiva')::numeric,
    'ganancia_fifo', (v_prep ->> 'ganancia_fifo')::numeric,
    'base_fuente', v_int #>> '{base,fuente}',
    'snapshot_plantilla', v_plant.id is not null,
    'expira_en', now() + interval '10 minutes'));
end;
$function$

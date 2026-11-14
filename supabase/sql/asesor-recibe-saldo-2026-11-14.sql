-- ASESOR: LA OFERTA NACE DEL SALDO (2026-11-14) — aplicado en vivo.
-- Lección de Ernesto tras montar su oferta a mano en QvaPay: «vende
-- todo el saldo» = Enviar es el vendible exacto y el QUSD cae solo
-- (15.545 ETECSA → $49,74; tasa efectiva 312,5251). El sistema lo
-- hacía al revés: monto topado/redondeado primero y receive =
-- monto × tasa de residuo (recortes de 232 y de 1,33 el mismo día).
-- guia_calc_asesor: si ningún tope recorta el monto, receive :=
-- floor(vendible) (entero inferior declarado) y la salida declara
-- tasa_efectiva (receive/monto) y recibe_del_saldo; con tope, la
-- venta es parcial y receive vuelve a monto × tasa, declarado.
-- guia_preparar_interna: la tasa efectiva viaja en el contexto de
-- la preparada hasta la puerta. Banco: bancos/banco-recibe-saldo-
-- 2026-11-14.sql (13/13) + prueba-guia-fase1 (53/53).

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
begin
  select coalesce(sum((l ->> 'cantidad')::numeric), 0),
         coalesce(sum((l ->> 'costo')::numeric), 0)
    into v_lotes_tot, v_lotes_costo
    from jsonb_array_elements(coalesce(p #> '{posicion,lotes}', '[]'::jsonb)) l;
  v_sin_lote := case when v_linea is null then null
                     else greatest(v_linea - v_lotes_tot, 0) end;
  v_descuadre := v_linea is not null and v_lotes_tot > v_linea + 5;
  -- COLCHÓN POR PEAJE DE ENVÍOS (2026-11-14, orden de Ernesto): si
  -- la puerta pasa peaje_envio, el colchón deja de ser un fijo y pasa
  -- a ser peaje × envíos de la posición ofrecible (envíos =
  -- ceil(saldo / tope del receptor por envío), mínimo 1): el sensor
  -- mantiene conocida la posición y la puerta re-verifica en vivo al
  -- subir, así que el colchón gordo sobra y el capital rota. Sin
  -- peaje en el cfg (llamadas legadas y bancos viejos) manda el
  -- colchon fijo de siempre: compatibilidad total.
  if v_peaje is not null then
    if v_tope_env is null or v_tope_env <= 0 then v_tope_env := 500000; end if;
    v_envios := greatest(1, ceil(greatest(
      coalesce(v_linea, 0) - coalesce(v_comp, 0), 0) / v_tope_env)::int);
    v_colchon := v_peaje * v_envios;
    v_colchon_modo := 'peaje_por_envios';
  else
    v_colchon := coalesce((p #>> '{cfg,colchon}')::numeric, 360);
    v_colchon_modo := 'fijo_legado';
  end if;
  v_vendible := case when v_linea is null or v_comp is null then null
                     else greatest(v_linea - v_comp - v_colchon, 0) end;
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
          v_receive := case
            when v_monto >= v_monto_pleno - 0.001 then v_recibe_pleno
            else round(v_monto * v_tasa, 2) end;
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
            v_motivos := array_append(v_motivos,
              case when v_promo_ajuste = 'ajustada_al_borde'
                     then 'promo_banda_sin_margen'
                   else 'no_material' end);
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
            if v_dem_ok and v_dem_modo_banda then
              v_porques := v_porques || jsonb_build_array(
                'Demanda ' || coalesce(p #>> '{demanda,termometro}', '—')
                || ': la zona de tu oferta a '
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
              'ganancia360', v_g,
              'ganancia_fifo', v_gan_fifo, 'ganancia_costo_dia', v_gan_dia,
              'fifo', jsonb_build_object(
                'con_lote', v_con_lote, 'costo_fifo', v_costo_fifo,
                'sin_lote', v_queda, 'proceeds_sin_lote', v_pro_sin,
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


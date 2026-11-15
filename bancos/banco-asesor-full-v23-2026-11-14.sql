-- =====================================================================
-- BANCO SQL — Asesor a full v23 (2026-11-14)
-- Aserciones sobre guia_escenarios_calc / guia_memoria_stats /
-- guia_terminal / regla de dos lecturas (estructural, solo lectura).
-- Uso: python3 /tmp/q.py < este archivo. La última consulta devuelve
-- las filas (prueba, ok, detalle) y el conteo pasa/falla.
-- Los datos de prueba van con es_prueba=true y se limpian al final.
-- =====================================================================
create table if not exists public.banco_asesor_v23_resultados (
  prueba text primary key, ok boolean, detalle text);
delete from public.banco_asesor_v23_resultados;

do $$
declare
  v_p jsonb; v_esc jsonb; v_e jsonb; v_directo jsonb; v_stats jsonb;
  v_term jsonb; v_ok boolean; v_det text; v_tasa numeric;
begin
  -- Contexto sintético: menú de 3 peldaños, señal APROVECHAR,
  -- posición con lote completo, sin demanda ni promo.
  v_p := jsonb_build_object(
    'ahora', now(),
    'foto', jsonb_build_object(
      'usable', true, 'id', null, 'recibida_en', now(),
      'nivel20', 310, 'top_venta', 300, 'promedio_venta', 305,
      'senal', jsonb_build_object('palabra', 'APROVECHAR'),
      'menu', jsonb_build_object('peldanos', jsonb_build_array(
        jsonb_build_object('nombre', 'Inmediato', 'tasa', 300,
          'g', round(360*920.0/300 - 1000, 2), 'bloqueado', false,
          'zona', 'banco', 'delanteUsd', 10),
        jsonb_build_object('nombre', 'Equilibrado', 'tasa', 310,
          'g', round(360*920.0/310 - 1000, 2), 'bloqueado', false,
          'zona', 'banco', 'delanteUsd', 10),
        jsonb_build_object('nombre', 'Paciente', 'tasa', 320,
          'g', round(360*920.0/320 - 1000, 2), 'bloqueado', false,
          'zona', 'banco', 'delanteUsd', 10))),
      'ejecutable20', jsonb_build_object('tasa', 315, 'usd', 25),
      'duras', jsonb_build_array(jsonb_build_object('lado', 'compra')),
      'transferencia', null),
    'tarifa', jsonb_build_object('salida_ref', 920,
      'ingreso_ref360', 1100, 'libro_ref', 300),
    'costo_ref360', 1000,
    'posicion', jsonb_build_object(
      'linea_saldo', 100000, 'linea_en', now(),
      'lotes', jsonb_build_array(jsonb_build_object(
        'cantidad', 100000, 'costo', 277778, 'costo_por_recarga', 1000)),
      'comprometido_saldo', 0, 'base_venta', true,
      'base_fuente', 'plantilla', 'qUSD', 0, 'fondo', 0,
      'reserva_cupos', 0, 'mejor_nivel20_hoy', null),
    'puerta', jsonb_build_object('tope_oferta', 50, 'monto_hoy', 0,
      'acciones_hora', 0, 'preparada_viva', false,
      'detenidas', false, 'pausadas', false),
    'cfg', jsonb_build_object('colchon', 360, 'peaje_envio', null,
      'tope_receptor_envio', 500000, 'mat_fifo', 300),
    'demanda', jsonb_build_object('usable', false,
      'declaracion', 'sin_medicion', 'termometro', null,
      'bandas', '[]'::jsonb, 'bandas_hist', '{}'::jsonb),
    'silencio_hasta', null,
    'promo_puesto', jsonb_build_object('activa', false, 'fase', null,
      'declaracion', null, 'banda_pct', 5, 'ref_cierre', null));

  -- (i) identidad de ganancia360 por escenario disponible
  begin
    v_esc := public.guia_escenarios_calc(v_p);
    v_ok := true; v_det := '';
    for v_e in select * from jsonb_array_elements(v_esc) loop
      if coalesce((v_e ->> 'disponible')::boolean, false) then
        v_tasa := (v_e ->> 'tasa')::numeric;
        if abs((v_e ->> 'ganancia360')::numeric
               - round(360*920.0/v_tasa - 1000, 2)) > 0.01 then
          v_ok := false;
          v_det := v_det || (v_e ->> 'clave') || ': ganancia360 '
            || (v_e ->> 'ganancia360') || ' ≠ fórmula; ';
        end if;
      end if;
    end loop;
    if not exists (select 1 from jsonb_array_elements(v_esc) e
                    where (e ->> 'disponible')::boolean) then
      v_ok := false; v_det := 'ningún escenario disponible';
    end if;
    insert into public.banco_asesor_v23_resultados
      values ('i_identidad_ganancia360', v_ok, v_det);
  exception when others then
    insert into public.banco_asesor_v23_resultados
      values ('i_identidad_ganancia360', false, sqlerrm);
  end;

  -- (ii) el escenario 'equilibrada' reproduce la preparada directa
  begin
    v_directo := public.guia_calc_asesor(v_p) -> 'preparada';
    select e into v_e from jsonb_array_elements(v_esc) e
     where e ->> 'clave' = 'equilibrada';
    v_ok := v_directo is not null
      and (v_e ->> 'disponible')::boolean
      and (v_e ->> 'tasa')::numeric = (v_directo ->> 'tasa')::numeric
      and (v_e ->> 'monto_qusd')::numeric
          = (v_directo ->> 'monto_qusd')::numeric;
    insert into public.banco_asesor_v23_resultados
      values ('ii_equilibrada_reproduce_directa', v_ok,
        'directa tasa=' || (v_directo ->> 'tasa')
        || ' escenario tasa=' || (v_e ->> 'tasa'));
  exception when others then
    insert into public.banco_asesor_v23_resultados
      values ('ii_equilibrada_reproduce_directa', false, sqlerrm);
  end;

  -- (iii) guia_memoria_stats con 4 sugerencias de prueba
  begin
    delete from public.guia_memoria where es_prueba = true;
    insert into public.guia_memoria
      (clase, estado, es_prueba, peldano, tasa, resuelta_en, minutos_llenado)
    values ('sugerencia','llenada',true,'Equilibrado',310,now(),42),
           ('sugerencia','llenada',true,'Paciente',320,now(),95),
           ('sugerencia','no_llenada',true,'Equilibrado',311,now(),null),
           ('sugerencia','sugerida',true,'Inmediato',300,null,null);
    v_stats := public.guia_memoria_stats(true);
    v_ok := (v_stats ->> 'resueltas')::int = 3
      and (v_stats ->> 'llenadas')::int = 2
      and (v_stats ->> 'no_llenadas')::int = 1
      and abs((v_stats ->> 'acierto_pct')::numeric - 200.0/3) <= 0.1
      and jsonb_array_length(v_stats -> 'ultimas') = 4;
    insert into public.banco_asesor_v23_resultados
      values ('iii_memoria_stats_acierto', v_ok, v_stats::text);
    delete from public.guia_memoria where es_prueba = true;
  exception when others then
    delete from public.guia_memoria where es_prueba = true;
    insert into public.banco_asesor_v23_resultados
      values ('iii_memoria_stats_acierto', false, sqlerrm);
  end;

  -- (iv) guia_terminal con código inválido → ok:false
  begin
    v_term := public.guia_terminal('codigo-invalido-banco-v23', true);
    insert into public.banco_asesor_v23_resultados
      values ('iv_terminal_no_admin',
        coalesce((v_term ->> 'ok')::boolean, true) = false
          and (v_term ->> 'motivo') = 'no_admin', v_term::text);
  exception when others then
    insert into public.banco_asesor_v23_resultados
      values ('iv_terminal_no_admin', false, sqlerrm);
  end;

  -- (v) DOS LECTURAS — chequeo ESTRUCTURAL de solo lectura contra
  -- datos reales (guia_preparar_full opera sobre datos reales y no
  -- es seguro forzarlo en el banco): a lo sumo UNA candidata viva.
  begin
    v_ok := (select count(*) from public.guia_memoria
              where clase = 'candidata' and estado = 'candidata'
                and es_prueba = false) <= 1;
    insert into public.banco_asesor_v23_resultados
      values ('v_una_sola_candidata_viva', v_ok,
        'candidatas vivas reales: ' || (select count(*)
          from public.guia_memoria where clase = 'candidata'
            and estado = 'candidata' and es_prueba = false));
  exception when others then
    insert into public.banco_asesor_v23_resultados
      values ('v_una_sola_candidata_viva', false, sqlerrm);
  end;
end $$;

select prueba, ok, detalle from public.banco_asesor_v23_resultados
 order by prueba;
select count(*) filter (where ok) as pasan,
       count(*) filter (where not ok) as fallan,
       count(*) as total
  from public.banco_asesor_v23_resultados;

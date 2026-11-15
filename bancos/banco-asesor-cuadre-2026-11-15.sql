-- =====================================================================
-- BANCO SQL — ASESOR CON CUADRE (CHEQUEO 105, 2026-11-15)
-- ---------------------------------------------------------------------
-- Fixtures puros sobre guia_calc_asesor con los números reales de
-- hoy: posición 3.720,08 (0,08 a costo 0 · 720 de Briku a 1.000 ·
-- 3.000 propios a 2,7), foto con cima firme 308,33 / cruda sucia
-- 279,07 / nivel20 295,01, salida 920, comisión viva 25 % y corte
-- de gasto 31,22 %. Uso: python3 /tmp/q.py < este archivo.
-- =====================================================================
create table if not exists public.banco_asesor_cuadre_resultados (
  prueba text primary key, ok boolean, detalle text);
delete from public.banco_asesor_cuadre_resultados;

do $$
declare
  v_base jsonb; v_p jsonb; v_r jsonb; v_prep jsonb; v_c jsonb;
  v_ok boolean; v_det text;
begin
  v_base := jsonb_build_object(
    'ahora', now(),
    'foto', jsonb_build_object(
      'usable', true, 'recibida_en', now(),
      'nivel20', 295.01, 'top_venta', 279.07, 'promedio_venta', 304.11,
      'senal', jsonb_build_object('palabra', 'APROVECHAR'),
      'menu', jsonb_build_object(
        'cima', jsonb_build_object('cruda', 279.07, 'firme', 308.33,
          'sucia', true),
        'peldanos', jsonb_build_array(
          jsonb_build_object('nombre', 'Inmediato', 'tasa', 309.33,
            'g', 70.7, 'bloqueado', false, 'zona', 'automatica',
            'delanteUsd', 488.1),
          jsonb_build_object('nombre', 'Equilibrado', 'tasa', 308.33,
            'g', 74.17, 'bloqueado', false, 'zona', 'automatica',
            'delanteUsd', 488.1),
          jsonb_build_object('nombre', 'Paciente', 'tasa', 295.01,
            'g', 122.66, 'bloqueado', false, 'zona', 'automatica',
            'delanteUsd', 584.77))),
      'ejecutable20', jsonb_build_object('tasa', 295.01, 'usd', 50),
      'duras', jsonb_build_array(jsonb_build_object('lado', 'compra')),
      'transferencia', null),
    'tarifa', jsonb_build_object('salida_ref', 920,
      'ingreso_ref360', 1122.66, 'libro_ref', 1126.98),
    'costo_ref360', 1000,
    'posicion', jsonb_build_object(
      'linea_saldo', 3720.08, 'linea_en', now(),
      'ult_mov_en', now() - interval '1 hour',
      'libro_saldo', 3720.08,
      'lotes', jsonb_build_array(
        jsonb_build_object('cantidad', 0.08, 'costo', 0,
          'contraparte', 'regularizacion_sin_lote'),
        jsonb_build_object('cantidad', 360, 'costo', 1000,
          'contraparte', 'BRIKU-EUX'),
        jsonb_build_object('cantidad', 360, 'costo', 1000,
          'contraparte', 'BRIKU-EUX'),
        jsonb_build_object('cantidad', 3000, 'costo', 8100,
          'contraparte', '54811829')),
      'comprometido_saldo', 0, 'base_venta', true,
      'fondo', 0, 'reserva_cupos', 0, 'mejor_nivel20_hoy', null),
    'puerta', jsonb_build_object('tope_oferta', 50, 'monto_hoy', 0,
      'acciones_hora', 0, 'preparada_viva', false,
      'detenidas', false, 'pausadas', false),
    'cfg', jsonb_build_object('peaje_envio', 5,
      'tope_receptor_envio', 500000, 'mat_fifo', 300),
    'cuadre_cfg', jsonb_build_object('comision_saldo_pct', 25,
      'porciento_gasto', 31.22,
      'buscadores', jsonb_build_array('BRIKU-EUX', 'ABRAHAM-X30')),
    'demanda', jsonb_build_object('usable', false,
      'declaracion', 'sin_medicion', 'bandas', '[]'::jsonb,
      'bandas_hist', '{}'::jsonb),
    'silencio_hasta', null,
    'promo_puesto', jsonb_build_object('activa', false,
      'banda_pct', 5, 'ref_cierre', null));

  -- ---------- A · la vuelta de hoy, completa ----------
  v_r := public.guia_calc_asesor(v_base);
  v_prep := v_r -> 'preparada'; v_c := v_prep -> 'cuadre';

  insert into public.banco_asesor_cuadre_resultados values
    ('a1_nace', v_prep is not null and v_prep <> 'null'::jsonb,
     'preparada=' || coalesce(v_prep ->> 'peldano', 'NULL')
       || ' motivos=' || (v_r -> 'motivos_no_prepara')::text);

  insert into public.banco_asesor_cuadre_resultados values
    ('a2_enviar_con_peaje',
     (v_prep ->> 'receive')::numeric = 3715
       and (v_prep ->> 'peaje_saldo')::numeric = 5
       and (v_c ->> 'saldo_que_sale')::numeric = 3720
       and (v_r #>> '{posicion,vendible}')::numeric = 3715.08,
     'receive=' || (v_prep ->> 'receive')
       || ' vendible=' || (v_r #>> '{posicion,vendible}'));

  insert into public.banco_asesor_cuadre_resultados values
    ('a3_qusd_deriva_del_enviar',
     (v_prep ->> 'monto_qusd')::numeric = 12.05,
     'monto=' || (v_prep ->> 'monto_qusd'));

  insert into public.banco_asesor_cuadre_resultados values
    ('a4_cuadre_cierra_al_centavo',
     (v_c ->> 'cierra')::boolean = true
       and abs((v_c ->> 'costo_lotes')::numeric - 10099.78) < 0.01
       and abs((v_c ->> 'comision_buscador')::numeric - 37.14) < 0.05
       and abs((v_c ->> 'neto')::numeric - 949.08) < 0.1
       and (v_c ->> 'gasto_corte')::numeric = 296
       and abs((v_c ->> 'vuelve_inversion')::numeric - 10752.86) < 0.1
       and abs((v_c ->> 'costo_lotes')::numeric
             + (v_c ->> 'comision_buscador')::numeric
             + (v_c ->> 'neto')::numeric
             - (v_c ->> 'efectivo_entra')::numeric) < 0.01,
     'cuadre=' || v_c::text);

  insert into public.banco_asesor_cuadre_resultados values
    ('a5_ganancia_con_costo_real',
     abs((v_prep ->> 'ganancia360')::numeric - 96.77) < 0.05
       and abs((v_prep ->> 'ganancia360_costo_ref')::numeric - 74.17) < 0.01
       and abs((v_prep ->> 'costo_real360')::numeric - 977.4) < 0.05,
     'g_real=' || (v_prep ->> 'ganancia360')
       || ' g_ref=' || (v_prep ->> 'ganancia360_costo_ref')
       || ' costo_real360=' || (v_prep ->> 'costo_real360'));

  insert into public.banco_asesor_cuadre_resultados values
    ('a6_libro_hoy_y_precio_declarado',
     abs((v_prep #>> '{libro_hoy,cima_firme}')::numeric - 308.33) < 0.01
       and abs((v_prep #>> '{libro_hoy,top_venta_cruda}')::numeric
             - 279.07) < 0.01
       and abs((v_prep #>> '{libro_hoy,nivel20}')::numeric - 295.01) < 0.01
       and abs((v_prep #>> '{precio,brecha_vs_nivel20}')::numeric
             - 13.32) < 0.01
       and (v_prep #>> '{porques,0}') like 'El libro hoy:%',
     'porque0=' || (v_prep #>> '{porques,0}'));

  -- ---------- B · venta parcial topada por la puerta ----------
  v_p := jsonb_set(v_base, '{puerta,tope_oferta}', '10'::jsonb);
  v_r := public.guia_calc_asesor(v_p);
  v_prep := v_r -> 'preparada'; v_c := v_prep -> 'cuadre';
  insert into public.banco_asesor_cuadre_resultados values
    ('b1_parcial_enviar_mas_peaje_no_pasa_posicion',
     v_prep is not null
       and (v_prep ->> 'monto_qusd')::numeric = 10
       and abs((v_prep ->> 'receive')::numeric - 3083.3) < 0.01
       and (v_prep ->> 'receive')::numeric
           + (v_prep ->> 'peaje_saldo')::numeric <= 3720.08
       and (v_c ->> 'cierra')::boolean = true,
     'receive=' || (v_prep ->> 'receive')
       || ' cuadre=' || v_c::text);

  -- ---------- C · vuelta no rentable: no nace ----------
  v_p := v_base;
  v_p := jsonb_set(v_p, '{foto,menu,peldanos}', jsonb_build_array(
    jsonb_build_object('nombre', 'Equilibrado', 'tasa', 400,
      'g', -172, 'bloqueado', false, 'zona', 'automatica',
      'delanteUsd', 0)));
  v_p := jsonb_set(v_p, '{foto,senal}',
    jsonb_build_object('palabra', 'VENDER'));
  v_p := jsonb_set(v_p, '{posicion,lotes}', jsonb_build_array(
    jsonb_build_object('cantidad', 36000, 'costo', 100000,
      'contraparte', '54811829')));
  v_p := jsonb_set(v_p, '{posicion,linea_saldo}', '36000'::jsonb);
  v_p := jsonb_set(v_p, '{posicion,libro_saldo}', '36000'::jsonb);
  v_r := public.guia_calc_asesor(v_p);
  insert into public.banco_asesor_cuadre_resultados values
    ('c1_no_rentable_no_nace',
     ((v_r -> 'preparada') = 'null'::jsonb
       or (v_r -> 'preparada') is null)
       and (v_r -> 'motivos_no_prepara') @> '["vuelta_no_rentable"]'::jsonb
       and (v_r #>> '{cuadre,neto}')::numeric < 0
       and (v_r #>> '{cuadre,cierra}')::boolean = true,
     'motivos=' || (v_r -> 'motivos_no_prepara')::text
       || ' neto=' || (v_r #>> '{cuadre,neto}'));

  -- ---------- D · sin cuadre_cfg (compatibilidad legada) ----------
  v_p := v_base - 'cuadre_cfg';
  v_r := public.guia_calc_asesor(v_p);
  v_prep := v_r -> 'preparada'; v_c := v_prep -> 'cuadre';
  insert into public.banco_asesor_cuadre_resultados values
    ('d1_legado_sin_cfg_nace_con_cuadre_en_cero',
     v_prep is not null
       and (v_c ->> 'comision_buscador')::numeric = 0
       and (v_c ->> 'gasto_corte')::numeric = 0
       and (v_c -> 'comision_pct') = 'null'::jsonb
       and abs((v_c ->> 'neto')::numeric - 986.22) < 0.1,
     'neto=' || (v_c ->> 'neto'));
end $$;

select prueba, ok, detalle from public.banco_asesor_cuadre_resultados
 order by prueba;
select count(*) filter (where ok) as pasan, count(*) as total
  from public.banco_asesor_cuadre_resultados;

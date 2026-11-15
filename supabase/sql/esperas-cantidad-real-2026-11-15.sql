-- =====================================================================
-- EXTENSIÓN DEL CHEQUEO 103 · LA LISTA DE ESPERAS ENSEÑA LA REAL
-- (2026-11-15) — barrido lateral de la tanda del aviso: la misma cifra
-- en la superficie del buscador. El payload de esperas_mi_estado traía
-- solo 'cantidad' (= cantidad_esperada) y la lista de Mi Trabajo la
-- enseñaba también en las esperas YA ASENTADAS: Briku veía «365» en
-- sus vueltas cumplidas de hoy cuando lo real fueron 360 (la esperada
-- incluye el peaje ETECSA, +5 por envío).
--
-- La cura de esta tanda (solo el payload; ni la lógica de esperas, ni
-- el match, ni saldos se tocan): cada fila trae además 'cantidad_real'
-- leída de dinero_esperas.datos (la que espera_asentar_interna asentó),
-- como número cuando existe y null cuando la espera es vieja o aún no
-- se asienta. La forma actual no se rompe: 'cantidad' sigue siendo la
-- esperada y las claves viejas quedan intactas.
--
-- Definición tomada de pg_get_functiondef el 2026-11-15 y editada
-- SOLO en la línea de 'cantidad_real' del jsonb_build_object.
-- El render que la consume vive en Mi Trabajo (SW mitrabajo-v34):
-- en cumplidas manda la real y la esperada solo aparece nombrada
-- como espera cuando difiere; en pendientes sigue la esperada.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.esperas_mi_estado(p_codigo text, p_prueba boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_u record;
  v_prueba boolean := coalesce(p_prueba, false);
  v_mano bigint;
  v_comp bigint;
  v_rows jsonb;
begin
  select * into v_u from public.validar_usuario(p_codigo) limit 1;
  if v_u.codigo is null or not v_u.activo or v_u.bloqueado then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_no_valido');
  end if;

  v_mano := public.espera_pendiente_entregas(v_u.codigo, v_prueba);
  select coalesce(sum(capital_cup), 0)::bigint into v_comp
    from public.dinero_esperas
   where buscador_codigo = v_u.codigo and es_prueba = v_prueba
     and estado = 'abierta';

  select coalesce(jsonb_agg(s.fila order by s.orden, s.creada_en desc), '[]'::jsonb)
    into v_rows
    from (
      select case when e.estado = 'abierta' then 0 else 1 end as orden,
             e.creada_en,
             jsonb_build_object(
               'id', e.id,
               'tipo', e.tipo,
               'cantidad', e.cantidad_esperada,
               'cantidad_real', case when e.datos->>'cantidad_real' is null then null
                                     else (e.datos->>'cantidad_real')::numeric end,
               'capital_cup', e.capital_cup,
               'estado', e.estado,
               'creada_en', e.creada_en,
               'ventana_fin', e.ventana_fin,
               'cumplida_en', e.cumplida_en,
               'tasa_pactada', e.tasa_pactada,
               'total_pagado_cup', e.total_pagado_cup,
               'vueltas', coalesce(jsonb_array_length(e.vuelta_ids), 0)
             ) as fila
        from public.dinero_esperas e
       where e.buscador_codigo = v_u.codigo and e.es_prueba = v_prueba
       order by orden, e.creada_en desc
       limit 30
    ) s;

  return jsonb_build_object(
    'ok', true, 'buscador', v_u.codigo,
    'en_mano', v_mano, 'comprometido', v_comp,
    'libre', greatest(v_mano - v_comp, 0),
    'esperas', v_rows);
end;
$function$;

-- =====================================================================
-- T3 · MI TRABAJO v1.7.0 — PUERTAS DE LA APP PA LAS ESPERAS (2026-11-14)
-- ---------------------------------------------------------------------
-- La obra T3 (pantallas de esperas + Mi pago en la web del buscador)
-- necesita dos puertas que NO existían pa la app (verificado en vivo
-- el 2026-11-14 por pg_proc: solo existían las internas del cerebro,
-- service_role, y espera_crear_operada_tasa):
--
--   · esperas_mi_estado(codigo) — LECTURA: SOLO sus esperas (las 30
--     más recientes, abiertas primero) + su efectivo en mano, lo ya
--     comprometido en esperas abiertas y lo LIBRE pa un parte nuevo.
--     Devuelve de cada espera solo lo suyo y en claro: tipo, cantidad
--     esperada, capital (su efectivo puesto), estado, fechas, la tasa
--     y el total de SU parte, y las vueltas que nacieron de ella.
--     Nada de la cocina: sin peaje, sin falta, sin datos de Ernesto
--     ni de otro buscador.
--
--   · espera_crear_app(...) — EL PARTE CON TASA desde la app: la
--     puerta equivalente a espera_crear_operada_tasa pero validando
--     el código del buscador DENTRO (patrón pago_mi_estado). Nace por
--     la MISMA interna de siempre (espera_crear_interna_v2, origen
--     'reporte' — el parte manda) con su regla del capital intacta.
--     Semántica de la tasa, la del trigger de reportes:
--       saldo:         p_tasa = precio pactado por recarga de 360;
--                      cantidad = total ÷ tasa × 360 (el saldo que
--                      tiene que llegar); tasa guardada = tasa ÷ 360
--                      (CUP por unidad, la de tasa-calle).
--       transferencia: p_tasa = el % del trato; cantidad = total ×
--                      (1 + %/100) (lo que tiene que entrar por
--                      transferencia); sin tasa unitaria (como el
--                      trigger).
--     Frenos en la puerta (la app también frena antes de mandar):
--     tasa ≤ 0 → tasa_invalida · total ≤ 0 → total_invalido ·
--     total > su efectivo LIBRE (en mano − comprometido en esperas
--     abiertas) → supera_tu_efectivo con la foto de su libre.
--
--   · pago_mi_estado: la puerta del CHEQUEO 93 quedó SOLO
--     service_role (verificado en vivo: anon NO puede ejecutarla),
--     así que la app jamás podría leerla. Se le da execute a
--     anon/authenticated: la puerta valida el código dentro, igual
--     que dinero_leer_estado y guia_buscador, que ya son anon.
--
-- Bancos: bancos/prueba-esperas-app-t3.mjs (vivo, es_prueba) y el
-- render/frontera en bancos/prueba-mitrabajo-v170.mjs (jsdom).
-- =====================================================================

create or replace function public.esperas_mi_estado(
  p_codigo text, p_prueba boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
$$;

create or replace function public.espera_crear_app(
  p_codigo text, p_tipo text, p_tasa numeric, p_total_pagado bigint,
  p_telefono text default null, p_prueba boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_u record;
  v_prueba boolean := coalesce(p_prueba, false);
  v_mano bigint;
  v_comp bigint;
  v_libre bigint;
  v_cantidad numeric;
  v_tasa_unitaria numeric;
  v_envios integer;
  v_res jsonb;
begin
  select * into v_u from public.validar_usuario(p_codigo) limit 1;
  if v_u.codigo is null or not v_u.activo or v_u.bloqueado then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_no_valido');
  end if;
  if p_tipo not in ('saldo', 'transferencia') then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_invalido');
  end if;
  if p_tasa is null or p_tasa <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'tasa_invalida');
  end if;
  if p_total_pagado is null or p_total_pagado <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'total_invalido');
  end if;

  v_mano := public.espera_pendiente_entregas(v_u.codigo, v_prueba);
  select coalesce(sum(capital_cup), 0)::bigint into v_comp
    from public.dinero_esperas
   where buscador_codigo = v_u.codigo and es_prueba = v_prueba
     and estado = 'abierta';
  v_libre := greatest(v_mano - v_comp, 0);
  if p_total_pagado > v_libre then
    return jsonb_build_object('ok', false, 'motivo', 'supera_tu_efectivo',
      'en_mano', v_mano, 'comprometido', v_comp, 'libre', v_libre);
  end if;

  if p_tipo = 'saldo' then
    v_cantidad := round(p_total_pagado / p_tasa * 360.0, 2);
    v_tasa_unitaria := round(p_tasa / 360.0, 4);
    v_envios := greatest(1, round(v_cantidad / 360.0)::integer);
  else
    if p_tasa > 200 then
      return jsonb_build_object('ok', false, 'motivo', 'tasa_invalida');
    end if;
    v_cantidad := round(p_total_pagado * (1 + p_tasa / 100.0), 2);
    v_tasa_unitaria := null;
    v_envios := null;
  end if;
  if v_cantidad is null or v_cantidad <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;

  v_res := public.espera_crear_interna_v2(
    v_u.codigo, p_tipo, v_cantidad, p_total_pagado,
    'reporte', null, p_telefono, 48, v_prueba,
    v_tasa_unitaria, p_total_pagado, v_envios);

  return coalesce(v_res, jsonb_build_object('ok', false, 'motivo', 'sin_respuesta'))
         || jsonb_build_object('cantidad_esperada', v_cantidad, 'libre', v_libre);
end;
$$;

revoke all on function public.esperas_mi_estado(text, boolean) from public;
revoke all on function public.espera_crear_app(text, text, numeric, bigint, text, boolean) from public;
grant execute on function public.esperas_mi_estado(text, boolean) to anon, authenticated, service_role;
grant execute on function public.espera_crear_app(text, text, numeric, bigint, text, boolean) to anon, authenticated, service_role;

-- La puerta de Mi pago (CHEQUEO 93) valida el código dentro: la app
-- la lee con la llave publicable, como dinero_leer_estado.
grant execute on function public.pago_mi_estado(text, boolean) to anon, authenticated;

-- =====================================================================
-- TARIFA VIVA INTELIGENTE (2026-11-13 · orden de Ernesto: «mejor
-- poner tarifa en AUTOMÁTICO, pero con todo real, los datos, todo
-- calculado — una inteligencia enorme»)
--
-- El régimen de PROPUESTAS con toque DESAPARECE: el motor decide
-- solo, con reglas duras y todo registrado en tarifa_viva_historial
-- (cada decisión lleva su PORQUÉ en palabras en detalle.porque):
--
--   1) FOTO FRESCA O NADA: todo movimiento exige la foto actual
--      fresca (≤20 min). Foto vieja = no se mueve y el motivo queda.
--   2) DOS LECTURAS: movimientos ≤2% (la banda) se aplican con una
--      foto fresca. Movimientos >2% exigen DOS fotos frescas
--      consecutivas apuntando en la misma dirección (la regla de
--      las dos lecturas de Ernesto): la primera deja la
--      confirmación armada ('esperando_confirmacion') y la segunda
--      aplica. Dirección contraria = la cuenta vuelve a empezar.
--   3) TASA SUAVIZADA: la tasa de referencia ya no es el nivel20 de
--      una sola foto: media ponderada por recencia (pesos 3-2-1)
--      de las últimas 2–3 fotos FRESCAS, con la profundidad de cada
--      foto (etecsa_count_sell) modulando su peso — un libro fino
--      pesa menos. El libro (bankcup) se suaviza igual y se mueve
--      con la misma disciplina de confirmación.
--   4) LÍMITES DE VELOCIDAD: ingreso_ref360 no puede cambiar más
--      de ±4% en 1 hora ni ±8% en 24 h (neto, medido sobre el
--      historial real de aplicaciones, vengan del motor o de la
--      mano de Ernesto). Lo que exceda se RECORTA al límite y el
--      historial lo dice; si no cabe nada, no se aplica
--      ('limite_velocidad') y la confirmación queda armada.
--   5) PISO DE MARGEN: la referencia jamás baja del costo estándar
--      de Ernesto (1.000 por recarga): ahí la ganancia de la vuelta
--      se haría cero pa AMBOS (con el 32% de un buscador a 4.9★).
--      Si el mercado pide menos, se aplica el piso y se explica.
--   6) LA SALIDA JAMÁS LA TOCA. Y si Ernesto fija la tarifa a mano
--      (admin_guardar_tarifa), la inteligencia queda EN PAUSA
--      respetando su número hasta que él la reactive desde la app
--      (tarifa_viva_inteligencia). El interruptor también vive ahí.
--   7) LA PROPUESTA PENDIENTE del régimen viejo la resuelve la
--      PRIMERA evaluación del motor nuevo: aplicada si la
--      inteligencia aplica un movimiento en su misma dirección;
--      descartada en cualquier otro caso — con su porqué.
--
-- ARQUITECTURA: la lógica de decisión vive en una función PURA
-- (tarifa_viva_decidir, con tarifa_viva_suavizar): recibe todo por
-- jsonb y devuelve la decisión + el porqué, sin escribir nada —
-- los bancos la prueban regla por regla. El motor
-- (tarifa_viva_evaluar) solo lee las tablas, la llama y persiste.
-- Lo que PAGA cada trato no cambia: la foto de tarifa del cierre,
-- congelada por las puertas dinero_/admin_foto_tarifa_reporte.
--
-- Idempotente: segunda corrida inocua.
-- =====================================================================

-- ---------- 1) Config + estado de la inteligencia ----------
create table if not exists public.tarifa_viva_config (
  id                int primary key default 1,
  inteligente_activa boolean not null default true,
  umbral_grande_pct numeric not null default 2,    -- banda de aplicación directa
  vel_max_hora_pct  numeric not null default 4,    -- límite de velocidad 1 h
  vel_max_dia_pct   numeric not null default 8,    -- límite de velocidad 24 h
  costo_ref         numeric not null default 1000, -- costo estándar por recarga (el piso)
  comision_busq_pct numeric not null default 32,   -- 4.9★ (pa la cuenta del margen)
  profundidad_ref   int     not null default 50,   -- ofertas de venta = profundidad plena
  conf_direccion    int     not null default 0,    -- confirmación armada: -1 | 0 | +1
  conf_foto_id      uuid,
  conf_delta_pct    numeric,
  conf_en           timestamptz,
  actualizado       timestamptz not null default now(),
  constraint tarifa_viva_config_una_fila check (id = 1)
);
alter table public.tarifa_viva_config enable row level security;
revoke all on table public.tarifa_viva_config from anon, authenticated;
insert into public.tarifa_viva_config (id) values (1) on conflict (id) do nothing;

-- El régimen de propuestas muere: su índice de «una pendiente» y su
-- puerta de resolución salen del sistema.
drop index if exists public.tarifa_viva_una_pendiente;
drop function if exists public.tarifa_viva_resolver(text, text);

-- ---------- 2) El suavizado PURO (ponderado por recencia y profundidad) ----------
-- p_fotos: arreglo NUEVA → VIEJA de {nivel20, promedio_venta,
-- bankcup, count_sell, fresca}. Solo entran las frescas (máx 3).
-- Peso de cada foto = recencia (3, 2, 1) × (0.25 + 0.75 × profundidad),
-- profundidad = min(1, count_sell / p_profundidad_ref); sin count, 1.
create or replace function public.tarifa_viva_suavizar(
  p_fotos jsonb, p_profundidad_ref int default 50)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_pesos numeric[] := array[3, 2, 1];
  v_i int := 0;
  v_f jsonb;
  v_tasa numeric;
  v_factor numeric;
  v_peso numeric;
  v_sum_t numeric := 0;
  v_sum_p numeric := 0;
  v_sum_l numeric := 0;
  v_sum_pl numeric := 0;
  v_det jsonb := '[]'::jsonb;
begin
  for v_f in
    select value from jsonb_array_elements(coalesce(p_fotos, '[]'::jsonb)) with ordinality as o(value, n)
    where o.n <= 3
  loop
    if not coalesce((v_f ->> 'fresca')::boolean, false) then
      continue;  -- solo fotos frescas suavizan
    end if;
    v_tasa := coalesce((v_f ->> 'nivel20')::numeric, (v_f ->> 'promedio_venta')::numeric);
    if v_tasa is null or v_tasa <= 0 then
      continue;
    end if;
    v_i := v_i + 1;
    v_factor := case
      when (v_f ->> 'count_sell') is null then 1
      else least(1, (v_f ->> 'count_sell')::numeric / greatest(coalesce(p_profundidad_ref, 50), 1))
    end;
    v_peso := v_pesos[v_i] * (0.25 + 0.75 * v_factor);
    v_sum_t := v_sum_t + v_tasa * v_peso;
    v_sum_p := v_sum_p + v_peso;
    if (v_f ->> 'bankcup') is not null and (v_f ->> 'bankcup')::numeric > 0 then
      v_sum_l := v_sum_l + (v_f ->> 'bankcup')::numeric * v_peso;
      v_sum_pl := v_sum_pl + v_peso;
    end if;
    v_det := v_det || jsonb_build_object(
      'tasa', v_tasa, 'peso', round(v_peso, 3),
      'count_sell', (v_f ->> 'count_sell'), 'profundidad', round(v_factor, 3));
  end loop;
  if v_sum_p = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_fotos_frescas_con_tasa');
  end if;
  return jsonb_build_object(
    'ok', true,
    'tasa_ref', round(v_sum_t / v_sum_p, 4),
    'libro_ref', case when v_sum_pl > 0 then round(v_sum_l / v_sum_pl, 2) else null end,
    'n_fotos', v_i,
    'detalle_fotos', v_det);
end;
$function$;
revoke execute on function public.tarifa_viva_suavizar(jsonb, int) from public;
grant execute on function public.tarifa_viva_suavizar(jsonb, int) to anon;

-- ---------- 3) La decisión PURA (todas las reglas, con su porqué) ----------
-- Entrada jsonb: {ingreso_vigente, libro_vigente, salida, activa,
--   umbral_pct, vel_hora_pct, vel_dia_pct, costo_ref,
--   comision_busq_pct, profundidad_ref,
--   foto: {id, fresca, edad_min}, fotos: [...suavizar...],
--   conf: {direccion, foto_id, delta_pct},
--   neto_1h_pct, neto_24h_pct}  (cambio neto ya andado en la ventana)
-- Salida: {ok, accion, ingreso_nuevo (solo si aplica), ingreso_candidato,
--   libro_nuevo, tasa_ref, delta_pct, delta_aplicado_pct, nueva_conf,
--   piso_aplicado, recorte_velocidad, porque, detalle}
create or replace function public.tarifa_viva_decidir(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_ing_v numeric := (p ->> 'ingreso_vigente')::numeric;
  v_lib_v numeric := (p ->> 'libro_vigente')::numeric;
  v_sal   numeric := (p ->> 'salida')::numeric;
  v_activa boolean := coalesce((p ->> 'activa')::boolean, true);
  v_umbral numeric := coalesce((p ->> 'umbral_pct')::numeric, 2);
  v_vh numeric := coalesce((p ->> 'vel_hora_pct')::numeric, 4);
  v_vd numeric := coalesce((p ->> 'vel_dia_pct')::numeric, 8);
  v_costo numeric := coalesce((p ->> 'costo_ref')::numeric, 1000);
  v_com numeric := coalesce((p ->> 'comision_busq_pct')::numeric, 32);
  v_prof int := coalesce((p ->> 'profundidad_ref')::int, 50);
  v_foto_id text := p -> 'foto' ->> 'id';
  v_fresca boolean := coalesce((p -> 'foto' ->> 'fresca')::boolean, false);
  v_edad numeric := (p -> 'foto' ->> 'edad_min')::numeric;
  v_conf_dir int := coalesce((p -> 'conf' ->> 'direccion')::int, 0);
  v_conf_foto text := p -> 'conf' ->> 'foto_id';
  v_conf_misma jsonb := jsonb_build_object('direccion', v_conf_dir, 'foto_id', v_conf_foto,
    'delta_pct', (p -> 'conf' ->> 'delta_pct'));
  v_conf_limpia jsonb := jsonb_build_object('direccion', 0, 'foto_id', null, 'delta_pct', null);
  v_n1 numeric := coalesce((p ->> 'neto_1h_pct')::numeric, 0);
  v_n24 numeric := coalesce((p ->> 'neto_24h_pct')::numeric, 0);
  v_suav jsonb; v_tasa numeric; v_lib_s numeric;
  v_ing_calc numeric; v_delta_calc numeric;
  v_piso numeric;
  v_ing_obj numeric; v_delta numeric; v_dir int;
  v_piso_ap boolean := false;
  v_lo numeric; v_hi numeric; v_delta_ap numeric;
  v_recorte boolean := false;
  v_ing_fin numeric; v_lib_fin numeric;
  v_gan numeric; v_gb numeric; v_ge numeric;
  v_porque text;
  v_base jsonb;
begin
  if v_ing_v is null or v_ing_v <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_ingreso_vigente');
  end if;
  if v_sal is null or v_sal <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_salida_vigente');
  end if;
  v_piso := v_costo;

  -- 0) La inteligencia en pausa manda: Ernesto fijó la tarifa a mano.
  if not v_activa then
    return jsonb_build_object('ok', true, 'accion', 'pausa_manual',
      'ingreso_candidato', null, 'nueva_conf', v_conf_misma,
      'porque', 'La inteligencia está en pausa (la tarifa la fija Ernesto a mano): no se tocó nada.',
      'detalle', jsonb_build_object('activa', false));
  end if;

  -- 1) Foto fresca o nada.
  if (p -> 'foto') is null or not v_fresca or v_edad is null or v_edad > 20 then
    return jsonb_build_object('ok', true, 'accion', 'foto_vieja',
      'ingreso_candidato', null, 'nueva_conf', v_conf_misma,
      'porque', 'Foto vieja o sin marcar fresca'
        || case when v_edad is not null then ' (edad ' || round(v_edad, 1) || ' min)' else '' end
        || ': la tarifa no se mueve con datos viejos.',
      'detalle', jsonb_build_object('edad_min', v_edad, 'fresca', v_fresca));
  end if;

  -- 2) Tasa suavizada (recencia × profundidad) → ingreso del mercado.
  v_suav := public.tarifa_viva_suavizar(coalesce(p -> 'fotos', '[]'::jsonb), v_prof);
  if not coalesce((v_suav ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', v_suav ->> 'motivo');
  end if;
  v_tasa := (v_suav ->> 'tasa_ref')::numeric;
  v_lib_s := (v_suav ->> 'libro_ref')::numeric;
  v_ing_calc := round(360 * v_sal / v_tasa, 2);
  v_delta_calc := round((v_ing_calc - v_ing_v) / v_ing_v * 100, 4);

  -- 3) Piso de margen: jamás por debajo del costo (ganancia cero).
  v_ing_obj := greatest(v_ing_calc, v_piso);
  v_piso_ap := v_ing_calc < v_piso;
  v_delta := round((v_ing_obj - v_ing_v) / v_ing_v * 100, 4);
  v_dir := sign(v_delta)::int;

  v_base := jsonb_build_object(
    'tasa_ref', v_tasa, 'fotos_usadas', (v_suav ->> 'n_fotos'),
    'detalle_fotos', v_suav -> 'detalle_fotos',
    'ingreso_mercado', v_ing_calc, 'delta_mercado_pct', v_delta_calc,
    'piso', v_piso, 'piso_aplicado', v_piso_ap,
    'neto_1h_pct', v_n1, 'neto_24h_pct', v_n24);

  -- 4) Sin cambio: el mercado suavizado reproduce la tarifa vigente.
  if v_ing_obj = v_ing_v and (v_lib_s is null or v_lib_s = v_lib_v) then
    return jsonb_build_object('ok', true, 'accion', 'sin_cambio',
      'ingreso_candidato', v_ing_obj, 'libro_nuevo', v_lib_s,
      'tasa_ref', v_tasa, 'delta_pct', v_delta,
      'nueva_conf', v_conf_limpia, 'piso_aplicado', v_piso_ap,
      'porque', case when v_piso_ap then
          'El mercado pide ' || v_ing_calc || ' por recarga, por debajo del costo (' || v_piso
          || '): la referencia ya está en el piso de margen y no baja más. No se tocó nada.'
        else
          'El mercado suavizado (tasa ' || v_tasa || ') reproduce la tarifa vigente: sin cambio.'
        end,
      'detalle', v_base);
  end if;

  -- 5) Confirmación de dos lecturas pa saltos grandes.
  if abs(v_delta) > v_umbral then
    if not (v_conf_dir = v_dir and v_conf_foto is not null and v_conf_foto <> v_foto_id) then
      return jsonb_build_object('ok', true, 'accion', 'esperando_confirmacion',
        'ingreso_candidato', v_ing_obj, 'libro_nuevo', v_lib_s,
        'tasa_ref', v_tasa, 'delta_pct', v_delta,
        'nueva_conf', jsonb_build_object('direccion', v_dir, 'foto_id', v_foto_id, 'delta_pct', v_delta),
        'piso_aplicado', v_piso_ap,
        'porque', 'Salto de ' || v_delta || '% (más del ' || v_umbral || '%): primera lectura, con la tasa suavizada '
          || v_tasa || ' de ' || (v_suav ->> 'n_fotos') || ' foto(s) fresca(s). '
          || case when v_piso_ap then 'El mercado pide ' || v_ing_calc || ', por debajo del costo: el objetivo queda en el piso ' || v_piso || '. ' else '' end
          || 'Falta una segunda foto fresca en la misma dirección pa confirmarlo: no se tocó nada.',
        'detalle', v_base || jsonb_build_object('confirmacion', 'primera_lectura'));
    end if;
  end if;

  -- 6) Límites de velocidad (neto por ventana, historial real).
  v_lo := greatest(-v_vh - v_n1, -v_vd - v_n24);
  v_hi := least(v_vh - v_n1, v_vd - v_n24);
  v_delta_ap := least(greatest(v_delta, v_lo), v_hi);
  if (v_delta > 0 and v_delta_ap <= 0) or (v_delta < 0 and v_delta_ap >= 0) then
    return jsonb_build_object('ok', true, 'accion', 'limite_velocidad',
      'ingreso_candidato', v_ing_obj, 'libro_nuevo', v_lib_s,
      'tasa_ref', v_tasa, 'delta_pct', v_delta, 'delta_aplicado_pct', 0,
      'nueva_conf', v_conf_misma, 'piso_aplicado', v_piso_ap,
      'porque', 'El salto de ' || v_delta || '% está confirmado pero choca con el límite de velocidad (±'
        || v_vh || '% por hora · ±' || v_vd || '% por día; ya se movió ' || v_n1 || '% en la hora y '
        || v_n24 || '% en el día): no se aplicó nada y la confirmación queda armada.',
      'detalle', v_base || jsonb_build_object('confirmacion',
        case when abs(v_delta) > v_umbral then 'confirmada' else 'no_aplica' end));
  end if;
  v_recorte := v_delta_ap <> v_delta;
  v_ing_fin := round(v_ing_v * (1 + v_delta_ap / 100), 2);
  if v_ing_fin < v_piso then v_ing_fin := v_piso; end if;  -- el piso manda también tras el recorte
  v_lib_fin := coalesce(v_lib_s, v_lib_v);

  if v_ing_fin = v_ing_v and v_lib_fin is not distinct from v_lib_v then
    return jsonb_build_object('ok', true, 'accion', 'sin_cambio',
      'ingreso_candidato', v_ing_obj, 'libro_nuevo', v_lib_s,
      'tasa_ref', v_tasa, 'delta_pct', v_delta,
      'nueva_conf', v_conf_limpia, 'piso_aplicado', v_piso_ap,
      'porque', 'El movimiento quedó absorbido por el límite de velocidad y el piso de margen: la tarifa no cambia.',
      'detalle', v_base);
  end if;

  -- Margen de la vuelta con el valor FINAL (pa la explicación).
  v_gan := round(v_ing_fin - v_costo, 2);
  v_gb := round(v_gan * v_com / 100, 2);
  v_ge := round(v_gan - v_gb, 2);

  v_porque :=
    case when abs(v_delta) > v_umbral
      then 'Dos fotos frescas consecutivas en la misma dirección confirman el salto de ' || v_delta
           || '%: se aplica. '
      else 'Foto fresca dentro de la banda (±' || v_umbral || '%): se aplica. ' end
    || 'Tasa suavizada ' || v_tasa || ' (de ' || (v_suav ->> 'n_fotos') || ' foto(s), ponderada por recencia y profundidad) '
    || 'con tu salida ' || v_sal || ': el ingreso por recarga pasa de ' || v_ing_v || ' a ' || v_ing_fin
    || case when v_lib_fin is distinct from v_lib_v then ' y el libro a ' || v_lib_fin else '' end || '. '
    || case when v_recorte then 'Recortado al límite de velocidad (±' || v_vh || '%/hora · ±' || v_vd
           || '%/día): el mercado pedía ' || v_delta || '% y se aplicó ' || round(v_delta_ap, 2) || '%. ' else '' end
    || case when v_piso_ap then 'El mercado pedía ' || v_ing_calc || ', por debajo del costo: se aplicó el piso de margen ' || v_piso || '. ' else '' end
    || 'Margen por recarga: ' || v_gan || ' (buscador a ' || v_com || '%: ' || v_gb || ' · Ernesto: ' || v_ge || ').';

  return jsonb_build_object('ok', true, 'accion', 'aplicar',
    'ingreso_nuevo', v_ing_fin, 'ingreso_candidato', v_ing_obj,
    'libro_nuevo', v_lib_fin, 'tasa_ref', v_tasa,
    'delta_pct', v_delta, 'delta_aplicado_pct', round(v_delta_ap, 4),
    'nueva_conf', v_conf_limpia, 'piso_aplicado', v_piso_ap,
    'recorte_velocidad', v_recorte,
    'porque', v_porque,
    'detalle', v_base || jsonb_build_object(
      'confirmacion', case when abs(v_delta) > v_umbral then 'confirmada' else 'no_aplica' end,
      'delta_aplicado_pct', round(v_delta_ap, 4), 'recorte_velocidad', v_recorte,
      'ganancia_recarga', v_gan, 'gana_buscador', v_gb, 'gana_ernesto', v_ge));
end;
$function$;
revoke execute on function public.tarifa_viva_decidir(jsonb) from public;
grant execute on function public.tarifa_viva_decidir(jsonb) to anon;

-- ---------- 4) El motor nuevo: lee, decide (la pura), persiste ----------
create or replace function public.tarifa_viva_evaluar(p_simular boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t public.tarifa%rowtype;
  v_c public.tarifa_viva_config%rowtype;
  v_f public.mercado_fotos%rowtype;
  v_fotos jsonb;
  v_prop public.tarifa_viva_historial%rowtype;
  v_base1 numeric; v_base24 numeric;
  v_n1 numeric; v_n24 numeric;
  v_in jsonb; v_d jsonb;
  v_accion text; v_hist uuid;
  v_ing_fin numeric; v_delta_ap numeric;
  v_prop_estado text;
begin
  select * into v_t from public.tarifa where id = 1 for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sin_tarifa'); end if;
  select * into v_c from public.tarifa_viva_config where id = 1;
  if not found then
    insert into public.tarifa_viva_config (id) values (1) on conflict (id) do nothing;
    select * into v_c from public.tarifa_viva_config where id = 1;
  end if;

  select * into v_f from public.mercado_fotos order by recibida_en desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'sin_fotos'); end if;

  -- Idempotencia: esta foto ya se evaluó (una foto = una lectura).
  if exists (select 1 from public.tarifa_viva_historial where foto_id = v_f.id) then
    return jsonb_build_object('ok', true, 'decision', 'ya_evaluada', 'foto_id', v_f.id);
  end if;

  -- Las últimas 3 fotos (nueva → vieja) pa el suavizado.
  select coalesce(jsonb_agg(jsonb_build_object(
      'nivel20', f.etecsa_nivel20, 'promedio_venta', f.etecsa_promedio_venta,
      'bankcup', f.bankcup_promedio, 'count_sell', f.etecsa_count_sell,
      'fresca', f.fresca) order by f.recibida_en desc), '[]'::jsonb)
    into v_fotos
    from (select * from public.mercado_fotos order by recibida_en desc limit 3) f;

  -- Velocidad: cambio neto ya andado en cada ventana, del historial
  -- real (aplicaciones del motor + fijaciones manuales de Ernesto).
  select coalesce(
      (select h.ingreso_nuevo from public.tarifa_viva_historial h
        where h.decision in ('aplicada', 'manual') and h.creado_en <= now() - interval '1 hour'
        order by h.creado_en desc limit 1),
      (select h.ingreso_viejo from public.tarifa_viva_historial h
        where h.decision in ('aplicada', 'manual') and h.creado_en > now() - interval '1 hour'
        order by h.creado_en asc limit 1),
      v_t.ingreso_ref360)
    into v_base1;
  select coalesce(
      (select h.ingreso_nuevo from public.tarifa_viva_historial h
        where h.decision in ('aplicada', 'manual') and h.creado_en <= now() - interval '24 hours'
        order by h.creado_en desc limit 1),
      (select h.ingreso_viejo from public.tarifa_viva_historial h
        where h.decision in ('aplicada', 'manual') and h.creado_en > now() - interval '24 hours'
        order by h.creado_en asc limit 1),
      v_t.ingreso_ref360)
    into v_base24;
  v_n1 := round((v_t.ingreso_ref360 - v_base1) / v_base1 * 100, 4);
  v_n24 := round((v_t.ingreso_ref360 - v_base24) / v_base24 * 100, 4);

  v_in := jsonb_build_object(
    'ingreso_vigente', v_t.ingreso_ref360, 'libro_vigente', v_t.libro_ref,
    'salida', v_t.salida_ref,
    'activa', v_c.inteligente_activa, 'umbral_pct', v_c.umbral_grande_pct,
    'vel_hora_pct', v_c.vel_max_hora_pct, 'vel_dia_pct', v_c.vel_max_dia_pct,
    'costo_ref', v_c.costo_ref, 'comision_busq_pct', v_c.comision_busq_pct,
    'profundidad_ref', v_c.profundidad_ref,
    'foto', jsonb_build_object('id', v_f.id, 'fresca', v_f.fresca,
      'edad_min', round((extract(epoch from (now() - v_f.recibida_en)) / 60.0)::numeric, 1)),
    'fotos', v_fotos,
    'conf', jsonb_build_object('direccion', v_c.conf_direccion,
      'foto_id', v_c.conf_foto_id, 'delta_pct', v_c.conf_delta_pct),
    'neto_1h_pct', v_n1, 'neto_24h_pct', v_n24);

  v_d := public.tarifa_viva_decidir(v_in);
  if not coalesce((v_d ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'motivo', v_d ->> 'motivo', 'foto_id', v_f.id);
  end if;
  v_accion := v_d ->> 'accion';

  -- La propuesta pendiente del régimen viejo (si la hay).
  select * into v_prop from public.tarifa_viva_historial
   where decision = 'propuesta' and estado = 'pendiente'
   order by creado_en desc limit 1;

  if p_simular then
    return jsonb_build_object('ok', true, 'decision', v_accion, 'simular', true,
      'foto_id', v_f.id, 'decision_completa', v_d,
      'ingreso_viejo', v_t.ingreso_ref360, 'libro_viejo', v_t.libro_ref,
      'propuesta_pendiente', case when v_prop.id is null then null else v_prop.id end);
  end if;

  v_ing_fin := (v_d ->> 'ingreso_nuevo')::numeric;
  v_delta_ap := (v_d ->> 'delta_aplicado_pct')::numeric;

  if v_accion = 'aplicar' then
    update public.tarifa
       set ingreso_ref360 = v_ing_fin,
           libro_ref      = (v_d ->> 'libro_nuevo')::numeric,
           actualizado    = now(),
           actualizado_por = 'MERCADO'
     where id = 1;
  end if;

  -- La confirmación que devuelve la pura manda en el estado del motor.
  update public.tarifa_viva_config
     set conf_direccion = coalesce((v_d -> 'nueva_conf' ->> 'direccion')::int, 0),
         conf_foto_id   = (v_d -> 'nueva_conf' ->> 'foto_id')::uuid,
         conf_delta_pct = (v_d -> 'nueva_conf' ->> 'delta_pct')::numeric,
         conf_en        = case when coalesce((v_d -> 'nueva_conf' ->> 'direccion')::int, 0) <> 0
                               then now() else null end,
         actualizado    = now()
   where id = 1;

  insert into public.tarifa_viva_historial
    (foto_id, foto_recibida_en, foto_origen_en, ingreso_viejo, ingreso_nuevo,
     libro_viejo, libro_nuevo, salida_ref, tasa_ref, bankcup_ref, delta_pct, decision, detalle)
  values
    (v_f.id, v_f.recibida_en, v_f.origen_en, v_t.ingreso_ref360,
     coalesce(v_ing_fin, (v_d ->> 'ingreso_candidato')::numeric),
     v_t.libro_ref, (v_d ->> 'libro_nuevo')::numeric, v_t.salida_ref,
     (v_d ->> 'tasa_ref')::numeric, v_f.bankcup_promedio,
     coalesce(v_delta_ap, (v_d ->> 'delta_pct')::numeric),
     case v_accion
       when 'aplicar' then 'aplicada'
       else v_accion end,
     coalesce(v_d -> 'detalle', '{}'::jsonb) || jsonb_build_object(
       'porque', v_d ->> 'porque',
       'accion_motor', v_accion,
       'neto_1h_pct', v_n1, 'neto_24h_pct', v_n24))
  returning id into v_hist;

  -- Regla 7: la propuesta del régimen viejo muere en esta primera
  -- evaluación — aplicada solo si la inteligencia aplicó un
  -- movimiento en su misma dirección; si no, descartada. Con la
  -- inteligencia en pausa no se toca (manda la mano de Ernesto).
  if v_prop.id is not null and v_accion <> 'pausa_manual' then
    v_prop_estado := case
      when v_accion = 'aplicar' and v_delta_ap is not null and v_prop.delta_pct is not null
           and sign(v_delta_ap) = sign(v_prop.delta_pct)
      then 'aplicada' else 'descartada' end;
    update public.tarifa_viva_historial
       set estado = v_prop_estado, resuelta_en = now(), resuelta_por = 'MOTOR_INTELIGENTE',
           detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object(
             'resolucion_inteligente', jsonb_build_object(
               'decision_motor', v_accion, 'porque', v_d ->> 'porque',
               'valor_aplicado', v_ing_fin, 'historial_motor', v_hist))
     where id = v_prop.id;
  end if;

  return jsonb_build_object('ok', true, 'decision',
    case v_accion when 'aplicar' then 'aplicada' else v_accion end,
    'historial_id', v_hist, 'foto_id', v_f.id, 'decision_completa', v_d,
    'propuesta_resuelta', case when v_prop.id is null or v_accion = 'pausa_manual'
      then null else v_prop_estado end);
end;
$function$;
-- El motor ESCRIBE: jamás callable por anon. Lo corre pg_cron.
revoke execute on function public.tarifa_viva_evaluar(boolean) from public, anon, authenticated;

-- El vigilante sigue igual: cada 5 min evalúa la foto más nueva.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'tarifa-viva-cada-5min') then
    perform cron.unschedule('tarifa-viva-cada-5min');
  end if;
  perform cron.schedule('tarifa-viva-cada-5min', '*/5 * * * *',
    'select public.tarifa_viva_evaluar(false)');
end $$;

-- ---------- 5) Puerta del DUEÑO: estado de la inteligencia ----------
create or replace function public.tarifa_viva_estado()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t public.tarifa%rowtype;
  v_c public.tarifa_viva_config%rowtype;
  v_f public.mercado_fotos%rowtype;
  v_ultm public.tarifa_viva_historial%rowtype;
  v_ultd public.tarifa_viva_historial%rowtype;
  v_hist jsonb;
begin
  select * into v_t from public.tarifa where id = 1;
  select * into v_c from public.tarifa_viva_config where id = 1;
  select * into v_f from public.mercado_fotos order by recibida_en desc limit 1;
  select * into v_ultm from public.tarifa_viva_historial
   where decision in ('aplicada', 'manual') order by creado_en desc limit 1;
  select * into v_ultd from public.tarifa_viva_historial order by creado_en desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
      'creado_en', h.creado_en, 'decision', h.decision, 'estado', h.estado,
      'ingreso_viejo', h.ingreso_viejo, 'ingreso_nuevo', h.ingreso_nuevo,
      'libro_nuevo', h.libro_nuevo, 'delta_pct', h.delta_pct,
      'porque', h.detalle ->> 'porque') order by h.creado_en desc), '[]'::jsonb)
    into v_hist
    from (select * from public.tarifa_viva_historial order by creado_en desc limit 8) h;

  return jsonb_build_object(
    'ok', true,
    'tarifa', jsonb_build_object(
      'ingreso_ref360', v_t.ingreso_ref360, 'libro_ref', v_t.libro_ref,
      'salida_ref', v_t.salida_ref, 'comision_saldo', v_t.comision_saldo,
      'comision_transf', v_t.comision_transf, 'piso_transf', v_t.piso_transf,
      'actualizado', v_t.actualizado, 'actualizado_por', v_t.actualizado_por),
    'foto', case when v_f.id is null then null else jsonb_build_object(
      'id', v_f.id, 'recibida_en', v_f.recibida_en, 'origen_en', v_f.origen_en,
      'fresca', v_f.fresca,
      'edad_min', round((extract(epoch from (now() - v_f.recibida_en)) / 60.0)::numeric, 1),
      'nivel20', v_f.etecsa_nivel20, 'promedio_venta', v_f.etecsa_promedio_venta,
      'bankcup_promedio', v_f.bankcup_promedio,
      'count_sell', v_f.etecsa_count_sell) end,
    'inteligencia', jsonb_build_object(
      'activa', coalesce(v_c.inteligente_activa, true),
      'umbral_pct', v_c.umbral_grande_pct,
      'vel_hora_pct', v_c.vel_max_hora_pct,
      'vel_dia_pct', v_c.vel_max_dia_pct,
      'costo_ref', v_c.costo_ref,
      'comision_busq_pct', v_c.comision_busq_pct,
      'confirmacion', case when coalesce(v_c.conf_direccion, 0) = 0 then null else
        jsonb_build_object('direccion', v_c.conf_direccion,
          'delta_pct', v_c.conf_delta_pct, 'desde', v_c.conf_en) end,
      'ultimo_movimiento', case when v_ultm.id is null then null else jsonb_build_object(
        'creado_en', v_ultm.creado_en, 'decision', v_ultm.decision,
        'ingreso_viejo', v_ultm.ingreso_viejo, 'ingreso_nuevo', v_ultm.ingreso_nuevo,
        'libro_nuevo', v_ultm.libro_nuevo, 'delta_pct', v_ultm.delta_pct,
        'porque', v_ultm.detalle ->> 'porque') end,
      'ultima_decision', case when v_ultd.id is null then null else jsonb_build_object(
        'creado_en', v_ultd.creado_en, 'decision', v_ultd.decision,
        'porque', v_ultd.detalle ->> 'porque') end,
      'historial', v_hist));
end;
$function$;
revoke execute on function public.tarifa_viva_estado() from public;
grant execute on function public.tarifa_viva_estado() to anon;

-- ---------- 6) Puerta del BUSCADOR: sus dos patas + el último ajuste ----------
-- FRONTERA intacta: jamás salida, fondo, config ni ganancia del
-- dueño. Lo nuevo: el último ajuste REAL de la tarifa (la que él
-- cobra) con su hora — sustituye al aviso de propuesta del régimen
-- viejo, que ya no existe.
create or replace function public.tarifa_viva_buscador()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t public.tarifa%rowtype;
  v_f public.mercado_fotos%rowtype;
  v_u public.tarifa_viva_historial%rowtype;
begin
  select * into v_t from public.tarifa where id = 1;
  select * into v_f from public.mercado_fotos order by recibida_en desc limit 1;
  select * into v_u from public.tarifa_viva_historial
   where decision in ('aplicada', 'manual') order by creado_en desc limit 1;
  return jsonb_build_object(
    'ok', true,
    'ingreso_ref360', v_t.ingreso_ref360,
    'libro_ref', v_t.libro_ref,
    'actualizado', v_t.actualizado,
    'foto_recibida_en', v_f.recibida_en,
    'fresca', coalesce(v_f.fresca, false),
    'edad_min', case when v_f.id is null then null else
      round((extract(epoch from (now() - v_f.recibida_en)) / 60.0)::numeric, 1) end,
    'ultimo_ajuste', case when v_u.id is null then null else jsonb_build_object(
      'ingreso_viejo', v_u.ingreso_viejo, 'ingreso_nuevo', v_u.ingreso_nuevo,
      'libro_nuevo', v_u.libro_nuevo, 'en', v_u.creado_en) end);
end;
$function$;
revoke execute on function public.tarifa_viva_buscador() from public;
grant execute on function public.tarifa_viva_buscador() to anon;

-- ---------- 7) Interruptor de la inteligencia (SOLO el dueño) ----------
create or replace function public.tarifa_viva_inteligencia(p_codigo text, p_activa boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.admin_config
                  where clave = 'codigo_admin' and valor = p_codigo) then
    raise exception 'codigo admin no valido';
  end if;
  insert into public.tarifa_viva_config (id, inteligente_activa) values (1, p_activa)
  on conflict (id) do update
    set inteligente_activa = excluded.inteligente_activa,
        conf_direccion = 0, conf_foto_id = null, conf_delta_pct = null, conf_en = null,
        actualizado = now();
  return jsonb_build_object('ok', true, 'activa', p_activa);
end;
$function$;
revoke execute on function public.tarifa_viva_inteligencia(text, boolean) from public;
grant execute on function public.tarifa_viva_inteligencia(text, boolean) to anon;

-- ---------- 8) Fijar a mano PAUSA la inteligencia ----------
-- Misma definición viva de admin_guardar_tarifa + dos cosas: la
-- fijación manual apaga la inteligencia (respeta su número hasta
-- que la reactive) y deja su fila 'manual' en el historial con el
-- porqué (así el «último movimiento» de la pantalla la cuenta).
create or replace function public.admin_guardar_tarifa(p_codigo text, p_ingreso numeric, p_libro numeric, p_salida numeric, p_com_saldo numeric, p_com_transf numeric, p_piso numeric)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ahora timestamptz := now();
  v_u     text;
  v_viejo public.tarifa%rowtype;
begin
  if not exists (
    select 1 from public.admin_config
    where clave = 'codigo_admin' and valor = p_codigo
  ) then
    raise exception 'codigo admin no valido';
  end if;

  select * into v_viejo from public.tarifa where id = 1;

  insert into public.tarifa
    (id, ingreso_ref360, libro_ref, salida_ref, comision_saldo, comision_transf, piso_transf, actualizado, actualizado_por)
  values
    (1, p_ingreso, p_libro, p_salida, p_com_saldo, p_com_transf, p_piso, v_ahora, 'ADMIN')
  on conflict (id) do update
    set ingreso_ref360  = excluded.ingreso_ref360,
        libro_ref       = excluded.libro_ref,
        salida_ref      = excluded.salida_ref,
        comision_saldo  = excluded.comision_saldo,
        comision_transf = excluded.comision_transf,
        piso_transf     = excluded.piso_transf,
        actualizado     = excluded.actualizado,
        actualizado_por = excluded.actualizado_por;

  -- TARIFA VIVA INTELIGENTE: la mano de Ernesto pausa la
  -- inteligencia y limpia cualquier confirmación armada.
  insert into public.tarifa_viva_config (id, inteligente_activa) values (1, false)
  on conflict (id) do update
    set inteligente_activa = false,
        conf_direccion = 0, conf_foto_id = null, conf_delta_pct = null, conf_en = null,
        actualizado = v_ahora;
  insert into public.tarifa_viva_historial
    (ingreso_viejo, ingreso_nuevo, libro_viejo, libro_nuevo, salida_ref, decision, detalle)
  values
    (v_viejo.ingreso_ref360, p_ingreso, v_viejo.libro_ref, p_libro, p_salida, 'manual',
     jsonb_build_object('porque',
       'Ernesto fijó la tarifa a mano (ingreso ' || p_ingreso || ' · libro ' || p_libro
       || ' · salida ' || p_salida || '): la inteligencia queda en pausa hasta que la reactive desde su app.',
       'accion_motor', 'manual'));

  for v_u in select codigo from public.usuarios where activo = true
  loop
    insert into public.mensajes (de, para, texto, tipo)
    values ('ADMIN', v_u, '📋 Nueva tarifa publicada', 'sistema');
  end loop;

  perform public.registrar_actividad('ADMIN', 'cambiar_tarifa',
    jsonb_build_object('ingreso', p_ingreso, 'libro', p_libro, 'salida', p_salida));

  return jsonb_build_object('ok', true, 'actualizado', v_ahora);
end;
$function$;

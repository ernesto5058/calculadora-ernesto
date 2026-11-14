-- =====================================================================
-- TASA DE CALLE EN LOS REGISTROS + COLCHÓN POR PEAJE DE ENVÍOS
-- (2026-11-14, las 6 ideas de Ernesto aprobadas «todas pa dentro» +
-- su corrección del colchón del Asesor). SOLO servidor; las pantallas
-- van en T1/T3. TODO aditivo; compatibilidad hacia atrás en cada
-- puerta existente (parte sin tasa = flujo de hoy, intacto).
--
-- EL JUEGO DE LA CALLE (así compra el buscador): paga al vendedor
-- tasa × saldo en efectivo (2.5, 2.6…; el estándar de Ernesto es
-- 1.000/recarga = 2,78/unidad) y el vendedor envía el saldo DIRECTO
-- de su teléfono a la línea de Ernesto; ETECSA descuenta 5 del
-- principal POR ENVÍO y lo paga el saldo del VENDEDOR.
--
-- DEFINICIONES (escritas, mandan sobre cualquier cálculo):
--   · equilibrio_recarga_dia = ingreso_ref360 vigente de la tarifa
--     viva (el ingreso de papel por recarga): pagar por encima =
--     la vuelta pierde aun vendiendo al papel.
--   · techo_recarga_dia = equilibrio × (1 − colchón% del régimen de
--     pago del carril): lo MÁXIMO pagable por recarga pa que, aun
--     vendiendo a la valoración PROTEGIDA, la vuelta gane y el
--     margen se reparta entre Ernesto y el buscador (el % de
--     estrellas del buscador sale de esa ganancia protegida; el
--     fijo/premio ya construido la reparte). techo_tasa = techo/360.
--   · semáforo de compra al nacer el lote (contra su
--     costo_por_recarga = tasa_efectiva × 360):
--       verde    costo < techo_recarga (nació con margen protegido)
--       amarillo techo ≤ costo < equilibrio (gana solo al papel+)
--       rojo     costo ≥ equilibrio (nació perdiendo al papel)
--     margen_recarga_nacer = techo_recarga − costo_por_recarga.
--   · ahorro de compra = (techo_tasa − tasa_efectiva) × saldo, si
--     positivo: lo que se ahorró contra el techo del día. En la
--     liquidación es ATRIBUCIÓN NOMBRADA (idea 5): ese ahorro YA
--     vive dentro de la ganancia (capital barato = más ganancia al
--     mismo papel y al mismo protegido) — se nombra, NO se suma:
--     el premio sigue saliendo SOLO del extra de la venta real
--     sobre la protegida. Doble conteo = prohibido.
--   · peaje_etecsa de una espera = la parte de la diferencia
--     pactado − llegado explicada por 5 × envíos declarados (tope
--     5 × envíos): lo pagó el vendedor, JAMÁS es falta del
--     buscador. Lo que pase de ahí = falta_real pa arbitraje.
--   · colchón del Asesor (corrección de Ernesto, misma tanda): deja
--     de ser 360 fijo y pasa a ser peaje × envíos de la posición
--     ofrecible, con peaje = guia_config.peaje_envio_saldo (5) y
--     envíos = ceil(saldo ofrecible / tope_receptor_envio), mínimo
--     1 (tope del receptor por envío: 500.000). Su razón: el sensor
--     mantiene conocida la posición y la puerta re-verifica en vivo
--     al subir — el colchón gordo sobra y el capital debe rotar.
--     guia_config.colchon_saldo queda como dato legado (los
--     cálculos que no reciben peaje — bancos viejos — lo siguen
--     honrando tal cual).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) ESQUEMA ADITIVO
-- ---------------------------------------------------------------------
alter table public.dinero_esperas
  add column if not exists tasa_pactada numeric(10, 4),
  add column if not exists total_pagado_cup bigint,
  add column if not exists envios_declarados int,
  add column if not exists peaje_etecsa numeric(14, 2),
  add column if not exists falta_real numeric(14, 2);

alter table public.dinero_lotes_saldo
  add column if not exists costo_por_recarga numeric(12, 2),
  add column if not exists techo_tasa_dia numeric(10, 4),
  add column if not exists equilibrio_recarga_dia numeric(12, 2),
  add column if not exists semaforo_compra text,
  add column if not exists margen_recarga_nacer numeric(12, 2),
  add column if not exists ahorro_compra_cup numeric(14, 2),
  add column if not exists valor_real_acum numeric(14, 2) not null default 0,
  add column if not exists cerrado_en timestamptz,
  add column if not exists margen_real_recarga numeric(12, 2);

alter table public.pago_liquidaciones
  add column if not exists tasa_efectiva_compra numeric(10, 4),
  add column if not exists techo_tasa_compra numeric(10, 4),
  add column if not exists ahorro_compra_cup numeric(14, 2);

alter table public.guia_config
  add column if not exists peaje_envio_saldo numeric not null default 5,
  add column if not exists tope_receptor_envio numeric not null default 500000;

comment on column public.guia_config.colchon_saldo is
  'LEGADO (2026-11-14): el Asesor ya no lo usa como fijo — su colchón es peaje_envio_saldo × envíos. Se conserva pa las llamadas que no pasan peaje (bancos viejos) y como dato histórico de la decisión original.';
comment on column public.guia_config.peaje_envio_saldo is
  'Peaje de ETECSA por envío de saldo (5): el colchón del Asesor = este peaje × envíos de la posición ofrecible (orden de Ernesto, 2026-11-14).';

-- Historial de cierres de lote (idea 6): una fila por lote agotado,
-- con su margen verdadero por recarga cuando la venta registrada lo
-- permite; es la serie que alimenta las estadísticas del colchón.
create table if not exists public.dinero_lotes_cierres (
  id                uuid primary key default gen_random_uuid(),
  lote_id           uuid not null unique
                    references public.dinero_lotes_saldo (id),
  contraparte       text,
  es_prueba         boolean not null default false,
  cantidad_saldo    numeric(14, 2) not null,
  costo_total_cup   bigint not null,
  costo_por_recarga numeric(12, 2),
  valor_real_total  numeric(14, 2),
  margen_real_recarga numeric(12, 2),
  fuente_cierre     text not null
                    constraint dinero_lotes_cierres_fuente_chk
                    check (fuente_cierre in
                      ('venta_registrada', 'consumo_sin_valor_registrado')),
  cerrado_en        timestamptz not null default now()
);
create index if not exists dinero_lotes_cierres_lane_idx
  on public.dinero_lotes_cierres (es_prueba, cerrado_en desc);

alter table public.dinero_lotes_cierres enable row level security;
revoke all on table public.dinero_lotes_cierres from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) EL TECHO DE CALLE DEL DÍA (definición en el encabezado)
-- Interno: lo invocan puertas definidoras (guia_buscador) y los
-- disparadores de lotes; service_role lo puede leer pa bancos.
-- ---------------------------------------------------------------------
create or replace function public.tarifa_techo_calle(
  p_prueba boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare
  v_t public.tarifa;
  v_colchon numeric;
  v_eq numeric;
  v_techo numeric;
begin
  select * into v_t from public.tarifa where id = 1;
  select colchon_pct into v_colchon
    from public.pago_proteccion_config
   where es_prueba = coalesce(p_prueba, false);
  v_colchon := coalesce(v_colchon, 5);
  if v_t.ingreso_ref360 is null or v_t.ingreso_ref360 <= 0 then
    return jsonb_build_object('ok', false,
      'motivo', 'sin_ingreso_ref360', 'colchon_pct', v_colchon);
  end if;
  v_eq := round(v_t.ingreso_ref360, 2);
  v_techo := round(v_t.ingreso_ref360 * (1 - v_colchon / 100.0), 2);
  return jsonb_build_object(
    'ok', true,
    'ingreso_ref360', v_t.ingreso_ref360,
    'colchon_pct', v_colchon,
    'equilibrio_recarga', v_eq,
    'techo_recarga', v_techo,
    'techo_tasa', round(v_techo / 360.0, 4));
end;
$f$;

revoke all on function public.tarifa_techo_calle(boolean) from public, anon, authenticated;
grant execute on function public.tarifa_techo_calle(boolean) to service_role;

-- ---------------------------------------------------------------------
-- 3) LA SERIE DE MÁRGENES REALES DE LOTES CERRADOS (idea 6)
-- ---------------------------------------------------------------------
create or replace function public.pago_serie_margenes_lotes(
  p_prueba boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $f$
declare
  v_serie jsonb;
  v_stats record;
begin
  select count(*) as n,
         count(margen_real_recarga) as con_margen,
         round(avg(margen_real_recarga), 2) as promedio,
         round((percentile_cont(0.5) within group
           (order by margen_real_recarga))::numeric, 2) as mediana,
         round(min(margen_real_recarga), 2) as minimo,
         round(max(margen_real_recarga), 2) as maximo
    into v_stats
    from public.dinero_lotes_cierres
   where es_prueba = coalesce(p_prueba, false);
  select coalesce(jsonb_agg(jsonb_build_object(
           'lote', lote_id, 'cerrado_en', cerrado_en,
           'contraparte', contraparte, 'cantidad_saldo', cantidad_saldo,
           'costo_por_recarga', costo_por_recarga,
           'valor_real_total', valor_real_total,
           'margen_real_recarga', margen_real_recarga,
           'fuente_cierre', fuente_cierre)
           order by cerrado_en desc), '[]'::jsonb)
    into v_serie
    from (select * from public.dinero_lotes_cierres
           where es_prueba = coalesce(p_prueba, false)
           order by cerrado_en desc limit 50) s;
  return jsonb_build_object(
    'ok', true, 'es_prueba', coalesce(p_prueba, false),
    'n_cerrados', coalesce(v_stats.n, 0),
    'con_margen', coalesce(v_stats.con_margen, 0),
    'margen_promedio_recarga', v_stats.promedio,
    'margen_mediana_recarga', v_stats.mediana,
    'margen_min_recarga', v_stats.minimo,
    'margen_max_recarga', v_stats.maximo,
    'serie', v_serie);
end;
$f$;

revoke all on function public.pago_serie_margenes_lotes(boolean) from public, anon, authenticated;
grant execute on function public.pago_serie_margenes_lotes(boolean) to service_role;

-- ---------------------------------------------------------------------
-- 4) LOS DERIVADOS DEL LOTE: al nacer (ideas 1 y 2) y al cerrarse
-- (idea 6). Un disparador por evento; JAMÁS rompe el insert del
-- cerebro ni el asiento de la espera (los derivados van en bloque
-- protegido: si algo falla, el lote nace igual, sin derivados).
-- ---------------------------------------------------------------------
create or replace function public.dinero_lotes_derivados()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $f$
declare
  v_t jsonb;
  v_cpr numeric;
  v_techo_tasa numeric;
  v_eq numeric;
  v_techo_rec numeric;
begin
  if tg_op = 'INSERT' then
    if new.costo_por_recarga is null and new.tasa_efectiva is not null then
      begin
        v_t := public.tarifa_techo_calle(new.es_prueba);
        v_cpr := round(new.tasa_efectiva * 360, 2);
        new.costo_por_recarga := v_cpr;
        if coalesce((v_t ->> 'ok')::boolean, false) then
          v_techo_tasa := (v_t ->> 'techo_tasa')::numeric;
          v_eq := (v_t ->> 'equilibrio_recarga')::numeric;
          v_techo_rec := (v_t ->> 'techo_recarga')::numeric;
          new.techo_tasa_dia := v_techo_tasa;
          new.equilibrio_recarga_dia := v_eq;
          new.margen_recarga_nacer := round(v_techo_rec - v_cpr, 2);
          new.semaforo_compra := case
            when v_cpr < v_techo_rec then 'verde'
            when v_cpr < v_eq then 'amarillo'
            else 'rojo' end;
          new.ahorro_compra_cup := round(
            greatest(v_techo_tasa - new.tasa_efectiva, 0)
            * new.cantidad_saldo, 2);
        else
          new.semaforo_compra := 'sin_referencia';
        end if;
      exception when others then
        null;  -- el lote nace igual, sin derivados
      end;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.cantidad_restante = 0
     and coalesce(old.cantidad_restante, 0) > 0
     and new.cerrado_en is null then
    new.cerrado_en := now();
    if new.costo_por_recarga is null and new.tasa_efectiva is not null then
      new.costo_por_recarga := round(new.tasa_efectiva * 360, 2);
    end if;
    if coalesce(new.valor_real_acum, 0) > 0 then
      new.margen_real_recarga := round(
        (new.valor_real_acum - new.costo_total_cup)
        / nullif(new.cantidad_saldo / 360.0, 0), 2);
    end if;
    insert into public.dinero_lotes_cierres
      (lote_id, contraparte, es_prueba, cantidad_saldo, costo_total_cup,
       costo_por_recarga, valor_real_total, margen_real_recarga,
       fuente_cierre, cerrado_en)
    values
      (new.id, new.contraparte, new.es_prueba, new.cantidad_saldo,
       new.costo_total_cup, new.costo_por_recarga,
       case when coalesce(new.valor_real_acum, 0) > 0
            then new.valor_real_acum end,
       new.margen_real_recarga,
       case when coalesce(new.valor_real_acum, 0) > 0
            then 'venta_registrada'
            else 'consumo_sin_valor_registrado' end,
       new.cerrado_en)
    on conflict (lote_id) do nothing;
  end if;
  return new;
end;
$f$;

revoke all on function public.dinero_lotes_derivados() from public, anon, authenticated;

drop trigger if exists trg_dinero_lotes_derivados_i on public.dinero_lotes_saldo;
create trigger trg_dinero_lotes_derivados_i
  before insert on public.dinero_lotes_saldo
  for each row execute function public.dinero_lotes_derivados();

drop trigger if exists trg_dinero_lotes_cierre_u on public.dinero_lotes_saldo;
create trigger trg_dinero_lotes_cierre_u
  before update on public.dinero_lotes_saldo
  for each row execute function public.dinero_lotes_derivados();



-- ---------------------------------------------------------------------
-- 6) LA INTERNA CON TASA (implementación; la de siempre envuelve)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.espera_crear_interna_v2(p_buscador text, p_tipo text, p_cantidad numeric, p_capital bigint, p_origen text, p_reporte_id uuid, p_telefono text, p_ventana_horas numeric, p_prueba boolean, p_tasa_pactada numeric DEFAULT NULL, p_total_pagado bigint DEFAULT NULL, p_envios integer DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_busc text := upper(trim(coalesce(p_buscador, '')));
  v_prueba boolean := coalesce(p_prueba, false);
  v_pend bigint;
  v_comp bigint;
  v_id uuid;
  v_horas numeric := coalesce(p_ventana_horas, 48);
begin
  if v_busc = '' or p_tipo not in ('saldo', 'transferencia')
     or p_cantidad is null or p_cantidad <= 0
     or p_capital is null or p_capital <= 0 then
    insert into public.dinero_esperas_log (accion, detalle, es_prueba)
    values ('rechazada', jsonb_build_object(
      'motivo', 'datos_invalidos', 'buscador', v_busc, 'tipo', p_tipo,
      'cantidad', p_cantidad, 'capital_cup', p_capital,
      'origen', p_origen, 'reporte_id', p_reporte_id), v_prueba);
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos');
  end if;
  if v_horas < 1 then v_horas := 1; end if;
  if v_horas > 720 then v_horas := 720; end if;
  -- La tasa y los envíos del parte se sanean, jamás tumban la espera.
  if p_tasa_pactada is not null and p_tasa_pactada <= 0 then
    p_tasa_pactada := null;
  end if;
  if p_total_pagado is not null and p_total_pagado <= 0 then
    p_total_pagado := null;
  end if;
  if p_envios is not null then
    p_envios := least(greatest(p_envios, 1), 30);
  end if;

  -- Idempotencia por reporte: un reporte crea UNA espera, no dos
  -- (reintentos del trigger o re-pegados de la migración).
  if p_reporte_id is not null then
    select id into v_id from public.dinero_esperas
     where reporte_id = p_reporte_id limit 1;
    if v_id is not null then
      return jsonb_build_object('ok', true, 'espera_id', v_id, 'ya', true);
    end if;
  end if;

  v_pend := public.espera_pendiente_entregas(v_busc, v_prueba);
  select coalesce(sum(capital_cup), 0)::bigint into v_comp
    from public.dinero_esperas
   where buscador_codigo = v_busc and es_prueba = v_prueba
     and estado = 'abierta';
  if v_comp + p_capital > v_pend then
    insert into public.dinero_esperas_log (accion, detalle, es_prueba)
    values ('rechazada', jsonb_build_object(
      'motivo', 'capital_supera_pendiente', 'buscador', v_busc,
      'tipo', p_tipo, 'capital_cup', p_capital,
      'comprometido_abierto', v_comp, 'pendiente_entregas', v_pend,
      'origen', p_origen, 'reporte_id', p_reporte_id), v_prueba);
    return jsonb_build_object('ok', false,
      'motivo', 'capital_supera_pendiente',
      'pendiente_entregas', v_pend, 'comprometido_abierto', v_comp);
  end if;

  insert into public.dinero_esperas
    (buscador_codigo, tipo, cantidad_esperada, capital_cup, origen,
     reporte_id, telefono_esperado, ventana_inicio, ventana_fin, es_prueba,
     tasa_pactada, total_pagado_cup, envios_declarados)
  values
    (v_busc, p_tipo, p_cantidad, p_capital, p_origen,
     p_reporte_id, nullif(trim(coalesce(p_telefono, '')), ''),
     now(), now() + v_horas * interval '1 hour',
     v_prueba, p_tasa_pactada, p_total_pagado, p_envios)
  returning id into v_id;

  insert into public.dinero_esperas_log (espera_id, accion, detalle, es_prueba)
  values (v_id, 'creada', jsonb_build_object(
    'origen', p_origen, 'tipo', p_tipo, 'cantidad_esperada', p_cantidad,
    'capital_cup', p_capital, 'reporte_id', p_reporte_id,
    'tasa_pactada', p_tasa_pactada, 'total_pagado_cup', p_total_pagado,
    'envios_declarados', p_envios), v_prueba);
  return jsonb_build_object('ok', true, 'espera_id', v_id);
end;
$function$;

-- ---------------------------------------------------------------------
-- 5) LA ESPERA CON TASA: la interna de siempre queda como envoltorio
-- (compatibilidad total con el trigger y la puerta operada viejos);
-- la implementación vive en espera_crear_interna_v2, que además
-- registra tasa_pactada, total_pagado_cup y envios_declarados.
-- ---------------------------------------------------------------------
create or replace function public.espera_crear_interna(
  p_buscador text, p_tipo text, p_cantidad numeric, p_capital bigint,
  p_origen text, p_reporte_id uuid, p_telefono text,
  p_ventana_horas numeric, p_prueba boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return public.espera_crear_interna_v2(
    p_buscador, p_tipo, p_cantidad, p_capital, p_origen,
    p_reporte_id, p_telefono, p_ventana_horas, p_prueba,
    null, null, null);
end;
$$;

revoke all on function public.espera_crear_interna(text, text, numeric, bigint, text, uuid, text, numeric, boolean) from public, anon, authenticated;
revoke all on function public.espera_crear_interna_v2(text, text, numeric, bigint, text, uuid, text, numeric, boolean, numeric, bigint, integer) from public, anon, authenticated;

-- Puerta operada CON TASA (la ruta del cerebro cuando Ernesto opera
-- la cuenta del buscador): la misma espera, declarando la tasa
-- pactada, el total pagado y los envíos esperados del parte.
create or replace function public.espera_crear_operada_tasa(
  p_buscador text, p_tipo text, p_cantidad numeric, p_capital bigint,
  p_telefono text default null, p_ventana_horas numeric default 48,
  p_prueba boolean default false,
  p_tasa_pactada numeric default null,
  p_total_pagado bigint default null,
  p_envios integer default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return public.espera_crear_interna_v2(
    p_buscador, p_tipo, p_cantidad, p_capital, 'operado_ernesto',
    null, p_telefono, p_ventana_horas, p_prueba,
    p_tasa_pactada, p_total_pagado, p_envios);
end;
$$;

revoke all on function public.espera_crear_operada_tasa(text, text, numeric, bigint, text, numeric, boolean, numeric, bigint, integer) from public, anon, authenticated;
grant execute on function public.espera_crear_operada_tasa(text, text, numeric, bigint, text, numeric, boolean, numeric, bigint, integer) to service_role;



-- ---------------------------------------------------------------------
-- 7) EL ENGANCHE DEL REPORTE: el parte trae su tasa (precio/360)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_reporte_crea_espera()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cantidad numeric;
  v_capital numeric;
  v_tasa_parte numeric;
begin
  begin
    if new.tipo = 'saldo' then
      if new.precio is null or new.cantidad is null then
        insert into public.dinero_esperas_log (accion, detalle, es_prueba)
        values ('rechazada', jsonb_build_object(
          'motivo', 'reporte_incompleto', 'reporte_id', new.id,
          'tipo', new.tipo), coalesce(new.prueba, false));
        return new;
      end if;
      v_cantidad := new.cantidad * 360;
      v_capital := new.precio * new.cantidad;
      v_tasa_parte := round(new.precio / 360.0, 4);
    elsif new.tipo = 'transferencia' then
      if new.cantidad is null then
        insert into public.dinero_esperas_log (accion, detalle, es_prueba)
        values ('rechazada', jsonb_build_object(
          'motivo', 'reporte_incompleto', 'reporte_id', new.id,
          'tipo', new.tipo), coalesce(new.prueba, false));
        return new;
      end if;
      v_cantidad := round(new.cantidad
                          * (1 + coalesce(new.porc, 0) / 100));
      v_capital := new.cantidad;
    else
      return new;
    end if;

    if v_capital <> trunc(v_capital) or v_capital <= 0 then
      insert into public.dinero_esperas_log (accion, detalle, es_prueba)
      values ('rechazada', jsonb_build_object(
        'motivo', 'capital_no_entero', 'reporte_id', new.id,
        'tipo', new.tipo, 'capital_calculado', v_capital),
        coalesce(new.prueba, false));
      return new;
    end if;

    perform public.espera_crear_interna_v2(
      new.buscador, new.tipo, v_cantidad, v_capital::bigint,
      'reporte', new.id, new.telefono_vendedor, 48,
      coalesce(new.prueba, false),
      case when new.tipo = 'saldo' then v_tasa_parte end,
      case when new.tipo = 'saldo' then v_capital::bigint end,
      null);
  exception when others then
    begin
      insert into public.dinero_esperas_log (accion, detalle, es_prueba)
      values ('rechazada', jsonb_build_object(
        'motivo', 'error_trigger', 'reporte_id', new.id,
        'error', sqlerrm), coalesce(new.prueba, false));
    exception when others then
      null;  -- ni el log puede tumbar el reporte
    end;
  end;
  return new;
end;
$function$;

drop trigger if exists trg_reportes_espera on public.reportes;
create trigger trg_reportes_espera
  after insert on public.reportes
  for each row execute function public.trg_reporte_crea_espera();

-- ---------------------------------------------------------------------
-- 8) ALARMAS COMO DATOS: la vista de siempre + la rama nueva — una
-- espera cumplida CON falta real queda visible pa arbitraje (el
-- peaje explicado jamás aparece aquí: no es alarma, es física).
-- ---------------------------------------------------------------------
create or replace view public.dinero_esperas_avisos as
select 'espera_vencida'::text as clase_alarma,
       e.id::text as ref_id, e.buscador_codigo as buscador,
       jsonb_build_object('tipo', e.tipo,
         'cantidad_esperada', e.cantidad_esperada,
         'capital_cup', e.capital_cup, 'origen', e.origen,
         'ventana_fin', e.ventana_fin, 'reporte_id', e.reporte_id) as detalle,
       e.es_prueba, e.ventana_fin as desde
  from public.dinero_esperas e
 where e.estado = 'vencida'
    or (e.estado = 'abierta' and e.ventana_fin < now())
union all
select 'sms_sin_match', ev.id::text, null,
       jsonb_build_object('sms_id', ev.sms_id, 'clase', ev.clase,
         'motivo_match', ev.datos ->> 'motivo_match',
         'datos', ev.datos),
       ev.es_prueba, ev.creado_en
  from public.sms_eventos ev
 where ev.estado = 'por_clasificar'
union all
select 'pago_sin_match', p.id::text, null,
       jsonb_build_object('sms_id', p.sms_id, 'direccion', p.direccion,
         'monto', p.monto, 'moneda', p.moneda,
         'cuenta_terminacion', p.cuenta_terminacion,
         'cuenta_tipo', p.cuenta_tipo,
         'nro_transaccion', p.nro_transaccion, 'motivo', p.motivo),
       p.es_prueba, p.creado_en
  from public.pago_eventos p
 where p.estado = 'por_clasificar'
union all
select 'espera_rechazada', l.id::text,
       l.detalle ->> 'buscador',
       l.detalle, l.es_prueba, l.creado_en
  from public.dinero_esperas_log l
 where l.accion = 'rechazada'
union all
select 'espera_falta_real', e.id::text, e.buscador_codigo,
       jsonb_build_object('tipo', e.tipo,
         'cantidad_esperada', e.cantidad_esperada,
         'cantidad_real', e.datos -> 'cantidad_real',
         'peaje_etecsa', e.peaje_etecsa,
         'falta_real', e.falta_real,
         'envios', e.datos -> 'envios',
         'capital_cup', e.capital_cup, 'cumplida_en', e.cumplida_en),
       e.es_prueba, e.cumplida_en
  from public.dinero_esperas e
 where e.estado = 'cumplida' and coalesce(e.falta_real, 0) > 0;

revoke all on table public.dinero_esperas_avisos from anon, authenticated;



-- ---------------------------------------------------------------------
-- 9) MATCH DE SALDO: la tolerancia es 5 × envíos declarados
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.espera_match_saldo(p_sms_id bigint, p_monto numeric, p_fecha timestamp with time zone, p_prueba boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prueba boolean := coalesce(p_prueba, false);
  v_fecha timestamptz := coalesce(p_fecha, now());
  v_ids uuid[];
  v_res jsonb;
begin
  perform public.espera_barrer_vencidas(v_fecha);
  if p_monto is null or p_monto <= 0 then
    return jsonb_build_object('resultado', 'sin_match',
      'motivo', 'sin_monto');
  end if;
  select array_agg(id) into v_ids
    from public.dinero_esperas
   where estado = 'abierta' and tipo = 'saldo' and es_prueba = v_prueba
     and ventana_inicio <= v_fecha and ventana_fin >= v_fecha
     and (cantidad_esperada - p_monto) between 0 and 5 * coalesce(envios_declarados, 1);
  if v_ids is null then
    insert into public.dinero_esperas_log (accion, detalle, es_prueba)
    values ('sin_match_saldo', jsonb_build_object(
      'sms_id', p_sms_id, 'monto', p_monto), v_prueba);
    return jsonb_build_object('resultado', 'sin_match');
  end if;
  if array_length(v_ids, 1) > 1 then
    insert into public.dinero_esperas_log (accion, detalle, es_prueba)
    values ('ambiguo_saldo', jsonb_build_object(
      'sms_id', p_sms_id, 'monto', p_monto,
      'candidatas', to_jsonb(v_ids)), v_prueba);
    return jsonb_build_object('resultado', 'ambiguo',
      'candidatas', array_length(v_ids, 1));
  end if;
  v_res := public.espera_asentar_interna(v_ids[1], p_monto, p_sms_id, null);
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    return jsonb_build_object('resultado', 'sin_match',
      'motivo', v_res ->> 'motivo');
  end if;
  return jsonb_build_object('resultado', 'asentado',
    'espera_id', v_ids[1], 'vueltas', v_res -> 'vueltas',
    'lote_id', v_res -> 'lote_id');
end;
$function$;



-- ---------------------------------------------------------------------
-- 10) EL ASIENTO: peaje y falta como líneas propias del registro
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.espera_asentar_interna(p_espera uuid, p_cantidad_real numeric, p_sms_id bigint, p_pago_transaccion text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_e record;
  v_t record;
  v_ent record;
  v_cap_rest bigint;
  v_prod_rest numeric;
  v_cap_chunk bigint;
  v_prod_chunk numeric;
  v_valor bigint;
  v_gan bigint;
  v_pct numeric;
  v_com bigint;
  v_est numeric;
  v_vuelta uuid;
  v_dev uuid;
  v_vueltas jsonb := '[]'::jsonb;
  v_lote uuid := null;
  v_tasa numeric;
  v_envios int;
  v_dif numeric;
  v_peaje numeric;
  v_falta numeric;
begin
  select * into v_e from public.dinero_esperas
   where id = p_espera for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'espera_no_existe');
  end if;
  if v_e.estado <> 'abierta' then
    return jsonb_build_object('ok', false, 'motivo', 'espera_no_abierta',
      'estado', v_e.estado);
  end if;
  if p_cantidad_real is null or p_cantidad_real <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'cantidad_invalida');
  end if;
  if v_e.tipo = 'transferencia'
     and p_cantidad_real <> trunc(p_cantidad_real) then
    return jsonb_build_object('ok', false, 'motivo', 'producto_no_entero');
  end if;

  select * into v_t from public.tarifa where id = 1;
  select estrellas into v_est
    from public.dinero_estrellas_de(v_e.buscador_codigo, v_e.es_prueba);
  v_pct := public.dinero_pct_estrellas(v_est, v_e.tipo);

  v_cap_rest := v_e.capital_cup;
  v_prod_rest := p_cantidad_real;

  for v_ent in
    select * from public.dinero_entregas
     where buscador_codigo = v_e.buscador_codigo
       and es_prueba = v_e.es_prueba
       and estado in ('entregado', 'en_calle')
       and monto_pendiente > 0
     order by entregado_en
     for update
  loop
    exit when v_cap_rest <= 0;
    v_cap_chunk := least(v_cap_rest, v_ent.monto_pendiente);
    if v_cap_rest = v_cap_chunk then
      v_prod_chunk := v_prod_rest;           -- la última se lleva el resto
    else
      v_prod_chunk := round(p_cantidad_real * v_cap_chunk
                            / v_e.capital_cup, 2);
      v_prod_rest := v_prod_rest - v_prod_chunk;
    end if;
    v_cap_rest := v_cap_rest - v_cap_chunk;

    if v_e.tipo = 'saldo' then
      v_valor := floor(v_prod_chunk
                       * coalesce(v_t.ingreso_ref360, 0) / 360)::bigint;
    else
      v_valor := trunc(v_prod_chunk)::bigint;
    end if;
    v_gan := v_valor - v_cap_chunk;
    v_com := case when v_gan > 0
                  then floor(v_gan * v_pct / 100)::bigint else 0 end;

    insert into public.dinero_vueltas
      (entrega_id, buscador_codigo, tipo, capital_cup, producto_cantidad,
       producto_detalle, base_ref360, valor_producto_cup,
       ganancia_capturada, comision, pago_hecho, pago_en, es_prueba,
       espera_id, sms_id, pago_transaccion)
    values
      (v_ent.id, v_e.buscador_codigo, v_e.tipo, v_cap_chunk, v_prod_chunk,
       'asiento automatico por SMS · espera ' || v_e.id::text,
       case when v_e.tipo = 'saldo' then v_t.ingreso_ref360 end,
       v_valor, v_gan, v_com, true, now(), v_e.es_prueba,
       v_e.id, p_sms_id, p_pago_transaccion)
    returning id into v_vuelta;

    insert into public.dinero_devoluciones
      (buscador_codigo, tipo, monto, medio, estado, vuelta_id,
       confirmada_en, es_prueba)
    values
      (v_e.buscador_codigo, 'especie', v_cap_chunk, v_e.tipo,
       'confirmada', v_vuelta, now(), v_e.es_prueba)
    returning id into v_dev;

    perform public.dinero_mover(
      'cupo:' || v_e.buscador_codigo, 'devolucion_especie',
      -v_cap_chunk, v_ent.bolsillo, v_vuelta::text, null, v_e.es_prueba);
    perform public.dinero_mover(
      'inventario', 'devolucion_especie',
      v_cap_chunk, v_e.tipo, v_vuelta::text, null, v_e.es_prueba);
    if v_com > 0 then
      perform public.dinero_mover(
        'fondo', 'comision_pagada',
        -v_com, v_e.tipo, v_vuelta::text, v_e.buscador_codigo,
        v_e.es_prueba);
      perform public.dinero_mover(
        'cupo:' || v_e.buscador_codigo, 'comision_pagada',
        v_com, v_e.tipo, v_vuelta::text, null, v_e.es_prueba);
    end if;

    update public.dinero_entregas
       set monto_pendiente = monto_pendiente - v_cap_chunk,
           estado = case when monto_pendiente - v_cap_chunk = 0
                         then 'devuelto_especie' else estado end,
           devuelto_en = case when monto_pendiente - v_cap_chunk = 0
                              then now() else devuelto_en end
     where id = v_ent.id;

    v_vueltas := v_vueltas || jsonb_build_array(v_vuelta);
  end loop;

  if v_cap_rest > 0 then
    raise exception 'capital sin entrega que lo cubra: quedan % de %',
      v_cap_rest, v_e.capital_cup;
  end if;

  if v_e.tipo = 'saldo' then
    v_tasa := round(v_e.capital_cup / p_cantidad_real * 10000) / 10000;
    insert into public.dinero_lotes_saldo
      (cantidad_saldo, cantidad_restante, costo_total_cup,
       costo_restante_cup, tasa_efectiva, contraparte, sms_id, es_prueba)
    values
      (p_cantidad_real, p_cantidad_real, v_e.capital_cup,
       v_e.capital_cup, v_tasa, v_e.buscador_codigo, p_sms_id,
       v_e.es_prueba)
    returning id into v_lote;
  end if;

  -- EL PEAJE DE ETECSA COMO LÍNEA PROPIA (idea 3): la diferencia
  -- pactado − llegado se explica sola — hasta 5 × envíos es peaje
  -- (lo pagó el saldo del vendedor; JAMÁS es falta del buscador) y
  -- lo que pase de ahí es falta real pa arbitraje de Ernesto.
  v_envios := coalesce(v_e.envios_declarados, 1);
  if v_e.tipo = 'saldo' then
    v_dif := v_e.cantidad_esperada - p_cantidad_real;
    v_peaje := least(greatest(v_dif, 0), 5 * v_envios);
    v_falta := greatest(v_dif - 5 * v_envios, 0);
  else
    v_peaje := 0;
    v_falta := greatest(v_e.cantidad_esperada - p_cantidad_real, 0);
  end if;

  update public.dinero_esperas
     set estado = 'cumplida', cumplida_en = now(),
         sms_id = p_sms_id, pago_transaccion = p_pago_transaccion,
         vuelta_ids = v_vueltas, lote_id = v_lote,
         peaje_etecsa = v_peaje, falta_real = v_falta,
         datos = datos || jsonb_build_object(
           'cantidad_real', p_cantidad_real,
           'vueltas', jsonb_array_length(v_vueltas),
           'peaje_etecsa', v_peaje, 'falta_real', v_falta,
           'envios', v_envios,
           'llegada', case when v_falta > 0 then 'falta_real'
                           else 'completa' end)
   where id = v_e.id;

  insert into public.dinero_esperas_log
    (espera_id, accion, detalle, es_prueba)
  values
    (v_e.id, 'cumplida', jsonb_build_object(
      'cantidad_real', p_cantidad_real, 'vueltas', v_vueltas,
      'lote_id', v_lote, 'sms_id', p_sms_id,
      'pago_transaccion', p_pago_transaccion,
      'peaje_etecsa', v_peaje, 'falta_real', v_falta,
      'envios', v_envios), v_e.es_prueba);

  return jsonb_build_object('ok', true, 'espera_id', v_e.id,
    'vueltas', v_vueltas, 'lote_id', v_lote);
end;
$function$;



-- ---------------------------------------------------------------------
-- 11) SNAPSHOT DEL FIJO: la atribución de la compra (idea 5)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pago_congelar_snapshot(p_vuelta uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_v public.dinero_vueltas;
  v_cfg public.pago_proteccion_config;
  v_est numeric; v_pct numeric;
  v_tef numeric; v_ttecho numeric; v_ahorro numeric;
  v_ref_prot numeric; v_valor_prot bigint; v_gan_prot bigint; v_fijo bigint;
  v_liq public.pago_liquidaciones;
begin
  select * into v_liq from public.pago_liquidaciones where vuelta_id = p_vuelta;
  if v_liq.id is not null then
    -- La atribución de la compra puede nacer DESPUÉS del snapshot:
    -- el lote de la espera se crea al final del asiento, cuando el
    -- disparador ya fotografió la vuelta. Si aún falta y el lote ya
    -- existe, se completa aquí sin tocar ningún monto; la venta
    -- registrada también la acumula por su lado (ver registrar).
    if v_liq.ahorro_compra_cup is null then
      select l.tasa_efectiva, l.techo_tasa_dia
        into v_tef, v_ttecho
        from public.dinero_vueltas vv
        join public.dinero_esperas e on e.id = vv.espera_id
        join public.dinero_lotes_saldo l on l.id = e.lote_id
       where vv.id = p_vuelta;
      if v_tef is not null and v_ttecho is not null then
        update public.pago_liquidaciones
           set tasa_efectiva_compra = v_tef,
               techo_tasa_compra = v_ttecho,
               ahorro_compra_cup = round(greatest(v_ttecho - v_tef, 0)
                                         * v_liq.producto_cantidad, 2)
         where id = v_liq.id;
      end if;
    end if;
    return jsonb_build_object('ok', true, 'ya_existia', true, 'liquidacion', v_liq.id);
  end if;
  select * into v_v from public.dinero_vueltas where id = p_vuelta;
  if v_v.id is null then return jsonb_build_object('ok', false, 'motivo', 'vuelta_no_existe'); end if;
  if v_v.tipo <> 'saldo' then return jsonb_build_object('ok', false, 'motivo', 'no_es_saldo'); end if;
  select * into v_cfg from public.pago_proteccion_config where es_prueba = v_v.es_prueba;
  if not coalesce(v_cfg.activo, false) then
    return jsonb_build_object('ok', false, 'motivo', 'regimen_inactivo'); end if;
  if v_cfg.activo_desde is not null and v_v.abierta_en < v_cfg.activo_desde then
    return jsonb_build_object('ok', false, 'motivo', 'fuera_de_regimen'); end if;
  select estrellas into v_est from public.dinero_estrellas_de(v_v.buscador_codigo, v_v.es_prueba);
  v_pct := public.dinero_pct_estrellas(v_est, 'saldo');
  v_ref_prot := round(v_v.base_ref360 * (1 - v_cfg.colchon_pct / 100.0), 4);
  v_valor_prot := floor(v_v.producto_cantidad * v_ref_prot / 360.0)::bigint;
  v_gan_prot := v_valor_prot - v_v.capital_cup;
  v_fijo := case when v_gan_prot > 0 then floor(v_gan_prot * v_pct / 100.0)::bigint else 0 end;
  if v_fijo > v_v.comision then v_fijo := v_v.comision; end if; -- invariante dura
  -- ATRIBUCIÓN DE LA COMPRA (idea 5 — sin tocar un centavo del
  -- asiento): cuánto de la ventaja de esta vuelta nació de COMPRAR
  -- bajo el techo del día. Ese ahorro YA vive dentro de la ganancia
  -- (capital barato = más ganancia al mismo papel): se NOMBRA en la
  -- liquidación, no se suma — el premio sigue saliendo solo del
  -- extra real de la venta sobre la protegida.
  select l.tasa_efectiva, l.techo_tasa_dia
    into v_tef, v_ttecho
    from public.dinero_esperas e
    join public.dinero_lotes_saldo l on l.id = e.lote_id
   where e.id = v_v.espera_id;
  v_ahorro := case when v_tef is not null and v_ttecho is not null
              then round(greatest(v_ttecho - v_tef, 0)
                         * v_v.producto_cantidad, 2) end;
  insert into public.pago_liquidaciones
    (vuelta_id, buscador_codigo, es_prueba, capital_cup, producto_cantidad,
     ref360_papel, pct_estrellas, ganancia_papel, estimado_papel,
     colchon_pct_aplicado, ref360_protegida, ganancia_protegida, fijo,
     comision_ya_pagada,
     tasa_efectiva_compra, techo_tasa_compra, ahorro_compra_cup)
  values
    (v_v.id, v_v.buscador_codigo, v_v.es_prueba, v_v.capital_cup, v_v.producto_cantidad,
     v_v.base_ref360, v_pct, v_v.ganancia_capturada, v_v.comision,
     v_cfg.colchon_pct, v_ref_prot, v_gan_prot, v_fijo,
     case when v_v.pago_hecho then v_v.comision else 0 end,
     v_tef, v_ttecho, v_ahorro)
  returning * into v_liq;
  return jsonb_build_object('ok', true, 'ya_existia', false, 'liquidacion', v_liq.id,
    'fijo', v_liq.fijo, 'estimado_papel', v_liq.estimado_papel,
    'colchon_pct', v_liq.colchon_pct_aplicado);
end;
$function$;



-- ---------------------------------------------------------------------
-- 12) LA VENTA REAL: acumula el valor por lote (idea 6)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pago_registrar_venta_saldo(p_codigo text, p_referencia text, p_saldo numeric, p_tasa numeric, p_qusd numeric, p_origen text DEFAULT 'manual'::text, p_prueba boolean DEFAULT false, p_medio_pago text DEFAULT 'efectivo'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_prev public.pago_ventas_saldo;
  v_t public.tarifa;
  v_foto public.mercado_fotos;
  v_ingreso_real numeric;
  v_venta uuid;
  v_rest numeric := p_saldo;
  v_lote record; v_chunk numeric;
  v_esp record; v_vids uuid[];
  v_tot_prod numeric; v_share numeric; v_chunk_v numeric;
  v_liq public.pago_liquidaciones;
  v_costo numeric; v_valor_real numeric; v_valor_prot numeric;
  v_extra numeric; v_premio bigint;
  v_premio_nuevo bigint := 0;
  v_pagos jsonb := '[]'::jsonb;
  v_detalle jsonb := '[]'::jsonb;
  v_pagar public.pago_liquidaciones;
  v_pago jsonb;
begin
  if not public.dinero_es_admin(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_admin_no_valido'); end if;
  select * into v_prev from public.pago_ventas_saldo where referencia = p_referencia;
  if v_prev.id is not null then
    return jsonb_build_object('ok', true, 'ya_existia', true, 'venta', v_prev.id,
      'premio_total', v_prev.premio_total);
  end if;
  if p_saldo is null or p_saldo <= 0 or p_tasa is null or p_tasa <= 0
     or p_qusd is null or p_qusd <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'datos_invalidos'); end if;
  if abs(p_qusd - p_saldo / p_tasa) > greatest(0.02, p_saldo / p_tasa * 0.02) then
    return jsonb_build_object('ok', false, 'motivo', 'qusd_no_cuadra_con_tasa',
      'esperado', round(p_saldo / p_tasa, 4), 'recibido', p_qusd); end if;
  select * into v_t from public.tarifa where id = 1;
  if v_t.salida_ref is null or v_t.salida_ref <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_salida_ref'); end if;
  select * into v_foto from public.mercado_fotos order by recibida_en desc limit 1;
  v_ingreso_real := round(360.0 * v_t.salida_ref / p_tasa, 4);

  insert into public.pago_ventas_saldo
    (referencia, origen, es_prueba, saldo_vendido, tasa_ejecutada, qusd_recibidos,
     salida_ref_usada, ingreso_real360, ref360_vigente, foto_id)
  values (p_referencia, coalesce(p_origen, 'manual'), coalesce(p_prueba, false),
    p_saldo, p_tasa, p_qusd, v_t.salida_ref, v_ingreso_real, v_t.ingreso_ref360,
    v_foto.id)
  returning id into v_venta;

  for v_lote in
    select * from public.dinero_lotes_saldo
     where es_prueba = coalesce(p_prueba, false) and cantidad_restante > 0
     order by creado_en for update
  loop
    exit when v_rest <= 0;
    v_chunk := least(v_rest, v_lote.cantidad_restante);
    v_rest := v_rest - v_chunk;
    update public.dinero_lotes_saldo
       set cantidad_restante = cantidad_restante - v_chunk,
           costo_restante_cup = round(costo_total_cup *
             (cantidad_restante - v_chunk) / nullif(cantidad_saldo, 0))::bigint,
           valor_real_acum = valor_real_acum
             + round(v_chunk * v_ingreso_real / 360.0, 2)
     where id = v_lote.id;

    select * into v_esp from public.dinero_esperas where lote_id = v_lote.id limit 1;
    if v_esp.id is null then
      v_detalle := v_detalle || jsonb_build_object('lote', v_lote.id, 'saldo', v_chunk,
        'destino', 'sin_espera_compra_propia');
      continue;
    end if;
    select array_agg(x::uuid) into v_vids
      from jsonb_array_elements_text(v_esp.vuelta_ids) x;
    select coalesce(sum(producto_cantidad), 0) into v_tot_prod
      from public.pago_liquidaciones
     where vuelta_id = any(v_vids);
    if coalesce(v_tot_prod, 0) <= 0 then
      v_detalle := v_detalle || jsonb_build_object('lote', v_lote.id, 'saldo', v_chunk,
        'destino', 'vueltas_fuera_de_regimen');
      continue;
    end if;
    for v_liq in
      select * from public.pago_liquidaciones
       where vuelta_id = any(v_vids) order by creada_en for update
    loop
      v_share := v_chunk * v_liq.producto_cantidad / v_tot_prod;
      if v_share <= 0 then continue; end if;
      v_chunk_v := least(v_share, v_liq.producto_cantidad - v_liq.saldo_vendido);
      if v_chunk_v <= 0 then continue; end if;
      v_costo := v_liq.capital_cup * v_chunk_v / v_liq.producto_cantidad;
      v_valor_real := v_chunk_v * v_ingreso_real / 360.0;
      v_valor_prot := v_chunk_v * v_liq.ref360_protegida / 360.0;
      v_extra := greatest(0, v_valor_real - v_valor_prot);
      v_premio := floor(v_liq.pct_estrellas * v_extra / 100.0)::bigint;
      insert into public.pago_premio_detalle
        (venta_id, liquidacion_id, vuelta_id, saldo_atribuido, costo_cup_atribuido,
         valor_real_cup, valor_protegido_cup, extra_cup, premio_cup)
      values (v_venta, v_liq.id, v_liq.vuelta_id, round(v_chunk_v, 2), round(v_costo, 2),
         round(v_valor_real, 2), round(v_valor_prot, 2), round(v_extra, 2), v_premio)
      on conflict (venta_id, vuelta_id) do nothing;
      update public.pago_liquidaciones
         set saldo_vendido = saldo_vendido + v_chunk_v,
             valor_real_acum = valor_real_acum + v_valor_real,
             ganancia_real_acum = ganancia_real_acum + (v_valor_real - v_costo),
             extra_acum = extra_acum + v_extra,
             premio_total = premio_total + v_premio,
             tasa_efectiva_compra = coalesce(
               tasa_efectiva_compra, v_lote.tasa_efectiva),
             techo_tasa_compra = coalesce(
               techo_tasa_compra, v_lote.techo_tasa_dia),
             ahorro_compra_cup = case
               when v_lote.techo_tasa_dia is null then ahorro_compra_cup
               else coalesce(ahorro_compra_cup, 0) + round(
                 greatest(v_lote.techo_tasa_dia - v_lote.tasa_efectiva, 0)
                 * v_chunk_v, 2) end,
             actualizada_en = now()
       where id = v_liq.id;
      v_detalle := v_detalle || jsonb_build_object('lote', v_lote.id,
        'vuelta', v_liq.vuelta_id, 'saldo', round(v_chunk_v, 2),
        'extra', round(v_extra, 2), 'premio', v_premio);
    end loop;
  end loop;

  if v_rest > 0 then
    raise exception 'saldo vendido sin lote que lo cubra: quedan % de %', v_rest, p_saldo;
  end if;

  for v_pagar in
    select * from public.pago_liquidaciones
     where premio_total > premio_pagado and id in
       (select liquidacion_id from public.pago_premio_detalle where venta_id = v_venta)
     for update
  loop
    v_premio_nuevo := v_pagar.premio_total - v_pagar.premio_pagado;
    v_pago := public.pago_mover_pago(v_pagar, 'premio_venta', v_premio_nuevo, p_medio_pago);
    v_pagos := v_pagos || jsonb_build_object('vuelta', v_pagar.vuelta_id, 'pago', v_pago);
    update public.pago_liquidaciones set premio_pagado = premio_total,
      actualizada_en = now() where id = v_pagar.id;
  end loop;

  update public.pago_ventas_saldo
     set premio_total = (select coalesce(sum(premio_cup), 0)
                           from public.pago_premio_detalle where venta_id = v_venta),
         detalle = v_detalle
   where id = v_venta;

  insert into public.pago_colchon_observaciones
    (es_prueba, venta_id, ref360_papel, ingreso_real360, desviacion_pct)
  values (coalesce(p_prueba, false), v_venta, v_t.ingreso_ref360, v_ingreso_real,
    round((v_t.ingreso_ref360 - v_ingreso_real) / v_t.ingreso_ref360 * 100.0, 2));
  perform public.pago_autoajustar_colchon(coalesce(p_prueba, false));

  return jsonb_build_object('ok', true, 'ya_existia', false, 'venta', v_venta,
    'ingreso_real360', v_ingreso_real,
    'premio_total', (select premio_total from public.pago_ventas_saldo where id = v_venta),
    'pagos', v_pagos, 'detalle', v_detalle);
end;
$function$;



-- ---------------------------------------------------------------------
-- 13) ESTADO DEL DUEÑO: compra atribuida + cierres de lotes
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pago_estado_dueno(p_codigo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_liq jsonb; v_cfg jsonb; v_log jsonb; v_cierres jsonb;
begin
  if not public.dinero_es_admin(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_admin_no_valido'); end if;
  select coalesce(jsonb_agg(fila order by fila->>'creada_en' desc), '[]'::jsonb) into v_liq from (
    select jsonb_build_object(
      'vuelta', l.vuelta_id, 'buscador', l.buscador_codigo, 'es_prueba', l.es_prueba,
      'creada_en', l.creada_en, 'capital_cup', l.capital_cup,
      'producto', l.producto_cantidad, 'pct', l.pct_estrellas,
      'antes', jsonb_build_object('estimado_papel', l.estimado_papel,
        'ganancia_papel', l.ganancia_papel, 'ref360_papel', l.ref360_papel),
      'protegido', jsonb_build_object('fijo', l.fijo,
        'colchon_pct', l.colchon_pct_aplicado, 'ref360_protegida', l.ref360_protegida,
        'ganancia_protegida', l.ganancia_protegida),
      'compra', jsonb_build_object('tasa_efectiva', l.tasa_efectiva_compra,
        'techo_tasa', l.techo_tasa_compra,
        'ahorro_compra_cup', l.ahorro_compra_cup),
      'comision_ya_pagada', l.comision_ya_pagada, 'topup_pagado', l.fijo_topup_pagado,
      'redondeo_pagado', l.redondeo_pagado,
      'ahora', jsonb_build_object('saldo_vendido', l.saldo_vendido,
        'valor_real', round(l.valor_real_acum, 2),
        'ganancia_real', round(l.ganancia_real_acum, 2),
        'extra_real', round(l.extra_acum, 2), 'premio', l.premio_pagado),
      'buscador_total', greatest(l.fijo, l.comision_ya_pagada) + l.premio_pagado + l.redondeo_pagado,
      'neto_ernesto_real', round(l.ganancia_real_acum, 2)
        - greatest(l.fijo, l.comision_ya_pagada) - l.premio_pagado - l.redondeo_pagado) as fila
      from public.pago_liquidaciones l) s;
  select coalesce(jsonb_agg(jsonb_build_object('es_prueba', es_prueba, 'activo', activo,
      'activo_desde', activo_desde, 'colchon_pct', colchon_pct,
      'rejilla_efectivo', rejilla_efectivo,
      'origen', colchon_origen, 'actualizado_en', actualizado_en)), '[]'::jsonb)
    into v_cfg from public.pago_proteccion_config;
  select coalesce(jsonb_agg(jsonb_build_object('en', creado_en, 'es_prueba', es_prueba,
      'antes', colchon_antes, 'despues', colchon_despues, 'motivo', motivo,
      'detalle', detalle) order by creado_en desc), '[]'::jsonb)
    into v_log from (select * from public.pago_colchon_log
                       order by creado_en desc limit 10) q;
  select jsonb_build_object(
      'n_cerrados', count(*), 'con_margen', count(margen_real_recarga),
      'margen_promedio_recarga', round(avg(margen_real_recarga), 2))
    into v_cierres from public.dinero_lotes_cierres;
  return jsonb_build_object('ok', true, 'config', v_cfg, 'liquidaciones', v_liq,
    'colchon_log', v_log, 'cierres_lotes', v_cierres);
end;
$function$;



-- ---------------------------------------------------------------------
-- 14) ASESOR: el colchón pasa a ser peaje × envíos
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
      if v_vendible / v_tasa < 10 then
        v_motivos := array_append(v_motivos, 'vendible_bajo');
      else
        v_monto := least(
          coalesce((p #>> '{puerta,tope_oferta}')::numeric, 40),
          floor(v_vendible / v_tasa),
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
    'motivos_no_prepara', to_jsonb(v_motivos),
    'compra_fondo', v_compra,
    'transferencia', p #> '{foto,transferencia}');
end;
$function$;



-- ---------------------------------------------------------------------
-- 15) ASESOR (interno): pasa el peaje y enseña el semáforo
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
  v_dem_tope numeric; v_dem_banda_tasa numeric;
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
  v_base_fuente := case when v_base_viva then 'oferta_viva'
                        when v_base then 'plantilla' else null end;

  select saldo_principal_cup, recibido_en into v_linea, v_linea_en
    from public.sms_linea
   where saldo_principal_cup is not null
   order by id desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'cantidad', cantidad_restante, 'costo', costo_restante_cup,
           'costo_por_recarga', costo_por_recarga,
           'semaforo_compra', semaforo_compra,
           'margen_recarga_nacer', margen_recarga_nacer)
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
      'colchon', v_cfg.colchon_saldo,
      'peaje_envio', v_cfg.peaje_envio_saldo,
      'tope_receptor_envio', v_cfg.tope_receptor_envio,
      'mat_fifo', v_cfg.mat_asesor_fifo),
    'demanda', jsonb_build_object(
      'usable', v_dem_usable, 'declaracion', v_dem_decl,
      'termometro', v_dem.termometro,
      'salida_cima_usd_h', v_dem.salida_cima_usd_h,
      'vida_cima_min', v_dem.vida_cima_min,
      'medida_en', v_dem.medida_en,
      'tope_usd', v_dem_tope,
      'bandas', coalesce(v_dem.bandas, '[]'::jsonb),
      'banda_tasa', v_dem_banda_tasa,
      'ventana_min', v_dem_vent_min),
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
$function$;



-- ---------------------------------------------------------------------
-- 16) BUSCADOR: su techo de calle (idea 4 — solo su techo)
-- ---------------------------------------------------------------------
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
  v_out jsonb := '[]'::jsonb; v_usable boolean; v_techo jsonb;
begin
  select * into v_u from public.validar_usuario(p_codigo) limit 1;
  if v_u is null or not v_u.activo or v_u.bloqueado then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_invalido');
  end if;
  v_busc := v_u.codigo;
  v_techo := public.tarifa_techo_calle(p_prueba);

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
    'techo_calle', case when (v_techo ->> 'techo_tasa') is null then null
      else jsonb_build_object(
        'tasa_unidad', (v_techo ->> 'techo_tasa')::numeric,
        'por_recarga', (v_techo ->> 'techo_recarga')::numeric) end,
    'sugerencias', v_out);
end;
$function$;

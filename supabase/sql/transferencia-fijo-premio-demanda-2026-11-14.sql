-- =====================================================================
-- TRANSFERENCIA CUP · FIJO PROTEGIDO + PREMIO + DEMANDA→PRECIO
-- (2026-11-14 · CHEQUEO 91)
-- ---------------------------------------------------------------------
-- EL ENCARGO (Ernesto, «haz todo», 2026-11-14): la vuelta de
-- TRANSFERENCIA en CUP entra al MISMO régimen que la de saldo
-- (CHEQUEO 83): fijo protegido al nacer + premio al vender contra el
-- resultado real, con el mismo colchón autoajustable y el mismo
-- redondeo en efectivo. Y la DEMANDA de BANK_CUP (que ya se mide,
-- CHEQUEO 85) alimenta el precio de la transferencia con los mismos
-- frenos por banda que usa ETECSA.
--
-- DINERO = DIMENSIONES (la regla de la casa): en esta pieza conviven
-- TRES unidades que JAMÁS se mezclan sin tasa escrita:
--   · CUP de transferencia (lo que el buscador mueve por BANDEC),
--   · saldo ETECSA (NO entra aquí: la vuelta de transferencia no crea
--     lotes ni toca inventario de saldo),
--   · QUSD (lo que Ernesto recibe al vender el CUP: QUSD = CUP ÷ tasa).
-- La ganancia de la vuelta de transferencia nace a PAR NOMINAL:
-- valor_producto_cup = CUP que entran, ganancia = producto − capital
-- (ese es el asiento de dinero_registrar_vuelta, no se toca). El valor
-- REAL aparece al vender: por cada CUP vendido entran
-- salida_ref ÷ tasa_aplicada CUP-equivalente de QUSD (la salida es la
-- de Miguel, El Toque del momento — la ÚNICA salida del sistema).
--
-- EL MARCO DE LA PROTECCIÓN (la decisión de diseño de esta pieza):
-- el colchón NO se observa contra el par (1 CUP = 1 CUP), porque el
-- par no es un precio: es la foto del momento en que nació la vuelta.
-- El marco vivo de una transferencia es salida_ref ÷ libro_ref (el
-- precio de libro de transferencia ya existe: tarifa.libro_ref =
-- bankcup_promedio del vigía, del que el Copiloto deriva la prima).
--   · valor unitario de papel de la vuelta = valor_producto ÷ producto
--     (hoy = 1,0000 por construcción del asiento; se guarda explícito
--     pa que el día que el asiento deje de ser a par, la foto siga
--     siendo la verdad de ESA vuelta),
--   · unitario protegido = papel × (1 − colchón/100) — el MISMO
--     colchón del saldo, mismo config, mismo autoajuste,
--   · fijo = % del escalón de TRANSFERENCIA (dinero_pct_estrellas:
--     4.9★ → 26 %) sobre la ganancia protegida, topado por la
--     comisión a papel (invariante dura, igual que el saldo),
--   · premio = ese % sobre el EXTRA real (valor real − protegido) de
--     cada venta real registrada; venta mala → extra 0 → sin premio
--     y el fijo NO baja (la garantía del CHEQUEO 83, intacta).
-- La observación del colchón de una venta de transferencia compara el
-- MARCO de la foto (salida ÷ libro, guardado en la venta) contra el
-- ingreso real por CUP de esa venta: desviación = (marco − ingreso) ÷
-- marco. Dos observaciones que acuerdan mueven el colchón compartido
-- (saldo y transferencia observan el mismo colchón: es UN régimen).
--
-- DEMANDA → PRECIO (segunda mitad del encargo): la prima de
-- transferencia que sugiere el Copiloto (guia_calc_copiloto) nace de
-- salida/libro con su suelo (piso público, redondeo de la prima
-- mínima + 3). Sobre esa base, la señal de demanda de BANK_CUP:
--   · termómetro ALTA y la banda del libro ABSORBE (salida_usd_h > 0
--     en la banda que contiene libro_ref) → la prima sube
--     +transf_prima_alta_pts (default 2): hay cola comprando CUP, el
--     buscador puede pedir más prima sin quedarse con el dinero
--     parado.
--   · termómetro ALTA pero la banda está en CERO → FRENO (el patrón
--     de ETECSA, CHEQUEO 85): sin absorción en tu zona no hay empuje,
--     prima intacta y motivo declarado freno_banda_sin_absorcion.
--     Sin fila de banda (o sin medición fresca) → tampoco hay empuje
--     (demanda_alta_sin_banda / sin_senal): lo no medido no empuja.
--   · termómetro FRÍA → la prima baja −transf_prima_fria_pts
--     (default 2) pa rotar, con suelo duro: jamás por debajo del piso
--     público ni del equilibrio redondeado (ceil de prima mínima).
--   · NORMAL → ajuste 0. Todo queda DECLARADO en la sugerencia
--     (demanda: termómetro, motivo, ajuste, prima base, absorción).
-- La señal se lee UNA vez en guia_buscador (demanda_senal_
-- transferencia, con la medición BANK_CUP más reciente y su edad
-- máxima transf_demanda_max_edad_min, default 30 min) y viaja como
-- dato dentro del jsonb del Copiloto: la calculadora sigue PURA
-- (inmutable, sin leer tablas) y testeable por el banco sin tocar la
-- base, igual que el resto de sus entradas.
--
-- PUERTAS NUEVAS/EXTENDIDAS:
--   · pago_congelar_snapshot v2 — generalizada: saldo (idéntica) y
--     transferencia (nueva); pago_al_nacer_vuelta dispara también pa
--     transferencia. pago_liquidaciones gana tipo + unitarios.
--   · pago_registrar_venta_transferencia — la venta real del CUP
--     (CUP, tasa CUP/QUSD, QUSD recibidos con cuadre ±2 %): reparte
--     FIFO sobre las liquidaciones de transferencia, paga el premio
--     por pago_mover_pago (redondeo por medio incluido) y deja su
--     observación del colchón contra el marco.
--   · demanda_senal_transferencia(libro) — la señal lista pa usar.
--   · guia_calc_copiloto v2 — la prima con demanda (declarada).
--   · guia_buscador — pasa la señal al Copiloto (una línea).
--   · pago_estado_dueno / pago_mi_estado — cada fila declara su tipo
--     y, en transferencia, sus unitarios (papel/protegido por CUP).
-- pago_congelar_fijo NO cambia: es genérica (fijo − ya pagado, con
-- redondeo por medio) y sirve tal cual a la vuelta de transferencia.
--
-- Sin pantallas (eso es la T3). Sin tocar el asiento de la vuelta ni
-- el Copiloto de saldo. Idempotencia: pago_ventas_transferencia.
-- referencia única por carril + detalle único por (venta, liquidación)
-- + el FIFO jamás re-cubre un CUP ya vendido.
-- =====================================================================

-- §0 · COLUMNAS Y CONFIG ---------------------------------------------
alter table public.pago_liquidaciones
  add column if not exists tipo text not null default 'saldo',
  add column if not exists valor_unit_papel numeric,
  add column if not exists valor_unit_protegida numeric;

do $$ begin
  alter table public.pago_liquidaciones
    add constraint pago_liquidaciones_tipo_chk
    check (tipo in ('saldo','transferencia'));
exception when duplicate_object then null; end $$;

-- las liquidaciones de saldo que ya existen declaran su unitario
-- (por 360, el de siempre) pa que la fila sea legible sin mirar tipo
update public.pago_liquidaciones
   set valor_unit_papel = ref360_papel,
       valor_unit_protegida = ref360_protegida
 where tipo = 'saldo' and valor_unit_papel is null;

alter table public.demanda_config
  add column if not exists transf_prima_alta_pts numeric not null default 2,
  add column if not exists transf_prima_fria_pts numeric not null default 2,
  add column if not exists transf_demanda_max_edad_min integer not null default 30;

-- §1 · pago_congelar_snapshot v2 — EL SNAPSHOT GENERALIZADO ----------
-- Saldo: la matemática EXACTA de la v1 (incl. la atribución de la
-- compra del CHEQUEO 86). Transferencia: la del marco (cabecera).
create or replace function public.pago_congelar_snapshot(p_vuelta uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_v public.dinero_vueltas;
  v_cfg public.pago_proteccion_config;
  v_est numeric; v_pct numeric;
  v_tef numeric; v_ttecho numeric; v_ahorro numeric;
  v_ref_prot numeric; v_valor_prot bigint; v_gan_prot bigint; v_fijo bigint;
  v_unit numeric; v_unit_prot numeric;
  v_liq public.pago_liquidaciones;
begin
  select * into v_liq from public.pago_liquidaciones where vuelta_id = p_vuelta;
  if v_liq.id is not null then
    -- (atribución de la compra del saldo: igual que la v1)
    if v_liq.tipo = 'saldo' and v_liq.ahorro_compra_cup is null then
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
  if v_v.tipo not in ('saldo','transferencia') then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_no_cubierto'); end if;
  select * into v_cfg from public.pago_proteccion_config where es_prueba = v_v.es_prueba;
  if not coalesce(v_cfg.activo, false) then
    return jsonb_build_object('ok', false, 'motivo', 'regimen_inactivo'); end if;
  if v_cfg.activo_desde is not null and v_v.abierta_en < v_cfg.activo_desde then
    return jsonb_build_object('ok', false, 'motivo', 'fuera_de_regimen'); end if;
  select estrellas into v_est from public.dinero_estrellas_de(v_v.buscador_codigo, v_v.es_prueba);

  if v_v.tipo = 'saldo' then
    v_pct := public.dinero_pct_estrellas(v_est, 'saldo');
    v_ref_prot := round(v_v.base_ref360 * (1 - v_cfg.colchon_pct / 100.0), 4);
    v_valor_prot := floor(v_v.producto_cantidad * v_ref_prot / 360.0)::bigint;
    v_gan_prot := v_valor_prot - v_v.capital_cup;
    v_fijo := case when v_gan_prot > 0 then floor(v_gan_prot * v_pct / 100.0)::bigint else 0 end;
    if v_fijo > v_v.comision then v_fijo := v_v.comision; end if;
    select l.tasa_efectiva, l.techo_tasa_dia
      into v_tef, v_ttecho
      from public.dinero_esperas e
      join public.dinero_lotes_saldo l on l.id = e.lote_id
     where e.id = v_v.espera_id;
    v_ahorro := case when v_tef is not null and v_ttecho is not null
                then round(greatest(v_ttecho - v_tef, 0)
                           * v_v.producto_cantidad, 2) end;
    insert into public.pago_liquidaciones
      (vuelta_id, buscador_codigo, es_prueba, tipo, capital_cup, producto_cantidad,
       ref360_papel, pct_estrellas, ganancia_papel, estimado_papel,
       colchon_pct_aplicado, ref360_protegida, ganancia_protegida, fijo,
       comision_ya_pagada, valor_unit_papel, valor_unit_protegida,
       tasa_efectiva_compra, techo_tasa_compra, ahorro_compra_cup)
    values
      (v_v.id, v_v.buscador_codigo, v_v.es_prueba, 'saldo', v_v.capital_cup, v_v.producto_cantidad,
       v_v.base_ref360, v_pct, v_v.ganancia_capturada, v_v.comision,
       v_cfg.colchon_pct, v_ref_prot, v_gan_prot, v_fijo,
       case when v_v.pago_hecho then v_v.comision else 0 end,
       v_v.base_ref360, v_ref_prot,
       v_tef, v_ttecho, v_ahorro)
    returning * into v_liq;
  else
    -- TRANSFERENCIA: unitarios por CUP transferido (cabecera §marco).
    if v_v.producto_cantidad is null or v_v.producto_cantidad <= 0
       or v_v.valor_producto_cup is null then
      return jsonb_build_object('ok', false, 'motivo', 'vuelta_sin_producto'); end if;
    v_pct := public.dinero_pct_estrellas(v_est, 'transferencia');
    v_unit := round(v_v.valor_producto_cup::numeric / v_v.producto_cantidad, 6);
    v_unit_prot := round(v_unit * (1 - v_cfg.colchon_pct / 100.0), 6);
    v_valor_prot := floor(v_v.producto_cantidad * v_unit_prot)::bigint;
    v_gan_prot := v_valor_prot - v_v.capital_cup;
    v_fijo := case when v_gan_prot > 0 then floor(v_gan_prot * v_pct / 100.0)::bigint else 0 end;
    if v_fijo > v_v.comision then v_fijo := v_v.comision; end if; -- invariante dura
    insert into public.pago_liquidaciones
      (vuelta_id, buscador_codigo, es_prueba, tipo, capital_cup, producto_cantidad,
       ref360_papel, pct_estrellas, ganancia_papel, estimado_papel,
       colchon_pct_aplicado, ref360_protegida, ganancia_protegida, fijo,
       comision_ya_pagada, valor_unit_papel, valor_unit_protegida)
    values
      (v_v.id, v_v.buscador_codigo, v_v.es_prueba, 'transferencia',
       v_v.capital_cup, v_v.producto_cantidad,
       v_unit, v_pct, v_v.ganancia_capturada, v_v.comision,
       v_cfg.colchon_pct, v_unit_prot, v_gan_prot, v_fijo,
       case when v_v.pago_hecho then v_v.comision else 0 end,
       v_unit, v_unit_prot)
    returning * into v_liq;
  end if;
  return jsonb_build_object('ok', true, 'ya_existia', false, 'liquidacion', v_liq.id,
    'tipo', v_liq.tipo,
    'fijo', v_liq.fijo, 'estimado_papel', v_liq.estimado_papel,
    'colchon_pct', v_liq.colchon_pct_aplicado);
end; $$;

-- §2 · EL DISPARADOR TAMBIÉN NACE PA TRANSFERENCIA -------------------
create or replace function public.pago_al_nacer_vuelta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo in ('saldo','transferencia') then
    begin
      perform public.pago_congelar_snapshot(new.id);
    exception when others then
      begin
        insert into public.pago_colchon_log (es_prueba, motivo, detalle)
        values (new.es_prueba, 'error_snapshot',
          jsonb_build_object('vuelta', new.id, 'error', sqlerrm));
      exception when others then null;
      end;
    end;
  end if;
  return new;
end; $$;

-- §3 · LAS VENTAS REALES DE TRANSFERENCIA ----------------------------
create table if not exists public.pago_ventas_transferencia (
  id uuid primary key default gen_random_uuid(),
  referencia text not null,
  es_prueba boolean not null default false,
  cup_vendidos numeric not null check (cup_vendidos > 0),
  tasa_aplicada numeric not null check (tasa_aplicada > 0),   -- CUP por QUSD
  qusd_recibidos numeric not null check (qusd_recibidos > 0),
  salida_ref_uso numeric not null,                            -- CUP por QUSD (la salida)
  libro_ref_uso numeric,                                      -- CUP por QUSD (libro BANK_CUP)
  ingreso_real_unit numeric not null,   -- salida ÷ tasa: CUP-equiv por CUP vendido
  marco_real_unit numeric,              -- salida ÷ libro: el marco de la foto
  premio_total bigint not null default 0,
  creada_en timestamptz not null default now(),
  unique (referencia, es_prueba)
);
create table if not exists public.pago_premio_transferencia_detalle (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.pago_ventas_transferencia(id),
  liquidacion_id uuid not null references public.pago_liquidaciones(id),
  cup_cubiertos numeric not null,
  costo_cup numeric not null,
  valor_real_cup numeric not null,
  valor_protegido_cup numeric not null,
  extra_cup numeric not null,
  premio_cup bigint not null,
  creada_en timestamptz not null default now(),
  unique (venta_id, liquidacion_id)
);
create index if not exists pago_ventas_transf_carril_idx
  on public.pago_ventas_transferencia (es_prueba, creada_en);
alter table public.pago_ventas_transferencia enable row level security;
alter table public.pago_premio_transferencia_detalle enable row level security;
revoke all on public.pago_ventas_transferencia from anon, authenticated;
revoke all on public.pago_premio_transferencia_detalle from anon, authenticated;

-- §4 · pago_registrar_venta_transferencia — LA VENTA REAL ------------
-- Ernesto vende el CUP de las vueltas de transferencia (a Miguel, a
-- la salida del momento) y registra: CUP vendidos, tasa aplicada
-- (CUP por QUSD) y QUSD recibidos (cuadre ±2 %). El premio se reparte
-- FIFO y se PAGA por pago_mover_pago (redondeo por medio incluido).
create or replace function public.pago_registrar_venta_transferencia(
  p_codigo text, p_referencia text, p_cup numeric, p_tasa numeric,
  p_qusd numeric, p_origen text default 'manual',
  p_prueba boolean default false, p_medio_pago text default 'efectivo')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_salida numeric; v_libro numeric;
  v_ingreso numeric; v_marco numeric; v_desv numeric;
  v_venta public.pago_ventas_transferencia;
  v_rest numeric; v_liq record; v_pago record;
  v_liqrow public.pago_liquidaciones;
  v_chunk numeric; v_costo numeric; v_vreal numeric; v_vprot numeric;
  v_extra numeric; v_premio bigint; v_esperado numeric;
  v_premios bigint := 0;
begin
  if not public.dinero_es_admin(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_admin_no_valido'); end if;
  if p_referencia is null or btrim(p_referencia) = '' then
    return jsonb_build_object('ok', false, 'motivo', 'referencia_requerida'); end if;
  if p_medio_pago not in ('efectivo','transferencia') then
    return jsonb_build_object('ok', false, 'motivo', 'medio_invalido'); end if;
  if p_cup is null or p_cup <= 0 or p_tasa is null or p_tasa <= 0
     or p_qusd is null or p_qusd <= 0 then
    return jsonb_build_object('ok', false, 'motivo', 'venta_invalida'); end if;
  v_esperado := p_cup / p_tasa;
  if abs(p_qusd - v_esperado) > greatest(0.02, v_esperado * 0.02) then
    return jsonb_build_object('ok', false, 'motivo', 'qusd_no_cuadra',
      'esperado', round(v_esperado, 4)); end if;
  select salida_ref, libro_ref into v_salida, v_libro from public.tarifa where id = 1;
  if v_salida is null then
    return jsonb_build_object('ok', false, 'motivo', 'sin_salida'); end if;
  select * into v_venta from public.pago_ventas_transferencia
   where referencia = p_referencia and es_prueba = coalesce(p_prueba, false);
  if v_venta.id is not null then
    return jsonb_build_object('ok', true, 'ya_existia', true, 'venta', v_venta.id,
      'premio_total', v_venta.premio_total); end if;
  v_ingreso := round(v_salida / p_tasa, 6);
  v_marco := case when v_libro is not null and v_libro > 0
                  then round(v_salida / v_libro, 6) end;
  insert into public.pago_ventas_transferencia
    (referencia, es_prueba, cup_vendidos, tasa_aplicada, qusd_recibidos,
     salida_ref_uso, libro_ref_uso, ingreso_real_unit, marco_real_unit, premio_total)
  values (p_referencia, coalesce(p_prueba, false), p_cup, p_tasa, p_qusd,
          v_salida, v_libro, v_ingreso, v_marco, 0)
  returning * into v_venta;
  v_rest := p_cup;
  for v_liq in
    select * from public.pago_liquidaciones
     where tipo = 'transferencia' and es_prueba = coalesce(p_prueba, false)
       and saldo_vendido < producto_cantidad
     order by creada_en asc for update
  loop
    exit when v_rest <= 0;
    v_chunk := least(v_rest, v_liq.producto_cantidad - v_liq.saldo_vendido);
    v_costo := v_liq.capital_cup * v_chunk / v_liq.producto_cantidad;
    v_vreal := v_chunk * v_ingreso;
    v_vprot := v_chunk * v_liq.valor_unit_protegida;
    v_extra := greatest(0, v_vreal - v_vprot);
    v_premio := floor(v_liq.pct_estrellas * v_extra / 100.0)::bigint;
    insert into public.pago_premio_transferencia_detalle
      (venta_id, liquidacion_id, cup_cubiertos, costo_cup, valor_real_cup,
       valor_protegido_cup, extra_cup, premio_cup)
    values (v_venta.id, v_liq.id, v_chunk, round(v_costo, 2), round(v_vreal, 2),
            round(v_vprot, 2), round(v_extra, 2), v_premio)
    on conflict (venta_id, liquidacion_id) do nothing;
    if found then
      update public.pago_liquidaciones set
        saldo_vendido = saldo_vendido + v_chunk,
        valor_real_acum = valor_real_acum + v_vreal,
        ganancia_real_acum = ganancia_real_acum + (v_vreal - v_costo),
        extra_acum = extra_acum + v_extra,
        premio_total = premio_total + v_premio,
        actualizada_en = now()
      where id = v_liq.id;
      v_rest := v_rest - v_chunk; v_premios := v_premios + v_premio;
    end if;
  end loop;
  if v_rest > 0 then
    raise exception 'venta de transferencia sin vuelta que la cubra: quedan % CUP', v_rest;
  end if;
  update public.pago_ventas_transferencia set premio_total = v_premios
   where id = v_venta.id;
  for v_pago in
    select l as liq, (l.premio_total - l.premio_pagado) as nuevo
      from public.pago_liquidaciones l
      join public.pago_premio_transferencia_detalle d on d.liquidacion_id = l.id
     where d.venta_id = v_venta.id
  loop
    if v_pago.nuevo <= 0 then continue; end if;
    v_liqrow := v_pago.liq;
    -- la firma VIVA de pago_mover_pago recibe la liquidación entera y
    -- aplica ella misma el redondeo por medio (línea redondeo_pago)
    perform public.pago_mover_pago(v_liqrow, 'premio_venta', v_pago.nuevo, p_medio_pago);
    update public.pago_liquidaciones set premio_pagado = premio_pagado + v_pago.nuevo
     where id = v_liqrow.id;
  end loop;
  -- la observación del colchón: contra el MARCO de la foto, no el par
  if v_marco is not null and v_marco > 0 then
    v_desv := round((v_marco - v_ingreso) / v_marco * 100.0, 2);
    insert into public.pago_colchon_observaciones
      (es_prueba, fuente, venta_id, ref360_papel, ingreso_real360, desviacion_pct)
    values (coalesce(p_prueba, false), 'venta_transferencia', v_venta.id,
            v_marco, v_ingreso, v_desv);
    perform public.pago_autoajustar_colchon(coalesce(p_prueba, false));
  end if;
  return jsonb_build_object('ok', true, 'ya_existia', false, 'venta', v_venta.id,
    'ingreso_real_unit', v_ingreso, 'marco_real_unit', v_marco,
    'premio_total', v_premios);
end; $$;
revoke all on function public.pago_registrar_venta_transferencia(text, text, numeric, numeric, numeric, text, boolean, text) from public, anon, authenticated;
grant execute on function public.pago_registrar_venta_transferencia(text, text, numeric, numeric, numeric, text, boolean, text) to service_role;

-- §5 · LA SEÑAL DE DEMANDA, LISTA PA USAR ----------------------------
create or replace function public.demanda_senal_transferencia(p_libro numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cfg public.demanda_config; v_m public.demanda_mediciones;
  v_banda jsonb; v_edad_max integer;
begin
  select * into v_cfg from public.demanda_config order by id limit 1;
  v_edad_max := coalesce(v_cfg.transf_demanda_max_edad_min, 30);
  select * into v_m from public.demanda_mediciones
   where moneda = 'BANK_CUP' order by medida_en desc limit 1;
  if v_m.id is null or v_m.medida_en < now() - make_interval(mins => v_edad_max) then
    return jsonb_build_object('termometro', 'sin_datos',
      'medida_en', v_m.medida_en, 'edad_max_min', v_edad_max,
      'prima_alta_pts', coalesce(v_cfg.transf_prima_alta_pts, 2),
      'prima_fria_pts', coalesce(v_cfg.transf_prima_fria_pts, 2));
  end if;
  if p_libro is not null then
    select b into v_banda
      from jsonb_array_elements(coalesce(v_m.bandas, '[]'::jsonb)) b
     where b ->> 'lado' = 'venta'
       and (b ->> 'banda')::numeric <= p_libro
       and (b ->> 'banda')::numeric + coalesce(v_cfg.banda_tasa, 5) > p_libro
     limit 1;
  end if;
  return jsonb_build_object('termometro', v_m.termometro,
    'medida_en', v_m.medida_en,
    'banda', (v_banda ->> 'banda')::numeric,
    'banda_salida_usd_h', (v_banda ->> 'salida_usd_h')::numeric,
    'prima_alta_pts', coalesce(v_cfg.transf_prima_alta_pts, 2),
    'prima_fria_pts', coalesce(v_cfg.transf_prima_fria_pts, 2));
end; $$;
revoke all on function public.demanda_senal_transferencia(numeric) from public, anon, authenticated;
grant execute on function public.demanda_senal_transferencia(numeric) to service_role;

-- §6 · guia_calc_copiloto v2 — LA PRIMA CON DEMANDA ------------------
-- Idéntica a la v1 salvo el riel de transferencia: tras la prima base
-- (suelo de siempre), la señal demanda_transf ajusta con frenos y
-- todo queda declarado en la sugerencia. Sigue PURA (inmutable).
create or replace function public.guia_calc_copiloto(p jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  v_ref      numeric := (p ->> 'ingreso_ref360')::numeric;
  v_libro    numeric := (p ->> 'libro_ref')::numeric;
  v_salida   numeric := (p ->> 'salida_ref')::numeric;
  v_piso     numeric := coalesce((p ->> 'piso_transf')::numeric, 25);
  v_pe       numeric := coalesce((p ->> 'pendiente_efectivo')::numeric, 0);
  v_pt       numeric := coalesce((p ->> 'pendiente_transferencia')::numeric, 0);
  v_pct_s    numeric := coalesce((p ->> 'pct_saldo')::numeric, 0);
  v_pct_t    numeric := coalesce((p ->> 'pct_transf')::numeric, 0);
  v_precio   numeric := coalesce((p ->> 'precio_obs')::numeric,
                                 (p ->> 'precio_respaldo')::numeric);
  v_ahora    timestamptz := coalesce((p ->> 'ahora')::timestamptz, now());
  v_mat_t    numeric := coalesce((p #>> '{cfg,mat_total}')::numeric, 100);
  v_mat_b    numeric := coalesce((p #>> '{cfg,mat_buscador}')::numeric, 40);
  v_margen   numeric := coalesce((p #>> '{cfg,margen_util}')::numeric, 40);
  -- saldo
  v_rec      numeric; v_saldo numeric; v_cap numeric; v_valor numeric;
  v_gan      numeric; v_parte numeric; v_tabs numeric; v_tut numeric;
  -- transferencia
  v_dmin     numeric; v_prima_min numeric; v_prima numeric;
  v_entra    numeric; v_gan_t numeric; v_parte_t numeric;
  -- demanda (nuevo): la señal viaja como dato, la calculadora no lee tablas
  v_dem      jsonb := (p -> 'demanda_transf');
  v_dem_term text; v_dem_banda numeric;
  v_prima_base numeric; v_ajuste numeric := 0;
  v_suelo_fria numeric; v_dem_mot text := 'sin_senal'; v_dem_out jsonb;
  r_saldo    jsonb; r_transf jsonb;
begin
  -- ---------- RIEL SALDO (idéntico a la v1) ----------
  if not coalesce((p ->> 'foto_usable')::boolean, false) or v_ref is null then
    r_saldo := jsonb_build_object('habla', false, 'motivo', 'foto_no_usable');
  elsif v_precio is null or v_precio <= 0 then
    r_saldo := jsonb_build_object('habla', false, 'motivo', 'sin_precio');
  elsif coalesce((p ->> 'espera_abierta_saldo')::boolean, false) then
    r_saldo := jsonb_build_object('habla', false, 'motivo', 'ya_en_camino');
  elsif (p ->> 'silencio_saldo_hasta') is not null
        and (p ->> 'silencio_saldo_hasta')::timestamptz > v_ahora then
    r_saldo := jsonb_build_object('habla', false, 'motivo', 'silencio_descarte');
  else
    v_rec := floor(v_pe / v_precio);
    if v_rec < 1 then
      r_saldo := jsonb_build_object('habla', false, 'motivo', 'capital_bajo');
    else
      v_saldo := v_rec * 360;
      v_cap   := v_rec * v_precio;
      v_valor := floor(v_saldo * v_ref / 360);
      v_gan   := v_valor - v_cap;
      v_parte := case when v_gan > 0 then floor(v_gan * v_pct_s / 100) else 0 end;
      v_tabs  := floor(v_ref);
      v_tut   := floor(v_ref - v_margen);
      if v_gan < v_mat_t or v_parte < v_mat_b then
        r_saldo := jsonb_build_object('habla', false, 'motivo', 'no_material',
          'ganancia_total', v_gan, 'parte_buscador', v_parte);
      else
        r_saldo := jsonb_build_object(
          'habla', true,
          'sugerencia', jsonb_build_object(
            'cantidad_recargas', v_rec, 'saldo', v_saldo, 'precio', v_precio,
            'capital', v_cap, 'valor', v_valor,
            'ganancia_total', v_gan, 'parte_buscador', v_parte,
            'techo_abs', v_tabs, 'techo_util', v_tut,
            'si_pagas_mas', jsonb_build_object(
              'precio', v_precio + 50,
              'parte_buscador', case when (v_valor - v_rec * (v_precio + 50)) > 0
                then floor((v_valor - v_rec * (v_precio + 50)) * v_pct_s / 100)
                else 0 end)));
      end if;
    end if;
  end if;

  -- ---------- RIEL TRANSFERENCIA (base v1 + demanda) ----------
  if not coalesce((p ->> 'foto_usable')::boolean, false)
     or v_libro is null or v_salida is null then
    r_transf := jsonb_build_object('habla', false, 'motivo', 'foto_no_usable');
  elsif coalesce((p ->> 'espera_abierta_transf')::boolean, false) then
    r_transf := jsonb_build_object('habla', false, 'motivo', 'ya_en_camino');
  elsif (p ->> 'silencio_transf_hasta') is not null
        and (p ->> 'silencio_transf_hasta')::timestamptz > v_ahora then
    r_transf := jsonb_build_object('habla', false, 'motivo', 'silencio_descarte');
  elsif v_pt < 1000 then
    r_transf := jsonb_build_object('habla', false, 'motivo', 'capital_bajo');
  else
    -- prima mínima REAL del día (la fórmula de la v1, intacta):
    v_dmin := 1 - v_salida / v_libro;
    v_prima_min := case when v_dmin >= 1 then null
                        else v_dmin / (1 - v_dmin) * 100 end;
    v_prima := greatest(v_piso,
      case when v_prima_min is null then v_piso
           else round(v_prima_min) + 3 end);
    v_prima_base := v_prima;
    -- DEMANDA BANK_CUP → ajuste con frenos (cabecera §demanda):
    v_dem_term := coalesce(v_dem ->> 'termometro', 'sin_datos');
    v_dem_banda := (v_dem ->> 'banda_salida_usd_h')::numeric;
    if v_dem is null or v_dem_term = 'sin_datos' then
      v_dem_mot := 'sin_senal';
    elsif v_dem_term = 'alta' then
      if v_dem_banda is null then
        v_dem_mot := 'demanda_alta_sin_banda';
      elsif v_dem_banda <= 0 then
        v_dem_mot := 'freno_banda_sin_absorcion';
      else
        v_ajuste := coalesce((v_dem ->> 'prima_alta_pts')::numeric, 2);
        v_prima := v_prima + v_ajuste;
        v_dem_mot := 'demanda_alta_absorbe';
      end if;
    elsif v_dem_term = 'fria' then
      v_suelo_fria := greatest(v_piso,
        case when v_prima_min is null then v_piso else ceil(v_prima_min) end);
      v_prima := greatest(v_suelo_fria,
        v_prima - coalesce((v_dem ->> 'prima_fria_pts')::numeric, 2));
      v_ajuste := v_prima - v_prima_base;
      v_dem_mot := 'demanda_fria';
    else
      v_dem_mot := 'demanda_normal';
    end if;
    v_dem_out := jsonb_build_object('termometro', v_dem_term,
      'motivo', v_dem_mot, 'ajuste_pts', v_ajuste,
      'prima_base', v_prima_base, 'banda_salida_usd_h', v_dem_banda);
    v_entra := round(v_pt * (1 + v_prima / 100));
    v_gan_t := v_entra - v_pt;
    v_parte_t := case when v_gan_t > 0 then floor(v_gan_t * v_pct_t / 100) else 0 end;
    if v_gan_t < v_mat_t or v_parte_t < v_mat_b then
      r_transf := jsonb_build_object('habla', false, 'motivo', 'no_material',
        'ganancia_total', v_gan_t, 'parte_buscador', v_parte_t,
        'demanda', v_dem_out);
    else
      r_transf := jsonb_build_object(
        'habla', true,
        'sugerencia', jsonb_build_object(
          'capital', v_pt, 'prima', v_prima, 'entra', v_entra,
          'ganancia_total', v_gan_t, 'parte_buscador', v_parte_t,
          'demanda', v_dem_out));
    end if;
  end if;

  return jsonb_build_object('saldo', r_saldo, 'transferencia', r_transf);
end; $$;

-- §7 · LAS VISTAS DECLARAN EL TIPO -----------------------------------
create or replace function public.pago_mi_estado(p_codigo text, p_prueba boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_u record; v_rows jsonb;
begin
  select * into v_u from public.validar_usuario(p_codigo) limit 1;
  if v_u.codigo is null or not v_u.activo or v_u.bloqueado then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_no_valido'); end if;
  select coalesce(jsonb_agg(fila order by fila->>'creada_en' desc), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'vuelta', l.vuelta_id, 'creada_en', l.creada_en, 'tipo', l.tipo,
      'producto', l.producto_cantidad,
      'fijo', greatest(l.fijo, l.comision_ya_pagada),
      'premio', l.premio_pagado,
      'redondeo', l.redondeo_pagado,
      'total', greatest(l.fijo, l.comision_ya_pagada) + l.premio_pagado + l.redondeo_pagado,
      'estado', case
        when l.saldo_vendido <= 0 then 'fijo_congelado'
        when l.saldo_vendido < l.producto_cantidad then 'vendiendo'
        when l.premio_pagado > 0 then 'premio_pagado'
        else 'vendido_sin_premio' end) as fila
      from public.pago_liquidaciones l
     where l.buscador_codigo = v_u.codigo and l.es_prueba = coalesce(p_prueba, false)) s;
  return jsonb_build_object('ok', true, 'buscador', v_u.codigo, 'vueltas', v_rows);
end; $$;

create or replace function public.pago_estado_dueno(p_codigo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_liq jsonb; v_cfg jsonb; v_log jsonb; v_cierres jsonb;
begin
  if not public.dinero_es_admin(p_codigo) then
    return jsonb_build_object('ok', false, 'motivo', 'codigo_admin_no_valido'); end if;
  select coalesce(jsonb_agg(fila order by fila->>'creada_en' desc), '[]'::jsonb) into v_liq from (
    select jsonb_build_object(
      'vuelta', l.vuelta_id, 'buscador', l.buscador_codigo, 'es_prueba', l.es_prueba,
      'tipo', l.tipo,
      'creada_en', l.creada_en, 'capital_cup', l.capital_cup,
      'producto', l.producto_cantidad, 'pct', l.pct_estrellas,
      'antes', jsonb_build_object('estimado_papel', l.estimado_papel,
        'ganancia_papel', l.ganancia_papel, 'ref360_papel', l.ref360_papel,
        'valor_unit_papel', l.valor_unit_papel),
      'protegido', jsonb_build_object('fijo', l.fijo,
        'colchon_pct', l.colchon_pct_aplicado, 'ref360_protegida', l.ref360_protegida,
        'valor_unit_protegida', l.valor_unit_protegida,
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
end; $$;

-- §8 · PERMISOS -------------------------------------------------------
revoke all on function public.pago_congelar_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.pago_congelar_snapshot(uuid) to service_role;
revoke all on function public.pago_mi_estado(text, boolean) from public, anon, authenticated;
grant execute on function public.pago_mi_estado(text, boolean) to service_role;
revoke all on function public.pago_estado_dueno(text) from public, anon, authenticated;
grant execute on function public.pago_estado_dueno(text) to service_role;

-- =====================================================================
-- guia_buscador: la señal viaja al Copiloto — se aplica como
-- reemplazo completo generado desde la definición VIVA con UNA línea
-- añadida en el objeto de entrada ('demanda_transf', …). Ver el banco
-- prueba-transferencia-pago.mjs, que aserta la línea en pg_get_
-- functiondef y el comportamiento de punta a punta.
-- =====================================================================

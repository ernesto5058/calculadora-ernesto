-- =====================================================================
-- BANCO TRANSACCIONAL — CORTE DE GASTO AL ASENTAR VENTAS (CHEQUEO 105)
-- ---------------------------------------------------------------------
-- Todo corre en BEGIN…ROLLBACK sobre la partición es_prueba=true:
-- producción no se toca. Prueba el helper dinero_acreditar_gasto_
-- venta (crédito, idempotencia, sin ganancia, tope por inversión) y
-- las dos puertas de venta (saldo y transferencia) acreditando el
-- corte al asentar. Uso: python3 /tmp/q.py < este archivo.
-- =====================================================================
begin;
create temp table banco_gasto_res (
  paso text, ok boolean, dato text) on commit drop;

do $$
declare
  v_admin text; v_r jsonb;
  v_g0 bigint; v_g bigint;
begin
  select valor into v_admin from public.admin_config
   where clave = 'codigo_admin';

  -- dinero_fondo es singleton (id=1): su es_prueba marca la
  -- partición activa; se voltea dentro de la transacción y el
  -- rollback lo restaura (patrón de la casa).
  update public.dinero_fondo
     set es_prueba = true, porciento_gasto_su_parte = 31.22
   where id = 1;

  v_g0 := public.dinero_saldo('gasto', true);
  perform public.dinero_mover('ernesto_inversion', 'semilla_banco',
    20000, 'efectivo', 'banco-gasto-2026-11-15', null, true);
  v_g := v_g0;

  -- G1 · crédito normal: 31,22 % de 10.000 = 3.122
  v_r := public.dinero_acreditar_gasto_venta('banco-venta-1', 10000, true);
  v_g := v_g + 3122;
  insert into banco_gasto_res
  select 'g1_credito', (v_r ->> 'acreditado')::bigint = 3122
           and public.dinero_saldo('gasto', true) = v_g, v_r::text;

  -- G2 · idempotente por referencia
  v_r := public.dinero_acreditar_gasto_venta('banco-venta-1', 10000, true);
  insert into banco_gasto_res
  select 'g2_idempotente',
           coalesce((v_r ->> 'ya_existia')::boolean, false)
           and public.dinero_saldo('gasto', true) = v_g, v_r::text;

  -- G3 · sin ganancia neta no acredita
  v_r := public.dinero_acreditar_gasto_venta('banco-venta-2', -500, true);
  insert into banco_gasto_res
  select 'g3_sin_ganancia', (v_r ->> 'acreditado')::bigint = 0
           and (v_r ->> 'motivo') = 'sin_ganancia_neta'
           and public.dinero_saldo('gasto', true) = v_g, v_r::text;

  -- G4 · la inversión topa el crédito y queda declarado (relativo:
  -- la partición de prueba puede traer saldo de otros bancos)
  declare v_disp bigint;
  begin
    v_disp := greatest(public.dinero_saldo('ernesto_inversion', true), 0);
    v_r := public.dinero_acreditar_gasto_venta(
      'banco-venta-3', 10000000, true);
    v_g := v_g + v_disp;
    insert into banco_gasto_res
    select 'g4_tope_inversion',
             (v_r ->> 'acreditado')::bigint = v_disp
             and (v_r ->> 'motivo') = 'inversion_insuficiente'
             and public.dinero_saldo('gasto', true) = v_g, v_r::text;
  end;

  perform public.dinero_mover('ernesto_inversion', 'semilla_banco',
    20000, 'efectivo', 'banco-gasto-2026-11-15', null, true);

  -- G5 · la puerta de venta de SALDO acredita al asentar
  -- (lote propio sin espera: premio 0; ganancia = 2,4×920 − 2.000
  -- = 208 → corte = floor(208 × 31,22 %) = 64)
  begin
    insert into public.dinero_lotes_saldo
      (cantidad_saldo, cantidad_restante, costo_total_cup,
       costo_restante_cup, tasa_efectiva, contraparte, es_prueba,
       costo_por_recarga, valor_real_acum)
    values (720, 720, 2000, 2000, 2.7778, 'BANCO-PROPIO', true,
            1000, 0);
    v_r := public.pago_registrar_venta_saldo(
      v_admin, 'banco-venta-saldo-1', 720, 300, 2.4, 'manual', true,
      'transferencia');
    v_g := v_g + 64;
    insert into banco_gasto_res
    select 'g5_puerta_saldo_acredita',
             (v_r ->> 'ok')::boolean
             and (v_r #>> '{gasto,acreditado}')::bigint = 64
             and public.dinero_saldo('gasto', true) = v_g, v_r::text;
  exception when others then
    insert into banco_gasto_res
    select 'g5_puerta_saldo_acredita', false, sqlerrm;
  end;

  -- G6 · la puerta de venta de TRANSFERENCIA acredita al asentar
  -- (ganancia = (5.750 − 5.000) − premio 187 = 563 → corte = 175)
  begin
    insert into public.pago_liquidaciones
      (vuelta_id, buscador_codigo, es_prueba, capital_cup,
       producto_cantidad, ref360_papel, pct_estrellas, ganancia_papel,
       estimado_papel, ref360_protegida, colchon_pct_aplicado,
       ganancia_protegida, fijo, tipo,
       valor_unit_papel, valor_unit_protegida)
    values (gen_random_uuid(), 'BRIKU-EUX', true, 5000, 5000, 1000, 25,
            0, 0, 1000, 5, 0, 0, 'transferencia', 1.0, 1.0);
    v_r := public.pago_registrar_venta_transferencia(
      v_admin, 'banco-venta-transf-1', 5000, 800, 6.25, 'manual',
      true, 'transferencia');
    v_g := v_g + 175;
    insert into banco_gasto_res
    select 'g6_puerta_transf_acredita',
             (v_r ->> 'ok')::boolean
             and (v_r #>> '{gasto,acreditado}')::bigint = 175
             and public.dinero_saldo('gasto', true) = v_g, v_r::text;
  exception when others then
    insert into banco_gasto_res
    select 'g6_puerta_transf_acredita', false, sqlerrm;
  end;
end $$;

select paso, ok, dato from banco_gasto_res order by paso;
rollback;

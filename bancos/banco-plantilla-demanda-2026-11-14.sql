-- BANCO TRANSACCIONAL — siembra de la plantilla + demanda en el
-- Asesor (2026-11-14). Todo corre dentro de BEGIN…ROLLBACK: las
-- mediciones sintéticas y las preparadas de prueba JAMÁS tocan
-- producción. La plantilla REAL sembrada (ETECSA·sell, sesión del
-- dueño) solo se LEE y se «mueve» dentro de la transacción.
begin;
create temp table banco_res(paso text, ok boolean, dato jsonb) on commit drop;

-- ============ CÁLCULO PURO: vectores de demanda ============
-- Base = el vector canónico del estudio (banco de la fase 1):
-- VENDER, Paciente a 303, vendible 9.412,08 → $31, FIFO +3.080.
create temp table bc_base on commit drop as
select $j${
  "ahora": "2026-11-13T17:00:00Z",
  "foto": {"usable": true, "senal": {"palabra": "VENDER"},
    "menu": {"peldanos": [
      {"nombre": "Inmediato", "tasa": 314, "g": 48.28, "zona": "automatica", "delanteUsd": 12, "bloqueado": false},
      {"nombre": "Equilibrado", "tasa": 315, "g": 45.71, "zona": "automatica", "delanteUsd": 30, "bloqueado": false},
      {"nombre": "Paciente", "tasa": 303, "g": 81.19, "zona": "automatica", "delanteUsd": 85, "bloqueado": false}]},
    "ejecutable20": {"tasa": 303, "usd": 40}, "duras": [], "transferencia": null},
  "tarifa": {"salida_ref": 910, "ingreso_ref360": 1079.81, "libro_ref": 1111.74},
  "costo_ref360": 1000,
  "posicion": {"linea_saldo": 9772.08, "linea_en": "2026-11-13T16:15:00Z",
    "lotes": [{"cantidad": 3000, "costo": 7800}, {"cantidad": 1440, "costo": 4000},
              {"cantidad": 1080, "costo": 3000}, {"cantidad": 360, "costo": 1000},
              {"cantidad": 360, "costo": 1000}, {"cantidad": 2262, "costo": 5655}],
    "comprometido_saldo": 0, "base_venta": true,
    "fondo": 10993, "reserva_cupos": 15000, "mejor_nivel20_hoy": null},
  "puerta": {"tope_oferta": 40, "monto_hoy": 0, "acciones_hora": 0,
    "preparada_viva": false, "detenidas": false, "pausadas": false},
  "cfg": {"colchon": 360, "mat_fifo": 300},
  "promo_puesto": {"activa": false, "ref_cierre": null}
}$j$::jsonb as p;

-- D0 · REGRESIÓN: sin bloque demanda, el cálculo es el de siempre
insert into banco_res
-- REPIN 2026-11-14 (tanda Puerta+Asesor, F2): los vectores d0/d1/
-- d4/d5 esperaban el monto del régimen viejo (31, receive 9.393);
-- con «la oferta nace del saldo» el pleno es 31,06 con receive
-- 9.412 y la ganancia FIFO 3.077 — el mismo vector verificado en
-- banco-recibe-saldo (caso C) y en prueba-guia-fase1.
select 'd0_regresion_sin_demanda',
       (r->'preparada'->>'monto_qusd')::numeric = 31.06
       and (r->'preparada'->>'ganancia_fifo')::numeric = 3077
       and jsonb_array_length(r->'preparada'->'porques') = 3
       and (r->'demanda'->>'aplicada')::boolean = false,
       jsonb_build_object('prep', r->'preparada', 'dem', r->'demanda')
  from bc_base, lateral (select public.guia_calc_asesor(p) as r) s;

-- D1 · Demanda usable, tope holgado (50): prepara igual + 4.º porqué
insert into banco_res
select 'd1_demanda_no_ata',
       (r->'preparada'->>'monto_qusd')::numeric = 31.06
       and jsonb_array_length(r->'preparada'->'porques') = 4
       and (r->'preparada'->'porques'->>3) like 'Demanda normal:%'
       and (r->'preparada'->'demanda'->>'topado')::boolean = false
       and (r->'preparada'->'demanda'->>'tope_usd')::numeric = 50,
       jsonb_build_object('porque4', r->'preparada'->'porques'->>3,
                          'dem', r->'preparada'->'demanda')
  from bc_base, lateral (select public.guia_calc_asesor(
    p || '{"demanda": {"usable": true, "declaracion": "aplicada",
      "termometro": "normal", "salida_cima_usd_h": 25,
      "vida_cima_min": 12, "tope_usd": 50}}'::jsonb) as r) s;

-- D2 · Demanda usable, tope 20 ata: monto 20, topado y porqué lo dice
insert into banco_res
select 'd2_demanda_topa_20',
       (r->'preparada'->>'monto_qusd')::numeric = 20
       and (r->'preparada'->'demanda'->>'topado')::boolean = true
       and (r->'preparada'->'porques'->>3) like '%se topó%',
       jsonb_build_object('prep', r->'preparada')
  from bc_base, lateral (select public.guia_calc_asesor(
    p || '{"demanda": {"usable": true, "declaracion": "aplicada",
      "termometro": "alta", "salida_cima_usd_h": 10,
      "vida_cima_min": 30, "tope_usd": 20}}'::jsonb) as r) s;

-- D3 · Absorción medida en cero: motivo honesto, no se prepara
insert into banco_res
select 'd3_sin_absorcion',
       r->'preparada' = 'null'::jsonb
       and (r->'motivos_no_prepara') @> '["demanda_sin_absorcion"]'::jsonb,
       jsonb_build_object('motivos', r->'motivos_no_prepara')
  from bc_base, lateral (select public.guia_calc_asesor(
    p || '{"demanda": {"usable": true, "declaracion": "aplicada",
      "termometro": "fria", "salida_cima_usd_h": 0,
      "vida_cima_min": 240, "tope_usd": 0}}'::jsonb) as r) s;

-- D4 · Medición vieja: se declara y NO topa (prepara como siempre)
insert into banco_res
select 'd4_medicion_vieja_no_topa',
       (r->'preparada'->>'monto_qusd')::numeric = 31.06
       and jsonb_array_length(r->'preparada'->'porques') = 3
       and (r->'demanda'->>'declaracion') = 'medicion_vieja'
       and (r->'demanda'->>'aplicada')::boolean = false,
       jsonb_build_object('dem', r->'demanda')
  from bc_base, lateral (select public.guia_calc_asesor(
    p || '{"demanda": {"usable": false, "declaracion": "medicion_vieja",
      "termometro": "normal", "salida_cima_usd_h": 0,
      "vida_cima_min": 240, "tope_usd": null}}'::jsonb) as r) s;

-- D5 · Señal ausente: se declara y NO topa
insert into banco_res
select 'd5_senal_ausente_no_topa',
       (r->'preparada'->>'monto_qusd')::numeric = 31.06
       and (r->'demanda'->>'declaracion') = 'senal_ausente',
       jsonb_build_object('dem', r->'demanda')
  from bc_base, lateral (select public.guia_calc_asesor(
    p || '{"demanda": {"usable": false, "declaracion": "senal_ausente",
      "termometro": "sin_datos", "salida_cima_usd_h": null,
      "vida_cima_min": null, "tope_usd": null}}'::jsonb) as r) s;

-- ============ PIPELINE: la plantilla real + mediciones sintéticas ============
-- P1 · La base nace de la plantilla sembrada (objeto, ETECSA·sell)
insert into banco_res
select 'p1_base_plantilla_objeto',
       (r->'base'->>'fuente') = 'plantilla'
       and (r->'base'->'plantilla'->>'moneda') = 'ETECSA'
       and not ((r->'calculo'->'motivos_no_prepara') @> '["sin_oferta_base"]'::jsonb),
       jsonb_build_object('base', r->'base',
                          'motivos', r->'calculo'->'motivos_no_prepara')
  from (select public.guia_asesor_interno(false) as r) s;

-- P2 · Otra moneda NO sirve de base (la plantilla es por par)
update public.guia_plantilla set moneda = 'CLASICA' where id = 1;
insert into banco_res
select 'p2_moneda_equivocada_no_es_base',
       (r->'base'->>'fuente') is null
       and ((r->'calculo'->'motivos_no_prepara') @> '["sin_oferta_base"]'::jsonb),
       jsonb_build_object('base', r->'base',
                          'motivos', r->'calculo'->'motivos_no_prepara')
  from (select public.guia_asesor_interno(false) as r) s;
update public.guia_plantilla set moneda = 'ETECSA' where id = 1;

-- La demanda real se aparta dentro de la transacción (vuelve con el
-- rollback) pa que el interno lea SOLO la medición sintética de turno.
delete from public.demanda_mediciones where moneda = 'ETECSA';

-- P3 · Medición VIEJA: prepara sin tope, con la declaración en el snapshot
-- La preparada VIVA real se aparta SOLO dentro de la transacción
-- (el rollback la devuelve intacta): es el primer preparar del
-- banco y sin esto corta por «ya_hay_preparada» (pasó el
-- 2026-11-14 con la preparada real de las 17:30 UTC).
update public.mercado_acciones
   set estado = 'expirada', expira_en = now() - interval '1 minute'
 where origen = 'asesor' and estado = 'preparada';
insert into public.demanda_mediciones
  (medida_en, moneda, termometro, salida_cima_usd_h, vida_cima_min)
values (now() - interval '30 minutes', 'ETECSA', 'normal', 50, 5);
select public.guia_preparar_interna(true);
insert into banco_res
select 'p3_vieja_prepara_sin_tope',
       count(*) = 1 and bool_and(contexto->>'base_fuente' = 'plantilla')
       and bool_and(contexto->'demanda'->>'declaracion' = 'medicion_vieja')
       and bool_and(jsonb_array_length(contexto->'porques') = 3),
       jsonb_agg(jsonb_build_object('monto', monto_qusd, 'tasa', tasa,
         'ctx_dem', contexto->'demanda'))
  from public.mercado_acciones
 where origen = 'asesor' and estado = 'preparada';
update public.mercado_acciones set estado = 'vencida'
 where origen = 'asesor' and estado = 'preparada';
delete from public.demanda_mediciones where moneda = 'ETECSA';

-- P4 · Medición FRESCA con absorción (25 USD/h → tope 50): nace con
-- el 4.º porqué de demanda en el snapshot
insert into public.demanda_mediciones
  (medida_en, moneda, termometro, salida_cima_usd_h, vida_cima_min)
values (now(), 'ETECSA', 'normal', 25, 5);
select public.guia_preparar_interna(true);
insert into banco_res
select 'p4_fresca_con_demanda',
       count(*) = 1 and bool_and(contexto->>'base_fuente' = 'plantilla')
       and bool_and((contexto->'demanda'->>'tope_usd')::numeric = 50)
       and bool_and(jsonb_array_length(contexto->'porques') = 4)
       and bool_and((contexto->'porques'->>3) like 'Demanda normal:%'),
       jsonb_agg(jsonb_build_object('monto', monto_qusd, 'tasa', tasa,
         'porque4', contexto->'porques'->>3, 'ctx_dem', contexto->'demanda'))
  from public.mercado_acciones
 where origen = 'asesor' and estado = 'preparada';
update public.mercado_acciones set estado = 'vencida'
 where origen = 'asesor' and estado = 'preparada';
delete from public.demanda_mediciones where moneda = 'ETECSA';

-- P5 · Medición FRESCA con absorción CERO: el ciclo no pare nada y
-- declara el motivo honesto
insert into public.demanda_mediciones
  (medida_en, moneda, termometro, salida_cima_usd_h, vida_cima_min)
values (now(), 'ETECSA', 'fria', 0, 240);
insert into banco_res
select 'p5_cero_no_prepara',
       (p->>'preparada') is null
       and (p->'motivos') @> '["demanda_sin_absorcion"]'::jsonb
       and not exists (select 1 from public.mercado_acciones
                        where origen = 'asesor' and estado = 'preparada'
                          and expira_en > now()),
       p
  from (select public.guia_preparar_interna(true) as p) s;
delete from public.demanda_mediciones where moneda = 'ETECSA';

-- P6 · Tope chico (5 USD/h → 10 USD): la preparada nace topada en 10
insert into public.demanda_mediciones
  (medida_en, moneda, termometro, salida_cima_usd_h, vida_cima_min)
values (now(), 'ETECSA', 'normal', 5, 5);
select public.guia_preparar_interna(true);
insert into banco_res
select 'p6_tope_10_en_vivo',
       count(*) = 1 and bool_and(monto_qusd = 10)
       and bool_and((contexto->'demanda'->>'topado')::boolean),
       jsonb_agg(jsonb_build_object('monto', monto_qusd, 'tasa', tasa,
         'ctx_dem', contexto->'demanda'))
  from public.mercado_acciones
 where origen = 'asesor' and estado = 'preparada';
delete from public.demanda_mediciones where moneda = 'ETECSA';

select paso, ok, dato from banco_res order by paso;
rollback;
-- Residuo cero: la plantilla real intacta, sin preparadas del banco,
-- las mediciones reales de vuelta
select (select count(*) from public.guia_plantilla
         where moneda = 'ETECSA' and tipo = 'sell'
           and oferta_uuid = '9d875807-dbb9-4384-b95e-72dc52d5914e') as siembra_real,
       (select count(*) from public.mercado_acciones
         where origen = 'asesor' and estado = 'preparada') as preparadas_vivas,
       (select count(*) from public.demanda_mediciones
         where moneda = 'ETECSA') as mediciones_etecsa;

-- BANCO TRANSACCIONAL — TASA DE CALLE EN LOS REGISTROS + COLCHÓN POR
-- PEAJE DE ENVÍOS (2026-11-14). Todo corre dentro de BEGIN…ROLLBACK:
-- el carril es_prueba queda prístino y la tarifa/config tocadas se
-- restauran solas. Reproduce el caso real de Ernesto: 3.000 de saldo
-- a 2,6 = 7.800 en efectivo, llegada 2.995 por 1 envío.
begin;
create temp table banco_res(paso text, ok boolean, dato jsonb) on commit drop;
create temp table bx(k text primary key, v uuid) on commit drop;
create temp table bx_admin(v text) on commit drop;
insert into bx_admin select valor from public.admin_config where clave = 'codigo_admin';

-- Carril de prueba prístino (el rollback lo restaura todo igual).
delete from public.pago_premio_detalle
 where liquidacion_id in (select id from public.pago_liquidaciones where es_prueba);
delete from public.pago_liquidaciones where es_prueba;
delete from public.pago_ventas_saldo where es_prueba;
delete from public.dinero_devoluciones where es_prueba;
delete from public.dinero_vueltas where es_prueba;
delete from public.pago_eventos where es_prueba;
delete from public.sms_eventos where es_prueba;
delete from public.dinero_esperas_log where es_prueba;
delete from public.dinero_esperas where es_prueba;
delete from public.dinero_lotes_cierres where es_prueba;
delete from public.dinero_lotes_saldo where es_prueba;
delete from public.dinero_entregas where es_prueba;
delete from public.guia_sugerencias where es_prueba;

-- Fixtures: tarifa de papel 1.080 (equilibrio) · salida 910 ·
-- régimen de prueba activo con colchón 5 % → techo 1.026 / 2,85.
update public.tarifa set ingreso_ref360 = 1080, salida_ref = 910 where id = 1;
update public.pago_proteccion_config
   set activo = true, activo_desde = now() - interval '1 hour',
       colchon_pct = 5, colchon_origen = 'banco'
 where es_prueba;
insert into public.dinero_estrellas
  (buscador_codigo, estrellas, conteo_ganadoras, fijada_manual, es_prueba)
values ('BRIKU-EUX', 4.9, 75, true, true)
on conflict (buscador_codigo, es_prueba) do update
  set estrellas = 4.9, conteo_ganadoras = 75, fijada_manual = true;
with i as (
  insert into public.dinero_entregas
    (buscador_codigo, monto_original, monto_pendiente, bolsillo,
     estado, entregado_en, detalle, es_prueba)
  values ('BRIKU-EUX', 60000, 60000, 'efectivo', 'en_calle', now(),
          'BANCO-TASA-CALLE', true)
  returning id)
insert into bx select 'entrega', id from i;

-- ═══ T1 · EL CASO REAL: 3.000 a 2,6 = 7.800 · llegada 2.995 (1 envío)
with r as (select public.espera_crear_operada_tasa(
  'BRIKU-EUX', 'saldo', 3000, 7800, null, 48, true, 2.6, 7800, 1) as j)
insert into bx select 'esp1', (j ->> 'espera_id')::uuid from r;
insert into banco_res
select 'T1a la espera con tasa nace ok',
  exists (select 1 from bx where k = 'esp1'), '{}'::jsonb;

with r as (select public.espera_match_saldo(null, 2995, now(), true) as j)
insert into banco_res
select 'T1b el match asienta con la llegada 2.995',
  j ->> 'resultado' = 'asentado', j from r;

insert into banco_res
select 'T1c espera: peaje 5 · falta 0 · tasa 2,6 · total 7.800 · cumplida',
  e.peaje_etecsa = 5 and e.falta_real = 0 and e.tasa_pactada = 2.6
    and e.total_pagado_cup = 7800 and e.estado = 'cumplida'
    and (e.datos ->> 'llegada') = 'completa',
  jsonb_build_object('peaje', e.peaje_etecsa, 'falta', e.falta_real,
    'tasa_pactada', e.tasa_pactada, 'total', e.total_pagado_cup)
  from public.dinero_esperas e join bx on bx.k = 'esp1' and bx.v = e.id;

insert into banco_res
select 'T1d lote: efectiva 2,6043 · costo/recarga 937,55 · VERDE · margen 88,45 · ahorro 735,87',
  l.tasa_efectiva = 2.6043 and l.costo_por_recarga = 937.55
    and l.semaforo_compra = 'verde' and l.margen_recarga_nacer = 88.45
    and l.ahorro_compra_cup = 735.87 and l.techo_tasa_dia = 2.85
    and l.equilibrio_recarga_dia = 1080
    and l.cantidad_saldo = 2995 and l.costo_total_cup = 7800,
  jsonb_build_object('efectiva', l.tasa_efectiva, 'cpr', l.costo_por_recarga,
    'semaforo', l.semaforo_compra, 'margen', l.margen_recarga_nacer,
    'ahorro', l.ahorro_compra_cup, 'techo', l.techo_tasa_dia)
  from public.dinero_esperas e join bx on bx.k = 'esp1' and bx.v = e.id
  join public.dinero_lotes_saldo l on l.id = e.lote_id;

-- Al nacer, la foto trae fijo/estimado; la atribución de la compra
-- se completa al cerrarse la venta (el lote nace al final del
-- asiento, DESPUÉS de la foto): se verifica en T1j, tras la venta.
insert into banco_res
select 'T1e liquidación al nacer: fijo 235 ≤ estimado 379',
  q.fijo = 235 and q.estimado_papel = 379,
  jsonb_build_object('fijo', q.fijo, 'estimado', q.estimado_papel)
  from public.dinero_esperas e join bx on bx.k = 'esp1' and bx.v = e.id
  join public.pago_liquidaciones q
    on q.vuelta_id = (e.vuelta_ids ->> 0)::uuid;

-- La venta real del lote completo a 280 (ingreso real 1.170/recarga).
with r as (select public.pago_registrar_venta_saldo(
  (select v from bx_admin), 'BANCO-TC-V1', 2995, 280, 10.6964,
  'banco', true, 'transferencia') as j)
insert into banco_res
select 'T1f venta: premio 383 = 32% del extra de VENTA (el ahorro NO se suma)',
  (j ->> 'ok')::boolean and (j ->> 'ingreso_real360')::numeric = 1170
    and (j ->> 'premio_total')::bigint = 383, j from r;

insert into banco_res
select 'T1g lote cerrado: valor real 9.733,75 · margen verdadero 232,44/recarga',
  l.cantidad_restante = 0 and l.cerrado_en is not null
    and l.valor_real_acum = 9733.75 and l.margen_real_recarga = 232.44,
  jsonb_build_object('valor_real', l.valor_real_acum,
    'margen_real', l.margen_real_recarga)
  from public.dinero_esperas e join bx on bx.k = 'esp1' and bx.v = e.id
  join public.dinero_lotes_saldo l on l.id = e.lote_id;

insert into banco_res
select 'T1h el cierre quedó en el historial (venta_registrada)',
  exists (select 1 from public.dinero_lotes_cierres c
           where c.lote_id = e.lote_id
             and c.fuente_cierre = 'venta_registrada'
             and c.margen_real_recarga = 232.44),
  '{}'::jsonb
  from public.dinero_esperas e join bx on bx.k = 'esp1' and bx.v = e.id;

insert into banco_res
select 'T1i la serie de márgenes alimenta: n=1 · promedio 232,44',
  (s ->> 'n_cerrados')::int = 1
    and (s ->> 'margen_promedio_recarga')::numeric = 232.44, s
  from (select public.pago_serie_margenes_lotes(true) as s) z;

insert into banco_res
select 'T1j tras la venta, la liquidación muestra la compra: 2,6043 / techo 2,85 / ahorro 735,87',
  q.tasa_efectiva_compra = 2.6043 and q.techo_tasa_compra = 2.85
    and q.ahorro_compra_cup = 735.87,
  jsonb_build_object('efectiva', q.tasa_efectiva_compra,
    'techo', q.techo_tasa_compra, 'ahorro', q.ahorro_compra_cup)
  from public.dinero_esperas e join bx on bx.k = 'esp1' and bx.v = e.id
  join public.pago_liquidaciones q
    on q.vuelta_id = (e.vuelta_ids ->> 0)::uuid;

-- ═══ T2 · FALTA REAL: llegada 2.800 (diferencia 200 > peaje 5) ═══
with r as (select public.espera_crear_operada_tasa(
  'BRIKU-EUX', 'saldo', 3000, 7800, null, 48, true, 2.6, 7800, 1) as j)
insert into bx select 'esp2', (j ->> 'espera_id')::uuid from r;

with r as (select public.espera_match_saldo(null, 2800, now(), true) as j)
insert into banco_res
select 'T2a la llegada 2.800 NO se asienta sola (200 > peaje)',
  j ->> 'resultado' = 'sin_match', j from r;

with r as (select public.espera_asentar_interna(
  (select v from bx where k = 'esp2'), 2800, null, null) as j)
insert into banco_res
select 'T2b Ernesto arbitra y asienta', (j ->> 'ok')::boolean, j from r;

insert into banco_res
select 'T2c peaje 5 · FALTA REAL 195 (200 − 5 del peaje)',
  e.peaje_etecsa = 5 and e.falta_real = 195
    and (e.datos ->> 'llegada') = 'falta_real',
  jsonb_build_object('peaje', e.peaje_etecsa, 'falta', e.falta_real)
  from public.dinero_esperas e join bx on bx.k = 'esp2' and bx.v = e.id;

insert into banco_res
select 'T2d la falta real sale en las alarmas pa arbitraje',
  exists (select 1 from public.dinero_esperas_avisos a
           where a.clase_alarma = 'espera_falta_real'
             and a.ref_id = (select v::text from bx where k = 'esp2')),
  '{}'::jsonb;

-- ═══ T3 · ENVÍOS DECLARADOS: 3 envíos → peaje 15 ═══
with r as (select public.espera_crear_operada_tasa(
  'BRIKU-EUX', 'saldo', 3000, 7800, null, 48, true, 2.6, 7800, 3) as j)
insert into bx select 'esp3', (j ->> 'espera_id')::uuid from r;

with r as (select public.espera_match_saldo(null, 2985, now(), true) as j)
insert into banco_res
select 'T3a con 3 envíos declarados, la llegada 2.985 SÍ asienta (15 = 3×5)',
  j ->> 'resultado' = 'asentado', j from r;

insert into banco_res
select 'T3b peaje 15 · falta 0',
  e.peaje_etecsa = 15 and e.falta_real = 0,
  jsonb_build_object('peaje', e.peaje_etecsa, 'falta', e.falta_real)
  from public.dinero_esperas e join bx on bx.k = 'esp3' and bx.v = e.id;

-- ═══ T4 · FLUJO VIEJO SIN TASA: todo sigue intacto ═══
with r as (select public.espera_crear_interna(
  'BRIKU-EUX', 'saldo', 3000, 7800, 'operado_ernesto',
  null, null, 48, true) as j)
insert into bx select 'esp4', (j ->> 'espera_id')::uuid from r;

with r as (select public.espera_match_saldo(null, 2995, now(), true) as j)
insert into banco_res
select 'T4a el parte sin tasa asienta como siempre',
  j ->> 'resultado' = 'asentado', j from r;

insert into banco_res
select 'T4b sin tasa pactada, el lote igual nace con su costo por recarga',
  e.tasa_pactada is null and e.peaje_etecsa = 5 and e.falta_real = 0
    and l.tasa_efectiva = 2.6043 and l.costo_por_recarga = 937.55
    and l.semaforo_compra = 'verde',
  jsonb_build_object('efectiva', l.tasa_efectiva, 'cpr', l.costo_por_recarga)
  from public.dinero_esperas e join bx on bx.k = 'esp4' and bx.v = e.id
  join public.dinero_lotes_saldo l on l.id = e.lote_id;

-- ═══ T5 · EL PARTE (reporte): la espera nace con la tasa del parte ═══
with i as (
  insert into public.reportes
    (buscador, tipo, precio, cantidad, telefono_vendedor, prueba)
  values ('BRIKU-EUX', 'saldo', 936, 8, '5551234', true)
  returning id)
insert into bx select 'rep1', id from i;

insert into banco_res
select 'T5 la espera del reporte trae tasa 2,6 (936/360) y total 7.488',
  e.tasa_pactada = 2.6 and e.total_pagado_cup = 7488
    and e.cantidad_esperada = 2880 and e.capital_cup = 7488,
  jsonb_build_object('tasa', e.tasa_pactada, 'total', e.total_pagado_cup)
  from public.dinero_esperas e
  join bx on bx.k = 'rep1' and bx.v = e.reporte_id;

-- ═══ T6 · TECHO DEL DÍA Y FRONTERA DEL BUSCADOR ═══
insert into banco_res
select 'T6a techo (fixture): tasa 2,85 · recarga 1.026 · equilibrio 1.080',
  (t ->> 'techo_tasa')::numeric = 2.85
    and (t ->> 'techo_recarga')::numeric = 1026
    and (t ->> 'equilibrio_recarga')::numeric = 1080, t
  from (select public.tarifa_techo_calle(true) as t) z;

with r as (select public.guia_buscador('BRIKU-EUX', true) as j)
insert into banco_res
select 'T6b el buscador ve SOLO su techo: 2 claves, sin salida ni colchón',
  j -> 'techo_calle' = jsonb_build_object('tasa_unidad', 2.85,
                                          'por_recarga', 1026)
    and not (j::text like '%salida%') and not (j::text like '%colchon%'),
  j -> 'techo_calle' from r;

with r as (select public.pago_mi_estado('BRIKU-EUX', true) as j)
insert into banco_res
select 'T6c el estado del buscador no filtra ahorro ni techo de compra',
  not (j::text like '%ahorro%') and not (j::text like '%techo%'), j from r;

-- ═══ T7 · EL COLCHÓN DEL ASESOR: peaje × envíos ═══
with c as (select public.guia_calc_asesor($j${
  "ahora": "2026-11-14T07:00:00Z",
  "foto": {"usable": false, "senal": {"palabra": "APROVECHAR"},
    "menu": {"peldanos": []}, "ejecutable20": {"tasa": null, "usd": null},
    "duras": [], "transferencia": null},
  "tarifa": {"salida_ref": 910, "ingreso_ref360": 1079.81, "libro_ref": 1111.74},
  "costo_ref360": 1000,
  "posicion": {"linea_saldo": 9772.08, "linea_en": "2026-11-14T05:15:00Z",
    "lotes": [], "comprometido_saldo": 0, "base_venta": false,
    "fondo": 0, "reserva_cupos": 0, "mejor_nivel20_hoy": null},
  "puerta": {"tope_oferta": 40, "monto_hoy": 0, "acciones_hora": 0,
    "preparada_viva": false, "detenidas": false, "pausadas": false},
  "cfg": {"peaje_envio": 5, "tope_receptor_envio": 500000, "mat_fifo": 300},
  "promo_puesto": {"activa": false, "ref_cierre": null}
}$j$::jsonb) as j)
insert into banco_res
select 'T7a colchón por envíos: 5 · vendible 9.767,08 (antes 9.412,08)',
  (j -> 'posicion' ->> 'vendible')::numeric = 9767.08
    and (j -> 'posicion' ->> 'colchon')::numeric = 5
    and (j -> 'posicion' -> 'colchon_detalle' ->> 'envios')::int = 1
    and (j -> 'posicion' -> 'colchon_detalle' ->> 'modo') = 'peaje_por_envios',
  j -> 'posicion' from c;

with c as (select public.guia_calc_asesor($j${
  "ahora": "2026-11-14T07:00:00Z",
  "foto": {"usable": false, "senal": {"palabra": "APROVECHAR"},
    "menu": {"peldanos": []}, "ejecutable20": {"tasa": null, "usd": null},
    "duras": [], "transferencia": null},
  "tarifa": {"salida_ref": 910, "ingreso_ref360": 1079.81, "libro_ref": 1111.74},
  "costo_ref360": 1000,
  "posicion": {"linea_saldo": 9772.08, "linea_en": "2026-11-14T05:15:00Z",
    "lotes": [], "comprometido_saldo": 0, "base_venta": false,
    "fondo": 0, "reserva_cupos": 0, "mejor_nivel20_hoy": null},
  "puerta": {"tope_oferta": 40, "monto_hoy": 0, "acciones_hora": 0,
    "preparada_viva": false, "detenidas": false, "pausadas": false},
  "cfg": {"colchon": 360, "mat_fifo": 300},
  "promo_puesto": {"activa": false, "ref_cierre": null}
}$j$::jsonb) as j)
insert into banco_res
select 'T7b sin peaje en el cfg manda el fijo legado 360 (bancos viejos intactos)',
  (j -> 'posicion' ->> 'vendible')::numeric = 9412.08
    and (j -> 'posicion' ->> 'colchon')::numeric = 360
    and (j -> 'posicion' -> 'colchon_detalle' ->> 'modo') = 'fijo_legado',
  j -> 'posicion' from c;

with c as (select public.guia_calc_asesor($j${
  "ahora": "2026-11-14T07:00:00Z",
  "foto": {"usable": false, "senal": {"palabra": "APROVECHAR"},
    "menu": {"peldanos": []}, "ejecutable20": {"tasa": null, "usd": null},
    "duras": [], "transferencia": null},
  "tarifa": {"salida_ref": 910, "ingreso_ref360": 1079.81, "libro_ref": 1111.74},
  "costo_ref360": 1000,
  "posicion": {"linea_saldo": 1200000, "linea_en": "2026-11-14T05:15:00Z",
    "lotes": [], "comprometido_saldo": 0, "base_venta": false,
    "fondo": 0, "reserva_cupos": 0, "mejor_nivel20_hoy": null},
  "puerta": {"tope_oferta": 40, "monto_hoy": 0, "acciones_hora": 0,
    "preparada_viva": false, "detenidas": false, "pausadas": false},
  "cfg": {"peaje_envio": 5, "tope_receptor_envio": 500000, "mat_fifo": 300},
  "promo_puesto": {"activa": false, "ref_cierre": null}
}$j$::jsonb) as j)
insert into banco_res
select 'T7c posición de 1.200.000 → 3 envíos → colchón 15',
  (j -> 'posicion' ->> 'colchon')::numeric = 15
    and (j -> 'posicion' -> 'colchon_detalle' ->> 'envios')::int = 3
    and (j -> 'posicion' ->> 'vendible')::numeric = 1199985,
  j -> 'posicion' from c;

-- ═══ T8 · EL SEMÁFORO EN SUS TRES COLORES ═══
with i as (
  insert into public.dinero_lotes_saldo
    (cantidad_saldo, cantidad_restante, costo_total_cup,
     costo_restante_cup, tasa_efectiva, contraparte, es_prueba)
  values (360, 360, 1050, 1050, 2.9167, 'BANCO-TC', true)
  returning id)
insert into bx select 'loteAmarillo', id from i;

insert into banco_res
select 'T8a costo 1.050,01 entre techo y equilibrio → AMARILLO · margen −24,01',
  l.semaforo_compra = 'amarillo' and l.costo_por_recarga = 1050.01
    and l.margen_recarga_nacer = -24.01,
  jsonb_build_object('sem', l.semaforo_compra, 'cpr', l.costo_por_recarga,
    'margen', l.margen_recarga_nacer)
  from public.dinero_lotes_saldo l
  join bx on bx.k = 'loteAmarillo' and bx.v = l.id;

with i as (
  insert into public.dinero_lotes_saldo
    (cantidad_saldo, cantidad_restante, costo_total_cup,
     costo_restante_cup, tasa_efectiva, contraparte, es_prueba)
  values (360, 360, 1100, 1100, 3.0556, 'BANCO-TC', true)
  returning id)
insert into bx select 'loteRojo', id from i;

insert into banco_res
select 'T8b costo 1.100,02 sobre el equilibrio → ROJO · margen −74,02',
  l.semaforo_compra = 'rojo' and l.costo_por_recarga = 1100.02
    and l.margen_recarga_nacer = -74.02,
  jsonb_build_object('sem', l.semaforo_compra, 'cpr', l.costo_por_recarga,
    'margen', l.margen_recarga_nacer)
  from public.dinero_lotes_saldo l
  join bx on bx.k = 'loteRojo' and bx.v = l.id;

-- ═══ T9 · EL DUEÑO LO VE TODO JUNTO ═══
with r as (select public.pago_estado_dueno((select v from bx_admin)) as j)
insert into banco_res
select 'T9 dueño: compra atribuida en la liquidación + cierres de lotes',
  exists (select 1 from jsonb_array_elements(j -> 'liquidaciones') q
           where (q -> 'compra' ->> 'ahorro_compra_cup')::numeric = 735.87
             and (q -> 'compra' ->> 'tasa_efectiva')::numeric = 2.6043)
    and (j -> 'cierres_lotes' ->> 'n_cerrados')::int >= 1,
  j -> 'cierres_lotes' from r;

select jsonb_build_object(
  'pass', (select count(*) filter (where ok) from banco_res),
  'fail', (select count(*) filter (where not ok) from banco_res),
  'total', (select count(*) from banco_res),
  'fallos', (select coalesce(jsonb_agg(jsonb_build_object(
      'paso', paso, 'dato', dato) order by paso), '[]'::jsonb)
    from banco_res where not ok)) as resultado;
rollback;

-- BANCO TRANSACCIONAL — la oferta nace DEL SALDO (2026-11-14).
-- Lección de Ernesto tras montar su oferta a mano: «vende todo el
-- saldo» = Enviar es el vendible exacto y el QUSD cae solo (él tecleó
-- 15.545 ETECSA → $49,74, tasa efectiva 312,5251). Antes el sistema
-- derivaba receive = monto × tasa y el saldo quedaba de residuo
-- (232 con el floor de QUSD enteros; 1,33 tras el round).
-- Todo corre dentro de BEGIN…ROLLBACK: nada toca producción.
begin;
create temp table banco_res(paso text, ok boolean, dato jsonb) on commit drop;

-- ============ CASO A · EL DE ERNESTO HOY (barrido completo) =======
-- línea 15.550,08 · peaje 5 × 1 envío → vendible 15.545,08 · tasa
-- del peldaño 312,5 · tope de puerta 50 → monto pleno 49,74.
create temp table ba_p on commit drop as
select $j${
  "ahora": "2026-11-14T17:20:00Z",
  "foto": {"usable": true, "senal": {"palabra": "APROVECHAR"},
    "menu": {"peldanos": [
      {"nombre": "Inmediato", "tasa": 313.28, "g": 45.72, "zona": "automatica", "delanteUsd": 4, "bloqueado": false},
      {"nombre": "Equilibrado", "tasa": 312.5, "g": 48.32, "zona": "automatica", "delanteUsd": 32, "bloqueado": false},
      {"nombre": "Paciente", "tasa": 306, "g": 66.67, "zona": "automatica", "delanteUsd": 85, "bloqueado": false}]},
    "ejecutable20": {"tasa": 306, "usd": 50},
    "duras": [{"lado": "compra"}], "transferencia": null},
  "tarifa": {"salida_ref": 910, "ingreso_ref360": 1079.81, "libro_ref": 1111.74},
  "costo_ref360": 1000,
  "posicion": {"linea_saldo": 15550.08, "linea_en": "2026-11-14T16:15:00Z",
    "lotes": [{"cantidad": 3000, "costo": 7800}, {"cantidad": 1440, "costo": 4000},
              {"cantidad": 1080, "costo": 3000}, {"cantidad": 360, "costo": 1000},
              {"cantidad": 360, "costo": 1000}, {"cantidad": 2262, "costo": 5655},
              {"cantidad": 3000, "costo": 7500}, {"cantidad": 2780, "costo": 6950}],
    "comprometido_saldo": 0, "base_venta": true,
    "fondo": 10993, "reserva_cupos": 15000, "mejor_nivel20_hoy": null},
  "puerta": {"tope_oferta": 50, "monto_hoy": 0, "acciones_hora": 0,
    "preparada_viva": false, "detenidas": false, "pausadas": false},
  "cfg": {"peaje_envio": 5, "tope_receptor_envio": 500000, "mat_fifo": 300},
  "promo_puesto": {"activa": false, "ref_cierre": null}
}$j$::jsonb as p;

insert into banco_res
select 'A1 vendible = línea − peaje', (r #>> '{posicion,vendible}')::numeric = 15545.08, r
  from public.guia_calc_asesor((select p from ba_p)) r;
insert into banco_res
select 'A2 monto = round(vendible/tasa,2)', (r #>> '{preparada,monto_qusd}')::numeric = 49.74, r
  from public.guia_calc_asesor((select p from ba_p)) r;
insert into banco_res
select 'A3 receive = vendible ENTERO (15.545, no 15.543,75)',
       (r #>> '{preparada,receive}')::numeric = 15545, r
  from public.guia_calc_asesor((select p from ba_p)) r;
insert into banco_res
select 'A4 tasa_efectiva = receive/monto (312,5251, la de su oferta manual)',
       (r #>> '{preparada,tasa_efectiva}')::numeric = 312.5251, r
  from public.guia_calc_asesor((select p from ba_p)) r;
insert into banco_res
select 'A5 recibe_del_saldo = true',
       (r #>> '{preparada,recibe_del_saldo}')::boolean = true, r
  from public.guia_calc_asesor((select p from ba_p)) r;
insert into banco_res
select 'A6 FIFO cuadra: con_lote + sin_lote = receive',
       (r #>> '{preparada,fifo,con_lote}')::numeric
         + (r #>> '{preparada,fifo,sin_lote}')::numeric = 15545, r
  from public.guia_calc_asesor((select p from ba_p)) r;

-- ============ CASO B · monto topado por demanda = venta parcial ====
-- La misma posición, pero la banda 310 solo absorbe 10 USD/h × 2 h:
-- el monto cae a 20 y el receive vuelve a monto × tasa (el resto del
-- saldo se queda en la línea, declarado: recibe_del_saldo = false).
create temp table bb_p on commit drop as
select p || $j${
  "demanda": {"usable": true, "declaracion": "aplicada", "modo": "banda",
    "banda_tasa": 5, "ventana_min": 120, "tope_usd": 100000,
    "termometro": "normal", "salida_cima_usd_h": 0,
    "bandas": [
      {"banda": 310, "lado": "venta", "salida_usd_h": 10, "vida_min": 30, "vida_censurada": false},
      {"banda": 315, "lado": "venta", "salida_usd_h": 400, "vida_min": 30, "vida_censurada": false}]}
}$j$::jsonb as p from ba_p;

insert into banco_res
select 'B1 monto topado por su banda (20)', (r #>> '{preparada,monto_qusd}')::numeric = 20, r
  from public.guia_calc_asesor((select p from bb_p)) r;
insert into banco_res
select 'B2 receive parcial = monto × tasa (6.250)',
       (r #>> '{preparada,receive}')::numeric = 6250, r
  from public.guia_calc_asesor((select p from bb_p)) r;
insert into banco_res
select 'B3 recibe_del_saldo = false (declarado)',
       (r #>> '{preparada,recibe_del_saldo}')::boolean = false, r
  from public.guia_calc_asesor((select p from bb_p)) r;
insert into banco_res
select 'B4 tasa_efectiva = la nominal (312,5)',
       (r #>> '{preparada,tasa_efectiva}')::numeric = 312.5, r
  from public.guia_calc_asesor((select p from bb_p)) r;

-- ============ CASO C · el vector de fase 1 con la regla nueva ======
-- vendible 9.412,08 (colchón fijo 360) · Paciente a 303:
-- monto 31,06 · receive 9.412 entero · efectiva 303,0264.
create temp table bc_p on commit drop as
select $j${
  "ahora": "2026-11-13T17:00:00Z",
  "foto": {"usable": true, "senal": {"palabra": "VENDER"},
    "menu": {"peldanos": [
      {"nombre": "Inmediato", "tasa": 314, "g": 48.28, "zona": "automatica", "delanteUsd": 12, "bloqueado": false},
      {"nombre": "Equilibrado", "tasa": 310, "g": 45.71, "zona": "automatica", "delanteUsd": 30, "bloqueado": false},
      {"nombre": "Paciente", "tasa": 303, "g": 81.19, "zona": "automatica", "delanteUsd": 85, "bloqueado": false}]},
    "ejecutable20": {"tasa": 303, "usd": 40},
    "duras": [], "transferencia": null},
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

insert into banco_res
select 'C1 monto 31,06', (r #>> '{preparada,monto_qusd}')::numeric = 31.06, r
  from public.guia_calc_asesor((select p from bc_p)) r;
insert into banco_res
select 'C2 receive 9.412 entero', (r #>> '{preparada,receive}')::numeric = 9412, r
  from public.guia_calc_asesor((select p from bc_p)) r;
insert into banco_res
select 'C3 tasa_efectiva 303,0264', (r #>> '{preparada,tasa_efectiva}')::numeric = 303.0264, r
  from public.guia_calc_asesor((select p from bc_p)) r;

select paso, ok from banco_res order by paso;
rollback;

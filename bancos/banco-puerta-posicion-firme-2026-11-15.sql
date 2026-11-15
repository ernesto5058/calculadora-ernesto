-- BANCO TRANSACCIONAL — PUERTA DE POSICIÓN FIRME (v26, 2026-11-15)
-- El 2026-11-15 el Asesor preparó una oferta de $50 a 308,33 creyendo
-- el saldo de línea del Sensor SMS (15.550,08, leído 2026-11-14
-- 16:01 UTC) cuando el libro asentado decía 5,08: la venta del
-- barrido (asentada 19:06 UTC) había consumido el saldo y la lectura
-- del sensor era ANTERIOR a ella. La calc dimensionaba desde la
-- línea cruda y el único descuadre miraba el sentido contrario.
-- Contrato v26: la venta se dimensiona desde el LIBRO ASENTADO
-- (lotes); la posición solo es firme si hay lectura de línea, la
-- lectura no es anterior a la última venta asentada que consumió
-- saldo, y libro↔sensor acuerdan dentro del peaje (5). Si no:
-- sin oferta, motivo 'sin_posicion_firme' y causa en palabras.
-- Todo corre dentro de BEGIN…ROLLBACK: nada toca producción.
begin;
create temp table banco_res(paso text, ok boolean, dato jsonb) on commit drop;

-- Payload base: el escenario sano del banco de la cima sucia (foto
-- usable, señal APROVECHAR, bandas 310/315 con absorción real).
create temp table bv_base on commit drop as
select $j${
  "ahora": "2026-11-15T16:20:00Z",
  "foto": {"usable": true, "senal": {"palabra": "APROVECHAR"},
    "menu": {"peldanos": [
      {"nombre": "Inmediato", "tasa": 315.59, "g": 38.05, "zona": "automatica", "delanteUsd": 4, "bloqueado": false},
      {"nombre": "Equilibrado", "tasa": 314.58, "g": 41.20, "zona": "automatica", "delanteUsd": 32, "bloqueado": false},
      {"nombre": "Paciente", "tasa": 306, "g": 66.67, "zona": "automatica", "delanteUsd": 85, "bloqueado": false}]},
    "ejecutable20": {"tasa": 306, "usd": 50},
    "duras": [{"lado": "compra"}], "transferencia": null},
  "tarifa": {"salida_ref": 920, "ingreso_ref360": 1091.98, "libro_ref": 1111.74},
  "costo_ref360": 1000,
  "posicion": {"linea_saldo": 15550.08, "linea_en": "2026-11-14T16:15:00Z",
    "lotes": [{"cantidad": 3000, "costo": 7800}],
    "comprometido_saldo": 0, "base_venta": true,
    "fondo": 10993, "reserva_cupos": 15000, "mejor_nivel20_hoy": null},
  "puerta": {"tope_oferta": 50, "monto_hoy": 0, "acciones_hora": 0,
    "preparada_viva": false, "detenidas": false, "pausadas": false},
  "cfg": {"peaje_envio": 5, "tope_receptor_envio": 500000, "mat_fifo": 300},
  "demanda": {"usable": true, "declaracion": "aplicada", "modo": "banda",
    "banda_tasa": 5, "ventana_min": 120, "tope_usd": 100000,
    "termometro": "normal", "salida_cima_usd_h": 0, "vida_cima_min": 2,
    "bandas": [
      {"banda": 310, "lado": "venta", "salida_usd_h": 75.34, "vida_min": 30, "vida_censurada": false},
      {"banda": 315, "lado": "venta", "salida_usd_h": 407.66, "vida_min": 30, "vida_censurada": false}]},
  "promo_puesto": {"activa": false, "ref_cierre": null}
}$j$::jsonb as p;

-- ============ CASO A · el real de Ernesto (2026-11-15) ============
-- Línea 15.550,08 leída 16:01:28Z; venta asentada 19:06:16Z DESPUÉS;
-- libro asentado 5,08. La puerta tiene que frenar con la causa exacta.
create temp table ba_p on commit drop as
select jsonb_set(p, '{posicion}', $j${
  "linea_saldo": 15550.08, "linea_en": "2026-11-14T16:01:28Z",
  "libro_saldo": 5.08, "ult_venta_en": "2026-11-14T19:06:16Z",
  "lotes": [{"cantidad": 5.08, "costo": 14.11}],
  "comprometido_saldo": 0, "base_venta": true, "qUSD": 0,
  "fondo": 301, "reserva_cupos": 29000, "mejor_nivel20_hoy": null}$j$::jsonb) as p
  from bv_base;

insert into banco_res
select 'A1 el caso real: NO prepara', (r ->> 'preparada') is null, r
  from public.guia_calc_asesor((select p from ba_p)) r;
insert into banco_res
select 'A2 el motivo es sin_posicion_firme',
       coalesce(r -> 'motivos_no_prepara', '[]'::jsonb) @> '"sin_posicion_firme"'::jsonb, r
  from public.guia_calc_asesor((select p from ba_p)) r;
insert into banco_res
select 'A3 la causa nombra la vejez tras la venta',
       (r #>> '{posicion,firme}')::boolean = false
         and (r #>> '{posicion,firme_causa}') = 'linea_anterior_ultima_venta'
         and (r #>> '{posicion,firme_texto}') is not null, r
  from public.guia_calc_asesor((select p from ba_p)) r;
insert into banco_res
select 'A4 vendible nulo y libro asentado = 5,08',
       (r #>> '{posicion,vendible}') is null
         and (r #>> '{posicion,libro_saldo}')::numeric = 5.08, r
  from public.guia_calc_asesor((select p from ba_p)) r;

-- ============ CASO B · desacuerdo fresco (sin venta de por medio) ==
-- Lectura de línea FRESCA pero el libro dice otra cosa: tampoco.
create temp table bb_p on commit drop as
select jsonb_set(p, '{posicion}', $j${
  "linea_saldo": 15550.08, "linea_en": "2026-11-15T16:00:00Z",
  "libro_saldo": 5.08,
  "lotes": [{"cantidad": 5.08, "costo": 14.11}],
  "comprometido_saldo": 0, "base_venta": true, "qUSD": 0,
  "fondo": 301, "reserva_cupos": 29000, "mejor_nivel20_hoy": null}$j$::jsonb) as p
  from bv_base;

insert into banco_res
select 'B1 desacuerdo libro↔sensor: NO prepara', (r ->> 'preparada') is null, r
  from public.guia_calc_asesor((select p from bb_p)) r;
insert into banco_res
select 'B2 la causa es libro_sensor_difieren',
       (r #>> '{posicion,firme_causa}') = 'libro_sensor_difieren', r
  from public.guia_calc_asesor((select p from bb_p)) r;

-- ============ CASO C · firme al borde y dimensiona del LIBRO ======
-- Línea 15.553 leída DESPUÉS de la última venta; libro 15.548:
-- diferencia = 5 = el peaje exacto → firme. El vendible tiene que
-- salir del libro (15.548 − 5 de colchón = 15.543), NO de la línea
-- (que daría 15.548 también por casualidad aritmética… no: línea
-- 15.553 − 5 = 15.548 ≠ 15.543; el número distingue la fuente).
create temp table bc_p on commit drop as
select jsonb_set(p, '{posicion}', $j${
  "linea_saldo": 15553, "linea_en": "2026-11-15T16:00:00Z",
  "libro_saldo": 15548, "ult_venta_en": "2026-11-14T19:06:16Z",
  "lotes": [{"cantidad": 15548, "costo": 43223}],
  "comprometido_saldo": 0, "base_venta": true, "qUSD": 0,
  "fondo": 10993, "reserva_cupos": 15000, "mejor_nivel20_hoy": null}$j$::jsonb) as p
  from bv_base;

insert into banco_res
select 'C1 posición firme (diferencia = peaje exacto): SÍ prepara',
       (r ->> 'preparada') is not null, r
  from public.guia_calc_asesor((select p from bc_p)) r;
insert into banco_res
select 'C2 el vendible nace del LIBRO: 15.548 − 5 = 15.543',
       (r #>> '{posicion,vendible}')::numeric = 15543
         and (r #>> '{posicion,firme}')::boolean = true, r
  from public.guia_calc_asesor((select p from bc_p)) r;
insert into banco_res
select 'C3 la oferta nace del saldo: recibes 15.543 exactos',
       (r #>> '{preparada,receive}')::numeric = 15543, r
  from public.guia_calc_asesor((select p from bc_p)) r;

-- ============ CASO D · sin lectura de línea ========================
create temp table bd_p on commit drop as
select jsonb_set(p, '{posicion}', $j${
  "libro_saldo": 1000,
  "lotes": [{"cantidad": 1000, "costo": 2778}],
  "comprometido_saldo": 0, "base_venta": true, "qUSD": 0,
  "fondo": 10993, "reserva_cupos": 15000, "mejor_nivel20_hoy": null}$j$::jsonb) as p
  from bv_base;

insert into banco_res
select 'D1 sin lectura de línea: NO prepara', (r ->> 'preparada') is null, r
  from public.guia_calc_asesor((select p from bd_p)) r;
insert into banco_res
select 'D2 la causa es sin_lectura_linea',
       (r #>> '{posicion,firme_causa}') = 'sin_lectura_linea', r
  from public.guia_calc_asesor((select p from bd_p)) r;

-- ============ CASO E · la cima sucia con el libro regularizado =====
-- El escenario del banco del freno (lotes 14.282) MÁS el lote de
-- regularización de 1.268,08 que el libro real recibió: libro =
-- línea = 15.550,08 → firme, y el freno de demanda sigue midiendo
-- la banda del peldaño (310) como siempre.
create temp table be_p on commit drop as
select jsonb_set(p, '{posicion}', $j${
  "linea_saldo": 15550.08, "linea_en": "2026-11-14T16:15:00Z",
  "libro_saldo": 15550.08,
  "lotes": [{"cantidad": 3000, "costo": 7800}, {"cantidad": 1440, "costo": 4000},
            {"cantidad": 1080, "costo": 3000}, {"cantidad": 360, "costo": 1000},
            {"cantidad": 360, "costo": 1000}, {"cantidad": 2262, "costo": 5655},
            {"cantidad": 3000, "costo": 7500}, {"cantidad": 2780, "costo": 6950},
            {"cantidad": 1268.08, "costo": 3525}],
  "comprometido_saldo": 0, "base_venta": true, "qUSD": 0,
  "fondo": 10993, "reserva_cupos": 15000, "mejor_nivel20_hoy": null}$j$::jsonb) as p
  from bv_base;

insert into banco_res
select 'E1 libro regularizado = línea: SÍ prepara', (r ->> 'preparada') is not null, r
  from public.guia_calc_asesor((select p from be_p)) r;
insert into banco_res
select 'E2 el freno sigue midiendo la banda del peldaño (310)',
       (r #>> '{demanda,banda}')::numeric = 310
         and (r #>> '{demanda,salida_banda_usd_h}')::numeric = 75.34, r
  from public.guia_calc_asesor((select p from be_p)) r;

select paso, ok from banco_res order by paso;
rollback;

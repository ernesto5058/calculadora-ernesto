-- BANCO TRANSACCIONAL — el freno de demanda y la CIMA SUCIA
-- (2026-11-14). Escenario real de ese día: la foto de las 17:04 UTC
-- traía la cima de venta en 279,07 (UNA oferta de 12.000 por $43,
-- aislada: promedio de venta 305,23 y la masa del libro en 313+).
-- El peldaño se anclaba a esa cima → banda 275 → absorción 0 → la
-- preparación moría con «demanda_sin_absorcion_en_tu_zona» mientras
-- la medición de las 17:05 mostraba las bandas de su zona sanas:
-- venta 310 → 75,34 USD/h · 315 → 407,66 USD/h.
-- El arreglo vive en dos piezas: la CIMA FIRME del lector (el
-- peldaño nace en 314,58 — banco JS prueba-puerta-asesor) y este
-- freno, que mide la banda DEL PELDAÑO. Aquí se prueba la calc:
-- con el peldaño en su zona sana prepara; con la banda de SU
-- peldaño en cero frena — también si el peldaño cayera en 279.
-- Todo corre dentro de BEGIN…ROLLBACK: nada toca producción.
begin;
create temp table banco_res(paso text, ok boolean, dato jsonb) on commit drop;

-- ============ CASO A · peldaño firme (314,58) + bandas del día ====
create temp table ba_p on commit drop as
select $j${
  "ahora": "2026-11-14T17:20:00Z",
  "foto": {"usable": true, "senal": {"palabra": "APROVECHAR"},
    "menu": {"peldanos": [
      {"nombre": "Inmediato", "tasa": 315.59, "g": 38.05, "zona": "automatica", "delanteUsd": 4, "bloqueado": false},
      {"nombre": "Equilibrado", "tasa": 314.58, "g": 41.20, "zona": "automatica", "delanteUsd": 32, "bloqueado": false},
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
  "demanda": {"usable": true, "declaracion": "aplicada", "modo": "banda",
    "banda_tasa": 5, "ventana_min": 120, "tope_usd": 100000,
    "termometro": "normal", "salida_cima_usd_h": 0, "vida_cima_min": 2,
    "bandas": [
      {"banda": 310, "lado": "venta", "salida_usd_h": 75.34, "vida_min": 30, "vida_censurada": false},
      {"banda": 315, "lado": "venta", "salida_usd_h": 407.66, "vida_min": 30, "vida_censurada": false}]},
  "promo_puesto": {"activa": false, "ref_cierre": null}
}$j$::jsonb as p;

insert into banco_res
select 'A1 con la cima muerta (salida_cima=0) SÍ prepara', (r ->> 'preparada') is not null, r
  from public.guia_calc_asesor((select p from ba_p)) r;
insert into banco_res
select 'A2 el freno midió la banda DEL PELDAÑO (310)',
       (r #>> '{demanda,banda}')::numeric = 310
         and (r #>> '{demanda,salida_banda_usd_h}')::numeric = 75.34, r
  from public.guia_calc_asesor((select p from ba_p)) r;
insert into banco_res
select 'A3 tope = absorción de su banda × ventana (75,34 × 2 h = 150,68)',
       (r #>> '{demanda,tope_usd}')::numeric = 150.68
         and (r #>> '{demanda,topado}')::boolean = false, r
  from public.guia_calc_asesor((select p from ba_p)) r;
insert into banco_res
select 'A4 monto pleno desde el saldo (49,42) y receive entero (15.545)',
       (r #>> '{preparada,monto_qusd}')::numeric = 49.42
         and (r #>> '{preparada,receive}')::numeric = 15545, r
  from public.guia_calc_asesor((select p from ba_p)) r;
insert into banco_res
select 'A5 sin el motivo que mató la preparación de hoy',
       not (coalesce(r -> 'motivos_no_prepara', '[]'::jsonb)
              @> '"demanda_sin_absorcion_en_tu_zona"'::jsonb), r
  from public.guia_calc_asesor((select p from ba_p)) r;

-- ============ CASO B · control: SU banda en cero → frena ==========
create temp table bb_p on commit drop as
select jsonb_set(p, '{demanda,bandas}', $j$[
  {"banda": 310, "lado": "venta", "salida_usd_h": 0, "vida_min": 30, "vida_censurada": false},
  {"banda": 315, "lado": "venta", "salida_usd_h": 0, "vida_min": 30, "vida_censurada": false}]$j$::jsonb) as p
  from ba_p;

insert into banco_res
select 'B1 banda de su zona en cero: NO prepara', (r ->> 'preparada') is null, r
  from public.guia_calc_asesor((select p from bb_p)) r;
insert into banco_res
select 'B2 el motivo es el de su zona',
       coalesce(r -> 'motivos_no_prepara', '[]'::jsonb)
         @> '"demanda_sin_absorcion_en_tu_zona"'::jsonb, r
  from public.guia_calc_asesor((select p from bb_p)) r;

-- ============ CASO C · el fracaso original, reproducido ===========
-- Si un peldaño cayera en la cima sucia (279,07 → banda 275, que la
-- medición ni trae), el freno sigue parándolo: la banda manda.
create temp table bc_p on commit drop as
select jsonb_set(p, '{foto,menu,peldanos}', $j$[
  {"nombre": "Inmediato", "tasa": 280.07, "g": 168.62, "zona": "automatica", "delanteUsd": 0, "bloqueado": false},
  {"nombre": "Equilibrado", "tasa": 279.07, "g": 173.92, "zona": "automatica", "delanteUsd": 0, "bloqueado": false},
  {"nombre": "Paciente", "tasa": 306, "g": 66.67, "zona": "automatica", "delanteUsd": 85, "bloqueado": false}]$j$::jsonb) as p
  from ba_p;

insert into banco_res
select 'C1 peldaño en la cima sucia (banda 275 sin absorción): NO prepara',
       (r ->> 'preparada') is null, r
  from public.guia_calc_asesor((select p from bc_p)) r;
insert into banco_res
select 'C2 frena midiendo la banda 275, no la cima en abstracto',
       (r #>> '{demanda,banda}')::numeric = 275
         and coalesce(r -> 'motivos_no_prepara', '[]'::jsonb)
           @> '"demanda_sin_absorcion_en_tu_zona"'::jsonb, r
  from public.guia_calc_asesor((select p from bc_p)) r;

select paso, ok from banco_res order by paso;
rollback;

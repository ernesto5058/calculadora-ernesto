-- BANCO TRANSACCIONAL — freno por banda en el Asesor (2026-11-14).
-- Todo corre dentro de BEGIN…ROLLBACK: fotos, mediciones y
-- preparadas sintéticas JAMÁS tocan producción. Reproduce el caso
-- de esta madrugada: cima muerta (salida_cima = 0) con la banda
-- 310 viva (8,57 USD/h) — con el freno viejo NO nacía nada; con el
-- freno por banda nace topado por SU zona, y una zona muerta sigue
-- frenando con el mismo rigor (motivo nuevo, en tu zona).
begin;
create temp table banco_res(paso text, ok boolean, dato jsonb) on commit drop;

-- ============ FIXTURES DE CÁLCULO PURO ============
-- APROVECHAR → el cálculo elige el peldaño Equilibrado.
create temp table bc_aprov on commit drop as
select $j${
  "ahora": "2026-11-14T06:00:00Z",
  "foto": {"usable": true, "senal": {"palabra": "APROVECHAR"},
    "menu": {"peldanos": [
      {"nombre": "Inmediato", "tasa": 314, "g": 48.28, "zona": "automatica", "delanteUsd": 12, "bloqueado": false},
      {"nombre": "Equilibrado", "tasa": 310, "g": 45.71, "zona": "automatica", "delanteUsd": 30, "bloqueado": false},
      {"nombre": "Paciente", "tasa": 303, "g": 81.19, "zona": "automatica", "delanteUsd": 85, "bloqueado": false}]},
    "ejecutable20": {"tasa": 303, "usd": 40},
    "duras": [{"lado": "compra"}], "transferencia": null},
  "tarifa": {"salida_ref": 910, "ingreso_ref360": 1079.81, "libro_ref": 1111.74},
  "costo_ref360": 1000,
  "posicion": {"linea_saldo": 9772.08, "linea_en": "2026-11-14T05:15:00Z",
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

-- Las bandas REALES de la medición de esta madrugada (06:45 UTC):
-- cima 0 · venta 310 → 8,57 · sin banda 280 de venta.
create temp table bc_bandas on commit drop as
select $j$[
  {"banda": 280, "lado": "compra", "salida_usd_h": 39.81, "rotacion_usd_h": 39.81, "vida_min": 112, "vida_censurada": true},
  {"banda": 285, "lado": "compra", "salida_usd_h": 186.59, "rotacion_usd_h": 186.59, "vida_min": 112, "vida_censurada": true},
  {"banda": 310, "lado": "venta", "salida_usd_h": 8.57, "rotacion_usd_h": 8.57, "vida_min": 112, "vida_censurada": false},
  {"banda": 320, "lado": "venta", "salida_usd_h": 197.95, "rotacion_usd_h": 197.95, "vida_min": 112, "vida_censurada": true}
]$j$::jsonb as bandas;

-- F1 · EL CASO DE LA MADRUGADA: cima muerta (tope_usd legado = 0)
-- pero la banda del peldaño (310) viva → nace topado por SU zona:
-- 8,57 USD/h × 2 h = 17,14 → monto 17, modo banda, porqué la nombra.
insert into banco_res
select 'f1_cima_muerta_banda_viva_topa_17',
       (r->'preparada'->>'monto_qusd')::numeric = 17
       and (r->'preparada'->>'tasa')::numeric = 310
       and (r->'preparada'->'demanda'->>'modo') = 'banda'
       and (r->'preparada'->'demanda'->>'banda')::numeric = 310
       and (r->'preparada'->'demanda'->>'salida_banda_usd_h')::numeric = 8.57
       and (r->'preparada'->'demanda'->>'tope_usd')::numeric = 17.14
       and (r->'preparada'->'demanda'->>'topado')::boolean = true
       and jsonb_array_length(r->'preparada'->'porques') = 4
       and (r->'preparada'->'porques'->>3) like '%la zona de tu oferta a 310%'
       and (r->'preparada'->'porques'->>3) like '%se comió 8.57 USD/h%'
       and (r->'preparada'->'porques'->>3) like '%topó a lo que tu zona absorbe%',
       jsonb_build_object('prep', r->'preparada')
  from bc_aprov, bc_bandas, lateral (select public.guia_calc_asesor(
    p || jsonb_build_object('demanda', jsonb_build_object(
      'usable', true, 'declaracion', 'aplicada', 'termometro', 'normal',
      'salida_cima_usd_h', 0, 'vida_cima_min', 31, 'tope_usd', 0,
      'bandas', bandas, 'banda_tasa', 5, 'ventana_min', 120))) as r) s;

-- F2 · Peldaño en banda SIN medición (280 ausente del desglose):
-- absorción medida cero → frena, con el motivo nuevo de su zona.
insert into banco_res
select 'f2_banda_ausente_frena_en_tu_zona',
       r->'preparada' = 'null'::jsonb
       and (r->'motivos_no_prepara') @> '["demanda_sin_absorcion_en_tu_zona"]'::jsonb
       and not ((r->'motivos_no_prepara') @> '["demanda_sin_absorcion"]'::jsonb),
       jsonb_build_object('motivos', r->'motivos_no_prepara')
  from bc_bandas, lateral (select jsonb_set(
      (select p from bc_aprov), '{foto,menu,peldanos,1,tasa}', '282'::jsonb) as p2) f,
       lateral (select public.guia_calc_asesor(
    p2 || jsonb_build_object('demanda', jsonb_build_object(
      'usable', true, 'declaracion', 'aplicada', 'termometro', 'normal',
      'salida_cima_usd_h', 0, 'vida_cima_min', 31, 'tope_usd', 0,
      'bandas', bandas, 'banda_tasa', 5, 'ventana_min', 120))) as r) s;

-- F3 · Banda del peldaño medida EXPLÍCITAMENTE en cero: mismo freno.
insert into banco_res
select 'f3_banda_en_cero_frena_en_tu_zona',
       r->'preparada' = 'null'::jsonb
       and (r->'motivos_no_prepara') @> '["demanda_sin_absorcion_en_tu_zona"]'::jsonb,
       jsonb_build_object('motivos', r->'motivos_no_prepara')
  from bc_aprov, lateral (select public.guia_calc_asesor(
    p || '{"demanda": {"usable": true, "declaracion": "aplicada",
      "termometro": "fria", "salida_cima_usd_h": 0, "vida_cima_min": 240,
      "tope_usd": 0, "banda_tasa": 5, "ventana_min": 120,
      "bandas": [{"banda": 310, "lado": "venta", "salida_usd_h": 0,
                  "vida_min": 240, "vida_censurada": true}]}}'::jsonb) as r) s;

-- F4 · Banda viva y holgada (100 USD/h → tope 200): prepara el
-- monto entero, sin tope, y el porqué nombra la banda.
-- REPIN 2026-11-14 (tanda Puerta+Asesor): el monto entero ya no es
-- 30 — con la regla «la oferta nace del saldo» (F2) el monto es
-- round(vendible/tasa, 2) = 30,36 y el receive el vendible entero
-- (9.412); el vector viejo era del régimen monto-primero.
insert into banco_res
select 'f4_banda_holgada_no_topa',
       (r->'preparada'->>'monto_qusd')::numeric = 30.36
       and (r->'preparada'->>'receive')::numeric = 9412
       and (r->'preparada'->>'recibe_del_saldo')::boolean = true
       and (r->'preparada'->'demanda'->>'modo') = 'banda'
       and (r->'preparada'->'demanda'->>'topado')::boolean = false
       and (r->'preparada'->'porques'->>3) like '%(banda 310–315) se comió 100 USD/h%'
       and not ((r->'preparada'->'porques'->>3) like '%topó%'),
       jsonb_build_object('prep', r->'preparada')
  from bc_aprov, lateral (select public.guia_calc_asesor(
    p || '{"demanda": {"usable": true, "declaracion": "aplicada",
      "termometro": "alta", "salida_cima_usd_h": 0, "vida_cima_min": 31,
      "tope_usd": 0, "banda_tasa": 5, "ventana_min": 120,
      "bandas": [{"banda": 310, "lado": "venta", "salida_usd_h": 100,
                  "vida_min": 20, "vida_censurada": false}]}}'::jsonb) as r) s;

-- F5 · Bandas presentes pero medición VIEJA (usable=false): se
-- declara y NO topa — prepara como siempre (30,36 con la regla
-- del saldo, ver el repin de F4), honestidad intacta.
insert into banco_res
select 'f5_medicion_vieja_con_bandas_no_topa',
       (r->'preparada'->>'monto_qusd')::numeric = 30.36
       and (r->'demanda'->>'declaracion') = 'medicion_vieja'
       and (r->'demanda'->>'aplicada')::boolean = false,
       jsonb_build_object('dem', r->'demanda', 'prep_monto',
                          r->'preparada'->>'monto_qusd')
  from bc_aprov, lateral (select public.guia_calc_asesor(
    p || '{"demanda": {"usable": false, "declaracion": "medicion_vieja",
      "termometro": "normal", "salida_cima_usd_h": 0, "vida_cima_min": 240,
      "tope_usd": null, "banda_tasa": 5, "ventana_min": 120,
      "bandas": [{"banda": 310, "lado": "venta", "salida_usd_h": 0,
                  "vida_min": 240, "vida_censurada": true}]}}'::jsonb) as r) s;

-- ============ PIPELINE: mediciones sintéticas + foto viva ============
-- La demanda real se aparta dentro de la transacción (vuelve con el
-- rollback) pa que el interno lea SOLO la medición sintética.
delete from public.demanda_mediciones where moneda = 'ETECSA';

-- P-F1 · La medición de esta madrugada por el pipeline completo:
-- el freno viejo (demanda_sin_absorcion) NO puede disparar; si el
-- peldaño de la foto viva cae en banda viva, nace en modo banda
-- con el tope consistente (topado ⇒ monto = floor(tope)).
insert into public.demanda_mediciones
  (medida_en, moneda, termometro, salida_cima_usd_h, vida_cima_min, bandas)
values (now(), 'ETECSA', 'normal', 0, 31,
  (select bandas from bc_bandas));
insert into banco_res
select 'pf1_pipeline_cima_muerta_banda_viva',
       (r->'demanda'->>'declaracion') = 'aplicada'
       and not ((r->'calculo'->'motivos_no_prepara') @> '["demanda_sin_absorcion"]'::jsonb)
       and ((r->'calculo'->'preparada') = 'null'::jsonb
            or ((r->'calculo'->'preparada'->'demanda'->>'modo') = 'banda'
                and (not (r->'calculo'->'preparada'->'demanda'->>'topado')::boolean
                     or (r->'calculo'->'preparada'->>'monto_qusd')::numeric
                        = floor((r->'calculo'->'preparada'->'demanda'->>'tope_usd')::numeric)))),
       jsonb_build_object('dem', r->'calculo'->'demanda',
         'prep', r->'calculo'->'preparada',
         'motivos', r->'calculo'->'motivos_no_prepara')
  from (select public.guia_asesor_interno(false) as r) s;
delete from public.demanda_mediciones where moneda = 'ETECSA';

-- P-F2 · TODAS las bandas de venta en cero por el ciclo completo:
-- no nace preparada y el motivo viejo jamás aparece con bandas.
-- La preparada VIVA real se aparta SOLO dentro de la transacción
-- (el rollback la devuelve intacta): sin esto, el pipeline corta
-- por «ya_hay_preparada» y el camino de demanda ni se ejercita
-- (pasó el 2026-11-14 con la preparada real de las 17:30 UTC).
update public.mercado_acciones
   set estado = 'expirada', expira_en = now() - interval '1 minute'
 where origen = 'asesor' and estado = 'preparada';
insert into public.demanda_mediciones
  (medida_en, moneda, termometro, salida_cima_usd_h, vida_cima_min, bandas)
select now(), 'ETECSA', 'fria', 0, 240,
  coalesce(jsonb_agg(jsonb_build_object(
    'banda', g, 'lado', 'venta', 'salida_usd_h', 0,
    'vida_min', 240, 'vida_censurada', true) order by g), '[]'::jsonb)
  from generate_series(200, 450, 5) g;
insert into banco_res
select 'pf2_pipeline_todo_cero_no_prepara',
       (p->>'preparada') is null
       and not ((p->'motivos') @> '["demanda_sin_absorcion"]'::jsonb)
       and not exists (select 1 from public.mercado_acciones
                        where origen = 'asesor' and estado = 'preparada'
                          and expira_en > now()),
       p
  from (select public.guia_preparar_interna(true) as p) s;
delete from public.demanda_mediciones where moneda = 'ETECSA';

-- ============ EVALUAR: vida y salida por banda ============
-- Tres fotos sintéticas en el futuro (quedan consecutivas al final
-- de la serie de la ventana: pares limpios, sin mezclarse con las
-- fotos reales). Banda 900: la profundidad cae 100 → 60 y se queda
-- (salida > 0, vida = 30 min, no censurada). Banda 905: 50 clavada
-- (vida = ventana entera, censurada).
create temp table f6_ids(n int, id uuid) on commit drop;
with ins1 as (insert into public.mercado_fotos
  (recibida_en, libro_ok, fresca, etecsa_top_venta, etecsa_count,
   etecsa_count_buy, etecsa_count_sell, detalle)
  values (now() + interval '1 day', true, true, 900, 84, 22, 62,
    '{"escalera_venta": [{"tasa": 900, "usd": 100}, {"tasa": 905, "usd": 50}],
      "escalera_compra": [], "window_hours": 24}'::jsonb)
  returning id)
insert into f6_ids select 1, id from ins1;
with ins2 as (insert into public.mercado_fotos
  (recibida_en, libro_ok, fresca, etecsa_top_venta, etecsa_count,
   etecsa_count_buy, etecsa_count_sell, detalle)
  values (now() + interval '1 day 15 minutes', true, true, 900, 84, 22, 62,
    '{"escalera_venta": [{"tasa": 900, "usd": 60}, {"tasa": 905, "usd": 50}],
      "escalera_compra": [], "window_hours": 24}'::jsonb)
  returning id)
insert into f6_ids select 2, id from ins2;
with ins3 as (insert into public.mercado_fotos
  (recibida_en, libro_ok, fresca, etecsa_top_venta, etecsa_count,
   etecsa_count_buy, etecsa_count_sell, detalle)
  values (now() + interval '1 day 30 minutes', true, true, 900, 84, 22, 62,
    '{"escalera_venta": [{"tasa": 900, "usd": 60}, {"tasa": 905, "usd": 50}],
      "escalera_compra": [], "window_hours": 24}'::jsonb)
  returning id)
insert into f6_ids select 3, id from ins3;
select public.demanda_evaluar();
insert into banco_res
select 'f6_evaluar_vida_y_salida_por_banda',
       b900 is not null and b905 is not null
       and (b900->>'salida_usd_h')::numeric > 0
       and (b900->>'salida_usd_h')::numeric < 10
       and (b900->>'vida_min')::numeric between 25 and 35
       and (b900->>'vida_censurada')::boolean = false
       and (b905->>'vida_censurada')::boolean = true
       and (b905->>'vida_min')::numeric > 1000,
       jsonb_build_object('b900', b900, 'b905', b905)
  from (select
    (select b from jsonb_array_elements(m.bandas) b
      where b->>'lado' = 'venta' and (b->>'banda')::numeric = 900 limit 1) as b900,
    (select b from jsonb_array_elements(m.bandas) b
      where b->>'lado' = 'venta' and (b->>'banda')::numeric = 905 limit 1) as b905
    from public.demanda_mediciones m
   where m.moneda = 'ETECSA'
     and m.foto_id = (select id from f6_ids where n = 3)) s;

select paso, ok, dato from banco_res order by paso;
rollback;

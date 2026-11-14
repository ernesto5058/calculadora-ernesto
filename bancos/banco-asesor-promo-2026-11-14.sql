-- BANCO TRANSACCIONAL — ASESOR AFILADO EN PROMO (2026-11-14).
-- Todo corre dentro de BEGIN…ROLLBACK: config, eventos y acciones
-- sintéticas JAMÁS tocan producción. Prueba el currículo nuevo:
-- estado de promo por fases, la banda del 5 % como restricción
-- DURA (en banda / ajustada al borde / sin margen con su motivo),
-- la señal de escaparate contra la mediana propia de 24 h, el
-- registro del escaparate vacío y la salida limpia de la ventana.
begin;
create temp table banco_res(paso text, ok boolean, dato jsonb) on commit drop;

-- ============ FIXTURE DE CÁLCULO PURO (la del freno por banda) ====
create temp table bc_aprov on commit drop as
select $j${
  "ahora": "2026-11-20T06:00:00Z",
  "foto": {"usable": true, "senal": {"palabra": "APROVECHAR"},
    "menu": {"peldanos": [
      {"nombre": "Inmediato", "tasa": 314, "g": 48.28, "zona": "automatica", "delanteUsd": 12, "bloqueado": false},
      {"nombre": "Equilibrado", "tasa": 310, "g": 45.71, "zona": "automatica", "delanteUsd": 30, "bloqueado": false},
      {"nombre": "Paciente", "tasa": 303, "g": 81.19, "zona": "automatica", "delanteUsd": 85, "bloqueado": false}]},
    "ejecutable20": {"tasa": 303, "usd": 40},
    "duras": [{"lado": "compra"}], "transferencia": null},
  "tarifa": {"salida_ref": 910, "ingreso_ref360": 1079.81, "libro_ref": 1111.74},
  "costo_ref360": 1000,
  "posicion": {"linea_saldo": 9772.08, "linea_en": "2026-11-20T05:15:00Z",
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

-- ============ E · ESTADO DE PROMO (función pura) ============
insert into banco_res
select 'e1_puja_abierta_hoy',
       (e->>'fase') = 'puja_abierta' and (e->>'activa')::boolean = false
       and (e->>'declaracion') = 'puja_en_curso',
       e
  from (select public.guia_promo_estado(
    '{"hoy":"2026-11-14","puja_cierre":"2026-11-16","desde":"2026-11-17",
      "hasta":"2026-12-16","resultado":"desconocido"}'::jsonb) as e) s;

insert into banco_res
select 'e2_cierre_lider_puesto_asegurado',
       (e->>'fase') = 'puesto_asegurado'
       and (e->>'activa')::boolean = false,
       e
  from (select public.guia_promo_estado(
    '{"hoy":"2026-11-16","puja_cierre":"2026-11-16","desde":"2026-11-17",
      "hasta":"2026-12-16","resultado":"lider"}'::jsonb) as e) s;

insert into banco_res
select 'e3_ventana_sin_confirmar_sin_datos',
       (e->>'fase') = 'ventana_sin_confirmar'
       and (e->>'activa')::boolean = false
       and (e->>'declaracion') = 'sin_datos',
       e
  from (select public.guia_promo_estado(
    '{"hoy":"2026-11-20","puja_cierre":"2026-11-16","desde":"2026-11-17",
      "hasta":"2026-12-16","resultado":"desconocido"}'::jsonb) as e) s;

insert into banco_res
select 'e4_puja_perdida_sin_promo',
       (e->>'fase') = 'sin_promo' and (e->>'activa')::boolean = false,
       e
  from (select public.guia_promo_estado(
    '{"hoy":"2026-11-20","puja_cierre":"2026-11-16","desde":"2026-11-17",
      "hasta":"2026-12-16","resultado":"perdida"}'::jsonb) as e) s;

insert into banco_res
select 'e5_ventana_cerrada_terminada',
       (e->>'fase') = 'promo_terminada'
       and (e->>'activa')::boolean = false,
       e
  from (select public.guia_promo_estado(
    '{"hoy":"2026-12-17","puja_cierre":"2026-11-16","desde":"2026-11-17",
      "hasta":"2026-12-16","resultado":"lider"}'::jsonb) as e) s;

insert into banco_res
select 'e6_destacada_sin_datos_oferta_viva_legible',
       (e->>'fase') = 'ventana' and (e->>'activa')::boolean = true
       and e->'destacada_viva' = 'null'::jsonb
       and (e->>'destacada_declaracion') = 'sin_datos'
       and (e->>'oferta_viva')::boolean = true,
       e
  from (select public.guia_promo_estado(
    '{"hoy":"2026-11-20","puja_cierre":"2026-11-16","desde":"2026-11-17",
      "hasta":"2026-12-16","resultado":"lider",
      "ofertas_abiertas":2,"propias_legible":true}'::jsonb) as e) s;

-- ============ C1 · EN BANDA: prepara igual, declarado ============
insert into banco_res
select 'c1_en_banda_prepara_igual',
       (r->'preparada'->>'tasa')::numeric = 310
       and (r->'preparada'->>'monto_qusd')::numeric = 30
       and (r->'preparada'->>'ganancia360')::numeric = 45.71
       and (r->'preparada'->'promo'->>'ajuste') = 'en_banda'
       and exists (select 1 from jsonb_array_elements_text(
             r->'preparada'->'porques') t
            where t like '%DENTRO de la banda del 5 % del cierre de 24 h%'
              and t like '%referencia 305%'),
       jsonb_build_object('prep', r->'preparada')
  from bc_aprov, lateral (select public.guia_calc_asesor(
    p || '{"promo_puesto": {"activa": true, "fase": "ventana",
      "declaracion": "confirmada", "ref_cierre": 305,
      "banda_pct": 5}}'::jsonb) as r) s;

-- ============ C2 · FUERA POR ARRIBA: ajusta al borde ============
-- ref 280 → banda [266, 294]; peldaño 310 → 294, g recalculada
-- 360·910/294 − 1000 = 114,29; monto = floor(9412,08/294) = 32.
insert into banco_res
select 'c2_fuera_arriba_ajusta_al_borde',
       (r->'preparada'->>'tasa')::numeric = 294
       and (r->'preparada'->'promo'->>'tasa_original')::numeric = 310
       and (r->'preparada'->'promo'->>'ajuste') = 'ajustada_al_borde'
       and (r->'preparada'->>'ganancia360')::numeric = 114.29
       and (r->'preparada'->>'monto_qusd')::numeric = 32
       and exists (select 1 from jsonb_array_elements_text(
             r->'preparada'->'porques') t
            where t like '%lo ajusté al borde 294%'),
       jsonb_build_object('prep', r->'preparada')
  from bc_aprov, lateral (select public.guia_calc_asesor(
    p || '{"promo_puesto": {"activa": true, "fase": "ventana",
      "declaracion": "confirmada", "ref_cierre": 280,
      "banda_pct": 5}}'::jsonb) as r) s;

-- ============ C3 · LA BANDA MATA EL MARGEN: su motivo ============
-- Lote caro (3000 a 8800): ref 340 → banda [323, 357]; peldaño
-- 310 ajustado a 323 deja g = 14,24 y FIFO negativo ⇒ NO nace, y
-- el motivo es el de la promo, no el genérico.
insert into banco_res
select 'c3_banda_sin_margen_motivo_propio',
       r->'preparada' = 'null'::jsonb
       and (r->'motivos_no_prepara') @> '["promo_banda_sin_margen"]'::jsonb
       and not ((r->'motivos_no_prepara') @> '["no_material"]'::jsonb),
       jsonb_build_object('motivos', r->'motivos_no_prepara')
  from bc_aprov, lateral (select jsonb_set(p, '{posicion,lotes}',
      '[{"cantidad": 3000, "costo": 8800}]'::jsonb) as p2) f,
       lateral (select public.guia_calc_asesor(
    p2 || '{"promo_puesto": {"activa": true, "fase": "ventana",
      "declaracion": "confirmada", "ref_cierre": 340,
      "banda_pct": 5}}'::jsonb) as r) s;

-- C3b · EL MISMO mercado SIN promo activa: nace a 310 (contraste —
-- la restricción es de la promo, no del cálculo de siempre).
insert into banco_res
select 'c3b_sin_promo_el_mismo_mercado_nace',
       r->'preparada' <> 'null'::jsonb
       and (r->'preparada'->>'tasa')::numeric = 310,
       jsonb_build_object('prep', r->'preparada')
  from bc_aprov, lateral (select jsonb_set(p, '{posicion,lotes}',
      '[{"cantidad": 3000, "costo": 8800}]'::jsonb) as p2) f,
       lateral (select public.guia_calc_asesor(
    p2 || '{"promo_puesto": {"activa": false, "fase": "sin_promo",
      "ref_cierre": 340, "banda_pct": 5}}'::jsonb) as r) s;

-- ============ C4 · ESCAPARATE: absorción vs su nivel normal ======
insert into banco_res
select 'c4_escaparate_por_encima_de_su_normal',
       (r->'preparada'->'promo'->>'escaparate_senal') = 'alta'
       and (r->'preparada'->'promo'->>'escaparate_mediana_24h')::numeric = 20
       and exists (select 1 from jsonb_array_elements_text(
             r->'preparada'->'porques') t
            where t like '%Escaparate: tu zona absorbe 100 USD/h%'
              and t like '%POR ENCIMA de su nivel normal%'
              and t like '%mediana de 24 h: 20 USD/h, 12 lecturas%'),
       jsonb_build_object('prep', r->'preparada')
  from bc_aprov, lateral (select public.guia_calc_asesor(
    p || '{"promo_puesto": {"activa": true, "fase": "ventana",
        "declaracion": "confirmada", "ref_cierre": 305, "banda_pct": 5},
      "demanda": {"usable": true, "declaracion": "aplicada",
        "termometro": "alta", "salida_cima_usd_h": 0, "vida_cima_min": 31,
        "tope_usd": 0, "banda_tasa": 5, "ventana_min": 120,
        "bandas": [{"banda": 310, "lado": "venta", "salida_usd_h": 100,
                    "vida_min": 20, "vida_censurada": false}],
        "bandas_hist": {"310": {"mediana": 20, "n": 12}}}}'::jsonb) as r) s;

-- C4b · Historial flaco (n=2): NO se declara señal — nada inventado.
insert into banco_res
select 'c4b_historial_flaco_no_declara_senal',
       r->'preparada' <> 'null'::jsonb
       and r->'preparada'->'promo'->'escaparate_senal' = 'null'::jsonb
       and not exists (select 1 from jsonb_array_elements_text(
             r->'preparada'->'porques') t where t like '%Escaparate:%'),
       jsonb_build_object('promo', r->'preparada'->'promo')
  from bc_aprov, lateral (select public.guia_calc_asesor(
    p || '{"promo_puesto": {"activa": true, "fase": "ventana",
        "declaracion": "confirmada", "ref_cierre": 305, "banda_pct": 5},
      "demanda": {"usable": true, "declaracion": "aplicada",
        "termometro": "alta", "salida_cima_usd_h": 0, "vida_cima_min": 31,
        "tope_usd": 0, "banda_tasa": 5, "ventana_min": 120,
        "bandas": [{"banda": 310, "lado": "venta", "salida_usd_h": 100,
                    "vida_min": 20, "vida_censurada": false}],
        "bandas_hist": {"310": {"mediana": 20, "n": 2}}}}'::jsonb) as r) s;

-- ============ C5 · SALIDA LIMPIA: ventana cerrada, cero residuo ==
insert into banco_res
select 'c5_terminada_sin_residuo',
       (r->'preparada'->>'tasa')::numeric = 310
       and (r->'promo'->>'activa')::boolean = false
       and r->'promo'->'ajuste' = 'null'::jsonb
       and r->'preparada'->'promo'->'ajuste' = 'null'::jsonb,
       jsonb_build_object('promo', r->'promo')
  from bc_aprov, lateral (select public.guia_calc_asesor(
    p || '{"promo_puesto": {"activa": false, "fase": "promo_terminada",
      "declaracion": "confirmada", "ref_cierre": 280,
      "banda_pct": 5}}'::jsonb) as r) s;

-- ============ P1 · PIPELINE: escaparate vacío registrado ========
-- Ventana forzada en la transacción (cierre y apertura ya pasados,
-- resultado lider) + puerta pausada ⇒ el ciclo no puede preparar:
-- el vacío debe quedar registrado UNA vez (dedupe), el estado del
-- dueño debe decir 'vacio' y ninguna preparada puede nacer.
update public.guia_config
   set promo_puja_cierre = (now() at time zone 'America/Havana')::date - 2,
       puesto_desde = (now() at time zone 'America/Havana')::date - 1,
       puesto_hasta = (now() at time zone 'America/Havana')::date + 10,
       promo_resultado = 'lider'
 where id = 1;
update public.mercado_config set acciones_pausadas = true where id = 1;
delete from public.guia_promo_eventos;
select public.guia_preparar_interna(true);
select public.guia_preparar_interna(true);
insert into banco_res
select 'p1_escaparate_vacio_registrado_una_vez',
       (select count(*) from public.guia_promo_eventos
         where tipo = 'escaparate_vacio') = 1
       and (select r->'promo'->>'fase'
              from (select public.guia_asesor_interno(false) as r) x)
           = 'ventana'
       and (select r->'promo'->'escaparate'->>'estado'
              from (select public.guia_asesor_interno(false) as r) x)
           = 'vacio'
       and not exists (select 1 from public.mercado_acciones
                        where origen = 'asesor' and estado = 'preparada'
                          and expira_en > now()),
       jsonb_build_object(
         'eventos', (select detalle from public.guia_promo_eventos
                      where tipo = 'escaparate_vacio' limit 1),
         'promo', (select r->'promo'
              from (select public.guia_asesor_interno(false) as r) x));

select paso, ok, dato from banco_res order by paso;
rollback;

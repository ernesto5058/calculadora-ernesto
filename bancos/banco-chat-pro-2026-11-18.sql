-- ============================================================
-- BANCO SQL · Chat de buscadores PRO · 2026-11-18
-- Una sola transacción con ROLLBACK final: los libros reales
-- quedan intactos. Partición de prueba = usuario PEUEBA
-- (PRUEBA OJO), fondeado DENTRO de la transacción. Cada chequeo
-- deja su fila en banco_res y el SELECT final las devuelve.
-- El código de dueño se resuelve dentro de la SQL
-- (admin_config), jamás sale.
-- ============================================================
begin;
create temp table banco_res (n int, nombre text, ok boolean, detalle text) on commit drop;

do $banco$
declare
  v_cod text := (select valor from public.admin_config where clave = 'codigo_admin');
  v_n int := 0;
  v_r jsonb;
  v_parte uuid; v_parte3 uuid; v_parte_d uuid;
  v_espera uuid; v_espera_d uuid;
  v_msg bigint; v_tarifa_msg bigint;
  v_chat jsonb;
  v_activos int;
  v_esp_antes int; v_esp_despues int;
begin
  -- Fondeo de la partición de prueba (solo dentro de la txn).
  insert into public.dinero_entregas
    (buscador_codigo, monto_original, monto_pendiente, bolsillo,
     estado, es_prueba, detalle)
  values ('PEUEBA', 100000, 100000, 'efectivo', 'entregado', false,
          'banco chat-pro');

  -- ---------- C1 · parte nace pendiente + mensaje adjunto ----------
  v_r := public.parte_crear('PEUEBA', 'saldo', 1000, 2000, '53957338',
                            'banco-parte-1', false);
  v_parte := (v_r ->> 'parte_id')::uuid;
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C1 parte pendiente + mensaje parte',
    coalesce((v_r ->> 'ok')::boolean, false)
    and v_r ->> 'estado' = 'pendiente'
    and exists (select 1 from public.chat_partes p
                 where p.id = v_parte and p.estado = 'pendiente'
                   and p.buscador = 'PEUEBA' and p.mensaje_id is not null)
    and exists (select 1 from public.mensajes m
                 where m.id = (select mensaje_id from public.chat_partes
                                where id = v_parte)
                   and m.de = 'PEUEBA' and m.para = 'ADMIN'
                   and m.adj_tipo = 'parte'
                   and (m.adj_datos::jsonb ->> 'estado') = 'pendiente'
                   and (m.adj_datos::jsonb ->> 'parte_id') = v_parte::text),
    'r=' || coalesce(v_r::text, 'null'));

  -- ---------- C2 · op_id repetido no duplica ----------
  v_r := public.parte_crear('PEUEBA', 'saldo', 1000, 2000, '53957338',
                            'banco-parte-1', false);
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C2 op_id repetido no duplica',
    coalesce((v_r ->> 'repetida')::boolean, false)
    and (v_r ->> 'parte_id')::uuid = v_parte
    and (select count(*) from public.chat_partes
          where op_id = 'banco-parte-1') = 1
    and (select count(*) from public.mensajes
          where op_id = 'banco-parte-1') = 1,
    'r=' || coalesce(v_r::text, 'null'));

  -- ---------- C3 · confirmar crea UNA espera; re-confirmar no duplica ----------
  v_r := public.parte_confirmar('ADMIN', v_cod, v_parte, 'banco-conf-1');
  v_espera := (v_r ->> 'espera_id')::uuid;
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C3 confirmar crea una espera',
    coalesce((v_r ->> 'ok')::boolean, false)
    and v_espera is not null
    and exists (select 1 from public.dinero_esperas e
                 where e.id = v_espera and e.buscador_codigo = 'PEUEBA'
                   and e.estado = 'abierta' and e.capital_cup = 2000)
    and exists (select 1 from public.chat_partes p
                 where p.id = v_parte and p.estado = 'confirmada'
                   and p.espera_id = v_espera
                   and p.confirmado_en is not null),
    'r=' || coalesce(v_r::text, 'null'));

  v_r := public.parte_confirmar(v_cod, null, v_parte, 'banco-conf-2');
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C3b re-confirmar no duplica',
    coalesce((v_r ->> 'ok')::boolean, false)
    and coalesce((v_r ->> 'repetida')::boolean, false)
    and (v_r ->> 'espera_id')::uuid = v_espera
    and (select count(*) from public.dinero_esperas
          where buscador_codigo = 'PEUEBA' and es_prueba = false
            and estado = 'abierta') = 1,
    'r=' || coalesce(v_r::text, 'null'));

  -- ---------- C4 · parte_leer: dueño del parte y ADMIN sí; ajeno no ----------
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C4 parte_leer autorizaciones',
    coalesce((public.parte_leer('PEUEBA', v_parte) ->> 'ok')::boolean, false)
    and (public.parte_leer('PEUEBA', v_parte) ->> 'estado') = 'confirmada'
    and coalesce((public.parte_leer(v_cod, v_parte) ->> 'ok')::boolean, false)
    and not coalesce((public.parte_leer('BRIKU-EUX', v_parte) ->> 'ok')::boolean, false)
    and (public.parte_leer('BRIKU-EUX', v_parte) ->> 'motivo') = 'no_autorizado',
    'ajeno=' || coalesce(public.parte_leer('BRIKU-EUX', v_parte)::text, 'null'));

  -- ---------- C5 · buscador NO se auto-confirma ----------
  v_r := public.parte_crear('PEUEBA', 'saldo', 1000, 3000, '53957338',
                            'banco-parte-3', true);
  v_parte3 := (v_r ->> 'parte_id')::uuid;
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C5 buscador no se auto-confirma',
    coalesce((v_r ->> 'ok')::boolean, false)
    and v_r ->> 'estado' = 'pendiente'
    and (v_r ->> 'espera_id') is null
    and exists (select 1 from public.chat_partes p
                 where p.id = v_parte3 and p.estado = 'pendiente'
                   and p.espera_id is null),
    'r=' || coalesce(v_r::text, 'null'));

  -- ---------- C6 · buscador NO puede confirmar ni rechazar ----------
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C6 buscador no confirma (no_autorizado)',
    (public.parte_confirmar('PEUEBA', 'PEUEBA', v_parte3, 'banco-conf-x') ->> 'motivo') = 'no_autorizado'
    and (public.parte_rechazar('PEUEBA', 'PEUEBA', v_parte3, 'x', 'banco-rech-x') ->> 'motivo') = 'no_autorizado'
    and exists (select 1 from public.chat_partes p
                 where p.id = v_parte3 and p.estado = 'pendiente'),
    'ok');

  -- ---------- C7 · rechazar NO crea espera ----------
  select count(*) into v_esp_antes from public.dinero_esperas
   where buscador_codigo = 'PEUEBA' and es_prueba = false;
  v_r := public.parte_rechazar('ADMIN', v_cod, v_parte3, 'precio malo',
                               'banco-rech-1');
  select count(*) into v_esp_despues from public.dinero_esperas
   where buscador_codigo = 'PEUEBA' and es_prueba = false;
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C7 rechazar no crea espera',
    coalesce((v_r ->> 'ok')::boolean, false)
    and v_esp_antes = v_esp_despues
    and exists (select 1 from public.chat_partes p
                 where p.id = v_parte3 and p.estado = 'rechazada'
                   and p.espera_id is null
                   and p.motivo_rechazo = 'precio malo'),
    'r=' || coalesce(v_r::text, 'null'));

  -- ---------- C8 · sobre el efectivo libre: rechazado SIN escribir ----------
  v_r := public.parte_crear('PEUEBA', 'saldo', 1000, 99999999, '53957338',
                            'banco-parte-sobre', false);
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C8 sobre libre rechazado sin escribir',
    not coalesce((v_r ->> 'ok')::boolean, false)
    and (v_r ->> 'motivo') = 'supera_tu_efectivo'
    and not exists (select 1 from public.chat_partes
                     where op_id = 'banco-parte-sobre')
    and not exists (select 1 from public.mensajes
                     where op_id = 'banco-parte-sobre'),
    'r=' || coalesce(v_r::text, 'null'));

  -- ---------- C9 · dueño crea parte CONFIRMADA (espera en la misma txn) ----------
  v_r := public.parte_crear(v_cod, 'saldo', 1000, 4000, '53957338',
                            'banco-parte-dueno', true, 'PEUEBA');
  v_parte_d := (v_r ->> 'parte_id')::uuid;
  v_espera_d := (v_r ->> 'espera_id')::uuid;
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C9 dueño crea parte confirmada + espera',
    coalesce((v_r ->> 'ok')::boolean, false)
    and v_r ->> 'estado' = 'confirmada'
    and v_espera_d is not null
    and exists (select 1 from public.dinero_esperas e
                 where e.id = v_espera_d and e.buscador_codigo = 'PEUEBA'
                   and e.estado = 'abierta' and e.capital_cup = 4000)
    and exists (select 1 from public.mensajes m
                 join public.chat_partes p on p.mensaje_id = m.id
                 where p.id = v_parte_d and m.adj_tipo = 'parte'
                   and (m.adj_datos::jsonb ->> 'estado') = 'confirmada'),
    'r=' || coalesce(v_r::text, 'null'));

  -- ---------- C10 · difusión a N activos con dedupe ----------
  select count(*) into v_activos from public.usuarios where activo = true;
  v_r := public.enviar_mensaje_todos('ADMIN', v_cod, 'banco difusión',
                                     null, null, null, null, null,
                                     'banco-dif-1');
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C10 difusión a N activos',
    coalesce((v_r ->> 'ok')::boolean, false)
    and (v_r ->> 'enviados')::int = v_activos
    and (select count(*) from public.mensajes
          where op_id like 'banco-dif-1#%') = v_activos,
    'r=' || coalesce(v_r::text, 'null') || ' activos=' || v_activos);

  v_r := public.enviar_mensaje_todos(v_cod, null, 'banco difusión',
                                     null, null, null, null, null,
                                     'banco-dif-1');
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C10b difusión repetida no duplica',
    coalesce((v_r ->> 'ok')::boolean, false)
    and (v_r ->> 'enviados')::int = 0
    and (select count(*) from public.mensajes
          where op_id like 'banco-dif-1#%') = v_activos,
    'r=' || coalesce(v_r::text, 'null'));

  -- ---------- C11 · humo: enviar_mensaje de siempre + su dedupe ----------
  v_r := public.enviar_mensaje('PEUEBA', 'ADMIN', 'hola banco', 'PEUEBA',
                               null, null, null, null, null, null,
                               'banco-msg-1');
  v_msg := (v_r ->> 'id')::bigint;
  v_r := public.enviar_mensaje('PEUEBA', 'ADMIN', 'hola banco', 'PEUEBA',
                               null, null, null, null, null, null,
                               'banco-msg-1');
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C11 enviar_mensaje intacto + duplicado',
    (v_r ->> 'id')::bigint = v_msg
    and coalesce((v_r ->> 'duplicado')::boolean, false)
    and (select count(*) from public.mensajes
          where op_id = 'banco-msg-1') = 1,
    'r=' || coalesce(v_r::text, 'null'));

  -- ---------- C12 · enviar_mensaje acepta adj_tipo='tarifa' ----------
  v_r := public.enviar_mensaje('ADMIN', 'PEUEBA', '', v_cod,
                               'tarifa', null, null,
                               '{"ingresoRef360":1000,"salidaRef":920}',
                               null, null, 'banco-tarifa-1');
  v_tarifa_msg := (v_r ->> 'id')::bigint;
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C12 enviar_mensaje adj tarifa',
    coalesce((v_r ->> 'ok')::boolean, false)
    and exists (select 1 from public.mensajes m
                 where m.id = v_tarifa_msg and m.adj_tipo = 'tarifa'
                   and (m.adj_datos::jsonb ->> 'salidaRef') = '920'),
    'r=' || coalesce(v_r::text, 'null'));

  -- ---------- C13 · leer_chat expone fijado_tipo + fijado_id ----------
  perform public.fijar_mensaje(v_cod, 'PEUEBA', v_tarifa_msg);
  v_chat := public.leer_chat('ADMIN', 'PEUEBA', v_cod, null);
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C13 leer_chat fijado_tipo/fijado_id',
    (v_chat ->> 'fijado_tipo') = 'tarifa'
    and (v_chat ->> 'fijado_id')::bigint = v_tarifa_msg
    and v_chat ? 'mensajes' and v_chat ? 'ok',
    'fijado_tipo=' || coalesce(v_chat ->> 'fijado_tipo', 'null'));

  -- ---------- C14 · humo: espera_crear_app intacta ----------
  v_r := public.espera_crear_app('PEUEBA', 'saldo', 1000, 1000, null);
  v_n := v_n + 1;
  insert into banco_res values (v_n, 'C14 espera_crear_app intacta',
    coalesce((v_r ->> 'ok')::boolean, false)
    and (v_r ->> 'espera_id') is not null,
    'r=' || coalesce(v_r::text, 'null'));
end;
$banco$;

select n, nombre, ok, detalle from banco_res order by n;
rollback;

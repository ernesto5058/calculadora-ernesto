-- BANCO TRANSACCIONAL — REPARTO DE CAPITAL + DEVOLUCIÓN (v27, 2026-11-15)
-- Contrato: la entrega sale de la mano de Ernesto (inversión primero,
-- fondo pa el resto) y entra al cupo del buscador, con fila en
-- dinero_entregas; es idempotente por cliente_id y no pasa de la
-- mano ni rompe la regla de billetes (×500). La solicitud de
-- devolución NO mueve el libro; el «Recibido» mueve una sola vez;
-- el rechazo no mueve nada; no se devuelve más que lo devolvible
-- (mano − solicitudes pendientes). El cierre confirmado con la
-- mano en 0 y sin entregas abiertas marca el cupo cerrado, y una
-- entrega nueva lo reabre.
-- Todo corre dentro de BEGIN…ROLLBACK sobre la partición de prueba:
-- nada toca producción. El código admin se lee dentro de la sesión
-- y jamás sale en los resultados.
begin;
create temp table banco_res(n int, paso text, ok boolean, dato jsonb) on commit drop;
create temp table banco_ctx on commit drop as
  select valor as admin from public.admin_config where clave = 'codigo_admin';

-- Siembra de la mano de prueba: inversión 20.000 + fondo 1.000.
select public.dinero_mover('ernesto_inversion','siembra_banco', 20000, 'efectivo', 'banco-reparto', 'banco v27', true);
select public.dinero_mover('fondo','siembra_banco', 1000, 'efectivo', 'banco-reparto', 'banco v27', true);

-- 01 · Entrega de 10.000 a PEUEBA: las dos patas cuadran.
do $$
declare a text := (select admin from banco_ctx); r jsonb; e text;
begin
  begin r := public.dinero_entregar_capital(a, 'PEUEBA', 10000, 'efectivo', 'banco-op-1', true);
  exception when others then e := sqlerrm; end;
  insert into banco_res values (1, 'entrega 10000 ok', e is null and (r->>'ok')::boolean
    and public.dinero_saldo('cupo:PEUEBA', true) = 10000
    and public.dinero_saldo('ernesto_inversion', true) = 10000
    and public.dinero_saldo('fondo', true) = 1000
    and (select monto_pendiente from public.dinero_entregas where cliente_id = 'banco-op-1') = 10000
    and (public.dinero_cupo_resumen('PEUEBA', true)->>'trabajando')::bigint = 10000,
    jsonb_build_object('r', r, 'err', e));
end $$;

-- 02 · La misma entrega con el mismo cliente_id NO duplica.
do $$
declare a text := (select admin from banco_ctx); r jsonb; e text;
begin
  begin r := public.dinero_entregar_capital(a, 'PEUEBA', 10000, 'efectivo', 'banco-op-1', true);
  exception when others then e := sqlerrm; end;
  insert into banco_res values (2, 'entrega repetida no duplica', e is null and (r->>'repetida')::boolean
    and public.dinero_saldo('cupo:PEUEBA', true) = 10000
    and (select count(*) from public.dinero_entregas where cliente_id = 'banco-op-1') = 1
    and (select count(*) from public.dinero_movimientos where tipo = 'entrega' and es_prueba and referencia =
           (select id::text from public.dinero_entregas where cliente_id = 'banco-op-1')) = 2,
    jsonb_build_object('r', r, 'err', e));
end $$;

-- 03 · Monto que no es múltiplo de 500: rechazado.
do $$
declare a text := (select admin from banco_ctx); r jsonb; e text;
begin
  begin r := public.dinero_entregar_capital(a, 'PEUEBA', 10300, 'efectivo', 'banco-op-x', true);
  exception when others then e := sqlerrm; end;
  insert into banco_res values (3, 'entrega 10300 rechazada (billetes)',
    e is not null and e like '%multiplo de 500%' and public.dinero_saldo('cupo:PEUEBA', true) = 10000,
    jsonb_build_object('err', e));
end $$;

-- 04 · Entrega mayor que la mano (11.000): rechazada.
do $$
declare a text := (select admin from banco_ctx); r jsonb; e text;
begin
  begin r := public.dinero_entregar_capital(a, 'PEUEBA', 11500, 'efectivo', 'banco-op-y', true);
  exception when others then e := sqlerrm; end;
  insert into banco_res values (4, 'entrega sobre la mano rechazada',
    e is not null and e like '%mano no alcanza%' and public.dinero_saldo('cupo:PEUEBA', true) = 10000,
    jsonb_build_object('err', e));
end $$;

-- 05 · Sin código admin no hay entrega.
do $$
declare r jsonb; e text;
begin
  begin r := public.dinero_entregar_capital('CODIGO-FALSO', 'PEUEBA', 5000, 'efectivo', 'banco-op-z', true);
  exception when others then e := sqlerrm; end;
  insert into banco_res values (5, 'entrega sin admin rechazada',
    e is not null and e like '%admin%' and public.dinero_saldo('cupo:PEUEBA', true) = 10000,
    jsonb_build_object('err', e));
end $$;

-- 06 · El buscador solicita devolver 4.000: nace pendiente y NO mueve el libro.
do $$
declare r jsonb; e text;
begin
  begin r := public.dinero_registrar_devolucion_efectivo('PEUEBA', 'PEUEBA', 4000, 'efectivo', true, false, 'banco-dev-1');
  exception when others then e := sqlerrm; end;
  insert into banco_res values (6, 'solicitud 4000 pendiente sin mover saldos', e is null
    and (r->>'estado') = 'pendiente'
    and public.dinero_saldo('cupo:PEUEBA', true) = 10000
    and (public.dinero_cupo_resumen('PEUEBA', true)->>'pendientes')::bigint = 4000
    and (public.dinero_cupo_resumen('PEUEBA', true)->>'devolvible')::bigint = 6000,
    jsonb_build_object('r', r, 'err', e));
end $$;

-- 07 · La misma solicitud con el mismo cliente_id NO duplica.
do $$
declare r jsonb; e text;
begin
  begin r := public.dinero_registrar_devolucion_efectivo('PEUEBA', 'PEUEBA', 4000, 'efectivo', true, false, 'banco-dev-1');
  exception when others then e := sqlerrm; end;
  insert into banco_res values (7, 'solicitud repetida no duplica', e is null and (r->>'repetida')::boolean
    and (select count(*) from public.dinero_devoluciones where cliente_id = 'banco-dev-1') = 1,
    jsonb_build_object('r', r, 'err', e));
end $$;

-- 08 · Solicitar 7.000 con 6.000 devolvibles: rechazado.
do $$
declare r jsonb; e text;
begin
  begin r := public.dinero_registrar_devolucion_efectivo('PEUEBA', 'PEUEBA', 7000, 'efectivo', true, false, 'banco-dev-x');
  exception when others then e := sqlerrm; end;
  insert into banco_res values (8, 'solicitud sobre lo devolvible rechazada',
    e is not null and e like '%supera el dinero en su mano%',
    jsonb_build_object('err', e));
end $$;

-- 09 · Otro buscador no puede solicitar por PEUEBA.
do $$
declare r jsonb; e text;
begin
  begin r := public.dinero_registrar_devolucion_efectivo('ABRAHAM-X30', 'PEUEBA', 1000, 'efectivo', true, false, 'banco-dev-y');
  exception when others then e := sqlerrm; end;
  insert into banco_res values (9, 'solicitud ajena rechazada',
    e is not null and e like '%sin permiso%', jsonb_build_object('err', e));
end $$;

-- 10 · «Recibido» de los 4.000: mueve una vez y consume la entrega FIFO.
do $$
declare a text := (select admin from banco_ctx); r jsonb; e text;
  v_dev uuid := (select id from public.dinero_devoluciones where cliente_id = 'banco-dev-1');
begin
  begin r := public.dinero_confirmar_recibido(a, v_dev);
  exception when others then e := sqlerrm; end;
  insert into banco_res values (10, 'recibido mueve cupo->inversion y FIFO', e is null
    and public.dinero_saldo('cupo:PEUEBA', true) = 6000
    and public.dinero_saldo('ernesto_inversion', true) = 14000
    and (select monto_pendiente from public.dinero_entregas where cliente_id = 'banco-op-1') = 6000
    and (select estado from public.dinero_devoluciones where id = v_dev) = 'confirmada',
    jsonb_build_object('r', r, 'err', e));
end $$;

-- 11 · «Recibido» repetido: ok sin doble movimiento (riel del outbox).
do $$
declare a text := (select admin from banco_ctx); r jsonb; e text;
  v_dev uuid := (select id from public.dinero_devoluciones where cliente_id = 'banco-dev-1');
begin
  begin r := public.dinero_confirmar_recibido(a, v_dev);
  exception when others then e := sqlerrm; end;
  insert into banco_res values (11, 'recibido repetido no duplica', e is null and (r->>'repetida')::boolean
    and public.dinero_saldo('cupo:PEUEBA', true) = 6000
    and (select count(*) from public.dinero_movimientos where tipo = 'devolucion_efectivo' and es_prueba and referencia = v_dev::text) = 2,
    jsonb_build_object('r', r, 'err', e));
end $$;

-- 12 · Rechazo de una solicitud de 6.000: queda rechazada y nada se mueve.
do $$
declare a text := (select admin from banco_ctx); r jsonb; r2 jsonb; e text;
  v_dev uuid;
begin
  begin r := public.dinero_registrar_devolucion_efectivo('PEUEBA', 'PEUEBA', 6000, 'efectivo', true, false, 'banco-dev-2');
  exception when others then e := sqlerrm; end;
  v_dev := (r->>'devolucion')::uuid;
  begin r2 := public.dinero_rechazar_devolucion(a, v_dev);
  exception when others then e := coalesce(e, sqlerrm); end;
  insert into banco_res values (12, 'rechazo sin mover saldos', e is null
    and (select estado from public.dinero_devoluciones where id = v_dev) = 'rechazada'
    and public.dinero_saldo('cupo:PEUEBA', true) = 6000
    and (public.dinero_cupo_resumen('PEUEBA', true)->>'pendientes')::bigint = 0
    and (public.dinero_cupo_resumen('PEUEBA', true)->>'devolvible')::bigint = 6000,
    jsonb_build_object('r', r2, 'err', e));
end $$;

-- 13 · Confirmar una rechazada: imposible. Rechazarla otra vez: ok repetida.
do $$
declare a text := (select admin from banco_ctx); r jsonb; e1 text; e2 text; r2 jsonb;
  v_dev uuid := (select id from public.dinero_devoluciones where cliente_id = 'banco-dev-2');
begin
  begin r := public.dinero_confirmar_recibido(a, v_dev);
  exception when others then e1 := sqlerrm; end;
  begin r2 := public.dinero_rechazar_devolucion(a, v_dev);
  exception when others then e2 := sqlerrm; end;
  insert into banco_res values (13, 'rechazada no se confirma; re-rechazo ok',
    e1 is not null and e2 is null and (r2->>'repetida')::boolean
    and public.dinero_saldo('cupo:PEUEBA', true) = 6000,
    jsonb_build_object('err1', e1, 'err2', e2));
end $$;

-- 14 · Cierre: solicita los 6.000 como cierre y Ernesto lo recibe → cupo cerrado.
do $$
declare a text := (select admin from banco_ctx); r jsonb; r2 jsonb; e text;
  v_dev uuid;
begin
  begin r := public.dinero_registrar_devolucion_efectivo('PEUEBA', 'PEUEBA', 6000, 'efectivo', true, true, 'banco-dev-3');
  exception when others then e := sqlerrm; end;
  v_dev := (r->>'devolucion')::uuid;
  begin r2 := public.dinero_confirmar_recibido(a, v_dev);
  exception when others then e := coalesce(e, sqlerrm); end;
  insert into banco_res values (14, 'cierre confirmado marca cupo cerrado', e is null
    and public.dinero_saldo('cupo:PEUEBA', true) = 0
    and (select monto_pendiente from public.dinero_entregas where cliente_id = 'banco-op-1') = 0
    and (select estado from public.dinero_entregas where cliente_id = 'banco-op-1') = 'devuelto_efectivo'
    and (public.dinero_cupo_resumen('PEUEBA', true)->>'cerrado')::boolean,
    jsonb_build_object('r', r2, 'err', e));
end $$;

-- 15 · Una entrega nueva reabre el cupo cerrado.
do $$
declare a text := (select admin from banco_ctx); r jsonb; e text;
begin
  begin r := public.dinero_entregar_capital(a, 'PEUEBA', 5000, 'efectivo', 'banco-op-3', true);
  exception when others then e := sqlerrm; end;
  insert into banco_res values (15, 'entrega nueva reabre el cupo', e is null
    and public.dinero_saldo('cupo:PEUEBA', true) = 5000
    and not (public.dinero_cupo_resumen('PEUEBA', true)->>'cerrado')::boolean,
    jsonb_build_object('r', r, 'err', e));
end $$;

-- 16 · La foto del capital (puerta del dueño) cuadra con el libro.
do $$
declare a text := (select admin from banco_ctx); r jsonb; e text; c jsonb;
begin
  begin r := public.dinero_capital_estado(a, true);
  exception when others then e := sqlerrm; end;
  select x into c from jsonb_array_elements(r->'cupos') x where x->>'buscador' = 'PEUEBA';
  insert into banco_res values (16, 'capital_estado cuadra', e is null
    and (r->>'en_mano')::bigint = 16000
    and (c->'resumen'->>'en_mano')::bigint = 5000
    and jsonb_array_length(r->'solicitudes') = 0,
    jsonb_build_object('en_mano', r->'en_mano', 'err', e));
end $$;

-- 17 · leer_estado aditivo: el buscador trae 'capital' y sus
-- devoluciones traen es_cierre; el dueño trae es_cierre en pendientes.
do $$
declare a text := (select admin from banco_ctx); e text;
  v_b jsonb; v_a jsonb; v_pend jsonb;
begin
  -- una solicitud viva pa que el dueño tenga una pendiente que mirar
  perform public.dinero_registrar_devolucion_efectivo('PEUEBA', 'PEUEBA', 1000, 'efectivo', true, true, 'banco-dev-4');
  v_b := public.dinero_leer_estado('PEUEBA', true);
  v_a := public.dinero_leer_estado(a, true);
  v_pend := v_a->'devoluciones_pendientes';
  insert into banco_res values (17, 'leer_estado con capital y es_cierre',
    v_b ? 'capital'
    and (v_b->'capital'->>'devolvible')::bigint = 4000
    and (v_b->'devoluciones'->0) ? 'es_cierre'
    and jsonb_array_length(v_pend) = 1
    and (v_pend->0->>'es_cierre')::boolean,
    jsonb_build_object('pend', v_pend));
end $$;

select n, paso, ok, dato from banco_res order by n;
rollback;

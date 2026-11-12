-- =====================================================================
-- AGENTE v3 — CATÁLOGO con descripción y tipo + escalado POR TEMA
-- (2026-11-12)
--
-- 1) agente_catalogo gana DESCRIPCIÓN completa (qué es, para qué
--    sirve, cómo se hace) y TIPO: producto | servicio | compra.
--    Hasta hoy el agente solo conocía nombre/precio/nota corta; con
--    la descripción puede EXPLICAR cada cosa sin inventar.
-- 2) Semilla fiel a las fuentes vivas: las 4 filas existentes reciben
--    tipo+descripción y entran DOS compras nuevas —
--    compro_saldo (precios PÚBLICOS de agente_fuente
--    «tarifa_publica_saldo»: al 2, más de 5.000 al 2.2, recarga de
--    360 a 720 CUP, domicilio gratis) y transferencia (compra por
--    transferencia SOLO con conocidos; el % exacto lo confirma
--    Ernesto en cada trato — NO hay cifra pública y no se inventa).
-- 3) agente_conversaciones gana temas_escalados (jsonb []): el
--    escalado de la v3 es POR TEMA, no por conversación entera.
-- 4) Puerta ÚNICA de escritura del catálogo: agente_catalogo_guardar
--    (hermana de agente_cita_cerrar: verifica al dueño contra
--    agente_config.dueno_tg_id y audita en agente_acciones).
-- 5) Lectura pública: agente_catalogo_publico() — SOLO activas, pa
--    que la paginita lea el MISMO catálogo que lee el agente.
-- Idempotente: se puede correr dos veces sin daño.
-- =====================================================================

-- ---------- 1) Columnas nuevas ----------
alter table public.agente_catalogo
  add column if not exists descripcion text,
  add column if not exists tipo text not null default 'producto';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'agente_catalogo_tipo_check'
       and conrelid = 'public.agente_catalogo'::regclass
  ) then
    alter table public.agente_catalogo
      add constraint agente_catalogo_tipo_check
      check (tipo in ('producto', 'servicio', 'compra'));
  end if;
end;
$$;

alter table public.agente_conversaciones
  add column if not exists temas_escalados jsonb not null default '[]'::jsonb;

-- ---------- 2) Semilla (upsert por clave) ----------
insert into public.agente_catalogo
  (clave, nombre, precio, moneda, precio_al_privado, estado, nota,
   descripcion, tipo, activo, actualizado_en, actualizado_por)
values
  ('corte', 'Corte de cabello', 400, 'CUP', false, 'hay',
   'Precio en efectivo. Por transferencia: 700 CUP.',
   'Corte de cabello en la barbería de Ernesto, en Micro 10, distrito José Martí, Santiago de Cuba. Abre todos los días de 9:00 a 18:00. Cuesta 400 CUP pagando en efectivo y 700 CUP pagando por transferencia. La cita se agenda hablando con este asistente y Ernesto la confirma.',
   'servicio', true, now(), 'v3'),
  ('corte_transferencia', 'Corte de cabello (por transferencia)', 700, 'CUP', false, 'hay',
   'Precio del corte pagando por transferencia.',
   'El mismo corte de cabello de la barbería de Ernesto (Micro 10, distrito José Martí, Santiago de Cuba, todos los días de 9:00 a 18:00), pagando por transferencia: 700 CUP. En efectivo cuesta 400 CUP. La cita se agenda con este asistente y Ernesto la confirma.',
   'servicio', true, now(), 'v3'),
  ('lavadora_hys', 'Lavadora HYS 7 kg', 250, 'USD', false, 'hay',
   'Semiautomática con Air-Dry. Garantía de 1 año. Domicilio incluido en Santiago.',
   'Lavadora semiautomática HYS de 7 kg con función Air-Dry (secado por aire). Cuesta 250 USD, con garantía de 1 año y domicilio incluido en Santiago de Cuba. Ernesto confirma la disponibilidad y cierra la venta directamente.',
   'producto', true, now(), 'v3'),
  ('bateria_lifepo4', 'Batería LiFePO4 12.8V 100Ah', null, null, true, 'hay',
   'Precio al privado con Ernesto.',
   'Batería LiFePO4 de 12.8V y 100Ah, para inversores y respaldo eléctrico de la casa (apagones). El precio se consulta al privado con Ernesto, que confirma disponibilidad y cierra la venta directamente.',
   'producto', true, now(), 'v3'),
  ('compro_saldo', 'Compra de saldo móvil', null, 'CUP', false, 'hay',
   'Ernesto COMPRA saldo: paga en efectivo al 2 (más de 5.000 al 2.2). Recarga de 360 a 720 CUP. Domicilio gratis.',
   'Ernesto COMPRA saldo móvil (él no vende saldo): tú le vendes tu saldo y él te paga EN EFECTIVO al momento. Paga a 2 CUP por cada 1 de saldo: por ejemplo, 1.000 de saldo = 2.000 CUP y 5.000 de saldo = 10.000 CUP. Si el monto pasa de 5.000 de saldo, paga a 2.2 por cada 1. También compra recargas de 360 a 720 CUP cada una. El domicilio es gratis para recoger el saldo y pagar. Zona: Micro 10, distrito José Martí, Santiago de Cuba. El trato final lo cierras con Ernesto directamente.',
   'compra', true, now(), 'v3'),
  ('transferencia', 'Compra de transferencia', null, 'CUP', false, 'hay',
   'Ernesto compra saldo por transferencia y paga en efectivo con descuento. Solo personas conocidas; el % lo confirma Ernesto.',
   'Ernesto también compra saldo por transferencia: él recibe la transferencia y paga en efectivo con un descuento sobre el monto. Trabaja solo con personas conocidas. El porciento exacto de cada trato lo confirma Ernesto directamente al cerrar el trato.',
   'compra', true, now(), 'v3')
on conflict (clave) do update
  set nombre = excluded.nombre,
      precio = excluded.precio,
      moneda = excluded.moneda,
      precio_al_privado = excluded.precio_al_privado,
      estado = excluded.estado,
      nota = excluded.nota,
      descripcion = excluded.descripcion,
      tipo = excluded.tipo,
      activo = excluded.activo,
      actualizado_en = now(),
      actualizado_por = 'v3';

-- ---------- 3) Puerta única de escritura del catálogo ----------
create or replace function public.agente_catalogo_guardar(
  p_dueno_tg_id text, p_accion text, p_clave text,
  p_nombre text default null, p_precio numeric default null,
  p_moneda text default null, p_precio_al_privado boolean default null,
  p_estado text default null, p_nota text default null,
  p_descripcion text default null, p_tipo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.agente_catalogo%rowtype;
  v_clave text;
begin
  if p_dueno_tg_id is null or not exists (
    select 1 from public.agente_config
     where dueno_tg_id = p_dueno_tg_id
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'no_dueno');
  end if;
  if p_accion is null or p_accion not in ('crear', 'editar', 'activar', 'desactivar') then
    return jsonb_build_object('ok', false, 'motivo', 'accion_invalida');
  end if;
  if p_tipo is not null and p_tipo not in ('producto', 'servicio', 'compra') then
    return jsonb_build_object('ok', false, 'motivo', 'tipo_invalido');
  end if;

  if p_accion = 'crear' then
    v_clave := nullif(btrim(coalesce(p_clave, '')), '');
    if v_clave is null then
      if p_nombre is null or btrim(p_nombre) = '' then
        return jsonb_build_object('ok', false, 'motivo', 'falta_nombre');
      end if;
      -- Clave desde el nombre: minúsculas, sin acentos, [a-z0-9_].
      v_clave := regexp_replace(
        regexp_replace(
          translate(lower(p_nombre),
            'áéíóúàèìòùâêîôûäëïöüñ',
            'aeiouaeiouaeiouaeioun'),
          '[^a-z0-9]+', '_', 'g'),
        '^_+|_+$', '', 'g');
      if v_clave = '' then
        return jsonb_build_object('ok', false, 'motivo', 'falta_clave');
      end if;
    end if;
    if p_nombre is null or btrim(p_nombre) = '' then
      return jsonb_build_object('ok', false, 'motivo', 'falta_nombre');
    end if;
    if exists (select 1 from public.agente_catalogo where clave = v_clave) then
      return jsonb_build_object('ok', false, 'motivo', 'clave_existe', 'clave', v_clave);
    end if;
    insert into public.agente_catalogo
      (clave, nombre, precio, moneda, precio_al_privado, estado, nota,
       descripcion, tipo, activo, actualizado_en, actualizado_por)
    values
      (v_clave, p_nombre, p_precio, p_moneda,
       coalesce(p_precio_al_privado, false), coalesce(p_estado, 'hay'),
       p_nota, p_descripcion, coalesce(p_tipo, 'producto'), true,
       now(), 'dueno_bot')
    returning * into v;

  elsif p_accion = 'editar' then
    select * into v from public.agente_catalogo where clave = p_clave;
    if v.id is null then
      return jsonb_build_object('ok', false, 'motivo', 'no_existe');
    end if;
    -- Parche: solo se tocan los campos que vienen no nulos.
    update public.agente_catalogo
       set nombre = coalesce(p_nombre, nombre),
           precio = coalesce(p_precio, precio),
           moneda = coalesce(p_moneda, moneda),
           precio_al_privado = coalesce(p_precio_al_privado, precio_al_privado),
           estado = coalesce(p_estado, estado),
           nota = coalesce(p_nota, nota),
           descripcion = coalesce(p_descripcion, descripcion),
           tipo = coalesce(p_tipo, tipo),
           actualizado_en = now(),
           actualizado_por = 'dueno_bot'
     where clave = p_clave
     returning * into v;

  else  -- activar / desactivar
    select * into v from public.agente_catalogo where clave = p_clave;
    if v.id is null then
      return jsonb_build_object('ok', false, 'motivo', 'no_existe');
    end if;
    update public.agente_catalogo
       set activo = (p_accion = 'activar'),
           actualizado_en = now(),
           actualizado_por = 'dueno_bot'
     where clave = p_clave
     returning * into v;
  end if;

  insert into public.agente_acciones (tipo, detalle)
  values ('catalogo_guardar', jsonb_build_object(
    'accion', p_accion, 'clave', v.clave));

  return jsonb_build_object('ok', true, 'accion', p_accion, 'fila', to_jsonb(v));
end;
$$;
revoke all on function public.agente_catalogo_guardar(text, text, text, text, numeric, text, boolean, text, text, text, text) from public;
grant execute on function public.agente_catalogo_guardar(text, text, text, text, numeric, text, boolean, text, text, text, text) to service_role;

-- ---------- 4) Lectura pública del catálogo ----------
create or replace function public.agente_catalogo_publico()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'nombre', nombre,
        'clave', clave,
        'tipo', tipo,
        'precio', precio,
        'moneda', moneda,
        'precio_al_privado', precio_al_privado,
        'estado', estado,
        'nota', nota,
        'descripcion', descripcion)
      order by clave),
    '[]'::jsonb)
    from public.agente_catalogo
   where activo = true;
$$;
revoke all on function public.agente_catalogo_publico() from public;
grant execute on function public.agente_catalogo_publico() to anon, authenticated, service_role;

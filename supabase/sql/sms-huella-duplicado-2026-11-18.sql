-- DEDUPE POR HUELLA DE SALDO (cerebro v19, 2026-11-18).
-- Orden de Ernesto: con internet malo, ETECSA re-entrega el MISMO SMS
-- dos veces (caso real: 1080 del 50049642 con saldo resultante
-- 15910.08, dos copias idénticas en su hilo). Cada copia nace en un
-- archivo con client_uuid DISTINTO, así que el dedup por uuid no la
-- caza y el saldo se contaría doble.
-- La huella de una operación ejecutada es (tipo, contraparte,
-- monto_cup, saldo_principal_cup): el saldo resultante es el estado
-- de la línea tras la operación — dos operaciones reales distintas
-- no comparten huella salvo que el saldo vuelva EXACTAMENTE al mismo
-- valor con el mismo remitente y monto, y aun así la ventana de la
-- huella es de ±1 día (fecha_original): la re-entrega de la
-- operadora llega en minutos u horas, nunca dos días después.
-- La copia se guarda en sms_linea marcada con duplicado_de = id de
-- la fila original contada; no genera sms_eventos, esperas, ventas,
-- atribuciones ni movimientos de cadena por segunda vez.
alter table public.sms_linea
  add column if not exists duplicado_de bigint;

comment on column public.sms_linea.duplicado_de is
  'Dedupe por huella de saldo (cerebro v19, 2026-11-18): si esta fila es la copia re-entregada por la operadora de un SMS ya contado, apunta al id de la fila original contada. La copia queda como auditoria pero NO genera eventos, esperas, ventas ni atribuciones.';

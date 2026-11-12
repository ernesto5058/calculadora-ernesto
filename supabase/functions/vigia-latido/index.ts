// =====================================================================
// Edge Function «vigia-latido» — el latido de los vigías que corren
// FUERA de Supabase/GitHub (hoy: el respaldo diario, script local).
// Al terminar bien, el vigía hace POST {vigia} con el header
// x-vigia-latido y aquí queda su ultimo_ok en public.vigia_estado;
// el cobrador (vigia-cobrador) decide si la ausencia es una caída.
// Solo acepta vigías registrados con tipo «ping» (lista cerrada en
// la tabla: nada de crear vigías desde fuera).
//
// SECRETO: VIGIA_LATIDO_SECRET (header x-vigia-latido), en el llavero
// de la casa (fn-secrets.env) y en los Secrets de Edge Functions.
// =====================================================================

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LATIDO_SECRET = Deno.env.get("VIGIA_LATIDO_SECRET") ?? "";

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "solo_post" }, 405);
  if (!LATIDO_SECRET || req.headers.get("x-vigia-latido") !== LATIDO_SECRET) {
    return json({ ok: false, error: "no_autorizado" }, 401);
  }
  // deno-lint-ignore no-explicit-any
  let cuerpo: any = null;
  try { cuerpo = await req.json(); } catch { return json({ ok: false, error: "json_no_valido" }, 400); }
  const vigia = String(cuerpo?.vigia ?? "");
  if (!vigia) return json({ ok: false, error: "falta_vigia" }, 400);
  const filas = await fetch(
    `${SB_URL}/rest/v1/vigia_estado?vigia=eq.${encodeURIComponent(vigia)}&tipo=eq.ping&select=vigia`,
    {
      headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` },
      signal: AbortSignal.timeout(15000),
    },
  ).then((r) => (r.ok ? r.json() : []));
  if (!Array.isArray(filas) || !filas.length) {
    return json({ ok: false, error: "vigia_no_registrado_o_no_es_ping" }, 404);
  }
  const ahora = new Date().toISOString();
  const r = await fetch(
    `${SB_URL}/rest/v1/vigia_estado?vigia=eq.${encodeURIComponent(vigia)}`,
    {
      method: "PATCH",
      headers: {
        apikey: SB_SERVICE,
        Authorization: `Bearer ${SB_SERVICE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ultimo_ok: ahora }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!r.ok) return json({ ok: false, error: `supabase_http_${r.status}` }, 502);
  return json({ ok: true, vigia, ultimo_ok: ahora });
});

// Puente Móvil — las manos de Máximo en el Motorola de Ernesto (2026-11-15).
// Máximo encola comandos con x-maximo-token (POST {comando:{...}}).
// La app «Ojo Máximo» (servicio de accesibilidad que Ernesto activa)
// los reclama con x-ojo-token (GET /reclamar), ejecuta y reporta (POST /reporte).
// Comandos: arbol · tocar{x,y} · deslizar{x1,y1,x2,y2,ms} · escribir{texto}
//           abrir{paquete} · atras · inicio · recientes · estado
const E = (k: string) => Deno.env.get(k) ?? "";
const svc = () => ({
  "Authorization": `Bearer ${E("SUPABASE_SERVICE_ROLE_KEY")}`,
  "apikey": E("SUPABASE_SERVICE_ROLE_KEY"),
  "Content-Type": "application/json",
});
const TABLA = () => `${E("SUPABASE_URL")}/rest/v1/puente_movil_comandos`;

Deno.serve(async (req) => {
  try {
    const u = new URL(req.url);
    const esMaximo = E("OJO_READ_TOKEN") && req.headers.get("x-maximo-token") === E("OJO_READ_TOKEN");
    const esAparato = E("OJO_UPLOAD_TOKEN") && req.headers.get("x-ojo-token") === E("OJO_UPLOAD_TOKEN");

    if (req.method === "POST" && u.pathname.endsWith("/puente-movil") && esMaximo) {
      const body = await req.json();
      if (!body?.comando?.tipo) return Response.json({ ok: false, error: "falta comando.tipo" }, { status: 400 });
      const r = await fetch(TABLA(), {
        method: "POST",
        headers: { ...svc(), "Prefer": "return=representation" },
        body: JSON.stringify({ comando: body.comando }),
      });
      if (!r.ok) throw new Error(`insert ${r.status}: ${await r.text()}`);
      const fila = (await r.json())[0];
      return Response.json({ ok: true, id: fila.id });
    }

    if (req.method === "GET" && esMaximo) {
      const r = await fetch(`${TABLA()}?select=id,comando,estado,resultado,creado_en,hecho_en&order=creado_en.desc&limit=10`, { headers: svc() });
      if (!r.ok) throw new Error(`list ${r.status}`);
      return Response.json({ ok: true, items: await r.json() });
    }

    if (req.method === "GET" && u.pathname.includes("reclamar") && esAparato) {
      const r = await fetch(`${TABLA()}?estado=eq.pendiente&select=id,comando&order=creado_en.asc&limit=1`, { headers: svc() });
      if (!r.ok) throw new Error(`claim ${r.status}`);
      const filas = await r.json();
      if (!filas.length) return Response.json({ ok: true, vacio: true });
      const fila = filas[0];
      await fetch(`${TABLA()}?id=eq.${fila.id}`, {
        method: "PATCH",
        headers: svc(),
        body: JSON.stringify({ estado: "ejecutando" }),
      });
      return Response.json({ ok: true, id: fila.id, comando: fila.comando });
    }

    if (req.method === "POST" && u.pathname.includes("reporte") && esAparato) {
      const body = await req.json();
      if (!body?.id) return Response.json({ ok: false, error: "falta id" }, { status: 400 });
      const r = await fetch(`${TABLA()}?id=eq.${body.id}`, {
        method: "PATCH",
        headers: svc(),
        body: JSON.stringify({ estado: "hecho", resultado: String(body.resultado ?? ""), hecho_en: new Date().toISOString() }),
      });
      if (!r.ok) throw new Error(`report ${r.status}: ${await r.text()}`);
      return Response.json({ ok: true });
    }

    return new Response("no autorizado o ruta desconocida", { status: 401 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});

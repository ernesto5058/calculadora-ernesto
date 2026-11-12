// =====================================================================
// Edge Function «vigia-cobrador» — EL VIGÍA DE LOS VIGÍAS (Hueco 1 del
// estudio de huecos, 2026-11-12). La invoca pg_cron cada 5 minutos
// (job «vigia-cobrador-cada-5min», header x-vigia-cron con el secreto
// del vault). Evalúa la frescura de la última señal sana de cada vigía
// crítico y, SOLO si uno cae o se recupera, avisa al dueño por la
// función «avisos» (Telegram + push). En silencio total si todo late.
//
// Señales:
//  · Derivadas de la propia base: lector de Mercado (mercado_fotos) y
//    agrupador del Agente (cron.job_run_details) vía RPC vigia_senales_db.
//  · Derivadas de GitHub Actions (API con VIGIA_GH_PAT, PAT de repo):
//    última corrida «success» de vigia-mercado.yml y vigia-supabase.yml.
//  · Por ping: filas tipo «ping» de public.vigia_estado, cuyo ultimo_ok
//    actualiza la función vigia-latido (hoy: el respaldo diario).
// Estado y deduplicación viven en public.vigia_estado (en_alerta /
// ultimo_aviso; re-aviso a las 12 h si sigue caído). healthchecks.io
// queda como segunda capa externa pendiente de la cuenta de Ernesto:
// cuando exista, su ping se añade aquí sin tocar a los vigías.
//
// SECRETOS (Edge Functions -> Secrets; nunca en el repo):
//   VIGIA_CRON_SECRET   compartido con el vault (header x-vigia-cron)
//   VIGIA_GH_PAT        PAT de GitHub de solo el repo (leer Actions)
//   AVISOS_WEBHOOK_SECRET  el de la función avisos (compartido)
// =====================================================================

const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRON_SECRET = Deno.env.get("VIGIA_CRON_SECRET") ?? "";
const GH_PAT = Deno.env.get("VIGIA_GH_PAT") ?? "";
const AVISOS_SECRET = Deno.env.get("AVISOS_WEBHOOK_SECRET") ?? "";
const GH_REPO = "ernesto5058/calculadora-ernesto";

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// deno-lint-ignore no-explicit-any
async function sbRest(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SB_SERVICE,
      Authorization: `Bearer ${SB_SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`Supabase ${path}: HTTP ${r.status} ${txt.slice(0, 160)}`);
  return txt ? JSON.parse(txt) : null;
}

async function ultimoExitoGH(archivo: string): Promise<string | null> {
  if (!GH_PAT) return null;
  const r = await fetch(
    `https://api.github.com/repos/${GH_REPO}/actions/workflows/${archivo}/runs?status=completed&per_page=5`,
    {
      headers: {
        Authorization: `Bearer ${GH_PAT}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!r.ok) return null;
  const runs = (await r.json())?.workflow_runs ?? [];
  const ok = runs.find((x: { conclusion?: string }) => x.conclusion === "success");
  return ok?.updated_at ?? null;
}

async function avisar(titulo: string, cuerpo: string): Promise<boolean> {
  try {
    const r = await fetch(`${SB_URL}/functions/v1/avisos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SB_SERVICE}`,
        apikey: SB_SERVICE,
      },
      body: JSON.stringify({
        para: "ADMIN",
        titulo,
        cuerpo,
        secreto: AVISOS_SECRET,
      }),
      signal: AbortSignal.timeout(30000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "nunca";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "solo_post" }, 405);
  if (!CRON_SECRET || req.headers.get("x-vigia-cron") !== CRON_SECRET) {
    return json({ ok: false, error: "no_autorizado" }, 401);
  }
  const ahora = Date.now();
  const ahoraIso = new Date(ahora).toISOString();
  try {
    const [filas, senales, ghFoto, ghSupa] = await Promise.all([
      sbRest("vigia_estado?select=*"),
      sbRest("rpc/vigia_senales_db", { method: "POST", body: "{}" }),
      ultimoExitoGH("vigia-mercado.yml"),
      ultimoExitoGH("vigia-supabase.yml"),
    ]);
    const derivados: Record<string, string | null> = {
      "lector-mercado": senales?.lector_ultima_foto ?? null,
      "agrupador-agente": senales?.agrupador_ultimo_run ?? null,
      "foto-mercado": ghFoto,
      "vigia-supabase": ghSupa,
      "cobrador": ahoraIso,
    };
    const evaluados: unknown[] = [];
    const avisos: unknown[] = [];
    for (const f of filas ?? []) {
      const senal: string | null = f.tipo === "derivado"
        ? (derivados[f.vigia] ?? f.ultimo_ok ?? null)
        : (f.ultimo_ok ?? null);
      const parche: Record<string, unknown> = {};
      if (f.tipo === "derivado" && derivados[f.vigia] !== undefined) {
        parche.ultimo_ok = derivados[f.vigia];
      }
      if (f.vigia !== "cobrador") {
        const edadMin = senal ? (ahora - new Date(senal).getTime()) / 60000 : Infinity;
        const caido = edadMin > Number(f.ventana_min);
        if (caido && !f.en_alerta) {
          const enviado = await avisar(
            `🔴 Vigía caído: ${f.vigia}`,
            `${f.descripcion}. Sin señal sana desde ${fmt(senal)} ` +
              `(ventana permitida: ${f.ventana_min} min). Revisa ese frente cuando puedas.`,
          );
          if (enviado) {
            parche.en_alerta = true;
            parche.ultimo_aviso = ahoraIso;
            avisos.push({ vigia: f.vigia, tipo: "caida" });
          }
        } else if (
          caido && f.en_alerta && f.ultimo_aviso &&
          (ahora - new Date(f.ultimo_aviso).getTime()) > 12 * 3600000
        ) {
          const enviado = await avisar(
            `🔴 Vigía SIGUE caído: ${f.vigia}`,
            `${f.descripcion}. Lleva sin señal sana desde ${fmt(senal)}.`,
          );
          if (enviado) {
            parche.ultimo_aviso = ahoraIso;
            avisos.push({ vigia: f.vigia, tipo: "sigue_caido" });
          }
        } else if (!caido && f.en_alerta) {
          const enviado = await avisar(
            `✅ Vigía recuperado: ${f.vigia}`,
            `${f.descripcion}. Volvió a latir (señal de ${fmt(senal)}).`,
          );
          if (enviado) {
            parche.en_alerta = false;
            avisos.push({ vigia: f.vigia, tipo: "recuperado" });
          }
        }
        evaluados.push({
          vigia: f.vigia,
          senal,
          edad_min: senal ? Math.round(edadMin) : null,
          caido,
        });
      }
      if (Object.keys(parche).length) {
        await sbRest(`vigia_estado?vigia=eq.${encodeURIComponent(f.vigia)}`, {
          method: "PATCH",
          body: JSON.stringify(parche),
        });
      }
    }
    return json({ ok: true, evaluados, avisos });
  } catch (e) {
    return json({ ok: false, error: String(e).slice(0, 200) }, 500);
  }
});

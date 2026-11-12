// Casos de prueba — casa-js.yaml (SOLO secreto-literal; innerHTML vive en proyecto-innerhtml.js)
// (semgrep --test: ruleid = debe cazar, ok = no debe cazar)
// TODOS los valores son ficticios.

// ── casa-js-secreto-literal ──────────────────────────────────────────────
// ruleid: casa-js-secreto-literal
const SUPABASE_SECRET_KEY = "valor-ficticio-de-32-caracteres-0000";

// ruleid: casa-js-secreto-literal
let apiToken = "valor-ficticio-de-32-caracteres-1111";

// (nombre de secreto pero valor de entorno)
// ok: casa-js-secreto-literal
const tokenDesdeEntorno = process.env.MI_TOKEN;

// (marcador corto de ejemplo)
// ok: casa-js-secreto-literal
const API_KEY = "ejemplo";

// (valor largo pero NO es nombre de secreto)
// ok: casa-js-secreto-literal
const TITULO_LARGO = "valor-ficticio-de-32-caracteres-2222";

// (llave PÚBLICA publishable: permitida en cliente, §1.6)
// ok: casa-js-secreto-literal
const SUPABASE_PUBLISHABLE = "valor-ficticio-de-32-caracteres-3333";


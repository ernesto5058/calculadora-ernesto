// =====================================================================
// logica-ref.mjs — localiza e importa la logica.js REAL del agente
// SIN copiarla y SIN tocarla. Orden de búsqueda:
//   1. $AGENTE_LOGICA_PATH (override explícito)
//   2. Diseño local:  ~/workspace/promptfoo-agente/provider/ está a
//      tres niveles de ~/workspace/github-calculadora/supabase/…
//   3. Diseño repo:   promptfoo/provider/ está a tres niveles de la
//      raíz del repo, donde vive supabase/functions/agente-responder/
// Si un día la lógica se mueve, la batería FALLA en voz alta aquí —
// jamás evalúa una copia vieja en silencio.
// =====================================================================
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.AGENTE_LOGICA_PATH,
  path.resolve(here, "../../github-calculadora/supabase/functions/agente-responder/logica.js"),
  path.resolve(here, "../../supabase/functions/agente-responder/logica.js"),
].filter(Boolean);
const found = candidates.find((p) => existsSync(p));
if (!found) {
  throw new Error("[promptfoo-agente] logica.js del agente no encontrada. Busqué: " + candidates.join(" | "));
}
const L = await import(pathToFileURL(found).href);
export default L;
export const LOGICA_PATH = found;

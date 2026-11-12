# Puerta de main (ruleset) — pasos EXACTOS en la web de GitHub pa Ernesto

**Por qué a mano:** Máximo lo intentó por API el 2026-11-12 y GitHub devolvió
**403** («Resource not accessible by personal access token»): el token fino
«Maximo repo 3» no tiene permiso de Administración, y crear rulesets lo exige.
El ruleset completo ya está diseñado y guardado en
`puerta-main/ruleset-puerta-main.json` (este mismo repo) — estos pasos lo
crean tal cual en la interfaz. Son ~3 minutos.

**Qué hace (y qué NO hace):** un PR a `main` solo se puede fusionar con los
checks «Bancos de las apps» y «Analizar (javascript-typescript)» en verde y
sin alertas nuevas de CodeQL de severidad alta+. **No** exige PR pa nada más:
la publicación directa por API que usan las tandas sigue igual (el ruleset
no lleva la regla «Require a pull request»). Ernesto, como admin, queda con
bypass consciente (paso 4).

## Pasos

1. Entra al repo **ernesto5058/calculadora-ernesto** → **Settings** →
   en el menú izquierdo **Rules** → **Rulesets** → botón **New ruleset** →
   **New branch ruleset**.
2. **Ruleset name:** `Puerta de main — bancos y CodeQL en verde`
3. **Enforcement status:** `Active`.
4. **Bypass list** → **Add bypass** → marca **Repository admin** →
   modo **Always allow**. (Eres tú: tu vía de emergencia consciente.)
5. **Target branches** → **Add target** → **Include default branch**.
6. En **Branch rules**, marca **Require status checks to pass** y añade
   estos dos checks con **Add checks** (búscalos por su nombre exacto; ya
   corrieron en PRs de prueba, así que aparecen en la lista):
   - `Bancos de las apps`
   - `Analizar (javascript-typescript)`
   - Deja SIN marcar «Require branches to be up to date before merging».
7. Marca también **Require code scanning results** → herramienta
   **CodeQL** → **Security alerts: High or higher** → **Alerts: Errors**.
8. NO marques «Require a pull request before merging» ni «Block force
   pushes» ni nada más.
9. Botón **Create**.

## Al terminar

Avísale a Máximo: él corre la **prueba de fuego** (un PR con un banco roto
a propósito tiene que quedar bloqueado, y uno sano tiene que fusionar) y
deja el resultado escrito aquí mismo y en REGRESSIONS.

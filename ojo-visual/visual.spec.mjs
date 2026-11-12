// Ojo Visual — regresión visual automática (TOP 5 del estudio de huecos).
//
// Cada foto nueva se compara contra la BASELINE aprobada (la «foto buena»
// que vive versionada junto a este archivo). Si un texto se corta, un
// botón se mueve o un color cambia más allá de la tolerancia, la prueba
// sale en ROJO y el diff queda como artefacto de la corrida.
//
// Zonas volátiles (la hora, las cifras vivas del libro, la frescura) van
// ENMASCARADAS: no se comparan. Lo que se compara es el MARCO: tarjetas,
// títulos, botones, barra de pestañas — lo que el corte de Promos rompió.
//
// Re-aprobar una baseline (foto nueva = «buena») es decisión de Máximo
// tras cazar en vivo que el cambio es legítimo — JAMÁS automático.
// Ver README.md de esta carpeta.

import { test, expect } from '@playwright/test';

const DEFECTO = process.env.DEFECTO === '1';
const BASE = 'https://ernesto5058.github.io/calculadora-ernesto';

async function asentar(page) {
  // Red quieta + fuentes listas + un respiro pa que el render se asiente.
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});
  await page.waitForTimeout(900);
  // Congelar lo que parpadea: animaciones, transiciones y el cursor.
  await page.addStyleTag({
    content: '*{animation:none!important;transition:none!important;caret-color:transparent!important}',
  }).catch(() => {});
}

test('paginita — página pública del negocio', async ({ page }) => {
  await page.goto(BASE + '/negocio/', { waitUntil: 'domcontentloaded' });
  await asentar(page);
  if (DEFECTO) {
    // PRUEBA DE FUEGO: el defecto de Promos, recreado — textos cortados
    // a la fuerza. La comparación TIENE que cazarlo (la corrida en modo
    // «fuego» espera este rojo y lo convierte en verde del sistema).
    await page.addStyleTag({
      content:
        'h1,h2,h3,.precio,.oficios li,.lugar{max-width:120px!important;overflow:hidden!important;white-space:nowrap!important;text-overflow:ellipsis!important}',
    });
    await page.waitForTimeout(300);
  }
  await expect(page).toHaveScreenshot('paginita.png', { fullPage: true });
});

test('mercado — pantalla Ahora (cifras vivas enmascaradas)', async ({ page }) => {
  await page.goto(BASE + '/mercado/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pgAhora', { state: 'visible', timeout: 30_000 });
  // Esperar a que el libro pinte su cifra héroe (dato vivo cargado).
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.heroe-num');
      return el && el.textContent.trim().length > 0;
    },
    { timeout: 30_000 },
  ).catch(() => {});
  await asentar(page);
  const mascara = page.locator('.heroe-num, .num, .valor, .peldano-tasa, #cabSub');
  await expect(page).toHaveScreenshot('mercado-ahora.png', { mask: [mascara] });
});

test('mitrabajo — la puerta (pide el código)', async ({ page }) => {
  await page.goto(BASE + '/buscadores/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loginGate', { state: 'visible', timeout: 30_000 });
  await asentar(page);
  await expect(page).toHaveScreenshot('mitrabajo-puerta.png');
});

test('minegocio — la puerta (pide el código del dueño)', async ({ page }) => {
  await page.goto(BASE + '/minegocio/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#inCodigo', { state: 'visible', timeout: 30_000 });
  await asentar(page);
  await expect(page).toHaveScreenshot('minegocio-puerta.png');
});

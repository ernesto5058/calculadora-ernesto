// Humo E2E — flujos reales de dinero e identidad (TOP 6 del estudio de
// huecos). Pocos flujos, los que duelen, contra lo PÚBLICO servido:
//
//   1. Mi Trabajo: entrar con la cuenta de prueba PEUEBA y ver su panel.
//   2. Mi Trabajo: reportar un trato de prueba y verlo en su lista.
//   3. Mercado: abrir y leer la foto viva del libro.
//   4. Paginita: abrir el chat del agente y recibir su respuesta.
//
// La cuenta PEUEBA es la llave permanente de prueba del Ojo: sin datos de
// Briku ni de Abraham. Los datos que esta suite crea quedan MARCADOS
// («HUMO E2E …») y se limpian por SQL — ver README.md de esta carpeta.

import { test, expect } from '@playwright/test';

const BASE = 'https://ernesto5058.github.io/calculadora-ernesto';
const MARCA = `HUMO E2E ${process.env.HUMO_ID || 'local'}`;

async function entrarComoPeueba(page) {
  await page.goto(BASE + '/buscadores/?codigo=PEUEBA', { waitUntil: 'domcontentloaded' });
  // La puerta valida el código contra el servidor (validar_usuario) y
  // solo entonces abre la app: la señal de «dentro» es la barra de
  // pestañas visible y la puerta oculta.
  await expect(page.locator('#tabCalc')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('#loginGate')).toBeHidden({ timeout: 45_000 });
}

test('1 · Mi Trabajo — entrar con PEUEBA y ver su panel', async ({ page }) => {
  await entrarComoPeueba(page);
  await expect(page.getByText(/PRUEBA/i).first()).toBeVisible({ timeout: 20_000 });
  await page.click('#tabPanel');
  await expect(page.locator('#viewPanel')).toBeVisible({ timeout: 20_000 });
});

test('2 · Mi Trabajo — reportar un trato de prueba y verlo en la lista', async ({ page }) => {
  await entrarComoPeueba(page);
  await page.click('#tabRep');
  await expect(page.locator('#viewRep')).toBeVisible({ timeout: 20_000 });
  await page.click('#r_tipo_s'); // tipo saldo (idempotente)
  await page.fill('#r_precio', '950');
  await page.fill('#r_cant', '1');
  await page.fill('#r_tel', '51000000');
  await page.fill('#r_nota', MARCA);
  await page.click('#r_btn');
  // Éxito = el aviso de enviado (#r_res) y el reporte pintado en su lista
  // («Tus reportes enviados») como Pendiente. Si la puerta RPC falla, la
  // app lo deja «guardado» con aviso de error y esta prueba sale en rojo:
  // es lo que busca. La nota-marca NO se busca como texto visible: la
  // lista pinta resumen + estado, no la nota (la nota es la llave de
  // limpieza en el servidor, ver README) — la aserción original la
  // exigía visible y era insatisfacible aunque la puerta estuviera sana
  // (adjudicado el 2026-11-12 contra la foto del fallo de la corrida
  // 43265568379: «REPORTE ENVIADO» en verde y la lista en Pendiente).
  await expect(page.locator('#r_res')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('#r_lista')).toContainText('950', { timeout: 20_000 });
  await expect(page.locator('#r_lista')).toContainText(/Pendiente/, { timeout: 20_000 });
  console.log('REPORTE_CREADO nota=' + MARCA);
});

test('3 · Mercado — abrir y leer la foto viva del libro', async ({ page }) => {
  await page.goto(BASE + '/mercado/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#pgAhora')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.heroe-num');
      return el && /[0-9]/.test(el.textContent || '');
    },
    { timeout: 45_000 },
  );
  await expect(page.locator('#tabbar')).toBeVisible();
});

test('4 · Paginita — el chat del agente responde', async ({ page }) => {
  await page.goto(BASE + '/negocio/', { waitUntil: 'domcontentloaded' });
  await page.click('#ag-burbuja');
  await expect(page.locator('#ag-panel')).toBeVisible({ timeout: 20_000 });
  await page.fill('#ag-txt', '¿Cuánto cuesta un corte?');
  await page.click('#ag-env');
  // La respuesta determinista del catálogo trae el precio del corte.
  await expect(page.locator('#ag-msjs')).toContainText('400', { timeout: 45_000 });
  const sesion = await page.evaluate(() => {
    const claves = Object.keys(localStorage).filter((k) => /ag|sesion|session/i.test(k));
    return claves.map((k) => k + '=' + String(localStorage.getItem(k)).slice(0, 80)).join(' · ');
  }).catch(() => '');
  console.log('AGENTE_SESION ' + sesion);
});

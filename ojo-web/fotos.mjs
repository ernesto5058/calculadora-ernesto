import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const sitios = [
  { id: 'minegocio', url: 'https://ernesto5058.github.io/calculadora-ernesto/minegocio/',
    marcador: 'Tu código de administrador', espera: 4000,
    fotos: [ { archivo: '01-minegocio-puerta.png', bajar: 0,
               pie: 'Mi Negocio — SOLO la puerta: el código del dueño no viaja a ningún robot. La carga y la puerta ya cazan errores reales.' } ] },
  { id: 'mercado', url: 'https://ernesto5058.github.io/calculadora-ernesto/mercado/',
    marcador: 'ETECSA', espera: 5000,
    fotos: [ { archivo: '02-mercado.png', bajar: 0,
               pie: 'Mercado — el panel del mercado QvaPay con sus datos en vivo.' },
             { archivo: '03-mercado-abajo.png', bajar: 1,
               pie: 'Mercado — la misma pantalla, un poco más abajo.' } ] },
  { id: 'negocio', url: 'https://ernesto5058.github.io/calculadora-ernesto/negocio/',
    marcador: 'Barbería', espera: 2500,
    fotos: [ { archivo: '04-negocio.png', bajar: 0,
               pie: 'La paginita — la tarjeta pública del negocio (barbería, baterías, lavadoras y compra de saldo).' } ] },
  { id: 'mi-mercado', url: 'https://mi-mercado-ernesto.lovable.app',
    marcador: 'ETECSA', espera: 6000,
    fotos: [ { archivo: '05-mi-mercado.png', bajar: 0,
               pie: 'Mi Mercado (Lovable) — el conversor alimentado por los datos del vigía.' } ] },
];

const resultados = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
for (const s of sitios) {
  const r = { id: s.id, url: s.url, ok: false, error: '' };
  try {
    await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await page.waitForFunction(
        (m) => document.body && document.body.innerText.includes(m),
        s.marcador, { timeout: 30000 });
      r.ok = true;
    } catch (e) { r.error = 'sin marcador: ' + s.marcador; }
    await page.waitForTimeout(s.espera);
    for (const f of s.fotos) {
      if (f.bajar) { await page.evaluate(() => window.scrollBy(0, window.innerHeight)); await page.waitForTimeout(900); }
      await page.screenshot({ path: 'ojo-web/capturas/' + f.archivo });
    }
  } catch (e) { r.error = String(e).slice(0, 200); }
  resultados.push(r);
  console.log(s.id, r.ok ? 'OK' : 'FALLO', r.error);
}
await browser.close();
fs.writeFileSync('ojo-web/resultados.json', JSON.stringify(resultados, null, 2));
const man = [];
for (const s of sitios) for (const f of s.fotos) man.push(f.archivo + '|' + f.pie);
fs.writeFileSync('ojo-web/capturas.txt', man.join('\n') + '\n');

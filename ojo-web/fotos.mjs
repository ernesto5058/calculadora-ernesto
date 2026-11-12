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
               pie: 'Mercado · Ahora — el panel del mercado QvaPay con sus datos en vivo.' },
             { archivo: '03-mercado-abajo.png', bajar: 1,
               pie: 'Mercado · Ahora — la misma pantalla, un poco más abajo.' } ] },
  { id: 'negocio', url: 'https://ernesto5058.github.io/calculadora-ernesto/negocio/',
    marcador: 'Barbería', espera: 2500,
    fotos: [ { archivo: '04-negocio.png', bajar: 0,
               pie: 'La paginita — la tarjeta pública del negocio (barbería, baterías, lavadoras y compra de saldo).' } ] },
  { id: 'negocio-chat', url: 'https://ernesto5058.github.io/calculadora-ernesto/negocio/?chat=1',
    marcador: 'Barbería', espera: 6000,
    fotos: [ { archivo: '18-negocio-chat.png', bajar: 0,
               pie: 'La paginita con el chat del agente ABIERTO — la burbuja de atención a clientes recién montada, fotografiada en su bautizo.' } ] },
  { id: 'mi-mercado', url: 'https://mi-mercado-ernesto.lovable.app',
    marcador: 'ETECSA', espera: 6000,
    fotos: [ { archivo: '05-mi-mercado.png', bajar: 0,
               pie: 'Mi Mercado (Lovable) — el conversor alimentado por los datos del vigía.' } ] },
];

async function tocarPestana(page, nombre) {
  return await page.evaluate((nombre) => {
    const els = [...document.querySelectorAll('button, a, [role="tab"], div, span, li')];
    const cand = els.filter(e => {
      const r = e.getBoundingClientRect();
      return e.textContent.trim() === nombre && r.height > 0 && r.bottom > innerHeight * 0.7;
    });
    if (!cand.length) return false;
    cand.sort((a, b) => (a.getBoundingClientRect().height * a.getBoundingClientRect().width) - (b.getBoundingClientRect().height * b.getBoundingClientRect().width));
    const el = cand[0];
    (el.closest('button, a, [role="tab"]') || el).click();
    el.click();
    return true;
  }, nombre);
}

const resultados = [];
const man = [];
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
      man.push(f.archivo + '|' + f.pie);
    }
    if (s.id === 'mercado') {
      // Recorrido completo de Mercado (bautizo del ojo web):
      // las 7 pantallas, cada una arriba y un toque más abajo.
      const tour = [
        ['Analista', '06-mercado-analista.png', '07-mercado-analista-abajo.png'],
        ['Equilibrio', '08-mercado-equilibrio.png', '09-mercado-equilibrio-abajo.png'],
        ['Demanda', '10-mercado-demanda.png', '11-mercado-demanda-abajo.png'],
        ['Promos', '12-mercado-promos.png', '13-mercado-promos-abajo.png'],
        ['Historial', '14-mercado-historial.png', '15-mercado-historial-abajo.png'],
        ['Avisos', '16-mercado-avisos.png', '17-mercado-avisos-abajo.png'],
      ];
      r.pantallas = ['Ahora'];
      for (const [nombre, fArriba, fAbajo] of tour) {
        await page.evaluate(() => window.scrollTo(0, 0));
        const toco = await tocarPestana(page, nombre);
        await page.waitForTimeout(2600);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'ojo-web/capturas/' + fArriba });
        man.push(fArriba + '|Mercado · ' + nombre + ' — recorrido completo de bautizo del ojo web.');
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await page.waitForTimeout(900);
        await page.screenshot({ path: 'ojo-web/capturas/' + fAbajo });
        man.push(fAbajo + '|Mercado · ' + nombre + ' — un poco más abajo.');
        if (toco) r.pantallas.push(nombre);
        console.log('mercado/' + nombre, toco ? 'OK' : 'SIN TOCAR');
      }
    }
  } catch (e) { r.error = String(e).slice(0, 200); }
  resultados.push(r);
  console.log(s.id, r.ok ? 'OK' : 'FALLO', r.error);
}
await browser.close();
fs.writeFileSync('ojo-web/resultados.json', JSON.stringify(resultados, null, 2));
man.sort();
fs.writeFileSync('ojo-web/capturas.txt', man.join('\n') + '\n');

import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const DIR = 'ojo-web/mitrabajo-web';
const URL_APP = 'https://ernesto5058.github.io/calculadora-ernesto/buscadores/?codigo=PEUEBA';
const R = { entrada: false, pantallas: [], editor: false, editar: false, editarModo: false, notas: [] };
const man = [];
function nota(s) { R.notas.push(s); console.log('NOTA:', s); }

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
async function foto(archivo, pie) {
  await page.screenshot({ path: DIR + '/capturas/' + archivo });
  man.push(archivo + '|' + pie);
}
try {
  await page.goto(URL_APP, { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    await page.waitForFunction(() => {
      const g = document.getElementById('loginGate');
      return document.body && !document.body.classList.contains('locked') && g && g.classList.contains('hide');
    }, { timeout: 45000 });
    R.entrada = true;
  } catch (e) { nota('La puerta no abrió con ?codigo=PEUEBA en 45 s.'); }
  await page.waitForTimeout(3500);

  if (R.entrada) {
    const tabs = [
      ['#tabCalc', 'Calculadora', '01-calculadora.png', 'Mi Trabajo · Calculadora — la pantalla que abre al entrar (cuenta PEUEBA).'],
      ['#tabRep', 'Reportar', '02-reportar.png', 'Mi Trabajo · Reportar — el formulario de tratos y su lista, que en PEUEBA nace vacía.'],
      ['#tabPanel', 'Mi panel', '03-mi-panel.png', 'Mi Trabajo · Mi panel — la semana del buscador (tratos, total y bono) de PEUEBA.'],
      ['#tabAyuda', 'Chat', '04-chat.png', 'Mi Trabajo · Chat — la conversación con Ernesto de la cuenta de prueba.'],
      ['#tabTextos', 'Textos', '05-textos.png', 'Mi Trabajo · Textos — los anuncios listos pa copiar.'],
      ['#tabPerfil', 'Mi perfil', '06-mi-perfil.png', 'Mi Trabajo · Mi perfil — nombre, color y avisos de PEUEBA.'],
    ];
    for (const [sel, nombre, archivo, pie] of tabs) {
      try {
        await page.click(sel, { timeout: 8000 });
        await page.waitForTimeout(2200);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(400);
        await foto(archivo, pie);
        R.pantallas.push(nombre);
      } catch (e) { nota('No se pudo fotografiar ' + nombre + ': ' + String(e).slice(0, 120)); }
    }

    // Editor de foto del chat (sin enviar): elegir la foto lo abre.
    try {
      await page.click('#tabAyuda', { timeout: 8000 });
      await page.waitForTimeout(1800);
      await page.setInputFiles('#c_file_foto', 'buscadores/icon-512.png');
      await page.waitForSelector('#editorFoto.abierto', { timeout: 10000 });
      await page.waitForTimeout(900);
      await page.fill('#edFotoTxtMT', 'Foto de prueba del Ojo — no se envía');
      await page.waitForTimeout(500);
      await foto('07-chat-editor-foto.png', 'Mi Trabajo · Chat — el editor de foto a pantalla completa (paso WhatsApp): foto elegida y pie escrito. NO se envió nada: se descartó con la ✕.');
      R.editor = true;
      await page.click('#edFotoXMT');
      await page.waitForTimeout(700);
    } catch (e) { nota('Editor de foto no alcanzado: ' + String(e).slice(0, 160)); }

    // Botón «Editar»: nace solo con un reporte pendiente en el
    // buzón LOCAL. Se siembra SOLO en este navegador, con la red
    // de Supabase bloqueada desde antes: no puede salir.
    try {
      await page.route('**://*.supabase.co/**', r => r.abort());
      await page.evaluate(() => {
        const rp = { id: '11111111-2222-4333-8444-555555555555', tipo: 'saldo', precio: 950,
          cantidad: 2, telefono: '51231558', nota: 'Reporte de prueba del Ojo (local, nunca enviado)',
          fecha: new Date().toLocaleString('es-ES'), estado: 'pendiente', enviado: false };
        localStorage.setItem('busc_outbox', JSON.stringify([rp]));
        if (typeof renderOutbox === 'function') renderOutbox();
      });
      await page.click('#tabRep', { timeout: 8000 });
      await page.waitForTimeout(1500);
      const hayBoton = await page.evaluate(() => !!document.querySelector('[data-edrep]'));
      if (hayBoton) {
        R.editar = true;
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(500);
        await foto('08-reportar-con-editar.png', 'Mi Trabajo · Reportar — la lista con un reporte pendiente y su botón «Editar» (sembrado SOLO en este navegador, con la red bloqueada: nunca salió).');
        await page.click('[data-edrep]');
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(400);
        const modo = await page.evaluate(() => {
          const b = document.getElementById('r_btn');
          return b ? b.textContent.trim() : '';
        });
        if (modo.includes('Guardar la corrección')) R.editarModo = true;
        await foto('09-reportar-editando.png', 'Mi Trabajo · Reportar — tras tocar «Editar»: el formulario entra en modo corrección con los datos del reporte cargados.');
      } else {
        nota('El botón «Editar» no apareció ni con el reporte local sembrado.');
      }
    } catch (e) { nota('Editar no alcanzado: ' + String(e).slice(0, 160)); }
  } else {
    await foto('00-puerta.png', 'Mi Trabajo — la puerta: en esta corrida el recorrido no pudo entrar con PEUEBA.');
  }
} catch (e) { nota('Fallo general: ' + String(e).slice(0, 200)); }
await browser.close();
fs.writeFileSync(DIR + '/resultados.json', JSON.stringify(R, null, 2));
man.sort();
fs.writeFileSync(DIR + '/capturas.txt', man.join('\n') + '\n');
console.log(JSON.stringify(R, null, 2));

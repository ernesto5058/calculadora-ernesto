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
// Toque robusto: click normal de Playwright y, si un elemento
// flotante lo intercepta (v1: los 3 primeros toques morían así),
// click DOM directo — las pestañas escuchan click de verdad.
async function tocar(sel) {
  try { await page.click(sel, { timeout: 3500 }); return 'normal'; }
  catch (e) {
    const ok = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return false;
      el.click();
      return true;
    }, sel);
    if (!ok) throw new Error('sin elemento ' + sel);
    return 'dom';
  }
}
async function vistaVisible(id) {
  return await page.evaluate((v) => {
    const el = document.getElementById(v);
    return !!el && !el.classList.contains('hide') && el.getBoundingClientRect().height > 0;
  }, id);
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
  await page.waitForTimeout(5000);
  // Si la app muestra su tarjeta de avisos tras entrar, se aparta
  // por la vía suave («Ahora no» / «Después») y queda anotado.
  const tarjeta = await page.evaluate(() => {
    const bs = [...document.querySelectorAll('button, a')];
    const b = bs.find(x => {
      const r = x.getBoundingClientRect();
      return r.height > 0 && /ahora no|después|no, gracias/i.test(x.textContent || '');
    });
    if (b) { b.click(); return (b.textContent || '').trim(); }
    return '';
  });
  if (tarjeta) { nota('Tarjeta flotante apartada tras entrar: «' + tarjeta + '».'); await page.waitForTimeout(800); }
  if (R.entrada) await foto('00-entrada.png', 'Mi Trabajo — así queda la app al entrar con PEUEBA (la pantalla que abre).');

  if (R.entrada) {
    const tabs = [
      ['#tabCalc', 'viewCalc', 'Calculadora', '01-calculadora.png', 'Mi Trabajo · Calculadora — la pantalla que abre al entrar (cuenta PEUEBA).'],
      ['#tabRep', 'viewRep', 'Reportar', '02-reportar.png', 'Mi Trabajo · Reportar — el formulario de tratos y su lista, que en PEUEBA nace vacía.'],
      ['#tabPanel', 'viewPanel', 'Mi panel', '03-mi-panel.png', 'Mi Trabajo · Mi panel — la semana del buscador (tratos, total y bono) de PEUEBA.'],
      ['#tabAyuda', 'viewAyuda', 'Chat', '04-chat.png', 'Mi Trabajo · Chat — la conversación con Ernesto de la cuenta de prueba.'],
      ['#tabTextos', 'viewTextos', 'Textos', '05-textos.png', 'Mi Trabajo · Textos — los anuncios listos pa copiar.'],
      ['#tabPerfil', 'viewPerfil', 'Mi perfil', '06-mi-perfil.png', 'Mi Trabajo · Mi perfil — nombre, color y avisos de PEUEBA.'],
    ];
    for (const [sel, vista, nombre, archivo, pie] of tabs) {
      try {
        const via = await tocar(sel);
        await page.waitForTimeout(2200);
        if (!(await vistaVisible(vista))) { nota(nombre + ': la vista no quedó visible tras el toque (' + via + ').'); continue; }
        if (via === 'dom') nota(nombre + ': el toque normal fue interceptado; entró el toque DOM.');
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(400);
        await foto(archivo, pie);
        R.pantallas.push(nombre);
      } catch (e) { nota('No se pudo fotografiar ' + nombre + ': ' + String(e).slice(0, 120)); }
    }

    // Editor de foto del chat (sin enviar): elegir la foto lo abre.
    try {
      await tocar('#tabAyuda');
      await page.waitForTimeout(1800);
      await page.setInputFiles('#c_file_foto', 'buscadores/icon-512.png');
      await page.waitForSelector('#editorFoto.abierto', { timeout: 10000 });
      await page.waitForTimeout(900);
      await page.fill('#edFotoTxtMT', 'Foto de prueba del Ojo — no se envía');
      await page.waitForTimeout(500);
      await foto('07-chat-editor-foto.png', 'Mi Trabajo · Chat — el editor de foto a pantalla completa (paso WhatsApp): foto elegida y pie escrito. NO se envió nada: se descartó con la ✕.');
      R.editor = true;
      await tocar('#edFotoXMT');
      await page.waitForFunction(() => {
        const v = document.getElementById('editorFoto');
        return !v || !v.classList.contains('abierto');
      }, { timeout: 6000 }).catch(() => nota('El editor no confirmó su cierre tras la ✕.'));
      await page.waitForTimeout(500);
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
      await tocar('#tabRep');
      await page.waitForTimeout(1500);
      const hayBoton = await page.evaluate(() => !!document.querySelector('[data-edrep]'));
      if (hayBoton) {
        R.editar = true;
        await page.evaluate(() => { const l = document.querySelector('#r_lista'); if (l) l.scrollIntoView(); });
        await page.waitForTimeout(500);
        await foto('08-reportar-con-editar.png', 'Mi Trabajo · Reportar — la lista con un reporte pendiente y su botón «Editar» (sembrado SOLO en este navegador, con la red bloqueada: nunca salió).');
        await tocar('[data-edrep]');
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

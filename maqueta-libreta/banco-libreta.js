const fs=require('fs');
const {JSDOM}=require('/tmp/node_modules/jsdom');
const html=fs.readFileSync('/home/hatch/workspace/research_notes/libreta-maqueta/maqueta-libreta.html','utf8');
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://example.test/"});
const w=dom.window, d=w.document;
let pass=0, fail=0;
function t(n,c){ console.log((c?"PASS":"FAIL")+" "+n); c?pass++:fail++; }
function txt(id){ return d.getElementById(id).textContent; }
function seccion(id){ const s=d.getElementById(id); return s ? s.textContent : ""; }
// estructura
t("5 hojas", d.querySelectorAll('.screen').length===5);
t("5 pestañas con nombre", [...d.querySelectorAll('.tabs button')].every(b=>b.textContent.trim().length>2));
// ERROR 3 (no tocar): scroll intacto
t("scroll: cuerpo overflow-y auto + padding 120px safe-area",
  html.includes("overflow-y:auto") && html.includes("calc(120px + env(safe-area-inset-bottom))"));
// ERROR 1: pastel exacto
t("pastel 22 dice 70.7% y 1,811", txt('pastel22').includes('70.7%') && txt('pastel22').includes('1,811'));
t("pastel 22 dice 19.5% / 9.8%", txt('pastel22').includes('19.5%') && txt('pastel22').includes('9.8%'));
t("centro del pastel 22 es 2,562.74", txt('pastel22').includes('2,562.74'));
t("nota de redondeo 1.74 CUP", d.body.textContent.includes('1.74 CUP'));
t("tocar Reinversión muestra exacto 1,793.92",
  (function(){ const p=d.querySelectorAll('#pastel22 .rebanada'); p[0].dispatchEvent(new w.Event('click',{bubbles:true})); return txt('detalle22').includes('1,793.92') && txt('detalle22').includes('70.7%'); })());
t("tocar Briku muestra 19.5% y exacto 512.55",
  (function(){ const p=d.querySelectorAll('#pastel22 .rebanada'); p[1].dispatchEvent(new w.Event('click',{bubbles:true})); return txt('detalle22').includes('512.55') && txt('detalle22').includes('19.5%'); })());
t("pedazo seleccionado visible (sel + opacidad)", (function(){ const p=d.querySelectorAll('#pastel22 .rebanada'); return p[1].classList.contains('sel') && p[0].style.opacity==="0.55"; })());
// ERROR 2: etiquetas dentro del viewBox 260
t("viewBox pastel 260x260 (etiquetas sin solapar)", html.includes('viewBox="0 0 260 260"'));
// ERROR 4: Clásica sin cifras ni inputs
t("Clásica: 0 inputs", d.querySelectorAll('#h-clasica input').length===0);
t("Clásica: sin 1,248 CUP", !seccion('h-clasica').includes('1,248 CUP'));
t("Clásica: referencia estática, sin calculadora viva", seccion('h-clasica').includes('referencia') && !seccion('h-clasica').includes('out-equilibrio'));
// FALTANTE: Saldo muestra sus ecuaciones
t("Saldo muestra sus ecuaciones (equilibrio 345.6)", seccion('h-saldo').includes('Equilibrio') && txt('out-equilibrio').trim()==='345.6');
t("Saldo: gan/360 152 CUP", txt('out-gan360').includes('152'));
t("Saldo: gan total 4,323.89", txt('out-gantotal').includes('4,323.89'));
// ERROR 7: Saldo cierra
t("Saldo: 20x360 = 7,200 saldo", seccion('h-saldo').includes('7,200 saldo'));
t("Saldo: efectivo 20x1,000 = 20,000 CUP", seccion('h-saldo').includes('20 × 1,000 = 20,000 CUP'));
t("Saldo: toque 33,222.50 ≈ 33,200", seccion('h-saldo').includes('33,222.50'));
// ERROR 6: Proyección sin contradicción
t("Proyección aclara 11,250 después del ciclo 24", seccion('h-proyeccion').includes('después del ciclo 24'));
// ERROR 5: pastel de Proyección recalcula
d.getElementById('in-ciclo-a').value='15000'; d.getElementById('in-ciclo-a').dispatchEvent(new w.Event('change'));
t("reparto resto 6,250", txt('out-resto').includes('6,250'));
t("pastel Proyección recalcula a 15,000", txt('pastelProy').includes('15,000'));
t("pastel Proyección % 36.4%", txt('pastelProy').includes('36.4%'));
t("subtítulo Proyección actualizado", txt('sub-proy').includes('15,000 + 20,000 + 6,250'));
t("pastel Proyección resto 6,250", txt('pastelProy').includes('6,250'));
d.getElementById('in-ciclo-a').value='20000'; d.getElementById('in-ciclo-a').dispatchEvent(new w.Event('change'));
t("reparto vuelve a 1,250", txt('out-resto').includes('1,250'));
t("formato miles en input (15,000)", (function(){ const el=d.getElementById('in-ciclo-a'); el.value='15000'; el.dispatchEvent(new w.Event('change')); const ok=el.value==='15,000'; el.value='20000'; el.dispatchEvent(new w.Event('change')); return ok; })());
// ERROR 9: recálculo inmediato al teclear (input, sin Enter)
d.getElementById('in-pct').value='25'; d.getElementById('in-pct').dispatchEvent(new w.Event('input'));
t("input inmediato: 25% -> margen 5.3%", txt('hero-margen').includes('5.3%'));
t("input inmediato: precio libro equilibrio 1,200", txt('hero-libro-eq').includes('1,200'));
d.getElementById('in-pct').value='30'; d.getElementById('in-pct').dispatchEvent(new w.Event('input'));
t("vuelve a 9.5% y libro-eq 1,248", txt('hero-margen').includes('9.5%') && txt('hero-libro-eq').includes('1,248'));
t("% de equilibrio 18.8%", txt('out-pct-eq').includes('18.8%'));
t("ejemplo Transferencia vivo", txt('ej-transf').includes('18.8%'));
d.getElementById('in-salida-s').value='1000'; d.getElementById('in-salida-s').dispatchEvent(new w.Event('input'));
t("ejemplo Saldo vivo: equilibrio 360.0", txt('ej-saldo').includes('360.0'));
d.getElementById('in-salida-s').value='960'; d.getElementById('in-salida-s').dispatchEvent(new w.Event('input'));
t("ejemplo Saldo vuelve a 345.6", txt('ej-saldo').includes('345.6'));
// ERROR 8: fórmulas sin scroll horizontal
t("fórmulas sin nowrap", !html.includes('white-space:nowrap'));
t("equilibrio con dos nombres distintos", txt('hero-libro-eq').length>0 && txt('out-pct-eq').includes('%'));
// ERROR 10: el pastel vuelve a girar al entrar a Saldo
w.irA('h-saldo');
t("irA Saldo redibuja el pastel (3 pedazos, giro)", d.querySelectorAll('#pastel22 .rebanada').length===3);
// MEJORAS
t("capital directo 41,250 sin animación", txt('hero-capital').trim()==='41,250');
t("toast arriba (no tapa Ir a Transferencia)", html.includes('.toast{position:absolute;left:16px;right:16px;top:12px'));
t("sin datos de prueba Venta 777 en la página", !html.includes('777'));
// calculadoras vivas (regresión)
t("equilibrio Saldo 345.6", txt('out-equilibrio').trim()==='345.6');
t("margen Transf 9.5%", txt('hero-margen').includes('9.5%'));
d.getElementById('in-tasa').value='310'; d.getElementById('in-tasa').dispatchEvent(new w.Event('change'));
t("tasa editable recalcula gan/360 ~115", txt('out-gan360').includes('115'));
d.getElementById('in-tasa').value='300'; d.getElementById('in-tasa').dispatchEvent(new w.Event('change'));
// anotar rápido (regresión)
w.irA('h-general');
d.querySelector('#chips-tipo button[data-tipo="Venta"]').dispatchEvent(new w.Event('click',{bubbles:true}));
d.getElementById('in-monto').value='777'; d.getElementById('in-nota').value='prueba';
w.abrirAnotar(); w.guardarApunte();
t("anotar rápido guarda Venta 777", d.getElementById('lista-apuntes').textContent.includes('Venta') && d.getElementById('lista-apuntes').textContent.includes('777'));
t("toast visible", d.getElementById('toast').classList.contains('ver'));
// navegación
w.irA('h-clasica');
t("hoja Clásica activa", d.getElementById('h-clasica').classList.contains('active'));
t("columna 4,666 visible", d.body.textContent.includes('4,666'));
console.log(`\nDOM: ${pass} PASS / ${fail} FAIL`);
process.exit(fail?1:0);

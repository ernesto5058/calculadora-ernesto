const fs=require('fs');
const {JSDOM}=require('/tmp/node_modules/jsdom');
const html=fs.readFileSync('/home/hatch/workspace/research_notes/libreta-maqueta/maqueta-libreta.html','utf8');
const dom=new JSDOM(html,{runScripts:"dangerously",pretendToBeVisual:true,url:"https://example.test/"});
const w=dom.window, d=w.document;
let pass=0, fail=0;
function t(n,c){ console.log((c?"PASS":"FAIL")+" "+n); c?pass++:fail++; }
function txt(id){ return d.getElementById(id).textContent; }
function seccion(id){ const s=d.getElementById(id); return s ? s.textContent : ""; }
w.confirm=function(){ return true; };
// ---------- VISTA UNICA: una sola pestana ----------
t("vista unica: 1 sola pantalla activa #h-unica", d.querySelectorAll('.screen').length===1 && d.getElementById('h-unica').classList.contains('active'));
t("vista unica: sin las 5 hojas viejas (h-general/h-saldo/h-clasica)", !d.getElementById('h-general') && !d.getElementById('h-saldo') && !d.getElementById('h-clasica'));
t("vista unica: 6 secciones (vision, ciclos, zoom, proy, precios, clasica)", ['sec-vision','sec-ciclos','sec-zoom','sec-proy','sec-precios','sec-clasica'].every(function(id){ return !!d.getElementById(id); }));
t("vista unica: barra inferior con 3 anclas (Vista/Ciclos/Precios), no 5 hojas", d.querySelectorAll('.tabs button').length===3 && d.body.textContent.includes('Vista'));
t("scroll: cuerpo overflow-y auto + padding 120px safe-area",
  html.includes("overflow-y:auto") && html.includes("calc(120px + env(safe-area-inset-bottom))"));
// ---------- VISION GENERAL: pastel nuevo 42,613 ----------
t("vision: total 42,613 CUP", txt('pastelGen').includes('42,613 CUP'));
t("vision: Caja 51.8% · 22,080 CUP", txt('pastelGen').includes('51.8%') && txt('pastelGen').includes('22,080'));
t("vision: Briku 36.0% · 15,333 CUP", txt('pastelGen').includes('36.0%') && txt('pastelGen').includes('15,333'));
t("vision: Yo 12.2% · 5,200 CUP", txt('pastelGen').includes('12.2%') && txt('pastelGen').includes('5,200'));
t("vision: 3 pedazos 3D con grosor (54 lados)", d.querySelectorAll('#pastelGen .rebanada').length===3 && d.querySelectorAll('#pastelGen .lado').length===54);
t("vision: 3 etiquetas fuera con linea", d.querySelectorAll('#pastelGen .etq').length===3 && d.querySelectorAll('#pastelGen .etq line').length===3);
t("vision: leyenda 3 filas tocables", d.querySelectorAll('#leyendaGen .leyenda-fila').length===3);
t("vision: tocar Briku muestra 15,333 CUP y 'recargas'",
  (function(){ const p=d.querySelectorAll('#pastelGen .rebanada'); p[1].dispatchEvent(new w.Event('click',{bubbles:true})); return txt('detalleGen').includes('15,333 CUP') && txt('detalleGen').includes('36.0%') && txt('detalleGen').includes('recargas'); })());
t("vision: tocar Caja muestra 22,080 CUP y 'caja'",
  (function(){ const p=d.querySelectorAll('#pastelGen .rebanada'); p[0].dispatchEvent(new w.Event('click',{bubbles:true})); return txt('detalleGen').includes('22,080 CUP') && txt('detalleGen').includes('51.8%'); })());
t("vision: suma 15,333+5,200+22,080=42,613 escrita", d.body.textContent.includes('15,333 + 5,200 + 22,080 = 42,613 CUP'));
// ---------- CORRECCION RECARGAS (Ernesto 2026-11-25 11:52) ----------
t("recargas: Briku 15.33 recargas, nunca QUSD", d.body.textContent.includes('15.33 recargas') && !d.body.textContent.includes('15.33 QUSD'));
t("recargas: Yo 5.55 recargas, nunca QUSD", d.body.textContent.includes('5.55 recargas') && !d.body.textContent.includes('5.55 QUSD'));
t("recargas: 5,520/360=15.33 y 2,000/360=5.55 (aritmetica)", Math.abs(5520/360-15.33)<0.01 && Math.abs(2000/360-5.55)<0.01);
t("QUSD correcto se conserva: 34.25 QUSD -> 10,275 saldo", seccion('det-23').includes('34.25'));
// ---------- CICLO 24 (datos nuevos) ----------
t("ciclo 24: Briku 5,520 saldo y le quedan 4,667 CUP", seccion('det-24').includes('5,520') && seccion('det-24').includes('4,667'));
t("ciclo 24: suma saldo Briku 360+120+120+480+720=1,800", seccion('det-24').includes('1,800'));
t("ciclo 24: 15,333+4,667=20,000", seccion('det-24').includes('15,333 + 4,667 = 20,000'));
t("ciclo 24: caja 27,280-5,200=22,080", seccion('det-24').includes('27,280') && seccion('det-24').includes('22,080'));
t("ciclo 24: saldo total 7,520 (2,000+5,520)", seccion('det-24').includes('7,520'));
t("ciclo 24: entrega 7,200 saldo 24/11 5:25 pm", seccion('det-24').includes('7,200 saldo') && seccion('det-24').includes('5:25'));
// ---------- LINEA DE TIEMPO ----------
t("timeline: 3 casillas visibles 22/23/24 + 25 oculta", d.querySelectorAll('.casilla').length===4 && d.getElementById('casilla-25').classList.contains('oculta'));
t("timeline: ciclo 23 visible al arrancar, 22 y 24 ocultos", d.getElementById('det-23').classList.contains('ver') && !d.getElementById('det-22').classList.contains('ver') && !d.getElementById('det-24').classList.contains('ver'));
t("timeline: tocar casilla 24 muestra su detalle",
  (function(){ w.verCiclo(24); return d.getElementById('det-24').classList.contains('ver') && !d.getElementById('det-23').classList.contains('ver'); })());
t("timeline: tocar casilla 22 muestra su pastel",
  (function(){ w.verCiclo(22); return d.getElementById('det-22').classList.contains('ver') && d.querySelectorAll('#pastel22 .rebanada').length===3; })());
w.verCiclo(23);
// ---------- CERRAR CICLO con nombres reales ----------
t("cerrar: boton dice 'Cerrar el ciclo 23 y pasar al ciclo 24' (no ciclo 1/2)", txt('btn-cerrar').includes('Cerrar el ciclo 23 y pasar al ciclo 24') && !txt('btn-cerrar').includes('ciclo 1'));
t("cerrar 23: etiquetas cambian (23 CERRADO, 24 ACTIVO) y boton pasa a crear el 25",
  (function(){ d.getElementById('btn-cerrar').dispatchEvent(new w.Event('click',{bubbles:true})); return txt('est-23').includes('CERRADO') && txt('est-24').includes('ACTIVO') && txt('btn-cerrar').includes('Cerrar el ciclo 24 y crear el ciclo 25'); })());
t("cerrar 24: se crea el ciclo 25 (casilla visible, ACTIVO) y el detalle 25 se ve",
  (function(){ d.getElementById('btn-cerrar').dispatchEvent(new w.Event('click',{bubbles:true})); return !d.getElementById('casilla-25').classList.contains('oculta') && txt('est-25').includes('ACTIVO') && d.getElementById('det-25').classList.contains('ver') && txt('btn-cerrar').includes('Cerrar el ciclo 25'); })());
// ---------- ZOOM Dia / Mes / Ano ----------
t("zoom: Dia visible al arrancar (Briku 5,520, caja 22,080, total 7,520)", d.getElementById('panel-dia').classList.contains('ver') && seccion('panel-dia').includes('5,520') && seccion('panel-dia').includes('22,080') && seccion('panel-dia').includes('7,520'));
t("zoom: Mes muestra 22, 23 y 24 de noviembre",
  (function(){ w.zoom('mes'); return d.getElementById('panel-mes').classList.contains('ver') && seccion('panel-mes').includes('2,562.74') && seccion('panel-mes').includes('2,465') && seccion('panel-mes').includes('15,333'); })());
t("zoom: Ano solo noviembre lleno, 11 meses sin datos, sin cifras inventadas",
  (function(){ w.zoom('ano'); var sin=(seccion('panel-ano').match(/sin datos/g)||[]).length; return d.getElementById('panel-ano').classList.contains('ver') && sin===11 && seccion('panel-ano').includes('Nov') && seccion('panel-ano').includes('22 · 23 · 24'); })());
w.zoom('dia');
// ---------- PASTEL 22 (regresion) ----------
t("pastel 22 dice 70.7% y 1,811", txt('pastel22').includes('70.7%') && txt('pastel22').includes('1,811'));
t("pastel 22 dice 19.5% / 9.8%", txt('pastel22').includes('19.5%') && txt('pastel22').includes('9.8%'));
t("centro del pastel 22 es 2,562.74", txt('pastel22').includes('2,562.74'));
t("nota de redondeo 1.74 CUP", d.body.textContent.includes('1.74 CUP'));
t("tocar Reinversión muestra exacto 1,793.92",
  (function(){ const p=d.querySelectorAll('#pastel22 .rebanada'); p[0].dispatchEvent(new w.Event('click',{bubbles:true})); return txt('detalle22').includes('1,793.92') && txt('detalle22').includes('70.7%'); })());
t("3D: pastilla del total en los 3 pasteles", d.querySelectorAll('.pastilla').length===3);
t("leyenda Saldo: 3 filas tocables con % y CUP", (function(){ const f=d.querySelectorAll('#leyenda22 .leyenda-fila'); return f.length===3 && f[1].textContent.includes('Briku') && f[1].textContent.includes('19.5%') && f[1].textContent.includes('500 CUP'); })());
t("E1: 3 etiquetas fuera en cada pastel", d.querySelectorAll('#pastel22 .etq').length===3 && d.querySelectorAll('#pastelProy .etq').length===3 && d.querySelectorAll('#pastelGen .etq').length===3);
t("E1: ninguna etiqueta dentro de una rebanada", d.querySelectorAll('#pastel22 .rebanada text').length===0 && d.querySelectorAll('#pastelProy .rebanada text').length===0 && d.querySelectorAll('#pastelGen .rebanada text').length===0);
t("3D: pastel inclinado (scaleY 0.62) en los 3", ['pastelGen','pastel22','pastelProy'].every(function(id){ var g=d.querySelector('#'+id+' .inclinado'); return g && g.getAttribute('transform').includes('scale(1 0.62)'); }));
t("3D: grosor 54 lados en los 3 pasteles", ['pastelGen','pastel22','pastelProy'].every(function(id){ return d.querySelectorAll('#'+id+' .lado').length===54; }));
t("M1: separación lenta 700ms", html.includes('transition:transform .7s'));
t("M2: botón dorado se hunde marcado (2px + 0.98 + brillo)", html.includes('filter:brightness(.93)'));
t("M3: barra inferior flotante (12px, radio 20)", html.includes('left:12px;right:12px;bottom:calc(10px + env(safe-area-inset-bottom))'));
// ---------- CLASICA ----------
t("Clásica: 0 inputs", d.querySelectorAll('#sec-clasica input').length===0);
t("Clásica: bloqueada sin cifras inventadas", seccion('sec-clasica').includes('BLOQUEADA') && seccion('sec-clasica').includes('sin cifras inventadas'));
// ---------- PROYECCION (regresion) ----------
t("Proyección aclara 11,250 después del ciclo 24", seccion('sec-proy').includes('después del ciclo 24'));
d.getElementById('in-ciclo-a').value='15000'; d.getElementById('in-ciclo-a').dispatchEvent(new w.Event('change'));
t("reparto resto 6,250", txt('out-resto').includes('6,250'));
t("pastel Proyección recalcula a 15,000", txt('pastelProy').includes('15,000'));
t("pastel Proyección % 36.4%", txt('pastelProy').includes('36.4%'));
t("subtítulo Proyección actualizado", txt('sub-proy').includes('15,000 + 20,000 + 6,250'));
d.getElementById('in-ciclo-a').value='20000'; d.getElementById('in-ciclo-a').dispatchEvent(new w.Event('change'));
t("reparto vuelve a 1,250", txt('out-resto').includes('1,250'));
t("formato miles en input (15,000)", (function(){ const el=d.getElementById('in-ciclo-a'); el.value='15000'; el.dispatchEvent(new w.Event('change')); const ok=el.value==='15,000'; el.value='20000'; el.dispatchEvent(new w.Event('change')); return ok; })());
// ---------- CALCULADORAS VIVAS (regresion) ----------
d.getElementById('in-pct').value='25'; d.getElementById('in-pct').dispatchEvent(new w.Event('input'));
t("input inmediato: 25% -> margen 5.3%", txt('hero-margen').includes('5.3%'));
t("input inmediato: precio libro equilibrio 1,200", txt('hero-libro-eq').includes('1,200'));
d.getElementById('in-pct').value='30'; d.getElementById('in-pct').dispatchEvent(new w.Event('input'));
t("vuelve a 9.5% y libro-eq 1,248", txt('hero-margen').includes('9.5%') && txt('hero-libro-eq').includes('1,248'));
t("% de equilibrio 18.8%", txt('out-pct-eq').includes('18.8%'));
d.getElementById('in-salida-s').value='1000'; d.getElementById('in-salida-s').dispatchEvent(new w.Event('input'));
t("ejemplo Saldo vivo: equilibrio 360.0", txt('ej-saldo').includes('360.0'));
d.getElementById('in-salida-s').value='960'; d.getElementById('in-salida-s').dispatchEvent(new w.Event('input'));
t("ejemplo Saldo vuelve a 345.6", txt('ej-saldo').includes('345.6'));
t("fórmulas sin nowrap", !html.includes('white-space:nowrap'));
t("Saldo: gan/360 152 CUP", txt('out-gan360').includes('152'));
t("Saldo: gan total 4,323.89", txt('out-gantotal').includes('4,323.89'));
t("Saldo: toque 33,222.50 ≈ 33,200 (970, no 930)", seccion('det-23').includes('33,222.50') && !d.body.textContent.includes('34.25 × 930'));
t("capital directo 41,250 sin animación", txt('hero-capital').trim()==='41,250');
t("columna 4,666 visible", d.body.textContent.includes('4,666'));
// ---------- ANOTAR RAPIDO ----------
d.querySelector('#chips-tipo button[data-tipo="Venta"]').dispatchEvent(new w.Event('click',{bubbles:true}));
d.getElementById('in-monto').value='777'; d.getElementById('in-nota').value='prueba';
w.abrirAnotar(); w.guardarApunte();
t("anotar rápido guarda Venta 777", d.getElementById('lista-apuntes').textContent.includes('Venta') && d.getElementById('lista-apuntes').textContent.includes('777'));
t("toast visible", d.getElementById('toast').classList.contains('ver'));
t("sin datos de prueba Venta 777 en la página (solo existe si se anota en vivo)", !html.includes('777'));
// ---------- PUERTAS ARITMETICAS (datos nuevos) ----------
t("puerta: 15,333+4,667=20,000", 15333+4667===20000);
t("puerta: 5,520x1,000/360=15,333", Math.abs(5520*1000/360-15333)<1);
t("puerta: 2,000+5,520=7,520", 2000+5520===7520);
t("puerta: 27,280-5,200=22,080", 27280-5200===22080);
t("puerta: 15,333+5,200+22,080=42,613", 15333+5200+22080===42613);
t("puerta: % vision 36.0/12.2/51.8", Math.abs(15333/42613*100-36.0)<0.05 && Math.abs(5200/42613*100-12.2)<0.05 && Math.abs(22080/42613*100-51.8)<0.05);
t("sin palabras de lanzamiento", !html.toLowerCase().includes('lanzamiento'));
console.log(`\nDOM: ${pass} PASS / ${fail} FAIL`);
process.exit(fail?1:0);

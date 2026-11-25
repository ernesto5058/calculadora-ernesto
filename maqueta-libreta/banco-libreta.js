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
// ---------- CORRECCION OJO: E1/E2/E3/M1/M2/M3/F1 + Toque 975 / Miguel 970 ----------
t("E1: sin 11,250 en la pagina; resto sigue 1,250", !d.body.textContent.includes('11,250') && txt('out-resto').includes('1,250'));
t("E2: proyeccion dice ciclo 24 se activa cuando cierras el 23 (no ciclo 1/2)", seccion('sec-proy').includes('el ciclo 24 se activa solo cuando TÚ cierras el 23') && !seccion('sec-proy').includes('ciclo 2 se activa') && !seccion('sec-proy').includes('cierras el 1'));
t("E3: tocar Briku en Vision muestra 15.33 recargas exactas",
  (function(){ const p=d.querySelectorAll('#pastelGen .rebanada'); p[1].dispatchEvent(new w.Event('click',{bubbles:true})); return txt('detalleGen').includes('15,333 CUP en recargas · 15.33 recargas (5,520 saldo ÷ 360)'); })());
t("E3: tocar Yo en Vision muestra 5.55 recargas",
  (function(){ const p=d.querySelectorAll('#pastelGen .rebanada'); p[2].dispatchEvent(new w.Event('click',{bubbles:true})); return txt('detalleGen').includes('5.55 recargas'); })());
t("M1/M3: anclas con scroll-margin y Vista sube al inicio absoluto (scrollTo top 0)", html.includes('scroll-margin-top:12px') && html.includes('scroll-margin-bottom:140px') && html.includes('scrollTo({top:0'));
t("M1/M3: irA Ciclos no falla", (function(){ try { w.irA('sec-ciclos'); return true; } catch(e){ return false; } })());
t("M2: espacios bien (espera. Nada ... ciclo 24; Queda bloqueada)", d.body.textContent.includes('espera. Nada se cierra solo: el ciclo 24') && d.body.textContent.includes('Queda bloqueada, sin cifras inventadas') && !d.body.textContent.includes('espera.Nada') && !d.body.textContent.includes('Quedabloqueada') && !d.body.textContent.includes('solo:el ciclo'));
t("F1: linea neutra Total en juego 42,613 · Capital 41,250 · Diferencia 1,363", d.body.textContent.includes('Total en juego 42,613 CUP · Capital 41,250 CUP · Diferencia 1,363 CUP'));
t("F1: diferencia aritmetica 42,613-41,250=1,363", 42613-41250===1363);
t("EXTRA: Toque hoy 975 -> 33,393.75 CUP", seccion('det-23').includes('Toque hoy') && seccion('det-23').includes('975') && seccion('det-23').includes('33,393.75'));
t("EXTRA: Salida de Miguel 980 CUP por 1 QUSD (34.25x980=33,565.00)", seccion('det-23').includes('Salida de Miguel') && seccion('det-23').includes('980 CUP por 1 QUSD') && seccion('det-23').includes('33,565.00') && !d.body.textContent.includes('970 CUP por 1 QUSD'));
t("EXTRA: inputs de salida en 980 (Miguel)", d.getElementById('in-salida-s').value==='980' && d.getElementById('in-salida-t').value==='980');
t("EXTRA: con salida 980 equilibrio 352.8 y gan/360 176", txt('out-equilibrio').includes('352.8') && txt('out-gan360').includes('176'));
t("EXTRA: con salida 980 gan total 5,008.89", txt('out-gantotal').includes('5,008.89'));
t("EXTRA: con salida 980 margen 11.8%, libro-eq 1,274, % eq 16.3%", txt('hero-margen').includes('11.8%') && txt('out-libro-eq').includes('1,274') && txt('out-pct-eq').includes('16.3%'));
t("EXTRA: con salida 980 regreso 111.75 CUP", txt('out-regreso').includes('111.75'));
t("EXTRA: Toque 975 no se mezcla con salida 980 (equilibrio usa 980, no 351.0)", txt('out-equilibrio').includes('352.8') && !txt('out-equilibrio').includes('351.0'));
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
t("Proyección: resto 1,250 sin frase de 11,250", !seccion('sec-proy').includes('11,250') && txt('out-resto').includes('1,250'));
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
t("input inmediato: 25% -> margen 7.5% (salida 980)", txt('hero-margen').includes('7.5%'));
t("input inmediato: precio libro equilibrio 1,225 (salida 980)", txt('hero-libro-eq').includes('1,225'));
d.getElementById('in-pct').value='30'; d.getElementById('in-pct').dispatchEvent(new w.Event('input'));
t("vuelve a 11.8% y libro-eq 1,274 (salida 980)", txt('hero-margen').includes('11.8%') && txt('hero-libro-eq').includes('1,274'));
t("% de equilibrio 16.3% (salida 980)", txt('out-pct-eq').includes('16.3%'));
d.getElementById('in-salida-s').value='1000'; d.getElementById('in-salida-s').dispatchEvent(new w.Event('input'));
t("ejemplo Saldo vivo: equilibrio 360.0", txt('ej-saldo').includes('360.0'));
d.getElementById('in-salida-s').value='980'; d.getElementById('in-salida-s').dispatchEvent(new w.Event('input'));
t("ejemplo Saldo vuelve a 352.8 (salida 980)", txt('ej-saldo').includes('352.8'));
t("fórmulas sin nowrap", !html.includes('white-space:nowrap'));
t("Saldo: gan/360 176 CUP (salida 980)", txt('out-gan360').includes('176'));
t("Saldo: gan total 5,008.89 (salida 980)", txt('out-gantotal').includes('5,008.89'));
t("Saldo: Toque 975 y Miguel 980, no 930 ni 970", seccion('det-23').includes('975') && seccion('det-23').includes('980') && !d.body.textContent.includes('34.25 × 930') && !d.body.textContent.includes('970 CUP por 1 QUSD'));
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

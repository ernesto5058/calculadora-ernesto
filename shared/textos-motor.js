/* =====================================================================
   MOTOR DE TEXTOS DE OFERTAS — «el trabajador pone SOLO LOS DATOS,
   la app pone LAS PALABRAS» (prompt maestro v1, 2026-11-11).
   Motor de plantillas 100% en el cliente: SIN APIs externas, SIN IA
   de pago, offline total. Este archivo es la ÚNICA fuente del motor:
   lo comparten «Mi Trabajo» (buscadores) y «Mi Negocio» (Ernesto);
   el banco de pruebas lo carga tal cual, sin copiar lógica.
   ===================================================================== */
var TextosMotor = (function(){
  "use strict";

  /* Formato de miles con ESPACIO (regla del prompt): 125 000 CUP. */
  function miles(n){
    var s = String(Math.round(Number(n) * 100) / 100);
    var partes = s.split(".");
    partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return partes.join(".");
  }
  /* Semilla estable: mismo trabajador + mismos datos = misma variante;
     otro trabajador u otros datos = otro texto. */
  function semillaDe(str){
    var h = 2166136261;
    var s = String(str || "");
    for (var i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0);
  }
  function rng(seed){
    var a = seed >>> 0;
    return function(){
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr){ return arr[Math.floor(r() * arr.length) % arr.length]; }

  var VERBO = { vendo: "SE VENDE", compro: "COMPRO", servicio: "SERVICIO", recargo: "RECARGA Y CAMBIO", otro: "OFERTA" };
  var GANCHO = {
    vendo: ["¡Aprovecha!", "¡No te lo pierdas!", "Oportunidad de las buenas", "¡Corre, que vuelan!"],
    compro: ["¡Pago al momento!", "¡Te lo compro hoy mismo!", "Dinero en mano, sin vueltas", "¡Escríbeme y cerramos hoy!"],
    servicio: ["¡Trabajo garantizado!", "Servicio de confianza", "Calidad y buen precio", "¡Pide tu turno hoy!"],
    recargo: ["¡Al momento!", "Rápido y seguro", "Sin salir de casa", "¡Recarga ya!"],
    otro: ["¡Aprovecha!", "¡Escríbeme!", "Oportunidad", "¡No te quedes fuera!"]
  };
  var APERTURA = {
    directo: ["{V}: {P}.", "{P} — {V}.", "{V} {P}."],
    vendedor: ["{G} {V}: {P}.", "{G} Tengo para ti: {P}.", "{G} {P} en oferta."],
    humanizado: ["Hola, {v} {p}, por si a alguien le hace falta.", "Buenas, tengo {p} disponible.", "Vecinos, {v} {p}."]
  };
  var CIERRE = {
    directo: ["Interesados al privado.", "Escríbeme y coordinamos.", "Respondo rápido."],
    vendedor: ["¡No te quedes sin el tuyo!", "Quedan pocos: asegura el tuyo hoy.", "¡Haz tu pedido ahora mismo!"],
    humanizado: ["Cualquier duda me escriben, sin compromiso.", "Me escriben y nos ponemos de acuerdo.", "Aquí estoy para lo que necesiten."]
  };

  /* d = { tipo, producto, precio (num|null), moneda, privado (bool),
         cantidad, detalles, zona, telefono, condiciones,
         estilo: { emojis: 'muchos'|'pocos'|'ninguno',
                   tono: 'humanizado'|'comercial'|'formal'|'directo',
                   tamano: 'completo'|'corto'|'muycorto',
                   mayus, urgencia, privadoLlamada, hashtags, whatsapp (bool) },
         quien (semilla del trabajador), frases: {urgencia, cierre} opc. }
     Devuelve { versiones: [{enfoque, texto} x3], avisos: [] } */
  function generar(d){
    var avisos = [];
    var tipo = VERBO[d.tipo] ? d.tipo : "otro";
    var est = d.estilo || {};
    var em = est.emojis || "pocos";
    var E = function(x){ return em === "ninguno" ? "" : x; };
    var muchos = em === "muchos";
    var producto = String(d.producto || "").trim();
    if (!producto) avisos.push("Falta el producto o servicio: sin eso no hay anuncio.");
    var precioTxt = "";
    if (d.privado) {
      precioTxt = "";
    } else if (d.precio !== null && d.precio !== undefined && d.precio !== "" && isFinite(Number(d.precio))) {
      precioTxt = miles(d.precio) + " " + (d.moneda || "CUP");
    } else {
      avisos.push("Sin precio: el texto sale sin precio (si es «por privado», márcalo).");
    }
    if (!d.telefono) avisos.push("Falta tu teléfono: el texto sale SIN teléfono.");
    if (!d.zona) avisos.push("Falta la zona: el texto sale sin zona.");
    var seed = semillaDe([d.quien || "", tipo, producto, precioTxt, d.zona || ""].join("|"));
    var enfoques = ["directo", "vendedor", "humanizado"];
    var versiones = enfoques.map(function(enf, idx){
      var r = rng(seed + idx * 7919);
      var titulo = (VERBO[tipo] + " " + producto).trim();
      if (est.mayus) titulo = titulo.toUpperCase();
      var tituloFmt = est.whatsapp ? "*" + titulo + "*" : titulo;
      var gancho = pick(r, GANCHO[tipo]);
      var ap = pick(r, APERTURA[enf])
        .replace("{V}", VERBO[tipo]).replace("{v}", VERBO[tipo].toLowerCase())
        .replace("{P}", producto).replace("{p}", producto)
        .replace("{G}", gancho);
      var lineas = [];
      if (est.tamano === "muycorto") {
        var l1 = (muchos ? "🔥 " : "") + ap;
        if (precioTxt) l1 += " " + (est.whatsapp ? "*" + precioTxt + "*" : "Precio: " + precioTxt) + ".";
        if (d.privado) l1 += " Precio por privado.";
        if (d.telefono) l1 += " " + E("📲 ") + d.telefono;
        lineas.push(l1);
        return { enfoque: enf, texto: lineas.join("\n") };
      }
      lineas.push((muchos ? "🔥 " : (em === "pocos" ? "📌 " : "")) + tituloFmt + (enf === "vendedor" ? " " + gancho : ""));
      lineas.push("");
      lineas.push(ap);
      if (d.cantidad) lineas.push(E("📦 ") + "Disponible: " + d.cantidad + ".");
      if (d.detalles) lineas.push(E("✅ ") + d.detalles);
      if (precioTxt) lineas.push(E("💰 ") + "Precio: " + (est.whatsapp ? "*" + precioTxt + "*" : precioTxt));
      if (d.privado) lineas.push(E("💬 ") + "El precio se habla por privado: escríbeme y te digo al momento.");
      if (est.urgencia) lineas.push(E("⏰ ") + ((d.frases && d.frases.urgencia) || "¡Corre, que vuelan!"));
      if (d.condiciones) lineas.push(E("🤝 ") + d.condiciones);
      if (d.zona) lineas.push(E("📍 ") + d.zona);
      if (d.telefono) lineas.push(E("📲 ") + "Teléfono / WhatsApp: " + d.telefono);
      if (est.privadoLlamada) lineas.push(E("✉️ ") + "Escríbeme al privado y coordinamos.");
      lineas.push(pick(r, CIERRE[enf]));
      if (est.tamano === "corto") {
        lineas = lineas.filter(function(l){
          return l !== "" && l.indexOf("Disponible:") !== 0 && l.indexOf("✅") !== 0;
        });
        if (lineas.length > 6) lineas = lineas.slice(0, 6);
      }
      if (est.hashtags) {
        var tags = ["#" + (producto.split(" ")[0] || "Oferta").replace(/[^A-Za-zÁÉÍÓÚáéíóúÑñ0-9]/g, ""), "#SantiagoDeCuba", "#Ventas"];
        lineas.push(tags.join(" "));
      }
      return { enfoque: enf, texto: lineas.join("\n") };
    });
    return { versiones: versiones, avisos: avisos };
  }

  /* Historial local: últimas 30 (regla del prompt). */
  function historialPush(hist, entrada){
    var h = Array.isArray(hist) ? hist.slice() : [];
    h.unshift(entrada);
    return h.slice(0, 30);
  }

  /* ===== TEXTOS RÁPIDOS DE LA TARIFA (la magia, SOLO datos públicos) =====
     Recibe EXCLUSIVAMENTE los campos publicables de la tarifa y del
     perfil: precio público de compra por recarga, condiciones públicas,
     teléfono y zona. Ningún dato interno (comisión, piso, ganancia)
     existe en este objeto: no puede colarse porque no llega. */
  function textoRapidoSaldo(pub, estilo, quien){
    return generar({
      tipo: "compro", producto: "saldo móvil (recargas de 360)",
      precio: pub.precioCompraRecarga, moneda: "CUP", privado: false,
      cantidad: "", detalles: "Compro saldo móvil todos los días. Pago al momento, en efectivo.",
      zona: pub.zona || "", telefono: pub.telefono || "",
      condiciones: pub.condicionesSaldo || "Pago en efectivo al momento",
      estilo: estilo, quien: quien || ""
    });
  }
  function textoRapidoTransf(pub, estilo, quien){
    return generar({
      tipo: "recargo", producto: "transferencia por efectivo",
      precio: null, moneda: "CUP", privado: true,
      cantidad: "", detalles: "Cambio tu transferencia por efectivo, trato serio y rápido.",
      zona: pub.zona || "", telefono: pub.telefono || "",
      condiciones: pub.condicionesTransf || "Solo personas conocidas",
      estilo: estilo, quien: quien || ""
    });
  }

  /* ===== TEXTO DE PRODUCTO — la plantilla REAL de su Facebook =====
     Nace de sus publicaciones verificadas (2026-10-21): gancho en
     mayúsculas con emojis, líneas ✅ de ventajas, 💰 precio con la
     moneda (baterías: por privado), 📲 su teléfono, 📍 Micro 10,
     domicilio y cierre. pub = { producto, precio (null = por
     privado), moneda, garantia, cantidad, detalles, domicilio
     (bool), telefono, zona }. Sin motor genérico: esta plantilla
     es SUYA, palabra por palabra, en 3 tamaños como los demás. */
  function textoRapidoProducto(pub, estilo, quien){
    var est = estilo || {};
    var em = est.emojis || "pocos";
    var E = function(x){ return em === "ninguno" ? "" : x; };
    var producto = String(pub.producto || "").trim();
    var avisos = [];
    if (!producto) avisos.push("Falta el nombre del producto: sin eso no hay anuncio.");
    if (!pub.telefono) avisos.push("Falta tu teléfono: el texto sale SIN teléfono.");
    if (!pub.zona) avisos.push("Falta la zona: el texto sale sin zona.");
    var tienePrecio = pub.precio !== null && pub.precio !== undefined && pub.precio !== "" && isFinite(Number(pub.precio));
    var precioTxt = tienePrecio ? miles(pub.precio) + " " + (pub.moneda || "CUP") : "";
    var titulo = "SE VENDE " + producto.toUpperCase();
    var tituloFmt = est.whatsapp ? "*" + titulo + "*" : titulo;
    var lineasOk = [];
    if (pub.garantia) lineasOk.push("Garantía: " + pub.garantia);
    if (pub.cantidad) lineasOk.push("Disponible: " + pub.cantidad);
    if (pub.detalles) lineasOk.push(String(pub.detalles));
    if (pub.domicilio) lineasOk.push("Domicilio incluido en Santiago");
    var completa = [];
    completa.push(E("🚨 ") + tituloFmt + E(" 🚨"));
    completa.push("");
    lineasOk.forEach(function(l){ completa.push(E("✅ ") + l); });
    if (tienePrecio) completa.push(E("💰 ") + "Precio: " + (est.whatsapp ? "*" + precioTxt + "*" : precioTxt));
    else completa.push(E("💬 ") + "Precio por privado: escríbeme y te digo al momento.");
    if (est.urgencia) completa.push(E("⏰ ") + "¡Corre, que vuelan!");
    completa.push("");
    if (pub.telefono) completa.push(E("📲 ") + "Interesados, llamar o escribir al " + pub.telefono);
    if (pub.zona) completa.push(E("📍 ") + pub.zona);
    completa.push("¡Aproveche, que se acaban!");
    var corta = [];
    var c1 = "En venta " + producto;
    if (tienePrecio) c1 += ". Precio: " + precioTxt + ".";
    else c1 += ". Precio por privado.";
    corta.push(c1);
    if (lineasOk.length) corta.push(lineasOk.join(". ") + ".");
    var c3 = "";
    if (pub.telefono) c3 += "Interesados llamar al " + pub.telefono + ".";
    if (pub.zona) c3 += (c3 ? " " : "") + pub.zona + ".";
    if (c3) corta.push(c3);
    var muy = (em === "ninguno" ? "" : "🔥 ") + tituloFmt + " — "
      + (tienePrecio ? precioTxt : "precio por privado")
      + (pub.telefono ? " · " + E("📲 ") + pub.telefono : "")
      + (pub.zona ? " · " + E("📍 ") + pub.zona : "");
    var versiones = [
      { enfoque: "completa", texto: completa.join("\n") },
      { enfoque: "corta", texto: corta.join("\n") },
      { enfoque: "muycorta", texto: muy }
    ];
    if (est.tamano === "corto") versiones = [versiones[1], versiones[0], versiones[2]];
    if (est.tamano === "muycorto") versiones = [versiones[2], versiones[1], versiones[0]];
    return { versiones: versiones, avisos: avisos };
  }

  return { generar: generar, miles: miles, semillaDe: semillaDe,
           historialPush: historialPush,
           textoRapidoSaldo: textoRapidoSaldo, textoRapidoTransf: textoRapidoTransf,
           textoRapidoProducto: textoRapidoProducto };
})();

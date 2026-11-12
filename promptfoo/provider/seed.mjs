// =====================================================================
// seed.mjs — datos SEMILLA espejo de la base viva del Agente.
// Copia fiel del bloque de datos de bancos/prueba-agente-v1.mjs (el
// banco eterno): mismo catálogo, mismas fuentes, mismos sinónimos y
// mismas FAQ. Si el banco cambia su semilla, esta copia se refresca
// en la misma tanda (regla de espejos del repo).
//
// ÚNICA diferencia deliberada: negocio_lat/lng. El banco trae el pin
// PROVISIONAL de zona (20.01722,-75.8284) porque sus aserciones son
// autorreferentes (pin == config). Aquí se fijan las coords EXACTAS
// vivas de Ernesto (20.04567,-75.826819, de su enlace de Apple Maps)
// porque CHEQUEOS-ETERNOS fila 25 las dejó como las vigentes y la
// batería dorada debe asertar el pin REAL, no uno de relleno.
// =====================================================================
import L from "./logica-ref.mjs";

export const HOY = "2026-11-11"; // el «hoy» del banco: determinismo total

const filaCat = (clave, nombre, precio, moneda, extra = {}) => ({
  clave, nombre, precio, moneda, precio_al_privado: false, estado: "hay",
  nota: "", actualizado_en: "2026-11-11T15:00:00Z", ...extra,
});

export function construirDatos(opciones = {}) {
  const catalogo = new Map([
    ["corte", filaCat("corte", "Corte de cabello", 400, "CUP", { nota: "Precio en efectivo. Por transferencia: 700 CUP." })],
    ["corte_transferencia", filaCat("corte_transferencia", "Corte (transferencia)", 700, "CUP")],
    ["lavadora_hys", filaCat("lavadora_hys", "Lavadora HYS 7 kg", 250, "USD", { nota: "Semiautomática con Air-Dry. Garantía de 1 año. Domicilio incluido en Santiago." })],
    ["bateria_lifepo4", filaCat("bateria_lifepo4", "Batería LiFePO4 12.8V 100Ah", null, null, { precio_al_privado: true, nota: "Precio al privado con Ernesto." })],
  ]);
  const fuente = new Map([
    ["horario_barberia", { valor: { abre: "09:00", cierra: "18:00", dias: "todos los días" }, actualizado_en: "2026-11-11T15:00:00Z" }],
    ["zona", { valor: "Micro 10, distrito José Martí, Santiago de Cuba", actualizado_en: "2026-11-11T15:00:00Z" }],
    ["telefono_publico", { valor: "51231558", actualizado_en: "2026-11-11T15:00:00Z" }],
    ["tarifa_publica_saldo", { valor: { pago: 2, a_partir_de: 5000, pago_mayor: 2.2, recarga: 720, moneda: "CUP", domicilio: "gratis", tabla: { "1000": 2000, "2000": 4000, "3000": 6000, "4000": 8000, "5000": 10000 } }, actualizado_en: "2026-11-11T15:00:00Z" }],
  ]);
  const SIN = [];
  for (const [t, d] of [["corte", "corte"], ["pelado", "corte"], ["pelarse", "corte"], ["pelo", "corte"], ["cabello", "corte"], ["lavadora", "lavadora_hys"], ["hys", "lavadora_hys"], ["bateria", "bateria_lifepo4"], ["lifepo4", "bateria_lifepo4"], ["litio", "bateria_lifepo4"]])
    SIN.push({ termino: t, tipo: "producto", destino: d });
  for (const [t, d] of [["saldo", "saldo"], ["recarga", "saldo"], ["recargas", "saldo"], ["precio", "precio"], ["cuesta", "precio"], ["vale", "precio"], ["horario", "horario"], ["hora", "horario"], ["abren", "horario"], ["cierran", "horario"], ["apertura", "horario"], ["cierre", "horario"], ["haces", "capacidades"], ["sirves", "capacidades"], ["ayudar", "capacidades"], ["direccion", "ubicacion"], ["ubicacion", "ubicacion"], ["micro", "ubicacion"], ["cita", "cita"], ["turno", "cita"], ["reservar", "cita"], ["domicilio", "domicilio"], ["casa", "domicilio"], ["garantia", "garantia"], ["pago", "pago"], ["transferencia", "pago"], ["efectivo", "pago"], ["telefono", "contacto"], ["contacto", "contacto"], ["llamar", "contacto"], ["whatsapp", "contacto"], ["humano", "humano"], ["persona", "humano"], ["dueno", "humano"], ["ernesto", "humano"]])
    SIN.push({ termino: t, tipo: "intencion", destino: d });

  function faq(id, pregunta, intencion, tipo, extra = {}) {
    return { id, pregunta, intencion, respuesta_tipo: tipo, dato_clave: extra.dato ?? null,
             respuesta_texto: extra.texto ?? null, estado: "activa",
             veces_resuelta: 0, veces_fallada: 0, origen: extra.origen ?? "semilla",
             patrones: (extra.patrones ?? []).map((p) => L.normalizar(p)) };
  }
  const FAQS = [
    faq("f-corte", "¿A cómo está el corte?", "precio", "dato", { dato: "precio_corte", patrones: ["a como el corte", "precio del corte", "cuanto cuesta pelarse", "cuanto vale el pelado"] }),
    faq("f-lav", "¿A cómo la lavadora?", "precio", "dato", { dato: "precio_lavadora", patrones: ["a como la lavadora", "precio de la lavadora hys", "cuanto cuesta la lavadora"] }),
    faq("f-bat", "¿A cómo la batería?", "precio", "dato", { dato: "precio_bateria", patrones: ["a como la bateria", "precio de la bateria lifepo4"] }),
    faq("f-saldo", "¿Compras saldo? ¿A cómo?", "saldo", "dato", { dato: "tarifa_saldo", patrones: ["compras saldo", "a como compras el saldo", "cuanto pagas por el saldo", "a como pagas las recargas"] }),
    faq("f-hor", "¿Cuál es el horario?", "horario", "dato", { dato: "horario", patrones: ["cual es el horario", "a que hora abren", "hasta que hora estan", "horario de la barberia", "cuando cierran", "cuando abren", "a que hora cierran", "hora de apertura", "hora de cierre", "horario de atencion"] }),
    faq("f-ubi", "¿Dónde estás ubicado?", "ubicacion", "dato", { dato: "ubicacion", patrones: ["donde estas ubicado", "direccion", "en que parte de santiago"] }),
    faq("f-dom", "¿Haces domicilio?", "domicilio", "dato", { dato: "domicilio", patrones: ["haces domicilio", "vienen a la casa"] }),
    faq("f-pago", "¿Cómo puedo pagar?", "pago", "dato", { dato: "formas_pago", patrones: ["como puedo pagar", "aceptas transferencia"] }),
    faq("f-gar", "¿La lavadora tiene garantía?", "garantia", "dato", { dato: "garantia_lavadora", patrones: ["la lavadora tiene garantia", "cuanto de garantia tiene la lavadora"] }),
    faq("f-con", "¿Cómo contacto a Ernesto?", "contacto", "dato", { dato: "contacto", patrones: ["como contacto a ernesto", "numero de telefono"] }),
    faq("f-ide", "¿Quién eres?", "identidad", "dato", { dato: "identidad", patrones: ["quien eres", "eres ernesto"] }),
    faq("f-cap", "¿Qué puedes hacer?", "capacidades", "texto", { texto: "Puedo ayudarte con esto 👇\n· 📱 Comprar saldo: precios y cómo se paga\n· 🔋 Baterías y la lavadora: precios y disponibilidad\n· 💈 Barbería: horario y citas\n· 📍 La ubicación del negocio\nLo demás se lo paso a Ernesto.", patrones: ["qué haces", "qué puedes hacer", "para qué sirves", "qué sabes hacer", "en qué me puedes ayudar"] }),
    faq("f-slv", "¿Tienes lavadoras?", "stock", "dato", { dato: "stock_lavadora", patrones: ["tienes lavadoras", "te quedan lavadoras hys"] }),
    faq("f-sbt", "¿Tienes baterías?", "stock", "dato", { dato: "stock_bateria", patrones: ["tienes baterias", "te quedan baterias de litio"] }),
    faq("f-sal", "Saludo", "saludo", "texto", { texto: "¡Hola! 👋 Soy el asistente virtual de Ernesto.", patrones: [] }),
  ];

  const datos = {
    config: { umbral_responder: 70, umbral_aclarar: 45, negocio_lat: 20.04567, negocio_lng: -75.826819 },
    catalogo, fuente, faqs: FAQS, sinonimos: SIN,
    prohibidas: ["925", "1069.38", "1098.68"], // tarifa INTERNA viva (salida/libro/ingreso)
  };

  if (opciones.escenario === "citas") {
    // Las mismas filas ficticias del banco (secciones CIT y DIN).
    datos.citasPendientes = [
      { id: "cita-1", nombre: "Ana Pérez", servicio: "corte", dia: "2026-11-12", hora: "10:00:00", estado: "pendiente", canal: "telegram", conversacion_id: "conv-x" },
      { id: "cita-2", nombre: "Luis", servicio: "corte", dia: "2026-11-13", hora: "16:30:00", estado: "pendiente", canal: "web", conversacion_id: "conv-y" },
    ];
    datos.citasConfirmadas = [
      { id: "conf-1", nombre: "Ana Pérez", servicio: "corte", dia: "2026-11-12", hora: "10:00:00", estado: "confirmada", canal: "telegram", conversacion_id: "conv-x" },
      { id: "conf-2", nombre: "Luis", servicio: "corte", dia: "2026-11-12", hora: "16:30:00", estado: "confirmada", canal: "web", conversacion_id: "conv-y" },
    ];
    datos.citasCerradas = [
      { id: "s1", dia: "2026-11-09", asistencia: "vino", pago_monto: 400, pago_metodo: "efectivo" },
      { id: "s2", dia: "2026-11-12", asistencia: "vino", pago_monto: 400, pago_metodo: "efectivo" },
      { id: "s3", dia: "2026-11-12", asistencia: "vino", pago_monto: 700, pago_metodo: "transferencia" },
      { id: "s4", dia: "2026-11-12", asistencia: "no_vino", pago_monto: null, pago_metodo: null },
      { id: "s5", dia: "2026-11-12", asistencia: null, pago_monto: null, pago_metodo: null },
    ];
  }
  if (opciones.esDueno) datos.esDueno = true;
  return datos;
}

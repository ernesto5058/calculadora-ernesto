//! **Apertura de servicios lockdown con EscrowBag y respuestas crudas (v2.3).**
//!
//! El diagnóstico de la sonda (DIAGNOSTICO-SONDA.md) probó que la cadena de
//! la v2.2 moría DESPUÉS de la puerta: `InstallationProxyClient::connect`
//! del crate `idevice` pide el StartService **sin EscrowBag** (su
//! `start_service` fija el escrow a `None`) y **descarta la respuesta cruda**
//! de lockdownd — de ahí el opaco `missing Port in StartService response`.
//!
//! Aquí la apertura de CADA servicio de la cadena se hace a mano sobre la
//! sesión del crate (la conexión del provider + el TLS de
//! `Idevice::start_session`), con el StartService construido en casa:
//! `{Label, Request: "StartService", Service, EscrowBag?}` — y la respuesta
//! COMPLETA de Apple queda en el registro de etapas antes de interpretarla.
//! Si Apple se niega y el registro trae EscrowBag, se presenta y se
//! reintenta (la lección de la puerta); si la puerta ya demostró que el
//! servicio SOLO abre con escrow, se presenta desde el primer intento.
//! Cuando ni así abre, el error que sube es el `Error` exacto de Apple —
//! nunca más el opaco del crate.
//!
//! Los servicios que la cadena abre por esta vía: InstallationProxy (sonda
//! e instalación), AFC (subida) y HouseArrest (depósito en Tienda Máximo).

use std::future::Future;
use std::path::Path;
use std::pin::Pin;

use idevice::afc::AfcClient;
use idevice::installation_proxy::InstallationProxyClient;
use idevice::pairing_file::PairingFile;
use idevice::provider::IdeviceProvider;
use idevice::{Idevice, IdeviceError, IdeviceService};

use crate::probe::resumen_crudo;
use crate::provider::AnfitrionProvider;
use crate::stage;

pub const SERVICE_AFC: &str = "com.apple.afc";
pub const SERVICE_HOUSE_ARREST: &str = "com.apple.mobile.house_arrest";
/// El Label del StartService hecho a mano: el mismo del builder vendorizado
/// que la puerta (probe) ya probó EN VIVO contra el iPhone de Ernesto.
const LABEL_START_SERVICE: &str = "iphone-wasm";
const LOCKDOWND_PORT: u16 = 62078;

// ── Los dicts de la secuencia, construidos en casa (piezas puras) ────────────

fn dict_base(label: &str, request: &str) -> plist::Dictionary {
    let mut d = plist::Dictionary::new();
    d.insert("Label".into(), plist::Value::String(label.into()));
    d.insert("Request".into(), plist::Value::String(request.into()));
    d
}

/// `StartSession` espejo del crate: `{Label, Request, HostID, SystemBUID}`
/// con el Label del provider (el que el `Idevice` del crate llevaría).
pub fn dict_start_session(label: &str, host_id: &str, system_buid: &str) -> plist::Value {
    let mut d = dict_base(label, "StartSession");
    d.insert("HostID".into(), plist::Value::String(host_id.into()));
    d.insert(
        "SystemBUID".into(),
        plist::Value::String(system_buid.into()),
    );
    plist::Value::Dictionary(d)
}

/// `GetValue` espejo del crate (sin `Domain` cuando no aplica).
pub fn dict_get_value(label: &str, key: &str) -> plist::Value {
    let mut d = dict_base(label, "GetValue");
    d.insert("Key".into(), plist::Value::String(key.into()));
    plist::Value::Dictionary(d)
}

/// El StartService hecho a mano: `{Label, Request: "StartService", Service}`
/// + `EscrowBag` (CFData del registro) cuando se presenta.
pub fn dict_start_service(
    servicio: &str,
    label: &str,
    escrow_bag: Option<&[u8]>,
) -> plist::Value {
    let mut d = dict_base(label, "StartService");
    d.insert(
        "Service".into(),
        plist::Value::String(servicio.to_string()),
    );
    if let Some(bag) = escrow_bag {
        d.insert("EscrowBag".into(), plist::Value::Data(bag.to_vec()));
    }
    plist::Value::Dictionary(d)
}

/// Interpreta la respuesta cruda al StartService: `(Port, EnableServiceSSL)`
/// o el `Error` exacto de Apple. Nada se descarta en silencio: una respuesta
/// sin Port y sin Error también se nombra.
pub fn interpretar_start_service(resp: &plist::Dictionary) -> Result<(u16, bool), String> {
    if let Some(e) = resp.get("Error").and_then(|v| v.as_string()) {
        return Err(e.to_string());
    }
    let ssl = resp
        .get("EnableServiceSSL")
        .and_then(|v| v.as_boolean())
        .unwrap_or(false);
    match resp
        .get("Port")
        .and_then(|v| v.as_signed_integer())
        .and_then(|i| u16::try_from(i).ok())
    {
        Some(p) => Ok((p, ssl)),
        None => Err(format!(
            "respuesta sin Port y sin clave Error: {}",
            resumen_crudo(&dict_a_xml(resp))
        )),
    }
}

/// ¿Toca reintentar presentando el EscrowBag? La regla de la puerta: ante
/// cualquier negativa de Apple CON respuesta, si el registro trae bag y aún
/// no se presentó, el escrow es la vía diseñada pa desbloquear el servicio.
pub fn toca_escrow(hay_bag: bool, ya_presentado: bool) -> bool {
    hay_bag && !ya_presentado
}

fn dict_a_xml(d: &plist::Dictionary) -> String {
    let mut buf: Vec<u8> = Vec::new();
    let v = plist::Value::Dictionary(d.clone());
    match v.to_writer_xml(&mut buf) {
        Ok(()) => String::from_utf8_lossy(&buf).to_string(),
        Err(_) => format!("{:?}", d),
    }
}

// ── Intercambio plist sobre un canal (el del crate en vivo, uno simulado
//    en los bancos) ───────────────────────────────────────────────────────────

/// Un canal de dicts plist contra lockdownd: enviar un dict y leer el dict
/// de respuesta, con la respuesta CRUDO visible pa quien negocia.
pub trait Intercambio {
    fn enviar(&mut self, dict: &plist::Value) -> impl Future<Output = Result<(), String>> + Send;
    fn recibir(&mut self) -> impl Future<Output = Result<plist::Dictionary, String>> + Send;
}

/// El framing de lockdownd sobre el socket del crate: 4 bytes BE de longitud
/// + el XML — el mismo que `Idevice::send_plist`/`read_plist` hacen por
/// dentro (no son públicos; `send_raw`/`read_raw` sí, y el socket ya lleva
/// el TLS cuando la sesión lo encendió).
async fn enviar_dict(dev: &mut Idevice, v: &plist::Value) -> Result<(), IdeviceError> {
    let mut buf: Vec<u8> = Vec::new();
    v.to_writer_xml(&mut buf)
        .map_err(|e| IdeviceError::UnexpectedResponse(format!("serializando el dict: {}", e)))?;
    let mut frame = Vec::with_capacity(4 + buf.len());
    frame.extend_from_slice(&(buf.len() as u32).to_be_bytes());
    frame.extend_from_slice(&buf);
    dev.send_raw(&frame).await
}

async fn leer_dict(dev: &mut Idevice) -> Result<plist::Dictionary, IdeviceError> {
    let hdr = dev.read_raw(4).await?;
    let len = u32::from_be_bytes([hdr[0], hdr[1], hdr[2], hdr[3]]) as usize;
    if len == 0 || len > 64 * 1024 * 1024 {
        return Err(IdeviceError::UnexpectedResponse(format!(
            "longitud de respuesta lockdown inválida: {}",
            len
        )));
    }
    let body = dev.read_raw(len).await?;
    let value: plist::Value = plist::from_bytes(&body)?;
    value
        .into_dictionary()
        .ok_or_else(|| IdeviceError::UnexpectedResponse("la respuesta no es un dict".into()))
}

struct IntercambioIdevice<'a> {
    dev: &'a mut Idevice,
}

impl Intercambio for IntercambioIdevice<'_> {
    fn enviar(&mut self, dict: &plist::Value) -> impl Future<Output = Result<(), String>> + Send {
        let dict = dict.clone();
        async move {
            enviar_dict(self.dev, &dict)
                .await
                .map_err(|e| format!("{:?}", e))
        }
    }

    fn recibir(&mut self) -> impl Future<Output = Result<plist::Dictionary, String>> + Send {
        async move {
            leer_dict(self.dev)
                .await
                .map_err(|e| format!("{:?}", e))
        }
    }
}

// ── La negociación del StartService (la pieza que los bancos fijan) ─────────

/// Pide el servicio por el canal ya abierto (sesión lockdown viva), con la
/// respuesta cruda de CADA intento en el registro de etapas. Primero sin
/// escrow — salvo que `presentar_escrow` diga que la puerta ya demostró que
/// este iPhone solo abre con él — y, ante la negativa de Apple, un segundo
/// intento presentando el EscrowBag del registro. Devuelve
/// `(Port, EnableServiceSSL)` o el `Error` exacto de Apple del último intento.
pub async fn negociar_start_service(
    io: &mut impl Intercambio,
    servicio: &str,
    escrow_bag: Option<&[u8]>,
    presentar_escrow: bool,
    etapa: &str,
) -> Result<(u16, bool), String> {
    let mut presentado = false;
    let mut con_escrow = presentar_escrow && escrow_bag.is_some();
    loop {
        if con_escrow {
            presentado = true;
            stage(&format!(
                "ETAPA {}: StartService de {} presentando el EscrowBag del registro ({} bytes)…",
                etapa,
                servicio,
                escrow_bag.map(|b| b.len()).unwrap_or(0)
            ));
        }
        let dict = dict_start_service(
            servicio,
            LABEL_START_SERVICE,
            if con_escrow { escrow_bag } else { None },
        );
        io.enviar(&dict)
            .await
            .map_err(|e| format!("enviando el StartService de {}: {}", servicio, e))?;
        let resp = io
            .recibir()
            .await
            .map_err(|e| format!("leyendo la respuesta de {}: {}", servicio, e))?;
        stage(&format!(
            "ETAPA {}: respuesta StartService ({}) cruda: {}",
            etapa,
            servicio,
            resumen_crudo(&dict_a_xml(&resp))
        ));
        match interpretar_start_service(&resp) {
            Ok(ok) => return Ok(ok),
            Err(apple) => {
                if toca_escrow(escrow_bag.is_some(), presentado) {
                    stage(&format!(
                        "ETAPA {}: Apple dijo «{}» — presento el EscrowBag del registro y reintento",
                        etapa, apple
                    ));
                    con_escrow = true;
                    continue;
                }
                return Err(apple);
            }
        }
    }
}

// ── La apertura completa de un servicio sobre el provider del crate ────────

/// Abre `servicio` de punta a punta: conexión lockdown nueva del provider →
/// GetValue previo (legado, espejo del crate) → sesión + TLS del crate
/// (`Idevice::start_session`) → StartService A MANO con escrow (ver
/// `negociar_start_service`) → conexión al puerto. Devuelve el stream listo
/// pa `IdeviceService::from_stream` del cliente que corresponda. El error,
/// cuando Apple se niega, trae su `Error` exacto.
///
/// Por qué la sesión la abre el crate y no va un StartSession a mano antes:
/// tras responder `EnableSessionSSL=true`, lockdownd solo acepta un
/// ClientHello TLS en esa conexión — un segundo StartSession en claro la
/// tumba. La respuesta cruda del StartSession ya queda registrada por la
/// puerta (probe) en la misma corrida; la pieza que el crate descartaba y
/// aquí sí se registra es la del StartService.
pub async fn abrir_servicio(
    provider: &AnfitrionProvider,
    pairing: &PairingFile,
    servicio: &str,
    escrow_bag: Option<&[u8]>,
    presentar_escrow: bool,
    etapa: &str,
) -> Result<Idevice, String> {
    let label = provider.label().to_string();
    let mut dev = provider
        .connect(LOCKDOWND_PORT)
        .await
        .map_err(|e| format!("conexión lockdown: {:?}", e))?;

    // Legado (espejo del crate): GetValue ProductVersion en claro; si la
    // respuesta no llega o no parsea, se sigue como dispositivo moderno. El
    // adaptador toma prestado `dev` solo pa este paso y lo suelta antes de
    // que el crate suba la sesión.
    let mut legacy = false;
    {
        let mut io = IntercambioIdevice { dev: &mut dev };
        let gv = dict_get_value(&label, "ProductVersion");
        if io.enviar(&gv).await.is_ok() {
            if let Ok(resp) = io.recibir().await {
                if let Some(v) = resp
                    .get("Value")
                    .and_then(|v| v.as_string())
                    .and_then(|s| s.split('.').next())
                    .and_then(|s| s.parse::<u8>().ok())
                {
                    legacy = v < 5;
                }
            }
        }
    }

    // La sesión + el TLS los sube el crate sobre ESTA conexión (su
    // verificador y su configuración, los de siempre); lo que cambia es
    // quién pide el servicio: el StartService va a mano, con escrow.
    dev.start_session(pairing, legacy)
        .await
        .map_err(|e| format!("subiendo la sesión TLS: {:?}", e))?;

    let (port, ssl) = {
        let mut io = IntercambioIdevice { dev: &mut dev };
        negociar_start_service(&mut io, servicio, escrow_bag, presentar_escrow, etapa).await
    }
    .map_err(|apple| format!("Apple se negó a abrir {}: {}", servicio, apple))?;
    stage(&format!(
        "ETAPA {}: servicio {} ABIERTO en el puerto {}",
        etapa, servicio, port
    ));

    let mut svc = provider
        .connect(port)
        .await
        .map_err(|e| format!("conectando al puerto {} de {}: {:?}", port, servicio, e))?;
    if ssl {
        svc.start_session(pairing, legacy)
            .await
            .map_err(|e| format!("TLS del servicio {}: {:?}", servicio, e))?;
    }
    Ok(svc)
}

// ── Instalación con escrow (espejo de `isideload::sideload::install::install_app`,
//    pero abriendo AFC e InstallationProxy por `abrir_servicio`) ─────────────

const AFC_UPLOAD_CHUNK_SIZE: usize = 1024 * 1024;

fn tamano_dir(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            match std::fs::metadata(&p) {
                Ok(m) if m.is_dir() => total += tamano_dir(&p),
                Ok(m) => total += m.len(),
                Err(_) => {}
            }
        }
    }
    total
}

fn subir_dir<'a>(
    afc: &'a mut AfcClient,
    path: &'a Path,
    afc_path: &'a str,
    cb: &'a (dyn Fn(f64) + Send + Sync),
    uploaded: &'a mut u64,
    total: f64,
) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        let entries = std::fs::read_dir(path)
            .map_err(|e| format!("leyendo el directorio firmado: {}", e))?;
        afc.mk_dir(afc_path.to_string())
            .await
            .map_err(|e| format!("AFC creando {}: {:?}", afc_path, e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("leyendo una entrada: {}", e))?;
            let p = entry.path();
            let nombre = entry.file_name().to_string_lossy().to_string();
            let destino = format!("{}/{}", afc_path, nombre);
            let meta = std::fs::metadata(&p)
                .map_err(|e| format!("metadata de {}: {}", p.display(), e))?;
            if meta.is_dir() {
                subir_dir(afc, &p, &destino, cb, uploaded, total).await?;
            } else {
                let mut handle = afc
                    .open(destino, idevice::afc::opcode::AfcFopenMode::WrOnly)
                    .await
                    .map_err(|e| format!("AFC abriendo un archivo: {:?}", e))?;
                let bytes = std::fs::read(&p)
                    .map_err(|e| format!("leyendo {}: {}", p.display(), e))?;
                for chunk in bytes.chunks(AFC_UPLOAD_CHUNK_SIZE) {
                    handle
                        .write_entire(chunk)
                        .await
                        .map_err(|e| format!("AFC escribiendo: {:?}", e))?;
                    *uploaded += chunk.len() as u64;
                    cb(*uploaded as f64 / total);
                }
                handle
                    .close()
                    .await
                    .map_err(|e| format!("AFC cerrando: {:?}", e))?;
            }
        }
        Ok(())
    })
}

/// Instala una app YA firmada (`app_path` = el `.app` extraído) presentando
/// el EscrowBag en los dos servicios que toca: AFC (la subida a
/// PublicStaging) e InstallationProxy (la instalación). `progreso` recibe
/// 0–100 como en la función de isideload (0–70 subida, 70–100 instalación).
pub async fn instalar_con_escrow(
    provider: &AnfitrionProvider,
    pairing: &PairingFile,
    app_path: &Path,
    escrow_bag: Option<&[u8]>,
    presentar_escrow: bool,
    progreso: impl Fn(u64) + Send + Sync,
) -> Result<(), String> {
    let nombre = app_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or("la ruta de la app firmada no trae nombre")?;
    let dir = format!("PublicStaging/{}", nombre);

    let afc_stream = abrir_servicio(
        provider,
        pairing,
        SERVICE_AFC,
        escrow_bag,
        presentar_escrow,
        "instalacion",
    )
    .await?;
    let mut afc = AfcClient::from_stream(afc_stream)
        .await
        .map_err(|e| format!("cliente AFC: {:?}", e))?;
    let total = tamano_dir(app_path).max(1) as f64;
    let mut uploaded: u64 = 0;
    let cb = |p: f64| progreso((p * 70.0) as u64);
    subir_dir(&mut afc, app_path, &dir, &cb, &mut uploaded, total).await?;
    stage("ETAPA instalacion: app subida a PublicStaging por AFC");

    let ip_stream = abrir_servicio(
        provider,
        pairing,
        crate::probe::SERVICE_INSTALL,
        escrow_bag,
        presentar_escrow,
        "instalacion",
    )
    .await?;
    let mut inst = InstallationProxyClient::from_stream(ip_stream)
        .await
        .map_err(|e| format!("cliente InstallationProxy: {:?}", e))?;
    let mut options = plist::Dictionary::new();
    options.insert(
        "PackageType".into(),
        plist::Value::String("Developer".into()),
    );
    inst.install_with_callback(
        dir,
        Some(plist::Value::Dictionary(options)),
        async |(pct, _): (u64, ())| {
            progreso(70 + (0.3 * pct as f64) as u64);
        },
        (),
    )
    .await
    .map_err(|e| format!("InstallationProxy instalando: {:?}", e))?;
    Ok(())
}

// ── Bancos ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    fn dict_con(claves: &[(&str, plist::Value)]) -> plist::Dictionary {
        let mut d = plist::Dictionary::new();
        for (k, v) in claves {
            d.insert(k.to_string(), v.clone());
        }
        d
    }

    #[test]
    fn dict_start_service_sin_escrow_no_trae_la_clave() {
        let v = dict_start_service(SERVICE_AFC, LABEL_START_SERVICE, None);
        let d = v.as_dictionary().unwrap();
        assert_eq!(d.get("Request").unwrap().as_string().unwrap(), "StartService");
        assert_eq!(d.get("Service").unwrap().as_string().unwrap(), SERVICE_AFC);
        assert!(d.get("Label").is_some());
        assert!(d.get("EscrowBag").is_none());
    }

    #[test]
    fn dict_start_service_con_escrow_trae_la_bolsa_exacta() {
        let v = dict_start_service(SERVICE_AFC, LABEL_START_SERVICE, Some(&[5, 6, 7]));
        let d = v.as_dictionary().unwrap();
        assert_eq!(
            d.get("EscrowBag").unwrap().as_data().unwrap().to_vec(),
            vec![5u8, 6, 7]
        );
    }

    #[test]
    fn interpretar_puerto_y_error() {
        let ok = dict_con(&[
            ("Port", plist::Value::Integer(4321.into())),
            ("EnableServiceSSL", plist::Value::Boolean(true)),
        ]);
        assert_eq!(interpretar_start_service(&ok), Ok((4321u16, true)));
        let err = dict_con(&[(
            "Error",
            plist::Value::String("PasswordProtected".into()),
        )]);
        assert_eq!(
            interpretar_start_service(&err),
            Err("PasswordProtected".to_string())
        );
        let rara = dict_con(&[("Otra", plist::Value::String("x".into()))]);
        assert!(interpretar_start_service(&rara)
            .unwrap_err()
            .contains("sin Port y sin clave Error"));
    }

    #[test]
    fn la_regla_del_escrow() {
        assert!(toca_escrow(true, false));
        assert!(!toca_escrow(true, true));
        assert!(!toca_escrow(false, false));
    }

    /// Transporte simulado: graba los dicts enviados y responde con la cola
    /// de dicts guionizada — el banco del caso H1 del diagnóstico.
    struct IntercambioFalso {
        respuestas: VecDeque<plist::Dictionary>,
        enviados: Vec<plist::Value>,
    }

    impl Intercambio for IntercambioFalso {
        fn enviar(
            &mut self,
            dict: &plist::Value,
        ) -> impl Future<Output = Result<(), String>> + Send {
            self.enviados.push(dict.clone());
            async move { Ok(()) }
        }

        fn recibir(
            &mut self,
        ) -> impl Future<Output = Result<plist::Dictionary, String>> + Send {
            let r = self.respuestas.pop_front();
            async move { r.ok_or_else(|| "sin respuesta guionizada".to_string()) }
        }
    }

    fn negociar(io: &mut IntercambioFalso, bag: Option<&[u8]>, forzado: bool) -> Result<(u16, bool), String> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime del banco");
        rt.block_on(negociar_start_service(
            io,
            crate::probe::SERVICE_INSTALL,
            bag,
            forzado,
            "banco",
        ))
    }

    /// EL CASO H1, fijado pa siempre: sin bag Apple dice PasswordProtected;
    /// presentando el EscrowBag del registro, el servicio abre.
    #[test]
    fn h1_sin_bag_password_protected_con_bag_puerto() {
        let mut io = IntercambioFalso {
            respuestas: VecDeque::from(vec![
                dict_con(&[(
                    "Error",
                    plist::Value::String("PasswordProtected".into()),
                )]),
                dict_con(&[("Port", plist::Value::Integer(4321.into()))]),
            ]),
            enviados: Vec::new(),
        };
        let r = negociar(&mut io, Some(&[1, 2, 3]), false);
        assert_eq!(r, Ok((4321u16, false)));
        assert_eq!(io.enviados.len(), 2);
        let primero = io.enviados[0].as_dictionary().unwrap();
        assert!(primero.get("EscrowBag").is_none());
        let segundo = io.enviados[1].as_dictionary().unwrap();
        assert_eq!(
            segundo.get("EscrowBag").unwrap().as_data().unwrap().to_vec(),
            vec![1u8, 2, 3]
        );
    }

    #[test]
    fn directo_abre_sin_tocar_el_escrow() {
        let mut io = IntercambioFalso {
            respuestas: VecDeque::from(vec![dict_con(&[(
                "Port",
                plist::Value::Integer(1234.into()),
            )])]),
            enviados: Vec::new(),
        };
        assert_eq!(negociar(&mut io, Some(&[9]), false), Ok((1234u16, false)));
        assert_eq!(io.enviados.len(), 1);
    }

    #[test]
    fn sin_bag_en_el_registro_el_error_de_apple_sube_tal_cual() {
        let mut io = IntercambioFalso {
            respuestas: VecDeque::from(vec![dict_con(&[(
                "Error",
                plist::Value::String("PasswordProtected".into()),
            )])]),
            enviados: Vec::new(),
        };
        assert_eq!(
            negociar(&mut io, None, false),
            Err("PasswordProtected".to_string())
        );
        assert_eq!(io.enviados.len(), 1);
    }

    #[test]
    fn escrow_forzado_se_presenta_desde_el_primer_intento() {
        let mut io = IntercambioFalso {
            respuestas: VecDeque::from(vec![dict_con(&[(
                "Port",
                plist::Value::Integer(777.into()),
            )])]),
            enviados: Vec::new(),
        };
        assert_eq!(negociar(&mut io, Some(&[4, 4]), true), Ok((777u16, false)));
        assert_eq!(io.enviados.len(), 1);
        assert!(io.enviados[0]
            .as_dictionary()
            .unwrap()
            .get("EscrowBag")
            .is_some());
    }

    #[test]
    fn negado_tambien_con_escrow_sube_el_ultimo_error() {
        let mut io = IntercambioFalso {
            respuestas: VecDeque::from(vec![
                dict_con(&[(
                    "Error",
                    plist::Value::String("PasswordProtected".into()),
                )]),
                dict_con(&[(
                    "Error",
                    plist::Value::String("InvalidService".into()),
                )]),
            ]),
            enviados: Vec::new(),
        };
        assert_eq!(
            negociar(&mut io, Some(&[1]), false),
            Err("InvalidService".to_string())
        );
        assert_eq!(io.enviados.len(), 2);
    }
}

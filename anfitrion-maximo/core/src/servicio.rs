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
//!
//! **v2.5 — LA CAUSA RAÍZ, con nombre: «el StartSession que nunca se
//! envió».** Hasta la v2.4, `abrir_servicio` hacía GetValue en claro y
//! saltaba directo a `Idevice::start_session` — pero esa función del crate
//! (idevice-0.1.68, lib.rs:651) **SOLO sube el TLS**: no envía ningún
//! plist; asume la sesión ya negociada. Quien negocia es
//! `LockdownClient::start_session` (lockdown.rs:243-296): GetValue →
//! plist `{Label, Request: "StartSession", HostID, SystemBUID}` → exige
//! `EnableSessionSSL == true` → guarda el SessionID → recién entonces el
//! TLS. La cadena jamás mandaba ese plist (`dict_start_session` existía,
//! con su forma probada, pero ningún camino vivo lo llamaba): el
//! ClientHello caía sobre una conexión sin sesión, lockdownd reseteaba
//! (errno 54) y la apertura moría en «tls handshake eof» — en la sonda,
//! en cualquier transporte (hub, sesión fresca: daba igual). La vía 1 de
//! la puerta y la réplica abrían porque ambas negocian completo. El
//! arreglo es quirúrgico: `negociar_sesion` (abajo) corre la negociación
//! entera sobre el canal, con la respuesta cruda en el registro, ANTES de
//! subir el TLS — y un banco fija el orden GetValue → StartSession →
//! StartService pa que ninguna versión futura lo pierda en silencio.

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

// ── La negociación de la sesión (v2.5: el StartSession que faltaba) ─────────

/// Lo que `negociar_sesion` deja listo antes de subir el TLS.
#[derive(Debug)]
pub struct SesionNegociada {
    /// iOS < 5 (el «legado» del crate): con rustls ese TLS viejo no se
    /// soporta, igual que allá — el dato solo viaja a `start_session`.
    pub legacy: bool,
    /// El SessionID que lockdownd devolvió en la respuesta, si vino.
    pub session_id: Option<String>,
}

/// **La negociación COMPLETA de la sesión lockdown**, espejo fiel de
/// `LockdownClient::start_session` del crate (idevice-0.1.68,
/// lockdown.rs:243-296), sobre el canal en claro:
///
/// 1. `GetValue ProductVersion` — tolerante como el del crate (su fallo no
///    tumba nada: solo decide el legado, y sin respuesta se asume moderno).
/// 2. El plist **StartSession** `{Label, Request, HostID, SystemBUID}` con
///    la identidad del registro — su respuesta queda CRUDO en el registro
///    de etapas; si trae `Error`, sube tal cual.
/// 3. Se exige `EnableSessionSSL == true` y se guarda el `SessionID`.
///
/// Recién después de esto tiene sentido `Idevice::start_session`, que es
/// SOLO el TLS (lib.rs:651). Sin este paso, el ClientHello cae sobre una
/// conexión sin sesión y lockdownd la resetea (la muerte de la v2.4).
pub async fn negociar_sesion(
    io: &mut impl Intercambio,
    label: &str,
    host_id: &str,
    system_buid: &str,
    etapa: &str,
) -> Result<SesionNegociada, String> {
    // 1) GetValue previo (legado), tolerante.
    let mut legacy = false;
    let gv = dict_get_value(label, "ProductVersion");
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

    // 2) El StartSession, con su respuesta cruda al registro.
    let ss = dict_start_session(label, host_id, system_buid);
    io.enviar(&ss)
        .await
        .map_err(|e| format!("enviando el StartSession: {}", e))?;
    let resp = io
        .recibir()
        .await
        .map_err(|e| format!("leyendo la respuesta del StartSession: {}", e))?;
    stage(&format!(
        "ETAPA {}: respuesta StartSession cruda: {}",
        etapa,
        resumen_crudo(&dict_a_xml(&resp))
    ));
    if let Some(e) = resp.get("Error").and_then(|v| v.as_string()) {
        return Err(format!(
            "Apple se negó a abrir la sesión lockdown: {}",
            e
        ));
    }
    match resp.get("EnableSessionSSL").and_then(|v| v.as_boolean()) {
        Some(true) => {}
        _ => {
            return Err(format!(
                "la respuesta del StartSession no encendió el SSL de la sesión (EnableSessionSSL ausente o en false): {}",
                resumen_crudo(&dict_a_xml(&resp))
            ))
        }
    }
    let session_id = resp
        .get("SessionID")
        .and_then(|v| v.as_string())
        .map(|s| s.to_string());
    stage(&format!(
        "ETAPA {}: sesión lockdown NEGOCIADA{} — ahora sí, el TLS",
        etapa,
        match &session_id {
            Some(id) => format!(" (SessionID {})", id),
            None => String::new(),
        }
    ));
    Ok(SesionNegociada { legacy, session_id })
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
/// **negociación completa de la sesión** (`negociar_sesion`: GetValue →
/// StartSession, la respuesta cruda en el registro) → el TLS de
/// `Idevice::start_session` → StartService A MANO con escrow (ver
/// `negociar_start_service`) → conexión al puerto. Devuelve el stream listo
/// pa `IdeviceService::from_stream` del cliente que corresponda. El error,
/// cuando Apple se niega, trae su `Error` exacto.
///
/// v2.5 corrige aquí la causa raíz de la muerte de la cadena: hasta la
/// v2.4 este flujo saltaba del GetValue al `dev.start_session` creyendo
/// que el crate negociaba la sesión — y no: `Idevice::start_session` es
/// SOLO el TLS (lib.rs:651), sin ningún plist. El StartSession lo negocia
/// `LockdownClient::start_session` (lockdown.rs:243-296), y en este camino
/// a mano lo manda `negociar_sesion` con `dict_start_session` — la pieza
/// que existía desde la v2.3 sin que ningún camino vivo la llamara. Tras
/// responder `EnableSessionSSL=true`, lockdownd espera el ClientHello en
/// ESTA conexión: por eso el orden es plist primero, TLS después, y por
/// eso sin el plist el ClientHello se comía un reseteo (errno 54).
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

    // La negociación COMPLETA de la sesión sobre el canal en claro
    // (GetValue → StartSession con la identidad del registro). El
    // adaptador toma prestado `dev` solo pa este paso y lo suelta antes de
    // subir el TLS.
    let sesion = {
        let mut io = IntercambioIdevice { dev: &mut dev };
        negociar_sesion(
            &mut io,
            &label,
            &pairing.host_id,
            &pairing.system_buid,
            etapa,
        )
        .await
    }
    .map_err(|e| format!("negociando la sesión lockdown: {}", e))?;

    // Recién con la sesión negociada, el TLS de `Idevice::start_session`
    // (que es solo eso: el túnel, con el verificador y la configuración
    // del crate); el StartService va a mano, con escrow, sobre ese túnel.
    dev.start_session(pairing, sesion.legacy)
        .await
        .map_err(|e| format!("subiendo el TLS de la sesión: {:?}", e))?;

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
        svc.start_session(pairing, sesion.legacy)
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

    // ── v2.5: la negociación de la sesión (el StartSession que faltaba) ────

    /// La respuesta del GetValue ProductVersion que el guion necesita.
    fn resp_get_value() -> plist::Dictionary {
        dict_con(&[(
            "Value",
            plist::Value::String("18.7.10".into()),
        )])
    }

    /// La respuesta sana del StartSession: SSL encendido + SessionID.
    fn resp_start_session_ok() -> plist::Dictionary {
        dict_con(&[
            ("EnableSessionSSL", plist::Value::Boolean(true)),
            (
                "SessionID",
                plist::Value::String("SESION-BANCO-1".into()),
            ),
        ])
    }

    /// La respuesta del StartService con puerto (la misma forma que usan
    /// los bancos de la negociación del servicio).
    fn resp_con_puerto(puerto: i64) -> plist::Dictionary {
        dict_con(&[
            ("Port", plist::Value::Integer(puerto.into())),
            ("EnableServiceSSL", plist::Value::Boolean(true)),
        ])
    }

    /// La respuesta con el `Error` exacto de Apple.
    fn resp_con_error(error: &str) -> plist::Dictionary {
        dict_con(&[("Error", plist::Value::String(error.into()))])
    }

    /// Corre la negociación ENTERA (sesión + servicio) sobre el canal
    /// guionizado y devuelve lo negociado.
    fn negociar_todo(
        io: &mut IntercambioFalso,
    ) -> Result<(SesionNegociada, (u16, bool)), String> {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async {
            let sesion = negociar_sesion(
                io,
                "anfitrion-maximo",
                "HOST-BANCO",
                "BUID-BANCO",
                "banco",
            )
            .await?;
            let puerto = negociar_start_service(
                io,
                crate::probe::SERVICE_INSTALL,
                None,
                false,
                "banco",
            )
            .await?;
            Ok((sesion, puerto))
        })
    }

    fn requests_de(io: &IntercambioFalso) -> Vec<String> {
        io.enviados
            .iter()
            .map(|v| {
                v.as_dictionary()
                    .unwrap()
                    .get("Request")
                    .unwrap()
                    .as_string()
                    .unwrap()
                    .to_string()
            })
            .collect()
    }

    /// **EL BANCO DE LA CAUSA RAÍZ (v2.5)**: la negociación completa sale
    /// en el orden del protocolo — GetValue → **StartSession** →
    /// StartService — y el StartSession lleva la identidad del registro
    /// (HostID + SystemBUID). Si una versión futura pierde el StartSession
    /// en silencio (la muerte de la v2.4), este banco la caza en el
    /// laboratorio, no en el iPhone de Ernesto.
    #[test]
    fn negociacion_completa_en_orden_getvalue_startsession_startservice() {
        let mut io = IntercambioFalso {
            respuestas: VecDeque::from(vec![
                resp_get_value(),
                resp_start_session_ok(),
                resp_con_puerto(4321),
            ]),
            enviados: Vec::new(),
        };
        let (sesion, (port, _ssl)) = negociar_todo(&mut io).unwrap();
        assert!(!sesion.legacy, "iOS 18 no es legado");
        assert_eq!(sesion.session_id.as_deref(), Some("SESION-BANCO-1"));
        assert_eq!(port, 4321);
        assert_eq!(
            requests_de(&io),
            ["GetValue", "StartSession", "StartService"],
            "el orden de la negociación es el del protocolo"
        );
        let ss = io.enviados[1].as_dictionary().unwrap();
        assert_eq!(
            ss.get("HostID").and_then(|v| v.as_string()),
            Some("HOST-BANCO")
        );
        assert_eq!(
            ss.get("SystemBUID").and_then(|v| v.as_string()),
            Some("BUID-BANCO")
        );
        assert_eq!(
            ss.get("Label").and_then(|v| v.as_string()),
            Some("anfitrion-maximo")
        );
    }

    /// Si lockdownd se niega a abrir la sesión, su `Error` sube TAL CUAL y
    /// ningún StartService se intenta sobre una sesión que no existe.
    #[test]
    fn start_session_con_error_sube_tal_cual_y_no_pide_servicio() {
        let mut io = IntercambioFalso {
            respuestas: VecDeque::from(vec![
                resp_get_value(),
                resp_con_error("InvalidHostID"),
            ]),
            enviados: Vec::new(),
        };
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let err = rt
            .block_on(negociar_sesion(
                &mut io,
                "anfitrion-maximo",
                "HOST-BANCO",
                "BUID-BANCO",
                "banco",
            ))
            .unwrap_err();
        assert!(
            err.contains("InvalidHostID"),
            "el error es el de Apple: {}",
            err
        );
        assert_eq!(
            requests_de(&io),
            ["GetValue", "StartSession"],
            "sin sesión no se pide servicio"
        );
    }

    /// Una respuesta de StartSession sin `EnableSessionSSL` en true NO es
    /// una sesión: subir el TLS sobre eso sería repetir la v2.4.
    #[test]
    fn start_session_sin_enable_ssl_no_sube() {
        let sin_ssl = dict_con(&[(
            "SessionID",
            plist::Value::String("SESION-BANCO-2".into()),
        )]);
        let mut io = IntercambioFalso {
            respuestas: VecDeque::from(vec![resp_get_value(), sin_ssl]),
            enviados: Vec::new(),
        };
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let err = rt
            .block_on(negociar_sesion(
                &mut io,
                "anfitrion-maximo",
                "HOST-BANCO",
                "BUID-BANCO",
                "banco",
            ))
            .unwrap_err();
        assert!(
            err.contains("EnableSessionSSL"),
            "el error nombra lo que faltó: {}",
            err
        );
        assert_eq!(io.enviados.len(), 2);
    }

    /// La forma del plist StartSession, fijada: la identidad del registro
    /// viaja como la pide `LockdownClient::start_session` del crate.
    #[test]
    fn dict_start_session_lleva_la_identidad_del_registro() {
        let d = dict_start_session("anfitrion-maximo", "HOST-X", "BUID-X");
        let d = d.as_dictionary().unwrap();
        assert_eq!(
            d.get("Request").and_then(|v| v.as_string()),
            Some("StartSession")
        );
        assert_eq!(
            d.get("Label").and_then(|v| v.as_string()),
            Some("anfitrion-maximo")
        );
        assert_eq!(d.get("HostID").and_then(|v| v.as_string()), Some("HOST-X"));
        assert_eq!(
            d.get("SystemBUID").and_then(|v| v.as_string()),
            Some("BUID-X")
        );
    }
}

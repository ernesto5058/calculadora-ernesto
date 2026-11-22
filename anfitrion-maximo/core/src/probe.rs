//! **Sonda manual de lockdown (v2.2)** — la puerta de la cadena de firma.
//!
//! La v2.1 moría en la sonda del crate `idevice`
//! (`InstallationProxyClient::connect`) con
//! `UnexpectedResponse("missing Port in StartService response")`: el crate
//! descarta la respuesta cruda de lockdownd y el `Error` de Apple
//! (PasswordProtected, InvalidService, …) jamás se veía. Aquí la secuencia
//! lockdown se abre **a mano** sobre nuestro `MuxPipe` (QueryType →
//! StartSession → TLS con el registro → StartService) y **cada respuesta
//! cruda queda en el registro de etapas**, tal cual la mandó el iPhone.
//!
//! Las vías, en orden, adaptando cada intento al `Error` anterior (nada de
//! reintentos ciegos idénticos):
//! 1. **Directa**: StartService con el registro de la bóveda.
//! 2. **Escrow**: el mismo StartService con la clave `EscrowBag` del
//!    registro (la forma de `AMDeviceSecureStartService` /
//!    `start_service_with_escrow` del crate) — la vía diseñada pa cuando
//!    Apple responde `PasswordProtected`.
//! 3. **Re-pair fresco**: si el registro de la bóveda se niega (con y sin
//!    escrow), se re-empareja en el acto con el flujo de `pair.rs` (el
//!    iPhone pide «Confiar»), el registro nuevo **reemplaza** al de la
//!    bóveda y se reintenta el StartService con él.
//! 4. **Conexión nueva**: la secuencia completa sobre un transporte/mux/
//!    lockdown recién abiertos, con el registro vigente.
//!
//! La cadena solo se declara vencida cuando las cuatro vías quedaron
//! registradas con su respuesta exacta. Si alguna abre el servicio, la
//! cadena sigue por su camino normal (el provider del crate).
//!
//! **v2.3** suma dos piezas de diagnóstico/ciclo de vida:
//! - **StopSession**: cuando un intento abre el servicio, la sesión lockdown
//!   de ESE intento se cierra como manda el protocolo (antes se abandonaba
//!   al caer la conexión) — discrimina la hipótesis de la sesión zombi.
//! - **Réplica del crate**: tras pasar la puerta, se corre en conexión nueva
//!   la secuencia EXACTA de `idevice` (sin QueryType, StartService sin Label
//!   y sin escrow) registrando su respuesta cruda — discrimina si la forma
//!   de la petición del crate es la causa de su negativa en la cadena.

use std::io::{Read, Write};
use std::sync::Arc;

use idevice_usb_core::lockdown_proto::{
    parse_lockdown_error_string, parse_start_service_response, start_service_xml,
    start_session_enable_ssl, start_session_xml, LOCKDOWND_PORT, QUERY_TYPE_XML,
};
use rustls::pki_types::pem::PemObject;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, ServerName, UnixTime};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::{ClientConfig, ClientConnection, DigitallySignedStruct, SignatureScheme};

use crate::mux::MuxPipe;
use crate::stage;
use crate::vault::VaultHandle;

pub const SERVICE_INSTALL: &str = "com.apple.mobile.installation_proxy";

type StageErr = (String, String);

fn err(stage: &str, msg: impl Into<String>) -> StageErr {
    (stage.to_string(), msg.into())
}

// ── El registro de pairing, parseado ─────────────────────────────────────────

pub struct PairRecordInfo {
    pub host_id: String,
    pub system_buid: String,
    pub escrow_bag: Option<Vec<u8>>,
    pub host_cert_pem: String,
    pub host_key_pem: String,
    pub root_cert_pem: String,
    pub device_cert_pem: String,
}

/// Parsea el registro de la bóveda (plist XML formato libimobiledevice):
/// IDs de sesión, certificados/llave en PEM y el EscrowBag si el Pair lo dio.
pub fn parse_pair_record(bytes: &[u8]) -> Result<PairRecordInfo, String> {
    let value: plist::Value =
        plist::from_bytes(bytes).map_err(|e| format!("el registro no es un plist válido: {}", e))?;
    let dict = value
        .into_dictionary()
        .ok_or("el registro de pairing no es un diccionario")?;
    let texto = |k: &str| -> Result<String, String> {
        dict.get(k)
            .and_then(|v| v.as_string())
            .map(|s| s.to_string())
            .ok_or_else(|| format!("el registro no trae {}", k))
    };
    let pem = |k: &str| -> Result<String, String> {
        let data = dict
            .get(k)
            .and_then(|v| v.as_data())
            .ok_or_else(|| format!("el registro no trae {}", k))?;
        String::from_utf8(data.to_vec())
            .map_err(|_| format!("{} del registro no es PEM en UTF-8", k))
    };
    Ok(PairRecordInfo {
        host_id: texto("HostID")?,
        system_buid: texto("SystemBUID")?,
        escrow_bag: dict
            .get("EscrowBag")
            .and_then(|v| v.as_data())
            .filter(|b| !b.is_empty())
            .map(|b| b.to_vec()),
        host_cert_pem: pem("HostCertificate")?,
        host_key_pem: pem("HostPrivateKey")?,
        root_cert_pem: pem("RootCertificate")?,
        device_cert_pem: pem("DeviceCertificate")?,
    })
}

/// Origen de un registro de pairing que va a guardarse: la validación
/// cambia con el origen (acuerdo v2.8.2). El EscrowBag es obligatorio
/// solo en importación externa y migración heredada; el Pair recién
/// generado y el rescate de re-pair lo dejan opcional — la cadena de
/// la sonda contempla `rec.escrow_bag.is_none()` y el servicio lo
/// recibe como opción, así que endurecerlo ahí rompería el rescate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PairingOrigin {
    Import,
    Migration,
    FreshPair,
    Repair,
}

impl PairingOrigin {
    pub fn require_escrow(self) -> bool {
        matches!(self, Self::Import | Self::Migration)
    }

    /// Nombre que Kotlin pasa por JNI ("import" | "migration" | "fresh" | "repair").
    pub fn from_nombre(nombre: &str) -> Option<Self> {
        match nombre.trim().to_ascii_lowercase().as_str() {
            "import" | "importacion" => Some(Self::Import),
            "migration" | "migracion" => Some(Self::Migration),
            "fresh" | "freshpair" | "fresco" => Some(Self::FreshPair),
            "repair" | "rescate" => Some(Self::Repair),
            _ => None,
        }
    }
}

/// Valida un registro de pairing ANTES de guardarlo, con las reglas de
/// su origen. NO endurece `parse_pair_record` (el EscrowBag sigue siendo
/// `Option` en toda la cadena): solo añade la comprobación de no-vacío
/// que `texto()`/`pem()` no hacen y el requisito de EscrowBag pa los
/// orígenes que lo exigen.
pub fn validate_pair_record(bytes: &[u8], origin: PairingOrigin) -> Result<(), String> {
    let rec = parse_pair_record(bytes)?;
    let no_vacio = |nombre: &str, valor: &str| -> Result<(), String> {
        if valor.trim().is_empty() {
            Err(format!("el registro trae {} vacío", nombre))
        } else {
            Ok(())
        }
    };
    no_vacio("HostID", &rec.host_id)?;
    no_vacio("SystemBUID", &rec.system_buid)?;
    no_vacio("HostCertificate", &rec.host_cert_pem)?;
    no_vacio("HostPrivateKey", &rec.host_key_pem)?;
    no_vacio("RootCertificate", &rec.root_cert_pem)?;
    no_vacio("DeviceCertificate", &rec.device_cert_pem)?;
    if origin.require_escrow() && rec.escrow_bag.as_ref().map_or(true, |b| b.is_empty()) {
        return Err("el registro no trae EscrowBag (obligatorio pa importar)".to_string());
    }
    Ok(())
}

// ── StartService con EscrowBag (la forma del crate, hecha a mano) ────────────

/// `StartService` con la clave `EscrowBag` (CFData del registro): espejo del
/// `start_service_with_escrow` de `idevice` (que a su vez espeja
/// `AMDeviceSecureStartService` con `UnlockEscrowBag`), construido con el
/// crate `plist` porque el builder vendorizado no trae la variante.
pub fn start_service_escrow_xml(service: &str, escrow_bag: &[u8]) -> String {
    let mut dict = plist::Dictionary::new();
    dict.insert(
        "Label".into(),
        plist::Value::String("iphone-wasm".into()),
    );
    dict.insert(
        "Request".into(),
        plist::Value::String("StartService".into()),
    );
    dict.insert(
        "Service".into(),
        plist::Value::String(service.to_string()),
    );
    dict.insert(
        "EscrowBag".into(),
        plist::Value::Data(escrow_bag.to_vec()),
    );
    let value = plist::Value::Dictionary(dict);
    let mut buf: Vec<u8> = Vec::new();
    match value.to_writer_xml(&mut buf) {
        Ok(()) => String::from_utf8_lossy(&buf).to_string(),
        Err(_) => String::new(),
    }
}

// ── Clasificación del Error de Apple (adaptación, no reintentos ciegos) ─────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaseError {
    /// `PasswordProtected`: el iPhone se considera bloqueado pa el servicio.
    Bloqueo,
    /// Errores de sesión (`SessionInactive`, …): la sesión se rehace nueva.
    Sesion,
    /// Errores del registro (`InvalidPairRecord`, `InvalidHostID`, …).
    Registro,
    /// El servicio mismo (`InvalidService`, …).
    Servicio,
    Otro,
}

pub fn clase_error(error: &str) -> ClaseError {
    if error.contains("PasswordProtected") {
        ClaseError::Bloqueo
    } else if error.contains("Session") {
        ClaseError::Sesion
    } else if error.contains("PairRecord") || error.contains("HostID") || error.contains("Pair") {
        ClaseError::Registro
    } else if error.contains("Service") {
        ClaseError::Servicio
    } else {
        ClaseError::Otro
    }
}

fn interpretacion(clase: ClaseError) -> &'static str {
    match clase {
        ClaseError::Bloqueo => {
            "es el error de un iPhone que se considera bloqueado pa este servicio: la vía diseñada pa eso es presentar el EscrowBag del registro"
        }
        ClaseError::Sesion => {
            "la sesión lockdown se cayó: se rehace entera en una conexión nueva"
        }
        ClaseError::Registro => {
            "suena a registro de pairing rechazado: la salida es re-emparejar y estrenar registro"
        }
        ClaseError::Servicio => "el servicio mismo se niega a abrir con este registro",
        ClaseError::Otro => "queda registrado crudo en la línea anterior",
    }
}

/// La respuesta cruda de lockdownd, aplanada a una línea pa el registro de
/// etapas (el dict COMPLETO, con tope generoso: estas respuestas son cortas).
pub fn resumen_crudo(xml: &str) -> String {
    let flat: String = xml
        .chars()
        .map(|c| if c == '\n' || c == '\t' || c == '\r' { ' ' } else { c })
        .collect();
    let flat = flat.trim();
    if flat.chars().count() > 1500 {
        let cortado: String = flat.chars().take(1500).collect();
        format!("{}…[recortado, {} caracteres en total]", cortado, flat.chars().count())
    } else {
        flat.to_string()
    }
}

// ── TLS sobre el MuxPipe (StartSession enciende SSL en la conexión) ─────────

/// Adaptador `Read`/`Write` sobre el `MuxPipe`: rustls habla por aquí.
struct PipeIo<'a, 't> {
    pipe: &'a mut MuxPipe<'t>,
    rbuf: Vec<u8>,
}

impl Read for PipeIo<'_, '_> {
    fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
        if self.rbuf.is_empty() {
            let chunk = self
                .pipe
                .recv_payload()
                .map_err(std::io::Error::other)?;
            if chunk.is_empty() {
                return Ok(0);
            }
            self.rbuf = chunk;
        }
        let n = self.rbuf.len().min(out.len());
        out[..n].copy_from_slice(&self.rbuf[..n]);
        self.rbuf.drain(..n);
        Ok(n)
    }
}

impl Write for PipeIo<'_, '_> {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        self.pipe
            .send_payload(data)
            .map_err(std::io::Error::other)?;
        Ok(data.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Verificador con **pinning**: el certificado que lockdownd presenta debe
/// ser EXACTAMENTE el `DeviceCertificate` del registro (más estricto que el
/// verificador del crate `idevice`, que acepta cualquiera); las firmas del
/// handshake sí se verifican de verdad delegando en WebPki.
#[derive(Debug)]
struct PinnedVerifier {
    inner: Arc<rustls::client::WebPkiServerVerifier>,
    device_der: Vec<u8>,
}

impl ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if end_entity.as_ref() == self.device_der.as_slice() {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(rustls::Error::General(
                "el certificado del iPhone no es el DeviceCertificate del registro".into(),
            ))
        }
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }
}

fn pem_der(pem_text: &str, que: &str) -> Result<Vec<u8>, String> {
    let parsed = pem::parse(pem_text.as_bytes())
        .map_err(|e| format!("{} del registro no se pudo leer como PEM: {}", que, e))?;
    Ok(parsed.contents().to_vec())
}

fn tls_config(rec: &PairRecordInfo) -> Result<ClientConfig, String> {
    crate::signinstall::ensure_crypto_provider();
    let root_der = pem_der(&rec.root_cert_pem, "RootCertificate")?;
    let host_der = pem_der(&rec.host_cert_pem, "HostCertificate")?;
    let device_der = pem_der(&rec.device_cert_pem, "DeviceCertificate")?;
    let mut root_store = rustls::RootCertStore::empty();
    root_store
        .add(CertificateDer::from(root_der))
        .map_err(|e| format!("RootCertificate del registro rechazado: {}", e))?;
    let key = PrivateKeyDer::from_pem_slice(rec.host_key_pem.as_bytes())
        .map_err(|e| format!("HostPrivateKey del registro ilegible: {}", e))?;
    let mut config = ClientConfig::builder()
        .with_root_certificates(root_store.clone())
        .with_client_auth_cert(vec![CertificateDer::from(host_der)], key)
        .map_err(|e| format!("no se pudo armar el cliente TLS: {}", e))?;
    let inner = rustls::client::WebPkiServerVerifier::builder(Arc::new(root_store))
        .build()
        .map_err(|e| format!("verificador TLS: {}", e))?;
    config
        .dangerous()
        .set_certificate_verifier(Arc::new(PinnedVerifier { inner, device_der }));
    Ok(config)
}

// ── StopSession (v2.3): cerrar la sesión como manda el protocolo ────────────

/// El `SessionID` de la respuesta cruda de StartSession, si vino.
fn session_id_de(xml: &str) -> Option<String> {
    let value: plist::Value = plist::from_bytes(xml.as_bytes()).ok()?;
    value
        .as_dictionary()?
        .get("SessionID")?
        .as_string()
        .map(|s| s.to_string())
}

/// `StopSession` con el SessionID de la conexión: espejo del
/// `stop_session` del crate, construido con el crate `plist`.
pub fn stop_session_xml(session_id: &str) -> String {
    let mut dict = plist::Dictionary::new();
    dict.insert(
        "Label".into(),
        plist::Value::String("iphone-wasm".into()),
    );
    dict.insert(
        "Request".into(),
        plist::Value::String("StopSession".into()),
    );
    dict.insert(
        "SessionID".into(),
        plist::Value::String(session_id.to_string()),
    );
    let value = plist::Value::Dictionary(dict);
    let mut buf: Vec<u8> = Vec::new();
    match value.to_writer_xml(&mut buf) {
        Ok(()) => String::from_utf8_lossy(&buf).to_string(),
        Err(_) => String::new(),
    }
}

/// Cierra la sesión lockdown de este intento tras un StartService con
/// puerto. Es de cortesía protocolaria: su fallo jamás tumba el intento
/// (la sesión cae con la conexión de todas formas), pero queda registrado.
fn cerrar_sesion(
    pipe: &mut MuxPipe,
    rec: &PairRecordInfo,
    con_ssl: bool,
    session_id: &Option<String>,
) {
    let Some(id) = session_id else {
        return;
    };
    match pedir_servicio(pipe, rec, con_ssl, &stop_session_xml(id)) {
        Ok(resp) => stage(&format!(
            "ETAPA sonda: StopSession enviado (la sesión de este intento queda cerrada) — respuesta cruda: {}",
            resumen_crudo(&resp)
        )),
        Err(e) => stage(&format!(
            "ETAPA sonda: aviso — el StopSession no se pudo enviar ({}); la sesión cae con la conexión",
            e
        )),
    }
}

// ── Un intento completo sobre una conexión lockdown ──────────────────────────

pub struct Intento {
    /// Puerto abierto, si el servicio abrió.
    pub port: Option<u16>,
    /// El StartService que abrió fue el de escrow.
    pub abrio_con_escrow: bool,
    /// `Error` de Apple en el StartService directo (o en StartSession).
    pub error_directa: Option<String>,
    /// `Error` de Apple en el StartService con escrow (si corrió).
    pub error_escrow: Option<String>,
    pub escrow_corrio: bool,
    /// La sesión (StartSession) no abrió: el StartService ni se intentó.
    pub sesion_error: Option<String>,
    /// Fallo sin respuesta de Apple (mux/TLS/timeout): re-emparejar no lo arregla.
    pub fallo_transporte: Option<String>,
}

impl Intento {
    fn de_transporte(msg: String) -> Self {
        Intento {
            port: None,
            abrio_con_escrow: false,
            error_directa: None,
            error_escrow: None,
            escrow_corrio: false,
            sesion_error: None,
            fallo_transporte: Some(msg),
        }
    }
}

/// Secuencia completa en UNA conexión: QueryType → StartSession (crudo al
/// registro) → TLS si lockdownd lo enciende → StartService directo (crudo)
/// → StartService con EscrowBag si el directo se niega y hay bag (crudo).
fn intento(pipe: &mut MuxPipe, rec: &PairRecordInfo) -> Intento {
    let mut out = Intento {
        port: None,
        abrio_con_escrow: false,
        error_directa: None,
        error_escrow: None,
        escrow_corrio: false,
        sesion_error: None,
        fallo_transporte: None,
    };

    // QueryType: la conexión habla con lockdownd de verdad.
    match pipe.request(QUERY_TYPE_XML) {
        Ok(qt) => {
            if !qt.contains("com.apple.mobile.lockdown") {
                return Intento::de_transporte(format!(
                    "QueryType no devolvió lockdownd: {}",
                    resumen_crudo(&qt)
                ));
            }
        }
        Err(e) => return Intento::de_transporte(format!("QueryType: {}", e)),
    }

    // StartSession, con su respuesta cruda al registro.
    let ss = match pipe.request(&start_session_xml(&rec.host_id, &rec.system_buid)) {
        Ok(r) => r,
        Err(e) => return Intento::de_transporte(format!("StartSession: {}", e)),
    };
    stage(&format!(
        "ETAPA sonda: respuesta StartSession cruda: {}",
        resumen_crudo(&ss)
    ));
    if let Some(e) = parse_lockdown_error_string(&ss) {
        stage(&format!(
            "ETAPA sonda: Apple dijo «{}» en StartSession — {}",
            e,
            interpretacion(clase_error(&e))
        ));
        out.sesion_error = Some(e.clone());
        out.error_directa = Some(e);
        return out;
    }
    if !ss.contains("SessionID") && !start_session_enable_ssl(&ss) {
        out.sesion_error = Some("StartSession sin SessionID ni EnableSessionSSL".to_string());
        out.error_directa = out.sesion_error.clone();
        return out;
    }

    // El StartService viaja por TLS si la sesión lo encendió, o en claro.
    let con_ssl = start_session_enable_ssl(&ss);
    let session_id = session_id_de(&ss);

    // StartService directo.
    match pedir_servicio(pipe, rec, con_ssl, &start_service_xml(SERVICE_INSTALL)) {
        Ok(resp) => {
            stage(&format!(
                "ETAPA sonda: respuesta StartService (directo) cruda: {}",
                resumen_crudo(&resp)
            ));
            if let Ok((port, _ssl)) = parse_start_service_response(&resp) {
                out.port = Some(port);
                cerrar_sesion(pipe, rec, con_ssl, &session_id);
                return out;
            }
            let e = parse_lockdown_error_string(&resp)
                .unwrap_or_else(|| "respuesta sin Port y sin clave Error".to_string());
            stage(&format!(
                "ETAPA sonda: Apple dijo «{}» al StartService directo — {}",
                e,
                interpretacion(clase_error(&e))
            ));
            out.error_directa = Some(e);
        }
        Err(e) => {
            out.fallo_transporte = Some(format!("StartService directo: {}", e));
            return out;
        }
    }

    // StartService con EscrowBag (solo si el registro lo trae).
    match &rec.escrow_bag {
        Some(bag) => {
            out.escrow_corrio = true;
            stage(&format!(
                "ETAPA sonda: presentando el EscrowBag del registro ({} bytes) en un segundo StartService…",
                bag.len()
            ));
            match pedir_servicio(pipe, rec, con_ssl, &start_service_escrow_xml(SERVICE_INSTALL, bag)) {
                Ok(resp) => {
                    stage(&format!(
                        "ETAPA sonda: respuesta StartService (con EscrowBag) cruda: {}",
                        resumen_crudo(&resp)
                    ));
                    if let Ok((port, _ssl)) = parse_start_service_response(&resp) {
                        out.port = Some(port);
                        out.abrio_con_escrow = true;
                        cerrar_sesion(pipe, rec, con_ssl, &session_id);
                        return out;
                    }
                    let e = parse_lockdown_error_string(&resp)
                        .unwrap_or_else(|| "respuesta sin Port y sin clave Error".to_string());
                    stage(&format!(
                        "ETAPA sonda: Apple dijo «{}» también con EscrowBag — {}",
                        e,
                        interpretacion(clase_error(&e))
                    ));
                    out.error_escrow = Some(e);
                }
                Err(e) => {
                    out.fallo_transporte = Some(format!("StartService con escrow: {}", e));
                }
            }
        }
        None => {
            stage(
                "ETAPA sonda: el registro no trae EscrowBag (el Pair no lo dio): la vía del escrow no puede correr",
            );
        }
    }
    out
}

/// Un StartService por la conexión ya abierta: por TLS si la sesión lo
/// encendió tras StartSession, o en claro por el pipe si no.
fn pedir_servicio(
    pipe: &mut MuxPipe,
    rec: &PairRecordInfo,
    con_ssl: bool,
    xml: &str,
) -> Result<String, String> {
    if con_ssl {
        pedir_servicio_tls(pipe, rec, xml)
    } else {
        pipe.request(xml)
    }
}

/// StartService sobre la sesión TLS: ClientHello con el certificado del
/// anfitrión, framing de lockdownd (4 bytes BE + XML) dentro del túnel.
fn pedir_servicio_tls(pipe: &mut MuxPipe, rec: &PairRecordInfo, xml: &str) -> Result<String, String> {
    let config = tls_config(rec)?;
    let conn = ClientConnection::new(
        Arc::new(config),
        ServerName::try_from("Device")
            .map_err(|_| "nombre de servidor TLS inválido".to_string())?,
    )
    .map_err(|e| format!("no se pudo crear la conexión TLS: {}", e))?;
    let io = PipeIo {
        pipe,
        rbuf: Vec::new(),
    };
    let mut stream = rustls::StreamOwned::new(conn, io);
    let bytes = xml.as_bytes();
    let mut frame = Vec::with_capacity(4 + bytes.len());
    frame.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    frame.extend_from_slice(bytes);
    stream
        .write_all(&frame)
        .map_err(|e| format!("TLS escribiendo el StartService: {}", e))?;
    stream
        .flush()
        .map_err(|e| format!("TLS vaciando el StartService: {}", e))?;
    let mut hdr = [0u8; 4];
    stream
        .read_exact(&mut hdr)
        .map_err(|e| format!("TLS leyendo la respuesta: {}", e))?;
    let len = u32::from_be_bytes(hdr) as usize;
    if len == 0 || len > 8 * 1024 * 1024 {
        return Err(format!("TLS: longitud de respuesta inválida {}", len));
    }
    let mut buf = vec![0u8; len];
    stream
        .read_exact(&mut buf)
        .map_err(|e| format!("TLS leyendo el cuerpo de la respuesta: {}", e))?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}

/// Un intento en transporte recién preparado (SET_CONFIGURATION fresco +
/// MuxPipe nuevo). Los fallos de preparación del transporte SÍ son error de
/// etapa (cable fuera, claim ocupado): ninguna vía posterior los arregla.
fn intento_en_transporte_nuevo(fd: i32, rec: &PairRecordInfo) -> Result<Intento, StageErr> {
    let mut transport = crate::pair::open_mux_transport(fd, "")?;
    let eps = transport.endpoints();
    let mut pipe = match MuxPipe::connect(&mut transport, eps, LOCKDOWND_PORT) {
        Ok(p) => p,
        Err(e) => return Ok(Intento::de_transporte(format!("sesión mux: {}", e))),
    };
    Ok(intento(&mut pipe, rec))
}

// ── La puerta completa: vías 1–4 ─────────────────────────────────────────────

pub struct GateOk {
    /// Nombre de la vía que abrió (pa el registro y el informe).
    pub via: String,
    /// El servicio SOLO abrió presentando el EscrowBag.
    pub escrow_necesario: bool,
    pub puerto: u16,
}

/// La puerta completa: corre las vías 1–4 y, si alguna abre, remata con la
/// réplica del crate (diagnóstico permanente de la v2.3; jamás tumba la
/// puerta — su resultado solo se registra).
pub fn gate(
    fd: i32,
    vault: &VaultHandle,
    pairing_bytes: &mut Vec<u8>,
) -> Result<GateOk, StageErr> {
    let out = gate_vias(fd, vault, pairing_bytes)?;
    if let Ok(rec) = parse_pair_record(pairing_bytes) {
        replica_crate(fd, &rec);
    }
    Ok(out)
}

/// Corre la sonda manual completa. Si el re-pair renueva el registro,
/// `pairing_bytes` queda actualizado y la bóveda sellada con el nuevo.
/// Error = las cuatro vías registradas y vencidas, con el `Error` de Apple
/// de cada una en el mensaje.
fn gate_vias(
    fd: i32,
    vault: &VaultHandle,
    pairing_bytes: &mut Vec<u8>,
) -> Result<GateOk, StageErr> {
    let rec = parse_pair_record(pairing_bytes).map_err(|e| {
        err(
            "sonda",
            format!(
                "el registro de pairing de la bóveda no se pudo interpretar ({}): re-empareja desde la pantalla principal",
                e
            ),
        )
    })?;
    let mut fallos: Vec<(String, String)> = Vec::new();

    // ── Vías 1 (directa) y 2 (escrow), con el registro de la bóveda ────────
    stage("ETAPA sonda: abriendo la secuencia lockdown a mano (la respuesta de Apple queda registrada cruda)…");
    let i1 = intento_en_transporte_nuevo(fd, &rec)?;
    if let Some(puerto) = i1.port {
        let via = if i1.abrio_con_escrow {
            "2 (EscrowBag del registro de la bóveda)"
        } else {
            "1 (directa, registro de la bóveda)"
        };
        stage(&format!(
            "ETAPA sonda: servicio de instalación ABIERTO por la vía {} — puerto {}",
            via, puerto
        ));
        return Ok(GateOk {
            via: via.to_string(),
            escrow_necesario: i1.abrio_con_escrow,
            puerto,
        });
    }
    fallos.push((
        "vía 1 (directa)".to_string(),
        i1.error_directa
            .clone()
            .or_else(|| i1.fallo_transporte.clone())
            .unwrap_or_else(|| "sin respuesta".to_string()),
    ));
    fallos.push((
        "vía 2 (EscrowBag)".to_string(),
        if i1.escrow_corrio {
            i1.error_escrow
                .clone()
                .or_else(|| i1.fallo_transporte.clone())
                .unwrap_or_else(|| "sin respuesta".to_string())
        } else if rec.escrow_bag.is_none() {
            "el registro no trae EscrowBag".to_string()
        } else if i1.sesion_error.is_some() {
            "la sesión no abrió: el StartService ni se intentó".to_string()
        } else {
            i1.fallo_transporte
                .clone()
                .unwrap_or_else(|| "no corrió".to_string())
        },
    ));

    // Adaptación: sin respuesta de Apple (fallo de transporte puro),
    // re-emparejar no arregla nada — se salta a la conexión nueva.
    let saltar_reparar = i1.fallo_transporte.is_some() && i1.sesion_error.is_none();
    let mut rec_actual = rec;

    if saltar_reparar {
        stage(
            "ETAPA sonda: el fallo fue de transporte (Apple ni respondió): re-emparejar no lo arregla — salto directo a la vía 4 (conexión nueva)",
        );
        fallos.push((
            "vía 3 (pairing nuevo)".to_string(),
            "saltada: el fallo fue de transporte, sin respuesta de Apple".to_string(),
        ));
    } else {
        // ── Vía 3: re-pair fresco dentro de la cadena ──────────────────────
        stage(
            "ETAPA sonda: el registro de la bóveda se niega — voy a RE-EMPAREJAR en el acto. Mira el iPhone AHORA: desbloquéalo y toca «Confiar» cuando lo pida…",
        );
        let reparado = (|| -> Result<String, StageErr> {
            let mut t = crate::pair::open_mux_transport(fd, "")?;
            crate::pair::pair_with_transport(&mut t)
        })();
        match reparado {
            Ok(xml) => {
                match vault.set_pairing(PairingOrigin::Repair, xml.as_bytes()) {
                    Ok(()) => stage(
                        "ETAPA sonda: registro nuevo guardado en la bóveda (reemplaza al anterior)",
                    ),
                    Err(e) => stage(&format!(
                        "ETAPA sonda: aviso — el registro nuevo no se pudo sellar en la bóveda ({}); se usa en memoria pa esta cadena",
                        e
                    )),
                }
                *pairing_bytes = xml.into_bytes();
                match parse_pair_record(pairing_bytes) {
                    Ok(nueva) => {
                        rec_actual = nueva;
                        stage("ETAPA sonda: reintentando el StartService con el registro recién nacido…");
                        let i3 = intento_en_transporte_nuevo(fd, &rec_actual)?;
                        if let Some(puerto) = i3.port {
                            let via = if i3.abrio_con_escrow {
                                "3 (pairing nuevo + su EscrowBag)"
                            } else {
                                "3 (pairing nuevo)"
                            };
                            stage(&format!(
                                "ETAPA sonda: servicio de instalación ABIERTO por la vía {} — puerto {}",
                                via, puerto
                            ));
                            return Ok(GateOk {
                                via: via.to_string(),
                                escrow_necesario: i3.abrio_con_escrow,
                                puerto,
                            });
                        }
                        fallos.push((
                            "vía 3 (pairing nuevo)".to_string(),
                            i3.error_directa
                                .clone()
                                .or_else(|| i3.fallo_transporte.clone())
                                .unwrap_or_else(|| "sin respuesta".to_string()),
                        ));
                        if i3.escrow_corrio {
                            fallos.push((
                                "vía 3 (su EscrowBag)".to_string(),
                                i3.error_escrow
                                    .clone()
                                    .unwrap_or_else(|| "sin respuesta".to_string()),
                            ));
                        }
                    }
                    Err(e) => {
                        fallos.push((
                            "vía 3 (pairing nuevo)".to_string(),
                            format!("el registro recién nacido no se pudo interpretar: {}", e),
                        ));
                    }
                }
            }
            Err((etapa, msg)) => {
                stage(&format!(
                    "ETAPA sonda: el re-emparejamiento falló en la etapa «{}»: {}",
                    etapa, msg
                ));
                fallos.push((
                    "vía 3 (pairing nuevo)".to_string(),
                    format!("re-emparejamiento fallido en «{}»: {}", etapa, msg),
                ));
            }
        }
    }

    // ── Vía 4: conexión nueva, secuencia completa, registro vigente ────────
    stage(
        "ETAPA sonda: última vía — secuencia completa (StartSession + StartService) sobre transporte, mux y conexión lockdown recién abiertos…",
    );
    let i4 = intento_en_transporte_nuevo(fd, &rec_actual)?;
    if let Some(puerto) = i4.port {
        let via = if i4.abrio_con_escrow {
            "4 (conexión nueva + EscrowBag)"
        } else {
            "4 (conexión nueva)"
        };
        stage(&format!(
            "ETAPA sonda: servicio de instalación ABIERTO por la vía {} — puerto {}",
            via, puerto
        ));
        return Ok(GateOk {
            via: via.to_string(),
            escrow_necesario: i4.abrio_con_escrow,
            puerto,
        });
    }
    fallos.push((
        "vía 4 (conexión nueva)".to_string(),
        i4.error_directa
            .clone()
            .or_else(|| i4.fallo_transporte.clone())
            .unwrap_or_else(|| "sin respuesta".to_string()),
    ));
    if i4.escrow_corrio {
        fallos.push((
            "vía 4 (su EscrowBag)".to_string(),
            i4.error_escrow
                .clone()
                .unwrap_or_else(|| "sin respuesta".to_string()),
        ));
    }

    let detalle = fallos
        .iter()
        .map(|(via, e)| format!("{}: {}", via, e))
        .collect::<Vec<_>>()
        .join(" · ");
    Err(err(
        "sonda",
        format!(
            "el iPhone se negó a abrir el servicio de instalación en todas las vías. Lo que dijo Apple en cada una — {}. El registro de etapas trae las respuestas crudas completas: compártelo con Máximo.",
            detalle
        ),
    ))
}

// ── Réplica del crate (v2.3): la secuencia EXACTA de idevice, registrada ────

fn dict_xml(d: plist::Dictionary) -> String {
    let value = plist::Value::Dictionary(d);
    let mut buf: Vec<u8> = Vec::new();
    match value.to_writer_xml(&mut buf) {
        Ok(()) => String::from_utf8_lossy(&buf).to_string(),
        Err(_) => String::new(),
    }
}

/// **El discriminador de la hipótesis H2 del diagnóstico, como diagnóstico
/// permanente:** tras pasar la puerta, repite en una conexión nueva la
/// secuencia EXACTA que `idevice` corre dentro de la cadena — GetValue en
/// claro SIN QueryType previo, StartSession con el Label del provider, y un
/// StartService `{Request, Service}` SIN Label y SIN EscrowBag — y registra
/// la respuesta cruda. Si la réplica abre, la forma del crate es inocente y
/// el fallo vive en otra capa (el hub); si se niega, su `Error` dice cuál
/// pieza de la forma pesa. Nunca devuelve error: es un diagnóstico.
fn replica_crate(fd: i32, rec: &PairRecordInfo) {
    stage("ETAPA sonda: réplica del crate — pruebo su secuencia exacta (sin QueryType · StartService sin Label y sin escrow) en conexión nueva pa discriminar la causa de su negativa…");
    let mut transport = match crate::pair::open_mux_transport(fd, "") {
        Ok(t) => t,
        Err((etapa, msg)) => {
            stage(&format!(
                "ETAPA sonda: la réplica no pudo abrir transporte («{}»: {}) — queda sin correr",
                etapa, msg
            ));
            return;
        }
    };
    let eps = transport.endpoints();
    let mut pipe = match MuxPipe::connect(&mut transport, eps, LOCKDOWND_PORT) {
        Ok(p) => p,
        Err(e) => {
            stage(&format!(
                "ETAPA sonda: la réplica no pudo abrir la sesión mux ({}) — queda sin correr",
                e
            ));
            return;
        }
    };

    // GetValue en claro, sin QueryType antes (así entra el crate).
    let mut gv = plist::Dictionary::new();
    gv.insert(
        "Label".into(),
        plist::Value::String("anfitrion-maximo".into()),
    );
    gv.insert("Request".into(), plist::Value::String("GetValue".into()));
    gv.insert(
        "Key".into(),
        plist::Value::String("ProductVersion".into()),
    );
    match pipe.request(&dict_xml(gv)) {
        Ok(r) => stage(&format!(
            "ETAPA sonda: réplica — respuesta GetValue cruda: {}",
            resumen_crudo(&r)
        )),
        Err(e) => {
            stage(&format!(
                "ETAPA sonda: la réplica murió en el GetValue ({}) — la forma ni siquiera llegó a hablar",
                e
            ));
            return;
        }
    }

    // StartSession con el Label del provider, como el crate.
    let mut ss = plist::Dictionary::new();
    ss.insert(
        "Label".into(),
        plist::Value::String("anfitrion-maximo".into()),
    );
    ss.insert(
        "Request".into(),
        plist::Value::String("StartSession".into()),
    );
    ss.insert("HostID".into(), plist::Value::String(rec.host_id.clone()));
    ss.insert(
        "SystemBUID".into(),
        plist::Value::String(rec.system_buid.clone()),
    );
    let ss_resp = match pipe.request(&dict_xml(ss)) {
        Ok(r) => r,
        Err(e) => {
            stage(&format!(
                "ETAPA sonda: la réplica murió en su StartSession ({})",
                e
            ));
            return;
        }
    };
    stage(&format!(
        "ETAPA sonda: réplica — respuesta StartSession cruda: {}",
        resumen_crudo(&ss_resp)
    ));
    if let Some(e) = parse_lockdown_error_string(&ss_resp) {
        stage(&format!(
            "ETAPA sonda: réplica — Apple dijo «{}» en el StartSession del crate: su sesión ni abre por esta vía",
            e
        ));
        return;
    }
    let con_ssl = start_session_enable_ssl(&ss_resp);

    // StartService SIN Label y SIN EscrowBag: el dict pelado del crate.
    let mut sv = plist::Dictionary::new();
    sv.insert(
        "Request".into(),
        plist::Value::String("StartService".into()),
    );
    sv.insert(
        "Service".into(),
        plist::Value::String(SERVICE_INSTALL.into()),
    );
    match pedir_servicio(&mut pipe, rec, con_ssl, &dict_xml(sv)) {
        Ok(resp) => {
            stage(&format!(
                "ETAPA sonda: réplica — respuesta StartService cruda: {}",
                resumen_crudo(&resp)
            ));
            if let Ok((port, _)) = parse_start_service_response(&resp) {
                stage(&format!(
                    "ETAPA sonda: réplica — el crate SÍ abriría por su forma (puerto {}): la forma de su petición es INOCENTE; su negativa en la cadena vive en otra capa (el hub o la sesión reutilizada)",
                    port
                ));
            } else {
                let e = parse_lockdown_error_string(&resp)
                    .unwrap_or_else(|| "respuesta sin Port y sin clave Error".to_string());
                stage(&format!(
                    "ETAPA sonda: réplica — el crate se niega con «{}» ({}) usando SOLO su forma: queda discriminado en vivo",
                    e,
                    interpretacion(clase_error(&e))
                ));
            }
        }
        Err(e) => {
            stage(&format!(
                "ETAPA sonda: la réplica murió en transporte pidiendo el servicio ({})",
                e
            ));
        }
    }
}

// ── Bancos ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn registro_de_banco() -> Vec<u8> {
        // Registro formato libimobiledevice con valores de banco (PEM falsos
        // pero bien formados como texto; el parseo no valida criptografía).
        let mut dict = plist::Dictionary::new();
        let pem = |d: &mut plist::Dictionary, k: &str, v: &str| {
            d.insert(k.into(), plist::Value::Data(v.as_bytes().to_vec()));
        };
        pem(&mut dict, "DeviceCertificate", "-----BEGIN CERTIFICATE-----\nDEV\n-----END CERTIFICATE-----\n");
        pem(&mut dict, "HostCertificate", "-----BEGIN CERTIFICATE-----\nHOST\n-----END CERTIFICATE-----\n");
        pem(&mut dict, "HostPrivateKey", "-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----\n");
        pem(&mut dict, "RootCertificate", "-----BEGIN CERTIFICATE-----\nROOT\n-----END CERTIFICATE-----\n");
        dict.insert("HostID".into(), plist::Value::String("HOST-123".into()));
        dict.insert(
            "SystemBUID".into(),
            plist::Value::String("BUID-456".into()),
        );
        dict.insert(
            "EscrowBag".into(),
            plist::Value::Data(vec![1, 2, 3, 4]),
        );
        let value = plist::Value::Dictionary(dict);
        let mut buf = Vec::new();
        value.to_writer_xml(&mut buf).unwrap();
        buf
    }

    #[test]
    fn parse_registro_completo() {
        let rec = parse_pair_record(&registro_de_banco()).unwrap();
        assert_eq!(rec.host_id, "HOST-123");
        assert_eq!(rec.system_buid, "BUID-456");
        assert_eq!(rec.escrow_bag.as_deref(), Some(&[1u8, 2, 3, 4][..]));
        assert!(rec.host_cert_pem.contains("HOST"));
        assert!(rec.host_key_pem.contains("KEY"));
        assert!(rec.root_cert_pem.contains("ROOT"));
        assert!(rec.device_cert_pem.contains("DEV"));
    }

    #[test]
    fn parse_registro_sin_escrow() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>DeviceCertificate</key><data>LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCg==</data>
<key>HostCertificate</key><data>LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCg==</data>
<key>HostPrivateKey</key><data>LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCg==</data>
<key>RootCertificate</key><data>LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCg==</data>
<key>HostID</key><string>H</string>
<key>SystemBUID</key><string>B</string>
</dict></plist>"#;
        let rec = parse_pair_record(xml).unwrap();
        assert!(rec.escrow_bag.is_none());
        assert_eq!(rec.host_id, "H");
    }

    #[test]
    fn escrow_xml_lleva_la_bolsa_y_parsea() {
        let xml = start_service_escrow_xml(SERVICE_INSTALL, &[9, 8, 7]);
        let value: plist::Value = plist::from_bytes(xml.as_bytes()).unwrap();
        let dict = value.as_dictionary().unwrap();
        assert_eq!(
            dict.get("Request").unwrap().as_string().unwrap(),
            "StartService"
        );
        assert_eq!(
            dict.get("Service").unwrap().as_string().unwrap(),
            SERVICE_INSTALL
        );
        assert_eq!(
            dict.get("EscrowBag").unwrap().as_data().unwrap().to_vec(),
            vec![9u8, 8, 7]
        );
    }

    #[test]
    fn clases_de_error() {
        assert_eq!(clase_error("PasswordProtected"), ClaseError::Bloqueo);
        assert_eq!(clase_error("SessionInactive"), ClaseError::Sesion);
        assert_eq!(clase_error("InvalidPairRecord"), ClaseError::Registro);
        assert_eq!(clase_error("InvalidService"), ClaseError::Servicio);
        assert_eq!(clase_error("AlgoRaro"), ClaseError::Otro);
    }

    #[test]
    fn stop_session_xml_lleva_la_sesion() {
        let xml = stop_session_xml("SESION-42");
        let value: plist::Value = plist::from_bytes(xml.as_bytes()).unwrap();
        let dict = value.as_dictionary().unwrap();
        assert_eq!(
            dict.get("Request").unwrap().as_string().unwrap(),
            "StopSession"
        );
        assert_eq!(
            dict.get("SessionID").unwrap().as_string().unwrap(),
            "SESION-42"
        );
    }

    #[test]
    fn session_id_se_extrae_de_la_respuesta() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>EnableSessionSSL</key><true/>
<key>SessionID</key><string>ABC-123</string>
</dict></plist>"#;
        assert_eq!(session_id_de(xml).as_deref(), Some("ABC-123"));
        assert_eq!(session_id_de("<plist></plist>"), None);
    }

    #[test]
    fn resumen_crudo_aplana_y_acota() {
        let xml = "<dict>\n\t<key>Error</key>\n\t<string>X</string>\n</dict>";
        let r = resumen_crudo(xml);
        assert!(!r.contains('\n'));
        assert!(r.contains("<string>X</string>"));
        let largo = "x".repeat(4000);
        assert!(resumen_crudo(&largo).chars().count() < 1600);
    }

    // ── Bancos v2.8.2: validación del pairing con contexto ─────────────────

    /// Registro a medida pa los bancos: HostID y EscrowBag variables, y
    /// un PEM concreto vaciable (None = todos con contenido).
    fn registro_a_medida(host_id: &str, escrow: bool, pem_vacio: Option<&str>) -> Vec<u8> {
        let mut dict = plist::Dictionary::new();
        let pem = |d: &mut plist::Dictionary, k: &str, v: &str| {
            d.insert(k.into(), plist::Value::Data(v.as_bytes().to_vec()));
        };
        let valor = |k: &str| -> &str {
            if pem_vacio == Some(k) {
                ""
            } else {
                "-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n"
            }
        };
        pem(&mut dict, "DeviceCertificate", valor("DeviceCertificate"));
        pem(&mut dict, "HostCertificate", valor("HostCertificate"));
        pem(
            &mut dict,
            "HostPrivateKey",
            if pem_vacio == Some("HostPrivateKey") {
                ""
            } else {
                "-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----\n"
            },
        );
        pem(&mut dict, "RootCertificate", valor("RootCertificate"));
        dict.insert("HostID".into(), plist::Value::String(host_id.into()));
        dict.insert("SystemBUID".into(), plist::Value::String("BUID-456".into()));
        if escrow {
            dict.insert("EscrowBag".into(), plist::Value::Data(vec![1, 2, 3, 4]));
        }
        let value = plist::Value::Dictionary(dict);
        let mut buf = Vec::new();
        value.to_writer_xml(&mut buf).unwrap();
        buf
    }

    /// (a) Plist malformado que contiene literalmente `<plist` y `HostID`:
    /// la validación lo rechaza (nada de buscar texto como criterio).
    #[test]
    fn banco_a_malformado_no_valida() {
        let mal = b"basura <plist <key>HostID</key> no es un plist";
        let err = validate_pair_record(mal, PairingOrigin::Import).unwrap_err();
        assert!(err.contains("plist"), "error inesperado: {}", err);
    }

    /// (b) Plist válido con EscrowBag: la importación lo acepta.
    #[test]
    fn banco_b_valido_con_escrow_importa() {
        validate_pair_record(&registro_de_banco(), PairingOrigin::Import).unwrap();
        validate_pair_record(&registro_de_banco(), PairingOrigin::Migration).unwrap();
    }

    /// (c) Importación externa sin EscrowBag: rechazo.
    #[test]
    fn banco_c_import_sin_escrow_rechaza() {
        let sin = registro_a_medida("HOST-123", false, None);
        let err = validate_pair_record(&sin, PairingOrigin::Import).unwrap_err();
        assert!(err.contains("EscrowBag"), "error inesperado: {}", err);
        let err = validate_pair_record(&sin, PairingOrigin::Migration).unwrap_err();
        assert!(err.contains("EscrowBag"), "error inesperado: {}", err);
    }

    /// (d) Pair recién generado sin EscrowBag, con campos y 4 PEM válidos:
    /// se acepta (el EscrowBag es opcional en esa ruta y en el rescate).
    #[test]
    fn banco_d_fresco_sin_escrow_acepta() {
        let sin = registro_a_medida("HOST-123", false, None);
        validate_pair_record(&sin, PairingOrigin::FreshPair).unwrap();
        validate_pair_record(&sin, PairingOrigin::Repair).unwrap();
    }

    /// (e) Pair recién generado con algún campo o PEM vacío: rechazo.
    #[test]
    fn banco_e_fresco_campo_vacio_rechaza() {
        let vacio_host = registro_a_medida("", true, None);
        let err = validate_pair_record(&vacio_host, PairingOrigin::FreshPair).unwrap_err();
        assert!(err.contains("HostID"), "error inesperado: {}", err);
        let vacio_pem = registro_a_medida("HOST-123", true, Some("HostPrivateKey"));
        let err = validate_pair_record(&vacio_pem, PairingOrigin::FreshPair).unwrap_err();
        assert!(err.contains("HostPrivateKey"), "error inesperado: {}", err);
    }
}

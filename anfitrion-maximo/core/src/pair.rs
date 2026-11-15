//! Driver del pairing con **registro de etapas obligatorio**: cada paso queda escrito
//! (pantalla + log exportable vía `crate::stage`) pa que un fallo diga exactamente
//! en qué etapa muere en el hardware concreto.
//!
//! Flujo (espejo del CLI/WASM de idevice-rs): llaves → descriptores → configuración →
//! claim → mux → QueryType → Pair (con espera de Confiar) → registro → verificación.

use std::thread;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose, Engine as _};
use idevice_usb_core::lockdown_proto::{
    get_value_xml, pair_plist, parse_escrow_bag, parse_get_value_string,
    parse_lockdown_error_string, start_session_xml, GET_DEVICE_PUBLIC_KEY_XML,
    LOCKDOWND_PORT, QUERY_TYPE_XML,
};
use idevice_usb_core::PairingIds;

use crate::crypto::{build_device_certificate, generate_host_keys};
use crate::mux::MuxPipe;
use crate::record::build_pair_record_xml;
use crate::stage;
use crate::transport::FdTransport;

const TRUST_TIMEOUT_SECS: u64 = 150;
const TRUST_POLL_SECS: u64 = 4;

type StageErr = (String, String);

fn err(stage: &str, msg: impl Into<String>) -> StageErr {
    (stage.to_string(), msg.into())
}

/// Ejecuta el pairing completo. Devuelve el XML del registro listo pa guardar.
/// `fd` es el descriptor de Android (no se cierra aquí).
pub fn run_pair(fd: i32, serial_hint: &str) -> Result<String, StageErr> {
    // ── Etapa: llaves ─────────────────────────────────────────────────────────
    stage("ETAPA claves: generando la cadena RSA-2048 del anfitrión (raíz + host)…");
    let keys = generate_host_keys().map_err(|e| err("claves", e))?;
    stage("ETAPA claves: OK");

    let mut transport = open_mux_transport(fd, serial_hint)?;

    // ── Etapa: mux ────────────────────────────────────────────────────────────
    stage("ETAPA mux: abriendo la sesión mux (VERSION/SETUP) y la pseudo-TCP a lockdownd (62078)…");
    let eps = transport.endpoints();
    let mut pipe = MuxPipe::connect(&mut transport, eps, LOCKDOWND_PORT)
        .map_err(|e| err("mux", e))?;
    stage(&format!(
        "ETAPA mux: OK (versión de mux {})",
        pipe.mux_version
    ));

    // ── Etapa: lockdown / QueryType ───────────────────────────────────────────
    stage("ETAPA lockdown: QueryType…");
    let qt = pipe
        .request(QUERY_TYPE_XML)
        .map_err(|e| err("lockdown", e))?;
    if !qt.contains("com.apple.mobile.lockdown") {
        return Err(err(
            "lockdown",
            format!("QueryType no devolvió lockdownd: {}", trunc(&qt, 200)),
        ));
    }
    stage("ETAPA lockdown: lockdownd responde (com.apple.mobile.lockdown)");

    // ── Etapa: petición Pair ──────────────────────────────────────────────────
    stage("ETAPA pair: pidiendo la llave pública del iPhone (GetValue DevicePublicKey)…");
    let mut wifi_mac: Option<String> = None;
    for key in ["WiFiAddress", "BluetoothAddress"] {
        if let Ok(xml) = pipe.request(&get_value_xml("", key)) {
            if let Some(s) = parse_get_value_string(&xml) {
                let t = s.trim();
                if !t.is_empty() {
                    wifi_mac = Some(t.to_string());
                    break;
                }
            }
        }
    }
    if let Some(mac) = &wifi_mac {
        stage(&format!("ETAPA pair: WiFiMACAddress del iPhone: {}", mac));
    }
    let pubkey_res = pipe
        .request(GET_DEVICE_PUBLIC_KEY_XML)
        .map_err(|e| err("pair", format!("GetDevicePublicKey: {}", e)))?;
    let device_pub_pem = extract_data_pem(&pubkey_res)
        .map_err(|e| err("pair", e))?;
    let device_cert_pem = build_device_certificate(&device_pub_pem, &keys)
        .map_err(|e| err("pair", format!("certificado del dispositivo: {}", e)))?;
    let ids = PairingIds::new_v4();
    let pair_xml = pair_plist(
        "anfitrion-maximo",
        &ids.host_id,
        &ids.system_buid,
        None,
        &device_cert_pem,
        &keys.host_cert_pem,
        &keys.root_cert_pem,
        &keys.root_private_pem,
    );
    stage(&format!(
        "ETAPA pair: petición Pair construida (HostID {}, {} bytes)",
        ids.host_id,
        pair_xml.len()
    ));

    // ── Etapa: espera de Confiar ──────────────────────────────────────────────
    stage("ETAPA confiar: enviando Pair — mira el iPhone AHORA: desbloquéalo, toca «Confiar» y mete tu código…");
    let mut reply = pipe
        .request(&pair_xml)
        .map_err(|e| err("confiar", format!("Pair: {}", e)))?;
    let deadline = Instant::now() + Duration::from_secs(TRUST_TIMEOUT_SECS);
    let mut announced = false;
    loop {
        let pending = reply.contains("PairingDialogResponsePending")
            || reply.contains("PasswordProtected");
        if !pending {
            break;
        }
        if Instant::now() >= deadline {
            return Err(err(
                "confiar",
                format!(
                    "Se agotaron {} s esperando el «Confiar» en el iPhone. Desbloquéalo, acepta el aviso y reintenta.",
                    TRUST_TIMEOUT_SECS
                ),
            ));
        }
        if !announced {
            stage(&format!(
                "ETAPA confiar: el iPhone está esperando tu toque (quedan {} s)…",
                TRUST_TIMEOUT_SECS
            ));
            announced = true;
        }
        thread::sleep(Duration::from_secs(TRUST_POLL_SECS));
        reply = pipe
            .request(&pair_xml)
            .map_err(|e| err("confiar", format!("Pair (reintento): {}", e)))?;
    }
    if reply.contains("<key>Error</key>") {
        let detail = parse_lockdown_error_string(&reply)
            .unwrap_or_else(|| trunc(&reply, 220));
        return Err(err(
            "confiar",
            format!("lockdownd rechazó el Pair: {}", detail),
        ));
    }
    stage("ETAPA confiar: Pair aceptado por el iPhone");
    let escrow_bag = parse_escrow_bag(&reply);
    match &escrow_bag {
        Some(b) => stage(&format!("ETAPA confiar: EscrowBag recibido ({} bytes)", b.len())),
        None => stage("ETAPA confiar: aviso — la respuesta no trajo EscrowBag (algunas versiones de iOS no lo envían)"),
    }

    // ── Etapa: registro ───────────────────────────────────────────────────────
    let xml_out = build_pair_record_xml(
        &keys,
        &ids,
        &device_cert_pem,
        wifi_mac.as_deref(),
        escrow_bag.as_deref(),
    )
    .map_err(|e| err("registro", e))?;
    stage(&format!(
        "ETAPA registro: registro de pairing construido ({} bytes)",
        xml_out.len()
    ));

    // ── Etapa: verificación (informativa, nunca fatal) ────────────────────────
    match verify_start_session(&mut pipe, &ids) {
        Ok(()) => stage(
            "ETAPA verificacion: StartSession aceptó el registro nuevo (EnableSessionSSL) — el pairing es real",
        ),
        Err(e) => stage(&format!(
            "ETAPA verificacion: no se pudo confirmar con StartSession: {} — el registro ya está guardado; la prueba final es importarlo en Tienda Máximo",
            e
        )),
    }

    Ok(xml_out)
}

/// Reabre la pseudo-TCP y prueba `StartSession` con los IDs recién emparejados.
fn verify_start_session(pipe: &mut MuxPipe, ids: &PairingIds) -> Result<(), String> {
    pipe.connect_additional(LOCKDOWND_PORT)?;
    let qt = pipe.request(QUERY_TYPE_XML)?;
    if !qt.contains("com.apple.mobile.lockdown") {
        return Err("QueryType inesperado tras reabrir".into());
    }
    let sess = pipe.request(&start_session_xml(&ids.host_id, &ids.system_buid))?;
    if sess.contains("<key>Error</key>") {
        let detail = parse_lockdown_error_string(&sess).unwrap_or_else(|| trunc(&sess, 200));
        return Err(format!("StartSession: {}", detail));
    }
    if sess.contains("EnableSessionSSL") {
        Ok(())
    } else {
        Err("StartSession sin EnableSessionSSL".into())
    }
}

fn extract_data_pem(xml: &str) -> Result<String, String> {
    let start = xml.find("<data>").ok_or("GetDevicePublicKey: sin <data>")? + 6;
    let end = xml.find("</data>").ok_or("GetDevicePublicKey: sin </data>")?;
    let b64: String = xml[start..end]
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    let decoded = general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|e| format!("GetDevicePublicKey base64: {}", e))?;
    String::from_utf8(decoded).map_err(|e| format!("GetDevicePublicKey utf8: {}", e))
}

fn trunc(s: &str, n: usize) -> String {
    let flat: String = s.chars().filter(|c| *c != '\n').take(n).collect();
    flat
}


/// Preparación del transporte compartida por el pairing y por la cadena de
/// firma/instalación de la fase 2: descriptores → SET_CONFIGURATION → claim,
/// con las mismas etapas escritas. Devuelve el transporte listo pa el mux.
pub(crate) fn open_mux_transport(fd: i32, serial_hint: &str) -> Result<FdTransport, StageErr> {
    // ── Etapa: descriptores ───────────────────────────────────────────────────
    stage("ETAPA descriptores: leyendo los descriptores USB del iPhone por el fd…");
    // Target provisional; scan_mux_target lo sustituye por el real.
    let provisional = crate::transport::MuxTarget {
        config_value: 0,
        interface: 0,
        alt_setting: 0,
        ep_in_addr: 0x81,
        ep_out_addr: 0x01,
    };
    let mut transport = FdTransport::new(fd, provisional);
    let target = transport
        .scan_mux_target()
        .map_err(|e| err("descriptores", e))?;
    transport.target = target;
    stage(&format!(
        "ETAPA descriptores: interfaz mux en configuración {}, interfaz {}, alt {}, bulk OUT 0x{:02X} / IN 0x{:02X}",
        target.config_value, target.interface, target.alt_setting, target.ep_out_addr, target.ep_in_addr
    ));
    if !serial_hint.is_empty() {
        // Android puede devolver la serie con cola corrupta (caracteres de
        // reemplazo tras el UDID): se imprime solo la parte limpia.
        let limpia: String = serial_hint
            .chars()
            .take_while(|c| !c.is_control() && *c != '\u{fffd}')
            .collect();
        stage(&format!(
            "ETAPA descriptores: serie USB reportada por Android: {}",
            limpia.trim()
        ));
    }

    // ── Etapa: configuración (EL paso de riesgo nº 1) ─────────────────────────
    let active = transport
        .active_configuration()
        .map_err(|e| err("configuracion", format!("GET_CONFIGURATION: {}", e)))?;
    stage(&format!(
        "ETAPA configuracion: configuración activa = {}, objetivo = {}",
        active, target.config_value
    ));
    // SET_CONFIGURATION SIEMPRE, aunque la activa ya sea la del mux (v1.1, paridad
    // con la demo WebUSB de upstream: `prepare_apple_usb` selecciona la
    // configuración en CADA apertura). Fijarla reinicia la sesión mux del iPhone
    // y vacía cualquier frame resto de una sesión anterior encolado en el extremo
    // IN. La v1 se saltaba este paso si la activa ya era la del mux — y en la
    // corrida viva del 2026-11-15 la 3 ya estaba activa: la sesión heredada le
    // costó el saludo mux («got protocol 6»), mientras la página WebUSB, que sí
    // fija la configuración, emparejó contra el mismo iPhone minutos después.
    stage(&format!(
        "ETAPA configuracion: fijando SET_CONFIGURATION({}) (la activa es {}) — reinicia la sesión mux del iPhone…",
        target.config_value, active
    ));
    match transport.set_configuration(target.config_value) {
        Ok(()) => stage("ETAPA configuracion: SET_CONFIGURATION OK"),
        Err(e) => {
            return Err(err(
                "configuracion",
                format!(
                    "SET_CONFIGURATION({}) falló: {}. Sin fijar la configuración no se puede garantizar una sesión mux limpia.",
                    target.config_value, e
                ),
            ));
        }
    }

    // ── Etapa: claim ──────────────────────────────────────────────────────────
    stage(&format!(
        "ETAPA claim: reclamando la interfaz {}…",
        target.interface
    ));
    transport
        .claim_interface()
        .map_err(|e| err("claim", format!("CLAIMINTERFACE: {}", e)))?;
    stage("ETAPA claim: OK");
    match transport.clear_halts() {
        Ok(()) => stage("ETAPA claim: clearHalt en ambos extremos OK"),
        Err(e) => stage(&format!(
            "ETAPA claim: aviso — clearHalt devolvió: {} (se continúa)",
            e
        )),
    }
    match transport.set_interface_alt() {
        Ok(()) => stage("ETAPA claim: ajuste alternativo fijado OK"),
        Err(e) => stage(&format!(
            "ETAPA claim: aviso — SETINTERFACE devolvió: {} (se continúa)",
            e
        )),
    }

    Ok(transport)
}

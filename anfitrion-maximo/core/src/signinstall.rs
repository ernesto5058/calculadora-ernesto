//! La cadena de la fase 2: **Firmar e instalar**.
//!
//! Dos rutas sobre el MISMO cable y el MISMO proveedor:
//! - **Con conexión** (una vez por app): anisette remoto v3 → login GrandSlam
//!   con 2FA → sesión de desarrollador → `Sideloader::install_app` (la pila
//!   probada de InstaladorPRO) → **cosecha** a la bóveda (equipo, certificado
//!   y perfil de la app) pa que la próxima vez no haga falta red.
//! - **Sin conexión** (la vía offline): con el certificado, el equipo y el
//!   perfil de la bóveda se reconstruye la firma en local (`sign()`) y se
//!   instala por AFC/InstallationProxy (`servicio::instalar_con_escrow`),
//!   cero red.
//!
//! **v2.3:** TODOS los servicios de la cadena se abren a mano con el
//! EscrowBag del registro presentado (`servicio::abrir_servicio`): el
//! diagnóstico probó que el `connect` del crate pedía el StartService sin
//! escrow y descartaba la respuesta cruda de Apple — la muerte de la v2.2.
//!
//! **v2.4:** la cadena ya NO viaja sobre la sesión mux del hub. Probado en
//! vivo el 2026-11-16 (2/2): pasada la puerta por la vía 1, abrir
//! InstallationProxy sobre la sesión reutilizada del hub moría al instante
//! (`CONTROL del iPhone: socketIsClosed … errno 54` → tls handshake eof) —
//! el hub arrastra estado mux sucio entre sesiones. Ahora el hub solo
//! detecta (saluda), **purga** su estado y se cierra, y la cadena abre su
//! propia sesión mux FRESCA con la secuencia de la vía 1 (`cadena.rs`):
//! conexión mux nueva + LockdownClient nuevo + StartSession propio por
//! servicio, el camino que la puerta ya probó que funciona (puertos
//! 60057/60090 por la vía 1; 60059/60092 por la réplica del crate).
//!
//! La contraseña llega de Kotlin, vive solo en esta llamada y se suelta al
//! abrir la sesión; jamás se guarda ni se escribe en el registro. El código
//! 2FA lo pide el callback de isideload a Kotlin por JNI (bloqueante: la UI
//! lo recoge en la misma pantalla y lo entrega por un latch).
//!
//! v2.5: la causa raíz de la muerte de la cadena NO era el transporte —
//! era «el StartSession que nunca se envió» (ver `servicio.rs`):
//! `abrir_servicio` saltaba del GetValue al TLS de
//! `Idevice::start_session`, que es solo el túnel y no negocia sesión
//! alguna. La negociación completa (GetValue → StartSession → TLS →
//! StartService) vive ahora en `servicio::negociar_sesion` +
//! `abrir_servicio`, con un banco que fija el orden. El transporte de la
//! v2.4 (sesión mux propia de la cadena, hub solo detección) se queda:
//! inocuo y ordenado.
//!
//! **v2.6 — EL SUPERVISOR USB** (módulo `supervisor`): la corrida viva de
//! la v2.5 probó la negociación y murió a los ~2,6 s con `bulk OUT: No
//! such device (os error 19)` — el iPhone se cayó del bus a mitad de
//! escritura y la IPA no quedó instalada. Desde la v2.6, la preparación
//! de la cadena, la sonda del canal y la instalación corren bajo el
//! supervisor: ante una desconexión (ENODEV) registra el intento, espera
//! 1,5 s, RE-PREPARA el transporte desde cero con `preparar_proveedor`
//! (la misma preparación inicial: hub que detecta y suelta + transporte
//! fresco + sesión mux fresca) y reintenta el paso — máximo 3 intentos
//! por paso; agotados, la cadena falla con el registro completo de
//! intentos. Cualquier otro error sigue su camino sin reintentar.

use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use idevice::house_arrest::HouseArrestClient;
use idevice::installation_proxy::InstallationProxyClient;
use idevice::provider::IdeviceProvider;
use idevice::IdeviceService;
use isideload::{
    anisette::{remote_v3::RemoteV3AnisetteProvider, AnisetteClientInfo},
    auth::apple_account::{AppleAccount, TwoFactorCallbackResponse},
    dev::{
        app_ids::{AppIdsApi, Profile},
        developer_session::{DeveloperSession, DevicesApi},
        teams::DeveloperTeam,
    },
    sideload::{
        application::Application,
        builder::{
            ExtensionsBehavior, ExtensionsBehaviorSelection, MaxCertsBehavior,
            SideloaderBuilder, TeamSelection,
        },
        cert_identity::CertificateIdentity,
        sign::sign,
    },
};
use rootcause::prelude::*;
use rsa::pkcs8::{DecodePrivateKey, EncodePrivateKey};
use x509_cert::{
    der::{Decode, Encode},
    Certificate,
};

use crate::cadena::spawn_cadena;
use crate::hub::spawn_hub;
use crate::provider::AnfitrionProvider;
use crate::stage;
use crate::vault::{VaultHandle, VaultStorageRef, KEY_CERT, KEY_EQUIPO};

pub const MACHINE_NAME: &str = "AnfitrionMaximo";
pub const BUNDLE_TIENDA: &str = "com.maximo.tienda";

type StageErr = (String, String);

fn err(stage: &str, msg: impl Into<String>) -> StageErr {
    (stage.to_string(), msg.into())
}

fn now_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// El proveedor criptográfico de rustls se instala UNA vez por proceso
/// (sin esto, reqwest entra en pánico al construir su cliente).
pub fn ensure_crypto_provider() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

// ── Puente 2FA (JNI → Kotlin) ─────────────────────────────────────────────────

struct TfaSink {
    vm_ptr: Option<usize>,
    target: Option<jni::objects::GlobalRef>,
}

static TFA_SINK: OnceLock<Mutex<TfaSink>> = OnceLock::new();

fn tfa_sink() -> &'static Mutex<TfaSink> {
    TFA_SINK.get_or_init(|| {
        Mutex::new(TfaSink {
            vm_ptr: None,
            target: None,
        })
    })
}

/// Registra el objeto Kotlin que sabe pedir el código (su `requestTfaCode()`
/// bloquea hasta que Ernesto lo teclea en la misma pantalla).
pub fn register_tfa_bridge(env: &mut jni::JNIEnv, bridge: &jni::objects::JObject) {
    let vm_ptr = env
        .get_java_vm()
        .ok()
        .map(|vm| vm.get_java_vm_pointer() as usize);
    let target = env.new_global_ref(bridge).ok();
    let mut s = tfa_sink().lock().unwrap_or_else(|p| p.into_inner());
    s.vm_ptr = vm_ptr;
    s.target = target;
}

/// Pide el código 2FA a la cara (bloqueante). `None` = Ernesto canceló.
fn pedir_codigo_2fa() -> Option<String> {
    let (vm_ptr, target) = {
        let s = tfa_sink().lock().unwrap_or_else(|p| p.into_inner());
        (s.vm_ptr, s.target.clone())
    };
    let (Some(ptr), Some(target)) = (vm_ptr, target) else {
        return None;
    };
    let vm = unsafe { jni::JavaVM::from_raw(ptr as *mut jni::sys::JavaVM) }.ok()?;
    let mut env = vm.attach_current_thread().ok()?;
    let res = env.call_method(&target, "requestTfaCode", "()Ljava/lang/String;", &[]);
    if env.exception_check().unwrap_or(false) {
        let _ = env.exception_clear();
        return None;
    }
    let obj = res.ok()?.l().ok()?;
    if obj.is_null() {
        return None;
    }
    let jstr = jni::objects::JString::from(obj);
    let s: String = env.get_string(&jstr).ok()?.into();
    let s = s.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

// ── Consulta de la bóveda pa la cara ──────────────────────────────────────────

/// ¿La bóveda cubre esta app pa firmar SIN conexión? Devuelve JSON:
/// `{cubre, motivo, nombre, bundle_id, dias}` — la cara decide si enseña los
/// campos de login ANTES de arrancar la cadena (login solo si hace falta).
pub fn vault_covers(ipa_path: &str, vault: &VaultHandle) -> String {
    let out = (|| -> Result<serde_json::Value, String> {
        let app = Application::new(PathBuf::from(ipa_path))
            .map_err(|e| format!("no se pudo leer el IPA: {}", e))?;
        let bundle_id = app
            .main_bundle_id()
            .map_err(|e| format!("el IPA no trae bundle id: {}", e))?;
        let nombre = app.main_app_name().unwrap_or_else(|_| bundle_id.clone());
        let infos = vault.profile_infos(now_epoch());
        let info = infos.iter().find(|i| i.bundle_id == bundle_id);
        let (cubre, motivo, dias) = match info {
            None => (
                false,
                "esta app aún no está en la bóveda: necesita conexión una vez pa que Apple emita su perfil".to_string(),
                0,
            ),
            Some(i) if i.dias < 0 => (
                false,
                "el perfil guardado ya caducó: necesita conexión pa renovarlo".to_string(),
                i.dias,
            ),
            Some(i) => {
                if vault.get(KEY_CERT).is_none() || vault.get(KEY_EQUIPO).is_none() {
                    (
                        false,
                        "falta el certificado o el equipo en la bóveda: necesita conexión una vez".to_string(),
                        i.dias,
                    )
                } else {
                    (
                        true,
                        "la bóveda cubre esta app: se puede firmar e instalar sin conexión".to_string(),
                        i.dias,
                    )
                }
            }
        };
        Ok(serde_json::json!({
            "cubre": cubre, "motivo": motivo, "nombre": nombre,
            "bundle_id": bundle_id, "dias": dias,
        }))
    })();
    match out {
        Ok(v) => v.to_string(),
        Err(e) => serde_json::json!({"cubre": false, "motivo": e, "nombre": "", "bundle_id": "", "dias": 0}).to_string(),
    }
}

// ── La cadena ─────────────────────────────────────────────────────────────────

/// Punto de entrada síncrono (lo llama JNI en un hilo de trabajo).
/// `password` puede venir vacío cuando la bóveda cubre la app (ruta offline).
/// Prepara el proveedor de la cadena DESDE CERO (v2.4, y la
/// re-preparación del supervisor en la v2.6): el hub de detección saluda
/// al iPhone, purga el nacimiento y CIERRA soltando la interfaz; después,
/// un transporte fresco abre la sesión mux PROPIA de la cadena (saludo de
/// la vía 1 + purga). Es la preparación inicial de la corrida Y la que el
/// supervisor repite tras una desconexión: el mismo camino probado —
/// re-enumerar por el fd y el SET_CONFIGURATION que reinicia la sesión
/// mux del iPhone incluidos. Sobre la sesión nueva, cada servicio
/// re-negocia su StartSession como siempre (`servicio::abrir_servicio`).
fn preparar_proveedor(fd: i32, pairing_bytes: &[u8]) -> Result<AnfitrionProvider, StageErr> {
    stage("ETAPA conexion: preparando el cable (descriptores, configuración, claim)…");
    {
        // Detección/latido: el hub saluda (su línea de sesión abierta es la
        // prueba de que el cable y el mux viven tras la puerta)…
        let transport = crate::pair::open_mux_transport(fd, "")?;
        let eps = transport.endpoints();
        let hub = spawn_hub(transport, eps).map_err(|e| err("conexion", e))?;
        // …purga su estado (tras el SET_CONFIGURATION del pairing, ningún
        // frame ni ID de sesiones muertas queda con dueño)…
        hub.purge().map_err(|e| err("conexion", e))?;
        // …y se cierra soltando la interfaz ANTES de que la cadena abra la
        // suya: el hub nunca es transporte de la cadena.
        hub.shutdown().map_err(|e| err("conexion", e))?;
        stage("ETAPA conexion: hub de detección purgado y cerrado — la cadena NO viaja sobre el hub");
    }
    // La sesión de la cadena: transporte fresco (SET_CONFIGURATION que
    // reinicia la sesión mux del iPhone) + saludo de la vía 1 + purga del
    // resto del saludo. Todos los servicios de `run_chain` cuelgan de ella.
    let transport = crate::pair::open_mux_transport(fd, "")?;
    let eps = transport.endpoints();
    let cadena = spawn_cadena(transport, eps).map_err(|e| err("conexion", e))?;
    stage("ETAPA conexion: sesión mux FRESCA de la cadena abierta (la secuencia que la puerta probó)");
    Ok(AnfitrionProvider::new(cadena, pairing_bytes.to_vec()))
}

pub fn run_sign_install(
    fd: i32,
    ipa_path: &str,
    email: &str,
    password: &str,
    hay_red: bool,
    vault: Arc<VaultHandle>,
) -> Result<(), StageErr> {
    ensure_crypto_provider();
    stage("Firmar e instalar: arrancando la cadena de la fase 2…");

    let mut pairing_bytes = vault.pairing().ok_or_else(|| {
        err(
            "boveda",
            "no hay registro de pairing en la bóveda: primero empareja el iPhone (pantalla principal) y vuelve aquí",
        )
    })?;

    // ── Etapa: sonda manual de lockdown (v2.2, módulo `probe`) ─────────────
    // La secuencia StartSession + StartService se abre A MANO antes de la
    // cadena: cada respuesta cruda de Apple queda en el registro y, si el
    // registro de la bóveda se niega, la puerta re-empareja en el acto
    // (actualizando `pairing_bytes` y la bóveda) y reintenta en conexión
    // nueva. Solo si las cuatro vías se niegan, la cadena se declara vencida
    // aquí — con el Error exacto de cada vía en el mensaje.
    let gate = crate::probe::gate(fd, &vault, &mut pairing_bytes)?;
    stage(&format!(
        "ETAPA sonda: puerta pasada por la vía {} (puerto {}) — sigue la cadena de firma",
        gate.via, gate.puerto
    ));
    // El EscrowBag del registro vigente (el nuevo si la puerta re-emparejó)
    // viaja a TODA la cadena v2.3: cada servicio se abre a mano con él
    // (módulo `servicio`), con su respuesta cruda en el registro.
    let escrow_bag = crate::probe::parse_pair_record(&pairing_bytes)
        .ok()
        .and_then(|r| r.escrow_bag);
    if gate.escrow_necesario {
        stage("ETAPA sonda: el servicio SOLO abrió presentando el EscrowBag — la cadena v2.3 lo presenta en TODOS sus servicios (InstallationProxy, AFC, HouseArrest) desde el primer intento");
    }

    // ── Etapa: conexión (v2.4: el hub detecta y se purga; la cadena abre
    //    su PROPIA sesión mux fresca, secuencia de la vía 1) ────────────────
    // Hasta la v2.3 la cadena viajaba sobre la sesión del hub, abierta tras
    // la puerta — y abrir InstallationProxy sobre esa sesión reutilizada
    // moría al instante (CONTROL «socketIsClosed … errno 54» → tls
    // handshake eof, 2/2 en vivo). El hub arrastra estado mux sucio entre
    // sesiones; la puerta, en cambio, abre el servicio SIEMPRE sobre su
    // secuencia fresca. La v2.4 copia ese camino pa toda la cadena.
    // v2.6: la preparación corre BAJO EL SUPERVISOR — si el iPhone se cae
    // del bus al preparar, se espera a que vuelva y se prepara de nuevo
    // desde cero, hasta 3 intentos registrados (módulo `supervisor`).
    let mut sup = crate::supervisor::Supervisor::nuevo();
    let provider = sup
        .preparar("conexion", || {
            preparar_proveedor(fd, &pairing_bytes).map_err(|(_, mensaje)| mensaje)
        })
        .map_err(|mensaje| err("conexion", mensaje))?;

    let rt = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .map_err(|e| err("interno", format!("no se pudo crear el runtime: {}", e)))?;

    rt.block_on(async move {
        run_chain(
            provider,
            fd,
            sup,
            ipa_path,
            email,
            password,
            hay_red,
            vault,
            pairing_bytes,
            escrow_bag,
            gate.escrow_necesario,
        )
        .await
    })
}

/// EL PASO «sonda» de la cadena, aislado pa que el supervisor (v2.6)
/// pueda reintentarlo ENTERO sobre un transporte re-preparado: interpreta
/// el registro de pairing, abre InstallationProxy a mano con el EscrowBag
/// presentado (`servicio::abrir_servicio`) y le pide las apps de usuario.
/// Devuelve el `PairingFile` ya interpretado, que la corrida reusa. Los
/// mensajes son los de siempre (sin la etiqueta de etapa, que pone quien
/// llama); la desconexión se reconoce por su firma ENODEV dentro del
/// texto, la presente el servicio que la presente.
async fn paso_sonda(
    provider: &AnfitrionProvider,
    escrow_bag: Option<&[u8]>,
    escrow_necesario: bool,
) -> Result<idevice::pairing_file::PairingFile, String> {
    let pairing_file = provider
        .get_pairing_file()
        .await
        .map_err(|e| format!("el registro de pairing no se pudo interpretar: {:?}", e))?;
    let stream = crate::servicio::abrir_servicio(
        provider,
        &pairing_file,
        crate::probe::SERVICE_INSTALL,
        escrow_bag,
        escrow_necesario,
        "sonda",
    )
    .await
    .map_err(|e| {
        format!(
            "el iPhone no abrió el servicio de instalación con el pairing de la bóveda: {}. Revisa que el iPhone esté desbloqueado y el cable firme.",
            e
        )
    })?;
    let mut inst = InstallationProxyClient::from_stream(stream)
        .await
        .map_err(|e| format!("InstallationProxy no respondió: {:?}", e))?;
    let apps = inst
        .get_apps(Some("User"), None)
        .await
        .map_err(|e| format!("InstallationProxy no respondió: {:?}", e))?;
    stage(&format!(
        "ETAPA sonda: canal sano — el iPhone responde y reporta {} apps de usuario instaladas",
        apps.len()
    ));
    Ok(pairing_file)
}

#[allow(clippy::too_many_arguments)]
async fn run_chain(
    mut provider: AnfitrionProvider,
    fd: i32,
    mut sup: crate::supervisor::Supervisor,
    ipa_path: &str,
    email: &str,
    password: &str,
    hay_red: bool,
    vault: Arc<VaultHandle>,
    pairing_bytes: Vec<u8>,
    escrow_bag: Option<Vec<u8>>,
    escrow_necesario: bool,
) -> Result<(), StageErr> {
    // ── Etapa: sonda del canal de instalación (antes de pedir nada) ────────
    // v2.3: el servicio se abre A MANO con el EscrowBag presentado
    // (`servicio::abrir_servicio`) — la respuesta cruda de Apple queda en el
    // registro y, si se niega, el error trae su `Error` exacto, no el opaco
    // «missing Port» del connect del crate.
    // La RE-PREPARACIÓN del supervisor: la misma `preparar_proveedor` que
    // abrió la cadena — transporte fresco + sesión mux fresca desde cero.
    // Si un paso cae por desconexión, el supervisor la corre, sustituye
    // el proveedor y reintenta el paso sobre la sesión nueva.
    let mut repreparar = || -> Result<AnfitrionProvider, String> {
        preparar_proveedor(fd, &pairing_bytes).map_err(|(_, mensaje)| mensaje)
    };
    stage("ETAPA sonda: probando el canal de instalación con tu pairing (InstallationProxy, apertura a mano con escrow)…");
    let pairing_file = sup
        .ejecutar("sonda", &mut provider, &mut repreparar, |prov| {
            let bag = escrow_bag.as_deref();
            async move { paso_sonda(&prov, bag, escrow_necesario).await }
        })
        .await
        .map_err(|mensaje| err("sonda", mensaje))?;

    // ── Etapa: bóveda — decidir la ruta ────────────────────────────────────
    stage("ETAPA boveda: leyendo el IPA y consultando la bóveda…");
    let (main_bundle, app_nombre) = {
        let app = Application::new(PathBuf::from(ipa_path))
            .map_err(|e| err("boveda", format!("no se pudo leer el IPA elegido: {}", e)))?;
        let b = app
            .main_bundle_id()
            .map_err(|e| err("boveda", format!("el IPA no trae bundle id: {}", e)))?;
        let n = app.main_app_name().unwrap_or_else(|_| b.clone());
        (b, n)
    };
    stage(&format!(
        "ETAPA boveda: app «{}» ({})",
        app_nombre, main_bundle
    ));
    let infos = vault.profile_infos(now_epoch());
    let info = infos.iter().find(|i| i.bundle_id == main_bundle);
    let cubre_offline = match info {
        Some(i) => {
            i.dias >= 0 && vault.get(KEY_CERT).is_some() && vault.get(KEY_EQUIPO).is_some()
        }
        None => false,
    };

    if cubre_offline {
        let dias = info.map(|i| i.dias).unwrap_or(0);
        stage(&format!(
            "ETAPA boveda: la bóveda cubre esta app (perfil válido, quedan {} días) — ruta SIN conexión",
            dias
        ));
        offline_sign_install(
            &mut provider,
            &mut sup,
            &mut repreparar,
            &pairing_file,
            ipa_path,
            &main_bundle,
            &vault,
            escrow_bag.as_deref(),
            escrow_necesario,
        )
        .await?;
    } else {
        if !hay_red {
            let motivo = match info {
                None => "esta app es nueva pa la bóveda: necesita conexión UNA vez pa que Apple emita su perfil",
                Some(i) if i.dias < 0 => "el perfil guardado de esta app ya caducó: necesita conexión pa renovarlo",
                Some(_) => "la bóveda no tiene aún el certificado/equipo: necesita conexión una vez",
            };
            return Err(err("boveda", format!("{} — y ahora mismo el teléfono no reporta conexión. Conéctate y reintenta; el pairing y la instalación por el cable no piden red, solo este primer registro.", motivo)));
        }
        if email.trim().is_empty() || password.is_empty() {
            return Err(err(
                "login",
                "esta app necesita entrar con tu Apple ID una vez (escribe el correo y la contraseña en esta misma pantalla y toca «Firmar e instalar» otra vez)",
            ));
        }
        stage("ETAPA boveda: la app necesita la ruta con conexión (login → firma → cosecha a la bóveda)");
        online_sign_install(
            &mut provider,
            &mut sup,
            &mut repreparar,
            &pairing_file,
            ipa_path,
            &main_bundle,
            &app_nombre,
            email,
            password,
            &vault,
            &pairing_bytes,
            escrow_bag.as_deref(),
            escrow_necesario,
        )
        .await?;
    }

    // ── Etapa: depósito en Tienda Máximo (si es la app destino) ────────────
    if main_bundle == BUNDLE_TIENDA {
        deposit_pairing_in_tienda(
            &provider,
            &pairing_file,
            &main_bundle,
            &vault,
            &pairing_bytes,
            escrow_bag.as_deref(),
            escrow_necesario,
        )
        .await;
    }

    stage("LISTO: app firmada e instalada en el iPhone.");
    Ok(())
}

// ── Ruta con conexión ─────────────────────────────────────────────────────────

/// El error de la etapa «firma» con el consejo según la causa (el mismo
/// mapa que la v2.2 aplicaba al error único de `Sideloader::install_app`).
fn err_firma(e: &dyn std::fmt::Display) -> StageErr {
    let texto = format!("{}", e);
    let baja = texto.to_lowercase();
    let consejo = if baja.contains("app id") {
        "tu cuenta gratis llegó al tope de App IDs de la semana (10): espera unos días o desinstala apps firmadas que no uses."
    } else if baja.contains("device") && baja.contains("regist") {
        "el iPhone no quedó registrado en tu equipo: reintenta la instalación."
    } else {
        "deja el iPhone desbloqueado y conectado y reintenta; si se repite, comparte el registro de etapas."
    };
    err("firma", format!("{} — {}", texto, consejo))
}

#[allow(clippy::too_many_arguments)]
async fn online_sign_install(
    provider: &mut AnfitrionProvider,
    sup: &mut crate::supervisor::Supervisor,
    repreparar: &mut dyn FnMut() -> Result<AnfitrionProvider, String>,
    pairing_file: &idevice::pairing_file::PairingFile,
    ipa_path: &str,
    main_bundle: &str,
    app_nombre: &str,
    email: &str,
    password: &str,
    vault: &Arc<VaultHandle>,
    pairing_bytes: &[u8],
    escrow_bag: Option<&[u8]>,
    escrow_necesario: bool,
) -> Result<(), StageErr> {
    // ── Etapa: anisette ────────────────────────────────────────────────────
    stage("ETAPA anisette: pidiendo la identidad de máquina (servidor remoto v3, ADI de Windows)…");
    let anisette = RemoteV3AnisetteProvider::default()
        .map_err(|e| err("anisette", format!("no se pudo crear el proveedor de anisette: {}", e)))?
        .set_serial_number("0".to_string())
        .set_storage(Box::new(VaultStorageRef(vault.clone())))
        .set_client_info_override(Some(AnisetteClientInfo {
            client_info:
                "<Mac15,7> <macOS;27.0;26A5378j> <com.apple.AuthKit/1 (com.apple.akd/1.0)>"
                    .to_string(),
            user_agent: "akd/1.0 CFNetwork/811.5.4".to_string(),
        }));
    stage("ETAPA anisette: proveedor listo (su estado vive en la bóveda)");

    // ── Etapa: login (GrandSlam SRP + 2FA) ─────────────────────────────────
    stage("ETAPA login: entrando con tu Apple ID (la contraseña no se guarda ni sale del teléfono)…");
    let tfa = |params: isideload::auth::apple_account::TwoFactorCallbackParams| async move {
        if let Some(e) = &params.last_error {
            stage(&format!("ETAPA login: Apple dijo del intento anterior: {}", e));
        }
        if !params.numbers.is_empty() {
            let lista: Vec<String> = params
                .numbers
                .iter()
                .map(|n| format!("…{} ({})", n.last_two_digits, n.number_with_dial_code))
                .collect();
            stage(&format!(
                "ETAPA login: si el código no llega al iPhone, Apple también puede mandarlo por SMS a: {}",
                lista.join(", ")
            ));
        }
        stage("ETAPA login: Apple pide el código de 6 dígitos — mira tu iPhone y escríbelo en la pantalla del Motorola…");
        match pedir_codigo_2fa() {
            Some(code) => {
                if let Some(rest) = code.to_lowercase().strip_prefix("sms:") {
                    if let Ok(id) = rest.trim().parse::<u32>() {
                        return Ok(TwoFactorCallbackResponse::SendSms(id));
                    }
                }
                Ok(TwoFactorCallbackResponse::SubmitCode(code))
            }
            None => Ok(TwoFactorCallbackResponse::Abort),
        }
    };
    let mut cuenta = AppleAccount::builder(email)
        .anisette_provider(anisette)
        .login(password, Box::new(tfa))
        .await
        .map_err(|e| {
            let texto = format!("{}", e);
            let baja = texto.to_lowercase();
            let consejo = if baja.contains("password") || baja.contains("credential") || baja.contains("-20101") {
                "Apple rechazó el correo o la contraseña: revísalos y reintenta."
            } else if baja.contains("anisette") || baja.contains("-80045") || baja.contains("-80046") {
                "el servidor de anisette fue rechazado por Apple (pasa en oleadas): espera unos minutos y reintenta."
            } else if baja.contains("two factor") || baja.contains("verification") || baja.contains("2fa") {
                "la verificación de dos factores no se completó: reintenta con el iPhone a mano pa el código."
            } else {
                "revisa la conexión del teléfono y reintenta; si se repite, comparte el registro de etapas."
            };
            err("login", format!("{} — {}", texto, consejo))
        })?;
    stage("ETAPA login: sesión abierta (la contraseña ya se soltó de memoria)");

    let mut dev_session = DeveloperSession::from_account(&mut cuenta)
        .await
        .map_err(|e| err("login", format!("no se pudo abrir la sesión de desarrollador: {}", e)))?;
    stage("ETAPA login: sesión de desarrollador abierta");

    // ── Etapa: firma + instalación (Sideloader, pila de InstaladorPRO) ─────
    stage("ETAPA firma: firmando con tu equipo Personal Team e instalando por el cable…");
    let max_certs: isideload::util::callbacks::MaxCertsCallbackBox =
        Box::new(|certs: Vec<isideload::dev::certificates::DevelopmentCertificate>| {
            Box::pin(async move {
                stage(&format!(
                    "ETAPA firma: Apple dice que la cuenta llegó al máximo de certificados ({} activos). En esta versión la app NO revoca sola: comparte el registro y Máximo te dice cuál revocar desde una computadora.",
                    certs.len()
                ));
                for c in &certs {
                    stage(&format!(
                        "ETAPA firma: certificado activo: {} (máquina {})",
                        c.name.as_deref().unwrap_or("?"),
                        c.machine_name.as_deref().unwrap_or("?")
                    ));
                }
                Ok(None)
            })
        });
    let ultimo_paso = Arc::new(Mutex::new(0u32));
    let progreso = {
        let ultimo = ultimo_paso.clone();
        move |p: f32| {
            let ultimo = ultimo.clone();
            async move {
                let pct = (p * 100.0) as u32;
                let mut u = ultimo.lock().unwrap_or_else(|e| e.into_inner());
                if pct >= *u + 10 || pct == 100 {
                    *u = pct;
                    stage(&format!("ETAPA firma: progreso {}%", pct));
                }
            }
        }
    };
    let mut sideloader = SideloaderBuilder::new(dev_session, email.to_string())
        .machine_name(MACHINE_NAME.to_string())
        .storage(Box::new(VaultStorageRef(vault.clone())))
        .team_selection(TeamSelection::First)
        .extensions_behavior(ExtensionsBehaviorSelection::Fixed(
            ExtensionsBehavior::ReuseMain,
        ))
        .max_certs_behavior(MaxCertsBehavior::Prompt(max_certs))
        .build();
    // v2.3: `Sideloader::install_app` instalaba por dentro con el connect
    // del crate (AFC + InstallationProxy SIN escrow y con la respuesta cruda
    // descartada — la muerte de la v2.2). Aquí la instalación se descompone
    // en los pasos públicos del propio Sideloader (info del dispositivo →
    // registro en el equipo → `sign_app`) y el traslado lo hace
    // `servicio::instalar_con_escrow`, presentando el EscrowBag en los dos
    // servicios y registrando cada respuesta de Apple.
    let device_info = isideload::util::device::IdeviceInfo::from_device(&*provider)
        .await
        .map_err(|e| err_firma(&e))?;
    let team = sideloader.get_team().await.map_err(|e| err_firma(&e))?;
    sideloader
        .get_dev_session()
        .ensure_device_registered(&team, &device_info.name, &device_info.udid, None)
        .await
        .map_err(|e| err_firma(&e))?;
    let (signed_app_path, _special) = sideloader
        .sign_app(
            PathBuf::from(ipa_path),
            Some(team),
            false,
            Some(progreso),
            Some(pairing_bytes),
            Some(&device_info.udid),
        )
        .await
        .map_err(|e| err_firma(&e))?;
    stage("ETAPA firma: app firmada — instalando por el cable (AFC + InstallationProxy con el EscrowBag presentado)…");
    // v2.6: la instalación corre BAJO EL SUPERVISOR — fue instalando
    // cuando la v2.5 murió por ENODEV. Si el cable se cae a mitad de
    // subida, el supervisor re-prepara el transporte y la instalación se
    // reintenta ENTERA (la subida AFC es idempotente: PublicStaging se
    // reescribe y la instalación se re-pide; el iPhone no queda a medias).
    sup.ejecutar("instalacion", provider, repreparar, |prov| {
        let bag = escrow_bag;
        let ruta = &signed_app_path;
        async move {
            crate::servicio::instalar_con_escrow(
                &prov,
                pairing_file,
                ruta,
                bag,
                escrow_necesario,
                |pct| {
                    if pct == 0 || pct == 35 || pct == 70 {
                        stage(&format!("ETAPA instalacion: progreso {}%", pct));
                    }
                },
            )
            .await
        }
    })
    .await
    .map_err(|e| err_firma(&e))?;
    // Espejo del Sideloader (delete_app_after_install): el .app firmado vive
    // en un temporal que se barre tras instalar.
    let _ = std::fs::remove_dir_all(&signed_app_path);
    stage("ETAPA firma: app instalada en el iPhone");

    // ── Etapa: cosecha a la bóveda (equipo + certificado + perfil) ─────────
    stage("ETAPA cosecha: guardando equipo, certificado y perfil en la bóveda pa la vía sin conexión…");
    match harvest(&mut cuenta, &mut sideloader, email, main_bundle, app_nombre, vault).await {
        Ok(()) => stage("ETAPA cosecha: bóveda al día — la próxima vez esta app se instala sin conexión"),
        Err(e) => stage(&format!(
            "ETAPA cosecha: aviso — la instalación SÍ se hizo, pero la cosecha falló ({}); esta app pedirá conexión la próxima vez",
            e
        )),
    }
    Ok(())
}

/// Con la sesión aún viva: equipo (del Sideloader), certificado (retrieve) y
/// perfil de la app (list + download) quedan en la bóveda.
async fn harvest(
    cuenta: &mut AppleAccount,
    sideloader: &mut isideload::sideload::sideloader::Sideloader<
        isideload::util::callbacks::MaxCertsCallbackBox,
        isideload::util::callbacks::ExtensionsBehaviorCallbackBox,
    >,
    email: &str,
    main_bundle: &str,
    app_nombre: &str,
    vault: &Arc<VaultHandle>,
) -> Result<(), String> {
    let team = sideloader
        .get_team()
        .await
        .map_err(|e| format!("equipo: {}", e))?;
    let equipo_json = serde_json::json!({
        "team_id": team.team_id,
        "nombre": team.name.clone().unwrap_or_default(),
    });
    vault
        .put(KEY_EQUIPO, &equipo_json.to_string())
        .map_err(|e| format!("equipo a la bóveda: {}", e))?;

    // Segunda sesión de desarrollador pa la cosecha (la primera la consumió
    // el Sideloader): la cuenta sigue viva, el intercambio se repite solo.
    let mut sesion = DeveloperSession::from_account(cuenta)
        .await
        .map_err(|e| format!("segunda sesión: {}", e))?;

    // Certificado: retrieve encuentra el que la firma acaba de usar/crear.
    let max_certs: isideload::util::callbacks::MaxCertsCallbackBox =
        Box::new(|_certs: Vec<isideload::dev::certificates::DevelopmentCertificate>| {
            Box::pin(async move { Ok(None) })
        });
    let storage_ref = VaultStorageRef(vault.clone());
    let identity = CertificateIdentity::retrieve(
        MACHINE_NAME,
        email,
        &mut sesion,
        &team,
        &storage_ref,
        &MaxCertsBehavior::Prompt(max_certs),
    )
    .await
    .map_err(|e| format!("certificado: {}", e))?;
    let cert_der = identity
        .certificate
        .to_der()
        .map_err(|e| format!("certificado DER: {}", e))?;
    let key_der = identity
        .private_key
        .to_pkcs8_der()
        .map_err(|e| format!("llave PKCS8: {}", e))?;
    let cert_json = serde_json::json!({
        "machine_id": identity.machine_id,
        "machine_name": identity.machine_name,
        "cert_der_b64": B64.encode(&cert_der),
        "key_der_b64": B64.encode(key_der.as_bytes()),
    });
    vault
        .put(KEY_CERT, &cert_json.to_string())
        .map_err(|e| format!("certificado a la bóveda: {}", e))?;

    // Perfil: el App ID instalado es «bundle.equipo»; se busca y se descarga.
    let installed_id = format!("{}.{}", main_bundle, team.team_id);
    let lista = sesion
        .list_app_ids(&team, None)
        .await
        .map_err(|e| format!("lista de App IDs: {}", e))?;
    let app_id = lista
        .app_ids
        .iter()
        .find(|a| a.identifier == installed_id)
        .ok_or_else(|| format!("no apareció el App ID {} en la cuenta", installed_id))?;
    let profile = sesion
        .download_team_provisioning_profile(&team, app_id, None)
        .await
        .map_err(|e| format!("descarga del perfil: {}", e))?;
    vault
        .set_profile(
            main_bundle,
            app_nombre,
            &team.team_id,
            profile.encoded_profile.as_ref(),
        )
        .map_err(|e| format!("perfil a la bóveda: {}", e))?;
    Ok(())
}

// ── Ruta sin conexión ─────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
async fn offline_sign_install(
    provider: &mut AnfitrionProvider,
    sup: &mut crate::supervisor::Supervisor,
    repreparar: &mut dyn FnMut() -> Result<AnfitrionProvider, String>,
    pairing_file: &idevice::pairing_file::PairingFile,
    ipa_path: &str,
    main_bundle: &str,
    vault: &Arc<VaultHandle>,
    escrow_bag: Option<&[u8]>,
    escrow_necesario: bool,
) -> Result<(), StageErr> {
    stage("ETAPA firma: reconstruyendo la firma SOLO con la bóveda (sin red)…");
    let equipo_raw = vault
        .get(KEY_EQUIPO)
        .ok_or_else(|| err("boveda", "la bóveda no tiene el equipo guardado"))?;
    let equipo: serde_json::Value = serde_json::from_str(&equipo_raw)
        .map_err(|e| err("boveda", format!("equipo de la bóveda ilegible: {}", e)))?;
    let team_id = equipo
        .get("team_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| err("boveda", "el equipo de la bóveda no trae team_id"))?
        .to_string();
    let team = DeveloperTeam {
        name: equipo
            .get("nombre")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        team_id: team_id.clone(),
        r#type: None,
        status: None,
    };

    let cert_raw = vault
        .get(KEY_CERT)
        .ok_or_else(|| err("boveda", "la bóveda no tiene el certificado guardado"))?;
    let cert_json: serde_json::Value = serde_json::from_str(&cert_raw)
        .map_err(|e| err("boveda", format!("certificado de la bóveda ilegible: {}", e)))?;
    let cert_der = B64
        .decode(
            cert_json
                .get("cert_der_b64")
                .and_then(|v| v.as_str())
                .unwrap_or(""),
        )
        .map_err(|e| err("boveda", format!("certificado DER ilegible: {}", e)))?;
    let key_der = B64
        .decode(
            cert_json
                .get("key_der_b64")
                .and_then(|v| v.as_str())
                .unwrap_or(""),
        )
        .map_err(|e| err("boveda", format!("llave PKCS8 ilegible: {}", e)))?;
    let identity = CertificateIdentity {
        machine_id: cert_json
            .get("machine_id")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        machine_name: cert_json
            .get("machine_name")
            .and_then(|v| v.as_str())
            .unwrap_or(MACHINE_NAME)
            .to_string(),
        private_key: rsa::RsaPrivateKey::from_pkcs8_der(&key_der)
            .map_err(|e| err("boveda", format!("la llave del certificado no se pudo reconstruir: {}", e)))?,
        certificate: Certificate::from_der(&cert_der)
            .map_err(|e| err("boveda", format!("el certificado no se pudo reconstruir: {}", e)))?,
    };

    let profile_bytes = vault
        .profile(main_bundle)
        .ok_or_else(|| err("boveda", "la bóveda no tiene el perfil de esta app"))?;
    let profile = profile_from_bytes(&profile_bytes)
        .map_err(|e| err("boveda", format!("perfil de la bóveda ilegible: {}", e)))?;

    // Espejo de sign_app con ReuseMain, sin tocar la red: renombrar el bundle
    // principal a «bundle.equipo», escribir los Info.plist y firmar con el
    // perfil principal pa la app y sus extensiones.
    let mut app = Application::new(PathBuf::from(ipa_path))
        .map_err(|e| err("firma", format!("no se pudo leer el IPA: {}", e)))?;
    let installed_id = format!("{}.{}", main_bundle, team_id);
    app.update_bundle_id(main_bundle, &installed_id)
        .map_err(|e| err("firma", format!("no se pudo renombrar el bundle: {}", e)))?;
    let entitlements = profile_entitlements(&profile_bytes)
        .map_err(|e| err("firma", format!("el perfil no trae entitlements: {}", e)))?;
    let mut all_profiles: Vec<(String, Profile, plist::Dictionary)> = Vec::new();
    for ext in app.bundle.app_extensions() {
        all_profiles.push((
            ext.bundle_identifier().unwrap_or_default().to_string(),
            profile.clone(),
            entitlements.clone(),
        ));
    }
    app.bundle
        .write_info()
        .map_err(|e| err("firma", format!("escribiendo Info.plist: {}", e)))?;
    for ext in app.bundle.app_extensions_mut() {
        ext.write_info()
            .map_err(|e| err("firma", format!("escribiendo Info.plist de extensión: {}", e)))?;
    }
    for fw in app.bundle.frameworks_mut() {
        fw.write_info()
            .map_err(|e| err("firma", format!("escribiendo Info.plist de framework: {}", e)))?;
    }

    let ultimo_paso = Arc::new(Mutex::new(0u32));
    let progreso = {
        let ultimo = ultimo_paso.clone();
        move |p: f32| {
            let ultimo = ultimo.clone();
            async move {
                let pct = (p * 100.0) as u32;
                let mut u = ultimo.lock().unwrap_or_else(|e| e.into_inner());
                if pct >= *u + 10 || pct == 100 {
                    *u = pct;
                    stage(&format!("ETAPA firma: progreso {}%", pct));
                }
            }
        }
    };
    sign(
        &mut app,
        &identity,
        &profile,
        &mut all_profiles,
        &None,
        &team,
        Some(progreso),
    )
    .await
    .map_err(|e| err("firma", format!("la firma sin conexión falló: {}", e)))?;
    stage("ETAPA firma: app firmada con el material de la bóveda");

    stage("ETAPA instalacion: subiendo la app por el cable (AFC + InstallationProxy, apertura a mano con el EscrowBag presentado)…");
    let signed_dir = app.bundle.bundle_dir.clone();
    // v2.6: también aquí la instalación corre BAJO EL SUPERVISOR (misma
    // medicina que en la ruta con conexión: re-preparar y reintentar la
    // instalación entera si el cable se cae a mitad de subida).
    sup.ejecutar("instalacion", provider, repreparar, |prov| {
        let bag = escrow_bag;
        let ruta = &signed_dir;
        async move {
            crate::servicio::instalar_con_escrow(
                &prov,
                pairing_file,
                ruta,
                bag,
                escrow_necesario,
                |pct| {
                    if pct == 0 || pct == 35 || pct == 70 {
                        stage(&format!("ETAPA instalacion: subida {}%", pct));
                    }
                },
            )
            .await
        }
    })
    .await
    .map_err(|e| err("instalacion", format!("la instalación por el cable falló: {}", e)))?;
    stage("ETAPA instalacion: app instalada en el iPhone (sin haber tocado la red)");
    Ok(())
}

/// Reconstruye un `Profile` de isideload desde los bytes del
/// `.mobileprovision`: a `sign()` solo le importa `encoded_profile`; el resto
/// es metadato que se rellena desde el propio plist del perfil.
fn profile_from_bytes(bytes: &[u8]) -> Result<Profile, String> {
    let info = crate::vault::parse_profile(bytes)?;
    let mut dict = plist::Dictionary::new();
    dict.insert(
        "encodedProfile".to_string(),
        plist::Value::Data(bytes.to_vec()),
    );
    dict.insert("filename".to_string(), plist::Value::String(String::new()));
    dict.insert(
        "provisioningProfileId".to_string(),
        plist::Value::String(String::new()),
    );
    dict.insert("name".to_string(), plist::Value::String(info.nombre.clone()));
    dict.insert("status".to_string(), plist::Value::String("Active".into()));
    dict.insert("type".to_string(), plist::Value::String(String::new()));
    dict.insert(
        "distributionMethod".to_string(),
        plist::Value::String(String::new()),
    );
    dict.insert("UUID".to_string(), plist::Value::String(String::new()));
    dict.insert("appIdId".to_string(), plist::Value::String(String::new()));
    dict.insert(
        "isTemplateProfile".to_string(),
        plist::Value::Boolean(false),
    );
    // La fecha viaja como el string ISO del propio plist del perfil:
    // plist::Date se construye desde ese formato, no desde OffsetDateTime.
    let xml = crate::vault::extract_plist_xml(bytes)?;
    let iso = crate::vault::xml_string_after_key(xml, "ExpirationDate")
        .ok_or("el perfil no trae ExpirationDate")?;
    let fecha = plist::Date::from_xml_format(&iso)
        .map_err(|_| format!("fecha del perfil no reconocida: {}", iso))?;
    dict.insert("dateExpire".to_string(), plist::Value::Date(fecha));
    plist::from_value(&plist::Value::Dictionary(dict))
        .map_err(|e| format!("reconstruyendo el perfil: {}", e))
}

/// Los entitlements del perfil, como diccionario plist (pa las extensiones
/// en la firma ReuseMain, igual que hace `sign_app`).
fn profile_entitlements(bytes: &[u8]) -> Result<plist::Dictionary, String> {
    let xml = crate::vault::extract_plist_xml(bytes)?;
    let value: plist::Value = plist::from_bytes(xml.as_bytes())
        .map_err(|e| format!("plist del perfil: {}", e))?;
    let dict = value
        .into_dictionary()
        .ok_or("el plist del perfil no es un diccionario")?;
    let ent = dict
        .get("Entitlements")
        .ok_or("sin Entitlements")?
        .clone()
        .into_dictionary()
        .ok_or("Entitlements no es un diccionario")?;
    Ok(ent)
}

// ── Depósito del pairing dentro de Tienda Máximo ──────────────────────────────

/// Si la app instalada es Tienda Máximo, su registro de pairing queda
/// depositado en sus Documentos por HouseArrest (los nombres que SideStore
/// lee). Solo tenemos el registro lockdown — en iOS 18 es el que Tienda
/// Máximo consume; el depósito es informativo y nunca tumba la instalación.
#[allow(clippy::too_many_arguments)]
async fn deposit_pairing_in_tienda(
    provider: &AnfitrionProvider,
    pairing_file: &idevice::pairing_file::PairingFile,
    main_bundle: &str,
    vault: &Arc<VaultHandle>,
    pairing_bytes: &[u8],
    escrow_bag: Option<&[u8]>,
    escrow_necesario: bool,
) {
    stage("ETAPA tienda: depositando tu registro de pairing dentro de Tienda Máximo (HouseArrest)…");
    let team_id = vault
        .get(KEY_EQUIPO)
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| {
            v.get("team_id")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
        });
    let Some(team_id) = team_id else {
        stage("ETAPA tienda: aviso — sin equipo en la bóveda no se puede localizar la app instalada; importa el registro a mano esta vez");
        return;
    };
    let installed_id = format!("{}.{}", main_bundle, team_id);
    let result: Result<(), String> = async {
        // HouseArrest también se abre a mano con el escrow (v2.3): es el
        // servicio que más lo necesita — toca contenedores de apps.
        let stream = crate::servicio::abrir_servicio(
            provider,
            pairing_file,
            crate::servicio::SERVICE_HOUSE_ARREST,
            escrow_bag,
            escrow_necesario,
            "tienda",
        )
        .await?;
        let casa = HouseArrestClient::from_stream(stream)
            .await
            .map_err(|e| format!("{:?}", e))?;
        let mut afc = casa
            .vend_documents(&installed_id)
            .await
            .map_err(|e| format!("{:?}", e))?;
        write_doc(&mut afc, pairing_bytes, "PairingFile_Lockdown.plist").await?;
        write_doc(&mut afc, pairing_bytes, "ALTPairingFile.mobiledevicepairing").await?;
        Ok(())
    }
    .await;
    match result {
        Ok(()) => stage(
            "ETAPA tienda: registro depositado — Tienda Máximo ya tiene tu pairing dentro",
        ),
        Err(e) => stage(&format!(
            "ETAPA tienda: aviso — el depósito no se pudo hacer ({}); Tienda Máximo funciona igual importando el registro desde la pantalla principal",
            e
        )),
    }
}

async fn write_doc(
    afc: &mut idevice::afc::AfcClient,
    bytes: &[u8],
    nombre: &str,
) -> Result<(), String> {
    let _ = afc.mk_dir("/Documents/".to_string()).await;
    let mut f = afc
        .open(
            format!("/Documents/{}", nombre),
            idevice::afc::opcode::AfcFopenMode::Wr,
        )
        .await
        .map_err(|e| format!("{:?}", e))?;
    f.write_entire(bytes)
        .await
        .map_err(|e| format!("{:?}", e))?;
    f.close().await.map_err(|e| format!("{:?}", e))?;
    Ok(())
}

// ── Banco B3: la firma sin conexión, mecánica ─────────────────────────────────

#[cfg(test)]
mod bench_firma {
    use super::*;
    use rsa::pkcs8::EncodePrivateKey;

    /// Banco mecánico de la vía offline: firma un IPA real SOLO con material
    /// de bóveda (identidad y perfil fabricados en el banco, coherentes entre
    /// sí) usando las MISMAS piezas de `offline_sign_install` —
    /// `profile_from_bytes`, `profile_entitlements`, `update_bundle_id` y
    /// `sign()` — y verifica la estructura firmada resultante. No prueba que
    /// Apple acepte el perfil (eso lo hace la corrida viva con la cuenta de
    /// Ernesto); prueba que la cadena de firma local funciona de punta a punta.
    ///
    /// El material vive en `bench-firma-fixture/` (generado una vez con
    /// openssl: certificado autofirmado de banco + el perfil como CMS
    /// SignedData de verdad — `ProvisioningProfile::parse` exige el CMS, un
    /// plist pelado lo rechaza con «tag 0x3c»). Es material de banco, sin
    /// relación con ninguna cuenta real.
    ///
    /// Corre con: `ANFITRION_BENCH_IPA=/ruta/app.ipa cargo test --offline
    /// firma_offline_mecanica -- --ignored --nocapture`
    #[test]
    #[ignore = "banco con fixture externo (el IPA real)"]
    fn firma_offline_mecanica() {
        let ipa = std::env::var("ANFITRION_BENCH_IPA")
            .unwrap_or_else(|_| "/tmp/TiendaMaximo.ipa".to_string());
        let team_id = "TEAMID1234";
        let bundle = "com.maximo.tienda";
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bench-firma-fixture");

        // 1) Identidad y perfil de banco (el material que la bóveda guardaría).
        let cert_der = std::fs::read(fixture.join("identidad-cert.der")).expect("cert fixture");
        let key_der =
            std::fs::read(fixture.join("identidad-key.pkcs8.der")).expect("llave fixture");
        let profile_bytes =
            std::fs::read(fixture.join("perfil.mobileprovision")).expect("perfil fixture");
        let identity = CertificateIdentity {
            machine_id: "BANCO".to_string(),
            machine_name: MACHINE_NAME.to_string(),
            private_key: rsa::RsaPrivateKey::from_pkcs8_der(&key_der).expect("llave PKCS8"),
            certificate: Certificate::from_der(&cert_der).expect("cert DER"),
        };
        let team = DeveloperTeam {
            name: Some("Banco Anfitrion".to_string()),
            team_id: team_id.to_string(),
            r#type: None,
            status: None,
        };
        let installed = format!("{}.{}", bundle, team_id);

        // El parseo de la bóveda reconoce el perfil fabricado (bundle original).
        let info = crate::vault::parse_profile(&profile_bytes).expect("parse del perfil");
        assert_eq!(info.bundle_id, bundle);
        assert!(info.expira_epoch > now_epoch());

        // 3) Las piezas de la ruta offline, tal cual las usa la cadena.
        let profile = profile_from_bytes(&profile_bytes).expect("Profile reconstruido");
        let entitlements = profile_entitlements(&profile_bytes).expect("entitlements");

        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime del banco");
        rt.block_on(async move {
            let mut app = Application::new(PathBuf::from(&ipa)).expect("Application::new");
            assert_eq!(app.main_bundle_id().unwrap(), bundle);
            app.update_bundle_id(bundle, &installed).expect("renombrar bundle");
            let mut all_profiles: Vec<(String, Profile, plist::Dictionary)> = Vec::new();
            for ext in app.bundle.app_extensions() {
                all_profiles.push((
                    ext.bundle_identifier().unwrap_or_default().to_string(),
                    profile.clone(),
                    entitlements.clone(),
                ));
            }
            app.bundle.write_info().expect("write_info principal");
            for ext in app.bundle.app_extensions_mut() {
                ext.write_info().expect("write_info extensión");
            }
            for fw in app.bundle.frameworks_mut() {
                fw.write_info().expect("write_info framework");
            }
            sign::<fn(f32) -> std::future::Ready<()>, _>(
                &mut app,
                &identity,
                &profile,
                &mut all_profiles,
                &None,
                &team,
                None,
            )
            .await
            .expect("sign() debe firmar con el material de la bóveda");

            // 4) Estructura firmada: perfil embebido idéntico + CodeResources.
            let dir = app.bundle.bundle_dir.clone();
            let embedded = std::fs::read(dir.join("embedded.mobileprovision"))
                .expect("embedded.mobileprovision debe existir");
            assert_eq!(embedded, profile_bytes);
            let code_resources = dir.join("_CodeSignature").join("CodeResources");
            assert!(
                code_resources.exists(),
                "_CodeSignature/CodeResources debe existir en {:?}",
                dir
            );
            let cr = std::fs::read(&code_resources).expect("leer CodeResources");
            assert!(cr.len() > 100, "CodeResources sospechosamente corto");
            println!(
                "[banco B3] FIRMA OFFLINE OK: {} firmado en {:?} (CodeResources {} bytes, {} perfiles de extensión)",
                ipa,
                dir,
                cr.len(),
                all_profiles.len()
            );
        });
    }
}

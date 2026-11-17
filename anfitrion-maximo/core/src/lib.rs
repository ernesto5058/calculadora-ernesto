//! **Anfitrión Máximo** — núcleo Rust (cdylib pa JNI).
//!
//! Pare el pairing lockdown de un iPhone desde Android: Kotlin presta el fd USB
//! (`UsbDeviceConnection`), este núcleo hace todo lo demás — usbdevfs, mux, lockdownd
//! Pair — y devuelve el registro en formato libimobiledevice listo pa importar.
//!
//! Piezas adaptadas de **idevice-rs** (IsMyPhonePwned, GPL-3.0): el crate
//! `idevice-usb-core` se usa vendorizado tal cual; `crypto.rs` es su módulo de
//! criptografía con los `console_log!` redirigidos al registro de etapas.

use std::panic;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use jni::objects::{GlobalRef, JClass, JObject, JString, JValue};
use jni::sys::{jint, jstring};
use jni::{JNIEnv, JavaVM};

/// Las líneas `[crypto] …` del código adaptado van al mismo registro de etapas.
#[macro_export]
macro_rules! log_line {
    ($($t:tt)*) => {
        $crate::stage(&format!($($t)*))
    };
}

pub mod crypto;
mod cadena;
mod hub;
mod mux;
mod pair;
mod probe;
mod provider;
mod record;
mod servicio;
mod signinstall;
mod supervisor;
mod transport;
mod vault;

/// El trazado diagnóstico de crypto queda apagado en la app (el registro de etapas basta).
pub(crate) fn diagnostic_trace_enabled() -> bool {
    false
}

// ── Registro de etapas ────────────────────────────────────────────────────────

struct Sink {
    /// Puntero crudo a la JavaVM (JavaVM no es Clone en jni 0.21; el puntero vive lo que vive el proceso).
    vm_ptr: Option<usize>,
    target: Option<GlobalRef>,
    lines: Vec<String>,
    start: Instant,
}

static SINK: OnceLock<Mutex<Sink>> = OnceLock::new();

fn sink() -> &'static Mutex<Sink> {
    SINK.get_or_init(|| {
        Mutex::new(Sink {
            vm_ptr: None,
            target: None,
            lines: Vec::new(),
            start: Instant::now(),
        })
    })
}

/// Escribe una línea en el registro de etapas y la empuja a la UI de Kotlin (`onStage`).
pub fn stage(msg: &str) {
    let (line, vm_ptr, target) = {
        let mut s = match sink().lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let elapsed = s.start.elapsed().as_secs_f32();
        let line = format!("[{:>6.1}s] {}", elapsed, msg);
        s.lines.push(line.clone());
        (line, s.vm_ptr, s.target.clone())
    };
    if let (Some(ptr), Some(target)) = (vm_ptr, target) {
        if let Ok(vm) = unsafe { JavaVM::from_raw(ptr as *mut jni::sys::JavaVM) } {
            if let Ok(mut env) = vm.attach_current_thread() {
                if let Ok(jline) = env.new_string(&line) {
                    let _ = env.call_method(
                        &target,
                        "onStage",
                        "(Ljava/lang/String;)V",
                        &[JValue::Object(&jline)],
                    );
                    if env.exception_check().unwrap_or(false) {
                        let _ = env.exception_clear();
                    }
                }
            }
        }
    }
}

/// Todas las líneas del registro de etapas tal cual viven en el sink, en
/// orden (v2.3: el seguro del registro — ver `nativeStageLines`).
pub fn stage_lines() -> Vec<String> {
    sink()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .lines
        .clone()
}

/// `RustBridge.nativeStageLines()` → el registro de etapas COMPLETO del sink,
/// una línea por renglón. La UI lo usa al terminar la cadena pa añadir las
/// líneas que el callback `onStage` haya perdido por el camino (dedupe por
/// contador en Kotlin): ninguna línea cruda depende ya de un solo callback
/// con fallos tragados.
#[no_mangle]
pub extern "system" fn Java_com_maximo_anfitrion_RustBridge_nativeStageLines(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    let text = stage_lines().join("\n");
    jstring_out(&mut env, text)
}

fn reset_sink(env: &mut JNIEnv, logger: &JObject) {
    let vm_ptr = env
        .get_java_vm()
        .ok()
        .map(|vm| vm.get_java_vm_pointer() as usize);
    let target = env.new_global_ref(logger).ok();
    let mut s = sink().lock().unwrap_or_else(|p| p.into_inner());
    s.vm_ptr = vm_ptr;
    s.target = target;
    s.lines.clear();
    s.start = Instant::now();
}

// ── Entrada JNI ───────────────────────────────────────────────────────────────

/// `RustBridge.nativePair(fd, outPath, serial, logger)` → `"OK"` o `"ERROR::<etapa>::<mensaje>"`.
/// El registro completo queda en el logger (pantalla) línea a línea.
#[no_mangle]
pub extern "system" fn Java_com_maximo_anfitrion_RustBridge_nativePair(
    mut env: JNIEnv,
    _class: JClass,
    fd: jint,
    out_path: JString,
    serial: JString,
    logger: JObject,
) -> jstring {
    let result = panic::catch_unwind(panic::AssertUnwindSafe(|| -> String {
        reset_sink(&mut env, &logger);
        let out_path_str: String = env
            .get_string(&out_path)
            .map(|s| s.into())
            .unwrap_or_default();
        let serial_str: String = env
            .get_string(&serial)
            .map(|s| s.into())
            .unwrap_or_default();
        stage("Anfitrión Máximo: arrancando el pairing (núcleo Rust, sin red, sin cuentas)");
        match pair::run_pair(fd, &serial_str) {
            Ok(xml) => {
                match std::fs::write(&out_path_str, &xml) {
                    Ok(()) => {
                        stage(&format!(
                            "ETAPA registro: archivo guardado en {} ({} bytes)",
                            out_path_str,
                            xml.len()
                        ));
                        stage("LISTO: pairing completado. El iPhone ya confía en este anfitrión.");
                        "OK".to_string()
                    }
                    Err(e) => format!(
                        "ERROR::registro::el pairing funcionó pero no se pudo guardar el archivo: {}",
                        e
                    ),
                }
            }
            Err((etapa, msg)) => {
                stage(&format!("FALLO en la etapa «{}»: {}", etapa, msg));
                format!("ERROR::{}::{}", etapa, msg)
            }
        }
    }));
    let text = match result {
        Ok(s) => s,
        Err(_) => "ERROR::interno::pánico en el núcleo Rust (ver registro de etapas)".to_string(),
    };
    env.new_string(text)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

// ── Fase 2: bóveda cifrada ────────────────────────────────────────────────────

static VAULT: OnceLock<Mutex<Option<std::sync::Arc<vault::VaultHandle>>>> = OnceLock::new();

fn vault_slot() -> &'static Mutex<Option<std::sync::Arc<vault::VaultHandle>>> {
    VAULT.get_or_init(|| Mutex::new(None))
}

fn current_vault() -> Option<std::sync::Arc<vault::VaultHandle>> {
    vault_slot()
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
}

fn jstring_out(env: &mut JNIEnv, text: String) -> jstring {
    env.new_string(text)
        .map(|s| s.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

/// `RustBridge.nativeVaultUnlock(dirPath, dek, tmpPath, logger)` → `"OK"` o `"ERROR::<mensaje>"`.
/// La DEK llega ya desenvuelta por el Android Keystore (Kotlin); aquí solo
/// vive en memoria. `tmpPath` se fija como TMPDIR: la extracción de IPAs de
/// isideload usa el temporal del sistema y el de Android no es escribible
/// por las apps.
#[no_mangle]
pub extern "system" fn Java_com_maximo_anfitrion_RustBridge_nativeVaultUnlock(
    mut env: JNIEnv,
    _class: JClass,
    dir_path: JString,
    dek: jni::objects::JByteArray,
    tmp_path: JString,
    logger: JObject,
) -> jstring {
    let result = panic::catch_unwind(panic::AssertUnwindSafe(|| -> String {
        reset_sink(&mut env, &logger);
        signinstall::ensure_crypto_provider();
        let dir: String = env.get_string(&dir_path).map(|s| s.into()).unwrap_or_default();
        let tmp: String = env.get_string(&tmp_path).map(|s| s.into()).unwrap_or_default();
        if !tmp.is_empty() {
            std::env::set_var("TMPDIR", &tmp);
        }
        let dek_bytes = match env.convert_byte_array(&dek) {
            Ok(b) if b.len() == 32 => b,
            Ok(b) => {
                return format!(
                    "ERROR::la DEK debe tener 32 bytes y llegaron {}",
                    b.len()
                )
            }
            Err(e) => return format!("ERROR::no se pudo leer la DEK: {}", e),
        };
        let mut dek_arr = [0u8; 32];
        dek_arr.copy_from_slice(&dek_bytes);
        match vault::VaultHandle::open(std::path::Path::new(&dir), dek_arr) {
            Ok(handle) => {
                stage("Bóveda cifrada abierta (la llave vive en el Keystore de Android)");
                *vault_slot().lock().unwrap_or_else(|p| p.into_inner()) = Some(handle);
                "OK".to_string()
            }
            Err(e) => format!("ERROR::{}", e),
        }
    }));
    jstring_out(&mut env, result.unwrap_or_else(|_| "ERROR::pánico en el núcleo".into()))
}

/// `RustBridge.nativeVaultImportPairing(bytes)` → guarda el registro en la bóveda.
#[no_mangle]
pub extern "system" fn Java_com_maximo_anfitrion_RustBridge_nativeVaultImportPairing(
    mut env: JNIEnv,
    _class: JClass,
    bytes: jni::objects::JByteArray,
) -> jstring {
    let result = panic::catch_unwind(panic::AssertUnwindSafe(|| -> String {
        let Some(v) = current_vault() else {
            return "ERROR::la bóveda no está abierta".to_string();
        };
        match env.convert_byte_array(&bytes) {
            Ok(b) => match v.set_pairing(&b) {
                Ok(()) => {
                    stage(&format!(
                        "Registro de pairing guardado en la bóveda ({} bytes)",
                        b.len()
                    ));
                    "OK".to_string()
                }
                Err(e) => format!("ERROR::{}", e),
            },
            Err(e) => format!("ERROR::no se pudieron leer los bytes: {}", e),
        }
    }));
    jstring_out(&mut env, result.unwrap_or_else(|_| "ERROR::pánico en el núcleo".into()))
}

/// `RustBridge.nativeVaultHasPairing()` → 1 si la bóveda ya tiene registro.
#[no_mangle]
pub extern "system" fn Java_com_maximo_anfitrion_RustBridge_nativeVaultHasPairing(
    _env: JNIEnv,
    _class: JClass,
) -> jni::sys::jboolean {
    match current_vault() {
        Some(v) if v.pairing().is_some() => 1,
        _ => 0,
    }
}

/// `RustBridge.nativeVaultExportPairing(destPath)` → materializa el registro
/// en una ruta (la carpeta de compartir de la app; Kotlin la barre después).
#[no_mangle]
pub extern "system" fn Java_com_maximo_anfitrion_RustBridge_nativeVaultExportPairing(
    mut env: JNIEnv,
    _class: JClass,
    dest_path: JString,
) -> jstring {
    let result = panic::catch_unwind(panic::AssertUnwindSafe(|| -> String {
        let Some(v) = current_vault() else {
            return "ERROR::la bóveda no está abierta".to_string();
        };
        let Some(bytes) = v.pairing() else {
            return "ERROR::la bóveda no tiene registro de pairing".to_string();
        };
        let dest: String = env.get_string(&dest_path).map(|s| s.into()).unwrap_or_default();
        match std::fs::write(&dest, &bytes) {
            Ok(()) => "OK".to_string(),
            Err(e) => format!("ERROR::no se pudo materializar el registro: {}", e),
        }
    }));
    jstring_out(&mut env, result.unwrap_or_else(|_| "ERROR::pánico en el núcleo".into()))
}

/// `RustBridge.nativeVaultProfiles()` → JSON `[{bundle_id, nombre, dias}]`.
#[no_mangle]
pub extern "system" fn Java_com_maximo_anfitrion_RustBridge_nativeVaultProfiles(
    mut env: JNIEnv,
    _class: JClass,
) -> jstring {
    let text = match current_vault() {
        Some(v) => {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            let infos = v.profile_infos(now);
            let arr: Vec<serde_json::Value> = infos
                .iter()
                .map(|i| {
                    serde_json::json!({
                        "bundle_id": i.bundle_id, "nombre": i.nombre, "dias": i.dias,
                    })
                })
                .collect();
            serde_json::Value::Array(arr).to_string()
        }
        None => "[]".to_string(),
    };
    jstring_out(&mut env, text)
}

/// `RustBridge.nativeVaultCovers(ipaPath)` → JSON de cobertura offline.
#[no_mangle]
pub extern "system" fn Java_com_maximo_anfitrion_RustBridge_nativeVaultCovers(
    mut env: JNIEnv,
    _class: JClass,
    ipa_path: JString,
    logger: JObject,
) -> jstring {
    let result = panic::catch_unwind(panic::AssertUnwindSafe(|| -> String {
        reset_sink(&mut env, &logger);
        let Some(v) = current_vault() else {
            return "{\"cubre\":false,\"motivo\":\"la bóveda no está abierta\"}".to_string();
        };
        let path: String = env.get_string(&ipa_path).map(|s| s.into()).unwrap_or_default();
        signinstall::vault_covers(&path, &v)
    }));
    jstring_out(
        &mut env,
        result.unwrap_or_else(|_| "{\"cubre\":false,\"motivo\":\"pánico en el núcleo\"}".into()),
    )
}

// ── Fase 2: firmar e instalar ─────────────────────────────────────────────────

/// `RustBridge.nativeSignInstall(fd, ipaPath, email, password, hayRed, tfaBridge, logger)`
/// → `"OK"` o `"ERROR::<etapa>::<mensaje>"`. La contraseña vive solo en esta
/// llamada y se limpia al volver; el código 2FA lo pide el núcleo a
/// `tfaBridge.requestTfaCode()` cuando Apple lo exige.
#[no_mangle]
pub extern "system" fn Java_com_maximo_anfitrion_RustBridge_nativeSignInstall(
    mut env: JNIEnv,
    _class: JClass,
    fd: jint,
    ipa_path: JString,
    email: JString,
    password: JString,
    hay_red: jni::sys::jboolean,
    tfa_bridge: JObject,
    logger: JObject,
) -> jstring {
    let result = panic::catch_unwind(panic::AssertUnwindSafe(|| -> String {
        reset_sink(&mut env, &logger);
        signinstall::register_tfa_bridge(&mut env, &tfa_bridge);
        let Some(v) = current_vault() else {
            return "ERROR::boveda::la bóveda no está abierta".to_string();
        };
        let ipa: String = env.get_string(&ipa_path).map(|s| s.into()).unwrap_or_default();
        let email_s: String = env.get_string(&email).map(|s| s.into()).unwrap_or_default();
        let mut password_s: String = env
            .get_string(&password)
            .map(|s| s.into())
            .unwrap_or_default();
        let r = signinstall::run_sign_install(
            fd,
            &ipa,
            &email_s,
            &password_s,
            hay_red != 0,
            v,
        );
        // Higiene: la contraseña no sobrevive a la llamada.
        password_s.clear();
        password_s.shrink_to_fit();
        match r {
            Ok(()) => "OK".to_string(),
            Err((etapa, msg)) => {
                stage(&format!("FALLO en la etapa «{}»: {}", etapa, msg));
                format!("ERROR::{}::{}", etapa, msg)
            }
        }
    }));
    jstring_out(
        &mut env,
        result.unwrap_or_else(|_| "ERROR::interno::pánico en el núcleo Rust".into()),
    )
}

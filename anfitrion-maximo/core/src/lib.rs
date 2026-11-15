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
mod mux;
mod pair;
mod record;
mod transport;

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

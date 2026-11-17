//! **El supervisor de reintento USB (v2.6)** — la resiliencia que la
//! auditoría de la v2.5 dejó como hallazgo F2 y que la corrida viva de la
//! v2.5 convirtió en necesidad probada.
//!
//! **La falla que cura** (corrida viva del 2026-11-16): la negociación de
//! la v2.5 funcionó — StartSession negociada, StartService enviado — y a
//! los ~2,6 s la cadena murió con `bulk OUT: No such device (os error
//! 19)`: el iPhone se cayó del bus USB a mitad de escritura y la IPA no
//! quedó instalada. Hasta la v2.5, una desconexión así era el final de la
//! corrida: Ernesto tenía que reintentar TODO a mano, con el cable
//! temblando entre intento e intento.
//!
//! **Lo que hace el supervisor:** envuelve los pasos de la cadena que
//! viajan por el cable (la preparación del transporte, la sonda del canal
//! y la instalación). Cuando un paso cae **por desconexión del
//! dispositivo** — y SOLO por eso — el supervisor:
//!
//! 1. **Registra** el evento en el registro de etapas (paso, intento,
//!    error exacto, hora) y en su registro estructurado.
//! 2. **Espera** una pausa breve (1,5 s) pa que el iPhone vuelva al bus.
//! 3. **Re-prepara el transporte desde cero**: re-enumerar el dispositivo
//!    por el fd, SET_CONFIGURATION que reinicia la sesión mux del iPhone,
//!    sesión mux FRESCA con el patrón de `cadena.rs` (la misma
//!    preparación que abre la cadena la primera vez) — sobre esa sesión
//!    nueva, cada servicio re-negocia su StartSession como siempre
//!    (`servicio::abrir_servicio`).
//! 4. **Reintenta el paso caído** sobre el transporte nuevo.
//!
//! **Los límites, sin letra pequeña:** máximo **3 intentos por paso**;
//! agotados, la cadena falla con honestidad y el error final trae el
//! registro completo de los intentos — nada de bucles infinitos ni fallos
//! silenciosos. Y el supervisor SOLO actúa ante errores de
//! desconexión/transporte (ENODEV): cualquier otro error — la negativa de
//! Apple, un RST del mux, un timeout — sigue su camino actual sin
//! reintentar, porque reintentar no lo arregla y disfrazaría la causa.
//!
//! **La costura conocida:** Kotlin es dueño del fd (`UsbDeviceConnection`)
//! y este núcleo no puede pedirle otro a mitad de corrida; la
//! re-preparación trabaja sobre el mismo fd (re-enumerar +
//! SET_CONFIGURATION + sesión fresca). Si la caída fue física y el fd
//! quedó muerto, las re-preparaciones también caen — cuentan como
//! intentos, quedan registradas, y el supervisor agota y falla con el
//! registro completo: exactamente el comportamiento honesto de arriba.

use std::future::Future;
use std::time::Duration;

use crate::stage;

/// Intentos máximos por paso (el inicial + 2 reintentos tras re-preparar).
pub const MAX_INTENTOS: u32 = 3;
/// La pausa entre intentos: aire pa que el iPhone vuelva al bus.
pub const PAUSA_REINTENTO: Duration = Duration::from_millis(1500);

/// ¿Este error es una **desconexión del dispositivo**? La firma del
/// ENODEV en esta pila: el transporte la formatea como
/// `bulk OUT: No such device (os error 19) (errno 19)` (y su gemela de
/// `bulk IN`), y el texto sobrevive a todos los envoltorios de la cadena
/// (el hilo de la cadena, el stream, los `{:?}` de los clientes). Nada
/// más en la app produce «os error 19» / «errno 19»: el 19 es ENODEV y
/// aquí solo lo dan los ioctls USB.
pub fn es_desconexion(error: &str) -> bool {
    let b = error.to_lowercase();
    b.contains("no such device") || b.contains("os error 19") || b.contains("errno 19")
}

fn ahora_epoch() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Un intento caído por desconexión, tal como queda registrado.
#[derive(Debug, Clone, PartialEq)]
pub struct IntentoFallido {
    pub paso: String,
    pub intento: u32,
    pub error: String,
    pub hora_epoch: i64,
}

/// El supervisor de la corrida: política de reintentos + el registro
/// estructurado de cada caída por desconexión.
pub struct Supervisor {
    max_intentos: u32,
    pausa: Duration,
    registro: Vec<IntentoFallido>,
}

impl Default for Supervisor {
    fn default() -> Self {
        Self::nuevo()
    }
}

impl Supervisor {
    pub fn nuevo() -> Self {
        Self {
            max_intentos: MAX_INTENTOS,
            pausa: PAUSA_REINTENTO,
            registro: Vec::new(),
        }
    }

    /// Pa los bancos: la misma política con la pausa anulada.
    #[cfg(test)]
    fn de_banco() -> Self {
        Self {
            max_intentos: MAX_INTENTOS,
            pausa: Duration::ZERO,
            registro: Vec::new(),
        }
    }

    pub fn registro(&self) -> &[IntentoFallido] {
        &self.registro
    }

    /// El registro en una línea por intento (pa el error final honesto).
    pub fn resumen_registro(&self) -> String {
        self.registro
            .iter()
            .map(|i| {
                format!(
                    "«{}» intento {} (epoch {}): {}",
                    i.paso, i.intento, i.hora_epoch, i.error
                )
            })
            .collect::<Vec<_>>()
            .join(" · ")
    }

    /// La política compartida de los dos corredores: si el error NO es de
    /// desconexión, no se registra ni se reintenta (false). Si lo es, el
    /// intento queda asentado en el registro de etapas y en el
    /// estructurado, y devuelve si queda otro intento.
    fn asentar_fallo(&mut self, paso: &str, intento: u32, error: &str) -> bool {
        if !es_desconexion(error) {
            return false;
        }
        let hora_epoch = ahora_epoch();
        self.registro.push(IntentoFallido {
            paso: paso.to_string(),
            intento,
            error: error.to_string(),
            hora_epoch,
        });
        stage(&format!(
            "[supervisor] paso «{}» — intento {}/{} caído por DESCONEXIÓN USB: {} (registrado, epoch {})",
            paso, intento, self.max_intentos, error, hora_epoch
        ));
        intento < self.max_intentos
    }

    /// El cierre: el error intacto si no fue desconexión; si lo fue y se
    /// agotaron los intentos, el fallo honesto con el registro completo.
    fn cierre(&self, paso: &str, ultimo_error: &str) -> String {
        if es_desconexion(ultimo_error) {
            format!(
                "el paso «{}» cayó por desconexión USB y el supervisor agotó sus {} intentos — el iPhone no volvió al bus (o el cable siguió cayendo). Registro de intentos: {}",
                paso,
                self.max_intentos,
                self.resumen_registro()
            )
        } else {
            ultimo_error.to_string()
        }
    }

    /// Corre una preparación SÍNCRONA con reintentos ante desconexión
    /// (la apertura del transporte de la cadena: cada intento ES una
    /// preparación desde cero, así que no hay nada más que re-preparar).
    pub fn preparar<T, F>(&mut self, paso: &str, mut f: F) -> Result<T, String>
    where
        F: FnMut() -> Result<T, String>,
    {
        let mut intento = 0u32;
        loop {
            intento += 1;
            match f() {
                Ok(v) => {
                    if intento > 1 {
                        stage(&format!(
                            "[supervisor] paso «{}» PROSPERÓ en el intento {}",
                            paso, intento
                        ));
                    }
                    return Ok(v);
                }
                Err(e) => {
                    if !self.asentar_fallo(paso, intento, &e) {
                        return Err(self.cierre(paso, &e));
                    }
                    stage(&format!(
                        "[supervisor] pausa de {} ms pa que el iPhone vuelva al bus y re-preparación desde cero…",
                        self.pausa.as_millis()
                    ));
                    std::thread::sleep(self.pausa);
                }
            }
        }
    }

    /// Corre un PASO de la cadena con la supervisión completa: si cae por
    /// desconexión, pausa → **re-preparación del transporte desde cero**
    /// (el `repreparar` de la cadena: transporte nuevo + sesión mux
    /// fresca, que SUSTITUYE al proveedor) → el paso se reintenta sobre
    /// el proveedor nuevo. Una re-preparación que también cae cuenta como
    /// el intento que consume (queda registrada igual). El paso recibe un
    /// clon del proveedor vigente en cada intento (el handle de la cadena
    /// es clonable; el paso trabaja sobre la sesión que toque).
    pub async fn ejecutar<P, T, F, Fut, R>(
        &mut self,
        paso: &str,
        provider: &mut P,
        repreparar: &mut R,
        mut paso_fn: F,
    ) -> Result<T, String>
    where
        P: Clone,
        F: FnMut(P) -> Fut,
        Fut: Future<Output = Result<T, String>>,
        R: FnMut() -> Result<P, String> + ?Sized,
    {
        let mut intento = 0u32;
        let mut repreparar_pendiente = false;
        loop {
            intento += 1;
            if repreparar_pendiente {
                repreparar_pendiente = false;
                match repreparar() {
                    Ok(nuevo) => {
                        *provider = nuevo;
                        stage(&format!(
                            "[supervisor] transporte re-preparado desde cero — sesión mux fresca lista pa el intento {} de «{}»",
                            intento, paso
                        ));
                    }
                    Err(e) => {
                        if !self.asentar_fallo(paso, intento, &e) {
                            return Err(self.cierre(paso, &e));
                        }
                        repreparar_pendiente = true;
                        tokio::time::sleep(self.pausa).await;
                        continue;
                    }
                }
            }
            match paso_fn(provider.clone()).await {
                Ok(v) => {
                    if intento > 1 {
                        stage(&format!(
                            "[supervisor] paso «{}» PROSPERÓ en el intento {}",
                            paso, intento
                        ));
                    }
                    return Ok(v);
                }
                Err(e) => {
                    if !self.asentar_fallo(paso, intento, &e) {
                        return Err(self.cierre(paso, &e));
                    }
                    repreparar_pendiente = true;
                    stage(&format!(
                        "[supervisor] pausa de {} ms pa que el iPhone vuelva al bus y re-preparación desde cero…",
                        self.pausa.as_millis()
                    ));
                    tokio::time::sleep(self.pausa).await;
                }
            }
        }
    }
}

// ── Bancos ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;

    const ENODEV_OUT: &str = "bulk OUT: No such device (os error 19) (errno 19)";
    const ENODEV_IN: &str = "bulk IN: No such device (os error 19) (errno 19)";

    fn runtime() -> tokio::runtime::Runtime {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime del banco")
    }

    /// La clasificación: la firma del ENODEV, en sus formas reales de la
    /// pila (bulk OUT, bulk IN, y envuelta en los mensajes de la cadena).
    #[test]
    fn clasifica_la_desconexion_en_sus_formas_reales() {
        assert!(es_desconexion(ENODEV_OUT));
        assert!(es_desconexion(ENODEV_IN));
        assert!(es_desconexion(
            "el iPhone no abrió el servicio: negociando la sesión lockdown: enviando el StartSession: bulk OUT: No such device (os error 19) (errno 19)"
        ));
        assert!(es_desconexion("No such device (os error 19)"));
    }

    /// Y lo que NO es desconexión jamás se reintenta: la negativa de
    /// Apple, el EOF del TLS, el RST del mux, el timeout, el hilo muerto.
    #[test]
    fn no_clasifica_lo_que_no_es_desconexion() {
        for e in [
            "PasswordProtected",
            "tls handshake eof",
            "mux TCP RST abriendo el puerto 62078 (¿servicio no disponible?)",
            "sin datos (timeout simulado)",
            "bulk IN devolvió 0 bytes",
            "el hilo de la cadena no responde",
            "Apple se negó a abrir la sesión lockdown: InvalidHostID",
            "",
        ] {
            assert!(!es_desconexion(e), "no debía clasificar: {:?}", e);
        }
    }

    /// preparar: la desconexión persistente agota en EXACTAMENTE
    /// MAX_INTENTOS llamadas, cada una registrada con su número.
    #[test]
    fn preparar_agota_en_el_tope_y_registra_cada_intento() {
        let mut sup = Supervisor::de_banco();
        let llamadas = Arc::new(AtomicU32::new(0));
        let l = llamadas.clone();
        let r: Result<(), String> = sup.preparar("conexion", move || {
            l.fetch_add(1, Ordering::SeqCst);
            Err(ENODEV_OUT.to_string())
        });
        assert_eq!(llamadas.load(Ordering::SeqCst), MAX_INTENTOS);
        assert_eq!(sup.registro().len(), MAX_INTENTOS as usize);
        for (n, intento) in sup.registro().iter().enumerate() {
            assert_eq!(intento.paso, "conexion");
            assert_eq!(intento.intento, n as u32 + 1);
            assert_eq!(intento.error, ENODEV_OUT);
            assert!(intento.hora_epoch > 0);
        }
        let err = r.unwrap_err();
        assert!(err.contains("agotó"), "el cierre es honesto: {}", err);
        assert!(err.contains("conexion"), "el cierre nombra el paso: {}", err);
    }

    /// preparar: un error que no es desconexión pasa TAL CUAL, sin un
    /// solo reintento y sin tocar el registro.
    #[test]
    fn preparar_error_ajeno_pasa_tal_cual_sin_reintentar() {
        let mut sup = Supervisor::de_banco();
        let llamadas = Arc::new(AtomicU32::new(0));
        let l = llamadas.clone();
        let r: Result<(), String> = sup.preparar("conexion", move || {
            l.fetch_add(1, Ordering::SeqCst);
            Err("PasswordProtected".to_string())
        });
        assert_eq!(r.unwrap_err(), "PasswordProtected");
        assert_eq!(llamadas.load(Ordering::SeqCst), 1);
        assert!(sup.registro().is_empty());
    }

    /// preparar: una caída y a la segunda prospera — un solo registro.
    #[test]
    fn preparar_prospera_tras_una_caida() {
        let mut sup = Supervisor::de_banco();
        let llamadas = Arc::new(AtomicU32::new(0));
        let l = llamadas.clone();
        let r = sup.preparar("conexion", move || {
            if l.fetch_add(1, Ordering::SeqCst) == 0 {
                Err(ENODEV_IN.to_string())
            } else {
                Ok(42)
            }
        });
        assert_eq!(r, Ok(42));
        assert_eq!(sup.registro().len(), 1);
        assert_eq!(sup.registro()[0].intento, 1);
    }

    /// ejecutar: el paso cae por desconexión → el transporte se
    /// re-prepara (el proveedor CAMBIA de generación) → el paso se
    /// reintenta sobre el proveedor nuevo y prospera.
    #[test]
    fn ejecutar_reprepara_y_el_paso_prospera_sobre_el_transporte_nuevo() {
        let rt = runtime();
        rt.block_on(async {
            let mut sup = Supervisor::de_banco();
            let mut provider: u32 = 1; // la «generación» del transporte
            let generaciones_vistas = Arc::new(std::sync::Mutex::new(Vec::new()));
            let v = generaciones_vistas.clone();
            let mut repreparar = || -> Result<u32, String> { Ok(2) };
            let r = sup
                .ejecutar(
                    "sonda",
                    &mut provider,
                    &mut repreparar,
                    move |prov: u32| {
                        let v = v.clone();
                        async move {
                            v.lock().unwrap().push(prov);
                            if prov == 1 {
                                Err(ENODEV_OUT.to_string())
                            } else {
                                Ok("canal sano")
                            }
                        }
                    },
                )
                .await;
            assert_eq!(r, Ok("canal sano"));
            assert_eq!(provider, 2, "el proveedor quedó sustituido");
            assert_eq!(*generaciones_vistas.lock().unwrap(), vec![1, 2]);
            assert_eq!(sup.registro().len(), 1);
            assert_eq!(sup.registro()[0].paso, "sonda");
        });
    }

    /// ejecutar: desconexión persistente — el paso corre MAX_INTENTOS
    /// veces, la re-preparación corre entre intentos (MAX−1), y el error
    /// final trae el registro completo.
    #[test]
    fn ejecutar_agota_con_el_registro_completo() {
        let rt = runtime();
        rt.block_on(async {
            let mut sup = Supervisor::de_banco();
            let mut provider: u32 = 0;
            let pasos = Arc::new(AtomicU32::new(0));
            let repreparaciones = Arc::new(AtomicU32::new(0));
            let p = pasos.clone();
            let rp = repreparaciones.clone();
            let mut repreparar = move || -> Result<u32, String> {
                Ok(rp.fetch_add(1, Ordering::SeqCst) + 1)
            };
            let r: Result<(), String> = sup
                .ejecutar(
                    "instalacion",
                    &mut provider,
                    &mut repreparar,
                    move |_prov: u32| {
                        let p = p.clone();
                        async move {
                            p.fetch_add(1, Ordering::SeqCst);
                            Err(ENODEV_IN.to_string())
                        }
                    },
                )
                .await;
            assert_eq!(pasos.load(Ordering::SeqCst), MAX_INTENTOS);
            assert_eq!(
                repreparaciones.load(Ordering::SeqCst),
                MAX_INTENTOS - 1,
                "se re-prepara entre intentos, no tras el último"
            );
            assert_eq!(sup.registro().len(), MAX_INTENTOS as usize);
            let err = r.unwrap_err();
            assert!(err.contains("instalacion"), "nombra el paso: {}", err);
            assert!(err.contains("agotó"), "honesto: {}", err);
            assert!(
                err.contains("intento 1") && err.contains("intento 3"),
                "trae el registro completo: {}",
                err
            );
        });
    }

    /// ejecutar: si la RE-PREPARACIÓN también cae (el iPhone no volvió),
    /// cada caída cuenta como su intento — el paso no corre sobre un
    /// transporte muerto y el tope se respeta igual.
    #[test]
    fn ejecutar_repreparacion_caida_cuenta_como_intento() {
        let rt = runtime();
        rt.block_on(async {
            let mut sup = Supervisor::de_banco();
            let mut provider: u32 = 1;
            let pasos = Arc::new(AtomicU32::new(0));
            let p = pasos.clone();
            let mut repreparar = || -> Result<u32, String> { Err(ENODEV_OUT.to_string()) };
            let r: Result<(), String> = sup
                .ejecutar(
                    "sonda",
                    &mut provider,
                    &mut repreparar,
                    move |_prov: u32| {
                        let p = p.clone();
                        async move {
                            p.fetch_add(1, Ordering::SeqCst);
                            Err(ENODEV_OUT.to_string())
                        }
                    },
                )
                .await;
            assert_eq!(
                pasos.load(Ordering::SeqCst),
                1,
                "el paso solo corrió con el transporte inicial"
            );
            assert_eq!(
                sup.registro().len(),
                MAX_INTENTOS as usize,
                "1 del paso + 2 de la re-preparación = el tope"
            );
            assert!(r.unwrap_err().contains("agotó"));
        });
    }

    /// ejecutar: un error que no es desconexión NO toca el transporte —
    /// ni un reintento, ni una re-preparación, el error intacto.
    #[test]
    fn ejecutar_error_ajeno_no_toca_el_transporte() {
        let rt = runtime();
        rt.block_on(async {
            let mut sup = Supervisor::de_banco();
            let mut provider: u32 = 1;
            let repreparaciones = Arc::new(AtomicU32::new(0));
            let rp = repreparaciones.clone();
            let mut repreparar = move || -> Result<u32, String> {
                rp.fetch_add(1, Ordering::SeqCst);
                Ok(9)
            };
            let r: Result<(), String> = sup
                .ejecutar(
                    "sonda",
                    &mut provider,
                    &mut repreparar,
                    |_prov: u32| async { Err("PasswordProtected".to_string()) },
                )
                .await;
            assert_eq!(r.unwrap_err(), "PasswordProtected");
            assert_eq!(repreparaciones.load(Ordering::SeqCst), 0);
            assert_eq!(provider, 1, "el proveedor no se tocó");
            assert!(sup.registro().is_empty());
        });
    }
}

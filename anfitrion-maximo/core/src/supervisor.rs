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
//! **v2.7 — el orden del rescate**: en la v2.6, la re-preparación
//! reclamaba el transporte NUEVO por el mismo fd y DESPUÉS sustituía al
//! proveedor — la caída del viejo liberaba la interfaz compartida y
//! tumbaba el claim recién hecho (el error 19 de la v2.5, resucitado
//! por el propio rescate; fallo 1 de la revisión de diff). Desde la
//! v2.7 el proveedor es `ProveedorRetirable` y `ejecutar` RETIRA el
//! viejo (su transporte cae de forma SÍNCRONA, con acuse) ANTES de
//! re-preparar: liberar primero, reclamar después, nunca al revés.
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

/// **Un proveedor cuyo transporte puede retirarse (v2.7).** El retiro es
/// SÍNCRONO y COMPLETO: cuando `retirar()` devuelve, el transporte viejo
/// ya soltó la interfaz USB sobre el fd compartido y su hilo murió — no
/// queda ninguna liberación pendiente que pueda caer después. Es la
/// propiedad que la re-preparación necesita: sobre un fd compartido, la
/// liberación del transporte viejo (RELEASEINTERFACE) tumba TAMBIÉN el
/// claim que el transporte nuevo acaba de hacer por el mismo fd, así que
/// el orden no es negociable: **retirar el viejo → reclamar el nuevo**.
/// Hasta la v2.6 el supervisor sustituía el proveedor soltando el viejo
/// a su aire (su liberación llegaba cuando el último clon del handle
/// cayera), y esa liberación tardía era capaz de tumbar el claim nuevo:
/// el error 19 de la v2.5 resucitado por el propio rescate (revisión de
/// diff sobre la v2.6). `retirar()` debe ser idempotente: retirar dos
/// veces — o retirar un cascarón ya retirado — no libera dos veces.
pub trait ProveedorRetirable {
    fn retirar(&mut self);
}

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
    pub(crate) fn de_banco() -> Self {
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
    /// desconexión, pausa → **retiro síncrono del proveedor viejo**
    /// (`ProveedorRetirable::retirar` — su transporte libera la interfaz
    /// del fd compartido y su hilo muere en el acto, v2.7) →
    /// **re-preparación del transporte desde cero** (el `repreparar` de
    /// la cadena: transporte nuevo + sesión mux fresca, que SUSTITUYE al
    /// proveedor ya retirado) → el paso se reintenta sobre el proveedor
    /// nuevo. Una re-preparación que también cae cuenta como el intento
    /// que consume (queda registrada igual). El paso recibe un clon del
    /// proveedor vigente en cada intento (el handle de la cadena es
    /// clonable; el paso trabaja sobre la sesión que toque).
    pub async fn ejecutar<P, T, F, Fut, R>(
        &mut self,
        paso: &str,
        provider: &mut P,
        repreparar: &mut R,
        mut paso_fn: F,
    ) -> Result<T, String>
    where
        P: Clone + ProveedorRetirable,
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
                // **EL ORDEN QUE LA v2.7 FIJA (fallo 1 de la revisión de
                // diff sobre la v2.6)**: ANTES de re-preparar, el
                // proveedor viejo se RETIRA de forma síncrona — su
                // transporte suelta la interfaz sobre el fd compartido y
                // su hilo muere aquí, no cuando caiga el último clon. La
                // re-preparación reclama la interfaz por el MISMO fd: si
                // la liberación del viejo llegara después de ese claim
                // (como pasaba al sustituir el proveedor soltándolo a su
                // aire), el RELEASEINTERFACE tumbaría el claim nuevo y el
                // paso reintentado moriría con el mismo error 19 que se
                // intentaba rescatar. Tras el retiro, sustituir el
                // proveedor solo suelta un cascarón inerte.
                provider.retirar();
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

    /// Los proveedores numéricos de los bancos clásicos no tienen
    /// transporte que retirar: el retiro es un no-op pa ellos.
    impl ProveedorRetirable for u32 {
        fn retirar(&mut self) {}
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

    // ── Banco v2.7: el claim del transporte nuevo sobrevive a la
    //    sustitución (el fallo 1 de la revisión de diff sobre la v2.6) ──

    /// El fd compartido, modelado con la semántica real de usbdevfs: el
    /// claim es DEL FD (no de la «generación» que lo pidió) y un
    /// RELEASEINTERFACE sobre ese fd lo tumba entero, lo haya hecho
    /// quien lo haya hecho. Cada evento queda en el diario, en orden.
    #[derive(Clone)]
    struct FdSim(std::sync::Arc<std::sync::Mutex<FdSimEstado>>);

    struct FdSimEstado {
        claim: Option<u32>,
        eventos: Vec<String>,
    }

    impl FdSim {
        fn nuevo() -> Self {
            Self(std::sync::Arc::new(std::sync::Mutex::new(FdSimEstado {
                claim: None,
                eventos: Vec::new(),
            })))
        }
        /// Lo que `open_mux_transport` hace al preparar: reclamar la
        /// interfaz por el fd.
        fn reclamar(&self, gen: u32) {
            let mut e = self.0.lock().unwrap();
            e.claim = Some(gen);
            e.eventos.push(format!("claim:{}", gen));
        }
        /// Lo que el Drop de un transporte hace al caer: RELEASEINTERFACE
        /// sobre el fd — tumba EL claim, sea de quien sea.
        fn soltar(&self) {
            let mut e = self.0.lock().unwrap();
            e.claim = None;
            e.eventos.push("soltar".to_string());
        }
        fn usable(&self, gen: u32) -> bool {
            self.0.lock().unwrap().claim == Some(gen)
        }
        fn eventos(&self) -> Vec<String> {
            self.0.lock().unwrap().eventos.clone()
        }
    }

    /// La sesión simulada: UNA por generación, compartida por todos los
    /// clones del proveedor — espejo del handle real, donde la sesión
    /// (y su transporte) vive en su hilo mientras quede UN clon del
    /// handle, y el transporte solo se libera cuando el hilo muere: al
    /// caer el último clon, o al apagado síncrono del retiro.
    struct SesionSim {
        gen: u32,
        fd: FdSim,
        retirada: std::sync::atomic::AtomicBool,
    }

    impl Drop for SesionSim {
        fn drop(&mut self) {
            // El hilo de la sesión murió (cayó el último clon): su
            // transporte se libera — salvo que el retiro ya lo liberó.
            if !self.retirada.load(Ordering::SeqCst) {
                self.fd.soltar();
            }
        }
    }

    /// El proveedor de banco: un handle clonable a su sesión, como el
    /// real. `retirar()` apaga la sesión en el acto (libera el fd y la
    /// marca retirada: el cascarón que quede no libera dos veces).
    #[derive(Clone)]
    struct ProvSim {
        sesion: std::sync::Arc<SesionSim>,
    }

    impl ProvSim {
        fn nuevo(gen: u32, fd: FdSim) -> Self {
            fd.reclamar(gen);
            Self {
                sesion: std::sync::Arc::new(SesionSim {
                    gen,
                    fd,
                    retirada: std::sync::atomic::AtomicBool::new(false),
                }),
            }
        }
        fn gen(&self) -> u32 {
            self.sesion.gen
        }
    }

    impl ProveedorRetirable for ProvSim {
        fn retirar(&mut self) {
            if !self.sesion.retirada.swap(true, Ordering::SeqCst) {
                self.sesion.fd.soltar();
            }
        }
    }

    /// El paso simulado, con la MISMA forma que los pasos reales de
    /// `signinstall`: recibe el proveedor por referencia dentro del
    /// futuro (el futuro es dueño del valor mientras corre) y trabaja
    /// sobre su sesión. Si el claim de su generación cayó, el cable
    /// responde con la firma real del fallo: el error 19.
    async fn paso_simulado(prov: &ProvSim, fd: &FdSim) -> Result<&'static str, String> {
        if !fd.usable(prov.gen()) {
            return Err(ENODEV_OUT.to_string());
        }
        if prov.gen() == 1 {
            Err(ENODEV_OUT.to_string())
        } else {
            Ok("instalado")
        }
    }

    /// **El camino que falló en la v2.5, resucitado por el rescate en la
    /// v2.6**: el paso cae por ENODEV → el supervisor re-prepara (el
    /// transporte nuevo reclama el fd) → al sustituir el proveedor, el
    /// viejo cae y su liberación tumba el claim NUEVO → el paso
    /// reintentado muere con el mismo error 19. Con el retiro ordenado
    /// de la v2.7 (retirar el viejo ANTES de re-preparar), la liberación
    /// precede al claim nuevo y el paso prospera sobre la sesión nueva.
    #[test]
    fn ejecutar_el_claim_nuevo_sobrevive_a_la_sustitucion() {
        let rt = runtime();
        rt.block_on(async {
            let mut sup = Supervisor::de_banco();
            let fd = FdSim::nuevo();
            let mut provider = ProvSim::nuevo(1, fd.clone());
            let fd_rep = fd.clone();
            let mut repreparar = move || -> Result<ProvSim, String> {
                // preparar_proveedor: el transporte nuevo reclama el fd
                // al prepararse, antes de sustituir al proveedor.
                Ok(ProvSim::nuevo(2, fd_rep.clone()))
            };
            let fd_paso = fd.clone();
            let r = sup
                .ejecutar(
                    "instalacion",
                    &mut provider,
                    &mut repreparar,
                    move |prov: ProvSim| {
                        let fd = fd_paso.clone();
                        async move { paso_simulado(&prov, &fd).await }
                    },
                )
                .await;
            assert_eq!(
                r,
                Ok("instalado"),
                "el paso prospera sobre el transporte nuevo (registro del supervisor: {:?})",
                sup.resumen_registro()
            );
            assert_eq!(provider.gen(), 2, "el proveedor vigente es el nuevo");
            assert!(
                fd.usable(2),
                "el claim del transporte nuevo sigue en pie tras la sustitución: {:?}",
                fd.eventos()
            );
            // Y el orden en el diario es el orden seguro: la liberación
            // del viejo precede al claim del nuevo.
            let ev = fd.eventos();
            let i_soltar = ev.iter().position(|e| e == "soltar").unwrap();
            let i_claim2 = ev.iter().position(|e| e == "claim:2").unwrap();
            assert!(
                i_soltar < i_claim2,
                "liberar el viejo ANTES de reclamar el nuevo: {:?}",
                ev
            );
        });
    }

    /// ejecutar: retirar es idempotente — un proveedor retirado y luego
    /// soltado libera el fd UNA sola vez (sin el guard, el Drop del
    /// cascarón liberaría dos veces y la segunda tumbaría… lo que haya).
    #[test]
    fn retirar_es_idempotente_y_el_cascaron_no_libera_dos_veces() {
        let fd = FdSim::nuevo();
        {
            let mut p = ProvSim::nuevo(1, fd.clone());
            p.retirar();
            p.retirar();
        } // aquí cae el cascarón retirado
        let liberaciones = fd
            .eventos()
            .iter()
            .filter(|e| *e == "soltar")
            .count();
        assert_eq!(
            liberaciones, 1,
            "una sola liberación entre el retiro y la caída: {:?}",
            fd.eventos()
        );
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

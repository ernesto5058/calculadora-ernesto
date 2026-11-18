//! `AnfitrionProvider`: el `IdeviceProvider` de la pila `idevice` apoyado en
//! la **sesión mux fresca de la cadena** (`cadena.rs`, v2.4) y en el
//! registro de pairing guardado en la bóveda.
//!
//! Cada `connect(port)` abre una pseudo-TCP nueva en la sesión de la cadena
//! y la envuelve en el puente sync→async de `cadena.rs`;
//! `get_pairing_file()` re-parsea el registro de la bóveda en cada llamada
//! (barato y siempre consistente).
//!
//! Hasta la v2.3 el respaldo era el hub — y abrir servicios sobre su sesión
//! reutilizada es exactamente el fallo que la v2.4 cierra (ver `cadena.rs`):
//! el hub queda solo pa detección/latido y jamás transporta la cadena.

use std::future::Future;
use std::pin::Pin;

use idevice::pairing_file::PairingFile;
use idevice::provider::IdeviceProvider;
use idevice::{Idevice, IdeviceError};

use crate::cadena::CadenaHandle;

/// Clonable pa el supervisor (v2.6): el paso supervisado recibe un clon
/// del handle vigente en cada intento; si el supervisor re-prepara el
/// transporte, el proveedor del paso siguiente es el de la sesión nueva.
#[derive(Clone)]
pub struct AnfitrionProvider {
    cadena: CadenaHandle,
    pairing_bytes: Vec<u8>,
    label: String,
    /// v2.7: la sesión de ESTE proveedor ya fue retirada (apagado
    /// síncrono hecho). Los clones anteriores al retiro conservan su
    /// copia en falso, pero su handle apunta a un hilo ya muerto: abrir
    /// por ellos falla en seco («el hilo de la cadena no responde»),
    /// jamás toca el cable — son cascarones, no sesiones.
    retirado: bool,
}

impl std::fmt::Debug for AnfitrionProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AnfitrionProvider")
            .field("label", &self.label)
            .finish()
    }
}

impl AnfitrionProvider {
    pub fn new(cadena: CadenaHandle, pairing_bytes: Vec<u8>) -> Self {
        Self {
            cadena,
            pairing_bytes,
            label: "anfitrion-maximo".to_string(),
            retirado: false,
        }
    }
}

/// **El retiro ordenado (v2.7)**: apaga la sesión de la cadena de forma
/// síncrona — cuando devuelve, el hilo de la sesión murió y la interfaz
/// USB quedó liberada sobre el fd compartido. El supervisor lo corre
/// ANTES de re-preparar: sobre el fd compartido, liberar DESPUÉS de que
/// el transporte nuevo reclamara tumbaría el claim nuevo (el fallo 1 de
/// la revisión de diff sobre la v2.6). Idempotente: un proveedor ya
/// retirado no vuelve a liberar.
impl crate::supervisor::ProveedorRetirable for AnfitrionProvider {
    fn retirar(&mut self) {
        if self.retirado {
            return;
        }
        self.retirado = true;
        match self.cadena.apagar() {
            Ok(()) => crate::stage(
                "[supervisor] transporte anterior retirado: su sesión se apagó y la interfaz quedó liberada ANTES de re-preparar",
            ),
            Err(e) => crate::stage(&format!(
                "[supervisor] aviso — el transporte anterior no confirmó su apagado ({}); su hilo ya no respondía, nada vivo que liberar",
                e
            )),
        }
    }
}

impl IdeviceProvider for AnfitrionProvider {
    fn connect(
        &self,
        port: u16,
    ) -> Pin<Box<dyn Future<Output = Result<Idevice, IdeviceError>> + Send>> {
        let cadena = self.cadena.clone();
        let label = self.label.clone();
        Box::pin(async move {
            let id = cadena
                .open(port)
                .await
                .map_err(|e| IdeviceError::InternalError(e))?;
            let stream = cadena.stream(id);
            Ok(Idevice::new(Box::new(stream), label))
        })
    }

    fn label(&self) -> &str {
        &self.label
    }

    fn get_pairing_file(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<PairingFile, IdeviceError>> + Send>> {
        let bytes = self.pairing_bytes.clone();
        Box::pin(async move {
            PairingFile::from_bytes(&bytes).map_err(|e| {
                IdeviceError::InternalError(format!(
                    "el registro de pairing de la bóveda no se pudo interpretar: {}",
                    e
                ))
            })
        })
    }
}

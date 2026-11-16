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

pub struct AnfitrionProvider {
    cadena: CadenaHandle,
    pairing_bytes: Vec<u8>,
    label: String,
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

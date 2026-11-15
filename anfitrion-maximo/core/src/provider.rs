//! `AnfitrionProvider`: el `IdeviceProvider` de la pila `idevice` apoyado en
//! NUESTRO hub mux (el cable y la sesión son de la app desde la v1) y en el
//! registro de pairing guardado en la bóveda.
//!
//! Cada `connect(port)` abre una pseudo-TCP nueva en el hub y la envuelve en
//! el puente sync→async de `hub.rs`; `get_pairing_file()` re-parsea el
//! registro de la bóveda en cada llamada (barato y siempre consistente).

use std::future::Future;
use std::pin::Pin;

use idevice::pairing_file::PairingFile;
use idevice::provider::IdeviceProvider;
use idevice::{Idevice, IdeviceError};

use crate::hub::HubHandle;

pub struct AnfitrionProvider {
    hub: HubHandle,
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
    pub fn new(hub: HubHandle, pairing_bytes: Vec<u8>) -> Self {
        Self {
            hub,
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
        let hub = self.hub.clone();
        let label = self.label.clone();
        Box::pin(async move {
            let id = hub
                .open(port)
                .await
                .map_err(|e| IdeviceError::InternalError(e))?;
            let stream = hub.stream(id);
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

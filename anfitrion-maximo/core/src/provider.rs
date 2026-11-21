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

/// El estado de retirada de la sesión de ESTE proveedor (v2.8):
/// **solicitado/en-curso ≠ confirmado**. Hasta la v2.7 un `bool` se
/// marcaba ANTES de conocer el resultado del apagado — un fallo quedaba
/// convertido en «retirado» y las llamadas siguientes ni lo intentaban.
/// Desde la v2.8: solo una retirada CONFIRMADA da `Ok` inmediato; una
/// FALLIDA devuelve su fallo registrado, con su causa, en cada llamada
/// posterior — jamás un éxito implícito por el flag de solicitado.
#[derive(Clone)]
enum EstadoRetiro {
    /// Nadie ha pedido la retirada todavía.
    Vigente,
    /// La retirada se confirmó: el cierre explícito del transporte
    /// devolvió `Ok` y su resultado quedó registrado en la cadena.
    Confirmada,
    /// La retirada se pidió y NO quedó confirmada: se conserva la
    /// causa exacta del fallo.
    Fallida(String),
}

/// Clonable pa el supervisor (v2.6): el paso supervisado recibe un clon
/// del handle vigente en cada intento; si el supervisor re-prepara el
/// transporte, el proveedor del paso siguiente es el de la sesión nueva.
#[derive(Clone)]
pub struct AnfitrionProvider {
    cadena: CadenaHandle,
    pairing_bytes: Vec<u8>,
    label: String,
    /// Los clones anteriores al retiro conservan su copia en `Vigente`,
    /// pero la operación de retirada es ÚNICA y vive en el handle
    /// compartido de la cadena: si un clon pide retirar tras la
    /// retirada, `apagar()` le devuelve el resultado ya publicado —
    /// jamás toca el cable dos veces ni inventa un éxito propio. Un
    /// proveedor retirado es un cascarón: abrir por él falla en seco
    /// («el hilo de la cadena no responde»), nunca toca el cable.
    estado_retiro: EstadoRetiro,
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
            estado_retiro: EstadoRetiro::Vigente,
        }
    }
}

/// **El retiro ordenado y CONFIRMADO (v2.7 el orden, v2.8 la
/// confirmación)**: apaga la sesión de la cadena — cuando devuelve
/// `Ok`, el cierre explícito del transporte acreditó la liberación de
/// la interfaz sobre el fd compartido. El supervisor lo corre ANTES de
/// re-preparar: sobre el fd compartido, liberar DESPUÉS de que el
/// transporte nuevo reclamara tumbaría el claim nuevo (el fallo 1 de la
/// revisión de diff sobre la v2.6). Si el apagado no queda confirmado,
/// el `Err` SUBE con su causa exacta (hasta la v2.7 se anotaba un aviso
/// — con una inferencia que el error no probaba — y la re-preparación
/// seguía igual): sin retirada confirmada no hay re-preparación.
/// Idempotente con honestidad: un proveedor ya retirado (confirmado)
/// no vuelve a liberar; uno cuya retirada falló devuelve el fallo
/// registrado, no un éxito por el flag.
impl crate::supervisor::ProveedorRetirable for AnfitrionProvider {
    fn retirar(&mut self) -> Result<(), String> {
        match &self.estado_retiro {
            EstadoRetiro::Confirmada => return Ok(()),
            EstadoRetiro::Fallida(causa) => return Err(causa.clone()),
            EstadoRetiro::Vigente => {}
        }
        match self.cadena.apagar() {
            Ok(()) => {
                self.estado_retiro = EstadoRetiro::Confirmada;
                crate::stage(
                    "[supervisor] transporte anterior retirado: el cierre de su sesión quedó confirmado y la liberación de la interfaz verificada ANTES de re-preparar",
                );
                Ok(())
            }
            Err(e) => {
                self.estado_retiro = EstadoRetiro::Fallida(e.clone());
                crate::stage(&format!(
                    "[supervisor] la retirada del transporte anterior NO quedó confirmada: {}",
                    e
                ));
                Err(e)
            }
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

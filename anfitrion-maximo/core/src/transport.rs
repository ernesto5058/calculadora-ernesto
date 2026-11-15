//! Transporte USB sobre un **file descriptor de Android** (`UsbDeviceConnection.getFileDescriptor()`)
//! usando ioctls **usbdevfs** directamente — sin libusb, sin demonio, sin root.
//!
//! Kotlin es dueño del permiso y de la apertura del dispositivo; este módulo es dueño del
//! protocolo: descriptores por transferencia de control, SET_CONFIGURATION, CLAIMINTERFACE,
//! CLEAR_HALT, SETINTERFACE y el tráfico bulk del mux.
//!
//! Cada paso devuelve su error con la etapa etiquetada: esta app es también la sonda de
//! diagnóstico del puente fd→mux (el paso de configuración/claim es donde murió el intento
//! de Termux con `LIBUSB_ERROR_BUSY`).

use std::io;
use std::os::unix::io::RawFd;

use idevice_usb_core::{BulkTransport, Endpoints};

// ---- usbdevfs ioctl numbers (linux/usbdevice_fs.h) ----
// El parámetro `request` de ioctl es c_ulong en glibc pero c_int en Bionic
// (Android): alias por plataforma y constantes con el mismo patrón de bits.
#[cfg(target_os = "android")]
type IoctlRequest = libc::c_int;
#[cfg(not(target_os = "android"))]
type IoctlRequest = libc::c_ulong;

const USBDEVFS_CONTROL: IoctlRequest = 0xC018_5500u32 as IoctlRequest; // _IOWR('U', 0, 24)
const USBDEVFS_BULK: IoctlRequest = 0xC018_5502u32 as IoctlRequest; // _IOWR('U', 2, 24)
const USBDEVFS_SETCONFIGURATION: IoctlRequest = 0x8004_5505u32 as IoctlRequest; // _IOR('U', 5, 4)
const USBDEVFS_SETINTERFACE: IoctlRequest = 0x8008_5504u32 as IoctlRequest; // _IOR('U', 4, 8)
const USBDEVFS_CLAIMINTERFACE: IoctlRequest = 0x8004_550Fu32 as IoctlRequest; // _IOR('U', 15, 4)
const USBDEVFS_RELEASEINTERFACE: IoctlRequest = 0x8004_5510u32 as IoctlRequest; // _IOR('U', 16, 4)

/// usbfs históricamente limita una transferencia bulk a 16 KiB por ioctl en varios kernels
/// (incluidos kernels Android): partimos todo en trozos de ese tamaño, como hace libusb.
const BULK_CHUNK: usize = 16384;
const IO_TIMEOUT_MS: u32 = 5000;

#[repr(C)]
struct CtrlTransfer {
    b_request_type: u8,
    b_request: u8,
    w_value: u16,
    w_index: u16,
    w_length: u16,
    timeout: u32,
    data: *mut libc::c_void,
}

#[repr(C)]
struct BulkTransfer {
    ep: u32,
    len: u32,
    timeout: u32,
    data: *mut libc::c_void,
}

#[repr(C)]
struct SetInterface {
    interface: u32,
    altsetting: u32,
}

fn ioctl(fd: RawFd, request: IoctlRequest, arg: *mut libc::c_void) -> Result<i32, String> {
    let rc = unsafe { libc::ioctl(fd, request, arg) };
    if rc < 0 {
        let e = io::Error::last_os_error();
        Err(format!("{} (errno {})", e, e.raw_os_error().unwrap_or(0)))
    } else {
        Ok(rc)
    }
}

/// Destino del mux encontrado en los descriptores del dispositivo.
#[derive(Clone, Copy, Debug)]
pub struct MuxTarget {
    pub config_value: u8,
    pub interface: u8,
    pub alt_setting: u8,
    pub ep_in_addr: u8,  // dirección completa (con bit 0x80)
    pub ep_out_addr: u8, // dirección completa
}

pub struct FdTransport {
    fd: RawFd,
    pub target: MuxTarget,
    claimed: bool,
}

impl FdTransport {
    /// Envuelve el fd (NO toma posesión: Android lo cierra).
    pub fn new(fd: RawFd, target: MuxTarget) -> Self {
        Self {
            fd,
            target,
            claimed: false,
        }
    }

    fn control(
        &self,
        b_request_type: u8,
        b_request: u8,
        w_value: u16,
        w_index: u16,
        data: &mut [u8],
        timeout_ms: u32,
    ) -> Result<usize, String> {
        let mut ct = CtrlTransfer {
            b_request_type,
            b_request,
            w_value: w_value.to_le(),
            w_index: w_index.to_le(),
            w_length: (data.len() as u16).to_le(),
            timeout: timeout_ms,
            data: data.as_mut_ptr() as *mut libc::c_void,
        };
        let rc = ioctl(
            self.fd,
            USBDEVFS_CONTROL,
            &mut ct as *mut CtrlTransfer as *mut libc::c_void,
        )?;
        Ok(rc as usize)
    }

    fn control_no_data(
        &self,
        b_request_type: u8,
        b_request: u8,
        w_value: u16,
        w_index: u16,
    ) -> Result<(), String> {
        let mut empty: [u8; 0] = [];
        let mut ct = CtrlTransfer {
            b_request_type,
            b_request,
            w_value: w_value.to_le(),
            w_index: w_index.to_le(),
            w_length: 0,
            timeout: IO_TIMEOUT_MS,
            data: empty.as_mut_ptr() as *mut libc::c_void,
        };
        ioctl(
            self.fd,
            USBDEVFS_CONTROL,
            &mut ct as *mut CtrlTransfer as *mut libc::c_void,
        )?;
        Ok(())
    }

    /// Configuración activa según el propio dispositivo (GET_CONFIGURATION, 0x08).
    pub fn active_configuration(&self) -> Result<u8, String> {
        let mut buf = [0u8; 1];
        let n = self.control(0x80, 0x08, 0, 0, &mut buf, IO_TIMEOUT_MS)?;
        if n < 1 {
            return Err("GET_CONFIGURATION devolvió 0 bytes".into());
        }
        Ok(buf[0])
    }

    /// Lee los descriptores por control y localiza la interfaz mux de Apple
    /// (clase 255 / subclase 254 con bulk IN+OUT) recorriendo TODAS las configuraciones.
    pub fn scan_mux_target(&self) -> Result<MuxTarget, String> {
        // Descriptor de dispositivo: nº de configuraciones en el byte 17.
        let mut dev = [0u8; 18];
        let n = self.control(0x80, 0x06, 0x0100, 0, &mut dev, IO_TIMEOUT_MS)?;
        if n < 18 {
            return Err(format!("descriptor de dispositivo corto ({} bytes)", n));
        }
        let num_configs = dev[17];
        for idx in 0..num_configs {
            // Cabecera de configuración (9 bytes) → longitud total.
            let mut head = [0u8; 9];
            let n = self.control(0x80, 0x06, 0x0200 | idx as u16, 0, &mut head, IO_TIMEOUT_MS)?;
            if n < 9 {
                continue;
            }
            let total = u16::from_le_bytes([head[2], head[3]]) as usize;
            let config_value = head[5];
            if total < 9 || total > 4096 {
                continue;
            }
            let mut blob = vec![0u8; total];
            let n = self.control(0x80, 0x06, 0x0200 | idx as u16, 0, &mut blob, IO_TIMEOUT_MS)?;
            blob.truncate(n);
            if let Some(t) = parse_config_for_mux(&blob, config_value) {
                return Ok(t);
            }
        }
        Err("ninguna configuración expone la interfaz mux de Apple (clase 255/subclase 254 con bulk IN+OUT)".into())
    }

    /// SET_CONFIGURATION vía usbdevfs — EL paso de riesgo (BUSY en Termux).
    pub fn set_configuration(&self, value: u8) -> Result<(), String> {
        let mut v = value as u32;
        ioctl(
            self.fd,
            USBDEVFS_SETCONFIGURATION,
            &mut v as *mut u32 as *mut libc::c_void,
        )
        .map(|_| ())
    }

    pub fn claim_interface(&mut self) -> Result<(), String> {
        let mut v = self.target.interface as u32;
        ioctl(
            self.fd,
            USBDEVFS_CLAIMINTERFACE,
            &mut v as *mut u32 as *mut libc::c_void,
        )?;
        self.claimed = true;
        Ok(())
    }

    pub fn release_interface(&mut self) {
        if self.claimed {
            let mut v = self.target.interface as u32;
            let _ = ioctl(
                self.fd,
                USBDEVFS_RELEASEINTERFACE,
                &mut v as *mut u32 as *mut libc::c_void,
            );
            self.claimed = false;
        }
    }

    /// CLEAR_FEATURE(ENDPOINT_HALT) en ambos extremos, como WebUSB `clearHalt`.
    pub fn clear_halts(&self) -> Result<(), String> {
        self.control_no_data(0x02, 0x01, 0, self.target.ep_out_addr as u16)?;
        self.control_no_data(0x02, 0x01, 0, self.target.ep_in_addr as u16)?;
        Ok(())
    }

    pub fn set_interface_alt(&self) -> Result<(), String> {
        let mut si = SetInterface {
            interface: self.target.interface as u32,
            altsetting: self.target.alt_setting as u32,
        };
        ioctl(
            self.fd,
            USBDEVFS_SETINTERFACE,
            &mut si as *mut SetInterface as *mut libc::c_void,
        )
        .map(|_| ())
    }

    pub fn endpoints(&self) -> Endpoints {
        Endpoints {
            ep_out: self.target.ep_out_addr & 0x0f,
            ep_in: self.target.ep_in_addr & 0x0f,
        }
    }
}

/// Recorre un blob de descriptor de configuración buscando la interfaz mux.
fn parse_config_for_mux(blob: &[u8], config_value: u8) -> Option<MuxTarget> {
    let mut i = 0usize;
    let mut cur_iface: Option<(u8, u8, u8, u8)> = None; // (número, alt, clase, subclase)
    let mut ep_in: Option<u8> = None;
    let mut ep_out: Option<u8> = None;
    let flush = |iface: &Option<(u8, u8, u8, u8)>, ein: &Option<u8>, eout: &Option<u8>| {
        if let (Some((num, alt, 255, 254)), Some(iaddr), Some(oaddr)) = (iface, ein, eout) {
            return Some(MuxTarget {
                config_value,
                interface: *num,
                alt_setting: *alt,
                ep_in_addr: *iaddr,
                ep_out_addr: *oaddr,
            });
        }
        None
    };
    while i + 2 <= blob.len() {
        let len = blob[i] as usize;
        if len < 2 || i + len > blob.len() {
            break;
        }
        let typ = blob[i + 1];
        match typ {
            0x04 if len >= 9 => {
                // INTERFACE: antes de cambiar de interfaz, evalúa la anterior.
                if let Some(t) = flush(&cur_iface, &ep_in, &ep_out) {
                    return Some(t);
                }
                cur_iface = Some((blob[i + 2], blob[i + 3], blob[i + 5], blob[i + 6]));
                ep_in = None;
                ep_out = None;
            }
            0x05 if len >= 7 => {
                // ENDPOINT: dirección, atributos (2 = bulk)
                let addr = blob[i + 2];
                let attr = blob[i + 3] & 0x03;
                if attr == 2 {
                    if addr & 0x80 != 0 {
                        ep_in = Some(addr);
                    } else {
                        ep_out = Some(addr);
                    }
                }
            }
            _ => {}
        }
        i += len;
    }
    flush(&cur_iface, &ep_in, &ep_out)
}

impl BulkTransport for FdTransport {
    fn bulk_out(&mut self, _ep_num: u8, data: &[u8]) -> Result<(), String> {
        let mut sent = 0usize;
        while sent < data.len() {
            let chunk = &data[sent..std::cmp::min(sent + BULK_CHUNK, data.len())];
            let mut bt = BulkTransfer {
                ep: self.target.ep_out_addr as u32,
                len: chunk.len() as u32,
                timeout: IO_TIMEOUT_MS,
                data: chunk.as_ptr() as *mut libc::c_void,
            };
            let rc = ioctl(
                self.fd,
                USBDEVFS_BULK,
                &mut bt as *mut BulkTransfer as *mut libc::c_void,
            )
            .map_err(|e| format!("bulk OUT: {}", e))?;
            if rc == 0 {
                return Err("bulk OUT: transferencia de 0 bytes".into());
            }
            sent += rc as usize;
        }
        Ok(())
    }

    fn bulk_in(&mut self, _ep_num: u8, max_len: usize) -> Result<Vec<u8>, String> {
        let want = std::cmp::min(max_len, BULK_CHUNK);
        let mut buf = vec![0u8; want];
        let mut bt = BulkTransfer {
            ep: self.target.ep_in_addr as u32,
            len: want as u32,
            timeout: IO_TIMEOUT_MS,
            data: buf.as_mut_ptr() as *mut libc::c_void,
        };
        let rc = ioctl(
            self.fd,
            USBDEVFS_BULK,
            &mut bt as *mut BulkTransfer as *mut libc::c_void,
        )
        .map_err(|e| format!("bulk IN: {}", e))?;
        buf.truncate(rc as usize);
        Ok(buf)
    }
}

impl Drop for FdTransport {
    fn drop(&mut self) {
        // Best-effort: devuelve la interfaz; el fd lo cierra Android.
        self.release_interface();
    }
}

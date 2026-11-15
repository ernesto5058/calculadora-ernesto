//! Pipe mux bloqueante de UNA conexión (lockdownd) sobre [`FdTransport`].
//!
//! Espejo simplificado del `MuxHub` de idevice-rs: como el pairing usa una sola conexión
//! pseudo-TCP, no hace falta el demux multi-conexión; sí el mismo manejo de tramas
//! (CONTROL se registra y se salta; RST aborta; ACK por cada payload recibido).

use idevice_usb_core::{
    build_mux_setup_packet_v2, build_mux_version_request, parse_mux_version_response,
    BulkTransport, Endpoints, TcpConn, MUX_PROTO_CONTROL, MUX_PROTO_TCP, MUX_PROTO_VERSION,
    READ_BUF,
};

use crate::transport::FdTransport;

const TH_SYN: u8 = 0x02;
const TH_ACK: u8 = 0x10;
const TH_RST: u8 = 0x04;

const MAX_MUX_PACKET: usize = 1 << 20;
/// Frames ajenos que el intercambio VERSION tolera antes de rendirse: son restos de una
/// sesión mux anterior del iPhone (frames TCP de cierre o de conexiones viejas encolados
/// en el extremo IN), NO la respuesta a nuestra petición.
const MAX_SKIPPED_FRAMES: usize = 8;

pub struct MuxPipe<'a> {
    io: &'a mut FdTransport,
    eps: Endpoints,
    pub conn: TcpConn,
    mux_tx_seq: u16,
    rx: Vec<u8>,
    lock_rx: Vec<u8>,
    pub mux_version: u8,
}

impl<'a> MuxPipe<'a> {
    /// VERSION (+SETUP si v2) → SYN → SYN-ACK → ACK contra lockdownd (puerto 62078).
    pub fn connect(io: &'a mut FdTransport, eps: Endpoints, dport: u16) -> Result<Self, String> {
        let mut rx: Vec<u8> = Vec::new();
        let mux_version = exchange_version(io, &eps, &mut rx)?;
        if mux_version >= 2 {
            io.bulk_out(eps.ep_out, &build_mux_setup_packet_v2())?;
        }
        let mut mux_tx_seq = 1u16;
        let mut conn = TcpConn::new_ready_for_syn(mux_version, dport);
        let syn = conn.build_mux_tcp_packet(&mut mux_tx_seq, TH_SYN, &[]);
        io.bulk_out(eps.ep_out, &syn)?;
        let raw = wait_syn_ack(io, &eps, &mut rx, &conn)?;
        let ack_pkt = conn.finish_handshake_ack_packet(&raw, &mut mux_tx_seq)?;
        io.bulk_out(eps.ep_out, &ack_pkt)?;
        Ok(Self {
            io,
            eps,
            conn,
            mux_tx_seq,
            rx,
            lock_rx: Vec::new(),
            mux_version,
        })
    }

    /// Abre OTRA pseudo-TCP en la misma sesión mux (sin repetir VERSION/SETUP: iOS lo
    /// castiga con «duplicate packet»), como `MuxHub::connect_additional_tcp`.
    pub fn connect_additional(&mut self, dport: u16) -> Result<(), String> {
        let mut conn = TcpConn::new_ready_for_syn(self.mux_version, dport);
        let syn = conn.build_mux_tcp_packet(&mut self.mux_tx_seq, TH_SYN, &[]);
        self.io.bulk_out(self.eps.ep_out, &syn)?;
        loop {
            let frame = self.next_frame()?;
            if !frame_matches(&frame, conn.mux_header_len(), &conn) {
                continue;
            }
            let base = conn.mux_header_len();
            let th = frame.get(base + 13).copied().unwrap_or(0);
            if (th & TH_SYN) != 0 && (th & TH_ACK) != 0 {
                let ack = conn.finish_handshake_ack_packet(&frame, &mut self.mux_tx_seq)?;
                self.io.bulk_out(self.eps.ep_out, &ack)?;
                self.conn = conn;
                self.lock_rx.clear();
                return Ok(());
            }
            if (th & TH_RST) != 0 {
                return Err("mux TCP RST durante el segundo handshake".into());
            }
        }
    }

    pub fn send_payload(&mut self, payload: &[u8]) -> Result<(), String> {
        self.conn
            .send(self.io, &self.eps, &mut self.mux_tx_seq, payload)
    }

    fn send_ack(&mut self) -> Result<(), String> {
        self.conn.send_ack(self.io, &self.eps, &mut self.mux_tx_seq)
    }

    /// Siguiente trama mux completa (mux + TCP). Las tramas CONTROL se registran y se saltan.
    fn next_frame(&mut self) -> Result<Vec<u8>, String> {
        loop {
            while self.rx.len() >= 8 {
                let protocol = u32::from_be_bytes(self.rx[0..4].try_into().unwrap());
                let packet_len = u32::from_be_bytes(self.rx[4..8].try_into().unwrap()) as usize;
                if packet_len < 8 {
                    return Err(format!("mux: packet_len inválido {}", packet_len));
                }
                if packet_len > MAX_MUX_PACKET {
                    return Err(format!("mux: packet_len {} excede el tope", packet_len));
                }
                if self.rx.len() < packet_len {
                    break;
                }
                let frame: Vec<u8> = self.rx.drain(..packet_len).collect();
                if protocol == MUX_PROTO_CONTROL {
                    let mux_len = if self.mux_version >= 2 { 16 } else { 8 };
                    if frame.len() > mux_len {
                        let body = String::from_utf8_lossy(&frame[mux_len..]);
                        crate::stage(&format!("[mux] CONTROL del iPhone: {}", body.trim()));
                    }
                    continue;
                }
                if protocol == MUX_PROTO_VERSION {
                    // Respuesta VERSION duplicada (contestó también a la petición
                    // reenviada del saludo): no es un error, se descarta.
                    crate::stage("[mux] VERSION duplicada descartada");
                    continue;
                }
                if protocol != MUX_PROTO_TCP {
                    return Err(format!(
                        "mux: protocolo inesperado {} (se esperaba TCP {})",
                        protocol, MUX_PROTO_TCP
                    ));
                }
                return Ok(frame);
            }
            let chunk = self.io.bulk_in(self.eps.ep_in, READ_BUF)?;
            if chunk.is_empty() {
                return Err("bulk IN devolvió 0 bytes".into());
            }
            self.rx.extend_from_slice(&chunk);
        }
    }

    /// Siguiente payload TCP de la conexión actual (ACK automático; ACKs puros se tragan).
    pub fn recv_payload(&mut self) -> Result<Vec<u8>, String> {
        loop {
            let frame = self.next_frame()?;
            if !frame_matches(&frame, self.conn.mux_header_len(), &self.conn) {
                continue;
            }
            if let Some(p) = self.deliver(frame)? {
                return Ok(p);
            }
        }
    }

    fn deliver(&mut self, frame: Vec<u8>) -> Result<Option<Vec<u8>>, String> {
        let mux_len = self.conn.mux_header_len();
        if frame.len() < mux_len + 20 {
            return Err(format!("mux: trama TCP corta ({} bytes)", frame.len()));
        }
        if self.conn.mux_version >= 2 && frame.len() >= 16 {
            self.conn.mux_rx_seq = u16::from_be_bytes([frame[14], frame[15]]);
        }
        let base = mux_len;
        let data_off = (frame[base + 12] >> 4) as usize * 4;
        let header_len = base + data_off;
        if frame.len() < header_len {
            return Err("mux: header_len excede la trama".into());
        }
        let peer_seq = u32::from_be_bytes(frame[base + 4..base + 8].try_into().unwrap());
        let flags = frame.get(base + 13).copied().unwrap_or(0);
        let payload_len = (frame.len() - header_len) as u32;
        if (flags & TH_RST) != 0 {
            let body = String::from_utf8_lossy(&frame[header_len..]);
            return Err(format!("mux TCP reset: {}", body.trim()));
        }
        self.conn.ack = peer_seq.wrapping_add(payload_len);
        self.send_ack()?;
        if payload_len > 0 {
            return Ok(Some(frame[header_len..].to_vec()));
        }
        Ok(None)
    }

    // ---- plists de lockdownd con prefijo de longitud (4 bytes BE) ----

    pub fn send_lockdown_xml(&mut self, xml: &str) -> Result<(), String> {
        let bytes = xml.as_bytes();
        let mut frame = Vec::with_capacity(4 + bytes.len());
        frame.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
        frame.extend_from_slice(bytes);
        self.send_payload(&frame)
    }

    pub fn recv_lockdown_xml(&mut self) -> Result<String, String> {
        loop {
            if self.lock_rx.len() >= 4 {
                let len =
                    u32::from_be_bytes(self.lock_rx[0..4].try_into().unwrap()) as usize;
                if len > 8 * 1024 * 1024 {
                    return Err("respuesta de lockdownd demasiado grande".into());
                }
                if self.lock_rx.len() >= 4 + len {
                    let xml =
                        String::from_utf8_lossy(&self.lock_rx[4..4 + len]).to_string();
                    self.lock_rx.drain(..4 + len);
                    return Ok(xml);
                }
            }
            let chunk = self.recv_payload()?;
            self.lock_rx.extend_from_slice(&chunk);
        }
    }

    pub fn request(&mut self, xml: &str) -> Result<String, String> {
        self.send_lockdown_xml(xml)?;
        self.recv_lockdown_xml()
    }
}

fn frame_matches(frame: &[u8], mux_len: usize, conn: &TcpConn) -> bool {
    if frame.len() < mux_len + 4 {
        return false;
    }
    let src = u16::from_be_bytes([frame[mux_len], frame[mux_len + 1]]);
    let dst = u16::from_be_bytes([frame[mux_len + 2], frame[mux_len + 3]]);
    src == conn.dport && dst == conn.sport
}

// ── Saludo mux tolerante a frames ajenos ─────────────────────────────────────
//
// La v1 usaba `TcpConn::handshake_and_connect` del crate vendorizado, que lee UNA
// transferencia tras enviar VERSION y exige que sea la respuesta VERSION. En la
// corrida viva del 2026-11-15 eso murió al instante («expected mux VERSION (0),
// got protocol 6»): la sesión mux del iPhone ya vivía antes de nuestro claim (la
// configuración 3 ya estaba activa, sin SET_CONFIGURATION) y un frame TCP resto de
// esa sesión estaba encolado en el extremo IN — la primera lectura lo recogió a él.
// Aquí el saludo lee FRAMES completos (cabecera protocolo+longitud, válida en
// ambos formatos de cabecera) y despacha por tipo hasta hallar VERSION, igual que
// el resto de la pila ya hace con los frames CONTROL en `next_frame`.

/// Extrae el siguiente frame mux completo de `rx`, si ya llegó entero.
fn take_frame(rx: &mut Vec<u8>) -> Option<Result<(u32, Vec<u8>), String>> {
    if rx.len() < 8 {
        return None;
    }
    let protocol = u32::from_be_bytes(rx[0..4].try_into().unwrap());
    let packet_len = u32::from_be_bytes(rx[4..8].try_into().unwrap()) as usize;
    if packet_len < 8 {
        return Some(Err(format!("mux: packet_len inválido {}", packet_len)));
    }
    if packet_len > MAX_MUX_PACKET {
        return Some(Err(format!("mux: packet_len {} excede el tope", packet_len)));
    }
    if rx.len() < packet_len {
        return None;
    }
    let frame: Vec<u8> = rx.drain(..packet_len).collect();
    Some(Ok((protocol, frame)))
}

/// Siguiente frame mux completo, leyendo del transporte lo que falte.
fn read_frame(
    io: &mut impl BulkTransport,
    eps: &Endpoints,
    rx: &mut Vec<u8>,
) -> Result<(u32, Vec<u8>), String> {
    loop {
        if let Some(r) = take_frame(rx) {
            return r;
        }
        let chunk = io.bulk_in(eps.ep_in, READ_BUF)?;
        if chunk.is_empty() {
            return Err("bulk IN devolvió 0 bytes".into());
        }
        rx.extend_from_slice(&chunk);
    }
}

/// Pide VERSION y espera su respuesta saltando frames ajenos (restos de una sesión
/// mux anterior), que quedan escritos en el registro de etapas. Si solo llegan
/// frames ajenos, reenvía la petición UNA vez (el iPhone pudo descartar la primera
/// mientras cerraba su sesión anterior). Devuelve la versión mayor del mux.
fn exchange_version(
    io: &mut impl BulkTransport,
    eps: &Endpoints,
    rx: &mut Vec<u8>,
) -> Result<u8, String> {
    io.bulk_out(eps.ep_out, &build_mux_version_request())?;
    let mut skipped = 0usize;
    let mut resent = false;
    loop {
        let (protocol, frame) = read_frame(io, eps, rx)?;
        if protocol == MUX_PROTO_VERSION {
            let (major, _minor) = parse_mux_version_response(&frame)?;
            return Ok(major);
        }
        skipped += 1;
        crate::stage(&format!(
            "[mux] frame ajeno antes de VERSION: protocolo {} ({} bytes) — resto de una sesión mux anterior; se descarta y se sigue",
            protocol,
            frame.len()
        ));
        if skipped > MAX_SKIPPED_FRAMES {
            return Err(format!(
                "mux: {} frames ajenos sin respuesta VERSION — la sesión mux del iPhone parece ocupada; desenchufa y reenchufa el cable y reintenta",
                skipped
            ));
        }
        if !resent {
            io.bulk_out(eps.ep_out, &build_mux_version_request())?;
            crate::stage("[mux] petición VERSION reenviada tras el frame ajeno");
            resent = true;
        }
    }
}

/// Espera el SYN-ACK de la pseudo-TCP recién abierta: acepta el primer frame TCP
/// con SYN+ACK, salta frames CONTROL/VERSION y frames TCP de conexiones viejas, y
/// un RST aborta con su causa (la sesión anterior cerrándose en la cara).
fn wait_syn_ack(
    io: &mut impl BulkTransport,
    eps: &Endpoints,
    rx: &mut Vec<u8>,
    conn: &TcpConn,
) -> Result<Vec<u8>, String> {
    let mux_len = conn.mux_header_len();
    let mut skipped = 0usize;
    loop {
        let (protocol, frame) = read_frame(io, eps, rx)?;
        if protocol == MUX_PROTO_CONTROL || protocol == MUX_PROTO_VERSION {
            skipped += 1;
            crate::stage(&format!(
                "[mux] frame protocolo {} saltado esperando SYN-ACK",
                protocol
            ));
        } else if protocol == MUX_PROTO_TCP {
            let th = frame.get(mux_len + 13).copied().unwrap_or(0);
            if (th & TH_RST) != 0 {
                return Err(
                    "mux TCP RST esperando el SYN-ACK (la sesión mux anterior se estaba cerrando): reintenta el emparejamiento"
                        .into(),
                );
            }
            if (th & TH_SYN) != 0 && (th & TH_ACK) != 0 {
                return Ok(frame);
            }
            skipped += 1;
            crate::stage(&format!(
                "[mux] frame TCP ajeno saltado esperando SYN-ACK (flags 0x{:02X})",
                th
            ));
        } else {
            return Err(format!(
                "mux: protocolo inesperado {} esperando SYN-ACK",
                protocol
            ));
        }
        if skipped > MAX_SKIPPED_FRAMES {
            return Err("mux: demasiados frames ajenos esperando el SYN-ACK".into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    struct MockTransport {
        incoming: VecDeque<Vec<u8>>,
        sent: Vec<Vec<u8>>,
    }

    impl BulkTransport for MockTransport {
        fn bulk_out(&mut self, _ep_num: u8, data: &[u8]) -> Result<(), String> {
            self.sent.push(data.to_vec());
            Ok(())
        }
        fn bulk_in(&mut self, _ep_num: u8, _max_len: usize) -> Result<Vec<u8>, String> {
            self.incoming
                .pop_front()
                .ok_or_else(|| "sin datos (timeout simulado)".to_string())
        }
    }

    fn frame(proto: u32, payload: &[u8]) -> Vec<u8> {
        let mut f = Vec::with_capacity(8 + payload.len());
        f.extend_from_slice(&proto.to_be_bytes());
        f.extend_from_slice(&((8 + payload.len()) as u32).to_be_bytes());
        f.extend_from_slice(payload);
        f
    }

    fn version_reply(major: u32) -> Vec<u8> {
        let mut f = vec![0u8; 20];
        f[0..4].copy_from_slice(&MUX_PROTO_VERSION.to_be_bytes());
        f[4..8].copy_from_slice(&20u32.to_be_bytes());
        f[8..12].copy_from_slice(&major.to_be_bytes());
        f
    }

    fn eps() -> Endpoints {
        Endpoints {
            ep_out: 0x04,
            ep_in: 0x05,
        }
    }

    #[test]
    fn version_clean_single_frame() {
        let mut io = MockTransport {
            incoming: VecDeque::from(vec![version_reply(2)]),
            sent: Vec::new(),
        };
        let mut rx = Vec::new();
        let v = exchange_version(&mut io, &eps(), &mut rx).unwrap();
        assert_eq!(v, 2);
        assert_eq!(io.sent.len(), 1); // sin reenvío
    }

    #[test]
    fn version_after_stale_tcp_frame_same_transfer() {
        // El caso de la corrida viva: un frame TCP de la sesión anterior y la
        // respuesta VERSION llegan en la MISMA transferencia, el TCP primero.
        let mut chunk = frame(MUX_PROTO_TCP, &[0u8; 28]);
        chunk.extend_from_slice(&version_reply(2));
        let mut io = MockTransport {
            incoming: VecDeque::from(vec![chunk]),
            sent: Vec::new(),
        };
        let mut rx = Vec::new();
        let v = exchange_version(&mut io, &eps(), &mut rx).unwrap();
        assert_eq!(v, 2);
        assert_eq!(io.sent.len(), 2); // petición inicial + reenvío tras el frame ajeno
    }

    #[test]
    fn version_v1_after_control_frame() {
        let mut io = MockTransport {
            incoming: VecDeque::from(vec![
                frame(MUX_PROTO_CONTROL, b"{\"x\":1}"),
                version_reply(1),
            ]),
            sent: Vec::new(),
        };
        let mut rx = Vec::new();
        let v = exchange_version(&mut io, &eps(), &mut rx).unwrap();
        assert_eq!(v, 1);
    }

    #[test]
    fn version_gives_up_after_too_many_stale_frames() {
        let chunks: Vec<Vec<u8>> = (0..MAX_SKIPPED_FRAMES + 1)
            .map(|_| frame(MUX_PROTO_TCP, &[0u8; 12]))
            .collect();
        let mut io = MockTransport {
            incoming: VecDeque::from(chunks),
            sent: Vec::new(),
        };
        let mut rx = Vec::new();
        let e = exchange_version(&mut io, &eps(), &mut rx).unwrap_err();
        assert!(e.contains("frames ajenos"), "error inesperado: {}", e);
    }

    #[test]
    fn version_rejects_unsupported_major() {
        let mut io = MockTransport {
            incoming: VecDeque::from(vec![version_reply(7)]),
            sent: Vec::new(),
        };
        let mut rx = Vec::new();
        assert!(exchange_version(&mut io, &eps(), &mut rx).is_err());
    }

    #[test]
    fn take_frame_waits_for_full_packet() {
        let full = frame(MUX_PROTO_TCP, &[1, 2, 3, 4]);
        let mut rx = full[..10].to_vec();
        assert!(take_frame(&mut rx).is_none());
        rx.extend_from_slice(&full[10..]);
        let (proto, got) = take_frame(&mut rx).unwrap().unwrap();
        assert_eq!(proto, MUX_PROTO_TCP);
        assert_eq!(got, full);
        assert!(rx.is_empty());
    }
}

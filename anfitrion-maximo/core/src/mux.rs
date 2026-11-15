//! Pipe mux bloqueante de UNA conexión (lockdownd) sobre [`FdTransport`].
//!
//! Espejo simplificado del `MuxHub` de idevice-rs: como el pairing usa una sola conexión
//! pseudo-TCP, no hace falta el demux multi-conexión; sí el mismo manejo de tramas
//! (CONTROL se registra y se salta; RST aborta; ACK por cada payload recibido).

use idevice_usb_core::{BulkTransport, Endpoints, TcpConn, MUX_PROTO_CONTROL, MUX_PROTO_TCP, READ_BUF};

use crate::transport::FdTransport;

const TH_SYN: u8 = 0x02;
const TH_ACK: u8 = 0x10;
const TH_RST: u8 = 0x04;

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
        let mut mux_tx_seq = 1u16;
        let conn = TcpConn::handshake_and_connect(io, &eps, dport, &mut mux_tx_seq)?;
        let mux_version = conn.mux_version;
        Ok(Self {
            io,
            eps,
            conn,
            mux_tx_seq,
            rx: Vec::new(),
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
        const MAX_MUX_PACKET: usize = 1 << 20;
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

//! Hub mux multi-conexión: la sesión mux que la v1.1 abrió pa lockdownd
//! alimentó en la fase 2 a TODOS los servicios que pide la pila `idevice`
//! (lockdownd, AFC, InstallationProxy, HouseArrest), cada uno con su pseudo-TCP.
//!
//! **v2.4 — el hub ya NO es transporte de la cadena.** Probado en vivo el
//! 2026-11-16 (determinista 2/2): abrir InstallationProxy sobre la sesión
//! del hub moría al instante (`CONTROL del iPhone: socketIsClosed
//! sock_receive returned errno 54` → tls handshake eof) — el hub arrastra
//! estado mux sucio entre sesiones. Desde la v2.4 el hub queda solo pa
//! **detección/latido**: saluda (prueba que el cable y el mux viven),
//! **purga** su estado y se cierra ANTES de que la cadena arranque; la
//! cadena viaja sobre su propia sesión fresca (`cadena.rs`).
//!
//! Diseño: UN hilo dueño del transporte USB; demultiplexa las tramas por
//! puerto y guarda el payload de cada conexión en su cola. Las operaciones de
//! los servicios son petición/respuesta y nunca leen dos conexiones a la vez
//! en caliente, así que un solo hilo con comandos por canal basta y sobra —
//! es el mismo patrón del `MuxHub` de idevice-rs, reducido a este transporte.
//!
//! El lado tokio habla con el hilo por comandos (`HubHandle`) y cada conexión
//! se expone como [`HubStream`] (AsyncRead + AsyncWrite) pa `Idevice::new`.

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::task::{Context, Poll};
use std::time::Duration;

use idevice_usb_core::{
    build_mux_setup_packet_v2, BulkTransport, Endpoints, TcpConn, MUX_PROTO_CONTROL,
    MUX_PROTO_TCP, MUX_PROTO_VERSION,
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::oneshot;

use crate::mux::{exchange_version, take_frame};
use crate::transport::FdTransport;

const TH_SYN: u8 = 0x02;
const TH_ACK: u8 = 0x10;
const TH_RST: u8 = 0x04;
// Superficie open/stream del hub: se conserva (el transporte vivo va por
// cadena); los #[allow(dead_code)] de este archivo marcan lo guardado, no borrado.
#[allow(dead_code)]
const READ_CHUNK: usize = 65536;

struct HubConn {
    tcp: TcpConn,
    queue: Vec<u8>,
    rst: bool,
}

pub struct MuxHub {
    io: FdTransport,
    eps: Endpoints,
    mux_version: u8,
    mux_tx_seq: u16,
    rx: Vec<u8>,
    conns: HashMap<u16, HubConn>,
    by_id: HashMap<u32, u16>,
    next_id: u32,
}

impl MuxHub {
    /// Saludo de sesión (VERSION tolerante + SETUP si v2), UNA vez por cable.
    pub fn open(mut io: FdTransport, eps: Endpoints) -> Result<Self, String> {
        let mut rx: Vec<u8> = Vec::new();
        let mux_version = exchange_version(&mut io, &eps, &mut rx)?;
        if mux_version >= 2 {
            io.bulk_out(eps.ep_out, &build_mux_setup_packet_v2())?;
        }
        Ok(Self {
            io,
            eps,
            mux_version,
            mux_tx_seq: 1,
            rx,
            conns: HashMap::new(),
            by_id: HashMap::new(),
            next_id: 1,
        })
    }

    pub fn mux_version(&self) -> u8 {
        self.mux_version
    }

    /// **La purga del hub (v2.4)**: fuera conexiones, fuera IDs, fuera bytes
    /// resto; los contadores vuelven a su nacimiento. Tras el
    /// SET_CONFIGURATION del pairing, el hub purga su estado y se cierra
    /// ANTES de que la cadena arranque — ningún frame de una sesión muerta
    /// queda con dueño al que entregarse. Devuelve
    /// `(bytes_descartados, conexiones_descartadas)` pa el registro.
    pub fn purge(&mut self) -> (usize, usize) {
        let bytes = self.rx.len();
        let conns = self.conns.len();
        self.conns.clear();
        self.by_id.clear();
        self.rx.clear();
        self.next_id = 1;
        self.mux_tx_seq = 1;
        (bytes, conns)
    }

    /// Lee UNA trama del cable y la entrega a la cola de su conexión.
    /// Devuelve Ok(false) si solo llegaron tramas de control/versión.
    fn pump_one(&mut self) -> Result<bool, String> {
        loop {
            if let Some(r) = take_frame(&mut self.rx) {
                let (protocol, frame) = r?;
                match protocol {
                    MUX_PROTO_CONTROL => {
                        let mux_len = if self.mux_version >= 2 { 16 } else { 8 };
                        if frame.len() > mux_len {
                            let body = String::from_utf8_lossy(&frame[mux_len..]);
                            crate::stage(&format!(
                                "[hub] CONTROL del iPhone: {}",
                                body.trim()
                            ));
                        }
                        return Ok(false);
                    }
                    MUX_PROTO_VERSION => {
                        crate::stage("[hub] VERSION duplicada descartada");
                        return Ok(false);
                    }
                    MUX_PROTO_TCP => {
                        self.deliver(frame)?;
                        return Ok(true);
                    }
                    p => {
                        return Err(format!(
                            "mux: protocolo inesperado {} (se esperaba TCP {})",
                            p, MUX_PROTO_TCP
                        ))
                    }
                }
            }
            let chunk = self.io.bulk_in(self.eps.ep_in, idevice_usb_core::READ_BUF)?;
            if chunk.is_empty() {
                return Err("bulk IN devolvió 0 bytes".into());
            }
            self.rx.extend_from_slice(&chunk);
        }
    }

    /// Entrega una trama TCP a la conexión dueña (por puertos), manda su ACK y
    /// encola el payload. Las tramas de conexiones desconocidas se descartan
    /// con nota (restos de sesiones anteriores, como en el saludo).
    fn deliver(&mut self, frame: Vec<u8>) -> Result<(), String> {
        // Localiza la conexión por (src == dport, dst == sport).
        let mut target: Option<u16> = None;
        for (sport, conn) in self.conns.iter() {
            let mux_len = conn.tcp.mux_header_len();
            if frame.len() >= mux_len + 4 {
                let src = u16::from_be_bytes([frame[mux_len], frame[mux_len + 1]]);
                let dst = u16::from_be_bytes([frame[mux_len + 2], frame[mux_len + 3]]);
                if src == conn.tcp.dport && dst == conn.tcp.sport {
                    target = Some(*sport);
                    break;
                }
            }
        }
        let sport = match target {
            Some(s) => s,
            None => return Ok(()), // conexión ajena o ya cerrada: se descarta
        };
        let conn = self.conns.get_mut(&sport).expect("conexión localizada");
        let mux_len = conn.tcp.mux_header_len();
        if frame.len() < mux_len + 20 {
            return Err(format!("mux: trama TCP corta ({} bytes)", frame.len()));
        }
        if conn.tcp.mux_version >= 2 && frame.len() >= 16 {
            conn.tcp.mux_rx_seq = u16::from_be_bytes([frame[14], frame[15]]);
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
            conn.rst = true;
            return Ok(());
        }
        conn.tcp.ack = peer_seq.wrapping_add(payload_len);
        conn.tcp
            .send_ack(&mut self.io, &self.eps, &mut self.mux_tx_seq)?;
        if payload_len > 0 {
            conn.queue.extend_from_slice(&frame[header_len..]);
        }
        Ok(())
    }

    /// Abre una pseudo-TCP nueva (SYN → SYN-ACK → ACK) bombeando mientras
    /// tanto las tramas de las conexiones ya abiertas (quedan encoladas).
    pub fn open_conn(&mut self, dport: u16) -> Result<u32, String> {
        let mut conn = TcpConn::new_ready_for_syn(self.mux_version, dport);
        let syn = conn.build_mux_tcp_packet(&mut self.mux_tx_seq, TH_SYN, &[]);
        self.io.bulk_out(self.eps.ep_out, &syn)?;
        let mux_len = conn.mux_header_len();
        let mut skipped = 0usize;
        loop {
            // Lee la siguiente trama cruda (sin pasar por deliver: la del
            // SYN-ACK es de la conexión nueva, aún sin registrar).
            let (protocol, frame) = loop {
                if let Some(r) = take_frame(&mut self.rx) {
                    break r?;
                }
                let chunk = self.io.bulk_in(self.eps.ep_in, idevice_usb_core::READ_BUF)?;
                if chunk.is_empty() {
                    return Err("bulk IN devolvió 0 bytes".into());
                }
                self.rx.extend_from_slice(&chunk);
            };
            match protocol {
                MUX_PROTO_TCP => {
                    let src = u16::from_be_bytes([frame[mux_len], frame[mux_len + 1]]);
                    let dst = u16::from_be_bytes([frame[mux_len + 2], frame[mux_len + 3]]);
                    let th = frame.get(mux_len + 13).copied().unwrap_or(0);
                    if src == conn.dport && dst == conn.sport {
                        if (th & TH_RST) != 0 {
                            return Err(format!(
                                "mux TCP RST abriendo el puerto {} (¿servicio no disponible?)",
                                dport
                            ));
                        }
                        if (th & TH_SYN) != 0 && (th & TH_ACK) != 0 {
                            let ack_pkt =
                                conn.finish_handshake_ack_packet(&frame, &mut self.mux_tx_seq)?;
                            self.io.bulk_out(self.eps.ep_out, &ack_pkt)?;
                            let sport = conn.sport;
                            let id = self.next_id;
                            self.next_id += 1;
                            self.conns.insert(
                                sport,
                                HubConn {
                                    tcp: conn,
                                    queue: Vec::new(),
                                    rst: false,
                                },
                            );
                            self.by_id.insert(id, sport);
                            return Ok(id);
                        }
                        skipped += 1;
                    } else {
                        // Trama de otra conexión: a su cola.
                        self.deliver(frame)?;
                    }
                }
                MUX_PROTO_CONTROL | MUX_PROTO_VERSION => {
                    skipped += 1;
                }
                p => return Err(format!("mux: protocolo inesperado {} abriendo conexión", p)),
            }
            if skipped > 64 {
                return Err("mux: demasiadas tramas ajenas esperando el SYN-ACK".into());
            }
        }
    }

    pub fn write(&mut self, id: u32, data: &[u8]) -> Result<(), String> {
        let sport = *self
            .by_id
            .get(&id)
            .ok_or_else(|| "conexión desconocida".to_string())?;
        let conn = self
            .conns
            .get_mut(&sport)
            .ok_or_else(|| "conexión cerrada".to_string())?;
        conn.tcp
            .send(&mut self.io, &self.eps, &mut self.mux_tx_seq, data)
    }

    #[allow(dead_code)]
    /// Saca hasta `max` bytes de la cola de la conexión, bombeando el cable
    /// hasta que haya datos, la conexión se resetee o el transporte falle.
    pub fn read(&mut self, id: u32, max: usize) -> Result<Vec<u8>, String> {
        loop {
            let sport = *self
                .by_id
                .get(&id)
                .ok_or_else(|| "conexión desconocida".to_string())?;
            {
                let conn = self
                    .conns
                    .get_mut(&sport)
                    .ok_or_else(|| "conexión cerrada".to_string())?;
                if !conn.queue.is_empty() {
                    let n = conn.queue.len().min(max);
                    return Ok(conn.queue.drain(..n).collect());
                }
                if conn.rst {
                    return Ok(Vec::new()); // EOF: el iPhone reseteó la conexión
                }
            }
            self.pump_one()?;
        }
    }

    /// Intento de lectura sin bombear: solo lo ya encolado.
    fn try_read(&mut self, id: u32, max: usize) -> Option<Result<Vec<u8>, String>> {
        let sport = *self.by_id.get(&id)?;
        let conn = self.conns.get_mut(&sport)?;
        if !conn.queue.is_empty() {
            let n = conn.queue.len().min(max);
            return Some(Ok(conn.queue.drain(..n).collect()));
        }
        if conn.rst {
            return Some(Ok(Vec::new()));
        }
        None
    }

    pub fn close(&mut self, id: u32) {
        if let Some(sport) = self.by_id.remove(&id) {
            self.conns.remove(&sport);
        }
    }
}

// ── Hilo dueño del hub + comandos ─────────────────────────────────────────────

#[allow(dead_code)]
enum HubCmd {
    Open {
        dport: u16,
        reply: oneshot::Sender<Result<u32, String>>,
    },
    Write {
        id: u32,
        data: Vec<u8>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Read {
        id: u32,
        max: usize,
        reply: oneshot::Sender<Result<Vec<u8>, String>>,
    },
    Close {
        id: u32,
    },
    /// Purga el estado de sesión (v2.4); la respuesta viaja por un canal
    /// std porque quien la pide (la etapa «conexion») aún no tiene runtime.
    Purge {
        reply: std::sync::mpsc::Sender<Result<(), String>>,
    },
    /// Cierra el hub: el hilo suelta el transporte (la interfaz USB queda
    /// liberada) ANTES de responder — el cierre es síncrono de verdad.
    Shutdown {
        reply: std::sync::mpsc::Sender<()>,
    },
}

#[derive(Clone)]
pub struct HubHandle {
    tx: Sender<HubCmd>,
}

impl std::fmt::Debug for HubHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HubHandle")
    }
}

/// Abre la sesión mux (síncrono: el error del saludo se devuelve aquí) y
/// arranca el hilo dueño del hub.
pub fn spawn_hub(io: FdTransport, eps: Endpoints) -> Result<HubHandle, String> {
    let hub = MuxHub::open(io, eps)?;
    crate::stage(&format!(
        "[hub] sesión mux abierta (versión {})",
        hub.mux_version()
    ));
    let (tx, rx) = channel::<HubCmd>();
    std::thread::Builder::new()
        .name("anfitrion-mux-hub".into())
        .spawn(move || hub_loop(hub, rx))
        .map_err(|e| format!("no se pudo arrancar el hilo del hub: {}", e))?;
    Ok(HubHandle { tx })
}

fn hub_loop(mut hub: MuxHub, rx: Receiver<HubCmd>) {
    let mut pending_reads: Vec<(u32, usize, oneshot::Sender<Result<Vec<u8>, String>>)> =
        Vec::new();
    loop {
        // 1) Comandos: espera corta si no hay lecturas pendientes; bloqueo
        //    paciente si las hay (el bombeo las despierta).
        let cmd = if pending_reads.is_empty() {
            match rx.recv() {
                Ok(c) => Some(c),
                Err(_) => return, // el dueño soltó el handle: fin del hilo
            }
        } else {
            match rx.recv_timeout(Duration::from_millis(5)) {
                Ok(c) => Some(c),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => None,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
            }
        };
        if let Some(cmd) = cmd {
            match cmd {
                HubCmd::Open { dport, reply } => {
                    let _ = reply.send(hub.open_conn(dport));
                }
                HubCmd::Write { id, data, reply } => {
                    let _ = reply.send(hub.write(id, &data));
                }
                HubCmd::Read { id, max, reply } => {
                    pending_reads.push((id, max, reply));
                }
                HubCmd::Close { id } => hub.close(id),
                HubCmd::Purge { reply } => {
                    let (bytes, conns) = hub.purge();
                    // Las lecturas pendientes eran de conexiones purgadas:
                    // mueren con causa, no colgadas.
                    for (_, _, r) in pending_reads.drain(..) {
                        let _ = r.send(Err("la sesión del hub fue purgada".into()));
                    }
                    crate::stage(&format!(
                        "[hub] purga: {} conexiones y {} bytes resto descartados — el estado de sesión queda en cero",
                        conns, bytes
                    ));
                    let _ = reply.send(Ok(()));
                }
                HubCmd::Shutdown { reply } => {
                    // Soltar el transporte ANTES de responder: cuando la
                    // etapa «conexion» despierta, la interfaz ya es libre
                    // pa que la cadena reclame la suya sin pisarse.
                    drop(hub);
                    let _ = reply.send(());
                    return;
                }
            }
        }
        // 2) Servir lecturas con lo encolado.
        if !pending_reads.is_empty() {
            let mut rest = Vec::new();
            for (id, max, reply) in pending_reads.drain(..) {
                match hub.try_read(id, max) {
                    Some(res) => {
                        let _ = reply.send(res);
                    }
                    None => rest.push((id, max, reply)),
                }
            }
            pending_reads = rest;
        }
        // 3) Si quedan lecturas esperando, bombear UNA trama y reintentar.
        if !pending_reads.is_empty() {
            match hub.pump_one() {
                Ok(_) => {
                    let mut rest = Vec::new();
                    for (id, max, reply) in pending_reads.drain(..) {
                        match hub.try_read(id, max) {
                            Some(res) => {
                                let _ = reply.send(res);
                            }
                            None => rest.push((id, max, reply)),
                        }
                    }
                    pending_reads = rest;
                }
                Err(e) => {
                    // El cable falló: todas las lecturas pendientes mueren con causa.
                    for (_, _, reply) in pending_reads.drain(..) {
                        let _ = reply.send(Err(e.clone()));
                    }
                }
            }
        }
    }
}

impl HubHandle {
    /// Purga TODO el estado de sesión del hub (síncrono: la etapa
    /// «conexion» lo corre antes de que exista runtime tokio).
    pub fn purge(&self) -> Result<(), String> {
        let (tx, rx) = std::sync::mpsc::channel();
        self.tx
            .send(HubCmd::Purge { reply: tx })
            .map_err(|_| "el hilo del hub no responde".to_string())?;
        rx.recv()
            .map_err(|_| "el hilo del hub cerró sin responder".to_string())?
    }

    /// Cierra el hub y ESPERA a que su hilo haya soltado el transporte:
    /// la interfaz USB queda liberada antes de que la cadena abra la suya.
    pub fn shutdown(self) -> Result<(), String> {
        let (tx, rx) = std::sync::mpsc::channel();
        self.tx
            .send(HubCmd::Shutdown { reply: tx })
            .map_err(|_| "el hilo del hub no responde".to_string())?;
        rx.recv()
            .map_err(|_| "el hilo del hub cerró sin responder".to_string())
    }

    #[allow(dead_code)]
    pub async fn open(&self, dport: u16) -> Result<u32, String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(HubCmd::Open { dport, reply: tx })
            .map_err(|_| "el hilo del hub no responde".to_string())?;
        rx.await
            .map_err(|_| "el hilo del hub cerró sin responder".to_string())?
    }

    #[allow(dead_code)]
    pub fn stream(&self, id: u32) -> HubStream {
        HubStream {
            handle: self.clone(),
            id,
            read_rx: None,
            read_buf: VecDeque::new(),
            write_rx: None,
            write_len: 0,
        }
    }
}

// ── Stream tokio sobre una conexión del hub ───────────────────────────────────

#[allow(dead_code)]
pub struct HubStream {
    handle: HubHandle,
    id: u32,
    read_rx: Option<oneshot::Receiver<Result<Vec<u8>, String>>>,
    read_buf: VecDeque<u8>,
    write_rx: Option<oneshot::Receiver<Result<(), String>>>,
    write_len: usize,
}

impl std::fmt::Debug for HubStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HubStream").field("id", &self.id).finish()
    }
}

#[allow(dead_code)]
fn io_err(msg: String) -> io::Error {
    io::Error::new(io::ErrorKind::Other, msg)
}

impl AsyncRead for HubStream {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        loop {
            if !self.read_buf.is_empty() {
                let n = self.read_buf.len().min(buf.remaining());
                let chunk: Vec<u8> = self.read_buf.drain(..n).collect();
                buf.put_slice(&chunk);
                return Poll::Ready(Ok(()));
            }
            match &mut self.read_rx {
                None => {
                    let (tx, rx) = oneshot::channel();
                    if self
                        .handle
                        .tx
                        .send(HubCmd::Read {
                            id: self.id,
                            max: READ_CHUNK,
                            reply: tx,
                        })
                        .is_err()
                    {
                        return Poll::Ready(Err(io_err(
                            "el hilo del hub no responde".into(),
                        )));
                    }
                    self.read_rx = Some(rx);
                }
                Some(rx) => match Pin::new(rx).poll(cx) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(Ok(Ok(bytes))) => {
                        self.read_rx = None;
                        if bytes.is_empty() {
                            return Poll::Ready(Ok(())); // EOF
                        }
                        self.read_buf.extend(bytes);
                    }
                    Poll::Ready(Ok(Err(e))) => {
                        self.read_rx = None;
                        return Poll::Ready(Err(io_err(e)));
                    }
                    Poll::Ready(Err(_)) => {
                        self.read_rx = None;
                        return Poll::Ready(Err(io_err(
                            "el hilo del hub cerró sin responder".into(),
                        )));
                    }
                },
            }
        }
    }
}

impl AsyncWrite for HubStream {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        if self.write_rx.is_none() {
            let (tx, rx) = oneshot::channel();
            if self
                .handle
                .tx
                .send(HubCmd::Write {
                    id: self.id,
                    data: buf.to_vec(),
                    reply: tx,
                })
                .is_err()
            {
                return Poll::Ready(Err(io_err("el hilo del hub no responde".into())));
            }
            self.write_rx = Some(rx);
            self.write_len = buf.len();
        }
        let rx = self.write_rx.as_mut().expect("write_rx fijado");
        match Pin::new(rx).poll(cx) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Ok(Ok(()))) => {
                self.write_rx = None;
                Poll::Ready(Ok(self.write_len))
            }
            Poll::Ready(Ok(Err(e))) => {
                self.write_rx = None;
                Poll::Ready(Err(io_err(e)))
            }
            Poll::Ready(Err(_)) => {
                self.write_rx = None;
                Poll::Ready(Err(io_err("el hilo del hub cerró sin responder".into())))
            }
        }
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        match &mut self.write_rx {
            None => Poll::Ready(Ok(())),
            Some(rx) => match Pin::new(rx).poll(cx) {
                Poll::Pending => Poll::Pending,
                Poll::Ready(_) => {
                    self.write_rx = None;
                    Poll::Ready(Ok(()))
                }
            },
        }
    }

    fn poll_shutdown(self: Pin<&mut Self>, _cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        let _ = self.handle.tx.send(HubCmd::Close { id: self.id });
        Poll::Ready(Ok(()))
    }
}

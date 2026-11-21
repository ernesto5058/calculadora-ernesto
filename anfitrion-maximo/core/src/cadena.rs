//! **La sesión mux FRESCA de la cadena (v2.4)** — el transporte del que
//! cuelgan TODOS los servicios de «Firmar e instalar».
//!
//! **El fallo que esta pieza cierra** (probado en vivo el 2026-11-16,
//! determinista 2/2): pasada la puerta por la vía 1, la cadena de la v2.3
//! abría InstallationProxy sobre la sesión mux **del hub** y moría al
//! instante — `[hub] CONTROL del iPhone: socketIsClosed sock_receive
//! returned errno 54` → «sonda»: tls handshake eof. El hub arrastra estado
//! mux sucio entre sesiones (frames ajenos de sesiones muertas encolados en
//! su sesión) y la apertura de servicios hereda esa suciedad. La firma con
//! Apple ID nunca se alcanzaba.
//!
//! **El arreglo (la opción probada):** la cadena ya NO abre servicios sobre
//! la sesión del hub. Al arrancar, la cadena abre su **propia** sesión mux
//! con la secuencia fresca de la vía 1 de la puerta — transporte recién
//! preparado (`open_mux_transport`: SET_CONFIGURATION que reinicia la
//! sesión mux del iPhone) → saludo VERSION/SETUP tolerante a frames ajenos
//! (`mux::exchange_version`, el de `MuxPipe`) → **purga**: cualquier byte
//! resto que el saludo haya dejado en el búfer se descarta, porque ninguna
//! conexión de la cadena existe aún y todo resto es, por construcción,
//! resto de una sesión muerta. Sobre esa sesión limpia, cada servicio se
//! abre con su LockdownClient nuevo y su StartSession propio vía
//! `servicio::abrir_servicio` (con el EscrowBag presentado).
//!
//! El hub (`hub.rs`) queda solo pa detección/latido: saluda, se purga y se
//! cierra ANTES de que la cadena arranque; nunca es su transporte.
//!
//! La demultiplexación por conexión (colas por puerto) espeja la del hub —
//! es código probado — con dos diferencias de disciplina heredadas de
//! `MuxPipe`: el SYN-ACK se espera **verificando puertos** (un SYN-ACK
//! ajeno jamás se toma por el nuestro) y las tramas CONTROL se registran
//! en el registro de etapas en vez de tragarse en silencio.
//!
//! **v2.7 — el apagado síncrono (`CadenaHandle::apagar`):** la sesión
//! aprende a retirarse a la orden, con el patrón del `Shutdown` del hub:
//! el hilo dueño suelta el transporte (RELEASEINTERFACE sobre el fd
//! compartido) y SOLO DESPUÉS confirma. Hasta la v2.6 el handle solo se
//! soltaba y el hilo moría cuando caía el último clon del canal — una
//! liberación sin orden ni momento garantizado que, en la re-preparación
//! del supervisor, podía caer tras el claim del transporte nuevo y
//! tumbarlo (revisión de diff sobre la v2.6). El supervisor ahora retira
//! la sesión vieja con este apagado ANTES de re-preparar la nueva.
//!
//! **v2.8 — el apagado CONFIRMADO (revisión por fragmentos con
//! Perplexity, rondas 1–3 + Paso 1):** la v2.7 cerraba el ORDEN feliz,
//! pero el acuse no acreditaba el resultado: `release_interface()`
//! descartaba el error del ioctl, el `JoinHandle` se tiraba al nacer y
//! `apagar()` esperaba el acuse sin límite. Desde la v2.8: el hilo dueño
//! corre el **cierre explícito comprobado** del transporte
//! (`BulkTransport::cerrar`), su resultado viaja en el acuse (un acuse
//! con `Err` es acuse, no éxito) y queda guardado en un slot compartido
//! que sobrevive al canal; el `JoinHandle` vive en un propietario
//! compartido entre los clones; y `apagar()` decide dentro de un
//! **plazo total** (`PLAZO_APAGADO`): si el acuse se pierde, manda el
//! resultado registrado en el slot; si el hilo terminó sin registrar
//! ninguno, o el plazo vence con el hilo vivo, la retirada queda **no
//! confirmada** — terminación ≠ liberación — y esa operación jamás
//! autoriza un reemplazo. UNA sola operación de retirada coordina a
//! todos los clones: un ejecutor, un resultado publicado compartido;
//! «en curso» nunca se lee como éxito.

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::task::{Context, Poll};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use idevice_usb_core::{
    build_mux_setup_packet_v2, BulkTransport, Endpoints, TcpConn, MUX_PROTO_CONTROL,
    MUX_PROTO_TCP, MUX_PROTO_VERSION,
};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio::sync::oneshot;

use crate::mux::{exchange_version, take_frame};

const TH_SYN: u8 = 0x02;
const TH_ACK: u8 = 0x10;
const TH_RST: u8 = 0x04;
const READ_CHUNK: usize = 65536;
/// Tramas ajenas toleradas esperando un SYN-ACK antes de rendirse (la misma
/// paciencia del saludo de `MuxPipe`, con más aire: aquí la sesión es nueva
/// y lo ajeno es solo el eco de la anterior cerrándose).
const MAX_SALTADAS_SYN_ACK: usize = 64;

/// **El plazo TOTAL de la decisión de retirada (v2.8)**: cubre la espera
/// del acuse Y la verificación de terminación si el acuse se pierde —
/// prohibido un `join()` sin límite tras el timeout (una espera
/// ilimitada disfrazada de plazo no es plazo). Vencido con el hilo vivo,
/// `apagar()` devuelve «retirada no confirmada» DENTRO del plazo y el
/// `JoinHandle` queda bajo seguimiento en el propietario compartido.
/// Los bancos inyectan su propio plazo (~200 ms) con `apagar_con_plazo`.
pub const PLAZO_APAGADO: Duration = Duration::from_secs(15);

/// La marca de una retirada **no confirmada**: el texto que los bancos
/// (y el supervisor) reconocen. Terminar el hilo no es lo mismo que
/// liberar la interfaz: sin un resultado de cierre registrado, la
/// retirada no se da por hecha y el mismo fd no se vuelve a reclamar.
pub const RETIRADA_NO_CONFIRMADA: &str = "retirada no confirmada";

// ── El estado de la sesión (puro, purgable, banqueable) ─────────────────────

struct ColaConn {
    tcp: TcpConn,
    queue: Vec<u8>,
    rst: bool,
}

/// El estado mux de la cadena, separado del transporte pa que la purga sea
/// una operación de estado — y pa que los bancos la fijen sin hardware.
pub struct EstadoSesion {
    mux_version: u8,
    mux_tx_seq: u16,
    rx: Vec<u8>,
    conns: HashMap<u16, ColaConn>,
    by_id: HashMap<u32, u16>,
    next_id: u32,
}

impl EstadoSesion {
    fn nueva(mux_version: u8, rx: Vec<u8>) -> Self {
        Self {
            mux_version,
            mux_tx_seq: 1,
            rx,
            conns: HashMap::new(),
            by_id: HashMap::new(),
            next_id: 1,
        }
    }

    /// **La purga**: fuera conexiones, fuera IDs, fuera bytes resto; los
    /// contadores vuelven a su nacimiento. Tras purgar, ningún frame de una
    /// sesión muerta tiene dueño al que entregarse. Devuelve
    /// `(bytes_descartados, conexiones_descartadas)` pa el registro.
    pub fn purgar(&mut self) -> (usize, usize) {
        let bytes = self.rx.len();
        let conns = self.conns.len();
        self.conns.clear();
        self.by_id.clear();
        self.rx.clear();
        self.next_id = 1;
        self.mux_tx_seq = 1;
        (bytes, conns)
    }

    /// La conexión dueña de una trama TCP (por puertos), si vive.
    fn duena(&self, frame: &[u8]) -> Option<u16> {
        for (sport, conn) in self.conns.iter() {
            let mux_len = conn.tcp.mux_header_len();
            if frame.len() >= mux_len + 4 {
                let src = u16::from_be_bytes([frame[mux_len], frame[mux_len + 1]]);
                let dst = u16::from_be_bytes([frame[mux_len + 2], frame[mux_len + 3]]);
                if src == conn.tcp.dport && dst == conn.tcp.sport {
                    return Some(*sport);
                }
            }
        }
        None
    }
}

// ── El núcleo síncrono de la sesión (sobre cualquier BulkTransport) ─────────

pub struct NucleoCadena<T: BulkTransport> {
    io: T,
    eps: Endpoints,
    estado: EstadoSesion,
}

impl<T: BulkTransport> NucleoCadena<T> {
    /// Abre la sesión FRESCA: saludo VERSION tolerante a frames ajenos (el
    /// de la vía 1) → SETUP si v2 → **purga del resto del saludo**. El
    /// transporte debe venir recién preparado (`open_mux_transport` en
    /// vivo: su SET_CONFIGURATION ya reinició la sesión mux del iPhone).
    pub fn abrir(mut io: T, eps: Endpoints) -> Result<Self, String> {
        let mut rx: Vec<u8> = Vec::new();
        let mux_version = exchange_version(&mut io, &eps, &mut rx)?;
        if mux_version >= 2 {
            io.bulk_out(eps.ep_out, &build_mux_setup_packet_v2())?;
        }
        let mut nucleo = Self {
            io,
            eps,
            estado: EstadoSesion::nueva(mux_version, rx),
        };
        // Purga de nacimiento: ninguna conexión de la cadena existe aún —
        // todo byte resto en el búfer es de una sesión muerta.
        let (bytes, _) = nucleo.purgar();
        if bytes > 0 {
            crate::stage(&format!(
                "[cadena] purga tras el saludo: {} bytes resto de sesiones muertas descartados — la cadena arranca con el búfer limpio",
                bytes
            ));
        }
        Ok(nucleo)
    }

    pub fn mux_version(&self) -> u8 {
        self.estado.mux_version
    }

    /// **El cierre explícito COMPROBADO del transporte (v2.8)**: lo corre
    /// el hilo dueño al apagar, ANTES de soltar el núcleo, y su resultado
    /// es el que acredita (o no) la liberación de la interfaz sobre el fd
    /// compartido. El `Drop` posterior del transporte es solo el respaldo
    /// best-effort: jamás sustituye a este resultado. (No confundir con
    /// `cerrar(id)`, que cierra una conexión de la sesión.)
    pub fn cerrar_transporte(&mut self) -> Result<(), String> {
        self.io.cerrar()
    }

    /// Purga el estado a mitad de camino (la misma operación del nacimiento,
    /// disponible pa el ciclo de vida de la sesión).
    pub fn purgar(&mut self) -> (usize, usize) {
        self.estado.purgar()
    }

    /// Siguiente frame mux completo, leyendo del transporte lo que falte.
    fn leer_frame(&mut self) -> Result<(u32, Vec<u8>), String> {
        loop {
            if let Some(r) = take_frame(&mut self.estado.rx) {
                return r;
            }
            let chunk = self.io.bulk_in(self.eps.ep_in, idevice_usb_core::READ_BUF)?;
            if chunk.is_empty() {
                return Err("bulk IN devolvió 0 bytes".into());
            }
            self.estado.rx.extend_from_slice(&chunk);
        }
    }

    /// Lee UNA trama del cable y la entrega a la cola de su conexión.
    /// Devuelve Ok(false) si solo llegaron tramas de control/versión.
    fn pump_one(&mut self) -> Result<bool, String> {
        let (protocol, frame) = self.leer_frame()?;
        match protocol {
            MUX_PROTO_CONTROL => {
                let mux_len = if self.estado.mux_version >= 2 { 16 } else { 8 };
                if frame.len() > mux_len {
                    let body = String::from_utf8_lossy(&frame[mux_len..]);
                    crate::stage(&format!(
                        "[cadena] CONTROL del iPhone: {}",
                        body.trim()
                    ));
                }
                Ok(false)
            }
            MUX_PROTO_VERSION => {
                crate::stage("[cadena] VERSION duplicada descartada");
                Ok(false)
            }
            MUX_PROTO_TCP => {
                self.deliver(frame)?;
                Ok(true)
            }
            p => Err(format!(
                "mux: protocolo inesperado {} (se esperaba TCP {})",
                p, MUX_PROTO_TCP
            )),
        }
    }

    /// Entrega una trama TCP a la conexión dueña (por puertos), manda su
    /// ACK y encola el payload. Las tramas sin dueña — restos de sesiones
    /// muertas o de conexiones ya cerradas — se descartan: tras la purga,
    /// lo ajeno no tiene a quién contaminar.
    fn deliver(&mut self, frame: Vec<u8>) -> Result<(), String> {
        let sport = match self.estado.duena(&frame) {
            Some(s) => s,
            None => return Ok(()), // conexión ajena o ya cerrada: se descarta
        };
        let mux_len = self.estado.conns[&sport].tcp.mux_header_len();
        if frame.len() < mux_len + 20 {
            return Err(format!("mux: trama TCP corta ({} bytes)", frame.len()));
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
            self.estado.conns.get_mut(&sport).expect("conexión localizada").rst = true;
            return Ok(());
        }
        // ACK con el TcpConn dueño: se extrae un instante pa no pelear el
        // préstamo del mapa con el contador de transmisión de la sesión.
        let mut conn = self.estado.conns.remove(&sport).expect("conexión localizada");
        if conn.tcp.mux_version >= 2 && frame.len() >= 16 {
            conn.tcp.mux_rx_seq = u16::from_be_bytes([frame[14], frame[15]]);
        }
        conn.tcp.ack = peer_seq.wrapping_add(payload_len);
        let r = conn.tcp.send_ack(&mut self.io, &self.eps, &mut self.estado.mux_tx_seq);
        if payload_len > 0 {
            conn.queue.extend_from_slice(&frame[header_len..]);
        }
        self.estado.conns.insert(sport, conn);
        r
    }

    /// Abre una pseudo-TCP nueva con la disciplina de `MuxPipe`: el SYN-ACK
    /// se espera **verificando puertos** (un SYN-ACK ajeno se entrega a su
    /// dueña o se descarta, jamás se toma por el nuestro), las tramas
    /// CONTROL quedan en el registro, y un RST a nuestra conexión aborta
    /// con su causa.
    pub fn abrir_conexion(&mut self, dport: u16) -> Result<u32, String> {
        let mut conn = TcpConn::new_ready_for_syn(self.estado.mux_version, dport);
        let syn = conn.build_mux_tcp_packet(&mut self.estado.mux_tx_seq, TH_SYN, &[]);
        self.io.bulk_out(self.eps.ep_out, &syn)?;
        let mux_len = conn.mux_header_len();
        let mut skipped = 0usize;
        loop {
            let (protocol, frame) = self.leer_frame()?;
            match protocol {
                MUX_PROTO_TCP => {
                    if frame.len() < mux_len + 20 {
                        skipped += 1;
                        crate::stage(&format!(
                            "[cadena] trama TCP corta ({} bytes) saltada esperando el SYN-ACK",
                            frame.len()
                        ));
                    } else {
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
                                let ack_pkt = conn.finish_handshake_ack_packet(
                                    &frame,
                                    &mut self.estado.mux_tx_seq,
                                )?;
                                self.io.bulk_out(self.eps.ep_out, &ack_pkt)?;
                                let sport = conn.sport;
                                let id = self.estado.next_id;
                                self.estado.next_id += 1;
                                self.estado.conns.insert(
                                    sport,
                                    ColaConn {
                                        tcp: conn,
                                        queue: Vec::new(),
                                        rst: false,
                                    },
                                );
                                self.estado.by_id.insert(id, sport);
                                return Ok(id);
                            }
                            skipped += 1;
                        } else {
                            // Trama de otra conexión: a su cola (o al olvido).
                            self.deliver(frame)?;
                        }
                    }
                }
                MUX_PROTO_CONTROL => {
                    skipped += 1;
                    if frame.len() > mux_len {
                        let body = String::from_utf8_lossy(&frame[mux_len..]);
                        crate::stage(&format!(
                            "[cadena] CONTROL del iPhone esperando el SYN-ACK: {}",
                            body.trim()
                        ));
                    }
                }
                MUX_PROTO_VERSION => {
                    skipped += 1;
                    crate::stage("[cadena] VERSION duplicada saltada esperando el SYN-ACK");
                }
                p => return Err(format!("mux: protocolo inesperado {} abriendo conexión", p)),
            }
            if skipped > MAX_SALTADAS_SYN_ACK {
                return Err("mux: demasiadas tramas ajenas esperando el SYN-ACK".into());
            }
        }
    }

    pub fn escribir(&mut self, id: u32, data: &[u8]) -> Result<(), String> {
        let sport = *self
            .estado
            .by_id
            .get(&id)
            .ok_or_else(|| "conexión desconocida".to_string())?;
        // `TcpConn::send` necesita &mut del conn y &mut del contador a la
        // vez: se extrae el conn del mapa un instante y se devuelve.
        let mut conn = self
            .estado
            .conns
            .remove(&sport)
            .ok_or_else(|| "conexión cerrada".to_string())?;
        let r = conn
            .tcp
            .send(&mut self.io, &self.eps, &mut self.estado.mux_tx_seq, data);
        self.estado.conns.insert(sport, conn);
        r
    }

    /// Saca hasta `max` bytes de la cola de la conexión, bombeando el cable
    /// hasta que haya datos, la conexión se resetee o el transporte falle.
    /// (La lectura bloqueante del núcleo: el hilo async sirve sus lecturas
    /// con `try_read` + `pump_one` pa no bloquear los comandos; esta es la
    /// forma directa que fijan los bancos.)
    #[allow(dead_code)]
    pub fn leer(&mut self, id: u32, max: usize) -> Result<Vec<u8>, String> {
        loop {
            if let Some(r) = self.try_read(id, max) {
                return r;
            }
            if !self.estado.by_id.contains_key(&id) {
                return Err("conexión desconocida".into());
            }
            self.pump_one()?;
        }
    }

    /// Intento de lectura sin bombear: solo lo ya encolado.
    fn try_read(&mut self, id: u32, max: usize) -> Option<Result<Vec<u8>, String>> {
        let sport = *self.estado.by_id.get(&id)?;
        let conn = self.estado.conns.get_mut(&sport)?;
        if !conn.queue.is_empty() {
            let n = conn.queue.len().min(max);
            return Some(Ok(conn.queue.drain(..n).collect()));
        }
        if conn.rst {
            return Some(Ok(Vec::new()));
        }
        None
    }

    pub fn cerrar(&mut self, id: u32) {
        if let Some(sport) = self.estado.by_id.remove(&id) {
            self.estado.conns.remove(&sport);
        }
    }
}

// ── Hilo dueño de la sesión + comandos (el puente sync→async) ───────────────

enum CadenaCmd {
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
    /// **Apagado con acuse del resultado (v2.8)**: el hilo dueño corre el
    /// cierre explícito comprobado del transporte, guarda su resultado
    /// en el slot compartido (sobrevive a este canal), suelta el núcleo
    /// y SOLO DESPUÉS responde por este canal CON ESE RESULTADO — un
    /// acuse con `Err` es un acuse, no un éxito: quien espera sabe si la
    /// interfaz quedó liberada o por qué no. Es el patrón del
    /// `HubCmd::Shutdown` del hub, que la etapa «conexion» ya usa pa que
    /// la cadena reclame su interfaz sin pisar la del hub.
    Apagar {
        reply: Sender<Result<(), String>>,
    },
}

/// El estado de la ÚNICA operación de retirada de una sesión (v2.8).
/// Todos los clones del handle observan la misma operación: el primero
/// que apaga es el ejecutor; los demás esperan su resultado publicado.
/// «En curso» es un estado observable, NUNCA un éxito por defecto.
#[derive(Clone)]
enum OpRetirada {
    NoIniciada,
    EnCurso,
    Resuelta(Result<(), String>),
}

/// **El propietario compartido del apagado (v2.8)** — lo que la v2.7 no
/// conservaba: el `JoinHandle` del hilo dueño (bajo seguimiento hasta
/// que la retirada se resuelve; jamás se pierde ni lo consume un clon
/// por su cuenta), el slot con el resultado del cierre explícito que el
/// propio hilo registra (sobrevive a la pérdida del acuse) y el estado
/// de la operación única de retirada con su resultado publicado.
struct ApagadoCompartido {
    datos: Mutex<DatosApagado>,
    listo: Condvar,
}

struct DatosApagado {
    /// El hilo dueño, bajo seguimiento: se consulta con `is_finished`
    /// (sin bloquear, dentro del plazo) y NO se extrae — perderlo sería
    /// perder el medio de verificar la terminación.
    hilo: Option<JoinHandle<()>>,
    /// El resultado del cierre explícito, registrado por el hilo dueño
    /// al ejecutar el apagado, ANTES de soltar el núcleo y de acusar.
    slot_cierre: Option<Result<(), String>>,
    op: OpRetirada,
    /// El plazo total de la decisión de retirada: `PLAZO_APAGADO` en
    /// producción; los bancos lo inyectan con `fijar_plazo_apagado`.
    plazo: Duration,
}

impl ApagadoCompartido {
    fn nuevo() -> Self {
        Self {
            datos: Mutex::new(DatosApagado {
                hilo: None,
                slot_cierre: None,
                op: OpRetirada::NoIniciada,
                plazo: PLAZO_APAGADO,
            }),
            listo: Condvar::new(),
        }
    }

    /// El hilo dueño registra el resultado de su cierre explícito.
    fn registrar_cierre(&self, r: Result<(), String>) {
        let mut d = self.datos.lock().unwrap_or_else(|p| p.into_inner());
        d.slot_cierre = Some(r);
    }

    fn slot_cierre(&self) -> Option<Result<(), String>> {
        self.datos
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .slot_cierre
            .clone()
    }

    /// ¿El hilo dueño ya terminó? (Sin bloquear: `is_finished` no
    /// consume el handle — el medio de verificación no se pierde.)
    fn hilo_terminado(&self) -> bool {
        let d = self.datos.lock().unwrap_or_else(|p| p.into_inner());
        match &d.hilo {
            Some(h) => h.is_finished(),
            None => false,
        }
    }

    /// Publica el resultado terminal de la operación y despierta a los
    /// clones que lo observan. Publicar es UNA sola vez: lo primero que
    /// se resuelve manda (un resultado tardío del hilo va al slot, no
    /// reescribe la operación ya fallida).
    fn publicar(&self, r: Result<(), String>) {
        {
            let mut d = self.datos.lock().unwrap_or_else(|p| p.into_inner());
            if matches!(d.op, OpRetirada::Resuelta(_)) {
                return;
            }
            d.op = OpRetirada::Resuelta(r);
        }
        self.listo.notify_all();
    }
}

#[derive(Clone)]
pub struct CadenaHandle {
    tx: Sender<CadenaCmd>,
    apagado: Arc<ApagadoCompartido>,
}

impl std::fmt::Debug for CadenaHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CadenaHandle")
    }
}

/// Abre la sesión mux FRESCA de la cadena (síncrono: el error del saludo se
/// devuelve aquí) y arranca el hilo dueño de la sesión. Genérico sobre el
/// transporte (v2.7): en vivo es el `FdTransport` de siempre; en los bancos,
/// un transporte guionizado que modela el claim del fd compartido. El
/// `JoinHandle` del hilo queda guardado en el propietario compartido
/// (v2.8): hasta la v2.7 se descartaba al nacer y nadie podía verificar
/// la terminación del hilo si el acuse se perdía.
pub fn spawn_cadena<T>(io: T, eps: Endpoints) -> Result<CadenaHandle, String>
where
    T: BulkTransport + Send + 'static,
{
    let nucleo = NucleoCadena::abrir(io, eps)?;
    crate::stage(&format!(
        "[cadena] sesión mux FRESCA abierta pa la cadena (versión {}) — sin estado heredado del hub ni de la puerta",
        nucleo.mux_version()
    ));
    let (tx, rx) = channel::<CadenaCmd>();
    let apagado = Arc::new(ApagadoCompartido::nuevo());
    let apagado_hilo = apagado.clone();
    let hilo = std::thread::Builder::new()
        .name("anfitrion-mux-cadena".into())
        .spawn(move || cadena_loop(nucleo, rx, apagado_hilo))
        .map_err(|e| format!("no se pudo arrancar el hilo de la cadena: {}", e))?;
    apagado
        .datos
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .hilo = Some(hilo);
    Ok(CadenaHandle { tx, apagado })
}

fn cadena_loop<T: BulkTransport>(
    mut nucleo: NucleoCadena<T>,
    rx: Receiver<CadenaCmd>,
    apagado: Arc<ApagadoCompartido>,
) {
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
                CadenaCmd::Open { dport, reply } => {
                    let _ = reply.send(nucleo.abrir_conexion(dport));
                }
                CadenaCmd::Write { id, data, reply } => {
                    let _ = reply.send(nucleo.escribir(id, &data));
                }
                CadenaCmd::Read { id, max, reply } => {
                    pending_reads.push((id, max, reply));
                }
                CadenaCmd::Close { id } => nucleo.cerrar(id),
                CadenaCmd::Apagar { reply } => {
                    // Las lecturas pendientes mueren con su causa: la
                    // sesión se retira y nadie queda esperando del cable.
                    for (_, _, r) in pending_reads.drain(..) {
                        let _ = r.send(Err(
                            "la sesión de la cadena se retiró (re-preparación del supervisor)"
                                .to_string(),
                        ));
                    }
                    // **El cierre explícito COMPROBADO (v2.8), en el hilo
                    // dueño y ANTES de soltar el núcleo**: su resultado
                    // es el que acredita la liberación — queda guardado
                    // en el slot compartido (sobrevive a la pérdida de
                    // este acuse) y viaja en el acuse mismo. El Drop del
                    // transporte al soltar el núcleo es solo el respaldo
                    // best-effort: jamás sustituye a este resultado.
                    // Soltar ANTES de responder — el orden del Shutdown
                    // del hub — pa que quien re-prepara tras un acuse
                    // `Ok` reclame sobre un fd ya libre, sin que una
                    // liberación tardía le tumbe el claim nuevo (el
                    // fallo que la v2.7 cierra).
                    let resultado = nucleo.cerrar_transporte();
                    apagado.registrar_cierre(resultado.clone());
                    drop(nucleo);
                    let _ = reply.send(resultado);
                    return;
                }
            }
        }
        // 2) Servir lecturas con lo encolado.
        if !pending_reads.is_empty() {
            let mut rest = Vec::new();
            for (id, max, reply) in pending_reads.drain(..) {
                match nucleo.try_read(id, max) {
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
            match nucleo.pump_one() {
                Ok(_) => {
                    let mut rest = Vec::new();
                    for (id, max, reply) in pending_reads.drain(..) {
                        match nucleo.try_read(id, max) {
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

impl CadenaHandle {
    /// **Apaga la sesión con confirmación y PLAZO TOTAL (v2.8)**: manda
    /// el apagado al hilo dueño y espera su acuse — pero el acuse ya no
    /// es un `()`: trae el resultado REAL del cierre explícito del
    /// transporte, y la espera entera (acuse + verificación si el acuse
    /// se pierde) cabe en `PLAZO_APAGADO`. Cuando devuelve `Ok`, el hilo
    /// soltó el transporte y la liberación quedó ACREDITADA por el
    /// cierre comprobado; cuando devuelve `Err`, la causa viene con él
    /// — o la marca `RETIRADA_NO_CONFIRMADA` si no hubo forma de
    /// acreditarla. Es la pieza que le faltaba al supervisor: hasta la
    /// v2.6 el handle solo se soltaba (el hilo moría cuando caía el
    /// último clon del canal, a su aire), y esa liberación tardía podía
    /// caer DESPUÉS de que la re-preparación reclamara la interfaz con
    /// el transporte nuevo sobre el mismo fd — un RELEASEINTERFACE
    /// contra el claim nuevo: el error 19 a mitad de escritura de la
    /// v2.5, resucitado por el propio rescate. Con el apagado síncrono
    /// el orden quedó garantizado (v2.7: liberar el viejo → reclamar el
    /// nuevo); con el acuse del resultado y el plazo, la garantía es
    /// además VERIFICABLE: nada se da por liberado sin su `Ok`.
    pub fn apagar(&self) -> Result<(), String> {
        let plazo = self
            .apagado
            .datos
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .plazo;
        self.apagar_con_plazo(plazo)
    }

    /// Inyecta el plazo total de la decisión de retirada (los bancos
    /// usan ~200 ms; la producción corre con `PLAZO_APAGADO`). Vive en
    /// el propietario compartido: todos los clones deciden con el mismo
    /// plazo, lo fije quien lo fije.
    pub fn fijar_plazo_apagado(&self, plazo: Duration) {
        self.apagado
            .datos
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .plazo = plazo;
    }

    /// `apagar()` con el plazo inyectado (los bancos usan ~200 ms; la
    /// producción, `PLAZO_APAGADO` vía `apagar()`).
    ///
    /// **Una sola operación coordina a todos los clones**: el primer
    /// clon que apaga es el ejecutor; los demás observan el estado
    /// compartido y reciben el MISMO resultado publicado — nunca un
    /// éxito por defecto, nunca un «ya se solicitó». Si el plazo vence
    /// mientras la operación sigue en curso, el observador devuelve
    /// «retirada no confirmada» (un estado explícito, no un éxito).
    pub fn apagar_con_plazo(&self, plazo: Duration) -> Result<(), String> {
        let inicio = Instant::now();
        // ¿Ejecutor u observador? Una sola operación por sesión.
        let soy_ejecutor = {
            let mut d = self
                .apagado
                .datos
                .lock()
                .unwrap_or_else(|p| p.into_inner());
            match &d.op {
                OpRetirada::Resuelta(r) => return r.clone(),
                OpRetirada::EnCurso => false,
                OpRetirada::NoIniciada => {
                    d.op = OpRetirada::EnCurso;
                    true
                }
            }
        };
        if soy_ejecutor {
            let r = self.ejecutar_apagado(plazo, inicio);
            self.apagado.publicar(r.clone());
            return r;
        }
        // Observador: esperar el resultado publicado dentro de MI plazo.
        let mut d = self
            .apagado
            .datos
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        loop {
            if let OpRetirada::Resuelta(r) = &d.op {
                return r.clone();
            }
            let restante = plazo.saturating_sub(inicio.elapsed());
            if restante.is_zero() {
                return Err(format!(
                    "{}: la operación de retirada sigue en curso al vencer el plazo",
                    RETIRADA_NO_CONFIRMADA
                ));
            }
            let (g, _) = self
                .apagado
                .listo
                .wait_timeout(d, restante)
                .unwrap_or_else(|p| p.into_inner());
            d = g;
        }
    }

    /// El brazo ejecutor de `apagar_con_plazo`: manda el comando, espera
    /// el acuse dentro del plazo y, si el acuse se pierde, resuelve con
    /// lo verificable — el resultado registrado en el slot manda; el
    /// hilo terminado sin registro es «no confirmada» (terminación ≠
    /// liberación); el plazo vencido con el hilo vivo es «no
    /// confirmada» devuelta DENTRO del plazo, con el `JoinHandle` bajo
    /// seguimiento (no se pierde ni se hace `join()` sin límite).
    fn ejecutar_apagado(&self, plazo: Duration, inicio: Instant) -> Result<(), String> {
        let (tx, rx) = channel::<Result<(), String>>();
        if self.tx.send(CadenaCmd::Apagar { reply: tx }).is_err() {
            // El hilo ya no escucha: se resuelve con lo verificable.
            return self.resolver_sin_acuse(plazo, inicio);
        }
        let restante = plazo.saturating_sub(inicio.elapsed());
        match rx.recv_timeout(restante) {
            Ok(r) => r,
            Err(_) => self.resolver_sin_acuse(plazo, inicio),
        }
    }

    /// La resolución cuando el acuse no llegó (canal roto o plazo
    /// vencido esperando): (a) si el hilo registró su resultado de
    /// cierre en el slot compartido, ESE resultado manda; (b) si el hilo
    /// terminó sin registrar ninguno → no confirmada; (c) si el hilo
    /// sigue vivo → se espera, SIN PASARSE del plazo total, a que
    /// registre o termine; vencido el plazo con el hilo vivo → no
    /// confirmada, devuelta dentro del plazo.
    fn resolver_sin_acuse(&self, plazo: Duration, inicio: Instant) -> Result<(), String> {
        loop {
            if let Some(r) = self.apagado.slot_cierre() {
                return r;
            }
            if self.apagado.hilo_terminado() {
                return Err(format!(
                    "{}: el hilo de la cadena terminó sin registrar el resultado de la liberación (terminar no es liberar)",
                    RETIRADA_NO_CONFIRMADA
                ));
            }
            if inicio.elapsed() >= plazo {
                return Err(format!(
                    "{}: venció el plazo de {} ms con el hilo de la cadena aún vivo; el hilo queda bajo seguimiento y esta operación no autoriza ningún reemplazo",
                    RETIRADA_NO_CONFIRMADA,
                    plazo.as_millis()
                ));
            }
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    /// ¿El hilo dueño de la sesión ya terminó? El medio de verificación
    /// de la terminación (v2.8): el `JoinHandle` vive en el propietario
    /// compartido y consultarlo no lo consume.
    pub fn hilo_terminado(&self) -> bool {
        self.apagado.hilo_terminado()
    }

    pub async fn open(&self, dport: u16) -> Result<u32, String> {
        let (tx, rx) = oneshot::channel();
        self.tx
            .send(CadenaCmd::Open { dport, reply: tx })
            .map_err(|_| "el hilo de la cadena no responde".to_string())?;
        rx.await
            .map_err(|_| "el hilo de la cadena cerró sin responder".to_string())?
    }

    pub fn stream(&self, id: u32) -> CadenaStream {
        CadenaStream {
            handle: self.clone(),
            id,
            read_rx: None,
            read_buf: VecDeque::new(),
            write_rx: None,
            write_len: 0,
        }
    }
}

// ── Stream tokio sobre una conexión de la sesión de la cadena ───────────────

pub struct CadenaStream {
    handle: CadenaHandle,
    id: u32,
    read_rx: Option<oneshot::Receiver<Result<Vec<u8>, String>>>,
    read_buf: VecDeque<u8>,
    write_rx: Option<oneshot::Receiver<Result<(), String>>>,
    write_len: usize,
}

impl std::fmt::Debug for CadenaStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CadenaStream").field("id", &self.id).finish()
    }
}

fn io_err(msg: String) -> io::Error {
    io::Error::new(io::ErrorKind::Other, msg)
}

impl AsyncRead for CadenaStream {
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
                        .send(CadenaCmd::Read {
                            id: self.id,
                            max: READ_CHUNK,
                            reply: tx,
                        })
                        .is_err()
                    {
                        return Poll::Ready(Err(io_err(
                            "el hilo de la cadena no responde".into(),
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
                            "el hilo de la cadena cerró sin responder".into(),
                        )));
                    }
                },
            }
        }
    }
}

impl AsyncWrite for CadenaStream {
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
                .send(CadenaCmd::Write {
                    id: self.id,
                    data: buf.to_vec(),
                    reply: tx,
                })
                .is_err()
            {
                return Poll::Ready(Err(io_err("el hilo de la cadena no responde".into())));
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
                Poll::Ready(Err(io_err("el hilo de la cadena cerró sin responder".into())))
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
        let _ = self.handle.tx.send(CadenaCmd::Close { id: self.id });
        Poll::Ready(Ok(()))
    }
}

// ── Bancos ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Copy, PartialEq)]
    enum RespuestaSyn {
        SynAck,
        Rst,
    }

    /// El «iPhone» de banco: transporte simulado que responde al SYN de una
    /// conexión nueva con su SYN-ACK (o su RST) y el guion de tramas que el
    /// banco le encargue, construidas pa el sport que el SYN traiga — el
    /// baile real del mux, sin hardware.
    struct TransporteFalso {
        entrantes: VecDeque<Vec<u8>>,
        enviados: Vec<Vec<u8>>,
        guion_syn: Vec<(u8, Vec<u8>)>,
        respuesta_syn: RespuestaSyn,
        seq_mux_par: u16,
    }

    impl TransporteFalso {
        fn nuevo(entrantes: Vec<Vec<u8>>) -> Self {
            Self {
                entrantes: VecDeque::from(entrantes),
                enviados: Vec::new(),
                guion_syn: Vec::new(),
                respuesta_syn: RespuestaSyn::SynAck,
                seq_mux_par: 1,
            }
        }
    }

    /// Un extremo «iPhone» pa construir tramas: sport = el servicio,
    /// dport = el sport de la conexión del anfitrión.
    fn par_iphone(servicio: u16, destino: u16) -> TcpConn {
        TcpConn {
            sport: servicio,
            dport: destino,
            seq: 1000,
            ack: 0,
            mux_version: 2,
            mux_rx_seq: 0xFFFF,
            pending_tls_in: Vec::new(),
        }
    }

    impl BulkTransport for TransporteFalso {
        fn bulk_out(&mut self, _ep_num: u8, data: &[u8]) -> Result<(), String> {
            self.enviados.push(data.to_vec());
            // ¿Es el SYN de una conexión nueva? (proto TCP, flags = SYN pelado)
            if data.len() >= 16 + 20 {
                let proto = u32::from_be_bytes(data[0..4].try_into().unwrap());
                let flags = data[16 + 13];
                if proto == MUX_PROTO_TCP && flags == TH_SYN {
                    let sport = u16::from_be_bytes([data[16], data[17]]);
                    let dport = u16::from_be_bytes([data[18], data[19]]);
                    let mut par = par_iphone(dport, sport);
                    match self.respuesta_syn {
                        RespuestaSyn::SynAck => {
                            let synack = par.build_mux_tcp_packet(
                                &mut self.seq_mux_par,
                                TH_SYN | TH_ACK,
                                &[],
                            );
                            self.entrantes.push_back(synack);
                            for (fl, payload) in self.guion_syn.clone() {
                                let f =
                                    par.build_mux_tcp_packet(&mut self.seq_mux_par, fl, &payload);
                                par.seq = par.seq.wrapping_add(payload.len() as u32);
                                self.entrantes.push_back(f);
                            }
                        }
                        RespuestaSyn::Rst => {
                            let rst =
                                par.build_mux_tcp_packet(&mut self.seq_mux_par, TH_RST, &[]);
                            self.entrantes.push_back(rst);
                        }
                    }
                }
            }
            Ok(())
        }
        fn bulk_in(&mut self, _ep_num: u8, _max_len: usize) -> Result<Vec<u8>, String> {
            self.entrantes
                .pop_front()
                .ok_or_else(|| "sin datos (timeout simulado)".to_string())
        }
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

    fn nucleo(entrantes: Vec<Vec<u8>>) -> NucleoCadena<TransporteFalso> {
        NucleoCadena::abrir(TransporteFalso::nuevo(entrantes), eps())
            .expect("la sesión de la cadena debe abrir")
    }

    /// **EL INVARIANTE DE LA v2.4**: la cadena construye su transporte desde
    /// la secuencia fresca (saludo propio sobre transporte nuevo), NO desde
    /// la sesión del hub — y un frame TCP resto de una sesión muerta, llegado
    /// ANTES de VERSION en la misma transferencia, se descarta en el saludo:
    /// jamás se entrega como datos de la primera conexión de la cadena.
    #[test]
    fn transporte_fresco_descarta_el_frame_de_la_sesion_muerta() {
        // Frame TCP de una sesión anterior (payload «VIEJO») + VERSION, en
        // la misma transferencia, el muerto primero — el veneno de la v2.3.
        let mut muerto = par_iphone(62078, 0xC999);
        let mut seq = 1u16;
        let frame_viejo = muerto.build_mux_tcp_packet(&mut seq, TH_ACK, b"VIEJO");
        let mut chunk = frame_viejo;
        chunk.extend_from_slice(&version_reply(2));

        let mut t = TransporteFalso::nuevo(vec![chunk]);
        t.guion_syn = vec![(TH_ACK, b"NUEVO".to_vec())];
        let mut n = NucleoCadena::abrir(t, eps()).expect("saludo fresco");
        assert_eq!(n.mux_version(), 2);

        let id = n.abrir_conexion(62078).expect("la conexión de la cadena abre");
        let datos = n.leer(id, 64).expect("lectura de la conexión");
        assert_eq!(datos, b"NUEVO".to_vec());
        // Y nada más: el payload muerto nunca existió pa la cadena.
        assert!(n.try_read(id, 64).is_none());
    }

    /// La purga tras el saludo: bytes resto que llegaron pegados a la
    /// respuesta VERSION (una trama parcial de la sesión muerta) no quedan
    /// en el búfer de la cadena — el búfer nace limpio.
    #[test]
    fn purga_tras_el_saludo_deja_el_bufer_limpio() {
        let mut chunk = version_reply(2);
        chunk.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF, 0x01, 0x02, 0x03]); // resto parcial
        let n = nucleo(vec![chunk]);
        assert!(
            n.estado.rx.is_empty(),
            "el búfer de la cadena debe nacer purgado, trae {} bytes",
            n.estado.rx.len()
        );
        assert!(n.estado.conns.is_empty());
        assert!(n.estado.by_id.is_empty());
    }

    /// La purga como operación de estado: conexiones vivas, IDs y bytes
    /// resto desaparecen; los contadores vuelven a su nacimiento; y un frame
    /// tardío de la conexión purgada ya no tiene dueña — se descarta.
    #[test]
    fn purga_descarta_conexiones_ids_y_frames_huerfanos() {
        let mut n = nucleo(vec![version_reply(2)]);
        let id = n.abrir_conexion(62078).expect("conexión abierta");
        // Ruido en el búfer y una trama encolada pa la conexión.
        n.estado.rx.extend_from_slice(&[9, 9, 9]);
        let sport = *n.estado.by_id.get(&id).unwrap();
        {
            let conn = n.estado.conns.get_mut(&sport).unwrap();
            conn.queue.extend_from_slice(b"EN COLA");
        }
        let (bytes, conns) = n.purgar();
        assert_eq!(bytes, 3);
        assert_eq!(conns, 1);
        assert!(n.estado.conns.is_empty());
        assert!(n.estado.by_id.is_empty());
        assert!(n.estado.rx.is_empty());
        assert_eq!(n.estado.next_id, 1);
        assert_eq!(n.estado.mux_tx_seq, 1);
        // La conexión purgada ya no existe pa leer ni pa recibir.
        assert!(n.leer(id, 16).unwrap_err().contains("desconocida"));
        let mut par = par_iphone(62078, sport);
        let mut seq = 7u16;
        let tardia = par.build_mux_tcp_packet(&mut seq, TH_ACK, b"TARDIO");
        n.deliver(tardia).expect("la trama huérfana se descarta sin error");
        assert!(n.estado.conns.is_empty());
    }

    /// La disciplina del SYN-ACK: una trama CONTROL y un SYN-ACK AJENO
    /// (otros puertos) llegan antes que el nuestro — el ajeno NO se toma
    /// por el SYN-ACK de la conexión nueva (la comprobación de puertos que
    /// el saludo de `MuxPipe` no hace y la cadena sí).
    #[test]
    fn syn_ack_ajeno_no_se_toma_por_el_nuestro() {
        // CONTROL + SYN-ACK de otra conexión, pre-cargados antes del saludo.
        let mut ctrl = vec![0u8; 16];
        ctrl[0..4].copy_from_slice(&MUX_PROTO_CONTROL.to_be_bytes());
        ctrl[4..8].copy_from_slice(&16u32.to_be_bytes());
        let mut ajeno = par_iphone(62078, 0xC555);
        let mut seq = 3u16;
        let synack_ajeno = ajeno.build_mux_tcp_packet(&mut seq, TH_SYN | TH_ACK, &[]);
        let mut n = nucleo(vec![version_reply(2), ctrl, synack_ajeno]);
        // El mock responde al SYN con el SYN-ACK bueno (puertos nuestros).
        let id = n.abrir_conexion(62078).expect("nuestro SYN-ACK llega y abre");
        assert_eq!(id, 1);
        assert_eq!(n.estado.conns.len(), 1);
        // La conexión registrada es la NUESTRA (su sport no es el ajeno).
        let sport = *n.estado.by_id.get(&id).unwrap();
        assert_ne!(sport, 0xC555);
    }

    /// Un RST dirigido a la conexión que se está abriendo aborta la
    /// apertura con su causa (no se cuelga ni se traga en silencio).
    #[test]
    fn rst_abriendo_aborta_con_causa() {
        let mut t = TransporteFalso::nuevo(vec![version_reply(2)]);
        t.respuesta_syn = RespuestaSyn::Rst;
        let mut n = NucleoCadena::abrir(t, eps()).expect("saludo");
        let e = n.abrir_conexion(62078).unwrap_err();
        assert!(e.contains("RST"), "error inesperado: {}", e);
        assert!(n.estado.conns.is_empty());
    }

    /// Un RST sobre una conexión ya abierta se lee como EOF (la semántica
    /// que los clientes del crate esperan de un stream cerrado).
    #[test]
    fn rst_en_conexion_abierta_se_lee_como_eof() {
        let mut n = nucleo(vec![version_reply(2)]);
        let id = n.abrir_conexion(62078).expect("abre");
        let sport = *n.estado.by_id.get(&id).unwrap();
        let mut par = par_iphone(62078, sport);
        let mut seq = 5u16;
        let rst = par.build_mux_tcp_packet(&mut seq, TH_RST, &[]);
        n.deliver(rst).expect("el RST se entrega");
        let datos = n.leer(id, 16).expect("leer tras RST = EOF, no error");
        assert!(datos.is_empty());
    }

    // ── Banco v2.7: el apagado síncrono de la sesión ─────────────────────

    /// El transporte del banco del apagado: modela el fd compartido — su
    /// Drop ES la liberación de la interfaz (lo que el Drop de
    /// `FdTransport` hace con RELEASEINTERFACE sobre el fd), asentada en
    /// un diario compartido junto a cada byte que la sesión mueve.
    struct TransporteDelApagado {
        gen: u32,
        entrantes: VecDeque<Vec<u8>>,
        diario: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
    }

    impl BulkTransport for TransporteDelApagado {
        fn bulk_out(&mut self, _ep_num: u8, _data: &[u8]) -> Result<(), String> {
            self.diario
                .lock()
                .unwrap()
                .push(format!("out:{}", self.gen));
            Ok(())
        }
        fn bulk_in(&mut self, _ep_num: u8, _max_len: usize) -> Result<Vec<u8>, String> {
            self.entrantes
                .pop_front()
                .ok_or_else(|| "sin datos (timeout simulado)".to_string())
        }
    }

    impl Drop for TransporteDelApagado {
        fn drop(&mut self) {
            self.diario
                .lock()
                .unwrap()
                .push(format!("soltar:{}", self.gen));
        }
    }

    /// **El invariante de la v2.7**: `apagar()` no devuelve hasta que la
    /// interfaz de la sesión vieja quedó liberada, y la sesión nueva no
    /// mueve un solo byte antes de esa liberación. Sin el apagado
    /// síncrono (la v2.6 solo soltaba el handle), la liberación llegaba
    /// cuando el hilo viejo muriera a su aire — potencialmente DESPUÉS
    /// del claim de la sesión nueva sobre el mismo fd, tumbándolo.
    #[test]
    fn apagar_sincrono_libera_antes_de_que_la_sesion_nueva_mueva_un_byte() {
        use std::sync::{Arc, Mutex};
        let diario = Arc::new(Mutex::new(Vec::<String>::new()));
        let mk = |gen: u32| TransporteDelApagado {
            gen,
            entrantes: VecDeque::from(vec![version_reply(2)]),
            diario: diario.clone(),
        };
        // Sesión 1 viva y apagado síncrono: al devolver la llamada, la
        // liberación YA está en el diario (no «llegará cuando el hilo
        // muera»): es un hecho, no una esperanza.
        let h1 = spawn_cadena(mk(1), eps()).expect("sesión 1 abre");
        h1.apagar().expect("el apagado se confirma");
        assert!(
            diario.lock().unwrap().contains(&"soltar:1".to_string()),
            "la interfaz quedó liberada ANTES del acuse: {:?}",
            diario.lock().unwrap()
        );
        // El handle retirado queda inerte: abrir una conexión falla en
        // seco, sin tocar el cable.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime del banco");
        let r = rt.block_on(async { h1.open(62078).await });
        assert!(r.is_err(), "un handle apagado no abre conexiones");
        // Sesión 2 (la re-preparación): su primer byte va DESPUÉS de la
        // liberación de la 1 — el orden que el claim compartido exige.
        let h2 = spawn_cadena(mk(2), eps()).expect("sesión 2 abre");
        let d = diario.lock().unwrap().clone();
        let i_soltar = d.iter().position(|e| e == "soltar:1").unwrap();
        let i_out2 = d.iter().position(|e| e == "out:2").unwrap();
        assert!(
            i_soltar < i_out2,
            "la liberación de la vieja precede al primer byte de la nueva: {:?}",
            d
        );
        // Al final de la corrida el handle se suelta como siempre: el
        // hilo muere al caer el último clon y su transporte se libera.
        drop(h2);
        for _ in 0..100 {
            if diario.lock().unwrap().contains(&"soltar:2".to_string()) {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            diario.lock().unwrap().contains(&"soltar:2".to_string()),
            "la sesión 2 también se libera al soltar su handle"
        );
    }

    // ── Bancos v2.8: el apagado CONFIRMADO ─────────────────────────────
    //
    // La v2.7 probaba el orden feliz; estos bancos prueban las ramas de
    // fallo que la revisión por fragmentos (rondas 1–3 + Paso 1) exigió:
    // el resultado real de la liberación viaja y manda; perder el acuse
    // no autoriza nada; terminar no es liberar; una sola operación
    // coordina a los clones.

    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Mutex as StdMutex;

    const CAUSA_RELEASE: &str =
        "RELEASEINTERFACE: No such device (os error 19) (errno 19)";
    const ENODEV_BANCO: &str = "bulk OUT: No such device (os error 19) (errno 19)";

    /// Una barrera de banco: el cierre explícito se queda retenido en
    /// ella hasta que el banco la abre — la pausa forzada justo antes
    /// de la última limpieza del transporte viejo.
    struct Barrera {
        abierta: StdMutex<bool>,
        cv: std::sync::Condvar,
    }

    impl Barrera {
        fn nueva() -> Arc<Self> {
            Arc::new(Self {
                abierta: StdMutex::new(false),
                cv: std::sync::Condvar::new(),
            })
        }
        fn esperar(&self) {
            let mut g = self.abierta.lock().unwrap();
            while !*g {
                g = self.cv.wait(g).unwrap();
            }
        }
        fn abrir(&self) {
            *self.abierta.lock().unwrap() = true;
            self.cv.notify_all();
        }
    }

    /// El transporte guionizado de la v2.8: modela el claim/release del
    /// fd compartido en un diario, con el cierre explícito comprobado
    /// (`BulkTransport::cerrar`) — fallo inyectable y barrera opcionales.
    /// Su `Drop` asienta «drop:{gen}»: el respaldo best-effort, que
    /// jamás debe confundirse con la liberación registrada («release»).
    struct TransporteDelCierre {
        gen: u32,
        entrantes: VecDeque<Vec<u8>>,
        diario: Arc<StdMutex<Vec<String>>>,
        cierres: Arc<AtomicU32>,
        fallo_cierre: Option<String>,
        barrera: Option<Arc<Barrera>>,
    }

    impl TransporteDelCierre {
        fn nuevo(
            gen: u32,
            diario: Arc<StdMutex<Vec<String>>>,
            cierres: Arc<AtomicU32>,
        ) -> Self {
            Self {
                gen,
                entrantes: VecDeque::from(vec![version_reply(2)]),
                diario,
                cierres,
                fallo_cierre: None,
                barrera: None,
            }
        }
        fn anotar(&self, evento: String) {
            self.diario.lock().unwrap().push(evento);
        }
    }

    impl BulkTransport for TransporteDelCierre {
        fn bulk_out(&mut self, _ep_num: u8, _data: &[u8]) -> Result<(), String> {
            self.anotar(format!("out:{}", self.gen));
            Ok(())
        }
        fn bulk_in(&mut self, _ep_num: u8, _max_len: usize) -> Result<Vec<u8>, String> {
            self.entrantes
                .pop_front()
                .ok_or_else(|| "sin datos (timeout simulado)".to_string())
        }
        fn cerrar(&mut self) -> Result<(), String> {
            self.cierres.fetch_add(1, Ordering::SeqCst);
            self.anotar(format!("cierre:{}", self.gen));
            if let Some(b) = &self.barrera {
                b.esperar();
            }
            if let Some(e) = &self.fallo_cierre {
                self.anotar(format!("cierre-falla:{}", self.gen));
                return Err(e.clone());
            }
            self.anotar(format!("release:{}", self.gen));
            Ok(())
        }
    }

    impl Drop for TransporteDelCierre {
        fn drop(&mut self) {
            self.anotar(format!("drop:{}", self.gen));
        }
    }

    fn esperar_hasta<F: Fn() -> bool>(cond: F, que: &str) {
        for _ in 0..300 {
            if cond() {
                return;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        panic!("no se cumplió a tiempo: {}", que);
    }

    /// **Banco 6(a) — el RELEASEINTERFACE falla**: el acuse que llega es
    /// un acuse de ERROR con la causa original del ioctl (no hay acuse
    /// de éxito posible), el resultado queda registrado (una segunda
    /// llamada devuelve el mismo fallo sin reintentar el cierre) y el
    /// medio de verificar la terminación sigue disponible.
    #[test]
    fn banco_a_release_en_error_devuelve_acuse_de_error_con_la_causa() {
        let diario = Arc::new(StdMutex::new(Vec::new()));
        let cierres = Arc::new(AtomicU32::new(0));
        let mut t = TransporteDelCierre::nuevo(1, diario.clone(), cierres.clone());
        t.fallo_cierre = Some(CAUSA_RELEASE.to_string());
        let h = spawn_cadena(t, eps()).expect("la sesión abre");
        let r = h.apagar();
        assert_eq!(
            r,
            Err(CAUSA_RELEASE.to_string()),
            "el acuse trae la causa original del ioctl, no un éxito"
        );
        // Registrado y publicado: la segunda llamada devuelve el fallo
        // sin correr el cierre otra vez.
        assert_eq!(h.apagar(), Err(CAUSA_RELEASE.to_string()));
        assert_eq!(
            cierres.load(Ordering::SeqCst),
            1,
            "el cierre explícito corrió una sola vez"
        );
        let d = diario.lock().unwrap().clone();
        assert!(d.contains(&"cierre-falla:1".to_string()), "diario: {:?}", d);
        assert!(
            !d.contains(&"release:1".to_string()),
            "ninguna liberación se anuncia como hecha: {:?}",
            d
        );
        // El hilo terminó y sigue siendo verificable.
        esperar_hasta(|| h.hilo_terminado(), "el hilo dueño terminó");
    }

    /// **Banco 6(b) variante 1 — se pierde el acuse y el hilo sigue
    /// vivo al vencer el plazo** (el cierre retenido en la barrera):
    /// `apagar` retorna DENTRO del plazo con «retirada no confirmada»,
    /// el `JoinHandle` no se pierde (la terminación se verifica
    /// después, cuando el hilo por fin muere) y la operación ya fallida
    /// no se convierte en éxito cuando el hilo termina tarde.
    #[test]
    fn banco_b1_acuse_perdido_hilo_vivo_devuelve_no_confirmada_en_el_plazo() {
        let diario = Arc::new(StdMutex::new(Vec::new()));
        let cierres = Arc::new(AtomicU32::new(0));
        let barrera = Barrera::nueva();
        let mut t = TransporteDelCierre::nuevo(1, diario.clone(), cierres.clone());
        t.barrera = Some(barrera.clone());
        let h = spawn_cadena(t, eps()).expect("la sesión abre");
        let t0 = Instant::now();
        let r = h.apagar_con_plazo(Duration::from_millis(200));
        let elapsed = t0.elapsed();
        let e = r.unwrap_err();
        assert!(
            e.contains(RETIRADA_NO_CONFIRMADA),
            "sin acuse ni registro, la retirada no se confirma: {}",
            e
        );
        assert!(
            elapsed < Duration::from_secs(2),
            "la decisión volvió dentro del plazo, no tras un join sin límite: {:?}",
            elapsed
        );
        // El medio de verificar la terminación NO se perdió: el hilo
        // sigue vivo (retenido) y localizable.
        assert!(!h.hilo_terminado(), "el hilo sigue vivo tras la barrera");
        barrera.abrir();
        esperar_hasta(|| h.hilo_terminado(), "el hilo terminó tras abrir la barrera");
        // La operación ya fallida no autoriza nada después: el resultado
        // publicado sigue siendo el fallo, aunque el hilo cerró tarde.
        assert!(
            h.apagar().unwrap_err().contains(RETIRADA_NO_CONFIRMADA),
            "la terminación tardía no reescribe la operación fallida"
        );
    }

    /// Un handle cuyo hilo ya murió y cuyo canal ya no escucha: el
    /// acuse es imposible por construcción (banco 6(b) variante 2).
    fn handle_sin_hilo(slot: Option<Result<(), String>>) -> CadenaHandle {
        let apagado = Arc::new(ApagadoCompartido::nuevo());
        if let Some(r) = slot {
            apagado.registrar_cierre(r);
        }
        let hilo = std::thread::spawn(|| {});
        apagado
            .datos
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .hilo = Some(hilo);
        let (tx, rx) = channel::<CadenaCmd>();
        drop(rx);
        CadenaHandle { tx, apagado }
    }

    /// **Banco 6(b) variante 2 — sin acuse y el hilo terminó SIN
    /// registrar resultado de liberación**: la terminación NO se
    /// convierte en éxito — la retirada queda no confirmada.
    #[test]
    fn banco_b2_hilo_terminado_sin_registro_es_no_confirmada() {
        let h = handle_sin_hilo(None);
        let r = h.apagar_con_plazo(Duration::from_millis(200));
        let e = r.unwrap_err();
        assert!(
            e.contains(RETIRADA_NO_CONFIRMADA),
            "terminar no es liberar: {}",
            e
        );
    }

    /// **Banco 6(b) — el resultado registrado en el slot manda**: sin
    /// acuse posible, si el hilo dejó su resultado de cierre guardado,
    /// `apagar` devuelve ESE resultado (aquí, el error con su causa).
    #[test]
    fn banco_b2_sin_acuse_manda_el_resultado_registrado_en_el_slot() {
        let h = handle_sin_hilo(Some(Err(CAUSA_RELEASE.to_string())));
        assert_eq!(
            h.apagar_con_plazo(Duration::from_millis(200)),
            Err(CAUSA_RELEASE.to_string())
        );
        let h_ok = handle_sin_hilo(Some(Ok(())));
        assert_eq!(h_ok.apagar_con_plazo(Duration::from_millis(200)), Ok(()));
    }

    /// **Banco 6(c) — la segunda solicitud tras una retirada fallida**:
    /// el proveedor devuelve el fallo REGISTRADO con su causa; jamás un
    /// `Ok` por el flag de «ya se solicitó». Y el espejo feliz: una
    /// retirada confirmada sí da `Ok` inmediato sin repetir el cierre.
    #[test]
    fn banco_c_segunda_solicitud_tras_fallo_devuelve_el_fallo_registrado() {
        use crate::provider::AnfitrionProvider;
        use crate::supervisor::ProveedorRetirable;

        let diario = Arc::new(StdMutex::new(Vec::new()));
        let cierres = Arc::new(AtomicU32::new(0));
        let mut t = TransporteDelCierre::nuevo(1, diario.clone(), cierres.clone());
        t.fallo_cierre = Some(CAUSA_RELEASE.to_string());
        let h = spawn_cadena(t, eps()).expect("la sesión abre");
        let mut p = AnfitrionProvider::new(h, Vec::new());
        assert_eq!(p.retirar(), Err(CAUSA_RELEASE.to_string()));
        assert_eq!(
            p.retirar(),
            Err(CAUSA_RELEASE.to_string()),
            "la segunda solicitud devuelve el fallo registrado, no un éxito implícito"
        );
        assert_eq!(cierres.load(Ordering::SeqCst), 1);

        // El espejo feliz: confirmada una vez, `Ok` inmediato y sin
        // repetir el cierre.
        let diario2 = Arc::new(StdMutex::new(Vec::new()));
        let cierres2 = Arc::new(AtomicU32::new(0));
        let h2 = spawn_cadena(
            TransporteDelCierre::nuevo(2, diario2, cierres2.clone()),
            eps(),
        )
        .expect("la sesión 2 abre");
        let mut p2 = AnfitrionProvider::new(h2, Vec::new());
        assert_eq!(p2.retirar(), Ok(()));
        assert_eq!(p2.retirar(), Ok(()));
        assert_eq!(cierres2.load(Ordering::SeqCst), 1);
    }

    /// **Banco 6(d) — el orden completo, reforzado**: con el cierre
    /// retenido en la barrera (la pausa justo antes de la última
    /// limpieza del transporte viejo), el claim nuevo AÚN NO ocurrió;
    /// concluida la retirada, el claim se permite y NINGÚN evento del
    /// transporte viejo (ni liberación, ni E/S, ni su caída) aparece
    /// después — tampoco al soltar el proveedor y los clones restantes.
    #[test]
    fn banco_d_orden_completo_sin_limpieza_vieja_tras_el_claim_nuevo() {
        use crate::provider::AnfitrionProvider;
        use crate::supervisor::ProveedorRetirable;

        let diario = Arc::new(StdMutex::new(Vec::new()));
        let cierres = Arc::new(AtomicU32::new(0));
        let barrera = Barrera::nueva();
        let mut t1 = TransporteDelCierre::nuevo(1, diario.clone(), cierres.clone());
        t1.barrera = Some(barrera.clone());
        let h1 = spawn_cadena(t1, eps()).expect("la sesión 1 abre");
        let h1_clon = h1.clone();
        let prov = AnfitrionProvider::new(h1, Vec::new());

        // La retirada corre en su hilo: el cierre queda retenido en la
        // barrera, justo antes del release.
        let hilo_ret = std::thread::spawn(move || {
            let mut prov = prov;
            let r = prov.retirar();
            (prov, r)
        });
        esperar_hasta(
            || diario.lock().unwrap().contains(&"cierre:1".to_string()),
            "el cierre viejo llegó a la barrera",
        );
        {
            let d = diario.lock().unwrap().clone();
            assert!(
                !d.contains(&"release:1".to_string()),
                "la última limpieza vieja aún no ocurrió: {:?}",
                d
            );
            assert!(
                !d.iter().any(|e| e == "claim:2"),
                "el claim nuevo NO puede ocurrir con la retirada en curso: {:?}",
                d
            );
        }
        barrera.abrir();
        let (prov, r) = hilo_ret.join().expect("el hilo de la retirada");
        assert_eq!(r, Ok(()), "la retirada quedó confirmada");

        // Concluida la retirada, el reemplazo se prepara: su claim.
        diario.lock().unwrap().push("claim:2".to_string());
        let h2 = spawn_cadena(
            TransporteDelCierre::nuevo(2, diario.clone(), cierres.clone()),
            eps(),
        )
        .expect("la sesión 2 abre");
        assert_eq!(h2.apagar(), Ok(()));

        // Soltar el proveedor y los clones restantes del viejo: nada
        // del transporte 1 puede actuar ya.
        drop(prov);
        drop(h1_clon);
        drop(h2);
        let d = diario.lock().unwrap().clone();
        let i_claim = d.iter().position(|e| e == "claim:2").unwrap();
        let viejos_tras_claim: Vec<&String> = d[i_claim + 1..]
            .iter()
            .filter(|e| e.ends_with(":1"))
            .collect();
        assert!(
            viejos_tras_claim.is_empty(),
            "ningún evento del transporte viejo tras el claim nuevo: {:?} (diario: {:?})",
            viejos_tras_claim,
            d
        );
        assert_eq!(
            d.iter().filter(|e| *e == "release:1").count(),
            1,
            "la liberación vieja ocurrió exactamente una vez, antes del claim: {:?}",
            d
        );
    }

    /// **Banco 6(e) — vence el plazo con el hilo vivo, en la pila
    /// completa**: el paso cae por ENODEV → el supervisor pide la
    /// retirada → el cierre se queda retenido → el supervisor devuelve
    /// el error de retirada DENTRO del plazo, con su etapa explícita, y
    /// llama CERO veces a re-preparar. Cuando el hilo por fin termina,
    /// la operación ya fallida no autoriza ningún claim: el contador de
    /// re-preparaciones sigue en cero y la retirada del proveedor sigue
    /// devolviendo su fallo registrado.
    #[test]
    fn banco_e_plazo_vencido_el_supervisor_no_reprepara_ni_autoriza_despues() {
        use crate::provider::AnfitrionProvider;
        use crate::supervisor::{ProveedorRetirable, Supervisor};

        let diario = Arc::new(StdMutex::new(Vec::new()));
        let cierres = Arc::new(AtomicU32::new(0));
        let barrera = Barrera::nueva();
        let mut t = TransporteDelCierre::nuevo(1, diario.clone(), cierres.clone());
        t.barrera = Some(barrera.clone());
        let h = spawn_cadena(t, eps()).expect("la sesión abre");
        h.fijar_plazo_apagado(Duration::from_millis(200));
        let h_obs = h.clone();
        let mut prov = AnfitrionProvider::new(h, Vec::new());
        let mut sup = Supervisor::de_banco();
        let repreparaciones = Arc::new(AtomicU32::new(0));
        let rp = repreparaciones.clone();
        let mut repreparar = move || -> Result<AnfitrionProvider, String> {
            rp.fetch_add(1, Ordering::SeqCst);
            Err("repreparar no debió ser llamado en este banco".to_string())
        };
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime del banco");
        let t0 = Instant::now();
        let r: Result<(), String> = rt.block_on(async {
            sup.ejecutar("sonda", &mut prov, &mut repreparar, |_p| async {
                Err(ENODEV_BANCO.to_string())
            })
            .await
        });
        let elapsed = t0.elapsed();
        let e = r.unwrap_err();
        assert!(
            e.contains("[etapa retirada]"),
            "el error sube con la etapa explícita de retirada: {}",
            e
        );
        assert!(
            e.contains(RETIRADA_NO_CONFIRMADA),
            "la causa es la retirada no confirmada: {}",
            e
        );
        assert_eq!(
            repreparaciones.load(Ordering::SeqCst),
            0,
            "sin retirada confirmada no hay re-preparación"
        );
        assert!(
            elapsed < Duration::from_secs(5),
            "el supervisor devolvió el error dentro del plazo: {:?}",
            elapsed
        );
        // El hilo por fin termina (la barrera se abre): la operación ya
        // fallida NO autoriza ningún claim después.
        barrera.abrir();
        esperar_hasta(|| h_obs.hilo_terminado(), "el hilo dueño terminó");
        assert_eq!(
            repreparaciones.load(Ordering::SeqCst),
            0,
            "la terminación tardía no autorizó ningún reemplazo"
        );
        assert!(
            prov.retirar()
                .unwrap_err()
                .contains(RETIRADA_NO_CONFIRMADA),
            "la retirada sigue siendo el fallo registrado"
        );
    }

    /// **Banco 6(f) — dos clones solicitan apagar a la vez**: UNA sola
    /// operación controla el cierre (el cierre explícito corre una sola
    /// vez), ningún clon obtiene éxito prematuro y ambos observan el
    /// mismo resultado terminal publicado.
    #[test]
    fn banco_f_dos_clones_a_la_vez_una_sola_operacion() {
        let diario = Arc::new(StdMutex::new(Vec::new()));
        let cierres = Arc::new(AtomicU32::new(0));
        let h = spawn_cadena(
            TransporteDelCierre::nuevo(1, diario, cierres.clone()),
            eps(),
        )
        .expect("la sesión abre");
        let h2 = h.clone();
        let hilo = std::thread::spawn(move || h2.apagar());
        let r_local = h.apagar();
        let r_hilo = hilo.join().expect("el clon del otro hilo");
        assert_eq!(r_local, Ok(()));
        assert_eq!(r_hilo, Ok(()), "ambos clones observan el mismo resultado");
        assert_eq!(
            cierres.load(Ordering::SeqCst),
            1,
            "una sola operación ejecutó el cierre explícito"
        );
        // Y el resultado publicado manda en llamadas posteriores, sin
        // repetir el cierre.
        assert_eq!(h.apagar(), Ok(()));
        assert_eq!(cierres.load(Ordering::SeqCst), 1);
    }
}

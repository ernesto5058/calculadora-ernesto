//! La **bóveda** de la fase 2: todo lo que la app guarda entre sesiones vive
//! en UN archivo cifrado (`boveda.vault`, AES-256-GCM) — el registro de
//! pairing, el estado de isideload (anisette + llave del certificado), el
//! certificado Personal Team, el equipo y los perfiles por app.
//!
//! La llave (DEK) la desenvuelve Kotlin desde el **Android Keystore** (llave
//! no exportable) y la pasa al abrir la bóveda; aquí solo vive en memoria.
//! Sin la DEK correcta el archivo no abre: esa es la prueba del banco.
//!
//! `VaultHandle` implementa el trait `SideloadingStorage` de isideload, así
//! la pila de cuenta/firma escribe DIRECTO en la bóveda (sellado tras cada
//! escritura) y en reposo jamás hay copias en claro.
//!
//! Claves del mapa (además de las propias de isideload):
//! - `boveda/pairing` → registro de pairing (base64)
//! - `boveda/equipo` → JSON `{team_id, nombre}`
//! - `boveda/cert` → JSON `{machine_id, machine_name, cert_der_b64, key_der_b64}`
//! - `boveda/perfil/<bundle_id>` → `.mobileprovision` (base64)
//! - `boveda/app/<bundle_id>` → JSON `{nombre, team_id, expira}` (época, segundos)

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use isideload::util::storage::SideloadingStorage;
use ring::rand::SecureRandom;
use rootcause::prelude::*;

const MAGIC: &[u8; 4] = b"AMV1";
pub const KEY_PAIRING: &str = "boveda/pairing";
pub const KEY_EQUIPO: &str = "boveda/equipo";
pub const KEY_CERT: &str = "boveda/cert";
pub const PREFIX_PERFIL: &str = "boveda/perfil/";
pub const PREFIX_APP: &str = "boveda/app/";

pub struct Vault {
    path: PathBuf,
    dek: [u8; 32],
    map: BTreeMap<String, String>,
}

pub struct VaultHandle {
    inner: Mutex<Vault>,
}

impl VaultHandle {
    /// Abre la bóveda del directorio dado con la DEK desenvuelta por Kotlin.
    /// Si el archivo no existe, nace vacía (se crea al primer sellado).
    /// DEK equivocada = error claro, jamás una bóveda «vacía» silenciosa.
    pub fn open(dir: &Path, dek: [u8; 32]) -> Result<Arc<VaultHandle>, String> {
        let path = dir.join("boveda.vault");
        let map = if path.exists() {
            let raw = std::fs::read(&path)
                .map_err(|e| format!("no se pudo leer la bóveda: {}", e))?;
            let plain = decrypt(&dek, &raw)?;
            let map: BTreeMap<String, String> = serde_json::from_slice(&plain)
                .map_err(|e| format!("la bóveda descifró pero su contenido no se entiende: {}", e))?;
            map
        } else {
            BTreeMap::new()
        };
        Ok(Arc::new(VaultHandle {
            inner: Mutex::new(Vault { path, dek, map }),
        }))
    }

    /// Cifra y guarda el mapa (escritura atómica: temporal + renombrar).
    pub fn seal(&self) -> Result<(), String> {
        let v = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let plain = serde_json::to_vec(&v.map)
            .map_err(|e| format!("no se pudo serializar la bóveda: {}", e))?;
        let raw = encrypt(&v.dek, &plain)?;
        let tmp = v.path.with_extension("vault.tmp");
        std::fs::write(&tmp, &raw).map_err(|e| format!("no se pudo escribir la bóveda: {}", e))?;
        std::fs::rename(&tmp, &v.path)
            .map_err(|e| format!("no se pudo sellar la bóveda: {}", e))?;
        Ok(())
    }

    pub fn get(&self, key: &str) -> Option<String> {
        let v = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        v.map.get(key).cloned()
    }

    pub fn put(&self, key: &str, value: &str) -> Result<(), String> {
        {
            let mut v = self.inner.lock().unwrap_or_else(|p| p.into_inner());
            v.map.insert(key.to_string(), value.to_string());
        }
        self.seal()
    }

    pub fn remove(&self, key: &str) -> Result<(), String> {
        {
            let mut v = self.inner.lock().unwrap_or_else(|p| p.into_inner());
            v.map.remove(key);
        }
        self.seal()
    }

    // ── Registro de pairing ────────────────────────────────────────────────

    pub fn pairing(&self) -> Option<Vec<u8>> {
        self.get(KEY_PAIRING)
            .and_then(|s| B64.decode(s.as_bytes()).ok())
    }

    pub fn set_pairing(&self, bytes: &[u8]) -> Result<(), String> {
        self.put(KEY_PAIRING, &B64.encode(bytes))
    }

    // ── Perfiles guardados (la vía sin conexión) ───────────────────────────

    /// Guarda el perfil de una app (por su bundle id ORIGINAL, el del IPA).
    pub fn set_profile(
        &self,
        bundle_id: &str,
        nombre: &str,
        team_id: &str,
        profile_bytes: &[u8],
    ) -> Result<(), String> {
        let info = parse_profile(profile_bytes)?;
        self.put(
            &format!("{}{}", PREFIX_PERFIL, bundle_id),
            &B64.encode(profile_bytes),
        )?;
        let meta = serde_json::json!({
            "nombre": nombre,
            "team_id": team_id,
            "expira": info.expira_epoch,
        });
        self.put(&format!("{}{}", PREFIX_APP, bundle_id), &meta.to_string())
    }

    pub fn profile(&self, bundle_id: &str) -> Option<Vec<u8>> {
        self.get(&format!("{}{}", PREFIX_PERFIL, bundle_id))
            .and_then(|s| B64.decode(s.as_bytes()).ok())
    }

    /// Lista las apps de la bóveda con los días que le quedan a su perfil.
    pub fn profile_infos(&self, now_epoch: i64) -> Vec<ProfileInfo> {
        let v = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let mut out = Vec::new();
        for (key, meta_raw) in v.map.iter() {
            if let Some(bundle_id) = key.strip_prefix(PREFIX_APP) {
                if let Ok(meta) = serde_json::from_str::<serde_json::Value>(meta_raw) {
                    let expira = meta
                        .get("expira")
                        .and_then(|x| x.as_i64())
                        .unwrap_or(0);
                    out.push(ProfileInfo {
                        bundle_id: bundle_id.to_string(),
                        nombre: meta
                            .get("nombre")
                            .and_then(|x| x.as_str())
                            .unwrap_or(bundle_id)
                            .to_string(),
                        expira_epoch: expira,
                        dias: ((expira - now_epoch) as f64 / 86_400.0).floor() as i64,
                    });
                }
            }
        }
        out.sort_by(|a, b| a.bundle_id.cmp(&b.bundle_id));
        out
    }
}

impl SideloadingStorage for VaultHandle {
    fn store(&self, key: &str, value: &str) -> Result<(), Report> {
        self.put(key, value)
            .map_err(|e| report!("{}", e).attach("sellando la bóveda"))
    }

    fn retrieve(&self, key: &str) -> Result<Option<String>, Report> {
        Ok(self.get(key))
    }

    fn delete(&self, key: &str) -> Result<(), Report> {
        self.remove(key)
            .map_err(|e| report!("{}", e).attach("sellando la bóveda"))
    }
}

/// Adaptador con dueño propio pa entregar la bóveda como
/// `Box<dyn SideloadingStorage>` a isideload (anisette y Sideloader comparten
/// la MISMA bóveda: una sola sesión de almacenamiento).
pub struct VaultStorageRef(pub Arc<VaultHandle>);

impl SideloadingStorage for VaultStorageRef {
    fn store(&self, key: &str, value: &str) -> Result<(), Report> {
        self.0.store(key, value)
    }

    fn retrieve(&self, key: &str) -> Result<Option<String>, Report> {
        self.0.retrieve(key)
    }

    fn delete(&self, key: &str) -> Result<(), Report> {
        self.0.delete(key)
    }
}

// ── Cifrado ───────────────────────────────────────────────────────────────────

fn encrypt(dek: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, String> {
    let key = Key::<Aes256Gcm>::try_from(dek.as_slice())
        .expect("la longitud de DEK debe ser válida para AES-256");
    let cipher = Aes256Gcm::new(&key);
    let rng = ring::rand::SystemRandom::new();
    let mut nonce_bytes = [0u8; 12];
    rng.fill(&mut nonce_bytes)
        .map_err(|_| "sin fuente de azar pa el nonce de la bóveda".to_string())?;
    let nonce = Nonce::try_from(nonce_bytes.as_slice())
        .expect("la longitud del nonce debe ser válida para AES-GCM");
    let ct = cipher
        .encrypt(&nonce, plain)
        .map_err(|_| "falló el cifrado de la bóveda".to_string())?;
    let mut out = Vec::with_capacity(4 + 12 + ct.len());
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ct);
    Ok(out)
}

fn decrypt(dek: &[u8; 32], raw: &[u8]) -> Result<Vec<u8>, String> {
    if raw.len() < 4 + 12 + 16 || &raw[0..4] != MAGIC {
        return Err("el archivo de la bóveda no tiene el formato esperado".into());
    }
    let key = Key::<Aes256Gcm>::try_from(dek.as_slice())
        .expect("la longitud de DEK debe ser válida para AES-256");
    let cipher = Aes256Gcm::new(&key);
    let nonce = Nonce::try_from(&raw[4..16])
        .expect("la longitud del nonce debe ser válida para AES-GCM");
    cipher
        .decrypt(&nonce, &raw[16..])
        .map_err(|_| "la llave no abre la bóveda (DEK equivocada o archivo dañado)".to_string())
}

// ── Perfiles de aprovisionamiento ─────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct ProfileInfo {
    pub bundle_id: String,
    pub nombre: String,
    pub expira_epoch: i64,
    /// Días enteros que le quedan (negativo = ya caducó).
    pub dias: i64,
}

/// Extrae el tramo XML (`<?xml … </plist>`) de un blob binario (la envoltura
/// CMS de un perfil NO es UTF-8 válido entera: se busca en bytes y solo el
/// tramo XML se convierte a texto).
pub(crate) fn extract_plist_xml(bytes: &[u8]) -> Result<&str, String> {
    let find = |needle: &[u8]| {
        bytes
            .windows(needle.len())
            .position(|w| w == needle)
            .ok_or_else(|| "el perfil no trae el plist XML esperado".to_string())
    };
    let start = find(b"<?xml")?;
    let end = find(b"</plist>")? + "</plist>".len();
    std::str::from_utf8(&bytes[start..end])
        .map_err(|_| "el plist XML del perfil no es UTF-8".to_string())
}

/// Extrae nombre, bundle id y caducidad del plist XML embebido en un
/// `.mobileprovision` (el blob es una envoltura CMS: el XML vive dentro).
pub fn parse_profile(bytes: &[u8]) -> Result<ProfileInfo, String> {
    let xml = extract_plist_xml(bytes)?;

    let nombre = xml_string_after_key(xml, "Name").unwrap_or_default();
    let app_id = xml_string_after_key(xml, "application-identifier")
        .ok_or("el perfil no trae application-identifier")?;
    // application-identifier = «TEAMID.bundle.equipo»: el bundle va tras el
    // primer punto (prefijo del equipo) y, en la pila de isideload, el App ID
    // registrado es «bundle.equipo», así que el sufijo «.equipo» también se
    // retira pa quedarnos con el bundle id ORIGINAL del IPA.
    let (team_prefix, rest) = app_id
        .split_once('.')
        .ok_or("application-identifier sin prefijo de equipo")?;
    let bundle_id = rest
        .strip_suffix(&format!(".{}", team_prefix))
        .unwrap_or(rest)
        .to_string();
    let fecha = xml_string_after_key(xml, "ExpirationDate")
        .ok_or("el perfil no trae ExpirationDate")?;
    let expira_epoch = parse_iso8601_z(&fecha)?;
    Ok(ProfileInfo {
        bundle_id,
        nombre,
        expira_epoch,
        dias: 0, // lo rellena profile_infos con el «ahora» del llamante
    })
}

/// Valor `<string>` o `<date>` que sigue a `<key>CLAVE</key>` en un plist XML.
/// En un plist el valor es el PRIMER elemento tras la clave (con su posible
/// sangría): nada de buscar «el siguiente string» a distancia — eso salta a
/// la clave vecina (cazado por el banco B3 con un perfil completo).
pub(crate) fn xml_string_after_key(xml: &str, key: &str) -> Option<String> {
    let marker = format!("<key>{}</key>", key);
    let at = xml.find(&marker)? + marker.len();
    let rest = xml[at..].trim_start();
    for tag in ["string", "date"] {
        let open = format!("<{}>", tag);
        if let Some(stripped) = rest.strip_prefix(&open) {
            let close = format!("</{}>", tag);
            let to = stripped.find(&close)?;
            return Some(stripped[..to].trim().to_string());
        }
    }
    None
}

/// `2026-11-22T03:04:05Z` → época Unix (sin dependencias: el formato de los
/// perfiles de Apple es siempre este ISO con Z).
fn parse_iso8601_z(s: &str) -> Result<i64, String> {
    let b = s.as_bytes();
    if b.len() < 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return Err(format!("fecha del perfil no reconocida: {}", s));
    }
    let num = |from: usize, len: usize| -> Result<i64, String> {
        s[from..from + len]
            .parse::<i64>()
            .map_err(|_| format!("fecha del perfil no reconocida: {}", s))
    };
    let (y, mo, d) = (num(0, 4)?, num(5, 2)?, num(8, 2)?);
    let (h, mi, se) = (num(11, 2)?, num(14, 2)?, num(17, 2)?);
    // Días desde 1970-01-01 (algoritmo de Hinnant, dominio público).
    let yy = if mo <= 2 { y - 1 } else { y };
    let era = if yy >= 0 { yy } else { yy - 399 } / 400;
    let yoe = yy - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let dias = era * 146097 + doe - 719468;
    Ok(dias * 86_400 + h * 3_600 + mi * 60 + se)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("anfitrion-boveda-{}-{}", tag, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn dek(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    #[test]
    fn boveda_sella_y_reabre() {
        let dir = tmp_dir("roundtrip");
        let v = VaultHandle::open(&dir, dek(7)).unwrap();
        v.put("clave", "valor").unwrap();
        v.set_pairing(b"<plist>registro</plist>").unwrap();
        drop(v);
        let v2 = VaultHandle::open(&dir, dek(7)).unwrap();
        assert_eq!(v2.get("clave").as_deref(), Some("valor"));
        assert_eq!(v2.pairing().unwrap(), b"<plist>registro</plist>");
        // El archivo en reposo NO contiene el contenido en claro.
        let raw = std::fs::read(dir.join("boveda.vault")).unwrap();
        assert!(!raw.windows(5).any(|w| w == b"valor"));
        assert!(!raw.windows(8).any(|w| w == b"registro"));
    }

    #[test]
    fn boveda_rechaza_dek_equivocada() {
        let dir = tmp_dir("dek");
        let v = VaultHandle::open(&dir, dek(1)).unwrap();
        v.put("x", "y").unwrap();
        drop(v);
        let err = match VaultHandle::open(&dir, dek(2)) {
            Ok(_) => panic!("una DEK equivocada no puede abrir la bóveda"),
            Err(e) => e,
        };
        assert!(err.contains("la llave no abre"), "error inesperado: {}", err);
    }

    #[test]
    fn perfil_de_banco_parsea_y_caduca() {
        // .mobileprovision de banco: envoltura binaria + plist XML dentro.
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>Name</key><string>Anfitrion Banco</string>
<key>Entitlements</key><dict>
<key>application-identifier</key><string>ABC123TEAM.com.maximo.tienda</string>
</dict>
<key>ExpirationDate</key><date>2026-11-22T03:04:05Z</date>
</dict></plist>"#;
        let mut blob = vec![0x30, 0x82, 0x00, 0x00];
        blob.extend_from_slice(xml.as_bytes());
        blob.extend_from_slice(&[0x00, 0x01, 0x02]);
        let info = parse_profile(&blob).unwrap();
        assert_eq!(info.bundle_id, "com.maximo.tienda");
        assert_eq!(info.nombre, "Anfitrion Banco");
        // 2026-11-22T03:04:05Z en época (verificado con `date -u -d`).
        assert_eq!(info.expira_epoch, 1_795_316_645);
    }

    #[test]
    fn migracion_registro_v11_byte_a_byte() {
        // El registro de la v1.1 (XML plist) entra a la bóveda y sale idéntico.
        let dir = tmp_dir("migracion");
        let registro = b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<plist version=\"1.0\"><dict><key>HostID</key><string>AAAA-BBBB</string></dict></plist>".to_vec();
        let v = VaultHandle::open(&dir, dek(9)).unwrap();
        v.set_pairing(&registro).unwrap();
        drop(v);
        let v2 = VaultHandle::open(&dir, dek(9)).unwrap();
        assert_eq!(v2.pairing().unwrap(), registro);
    }
}

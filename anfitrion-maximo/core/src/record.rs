//! Escritor del registro de pairing en el formato libimobiledevice / usbmuxd
//! (`<UDID>.plist` XML): el mismo que SideStore y Tienda Máximo importan.
//!
//! Adaptado de `idevice::pair_record::save_pair_record_plist` (idevice-rs, GPL-3.0):
//! certificados y llaves como `<data>` (bytes PEM), HostID/SystemBUID como `<string>`,
//! EscrowBag como `<data>` cruda de la respuesta de éxito del Pair.

use idevice_usb_core::PairingIds;

use crate::crypto::HostKeys;

pub fn build_pair_record_xml(
    keys: &HostKeys,
    ids: &PairingIds,
    device_cert_pem: &str,
    wifi_mac: Option<&str>,
    escrow_bag: Option<&[u8]>,
) -> Result<String, String> {
    let mut dict = plist::Dictionary::new();
    let push_pem = |d: &mut plist::Dictionary, key: &str, pem: &str| {
        d.insert(key.into(), plist::Value::Data(pem.as_bytes().to_vec()));
    };
    push_pem(&mut dict, "DeviceCertificate", device_cert_pem);
    push_pem(&mut dict, "HostCertificate", &keys.host_cert_pem);
    push_pem(&mut dict, "HostPrivateKey", &keys.private_key_pem);
    push_pem(&mut dict, "RootCertificate", &keys.root_cert_pem);
    push_pem(&mut dict, "RootPrivateKey", &keys.root_private_pem);
    dict.insert("HostID".into(), plist::Value::String(ids.host_id.clone()));
    dict.insert(
        "SystemBUID".into(),
        plist::Value::String(ids.system_buid.clone()),
    );
    if let Some(mac) = wifi_mac {
        if !mac.is_empty() {
            dict.insert("WiFiMACAddress".into(), plist::Value::String(mac.into()));
        }
    }
    if let Some(bag) = escrow_bag {
        if !bag.is_empty() {
            dict.insert("EscrowBag".into(), plist::Value::Data(bag.to_vec()));
        }
    }
    let value = plist::Value::Dictionary(dict);
    let mut buf: Vec<u8> = Vec::new();
    value
        .to_writer_xml(&mut buf)
        .map_err(|e| format!("plist xml encode: {}", e))?;
    String::from_utf8(buf).map_err(|e| format!("plist xml utf8: {}", e))
}

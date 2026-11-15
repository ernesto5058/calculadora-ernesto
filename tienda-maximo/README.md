# Tienda Máximo

Nuestra tienda instaladora clase SideStore, creada por Máximo para el iPhone XR
de Ernesto (iOS 18.7.10), sin jailbreak y con su cuenta gratuita (Personal Team).

## Qué hay aquí

- `../.github/workflows/tienda-maximo.yml` — el workflow que compila en los
  runners macOS de GitHub Actions (la Mac en la nube):
  - **Ruta 1 (spike)**: nuestra cáscara Swift propia (`spike/`) sobre las
    librerías abiertas SideSign + Minimuxer, generada con XcodeGen.
  - **Tienda Máximo (IPA)**: compila el código abierto de SideStore desde su
    fuente, en un commit fijado, con nuestra marca aplicada por `rebrand.sh`
    (bundle id `com.maximo.tienda`, nombre visible «Tienda Máximo», icono
    propio en `assets/icons/`).
- `rebrand.sh` — aplica la marca sobre un clon de SideStore.
- `assets/icons/` — el icono de la casa (M dorada sobre grafito), todos los tamaños.
- `spike/` — la cáscara propia de la Ruta 1 (proyecto XcodeGen + fuentes Swift).

## Cómo se usa

1. Despacha el workflow **«Tienda Máximo — build»** desde la pestaña Actions.
2. Descarga el artefacto `TiendaMaximo-ipa` (el `.ipa` + su sha256).
3. El `.ipa` también queda publicado como asset en el release `tienda-maximo`.

## La sesión en el iPhone (con InstaladorPRO)

El archivo de emparejamiento NO nace en el teléfono (iOS 18): lo deposita la
sesión con el programa anfitrión. Después: instalar Tienda Máximo con
InstaladorPRO, confiar en la app de desarrollador, activar el Modo
Desarrollador, abrir LocalDevVPN, iniciar sesión dentro de la tienda con el
Apple ID de Ernesto (él teclea su contraseña en su teléfono) y refrescar.

**Estado de verificación:** el `.ipa` compilado y su contenido se verifican en
CI; la instalación real y el primer refresco en el XR quedan **UNVERIFIED**
hasta la sesión con Ernesto.

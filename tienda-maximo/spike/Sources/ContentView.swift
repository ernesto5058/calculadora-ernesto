import SwiftUI
import Minimuxer
import SideSign

/// Cáscara propia de «Tienda Máximo» (Ruta 1): tres pantallas mínimas sobre
/// las librerías abiertas del ecosistema SideStore (SideSign + Minimuxer).
/// Este spike prueba que NUESTRA app compone y enlaza contra esas librerías;
/// los flujos vivos (login, firma, instalación) se cablean contra sus APIs.
struct ContentView: View {
    var body: some View {
        TabView {
            EstadoView()
                .tabItem { Label("Estado", systemImage: "checkmark.shield") }
            InstalarView()
                .tabItem { Label("Instalar", systemImage: "square.and.arrow.down") }
            InstaladasView()
                .tabItem { Label("Instaladas", systemImage: "apps.iphone") }
        }
    }
}

/// ¿Está el archivo de emparejamiento importado en Documentos?
func pairingFileURL() -> URL? {
    let fm = FileManager.default
    guard let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first else { return nil }
    let items = (try? fm.contentsOfDirectory(at: docs, includingPropertiesForKeys: nil)) ?? []
    return items.first { $0.pathExtension == "mobiledevicepairing" }
}

struct EstadoView: View {
    // Referencias reales a las librerías: si los módulos no enlazan, no compila.
    private let muxerParams = MinimuxerParams(backend: .idevice)
    private let signHeadersType = SideSignHeaders.self

    var body: some View {
        NavigationStack {
            List {
                Section("Emparejamiento") {
                    if let url = pairingFileURL() {
                        Label(url.lastPathComponent, systemImage: "link.badge.plus")
                        Text("Archivo presente: la tienda puede hablar con el sistema.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Label("Sin archivo de emparejamiento", systemImage: "link.badge.minus")
                        Text("Impórtalo desde Archivos: lo deposita la sesión con InstaladorPRO.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Section("Motor") {
                    LabeledContent("Backend de dispositivo", value: muxerParams.backend?.rawValue ?? "—")
                    LabeledContent("Firma", value: String(describing: signHeadersType))
                }
                Section("Cuenta") {
                    Text("Inicia sesión con tu Apple ID dentro de la app. Tu contraseña no sale del teléfono: la usa la librería de firma (Personal Team).")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Tienda Máximo")
        }
    }
}

struct InstalarView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                "Instalar un IPA",
                systemImage: "square.and.arrow.down",
                description: Text("Elige un archivo .ipa de Archivos: la tienda lo firma con tu cuenta y lo instala por el túnel local.")
            )
            .navigationTitle("Instalar")
        }
    }
}

struct InstaladasView: View {
    var body: some View {
        NavigationStack {
            ContentUnavailableView(
                "Sin apps todavía",
                systemImage: "apps.iphone",
                description: Text("Aquí viven las apps instaladas por la tienda, con los días de firma que les quedan y el botón «Refrescar todo».")
            )
            .navigationTitle("Instaladas")
        }
    }
}

package com.maximo.anfitrion

import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.Cursor
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.text.method.ScrollingMovementMethod
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File
import java.io.FileNotFoundException
import kotlin.concurrent.thread

/** Recibe las etapas del núcleo Rust (JNI) y las pasa a la UI. */
class StageLogger(private val cb: (String) -> Unit) {
    fun onStage(line: String) {
        cb(line)
    }
}

/** Puente JNI con `libanfitrion_core.so`. */
object RustBridge {
    init {
        System.loadLibrary("anfitrion_core")
    }

    /**
     * Corre el pairing completo sobre el fd de Android.
     * Devuelve "OK" o "ERROR::<etapa>::<mensaje>".
     */
    external fun nativePair(fd: Int, outPath: String, serial: String, logger: StageLogger): String
}

/** Proveedor mínimo pa compartir el .plist guardado (sin dependencias externas). */
class FilesProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    private fun fileFor(uri: Uri): File {
        val name = uri.lastPathSegment ?: throw FileNotFoundException("sin nombre")
        val dir = context?.getExternalFilesDir(null) ?: throw FileNotFoundException("sin dir")
        return File(dir, name)
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        val f = fileFor(uri)
        if (!f.exists()) throw FileNotFoundException(f.absolutePath)
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri): String = "text/xml"
    override fun query(
        uri: Uri, projection: Array<out String>?, selection: String?,
        selectionArgs: Array<out String>?, sortOrder: String?
    ): Cursor? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(
        uri: Uri, values: ContentValues?, selection: String?,
        selectionArgs: Array<out String>?
    ): Int = 0
}

class MainActivity : Activity() {

    companion object {
        private const val APPLE_VID = 0x05AC
        private const val ACTION_USB_PERMISSION = "com.maximo.anfitrion.USB_PERMISSION"
        private const val REQUEST_IMPORT = 77
    }

    // Paleta de la casa (DISENO-PRO): fondo oscuro, dorado SOLO en degradado.
    private val bg = Color.rgb(10, 12, 16)
    private val surface = Color.rgb(18, 22, 29)
    private val line = Color.rgb(30, 38, 50)
    private val ink = Color.rgb(233, 238, 244)
    private val dim = Color.rgb(147, 161, 179)
    private val teal = Color.rgb(45, 212, 191)
    private val red = Color.rgb(248, 113, 113)
    private val goldA = Color.rgb(240, 208, 137)
    private val goldB = Color.rgb(201, 150, 46)

    private lateinit var statusView: TextView
    private lateinit var pairButton: Button
    private lateinit var sondaButton: Button
    private lateinit var sharePairingButton: Button
    private lateinit var shareLogButton: Button
    private lateinit var logView: TextView
    private lateinit var logScroll: ScrollView

    private var usbManager: UsbManager? = null
    private var appleDevice: UsbDevice? = null
    private var pairingFile: File? = null
    private var running = false
    private var lastIdentity: String? = null

    private val usbReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                ACTION_USB_PERMISSION -> {
                    val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                    if (granted) {
                        appendLog("Permiso USB concedido por el sistema")
                        refreshDeviceState()
                    } else {
                        setStatus("Permiso USB denegado: sin él no se puede hablar con el iPhone", red)
                        appendLog("Permiso USB DENEGADO")
                    }
                }
                UsbManager.ACTION_USB_DEVICE_DETACHED -> {
                    appendLog("El iPhone se desconectó del USB")
                    if (!running) refreshDeviceState()
                }
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
                    appendLog("Dispositivo USB conectado")
                    refreshDeviceState()
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        usbManager = getSystemService(USB_SERVICE) as UsbManager
        buildUi()

        val filter = IntentFilter().apply {
            addAction(ACTION_USB_PERMISSION)
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(usbReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            registerReceiver(usbReceiver, filter)
        }
        refreshDeviceState()
        handleIncomingIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingIntent(intent)
    }

    override fun onDestroy() {
        runCatching { unregisterReceiver(usbReceiver) }
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        if (!running) refreshDeviceState()
    }

    // ── UI ────────────────────────────────────────────────────────────────────

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun buildUi() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
            setPadding(dp(20), dp(24), dp(20), dp(20))
        }

        val title = TextView(this).apply {
            text = "Anfitrión Máximo"
            setTextColor(ink)
            textSize = 26f
            typeface = Typeface.DEFAULT_BOLD
        }
        root.addView(title)

        val sub = TextView(this).apply {
            text = "Empareja tu iPhone desde este teléfono, por cable y sin computadora. " +
                "El registro que nace aquí es la semilla que Tienda Máximo importa en el iPhone."
            setTextColor(dim)
            textSize = 14f
            setPadding(0, dp(6), 0, dp(16))
        }
        root.addView(sub)

        statusView = TextView(this).apply {
            setTextColor(dim)
            textSize = 15f
            setPadding(0, 0, 0, dp(14))
        }
        root.addView(statusView)

        pairButton = Button(this).apply {
            text = "Emparejar"
            textSize = 18f
            setTextColor(Color.rgb(26, 20, 4))
            typeface = Typeface.DEFAULT_BOLD
            isAllCaps = false
            background = GradientDrawable(
                GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(goldA, goldB)
            ).apply { cornerRadius = dp(14).toFloat() }
            setOnClickListener { startPairing() }
        }
        root.addView(
            pairButton,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(58)
            )
        )

        // Sonda asistida (diseño de Ernesto): la app confirma el enlace con
        // identidad, SUELTA el iPhone y abre la página WebUSB en Chrome; la
        // página empareja con el toque de Ernesto y esta app recoge el .plist.
        sondaButton = secondaryButton("Sonda asistida: emparejar con la página WebUSB") { openWebUsbProbe() }
        root.addView(
            sondaButton,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(50)).apply {
                topMargin = dp(10)
            }
        )
        val sondaHint = TextView(this).apply {
            text = "Otra vía: la app confirma que están conectados, suelta el iPhone y abre la " +
                "página WebUSB en Chrome. La página empareja con tu toque y al final esta app " +
                "recoge el registro descargado."
            setTextColor(dim)
            textSize = 12f
            setPadding(0, dp(6), 0, 0)
        }
        root.addView(sondaHint)

        val hint = TextView(this).apply {
            text = "Conecta el iPhone por cable (directo USB-C a Lightning, o con el adaptador OTG), " +
                "déjalo desbloqueado y, cuando lo pida, toca «Confiar» y mete tu código en el iPhone."
            setTextColor(dim)
            textSize = 13f
            setPadding(0, dp(12), 0, dp(16))
        }
        root.addView(hint)

        val logTitle = TextView(this).apply {
            text = "REGISTRO DE ETAPAS"
            setTextColor(dim)
            textSize = 12f
            letterSpacing = 0.12f
        }
        root.addView(logTitle)

        logView = TextView(this).apply {
            setTextColor(ink)
            textSize = 12f
            typeface = Typeface.MONOSPACE
            movementMethod = ScrollingMovementMethod()
            setTextIsSelectable(true)
            setPadding(dp(10), dp(10), dp(10), dp(10))
            background = GradientDrawable().apply {
                setColor(surface)
                setStroke(dp(1), line)
                cornerRadius = dp(10).toFloat()
            }
        }
        logScroll = ScrollView(this).apply {
            addView(logView)
        }
        root.addView(
            logScroll,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f).apply {
                topMargin = dp(8)
            }
        )

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(14), 0, 0)
        }
        sharePairingButton = secondaryButton("Compartir el registro de pairing") { sharePairing() }
        shareLogButton = secondaryButton("Compartir el registro de etapas") { shareLog() }
        row.addView(sharePairingButton, LinearLayout.LayoutParams(0, dp(50), 1f).apply { rightMargin = dp(6) })
        row.addView(shareLogButton, LinearLayout.LayoutParams(0, dp(50), 1f).apply { leftMargin = dp(6) })
        root.addView(row)

        // Ruta 3 (multi-ruta): un pairing nacido en otra vía — la página WebUSB,
        // InstaladorPRO o una Pi — se importa aquí y queda listo pa compartir.
        val importButton = secondaryButton("Importar un registro nacido en otra vía") { importPairing() }
        root.addView(
            importButton,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(50)).apply {
                topMargin = dp(10)
            }
        )
        val importHint = TextView(this).apply {
            text = "Si el pairing nació en la página WebUSB, en InstaladorPRO o en una Pi, " +
                "impórtalo aquí: queda guardado en esta app y lo compartes igual que uno propio."
            setTextColor(dim)
            textSize = 12f
            setPadding(0, dp(6), 0, 0)
        }
        root.addView(importHint)

        setContentView(root)
        sharePairingButton.isEnabled = false
        shareLogButton.isEnabled = false
    }

    private fun secondaryButton(text: String, onClick: () -> Unit): Button {
        return Button(this).apply {
            this.text = text
            textSize = 13f
            isAllCaps = false
            setTextColor(ink)
            background = GradientDrawable().apply {
                setColor(surface)
                setStroke(dp(1), line)
                cornerRadius = dp(12).toFloat()
            }
            setOnClickListener { onClick() }
        }
    }

    // ── Estado / detección ────────────────────────────────────────────────────

    private fun setStatus(text: String, color: Int = dim) {
        runOnUiThread {
            statusView.text = text
            statusView.setTextColor(color)
        }
    }

    private fun appendLog(lineText: String) {
        runOnUiThread {
            logView.append(lineText + "\n")
            logScroll.post { logScroll.fullScroll(View.FOCUS_DOWN) }
            shareLogButton.isEnabled = true
        }
    }

    private fun findAppleDevice(): UsbDevice? {
        val mgr = usbManager ?: return null
        return mgr.deviceList.values.firstOrNull { it.vendorId == APPLE_VID }
    }

    private fun identityOf(dev: UsbDevice): String {
        val maker = try {
            dev.manufacturerName
        } catch (e: Exception) {
            null
        } ?: "Apple"
        val product = try {
            dev.productName
        } catch (e: Exception) {
            null
        } ?: "iPhone"
        val vid = dev.vendorId.toString(16).uppercase().padStart(4, '0')
        val pid = dev.productId.toString(16).uppercase().padStart(4, '0')
        return "$maker $product · VID 0x$vid · PID 0x$pid"
    }

    private fun refreshDeviceState() {
        val dev = findAppleDevice()
        appleDevice = dev
        if (dev == null) {
            if (lastIdentity != null) {
                appendLog("Detección: el iPhone se desconectó del cable")
                lastIdentity = null
            }
            setStatus("Sin iPhone conectado. Conéctalo por cable y déjalo desbloqueado.")
            pairButton.isEnabled = false
            sondaButton.isEnabled = false
            return
        }
        val identity = identityOf(dev)
        if (identity != lastIdentity) {
            appendLog("Detección por USB Host: $identity · puerto ${dev.deviceName}")
            appendLog("Enlace confirmado: están conectados por el cable")
            lastIdentity = identity
        }
        sondaButton.isEnabled = !running
        val mgr = usbManager ?: return
        if (mgr.hasPermission(dev)) {
            setStatus("Están conectados: $identity, con permiso. Toca «Emparejar» — o usa la sonda asistida.", teal)
            pairButton.isEnabled = !running
        } else {
            setStatus("Están conectados: $identity. Pidiendo el permiso USB…")
            pairButton.isEnabled = false
            requestUsbPermission(dev)
        }
    }

    private fun requestUsbPermission(dev: UsbDevice) {
        val mgr = usbManager ?: return
        val flags = if (Build.VERSION.SDK_INT >= 31) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pi = PendingIntent.getBroadcast(this, 0, Intent(ACTION_USB_PERMISSION), flags)
        mgr.requestPermission(dev, pi)
    }

    // ── Sonda asistida (diseño de Ernesto) ────────────────────────────────────
    //
    // Precisión técnica: la app NO puede pasarle su agarre USB a Chrome.
    // Android no comparte el dispositivo: dos dueños a la vez = el error BUSY
    // que mató el intento de Termux. Por eso el traspaso es en tres tiempos:
    // la app confirma y prepara → SUELTA el iPhone → la página lo reclama con
    // el toque de Ernesto → la app recoge el archivo al final. Cada traspaso
    // queda escrito en el registro de etapas.

    private fun openWebUsbProbe() {
        val dev = appleDevice
        if (dev == null) {
            setStatus("Primero conecta el iPhone por el cable: la sonda confirma el enlace antes de abrir la página.", red)
            return
        }
        if (running) {
            setStatus("El pairing nativo está corriendo: espera a que termine antes de usar la sonda.", red)
            return
        }
        val identity = identityOf(dev)
        appendLog("Sonda asistida: enlace confirmado por la app — $identity")
        appendLog("Sonda asistida: la app SUELTA el iPhone (ningún agarre abierto: dos dueños = error BUSY)")
        val url = "https://ernesto5058.github.io/calculadora-ernesto/webusb-pair/"
        var opened = false
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
                setPackage("com.android.chrome")
            })
            opened = true
        } catch (e: Exception) {
            try {
                startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                opened = true
            } catch (e2: Exception) {
                // sin navegador disponible: se le dice claro abajo
            }
        }
        if (opened) {
            appendLog("Sonda asistida: página WebUSB abierta en Chrome — tu toque la deja reclamar el iPhone")
            setStatus(
                "En Chrome: toca «Emparejar mi iPhone», elige tu iPhone y, cuando lo pida, " +
                    "toca Confiar en su pantalla y mete tu código. Al terminar la página descarga " +
                    "el pair-record.plist: ábrelo con Anfitrión Máximo (o compártelo hacia la app) " +
                    "y queda guardado aquí.",
                ink
            )
        } else {
            appendLog("Sonda asistida: NO se pudo abrir el navegador")
            setStatus("No se pudo abrir Chrome. Abre tú la página: $url", red)
        }
    }

    /** Recibe un archivo por abrir-con / compartir (el .plist de la sonda u otra vía). */
    private fun handleIncomingIntent(intent: Intent?) {
        if (intent == null) return
        val uri: Uri? = when (intent.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(Intent.EXTRA_STREAM)
            }
            else -> null
        }
        if (uri != null) {
            appendLog("Llegó un archivo desde fuera (abrir-con / compartir): se revisa como registro de pairing")
            importFromUri(uri)
        }
    }

    // ── Pairing ───────────────────────────────────────────────────────────────

    private fun startPairing() {
        val dev = appleDevice ?: run {
            refreshDeviceState()
            return
        }
        val mgr = usbManager ?: return
        if (!mgr.hasPermission(dev)) {
            requestUsbPermission(dev)
            return
        }
        running = true
        pairButton.isEnabled = false
        sondaButton.isEnabled = false
        sharePairingButton.isEnabled = false
        logView.text = ""
        setStatus("Emparejando… sigue las etapas abajo y atiende el iPhone.", ink)
        appendLog("Abriendo el iPhone por USB (Kotlin presta el fd; el protocolo lo hace el núcleo Rust)")

        thread(name = "anfitrion-pairing") {
            var result: String
            try {
                val connection = mgr.openDevice(dev)
                if (connection == null) {
                    result = "ERROR::usb::Android no pudo abrir el iPhone (openDevice devolvió null)"
                } else {
                    try {
                        val fd = connection.fileDescriptor
                        if (fd < 0) {
                            result = "ERROR::usb::el descriptor del iPhone salió inválido (fd < 0)"
                        } else {
                            val serial = try {
                                dev.serialNumber ?: "iphone"
                            } catch (e: Exception) {
                                "iphone"
                            }
                            val safeSerial = serial.replace(Regex("[^A-Za-z0-9-]"), "_")
                            val dir = getExternalFilesDir(null) ?: filesDir
                            val out = File(dir, "$safeSerial.plist")
                            pairingFile = out
                            val logger = StageLogger { line -> appendLog(line) }
                            // OJO: no claimInterface ni setConfiguration aquí — eso lo hace
                            // el núcleo Rust sobre el fd, etapa por etapa y con registro.
                            result = RustBridge.nativePair(fd, out.absolutePath, serial, logger)
                        }
                    } finally {
                        connection.close()
                    }
                }
            } catch (e: Exception) {
                result = "ERROR::usb::${e.message ?: e.javaClass.simpleName}"
            }

            running = false
            runOnUiThread {
                pairButton.isEnabled = true
                sondaButton.isEnabled = appleDevice != null
                if (result == "OK") {
                    setStatus(
                        "Pairing completado: el iPhone ya confía en este anfitrión. " +
                            "Comparte el registro e impórtalo en Tienda Máximo.",
                        teal
                    )
                    sharePairingButton.isEnabled = true
                } else {
                    val parts = result.split("::", limit = 3)
                    val etapa = parts.getOrNull(1) ?: "?"
                    val msg = parts.getOrNull(2) ?: result
                    setStatus(
                        "Falló en la etapa «$etapa»: $msg — " +
                            "Si tienes un registro nacido en otra vía, impórtalo con el botón de abajo.",
                        red
                    )
                }
            }
        }
    }

    // ── Ruta 3: importar un pairing nacido en otra vía ────────────────────────

    private fun importPairing() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        @Suppress("DEPRECATION")
        startActivityForResult(intent, REQUEST_IMPORT)
    }

    @Deprecated("Selector de archivos del sistema (sin AndroidX en esta app)")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_IMPORT || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        importFromUri(uri)
    }

    /** Copia un .plist (de la sonda, del selector o de otra vía) al almacén de la app y lo deja como pairing vigente. */
    private fun importFromUri(uri: Uri) {
        thread(name = "anfitrion-import") {
            try {
                val bytes = contentResolver.openInputStream(uri)?.readBytes()
                    ?: throw IllegalStateException("no se pudo leer el archivo")
                val text = String(bytes, Charsets.UTF_8)
                if (!text.contains("<plist") || !text.contains("HostID")) {
                    runOnUiThread {
                        setStatus(
                            "Ese archivo no parece un registro de pairing (no trae <plist> con HostID). " +
                                "Elige el .plist que descargó la página WebUSB o el que guardó la otra vía.",
                            red
                        )
                    }
                    return@thread
                }
                var displayName = "importado.plist"
                try {
                    contentResolver.query(uri, null, null, null, null)?.use { c ->
                        val idx = c.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                        if (idx >= 0 && c.moveToFirst()) {
                            val n = c.getString(idx)
                            if (!n.isNullOrBlank()) {
                                displayName = n.replace(Regex("[^A-Za-z0-9._-]"), "_")
                            }
                        }
                    }
                } catch (e: Exception) {
                    // el nombre es cosmético; seguimos con el de reserva
                }
                val dir = getExternalFilesDir(null) ?: filesDir
                val out = File(dir, displayName)
                out.writeBytes(bytes)
                pairingFile = out
                runOnUiThread {
                    appendLog("Registro importado desde otra vía: ${out.name} (${bytes.size} bytes) — guardado como pairing válido de esta app")
                    setStatus(
                        "Registro importado y guardado en esta app. Compártelo e impórtalo en Tienda Máximo.",
                        teal
                    )
                    sharePairingButton.isEnabled = true
                }
            } catch (e: Exception) {
                runOnUiThread {
                    setStatus("No se pudo importar: ${e.message ?: e.javaClass.simpleName}", red)
                }
            }
        }
    }

    // ── Compartir ─────────────────────────────────────────────────────────────

    private fun sharePairing() {
        val f = pairingFile
        if (f == null || !f.exists()) {
            setStatus("Todavía no hay registro de pairing guardado", red)
            return
        }
        val uri = Uri.parse("content://com.maximo.anfitrion.files/${f.name}")
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/xml"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_SUBJECT, "Registro de pairing del iPhone (${f.name})")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(intent, "Compartir el registro de pairing"))
    }

    private fun shareLog() {
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "Anfitrión Máximo — registro de etapas")
            putExtra(Intent.EXTRA_TEXT, logView.text.toString())
        }
        startActivity(Intent.createChooser(intent, "Compartir el registro de etapas"))
    }
}

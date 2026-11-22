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
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.text.InputType
import android.text.method.ScrollingMovementMethod
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File
import java.io.FileNotFoundException
import java.security.KeyStore
import java.security.SecureRandom
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlin.concurrent.thread
import org.json.JSONObject

/** Recibe las etapas del núcleo Rust (JNI) y las pasa a la UI. */
class StageLogger(private val cb: (String) -> Unit) {
    /** Líneas entregadas por el callback en ESTA corrida (dedupe del seguro
     *  del registro: al terminar la cadena se compara contra el total del
     *  sink de Rust — `nativeStageLines` — y se añaden las que falten). */
    @Volatile
    var entregadas: Int = 0
        private set

    fun onStage(line: String) {
        entregadas++
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

    // ── Fase 2: bóveda cifrada ──────────────────────────────────────────────
    /** Abre la bóveda con la DEK desenvuelta del Keystore. "OK" o "ERROR::<mensaje>". */
    external fun nativeVaultUnlock(dirPath: String, dek: ByteArray, tmpPath: String, logger: StageLogger): String

    /** Guarda un registro de pairing dentro de la bóveda. */
    external fun nativeVaultImportPairing(bytes: ByteArray): String

    /** ¿La bóveda ya tiene un registro de pairing? */
    external fun nativeVaultHasPairing(): Boolean

    /** Materializa el registro de la bóveda en una ruta pa compartirlo. */
    external fun nativeVaultExportPairing(destPath: String): String

    /** JSON [{bundle_id, nombre, dias}] de las apps guardadas en la bóveda. */
    external fun nativeVaultProfiles(): String

    /** JSON {cubre, motivo, nombre, bundle_id, dias}: ¿esta app se puede firmar sin conexión? */
    external fun nativeVaultCovers(ipaPath: String, logger: StageLogger): String

    // ── Fase 2: firmar e instalar ───────────────────────────────────────────
    /**
     * La cadena completa (login si hace falta → firma → instalación por el cable).
     * La contraseña vive solo en esta llamada. El código 2FA lo pide el núcleo
     * llamando a `tfaBridge.requestTfaCode()` cuando Apple lo exige.
     * Devuelve "OK" o "ERROR::<etapa>::<mensaje>".
     */
    external fun nativeSignInstall(
        fd: Int, ipaPath: String, email: String, password: String,
        hayRed: Boolean, tfaBridge: TfaBridge, logger: StageLogger
    ): String

    /**
     * El registro de etapas COMPLETO tal cual vive en el sink de Rust
     * (v2.3, seguro del registro): al terminar la cadena, la UI añade las
     * líneas que el callback `onStage` haya perdido por el camino.
     */
    external fun nativeStageLines(): String
}

/**
 * Puente del código 2FA: el núcleo Rust lo llama (bloqueante) cuando Apple
 * pide el código; la implementación enseña el campo en la misma pantalla y
 * espera a que Ernesto lo teclee. Devolver null = cancelar el login.
 */
class TfaBridge(private val onRequest: () -> String?) {
    fun requestTfaCode(): String? = onRequest()
}

/** Proveedor mínimo pa compartir el .plist guardado (sin dependencias externas). */
class FilesProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    private fun fileFor(uri: Uri): File {
        val name = uri.lastPathSegment ?: throw FileNotFoundException("sin nombre")
        val ctx = context ?: throw FileNotFoundException("sin contexto")
        // v2: lo compartido sale de la carpeta de compartir (el registro se
        // materializa desde la bóveda justo antes de compartir).
        val compartido = File(File(ctx.cacheDir, "compartir"), name)
        if (compartido.exists()) return compartido
        val dir = ctx.getExternalFilesDir(null) ?: throw FileNotFoundException("sin dir")
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
        private const val REQUEST_IPA = 78
        private const val KEK_ALIAS = "anfitrion_boveda_kek"
    }

    // Paleta DISENO-PRO (tokens del sistema): oscuro azul-gris por capas,
    // dorado SOLO en degradado/tinte, bordes de 1 px translúcidos.
    private val bg = Color.rgb(11, 14, 19) // --bg-0
    private val surface = Color.rgb(18, 22, 31) // --bg-1 (tarjetas)
    private val bg2 = Color.rgb(26, 33, 48) // --bg-2 (inputs, superficie elevada)
    private val line = Color.argb(18, 255, 255, 255) // --borde (≈7%)
    private val lineStrong = Color.argb(31, 255, 255, 255) // --borde-fuerte (≈12%)
    private val ink = Color.rgb(242, 245, 249) // --txt-1
    private val dim = Color.rgb(163, 173, 188) // --txt-2 (≈62%)
    private val faint = Color.rgb(118, 128, 143) // --txt-3 (≈40%)
    private val teal = Color.rgb(45, 212, 191)
    private val red = Color.rgb(246, 70, 93) // --rojo desaturado
    private val goldA = Color.rgb(245, 214, 123) // --dorado-claro
    private val goldMid = Color.rgb(232, 184, 75) // --dorado
    private val goldB = Color.rgb(201, 150, 46) // --dorado-oscuro
    private val onGold = Color.rgb(26, 20, 4)

    private lateinit var statusView: TextView
    private lateinit var pairButton: Button
    private lateinit var sondaButton: Button
    private lateinit var sharePairingButton: Button
    private lateinit var shareLogButton: Button
    private lateinit var logView: TextView
    private lateinit var logScroll: ScrollView
    private lateinit var pageScroll: ScrollView

    // ── Fase 2 ────────────────────────────────────────────────────────────────
    private lateinit var elegirIpaButton: Button
    private lateinit var ipaInfoView: TextView
    private lateinit var loginBlock: LinearLayout
    private lateinit var emailInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var tfaBlock: LinearLayout
    private lateinit var tfaInput: EditText
    private lateinit var signButton: Button
    private lateinit var vaultListView: TextView

    private var vaultOpen = false
    private var chosenIpa: File? = null

    private val tfaLatch = AtomicReference<CountDownLatch?>()
    @Volatile private var tfaEntregado: String? = null

    /** El núcleo llama aquí (hilo Rust) cuando Apple pide el código 2FA. */
    private val tfaBridge = TfaBridge {
        val latch = CountDownLatch(1)
        tfaLatch.set(latch)
        tfaEntregado = null
        runOnUiThread {
            tfaInput.setText("")
            tfaBlock.visibility = View.VISIBLE
            setStatus("Apple pide el código de verificación: mira tu iPhone, escríbelo aquí y toca «Enviar código».", ink)
        }
        val llego = latch.await(240, TimeUnit.SECONDS)
        runOnUiThread { tfaBlock.visibility = View.GONE }
        if (llego) tfaEntregado else null
    }

    private fun entregarTfa() {
        val code = tfaInput.text.toString().trim()
        if (code.isEmpty()) return
        tfaEntregado = code
        tfaLatch.get()?.countDown()
    }

    private fun cancelarTfa() {
        tfaEntregado = null
        tfaLatch.get()?.countDown()
    }

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
        // La bóveda se abre al arrancar: su llave vive en el Keystore y la
        // migración del registro de la v1.1 corre sola en cuanto abre.
        thread(name = "anfitrion-boveda") { unlockVault() }
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

    // ── Cara v2.7 (DISENO-PRO): BANDA DORADA a todo ancho con la versión
    // EN GRANDE en oscuro sobre el degradado, y el contenido en TARJETAS
    // por capas — visiblemente distinta de la tarjeta oscura de la v2.6.
    // Dorado solo en degradado/tinte, bordes de 1 px translúcidos,
    // botones principales en píldora, rejilla 4/8. ──

    /** Tarjeta del sistema: superficie --bg-1, radio 20, borde 1 px. */
    private fun card(topMargin: Int): LinearLayout {
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
            background = GradientDrawable().apply {
                setColor(surface)
                setStroke(dp(1), line)
                cornerRadius = dp(20).toFloat()
            }
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { this.topMargin = dp(topMargin) }
        }
    }

    /** Etiqueta de sección: micro (11 sp, 600, mayúsculas, --txt-3). */
    private fun sectionLabel(text: String): TextView {
        return TextView(this).apply {
            this.text = text
            setTextColor(faint)
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.14f
        }
    }

    /** Botón principal: píldora con el degradado dorado del sistema. */
    private fun goldButton(text: String, onClick: () -> Unit): Button {
        return Button(this).apply {
            this.text = text
            textSize = 17f
            setTextColor(onGold)
            typeface = Typeface.DEFAULT_BOLD
            isAllCaps = false
            elevation = dp(4).toFloat()
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(goldA, goldMid, goldB)
            ).apply { cornerRadius = dp(26).toFloat() }
            setOnClickListener { onClick() }
        }
    }

    private fun buildUi() {
        window.statusBarColor = bg
        window.navigationBarColor = bg

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
            setPadding(dp(16), dp(20), dp(16), dp(24))
        }

        // ── HÉROE v2.7: BANDA DORADA a todo ancho — el degradado es el
        // fondo y el texto va oscuro encima; la versión se lee de un
        // vistazo. Visiblemente distinta de la tarjeta oscura de la v2.6.
        // (Si cambia versionName en el Gradle, cambia también este número.)
        val hero = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(18), dp(20), dp(20))
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(goldA, goldMid, goldB)
            ).apply { cornerRadius = dp(20).toFloat() }
        }
        val heroTop = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val monogram = TextView(this).apply {
            text = "AM"
            setTextColor(goldA)
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                setColor(onGold)
                cornerRadius = dp(12).toFloat()
            }
        }
        heroTop.addView(monogram, LinearLayout.LayoutParams(dp(42), dp(42)))
        val title = TextView(this).apply {
            text = "ANFITRIÓN MÁXIMO"
            setTextColor(onGold)
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.06f
            setPadding(dp(12), 0, 0, 0)
        }
        heroTop.addView(title)
        hero.addView(heroTop)
        val versionLabel = TextView(this).apply {
            text = "VERSIÓN"
            setTextColor(Color.argb(170, 26, 20, 4))
            textSize = 11f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.22f
            setPadding(0, dp(14), 0, 0)
        }
        hero.addView(versionLabel)
        val versionRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.BOTTOM
        }
        val versionBig = TextView(this).apply {
            text = "2.8.1"
            setTextColor(onGold)
            textSize = 64f
            typeface = Typeface.DEFAULT_BOLD
        }
        versionRow.addView(versionBig)
        val chip = TextView(this).apply {
            text = "EDICIÓN BLINDADA"
            setTextColor(goldA)
            textSize = 9f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.1f
            gravity = Gravity.CENTER
            setPadding(dp(9), dp(5), dp(9), dp(5))
            background = GradientDrawable().apply {
                setColor(onGold)
                cornerRadius = dp(999).toFloat()
            }
        }
        versionRow.addView(
            chip,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                leftMargin = dp(12)
                bottomMargin = dp(12)
            }
        )
        hero.addView(versionRow)
        root.addView(hero)
        val sub = TextView(this).apply {
            text = "Empareja, firma e instala en tu iPhone por cable, " +
                "sin computadora. El registro que nace aquí es la semilla " +
                "que Tienda Máximo importa en el iPhone."
            setTextColor(dim)
            textSize = 12f
            setPadding(dp(4), dp(12), dp(4), 0)
        }
        root.addView(sub)

        statusView = TextView(this).apply {
            setTextColor(dim)
            textSize = 15f
            setPadding(dp(4), dp(14), dp(4), 0)
        }
        root.addView(statusView)

        // ── TARJETA: emparejar ────────────────────────────────────────────
        val pairCard = card(14)
        pairCard.addView(sectionLabel("EMPAREJAR EL IPHONE"))
        pairButton = goldButton("Emparejar") { startPairing() }
        pairCard.addView(
            pairButton,
            LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(52)
            ).apply { topMargin = dp(12) }
        )

        // Sonda asistida (diseño de Ernesto): la app confirma el enlace con
        // identidad, SUELTA el iPhone y abre la página WebUSB en Chrome; la
        // página empareja con el toque de Ernesto y esta app recoge el .plist.
        sondaButton = secondaryButton("Sonda asistida: emparejar con la página WebUSB") { openWebUsbProbe() }
        pairCard.addView(
            sondaButton,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
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
        pairCard.addView(sondaHint)

        val hint = TextView(this).apply {
            text = "Conecta el iPhone por cable (directo USB-C a Lightning, o con el adaptador OTG), " +
                "déjalo desbloqueado y, cuando lo pida, toca «Confiar» y mete tu código en el iPhone."
            setTextColor(dim)
            textSize = 13f
            setPadding(0, dp(12), 0, 0)
        }
        pairCard.addView(hint)
        root.addView(pairCard)

        // ── TARJETA: firmar e instalar (flujo de tres toques de Ernesto) ──
        val signCard = card(12)
        signCard.addView(sectionLabel("FIRMAR E INSTALAR EN EL IPHONE"))
        val signHint = TextView(this).apply {
            text = "Elige un .ipa de tu teléfono y la app lo firma con tu Apple ID y lo instala " +
                "por el cable. La primera vez de cada app pide entrar con tu cuenta (la contraseña " +
                "no se guarda y la sesión queda solo en este teléfono); después esa app queda en " +
                "la bóveda y se instala hasta sin conexión."
            setTextColor(dim)
            textSize = 13f
            setPadding(0, dp(6), 0, dp(12))
        }
        signCard.addView(signHint)

        elegirIpaButton = secondaryButton("Elegir IPA") { elegirIpa() }
        signCard.addView(
            elegirIpaButton,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        )

        ipaInfoView = TextView(this).apply {
            setTextColor(dim)
            textSize = 13f
            setPadding(0, dp(8), 0, 0)
            visibility = View.GONE
        }
        signCard.addView(ipaInfoView)

        // Login en la MISMA pantalla (solo aparece si la app no está en la bóveda).
        loginBlock = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            setPadding(0, dp(12), 0, 0)
        }
        loginBlock.addView(sectionLabel("TU APPLE ID (SOLO ESTA VEZ)"))
        emailInput = darkInput("Correo de tu Apple ID", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
        loginBlock.addView(emailInput, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        passwordInput = darkInput("Contraseña", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        loginBlock.addView(passwordInput, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        val loginNote = TextView(this).apply {
            text = "La contraseña no se guarda ni sale de este teléfono: vive solo en esta " +
                "instalación. Si Apple pide el código de 6 dígitos, te llega al iPhone y lo " +
                "escribes aquí mismo."
            setTextColor(dim)
            textSize = 12f
            setPadding(0, dp(6), 0, 0)
        }
        loginBlock.addView(loginNote)
        signCard.addView(loginBlock)

        // 2FA en la misma pantalla (aparece solo cuando Apple lo pide).
        tfaBlock = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
            setPadding(0, dp(12), 0, 0)
        }
        tfaBlock.addView(sectionLabel("CÓDIGO DE VERIFICACIÓN DE APPLE"))
        tfaInput = darkInput("Código de 6 dígitos", InputType.TYPE_CLASS_NUMBER)
        tfaBlock.addView(tfaInput, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        val tfaRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
        }
        val enviarTfa = secondaryButton("Enviar código") { entregarTfa() }
        val cancelarTfaBtn = secondaryButton("Cancelar") { cancelarTfa() }
        tfaRow.addView(enviarTfa, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { rightMargin = dp(6) })
        tfaRow.addView(cancelarTfaBtn, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = dp(6) })
        tfaBlock.addView(tfaRow)
        signCard.addView(tfaBlock)

        signButton = goldButton("Firmar e instalar") { startSignInstall() }
        signCard.addView(
            signButton,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)).apply {
                topMargin = dp(12)
            }
        )
        signButton.isEnabled = false
        root.addView(signCard)

        // ── TARJETA: bóveda ───────────────────────────────────────────────
        val vaultCard = card(12)
        vaultCard.addView(sectionLabel("BÓVEDA SIN CONEXIÓN"))
        vaultListView = TextView(this).apply {
            text = "La bóveda está vacía: la primera app que instales con conexión queda guardada aquí."
            setTextColor(dim)
            textSize = 13f
            setPadding(0, dp(6), 0, 0)
        }
        vaultCard.addView(vaultListView)
        root.addView(vaultCard)

        // ── TARJETA: registro ─────────────────────────────────────────────
        val logCard = card(12)
        logCard.addView(sectionLabel("REGISTRO DE ETAPAS"))
        logView = TextView(this).apply {
            setTextColor(ink)
            textSize = 12f
            typeface = Typeface.MONOSPACE
            movementMethod = ScrollingMovementMethod()
            setTextIsSelectable(true)
            setPadding(dp(12), dp(12), dp(12), dp(12))
            background = GradientDrawable().apply {
                setColor(bg)
                setStroke(dp(1), line)
                cornerRadius = dp(14).toFloat()
            }
        }
        logScroll = ScrollView(this).apply {
            addView(logView)
        }
        logCard.addView(
            logScroll,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(190)).apply {
                topMargin = dp(8)
            }
        )

        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, 0)
        }
        sharePairingButton = secondaryButton("Compartir el registro de pairing") { sharePairing() }
        shareLogButton = secondaryButton("Compartir el registro de etapas") { shareLog() }
        row.addView(sharePairingButton, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { rightMargin = dp(6) })
        row.addView(shareLogButton, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = dp(6) })
        logCard.addView(row)

        // Ruta 3 (multi-ruta): un pairing nacido en otra vía — la página WebUSB,
        // InstaladorPRO o una Pi — se importa aquí y queda listo pa compartir.
        val importButton = secondaryButton("Importar un registro nacido en otra vía") { importPairing() }
        logCard.addView(
            importButton,
            LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
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
        logCard.addView(importHint)
        root.addView(logCard)

        // La raíz vive dentro de un ScrollView de página completa (v2.1): el
        // contenido no cabe en pantallas chicas y todo debe ser alcanzable.
        pageScroll = ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(bg)
            addView(
                root,
                android.view.ViewGroup.LayoutParams(
                    android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    android.view.ViewGroup.LayoutParams.WRAP_CONTENT
                )
            )
        }
        setContentView(pageScroll)
        sharePairingButton.isEnabled = false
        shareLogButton.isEnabled = false
    }

    private fun secondaryButton(text: String, onClick: () -> Unit): Button {
        return Button(this).apply {
            this.text = text
            textSize = 14f
            isAllCaps = false
            // Altura automática (v1.1): la altura fija de 50dp cortaba la segunda
            // línea de los textos largos y la solapaba con el contenido de abajo.
            // minimumHeight conserva el tamaño de una línea; si el texto envuelve
            // a dos, el botón crece en vez de encimar.
            minimumHeight = dp(50)
            setTextColor(ink)
            background = GradientDrawable().apply {
                setColor(bg2)
                setStroke(dp(1), lineStrong)
                cornerRadius = dp(14).toFloat()
            }
            setOnClickListener { onClick() }
        }
    }

    /** Campo de texto del sistema de diseño (login y código 2FA). */
    private fun darkInput(hintText: String, inputType: Int): EditText {
        return EditText(this).apply {
            hint = hintText
            this.inputType = inputType
            setTextColor(ink)
            setHintTextColor(dim)
            textSize = 15f
            setPadding(dp(14), dp(14), dp(14), dp(14))
            background = GradientDrawable().apply {
                setColor(bg2)
                setStroke(dp(1), lineStrong)
                cornerRadius = dp(14).toFloat()
            }
        }
    }

    // ── Fase 2: bóveda (Keystore) y migración ─────────────────────────────────

    /**
     * Abre la bóveda cifrada: la llave maestra (KEK) vive en el Android
     * Keystore (no exportable) y envuelve la DEK que el núcleo usa. La DEK en
     * claro existe solo en esta llamada; al núcleo llega por JNI y vive en su
     * memoria. Después migra sola el registro de la v1.1, si existe.
     */
    private fun unlockVault() {
        try {
            val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            val kek: SecretKey = (ks.getEntry(KEK_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey ?: run {
                val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
                gen.init(
                    KeyGenParameterSpec.Builder(
                        KEK_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
                    )
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .build()
                )
                gen.generateKey()
            }
            val prefs = getSharedPreferences("boveda", MODE_PRIVATE)
            val dek: ByteArray = if (prefs.contains("dek_envuelto")) {
                val blob = Base64.decode(prefs.getString("dek_envuelto", ""), Base64.NO_WRAP)
                val iv = Base64.decode(prefs.getString("dek_iv", ""), Base64.NO_WRAP)
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.DECRYPT_MODE, kek, GCMParameterSpec(128, iv))
                c.doFinal(blob)
            } else {
                val nueva = ByteArray(32).also { SecureRandom().nextBytes(it) }
                val c = Cipher.getInstance("AES/GCM/NoPadding")
                c.init(Cipher.ENCRYPT_MODE, kek)
                val envuelta = c.doFinal(nueva)
                prefs.edit()
                    .putString("dek_envuelto", Base64.encodeToString(envuelta, Base64.NO_WRAP))
                    .putString("dek_iv", Base64.encodeToString(c.iv, Base64.NO_WRAP))
                    .apply()
                nueva
            }
            val dir = File(filesDir, "boveda").apply { mkdirs() }
            val logger = StageLogger { line -> appendLog(line) }
            val res = RustBridge.nativeVaultUnlock(dir.absolutePath, dek, cacheDir.absolutePath, logger)
            dek.fill(0)
            if (res == "OK") {
                vaultOpen = true
                migrateLegacyPairing()
                refreshVaultUi()
            } else {
                appendLog("Bóveda: no se pudo abrir ($res)")
            }
        } catch (e: Exception) {
            appendLog("Bóveda: error abriendo el Keystore (${e.message ?: e.javaClass.simpleName})")
        }
    }

    /**
     * Migración v1.1 → v2: el registro que la v1.1 guardó en claro en su
     * carpeta entra a la bóveda cifrada y la copia en claro se borra. La app
     * sigue pudiendo compartirlo (se materializa al momento de compartir).
     */
    private fun migrateLegacyPairing() {
        if (RustBridge.nativeVaultHasPairing()) {
            runOnUiThread { sharePairingButton.isEnabled = true }
            return
        }
        val dirs = listOfNotNull(getExternalFilesDir(null), filesDir)
        for (dir in dirs) {
            val candidates = dir.listFiles()?.filter { it.isFile && it.extension == "plist" } ?: continue
            for (f in candidates) {
                val bytes = runCatching { f.readBytes() }.getOrNull() ?: continue
                val text = String(bytes, Charsets.UTF_8)
                if (!text.contains("<plist") || !text.contains("HostID")) continue
                if (RustBridge.nativeVaultImportPairing(bytes) == "OK") {
                    val nombre = f.name
                    f.delete()
                    pairingFile = null
                    appendLog("Migración a la v2: el registro «$nombre» entró a la bóveda cifrada y su copia en claro se borró")
                    runOnUiThread { sharePairingButton.isEnabled = true }
                    return
                }
            }
        }
    }

    /** Refresca la lista de la bóveda (apps + días que le quedan a cada perfil). */
    private fun refreshVaultUi() {
        if (!vaultOpen) return
        thread(name = "anfitrion-boveda-lista") {
            val texto = try {
                val arr = org.json.JSONArray(RustBridge.nativeVaultProfiles())
                if (arr.length() == 0) {
                    "La bóveda está vacía: la primera app que instales con conexión queda guardada aquí."
                } else {
                    val sb = StringBuilder()
                    for (i in 0 until arr.length()) {
                        val o = arr.getJSONObject(i)
                        val dias = o.optInt("dias", 0)
                        val cuando = when {
                            dias < 0 -> "perfil CADUCADO: renueva con conexión"
                            dias == 0 -> "el perfil caduca HOY"
                            dias == 1 -> "queda 1 día de perfil"
                            else -> "quedan $dias días de perfil"
                        }
                        sb.append("• ${o.optString("nombre")} — $cuando\n")
                    }
                    sb.toString().trim()
                }
            } catch (e: Exception) {
                "No se pudo leer la bóveda."
            }
            runOnUiThread { vaultListView.text = texto }
        }
    }

    // ── Fase 2: elegir IPA y firmar/instalar ──────────────────────────────────

    private fun elegirIpa() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        @Suppress("DEPRECATION")
        startActivityForResult(intent, REQUEST_IPA)
    }

    /** Copia el IPA elegido a la carpeta de trabajo y consulta la bóveda. */
    private fun onIpaChosen(uri: Uri) {
        thread(name = "anfitrion-ipa") {
            try {
                var displayName = "app.ipa"
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
                    // el nombre es cosmético
                }
                if (!displayName.lowercase().endsWith(".ipa")) displayName += ".ipa"
                val dir = File(cacheDir, "ipa").apply { mkdirs() }
                val out = File(dir, displayName)
                contentResolver.openInputStream(uri)?.use { input ->
                    out.outputStream().use { input.copyTo(it) }
                } ?: throw IllegalStateException("no se pudo leer el archivo elegido")
                chosenIpa = out
                val sizeMb = out.length() / 1_000_000.0
                runOnUiThread {
                    ipaInfoView.visibility = View.VISIBLE
                    ipaInfoView.text = "${out.name} · ${String.format("%.1f", sizeMb)} MB — consultando la bóveda…"
                    signButton.isEnabled = !running
                }
                // ¿La bóveda cubre esta app? La cara enseña el login solo si hace falta.
                val logger = StageLogger { line -> appendLog(line) }
                val json = RustBridge.nativeVaultCovers(out.absolutePath, logger)
                val o = JSONObject(json)
                val cubre = o.optBoolean("cubre", false)
                val motivo = o.optString("motivo", "")
                val nombre = o.optString("nombre", out.name)
                runOnUiThread {
                    ipaInfoView.text = "${out.name} · ${String.format("%.1f", sizeMb)} MB\n$motivo"
                    if (cubre) {
                        loginBlock.visibility = View.GONE
                    } else {
                        loginBlock.visibility = View.VISIBLE
                        val savedEmail = getSharedPreferences("boveda", MODE_PRIVATE).getString("apple_email", "")
                        if (!savedEmail.isNullOrEmpty() && emailInput.text.isNullOrEmpty()) {
                            emailInput.setText(savedEmail)
                        }
                    }
                    appendLog("IPA elegido: $nombre (${out.name}) — ${if (cubre) "la bóveda lo cubre (sin conexión)" else "necesita la ruta con conexión una vez"}")
                    // v2.1: la página baja sola hasta la sección de firmar pa que
                    // el nombre/tamaño y el botón se vean sin que haya que buscarlos.
                    pageScroll.post {
                        pageScroll.smoothScrollTo(0, (elegirIpaButton.top - dp(16)).coerceAtLeast(0))
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    setStatus("No se pudo preparar el IPA: ${e.message ?: e.javaClass.simpleName}", red)
                }
            }
        }
    }

    private fun hayRed(): Boolean {
        val cm = getSystemService(CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun startSignInstall() {
        val ipa = chosenIpa ?: run {
            setStatus("Primero elige el IPA que quieres instalar.", red)
            return
        }
        val dev = appleDevice ?: run {
            refreshDeviceState()
            setStatus("Conecta el iPhone por cable: la firma es local, pero la instalación va por el cable.", red)
            return
        }
        val mgr = usbManager ?: return
        if (!mgr.hasPermission(dev)) {
            requestUsbPermission(dev)
            return
        }
        if (!vaultOpen) {
            setStatus("La bóveda aún no está abierta: espera un segundo y reintenta.", red)
            return
        }
        val email = emailInput.text.toString().trim()
        val password = passwordInput.text.toString()
        if (email.isNotEmpty()) {
            // El correo se recuerda (no es secreto); la contraseña JAMÁS se guarda.
            getSharedPreferences("boveda", MODE_PRIVATE).edit().putString("apple_email", email).apply()
        }
        running = true
        signButton.isEnabled = false
        elegirIpaButton.isEnabled = false
        pairButton.isEnabled = false
        sondaButton.isEnabled = false
        setStatus("Firmando e instalando… sigue las etapas abajo y atiende el iPhone si pide algo.", ink)
        appendLog("Firmar e instalar: Kotlin presta el fd; la cadena la corre el núcleo Rust")

        thread(name = "anfitrion-firmar") {
            var result: String
            try {
                val connection = mgr.openDevice(dev)
                if (connection == null) {
                    result = "ERROR::usb::Android no pudo abrir el iPhone (openDevice devolvió null)"
                } else {
                    try {
                        val fd = connection.fileDescriptor
                        result = if (fd < 0) {
                            "ERROR::usb::el descriptor del iPhone salió inválido (fd < 0)"
                        } else {
                            val logger = StageLogger { line -> appendLog(line) }
                            val res = RustBridge.nativeSignInstall(
                                fd, ipa.absolutePath, email, password,
                                hayRed(), tfaBridge, logger
                            )
                            // Seguro del registro (v2.3): si el callback
                            // onStage perdió alguna línea del núcleo, aquí
                            // se añaden las que faltan (dedupe por contador
                            // de entregadas contra el total del sink).
                            try {
                                val todas = RustBridge.nativeStageLines()
                                    .split("\n").filter { it.isNotEmpty() }
                                for (linea in todas.drop(logger.entregadas)) {
                                    appendLog(linea)
                                }
                            } catch (e: Exception) {
                                // El seguro jamás tumba la cadena.
                            }
                            res
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
                passwordInput.setText("")
                signButton.isEnabled = chosenIpa != null
                elegirIpaButton.isEnabled = true
                pairButton.isEnabled = appleDevice != null
                sondaButton.isEnabled = appleDevice != null
                if (result == "OK") {
                    setStatus("App instalada en el iPhone. Ya puedes abrirla en su pantalla.", teal)
                    refreshVaultUi()
                } else {
                    val parts = result.split("::", limit = 3)
                    val etapa = parts.getOrNull(1) ?: "?"
                    val msg = parts.getOrNull(2) ?: result
                    setStatus("La cadena se detuvo en la etapa «$etapa»: $msg", red)
                }
            }
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
                    // v2: el registro recién nacido entra a la bóveda cifrada y
                    // su archivo en claro se borra (queda materializable al compartir).
                    val nacido = pairingFile
                    if (vaultOpen && nacido != null && nacido.exists()) {
                        val bytes = runCatching { nacido.readBytes() }.getOrNull()
                        if (bytes != null && RustBridge.nativeVaultImportPairing(bytes) == "OK") {
                            nacido.delete()
                            pairingFile = null
                            appendLog("El registro recién nacido entró a la bóveda cifrada (su copia en claro se borró)")
                        }
                    }
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
        if (resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        when (requestCode) {
            REQUEST_IMPORT -> importFromUri(uri)
            REQUEST_IPA -> onIpaChosen(uri)
        }
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
                // v2: el registro importado entra DIRECTO a la bóveda cifrada;
                // ya no se guarda ninguna copia en claro.
                if (vaultOpen) {
                    if (RustBridge.nativeVaultImportPairing(bytes) == "OK") {
                        runOnUiThread {
                            appendLog("Registro importado desde otra vía (${bytes.size} bytes) — guardado en la bóveda cifrada")
                            setStatus(
                                "Registro importado y guardado en la bóveda. Compártelo e impórtalo en Tienda Máximo.",
                                teal
                            )
                            sharePairingButton.isEnabled = true
                        }
                    } else {
                        runOnUiThread {
                            setStatus("La bóveda rechazó el registro importado: compártelo con Máximo si se repite.", red)
                        }
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
        // v2: el registro vive en la bóveda; se materializa en la carpeta de
        // compartir justo pa esta salida (el proveedor sirve desde ahí).
        if (vaultOpen && RustBridge.nativeVaultHasPairing()) {
            val dir = File(cacheDir, "compartir").apply { mkdirs() }
            val dest = File(dir, "pair-record.plist")
            if (RustBridge.nativeVaultExportPairing(dest.absolutePath) == "OK") {
                val uri = Uri.parse("content://com.maximo.anfitrion.files/${dest.name}")
                val intent = Intent(Intent.ACTION_SEND).apply {
                    type = "text/xml"
                    putExtra(Intent.EXTRA_STREAM, uri)
                    putExtra(Intent.EXTRA_SUBJECT, "Registro de pairing del iPhone (pair-record.plist)")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                }
                startActivity(Intent.createChooser(intent, "Compartir el registro de pairing"))
                return
            }
        }
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

package com.maximo.ojo

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

object OjoState {
    @Volatile var estado: String = "Listo. Máximo no está viendo nada."
    @Volatile var subidas: Int = 0
    @Volatile var sesionActiva: Boolean = false
    @Volatile var manos: Boolean = false

    // ---- Notificaciones (v2.4): buffer EN MEMORIA, anillo de las últimas 50.
    // Nada se persiste en disco: si el proceso muere, el buffer se pierde.
    @Volatile var notifConectado: Boolean = false
    private val bufferNotif = ArrayDeque<NotifItem>()

    fun agregarNotif(item: NotifItem) {
        synchronized(bufferNotif) {
            bufferNotif.addLast(item)
            while (bufferNotif.size > 50) bufferNotif.removeFirst()
        }
    }

    fun ultimasNotif(n: Int): List<NotifItem> = synchronized(bufferNotif) {
        bufferNotif.takeLast(n)
    }

    fun totalNotif(): Int = synchronized(bufferNotif) { bufferNotif.size }
}

data class NotifItem(
    val paquete: String,
    val app: String,
    val titulo: String,
    val texto: String,
    val horaMs: Long
)

class MainActivity : Activity() {
    private lateinit var panelTxt: TextView
    private lateinit var estadoTxt: TextView
    private val handler = Handler(Looper.getMainLooper())
    private var modoPendiente: String = "unica"
    private val refresco = object : Runnable {
        override fun run() {
            val manosVivas = ManosService.instancia != null || OjoState.manos
            val manosTxt = if (manosVivas) "ACTIVAS 🟢" else "INACTIVAS ⚪"
            val notifTxt = if (OjoState.notifConectado) "ACTIVAS 🟢" else "SIN ACCESO ⚪"
            val puenteTxt = if (manosVivas) "conectado" else "en espera (activa las Manos)"
            val version = try {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(packageName, 0).versionName ?: "?"
            } catch (_: Exception) {
                "?"
            }
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            val batTxt = if (pm.isIgnoringBatteryOptimizations(packageName)) {
                "exenta de optimización"
            } else {
                "optimizada por Android"
            }
            panelTxt.text = "Manos: $manosTxt\nPuente: $puenteTxt" +
                "\nNotificaciones: $notifTxt" +
                "\nVersión: $version\nBatería: $batTxt"
            estadoTxt.text = OjoState.estado + "\nCapturas enviadas: " + OjoState.subidas
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 7)
        }
        val raiz = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF0D1526.toInt())
            setPadding(48, 64, 48, 48)
        }
        val titulo = TextView(this).apply {
            text = "OJO MÁXIMO"
            textSize = 30f
            setTextColor(0xFFF5C86B.toInt())
            gravity = Gravity.CENTER
        }
        panelTxt = TextView(this).apply {
            textSize = 19f
            setTextColor(0xFF9FE8B1.toInt())
            setPadding(0, 36, 0, 12)
        }
        val expl = TextView(this).apply {
            text = "Con las Manos activas, Máximo trabaja en este teléfono por el puente: " +
                "en segundo plano (descargar, instalar, archivos) y en pantalla solo cuando " +
                "tú se lo pides. Tú enciendes y apagas las Manos cuando quieras, desde Accesibilidad."
            textSize = 16f
            setTextColor(0xFFD8E2F2.toInt())
            setPadding(0, 12, 0, 24)
        }
        val bManos = Button(this).apply {
            text = "🖐  ACTIVAR / VER LAS MANOS"
            textSize = 19f
            setPadding(0, 28, 0, 28)
            setOnClickListener {
                this@MainActivity.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
        }
        val bNotif = Button(this).apply {
            text = "🔔  ACTIVAR / VER NOTIFICACIONES"
            textSize = 19f
            setPadding(0, 28, 0, 28)
            setOnClickListener {
                this@MainActivity.startActivity(
                    Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
                )
            }
        }
        val etqHerramientas = TextView(this).apply {
            text = "Herramientas"
            textSize = 14f
            setTextColor(0xFF8FA3C8.toInt())
            setPadding(0, 40, 0, 8)
        }
        fun botonChico(texto: String, accion: () -> Unit) = Button(this).apply {
            text = texto
            textSize = 13f
            setPadding(0, 16, 0, 16)
            layoutParams = LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f
            )
            setOnClickListener { accion() }
        }
        val fila = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fila.addView(botonChico("📸 CAPTURA AHORA") { pedirProyeccion("unica") })
        fila.addView(botonChico("🔴 SESIÓN DE ERRORES") { pedirProyeccion("sesion") })
        fila.addView(botonChico("⏹ DETENER") {
            val i = Intent(this, CaptureService::class.java).setAction(CaptureService.ACCION_PARAR)
            startService(i)
        })
        estadoTxt = TextView(this).apply {
            textSize = 15f
            setTextColor(0xFFD8E2F2.toInt())
            setPadding(0, 28, 0, 0)
        }
        raiz.addView(titulo)
        raiz.addView(panelTxt)
        raiz.addView(expl)
        raiz.addView(bManos)
        raiz.addView(bNotif)
        raiz.addView(etqHerramientas)
        raiz.addView(fila)
        raiz.addView(estadoTxt)
        setContentView(raiz)
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresco)
    }

    override fun onPause() {
        super.onPause()
        handler.removeCallbacks(refresco)
    }

    private fun pedirProyeccion(modo: String) {
        modoPendiente = modo
        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        @Suppress("DEPRECATION")
        startActivityForResult(mpm.createScreenCaptureIntent(), 42)
    }

    @Deprecated("flujo clasico de resultado")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != 42) return
        if (resultCode != RESULT_OK || data == null) {
            OjoState.estado = "Permiso denegado. Sin tu «Permitir» no veo nada."
            return
        }
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        wm.defaultDisplay.getRealMetrics(metrics)
        val i = Intent(this, CaptureService::class.java).apply {
            putExtra("resultCode", resultCode)
            putExtra("data", data)
            putExtra("modo", modoPendiente)
            // Captura única: 5 s pa que Ernesto cambie de app antes de la foto.
            putExtra("retraso", if (modoPendiente == "unica") 5000L else 700L)
            putExtra("ancho", metrics.widthPixels)
            putExtra("alto", metrics.heightPixels)
            putExtra("dpi", metrics.densityDpi)
        }
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i) else startService(i)
        OjoState.estado = if (modoPendiente == "sesion") {
            "Sesión activa: reproduce el error, yo lo estoy viendo."
        } else {
            "Tienes 5 segundos: cambia a la app que quieres enseñarme…"
        }
    }
}

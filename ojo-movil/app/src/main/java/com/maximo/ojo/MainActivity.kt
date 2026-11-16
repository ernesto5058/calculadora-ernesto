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
}

class MainActivity : Activity() {
    private lateinit var estadoTxt: TextView
    private val handler = Handler(Looper.getMainLooper())
    private var modoPendiente: String = "unica"
    private val refresco = object : Runnable {
        override fun run() {
            estadoTxt.text = OjoState.estado + "\n\nCapturas enviadas: " + OjoState.subidas
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
        val expl = TextView(this).apply {
            text = "Máximo ve la pantalla de este teléfono SOLO cuando tú lo activas aquí. " +
                "«Captura ahora» le enseña una pantalla. «Sesión de errores» le va mandando " +
                "capturas mientras reproduces un fallo, pa que vea el error completo. " +
                "Con la app cerrada no se captura nada."
            textSize = 16f
            setTextColor(0xFFD8E2F2.toInt())
            setPadding(0, 24, 0, 24)
        }
        fun boton(texto: String, accion: () -> Unit) = Button(this).apply {
            text = texto
            textSize = 19f
            setPadding(0, 28, 0, 28)
            setOnClickListener { accion() }
        }
        val bUnica = boton("📸  CAPTURA AHORA") { pedirProyeccion("unica") }
        val bSesion = boton("🔴  SESIÓN DE ERRORES (2 MIN)") { pedirProyeccion("sesion") }
        val bParar = boton("⏹  DETENER") {
            val i = Intent(this, CaptureService::class.java).setAction(CaptureService.ACCION_PARAR)
            startService(i)
        }
        estadoTxt = TextView(this).apply {
            textSize = 16f
            setTextColor(0xFF9FE8B1.toInt())
            setPadding(0, 32, 0, 0)
        }
        raiz.addView(titulo)
        raiz.addView(expl)
        raiz.addView(bUnica)
        raiz.addView(bSesion)
        raiz.addView(bParar)
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
            putExtra("ancho", metrics.widthPixels)
            putExtra("alto", metrics.heightPixels)
            putExtra("dpi", metrics.densityDpi)
        }
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i) else startService(i)
        OjoState.estado = if (modoPendiente == "sesion") {
            "Sesión activa: reproduce el error, yo lo estoy viendo."
        } else {
            "Capturando…"
        }
    }
}

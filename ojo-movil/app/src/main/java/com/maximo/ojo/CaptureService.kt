package com.maximo.ojo

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class CaptureService : Service() {
    companion object {
        const val ACCION_PARAR = "com.maximo.ojo.PARAR"
    }

    private var proyeccion: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var hilo: HandlerThread? = null
    private var handler: Handler? = null
    private var modo = "unica"
    private var capturasSesion = 0
    @Volatile private var detenido = false
    @Volatile private var terminado = false
    @Volatile private var ultimoFrame: ByteArray? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACCION_PARAR) {
            terminar("Sesión detenida por ti.")
            return START_NOT_STICKY
        }
        if (proyeccion != null) return START_NOT_STICKY
        modo = intent?.getStringExtra("modo") ?: "unica"
        val retraso = intent?.getLongExtra("retraso", 700L) ?: 700L
        val resultCode = intent?.getIntExtra("resultCode", 0) ?: 0
        @Suppress("DEPRECATION")
        val data: Intent? = intent?.getParcelableExtra("data")
        val ancho = intent?.getIntExtra("ancho", 1080) ?: 1080
        val alto = intent?.getIntExtra("alto", 1920) ?: 1920
        val dpi = intent?.getIntExtra("dpi", 320) ?: 320
        if (data == null) {
            terminar("Falta el permiso de captura.")
            return START_NOT_STICKY
        }

        val escala = if (ancho > 1100) 1100f / ancho else 1f
        val w = ((ancho * escala).toInt() / 2) * 2
        val h = ((alto * escala).toInt() / 2) * 2

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel("ojo", "Ojo Máximo", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val notif: Notification = Notification.Builder(this, "ojo")
            .setContentTitle("Ojo Máximo está mirando")
            .setContentText("Capturando tu pantalla pa Máximo. Detenlo desde la app.")
            .setSmallIcon(android.R.drawable.presence_video_online)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(1, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        } else {
            @Suppress("DEPRECATION")
            startForeground(1, notif)
        }

        hilo = HandlerThread("ojo-captura").apply { start() }
        handler = Handler(hilo!!.looper)

        val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        proyeccion = mpm.getMediaProjection(resultCode, data)
        proyeccion?.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                if (!terminado) terminar("La captura se detuvo.")
            }
        }, handler)

        reader = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
        reader?.setOnImageAvailableListener({ r ->
            val img = try { r.acquireLatestImage() } catch (_: Exception) { null }
            if (img != null) {
                try {
                    ultimoFrame = imageABytes(img)
                } catch (_: Exception) {
                } finally {
                    img.close()
                }
            }
        }, handler)
        display = proyeccion?.createVirtualDisplay(
            "ojo-maximo", w, h, dpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader?.surface, null, handler
        )

        OjoState.sesionActiva = (modo == "sesion")
        if (modo == "unica") {
            handler?.postDelayed({ capturarYSubir(fin = true) }, retraso)
        } else {
            val ciclo = object : Runnable {
                override fun run() {
                    if (detenido || terminado) return
                    capturarYSubir(fin = false)
                    capturasSesion++
                    if (capturasSesion >= 40) {
                        terminar("Sesión completa: se enviaron las capturas.")
                        return
                    }
                    handler?.postDelayed(this, 3000)
                }
            }
            handler?.postDelayed(ciclo, retraso)
        }
        return START_NOT_STICKY
    }

    private fun imageABytes(image: Image): ByteArray {
        val plane = image.planes[0]
        val buffer = plane.buffer
        val pixelStride = plane.pixelStride
        val rowStride = plane.rowStride
        val rowPadding = rowStride - pixelStride * image.width
        val bmp = Bitmap.createBitmap(
            image.width + rowPadding / pixelStride, image.height, Bitmap.Config.ARGB_8888
        )
        bmp.copyPixelsFromBuffer(buffer)
        val final = if (rowPadding == 0) bmp else Bitmap.createBitmap(bmp, 0, 0, image.width, image.height)
        val out = ByteArrayOutputStream()
        final.compress(Bitmap.CompressFormat.JPEG, 72, out)
        return out.toByteArray()
    }

    private fun capturarYSubir(fin: Boolean) {
        val frame = ultimoFrame
        if (frame == null) {
            if (fin) terminar("No llegó ninguna imagen de la pantalla.")
            return
        }
        thread {
            val ok = subir(frame, if (modo == "sesion") "sesion" else "unica")
            if (ok) {
                OjoState.subidas++
                OjoState.estado = if (fin) {
                    "Captura enviada a Máximo ✓"
                } else {
                    "Sesión activa: ${OjoState.subidas} capturas enviadas."
                }
            } else {
                OjoState.estado = "Una subida falló (¿sin conexión?). La sesión sigue."
            }
            if (fin) terminar(null)
        }
    }

    private fun subir(bytes: ByteArray, kind: String): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(Config.URL_FUNCION).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                doOutput = true
                connectTimeout = 15000
                readTimeout = 30000
                setRequestProperty("Content-Type", "image/jpeg")
                setRequestProperty("x-ojo-token", Config.TOKEN)
                setRequestProperty("x-capture-kind", kind)
            }
            conn.outputStream.use { it.write(bytes) }
            conn.responseCode in 200..299
        } catch (_: Exception) {
            false
        } finally {
            conn?.disconnect()
        }
    }

    private fun terminar(mensaje: String?) {
        if (terminado) return
        terminado = true
        detenido = true
        if (mensaje != null) OjoState.estado = mensaje
        OjoState.sesionActiva = false
        try { display?.release() } catch (_: Exception) {}
        try { reader?.close() } catch (_: Exception) {}
        try { proyeccion?.stop() } catch (_: Exception) {}
        display = null
        reader = null
        proyeccion = null
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        hilo?.quitSafely()
        hilo = null
    }

    override fun onDestroy() {
        detenido = true
        super.onDestroy()
    }
}

package com.maximo.ojo

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.provider.MediaStore
import androidx.core.content.FileProvider
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

// Manos de Máximo: servicio de accesibilidad que ERNESTO activa a mano.
// Cuando está activo, pregunta cada 3 s al puente si Máximo ordenó algo
// (tocar, deslizar, escribir, leer la pantalla en texto, abrir una app)
// y lo ejecuta y reporta. Apagar el servicio = Máximo pierde las manos.
class ManosService : AccessibilityService() {
    companion object {
        @Volatile var instancia: ManosService? = null
    }

    private var hilo: HandlerThread? = null
    private var handler: Handler? = null
    @Volatile private var activo = false
    @Volatile private var ultimoTrabajoMs = 0L

    override fun onServiceConnected() {
        super.onServiceConnected()
        instancia = this
        activo = true
        OjoState.manos = true
        hilo = HandlerThread("manos-puente").apply { start() }
        handler = Handler(hilo!!.looper)
        val ciclo = object : Runnable {
            override fun run() {
                if (!activo) return
                try {
                    atender()
                } catch (_: Exception) {
                }
                // Sondeo adaptativo: 1 s durante 60 s tras la última orden;
                // en reposo, 3 s.
                val desdeUltimo = System.currentTimeMillis() - ultimoTrabajoMs
                handler?.postDelayed(this, if (desdeUltimo < 60000) 1000 else 3000)
            }
        }
        handler?.postDelayed(ciclo, 1500)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    override fun onDestroy() {
        activo = false
        if (instancia === this) instancia = null
        OjoState.manos = false
        hilo?.quitSafely()
        super.onDestroy()
    }

    private fun atender() {
        val (code, texto) = http("GET", Config.URL_PUENTE + "/reclamar", null)
        if (code != 200 || texto == null) return
        val j = JSONObject(texto)
        if (j.optBoolean("vacio", false) || !j.has("comando")) return
        val id = j.getString("id")
        val cmd = j.getJSONObject("comando")
        val resultado = ejecutar(cmd)
        ultimoTrabajoMs = System.currentTimeMillis()
        http(
            "POST", Config.URL_PUENTE + "/reporte",
            JSONObject().put("id", id).put("resultado", resultado).toString()
        )
    }

    private fun ejecutar(cmd: JSONObject): String {
        val tipo = cmd.optString("tipo")
        return try {
            when (tipo) {
                "estado" -> JSONObject()
                    .put("ok", true)
                    .put("manos", "activas")
                    .put("ventana", rootInActiveWindow?.packageName?.toString() ?: "?")
                    .toString()
                "arbol" -> JSONObject().put("ok", true).put("arbol", arbolTexto()).toString()
                "tocar" -> {
                    val x = cmd.getDouble("x").toFloat()
                    val y = cmd.getDouble("y").toFloat()
                    val ok = gesto(Path().apply { moveTo(x, y) }, 90)
                    JSONObject().put("ok", ok).put("accion", "tocar $x,$y").toString()
                }
                "deslizar" -> {
                    val p = Path().apply {
                        moveTo(cmd.getDouble("x1").toFloat(), cmd.getDouble("y1").toFloat())
                        lineTo(cmd.getDouble("x2").toFloat(), cmd.getDouble("y2").toFloat())
                    }
                    val ok = gesto(p, cmd.optLong("ms", 300))
                    JSONObject().put("ok", ok).put("accion", "deslizar").toString()
                }
                "atras" -> JSONObject().put("ok", performGlobalAction(GLOBAL_ACTION_BACK)).put("accion", "atras").toString()
                "inicio" -> JSONObject().put("ok", performGlobalAction(GLOBAL_ACTION_HOME)).put("accion", "inicio").toString()
                "recientes" -> JSONObject().put("ok", performGlobalAction(GLOBAL_ACTION_RECENTS)).put("accion", "recientes").toString()
                "abrir" -> {
                    val pq = cmd.getString("paquete")
                    val i = packageManager.getLaunchIntentForPackage(pq)
                    if (i == null) {
                        JSONObject().put("ok", false).put("error", "sin intent pa $pq").toString()
                    } else {
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        startActivity(i)
                        JSONObject().put("ok", true).put("accion", "abrir $pq").toString()
                    }
                }
                "escribir" -> escribir(cmd.getString("texto"))
                "descargar" -> descargar(cmd.getString("url"), cmd.optString("nombre", ""))
                "instalar" -> instalar(cmd.getString("url"), cmd.optString("nombre", ""))
                "instalar_local" -> instalarLocal(cmd.getString("nombre"))
                "bateria" -> bateria()
                "notificaciones" -> notificaciones(cmd.optInt("n", 10))
                "shell" -> shell(cmd.getString("cmd"))
                "archivos" -> archivos(cmd.optString("ruta", ""))
                "macro" -> macro(cmd)
                else -> JSONObject().put("ok", false).put("error", "tipo desconocido: $tipo").toString()
            }
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "error").toString()
        }
    }

    private fun gesto(path: Path, ms: Long): Boolean {
        val g = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, ms))
            .build()
        return dispatchGesture(g, null, null)
    }

    private fun escribir(texto: String): String {
        val raiz = rootInActiveWindow
            ?: return JSONObject().put("ok", false).put("error", "sin ventana").toString()
        val foco = raiz.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        val destino = foco ?: buscarEditable(raiz)
        if (destino != null && destino.isEditable) {
            val args = Bundle().apply {
                putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, texto)
            }
            val ok = destino.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            return JSONObject().put("ok", ok).put("accion", "escribir directo").toString()
        }
        val cb = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cb.setPrimaryClip(ClipData.newPlainText("maximo", texto))
        val focoAccion = raiz.findFocus(AccessibilityNodeInfo.FOCUS_ACCESSIBILITY)
        val ok = focoAccion?.performAction(AccessibilityNodeInfo.ACTION_PASTE) ?: false
        return JSONObject().put("ok", ok).put("accion", "escribir por portapapeles").toString()
    }

    private fun buscarEditable(n: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (n == null) return null
        if (n.isEditable && n.isVisibleToUser) return n
        for (i in 0 until n.childCount) {
            val r = buscarEditable(n.getChild(i))
            if (r != null) return r
        }
        return null
    }

    private fun arbolTexto(): String {
        val raiz = rootInActiveWindow ?: return "(sin ventana activa)"
        val sb = StringBuilder()
        sb.append("Ventana: ").append(raiz.packageName).append('\n')
        var contador = 0
        fun caminar(n: AccessibilityNodeInfo?, nivel: Int) {
            if (n == null || contador > 500) return
            contador++
            val r = Rect()
            n.getBoundsInScreen(r)
            val clase = n.className?.toString()?.substringAfterLast('.') ?: "?"
            sb.append("  ".repeat(nivel)).append(clase)
            val t = n.text?.toString()
            val d = n.contentDescription?.toString()
            if (!t.isNullOrEmpty()) sb.append(" \"").append(t.take(6000)).append('"')
            else if (!d.isNullOrEmpty()) sb.append(" ~").append(d.take(120)).append("~")
            sb.append(" [").append(r.left).append(',').append(r.top).append(',')
                .append(r.right).append(',').append(r.bottom).append(']')
            if (n.isClickable) sb.append(" TOCABLE")
            if (n.isEditable) sb.append(" EDITABLE")
            if (n.isFocused) sb.append(" FOCO")
            val idv = n.viewIdResourceName
            if (!idv.isNullOrEmpty()) sb.append(" id=").append(idv.substringAfterLast('/'))
            sb.append('\n')
            for (i in 0 until n.childCount) caminar(n.getChild(i), nivel + 1)
        }
        caminar(raiz, 0)
        return sb.toString().take(60000)
    }

    // ---- Ejecutor en segundo plano (v2.2) ----
    // Estos comandos NO tocan la UI: corren en el hilo del servicio mientras
    // Ernesto sigue usando el teléfono, como el cmd de la PC.

    private fun macro(cmd: JSONObject): String {
        val pasos = cmd.optJSONArray("pasos")
            ?: return JSONObject().put("ok", false).put("error", "macro sin pasos").toString()
        val esperaDefecto = cmd.optLong("espera_ms", 0)
        val resultados = JSONArray()
        var todosOk = true
        for (i in 0 until pasos.length()) {
            val paso = pasos.optJSONObject(i)
            if (paso == null) {
                resultados.put(
                    JSONObject().put("ok", false).put("error", "paso $i inválido").toString()
                )
                todosOk = false
                continue
            }
            val espera = paso.optLong("espera_ms", esperaDefecto)
            if (i > 0 && espera > 0) Thread.sleep(espera)
            val r = ejecutar(paso)
            resultados.put(r)
            try {
                if (!JSONObject(r).optBoolean("ok", false)) todosOk = false
            } catch (_: Exception) {
                todosOk = false
            }
        }
        return JSONObject().put("ok", todosOk).put("resultados", resultados).toString()
    }

    // Zona propia de la app (getExternalFilesDir): aquí viven los APK a
    // instalar, servidos al instalador del sistema por el FileProvider.
    private fun dirLocal(): File {
        val base = getExternalFilesDir(null) ?: filesDir
        return File(base, "apks").apply { mkdirs() }
    }

    private fun descargar(url: String, nombreIn: String): String {
        val nombre = nombreIn.ifEmpty {
            url.substringAfterLast('/').substringBefore('?').ifEmpty { "descarga.bin" }
        }
        return try {
            // Copia local SIEMPRE (zona propia de la app).
            val local = File(dirLocal(), nombre)
            val (total, sha) = bajarAArchivo(url, local)
            // Y la copia visible en Descargas, vía MediaStore, como hasta ahora.
            var rutaFinal = local.absolutePath
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                try {
                    val valores = ContentValues().apply {
                        put(MediaStore.Downloads.DISPLAY_NAME, nombre)
                        put(MediaStore.Downloads.MIME_TYPE, "application/octet-stream")
                        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    }
                    val uri = contentResolver.insert(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI, valores
                    )
                    if (uri != null) {
                        contentResolver.openOutputStream(uri)?.use { o ->
                            local.inputStream().use { inp -> inp.copyTo(o) }
                        }
                        rutaFinal = Environment.getExternalStoragePublicDirectory(
                            Environment.DIRECTORY_DOWNLOADS
                        ).absolutePath + "/" + nombre
                    }
                } catch (_: Exception) {
                }
            }
            JSONObject().put("ok", true).put("ruta", rutaFinal)
                .put("copia_local", local.absolutePath)
                .put("bytes", total).put("sha256", sha).toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "error").toString()
        }
    }

    // Baja la URL a un archivo local y devuelve (bytes, sha256 de 12).
    // Sin el token del puente: es una URL arbitraria, no se filtra la llave.
    private fun bajarAArchivo(url: String, destino: File): Pair<Long, String> {
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 15000
                readTimeout = 60000
                instanceFollowRedirects = true
            }
            val code = conn.responseCode
            if (code !in 200..299) throw Exception("HTTP $code")
            val md = MessageDigest.getInstance("SHA-256")
            var total = 0L
            destino.outputStream().use { o ->
                conn.inputStream.use { inp -> total = copiarContando(inp, o, md) }
            }
            val sha = md.digest().joinToString("") { "%02x".format(it) }.take(12)
            return Pair(total, sha)
        } finally {
            conn?.disconnect()
        }
    }

    // ---- Instalación asistida (v2.3) ----
    // El instalador del sistema se dispara DESDE la app, con un content://
    // del FileProvider propio. Nada de `am` ni shell: eso muere por
    // permisos (INTERACT_ACROSS_USERS). El diálogo «Instalar» del sistema
    // sigue apareciendo: es la regla de Android sin root ni dueño del
    // dispositivo; aquí solo se reporta que el intent salió.

    private fun instalar(url: String, nombreIn: String): String {
        val nombre = nombreIn.ifEmpty {
            url.substringAfterLast('/').substringBefore('?').ifEmpty { "app.apk" }
        }.substringAfterLast('/')
        return try {
            val f = File(dirLocal(), nombre)
            val (total, sha) = bajarAArchivo(url, f)
            lanzarInstalador(f).put("bytes", total).put("sha256", sha).toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "error").toString()
        }
    }

    private fun instalarLocal(nombreIn: String): String {
        val nombre = nombreIn.substringAfterLast('/')
        return try {
            val f = File(dirLocal(), nombre)
            if (!f.exists()) {
                JSONObject().put("ok", false)
                    .put("error", "no está en la zona local: $nombre").toString()
            } else {
                lanzarInstalador(f).toString()
            }
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "error").toString()
        }
    }

    private fun lanzarInstalador(f: File): JSONObject {
        val uri: Uri = FileProvider.getUriForFile(this, "com.maximo.ojo.files", f)
        val i = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        startActivity(i)
        return JSONObject().put("ok", true).put("ruta", f.absolutePath)
            .put("puede_instalar", packageManager.canRequestPackageInstalls())
            .put("nota", "instalador lanzado; queda el toque a «Instalar» en el diálogo del sistema")
    }

    // ---- Notificaciones en segundo plano (v2.4) ----
    // Lee el buffer en memoria que llena NotificacionesService. Si Ernesto
    // no ha concedido el acceso a notificaciones, lo dice claro en vez de
    // devolver una lista vacía que parecería «sin mensajes».
    private fun notificaciones(nIn: Int): String {
        if (!OjoState.notifConectado) {
            return JSONObject().put("ok", false).put("conectado", false)
                .put("error", "acceso a notificaciones NO activado").toString()
        }
        val n = nIn.coerceIn(1, 50)
        val arr = JSONArray()
        for (item in OjoState.ultimasNotif(n)) {
            arr.put(
                JSONObject()
                    .put("paquete", item.paquete)
                    .put("app", item.app)
                    .put("titulo", item.titulo)
                    .put("texto", item.texto)
                    .put("hora_ms", item.horaMs)
            )
        }
        return JSONObject().put("ok", true).put("conectado", true)
            .put("total_buffer", OjoState.totalNotif())
            .put("notificaciones", arr).toString()
    }

    private fun bateria(): String {
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        return JSONObject().put("ok", true)
            .put("exenta_bateria", pm.isIgnoringBatteryOptimizations(packageName))
            .put("paquete", packageName).toString()
    }

    private fun copiarContando(
        inp: java.io.InputStream,
        out: java.io.OutputStream,
        md: MessageDigest
    ): Long {
        var total = 0L
        val buf = ByteArray(65536)
        while (true) {
            val n = inp.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            md.update(buf, 0, n)
            total += n
        }
        return total
    }

    private fun shell(comando: String): String {
        return try {
            val proc = ProcessBuilder("/system/bin/sh", "-c", comando)
                .redirectErrorStream(true)
                .start()
            val sb = StringBuffer()
            val lector = Thread {
                try {
                    proc.inputStream.bufferedReader().forEachLine { sb.append(it).append('\n') }
                } catch (_: Exception) {
                }
            }
            lector.start()
            if (!proc.waitFor(60, java.util.concurrent.TimeUnit.SECONDS)) {
                proc.destroyForcibly()
                lector.join(2000)
                JSONObject().put("ok", false).put("error", "timeout 60s")
                    .put("salida", sb.toString().take(8000)).toString()
            } else {
                lector.join(3000)
                JSONObject().put("ok", true).put("codigo", proc.exitValue())
                    .put("salida", sb.toString().take(8000)).toString()
            }
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "error").toString()
        }
    }

    private fun archivos(rutaIn: String): String {
        return try {
            val ruta = rutaIn.ifEmpty { Environment.getExternalStorageDirectory().absolutePath }
            val dir = File(ruta)
            if (!dir.exists()) {
                return JSONObject().put("ok", false).put("error", "no existe: $ruta").toString()
            }
            val lista = JSONArray()
            if (!dir.isDirectory) {
                lista.put(
                    JSONObject().put("nombre", dir.name)
                        .put("tamano", dir.length()).put("es_dir", false)
                )
            } else {
                val hijos = dir.listFiles()?.sortedBy { it.name.lowercase() } ?: emptyList()
                for (f in hijos) {
                    lista.put(
                        JSONObject().put("nombre", f.name)
                            .put("tamano", if (f.isDirectory) 0 else f.length())
                            .put("es_dir", f.isDirectory)
                    )
                }
            }
            JSONObject().put("ok", true).put("ruta", dir.absolutePath)
                .put("lista", lista).toString()
        } catch (e: Exception) {
            JSONObject().put("ok", false).put("error", e.message ?: "error").toString()
        }
    }

    private fun http(metodo: String, url: String, cuerpo: String?): Pair<Int, String?> {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = metodo
                connectTimeout = 15000
                readTimeout = 30000
                setRequestProperty("x-ojo-token", Config.TOKEN)
                if (cuerpo != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                }
            }
            if (cuerpo != null) conn.outputStream.use { it.write(cuerpo.toByteArray()) }
            val code = conn.responseCode
            val txt = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.readText()
            Pair(code, txt)
        } catch (_: Exception) {
            Pair(-1, null)
        } finally {
            conn?.disconnect()
        }
    }
}

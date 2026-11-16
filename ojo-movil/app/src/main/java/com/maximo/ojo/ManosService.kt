package com.maximo.ojo

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

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
                handler?.postDelayed(this, 3000)
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
            if (!t.isNullOrEmpty()) sb.append(" \"").append(t.take(60)).append('"')
            else if (!d.isNullOrEmpty()) sb.append(" ~").append(d.take(60)).append("~")
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
        return sb.toString().take(30000)
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

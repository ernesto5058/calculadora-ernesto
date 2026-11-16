package com.maximo.ojo

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

// Lector de notificaciones en segundo plano (v2.4 — Paso 0 del fondo).
// Ernesto concede el acceso en Ajustes → Acceso a notificaciones.
// Guarda en memoria (buffer de OjoState, anillo de 50) paquete, app,
// título, texto y hora de cada notificación que llega. NADA va a disco.
//
// Filtros, pa que el buffer no se llene de ruido:
//  - las notificaciones del propio Ojo se ignoran;
//  - los resúmenes de grupo (FLAG_GROUP_SUMMARY, p. ej. «5 mensajes de
//    3 chats» de WhatsApp) se ignoran: duplican lo que cada mensaje
//    individual ya trae;
//  - las que no traen ni título ni texto se ignoran.
class NotificacionesService : NotificationListenerService() {

    override fun onListenerConnected() {
        super.onListenerConnected()
        OjoState.notifConectado = true
    }

    override fun onListenerDisconnected() {
        OjoState.notifConectado = false
        super.onListenerDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        if (sbn == null) return
        try {
            val pq = sbn.packageName ?: return
            if (pq == packageName) return
            val notif = sbn.notification ?: return
            if ((notif.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return
            val extras = notif.extras
            val titulo = extras.getCharSequence(Notification.EXTRA_TITLE)
                ?.toString()?.trim() ?: ""
            // EXTRA_BIG_TEXT trae el texto completo cuando la app lo da;
            // si no, el EXTRA_TEXT normal.
            val texto = (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
                ?: extras.getCharSequence(Notification.EXTRA_TEXT))
                ?.toString()?.trim() ?: ""
            if (titulo.isEmpty() && texto.isEmpty()) return
            val app = try {
                val ai = packageManager.getApplicationInfo(pq, 0)
                packageManager.getApplicationLabel(ai).toString()
            } catch (_: Exception) {
                pq
            }
            OjoState.agregarNotif(
                NotifItem(
                    paquete = pq,
                    app = app,
                    titulo = titulo.take(300),
                    texto = texto.take(1000),
                    horaMs = sbn.postTime
                )
            )
        } catch (_: Exception) {
            // Una notificación rara jamás tumba el listener.
        }
    }
}

package com.maximo.ojo

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Tras un reinicio, Android restaura solo los servicios de accesibilidad
// que Ernesto tenga activados (las Manos vuelven sin tocar nada). Este
// receptor solo deja constancia del arranque en las preferencias de la
// app; no puede (ni debe) arrancar capturas: la proyección de pantalla
// pide el permiso de Ernesto en pantalla cada vez.
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        context.getSharedPreferences("ojo", Context.MODE_PRIVATE)
            .edit()
            .putLong("ultimo_arranque_ms", System.currentTimeMillis())
            .apply()
    }
}

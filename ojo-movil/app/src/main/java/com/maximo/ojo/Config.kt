package com.maximo.ojo

// El token solo autoriza SUBIR capturas y reclamar comandos del puente
// de Ernesto. No lee nada por sí solo; si se abusa, se rota el secreto.
object Config {
    const val URL_FUNCION = "https://otsudfgwpapkluusrlnj.supabase.co/functions/v1/ojo-remoto"
    const val URL_PUENTE = "https://otsudfgwpapkluusrlnj.supabase.co/functions/v1/puente-movil"
    const val TOKEN = "wN1tmQhe8BmlwGNSnnrTjVQbofe1VkXaJ7Sqwm2UHt0"
}

package com.maximo.ojo

// El token solo autoriza SUBIR capturas al bucket privado de Ernesto
// (ojo-remoto). No lee nada ni abre ninguna otra puerta; si algún día
// se abusa de él, se rota el secreto de la función y se recompila.
object Config {
    const val URL_FUNCION = "https://otsudfgwpapkluusrlnj.supabase.co/functions/v1/ojo-remoto"
    const val TOKEN = "wN1tmQhe8BmlwGNSnnrTjVQbofe1VkXaJ7Sqwm2UHt0"
}

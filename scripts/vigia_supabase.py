#!/usr/bin/env python3
"""Toque diario a Supabase para que el proyecto Free no se duerma.
GitHub Actions (repo público, minutos gratis) lo corre 1 vez al día.
Usa SOLO la llave pública (publishable) con un SELECT de 1 fila: no lee
datos de nadie si la RLS no lo permite; basta el contacto con la BD.
Si la pausa llega a ocurrir, el propio panel de Supabase ofrece reactivar."""
import json, urllib.request, urllib.error

URL = "https://otsudfgwpapkluusrlnj.supabase.co/rest/v1/reportes?select=id&limit=1"
KEY = "sb_publishable_Uchl5QnojJkZbXR5ar8vDg_5CXnqi_d"

req = urllib.request.Request(URL, method="GET")
req.add_header("apikey", KEY)
req.add_header("Authorization", "Bearer " + KEY)
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print("Supabase respondió:", r.status)
except urllib.error.HTTPError as e:
    # Un 4xx por RLS también prueba que el proyecto está despierto
    print("Supabase respondió con HTTP", e.code, "(proyecto despierto)")
except Exception as e:
    print("ERROR contactando Supabase:", e)
    raise SystemExit(1)

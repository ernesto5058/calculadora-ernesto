#!/usr/bin/env python3
"""Foto horaria del mercado P2P (datos PUBLICOS de QvaPay, sin llaves).

Baja GET https://api.qvapay.com/p2p/averages y agrega UNA linea a
datos/historico.jsonl con los promedios de ETECSA y BANK_CUP, y deja la
ultima foto en datos/ultimo.json. Pensado para correr en GitHub Actions.
"""
import json, os, sys, time
from datetime import datetime, timezone

URL = "https://api.qvapay.com/p2p/averages"
COINS = ("ETECSA", "BANK_CUP")
BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "datos")

def num(x):
    return round(float(x), 4) if x is not None else None

def main():
    data = None
    for intento in range(3):
        try:
            import requests
            r = requests.get(URL, timeout=30,
                             headers={"User-Agent": "vigia-mercado-ernesto/1.0"})
            r.raise_for_status()
            data = r.json()
            break
        except Exception as e:
            print(f"Intento {intento + 1} fallo: {e}")
            time.sleep(5)
    if data is None:
        print("La API no respondio tras 3 intentos."); return 1
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    foto = {"ts": now}
    for c in COINS:
        row = data.get(c) or {}
        foto[c] = {
            "average": num(row.get("average")),
            "average_buy": num(row.get("average_buy")),
            "average_sell": num(row.get("average_sell")),
            "median_sell": num(row.get("median_sell")),
            "count": row.get("count"),
            "count_buy": row.get("count_buy"),
            "count_sell": row.get("count_sell"),
            "window_hours": row.get("window_hours"),
        }
    if foto["ETECSA"]["average"] is None and foto["BANK_CUP"]["average"] is None:
        print("Sin datos utiles; no se escribe nada."); return 1
    os.makedirs(BASE, exist_ok=True)
    with open(os.path.join(BASE, "historico.jsonl"), "a") as f:
        f.write(json.dumps(foto) + "\n")
    with open(os.path.join(BASE, "ultimo.json"), "w") as f:
        json.dump(foto, f, indent=1)
    print(json.dumps(foto))
    return 0

if __name__ == "__main__":
    sys.exit(main())

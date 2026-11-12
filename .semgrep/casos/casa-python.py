# Casos de prueba — casa-python.yaml  (semgrep test: ruleid = debe cazar, ok = no debe cazar)

# ruleid: casa-python-sin-urllib
import urllib.request

def baja_malo(url):
    # ruleid: casa-python-sin-urllib
    req = urllib.request.Request(url, method="GET")
    # ruleid: casa-python-sin-urllib
    return urllib.request.urlopen(req, timeout=30)


# ok: casa-python-sin-urllib
import requests

def baja_bueno(url):
    # ok: casa-python-sin-urllib
    r = requests.get(url, timeout=30, headers={"User-Agent": "vigia/1.0"})
    r.raise_for_status()
    return r.json()

#!/usr/bin/env python3
"""Ensambla buscadores/index.html = index-sin-script.html con app.js inyectado
en el marcador <script id="appjs"></script>. Corre en CI antes de cap sync."""
import io, os, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def main():
    with io.open(os.path.join(RAIZ, "buscadores-app", "index-sin-script.html"), encoding="utf-8") as f:
        sin = f.read()
    with io.open(os.path.join(RAIZ, "buscadores-app", "app.js"), encoding="utf-8") as f:
        js = f.read()
    if 'id="appjs"' not in sin:
        print("FALTA el marcador en index-sin-script.html")
        return 1
    if "</script>" in js:
        print("app.js contiene </script> sin escapar")
        return 1
    out = sin.replace('<script id="appjs"></script>', "<script>\n" + js + "\n</script>", 1)
    destino = os.path.join(RAIZ, "buscadores", "index.html")
    with io.open(destino, "w", encoding="utf-8") as f:
        f.write(out)
    print("index.html ensamblado:", len(out), "caracteres")
    return 0

if __name__ == "__main__":
    sys.exit(main())

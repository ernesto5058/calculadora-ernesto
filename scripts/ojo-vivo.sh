#!/usr/bin/env bash
# Ojo Vivo: emulador Android EN VIVO dentro de GitHub Actions.
# La pantalla del emulador se transmite por noVNC a traves de un tunel
# cloudflared (URL en url.txt de la rama ojo-vivo y en el resumen de la
# corrida). La sesion se maneja a distancia: cualquier orden escrita en
# cmd.txt (rama ojo-vivo) se ejecuta con adb y deja su foto en shots/.
# Uso: ojo-vivo.sh <tag-release> <minutos-sesion>
set -u
TAG="${1:-apk-v1.5.0}"
MINUTOS="${2:-20}"
T_INICIO=$(date +%s)
OUT="$RUNNER_TEMP/vivo-out"; mkdir -p "$OUT/shots"
REPO_DIR="$RUNNER_TEMP/vivo-repo"
BR="ojo-vivo"
export ANDROID_HOME="${ANDROID_HOME:-/usr/local/lib/android/sdk}"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools"
stamp(){ date -u +%H:%M:%S; }
linea(){ echo "[$(stamp)] $*" | tee -a "$OUT/estado.txt"; }

# ---------- publicacion en la rama ojo-vivo (rebase + reintentos) ----------
git config --global user.name "ojo-vivo"
git config --global user.email "ojo-vivo@users.noreply.github.com"
git clone --quiet "https://x-access-token:${GH_TOKEN}@github.com/ernesto5058/calculadora-ernesto.git" "$REPO_DIR" || { linea "FALLO clonando el repo"; exit 1; }
cd "$REPO_DIR"
if git ls-remote --exit-code --heads origin "$BR" >/dev/null 2>&1; then
  git fetch --quiet origin "$BR"; git checkout --quiet "$BR"
else
  git checkout --quiet --orphan "$BR"; git rm -rf . >/dev/null 2>&1 || true
fi
mkdir -p shots
publicar(){
  cp -a "$OUT/estado.txt" "$OUT/url.txt" "$OUT/ultimo-cmd.log" "$REPO_DIR/" 2>/dev/null || true
  cp -a "$OUT/shots/." "$REPO_DIR/shots/" 2>/dev/null || true
  cd "$REPO_DIR"; git add -A
  if git diff --cached --quiet; then return 0; fi
  git commit -qm "$1" || return 0
  for i in 1 2 3 4; do
    git pull --rebase origin "$BR" >/dev/null 2>&1 || true
    if git push origin "$BR" >/dev/null 2>&1; then return 0; fi
    sleep 5
  done
  linea "AVISO: publicar '$1' fallo tras reintentos"
}
shot(){
  adb exec-out screencap -p > "$OUT/shots/$1.png" 2>/dev/null || true
  adb shell uiautomator dump /sdcard/win.xml >/dev/null 2>&1 || true
  adb pull /sdcard/win.xml "$OUT/shots/$1.xml" >/dev/null 2>&1 || rm -f "$OUT/shots/$1.xml"
}

# ---------- piezas del sistema ----------
linea "Instalando piezas (Xvfb, x11vnc, noVNC, cloudflared)..."
sudo apt-get update -qq >/dev/null 2>&1
sudo apt-get install -y -qq xvfb x11vnc novnc python3-websockify curl >/dev/null 2>&1 || sudo apt-get install -y -qq xvfb x11vnc curl >/dev/null 2>&1
NOVNC_DIR=/usr/share/novnc
[ -d "$NOVNC_DIR" ] || { sudo git clone --depth 1 https://github.com/novnc/noVNC "$NOVNC_DIR" >/dev/null 2>&1; }
command -v websockify >/dev/null 2>&1 || pip3 install --quiet websockify >/dev/null 2>&1
sudo curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared
linea "Piezas listas (t+$(( $(date +%s)-T_INICIO ))s)"

# ---------- KVM + AVD ----------
echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules >/dev/null
sudo udevadm control --reload-rules >/dev/null 2>&1 || true
sudo udevadm trigger --name-match=kvm >/dev/null 2>&1 || true
if [ -e /dev/kvm ]; then linea "/dev/kvm presente: aceleracion por hardware SI"; else linea "SIN /dev/kvm: el emulador ira por software"; fi
yes | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager "platform-tools" "emulator" "system-images;android-34;google_apis;x86_64" >/dev/null 2>&1
echo no | avdmanager create avd -n vivo -k "system-images;android-34;google_apis;x86_64" -d pixel_6 --force >/dev/null 2>&1 || \
echo no | avdmanager create avd -n vivo -k "system-images;android-34;google_apis;x86_64" --force >/dev/null 2>&1
linea "AVD creado (t+$(( $(date +%s)-T_INICIO ))s)"

# ---------- pantalla virtual + emulador ----------
Xvfb :99 -screen 0 1320x2700x24 >/dev/null 2>&1 &
export DISPLAY=:99
sleep 2
nohup emulator -avd vivo -skin 1080x2400 -gpu swiftshader_indirect -no-audio -no-boot-anim -no-snapshot -accel on -cores 2 -memory 3072 > "$OUT/emulator.log" 2>&1 &
adb wait-for-device
n=0
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 3; n=$((n+1)); [ $n -gt 80 ] && { linea "FALLO: el emulador no termino de arrancar"; publicar "fallo arranque"; exit 1; }; done
linea "Emulador arrancado (t+$(( $(date +%s)-T_INICIO ))s desde el inicio del script)"
adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
adb shell input keyevent 82 >/dev/null 2>&1 || true

# ---------- VNC + noVNC + tunel ----------
VNCPASS=$(tr -dc 'a-z0-9' </dev/urandom | head -c 10)
mkdir -p "$HOME/.vnc"; x11vnc -storepasswd "$VNCPASS" "$HOME/.vnc/passwd" >/dev/null 2>&1
x11vnc -display :99 -rfbport 5900 -rfbauth "$HOME/.vnc/passwd" -forever -shared -bg -o "$OUT/x11vnc.log" >/dev/null 2>&1
websockify --web="$NOVNC_DIR" 6080 localhost:5900 > "$OUT/websockify.log" 2>&1 &
nohup cloudflared tunnel --no-autoupdate --url http://localhost:6080 > "$OUT/cloudflared.log" 2>&1 &
URL=""
for i in $(seq 1 40); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$OUT/cloudflared.log" 2>/dev/null | head -1)
  [ -n "$URL" ] && break; sleep 3
done
if [ -z "$URL" ]; then linea "FALLO: el tunel cloudflared no levanto"; publicar "fallo tunel"; exit 1; fi
linea "Tunel listo (t+$(( $(date +%s)-T_INICIO ))s)"
echo "$URL" > "$OUT/url.txt"
{
  echo "## Ojo Vivo - sesion en vivo"
  echo
  echo "- **URL:** $URL/vnc.html"
  echo "- **Clave VNC:** \`$VNCPASS\` (noVNC la pide al conectar)"
  echo "- Tocar la pantalla = tocar el telefono. La sesion dura ~${MINUTOS} min desde que arranco el emulador."
} >> "$GITHUB_STEP_SUMMARY"
publicar "url lista"

# ---------- APK + puerta ----------
linea "Descargando la APK $TAG..."
mkdir -p "$RUNNER_TEMP/apk"
if ! gh release download "$TAG" --repo ernesto5058/calculadora-ernesto --pattern "*.apk" --dir "$RUNNER_TEMP/apk" >/dev/null 2>&1; then
  linea "FALLO descargando la APK $TAG"; publicar "fallo apk"; exit 1
fi
APK=$(ls "$RUNNER_TEMP/apk"/*.apk | head -1)
if adb install -r "$APK" >/dev/null 2>&1; then linea "APK instalada: $(basename "$APK") (t+$(( $(date +%s)-T_INICIO ))s)"; else linea "FALLO instalando la APK"; publicar "fallo instalacion"; exit 1; fi
adb shell monkey -p cu.ernesto.mitrabajo -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
sleep 8
shot puerta
linea "App abierta en su puerta; foto publicada"
publicar "puerta"

# ---------- sesion viva gobernada por cmd.txt ----------
linea "SESION VIVA: esperando ordenes por cmd.txt durante ${MINUTOS} min"
DEADLINE=$(( $(date +%s) + MINUTOS*60 ))
LAST_HASH=""
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  cd "$REPO_DIR"
  git pull --rebase origin "$BR" >/dev/null 2>&1 || true
  if [ -s cmd.txt ]; then
    H=$(sha256sum cmd.txt | cut -d' ' -f1)
    if [ "$H" != "$LAST_HASH" ]; then
      LAST_HASH="$H"
      linea "Orden recibida (${H:0:8})"
      bash cmd.txt > "$OUT/ultimo-cmd.log" 2>&1 || true
      shot ahora
      linea "Orden ejecutada; foto 'ahora' publicada"
      publicar "orden ejecutada"
    fi
  fi
  sleep 12
done
linea "Fin de la sesion viva (tiempo cumplido)"
shot final
publicar "cierre de sesion"

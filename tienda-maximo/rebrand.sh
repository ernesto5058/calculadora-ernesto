#!/usr/bin/env bash
# Aplica la marca «Tienda Máximo» sobre un clon de SideStore.
# Uso: bash tienda-maximo/rebrand.sh <ruta-al-clon>
# No toca trustedapps.json (la fuente oficial sigue siendo la oficial).
set -euo pipefail
SS="${1:?falta la ruta del clon de SideStore}"
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$SS"

NEW_ID="com.maximo.tienda"
OLD_ID="com.SideStore.SideStore"

# 1) Identidad en Build.xcconfig — de aquí derivan bundle id, app group e
#    ids de las extensiones en TODOS los targets (app, widget y SideBackup,
#    incluidos los builds anidados que lanza el propio proyecto).
sed -i '' 's|ORG_IDENTIFIER = com.SideStore|ORG_IDENTIFIER = com.maximo|' Build.xcconfig
sed -i '' 's|\$(ORG_IDENTIFIER)\.SideStore|$(ORG_IDENTIFIER).tienda|' Build.xcconfig
grep -n 'ORG_IDENTIFIER\|BASE_BUNDLE_ID' Build.xcconfig

# 2) Constantes con el id viejo escritas a mano en código y plists
#    (Bundle+AltStore.swift, Info.plist, entitlements de release, etc.)
grep -rl "$OLD_ID" --include='*.swift' --include='*.plist' --include='*.entitlements' \
  SideStore AltStore Shared AltWidget SideBackup xcconfigs 2>/dev/null | while read -r f; do
  sed -i '' "s/$OLD_ID/$NEW_ID/g" "$f"
  echo "parcheado: $f"
done

# 3) Icono propio: todos los tamaños del AppIcon.appiconset
ICON_DIR="AltStore/Resources/Icons.xcassets/AppIcon.appiconset"
for png in "$HERE/assets/icons/"*.png; do
  cp "$png" "$ICON_DIR/$(basename "$png")"
done
echo "iconos copiados: $(ls "$ICON_DIR"/*.png | wc -l | tr -d ' ')"

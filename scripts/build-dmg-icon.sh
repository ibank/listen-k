#!/usr/bin/env bash
#
# Generate build/dmg-icon.icns for electron-builder's `dmg.icon` field.
# Runs the PNG generator, then fans out to the standard iconset sizes that
# `iconutil` expects and packages them into a multi-resolution icns.
#
# Requires macOS (sips + iconutil). Re-run after editing scripts/generate-dmg-icon.js.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "build-dmg-icon.sh requires macOS (sips/iconutil)." >&2
  exit 1
fi

node scripts/generate-dmg-icon.js

SRC="build/dmg-icon.png"
ICONSET="build/dmg-icon.iconset"
OUT="build/dmg-icon.icns"

rm -rf "$ICONSET"
mkdir -p "$ICONSET"

sips -z 16 16     "$SRC" --out "$ICONSET/icon_16x16.png"      >/dev/null
sips -z 32 32     "$SRC" --out "$ICONSET/icon_16x16@2x.png"   >/dev/null
sips -z 32 32     "$SRC" --out "$ICONSET/icon_32x32.png"      >/dev/null
sips -z 64 64     "$SRC" --out "$ICONSET/icon_32x32@2x.png"   >/dev/null
sips -z 128 128   "$SRC" --out "$ICONSET/icon_128x128.png"    >/dev/null
sips -z 256 256   "$SRC" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256   "$SRC" --out "$ICONSET/icon_256x256.png"    >/dev/null
sips -z 512 512   "$SRC" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512   "$SRC" --out "$ICONSET/icon_512x512.png"    >/dev/null
cp                "$SRC"       "$ICONSET/icon_512x512@2x.png"

iconutil -c icns "$ICONSET" -o "$OUT"
rm -rf "$ICONSET"

echo "dmg icns written: $OUT ($(stat -f%z "$OUT") bytes)"
